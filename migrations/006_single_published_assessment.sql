BEGIN;

WITH ranked_published AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY published_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC, id DESC
    ) AS rn
  FROM assessments
  WHERE is_published = true
),
to_unpublish AS (
  SELECT id
  FROM ranked_published
  WHERE rn > 1
)
UPDATE assessments a
SET
  is_published = false,
  is_active = false
FROM to_unpublish u
WHERE a.id = u.id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_assessments_single_published
ON assessments ((1))
WHERE is_published = true;

COMMIT;
