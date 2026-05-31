import { Router } from 'express';
import { SessionController } from '../controllers/SessionController';

const router = Router();

router.get('/sessions', SessionController.getAll);
router.get('/sessions/:id', SessionController.getOne);
router.get('/sessions/:id/video', SessionController.streamVideo);
router.get('/sessions/:id/subtitles', SessionController.getSubtitles);
router.delete('/sessions/:id', SessionController.delete);
router.post('/sessions/:id/retry', SessionController.retryProcessing);

export default router;
