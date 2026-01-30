import db from '../db/database.js';

console.log('[Migration] Adding blocked_dates table...\n');

try {
  // Create blocked_dates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('[Migration] ✓ blocked_dates table created');

  // Create index
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_blocked_dates_range ON blocked_dates(start_date, end_date);
  `);

  console.log('[Migration] ✓ Index created');

  // Check if table exists and show structure
  const tableInfo = db.prepare('PRAGMA table_info(blocked_dates)').all();
  console.log('\n[Migration] Table structure:');
  tableInfo.forEach(col => {
    console.log(`  - ${col.name}: ${col.type}`);
  });

  console.log('\n[Migration] ✅ Migration completed successfully!');
} catch (error) {
  console.error('[Migration] ❌ Error:', error);
  process.exit(1);
}
