import { describe, expect, it } from 'vitest';
import {
  calculateBothPayoutModes,
  calculatePayoutBreakdown,
} from '../services/payoutMath.ts';
import { type PropertyPricing } from '../../types/cohost.ts';

const RICHMOND_PRICING: PropertyPricing = {
  nightlyFloor: 150,
  cleaningFee: 120,
  localTaxPct: 14,
  hostServiceFeePct: 15.5,
};

describe('payoutMath', () => {
  it('calculates all-in guest quote under 15.5% host-only fee and 14% Richmond tax', () => {
    const result = calculatePayoutBreakdown(600, 3, RICHMOND_PRICING, 'all_in');

    // Pre-tax subtotal = 600 / 1.14 = 526.32
    expect(result.preTaxSubtotal).toBe(526.32);
    expect(result.estimatedTax).toBe(73.68);
    expect(result.estimatedAccommodation).toBe(406.32);
    // 15.5% host fee on 526.32 = 81.58
    expect(result.hostServiceFee).toBe(81.58);
    // Payout = 526.32 - 81.58 = 444.74; after $120 cleaning = 324.74 -> $108.25/night
    expect(result.totalHostPayout).toBe(444.74);
    expect(result.netAfterCleaning).toBe(324.74);
    expect(result.estimatedNetPerNight).toBe(108.25);
    expect(result.belowFloor).toBe(true);
    expect(result.deltaPerNight).toBe(-41.75);
  });

  it('calculates room-only guest quote for the same $600 / 3-night offer', () => {
    const result = calculatePayoutBreakdown(600, 3, RICHMOND_PRICING, 'room_only');

    // Accommodation = 600, pre-tax subtotal = 720, tax = 100.80
    expect(result.estimatedAccommodation).toBe(600);
    expect(result.preTaxSubtotal).toBe(720);
    expect(result.estimatedTax).toBe(100.8);
    // 15.5% host fee on 720 = 111.60; payout = 608.40; after $120 cleaning = 488.40 -> $162.80/night
    expect(result.hostServiceFee).toBe(111.6);
    expect(result.totalHostPayout).toBe(608.4);
    expect(result.netAfterCleaning).toBe(488.4);
    expect(result.estimatedNetPerNight).toBe(162.8);
    expect(result.belowFloor).toBe(false);
    expect(result.deltaPerNight).toBe(12.8);
  });

  it('returns both breakdown modes consistently', () => {
    const both = calculateBothPayoutModes(600, 3, RICHMOND_PRICING);
    expect(both.allIn.belowFloor).toBe(true);
    expect(both.roomOnly.belowFloor).toBe(false);
  });

  it('clamps accommodation at zero when all-in quote is below cleaning fee + tax', () => {
    const result = calculatePayoutBreakdown(100, 2, RICHMOND_PRICING, 'all_in');
    expect(result.estimatedAccommodation).toBe(0);
    expect(result.netAfterCleaning).toBeLessThan(0);
    expect(result.belowFloor).toBe(true);
  });

  it('matches verified real Airbnb receipt ($740 stay + 14% tax = $843.60 guest paid -> $625.30 host payout)', () => {
    const result = calculatePayoutBreakdown(
      843.6,
      3,
      {
        nightlyFloor: 150,
        cleaningFee: 0,
        localTaxPct: 14,
        hostServiceFeePct: 15.5,
      },
      'all_in',
    );

    expect(result.preTaxSubtotal).toBe(740);
    expect(result.estimatedTax).toBe(103.6);
    expect(result.hostServiceFee).toBe(114.7);
    expect(result.totalHostPayout).toBe(625.3);
  });

  it('rejects non-positive quote or non-integer nights', () => {
    expect(() => calculatePayoutBreakdown(0, 2, RICHMOND_PRICING, 'all_in')).toThrow();
    expect(() => calculatePayoutBreakdown(500, 0, RICHMOND_PRICING, 'all_in')).toThrow();
    expect(() => calculatePayoutBreakdown(500, 2.5, RICHMOND_PRICING, 'all_in')).toThrow();
  });
});
