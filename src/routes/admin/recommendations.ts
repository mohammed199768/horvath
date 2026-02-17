/**
 * File: src/routes/admin/recommendations.ts
 * Purpose: Manage recommendations for scoring logic
 */

import { Router } from 'express';
import { authenticateAdmin } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { query } from '../../config/database';
import { z } from 'zod';
import { validate } from '../../middleware/validation';
import { csrfProtection } from '../../middleware/csrf';

const router = Router();

// Validation schema for recommendations
const recommendationSchema = z.object({
  dimension_id: z.string().uuid(),
  title: z.string().min(3),
  description: z.string().min(10),
  action_items: z.array(z.string()).min(1),
  resources: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    type: z.string().optional()
  })).optional(),
  min_gap: z.number().min(0).max(5),
  max_gap: z.number().min(0).max(5),
  priority_level: z.enum(['low', 'medium', 'high', 'critical']),
});

router.get('/', authenticateAdmin, requireRole('admin'), async (req, res, next) => {
  try {
    const { dimension_id } = req.query;
    
    let queryStr = `
      SELECT r.*, d.title as dimension_title
      FROM recommendations r
      JOIN dimensions d ON r.dimension_id = d.id
    `;
    
    const params: any[] = [];
    if (dimension_id) {
      queryStr += ` WHERE r.dimension_id = $1`;
      params.push(dimension_id);
    }
    
    queryStr += ` ORDER BY d.title, r.priority_level DESC`;
    
    const result = await query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/',
  authenticateAdmin,
  requireRole('admin'),
  csrfProtection,
  validate(recommendationSchema),
  async (req, res, next) => {
  try {
    const { 
      dimension_id, title, description, action_items, 
      resources, min_gap, max_gap, priority_level 
    } = req.body;

    const result = await query(
      `INSERT INTO recommendations 
        (dimension_id, title, description, action_items, resources, min_gap, max_gap, priority_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        dimension_id, title, description, JSON.stringify(action_items), 
        JSON.stringify(resources || []), min_gap, max_gap, priority_level
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
}
);

router.put(
  '/:id',
  authenticateAdmin,
  requireRole('admin'),
  csrfProtection,
  validate(recommendationSchema),
  async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      dimension_id, title, description, action_items, 
      resources, min_gap, max_gap, priority_level 
    } = req.body;

    const result = await query(
      `UPDATE recommendations 
       SET dimension_id = $1, title = $2, description = $3, 
           action_items = $4, resources = $5, min_gap = $6, 
           max_gap = $7, priority_level = $8, updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        dimension_id, title, description, JSON.stringify(action_items), 
        JSON.stringify(resources || []), min_gap, max_gap, priority_level, id
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

router.delete('/:id', authenticateAdmin, requireRole('admin'), csrfProtection, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM recommendations WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }
    
    res.json({ message: 'Recommendation deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
