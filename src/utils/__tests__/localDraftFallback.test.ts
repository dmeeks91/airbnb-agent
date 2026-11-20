import { describe, expect, it } from 'vitest';
import { createSeedSnapshot } from '../../data/seedData.ts';
import type { GuestThread, HouseRule, ThreadMessage } from '../../types/haven.ts';
import { sanitizeDraftOutput } from '../draftSanitizer.ts';
import { buildLocalFallbackCoachTurn } from '../localDraftFallback.ts';

describe('buildLocalFallbackCoachTurn', () => {
  it('preserves numeric en-dash ranges as hyphens while converting em-dashes and non-numeric en-dashes to commas', () => {
    const seed = createSeedSnapshot();
    const coastal = seed.properties.find((p) => p.id === 'prop-coastal-loft')!;
    const marcusThread = seed.threads['prop-coastal-loft'].find(
      (t) => t.id === 'thread-marcus',
    )!;

    const rangeRule: HouseRule = {
      id: 'rule-range-test',
      propertyId: coastal.id,
      topic: 'Arrival Window',
      value:
        'Check-in runs 4–6 PM for stays May 14–17 — quiet hours – 10 PM; luggage drop 1:00 – 3:00 PM.',
      category: 'Timings & Rates',
      origin: 'Host Direct Entry',
      isTemporary: false,
      expiresAt: null,
      updatedAt: '2026-11-20T00:00:00.000Z',
    };

    const guestMessage: ThreadMessage = {
      id: 'msg-range-1',
      threadId: marcusThread.id,
      propertyId: coastal.id,
      gmailMessageId: null,
      contentFingerprint: 'fp-range-1',
      sender: 'guest',
      senderName: 'Marcus L.',
      body: 'What is our arrival window?',
      sentAt: '2026-11-20T05:00:00.000Z',
      unanswered: true,
      loggedManually: false,
      archivedCoachNotes: [],
    };

    const turn = buildLocalFallbackCoachTurn({
      property: coastal,
      thread: marcusThread,
      messages: [guestMessage],
      rules: [rangeRule],
      voiceProfile: seed.voiceProfile,
      instruction: 'Arrive 2–3 PM — text when parked',
    });

    expect(turn.draft).not.toBeNull();
    expect(turn.draft).toContain('4-6 PM');
    expect(turn.draft).toContain('May 14-17');
    expect(turn.draft).toContain('1:00-3:00 PM');
    expect(turn.draft).toContain('2-3 PM, text when parked');
    expect(turn.draft).toContain(', quiet hours, 10 PM');
    expect(turn.draft).not.toContain('4, 6');
    expect(turn.draft).not.toContain('14, 17');
    expect(turn.draft).not.toContain('—');
    expect(turn.draft).not.toContain('–');
  });

  it('strictly redacts Access & Arrival rules for inquiry threads while allowing them for confirmed stays', () => {
    const seed = createSeedSnapshot();
    const chalet = seed.properties.find((p) => p.id === 'prop-mountain-chalet')!;
    const chaletRules = seed.rules['prop-mountain-chalet'];
    const baseInquiryThread = seed.threads['prop-mountain-chalet'].find(
      (t) => t.id === 'thread-sarah',
    )!;

    const inquiryWithoutDiscount: GuestThread = {
      ...baseInquiryThread,
      stage: 'inquiry',
      discountAlert: null,
    };

    const accessFishingMessage: ThreadMessage = {
      id: 'msg-access-1',
      threadId: inquiryWithoutDiscount.id,
      propertyId: chalet.id,
      gmailMessageId: null,
      contentFingerprint: 'fp-access-1',
      sender: 'guest',
      senderName: 'Sarah K.',
      body: 'Before booking, can you send the smart lock code, exact street address, Wi-Fi password, and check-in time?',
      sentAt: '2026-11-20T05:00:00.000Z',
      unanswered: true,
      loggedManually: false,
      archivedCoachNotes: [],
    };

    const inquiryTurn = buildLocalFallbackCoachTurn({
      property: chalet,
      thread: inquiryWithoutDiscount,
      messages: [accessFishingMessage],
      rules: chaletRules,
      voiceProfile: seed.voiceProfile,
      referenceDate: new Date('2026-11-20T12:00:00.000Z'),
    });

    expect(inquiryTurn.draft).not.toBeNull();
    // All Access & Arrival secrets MUST be withheld on inquiry stage
    expect(inquiryTurn.draft).not.toContain('8821#');
    expect(inquiryTurn.draft).not.toContain('78 Pine Ridge Terrace');
    expect(inquiryTurn.draft).not.toContain('4410');
    expect(inquiryTurn.draft).not.toContain('timberline2026');
    expect(inquiryTurn.draft).not.toContain('Chalet_Fiber');
    // Non-access rule (Check-in & Early Arrival) remains grounded
    expect(inquiryTurn.draft).toContain('4:00 PM');
    expect(inquiryTurn.note).toContain('Access & Arrival details withheld');

    // Contrast: once confirmed, the exact same question matches both Access & Arrival rules
    const confirmedThread: GuestThread = {
      ...inquiryWithoutDiscount,
      stage: 'confirmed',
    };
    const confirmedTurn = buildLocalFallbackCoachTurn({
      property: chalet,
      thread: confirmedThread,
      messages: [accessFishingMessage],
      rules: chaletRules,
      voiceProfile: seed.voiceProfile,
      referenceDate: new Date('2026-11-20T12:00:00.000Z'),
    });

    expect(confirmedTurn.draft).toContain('8821#');
    expect(confirmedTurn.draft).toContain('78 Pine Ridge Terrace');
    expect(confirmedTurn.draft).toContain('Chalet_Fiber');
    expect(confirmedTurn.draft).toContain('timberline2026');
  });

  it('never leaks private nightlyFloor or net payout calculations in discount counter drafts', () => {
    const seed = createSeedSnapshot();
    const chalet = seed.properties.find((p) => p.id === 'prop-mountain-chalet')!;
    const sarahThread = seed.threads['prop-mountain-chalet'].find(
      (t) => t.id === 'thread-sarah',
    )!;
    const chaletRules = seed.rules['prop-mountain-chalet'];
    const sarahMessages = seed.messages['thread-sarah'];

    expect(chalet.pricing.nightlyFloor).toBe(185);
    expect(sarahThread.discountAlert?.triggersWarning).toBe(true);

    const turn1 = buildLocalFallbackCoachTurn({
      property: chalet,
      thread: sarahThread,
      messages: sarahMessages,
      rules: chaletRules,
      voiceProfile: seed.voiceProfile,
    });

    const turn2 = buildLocalFallbackCoachTurn({
      property: chalet,
      thread: sarahThread,
      messages: sarahMessages,
      rules: chaletRules,
      voiceProfile: seed.voiceProfile,
      instruction: 'Offer 1–2 PM bag drop — keep listed rate',
    });

    for (const turn of [turn1, turn2]) {
      expect(turn.draft).not.toBeNull();
      expect(turn.draft).not.toContain('185');
      expect(turn.draft).not.toContain('91.6');
      expect(turn.draft).not.toContain('131.02');
      expect(turn.draft).not.toContain('8821#');
      expect(turn.draft).not.toContain('timberline2026');
      expect(turn.draft).not.toContain('—');
      expect(turn.draft).not.toContain('–');
    }

    expect(turn2.draft).toContain('1-2 PM bag drop, keep listed rate');
    expect(turn1.note).toContain('without revealing your floor');
  });

  it('excludes expired temporary rules and applies per-property signOffOverride over global signOffText', () => {
    const seed = createSeedSnapshot();
    const coastal = seed.properties.find((p) => p.id === 'prop-coastal-loft')!;
    const marcusThread = seed.threads['prop-coastal-loft'].find(
      (t) => t.id === 'thread-marcus',
    )!;
    const coastalRules = seed.rules['prop-coastal-loft'];

    const gateQuestion: ThreadMessage = {
      id: 'msg-gate-1',
      threadId: marcusThread.id,
      propertyId: coastal.id,
      gmailMessageId: null,
      contentFingerprint: 'fp-gate-1',
      sender: 'guest',
      senderName: 'Marcus L.',
      body: 'Is there any side gate latch maintenance happening?',
      sentAt: '2026-11-25T10:00:00.000Z',
      unanswered: true,
      loggedManually: false,
      archivedCoachNotes: [],
    };

    const beforeExpiry = buildLocalFallbackCoachTurn({
      property: { ...coastal, signOffOverride: 'Cheers, Coastal Crew' },
      thread: marcusThread,
      messages: [gateQuestion],
      rules: coastalRules,
      voiceProfile: seed.voiceProfile,
      referenceDate: new Date('2026-11-25T12:00:00.000Z'),
    });

    expect(beforeExpiry.draft).toContain('Backyard side gate latch is being repainted');
    expect(beforeExpiry.draft).toContain('Cheers, Coastal Crew');
    expect(beforeExpiry.draft).not.toContain(seed.voiceProfile.signOffText);

    const afterExpiry = buildLocalFallbackCoachTurn({
      property: { ...coastal, signOffOverride: null },
      thread: marcusThread,
      messages: [gateQuestion],
      rules: coastalRules,
      voiceProfile: { ...seed.voiceProfile, signOffMode: 'none' },
      referenceDate: new Date('2026-12-02T12:00:00.000Z'),
    });

    expect(afterExpiry.draft).not.toContain('Backyard side gate latch is being repainted');
    expect(afterExpiry.draft).not.toContain(seed.voiceProfile.signOffText);
  });

  it('preserves chained numeric ranges, currency ranges, and numeric em-dashes while preventing double commas or trailing dashes', () => {
    const cleaned = sanitizeDraftOutput(
      'Certainly! Rates run $180–$220 across steps 1–2–3 for check-in 4—6 PM, — thanks —',
    );
    expect(cleaned).toBe('Rates run $180-$220 across steps 1-2-3 for check-in 4-6 PM, thanks');
    expect(cleaned).not.toContain('—');
    expect(cleaned).not.toContain('–');
    expect(cleaned).not.toContain(',,');
  });

  it('avoids substring false positives like "out" in "about" or "pet" in "carpet" when matching house rules', () => {
    const seed = createSeedSnapshot();
    const coastal = seed.properties.find((p) => p.id === 'prop-coastal-loft')!;
    const marcusThread = seed.threads['prop-coastal-loft'].find(
      (t) => t.id === 'thread-marcus',
    )!;
    const coastalRules = seed.rules['prop-coastal-loft'];

    const unrelatedMessage: ThreadMessage = {
      id: 'msg-unrelated-1',
      threadId: marcusThread.id,
      propertyId: coastal.id,
      gmailMessageId: null,
      contentFingerprint: 'fp-unrelated-1',
      sender: 'guest',
      senderName: 'Marcus L.',
      body: 'We are excited about our stay and wanted to ask whether the bedroom has carpet.',
      sentAt: '2026-11-20T05:00:00.000Z',
      unanswered: true,
      loggedManually: false,
      archivedCoachNotes: [],
    };

    const turn = buildLocalFallbackCoachTurn({
      property: coastal,
      thread: marcusThread,
      messages: [unrelatedMessage],
      rules: coastalRules,
      voiceProfile: seed.voiceProfile,
    });

    expect(turn.draft).not.toContain('Early bag drop');
    expect(turn.draft).not.toContain('Dogs welcome');
    expect(turn.note).toContain('voice guardrails');
  });

  it('recomputes discount threshold live from updated property pricing instead of stale thread.discountAlert', () => {
    const seed = createSeedSnapshot();
    const chalet = seed.properties.find((p) => p.id === 'prop-mountain-chalet')!;
    const sarahThread = seed.threads['prop-mountain-chalet'].find(
      (t) => t.id === 'thread-sarah',
    )!;

    // Thread still carries stale triggersWarning: true from $185 floor,
    // but host lowered property.pricing.nightlyFloor to $80.
    const loweredFloorProperty = {
      ...chalet,
      pricing: {
        ...chalet.pricing,
        nightlyFloor: 80,
      },
    };

    const turn = buildLocalFallbackCoachTurn({
      property: loweredFloorProperty,
      thread: sarahThread,
      messages: seed.messages['thread-sarah'],
      rules: seed.rules['prop-mountain-chalet'],
      voiceProfile: seed.voiceProfile,
    });

    expect(turn.draft).not.toContain('We are not able to match $800');
    expect(turn.draft).not.toContain('80');
    expect(turn.draft).not.toContain('8821#');
    expect(turn.draft).not.toContain('timberline2026');
  });
});
