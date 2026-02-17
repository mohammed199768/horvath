import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_BYTES = 32;

const isSafeMethod = (method: string): boolean => ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

const readCookie = (req: Request, key: string): string | undefined => {
  const cookieMap = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookieMap?.[key]) {
    return cookieMap[key];
  }

  const rawCookie = req.headers.cookie;
  if (!rawCookie) {
    return undefined;
  }

  const item = rawCookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${key}=`));

  return item ? decodeURIComponent(item.slice(key.length + 1)) : undefined;
};

export const issueCsrfToken = (req: Request, res: Response): void => {
  const token = crypto.randomBytes(CSRF_TOKEN_BYTES).toString('hex');

  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });

  res.json({ csrfToken: token });
};

export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  if (isSafeMethod(req.method)) {
    next();
    return;
  }

  const cookieToken = readCookie(req, CSRF_COOKIE_NAME);
  const headerToken = req.header(CSRF_HEADER_NAME);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ error: 'Invalid CSRF token' });
    return;
  }

  next();
};
