import { describe, expect, it } from 'vitest';
import { createSeedSnapshot } from '../../data/seedData.ts';
import {
  extractBackfillCandidates,
  runGmailBackfill,
} from '../services/backfillService.ts';
import type { GmailSyncClient } from '../services/gmailClient.ts';
import { InMemoryServerRepository } from '../services/serverRepository.ts';

function buildRfc822Bundle(attachments: Array<{ filename: string; raw: string }>): Buffer {
  const boundary = 'cohost-bundle-boundary';
  const parts: string[] = [
    'From: Host Personal <personal@example.com>',
    'To: cohost@example.com',
    'Subject: Fwd: Past 30 days Airbnb messages',
    'Date: Fri, 20 Nov 2026 22:00:00 +0000',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    'Forwarding recent Airbnb emails as attachments.',
  ];

  for (const item of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: message/rfc822; name="${item.filename}"`,
      `Content-Disposition: attachment; filename="${item.filename}"`,
      '',
      item.raw,
    );
  }
  parts.push(`--${boundary}--`, '');
  return Buffer.from(parts.join('\r\n'), 'utf8');
}

function createEmptyRepo(): InMemoryServerRepository {
  const seed = createSeedSnapshot();
  return new InMemoryServerRepository({
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
}

describe('backfillService', () => {
  it('unwraps forwarded .eml bundles, sorts oldest-first so host replies close older guest messages, auto-dismisses stale threads, and stays idempotent on re-run', async () => {
    const repo = createEmptyRepo();

    // 1. Old guest message (Nov 10) + later host reply digest (Nov 11) in REVERSE attachment order
    const olderGuestMsg = [
      'From: Airbnb <automated@airbnb.com>',
      'To: personal@example.com',
      'Message-ID: <airbnb-msg-nov10@airbnb.com>',
      'Subject: RE: Reservation for Maple Loft | Getaway + Monthly Discount, Nov 12 - 15, 2026',
      'Date: Tue, 10 Nov 2026 14:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'For your protection and safety, always communicate through Airbnb [https://www.airbnb.com/help].',
      '',
      'JORDAN',
      'Booker',
      'Could we check in at 2 PM?',
      '',
      'Reply',
      '[https://www.airbnb.com/hosting/thread/900111222]',
      'https://www.airbnb.com/rooms/900000000000000001',
    ].join('\r\n');

    const laterHostReplyDigest = [
      'From: Airbnb <automated@airbnb.com>',
      'To: personal@example.com',
      'Message-ID: <airbnb-msg-nov11@airbnb.com>',
      'Subject: RE: Reservation for Maple Loft | Getaway + Monthly Discount, Nov 12 - 15, 2026',
      'Date: Wed, 11 Nov 2026 16:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'For your protection and safety, always communicate through Airbnb [https://www.airbnb.com/help].',
      '',
      'JORDAN',
      'Booker',
      'Could we check in at 2 PM?',
      '',
      'ALEX',
      'Host',
      'Yes, 2 PM check-in works great!',
      '',
      'Reply',
      '[https://www.airbnb.com/hosting/thread/900111222]',
      'https://www.airbnb.com/rooms/900000000000000001',
    ].join('\r\n');

    // 2. Stale unanswered guest inquiry from 10 days ago (Nov 10) -> should auto-dismiss (> 48h)
    const staleInquiry = [
      'From: Taylor Guest via Airbnb <express@airbnb.com>',
      'To: personal@example.com',
      'Message-ID: <airbnb-stale-nov10@airbnb.com>',
      'Subject: Inquiry for Coastal Loft, Nov 25 - 28, 2026',
      'Date: Tue, 10 Nov 2026 18:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Is street parking easy near the loft?',
      'https://www.airbnb.com/hosting/thread/900222333',
      'https://www.airbnb.com/rooms/900000000000000001',
    ].join('\r\n');

    // 3. Recent unanswered guest inquiry from 6 hours ago (Nov 20) -> must stay needs_reply
    const recentInquiry = [
      'From: Casey Guest via Airbnb <express@airbnb.com>',
      'To: personal@example.com',
      'Message-ID: <airbnb-recent-nov20@airbnb.com>',
      'Subject: Inquiry for Mountain Chalet, Dec 10 - 14, 2026',
      'Date: Fri, 20 Nov 2026 16:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Do you have a high chair available for our toddler?',
      'https://www.airbnb.com/hosting/thread/900333444',
      'https://www.airbnb.com/rooms/900000000000000002',
    ].join('\r\n');

    // 4. Airbnb payout noise inside the bundle -> ignored_noise
    const noiseEmail = [
      'From: Airbnb <automated@airbnb.com>',
      'To: personal@example.com',
      'Message-ID: <airbnb-payout-nov12@airbnb.com>',
      'Subject: A payout of $842.00 was sent',
      'Date: Thu, 12 Nov 2026 10:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Your payout is on the way.',
    ].join('\r\n');

    // Deliberately put laterHostReplyDigest BEFORE olderGuestMsg to prove oldest-first sorting works
    const bundleRaw = buildRfc822Bundle([
      { filename: 'later_host_reply.eml', raw: laterHostReplyDigest },
      { filename: 'older_guest.eml', raw: olderGuestMsg },
      { filename: 'stale_inquiry.eml', raw: staleInquiry },
      { filename: 'noise_payout.eml', raw: noiseEmail },
    ]);

    const rawByGmailId: Record<string, Buffer> = {
      'gm-bundle-1': bundleRaw,
      'gm-direct-recent': Buffer.from(recentInquiry, 'utf8'),
    };

    const fakeGmail: GmailSyncClient = {
      resolveLabelId: async () => 'Label_Cohost',
      listHistoryMessageIds: async () => ({
        messageIds: [],
        latestHistoryId: null,
        usedFallbackList: false,
      }),
      listLabelMessagesSince: async () => ['gm-bundle-1', 'gm-direct-recent'],
      fetchRawMessage: async (id) => rawByGmailId[id],
      renewWatch: async () => ({ historyId: '1', watchExpiresAt: '2026-11-27T00:00:00.000Z' }),
      getProfileHistoryId: async () => '300000',
    };

    const nowMs = Date.parse('2026-11-20T22:00:00.000Z');
    const summary = await runGmailBackfill(fakeGmail, repo, {
      labelId: 'Label_Cohost',
      days: 30,
      autoDismissOlderThanHours: 48,
      nowMs,
    });

    expect(summary).toEqual({
      scannedGmailMessages: 2,
      extractedAttachments: 4,
      extractedCandidates: 5,
      ingestedGuestMessages: 3,
      syncedHostReplies: 1,
      reservationUpdates: 0,
      ignoredNoise: 1,
      unmatched: 0,
      deduped: 0,
      autoDismissedOldThreads: 1,
    });

    const threads = await repo.listAllThreads();
    expect(threads).toHaveLength(3);

    const jordanThread = threads.find((t) => t.airbnbThreadId === '900111222');
    expect(jordanThread?.status).toBe('sent');
    expect(jordanThread?.lastSentBy).toBe('Alex');

    const taylorThread = threads.find((t) => t.airbnbThreadId === '900222333');
    expect(taylorThread?.status).toBe('dismissed');
    expect(taylorThread?.unansweredCount).toBe(0);

    const caseyThread = threads.find((t) => t.airbnbThreadId === '900333444');
    expect(caseyThread?.status).toBe('needs_reply');
    expect(caseyThread?.unansweredCount).toBe(1);

    // Re-running backfill must deduplicate 100% of candidates cleanly
    const secondRun = await runGmailBackfill(fakeGmail, repo, {
      labelId: 'Label_Cohost',
      days: 30,
      autoDismissOlderThanHours: 48,
      nowMs,
    });
    expect(secondRun.deduped).toBe(5);
    expect(secondRun.ingestedGuestMessages).toBe(0);
    expect(secondRun.autoDismissedOldThreads).toBe(0);
  });

  it('keeps regular non-bundle Airbnb emails intact when extracting candidates', async () => {
    const direct = [
      'From: Airbnb <automated@airbnb.com>',
      'To: cohost@example.com',
      'Subject: Inquiry for Coastal Loft, Dec 1 - 3, 2026',
      'Date: Thu, 19 Nov 2026 12:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Hello! Is early bag drop okay?',
      'https://www.airbnb.com/rooms/900000000000000001',
    ].join('\r\n');

    const candidates = await extractBackfillCandidates(direct, 'gm-direct-1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].dedupeId).toBe('gm-direct-1');
    expect(candidates[0].fromAttachment).toBe(false);
  });
});
