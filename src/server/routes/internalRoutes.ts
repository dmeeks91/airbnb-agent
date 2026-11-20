import { Router, type RequestHandler } from 'express';
import {
  createPubSubOidcMiddleware,
  createSchedulerOidcMiddleware,
} from '../middleware/requireGoogleOidc.ts';
import {
  isGmailOAuthConfigured,
  WorkspaceGmailClient,
  type GmailSyncClient,
} from '../services/gmailClient.ts';
import {
  IngestionService,
  type IngestionPushAdapter,
} from '../services/ingestionService.ts';
import {
  createPushAdapter,
  getServerRepository,
  type CohostServerRepository,
} from '../services/serverRepository.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodePubSubNotification(body: unknown): {
  emailAddress: string | null;
  historyId: string | null;
} {
  if (!isRecord(body) || !isRecord(body.message) || typeof body.message.data !== 'string') {
    return { emailAddress: null, historyId: null };
  }
  try {
    const decoded = Buffer.from(body.message.data, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (!isRecord(parsed)) {
      return { emailAddress: null, historyId: null };
    }
    return {
      emailAddress: typeof parsed.emailAddress === 'string' ? parsed.emailAddress : null,
      historyId:
        typeof parsed.historyId === 'string'
          ? parsed.historyId
          : typeof parsed.historyId === 'number'
            ? String(parsed.historyId)
            : null,
    };
  } catch {
    return { emailAddress: null, historyId: null };
  }
}

export function maxNumericString(a: string | null, b: string | null): string | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  try {
    return BigInt(b) > BigInt(a) ? b : a;
  } catch {
    return b;
  }
}

export interface InternalRoutesDeps {
  repository?: CohostServerRepository;
  pubSubOidcMiddleware?: RequestHandler;
  schedulerOidcMiddleware?: RequestHandler;
  createGmailClient?: () => GmailSyncClient | null;
  pushAdapter?: IngestionPushAdapter;
  gmailPubSubTopic?: string;
}

function defaultCreateGmailClient(): GmailSyncClient | null {
  return isGmailOAuthConfigured() ? new WorkspaceGmailClient() : null;
}

export function createInternalRouter(deps: InternalRoutesDeps = {}): Router {
  const router = Router();
  const resolveRepo = () => deps.repository ?? getServerRepository();
  const pubSubAuth = deps.pubSubOidcMiddleware ?? createPubSubOidcMiddleware();
  const schedulerAuth = deps.schedulerOidcMiddleware ?? createSchedulerOidcMiddleware();
  const createGmailClient = deps.createGmailClient ?? defaultCreateGmailClient;

  router.post('/internal/gmail-push', pubSubAuth, async (req, res) => {
    const repo = resolveRepo();
    const nowIso = new Date().toISOString();
    const { historyId: incomingHistoryId } = decodePubSubNotification(req.body);

    try {
      const gmail = createGmailClient();
      if (!gmail) {
        await repo.updateIngestionHealth({
          lastPushAt: nowIso,
          status: 'healthy',
          lastError: null,
        });
        res.json({ ok: true, processed: 0, note: 'Gmail OAuth not configured' });
        return;
      }

      const state = await repo.getIngestionState();
      const labelName = process.env.GMAIL_WATCHED_LABEL?.trim() || 'Co-Host';
      const labelId = state.watchedLabelId || (await gmail.resolveLabelId(labelName));

      if (!labelId) {
        throw new Error(`Gmail label "${labelName}" not found`);
      }

      const syncResult = await gmail.listHistoryMessageIds(state.lastHistoryId, labelId);
      const pushAdapter = deps.pushAdapter ?? createPushAdapter(repo);
      const ingestion = new IngestionService(repo, pushAdapter);

      let processedCount = 0;
      for (const gmailMessageId of syncResult.messageIds) {
        const rawEmail = await gmail.fetchRawMessage(gmailMessageId);
        await ingestion.processRawEmail(rawEmail, gmailMessageId);
        processedCount++;
      }

      const refreshedCursor =
        syncResult.usedFallbackList && !syncResult.latestHistoryId && !incomingHistoryId
          ? await gmail.getProfileHistoryId()
          : null;

      const nextHistoryId = maxNumericString(
        state.lastHistoryId,
        maxNumericString(
          incomingHistoryId,
          maxNumericString(syncResult.latestHistoryId, refreshedCursor),
        ),
      );

      await repo.updateIngestionState({
        watchedLabelId: labelId,
        lastHistoryId: nextHistoryId,
      });

      await repo.updateIngestionHealth({
        lastPushAt: nowIso,
        ...(processedCount > 0 ? { lastEmailReceivedAt: nowIso } : {}),
        status: 'healthy',
        lastError: null,
      });

      res.json({
        ok: true,
        processed: processedCount,
        nextHistoryId,
        usedFallbackList: syncResult.usedFallbackList,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gmail push sync failed';
      await repo.updateIngestionHealth({
        lastPushAt: nowIso,
        status: 'error',
        lastError: message,
      });
      res.status(500).json({ error: message });
    }
  });

  router.post('/internal/renew-watch', schedulerAuth, async (_req, res) => {
    const repo = resolveRepo();
    const pushAdapter = deps.pushAdapter ?? createPushAdapter(repo);
    try {
      const gmail = createGmailClient();
      if (!gmail) {
        res.json({ ok: true, note: 'Gmail OAuth not configured' });
        return;
      }

      const topicName = deps.gmailPubSubTopic ?? process.env.GMAIL_PUBSUB_TOPIC?.trim() ?? '';
      if (!topicName) {
        throw new Error('GMAIL_PUBSUB_TOPIC is not configured');
      }

      const labelName = process.env.GMAIL_WATCHED_LABEL?.trim() || 'Co-Host';
      const state = await repo.getIngestionState();
      const labelId = state.watchedLabelId || (await gmail.resolveLabelId(labelName));
      if (!labelId) {
        throw new Error(`Gmail label "${labelName}" not found`);
      }

      const watch = await gmail.renewWatch(topicName, labelId);
      const nextHistoryId = maxNumericString(state.lastHistoryId, watch.historyId);

      await repo.updateIngestionState({
        watchedLabelId: labelId,
        lastHistoryId: nextHistoryId,
        watchExpiresAt: watch.watchExpiresAt,
      });

      await repo.updateIngestionHealth({
        status: 'healthy',
        watchExpiresAt: watch.watchExpiresAt,
        lastError: null,
      });

      res.json({ ok: true, watchExpiresAt: watch.watchExpiresAt, nextHistoryId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gmail watch renewal failed';
      await repo.updateIngestionHealth({
        status: 'error',
        lastError: message,
      });
      await pushAdapter.sendAlert({
        title: 'Guest Co-Host Gmail Watch Renewal Failed',
        body: message.slice(0, 140),
        view: 'messages',
      });
      res.status(500).json({ error: message });
    }
  });

  return router;
}
