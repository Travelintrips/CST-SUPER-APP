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

// ─── Migration ────────────────────────────────────────────────────────────────

let _migrated = false;

export async function ensureIdempotencyTable(): Promise<void> {
  if (_migrated) return;
  _migrated = true;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS processed_requests (
      idempotency_key TEXT NOT NULL,
      namespace       TEXT NOT NULL DEFAULT 'default',
      response_code   INTEGER NOT NULL DEFAULT 200,
      response_body   JSONB,
      actor           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
      PRIMARY KEY (idempotency_key, namespace)
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS pr_expires_idx ON processed_requests(expires_at)
  `).catch(() => {});
}

// ─── Core functions ───────────────────────────────────────────────────────────

export interface IdempotencyCheckResult {
  hit:      boolean;
  code?:    number;
  body?:    unknown;
}

/**
 * checkIdempotency — cek apakah key sudah pernah diproses dan selesai.
 * Jika ditemukan dengan response_body (selesai diproses) → kembalikan cached response.
 * Jika response_body IS NULL → slot sedang diproses (in-flight).
 */
export async function checkIdempotency(
  key: string,
  namespace = "default",
): Promise<IdempotencyCheckResult & { inFlight?: boolean }> {
  await ensureIdempotencyTable();

  try {
    const { rows } = await db.execute(sql`
      SELECT response_code, response_body
      FROM processed_requests
      WHERE idempotency_key = ${key}
        AND namespace = ${namespace}
        AND expires_at > NOW()
      LIMIT 1
    `);

    if (!rows.length) return { hit: false };

    const row = rows[0] as Record<string, unknown>;

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
  } catch {
    return { hit: false }; // non-fatal: continue processing if check fails
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
): Promise<
  | { claimed: true }
  | { claimed: false; cached: IdempotencyCheckResult }
  | { claimed: false; inFlight: true }
> {
  await ensureIdempotencyTable();

  try {
    // Atomic INSERT with response_body = NULL (placeholder = "in-flight")
    const { rows } = await db.execute(sql`
      INSERT INTO processed_requests
        (idempotency_key, namespace, response_code, response_body, expires_at)
      VALUES (
        ${key}, ${namespace}, 200, NULL,
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
    const existing = await checkIdempotency(key, namespace);

    if (existing.hit) {
      // Already completed — return cached response
      return { claimed: false, cached: existing };
    }

    // Slot exists but no response yet — concurrent request is in-flight
    return { claimed: false, inFlight: true };
  } catch {
    // On any error, let the request proceed (fail-open for availability)
    return { claimed: true };
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
): Promise<void> {
  await ensureIdempotencyTable();

  await db.execute(sql`
    INSERT INTO processed_requests
      (idempotency_key, namespace, response_code, response_body, actor, expires_at)
    VALUES (
      ${key}, ${namespace}, ${code}, ${JSON.stringify(body)},
      ${actor ?? null},
      NOW() + ${`${ttlHours} hours`}::INTERVAL
    )
    ON CONFLICT (idempotency_key, namespace)
    DO UPDATE SET
      response_code = EXCLUDED.response_code,
      response_body = EXCLUDED.response_body,
      actor         = EXCLUDED.actor,
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

const defaultNamespaceResolver: IdempotencyNamespaceResolver = (req) => {
  // Derive namespace from route path
  const path = req.path.replace(/\/\d+/g, "/:id");
  return `${req.method}:${path}`;
};

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
  opts?: { ttlHours?: number; keyHeader?: string },
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

    const ns     = nsResolver(req);
    const claim  = await claimIdempotencySlot(key, ns, ttlHours);

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
        void recordIdempotency(key, ns, statusCode, body, actor ?? null, ttlHours);
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
