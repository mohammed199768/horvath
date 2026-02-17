import { Router } from 'express';
import { z } from 'zod';
import { authenticateAdmin } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { csrfProtection } from '../../middleware/csrf';
import { getClient, query } from '../../config/database';

const router = Router();

const MAX_JSON_SIZE = 5 * 1024 * 1024;

const RecommendationImportSchema = z.object({
  score_min: z.number().min(1).max(5).multipleOf(0.5).nullable().optional(),
  score_max: z.number().min(1).max(5).multipleOf(0.5).nullable().optional(),
  target_min: z.number().min(1).max(5).multipleOf(0.5).nullable().optional(),
  target_max: z.number().min(1).max(5).multipleOf(0.5).nullable().optional(),
  gap_min: z.number().min(0).max(4).multipleOf(0.5).nullable().optional(),
  gap_max: z.number().min(0).max(4).multipleOf(0.5).nullable().optional(),
  title: z.string().min(1).max(255),
  description: z.string().optional().default(''),
  why: z.string().optional().default(''),
  what: z.string().optional().default(''),
  how: z.string().optional().default(''),
  action_items: z.array(z.string().min(1)).default([]),
  category: z.enum(['Quick Win', 'Project', 'Big Bet']).default('Project'),
  priority: z.number().int().min(0).max(100).default(50),
  tags: z.array(z.string()).default([]),
});

const TopicImportSchema = z.object({
  topic_key: z.string().min(1).max(100),
  label: z.string().min(1).max(255),
  prompt: z.string().min(1),
  order_index: z.number().int().min(0).default(0),
  help_text: z.string().nullable().optional(),
  level_labels: z.tuple([
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
    z.string().min(1),
  ]),
  recommendations: z.array(RecommendationImportSchema).default([]),
});

const DimensionImportSchema = z.object({
  dimension_key: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  description: z.string().optional().default(''),
  category: z.string().optional().default(''),
  order_index: z.number().int().min(0).default(0),
  topics: z.array(TopicImportSchema).min(1),
});

const AssessmentImportSchema = z.object({
  assessment: z.object({
    title: z.string().min(1).max(255),
    description: z.string().optional().default(''),
    version: z.number().int().min(1).default(1),
    estimated_duration_minutes: z.number().int().nullable().optional(),
    instructions: z.string().nullable().optional(),
  }),
  dimensions: z.array(DimensionImportSchema).min(1),
});

const validateBodySchema = z.object({
  json: z.string().min(1),
});

const executeBodySchema = z.object({
  json: z.string().min(1),
  mode: z.enum(['create', 'update']),
});

type ImportSummary = {
  assessmentTitle: string;
  dimensionCount: number;
  topicCount: number;
  recommendationCount: number;
  topicsWithAllLevels: number;
  topicsWithRecommendations: number;
  duplicateExists: boolean;
  existingAssessmentId: string | null;
};

const emptySummary = (): ImportSummary => ({
  assessmentTitle: '',
  dimensionCount: 0,
  topicCount: 0,
  recommendationCount: 0,
  topicsWithAllLevels: 0,
  topicsWithRecommendations: 0,
  duplicateExists: false,
  existingAssessmentId: null,
});

const formatZodIssues = (issues: z.ZodIssue[]): string[] =>
  issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });

const findDuplicates = (keys: string[]): string[] => {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
};

const buildSummary = (
  data: z.infer<typeof AssessmentImportSchema>,
  duplicateExists: boolean,
  existingAssessmentId: string | null
): ImportSummary => {
  const topicCount = data.dimensions.reduce((sum, dimension) => sum + dimension.topics.length, 0);
  const recommendationCount = data.dimensions.reduce(
    (sum, dimension) =>
      sum + dimension.topics.reduce((topicSum, topic) => topicSum + topic.recommendations.length, 0),
    0
  );
  const topicsWithAllLevels = data.dimensions.reduce(
    (sum, dimension) =>
      sum +
      dimension.topics.filter((topic) => topic.level_labels.every((label) => label.trim().length > 0)).length,
    0
  );
  const topicsWithRecommendations = data.dimensions.reduce(
    (sum, dimension) => sum + dimension.topics.filter((topic) => topic.recommendations.length > 0).length,
    0
  );

  return {
    assessmentTitle: data.assessment.title,
    dimensionCount: data.dimensions.length,
    topicCount,
    recommendationCount,
    topicsWithAllLevels,
    topicsWithRecommendations,
    duplicateExists,
    existingAssessmentId,
  };
};

router.post('/validate', authenticateAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const parsedBody = validateBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        valid: false,
        errors: formatZodIssues(parsedBody.error.issues),
        warnings: [],
        summary: emptySummary(),
      });
    }

    const { json } = parsedBody.data;
    if (json.length > MAX_JSON_SIZE) {
      return res.status(400).json({
        valid: false,
        errors: ['JSON payload too large (max 5MB)'],
        warnings: [],
        summary: emptySummary(),
      });
    }

    let rawData: unknown;
    try {
      rawData = JSON.parse(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON syntax';
      return res.status(400).json({
        valid: false,
        errors: [message],
        warnings: [],
        summary: emptySummary(),
      });
    }

    const schemaResult = AssessmentImportSchema.safeParse(rawData);
    if (!schemaResult.success) {
      return res.status(400).json({
        valid: false,
        errors: formatZodIssues(schemaResult.error.issues),
        warnings: [],
        summary: emptySummary(),
      });
    }

    const data = schemaResult.data;
    const errors: string[] = [];
    const warnings: string[] = [];

    const duplicateDimensionKeys = findDuplicates(data.dimensions.map((dimension) => dimension.dimension_key));
    if (duplicateDimensionKeys.length > 0) {
      errors.push(`Duplicate dimension_key values: ${duplicateDimensionKeys.join(', ')}`);
    }

    const topicKeys = data.dimensions.flatMap((dimension) =>
      dimension.topics.map((topic) => topic.topic_key)
    );
    const duplicateTopicKeys = findDuplicates(topicKeys);
    if (duplicateTopicKeys.length > 0) {
      errors.push(`Duplicate topic_key values: ${duplicateTopicKeys.join(', ')}`);
    }

    const existingAssessmentResult = await query(
      `SELECT id FROM assessments WHERE title = $1 ORDER BY created_at DESC LIMIT 1`,
      [data.assessment.title]
    );
    const existingAssessmentId =
      existingAssessmentResult.rows.length > 0 ? (existingAssessmentResult.rows[0].id as string) : null;
    const duplicateExists = Boolean(existingAssessmentId);

    if (duplicateExists) {
      warnings.push(`Assessment with title "${data.assessment.title}" already exists`);
    }

    return res.json({
      valid: errors.length === 0,
      errors,
      warnings,
      summary: buildSummary(data, duplicateExists, existingAssessmentId),
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/execute',
  authenticateAdmin,
  requireRole('admin'),
  csrfProtection,
  async (req, res, next) => {
    const client = await getClient();
    let inTransaction = false;

    try {
      const parsedBody = executeBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({ error: formatZodIssues(parsedBody.error.issues).join('; ') });
      }

      const { json, mode } = parsedBody.data;
      if (json.length > MAX_JSON_SIZE) {
        return res.status(400).json({ error: 'JSON payload too large (max 5MB)' });
      }

      const data = AssessmentImportSchema.parse(JSON.parse(json));

      const duplicateDimensionKeys = findDuplicates(data.dimensions.map((dimension) => dimension.dimension_key));
      if (duplicateDimensionKeys.length > 0) {
        return res.status(400).json({
          error: `Duplicate dimension_key values: ${duplicateDimensionKeys.join(', ')}`,
        });
      }

      const duplicateTopicKeys = findDuplicates(
        data.dimensions.flatMap((dimension) => dimension.topics.map((topic) => topic.topic_key))
      );
      if (duplicateTopicKeys.length > 0) {
        return res.status(400).json({
          error: `Duplicate topic_key values: ${duplicateTopicKeys.join(', ')}`,
        });
      }

      const existingAssessmentResult = await client.query(
        `SELECT id FROM assessments WHERE title = $1 ORDER BY created_at DESC LIMIT 1`,
        [data.assessment.title]
      );
      const existingId =
        existingAssessmentResult.rows.length > 0 ? (existingAssessmentResult.rows[0].id as string) : null;

      await client.query('BEGIN');
      inTransaction = true;

      let assessmentId: string;
      if (mode === 'update' && existingId) {
        await client.query(
          `UPDATE assessments
           SET title = $1,
               description = $2,
               version = $3,
               estimated_duration_minutes = $4,
               instructions = $5,
               updated_at = NOW()
           WHERE id = $6`,
          [
            data.assessment.title,
            data.assessment.description || null,
            data.assessment.version,
            data.assessment.estimated_duration_minutes ?? null,
            data.assessment.instructions ?? null,
            existingId,
          ]
        );
        assessmentId = existingId;
      } else {
        const assessmentInsertResult = await client.query(
          `INSERT INTO assessments
           (title, description, version, estimated_duration_minutes, instructions, is_active, is_published)
           VALUES ($1, $2, $3, $4, $5, true, false)
           RETURNING id`,
          [
            data.assessment.title,
            data.assessment.description || null,
            data.assessment.version,
            data.assessment.estimated_duration_minutes ?? null,
            data.assessment.instructions ?? null,
          ]
        );
        assessmentId = assessmentInsertResult.rows[0].id as string;
      }

      const dimensionValues: string[] = [];
      const dimensionParams: unknown[] = [];
      let paramIndex = 1;
      for (const dimension of data.dimensions) {
        dimensionValues.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        dimensionParams.push(
          assessmentId,
          dimension.dimension_key,
          dimension.title,
          dimension.description || null,
          dimension.category || null,
          dimension.order_index
        );
      }

      const dimensionUpsertResult = await client.query(
        `INSERT INTO dimensions (assessment_id, dimension_key, title, description, category, order_index)
         VALUES ${dimensionValues.join(', ')}
         ON CONFLICT (assessment_id, dimension_key)
         DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           order_index = EXCLUDED.order_index,
           updated_at = NOW()
         RETURNING id, dimension_key`,
        dimensionParams
      );

      const dimensionIdByKey = new Map<string, string>();
      for (const row of dimensionUpsertResult.rows as Array<{ id: string; dimension_key: string }>) {
        dimensionIdByKey.set(row.dimension_key, row.id);
      }

      const topicIdByCompositeKey = new Map<string, string>();
      let totalTopics = 0;
      let totalRecs = 0;

      for (const dimension of data.dimensions) {
        const dimensionId = dimensionIdByKey.get(dimension.dimension_key);
        if (!dimensionId) {
          throw new Error(`Failed to resolve dimension id for key: ${dimension.dimension_key}`);
        }

        const topicValues: string[] = [];
        const topicParams: unknown[] = [];
        paramIndex = 1;

        for (const topic of dimension.topics) {
          topicValues.push(
            `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
          );
          topicParams.push(
            dimensionId,
            topic.topic_key,
            topic.label,
            topic.prompt,
            topic.order_index,
            topic.help_text ?? null,
            topic.level_labels[0],
            topic.level_labels[1],
            topic.level_labels[2],
            topic.level_labels[3],
            topic.level_labels[4]
          );
          totalTopics += 1;
          totalRecs += topic.recommendations.length;
        }

        const topicUpsertResult = await client.query(
          `INSERT INTO topics (
             dimension_id,
             topic_key,
             label,
             prompt,
             order_index,
             help_text,
             level_1_label,
             level_2_label,
             level_3_label,
             level_4_label,
             level_5_label
           )
           VALUES ${topicValues.join(', ')}
           ON CONFLICT (dimension_id, topic_key)
           DO UPDATE SET
             label = EXCLUDED.label,
             prompt = EXCLUDED.prompt,
             order_index = EXCLUDED.order_index,
             help_text = EXCLUDED.help_text,
             level_1_label = EXCLUDED.level_1_label,
             level_2_label = EXCLUDED.level_2_label,
             level_3_label = EXCLUDED.level_3_label,
             level_4_label = EXCLUDED.level_4_label,
             level_5_label = EXCLUDED.level_5_label,
             updated_at = NOW()
           RETURNING id, topic_key`,
          topicParams
        );

        for (const row of topicUpsertResult.rows as Array<{ id: string; topic_key: string }>) {
          topicIdByCompositeKey.set(`${dimension.dimension_key}:${row.topic_key}`, row.id);
        }
      }

      const importedTopicIds = Array.from(topicIdByCompositeKey.values());
      if (mode === 'update' && importedTopicIds.length > 0) {
        await client.query(
          `DELETE FROM topic_recommendations
           WHERE topic_id = ANY($1::uuid[])`,
          [importedTopicIds]
        );
      }

      const recValues: string[] = [];
      const recParams: unknown[] = [];
      paramIndex = 1;

      for (const dimension of data.dimensions) {
        for (const topic of dimension.topics) {
          const topicId = topicIdByCompositeKey.get(`${dimension.dimension_key}:${topic.topic_key}`);
          if (!topicId) {
            throw new Error(
              `Failed to resolve topic id for key: ${dimension.dimension_key}/${topic.topic_key}`
            );
          }

          topic.recommendations.forEach((rec, recIndex) => {
            recValues.push(
              `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}::jsonb, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, true, $${paramIndex++})`
            );
            recParams.push(
              topicId,
              rec.score_min ?? null,
              rec.score_max ?? null,
              rec.target_min ?? null,
              rec.target_max ?? null,
              rec.gap_min ?? null,
              rec.gap_max ?? null,
              rec.title,
              rec.description || null,
              rec.why || null,
              rec.what || null,
              rec.how || null,
              JSON.stringify(rec.action_items ?? []),
              rec.category,
              rec.priority,
              rec.tags ?? [],
              recIndex
            );
          });
        }
      }

      if (recValues.length > 0) {
        await client.query(
          `INSERT INTO topic_recommendations (
             topic_id,
             score_min,
             score_max,
             target_min,
             target_max,
             gap_min,
             gap_max,
             title,
             description,
             why,
             what,
             how,
             action_items,
             category,
             priority,
             tags,
             is_active,
             order_index
           )
           VALUES ${recValues.join(', ')}`,
          recParams
        );
      }

      await client.query('COMMIT');
      inTransaction = false;

      return res.json({
        success: true,
        assessmentId,
        imported: {
          dimensions: data.dimensions.length,
          topics: totalTopics,
          recommendations: totalRecs,
        },
      });
    } catch (error) {
      if (inTransaction) {
        await client.query('ROLLBACK');
      }
      next(error);
    } finally {
      client.release();
    }
  }
);

export default router;
