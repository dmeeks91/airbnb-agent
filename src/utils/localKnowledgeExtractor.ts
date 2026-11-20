import type {
  ExtractedRuleCandidate,
  HouseRule,
  RuleCategory,
} from '../types/cohost.ts';

function normalizeTopicKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyRuleCategory(text: string): RuleCategory {
  const lower = text.toLowerCase();
  if (
    /\b(wi-?fi|wifi|password|ssid|router|keypad|lockbox|door code|entry|smart lock|address|gate code)\b/i.test(
      lower,
    )
  ) {
    return 'Access & Arrival';
  }
  if (
    /\b(check-?in|check-?out|bag drop|early arrival|late checkout|rate|floor|cleaning fee|quiet hours|curfew)\b/i.test(
      lower,
    )
  ) {
    return 'Timings & Rates';
  }
  return 'Amenities & Rules';
}

function inferTopicFromLine(line: string, index: number): { topic: string; value: string } {
  const colonIdx = line.indexOf(':');
  if (colonIdx > 2 && colonIdx < 48) {
    const rawTopic = line.slice(0, colonIdx).replace(/^[-*•\d.)\s]+/, '').trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    if (rawTopic && rawValue) {
      return { topic: rawTopic, value: rawValue };
    }
  }

  const lower = line.toLowerCase();
  if (/wi-?fi|ssid|router|password/.test(lower)) {
    return { topic: 'Wi-Fi Network & Router', value: line };
  }
  if (/keypad|lockbox|lock|door code|entry/.test(lower)) {
    return { topic: 'Entry & Keypad Access', value: line };
  }
  if (/check-?in|check-?out|bag drop/.test(lower)) {
    return { topic: 'Check-in & Check-out', value: line };
  }
  if (/park|driveway|garage|street/.test(lower)) {
    return { topic: 'Parking Allocation', value: line };
  }
  if (/trash|recycl|bin|garbage/.test(lower)) {
    return { topic: 'Trash & Recycling Pickup', value: line };
  }
  if (/pet|dog|cat/.test(lower)) {
    return { topic: 'Pet Policy', value: line };
  }
  if (/crib|pack n play|baby/.test(lower)) {
    return { topic: 'Travel Crib & Family Gear', value: line };
  }
  if (/grill|propane|patio|deck|pool|hot tub|fireplace/.test(lower)) {
    return { topic: 'Outdoor & Home Amenities', value: line };
  }

  return { topic: `House Note ${index + 1}`, value: line };
}

export function findConflictingRule(
  topic: string,
  value: string,
  existingRules: readonly HouseRule[],
): HouseRule | null {
  const candidateTokens = new Set(
    normalizeTopicKey(`${topic} ${value}`)
      .split(' ')
      .filter((t) => t.length >= 4),
  );
  const normTopic = normalizeTopicKey(topic);

  for (const existing of existingRules) {
    const existingNormTopic = normalizeTopicKey(existing.topic);
    if (
      normTopic.length > 0 &&
      existingNormTopic.length > 0 &&
      (existingNormTopic === normTopic ||
        existingNormTopic.includes(normTopic) ||
        normTopic.includes(existingNormTopic))
    ) {
      return existing;
    }

    const existingTopicTokens = existingNormTopic
      .split(' ')
      .filter((t) => t.length >= 4);
    const overlap = existingTopicTokens.filter((token) => candidateTokens.has(token));
    if (overlap.length >= 2) {
      return existing;
    }
  }

  return null;
}

export function extractRulesLocally(
  rawText: string,
  sourceLabel: string,
  existingRules: readonly HouseRule[],
): ExtractedRuleCandidate[] {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[-*•\s]+/, '').trim())
    .filter((line) => line.length >= 6);

  const chunks =
    lines.length > 0
      ? lines
      : rawText
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 6);

  return chunks.slice(0, 12).map((chunk, idx) => {
    const { topic, value } = inferTopicFromLine(chunk, idx);
    const category = classifyRuleCategory(`${topic} ${value}`);
    const conflict = findConflictingRule(topic, value, existingRules);

    return {
      id: `cand-${Date.now()}-${idx}`,
      topic,
      value,
      category,
      sourceLabel,
      conflictRuleId: conflict?.id ?? null,
      existingValue: conflict?.value ?? null,
    };
  });
}
