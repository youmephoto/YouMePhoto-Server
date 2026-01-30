import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { prepare } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


/**
 * PhotoStripService
 * Manages photo strip creation, updates, and finalization
 */
class PhotoStripService {
  /**
   * Create a new photo strip for a booking
   * @param {string} bookingId - The booking ID
   * @param {string} customerEmail - Customer email for validation
   * @returns {Promise<{success: boolean, stripId?: string, accessToken?: string, error?: string}>}
   */
  async createPhotoStrip(bookingId, customerEmail) {
    try {
      // Check if photo strip already exists
      const existingQuery = await prepare(`
        SELECT strip_id, access_token
        FROM photo_strips
        WHERE booking_id = $1
      `);
      const existingStrip = await existingQuery.get(bookingId);

      if (existingStrip) {
        return {
          success: true,
          stripId: existingStrip.strip_id,
          accessToken: existingStrip.access_token,
          message: 'Photo strip already exists'
        };
      }

      // Generate unique IDs
      const stripId = uuidv4();
      const accessToken = crypto.randomBytes(32).toString('hex');

      // Calculate expiry (30 days from now for test compatibility)
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      // Insert photo strip
      const stmt = await prepare(`
        INSERT INTO photo_strips (
          strip_id, booking_id, customer_email,
          design_data, status, access_token, access_expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `);

      const defaultDesignData = JSON.stringify({
        version: '6.0.2',
        objects: [],
        background: '#ffffff'
      });

      await stmt.run(
        stripId,
        bookingId,
        customerEmail,
        defaultDesignData,
        'draft',
        accessToken,
        expiryDate.toISOString()
      );

      console.log(`✓ Photo strip created: ${stripId} for booking ${bookingId}`);

      return {
        success: true,
        stripId,
        accessToken,
        expiryDate: expiryDate.toISOString()
      };
    } catch (error) {
      console.error('Error creating photo strip:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get photo strip by ID with access validation
   * @param {string} stripId - The strip ID
   * @param {string} accessToken - Access token for validation
   * @returns {Promise<{success: boolean, strip?: object, error?: string}>}
   */
  async getPhotoStrip(stripId, accessToken) {
    try {
      const query = await prepare(`
        SELECT *
        FROM photo_strips
        WHERE strip_id = $1 AND access_token = $2
      `);
      const strip = await query.get(stripId, accessToken);

      if (!strip) {
        return { success: false, error: 'Photo strip not found or invalid access token' };
      }

      // Check expiry
      if (strip.access_expires_at) {
        const expiry = new Date(strip.access_expires_at);
        if (expiry < new Date()) {
          return { success: false, error: 'Access token expired' };
        }
      }

      // Parse design_data JSON
      strip.design_data = JSON.parse(strip.design_data);

      return { success: true, strip };
    } catch (error) {
      console.error('Error getting photo strip:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update photo strip design data
   * @param {string} stripId - The strip ID
   * @param {string} accessToken - Access token for validation
   * @param {object} designData - Fabric.js canvas JSON
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateDesign(stripId, accessToken, designData) {
    try {
      // Validate access
      const query = await prepare(`
        SELECT id, status, access_expires_at
        FROM photo_strips
        WHERE strip_id = $1 AND access_token = $2
      `);
      const strip = await query.get(stripId, accessToken);

      if (!strip) {
        return { success: false, error: 'Invalid access' };
      }

      if (strip.status === 'finalized') {
        return { success: false, error: 'Design is finalized and cannot be edited' };
      }

      // Check expiry
      if (strip.access_expires_at) {
        const expiry = new Date(strip.access_expires_at);
        if (expiry < new Date()) {
          return { success: false, error: 'Access expired' };
        }
      }

      // Update design data
      const stmt = await prepare(`
        UPDATE photo_strips
        SET design_data = $1, updated_at = CURRENT_TIMESTAMP, version = version + 1
        WHERE id = $2
      `);

      await stmt.run(JSON.stringify(designData), strip.id);

      console.log(`✓ Design updated for strip ${stripId}`);

      return { success: true };
    } catch (error) {
      console.error('Error updating design:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Finalize photo strip design (lock editing, save final image)
   * @param {string} stripId - The strip ID
   * @param {string} accessToken - Access token
   * @param {string} finalImageBase64 - Base64 PNG image
   * @returns {Promise<{success: boolean, finalImagePath?: string, error?: string}>}
   */
  async finalizeDesign(stripId, accessToken, finalImageBase64) {
    try {
      // Validate access
      const query = await prepare(`
        SELECT ps.id, ps.status, ps.booking_id
        FROM photo_strips ps
        WHERE ps.strip_id = $1 AND ps.access_token = $2
      `);
      const strip = await query.get(stripId, accessToken);

      if (!strip) {
        return { success: false, error: 'Invalid access' };
      }

      if (strip.status === 'finalized') {
        return { success: false, error: 'Design already finalized' };
      }

      // Save final image
      // Use /app/data volume if in production, otherwise local uploads
      const baseUploadPath = process.env.NODE_ENV === 'production'
        ? '/app/data/uploads/photo-strips'
        : path.join(__dirname, '../uploads/photo-strips');

      const finalDir = path.join(baseUploadPath, strip.booking_id, 'final');
      await fs.mkdir(finalDir, { recursive: true });

      const finalFilename = `final-design-${Date.now()}.png`;
      const finalPath = path.join(finalDir, finalFilename);

      // Remove base64 prefix if present
      const base64Data = finalImageBase64.replace(/^data:image\/png;base64,/, '');
      await fs.writeFile(finalPath, base64Data, 'base64');

      // Update database
      const relativePath = path.join('photo-strips', strip.booking_id, 'final', finalFilename);
      const stmt = await prepare(`
        UPDATE photo_strips
        SET status = 'finalized',
            final_image_path = $1,
            finalized_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `);

      await stmt.run(relativePath, strip.id);

      console.log(`✓ Design finalized for strip ${stripId}`);

      return { success: true, finalImagePath: relativePath };
    } catch (error) {
      console.error('Error finalizing design:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate preview image from design data
   * @param {string} stripId - The strip ID
   * @param {string} accessToken - Access token
   * @param {string} previewImageBase64 - Base64 PNG preview
   * @returns {Promise<{success: boolean, previewPath?: string, error?: string}>}
   */
  async savePreview(stripId, accessToken, previewImageBase64) {
    try {
      // Validate access
      const query = await prepare(`
        SELECT ps.id, ps.booking_id
        FROM photo_strips ps
        WHERE ps.strip_id = $1 AND ps.access_token = $2
      `);
      const strip = await query.get(stripId, accessToken);

      if (!strip) {
        return { success: false, error: 'Invalid access' };
      }

      // Save preview image
      // Use /app/data volume if in production, otherwise local uploads
      const baseUploadPath = process.env.NODE_ENV === 'production'
        ? '/app/data/uploads/photo-strips'
        : path.join(__dirname, '../uploads/photo-strips');

      const previewDir = path.join(baseUploadPath, strip.booking_id, 'previews');
      await fs.mkdir(previewDir, { recursive: true });

      const previewFilename = `preview-${Date.now()}.png`;
      const previewPath = path.join(previewDir, previewFilename);

      // Remove base64 prefix
      const base64Data = previewImageBase64.replace(/^data:image\/png;base64,/, '');
      await fs.writeFile(previewPath, base64Data, 'base64');

      // Update database
      const relativePath = path.join('photo-strips', strip.booking_id, 'previews', previewFilename);
      const stmt = await prepare(`
        UPDATE photo_strips
        SET preview_image_path = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `);

      await stmt.run(relativePath, strip.id);

      return { success: true, previewPath: relativePath };
    } catch (error) {
      console.error('Error saving preview:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all photo strips (admin only)
   * @returns {Array<object>} List of photo strips
   */
  async getAllPhotoStrips() {
    try {
      const query = await prepare(`
        SELECT *
        FROM photo_strips
        ORDER BY created_at DESC
      `);
      const strips = await query.all();

      return strips.map(strip => ({
        ...strip,
        design_data: JSON.parse(strip.design_data)
      }));
    } catch (error) {
      console.error('Error getting all photo strips:', error);
      return [];
    }
  }

  /**
   * Get photo strips by booking ID
   * @param {string} bookingId - The booking ID
   * @returns {Array<object>} Photo strips for this booking
   */
  async getStripsByBooking(bookingId) {
    try {
      const query = await prepare(`
        SELECT * FROM photo_strips
        WHERE booking_id = $1
        ORDER BY created_at DESC
      `);
      const strips = await query.all(bookingId);

      return strips.map(strip => ({
        ...strip,
        design_data: JSON.parse(strip.design_data)
      }));
    } catch (error) {
      console.error('Error getting strips by booking:', error);
      return [];
    }
  }

  /**
   * Delete photo strip (admin only)
   * @param {string} stripId - The strip ID
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deletePhotoStrip(stripId) {
    try {
      const query = await prepare(`
        SELECT id, booking_id FROM photo_strips WHERE strip_id = $1
      `);
      const strip = await query.get(stripId);

      if (!strip) {
        return { success: false, error: 'Photo strip not found' };
      }

      // Delete files
      // Use /app/data volume if in production, otherwise local uploads
      const baseUploadPath = process.env.NODE_ENV === 'production'
        ? '/app/data/uploads/photo-strips'
        : path.join(__dirname, '../uploads/photo-strips');

      const stripDir = path.join(baseUploadPath, strip.booking_id);
      try {
        await fs.rm(stripDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Error deleting files:', err);
      }

      // Delete from database (cascades to uploaded_images)
      const deleteQuery = await prepare(`DELETE FROM photo_strips WHERE id = $1`);
      await deleteQuery.run(strip.id);

      console.log(`✓ Photo strip ${stripId} deleted`);

      return { success: true };
    } catch (error) {
      console.error('Error deleting photo strip:', error);
      return { success: false, error: error.message };
    }
  }
}

export default new PhotoStripService();
