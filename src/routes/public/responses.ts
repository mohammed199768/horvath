/**
 * File: src/routes/public/responses.ts
 * Purpose: Handle assessment responses, topic answers, and submission
 */

import { Router } from 'express';
import { query, getClient } from '../../config/database';
import { logger } from '../../utils/logger';
import { z } from 'zod';
import { ScoringService } from '../../services/scoringService';
import crypto from 'crypto';
import { requireResponseSession } from '../../middleware/responseSession';
import { AssessmentRepository } from '../../repositories/AssessmentRepository';

const router = Router();
const assessmentRepository = new AssessmentRepository();

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTopicRecommendation = (rec: any) => ({
  id: rec.id,
  topicId: rec.topicId ?? rec.topic_id ?? '',
  scoreMin: toNullableNumber(rec.scoreMin ?? rec.score_min),
  scoreMax: toNullableNumber(rec.scoreMax ?? rec.score_max),
  targetMin: toNullableNumber(rec.targetMin ?? rec.target_min),
  targetMax: toNullableNumber(rec.targetMax ?? rec.target_max),
  gapMin: toNullableNumber(rec.gapMin ?? rec.gap_min),
  gapMax: toNullableNumber(rec.gapMax ?? rec.gap_max),
  title: rec.title,
  description: rec.description ?? null,
  why: rec.why ?? null,
  what: rec.what ?? null,
  how: rec.how ?? null,
  actionItems: Array.isArray(rec.actionItems) ? rec.actionItems : Array.isArray(rec.action_items) ? rec.action_items : [],
  category: rec.category,
  priority: Number(rec.priority ?? 0),
  tags: Array.isArray(rec.tags) ? rec.tags : [],
  isActive: typeof rec.isActive === 'boolean' ? rec.isActive : rec.is_active ?? true,
  orderIndex: Number(rec.orderIndex ?? rec.order_index ?? 0),
});

// Validation Schemas
const startResponseSchema = z.object({
  assessmentId: z.string().uuid(),
  participantId: z.string().uuid()
});

const answerTopicSchema = z.object({
  topicId: z.string().uuid(),
  currentRating: z.number().min(1).max(5),
  targetRating: z.number().min(1).max(5),
  timeSpentSeconds: z.number().optional(),
  notes: z.string().optional()
});

// POST /start
router.post('/start', async (req, res, next) => {
  try {
    const validated = startResponseSchema.parse(req.body);

    const topicCountResult = await query(
      `SELECT COUNT(*) as total FROM topics t 
       JOIN dimensions d ON t.dimension_id = d.id 
       WHERE d.assessment_id = $1`,
      [validated.assessmentId]
    );

    const totalQuestions = parseInt(topicCountResult.rows[0].total);
    const sessionToken = crypto.randomBytes(32).toString('hex');

    const result = await query(
      `INSERT INTO assessment_responses 
        (assessment_id, participant_id, total_questions, session_token, ip_address, user_agent, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'in_progress')
       RETURNING id, session_token, status`,
      [
        validated.assessmentId, 
        validated.participantId, 
        totalQuestions, 
        sessionToken, 
        req.ip, 
        req.get('User-Agent')
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        responseId: result.rows[0].id,
        sessionToken: result.rows[0].session_token
      }
    });
  } catch (error) {
    logger.error('Error starting assessment:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Validation Error', details: error.errors });
    }
    next(error);
  }
});

// PUT /:responseId/answer
router.put('/:responseId/answer', requireResponseSession, async (req, res, next) => {
  try {
    const { responseId } = req.params;
    const validated = answerTopicSchema.parse(req.body);

    // Calculate gap using ScoringService
    const { gap, normalizedGap } = ScoringService.calculateTopicGap(
      validated.currentRating, 
      validated.targetRating
    );

    const upsertedRowCount = await assessmentRepository.upsertTopicResponseForAssessment({
      responseId,
      topicId: validated.topicId,
      currentRating: validated.currentRating,
      targetRating: validated.targetRating,
      gap,
      normalizedGap,
      timeSpentSeconds: validated.timeSpentSeconds || 0,
      notes: validated.notes || null,
    });

    if (upsertedRowCount === 0) {
      return res.status(422).json({
        success: false,
        error: 'Topic does not belong to this assessment',
      });
    }

    // Update progress
    const progressResult = await query(
      `UPDATE assessment_responses
       SET 
         answered_questions = (SELECT COUNT(*) FROM topic_responses WHERE response_id = $1),
         progress_percentage = (
           SELECT (COUNT(*)::DECIMAL / NULLIF(total_questions, 0) * 100)
           FROM assessment_responses ar
           JOIN topic_responses tr ON ar.id = tr.response_id
           WHERE ar.id = $1
           GROUP BY ar.total_questions
         ),
         last_updated_at = NOW()
       WHERE id = $1
       RETURNING answered_questions, progress_percentage`,
      [responseId]
    );

    res.json({
      success: true,
      data: {
        topicResponseId: validated.topicId, // We don't have the ID, returning topicId reference
        gap,
        normalizedGap,
        progress: progressResult.rows[0]?.progress_percentage || 0
      }
    });

  } catch (error) {
    logger.error('Error submitting answer:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Validation Error', details: error.errors });
    }
    next(error);
  }
});

// GET /session/:sessionToken
router.get('/session/:sessionToken', async (req, res, next) => {
  try {
    const { sessionToken } = req.params;

    const sessionResult = await query(
      `SELECT id, status, progress_percentage, answered_questions, total_questions
       FROM assessment_responses 
       WHERE session_token = $1`,
      [sessionToken]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const responseId = sessionResult.rows[0].id;
    
    const answeredTopicsResult = await query(
      `SELECT topic_id, current_rating, target_rating, gap 
       FROM topic_responses 
       WHERE response_id = $1`,
      [responseId]
    );

    res.json({
      success: true,
      data: {
        responseId,
        status: sessionResult.rows[0].status,
        progress: parseFloat(sessionResult.rows[0].progress_percentage || 0),
        answeredTopics: answeredTopicsResult.rows.map(row => ({
          topicId: row.topic_id,
          currentRating: row.current_rating,
          targetRating: row.target_rating,
          gap: parseFloat(row.gap)
        }))
      }
    });

  } catch (error) {
    logger.error('Error fetching session:', error);
    next(error);
  }
});

// POST /:responseId/complete
router.post('/:responseId/complete', requireResponseSession, async (req, res, next) => {
  try {
    const { responseId } = req.params;

    // Verify completion
    const checkResult = await query(
      `SELECT total_questions, 
        (SELECT COUNT(*) FROM topic_responses WHERE response_id = $1) as answered_count
       FROM assessment_responses 
       WHERE id = $1`,
      [responseId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Response not found' });
    }

    const { total_questions, answered_count } = checkResult.rows[0];
    if (parseInt(answered_count) < parseInt(total_questions)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Assessment is incomplete',
        details: { answered: answered_count, total: total_questions }
      });
    }

    // Compute results
    const results = await ScoringService.computeResults(responseId);

    res.json({
      success: true,
      data: {
        responseId,
        completedAt: new Date().toISOString(),
        overallScore: results.overallScore,
        overallGap: results.overallGap
      }
    });

  } catch (error) {
    logger.error('Error completing assessment:', error);
    next(error);
  }
});

// GET /:responseId/results
router.get('/:responseId/results', requireResponseSession, async (req, res, next) => {
  try {
    const { responseId } = req.params;

    const resultsQuery = await query(
      `WITH
         response_check AS (
           SELECT
             ar.*,
             a.title AS assessment_title
           FROM assessment_responses ar
           JOIN assessments a ON a.id = ar.assessment_id
           WHERE ar.id = $1
         ),
         priorities AS (
           SELECT
             cp.priority_score,
             cp.rank_order,
             cp.recommendations,
             cp.dimension_score,
             cp.dimension_gap,
             d.dimension_key,
             d.title,
             d.category,
             d.order_index
           FROM computed_priorities cp
           JOIN dimensions d ON d.id = cp.dimension_id
           WHERE cp.response_id = $1
           ORDER BY cp.rank_order ASC
         ),
         top_gaps AS (
           SELECT
             t.id AS topic_id,
             t.label,
             tr.gap,
             d.title AS dimension_title,
             tr.target_rating
           FROM topic_responses tr
           JOIN topics t ON tr.topic_id = t.id
           JOIN dimensions d ON t.dimension_id = d.id
           WHERE tr.response_id = $1
             AND tr.gap > 0
           ORDER BY tr.gap DESC, tr.target_rating DESC
           LIMIT 5
         )
       SELECT
         (SELECT row_to_json(r) FROM response_check r) AS response,
         (SELECT COALESCE(json_agg(p ORDER BY p.order_index), '[]'::json) FROM priorities p) AS priorities,
         (SELECT COALESCE(json_agg(g ORDER BY g.gap DESC, g.target_rating DESC), '[]'::json) FROM top_gaps g) AS top_gaps`,
      [responseId]
    );

    const resultRow = resultsQuery.rows[0] as {
      response: {
        status: string;
        overall_score: string | number | null;
        overall_gap: string | number | null;
      } | null;
      priorities: Array<{
        priority_score: string | number;
        rank_order: number;
        recommendations: unknown[] | null;
        dimension_score: string | number;
        dimension_gap: string | number;
        dimension_key: string;
        title: string;
      }> | null;
      top_gaps: Array<{
        topic_id: string;
        label: string;
        gap: string | number;
        dimension_title: string;
      }> | null;
    };

    if (!resultRow?.response) {
      return res.status(404).json({ success: false, error: 'Response not found' });
    }

    if (resultRow.response.status !== 'completed') {
       return res.status(400).json({ success: false, error: 'Assessment not completed' });
    }

    const priorities = Array.isArray(resultRow.priorities) ? resultRow.priorities : [];
    const topGaps = Array.isArray(resultRow.top_gaps) ? resultRow.top_gaps : [];

    const allRecommendations = priorities
      .flatMap((row) => (Array.isArray(row.recommendations) ? row.recommendations.map(normalizeTopicRecommendation) : []))
      .sort((a, b) => Number(b?.priority ?? 0) - Number(a?.priority ?? 0))
      .slice(0, 5);

    res.json({
      success: true,
      data: {
        overallScore: parseFloat(String(resultRow.response.overall_score ?? 0)),
        overallGap: parseFloat(String(resultRow.response.overall_gap ?? 0)),
        dimensions: priorities.map(row => ({
          dimensionKey: row.dimension_key,
          title: row.title,
          score: parseFloat(String(row.dimension_score)),
          gap: parseFloat(String(row.dimension_gap)),
          priorityScore: parseFloat(String(row.priority_score)),
          recommendations: Array.isArray(row.recommendations) ? row.recommendations.map(normalizeTopicRecommendation) : [],
          topics: [] // We could populate this if needed, but not strictly required by prompt example
        })),
        topGaps: topGaps.map(row => ({
          topicId: row.topic_id,
          label: row.label,
          gap: parseFloat(String(row.gap)),
          dimensionTitle: row.dimension_title
        })),
        priorities: priorities.map(row => ({
          dimensionKey: row.dimension_key,
          title: row.title,
          priorityScore: parseFloat(String(row.priority_score)),
          rank: row.rank_order
        })),
        topRecommendations: allRecommendations,
      }
    });

  } catch (error) {
    logger.error('Error fetching results:', error);
    next(error);
  }
});

// GET /:responseId/recommendations
router.get('/:responseId/recommendations', requireResponseSession, async (req, res, next) => {
  try {
    const { responseId } = req.params;

    const recommendationsResult = await query(
      `SELECT 
         d.dimension_key, d.title as dimension_title, cp.priority_score, cp.recommendations
       FROM computed_priorities cp
       JOIN dimensions d ON cp.dimension_id = d.id
       WHERE cp.response_id = $1
       ORDER BY cp.rank_order ASC`,
      [responseId]
    );

    const recommendations = recommendationsResult.rows.map(row => ({
      dimensionKey: row.dimension_key,
      dimensionTitle: row.dimension_title,
      priorityScore: parseFloat(row.priority_score),
      items: row.recommendations || [] // Assuming JSONB is parsed automatically by pg
    }));

    res.json({
      success: true,
      data: {
        recommendations
      }
    });

  } catch (error) {
    logger.error('Error fetching recommendations:', error);
    next(error);
  }
});

export default router;
