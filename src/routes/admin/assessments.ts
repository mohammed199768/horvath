/**
 * File: src/routes/admin/assessments.ts
 * Purpose: Manage assessments, dimensions, and topics
 */

import { Router } from 'express';
import { authenticateAdmin, AuthRequest } from '../../middleware/auth';
import { query, getClient } from '../../config/database';
import { z } from 'zod';
import { validate } from '../../middleware/validation';
import { requireRole } from '../../middleware/rbac';
import { csrfProtection } from '../../middleware/csrf';
import { AssessmentRepository } from '../../repositories/AssessmentRepository';

const router = Router();
const assessmentRepository = new AssessmentRepository();

const createAssessmentSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  version: z.number().int().positive(),
  dimensions: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      description: z.string().optional(),
      category: z.string(),
      order: z.number(),
      topics: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          prompt: z.string(),
          help_text: z.string().optional(),
          order: z.number(),
        })
      ),
    })
  ),
});

const upsertTopicSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string(),
  label: z.string(),
  prompt: z.string(),
  help_text: z.string().optional(),
  order: z.number(),
  level_1_label: z.string().max(500).nullable().optional(),
  level_2_label: z.string().max(500).nullable().optional(),
  level_3_label: z.string().max(500).nullable().optional(),
  level_4_label: z.string().max(500).nullable().optional(),
  level_5_label: z.string().max(500).nullable().optional(),
});

const upsertDimensionSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string(),
  title: z.string(),
  description: z.string().optional(),
  category: z.string(),
  order: z.number(),
  topics: z.array(upsertTopicSchema),
});

const updateAssessmentSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    title: z.string().min(3),
    description: z.string().optional(),
    version: z.number().int().positive(),
    dimensions: z.array(upsertDimensionSchema),
  }),
});

const assessmentIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

const publishAssessmentSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    is_published: z.boolean(),
  }),
});

router.get('/', authenticateAdmin, requireRole('admin', 'creator'), async (req, res, next) => {
  try {
    const assessments = await assessmentRepository.findAll();
    res.json(assessments);
  } catch (error) {
    next(error);
  }
});

router.get(
  '/:id',
  authenticateAdmin,
  requireRole('admin', 'creator'),
  validate(assessmentIdSchema),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const assessment = await assessmentRepository.findById(id);
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    res.json(assessment);
  } catch (error) {
    next(error);
  }
}
);

router.post(
  '/',
  authenticateAdmin,
  requireRole('admin', 'creator'),
  csrfProtection,
  validate(createAssessmentSchema),
  async (req: AuthRequest, res, next) => {
    const { title, description, version, dimensions } = req.body;
    const userId = req.user?.userId;

    const client = await getClient();

    try {
      await client.query('BEGIN');

      const assessmentResult = await client.query(
        `INSERT INTO assessments (title, description, version, created_by, is_active)
         VALUES ($1, $2, $3, $4, false)
         RETURNING id`,
        [title, description || null, version, userId]
      );

      const assessmentId = assessmentResult.rows[0].id;

      // Batch dimension insert to avoid per-dimension round-trips.
      const dimensionValues: string[] = [];
      const dimensionParams: unknown[] = [];
      let paramIndex = 1;

      for (const dim of dimensions) {
        dimensionValues.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        dimensionParams.push(
          assessmentId,
          dim.key,
          dim.title,
          dim.description || null,
          dim.category,
          dim.order
        );
      }

      const dimensionsResult = await client.query(
        `INSERT INTO dimensions (assessment_id, dimension_key, title, description, category, order_index)
         VALUES ${dimensionValues.join(', ')}
         RETURNING id, dimension_key`,
        dimensionParams
      );

      const dimensionIdMap = new Map<string, string>();
      dimensionsResult.rows.forEach((row: { dimension_key: string; id: string }) => {
        dimensionIdMap.set(row.dimension_key, row.id);
      });

      // Batch topic insert to avoid per-topic round-trips.
      const topicValues: string[] = [];
      const topicParams: unknown[] = [];
      paramIndex = 1;

      for (const dim of dimensions) {
        const dimensionId = dimensionIdMap.get(dim.key);
        if (!dimensionId) {
          throw new Error(`Dimension mapping missing for key: ${dim.key}`);
        }

        for (const topic of dim.topics) {
          topicValues.push(
            `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
          );
          topicParams.push(
            dimensionId,
            topic.key,
            topic.label,
            topic.prompt,
            topic.help_text || null,
            topic.order
          );
        }
      }

      if (topicValues.length > 0) {
        await client.query(
          `INSERT INTO topics (dimension_id, topic_key, label, prompt, help_text, order_index)
           VALUES ${topicValues.join(', ')}`,
          topicParams
        );
      }

      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, user_id, ip_address)
         VALUES ('assessment', $1, 'created', $2, $3)`,
        [assessmentId, userId, req.ip]
      );

      await client.query('COMMIT');

      res.status(201).json({
        id: assessmentId,
        message: 'Assessment created successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

router.patch(
  '/:id/publish',
  authenticateAdmin,
  requireRole('admin', 'creator'),
  csrfProtection,
  validate(publishAssessmentSchema),
  async (req: AuthRequest, res, next) => {
  const { id } = req.params;
  const { is_published } = req.body;
  const userId = req.user?.userId;

  const client = await getClient();

  try {
    await client.query('BEGIN');

    const existsResult = await client.query(
      'SELECT id FROM assessments WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (existsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (is_published) {
      await client.query(
        `UPDATE assessments
         SET is_published = false,
             is_active = false
         WHERE is_published = true
           AND id <> $1`,
        [id]
      );
    }

    const updateResult = await client.query(
      `UPDATE assessments 
       SET is_published = $1, 
           is_active = $1,
           published_at = CASE WHEN $1 THEN NOW() ELSE published_at END
       WHERE id = $2`,
      [is_published, id]
    );

    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assessment not found' });
    }

    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, user_id, ip_address)
       VALUES ('assessment', $1, $2, $3, $4)`,
      [id, is_published ? 'published' : 'unpublished', userId, req.ip]
    );

    await client.query('COMMIT');

    res.json({
      message: `Assessment ${is_published ? 'published' : 'unpublished'} successfully`,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Only one assessment can be published at a time' });
    }
    next(error);
  } finally {
    client.release();
  }
}
);

router.put(
  '/:id',
  authenticateAdmin,
  requireRole('admin', 'creator'),
  csrfProtection,
  validate(updateAssessmentSchema),
  async (req: AuthRequest, res, next) => {
    const { id: assessmentId } = req.params;
    const { title, description, version, dimensions } = req.body;
    const userId = req.user?.userId;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const hasIsActiveResult = await client.query(
        `SELECT EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_name = 'dimensions' AND column_name = 'is_active'
         ) AS dimensions_has_is_active,
         EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_name = 'topics' AND column_name = 'is_active'
         ) AS topics_has_is_active`
      );

      const { dimensions_has_is_active, topics_has_is_active } = hasIsActiveResult.rows[0] as {
        dimensions_has_is_active: boolean;
        topics_has_is_active: boolean;
      };

      const assessmentUpdate = await client.query(
        `UPDATE assessments
         SET title = $1,
             description = $2,
             version = $3,
             updated_at = NOW()
         WHERE id = $4
         RETURNING id`,
        [title, description || null, version, assessmentId]
      );

      if (assessmentUpdate.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Assessment not found' });
      }

      const dimensionPayload = dimensions.map((dimension: {
        id?: string;
        key: string;
        title: string;
        description?: string;
        category: string;
        order: number;
        topics: Array<{
          id?: string;
          key: string;
          label: string;
          prompt: string;
          help_text?: string;
          order: number;
          level_1_label?: string | null;
          level_2_label?: string | null;
          level_3_label?: string | null;
          level_4_label?: string | null;
          level_5_label?: string | null;
        }>;
      }) => ({
        id: dimension.id ?? null,
        dimension_key: dimension.key,
        title: dimension.title,
        description: dimension.description ?? null,
        category: dimension.category,
        order_index: dimension.order,
      }));

      const upsertedDimensionsResult = await client.query(
        `WITH incoming AS (
           SELECT *
           FROM jsonb_to_recordset($1::jsonb) AS d(
             id uuid,
             dimension_key text,
             title text,
             description text,
             category text,
             order_index integer
           )
         )
         INSERT INTO dimensions (
           id, assessment_id, dimension_key, title, description, category, order_index
         )
         SELECT
           COALESCE(incoming.id, gen_random_uuid()),
           $2::uuid,
           incoming.dimension_key,
           incoming.title,
           incoming.description,
           incoming.category,
           incoming.order_index
         FROM incoming
         ON CONFLICT (assessment_id, dimension_key)
         DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           order_index = EXCLUDED.order_index,
           updated_at = NOW()
         RETURNING id, dimension_key`,
        [JSON.stringify(dimensionPayload), assessmentId]
      );

      const keptDimensionIds = upsertedDimensionsResult.rows.map((row: { id: string }) => row.id);

      const topicPayload = dimensions.flatMap((dimension: {
        key: string;
        topics: Array<{
          id?: string;
          key: string;
          label: string;
          prompt: string;
          help_text?: string;
          order: number;
          level_1_label?: string | null;
          level_2_label?: string | null;
          level_3_label?: string | null;
          level_4_label?: string | null;
          level_5_label?: string | null;
        }>;
      }) =>
        dimension.topics.map((topic) => ({
          id: topic.id ?? null,
          dimension_key: dimension.key,
          topic_key: topic.key,
          label: topic.label,
          prompt: topic.prompt,
          help_text: topic.help_text ?? null,
          order_index: topic.order,
          level_1_label: topic.level_1_label ?? null,
          level_2_label: topic.level_2_label ?? null,
          level_3_label: topic.level_3_label ?? null,
          level_4_label: topic.level_4_label ?? null,
          level_5_label: topic.level_5_label ?? null,
        }))
      );

      let keptTopicIds: string[] = [];

      if (topicPayload.length > 0) {
        const upsertedTopicsResult = await client.query(
          `WITH incoming AS (
             SELECT *
             FROM jsonb_to_recordset($1::jsonb) AS t(
               id uuid,
               dimension_key text,
               topic_key text,
               label text,
               prompt text,
               help_text text,
               order_index integer,
               level_1_label text,
               level_2_label text,
               level_3_label text,
               level_4_label text,
               level_5_label text
             )
           ),
           resolved AS (
             SELECT
               COALESCE(incoming.id, gen_random_uuid()) AS id,
               d.id AS dimension_id,
               incoming.topic_key,
               incoming.label,
               incoming.prompt,
               incoming.help_text,
               incoming.order_index,
               incoming.level_1_label,
               incoming.level_2_label,
               incoming.level_3_label,
               incoming.level_4_label,
               incoming.level_5_label
             FROM incoming
             JOIN dimensions d
               ON d.assessment_id = $2::uuid
              AND d.dimension_key = incoming.dimension_key
           )
           INSERT INTO topics (
             id, dimension_id, topic_key, label, prompt, help_text, order_index,
             level_1_label, level_2_label, level_3_label, level_4_label, level_5_label
           )
           SELECT
             id, dimension_id, topic_key, label, prompt, help_text, order_index,
             level_1_label, level_2_label, level_3_label, level_4_label, level_5_label
           FROM resolved
           ON CONFLICT (dimension_id, topic_key)
           DO UPDATE SET
             label = EXCLUDED.label,
             prompt = EXCLUDED.prompt,
             help_text = EXCLUDED.help_text,
             order_index = EXCLUDED.order_index,
             level_1_label = EXCLUDED.level_1_label,
             level_2_label = EXCLUDED.level_2_label,
             level_3_label = EXCLUDED.level_3_label,
             level_4_label = EXCLUDED.level_4_label,
             level_5_label = EXCLUDED.level_5_label,
             updated_at = NOW()
           RETURNING id`,
          [JSON.stringify(topicPayload), assessmentId]
        );

        keptTopicIds = upsertedTopicsResult.rows.map((row: { id: string }) => row.id);
      }

      if (topics_has_is_active && keptTopicIds.length > 0) {
        await client.query(
          `UPDATE topics
           SET is_active = true, updated_at = NOW()
           WHERE id = ANY($1::uuid[])`,
          [keptTopicIds]
        );
      }

      if (topics_has_is_active) {
        await client.query(
          `UPDATE topics t
           SET is_active = false, updated_at = NOW()
           FROM dimensions d
           WHERE t.dimension_id = d.id
             AND d.assessment_id = $1
             AND (cardinality($2::uuid[]) = 0 OR t.id <> ALL($2::uuid[]))`,
          [assessmentId, keptTopicIds]
        );
      } else {
        await client.query(
          `DELETE FROM topics t
           USING dimensions d
           WHERE t.dimension_id = d.id
             AND d.assessment_id = $1
             AND (cardinality($2::uuid[]) = 0 OR t.id <> ALL($2::uuid[]))`,
          [assessmentId, keptTopicIds]
        );
      }

      if (dimensions_has_is_active) {
        if (keptDimensionIds.length > 0) {
          await client.query(
            `UPDATE dimensions
             SET is_active = true, updated_at = NOW()
             WHERE id = ANY($1::uuid[])`,
            [keptDimensionIds]
          );
        }
        await client.query(
          `UPDATE dimensions
           SET is_active = false, updated_at = NOW()
           WHERE assessment_id = $1
             AND (cardinality($2::uuid[]) = 0 OR id <> ALL($2::uuid[]))`,
          [assessmentId, keptDimensionIds]
        );
      } else {
        await client.query(
          `DELETE FROM dimensions
           WHERE assessment_id = $1
             AND (cardinality($2::uuid[]) = 0 OR id <> ALL($2::uuid[]))`,
          [assessmentId, keptDimensionIds]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, user_id, ip_address)
         VALUES ('assessment', $1, 'updated', $2, $3)`,
        [assessmentId, userId, req.ip]
      );

      await client.query('COMMIT');
      res.json({ id: assessmentId, message: 'Assessment updated successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

router.delete(
  '/:id',
  authenticateAdmin,
  requireRole('admin', 'creator'),
  csrfProtection,
  validate(assessmentIdSchema),
  async (req: AuthRequest, res, next) => {
  const { id } = req.params;
  const userId = req.user?.userId;

  try {
    const hasResponses = await query(
      'SELECT COUNT(*) as count FROM assessment_responses WHERE assessment_id = $1',
      [id]
    );

    if (parseInt(hasResponses.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'Cannot delete assessment with existing responses',
        response_count: hasResponses.rows[0].count,
      });
    }

    await assessmentRepository.delete(id);

    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, user_id, ip_address)
       VALUES ('assessment', $1, 'deleted', $2, $3)`,
      [id, userId, req.ip]
    );

    res.json({ message: 'Assessment deleted successfully' });
  } catch (error) {
    next(error);
  }
}
);

export default router;
