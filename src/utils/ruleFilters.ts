import type { HouseRule, RuleCategory } from '../types/cohost.ts';

export const RULE_CATEGORIES: readonly RuleCategory[] = [
  'Access & Arrival',
  'Timings & Rates',
  'Amenities & Rules',
];

/**
 * Determines whether a temporary/seasonal house rule has expired as of `referenceDate`.
 * Date-only values (`YYYY-MM-DD`) stay valid through the end of that calendar day (UTC).
 */
export function isRuleExpired(rule: HouseRule, referenceDate: Date = new Date()): boolean {
  if (!rule.isTemporary || !rule.expiresAt) {
    return false;
  }

  const dateOnlyMatch = rule.expiresAt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number.parseInt(dateOnlyMatch[1], 10);
    const month = Number.parseInt(dateOnlyMatch[2], 10) - 1;
    const day = Number.parseInt(dateOnlyMatch[3], 10);
    const endOfExpiryDayUtc = Date.UTC(year, month, day, 23, 59, 59, 999);
    return referenceDate.getTime() > endOfExpiryDayUtc;
  }

  const parsedMs = Date.parse(rule.expiresAt);
  if (Number.isNaN(parsedMs)) {
    return false;
  }
  return referenceDate.getTime() > parsedMs;
}

export function filterActiveRules(
  rules: readonly HouseRule[],
  referenceDate: Date = new Date(),
): HouseRule[] {
  return rules.filter((rule) => !isRuleExpired(rule, referenceDate));
}

export function groupRulesByCategory(
  rules: readonly HouseRule[],
): Array<{ category: RuleCategory; rules: HouseRule[] }> {
  return RULE_CATEGORIES.map((category) => ({
    category,
    rules: rules.filter((rule) => rule.category === category),
  }));
}
