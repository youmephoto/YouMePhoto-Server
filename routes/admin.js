import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import shopifyClient from '../config/shopify.js';
import BookingService from '../services/bookingService.js';
// BackupService is SQLite-only, not used with PostgreSQL
import { requireAuth } from '../middleware/auth.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import discountService from '../services/discountService.js';
import discountSyncService from '../services/discountSyncService.js';
import {
  variantInventoryQueries,
  inventoryHistoryQueries,
  inventoryScheduleQueries,
  adminUserQueries,
  blockedDatesQueries,
  customerQueries,
  orderQueries,
  bookingsQueries,
  pool,
  prepare,
} from '../db/database.js';

const router = express.Router();
const bookingService = new BookingService();

/**
 * @deprecated - Use requireAuth from middleware/auth.js instead
 * Keeping this as fallback for backward compatibility
 */
async function requireAuthLegacy(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
  }

  try {
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    const user = await adminUserQueries.findByUsername(username);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    // Update last login
    await adminUserQueries.updateLastLogin(user.id);

    req.user = user;
    next();
  } catch (error) {
    console.error('[Admin API] Auth error:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid credentials',
    });
  }
}

/**
 * GET /api/admin/inventory
 *
 * Get all variant inventories
 *
 * Response:
 * {
 *   "success": true,
 *   "inventory": [...]
 * }
 */
router.get('/inventory', requireJwtAuth, async (req, res) => {
  try {
    const inventory = await variantInventoryQueries.getAll();

    res.json({
      success: true,
      inventory,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching inventory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/inventory/:variantGid
 *
 * Get specific variant inventory
 */
router.get('/inventory/:variantGid', requireJwtAuth, async (req, res) => {
  try {
    const { variantGid } = req.params;
    const decodedGid = decodeURIComponent(variantGid);

    const inventory = await variantInventoryQueries.getByVariantGid(decodedGid);

    if (!inventory) {
      return res.status(404).json({
        success: false,
        error: 'Variant not found',
      });
    }

    res.json({
      success: true,
      inventory,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching inventory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory',
      message: error.message,
    });
  }
});

/**
 * PUT /api/admin/inventory/:variantGid
 *
 * Update variant inventory quantity
 *
 * Body:
 * {
 *   "totalUnits": 5,
 *   "reason": "Purchased new unit"
 * }
 */
router.put('/inventory/:variantGid', requireJwtAuth, async (req, res) => {
  try {
    const { variantGid } = req.params;
    const { totalUnits, reason } = req.body;
    const decodedGid = decodeURIComponent(variantGid);

    if (typeof totalUnits !== 'number' || totalUnits < 0) {
      return res.status(400).json({
        success: false,
        error: 'totalUnits must be a non-negative number',
      });
    }

    // Get current quantity
    const current = await variantInventoryQueries.getByVariantGid(decodedGid);

    if (!current) {
      return res.status(404).json({
        success: false,
        error: 'Variant not found',
      });
    }

    // Update quantity
    await variantInventoryQueries.updateQuantity(totalUnits, decodedGid);

    // Add history entry
    await inventoryHistoryQueries.add(      decodedGid,
      current.total_units,
      totalUnits,
      req.user.username,
      reason || 'Manual update via admin panel'
    );

    console.log(`[Admin API] Inventory updated: ${current.product_title} - ${current.variant_title} from ${current.total_units} to ${totalUnits}`);

    res.json({
      success: true,
      message: 'Inventory updated successfully',
      oldQuantity: current.total_units,
      newQuantity: totalUnits,
    });
  } catch (error) {
    console.error('[Admin API] Error updating inventory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update inventory',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/inventory/:variantGid/history
 *
 * Get inventory change history for a variant
 */
router.get('/inventory/:variantGid/history', requireJwtAuth, async (req, res) => {
  try {
    const { variantGid } = req.params;
    const decodedGid = decodeURIComponent(variantGid);

    const history = await inventoryHistoryQueries.getByVariant(decodedGid);

    res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/history
 *
 * Get recent inventory changes across all variants
 */
router.get('/history', requireJwtAuth, async (req, res) => {
  try {
    const history = await inventoryHistoryQueries.getRecent();

    res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/inventory/:variantGid/schedule
 *
 * Get all scheduled inventory changes for a variant
 */
router.get('/inventory/:variantGid/schedule', requireJwtAuth, async (req, res) => {
  try {
    const { variantGid } = req.params;
    const decodedGid = decodeURIComponent(variantGid);

    const schedules = await inventoryScheduleQueries.getByVariant(decodedGid);

    res.json({
      success: true,
      schedules,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching inventory schedule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory schedule',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/inventory/:variantGid/schedule
 *
 * Add a new scheduled inventory change
 *
 * Body:
 * {
 *   "effectiveDate": "2026-05-01",
 *   "totalUnits": 10,
 *   "note": "Production batch 3 completed"
 * }
 */
router.post('/inventory/:variantGid/schedule', requireJwtAuth, async (req, res) => {
  try {
    const { variantGid } = req.params;
    const decodedGid = decodeURIComponent(variantGid);
    const { effectiveDate, totalUnits, note } = req.body;

    // Validation
    if (!effectiveDate || totalUnits === undefined) {
      return res.status(400).json({
        success: false,
        error: 'effectiveDate and totalUnits are required',
      });
    }

    if (totalUnits < 0) {
      return res.status(400).json({
        success: false,
        error: 'totalUnits must be >= 0',
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(effectiveDate)) {
      return res.status(400).json({
        success: false,
        error: 'effectiveDate must be in format YYYY-MM-DD',
      });
    }

    // Add schedule
    const result = await inventoryScheduleQueries.add(      decodedGid,
      effectiveDate,
      totalUnits,
      note || null,
      req.user.username
    );

    res.json({
      success: true,
      scheduleId: result?.id,
      message: 'Inventory schedule added successfully',
    });
  } catch (error) {
    console.error('[Admin API] Error adding inventory schedule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add inventory schedule',
      message: error.message,
    });
  }
});

/**
 * PUT /api/admin/inventory/schedule/:scheduleId
 *
 * Update an existing scheduled inventory change
 *
 * Body:
 * {
 *   "totalUnits": 12,
 *   "note": "Updated production estimate"
 * }
 */
router.put('/inventory/schedule/:scheduleId', requireJwtAuth, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { totalUnits, note } = req.body;

    // Validation
    if (totalUnits === undefined) {
      return res.status(400).json({
        success: false,
        error: 'totalUnits is required',
      });
    }

    if (totalUnits < 0) {
      return res.status(400).json({
        success: false,
        error: 'totalUnits must be >= 0',
      });
    }

    // Check if schedule exists
    const schedule = await inventoryScheduleQueries.getById(scheduleId);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      });
    }

    // Update schedule
    await inventoryScheduleQueries.update(totalUnits, note || null, scheduleId);

    res.json({
      success: true,
      message: 'Inventory schedule updated successfully',
    });
  } catch (error) {
    console.error('[Admin API] Error updating inventory schedule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update inventory schedule',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/admin/inventory/schedule/:scheduleId
 *
 * Delete a scheduled inventory change
 */
router.delete('/inventory/schedule/:scheduleId', requireJwtAuth, async (req, res) => {
  try {
    const { scheduleId } = req.params;

    // Check if schedule exists
    const schedule = await inventoryScheduleQueries.getById(scheduleId);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      });
    }

    // Delete schedule
    await inventoryScheduleQueries.delete(scheduleId);

    res.json({
      success: true,
      message: 'Inventory schedule deleted successfully',
    });
  } catch (error) {
    console.error('[Admin API] Error deleting inventory schedule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete inventory schedule',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/login
 *
 * Login with JWT + Account Lockout Protection
 * - Max 5 failed attempts (configurable via MAX_LOGIN_ATTEMPTS)
 * - 15 minute lockout (configurable via LOCKOUT_DURATION_MINUTES)
 * - Returns JWT token (24h validity, configurable via JWT_EXPIRES_IN)
 *
 * Security improvements:
 * - Brute-force protection via account lockout
 * - JWT tokens instead of Basic Auth
 * - Failed attempts tracked by IP + username
 * - Timing-safe password comparison
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const clientIp = req.ip;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Username and password required',
    });
  }

  try {
    // 1. Check failed login attempts (Account Lockout)
    const MAX_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5;
    const LOCKOUT_MINUTES = parseInt(process.env.LOCKOUT_DURATION_MINUTES, 10) || 15;

    const failedAttemptsQuery = await pool.query(`
      SELECT COUNT(*) as count, MAX(attempted_at) as last_attempt
      FROM failed_login_attempts
      WHERE (username = $1 OR ip_address = $2)
        AND attempted_at > NOW() - ($3 || ' minutes')::INTERVAL
    `, [username, clientIp, String(LOCKOUT_MINUTES)]);

    const attempts = failedAttemptsQuery.rows[0];

    if (attempts && parseInt(attempts.count) >= MAX_ATTEMPTS) {
      const lockoutMinutesRemaining = LOCKOUT_MINUTES - Math.floor(
        (Date.now() - new Date(attempts.last_attempt).getTime()) / 60000
      );

      console.warn(`[Security] Account locked: ${username} from IP ${clientIp} (${attempts.count} attempts)`);

      return res.status(429).json({
        success: false,
        error: `Account temporarily locked due to too many failed login attempts. Try again in ${lockoutMinutesRemaining} minutes.`,
        code: 'ACCOUNT_LOCKED',
        retryAfter: lockoutMinutesRemaining * 60
      });
    }

    // 2. Verify credentials
    const user = await adminUserQueries.findByUsername(username);

    if (!user) {
      // Log failed attempt (username not found)
      await logFailedAttempt(username, clientIp, 'USER_NOT_FOUND');

      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      // Log failed attempt (wrong password)
      await logFailedAttempt(username, clientIp, 'WRONG_PASSWORD');

      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // 3. Success! Clear failed attempts + generate JWT
    await clearFailedAttempts(username, clientIp);
    await adminUserQueries.updateLastLogin(user.id);

    // Generate JWT token
    if (!process.env.JWT_SECRET) {
      console.error('[Auth] JWT_SECRET not configured!');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error'
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN,
        issuer: 'fotobox-api',
        audience: 'admin-panel'
      }
    );

    console.log(`[Auth] Login successful: ${username} from ${clientIp}`);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      expiresIn: process.env.JWT_EXPIRES_IN,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      message: error.message
    });
  }
});

/**
 * Helper: Log failed login attempt
 */
async function logFailedAttempt(username, ipAddress, reason) {
  try {
    await pool.query(`
      INSERT INTO failed_login_attempts (username, ip_address, reason, attempted_at)
      VALUES ($1, $2, $3, NOW())
    `, [username, ipAddress, reason]);
  } catch (error) {
    console.error('[Auth] Failed to log failed attempt:', error);
  }
}

/**
 * Helper: Clear failed attempts on successful login
 */
async function clearFailedAttempts(username, ipAddress) {
  try {
    await pool.query(`
      DELETE FROM failed_login_attempts
      WHERE username = $1 OR ip_address = $2
    `, [username, ipAddress]);
  } catch (error) {
    console.error('[Auth] Failed to clear attempts:', error);
  }
}

/**
 * GET /api/admin/dashboard/stats
 *
 * Get dashboard statistics
 *
 * Response:
 * {
 *   "success": true,
 *   "stats": {
 *     "fotoboxen": { total: 5, active: 3 },
 *     "bookings": { total: 42, thisMonth: 8, upcoming: 5 },
 *     "customers": { total: 28, new: 3 },
 *     "revenue": { total: 12450.00, thisMonth: 2100.00 }
 *   }
 * }
 */
router.get('/dashboard/stats', requireJwtAuth, async (req, res) => {
  try {
    // Fotoboxen stats
    const allInventory = await variantInventoryQueries.getAll();
    const totalFotoboxen = allInventory.reduce((sum, inv) => sum + inv.total_units, 0);

    // Bookings stats
    const allBookings = await bookingsQueries.getAll();
    const confirmedBookings = allBookings.filter(b => b.status === 'confirmed');

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const bookingsThisMonth = confirmedBookings.filter(b => {
      const bookingDate = new Date(b.created_at);
      return bookingDate >= firstDayOfMonth;
    });

    const upcomingBookings = confirmedBookings.filter(b => {
      const eventDate = new Date(b.event_date);
      return eventDate >= today;
    });

    // Customers stats
    const allCustomers = await customerQueries.getAll();
    const newCustomers = allCustomers.filter(c => {
      const createdAt = new Date(c.created_at);
      return createdAt >= firstDayOfMonth;
    });

    // Revenue stats
    const allOrders = await orderQueries.getAll();
    const paidOrders = allOrders.filter(o => o.financial_status === 'paid');
    const totalRevenue = paidOrders.reduce((sum, order) => sum + (order.total_amount || 0), 0);

    const ordersThisMonth = paidOrders.filter(o => {
      const orderDate = new Date(o.created_at);
      return orderDate >= firstDayOfMonth;
    });
    const revenueThisMonth = ordersThisMonth.reduce((sum, order) => sum + (order.total_amount || 0), 0);

    res.json({
      success: true,
      stats: {
        fotoboxen: {
          total: totalFotoboxen,
          variants: allInventory.length,
        },
        bookings: {
          total: confirmedBookings.length,
          thisMonth: bookingsThisMonth.length,
          upcoming: upcomingBookings.length,
        },
        customers: {
          total: allCustomers.length,
          new: newCustomers.length,
        },
        revenue: {
          total: Math.round(totalRevenue * 100) / 100,
          thisMonth: Math.round(revenueThisMonth * 100) / 100,
        },
      },
    });
  } catch (error) {
    console.error('[Admin API] Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard stats',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/config
 *
 * Get admin configuration values from environment
 *
 * Response:
 * {
 *   "success": true,
 *   "config": {
 *     "criticalDaysThreshold": 3
 *   }
 * }
 */
router.get('/config', requireJwtAuth, async (req, res) => {
  try {
    const criticalDaysThreshold = parseInt(process.env.CRITICAL_DAYS_THRESHOLD, 10);

    res.json({
      success: true,
      config: {
        criticalDaysThreshold,
      },
    });
  } catch (error) {
    console.error('[Admin API] Error fetching config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch config',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/dashboard/timeline
 *
 * Get recent activity timeline for dashboard
 *
 * Response:
 * {
 *   "success": true,
 *   "timeline": [
 *     {
 *       "type": "booking" | "order" | "customer",
 *       "title": "Neue Buchung",
 *       "description": "Premium Fotobox für 2025-12-31",
 *       "timestamp": "2025-01-04T10:30:00.000Z"
 *     }
 *   ]
 * }
 */
router.get('/dashboard/timeline', requireJwtAuth, async (req, res) => {
  try {
    const timeline = [];

    // Get recent bookings (last 10)
    const allBookings = await bookingsQueries.getAll();
    const recentBookings = allBookings
      .filter(b => b.status === 'confirmed')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);

    recentBookings.forEach(booking => {
      timeline.push({
        type: 'booking',
        title: 'Neue Buchung',
        description: `${booking.product_title} - ${booking.variant_title} für ${booking.event_date}`,
        timestamp: booking.created_at,
      });
    });

    // Get recent orders (last 10)
    const allOrders = await orderQueries.getAll();
    const recentOrders = allOrders
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);

    recentOrders.forEach(order => {
      timeline.push({
        type: 'order',
        title: 'Neue Bestellung',
        description: `${order.order_id} - ${order.first_name} ${order.last_name} (${order.total_amount}€)`,
        timestamp: order.created_at,
      });
    });

    // Get recent customers (last 10)
    const allCustomers = await customerQueries.getAll();
    const recentCustomers = allCustomers
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);

    recentCustomers.forEach(customer => {
      timeline.push({
        type: 'customer',
        title: 'Neuer Kunde',
        description: `${customer.first_name} ${customer.last_name} (${customer.email})`,
        timestamp: customer.created_at,
      });
    });

    // Sort all by timestamp descending and limit to 20 most recent
    timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const recentTimeline = timeline.slice(0, 20);

    res.json({
      success: true,
      timeline: recentTimeline,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching dashboard timeline:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard timeline',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/dashboard/today
 *
 * Get today's events (bookings starting today)
 *
 * Response:
 * {
 *   "success": true,
 *   "events": [
 *     {
 *       "id": 5,
 *       "productTitle": "Premium Fotobox",
 *       "variantTitle": "Weiß",
 *       "customerEmail": "kunde@example.com",
 *       "eventDate": "2025-01-04",
 *       "startDate": "2025-01-04",
 *       "endDate": "2025-01-04"
 *     }
 *   ]
 * }
 */
router.get('/dashboard/today', requireJwtAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const allBookings = await bookingsQueries.getAll();
    const todayEvents = allBookings.filter(booking => {
      return booking.status === 'confirmed' && booking.start_date === today;
    });

    res.json({
      success: true,
      events: todayEvents,
      count: todayEvents.length,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching today events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch today events',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/blocked-dates
 *
 * Get all blocked date ranges
 */
router.get('/blocked-dates', requireJwtAuth, async (req, res) => {
  try {
    const blockedDates = await blockedDatesQueries.getAll();

    res.json({
      success: true,
      blockedDates,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching blocked dates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch blocked dates',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/blocked-dates
 *
 * Add a new blocked date range
 *
 * Body:
 * {
 *   "startDate": "2024-12-25",
 *   "endDate": "2024-12-26",
 *   "reason": "Christmas holidays"
 * }
 */
router.post('/blocked-dates', requireJwtAuth, async (req, res) => {
  try {
    const { startDate, endDate, reason } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required',
      });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format',
      });
    }

    if (start > end) {
      return res.status(400).json({
        success: false,
        error: 'startDate must be before or equal to endDate',
      });
    }

    // Add blocked date
    const result = await blockedDatesQueries.add(      startDate,
      endDate,
      reason || null,
      req.user.username
    );

    console.log(`[Admin API] Blocked date added: ${startDate} to ${endDate} by ${req.user.username}`);

    res.json({
      success: true,
      message: 'Blocked date range added successfully',
      id: result?.id,
    });
  } catch (error) {
    console.error('[Admin API] Error adding blocked date:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add blocked date',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/admin/blocked-dates/:id
 *
 * Delete a blocked date range
 */
router.delete('/blocked-dates/:id', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if exists
    const existing = await blockedDatesQueries.getById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Blocked date not found',
      });
    }

    // Delete
    await blockedDatesQueries.delete(id);

    console.log(`[Admin API] Blocked date deleted: ID ${id} by ${req.user.username}`);

    res.json({
      success: true,
      message: 'Blocked date deleted successfully',
    });
  } catch (error) {
    console.error('[Admin API] Error deleting blocked date:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete blocked date',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/migrate-inventory
 *
 * Migrate inventory from Shopify to local database
 * This endpoint can be called to populate or refresh the variant_inventory table
 *
 * Response:
 * {
 *   "success": true,
 *   "migrated": 12,
 *   "failed": 0,
 *   "inventory": [...]
 * }
 */
router.post('/migrate-inventory', requireJwtAuth, async (req, res) => {
  try {
    console.log('[Admin API] Starting inventory migration from Shopify...');

    // Fetch all products with fotobox tag
    const query = `
      query GetProducts($query: String!) {
        products(first: 50, query: $query) {
          edges {
            node {
              id
              title
              tags
              variants(first: 50) {
                edges {
                  node {
                    id
                    title
                    inventoryQuantity
                    price
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyClient.graphql(query, {
      query: 'tag:basic OR tag:premium OR tag:luxury',
    });

    const products = data.products.edges.map(edge => edge.node);

    // Filter out addon products (Zusatztag)
    const photoboxProducts = products.filter(
      product => !product.title.toLowerCase().includes('zusatztag')
    );

    console.log(`[Admin API] Found ${photoboxProducts.length} Photobox products`);

    let migrated = 0;
    let failed = 0;
    const migratedInventory = [];

    for (const product of photoboxProducts) {
      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        const variantGid = variant.id;
        const numericId = variantGid.split('/').pop();

        try {
          // Insert or update variant
          await variantInventoryQueries.upsert(            variantGid,
            numericId,
            product.title,
            variant.title,
            variant.inventoryQuantity || 1,
            variant.price
          );

          migrated++;
          migratedInventory.push({
            variantGid,
            productTitle: product.title,
            variantTitle: variant.title,
            totalUnits: variant.inventoryQuantity || 1,
            price: variant.price,
          });

          console.log(`[Admin API] ✓ ${product.title} - ${variant.title}: ${variant.inventoryQuantity || 1} units`);
        } catch (error) {
          console.error(`[Admin API] ✗ Failed to migrate ${product.title} - ${variant.title}:`, error.message);
          failed++;
        }
      }
    }

    console.log('[Admin API] Migration complete!');
    console.log(`[Admin API] Migrated: ${migrated}, Failed: ${failed}`);

    res.json({
      success: true,
      message: `Successfully migrated ${migrated} variant(s)`,
      migrated,
      failed,
      inventory: migratedInventory,
    });
  } catch (error) {
    console.error('[Admin API] Error during migration:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/bookings
 *
 * Get only confirmed bookings (for calendar view)
 * Filters out pending and cancelled bookings
 *
 * Response:
 * {
 *   "success": true,
 *   "bookings": [...]
 * }
 */
router.get('/bookings', requireJwtAuth, async (req, res) => {
  try {
    // Get ALL bookings (including cancelled) for admin view
    const bookings = await bookingService.getAllBookings();

    res.json({
      success: true,
      bookings,
      totalCount: bookings.length
    });
  } catch (error) {
    console.error('[Admin API] Error fetching bookings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bookings',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/bookings
 *
 * Create a manual booking from admin panel
 *
 * Body:
 * {
 *   "variantGid": "gid://shopify/ProductVariant/...",
 *   "productTitle": "Premium Fotobox",
 *   "variantTitle": "Weiß",
 *   "customerEmail": "kunde@example.com",
 *   "customerName": "Max Mustermann",
 *   "eventDate": "2025-12-28",
 *   "startDate": "2025-12-28",
 *   "endDate": "2025-12-28",
 *   "totalDays": 1,
 *   "orderId": "#1234" (optional)
 * }
 */
router.post('/bookings', requireJwtAuth, async (req, res) => {
  try {
    const {
      variantGid,
      productTitle,
      variantTitle,
      customerEmail,
      customerName,
      eventDate,
      startDate,
      endDate,
      totalDays,
      orderId,
      note,
      status
    } = req.body;

    // Validate required fields
    if (!variantGid || !productTitle || !variantTitle || !customerEmail || !eventDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: variantGid, productTitle, variantTitle, customerEmail, eventDate'
      });
    }

    // Create or update customer in database
    const { v4: uuidv4 } = await import('uuid');

    let existingCustomer = await customerQueries.getByEmail(customerEmail);

    if (!existingCustomer && customerName) {
      // Parse name into first/last name
      const nameParts = customerName.trim().split(' ');
      const firstName = nameParts[0] || 'Unbekannt';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Create new customer
      try {
        await customerQueries.create(          uuidv4(), // customer_id
          firstName,
          lastName,
          customerEmail,
          null, // phone
          null, // street
          null, // postal_code
          null, // city
          'DE', // country
          null  // shopify_customer_id
        );
        console.log(`[Admin API] Created new customer: ${customerName} (${customerEmail})`);
      } catch (error) {
        // If customer creation fails (e.g., duplicate email), continue anyway
        console.warn(`[Admin API] Could not create customer: ${error.message}`);
      }
    }

    // Create booking
    const booking = await bookingService.createBooking({
      variantId: variantGid,
      productTitle,
      variantTitle,
      customerEmail,
      customerName,
      eventDate,
      startDate: startDate || eventDate,
      endDate: endDate || eventDate,
      totalDays: totalDays || 1,
      note
    });

    // Conditionally confirm based on status parameter
    // If status is 'confirmed', confirm immediately; otherwise leave as 'pending'
    if (status === 'confirmed') {
      await bookingService.confirmBooking(booking.id, orderId || `MANUAL-${Date.now()}`);
    }

    console.log(`[Admin API] Manual booking created: ${booking.id} by ${req.user.username}`);
    console.log(`  - Product: ${productTitle} - ${variantTitle}`);
    console.log(`  - Customer: ${customerName || customerEmail}`);
    console.log(`  - Date: ${eventDate}`);
    console.log(`  - Status: ${status || 'pending'}`);
    if (note) console.log(`  - Note: ${note}`);

    res.json({
      success: true,
      message: 'Booking created successfully',
      booking: {
        id: booking.id,
        eventDate,
        productTitle,
        variantTitle,
        customerEmail,
        status: status || 'pending'
      }
    });
  } catch (error) {
    console.error('[Admin API] Error creating manual booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create booking',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/bookings/:bookingId/order-status
 *
 * Check if a booking's order still exists in the database
 */
router.get('/bookings/:bookingId/order-status', requireJwtAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await bookingService.getBooking(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    const orderId = booking.order_id || booking.orderId;

    if (!orderId) {
      return res.json({
        success: true,
        hasOrder: false,
        isDeletable: true
      });
    }

    // Check if order exists
    const orderCheckResult = await pool.query('SELECT id FROM orders WHERE shopify_order_id = $1', [orderId]);
    const order = orderCheckResult.rows[0];

    res.json({
      success: true,
      hasOrder: !!order,
      isDeletable: !order, // Can delete if order doesn't exist
      orderId: orderId
    });
  } catch (error) {
    console.error('[Admin API] Error checking order status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check order status'
    });
  }
});

/**
 * DELETE /api/admin/bookings/cleanup
 *
 * Delete all cancelled and pending bookings from database
 * This is useful for cleaning up test data or old abandoned bookings
 * NOTE: This MUST come BEFORE the /bookings/:bookingId route!
 */
router.delete('/bookings/cleanup', requireJwtAuth, async (req, res) => {
  try {
    console.log(`[Admin API] Cleaning up cancelled and pending bookings by ${req.user.username}`);

    // Get count before deletion
    const countResult = await pool.query(
      "SELECT COUNT(*) as count FROM bookings WHERE status IN ($1, $2)",
      ['cancelled', 'pending']
    );
    const beforeCount = countResult.rows[0];

    console.log(`[Admin API] Found ${beforeCount.count} cancelled/pending bookings to delete`);

    // Delete all cancelled and pending bookings
    const deleteResult = await pool.query(
      "DELETE FROM bookings WHERE status IN ($1, $2)",
      ['cancelled', 'pending']
    );

    const deletedCount = deleteResult.rowCount;
    console.log(`[Admin API] ✓ Deleted ${deletedCount} bookings`);

    res.json({
      success: true,
      deletedCount: deletedCount,
      message: `${deletedCount} cancelled/pending bookings deleted from database`
    });
  } catch (error) {
    console.error('[Admin API] Error cleaning up bookings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup bookings',
      message: error.message
    });
  }
});

/**
 * DELETE /api/admin/bookings/delete-all
 *
 * DANGER: Delete ALL bookings and orders from the database
 * This is for development/testing purposes only
 * NOTE: This MUST come BEFORE the /bookings/:bookingId route!
 */
router.delete('/bookings/delete-all', requireJwtAuth, async (req, res) => {
  try {
    console.log(`[Admin API] ⚠️  DELETE ALL BOOKINGS AND ORDERS requested by ${req.user.username}`);

    // Get counts before deletion
    const bookingsCountResult = await pool.query('SELECT COUNT(*) as count FROM bookings');
    const ordersCountResult = await pool.query('SELECT COUNT(*) as count FROM orders');
    const bookingsCount = bookingsCountResult.rows[0];
    const ordersCount = ordersCountResult.rows[0];

    console.log(`[Admin API] Found ${bookingsCount.count} bookings and ${ordersCount.count} orders to delete`);

    // Delete all bookings (CASCADE will handle related data)
    console.log('[Admin API] Deleting all bookings...');
    const bookingsResult = await pool.query('DELETE FROM bookings');
    const deletedBookings = bookingsResult.rowCount;

    // Delete all orders (CASCADE will handle order_items and order_status_history)
    console.log('[Admin API] Deleting all orders...');
    const ordersResult = await pool.query('DELETE FROM orders');
    const deletedOrders = ordersResult.rowCount;

    // Reset customer stats
    console.log('[Admin API] Resetting customer stats...');
    await pool.query(`
      UPDATE customers
      SET total_orders = 0,
          total_revenue = 0,
          updated_at = CURRENT_TIMESTAMP
    `);

    console.log(`[Admin API] ✓ Deleted ${deletedBookings} bookings and ${deletedOrders} orders`);

    res.json({
      success: true,
      deletedBookings,
      deletedOrders,
      message: `All data deleted: ${deletedBookings} bookings, ${deletedOrders} orders`
    });
  } catch (error) {
    console.error('[Admin API] Error deleting all bookings/orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete all data',
      message: error.message
    });
  }
});

/**
 * DELETE /api/admin/bookings/:bookingId
 *
 * Delete an orphaned booking (booking without order_id or whose order was deleted)
 * This is for cleaning up old bookings that don't have associated orders
 */
router.delete('/bookings/:bookingId', requireJwtAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;

    console.log(`[Admin API] Delete request for booking: ${bookingId} by ${req.user.username}`);

    // Get booking to check if it has an order_id
    const booking = await bookingService.getBooking(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    // Check if booking has an order_id
    const orderId = booking.order_id || booking.orderId;

    if (orderId) {
      // Check if the order actually exists in the database
      const orderCheckResult = await pool.query('SELECT id FROM orders WHERE shopify_order_id = $1', [orderId]);
      const order = orderCheckResult.rows[0];

      if (order) {
        // Order exists - cannot delete booking directly
        console.log(`[Admin API] Booking ${bookingId} has order ${orderId} - cannot delete directly`);
        return res.status(400).json({
          success: false,
          error: 'Cannot delete booking with associated order. Cancel the order instead.'
        });
      } else {
        // Order doesn't exist anymore - this is an orphaned booking, allow deletion
        console.log(`[Admin API] Booking ${bookingId} has order_id ${orderId} but order not found in DB - treating as orphaned`);
      }
    }

    // Delete the booking
    await bookingService.deleteBooking(bookingId);

    console.log(`[Admin API] ✓ Orphaned booking deleted: ${bookingId}`);

    res.json({
      success: true,
      message: 'Booking deleted successfully'
    });
  } catch (error) {
    console.error('[Admin API] Error deleting booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete booking',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/customers/recalculate-stats
 *
 * Recalculate total_orders and total_revenue for all customers
 * based on actual orders in the database
 */
router.post('/customers/recalculate-stats', requireJwtAuth, async (req, res) => {
  try {
    console.log(`[Admin API] Recalculating customer stats by ${req.user.username}`);

    // Reset all counts to 0
    console.log('[Admin API] Step 1: Resetting all customer counts to 0...');
    await pool.query(`
      UPDATE customers
      SET total_orders = 0,
          total_revenue = 0,
          updated_at = CURRENT_TIMESTAMP
    `);
    console.log('[Admin API] ✓ Step 1 complete');

    // Update counts based on actual orders (excluding cancelled/refunded)
    console.log('[Admin API] Step 2: Recalculating counts from actual orders...');
    await pool.query(`
      UPDATE customers
      SET total_orders = (
          SELECT COUNT(*)
          FROM orders
          WHERE orders.customer_id = customers.id
            AND orders.status != 'cancelled'
            AND orders.financial_status != 'refunded'
        ),
        total_revenue = (
          SELECT COALESCE(SUM(total_amount), 0)
          FROM orders
          WHERE orders.customer_id = customers.id
            AND orders.status != 'cancelled'
            AND orders.financial_status != 'refunded'
        ),
        updated_at = CURRENT_TIMESTAMP
    `);
    console.log('[Admin API] ✓ Step 2 complete');

    // Get updated stats
    console.log('[Admin API] Step 3: Fetching updated customer stats...');
    const selectResult = await pool.query(`
      SELECT
        id,
        email,
        first_name,
        last_name,
        total_orders,
        total_revenue
      FROM customers
      WHERE total_orders > 0 OR total_revenue > 0
      ORDER BY total_orders DESC
    `);
    const updatedCustomers = selectResult.rows;

    console.log(`[Admin API] ✓ Customer stats recalculated for ${updatedCustomers.length} customers`);

    res.json({
      success: true,
      message: 'Customer stats recalculated successfully',
      updatedCount: updatedCustomers.length,
      customers: updatedCustomers
    });
  } catch (error) {
    console.error('[Admin API] Error recalculating customer stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to recalculate customer stats',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/backups
 *
 * List all available backups
 * Note: Backups are only available for SQLite. PostgreSQL uses Railway's built-in backup system.
 */
router.get('/backups', requireJwtAuth, async (req, res) => {
  // PostgreSQL backups are managed by Railway's built-in backup system
  return res.status(501).json({
    success: false,
    error: 'Backups not available with PostgreSQL',
    message: 'PostgreSQL backups are managed by Railway. Use Railway dashboard for backup management.'
  });
});

/**
 * POST /api/admin/backups/create
 *
 * Create a manual backup
 * Note: Backups are only available for SQLite. PostgreSQL uses Railway's built-in backup system.
 */
router.post('/backups/create', requireJwtAuth, async (req, res) => {
  // PostgreSQL backups are managed by Railway's built-in backup system
  return res.status(501).json({
    success: false,
    error: 'Backups not available with PostgreSQL',
    message: 'PostgreSQL backups are managed by Railway. Use Railway dashboard for backup management.'
  });
});

/**
 * POST /api/admin/sync/shopify
 *
 * Manually trigger Shopify product sync
 * Syncs product metadata (titles, prices) but NOT inventory quantities
 */
router.post('/sync/shopify', requireJwtAuth, async (req, res) => {
  try {
    console.log('[Admin API] Manual Shopify sync requested by:', req.user.username);

    // Dynamically import to avoid circular dependencies
    const { default: shopifySync } = await import('../services/shopifySync.js');

    const result = await shopifySync.manualSync();

    res.json({
      success: true,
      message: 'Shopify sync completed',
      result
    });
  } catch (error) {
    console.error('[Admin API] Error syncing with Shopify:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync with Shopify',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/settings
 *
 * Get settings including calendar secret
 */
router.get('/settings', requireJwtAuth, (req, res) => {
  try {
    res.json({
      success: true,
      settings: {
        calendarSecret: process.env.CALENDAR_SECRET,
        hasCalendarSecret: !!process.env.CALENDAR_SECRET
      }
    });
  } catch (error) {
    console.error('[Admin API] Error fetching settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settings',
      message: error.message
    });
  }
});

// ============================================
// Photo Strip Management Endpoints
// ============================================

/**
 * POST /api/admin/photo-strips/create-test
 * Create a test photo strip for development
 */
router.post('/photo-strips/create-test', requireJwtAuth, async (req, res) => {
  try {
    console.log('[TEST] Starting test photo strip creation...');

    const crypto = await import('crypto');
    const { v4: uuidv4 } = await import('uuid');

    const { email = 'test@youmephoto.com', bookingId = `test_${Date.now()}` } = req.body;

    // Generate unique IDs
    const stripId = uuidv4();
    const accessToken = crypto.randomBytes(32).toString('hex');

    // Set expiry to 30 days from now for testing
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    const defaultDesignData = JSON.stringify({
      version: '5.3.0',
      objects: [],
      background: '#ffffff'
    });

    // Insert photo strip
    await pool.query(`
      INSERT INTO photo_strips (
        strip_id, booking_id, customer_email,
        design_data, status, access_token, access_expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [stripId, bookingId, email, defaultDesignData, 'draft', accessToken, expiryDate.toISOString()]);

    console.log('[TEST] Photo strip created successfully');

    const editorUrl = `${process.env.FRONTEND_URL}/photo-strip-editor?strip=${stripId}&token=${accessToken}`;

    res.json({
      success: true,
      stripId: stripId,
      accessToken: accessToken,
      editorUrl: editorUrl,
      expiresAt: expiryDate.toISOString()
    });
  } catch (error) {
    console.error('Error creating test photo strip:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create test photo strip',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/migrate-photo-strips
 * Run photo strips migration manually
 */
router.post('/migrate-photo-strips', requireJwtAuth, async (req, res) => {
  try {
    // Dynamic import to run migration
    const { execSync } = await import('child_process');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const scriptPath = path.join(__dirname, '../scripts/migrate-photo-strips.js');

    console.log('Running photo strips migration...');
    const output = execSync(`node ${scriptPath}`, { encoding: 'utf-8' });

    res.json({
      success: true,
      message: 'Photo strips migration completed',
      output: output
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: error.message
    });
  }
});

// ============================================
// SHIPPING MANAGEMENT ENDPOINTS
// ============================================

/**
 * GET /api/admin/bookings/upcoming
 * Get all upcoming bookings (not yet shipped or in shipping process)
 */
router.get('/bookings/upcoming', requireJwtAuth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const allBookings = await bookingsQueries.getAll();
    const upcomingBookings = allBookings.filter(booking => {
      if (booking.status !== 'confirmed') return false;

      const shippingStatus = booking.shipping_status || 'not_shipped';
      if (!['not_shipped', 'preparing'].includes(shippingStatus)) return false;

      const startDate = new Date(booking.start_date || booking.event_date);
      return startDate >= today;
    }).sort((a, b) => {
      const dateA = new Date(a.start_date || a.event_date);
      const dateB = new Date(b.start_date || b.event_date);
      return dateA - dateB;
    });

    // Transform to camelCase and enrich with order/customer data
    const enrichedBookings = await Promise.all(upcomingBookings.map(async booking => {
      const customer = await customerQueries.getByEmail(booking.customer_email);

      // Get order to retrieve shipping address
      let order = null;
      let shippingAddress = null;

      if (booking.order_id) {
        // booking.order_id contains Shopify GID, need to use getByShopifyOrderId
        order = await orderQueries.getByShopifyOrderId(booking.order_id);
        console.log(`[DEBUG] Order for booking ${booking.booking_id}:`, order ? {
          order_id: order.order_id,
          shipping_name: order.shipping_name,
          shipping_address1: order.shipping_address1,
          shipping_address2: order.shipping_address2,
          shipping_zip: order.shipping_zip,
          shipping_city: order.shipping_city,
          shipping_country: order.shipping_country,
          shipping_phone: order.shipping_phone
        } : 'No order found');

        if (order) {
          // Check if order has complete shipping address
          const hasCompleteAddress = order.shipping_address1 && order.shipping_zip && order.shipping_city;
          console.log(`[DEBUG] Has complete address:`, hasCompleteAddress);

          if (hasCompleteAddress) {
            shippingAddress = {
              name: order.shipping_name,
              street: order.shipping_address1,
              street_number: order.shipping_address2 || '',
              postal_code: order.shipping_zip,
              city: order.shipping_city,
              province: order.shipping_province,
              country: order.shipping_country || 'Deutschland',
              phone: order.shipping_phone
            };
            console.log(`[DEBUG] Constructed shippingAddress:`, shippingAddress);
          }
        }
      }

      return {
        bookingId: booking.booking_id,
        variantId: booking.variant_gid,
        eventDate: booking.event_date,
        startDate: booking.start_date || booking.event_date,
        endDate: booking.end_date || booking.event_date,
        totalDays: booking.total_days || 1,
        status: booking.status,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: customer?.phone || shippingAddress?.phone,
        orderId: booking.order_id,
        createdAt: booking.created_at,
        updatedAt: booking.updated_at,
        productTitle: booking.product_title,
        variantTitle: booking.variant_title,
        shippingStatus: booking.shipping_status || 'not_shipped',
        trackingNumber: booking.tracking_number,
        shippedAt: booking.shipped_at,
        labelUrl: booking.shipping_label_url,
        shippingAddress: shippingAddress
      };
    }));

    res.json({ bookings: enrichedBookings });
  } catch (error) {
    console.error('Error getting upcoming bookings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/bookings/critical
 * Get critical bookings (7 days before event, not yet shipped)
 */
router.get('/bookings/critical', requireJwtAuth, async (req, res) => {
  try {
    const criticalDate = new Date();
    const daysBeforeEvent = parseInt(process.env.CRITICAL_DAYS_BEFORE_EVENT);
    criticalDate.setDate(criticalDate.getDate() + daysBeforeEvent);

    const allBookings = await bookingsQueries.getAll();
    const criticalBookings = allBookings.filter(booking => {
      if (booking.status !== 'confirmed') return false;

      const shippingStatus = booking.shipping_status || 'not_shipped';
      if (!['not_shipped', 'preparing'].includes(shippingStatus)) return false;

      const startDate = new Date(booking.start_date || booking.event_date);
      return startDate <= criticalDate;
    }).sort((a, b) => {
      const dateA = new Date(a.start_date || a.event_date);
      const dateB = new Date(b.start_date || b.event_date);
      return dateA - dateB;
    });

    res.json({ bookings: criticalBookings });
  } catch (error) {
    console.error('Error getting critical bookings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/bookings/:bookingId/shipping/create-label
 * Create DHL shipping label
 */
router.post('/bookings/:bookingId/shipping/create-label', requireJwtAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;

    const shippingService = (await import('../services/shippingService.js')).default;
    const result = await shippingService.createLabel(bookingId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to create shipping label'
      });
    }

    res.json({
      success: true,
      labelUrl: `/uploads/${result.labelUrl}`,
      trackingNumber: result.trackingNumber
    });
  } catch (error) {
    console.error('Error creating shipping label:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/bookings/:bookingId/shipping/mark-shipped
 * Mark booking as shipped (triggers email)
 */
router.post('/bookings/:bookingId/shipping/mark-shipped', requireJwtAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;

    const shippingService = (await import('../services/shippingService.js')).default;
    await shippingService.markAsShipped(bookingId);

    res.json({ success: true, message: 'Booking marked as shipped' });
  } catch (error) {
    console.error('Error marking as shipped:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/bookings/:bookingId/shipping/history
 * Get shipping history for booking
 */
router.get('/bookings/:bookingId/shipping/history', requireJwtAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;

    const shippingService = (await import('../services/shippingService.js')).default;
    const history = shippingService.getShippingHistory(bookingId);

    res.json({ history });
  } catch (error) {
    console.error('Error getting shipping history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/bookings/:bookingId/shipping/status
 * Update shipping status manually (for returns, etc.)
 */
router.patch('/bookings/:bookingId/shipping/status', requireJwtAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { shipping_status } = req.body;

    if (!shipping_status) {
      return res.status(400).json({ error: 'shipping_status required' });
    }

    const validStatuses = ['not_shipped', 'preparing', 'shipped', 'delivered', 'returned', 'overdue'];
    if (!validStatuses.includes(shipping_status)) {
      return res.status(400).json({ error: 'Invalid shipping status' });
    }

    const shippingService = (await import('../services/shippingService.js')).default;
    const timestamp = shipping_status === 'returned' ? 'returned' : null;
    shippingService.updateShippingStatus(bookingId, shipping_status, timestamp);

    res.json({ success: true, message: 'Shipping status updated' });
  } catch (error) {
    console.error('Error updating shipping status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/customers/by-email/:email
 * Update customer data by email (for shipping modal)
 */
router.put('/customers/by-email/:email', requireJwtAuth, async (req, res) => {
  try {
    const { email } = req.params;
    const { name, phone, street, street_number, postal_code, city, country } = req.body;

    // Find customer by email
    const customer = await customerQueries.getByEmail(email);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Update customer data
    await pool.query(`
      UPDATE customers
      SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        street = COALESCE($3, street),
        street_number = COALESCE($4, street_number),
        postal_code = COALESCE($5, postal_code),
        city = COALESCE($6, city),
        country = COALESCE($7, country),
        updated_at = CURRENT_TIMESTAMP
      WHERE email = $8
    `, [name || null, phone || null, street || null, street_number || null, postal_code || null, city || null, country || null, email]);

    res.json({ success: true, message: 'Customer data updated' });
  } catch (error) {
    console.error('Error updating customer data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/shipping/run-overdue-check
 * Manually trigger overdue returns check (for testing)
 */
router.post('/shipping/run-overdue-check', requireJwtAuth, async (req, res) => {
  try {
    const shippingService = (await import('../services/shippingService.js')).default;
    const count = await shippingService.checkOverdueReturns();

    res.json({
      success: true,
      message: `Processed ${count} overdue returns`,
      count
    });
  } catch (error) {
    console.error('Error running overdue check:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DISCOUNT CODES ENDPOINTS
// ============================================

/**
 * GET /api/admin/discount-codes
 * Get all discount codes with optional filters
 *
 * Query params:
 * - status: 'active' | 'inactive' | 'expired' | 'deleted' | 'all'
 * - type: 'percentage' | 'fixed_amount' | 'free_shipping' | 'all'
 * - search: string (searches in code and title)
 */
router.get('/discount-codes', requireJwtAuth, async (req, res) => {
  try {
    const { status, type, search } = req.query;

    const filters = {
      status: status && status !== 'all' ? status : undefined,
      type: type && type !== 'all' ? type : undefined,
      search: search || undefined,
    };

    const discounts = await discountService.getAllDiscounts(filters);

    res.json({
      success: true,
      discounts,
      count: discounts.length,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching discount codes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch discount codes',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/discount-codes/:id
 * Get single discount code with details
 */
router.get('/discount-codes/:id', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const discount = await discountService.getDiscount(parseInt(id, 10));

    if (!discount) {
      return res.status(404).json({
        success: false,
        error: 'Discount code not found',
      });
    }

    res.json({
      success: true,
      discount,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching discount code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch discount code',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/discount-codes
 * Create new discount code
 *
 * Body:
 * {
 *   "code": "SUMMER25",
 *   "title": "Summer Sale 2025",
 *   "description": "25% off all products",
 *   "discount_type": "percentage",
 *   "value": 25.0,
 *   "usage_limit": 100,
 *   "usage_limit_per_customer": 1,
 *   "minimum_purchase_amount": 50.0,
 *   "starts_at": "2025-06-01T00:00:00Z",
 *   "ends_at": "2025-08-31T23:59:59Z",
 *   "applies_to_all_products": true,
 *   "product_variant_gids": []
 * }
 */
router.post('/discount-codes', requireJwtAuth, async (req, res) => {
  try {
    const discountData = req.body;
    const createdBy = req.user.username;

    // Validate required fields
    if (!discountData.code || !discountData.title || !discountData.discount_type || discountData.value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: code, title, discount_type, value',
      });
    }

    const discount = await discountService.createDiscount(discountData, createdBy);

    res.status(201).json({
      success: true,
      discount,
      message: 'Discount code created successfully',
    });
  } catch (error) {
    console.error('[Admin API] Error creating discount code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create discount code',
      message: error.message,
    });
  }
});

/**
 * PUT /api/admin/discount-codes/:id
 * Update discount code
 *
 * Body: Same as POST but all fields optional
 */
router.put('/discount-codes/:id', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const discountData = req.body;

    const discount = await discountService.updateDiscount(parseInt(id, 10), discountData);

    res.json({
      success: true,
      discount,
      message: 'Discount code updated successfully',
    });
  } catch (error) {
    console.error('[Admin API] Error updating discount code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update discount code',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/admin/discount-codes/:id
 * Delete discount code (soft delete locally, hard delete in Shopify)
 */
router.delete('/discount-codes/:id', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await discountService.deleteDiscount(parseInt(id, 10));

    res.json({
      success: true,
      message: 'Discount code deleted successfully',
    });
  } catch (error) {
    console.error('[Admin API] Error deleting discount code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete discount code',
      message: error.message,
    });
  }
});

/**
 * PATCH /api/admin/discount-codes/:id/toggle
 * Aktiviert oder deaktiviert einen Rabattcode
 */
router.patch('/discount-codes/:id/toggle', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    if (typeof active !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid "active" parameter (must be boolean)',
      });
    }

    const discount = await discountService.toggleDiscountStatus(parseInt(id, 10), active);

    res.json({
      success: true,
      discount,
      message: `Discount code ${active ? 'activated' : 'deactivated'} successfully`,
    });
  } catch (error) {
    console.error('[Admin API] Error toggling discount code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle discount code',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/discount-codes/:id/analytics
 * Get analytics for a discount code
 *
 * Query params:
 * - start_date: ISO date string
 * - end_date: ISO date string
 */
router.get('/discount-codes/:id/analytics', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date } = req.query;

    const dateRange = {};
    if (start_date) dateRange.start = start_date;
    if (end_date) dateRange.end = end_date;

    const analytics = await discountService.getAnalytics(parseInt(id, 10), dateRange);

    res.json({
      success: true,
      analytics,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching discount analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/discount-codes/:id/usage-history
 * Get usage history for a discount code
 *
 * Query params:
 * - limit: number (default 100)
 * - offset: number (default 0)
 */
router.get('/discount-codes/:id/usage-history', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    const history = await discountService.getUsageHistory(parseInt(id, 10), { limit, offset });

    res.json({
      success: true,
      history,
      count: history.length,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching usage history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage history',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/discount-codes/sync
 * Manually trigger sync from Shopify
 */
router.post('/discount-codes/sync', requireJwtAuth, async (req, res) => {
  try {
    const result = await discountSyncService.syncFromShopify();

    res.json({
      success: result.success,
      synced: result.synced,
      imported: result.imported,
      updated: result.updated,
      deleted: result.deleted,
      errors: result.errors,
      message: result.success
        ? `Synced ${result.synced} discount code(s) from Shopify`
        : `Sync failed: ${result.error}`,
    });
  } catch (error) {
    console.error('[Admin API] Error syncing discount codes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync discount codes',
      message: error.message,
    });
  }
});

export default router;
