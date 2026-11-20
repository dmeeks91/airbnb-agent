import { describe, expect, it } from 'vitest';
import { createSampleUnmatchedEmail, createSeedSnapshot } from '../../data/seedData.ts';
import { createLocalHavenStore } from '../havenStore.ts';
import { filterActiveRules, isRuleExpired } from '../../utils/ruleFilters.ts';

describe('LocalHavenStore and ruleFilters', () => {
  it('filters expired temporary rules while keeping active permanent and future temporary rules', () => {
    const snapshot = createSeedSnapshot();
    const coastalRules = snapshot.rules['prop-coastal-loft'] ?? [];

    const beforeExpiry = new Date('2026-11-25T12:00:00.000Z');
    const afterExpiry = new Date('2026-12-02T12:00:00.000Z');

    const tempRule = coastalRules.find((r) => r.id === 'rule-a-temp-patio');
    expect(tempRule).toBeDefined();
    expect(isRuleExpired(tempRule!, beforeExpiry)).toBe(false);
    expect(isRuleExpired(tempRule!, afterExpiry)).toBe(true);

    const activeBefore = filterActiveRules(coastalRules, beforeExpiry);
    const activeAfter = filterActiveRules(coastalRules, afterExpiry);
    expect(activeBefore.some((r) => r.id === 'rule-a-temp-patio')).toBe(true);
    expect(activeAfter.some((r) => r.id === 'rule-a-temp-patio')).toBe(false);
  });

  it('caps learned voice diffs at 15 rolling entries and skips diff logging on dismiss', async () => {
    const store = createLocalHavenStore();
    const initialDiffCount = store.getSnapshot().voiceProfile.learnedDiffs.length;

    // Dismiss Sarah without logging any voice diff
    await store.dismissThread('prop-mountain-chalet', 'thread-sarah');
    expect(store.getSnapshot().voiceProfile.learnedDiffs.length).toBe(initialDiffCount);
    const chalet = store.getSnapshot().properties.find((p) => p.id === 'prop-mountain-chalet');
    expect(chalet?.flaggedCount).toBe(0);

    // Send 18 edited replies to verify rolling cap at 15
    for (let i = 0; i < 18; i++) {
      await store.markThreadSent('prop-coastal-loft', 'thread-marcus', {
        finalText: `Final edited reply number ${i} with concrete detail.`,
        originalDraft: `Original draft number ${i} before host edit.`,
        senderName: 'Alex',
        loggedManually: false,
      });
    }

    expect(store.getSnapshot().voiceProfile.learnedDiffs.length).toBe(15);
  });

  it('assigns an unmatched email to a property and updates unread counts immutably', async () => {
    const seed = createSeedSnapshot();
    const unmatched = createSampleUnmatchedEmail();
    const store = createLocalHavenStore({
      ...seed,
      unmatchedEmails: [unmatched],
    });

    const beforeSnapshot = store.getSnapshot();
    const assigned = await store.assignUnmatchedEmail(unmatched.id, 'prop-coastal-loft');
    const afterSnapshot = store.getSnapshot();

    expect(assigned).not.toBeNull();
    expect(afterSnapshot).not.toBe(beforeSnapshot);
    expect(afterSnapshot.unmatchedEmails.filter((item) => !item.resolved)).toHaveLength(0);
    const coastal = afterSnapshot.properties.find((p) => p.id === 'prop-coastal-loft');
    expect(coastal?.needsReplyCount).toBe(2);
  });
});
