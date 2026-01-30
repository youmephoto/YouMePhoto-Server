#!/usr/bin/env node
/**
 * Cleanup Script: Remove all discount codes from database
 * Usage: node scripts/cleanup-discount-codes.js
 */

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = 'postgresql://postgres:FtxKRPOiKkxAMCEBgypOiZkxpSmkpvfh@gondola.proxy.rlwy.net:52060/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function cleanupDiscountCodes() {
  const client = await pool.connect();

  try {
    console.log('🗑️  Starting cleanup of discount codes...');

    // 1. Delete all entries from discount_code_products
    const productsResult = await client.query('DELETE FROM discount_code_products');
    console.log(`✓ Deleted ${productsResult.rowCount} entries from discount_code_products`);

    // 2. Delete all entries from discount_code_usage
    const usageResult = await client.query('DELETE FROM discount_code_usage');
    console.log(`✓ Deleted ${usageResult.rowCount} entries from discount_code_usage`);

    // 3. Delete all entries from discount_code_sync_log
    const syncResult = await client.query('DELETE FROM discount_code_sync_log');
    console.log(`✓ Deleted ${syncResult.rowCount} entries from discount_code_sync_log`);

    // 4. Delete all entries from discount_codes
    const codesResult = await client.query('DELETE FROM discount_codes');
    console.log(`✓ Deleted ${codesResult.rowCount} entries from discount_codes`);

    console.log('');
    console.log('🎉 Cleanup complete! All discount codes have been removed.');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanupDiscountCodes()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
