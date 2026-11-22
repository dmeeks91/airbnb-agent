import { Router, type RequestHandler } from 'express';
import { requireHostAuth, type HostAuthRequest } from '../middleware/requireHostAuth.ts';
import {
  getServerRepository,
  type CohostServerRepository,
} from '../services/serverRepository.ts';

export interface AuditRoutesDeps {
  repository?: CohostServerRepository;
  authMiddleware?: RequestHandler;
}

export function createAuditRouter(deps: AuditRoutesDeps = {}): Router {
  const router = Router();
  const resolveRepo = () => deps.repository ?? getServerRepository();
  const auth = deps.authMiddleware ?? requireHostAuth;

  router.get('/audit/ignored', auth, async (_req: HostAuthRequest, res) => {
    try {
      const repo = resolveRepo();
      const entries = await repo.listIgnoredEmails();
      res.json({ entries });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load ignored email audit log';
      res.status(500).json({ error: message });
    }
  });

  router.post('/audit/ignored/:id/restore', auth, async (req: HostAuthRequest, res) => {
    try {
      const repo = resolveRepo();
      const ignoredId = req.params.id;
      const result = await repo.restoreIgnoredEmail(ignoredId);
      if (!result.restored) {
        res.status(404).json({ error: 'Ignored email entry not found' });
        return;
      }
      res.json({
        ok: true,
        destination: result.destination,
        threadId: result.threadId ?? null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to restore ignored email';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
