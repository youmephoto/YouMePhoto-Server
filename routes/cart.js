import express from 'express';
import BookingService from '../services/bookingService.js';

const router = express.Router();
const bookingService = new BookingService();

/**
 * POST /api/cart/validate
 *
 * Validates all bookings in the cart and removes expired ones
 *
 * Body:
 * {
 *   "bookingIds": ["uuid1", "uuid2", ...]
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "validBookings": ["uuid1"],
 *   "expiredBookings": ["uuid2"],
 *   "message": "1 booking(s) expired and need to be removed from cart"
 * }
 */
router.post('/validate', async (req, res) => {
  try {
    const { bookingIds } = req.body;

    if (!bookingIds || !Array.isArray(bookingIds)) {
      return res.status(400).json({
        success: false,
        error: 'bookingIds array is required',
      });
    }

    const validBookings = [];
    const validBookingsWithData = [];
    const expiredBookings = [];
    const notFoundBookings = [];
    const PENDING_TIMEOUT_HOURS = parseFloat(process.env.PENDING_TIMEOUT_HOURS || '2');

    // Check each booking
    for (const bookingId of bookingIds) {
      const booking = await bookingService.getBooking(bookingId);

      if (!booking) {
        notFoundBookings.push(bookingId);
        continue;
      }

      // Check if booking is still valid (PENDING and not expired)
      if (booking.status === 'pending') {
        const createdAt = new Date(booking.createdAt);
        const now = new Date();
        const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60);
        const expiresAt = new Date(createdAt.getTime() + PENDING_TIMEOUT_HOURS * 60 * 60 * 1000);
        const minutesRemaining = Math.max(0, Math.floor((expiresAt - now) / (1000 * 60)));

        if (hoursSinceCreated > PENDING_TIMEOUT_HOURS) {
          // Booking expired - cancel it
          await bookingService.cancelBooking(bookingId, 'Automatic cancellation - cart timeout');
          expiredBookings.push(bookingId);
        } else {
          validBookings.push(bookingId);
          validBookingsWithData.push({
            id: bookingId,
            createdAt: booking.createdAt,
            expiresAt: expiresAt.toISOString(),
            minutesRemaining,
            eventDate: booking.eventDate
          });
        }
      } else if (booking.status === 'confirmed') {
        // Already confirmed bookings are valid
        validBookings.push(bookingId);
        validBookingsWithData.push({
          id: bookingId,
          status: 'confirmed',
          eventDate: booking.eventDate
        });
      } else {
        // Cancelled or other status - treat as expired
        expiredBookings.push(bookingId);
      }
    }

    const hasExpired = expiredBookings.length > 0 || notFoundBookings.length > 0;

    res.json({
      success: true,
      validBookings,
      validBookingsWithData,
      expiredBookings,
      notFoundBookings,
      hasExpired,
      timeoutMinutes: PENDING_TIMEOUT_HOURS * 60,
      message: hasExpired
        ? `${expiredBookings.length + notFoundBookings.length} booking(s) expired and need to be removed from cart`
        : 'All bookings are valid',
    });
  } catch (error) {
    console.error('Error validating cart:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate cart',
      message: error.message,
    });
  }
});

/**
 * GET /api/cart/config
 *
 * Returns current cart timeout configuration
 * Useful for debugging and displaying to users
 */
router.get('/config', async (req, res) => {
  try {
    const PENDING_TIMEOUT_HOURS = parseFloat(process.env.PENDING_TIMEOUT_HOURS || '2');
    const SOFT_LOCK_MINUTES = parseInt(process.env.SOFT_LOCK_MINUTES || '30');

    res.json({
      success: true,
      config: {
        pendingTimeoutHours: PENDING_TIMEOUT_HOURS,
        pendingTimeoutMinutes: PENDING_TIMEOUT_HOURS * 60,
        softLockMinutes: SOFT_LOCK_MINUTES,
      },
      message: `Cart reservations expire after ${PENDING_TIMEOUT_HOURS * 60} minutes`,
    });
  } catch (error) {
    console.error('Error fetching cart config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cart config',
      message: error.message,
    });
  }
});

/**
 * POST /api/cart/cleanup
 *
 * Removes a specific booking from cart (called from frontend)
 * This is a helper endpoint - the actual removal happens in the frontend
 *
 * Body:
 * {
 *   "bookingId": "uuid"
 * }
 */
router.post('/cleanup', async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        error: 'bookingId is required',
      });
    }

    // Cancel the booking
    const result = await bookingService.cancelBooking(
      bookingId,
      'Removed from cart - booking expired'
    );

    res.json(result);
  } catch (error) {
    console.error('Error cleaning up booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup booking',
      message: error.message,
    });
  }
});

export default router;
