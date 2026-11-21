import PostalMime from 'postal-mime';
import {
  type EmailClassification,
  type GuestStage,
  type ParsedAirbnbEmail,
  type ParsedEmailMessage,
} from '../../types/cohost.ts';

const AIRBNB_HOST_PATTERN =
  /^(?:[a-z0-9-]+\.)*airbnb\.(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2,3})$/i;

const AIRBNB_DOMAIN_IN_URL = 'airbnb\\.(?:com|co\\.[a-z]{2}|com\\.[a-z]{2}|[a-z]{2,3})';

const NOISE_SENDER_PATTERN = new RegExp(
  `^(?:discover|news|marketing|noreply-marketing|community)@(?:[a-z0-9-]+\\.)*${AIRBNB_DOMAIN_IN_URL}$`,
  'i',
);

const NOISE_TEMPLATE_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'inquiry_reminder', pattern: /(?:in|en)quiries\/reminder|(?:IN|EN)QUIRIES_REMINDER/i },
  { reason: 'reservation_reminder', pattern: /ReservationHostReminder|HostReminder|reminder/i },
  { reason: 'payout_notice', pattern: /payout/i },
  { reason: 'review_reminder', pattern: /review/i },
  { reason: 'marketing_or_digest', pattern: /marketing|newsletter|promo|tips/i },
];

const NOISE_SUBJECT_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'payout_notice', pattern: /\b(payout|we sent you \$|your payout|payout on its way)\b/i },
  {
    reason: 'review_reminder',
    pattern: /\b(leave a review|write a review|left you a review|review reminder|rate your guest|how was .+['’]s stay)\b/i,
  },
  {
    reason: 'security_or_account',
    pattern: /\b(security alert|new login|verification code|confirm your email|password reset|2-step verification)\b/i,
  },
  {
    reason: 'tax_or_policy',
    pattern: /\b(1099|tax document|tax form|terms of service|privacy policy|superhost status|hosting tips|pricing tips)\b/i,
  },
  {
    reason: 'reservation_reminder',
    pattern: /\b(reservation reminder|calendar reminder|check-in reminder|upcoming check-in|is coming soon|get ready for .+['’]s arrival|reminder: review)\b/i,
  },
  {
    reason: 'cohost_admin_notice',
    pattern: /\b(co-?host invitation|invite to co-?host|invited you to co-?host|accepted your invite to co-?host|removed you as a co-?host|co-?host permissions)\b/i,
  },
];

const GUEST_MESSAGE_SUBJECT_PATTERNS: RegExp[] = [
  /\b(new message|message from|re:\s*(?:(?:in|en)quiry|pre-?approval|special\s+offer|reservation|booking|message|stay|request))\b/i,
  /\b((?:in|en)quiry (?:for|from|about)|pre-?approval (?:for|at)|reservation request|booking request|request to book|sent you a message)\b/i,
];

function isAirbnbEmailAddress(address: string): boolean {
  const trimmed = address.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex === -1) {
    return false;
  }
  const domain = trimmed.slice(atIndex + 1);
  return AIRBNB_HOST_PATTERN.test(domain);
}

function parseAirbnbUrlObject(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!AIRBNB_HOST_PATTERN.test(parsed.hostname)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const GENERIC_BOILERPLATE_STOP_PATTERNS: RegExp[] = [
  /^\s*respond to .+ by replying directly to this email/i,
  /^\s*reply directly to this email/i,
  /^\s*you can also respond by replying directly to this email/i,
  /^\s*reply on airbnb/i,
  /^\s*respond on airbnb/i,
  /^\s*view message\b/i,
  /^\s*pre-approve\s*\/\s*decline/i,
  /^\s*download the airbnb app/i,
  /^\s*get the app\.?$/i,
  /^\s*sent with airbnb/i,
  /^\s*airbnb,?\s*inc\.?/i,
  /^\s*888 brannan/i,
  /^\s*you received this email because/i,
  /^\s*email preferences/i,
  /^\s*manage your notification settings/i,
  /^\s*-{3,}\s*original message\s*-{3,}/i,
  /^\s*on\s+.+\s+wrote:\s*$/i,
  /^\s*_{5,}\s*$/,
];

const DIGEST_ROLE_MAP: Record<string, 'guest' | 'host'> = {
  booker: 'guest',
  guest: 'guest',
  traveler: 'guest',
  host: 'host',
  'co-host': 'host',
  cohost: 'host',
  'primary host': 'host',
};

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function normalizeInvisibleUnicode(input: string): string {
  return input
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\u00a0\u2009\u200a\u202f]/g, ' ')
    .replace(/\u2011/g, '-');
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '-')
    .replace(/&mdash;|&#8212;/gi, '-')
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      String.fromCharCode(Number.parseInt(dec, 10)),
    );
}

function htmlToPlainText(html: string): string {
  const withoutBlocks = html
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<head[\s\S]*?<\/head>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '');

  const withBreaks = withoutBlocks
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(?:p|div|tr|li|h[1-6]|table|section)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return normalizeInvisibleUnicode(decodeHtmlEntities(withBreaks))
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toTitleCaseName(raw: string): string {
  const cleaned = normalizeInvisibleUnicode(raw).trim();
  if (!cleaned) {
    return cleaned;
  }
  if (cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned)) {
    return cleaned
      .toLowerCase()
      .replace(/(^|[\s'-])([a-z])/g, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
  }
  return cleaned;
}

function unwrapSoftWrappedParagraphs(lines: string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (current.length > 0) {
        paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim());
        current = [];
      }
      continue;
    }
    current.push(trimmed);
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim());
  }

  return paragraphs.join('\n\n').trim();
}

function extractAllAirbnbUrls(text: string, html: string): string[] {
  const urls = new Set<string>();
  const urlRegex = /https?:\/\/[^\s"'<>)\]]+/gi;

  for (const source of [html, text]) {
    if (!source) {
      continue;
    }
    const matches = source.match(urlRegex) ?? [];
    for (const rawUrl of matches) {
      const cleaned = decodeHtmlEntities(rawUrl).replace(/[.,;!?]+$/, '');
      if (parseAirbnbUrlObject(cleaned)) {
        urls.add(cleaned);
      }
    }
  }

  return Array.from(urls);
}

/**
 * Decodes Airbnb's internal template identifier from either the `c=.pi80.pk<base64>`
 * tracking parameter or the `email-unsubscribe` token JSON.
 */
function extractAirbnbTemplate(urls: string[]): string | null {
  for (const url of urls) {
    const unsubMatch = url.match(/[?&]token=([A-Za-z0-9_-]+)/);
    if (unsubMatch) {
      try {
        const decoded = Buffer.from(unsubMatch[1], 'base64url').toString('utf8');
        const parsed = JSON.parse(decoded) as { template?: unknown };
        if (typeof parsed.template === 'string' && parsed.template.trim()) {
          return parsed.template.trim();
        }
      } catch {
        // ignore invalid token payload
      }
    }
  }

  for (const url of urls) {
    const pkMatch = url.match(/[?&]c=\.pi\d+\.pk([A-Za-z0-9%_=-]+)/);
    if (pkMatch) {
      try {
        const b64 = decodeURIComponent(pkMatch[1]);
        const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();
        if (decoded && /^[\x20-\x7E]+$/.test(decoded)) {
          return decoded;
        }
      } catch {
        // ignore invalid base64
      }
    }
  }

  return null;
}

function extractThreadAndListingMeta(urls: string[]): {
  airbnbThreadId: string | null;
  reservationCode: string | null;
  airbnbThreadUrl: string | null;
  airbnbListingId: string | null;
} {
  let airbnbThreadId: string | null = null;
  let reservationCode: string | null = null;
  let airbnbThreadUrl: string | null = null;
  let airbnbListingId: string | null = null;

  const threadPathPatterns: RegExp[] = [
    /^\/hosting\/thread\/([a-zA-Z0-9_-]+)/i,
    /^\/messaging\/thread\/([a-zA-Z0-9_-]+)/i,
    /^\/hosting\/messages\/([a-zA-Z0-9_-]+)/i,
    /^\/messaging\/qt_for_reservation\/([a-zA-Z0-9_-]+)/i,
    /^\/z\/q\/([a-zA-Z0-9_-]+)/i,
  ];

  const reservationPathPattern = /^\/hosting\/reservations\/details\/([A-Z0-9]{6,16})/i;

  const listingPathPatterns: RegExp[] = [
    /^\/rooms\/(?:plus\/)?(\d+)/i,
    /^\/hosting\/listings\/(?:editor\/)?(\d+)/i,
    /^\/manage-your-space\/(\d+)/i,
  ];

  for (const rawUrl of urls) {
    const parsedUrl = parseAirbnbUrlObject(rawUrl);
    if (!parsedUrl) {
      continue;
    }

    if (!airbnbThreadId) {
      for (const pattern of threadPathPatterns) {
        const match = parsedUrl.pathname.match(pattern);
        if (match) {
          airbnbThreadId = match[1];
          airbnbThreadUrl = /^\/z\/q\//i.test(parsedUrl.pathname)
            ? `https://www.airbnb.com/z/q/${match[1]}`
            : `https://www.airbnb.com/hosting/thread/${match[1]}`;
          break;
        }
      }
      if (!airbnbThreadId) {
        const queryThreadId =
          parsedUrl.searchParams.get('thread_id') ??
          parsedUrl.searchParams.get('message_thread_id');
        if (queryThreadId && /^[a-zA-Z0-9_-]+$/.test(queryThreadId)) {
          airbnbThreadId = queryThreadId;
          airbnbThreadUrl = `https://www.airbnb.com/hosting/thread/${queryThreadId}`;
        }
      }
    }

    if (!reservationCode) {
      const resMatch = parsedUrl.pathname.match(reservationPathPattern);
      if (resMatch) {
        reservationCode = resMatch[1].toUpperCase();
      }
    }

    if (!airbnbListingId) {
      for (const pattern of listingPathPatterns) {
        const match = parsedUrl.pathname.match(pattern);
        if (match) {
          airbnbListingId = match[1];
          break;
        }
      }
      if (!airbnbListingId) {
        const queryListingId = parsedUrl.searchParams.get('listing_id');
        if (queryListingId && /^\d+$/.test(queryListingId)) {
          airbnbListingId = queryListingId;
        }
      }
    }
  }

  if (!airbnbThreadUrl && reservationCode) {
    airbnbThreadUrl = `https://www.airbnb.com/hosting/reservations/details/${reservationCode}`;
  }

  if (!airbnbThreadUrl) {
    const fallback = urls.find((rawUrl) => {
      const parsedUrl = parseAirbnbUrlObject(rawUrl);
      return Boolean(
        parsedUrl &&
          /^\/(?:hosting\/(?:thread|messages|inbox|reservations)|messaging|z\/q|e\/)/i.test(
            parsedUrl.pathname,
          ),
      );
    });
    if (fallback) {
      airbnbThreadUrl = fallback;
    }
  }

  return { airbnbThreadId, reservationCode, airbnbThreadUrl, airbnbListingId };
}

/**
 * Parses Airbnb `MESSAGING_NEW_MESSAGE_EMAIL_DIGEST` blocks:
 *   NAME
 *   Booker | Host
 *   Message paragraphs...
 * Stops at `Reply` / `Review enquiry` / `Review inquiry` CTA links.
 */
function extractDigestMessages(rawBody: string): ParsedEmailMessage[] | null {
  const protectionIdx = rawBody.search(
    /For your protection and safety, always communicate through Airbnb/i,
  );
  const replyMarkerRegex = new RegExp(
    `(?:^|\\n)\\s*(?:Reply|Review\\s+(?:in|en)quiry|Respond|Pre-approve\\s*\\/\\s*Decline|View\\s+message)\\s+\\[https?:\\/\\/[^\\]]*${AIRBNB_DOMAIN_IN_URL}\\/(?:hosting\\/thread|messaging\\/|hosting\\/messages|hosting\\/reservations|z\\/q)`,
    'i',
  );
  const replyMatch = replyMarkerRegex.exec(rawBody);

  if (protectionIdx === -1 && !replyMatch) {
    return null;
  }

  let startIdx = 0;
  if (protectionIdx !== -1) {
    // Advance past the safety link line `[https://...].`
    const afterSafety = rawBody.slice(protectionIdx);
    const linkEndMatch = afterSafety.match(/\[https?:\/\/[^\]]+\]\.?\s*\n/);
    startIdx =
      linkEndMatch && linkEndMatch.index !== undefined
        ? protectionIdx + linkEndMatch.index + linkEndMatch[0].length
        : protectionIdx;
  }

  const endIdx = replyMatch ? replyMatch.index : rawBody.length;
  if (endIdx <= startIdx) {
    return null;
  }

  const zone = rawBody.slice(startIdx, endIdx);
  const lines = zone.replace(/\r\n/g, '\n').split('\n');
  const inlineCtaStopPattern = new RegExp(
    `^(?:Reply|Review\\s+(?:in|en)quiry|Respond|Pre-approve\\s*\\/\\s*Decline|View\\s+message)\\s*\\[https?:\\/\\/[^\\]]*${AIRBNB_DOMAIN_IN_URL}\\/`,
    'i',
  );

  const messages: ParsedEmailMessage[] = [];
  let currentName: string | null = null;
  let currentRole: 'guest' | 'host' | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentName && currentRole) {
      const body = unwrapSoftWrappedParagraphs(currentLines);
      if (body) {
        messages.push({
          senderName: toTitleCaseName(currentName),
          role: currentRole,
          body,
        });
      }
    }
    currentName = null;
    currentRole = null;
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (currentRole) {
        currentLines.push('');
      }
      continue;
    }

    if (
      inlineCtaStopPattern.test(trimmed) ||
      /^You can also respond by replying directly to this email/i.test(trimmed) ||
      /^Update your email preferences/i.test(trimmed)
    ) {
      break;
    }

    // Look ahead for the next non-empty line to see if it is a role label ("Booker", "Host", etc.)
    let nextNonEmptyIdx = i + 1;
    while (nextNonEmptyIdx < lines.length && !lines[nextNonEmptyIdx].trim()) {
      nextNonEmptyIdx++;
    }

    if (nextNonEmptyIdx < lines.length) {
      const nextTrimmed = lines[nextNonEmptyIdx].trim().toLowerCase();
      const detectedRole = DIGEST_ROLE_MAP[nextTrimmed];
      const looksLikeName =
        trimmed.length <= 50 &&
        !/^https?:\/\//i.test(trimmed) &&
        !/\[https?:\/\//i.test(trimmed) &&
        !/[!?]$/.test(trimmed) &&
        (!trimmed.endsWith('.') || trimmed.split(/\s+/).length <= 3);

      if (detectedRole && looksLikeName) {
        flush();
        currentName = trimmed;
        currentRole = detectedRole;
        i = nextNonEmptyIdx; // skip the role line
        continue;
      }
    }

    if (currentRole) {
      currentLines.push(trimmed);
    }
  }

  flush();
  return messages.length > 0 ? messages : null;
}

/**
 * Parses Airbnb `host_initial_inquiry` and `reservation_host_pending` emails where
 * the guest profile block appears before the message and `Pre-approve / Decline`
 * or the listing URL `https://www.airbnb.<tld>/rooms/...` terminates the message.
 */
function extractInquiryOrRequestMessage(
  rawBody: string,
  template: string | null,
): { guestName: string | null; messages: ParsedEmailMessage[] } | null {
  const headerMatch = rawBody.match(/RESPOND\s+TO\s+(.+?)[’']S\s+(INQUIRY|ENQUIRY|REQUEST)/i);
  const isInquiryOrRequestTemplate = Boolean(
    template && /(?:host_initial_(?:in|en)quiry|reservation_host_pending)/i.test(template),
  );

  if (!headerMatch && !isInquiryOrRequestTemplate) {
    return null;
  }

  // Inquiry reminder has no guest message body
  if (
    /Maintain your response rate and help .+ finalize their trip/i.test(rawBody) &&
    !/Identity verified|On Airbnb since|\b\d+\s+reviews?\b/i.test(
      rawBody.split(/Pre-approve\s*\/\s*Decline/i)[0] ?? '',
    )
  ) {
    return {
      guestName: headerMatch ? toTitleCaseName(headerMatch[1]) : null,
      messages: [],
    };
  }

  const guestNameFromHeader = headerMatch ? toTitleCaseName(headerMatch[1]) : null;
  const lines = rawBody.replace(/\r\n/g, '\n').split('\n');

  let profileStartLine = -1;
  let guestName = guestNameFromHeader;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const bracketUrlMatch = trimmed.match(/^\[(https?:\/\/[^\]]+)\]$/i);
    const bracketUrl = bracketUrlMatch ? parseAirbnbUrlObject(bracketUrlMatch[1]) : null;
    if (
      bracketUrl &&
      /^\/hosting\/(?:thread|reservations\/details)\//i.test(bracketUrl.pathname)
    ) {
      let prev = i - 1;
      while (prev >= 0 && !lines[prev].trim()) {
        prev--;
      }
      if (prev >= 0) {
        const prevText = lines[prev].trim();
        if (
          /^(?:Accept\s*\/\s*Decline|Pre-approve\s*\/\s*Decline|Reply|Review\s+(?:in|en)quiry)/i.test(
            prevText,
          )
        ) {
          continue;
        }
        if (prevText.length <= 50 && !/^https?:\/\//i.test(prevText)) {
          guestName = toTitleCaseName(prevText);
          profileStartLine = i + 1;
          break;
        }
      }
    }
  }

  if (profileStartLine === -1) {
    return { guestName, messages: [] };
  }

  const bodyLines: string[] = [];
  let passedProfileMeta = false;

  for (let i = profileStartLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineUrl = parseAirbnbUrlObject(trimmed);

    if (
      /^Pre-approve\s*\/\s*Decline/i.test(trimmed) ||
      /^Review\s+(?:in|en)quiry/i.test(trimmed) ||
      (lineUrl !== null && /^\/rooms\//i.test(lineUrl.pathname)) ||
      /^YOU HAVE 24 HOURS TO RESPOND/i.test(trimmed) ||
      /^FREQUENTLY ASKED QUESTIONS/i.test(trimmed)
    ) {
      break;
    }

    if (!trimmed) {
      if (passedProfileMeta) {
        bodyLines.push('');
      }
      continue;
    }

    if (!passedProfileMeta) {
      const isProfileMetaLine =
        /^Identity verified\b/i.test(trimmed) ||
        /^\d+\s+reviews?$/i.test(trimmed) ||
        /^On Airbnb since\s+\d{4}/i.test(trimmed) ||
        /^Lives in\s+/i.test(trimmed) ||
        /^[A-Z][a-zA-Z\s.'-]+,\s*[A-Z]{2}$/.test(trimmed) ||
        /^[A-Z][a-zA-Z\s.'-]+,\s*[A-Z][a-zA-Z\s.'-]+$/.test(trimmed);

      if (isProfileMetaLine && trimmed.length <= 60) {
        continue;
      }
      passedProfileMeta = true;
    }

    bodyLines.push(trimmed);
  }

  const body = unwrapSoftWrappedParagraphs(bodyLines);
  const messages: ParsedEmailMessage[] =
    body && guestName ? [{ senderName: guestName, role: 'guest', body }] : [];

  return { guestName, messages };
}

function extractGuestNameFallback(
  fromName: string | null,
  subject: string,
  rawBody: string,
): string | null {
  if (fromName) {
    const parenMatch = fromName.match(/^(.+?)\s*\(Airbnb\)$/i);
    if (parenMatch) {
      return toTitleCaseName(parenMatch[1]);
    }
    const viaMatch = fromName.match(/^(.+?)\s+(?:via|on)\s+airbnb$/i);
    if (viaMatch) {
      return toTitleCaseName(viaMatch[1]);
    }
    const cleanFrom = fromName.trim();
    if (cleanFrom && !/airbnb/i.test(cleanFrom)) {
      return toTitleCaseName(cleanFrom);
    }
  }

  const respondMatch = rawBody.match(/RESPOND\s+TO\s+(.+?)[’']S\s+(?:INQUIRY|ENQUIRY|REQUEST)/i);
  if (respondMatch) {
    return toTitleCaseName(respondMatch[1]);
  }

  const subjectPatterns: RegExp[] = [
    /(?:new\s+)?message\s+from\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’.-]+)?)/,
    /(?:in|en)quiry\s+from\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’.-]+)?)/i,
    /reservation\s+request\s+from\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’.-]+)?)/i,
  ];

  for (const pattern of subjectPatterns) {
    const match = subject.match(pattern);
    if (match) {
      return toTitleCaseName(match[1]);
    }
  }

  const bodyPatterns: RegExp[] = [
    /([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’.-]+)?)\s+sent\s+you\s+a\s+message/,
    /respond\s+to\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’.-]+)?)\s+by\s+replying/i,
  ];
  for (const pattern of bodyPatterns) {
    const match = rawBody.match(pattern);
    if (match) {
      return toTitleCaseName(match[1]);
    }
  }

  return null;
}

function extractListingTitleHint(subject: string, rawBody: string): string | null {
  const normalizedSubject = normalizeInvisibleUnicode(subject);
  const monthToken =
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

  const dateTailPattern = new RegExp(
    `(?:,\\s*|\\s+for\\s+|\\s*[-–—|]\\s*)(?:${monthToken}\\s+\\d{1,2}|\\d{1,2}\\s*(?:[-–—]\\s*\\d{1,2}\\s*)?${monthToken}).*$`,
    'i',
  );

  const subjectPatterns: RegExp[] = [
    /^(?:re:\s*)?(?:pending:\s*)?(?:(?:in|en)quiry|pre-?approval|special\s+offer|reservation\s+request|reservation|booking\s+request|booking)\s+(?:for|at|about)\s+(.+)$/i,
    /\bmessage\s+from\s+.+?\s+about\s+(.+)$/i,
  ];

  for (const pattern of subjectPatterns) {
    const match = normalizedSubject.match(pattern);
    if (match) {
      const hint = match[1]
        .replace(dateTailPattern, '')
        .trim()
        .replace(/^["']|["']$/g, '');
      if (hint.length >= 3) {
        return hint;
      }
    }
  }

  const bodyListingMatch = rawBody.match(/(?:^|\n)\s*(?:Listing|Property):\s*(.+)/i);
  if (bodyListingMatch) {
    return bodyListingMatch[1].trim();
  }

  return null;
}

function extractGuestCount(rawBody: string): string | null {
  const match = rawBody.match(/(?:^|\n)\s*GUESTS\s*\n+\s*([^\n]+)/);
  if (!match) {
    return null;
  }
  const value = match[1].trim();
  return value.length > 0 && value.length <= 40 ? value : null;
}

function daysBetweenUtc(
  startYear: number,
  startMonth: number,
  startDay: number,
  endYear: number,
  endMonth: number,
  endDay: number,
): number | null {
  const startMs = Date.UTC(startYear, startMonth, startDay);
  const endMs = Date.UTC(endYear, endMonth, endDay);
  const diffDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000));
  return diffDays > 0 && diffDays <= 365 ? diffDays : null;
}

function extractStayDatesAndNights(
  subject: string,
  rawBody: string,
  sentAtIso: string,
): { stayDates: string | null; nights: number | null } {
  const combined = normalizeInvisibleUnicode(`${subject}\n${rawBody}`);
  const fallbackYear = new Date(sentAtIso).getUTCFullYear() || new Date().getUTCFullYear();

  // Pattern 0: Two full dates on the Airbnb Check-in / Checkout card row:
  // e.g. "October 29, 2026   October 31, 2026" or "Nov 5, 2026      Nov 7, 2026"
  const cardDates = combined.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(\d{4})\s{2,}(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(\d{4})\b/i,
  );
  if (cardDates) {
    const startMonth = MONTH_INDEX[cardDates[1].toLowerCase()];
    const startDay = Number.parseInt(cardDates[2], 10);
    const startYear = Number.parseInt(cardDates[3], 10);
    const endMonth = MONTH_INDEX[cardDates[4].toLowerCase()];
    const endDay = Number.parseInt(cardDates[5], 10);
    const endYear = Number.parseInt(cardDates[6], 10);
    const nights = daysBetweenUtc(startYear, startMonth, startDay, endYear, endMonth, endDay);
    if (nights) {
      const sameMonth = startMonth === endMonth && startYear === endYear;
      const stayDates = sameMonth
        ? `${cardDates[1]} ${startDay} - ${endDay}, ${endYear}`
        : `${cardDates[1]} ${startDay}, ${startYear} - ${cardDates[4]} ${endDay}, ${endYear}`;
      return { stayDates, nights };
    }
  }

  // Pattern 0b: Day-first full dates on international Airbnb Check-in / Checkout card row:
  // e.g. "19 November 2026   22 November 2026" or "19 Nov 2026   22 Nov 2026"
  const dayFirstCardDates = combined.match(
    /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\s{2,}(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i,
  );
  if (dayFirstCardDates) {
    const startDay = Number.parseInt(dayFirstCardDates[1], 10);
    const startMonth = MONTH_INDEX[dayFirstCardDates[2].toLowerCase()];
    const startYear = Number.parseInt(dayFirstCardDates[3], 10);
    const endDay = Number.parseInt(dayFirstCardDates[4], 10);
    const endMonth = MONTH_INDEX[dayFirstCardDates[5].toLowerCase()];
    const endYear = Number.parseInt(dayFirstCardDates[6], 10);
    const nights = daysBetweenUtc(startYear, startMonth, startDay, endYear, endMonth, endDay);
    if (nights) {
      const sameMonth = startMonth === endMonth && startYear === endYear;
      const stayDates = sameMonth
        ? `${dayFirstCardDates[2]} ${startDay} - ${endDay}, ${endYear}`
        : `${dayFirstCardDates[2]} ${startDay}, ${startYear} - ${dayFirstCardDates[5]} ${endDay}, ${endYear}`;
      return { stayDates, nights };
    }
  }

  // Pattern 1: Cross-month range, e.g. "May 29 - Jun 2, 2026" or "Dec 30, 2026 - Jan 2, 2027"
  const crossMonth = combined.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*[-–—to]+\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i,
  );
  if (crossMonth) {
    const startMonth = MONTH_INDEX[crossMonth[1].toLowerCase()];
    const startDay = Number.parseInt(crossMonth[2], 10);
    const endMonth = MONTH_INDEX[crossMonth[4].toLowerCase()];
    const endDay = Number.parseInt(crossMonth[5], 10);
    const endYear = crossMonth[6] ? Number.parseInt(crossMonth[6], 10) : fallbackYear;
    const startYear = crossMonth[3]
      ? Number.parseInt(crossMonth[3], 10)
      : endMonth < startMonth
        ? endYear - 1
        : endYear;
    const nights = daysBetweenUtc(startYear, startMonth, startDay, endYear, endMonth, endDay);
    return {
      stayDates: crossMonth[0].replace(/\s+/g, ' ').trim(),
      nights,
    };
  }

  // Pattern 1b: Day-first cross-month range, e.g. "31 Oct - 2 Nov, 2026" or "31 Oct – 2 Nov"
  const dayFirstCrossMonth = combined.match(
    /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+(\d{4}))?\s*[-–—]+\s*(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:,?\s*(\d{4}))?\b/i,
  );
  if (dayFirstCrossMonth) {
    const startDay = Number.parseInt(dayFirstCrossMonth[1], 10);
    const startMonth = MONTH_INDEX[dayFirstCrossMonth[2].toLowerCase()];
    const endDay = Number.parseInt(dayFirstCrossMonth[4], 10);
    const endMonth = MONTH_INDEX[dayFirstCrossMonth[5].toLowerCase()];
    const endYear = dayFirstCrossMonth[6]
      ? Number.parseInt(dayFirstCrossMonth[6], 10)
      : fallbackYear;
    const startYear = dayFirstCrossMonth[3]
      ? Number.parseInt(dayFirstCrossMonth[3], 10)
      : endMonth < startMonth
        ? endYear - 1
        : endYear;
    const nights = daysBetweenUtc(startYear, startMonth, startDay, endYear, endMonth, endDay);
    if (nights) {
      const stayDates = dayFirstCrossMonth[6]
        ? `${dayFirstCrossMonth[2]} ${startDay} - ${dayFirstCrossMonth[5]} ${endDay}, ${endYear}`
        : `${dayFirstCrossMonth[2]} ${startDay} - ${dayFirstCrossMonth[5]} ${endDay}`;
      return { stayDates, nights };
    }
  }

  // Pattern 2: Same-month range, e.g. "May 14 - 17, 2026" or "Aug 5 – 9"
  const sameMonth = combined.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:,\s*(\d{4}))?\b/i,
  );
  if (sameMonth) {
    const month = MONTH_INDEX[sameMonth[1].toLowerCase()];
    const startDay = Number.parseInt(sameMonth[2], 10);
    const endDay = Number.parseInt(sameMonth[3], 10);
    const year = sameMonth[4] ? Number.parseInt(sameMonth[4], 10) : fallbackYear;
    const nights = daysBetweenUtc(year, month, startDay, year, month, endDay);
    return {
      stayDates: sameMonth[0].replace(/\s+/g, ' ').trim(),
      nights,
    };
  }

  // Pattern 2b: Day-first same-month range, e.g. "19–22 Nov" or "19 - 22 Nov, 2026"
  const dayFirstSameMonth = combined.match(
    /\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:,?\s*(\d{4}))?\b/i,
  );
  if (dayFirstSameMonth) {
    const startDay = Number.parseInt(dayFirstSameMonth[1], 10);
    const endDay = Number.parseInt(dayFirstSameMonth[2], 10);
    const monthName = dayFirstSameMonth[3];
    const month = MONTH_INDEX[monthName.toLowerCase()];
    const year = dayFirstSameMonth[4] ? Number.parseInt(dayFirstSameMonth[4], 10) : fallbackYear;
    const nights = daysBetweenUtc(year, month, startDay, year, month, endDay);
    if (nights) {
      const stayDates = dayFirstSameMonth[4]
        ? `${monthName} ${startDay} - ${endDay}, ${year}`
        : `${monthName} ${startDay} - ${endDay}`;
      return { stayDates, nights };
    }
  }

  const nightsOnly = combined.match(/\b(\d{1,2})\s+nights?\b/i);
  return {
    stayDates: null,
    nights: nightsOnly ? Number.parseInt(nightsOnly[1], 10) : null,
  };
}

function inferGuestStage(
  subject: string,
  template: string | null,
  rawBody: string,
): GuestStage {
  if (template && /(?:(?:in|en)quir(?:y|ies)|pending)/i.test(template)) {
    return 'inquiry';
  }
  if (
    /\b((?:in|en)quiry|pre-?approval|special\s+offer|pending:|reservation request|booking request|request to book)\b/i.test(
      subject,
    )
  ) {
    return 'inquiry';
  }
  if (/\b(pre-approve\s*\/\s*decline|accept\s*\/\s*decline|review\s+(?:in|en)quiry)\b/i.test(rawBody)) {
    return 'inquiry';
  }
  if (/\b(checked in|currently staying|check-out today|checking out today)\b/i.test(rawBody)) {
    return 'current';
  }
  return 'confirmed';
}

function cleanGenericMessageBody(rawText: string, guestName: string | null): string {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (GENERIC_BOILERPLATE_STOP_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      break;
    }

    if (trimmed.startsWith('>') || trimmed === '%opentrack%') {
      continue;
    }

    if (
      /^.+?\s+sent\s+you\s+a\s+message\.?$/i.test(trimmed) ||
      /^new\s+message\s+from\s+.+$/i.test(trimmed) ||
      (guestName &&
        new RegExp(`^${guestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:$`, 'i').test(
          trimmed,
        ))
    ) {
      continue;
    }

    kept.push(line.replace(/[ \t]+$/g, ''));
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function checkStaticNoise(
  fromAddress: string,
  replyToAddress: string | null,
  subject: string,
  template: string | null,
  rawBody: string,
): string | null {
  const isAirbnbFrom =
    isAirbnbEmailAddress(fromAddress) ||
    (replyToAddress ? isAirbnbEmailAddress(replyToAddress) : false);

  if (!isAirbnbFrom) {
    return 'non_airbnb_sender';
  }

  if (NOISE_SENDER_PATTERN.test(fromAddress)) {
    return 'marketing_sender';
  }

  if (template) {
    for (const rule of NOISE_TEMPLATE_PATTERNS) {
      if (rule.pattern.test(template)) {
        return rule.reason;
      }
    }
  }

  const looksLikeGuestMessage = GUEST_MESSAGE_SUBJECT_PATTERNS.some((pattern) =>
    pattern.test(subject),
  );

  for (const rule of NOISE_SUBJECT_PATTERNS) {
    if (rule.pattern.test(subject) && !looksLikeGuestMessage) {
      return rule.reason;
    }
  }

  const isSystemReservationSubject =
    /\breservation\s+(?:confirmed|canceled|cancelled)\b/i.test(subject) ||
    /^(?:re:\s*)?(?:canceled|cancelled):\s*reservation\b/i.test(subject);

  if (
    isSystemReservationSubject &&
    !/\bsent\s+you\s+a\s+message\b/i.test(rawBody) &&
    !/\bmessage\s+from\b/i.test(rawBody) &&
    !/For your protection and safety, always communicate through Airbnb/i.test(rawBody)
  ) {
    return 'system_booking_receipt';
  }

  return null;
}

export interface ParsedAirbnbEmailMeta {
  parsed: ParsedAirbnbEmail;
  isAirbnbSender: boolean;
  matchedStructuredTemplate: boolean;
  rawBody: string;
}

export async function parseAirbnbEmailWithMeta(
  rawEmail: string | Buffer | Uint8Array,
  options: { gmailMessageId?: string } = {},
): Promise<ParsedAirbnbEmailMeta> {
  const parser = new PostalMime();
  const email = await parser.parse(rawEmail);

  const fromAddress = (email.from?.address ?? '').trim().toLowerCase();
  const fromName = email.from?.name
    ? normalizeInvisibleUnicode(email.from.name).trim() || null
    : null;
  const replyToAddress = email.replyTo?.[0]?.address?.trim().toLowerCase() || null;
  const subject = normalizeInvisibleUnicode((email.subject ?? '').trim());
  const sentAt = email.date ? new Date(email.date).toISOString() : new Date().toISOString();
  const rfcMessageId = email.messageId?.trim() || null;
  const gmailMessageId = options.gmailMessageId ?? rfcMessageId ?? `local-${Date.now()}`;

  const textPart = normalizeInvisibleUnicode((email.text ?? '').trim());
  const htmlPart = (email.html ?? '').trim();
  const rawBody = textPart || (htmlPart ? htmlToPlainText(htmlPart) : '');

  const isAirbnbSender =
    isAirbnbEmailAddress(fromAddress) ||
    (replyToAddress ? isAirbnbEmailAddress(replyToAddress) : false);

  const allAirbnbUrls = extractAllAirbnbUrls(textPart, htmlPart);
  const airbnbTemplate = extractAirbnbTemplate(allAirbnbUrls);
  const { airbnbThreadId, reservationCode, airbnbThreadUrl, airbnbListingId } =
    extractThreadAndListingMeta(allAirbnbUrls);

  const listingTitleHint = extractListingTitleHint(subject, rawBody);
  const { stayDates, nights } = extractStayDatesAndNights(subject, rawBody, sentAt);
  const guestCount = extractGuestCount(rawBody);
  const stage = inferGuestStage(subject, airbnbTemplate, rawBody);

  const staticNoiseReason = checkStaticNoise(
    fromAddress,
    replyToAddress,
    subject,
    airbnbTemplate,
    rawBody,
  );

  // Extract structured messages from known Airbnb templates first
  let messages: ParsedEmailMessage[] = [];
  let guestName: string | null = null;
  let matchedStructuredTemplate = false;

  const digestMessages = extractDigestMessages(rawBody);
  if (digestMessages) {
    matchedStructuredTemplate = true;
    messages = digestMessages;
    const firstGuest = digestMessages.find((m) => m.role === 'guest');
    guestName = firstGuest?.senderName ?? null;
  } else {
    const inquiryParsed = extractInquiryOrRequestMessage(rawBody, airbnbTemplate);
    if (inquiryParsed) {
      matchedStructuredTemplate = true;
      guestName = inquiryParsed.guestName;
      messages = inquiryParsed.messages;
    }
  }

  if (!guestName) {
    guestName = extractGuestNameFallback(fromName, subject, rawBody);
  }

  // Fallback for older / simpler Airbnb plain-text formats
  let bodyText = '';
  let hasAttachmentsOnly = false;

  if (messages.length > 0) {
    const guestOnlyBodies = messages.filter((m) => m.role === 'guest').map((m) => m.body);
    bodyText =
      guestOnlyBodies.length > 0
        ? guestOnlyBodies.join('\n\n')
        : messages[messages.length - 1].body;
  } else if (!staticNoiseReason) {
    const cleanedBody = cleanGenericMessageBody(rawBody, guestName);
    const hasAttachmentHint =
      (email.attachments?.length ?? 0) > 0 ||
      /\b(?:sent\s+(?:a|an)\s+(?:photo|image|attachment|picture)|attached\s+(?:a|an)\s+(?:photo|image|file)|view\s+the\s+(?:photo|image|attachment|picture)|photo\s+.+\s+attached)\b/i.test(
        rawBody,
      );

    hasAttachmentsOnly = !cleanedBody && hasAttachmentHint;
    bodyText = hasAttachmentsOnly
      ? '[Guest sent an image or attachment. Open Airbnb to view.]'
      : cleanedBody;

    if (bodyText) {
      messages = [
        {
          senderName: guestName ?? 'Guest',
          role: 'guest',
          body: bodyText,
        },
      ];
    }
  }

  let classification: EmailClassification;
  let ignoreReason: string | null = staticNoiseReason;
  let needsHostReply = false;

  if (staticNoiseReason) {
    classification = 'ignored_noise';
  } else if (messages.length === 0) {
    classification = 'ignored_noise';
    ignoreReason = 'empty_message_body';
  } else {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'host') {
      classification = 'host_reply_sync';
      needsHostReply = false;
    } else {
      classification = 'guest_message';
      needsHostReply = true;
    }
  }

  const parsed: ParsedAirbnbEmail = {
    gmailMessageId,
    rfcMessageId,
    fromAddress,
    fromName,
    replyToAddress,
    subject,
    sentAt,
    airbnbTemplate,
    classification,
    needsHostReply,
    ignoreReason,
    guestName,
    guestCount,
    messages,
    bodyText,
    hasAttachmentsOnly,
    stage,
    stayDates,
    nights,
    airbnbThreadId,
    reservationCode,
    airbnbThreadUrl,
    allAirbnbUrls,
    airbnbListingId,
    listingTitleHint,
  };

  return {
    parsed,
    isAirbnbSender,
    matchedStructuredTemplate,
    rawBody,
  };
}

export async function parseAirbnbEmail(
  rawEmail: string | Buffer | Uint8Array,
  options: { gmailMessageId?: string } = {},
): Promise<ParsedAirbnbEmail> {
  const { parsed } = await parseAirbnbEmailWithMeta(rawEmail, options);
  return parsed;
}
