import express from 'express';

const router = express.Router();

/**
 * GET /api/config/booking
 *
 * Gibt Booking-Konfiguration zurück
 * - softLockMinutes: Wie lange eine PENDING Reservierung gültig ist
 */
router.get('/booking', (req, res) => {
  try {
    const config = {
      softLockMinutes: parseInt(process.env.SOFT_LOCK_MINUTES || '30'),
      pendingTimeoutHours: parseInt(process.env.PENDING_TIMEOUT_HOURS || '2'),
      minLeadTimeDays: parseInt(process.env.MIN_LEAD_TIME_DAYS || '4'),
      bufferBefore: parseInt(process.env.SHIPPING_BUFFER_BEFORE || '2'),
      bufferAfter: parseInt(process.env.SHIPPING_BUFFER_AFTER || '2'),
    };

    res.json(config);
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

export default router;
