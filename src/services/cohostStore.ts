import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  ActiveCoachSession,
  ExtractedRuleCandidate,
  CohostDataSnapshot,
  HouseRule,
  KnowledgeSourceType,
  Property,
  PropertyPricing,
  PropertyVendor,
  UnmatchedEmail,
  VoiceProfile,
} from '../types/cohost.ts';
import {
  parseIngestionHealthDoc,
  parseMessageDoc,
  parsePropertyDoc,
  parseRuleDoc,
  parseThreadDoc,
  parseUnmatchedEmailDoc,
  parseVoiceProfileDoc,
  readString,
  readStringArray,
} from '../utils/firestoreParsers.ts';
import { getFirebaseServices } from './firebase.ts';
import {
  createLocalCohostStore,
  LocalCohostStore,
  type CohostStore,
  type MarkSentOptions,
  type SetCoachSessionOptions,
  type UpsertRuleInput,
} from './localCohostStore.ts';

export {
  createLocalCohostStore,
  LocalCohostStore,
  type CohostStore,
  type MarkSentOptions,
  type SetCoachSessionOptions,
  type UpsertRuleInput,
};

function createEmptyLiveSnapshot(): CohostDataSnapshot {
  return {
    properties: [],
    rules: {},
    threads: {},
    messages: {},
    unmatchedEmails: [],
    voiceProfile: {
      styleRules: [
        'Keep replies concise, direct, and grounded in verified property rules.',
        'Never use em-dashes as thought separators.',
        'Avoid sycophantic openers like Certainly! or Absolutely!.',
      ],
      signOffMode: 'collective',
      signOffText: '',
      learnedDiffs: [],
    },
    ingestionHealth: {
      status: 'healthy',
      lastPushAt: null,
      lastEmailReceivedAt: null,
      watchExpiresAt: null,
      lastError: null,
      watchedEmail: '',
      dualInboxActive: true,
    },
    userProfile: {
      uid: '',
      email: '',
      displayName: 'Host',
      fcmTokens: [],
      pushEnabled: false,
      isAllowlisted: false,
      accessStatus: 'checking',
    },
    allowedEmails: [],
  };
}

export class FirestoreCohostStore extends LocalCohostStore {
  private authUnsubscriber: Unsubscribe | null = null;
  private accessUnsubscriber: Unsubscribe | null = null;
  private dataUnsubscribers: Unsubscribe[] = [];
  private watchedProperties = new Set<string>();
  private watchedThreads = new Set<string>();
  private coachSessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private coachSessionEpochs = new Map<string, number>();
  private storeGeneration = 0;

  constructor(initialSnapshot: CohostDataSnapshot = createEmptyLiveSnapshot()) {
    super(initialSnapshot, 'firestore');
    this.attachAuthListener();
  }

  private teardownDataListeners(): void {
    for (const unsub of this.dataUnsubscribers) {
      unsub();
    }
    this.dataUnsubscribers = [];
    this.watchedProperties.clear();
    this.watchedThreads.clear();
  }

  private teardownAccessListener(): void {
    if (this.accessUnsubscriber) {
      this.accessUnsubscriber();
      this.accessUnsubscriber = null;
    }
  }

  private cancelCoachTimer(propertyId: string, threadId: string): void {
    const timerKey = `${propertyId}/${threadId}`;
    const existingTimer = this.coachSessionTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.coachSessionTimers.delete(timerKey);
    }
  }

  private bumpCoachEpoch(propertyId: string, threadId: string): number {
    const timerKey = `${propertyId}/${threadId}`;
    const nextEpoch = (this.coachSessionEpochs.get(timerKey) ?? 0) + 1;
    this.coachSessionEpochs.set(timerKey, nextEpoch);
    return nextEpoch;
  }

  private clearCoachTimers(): void {
    this.storeGeneration += 1;
    for (const timer of this.coachSessionTimers.values()) {
      clearTimeout(timer);
    }
    this.coachSessionTimers.clear();
  }

  private attachAuthListener(): void {
    const services = getFirebaseServices();
    if (!services) {
      return;
    }

    this.authUnsubscriber = onAuthStateChanged(services.auth, (user) => {
      this.teardownAccessListener();
      this.teardownDataListeners();
      this.clearCoachTimers();

      if (!user) {
        this.commit(createEmptyLiveSnapshot());
        return;
      }

      this.verifyAccessAndAttach(user);
    });
  }

  private verifyAccessAndAttach(user: User): void {
    const services = getFirebaseServices();
    if (!services) {
      return;
    }

    const email = (user.email ?? '').trim().toLowerCase();
    const displayName = user.displayName?.trim() || email.split('@')[0] || 'Host';

    if (!email || !user.emailVerified) {
      const empty = createEmptyLiveSnapshot();
      this.commit({
        ...empty,
        userProfile: {
          ...empty.userProfile,
          uid: user.uid,
          email,
          displayName,
          isAllowlisted: false,
          accessStatus: 'denied',
        },
      });
      return;
    }

    const checkingBase = createEmptyLiveSnapshot();
    this.commit({
      ...checkingBase,
      userProfile: {
        ...checkingBase.userProfile,
        uid: user.uid,
        email,
        displayName,
        isAllowlisted: false,
        accessStatus: 'checking',
      },
    });

    this.accessUnsubscriber = onSnapshot(
      doc(services.db, 'config', 'access'),
      (snap) => {
        const allowedEmails = snap.exists()
          ? readStringArray(snap.data().allowedEmails)
              .map((entry) => entry.trim().toLowerCase())
              .filter(Boolean)
          : [];
        const isAllowed = allowedEmails.length > 0 && allowedEmails.includes(email);

        if (!isAllowed) {
          this.teardownDataListeners();
          this.clearCoachTimers();
          const empty = createEmptyLiveSnapshot();
          this.commit({
            ...empty,
            allowedEmails,
            userProfile: {
              ...empty.userProfile,
              uid: user.uid,
              email,
              displayName,
              isAllowlisted: false,
              accessStatus: 'denied',
            },
          });
          return;
        }

        const current = this.getSnapshot();
        this.commit({
          ...current,
          allowedEmails,
          userProfile: {
            ...current.userProfile,
            uid: user.uid,
            email,
            displayName,
            isAllowlisted: true,
            accessStatus: 'allowed',
          },
        });

        if (this.dataUnsubscribers.length === 0) {
          this.attachRealtimeListeners(user.uid);
        }
      },
      () => {
        // Firestore Rules return permission-denied when the signed-in email is not allowlisted.
        this.teardownDataListeners();
        this.clearCoachTimers();
        const empty = createEmptyLiveSnapshot();
        this.commit({
          ...empty,
          allowedEmails: [],
          userProfile: {
            ...empty.userProfile,
            uid: user.uid,
            email,
            displayName,
            isAllowlisted: false,
            accessStatus: 'denied',
          },
        });
      },
    );
  }

  private attachRealtimeListeners(uid: string): void {
    const services = getFirebaseServices();
    if (!services) {
      return;
    }

    const { db } = services;
    const handleListenerError = () => {
      // Keep cached offline data intact on transient listener errors.
    };

    const unsubProperties = onSnapshot(
      collection(db, 'properties'),
      (snap) => {
        const current = this.getSnapshot();
        const nextProperties: Property[] = snap.docs.map((docSnap) => {
          const fallback = current.properties.find((p) => p.id === docSnap.id);
          return parsePropertyDoc(docSnap.id, docSnap.data(), fallback?.name ?? 'Property');
        });

        for (const property of nextProperties) {
          this.watchPropertySubcollections(property.id);
        }
        this.commit({ ...this.getSnapshot(), properties: nextProperties });
      },
      handleListenerError,
    );

    const unsubUnmatched = onSnapshot(
      collection(db, 'unmatchedEmails'),
      (snap) => {
        const items: UnmatchedEmail[] = [];
        for (const docSnap of snap.docs) {
          const parsed = parseUnmatchedEmailDoc(docSnap.id, docSnap.data());
          if (!parsed.resolved) {
            items.push(parsed);
          }
        }
        this.commit({ ...this.getSnapshot(), unmatchedEmails: items });
      },
      handleListenerError,
    );

    const unsubVoice = onSnapshot(
      doc(db, 'config', 'voiceProfile'),
      (snap) => {
        if (!snap.exists()) {
          return;
        }
        const current = this.getSnapshot();
        this.commit({
          ...current,
          voiceProfile: parseVoiceProfileDoc(snap.data(), current.voiceProfile),
        });
      },
      handleListenerError,
    );

    const unsubHealth = onSnapshot(
      doc(db, 'config', 'ingestionHealth'),
      (snap) => {
        if (!snap.exists()) {
          return;
        }
        const current = this.getSnapshot();
        this.commit({
          ...current,
          ingestionHealth: parseIngestionHealthDoc(snap.data(), current.ingestionHealth),
        });
      },
      handleListenerError,
    );

    const unsubUser = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (!snap.exists()) {
          return;
        }
        const data = snap.data();
        const current = this.getSnapshot();
        this.commit({
          ...current,
          userProfile: {
            ...current.userProfile,
            email: readString(data.email, current.userProfile.email),
            displayName: readString(data.displayName, current.userProfile.displayName),
            fcmTokens: readStringArray(data.fcmTokens),
            pushEnabled:
              typeof data.pushEnabled === 'boolean'
                ? data.pushEnabled
                : current.userProfile.pushEnabled,
          },
        });
      },
      handleListenerError,
    );

    this.dataUnsubscribers.push(
      unsubProperties,
      unsubUnmatched,
      unsubVoice,
      unsubHealth,
      unsubUser,
    );
  }

  private watchPropertySubcollections(propertyId: string): void {
    const services = getFirebaseServices();
    if (!services || this.watchedProperties.has(propertyId)) {
      return;
    }
    this.watchedProperties.add(propertyId);

    const handleListenerError = () => {
      // Preserve local cached data on transient subcollection errors.
    };

    const unsubRules = onSnapshot(
      collection(services.db, 'properties', propertyId, 'rules'),
      (snap) => {
        const list = snap.docs.map((docSnap) =>
          parseRuleDoc(docSnap.id, propertyId, docSnap.data()),
        );
        const current = this.getSnapshot();
        this.commit({
          ...current,
          rules: { ...current.rules, [propertyId]: list },
        });
      },
      handleListenerError,
    );

    const unsubThreads = onSnapshot(
      collection(services.db, 'properties', propertyId, 'threads'),
      (snap) => {
        const list = snap.docs.map((docSnap) =>
          parseThreadDoc(docSnap.id, propertyId, docSnap.data()),
        );
        for (const thread of list) {
          this.watchThreadMessages(propertyId, thread.id);
        }
        const current = this.getSnapshot();
        this.commit({
          ...current,
          threads: { ...current.threads, [propertyId]: list },
        });
      },
      handleListenerError,
    );

    this.dataUnsubscribers.push(unsubRules, unsubThreads);
  }

  private watchThreadMessages(propertyId: string, threadId: string): void {
    const services = getFirebaseServices();
    const watchKey = `${propertyId}/${threadId}`;
    if (!services || this.watchedThreads.has(watchKey)) {
      return;
    }
    this.watchedThreads.add(watchKey);

    const unsubMessages = onSnapshot(
      collection(services.db, 'properties', propertyId, 'threads', threadId, 'messages'),
      (snap) => {
        const list = snap.docs
          .map((docSnap) => parseMessageDoc(docSnap.id, threadId, propertyId, docSnap.data()))
          .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
        const current = this.getSnapshot();
        this.commit({
          ...current,
          messages: { ...current.messages, [threadId]: list },
        });
      },
      () => {
        // Keep local cache on transient message listener errors.
      },
    );

    this.dataUnsubscribers.push(unsubMessages);
  }

  public override async updatePropertyPricing(
    propertyId: string,
    pricing: PropertyPricing,
  ): Promise<void> {
    await super.updatePropertyPricing(propertyId, pricing);
    const services = getFirebaseServices();
    if (services) {
      await updateDoc(doc(services.db, 'properties', propertyId), { pricing });
    }
  }

  public override async updatePropertySignOff(
    propertyId: string,
    signOffOverride: string | null,
  ): Promise<void> {
    await super.updatePropertySignOff(propertyId, signOffOverride);
    const services = getFirebaseServices();
    if (services) {
      const normalized = signOffOverride && signOffOverride.trim() ? signOffOverride.trim() : null;
      await updateDoc(doc(services.db, 'properties', propertyId), {
        signOffOverride: normalized,
      });
    }
  }

  public override async upsertVendor(
    propertyId: string,
    vendor: PropertyVendor,
  ): Promise<void> {
    await super.upsertVendor(propertyId, vendor);
    const services = getFirebaseServices();
    const updated = this.getSnapshot().properties.find((p) => p.id === propertyId);
    if (services && updated) {
      await updateDoc(doc(services.db, 'properties', propertyId), {
        vendors: updated.vendors,
      });
    }
  }

  public override async deleteVendor(propertyId: string, vendorId: string): Promise<void> {
    await super.deleteVendor(propertyId, vendorId);
    const services = getFirebaseServices();
    const updated = this.getSnapshot().properties.find((p) => p.id === propertyId);
    if (services && updated) {
      await updateDoc(doc(services.db, 'properties', propertyId), {
        vendors: updated.vendors,
      });
    }
  }

  public override async upsertRule(
    propertyId: string,
    input: UpsertRuleInput,
  ): Promise<HouseRule> {
    const saved = await super.upsertRule(propertyId, input);
    const services = getFirebaseServices();
    if (services) {
      await setDoc(doc(services.db, 'properties', propertyId, 'rules', saved.id), saved);
    }
    return saved;
  }

  public override async deleteRule(propertyId: string, ruleId: string): Promise<void> {
    await super.deleteRule(propertyId, ruleId);
    const services = getFirebaseServices();
    if (services) {
      await deleteDoc(doc(services.db, 'properties', propertyId, 'rules', ruleId));
    }
  }

  public override async mergeImportedRules(
    propertyId: string,
    sourceTitle: string,
    sourceType: KnowledgeSourceType,
    candidates: readonly ExtractedRuleCandidate[],
  ): Promise<void> {
    if (candidates.length === 0) {
      return;
    }
    const beforeRuleIds = new Set(
      (this.getSnapshot().rules[propertyId] ?? []).map((r) => r.id),
    );
    const conflictIds = new Set(
      candidates.map((c) => c.conflictRuleId).filter((id): id is string => Boolean(id)),
    );

    await super.mergeImportedRules(propertyId, sourceTitle, sourceType, candidates);

    const services = getFirebaseServices();
    if (!services) {
      return;
    }

    const snap = this.getSnapshot();
    const updatedRules = snap.rules[propertyId] ?? [];
    const updatedProperty = snap.properties.find((p) => p.id === propertyId);
    const batch = writeBatch(services.db);

    for (const rule of updatedRules) {
      if (!beforeRuleIds.has(rule.id) || conflictIds.has(rule.id)) {
        batch.set(doc(services.db, 'properties', propertyId, 'rules', rule.id), rule);
      }
    }

    if (updatedProperty) {
      batch.set(
        doc(services.db, 'properties', propertyId),
        { knowledgeSources: updatedProperty.knowledgeSources },
        { merge: true },
      );
    }

    await batch.commit();
  }

  public override async setThreadCoachSession(
    propertyId: string,
    threadId: string,
    session: ActiveCoachSession | null,
    options?: SetCoachSessionOptions,
  ): Promise<void> {
    const timerKey = `${propertyId}/${threadId}`;
    const startGeneration = this.storeGeneration;
    const epoch = this.bumpCoachEpoch(propertyId, threadId);
    this.cancelCoachTimer(propertyId, threadId);

    await super.setThreadCoachSession(propertyId, threadId, session, options);

    if (
      options?.skipRemoteSync ||
      this.storeGeneration !== startGeneration ||
      this.coachSessionEpochs.get(timerKey) !== epoch
    ) {
      return;
    }

    const services = getFirebaseServices();
    if (!services) {
      return;
    }

    const threadRef = doc(services.db, 'properties', propertyId, 'threads', threadId);
    if (session === null) {
      await setDoc(threadRef, { activeCoachSession: null }, { merge: true });
      return;
    }

    const clonedSession: ActiveCoachSession = {
      ...session,
      turns: session.turns.map((turn) => ({ ...turn })),
    };

    const timer = setTimeout(() => {
      this.coachSessionTimers.delete(timerKey);
      if (
        this.storeGeneration !== startGeneration ||
        this.coachSessionEpochs.get(timerKey) !== epoch
      ) {
        return;
      }
      void setDoc(threadRef, { activeCoachSession: clonedSession }, { merge: true }).catch(() => {
        // Keep optimistic local cache intact if Firestore write fails offline or after revocation.
      });
    }, 300);
    this.coachSessionTimers.set(timerKey, timer);
  }

  public override async markThreadSent(
    propertyId: string,
    threadId: string,
    options: MarkSentOptions,
  ): Promise<void> {
    this.bumpCoachEpoch(propertyId, threadId);
    this.cancelCoachTimer(propertyId, threadId);
    await super.markThreadSent(propertyId, threadId, options);
  }

  public override async dismissThread(propertyId: string, threadId: string): Promise<void> {
    this.bumpCoachEpoch(propertyId, threadId);
    this.cancelCoachTimer(propertyId, threadId);
    await super.dismissThread(propertyId, threadId);
  }

  public override async updateVoiceProfile(
    updates: Partial<Pick<VoiceProfile, 'styleRules' | 'signOffMode' | 'signOffText'>>,
  ): Promise<void> {
    await super.updateVoiceProfile(updates);
    const services = getFirebaseServices();
    if (services) {
      await setDoc(doc(services.db, 'config', 'voiceProfile'), this.getSnapshot().voiceProfile, {
        merge: true,
      });
    }
  }

  public override async deleteLearnedDiff(diffId: string): Promise<void> {
    await super.deleteLearnedDiff(diffId);
    const services = getFirebaseServices();
    if (services) {
      await setDoc(
        doc(services.db, 'config', 'voiceProfile'),
        { learnedDiffs: this.getSnapshot().voiceProfile.learnedDiffs },
        { merge: true },
      );
    }
  }

  public override async updateUserPushPreferences(
    pushEnabled: boolean,
    fcmToken?: string,
  ): Promise<void> {
    await super.updateUserPushPreferences(pushEnabled, fcmToken);
    const services = getFirebaseServices();
    const currentUser = services?.auth.currentUser;
    if (services && currentUser) {
      const profile = this.getSnapshot().userProfile;
      await setDoc(
        doc(services.db, 'users', currentUser.uid),
        {
          email: currentUser.email ?? profile.email,
          displayName: currentUser.displayName ?? profile.displayName,
          pushEnabled: profile.pushEnabled,
          fcmTokens: profile.fcmTokens,
        },
        { merge: true },
      );
    }
  }

  public dispose(): void {
    if (this.authUnsubscriber) {
      this.authUnsubscriber();
      this.authUnsubscriber = null;
    }
    this.teardownAccessListener();
    this.teardownDataListeners();
    this.clearCoachTimers();
  }
}

let defaultStore: CohostStore | null = null;

export function getCohostStore(): CohostStore {
  if (!defaultStore) {
    defaultStore = getFirebaseServices() ? new FirestoreCohostStore() : new LocalCohostStore();
  }
  return defaultStore;
}
