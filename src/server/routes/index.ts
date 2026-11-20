import { Router } from 'express';

export function createApiRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'haven-cohost',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
