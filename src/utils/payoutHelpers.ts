import { calculateBothPayoutModes } from '../server/services/payoutMath.ts';
import type { DiscountAlert, PropertyPricing } from '../types/cohost.ts';

/**
 * Recomputes a thread's discount alert payout math against the property's current
 * pricing guardrails so edits to floor, cleaning fee, local tax, or host fee
 * are reflected immediately everywhere without stale snapshots.
 */
export function recalculateDiscountAlert(
  alert: DiscountAlert,
  pricing: PropertyPricing,
): DiscountAlert {
  if (
    !Number.isFinite(alert.offeredAmount) ||
    alert.offeredAmount <= 0 ||
    !Number.isInteger(alert.nights) ||
    alert.nights <= 0 ||
    pricing.localTaxPct < 0 ||
    pricing.hostServiceFeePct < 0 ||
    pricing.hostServiceFeePct >= 100
  ) {
    return {
      ...alert,
      allIn: { ...alert.allIn },
      roomOnly: { ...alert.roomOnly },
    };
  }

  const { allIn, roomOnly } = calculateBothPayoutModes(
    alert.offeredAmount,
    alert.nights,
    pricing,
  );

  return {
    ...alert,
    allIn,
    roomOnly,
    triggersWarning: allIn.belowFloor || roomOnly.belowFloor,
  };
}
