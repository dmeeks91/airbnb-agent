import { Router, type RequestHandler } from 'express';
import { createCoachRouter } from './coachRoutes.ts';
import { createInternalRouter } from './internalRoutes.ts';
import { createKnowledgeRouter } from './knowledgeRoutes.ts';
import { createUnmatchedRouter } from './unmatchedRoutes.ts';
import type { GmailSyncClient } from '../services/gmailClient.ts';
import type { IngestionPushAdapter } from '../services/ingestionService.ts';
import type { HavenServerRepository } from '../services/serverRepository.ts';

export interface ApiRouterDeps {
  repository?: HavenServerRepository;
  authMiddleware?: RequestHandler;
  pubSubOidcMiddleware?: RequestHandler;
  schedulerOidcMiddleware?: RequestHandler;
  createGmailClient?: () => GmailSyncClient | null;
  pushAdapter?: IngestionPushAdapter;
  gmailPubSubTopic?: string;
}

export function createApiRouter(deps: ApiRouterDeps = {}): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'haven-cohost',
      timestamp: new Date().toISOString(),
    });
  });

  router.use(
    createCoachRouter({
      repository: deps.repository,
      authMiddleware: deps.authMiddleware,
    }),
  );
  router.use(
    createKnowledgeRouter({
      repository: deps.repository,
      authMiddleware: deps.authMiddleware,
    }),
  );
  router.use(
    createUnmatchedRouter({
      repository: deps.repository,
      authMiddleware: deps.authMiddleware,
    }),
  );
  router.use(
    createInternalRouter({
      repository: deps.repository,
      pubSubOidcMiddleware: deps.pubSubOidcMiddleware,
      schedulerOidcMiddleware: deps.schedulerOidcMiddleware,
      createGmailClient: deps.createGmailClient,
      pushAdapter: deps.pushAdapter,
      gmailPubSubTopic: deps.gmailPubSubTopic,
    }),
  );

  return router;
}
