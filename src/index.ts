/**
 * File: src/index.ts
 * Purpose: Application entry point and server startup
 */

import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { config } from './config/env';
import { logger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { issueCsrfToken } from './middleware/csrf';
import { query } from './config/database';

import publicRoutes from './routes/public';
import adminRoutes from './routes/admin';

const app: Application = express();
app.set('trust proxy', 1);
const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const isMigrationFilename = (filename: string): boolean => {
  if (filename === 'run.ts' || filename === 'run.js') {
    return false;
  }
  return /^\d+.*\.(sql|ts)$/i.test(filename);
};

const verifyMigrationsApplied = async (): Promise<void> => {
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    logger.error('[CRITICAL] Migrations directory not found', { migrationsDir });
    if (config.requireMigrations) {
      throw new Error('Migrations directory is required but missing');
    }
    return;
  }

  const expectedMigrations = fs
    .readdirSync(migrationsDir)
    .filter(isMigrationFilename)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (expectedMigrations.length === 0) {
    return;
  }

  try {
    await query(MIGRATIONS_TABLE_SQL);
    const appliedResult = await query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.filename as string));
    const missing = expectedMigrations.filter((name) => !applied.has(name));

    if (missing.length > 0) {
      logger.error('[CRITICAL] Pending migrations detected', { missing });
      if (config.requireMigrations) {
        throw new Error('Pending migrations detected and REQUIRE_MIGRATIONS=true');
      }
    }
  } catch (error) {
    logger.error('[CRITICAL] Unable to validate migration state', error);
    if (config.requireMigrations) {
      throw error;
    }
  }
};

app.use(helmet());
app.use(cors(config.cors));

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts, please try again later' },
  skipSuccessfulRequests: true,
});

app.use('/api/admin/auth/login', authLimiter);
app.use('/api/', limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  next();
});

app.get('/api/csrf-token', issueCsrfToken);
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'Leadership Assessment API',
    version: '1.0.0',
    status: 'running',
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async (): Promise<void> => {
  await verifyMigrationsApplied();

  const port = config.port;
  const server = app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`CORS enabled for: ${config.cors.origin}`);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT signal received: closing HTTP server');
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
};

startServer().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});

export default app;
