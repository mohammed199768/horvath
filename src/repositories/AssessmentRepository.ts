import { query } from '../config/database';

export interface AssessmentFilters {
  isPublished?: boolean;
  isActive?: boolean;
}

export interface GuardedTopicResponseInput {
  responseId: string;
  topicId: string;
  currentRating: number;
  targetRating: number;
  gap: number;
  normalizedGap: number;
  timeSpentSeconds: number;
  notes: string | null;
}

export class AssessmentRepository {
  async findAll(filters?: AssessmentFilters) {
    let sql = `
      SELECT
        a.*,
        u.full_name AS created_by_name,
        (SELECT COUNT(*) FROM dimensions WHERE assessment_id = a.id) AS dimension_count,
        (SELECT COUNT(t.*) FROM topics t JOIN dimensions d ON t.dimension_id = d.id WHERE d.assessment_id = a.id) AS topic_count,
        (SELECT COUNT(*) FROM assessment_responses WHERE assessment_id = a.id) AS response_count
      FROM assessments a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE 1=1
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (typeof filters?.isPublished === 'boolean') {
      sql += ` AND a.is_published = $${paramIndex++}`;
      params.push(filters.isPublished);
    }

    if (typeof filters?.isActive === 'boolean') {
      sql += ` AND a.is_active = $${paramIndex++}`;
      params.push(filters.isActive);
    }

    sql += ' ORDER BY a.created_at DESC';
    const result = await query(sql, params);
    return result.rows;
  }

  async findById(id: string) {
    const result = await query(
      `SELECT 
        a.*,
        json_agg(
          json_build_object(
            'id', d.id,
            'key', d.dimension_key,
            'title', d.title,
            'description', d.description,
            'category', d.category,
            'order', d.order_index,
            'topics', (
              SELECT json_agg(
                json_build_object(
                  'id', t.id,
                  'key', t.topic_key,
                  'label', t.label,
                  'prompt', t.prompt,
                  'help_text', t.help_text,
                  'order', t.order_index,
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
        ) FILTER (WHERE d.id IS NOT NULL) AS dimensions
      FROM assessments a
      LEFT JOIN dimensions d ON a.id = d.assessment_id
      WHERE a.id = $1
      GROUP BY a.id`,
      [id]
    );

    return result.rows[0] || null;
  }

  async delete(id: string) {
    const result = await query('DELETE FROM assessments WHERE id = $1', [id]);
    return (result.rowCount || 0) > 0;
  }

  async upsertTopicResponseForAssessment(input: GuardedTopicResponseInput): Promise<number> {
    const result = await query(
      `INSERT INTO topic_responses (
         response_id, topic_id, current_rating, target_rating,
         gap, normalized_gap, time_spent_seconds, notes, answered_at
       )
       SELECT
         $1, t.id, $3, $4, $5, $6, $7, $8, NOW()
       FROM assessment_responses ar
       JOIN topics t ON t.id = $2
       JOIN dimensions d ON d.id = t.dimension_id
       WHERE ar.id = $1
         AND d.assessment_id = ar.assessment_id
       ON CONFLICT (response_id, topic_id) DO UPDATE
         SET current_rating = EXCLUDED.current_rating,
             target_rating = EXCLUDED.target_rating,
             gap = EXCLUDED.gap,
             normalized_gap = EXCLUDED.normalized_gap,
             time_spent_seconds = EXCLUDED.time_spent_seconds,
             notes = EXCLUDED.notes,
             answered_at = EXCLUDED.answered_at`,
      [
        input.responseId,
        input.topicId,
        input.currentRating,
        input.targetRating,
        input.gap,
        input.normalizedGap,
        input.timeSpentSeconds,
        input.notes,
      ]
    );

    return result.rowCount || 0;
  }
}
