/**
 * tokenUtils — Security Patch P0 (Enterprise Hardening)
 *
 * Utilities untuk:
 *   - Generasi token 256-bit yang aman (P0.2)
 *   - HMAC-SHA256 hashing dengan SESSION_SECRET (P0.1)
 *   - Dual-validation helper untuk masa transisi (backward compat)
 *   - Token masking untuk log/debug
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const _rawSecret = process.env.SESSION_SECRET;
if (!_rawSecret) {
  // In production, missing SESSION_SECRET is a fatal misconfiguration.
  // In dev we warn but continue so the server still starts during local setup.
  const msg = "[tokenUtils] SESSION_SECRET is not set — token HMAC will be insecure. Set SESSION_SECRET in production!";
  if (process.env.NODE_ENV === "production") {
    throw new Error(msg);
  } else {
    console.warn(msg);
  }
}
const SECRET = _rawSecret ?? "dev-insecure-fallback-do-not-use-in-prod";

// ── Token Generation ──────────────────────────────────────────────────────────

/**
 * Generate token 256-bit yang aman secara kriptografi.
 * Return hex string URL-safe — kirim ini ke user, jangan simpan ke DB.
 */
export function generateSecureToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Generate token + hash sekaligus.
 * raw  → kirim ke user (via URL / WhatsApp / email)
 * hash → simpan ke DB (kolom token_hash)
 *
 * Selama masa transisi: simpan raw ke kolom `token` juga, agar lookup lama masih jalan.
 */
export function generateTokenPair(): { raw: string; hash: string } {
  const raw = generateSecureToken();
  return { raw, hash: hashToken(raw) };
}

// ── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Hash token dengan HMAC-SHA256 + SESSION_SECRET.
 * Ini yang disimpan di database.
 */
export function hashToken(raw: string): string {
  return createHmac("sha256", SECRET).update(raw).digest("hex");
}

/**
 * Timing-safe compare: raw token vs stored hash.
 */
export function verifyToken(raw: string, storedHash: string): boolean {
  try {
    const computed = Buffer.from(hashToken(raw), "hex");
    const stored   = Buffer.from(storedHash,    "hex");
    if (computed.length !== stored.length) return false;
    return timingSafeEqual(computed, stored);
  } catch {
    return false;
  }
}

// ── Dual Validation (Transition Period) ──────────────────────────────────────

/**
 * Build WHERE clause params untuk dual-validation.
 * Coba token_hash dulu (baru), fallback ke plaintext jika token_hash IS NULL (lama).
 *
 * Gunakan di raw SQL:
 *   WHERE (token_hash = ${dv.hash} OR (token_hash IS NULL AND token = ${dv.raw}))
 */
export function dualTokenParams(raw: string): { raw: string; hash: string } {
  return { raw, hash: hashToken(raw) };
}

// ── Logging / Masking ─────────────────────────────────────────────────────────

/**
 * Mask token untuk logging — tampilkan 8 char pertama saja.
 * JANGAN pernah log token mentah.
 */
export function maskToken(raw: string): string {
  if (!raw || raw.length < 8) return "***";
  return `${raw.slice(0, 8)}…(masked)`;
}
