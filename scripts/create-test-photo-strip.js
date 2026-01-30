#!/usr/bin/env node

/**
 * Create a test photo strip for development/testing
 * Usage: node create-test-photo-strip.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, '../db/fotobox.db'));

// Generate test data
const stripId = `strip_test_${Date.now()}`;
const bookingId = `test_booking_${Date.now()}`;
const customerEmail = 'test@example.com';
const accessToken = crypto.randomBytes(32).toString('hex');
const accessExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

console.log('🎨 Creating test photo strip...\n');

try {
  // Create photo strip
  const result = db.prepare(`
    INSERT INTO photo_strips (
      strip_id,
      booking_id,
      customer_email,
      design_data,
      status,
      access_token,
      access_expires_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    stripId,
    bookingId,
    customerEmail,
    JSON.stringify({ version: '1.0', objects: [] }),
    'draft',
    accessToken,
    accessExpiresAt.toISOString()
  );

  if (result.changes > 0) {
    console.log('✅ Test photo strip created successfully!\n');
    console.log('📋 Test Details:');
    console.log('================');
    console.log(`Strip ID:       ${stripId}`);
    console.log(`Booking ID:     ${bookingId}`);
    console.log(`Email:          ${customerEmail}`);
    console.log(`Access Token:   ${accessToken}`);
    console.log(`Expires:        ${accessExpiresAt.toISOString()}\n`);

    // Get the customer portal URL from environment or use default
    const customerPortalUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
    const editorUrl = `${customerPortalUrl}/photo-strip-editor?strip=${stripId}&token=${accessToken}`;

    console.log('🔗 Editor URL:');
    console.log('==============');
    console.log(editorUrl);
    console.log('\n');

    console.log('💡 Tip: Copy the URL above and open it in your browser to test the editor!');
  } else {
    console.error('❌ Failed to create test photo strip');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error creating test photo strip:', error.message);
  process.exit(1);
} finally {
  db.close();
}
