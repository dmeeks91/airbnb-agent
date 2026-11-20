import {
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Send,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PayoutWarningBanner } from '../components/PayoutWarningBanner.tsx';
import type { GuestThread, Property, ThreadMessage } from '../types/cohost.ts';
import { formatShortClock } from '../utils/dateFormat.ts';
import { getPropertyTheme } from '../utils/propertyHelpers.ts';

export interface AgentDialogueViewProps {
  property: Property;
  thread: GuestThread;
  messages: readonly ThreadMessage[];
  onBack: () => void;
  onOpenThread: () => void;
  onCoachTurn: (options?: { instruction?: string; refreshBurst?: boolean }) => Promise<void>;
  onUpdateDraftEdit: (turnId: string, nextDraft: string) => Promise<void>;
  onMarkSent: (params: { finalText: string; originalDraft: string | null }) => Promise<void>;
  onDismiss: () => Promise<void>;
}

export function AgentDialogueView({
  property,
  thread,
  messages,
  onBack,
  onOpenThread,
  onCoachTurn,
  onUpdateDraftEdit,
  onMarkSent,
  onDismiss,
}: AgentDialogueViewProps) {
  const [isBurstExpanded, setIsBurstExpanded] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [coachInput, setCoachInput] = useState('');
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const initiatedTurn1ForThreadRef = useRef<string | null>(null);

  const theme = getPropertyTheme(property.code);

  const unansweredBurst = useMemo(
    () => messages.filter((msg) => msg.sender === 'guest' && msg.unanswered),
    [messages],
  );

  const turns = thread.activeCoachSession?.turns ?? [];

  // Lazy Turn 1 drafting on first open when no active coaching session exists
  useEffect(() => {
    const shouldGenerateTurn1 =
      !thread.activeCoachSession &&
      (thread.status === 'needs_reply' || thread.status === 'flagged') &&
      initiatedTurn1ForThreadRef.current !== thread.id;

    if (!shouldGenerateTurn1) {
      return;
    }

    initiatedTurn1ForThreadRef.current = thread.id;
    let cancelled = false;
    setDraftError(null);
    setIsGenerating(true);

    void onCoachTurn({})
      .catch(() => {
        if (!cancelled) {
          setDraftError('Could not generate the initial draft. Tap retry to try again.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsGenerating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [thread.id, thread.activeCoachSession, thread.status, onCoachTurn]);

  const handleRetryDraft = async () => {
    if (isGenerating) {
      return;
    }
    setDraftError(null);
    setIsGenerating(true);
    try {
      await onCoachTurn({});
    } catch {
      setDraftError('Could not generate the initial draft. Tap retry to try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCoachSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = coachInput.trim();
    if (!trimmed || isGenerating) {
      return;
    }
    setCoachInput('');
    setDraftError(null);
    setIsGenerating(true);
    try {
      await onCoachTurn({ instruction: trimmed });
    } catch {
      setDraftError('Could not update draft with your note. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRefreshBurst = async () => {
    if (isGenerating) {
      return;
    }
    setDraftError(null);
    setIsGenerating(true);
    try {
      await onCoachTurn({ refreshBurst: true });
    } catch {
      setDraftError('Could not refresh draft for the new message. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartEdit = (turnId: string) => {
    setEditingTurnId(turnId);
  };

  const handleCopyAndOpenAirbnb = async (turnId: string, draftText: string) => {
    try {
      await navigator.clipboard?.writeText(draftText);
    } catch {
      // Clipboard API may be unavailable in restricted contexts
    }
    setCopiedTurnId(turnId);
    setTimeout(() => {
      setCopiedTurnId((prev) => (prev === turnId ? null : prev));
    }, 2000);

    if (typeof window !== 'undefined') {
      const targetUrl = thread.airbnbThreadUrl ?? 'https://www.airbnb.com/hosting/inbox';
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleMarkTurnSent = async (originalDraft: string | null, finalText: string) => {
    if (isSubmittingAction) {
      return;
    }
    setIsSubmittingAction(true);
    try {
      await onMarkSent({
        finalText,
        originalDraft,
      });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleDismiss = async () => {
    if (isSubmittingAction) {
      return;
    }
    setIsSubmittingAction(true);
    try {
      await onDismiss();
    } finally {
      setIsSubmittingAction(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 pb-24">
      <header className="px-4 py-3 border-b border-light-outline-variant bg-light-surface sticky top-0 z-20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Messages"
            className="w-9 h-9 rounded-full bg-light-surface-container-low border border-light-outline-variant flex items-center justify-center text-light-on-surface hover:bg-light-surface-container transition shrink-0"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="font-headline text-headline-sm text-light-on-surface leading-tight truncate">
              {thread.guestName}
              {thread.stayDates ? ` (${thread.stayDates})` : ''}
            </h1>
            <p className={`text-body-sm font-label font-semibold truncate ${theme.text}`}>
              {property.name} · Draft &amp; Coach
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenThread}
          className="min-h-[36px] px-2.5 py-1 rounded-md border border-light-outline-variant bg-white text-label-sm font-semibold text-light-secondary hover:text-light-on-surface flex items-center gap-1 shrink-0 transition"
        >
          <MessageSquareText className="w-3.5 h-3.5" aria-hidden="true" />
          <span>View thread</span>
        </button>
      </header>

      <div className="px-4 py-2 bg-light-surface-container-low/70 border-b border-light-outline-variant flex items-center justify-between gap-2 text-body-sm">
        <span className="text-light-secondary capitalize">
          Stage: <strong className="text-light-on-surface">{thread.stage}</strong>
          {thread.stage === 'inquiry' && ' · Access codes withheld'}
        </span>
        <button
          type="button"
          disabled={isSubmittingAction}
          onClick={() => void handleDismiss()}
          className="text-label-sm font-semibold text-light-outline hover:text-light-on-surface underline-offset-2 hover:underline disabled:opacity-40 transition shrink-0"
        >
          Already handled on Airbnb
        </button>
      </div>

      {thread.discountAlert && (
        <PayoutWarningBanner
          key={thread.id}
          alert={thread.discountAlert}
          pricing={property.pricing}
        />
      )}

      <section
        aria-label="Pinned guest messages"
        className="bg-stone-100/70 border-b border-light-outline-variant px-4 py-3 flex flex-col gap-2"
      >
        <button
          type="button"
          onClick={() => setIsBurstExpanded((prev) => !prev)}
          aria-expanded={isBurstExpanded}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="text-[11px] font-label font-semibold text-light-secondary uppercase tracking-wider">
            Unanswered Guest Burst ({unansweredBurst.length || 1})
          </span>
          <span className="flex items-center gap-1 text-label-sm text-light-secondary">
            <span>{isBurstExpanded ? 'Hide' : 'Show'}</span>
            {isBurstExpanded ? (
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            )}
          </span>
        </button>

        {isBurstExpanded && (
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto overscroll-contain">
            {unansweredBurst.length > 0 ? (
              unansweredBurst.map((msg) => (
                <div
                  key={msg.id}
                  className="bg-white border border-light-outline-variant rounded-xl rounded-tl-sm p-2.5 text-body-sm text-light-on-surface flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between text-[11px] font-code text-light-secondary">
                    <span className="font-medium text-light-on-surface">{msg.senderName}</span>
                    <span>{formatShortClock(msg.sentAt)}</span>
                  </div>
                  <p>{msg.body}</p>
                </div>
              ))
            ) : (
              <div className="bg-white border border-light-outline-variant rounded-xl rounded-tl-sm p-2.5 text-body-sm text-light-on-surface">
                {thread.lastPreview}
              </div>
            )}
          </div>
        )}
      </section>

      {thread.activeCoachSession?.hasNewGuestMessageSinceEdit && (
        <div className="mx-4 mt-3 px-3 py-2.5 rounded-lg bg-info-surface border border-blue-200 flex items-center justify-between gap-2">
          <span className="text-body-sm font-medium text-info">
            New guest message arrived
          </span>
          <button
            type="button"
            onClick={() => void handleRefreshBurst()}
            className="min-h-[34px] px-2.5 py-1 rounded-md bg-white border border-blue-300 text-label-sm font-semibold text-info flex items-center gap-1 hover:bg-blue-50 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Refresh draft</span>
          </button>
        </div>
      )}

      <main className="px-4 py-4 flex flex-col gap-4 flex-1">
        {draftError && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-warning-surface border border-amber-300 flex items-center justify-between gap-2 text-body-sm text-amber-950"
          >
            <span>{draftError}</span>
            <button
              type="button"
              onClick={() => void handleRetryDraft()}
              className="min-h-[34px] px-2.5 py-1 rounded-md bg-white border border-amber-300 text-label-sm font-semibold text-warning shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {isGenerating && turns.length === 0 && (
          <div
            aria-label="Drafting reply"
            className="p-4 rounded-2xl bg-white border border-light-outline-variant flex flex-col gap-2.5 animate-pulse"
          >
            <div className="h-3.5 w-36 bg-stone-200 rounded" />
            <div className="h-3 w-full bg-stone-200 rounded" />
            <div className="h-3 w-5/6 bg-stone-200 rounded" />
            <div className="h-10 w-full bg-stone-100 rounded-md mt-2" />
          </div>
        )}

        {!isGenerating && turns.length === 0 && !draftError && (
          <div className="p-4 rounded-xl bg-white border border-light-outline-variant text-body-sm text-light-secondary">
            This conversation is marked {thread.status === 'dismissed' ? 'handled' : 'sent'}. Type a coaching note below if you want to draft a follow-up.
          </div>
        )}

        {turns.map((turn, idx) => {
          if (turn.sender === 'host') {
            return (
              <div key={turn.id} className="flex flex-col gap-1 max-w-[85%] self-end">
                <span className="text-[11px] font-code text-light-secondary text-right pr-1">
                  You · {formatShortClock(turn.createdAt)}
                </span>
                <div className="bg-light-primary text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-body-md">
                  {turn.text}
                </div>
              </div>
            );
          }

          const isEditing = editingTurnId === turn.id;
          const isCopied = copiedTurnId === turn.id;

          return (
            <div key={turn.id} className="flex flex-col gap-1.5 max-w-[96%]">
              <div className="flex items-center gap-1.5 text-[11px] font-label font-semibold pl-1">
                <span className={`w-2 h-2 rounded-full ${theme.dotBg}`} aria-hidden="true" />
                <span className={theme.text}>Guest Co-Host Agent</span>
                <span className="font-code font-normal text-light-secondary">
                  Turn {idx + 1} · {formatShortClock(turn.createdAt)}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl rounded-tl-sm bg-white border border-light-outline-variant flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-body-md text-light-on-surface">{turn.text}</p>
                  {turn.note && (
                    <p className="text-body-sm text-light-secondary">{turn.note}</p>
                  )}
                </div>

                {turn.draft !== null && (
                  <div
                    className={`p-3 rounded-lg border flex flex-col gap-2.5 ${theme.softBg} ${theme.softBorder}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-label-sm font-semibold uppercase tracking-wider ${theme.text}`}>
                        {turn.editedByUser ? 'Edited Draft Reply' : 'Ready Draft Reply'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          isEditing
                            ? setEditingTurnId(null)
                            : handleStartEdit(turn.id)
                        }
                        className="min-h-[32px] px-2 rounded text-label-sm font-semibold text-light-on-surface hover:bg-white/70 flex items-center gap-1 transition"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{isEditing ? 'Done' : 'Edit'}</span>
                      </button>
                    </div>

                    {isEditing ? (
                      <textarea
                        aria-label="Edit draft reply"
                        value={turn.draft}
                        onChange={(event) =>
                          void onUpdateDraftEdit(turn.id, event.target.value)
                        }
                        rows={5}
                        placeholder="Edit your guest reply..."
                        className="w-full p-2.5 bg-white border border-light-outline-variant rounded-md text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20 resize-y"
                      />
                    ) : (
                      <p className="text-body-md text-slate-900 whitespace-pre-line">
                        {turn.draft}
                      </p>
                    )}

                    <div className="flex flex-col gap-2 pt-2 border-t border-black/10">
                      <button
                        type="button"
                        onClick={() => void handleCopyAndOpenAirbnb(turn.id, turn.draft ?? '')}
                        className="w-full min-h-[42px] px-3 py-2 rounded-md bg-light-primary text-white font-label text-label-md font-semibold flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.99] transition"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-4 h-4" aria-hidden="true" />
                            <span>Copied · Opening Airbnb</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" aria-hidden="true" />
                            <span>Copy &amp; Open Airbnb</span>
                            <ExternalLink className="w-3.5 h-3.5 opacity-80" aria-hidden="true" />
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={isSubmittingAction}
                        onClick={() =>
                          void handleMarkTurnSent(
                            turn.originalDraft ?? null,
                            turn.draft ?? '',
                          )
                        }
                        className="w-full min-h-[40px] px-3 py-2 rounded-md bg-white border border-light-outline-variant text-light-on-surface hover:bg-stone-50 disabled:opacity-40 font-label text-label-md font-semibold flex items-center justify-center gap-1.5 transition"
                      >
                        <CheckCheck className="w-4 h-4 text-success" aria-hidden="true" />
                        <span>Mark as Sent</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isGenerating && turns.length > 0 && (
          <div className="flex items-center gap-2 text-body-sm text-light-secondary pl-1">
            <Send className="w-3.5 h-3.5 animate-pulse" aria-hidden="true" />
            <span>Updating draft with your coaching note...</span>
          </div>
        )}
      </main>

      <form
        onSubmit={(event) => void handleCoachSubmit(event)}
        className="fixed bottom-0 left-0 right-0 max-w-[420px] mx-auto bg-white border-t border-light-outline-variant p-3 flex items-center gap-2 z-30"
      >
        <input
          type="text"
          value={coachInput}
          onChange={(event) => setCoachInput(event.target.value)}
          placeholder="Tell AI how to refine draft..."
          aria-label="Tell AI how to refine draft"
          className="flex-1 min-h-[42px] py-2 px-3.5 bg-white border border-light-outline-variant rounded-full text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-1 focus:ring-light-primary transition"
        />
        <button
          type="submit"
          disabled={coachInput.trim().length === 0 || isGenerating}
          aria-label="Send coaching instruction"
          className="w-10 h-10 rounded-full bg-light-primary text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition shrink-0"
        >
          <ArrowUp className="w-4 h-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
