/**
 * Bank Reconciliation Classification Configuration — DB Migration + Seed
 *
 * Creates 4 tables and seeds default Business Transaction Types and
 * Routine Expense Types as is_seed=true rows.
 *
 * Idempotency contract:
 *   - DDL uses IF NOT EXISTS — safe to re-run.
 *   - Seed inserts use ON CONFLICT DO NOTHING — no duplicate rows.
 *   - `migrated` flag is set ONLY after all DB work succeeds.
 *
 * Constraints:
 *   - COA IDs are NEVER stored — only coa_code text references.
 *   - Accounting engine is NOT modified.
 *   - Universal Journal Reuse Engine is NOT modified.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

let migrated = false;

// ─── Seed data ─────────────────────────────────────────────────────────────────

interface SeedConfig {
  category: string;
  name: string;
  code: string;
  type: string;
  flow: string;
  keywords: string[];
  priority: number;
}

const BUSINESS_TRANSACTION_SEEDS: SeedConfig[] = [
  { category: "BUSINESS_TRANSACTION", name: "Customer Payment",  code: "CUSTOMER_PAYMENT",  type: "income",   flow: "BUSINESS_MATCHING", keywords: ["pembayaran pelanggan", "customer payment", "bayar invoice"],                    priority: 10 },
  { category: "BUSINESS_TRANSACTION", name: "Vendor Payment",    code: "VENDOR_PAYMENT",    type: "expense",  flow: "BUSINESS_MATCHING", keywords: ["pembayaran vendor", "vendor payment", "bayar supplier", "pelunasan po"],         priority: 10 },
  { category: "BUSINESS_TRANSACTION", name: "Sales Invoice",     code: "SALES_INVOICE",     type: "income",   flow: "BUSINESS_MATCHING", keywords: ["invoice penjualan", "sales invoice", "tagihan"],                                 priority: 20 },
  { category: "BUSINESS_TRANSACTION", name: "Purchase Invoice",  code: "PURCHASE_INVOICE",  type: "expense",  flow: "BUSINESS_MATCHING", keywords: ["invoice pembelian", "purchase invoice", "faktur pembelian"],                     priority: 20 },
  { category: "BUSINESS_TRANSACTION", name: "Sport Center",      code: "SPORT_CENTER",      type: "income",   flow: "BUSINESS_MATCHING", keywords: ["sport center", "lapangan", "booking lapangan", "sewa lapangan"],                 priority: 30 },
  { category: "BUSINESS_TRANSACTION", name: "Tenant",            code: "TENANT",            type: "income",   flow: "BUSINESS_MATCHING", keywords: ["sewa tenant", "rental tenant", "uang sewa"],                                     priority: 30 },
  { category: "BUSINESS_TRANSACTION", name: "Logistic",          code: "LOGISTIC",          type: "income",   flow: "BUSINESS_MATCHING", keywords: ["logistik", "pengiriman", "ongkos kirim", "freight"],                             priority: 30 },
  { category: "BUSINESS_TRANSACTION", name: "PPJK",              code: "PPJK",              type: "income",   flow: "BUSINESS_MATCHING", keywords: ["ppjk", "kepabeanan", "bea cukai", "customs"],                                    priority: 30 },
  { category: "BUSINESS_TRANSACTION", name: "Payroll",           code: "PAYROLL",           type: "expense",  flow: "BUSINESS_MATCHING", keywords: ["gaji", "payroll", "thr", "honor", "upah"],                                      priority: 20 },
  { category: "BUSINESS_TRANSACTION", name: "Loan",              code: "LOAN",              type: "neutral",  flow: "BUSINESS_MATCHING", keywords: ["pinjaman", "loan", "cicilan", "angsuran", "kredit"],                             priority: 40 },
  { category: "BUSINESS_TRANSACTION", name: "Treasury",          code: "TREASURY",          type: "neutral",  flow: "BUSINESS_MATCHING", keywords: ["treasury", "kas", "deposito", "investasi"],                                      priority: 40 },
  { category: "BUSINESS_TRANSACTION", name: "Dana Talangan",     code: "DANA_TALANGAN",     type: "expense",  flow: "BUSINESS_MATCHING", keywords: ["dana talangan", "talangan", "pinjaman karyawan", "kasbon"],                      priority: 40 },
  { category: "BUSINESS_TRANSACTION", name: "Payment Gateway",   code: "PAYMENT_GATEWAY",   type: "income",   flow: "BUSINESS_MATCHING", keywords: ["payment gateway", "midtrans", "paylabs", "xendit", "doku", "settlement"],        priority: 30 },
];

const ROUTINE_EXPENSE_SEEDS: SeedConfig[] = [
  { category: "ROUTINE_EXPENSE", name: "Biaya Administrasi Bank",  code: "BANK_ADMIN_FEE",       type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["biaya admin", "biaya administrasi", "adm rekening", "monthly fee"],          priority: 10 },
  { category: "ROUTINE_EXPENSE", name: "Pajak Bank",               code: "BANK_TAX",             type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["pajak bank", "pph bunga", "tax bank"],                                       priority: 10 },
  { category: "ROUTINE_EXPENSE", name: "PPh Final Bunga Bank",     code: "PPH_FINAL_INTEREST",   type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["pph final", "pajak bunga", "pph bunga deposito", "interest tax"],            priority: 10 },
  { category: "ROUTINE_EXPENSE", name: "Bunga Bank",               code: "BANK_INTEREST",        type: "income",  flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["bunga bank", "jasa giro", "bunga tabungan", "interest income"],             priority: 10 },
  { category: "ROUTINE_EXPENSE", name: "PLN",                      code: "PLN",                  type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["pln", "listrik", "electricity", "token listrik"],                            priority: 20 },
  { category: "ROUTINE_EXPENSE", name: "PDAM",                     code: "PDAM",                 type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["pdam", "air", "water", "tagihan air"],                                       priority: 20 },
  { category: "ROUTINE_EXPENSE", name: "Internet",                 code: "INTERNET",             type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["internet", "wifi", "broadband", "indihome", "biznet"],                       priority: 20 },
  { category: "ROUTINE_EXPENSE", name: "Telepon",                  code: "TELEPON",              type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["telepon", "telephone", "pulsa", "handphone", "komunikasi"],                  priority: 20 },
  { category: "ROUTINE_EXPENSE", name: "Hosting",                  code: "HOSTING",              type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["hosting", "server", "vps", "cloud hosting"],                                 priority: 30 },
  { category: "ROUTINE_EXPENSE", name: "Cloud",                    code: "CLOUD",                type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["cloud", "aws", "gcp", "azure", "google cloud"],                              priority: 30 },
  { category: "ROUTINE_EXPENSE", name: "Domain",                   code: "DOMAIN",               type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["domain", "subdomain", "registrar"],                                          priority: 30 },
  { category: "ROUTINE_EXPENSE", name: "Biaya Transfer",           code: "TRANSFER_FEE",         type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["biaya transfer", "transfer fee", "ongkos transfer"],                         priority: 10 },
  { category: "ROUTINE_EXPENSE", name: "RTGS",                     code: "RTGS",                 type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["rtgs", "biaya rtgs", "real time gross settlement"],                          priority: 10 },
  { category: "ROUTINE_EXPENSE", name: "BI Fast",                  code: "BI_FAST",              type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["bi fast", "bifast", "bi-fast"],                                              priority: 10 },
  { category: "ROUTINE_EXPENSE", name: "Materai",                  code: "STAMP_DUTY",           type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["materai", "bea materai", "e-meterai", "stamp duty"],                        priority: 30 },
  { category: "ROUTINE_EXPENSE", name: "Asuransi",                 code: "INSURANCE",            type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["asuransi", "insurance", "premi", "polis"],                                   priority: 40 },
  { category: "ROUTINE_EXPENSE", name: "Sewa",                     code: "RENT",                 type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["sewa", "rental", "kontrak", "lease"],                                        priority: 40 },
  { category: "ROUTINE_EXPENSE", name: "Maintenance",              code: "MAINTENANCE",          type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["maintenance", "pemeliharaan", "service", "perbaikan"],                       priority: 40 },
  { category: "ROUTINE_EXPENSE", name: "Cleaning Service",         code: "CLEANING_SERVICE",     type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["cleaning service", "kebersihan", "cleaning"],                                 priority: 50 },
  { category: "ROUTINE_EXPENSE", name: "Office Supplies",          code: "OFFICE_SUPPLIES",      type: "expense", flow: "ROUTINE_EXPENSE_ALLOCATION", keywords: ["alat tulis", "atk", "office supplies", "perlengkapan kantor"],               priority: 50 },
];

// ─── Migration ─────────────────────────────────────────────────────────────────

export async function runReconClassificationMigration(): Promise<void> {
  if (migrated) return;

  logger.info("[ReconClassificationMigration] Starting…");

  // ── Table 1: recon_classification_configs ──────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_classification_configs (
      id                    SERIAL PRIMARY KEY,
      company_id            INTEGER,
      category              TEXT NOT NULL,
      name                  TEXT NOT NULL,
      code                  TEXT NOT NULL,
      type                  TEXT,
      flow                  TEXT NOT NULL DEFAULT 'MANUAL_REVIEW',
      default_coa_code      TEXT,
      default_vendor_id     INTEGER,
      default_department    TEXT,
      default_cost_center   TEXT,
      need_upload           TEXT NOT NULL DEFAULT 'none',
      upload_file_types     JSONB NOT NULL DEFAULT '[]',
      upload_max_files      INTEGER DEFAULT 5,
      upload_max_size_mb    INTEGER DEFAULT 10,
      need_approval         BOOLEAN NOT NULL DEFAULT FALSE,
      need_invoice_number   BOOLEAN NOT NULL DEFAULT FALSE,
      need_reference_number BOOLEAN NOT NULL DEFAULT FALSE,
      ai_learning_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
      confidence_threshold  NUMERIC(4,2) DEFAULT 0.75,
      keywords              JSONB NOT NULL DEFAULT '[]',
      regex_pattern         TEXT,
      priority              INTEGER NOT NULL DEFAULT 50,
      is_active             BOOLEAN NOT NULL DEFAULT TRUE,
      is_seed               BOOLEAN NOT NULL DEFAULT FALSE,
      usage_count           INTEGER NOT NULL DEFAULT 0,
      created_by            TEXT,
      updated_by            TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS rcc_company_category_idx
      ON recon_classification_configs (company_id, category)
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS rcc_category_active_idx
      ON recon_classification_configs (category, is_active, priority)
  `));

  // Older production databases already have an index with the legacy name
  // `rcc_code_company_uniq`, but that index is only on `(code)`. PostgreSQL
  // cannot use it for the scoped `ON CONFLICT (code, COALESCE(company_id, 0))`
  // statements below, so the seed aborts before operational rules are mirrored.
  // Create the corrected index under a new name first, then remove the legacy
  // index. Creating first keeps the replacement fail-closed if duplicate
  // scoped codes ever exist.
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS rcc_code_company_scope_uniq
      ON recon_classification_configs (code, COALESCE(company_id, 0))
  `));
  await db.execute(sql.raw(`
    DROP INDEX IF EXISTS rcc_code_company_uniq
  `));

  // ── Table 2: recon_ai_classification_rules ─────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_ai_classification_rules (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER,
      config_id           INTEGER REFERENCES recon_classification_configs(id) ON DELETE SET NULL,
      name                TEXT NOT NULL,
      description         TEXT,
      condition_field     TEXT NOT NULL,
      condition_operator  TEXT NOT NULL,
      condition_value     TEXT NOT NULL,
      conditions_json     JSONB,
      logic               TEXT NOT NULL DEFAULT 'AND',
      specificity         INTEGER NOT NULL DEFAULT 1,
      action_flow         TEXT,
      action_coa_code     TEXT,
      action_config_code  TEXT,
      amount_tolerance    NUMERIC(16,2),
      reference_amount    NUMERIC(16,2),
      confidence          NUMERIC(4,2) DEFAULT 0.80,
      priority            INTEGER NOT NULL DEFAULT 50,
      is_active           BOOLEAN NOT NULL DEFAULT TRUE,
      source              TEXT NOT NULL DEFAULT 'manual',
      created_by          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
  await db.execute(sql.raw(`
    ALTER TABLE recon_ai_classification_rules
      ADD COLUMN IF NOT EXISTS conditions_json JSONB,
      ADD COLUMN IF NOT EXISTS logic TEXT NOT NULL DEFAULT 'AND',
      ADD COLUMN IF NOT EXISTS specificity INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS operational_rule_id INTEGER,
      ADD COLUMN IF NOT EXISTS amount_tolerance NUMERIC(16,2),
      ADD COLUMN IF NOT EXISTS reference_amount NUMERIC(16,2)
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS racr_company_active_idx
      ON recon_ai_classification_rules (company_id, is_active, priority)
  `));

  // ── Table 3: recon_keyword_dictionary ──────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_keyword_dictionary (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER,
      config_id   INTEGER REFERENCES recon_classification_configs(id) ON DELETE SET NULL,
      term        TEXT NOT NULL,
      weight      NUMERIC(4,2) NOT NULL DEFAULT 0.80,
      is_active   BOOLEAN NOT NULL DEFAULT TRUE,
      created_by  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS rkd_company_active_idx
      ON recon_keyword_dictionary (company_id, is_active)
  `));

  // ── Table 4: recon_approval_rules_config ───────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_approval_rules_config (
      id                      SERIAL PRIMARY KEY,
      company_id              INTEGER,
      config_id               INTEGER REFERENCES recon_classification_configs(id) ON DELETE SET NULL,
      name                    TEXT NOT NULL,
      min_amount              NUMERIC(15,2),
      max_amount              NUMERIC(15,2),
      required_approver_role  TEXT,
      approval_level          INTEGER NOT NULL DEFAULT 1,
      is_active               BOOLEAN NOT NULL DEFAULT TRUE,
      created_by              TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS rarc_company_active_idx
      ON recon_approval_rules_config (company_id, is_active)
  `));

  // ── Seed default data ──────────────────────────────────────────────────────
  const allSeeds = [...BUSINESS_TRANSACTION_SEEDS, ...ROUTINE_EXPENSE_SEEDS];
  for (const seed of allSeeds) {
    await db.execute(sql.raw(`
      INSERT INTO recon_classification_configs
        (category, name, code, type, flow, keywords, priority, is_seed, is_active)
      VALUES (
        '${seed.category}',
        '${seed.name.replace(/'/g, "''")}',
        '${seed.code}',
        '${seed.type}',
        '${seed.flow}',
        '${JSON.stringify(seed.keywords)}',
        ${seed.priority},
        TRUE,
        TRUE
      )
      ON CONFLICT (code, COALESCE(company_id, 0)) DO NOTHING
    `));
  }

  migrated = true;
  logger.info("[ReconClassificationMigration] Done — tables created, seeds inserted.");
}

/**
 * Backfill the configuration workspace from operational bank-reconciliation
 * rules. Older references were written only to recon_rules, before the
 * configuration mirror was introduced. Keep this idempotent so it is safe to
 * run from either route on every environment.
 */
export async function syncOperationalReconRulesToClassification(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      WITH normalized_rules AS (
        SELECT DISTINCT ON (
          company_id,
          direction,
          LOWER(TRIM(COALESCE(condition_value, ''))),
          COALESCE(NULLIF(TRIM(target_coa_code), ''), '')
        ) *
        FROM recon_rules
        WHERE COALESCE(is_active, TRUE) = TRUE
          AND company_id IS NOT NULL
          AND NULLIF(TRIM(COALESCE(condition_value, '')), '') IS NOT NULL
        ORDER BY
          company_id,
          direction,
          LOWER(TRIM(COALESCE(condition_value, ''))),
          COALESCE(NULLIF(TRIM(target_coa_code), ''), ''),
          priority DESC,
          id DESC
      )
      INSERT INTO recon_classification_configs
        (company_id, category, name, code, type, flow, default_coa_code,
         keywords, priority, is_active, is_seed, updated_at)
      SELECT
        r.company_id,
        CASE WHEN r.direction = 'IN' THEN 'INCOME_ALLOCATION' ELSE 'ROUTINE_EXPENSE' END,
        LEFT(COALESCE(r.name, 'Referensi Bank — ' || r.condition_value), 120),
        'BANK_REFERENCE_' || UPPER(COALESCE(r.direction, 'UNKNOWN')) || '_' ||
          UPPER(SUBSTRING(md5(UPPER(COALESCE(r.direction, '')) || ':' ||
            LOWER(TRIM(COALESCE(r.condition_value, ''))) || ':' ||
            COALESCE(r.target_coa_code, '')) FROM 1 FOR 10)),
        CASE WHEN r.direction = 'IN' THEN 'income' ELSE 'expense' END,
        CASE WHEN r.direction = 'IN' THEN 'INCOME_ALLOCATION' ELSE 'ROUTINE_EXPENSE_ALLOCATION' END,
        NULLIF(TRIM(r.target_coa_code), ''),
        jsonb_build_array(TRIM(COALESCE(r.condition_value, ''))),
        COALESCE(r.priority, 120),
        TRUE,
        FALSE,
        NOW()
      FROM normalized_rules r
      WHERE NOT EXISTS (
          SELECT 1
          FROM recon_classification_configs c
          WHERE c.company_id = r.company_id
            AND c.category = CASE
              WHEN r.direction = 'IN' THEN 'INCOME_ALLOCATION'
              ELSE 'ROUTINE_EXPENSE'
            END
            AND LOWER(COALESCE(c.keywords->>0, '')) =
              LOWER(TRIM(COALESCE(r.condition_value, '')))
            AND COALESCE(c.default_coa_code, '') = COALESCE(r.target_coa_code, '')
        )
      ON CONFLICT (code, COALESCE(company_id, 0)) DO UPDATE SET
        default_coa_code = EXCLUDED.default_coa_code,
        keywords = EXCLUDED.keywords,
        priority = EXCLUDED.priority,
        is_active = TRUE,
        updated_at = NOW()
    `));

    await db.execute(sql.raw(`
      WITH normalized_rules AS (
        SELECT DISTINCT ON (
          company_id,
          direction,
          LOWER(TRIM(COALESCE(condition_value, ''))),
          COALESCE(NULLIF(TRIM(target_coa_code), ''), '')
        ) *
        FROM recon_rules
        WHERE COALESCE(is_active, TRUE) = TRUE
          AND company_id IS NOT NULL
          AND NULLIF(TRIM(COALESCE(condition_value, '')), '') IS NOT NULL
        ORDER BY
          company_id,
          direction,
          LOWER(TRIM(COALESCE(condition_value, ''))),
          COALESCE(NULLIF(TRIM(target_coa_code), ''), ''),
          priority DESC,
          id DESC
      )
      INSERT INTO recon_ai_classification_rules
        (company_id, name, description, condition_field, condition_operator,
         condition_value, action_flow, action_coa_code, action_config_code,
         conditions_json, logic, specificity, config_id, amount_tolerance,
         reference_amount, confidence, priority, source)
      SELECT
        r.company_id,
        LEFT(COALESCE(r.name, 'Referensi Bank — ' || r.condition_value), 120),
        r.description,
        r.condition_field,
        r.condition_operator,
        r.condition_value,
        CASE WHEN r.direction = 'IN' THEN 'INCOME_ALLOCATION' ELSE 'ROUTINE_EXPENSE_ALLOCATION' END,
        NULLIF(TRIM(r.target_coa_code), ''),
        c.code,
         r.conditions_json,
         COALESCE(r.logic, 'AND'),
         COALESCE(r.specificity, 1),
        c.id,
         r.amount_tolerance,
         r.reference_amount,
        1.00,
        COALESCE(r.priority, 120),
        'manual'
      FROM normalized_rules r
      JOIN recon_classification_configs c
        ON c.company_id = r.company_id
       AND c.category = CASE
         WHEN r.direction = 'IN' THEN 'INCOME_ALLOCATION'
         ELSE 'ROUTINE_EXPENSE'
       END
       AND LOWER(COALESCE(c.keywords->>0, '')) =
         LOWER(TRIM(COALESCE(r.condition_value, '')))
       AND COALESCE(c.default_coa_code, '') = COALESCE(r.target_coa_code, '')
       AND c.is_active = TRUE
      WHERE NOT EXISTS (
          SELECT 1
          FROM recon_ai_classification_rules a
          WHERE a.company_id = r.company_id
            AND a.condition_field = r.condition_field
            AND a.condition_operator = r.condition_operator
            AND a.condition_value = r.condition_value
            AND COALESCE(a.action_coa_code, '') = COALESCE(r.target_coa_code, '')
        )
    `));
  } catch (err) {
    // recon_rules may not exist yet when this migration is reached first.
    // The bank-reconciliation migration calls this again after creating it.
    logger.warn({ err }, "[ReconClassificationMigration] operational rule backfill skipped");
  }
}

/**
 * Materialize Rule AI rows as managed operational reconciliation rules.
 *
 * `recon_rules` remains the matching source of truth. A Rule AI row is linked
 * to its own operational mirror so create/edit/deactivate operations in the
 * configuration UI are reflected by the runtime matcher without changing
 * independent Referensi COA rules created from Bank Reconciliation.
 */
export async function syncAiClassificationRulesToOperational(
  companyId?: number,
): Promise<void> {
  const normalizedCompanyId = companyId != null && Number.isSafeInteger(companyId) && companyId > 0
    ? companyId
    : null;

  try {
    const tableCheck = await db.execute(sql.raw(`
      SELECT to_regclass('public.recon_rules') AS recon_rules_table
    `));
    if (!((tableCheck as any).rows ?? [])[0]?.recon_rules_table) return;

    await db.execute(sql.raw(`
      ALTER TABLE recon_rules
        ADD COLUMN IF NOT EXISTS ai_classification_rule_id INTEGER
    `));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS rr_ai_classification_rule_uniq
        ON recon_rules (ai_classification_rule_id)
        WHERE ai_classification_rule_id IS NOT NULL
    `));

    const companyFilter = normalizedCompanyId == null
      ? ""
      : `AND r.company_id = ${normalizedCompanyId}`;

    // Older deployments may already contain the corresponding operational
    // rule, but without the link. Claim only an active, unclaimed rule with
    // the same company, direction, first condition, and COA. This repairs the
    // historical split without attaching an unrelated rule.
    await db.execute(sql.raw(`
      UPDATE recon_rules o
      SET ai_classification_rule_id = r.id, updated_at = NOW()
      FROM recon_ai_classification_rules r
      WHERE r.operational_rule_id IS NULL
        AND COALESCE(r.is_active, TRUE) = TRUE
        AND o.ai_classification_rule_id IS NULL
        AND COALESCE(o.is_active, TRUE) = TRUE
        AND o.company_id = r.company_id
        AND COALESCE(o.direction, '') = CASE
          WHEN UPPER(COALESCE(r.action_flow, '')) LIKE '%INCOME%' THEN 'IN'
          ELSE 'OUT'
        END
        AND o.condition_field = r.condition_field
        AND o.condition_operator = r.condition_operator
        AND o.condition_value = COALESCE(r.condition_value, '')
        AND COALESCE(o.target_coa_code, '') = COALESCE(r.action_coa_code, '')
        AND o.id = (
          SELECT MIN(o2.id)
          FROM recon_rules o2
          WHERE o2.ai_classification_rule_id IS NULL
            AND COALESCE(o2.is_active, TRUE) = TRUE
            AND o2.company_id = r.company_id
            AND COALESCE(o2.direction, '') = CASE
              WHEN UPPER(COALESCE(r.action_flow, '')) LIKE '%INCOME%' THEN 'IN'
              ELSE 'OUT'
            END
            AND o2.condition_field = r.condition_field
            AND o2.condition_operator = r.condition_operator
            AND o2.condition_value = COALESCE(r.condition_value, '')
            AND COALESCE(o2.target_coa_code, '') = COALESCE(r.action_coa_code, '')
        )
        ${companyFilter}
    `));

    await db.execute(sql.raw(`
      UPDATE recon_ai_classification_rules r
      SET operational_rule_id = o.id, updated_at = NOW()
      FROM recon_rules o
      WHERE o.ai_classification_rule_id = r.id
        AND r.operational_rule_id IS NULL
        ${companyFilter}
    `));

    // Complete the reverse side for rows created by an earlier version of the
    // synchronizer, which stored operational_rule_id but not the operational
    // row's ai_classification_rule_id.
    await db.execute(sql.raw(`
      UPDATE recon_rules o
      SET ai_classification_rule_id = r.id, updated_at = NOW()
      FROM recon_ai_classification_rules r
      WHERE r.operational_rule_id = o.id
        AND o.ai_classification_rule_id IS NULL
        ${companyFilter}
    `));

    // Deactivation is intentionally limited to rows explicitly created as an
    // AI-rule mirror. A display mirror of an independently authored Referensi
    // COA must not be allowed to disable the authoritative operational rule.
    await db.execute(sql.raw(`
      UPDATE recon_rules o
      SET is_active = FALSE, updated_at = NOW()
      FROM recon_ai_classification_rules r
      WHERE o.ai_classification_rule_id = r.id
        AND COALESCE(r.is_active, TRUE) = FALSE
        ${companyFilter}
    `));

    // Keep already-linked mirrors in lockstep when an administrator edits a
    // Rule AI. The runtime consumes the same condition, precedence, and COA.
    await db.execute(sql.raw(`
      UPDATE recon_rules o
      SET
        name = r.name,
        description = r.description,
        priority = COALESCE(r.priority, 100),
        is_active = COALESCE(r.is_active, TRUE),
        direction = CASE
          WHEN UPPER(COALESCE(r.action_flow, '')) LIKE '%INCOME%' THEN 'IN'
          ELSE 'OUT'
        END,
        condition_type = 'AI_CLASSIFICATION',
        condition_field = r.condition_field,
        condition_operator = r.condition_operator,
        condition_value = COALESCE(r.condition_value, ''),
        conditions_json = r.conditions_json,
        logic = COALESCE(r.logic, 'AND'),
        specificity = COALESCE(r.specificity, 1),
        amount_tolerance = r.amount_tolerance,
        reference_amount = r.reference_amount,
        target_type = CASE
          WHEN UPPER(COALESCE(r.action_flow, '')) LIKE '%INCOME%' THEN 'income'
          ELSE 'expense'
        END,
        target_coa_code = r.action_coa_code,
        confidence_score = LEAST(100, GREATEST(0, ROUND(COALESCE(r.confidence, 1.0) * 100))),
        stop_processing = TRUE,
        updated_at = NOW()
      FROM recon_ai_classification_rules r
      WHERE o.ai_classification_rule_id = r.id
        AND COALESCE(r.is_active, TRUE) = TRUE
        ${companyFilter}
    `));

    // Existing independent operational rules win: if the exact rule already
    // exists, it is already usable by matching and is deliberately not claimed
    // by the configuration screen.
    await db.execute(sql.raw(`
      INSERT INTO recon_rules
        (company_id, name, description, priority, is_active, direction,
         bank_account_id, condition_type, condition_field, condition_operator,
         condition_value, conditions_json, logic, specificity,
         target_type, target_id, target_coa_code,
         amount_tolerance, reference_amount, confidence_score, stop_processing,
         created_by, ai_classification_rule_id)
      SELECT
        r.company_id,
        r.name,
        r.description,
        COALESCE(r.priority, 100),
        TRUE,
        CASE
          WHEN UPPER(COALESCE(r.action_flow, '')) LIKE '%INCOME%' THEN 'IN'
          ELSE 'OUT'
        END,
        NULL,
        'AI_CLASSIFICATION',
        r.condition_field,
        r.condition_operator,
        COALESCE(r.condition_value, ''),
        r.conditions_json,
        COALESCE(r.logic, 'AND'),
        COALESCE(r.specificity, 1),
        CASE
          WHEN UPPER(COALESCE(r.action_flow, '')) LIKE '%INCOME%' THEN 'income'
          ELSE 'expense'
        END,
        NULL,
        r.action_coa_code,
         r.amount_tolerance,
         r.reference_amount,
        LEAST(100, GREATEST(0, ROUND(COALESCE(r.confidence, 1.0) * 100))),
        TRUE,
        r.created_by,
        r.id
      FROM recon_ai_classification_rules r
      WHERE COALESCE(r.is_active, TRUE) = TRUE
        AND r.company_id IS NOT NULL
        AND r.operational_rule_id IS NULL
        ${companyFilter}
        AND NOT EXISTS (
          SELECT 1
          FROM recon_rules o
          WHERE o.company_id = r.company_id
            AND COALESCE(o.direction, '') = CASE
              WHEN UPPER(COALESCE(r.action_flow, '')) LIKE '%INCOME%' THEN 'IN'
              ELSE 'OUT'
            END
            AND o.condition_field = r.condition_field
            AND o.condition_operator = r.condition_operator
            AND o.condition_value = COALESCE(r.condition_value, '')
            AND COALESCE(o.target_coa_code, '') = COALESCE(r.action_coa_code, '')
        )
      ON CONFLICT (ai_classification_rule_id)
      WHERE ai_classification_rule_id IS NOT NULL
      DO NOTHING
    `));

    await db.execute(sql.raw(`
      UPDATE recon_ai_classification_rules r
      SET operational_rule_id = o.id, updated_at = NOW()
      FROM recon_rules o
      WHERE o.ai_classification_rule_id = r.id
        AND r.operational_rule_id IS NULL
        ${companyFilter}
    `));
  } catch (err) {
    logger.warn({ err, companyId: normalizedCompanyId }, "[ReconClassificationMigration] AI rule operational sync skipped");
  }
}

/** Force re-run (used by admin seed endpoint). */
export function resetMigrationFlag(): void {
  migrated = false;
}
