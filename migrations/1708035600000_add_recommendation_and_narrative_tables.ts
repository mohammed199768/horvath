import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecommendationAndNarrativeTables1708035600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create recommendation_rules table
    await queryRunner.query(`
      CREATE TABLE recommendation_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_key VARCHAR(100) UNIQUE NOT NULL,
        dimension_key VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        conditions JSONB NOT NULL,
        why TEXT,
        what TEXT,
        how TEXT,
        priority_score DECIMAL(3,2) DEFAULT 0.5,
        tags JSONB,
        impact_level VARCHAR(20),
        effort_level VARCHAR(20),
        timeframe VARCHAR(50),
        action_items JSONB,
        resources JSONB,
        kpis JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_recommendation_rules_dimension ON recommendation_rules(dimension_key)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_recommendation_rules_tags ON recommendation_rules USING GIN(tags)
    `);

    // 2. Create recommendation_meta table
    await queryRunner.query(`
      CREATE TABLE recommendation_meta (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        meta_key VARCHAR(100) UNIQUE NOT NULL,
        meta_value JSONB NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Create narrative_templates table
    await queryRunner.query(`
      CREATE TABLE narrative_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_key VARCHAR(100) UNIQUE NOT NULL,
        template_type VARCHAR(50) NOT NULL,
        category VARCHAR(50),
        template TEXT NOT NULL,
        conditions JSONB,
        priority INTEGER DEFAULT 100,
        tags JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_narrative_templates_type ON narrative_templates(template_type)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_narrative_templates_key ON narrative_templates(template_key)
    `);

    // 4. Create narrative_theme_map table
    await queryRunner.query(`
      CREATE TABLE narrative_theme_map (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        theme_key VARCHAR(100) UNIQUE NOT NULL,
        theme_label VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_narrative_theme_map_key ON narrative_theme_map(theme_key)
    `);

    // 5. Create narrative_config table
    await queryRunner.query(`
      CREATE TABLE narrative_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        config_key VARCHAR(100) UNIQUE NOT NULL,
        config_value JSONB NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS narrative_config CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS narrative_theme_map CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS narrative_templates CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS recommendation_meta CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS recommendation_rules CASCADE`);
  }
}
