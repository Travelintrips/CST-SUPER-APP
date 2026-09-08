/**
 * idempotency.ts — RULE 4: Idempotency System
 *
 * Mencegah double processing request finansial yang sama.
 *
 * Alur:
 *   1. Client mengirim x-idempotency-key header dengan nilai unik (UUID/nanoid)
 *   2. Server cek di processed_requests table
 *   3. Jika DITEMUKAN → kembalikan response yang tersimpan (tanpa re-run logic)
 *   4. Jika BARU → claim slot secara atomic, lanjutkan, update dengan response setelah selesai
 *
 * Race-safe: gunakan atomic INSERT untuk claim slot SEBELUM business logic dijalankan.
 * Concurrent request dengan key yang sama mendapat 409 (slot sudah di-claim) atau
 * replay response jika sudah selesai diproses.
 *
 * Scope: diaplikasikan pada route POST keuangan yang critical:
 *   - POST /api/bank-reconciliation/:id/approve
 *   - POST /api/accounting/payments
 *   - POST /api/accounting/journal-entries
 *   - POST /api/bank-mutation-import/upload
 *
 * TTL: 24 jam (configurable)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";

// ─── Migration ────────────────────────────────────────────────────────────────

let _migrated = false;
let _migrationPromise: Promise<void> | null = null;

export async function ensureIdempotencyTable(): Promise<void> {
  if (_migrated) return;
  if (!_migrationPromise) {
    _migrationPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS processed_requests (
          idempotency_key TEXT NOT NULL,
          namespace       TEXT NOT NULL DEFAULT 'default',
          response_code   INTEGER NOT NULL DEFAULT 200,
          response_body   JSONB,
          actor           TEXT,
          request_fingerprint TEXT,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
          PRIMARY KEY (idempotency_key, namespace)
        )
      `);

      await db.execute(sql`
        ALTER TABLE processed_requests
          ADD COLUMN IF NOT EXISTS request_fingerprint TEXT
      `);

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS pr_expires_idx ON processed_requests(expires_at)
      `);
      _migrated = true;
    })().catch((error) => {
      _migrationPromise = null;
      throw error;
    });
  }
  await _migrationPromise;
}

// ─── Core functions ───────────────────────────────────────────────────────────

export interface IdempotencyCheckResult {
  hit:      boolean;
  code?:    number;
  body?:    unknown;
  conflict?: "fingerprint_mismatch";
}

/**
 * checkIdempotency — cek apakah key sudah pernah diproses dan selesai.
 * Jika ditemukan dengan response_body (selesai diproses) → kembalikan cached response.
 * Jika response_body IS NULL → slot sedang diproses (in-flight).
 */
export async function checkIdempotency(
  key: string,
  namespace = "default",
  fingerprint?: string | null,
): Promise<IdempotencyCheckResult & { inFlight?: boolean }> {
  await ensureIdempotencyTable();

  try {
    const { rows } = await db.execute(sql`
      SELECT response_code, response_body, request_fingerprint
      FROM processed_requests
      WHERE idempotency_key = ${key}
        AND namespace = ${namespace}
        AND expires_at > NOW()
      LIMIT 1
    `);

    if (!rows.length) return { hit: false };

    const row = rows[0] as Record<string, unknown>;

    if (
      fingerprint &&
      row["request_fingerprint"] &&
      String(row["request_fingerprint"]) !== fingerprint
    ) {
      return { hit: false, conflict: "fingerprint_mismatch" };
    }

    // Slot exists but response_body is NULL → another request is currently processing
    if (row["response_body"] === null || row["response_body"] === undefined) {
      return { hit: false, inFlight: true };
    }

    return {
      hit:  true,
      code: Number(row["response_code"] ?? 200),
      body: typeof row["response_body"] === "string"
        ? JSON.parse(row["response_body"])
        : row["response_body"],
    };
  } catch (error) {
    logger.error({ error, key, namespace }, "[idempotency] check failed closed");
    throw new Error("IDEMPOTENCY_STORAGE_UNAVAILABLE");
  }
}

/**
 * claimIdempotencySlot — atomic INSERT placeholder SEBELUM business logic.
 *
 * Returns:
 *   { claimed: true }                          — slot baru berhasil di-claim, lanjut
 *   { claimed: false, cached: IdempotencyCheckResult } — sudah selesai, replay response
 *   { claimed: false, inFlight: true }          — sedang diproses request lain → 409
 */
export async function claimIdempotencySlot(
  key: string,
  namespace = "default",
  ttlHours = 24,
  fingerprint?: string | null,
): Promise<
  | { claimed: true }
  | { claimed: false; cached: IdempotencyCheckResult }
  | { claimed: false; inFlight: true }
  | { claimed: false; conflict: "fingerprint_mismatch" }
> {
  await ensureIdempotencyTable();

  try {
    // Atomic INSERT with response_body = NULL (placeholder = "in-flight")
    const { rows } = await db.execute(sql`
      INSERT INTO processed_requests
        (idempotency_key, namespace, response_code, response_body, request_fingerprint, expires_at)
      VALUES (
        ${key}, ${namespace}, 200, NULL, ${fingerprint ?? null},
        NOW() + ${`${ttlHours} hours`}::INTERVAL
      )
      ON CONFLICT (idempotency_key, namespace) DO NOTHING
      RETURNING idempotency_key
    `);

    if (rows.length > 0) {
      // We won the race — slot is ours
      return { claimed: true };
    }

    // Conflict — another request already has this slot; read what's there
    const existing = await checkIdempotency(key, namespace, fingerprint);

    if (existing.hit) {
      // Already completed — return cached response
      return { claimed: false, cached: existing };
    }

    if (existing.conflict === "fingerprint_mismatch") {
      return { claimed: false, conflict: "fingerprint_mismatch" };
    }

    // Slot exists but no response yet — concurrent request is in-flight
    return { claimed: false, inFlight: true };
  } catch (error) {
    logger.error({ error, key, namespace }, "[idempotency] claim failed closed");
    throw new Error("IDEMPOTENCY_STORAGE_UNAVAILABLE");
  }
}

/**
 * recordIdempotency — UPDATE placeholder dengan response sesungguhnya.
 * Harus dipanggil SETELAH request berhasil diproses.
 * Fire-and-forget, non-fatal.
 */
export async function recordIdempotency(
  key: string,
  namespace = "default",
  code: number,
  body: unknown,
  actor?: string | null,
  ttlHours = 24,
  fingerprint?: string | null,
): Promise<void> {
  await ensureIdempotencyTable();

  await db.execute(sql`
    INSERT INTO processed_requests
      (idempotency_key, namespace, response_code, response_body, actor, request_fingerprint, expires_at)
    VALUES (
      ${key}, ${namespace}, ${code}, ${JSON.stringify(body)},
      ${actor ?? null},
      ${fingerprint ?? null},
      NOW() + ${`${ttlHours} hours`}::INTERVAL
    )
    ON CONFLICT (idempotency_key, namespace)
    DO UPDATE SET
      response_code = EXCLUDED.response_code,
      response_body = EXCLUDED.response_body,
       actor         = EXCLUDED.actor,
       request_fingerprint = EXCLUDED.request_fingerprint,
      expires_at    = EXCLUDED.expires_at
  `).catch((e: unknown) => {
    logger.warn({ e, key, namespace }, "[idempotency] recordIdempotency failed (non-fatal)");
  });
}

/**
 * cleanupExpiredKeys — hapus key yang sudah expired.
 * Dipanggil oleh cleanup worker setiap jam.
 */
export async function cleanupExpiredKeys(): Promise<number> {
  await ensureIdempotencyTable();
  const { rows } = await db.execute(sql`
    DELETE FROM processed_requests
    WHERE expires_at < NOW()
    RETURNING idempotency_key
  `).catch(() => ({ rows: [] }));
  return rows.length;
}

// ─── Express Middleware ───────────────────────────────────────────────────────

export type IdempotencyNamespaceResolver = (req: Request) => string;
export type IdempotencyScopeResolver = (req: Request) => string | Promise<string>;
export type IdempotencyFingerprintResolver = (req: Request) => string | null;

const defaultNamespaceResolver: IdempotencyNamespaceResolver = (req) => {
  // Derive namespace from route path
  const path = req.path.replace(/\/\d+/g, "/:id");
  return `${req.method}:${path}`;
};

/**
 * Stable JSON serialization for request fingerprints. Object key order is not
 * semantically meaningful, while array order is preserved because item order
 * can be meaningful to the business payload.
 */
export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(record[key])}`
  )).join(",")}}`;
}

export function canonicalRequestFingerprint(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

/**
 * createIdempotencyMiddleware — factory untuk membuat middleware idempotency.
 *
 * Race-safe:
 *   1. claimIdempotencySlot() — atomic INSERT placeholder
 *   2. Jika conflict + sudah selesai → replay response (200)
 *   3. Jika conflict + in-flight    → 409 IDEMPOTENCY_IN_FLIGHT
 *   4. Jika claimed → jalankan business logic, lalu update slot dengan response
 *
 * Contoh penggunaan di route file:
 *   router.post("/payments", createIdempotencyMiddleware("accounting:payments"), handler);
 *
 * Atau gunakan auto-namespace:
 *   router.post("/approve", createIdempotencyMiddleware(), approveHandler);
 */
export function createIdempotencyMiddleware(
  namespace?: string,
  opts?: {
    ttlHours?: number;
    keyHeader?: string;
    scopeResolver?: IdempotencyScopeResolver;
    fingerprintResolver?: IdempotencyFingerprintResolver;
  },
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const keyHeader   = opts?.keyHeader ?? "x-idempotency-key";
  const ttlHours    = opts?.ttlHours  ?? 24;
  const nsResolver  = namespace
    ? () => namespace
    : defaultNamespaceResolver;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.headers[keyHeader] as string | undefined;

    if (!key || key.trim() === "") {
      // No key provided — allow without idempotency (compatible with existing clients)
      return next();
    }

    const scope = await opts?.scopeResolver?.(req);
    const ns = scope ? `${nsResolver(req)}:${scope}` : nsResolver(req);
    const fingerprint = opts?.fingerprintResolver?.(req)
      ?? canonicalRequestFingerprint({
        params: req.params,
        query: req.query,
        body: req.body ?? null,
      });
    let claim: Awaited<ReturnType<typeof claimIdempotencySlot>>;
    try {
      claim = await claimIdempotencySlot(key, ns, ttlHours, fingerprint);
    } catch (error) {
      if (error instanceof Error && error.message === "IDEMPOTENCY_STORAGE_UNAVAILABLE") {
        res.status(503).json({
          error: "IDEMPOTENCY_STORAGE_UNAVAILABLE",
          message: "Idempotency storage tidak tersedia; request tidak dijalankan.",
        });
        return;
      }
      throw error;
    }

    if (!claim.claimed) {
      if ("cached" in claim && claim.cached.hit) {
        // Already completed by a previous request — replay stored response
        logger.info({ key, ns }, "[idempotency] Cache hit — returning stored response");
        res.status(claim.cached.code ?? 200).json({
          ...(claim.cached.body as Record<string, unknown>),
          __idempotency: { cached: true, key },
        });
        return;
      }
      if ("conflict" in claim && claim.conflict === "fingerprint_mismatch") {
        res.status(422).json({
          error: "IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency key sudah dipakai untuk payload berbeda.",
        });
        return;
      }

      // Another request is currently processing this key — reject with 409
      logger.warn({ key, ns }, "[idempotency] In-flight collision — rejecting duplicate");
      res.status(409).json({
        error: "IDEMPOTENCY_IN_FLIGHT",
        message: "Request dengan key ini sedang diproses. Coba lagi sebentar.",
        key,
      });
      return;
    }

    // We claimed the slot — intercept res.json to persist the response
    const originalJson = res.json.bind(res) as typeof res.json;
    res.json = function (body: unknown) {
      const statusCode = res.statusCode || 200;

      // Only record successful responses (2xx)
      if (statusCode >= 200 && statusCode < 300) {
        const actor = (req.user as unknown as Record<string, unknown>)?.id as string | undefined;
        void recordIdempotency(key, ns, statusCode, body, actor ?? null, ttlHours, fingerprint);
      } else {
        // Non-2xx: remove the placeholder so the client can retry
        void db.execute(sql`
          DELETE FROM processed_requests
          WHERE idempotency_key = ${key} AND namespace = ${ns} AND response_body IS NULL
        `).catch(() => {});
      }

      return originalJson(body);
    } as typeof res.json;

    next();
  };
}

// ─── Cleanup worker ───────────────────────────────────────────────────────────

export function startIdempotencyCleanup(): void {
  setInterval(() => {
    cleanupExpiredKeys().then((n) => {
      if (n > 0) logger.info({ deleted: n }, "[idempotency] Expired keys cleaned up");
    }).catch(() => {});
  }, 60 * 60 * 1000); // every hour
}
