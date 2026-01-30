import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../db/fotobox.db');
const MIGRATIONS_DIR = path.join(__dirname, '../db/migrations');

console.log('[Migration] Database path:', DB_PATH);
console.log('[Migration] Migrations directory:', MIGRATIONS_DIR);

// Connect to database
const db = new Database(DB_PATH);

// Get migration file from command line argument
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node runMigration.js <migration-file>');
  console.error('Example: node runMigration.js 002_add_multiday_fields.sql');
  process.exit(1);
}

const migrationPath = path.join(MIGRATIONS_DIR, migrationFile);

if (!fs.existsSync(migrationPath)) {
  console.error(`Migration file not found: ${migrationPath}`);
  process.exit(1);
}

console.log(`[Migration] Running migration: ${migrationFile}`);

try {
  // Read migration SQL
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  // Execute migration in a transaction
  const migrate = db.transaction(() => {
    db.exec(sql);
  });

  migrate();

  console.log('[Migration] ✓ Migration completed successfully');

  // Show current schema
  const tables = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type='table' AND name='bookings'
  `).get();

  console.log('\n[Migration] Current bookings table schema:');
  console.log(tables.sql);

  // Show sample data
  const sampleBooking = db.prepare('SELECT * FROM bookings LIMIT 1').get();
  if (sampleBooking) {
    console.log('\n[Migration] Sample booking after migration:');
    console.log(JSON.stringify(sampleBooking, null, 2));
  }

} catch (error) {
  console.error('[Migration] ✗ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}
