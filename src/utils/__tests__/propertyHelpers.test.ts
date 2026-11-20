import { describe, expect, it } from 'vitest';
import type { Property } from '../../types/cohost.ts';
import {
  buildPropertySlugId,
  getPropertyDisplayLabel,
  mergeListingId,
  mergeListingTitleAlias,
  parseAirbnbListingInput,
  pickNextPropertySlot,
} from '../propertyHelpers.ts';

function buildStubProperty(overrides: Partial<Property>): Property {
  return {
    id: 'prop-test',
    name: 'Test Property',
    code: 'A',
    accentColor: '#095C57',
    airbnbListingIds: [],
    titleAliases: [],
    signOffOverride: null,
    needsReplyCount: 0,
    flaggedCount: 0,
    pricing: {
      nightlyFloor: 150,
      cleaningFee: 100,
      localTaxPct: 14,
      hostServiceFeePct: 15.5,
    },
    vendors: [],
    knowledgeSources: [],
    ...overrides,
  };
}

describe('propertyHelpers', () => {
  it('extracts numeric Airbnb listing IDs from room, plus, host editor, manage-your-space URLs, and raw IDs', () => {
    expect(
      parseAirbnbListingInput('https://www.airbnb.com/rooms/1048291048291048?guests=1&adults=2'),
    ).toEqual({
      listingIds: ['1048291048291048'],
      hasShortShareLink: false,
    });

    expect(
      parseAirbnbListingInput('https://airbnb.com/rooms/plus/98765432'),
    ).toEqual({
      listingIds: ['98765432'],
      hasShortShareLink: false,
    });

    expect(
      parseAirbnbListingInput('https://www.airbnb.com/hosting/listings/editor/123456789012345678/details/photo-tour'),
    ).toEqual({
      listingIds: ['123456789012345678'],
      hasShortShareLink: false,
    });

    expect(
      parseAirbnbListingInput('https://www.airbnb.com/manage-your-space/44556677/details'),
    ).toEqual({
      listingIds: ['44556677'],
      hasShortShareLink: false,
    });

    expect(
      parseAirbnbListingInput('11223344, https://www.airbnb.com/rooms/55667788, 11223344'),
    ).toEqual({
      listingIds: ['11223344', '55667788'],
      hasShortShareLink: false,
    });
  });

  it('flags Airbnb short share links (/h/ and abnb.me) that hide the numeric listing ID', () => {
    expect(parseAirbnbListingInput('https://www.airbnb.com/h/maple-loft-getaway')).toEqual({
      listingIds: [],
      hasShortShareLink: true,
    });

    expect(parseAirbnbListingInput('https://abnb.me/evtg/abc123XYZ')).toEqual({
      listingIds: [],
      hasShortShareLink: true,
    });
  });

  it('auto-assigns accent slots in Teal -> Ochre -> Rose order and cycles cleanly on 4th+ properties', () => {
    expect(pickNextPropertySlot([])).toEqual({ code: 'A', accentColor: '#095C57' });
    expect(pickNextPropertySlot([buildStubProperty({ code: 'A' })])).toEqual({
      code: 'B',
      accentColor: '#8C4A00',
    });
    expect(
      pickNextPropertySlot([
        buildStubProperty({ code: 'A' }),
        buildStubProperty({ code: 'B' }),
      ]),
    ).toEqual({ code: 'C', accentColor: '#7F2A44' });
    expect(
      pickNextPropertySlot([
        buildStubProperty({ code: 'A' }),
        buildStubProperty({ code: 'B' }),
        buildStubProperty({ code: 'C' }),
      ]),
    ).toEqual({ code: 'A', accentColor: '#095C57' });
  });

  it('merges full listing titles without splitting commas and skips truncated or duplicate hints', () => {
    const initial = ['Maple Loft, Chef Kitchen & Patio'];
    expect(mergeListingTitleAlias(initial, 'maple loft, chef kitchen & patio')).toEqual(initial);
    expect(mergeListingTitleAlias(initial, 'Maple Loft, Chef Kitchen...')).toEqual(initial);
    expect(mergeListingTitleAlias(initial, 'Maple Loft…')).toEqual(initial);
    expect(mergeListingTitleAlias(initial, 'abc')).toEqual(initial);
    expect(mergeListingTitleAlias(initial, '  Maple Loft, Downtown Retreat  ')).toEqual([
      'Maple Loft, Chef Kitchen & Patio',
      'Maple Loft, Downtown Retreat',
    ]);
  });

  it('merges numeric listing IDs cleanly without duplicates', () => {
    expect(mergeListingId(['11112222'], '11112222')).toEqual(['11112222']);
    expect(mergeListingId(['11112222'], '33334444')).toEqual(['11112222', '33334444']);
    expect(mergeListingId(['11112222'], 'not-numeric')).toEqual(['11112222']);
  });

  it('builds collision-free property slugs and returns clean property names without letter prefixes', () => {
    expect(buildPropertySlugId('Maple Loft', [])).toBe('prop-maple-loft');
    expect(buildPropertySlugId('Maple Loft', ['prop-maple-loft'])).toBe('prop-maple-loft-2');
    expect(buildPropertySlugId('!!!', [])).toBe('prop-listing');
    expect(getPropertyDisplayLabel(buildStubProperty({ name: 'Maple Loft', code: 'A' }))).toBe(
      'Maple Loft',
    );
  });
});
