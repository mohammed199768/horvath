BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE assessment_responses
  ADD COLUMN IF NOT EXISTS session_token VARCHAR(255);

UPDATE assessment_responses
SET session_token = encode(gen_random_bytes(32), 'hex')
WHERE session_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_responses_session_token_unique
ON assessment_responses(session_token)
WHERE session_token IS NOT NULL;

COMMIT;
