/**
 * Settlement Pattern Engine — API Routes
 *
 * All routes under /api/settlement-patterns
 *
 * Patterns:
 *   GET    /                        — list patterns (filter: provider, status, company_id)
 *   POST   /                        — create pattern
 *   PATCH  /:id                     — update pattern
 *   DELETE /:id                     — soft-deactivate
 *   POST   /:id/activate            — reactivate
 *
 * Keywords:
 *   GET    /:id/keywords            — list keywords for a pattern
 *   POST   /:id/keywords            — add keyword
 *   PATCH  /keywords/:kwId          — update keyword
 *   DELETE /keywords/:kwId          — delete keyword
 *
 * Examples (AI Learning):
 *   GET    /:id/examples            — list examples
 *   POST   /:id/examples            — add example
 *   DELETE /examples/:exId          — delete example
 *
 * Tools:
 *   POST   /simulate                — test a description against all patterns
 *   POST   /simulate/batch          — test up to 200 descriptions (CSV tester)
 *   GET    /statistics              — dashboard stats
 *   POST   /seed                    — re-run seed migration
 *
 * Auth: requireAdmin on all routes.
 *
 * GUARDRAILS (do not violate):
 *   - Does NOT modify Accounting Engine, Universal Journal Reuse Engine,
 *     COA Governance, AI Governance, Posting Journal, or General Ledger.
 *   - No auto-posting. No auto-approve.
 *   - Simulate endpoints are read-only (no DB writes).
 */

import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import {
  runSettlementPatternMigration,
  resetMigrationFlag,
} from "../lib/settlementPatternMigration.js";
import {
  matchSettlementPattern,
  batchMatchSettlementPatterns,
  calculateSettlementAmounts,
  invalidatePatternCache,
} from "../lib/settlementPatternEngine.js";

export const settlementPatternsRouter = Router();

// ─── Auth guard ────────────────────────────────────────────────────────────────

settlementPatternsRouter.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Lazy migration ────────────────────────────────────────────────────────────

let migrationRan = false;
settlementPatternsRouter.use(async (_req, _res, next) => {
  if (!migrationRan) {
    await runSettlementPatternMigration().catch(err =>
      logger.error({ err }, "[settlementPatterns] migration failed"),
    );
    migrationRan = true;
  }
  next();
});

// ─── Input schemas ──────────────────────────────────────────────────────────────

const PatternSchema = z.object({
  companyId:           z.number().int().positive().nullable().optional(),
  code:                z.string().min(1).max(100),
  name:                z.string().min(1).max(200),
  provider:            z.string().min(1).max(100),
  patternType:         z.enum(["settlement", "refund", "chargeback"]).default("settlement"),
  matchStrategy:       z.enum(["ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE", "BATCH_SETTLEMENT"]).default("BATCH_SETTLEMENT"),
  priority:            z.number().int().min(0).max(999).default(50),
  merchantName:        z.string().max(200).nullable().optional(),
  merchantId:          z.string().max(100).nullable().optional(),
  terminalId:          z.string().max(100).nullable().optional(),
  bankName:            z.string().max(100).nullable().optional(),
  accountNumber:       z.string().max(50).nullable().optional(),
  currency:            z.string().length(3).default("IDR"),
  settlementDelayDays: z.number().int().min(0).max(30).default(1),
  grossMatching:       z.boolean().default(true),
  feeMatching:         z.boolean().default(false),
  feeAccountId:        z.number().int().positive().nullable().optional(),
  confidenceThreshold: z.number().min(0).max(1).default(0.80),
});

const KeywordSchema = z.object({
  keyword:   z.string().min(1).max(500),
  matchMode: z.enum(["contains", "starts_with", "ends_with", "equals", "regex"]).default("contains"),
  priority:  z.number().int().min(0).max(999).default(0),
});

const ExampleSchema = z.object({
  rawDescription:  z.string().min(1).max(2000),
  matchedProvider: z.string().max(100).nullable().optional(),
  matchedMerchant: z.string().max(200).nullable().optional(),
  grossAmount:     z.number().nullable().optional(),
  feeAmount:       z.number().nullable().optional(),
  netAmount:       z.number().nullable().optional(),
  matchConfidence: z.number().min(0).max(1).nullable().optional(),
  source:          z.enum(["user_confirmed", "ai_learned", "simulator"]).default("user_confirmed"),
});

const SimulateSchema = z.object({
  description: z.string().min(1).max(2000),
  amount:      z.number().nullable().optional(),
  companyId:   z.number().int().positive().nullable().optional(),
});

const SimulateBatchSchema = z.object({
  items: z.array(z.object({
    description: z.string().min(1),
    amount:      z.number().nullable().optional(),
    ref:         z.string().max(100).optional(),
  })).min(1).max(200),
  companyId: z.number().int().positive().nullable().optional(),
});

// ─── GET / — list patterns ─────────────────────────────────────────────────────

settlementPatternsRouter.get("/", async (req, res) => {
  try {
    const { provider, status, company_id, include_inactive } = req.query;

    const filters: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      filters.push(`status = $${idx++}`);
      params.push(status);
    } else if (!include_inactive) {
      filters.push(`status = $${idx++}`);
      params.push("active");
    }

    if (provider) {
      filters.push(`LOWER(provider) = LOWER($${idx++})`);
      params.push(provider);
    }

    if (company_id) {
      filters.push(`(company_id = $${idx++} OR company_id IS NULL)`);
      params.push(parseInt(company_id as string));
    } else {
      filters.push(`company_id IS NULL`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const queryStr = `
      SELECT p.*,
        (SELECT COUNT(*) FROM recon_settlement_pattern_keywords WHERE pattern_id = p.id) AS keyword_count,
        (SELECT COUNT(*) FROM recon_settlement_pattern_examples WHERE pattern_id = p.id) AS example_count
      FROM recon_settlement_patterns p
      ${where}
      ORDER BY p.priority ASC, p.id ASC
    `;

    const result = await db.execute(sql.raw(
      params.length ? queryStr.replace(/\$(\d+)/g, (_, n) => `'${params[parseInt(n) - 1]}'`) : queryStr,
    ));

    return res.json({ count: result.rows.length, data: result.rows });
  } catch (err) {
    logger.error({ err }, "[GET /settlement-patterns]");
    return res.status(500).json({ error: "Gagal memuat settlement patterns" });
  }
});

// ─── GET /:id — single pattern with keywords ────────────────────────────────

settlementPatternsRouter.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

    const [patternResult, kwResult, exResult] = await Promise.all([
      db.execute(sql`SELECT * FROM recon_settlement_patterns WHERE id = ${id}`),
      db.execute(sql`SELECT * FROM recon_settlement_pattern_keywords WHERE pattern_id = ${id} ORDER BY priority, id`),
      db.execute(sql`SELECT * FROM recon_settlement_pattern_examples WHERE pattern_id = ${id} ORDER BY created_at DESC LIMIT 50`),
    ]);

    if (!patternResult.rows.length) return res.status(404).json({ error: "Pattern tidak ditemukan" });

    return res.json({
      pattern: patternResult.rows[0],
      keywords: kwResult.rows,
      examples: exResult.rows,
    });
  } catch (err) {
    logger.error({ err }, "[GET /settlement-patterns/:id]");
    return res.status(500).json({ error: "Gagal memuat pattern" });
  }
});

// ─── POST / — create pattern ────────────────────────────────────────────────

settlementPatternsRouter.post("/", async (req, res) => {
  try {
    const parsed = PatternSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Input tidak valid", details: parsed.error.issues });
    }
    const d = parsed.data;

    const result = await db.execute<{ id: number }>(sql`
      INSERT INTO recon_settlement_patterns (
        company_id, code, name, provider, pattern_type, match_strategy,
        priority, merchant_name, merchant_id, terminal_id, bank_name,
        account_number, currency, settlement_delay_days, gross_matching,
        fee_matching, fee_account_id, confidence_threshold, status,
        created_by, updated_by
      ) VALUES (
        ${d.companyId ?? null}, ${d.code}, ${d.name}, ${d.provider},
        ${d.patternType}, ${d.matchStrategy}, ${d.priority},
        ${d.merchantName ?? null}, ${d.merchantId ?? null},
        ${d.terminalId ?? null}, ${d.bankName ?? null},
        ${d.accountNumber ?? null}, ${d.currency}, ${d.settlementDelayDays},
        ${d.grossMatching}, ${d.feeMatching}, ${d.feeAccountId ?? null},
        ${d.confidenceThreshold}, 'active',
        ${(req as any).user?.email ?? null}, ${(req as any).user?.email ?? null}
      )
      RETURNING id
    `);

    invalidatePatternCache(d.companyId);
    return res.status(201).json({ id: result.rows[0].id, message: "Pattern berhasil dibuat" });
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "Kode pattern sudah digunakan" });
    logger.error({ err }, "[POST /settlement-patterns]");
    return res.status(500).json({ error: "Gagal membuat pattern" });
  }
});

// ─── PATCH /:id — update pattern ────────────────────────────────────────────

settlementPatternsRouter.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

    const parsed = PatternSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Input tidak valid", details: parsed.error.issues });
    }
    const d = parsed.data;

    // Build dynamic update
    const setClauses: string[] = ["updated_at = NOW()"];
    if (d.name !== undefined)                setClauses.push(`name = '${d.name.replace(/'/g, "''")}'`);
    if (d.provider !== undefined)            setClauses.push(`provider = '${d.provider.replace(/'/g, "''")}'`);
    if (d.patternType !== undefined)         setClauses.push(`pattern_type = '${d.patternType}'`);
    if (d.matchStrategy !== undefined)       setClauses.push(`match_strategy = '${d.matchStrategy}'`);
    if (d.priority !== undefined)            setClauses.push(`priority = ${d.priority}`);
    if (d.merchantName !== undefined)        setClauses.push(`merchant_name = ${d.merchantName ? `'${d.merchantName.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.merchantId !== undefined)          setClauses.push(`merchant_id = ${d.merchantId ? `'${d.merchantId.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.terminalId !== undefined)          setClauses.push(`terminal_id = ${d.terminalId ? `'${d.terminalId.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.bankName !== undefined)            setClauses.push(`bank_name = ${d.bankName ? `'${d.bankName.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.accountNumber !== undefined)       setClauses.push(`account_number = ${d.accountNumber ? `'${d.accountNumber.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.currency !== undefined)            setClauses.push(`currency = '${d.currency}'`);
    if (d.settlementDelayDays !== undefined) setClauses.push(`settlement_delay_days = ${d.settlementDelayDays}`);
    if (d.grossMatching !== undefined)       setClauses.push(`gross_matching = ${d.grossMatching}`);
    if (d.feeMatching !== undefined)         setClauses.push(`fee_matching = ${d.feeMatching}`);
    if (d.feeAccountId !== undefined)        setClauses.push(`fee_account_id = ${d.feeAccountId ?? "NULL"}`);
    if (d.confidenceThreshold !== undefined) setClauses.push(`confidence_threshold = ${d.confidenceThreshold}`);

    await db.execute(sql.raw(`UPDATE recon_settlement_patterns SET ${setClauses.join(", ")} WHERE id = ${id}`));

    invalidatePatternCache(d.companyId);
    return res.json({ message: "Pattern berhasil diperbarui" });
  } catch (err) {
    logger.error({ err }, "[PATCH /settlement-patterns/:id]");
    return res.status(500).json({ error: "Gagal memperbarui pattern" });
  }
});

// ─── DELETE /:id — soft-deactivate ──────────────────────────────────────────

settlementPatternsRouter.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

    await db.execute(sql`
      UPDATE recon_settlement_patterns
      SET status = 'inactive', updated_at = NOW()
      WHERE id = ${id}
    `);

    invalidatePatternCache();
    return res.json({ message: "Pattern dinonaktifkan" });
  } catch (err) {
    logger.error({ err }, "[DELETE /settlement-patterns/:id]");
    return res.status(500).json({ error: "Gagal menonaktifkan pattern" });
  }
});

// ─── POST /:id/activate ─────────────────────────────────────────────────────

settlementPatternsRouter.post("/:id/activate", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

    await db.execute(sql`
      UPDATE recon_settlement_patterns
      SET status = 'active', updated_at = NOW()
      WHERE id = ${id}
    `);

    invalidatePatternCache();
    return res.json({ message: "Pattern diaktifkan" });
  } catch (err) {
    logger.error({ err }, "[POST /settlement-patterns/:id/activate]");
    return res.status(500).json({ error: "Gagal mengaktifkan pattern" });
  }
});

// ─── GET /:id/keywords ───────────────────────────────────────────────────────

settlementPatternsRouter.get("/:id/keywords", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

    const result = await db.execute(sql`
      SELECT * FROM recon_settlement_pattern_keywords
      WHERE pattern_id = ${id}
      ORDER BY priority ASC, id ASC
    `);

    return res.json({ count: result.rows.length, data: result.rows });
  } catch (err) {
    logger.error({ err }, "[GET /settlement-patterns/:id/keywords]");
    return res.status(500).json({ error: "Gagal memuat keywords" });
  }
});

// ─── POST /:id/keywords ──────────────────────────────────────────────────────

settlementPatternsRouter.post("/:id/keywords", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

    const parsed = KeywordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Input tidak valid", details: parsed.error.issues });
    }
    const d = parsed.data;

    const result = await db.execute<{ id: number }>(sql`
      INSERT INTO recon_settlement_pattern_keywords (pattern_id, keyword, match_mode, priority)
      VALUES (${id}, ${d.keyword}, ${d.matchMode}, ${d.priority})
      RETURNING id
    `);

    invalidatePatternCache();
    return res.status(201).json({ id: result.rows[0].id, message: "Keyword berhasil ditambahkan" });
  } catch (err) {
    logger.error({ err }, "[POST /settlement-patterns/:id/keywords]");
    return res.status(500).json({ error: "Gagal menambahkan keyword" });
  }
});

// ─── PATCH /keywords/:kwId ───────────────────────────────────────────────────

settlementPatternsRouter.patch("/keywords/:kwId", async (req, res) => {
  try {
    const kwId = parseInt(req.params.kwId);
    if (isNaN(kwId)) return res.status(400).json({ error: "ID tidak valid" });

    const parsed = KeywordSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Input tidak valid", details: parsed.error.issues });
    }
    const d = parsed.data;

    const sets: string[] = [];
    if (d.keyword   !== undefined) sets.push(`keyword = '${d.keyword.replace(/'/g, "''")}'`);
    if (d.matchMode !== undefined) sets.push(`match_mode = '${d.matchMode}'`);
    if (d.priority  !== undefined) sets.push(`priority = ${d.priority}`);

    if (sets.length === 0) return res.status(400).json({ error: "Tidak ada field yang diperbarui" });

    await db.execute(sql.raw(`UPDATE recon_settlement_pattern_keywords SET ${sets.join(", ")} WHERE id = ${kwId}`));

    invalidatePatternCache();
    return res.json({ message: "Keyword diperbarui" });
  } catch (err) {
    logger.error({ err }, "[PATCH /settlement-patterns/keywords/:kwId]");
    return res.status(500).json({ error: "Gagal memperbarui keyword" });
  }
});

// ─── DELETE /keywords/:kwId ──────────────────────────────────────────────────

settlementPatternsRouter.delete("/keywords/:kwId", async (req, res) => {
  try {
    const kwId = parseInt(req.params.kwId);
    if (isNaN(kwId)) return res.status(400).json({ error: "ID tidak valid" });

    await db.execute(sql`DELETE FROM recon_settlement_pattern_keywords WHERE id = ${kwId}`);

    invalidatePatternCache();
    return res.json({ message: "Keyword dihapus" });
  } catch (err) {
    logger.error({ err }, "[DELETE /settlement-patterns/keywords/:kwId]");
    return res.status(500).json({ error: "Gagal menghapus keyword" });
  }
});

// ─── GET /:id/examples ───────────────────────────────────────────────────────

settlementPatternsRouter.get("/:id/examples", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

    const result = await db.execute(sql`
      SELECT * FROM recon_settlement_pattern_examples
      WHERE pattern_id = ${id}
      ORDER BY created_at DESC
      LIMIT 100
    `);

    return res.json({ count: result.rows.length, data: result.rows });
  } catch (err) {
    logger.error({ err }, "[GET /settlement-patterns/:id/examples]");
    return res.status(500).json({ error: "Gagal memuat examples" });
  }
});

// ─── POST /:id/examples ──────────────────────────────────────────────────────

settlementPatternsRouter.post("/:id/examples", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

    const parsed = ExampleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Input tidak valid", details: parsed.error.issues });
    }
    const d = parsed.data;

    // Calculate amounts if possible
    const amounts = calculateSettlementAmounts({
      grossAmount: d.grossAmount ?? undefined,
      netAmount:   d.netAmount   ?? undefined,
      feeAmount:   d.feeAmount   ?? undefined,
    });

    const result = await db.execute<{ id: number }>(sql`
      INSERT INTO recon_settlement_pattern_examples
        (pattern_id, raw_description, matched_provider, matched_merchant,
         gross_amount, fee_amount, net_amount, match_confidence, source)
      VALUES (
        ${id}, ${d.rawDescription}, ${d.matchedProvider ?? null},
        ${d.matchedMerchant ?? null},
        ${amounts?.gross ?? d.grossAmount ?? null},
        ${amounts?.fee   ?? d.feeAmount   ?? null},
        ${amounts?.net   ?? d.netAmount   ?? null},
        ${d.matchConfidence ?? null}, ${d.source}
      )
      RETURNING id
    `);

    return res.status(201).json({ id: result.rows[0].id, message: "Example berhasil disimpan" });
  } catch (err) {
    logger.error({ err }, "[POST /settlement-patterns/:id/examples]");
    return res.status(500).json({ error: "Gagal menyimpan example" });
  }
});

// ─── DELETE /examples/:exId ──────────────────────────────────────────────────

settlementPatternsRouter.delete("/examples/:exId", async (req, res) => {
  try {
    const exId = parseInt(req.params.exId);
    if (isNaN(exId)) return res.status(400).json({ error: "ID tidak valid" });

    await db.execute(sql`DELETE FROM recon_settlement_pattern_examples WHERE id = ${exId}`);

    return res.json({ message: "Example dihapus" });
  } catch (err) {
    logger.error({ err }, "[DELETE /settlement-patterns/examples/:exId]");
    return res.status(500).json({ error: "Gagal menghapus example" });
  }
});

// ─── POST /simulate — single simulation ────────────────────────────────────

settlementPatternsRouter.post("/simulate", async (req, res) => {
  try {
    const parsed = SimulateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Input tidak valid", details: parsed.error.issues });
    }
    const { description, companyId } = parsed.data;

    const result = await matchSettlementPattern(description, companyId);

    logger.debug({ description: description.slice(0, 80), matched: result.matched }, "[simulate]");

    return res.json({
      input: { description, companyId },
      result: {
        matched:             result.matched,
        patternName:         result.pattern?.name ?? null,
        patternCode:         result.pattern?.code ?? null,
        provider:            result.provider,
        matchStrategy:       result.matchStrategy,
        settlementDelayDays: result.settlementDelayDays,
        grossMatching:       result.grossMatching,
        feeMatching:         result.feeMatching,
        confidence:          result.confidence,
        confidencePct:       Math.round(result.confidence * 100),
        matchedKeywords:     result.matchedKeywords,
        debugInfo:           result.debugInfo,
      },
    });
  } catch (err) {
    logger.error({ err }, "[POST /settlement-patterns/simulate]");
    return res.status(500).json({ error: "Simulasi gagal" });
  }
});

// ─── POST /simulate/batch — batch simulation (CSV tester) ──────────────────

settlementPatternsRouter.post("/simulate/batch", async (req, res) => {
  try {
    const parsed = SimulateBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Input tidak valid", details: parsed.error.issues });
    }
    const { items, companyId } = parsed.data;

    const results = await batchMatchSettlementPatterns(items, companyId);

    const summary = {
      total:       results.length,
      matched:     results.filter(r => r.matched).length,
      unmatched:   results.filter(r => !r.matched).length,
      avgConfidence: results.length
        ? Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length * 100)
        : 0,
    };

    return res.json({
      summary,
      results: results.map(r => ({
        description:     r.input.description.slice(0, 120),
        ref:             (r.input as any).ref ?? null,
        matched:         r.matched,
        provider:        r.provider,
        patternName:     r.pattern?.name ?? null,
        matchStrategy:   r.matchStrategy,
        confidencePct:   Math.round(r.confidence * 100),
        matchedKeywords: r.matchedKeywords,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[POST /settlement-patterns/simulate/batch]");
    return res.status(500).json({ error: "Simulasi batch gagal" });
  }
});

// ─── GET /statistics — dashboard stats ─────────────────────────────────────

settlementPatternsRouter.get("/statistics", async (req, res) => {
  try {
    const { company_id } = req.query;
    const companyFilter = company_id
      ? `(company_id = ${parseInt(company_id as string)} OR company_id IS NULL)`
      : `company_id IS NULL`;

    const [patternStats, kwStats, exStats] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')   AS active_patterns,
          COUNT(*) FILTER (WHERE status = 'inactive') AS inactive_patterns,
          SUM(usage_count)                             AS total_usage,
          COUNT(DISTINCT provider)                     AS provider_count
        FROM recon_settlement_patterns
        WHERE ${companyFilter}
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) AS keyword_count
        FROM recon_settlement_pattern_keywords kw
        JOIN recon_settlement_patterns p ON p.id = kw.pattern_id
        WHERE p.${companyFilter}
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) AS example_count
        FROM recon_settlement_pattern_examples ex
        JOIN recon_settlement_patterns p ON p.id = ex.pattern_id
        WHERE p.${companyFilter}
      `)),
    ]);

    // Most used patterns
    const topPatternsResult = await db.execute(sql.raw(`
      SELECT name, provider, usage_count, match_strategy
      FROM recon_settlement_patterns
      WHERE ${companyFilter} AND status = 'active'
      ORDER BY usage_count DESC
      LIMIT 10
    `));

    // Provider breakdown
    const providerResult = await db.execute(sql.raw(`
      SELECT provider, COUNT(*) AS pattern_count, SUM(usage_count) AS total_usage
      FROM recon_settlement_patterns
      WHERE ${companyFilter} AND status = 'active'
      GROUP BY provider
      ORDER BY total_usage DESC
    `));

    return res.json({
      summary: {
        ...patternStats.rows[0],
        keyword_count: kwStats.rows[0]?.keyword_count ?? 0,
        example_count: exStats.rows[0]?.example_count ?? 0,
      },
      topPatterns:  topPatternsResult.rows,
      byProvider:   providerResult.rows,
    });
  } catch (err) {
    logger.error({ err }, "[GET /settlement-patterns/statistics]");
    return res.status(500).json({ error: "Gagal memuat statistik" });
  }
});

// ─── POST /seed — re-run seed migration ────────────────────────────────────

settlementPatternsRouter.post("/seed", async (req, res) => {
  try {
    resetMigrationFlag();
    migrationRan = false;
    await runSettlementPatternMigration();
    migrationRan = true;
    invalidatePatternCache();
    return res.json({ message: "Seed migration berhasil dijalankan ulang" });
  } catch (err) {
    logger.error({ err }, "[POST /settlement-patterns/seed]");
    return res.status(500).json({ error: "Seed migration gagal" });
  }
});
