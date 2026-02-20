/**
 * File: src/routes/admin/responses.ts
 * Purpose: Manage assessment responses (view, filter, export)
 */

import { Router } from 'express';
import { authenticateAdmin, AuthRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { getClient, query } from '../../config/database';
import { z } from 'zod';
import { validate } from '../../middleware/validation';
import { csrfProtection } from '../../middleware/csrf';
import { logger } from '../../utils/logger';

const router = Router();

const listResponsesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    status: z.string().optional(),
    assessment_id: z.string().uuid().optional(),
    participant_id: z.string().uuid().optional(),
    search: z.string().max(200).optional(),
  }),
});

const responseIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

router.get('/', authenticateAdmin, requireRole('admin'), validate(listResponsesSchema), async (req, res, next) => {
  try {
    const { page, limit, status, assessment_id, participant_id, search } = req.query as unknown as z.infer<
      typeof listResponsesSchema
    >['query'];
    const offset = (page - 1) * limit;

    let queryStr = `
      SELECT 
        ar.*,
        p.full_name,
        p.email,
        p.company_name,
        a.title as assessment_title
      FROM assessment_responses ar
      JOIN participants p ON ar.participant_id = p.id
      JOIN assessments a ON ar.assessment_id = a.id
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      queryStr += ` AND ar.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (assessment_id) {
      queryStr += ` AND ar.assessment_id = $${paramIndex}`;
      params.push(assessment_id);
      paramIndex++;
    }

    if (participant_id) {
      queryStr += ` AND ar.participant_id = $${paramIndex}`;
      params.push(participant_id);
      paramIndex++;
    }

    if (search) {
      queryStr += ` AND (p.email ILIKE $${paramIndex} OR p.company_name ILIKE $${paramIndex + 1})`;
      params.push(`%${search}%`, `%${search}%`);
      paramIndex += 2;
    }

    queryStr += ` ORDER BY ar.last_updated_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await query(queryStr, params);

    // Keep count query parameterized to prevent SQL injection.
    let countQuery = `
      SELECT COUNT(*) 
      FROM assessment_responses ar
      JOIN participants p ON ar.participant_id = p.id
      WHERE 1=1
    `;
    const countParams: unknown[] = [];
    let countParamIndex = 1;

    if (status) {
      countQuery += ` AND ar.status = $${countParamIndex++}`;
      countParams.push(status);
    }

    if (assessment_id) {
      countQuery += ` AND ar.assessment_id = $${countParamIndex++}`;
      countParams.push(assessment_id);
    }

    if (participant_id) {
      countQuery += ` AND ar.participant_id = $${countParamIndex++}`;
      countParams.push(participant_id);
    }

    if (search) {
      countQuery += ` AND (p.email ILIKE $${countParamIndex} OR p.company_name ILIKE $${countParamIndex + 1})`;
      countParams.push(`%${search}%`, `%${search}%`);
    }

    const countResult = await query(countQuery, countParams);

    res.json({
      data: result.rows,
      pagination: {
        total: Number(countResult.rows[0].count),
        page,
        limit,
        pages: Math.ceil(Number(countResult.rows[0].count) / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/:id',
  authenticateAdmin,
  requireRole('admin'),
  validate(responseIdSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const response = await query(
        `SELECT 
          ar.*,
          p.full_name,
          p.email,
          p.company_name,
          p.job_title,
          p.industry,
          a.title as assessment_title
         FROM assessment_responses ar
         JOIN participants p ON ar.participant_id = p.id
         JOIN assessments a ON ar.assessment_id = a.id
         WHERE ar.id = $1`,
        [id]
      );

      if (response.rows.length === 0) {
        return res.status(404).json({ error: 'Response not found' });
      }

      // Fetch topics responses
      const topicResponses = await query(
        `SELECT 
          tr.*,
          t.label,
          d.title as dimension_title
         FROM topic_responses tr
         JOIN topics t ON tr.topic_id = t.id
         JOIN dimensions d ON t.dimension_id = d.id
         WHERE tr.response_id = $1
         ORDER BY d.order_index, t.order_index`,
        [id]
      );

      // Fetch computed priorities
      const priorities = await query(
        `SELECT 
          cp.*,
          d.title as dimension_title
         FROM computed_priorities cp
         JOIN dimensions d ON cp.dimension_id = d.id
         WHERE cp.response_id = $1
         ORDER BY cp.rank_order`,
        [id]
      );

      res.json({
        response: response.rows[0],
        answers: topicResponses.rows,
        priorities: priorities.rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/:id',
  authenticateAdmin,
  requireRole('admin'),
  csrfProtection,
  validate(responseIdSchema),
  async (req: AuthRequest, res, next) => {
    const { id } = req.params;
    const userId = req.user?.userId ?? null;
    const adminEmail = req.user?.email ?? 'unknown';
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const responseExists = await client.query(
        'SELECT id FROM assessment_responses WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (responseExists.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Response not found' });
      }

      await client.query('DELETE FROM computed_priorities WHERE response_id = $1', [id]);
      await client.query('DELETE FROM topic_responses WHERE response_id = $1', [id]);
      await client.query('DELETE FROM assessment_responses WHERE id = $1', [id]);

      const auditColumnsResult = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'audit_logs'
           AND column_name IN ('entity_type', 'entity_id', 'action', 'user_id', 'changes', 'ip_address')`
      );

      const availableAuditColumns = new Set(
        auditColumnsResult.rows.map((row: { column_name: string }) => row.column_name)
      );
      const requiredAuditColumns = ['entity_type', 'entity_id', 'action', 'user_id', 'changes', 'ip_address'];
      const canAudit = requiredAuditColumns.every((column) => availableAuditColumns.has(column));

      if (canAudit) {
        await client.query(
          `INSERT INTO audit_logs (entity_type, entity_id, action, user_id, changes, ip_address)
           VALUES ('response', $1, 'deleted', $2, $3::jsonb, $4)`,
          [id, userId, JSON.stringify({ deletedBy: adminEmail }), req.ip]
        );
      }

      await client.query('COMMIT');

      logger.info('Admin deleted response', {
        adminEmail,
        responseId: id,
      });

      res.json({ success: true, message: 'Response deleted' });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

export default router;
