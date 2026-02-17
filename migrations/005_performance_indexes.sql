BEGIN;

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_topic_recs_topic_active
ON topic_recommendations(topic_id)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_topic_recs_priority
ON topic_recommendations(topic_id, priority DESC)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_computed_priorities_response
ON computed_priorities(response_id, priority_score DESC);

CREATE INDEX IF NOT EXISTS idx_topics_dimension_active
ON topics(dimension_id, order_index)
WHERE is_active = true;

COMMIT;
