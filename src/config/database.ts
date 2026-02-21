/**
 * File: src/config/database.ts
 * Purpose: Configures PostgreSQL connection pool and query execution
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from './env';
import { logger } from '../utils/logger';

const databaseUrl = process.env.DATABASE_URL;

const getDatabaseUrlSslConfig = (url: string): { rejectUnauthorized: false } | false => {
  const normalizedUrl = url.toLowerCase();

  if (normalizedUrl.includes('railway.net')) {
    return { rejectUnauthorized: false };
  }

  if (normalizedUrl.includes('localhost') || normalizedUrl.includes('127.0.0.1')) {
    return false;
  }

  return false;
};

const sharedPoolConfig = {
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
  ...(config.database.statementTimeout
    ? { options: `--statement_timeout=${config.database.statementTimeout}` }
    : {}),
};

export const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: getDatabaseUrlSslConfig(databaseUrl),
      ...sharedPoolConfig,
    })
  : new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: String(config.database.password),
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
      ...sharedPoolConfig,
    });

pool.on('connect', () => {
  logger.info('Database connected successfully');
});

pool.on('error', (err) => {
  logger.error('[DB_POOL] Unexpected error on idle client', {
    message: err.message,
    stack: err.stack,
  });
});

export const query = async (text: string, params?: unknown[]): Promise<QueryResult> => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('Query error', { text, error });
    throw error;
  }
};

type ManagedPoolClient = PoolClient & {
  // Using `any` here is unavoidable because pg's query signature is heavily overloaded.
  query: (...args: any[]) => any;
  release: () => void;
};

export const getClient = async (): Promise<ManagedPoolClient> => {
  const client = await pool.connect();
  const query = client.query;
  const release = client.release;
  
  // Set a timeout to warn if client is checked out for too long
  const timeout = setTimeout(() => {
    logger.error('A client has been checked out for more than 5 seconds!');
  }, 5000);
  
  // Monkey patch query to keep original signature but allow interception if needed
  // Using `any` is unavoidable to preserve all pg query overloads safely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.query = (...args: any[]) => {
    const queryFn = query as unknown as (...innerArgs: any[]) => any;
    return queryFn.apply(client, args);
  };
  
  client.release = () => {
    clearTimeout(timeout);
    client.query = query;
    client.release = release;
    return release.apply(client);
  };
  
  return client as ManagedPoolClient;
};
