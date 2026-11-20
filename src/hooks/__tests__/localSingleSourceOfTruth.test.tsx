// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.tsx';
import { createSeedSnapshot } from '../../data/seedData.ts';
import { createLocalCohostStore, LocalCohostStore } from '../../services/cohostStore.ts';
import type { CoachTurnResponse, ExtractKnowledgeResponse } from '../../types/cohost.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Local dev single source of truth vs Firestore live API mode', () => {
  it('never calls /api/coach/turn in local mode and reflects LocalCohostStore edits immediately', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const store = createLocalCohostStore();

    // Mutate rules & sign-off directly in LocalCohostStore (simulating host edits in House Details)
    await store.updatePropertySignOff('prop-coastal-loft', 'Warmly, Local Host Team');
    await store.upsertRule('prop-coastal-loft', {
      id: 'rule-a-timings',
      topic: 'Check-in, Check-out & Bag Drop',
      value: 'Updated bag drop window is 1–3 PM — lock door behind you.',
      category: 'Timings & Rates',
      origin: 'Host Direct Entry',
      isTemporary: false,
      expiresAt: null,
    });

    render(
      <App
        store={store}
        initialPropertyId="prop-coastal-loft"
        initialView="dialogue"
        initialThreadId="thread-marcus"
      />,
    );

    await waitFor(() => {
      expect(document.body.contains(screen.getByText('Ready Draft Reply'))).toBe(true);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      document.body.contains(screen.getByText(/Updated bag drop window is 1-3 PM, lock door behind you\./)),
    ).toBe(true);
    expect(document.body.contains(screen.getByText(/Warmly, Local Host Team/))).toBe(true);
  });

  it('never calls /api/knowledge/extract in local mode and checks conflicts against LocalCohostStore rules', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const store = createLocalCohostStore();

    // Add a custom rule in LocalCohostStore that Express InMemoryServerRepository would never know about
    await store.upsertRule('prop-coastal-loft', {
      topic: 'Sauna Hours',
      value: 'Sauna runs from 4 PM to 9 PM.',
      category: 'Amenities & Rules',
      origin: 'Host Direct Entry',
      isTemporary: false,
      expiresAt: null,
    });

    render(<App store={store} initialPropertyId="prop-coastal-loft" initialView="import" />);

    await user.type(
      screen.getByLabelText('Listing Text or Host Notes'),
      'Sauna Hours: Sauna now runs 5–10 PM daily.',
    );
    await user.click(screen.getByRole('button', { name: 'Extract Rules' }));

    await waitFor(() => {
      expect(document.body.contains(screen.getByText('Updates existing rule'))).toBe(true);
      expect(document.body.contains(screen.getByText(/Sauna runs from 4 PM to 9 PM\./))).toBe(true);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls /api/coach/turn and /api/knowledge/extract when store.mode is firestore', async () => {
    const user = userEvent.setup();
    const coachPayload: CoachTurnResponse = {
      source: 'vertex',
      turn: {
        id: 'turn-live-1',
        sender: 'agent',
        text: 'Generated via Express API.',
        note: 'Live Vertex AI draft.',
        draft: 'Hi Marcus, live Firestore-backed reply from Express!',
        originalDraft: 'Hi Marcus, live Firestore-backed reply from Express!',
        editedByUser: false,
        createdAt: '2026-11-20T06:00:00.000Z',
      },
      session: {
        hasNewGuestMessageSinceEdit: false,
        turns: [
          {
            id: 'turn-live-1',
            sender: 'agent',
            text: 'Generated via Express API.',
            note: 'Live Vertex AI draft.',
            draft: 'Hi Marcus, live Firestore-backed reply from Express!',
            originalDraft: 'Hi Marcus, live Firestore-backed reply from Express!',
            editedByUser: false,
            createdAt: '2026-11-20T06:00:00.000Z',
          },
        ],
      },
    };

    const extractPayload: ExtractKnowledgeResponse = {
      source: 'vertex',
      sourceTitle: 'Live Guide',
      sourceType: 'paste_text',
      candidates: [
        {
          id: 'cand-live-1',
          topic: 'Kayak Shed',
          value: 'Two kayaks and life vests are in the boathouse.',
          category: 'Amenities & Rules',
          sourceLabel: 'Live Guide',
          conflictRuleId: null,
          existingValue: null,
        },
      ],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/coach/turn') {
        return new Response(JSON.stringify(coachPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/knowledge/extract') {
        return new Response(JSON.stringify(extractPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const firestoreModeStore = new LocalCohostStore(createSeedSnapshot(), 'firestore');

    // 1. Verify /api/coach/turn is called in firestore mode
    const { unmount } = render(
      <App
        store={firestoreModeStore}
        initialPropertyId="prop-coastal-loft"
        initialView="dialogue"
        initialThreadId="thread-marcus"
      />,
    );

    await waitFor(() => {
      expect(
        document.body.contains(
          screen.getByText('Hi Marcus, live Firestore-backed reply from Express!'),
        ),
      ).toBe(true);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/coach/turn',
      expect.objectContaining({ method: 'POST' }),
    );
    unmount();

    // 2. Verify /api/knowledge/extract is called in firestore mode
    render(
      <App
        store={firestoreModeStore}
        initialPropertyId="prop-coastal-loft"
        initialView="import"
      />,
    );

    await user.type(
      screen.getByLabelText('Listing Text or Host Notes'),
      'Kayaks are stored down by the boathouse.',
    );
    await user.click(screen.getByRole('button', { name: 'Extract Rules' }));

    await waitFor(() => {
      expect(document.body.contains(screen.getByText('Kayak Shed'))).toBe(true);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/knowledge/extract',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('recomputes payout warnings and honors 0% host fee immediately when editing pricing in local mode with zero fetch calls', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const store = createLocalCohostStore();

    render(
      <App store={store} initialPropertyId="prop-mountain-chalet" initialView="house-details" />,
    );

    const floorInput = screen.getByLabelText('Nightly Floor ($)');
    await user.clear(floorInput);
    await user.type(floorInput, '80');

    const hostFeeInput = screen.getByLabelText('Host Fee (%)');
    await user.clear(hostFeeInput);
    await user.type(hostFeeInput, '0');

    await user.click(screen.getByRole('button', { name: 'Save Pricing & Sign-Off' }));

    await waitFor(() => {
      const chalet = store.getSnapshot().properties.find((p) => p.id === 'prop-mountain-chalet');
      expect(chalet?.pricing.nightlyFloor).toBe(80);
      expect(chalet?.pricing.hostServiceFeePct).toBe(0);
      expect(chalet?.flaggedCount).toBe(0);
      expect(chalet?.needsReplyCount).toBe(1);
    });

    // Navigate to Messages and open Sarah K.'s dialogue
    await user.click(screen.getByRole('button', { name: /Messages/i }));
    expect(screen.queryByText('Discount Review: Below Net Floor')).toBeNull();
    await user.click(screen.getByText(/Tap to open draft reply/));

    await waitFor(() => {
      expect(document.body.contains(screen.getByText('Meets Your Net Nightly Floor'))).toBe(true);
      expect(document.body.contains(screen.getByText(/Private floor is \$80\/nt/))).toBe(true);
      expect(document.body.contains(screen.getByText('Payout Math (0% host fee)'))).toBe(true);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('surfaces 4xx API validation errors in ImportKnowledgeView in firestore mode instead of silently falling back', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Only PDF files are supported in V1' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const firestoreModeStore = new LocalCohostStore(createSeedSnapshot(), 'firestore');
    render(
      <App
        store={firestoreModeStore}
        initialPropertyId="prop-coastal-loft"
        initialView="import"
      />,
    );

    await user.type(
      screen.getByLabelText('Listing Text or Host Notes'),
      'Parking Allocation: Two driveway spots.',
    );
    await user.click(screen.getByRole('button', { name: 'Extract Rules' }));

    await waitFor(() => {
      expect(
        document.body.contains(screen.getByText('Only PDF files are supported in V1')),
      ).toBe(true);
    });
    expect(screen.queryByText('Parsed Rules to Merge')).toBeNull();
  });
});
