import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Führt Datenbank-Migrationen für PostgreSQL aus
 * Wird beim Server-Start automatisch aufgerufen
 */
export async function runMigrations(pool) {
  console.log('[Migrations] Starting PostgreSQL migrations...');

  const client = await pool.connect();
  try {
    // Erstelle Migrations-Tabelle falls nicht vorhanden
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Hole bereits ausgeführte Migrationen
    const result = await client.query('SELECT name FROM migrations');
    const executedNames = new Set(result.rows.map(m => m.name));

    // Load all migration files from migrations directory
    const migrationsDir = path.join(__dirname, 'migrations');

    // Create directory if it doesn't exist
    if (!fs.existsSync(migrationsDir)) {
      console.log('[Migrations] No migrations directory found, skipping migrations');
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const migrationName = file.replace('.sql', '');

      if (!executedNames.has(migrationName)) {
        console.log(`[Migrations] Running migration: ${migrationName}`);

        const migrationPath = path.join(migrationsDir, file);
        const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

        try {
          // Run migration in transaction
          await client.query('BEGIN');
          await client.query(migrationSQL);
          await client.query('INSERT INTO migrations (name) VALUES ($1)', [migrationName]);
          await client.query('COMMIT');
          console.log(`[Migrations] ✓ Successfully executed: ${migrationName}`);
        } catch (error) {
          await client.query('ROLLBACK');
          // Check if it's a duplicate column/table error (migration already applied)
          if (error.code === '42701' || error.code === '42P07') {
            console.log(`[Migrations] ⚠️  Migration ${migrationName} appears already applied, marking as executed`);
            await client.query('INSERT INTO migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [migrationName]);
          } else {
            throw error;
          }
        }
      } else {
        console.log(`[Migrations] ⏭️  Skipping already executed: ${migrationName}`);
      }
    }

    console.log('[Migrations] ✓ All migrations completed successfully');

  } finally {
    client.release();
  }
}

/**
 * Standalone-Ausführung für manuelle Migration
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  import('pg').then(async ({ default: pg }) => {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    console.log('[Migrations] Running migrations...');
    await runMigrations(pool);
    await pool.end();
    console.log('[Migrations] Done! Database updated.');
  });
}
