const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower === '[::1]' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.localhost')
  ) {
    return true;
  }

  // Block IPv4 loopback, RFC1918 private ranges, and link-local / cloud metadata (169.254.x.x)
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4Match) {
    const a = Number.parseInt(ipv4Match[1], 10);
    const b = Number.parseInt(ipv4Match[2], 10);
    if (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
  }

  // Block IPv6 ULA / link-local / loopback literals
  const stripped = lower.replace(/^\[|\]$/g, '');
  if (stripped.includes(':')) {
    if (
      stripped === '::1' ||
      stripped.startsWith('fc') ||
      stripped.startsWith('fd') ||
      stripped.startsWith('fe80:')
    ) {
      return true;
    }
  }

  return false;
}

export function validateWelcomeGuideFetchUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Enter a valid https:// Welcome Guide URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only https:// Welcome Guide URLs are supported.');
  }
  if (!parsed.hostname || isPrivateOrBlockedHost(parsed.hostname)) {
    throw new Error('That URL host is not allowed.');
  }
  return parsed;
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;|&ndash;/gi, ' - ')
    .replace(/&middot;/gi, ' · ');
}

export function extractReadableTextFromHtml(html: string): string {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ');

  const withLineBreaks = withoutBlocks.replace(
    /<\/?(?:p|div|section|article|header|footer|h[1-6]|li|tr|br|hr)\b[^>]*>/gi,
    '\n',
  );

  const strippedTags = withLineBreaks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeBasicHtmlEntities(strippedTags);

  return decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export async function fetchWelcomeGuideText(
  rawUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ finalUrl: string; textContent: string }> {
  const validatedUrl = validateWelcomeGuideFetchUrl(rawUrl);

  const response = await fetchFn(validatedUrl.toString(), {
    method: 'GET',
    headers: {
      Accept: 'text/html, text/plain;q=0.9',
      'User-Agent': 'GuestCohostBot/1.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Could not fetch Welcome Guide URL (HTTP ${response.status}).`);
  }

  const finalUrl = response.url || validatedUrl.toString();
  validateWelcomeGuideFetchUrl(finalUrl);

  const rawBody = await response.text();
  const boundedBody =
    rawBody.length > MAX_HTML_BYTES ? rawBody.slice(0, MAX_HTML_BYTES) : rawBody;

  const contentType = response.headers.get('content-type') ?? '';
  const textContent = contentType.includes('text/plain')
    ? boundedBody.trim()
    : extractReadableTextFromHtml(boundedBody);

  if (!textContent) {
    throw new Error('No readable house details found at that URL.');
  }

  return {
    finalUrl,
    textContent,
  };
}
