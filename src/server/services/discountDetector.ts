import {
  type DiscountAlert,
  type PayoutAssumption,
  type PropertyPricing,
} from '../../types/cohost.ts';
import { calculateBothPayoutModes } from './payoutMath.ts';

const DISCOUNT_INTENT_PATTERN =
  /\b(discount|lower(?:\s+the)?\s+(?:price|rate)|better\s+(?:price|rate|deal)|cheaper|budget|special\s+offer|best\s+(?:price|rate)|work\s+with\s+(?:us|me)\s+on\s+(?:the\s+)?(?:price|rate)|flexibility\s+on\s+(?:the\s+)?(?:price|rate)|can\s+you\s+do|you\s+(?:can|could)\s+do|would\s+you\s+(?:take|accept|do)|willing\s+to\s+(?:do|take|accept)|make\s+an?\s+offer|offer(?:ing)?\s+\$|%\s*off)\b/i;

const PER_NIGHT_OFFER_PATTERN =
  /\$\s*(\d{2,4}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:\/\s*(?:night|nt)|per\s+night|a\s+night|each\s+night)/i;

const TOTAL_OFFER_PATTERNS: RegExp[] = [
  /(?:can\s+you\s+do|you\s+(?:can|could)\s+do|would\s+you\s+(?:take|accept|do)|willing\s+to\s+(?:do|take|accept)|budget\s+(?:is|of|around|near)|around|closer\s+to|offer(?:ing)?|discount\s+to|down\s+to|for\s+around|pay)\s+\$\s*(\d{2,5}(?:,\d{3})*(?:\.\d{1,2})?)/i,
  /\$\s*(\d{2,5}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:all[\s-]?in|total|out\s+the\s+door|flat|altogether|for\s+(?:the\s+)?(?:\d+|all|both)\s+nights?|for\s+the\s+(?:weekend|stay|week))/i,
];

const NIGHTS_IN_TEXT_PATTERN = /\b(\d{1,2})\s+nights?\b/i;

const ROOM_ONLY_HINT_PATTERN =
  /\b(before\s+(?:taxes|fees|cleaning)|plus\s+(?:taxes|fees|cleaning)|excluding\s+(?:taxes|fees|cleaning)|nightly\s+rate|room\s+rate|base\s+rate)\b/i;

function parseDollarValue(raw: string): number {
  return Number.parseFloat(raw.replace(/,/g, ''));
}

export function hasDiscountIntent(bodyText: string): boolean {
  return DISCOUNT_INTENT_PATTERN.test(bodyText);
}

export function detectDiscountAlert(
  bodyText: string,
  parsedNights: number | null,
  pricing: PropertyPricing,
): DiscountAlert | null {
  if (!bodyText.trim()) {
    return null;
  }

  const nightsFromTextMatch = bodyText.match(NIGHTS_IN_TEXT_PATTERN);
  const nightsFromText = nightsFromTextMatch
    ? Number.parseInt(nightsFromTextMatch[1], 10)
    : null;
  const effectiveNights =
    parsedNights && parsedNights > 0
      ? parsedNights
      : nightsFromText && nightsFromText > 0
        ? nightsFromText
        : null;

  if (!effectiveNights) {
    return null;
  }

  const perNightMatch = bodyText.match(PER_NIGHT_OFFER_PATTERN);
  if (perNightMatch) {
    const perNightOffer = parseDollarValue(perNightMatch[1]);
    if (perNightOffer >= 35) {
      const offeredAmount = perNightOffer * effectiveNights;
      const { allIn, roomOnly } = calculateBothPayoutModes(
        offeredAmount,
        effectiveNights,
        pricing,
      );
      const defaultAssumption: PayoutAssumption = 'room_only';
      return {
        offeredAmount,
        nights: effectiveNights,
        defaultAssumption,
        allIn,
        roomOnly,
        triggersWarning: roomOnly.belowFloor || allIn.belowFloor,
        matchedSnippet: perNightMatch[0].trim(),
      };
    }
  }

  for (const pattern of TOTAL_OFFER_PATTERNS) {
    const match = bodyText.match(pattern);
    if (!match) {
      continue;
    }

    const offeredAmount = parseDollarValue(match[1]);
    if (offeredAmount < 75) {
      continue;
    }

    const { allIn, roomOnly } = calculateBothPayoutModes(
      offeredAmount,
      effectiveNights,
      pricing,
    );
    const defaultAssumption: PayoutAssumption = ROOM_ONLY_HINT_PATTERN.test(bodyText)
      ? 'room_only'
      : 'all_in';

    return {
      offeredAmount,
      nights: effectiveNights,
      defaultAssumption,
      allIn,
      roomOnly,
      triggersWarning: allIn.belowFloor || roomOnly.belowFloor,
      matchedSnippet: match[0].trim(),
    };
  }

  return null;
}
