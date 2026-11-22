import {
  AlertTriangle,
  CalendarCheck,
  CalendarX,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  MessageSquareText,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { PropertySwitcher } from '../components/PropertySwitcher.tsx';
import { SearchInput } from '../components/ui/SearchInput.tsx';
import { SelectPopover, type SelectOption } from '../components/ui/SelectPopover.tsx';
import type {
  GuestStage,
  GuestThread,
  Property,
  ThreadMessage,
  UnmatchedEmail,
} from '../types/cohost.ts';
import { formatRelativeTime, formatShortClock } from '../utils/dateFormat.ts';
import { recalculateDiscountAlert } from '../utils/payoutHelpers.ts';
import { getPropertyDisplayLabel, getPropertyTheme } from '../utils/propertyHelpers.ts';

type StatusFilter = 'all' | 'needs_reply' | 'flagged' | 'sent';
type StageFilter = 'all' | GuestStage;

const INQUIRY_URGENCY_THRESHOLD_MS = 12 * 60 * 60 * 1000;

function isThreadUrgent(thread: GuestThread, nowMs: number): boolean {
  if (thread.stage !== 'inquiry') {
    return false;
  }
  const msgMs = Date.parse(thread.lastMessageAt);
  if (Number.isNaN(msgMs)) {
    return false;
  }
  return nowMs - msgMs >= INQUIRY_URGENCY_THRESHOLD_MS;
}

export interface MessagesViewProps {
  properties: readonly Property[];
  activeProperty: Property;
  otherPropertiesUnreadCount: number;
  threads: readonly GuestThread[];
  getMessagesForThread: (threadId: string) => readonly ThreadMessage[];
  unresolvedUnmatched: readonly UnmatchedEmail[];
  lastSyncedLabel: string;
  onSelectProperty: (propertyId: string) => void;
  onAddProperty: () => void;
  onReorderProperties: (orderedIds: readonly string[]) => Promise<void>;
  onOpenDialogue: (threadId: string) => void;
  onOpenThread: (threadId: string) => void;
  onDismissThread: (threadId: string) => Promise<void>;
  onAssignUnmatched: (unmatchedId: string, propertyId: string) => Promise<void>;
  onDeleteUnmatched: (unmatchedId: string) => Promise<void>;
}

const DELETE_UNMATCHED_OPTION_VALUE = '__delete_unmatched__';

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs_reply', label: 'Needs Reply' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'sent', label: 'Sent' },
];

const STAGE_OPTIONS: readonly { value: StageFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'inquiry', label: 'Inquiry' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'current', label: 'Current Guest' },
];

export function MessagesView({
  properties,
  activeProperty,
  otherPropertiesUnreadCount,
  threads,
  getMessagesForThread,
  unresolvedUnmatched,
  lastSyncedLabel,
  onSelectProperty,
  onAddProperty,
  onReorderProperties,
  onOpenDialogue,
  onOpenThread,
  onDismissThread,
  onAssignUnmatched,
  onDeleteUnmatched,
}: MessagesViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [dismissedUnmatchedKey, setDismissedUnmatchedKey] = useState<string | null>(null);
  const [expandedUnmatchedId, setExpandedUnmatchedId] = useState<string | null>(null);
  const [renderNowMs] = useState(() => Date.now());

  const theme = getPropertyTheme(activeProperty.code);

  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) + (stageFilter !== 'all' ? 1 : 0);

  const filteredThreads = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return threads.filter((thread) => {
      if (statusFilter === 'needs_reply') {
        if (thread.status !== 'needs_reply' && thread.status !== 'flagged') {
          return false;
        }
      } else if (statusFilter === 'flagged') {
        if (thread.status !== 'flagged') {
          return false;
        }
      } else if (statusFilter === 'sent') {
        if (thread.status !== 'sent' && thread.status !== 'dismissed') {
          return false;
        }
      }

      if (stageFilter !== 'all' && thread.stage !== stageFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const threadMessages = getMessagesForThread(thread.id);
      const haystack = [
        thread.guestName,
        thread.stayDates ?? '',
        thread.lastPreview,
        thread.lastSentPreview ?? '',
        ...threadMessages.map((m) => m.body),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [threads, statusFilter, stageFilter, searchTerm, getMessagesForThread]);

  const activeQueueThreads = useMemo(
    () =>
      filteredThreads.filter((t) => t.status === 'flagged' || t.status === 'needs_reply'),
    [filteredThreads],
  );

  const resolvedThreads = useMemo(
    () => filteredThreads.filter((t) => t.status === 'sent' || t.status === 'dismissed'),
    [filteredThreads],
  );

  const unmatchedKey = useMemo(
    () => unresolvedUnmatched.map((item) => item.id).join('|'),
    [unresolvedUnmatched],
  );
  const showUnmatchedBanner =
    unresolvedUnmatched.length > 0 && dismissedUnmatchedKey !== unmatchedKey;

  const unmatchedActionOptions = useMemo<SelectOption<string>[]>(
    () => [
      ...properties.map((property) => ({
        value: property.id,
        label: property.name,
        swatchColor: property.accentColor,
      })),
      {
        value: DELETE_UNMATCHED_OPTION_VALUE,
        label: 'Delete message',
        tone: 'danger',
        dividerBefore: properties.length > 0,
        icon: <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
      },
    ],
    [properties],
  );

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setStageFilter('all');
  };

  return (
    <div className="flex flex-col flex-1 pb-24">
      <header className="px-4 py-3 border-b border-light-outline-variant bg-light-surface sticky top-0 z-20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/icon-192.png"
            alt=""
            aria-hidden="true"
            className="w-8 h-8 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h1 className="font-headline text-headline-sm text-light-on-surface leading-tight">
              Guest Co-Host
            </h1>
            <div className="flex items-center gap-1.5 text-body-sm text-light-secondary truncate">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${theme.dotBg}`}
                aria-hidden="true"
              />
              <span className={`font-label text-label-sm font-semibold truncate ${theme.text}`}>
                {getPropertyDisplayLabel(activeProperty)}
              </span>
              <span className="text-light-outline">·</span>
              <span className="font-code text-[11px] text-light-secondary shrink-0">
                {lastSyncedLabel}
              </span>
            </div>
          </div>
        </div>

        <PropertySwitcher
          properties={properties}
          activePropertyId={activeProperty.id}
          otherPropertiesUnreadCount={otherPropertiesUnreadCount}
          onSelectProperty={onSelectProperty}
          onAddProperty={onAddProperty}
          onReorderProperties={onReorderProperties}
        />
      </header>

      <div className="px-4 pt-2.5 pb-2 bg-light-surface sticky top-[61px] z-10 border-b border-light-outline-variant/50">
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search guests, messages, or topics..."
          rightSlot={
            <button
              type="button"
              onClick={() => setIsFilterOpen((prev) => !prev)}
              aria-expanded={isFilterOpen}
              aria-controls="messages-filter-popover"
              className={`min-h-[32px] px-2.5 py-1 rounded-full border text-label-sm font-semibold flex items-center gap-1 transition ${
                activeFilterCount > 0 || isFilterOpen
                  ? 'bg-light-primary text-white border-light-primary'
                  : 'bg-stone-50 text-slate-700 border-light-outline-variant hover:border-light-primary'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Filter</span>
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-white text-light-primary text-[10px] font-code font-bold inline-flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  isFilterOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>
          }
        />

        {isFilterOpen && (
          <div
            id="messages-filter-popover"
            className="mt-2 p-3 bg-white rounded-lg border border-light-outline-variant flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-label text-light-secondary uppercase tracking-wider font-semibold">
                Message Status
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {STATUS_OPTIONS.map((option) => {
                  const isActive = statusFilter === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStatusFilter(option.value)}
                      aria-pressed={isActive}
                      className={`px-2.5 py-1 rounded-full text-label-sm font-semibold border transition ${
                        isActive
                          ? 'bg-light-primary text-white border-light-primary'
                          : 'bg-white text-light-secondary border-light-outline-variant hover:border-light-primary'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 pt-2 border-t border-light-outline-variant/60">
              <span className="text-[10px] font-label text-light-secondary uppercase tracking-wider font-semibold">
                Guest Stage
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {STAGE_OPTIONS.map((option) => {
                  const isActive = stageFilter === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStageFilter(option.value)}
                      aria-pressed={isActive}
                      className={`px-2.5 py-1 rounded-full text-label-sm font-semibold border transition ${
                        isActive
                          ? 'bg-light-primary text-white border-light-primary'
                          : 'bg-white text-light-secondary border-light-outline-variant hover:border-light-primary'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <main className="px-4 py-3 flex flex-col gap-3.5 flex-1 min-w-0">
        {showUnmatchedBanner && (
          <section
            aria-label="Unmatched incoming emails"
            className="bg-warning-surface border border-amber-300 rounded-lg p-3.5 flex flex-col gap-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle
                  className="w-4 h-4 text-warning shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <h2 className="font-label text-label-md font-semibold text-warning">
                    {unresolvedUnmatched.length} Unmatched Airbnb{' '}
                    {unresolvedUnmatched.length === 1 ? 'Message' : 'Messages'}
                  </h2>
                  <p className="text-body-sm text-amber-950">
                    Assign to a property or delete non-guest notices.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDismissedUnmatchedKey(unmatchedKey)}
                aria-label="Hide unmatched banner"
                className="w-7 h-7 rounded-full text-amber-900 hover:bg-amber-200/70 flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto overscroll-contain">
              {unresolvedUnmatched.map((item) => {
                const isExpanded = expandedUnmatchedId === item.id;
                const fullBody = item.rawParsed.bodyText.trim() || item.bodyPreview;
                const airbnbUrl =
                  item.rawParsed.airbnbThreadUrl ?? item.rawParsed.allAirbnbUrls[0] ?? null;

                return (
                  <div
                    key={item.id}
                    className="bg-white rounded-md border border-amber-200 p-2.5 flex flex-col gap-2 min-w-0"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedUnmatchedId((prev) => (prev === item.id ? null : item.id))
                      }
                      aria-expanded={isExpanded}
                      className="w-full text-left flex flex-col gap-1 min-w-0"
                    >
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <p
                          className={`font-label text-label-md font-semibold text-slate-900 ${
                            isExpanded
                              ? 'leading-snug break-words [overflow-wrap:anywhere]'
                              : 'truncate'
                          }`}
                        >
                          {item.guestName} · {item.subject}
                        </p>
                        <span className="text-[11px] font-label font-semibold text-warning inline-flex items-center gap-0.5 shrink-0 pt-0.5">
                          <span>{isExpanded ? 'Hide' : 'Full'}</span>
                          <ChevronDown
                            className={`w-3.5 h-3.5 transition-transform ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                            aria-hidden="true"
                          />
                        </span>
                      </div>
                      {!isExpanded && (
                        <p className="text-body-sm text-slate-600 line-clamp-2 break-words [overflow-wrap:anywhere]">
                          &ldquo;{item.bodyPreview}&rdquo;
                        </p>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="flex flex-col gap-1.5 min-w-0">
                        <div className="p-2.5 rounded-md bg-stone-50 border border-stone-200 max-h-48 overflow-y-auto overscroll-contain text-body-sm text-slate-800 whitespace-pre-line break-words [overflow-wrap:anywhere] leading-relaxed">
                          {fullBody}
                        </div>
                        {airbnbUrl && (
                          <div className="flex items-center justify-end">
                            <a
                              href={airbnbUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex items-center gap-1 text-[11px] font-label font-semibold hover:underline ${theme.text}`}
                            >
                              <span>Open on Airbnb</span>
                              <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    <SelectPopover
                      value=""
                      options={unmatchedActionOptions}
                      placeholder="Assign or delete..."
                      label={`Assign or delete ${item.subject}`}
                      anchorMode="anchored"
                      compact
                      onChange={(selectedValue) => {
                        if (selectedValue === DELETE_UNMATCHED_OPTION_VALUE) {
                          setExpandedUnmatchedId((prev) => (prev === item.id ? null : prev));
                          void onDeleteUnmatched(item.id);
                        } else if (selectedValue) {
                          setExpandedUnmatchedId((prev) => (prev === item.id ? null : prev));
                          void onAssignUnmatched(item.id, selectedValue);
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {activeQueueThreads.map((thread) => {
          const unanswered = getMessagesForThread(thread.id).filter(
            (msg) => msg.sender === 'guest' && msg.unanswered,
          );
          const liveDiscountAlert = thread.discountAlert
            ? recalculateDiscountAlert(thread.discountAlert, activeProperty.pricing)
            : null;
          const isFlagged = thread.status === 'flagged';
          const isUrgent = isThreadUrgent(thread, renderNowMs);
          const defaultPayout = liveDiscountAlert
            ? liveDiscountAlert.defaultAssumption === 'all_in'
              ? liveDiscountAlert.allIn
              : liveDiscountAlert.roomOnly
            : null;

          return (
            <article
              key={thread.id}
              className={`bg-white rounded-lg border relative overflow-hidden flex flex-col ${
                isFlagged
                  ? 'border-2 border-warning/70'
                  : `${theme.cardBorder} ring-1 ${theme.ring}`
              }`}
            >
              <div
                className={`absolute top-0 left-0 bottom-0 w-1.5 ${theme.accentBar}`}
                aria-hidden="true"
              />

              <button
                type="button"
                onClick={() => onOpenDialogue(thread.id)}
                className="w-full text-left p-4 pl-5 flex flex-col gap-3 hover:bg-stone-50/40 transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center border shrink-0 ${
                        isFlagged
                          ? 'bg-warning-surface text-warning border-amber-300'
                          : `${theme.softBg} ${theme.text} ${theme.softBorder}`
                      }`}
                    >
                      {isFlagged ? (
                        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="font-label text-label-lg font-semibold text-light-on-surface truncate">
                      {thread.guestName}
                      {thread.stayDates ? ` (${thread.stayDates})` : ''}
                    </span>
                  </div>
                  <div
                    className={`flex items-center gap-1 shrink-0 ${
                      isUrgent ? 'text-warning font-semibold' : 'text-light-secondary'
                    }`}
                  >
                    {isUrgent && <Clock className="w-3.5 h-3.5" aria-hidden="true" />}
                    <span className="text-body-sm font-code">
                      {formatRelativeTime(thread.lastMessageAt)}
                    </span>
                    <ChevronRight className={`w-4 h-4 ${theme.text}`} aria-hidden="true" />
                  </div>
                </div>

                {liveDiscountAlert?.triggersWarning && defaultPayout && (
                  <div className="bg-warning-surface border border-amber-300 rounded-md p-2.5 flex items-start gap-2">
                    <AlertTriangle
                      className="w-4 h-4 text-warning shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="text-body-sm text-amber-950">
                      <strong className="font-label text-label-sm font-semibold block">
                        Discount Review: Below Min Nightly Payout
                      </strong>
                      Guest offered ${liveDiscountAlert.offeredAmount} for{' '}
                      {liveDiscountAlert.nights} nights (~$
                      {defaultPayout.estimatedNetPerNight.toFixed(0)}/nt net vs $
                      {defaultPayout.floorPerNight}/nt min).
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2 max-h-56 overflow-y-auto overscroll-contain">
                  {unanswered.length > 0 ? (
                    unanswered.map((msg) => (
                      <div
                        key={msg.id}
                        className="bg-light-surface-container-low p-2.5 rounded-md border border-light-outline-variant/70 flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between text-[11px] font-code text-light-secondary">
                          <span className="font-medium text-light-on-surface">
                            {msg.senderName}
                          </span>
                          <span>{formatShortClock(msg.sentAt)}</span>
                        </div>
                        <p className="text-body-md text-light-secondary break-words [overflow-wrap:anywhere]">
                          &ldquo;{msg.body}&rdquo;
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-body-md text-light-secondary bg-light-surface-container-low p-2.5 rounded-md border border-light-outline-variant/70 break-words [overflow-wrap:anywhere]">
                      &ldquo;{thread.lastPreview}&rdquo;
                    </p>
                  )}
                </div>
              </button>

              <div className="px-4 pl-5 py-2 border-t border-light-outline-variant/60 bg-light-surface-container-low/50 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onOpenThread(thread.id)}
                  className="min-h-[38px] text-label-md font-semibold text-light-secondary hover:text-light-on-surface flex items-center gap-1.5 transition"
                >
                  <MessageSquareText className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>View thread</span>
                </button>
                <button
                  type="button"
                  onClick={() => void onDismissThread(thread.id)}
                  className="min-h-[38px] text-label-md font-medium text-light-outline hover:text-light-on-surface transition"
                >
                  Already handled
                </button>
              </div>
            </article>
          );
        })}

        {resolvedThreads.length > 0 && (
          <section aria-label="Handled conversations" className="flex flex-col gap-2">
            {resolvedThreads.map((thread) => {
              const isCanceled = thread.reservationStatus === 'canceled';
              const isConfirmedOnly =
                thread.reservationStatus === 'confirmed' && !thread.lastSentPreview;

              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => onOpenThread(thread.id)}
                  className="w-full text-left bg-light-surface-container-low/80 hover:bg-light-surface-container rounded-lg border border-light-outline-variant px-4 py-3 flex flex-col gap-1.5 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 ${
                          isCanceled
                            ? 'bg-light-surface-container text-light-outline border-light-outline-variant'
                            : 'bg-success-surface text-success border-green-200'
                        }`}
                      >
                        {isCanceled ? (
                          <CalendarX className="w-3 h-3" aria-hidden="true" />
                        ) : isConfirmedOnly ? (
                          <CalendarCheck className="w-3 h-3" aria-hidden="true" />
                        ) : (
                          <CheckCheck className="w-3 h-3" aria-hidden="true" />
                        )}
                      </span>
                      <span className="font-label text-label-md font-semibold text-light-on-surface truncate">
                        {thread.guestName}
                        {thread.stayDates ? ` (${thread.stayDates})` : ''}
                      </span>
                    </div>
                    <span className="text-light-secondary text-[11px] font-code shrink-0">
                      {isCanceled
                        ? `Canceled · ${formatRelativeTime(thread.lastMessageAt)}`
                        : isConfirmedOnly
                          ? `Confirmed · ${formatRelativeTime(thread.lastMessageAt)}`
                          : thread.status === 'dismissed'
                            ? 'Handled on Airbnb'
                            : `Sent ${formatRelativeTime(thread.lastMessageAt)}`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-body-sm text-light-secondary pl-7">
                    <p className="truncate">
                      {isCanceled ? (
                        thread.lastPreview || 'Reservation canceled by guest.'
                      ) : isConfirmedOnly ? (
                        thread.lastPreview || 'Reservation confirmed. No messages yet.'
                      ) : thread.status === 'dismissed' ? (
                        'Cleared without logging AI draft.'
                      ) : (
                        <>
                          <span className="font-semibold text-light-on-surface">
                            {thread.lastSentBy ?? 'Host'}:
                          </span>{' '}
                          &ldquo;{thread.lastSentPreview ?? thread.lastPreview}&rdquo;
                        </>
                      )}
                    </p>
                    <ChevronRight
                      className="w-4 h-4 text-light-outline shrink-0"
                      aria-hidden="true"
                    />
                  </div>
                </button>
              );
            })}
          </section>
        )}

        {filteredThreads.length === 0 && (
          <div className="bg-white rounded-lg border border-light-outline-variant p-6 text-center flex flex-col items-center gap-2">
            <p className="font-headline text-headline-sm text-light-on-surface">
              No matching messages
            </p>
            <p className="text-body-sm text-light-secondary">
              Try clearing your search or switching properties.
            </p>
            {(searchTerm.length > 0 || activeFilterCount > 0) && (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-1 min-h-[38px] px-4 py-1.5 rounded-md border border-light-outline-variant bg-white text-label-md font-semibold text-light-on-surface hover:bg-stone-50 transition"
              >
                Reset filters
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
