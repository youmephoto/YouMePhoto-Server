import shopifyClient from '../config/shopify.js';
import { query, variantInventoryQueries, blockedDatesQueries, bookingsQueries, inventoryScheduleQueries } from '../db/database.js';
import {
  calculateBlockedDates,
  calculateBlockedDatesForRange,
  datesOverlap,
  getDateRange,
  formatDate,
} from '../utils/dateHelpers.js';


/**
 * FotoboxInventoryManager
 *
 * Verantwortlich für:
 * - Tracking von Fotobox-Inventar nach Varianten (Kategorie + Farbe)
 * - Berechnung verfügbarer Termine unter Berücksichtigung von Buffer-Zeiten
 * - Vermeidung von Doppelbuchungen
 */
class FotoboxInventoryManager {
  constructor() {
    this.bufferBefore = parseInt(process.env.SHIPPING_BUFFER_BEFORE || '2');
    this.bufferAfter = parseInt(process.env.SHIPPING_BUFFER_AFTER || '2');
    this.shopify = shopifyClient;
  }

  /**
   * Holt die Gesamtanzahl der verfügbaren Einheiten für eine Variante
   * UPDATED: Now uses local database instead of Shopify API
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @returns {Promise<number>} Anzahl verfügbarer Einheiten
   */
  async getTotalInventory(variantId) {
    try {
      console.log(`[InventoryManager] Looking up inventory for: ${variantId}`);

      // Try to get from local database first
      const inventory = await variantInventoryQueries.getByVariantGid(variantId);

      if (inventory) {
        console.log(`[InventoryManager] ✓ Found via GID: ${inventory.product_title} - ${inventory.variant_title}: ${inventory.total_units} units`);
        return inventory.total_units;
      }

      // Fallback: Try numeric ID if GID not found
      if (variantId.includes('/')) {
        const numericId = variantId.split('/').pop();
        console.log(`[InventoryManager] GID lookup failed, trying numeric ID: ${numericId}`);
        const inventoryByNumeric = await variantInventoryQueries.getByNumericId(numericId);

        if (inventoryByNumeric) {
          console.log(`[InventoryManager] ✓ Found via numeric ID: ${inventoryByNumeric.product_title} - ${inventoryByNumeric.variant_title}: ${inventoryByNumeric.total_units} units`);
          return inventoryByNumeric.total_units;
        }
      }

      // If not in database, log warning and return 1 as default
      console.warn(`[InventoryManager] ⚠️ Variant ${variantId} not found in database! Using default quantity: 1`);
      console.warn(`[InventoryManager] Run migration script: node scripts/migrateInventory.js`);
      return 1;
    } catch (error) {
      console.error('[InventoryManager] Error fetching inventory from database:', error);
      throw error;
    }
  }

  /**
   * Holt die Gesamtanzahl der verfügbaren Einheiten für eine Variante ZU EINEM BESTIMMTEN DATUM
   * Berücksichtigt zeitbasiertes Inventar-Scheduling (inventory_schedule Tabelle)
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string|Date} date - Datum für das Inventar abgefragt werden soll
   * @returns {Promise<number>} Anzahl verfügbarer Einheiten an diesem Datum
   */
  async getTotalInventoryForDate(variantId, date) {
    try {
      const formattedDate = formatDate(date);

      // Prüfe ob es einen zeitbasierten Inventar-Plan gibt
      const schedule = await inventoryScheduleQueries.getActiveForDate(variantId, formattedDate);

      if (schedule) {
        console.log(`[InventoryManager] ✓ Found scheduled inventory for ${formattedDate}: ${schedule.total_units} units (${schedule.note || 'no note'})`);
        return schedule.total_units;
      }

      // Fallback: Verwende aktuelles Inventar
      const currentInventory = await this.getTotalInventory(variantId);
      console.log(`[InventoryManager] No schedule found for ${formattedDate}, using current inventory: ${currentInventory} units`);
      return currentInventory;
    } catch (error) {
      console.error('[InventoryManager] Error fetching inventory for date:', error);
      throw error;
    }
  }

  /**
   * Holt alle Buchungen für eine Produktvariante aus lokaler Datenbank
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @returns {Promise<Array>} Array von Buchungsobjekten
   */
  async getBookingsForVariant(variantId) {
    try {
      const bookings = await bookingsQueries.getByVariant(variantId);

      // Transform database format to expected format
      return bookings.map(booking => {
        const startDate = booking.start_date || booking.event_date;
        const endDate = booking.end_date || booking.event_date;

        // Use range-based calculation for multi-day bookings
        const blockedDates = calculateBlockedDatesForRange(
          startDate,
          endDate,
          this.bufferBefore,
          this.bufferAfter
        );

        return {
          bookingId: booking.booking_id,
          variantId: booking.variant_gid,
          eventDate: booking.event_date,
          startDate,
          endDate,
          totalDays: booking.total_days || 1,
          status: booking.status,
          customerEmail: booking.customer_email,
          customerName: booking.customer_name,
          orderId: booking.order_id,
          createdAt: booking.created_at,
          updatedAt: booking.updated_at,
          blockedDates,
        };
      });
    } catch (error) {
      console.error('Error fetching bookings from database:', error);
      return [];
    }
  }

  /**
   * Extrahiert Product ID aus Variant ID
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @returns {Promise<string>} Product GID
   */
  async getProductIdFromVariant(variantId) {
    try {
      const query = `
        query getProductFromVariant($id: ID!) {
          productVariant(id: $id) {
            product {
              id
            }
          }
        }
      `;

      const variables = { id: variantId };
      const response = await this.shopify.graphql(query, variables);

      return response.productVariant.product.id;
    } catch (error) {
      console.error('Error getting product ID:', error);
      throw error;
    }
  }

  /**
   * Prüft Verfügbarkeit für spezifische Variante an einem Datum
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string|Date} eventDate - Event-Datum
   * @returns {Promise<{available: boolean, availableCount: number, totalInventory: number}>}
   *
   * @example
   * const result = await manager.checkAvailability('gid://shopify/ProductVariant/123', '2024-12-15');
   * // { available: true, availableCount: 2, totalInventory: 5 }
   */
  async checkAvailability(variantId, eventDate) {
    try {
      // WICHTIG: Verwende getTotalInventoryForDate statt getTotalInventory
      // Dies berücksichtigt zeitbasiertes Inventar-Scheduling
      const totalInventory = await this.getTotalInventoryForDate(variantId, eventDate);

      // Berechne blocked dates OHNE Chain-Buffer für die Collision-Prüfung
      // Chain-Buffer dient nur zur Anzeige, nicht zur Kollisionsprüfung
      const { calculateBlockedDates: calculateBlockedDatesNoChain } = await import('../utils/dateHelpers.js');
      const blockedDatesNoChain = calculateBlockedDatesNoChain(
        eventDate,
        this.bufferBefore,
        this.bufferAfter
      ).slice(0, -this.bufferBefore); // Entferne Chain-Buffer am Ende

      const allBookings = await this.getBookingsForVariant(variantId);

      // Soft Lock: PENDING Bookings blockieren (konfigurierbar via ENV)
      const SOFT_LOCK_MINUTES = parseInt(process.env.SOFT_LOCK_MINUTES || '30');
      const now = new Date();

      const activeBookings = allBookings.filter(booking => {
        // CONFIRMED und RESERVED immer zählen
        if (booking.status === 'confirmed' || booking.status === 'reserved') {
          return true;
        }

        // PENDING nur wenn noch innerhalb Soft Lock (30 Min)
        if (booking.status === 'pending' && booking.createdAt) {
          // FIX: SQLite returns datetime as 'YYYY-MM-DD HH:MM:SS' which needs 'T' for ISO
          const createdAtStr = typeof booking.createdAt === 'string' && booking.createdAt.includes(' ')
            ? booking.createdAt.replace(' ', 'T') + 'Z'  // Convert to ISO with UTC marker
            : booking.createdAt;

          const createdAt = new Date(createdAtStr);
          const minutesSinceCreated = (now - createdAt) / (1000 * 60);

          console.log(`[InventoryManager] PENDING booking ${booking.bookingId}: created ${minutesSinceCreated.toFixed(2)} min ago (limit: ${SOFT_LOCK_MINUTES} min)`);

          return minutesSinceCreated <= SOFT_LOCK_MINUTES;
        }

        return false;
      });

      // WICHTIG: Prüfe Kollision OHNE Chain-Buffer
      // Chain-Buffer der bestehenden Buchung wird ebenfalls ignoriert
      let blockedCount = 0;
      for (const booking of activeBookings) {
        // Entferne Chain-Buffer von der bestehenden Buchung
        const existingBlockedNoChain = booking.blockedDates.slice(0, -this.bufferBefore);

        if (datesOverlap(blockedDatesNoChain, existingBlockedNoChain)) {
          blockedCount++;
        }
      }

      const availableCount = totalInventory - blockedCount;

      return {
        available: availableCount > 0,
        availableCount: Math.max(0, availableCount),
        totalInventory,
      };
    } catch (error) {
      console.error('Error checking availability:', error);
      throw error;
    }
  }

  /**
   * Prüft Verfügbarkeit für Zusatztage einer bestehenden Buchung
   * WICHTIG: Ignoriert die Buffer-Blockierungen der eigenen Buchung!
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string} eventDate - Zu prüfendes Datum
   * @param {string} excludeBookingId - Booking ID die ignoriert werden soll
   * @returns {Promise<object>} Verfügbarkeitsinformation
   *
   * @example
   * // Prüfe ob 16.12. verfügbar ist, ignoriere dabei Buchung abc123
   * const result = await manager.checkAvailabilityForExtension(
   *   'gid://shopify/ProductVariant/123',
   *   '2024-12-16',
   *   'abc123'
   * );
   * // { available: true } - Auch wenn 16.12. durch Buffer von abc123 blockiert ist
   */
  async checkAvailabilityForExtension(variantId, eventDate, excludeBookingId) {
    try {
      // WICHTIG: Verwende getTotalInventoryForDate für zeitbasiertes Inventar
      const totalInventory = await this.getTotalInventoryForDate(variantId, eventDate);

      // Berechne welche Daten durch dieses Event blockiert würden
      const blockedDates = calculateBlockedDates(
        eventDate,
        this.bufferBefore,
        this.bufferAfter
      );

      const allBookings = await this.getBookingsForVariant(variantId);

      // Soft Lock: PENDING Bookings blockieren (konfigurierbar via ENV)
      const SOFT_LOCK_MINUTES = parseInt(process.env.SOFT_LOCK_MINUTES || '30');
      const now = new Date();

      const activeBookings = allBookings.filter(booking => {
        // WICHTIG: Ignoriere die eigene Buchung!
        if (booking.bookingId === excludeBookingId) {
          return false;
        }

        // CONFIRMED und RESERVED immer zählen
        if (booking.status === 'confirmed' || booking.status === 'reserved') {
          return true;
        }

        // PENDING nur wenn noch innerhalb Soft Lock (30 Min)
        if (booking.status === 'pending' && booking.createdAt) {
          const createdAt = new Date(booking.createdAt);
          const minutesSinceCreated = (now - createdAt) / (1000 * 60);
          return minutesSinceCreated <= SOFT_LOCK_MINUTES;
        }

        return false;
      });

      let blockedCount = 0;
      for (const booking of activeBookings) {
        if (datesOverlap(blockedDates, booking.blockedDates)) {
          blockedCount++;
        }
      }

      const availableCount = totalInventory - blockedCount;

      return {
        available: availableCount > 0,
        availableCount: Math.max(0, availableCount),
        totalInventory,
      };
    } catch (error) {
      console.error('Error checking availability for extension:', error);
      throw error;
    }
  }

  /**
   * Prüft Verfügbarkeit für Order-Bestätigung (Webhook)
   * Wird aufgerufen wenn eine Order bezahlt wurde und wir prüfen müssen,
   * ob der Slot noch verfügbar ist (Fall: Soft Lock abgelaufen, jemand anders war schneller)
   *
   * WICHTIG: Ignoriert die eigene PENDING Buchung bei der Prüfung!
   * Zählt nur CONFIRMED Buchungen anderer Kunden.
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string} eventDate - Event-Datum
   * @param {string} excludeBookingId - Eigene Booking ID die ignoriert wird
   * @returns {Promise<object>} { available, availableCount, totalInventory }
   */
  async checkAvailabilityForConfirmation(variantId, eventDate, excludeBookingId) {
    try {
      const totalInventory = await this.getTotalInventoryForDate(variantId, eventDate);

      const blockedDates = calculateBlockedDates(
        eventDate,
        this.bufferBefore,
        this.bufferAfter
      );

      const allBookings = await this.getBookingsForVariant(variantId);

      // Für Confirmation: Zähle NUR CONFIRMED Buchungen (nicht PENDING!)
      // Die eigene Buchung (excludeBookingId) wird ignoriert
      const confirmedBookings = allBookings.filter(booking => {
        // Ignoriere eigene Buchung
        if (booking.bookingId === excludeBookingId) {
          return false;
        }

        // Nur CONFIRMED zählt - wenn jemand anders den Slot bereits bestätigt hat
        return booking.status === 'confirmed';
      });

      let blockedCount = 0;
      for (const booking of confirmedBookings) {
        if (datesOverlap(blockedDates, booking.blockedDates)) {
          blockedCount++;
        }
      }

      const availableCount = totalInventory - blockedCount;

      console.log(`[InventoryManager] Confirmation check for ${eventDate}: ${availableCount}/${totalInventory} available (${blockedCount} confirmed bookings block this date)`);

      return {
        available: availableCount > 0,
        availableCount: Math.max(0, availableCount),
        totalInventory,
      };
    } catch (error) {
      console.error('Error checking availability for confirmation:', error);
      throw error;
    }
  }

  /**
   * Gibt Array mit allen verfügbaren Daten im Zeitraum zurück
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string|Date} startDate - Start des Zeitraums
   * @param {string|Date} endDate - Ende des Zeitraums
   * @returns {Promise<string[]>} Array von verfügbaren Datumsstrings
   *
   * @example
   * const available = await manager.getAvailableDates(
   *   'gid://shopify/ProductVariant/123',
   *   '2024-12-01',
   *   '2024-12-31'
   * );
   * // Returns: ['2024-12-05', '2024-12-06', '2024-12-08', ...]
   */
  async getAvailableDates(variantId, startDate, endDate) {
    try {
      console.log(`[getAvailableDates] Called with variantId=${variantId}, startDate=${startDate}, endDate=${endDate}`);
      const dateRange = getDateRange(startDate, endDate);
      console.log(`[getAvailableDates] Date range has ${dateRange.length} days, first=${dateRange[0]}, last=${dateRange[dateRange.length-1]}`);

      // Vorlaufzeit: Mindestens X Tage im Voraus buchen
      const minLeadTimeDays = parseInt(process.env.MIN_LEAD_TIME_DAYS || '4');
      const minBookingDate = new Date();
      minBookingDate.setDate(minBookingDate.getDate() + minLeadTimeDays);
      minBookingDate.setHours(0, 0, 0, 0); // Auf Tagesbeginn setzen
      console.log(`[getAvailableDates] minBookingDate=${formatDate(minBookingDate)} (lead time: ${minLeadTimeDays} days)`);

      // Optimierung: Lade Daten nur EINMAL statt für jeden Tag
      // HINWEIS: totalInventory wird jetzt pro Tag berechnet (siehe unten)
      const allBookings = await this.getBookingsForVariant(variantId);
      console.log(`[getAvailableDates] Found ${allBookings.length} bookings for variant`);

      // Get blocked dates from database
      const allBlockedDates = await blockedDatesQueries.getAll();

      // PERFORMANCE: Lade ALLE inventory schedules für diese Variante EINMAL
      // statt für jeden Tag einzeln (59 Queries → 1 Query)
      const allSchedules = await inventoryScheduleQueries.getByVariant(variantId);

      // Cache für schnelleren Lookup: Map von Datum → total_units
      const scheduleMap = new Map();
      for (const schedule of allSchedules) {
        const scheduleDate = new Date(schedule.effective_date);
        const endDate = schedule.end_date ? new Date(schedule.end_date) : null;

        // Generiere alle Daten im Schedule-Bereich
        const currentDate = new Date(scheduleDate);
        while (!endDate || currentDate <= endDate) {
          scheduleMap.set(formatDate(currentDate), schedule.total_units);
          if (!endDate) break; // Einmaliges Datum
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }

      // Fallback: Hole aktuelles Inventar EINMAL
      const defaultInventory = await this.getTotalInventory(variantId);
      console.log(`[getAvailableDates] Default inventory for variant: ${defaultInventory} units`);

      // Soft Lock: PENDING Bookings blockieren (konfigurierbar via ENV)
      const SOFT_LOCK_MINUTES = parseInt(process.env.SOFT_LOCK_MINUTES || '30');
      const now = new Date();

      const activeBookings = allBookings.filter(booking => {
        // CONFIRMED und RESERVED immer zählen
        if (booking.status === 'confirmed' || booking.status === 'reserved') {
          return true;
        }

        // PENDING nur wenn noch innerhalb Soft Lock (30 Min)
        if (booking.status === 'pending' && booking.createdAt) {
          // FIX: SQLite returns datetime as 'YYYY-MM-DD HH:MM:SS' which needs 'T' for ISO
          const createdAtStr = typeof booking.createdAt === 'string' && booking.createdAt.includes(' ')
            ? booking.createdAt.replace(' ', 'T') + 'Z'  // Convert to ISO with UTC marker
            : booking.createdAt;

          const createdAt = new Date(createdAtStr);
          const minutesSinceCreated = (now - createdAt) / (1000 * 60);

          console.log(`[InventoryManager] PENDING booking ${booking.bookingId}: created ${minutesSinceCreated.toFixed(2)} min ago (limit: ${SOFT_LOCK_MINUTES} min)`);

          return minutesSinceCreated <= SOFT_LOCK_MINUTES;
        }

        return false;
      });

      const availableDates = [];
      let skippedLeadTime = 0;
      let skippedAdminBlocked = 0;
      let totalChecked = 0;

      // Prüfe jeden Tag im Zeitraum
      for (const date of dateRange) {
        totalChecked++;
        // Überspringe Daten, die vor der Mindest-Vorlaufzeit liegen
        const checkDate = new Date(date);
        if (checkDate < minBookingDate) {
          skippedLeadTime++;
          continue; // Datum zu nah, überspringe
        }

        // Check if date is in admin-blocked date ranges
        const isAdminBlocked = allBlockedDates.some(blockedRange => {
          const blockStart = new Date(blockedRange.start_date);
          const blockEnd = new Date(blockedRange.end_date);
          return checkDate >= blockStart && checkDate <= blockEnd;
        });

        if (isAdminBlocked) {
          skippedAdminBlocked++;
          continue; // Skip this date - admin has blocked it
        }

        // WICHTIG: Hole Inventar für DIESES SPEZIFISCHE DATUM
        // Berücksichtigt zeitbasiertes Inventar-Scheduling (jetzt aus Cache!)
        const totalInventoryForDate = scheduleMap.get(date) ?? defaultInventory;

        // Prüfe wie viele Boxen an diesem Tag BLOCKIERT sind
        // (d.h. wie viele bestehende Buchungen diesen Tag blockieren)
        // HINWEIS: blockedDates inkludiert jetzt automatisch Chain-Buffer
        let blockedCount = 0;
        for (const booking of activeBookings) {
          // Prüfe ob der Tag in den blockierten Daten dieser Buchung liegt
          if (booking.blockedDates.includes(date)) {
            blockedCount++;
          }
        }

        const availableCount = totalInventoryForDate - blockedCount;

        // Debug für erste 3 Tage nach Lead Time
        if (availableDates.length < 3 && checkDate >= minBookingDate) {
          console.log(`[getAvailableDates] ${date}: inventory=${totalInventoryForDate}, blocked=${blockedCount}, available=${availableCount}`);
        }

        if (availableCount > 0) {
          availableDates.push(date);
        }
      }

      console.log(`[getAvailableDates] Results: ${totalChecked} days checked, ${skippedLeadTime} skipped (lead time), ${skippedAdminBlocked} skipped (admin blocked), ${availableDates.length} available dates`);
      if (availableDates.length > 0) {
        console.log(`[getAvailableDates] First available: ${availableDates[0]}, Last available: ${availableDates[availableDates.length-1]}`);
      }

      return availableDates;
    } catch (error) {
      console.error('Error getting available dates:', error);
      throw error;
    }
  }

  /**
   * Blockt Inventar für eine Buchung
   *
   * @param {string} variantId - Shopify ProductVariant GID
   * @param {string} eventDate - Event-Datum
   * @param {object} bookingData - Buchungsdaten (bookingId, customerEmail, etc.)
   * @returns {Promise<boolean>} Success status
   *
   * @example
   * await manager.blockInventory(
   *   'gid://shopify/ProductVariant/123',
   *   '2024-12-15',
   *   { bookingId: 'uuid', customerEmail: 'kunde@example.com', status: 'reserved' }
   * );
   */
  async blockInventory(variantId, eventDate, bookingData) {
    try {
      const { available } = await this.checkAvailability(variantId, eventDate);

      if (!available) {
        throw new Error('No inventory available for this date');
      }

      // Create booking in database
      const newBooking = {
        ...bookingData,
        variantId,
        eventDate: formatDate(eventDate),
        createdAt: new Date().toISOString(),
      };

      await this.createBooking(newBooking);

      return true;
    } catch (error) {
      console.error('Error blocking inventory:', error);
      throw error;
    }
  }

  /**
   * Gibt Inventar für eine Buchung frei
   *
   * @param {string} bookingId - Booking ID
   * @returns {Promise<boolean>} Success status
   */
  async releaseInventory(bookingId) {
    try {
      const booking = await this.getBookingById(bookingId);

      if (!booking) {
        console.log(`[InventoryManager] Booking ${bookingId} not found - already released or never existed`);
        return true;
      }

      // WICHTIG: Buchung nicht löschen, nur Status auf 'cancelled' setzen
      // Dies verhindert Race Conditions und erlaubt es, stornierte Buchungen zu tracken
      console.log(`[InventoryManager] Releasing inventory for booking ${bookingId}`);
      console.log(`[InventoryManager] Note: Booking status should already be 'cancelled' from cancelBooking()`);

      // Die Buchung bleibt in der Datenbank mit status='cancelled'
      // Cancelled Bookings werden in checkAvailability() bereits ignoriert
      // sodass das Inventar automatisch wieder verfügbar ist

      return true;
    } catch (error) {
      console.error('Error releasing inventory:', error);
      throw error;
    }
  }

  /**
   * Aktualisiert den Status einer Buchung
   *
   * @param {string} bookingId - Booking ID
   * @param {string} newStatus - Neuer Status
   * @param {object} additionalData - Zusätzliche Daten (z.B. orderId)
   * @returns {Promise<boolean>} Success status
   */
  async updateBookingStatus(bookingId, newStatus, additionalData = {}) {
    try {
      const booking = await this.getBookingById(bookingId);

      if (!booking) {
        throw new Error('Booking not found');
      }

      // Update status in database
      await bookingsQueries.updateStatus(newStatus, bookingId);

      // If there's an orderId in additionalData, update it separately
      if (additionalData.orderId) {
        await query(`
          UPDATE bookings
          SET order_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE booking_id = $2
        `, [additionalData.orderId, bookingId]);
      }

      // Update customer email if provided
      if (additionalData.customerEmail) {
        await query(`
          UPDATE bookings
          SET customer_email = $1, updated_at = CURRENT_TIMESTAMP
          WHERE booking_id = $2
        `, [additionalData.customerEmail, bookingId]);
        console.log(`[InventoryManager] ✓ Updated customer_email to ${additionalData.customerEmail}`);
      }

      // Update customer name if provided
      if (additionalData.customerName) {
        await query(`
          UPDATE bookings
          SET customer_name = $1, updated_at = CURRENT_TIMESTAMP
          WHERE booking_id = $2
        `, [additionalData.customerName, bookingId]);
        console.log(`[InventoryManager] ✓ Updated customer_name to ${additionalData.customerName}`);
      }

      console.log(`[InventoryManager] ✓ Booking ${bookingId} status updated to ${newStatus}`);

      return true;
    } catch (error) {
      console.error('Error updating booking status:', error);
      throw error;
    }
  }

  /**
   * Aktualisiert eine Buchung komplett (nicht nur Status)
   *
   * @param {string} bookingId - Booking ID
   * @param {object} updatedData - Neue Buchungsdaten
   * @returns {Promise<boolean>} Success status
   */
  async updateBooking(bookingId, updatedData) {
    try {
      const booking = await this.getBookingById(bookingId);

      if (!booking) {
        throw new Error('Booking not found');
      }

      // Build dynamic update query based on what fields are provided
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (updatedData.eventDate) {
        updates.push(`event_date = $${paramIndex++}`);
        values.push(formatDate(updatedData.eventDate));
      }
      if (updatedData.startDate) {
        updates.push(`start_date = $${paramIndex++}`);
        values.push(formatDate(updatedData.startDate));
      }
      if (updatedData.endDate) {
        updates.push(`end_date = $${paramIndex++}`);
        values.push(formatDate(updatedData.endDate));
      }
      if (updatedData.totalDays !== undefined) {
        updates.push(`total_days = $${paramIndex++}`);
        values.push(updatedData.totalDays);
      }
      if (updatedData.status) {
        updates.push(`status = $${paramIndex++}`);
        values.push(updatedData.status);
      }
      if (updatedData.customerEmail) {
        updates.push(`customer_email = $${paramIndex++}`);
        values.push(updatedData.customerEmail);
      }
      if (updatedData.customerName !== undefined) {
        updates.push(`customer_name = $${paramIndex++}`);
        values.push(updatedData.customerName);
      }
      if (updatedData.orderId !== undefined) {
        updates.push(`order_id = $${paramIndex++}`);
        values.push(updatedData.orderId);
      }

      if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(bookingId);

        const updateQuery = `
          UPDATE bookings
          SET ${updates.join(', ')}
          WHERE booking_id = $${paramIndex}
        `;

        await query(updateQuery, values);
      }

      console.log(`[InventoryManager] ✓ Booking ${bookingId} updated successfully`);

      return true;
    } catch (error) {
      console.error('Error updating booking:', error);
      throw error;
    }
  }

  /**
   * Holt alle Buchungen aus lokaler Datenbank
   *
   * @returns {Promise<Array>} Array von Buchungen
   */
  async getAllBookings() {
    try {
      const bookings = await bookingsQueries.getAll();

      // Transform database format to expected format
      return bookings.map(booking => ({
        bookingId: booking.booking_id,
        variantId: booking.variant_gid,
        eventDate: booking.event_date,
        startDate: booking.start_date || booking.event_date,
        endDate: booking.end_date || booking.event_date,
        totalDays: booking.total_days || 1,
        status: booking.status,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        orderId: booking.order_id,
        createdAt: booking.created_at,
        updatedAt: booking.updated_at,
        productTitle: booking.product_title,
        variantTitle: booking.variant_title,
        // Shipping information
        shippingStatus: booking.shipping_status || 'not_shipped',
        trackingNumber: booking.tracking_number,
        shippedAt: booking.shipped_at,
        labelUrl: booking.shipping_label_url,
        // Shipping address from order (if order exists)
        shippingAddress: booking.shipping_address1 ? {
          name: booking.shipping_name,
          street: booking.shipping_address1,
          street_number: booking.shipping_address2 || '',
          city: booking.shipping_city,
          postal_code: booking.shipping_zip,
          province: booking.shipping_province,
          country: booking.shipping_country || 'Deutschland',
          phone: booking.shipping_phone,
        } : null,
        // Billing address from order (if order exists)
        billingAddress: booking.billing_address1 ? {
          name: booking.billing_name,
          street: booking.billing_address1,
          street_number: booking.billing_address2 || '',
          city: booking.billing_city,
          postal_code: booking.billing_zip,
          province: booking.billing_province,
          country: booking.billing_country || 'Deutschland',
          phone: booking.billing_phone,
        } : null,
        // Calculate blocked dates on the fly
        blockedDates: calculateBlockedDates(
          booking.event_date,
          this.bufferBefore,
          this.bufferAfter
        ),
      }));
    } catch (error) {
      console.error('Error fetching all bookings from database:', error);
      return [];
    }
  }

  /**
   * Holt nur bestätigte (confirmed) Buchungen für Admin Panel
   *
   * @returns {Promise<Array>} Array von confirmed Buchungen
   */
  async getConfirmedBookings() {
    try {
      const bookings = await bookingsQueries.getConfirmed();

      // Transform database format to expected format
      return bookings.map(booking => ({
        bookingId: booking.booking_id,
        variantId: booking.variant_gid,
        eventDate: booking.event_date,
        startDate: booking.start_date || booking.event_date,
        endDate: booking.end_date || booking.event_date,
        totalDays: booking.total_days || 1,
        status: booking.status,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        orderId: booking.order_id,
        createdAt: booking.created_at,
        updatedAt: booking.updated_at,
        productTitle: booking.product_title,
        variantTitle: booking.variant_title,
        // Shipping information
        shippingStatus: booking.shipping_status || 'not_shipped',
        trackingNumber: booking.tracking_number,
        shippedAt: booking.shipped_at,
        labelUrl: booking.shipping_label_url,
        // Shipping address from order (if order exists)
        shippingAddress: booking.shipping_address1 ? {
          name: booking.shipping_name,
          street: booking.shipping_address1,
          street_number: booking.shipping_address2 || '',
          city: booking.shipping_city,
          postal_code: booking.shipping_zip,
          province: booking.shipping_province,
          country: booking.shipping_country || 'Deutschland',
          phone: booking.shipping_phone,
        } : null,
        // Billing address from order (if order exists)
        billingAddress: booking.billing_address1 ? {
          name: booking.billing_name,
          street: booking.billing_address1,
          street_number: booking.billing_address2 || '',
          city: booking.billing_city,
          postal_code: booking.billing_zip,
          province: booking.billing_province,
          country: booking.billing_country || 'Deutschland',
          phone: booking.billing_phone,
        } : null,
        // Calculate blocked dates on the fly
        blockedDates: calculateBlockedDates(
          booking.event_date,
          this.bufferBefore,
          this.bufferAfter
        ),
      }));
    } catch (error) {
      console.error('Error fetching confirmed bookings from database:', error);
      return [];
    }
  }

  /**
   * Erstellt eine neue Buchung in der lokalen Datenbank
   *
   * @param {object} bookingData - Buchungsdaten
   * @returns {Promise<boolean>} Success status
   */
  async createBooking(bookingData) {
    try {
      const eventDate = formatDate(bookingData.eventDate);
      const startDate = bookingData.startDate ? formatDate(bookingData.startDate) : eventDate;
      const endDate = bookingData.endDate ? formatDate(bookingData.endDate) : eventDate;
      const totalDays = bookingData.totalDays || 1;

      await bookingsQueries.add(
        bookingData.bookingId,
        bookingData.variantId,
        bookingData.productTitle,
        bookingData.variantTitle,
        bookingData.customerEmail,
        bookingData.customerName || null,
        eventDate,
        startDate,
        endDate,
        totalDays,
        bookingData.status || 'pending',
        bookingData.orderId || null
      );

      console.log(`[InventoryManager] ✓ Booking ${bookingData.bookingId} created in database (${startDate} - ${endDate}, ${totalDays} days)`);
      return true;
    } catch (error) {
      console.error('Error creating booking in database:', error);
      throw error;
    }
  }

  /**
   * Findet Buchung nach ID in lokaler Datenbank
   *
   * @param {string} bookingId - Booking ID
   * @returns {Promise<object|null>} Buchungsobjekt oder null
   */
  async getBookingById(bookingId) {
    try {
      const booking = await bookingsQueries.getById(bookingId);

      if (!booking) {
        return null;
      }

      // Transform database format to expected format
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
        orderId: booking.order_id,
        createdAt: booking.created_at,
        updatedAt: booking.updated_at,
        productTitle: booking.product_title,
        variantTitle: booking.variant_title,
        // Shipping address from order (if order exists)
        shippingAddress: booking.shipping_address1 ? {
          name: booking.shipping_name,
          street: booking.shipping_address1,
          street_number: booking.shipping_address2 || '',
          city: booking.shipping_city,
          postal_code: booking.shipping_zip,
          province: booking.shipping_province,
          country: booking.shipping_country || 'Deutschland',
          phone: booking.shipping_phone,
        } : null,
        // Billing address from order (if order exists)
        billingAddress: booking.billing_address1 ? {
          name: booking.billing_name,
          street: booking.billing_address1,
          street_number: booking.billing_address2 || '',
          city: booking.billing_city,
          postal_code: booking.billing_zip,
          province: booking.billing_province,
          country: booking.billing_country || 'Deutschland',
          phone: booking.billing_phone,
        } : null,
        // Calculate blocked dates on the fly
        blockedDates: calculateBlockedDates(
          booking.event_date,
          this.bufferBefore,
          this.bufferAfter
        ),
      };
    } catch (error) {
      console.error('Error getting booking by ID from database:', error);
      return null;
    }
  }

  /**
   * Permanently delete a booking from the database
   * USE WITH CAUTION - only for orphaned bookings without associated orders
   *
   * @param {string} bookingId - Booking ID to delete
   * @returns {Promise<boolean>} Success status
   */
  async permanentlyDeleteBooking(bookingId) {
    try {
      console.log(`[InventoryManager] PERMANENTLY deleting booking ${bookingId} from database`);

      const booking = await this.getBookingById(bookingId);
      if (!booking) {
        console.log(`[InventoryManager] Booking ${bookingId} not found`);
        return true; // Already deleted
      }

      // Delete from database
      await bookingsQueries.delete(bookingId);

      console.log(`[InventoryManager] ✓ Booking ${bookingId} permanently deleted from database`);
      return true;
    } catch (error) {
      console.error(`[InventoryManager] Error permanently deleting booking ${bookingId}:`, error);
      throw error;
    }
  }
}

export default FotoboxInventoryManager;
