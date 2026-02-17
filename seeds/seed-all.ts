/**
 * File: seeds/seed-all.ts
 * Purpose: Seeds the database with complete data from JSON files
 * - Assessment with dimensions and topics from questions.json
 * - Recommendations from recommendations.json
 * - Narrative from narrative.json
 */

import { pool, query } from '../src/config/database';
import { AuthService } from '../src/services/authService';
import { logger } from '../src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface Topic {
  id: string;
  label: string;
  prompt: string;
  order: number;
  anchors?: Record<string, string>;
}

interface Dimension {
  id: string;
  title: string;
  order: number;
  topics: Topic[];
}

interface QuestionsData {
  version: number;
  dimensions: Dimension[];
}

interface RecommendationRule {
  id: string;
  dimensionId: string;
  topicId: string;
  priority: number;
  conditions: Record<string, any>;
  title: string;
  summary: string;
  actions: string[];
  tags: string[];
}

interface RecommendationsData {
  version: number;
  rules: RecommendationRule[];
  meta: {
    themeMap: Record<string, string>;
    urgencyTags: string[];
    dimensionOrder: string[];
    dimensionWeights: Record<string, number>;
    dimensionColors: Record<string, string>;
    titleTemplates: Record<string, string[]>;
    descriptionTemplate: string;
  };
}

interface NarrativeData {
  version: number;
  themeMap: Record<string, string>;
  headlines: {
    lowConfidencePrefix: string;
    byStageId: Record<string, string>;
  };
  executiveSummary: {
    sentence1: string;
    sentence2: string;
    sentence3: string;
  };
  stageRationale: string;
  priorityWhyTemplate: string;
  notes: Record<string, string>;
  maturityThresholds: Record<string, number>;
  executiveTemplates: {
    maturityLevel: Record<string, string>;
    gapAnalysis: Record<string, string>;
    strengths: Record<string, string>;
    priorities: Record<string, string>;
  };
}

const getSeedAdminPassword = (): string => {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error('[SEED] SEED_ADMIN_PASSWORD env var is required and must be >=12 chars');
  }
  return adminPassword;
};

async function seedAssessment(client: any, questionsData: QuestionsData) {
  logger.info('ðŸ“ Seeding assessment, dimensions, and topics...');

  // Create admin user if not exists
  const adminCheck = await client.query('SELECT id, email FROM users WHERE email = $1', ['admin@leadership.com']);
  let admin;
  const adminPassword = getSeedAdminPassword();
  if (adminCheck.rows.length === 0) {
    admin = await AuthService.createUser('admin@leadership.com', adminPassword, 'System Administrator', 'super_admin');
    logger.info(`âœ… Admin created: ${admin.email}`);
  } else {
    admin = adminCheck.rows[0];
  }

  // Deactivate old assessments
  await client.query('UPDATE assessments SET is_active = false');

  // Create assessment
  const assessmentResult = await client.query(
    `INSERT INTO assessments (version, title, description, is_active, created_by, is_published, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id`,
    [1, 'AI Readiness Assessment', 'Evaluate your organization\'s readiness for AI adoption across key dimensions.', true, admin.id, true]
  );
  const assessmentId = assessmentResult.rows[0].id;
  logger.info(`âœ… Assessment created: ${assessmentId}`);

  // Create dimensions and topics from questions.json
  for (const dim of questionsData.dimensions) {
    const dimResult = await client.query(
      `INSERT INTO dimensions (assessment_id, dimension_key, title, category, order_index)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [assessmentId, dim.id, dim.title, dim.title, dim.order]
    );
    const dimensionId = dimResult.rows[0].id;

    for (const topic of dim.topics) {
      await client.query(
        `INSERT INTO topics (dimension_id, topic_key, label, prompt, order_index)
         VALUES ($1, $2, $3, $4, $5)`,
        [dimensionId, topic.id, topic.label, topic.prompt, topic.order]
      );
    }
    logger.info(`âœ… Created dimension: ${dim.title} with ${dim.topics.length} topics`);
  }
}

async function seedTopicLevelLabels(client: any, questionsData: QuestionsData) {
  logger.info('Seeding topic level labels from questions.json...');

  for (const dim of questionsData.dimensions) {
    for (const topic of dim.topics) {
      await client.query(
        `UPDATE topics
         SET level_1_label = $1,
             level_2_label = $2,
             level_3_label = $3,
             level_4_label = $4,
             level_5_label = $5,
             updated_at = NOW()
         WHERE topic_key = $6`,
        [
          topic.anchors?.['1'] ?? null,
          topic.anchors?.['2'] ?? null,
          topic.anchors?.['3'] ?? null,
          topic.anchors?.['4'] ?? null,
          topic.anchors?.['5'] ?? null,
          topic.id,
        ]
      );
    }
  }

  logger.info('Inserted level labels for seeded topics');
}

async function seedTopicRecommendations(client: any, recData: RecommendationsData) {
  logger.info('Seeding topic_recommendations...');

  await client.query('DELETE FROM topic_recommendations');

  const topicLookupResult = await client.query('SELECT id, topic_key FROM topics');
  const topicIdByKey = new Map<string, string>();
  for (const row of topicLookupResult.rows as Array<{ id: string; topic_key: string }>) {
    topicIdByKey.set(row.topic_key, row.id);
  }

  let inserted = 0;
  for (const rule of recData.rules) {
    const topicId = topicIdByKey.get(rule.topicId);
    if (!topicId) {
      logger.warn(`Skipping topic recommendation '${rule.id}' - no topic match for topicId='${rule.topicId}'`);
      continue;
    }

    const conditions = rule.conditions || {};
    await client.query(
      `INSERT INTO topic_recommendations (
         topic_id,
         score_min, score_max,
         target_min, target_max,
         gap_min, gap_max,
         title, description,
         action_items,
         category, priority, tags,
         is_active, order_index
       ) VALUES (
         $1,
         $2, $3,
         $4, $5,
         $6, $7,
         $8, $9,
         $10::jsonb,
         $11, $12, $13,
         true, $14
       )`,
      [
        topicId,
        conditions.currentMin ?? null,
        conditions.currentMax ?? null,
        conditions.targetMin ?? null,
        conditions.targetMax ?? null,
        conditions.gapMin ?? null,
        conditions.gapMax ?? null,
        rule.title,
        rule.summary,
        JSON.stringify(rule.actions ?? []),
        'Project',
        rule.priority ?? 50,
        rule.tags ?? [],
        0,
      ]
    );
    inserted += 1;
  }

  logger.info(`Inserted ${inserted} topic_recommendations rows`);
}

async function seedRecommendations(client: any, recData: RecommendationsData) {
  logger.info('ðŸ“ Seeding recommendations...');

  // Seed recommendation rules
  for (const rule of recData.rules) {
    const actionItems = rule.actions.map((text, idx) => ({ id: String(idx + 1), text }));

    await client.query(`
      INSERT INTO recommendation_rules (
        rule_key, dimension_key, title, description, conditions,
        priority_score, tags, impact_level, effort_level, timeframe, 
        action_items
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (rule_key) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        conditions = EXCLUDED.conditions,
        priority_score = EXCLUDED.priority_score,
        tags = EXCLUDED.tags,
        action_items = EXCLUDED.action_items,
        updated_at = CURRENT_TIMESTAMP
    `, [
      rule.id,
      rule.dimensionId,
      rule.title,
      rule.summary,
      JSON.stringify(rule.conditions),
      (rule.priority / 100).toFixed(2),
      JSON.stringify(rule.tags),
      'high',
      'medium',
      'short-term',
      JSON.stringify(actionItems)
    ]);
  }
  logger.info(`âœ… Inserted ${recData.rules.length} recommendation rules`);

  // Seed meta
  const meta = recData.meta;
  const metaItems = [
    { key: 'dimension_colors', value: meta.dimensionColors },
    { key: 'dimension_weights', value: meta.dimensionWeights },
    { key: 'theme_map', value: meta.themeMap },
    { key: 'urgency_tags', value: meta.urgencyTags },
    { key: 'dimension_order', value: meta.dimensionOrder },
    { key: 'title_templates', value: meta.titleTemplates },
    { key: 'description_template', value: meta.descriptionTemplate }
  ];

  for (const item of metaItems) {
    await client.query(`
      INSERT INTO recommendation_meta (meta_key, meta_value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (meta_key) DO UPDATE SET meta_value = EXCLUDED.meta_value, updated_at = CURRENT_TIMESTAMP
    `, [item.key, JSON.stringify(item.value), `Seeded ${item.key}`]);
  }
  logger.info('âœ… Inserted recommendation metadata');
}

async function seedNarrative(client: any, narData: NarrativeData) {
  logger.info('ðŸ“ Seeding narrative...');

  // Seed theme map
  for (const [key, label] of Object.entries(narData.themeMap)) {
    await client.query(`
      INSERT INTO narrative_theme_map (theme_key, theme_label)
      VALUES ($1, $2)
      ON CONFLICT (theme_key) DO UPDATE SET theme_label = EXCLUDED.theme_label
    `, [key, label]);
  }
  logger.info(`âœ… Inserted ${Object.keys(narData.themeMap).length} theme mappings`);

  // Seed narrative config
  const configs = [
    { key: 'maturity_thresholds', value: narData.maturityThresholds },
    { key: 'headlines', value: narData.headlines },
    { key: 'executive_summary', value: narData.executiveSummary },
    { key: 'stage_rationale', value: narData.stageRationale },
    { key: 'priority_why_template', value: narData.priorityWhyTemplate },
    { key: 'notes', value: narData.notes }
  ];

  for (const config of configs) {
    await client.query(`
      INSERT INTO narrative_config (config_key, config_value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = CURRENT_TIMESTAMP
    `, [config.key, JSON.stringify(config.value), `Seeded ${config.key}`]);
  }
  logger.info('âœ… Inserted narrative config');

  // Seed executive templates
  const categories = ['maturityLevel', 'gapAnalysis', 'strengths', 'priorities'] as const;
  for (const category of categories) {
    const templates = narData.executiveTemplates[category];
    if (!templates) continue;

    for (const [key, templateString] of Object.entries(templates)) {
      await client.query(`
        INSERT INTO narrative_templates (template_key, template_type, category, template, priority)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (template_key) DO UPDATE SET template = EXCLUDED.template, updated_at = CURRENT_TIMESTAMP
      `, [`executive_${category}_${key}`, 'executive', category, templateString, 0]);
    }
  }
  logger.info('âœ… Inserted executive templates');
}

async function main() {
  const client = await pool.connect();

  try {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SEED] Seeding is disabled in production');
    }

    logger.info('ðŸš€ Starting complete database seeding...\n');

    // Read JSON files from backend root
    const questionsPath = path.join(__dirname, '../questions.json');
    const recPath = path.join(__dirname, '../recommendations.json');
    const narPath = path.join(__dirname, '../narrative.json');

    const questionsData: QuestionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'));
    const recData: RecommendationsData = JSON.parse(fs.readFileSync(recPath, 'utf-8'));
    const narData: NarrativeData = JSON.parse(fs.readFileSync(narPath, 'utf-8'));

    await client.query('BEGIN');

    await seedAssessment(client, questionsData);
    await seedTopicLevelLabels(client, questionsData);
    await seedTopicRecommendations(client, recData);
    await seedRecommendations(client, recData);
    await seedNarrative(client, narData);

    await client.query('COMMIT');

    logger.info('\nâœ…âœ…âœ… ALL SEEDING COMPLETED SUCCESSFULLY âœ…âœ…âœ…');
    logger.info('   Email: admin@leadership.com');

    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('\nâŒâŒâŒ SEEDING FAILED âŒâŒâŒ', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
