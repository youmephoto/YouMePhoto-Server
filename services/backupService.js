import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BackupService {
  constructor() {
    this.DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../db/fotobox.db');

    // Use Railway volume for backups (persistent across deployments)
    // In production: /app/data/backups
    // In development: ./server/backups
    this.BACKUP_DIR = process.env.NODE_ENV === 'production'
      ? '/app/data/backups'
      : path.join(__dirname, '../backups');
  }

  /**
   * Export database to JSON format
   * This is safer for Git and easier to read/restore than raw SQLite
   */
  async exportToJSON() {
    const db = new Database(this.DB_PATH, { readonly: true });

    try {
      const backup = {
        exportDate: new Date().toISOString(),
        version: '1.0',
        data: {
          bookings: db.prepare('SELECT * FROM bookings').all(),
          blockedDates: db.prepare('SELECT * FROM blocked_dates').all(),
          variantInventory: db.prepare('SELECT * FROM variant_inventory').all(),
          adminUsers: db.prepare('SELECT id, username, created_at FROM admin_users').all() // Don't export passwords!
        },
        stats: {
          totalBookings: db.prepare('SELECT COUNT(*) as count FROM bookings').get().count,
          confirmedBookings: db.prepare('SELECT COUNT(*) as count FROM bookings WHERE status = ?').get('confirmed').count,
          totalBlockedDates: db.prepare('SELECT COUNT(*) as count FROM blocked_dates').get().count
        }
      };

      return backup;
    } finally {
      db.close();
    }
  }

  /**
   * Save backup to local file
   */
  async saveLocalBackup() {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.BACKUP_DIR, { recursive: true });

      const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const backupPath = path.join(this.BACKUP_DIR, `backup-${timestamp}.json`);

      const backupData = await this.exportToJSON();
      await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));

      console.log(`[Backup] Local backup saved: ${backupPath}`);

      // Clean up old backups (keep last 7 days)
      await this.cleanupOldBackups(7);

      return {
        success: true,
        path: backupPath,
        size: (await fs.stat(backupPath)).size
      };
    } catch (error) {
      console.error('[Backup] Error saving local backup:', error);
      throw error;
    }
  }

  /**
   * Clean up old backup files
   */
  async cleanupOldBackups(daysToKeep = 7) {
    try {
      const files = await fs.readdir(this.BACKUP_DIR);
      const now = new Date();
      const cutoffDate = new Date(now.getTime() - (daysToKeep * 24 * 60 * 60 * 1000));

      for (const file of files) {
        if (!file.startsWith('backup-')) continue;

        const filePath = path.join(this.BACKUP_DIR, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          console.log(`[Backup] Deleted old backup: ${file}`);
        }
      }
    } catch (error) {
      console.error('[Backup] Error cleaning up old backups:', error);
    }
  }

  /**
   * Create a full SQLite backup file
   * This creates a copy of the entire database file
   */
  async createSQLiteBackup() {
    try {
      // Include time in timestamp to avoid conflicts
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
      const backupPath = path.join(this.BACKUP_DIR, `fotobox-${timestamp}.db`);

      // Ensure backup directory exists
      await fs.mkdir(this.BACKUP_DIR, { recursive: true });

      // Delete existing file if it exists (to allow VACUUM INTO to work)
      try {
        await fs.unlink(backupPath);
      } catch (err) {
        // File doesn't exist, that's fine
      }

      // Use SQLite backup API for atomic backup
      const sourceDb = new Database(this.DB_PATH, { readonly: true });

      try {
        // SQLite's VACUUM INTO creates a clean copy
        sourceDb.exec(`VACUUM INTO '${backupPath}'`);
        console.log(`[Backup] SQLite backup created: ${backupPath}`);
      } finally {
        sourceDb.close();
      }

      const stats = await fs.stat(backupPath);

      return {
        success: true,
        path: backupPath,
        size: stats.size,
        type: 'sqlite'
      };
    } catch (error) {
      console.error('[Backup] SQLite backup failed:', error);
      throw error;
    }
  }

  /**
   * Create both JSON and SQLite backups
   * JSON for easy restore/viewing, SQLite for complete backup
   */
  async createFullBackup() {
    try {
      const results = await Promise.all([
        this.saveLocalBackup(),    // JSON backup
        this.createSQLiteBackup()  // Full SQLite backup
      ]);

      console.log('[Backup] Full backup completed (JSON + SQLite)');

      return {
        success: true,
        backups: results
      };
    } catch (error) {
      console.error('[Backup] Full backup failed:', error);
      throw error;
    }
  }

  /**
   * Restore from JSON backup
   */
  async restoreFromJSON(backupPath) {
    const db = new Database(this.DB_PATH);

    try {
      const backupData = JSON.parse(await fs.readFile(backupPath, 'utf-8'));

      db.exec('BEGIN TRANSACTION');

      // Clear existing data
      db.exec('DELETE FROM bookings');
      db.exec('DELETE FROM blocked_dates');
      db.exec('DELETE FROM variant_inventory');

      // Restore bookings
      const insertBooking = db.prepare(`
        INSERT INTO bookings (
          booking_id, variant_gid, product_title, variant_title,
          customer_email, customer_name, event_date, start_date, end_date,
          total_days, status, order_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const booking of backupData.data.bookings) {
        insertBooking.run(
          booking.booking_id,
          booking.variant_gid,
          booking.product_title,
          booking.variant_title,
          booking.customer_email,
          booking.customer_name,
          booking.event_date,
          booking.start_date,
          booking.end_date,
          booking.total_days,
          booking.status,
          booking.order_id,
          booking.created_at,
          booking.updated_at
        );
      }

      // Restore blocked dates
      const insertBlocked = db.prepare(`
        INSERT INTO blocked_dates (id, start_date, end_date, reason, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const block of backupData.data.blockedDates) {
        insertBlocked.run(
          block.id,
          block.start_date,
          block.end_date,
          block.reason,
          block.created_at
        );
      }

      // Restore variant inventory
      const insertInventory = db.prepare(`
        INSERT INTO variant_inventory (variant_gid, total_quantity, product_title, last_synced)
        VALUES (?, ?, ?, ?)
      `);

      for (const inv of backupData.data.variantInventory) {
        insertInventory.run(
          inv.variant_gid,
          inv.total_quantity,
          inv.product_title,
          inv.last_synced
        );
      }

      db.exec('COMMIT');

      console.log(`[Backup] Restore completed from ${backupPath}`);
      return { success: true, restored: backupData.stats };
    } catch (error) {
      db.exec('ROLLBACK');
      console.error('[Backup] Restore failed:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  /**
   * List all available backups
   */
  async listBackups() {
    try {
      const files = await fs.readdir(this.BACKUP_DIR);

      const backups = await Promise.all(
        files
          .filter(f => f.startsWith('backup-') || f.startsWith('fotobox-'))
          .map(async file => {
            const filePath = path.join(this.BACKUP_DIR, file);
            const stats = await fs.stat(filePath);

            return {
              name: file,
              path: filePath,
              size: stats.size,
              created: stats.mtime,
              type: file.endsWith('.db') ? 'sqlite' : 'json'
            };
          })
      );

      return backups.sort((a, b) => b.created - a.created);
    } catch (error) {
      console.error('[Backup] Error listing backups:', error);
      return [];
    }
  }

  /**
   * Schedule automatic backups
   * Runs daily at 3 AM
   */
  scheduleAutomaticBackups() {
    const runBackup = async () => {
      try {
        console.log('[Backup] Running scheduled backup...');
        await this.createFullBackup(); // Create both JSON and SQLite backups
        await this.cleanupOldBackups(30); // Keep 30 days of backups
      } catch (error) {
        console.error('[Backup] Scheduled backup failed:', error);
      }
    };

    // Run backup daily at 3 AM
    const scheduleDaily = () => {
      const now = new Date();
      const next3AM = new Date(now);
      next3AM.setHours(3, 0, 0, 0);

      // If it's past 3 AM today, schedule for tomorrow
      if (now > next3AM) {
        next3AM.setDate(next3AM.getDate() + 1);
      }

      const msUntil3AM = next3AM.getTime() - now.getTime();

      setTimeout(() => {
        runBackup();
        // Schedule next backup (every 24 hours)
        setInterval(runBackup, 24 * 60 * 60 * 1000);
      }, msUntil3AM);

      console.log(`[Backup] Next automatic backup scheduled for: ${next3AM.toLocaleString('de-DE')}`);
      console.log(`[Backup] Backups are stored in: ${this.BACKUP_DIR}`);
      console.log(`[Backup] Keeping last 30 days of backups`);
    };

    scheduleDaily();

    // Also run backup on startup (after 1 minute to let server stabilize)
    setTimeout(runBackup, 60 * 1000);
  }
}

export default BackupService;
