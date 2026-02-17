/**
 * File: src/routes/admin/auth.ts
 * Purpose: Admin authentication endpoints
 */

import { Router } from 'express';
import { AuthService, AUTH_FAIL_MSG } from '../../services/authService';
import { authenticateAdmin, AuthRequest, ADMIN_COOKIE_NAME } from '../../middleware/auth';
import { validate, schemas } from '../../middleware/validation';
import { config } from '../../config/env';
import { csrfProtection } from '../../middleware/csrf';

const router = Router();
const ADMIN_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const buildCookieOptions = () => ({
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: ADMIN_COOKIE_MAX_AGE_MS,
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
});

const buildClearCookieOptions = () => ({
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'strict' as const,
  path: '/',
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
});

router.post('/login', validate(schemas.login), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await AuthService.login(
      email,
      password,
      req.ip || '',
      req.headers['user-agent'] || ''
    );

    res.cookie(ADMIN_COOKIE_NAME, result.token, buildCookieOptions());
    res.json({
      success: true,
      user: {
        userId: result.user.id,
        email: result.user.email,
        fullName: result.user.full_name,
        role: result.user.role,
      },
    });
  } catch (error: unknown) {
    res.status(401).json({ success: false, error: AUTH_FAIL_MSG });
  }
});

router.post('/logout', authenticateAdmin, csrfProtection, async (req: AuthRequest, res, next) => {
  try {
    const token = req.authToken;
    if (token) {
      await AuthService.logout(token);
    }
    res.clearCookie(ADMIN_COOKIE_NAME, buildClearCookieOptions());
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/verify', authenticateAdmin, async (req: AuthRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ valid: false, error: 'Authentication required' });
  }

  res.json({
    valid: true,
    user: req.user,
  });
});

export default router;
