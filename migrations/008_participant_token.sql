BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS participant_token VARCHAR(255);

UPDATE participants
SET participant_token = encode(gen_random_bytes(32), 'hex')
WHERE participant_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_token_unique
ON participants(participant_token)
WHERE participant_token IS NOT NULL;

COMMIT;
