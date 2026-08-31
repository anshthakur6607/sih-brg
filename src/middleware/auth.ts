/**
 * Authentication Middleware
 * 
 * This middleware verifies JWT tokens from Supabase Auth.
 * It extracts the user ID from valid tokens and attaches it to the request.
 * 
 * Why: All protected routes need to verify the user is authenticated
 * and extract their identity for database operations.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../lib/supabase.js';

// JWT secret from environment (should match Supabase settings)
const JWT_SECRET = process.env.JWT_SECRET || 'skillup-secret-key-change-in-production';

/**
 * Extended Request interface with user data
 * Adds user property to Express Request for type safety
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
  supabase?: typeof supabaseAdmin;
}

/**
 * Token payload structure from Supabase JWT
 */
interface TokenPayload {
  sub: string; // User ID
  email: string;
  role?: string;
  iat: number;
  exp: number;
}

/**
 * Verifies JWT token and extracts user information
 * 
 * Flow:
 * 1. Extract token from Authorization header (Bearer token)
 * 2. Verify token signature using JWT_SECRET
 * 3. Decode token to get user ID and email
 * 4. Create Supabase client with the token for RLS
 * 5. Attach user data to request object
 */
export const verifyToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      res.status(401).json({
        success: false,
        error: 'Authorization header missing',
        code: 'NO_AUTH_HEADER',
      });
      return;
    }

    // Extract Bearer token
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Token missing',
        code: 'NO_TOKEN',
      });
      return;
    }

    // First, try to verify as custom backend JWT
    let decoded: TokenPayload | null = null;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    } catch {
      decoded = null;
    }

    // If custom JWT verification failed, try Supabase token verification
    if (!decoded) {
      const supabaseGetUser = supabaseAdmin.auth.getUser(token);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase getUser timeout')), 5000)
      );
      const { data: { user }, error: userError } = await Promise.race([supabaseGetUser, timeout]);
      
      if (userError || !user) {
        res.status(401).json({
          success: false,
          error: 'Invalid token',
          code: 'INVALID_TOKEN',
        });
        return;
      }

      // Get profile role from Supabase
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      decoded = {
        sub: user.id,
        email: user.email || '',
        role: profile?.role || 'learner',
        iat: 0,
        exp: 0,
      };
    }

    // Validate required fields
    if (!decoded.sub || !decoded.email) {
      res.status(401).json({
        success: false,
        error: 'Invalid token payload',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    // Create Supabase admin client for data operations
    const supabase = supabaseAdmin;

    // Attach user data to request
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role || 'learner',
    };
    req.supabase = supabase;

    // Continue to next middleware
    next();
  } catch (error) {
    // Token verification failed
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    // Unexpected error
    if (error instanceof Error && error.message === 'Supabase getUser timeout') {
      res.status(504).json({
        success: false,
        error: 'Authentication service timeout',
        code: 'AUTH_TIMEOUT',
      });
      return;
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication error',
      code: 'AUTH_ERROR',
    });
  }
};

/**
 * Optional authentication middleware
 * Attaches user if token present, continues regardless
 * Use for routes that work with or without authentication
 */
export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      next();
      return;
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      next();
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    
    if (decoded?.sub && decoded?.email) {
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'learner',
      };
      req.supabase = supabaseAdmin;
    }

    next();
  } catch {
    // Token invalid but continue anyway
    next();
  }
};

/**
 * Role-based access control middleware factory
 * Creates middleware that checks for specific roles
 * 
 * @param allowedRoles - Array of allowed role names
 * 
 * Why: Some routes should only be accessible to admins or managers
 */
export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_AUTH',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'FORBIDDEN',
      });
      return;
    }

    next();
  };
};

/**
 * Admin-only middleware
 * Convenience wrapper for admin-only routes
 */
export const requireAdmin = requireRole('admin');

/**
 * Manager or Admin middleware
 * For routes accessible to managers and admins
 */
export const requireManager = requireRole('manager', 'admin');