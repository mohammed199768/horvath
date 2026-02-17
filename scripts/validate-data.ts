import { pool } from '../src/config/database';
import { logger } from '../src/utils/logger';

async function validateData() {
  try {
    logger.info('🔍 Starting data validation...');
    
    // 1. Check recommendation rules
    const rulesResult = await pool.query(`
      SELECT COUNT(*) as count FROM recommendation_rules
    `);
    logger.info(`✅ Recommendation Rules Count: ${rulesResult.rows[0].count} (Expected: ~8)`);

    // 2. Check recommendation meta
    const metaResult = await pool.query(`
      SELECT meta_key, jsonb_typeof(meta_value) as type 
      FROM recommendation_meta
    `);
    logger.info('✅ Recommendation Meta Keys:');
    metaResult.rows.forEach((r: any) => logger.info(`   - ${r.meta_key} (${r.type})`));

    // 3. Check narrative templates
    const templatesResult = await pool.query(`
      SELECT template_type, COUNT(*) as count 
      FROM narrative_templates 
      GROUP BY template_type
    `);
    logger.info('✅ Narrative Templates distribution:');
    templatesResult.rows.forEach((r: any) => logger.info(`   - ${r.template_type}: ${r.count}`));

    // 4. Check narrative theme map
    const themeResult = await pool.query(`
      SELECT COUNT(*) as count FROM narrative_theme_map
    `);
    logger.info(`✅ Narrative Theme Map Count: ${themeResult.rows[0].count} (Expected: 12)`);

    // 5. Check narrative config
    const configResult = await pool.query(`
      SELECT config_key FROM narrative_config
    `);
    logger.info('✅ Narrative Config Keys:');
    configResult.rows.forEach((r: any) => logger.info(`   - ${r.config_key}`));

    logger.info('✅ validation completed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

validateData();
