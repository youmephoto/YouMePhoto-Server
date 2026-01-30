import jwt from 'jsonwebtoken';
import { adminUserQueries } from '../db/database.js';

/**
 * JWT Authentication Middleware
 * Replaces Basic Auth for better security
 *
 * Usage:
 * - Client sends: Authorization: Bearer <JWT_TOKEN>
 * - Token expires after 24h (configurable via JWT_EXPIRES_IN)
 * - User object attached to req.user
 */
export async function requireJwtAuth(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_TOKEN',
        hint: 'Include Authorization: Bearer <token> header'
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT token
    if (!process.env.JWT_SECRET) {
      console.error('[JWT Auth] JWT_SECRET not configured in environment');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify user still exists in database
    const user = await adminUserQueries.findByUsername(decoded.username);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
        code: 'INVALID_TOKEN'
      });
    }

    // Attach user to request object
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
    };

    next();
  } catch (error) {
    // Handle specific JWT errors
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
        hint: 'Please login again to get a new token'
      });
    }

    console.error('[JWT Auth] Authentication error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}
