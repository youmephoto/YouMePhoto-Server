import express from 'express';
import BookingService from '../services/bookingService.js';

const router = express.Router();
const bookingService = new BookingService();

/**
 * POST /api/bookings/reserve
 *
 * Erstellt eine neue Reservierung mit Email (Lead Capture)
 *
 * Body:
 * {
 *   "variantId": "gid://shopify/ProductVariant/123",
 *   "eventDate": "2024-12-15",
 *   "customerEmail": "kunde@example.com"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "booking": {
 *     "id": "uuid",
 *     "variantId": "...",
 *     "eventDate": "2024-12-15",
 *     "customerEmail": "kunde@example.com",
 *     "status": "pending"
 *   }
 * }
 */
router.post('/reserve', async (req, res) => {
  try {
    const { variantId, eventDate, customerEmail } = req.body;

    // Validation
    if (!variantId || !eventDate || !customerEmail) {
      return res.status(400).json({
        success: false,
        error: 'variantId, eventDate, and customerEmail are required',
      });
    }

    // Email-Format validieren
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
      });
    }

    // Datum-Format validieren
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(eventDate)) {
      return res.status(400).json({
        success: false,
        error: 'eventDate must be in format YYYY-MM-DD',
      });
    }

    // Prüfe ob Datum in der Zukunft liegt
    const { isInFuture } = await import('../utils/dateHelpers.js');
    if (!isInFuture(eventDate)) {
      return res.status(400).json({
        success: false,
        error: 'eventDate must be in the future',
      });
    }

    // Reservierung erstellen mit Email für Lead Capture
    const result = await bookingService.createReservation(
      variantId,
      eventDate,
      customerEmail
    );

    if (!result.success) {
      return res.status(409).json(result);
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Error in reserve route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create reservation',
      message: error.message,
    });
  }
});

/**
 * POST /api/bookings/confirm
 *
 * Bestätigt eine Reservierung nach Zahlung
 *
 * Body:
 * {
 *   "bookingId": "uuid",
 *   "orderId": "gid://shopify/Order/456"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "status": "confirmed"
 * }
 */
router.post('/confirm', async (req, res) => {
  try {
    const { bookingId, orderId } = req.body;

    // Validation
    if (!bookingId || !orderId) {
      return res.status(400).json({
        success: false,
        error: 'bookingId and orderId are required',
      });
    }

    // Reservierung bestätigen
    const result = await bookingService.confirmReservation(bookingId, orderId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error in confirm route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm reservation',
      message: error.message,
    });
  }
});

/**
 * GET /api/bookings/:id
 *
 * Holt Details einer Buchung
 * Security: Requires email query param to prevent IDOR
 *
 * Response:
 * {
 *   "success": true,
 *   "booking": { ... }
 * }
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    // Security: Email required for authorization (prevent IDOR)
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email parameter required for authorization',
        hint: 'Usage: GET /api/bookings/:id?email=customer@example.com'
      });
    }

    const booking = await bookingService.getBooking(id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found',
      });
    }

    // Security: Verify booking ownership
    if (booking.customerEmail !== email) {
      console.warn(`[Security] Unauthorized booking access attempt: ${id} by ${email} (owner: ${booking.customerEmail})`);
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: You can only view your own bookings',
        code: 'FORBIDDEN'
      });
    }

    res.json({
      success: true,
      booking,
    });
  } catch (error) {
    console.error('Error in get booking route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get booking',
      message: error.message,
    });
  }
});

/**
 * POST /api/bookings/:id/cancel
 *
 * Storniert eine Buchung (POST-Alternative zum DELETE-Endpoint)
 * Wird vom Cart-Frontend verwendet, da POST in Shopify-Themes besser unterstützt wird
 *
 * Body (optional):
 * {
 *   "reason": "Removed from cart by customer"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "status": "cancelled",
 *   "message": "Buchung wurde storniert."
 * }
 */
router.post('/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    console.log(`[Bookings API] Cancelling booking ${id} with reason: ${reason || 'none'}`);

    const result = await bookingService.cancelBooking(id, reason);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error in cancel booking route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel booking',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/bookings/:id
 *
 * Storniert eine Buchung (DELETE-Methode für Admin/Backend)
 *
 * Body (optional):
 * {
 *   "reason": "Kunde hat abgesagt"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "status": "cancelled",
 *   "message": "Buchung wurde storniert."
 * }
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const result = await bookingService.cancelBooking(id, reason);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error in cancel booking route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel booking',
      message: error.message,
    });
  }
});

/**
 * PATCH /api/bookings/:id/status
 *
 * Aktualisiert den Status einer Buchung
 *
 * Body:
 * {
 *   "status": "shipped",
 *   "trackingNumber": "123456" (optional)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "status": "shipped",
 *   "message": "Status erfolgreich aktualisiert."
 * }
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, ...additionalData } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'status is required',
      });
    }

    const result = await bookingService.updateBookingStatus(
      id,
      status,
      additionalData
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error in update status route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update status',
      message: error.message,
    });
  }
});

/**
 * PATCH /api/bookings/:id/extend
 *
 * Erweitert eine existierende Buchung um zusätzliche Tage
 * Prüft Verfügbarkeit und aktualisiert geblockte Daten
 *
 * Body:
 * {
 *   "additionalDays": 2  // Anzahl der Tage die hinzugefügt werden sollen
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "booking": {
 *     "id": "uuid",
 *     "variantId": "...",
 *     "startDate": "2024-12-15",
 *     "endDate": "2024-12-17",  // erweitert von 15. auf 15.-17.
 *     "totalDays": 3,
 *     "blockedDates": ["2024-12-13", ..., "2024-12-19"]
 *   }
 * }
 */
router.patch('/:id/extend', async (req, res) => {
  try {
    const { id } = req.params;
    const { additionalDays } = req.body;

    if (!additionalDays || additionalDays < 1) {
      return res.status(400).json({
        success: false,
        error: 'additionalDays must be at least 1',
      });
    }

    console.log(`[Bookings API] Extending booking ${id} by ${additionalDays} days`);

    const result = await bookingService.extendBooking(id, additionalDays);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error in extend booking route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extend booking',
      message: error.message,
    });
  }
});

/**
 * POST /api/bookings/check-date-range
 *
 * Prüft Verfügbarkeit für einen Datumsbereich (für Multi-Day Opt-in)
 *
 * Body:
 * {
 *   "variantId": "gid://shopify/ProductVariant/123",
 *   "startDate": "2024-12-15",
 *   "endDate": "2024-12-18",
 *   "excludeBookingId": "abc123" (optional - ignoriert Buffer dieser Buchung)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "availability": [
 *     { "date": "2024-12-15", "available": true },
 *     { "date": "2024-12-16", "available": true },
 *     { "date": "2024-12-17", "available": false },
 *     { "date": "2024-12-18", "available": true }
 *   ]
 * }
 */
router.post('/check-date-range', async (req, res) => {
  try {
    const { variantId, startDate, endDate, excludeBookingId } = req.body;

    if (!variantId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'variantId, startDate, and endDate are required',
      });
    }

    const result = await bookingService.checkDateRangeAvailability(
      variantId,
      startDate,
      endDate,
      excludeBookingId || null // Optional: Ignoriere Buffer dieser Buchung
    );

    res.json(result);
  } catch (error) {
    console.error('Error in check-date-range route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check date range availability',
      message: error.message,
    });
  }
});

/**
 * POST /api/bookings/reserve-multiple
 *
 * Erstellt Reservierungen für mehrere Tage (Multi-Day Booking)
 *
 * Body:
 * {
 *   "variantId": "gid://shopify/ProductVariant/123",
 *   "dates": ["2024-12-15", "2024-12-16", "2024-12-17"],
 *   "customerEmail": "kunde@example.com"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "bookings": [
 *     { "date": "2024-12-15", "bookingId": "uuid-1", "success": true },
 *     { "date": "2024-12-16", "bookingId": "uuid-2", "success": true },
 *     { "date": "2024-12-17", "bookingId": null, "success": false, "error": "Nicht verfügbar" }
 *   ],
 *   "primaryBookingId": "uuid-1"
 * }
 */
router.post('/reserve-multiple', async (req, res) => {
  try {
    const { variantId, dates, customerEmail } = req.body;

    if (!variantId || !dates || !Array.isArray(dates) || dates.length === 0 || !customerEmail) {
      return res.status(400).json({
        success: false,
        error: 'variantId, dates (array), and customerEmail are required',
      });
    }

    // Email-Format validieren
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
      });
    }

    const result = await bookingService.createMultiDayReservation(
      variantId,
      dates,
      customerEmail
    );

    if (!result.success) {
      return res.status(409).json(result);
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('Error in reserve-multiple route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create multi-day reservation',
      message: error.message,
    });
  }
});

/**
 * POST /api/bookings/cleanup
 *
 * Bereinigt abgelaufene Reservierungen (Admin-Endpoint)
 *
 * Response:
 * {
 *   "success": true,
 *   "cleanedCount": 5,
 *   "message": "5 abgelaufene Reservierungen bereinigt"
 * }
 */
router.post('/cleanup', async (req, res) => {
  try {
    const cleanedCount = await bookingService.cleanupExpiredReservations();

    res.json({
      success: true,
      cleanedCount,
      message: `${cleanedCount} abgelaufene Reservierung(en) bereinigt`,
    });
  } catch (error) {
    console.error('Error in cleanup route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup reservations',
      message: error.message,
    });
  }
});

/**
 * PATCH /api/bookings/:id/shorten
 *
 * Verkürzt eine existierende Buchung (reduziert Zusatztage)
 * Wird aufgerufen wenn User Zusatztag-Produkte aus Cart entfernt
 *
 * Body:
 * {
 *   "newTotalDays": 2  // Neue Gesamtzahl der Tage (inkl. Hauptbuchung)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "booking": {
 *     "id": "uuid",
 *     "startDate": "2024-12-15",
 *     "endDate": "2024-12-16",
 *     "totalDays": 2,
 *     "blockedDates": [...]
 *   }
 * }
 */
router.patch('/:id/shorten', async (req, res) => {
  try {
    const { id } = req.params;
    const { newTotalDays } = req.body;

    if (!newTotalDays || newTotalDays < 1) {
      return res.status(400).json({
        success: false,
        error: 'newTotalDays must be at least 1',
      });
    }

    console.log(`[Bookings API] Shortening booking ${id} to ${newTotalDays} days`);

    const result = await bookingService.shortenBooking(id, newTotalDays);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error in shorten booking route:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to shorten booking',
      message: error.message,
    });
  }
});

export default router;
