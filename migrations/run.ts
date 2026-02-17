/**
 * File: migrations/run.ts
 * Purpose: Executes SQL and TypeScript migrations exactly once, with tracking.
 */

import fs from 'fs';
import path from 'path';
import { pool } from '../src/config/database';
import { logger } from '../src/utils/logger';

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

interface MinimalQueryRunner {
  query: (queryText: string, parameters?: unknown[]) => Promise<unknown>;
}

interface MigrationInstance {
  up: (queryRunner: MinimalQueryRunner) => Promise<void>;
}

interface MigrationConstructor {
  new (): MigrationInstance;
}

const isMigrationFile = (filename: string): boolean => {
  if (filename === 'run.ts') {
    return false;
  }

  return /^\d+.*\.(sql|ts)$/i.test(filename);
};

const listMigrationFiles = (migrationsDir: string): string[] => {
  return fs
    .readdirSync(migrationsDir)
    .filter(isMigrationFile)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const normalizeSqlForTransaction = (sql: string): string => {
  const lines = sql.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const trimmed = line.trim().toUpperCase();
    return trimmed !== 'BEGIN;' && trimmed !== 'COMMIT;';
  });
  return filtered.join('\n');
};

const resolveMigrationConstructor = (moduleExports: Record<string, unknown>): MigrationConstructor => {
  for (const exportedValue of Object.values(moduleExports)) {
    if (typeof exportedValue !== 'function') {
      continue;
    }

    const candidate = exportedValue as unknown as MigrationConstructor;
    const hasUpMethod =
      typeof candidate.prototype === 'object' &&
      candidate.prototype !== null &&
      typeof (candidate.prototype as { up?: unknown }).up === 'function';

    if (hasUpMethod) {
      return candidate;
    }
  }

  throw new Error('No migration class export with an up() method was found');
};

const runTypeScriptMigration = async (
  migrationsDir: string,
  filename: string,
  queryRunner: MinimalQueryRunner
): Promise<void> => {
  const migrationPath = path.join(migrationsDir, filename);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const migrationModule = require(migrationPath) as Record<string, unknown>;
  const MigrationClass = resolveMigrationConstructor(migrationModule);
  const migrationInstance = new MigrationClass();
  await migrationInstance.up(queryRunner);
};

export const applyMigrations = async (migrationsDir: string = __dirname): Promise<void> => {
  console.warn('[MIGRATE] Ensure a DB backup exists before running migrations in production.');
  const client = await pool.connect();

  try {
    logger.info('Starting database migrations...');
    await client.query(MIGRATIONS_TABLE_SQL);

    const appliedResult = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const appliedFiles = new Set(appliedResult.rows.map((row) => row.filename));
    const migrationFiles = listMigrationFiles(migrationsDir);

    for (const filename of migrationFiles) {
      if (appliedFiles.has(filename)) {
        logger.info(`Skipping already applied migration: ${filename}`);
        continue;
      }

      await client.query('BEGIN');
      try {
        const migrationPath = path.join(migrationsDir, filename);

        if (filename.toLowerCase().endsWith('.sql')) {
          const sql = fs.readFileSync(migrationPath, 'utf-8');
          const normalizedSql = normalizeSqlForTransaction(sql);
          await client.query(normalizedSql);
        } else {
          await runTypeScriptMigration(migrationsDir, filename, {
            query: async (queryText: string, parameters?: unknown[]) => client.query(queryText, parameters),
          });
        }

        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        logger.info(`Applied migration: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    logger.info('Migrations completed successfully');
  } finally {
    client.release();
  }
};

async function runMigrations() {
  try {
    await applyMigrations();
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigrations();
}
