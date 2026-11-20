import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/ui/BottomSheet.tsx';
import type { GuestThread, Property, ThreadMessage } from '../types/haven.ts';
import { formatRelativeTime, formatShortClock } from '../utils/dateFormat.ts';
import { getPropertyTheme } from '../utils/propertyHelpers.ts';

export interface GuestThreadViewProps {
  property: Property;
  thread: GuestThread;
  messages: readonly ThreadMessage[];
  returnTarget: 'messages' | 'dialogue';
  onBack: () => void;
  onOpenDialogue: () => void;
  onLogManualReply: (replyText: string) => Promise<void>;
}

export function GuestThreadView({
  property,
  thread,
  messages,
  returnTarget,
  onBack,
  onOpenDialogue,
  onLogManualReply,
}: GuestThreadViewProps) {
  const [expandedNotesMessageId, setExpandedNotesMessageId] = useState<string | null>(null);
  const [isManualReplyOpen, setIsManualReplyOpen] = useState(false);
  const [manualReplyText, setManualReplyText] = useState('');
  const [isSavingManual, setIsSavingManual] = useState(false);

  const theme = getPropertyTheme(property.code);
  const hasActiveDraft = Boolean(thread.activeCoachSession?.turns.length);

  const handleManualSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = manualReplyText.trim();
    if (!trimmed || isSavingManual) {
      return;
    }
    setIsSavingManual(true);
    try {
      await onLogManualReply(trimmed);
      setManualReplyText('');
      setIsManualReplyOpen(false);
    } finally {
      setIsSavingManual(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 pb-32">
      <header className="px-4 py-3 border-b border-light-outline-variant bg-light-surface sticky top-0 z-20 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label={returnTarget === 'dialogue' ? 'Back to Agent Dialogue' : 'Back to Messages'}
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
            {property.name} · Full Guest Thread
          </p>
        </div>
      </header>

      <main className="px-4 py-3.5 flex flex-col gap-3.5 flex-1">
        <div className="text-center">
          <span className="inline-block px-3 py-1 rounded-full bg-light-surface-container text-light-secondary text-[11px] font-code">
            {thread.stage.toUpperCase()}
            {thread.stayDates ? ` · ${thread.stayDates}` : ''}
            {thread.nights ? ` (${thread.nights} nights)` : ''}
          </span>
        </div>

        {messages.map((msg) => {
          const isHost = msg.sender === 'host';
          const hasNotes = msg.archivedCoachNotes.length > 0;
          const isNotesExpanded = expandedNotesMessageId === msg.id;

          return (
            <div
              key={msg.id}
              className={`flex flex-col gap-1 max-w-[88%] ${isHost ? 'self-end' : 'self-start'}`}
            >
              <div
                className={`flex items-center gap-1.5 text-[11px] font-code text-light-secondary ${
                  isHost ? 'justify-end pr-1' : 'pl-1'
                }`}
              >
                <span className="font-medium text-light-on-surface">{msg.senderName}</span>
                <span>
                  {formatRelativeTime(msg.sentAt)} · {formatShortClock(msg.sentAt)}
                </span>
              </div>

              <div
                className={`p-3 rounded-2xl text-body-md whitespace-pre-line ${
                  isHost
                    ? `${theme.bubbleBg} border ${theme.bubbleBorder} ${theme.bubbleText} rounded-tr-sm`
                    : msg.unanswered
                      ? `bg-white border-2 ${theme.cardBorder} text-light-on-surface rounded-tl-sm`
                      : 'bg-white border border-light-outline-variant text-light-on-surface rounded-tl-sm'
                }`}
              >
                {msg.body}
              </div>

              {hasNotes && (
                <div className={isHost ? 'self-end' : 'self-start'}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedNotesMessageId(isNotesExpanded ? null : msg.id)
                    }
                    aria-expanded={isNotesExpanded}
                    className="text-[11px] font-label font-semibold text-light-secondary hover:text-light-on-surface flex items-center gap-1 px-1 py-0.5"
                  >
                    <span>Coaching notes ({msg.archivedCoachNotes.length})</span>
                    {isNotesExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </button>
                  {isNotesExpanded && (
                    <ul className="mt-1 p-2.5 rounded-md bg-stone-100 border border-light-outline-variant text-[12px] text-slate-700 flex flex-col gap-1">
                      {msg.archivedCoachNotes.map((note, idx) => (
                        <li key={idx}>• {note}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </main>

      <div className="fixed bottom-0 left-0 right-0 max-w-[420px] mx-auto bg-white/95 backdrop-blur-sm border-t border-light-outline-variant p-3 flex flex-col gap-2 z-30">
        <button
          type="button"
          onClick={onOpenDialogue}
          className="w-full min-h-[42px] px-4 py-2 rounded-md bg-light-primary text-white font-label text-label-md font-semibold flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.99] transition"
        >
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          <span>{hasActiveDraft ? 'Return to In-Progress Draft' : 'Open Agent Dialogue'}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsManualReplyOpen(true)}
          className="w-full min-h-[38px] px-4 py-1.5 rounded-md bg-white border border-light-outline-variant text-light-on-surface hover:bg-stone-50 font-label text-label-md font-semibold flex items-center justify-center gap-1.5 transition"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Log manual reply</span>
        </button>
      </div>

      <BottomSheet
        isOpen={isManualReplyOpen}
        title="Log Manual Reply"
        subtitle={`Record a reply sent natively in Airbnb for ${thread.guestName}`}
        onClose={() => setIsManualReplyOpen(false)}
      >
        <form onSubmit={(event) => void handleManualSubmit(event)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="manual-reply-textarea"
              className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
            >
              Message Sent to Guest
            </label>
            <textarea
              id="manual-reply-textarea"
              rows={4}
              value={manualReplyText}
              onChange={(event) => setManualReplyText(event.target.value)}
              placeholder="Paste or type what you replied on Airbnb..."
              className="w-full p-3 bg-white border border-light-outline-variant rounded-md text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => setIsManualReplyOpen(false)}
              className="flex-1 min-h-[42px] rounded-md border border-light-outline-variant bg-white font-label text-label-md font-semibold text-light-secondary hover:bg-stone-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={manualReplyText.trim().length === 0 || isSavingManual}
              className="flex-1 min-h-[42px] rounded-md bg-light-primary text-white font-label text-label-md font-semibold disabled:opacity-40 transition"
            >
              Save to Thread
            </button>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}
