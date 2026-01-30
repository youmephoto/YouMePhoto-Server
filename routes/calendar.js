import express from 'express';
import ical from 'ical-generator';
import BookingService from '../services/bookingService.js';
import { prepare } from '../db/database.js';

const router = express.Router();
const bookingService = new BookingService();

// Middleware to verify secret token for public calendar feeds
const verifySecretToken = (req, res, next) => {
  const { secret } = req.params;
  const validSecret = process.env.CALENDAR_SECRET;

  if (!validSecret) {
    console.error('[Calendar] CALENDAR_SECRET not configured');
    return res.status(500).send('Calendar feed not configured');
  }

  if (secret !== validSecret) {
    console.warn(`[Calendar] Invalid secret token attempt: ${secret.substring(0, 10)}...`);
    return res.status(404).send('Not found');
  }

  next();
};

/**
 * GET /api/admin/calendar/:secret/bookings.ics
 *
 * Public calendar feed with secret token (Google Calendar compatible)
 * No authentication required - security through secret URL
 *
 * Usage in Google Calendar:
 * 1. Click "+" next to "Other calendars"
 * 2. Select "From URL"
 * 3. Paste: https://your-domain.com/api/admin/calendar/YOUR_SECRET/bookings.ics
 */
router.get('/:secret/bookings.ics', verifySecretToken, async (req, res) => {
  try {
    const bookings = await bookingService.getConfirmedBookings();

    const calendar = ical({
      name: 'Fotobox Buchungen',
      description: 'Alle bestätigten Fotobox-Buchungen',
      timezone: 'Europe/Berlin',
      ttl: 3600,
      prodId: {
        company: 'Fotobox Rental',
        product: 'Booking Calendar',
        language: 'DE'
      }
    });

    bookings.forEach(booking => {
      const startDate = new Date(booking.startDate || booking.eventDate);
      const endDate = new Date(booking.endDate || booking.eventDate);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      calendar.createEvent({
        start: startDate,
        end: endDate,
        summary: `📸 ${booking.productTitle} - ${booking.variantTitle}`,
        description: [
          `Kunde: ${booking.customerName || 'Kein Name'}`,
          `Email: ${booking.customerEmail}`,
          `Produkt: ${booking.productTitle}`,
          `Variante: ${booking.variantTitle}`,
          booking.orderId ? `Order: ${booking.orderId}` : '',
          '',
          `Buchungs-ID: ${booking.bookingId}`,
          `Erstellt: ${new Date(booking.createdAt).toLocaleString('de-DE')}`,
        ].filter(Boolean).join('\n'),
        location: 'Event-Location (wird vom Kunden definiert)',
        organizer: {
          name: 'Fotobox Rental',
          email: booking.customerEmail
        },
        uid: `booking-${booking.bookingId}@fotobox-rental.com`,
        status: 'CONFIRMED',
        busyStatus: 'BUSY',
        sequence: 0,
        categories: [
          { name: 'Fotobox Booking' },
          { name: booking.productTitle }
        ],
        color: booking.productTitle.includes('Premium') ? 'blue' :
               booking.productTitle.includes('Luxury') ? 'purple' : 'green',
        allDay: true
      });
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="fotobox-bookings.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    res.send(calendar.toString());

    console.log(`[Calendar Feed] Generated secret feed with ${bookings.length} bookings`);
  } catch (error) {
    console.error('[Calendar Feed] Error generating calendar:', error);
    res.status(500).send('Error generating calendar feed');
  }
});

/**
 * GET /api/admin/calendar/:secret/blocked-dates.ics
 *
 * Public blocked dates feed with secret token
 */
router.get('/:secret/blocked-dates.ics', verifySecretToken, async (req, res) => {
  try {
    const query = await prepare(`
      SELECT * FROM blocked_dates
      WHERE end_date >= date('now')
      ORDER BY start_date ASC
    `);
    const blockedDates = await query.all();

    const calendar = ical({
      name: 'Fotobox Sperrtage',
      description: 'Gesperrte Daten für Fotobox-Vermietung',
      timezone: 'Europe/Berlin',
      ttl: 3600,
      prodId: {
        company: 'Fotobox Rental',
        product: 'Blocked Dates Calendar',
        language: 'DE'
      }
    });

    blockedDates.forEach(block => {
      const startDate = new Date(block.start_date);
      const endDate = new Date(block.end_date);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      calendar.createEvent({
        start: startDate,
        end: endDate,
        summary: `🚫 Gesperrt${block.reason ? `: ${block.reason}` : ''}`,
        description: [
          'Dieser Zeitraum ist für Buchungen gesperrt.',
          block.reason ? `Grund: ${block.reason}` : '',
          '',
          `Gesperrt am: ${new Date(block.created_at).toLocaleString('de-DE')}`,
        ].filter(Boolean).join('\n'),
        uid: `blocked-${block.id}@fotobox-rental.com`,
        status: 'CONFIRMED',
        busyStatus: 'FREE',
        categories: [{ name: 'Blocked Date' }],
        color: 'red',
        allDay: true
      });
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="fotobox-blocked-dates.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    res.send(calendar.toString());

    console.log(`[Calendar Feed] Generated secret blocked dates feed with ${blockedDates.length} blocks`);
  } catch (error) {
    console.error('[Calendar Feed] Error generating blocked dates calendar:', error);
    res.status(500).send('Error generating calendar feed');
  }
});

/**
 * GET /api/admin/calendar/bookings.ics
 *
 * Returns an iCal feed of all confirmed bookings
 * Subscribe to this URL in Google Calendar, Apple Calendar, Outlook, etc.
 *
 * Usage in Google Calendar:
 * 1. Click "+" next to "Other calendars"
 * 2. Select "From URL"
 * 3. Paste: https://your-domain.com/api/admin/calendar/bookings.ics
 *
 * Auth: Uses Basic Auth (same as admin panel)
 */
router.get('/bookings.ics', async (req, res) => {
  try {
    // Basic Auth check
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Calendar Feed"');
      return res.status(401).send('Authentication required');
    }

    // Get all confirmed bookings
    const bookings = await bookingService.getConfirmedBookings();

    // Create calendar
    const calendar = ical({
      name: 'Fotobox Buchungen',
      description: 'Alle bestätigten Fotobox-Buchungen',
      timezone: 'Europe/Berlin',
      ttl: 3600, // Refresh every hour
      prodId: {
        company: 'Fotobox Rental',
        product: 'Booking Calendar',
        language: 'DE'
      }
    });

    // Add each booking as an event
    bookings.forEach(booking => {
      const startDate = new Date(booking.startDate || booking.eventDate);
      const endDate = new Date(booking.endDate || booking.eventDate);

      // Set time to full day (00:00 - 23:59)
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      calendar.createEvent({
        start: startDate,
        end: endDate,
        summary: `📸 ${booking.productTitle} - ${booking.variantTitle}`,
        description: [
          `Kunde: ${booking.customerName || 'Kein Name'}`,
          `Email: ${booking.customerEmail}`,
          `Produkt: ${booking.productTitle}`,
          `Variante: ${booking.variantTitle}`,
          booking.orderId ? `Order: ${booking.orderId}` : '',
          '',
          `Buchungs-ID: ${booking.bookingId}`,
          `Erstellt: ${new Date(booking.createdAt).toLocaleString('de-DE')}`,
        ].filter(Boolean).join('\n'),
        location: 'Event-Location (wird vom Kunden definiert)',
        organizer: {
          name: 'Fotobox Rental',
          email: booking.customerEmail
        },
        uid: `booking-${booking.bookingId}@fotobox-rental.com`,
        status: 'CONFIRMED',
        busyStatus: 'BUSY',
        sequence: 0,
        categories: [
          { name: 'Fotobox Booking' },
          { name: booking.productTitle }
        ],
        // Color coding (works in some calendar apps)
        color: booking.productTitle.includes('Premium') ? 'blue' :
               booking.productTitle.includes('Luxury') ? 'purple' : 'green',
        allDay: true
      });
    });

    // Set proper headers for calendar subscription
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="fotobox-bookings.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Send calendar
    res.send(calendar.toString());

    console.log(`[Calendar Feed] Generated feed with ${bookings.length} bookings`);
  } catch (error) {
    console.error('[Calendar Feed] Error generating calendar:', error);
    res.status(500).send('Error generating calendar feed');
  }
});

/**
 * GET /api/admin/calendar/blocked-dates.ics
 *
 * Returns an iCal feed of all blocked dates
 */
router.get('/blocked-dates.ics', async (req, res) => {
  try {
    // Basic Auth check
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Calendar Feed"');
      return res.status(401).send('Authentication required');
    }

    // Get blocked dates
    const query = await prepare(`
      SELECT * FROM blocked_dates
      WHERE end_date >= date('now')
      ORDER BY start_date ASC
    `);
    const blockedDates = await query.all();

    // Create calendar
    const calendar = ical({
      name: 'Fotobox Sperrtage',
      description: 'Gesperrte Daten für Fotobox-Vermietung',
      timezone: 'Europe/Berlin',
      ttl: 3600,
      prodId: {
        company: 'Fotobox Rental',
        product: 'Blocked Dates Calendar',
        language: 'DE'
      }
    });

    // Add each blocked period as an event
    blockedDates.forEach(block => {
      const startDate = new Date(block.start_date);
      const endDate = new Date(block.end_date);

      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      calendar.createEvent({
        start: startDate,
        end: endDate,
        summary: `🚫 Gesperrt${block.reason ? `: ${block.reason}` : ''}`,
        description: [
          'Dieser Zeitraum ist für Buchungen gesperrt.',
          block.reason ? `Grund: ${block.reason}` : '',
          '',
          `Gesperrt am: ${new Date(block.created_at).toLocaleString('de-DE')}`,
        ].filter(Boolean).join('\n'),
        uid: `blocked-${block.id}@fotobox-rental.com`,
        status: 'CONFIRMED',
        busyStatus: 'FREE',
        categories: [{ name: 'Blocked Date' }],
        color: 'red',
        allDay: true
      });
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="fotobox-blocked-dates.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    res.send(calendar.toString());

    console.log(`[Calendar Feed] Generated blocked dates feed with ${blockedDates.length} blocks`);
  } catch (error) {
    console.error('[Calendar Feed] Error generating blocked dates calendar:', error);
    res.status(500).send('Error generating calendar feed');
  }
});

export default router;
