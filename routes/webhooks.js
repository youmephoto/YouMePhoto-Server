import express from 'express';
import crypto from 'crypto';
import BookingService from '../services/bookingService.js';
import OrderService from '../services/orderService.js';
import FotoboxInventoryManager from '../services/inventoryManager.js';
import photoStripService from '../services/photoStripService.js';
import { sendPhotoStripEditorEmail, sendOrderConfirmationEmail, sendConflictAlertEmail } from '../services/emailService.js';
import discountService from '../services/discountService.js';
import { redactEmail } from '../utils/redactPii.js';

const router = express.Router();
const bookingService = new BookingService();
const orderService = new OrderService();
const inventoryManager = new FotoboxInventoryManager();

/**
 * Shopify Webhook: Order Create
 *
 * Wird aufgerufen wenn eine Shopify Order erstellt wird.
 * Bestätigt die Reservierung und wandelt sie in eine bestätigte Buchung um.
 *
 * Dokumentation:
 * https://shopify.dev/docs/apps/webhooks/configuration/https
 */
router.post('/shopify/orders/create', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verifiziere Shopify Webhook Signature
    const hmac = req.get('X-Shopify-Hmac-SHA256');
    const shopDomain = req.get('X-Shopify-Shop-Domain');

    if (!verifyWebhook(req.body, hmac)) {
      console.error('Invalid webhook signature');
      return res.status(401).send('Unauthorized');
    }

    console.log('\n=== SHOPIFY WEBHOOK: ORDER CREATE ===');
    console.log('Shop:', shopDomain);

    // Parse order data
    const orderData = JSON.parse(req.body.toString());
    console.log('Order ID:', orderData.id);
    console.log('Order Name:', orderData.name);
    console.log('Line Items:', orderData.line_items?.length);

    // Finde Fotobox Line Items mit Booking ID
    // Zusatztag-Items (_additional_day: 'true') ausschließen - diese haben keine eigene Buchung
    const fotoboxItems = orderData.line_items.filter(item => {
      const bookingId = item.properties?.find(p => p.name === '_booking_id');
      const isAdditionalDay = item.properties?.find(p => p.name === '_additional_day')?.value === 'true';
      return bookingId !== undefined && !isAdditionalDay;
    });

    console.log('Fotobox Items found:', fotoboxItems.length);

    // Bestätige jede Buchung
    for (const item of fotoboxItems) {
      const bookingId = item.properties.find(p => p.name === '_booking_id')?.value;
      const eventDate = item.properties.find(p => p.name === '_event_date')?.value
                     || item.properties.find(p => p.name === '_main_event_date')?.value;

      if (!bookingId) {
        console.warn('Line item missing _booking_id:', item.id);
        continue;
      }

      console.log(`Confirming booking ${bookingId} for order ${orderData.id}`);

      // VALIDIERUNG: Prüfe ob der Slot noch verfügbar ist (für direkten Checkout-Flow)
      // Dies fängt den Fall ab, wenn der Soft Lock abgelaufen ist und jemand anders schneller war
      const variantGid = `gid://shopify/ProductVariant/${item.variant_id}`;
      const { available, availableCount } = await inventoryManager.checkAvailabilityForConfirmation(
        variantGid,
        eventDate,
        bookingId // Eigene PENDING Buchung ignorieren bei der Prüfung
      );

      if (!available) {
        console.error(`⚠️ KONFLIKT: Slot ${eventDate} für Variante ${item.variant_id} ist nicht mehr verfügbar!`);
        console.error(`   Booking ${bookingId} kann nicht bestätigt werden - manuelle Intervention erforderlich`);

        // Sende Alert-Email an Admin
        const customerEmail = orderData.customer?.email || orderData.email;
        try {
          await sendConflictAlertEmail({
            bookingId,
            orderId: orderData.id,
            orderName: orderData.name,
            customerEmail,
            customerName: `${orderData.customer?.first_name || ''} ${orderData.customer?.last_name || ''}`.trim(),
            eventDate,
            productTitle: item.title,
            variantTitle: item.variant_title,
          });
          console.log('✓ Conflict alert email sent to admin');
        } catch (emailErr) {
          console.error('Failed to send conflict alert email:', emailErr);
        }

        // Trotzdem weitermachen - Order ist bezahlt, muss manuell gelöst werden
        // Die Buchung wird als CONFLICT markiert statt CONFIRMED
        await bookingService.updateBookingStatus(bookingId, 'conflict', {
          conflictReason: 'Slot was already booked when order was placed',
          orderId: `gid://shopify/Order/${orderData.id}`,
          customerEmail,
        });

        continue; // Nächstes Item
      }

      console.log(`✓ Slot verfügbar (${availableCount} Einheiten), bestätige Buchung...`);

      // Bestätige Buchung
      // Use customer.email first (real email), fallback to orderData.email (might be guest@shopify.com)
      const customerEmail = orderData.customer?.email || orderData.email;
      console.log('✓ Final customerEmail used:', redactEmail(customerEmail));

      const result = await bookingService.confirmBooking(
        bookingId,
        `gid://shopify/Order/${orderData.id}`,
        {
          customerEmail,
          customerName: `${orderData.customer?.first_name || ''} ${orderData.customer?.last_name || ''}`.trim(),
          orderName: orderData.name,
          eventDate,
        }
      );

      if (result.success) {
        console.log(`✓ Booking ${bookingId} confirmed`);

        // Get booking details for emails
        const booking = result.booking || await bookingService.getBooking(bookingId);

        // Send order confirmation email immediately
        try {
          await sendOrderConfirmationEmail(customerEmail, {
            bookingId,
            customerName: `${orderData.customer?.first_name || ''} ${orderData.customer?.last_name || ''}`.trim() || 'Kunde',
            productTitle: booking?.productTitle || item.name,
            startDate: booking?.startDate || eventDate,
            endDate: booking?.endDate || eventDate,
            orderName: orderData.name,
            setupInstructionsUrl: '/docs/setup-guide.pdf'
          });
          console.log(`✓ Order confirmation email sent to ${redactEmail(customerEmail)}`);
        } catch (emailError) {
          console.error('Error sending order confirmation email:', emailError);
          // Non-critical - order is still confirmed
        }

        // NEW: Create photo strip and send editor email
        try {
          const stripResult = await photoStripService.createPhotoStrip(bookingId, customerEmail);

          if (stripResult.success) {
            console.log(`✓ Photo strip created: ${stripResult.stripId}`);

            // Send editor email
            await sendPhotoStripEditorEmail(customerEmail, {
              bookingId,
              stripId: stripResult.stripId,
              accessToken: stripResult.accessToken,
              eventDate: eventDate || booking.eventDate,
              productTitle: booking.productTitle || item.name
            });

            console.log(`✓ Photo strip editor email sent to ${redactEmail(customerEmail)}`);
          } else {
            console.error(`✗ Failed to create photo strip: ${stripResult.error}`);
          }
        } catch (stripError) {
          console.error('Error creating photo strip:', stripError);
          // Non-critical - order is still confirmed
        }

        // Lösche alle anderen PENDING Bookings für denselben Termin und Variante
        if (eventDate) {
          const variantId = item.variant_id;
          console.log(`Cleaning up other pending bookings for variant ${variantId} on ${eventDate}`);

          try {
            const cleanedCount = await bookingService.cleanupPendingBookingsForDate(
              `gid://shopify/ProductVariant/${variantId}`,
              eventDate,
              bookingId // Exclude die gerade bestätigte Booking
            );

            if (cleanedCount > 0) {
              console.log(`✓ Cleaned up ${cleanedCount} other pending booking(s) for this date`);
            }
          } catch (cleanupError) {
            console.error('Error cleaning up pending bookings:', cleanupError);
            // Nicht critical - Order ist ja confirmed
          }
        }
      } else {
        console.error(`✗ Failed to confirm booking ${bookingId}:`, result.error);
      }
    }

    // NEW: Save order to database for admin panel
    try {
      console.log('[Webhook] ===== STARTING ORDER DATABASE SAVE =====');
      console.log('[Webhook] Order Name:', orderData.name);
      console.log('[Webhook] Order Shopify ID:', orderData.admin_graphql_api_id);
      const orderId = await orderService.createOrderFromShopify(orderData);
      console.log(`[Webhook] ✓ ORDER SAVED SUCCESSFULLY - Database ID: ${orderId}`);
      console.log('[Webhook] ===== ORDER SAVE COMPLETE =====');
    } catch (dbError) {
      console.error('[Webhook] ❌ ERROR SAVING ORDER TO DATABASE');
      console.error('[Webhook] Error message:', dbError.message);
      console.error('[Webhook] Error stack:', dbError.stack);
      console.error('[Webhook] Error details:', JSON.stringify(dbError, null, 2));
      // Don't fail the webhook - order is still confirmed
    }

    // NEW: Track discount code usage
    if (orderData.discount_applications && orderData.discount_applications.length > 0) {
      console.log('Tracking discount code usage...');

      for (const discount of orderData.discount_applications) {
        // Only track discount codes (not automatic discounts)
        if (discount.type === 'discount_code') {
          try {
            const discountAmount = parseFloat(discount.value) || 0;
            const orderTotal = parseFloat(orderData.total_price) || 0;
            const customerEmail = orderData.customer?.email || orderData.email;

            await discountService.trackUsage(discount.code, {
              shopifyOrderId: `gid://shopify/Order/${orderData.id}`,
              customerEmail,
              discountAmount,
              orderTotal,
            });

            console.log(`✓ Tracked usage of discount code: ${discount.code}`);
          } catch (discountError) {
            console.error(`Error tracking discount code ${discount.code}:`, discountError);
            // Non-critical - order is still confirmed
          }
        }
      }
    }

    console.log('=====================================\n');

    // Shopify erwartet 200 OK
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * Shopify Webhook: Order Updated
 *
 * Called when a Shopify order is updated (status changes, etc.)
 */
router.post('/shopify/orders/updated', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify Shopify Webhook Signature
    const hmac = req.get('X-Shopify-Hmac-SHA256');

    if (!verifyWebhook(req.body, hmac)) {
      console.error('Invalid webhook signature');
      return res.status(401).send('Unauthorized');
    }

    // Parse order data
    const orderData = JSON.parse(req.body.toString());
    console.log('[Webhook] Order Updated:', orderData.name);

    // Update order status in database
    await orderService.updateOrderStatus(
      `gid://shopify/Order/${orderData.id}`,
      orderData.financial_status || 'pending',
      orderData.financial_status,
      orderData.fulfillment_status || 'unfulfilled'
    );

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing order update webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * Shopify Webhook: Order Cancelled
 *
 * Called when a Shopify order is cancelled
 * - Updates order status to 'cancelled'
 * - Cancels associated bookings and releases inventory
 */
router.post('/shopify/orders/cancelled', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify Shopify Webhook Signature
    const hmac = req.get('X-Shopify-Hmac-SHA256');

    if (!verifyWebhook(req.body, hmac)) {
      console.error('Invalid webhook signature');
      return res.status(401).send('Unauthorized');
    }

    // Parse order data
    const orderData = JSON.parse(req.body.toString());
    console.log('\n=== SHOPIFY WEBHOOK: ORDER CANCELLED ===');
    console.log('Order Name:', orderData.name);
    console.log('Order ID:', orderData.id);

    const orderId = `gid://shopify/Order/${orderData.id}`;

    // 1. Update order status in database
    await orderService.updateOrderStatus(
      orderId,
      'cancelled',
      'refunded',
      'cancelled'
    );

    // 2. Find and cancel all bookings for this order
    const fotoboxItems = orderData.line_items.filter(item => {
      const bookingId = item.properties?.find(p => p.name === '_booking_id');
      return bookingId !== undefined;
    });

    console.log('Fotobox items to cancel:', fotoboxItems.length);

    for (const item of fotoboxItems) {
      const bookingId = item.properties.find(p => p.name === '_booking_id')?.value;

      if (bookingId) {
        console.log(`Cancelling booking ${bookingId}`);
        await bookingService.cancelBooking(
          bookingId,
          `Order cancelled in Shopify: ${orderData.name}`
        );
      }
    }

    console.log('✓ Order cancellation processed successfully');
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing order cancellation webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * Shopify Webhook: Refund Create
 *
 * Called when a refund is created for an order
 * - If full refund: cancel bookings and release inventory
 * - If partial refund: log for manual review
 */
router.post('/shopify/refunds/create', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify Shopify Webhook Signature
    const hmac = req.get('X-Shopify-Hmac-SHA256');

    if (!verifyWebhook(req.body, hmac)) {
      console.error('Invalid webhook signature');
      return res.status(401).send('Unauthorized');
    }

    // Parse refund data
    const refundData = JSON.parse(req.body.toString());
    console.log('\n=== SHOPIFY WEBHOOK: REFUND CREATE ===');
    console.log('Order ID:', refundData.order_id);
    console.log('Refund ID:', refundData.id);
    console.log('Refund Line Items:', refundData.refund_line_items?.length);

    const orderId = `gid://shopify/Order/${refundData.order_id}`;

    // Check which line items were refunded
    const refundedBookingIds = [];

    for (const refundItem of refundData.refund_line_items || []) {
      // Find booking ID in line item properties
      const lineItem = refundItem.line_item;
      const bookingId = lineItem.properties?.find(p => p.name === '_booking_id')?.value;

      if (bookingId) {
        refundedBookingIds.push(bookingId);
      }
    }

    console.log('Refunded booking IDs:', refundedBookingIds);

    // Cancel each refunded booking
    for (const bookingId of refundedBookingIds) {
      console.log(`Cancelling booking ${bookingId} due to refund`);
      await bookingService.cancelBooking(
        bookingId,
        `Refund issued for order ${orderId}`
      );
    }

    // Update order status
    await orderService.updateOrderStatus(
      orderId,
      'refunded',
      'refunded',
      'unfulfilled'
    );

    console.log('✓ Refund processed successfully');
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing refund webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * Verifiziert Shopify Webhook Signature
 * Security: ALWAYS requires SHOPIFY_WEBHOOK_SECRET (no dev bypass)
 *
 * @param {Buffer} body - Raw request body
 * @param {string} hmac - HMAC from header
 * @returns {boolean}
 */
function verifyWebhook(body, hmac) {
  if (!process.env.SHOPIFY_WEBHOOK_SECRET) {
    console.error('[Webhook Security] SHOPIFY_WEBHOOK_SECRET not configured - rejecting webhook');
    return false; // Security: NEVER allow webhooks without secret verification
  }

  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  return hash === hmac;
}

export default router;
