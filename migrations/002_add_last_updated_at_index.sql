-- @no-transaction
-- Complexity: reduces dashboard activity query from O(n) full scan to O(log n + k)
-- where k = rows in the last 24h window (k << n as dataset grows).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assessment_responses_last_updated_at
  ON assessment_responses (last_updated_at DESC);
