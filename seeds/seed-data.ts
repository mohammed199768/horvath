/**
 * File: seeds/seed-data.ts
 * Purpose: Seeds the database with initial admin, assessment, dimensions, and settings
 */

import { query } from '../src/config/database';
import { AuthService } from '../src/services/authService';
import { logger } from '../src/utils/logger';

const getSeedAdminPassword = (): string => {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error('[SEED] SEED_ADMIN_PASSWORD env var is required and must be >=12 chars');
  }
  return adminPassword;
};

async function seedDatabase() {
  try {
    logger.info('Starting database seeding...');
    const adminPassword = getSeedAdminPassword();

    logger.info('Creating admin user...');
    const adminCheck = await query('SELECT id, email FROM users WHERE email = $1', ['admin@leadership.com']);
    let admin: { id: string; email: string };

    if (adminCheck.rows.length === 0) {
      admin = await AuthService.createUser(
        'admin@leadership.com',
        adminPassword,
        'System Administrator',
        'super_admin'
      );
      logger.info(`Admin created: ${admin.email}`);
    } else {
      admin = adminCheck.rows[0] as { id: string; email: string };
      logger.info(`Admin already exists: ${admin.email}`);
    }

    logger.info('Creating AI Readiness Assessment...');
    let assessmentId: string;
    const assessmentCheck = await query('SELECT id FROM assessments WHERE title = $1', ['AI Readiness Assessment']);

    if (assessmentCheck.rows.length === 0) {
      await query('UPDATE assessments SET is_active = false');

      const assessmentResult = await query(
        `INSERT INTO assessments (version, title, description, is_active, created_by, is_published, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id`,
        [
          1,
          'AI Readiness Assessment',
          "Evaluate your organization's readiness for AI adoption across key dimensions.",
          true,
          admin.id,
          true,
        ]
      );
      assessmentId = assessmentResult.rows[0].id as string;
      logger.info(`Assessment created with ID: ${assessmentId}`);

      const sampleDimensions = [
        { key: 'strategy', title: 'AI Strategy', category: 'Strategy & Governance', desc: 'Alignment of AI with business goals and roadmap.' },
        { key: 'governance', title: 'AI Governance', category: 'Strategy & Governance', desc: 'Policies, ethics, and risk management.' },
        { key: 'data', title: 'Data & Analytics', category: 'Data Foundations', desc: 'Data quality, availability, and management.' },
        { key: 'technology', title: 'Technology Infrastructure', category: 'Technology & Infrastructure', desc: 'Compute, cloud, and tools for AI.' },
        { key: 'value', title: 'Value Generation', category: 'Strategy & Governance', desc: 'Use case identification and ROI measurement.' },
        { key: 'capabilities', title: 'Skills & Capabilities', category: 'Leadership Enablement', desc: 'Talent, training, and organizational culture.' },
      ];

      for (let i = 0; i < sampleDimensions.length; i += 1) {
        const dim = sampleDimensions[i];
        const dimResult = await query(
          `INSERT INTO dimensions
             (assessment_id, dimension_key, title, description, category, order_index)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [assessmentId, dim.key, dim.title, dim.desc, dim.category, i + 1]
        );

        const dimensionId = dimResult.rows[0].id as string;

        for (let j = 1; j <= 5; j += 1) {
          await query(
            `INSERT INTO topics
               (dimension_id, topic_key, label, prompt, order_index)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              dimensionId,
              `${dim.key}_topic_${j}`,
              `${dim.title} - Key Area ${j}`,
              `How would you rate your organization's maturity in ${dim.title} area ${j}?`,
              j,
            ]
          );
        }

        logger.info(`Created dimension: ${dim.title} with 5 topics`);
      }
    } else {
      assessmentId = assessmentCheck.rows[0].id as string;
      await query('UPDATE assessments SET is_active = true WHERE id = $1', [assessmentId]);
      logger.info(`Assessment already exists (ID: ${assessmentId}) - activated`);
    }

    const settings = [
      { key: 'site_name', value: '"AI Readiness Assessment"' },
      { key: 'max_login_attempts', value: '5' },
      { key: 'session_timeout_hours', value: '24' },
      { key: 'enable_email_notifications', value: 'true' },
      { key: 'results_access_duration_days', value: '30' },
      { key: 'admin_email', value: '"admin@leadership.com"' },
    ];

    for (const setting of settings) {
      await query(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ($1, $2)
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
        [setting.key, setting.value]
      );
    }

    logger.info('System settings created');
    logger.info('Database seeding completed successfully');
    logger.info('Admin user seeded or already present: admin@leadership.com');
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();
