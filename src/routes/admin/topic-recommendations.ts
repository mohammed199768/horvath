import { Router } from 'express';
import { z } from 'zod';
import { authenticateAdmin } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { csrfProtection } from '../../middleware/csrf';
import { validate } from '../../middleware/validation';
import { query } from '../../config/database';

const router = Router();

const scoreSchema = z.number().min(1).max(5).multipleOf(0.5).nullable().optional();
const gapSchema = z.number().min(0).max(4).multipleOf(0.5).nullable().optional();

const createTopicRecBodySchema = z.object({
  score_min: scoreSchema,
  score_max: scoreSchema,
  target_min: scoreSchema,
  target_max: scoreSchema,
  gap_min: gapSchema,
  gap_max: gapSchema,
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  why: z.string().optional().nullable(),
  what: z.string().optional().nullable(),
  how: z.string().optional().nullable(),
  action_items: z.array(z.string().min(1)).default([]),
  category: z.enum(['Quick Win', 'Project', 'Big Bet']).default('Project'),
  priority: z.number().int().min(0).max(100).default(50),
  tags: z.array(z.string()).default([]),
  is_active: z.boolean().default(true),
  order_index: z.number().int().default(0),
});

const topicParamsSchema = z.object({
  params: z.object({
    topicId: z.string().uuid(),
  }),
});

const recParamsSchema = z.object({
  params: z.object({
    topicId: z.string().uuid(),
    recId: z.string().uuid(),
  }),
});

const createTopicRecSchema = z.object({
  params: z.object({
    topicId: z.string().uuid(),
  }),
  body: createTopicRecBodySchema,
});

const updateTopicRecSchema = z.object({
  params: z.object({
    topicId: z.string().uuid(),
    recId: z.string().uuid(),
  }),
  body: createTopicRecBodySchema,
});

const deleteTopicRecSchema = z.object({
  params: z.object({
    topicId: z.string().uuid(),
    recId: z.string().uuid(),
  }),
  query: z.object({
    hard: z
      .union([z.literal('true'), z.literal('false')])
      .optional(),
  }),
});

const testTopicRecSchema = z.object({
  params: z.object({
    topicId: z.string().uuid(),
  }),
  body: z.object({
    score: z.number().min(1).max(5).multipleOf(0.5),
    target: z.number().min(1).max(5).multipleOf(0.5),
  }),
});

type TopicRecommendationRow = {
  id: string;
  topic_id: string;
  score_min: number | null;
  score_max: number | null;
  target_min: number | null;
  target_max: number | null;
  gap_min: number | null;
  gap_max: number | null;
  title: string;
  description: string | null;
  why: string | null;
  what: string | null;
  how: string | null;
  action_items: string[];
  category: 'Quick Win' | 'Project' | 'Big Bet';
  priority: number;
  tags: string[];
  is_active: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
};

const matchesConditions = (
  rec: TopicRecommendationRow,
  score: number,
  target: number,
  gap: number
): boolean =>
  (rec.score_min == null || score >= rec.score_min) &&
  (rec.score_max == null || score <= rec.score_max) &&
  (rec.target_min == null || target >= rec.target_min) &&
  (rec.target_max == null || target <= rec.target_max) &&
  (rec.gap_min == null || gap >= rec.gap_min) &&
  (rec.gap_max == null || gap <= rec.gap_max);

router.get(
  '/:topicId/recommendations',
  authenticateAdmin,
  requireRole('admin'),
  validate(topicParamsSchema),
  async (req, res, next) => {
    try {
      const { topicId } = req.params;
      const result = await query(
        `SELECT
           id, topic_id, score_min, score_max, target_min, target_max, gap_min, gap_max,
           title, description, why, what, how, action_items, category, priority, tags,
           is_active, order_index, created_at, updated_at
         FROM topic_recommendations
         WHERE topic_id = $1
         ORDER BY order_index ASC, created_at ASC`,
        [topicId]
      );

      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:topicId/recommendations',
  authenticateAdmin,
  requireRole('admin'),
  csrfProtection,
  validate(createTopicRecSchema),
  async (req, res, next) => {
    try {
      const { topicId } = req.params;
      const body = req.body;
      const result = await query(
        `INSERT INTO topic_recommendations (
           topic_id, score_min, score_max, target_min, target_max, gap_min, gap_max,
           title, description, why, what, how, action_items, category, priority, tags,
           is_active, order_index
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16,
           $17, $18
         )
         RETURNING *`,
        [
          topicId,
          body.score_min ?? null,
          body.score_max ?? null,
          body.target_min ?? null,
          body.target_max ?? null,
          body.gap_min ?? null,
          body.gap_max ?? null,
          body.title,
          body.description ?? null,
          body.why ?? null,
          body.what ?? null,
          body.how ?? null,
          JSON.stringify(body.action_items ?? []),
          body.category,
          body.priority,
          body.tags ?? [],
          body.is_active,
          body.order_index,
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/:topicId/recommendations/:recId',
  authenticateAdmin,
  requireRole('admin'),
  csrfProtection,
  validate(updateTopicRecSchema),
  async (req, res, next) => {
    try {
      const { topicId, recId } = req.params;
      const body = req.body;
      const result = await query(
        `UPDATE topic_recommendations
         SET
           score_min = $1,
           score_max = $2,
           target_min = $3,
           target_max = $4,
           gap_min = $5,
           gap_max = $6,
           title = $7,
           description = $8,
           why = $9,
           what = $10,
           how = $11,
           action_items = $12::jsonb,
           category = $13,
           priority = $14,
           tags = $15,
           is_active = $16,
           order_index = $17
         WHERE id = $18
           AND topic_id = $19
         RETURNING *`,
        [
          body.score_min ?? null,
          body.score_max ?? null,
          body.target_min ?? null,
          body.target_max ?? null,
          body.gap_min ?? null,
          body.gap_max ?? null,
          body.title,
          body.description ?? null,
          body.why ?? null,
          body.what ?? null,
          body.how ?? null,
          JSON.stringify(body.action_items ?? []),
          body.category,
          body.priority,
          body.tags ?? [],
          body.is_active,
          body.order_index,
          recId,
          topicId,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Recommendation not found' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/:topicId/recommendations/:recId',
  authenticateAdmin,
  requireRole('admin'),
  csrfProtection,
  validate(deleteTopicRecSchema),
  async (req, res, next) => {
    try {
      const { topicId, recId } = req.params;
      const hardDelete = req.query.hard === 'true';

      const result = hardDelete
        ? await query(
            `DELETE FROM topic_recommendations
             WHERE id = $1 AND topic_id = $2
             RETURNING id`,
            [recId, topicId]
          )
        : await query(
            `UPDATE topic_recommendations
             SET is_active = false, updated_at = NOW()
             WHERE id = $1 AND topic_id = $2
             RETURNING id`,
            [recId, topicId]
          );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Recommendation not found' });
      }

      res.json({ message: hardDelete ? 'Recommendation deleted' : 'Recommendation deactivated' });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:topicId/recommendations/test',
  authenticateAdmin,
  requireRole('admin'),
  csrfProtection,
  validate(testTopicRecSchema),
  async (req, res, next) => {
    try {
      const { topicId } = req.params;
      const { score, target } = req.body;
      const gap = Number(Math.max(0, target - score).toFixed(1));

      const result = await query(
        `SELECT
           id, topic_id, score_min, score_max, target_min, target_max, gap_min, gap_max,
           title, description, why, what, how, action_items, category, priority, tags,
           is_active, order_index, created_at, updated_at
         FROM topic_recommendations
         WHERE topic_id = $1
           AND is_active = true
         ORDER BY priority DESC, order_index ASC`,
        [topicId]
      );

      const matched = (result.rows as TopicRecommendationRow[]).filter((rec) =>
        matchesConditions(rec, score, target, gap)
      );

      res.json({
        score,
        target,
        gap,
        matchedRecommendations: matched,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
