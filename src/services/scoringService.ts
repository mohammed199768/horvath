/**
 * File: src/services/scoringService.ts
 * Purpose: Handles assessment scoring logic, gap calculation, and ranking
 */

import { query, getClient } from '../config/database';
import { logger } from '../utils/logger';

export interface TopicGap {
  gap: number;
  normalizedGap: number;
}

export interface DimensionMetrics {
  score: number;
  gap: number;
}

export interface OverallMetrics {
  overallScore: number;
  overallGap: number;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string | null;
  why: string | null;
  what: string | null;
  how: string | null;
  action_items: string[];
  category: 'Quick Win' | 'Project' | 'Big Bet';
  priority: number;
  tags: string[];
  topicId: string;
  topicKey: string;
}

export class ScoringService {
  private static toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  /**
   * Calculate gap for a single topic
   * gap = target - current
   * normalizedGap = gap > 0 ? gap : 0 (overperformance = 0)
   */
  static calculateTopicGap(current: number, target: number): TopicGap {
    const gap = target - current;
    const normalizedGap = gap > 0 ? gap : 0;
    return { gap, normalizedGap };
  }

  /**
   * Calculate dimension score and gap
   * score = average of all current ratings in dimension
   * gap = average of all normalized gaps in dimension
   */
  static calculateDimensionMetrics(topics: Array<{
    currentRating: number;
    targetRating: number;
  }>): DimensionMetrics {
    if (topics.length === 0) {
      return { score: 0, gap: 0 };
    }

    let totalCurrent = 0;
    let totalNormalizedGap = 0;
    let validTopics = 0;

    for (const topic of topics) {
      if (!Number.isFinite(topic.currentRating) || !Number.isFinite(topic.targetRating)) {
        continue;
      }

      totalCurrent += topic.currentRating;
      const { normalizedGap } = this.calculateTopicGap(topic.currentRating, topic.targetRating);
      totalNormalizedGap += normalizedGap;
      validTopics++;
    }

    if (validTopics === 0) {
      return { score: 0, gap: 0 };
    }

    const score = parseFloat((totalCurrent / validTopics).toFixed(2));
    const gap = parseFloat((totalNormalizedGap / validTopics).toFixed(2));

    return { score, gap };
  }

  /**
   * Calculate priority score for a dimension
   * priorityScore = gap * impact_weight
   * For now, use: priorityScore = gap (simple version)
   */
  static calculatePriorityScore(gap: number, impact: number = 1): number {
    return parseFloat(gap.toFixed(2));
  }

  /**
   * Calculate overall assessment metrics
   */
  static calculateOverallMetrics(dimensions: Array<{
    score: number;
    gap: number;
  }>): OverallMetrics {
    if (dimensions.length === 0) {
      return { overallScore: 0, overallGap: 0 };
    }

    let totalScore = 0;
    let totalGap = 0;

    for (const dim of dimensions) {
      totalScore += dim.score;
      totalGap += dim.gap;
    }

    return {
      overallScore: parseFloat((totalScore / dimensions.length).toFixed(2)),
      overallGap: parseFloat((totalGap / dimensions.length).toFixed(2))
    };
  }

  private static toNullableNumber(value: unknown): number | null {
    if (value === null || typeof value === 'undefined') {
      return null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private static matchesConditions(
    rec: {
      score_min: number | null;
      score_max: number | null;
      target_min: number | null;
      target_max: number | null;
      gap_min: number | null;
      gap_max: number | null;
    },
    score: number,
    target: number,
    gap: number
  ): boolean {
    return (
      (rec.score_min == null || score >= rec.score_min) &&
      (rec.score_max == null || score <= rec.score_max) &&
      (rec.target_min == null || target >= rec.target_min) &&
      (rec.target_max == null || target <= rec.target_max) &&
      (rec.gap_min == null || gap >= rec.gap_min) &&
      (rec.gap_max == null || gap <= rec.gap_max)
    );
  }

  static async computeResults(responseId: string) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // 1. Get all topic responses for calculation
      const topicResponses = await client.query(
        `SELECT 
          tr.id, tr.topic_id, tr.current_rating, tr.target_rating,
          t.topic_key, t.dimension_id, d.title as dimension_title, d.order_index
         FROM topic_responses tr
         JOIN topics t ON tr.topic_id = t.id
         JOIN dimensions d ON t.dimension_id = d.id
         WHERE tr.response_id = $1
         ORDER BY d.order_index, t.order_index`,
        [responseId]
      );

      // Group by dimension
      const dimensionsMap = new Map<string, {
        id: string;
        title: string;
        order: number;
        topics: Array<{
          topicId: string;
          topicKey: string;
          currentRating: number;
          targetRating: number;
        }>;
      }>();

      for (const row of topicResponses.rows) {
        if (!dimensionsMap.has(row.dimension_id)) {
          dimensionsMap.set(row.dimension_id, {
            id: row.dimension_id,
            title: row.dimension_title,
            order: row.order_index,
            topics: []
          });
        }
        dimensionsMap.get(row.dimension_id)?.topics.push({
          topicId: row.topic_id,
          topicKey: row.topic_key,
          currentRating: this.toFiniteNumber(row.current_rating) ?? NaN,
          targetRating: this.toFiniteNumber(row.target_rating) ?? NaN,
        });
      }

      const topicIds = Array.from(
        new Set(topicResponses.rows.map((row: { topic_id: string }) => row.topic_id))
      );

      const recsByTopic = new Map<string, any[]>();

      if (topicIds.length > 0) {
        const allTopicRecs = await client.query(
          `SELECT 
             tr.id,
             tr.topic_id,
             tr.score_min, tr.score_max,
             tr.target_min, tr.target_max,
             tr.gap_min, tr.gap_max,
             tr.title, tr.description,
             tr.why, tr.what, tr.how,
             tr.action_items,
             tr.category, tr.priority, tr.tags,
             t.dimension_id,
             t.topic_key
           FROM topic_recommendations tr
           JOIN topics t ON t.id = tr.topic_id
           WHERE tr.topic_id = ANY($1::uuid[])
             AND tr.is_active = true
           ORDER BY tr.priority DESC, tr.order_index ASC`,
          [topicIds]
        );

        for (const rec of allTopicRecs.rows) {
          if (!recsByTopic.has(rec.topic_id)) {
            recsByTopic.set(rec.topic_id, []);
          }

          recsByTopic.get(rec.topic_id)?.push({
            ...rec,
            score_min: this.toNullableNumber(rec.score_min),
            score_max: this.toNullableNumber(rec.score_max),
            target_min: this.toNullableNumber(rec.target_min),
            target_max: this.toNullableNumber(rec.target_max),
            gap_min: this.toNullableNumber(rec.gap_min),
            gap_max: this.toNullableNumber(rec.gap_max),
            priority: Number(rec.priority ?? 0),
          });
        }
      }

      const matchedRecommendationsByDimension = new Map<string, Recommendation[]>();

      for (const row of topicResponses.rows) {
        const score = this.toFiniteNumber(row.current_rating);
        const target = this.toFiniteNumber(row.target_rating);
        if (score === null || target === null) {
          continue;
        }
        const gap = Number(Math.max(0, target - score).toFixed(2));
        const topicRecs = recsByTopic.get(row.topic_id) || [];

        for (const rec of topicRecs) {
          if (!this.matchesConditions(rec, score, target, gap)) {
            continue;
          }

          const dimensionRecommendations = matchedRecommendationsByDimension.get(row.dimension_id) || [];
          dimensionRecommendations.push({
            id: rec.id,
            title: rec.title,
            description: rec.description ?? null,
            why: rec.why ?? null,
            what: rec.what ?? null,
            how: rec.how ?? null,
            action_items: Array.isArray(rec.action_items) ? rec.action_items : [],
            category: rec.category,
            priority: Number(rec.priority ?? 0),
            tags: Array.isArray(rec.tags) ? rec.tags : [],
            topicId: rec.topic_id,
            topicKey: rec.topic_key,
          });
          matchedRecommendationsByDimension.set(row.dimension_id, dimensionRecommendations);
        }
      }

      for (const [dimensionId, recommendations] of matchedRecommendationsByDimension.entries()) {
        const sorted = recommendations.sort((a, b) => b.priority - a.priority).slice(0, 5);
        matchedRecommendationsByDimension.set(dimensionId, sorted);
      }

      const calculatedDimensions = [];

      // 2. Calculate metrics for each dimension
      let rankCounter = 0;
      // Convert map to array to sort by whatever we need later, but first calc scores
      const dimArray = Array.from(dimensionsMap.values());
      
      for (const dim of dimArray) {
        const { score, gap } = this.calculateDimensionMetrics(dim.topics);
        const priorityScore = this.calculatePriorityScore(gap);

        calculatedDimensions.push({
          ...dim,
          score,
          gap,
          priorityScore
        });
      }

      // Sort by priority score DESC for ranking
      calculatedDimensions.sort((a, b) => b.priorityScore - a.priorityScore);

      if (calculatedDimensions.length > 0) {
        const values: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        for (let i = 0; i < calculatedDimensions.length; i++) {
          const dim = calculatedDimensions[i];
          const rank = i + 1;
          const recommendations = matchedRecommendationsByDimension.get(dim.id) || [];

          values.push(
            `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, NOW())`
          );
          params.push(
            responseId,
            dim.id,
            dim.score,
            dim.gap,
            dim.priorityScore,
            rank,
            JSON.stringify(recommendations)
          );
        }

        await client.query(
          `INSERT INTO computed_priorities
            (response_id, dimension_id, dimension_score, dimension_gap, priority_score, rank_order, recommendations, computed_at)
           VALUES ${values.join(', ')}
           ON CONFLICT (response_id, dimension_id) DO UPDATE SET
             dimension_score = EXCLUDED.dimension_score,
             dimension_gap = EXCLUDED.dimension_gap,
             priority_score = EXCLUDED.priority_score,
             rank_order = EXCLUDED.rank_order,
             recommendations = EXCLUDED.recommendations,
             computed_at = NOW()`,
          params
        );
      }

      // 4. Calculate overall metrics
      const { overallScore, overallGap } = this.calculateOverallMetrics(calculatedDimensions);

      // 5. Update assessment response
      await client.query(
        `UPDATE assessment_responses
         SET 
           status = 'completed',
           completed_at = NOW(),
           overall_score = $2,
           overall_gap = $3,
           last_updated_at = NOW()
         WHERE id = $1`,
        [
          responseId,
          overallScore,
          overallGap,
        ]
      );

      await client.query('COMMIT');

      logger.info(`Results computed for response: ${responseId}`);

      return {
        overallScore,
        overallGap,
        dimensions: calculatedDimensions.map(d => ({
          dimensionId: d.id,
          title: d.title,
          score: d.score,
          gap: d.gap,
          priorityScore: d.priorityScore
        }))
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error computing results:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async getTopPriorities(responseId: string, limit: number = 5) {
    const result = await query(
      `SELECT 
        cp.*,
        d.title as dimension_title,
        d.category
       FROM computed_priorities cp
       JOIN dimensions d ON cp.dimension_id = d.id
       WHERE cp.response_id = $1
       ORDER BY cp.priority_score DESC, cp.rank_order ASC
       LIMIT $2`,
      [responseId, limit]
    );

    return result.rows;
  }
}
