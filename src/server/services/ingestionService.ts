import type {
  ExistingThreadRef,
  GuestStage,
  GuestThread,
  ParsedAirbnbEmail,
  Property,
  PropertyMatchCandidate,
  ThreadMessage,
  UnmatchedEmail,
} from '../../types/cohost.ts';
import { detectDiscountAlert } from './discountDetector.ts';
import { parseAirbnbEmail } from './emailParser.ts';
import { computeMessageFingerprint } from './messageFingerprint.ts';
import { matchProperty } from './propertyMatcher.ts';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export type ProcessedEmailClassification =
  | 'guest_message'
  | 'host_reply_sync'
  | 'ignored_noise'
  | 'unmatched';

export interface ProcessedEmailRecord {
  gmailMessageId: string;
  receivedAt: string;
  classification: ProcessedEmailClassification;
  propertyId: string | null;
  threadId: string | null;
}

export interface IngestionPushPayload {
  title: string;
  body: string;
  propertyId?: string;
  threadId?: string;
  view?: 'messages' | 'dialogue';
}

export interface IngestionStorageAdapter {
  hasProcessedEmail(gmailMessageId: string): Promise<boolean>;
  recordProcessedEmail(record: ProcessedEmailRecord): Promise<void>;
  listProperties(): Promise<Property[]>;
  listAllThreads(): Promise<GuestThread[]>;
  listThreadMessages(propertyId: string, threadId: string): Promise<ThreadMessage[]>;
  saveThreadAndMessages(params: {
    propertyId: string;
    thread: GuestThread;
    newMessages: ThreadMessage[];
    markAllExistingAnswered: boolean;
  }): Promise<void>;
  saveUnmatchedEmail(item: UnmatchedEmail): Promise<void>;
  recomputePropertyCounters(propertyId: string): Promise<void>;
}

export interface IngestionPushAdapter {
  sendAlert(payload: IngestionPushPayload): Promise<void>;
}

export type IngestionOutcome =
  | { outcome: 'deduped_by_gmail_id'; gmailMessageId: string; pushSent: false }
  | { outcome: 'ignored_noise'; gmailMessageId: string; reason: string | null; pushSent: false }
  | {
      outcome: 'unmatched';
      gmailMessageId: string;
      unmatchedId: string;
      reason: string;
      pushSent: boolean;
    }
  | {
      outcome: 'deduped_by_fingerprint';
      gmailMessageId: string;
      propertyId: string;
      threadId: string;
      pushSent: false;
    }
  | {
      outcome: 'host_reply_synced';
      gmailMessageId: string;
      propertyId: string;
      threadId: string;
      addedMessageCount: number;
      pushSent: false;
    }
  | {
      outcome: 'guest_message_ingested';
      gmailMessageId: string;
      propertyId: string;
      threadId: string;
      addedMessageCount: number;
      flaggedDiscount: boolean;
      pushSent: boolean;
    };

const MONTH_CANON: Record<string, string> = {
  january: 'jan',
  february: 'feb',
  march: 'mar',
  april: 'apr',
  may: 'may',
  june: 'jun',
  july: 'jul',
  august: 'aug',
  september: 'sep',
  sept: 'sep',
  october: 'oct',
  november: 'nov',
  december: 'dec',
};

function normalizeGuestName(name: string | null): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStayDates(stayDates: string | null): string {
  if (!stayDates) {
    return '';
  }
  let normalized = stayDates
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/,/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [full, abbr] of Object.entries(MONTH_CANON)) {
    normalized = normalized.replace(new RegExp(`\\b${full}\\b`, 'g'), abbr);
  }
  return normalized;
}

function stageRank(stage: GuestStage): number {
  if (stage === 'current') {
    return 2;
  }
  if (stage === 'confirmed') {
    return 1;
  }
  return 0;
}

function mergeStage(existing: GuestStage | undefined, incoming: GuestStage): GuestStage {
  if (!existing) {
    return incoming;
  }
  return stageRank(incoming) > stageRank(existing) ? incoming : existing;
}

export function findMatchingThread(
  propertyThreads: readonly GuestThread[],
  parsed: ParsedAirbnbEmail,
  preferredThreadId?: string,
): GuestThread | undefined {
  if (preferredThreadId) {
    const exact = propertyThreads.find((t) => t.id === preferredThreadId);
    if (exact) {
      return exact;
    }
  }

  // Tier 1: airbnbThreadId
  if (parsed.airbnbThreadId) {
    const byThreadId = propertyThreads.find(
      (t) => t.airbnbThreadId === parsed.airbnbThreadId,
    );
    if (byThreadId) {
      return byThreadId;
    }
  }

  // Tier 2: reservationCode
  if (parsed.reservationCode) {
    const byResCode = propertyThreads.find(
      (t) =>
        t.reservationCode !== null &&
        t.reservationCode.toUpperCase() === parsed.reservationCode!.toUpperCase(),
    );
    if (byResCode) {
      return byResCode;
    }
  }

  // Tier 3: (propertyId, guestName, stayDates) within 14 days
  // Never merge two threads that explicitly carry DIFFERENT Airbnb thread IDs or reservation codes.
  const normGuest = normalizeGuestName(parsed.guestName);
  const normDates = normalizeStayDates(parsed.stayDates);
  const parsedTime = Date.parse(parsed.sentAt) || Date.now();

  if (normGuest && normDates) {
    return propertyThreads.find((thread) => {
      if (
        parsed.airbnbThreadId &&
        thread.airbnbThreadId &&
        parsed.airbnbThreadId !== thread.airbnbThreadId
      ) {
        return false;
      }
      if (
        parsed.reservationCode &&
        thread.reservationCode &&
        parsed.reservationCode.toUpperCase() !== thread.reservationCode.toUpperCase()
      ) {
        return false;
      }
      if (normalizeGuestName(thread.guestName) !== normGuest) {
        return false;
      }
      if (normalizeStayDates(thread.stayDates) !== normDates) {
        return false;
      }
      const existingTime = Date.parse(thread.lastMessageAt) || 0;
      return Math.abs(parsedTime - existingTime) <= FOURTEEN_DAYS_MS;
    });
  }

  return undefined;
}

function sanitizeIdPart(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return cleaned || String(Date.now());
}

export class IngestionService {
  private readonly storage: IngestionStorageAdapter;
  private readonly push: IngestionPushAdapter;

  constructor(storage: IngestionStorageAdapter, push: IngestionPushAdapter) {
    this.storage = storage;
    this.push = push;
  }

  public async processRawEmail(
    rawEmail: string | Buffer | Uint8Array,
    gmailMessageId: string,
  ): Promise<IngestionOutcome> {
    // Layer 1 Deduplication: gmailMessageId check
    if (await this.storage.hasProcessedEmail(gmailMessageId)) {
      return {
        outcome: 'deduped_by_gmail_id',
        gmailMessageId,
        pushSent: false,
      };
    }

    const parsed = await parseAirbnbEmail(rawEmail, { gmailMessageId });
    return this.processParsedEmail(parsed);
  }

  public async processParsedEmail(parsed: ParsedAirbnbEmail): Promise<IngestionOutcome> {
    const gmailMessageId = parsed.gmailMessageId;

    if (await this.storage.hasProcessedEmail(gmailMessageId)) {
      return {
        outcome: 'deduped_by_gmail_id',
        gmailMessageId,
        pushSent: false,
      };
    }

    const nowIso = parsed.sentAt || new Date().toISOString();

    if (parsed.classification === 'ignored_noise') {
      await this.storage.recordProcessedEmail({
        gmailMessageId,
        receivedAt: nowIso,
        classification: 'ignored_noise',
        propertyId: null,
        threadId: null,
      });
      return {
        outcome: 'ignored_noise',
        gmailMessageId,
        reason: parsed.ignoreReason,
        pushSent: false,
      };
    }

    const properties = await this.storage.listProperties();
    const allThreads = await this.storage.listAllThreads();

    const propertyCandidates: PropertyMatchCandidate[] = properties.map((p) => ({
      id: p.id,
      name: p.name,
      airbnbListingIds: p.airbnbListingIds,
      titleAliases: p.titleAliases,
    }));

    const existingThreadRefs: ExistingThreadRef[] = allThreads
      .filter((t): t is GuestThread & { airbnbThreadId: string } =>
        Boolean(t.airbnbThreadId),
      )
      .map((t) => ({
        threadId: t.id,
        propertyId: t.propertyId,
        airbnbThreadId: t.airbnbThreadId,
      }));

    const match = matchProperty(parsed, propertyCandidates, existingThreadRefs);

    if (!match.matched) {
      const unmatchedId = `unmatched-${gmailMessageId}`;
      const guestName = parsed.guestName ?? 'Unknown Guest';
      const bodyPreview = parsed.bodyText.slice(0, 280);

      await this.storage.saveUnmatchedEmail({
        id: unmatchedId,
        gmailMessageId,
        guestName,
        subject: parsed.subject,
        bodyPreview,
        rawParsed: parsed,
        receivedAt: nowIso,
        resolved: false,
      });

      await this.storage.recordProcessedEmail({
        gmailMessageId,
        receivedAt: nowIso,
        classification: 'unmatched',
        propertyId: null,
        threadId: null,
      });

      await this.push.sendAlert({
        title: `Unmatched Airbnb email from ${guestName}`,
        body: 'Tap to assign property before drafting.',
        view: 'messages',
      });

      return {
        outcome: 'unmatched',
        gmailMessageId,
        unmatchedId,
        reason: match.reason,
        pushSent: true,
      };
    }

    const property = properties.find((p) => p.id === match.propertyId);
    if (!property) {
      throw new Error(`Matched property ${match.propertyId} not found in storage`);
    }

    const propertyThreads = allThreads.filter((t) => t.propertyId === property.id);
    return this.ingestIntoProperty({
      property,
      propertyThreads,
      parsed,
      preferredThreadId: match.existingThreadId,
      recordProcessed: true,
      sendPush: true,
    });
  }

  /**
   * Ingests a parsed Airbnb email into a known target property (used both during normal
   * email ingestion and when manually assigning an unmatched email to a property).
   */
  public async ingestIntoProperty(params: {
    property: Property;
    propertyThreads: readonly GuestThread[];
    parsed: ParsedAirbnbEmail;
    preferredThreadId?: string;
    recordProcessed?: boolean;
    sendPush?: boolean;
  }): Promise<IngestionOutcome> {
    const {
      property,
      propertyThreads,
      parsed,
      preferredThreadId,
      recordProcessed = false,
      sendPush = false,
    } = params;

    const gmailMessageId = parsed.gmailMessageId;
    const nowIso = parsed.sentAt || new Date().toISOString();

    const existingThread = findMatchingThread(
      propertyThreads,
      parsed,
      preferredThreadId,
    );

    const threadId =
      existingThread?.id ??
      `thread-${sanitizeIdPart(parsed.airbnbThreadId ?? parsed.reservationCode ?? gmailMessageId)}`;

    const existingMessages = existingThread
      ? await this.storage.listThreadMessages(property.id, threadId)
      : [];

    const sourceMessages =
      parsed.messages.length > 0
        ? parsed.messages
        : parsed.bodyText.trim()
          ? [
              {
                senderName: parsed.guestName ?? 'Guest',
                role: 'guest' as const,
                body: parsed.bodyText.trim(),
              },
            ]
          : [];

    // Layer 2 Deduplication: deterministic content fingerprint per message
    const seenFingerprints = new Set(existingMessages.map((m) => m.contentFingerprint));
    const isHostReplySync = parsed.classification === 'host_reply_sync';
    const newMessages: ThreadMessage[] = [];

    sourceMessages.forEach((msg, idx) => {
      const fingerprint = computeMessageFingerprint(msg.role, msg.senderName, msg.body);
      if (seenFingerprints.has(fingerprint)) {
        return;
      }
      seenFingerprints.add(fingerprint);
      const sentAtMs = Date.parse(nowIso) || Date.now();
      newMessages.push({
        id: `msg-${sanitizeIdPart(gmailMessageId)}-${idx}`,
        threadId,
        propertyId: property.id,
        gmailMessageId,
        contentFingerprint: fingerprint,
        sender: msg.role,
        senderName: msg.senderName,
        body: msg.body,
        sentAt: new Date(sentAtMs + idx * 1000).toISOString(),
        unanswered: !isHostReplySync && msg.role === 'guest',
        loggedManually: false,
        archivedCoachNotes:
          isHostReplySync && msg.role === 'host'
            ? ['Synced automatically from Airbnb host/co-host reply digest.']
            : [],
      });
    });

    const mergedAirbnbThreadId = parsed.airbnbThreadId ?? existingThread?.airbnbThreadId ?? null;
    const mergedReservationCode =
      parsed.reservationCode ?? existingThread?.reservationCode ?? null;
    const mergedThreadUrl =
      parsed.airbnbThreadId && parsed.airbnbThreadUrl
        ? parsed.airbnbThreadUrl
        : (existingThread?.airbnbThreadUrl ?? parsed.airbnbThreadUrl ?? null);
    const mergedStage = mergeStage(existingThread?.stage, parsed.stage);
    const mergedNights = parsed.nights ?? existingThread?.nights ?? null;
    const mergedStayDates = parsed.stayDates ?? existingThread?.stayDates ?? null;
    const mergedGuestName = parsed.guestName ?? existingThread?.guestName ?? 'Guest';
    const mergedGuestCount = parsed.guestCount ?? existingThread?.guestCount ?? null;

    if (newMessages.length === 0) {
      // Even when message bodies are deduped, backfill newly discovered thread IDs or stage upgrades.
      if (
        existingThread &&
        (mergedAirbnbThreadId !== existingThread.airbnbThreadId ||
          mergedReservationCode !== existingThread.reservationCode ||
          mergedThreadUrl !== existingThread.airbnbThreadUrl ||
          mergedStage !== existingThread.stage)
      ) {
        await this.storage.saveThreadAndMessages({
          propertyId: property.id,
          thread: {
            ...existingThread,
            airbnbThreadId: mergedAirbnbThreadId,
            reservationCode: mergedReservationCode,
            airbnbThreadUrl: mergedThreadUrl,
            stage: mergedStage,
            nights: mergedNights,
            stayDates: mergedStayDates,
            guestCount: mergedGuestCount,
          },
          newMessages: [],
          markAllExistingAnswered: false,
        });
      }

      if (recordProcessed) {
        await this.storage.recordProcessedEmail({
          gmailMessageId,
          receivedAt: nowIso,
          classification: parsed.classification,
          propertyId: property.id,
          threadId,
        });
      }
      return {
        outcome: 'deduped_by_fingerprint',
        gmailMessageId,
        propertyId: property.id,
        threadId,
        pushSent: false,
      };
    }

    if (isHostReplySync) {
      const lastHostMsg = [...newMessages].reverse().find((m) => m.sender === 'host');
      const lastBody = lastHostMsg?.body ?? newMessages[newMessages.length - 1].body;
      const updatedThread: GuestThread = {
        id: threadId,
        propertyId: property.id,
        guestName: mergedGuestName,
        guestCount: mergedGuestCount,
        stayDates: mergedStayDates,
        nights: mergedNights,
        airbnbThreadId: mergedAirbnbThreadId,
        reservationCode: mergedReservationCode,
        airbnbThreadUrl: mergedThreadUrl,
        stage: mergedStage,
        status: 'sent',
        unansweredCount: 0,
        lastMessageAt: nowIso,
        lastPreview: lastBody,
        lastSentPreview: lastBody,
        lastSentBy: lastHostMsg?.senderName ?? 'Co-Host',
        discountAlert: existingThread?.discountAlert ?? null,
        activeCoachSession: null,
      };

      await this.storage.saveThreadAndMessages({
        propertyId: property.id,
        thread: updatedThread,
        newMessages,
        markAllExistingAnswered: true,
      });
      await this.storage.recomputePropertyCounters(property.id);
      if (recordProcessed) {
        await this.storage.recordProcessedEmail({
          gmailMessageId,
          receivedAt: nowIso,
          classification: 'host_reply_sync',
          propertyId: property.id,
          threadId,
        });
      }

      return {
        outcome: 'host_reply_synced',
        gmailMessageId,
        propertyId: property.id,
        threadId,
        addedMessageCount: newMessages.length,
        pushSent: false,
      };
    }

    // Guest message path
    const newGuestMessages = newMessages.filter((m) => m.sender === 'guest');
    const latestGuestBody =
      newGuestMessages[newGuestMessages.length - 1]?.body ?? parsed.bodyText;

    const detectedDiscount = detectDiscountAlert(
      newGuestMessages.map((m) => m.body).join('\n\n') || parsed.bodyText,
      mergedNights,
      property.pricing,
    );
    const shouldCarryPriorDiscount =
      existingThread?.status === 'flagged' && mergedStage === 'inquiry';
    const activeDiscountAlert =
      detectedDiscount ?? (shouldCarryPriorDiscount ? existingThread.discountAlert : null);
    const isFlagged = Boolean(activeDiscountAlert?.triggersWarning);

    const priorUnansweredCount = existingMessages.filter((m) => m.unanswered).length;
    const nextUnansweredCount = priorUnansweredCount + newGuestMessages.length;

    const nextCoachSession = existingThread?.activeCoachSession
      ? {
          ...existingThread.activeCoachSession,
          turns: existingThread.activeCoachSession.turns.map((t) => ({ ...t })),
          hasNewGuestMessageSinceEdit: true,
        }
      : null;

    const updatedThread: GuestThread = {
      id: threadId,
      propertyId: property.id,
      guestName: mergedGuestName,
      guestCount: mergedGuestCount,
      stayDates: mergedStayDates,
      nights: mergedNights,
      airbnbThreadId: mergedAirbnbThreadId,
      reservationCode: mergedReservationCode,
      airbnbThreadUrl: mergedThreadUrl,
      stage: mergedStage,
      status: isFlagged ? 'flagged' : 'needs_reply',
      unansweredCount: nextUnansweredCount,
      lastMessageAt: nowIso,
      lastPreview: latestGuestBody,
      lastSentPreview: existingThread?.lastSentPreview ?? null,
      lastSentBy: existingThread?.lastSentBy ?? null,
      discountAlert: activeDiscountAlert,
      activeCoachSession: nextCoachSession,
    };

    await this.storage.saveThreadAndMessages({
      propertyId: property.id,
      thread: updatedThread,
      newMessages,
      markAllExistingAnswered: false,
    });
    await this.storage.recomputePropertyCounters(property.id);
    if (recordProcessed) {
      await this.storage.recordProcessedEmail({
        gmailMessageId,
        receivedAt: nowIso,
        classification: 'guest_message',
        propertyId: property.id,
        threadId,
      });
    }

    if (sendPush) {
      await this.push.sendAlert({
        title: isFlagged
          ? `Discount review · ${mergedGuestName} (${property.name})`
          : `${mergedGuestName} · ${property.name}`,
        body: latestGuestBody.slice(0, 140),
        propertyId: property.id,
        threadId,
        view: 'dialogue',
      });
    }

    return {
      outcome: 'guest_message_ingested',
      gmailMessageId,
      propertyId: property.id,
      threadId,
      addedMessageCount: newMessages.length,
      flaggedDiscount: isFlagged,
      pushSent: sendPush,
    };
  }
}
