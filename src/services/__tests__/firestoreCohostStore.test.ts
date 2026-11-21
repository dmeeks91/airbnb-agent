import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedSnapshot } from '../../data/seedData.ts';
import type { ActiveCoachSession } from '../../types/cohost.ts';

type AuthUserLike = {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
};

type AccessSnapLike = {
  exists: () => boolean;
  data: () => Record<string, unknown>;
};

const { setDocMock, docMock, onAuthStateChangedMock, onSnapshotMock, getFirebaseServicesMock } =
  vi.hoisted(() => ({
    setDocMock: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
    docMock: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    onAuthStateChangedMock: vi.fn<
      (auth: unknown, cb: (user: AuthUserLike | null) => void) => () => void
    >(() => vi.fn()),
    onSnapshotMock: vi.fn<
      (
        ref: { path?: string },
        onNext: (snap: AccessSnapLike) => void,
        onError?: (err: Error) => void,
      ) => () => void
    >(() => vi.fn()),
    getFirebaseServicesMock: vi.fn(() => ({
      app: {},
      auth: { currentUser: null },
      db: {},
      vapidKey: '',
    })),
  }));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: onAuthStateChangedMock,
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  deleteDoc: vi.fn(() => Promise.resolve()),
  doc: docMock,
  onSnapshot: onSnapshotMock,
  setDoc: setDocMock,
  updateDoc: vi.fn(() => Promise.resolve()),
  writeBatch: vi.fn(),
}));

vi.mock('../firebase.ts', () => ({
  getFirebaseServices: getFirebaseServicesMock,
}));

import { FirestoreCohostStore } from '../cohostStore.ts';

function buildSampleSession(draftText: string): ActiveCoachSession {
  return {
    hasNewGuestMessageSinceEdit: false,
    turns: [
      {
        id: 'turn-1',
        sender: 'agent',
        text: 'Draft ready.',
        note: 'Grounded in house rules.',
        draft: draftText,
        originalDraft: draftText,
        editedByUser: true,
        createdAt: '2026-11-20T06:00:00.000Z',
      },
    ],
  };
}

describe('FirestoreCohostStore debounced coach session timer cancellation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocMock.mockReset();
    setDocMock.mockImplementation(() => Promise.resolve());
    docMock.mockClear();
    onAuthStateChangedMock.mockReset();
    onAuthStateChangedMock.mockImplementation(() => vi.fn());
    onSnapshotMock.mockReset();
    onSnapshotMock.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels a pending debounced coach session write when markThreadSent is called within 300ms', async () => {
    const store = new FirestoreCohostStore(createSeedSnapshot());

    await store.setThreadCoachSession(
      'prop-coastal-loft',
      'thread-marcus',
      buildSampleSession('Hi Marcus, 1 PM bag drop works great.'),
    );

    await vi.advanceTimersByTimeAsync(200);
    expect(setDocMock).not.toHaveBeenCalled();

    await store.markThreadSent('prop-coastal-loft', 'thread-marcus', {
      finalText: 'Hi Marcus, 1 PM bag drop works great.',
      originalDraft: 'Hi Marcus, bag drop is available.',
      senderName: 'Alex',
      loggedManually: false,
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(setDocMock).not.toHaveBeenCalled();

    const updatedThread = store
      .getSnapshot()
      .threads['prop-coastal-loft'].find((t) => t.id === 'thread-marcus');
    expect(updatedThread?.status).toBe('sent');
    expect(updatedThread?.activeCoachSession).toBeNull();

    store.dispose();
  });

  it('cancels a pending debounced coach session write when dismissThread is called within 300ms', async () => {
    const store = new FirestoreCohostStore(createSeedSnapshot());

    await store.setThreadCoachSession(
      'prop-mountain-chalet',
      'thread-sarah',
      buildSampleSession('Hi Sarah, thanks for reaching out.'),
    );

    await vi.advanceTimersByTimeAsync(150);
    expect(setDocMock).not.toHaveBeenCalled();

    await store.dismissThread('prop-mountain-chalet', 'thread-sarah');

    await vi.advanceTimersByTimeAsync(500);
    expect(setDocMock).not.toHaveBeenCalled();

    const updatedThread = store
      .getSnapshot()
      .threads['prop-mountain-chalet'].find((t) => t.id === 'thread-sarah');
    expect(updatedThread?.status).toBe('dismissed');
    expect(updatedThread?.activeCoachSession).toBeNull();

    store.dispose();
  });

  it('cancels only the targeted thread timer while allowing other threads debounced writes to commit', async () => {
    const store = new FirestoreCohostStore(createSeedSnapshot());

    await store.setThreadCoachSession(
      'prop-coastal-loft',
      'thread-marcus',
      buildSampleSession('Stale Marcus edit'),
    );
    await store.setThreadCoachSession(
      'prop-mountain-chalet',
      'thread-sarah',
      buildSampleSession('Active Sarah edit'),
    );

    await vi.advanceTimersByTimeAsync(100);
    await store.markThreadSent('prop-coastal-loft', 'thread-marcus', {
      finalText: 'Sent Marcus reply',
      originalDraft: 'Initial Marcus draft',
      senderName: 'Alex',
      loggedManually: false,
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [targetRef, payload, options] = setDocMock.mock.calls[0];
    expect(targetRef).toEqual({ path: 'properties/prop-mountain-chalet/threads/thread-sarah' });
    expect(payload).toEqual({
      activeCoachSession: buildSampleSession('Active Sarah edit'),
    });
    expect(options).toEqual({ merge: true });

    store.dispose();
  });

  it('immediately clears activeCoachSession and cancels any pending timer when passed null', async () => {
    const store = new FirestoreCohostStore(createSeedSnapshot());

    await store.setThreadCoachSession(
      'prop-coastal-loft',
      'thread-marcus',
      buildSampleSession('Pending edit to be cleared'),
    );

    await vi.advanceTimersByTimeAsync(100);
    await store.setThreadCoachSession('prop-coastal-loft', 'thread-marcus', null);

    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock.mock.calls[0]?.[1]).toEqual({ activeCoachSession: null });

    await vi.advanceTimersByTimeAsync(500);
    expect(setDocMock).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it('skips redundant remote setDoc and cancels pending timers when skipRemoteSync is true', async () => {
    const store = new FirestoreCohostStore(createSeedSnapshot());

    await store.setThreadCoachSession(
      'prop-coastal-loft',
      'thread-marcus',
      buildSampleSession('Pending client edit'),
    );
    await vi.advanceTimersByTimeAsync(150);

    await store.setThreadCoachSession(
      'prop-coastal-loft',
      'thread-marcus',
      buildSampleSession('Authoritative server session'),
      { skipRemoteSync: true },
    );

    await vi.advanceTimersByTimeAsync(500);
    expect(setDocMock).not.toHaveBeenCalled();

    const updatedThread = store
      .getSnapshot()
      .threads['prop-coastal-loft'].find((t) => t.id === 'thread-marcus');
    expect(updatedThread?.activeCoachSession?.turns[0]?.draft).toBe(
      'Authoritative server session',
    );

    store.dispose();
  });

  it('catches rejected background setDoc writes inside the debounce timer without unhandled rejections', async () => {
    setDocMock.mockRejectedValueOnce(new Error('offline permission-denied'));
    const store = new FirestoreCohostStore(createSeedSnapshot());

    await store.setThreadCoachSession(
      'prop-coastal-loft',
      'thread-marcus',
      buildSampleSession('Draft edited while offline'),
    );

    await vi.advanceTimersByTimeAsync(350);
    expect(setDocMock).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it('cancels pending coach timers and wipes cached property data when access is revoked', async () => {
    let authCallback: ((user: AuthUserLike | null) => void) | null = null;
    let accessNextCallback: ((snap: AccessSnapLike) => void) | null = null;
    let accessErrorCallback: ((err: Error) => void) | null = null;

    onAuthStateChangedMock.mockImplementation((_auth, cb) => {
      authCallback = cb;
      return vi.fn();
    });

    onSnapshotMock.mockImplementation((ref, onNext, onError) => {
      if (ref?.path === 'config/access') {
        accessNextCallback = onNext;
        accessErrorCallback = onError ?? null;
      }
      return vi.fn();
    });

    const store = new FirestoreCohostStore(createSeedSnapshot());
    expect(authCallback).not.toBeNull();
    authCallback!({
      uid: 'u-alex',
      email: 'alex@example.com',
      displayName: 'Alex',
      emailVerified: true,
    });

    // Grant access first, then queue a debounced coach write
    expect(accessNextCallback).not.toBeNull();
    accessNextCallback!({
      exists: () => true,
      data: () => ({ allowedEmails: ['alex@example.com'] }),
    });

    await store.setThreadCoachSession(
      'prop-coastal-loft',
      'thread-marcus',
      buildSampleSession('Edit right before revocation'),
    );
    await vi.advanceTimersByTimeAsync(100);

    // Revoke access via config/access snapshot update
    accessNextCallback!({
      exists: () => true,
      data: () => ({ allowedEmails: ['other@example.com'] }),
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(setDocMock).not.toHaveBeenCalled();
    expect(store.getSnapshot().userProfile.accessStatus).toBe('denied');
    expect(store.getSnapshot().properties).toHaveLength(0);
    expect(Object.keys(store.getSnapshot().rules)).toHaveLength(0);

    // Also verify permission-denied error branch cancels timers and wipes data
    await store.setThreadCoachSession(
      'prop-coastal-loft',
      'thread-marcus',
      buildSampleSession('Edit before permission error'),
    );
    expect(accessErrorCallback).not.toBeNull();
    accessErrorCallback!(new Error('permission-denied'));

    await vi.advanceTimersByTimeAsync(500);
    expect(setDocMock).not.toHaveBeenCalled();
    expect(store.getSnapshot().userProfile.accessStatus).toBe('denied');
    expect(store.getSnapshot().properties).toHaveLength(0);

    store.dispose();
  });

  it('prevents an unawaited setThreadCoachSession microtask continuation from scheduling a timer after markThreadSent or dismissThread in the same tick', async () => {
    const store = new FirestoreCohostStore(createSeedSnapshot());

    // Simulate React onChange (`void onUpdateDraftEdit(...)`) immediately followed by tap on Mark as Sent
    const pendingEdit = store.setThreadCoachSession(
      'prop-coastal-loft',
      'thread-marcus',
      buildSampleSession('Same-tick edit before Mark as Sent'),
    );
    await store.markThreadSent('prop-coastal-loft', 'thread-marcus', {
      finalText: 'Same-tick edit before Mark as Sent',
      originalDraft: 'Original draft',
      senderName: 'Alex',
      loggedManually: false,
    });
    await pendingEdit;

    // Same for dismissThread in the same tick
    const pendingDismissEdit = store.setThreadCoachSession(
      'prop-mountain-chalet',
      'thread-sarah',
      buildSampleSession('Same-tick edit before dismiss'),
    );
    await store.dismissThread('prop-mountain-chalet', 'thread-sarah');
    await pendingDismissEdit;

    await vi.advanceTimersByTimeAsync(500);
    expect(setDocMock).not.toHaveBeenCalled();

    store.dispose();
  });

  it('writes full document on property create and merges only editable fields on property edit without clobbering server counters', async () => {
    const store = new FirestoreCohostStore(createSeedSnapshot());

    // Create a 3rd property -> auto-assigns slot C (#7F2A44) and defaults 14% tax / 15.5% fee
    const created = await store.upsertProperty({
      name: 'River Cottage',
      airbnbListingIds: ['555444333'],
      primaryListingTitle: 'River Cottage, Quiet Porch',
      nightlyFloor: 210,
      cleaningFee: 130,
    });

    expect(created.code).toBe('C');
    expect(created.accentColor).toBe('#7F2A44');
    expect(created.pricing).toEqual({
      nightlyFloor: 210,
      cleaningFee: 130,
      localTaxPct: 14,
      hostServiceFeePct: 15.5,
    });
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock.mock.calls[0]?.[0]).toEqual({ path: `properties/${created.id}` });
    expect(setDocMock.mock.calls[0]?.[1]).toEqual(created);

    // Edit an existing property -> merges ONLY name, airbnbListingIds, titleAliases, pricing
    setDocMock.mockClear();
    const edited = await store.upsertProperty({
      id: 'prop-coastal-loft',
      name: 'Coastal Loft Renovated',
      airbnbListingIds: ['900000000000000001', '900000000000000099'],
      primaryListingTitle: 'Coastal Loft, Bay Views',
      nightlyFloor: 205,
      cleaningFee: 120,
    });

    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock.mock.calls[0]?.[0]).toEqual({ path: 'properties/prop-coastal-loft' });
    expect(setDocMock.mock.calls[0]?.[1]).toEqual({
      name: 'Coastal Loft Renovated',
      airbnbListingIds: ['900000000000000001', '900000000000000099'],
      titleAliases: edited.titleAliases,
      welcomeGuideUrl: null,
      pricing: edited.pricing,
    });
    expect(setDocMock.mock.calls[0]?.[2]).toEqual({ merge: true });
    expect(edited.code).toBe('A');
    expect(edited.accentColor).toBe('#095C57');

    store.dispose();
  });
});
