import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Route Imports
import availabilityRoutes from './routes/availability.js';
import bookingsRoutes from './routes/bookings.js';
import cartRoutes from './routes/cart.js';
import inventoryRoutes from './routes/inventory.js';
import productsRoutes from './routes/products.js';
import webhooksRoutes from './routes/webhooks.js';
import adminRoutes from './routes/admin.js';
import calendarRoutes from './routes/calendar.js';
import featuresRoutes from './routes/features.js';
import customersRoutes from './routes/customers.js';
import ordersRoutes from './routes/orders.js';
import photoStripsRoutes from './routes/photoStrips.js';
import configRoutes from './routes/config.js';
import eventPhotosRoutes from './routes/eventPhotos.js';

// Middleware Imports
import {
  apiLimiter,
  bookingLimiter,
  adminLimiter,
  webhookLimiter,
  calendarLimiter
} from './middleware/rateLimiter.js';

// Service Imports
import BookingService from './services/bookingService.js';
import FotoboxInventoryManager from './services/inventoryManager.js';
import shopifySync from './services/shopifySync.js';
import { initializeCronJobs, stopCronJobs } from './services/cronService.js';

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - IMPORTANT for Railway/Heroku/any reverse proxy
// This allows Express to trust the X-Forwarded-* headers
app.set('trust proxy', 1);

// Security Headers (Helmet)
// Protects against common vulnerabilities: Clickjacking, XSS, MIME-sniffing, etc.
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for Shopify iframe compatibility
  hsts: {
    maxAge: 31536000,        // 1 year in seconds
    includeSubDomains: true, // Apply to all subdomains
    preload: true            // Enable HSTS preloading
  },
  frameguard: {
    action: 'deny'           // Prevent clickjacking (X-Frame-Options: DENY)
  },
  noSniff: true,             // Prevent MIME-type sniffing (X-Content-Type-Options: nosniff)
  xssFilter: true            // Enable XSS filter (X-XSS-Protection: 1; mode=block)
}));

// Middleware - CORS Configuration
// Security: Exact origin matching only (no wildcards)
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [
  'https://qtmbcf-bf.myshopify.com',
  'https://fotobox-booking-production.up.railway.app',
  'https://api.youmephoto.com',
  'http://localhost:3000',
  'http://localhost:5173'
];

// PERFORMANCE: Compress all responses (gzip/deflate)
// Reduces bandwidth by 60-80% for JSON/HTML responses
app.use(compression({
  level: 6, // Compression level 0-9 (6 is good balance of speed/size)
  threshold: 1024, // Only compress responses > 1KB
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Exact match only (no wildcards for security)
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🚫 CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Webhooks benötigen raw body für signature verification
// Muss VOR express.json() kommen
app.use('/webhooks', webhooksRoutes);

// Serve Admin Panel (static build) - BEFORE body parsers
const staticOptions = {
  maxAge: '1d',
  etag: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8');
    } else if (path.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    }
  }
};

app.use('/admin', express.static(path.join(__dirname, '../admin-panel/dist'), staticOptions));
app.use('/assets', express.static(path.join(__dirname, '../admin-panel/dist/assets'), staticOptions));
app.use('/admin/assets', express.static(path.join(__dirname, '../admin-panel/dist/assets'), staticOptions));
// Serve frontend assets (fonts, images) – falls through if not found in admin-panel/dist/assets
app.use('/assets', express.static(path.join(__dirname, '../frontend/dist/assets'), staticOptions));

// Body parsers (after static files)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files (photos, templates) from Railway volume
const uploadsPath = process.env.NODE_ENV === 'production'
  ? '/app/data/uploads'
  : path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsPath));

// Serve logo from uploads directory (same volume)
// Logo is at /app/data/uploads/logo.png
app.use('/static/logo.png', (req, res, next) => {
  const logoPath = process.env.NODE_ENV === 'production'
    ? '/app/data/uploads/logo.png'
    : path.join(__dirname, '../frontend/public/logo.png');

  res.sendFile(logoPath, (err) => {
    if (err) {
      console.error(`Logo not found at ${logoPath}:`, err.message);
      next(err);
    }
  });
});

// Request Logging Middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Health Check Endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Fotobox Rental API',
    version: '1.0.0',
    endpoints: {
      availability: '/api/availability',
      bookings: '/api/bookings',
      inventory: '/api/inventory',
    },
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes with Rate Limiting
app.use('/api/availability', apiLimiter, availabilityRoutes);
app.use('/api/bookings', bookingLimiter, bookingsRoutes); // Strict limit for bookings
app.use('/api/cart', cartRoutes); // No rate limiting - cart validation can be called frequently
app.use('/api/config', configRoutes); // Config endpoints (public, cached)
app.use('/api/inventory', apiLimiter, inventoryRoutes);
app.use('/api/products', apiLimiter, productsRoutes);
app.use('/api/photo-strips', apiLimiter, photoStripsRoutes); // Photo strip editor routes
app.use('/api/templates', apiLimiter, photoStripsRoutes); // Template routes (shared with photo strips)
app.use('/api/admin', adminLimiter, adminRoutes); // Strict limit for admin
app.use('/api/admin/calendar', calendarLimiter, calendarRoutes); // Moderate limit for calendar feeds
app.use('/api/admin/features', adminLimiter, featuresRoutes); // Feature management (admin)
app.use('/api/admin/customers', adminLimiter, customersRoutes); // Customer management
app.use('/api/admin/orders', adminLimiter, ordersRoutes); // Order management
app.use('/api', apiLimiter, eventPhotosRoutes); // Event photos API (placeholder)
app.use('/webhooks', webhookLimiter, webhooksRoutes); // Permissive for Shopify webhooks

// Admin Panel SPA fallback (must be after API routes and static files)
// IMPORTANT: Only serve index.html for non-asset routes to avoid MIME-type issues
app.get('/admin/*', (req, res, next) => {
  // Skip SPA fallback for static assets (already handled by express.static above)
  if (req.path.startsWith('/admin/assets/')) {
    return next(); // Let 404 handler catch this if file doesn't exist
  }
  res.sendFile(path.join(__dirname, '../admin-panel/dist/index.html'));
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Error:', err);

  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Copy logo to volume at startup (volume only available at runtime, not during build)
if (process.env.NODE_ENV === 'production') {
  import('fs').then((fs) => {
    const logoSource = path.join(__dirname, '../frontend/public/logo.png');
    const logoTarget = '/app/data/uploads/logo.png';

    try {
      if (fs.existsSync(logoSource)) {
        fs.copyFileSync(logoSource, logoTarget);
        console.log(`✅ Logo copied to ${logoTarget}`);
      } else {
        console.warn(`⚠️ Logo not found at ${logoSource}`);
      }
    } catch (err) {
      console.error('❌ Error copying logo:', err.message);
    }
  });
}

// Initialize Booking Service for cleanup
const inventoryManager = new FotoboxInventoryManager();
const bookingService = new BookingService(inventoryManager);

// Start Server
app.listen(PORT, async () => {
  const { execSync } = await import('child_process');

  // Run photo strips migration on startup (after volume is mounted)
  try {
    console.log('🗄️ Running photo strips migration...');
    execSync('node scripts/migrate-photo-strips.js', { cwd: __dirname, encoding: 'utf-8' });
    console.log('✅ Photo strips migration complete');
  } catch (error) {
    console.log('⚠️ Photo strips migration skipped or failed:', error.message);
  }

  // Run shipping migration on startup
  try {
    console.log('🗄️ Running shipping migration...');
    execSync('node scripts/migrate-shipping.js', { cwd: __dirname, encoding: 'utf-8' });
    console.log('✅ Shipping migration complete');
  } catch (error) {
    console.log('⚠️ Shipping migration skipped or failed:', error.message);
  }

  console.log('');
  console.log('🚀 Fotobox Rental API Server');
  console.log('================================');
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
  console.log(`🏪 Shopify Store: ${process.env.SHOPIFY_STORE_URL}`);
  console.log('');
  console.log('📋 Available Endpoints:');
  console.log(`   GET  /health - Health check`);
  console.log(`   GET  /api/availability - Get available dates`);
  console.log(`   GET  /api/availability/check - Check specific date`);
  console.log(`   POST /api/bookings/reserve - Create reservation`);
  console.log(`   POST /api/bookings/confirm - Confirm reservation`);
  console.log(`   GET  /api/bookings/:id - Get booking details`);
  console.log(`   DELETE /api/bookings/:id - Cancel booking`);
  console.log(`   PATCH /api/bookings/:id/status - Update booking status`);
  console.log(`   POST /api/bookings/cleanup - Cleanup expired reservations`);
  console.log(`   GET  /api/inventory/:variantId - Get inventory info`);
  console.log(`   GET  /api/inventory/:variantId/bookings - Get all bookings`);
  console.log(`   POST /webhooks/shopify/orders/create - Shopify order webhook`);
  console.log('');
  console.log('💡 Test connection with: curl http://localhost:3000/health');
  console.log('');

  // Run initial cleanup on startup
  console.log('🧹 Running initial cleanup of expired reservations...');
  try {
    const cleaned = await bookingService.cleanupExpiredReservations();
    console.log(`✅ Cleanup complete. Removed ${cleaned} expired reservations`);
  } catch (error) {
    console.error('❌ Initial cleanup failed:', error.message);
  }

  // Schedule periodic cleanup every 5 minutes
  const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
  setInterval(async () => {
    console.log('[Cleanup] Running periodic cleanup...');
    try {
      const cleaned = await bookingService.cleanupExpiredReservations();
      if (cleaned > 0) {
        console.log(`[Cleanup] Removed ${cleaned} expired reservations`);
      }
    } catch (error) {
      console.error('[Cleanup] Periodic cleanup failed:', error.message);
    }
  }, CLEANUP_INTERVAL);

  console.log(`⏰ Periodic cleanup scheduled every ${CLEANUP_INTERVAL / 60000} minutes`);

  // Start automatic Shopify product sync
  console.log('🔄 Starting Shopify product sync service...');
  shopifySync.start();

  // Initialize shipping management cron jobs
  console.log('⏰ Initializing shipping management cron jobs...');
  initializeCronJobs();

  console.log('');
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  stopCronJobs();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT signal received: closing HTTP server');
  stopCronJobs();
  process.exit(0);
});

export default app;
