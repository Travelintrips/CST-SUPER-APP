/**
 * @deprecated LEGACY ROUTE — FROZEN Phase 4 (2026-05-30)
 *
 * logistics.ts beroperasi di atas tabel `shipments` (legacy, pre-freight).
 * Route ini sudah DINONAKTIFKAN sejak migrasi ke freight.ts + tabel freight_shipments.
 *
 * Status freeze:
 *   - Import di routes/index.ts sudah di-comment-out — route ini UNREACHABLE dari luar.
 *   - Middleware deprecated di bawah memblokir semua write (POST/PUT) jika file ini pernah di-mount kembali.
 *   - GET (read-only) tetap diizinkan dengan header X-Deprecated.
 *
 * Jangan hapus file ini dulu — ada referensi tabel shipmentsTable di dashboard.ts (read-count widget).
 * Migration plan terpisah: Phase 5 — hapus tabel, hapus file, update dashboard widget ke freightShipmentsTable.
 *
 * Callers aktif tersisa:
 *   - dashboard.ts line ~167: `db.select({ count }).from(shipmentsTable)` — READ ONLY, tidak perlu route ini.
 *
 * Untuk mengaktifkan kembali: uncomment baris di routes/index.ts HANYA setelah review arsitektur.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db, shipmentsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";

const router = Router();

const DEPRECATED_ROUTE = "POST /api/logistics/shipments";

/**
 * Middleware freeze: tambahkan header X-Deprecated ke semua response.
 * Blokir semua write (POST/PUT/PATCH/DELETE) dengan 410 Gone.
 */
function deprecatedMiddleware(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Deprecated", "true");
  res.setHeader("X-Deprecated-Since", "2026-05-30");
  res.setHeader("X-Deprecated-Reason", "Migrated to /api/logistics (freight.ts) using freight_shipments table");
  res.setHeader("X-Migration-Target", "/api/logistics/shipments (freight.ts)");

  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return res.status(410).json({
      error: "Route ini sudah dinonaktifkan (frozen).",
      message: "Gunakan /api/logistics/shipments via freight.ts untuk operasi freight.",
      deprecated: true,
      deprecatedSince: "2026-05-30",
      migrationTarget: "/api/logistics/shipments",
    });
  }
  return next();
}

router.use(deprecatedMiddleware);

// GET /api/logistics/shipments — read-only, deprecated, pakai X-Deprecated header
router.get("/shipments", async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));
  const offset = (page - 1) * limit;

  const [{ total }] = await db.select({ total: count() }).from(shipmentsTable);
  const shipments = await db.select().from(shipmentsTable).orderBy(shipmentsTable.createdAt).limit(limit).offset(offset);
  return res.json({
    data: shipments.map(s => ({ ...s, createdAt: s.createdAt.toISOString() })),
    pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    _deprecated: true,
    _deprecatedSince: "2026-05-30",
    _migrationTarget: "GET /api/logistics/shipments (freight.ts)",
  });
});

// POST /api/logistics/shipments — BLOCKED (handled by deprecatedMiddleware above)
// Jika dipanggil, akan mengembalikan 410 Gone.
// Ini hanya komentar dokumentasi — middleware sudah menanganinya.
void DEPRECATED_ROUTE;

// PUT /api/logistics/shipments/:id — BLOCKED (handled by deprecatedMiddleware above)

export default router;
