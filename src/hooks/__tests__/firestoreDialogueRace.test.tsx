// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedSnapshot } from '../../data/seedData.ts';
import type { CoachTurnResponse } from '../../types/cohost.ts';

const { setDocMock, docMock, onAuthStateChangedMock, onSnapshotMock, getFirebaseServicesMock } =
  vi.hoisted(() => ({
    setDocMock: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
    docMock: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    onAuthStateChangedMock: vi.fn(() => vi.fn()),
    onSnapshotMock: vi.fn(() => vi.fn()),
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

vi.mock('../../services/firebase.ts', () => ({
  getFirebaseServices: getFirebaseServicesMock,
  isFirebaseConfigured: () => false,
  getCurrentIdToken: async () => 'mock-id-token',
  signInWithGoogle: async () => undefined,
  signOutHost: async () => undefined,
  requestWebPushToken: async () => null,
}));

import { App } from '../../App.tsx';
import { FirestoreCohostStore } from '../../services/cohostStore.ts';

function buildCoachResponse(draftText: string): CoachTurnResponse {
  return {
    source: 'vertex',
    turn: {
      id: 'turn-live-1',
      sender: 'agent',
      text: 'Generated via Vertex.',
      note: 'Grounded in house rules.',
      draft: draftText,
      originalDraft: draftText,
      editedByUser: false,
      createdAt: '2026-11-20T06:00:00.000Z',
    },
    session: {
      hasNewGuestMessageSinceEdit: false,
      turns: [
        {
          id: 'turn-live-1',
          sender: 'agent',
          text: 'Generated via Vertex.',
          note: 'Grounded in house rules.',
          draft: draftText,
          originalDraft: draftText,
          editedByUser: false,
          createdAt: '2026-11-20T06:00:00.000Z',
        },
      ],
    },
  };
}

describe('FirestoreCohostStore + AgentDialogueView async race protection', () => {
  beforeEach(() => {
    setDocMock.mockReset();
    setDocMock.mockImplementation(() => Promise.resolve());
    docMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('prevents an in-flight /api/coach/turn from resurrecting activeCoachSession after dismissing the thread', async () => {
    let resolveCoachFetch: ((response: Response) => void) | null = null;
    const coachDeferred = new Promise<Response>((resolve) => {
      resolveCoachFetch = resolve;
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/coach/turn') {
        return coachDeferred;
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const store = new FirestoreCohostStore(createSeedSnapshot());
    render(
      <App
        store={store}
        initialPropertyId="prop-coastal-loft"
        initialView="dialogue"
        initialThreadId="thread-marcus"
      />,
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/coach/turn',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Host taps "Already handled on Airbnb" while /api/coach/turn is still in flight
    fireEvent.click(screen.getByRole('button', { name: 'Already handled on Airbnb' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/threads/thread-marcus/dismiss',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Now the stale /api/coach/turn request resolves late
    expect(resolveCoachFetch).not.toBeNull();
    resolveCoachFetch!(
      new Response(JSON.stringify(buildCoachResponse('Stale late draft')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 400));

    const marcus = store
      .getSnapshot()
      .threads['prop-coastal-loft'].find((t) => t.id === 'thread-marcus');
    expect(marcus?.status).toBe('dismissed');
    expect(marcus?.activeCoachSession).toBeNull();
    expect(setDocMock).not.toHaveBeenCalled();

    store.dispose();
  });

  it('cancels debounced edit setDoc on rapid Mark as Sent and blocks duplicate double-tap /sent POSTs', async () => {
    let resolveSentFetch: ((response: Response) => void) | null = null;
    const sentDeferred = new Promise<Response>((resolve) => {
      resolveSentFetch = resolve;
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/coach/turn') {
        return Promise.resolve(
          new Response(JSON.stringify(buildCoachResponse('Hi Marcus, initial live draft.')), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url === '/api/threads/thread-marcus/sent') {
        return sentDeferred;
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const store = new FirestoreCohostStore(createSeedSnapshot());
    render(
      <App
        store={store}
        initialPropertyId="prop-coastal-loft"
        initialView="dialogue"
        initialThreadId="thread-marcus"
      />,
    );

    await waitFor(() => {
      expect(document.body.contains(screen.getByText('Hi Marcus, initial live draft.'))).toBe(true);
    });

    // Server-backed Turn 1 should NOT schedule a redundant client setDoc write
    expect(setDocMock).not.toHaveBeenCalled();

    // Edit draft inline (schedules 300ms debounced setDoc), then immediately tap Mark as Sent twice
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit draft reply' });
    fireEvent.change(editor, {
      target: { value: 'Hi Marcus, 1 PM bag drop is confirmed!' },
    });

    const markSentBtn = screen.getByRole('button', { name: 'Mark as Sent' });
    fireEvent.click(markSentBtn);
    fireEvent.click(markSentBtn);

    await waitFor(() => {
      const sentCalls = fetchSpy.mock.calls.filter(
        ([input]) =>
          (typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url) ===
          '/api/threads/thread-marcus/sent',
      );
      expect(sentCalls).toHaveLength(1);
    });

    // Wait past the 300ms debounce window while /sent is still resolving
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(setDocMock).not.toHaveBeenCalled();

    resolveSentFetch!(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await waitFor(() => {
      expect(document.body.contains(screen.getByText(/Sent just now/))).toBe(true);
    });

    const marcus = store
      .getSnapshot()
      .threads['prop-coastal-loft'].find((t) => t.id === 'thread-marcus');
    expect(marcus?.status).toBe('sent');
    expect(marcus?.activeCoachSession).toBeNull();
    expect(setDocMock).not.toHaveBeenCalled();

    store.dispose();
  });
});
