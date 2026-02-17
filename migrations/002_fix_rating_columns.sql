-- Migration: Normalize topic_responses rating columns safely (non-destructive)
BEGIN;

ALTER TABLE topic_responses
  ADD COLUMN IF NOT EXISTS current_rating NUMERIC,
  ADD COLUMN IF NOT EXISTS target_rating NUMERIC;

ALTER TABLE topic_responses
  ALTER COLUMN current_rating TYPE NUMERIC(5,2) USING current_rating::NUMERIC,
  ALTER COLUMN target_rating TYPE NUMERIC(5,2) USING target_rating::NUMERIC;

ALTER TABLE topic_responses
  ADD COLUMN IF NOT EXISTS time_spent_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE topic_responses DROP CONSTRAINT IF EXISTS topic_responses_current_rating_check;
ALTER TABLE topic_responses DROP CONSTRAINT IF EXISTS topic_responses_target_rating_check;

ALTER TABLE topic_responses
  ADD CONSTRAINT topic_responses_current_rating_check CHECK (current_rating >= 1 AND current_rating <= 5),
  ADD CONSTRAINT topic_responses_target_rating_check CHECK (target_rating >= 1 AND target_rating <= 5);

CREATE INDEX IF NOT EXISTS idx_topic_responses_response ON topic_responses(response_id);
CREATE INDEX IF NOT EXISTS idx_topic_responses_topic ON topic_responses(topic_id);

COMMIT;
