/**
 * Settlement Pattern Engine — DB Migration + Seed
 *
 * Creates 3 tables and seeds default patterns for 15 payment providers.
 *
 * Idempotency contract:
 *   - DDL uses IF NOT EXISTS — safe to re-run.
 *   - Seed inserts use ON CONFLICT DO NOTHING — no duplicate rows.
 *   - `migrated` flag is set ONLY after all DB work succeeds.
 *
 * GUARDRAILS:
 *   - Does NOT modify Accounting Engine, Universal Journal Reuse Engine,
 *     COA Governance, AI Governance, Posting Journal, or General Ledger.
 *   - COA fee_account_id is NULL in seeds (configured by admin per company).
 *   - No auto-posting, no auto-approve.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

let migrated = false;

// ─── DDL ─────────────────────────────────────────────────────────────────────

async function runDDL(): Promise<void> {
  // Table 1: recon_settlement_patterns
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "recon_settlement_patterns" (
      "id"                    SERIAL PRIMARY KEY,
      "company_id"            INTEGER,
      "code"                  TEXT NOT NULL,
      "name"                  TEXT NOT NULL,
      "provider"              TEXT NOT NULL,
      "pattern_type"          TEXT NOT NULL DEFAULT 'settlement',
      "match_strategy"        TEXT NOT NULL DEFAULT 'BATCH_SETTLEMENT',
      "priority"              INTEGER NOT NULL DEFAULT 50,
      "status"                TEXT NOT NULL DEFAULT 'active',
      "merchant_name"         TEXT,
      "merchant_id"           TEXT,
      "terminal_id"           TEXT,
      "bank_name"             TEXT,
      "account_number"        TEXT,
      "currency"              TEXT NOT NULL DEFAULT 'IDR',
      "settlement_delay_days" INTEGER NOT NULL DEFAULT 1,
      "gross_matching"        BOOLEAN NOT NULL DEFAULT TRUE,
      "fee_matching"          BOOLEAN NOT NULL DEFAULT FALSE,
      "fee_account_id"        INTEGER,
      "confidence_threshold"  NUMERIC(4,2) NOT NULL DEFAULT 0.80,
      "is_seed"               BOOLEAN NOT NULL DEFAULT FALSE,
      "usage_count"           INTEGER NOT NULL DEFAULT 0,
      "created_by"            TEXT,
      "updated_by"            TEXT,
      "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "rsp_company_code_idx"
      ON "recon_settlement_patterns" ("company_id", "code")
      WHERE "company_id" IS NOT NULL
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "rsp_global_code_idx"
      ON "recon_settlement_patterns" ("code")
      WHERE "company_id" IS NULL
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rsp_provider_status_idx"
      ON "recon_settlement_patterns" ("provider", "status")
  `);

  // Table 2: recon_settlement_pattern_keywords
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "recon_settlement_pattern_keywords" (
      "id"         SERIAL PRIMARY KEY,
      "pattern_id" INTEGER NOT NULL REFERENCES "recon_settlement_patterns"("id") ON DELETE CASCADE,
      "keyword"    TEXT NOT NULL,
      "match_mode" TEXT NOT NULL DEFAULT 'contains',
      "priority"   INTEGER NOT NULL DEFAULT 0,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rspk_pattern_idx"
      ON "recon_settlement_pattern_keywords" ("pattern_id")
  `);

  // Table 3: recon_settlement_pattern_examples
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "recon_settlement_pattern_examples" (
      "id"               SERIAL PRIMARY KEY,
      "pattern_id"       INTEGER NOT NULL REFERENCES "recon_settlement_patterns"("id") ON DELETE CASCADE,
      "raw_description"  TEXT NOT NULL,
      "matched_provider" TEXT,
      "matched_merchant" TEXT,
      "gross_amount"     NUMERIC(18,2),
      "fee_amount"       NUMERIC(18,2),
      "net_amount"       NUMERIC(18,2),
      "match_confidence" NUMERIC(4,2),
      "source"           TEXT NOT NULL DEFAULT 'user_confirmed',
      "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "rspe_pattern_idx"
      ON "recon_settlement_pattern_examples" ("pattern_id")
  `);
}

// ─── Seed data ────────────────────────────────────────────────────────────────

interface SeedPattern {
  code: string;
  name: string;
  provider: string;
  patternType: string;
  matchStrategy: string;
  priority: number;
  settlementDelayDays: number;
  grossMatching: boolean;
  feeMatching: boolean;
  keywords: Array<{ keyword: string; matchMode: string; priority: number }>;
}

const SEED_PATTERNS: SeedPattern[] = [
  // ── QRIS ────────────────────────────────────────────────────────────────
  {
    code: "QRIS_TRAVELINTRIPS",
    name: "QRIS Travelintrips",
    provider: "QRIS",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 10,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "QRTRAVELI", matchMode: "contains", priority: 0 },
      { keyword: "QRIS", matchMode: "contains", priority: 1 },
      { keyword: "7177.*", matchMode: "regex", priority: 2 },
    ],
  },
  {
    code: "QRIS_GENERIC",
    name: "QRIS Generic",
    provider: "QRIS",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 20,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "QRIS", matchMode: "contains", priority: 0 },
      { keyword: "QR CODE", matchMode: "contains", priority: 1 },
      { keyword: "SETLE QRIS", matchMode: "contains", priority: 2 },
    ],
  },

  // ── Midtrans ─────────────────────────────────────────────────────────────
  {
    code: "MIDTRANS",
    name: "Midtrans Settlement",
    provider: "Midtrans",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 15,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "MIDTRANS", matchMode: "contains", priority: 0 },
      { keyword: "MDTRANS", matchMode: "contains", priority: 1 },
      { keyword: "MT-SETTLE", matchMode: "contains", priority: 2 },
    ],
  },

  // ── Xendit ───────────────────────────────────────────────────────────────
  {
    code: "XENDIT",
    name: "Xendit Settlement",
    provider: "Xendit",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 15,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "XENDIT", matchMode: "contains", priority: 0 },
      { keyword: "XEN-SETTLE", matchMode: "contains", priority: 1 },
      { keyword: "PT SINAR DIGITAL", matchMode: "contains", priority: 2 },
    ],
  },

  // ── Paylabs ───────────────────────────────────────────────────────────────
  {
    code: "PAYLABS",
    name: "Paylabs Settlement",
    provider: "Paylabs",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 15,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "PAYLABS", matchMode: "contains", priority: 0 },
      { keyword: "PALAB", matchMode: "contains", priority: 1 },
      { keyword: "PT MONETRA", matchMode: "contains", priority: 2 },
    ],
  },

  // ── DOKU ─────────────────────────────────────────────────────────────────
  {
    code: "DOKU",
    name: "DOKU Settlement",
    provider: "DOKU",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 15,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "DOKU", matchMode: "contains", priority: 0 },
      { keyword: "PT NUSA SAT", matchMode: "contains", priority: 1 },
      { keyword: "DOKU WALLET", matchMode: "contains", priority: 2 },
    ],
  },

  // ── OVO ──────────────────────────────────────────────────────────────────
  {
    code: "OVO",
    name: "OVO Settlement",
    provider: "OVO",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 20,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "OVO", matchMode: "contains", priority: 0 },
      { keyword: "PT VISIONET", matchMode: "contains", priority: 1 },
      { keyword: "SETLE OVO", matchMode: "contains", priority: 2 },
    ],
  },

  // ── GoPay ─────────────────────────────────────────────────────────────────
  {
    code: "GOPAY",
    name: "GoPay Settlement",
    provider: "GoPay",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 20,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "GOPAY", matchMode: "contains", priority: 0 },
      { keyword: "GO-PAY", matchMode: "contains", priority: 1 },
      { keyword: "PT DOMPET ANAK", matchMode: "contains", priority: 2 },
      { keyword: "GOJEK", matchMode: "contains", priority: 3 },
    ],
  },

  // ── ShopeePay ─────────────────────────────────────────────────────────────
  {
    code: "SHOPEE_PAY",
    name: "ShopeePay Settlement",
    provider: "ShopeePay",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 20,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "SHOPEEPAY", matchMode: "contains", priority: 0 },
      { keyword: "SHOPEE PAY", matchMode: "contains", priority: 1 },
      { keyword: "SEAINDONESIA", matchMode: "contains", priority: 2 },
      { keyword: "PT AIRPAY", matchMode: "contains", priority: 3 },
    ],
  },

  // ── Dana ──────────────────────────────────────────────────────────────────
  {
    code: "DANA",
    name: "DANA Settlement",
    provider: "DANA",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 20,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "DANA", matchMode: "contains", priority: 0 },
      { keyword: "PT ESPAY DEBIT", matchMode: "contains", priority: 1 },
      { keyword: "SETLE DANA", matchMode: "contains", priority: 2 },
    ],
  },

  // ── LinkAja ───────────────────────────────────────────────────────────────
  {
    code: "LINK_AJA",
    name: "LinkAja Settlement",
    provider: "LinkAja",
    patternType: "settlement",
    matchStrategy: "BATCH_SETTLEMENT",
    priority: 20,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "LINKAJA", matchMode: "contains", priority: 0 },
      { keyword: "LINK AJA", matchMode: "contains", priority: 1 },
      { keyword: "TELKOMSEL HALO", matchMode: "contains", priority: 2 },
      { keyword: "PT FINTEK KARYA", matchMode: "contains", priority: 3 },
    ],
  },

  // ── BCA EDC ──────────────────────────────────────────────────────────────
  {
    code: "BCA_EDC",
    name: "BCA EDC Settlement",
    provider: "BCA EDC",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 25,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "BCA EDC", matchMode: "contains", priority: 0 },
      { keyword: "EDC BCA", matchMode: "contains", priority: 1 },
      { keyword: "SETLE EDC BCA", matchMode: "contains", priority: 2 },
      { keyword: "SETTLE BCA", matchMode: "contains", priority: 3 },
    ],
  },

  // ── Mandiri EDC ──────────────────────────────────────────────────────────
  {
    code: "MANDIRI_EDC",
    name: "Mandiri EDC Settlement",
    provider: "Mandiri EDC",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 25,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "MANDIRI EDC", matchMode: "contains", priority: 0 },
      { keyword: "EDC MANDIRI", matchMode: "contains", priority: 1 },
      { keyword: "SETLE EDC MANDIRI", matchMode: "contains", priority: 2 },
      { keyword: "DEBIT MANDIRI", matchMode: "contains", priority: 3 },
    ],
  },

  // ── BNI EDC ──────────────────────────────────────────────────────────────
  {
    code: "BNI_EDC",
    name: "BNI EDC Settlement",
    provider: "BNI EDC",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 25,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "BNI EDC", matchMode: "contains", priority: 0 },
      { keyword: "EDC BNI", matchMode: "contains", priority: 1 },
      { keyword: "DEBIT BNI", matchMode: "contains", priority: 2 },
    ],
  },

  // ── BRI EDC ──────────────────────────────────────────────────────────────
  {
    code: "BRI_EDC",
    name: "BRI EDC Settlement",
    provider: "BRI EDC",
    patternType: "settlement",
    matchStrategy: "ONE_TO_MANY",
    priority: 25,
    settlementDelayDays: 1,
    grossMatching: true,
    feeMatching: true,
    keywords: [
      { keyword: "BRI EDC", matchMode: "contains", priority: 0 },
      { keyword: "EDC BRI", matchMode: "contains", priority: 1 },
      { keyword: "DEBIT BRI", matchMode: "contains", priority: 2 },
    ],
  },

  // ── Virtual Account ──────────────────────────────────────────────────────
  {
    code: "VIRTUAL_ACCOUNT",
    name: "Virtual Account Settlement",
    provider: "Virtual Account",
    patternType: "settlement",
    matchStrategy: "ONE_TO_ONE",
    priority: 30,
    settlementDelayDays: 0,
    grossMatching: true,
    feeMatching: false,
    keywords: [
      { keyword: "VIRTUAL ACCOUNT", matchMode: "contains", priority: 0 },
      { keyword: "VA ", matchMode: "contains", priority: 1 },
      { keyword: " VA", matchMode: "contains", priority: 2 },
      { keyword: "TRANSFER VA", matchMode: "contains", priority: 3 },
      { keyword: "BAYAR VA", matchMode: "contains", priority: 4 },
    ],
  },
];

// ─── Seed executor ────────────────────────────────────────────────────────────

async function runSeed(): Promise<void> {
  for (const sp of SEED_PATTERNS) {
    // Insert pattern (ON CONFLICT DO NOTHING on global code unique index)
    const result = await db.execute<{ id: number }>(sql`
      INSERT INTO recon_settlement_patterns
        (code, name, provider, pattern_type, match_strategy, priority,
         settlement_delay_days, gross_matching, fee_matching,
         confidence_threshold, is_seed, status)
      VALUES (
        ${sp.code}, ${sp.name}, ${sp.provider}, ${sp.patternType},
        ${sp.matchStrategy}, ${sp.priority}, ${sp.settlementDelayDays},
        ${sp.grossMatching}, ${sp.feeMatching}, 0.80, TRUE, 'active'
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);

    if (!result.rows.length) continue; // already seeded

    const patternId = result.rows[0].id;

    // Insert keywords for this pattern
    for (const kw of sp.keywords) {
      await db.execute(sql`
        INSERT INTO recon_settlement_pattern_keywords (pattern_id, keyword, match_mode, priority)
        VALUES (${patternId}, ${kw.keyword}, ${kw.matchMode}, ${kw.priority})
        ON CONFLICT DO NOTHING
      `);
    }
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runSettlementPatternMigration(): Promise<void> {
  if (migrated) return;
  try {
    await runDDL();
    await runSeed();
    migrated = true;
    logger.info("[settlementPatternMigration] tables + seed complete");
  } catch (err) {
    logger.error({ err }, "[settlementPatternMigration] FAILED");
    throw err;
  }
}

export function resetMigrationFlag(): void {
  migrated = false;
}
