/**
 * File: src/routes/admin/analytics.ts
 * Purpose: Advanced analytics and data export
 */

import { Router } from 'express';
import { authenticateAdmin } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { query } from '../../config/database';
import { z } from 'zod';
import { validate } from '../../middleware/validation';

const router = Router();

const exportResponsesSchema = z.object({
  query: z.object({
    assessment_id: z.string().uuid().optional(),
  }),
});

router.get('/', authenticateAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const dimensionPerformance = await query(`
      SELECT 
        d.title,
        d.category,
        AVG(CASE WHEN cp.dimension_score::text = 'NaN' THEN NULL ELSE cp.dimension_score END) as avg_score,
        AVG(cp.dimension_gap) as avg_gap,
        MIN(CASE WHEN cp.dimension_score::text = 'NaN' THEN NULL ELSE cp.dimension_score END) as min_score,
        MAX(CASE WHEN cp.dimension_score::text = 'NaN' THEN NULL ELSE cp.dimension_score END) as max_score
      FROM computed_priorities cp
      JOIN dimensions d ON cp.dimension_id = d.id
      JOIN assessment_responses ar ON cp.response_id = ar.id
      WHERE ar.status = 'completed'
      GROUP BY d.id, d.title, d.category, d.order_index
      ORDER BY d.order_index
    `);

    const responseTrends = await query(`
        SELECT 
            DATE(completed_at) as date,
            COUNT(*) as count,
            AVG(CASE WHEN overall_score::text = 'NaN' THEN NULL ELSE overall_score END) as avg_score
        FROM assessment_responses
        WHERE status = 'completed'
        AND completed_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY DATE(completed_at)
        ORDER BY date
    `);

    const scoreDistribution = await query(`
      SELECT
        bucket,
        COUNT(*) as count
      FROM (
        SELECT
          CASE
            WHEN overall_score >= 1 AND overall_score < 2 THEN '1-2'
            WHEN overall_score >= 2 AND overall_score < 3 THEN '2-3'
            WHEN overall_score >= 3 AND overall_score < 4 THEN '3-4'
            WHEN overall_score >= 4 AND overall_score <= 5 THEN '4-5'
            ELSE 'other'
          END AS bucket
        FROM assessment_responses
        WHERE status = 'completed'
          AND overall_score::text <> 'NaN'
      ) s
      WHERE bucket <> 'other'
      GROUP BY bucket
    `);

    const orderedBuckets = ['1-2', '2-3', '3-4', '4-5'];
    const scoreDistributionMap = new Map<string, number>();
    for (const row of scoreDistribution.rows) {
      scoreDistributionMap.set(row.bucket, Number(row.count));
    }
    const normalizedDistribution = orderedBuckets.map((bucket) => ({
      range: bucket,
      label: bucket,
      count: scoreDistributionMap.get(bucket) ?? 0,
    }));

    res.json({
      dimension_performance: dimensionPerformance.rows,
      response_trends: responseTrends.rows,
      score_distribution: normalizedDistribution,
      generated_at: new Date()
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/export/responses',
  authenticateAdmin,
  requireRole('admin'),
  validate(exportResponsesSchema),
  async (req, res, next) => {
  try {
    const { assessment_id } = req.query as unknown as z.infer<typeof exportResponsesSchema>['query'];
    
    let queryStr = `
      SELECT 
        ar.id as response_id,
        p.full_name,
        p.email,
        p.company_name,
        ar.overall_score,
        ar.overall_gap,
        ar.completed_at
      FROM assessment_responses ar
      JOIN participants p ON ar.participant_id = p.id
      WHERE ar.status = 'completed'
    `;
    
    const params: any[] = [];
    if (assessment_id) {
      queryStr += ` AND ar.assessment_id = $1`;
      params.push(assessment_id);
    }
    
    queryStr += ` ORDER BY ar.completed_at DESC`;
    
    const result = await query(queryStr, params);
    
    // In a real app, we would generate a CSV file here
    // For now, return JSON which the frontend can convert
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
}
);

router.get('/dimension-breakdown', authenticateAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    // Aggregated scores by dimension across all responses
    const result = await query(`
      SELECT 
        d.title,
        d.category,
        AVG(CASE WHEN cp.dimension_score::text = 'NaN' THEN NULL ELSE cp.dimension_score END) as avg_score,
        AVG(cp.dimension_gap) as avg_gap,
        MIN(CASE WHEN cp.dimension_score::text = 'NaN' THEN NULL ELSE cp.dimension_score END) as min_score,
        MAX(CASE WHEN cp.dimension_score::text = 'NaN' THEN NULL ELSE cp.dimension_score END) as max_score
      FROM computed_priorities cp
      JOIN dimensions d ON cp.dimension_id = d.id
      JOIN assessment_responses ar ON cp.response_id = ar.id
      WHERE ar.status = 'completed'
      GROUP BY d.id, d.title, d.category, d.order_index
      ORDER BY d.order_index
    `);
    
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

export default router;
