/**
 * File: src/routes/admin/participants.ts
 * Purpose: Manage participants (list, delete)
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticateAdmin, AuthRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validation';
import { csrfProtection } from '../../middleware/csrf';
import { getClient, query } from '../../config/database';
import { logger } from '../../utils/logger';

const router = Router();

const listParticipantsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }),
});

const participantIdSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

router.get(
  '/',
  authenticateAdmin,
  requireRole('admin'),
  validate(listParticipantsSchema),
  async (req, res, next) => {
    try {
      const { page, limit } = req.query as unknown as z.infer<typeof listParticipantsSchema>['query'];
      const offset = (page - 1) * limit;

      const participantsResult = await query(
        `SELECT
           p.id,
           p.full_name,
           p.email,
           p.company_name,
           p.created_at,
           COUNT(ar.id)::int AS response_count,
           MAX(ar.last_updated_at) AS last_activity
         FROM participants p
         LEFT JOIN assessment_responses ar ON ar.participant_id = p.id
         GROUP BY p.id, p.full_name, p.email, p.company_name, p.created_at
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const countResult = await query('SELECT COUNT(*) FROM participants');
      const total = Number(countResult.rows[0].count);

      res.json({
        data: participantsResult.rows,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
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
  validate(participantIdSchema),
  async (req: AuthRequest, res, next) => {
    const { id } = req.params;
    const userId = req.user?.userId ?? null;
    const adminEmail = req.user?.email ?? 'unknown';
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const existsResult = await client.query('SELECT id FROM participants WHERE id = $1 FOR UPDATE', [id]);
      if (existsResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Participant not found' });
      }

      const responseCountResult = await client.query(
        'SELECT COUNT(*) FROM assessment_responses WHERE participant_id = $1',
        [id]
      );
      const deletedResponseCount = Number(responseCountResult.rows[0].count);

      await client.query(
        `DELETE FROM computed_priorities
         WHERE response_id IN (
           SELECT id FROM assessment_responses WHERE participant_id = $1
         )`,
        [id]
      );

      await client.query(
        `DELETE FROM topic_responses
         WHERE response_id IN (
           SELECT id FROM assessment_responses WHERE participant_id = $1
         )`,
        [id]
      );

      await client.query('DELETE FROM assessment_responses WHERE participant_id = $1', [id]);
      await client.query('DELETE FROM participants WHERE id = $1', [id]);

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
           VALUES ('participant', $1, 'deleted', $2, $3::jsonb, $4)`,
          [
            id,
            userId,
            JSON.stringify({
              deletedBy: adminEmail,
              deletedResponseCount,
            }),
            req.ip,
          ]
        );
      }

      await client.query('COMMIT');

      logger.info('Admin deleted participant', {
        adminEmail,
        participantId: id,
        deletedResponseCount,
      });

      res.json({
        success: true,
        message: 'Participant deleted',
        deletedResponseCount,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

export default router;
