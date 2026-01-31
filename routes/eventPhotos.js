/**
 * Event Photos API Routes (Placeholder)
 *
 * TODO: Replace placeholder implementation with actual photo query logic
 * when the photo upload/storage system is finalized.
 *
 * Expected implementation:
 * - Query uploaded_images table joined with photo_strips
 * - Filter by booking_id (from event_code lookup)
 * - Order by created_at DESC
 * - Apply pagination
 * - Return optimized thumbnails + full resolution URLs
 */

import express from 'express';
import { bookingsQueries } from '../db/database-postgres.js';

const router = express.Router();

/**
 * GET /api/events/:eventCode/photos
 * Returns paginated photos for an event
 *
 * Query params:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20)
 *
 * Response format:
 * {
 *   success: boolean,
 *   data: {
 *     items: Photo[],
 *     total: number,
 *     page: number,
 *     pageSize: number,
 *     hasMore: boolean
 *   }
 * }
 */
router.get('/events/:eventCode/photos', async (req, res) => {
  const { eventCode } = req.params;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;

  try {
    // Validate event code exists and is active
    const booking = await bookingsQueries.getByEventCode(eventCode);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Event nicht gefunden oder abgelaufen',
      });
    }

    // TODO: Replace with actual photo query
    // For now, return empty array as placeholder
    const photos = await getPhotosPlaceholder(booking.booking_id, page, pageSize);
    const total = 0; // TODO: Get actual total count

    res.json({
      success: true,
      data: {
        items: photos,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      },
    });
  } catch (error) {
    console.error('[EventPhotos] Error fetching photos:', error);
    res.status(500).json({
      success: false,
      message: 'Fehler beim Laden der Fotos',
    });
  }
});

/**
 * POST /api/events/:eventCode/photos/upload
 * Upload a photo to an event
 *
 * TODO: Implement file upload logic
 * - Validate file (MIME type, magic bytes, size)
 * - Process image (resize, optimize, create thumbnail)
 * - Store in filesystem or cloud storage
 * - Save metadata to database
 * - Broadcast via SSE to connected diashow clients
 *
 * Body: multipart/form-data { photo: File }
 *
 * Response format:
 * {
 *   success: boolean,
 *   data: Photo
 * }
 */
router.post('/events/:eventCode/photos/upload', async (req, res) => {
  const { eventCode } = req.params;

  try {
    // Validate event code
    const booking = await bookingsQueries.getByEventCodeAdmin(eventCode);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Event nicht gefunden',
      });
    }

    // TODO: Implement upload logic
    // 1. Validate uploaded file (req.file)
    // 2. Process image (sharp for resize/optimize)
    // 3. Generate thumbnail
    // 4. Store files in /uploads directory or S3
    // 5. Save metadata to database
    // 6. Broadcast new photo via SSE

    return res.status(501).json({
      success: false,
      message: 'Upload-Funktion noch nicht implementiert. Bitte füge die finale Upload-Logik hinzu.',
    });

    /* PLACEHOLDER for final implementation:

    const photoMetadata = {
      id: generateUUID(),
      eventCode,
      bookingId: booking.booking_id,
      url: `/uploads/${file.filename}`,
      thumbnailUrl: `/uploads/thumbnails/${file.filename}`,
      width: processedImage.width,
      height: processedImage.height,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user ? 'host' : 'guest',
    };

    // Save to database
    await savePhotoToDatabase(photoMetadata);

    // Broadcast to connected diashow clients via SSE
    broadcastNewImage(eventCode, photoMetadata);

    res.json({
      success: true,
      data: photoMetadata,
    });
    */
  } catch (error) {
    console.error('[EventPhotos] Error uploading photo:', error);
    res.status(500).json({
      success: false,
      message: 'Upload fehlgeschlagen',
    });
  }
});

/**
 * Placeholder function - to be replaced with real implementation
 *
 * In production, this would query:
 * - uploaded_images table joined with photo_strips
 * - Filter by booking_id
 * - Order by created_at DESC
 * - Apply pagination (LIMIT/OFFSET)
 * - Return photo metadata with URLs
 */
async function getPhotosPlaceholder(bookingId, page, pageSize) {
  // Return empty array for now
  // When photo upload system is ready, replace with actual DB query

  /* PLACEHOLDER SQL query for reference:

  const offset = (page - 1) * pageSize;

  const result = await db.query(
    `SELECT
      ui.image_id as id,
      ui.file_path as url,
      ui.optimized_path as thumbnailUrl,
      ui.original_filename,
      ui.width,
      ui.height,
      ui.file_size,
      ui.mime_type,
      ui.created_at as uploadedAt,
      'host' as uploadedBy  -- TODO: Add user tracking
    FROM uploaded_images ui
    JOIN photo_strips ps ON ps.id = ui.photo_strip_id
    WHERE ps.booking_id = $1
    ORDER BY ui.created_at DESC
    LIMIT $2 OFFSET $3`,
    [bookingId, pageSize, offset]
  );

  return result.rows;
  */

  return [];
}

/**
 * Get total photo count for a booking (placeholder)
 */
async function getPhotoCount(bookingId) {
  /* PLACEHOLDER SQL query:

  const result = await db.query(
    `SELECT COUNT(*) as count
    FROM uploaded_images ui
    JOIN photo_strips ps ON ps.id = ui.photo_strip_id
    WHERE ps.booking_id = $1`,
    [bookingId]
  );

  return parseInt(result.rows[0].count);
  */

  return 0;
}

export default router;
