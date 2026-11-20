import { onAuthStateChanged, type User } from 'firebase/auth';
import { ArrowLeft, Lock, LogIn } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BottomNav } from './components/BottomNav.tsx';
import { useProperties } from './hooks/useProperties.ts';
import { useThreads } from './hooks/useThreads.ts';
import {
  getFirebaseServices,
  isFirebaseConfigured,
  signInWithGoogle,
  signOutHost,
} from './services/firebase.ts';
import { getHavenStore, type HavenStore } from './services/havenStore.ts';
import type { HavenAppView } from './types/haven.ts';
import { formatRelativeTime } from './utils/dateFormat.ts';
import { AgentDialogueView } from './views/AgentDialogueView.tsx';
import { GuestThreadView } from './views/GuestThreadView.tsx';
import { MessagesView } from './views/MessagesView.tsx';

export interface AuthSessionIdentity {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

export interface AuthGateState {
  enabled: boolean;
  ready: boolean;
  user: AuthSessionIdentity | null;
  onSignIn?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
}

export interface AppProps {
  store?: HavenStore;
  initialPropertyId?: string;
  initialView?: HavenAppView;
  initialThreadId?: string | null;
  authGate?: AuthGateState;
}

function parseHavenAppView(rawView: unknown): HavenAppView | null {
  if (
    rawView === 'messages' ||
    rawView === 'dialogue' ||
    rawView === 'thread' ||
    rawView === 'house-details' ||
    rawView === 'import' ||
    rawView === 'account'
  ) {
    return rawView;
  }
  return null;
}

function readDeepLinkParams(): {
  propertyId: string | null;
  threadId: string | null;
  view: HavenAppView | null;
} {
  if (typeof window === 'undefined') {
    return { propertyId: null, threadId: null, view: null };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    propertyId: params.get('propertyId'),
    threadId: params.get('threadId'),
    view: parseHavenAppView(params.get('view')),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mapFirebaseUser(user: User | null): AuthSessionIdentity | null {
  if (!user) {
    return null;
  }
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  };
}

export function App({
  store,
  initialPropertyId,
  initialView,
  initialThreadId,
  authGate,
}: AppProps) {
  const activeStore = store ?? getHavenStore();
  const isLiveFirebase = authGate ? authGate.enabled : !store && isFirebaseConfigured();
  const deepLink = useMemo(() => readDeepLinkParams(), []);

  const [liveAuthReady, setLiveAuthReady] = useState(!isLiveFirebase);
  const [liveFirebaseUser, setLiveFirebaseUser] = useState<AuthSessionIdentity | null>(null);

  const [selectedPropertyId, setSelectedPropertyId] = useState<string>(
    initialPropertyId ??
      deepLink.propertyId ??
      activeStore.getSnapshot().properties[0]?.id ??
      '',
  );
  const [activeView, setActiveView] = useState<HavenAppView>(
    initialView ?? deepLink.view ?? (deepLink.threadId ? 'dialogue' : 'messages'),
  );
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialThreadId ?? deepLink.threadId ?? null,
  );
  const [threadReturnTarget, setThreadReturnTarget] = useState<'messages' | 'dialogue'>(
    'messages',
  );

  useEffect(() => {
    if (authGate || !isLiveFirebase) {
      return;
    }
    const services = getFirebaseServices();
    if (!services) {
      setLiveAuthReady(true);
      return;
    }
    return onAuthStateChanged(services.auth, (user) => {
      setLiveFirebaseUser(mapFirebaseUser(user));
      setLiveAuthReady(true);
    });
  }, [authGate, isLiveFirebase]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    const handleSwMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isRecord(data) || data.type !== 'HAVEN_DEEP_LINK') {
        return;
      }
      const targetProp =
        typeof data.propertyId === 'string' && data.propertyId ? data.propertyId : null;
      const targetThread =
        typeof data.threadId === 'string' && data.threadId ? data.threadId : null;
      const targetView = parseHavenAppView(data.view);

      if (targetProp) {
        setSelectedPropertyId(targetProp);
      }
      if (targetThread) {
        setActiveThreadId(targetThread);
      }
      if (targetView) {
        setActiveView(targetView);
      } else if (targetThread) {
        setActiveView('dialogue');
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, []);

  const authReady = authGate ? authGate.ready : liveAuthReady;
  const authUser = authGate ? authGate.user : liveFirebaseUser;
  const handleSignIn = authGate?.onSignIn ?? signInWithGoogle;
  const handleSignOut = authGate?.onSignOut ?? signOutHost;

  const {
    properties,
    activeProperty,
    otherPropertiesUnreadCount,
    unresolvedUnmatched,
    ingestionHealth,
    userProfile,
    allowedEmails,
    assignUnmatched,
  } = useProperties(activeStore, selectedPropertyId);

  const effectivePropertyId = activeProperty?.id ?? selectedPropertyId;

  const {
    threads,
    getThreadById,
    getMessagesForThread,
    runCoachTurn,
    updateDraftInSession,
    markAsSent,
    dismissAsHandled,
  } = useThreads(activeStore, effectivePropertyId);

  const totalWaitingCount = useMemo(
    () =>
      properties.reduce(
        (sum, prop) => sum + prop.needsReplyCount + prop.flaggedCount,
        0,
      ),
    [properties],
  );

  const activeThread = getThreadById(activeThreadId);

  const lastSyncedLabel = ingestionHealth.lastPushAt
    ? `Synced ${formatRelativeTime(ingestionHealth.lastPushAt)}`
    : 'Synced';

  if (isLiveFirebase && (!authReady || (authUser && userProfile.accessStatus === 'checking'))) {
    return (
      <div className="min-h-screen max-w-[420px] mx-auto bg-light-surface border-x border-light-outline-variant flex items-center justify-center p-6 text-body-md text-light-secondary">
        Checking host credentials...
      </div>
    );
  }

  if (isLiveFirebase && !authUser) {
    return (
      <div className="min-h-screen max-w-[420px] mx-auto bg-light-surface border-x border-light-outline-variant flex flex-col items-center justify-center p-6 text-center gap-4">
        <div className="w-12 h-12 rounded-full bg-light-primary text-white flex items-center justify-center font-headline text-xl">
          H
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="font-headline text-headline-md text-light-on-surface">
            Haven Co-Host
          </h1>
          <p className="text-body-md text-light-secondary">
            Sign in with your allowlisted Google account to manage guest replies.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSignIn()}
          className="w-full min-h-[44px] px-4 py-2.5 rounded-md bg-light-primary text-white font-label text-label-md font-semibold flex items-center justify-center gap-2 hover:opacity-95 transition"
        >
          <LogIn className="w-4 h-4" aria-hidden="true" />
          <span>Sign in with Google</span>
        </button>
      </div>
    );
  }

  const normalizedUserEmail = (authUser?.email ?? '').trim().toLowerCase();
  const normalizedAllowlist = allowedEmails
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const isAccessDenied =
    isLiveFirebase &&
    authUser !== null &&
    (!authUser.emailVerified ||
      userProfile.accessStatus === 'denied' ||
      normalizedAllowlist.length === 0 ||
      !normalizedAllowlist.includes(normalizedUserEmail));

  if (isAccessDenied && authUser) {
    return (
      <div className="min-h-screen max-w-[420px] mx-auto bg-light-surface border-x border-light-outline-variant flex flex-col items-center justify-center p-6 text-center gap-4">
        <Lock className="w-8 h-8 text-warning" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h1 className="font-headline text-headline-md text-light-on-surface">
            Access Restricted
          </h1>
          <p className="text-body-md text-light-secondary">
            {!authUser.emailVerified
              ? `${authUser.email ?? 'This account'} requires a verified Google email address to access Haven Co-Host.`
              : `${authUser.email ?? 'This account'} is not on the verified host allowlist for Haven Co-Host.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="min-h-[40px] px-4 py-2 rounded-md border border-light-outline-variant bg-white text-light-on-surface font-label text-label-md font-semibold"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (!activeProperty) {
    return (
      <div className="min-h-screen max-w-[420px] mx-auto bg-light-surface border-x border-light-outline-variant p-6 flex flex-col items-center justify-center text-center gap-2 text-light-secondary">
        <p className="font-headline text-headline-sm text-light-on-surface">
          No properties configured yet
        </p>
        <p className="text-body-sm">
          Add a property document in Firestore to start receiving guest threads.
        </p>
      </div>
    );
  }

  const showBottomNav =
    activeView === 'messages' ||
    activeView === 'house-details' ||
    activeView === 'account';

  return (
    <div className="min-h-screen flex flex-col max-w-[420px] mx-auto bg-light-surface border-x border-light-outline-variant relative">
      {activeView === 'messages' && (
        <MessagesView
          properties={properties}
          activeProperty={activeProperty}
          otherPropertiesUnreadCount={otherPropertiesUnreadCount}
          threads={threads}
          getMessagesForThread={getMessagesForThread}
          unresolvedUnmatched={unresolvedUnmatched}
          lastSyncedLabel={lastSyncedLabel}
          onSelectProperty={(nextPropId) => {
            setSelectedPropertyId(nextPropId);
            setActiveThreadId(null);
          }}
          onOpenDialogue={(threadId) => {
            setActiveThreadId(threadId);
            setActiveView('dialogue');
          }}
          onOpenThread={(threadId) => {
            setActiveThreadId(threadId);
            setThreadReturnTarget('messages');
            setActiveView('thread');
          }}
          onDismissThread={(threadId) => dismissAsHandled(effectivePropertyId, threadId)}
          onAssignUnmatched={async (unmatchedId, targetPropertyId) => {
            await assignUnmatched(unmatchedId, targetPropertyId);
            setSelectedPropertyId(targetPropertyId);
          }}
        />
      )}

      {activeView === 'dialogue' && activeThread && (
        <AgentDialogueView
          property={activeProperty}
          thread={activeThread}
          messages={getMessagesForThread(activeThread.id)}
          onBack={() => setActiveView('messages')}
          onOpenThread={() => {
            setThreadReturnTarget('dialogue');
            setActiveView('thread');
          }}
          onCoachTurn={async (options) => {
            await runCoachTurn(effectivePropertyId, activeThread.id, options);
          }}
          onUpdateDraftEdit={(turnId, nextDraft) =>
            updateDraftInSession(effectivePropertyId, activeThread.id, turnId, nextDraft)
          }
          onMarkSent={async ({ finalText, originalDraft }) => {
            await markAsSent(effectivePropertyId, activeThread.id, {
              finalText,
              originalDraft,
              loggedManually: false,
            });
            setActiveView('messages');
          }}
          onDismiss={async () => {
            await dismissAsHandled(effectivePropertyId, activeThread.id);
            setActiveView('messages');
          }}
        />
      )}

      {activeView === 'thread' && activeThread && (
        <GuestThreadView
          property={activeProperty}
          thread={activeThread}
          messages={getMessagesForThread(activeThread.id)}
          returnTarget={threadReturnTarget}
          onBack={() => setActiveView(threadReturnTarget)}
          onOpenDialogue={() => setActiveView('dialogue')}
          onLogManualReply={async (replyText) => {
            await markAsSent(effectivePropertyId, activeThread.id, {
              finalText: replyText,
              loggedManually: true,
            });
          }}
        />
      )}

      {(activeView === 'dialogue' || activeView === 'thread') && !activeThread && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
          <p className="font-headline text-headline-sm text-light-on-surface">
            Conversation unavailable
          </p>
          <p className="text-body-sm text-light-secondary">
            This thread may still be syncing or belongs to another property.
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveThreadId(null);
              setActiveView('messages');
            }}
            className="min-h-[40px] px-4 py-2 rounded-md bg-light-primary text-white font-label text-label-md font-semibold flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Back to Messages</span>
          </button>
        </div>
      )}

      {(activeView === 'house-details' || activeView === 'import' || activeView === 'account') && (
        <div className="flex-1 p-6 pb-24 text-body-md text-light-secondary">
          Stage 3 views pending.
        </div>
      )}

      {showBottomNav && (
        <BottomNav
          activeView={activeView}
          totalWaitingCount={totalWaitingCount}
          onNavigate={(nextTab) => setActiveView(nextTab)}
        />
      )}
    </div>
  );
}
