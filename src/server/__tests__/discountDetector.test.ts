import { describe, expect, it } from 'vitest';
import {
  detectDiscountAlert,
  hasDiscountIntent,
} from '../services/discountDetector.ts';
import { type PropertyPricing } from '../../types/haven.ts';

const RICHMOND_PRICING: PropertyPricing = {
  nightlyFloor: 150,
  cleaningFee: 120,
  localTaxPct: 14,
  hostServiceFeePct: 15.5,
};

describe('discountDetector', () => {
  it('flags flat total offers and defaults to all-in mode', () => {
    const alert = detectDiscountAlert(
      'Is there any chance you can do $600 total for the 3 nights?',
      3,
      RICHMOND_PRICING,
    );

    expect(alert).not.toBeNull();
    expect(alert?.offeredAmount).toBe(600);
    expect(alert?.nights).toBe(3);
    expect(alert?.defaultAssumption).toBe('all_in');
    expect(alert?.allIn.belowFloor).toBe(true);
    expect(alert?.roomOnly.belowFloor).toBe(false);
    expect(alert?.triggersWarning).toBe(true);
  });

  it('extracts nights from message body when header dates are absent', () => {
    const alert = detectDiscountAlert(
      'Our budget is $450 for 2 nights, can you work with us?',
      null,
      RICHMOND_PRICING,
    );

    expect(alert).not.toBeNull();
    expect(alert?.nights).toBe(2);
    expect(alert?.allIn.belowFloor).toBe(true);
  });

  it('defaults per-night quotes to room-only mode', () => {
    const alert = detectDiscountAlert(
      'Would you accept $140/night for our 4-night stay?',
      4,
      RICHMOND_PRICING,
    );

    expect(alert).not.toBeNull();
    expect(alert?.offeredAmount).toBe(560);
    expect(alert?.defaultAssumption).toBe('room_only');
    expect(alert?.roomOnly.belowFloor).toBe(true);
  });

  it('switches flat total default to room-only when guest explicitly says before taxes and fees', () => {
    const alert = detectDiscountAlert(
      'Can you do $600 before taxes and fees for the 3 nights?',
      3,
      RICHMOND_PRICING,
    );

    expect(alert).not.toBeNull();
    expect(alert?.defaultAssumption).toBe('room_only');
  });

  it('ignores non-negotiation small fee mentions', () => {
    const alert = detectDiscountAlert(
      'Happy to pay the $25 pet fee for our small dog!',
      3,
      RICHMOND_PRICING,
    );

    expect(alert).toBeNull();
  });

  it('detects non-numeric discount intent separately without false positives on non-price offers', () => {
    expect(hasDiscountIntent('Any chance of a small discount for returning guests?')).toBe(true);
    expect(hasDiscountIntent('Is there any chance you can do $600 for the weekend?')).toBe(true);
    expect(hasDiscountIntent('We were curious if you offer a late checkout option on Sunday?')).toBe(
      false,
    );
    expect(hasDiscountIntent('What time is check-in tomorrow?')).toBe(false);
  });
});
