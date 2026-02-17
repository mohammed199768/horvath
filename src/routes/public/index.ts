import { Router } from 'express';
import assessmentsRoutes from './assessments';
import participantsRoutes from './participants';
import responsesRoutes from './responses';
import recommendationsDefRoutes from './recommendations-definition';
import narrativeDefRoutes from './narrative-definition';

const router = Router();

router.use('/assessments', assessmentsRoutes);
router.use('/participants', participantsRoutes);
router.use('/responses', responsesRoutes);
router.use('/recommendations/definition', recommendationsDefRoutes);
router.use('/narrative/definition', narrativeDefRoutes);

export default router;
