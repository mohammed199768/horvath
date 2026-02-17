/**
 * File: src/middleware/auth.ts
 * Purpose: Authentication middleware for verifying JWT tokens and sessions
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { query } from '../config/database';
import { logger } from '../utils/logger';

export const ADMIN_COOKIE_NAME = 'admin_token';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    fullName: string;
    role: string;
  };
  authToken?: string;
}

const getCookieValue = (cookieHeader: string | undefined, name: string): string | null => {
  if (!cookieHeader) return null;

  const match = cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));

  if (!match) return null;
  return decodeURIComponent(match.slice(name.length + 1));
};

const extractAuthToken = (req: Request): string | null => {
  // Cookie-based auth is the primary mechanism. Bearer support is kept for compatibility.
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[ADMIN_COOKIE_NAME];
  if (cookieToken) {
    return cookieToken;
  }

  const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  if (bearerToken) {
    return bearerToken;
  }

  return getCookieValue(req.headers.cookie, ADMIN_COOKIE_NAME);
};

export const authenticateAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractAuthToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify JWT integrity
    jwt.verify(token, config.jwt.secret);

    // Verify session in database (prevents using revoked tokens or logged-out sessions)
    const sessionResult = await query(
      `SELECT s.*, u.email, u.full_name, u.role, u.is_active
       FROM admin_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const session = sessionResult.rows[0];

    if (!session.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    // Update last activity
    await query(
      'UPDATE admin_sessions SET last_activity_at = NOW() WHERE token = $1',
      [token]
    );

    req.user = {
      userId: session.user_id,
      email: session.email,
      fullName: session.full_name,
      role: session.role,
    };
    req.authToken = token;

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

// Variadic wrapper used by route layers that pass roles as individual args.
export const requireAnyRole = (...roles: string[]) => requireRole(roles);
