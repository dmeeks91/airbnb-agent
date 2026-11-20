import type {
  CoachTurn,
  GuestThread,
  HouseRule,
  Property,
  ThreadMessage,
  VoiceProfile,
} from '../types/cohost.ts';
import { sanitizeDraftOutput } from './draftSanitizer.ts';
import { recalculateDiscountAlert } from './payoutHelpers.ts';
import { filterActiveRules } from './ruleFilters.ts';

const TOPIC_STOPWORDS = new Set([
  'and',
  'the',
  'for',
  'out',
  'off',
  'are',
  'our',
  'all',
  'any',
  'can',
  'has',
  'was',
  'not',
  'but',
  'use',
  'per',
  'new',
  'add',
  'how',
  'who',
  'why',
  'get',
  'set',
  'let',
  'too',
  'one',
  'two',
  'day',
  'via',
  'with',
  'from',
  'this',
  'that',
  'into',
  'over',
  'when',
  'what',
  'your',
  'info',
  'note',
  'notes',
  'rule',
  'rules',
  'policy',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/wi-fi/g, 'wifi')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

function ruleMatchesQuestion(topic: string, questionTokens: readonly string[]): boolean {
  const topicKeywords = tokenize(topic).filter((word) => !TOPIC_STOPWORDS.has(word));
  return topicKeywords.some((kw) =>
    questionTokens.some(
      (qWord) =>
        qWord === kw ||
        qWord === `${kw}s` ||
        kw === `${qWord}s` ||
        (kw.length >= 4 && qWord.startsWith(kw)) ||
        (qWord.length >= 4 && kw.startsWith(qWord)),
    ),
  );
}

function resolveSignOff(property: Property, voiceProfile: VoiceProfile): string {
  if (property.signOffOverride && property.signOffOverride.trim()) {
    return property.signOffOverride.trim();
  }
  if (voiceProfile.signOffMode === 'none') {
    return '';
  }
  return voiceProfile.signOffText.trim();
}

/**
 * Deterministic grounded fallback used in local mode or when the Express backend is unreachable
 * (for example, offline dev or isolated component tests). Enforces the same inquiry
 * Access & Arrival redaction and private nightly floor guardrails as the server.
 */
export function buildLocalFallbackCoachTurn(params: {
  property: Property;
  thread: GuestThread;
  messages: readonly ThreadMessage[];
  rules: readonly HouseRule[];
  voiceProfile: VoiceProfile;
  instruction?: string;
  referenceDate?: Date;
}): CoachTurn {
  const { property, thread, messages, rules, voiceProfile, instruction, referenceDate } = params;
  const activeRules = filterActiveRules(rules, referenceDate).filter((rule) =>
    thread.stage === 'inquiry' ? rule.category !== 'Access & Arrival' : true,
  );

  const unansweredGuestMessages = messages.filter((m) => m.sender === 'guest' && m.unanswered);
  const latestSource =
    unansweredGuestMessages.length > 0
      ? unansweredGuestMessages.map((m) => m.body).join(' ')
      : thread.lastPreview;

  const questionTokens = tokenize(`${latestSource} ${instruction ?? ''}`);
  const matchedSnippets: string[] = [];

  for (const rule of activeRules) {
    if (ruleMatchesQuestion(rule.topic, questionTokens)) {
      matchedSnippets.push(rule.value);
    }
  }

  const firstName = thread.guestName.split(/\s+/)[0] || 'there';
  const signOff = resolveSignOff(property, voiceProfile);
  const liveDiscountAlert = thread.discountAlert
    ? recalculateDiscountAlert(thread.discountAlert, property.pricing)
    : null;

  let bodyParagraph: string;
  let note: string;

  if (liveDiscountAlert && liveDiscountAlert.triggersWarning) {
    const cleanInstruction = instruction?.trim();
    if (cleanInstruction) {
      bodyParagraph = `Hi ${firstName}, thanks for reaching out about ${property.name}. We cannot accept the $${liveDiscountAlert.offeredAmount} offer, and based on your note (${cleanInstruction}), we can keep our standard rate while making arrival as smooth as possible for your group.`;
      note = 'Applied your coaching note while protecting your private nightly floor.';
    } else {
      bodyParagraph = `Hi ${firstName}, thanks for your interest in ${property.name}. We are not able to match $${liveDiscountAlert.offeredAmount} for those ${liveDiscountAlert.nights} nights, though we would be glad to host you at our listed rate and check on complimentary 1:00 PM early check-in if our turnover allows.`;
      note = 'Offer falls below your private net floor. Draft holds firm without revealing your floor.';
    }
  } else if (matchedSnippets.length > 0) {
    const combinedFacts = matchedSnippets.slice(0, 2).join(' ');
    bodyParagraph = instruction?.trim()
      ? `Hi ${firstName}, ${combinedFacts} Also, ${instruction.trim()}`
      : `Hi ${firstName}, ${combinedFacts} Let us know if anything else comes up before arrival.`;
    note =
      thread.stage === 'inquiry'
        ? `Grounded in ${matchedSnippets.length} active non-access rule(s). Access & Arrival details withheld until booking is confirmed.`
        : `Grounded in ${matchedSnippets.length} active House Details rule(s) for ${property.name}.`;
  } else {
    bodyParagraph = instruction?.trim()
      ? `Hi ${firstName}, thanks for the message. ${instruction.trim()} Let us know if you need anything else.`
      : `Hi ${firstName}, thanks for checking in about ${property.name}. We are happy to help with your stay and will follow up with any extra details you need.`;
    note = `Drafted using ${property.name} voice guardrails.`;
  }

  const fullDraft = sanitizeDraftOutput(
    signOff ? `${bodyParagraph}\n\n${signOff}` : bodyParagraph,
  );

  return {
    id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender: 'agent',
    text: instruction?.trim()
      ? 'Updated the draft based on your coaching note.'
      : `Here is a grounded reply for ${thread.guestName}.`,
    note,
    draft: fullDraft,
    originalDraft: fullDraft,
    editedByUser: false,
    createdAt: new Date().toISOString(),
  };
}
