import { describe, expect, it } from 'vitest';
import { matchProperty } from '../services/propertyMatcher.ts';
import {
  type ExistingThreadRef,
  type ParsedAirbnbEmail,
  type PropertyMatchCandidate,
} from '../../types/cohost.ts';

const PROPERTIES: PropertyMatchCandidate[] = [
  {
    id: 'prop-carytown',
    name: 'Sunny 2BR near Carytown & VMFA',
    airbnbListingIds: ['11223344'],
    titleAliases: ['Carytown Retreat', 'Sunny 2BR near Carytown'],
  },
  {
    id: 'prop-riverfront',
    name: 'Riverfront Craftsman Cottage',
    airbnbListingIds: ['99887766'],
    titleAliases: ['Craftsman Cottage'],
  },
];

const EXISTING_THREADS: ExistingThreadRef[] = [
  {
    threadId: 'thread-doc-1',
    propertyId: 'prop-riverfront',
    airbnbThreadId: '555444333',
  },
];

function makeParsed(overrides: Partial<ParsedAirbnbEmail>): ParsedAirbnbEmail {
  return {
    gmailMessageId: 'msg-1',
    rfcMessageId: '<msg-1@mail.airbnb.com>',
    fromAddress: 'express@airbnb.com',
    fromName: 'Guest via Airbnb',
    replyToAddress: null,
    subject: 'New message from Guest',
    sentAt: '2026-05-12T14:22:00.000Z',
    airbnbTemplate: null,
    classification: 'guest_message',
    needsHostReply: true,
    ignoreReason: null,
    guestName: 'Guest',
    guestCount: null,
    messages: [{ senderName: 'Guest', role: 'guest', body: 'Hello!' }],
    bodyText: 'Hello!',
    hasAttachmentsOnly: false,
    stage: 'confirmed',
    stayDates: null,
    nights: null,
    airbnbThreadId: null,
    reservationCode: null,
    airbnbThreadUrl: null,
    allAirbnbUrls: [],
    airbnbListingId: null,
    listingTitleHint: null,
    ...overrides,
  };
}

describe('propertyMatcher', () => {
  it('matches by existing Airbnb thread ID first', () => {
    const result = matchProperty(
      makeParsed({ airbnbThreadId: '555444333', airbnbListingId: '11223344' }),
      PROPERTIES,
      EXISTING_THREADS,
    );

    expect(result).toEqual({
      matched: true,
      propertyId: 'prop-riverfront',
      matchedBy: 'thread_id',
      existingThreadId: 'thread-doc-1',
    });
  });

  it('matches by Airbnb listing ID when thread is new', () => {
    const result = matchProperty(
      makeParsed({ airbnbThreadId: 'new-thread', airbnbListingId: '11223344' }),
      PROPERTIES,
      EXISTING_THREADS,
    );

    expect(result).toEqual({
      matched: true,
      propertyId: 'prop-carytown',
      matchedBy: 'listing_id',
    });
  });

  it('matches truncated subject title prefixes safely when unambiguous', () => {
    const result = matchProperty(
      makeParsed({
        listingTitleHint: 'Sunny 2BR near Carytown...',
      }),
      PROPERTIES,
      EXISTING_THREADS,
    );

    expect(result).toEqual({
      matched: true,
      propertyId: 'prop-carytown',
      matchedBy: 'title_alias',
    });
  });

  it('returns unmatched instead of guessing when title prefix is ambiguous', () => {
    const similarProps: PropertyMatchCandidate[] = [
      {
        id: 'prop-a',
        name: 'Historic Fan Townhouse Unit A',
        airbnbListingIds: ['111'],
        titleAliases: [],
      },
      {
        id: 'prop-b',
        name: 'Historic Fan Townhouse Unit B',
        airbnbListingIds: ['222'],
        titleAliases: [],
      },
    ];

    const result = matchProperty(
      makeParsed({ listingTitleHint: 'Historic Fan Townhouse...' }),
      similarProps,
      [],
    );

    expect(result.matched).toBe(false);
  });

  it('returns unmatched when no identifiers or aliases match', () => {
    const result = matchProperty(
      makeParsed({ subject: 'New message from Guest' }),
      PROPERTIES,
      EXISTING_THREADS,
    );

    expect(result.matched).toBe(false);
  });
});
