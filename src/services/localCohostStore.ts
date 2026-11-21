import { createSeedSnapshot } from '../data/seedData.ts';
import { detectDiscountAlert } from '../server/services/discountDetector.ts';
import type {
  ActiveCoachSession,
  ExtractedRuleCandidate,
  GuestThread,
  CohostDataSnapshot,
  HouseRule,
  KnowledgeSource,
  KnowledgeSourceType,
  LearnedVoiceDiff,
  Property,
  PropertyPricing,
  PropertyVendor,
  RuleCategory,
  ThreadMessage,
  ThreadStatus,
  VoiceProfile,
} from '../types/cohost.ts';
import { recalculateDiscountAlert } from '../utils/payoutHelpers.ts';
import {
  buildPropertySlugId,
  mergeListingId,
  mergeListingTitleAlias,
  normalizeWelcomeGuideUrl,
  pickNextPropertySlot,
} from '../utils/propertyHelpers.ts';

const MAX_LEARNED_DIFFS = 15;
const DEFAULT_LOCAL_TAX_PCT = 14;
const DEFAULT_HOST_SERVICE_FEE_PCT = 15.5;

export interface MarkSentOptions {
  finalText: string;
  originalDraft?: string | null;
  senderName: string;
  loggedManually: boolean;
}

export interface SetCoachSessionOptions {
  skipRemoteSync?: boolean;
}

export interface UpsertPropertyInput {
  id?: string;
  name: string;
  airbnbListingIds: string[];
  primaryListingTitle: string | null;
  welcomeGuideUrl?: string | null;
  nightlyFloor: number;
  cleaningFee: number;
  localTaxPct?: number;
  hostServiceFeePct?: number;
}

export interface UpsertRuleInput {
  id?: string;
  topic: string;
  value: string;
  category: RuleCategory;
  origin: string;
  isTemporary: boolean;
  expiresAt: string | null;
}

export interface CohostStore {
  readonly mode: 'local' | 'firestore';
  subscribe(listener: () => void): () => void;
  getSnapshot(): CohostDataSnapshot;
  upsertProperty(input: UpsertPropertyInput): Promise<Property>;
  updatePropertyPricing(propertyId: string, pricing: PropertyPricing): Promise<void>;
  updatePropertySignOff(propertyId: string, signOffOverride: string | null): Promise<void>;
  upsertVendor(propertyId: string, vendor: PropertyVendor): Promise<void>;
  deleteVendor(propertyId: string, vendorId: string): Promise<void>;
  upsertRule(propertyId: string, input: UpsertRuleInput): Promise<HouseRule>;
  deleteRule(propertyId: string, ruleId: string): Promise<void>;
  mergeImportedRules(
    propertyId: string,
    sourceTitle: string,
    sourceType: KnowledgeSourceType,
    candidates: readonly ExtractedRuleCandidate[],
  ): Promise<void>;
  setThreadCoachSession(
    propertyId: string,
    threadId: string,
    session: ActiveCoachSession | null,
    options?: SetCoachSessionOptions,
  ): Promise<void>;
  markThreadSent(
    propertyId: string,
    threadId: string,
    options: MarkSentOptions,
  ): Promise<void>;
  dismissThread(propertyId: string, threadId: string): Promise<void>;
  deleteThread(propertyId: string, threadId: string): Promise<void>;
  assignUnmatchedEmail(unmatchedId: string, propertyId: string): Promise<GuestThread | null>;
  deleteUnmatchedEmail(unmatchedId: string): Promise<void>;
  updateVoiceProfile(
    updates: Partial<Pick<VoiceProfile, 'styleRules' | 'signOffMode' | 'signOffText'>>,
  ): Promise<void>;
  deleteLearnedDiff(diffId: string): Promise<void>;
  updateUserPushPreferences(pushEnabled: boolean, fcmToken?: string): Promise<void>;
  dispose?(): void;
}

function recomputePropertyCounts(
  properties: readonly Property[],
  threadsByProperty: Readonly<Record<string, GuestThread[]>>,
): Property[] {
  return properties.map((property) => {
    const propertyThreads = threadsByProperty[property.id] ?? [];
    const needsReplyCount = propertyThreads.filter((t) => t.status === 'needs_reply').length;
    const flaggedCount = propertyThreads.filter((t) => t.status === 'flagged').length;
    return {
      ...property,
      needsReplyCount,
      flaggedCount,
    };
  });
}

function summarizeVoiceDiff(originalDraft: string, finalSent: string): string {
  const origWords = originalDraft.trim().split(/\s+/).length;
  const finalWords = finalSent.trim().split(/\s+/).length;
  if (finalWords < origWords - 4) {
    return 'Tightened phrasing for a shorter, more direct reply.';
  }
  if (finalWords > origWords + 4) {
    return 'Added specific host detail to clarify expectations.';
  }
  return 'Adjusted phrasing to match host tone and sign-off.';
}

function buildLearnedDiff(
  originalDraft: string | null | undefined,
  finalSent: string,
  nowIso: string,
): LearnedVoiceDiff | null {
  if (!originalDraft) {
    return null;
  }
  const normalizedOrig = originalDraft.trim().replace(/\s+/g, ' ');
  const normalizedFinal = finalSent.trim().replace(/\s+/g, ' ');
  if (!normalizedOrig || !normalizedFinal || normalizedOrig === normalizedFinal) {
    return null;
  }
  return {
    id: `diff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    originalDraft: originalDraft.trim(),
    finalSent: finalSent.trim(),
    summary: summarizeVoiceDiff(originalDraft, finalSent),
    createdAt: nowIso,
  };
}

function collectCoachNotes(session: ActiveCoachSession | null): string[] {
  if (!session) {
    return [];
  }
  const notes: string[] = [];
  for (const turn of session.turns) {
    if (turn.sender === 'host' && turn.text.trim()) {
      notes.push(`Host coaching: ${turn.text.trim()}`);
    } else if (turn.note && turn.note.trim()) {
      notes.push(turn.note.trim());
    }
  }
  return notes;
}

function cloneSnapshot(snapshot: CohostDataSnapshot): CohostDataSnapshot {
  return {
    properties: snapshot.properties.map((p) => ({
      ...p,
      airbnbListingIds: [...p.airbnbListingIds],
      titleAliases: [...p.titleAliases],
      pricing: { ...p.pricing },
      vendors: p.vendors.map((v) => ({ ...v })),
      knowledgeSources: p.knowledgeSources.map((s) => ({ ...s })),
    })),
    rules: Object.fromEntries(
      Object.entries(snapshot.rules).map(([key, list]) => [key, list.map((r) => ({ ...r }))]),
    ),
    threads: Object.fromEntries(
      Object.entries(snapshot.threads).map(([key, list]) => [
        key,
        list.map((t) => ({
          ...t,
          discountAlert: t.discountAlert
            ? {
                ...t.discountAlert,
                allIn: { ...t.discountAlert.allIn },
                roomOnly: { ...t.discountAlert.roomOnly },
              }
            : null,
          activeCoachSession: t.activeCoachSession
            ? {
                ...t.activeCoachSession,
                turns: t.activeCoachSession.turns.map((turn) => ({ ...turn })),
              }
            : null,
        })),
      ]),
    ),
    messages: Object.fromEntries(
      Object.entries(snapshot.messages).map(([key, list]) => [
        key,
        list.map((m) => ({ ...m, archivedCoachNotes: [...m.archivedCoachNotes] })),
      ]),
    ),
    unmatchedEmails: snapshot.unmatchedEmails.map((u) => ({ ...u })),
    voiceProfile: {
      ...snapshot.voiceProfile,
      styleRules: [...snapshot.voiceProfile.styleRules],
      learnedDiffs: snapshot.voiceProfile.learnedDiffs.map((d) => ({ ...d })),
    },
    ingestionHealth: { ...snapshot.ingestionHealth },
    userProfile: {
      ...snapshot.userProfile,
      fcmTokens: [...snapshot.userProfile.fcmTokens],
    },
    allowedEmails: [...snapshot.allowedEmails],
  };
}

export class LocalCohostStore implements CohostStore {
  public readonly mode: 'local' | 'firestore';
  private snapshot: CohostDataSnapshot;
  private listeners = new Set<() => void>();

  constructor(initialSnapshot?: CohostDataSnapshot, mode: 'local' | 'firestore' = 'local') {
    this.mode = mode;
    this.snapshot = cloneSnapshot(initialSnapshot ?? createSeedSnapshot());
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = (): CohostDataSnapshot => {
    return this.snapshot;
  };

  protected commit(next: CohostDataSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  public async upsertProperty(input: UpsertPropertyInput): Promise<Property> {
    const trimmedName = input.name.trim();
    const cleanedIds = Array.from(
      new Set(input.airbnbListingIds.map((id) => id.trim()).filter((id) => id.length > 0)),
    );
    const cleanedPrimaryTitle = input.primaryListingTitle?.trim() || null;

    const existing = input.id
      ? this.snapshot.properties.find((property) => property.id === input.id)
      : undefined;

    if (existing) {
      const remainingAliases = existing.titleAliases.slice(1).filter((alias) => {
        if (!cleanedPrimaryTitle) {
          return true;
        }
        return alias.trim().toLowerCase() !== cleanedPrimaryTitle.toLowerCase();
      });
      const nextAliases = cleanedPrimaryTitle
        ? [cleanedPrimaryTitle, ...remainingAliases]
        : remainingAliases;

      const nextPricing: PropertyPricing = {
        nightlyFloor: Math.max(0, input.nightlyFloor),
        cleaningFee: Math.max(0, input.cleaningFee),
        localTaxPct:
          input.localTaxPct !== undefined
            ? Math.max(0, input.localTaxPct)
            : existing.pricing.localTaxPct,
        hostServiceFeePct:
          input.hostServiceFeePct !== undefined
            ? Math.min(99, Math.max(0, input.hostServiceFeePct))
            : existing.pricing.hostServiceFeePct,
      };

      const existingThreads = this.snapshot.threads[existing.id] ?? [];
      const nextThreadsForProperty = existingThreads.map((thread) => {
        if (!thread.discountAlert) {
          return thread;
        }
        const nextAlert = recalculateDiscountAlert(thread.discountAlert, nextPricing);
        const nextStatus: ThreadStatus =
          thread.status === 'flagged' || thread.status === 'needs_reply'
            ? nextAlert.triggersWarning
              ? 'flagged'
              : 'needs_reply'
            : thread.status;
        return {
          ...thread,
          status: nextStatus,
          discountAlert: nextAlert,
        };
      });
      const nextThreadsMap = {
        ...this.snapshot.threads,
        [existing.id]: nextThreadsForProperty,
      };

      const nextWelcomeGuideUrl =
        input.welcomeGuideUrl !== undefined
          ? normalizeWelcomeGuideUrl(input.welcomeGuideUrl)
          : (existing.welcomeGuideUrl ?? null);

      const updated: Property = {
        ...existing,
        name: trimmedName,
        airbnbListingIds: cleanedIds,
        titleAliases: nextAliases,
        welcomeGuideUrl: nextWelcomeGuideUrl,
        pricing: nextPricing,
      };

      const nextProperties = recomputePropertyCounts(
        this.snapshot.properties.map((property) =>
          property.id === existing.id ? updated : property,
        ),
        nextThreadsMap,
      );

      this.commit({
        ...this.snapshot,
        properties: nextProperties,
        threads: nextThreadsMap,
      });

      return nextProperties.find((property) => property.id === existing.id) ?? updated;
    }

    const slot = pickNextPropertySlot(this.snapshot.properties);
    const nextId = buildPropertySlugId(
      trimmedName,
      this.snapshot.properties.map((property) => property.id),
    );
    const created: Property = {
      id: nextId,
      name: trimmedName,
      code: slot.code,
      accentColor: slot.accentColor,
      airbnbListingIds: cleanedIds,
      titleAliases: cleanedPrimaryTitle ? [cleanedPrimaryTitle] : [],
      signOffOverride: null,
      welcomeGuideUrl: normalizeWelcomeGuideUrl(input.welcomeGuideUrl),
      needsReplyCount: 0,
      flaggedCount: 0,
      pricing: {
        nightlyFloor: Math.max(0, input.nightlyFloor),
        cleaningFee: Math.max(0, input.cleaningFee),
        localTaxPct:
          input.localTaxPct !== undefined ? Math.max(0, input.localTaxPct) : DEFAULT_LOCAL_TAX_PCT,
        hostServiceFeePct:
          input.hostServiceFeePct !== undefined
            ? Math.min(99, Math.max(0, input.hostServiceFeePct))
            : DEFAULT_HOST_SERVICE_FEE_PCT,
      },
      vendors: [],
      knowledgeSources: [],
    };

    this.commit({
      ...this.snapshot,
      properties: [...this.snapshot.properties, created],
      rules: {
        ...this.snapshot.rules,
        [nextId]: [],
      },
      threads: {
        ...this.snapshot.threads,
        [nextId]: [],
      },
    });

    return created;
  }

  public async updatePropertyPricing(
    propertyId: string,
    pricing: PropertyPricing,
  ): Promise<void> {
    const nextPricing: PropertyPricing = { ...pricing };
    const existingThreads = this.snapshot.threads[propertyId] ?? [];
    const nextThreadsForProperty = existingThreads.map((thread) => {
      if (!thread.discountAlert) {
        return thread;
      }
      const nextAlert = recalculateDiscountAlert(thread.discountAlert, nextPricing);
      const nextStatus: ThreadStatus =
        thread.status === 'flagged' || thread.status === 'needs_reply'
          ? nextAlert.triggersWarning
            ? 'flagged'
            : 'needs_reply'
          : thread.status;
      return {
        ...thread,
        status: nextStatus,
        discountAlert: nextAlert,
      };
    });
    const nextThreadsMap = {
      ...this.snapshot.threads,
      [propertyId]: nextThreadsForProperty,
    };
    const nextProperties = this.snapshot.properties.map((property) =>
      property.id === propertyId ? { ...property, pricing: nextPricing } : property,
    );
    this.commit({
      ...this.snapshot,
      properties: recomputePropertyCounts(nextProperties, nextThreadsMap),
      threads: nextThreadsMap,
    });
  }

  public async updatePropertySignOff(
    propertyId: string,
    signOffOverride: string | null,
  ): Promise<void> {
    const normalized = signOffOverride && signOffOverride.trim() ? signOffOverride.trim() : null;
    const nextProperties = this.snapshot.properties.map((property) =>
      property.id === propertyId ? { ...property, signOffOverride: normalized } : property,
    );
    this.commit({ ...this.snapshot, properties: nextProperties });
  }

  public async upsertVendor(propertyId: string, vendor: PropertyVendor): Promise<void> {
    const nextProperties = this.snapshot.properties.map((property) => {
      if (property.id !== propertyId) {
        return property;
      }
      const exists = property.vendors.some((v) => v.id === vendor.id);
      const nextVendors = exists
        ? property.vendors.map((v) => (v.id === vendor.id ? { ...vendor } : v))
        : [...property.vendors, { ...vendor }];
      return { ...property, vendors: nextVendors };
    });
    this.commit({ ...this.snapshot, properties: nextProperties });
  }

  public async deleteVendor(propertyId: string, vendorId: string): Promise<void> {
    const nextProperties = this.snapshot.properties.map((property) =>
      property.id === propertyId
        ? { ...property, vendors: property.vendors.filter((v) => v.id !== vendorId) }
        : property,
    );
    this.commit({ ...this.snapshot, properties: nextProperties });
  }

  public async upsertRule(propertyId: string, input: UpsertRuleInput): Promise<HouseRule> {
    const nowIso = new Date().toISOString();
    const existingList = this.snapshot.rules[propertyId] ?? [];
    const ruleId =
      input.id ?? `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const nextRule: HouseRule = {
      id: ruleId,
      propertyId,
      topic: input.topic.trim(),
      value: input.value.trim(),
      category: input.category,
      origin: input.origin.trim() || 'Host Direct Entry',
      isTemporary: input.isTemporary,
      expiresAt: input.isTemporary ? input.expiresAt : null,
      updatedAt: nowIso,
    };

    const exists = existingList.some((rule) => rule.id === ruleId);
    const nextList = exists
      ? existingList.map((rule) => (rule.id === ruleId ? nextRule : rule))
      : [...existingList, nextRule];

    this.commit({
      ...this.snapshot,
      rules: {
        ...this.snapshot.rules,
        [propertyId]: nextList,
      },
    });
    return nextRule;
  }

  public async deleteRule(propertyId: string, ruleId: string): Promise<void> {
    const existingList = this.snapshot.rules[propertyId] ?? [];
    this.commit({
      ...this.snapshot,
      rules: {
        ...this.snapshot.rules,
        [propertyId]: existingList.filter((rule) => rule.id !== ruleId),
      },
    });
  }

  public async mergeImportedRules(
    propertyId: string,
    sourceTitle: string,
    sourceType: KnowledgeSourceType,
    candidates: readonly ExtractedRuleCandidate[],
  ): Promise<void> {
    if (candidates.length === 0) {
      return;
    }

    const nowIso = new Date().toISOString();
    let nextRules = [...(this.snapshot.rules[propertyId] ?? [])];

    for (const candidate of candidates) {
      if (candidate.conflictRuleId) {
        nextRules = nextRules.map((existing) =>
          existing.id === candidate.conflictRuleId
            ? {
                ...existing,
                topic: candidate.topic.trim(),
                value: candidate.value.trim(),
                category: candidate.category,
                origin: `${sourceTitle} (Updated)`,
                updatedAt: nowIso,
              }
            : existing,
        );
      } else {
        nextRules.push({
          id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          propertyId,
          topic: candidate.topic.trim(),
          value: candidate.value.trim(),
          category: candidate.category,
          origin: sourceTitle,
          isTemporary: false,
          expiresAt: null,
          updatedAt: nowIso,
        });
      }
    }

    const nextSource: KnowledgeSource = {
      id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: sourceTitle,
      type: sourceType,
      uploadedAt: nowIso,
      ruleCount: candidates.length,
    };

    const nextProperties = this.snapshot.properties.map((property) =>
      property.id === propertyId
        ? {
            ...property,
            knowledgeSources: [nextSource, ...property.knowledgeSources],
          }
        : property,
    );

    this.commit({
      ...this.snapshot,
      properties: nextProperties,
      rules: {
        ...this.snapshot.rules,
        [propertyId]: nextRules,
      },
    });
  }

  public async setThreadCoachSession(
    propertyId: string,
    threadId: string,
    session: ActiveCoachSession | null,
    _options?: SetCoachSessionOptions,
  ): Promise<void> {
    const existingThreads = this.snapshot.threads[propertyId] ?? [];
    const nextThreads = existingThreads.map((thread) =>
      thread.id === threadId
        ? {
            ...thread,
            activeCoachSession: session
              ? {
                  ...session,
                  turns: session.turns.map((t) => ({ ...t })),
                }
              : null,
          }
        : thread,
    );
    this.commit({
      ...this.snapshot,
      threads: {
        ...this.snapshot.threads,
        [propertyId]: nextThreads,
      },
    });
  }

  public async markThreadSent(
    propertyId: string,
    threadId: string,
    options: MarkSentOptions,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const existingThreads = this.snapshot.threads[propertyId] ?? [];
    const targetThread = existingThreads.find((t) => t.id === threadId);
    if (!targetThread) {
      return;
    }

    const archivedNotes = options.loggedManually
      ? ['Logged manually by host.']
      : collectCoachNotes(targetThread.activeCoachSession);

    const existingMessages = this.snapshot.messages[threadId] ?? [];
    const updatedMessages: ThreadMessage[] = [
      ...existingMessages.map((msg) => ({ ...msg, unanswered: false })),
      {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        threadId,
        propertyId,
        gmailMessageId: null,
        contentFingerprint: `manual-${Date.now()}`,
        sender: 'host',
        senderName: options.senderName,
        body: options.finalText.trim(),
        sentAt: nowIso,
        unanswered: false,
        loggedManually: options.loggedManually,
        archivedCoachNotes: archivedNotes,
      },
    ];

    const nextStatus: ThreadStatus = 'sent';
    const nextThreadsForProperty = existingThreads.map((thread) =>
      thread.id === threadId
        ? {
            ...thread,
            status: nextStatus,
            unansweredCount: 0,
            lastMessageAt: nowIso,
            lastPreview: options.finalText.trim(),
            lastSentPreview: options.finalText.trim(),
            lastSentBy: options.senderName,
            activeCoachSession: null,
          }
        : thread,
    );

    const nextThreadsMap = {
      ...this.snapshot.threads,
      [propertyId]: nextThreadsForProperty,
    };

    const nextDiff = options.loggedManually
      ? null
      : buildLearnedDiff(options.originalDraft, options.finalText, nowIso);

    const nextLearnedDiffs = nextDiff
      ? [nextDiff, ...this.snapshot.voiceProfile.learnedDiffs].slice(0, MAX_LEARNED_DIFFS)
      : this.snapshot.voiceProfile.learnedDiffs;

    this.commit({
      ...this.snapshot,
      properties: recomputePropertyCounts(this.snapshot.properties, nextThreadsMap),
      threads: nextThreadsMap,
      messages: {
        ...this.snapshot.messages,
        [threadId]: updatedMessages,
      },
      voiceProfile: {
        ...this.snapshot.voiceProfile,
        learnedDiffs: nextLearnedDiffs,
      },
    });
  }

  public async dismissThread(propertyId: string, threadId: string): Promise<void> {
    const existingThreads = this.snapshot.threads[propertyId] ?? [];
    const existingMessages = this.snapshot.messages[threadId] ?? [];

    const nextStatus: ThreadStatus = 'dismissed';
    const nextThreadsForProperty = existingThreads.map((thread) =>
      thread.id === threadId
        ? {
            ...thread,
            status: nextStatus,
            unansweredCount: 0,
            activeCoachSession: null,
          }
        : thread,
    );

    const nextThreadsMap = {
      ...this.snapshot.threads,
      [propertyId]: nextThreadsForProperty,
    };

    this.commit({
      ...this.snapshot,
      properties: recomputePropertyCounts(this.snapshot.properties, nextThreadsMap),
      threads: nextThreadsMap,
      messages: {
        ...this.snapshot.messages,
        [threadId]: existingMessages.map((msg) => ({ ...msg, unanswered: false })),
      },
    });
  }

  public async deleteThread(propertyId: string, threadId: string): Promise<void> {
    const existingThreads = this.snapshot.threads[propertyId] ?? [];
    const nextThreadsForProperty = existingThreads.filter((thread) => thread.id !== threadId);
    const nextThreadsMap = {
      ...this.snapshot.threads,
      [propertyId]: nextThreadsForProperty,
    };

    const nextMessages: Record<string, ThreadMessage[]> = {};
    for (const [key, list] of Object.entries(this.snapshot.messages)) {
      if (key !== threadId) {
        nextMessages[key] = list;
      }
    }

    this.commit({
      ...this.snapshot,
      properties: recomputePropertyCounts(this.snapshot.properties, nextThreadsMap),
      threads: nextThreadsMap,
      messages: nextMessages,
    });
  }

  public async assignUnmatchedEmail(
    unmatchedId: string,
    propertyId: string,
  ): Promise<GuestThread | null> {
    const target = this.snapshot.unmatchedEmails.find(
      (item) => item.id === unmatchedId && !item.resolved,
    );
    if (!target) {
      return null;
    }

    const nowIso = target.receivedAt || new Date().toISOString();
    const newThreadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const parsed = target.rawParsed;

    const sourceMessages =
      parsed.messages.length > 0
        ? parsed.messages
        : [{ senderName: target.guestName, role: 'guest' as const, body: target.bodyPreview }];

    const newMessages: ThreadMessage[] = sourceMessages.map((msg, idx) => ({
      id: `msg-${Date.now()}-${idx}`,
      threadId: newThreadId,
      propertyId,
      gmailMessageId: target.gmailMessageId,
      contentFingerprint: `unmatched-${target.gmailMessageId}-${idx}`,
      sender: msg.role,
      senderName: msg.senderName,
      body: msg.body,
      sentAt: nowIso,
      unanswered: msg.role === 'guest',
      loggedManually: false,
      archivedCoachNotes: [],
    }));

    const targetProperty = this.snapshot.properties.find((p) => p.id === propertyId);
    const guestText = sourceMessages
      .filter((m) => m.role === 'guest')
      .map((m) => m.body)
      .join('\n\n');
    const discountAlert = targetProperty
      ? detectDiscountAlert(guestText || target.bodyPreview, parsed.nights, targetProperty.pricing)
      : null;
    const isFlagged = Boolean(discountAlert?.triggersWarning);

    const newThread: GuestThread = {
      id: newThreadId,
      propertyId,
      guestName: target.guestName,
      guestCount: parsed.guestCount,
      stayDates: parsed.stayDates,
      nights: parsed.nights,
      airbnbThreadId: parsed.airbnbThreadId,
      reservationCode: parsed.reservationCode,
      airbnbThreadUrl: parsed.airbnbThreadUrl,
      stage: parsed.stage,
      status: isFlagged ? 'flagged' : 'needs_reply',
      unansweredCount: newMessages.filter((m) => m.unanswered).length,
      lastMessageAt: nowIso,
      lastPreview: sourceMessages[sourceMessages.length - 1]?.body ?? target.bodyPreview,
      lastSentPreview: null,
      lastSentBy: null,
      discountAlert,
      activeCoachSession: null,
    };

    const nextThreadsMap = {
      ...this.snapshot.threads,
      [propertyId]: [newThread, ...(this.snapshot.threads[propertyId] ?? [])],
    };

    const nextUnmatched = this.snapshot.unmatchedEmails.map((item) =>
      item.id === unmatchedId ? { ...item, resolved: true } : item,
    );

    const propertiesWithLearnedMatch = this.snapshot.properties.map((property) => {
      if (property.id !== propertyId) {
        return property;
      }
      return {
        ...property,
        airbnbListingIds: mergeListingId(property.airbnbListingIds, parsed.airbnbListingId),
        titleAliases: mergeListingTitleAlias(property.titleAliases, parsed.listingTitleHint),
      };
    });

    this.commit({
      ...this.snapshot,
      properties: recomputePropertyCounts(propertiesWithLearnedMatch, nextThreadsMap),
      threads: nextThreadsMap,
      messages: {
        ...this.snapshot.messages,
        [newThreadId]: newMessages,
      },
      unmatchedEmails: nextUnmatched,
    });

    return newThread;
  }

  public async deleteUnmatchedEmail(unmatchedId: string): Promise<void> {
    this.commit({
      ...this.snapshot,
      unmatchedEmails: this.snapshot.unmatchedEmails.filter((item) => item.id !== unmatchedId),
    });
  }

  public async updateVoiceProfile(
    updates: Partial<Pick<VoiceProfile, 'styleRules' | 'signOffMode' | 'signOffText'>>,
  ): Promise<void> {
    this.commit({
      ...this.snapshot,
      voiceProfile: {
        ...this.snapshot.voiceProfile,
        ...updates,
        styleRules: updates.styleRules
          ? [...updates.styleRules]
          : [...this.snapshot.voiceProfile.styleRules],
      },
    });
  }

  public async deleteLearnedDiff(diffId: string): Promise<void> {
    this.commit({
      ...this.snapshot,
      voiceProfile: {
        ...this.snapshot.voiceProfile,
        learnedDiffs: this.snapshot.voiceProfile.learnedDiffs.filter((d) => d.id !== diffId),
      },
    });
  }

  public async updateUserPushPreferences(
    pushEnabled: boolean,
    fcmToken?: string,
  ): Promise<void> {
    const existingTokens = this.snapshot.userProfile.fcmTokens;
    const nextTokens =
      fcmToken && !existingTokens.includes(fcmToken)
        ? [...existingTokens, fcmToken]
        : [...existingTokens];

    this.commit({
      ...this.snapshot,
      userProfile: {
        ...this.snapshot.userProfile,
        pushEnabled,
        fcmTokens: nextTokens,
      },
    });
  }
}

export function createLocalCohostStore(initialSnapshot?: CohostDataSnapshot): LocalCohostStore {
  return new LocalCohostStore(initialSnapshot);
}
