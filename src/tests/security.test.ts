import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireRole } from '../middleware/rbac';
import { csrfProtection } from '../middleware/csrf';
import { requireResponseSession } from '../middleware/responseSession';
import { validatePasswordStrength } from '../utils/passwordValidator';
import * as database from '../config/database';
import adminAuthRouter from '../routes/admin/auth';
import publicResponsesRouter from '../routes/public/responses';
import { AuthService, AUTH_FAIL_MSG } from '../services/authService';
import { AssessmentRepository } from '../repositories/AssessmentRepository';

interface MockState {
  statusCode?: number;
  payload?: unknown;
}

const mockResponse = () => {
  const state: MockState = {};
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.payload = payload;
      return this;
    },
  };

  return { res, state };
};

const getRouteHandler = (
  router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> },
  routePath: string,
  method: 'get' | 'post' | 'put',
  stackIndex: number
): Function => {
  const routeLayer = router.stack.find(
    (layer) => layer.route?.path === routePath && Boolean(layer.route.methods[method])
  );

  if (!routeLayer || !routeLayer.route) {
    throw new Error(`Route handler not found for ${method.toUpperCase()} ${routePath}`);
  }

  return routeLayer.route.stack[stackIndex].handle;
};

const asMutableDatabase = (): { query: typeof database.query } =>
  database as unknown as { query: typeof database.query };

const testRequireRoleRejectsUnauthorizedRole = async () => {
  const middleware = requireRole('admin');
  const { res, state } = mockResponse();
  let nextCalled = false;

  middleware(
    {
      user: { role: 'creator', userId: 'u1', email: 'a@b.com', fullName: 'A B' },
    } as never,
    res as never,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false, 'next() should not be called for disallowed roles');
  assert.equal(state.statusCode, 403, 'middleware should return HTTP 403');
};

const testCsrfProtectionRejectsMissingToken = async () => {
  const { res, state } = mockResponse();
  let nextCalled = false;

  csrfProtection(
    {
      method: 'POST',
      headers: {},
      header: () => undefined,
    } as never,
    res as never,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false, 'next() should not be called when CSRF token is missing');
  assert.equal(state.statusCode, 403, 'middleware should return HTTP 403');
};

const testResponseSessionMiddlewareRejectsMissingToken = async () => {
  const { res, state } = mockResponse();
  let nextCalled = false;

  await requireResponseSession(
    {
      params: { responseId: '11111111-1111-1111-1111-111111111111' },
      header: () => undefined,
    } as never,
    res as never,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false, 'next() should not be called when response session token is missing');
  assert.equal(state.statusCode, 401, 'missing response session token should return HTTP 401');
};

const testResponseSessionMiddlewareRejectsMismatch = async () => {
  const mutableDb = asMutableDatabase();
  const originalQuery = mutableDb.query;
  mutableDb.query = (async () => ({ rows: [], rowCount: 0 } as never)) as typeof database.query;

  try {
    const { res, state } = mockResponse();
    let nextCalled = false;

    await requireResponseSession(
      {
        params: { responseId: '11111111-1111-1111-1111-111111111111' },
        header: () => 'invalid-token',
      } as never,
      res as never,
      () => {
        nextCalled = true;
      }
    );

    assert.equal(nextCalled, false, 'next() should not be called when response session token mismatches');
    assert.equal(state.statusCode, 403, 'mismatched response session token should return HTTP 403');
  } finally {
    mutableDb.query = originalQuery;
  }
};

const testCrossAssessmentTopicInjectionReturns422 = async () => {
  const originalMethod = AssessmentRepository.prototype.upsertTopicResponseForAssessment;
  AssessmentRepository.prototype.upsertTopicResponseForAssessment = async () => 0;

  try {
    const answerHandler = getRouteHandler(
      publicResponsesRouter as unknown as {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }>;
      },
      '/:responseId/answer',
      'put',
      1
    );

    const { res, state } = mockResponse();
    let nextCalled = false;

    await answerHandler(
      {
        params: { responseId: '11111111-1111-1111-1111-111111111111' },
        body: {
          topicId: '22222222-2222-2222-2222-222222222222',
          currentRating: 2,
          targetRating: 4,
          timeSpentSeconds: 12,
          notes: 'test',
        },
      },
      res,
      () => {
        nextCalled = true;
      }
    );

    assert.equal(nextCalled, false, 'next() should not be called for topic/assessment mismatch');
    assert.equal(state.statusCode, 422, 'cross-assessment topic submission must return HTTP 422');
  } finally {
    AssessmentRepository.prototype.upsertTopicResponseForAssessment = originalMethod;
  }
};

const testAuthLockoutReturnsGenericMessage = async () => {
  const loginHandler = getRouteHandler(
    adminAuthRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }>;
    },
    '/login',
    'post',
    1
  );

  const originalLogin = AuthService.login;
  AuthService.login = (async () => {
    throw new Error('Account locked until tomorrow');
  }) as typeof AuthService.login;

  try {
    let sixthState: MockState | null = null;

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const { res, state } = mockResponse();
      await loginHandler(
        {
          body: { email: 'admin@leadership.com', password: 'WrongPassword123!' },
          ip: '127.0.0.1',
          headers: { 'user-agent': 'security-test' },
        },
        res,
        () => undefined
      );

      assert.equal(state.statusCode, 401, `attempt ${attempt} should return HTTP 401`);
      assert.deepEqual(state.payload, { success: false, error: AUTH_FAIL_MSG });

      if (attempt === 6) {
        sixthState = state;
      }
    }

    assert.ok(sixthState, 'sixth attempt must be captured');
  } finally {
    AuthService.login = originalLogin;
  }
};

const testMigrationRunnerIsIdempotent = async () => {
  const migrationRunner = require('../../migrations/run') as {
    applyMigrations: (migrationsDir?: string) => Promise<void>;
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-idempotency-'));
  const migrationPath = path.join(tmpDir, '009_test.sql');
  fs.writeFileSync(migrationPath, 'BEGIN;\nSELECT 1;\nCOMMIT;\n', 'utf-8');

  const applied = new Set<string>();
  let executedSqlMigrationBodyCount = 0;

  const mutablePool = database.pool as unknown as {
    connect: typeof database.pool.connect;
  };
  const originalConnect = mutablePool.connect;

  const mockClient = {
    query: async (queryText: string, params?: unknown[]) => {
      const normalized = queryText.trim();

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return { rows: [], rowCount: 0 } as never;
      }

      if (normalized === 'SELECT filename FROM schema_migrations') {
        return {
          rows: Array.from(applied).map((filename) => ({ filename })),
          rowCount: applied.size,
        } as never;
      }

      if (normalized.startsWith('INSERT INTO schema_migrations')) {
        applied.add(String(params?.[0]));
        return { rows: [], rowCount: 1 } as never;
      }

      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [], rowCount: 0 } as never;
      }

      executedSqlMigrationBodyCount += 1;
      return { rows: [], rowCount: 0 } as never;
    },
    release: () => undefined,
  };

  mutablePool.connect = (async () => mockClient as never) as typeof database.pool.connect;

  try {
    await migrationRunner.applyMigrations(tmpDir);
    await migrationRunner.applyMigrations(tmpDir);

    assert.equal(executedSqlMigrationBodyCount, 1, 'migration SQL body should execute only once across two runs');
    assert.equal(applied.size, 1, 'schema_migrations should contain one applied migration');
  } finally {
    mutablePool.connect = originalConnect;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const testPasswordStrengthValidation = async () => {
  const weak = validatePasswordStrength('password123');
  assert.equal(weak.isStrong, false, 'weak password should be rejected');

  const strong = validatePasswordStrength('Str0ng!Mosaic#2026');
  assert.equal(strong.isStrong, true, 'strong password should be accepted');
};

const run = async () => {
  await testRequireRoleRejectsUnauthorizedRole();
  await testCsrfProtectionRejectsMissingToken();
  await testResponseSessionMiddlewareRejectsMissingToken();
  await testResponseSessionMiddlewareRejectsMismatch();
  await testCrossAssessmentTopicInjectionReturns422();
  await testAuthLockoutReturnsGenericMessage();
  await testMigrationRunnerIsIdempotent();
  await testPasswordStrengthValidation();
  console.log('Security tests passed');
};

run().catch((error) => {
  console.error('Security tests failed:', error);
  process.exit(1);
});
