const SYCOPHANTIC_OPENERS: readonly RegExp[] = [
  /^(?:certainly|absolutely|of course|i would be absolutely delighted|we would be absolutely delighted|great question)[!,.\s]+/i,
];

/**
 * Strips em-dashes and en-dashes from guest-facing text while preserving
 * numeric and currency ranges (including chained ranges like `1–2–3` and `$180–$220`)
 * as standard ASCII hyphens.
 */
export function stripEditorialDashes(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(?=\$?\d)/g, '$1-')
    .replace(/,\s*[—–]\s*/g, ', ')
    .replace(/^\s*[—–]\s*/gm, '')
    .replace(/\s*[—–]\s*$/gm, '')
    .replace(/\s*[—–]\s*/g, ', ');
}

/**
 * Post-processes generated guest reply drafts to enforce hard Haven style guardrails:
 * zero editorial em/en-dashes and zero sycophantic filler openers.
 */
export function sanitizeDraftOutput(draft: string): string {
  let cleaned = stripEditorialDashes(draft).replace(/\r\n/g, '\n').trim();

  for (const pattern of SYCOPHANTIC_OPENERS) {
    cleaned = cleaned.replace(pattern, '').trim();
  }

  if (cleaned.length > 0 && /^[a-z]/.test(cleaned)) {
    cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}
