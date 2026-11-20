import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createSampleUnmatchedEmail, createSeedSnapshot } from '../../data/seedData.ts';
import { createRequireGoogleOidc } from '../middleware/requireGoogleOidc.ts';
import { createRequireHostAuth } from '../middleware/requireHostAuth.ts';
import { createApiRouter } from '../routes/index.ts';
import type { GmailSyncClient } from '../services/gmailClient.ts';
import type { IngestionPushPayload } from '../services/ingestionService.ts';
import { sendAndroidPushNotification } from '../services/pushNotifier.ts';
import { InMemoryServerRepository } from '../services/serverRepository.ts';

interface RunningServer {
  baseUrl: string;
  close: () => Promise<void>;
}

const activeServers: RunningServer[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function startTestApp(app: express.Express): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected TCP AddressInfo'));
        return;
      }
      const running: RunningServer = {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      };
      activeServers.push(running);
      resolve(running);
    });
  });
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    if (server) {
      await server.close();
    }
  }
});

describe('Auth middleware, OIDC verification, PushNotifier cleanup & Express API routes', () => {
  it('enforces Firebase ID token, email_verified === true, and allowlist in requireHostAuth', async () => {
    const app = express();
    const middleware = createRequireHostAuth({
      verifyIdToken: async (token) => {
        if (token === 'valid-host') {
          return { uid: 'u1', email: 'alex@example.com', email_verified: true, name: 'Alex' };
        }
        if (token === 'unverified-host') {
          return { uid: 'u2', email: 'alex@example.com', email_verified: false };
        }
        if (token === 'outsider') {
          return { uid: 'u3', email: 'stranger@other.com', email_verified: true };
        }
        throw new Error('bad token');
      },
      getAllowedEmails: async () => ['alex@example.com', 'jordan@example.com'],
      allowLocalDevBypass: false,
    });

    app.get('/protected', middleware, (_req, res) => {
      res.json({ ok: true });
    });

    const { baseUrl } = await startTestApp(app);

    expect((await fetch(`${baseUrl}/protected`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/protected`, {
          headers: { Authorization: 'Bearer bad-token' },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/protected`, {
          headers: { Authorization: 'Bearer unverified-host' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/protected`, {
          headers: { Authorization: 'Bearer outsider' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/protected`, {
          headers: { Authorization: 'Bearer valid-host' },
        })
      ).status,
    ).toBe(200);

    // Fail-closed check: empty allowlist MUST deny even verified Google users
    const failClosedApp = express();
    failClosedApp.get(
      '/protected',
      createRequireHostAuth({
        verifyIdToken: async () => ({
          uid: 'u1',
          email: 'alex@example.com',
          email_verified: true,
        }),
        getAllowedEmails: async () => [],
        allowLocalDevBypass: false,
      }),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    const { baseUrl: closedUrl } = await startTestApp(failClosedApp);
    expect(
      (
        await fetch(`${closedUrl}/protected`, {
          headers: { Authorization: 'Bearer valid-host' },
        })
      ).status,
    ).toBe(403);
  });

  it('verifies Google OIDC service account email on internal Pub/Sub & Scheduler routes', async () => {
    const app = express();
    const oidc = createRequireGoogleOidc({
      expectedServiceAccount: 'haven-pubsub@demo.iam.gserviceaccount.com',
      audience: 'https://haven-cohost.example.run.app',
      verifyOidcToken: async (token) => {
        if (token === 'pubsub-ok') {
          return {
            email: 'haven-pubsub@demo.iam.gserviceaccount.com',
            email_verified: true,
          };
        }
        return {
          email: 'wrong-sa@demo.iam.gserviceaccount.com',
          email_verified: true,
        };
      },
    });

    app.post('/internal', oidc, (_req, res) => {
      res.json({ ok: true });
    });

    const { baseUrl } = await startTestApp(app);

    expect((await fetch(`${baseUrl}/internal`, { method: 'POST' })).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/internal`, {
          method: 'POST',
          headers: { Authorization: 'Bearer wrong-token' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${baseUrl}/internal`, {
          method: 'POST',
          headers: { Authorization: 'Bearer pubsub-ok' },
        })
      ).status,
    ).toBe(200);
  });

  it('cleans up stale FCM tokens automatically when Messaging returns not-registered errors', async () => {
    const removedCalls: Array<{ uid: string; stale: string[] }> = [];

    const result = await sendAndroidPushNotification(
      {
        title: 'Marcus L. · Coastal Loft',
        body: 'Quick follow-up about bag drop',
        propertyId: 'prop-coastal-loft',
        threadId: 'thread-marcus',
        view: 'dialogue',
      },
      {
        appOrigin: 'https://haven.example.com',
        loadRecipients: async () => [
          { uid: 'u-alex', tokens: ['tok-live-1', 'tok-dead-2'] },
        ],
        removeStaleTokens: async (uid, stale) => {
          removedCalls.push({ uid, stale });
        },
        messaging: {
          sendEachForMulticast: async () => ({
            successCount: 1,
            failureCount: 1,
            responses: [
              { success: true, messageId: 'msg-1' },
              {
                success: false,
                error: {
                  code: 'messaging/registration-token-not-registered',
                  message: 'Requested entity was not found.',
                  toJSON: () => ({}),
                },
              },
            ],
          }),
        },
      },
    );

    expect(result.sentCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.removedStaleTokens).toEqual(['tok-dead-2']);
    expect(removedCalls).toEqual([{ uid: 'u-alex', stale: ['tok-dead-2'] }]);
  });

  it('serves /api/health, /api/coach/turn, /api/knowledge/extract (text & PDF), /threads/:id/sent, /dismiss, and /unmatched/:id/assign', async () => {
    const seed = createSeedSnapshot();
    const unmatched = createSampleUnmatchedEmail();
    const repo = new InMemoryServerRepository({
      ...seed,
      unmatchedEmails: [unmatched],
    });

    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        repository: repo,
        authMiddleware: (_req, _res, next) => next(),
        pubSubOidcMiddleware: (_req, _res, next) => next(),
        schedulerOidcMiddleware: (_req, _res, next) => next(),
      }),
    );

    const { baseUrl } = await startTestApp(app);

    // Health check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
    const healthBody: unknown = await healthRes.json();
    expect(isRecord(healthBody) && healthBody.ok).toBe(true);
    expect(isRecord(healthBody) && healthBody.service).toBe('haven-cohost');

    // Coach turn on inquiry thread (Sarah) must NOT leak Access & Arrival codes
    const coachRes = await fetch(`${baseUrl}/api/coach/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'prop-mountain-chalet',
        threadId: 'thread-sarah',
      }),
    });
    expect(coachRes.status).toBe(200);
    const coachJson: unknown = await coachRes.json();
    const draft =
      isRecord(coachJson) && isRecord(coachJson.turn) && typeof coachJson.turn.draft === 'string'
        ? coachJson.turn.draft
        : '';
    expect(draft.length).toBeGreaterThan(20);
    expect(draft).not.toContain('8821#');
    expect(draft).not.toContain('timberline2026');

    // Knowledge extraction (paste text) detects conflict with existing Parking Allocation rule
    const extractRes = await fetch(`${baseUrl}/api/knowledge/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'prop-coastal-loft',
        sourceType: 'paste_text',
        sourceTitle: 'Updated Notes',
        textContent:
          'Parking Allocation: Two off-street spaces.\nCoffee Station: French press in cabinet.',
      }),
    });
    expect(extractRes.status).toBe(200);
    const extractJson: unknown = await extractRes.json();
    const candidates =
      isRecord(extractJson) && Array.isArray(extractJson.candidates)
        ? extractJson.candidates
        : [];
    expect(
      candidates.some(
        (c) => isRecord(c) && c.conflictRuleId === 'rule-a-parking',
      ),
    ).toBe(true);

    // Knowledge extraction rejects non-PDF file uploads (e.g. DOCX excluded in V1)
    const badForm = new FormData();
    badForm.append('propertyId', 'prop-coastal-loft');
    badForm.append('sourceType', 'pdf_upload');
    badForm.append(
      'file',
      new Blob(['fake docx'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      'manual.docx',
    );
    const badUploadRes = await fetch(`${baseUrl}/api/knowledge/extract`, {
      method: 'POST',
      body: badForm,
    });
    expect(badUploadRes.status).toBe(400);

    // Knowledge extraction accepts PDF multipart upload
    const pdfForm = new FormData();
    pdfForm.append('propertyId', 'prop-coastal-loft');
    pdfForm.append('sourceType', 'pdf_upload');
    pdfForm.append(
      'file',
      new Blob(['Beach Gear: Two beach chairs and an umbrella are in the mudroom closet.'], {
        type: 'application/pdf',
      }),
      'Guidebook.pdf',
    );
    const pdfUploadRes = await fetch(`${baseUrl}/api/knowledge/extract`, {
      method: 'POST',
      body: pdfForm,
    });
    expect(pdfUploadRes.status).toBe(200);

    // Assign unmatched email
    const assignRes = await fetch(`${baseUrl}/api/unmatched/${unmatched.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: 'prop-coastal-loft' }),
    });
    expect(assignRes.status).toBe(200);

    // Mark sent & dismiss endpoints
    const sentRes = await fetch(`${baseUrl}/api/threads/thread-marcus/sent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: 'prop-coastal-loft',
        finalText: 'Hi Marcus, 1 PM bag drop is all set!',
        originalDraft: 'Hi Marcus, early bag drop is available.',
      }),
    });
    expect(sentRes.status).toBe(200);

    const dismissRes = await fetch(`${baseUrl}/api/threads/thread-sarah/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: 'prop-mountain-chalet' }),
    });
    expect(dismissRes.status).toBe(200);

    // Binary %PDF- header without Vertex AI must fail cleanly (503) instead of parsing PDF syntax into fake rules
    const binaryPdfForm = new FormData();
    binaryPdfForm.append('propertyId', 'prop-coastal-loft');
    binaryPdfForm.append('sourceType', 'pdf_upload');
    binaryPdfForm.append(
      'file',
      new Blob(['%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj'], {
        type: 'application/pdf',
      }),
      'Binary_Guide.pdf',
    );
    const binaryPdfRes = await fetch(`${baseUrl}/api/knowledge/extract`, {
      method: 'POST',
      body: binaryPdfForm,
    });
    expect(binaryPdfRes.status).toBe(503);
  });

  it('handles /api/internal/gmail-push (monotonic BigInt cursor + 404 fallback) and /api/internal/renew-watch (success + failure push alert)', async () => {
    const seed = createSeedSnapshot();
    const repo = new InMemoryServerRepository({
      ...seed,
      properties: seed.properties.map((p) => ({
        ...p,
        needsReplyCount: 0,
        flaggedCount: 0,
      })),
      threads: {
        'prop-coastal-loft': [],
        'prop-mountain-chalet': [],
      },
      messages: {},
      unmatchedEmails: [],
    });
    await repo.updateIngestionState({ lastHistoryId: '200000', watchedLabelId: 'Label_Haven' });

    const sampleFixture = await fs.readFile(
      path.resolve(process.cwd(), 'src/server/__tests__/fixtures/airbnb_digest_single_guest.eml'),
    );

    const pushAlerts: IngestionPushPayload[] = [];
    let simulateFallback404 = false;
    let simulateWatchFailure = false;

    const fakeGmail: GmailSyncClient = {
      resolveLabelId: async () => 'Label_Haven',
      listHistoryMessageIds: async () => {
        if (simulateFallback404) {
          return {
            messageIds: [],
            latestHistoryId: null,
            usedFallbackList: true,
          };
        }
        return {
          messageIds: ['gm-push-1'],
          latestHistoryId: '200050',
          usedFallbackList: false,
        };
      },
      fetchRawMessage: async () => sampleFixture,
      getProfileHistoryId: async () => '200999',
      renewWatch: async () => {
        if (simulateWatchFailure) {
          throw new Error('OAuth refresh token revoked');
        }
        return {
          historyId: '201500',
          watchExpiresAt: '2026-11-27T09:00:00.000Z',
        };
      },
    };

    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        repository: repo,
        authMiddleware: (_req, _res, next) => next(),
        pubSubOidcMiddleware: (_req, _res, next) => next(),
        schedulerOidcMiddleware: (_req, _res, next) => next(),
        createGmailClient: () => fakeGmail,
        pushAdapter: {
          sendAlert: async (payload) => {
            pushAlerts.push(payload);
          },
        },
        gmailPubSubTopic: 'projects/haven-test/topics/haven-gmail-push',
      }),
    );

    const { baseUrl } = await startTestApp(app);

    // 1. Pub/Sub push with older historyId (150000) still advances monotonically to 200050 (never regresses)
    const olderPushPayload = Buffer.from(
      JSON.stringify({ emailAddress: 'haven@example.com', historyId: 150000 }),
      'utf8',
    ).toString('base64');
    const pushRes1 = await fetch(`${baseUrl}/api/internal/gmail-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { data: olderPushPayload } }),
    });
    expect(pushRes1.status).toBe(200);
    expect((await repo.getIngestionState()).lastHistoryId).toBe('200050');
    expect(await repo.listAllThreads()).toHaveLength(1);
    expect(pushAlerts).toHaveLength(1);

    // 2. Gmail 404 fallback recovers cursor using getProfileHistoryId() -> 200999
    simulateFallback404 = true;
    const pushRes2 = await fetch(`${baseUrl}/api/internal/gmail-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {} }),
    });
    expect(pushRes2.status).toBe(200);
    expect((await repo.getIngestionState()).lastHistoryId).toBe('200999');

    // 3. Watch renewal happy path updates watchExpiresAt & historyId
    const renewOk = await fetch(`${baseUrl}/api/internal/renew-watch`, { method: 'POST' });
    expect(renewOk.status).toBe(200);
    expect((await repo.getIngestionState()).lastHistoryId).toBe('201500');
    expect(repo.getIngestionHealth().status).toBe('healthy');
    expect(repo.getIngestionHealth().watchExpiresAt).toBe('2026-11-27T09:00:00.000Z');

    // 4. Watch renewal failure records error status and fires FCM push alert
    simulateWatchFailure = true;
    const renewFail = await fetch(`${baseUrl}/api/internal/renew-watch`, { method: 'POST' });
    expect(renewFail.status).toBe(500);
    expect(repo.getIngestionHealth().status).toBe('error');
    expect(repo.getIngestionHealth().lastError).toContain('OAuth refresh token revoked');
    expect(pushAlerts[pushAlerts.length - 1]?.title).toContain('Watch Renewal Failed');
  });
});
