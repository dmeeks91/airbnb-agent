import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAirbnbEmail } from '../services/emailParser.ts';
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
});
