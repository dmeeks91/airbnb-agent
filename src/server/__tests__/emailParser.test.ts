import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAirbnbEmail } from '../services/emailParser.ts';
import { parseAirbnbEmailHybrid } from '../services/emailParserFallback.ts';
import { hasDiscountIntent } from '../services/discountDetector.ts';

const FIXTURES_DIR = path.resolve(process.cwd(), 'src/server/__tests__/fixtures');

async function loadFixture(filename: string): Promise<Buffer> {
  return fs.readFile(path.join(FIXTURES_DIR, filename));
}

describe('emailParser', () => {
  it('parses real Airbnb message digest with a single guest message and strips tracking/title noise', async () => {
    const raw = await loadFixture('airbnb_digest_single_guest.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-digest-1' });

    expect(parsed.airbnbTemplate).toBe('MESSAGING_NEW_MESSAGE_EMAIL_DIGEST');
    expect(parsed.classification).toBe('guest_message');
    expect(parsed.needsHostReply).toBe(true);
    expect(parsed.guestName).toBe('Jordan');
    expect(parsed.guestCount).toBe('4 adults');
    expect(parsed.stage).toBe('confirmed');
    expect(parsed.stayDates).toBe('June 14 - 20, 2026');
    expect(parsed.nights).toBe(6);
    expect(parsed.airbnbListingId).toBe('900000000000000001');
    expect(parsed.listingTitleHint).toBe('Maple Loft | Getaway + Monthly Discount');
    expect(parsed.airbnbThreadId).toBe('1000000001');
    expect(parsed.airbnbThreadUrl).toBe('https://www.airbnb.com/hosting/thread/1000000001');
    expect(parsed.messages).toEqual([
      {
        senderName: 'Jordan',
        role: 'guest',
        body: 'We are all packed up and heading out now! We took the trash bins to the alley behind the garage. Hope that works.\n\nThanks again for a smooth stay.',
      },
    ]);
    // Ensure listing title "Monthly Discount" does not bleed into guest message body
    expect(hasDiscountIntent(parsed.bodyText)).toBe(false);
  });

  it('classifies multi-message digest ending with a Host reply as host_reply_sync (needsHostReply=false)', async () => {
    const raw = await loadFixture('airbnb_digest_guest_and_host.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-digest-2' });

    expect(parsed.classification).toBe('host_reply_sync');
    expect(parsed.needsHostReply).toBe(false);
    expect(parsed.guestName).toBe('Taylor');
    expect(parsed.nights).toBe(2);
    expect(parsed.messages).toEqual([
      {
        senderName: 'Taylor',
        role: 'guest',
        body: 'Good morning. We checked out and locked up. Dishes are done and towels are in the laundry hamper.',
      },
      {
        senderName: 'Pat',
        role: 'host',
        body: 'Thanks for the update and safe travels home!',
      },
    ]);
  });

  it('parses real Airbnb initial inquiry template and strips profile metadata cleanly', async () => {
    const raw = await loadFixture('airbnb_initial_inquiry.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-inquiry-1' });

    expect(parsed.airbnbTemplate).toBe('booking/v2_migration/host_initial_inquiry');
    expect(parsed.classification).toBe('guest_message');
    expect(parsed.needsHostReply).toBe(true);
    expect(parsed.stage).toBe('inquiry');
    expect(parsed.guestName).toBe('Morgan');
    expect(parsed.guestCount).toBe('3 adults, 1 child');
    expect(parsed.nights).toBe(3);
    expect(parsed.airbnbThreadId).toBe('1000000003');
    expect(parsed.listingTitleHint).toBe('Maple Loft | Getaway + Monthly Discount');
    expect(parsed.bodyText).toBe(
      'Hi Pat! We are interested in your house for the weekend of 11/5-11/8. We were curious if you offer a late checkout option on Sunday? Thank you!',
    );
    expect(hasDiscountIntent(parsed.bodyText)).toBe(false);
  });

  it('parses pending reservation requests with Accept/Decline above the guest message', async () => {
    const raw = await loadFixture('airbnb_pending_request.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-pending-1' });

    expect(parsed.airbnbTemplate).toBe('booking/reservation_host_pending');
    expect(parsed.classification).toBe('guest_message');
    expect(parsed.needsHostReply).toBe(true);
    expect(parsed.stage).toBe('inquiry');
    expect(parsed.guestName).toBe('Riley');
    expect(parsed.guestCount).toBe('4 adults');
    expect(parsed.nights).toBe(4);
    expect(parsed.airbnbThreadId).toBeNull();
    expect(parsed.reservationCode).toBe('HMFAKE1234');
    expect(parsed.airbnbThreadUrl).toBe(
      'https://www.airbnb.com/hosting/reservations/details/HMFAKE1234',
    );
    expect(parsed.bodyText).toBe(
      "Hi my name is Riley. I'm traveling into town for a family reunion weekend and your place looks close to everyone.",
    );
  });

  it('treats Pre-approval digests as inquiry stage and preserves multi-message guest bursts', async () => {
    const raw = await loadFixture('airbnb_preapproval_burst.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-preapproval-1' });

    expect(parsed.airbnbTemplate).toBe('MESSAGING_NEW_MESSAGE_EMAIL_DIGEST');
    expect(parsed.classification).toBe('guest_message');
    expect(parsed.needsHostReply).toBe(true);
    expect(parsed.stage).toBe('inquiry');
    expect(parsed.guestName).toBe('Avery');
    expect(parsed.guestCount).toBe('2 adults, 2 children');
    expect(parsed.nights).toBe(3);
    expect(parsed.listingTitleHint).toBe("3BR City Haven | Chef's Kitchen + Monthly Rates");
    expect(parsed.airbnbThreadId).toBe('1000000006');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toEqual({
      senderName: 'Avery',
      role: 'guest',
      body: 'We are coming in for a weekend tournament with two kids and really like the location near the park!',
    });
    expect(parsed.messages[1]).toEqual({
      senderName: 'Avery',
      role: 'guest',
      body: 'Happy to leave a positive review as well!',
    });
  });

  it('filters out ReservationHostReminderTemplate arrival reminders as ignored_noise', async () => {
    const raw = await loadFixture('airbnb_reservation_reminder.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-res-reminder-1' });

    expect(parsed.airbnbTemplate).toBe('booking/host/ReservationHostReminderTemplate');
    expect(parsed.classification).toBe('ignored_noise');
    expect(parsed.needsHostReply).toBe(false);
    expect(parsed.ignoreReason).toBe('reservation_reminder');
    expect(parsed.messages).toHaveLength(0);
  });

  it('filters out Airbnb inquiry reminder emails containing no guest message body', async () => {
    const raw = await loadFixture('airbnb_inquiry_reminder.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-reminder-1' });

    expect(parsed.airbnbTemplate).toBe('RESERVATION_INQUIRIES_REMINDER');
    expect(parsed.classification).toBe('ignored_noise');
    expect(parsed.needsHostReply).toBe(false);
    expect(parsed.ignoreReason).toBe('inquiry_reminder');
    expect(parsed.guestName).toBe('Jamie');
    expect(parsed.messages).toHaveLength(0);
  });

  it('parses generic inquiry emails with dates, thread URL, listing ID, and clean body', async () => {
    const raw = await loadFixture('inquiry_discount.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-001' });

    expect(parsed.classification).toBe('guest_message');
    expect(parsed.guestName).toBe('Jordan Taylor');
    expect(parsed.stage).toBe('inquiry');
    expect(parsed.stayDates).toBe('May 14 - 17, 2026');
    expect(parsed.nights).toBe(3);
    expect(parsed.airbnbThreadId).toBe('987654321');
    expect(parsed.airbnbThreadUrl).toBe('https://www.airbnb.com/hosting/thread/987654321');
    expect(parsed.airbnbListingId).toBe('11223344');
    expect(parsed.listingTitleHint).toBe('Sunny 2BR near Carytown & VMFA');
    expect(parsed.bodyText).toContain('$600 total for the 3 nights');
    expect(parsed.bodyText).not.toContain('888 Brannan');
    expect(parsed.bodyText).not.toContain('Respond to Jordan Taylor');
  });

  it('strips quoted reply history and footer boilerplate on follow-up replies', async () => {
    const raw = await loadFixture('confirmed_followup_quoted.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-002' });

    expect(parsed.classification).toBe('guest_message');
    expect(parsed.guestName).toBe('Alex Rivera');
    expect(parsed.stage).toBe('confirmed');
    expect(parsed.nights).toBe(3);
    expect(parsed.airbnbThreadId).toBe('555444333');
    expect(parsed.bodyText).toBe(
      'Thanks! Our flight lands at 1:30pm, any chance we can drop our bags early around 2pm?',
    );
  });

  it('filters out non-guest Airbnb payout notifications as ignored_noise', async () => {
    const raw = await loadFixture('payout_noise.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-003' });

    expect(parsed.classification).toBe('ignored_noise');
    expect(parsed.ignoreReason).toBe('payout_notice');
  });

  it('detects attachment/image-only messages when body text is empty after cleanup', async () => {
    const raw = await loadFixture('image_only_message.eml');
    const parsed = await parseAirbnbEmail(raw, { gmailMessageId: 'gm-004' });

    expect(parsed.classification).toBe('guest_message');
    expect(parsed.guestName).toBe('Casey Morgan');
    expect(parsed.airbnbThreadId).toBe('777888999');
    expect(parsed.hasAttachmentsOnly).toBe(true);
    expect(parsed.bodyText).toContain('Open Airbnb to view');
  });

  it('computes nights accurately across month and year boundaries', async () => {
    const raw = [
      'From: Sam Lee via Airbnb <express@airbnb.com>',
      'To: host@example.com',
      'Subject: RE: Inquiry for Cozy Loft - Dec 30, 2026 - Jan 2, 2027',
      'Date: Tue, 15 Dec 2026 10:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Sam Lee sent you a message',
      '',
      'Is the fireplace gas or wood-burning?',
    ].join('\r\n');

    const parsed = await parseAirbnbEmail(raw);
    expect(parsed.nights).toBe(3);
    expect(parsed.stayDates).toBe('Dec 30, 2026 - Jan 2, 2027');
  });

  it('ignores marketing senders, review reminders, and non-Airbnb emails', async () => {
    const marketing = [
      'From: Airbnb <discover@airbnb.com>',
      'To: host@example.com',
      'Subject: Spring hosting tips for Richmond',
      'Content-Type: text/plain',
      '',
      'Boost your bookings this spring!',
    ].join('\r\n');

    const review = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: Leave a review for Alex',
      'Content-Type: text/plain',
      '',
      'Share how Alex did as a guest.',
    ].join('\r\n');

    const unrelated = [
      'From: Newsletter <hello@example.org>',
      'To: host@example.com',
      'Subject: Weekly digest',
      'Content-Type: text/plain',
      '',
      'Hello world',
    ].join('\r\n');

    expect((await parseAirbnbEmail(marketing)).classification).toBe('ignored_noise');
    expect((await parseAirbnbEmail(review)).classification).toBe('ignored_noise');
    expect((await parseAirbnbEmail(unrelated)).classification).toBe('ignored_noise');
  });

  it('parses international airbnb.co.uk co-host replies, UK dates, UK Enquiry spelling, inline CTA stop markers, and Unicode names', async () => {
    const ukHostReply = [
      'From: Airbnb <express@airbnb.com>',
      'To: cohost@example.com',
      'Subject: RE: Reservation for 3BR City Loft | Chef Kitchen, 19–22 Nov',
      'Date: Fri, 20 Nov 2026 13:05:06 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'https://www.airbnb.co.uk/?c=.pi80.pkTUVTU0FHSU5HX05FV19NRVNTQUdFX0VNQUlMX0RJR0VTVA%3D%3D',
      '',
      'For your protection and safety, always communicate through Airbnb',
      '[https://www.airbnb.co.uk/help/article/209].',
      '',
      '   ALEX',
      '   Host',
      '   Just checking in after your first night to make sure everything is going smoothly.',
      '',
      'Reply',
      '[https://www.airbnb.co.uk/hosting/thread/1000000091?inbox_type=host]',
      'https://www.airbnb.co.uk/rooms/900000000000000002',
    ].join('\r\n');

    const parsedHost = await parseAirbnbEmail(ukHostReply, { gmailMessageId: 'gm-uk-1' });
    expect(parsedHost.classification).toBe('host_reply_sync');
    expect(parsedHost.airbnbThreadId).toBe('1000000091');
    expect(parsedHost.airbnbThreadUrl).toBe('https://www.airbnb.com/hosting/thread/1000000091');
    expect(parsedHost.airbnbListingId).toBe('900000000000000002');
    expect(parsedHost.listingTitleHint).toBe('3BR City Loft | Chef Kitchen');
    expect(parsedHost.stayDates).toBe('Nov 19 - 22');
    expect(parsedHost.nights).toBe(3);
    expect(parsedHost.messages).toEqual([
      {
        senderName: 'Alex',
        role: 'host',
        body: 'Just checking in after your first night to make sure everything is going smoothly.',
      },
    ]);

    const ukEnquiry = [
      'From: Airbnb <express@airbnb.com>',
      'To: cohost@example.com',
      'Subject: RE: Enquiry for 3BR City Loft | Chef Kitchen, 23–25 Jul',
      'Date: Mon, 09 Nov 2026 01:49:47 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'For your protection and safety, always communicate through Airbnb',
      '[https://www.airbnb.co.uk/help/article/209].',
      '',
      '\u2068MORGAN.\u2069',
      'Booker',
      'Okay thanks so much',
      '',
      'Review enquiry [https://www.airbnb.co.uk/hosting/thread/1000000092]',
      'https://www.airbnb.co.uk/rooms/900000000000000002',
    ].join('\r\n');

    const parsedEnquiry = await parseAirbnbEmail(ukEnquiry, { gmailMessageId: 'gm-uk-2' });
    expect(parsedEnquiry.classification).toBe('guest_message');
    expect(parsedEnquiry.stage).toBe('inquiry');
    expect(parsedEnquiry.airbnbThreadId).toBe('1000000092');
    expect(parsedEnquiry.stayDates).toBe('Jul 23 - 25');
    expect(parsedEnquiry.nights).toBe(2);
    expect(parsedEnquiry.guestName).toBe('Morgan.');
    expect(parsedEnquiry.messages[0]?.senderName).toBe('Morgan.');
    expect(parsedEnquiry.bodyText).toBe('Okay thanks so much');
    expect(parsedEnquiry.bodyText).not.toContain('Review enquiry');
  });

  it('classifies Canceled: Reservation notices as reservation_update and filters co-host invitations (including Unicode hyphens) as ignored_noise', async () => {
    const canceled = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: Canceled: Reservation HMFAKE9999 for December 22 – 24',
      'Content-Type: text/plain',
      '',
      'This reservation has been canceled and your calendar has been updated.',
    ].join('\r\n');

    const cohostAccepted = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: Jordan accepted your invite to co\u2011host',
      'Content-Type: text/plain',
      '',
      'Jordan is now listed as a co-host on your property.',
    ].join('\r\n');

    const cohostSent = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: Your co-host invitation was sent',
      'Content-Type: text/plain',
      '',
      'We sent your invitation to co-host.',
    ].join('\r\n');

    const parsedCanceled = await parseAirbnbEmail(canceled);
    expect(parsedCanceled.classification).toBe('reservation_update');
    expect(parsedCanceled.reservationUpdateType).toBe('canceled');
    expect(parsedCanceled.reservationCode).toBe('HMFAKE9999');
    expect((await parseAirbnbEmail(cohostAccepted)).classification).toBe('ignored_noise');
    expect((await parseAirbnbEmail(cohostSent)).classification).toBe('ignored_noise');
  });

  it('uses narrow LLM fallback only for unrecognized Airbnb templates while enforcing deterministic IDs and fail-safe inquiry stage', async () => {
    let fallbackCalls = 0;

    // 1. Standard digest template must NOT invoke LLM fallback
    const standardDigest = await loadFixture('airbnb_digest_single_guest.eml');
    const digestResult = await parseAirbnbEmailHybrid(standardDigest, {
      gmailMessageId: 'gm-hyb-1',
      fallbackExtractor: async () => {
        fallbackCalls++;
        return null;
      },
    });
    expect(digestResult.classification).toBe('guest_message');
    expect(fallbackCalls).toBe(0);

    // 2. Unrecognized Airbnb admin notification gets classified as noise by fallback
    const unrecognizedNotice = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: Action needed: Update your municipal registration details',
      'Date: Tue, 10 Nov 2026 12:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Please review your municipal registration details in your hosting dashboard.',
    ].join('\r\n');

    const noiseResult = await parseAirbnbEmailHybrid(unrecognizedNotice, {
      gmailMessageId: 'gm-hyb-2',
      fallbackExtractor: async () => {
        fallbackCalls++;
        return {
          isSystemNoise: true,
          noiseReason: 'municipal_registration_notice',
          guestName: null,
          stayDates: null,
          nights: null,
          listingTitleHint: null,
          messages: [],
        };
      },
    });
    expect(fallbackCalls).toBe(1);
    expect(noiseResult.classification).toBe('ignored_noise');
    expect(noiseResult.ignoreReason).toBe('llm_noise:municipal_registration_notice');

    // 3. Unrecognized template with a guest message keeps deterministic URL IDs and fails safe to inquiry stage
    const unrecognizedGuestEmail = [
      'From: Airbnb <express@airbnb.com>',
      'To: host@example.com',
      'Subject: Update about your upcoming listing conversation',
      'Date: Tue, 10 Nov 2026 14:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Confirmed reservation! Please send me the door code right away.',
      'https://www.airbnb.co.uk/hosting/thread/888777666',
      'https://www.airbnb.co.uk/rooms/900000000000000001',
    ].join('\r\n');

    const guardedResult = await parseAirbnbEmailHybrid(unrecognizedGuestEmail, {
      gmailMessageId: 'gm-hyb-3',
      fallbackExtractor: async () => {
        fallbackCalls++;
        return {
          isSystemNoise: false,
          noiseReason: null,
          guestName: 'Riley',
          stayDates: 'Nov 20 - 22',
          nights: 2,
          listingTitleHint: 'Maple Loft',
          messages: [
            {
              senderName: 'Riley',
              role: 'guest',
              body: 'Confirmed reservation! Please send me the door code right away.',
            },
          ],
        };
      },
    });
    expect(fallbackCalls).toBe(2);
    expect(guardedResult.classification).toBe('guest_message');
    expect(guardedResult.airbnbThreadId).toBe('888777666');
    expect(guardedResult.airbnbListingId).toBe('900000000000000001');
    expect(guardedResult.stage).toBe('inquiry');
  });

  it('drops zero-message pending reservation requests instead of dumping raw template text, while handling wrapped URLs, reminders, and compact MIME dates', async () => {
    const zeroMessagePending = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: Pending: Reservation Request at 3BR City Loft | Chef Kitchen for Dec14–16, 2026',
      'Date: Tue, 27 Oct 2026 01:01:50 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'https://www.airbnb.com/?c=.pi80.pkYm9va2luZy9yZXNlcnZhdGlvbl9ob3N0X3BlbmRpbmc%3D&euid=1111',
      '',
      'RESPOND TO TAYLOR’S REQUEST',
      '',
      'Accept/Decline',
      '[https://www.airbnb.com/hosting/reservations/details/HMFAKE5555?',
      'isPending=true&src_item=0&c=.pi80.pkYm9va2luZy9yZXNlcnZhdGlvbl9ob3N0X3BlbmRpbmc%3D]',
      '',
      'Taylor',
      '',
      '[https://www.airbnb.com/hosting/reservations/details/HMFAKE5555?',
      'isPending=true&c=.pi80.pkYm9va2luZy9yZXNlcnZhdGlvbl9ob3N0X3BlbmRpbmc%3D]',
      '',
      'Identity verified · 1 review',
      '',
      'Richmond, VA',
      '',
      'https://www.airbnb.com/rooms/900000000000000002?c=.pi80.pkYm9va2luZy9yZXNlcnZhdGlvbl9ob3N0X3BlbmRpbmc%3D',
      '',
      '3BR CITY LOFT | CHEF KITCHEN',
      'Entire home/apt',
    ].join('\r\n');

    let fallbackCalled = false;
    const parsedEmpty = await parseAirbnbEmailHybrid(zeroMessagePending, {
      gmailMessageId: 'gm-empty-pending',
      fallbackExtractor: async () => {
        fallbackCalled = true;
        return null;
      },
    });
    expect(parsedEmpty.classification).toBe('ignored_noise');
    expect(parsedEmpty.ignoreReason).toBe('empty_message_body');
    expect(parsedEmpty.messages).toHaveLength(0);
    expect(parsedEmpty.bodyText).toBe('');
    expect(parsedEmpty.stayDates).toBe('Dec 14 - 16, 2026');
    expect(parsedEmpty.listingTitleHint).toBe('3BR City Loft | Chef Kitchen');
    expect(fallbackCalled).toBe(false);

    const wrappedUrlPendingWithMessage = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: Pending: Reservation Request at 3BR City Loft | Chef Kitchen for Oct31–Nov 2, 2026',
      'Date: Tue, 27 Oct 2026 02:00:00 +0000',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'RESPOND TO TAYLOR’S REQUEST',
      '',
      'Taylor',
      '',
      '[https://www.airbnb.com/hosting/reservations/details/HMFAKE5556?',
      'isPending=true&c=.pi80.pkYm9va2luZy9yZXNlcnZhdGlvbl9ob3N0X3BlbmRpbmc%3D]',
      '',
      'Identity verified · 2 reviews',
      'Richmond, VA',
      '',
      'Hi! Visiting family for the weekend, is street parking free?',
      '',
      'https://www.airbnb.com/rooms/900000000000000002',
    ].join('\r\n');

    const parsedWrapped = await parseAirbnbEmail(wrappedUrlPendingWithMessage, {
      gmailMessageId: 'gm-wrapped-pending',
    });
    expect(parsedWrapped.classification).toBe('guest_message');
    expect(parsedWrapped.stayDates).toBe('Oct 31 - Nov 2, 2026');
    expect(parsedWrapped.nights).toBe(2);
    expect(parsedWrapped.bodyText).toBe(
      'Hi! Visiting family for the weekend, is street parking free?',
    );

    const reminderRequest = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: Reminder: Reservation Request at 3BR City Loft for Dec14–16, 2026',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'You have 12 hours left to respond to this reservation request.',
    ].join('\r\n');

    const decisionReminder = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: When you’re ready, let Jordan know whatyou’ve decided about their inquiry.',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Pre-approve or decline the inquiry.',
    ].join('\r\n');

    const hostingTip = [
      'From: Airbnb <automated@airbnb.com>',
      'To: host@example.com',
      'Subject: A great price is key to getting booked',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Try dynamic pricing tips in your calendar.',
    ].join('\r\n');

    expect((await parseAirbnbEmail(reminderRequest)).classification).toBe('ignored_noise');
    expect((await parseAirbnbEmail(decisionReminder)).classification).toBe('ignored_noise');
    expect((await parseAirbnbEmail(hostingTip)).classification).toBe('ignored_noise');
  });
});
