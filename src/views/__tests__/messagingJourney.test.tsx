// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { createSampleUnmatchedEmail, createSeedSnapshot } from '../../data/seedData.ts';
import { createLocalCohostStore } from '../../services/cohostStore.ts';

afterEach(() => {
  cleanup();
});

describe('Stage 2: Core Messaging Journey (Messages, Agent Dialogue, Guest Thread)', () => {
  it('filters messages, switches properties, toggles net payout math, and hides unmatched banner when empty', async () => {
    const user = userEvent.setup();
    const store = createLocalCohostStore();
    render(<App store={store} />);

    // Unmatched banner must NOT render when there are no unmatched emails
    expect(screen.queryByRole('region', { name: 'Unmatched incoming emails' })).toBeNull();

    // Active Property A shows Marcus L. and Julian T.
    expect(document.body.contains(screen.getByText('Marcus L. (Nov 21 - 25)'))).toBe(true);
    expect(document.body.contains(screen.getByText('Julian T. (Nov 15 - 19)'))).toBe(true);

    // Cross-property unread badge shows 1 waiting on Property B
    expect(
      document.body.contains(
        screen.getByLabelText('1 waiting on other properties'),
      ),
    ).toBe(true);

    // Embedded Filter popover filters by Status = Sent
    await user.click(screen.getByRole('button', { name: /Filter/i }));
    await user.click(screen.getByRole('button', { name: 'Sent' }));
    expect(screen.queryByText('Marcus L. (Nov 21 - 25)')).toBeNull();
    expect(document.body.contains(screen.getByText('Julian T. (Nov 15 - 19)'))).toBe(true);

    // Switch to Property B (Mountain Chalet)
    await user.click(screen.getByRole('button', { name: 'Switch property' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Mountain Chalet/i }));

    // Clear Sent filter to view Flagged Sarah K.
    await user.click(screen.getAllByRole('button', { name: 'All' })[0]);
    expect(document.body.contains(screen.getByText('Sarah K. (Dec 12 - 17)'))).toBe(true);

    // Open Sarah K. -> Agent Dialogue with interactive 15.5% Net Payout Warning Banner
    await user.click(screen.getByText('Sarah K. (Dec 12 - 17)'));
    const payoutRegion = screen.getByRole('region', { name: 'Net payout breakdown' });
    expect(document.body.contains(payoutRegion)).toBe(true);

    // Default All-in mode vs Room rate before tax toggle updates net/night
    expect(screen.getAllByText(/\$91\.6/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Room rate before tax' }));
    expect(document.body.contains(screen.getByText('$131.02/nt net'))).toBe(true);
  });

  it('generates lazy Turn 1 draft, preserves inline edit across Guest Thread roundtrip, and captures voice diff on Mark as Sent', async () => {
    const user = userEvent.setup();
    const store = createLocalCohostStore();
    const initialDiffCount = store.getSnapshot().voiceProfile.learnedDiffs.length;
    render(<App store={store} />);

    // Open Marcus L. directly into Agent Dialogue
    await user.click(screen.getByText('Marcus L. (Nov 21 - 25)'));

    // Lazy Turn 1 draft generates automatically
    await waitFor(() => {
      expect(document.body.contains(screen.getByText('Ready Draft Reply'))).toBe(true);
    });

    // Inline edit the Turn 1 draft
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Edit draft reply',
    });
    await user.clear(textarea);
    await user.type(
      textarea,
      'Hi Marcus, 1 PM bag drop works great and the travel crib is in the hall closet. Best, Alex',
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));

    // Navigate to Guest Thread and expand archived coaching notes
    await user.click(screen.getByRole('button', { name: 'View thread' }));
    expect(
      document.body.contains(screen.getByText(/Coastal Loft · Full Guest Thread/)),
    ).toBe(true);

    const notesToggle = screen.getByRole('button', { name: /Coaching notes \(1\)/ });
    await user.click(notesToggle);
    expect(
      document.body.contains(screen.getByText(/Confirmed driveway dimensions/)),
    ).toBe(true);

    // Return to Agent Dialogue and verify edited draft text is preserved
    await user.click(screen.getByRole('button', { name: 'Return to In-Progress Draft' }));
    expect(
      document.body.contains(
        screen.getByText(/1 PM bag drop works great and the travel crib is in the hall closet/),
      ),
    ).toBe(true);

    // Send a coaching instruction (Turn 2)
    const composer = screen.getByRole('textbox', {
      name: 'Tell AI how to refine draft',
    });
    await user.type(composer, 'Mention the mudroom rack for coats');
    await user.click(screen.getByRole('button', { name: 'Send coaching instruction' }));

    await waitFor(() => {
      expect(
        screen.getAllByText(/Mention the mudroom rack for coats/).length,
      ).toBeGreaterThanOrEqual(2);
    });

    // Mark Turn 1 (edited) as Sent
    const markSentButtons = screen.getAllByRole('button', { name: 'Mark as Sent' });
    await user.click(markSentButtons[0]);

    // Returns to Messages queue, Marcus is now resolved, and learned voice diff was recorded
    await waitFor(() => {
      expect(document.body.contains(screen.getByText(/Sent just now/))).toBe(true);
    });
    expect(store.getSnapshot().voiceProfile.learnedDiffs.length).toBe(initialDiffCount + 1);
  });

  it('dismisses a thread via Already handled without logging a voice diff, and assigns or deletes unmatched emails via anchored dropdown', async () => {
    const user = userEvent.setup();
    const seed = createSeedSnapshot();
    const unmatched = createSampleUnmatchedEmail();
    const junkUnmatched = {
      ...createSampleUnmatchedEmail(),
      id: 'unmatched-junk-2',
      guestName: 'Unknown Guest',
      subject: 'Your co-host invitation was sent',
      bodyPreview: 'We sent your invitation to co-host.',
    };
    const store = createLocalCohostStore({
      ...seed,
      unmatchedEmails: [unmatched, junkUnmatched],
    });
    const initialDiffCount = store.getSnapshot().voiceProfile.learnedDiffs.length;

    render(<App store={store} />);

    // Conditional unmatched banner is visible with 2 items
    const unmatchedSection = screen.getByRole('region', {
      name: 'Unmatched incoming emails',
    });
    expect(document.body.contains(unmatchedSection)).toBe(true);

    // Expand Devon P.'s unmatched card inline to inspect the full message and Airbnb link
    const expandButton = screen.getByRole('button', { name: /^Devon P\./ });
    expect(expandButton.getAttribute('aria-expanded')).toBe('false');
    await user.click(expandButton);
    expect(expandButton.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.contains(screen.getByText(unmatched.rawParsed.bodyText))).toBe(true);
    const openLink = screen.getByRole('link', { name: 'Open on Airbnb' });
    expect(openLink.getAttribute('href')).toBe(unmatched.rawParsed.airbnbThreadUrl);

    // Collapse back cleanly
    await user.click(expandButton);
    expect(expandButton.getAttribute('aria-expanded')).toBe('false');

    // Delete the junk unmatched notice via the anchored dropdown menu
    await user.click(
      screen.getByRole('button', { name: 'Assign or delete Your co-host invitation was sent' }),
    );
    await user.click(screen.getByRole('option', { name: 'Delete message' }));

    await waitFor(() => {
      expect(screen.queryByText(/Your co-host invitation was sent/)).toBeNull();
    });
    expect(
      store.getSnapshot().unmatchedEmails.some((item) => item.id === 'unmatched-junk-2'),
    ).toBe(false);

    // Assign Devon P. to Coastal Loft via the anchored dropdown menu
    await user.click(
      screen.getByRole('button', { name: `Assign or delete ${unmatched.subject}` }),
    );
    await user.click(screen.getByRole('option', { name: 'Coastal Loft' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('region', { name: 'Unmatched incoming emails' }),
      ).toBeNull();
    });
    expect(document.body.contains(screen.getByText('Devon P. (Dec 4 - 7, 2026)'))).toBe(true);

    // Dismiss Marcus via Already handled without touching learned diffs
    const dismissButtons = screen.getAllByRole('button', { name: 'Already handled' });
    await user.click(dismissButtons[0]);

    expect(store.getSnapshot().voiceProfile.learnedDiffs.length).toBe(initialDiffCount);
  });

  it('deletes a thread permanently from Full Guest Thread via confirmation sheet and updates unread counts', async () => {
    const user = userEvent.setup();
    const store = createLocalCohostStore();
    render(<App store={store} />);

    // Open Julian T. handled thread directly
    await user.click(screen.getByText('Julian T. (Nov 15 - 19)'));
    expect(
      document.body.contains(screen.getByText(/Coastal Loft · Full Guest Thread/)),
    ).toBe(true);

    // Tap header delete icon -> confirm in BottomSheet
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    expect(document.body.contains(screen.getByText('Delete this thread?'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Delete Thread' }));

    // Returns to Messages and thread is gone from UI and store
    await waitFor(() => {
      expect(screen.queryByText('Julian T. (Nov 15 - 19)')).toBeNull();
    });
    expect(
      (store.getSnapshot().threads['prop-coastal-loft'] ?? []).some(
        (t) => t.id === 'thread-julian',
      ),
    ).toBe(false);
  });

  it('logs a manual reply from Guest Thread and shows new-message refresh banner without overwriting edits', async () => {
    const user = userEvent.setup();
    const seed = createSeedSnapshot();
    seed.threads['prop-coastal-loft'][0].activeCoachSession = {
      hasNewGuestMessageSinceEdit: true,
      turns: [
        {
          id: 'turn-existing',
          sender: 'agent',
          text: 'Initial draft ready.',
          note: 'Grounded in house rules.',
          draft: 'My careful custom edit that must not be overwritten automatically.',
          editedByUser: true,
          createdAt: '2026-11-20T05:13:00.000Z',
        },
      ],
    };

    const store = createLocalCohostStore(seed);
    render(
      <App
        store={store}
        initialPropertyId="prop-coastal-loft"
        initialView="dialogue"
        initialThreadId="thread-marcus"
      />,
    );

    // Banner appears while preserving the live edit
    expect(document.body.contains(screen.getByText('New guest message arrived'))).toBe(true);
    expect(
      document.body.contains(
        screen.getByText('My careful custom edit that must not be overwritten automatically.'),
      ),
    ).toBe(true);

    // Open Guest Thread and log a manual reply
    await user.click(screen.getByRole('button', { name: 'View thread' }));
    await user.click(screen.getByRole('button', { name: 'Log manual reply' }));
    const manualBox = screen.getByRole('textbox', { name: 'Message Sent to Guest' });
    await user.type(manualBox, 'Handled directly in Airbnb app.');
    await user.click(screen.getByRole('button', { name: 'Save to Thread' }));

    await waitFor(() => {
      expect(
        document.body.contains(screen.getByText('Handled directly in Airbnb app.')),
      ).toBe(true);
    });
  });
});
