import multer from 'multer';
import sharp from 'sharp';
import fileType from 'file-type';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { prepare } from '../db/database.js';

const { fileTypeFromFile } = fileType;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Allowed file types (security: only PNG and JPEG, NO SVG due to XSS risk)
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
const ALLOWED_MAGIC_BYTES = ['image/png', 'image/jpeg'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Multer configuration for photo strip image uploads
 */
export const photoStripUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        // Get booking_id from photo strip
        const stripId = req.params.stripId;
        const token = req.query.token || req.body.token;

        const query = await prepare(`
          SELECT booking_id FROM photo_strips
          WHERE strip_id = $1 AND access_token = $2
        `);
        const strip = await query.get(stripId, token);

        if (!strip) {
          return cb(new Error('Invalid photo strip access'));
        }

        // Use /app/data volume if in production, otherwise local uploads
        const baseUploadPath = process.env.NODE_ENV === 'production'
          ? '/app/data/uploads/photo-strips'
          : path.join(__dirname, '../uploads/photo-strips');

        const uploadDir = path.join(baseUploadPath, strip.booking_id, 'original');
        await fs.mkdir(uploadDir, { recursive: true });

        cb(null, uploadDir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const uniqueId = uuidv4();
      const ext = path.extname(file.originalname);
      cb(null, `${uniqueId}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    // Block SVG explicitly (XSS risk)
    if (file.mimetype === 'image/svg+xml' || path.extname(file.originalname).toLowerCase() === '.svg') {
      return cb(new Error('SVG files are not allowed for security reasons (XSS risk).'));
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only PNG and JPG are allowed.'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

/**
 * UploadService
 * Handles image uploads, optimization, and storage
 */
class UploadService {
  /**
   * Validate uploaded file using magic bytes (true file type detection)
   * Security: Prevents MIME-type spoofing attacks
   *
   * @param {string} filePath - Path to uploaded file
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async validateFileType(filePath) {
    try {
      // Check magic bytes (true file type, not just extension/MIME)
      const fileType = await fileTypeFromFile(filePath);

      if (!fileType) {
        return { valid: false, error: 'Could not determine file type (corrupted file?)' };
      }

      // Only allow PNG and JPEG (NO GIF, NO SVG)
      if (!ALLOWED_MAGIC_BYTES.includes(fileType.mime)) {
        return {
          valid: false,
          error: `Invalid file type: ${fileType.mime}. Only PNG and JPEG allowed.`
        };
      }

      return { valid: true };
    } catch (error) {
      console.error('[UploadService] File validation error:', error);
      return { valid: false, error: 'File validation failed' };
    }
  }

  /**
   * Process and optimize uploaded image
   * @param {string} filePath - Path to uploaded file
   * @param {string} bookingId - Booking ID for organizing files
   * @returns {Promise<{optimizedPath: string, width: number, height: number}>}
   */
  async processImage(filePath, bookingId) {
    // Security: Validate file type via magic bytes FIRST
    const validation = await this.validateFileType(filePath);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    try {
      // Use /app/data volume if in production, otherwise local uploads
      const baseUploadPath = process.env.NODE_ENV === 'production'
        ? '/app/data/uploads/photo-strips'
        : path.join(__dirname, '../uploads/photo-strips');

      const optimizedDir = path.join(baseUploadPath, bookingId, 'optimized');
      await fs.mkdir(optimizedDir, { recursive: true });

      const filename = path.basename(filePath);
      const optimizedPath = path.join(optimizedDir, filename);

      // Get original metadata
      const metadata = await sharp(filePath).metadata();

      // Optimize image
      // - Resize to max 1920x1080 (preserve aspect ratio)
      // - Compress to 90% quality
      // - Convert to JPEG if larger than PNG
      await sharp(filePath)
        .resize(1920, 1080, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 90 })
        .png({ compressionLevel: 9 })
        .toFile(optimizedPath);

      // Get optimized metadata
      const optimizedMetadata = await sharp(optimizedPath).metadata();

      return {
        optimizedPath: path.join('photo-strips', bookingId, 'optimized', filename),
        width: optimizedMetadata.width,
        height: optimizedMetadata.height
      };
    } catch (error) {
      console.error('Error processing image:', error);
      throw error;
    }
  }

  /**
   * Save uploaded image metadata to database
   * @param {number} photoStripId - Photo strip database ID
   * @param {string} originalFilename - Original filename
   * @param {string} filePath - Relative path to file
   * @param {number} fileSize - File size in bytes
   * @param {string} mimeType - MIME type
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @param {string} optimizedPath - Path to optimized version
   * @returns {string} Image ID
   */
  async saveImageMetadata(photoStripId, originalFilename, filePath, fileSize, mimeType, width, height, optimizedPath) {
    try {
      const imageId = uuidv4();

      const stmt = await prepare(`
        INSERT INTO uploaded_images (
          image_id, photo_strip_id, original_filename,
          file_path, file_size, mime_type,
          width, height, optimized_path
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `);

      await stmt.run(
        imageId,
        photoStripId,
        originalFilename,
        filePath,
        fileSize,
        mimeType,
        width,
        height,
        optimizedPath
      );

      console.log(`✓ Image metadata saved: ${imageId}`);

      return imageId;
    } catch (error) {
      console.error('Error saving image metadata:', error);
      throw error;
    }
  }

  /**
   * Get all uploaded images for a photo strip
   * @param {number} photoStripId - Photo strip database ID
   * @returns {Array<object>} List of uploaded images
   */
  async getImagesByPhotoStrip(photoStripId) {
    try {
      const query = await prepare(`
        SELECT * FROM uploaded_images
        WHERE photo_strip_id = $1
        ORDER BY created_at DESC
      `);
      const images = await query.all(photoStripId);

      return images;
    } catch (error) {
      console.error('Error getting images:', error);
      return [];
    }
  }

  /**
   * Delete uploaded image
   * @param {string} imageId - Image ID
   * @param {number} photoStripId - Photo strip ID for validation
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteImage(imageId, photoStripId) {
    try {
      // Get image metadata
      const query = await prepare(`
        SELECT * FROM uploaded_images
        WHERE image_id = $1 AND photo_strip_id = $2
      `);
      const image = await query.get(imageId, photoStripId);

      if (!image) {
        return { success: false, error: 'Image not found' };
      }

      // Delete files
      const originalPath = path.join(__dirname, '../uploads', image.file_path);
      const optimizedPath = path.join(__dirname, '../uploads', image.optimized_path);

      try {
        await fs.unlink(originalPath);
      } catch (err) {
        console.error('Error deleting original file:', err);
      }

      try {
        await fs.unlink(optimizedPath);
      } catch (err) {
        console.error('Error deleting optimized file:', err);
      }

      // Delete from database
      const deleteQuery = await prepare(`DELETE FROM uploaded_images WHERE id = $1`);
      await deleteQuery.run(image.id);

      console.log(`✓ Image ${imageId} deleted`);

      return { success: true };
    } catch (error) {
      console.error('Error deleting image:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get image file path
   * @param {string} imageId - Image ID
   * @returns {string|null} Absolute file path or null
   */
  async getImagePath(imageId) {
    try {
      const query = await prepare(`
        SELECT optimized_path FROM uploaded_images WHERE image_id = $1
      `);
      const image = await query.get(imageId);

      if (!image) {
        return null;
      }

      return path.join(__dirname, '../uploads', image.optimized_path);
    } catch (error) {
      console.error('Error getting image path:', error);
      return null;
    }
  }

  /**
   * Validate file upload
   * @param {object} file - Multer file object
   * @returns {{valid: boolean, error?: string}}
   */
  validateFile(file) {
    if (!file) {
      return { valid: false, error: 'No file provided' };
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return { valid: false, error: 'Invalid file type. Only PNG, JPG, and GIF allowed.' };
    }

    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` };
    }

    return { valid: true };
  }
}

export default new UploadService();
