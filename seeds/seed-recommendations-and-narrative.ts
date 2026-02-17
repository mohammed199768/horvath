import { pool } from '../src/config/database';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';

// Valid interface matching recommendations.json
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

// Valid interface matching narrative.json
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

async function seedRecommendations() {
  logger.info('🌱 Starting recommendations seeding...');
  
  // Read recommendations.json
  const recommendationsPath = path.join(__dirname, '../recommendations.json');
  
  if (!fs.existsSync(recommendationsPath)) {
    throw new Error(`Recommendations file not found at ${recommendationsPath}`);
  }

  const fileContent = fs.readFileSync(recommendationsPath, 'utf-8');
  const data: RecommendationsData = JSON.parse(fileContent);

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Seed recommendation_rules
    logger.info(`📝 Seeding ${data.rules.length} recommendation_rules...`);
    let ruleCount = 0;
    
    for (const rule of data.rules) {
      // Map JSON fields to DB columns
      // Note: 'action_items' in DB expects JSONB array of objects, but JSON has array of strings
      // We'll wrap strings into simple objects: { text: "..." }
      const actionItems = rule.actions.map((text, idx) => ({ 
        id: String(idx + 1), 
        text 
      }));

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
        rule.id,                        // rule_key
        rule.dimensionId,               // dimension_key
        rule.title,                     // title
        rule.summary,                   // description
        JSON.stringify(rule.conditions),// conditions
        (rule.priority / 100).toFixed(2), // priority_score (convert 0-100 to 0.0-1.0)
        JSON.stringify(rule.tags),      // tags
        'high',                         // impact_level (default)
        'medium',                       // effort_level (default)
        'short-term',                   // timeframe (default)
        JSON.stringify(actionItems)     // action_items
      ]);
      ruleCount++;
    }
    logger.info(`✅ Inserted/Updated ${ruleCount} recommendation rules`);

    // 2. Seed recommendation_meta
    logger.info('📝 Seeding recommendation_meta...');
    const meta = data.meta;
    
    const metaItems = [
      { key: 'dimension_colors', value: meta.dimensionColors, desc: 'Color codes for each dimension' },
      { key: 'dimension_weights', value: meta.dimensionWeights, desc: 'Priority weights for each dimension' },
      { key: 'theme_map', value: meta.themeMap, desc: 'Tag to theme label mapping' },
      { key: 'urgency_tags', value: meta.urgencyTags, desc: 'Tags that imply urgency' },
      { key: 'dimension_order', value: meta.dimensionOrder, desc: 'Display order of dimensions' },
      { key: 'title_templates', value: meta.titleTemplates, desc: 'Templates for generated titles' },
      { key: 'description_template', value: meta.descriptionTemplate, desc: 'Template for generated description' }
    ];

    for (const item of metaItems) {
      await client.query(`
        INSERT INTO recommendation_meta (meta_key, meta_value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (meta_key) DO UPDATE SET
          meta_value = EXCLUDED.meta_value,
          description = EXCLUDED.description,
          updated_at = CURRENT_TIMESTAMP
      `, [item.key, JSON.stringify(item.value), item.desc]);
    }

    logger.info('✅ Inserted recommendation metadata');

    await client.query('COMMIT');
    logger.info('✅ Recommendations seeding completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Error seeding recommendations:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function seedNarrative() {
  logger.info('🌱 Starting narrative seeding...');
  
  // Read narrative.json
  const narrativePath = path.join(__dirname, '../narrative.json');
  
  if (!fs.existsSync(narrativePath)) {
    throw new Error(`Narrative file not found at ${narrativePath}`);
  }

  const fileContent = fs.readFileSync(narrativePath, 'utf-8');
  const data: NarrativeData = JSON.parse(fileContent);

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Seed narrative_theme_map
    logger.info('📝 Seeding narrative_theme_map...');
    let themeCount = 0;
    for (const [key, label] of Object.entries(data.themeMap)) {
      await client.query(`
        INSERT INTO narrative_theme_map (theme_key, theme_label)
        VALUES ($1, $2)
        ON CONFLICT (theme_key) DO UPDATE SET
          theme_label = EXCLUDED.theme_label
      `, [key, label]);
      themeCount++;
    }
    logger.info(`✅ Inserted ${themeCount} theme mappings`);

    // 2. Seed narrative_config
    logger.info('📝 Seeding narrative_config...');
    
    // Transform maturity thresholds object to sorted arrays if needed, or store as is
    // The DB schema expects flexible JSONB, so we store the exact structure from JSON
    const configs = [
      { key: 'maturity_thresholds', value: data.maturityThresholds, desc: 'Threshold values for maturity levels' },
      { key: 'headlines', value: data.headlines, desc: 'Headline templates' },
      { key: 'executive_summary', value: data.executiveSummary, desc: 'Executive summary templates' },
      { key: 'stage_rationale', value: data.stageRationale, desc: 'Rationale template' },
      { key: 'priority_why_template', value: data.priorityWhyTemplate, desc: 'Template for priority explanation' },
      { key: 'notes', value: data.notes, desc: 'Confidence notes' }
    ];

    for (const config of configs) {
      await client.query(`
        INSERT INTO narrative_config (config_key, config_value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (config_key) DO UPDATE SET
          config_value = EXCLUDED.config_value,
          description = EXCLUDED.description,
          updated_at = CURRENT_TIMESTAMP
      `, [config.key, JSON.stringify(config.value), config.desc]);
    }

    logger.info('✅ Inserted narrative config');

    // 3. Seed narrative_templates
    // The narrative.json structure is quite different from what was initially assumed.
    // It has "executiveTemplates" which contains specific categories like "maturityLevel", "gapAnalysis", etc.
    // It DOES NOT have "dimensionTemplates" or "gapTemplates" arrays as top-level properties.
    // We will flattening this structure into the definitions table.
    
    logger.info('📝 Seeding narrative_templates...');
    let templateCount = 0;

    const categories = ['maturityLevel', 'gapAnalysis', 'strengths', 'priorities'] as const;
    
    for (const category of categories) {
      const templates = data.executiveTemplates[category];
      if (!templates) continue;

      for (const [key, templateString] of Object.entries(templates)) {
         // specific key for this template, e.g. "executive_maturityLevel_leading"
         const templateKey = `executive_${category}_${key}`;
         
         await client.query(`
          INSERT INTO narrative_templates (
            template_key, template_type, category, template, priority
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (template_key) DO UPDATE SET
            template = EXCLUDED.template,
            updated_at = CURRENT_TIMESTAMP
        `, [
          templateKey,
          'executive',     // template_type
          category,        // category (e.g. maturityLevel)
          templateString,  // template content
          0                // priority default
        ]);
        templateCount++;
      }
    }

    logger.info(`✅ Inserted ${templateCount} narrative templates`);

    await client.query('COMMIT');
    logger.info('✅ Narrative seeding completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Error seeding narrative:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Main execution
async function main() {
  try {
    logger.info('🚀 Starting complete seeding process...\n');
    
    await seedRecommendations();
    logger.info('\n');
    await seedNarrative();
    
    logger.info('\n✅✅✅ ALL SEEDING COMPLETED SUCCESSFULLY ✅✅✅');
    process.exit(0);
  } catch (error) {
    logger.error('\n❌❌❌ SEEDING FAILED ❌❌❌');
    logger.error(error);
    process.exit(1);
  } finally {
    // Force close pool to exit
    await pool.end();
  }
}

main();
