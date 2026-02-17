/**
 * File: src/routes/index.ts
 * Purpose: Aggregates all application routes
 * Updated: Force restart
 */

import { Router } from 'express';

// Admin Routes
import adminAuthRoutes from './admin/auth';
import adminDashboardRoutes from './admin/dashboard';
import adminAssessmentsRoutes from './admin/assessments';
import adminResponsesRoutes from './admin/responses';
import adminAnalyticsRoutes from './admin/analytics';
import adminRecommendationsRoutes from './admin/recommendations';
import adminTopicLevelsRoutes from './admin/topic-levels';
import adminTopicRecommendationsRoutes from './admin/topic-recommendations';

// Public Routes
import publicAssessmentsRoutes from './public/assessments';
import publicParticipantsRoutes from './public/participants';
import publicResponsesRoutes from './public/responses';
import recommendationsDefinitionRoutes from './public/recommendations-definition';
import narrativeDefinitionRoutes from './public/narrative-definition';

const router = Router();

// Admin Routes
router.use('/admin/auth', adminAuthRoutes);
router.use('/admin/dashboard', adminDashboardRoutes);
router.use('/admin/assessments', adminAssessmentsRoutes);
router.use('/admin/responses', adminResponsesRoutes);
router.use('/admin/analytics', adminAnalyticsRoutes);
router.use('/admin/recommendations', adminRecommendationsRoutes);
router.use('/admin/topics', adminTopicLevelsRoutes);
router.use('/admin/topics', adminTopicRecommendationsRoutes);

// Public Routes (No auth required)
router.use('/public/assessments', publicAssessmentsRoutes);
router.use('/public/participants', publicParticipantsRoutes);
router.use('/public/responses', publicResponsesRoutes);
router.use('/public/recommendations/definition', recommendationsDefinitionRoutes);
router.use('/public/narrative/definition', narrativeDefinitionRoutes);

// Health Check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString() 
  });
});

export default router;
