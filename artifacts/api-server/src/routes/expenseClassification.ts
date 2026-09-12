/**
 * Expense Classification Routes
 *
 * Endpoints untuk menjalankan 3-layer pipeline klasifikasi pengeluaran:
 *   normalizer → rule engine → AI (GPT-4o-mini)
 *
 * Routes (semua di bawah /api/bank-recon):
 *   POST /classify              — klasifikasi satu deskripsi / mutasi
 *   POST /classify/bulk         — klasifikasi batch mutasi yang belum ter-klasifikasi
 *   GET  /classify/stats        — statistik klasifikasi per company
 *   POST /classify/test-ai      — test AI classifier saja (debug/dry-run)
 *
 * Auth: requireAdmin
 *
 * Cara penggunaan:
 *   1. Kirim POST /api/bank-recon/classify dengan body { description, amount, direction }
 *      → Sistem akan menjalankan 3 layer dan mengembalikan hasil + breakdown
 *   2. Untuk klasifikasi massal, POST /api/bank-recon/classify/bulk
 *      → Sistem akan mengambil mutasi OUT yang belum ter-klasifikasi, proses, simpan ke DB
 *   3. Hasil disimpan di kolom expense_* di tabel bank_mutations
 */

import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { runExpenseClassificationMigration } from "../lib/expenseClassificationMigration.js";
import {
  classifyMutationDescription,
  bulkClassifyMutations,
  persistClassification,
} from "../lib/expenseClassificationService.js";
import { classifyWithAi } from "../lib/expenseAiClassifier.js";
import { normalizeDescription } from "../lib/bankDescriptionNormalizer.js";
import { getAiClassifierCacheStats, clearAiClassifierCache } from "../lib/expenseAiClassifier.js";

export const expenseClassificationRouter = Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────
expenseClassificationRouter.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Lazy migration ────────────────────────────────────────────────────────────
let migrationDone = false;
async function ensureMigration() {
  if (migrationDone) return;
  await runExpenseClassificationMigration();
  migrationDone = true;
}

// ─── Input schemas ─────────────────────────────────────────────────────────────

const ClassifySchema = z.object({
  /** Deskripsi mentah dari mutasi bank */
  description: z.string().min(1, "description wajib diisi"),
  /** Nominal transaksi (opsional, membantu AI) */
  amount: z.number().optional(),
  /** Arah mutasi: OUT = pengeluaran, IN = penerimaan */
  direction: z.enum(["IN", "OUT"]).optional(),
  /** ID perusahaan untuk load company-specific rules */
  companyId: z.number().int().optional().nullable(),
  /** Apakah gunakan AI fallback (layer 3). Default: true */
  useAi: z.boolean().optional().default(true),
  /** ID mutasi bank (opsional) — jika diisi, hasil disimpan ke DB */
  mutationId: z.number().int().optional().nullable(),
});

const BulkClassifySchema = z.object({
  companyId: z.number().int().optional().nullable(),
  /** Hanya proses arah ini. Default: "OUT" (pengeluaran) */
  direction: z.enum(["IN", "OUT"]).optional(),
  /** Hanya proses mutasi yang belum ter-klasifikasi. Default: true */
  onlyUnclassified: z.boolean().optional().default(true),
  /** Max mutasi yang diproses. Default: 50, Max: 200 */
  limit: z.number().int().min(1).max(200).optional().default(50),
  /** Gunakan AI fallback. Default: true */
  useAi: z.boolean().optional().default(true),
});

const TestAiSchema = z.object({
  description: z.string().min(1),
  amount: z.number().optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

// ─── POST /bank-recon/classify ────────────────────────────────────────────────
/**
 * Klasifikasi satu deskripsi mutasi bank.
 *
 * Menjalankan pipeline: normalizer → rule engine → AI
 * Mengembalikan hasil lengkap termasuk breakdown dari tiap layer.
 *
 * Jika mutationId diisi, hasil juga disimpan ke kolom expense_* di bank_mutations.
 *
 * Request body:
 *   {
 *     description: string
 *     amount?: number
 *     direction?: "IN" | "OUT"
 *     companyId?: number
 *     useAi?: boolean       // default true
 *     mutationId?: number   // jika diisi, persist ke DB
 *   }
 *
 * Response:
 *   {
 *     input: { description, amount, direction },
 *     result: ClassificationResult,
 *     persisted: boolean    // true jika disimpan ke bank_mutations
 *   }
 */
expenseClassificationRouter.post("/classify", async (req, res) => {
  await ensureMigration();
  try {
    const parsed = ClassifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Input tidak valid",
        details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const { description, amount, direction, companyId, useAi, mutationId } = parsed.data;

    const result = await classifyMutationDescription({
      description,
      amount,
      direction,
      companyId,
      useAi,
    });

    let persisted = false;
    if (mutationId != null) {
      // persistClassification now returns true on success; only set persisted on confirmed write
      persisted = await persistClassification(mutationId, result);
    }

    return res.json({
      input: { description, amount, direction, companyId },
      result,
      persisted,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[POST /bank-recon/classify] failed");
    return res.status(500).json({ error: "Gagal menjalankan klasifikasi", detail: err.message });
  }
});

// ─── POST /bank-recon/classify/bulk ──────────────────────────────────────────
/**
 * Klasifikasi batch mutasi bank yang belum ter-klasifikasi.
 *
 * Mengambil mutasi dari bank_mutations (direction=OUT, expense_category IS NULL),
 * menjalankan pipeline untuk masing-masing, dan menyimpan hasilnya ke DB.
 *
 * Request body:
 *   {
 *     companyId?: number
 *     direction?: "IN" | "OUT"    // default "OUT"
 *     onlyUnclassified?: boolean  // default true
 *     limit?: number              // default 50, max 200
 *     useAi?: boolean             // default true
 *   }
 *
 * Response:
 *   {
 *     processed: number,
 *     classified: number,
 *     skipped: number,
 *     errors: number,
 *     results: Array<{ mutationId, description, result, error? }>
 *   }
 */
expenseClassificationRouter.post("/classify/bulk", async (req, res) => {
  await ensureMigration();
  try {
    const parsed = BulkClassifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Input tidak valid",
        details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const { companyId, direction, onlyUnclassified, limit, useAi } = parsed.data;

    const summary = await bulkClassifyMutations({
      companyId,
      direction,
      onlyUnclassified,
      limit,
      useAi,
    });

    logger.info(
      { classified: summary.classified, processed: summary.processed, errors: summary.errors },
      "[POST /bank-recon/classify/bulk] done",
    );

    return res.json(summary);
  } catch (err: any) {
    logger.error({ err: err.message }, "[POST /bank-recon/classify/bulk] failed");
    return res.status(500).json({ error: "Gagal menjalankan bulk klasifikasi", detail: err.message });
  }
});

// ─── GET /bank-recon/classify/stats ──────────────────────────────────────────
/**
 * Statistik hasil klasifikasi pengeluaran per perusahaan.
 *
 * Query params:
 *   company_id?: number
 *   direction?: "IN" | "OUT"
 *
 * Response:
 *   {
 *     total: number,
 *     classified: number,
 *     unclassified: number,
 *     bySource: { normalizer, rule_engine, ai_classifier, unclassified },
 *     byCategory: Array<{ category, count, pct }>,
 *     aiCache: { size, max }
 *   }
 */
expenseClassificationRouter.get("/classify/stats", async (req, res) => {
  await ensureMigration();
  try {
    // Strict validation — prevent SQL injection via unvalidated query-string interpolation
    const companyIdRaw = req.query["company_id"];
    const companyId = companyIdRaw != null ? Number(companyIdRaw) : null;
    if (companyId !== null && (!Number.isInteger(companyId) || companyId <= 0)) {
      return res.status(400).json({ error: "company_id harus integer positif" });
    }

    const directionRaw = req.query["direction"];
    const VALID_DIRECTIONS = ["IN", "OUT"] as const;
    const direction = VALID_DIRECTIONS.includes(directionRaw as any)
      ? (directionRaw as "IN" | "OUT")
      : "OUT";

    // Safe interpolation: companyId is validated integer, direction is enum-checked
    const companyFilter = companyId != null ? `AND company_id = ${companyId}` : "";
    const dirFilter     = `AND direction = '${direction}'`;

    const [countRows, sourceRows, categoryRows] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          COUNT(*) AS total,
          COUNT(expense_category) AS classified,
          COUNT(*) FILTER (WHERE expense_category IS NULL) AS unclassified
        FROM bank_mutations
        WHERE 1=1 ${companyFilter} ${dirFilter}
      `)),
      db.execute(sql.raw(`
        SELECT
          expense_classification_source AS source,
          COUNT(*) AS count
        FROM bank_mutations
        WHERE expense_category IS NOT NULL ${companyFilter} ${dirFilter}
        GROUP BY expense_classification_source
        ORDER BY count DESC
      `)),
      db.execute(sql.raw(`
        SELECT
          expense_category AS category,
          COUNT(*) AS count,
          ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct
        FROM bank_mutations
        WHERE expense_category IS NOT NULL ${companyFilter} ${dirFilter}
        GROUP BY expense_category
        ORDER BY count DESC
        LIMIT 20
      `)),
    ]);

    const totals  = countRows.rows[0] as any;
    const sources: Record<string, number> = {};
    for (const row of sourceRows.rows as any[]) {
      sources[String(row.source ?? "unknown")] = Number(row.count);
    }

    return res.json({
      total:        Number(totals?.total    ?? 0),
      classified:   Number(totals?.classified ?? 0),
      unclassified: Number(totals?.unclassified ?? 0),
      bySource: {
        normalizer:    sources["normalizer"]    ?? 0,
        rule_engine:   sources["rule_engine"]   ?? 0,
        ai_classifier: sources["ai_classifier"] ?? 0,
        unclassified:  sources["unclassified"]  ?? 0,
      },
      byCategory: (categoryRows.rows as any[]).map(r => ({
        category: r.category,
        count:    Number(r.count),
        pct:      Number(r.pct ?? 0),
      })),
      aiCache: getAiClassifierCacheStats(),
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[GET /bank-recon/classify/stats] failed");
    return res.status(500).json({ error: "Gagal mengambil statistik klasifikasi" });
  }
});

// ─── POST /bank-recon/classify/test-ai ───────────────────────────────────────
/**
 * Test AI classifier secara langsung (layer 3 saja, tanpa rule engine).
 * Berguna untuk debug / kalibrasi prompt.
 *
 * Request body:
 *   { description: string, amount?: number, direction?: "IN" | "OUT" }
 *
 * Response:
 *   { input, normalization, aiResult }
 */
expenseClassificationRouter.post("/classify/test-ai", async (req, res) => {
  try {
    const parsed = TestAiSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Input tidak valid",
        details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const { description, amount, direction } = parsed.data;
    const norm = normalizeDescription(description);

    const aiResult = await classifyWithAi({
      rawDescription: description,
      norm,
      amount,
      direction,
    });

    return res.json({
      input: { description, amount, direction },
      normalization: norm,
      aiResult,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[POST /bank-recon/classify/test-ai] failed");
    return res.status(500).json({
      error: "AI classifier error",
      detail: err.message,
      hint: "Pastikan OPENAI_API_KEY sudah dikonfigurasi di environment secrets",
    });
  }
});

// ─── DELETE /bank-recon/classify/cache ───────────────────────────────────────
/**
 * Clear AI classifier cache (admin maintenance).
 */
expenseClassificationRouter.delete("/classify/cache", async (_req, res) => {
  clearAiClassifierCache();
  return res.json({ ok: true, message: "AI classifier cache dibersihkan" });
});
