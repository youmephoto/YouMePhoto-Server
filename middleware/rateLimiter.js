import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter
 * 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Skip rate limiting for localhost in development
  skip: (req) => {
    if (process.env.NODE_ENV === 'development' && req.ip === '::1') {
      return true;
    }
    return false;
  }
});

/**
 * Strict rate limiter for booking/reservation endpoints
 * 10 requests per 15 minutes per IP
 * Prevents spam and abuse of the reservation system
 */
export const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 reservation attempts per 15 minutes (erhöht für Testing)
  message: {
    success: false,
    error: 'Too many booking attempts. Please wait before trying again.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting in development or for localhost
    if (process.env.NODE_ENV === 'development') {
      return true;
    }
    // Also skip for Shopify's IP during testing
    if (req.ip === '::1' || req.ip === '127.0.0.1' || req.ip.startsWith('::ffff:127.0.0')) {
      return true;
    }
    return false;
  },
  // Custom handler for rate limit exceeded
  handler: (req, res) => {
    console.warn(`[Rate Limit] Booking limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Zu viele Buchungsversuche. Bitte versuchen Sie es später erneut.',
      retryAfter: '15 Minuten'
    });
  }
});

/**
 * Rate limiter for admin endpoints
 * 500 requests per 15 minutes per IP (generous for admin panel usage)
 */
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // Erhöht von 60 auf 500 - Admin Panel macht viele Requests
  message: {
    success: false,
    error: 'Too many admin requests.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip in development for easier testing
    if (process.env.NODE_ENV === 'development') {
      return true;
    }
    return false;
  }
});

/**
 * Webhook rate limiter
 * More permissive for Shopify webhooks
 * 200 requests per 15 minutes
 */
export const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    error: 'Webhook rate limit exceeded'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Webhooks come from Shopify IPs, so we trust them more
  skip: (req) => {
    // In production, you might want to validate Shopify IPs here
    return false;
  }
});

/**
 * Calendar feed rate limiter
 * Moderate limits for calendar subscriptions
 * 30 requests per hour (calendars poll every 1-24 hours typically)
 */
export const calendarLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: 'Calendar feed rate limit exceeded. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (process.env.NODE_ENV === 'development') {
      return true; // Allow unlimited in dev
    }
    return false;
  }
});

export default {
  apiLimiter,
  bookingLimiter,
  adminLimiter,
  webhookLimiter,
  calendarLimiter
};
