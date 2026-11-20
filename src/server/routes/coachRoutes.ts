import { Router, type RequestHandler } from 'express';
import type {
  ActiveCoachSession,
  CoachTurn,
  CoachTurnResponse,
} from '../../types/haven.ts';
import { buildLocalFallbackCoachTurn } from '../../utils/localDraftFallback.ts';
import { generateDraftWithVertex } from '../config/vertex.ts';
import { requireHostAuth, type HostAuthRequest } from '../middleware/requireHostAuth.ts';
import { buildCoachPrompt, sanitizeDraftOutput } from '../services/promptBuilder.ts';
import {
  getServerRepository,
  type HavenServerRepository,
} from '../services/serverRepository.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface CoachRoutesDeps {
  repository?: HavenServerRepository;
  authMiddleware?: RequestHandler;
}

export function createCoachRouter(deps: CoachRoutesDeps = {}): Router {
  const router = Router();
  const resolveRepo = () => deps.repository ?? getServerRepository();
  const auth = deps.authMiddleware ?? requireHostAuth;

  router.post('/coach/turn', auth, async (req: HostAuthRequest, res) => {
    try {
      const repo = resolveRepo();
      const body: unknown = req.body;
      if (!isRecord(body)) {
        res.status(400).json({ error: 'Invalid request body' });
        return;
      }

      const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : '';
      const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
      const instruction =
        typeof body.instruction === 'string' ? body.instruction.trim() : undefined;

      if (!propertyId || !threadId) {
        res.status(400).json({ error: 'propertyId and threadId are required' });
        return;
      }

      const [property, thread, rules, messages, voiceProfile] = await Promise.all([
        repo.getProperty(propertyId),
        repo.getThread(propertyId, threadId),
        repo.getPropertyRules(propertyId),
        repo.listThreadMessages(propertyId, threadId),
        repo.getVoiceProfile(),
      ]);

      if (!property || !thread) {
        res.status(404).json({ error: 'Property or thread not found' });
        return;
      }

      const priorTurns = thread.activeCoachSession?.turns ?? [];
      const nextTurns: CoachTurn[] = [...priorTurns];
      if (instruction) {
        nextTurns.push({
          id: `turn-host-${Date.now()}`,
          sender: 'host',
          text: instruction,
          note: null,
          draft: null,
          editedByUser: false,
          createdAt: new Date().toISOString(),
        });
      }

      const prompt = buildCoachPrompt({
        property,
        thread,
        messages,
        rules,
        voiceProfile,
        priorTurns,
        hostInstruction: instruction,
      });

      let agentTurn: CoachTurn;
      let source: 'vertex' | 'local_fallback' = 'local_fallback';

      const vertexOutput = await generateDraftWithVertex({
        systemInstruction: prompt.systemInstruction,
        userPrompt: prompt.userPrompt,
      });

      if (vertexOutput) {
        const sanitizedDraft = sanitizeDraftOutput(vertexOutput.draftReply);
        agentTurn = {
          id: `turn-agent-${Date.now()}`,
          sender: 'agent',
          text: vertexOutput.agentComment,
          note: vertexOutput.coachNote || null,
          draft: sanitizedDraft,
          originalDraft: sanitizedDraft,
          editedByUser: false,
          createdAt: new Date().toISOString(),
        };
        source = 'vertex';
      } else {
        agentTurn = buildLocalFallbackCoachTurn({
          property,
          thread,
          messages,
          rules,
          voiceProfile,
          instruction,
        });
      }

      const nextSession: ActiveCoachSession = {
        turns: [...nextTurns, agentTurn],
        hasNewGuestMessageSinceEdit: false,
      };

      await repo.setCoachSession(propertyId, threadId, nextSession);

      const responsePayload: CoachTurnResponse = {
        turn: agentTurn,
        session: nextSession,
        source,
      };
      res.json(responsePayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate draft';
      res.status(500).json({ error: message });
    }
  });

  router.post('/threads/:id/sent', auth, async (req: HostAuthRequest, res) => {
    try {
      const repo = resolveRepo();
      const threadId = req.params.id;
      const body: unknown = req.body;
      if (!isRecord(body)) {
        res.status(400).json({ error: 'Invalid request body' });
        return;
      }

      const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : '';
      const finalText = typeof body.finalText === 'string' ? body.finalText.trim() : '';
      const originalDraft =
        typeof body.originalDraft === 'string' ? body.originalDraft : null;
      const loggedManually = Boolean(body.loggedManually);
      const senderName =
        typeof body.senderName === 'string' && body.senderName.trim()
          ? body.senderName.trim()
          : (req.hostUser?.displayName ?? 'Host');

      if (!propertyId || !finalText) {
        res.status(400).json({ error: 'propertyId and finalText are required' });
        return;
      }

      await repo.markThreadSent(propertyId, threadId, {
        finalText,
        originalDraft,
        senderName,
        loggedManually,
      });

      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mark sent';
      res.status(500).json({ error: message });
    }
  });

  router.post('/threads/:id/dismiss', auth, async (req: HostAuthRequest, res) => {
    try {
      const repo = resolveRepo();
      const threadId = req.params.id;
      const body: unknown = req.body;
      const propertyId =
        isRecord(body) && typeof body.propertyId === 'string' ? body.propertyId.trim() : '';

      if (!propertyId) {
        res.status(400).json({ error: 'propertyId is required' });
        return;
      }

      await repo.dismissThread(propertyId, threadId);
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to dismiss thread';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
