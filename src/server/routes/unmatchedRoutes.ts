import { Router, type RequestHandler } from 'express';
import { requireHostAuth, type HostAuthRequest } from '../middleware/requireHostAuth.ts';
import {
  getServerRepository,
  type HavenServerRepository,
} from '../services/serverRepository.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface UnmatchedRoutesDeps {
  repository?: HavenServerRepository;
  authMiddleware?: RequestHandler;
}

export function createUnmatchedRouter(deps: UnmatchedRoutesDeps = {}): Router {
  const router = Router();
  const resolveRepo = () => deps.repository ?? getServerRepository();
  const auth = deps.authMiddleware ?? requireHostAuth;

  router.post('/unmatched/:id/assign', auth, async (req: HostAuthRequest, res) => {
    try {
      const repo = resolveRepo();
      const unmatchedId = req.params.id;
      const body: unknown = req.body;
      const propertyId =
        isRecord(body) && typeof body.propertyId === 'string' ? body.propertyId.trim() : '';

      if (!propertyId) {
        res.status(400).json({ error: 'propertyId is required' });
        return;
      }

      const property = await repo.getProperty(propertyId);
      if (!property) {
        res.status(404).json({ error: 'Target property not found' });
        return;
      }

      const thread = await repo.assignUnmatchedEmail(unmatchedId, propertyId);
      if (!thread) {
        res.status(404).json({ error: 'Unmatched email not found or already resolved' });
        return;
      }

      res.json({ ok: true, threadId: thread.id });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to assign unmatched email';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
