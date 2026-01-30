#!/usr/bin/env node

/**
 * Fix guest@shopify.com emails in existing bookings
 *
 * This script updates bookings that have guest@shopify.com as customer_email
 * by looking up the real customer email from the orders and customers tables.
 */

import FotoboxInventoryManager from '../services/inventoryManager.js';
import { orderQueries, customerQueries } from '../db/database.js';

const inventoryManager = new FotoboxInventoryManager();

async function fixGuestEmails() {
  console.log('🔍 Searching for bookings with guest@shopify.com...\n');

  // Get all bookings
  const allBookings = await inventoryManager.getAllBookings();

  // Filter bookings with guest emails
  const guestBookings = allBookings.filter(booking =>
    booking.customerEmail &&
    (booking.customerEmail.includes('guest') || booking.customerEmail.includes('@shopify.com'))
  );

  console.log(`Found ${guestBookings.length} bookings with guest emails\n`);

  if (guestBookings.length === 0) {
    console.log('✓ No guest emails found - all bookings are already correct!');
    return;
  }

  let fixed = 0;
  let notFound = 0;

  for (const booking of guestBookings) {
    console.log(`\n📧 Fixing booking: ${booking.bookingId}`);
    console.log(`   Current email: ${booking.customerEmail}`);

    let realEmail = null;

    // Try to find real email via order_id
    if (booking.orderId) {
      try {
        // Get order by Shopify Order ID
        const order = orderQueries.getByShopifyOrderId(booking.orderId);

        if (order && order.customer_id) {
          // Get customer from customers table
          const customer = customerQueries.getById(order.customer_id);

          if (customer && customer.email) {
            // Make sure it's not also a guest email
            if (!customer.email.includes('guest') && !customer.email.includes('@shopify.com')) {
              realEmail = customer.email;
              console.log(`   ✓ Found real email via order: ${realEmail}`);
            }
          }
        }
      } catch (err) {
        console.log(`   ⚠ Could not lookup via order: ${err.message}`);
      }
    }

    // If still no email found, skip for now
    // (Could be enhanced to search by name, but requires additional query)

    // Update booking if real email found
    if (realEmail) {
      try {
        await inventoryManager.updateBooking(booking.bookingId, {
          ...booking,
          customerEmail: realEmail
        });

        console.log(`   ✅ Updated to: ${realEmail}`);
        fixed++;
      } catch (err) {
        console.log(`   ❌ Failed to update: ${err.message}`);
      }
    } else {
      console.log(`   ❌ Could not find real email - keeping guest@shopify.com`);
      notFound++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Total guest bookings: ${guestBookings.length}`);
  console.log(`   ✅ Fixed: ${fixed}`);
  console.log(`   ❌ Not found: ${notFound}`);
  console.log('='.repeat(60) + '\n');
}

// Run the fix
fixGuestEmails()
  .then(() => {
    console.log('✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
