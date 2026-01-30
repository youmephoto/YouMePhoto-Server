import path from 'path';
import { fileURLToPath } from 'url';
import dhlService from './dhlService.js';
import { bookingsQueries, orderQueries } from '../db/database-postgres.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


/**
 * Shipping Service
 * Handles shipping label creation, tracking updates, and status management
 * Abstraction layer over DHL service (allows multiple carriers in future)
 */
class ShippingService {
  /**
   * Create shipping label for a booking
   * @param {string} bookingId - Booking ID
   * @returns {Promise<{success: boolean, labelUrl?: string, trackingNumber?: string, error?: string}>}
   */
  async createLabel(bookingId) {
    try {
      // Get booking with order shipping address
      const booking = await bookingsQueries.getById(bookingId);
      console.log(`[ShippingService] Booking data:`, booking);

      if (!booking) {
        throw new Error('Booking not found');
      }

      // Get order to retrieve shipping address
      let shippingAddress = null;

      // Check if shipping address is already in the booking result (from JOIN)
      if (booking.shipping_address1 && booking.shipping_zip && booking.shipping_city) {
        console.log(`[ShippingService] Using shipping address from JOIN`);
        shippingAddress = {
          name: booking.shipping_name || booking.customer_name,
          street: booking.shipping_address1,
          street_number: booking.shipping_address2 || '',
          postal_code: booking.shipping_zip,
          city: booking.shipping_city,
          province: booking.shipping_province,
          country: booking.shipping_country || 'Deutschland',
          phone: booking.shipping_phone
        };
      } else if (booking.order_id) {
        // Fallback: Query order separately
        console.log(`[ShippingService] Querying order separately: ${booking.order_id}`);
        const order = await orderQueries.getByShopifyOrderId(booking.order_id);
        console.log(`[ShippingService] Order data:`, order);

        if (order && order.shipping_address1 && order.shipping_zip && order.shipping_city) {
          shippingAddress = {
            name: order.shipping_name || booking.customer_name,
            street: order.shipping_address1,
            street_number: order.shipping_address2 || '',
            postal_code: order.shipping_zip,
            city: order.shipping_city,
            province: order.shipping_province,
            country: order.shipping_country || 'Deutschland',
            phone: order.shipping_phone
          };
        }
      }

      console.log(`[ShippingService] Final shipping address:`, shippingAddress);

      // Validate address
      if (!shippingAddress || !shippingAddress.street || !shippingAddress.postal_code || !shippingAddress.city) {
        throw new Error(`Shipping address incomplete for booking ${bookingId}. Please update address in order.`);
      }

      console.log(`📦 Creating shipping label for booking ${bookingId}...`);
      console.log(`📦 Shipping address:`, shippingAddress);

      // Call DHL API
      const result = await dhlService.createShippingLabel({
        booking,
        shippingAddress
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create shipping label');
      }

      // Update booking with tracking info
      await bookingsQueries.updateShippingStatus(
        bookingId,
        'preparing',
        result.trackingNumber,
        result.labelUrl
      );

      console.log(`✓ Label created: ${result.trackingNumber}`);

      return {
        success: true,
        labelUrl: result.labelUrl,
        trackingNumber: result.trackingNumber
      };

    } catch (error) {
      console.error(`❌ Error creating label for ${bookingId}:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Mark booking as shipped (triggers customer email)
   * @param {string} bookingId - Booking ID
   * @returns {Promise<void>}
   */
  async markAsShipped(bookingId) {
    try {
      const booking = await bookingsQueries.getById(bookingId);

      if (!booking) {
        throw new Error('Booking not found');
      }

      if (!booking.tracking_number) {
        throw new Error('No tracking number found. Please create shipping label first.');
      }

      // Update status to shipped
      await bookingsQueries.updateShippingStatus(
        bookingId,
        'shipped',
        booking.tracking_number,
        booking.shipping_label_url,
        new Date() // shipped_at
      );

      console.log(`✓ Booking ${bookingId} marked as shipped`);

      // Send shipping confirmation email
      // Note: This will be handled by emailService (to be implemented)
      const { sendShippingConfirmationEmail } = await import('./emailService.js');

      await sendShippingConfirmationEmail(booking.customer_email, {
        bookingId,
        customerName: booking.customer_name,
        productTitle: booking.product_title,
        trackingNumber: booking.tracking_number,
        startDate: booking.start_date || booking.event_date,
        setupInstructionsUrl: booking.setup_instructions_url || '/docs/setup-guide.pdf'
      });

      console.log(`✓ Shipping confirmation email sent to ${booking.customer_email}`);

    } catch (error) {
      console.error(`❌ Error marking as shipped:`, error.message);
      throw error;
    }
  }

  /**
   * Update tracking status from DHL webhook/polling
   * @param {string} trackingNumber - DHL tracking number
   * @returns {Promise<void>}
   */
  async updateTrackingStatus(trackingNumber) {
    try {
      // Get latest tracking info from DHL
      const tracking = await dhlService.getTrackingInfo(trackingNumber);

      // Find booking by tracking number
      const booking = await bookingsQueries.getByTrackingNumber(trackingNumber);

      if (!booking) {
        console.warn(`⚠️ No booking found for tracking ${trackingNumber}`);
        return;
      }

      console.log(`📦 Updating tracking for ${booking.booking_id}: ${tracking.status}`);

      // Update booking status based on DHL status
      if (tracking.status === 'delivered' && booking.shipping_status !== 'delivered') {
        await bookingsQueries.updateShippingStatus(
          booking.booking_id,
          'delivered',
          booking.tracking_number,
          booking.shipping_label_url,
          booking.shipped_at,
          new Date() // delivered_at
        );

        console.log(`✓ Booking ${booking.booking_id} marked as delivered`);
      }

      // Save tracking event to history
      await this.saveTrackingEvent(booking.booking_id, tracking);

    } catch (error) {
      console.error('❌ Error updating tracking status:', error.message);
    }
  }

  /**
   * Save tracking event to shipping_history
   * @param {string} bookingId - Booking ID
   * @param {object} event - Tracking event
   */
  async saveTrackingEvent(bookingId, event) {
    try {
      // For PostgreSQL, we'll use a simple INSERT with ON CONFLICT DO NOTHING
      // to avoid duplicates (assuming there's a unique constraint on booking_id + tracking_number + timestamp)
      const { execute } = await import('../db/database-postgres.js');

      await execute(`
        INSERT INTO shipping_history (
          booking_id, tracking_number, status, status_description, location, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [
        bookingId,
        event.trackingNumber,
        event.status,
        event.description || '',
        event.location || '',
        event.timestamp
      ]);

      console.log(`✓ Tracking event saved for ${bookingId}`);

    } catch (error) {
      console.error('Error saving tracking event:', error.message);
    }
  }

  /**
   * Check for overdue returns (run daily via cron)
   * Bookings with end_date + 3 days passed and status = delivered
   * @returns {Promise<number>} Number of bookings marked as overdue
   */
  async checkOverdueReturns() {
    try {
      // Find bookings where end_date + 3 days has passed
      const overdueQuery = await prepare(`
        SELECT booking_id, customer_email, customer_name, product_title, end_date, event_date
        FROM bookings
        WHERE shipping_status = 'delivered'
          AND (
            date(end_date, '+3 days') < date('now')
            OR (end_date IS NULL AND date(event_date, '+3 days') < date('now'))
          )
      `);
      const overdueBookings = await overdueQuery.all();

      if (overdueBookings.length === 0) {
        console.log('✓ No overdue returns found');
        return 0;
      }

      console.log(`⚠️ Found ${overdueBookings.length} overdue returns`);

      for (const booking of overdueBookings) {
        // Update status to overdue
        const updateQuery = await prepare(`
          UPDATE bookings
          SET shipping_status = 'overdue',
              updated_at = CURRENT_TIMESTAMP
          WHERE booking_id = $1
        `);
        await updateQuery.run(booking.booking_id);

        // Send reminder email
        const { sendReturnReminderEmail } = await import('./emailService.js');

        await sendReturnReminderEmail(booking.customer_email, {
          bookingId: booking.booking_id,
          customerName: booking.customer_name,
          productTitle: booking.product_title,
          endDate: booking.end_date || booking.event_date
        });

        console.log(`✓ Overdue reminder sent for ${booking.booking_id}`);
      }

      return overdueBookings.length;

    } catch (error) {
      console.error('❌ Error checking overdue returns:', error.message);
      return 0;
    }
  }

  /**
   * Get shipping history for a booking
   * @param {string} bookingId - Booking ID
   * @returns {Array} Shipping history events
   */
  async getShippingHistory(bookingId) {
    try {
      const historyQuery = await prepare(`
        SELECT * FROM shipping_history
        WHERE booking_id = $1
        ORDER BY timestamp DESC
      `);
      const history = await historyQuery.all(bookingId);

      return history;

    } catch (error) {
      console.error('Error getting shipping history:', error.message);
      return [];
    }
  }

  /**
   * Update shipping status manually (for admin actions)
   * @param {string} bookingId - Booking ID
   * @param {string} shippingStatus - New status
   * @param {string} [timestamp] - Optional timestamp field to update
   */
  async updateShippingStatus(bookingId, shippingStatus, timestamp = null) {
    try {
      let query = `
        UPDATE bookings
        SET shipping_status = $1,
            updated_at = CURRENT_TIMESTAMP
      `;

      const params = [shippingStatus];

      // Add timestamp update if provided
      if (timestamp === 'returned') {
        query += ', returned_at = CURRENT_TIMESTAMP';
      }

      query += ` WHERE booking_id = $2`;
      params.push(bookingId);

      const updateQuery = await prepare(query);
      await updateQuery.run(...params);

      console.log(`✓ Shipping status updated: ${bookingId} → ${shippingStatus}`);

    } catch (error) {
      console.error('Error updating shipping status:', error.message);
      throw error;
    }
  }
}

export default new ShippingService();
