import { v4 as uuidv4 } from 'uuid';
import FotoboxInventoryManager from './inventoryManager.js';
import { getReservationExpiry, isReservationExpired } from '../utils/dateHelpers.js';
import { sendReservationEmail, sendConfirmationEmail } from './emailService.js';
import { generateEventCode } from '../utils/eventCodeGenerator.js';

/**
 * Booking Status Konstanten
 */
export const BOOKING_STATUS = {
  RESERVED: 'reserved',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CONFLICT: 'conflict',  // Buchungskonflikt - Slot war nicht mehr verfügbar bei Order
  SHIPPED: 'shipped',
  RETURNED: 'returned',
  CANCELLED: 'cancelled',
};

/**
 * BookingService
 *
 * Verantwortlich für:
 * - Reservierung erstellen (3h Timeout)
 * - Reservierung in Buchung umwandeln
 * - Stornierungen verwalten
 * - Status-Updates
 */
class BookingService {
  constructor() {
    this.inventoryManager = new FotoboxInventoryManager();
    this.reservationTimeout = parseInt(process.env.RESERVATION_TIMEOUT || '3');
  }

  /**
   * Erstellt eine neue Reservierung mit Email (Lead Capture)
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string} eventDate - Event-Datum
   * @param {string} customerEmail - Kunden-Email für Lead Capture
   * @param {object} additionalData - Zusätzliche Daten
   * @returns {Promise<object>} Reservierungsdaten
   *
   * @example
   * const reservation = await bookingService.createReservation(
   *   'gid://shopify/ProductVariant/123',
   *   '2024-12-15',
   *   'kunde@example.com'
   * );
   * // Returns: { success: true, booking: { id, variantId, eventDate, customerEmail, status } }
   */
  async createReservation(variantId, eventDate, customerEmail, additionalData = {}) {
    try {
      const { available } = await this.inventoryManager.checkAvailability(
        variantId,
        eventDate
      );

      if (!available) {
        return {
          success: false,
          message: 'Dieser Termin ist leider nicht mehr verfügbar.',
        };
      }

      const bookingId = uuidv4();

      // Generate unique event code for app/slideshow access
      let eventCode;
      try {
        eventCode = await generateEventCode();
      } catch (error) {
        console.error('[BookingService] Failed to generate event code:', error);
        return {
          success: false,
          message: 'Fehler beim Generieren des Event-Codes. Bitte erneut versuchen.',
          error: error.message,
        };
      }

      // Calculate expiration date (event date + 30 days)
      const eventCodeExpiresAt = new Date(eventDate);
      eventCodeExpiresAt.setDate(eventCodeExpiresAt.getDate() + 30);

      const productInfo = await this.getProductInfo(variantId);

      const bookingData = {
        bookingId,
        eventCode,
        eventCodeExpiresAt,
        productTitle: productInfo.productTitle,
        variantTitle: productInfo.variantTitle,
        customerEmail, // Lead Capture: Email speichern
        status: BOOKING_STATUS.PENDING, // Pending bis Shopify Order bestätigt
        createdAt: new Date().toISOString(),
        ...additionalData,
      };

      await this.inventoryManager.blockInventory(variantId, eventDate, bookingData);

      return {
        success: true,
        booking: {
          id: bookingId,
          eventCode,
          eventCodeExpiresAt: eventCodeExpiresAt.toISOString(),
          variantId,
          eventDate,
          startDate: eventDate, // Multi-day support: startDate = eventDate for single day
          endDate: eventDate,   // Multi-day support: endDate = eventDate for single day
          totalDays: 1,         // Multi-day support: initial booking is 1 day
          customerEmail,
          status: BOOKING_STATUS.PENDING,
          productTitle: productInfo.title,
          variantTitle: productInfo.variantTitle,
          createdAt: bookingData.createdAt,
        },
      };
    } catch (error) {
      console.error('Error creating reservation:', error);
      return {
        success: false,
        message: 'Fehler beim Erstellen der Reservierung.',
        error: error.message,
      };
    }
  }

  /**
   * Bestätigt eine Buchung nach Shopify Order (Webhook)
   *
   * @param {string} bookingId - Booking ID
   * @param {string} orderId - Shopify Order GID
   * @param {object} orderData - Zusätzliche Order-Daten
   * @returns {Promise<object>} Bestätigungsdaten
   */
  async confirmBooking(bookingId, orderId, orderData = {}) {
    try {
      const booking = await this.inventoryManager.getBookingById(bookingId);

      if (!booking) {
        return {
          success: false,
          error: 'Buchung nicht gefunden.',
        };
      }

      if (booking.status !== BOOKING_STATUS.PENDING) {
        console.warn(`Booking ${bookingId} has status ${booking.status}, expected PENDING`);
        // Trotzdem fortfahren falls bereits confirmed
        if (booking.status === BOOKING_STATUS.CONFIRMED) {
          return {
            success: true,
            status: BOOKING_STATUS.CONFIRMED,
            message: 'Buchung war bereits bestätigt',
          };
        }
      }

      // Update Booking mit Order-Daten
      await this.inventoryManager.updateBookingStatus(
        bookingId,
        BOOKING_STATUS.CONFIRMED,
        {
          orderId,
          ...orderData,
          confirmedAt: new Date().toISOString(),
        }
      );

      return {
        success: true,
        status: BOOKING_STATUS.CONFIRMED,
      };
    } catch (error) {
      console.error('Error confirming booking:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Bestätigt eine Reservierung nach erfolgreicher Zahlung (Legacy)
   *
   * @param {string} bookingId - Booking ID
   * @param {string} orderId - Shopify Order GID
   * @returns {Promise<object>} Bestätigungsdaten
   *
   * @example
   * const result = await bookingService.confirmReservation(
   *   'uuid',
   *   'gid://shopify/Order/456'
   * );
   * // Returns: { success: true, status: 'confirmed' }
   */
  async confirmReservation(bookingId, orderId) {
    try {
      const booking = await this.inventoryManager.getBookingById(bookingId);

      if (!booking) {
        return {
          success: false,
          message: 'Buchung nicht gefunden.',
        };
      }

      if (booking.status !== BOOKING_STATUS.RESERVED) {
        return {
          success: false,
          message: `Buchung hat ungültigen Status: ${booking.status}`,
        };
      }

      if (isReservationExpired(booking.reservedUntil)) {
        await this.inventoryManager.releaseInventory(bookingId);
        return {
          success: false,
          message: 'Reservierung ist abgelaufen.',
        };
      }

      await this.inventoryManager.updateBookingStatus(
        bookingId,
        BOOKING_STATUS.CONFIRMED,
        { orderId }
      );

      const updatedBooking = await this.inventoryManager.getBookingById(bookingId);

      await sendConfirmationEmail(booking.customerEmail, {
        bookingId,
        eventDate: booking.eventDate,
        productTitle: booking.productTitle,
        orderId,
      });

      return {
        success: true,
        status: BOOKING_STATUS.CONFIRMED,
        booking: updatedBooking,
      };
    } catch (error) {
      console.error('Error confirming reservation:', error);
      return {
        success: false,
        message: 'Fehler beim Bestätigen der Reservierung.',
        error: error.message,
      };
    }
  }

  /**
   * Storniert eine Buchung
   *
   * @param {string} bookingId - Booking ID
   * @param {string} reason - Stornierungsgrund
   * @returns {Promise<object>} Stornierungsdaten
   */
  async cancelBooking(bookingId, reason = '') {
    try {
      const booking = await this.inventoryManager.getBookingById(bookingId);

      if (!booking) {
        return {
          success: false,
          message: 'Buchung nicht gefunden.',
        };
      }

      if (booking.status === BOOKING_STATUS.CANCELLED) {
        return {
          success: false,
          message: 'Buchung ist bereits storniert.',
        };
      }

      await this.inventoryManager.updateBookingStatus(
        bookingId,
        BOOKING_STATUS.CANCELLED,
        { cancelledAt: new Date().toISOString(), cancelReason: reason }
      );

      await this.inventoryManager.releaseInventory(bookingId);

      return {
        success: true,
        status: BOOKING_STATUS.CANCELLED,
        message: 'Buchung wurde storniert.',
      };
    } catch (error) {
      console.error('Error cancelling booking:', error);
      return {
        success: false,
        message: 'Fehler beim Stornieren der Buchung.',
        error: error.message,
      };
    }
  }

  /**
   * Aktualisiert den Status einer Buchung
   *
   * @param {string} bookingId - Booking ID
   * @param {string} newStatus - Neuer Status
   * @param {object} additionalData - Zusätzliche Daten
   * @returns {Promise<object>} Update-Daten
   */
  async updateBookingStatus(bookingId, newStatus, additionalData = {}) {
    try {
      const booking = await this.inventoryManager.getBookingById(bookingId);

      if (!booking) {
        return {
          success: false,
          message: 'Buchung nicht gefunden.',
        };
      }

      if (!Object.values(BOOKING_STATUS).includes(newStatus)) {
        return {
          success: false,
          message: `Ungültiger Status: ${newStatus}`,
        };
      }

      await this.inventoryManager.updateBookingStatus(
        bookingId,
        newStatus,
        additionalData
      );

      return {
        success: true,
        status: newStatus,
        message: 'Status erfolgreich aktualisiert.',
      };
    } catch (error) {
      console.error('Error updating booking status:', error);
      return {
        success: false,
        message: 'Fehler beim Aktualisieren des Status.',
        error: error.message,
      };
    }
  }

  /**
   * Erweitert eine existierende Buchung um zusätzliche Tage
   *
   * @param {string} bookingId - Booking ID
   * @param {number} additionalDays - Anzahl Tage zum Hinzufügen
   * @returns {Promise<object>} Erweitertes Buchungsobjekt
   *
   * @example
   * // Buchung vom 15.12., erweitere um 2 Tage
   * const result = await bookingService.extendBooking('abc123', 2);
   * // Neue Buchung: 15.-17.12., blocked: 13.-19.12.
   */
  async extendBooking(bookingId, additionalDays) {
    try {
      // Hole aktuelle Buchung
      const booking = await this.inventoryManager.getBookingById(bookingId);

      if (!booking) {
        return {
          success: false,
          message: 'Buchung nicht gefunden.',
        };
      }

      // Bestimme Start- und Enddatum
      // Alte Buchungen haben nur eventDate, neue haben startDate/endDate
      const startDate = booking.startDate || booking.eventDate;

      // WICHTIG: Wenn endDate nicht existiert, ist das eine 1-Tages-Buchung
      // In diesem Fall ist endDate = startDate (nicht eventDate!)
      let currentEndDate;
      if (booking.endDate) {
        currentEndDate = booking.endDate;
      } else if (booking.totalDays && booking.totalDays > 1) {
        // Hat totalDays aber kein endDate? Berechne es aus startDate
        const { addDays: addDaysTemp, parseISO: parseISOTemp, format: formatTemp } = await import('date-fns');
        const startDateObj = typeof startDate === 'string' ?
          parseISOTemp(startDate) : startDate;
        currentEndDate = formatTemp(
          addDaysTemp(startDateObj, booking.totalDays - 1),
          'yyyy-MM-dd'
        );
      } else {
        // Keine endDate und keine totalDays = 1-Tages-Buchung
        currentEndDate = startDate;
      }

      console.log(`[BookingService] Current booking: ${startDate} to ${currentEndDate} (${booking.totalDays || 1} days)`);

      // Berechne neues Enddatum
      const { addDays, format: formatDateFns, parseISO } = await import('date-fns');
      const currentEnd = typeof currentEndDate === 'string' ?
        parseISO(currentEndDate) : currentEndDate;

      const newEndDate = addDays(currentEnd, additionalDays);
      const newEndDateStr = formatDateFns(newEndDate, 'yyyy-MM-dd');

      console.log(`[BookingService] Extending booking ${bookingId} from ${currentEndDate} to ${newEndDateStr}`);

      // Prüfe Verfügbarkeit für die neuen Tage
      const { getDateRange } = await import('../utils/dateHelpers.js');
      const newDates = getDateRange(
        addDays(currentEnd, 1), // Tag nach dem aktuellen Ende
        newEndDate
      );

      console.log(`[BookingService] Checking availability for new dates:`, newDates);

      // Prüfe jeden neuen Tag - WICHTIG: Ignoriere dabei die eigene Buchung!
      for (const date of newDates) {
        const { available } = await this.inventoryManager.checkAvailabilityForExtension(
          booking.variantId,
          date,
          bookingId // Ignoriere Buffer-Blockierungen dieser Buchung
        );

        if (!available) {
          return {
            success: false,
            message: `Tag ${date} ist nicht verfügbar.`,
            unavailableDate: date,
          };
        }
      }

      // Alle Tage verfügbar - aktualisiere Buchung
      const { calculateBlockedDatesForRange } = await import('../utils/dateHelpers.js');
      const blockedDates = calculateBlockedDatesForRange(
        startDate,
        newEndDateStr,
        this.inventoryManager.bufferBefore,
        this.inventoryManager.bufferAfter
      );

      // Berechne die Gesamtzahl der Tage von Start bis Ende (inklusiv)
      const startDateObj = typeof startDate === 'string' ? parseISO(startDate) : startDate;
      const totalDays = Math.floor((newEndDate - startDateObj) / (1000 * 60 * 60 * 24)) + 1;

      console.log(`[BookingService] Calculated totalDays: ${totalDays} (from ${startDate} to ${newEndDateStr})`);

      const updatedBooking = {
        ...booking,
        startDate,
        endDate: newEndDateStr,
        totalDays,
        blockedDates,
        extendedAt: new Date().toISOString(),
        additionalDaysAdded: additionalDays,
      };

      // Speichere aktualisierte Buchung
      await this.inventoryManager.updateBooking(bookingId, updatedBooking);

      console.log(`[BookingService] ✓ Booking ${bookingId} extended successfully`);

      return {
        success: true,
        booking: {
          id: bookingId,
          variantId: booking.variantId,
          startDate,
          endDate: newEndDateStr,
          totalDays: updatedBooking.totalDays,
          blockedDates,
          additionalDaysAdded: additionalDays,
        },
        message: `Buchung erfolgreich um ${additionalDays} Tag(e) erweitert.`,
      };
    } catch (error) {
      console.error('Error extending booking:', error);
      return {
        success: false,
        message: 'Fehler beim Erweitern der Buchung.',
        error: error.message,
      };
    }
  }

  /**
   * Holt Buchungs-Details
   *
   * @param {string} bookingId - Booking ID
   * @returns {Promise<object|null>} Buchungsdaten
   */
  async getBooking(bookingId) {
    try {
      // Fields are now always present from database
      return await this.inventoryManager.getBookingById(bookingId);
    } catch (error) {
      console.error('Error getting booking:', error);
      return null;
    }
  }

  /**
   * Bereinigt abgelaufene Reservierungen aus lokaler Datenbank
   *
   * Löscht:
   * - RESERVED Status (alter Flow) wenn reservedUntil abgelaufen
   * - PENDING Status wenn älter als X Stunden (konfigurierbar via ENV)
   *
   * @returns {Promise<number>} Anzahl bereinigter Reservierungen
   */
  async cleanupExpiredReservations() {
    try {
      const allBookings = await this.inventoryManager.getAllBookings();
      let cleanedCount = 0;
      const now = new Date();
      // Cleanup-Timeout für PENDING Bookings (konfigurierbar via ENV)
      const PENDING_TIMEOUT_HOURS = parseInt(process.env.PENDING_TIMEOUT_HOURS || '2');

      // Finde abgelaufene Bookings
      const expiredBookings = allBookings.filter(b => {
        // Fall 1: RESERVED Status (alter Flow) - prüfe reservedUntil
        if (b.status === BOOKING_STATUS.RESERVED && b.reservedUntil) {
          return isReservationExpired(b.reservedUntil);
        }

        // Fall 2: PENDING Status (Lead Capture) - prüfe createdAt
        if (b.status === BOOKING_STATUS.PENDING && b.createdAt) {
          const createdAt = new Date(b.createdAt);
          const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60);
          return hoursSinceCreated > PENDING_TIMEOUT_HOURS;
        }

        return false;
      });

      for (const booking of expiredBookings) {
        console.log(`Cleaning up expired booking: ${booking.bookingId} (Status: ${booking.status})`);
        await this.inventoryManager.releaseInventory(booking.bookingId);
        cleanedCount++;
      }

      return cleanedCount;
    } catch (error) {
      console.error('Error cleaning up expired reservations:', error);
      return 0;
    }
  }

  /**
   * Bereinigt PENDING Bookings für ein spezifisches Datum
   *
   * Wird aufgerufen wenn eine Order bestätigt wird, um andere Pending Bookings
   * für denselben Termin zu löschen (konkurrierende Reservierungen).
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string} eventDate - Event-Datum (YYYY-MM-DD)
   * @param {string} excludeBookingId - Booking ID die NICHT gelöscht werden soll
   * @returns {Promise<number>} Anzahl gelöschter Bookings
   */
  async cleanupPendingBookingsForDate(variantId, eventDate, excludeBookingId) {
    try {
      // Hole alle Bookings für diese Variante
      const allBookings = await this.inventoryManager.getBookingsForVariant(variantId);

      // Finde alle PENDING Bookings für dieses Datum (außer die excludierte)
      const pendingBookingsToDelete = allBookings.filter(b => {
        return (
          b.status === BOOKING_STATUS.PENDING &&
          b.eventDate === eventDate &&
          b.bookingId !== excludeBookingId
        );
      });

      let cleanedCount = 0;
      for (const booking of pendingBookingsToDelete) {
        console.log(`Cleaning up competing pending booking: ${booking.bookingId}`);
        await this.inventoryManager.releaseInventory(booking.bookingId);
        cleanedCount++;
      }

      return cleanedCount;
    } catch (error) {
      console.error('Error cleaning up pending bookings for date:', error);
      return 0;
    }
  }

  /**
   * Plant automatische Bereinigung einer Reservierung
   * NOTE: setTimeout funktioniert nur im Speicher und geht bei Server-Restart verloren!
   * Verwende stattdessen cleanupExpiredReservations() periodisch.
   *
   * @param {string} bookingId - Booking ID
   * @param {string} reservedUntil - Ablaufdatum
   */
  scheduleReservationCleanup(bookingId, reservedUntil) {
    const expiryTime = new Date(reservedUntil).getTime();
    const now = Date.now();
    const delay = expiryTime - now;

    if (delay > 0 && delay < 3600000) { // Nur für < 1 Stunde
      setTimeout(async () => {
        const booking = await this.inventoryManager.getBookingById(bookingId);
        if (booking && booking.status === BOOKING_STATUS.RESERVED) {
          console.log(`[Cleanup] Expired reservation: ${bookingId}`);
          await this.cancelBooking(bookingId, 'Automatic cleanup - reservation expired');
        }
      }, delay);
    }
  }


  /**
   * Holt Produktinformationen
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @returns {Promise<object>} Produktinformationen
   */
  async getProductInfo(variantId) {
    try {
      const query = `
        query getProductVariant($id: ID!) {
          productVariant(id: $id) {
            id
            title
            product {
              id
              title
            }
          }
        }
      `;

      const variables = { id: variantId };
      const response = await this.inventoryManager.shopify.graphql(query, variables);

      const variant = response.productVariant;
      return {
        title: `${variant.product.title} - ${variant.title}`,
        productTitle: variant.product.title,
        variantTitle: variant.title,
        productId: variant.product.id,
        variantId: variant.id,
      };
    } catch (error) {
      console.error('Error getting product info:', error);
      return {
        title: 'Unknown Product',
        productTitle: 'Unknown Product',
        variantTitle: 'Unknown Variant'
      };
    }
  }

  /**
   * Prüft Verfügbarkeit für einen Datumsbereich
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string} startDate - Start-Datum (YYYY-MM-DD)
   * @param {string} endDate - End-Datum (YYYY-MM-DD)
   * @param {string} excludeBookingId - Optional: Booking ID die ignoriert werden soll (für Erweiterungen)
   * @returns {Promise<object>} Verfügbarkeits-Array
   */
  async checkDateRangeAvailability(variantId, startDate, endDate, excludeBookingId = null) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const availability = [];

      // Iteriere durch alle Tage im Bereich
      for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
        const dateStr = date.toISOString().split('T')[0];

        // Wenn excludeBookingId gesetzt ist, prüfe mit checkAvailabilityForExtension
        const { available } = excludeBookingId
          ? await this.inventoryManager.checkAvailabilityForExtension(
              variantId,
              dateStr,
              excludeBookingId
            )
          : await this.inventoryManager.checkAvailability(
              variantId,
              dateStr
            );

        availability.push({
          date: dateStr,
          available,
        });
      }

      return {
        success: true,
        availability,
      };
    } catch (error) {
      console.error('Error checking date range availability:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Verkürzt eine existierende Buchung auf eine neue Anzahl von Tagen
   * Wird verwendet wenn User Zusatztag-Produkte aus dem Cart entfernt
   *
   * @param {string} bookingId - Booking ID
   * @param {number} newTotalDays - Neue Gesamtzahl der Tage (min 1)
   * @returns {Promise<object>} Aktualisiertes Buchungsobjekt
   *
   * @example
   * // Buchung von 3 Tagen auf 2 Tage verkürzen
   * const result = await bookingService.shortenBooking('abc123', 2);
   */
  async shortenBooking(bookingId, newTotalDays) {
    try {
      // Hole aktuelle Buchung
      const booking = await this.inventoryManager.getBookingById(bookingId);

      if (!booking) {
        return {
          success: false,
          message: 'Buchung nicht gefunden.',
        };
      }

      const currentTotalDays = booking.totalDays || 1;

      // Validierung: Kann nicht auf mehr Tage verkürzen
      if (newTotalDays >= currentTotalDays) {
        return {
          success: false,
          message: `Kann nicht auf ${newTotalDays} Tage verkürzen (aktuell: ${currentTotalDays}).`,
        };
      }

      // Validierung: Minimum 1 Tag
      if (newTotalDays < 1) {
        return {
          success: false,
          message: 'Buchung muss mindestens 1 Tag haben.',
        };
      }

      // Berechne neues Enddatum
      const startDate = booking.startDate || booking.eventDate;
      const { addDays, format: formatDateFns } = await import('date-fns');
      const { parseISO } = await import('date-fns');

      const startDateObj = typeof startDate === 'string' ? parseISO(startDate) : startDate;
      const newEndDate = addDays(startDateObj, newTotalDays - 1); // -1 weil Start = Tag 0
      const newEndDateStr = formatDateFns(newEndDate, 'yyyy-MM-dd');

      console.log(`[BookingService] Shortening booking ${bookingId}:`);
      console.log(`  Current: ${startDate} → ${booking.endDate || booking.eventDate} (${currentTotalDays} days)`);
      console.log(`  New:     ${startDate} → ${newEndDateStr} (${newTotalDays} days)`);

      // Aktualisiere blocked dates
      const { calculateBlockedDatesForRange } = await import('../utils/dateHelpers.js');
      const blockedDates = calculateBlockedDatesForRange(
        startDate,
        newEndDateStr,
        this.inventoryManager.bufferBefore,
        this.inventoryManager.bufferAfter
      );

      const updatedBooking = {
        ...booking,
        startDate,
        endDate: newEndDateStr,
        totalDays: newTotalDays,
        blockedDates,
        shortenedAt: new Date().toISOString(),
      };

      // Speichere aktualisierte Buchung
      await this.inventoryManager.updateBooking(bookingId, updatedBooking);

      console.log(`[BookingService] ✓ Booking ${bookingId} shortened successfully`);

      return {
        success: true,
        booking: {
          id: bookingId,
          variantId: booking.variantId,
          startDate,
          endDate: newEndDateStr,
          totalDays: newTotalDays,
          blockedDates,
        },
        message: `Buchung erfolgreich auf ${newTotalDays} Tag(e) verkürzt.`,
      };
    } catch (error) {
      console.error('Error shortening booking:', error);
      return {
        success: false,
        message: 'Fehler beim Verkürzen der Buchung.',
        error: error.message,
      };
    }
  }

  /**
   * Erstellt Reservierungen für mehrere Tage (Multi-Day Booking)
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string[]} dates - Array von Event-Daten (YYYY-MM-DD)
   * @param {string} customerEmail - Kunden-Email
   * @returns {Promise<object>} Buchungsdetails
   */
  async createMultiDayReservation(variantId, dates, customerEmail) {
    try {
      const bookings = [];
      let primaryBookingId = null;

      // Sortiere Daten chronologisch
      const sortedDates = [...dates].sort();

      // Erstelle Reservierung für jeden Tag
      for (const eventDate of sortedDates) {
        const result = await this.createReservation(variantId, eventDate, customerEmail, {
          isMultiDay: true,
          totalDays: dates.length,
        });

        if (result.success) {
          // Erster erfolgreicher Booking ist der Primary
          if (!primaryBookingId) {
            primaryBookingId = result.booking.id;
          }

          bookings.push({
            date: eventDate,
            bookingId: result.booking.id,
            success: true,
          });
        } else {
          bookings.push({
            date: eventDate,
            bookingId: null,
            success: false,
            error: result.message || 'Reservierung fehlgeschlagen',
          });
        }
      }

      // Prüfe ob mindestens eine Buchung erfolgreich war
      const successfulBookings = bookings.filter(b => b.success);
      if (successfulBookings.length === 0) {
        return {
          success: false,
          message: 'Keine der Reservierungen konnte erstellt werden',
          bookings,
        };
      }

      return {
        success: true,
        bookings,
        primaryBookingId,
        successCount: successfulBookings.length,
        totalCount: dates.length,
      };
    } catch (error) {
      console.error('Error creating multi-day reservation:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Holt alle Buchungen (für Admin Panel)
   *
   * @returns {Promise<Array>} Alle Buchungen
   */
  async getAllBookings() {
    return await this.inventoryManager.getAllBookings();
  }

  /**
   * Holt nur bestätigte Buchungen (für Admin Panel Kalender)
   *
   * @returns {Promise<Array>} Nur confirmed Buchungen
   */
  async getConfirmedBookings() {
    return await this.inventoryManager.getConfirmedBookings();
  }

  /**
   * Erstellt eine neue Buchung direkt (für Admin Panel)
   *
   * @param {object} bookingData - Buchungsdaten
   * @returns {Promise<object>} Created booking with ID
   */
  async createBooking(bookingData) {
    const bookingId = uuidv4();

    const fullBookingData = {
      bookingId,
      ...bookingData
    };

    await this.inventoryManager.createBooking(fullBookingData);

    return {
      id: bookingId,
      ...bookingData
    };
  }

  /**
   * Löscht eine Buchung permanent
   *
   * @param {string} bookingId - Booking ID
   * @returns {Promise<void>}
   */
  async deleteBooking(bookingId) {
    // Permanently delete booking from database (for orphaned bookings)
    return await this.inventoryManager.permanentlyDeleteBooking(bookingId);
  }

  /**
   * Update shipping information for a booking
   *
   * @param {string} bookingId - Booking ID
   * @param {object} shippingData - Shipping data to update
   * @returns {Promise<void>}
   */
  async updateShipping(bookingId, shippingData) {
    const booking = await this.inventoryManager.getBookingById(bookingId);

    if (!booking) {
      throw new Error('Booking not found');
    }

    const updatedBooking = {
      ...booking,
      ...shippingData,
      updatedAt: new Date().toISOString()
    };

    await this.inventoryManager.updateBooking(bookingId, updatedBooking);

    console.log(`✓ Shipping info updated for booking ${bookingId}`);
  }

  /**
   * Get booking by tracking number
   *
   * @param {string} trackingNumber - DHL tracking number
   * @returns {Promise<object|null>} Booking data
   */
  async getByTrackingNumber(trackingNumber) {
    const allBookings = await this.inventoryManager.getAllBookings();
    return allBookings.find(b => b.trackingNumber === trackingNumber) || null;
  }

  /**
   * Get booking by ID (alias for getBooking for consistency)
   *
   * @param {string} bookingId - Booking ID
   * @returns {Promise<object|null>} Booking data
   */
  async getBookingById(bookingId) {
    return await this.getBooking(bookingId);
  }
}

export default BookingService;
