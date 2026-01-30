import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Führt Datenbank-Migrationen aus
 * Wird beim Server-Start automatisch aufgerufen
 */
export function runMigrations(db) {
  console.log('[Migrations] Starting database migrations...');

  try {
    // Erstelle Migrations-Tabelle falls nicht vorhanden
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Hole bereits ausgeführte Migrationen
    const executedMigrations = db.prepare('SELECT name FROM migrations').all();
    const executedNames = new Set(executedMigrations.map(m => m.name));

    // Load all migration files from migrations directory
    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort alphabetically (001, 002, 003, etc.)

    for (const file of migrationFiles) {
      const migrationName = file.replace('.sql', '');

      if (!executedNames.has(migrationName)) {
        console.log(`[Migrations] Running migration: ${migrationName}`);

        const migrationPath = path.join(migrationsDir, file);
        const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

        try {
          // Run migration in transaction
          const runMigration = db.transaction(() => {
            db.exec(migrationSQL);
            db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migrationName);
          });

          runMigration();
          console.log(`[Migrations] ✓ Successfully executed: ${migrationName}`);
        } catch (error) {
          // Check if it's a duplicate column error (migration already applied)
          if (error.code === 'SQLITE_ERROR' && error.message.includes('duplicate column')) {
            console.log(`[Migrations] ⚠️  Migration ${migrationName} appears already applied, marking as executed`);
            db.prepare('INSERT OR IGNORE INTO migrations (name) VALUES (?)').run(migrationName);
          } else {
            throw error;
          }
        }
      } else {
        console.log(`[Migrations] ⏭️  Skipping already executed: ${migrationName}`);
      }
    }

    console.log('[Migrations] ✓ All migrations completed successfully');

  } catch (error) {
    console.error('[Migrations] ❌ Error running migrations:', error);
    throw error;
  }
}

/**
 * Standalone-Ausführung für manuelle Migration
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'fotobox.db');
  console.log('[Migrations] Running migrations on database:', DB_PATH);

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  db.close();

  console.log('[Migrations] Done! Database updated.');
}
