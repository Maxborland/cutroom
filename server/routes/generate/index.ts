import { Router } from 'express';
import scriptRouter from './script.js';
import imageRouter from './image.js';
import videoRouter from './video.js';
import directorRouter from './director.js';

const router = Router({ mergeParams: true });

router.use(scriptRouter);
router.use(imageRouter);
router.use(videoRouter);
router.use(directorRouter);

export default router;
