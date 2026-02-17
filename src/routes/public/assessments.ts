/**
 * File: src/routes/public/assessments.ts
 * Purpose: Public endpoints for retrieving assessment structure
 */

import { Router } from 'express';
import { query } from '../../config/database';
import { logger } from '../../utils/logger';

const router = Router();

const mapLevelAnchors = (topic: {
  level_1_label: string | null;
  level_2_label: string | null;
  level_3_label: string | null;
  level_4_label: string | null;
  level_5_label: string | null;
}): Array<string | null> => [
  topic.level_1_label ?? null,
  topic.level_2_label ?? null,
  topic.level_3_label ?? null,
  topic.level_4_label ?? null,
  topic.level_5_label ?? null,
];

/**
 * GET /api/public/assessments/active/structure
 * Returns the active assessment with dimensions and topics
 */
router.get('/active/structure', async (req, res, next) => {
  try {
    const result = await query(`
      WITH active_assessment AS (
        SELECT id, title, description, version
        FROM assessments
        WHERE is_active = true
          AND is_published = true
        ORDER BY published_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      )
      SELECT
        a.id as assessment_id,
        a.title,
        a.description,
        a.version,
        json_agg(
          json_build_object(
            'id', d.id,
            'dimensionKey', d.dimension_key,
            'title', d.title,
            'description', d.description,
            'category', d.category,
            'orderIndex', d.order_index,
            'topics', (
              SELECT json_agg(
                json_build_object(
                  'id', t.id,
                  'topicKey', t.topic_key,
                  'label', t.label,
                  'prompt', t.prompt,
                  'helpText', t.help_text,
                  'orderIndex', t.order_index,
                  'level_1_label', t.level_1_label,
                  'level_2_label', t.level_2_label,
                  'level_3_label', t.level_3_label,
                  'level_4_label', t.level_4_label,
                  'level_5_label', t.level_5_label
                ) ORDER BY t.order_index
              )
              FROM topics t
              WHERE t.dimension_id = d.id
            )
          ) ORDER BY d.order_index
        ) as dimensions
      FROM assessments a
      JOIN active_assessment aa ON aa.id = a.id
      LEFT JOIN dimensions d ON a.id = d.assessment_id
      GROUP BY a.id, a.title, a.description, a.version
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active assessment found' });
    }

    const assessment = result.rows[0];

    const normalizedDimensions = (assessment.dimensions || [])
      .filter((dimension: any) => dimension?.id)
      .map((dimension: any) => {
        const normalizedTopics = (dimension.topics || [])
          .filter((topic: any) => topic?.id)
          .map((topic: any) => ({
            id: topic.id,
            topicKey: topic.topicKey,
            label: topic.label,
            prompt: topic.prompt,
            orderIndex: topic.orderIndex ?? topic.order ?? 0,
            helpText: topic.helpText ?? undefined,
            levelAnchors: mapLevelAnchors(topic),
          }));

        return {
          ...dimension,
          orderIndex: dimension.orderIndex ?? dimension.order ?? 0,
          topics: normalizedTopics,
        };
      });

    res.json({
      assessment: {
        id: assessment.assessment_id,
        title: assessment.title,
        description: assessment.description,
        version: assessment.version,
      },
      dimensions: normalizedDimensions,
    });
  } catch (error) {
    logger.error('Error fetching assessment structure:', error);
    next(error);
  }
});

router.get('/active', async (req, res, next) => {
  try {
    const assessment = await query(`
      SELECT
        id, version, title, description, estimated_duration_minutes
      FROM assessments
      WHERE is_active = true AND is_published = true
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (assessment.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No active assessment available'
      });
    }

    const rawAssessment = assessment.rows[0];
    const normalizedAssessment = {
      ...rawAssessment,
      estimated_duration_minutes:
        typeof rawAssessment.estimated_duration_minutes === 'number'
          ? rawAssessment.estimated_duration_minutes
          : undefined,
      description: rawAssessment.description ?? '',
    };

    res.json({
      success: true,
      data: normalizedAssessment
    });
  } catch (error) {
    logger.error('Error fetching active assessment:', error);
    next(error);
  }
});

router.get('/:id/structure', async (req, res, next) => {
  try {
    const { id } = req.params;

    const assessmentResult = await query(
      `SELECT id, version, title, description
       FROM assessments
       WHERE id = $1 AND is_active = true AND is_published = true`,
      [id]
    );

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found or not active'
      });
    }

    const structureResult = await query(`
      SELECT
        d.id as dimension_id,
        d.dimension_key,
        d.title as dimension_title,
        d.description as dimension_description,
        d.order_index as dimension_order,
        json_agg(
          json_build_object(
            'id', t.id,
            'topicKey', t.topic_key,
            'label', t.label,
            'prompt', t.prompt,
            'order', t.order_index,
            'helpText', t.help_text,
            'level_1_label', t.level_1_label,
            'level_2_label', t.level_2_label,
            'level_3_label', t.level_3_label,
            'level_4_label', t.level_4_label,
            'level_5_label', t.level_5_label
          ) ORDER BY t.order_index
        ) as topics
      FROM dimensions d
      LEFT JOIN topics t ON d.id = t.dimension_id
      WHERE d.assessment_id = $1
      GROUP BY d.id
      ORDER BY d.order_index
    `, [id]);

    const dimensions = structureResult.rows.map((row) => {
      const normalizedTopics = Array.isArray(row.topics)
        ? row.topics
            .filter((topic: any) => topic?.id)
            .map((topic: any) => ({
              id: topic.id,
              topicKey: topic.topicKey,
              label: topic.label,
              prompt: topic.prompt,
              orderIndex: topic.order ?? topic.orderIndex ?? 0,
              helpText: topic.helpText ?? undefined,
              levelAnchors: mapLevelAnchors(topic),
            }))
        : [];

      return {
        id: row.dimension_id,
        dimensionKey: row.dimension_key,
        title: row.dimension_title,
        description: row.dimension_description ?? undefined,
        orderIndex: row.dimension_order ?? 0,
        topics: normalizedTopics,
      };
    });

    res.json({
      success: true,
      data: {
        assessment: assessmentResult.rows[0],
        dimensions
      }
    });

  } catch (error) {
    logger.error(`Error fetching assessment structure for ${req.params.id}:`, error);
    next(error);
  }
});

export default router;
