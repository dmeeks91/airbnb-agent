import type {
  ActiveCoachSession,
  CoachTurn,
  DiscountAlert,
  EmailClassification,
  GuestStage,
  GuestThread,
  HouseRule,
  IngestionHealth,
  IngestionHealthStatus,
  KnowledgeSource,
  KnowledgeSourceType,
  LearnedVoiceDiff,
  ParsedAirbnbEmail,
  ParsedEmailMessage,
  PayoutAssumption,
  PayoutBreakdown,
  Property,
  PropertyCode,
  PropertyVendor,
  RuleCategory,
  SignOffMode,
  ThreadMessage,
  ThreadStatus,
  ThreadSystemEvent,
  UnmatchedEmail,
  VoiceProfile,
} from '../types/cohost.ts';

const MAX_LEARNED_DIFFS = 15;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

export function parseRuleCategory(value: unknown): RuleCategory {
  if (
    value === 'Access & Arrival' ||
    value === 'Timings & Rates' ||
    value === 'Amenities & Rules'
  ) {
    return value;
  }
  return 'Amenities & Rules';
}

export function parsePropertyCode(value: unknown): PropertyCode {
  if (value === 'B' || value === 'C') {
    return value;
  }
  return 'A';
}

export function parseGuestStage(value: unknown): GuestStage {
  if (value === 'inquiry' || value === 'current') {
    return value;
  }
  return 'confirmed';
}

export function parseThreadStatus(value: unknown): ThreadStatus {
  if (
    value === 'needs_reply' ||
    value === 'flagged' ||
    value === 'sent' ||
    value === 'dismissed'
  ) {
    return value;
  }
  return 'needs_reply';
}

export function parsePayoutAssumption(value: unknown): PayoutAssumption {
  return value === 'room_only' ? 'room_only' : 'all_in';
}

export function parsePayoutBreakdown(value: unknown): PayoutBreakdown | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.guestQuote !== 'number' ||
    typeof value.nights !== 'number' ||
    typeof value.estimatedNetPerNight !== 'number'
  ) {
    return null;
  }

  return {
    assumption: parsePayoutAssumption(value.assumption),
    guestQuote: value.guestQuote,
    nights: value.nights,
    preTaxSubtotal: readNumber(value.preTaxSubtotal, 0),
    estimatedAccommodation: readNumber(value.estimatedAccommodation, 0),
    cleaningFee: readNumber(value.cleaningFee, 0),
    estimatedTax: readNumber(value.estimatedTax, 0),
    hostServiceFee: readNumber(value.hostServiceFee, 0),
    totalHostPayout: readNumber(value.totalHostPayout, 0),
    netAfterCleaning: readNumber(value.netAfterCleaning, 0),
    estimatedNetPerNight: value.estimatedNetPerNight,
    floorPerNight: readNumber(value.floorPerNight, 0),
    belowFloor: Boolean(value.belowFloor),
    deltaPerNight: readNumber(value.deltaPerNight, 0),
  };
}

export function parseDiscountAlert(value: unknown): DiscountAlert | null {
  if (!isRecord(value)) {
    return null;
  }
  const allIn = parsePayoutBreakdown(value.allIn);
  const roomOnly = parsePayoutBreakdown(value.roomOnly);
  if (
    typeof value.offeredAmount !== 'number' ||
    typeof value.nights !== 'number' ||
    !allIn ||
    !roomOnly
  ) {
    return null;
  }

  return {
    offeredAmount: value.offeredAmount,
    nights: value.nights,
    defaultAssumption: parsePayoutAssumption(value.defaultAssumption),
    allIn,
    roomOnly,
    triggersWarning: Boolean(value.triggersWarning),
    matchedSnippet: readString(value.matchedSnippet),
  };
}

export function parseCoachTurn(value: unknown, fallbackIndex = 0): CoachTurn | null {
  if (!isRecord(value)) {
    return null;
  }
  const draft = readNullableString(value.draft);
  const originalDraft =
    typeof value.originalDraft === 'string'
      ? value.originalDraft
      : value.originalDraft === null
        ? null
        : draft;

  return {
    id: readString(value.id, `turn-${fallbackIndex + 1}`),
    sender: value.sender === 'host' ? 'host' : 'agent',
    text: readString(value.text),
    note: readNullableString(value.note),
    draft,
    originalDraft,
    editedByUser: Boolean(value.editedByUser),
    createdAt: readString(value.createdAt, new Date().toISOString()),
  };
}

export function parseActiveCoachSession(value: unknown): ActiveCoachSession | null {
  if (!isRecord(value) || !Array.isArray(value.turns)) {
    return null;
  }
  const turns: CoachTurn[] = [];
  value.turns.forEach((rawTurn, index) => {
    const parsed = parseCoachTurn(rawTurn, index);
    if (parsed) {
      turns.push(parsed);
    }
  });
  return {
    turns,
    hasNewGuestMessageSinceEdit: Boolean(value.hasNewGuestMessageSinceEdit),
  };
}

export function parseVendors(value: unknown): PropertyVendor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const vendors: PropertyVendor[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    vendors.push({
      id: readString(item.id, `vendor-${vendors.length + 1}`),
      name: readString(item.name),
      role: readString(item.role),
      phone: readString(item.phone),
      notes: readString(item.notes),
    });
  }
  return vendors;
}

export function parseKnowledgeSources(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sources: KnowledgeSource[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const type: KnowledgeSourceType =
      item.type === 'pdf_upload' || item.type === 'quick_note' || item.type === 'url_import'
        ? item.type
        : 'paste_text';
    sources.push({
      id: readString(item.id, `src-${sources.length + 1}`),
      title: readString(item.title),
      type,
      uploadedAt: readString(item.uploadedAt, new Date().toISOString()),
      ruleCount: readNumber(item.ruleCount, 0),
    });
  }
  return sources;
}

export function parsePropertyDoc(
  id: string,
  data: Record<string, unknown>,
  fallbackName = 'Property',
): Property {
  const pricing = isRecord(data.pricing) ? data.pricing : null;
  return {
    id,
    name: readString(data.name, fallbackName),
    code: parsePropertyCode(data.code),
    accentColor: readString(data.accentColor, '#095C57'),
    airbnbListingIds: readStringArray(data.airbnbListingIds),
    titleAliases: readStringArray(data.titleAliases),
    signOffOverride: readNullableString(data.signOffOverride),
    welcomeGuideUrl: readNullableString(data.welcomeGuideUrl),
    needsReplyCount: readNumber(data.needsReplyCount, 0),
    flaggedCount: readNumber(data.flaggedCount, 0),
    pricing: {
      nightlyFloor: readNumber(pricing?.nightlyFloor, 150),
      cleaningFee: readNumber(pricing?.cleaningFee, 100),
      localTaxPct: readNumber(pricing?.localTaxPct, 14),
      hostServiceFeePct: readNumber(pricing?.hostServiceFeePct, 15.5),
    },
    vendors: parseVendors(data.vendors),
    knowledgeSources: parseKnowledgeSources(data.knowledgeSources),
  };
}

export function parseRuleDoc(
  id: string,
  propertyId: string,
  data: Record<string, unknown>,
): HouseRule {
  return {
    id,
    propertyId,
    topic: readString(data.topic),
    value: readString(data.value),
    category: parseRuleCategory(data.category),
    origin: readString(data.origin, 'Host Direct Policy'),
    isTemporary: Boolean(data.isTemporary),
    expiresAt: readNullableString(data.expiresAt),
    updatedAt: readString(data.updatedAt, new Date().toISOString()),
  };
}

export function parseThreadDoc(
  id: string,
  propertyId: string,
  data: Record<string, unknown>,
): GuestThread {
  return {
    id,
    propertyId,
    guestName: readString(data.guestName, 'Guest'),
    guestCount: readNullableString(data.guestCount),
    stayDates: readNullableString(data.stayDates),
    nights: readNullableNumber(data.nights),
    airbnbThreadId: readNullableString(data.airbnbThreadId),
    reservationCode: readNullableString(data.reservationCode),
    airbnbThreadUrl: readNullableString(data.airbnbThreadUrl),
    stage: parseGuestStage(data.stage),
    status: parseThreadStatus(data.status),
    reservationStatus:
      data.reservationStatus === 'confirmed' || data.reservationStatus === 'canceled'
        ? data.reservationStatus
        : null,
    unansweredCount: readNumber(data.unansweredCount, 0),
    lastMessageAt: readString(data.lastMessageAt, new Date().toISOString()),
    lastPreview: readString(data.lastPreview),
    lastSentPreview: readNullableString(data.lastSentPreview),
    lastSentBy: readNullableString(data.lastSentBy),
    discountAlert: parseDiscountAlert(data.discountAlert),
    activeCoachSession: parseActiveCoachSession(data.activeCoachSession),
  };
}

export function parseMessageDoc(
  id: string,
  threadId: string,
  propertyId: string,
  data: Record<string, unknown>,
): ThreadMessage {
  const sender =
    data.sender === 'host' ? 'host' : data.sender === 'system' ? 'system' : 'guest';
  const rawSys = isRecord(data.systemEvent) ? data.systemEvent : null;
  const sysType =
    rawSys?.type === 'confirmed'
      ? ('confirmed' as const)
      : rawSys?.type === 'canceled'
        ? ('canceled' as const)
        : null;
  const systemEvent: ThreadSystemEvent | null =
    rawSys && sysType
      ? {
          type: sysType,
          reservationCode: readNullableString(rawSys.reservationCode),
        }
      : null;

  return {
    id,
    threadId,
    propertyId,
    gmailMessageId: readNullableString(data.gmailMessageId),
    contentFingerprint: readString(data.contentFingerprint),
    sender,
    senderName: readString(data.senderName, 'Guest'),
    body: readString(data.body),
    sentAt: readString(data.sentAt, new Date().toISOString()),
    unanswered: Boolean(data.unanswered),
    loggedManually: Boolean(data.loggedManually),
    archivedCoachNotes: readStringArray(data.archivedCoachNotes),
    systemEvent,
  };
}

export function parseLearnedDiffs(value: unknown): LearnedVoiceDiff[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const diffs: LearnedVoiceDiff[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    diffs.push({
      id: readString(item.id, `diff-${diffs.length + 1}`),
      originalDraft: readString(item.originalDraft),
      finalSent: readString(item.finalSent),
      summary: readString(item.summary),
      createdAt: readString(item.createdAt, new Date().toISOString()),
    });
  }
  return diffs.slice(0, MAX_LEARNED_DIFFS);
}

export function parseVoiceProfileDoc(
  data: Record<string, unknown>,
  fallback: VoiceProfile,
): VoiceProfile {
  const signOffMode: SignOffMode =
    data.signOffMode === 'collective' ||
    data.signOffMode === 'individual' ||
    data.signOffMode === 'none'
      ? data.signOffMode
      : fallback.signOffMode;

  return {
    styleRules: Array.isArray(data.styleRules)
      ? readStringArray(data.styleRules)
      : fallback.styleRules,
    signOffMode,
    signOffText: readString(data.signOffText, fallback.signOffText),
    learnedDiffs: Array.isArray(data.learnedDiffs)
      ? parseLearnedDiffs(data.learnedDiffs)
      : fallback.learnedDiffs,
  };
}

export function parseIngestionHealthDoc(
  data: Record<string, unknown>,
  fallback: IngestionHealth,
): IngestionHealth {
  const status: IngestionHealthStatus =
    data.status === 'warning' || data.status === 'error' ? data.status : 'healthy';

  return {
    status,
    lastPushAt: readNullableString(data.lastPushAt),
    lastEmailReceivedAt: readNullableString(data.lastEmailReceivedAt),
    watchExpiresAt: readNullableString(data.watchExpiresAt),
    lastError: readNullableString(data.lastError),
    watchedEmail: readString(data.watchedEmail, fallback.watchedEmail),
    dualInboxActive:
      typeof data.dualInboxActive === 'boolean'
        ? data.dualInboxActive
        : fallback.dualInboxActive,
  };
}

function parseEmailClassification(value: unknown): EmailClassification {
  if (value === 'host_reply_sync' || value === 'ignored_noise') {
    return value;
  }
  return 'guest_message';
}

function parseParsedMessages(
  value: unknown,
  fallbackGuestName: string,
  fallbackBody: string,
): ParsedEmailMessage[] {
  if (Array.isArray(value)) {
    const parsed: ParsedEmailMessage[] = [];
    for (const item of value) {
      if (!isRecord(item)) {
        continue;
      }
      const body = readString(item.body).trim();
      if (!body) {
        continue;
      }
      parsed.push({
        senderName: readString(item.senderName, fallbackGuestName),
        role: item.role === 'host' ? 'host' : 'guest',
        body,
      });
    }
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return fallbackBody
    ? [{ senderName: fallbackGuestName, role: 'guest', body: fallbackBody }]
    : [];
}

export function parseParsedAirbnbEmail(
  raw: unknown,
  fallback: {
    gmailMessageId: string;
    guestName: string;
    subject: string;
    bodyPreview: string;
    receivedAt: string;
  },
): ParsedAirbnbEmail {
  const record = isRecord(raw) ? raw : {};
  const guestName = readNullableString(record.guestName) ?? fallback.guestName;
  const bodyText = readString(record.bodyText, fallback.bodyPreview);

  return {
    gmailMessageId: readString(record.gmailMessageId, fallback.gmailMessageId),
    rfcMessageId: readNullableString(record.rfcMessageId),
    fromAddress: readString(record.fromAddress, 'express@airbnb.com'),
    fromName: readNullableString(record.fromName),
    replyToAddress: readNullableString(record.replyToAddress),
    subject: readString(record.subject, fallback.subject),
    sentAt: readString(record.sentAt, fallback.receivedAt),
    airbnbTemplate: readNullableString(record.airbnbTemplate),
    classification: parseEmailClassification(record.classification),
    needsHostReply:
      typeof record.needsHostReply === 'boolean' ? record.needsHostReply : true,
    ignoreReason: readNullableString(record.ignoreReason),
    guestName,
    guestCount: readNullableString(record.guestCount),
    messages: parseParsedMessages(record.messages, guestName, bodyText),
    bodyText,
    hasAttachmentsOnly: Boolean(record.hasAttachmentsOnly),
    stage: parseGuestStage(record.stage),
    stayDates: readNullableString(record.stayDates),
    nights: readNullableNumber(record.nights),
    airbnbThreadId: readNullableString(record.airbnbThreadId),
    reservationCode: readNullableString(record.reservationCode),
    airbnbThreadUrl: readNullableString(record.airbnbThreadUrl),
    allAirbnbUrls: readStringArray(record.allAirbnbUrls),
    airbnbListingId: readNullableString(record.airbnbListingId),
    listingTitleHint: readNullableString(record.listingTitleHint),
  };
}

export function parseUnmatchedEmailDoc(
  id: string,
  data: Record<string, unknown>,
): UnmatchedEmail {
  const gmailMessageId = readString(data.gmailMessageId, id);
  const guestName = readString(data.guestName, 'Guest');
  const subject = readString(data.subject);
  const bodyPreview = readString(data.bodyPreview);
  const receivedAt = readString(data.receivedAt, new Date().toISOString());

  return {
    id,
    gmailMessageId,
    guestName,
    subject,
    bodyPreview,
    rawParsed: parseParsedAirbnbEmail(data.rawParsed, {
      gmailMessageId,
      guestName,
      subject,
      bodyPreview,
      receivedAt,
    }),
    receivedAt,
    resolved: Boolean(data.resolved),
  };
}
