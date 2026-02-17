BEGIN;

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS level_1_label TEXT,
  ADD COLUMN IF NOT EXISTS level_2_label TEXT,
  ADD COLUMN IF NOT EXISTS level_3_label TEXT,
  ADD COLUMN IF NOT EXISTS level_4_label TEXT,
  ADD COLUMN IF NOT EXISTS level_5_label TEXT;

CREATE TABLE IF NOT EXISTS topic_recommendations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id       UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  score_min      DECIMAL(3,1),
  score_max      DECIMAL(3,1),
  target_min     DECIMAL(3,1),
  target_max     DECIMAL(3,1),
  gap_min        DECIMAL(3,1),
  gap_max        DECIMAL(3,1),
  title          VARCHAR(255) NOT NULL,
  description    TEXT,
  why            TEXT,
  what           TEXT,
  how            TEXT,
  action_items   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  category       VARCHAR(50)  NOT NULL DEFAULT 'Project'
                   CHECK (category IN ('Quick Win','Project','Big Bet')),
  priority       INTEGER      NOT NULL DEFAULT 50
                   CHECK (priority BETWEEN 0 AND 100),
  tags           TEXT[]       NOT NULL DEFAULT '{}',
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  order_index    INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topic_recs_topic_id
  ON topic_recommendations(topic_id);

CREATE INDEX IF NOT EXISTS idx_topic_recs_active
  ON topic_recommendations(topic_id, is_active)
  WHERE is_active = true;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_topic_recommendations_updated_at ON topic_recommendations;
CREATE TRIGGER trg_topic_recommendations_updated_at
  BEFORE UPDATE ON topic_recommendations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;