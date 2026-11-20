import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSeedSnapshot } from '../../data/seedData.ts';
import {
  IngestionService,
  type IngestionPushPayload,
} from '../services/ingestionService.ts';
import { InMemoryServerRepository } from '../services/serverRepository.ts';

const FIXTURES_DIR = path.resolve(process.cwd(), 'src/server/__tests__/fixtures');

async function loadFixture(filename: string): Promise<Buffer> {
  return fs.readFile(path.join(FIXTURES_DIR, filename));
}

function createHarness() {
  const seed = createSeedSnapshot();
  // Start with empty threads/messages so ingestion tests assert exact ingested state
  const repo = new InMemoryServerRepository({
    ...seed,
    properties: seed.properties.map((p) => ({
      ...p,
      needsReplyCount: 0,
      flaggedCount: 0,
    })),
    threads: {
      'prop-coastal-loft': [],
      'prop-mountain-chalet': [],
    },
    messages: {},
    unmatchedEmails: [],
  });
  const alerts: IngestionPushPayload[] = [];
  const service = new IngestionService(repo, {
    sendAlert: async (payload) => {
      alerts.push(payload);
    },
  });
  return { repo, alerts, service };
}

describe('IngestionService (dual-inbox dedupe, co-host sync, pending merge, mid-session burst)', () => {
  it('enforces two-layer deduplication: Layer 1 (gmailMessageId) and Layer 2 (dual-inbox content fingerprint)', async () => {
    const { repo, alerts, service } = createHarness();
    const raw = await loadFixture('airbnb_digest_single_guest.eml');

    // First copy forwarded from primary host inbox
    const first = await service.processRawEmail(raw, 'gm-host-inbox-1');
    expect(first.outcome).toBe('guest_message_ingested');
    expect(first.pushSent).toBe(true);
    expect(alerts).toHaveLength(1);

    // Layer 1 duplicate: exact same gmailMessageId replayed by Pub/Sub
    const replaySameId = await service.processRawEmail(raw, 'gm-host-inbox-1');
    expect(replaySameId.outcome).toBe('deduped_by_gmail_id');
    expect(replaySameId.pushSent).toBe(false);
    expect(alerts).toHaveLength(1);

    // Layer 2 duplicate: identical Airbnb email forwarded from co-host inbox with DIFFERENT gmailMessageId
    const cohostCopy = await service.processRawEmail(raw, 'gm-cohost-inbox-99');
    expect(cohostCopy.outcome).toBe('deduped_by_fingerprint');
    expect(cohostCopy.pushSent).toBe(false);
    expect(alerts).toHaveLength(1);

    // Verify only 1 thread and 1 message bubble exist (zero duplicate bubbles)
    const threads = await repo.listAllThreads();
    expect(threads).toHaveLength(1);
    const messages = await repo.listThreadMessages(threads[0].propertyId, threads[0].id);
    expect(messages).toHaveLength(1);
  });

  it('auto-syncs co-host reply digests without triggering a push notification and clears unanswered state', async () => {
    const { repo, alerts, service } = createHarness();
    const raw = await loadFixture('airbnb_digest_guest_and_host.eml');

    const result = await service.processRawEmail(raw, 'gm-cohost-sync-1');
    expect(result.outcome).toBe('host_reply_synced');
    expect(result.pushSent).toBe(false);
    expect(alerts).toHaveLength(0);

    const threads = await repo.listAllThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0].status).toBe('sent');
    expect(threads[0].unansweredCount).toBe(0);
    expect(threads[0].lastSentBy).toBe('Pat');

    const messages = await repo.listThreadMessages(threads[0].propertyId, threads[0].id);
    expect(messages).toHaveLength(2);
    expect(messages[0].sender).toBe('guest');
    expect(messages[1].sender).toBe('host');
    expect(messages.every((m) => m.unanswered === false)).toBe(true);
  });

  it('merges a follow-up digest into an existing pending reservation request thread and backfills airbnbThreadId', async () => {
    const { repo, service } = createHarness();
    const pendingRaw = await loadFixture('airbnb_pending_request.eml');

    const pendingResult = await service.processRawEmail(pendingRaw, 'gm-pending-1');
    expect(pendingResult.outcome).toBe('guest_message_ingested');
    const threadsAfterPending = await repo.listAllThreads();
    expect(threadsAfterPending).toHaveLength(1);
    expect(threadsAfterPending[0].airbnbThreadId).toBeNull();
    expect(threadsAfterPending[0].reservationCode).toBe('HMFAKE1234');
    expect(threadsAfterPending[0].stage).toBe('inquiry');

    // Follow-up digest arrives later with airbnbThreadId for the same guest/property/stay dates
    // (Using "October 22 - 26, 2026" vs "Oct 22 – 26, 2026" to verify date normalization too)
    const followupRaw = [
      'From: Airbnb <automated@airbnb.com>',
      'To: cohost@example.com',
      'Subject: RE: Reservation for Maple Loft | Getaway + Monthly Discount, October 22 - 26, 2026',
      'Date: Sat, 10 Oct 2026 16:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'For your protection and safety, always communicate through Airbnb [https://www.airbnb.com/help].',
      '',
      'RILEY',
      'Booker',
      'We confirmed our flight times and will arrive right at 4 PM!',
      '',
      'Reply',
      '[https://www.airbnb.com/hosting/thread/77665544]',
      'Listing: https://www.airbnb.com/rooms/900000000000000001',
    ].join('\r\n');

    const followupResult = await service.processRawEmail(followupRaw, 'gm-followup-1');
    expect(followupResult.outcome).toBe('guest_message_ingested');

    // Must merge into ONE thread and backfill airbnbThreadId + upgrade stage to confirmed
    const threadsAfterMerge = await repo.listAllThreads();
    expect(threadsAfterMerge).toHaveLength(1);
    expect(threadsAfterMerge[0].id).toBe(threadsAfterPending[0].id);
    expect(threadsAfterMerge[0].airbnbThreadId).toBe('77665544');
    expect(threadsAfterMerge[0].reservationCode).toBe('HMFAKE1234');
    expect(threadsAfterMerge[0].stage).toBe('confirmed');

    const messages = await repo.listThreadMessages(
      threadsAfterMerge[0].propertyId,
      threadsAfterMerge[0].id,
    );
    expect(messages).toHaveLength(2);
  });

  it('sets hasNewGuestMessageSinceEdit when a new message arrives mid-session without overwriting active draft edits', async () => {
    const { repo, service } = createHarness();
    const raw1 = await loadFixture('airbnb_digest_single_guest.eml');
    await service.processRawEmail(raw1, 'gm-burst-1');

    const [thread] = await repo.listAllThreads();
    await repo.setCoachSession(thread.propertyId, thread.id, {
      hasNewGuestMessageSinceEdit: false,
      turns: [
        {
          id: 'turn-1',
          sender: 'agent',
          text: 'Draft ready.',
          note: null,
          draft: 'Custom edited host draft in progress.',
          editedByUser: true,
          createdAt: '2026-11-20T05:10:00.000Z',
        },
      ],
    });

    const raw2 = [
      'From: Airbnb <automated@airbnb.com>',
      'To: cohost@example.com',
      'Subject: RE: Reservation for Maple Loft | Getaway + Monthly Discount, June 14 - 20, 2026',
      'Date: Sun, 20 Jun 2026 14:12:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'For your protection and safety, always communicate through Airbnb [https://www.airbnb.com/help].',
      '',
      'JORDAN',
      'Booker',
      'One more thing: we left a phone charger on the kitchen counter, could the cleaner set it aside?',
      '',
      'Reply',
      '[https://www.airbnb.com/hosting/thread/1000000001]',
    ].join('\r\n');

    const res2 = await service.processRawEmail(raw2, 'gm-burst-2');
    expect(res2.outcome).toBe('guest_message_ingested');

    const updated = await repo.getThread(thread.propertyId, thread.id);
    expect(updated?.activeCoachSession?.hasNewGuestMessageSinceEdit).toBe(true);
    expect(updated?.activeCoachSession?.turns[0]?.draft).toBe(
      'Custom edited host draft in progress.',
    );
    expect(updated?.unansweredCount).toBe(2);
  });

  it('flags below-floor discount offers, routes unmatched listings without auto-drafting, and ignores Airbnb noise', async () => {
    const { repo, alerts, service } = createHarness();

    // Noise emails produce zero threads and zero push alerts
    const noisePayout = await loadFixture('payout_noise.eml');
    const noiseReminder = await loadFixture('airbnb_reservation_reminder.eml');
    expect((await service.processRawEmail(noisePayout, 'gm-noise-1')).outcome).toBe(
      'ignored_noise',
    );
    expect((await service.processRawEmail(noiseReminder, 'gm-noise-2')).outcome).toBe(
      'ignored_noise',
    );
    expect(alerts).toHaveLength(0);

    // Unknown listing routes to unmatched queue (refuses to guess property)
    const unmatchedRaw = await loadFixture('inquiry_discount.eml');
    const unmatchedRes = await service.processRawEmail(unmatchedRaw, 'gm-unmatched-1');
    expect(unmatchedRes.outcome).toBe('unmatched');
    expect(repo.getSnapshot().unmatchedEmails).toHaveLength(1);
    expect(alerts).toHaveLength(1);

    // Discount offer matching Mountain Chalet flags the thread
    const chaletDiscountRaw = [
      'From: Alex Guest via Airbnb <express@airbnb.com>',
      'To: cohost@example.com',
      'Subject: Inquiry for Mountain Chalet, Dec 10 - 15, 2026',
      'Date: Tue, 20 Oct 2026 12:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Hi! Would you accept $750 total for the 5 nights? Ready to book.',
      'https://www.airbnb.com/hosting/thread/444555666',
      'https://www.airbnb.com/rooms/900000000000000002',
    ].join('\r\n');

    const flaggedRes = await service.processRawEmail(chaletDiscountRaw, 'gm-discount-1');
    expect(flaggedRes.outcome).toBe('guest_message_ingested');
    if (flaggedRes.outcome === 'guest_message_ingested') {
      expect(flaggedRes.flaggedDiscount).toBe(true);
      const thread = await repo.getThread(flaggedRes.propertyId, flaggedRes.threadId);
      expect(thread?.status).toBe('flagged');
      expect(thread?.discountAlert?.triggersWarning).toBe(true);
    }
  });

  it('does NOT merge two trips by the same guest more than 14 days apart or with different Airbnb thread IDs', async () => {
    const { repo, service } = createHarness();

    const trip1Raw = [
      'From: Taylor Guest via Airbnb <express@airbnb.com>',
      'To: cohost@example.com',
      'Subject: Inquiry for Coastal Loft, Oct 10 - 12, 2026',
      'Date: Thu, 01 Oct 2026 12:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Hi! Is parking available for a weekend trip?',
      'https://www.airbnb.com/rooms/900000000000000001',
    ].join('\r\n');

    const trip2Over14DaysLater = [
      'From: Taylor Guest via Airbnb <express@airbnb.com>',
      'To: cohost@example.com',
      'Subject: Inquiry for Coastal Loft, Oct 10 - 12, 2026',
      'Date: Thu, 29 Oct 2026 12:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Hi again! Checking on availability for another booking.',
      'https://www.airbnb.com/rooms/900000000000000001',
    ].join('\r\n');

    const res1 = await service.processRawEmail(trip1Raw, 'gm-neg-1');
    const res2 = await service.processRawEmail(trip2Over14DaysLater, 'gm-neg-2');
    expect(res1.outcome).toBe('guest_message_ingested');
    expect(res2.outcome).toBe('guest_message_ingested');
    expect(await repo.listAllThreads()).toHaveLength(2);

    // Same guest, same dates, within 14 days, but DIFFERENT explicit airbnbThreadIds -> must NOT merge
    const threadA = [
      'From: Casey Guest via Airbnb <express@airbnb.com>',
      'To: cohost@example.com',
      'Subject: Inquiry for Coastal Loft, Nov 5 - 8, 2026',
      'Date: Sun, 01 Nov 2026 10:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'First inquiry thread.',
      'https://www.airbnb.com/hosting/thread/111111111',
      'https://www.airbnb.com/rooms/900000000000000001',
    ].join('\r\n');

    const threadB = [
      'From: Casey Guest via Airbnb <express@airbnb.com>',
      'To: cohost@example.com',
      'Subject: Inquiry for Coastal Loft, Nov 5 - 8, 2026',
      'Date: Sun, 01 Nov 2026 12:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Second separate inquiry thread.',
      'https://www.airbnb.com/hosting/thread/222222222',
      'https://www.airbnb.com/rooms/900000000000000001',
    ].join('\r\n');

    await service.processRawEmail(threadA, 'gm-neg-3');
    await service.processRawEmail(threadB, 'gm-neg-4');
    expect(await repo.listAllThreads()).toHaveLength(4);
  });

  it('does not resurrect a stale inquiry discount warning once the stay is answered and confirmed', async () => {
    const { repo, service } = createHarness();

    const inquiryDiscount = [
      'From: Dana Guest via Airbnb <express@airbnb.com>',
      'To: cohost@example.com',
      'Subject: Inquiry for Mountain Chalet, Dec 10 - 15, 2026',
      'Date: Tue, 20 Oct 2026 12:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Would you consider $750 total for 5 nights?',
      'https://www.airbnb.com/hosting/thread/555666777',
      'https://www.airbnb.com/rooms/900000000000000002',
    ].join('\r\n');

    const first = await service.processRawEmail(inquiryDiscount, 'gm-stale-1');
    expect(first.outcome).toBe('guest_message_ingested');
    if (first.outcome !== 'guest_message_ingested') {
      throw new Error('Expected guest_message_ingested');
    }
    expect(first.flaggedDiscount).toBe(true);

    // Host marks thread sent
    await repo.markThreadSent(first.propertyId, first.threadId, {
      finalText: 'Thanks Dana, we have to keep our standard rate.',
      originalDraft: null,
      senderName: 'Alex',
      loggedManually: false,
    });

    // Later guest confirms and asks a normal arrival question
    const confirmedFollowUp = [
      'From: Airbnb <automated@airbnb.com>',
      'To: cohost@example.com',
      'Subject: RE: Reservation for Mountain Chalet, Dec 10 - 15, 2026',
      'Date: Wed, 09 Dec 2026 14:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'For your protection and safety, always communicate through Airbnb [https://www.airbnb.com/help].',
      '',
      'DANA',
      'Booker',
      'Excited for tomorrow! Where do we park?',
      '',
      'Reply',
      '[https://www.airbnb.com/hosting/thread/555666777]',
      'https://www.airbnb.com/rooms/900000000000000002',
    ].join('\r\n');

    const second = await service.processRawEmail(confirmedFollowUp, 'gm-stale-2');
    expect(second.outcome).toBe('guest_message_ingested');
    if (second.outcome === 'guest_message_ingested') {
      expect(second.flaggedDiscount).toBe(false);
      const updated = await repo.getThread(second.propertyId, second.threadId);
      expect(updated?.status).toBe('needs_reply');
      expect(updated?.discountAlert).toBeNull();
    }
  });
});
