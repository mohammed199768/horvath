"use strict";
/**
 * File: migrations/run.ts
 * Purpose: Executes SQL and TypeScript migrations exactly once, with tracking.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrations = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const database_1 = require("../src/config/database");
const logger_1 = require("../src/utils/logger");
const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
const isMigrationFile = (filename) => {
    if (filename === 'run.ts') {
        return false;
    }
    return /^\d+.*\.(sql|ts)$/i.test(filename);
};
const listMigrationFiles = (migrationsDir) => {
    return fs_1.default
        .readdirSync(migrationsDir)
        .filter(isMigrationFile)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};
const normalizeSqlForTransaction = (sql) => {
    const lines = sql.split(/\r?\n/);
    const filtered = lines.filter((line) => {
        const trimmed = line.trim().toUpperCase();
        return trimmed !== 'BEGIN;' && trimmed !== 'COMMIT;';
    });
    return filtered.join('\n');
};
const resolveMigrationConstructor = (moduleExports) => {
    for (const exportedValue of Object.values(moduleExports)) {
        if (typeof exportedValue !== 'function') {
            continue;
        }
        const candidate = exportedValue;
        const hasUpMethod = typeof candidate.prototype === 'object' &&
            candidate.prototype !== null &&
            typeof candidate.prototype.up === 'function';
        if (hasUpMethod) {
            return candidate;
        }
    }
    throw new Error('No migration class export with an up() method was found');
};
const runTypeScriptMigration = async (migrationsDir, filename, queryRunner) => {
    const migrationPath = path_1.default.join(migrationsDir, filename);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const migrationModule = require(migrationPath);
    const MigrationClass = resolveMigrationConstructor(migrationModule);
    const migrationInstance = new MigrationClass();
    await migrationInstance.up(queryRunner);
};
const applyMigrations = async (migrationsDir = __dirname) => {
    console.warn('[MIGRATE] Ensure a DB backup exists before running migrations in production.');
    const client = await database_1.pool.connect();
    try {
        logger_1.logger.info('Starting database migrations...');
        await client.query(MIGRATIONS_TABLE_SQL);
        const appliedResult = await client.query('SELECT filename FROM schema_migrations');
        const appliedFiles = new Set(appliedResult.rows.map((row) => row.filename));
        const migrationFiles = listMigrationFiles(migrationsDir);
        for (const filename of migrationFiles) {
            if (appliedFiles.has(filename)) {
                logger_1.logger.info(`Skipping already applied migration: ${filename}`);
                continue;
            }
            await client.query('BEGIN');
            try {
                const migrationPath = path_1.default.join(migrationsDir, filename);
                if (filename.toLowerCase().endsWith('.sql')) {
                    const sql = fs_1.default.readFileSync(migrationPath, 'utf-8');
                    const normalizedSql = normalizeSqlForTransaction(sql);
                    await client.query(normalizedSql);
                }
                else {
                    await runTypeScriptMigration(migrationsDir, filename, {
                        query: async (queryText, parameters) => client.query(queryText, parameters),
                    });
                }
                await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
                await client.query('COMMIT');
                logger_1.logger.info(`Applied migration: ${filename}`);
            }
            catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
        logger_1.logger.info('Migrations completed successfully');
    }
    finally {
        client.release();
    }
};
exports.applyMigrations = applyMigrations;
async function runMigrations() {
    try {
        await (0, exports.applyMigrations)();
        process.exit(0);
    }
    catch (error) {
        logger_1.logger.error('Migration failed:', error);
        process.exit(1);
    }
}
if (require.main === module) {
    runMigrations();
}
