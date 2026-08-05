/**
 * AI Transaction Intelligence — Phase 8
 * Idempotency Key Builders
 *
 * Deterministic key builders for review cases and reviewer decisions.
 * Pure functions — no side effects, no randomness, no Date.now().
 */

// ─── Simple deterministic hash ───────────────────────────────────────────────

/**
 * Deterministic FNV-1a 32-bit hash of a string.
 * No crypto dependency — pure bit arithmetic.
 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function serialize(...parts: Array<string | number | undefined | null>): string {
  return parts
    .map(p => (p == null ? 'null' : String(p)))
    .join('::');
}

// ─── Review case idempotency key ─────────────────────────────────────────────

/**
 * Build a deterministic idempotency key for a review case.
 *
 * Uniqueness factors:
 *   - companyId
 *   - transactionId
 *   - source (optional, defaults to "default")
 *   - snapshotVersion (AI snapshot version — changes when AI logic changes)
 */
export function buildReviewCaseIdempotencyKey(
  companyId: string | number,
  transactionId: string | number,
  source: string | undefined,
  snapshotVersion: string,
): string {
  const raw = serialize(companyId, transactionId, source ?? 'default', snapshotVersion);
  const hash = fnv1a(raw);
  return `rc::${hash}::${String(companyId).slice(0, 8)}::${String(transactionId).slice(0, 8)}`;
}

// ─── Reviewer decision idempotency key ───────────────────────────────────────

/**
 * Build a deterministic idempotency key for a reviewer decision.
 *
 * Uniqueness factors:
 *   - reviewCaseId
 *   - reviewerId
 *   - decision type
 *   - decidedAt timestamp (ISO string)
 */
export function buildReviewerDecisionIdempotencyKey(
  reviewCaseId: string,
  reviewerId: string | number,
  decision: string,
  decidedAt: string,
): string {
  const raw = serialize(reviewCaseId, reviewerId, decision, decidedAt);
  const hash = fnv1a(raw);
  return `rd::${hash}::${String(reviewerId).slice(0, 8)}`;
}

// ─── UUID-like case ID generator ─────────────────────────────────────────────

/**
 * Generate a deterministic case ID from a seed.
 * Format: rc-{8hex}-{8hex}-{8hex}
 *
 * Uses FNV-1a on the seed string — no randomness.
 */
export function generateCaseId(seed: string): string {
  const h1 = fnv1a(seed);
  const h2 = fnv1a(seed + '::2');
  const h3 = fnv1a(seed + '::3');
  return `rc-${h1}-${h2}-${h3}`;
}

/**
 * Generate a deterministic audit event ID.
 */
export function generateAuditEventId(
  reviewCaseId: string,
  eventType: string,
  occurredAt: string,
  sequence: number,
): string {
  const seed = serialize(reviewCaseId, eventType, occurredAt, sequence);
  const hash = fnv1a(seed);
  return `ae-${hash}-${sequence.toString().padStart(4, '0')}`;
}

/**
 * Generate a deterministic decision record ID.
 */
export function generateDecisionId(idempotencyKey: string): string {
  const hash = fnv1a(idempotencyKey + '::decision');
  return `dec-${hash}`;
}
