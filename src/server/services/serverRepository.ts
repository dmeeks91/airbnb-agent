import { createSeedSnapshot } from '../../data/seedData.ts';
import type {
  ActiveCoachSession,
  GuestThread,
  CohostDataSnapshot,
  HouseRule,
  IngestionHealth,
  Property,
  ThreadMessage,
  UnmatchedEmail,
  VoiceProfile,
} from '../../types/cohost.ts';
import { LocalCohostStore, type MarkSentOptions } from '../../services/localCohostStore.ts';
import {
  parseMessageDoc,
  parsePropertyDoc,
  parseRuleDoc,
  parseThreadDoc,
  parseUnmatchedEmailDoc,
  parseVoiceProfileDoc,
  readNullableString,
  readString,
  readStringArray,
} from '../../utils/firestoreParsers.ts';
import { mergeListingId, mergeListingTitleAlias } from '../../utils/propertyHelpers.ts';
import { getFirebaseAdminServices } from '../config/firebaseAdmin.ts';
import {
  IngestionService,
  type IngestionPushAdapter,
  type IngestionStorageAdapter,
  type ProcessedEmailRecord,
} from './ingestionService.ts';
import { computeMessageFingerprint } from './messageFingerprint.ts';
import { sendAndroidPushNotification, type PushRecipient } from './pushNotifier.ts';

export interface IngestionStateDoc {
  lastHistoryId: string | null;
  watchExpiresAt: string | null;
  watchedLabelId: string | null;
  watchedEmail: string;
}

export interface CohostServerRepository extends IngestionStorageAdapter {
  getAllowedEmails(): Promise<string[]>;
  getProperty(propertyId: string): Promise<Property | null>;
  getPropertyRules(propertyId: string): Promise<HouseRule[]>;
  getThread(propertyId: string, threadId: string): Promise<GuestThread | null>;
  getVoiceProfile(): Promise<VoiceProfile>;
  setCoachSession(
    propertyId: string,
    threadId: string,
    session: ActiveCoachSession | null,
  ): Promise<void>;
  markThreadSent(
    propertyId: string,
    threadId: string,
    options: MarkSentOptions,
  ): Promise<void>;
  dismissThread(propertyId: string, threadId: string): Promise<void>;
  assignUnmatchedEmail(unmatchedId: string, propertyId: string): Promise<GuestThread | null>;
  getIngestionState(): Promise<IngestionStateDoc>;
  updateIngestionState(partial: Partial<IngestionStateDoc>): Promise<void>;
  updateIngestionHealth(partial: Partial<IngestionHealth>): Promise<void>;
  loadPushRecipients(): Promise<PushRecipient[]>;
  removeStaleFcmTokens(uid: string, staleTokens: string[]): Promise<void>;
}

const NOOP_PUSH_ADAPTER: IngestionPushAdapter = {
  sendAlert: async () => undefined,
};

function parseEnvAllowedEmails(): string[] {
  return (process.env.ALLOWED_HOST_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export class InMemoryServerRepository implements CohostServerRepository {
  private store: LocalCohostStore;
  private readonly processed = new Map<string, ProcessedEmailRecord>();
  private ingestionState: IngestionStateDoc;
  private ingestionHealth: IngestionHealth;

  constructor(initialSnapshot?: CohostDataSnapshot) {
    const snap = initialSnapshot ?? createSeedSnapshot();
    this.store = new LocalCohostStore(snap);
    this.ingestionHealth = { ...snap.ingestionHealth };
    this.ingestionState = {
      lastHistoryId: '100001',
      watchExpiresAt: snap.ingestionHealth.watchExpiresAt,
      watchedLabelId: 'Label_Cohost',
      watchedEmail:
        process.env.GMAIL_WATCHED_EMAIL?.trim() || snap.ingestionHealth.watchedEmail,
    };
  }

  public async getAllowedEmails(): Promise<string[]> {
    const envEmails = parseEnvAllowedEmails();
    const snapEmails = this.store.getSnapshot().allowedEmails.map((e) => e.toLowerCase());
    return Array.from(new Set([...envEmails, ...snapEmails]));
  }

  public async hasProcessedEmail(gmailMessageId: string): Promise<boolean> {
    return this.processed.has(gmailMessageId);
  }

  public async recordProcessedEmail(record: ProcessedEmailRecord): Promise<void> {
    this.processed.set(record.gmailMessageId, { ...record });
  }

  public async listProperties(): Promise<Property[]> {
    return [...this.store.getSnapshot().properties];
  }

  public async getProperty(propertyId: string): Promise<Property | null> {
    return this.store.getSnapshot().properties.find((p) => p.id === propertyId) ?? null;
  }

  public async getPropertyRules(propertyId: string): Promise<HouseRule[]> {
    return [...(this.store.getSnapshot().rules[propertyId] ?? [])];
  }

  public async listAllThreads(): Promise<GuestThread[]> {
    return Object.values(this.store.getSnapshot().threads).flat();
  }

  public async getThread(propertyId: string, threadId: string): Promise<GuestThread | null> {
    return (
      (this.store.getSnapshot().threads[propertyId] ?? []).find((t) => t.id === threadId) ??
      null
    );
  }

  public async listThreadMessages(
    _propertyId: string,
    threadId: string,
  ): Promise<ThreadMessage[]> {
    return [...(this.store.getSnapshot().messages[threadId] ?? [])];
  }

  public async saveThreadAndMessages(params: {
    propertyId: string;
    thread: GuestThread;
    newMessages: ThreadMessage[];
    markAllExistingAnswered: boolean;
  }): Promise<void> {
    const snap = this.store.getSnapshot();
    const existingThreads = snap.threads[params.propertyId] ?? [];
    const exists = existingThreads.some((t) => t.id === params.thread.id);
    const nextThreads = exists
      ? existingThreads.map((t) => (t.id === params.thread.id ? { ...params.thread } : t))
      : [{ ...params.thread }, ...existingThreads];

    const existingMsgs = snap.messages[params.thread.id] ?? [];
    const baseMsgs = params.markAllExistingAnswered
      ? existingMsgs.map((m) => ({ ...m, unanswered: false }))
      : existingMsgs.map((m) => ({ ...m }));

    const nextMessages = [...baseMsgs, ...params.newMessages.map((m) => ({ ...m }))].sort(
      (a, b) => a.sentAt.localeCompare(b.sentAt),
    );

    this.store = new LocalCohostStore({
      ...snap,
      threads: {
        ...snap.threads,
        [params.propertyId]: nextThreads,
      },
      messages: {
        ...snap.messages,
        [params.thread.id]: nextMessages,
      },
    });
  }

  public async saveUnmatchedEmail(item: UnmatchedEmail): Promise<void> {
    const snap = this.store.getSnapshot();
    this.store = new LocalCohostStore({
      ...snap,
      unmatchedEmails: [{ ...item }, ...snap.unmatchedEmails],
    });
  }

  public async recomputePropertyCounters(propertyId: string): Promise<void> {
    const snap = this.store.getSnapshot();
    const propertyThreads = snap.threads[propertyId] ?? [];
    const needsReplyCount = propertyThreads.filter((t) => t.status === 'needs_reply').length;
    const flaggedCount = propertyThreads.filter((t) => t.status === 'flagged').length;
    this.store = new LocalCohostStore({
      ...snap,
      properties: snap.properties.map((p) =>
        p.id === propertyId ? { ...p, needsReplyCount, flaggedCount } : p,
      ),
    });
  }

  public async learnPropertyIdentifiers(
    propertyId: string,
    identifiers: { listingId?: string | null; titleHint?: string | null },
  ): Promise<void> {
    const snap = this.store.getSnapshot();
    this.store = new LocalCohostStore({
      ...snap,
      properties: snap.properties.map((p) =>
        p.id === propertyId
          ? {
              ...p,
              airbnbListingIds: mergeListingId(p.airbnbListingIds, identifiers.listingId),
              titleAliases: mergeListingTitleAlias(p.titleAliases, identifiers.titleHint),
            }
          : p,
      ),
    });
  }

  public async getVoiceProfile(): Promise<VoiceProfile> {
    return { ...this.store.getSnapshot().voiceProfile };
  }

  public async setCoachSession(
    propertyId: string,
    threadId: string,
    session: ActiveCoachSession | null,
  ): Promise<void> {
    await this.store.setThreadCoachSession(propertyId, threadId, session);
  }

  public async markThreadSent(
    propertyId: string,
    threadId: string,
    options: MarkSentOptions,
  ): Promise<void> {
    await this.store.markThreadSent(propertyId, threadId, options);
  }

  public async dismissThread(propertyId: string, threadId: string): Promise<void> {
    await this.store.dismissThread(propertyId, threadId);
  }

  public async assignUnmatchedEmail(
    unmatchedId: string,
    propertyId: string,
  ): Promise<GuestThread | null> {
    const snap = this.store.getSnapshot();
    const target = snap.unmatchedEmails.find(
      (item) => item.id === unmatchedId && !item.resolved,
    );
    const property = await this.getProperty(propertyId);
    if (!target || !property) {
      return null;
    }

    const propertyThreads = snap.threads[propertyId] ?? [];
    const ingestion = new IngestionService(this, NOOP_PUSH_ADAPTER);
    const outcome = await ingestion.ingestIntoProperty({
      property,
      propertyThreads,
      parsed: target.rawParsed,
      recordProcessed: false,
      sendPush: false,
    });

    const updatedSnap = this.store.getSnapshot();
    this.store = new LocalCohostStore({
      ...updatedSnap,
      unmatchedEmails: updatedSnap.unmatchedEmails.map((item) =>
        item.id === unmatchedId ? { ...item, resolved: true } : item,
      ),
    });

    if ('threadId' in outcome && outcome.threadId) {
      return this.getThread(propertyId, outcome.threadId);
    }
    return null;
  }

  public async getIngestionState(): Promise<IngestionStateDoc> {
    return { ...this.ingestionState };
  }

  public async updateIngestionState(partial: Partial<IngestionStateDoc>): Promise<void> {
    this.ingestionState = { ...this.ingestionState, ...partial };
  }

  public async updateIngestionHealth(partial: Partial<IngestionHealth>): Promise<void> {
    this.ingestionHealth = { ...this.ingestionHealth, ...partial };
  }

  public async loadPushRecipients(): Promise<PushRecipient[]> {
    const profile = this.store.getSnapshot().userProfile;
    if (!profile.pushEnabled || profile.fcmTokens.length === 0) {
      return [];
    }
    return [{ uid: profile.uid, tokens: [...profile.fcmTokens] }];
  }

  public async removeStaleFcmTokens(_uid: string, staleTokens: string[]): Promise<void> {
    const snap = this.store.getSnapshot();
    const staleSet = new Set(staleTokens);
    this.store = new LocalCohostStore({
      ...snap,
      userProfile: {
        ...snap.userProfile,
        fcmTokens: snap.userProfile.fcmTokens.filter((token) => !staleSet.has(token)),
      },
    });
  }

  public getSnapshot(): CohostDataSnapshot {
    return this.store.getSnapshot();
  }

  public getIngestionHealth(): IngestionHealth {
    return { ...this.ingestionHealth };
  }
}

class FirestoreServerRepository implements CohostServerRepository {
  private readonly fallback = new InMemoryServerRepository();

  public async getAllowedEmails(): Promise<string[]> {
    const envEmails = parseEnvAllowedEmails();
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.getAllowedEmails();
    }
    const snap = await admin.db.doc('config/access').get();
    const docEmails = readStringArray(snap.data()?.allowedEmails).map((e) =>
      e.trim().toLowerCase(),
    );
    return Array.from(new Set([...envEmails, ...docEmails]));
  }

  public async hasProcessedEmail(gmailMessageId: string): Promise<boolean> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.hasProcessedEmail(gmailMessageId);
    }
    const snap = await admin.db.doc(`processedEmails/${gmailMessageId}`).get();
    return snap.exists;
  }

  public async recordProcessedEmail(record: ProcessedEmailRecord): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.recordProcessedEmail(record);
    }
    await admin.db.doc(`processedEmails/${record.gmailMessageId}`).set(record);
  }

  public async listProperties(): Promise<Property[]> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.listProperties();
    }
    const snap = await admin.db.collection('properties').get();
    return snap.docs.map((docSnap) => parsePropertyDoc(docSnap.id, docSnap.data()));
  }

  public async getProperty(propertyId: string): Promise<Property | null> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.getProperty(propertyId);
    }
    const snap = await admin.db.doc(`properties/${propertyId}`).get();
    const data = snap.data();
    if (!snap.exists || !data) {
      return null;
    }
    return parsePropertyDoc(snap.id, data);
  }

  public async getPropertyRules(propertyId: string): Promise<HouseRule[]> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.getPropertyRules(propertyId);
    }
    const snap = await admin.db.collection(`properties/${propertyId}/rules`).get();
    return snap.docs.map((docSnap) => parseRuleDoc(docSnap.id, propertyId, docSnap.data()));
  }

  public async listAllThreads(): Promise<GuestThread[]> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.listAllThreads();
    }
    const properties = await this.listProperties();
    const all: GuestThread[] = [];
    for (const prop of properties) {
      const snap = await admin.db.collection(`properties/${prop.id}/threads`).get();
      for (const docSnap of snap.docs) {
        all.push(parseThreadDoc(docSnap.id, prop.id, docSnap.data()));
      }
    }
    return all;
  }

  public async getThread(propertyId: string, threadId: string): Promise<GuestThread | null> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.getThread(propertyId, threadId);
    }
    const snap = await admin.db.doc(`properties/${propertyId}/threads/${threadId}`).get();
    const data = snap.data();
    if (!snap.exists || !data) {
      return null;
    }
    return parseThreadDoc(snap.id, propertyId, data);
  }

  public async listThreadMessages(
    propertyId: string,
    threadId: string,
  ): Promise<ThreadMessage[]> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.listThreadMessages(propertyId, threadId);
    }
    const snap = await admin.db
      .collection(`properties/${propertyId}/threads/${threadId}/messages`)
      .orderBy('sentAt', 'asc')
      .get();
    return snap.docs.map((docSnap) =>
      parseMessageDoc(docSnap.id, threadId, propertyId, docSnap.data()),
    );
  }

  public async saveThreadAndMessages(params: {
    propertyId: string;
    thread: GuestThread;
    newMessages: ThreadMessage[];
    markAllExistingAnswered: boolean;
  }): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.saveThreadAndMessages(params);
    }
    const batch = admin.db.batch();
    const threadRef = admin.db.doc(
      `properties/${params.propertyId}/threads/${params.thread.id}`,
    );
    batch.set(threadRef, params.thread, { merge: true });

    if (params.markAllExistingAnswered) {
      const existingSnap = await admin.db
        .collection(`properties/${params.propertyId}/threads/${params.thread.id}/messages`)
        .where('unanswered', '==', true)
        .get();
      for (const docSnap of existingSnap.docs) {
        batch.update(docSnap.ref, { unanswered: false });
      }
    }

    for (const msg of params.newMessages) {
      const msgRef = admin.db.doc(
        `properties/${params.propertyId}/threads/${params.thread.id}/messages/${msg.id}`,
      );
      batch.set(msgRef, msg);
    }

    await batch.commit();
  }

  public async saveUnmatchedEmail(item: UnmatchedEmail): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.saveUnmatchedEmail(item);
    }
    await admin.db.doc(`unmatchedEmails/${item.id}`).set(item);
  }

  public async recomputePropertyCounters(propertyId: string): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.recomputePropertyCounters(propertyId);
    }
    const propertyRef = admin.db.doc(`properties/${propertyId}`);
    const threadsQuery = admin.db.collection(`properties/${propertyId}/threads`);

    await admin.db.runTransaction(async (tx) => {
      const snap = await tx.get(threadsQuery);
      let needsReplyCount = 0;
      let flaggedCount = 0;
      for (const docSnap of snap.docs) {
        const status = docSnap.data().status;
        if (status === 'needs_reply') {
          needsReplyCount++;
        } else if (status === 'flagged') {
          flaggedCount++;
        }
      }
      tx.set(propertyRef, { needsReplyCount, flaggedCount }, { merge: true });
    });
  }

  public async learnPropertyIdentifiers(
    propertyId: string,
    identifiers: { listingId?: string | null; titleHint?: string | null },
  ): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.learnPropertyIdentifiers(propertyId, identifiers);
    }
    const propertyRef = admin.db.doc(`properties/${propertyId}`);
    await admin.db.runTransaction(async (tx) => {
      const snap = await tx.get(propertyRef);
      const data = snap.data();
      if (!snap.exists || !data) {
        return;
      }
      const existingIds = readStringArray(data.airbnbListingIds);
      const existingAliases = readStringArray(data.titleAliases);
      const nextIds = mergeListingId(existingIds, identifiers.listingId);
      const nextAliases = mergeListingTitleAlias(existingAliases, identifiers.titleHint);
      if (nextIds.length !== existingIds.length || nextAliases.length !== existingAliases.length) {
        tx.set(
          propertyRef,
          { airbnbListingIds: nextIds, titleAliases: nextAliases },
          { merge: true },
        );
      }
    });
  }

  public async getVoiceProfile(): Promise<VoiceProfile> {
    const admin = getFirebaseAdminServices();
    const fallbackProfile = await this.fallback.getVoiceProfile();
    if (!admin) {
      return fallbackProfile;
    }
    const snap = await admin.db.doc('config/voiceProfile').get();
    const data = snap.data();
    if (!snap.exists || !data) {
      return fallbackProfile;
    }
    return parseVoiceProfileDoc(data, fallbackProfile);
  }

  public async setCoachSession(
    propertyId: string,
    threadId: string,
    session: ActiveCoachSession | null,
  ): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.setCoachSession(propertyId, threadId, session);
    }
    await admin.db
      .doc(`properties/${propertyId}/threads/${threadId}`)
      .set({ activeCoachSession: session }, { merge: true });
  }

  public async markThreadSent(
    propertyId: string,
    threadId: string,
    options: MarkSentOptions,
  ): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.markThreadSent(propertyId, threadId, options);
    }

    const nowIso = new Date().toISOString();
    const thread = await this.getThread(propertyId, threadId);
    if (!thread) {
      return;
    }

    const trimmedFinal = options.finalText.trim();
    const msgId = `msg-sent-${Date.now()}`;
    const newMsg: ThreadMessage = {
      id: msgId,
      threadId,
      propertyId,
      gmailMessageId: null,
      contentFingerprint: computeMessageFingerprint('host', options.senderName, trimmedFinal),
      sender: 'host',
      senderName: options.senderName,
      body: trimmedFinal,
      sentAt: nowIso,
      unanswered: false,
      loggedManually: options.loggedManually,
      archivedCoachNotes: options.loggedManually
        ? ['Logged manually by host.']
        : (thread.activeCoachSession?.turns
            .map((t) => (t.sender === 'host' ? `Host coaching: ${t.text}` : t.note))
            .filter((n): n is string => Boolean(n && n.trim())) ?? []),
    };

    await this.saveThreadAndMessages({
      propertyId,
      thread: {
        ...thread,
        status: 'sent',
        unansweredCount: 0,
        lastMessageAt: nowIso,
        lastPreview: trimmedFinal,
        lastSentPreview: trimmedFinal,
        lastSentBy: options.senderName,
        activeCoachSession: null,
      },
      newMessages: [newMsg],
      markAllExistingAnswered: true,
    });
    await this.recomputePropertyCounters(propertyId);

    if (
      !options.loggedManually &&
      options.originalDraft &&
      options.originalDraft.trim() !== trimmedFinal
    ) {
      const profile = await this.getVoiceProfile();
      const nextDiffs = [
        {
          id: `diff-${Date.now()}`,
          originalDraft: options.originalDraft.trim(),
          finalSent: trimmedFinal,
          summary: 'Host edited AI draft before sending.',
          createdAt: nowIso,
        },
        ...profile.learnedDiffs,
      ].slice(0, 15);
      await admin.db
        .doc('config/voiceProfile')
        .set({ learnedDiffs: nextDiffs }, { merge: true });
    }
  }

  public async dismissThread(propertyId: string, threadId: string): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.dismissThread(propertyId, threadId);
    }
    const thread = await this.getThread(propertyId, threadId);
    if (!thread) {
      return;
    }
    await this.saveThreadAndMessages({
      propertyId,
      thread: {
        ...thread,
        status: 'dismissed',
        unansweredCount: 0,
        activeCoachSession: null,
      },
      newMessages: [],
      markAllExistingAnswered: true,
    });
    await this.recomputePropertyCounters(propertyId);
  }

  public async assignUnmatchedEmail(
    unmatchedId: string,
    propertyId: string,
  ): Promise<GuestThread | null> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.assignUnmatchedEmail(unmatchedId, propertyId);
    }
    const snap = await admin.db.doc(`unmatchedEmails/${unmatchedId}`).get();
    const data = snap.data();
    if (!snap.exists || !data || Boolean(data.resolved)) {
      return null;
    }

    const property = await this.getProperty(propertyId);
    if (!property) {
      return null;
    }

    const unmatched = parseUnmatchedEmailDoc(snap.id, data);
    const propertyThreadsSnap = await admin.db
      .collection(`properties/${propertyId}/threads`)
      .get();
    const propertyThreads = propertyThreadsSnap.docs.map((docSnap) =>
      parseThreadDoc(docSnap.id, propertyId, docSnap.data()),
    );

    const ingestion = new IngestionService(this, NOOP_PUSH_ADAPTER);
    const outcome = await ingestion.ingestIntoProperty({
      property,
      propertyThreads,
      parsed: unmatched.rawParsed,
      recordProcessed: false,
      sendPush: false,
    });

    await admin.db.doc(`unmatchedEmails/${unmatchedId}`).update({ resolved: true });

    if ('threadId' in outcome && outcome.threadId) {
      return this.getThread(propertyId, outcome.threadId);
    }
    return null;
  }

  public async getIngestionState(): Promise<IngestionStateDoc> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.getIngestionState();
    }
    const snap = await admin.db.doc('config/ingestionState').get();
    const data = snap.data();
    return {
      lastHistoryId: readNullableString(data?.lastHistoryId),
      watchExpiresAt: readNullableString(data?.watchExpiresAt),
      watchedLabelId: readNullableString(data?.watchedLabelId),
      watchedEmail: readString(
        data?.watchedEmail,
        process.env.GMAIL_WATCHED_EMAIL?.trim() ?? '',
      ),
    };
  }

  public async updateIngestionState(partial: Partial<IngestionStateDoc>): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.updateIngestionState(partial);
    }
    await admin.db.doc('config/ingestionState').set(partial, { merge: true });
  }

  public async updateIngestionHealth(partial: Partial<IngestionHealth>): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.updateIngestionHealth(partial);
    }
    await admin.db.doc('config/ingestionHealth').set(partial, { merge: true });
  }

  public async loadPushRecipients(): Promise<PushRecipient[]> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.loadPushRecipients();
    }
    const snap = await admin.db.collection('users').where('pushEnabled', '==', true).get();
    const recipients: PushRecipient[] = [];
    for (const docSnap of snap.docs) {
      const tokens = readStringArray(docSnap.data().fcmTokens).filter((t) => t.length > 0);
      if (tokens.length > 0) {
        recipients.push({ uid: docSnap.id, tokens });
      }
    }
    return recipients;
  }

  public async removeStaleFcmTokens(uid: string, staleTokens: string[]): Promise<void> {
    const admin = getFirebaseAdminServices();
    if (!admin) {
      return this.fallback.removeStaleFcmTokens(uid, staleTokens);
    }
    const userRef = admin.db.doc(`users/${uid}`);
    const snap = await userRef.get();
    if (!snap.exists) {
      return;
    }
    const staleSet = new Set(staleTokens);
    const remaining = readStringArray(snap.data()?.fcmTokens).filter(
      (token) => !staleSet.has(token),
    );
    await userRef.update({ fcmTokens: remaining });
  }
}

let cachedRepo: CohostServerRepository | null = null;

export function getServerRepository(): CohostServerRepository {
  if (!cachedRepo) {
    cachedRepo = getFirebaseAdminServices()
      ? new FirestoreServerRepository()
      : new InMemoryServerRepository();
  }
  return cachedRepo;
}

export function createPushAdapter(repo: CohostServerRepository): IngestionPushAdapter {
  return {
    sendAlert: async (payload) => {
      await sendAndroidPushNotification(payload, {
        loadRecipients: () => repo.loadPushRecipients(),
        removeStaleTokens: (uid, stale) => repo.removeStaleFcmTokens(uid, stale),
      });
    },
  };
}
