import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../../config/database';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * GET /api/public/narrative/definition
 * Returns the complete narrative definition including templates, theme map, and config
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);

    const normalizeGapThresholds = (value: unknown) => {
      if (!isRecord(value)) {
        return undefined;
      }

      const minor = Number(value.minor);
      const moderate = Number(value.moderate);
      const significant = Number(value.significant);

      if ([minor, moderate, significant].every((n) => Number.isFinite(n))) {
        return { minor, moderate, significant };
      }

      return undefined;
    };

    const normalizeHeadlines = (value: unknown) => {
      if (!isRecord(value) || typeof value.lowConfidencePrefix !== 'string') {
        return undefined;
      }

      const byStageId = isRecord(value.byStageId)
        ? Object.fromEntries(
            Object.entries(value.byStageId).filter(([, v]) => typeof v === 'string')
          )
        : {};

      return {
        lowConfidencePrefix: value.lowConfidencePrefix,
        byStageId,
      };
    };

    const normalizeExecutiveSummary = (value: unknown) => {
      if (!isRecord(value)) {
        return undefined;
      }

      if (
        typeof value.sentence1 === 'string' &&
        typeof value.sentence2 === 'string' &&
        typeof value.sentence3 === 'string'
      ) {
        return {
          sentence1: value.sentence1,
          sentence2: value.sentence2,
          sentence3: value.sentence3,
        };
      }

      return undefined;
    };

    // 1. Get theme map
    const themeMapResult = await query(`
      SELECT theme_key, theme_label
      FROM narrative_theme_map
    `);

    const themeMap: Record<string, string> = {};
    themeMapResult.rows.forEach((row: any) => {
      themeMap[row.theme_key] = row.theme_label;
    });

    // 2. Get config values
    const configResult = await query(`
      SELECT config_key, config_value
      FROM narrative_config
    `);

    // Initialize with defaults or empty
    let maturityThresholds: any = {};
    let maturityLabels: string[] = [];
    let gapThresholds: any = undefined;
    let headlines: any = undefined;
    let executiveSummary: any = undefined;
    let stageRationale: string = "";
    let priorityWhyTemplate: string = "";
    let notes: any = {};

    configResult.rows.forEach((row: any) => {
      switch (row.config_key) {
        case 'maturity_thresholds':
          maturityThresholds = row.config_value;
          break;
        case 'maturity_labels':
          maturityLabels = row.config_value;
          break;
        case 'gap_thresholds':
          gapThresholds = normalizeGapThresholds(row.config_value);
          break;
        case 'headlines':
          headlines = normalizeHeadlines(row.config_value);
          break;
        case 'executive_summary':
          executiveSummary = normalizeExecutiveSummary(row.config_value);
          break;
        case 'stage_rationale':
          stageRationale = row.config_value;
          break;
        case 'priority_why_template':
          priorityWhyTemplate = row.config_value;
          break;
        case 'notes':
          notes = row.config_value;
          break;
      }
    });

    // 3. Get templates
    // We need template_key to reconstruct the key-value pairs
    const templatesResult = await query(`
      SELECT template_key, template_type, category, template, priority
      FROM narrative_templates
      ORDER BY template_type, category, priority
    `);

    // Frontend expects specific structure for executiveTemplates
    const executiveTemplates: any = {
      maturityLevel: {},
      gapAnalysis: {
        large: '',
        moderate: '',
        minimal: '',
      },
      strengths: {
        multiple: '',
        single: '',
      },
      priorities: {
        high: '',
        balanced: '',
      },
    };
    
    // These might be unused in current frontend but good to map if they exist
    const dimensionTemplates: Record<string, string[]> = {};
    const gapTemplates: Record<string, string[]> = {};

    templatesResult.rows.forEach((row: any) => {
      const category = row.category || 'default';
      const template = row.template;
      
      switch (row.template_type) {
        case 'executive':
          // template_key format: executive_<category>_<key>
          // Example: executive_maturityLevel_leading
          // We need to extract "leading"
          const prefix = `executive_${category}_`;
          if (row.template_key && row.template_key.startsWith(prefix)) {
             const key = row.template_key.substring(prefix.length);
             if (!executiveTemplates[category]) executiveTemplates[category] = {};
             executiveTemplates[category][key] = template;
          }
          break;
          
        case 'dimension':
          if (!dimensionTemplates[category]) dimensionTemplates[category] = [];
          dimensionTemplates[category].push(template);
          break;
          
        case 'gap':
          if (!gapTemplates[category]) gapTemplates[category] = [];
          gapTemplates[category].push(template);
          break;
      }
    });

    // 4. Return in the expected format (NarrativeDefinitionAPI)
    const payload: any = {
      version: 2, // Hardcoded or fetch from somewhere if tracked
      themeMap,
      maturityThresholds,
      maturityLabels,
      stageRationale,
      priorityWhyTemplate,
      notes,
      executiveTemplates,
      dimensionTemplates,
      gapTemplates
    };

    if (gapThresholds) payload.gapThresholds = gapThresholds;
    if (headlines) payload.headlines = headlines;
    if (executiveSummary) payload.executiveSummary = executiveSummary;

    res.json(payload);

    logger.info('Narrative definition retrieved successfully');
  } catch (error) {
    logger.error('Error fetching narrative definition:', error);
    next(error);
  }
});

export default router;
