import {
  type ExistingThreadRef,
  type ParsedAirbnbEmail,
  type PropertyMatchCandidate,
  type PropertyMatchResult,
} from '../../types/cohost.ts';

const MIN_TRUNCATED_PREFIX_LEN = 12;

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasMatchesHint(alias: string, hint: string): boolean {
  const normAlias = normalizeTitle(alias);
  if (!normAlias) {
    return false;
  }

  const trimmedHint = hint.trim();
  const isTruncated = /(\.{3}|…)$/.test(trimmedHint);
  const normHint = normalizeTitle(trimmedHint.replace(/(\.{3}|…)$/, ''));

  if (!normHint) {
    return false;
  }

  if (normAlias === normHint) {
    return true;
  }

  if (isTruncated && normHint.length >= MIN_TRUNCATED_PREFIX_LEN) {
    return normAlias.startsWith(normHint);
  }

  // Exact containment only when the matched phrase is substantial
  if (normAlias.length >= MIN_TRUNCATED_PREFIX_LEN && normHint.includes(normAlias)) {
    return true;
  }
  if (normHint.length >= MIN_TRUNCATED_PREFIX_LEN && normAlias.includes(normHint)) {
    return true;
  }

  return false;
}

/**
 * Matches a parsed Airbnb email to a configured property in strict priority order:
 * 1. Existing Airbnb thread ID
 * 2. Airbnb numeric listing ID
 * 3. Unambiguous listing title / alias match
 *
 * Never guesses when ambiguous or absent; returns matched: false so the caller
 * routes the message to the unmatched fallback queue without auto-drafting.
 */
export function matchProperty(
  parsed: ParsedAirbnbEmail,
  properties: PropertyMatchCandidate[],
  existingThreads: ExistingThreadRef[],
): PropertyMatchResult {
  if (parsed.airbnbThreadId) {
    const threadMatches = existingThreads.filter(
      (t) => t.airbnbThreadId === parsed.airbnbThreadId,
    );
    if (threadMatches.length === 1) {
      return {
        matched: true,
        propertyId: threadMatches[0].propertyId,
        matchedBy: 'thread_id',
        existingThreadId: threadMatches[0].threadId,
      };
    }
    if (threadMatches.length > 1) {
      return {
        matched: false,
        reason: `Ambiguous thread ID ${parsed.airbnbThreadId} matched multiple properties`,
      };
    }
  }

  if (parsed.airbnbListingId) {
    const listingMatches = properties.filter((p) =>
      p.airbnbListingIds.includes(parsed.airbnbListingId!),
    );
    if (listingMatches.length === 1) {
      return {
        matched: true,
        propertyId: listingMatches[0].id,
        matchedBy: 'listing_id',
      };
    }
    if (listingMatches.length > 1) {
      return {
        matched: false,
        reason: `Ambiguous listing ID ${parsed.airbnbListingId} configured on multiple properties`,
      };
    }
  }

  const candidateTexts: string[] = [];
  if (parsed.listingTitleHint) {
    candidateTexts.push(parsed.listingTitleHint);
  }
  if (parsed.subject) {
    candidateTexts.push(parsed.subject);
  }

  for (const text of candidateTexts) {
    const aliasMatches = properties.filter((property) => {
      const names = [property.name, ...property.titleAliases];
      return names.some((alias) => aliasMatchesHint(alias, text));
    });

    if (aliasMatches.length === 1) {
      return {
        matched: true,
        propertyId: aliasMatches[0].id,
        matchedBy: 'title_alias',
      };
    }
    if (aliasMatches.length > 1) {
      return {
        matched: false,
        reason: `Title hint "${text}" ambiguously matched multiple properties`,
      };
    }
  }

  return {
    matched: false,
    reason: 'No matching thread ID, listing ID, or property title alias found',
  };
}
