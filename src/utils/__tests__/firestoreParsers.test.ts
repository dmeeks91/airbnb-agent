import { describe, expect, it } from 'vitest';
import { createSampleUnmatchedEmail, createSeedSnapshot } from '../../data/seedData.ts';
import {
  parseActiveCoachSession,
  parseDiscountAlert,
  parseThreadDoc,
  parseUnmatchedEmailDoc,
} from '../firestoreParsers.ts';

describe('firestoreParsers hydration (discountAlert, activeCoachSession, rawParsed)', () => {
  it('hydrates discountAlert and activeCoachSession faithfully from Firestore thread documents', () => {
    const seed = createSeedSnapshot();
    const sarah = seed.threads['prop-mountain-chalet'][0];
    expect(sarah.discountAlert).not.toBeNull();

    const firestoreDoc: Record<string, unknown> = {
      ...sarah,
      activeCoachSession: {
        hasNewGuestMessageSinceEdit: true,
        turns: [
          {
            id: 'turn-1',
            sender: 'agent',
            text: 'Draft ready.',
            note: 'Protected private floor.',
            draft: 'Hi Sarah, thanks for reaching out.',
            originalDraft: 'Hi Sarah, thanks for your inquiry.',
            editedByUser: true,
            createdAt: '2026-11-20T05:10:00.000Z',
          },
          {
            id: 'turn-2',
            sender: 'host',
            text: 'Offer 1 PM early check-in instead.',
            note: null,
            draft: null,
            editedByUser: false,
            createdAt: '2026-11-20T05:11:00.000Z',
          },
        ],
      },
    };

    const hydrated = parseThreadDoc(sarah.id, sarah.propertyId, firestoreDoc);

    expect(hydrated.discountAlert).not.toBeNull();
    expect(hydrated.discountAlert?.offeredAmount).toBe(800);
    expect(hydrated.discountAlert?.nights).toBe(5);
    expect(hydrated.discountAlert?.triggersWarning).toBe(true);
    expect(hydrated.discountAlert?.allIn.estimatedNetPerNight).toBe(
      sarah.discountAlert?.allIn.estimatedNetPerNight,
    );
    expect(hydrated.discountAlert?.roomOnly.estimatedNetPerNight).toBe(
      sarah.discountAlert?.roomOnly.estimatedNetPerNight,
    );

    expect(hydrated.activeCoachSession).not.toBeNull();
    expect(hydrated.activeCoachSession?.hasNewGuestMessageSinceEdit).toBe(true);
    expect(hydrated.activeCoachSession?.turns).toHaveLength(2);
    expect(hydrated.activeCoachSession?.turns[0]?.editedByUser).toBe(true);
    expect(hydrated.activeCoachSession?.turns[0]?.originalDraft).toBe(
      'Hi Sarah, thanks for your inquiry.',
    );
    expect(hydrated.activeCoachSession?.turns[1]?.sender).toBe('host');
  });

  it('returns null cleanly for malformed discountAlert or activeCoachSession documents', () => {
    expect(parseDiscountAlert(null)).toBeNull();
    expect(parseDiscountAlert({ offeredAmount: 'bad' })).toBeNull();
    expect(parseActiveCoachSession(undefined)).toBeNull();
    expect(parseActiveCoachSession({ turns: 'not-an-array' })).toBeNull();
  });

  it('preserves full rawParsed messages and stay metadata on UnmatchedEmail documents', () => {
    const sample = createSampleUnmatchedEmail();
    const docData: Record<string, unknown> = {
      gmailMessageId: sample.gmailMessageId,
      guestName: sample.guestName,
      subject: sample.subject,
      bodyPreview: sample.bodyPreview,
      rawParsed: {
        ...sample.rawParsed,
        stage: 'inquiry',
      },
      receivedAt: sample.receivedAt,
      resolved: false,
    };

    const hydrated = parseUnmatchedEmailDoc(sample.id, docData);
    expect(hydrated.rawParsed.stayDates).toBe(sample.rawParsed.stayDates);
    expect(hydrated.rawParsed.nights).toBe(sample.rawParsed.nights);
    expect(hydrated.rawParsed.stage).toBe('inquiry');
    expect(hydrated.rawParsed.airbnbThreadId).toBe(sample.rawParsed.airbnbThreadId);
    expect(hydrated.rawParsed.messages).toHaveLength(1);
    expect(hydrated.rawParsed.messages[0]?.body).toBe(sample.rawParsed.messages[0]?.body);
  });
});
