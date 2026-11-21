import type { Property, PropertyCode } from '../types/cohost.ts';

export interface PropertyThemeClasses {
  dotBg: string;
  text: string;
  softBg: string;
  softBorder: string;
  badgeBg: string;
  accentBar: string;
  cardBorder: string;
  ring: string;
  bubbleBg: string;
  bubbleBorder: string;
  bubbleText: string;
}

const PROPERTY_THEMES: Record<PropertyCode, PropertyThemeClasses> = {
  A: {
    dotBg: 'bg-property-a',
    text: 'text-property-a',
    softBg: 'bg-teal-50',
    softBorder: 'border-teal-200',
    badgeBg: 'bg-teal-100 text-property-a',
    accentBar: 'bg-property-a',
    cardBorder: 'border-property-a/60 hover:border-property-a',
    ring: 'ring-property-a/20',
    bubbleBg: 'bg-teal-50',
    bubbleBorder: 'border-teal-200',
    bubbleText: 'text-teal-950',
  },
  B: {
    dotBg: 'bg-property-b',
    text: 'text-property-b',
    softBg: 'bg-amber-50',
    softBorder: 'border-amber-200',
    badgeBg: 'bg-amber-100 text-property-b',
    accentBar: 'bg-property-b',
    cardBorder: 'border-property-b/60 hover:border-property-b',
    ring: 'ring-property-b/20',
    bubbleBg: 'bg-amber-50',
    bubbleBorder: 'border-amber-200',
    bubbleText: 'text-amber-950',
  },
  C: {
    dotBg: 'bg-property-c',
    text: 'text-property-c',
    softBg: 'bg-rose-50',
    softBorder: 'border-rose-200',
    badgeBg: 'bg-rose-100 text-property-c',
    accentBar: 'bg-property-c',
    cardBorder: 'border-property-c/60 hover:border-property-c',
    ring: 'ring-property-c/20',
    bubbleBg: 'bg-rose-50',
    bubbleBorder: 'border-rose-200',
    bubbleText: 'text-rose-950',
  },
};

const PROPERTY_ACCENT_SLOTS: readonly { code: PropertyCode; accentColor: string }[] = [
  { code: 'A', accentColor: '#095C57' },
  { code: 'B', accentColor: '#8C4A00' },
  { code: 'C', accentColor: '#7F2A44' },
];

export interface ParsedListingInput {
  listingIds: string[];
  hasShortShareLink: boolean;
}

export function getPropertyTheme(code: PropertyCode): PropertyThemeClasses {
  return PROPERTY_THEMES[code];
}

export function pickNextPropertySlot(
  existingProperties: readonly Property[],
): { code: PropertyCode; accentColor: string } {
  const usedCodes = new Set(existingProperties.map((p) => p.code));
  const unused = PROPERTY_ACCENT_SLOTS.find((slot) => !usedCodes.has(slot.code));
  if (unused) {
    return unused;
  }
  return PROPERTY_ACCENT_SLOTS[existingProperties.length % PROPERTY_ACCENT_SLOTS.length];
}

export function buildPropertySlugId(name: string, existingIds: readonly string[]): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const base = `prop-${slug || 'listing'}`;
  const taken = new Set(existingIds);
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/**
 * Extracts numeric Airbnb listing IDs from pasted URLs (/rooms/<ID>,
 * /hosting/listings/editor/<ID>, /manage-your-space/<ID>) or raw numeric IDs.
 * Flags /h/<slug> and abnb.me short share links that hide the numeric ID behind a redirect.
 */
export function parseAirbnbListingInput(raw: string): ParsedListingInput {
  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const listingIds: string[] = [];
  let hasShortShareLink = false;

  for (const token of tokens) {
    if (/abnb\.me|airbnb\.[^/]+\/h\//i.test(token)) {
      hasShortShareLink = true;
      continue;
    }

    const urlMatch = token.match(
      /(?:rooms(?:\/plus)?|hosting\/listings\/editor|manage-your-space)\/(\d{5,})/i,
    );
    if (urlMatch) {
      if (!listingIds.includes(urlMatch[1])) {
        listingIds.push(urlMatch[1]);
      }
      continue;
    }

    const rawDigits = token.replace(/^#/, '');
    if (/^\d{5,}$/.test(rawDigits) && !listingIds.includes(rawDigits)) {
      listingIds.push(rawDigits);
    }
  }

  return { listingIds, hasShortShareLink };
}

const TRAILING_STAY_DATES_RE =
  /,\s*(?:\d{1,2}(?:\s+[A-Za-z]{3,9})?\s*[–\-—]\s*\d{1,2}\s+[A-Za-z]{3,9}|[A-Za-z]{3,9}\s+\d{1,2}\s*[–\-—]\s*(?:[A-Za-z]{3,9}\s+)?\d{1,2})(?:,?\s*\d{4})?\s*$/;

export function cleanListingTitle(title: string): string {
  return title.trim().replace(TRAILING_STAY_DATES_RE, '').trim();
}

export function dedupeListingTitleAliases(aliases: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const alias of aliases) {
    const cleaned = cleanListingTitle(alias);
    if (cleaned.length < 4 || /(\.{3}|…)$/.test(cleaned)) {
      continue;
    }
    const lower = cleaned.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    deduped.push(cleaned);
  }
  return deduped;
}

export function mergeListingTitleAlias(
  existingAliases: readonly string[],
  incomingTitle: string | null | undefined,
): string[] {
  const baseAliases = dedupeListingTitleAliases(existingAliases);
  const cleaned = cleanListingTitle(incomingTitle ?? '');
  if (cleaned.length < 4 || /(\.{3}|…)$/.test(cleaned)) {
    return baseAliases;
  }
  const lower = cleaned.toLowerCase();
  if (baseAliases.some((alias) => alias.toLowerCase() === lower)) {
    return baseAliases;
  }
  return [...baseAliases, cleaned];
}

export function mergeListingId(
  existingIds: readonly string[],
  incomingId: string | null | undefined,
): string[] {
  const cleaned = incomingId?.trim() ?? '';
  if (!/^\d{5,}$/.test(cleaned) || existingIds.includes(cleaned)) {
    return [...existingIds];
  }
  return [...existingIds, cleaned];
}

export function normalizeWelcomeGuideUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function findPropertyById(
  properties: readonly Property[],
  propertyId: string,
): Property | undefined {
  return properties.find((property) => property.id === propertyId);
}

export function getPropertyDisplayLabel(property: Property): string {
  return property.name;
}

export function getOtherPropertiesUnreadCount(
  properties: readonly Property[],
  activePropertyId: string,
): number {
  return properties.reduce((total, property) => {
    if (property.id === activePropertyId) {
      return total;
    }
    return total + property.needsReplyCount + property.flaggedCount;
  }, 0);
}
