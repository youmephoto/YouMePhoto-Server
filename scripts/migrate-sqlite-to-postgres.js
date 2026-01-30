#!/usr/bin/env node

/**
 * SQLite to PostgreSQL Migration Script
 *
 * This script migrates all data from SQLite to PostgreSQL.
 * Run this AFTER setting up the PostgreSQL database in Railway.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node migrate-sqlite-to-postgres.js
 *
 * Or with dotenv:
 *   node migrate-sqlite-to-postgres.js
 */

import Database from 'better-sqlite3';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SQLite database path
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '../db/fotobox.db');

// PostgreSQL connection
const PG_URL = process.env.DATABASE_URL;

if (!PG_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  console.error('   Set it to your Railway PostgreSQL connection string');
  process.exit(1);
}

console.log('🚀 SQLite to PostgreSQL Migration');
console.log('==================================');
console.log(`SQLite source: ${SQLITE_PATH}`);
console.log(`PostgreSQL target: ${PG_URL.replace(/:[^:@]+@/, ':****@')}`);
console.log('');

// Tables to migrate (in order of dependencies)
const TABLES_TO_MIGRATE = [
  'variant_inventory',
  'inventory_history',
  'admin_users',
  'blocked_dates',
  'bookings',
  'features',
  'product_features',
  'customers',
  'customer_tags',
  'customer_notes',
  'orders',
  'order_items',
  'order_status_history',
  'inventory_schedule',
  'shipping_history',
  'photo_strips',
  'design_templates',
  'uploaded_images',
  'photo_strip_versions',
  'discount_codes',
  'discount_code_products',
  'discount_code_usage',
  'discount_code_sync_log',
];

async function migrateTable(sqlite, pgClient, tableName) {
  console.log(`  📦 Migrating ${tableName}...`);

  try {
    // Check if table exists in SQLite
    const tableExists = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name=?
    `).get(tableName);

    if (!tableExists) {
      console.log(`     ⏭️  Table ${tableName} does not exist in SQLite, skipping`);
      return { table: tableName, migrated: 0, skipped: true };
    }

    // Get all rows from SQLite
    const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();

    if (rows.length === 0) {
      console.log(`     ⏭️  Table ${tableName} is empty, skipping`);
      return { table: tableName, migrated: 0, skipped: true };
    }

    // Get column names from first row
    const columns = Object.keys(rows[0]);

    // Skip 'id' column for SERIAL tables (PostgreSQL will auto-generate)
    const insertColumns = columns.filter(col => col !== 'id' || tableName === 'variant_inventory');

    // For variant_inventory, id is variant_gid (the primary key)
    // For other tables, we want to preserve IDs to maintain foreign key relationships
    const useId = tableName !== 'variant_inventory';

    let migratedCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      try {
        const values = columns.map((col, index) => {
          const val = row[col];
          // Convert SQLite boolean (0/1) to PostgreSQL boolean
          if (val === 0 || val === 1) {
            // Check if it's likely a boolean field
            if (col === 'enabled' || col === 'is_active' || col === 'applies_to_all_products') {
              return val === 1;
            }
          }
          return val;
        });

        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

        // Use OVERRIDING SYSTEM VALUE to preserve IDs for tables with SERIAL
        const overriding = useId && columns.includes('id') ? 'OVERRIDING SYSTEM VALUE' : '';

        const query = `
          INSERT INTO ${tableName} (${columns.join(', ')})
          ${overriding}
          VALUES (${placeholders})
          ON CONFLICT DO NOTHING
        `;

        await pgClient.query(query, values);
        migratedCount++;
      } catch (error) {
        // Log but continue on individual row errors
        if (!error.message.includes('duplicate key')) {
          console.log(`     ⚠️  Error migrating row in ${tableName}: ${error.message}`);
        }
        errorCount++;
      }
    }

    // Reset sequence for SERIAL columns
    if (useId && columns.includes('id') && migratedCount > 0) {
      try {
        await pgClient.query(`
          SELECT setval(pg_get_serial_sequence('${tableName}', 'id'),
                        COALESCE((SELECT MAX(id) FROM ${tableName}), 1))
        `);
      } catch (e) {
        // Ignore sequence errors for tables without sequences
      }
    }

    console.log(`     ✓ Migrated ${migratedCount}/${rows.length} rows`);
    if (errorCount > 0) {
      console.log(`     ⚠️  ${errorCount} rows skipped (duplicates or errors)`);
    }

    return { table: tableName, migrated: migratedCount, total: rows.length, errors: errorCount };
  } catch (error) {
    console.error(`     ❌ Failed to migrate ${tableName}: ${error.message}`);
    return { table: tableName, migrated: 0, error: error.message };
  }
}

async function main() {
  // Connect to SQLite
  console.log('📂 Opening SQLite database...');
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`❌ SQLite database not found at ${SQLITE_PATH}`);
    process.exit(1);
  }
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  console.log('   ✓ SQLite connected');

  // Connect to PostgreSQL
  console.log('🐘 Connecting to PostgreSQL...');
  const pgPool = new pg.Pool({
    connectionString: PG_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const pgClient = await pgPool.connect();
  console.log('   ✓ PostgreSQL connected');
  console.log('');

  // Initialize PostgreSQL schema
  console.log('📋 Initializing PostgreSQL schema...');
  const schemaPath = path.join(__dirname, '../db/schema-postgres.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await pgClient.query(schema);
    console.log('   ✓ Schema initialized');
  } else {
    console.log('   ⚠️  Schema file not found, assuming tables exist');
  }
  console.log('');

  // Migrate tables
  console.log('🔄 Starting data migration...');
  console.log('');

  const results = [];
  for (const table of TABLES_TO_MIGRATE) {
    const result = await migrateTable(sqlite, pgClient, table);
    results.push(result);
  }

  // Summary
  console.log('');
  console.log('📊 Migration Summary');
  console.log('====================');

  let totalMigrated = 0;
  let totalErrors = 0;
  let tablesWithData = 0;

  for (const result of results) {
    if (!result.skipped && !result.error) {
      totalMigrated += result.migrated;
      totalErrors += result.errors || 0;
      if (result.migrated > 0) tablesWithData++;
    }
  }

  console.log(`Tables with data: ${tablesWithData}`);
  console.log(`Total rows migrated: ${totalMigrated}`);
  if (totalErrors > 0) {
    console.log(`Total rows skipped: ${totalErrors}`);
  }
  console.log('');
  console.log('✅ Migration complete!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Update your Railway service to use DATABASE_URL');
  console.log('2. Deploy the PostgreSQL-compatible server code');
  console.log('3. Test all functionality');

  // Cleanup
  pgClient.release();
  await pgPool.end();
  sqlite.close();
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
