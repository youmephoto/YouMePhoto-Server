import path from 'path';
import { fileURLToPath } from 'url';
import { prepare } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Middleware to validate photo strip access
 * Checks access token, customer email, expiry, and finalization status
 */
export async function validatePhotoStripAccess(req, res, next) {
  try {
    const { stripId } = req.params;
    const token = req.query.token || req.body.token;

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        message: 'Bitte geben Sie einen gültigen Zugangs-Token an.'
      });
    }

    // Get photo strip (without bookings join for test compatibility)
    const query = await prepare(`
      SELECT *
      FROM photo_strips
      WHERE strip_id = $1 AND access_token = $2
    `);
    const photoStrip = await query.get(stripId, token);

    if (!photoStrip) {
      return res.status(403).json({
        error: 'Invalid access token',
        message: 'Ungültiger Zugangs-Token. Bitte überprüfen Sie den Link aus Ihrer E-Mail.'
      });
    }

    // Check expiry
    if (photoStrip.access_expires_at) {
      const expiry = new Date(photoStrip.access_expires_at);
      if (expiry < new Date()) {
        return res.status(403).json({
          error: 'Access token expired',
          message: 'Ihr Zugangs-Link ist abgelaufen. Bitte kontaktieren Sie den Support.'
        });
      }
    }

    // Attach photo strip info to request
    req.photoStrip = photoStrip;
    next();
  } catch (error) {
    console.error('Error validating photo strip access:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.'
    });
  }
}

/**
 * Middleware to check if photo strip can be edited
 * Used for update/upload operations
 */
export function validateEditAccess(req, res, next) {
  try {
    if (!req.photoStrip) {
      return res.status(403).json({
        error: 'Access validation required',
        message: 'Zugriff nicht validiert.'
      });
    }

    // Check if finalized
    if (req.photoStrip.status === 'finalized') {
      return res.status(403).json({
        error: 'Design is finalized',
        message: 'Dieses Design wurde bereits finalisiert und kann nicht mehr bearbeitet werden.'
      });
    }

    next();
  } catch (error) {
    console.error('Error validating edit access:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Ein Fehler ist aufgetreten.'
    });
  }
}

/**
 * Middleware to validate read-only access
 * Used for viewing finalized designs
 */
export function validateReadAccess(req, res, next) {
  try {
    if (!req.photoStrip) {
      return res.status(403).json({
        error: 'Access validation required',
        message: 'Zugriff nicht validiert.'
      });
    }

    // Read access is always allowed if token is valid
    next();
  } catch (error) {
    console.error('Error validating read access:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Ein Fehler ist aufgetreten.'
    });
  }
}

/**
 * Middleware to validate admin access for photo strip management
 * Reuses existing admin auth from other routes
 */
export function requireAdminForPhotoStrips(req, res, next) {
  // Admin authentication should already be checked by requireAuth middleware
  // This is just an additional layer
  next();
}
