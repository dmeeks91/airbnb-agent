import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  notifyThreadDismissed,
  notifyThreadSent,
  requestCoachTurn,
  requestDeleteThread,
} from '../services/apiClient.ts';
import type { CohostStore } from '../services/cohostStore.ts';
import type { ActiveCoachSession, CoachTurn, GuestThread } from '../types/cohost.ts';
import { buildLocalFallbackCoachTurn } from '../utils/localDraftFallback.ts';

function statusPriority(status: GuestThread['status']): number {
  if (status === 'flagged') {
    return 0;
  }
  if (status === 'needs_reply') {
    return 1;
  }
  if (status === 'sent') {
    return 2;
  }
  return 3;
}

export function useThreads(store: CohostStore, propertyId: string) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const threadActionEpochRef = useRef(new Map<string, number>());

  const bumpThreadEpoch = useCallback((targetPropertyId: string, threadId: string): number => {
    const key = `${targetPropertyId}/${threadId}`;
    const nextEpoch = (threadActionEpochRef.current.get(key) ?? 0) + 1;
    threadActionEpochRef.current.set(key, nextEpoch);
    return nextEpoch;
  }, []);

  const threads = useMemo(() => {
    const raw = snapshot.threads[propertyId] ?? [];
    return [...raw].sort((a, b) => {
      const diff = statusPriority(a.status) - statusPriority(b.status);
      if (diff !== 0) {
        return diff;
      }
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });
  }, [snapshot.threads, propertyId]);

  const getThreadById = useCallback(
    (threadId: string | null): GuestThread | undefined => {
      if (!threadId) {
        return undefined;
      }
      return (snapshot.threads[propertyId] ?? []).find((t) => t.id === threadId);
    },
    [snapshot.threads, propertyId],
  );

  const getMessagesForThread = useCallback(
    (threadId: string) => snapshot.messages[threadId] ?? [],
    [snapshot.messages],
  );

  const runCoachTurn = useCallback(
    async (
      targetPropertyId: string,
      threadId: string,
      options: { instruction?: string; refreshBurst?: boolean } = {},
    ): Promise<ActiveCoachSession | null> => {
      const current = store.getSnapshot();
      const property = current.properties.find((p) => p.id === targetPropertyId);
      const thread = (current.threads[targetPropertyId] ?? []).find((t) => t.id === threadId);
      if (!property || !thread) {
        return null;
      }

      const epochKey = `${targetPropertyId}/${threadId}`;
      const requestEpoch = bumpThreadEpoch(targetPropertyId, threadId);

      const priorTurns = thread.activeCoachSession?.turns ?? [];
      const nextTurns: CoachTurn[] = [...priorTurns];

      if (options.instruction && options.instruction.trim()) {
        nextTurns.push({
          id: `turn-host-${Date.now()}`,
          sender: 'host',
          text: options.instruction.trim(),
          note: null,
          draft: null,
          editedByUser: false,
          createdAt: new Date().toISOString(),
        });
      }

      // Call the live Express API only when backed by shared Firestore state.
      // In local mode, LocalCohostStore is the single source of truth so edits to
      // rules, pricing, sign-offs, and thread statuses never drift from Express.
      if (typeof fetch === 'function' && store.mode === 'firestore') {
        try {
          const response = await requestCoachTurn({
            propertyId: targetPropertyId,
            threadId,
            instruction: options.instruction,
            refreshBurst: options.refreshBurst,
          });
          if (threadActionEpochRef.current.get(epochKey) !== requestEpoch) {
            return null;
          }
          // Server already persisted response.session to Firestore; update local cache only.
          await store.setThreadCoachSession(targetPropertyId, threadId, response.session, {
            skipRemoteSync: true,
          });
          return response.session;
        } catch (error) {
          if (threadActionEpochRef.current.get(epochKey) !== requestEpoch) {
            return null;
          }
          throw error;
        }
      }

      if (threadActionEpochRef.current.get(epochKey) !== requestEpoch) {
        return null;
      }

      const latest = store.getSnapshot();
      const latestProperty =
        latest.properties.find((p) => p.id === targetPropertyId) ?? property;
      const latestThread =
        (latest.threads[targetPropertyId] ?? []).find((t) => t.id === threadId) ?? thread;

      const fallbackTurn = buildLocalFallbackCoachTurn({
        property: latestProperty,
        thread: latestThread,
        messages: latest.messages[threadId] ?? [],
        rules: latest.rules[targetPropertyId] ?? [],
        voiceProfile: latest.voiceProfile,
        instruction: options.instruction,
      });

      const nextSession: ActiveCoachSession = {
        turns: [...nextTurns, fallbackTurn],
        hasNewGuestMessageSinceEdit: false,
      };
      await store.setThreadCoachSession(targetPropertyId, threadId, nextSession);
      return nextSession;
    },
    [store, bumpThreadEpoch],
  );

  const updateDraftInSession = useCallback(
    async (
      targetPropertyId: string,
      threadId: string,
      turnId: string,
      nextDraftText: string,
    ): Promise<void> => {
      const current = store.getSnapshot();
      const thread = (current.threads[targetPropertyId] ?? []).find((t) => t.id === threadId);
      if (!thread?.activeCoachSession) {
        return;
      }
      const nextSession: ActiveCoachSession = {
        ...thread.activeCoachSession,
        turns: thread.activeCoachSession.turns.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                originalDraft: turn.originalDraft ?? turn.draft,
                draft: nextDraftText,
                editedByUser: true,
              }
            : turn,
        ),
      };
      await store.setThreadCoachSession(targetPropertyId, threadId, nextSession);
    },
    [store],
  );

  const markAsSent = useCallback(
    async (
      targetPropertyId: string,
      threadId: string,
      params: {
        finalText: string;
        originalDraft?: string | null;
        loggedManually?: boolean;
      },
    ): Promise<void> => {
      bumpThreadEpoch(targetPropertyId, threadId);
      const senderName = store.getSnapshot().userProfile.displayName || 'Host';
      await store.markThreadSent(targetPropertyId, threadId, {
        finalText: params.finalText,
        originalDraft: params.originalDraft,
        senderName,
        loggedManually: Boolean(params.loggedManually),
      });

      if (store.mode === 'firestore') {
        try {
          await notifyThreadSent(threadId, {
            propertyId: targetPropertyId,
            finalText: params.finalText,
            originalDraft: params.originalDraft,
            senderName,
            loggedManually: Boolean(params.loggedManually),
          });
        } catch {
          // Handled gracefully by local persistence
        }
      }
    },
    [store, bumpThreadEpoch],
  );

  const dismissAsHandled = useCallback(
    async (targetPropertyId: string, threadId: string): Promise<void> => {
      bumpThreadEpoch(targetPropertyId, threadId);
      await store.dismissThread(targetPropertyId, threadId);
      if (store.mode === 'firestore') {
        try {
          await notifyThreadDismissed(threadId, { propertyId: targetPropertyId });
        } catch {
          // Handled gracefully by local persistence
        }
      }
    },
    [store, bumpThreadEpoch],
  );

  const deleteThread = useCallback(
    async (targetPropertyId: string, threadId: string): Promise<void> => {
      bumpThreadEpoch(targetPropertyId, threadId);
      await store.deleteThread(targetPropertyId, threadId);
      if (store.mode === 'firestore') {
        try {
          await requestDeleteThread(targetPropertyId, threadId);
        } catch {
          // Handled gracefully by local persistence
        }
      }
    },
    [store, bumpThreadEpoch],
  );

  return {
    threads,
    getThreadById,
    getMessagesForThread,
    runCoachTurn,
    updateDraftInSession,
    markAsSent,
    dismissAsHandled,
    deleteThread,
  };
}
