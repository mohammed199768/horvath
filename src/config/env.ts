/**
 * File: src/config/env.ts
 * Purpose: Loads and exports environment variables with defaults
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const FORBIDDEN_JWT_SUBSTRINGS = ['default', 'secret', 'password', 'change-me', 'your-'];

const getRequiredJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      'FATAL: JWT_SECRET environment variable is required. Generate one with: openssl rand -base64 32'
    );
  }

  if (secret.length < 32) {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters.');
  }

  const lower = secret.toLowerCase();
  if (FORBIDDEN_JWT_SUBSTRINGS.some((token) => lower.includes(token))) {
    throw new Error('FATAL: JWT_SECRET appears to be a default/insecure value. Set a strong random secret.');
  }

  return secret;
};

const jwtSecret = getRequiredJwtSecret();

const parseInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (typeof value === 'undefined') return fallback;
  return value.toLowerCase() === 'true';
};

export const config = {
  port: parseInteger(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInteger(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME || 'leadership_assessment',
    user: process.env.DB_USER || 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''),
    ssl: parseBoolean(process.env.DB_SSL, false),
    statementTimeout: parseInteger(process.env.DB_STATEMENT_TIMEOUT, 10000),
  },
  
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  rateLimit: {
    windowMs: parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: parseInteger(process.env.RATE_LIMIT_MAX, 100),
  },
  requireMigrations: parseBoolean(process.env.REQUIRE_MIGRATIONS, false),
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    // 24h balances performance (fewer preflights) against slower propagation of CORS policy changes.
    // Complexity rationale: cache preflight to collapse repeated OPTIONS from O(n) to O(1) per maxAge window.
    maxAge: 86_400,
  },
};
