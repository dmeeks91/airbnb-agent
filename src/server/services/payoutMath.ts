import {
  type PayoutAssumption,
  type PayoutBreakdown,
  type PropertyPricing,
} from '../../types/haven.ts';

export const DEFAULT_HOST_SERVICE_FEE_PCT = 15.5;

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates host net payout under Airbnb's host-only fee model (default 15.5%).
 *
 * Host-only fee applies to (accommodation + cleaning fee). Local occupancy tax
 * collected and remitted by Airbnb sits outside the host fee base.
 *
 * - `all_in`: guestQuote is the guest's total out-of-pocket amount including tax & cleaning.
 * - `room_only`: guestQuote is the pre-tax, pre-cleaning accommodation amount for the stay.
 */
export function calculatePayoutBreakdown(
  guestQuote: number,
  nights: number,
  pricing: PropertyPricing,
  assumption: PayoutAssumption,
): PayoutBreakdown {
  if (!Number.isFinite(guestQuote) || guestQuote <= 0) {
    throw new Error('guestQuote must be a positive number');
  }
  if (!Number.isInteger(nights) || nights <= 0) {
    throw new Error('nights must be a positive integer');
  }
  if (pricing.localTaxPct < 0 || pricing.hostServiceFeePct < 0 || pricing.hostServiceFeePct >= 100) {
    throw new Error('pricing percentages are out of valid bounds');
  }

  const taxRate = pricing.localTaxPct / 100;
  const feeRate = pricing.hostServiceFeePct / 100;
  const cleaningFee = Math.max(0, pricing.cleaningFee);

  let preTaxSubtotal: number;
  let estimatedTax: number;
  let estimatedAccommodation: number;

  if (assumption === 'all_in') {
    preTaxSubtotal = guestQuote / (1 + taxRate);
    estimatedTax = guestQuote - preTaxSubtotal;
    estimatedAccommodation = Math.max(0, preTaxSubtotal - cleaningFee);
  } else {
    estimatedAccommodation = guestQuote;
    preTaxSubtotal = estimatedAccommodation + cleaningFee;
    estimatedTax = preTaxSubtotal * taxRate;
  }

  const hostServiceFee = preTaxSubtotal * feeRate;
  const totalHostPayout = preTaxSubtotal - hostServiceFee;
  const netAfterCleaning = totalHostPayout - cleaningFee;
  const estimatedNetPerNight = netAfterCleaning / nights;

  const roundedNetPerNight = roundCents(estimatedNetPerNight);
  const roundedFloor = roundCents(pricing.nightlyFloor);
  const deltaPerNight = roundCents(roundedNetPerNight - roundedFloor);

  return {
    assumption,
    guestQuote: roundCents(guestQuote),
    nights,
    preTaxSubtotal: roundCents(preTaxSubtotal),
    estimatedAccommodation: roundCents(estimatedAccommodation),
    cleaningFee: roundCents(cleaningFee),
    estimatedTax: roundCents(estimatedTax),
    hostServiceFee: roundCents(hostServiceFee),
    totalHostPayout: roundCents(totalHostPayout),
    netAfterCleaning: roundCents(netAfterCleaning),
    estimatedNetPerNight: roundedNetPerNight,
    floorPerNight: roundedFloor,
    belowFloor: roundedNetPerNight < roundedFloor,
    deltaPerNight,
  };
}

export function calculateBothPayoutModes(
  guestQuote: number,
  nights: number,
  pricing: PropertyPricing,
): { allIn: PayoutBreakdown; roomOnly: PayoutBreakdown } {
  return {
    allIn: calculatePayoutBreakdown(guestQuote, nights, pricing, 'all_in'),
    roomOnly: calculatePayoutBreakdown(guestQuote, nights, pricing, 'room_only'),
  };
}
