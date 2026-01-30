#!/usr/bin/env node

/**
 * Migration Script: Add Shipping Fields
 * Adds shipping status, tracking, and history tables to database
 * Safe to run multiple times - skips existing columns/tables
 *
 * Usage:
 *   node server/scripts/migrate-shipping.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine database path based on environment
const dbPath = process.env.NODE_ENV === 'production'
  ? '/app/data/fotobox.db'
  : path.join(__dirname, '../db/fotobox.db');

console.log('📦 Shipping Fields Migration');
console.log('================================');
console.log(`Database: ${dbPath}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log('');

try {
  // Connect to database
  const db = new Database(dbPath);

  console.log('✓ Database connection established');

  // Get existing columns in bookings table
  const existingColumns = db.prepare(`PRAGMA table_info(bookings)`).all();
  const columnNames = existingColumns.map(col => col.name);

  console.log('✓ Checking existing columns...');

  // Define columns to add
  const columnsToAdd = [
    { name: 'shipping_status', sql: `ALTER TABLE bookings ADD COLUMN shipping_status TEXT DEFAULT 'not_shipped'` },
    { name: 'tracking_number', sql: `ALTER TABLE bookings ADD COLUMN tracking_number TEXT` },
    { name: 'shipping_carrier', sql: `ALTER TABLE bookings ADD COLUMN shipping_carrier TEXT DEFAULT 'DHL'` },
    { name: 'shipped_at', sql: `ALTER TABLE bookings ADD COLUMN shipped_at TIMESTAMP` },
    { name: 'delivered_at', sql: `ALTER TABLE bookings ADD COLUMN delivered_at TIMESTAMP` },
    { name: 'returned_at', sql: `ALTER TABLE bookings ADD COLUMN returned_at TIMESTAMP` },
    { name: 'shipping_label_url', sql: `ALTER TABLE bookings ADD COLUMN shipping_label_url TEXT` },
    { name: 'setup_instructions_url', sql: `ALTER TABLE bookings ADD COLUMN setup_instructions_url TEXT DEFAULT '/docs/setup-guide.pdf'` },
    { name: 'notes', sql: `ALTER TABLE bookings ADD COLUMN notes TEXT` }
  ];

  console.log('');
  console.log('🔧 Adding columns to bookings table...');
  console.log('');

  let addedCount = 0;
  let skippedCount = 0;

  for (const col of columnsToAdd) {
    if (columnNames.includes(col.name)) {
      console.log(`  ⏭️  ${col.name} (already exists)`);
      skippedCount++;
    } else {
      try {
        db.exec(col.sql);
        console.log(`  ✅ ${col.name} (added)`);
        addedCount++;
      } catch (err) {
        console.log(`  ⚠️  ${col.name} (error: ${err.message})`);
      }
    }
  }

  console.log('');
  console.log(`📊 Columns: ${addedCount} added, ${skippedCount} skipped`);

  // Check if shipping_history table exists
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='shipping_history'
  `).all();

  if (tables.length === 0) {
    console.log('');
    console.log('🔧 Creating shipping_history table...');

    db.exec(`
      CREATE TABLE IF NOT EXISTS shipping_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id TEXT NOT NULL,
        tracking_number TEXT NOT NULL,
        status TEXT NOT NULL,
        status_description TEXT,
        location TEXT,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE
      )
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_shipping_history_booking ON shipping_history(booking_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_shipping_history_tracking ON shipping_history(tracking_number)`);

    console.log('  ✅ shipping_history table created');
  } else {
    console.log('');
    console.log('  ⏭️  shipping_history table (already exists)');
  }

  // Create indexes if they don't exist
  console.log('');
  console.log('🔧 Creating indexes...');

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_shipping_status ON bookings(shipping_status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_shipped_at ON bookings(shipped_at)`);
    console.log('  ✅ Indexes created');
  } catch (err) {
    console.log('  ⏭️  Indexes (already exist)');
  }

  // Verify final state
  console.log('');
  console.log('✓ Verifying migration...');

  const finalColumns = db.prepare(`PRAGMA table_info(bookings)`).all();
  const shippingColumns = finalColumns.filter(col =>
    ['shipping_status', 'tracking_number', 'shipping_carrier', 'shipped_at',
     'delivered_at', 'returned_at', 'shipping_label_url', 'setup_instructions_url', 'notes']
    .includes(col.name)
  );

  console.log(`  ✓ Bookings table has ${shippingColumns.length}/9 shipping columns`);

  const historyExists = db.prepare(`
    SELECT COUNT(*) as count FROM sqlite_master
    WHERE type='table' AND name='shipping_history'
  `).get();

  console.log(`  ✓ shipping_history table: ${historyExists.count === 1 ? 'exists' : 'missing'}`);

  // Check if any existing bookings need default shipping_status
  const bookingsCount = db.prepare('SELECT COUNT(*) as count FROM bookings').get();
  console.log('');
  console.log(`📊 Total bookings: ${bookingsCount.count}`);

  if (bookingsCount.count > 0) {
    const withShippingStatus = db.prepare(`
      SELECT COUNT(*) as count FROM bookings
      WHERE shipping_status IS NOT NULL
    `).get();
    console.log(`   - With shipping status: ${withShippingStatus.count}`);
  }

  db.close();
  console.log('');
  console.log('🎉 Migration complete! Database closed.');

} catch (error) {
  console.error('❌ Migration failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
