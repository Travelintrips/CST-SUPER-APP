/**
 * AI Transaction Intelligence — Phase 8
 * Privacy & Redaction
 *
 * Account masking and recursive sensitive-key redaction.
 * Pure functions — no side effects.
 */

// ─── Sensitive keys ───────────────────────────────────────────────────────────

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /password/i,
  /secret/i,
  /token/i,
  /apiKey/i,
  /api_key/i,
  /privateKey/i,
  /private_key/i,
  /authorization/i,
  /credential/i,
  /session/i,
  /bearer/i,
  /access_token/i,
  /refresh_token/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some(pat => pat.test(key));
}

// ─── Account masking ──────────────────────────────────────────────────────────

/**
 * Masks an account number, preserving only the last 4 digits.
 *
 * Examples:
 *   "1234567890"  → "******7890"
 *   "1234"        → "1234"          (≤4 chars — return as-is)
 *   ""            → ""
 */
export function maskAccountNumber(account: string | undefined | null): string | undefined {
  if (account == null) return undefined;
  const s = account.trim();
  if (s.length <= 4) return s || undefined;
  const visible = s.slice(-4);
  const masked = '*'.repeat(Math.min(s.length - 4, 6));
  return `${masked}${visible}`;
}

// ─── Recursive metadata redaction ────────────────────────────────────────────

type Redactable = Record<string, unknown> | unknown[] | string | number | boolean | null | undefined;

/**
 * Recursively redacts sensitive keys from a metadata object.
 * Arrays are traversed. Non-object leaves are returned as-is.
 * Sensitive string values are replaced with "[REDACTED]".
 */
export function redactSensitiveMetadata(value: Redactable, depth = 0): Redactable {
  if (depth > 10) return '[REDACTED_DEEP]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return (value as unknown[]).map(item => redactSensitiveMetadata(item as Redactable, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = redactSensitiveMetadata(v as Redactable, depth + 1);
    }
  }
  return result;
}

/**
 * Sanitizes a metadata record for inclusion in audit events or snapshots.
 * Removes sensitive keys recursively and caps depth.
 */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return redactSensitiveMetadata(metadata) as Record<string, unknown>;
}
