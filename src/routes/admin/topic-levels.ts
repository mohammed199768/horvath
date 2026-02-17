import { Router } from 'express';
import { z } from 'zod';
import { authenticateAdmin } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { csrfProtection } from '../../middleware/csrf';
import { validate } from '../../middleware/validation';
import { query } from '../../config/database';

const router = Router();

const topicParamsSchema = z.object({
  params: z.object({
    topicId: z.string().uuid(),
  }),
});

const updateTopicLevelsSchema = z.object({
  params: z.object({
    topicId: z.string().uuid(),
  }),
  body: z.object({
    level1Label: z.string().min(1).max(500),
    level2Label: z.string().min(1).max(500),
    level3Label: z.string().min(1).max(500),
    level4Label: z.string().min(1).max(500),
    level5Label: z.string().min(1).max(500),
  }),
});

router.get(
  '/:topicId/levels',
  authenticateAdmin,
  requireRole('admin'),
  validate(topicParamsSchema),
  async (req, res, next) => {
    try {
      const { topicId } = req.params;
      const result = await query(
        `SELECT
           id,
           level_1_label,
           level_2_label,
           level_3_label,
           level_4_label,
           level_5_label
         FROM topics
         WHERE id = $1`,
        [topicId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Topic not found' });
      }

      const row = result.rows[0];
      res.json({
        topicId: row.id,
        level1Label: row.level_1_label,
        level2Label: row.level_2_label,
        level3Label: row.level_3_label,
        level4Label: row.level_4_label,
        level5Label: row.level_5_label,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/:topicId/levels',
  authenticateAdmin,
  requireRole('admin'),
  csrfProtection,
  validate(updateTopicLevelsSchema),
  async (req, res, next) => {
    try {
      const { topicId } = req.params;
      const { level1Label, level2Label, level3Label, level4Label, level5Label } = req.body;

      const result = await query(
        `UPDATE topics
         SET
           level_1_label = $1,
           level_2_label = $2,
           level_3_label = $3,
           level_4_label = $4,
           level_5_label = $5,
           updated_at = NOW()
         WHERE id = $6
         RETURNING id, level_1_label, level_2_label, level_3_label, level_4_label, level_5_label`,
        [level1Label, level2Label, level3Label, level4Label, level5Label, topicId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Topic not found' });
      }

      const row = result.rows[0];
      res.json({
        topicId: row.id,
        level1Label: row.level_1_label,
        level2Label: row.level_2_label,
        level3Label: row.level_3_label,
        level4Label: row.level_4_label,
        level5Label: row.level_5_label,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
