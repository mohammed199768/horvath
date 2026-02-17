import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../../config/database';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * GET /api/public/recommendations/definition
 * Returns the complete recommendations definition including rules and metadata
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Get all recommendation rules grouped by dimension
    const rulesResult = await query(`
      SELECT 
        dimension_key,
        json_agg(
          json_build_object(
            'id', rule_key,
            'title', title,
            'description', description,
            'conditions', conditions,
            'why', why,
            'what', what,
            'how', how,
            'priority', priority_score,
            'tags', tags,
            'impactLevel', impact_level,
            'effortLevel', effort_level,
            'timeframe', timeframe,
            'actionItems', action_items,
            'resources', resources,
            'kpis', kpis
          ) ORDER BY priority_score DESC
        ) as recommendations
      FROM recommendation_rules
      GROUP BY dimension_key
    `);

    // 2. Get all metadata
    const metaResult = await query(`
      SELECT meta_key, meta_value
      FROM recommendation_meta
    `);

    const normalizeRecommendation = (recommendation: any) => ({
      ...recommendation,
      why: recommendation.why ?? undefined,
      what: recommendation.what ?? undefined,
      how: recommendation.how ?? undefined,
      resources: Array.isArray(recommendation.resources) ? recommendation.resources : [],
      kpis: Array.isArray(recommendation.kpis) ? recommendation.kpis : [],
      tags: Array.isArray(recommendation.tags) ? recommendation.tags : [],
      actionItems: Array.isArray(recommendation.actionItems) ? recommendation.actionItems : [],
      conditions: recommendation.conditions ?? {},
      priority: parseFloat(
        String(
          recommendation.priority_score ??
            recommendation.priority ??
            0
        )
      ),
    });

    // Transform rules into dimensions array and sanitize nullable fields.
    const dimensions = rulesResult.rows.map((row: any) => ({
      dimensionKey: row.dimension_key,
      recommendations: Array.isArray(row.recommendations)
        ? row.recommendations.map(normalizeRecommendation)
        : [],
    }));

    // Transform metadata into object
    const meta: any = {};
    metaResult.rows.forEach((row: any) => {
      // Convert snake_case to camelCase for consistency
      const camelKey = row.meta_key.replace(/_([a-z])/g, (g: string) => g[1].toUpperCase());
      meta[camelKey] = row.meta_value;
    });

    // 3. Return in the expected format
    res.json({
      dimensions,
      meta
    });

    logger.info('Recommendations definition retrieved successfully');
  } catch (error) {
    logger.error('Error fetching recommendations definition:', error);
    next(error);
  }
});

export default router;
