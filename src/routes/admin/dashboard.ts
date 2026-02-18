/**
 * File: src/routes/admin/dashboard.ts
 * Purpose: Admin dashboard statistics and analytics
 */

import { Router } from 'express';
import { authenticateAdmin } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { query } from '../../config/database';
import { z } from 'zod';
import { validate } from '../../middleware/validation';

const router = Router();
const STATS_CACHE_TTL_MS = 30_000;

type DashboardStatsPayload = {
  overview: unknown;
  recentActivity: unknown[];
  topDimensions: unknown[];
  bottomDimensions: unknown[];
  industryStats: unknown[];
  recentCompletions: unknown[];
};

const statsCache = new Map<string, { data: DashboardStatsPayload; expiresAt: number }>();

const getCachedStats = (key: string): DashboardStatsPayload | null => {
  const entry = statsCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    statsCache.delete(key);
    return null;
  }

  return entry.data;
};

const setCachedStats = (key: string, data: DashboardStatsPayload, ttlMs = STATS_CACHE_TTL_MS): void => {
  // Complexity rationale: O(1) cache read/write avoids repeated O(n*m) aggregation within TTL windows.
  statsCache.set(key, { data, expiresAt: Date.now() + ttlMs });
};

const statsQuerySchema = z.object({
  query: z.object({
    range: z.enum(['all', '30d', '90d', '1y']).default('all'),
  }),
});

router.get('/stats', authenticateAdmin, requireRole('admin'), validate(statsQuerySchema), async (req, res, next) => {
  try {
    const { range } = req.query as unknown as z.infer<typeof statsQuerySchema>['query'];
    const cacheKey = `dashboard_stats:${range}`;
    const cached = getCachedStats(cacheKey);

    if (cached) {
      res.setHeader('x-cache', 'HIT');
      return res.json(cached);
    }

    const stats = await query(
      `
      WITH time_window AS (
        SELECT CASE 
          WHEN $1 = '30d' THEN INTERVAL '30 days'
          WHEN $1 = '90d' THEN INTERVAL '90 days'
          WHEN $1 = '1y' THEN INTERVAL '1 year'
          ELSE NULL
        END AS window_size
      ),
      filtered_responses AS (
        SELECT ar.*
        FROM assessment_responses ar
        CROSS JOIN time_window tw
        WHERE tw.window_size IS NULL OR ar.completed_at >= NOW() - tw.window_size
      ),
      overview_stats AS (
        SELECT
          (SELECT COUNT(*) FROM assessments WHERE is_active = true) AS active_assessments,
          (SELECT COUNT(*) FROM filtered_responses) AS total_responses,
          (SELECT COUNT(*) FROM filtered_responses WHERE status = 'completed') AS completed_responses,
          (SELECT COUNT(*) FROM filtered_responses WHERE status = 'in_progress') AS in_progress_responses,
          (SELECT COUNT(*) FROM participants) AS total_participants,
          (SELECT COUNT(DISTINCT participant_id) FROM filtered_responses WHERE status = 'completed') AS active_participants,
          (
            SELECT COALESCE(
              AVG(CASE WHEN overall_score::text = 'NaN' THEN NULL ELSE overall_score END),
              0
            )
            FROM filtered_responses
            WHERE status = 'completed'
          ) AS avg_overall_score,
          (SELECT COALESCE(AVG(overall_gap), 0) FROM filtered_responses WHERE status = 'completed') AS avg_overall_gap,
          (
            SELECT COALESCE(
              (COUNT(*) FILTER (WHERE status = 'completed')::DECIMAL / NULLIF(COUNT(*), 0) * 100),
              0
            )
            FROM filtered_responses
          ) AS completion_rate
      ),
      recent_activity AS (
        SELECT COALESCE(
          json_agg(
            json_build_object('date', activity.date, 'count', activity.count)
            ORDER BY activity.date
          ),
          '[]'::json
        ) AS data
        FROM (
          SELECT DATE(completed_at) AS date, COUNT(*) AS count
          FROM assessment_responses
          WHERE status = 'completed'
            AND completed_at >= CURRENT_DATE - INTERVAL '7 days'
          GROUP BY DATE(completed_at)
          ORDER BY DATE(completed_at)
        ) activity
      ),
      top_dimensions AS (
        SELECT COALESCE(
          json_agg(
            json_build_object('title', ranked.title, 'avg_score', ranked.avg_score)
            ORDER BY ranked.avg_score DESC
          ),
          '[]'::json
        ) AS data
        FROM (
          SELECT
            d.title,
            COALESCE(
              AVG(CASE WHEN cp.dimension_score::text = 'NaN' THEN NULL ELSE cp.dimension_score END),
              0
            ) AS avg_score
          FROM dimensions d
          JOIN computed_priorities cp ON d.id = cp.dimension_id
          JOIN filtered_responses ar ON cp.response_id = ar.id
          WHERE ar.status = 'completed'
          GROUP BY d.id, d.title
          ORDER BY avg_score DESC
          LIMIT 5
        ) ranked
      ),
      bottom_dimensions AS (
        SELECT COALESCE(
          json_agg(
            json_build_object('title', ranked.title, 'avg_gap', ranked.avg_gap, 'avg_priority', ranked.avg_priority)
            ORDER BY ranked.avg_gap DESC
          ),
          '[]'::json
        ) AS data
        FROM (
          SELECT
            d.title,
            COALESCE(AVG(cp.dimension_gap), 0) AS avg_gap,
            COALESCE(AVG(cp.priority_score), 0) AS avg_priority
          FROM dimensions d
          JOIN computed_priorities cp ON d.id = cp.dimension_id
          JOIN filtered_responses ar ON cp.response_id = ar.id
          WHERE ar.status = 'completed'
          GROUP BY d.id, d.title
          ORDER BY avg_gap DESC
          LIMIT 5
        ) ranked
      ),
      industry_stats AS (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'industry', ranked.industry,
              'total', ranked.total,
              'completed', ranked.completed,
              'completion_rate', ranked.completion_rate,
              'avg_score', ranked.avg_score
            )
            ORDER BY ranked.total DESC
          ),
          '[]'::json
        ) AS data
        FROM (
          SELECT
            p.industry,
            COUNT(ar.id) AS total,
            COUNT(*) FILTER (WHERE ar.status = 'completed') AS completed,
            (COUNT(*) FILTER (WHERE ar.status = 'completed')::DECIMAL / NULLIF(COUNT(ar.id), 0) * 100) AS completion_rate,
            COALESCE(
              AVG(
                CASE
                  WHEN ar.status = 'completed' AND ar.overall_score::text <> 'NaN' THEN ar.overall_score
                  ELSE NULL
                END
              ),
              0
            ) AS avg_score
          FROM participants p
          JOIN filtered_responses ar ON p.id = ar.participant_id
          WHERE p.industry IS NOT NULL
          GROUP BY p.industry
          HAVING COUNT(ar.id) > 0
          ORDER BY total DESC
          LIMIT 10
        ) ranked
      ),
      recent_completions AS (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'id', ranked.id,
              'completed_at', ranked.completed_at,
              'overall_score', ranked.overall_score,
              'full_name', ranked.full_name,
              'company_name', ranked.company_name,
              'industry', ranked.industry
            )
            ORDER BY ranked.completed_at DESC
          ),
          '[]'::json
        ) AS data
        FROM (
          SELECT
            ar.id,
            ar.completed_at,
            CASE WHEN ar.overall_score::text = 'NaN' THEN NULL ELSE ar.overall_score END AS overall_score,
            p.full_name,
            p.company_name,
            p.industry
          FROM filtered_responses ar
          JOIN participants p ON ar.participant_id = p.id
          WHERE ar.status = 'completed'
          ORDER BY ar.completed_at DESC
          LIMIT 10
        ) ranked
      )
      SELECT
        row_to_json(overview_stats.*) AS overview,
        recent_activity.data AS recent_activity,
        top_dimensions.data AS top_dimensions,
        bottom_dimensions.data AS bottom_dimensions,
        industry_stats.data AS industry_stats,
        recent_completions.data AS recent_completions
      FROM overview_stats, recent_activity, top_dimensions, bottom_dimensions, industry_stats, recent_completions;
      `,
      [range]
    );

    const payload: DashboardStatsPayload = {
      overview: stats.rows[0].overview,
      recentActivity: stats.rows[0].recent_activity || [],
      topDimensions: stats.rows[0].top_dimensions || [],
      bottomDimensions: stats.rows[0].bottom_dimensions || [],
      industryStats: stats.rows[0].industry_stats || [],
      recentCompletions: stats.rows[0].recent_completions || [],
    };

    setCachedStats(cacheKey, payload);
    res.setHeader('x-cache', 'MISS');
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.get('/activity', authenticateAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const activity = await query(`
      SELECT 
        'response' as type,
        ar.id,
        ar.status,
        ar.last_updated_at as timestamp,
        p.full_name as participant_name,
        p.company_name,
        a.title as assessment_title
      FROM assessment_responses ar
      JOIN participants p ON ar.participant_id = p.id
      JOIN assessments a ON ar.assessment_id = a.id
      WHERE ar.last_updated_at >= NOW() - INTERVAL '24 hours'
      ORDER BY ar.last_updated_at DESC
      LIMIT 20
    `);

    res.json(activity.rows);
  } catch (error) {
    next(error);
  }
});

export default router;
