import type { EmailClassification, ParsedAirbnbEmail } from '../../types/cohost.ts';
import {
  parseUnrecognizedEmailWithVertex,
  type VertexFallbackEmailResult,
} from '../config/vertex.ts';
import { parseAirbnbEmailWithMeta } from './emailParser.ts';

export type UnrecognizedEmailFallbackFn = (params: {
  subject: string;
  rawBody: string;
}) => Promise<VertexFallbackEmailResult | null>;

export interface HybridParseOptions {
  gmailMessageId?: string;
  fallbackExtractor?: UnrecognizedEmailFallbackFn;
}

/**
 * Hybrid Airbnb email parser:
 * 1. Runs fast deterministic MIME, URL, locale, template, and static noise parsing first.
 * 2. Invokes the narrow Vertex AI fallback ONLY when a verified Airbnb email did not match
 *    any known structured template or static noise filter (or yielded an empty body).
 * 3. Security guardrails: URL IDs (threadId, listingId, reservationCode) remain strictly
 *    deterministic, and unrecognized emails never upgrade past `inquiry` stage unless a
 *    deterministic reservation code already confirmed the booking.
 */
export async function parseAirbnbEmailHybrid(
  rawEmail: string | Buffer | Uint8Array,
  options: HybridParseOptions = {},
): Promise<ParsedAirbnbEmail> {
  const meta = await parseAirbnbEmailWithMeta(rawEmail, {
    gmailMessageId: options.gmailMessageId,
  });

  const { parsed, isAirbnbSender, matchedStructuredTemplate, rawBody } = meta;

  const isStaticNoise =
    parsed.classification === 'ignored_noise' && parsed.ignoreReason !== 'empty_message_body';

  if (
    !isAirbnbSender ||
    matchedStructuredTemplate ||
    isStaticNoise ||
    parsed.classification === 'reservation_update'
  ) {
    return parsed;
  }

  if (!rawBody.trim() && !parsed.subject.trim()) {
    return parsed;
  }

  const extractor = options.fallbackExtractor ?? parseUnrecognizedEmailWithVertex;
  let fallback: VertexFallbackEmailResult | null = null;
  try {
    fallback = await extractor({
      subject: parsed.subject,
      rawBody,
    });
  } catch {
    // Never break live email ingestion or push notifications on Vertex errors.
    return parsed;
  }

  if (!fallback) {
    return parsed;
  }

  if (fallback.isSystemNoise || fallback.messages.length === 0) {
    const suffix = fallback.noiseReason ? `:${fallback.noiseReason.slice(0, 60)}` : '';
    return {
      ...parsed,
      classification: 'ignored_noise',
      needsHostReply: false,
      ignoreReason: `llm_noise${suffix}`,
      messages: [],
      bodyText: '',
    };
  }

  const extractedMessages = fallback.messages.map((msg) => ({
    senderName: msg.senderName,
    role: msg.role,
    body: msg.body,
  }));
  const guestBodies = extractedMessages.filter((m) => m.role === 'guest').map((m) => m.body);
  const lastMessage = extractedMessages[extractedMessages.length - 1];
  const classification: EmailClassification =
    lastMessage.role === 'host' ? 'host_reply_sync' : 'guest_message';
  const bodyText = guestBodies.length > 0 ? guestBodies.join('\n\n') : lastMessage.body;

  // Fail-safe stage guardrail: unrecognized templates default to `inquiry` so Access & Arrival
  // rules (door codes, Wi-Fi, exact address) cannot be leaked via prompt injection unless a
  // deterministic reservation code already established a confirmed stay.
  const safeStage = parsed.reservationCode ? parsed.stage : 'inquiry';

  return {
    ...parsed,
    classification,
    needsHostReply: classification === 'guest_message',
    ignoreReason: null,
    guestName: parsed.guestName ?? fallback.guestName,
    stayDates: parsed.stayDates ?? fallback.stayDates,
    nights: parsed.nights ?? fallback.nights,
    listingTitleHint: parsed.listingTitleHint ?? fallback.listingTitleHint,
    stage: safeStage,
    messages: extractedMessages,
    bodyText,
  };
}
