#!/usr/bin/env node

/**
 * Script zum Erstellen einer Testbuchung
 * Usage: node create-test-booking.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'db/fotobox.db');

console.log('[Test Booking] Using database:', DB_PATH);

// Create database connection
const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Prepare insert query
const insertBooking = db.prepare(`
  INSERT INTO bookings (
    booking_id,
    variant_gid,
    product_title,
    variant_title,
    customer_email,
    customer_name,
    event_date,
    start_date,
    end_date,
    total_days,
    status,
    order_id,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`);

// Generate test booking data
const testBooking = {
  bookingId: uuidv4(),
  variantGid: 'gid://shopify/ProductVariant/47437795917924', // Premium Weiß
  productTitle: 'Premium Fotobox',
  variantTitle: 'Weiß',
  customerEmail: 'test@example.com',
  customerName: 'Max Mustermann',
  eventDate: getDateString(7), // 7 Tage in der Zukunft
  startDate: getDateString(7),
  endDate: getDateString(7),
  totalDays: 1,
  status: 'confirmed', // confirmed status so it appears in admin panel
  orderId: 'TEST-' + Date.now()
};

// Helper function to get date string (YYYY-MM-DD) for X days from now
function getDateString(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
}

try {
  console.log('\n[Test Booking] Creating test booking...');
  console.log('Booking Details:');
  console.log('  - ID:', testBooking.bookingId);
  console.log('  - Product:', testBooking.productTitle, '-', testBooking.variantTitle);
  console.log('  - Customer:', testBooking.customerName, '(' + testBooking.customerEmail + ')');
  console.log('  - Event Date:', testBooking.eventDate);
  console.log('  - Status:', testBooking.status);
  console.log('  - Order ID:', testBooking.orderId);

  insertBooking.run(
    testBooking.bookingId,
    testBooking.variantGid,
    testBooking.productTitle,
    testBooking.variantTitle,
    testBooking.customerEmail,
    testBooking.customerName,
    testBooking.eventDate,
    testBooking.startDate,
    testBooking.endDate,
    testBooking.totalDays,
    testBooking.status,
    testBooking.orderId
  );

  console.log('\n✅ Test booking created successfully!');
  console.log('\nYou can now:');
  console.log('  1. Open the Admin Panel: https://fotobox-booking-production.up.railway.app/admin/');
  console.log('  2. Go to the "Buchungen" tab');
  console.log('  3. See the test booking in the calendar and list');

  // Verify booking was created
  const verify = db.prepare('SELECT * FROM bookings WHERE booking_id = ?').get(testBooking.bookingId);
  if (verify) {
    console.log('\n✓ Verified in database');
  }

} catch (error) {
  console.error('\n❌ Error creating test booking:', error.message);
  process.exit(1);
} finally {
  db.close();
}
