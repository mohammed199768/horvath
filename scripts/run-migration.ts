import { pool } from '../src/config/database';
import { logger } from '../src/utils/logger';
import { AddRecommendationAndNarrativeTables1708035600000 } from '../migrations/1708035600000_add_recommendation_and_narrative_tables';

// Mock TypeORM QueryRunner interface for our needs
class PostgresQueryRunner {
  async query(query: string, parameters?: any[]): Promise<any> {
    logger.info(`Executing query: ${query.substring(0, 50)}...`);
    return pool.query(query, parameters);
  }
}

async function runMigration() {
  try {
    logger.info('🚀 Starting migration shim runner...');
    
    const queryRunner = new PostgresQueryRunner();
    const migration = new AddRecommendationAndNarrativeTables1708035600000();
    
    logger.info('Running migration: AddRecommendationAndNarrativeTables1708035600000');
    await migration.up(queryRunner as any);
    
    logger.info('✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
