import express from 'express';
import photoStripService from '../services/photoStripService.js';
import uploadService, { photoStripUpload } from '../services/uploadService.js';
import templateService from '../services/templateService.js';
import { validatePhotoStripAccess, validateEditAccess, validateReadAccess } from '../middleware/photoStripAuth.js';
import { requireAuth } from '../middleware/auth.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ============================================
// PUBLIC ROUTES (with access token validation)
// ============================================

/**
 * GET /api/photo-strips/:stripId
 * Get photo strip data
 */
router.get('/:stripId', validatePhotoStripAccess, validateReadAccess, async (req, res) => {
  try {
    const { stripId } = req.params;
    const token = req.query.token || req.body.token;

    const result = await photoStripService.getPhotoStrip(stripId, token);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json(result.strip);
  } catch (error) {
    console.error('Error getting photo strip:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/photo-strips/:stripId/design
 * Update photo strip design data
 */
router.patch('/:stripId/design', validatePhotoStripAccess, validateEditAccess, async (req, res) => {
  try {
    const { stripId } = req.params;
    const token = req.query.token || req.body.token;
    const { designData } = req.body;

    if (!designData) {
      return res.status(400).json({ error: 'Design data required' });
    }

    const result = await photoStripService.updateDesign(stripId, token, designData);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, message: 'Design updated successfully' });
  } catch (error) {
    console.error('Error updating design:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/photo-strips/:stripId/preview
 * Save preview image
 */
router.post('/:stripId/preview', validatePhotoStripAccess, validateEditAccess, async (req, res) => {
  try {
    const { stripId } = req.params;
    const token = req.query.token || req.body.token;
    const { previewImage } = req.body;

    if (!previewImage) {
      return res.status(400).json({ error: 'Preview image required' });
    }

    const result = await photoStripService.savePreview(stripId, token, previewImage);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, previewPath: result.previewPath });
  } catch (error) {
    console.error('Error saving preview:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/photo-strips/:stripId/finalize
 * Finalize photo strip design
 */
router.post('/:stripId/finalize', validatePhotoStripAccess, validateEditAccess, async (req, res) => {
  try {
    const { stripId } = req.params;
    const token = req.query.token || req.body.token;
    const { finalImage } = req.body;

    if (!finalImage) {
      return res.status(400).json({ error: 'Final image required' });
    }

    const result = await photoStripService.finalizeDesign(stripId, token, finalImage);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: 'Design finalized successfully',
      finalImagePath: result.finalImagePath
    });
  } catch (error) {
    console.error('Error finalizing design:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/photo-strips/:stripId/upload
 * Upload image/logo for photo strip
 */
router.post('/:stripId/upload',
  validatePhotoStripAccess,
  validateEditAccess,
  photoStripUpload.single('image'),
  async (req, res) => {
    try {
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Process and optimize image (includes magic-byte validation)
      const bookingId = req.photoStrip.booking_id;
      const processed = await uploadService.processImage(file.path, bookingId);

      // Save metadata to database
      const imageId = uploadService.saveImageMetadata(
        req.photoStrip.id,
        file.originalname,
        path.join('photo-strips', bookingId, 'original', file.filename),
        file.size,
        file.mimetype,
        processed.width,
        processed.height,
        processed.optimizedPath
      );

      res.json({
        success: true,
        image: {
          imageId,
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          width: processed.width,
          height: processed.height,
          url: `/uploads/${processed.optimizedPath}`
        }
      });
    } catch (error) {
      console.error('Error uploading image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  }
);

/**
 * GET /api/photo-strips/:stripId/images
 * Get all uploaded images for photo strip
 */
router.get('/:stripId/images', validatePhotoStripAccess, validateReadAccess, async (req, res) => {
  try {
    const images = uploadService.getImagesByPhotoStrip(req.photoStrip.id);

    // Add URL to each image
    const imagesWithUrls = images.map(img => ({
      ...img,
      url: `/uploads/${img.optimized_path}`,
      originalUrl: `/uploads/${img.file_path}`
    }));

    res.json({ images: imagesWithUrls });
  } catch (error) {
    console.error('Error getting images:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/photo-strips/:stripId/images/:imageId
 * Delete uploaded image
 */
router.delete('/:stripId/images/:imageId', validatePhotoStripAccess, validateEditAccess, async (req, res) => {
  try {
    const { imageId } = req.params;

    const result = await uploadService.deleteImage(imageId, req.photoStrip.id);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// TEMPLATE ROUTES (public read)
// ============================================

/**
 * GET /api/templates
 * Get all active templates
 */
router.get('/templates/all', async (req, res) => {
  try {
    const templates = templateService.getAllActiveTemplates();
    res.json({ templates });
  } catch (error) {
    console.error('Error getting templates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/templates/:id
 * Get specific template
 */
router.get('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const template = templateService.getTemplateById(parseInt(id));

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error('Error getting template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/templates/category/:category
 * Get templates by category
 */
router.get('/templates/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const templates = templateService.getTemplatesByCategory(category);
    res.json({ templates });
  } catch (error) {
    console.error('Error getting templates by category:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// ADMIN ROUTES (require authentication)
// ============================================

/**
 * GET /api/admin/photo-strips
 * Get all photo strips (admin only)
 */
router.get('/admin/all', requireAuth, async (req, res) => {
  try {
    const strips = photoStripService.getAllPhotoStrips();
    res.json({ strips });
  } catch (error) {
    console.error('Error getting all photo strips:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/photo-strips/booking/:bookingId
 * Get photo strips by booking ID (admin only)
 */
router.get('/admin/booking/:bookingId', requireAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const strips = photoStripService.getStripsByBooking(bookingId);
    res.json({ strips });
  } catch (error) {
    console.error('Error getting strips by booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/admin/photo-strips/:stripId
 * Delete photo strip (admin only)
 */
router.delete('/admin/:stripId', requireAuth, async (req, res) => {
  try {
    const { stripId } = req.params;
    const result = await photoStripService.deletePhotoStrip(stripId);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json({ success: true, message: 'Photo strip deleted successfully' });
  } catch (error) {
    console.error('Error deleting photo strip:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/templates
 * Create template (admin only)
 */
router.post('/admin/templates', requireAuth, async (req, res) => {
  try {
    const { name, category, templateData, description, thumbnailPath, displayOrder } = req.body;

    if (!name || !category || !templateData) {
      return res.status(400).json({ error: 'Name, category, and template data required' });
    }

    const result = templateService.createTemplate(
      name,
      category,
      templateData,
      description,
      thumbnailPath,
      displayOrder || 0
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, templateId: result.templateId });
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/templates/:id
 * Update template (admin only)
 */
router.patch('/admin/templates/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const result = templateService.updateTemplate(parseInt(id), updates);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, message: 'Template updated successfully' });
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/admin/templates/:id
 * Delete (deactivate) template (admin only)
 */
router.delete('/admin/templates/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = templateService.deleteTemplate(parseInt(id));

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, message: 'Template deactivated successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/templates/all
 * Get all templates including inactive (admin only)
 */
router.get('/admin/templates/all', requireAuth, async (req, res) => {
  try {
    const templates = templateService.getAllTemplates();
    res.json({ templates });
  } catch (error) {
    console.error('Error getting all templates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
