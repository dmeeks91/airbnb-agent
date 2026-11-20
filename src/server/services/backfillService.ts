import crypto from 'node:crypto';
import PostalMime from 'postal-mime';
import type { ParsedAirbnbEmail } from '../../types/cohost.ts';
import { parseAirbnbEmail } from './emailParser.ts';
import type { GmailSyncClient } from './gmailClient.ts';
import { IngestionService, type IngestionPushAdapter } from './ingestionService.ts';
import type { CohostServerRepository } from './serverRepository.ts';

const SILENT_PUSH_ADAPTER: IngestionPushAdapter = {
  sendAlert: async () => {},
};

export interface BackfillCandidate {
  dedupeId: string;
  parsed: ParsedAirbnbEmail;
  sortTimeMs: number;
  fromAttachment: boolean;
}

export interface BackfillOptions {
  labelId: string;
  days: number;
  maxMessages?: number;
  autoDismissOlderThanHours: number | null;
  nowMs?: number;
}

export interface BackfillSummary {
  scannedGmailMessages: number;
  extractedAttachments: number;
  extractedCandidates: number;
  ingestedGuestMessages: number;
  syncedHostReplies: number;
  ignoredNoise: number;
  unmatched: number;
  deduped: number;
  autoDismissedOldThreads: number;
}

function isEmlAttachment(
  mimeType: string | null | undefined,
  filename: string | null | undefined,
): boolean {
  const normalizedMime = (mimeType ?? '').trim().toLowerCase();
  const normalizedFilename = (filename ?? '').trim().toLowerCase();
  return normalizedMime === 'message/rfc822' || normalizedFilename.endsWith('.eml');
}

function toBuffer(content: string | ArrayBuffer | Uint8Array): Buffer {
  if (typeof content === 'string') {
    return Buffer.from(content, 'utf8');
  }
  if (content instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(content));
  }
  return Buffer.from(content);
}

function computeAttachmentDedupeId(
  rfcMessageId: string | null,
  rawAttachment: Buffer,
): string {
  const seed = rfcMessageId && rfcMessageId.trim().length > 0
    ? `rfc:${rfcMessageId.trim().toLowerCase()}`
    : rawAttachment;
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24);
  return `backfill-${hash}`;
}

/**
 * Unwraps any attached `.eml` (`message/rfc822`) messages from a Gmail
 * "Forward as attachment" bundle. Falls back to parsing the top-level message
 * directly when no `.eml` attachments are present.
 */
export async function extractBackfillCandidates(
  rawEmail: string | Buffer | Uint8Array,
  sourceGmailMessageId: string,
): Promise<BackfillCandidate[]> {
  const outerParser = new PostalMime();
  const outerEmail = await outerParser.parse(rawEmail);
  const emlAttachments = (outerEmail.attachments ?? []).filter(
    (attachment) =>
      isEmlAttachment(attachment.mimeType, attachment.filename) &&
      attachment.content !== undefined &&
      attachment.content !== null,
  );

  if (emlAttachments.length > 0) {
    const candidates: BackfillCandidate[] = [];
    for (const attachment of emlAttachments) {
      const attachmentBuffer = toBuffer(attachment.content);
      if (attachmentBuffer.byteLength === 0) {
        continue;
      }
      const parsedInner = await parseAirbnbEmail(attachmentBuffer);
      const dedupeId = computeAttachmentDedupeId(parsedInner.rfcMessageId, attachmentBuffer);
      const parsedWithId: ParsedAirbnbEmail = {
        ...parsedInner,
        gmailMessageId: dedupeId,
      };
      const parsedTime = Date.parse(parsedWithId.sentAt);
      candidates.push({
        dedupeId,
        parsed: parsedWithId,
        sortTimeMs: Number.isFinite(parsedTime) ? parsedTime : 0,
        fromAttachment: true,
      });
    }
    return candidates;
  }

  const parsedDirect = await parseAirbnbEmail(rawEmail, {
    gmailMessageId: sourceGmailMessageId,
  });
  const parsedTime = Date.parse(parsedDirect.sentAt);
  return [
    {
      dedupeId: sourceGmailMessageId,
      parsed: parsedDirect,
      sortTimeMs: Number.isFinite(parsedTime) ? parsedTime : 0,
      fromAttachment: false,
    },
  ];
}

export async function runGmailBackfill(
  gmail: GmailSyncClient,
  repo: CohostServerRepository,
  options: BackfillOptions,
): Promise<BackfillSummary> {
  const gmailMessageIds = await gmail.listLabelMessagesSince(
    options.labelId,
    options.days,
    options.maxMessages ?? 250,
  );

  const allCandidates: BackfillCandidate[] = [];
  let extractedAttachments = 0;

  for (const gmailMessageId of gmailMessageIds) {
    const rawEmail = await gmail.fetchRawMessage(gmailMessageId);
    const extracted = await extractBackfillCandidates(rawEmail, gmailMessageId);
    for (const candidate of extracted) {
      if (candidate.fromAttachment) {
        extractedAttachments++;
      }
      allCandidates.push(candidate);
    }
  }

  // Ingest oldest-first so later host-reply digests close out earlier guest messages cleanly
  const sortedCandidates = [...allCandidates].sort((a, b) => a.sortTimeMs - b.sortTimeMs);

  const ingestion = new IngestionService(repo, SILENT_PUSH_ADAPTER);
  const touchedThreads = new Map<string, { propertyId: string; threadId: string }>();

  let ingestedGuestMessages = 0;
  let syncedHostReplies = 0;
  let ignoredNoise = 0;
  let unmatched = 0;
  let deduped = 0;

  for (const candidate of sortedCandidates) {
    const result = await ingestion.processParsedEmail(candidate.parsed, {
      sendPush: false,
    });

    if (result.outcome === 'guest_message_ingested') {
      ingestedGuestMessages++;
      touchedThreads.set(`${result.propertyId}::${result.threadId}`, {
        propertyId: result.propertyId,
        threadId: result.threadId,
      });
    } else if (result.outcome === 'host_reply_synced') {
      syncedHostReplies++;
    } else if (result.outcome === 'ignored_noise') {
      ignoredNoise++;
    } else if (result.outcome === 'unmatched') {
      unmatched++;
    } else {
      deduped++;
    }
  }

  let autoDismissedOldThreads = 0;
  if (
    options.autoDismissOlderThanHours !== null &&
    options.autoDismissOlderThanHours > 0
  ) {
    const referenceNowMs = options.nowMs ?? Date.now();
    const cutoffMs = referenceNowMs - options.autoDismissOlderThanHours * 60 * 60 * 1000;

    for (const { propertyId, threadId } of touchedThreads.values()) {
      const latest = await repo.getThread(propertyId, threadId);
      if (!latest || (latest.status !== 'needs_reply' && latest.status !== 'flagged')) {
        continue;
      }
      const lastMessageMs = Date.parse(latest.lastMessageAt);
      if (Number.isFinite(lastMessageMs) && lastMessageMs < cutoffMs) {
        await repo.dismissThread(propertyId, threadId);
        autoDismissedOldThreads++;
      }
    }
  }

  return {
    scannedGmailMessages: gmailMessageIds.length,
    extractedAttachments,
    extractedCandidates: sortedCandidates.length,
    ingestedGuestMessages,
    syncedHostReplies,
    ignoredNoise,
    unmatched,
    deduped,
    autoDismissedOldThreads,
  };
}
