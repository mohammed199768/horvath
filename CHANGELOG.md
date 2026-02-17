# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-02-17
### Added
- Added `src/middleware/responseSession.ts` to enforce `x-session-token` checks on sensitive public response endpoints.
- Added `migrations/007_session_token.sql` to enforce/backfill `assessment_responses.session_token`.
- Added `migrations/008_participant_token.sql` to enforce/backfill `participants.participant_token`.
- Added migration-state verification at server startup (`REQUIRE_MIGRATIONS` support).
- Added `_ops/` operational scripts directory and `.gitignore` entry.
- Added migration tracking table support in migration runner (`schema_migrations`).

### Changed
- Hardened public response routes in `src/routes/public/responses.ts`:
  - Session enforcement for answer/complete/results/recommendations endpoints.
  - Guarded topic upsert to prevent cross-assessment topic injection.
- Added guarded repository method `upsertTopicResponseForAssessment` in `src/repositories/AssessmentRepository.ts`.
- Hardened participant route logic in `src/routes/public/participants.ts`:
  - Update now requires `x-participant-token`.
  - Participant token returned only at creation time.
- Reworked `migrations/run.ts`:
  - Executes both `.sql` and `.ts` migrations in sorted order.
  - Tracks applied files and skips already-applied migrations.
  - Applies each migration in an explicit transaction.
  - Logs backup reminder before migration execution.
- Rewrote `migrations/002_fix_rating_columns.sql` to non-destructive ALTER-based behavior.
- Hardened authentication behavior:
  - Unified auth failure response to `Invalid credentials`.
  - Atomic lockout increment query in `src/services/authService.ts`.
  - Dedicated login limiter and global rate-limit config usage in `src/index.ts`.
- Hardened startup migration verification in `src/index.ts` by creating `schema_migrations` if missing before validation.
- Improved DB resilience in `src/config/database.ts`:
  - Removed `process.exit` on pool error.
  - Added statement-timeout pool option from env.
- Updated `src/routes/public/assessments.ts` to require published active assessment for structure endpoint.
- Replaced N+1 update pattern in `PUT /api/admin/assessments/:id` with set-based JSON bulk upserts in one transaction.
- Updated scripts (`scripts/e2e-flow-test.ts`, `scripts/post-implementation-verification.ts`) for session-token protected result flows.

### Security
- Removed hardcoded seed/reset credentials from active code paths.
- Removed remaining hardcoded admin password from `test-api.ps1` and switched to `SEED_ADMIN_PASSWORD`.
- Seeding now requires `SEED_ADMIN_PASSWORD` and production seeding is blocked in `seeds/seed-all.ts`.
- Removed stray files `1` and `console.error(e))`.

### Fixed
- Expanded `src/tests/security.test.ts` to cover:
  - Response session IDOR protection behavior (`401/403`).
  - Cross-assessment topic injection returning `422`.
  - Generic lockout auth failure behavior.
  - Migration idempotency behavior (double run).

### Notes
- `npm audit fix` and `npm audit --audit-level=high` still report transitive high vulnerabilities:
  - `tar` (via `@mapbox/node-pre-gyp`).
