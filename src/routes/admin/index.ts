import { Router } from 'express';
import authRoutes from './auth';
import dashboardRoutes from './dashboard';
import importRouter from './import';
import assessmentsRoutes from './assessments';
import responsesRoutes from './responses';
import analyticsRoutes from './analytics';
import recommendationsRoutes from './recommendations';
import topicLevelsRouter from './topic-levels';
import topicRecsRouter from './topic-recommendations';
import participantsRouter from './participants';

const router = Router();

router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/assessments/import', importRouter);
router.use('/assessments', assessmentsRoutes);
router.use('/responses', responsesRoutes);
router.use('/participants', participantsRouter);
router.use('/analytics', analyticsRoutes);
router.use('/recommendations', recommendationsRoutes);
router.use('/topics', topicLevelsRouter);
router.use('/topics', topicRecsRouter);

export default router;
