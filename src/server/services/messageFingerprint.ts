import crypto from 'node:crypto';

function normalizeForFingerprint(value: string): string {
  return value
    .replace(/\u200c|\u200b|\ufeff/g, '')
    .replace(/[\u00a0\u2009\u200a\u202f]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Computes a deterministic SHA-256 content fingerprint for a parsed message.
 * Identical Airbnb messages forwarded from both host and co-host inboxes
 * produce the same fingerprint regardless of Gmail Message-ID or line wrapping.
 */
export function computeMessageFingerprint(
  role: 'guest' | 'host' | 'system',
  senderName: string,
  body: string,
): string {
  const normalizedSender = normalizeForFingerprint(senderName);
  const normalizedBody = normalizeForFingerprint(body);
  const payload = `${role}|${normalizedSender}|${normalizedBody}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}
