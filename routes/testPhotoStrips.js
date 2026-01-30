import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/test/photo-strips/create
 * Create a test photo strip for development
 * This route is separate from admin.js to avoid importing database.js
 * which has prepared statements that require the bookings table
 */
router.post('/photo-strips/create', requireAuth, async (req, res) => {
  try {
    console.log('[TEST] Starting test photo strip creation...');

    const Database = (await import('better-sqlite3')).default;
    const crypto = await import('crypto');
    const { v4: uuidv4 } = await import('uuid');

    console.log('[TEST] About to connect to database...');
    const dbPath = process.env.NODE_ENV === 'production'
      ? '/app/data/fotobox.db'
      : './server/db/fotobox.db';
    console.log('[TEST] Database path:', dbPath);

    const db = new Database(dbPath);
    console.log('[TEST] Database connected');

    // List all tables to debug
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('[TEST] Tables in database:', tables.map(t => t.name).join(', '));

    // Disable foreign key constraints for test data
    db.pragma('foreign_keys = OFF');
    console.log('[TEST] Foreign keys disabled');

    const { email = 'test@youmephoto.com', bookingId = `test_${Date.now()}` } = req.body;

    // Generate unique IDs
    const stripId = uuidv4();
    const accessToken = crypto.randomBytes(32).toString('hex');

    // Set expiry to 30 days from now for testing
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    console.log('[TEST] Inserting photo strip...');

    // Insert photo strip directly
    const stmt = db.prepare(`
      INSERT INTO photo_strips (
        strip_id, booking_id, customer_email,
        design_data, status, access_token, access_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const defaultDesignData = JSON.stringify({
      version: '5.3.0',
      objects: [],
      background: '#ffffff'
    });

    stmt.run(
      stripId,
      bookingId,
      email,
      defaultDesignData,
      'draft',
      accessToken,
      expiryDate.toISOString()
    );

    console.log('[TEST] Photo strip created successfully');

    db.close();

    const editorUrl = `${process.env.FRONTEND_URL || 'http://localhost:5174'}/photo-strip-editor?strip=${stripId}&token=${accessToken}`;

    console.log('[TEST] Editor URL:', editorUrl);

    res.json({
      success: true,
      stripId: stripId,
      accessToken: accessToken,
      editorUrl: editorUrl,
      expiresAt: expiryDate.toISOString()
    });
  } catch (error) {
    console.error('[TEST] Error creating test photo strip:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create test photo strip',
      message: error.message,
      stack: error.stack
    });
  }
});

export default router;
