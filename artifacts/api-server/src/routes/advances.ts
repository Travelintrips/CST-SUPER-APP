/**
 * Advance Management — Unified Engine (PRIMARY)
 *
 * This is the SINGLE SOURCE OF TRUTH for all advance operations.
 * Routes/cashAdvances.ts is DEPRECATED — it exists for legacy reads only.
 *
 * Tables:
 *   cash_advances            — shared with legacy; extended with advance_type + lifecycle_status
 *   advance_settlements      — unified settlement header
 *   advance_allocation_lines — allocation detail per settlement
 *
 * Architecture: routes are thin adapters — all business logic lives in:
 *   lib/advance/AdvanceStateMachine.ts    — status transition guard
 *   lib/advance/AdvanceJournalService.ts  — journal posting
 *   lib/advance/AdvanceErrors.ts          — typed errors
 */
import { Router, type Request } from "express";
import { desc, eq, and, sql } from "drizzle-orm";
import multer from "multer";
import { ObjectStorageService } from "../lib/objectStorage.js";
const _objStoreSvc = new ObjectStorageService();
import {
  db, cashAdvancesTable, chartOfAccountsTable, accountingJournalsTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId, getAllowedCompanyIds } from "../lib/resolveCompany.js";
import { auditFromReq } from "../lib/auditLog.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { assertCanVoidTransaction } from "../lib/accountingPostingGuard.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { getOpenAI } from "../lib/openaiClient.js";
import {
  canVoid,
  canRepay,
  canSettle,
  canDelete,
  deriveStatusAfterPayment,
  mapToLegacyStatus,
  type LifecycleStatus,
} from "../lib/advance/AdvanceStateMachine.js";
import {
  AdvanceJournalService,
  resolveIntercompanyAccounts,
} from "../lib/advance/AdvanceJournalService.js";
import { sendAdvanceError } from "../lib/advance/AdvanceErrors.js";

// ── Constants ─────────────────────────────────────────────────────────────────
export const ADVANCE_TYPES = [
  "EMPLOYEE", "VENDOR", "CUSTOMER", "PROJECT",
  "PURCHASE", "TRAVEL", "OPERATIONAL", "OTHER",
] as const;
export type AdvanceType = typeof ADVANCE_TYPES[number];

export const LIFECYCLE_STATUSES = [
  "draft", "pending_approval", "approved", "rejected", "disbursed",
  "outstanding", "partially_settled", "settled", "closed",
  "void", "reversed", "cancelled",
] as const;
// LifecycleStatus is re-exported from AdvanceStateMachine for the canonical type

export const ALLOCATION_TYPES = [
  "ADVANCE_PRINCIPAL", "SALES_INVOICE", "DIRECT_REVENUE",
  "CUSTOMER_DEPOSIT", "OTHER_RECEIVABLE", "ROUNDING", "OTHER",
] as const;
export type AllocationType = typeof ALLOCATION_TYPES[number];

// Prefix map for advance number generation
const TYPE_PREFIX: Record<AdvanceType, string> = {
  EMPLOYEE:    "ADV-EMP",
  VENDOR:      "ADV-VND",
  CUSTOMER:    "ADV-CST",
  PROJECT:     "ADV-PRJ",
  PURCHASE:    "ADV-PUR",
  TRAVEL:      "ADV-TRV",
  OPERATIONAL: "ADV-OPR",
  OTHER:       "ADV-OTH",
};

// Map old cash_advances.status → lifecycle_status (kept for migration/read compat)
const STATUS_MAP: Record<string, LifecycleStatus> = {
  active:           "outstanding",
  partial:          "partially_settled",
  repaid:           "settled",
  accounted:        "settled",
  void:             "void",
  pending_approval: "pending_approval",
  rejected:         "rejected",   // FIX: was incorrectly mapped to "void"
  approved:         "approved",
  disbursed:        "disbursed",
};

// ── Boot migration ────────────────────────────────────────────────────────────
export async function runAdvanceMigration(): Promise<void> {
  // 1. Extend cash_advances with new columns
  const newColumns: Array<[string, string]> = [
    ["advance_type",      "TEXT"],
    ["lifecycle_status",  "TEXT"],
    ["counterparty_type", "TEXT"],
    ["project_id",        "INTEGER"],
    ["purpose",           "TEXT"],
    ["approved_by",       "TEXT"],
    ["approved_at",       "TIMESTAMP"],
    ["disbursed_by",      "TEXT"],
    ["currency",          "TEXT DEFAULT 'IDR'"],
    ["exchange_rate",     "NUMERIC(12,6) DEFAULT 1"],
    ["source_system",     "TEXT DEFAULT 'advance_management'"],
    ["department_id",     "INTEGER"],
    ["division_id",       "INTEGER"],
    ["settled_at",              "TIMESTAMP"],
    ["closed_at",               "TIMESTAMP"],
    // Dana Talangan extended fields
    ["category",               "TEXT"],
    ["category_other",         "TEXT"],
    ["funding_source_type",    "TEXT"],
    ["source_company_id",      "INTEGER"],
    ["source_bank_name",       "TEXT"],
    ["source_party_name",      "TEXT"],
    ["responsible_party_type", "TEXT"],
    ["responsible_company_id", "INTEGER"],
    ["responsible_bank_name",  "TEXT"],
    ["responsible_vendor_id",  "INTEGER"],
    ["responsible_employee_id","TEXT"],
    ["responsible_party_name", "TEXT"],
    ["reference_number",       "TEXT"],
    ["responsible_entry_id",   "INTEGER"],   // Intercompany liability journal in responsible company
    ["funding_company_id",     "INTEGER"],
    ["intercompany_reference", "TEXT"],
    ["funding_entry_id",       "INTEGER"],
    ["intercompany_status",    "TEXT"],
    ["intercompany_paid_amount", "NUMERIC(14,2) DEFAULT 0"],
  ];
  for (const [col, def] of newColumns) {
    await db.execute(sql.raw(`ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS ${col} ${def}`)).catch(() => {});
  }

  // 2. Create advance_settlements table (unified settlement header)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS advance_settlements (
      id                SERIAL PRIMARY KEY,
      company_id        INTEGER NOT NULL,
      advance_id        INTEGER NOT NULL REFERENCES cash_advances(id) ON DELETE RESTRICT,
      settlement_number TEXT NOT NULL,
      date              DATE NOT NULL,
      bank_account_id   INTEGER,
      amount_received   NUMERIC(14,2) NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'IDR',
      exchange_rate     NUMERIC(12,6) NOT NULL DEFAULT 1,
      reference         TEXT,
      counterparty_name TEXT,
      status            TEXT NOT NULL DEFAULT 'posted',
      journal_id        INTEGER,
      notes             TEXT,
      created_by        TEXT,
      created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS adv_stl_company_idx ON advance_settlements(company_id)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS adv_stl_advance_idx ON advance_settlements(advance_id)`).catch(() => {});
  // 2b. receipt_url for expense-reclass settlements (settle-expense), added after
  // initial table creation — CREATE TABLE IF NOT EXISTS above won't add it to
  // pre-existing tables, so it needs its own idempotent ALTER.
  await db.execute(sql.raw(`
    ALTER TABLE advance_settlements ADD COLUMN IF NOT EXISTS receipt_url TEXT
  `)).catch(() => {});

  // 3. Create advance_allocation_lines table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS advance_allocation_lines (
      id                 SERIAL PRIMARY KEY,
      settlement_id      INTEGER NOT NULL REFERENCES advance_settlements(id) ON DELETE CASCADE,
      advance_id         INTEGER NOT NULL,
      allocation_type    TEXT NOT NULL,
      reference_doc_id   INTEGER,
      reference_doc_type TEXT,
      coa_id             INTEGER,
      amount             NUMERIC(14,2) NOT NULL,
      remarks            TEXT,
      journal_id         INTEGER,
      created_at         TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS adv_alloc_stl_idx ON advance_allocation_lines(settlement_id)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS adv_alloc_adv_idx ON advance_allocation_lines(advance_id)`).catch(() => {});

  // 3b. Normalize non-canonical `type` values (e.g. rows seeded/imported with
  // 'employee_kasbon' instead of 'kasbon') to the canonical 'kasbon' | 'talangan'
  // bucket. Everything with the type column recognizably referencing kasbon is
  // treated as kasbon; anything else falls back to talangan, matching the
  // binary bucket the rest of the codebase (and the frontend) assumes.
  await db.execute(sql`
    UPDATE cash_advances
    SET type = 'kasbon'
    WHERE type ILIKE '%kasbon%' AND type <> 'kasbon'
  `).catch(() => {});
  await db.execute(sql`
    UPDATE cash_advances
    SET type = 'talangan'
    WHERE type NOT ILIKE '%kasbon%' AND type <> 'talangan'
  `).catch(() => {});

  // 3c. Fix non-canonical advance_type values (e.g. 'lump_sum' seeded on kasbon records).
  // approvalCategoryForType only recognises 'EMPLOYEE' as kasbon; anything else falls through
  // to talangan and posts to the wrong COA (1-1033 Piutang Dana Talangan). Normalize these
  // before the advance_type=NULL migration below so the CASE logic applies correctly.
  await db.execute(sql`
    UPDATE cash_advances
    SET advance_type = 'EMPLOYEE'
    WHERE type = 'kasbon'
      AND (
        advance_type IS NULL
        OR advance_type NOT IN ('EMPLOYEE','VENDOR','CUSTOMER','PROJECT','PURCHASE','TRAVEL','OPERATIONAL','OTHER')
      )
  `).catch(() => {});
  await db.execute(sql`
    UPDATE cash_advances
    SET advance_type = CASE
          WHEN vendor_id IS NOT NULL THEN 'VENDOR'
          ELSE 'OPERATIONAL'
        END
    WHERE type = 'talangan'
      AND (
        advance_type IS NULL
        OR advance_type NOT IN ('EMPLOYEE','VENDOR','CUSTOMER','PROJECT','PURCHASE','TRAVEL','OPERATIONAL','OTHER')
      )
  `).catch(() => {});

  // 3d. Auto-create 1-1032-{company} COA for every company that has kasbon advances
  // but does NOT have a 1-1032-prefixed account yet (derive suffix from their 1-1033 sibling).
  await db.execute(sql`
    INSERT INTO chart_of_accounts (company_id, code, name, type, subtype, is_active, created_at)
    SELECT DISTINCT
      ca.company_id,
      REPLACE(coa_t.code, '1-1033', '1-1032'),
      REPLACE(REPLACE(coa_t.name, 'Dana Talangan', 'Karyawan (Kasbon)'), 'Talangan', 'Kasbon'),
      'asset',
      'receivable',
      true,
      NOW()
    FROM cash_advances ca
    JOIN chart_of_accounts coa_t ON coa_t.company_id = ca.company_id AND coa_t.code LIKE '1-1033%'
    WHERE ca.type ILIKE '%kasbon%'
      AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts
        WHERE code LIKE '1-1032%'
          AND (company_id = ca.company_id OR company_id IS NULL)
      )
    ON CONFLICT (company_id, code) DO NOTHING
  `).catch(() => {});

  // 3e. Fix receivable_account_id: kasbon advances whose receivable_account_id currently
  // points to a talangan COA (code LIKE '1-1033%') must be corrected to the kasbon COA
  // (code LIKE '1-1032%') so the next repayment/settlement posts to the right account.
  await db.execute(sql`
    UPDATE cash_advances ca
    SET receivable_account_id = (
      SELECT id FROM chart_of_accounts
      WHERE code LIKE '1-1032%'
        AND (company_id = ca.company_id OR company_id IS NULL)
      ORDER BY company_id DESC NULLS LAST LIMIT 1
    )
    WHERE ca.type ILIKE '%kasbon%'
      AND ca.receivable_account_id IN (
        SELECT id FROM chart_of_accounts WHERE code LIKE '1-1033%'
      )
      AND EXISTS (
        SELECT 1 FROM chart_of_accounts
        WHERE code LIKE '1-1032%'
          AND (company_id = ca.company_id OR company_id IS NULL)
      )
  `).catch(() => {});

  // 4. Migrate existing kasbon/talangan data
  // kasbon → EMPLOYEE, talangan → VENDOR (if vendor_id) else OPERATIONAL
  await db.execute(sql`
    UPDATE cash_advances
    SET advance_type = CASE
          WHEN type = 'employee_kasbon' THEN 'EMPLOYEE'
          WHEN type = 'kasbon'          THEN 'EMPLOYEE'
          WHEN type = 'talangan' AND vendor_id IS NOT NULL THEN 'VENDOR'
          WHEN type = 'talangan' THEN 'OPERATIONAL'
          ELSE 'OTHER'
        END
    WHERE advance_type IS NULL
  `).catch(() => {});

  // Map old status → lifecycle_status
  await db.execute(sql`
    UPDATE cash_advances
    SET lifecycle_status = CASE
          WHEN status = 'active'           THEN 'outstanding'
          WHEN status = 'partial'          THEN 'partially_settled'
          WHEN status = 'repaid'           THEN 'settled'
          WHEN status = 'accounted'        THEN 'settled'
          WHEN status IN ('void','rejected')    THEN 'void'
          WHEN status = 'pending_approval' THEN 'pending_approval'
          ELSE 'outstanding'
        END
    WHERE lifecycle_status IS NULL
  `).catch(() => {});

  // Set source_system for legacy entries
  await db.execute(sql`
    UPDATE cash_advances
    SET source_system = 'legacy'
    WHERE source_system IS NULL OR source_system = 'advance_management'
      AND created_at < NOW() - INTERVAL '1 minute'
  `).catch(() => {});

  // 5. Create cash_advance_installment_schedules table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cash_advance_installment_schedules (
      id                  SERIAL PRIMARY KEY,
      advance_id          INTEGER NOT NULL REFERENCES cash_advances(id) ON DELETE CASCADE,
      company_id          INTEGER NOT NULL,
      installment_number  INTEGER NOT NULL,
      due_date            DATE NOT NULL,
      amount              NUMERIC(14,2) NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      repayment_id        INTEGER REFERENCES cash_advance_repayments(id),
      paid_date           DATE,
      paid_amount         NUMERIC(14,2),
      notes               TEXT,
      created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT cais_status_check CHECK (status IN ('pending','paid','overdue','waived'))
    )
  `).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS cais_advance_idx  ON cash_advance_installment_schedules(advance_id)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS cais_company_idx  ON cash_advance_installment_schedules(company_id)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS cais_due_date_idx ON cash_advance_installment_schedules(due_date)`).catch(() => {});
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS cais_advance_num_idx ON cash_advance_installment_schedules(advance_id, installment_number)`).catch(() => {});

  // 6. Add intercompany repayment columns to cash_advance_repayments
  const repaymentCols: [string, string][] = [
    ["payer_company_id",      "INTEGER"],
    ["payer_coa_account_id",  "INTEGER"],
    ["receiver_company_id",   "INTEGER"],
    ["receiver_coa_account_id","INTEGER"],
    ["payment_reference",     "TEXT"],
    ["intercompany_reference","TEXT"],
    ["payer_journal_id",      "INTEGER"],
    ["receiver_journal_id",   "INTEGER"],
    ["idempotency_key",       "TEXT"],
    ["posted_at",             "TIMESTAMP"],
    ["created_by",            "TEXT"],
    ["source_bank_name",      "TEXT"],
  ];
  for (const [col, def] of repaymentCols) {
    await db.execute(sql.raw(`ALTER TABLE cash_advance_repayments ADD COLUMN IF NOT EXISTS ${col} ${def}`)).catch(() => {});
  }
  await db.execute(sql`CREATE INDEX IF NOT EXISTS car_payer_co_idx    ON cash_advance_repayments(payer_company_id)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS car_receiver_co_idx ON cash_advance_repayments(receiver_company_id)`).catch(() => {});
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS car_idempotency_idx ON cash_advance_repayments(idempotency_key) WHERE idempotency_key IS NOT NULL`).catch(() => {});
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS cash_advances_ic_ref_idx ON cash_advances(intercompany_reference) WHERE intercompany_reference IS NOT NULL`).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: unknown): number { return Number(n) || 0; }

async function generateAdvanceNumber(companyId: number, type: AdvanceType): Promise<string> {
  const prefix = TYPE_PREFIX[type] ?? "ADV";
  const year  = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const res = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*)::text AS cnt FROM cash_advances
    WHERE company_id = ${companyId}
      AND advance_number LIKE ${`${prefix}-${year}${month}-%`}
  `);
  const seq = (Number(res.rows[0]?.cnt ?? 0) + 1).toString().padStart(4, "0");
  return `${prefix}-${year}${month}-${seq}`;
}

function serializeAdv(r: Record<string, unknown>) {
  const lifecycle = (r.lifecycle_status ?? r.status) as LifecycleStatus | undefined;
  const legacyStatus = lifecycle ? mapToLegacyStatus(lifecycle) : (r.status as string | undefined);
  const vendorName = r.vendor_name as string | null | undefined;
  const cashBankName = r.cash_bank_account_name as string | null | undefined;
  const employeeName = (r.employee_name ?? r.party_name) as string | null | undefined;
  return {
    ...r,
    amount:          fmt(r.amount),
    paidAmount:      fmt(r.paid_amount),
    remainingAmount: fmt(r.remaining_amount),
    settledAmount:   fmt(r.settled_amount),
    // Legacy-compat aliases so bizportal expense pages (kasbon.tsx / talangan.tsx) keep working
    // against the unified engine's snake_case + lifecycle_status contract (Sprint 2 migration).
    advanceNumber:   r.advance_number,
    partyName:       r.party_name,
    paymentMethod:   r.payment_method,
    // Normalize the legacy bucket column to canonical 'kasbon' | 'talangan' —
    // some rows were seeded/imported with non-canonical values like
    // 'employee_kasbon', which used to fail every `type === "kasbon"` check
    // in the frontend and silently get bucketed as Talangan.
    type: typeof r.type === "string" && r.type.toLowerCase().includes("kasbon") ? "kasbon" : "talangan",
    lifecycleStatus: lifecycle,
    status:          legacyStatus,
    entryId:         r.entry_id,
    receiptUrl:      r.receipt_url,
    vendor:          r.vendor_id ? { id: r.vendor_id, name: vendorName } : null,
    cashBankAccount: r.cash_bank_account_id ? { id: r.cash_bank_account_id, name: cashBankName } : null,
    employee:        r.user_id ? { id: r.user_id, name: employeeName, email: r.employee_email } : null,
  };
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Legacy expense_approval_limits table is keyed by category 'kasbon' | 'talangan'.
// Ported from routes/cashAdvances.ts so approval-limit enforcement is not lost
// when the frontend migrates off the legacy engine (Sprint 2 requirement).
//
// IMPORTANT: accepts any string — not just canonical AdvanceType — because
// the fallback path in resolveReceivableAccount passes adv.type ('kasbon' /
// 'talangan') when advance_type is null or non-canonical (e.g. 'lump_sum').
function approvalCategoryForType(advanceType: string): "kasbon" | "talangan" {
  if (advanceType === "EMPLOYEE") return "kasbon";
  // Handle type-bucket fallback values ('kasbon', 'employee_kasbon', etc.)
  if (advanceType.toLowerCase().includes("kasbon")) return "kasbon";
  return "talangan";
}

async function resolveReceivableAccount(advanceType: string, companyId: number | null) {
  const coaCode = approvalCategoryForType(advanceType) === "kasbon" ? "1-1032" : "1-1033";
  const [row] = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(sql`code LIKE ${coaCode + "%"} ${companyId ? sql`AND (company_id = ${companyId} OR company_id IS NULL)` : sql``}`)
    .orderBy(sql`company_id DESC NULLS LAST`)
    .limit(1);
  return row?.id ?? null;
}

async function resolveCashBankAccount(paymentMethod: string, settings: Awaited<ReturnType<typeof ensureAccountingSettings>>) {
  return paymentMethod === "cash"
    ? (settings.defaultCashAccountId ?? settings.defaultBankAccountId)
    : (settings.defaultBankAccountId ?? settings.defaultCashAccountId);
}

async function checkApprovalLimit(advanceType: AdvanceType, companyId: number | null, amount: number) {
  const category = approvalCategoryForType(advanceType);
  const result = await db.execute(sql`
    SELECT * FROM expense_approval_limits
    WHERE category = ${category}
      AND (company_id = ${companyId} OR company_id IS NULL)
    ORDER BY company_id NULLS LAST
    LIMIT 1
  `);
  const limit = result.rows[0] as any | undefined;
  if (!limit) return { needsApproval: false, limit: null as any };
  const maxAuto = parseFloat(limit.max_auto_approve ?? "0");
  const needsApproval = maxAuto === 0 || amount > maxAuto;
  return { needsApproval, limit };
}

// ── Router ────────────────────────────────────────────────────────────────────
const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── GET /dashboard — Stats for Advance Management Dashboard ──────────────────
router.get("/dashboard", async (req: Request, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const [stats] = await db.execute<any>(sql`
      SELECT
        COUNT(*)::int                                                              AS total_count,
        COUNT(*) FILTER (WHERE lifecycle_status = 'outstanding')::int             AS outstanding_count,
        COUNT(*) FILTER (WHERE lifecycle_status = 'partially_settled')::int       AS partial_count,
        COUNT(*) FILTER (WHERE lifecycle_status = 'pending_approval')::int        AS pending_count,
        COUNT(*) FILTER (WHERE lifecycle_status = 'void')::int                    AS void_count,
        COALESCE(SUM(amount) FILTER (WHERE lifecycle_status IN ('disbursed','outstanding','partially_settled')), 0)::numeric AS outstanding_amount,
        COALESCE(SUM(remaining_amount) FILTER (WHERE lifecycle_status IN ('disbursed','outstanding','partially_settled')), 0)::numeric AS total_remaining,
        COALESCE(SUM(settled_amount), 0)::numeric                                 AS total_settled
      FROM cash_advances
      WHERE company_id = ${companyId} AND advance_type IS NOT NULL
    `).then(r => r.rows);

    const byType = await db.execute<any>(sql`
      SELECT
        advance_type,
        COUNT(*)::int AS count,
        COALESCE(SUM(remaining_amount) FILTER (WHERE lifecycle_status IN ('disbursed','outstanding','partially_settled')), 0)::numeric AS remaining
      FROM cash_advances
      WHERE company_id = ${companyId} AND advance_type IS NOT NULL
      GROUP BY advance_type
      ORDER BY remaining DESC
    `).then(r => r.rows);

    const byStatus = await db.execute<any>(sql`
      SELECT lifecycle_status AS status, COUNT(*)::int AS count
      FROM cash_advances
      WHERE company_id = ${companyId} AND advance_type IS NOT NULL
      GROUP BY lifecycle_status
    `).then(r => r.rows);

    res.json({ stats: stats ?? {}, byType, byStatus });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── GET /aging — Advance Aging Report ────────────────────────────────────────
router.get("/aging", async (req: Request, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const rows = await db.execute<any>(sql`
      SELECT
        ca.id, ca.advance_number, ca.advance_type, ca.party_name,
        ca.amount, ca.remaining_amount, ca.date, ca.lifecycle_status,
        CURRENT_DATE - ca.date::date AS age_days,
        CASE
          WHEN CURRENT_DATE - ca.date::date <= 30  THEN '0-30 hari'
          WHEN CURRENT_DATE - ca.date::date <= 60  THEN '31-60 hari'
          WHEN CURRENT_DATE - ca.date::date <= 90  THEN '61-90 hari'
          WHEN CURRENT_DATE - ca.date::date <= 180 THEN '91-180 hari'
          ELSE '> 180 hari'
        END AS aging_bucket,
        u.name AS employee_name,
        sup.name AS vendor_name
      FROM cash_advances ca
      LEFT JOIN users u ON ca.user_id = u.id
      LEFT JOIN suppliers sup ON ca.vendor_id = sup.id
      WHERE ca.company_id = ${companyId}
        AND ca.advance_type IS NOT NULL
        AND ca.lifecycle_status IN ('disbursed','outstanding','partially_settled')
      ORDER BY age_days DESC
    `).then(r => r.rows);
    res.json({ data: rows });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── GET /accounts — COA accounts suitable for each advance type ──────────────
router.get("/accounts", async (req: Request, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const type = String(req.query.type ?? "");
    const rows = await db.execute<any>(sql`
      SELECT id, code, name, type AS account_type, subtype
      FROM chart_of_accounts
      WHERE company_id = ${companyId}
        AND type = 'asset'
        AND (
          name ILIKE '%advance%' OR name ILIKE '%uang muka%' OR name ILIKE '%piutang%'
          OR name ILIKE '%kasbon%' OR name ILIKE '%talangan%' OR name ILIKE '%deposit%'
        )
      ORDER BY code ASC
      LIMIT 100
    `).then(r => r.rows);
    res.json({ data: rows });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── GET /expense-accounts — Expense COA (for settlement/pertanggungjawaban) ──
// Ported from routes/cashAdvances.ts — shared, stateless utility (no business
// logic change), needed by kasbon/talangan frontend after migrating off the
// legacy engine.
router.get("/expense-accounts", async (req: Request, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const rows = await db
      .select({ id: chartOfAccountsTable.id, code: chartOfAccountsTable.code, name: chartOfAccountsTable.name })
      .from(chartOfAccountsTable)
      .where(and(
        eq(chartOfAccountsTable.type, "expense" as any),
        eq(chartOfAccountsTable.isActive, true),
        sql`(${chartOfAccountsTable.companyId} = ${companyId} OR ${chartOfAccountsTable.companyId} IS NULL)`,
      ))
      .orderBy(chartOfAccountsTable.code);
    res.json(rows);
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── POST /ocr-preview — Stateless OCR extraction (no advance ID required) ────
// Ported unchanged from routes/cashAdvances.ts (pure utility, not advance-type
// specific business logic).
router.post("/ocr-preview", upload.single("file"), async (req: Request, res) => {
  if (!req.file) return res.status(400).json({ message: "File wajib diupload." });
  const file = req.file;
  const ext = (file.originalname.split(".").pop() ?? "jpg").toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "webp"].includes(ext);
  if (!isImage && ext !== "pdf") {
    return res.status(400).json({ message: "Format tidak didukung. Gunakan JPG, PNG, PDF, atau WEBP." });
  }
  try {
    const openai = getOpenAI();
    let userContent: any[];
    if (isImage) {
      const b64 = file.buffer.toString("base64");
      const mime = file.mimetype as string;
      userContent = [
        {
          type: "text",
          text: `Ini adalah bukti transfer / struk pembayaran / screenshot mutasi bank.
Ekstrak informasi berikut dalam format JSON:
- amount: nominal uang yang ditransfer/dibayar (angka bulat, tanpa titik/koma pemisah, tanpa simbol mata uang). Jika ada beberapa nominal, pilih yang paling besar / grand total.
- date: tanggal transaksi dalam format YYYY-MM-DD. Bulan Indonesia: Januari=01, Februari=02, Maret=03, April=04, Mei=05, Juni=06, Juli=07, Agustus=08, September=09, Oktober=10, November=11, Desember=12.
- partyName: nama pengirim atau penerima (jika ada).
- bankInfo: nama bank dan/atau nomor rekening (jika terlihat).
- confidence: "high" jika data jelas terbaca, "medium" jika ada ketidakpastian, "low" jika tidak bisa dibaca.

Kembalikan HANYA JSON valid tanpa markdown, contoh: {"amount":300000,"date":"2026-07-05","partyName":"John Doe","bankInfo":"BCA 1234567","confidence":"high"}`,
        },
        { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "high" } },
      ];
    } else {
      return res.json({ amount: null, date: null, partyName: null, bankInfo: null, confidence: "low", note: "PDF tidak didukung untuk OCR preview — upload gambar (JPG/PNG)." });
    }
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: userContent }],
      max_tokens: 300,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const amount = parsed.amount != null ? Number(String(parsed.amount).replace(/[^\d]/g, "")) : null;
    res.json({
      amount: amount && amount > 0 ? amount : null,
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      partyName: parsed.partyName ?? null,
      bankInfo: parsed.bankInfo ?? null,
      confidence: parsed.confidence ?? "medium",
    });
  } catch (e) {
    console.error("[advances/ocr-preview] error:", e);
    res.status(500).json({ message: "OCR gagal, isi nominal manual.", amount: null, date: null, confidence: "low" });
  }
});

// ── POST /:id/upload-receipt — Upload + OCR receipt for an advance ───────────
// Ported from routes/cashAdvances.ts. Purely evidentiary attachment — does not
// change lifecycle_status or bypass the state machine.
router.post("/:id/upload-receipt", upload.single("receipt"), async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    if (!req.file) return res.status(400).json({ message: "File receipt wajib diupload." });

    const companyId = resolveCompanyId(req);
    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Advance tidak ditemukan." });
    if (!await assertCompanyAccess(Number(adv.company_id) || null, companyId, req, res, { resourceType: "advance", resourceId: id })) return;

    const file = req.file;
    const ext = (file.originalname.split(".").pop() ?? "jpg").toLowerCase();
    const allowedExt = ["jpg", "jpeg", "png", "pdf", "webp"];
    if (!allowedExt.includes(ext)) {
      return res.status(400).json({ message: "Format file tidak didukung. Gunakan JPG, PNG, atau PDF." });
    }

    let receiptUrl: string | null = null;
    try {
      receiptUrl = await _objStoreSvc.uploadPrivateEntity(file.buffer, file.mimetype);
    } catch {
      // Storage optional — OCR masih bisa berjalan
    }

    let ocrResult: { amount: number | null; date: string | null; partyName: string | null; description: string | null; confidence: string } = {
      amount: null, date: null, partyName: null, description: null, confidence: "low",
    };
    try {
      const openai = getOpenAI();
      const isImage = ["jpg", "jpeg", "png", "webp"].includes(ext);
      let userContent: any[];
      if (isImage) {
        const b64 = file.buffer.toString("base64");
        const mime = file.mimetype as "image/jpeg" | "image/png" | "image/webp";
        userContent = [
          {
            type: "text",
            text: `Ini adalah struk/receipt pembayaran. Ekstrak informasi berikut dalam JSON:
- amount: nominal pembayaran (angka, tanpa tanda titik/koma, tanpa simbol mata uang)
- date: tanggal transaksi (format YYYY-MM-DD)
- partyName: nama vendor/toko/pihak penerima
- description: deskripsi singkat pembelian
- confidence: "high" jika data jelas, "medium" jika ada ketidakpastian, "low" jika tidak bisa dibaca

Kembalikan HANYA JSON valid, tidak ada teks lain.`,
          },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "high" } },
        ];
      } else {
        userContent = [{ type: "text", text: `Analisa file PDF berikut (base64): ${file.buffer.toString("base64").slice(0, 2000)}...
Ini adalah struk/receipt pembayaran. Ekstrak dalam JSON: amount (angka), date (YYYY-MM-DD), partyName (nama toko), description (deskripsi pembelian), confidence (high/medium/low).
Kembalikan HANYA JSON valid.` }];
      }
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: userContent }],
        max_tokens: 400,
        response_format: { type: "json_object" },
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw);
      ocrResult = {
        amount: parsed.amount ? Number(String(parsed.amount).replace(/[^\d]/g, "")) : null,
        date: parsed.date ?? null,
        partyName: parsed.partyName ?? null,
        description: parsed.description ?? null,
        confidence: parsed.confidence ?? "medium",
      };
    } catch (e) {
      console.error("[advances/upload-receipt] OCR failed:", e);
    }

    await db.execute(sql`
      UPDATE cash_advances
      SET receipt_url = ${receiptUrl}, ocr_raw_data = ${JSON.stringify(ocrResult)}, updated_at = NOW()
      WHERE id = ${id}
    `);

    auditFromReq(req, {
      action: "advance_receipt_uploaded", module: "advance_management",
      newData: { id, receiptUrl, ocr: ocrResult },
    });

    res.json({ receiptUrl, ocr: ocrResult, message: "Receipt berhasil diproses." });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── POST /:id/repayments/:repId/upload-receipt — Upload bukti per-repayment ──
router.post("/:id/repayments/:repId/upload-receipt", upload.single("receipt"), async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const repId = Number(req.params.repId);
    if (isNaN(id) || isNaN(repId)) return res.status(400).json({ message: "Invalid id" });
    if (!req.file) return res.status(400).json({ message: "File bukti wajib diupload." });

    const companyId = resolveCompanyId(req);
    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Advance tidak ditemukan." });
    if (!await assertCompanyAccess(Number(adv.company_id) || null, companyId, req, res, { resourceType: "advance", resourceId: id })) return;

    const file = req.file;
    const ext = (file.originalname.split(".").pop() ?? "jpg").toLowerCase();
    const allowedExt = ["jpg", "jpeg", "png", "pdf", "webp"];
    if (!allowedExt.includes(ext)) {
      return res.status(400).json({ message: "Format tidak didukung. Gunakan JPG, PNG, atau PDF." });
    }

    let receiptUrl: string | null = null;
    try {
      receiptUrl = await _objStoreSvc.uploadPrivateEntity(file.buffer, file.mimetype);
    } catch {
      return res.status(500).json({ message: "Gagal menyimpan file. Coba lagi." });
    }

    const updateResult = await db.execute(sql`
      UPDATE cash_advance_repayments SET receipt_url = ${receiptUrl} WHERE id = ${repId} AND advance_id = ${id}
    `);
    if ((updateResult.rowCount ?? 0) === 0) {
      return res.status(404).json({ message: "Cicilan tidak ditemukan untuk advance ini." });
    }

    auditFromReq(req, {
      action: "advance_repayment_receipt_uploaded", module: "advance_management",
      newData: { id, repId, receiptUrl },
    });

    res.json({ receiptUrl, message: "Bukti pengembalian berhasil diupload." });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── GET / — List advances ─────────────────────────────────────────────────────
router.get("/", async (req: Request, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const {
      advance_type, lifecycle_status, date_from, date_to,
      party_name, page, limit: limitStr, type,
    } = req.query as Record<string, string>;

    const conditions = [sql`ca.company_id = ${companyId}`];
    if (advance_type)     conditions.push(sql`ca.advance_type = ${advance_type}`);
    // Legacy compat filter — `type` is the original kasbon/talangan bucket column,
    // kept so bizportal's kasbon.tsx / talangan.tsx pages can filter without
    // needing to know the full advance_type enum (Sprint 2 migration).
    // Matched by bucket (ILIKE '%kasbon%' / not) instead of exact string so that
    // non-canonical historical/manual values like 'employee_kasbon' still land
    // in the right bucket instead of silently disappearing from both pages.
    // Bucket by substring, not exact string — historical/frontend aliases like
    // 'employee_kasbon' must still land in the 'kasbon' bucket instead of an
    // exact-match query that finds nothing once `type` is DB-normalized.
    if (type && type.toLowerCase().includes("kasbon"))        conditions.push(sql`ca.type ILIKE '%kasbon%'`);
    else if (type === "talangan") conditions.push(sql`ca.type NOT ILIKE '%kasbon%'`);
    else if (type)                conditions.push(sql`ca.type = ${type}`);
    if (lifecycle_status) conditions.push(sql`ca.lifecycle_status = ${lifecycle_status}`);
    if (date_from)        conditions.push(sql`ca.date >= ${date_from}::date`);
    if (date_to)          conditions.push(sql`ca.date <= ${date_to}::date`);
    if (party_name)       conditions.push(sql`ca.party_name ILIKE ${"%" + party_name + "%"}`);

    const pageNum  = Math.max(1, Number(page ?? 1));
    const limitNum = Math.min(200, Number(limitStr ?? 50));
    const offset   = (pageNum - 1) * limitNum;

    const [countRow] = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS total
      FROM cash_advances ca
      WHERE ${sql.join(conditions, sql` AND `)}
    `).then(r => r.rows);

    const rows = await db.execute<any>(sql`
      SELECT ca.*,
        coa_recv.code AS receivable_account_code, coa_recv.name AS receivable_account_name,
        coa_bank.code AS cash_bank_account_code,  coa_bank.name AS cash_bank_account_name,
        sup.name AS vendor_name,
        u.name   AS employee_name,   u.email AS employee_email,
        dep.name AS department_name, dv.name  AS division_name,
        src_co.company_name  AS source_company_name,
        resp_co.company_name AS responsible_company_name,
        resp_sup.name        AS responsible_vendor_name
      FROM cash_advances ca
      LEFT JOIN chart_of_accounts coa_recv ON ca.receivable_account_id  = coa_recv.id
      LEFT JOIN chart_of_accounts coa_bank ON ca.cash_bank_account_id   = coa_bank.id
      LEFT JOIN suppliers sup ON ca.vendor_id = sup.id
      LEFT JOIN users u   ON ca.user_id = u.id
      LEFT JOIN departments dep ON u.department_id = dep.id
      LEFT JOIN divisions   dv  ON u.division_id   = dv.id
      LEFT JOIN companies src_co   ON ca.source_company_id      = src_co.id
      LEFT JOIN companies resp_co  ON ca.responsible_company_id = resp_co.id
      LEFT JOIN suppliers resp_sup ON ca.responsible_vendor_id  = resp_sup.id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY ca.date DESC, ca.id DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `).then(r => r.rows);

    res.json({
      data: rows.map(serializeAdv),
      total: countRow?.total ?? 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── GET /payer-accounts — Akun kas/bank milik company tertentu (untuk dropdown pengembali) ──
// MUST be declared before /:id so Express does not swallow "payer-accounts" as an id param.
router.get("/payer-accounts", async (req: Request, res) => {
  try {
    const targetCompanyId = req.query.company_id ? Number(req.query.company_id) : null;
    if (!targetCompanyId) return res.status(400).json({ message: "company_id wajib diisi" });
    const allowedCompanyIds = getAllowedCompanyIds(req);
    if (allowedCompanyIds && !allowedCompanyIds.includes(targetCompanyId)) {
      return res.status(403).json({
        message: "Anda tidak memiliki akses ke akun perusahaan ini.",
        code: "COMPANY_ACCESS_DENIED",
      });
    }

    const rows = await db.execute<{ id: number; code: string; name: string; subtype: string | null }>(sql`
      SELECT id, code, name, subtype
      FROM chart_of_accounts
      WHERE company_id = ${targetCompanyId}
        AND type = 'asset'
        AND is_active = true
        AND (
          subtype = 'cash_bank'
          OR code LIKE '1-101%'
          OR code LIKE '1-102%'
        )
      ORDER BY code
    `).then(r => r.rows);

    const result = rows.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      account_class: r.code.startsWith("1-101") ? "kas" : "bank",
    }));
    res.json(result);
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── GET /intercompany-payables — Hutang intercompany perusahaan aktif ─────────
router.get("/intercompany-payables", async (req: Request, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const rows = await db.execute<any>(sql`
      SELECT ca.id, ca.advance_number, ca.date, ca.amount,
             ca.paid_amount, ca.remaining_amount, ca.intercompany_status,
             ca.intercompany_reference, ca.funding_company_id,
             ca.responsible_company_id,
             fc.company_name AS funding_company_name,
             rc.company_name AS responsible_company_name,
             ca.party_name, ca.category, ca.purpose,
             ca.responsible_entry_id, ca.funding_entry_id
      FROM cash_advances ca
      LEFT JOIN companies fc ON fc.id = ca.funding_company_id
      LEFT JOIN companies rc ON rc.id = ca.responsible_company_id
      WHERE ca.responsible_company_id = ${companyId}
        AND ca.funding_company_id IS NOT NULL
        AND ca.funding_company_id <> ca.responsible_company_id
        AND COALESCE(ca.intercompany_status, 'open') <> 'settled'
      ORDER BY ca.date DESC, ca.id DESC
    `).then(r => r.rows);
    res.json({
      data: rows.map((row: any) => ({
        ...row,
        amount: Number(row.amount) || 0,
        paid_amount: Number(row.paid_amount) || 0,
        remaining_amount: Number(row.remaining_amount) || 0,
        status: row.intercompany_status ?? "open",
      })),
      total: rows.length,
    });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── GET /intercompany-receivables — Piutang intercompany perusahaan aktif ─────
router.get("/intercompany-receivables", async (req: Request, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const rows = await db.execute<any>(sql`
      SELECT ca.id, ca.advance_number, ca.date, ca.amount,
             ca.paid_amount, ca.remaining_amount, ca.intercompany_status,
             ca.intercompany_reference, ca.funding_company_id,
             ca.responsible_company_id,
             fc.company_name AS funding_company_name,
             rc.company_name AS responsible_company_name,
             ca.party_name, ca.category, ca.purpose,
             ca.responsible_entry_id, ca.funding_entry_id
      FROM cash_advances ca
      LEFT JOIN companies fc ON fc.id = ca.funding_company_id
      LEFT JOIN companies rc ON rc.id = ca.responsible_company_id
      WHERE ca.funding_company_id = ${companyId}
        AND ca.responsible_company_id IS NOT NULL
        AND ca.funding_company_id <> ca.responsible_company_id
        AND COALESCE(ca.intercompany_status, 'open') <> 'settled'
      ORDER BY ca.date DESC, ca.id DESC
    `).then(r => r.rows);
    res.json({
      data: rows.map((row: any) => ({
        ...row,
        amount: Number(row.amount) || 0,
        paid_amount: Number(row.paid_amount) || 0,
        remaining_amount: Number(row.remaining_amount) || 0,
        status: row.intercompany_status ?? "open",
      })),
      total: rows.length,
    });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── GET /:id — Detail ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const companyId = resolveCompanyId(req);

    const [adv] = await db.execute<any>(sql`
      SELECT ca.*,
        coa_recv.code AS receivable_account_code, coa_recv.name AS receivable_account_name,
        coa_bank.code AS cash_bank_account_code,  coa_bank.name AS cash_bank_account_name,
        sup.name AS vendor_name,
        u.name   AS employee_name, u.email AS employee_email,
        dep.name AS department_name, dv.name  AS division_name,
        -- Dana Talangan: resolved names dari ID references
        src_co.company_name   AS source_company_name,
        resp_co.company_name  AS responsible_company_name,
        resp_sup.name         AS responsible_vendor_name,
        resp_u.name           AS responsible_employee_name
      FROM cash_advances ca
      LEFT JOIN chart_of_accounts coa_recv ON ca.receivable_account_id  = coa_recv.id
      LEFT JOIN chart_of_accounts coa_bank ON ca.cash_bank_account_id   = coa_bank.id
      LEFT JOIN suppliers sup ON ca.vendor_id = sup.id
      LEFT JOIN users u   ON ca.user_id = u.id
      LEFT JOIN departments dep ON u.department_id = dep.id
      LEFT JOIN divisions   dv  ON u.division_id   = dv.id
      -- Talangan extended: sumber dana & penanggung
      LEFT JOIN companies src_co   ON ca.source_company_id      = src_co.id
      LEFT JOIN companies resp_co  ON ca.responsible_company_id = resp_co.id
      LEFT JOIN suppliers resp_sup ON ca.responsible_vendor_id  = resp_sup.id
      LEFT JOIN users resp_u       ON resp_u.id::text = ca.responsible_employee_id
      WHERE ca.id = ${id}
    `).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });
    if (!await assertCompanyAccess(Number(adv.company_id) || null, companyId, req, res, { resourceType: "advance", resourceId: id })) return;

    const settlements = await db.execute<any>(sql`
      SELECT s.*,
        coa.code AS bank_account_code, coa.name AS bank_account_name,
        json_agg(
          json_build_object(
            'id', al.id, 'allocation_type', al.allocation_type,
            'reference_doc_id', al.reference_doc_id, 'reference_doc_type', al.reference_doc_type,
            'coa_id', al.coa_id, 'coa_code', coa2.code, 'coa_name', coa2.name,
            'amount', al.amount::numeric, 'remarks', al.remarks
          ) ORDER BY al.id
        ) FILTER (WHERE al.id IS NOT NULL) AS allocation_lines
      FROM advance_settlements s
      LEFT JOIN chart_of_accounts coa  ON s.bank_account_id = coa.id
      LEFT JOIN advance_allocation_lines al ON al.settlement_id = s.id
      LEFT JOIN chart_of_accounts coa2 ON al.coa_id = coa2.id
      WHERE s.advance_id = ${id}
      GROUP BY s.id, coa.code, coa.name
      ORDER BY s.date DESC, s.id DESC
    `).then(r => r.rows).catch(() => [] as any[]);

    // Legacy repayments — with COA and company name JOINs for history display
    const repayments = await db.execute<any>(sql`
      SELECT r.*,
        pc.company_name   AS payer_company_name,
        pc_coa.code       AS payer_coa_code,  pc_coa.name  AS payer_coa_name,
        rc_coa.code       AS receiver_coa_code, rc_coa.name AS receiver_coa_name,
        rc.company_name   AS receiver_company_name
      FROM cash_advance_repayments r
      LEFT JOIN companies           pc     ON r.payer_company_id     = pc.id
      LEFT JOIN companies           rc     ON r.receiver_company_id  = rc.id
      LEFT JOIN chart_of_accounts   pc_coa ON r.payer_coa_account_id    = pc_coa.id
      LEFT JOIN chart_of_accounts   rc_coa ON r.receiver_coa_account_id = rc_coa.id
      WHERE r.advance_id = ${id}
      ORDER BY r.date DESC, r.id DESC
    `).then(r => r.rows).catch(() => [] as any[]);

    // Auto-mark overdue installments then fetch schedule
    await db.execute(sql`
      UPDATE cash_advance_installment_schedules
      SET status = 'overdue', updated_at = NOW()
      WHERE advance_id = ${id} AND status = 'pending' AND due_date < CURRENT_DATE
    `).catch(() => {});
    const installment_schedule = await db.execute<any>(sql`
      SELECT s.*, r.date AS repayment_date
      FROM cash_advance_installment_schedules s
      LEFT JOIN cash_advance_repayments r ON r.id = s.repayment_id
      WHERE s.advance_id = ${id}
      ORDER BY s.installment_number ASC
    `).then(r => r.rows).catch(() => [] as any[]);

    // Approval trail — read-only join against the existing expense_approval_requests
    // table so the frontend's approval-trail UI keeps working after migrating off
    // the legacy engine (Sprint 2B parity, no schema/logic change).
    const [approvalRequest] = await db.execute<any>(sql`
      SELECT * FROM expense_approval_requests
      WHERE ref_type IN ('kasbon','talangan') AND ref_id = ${id}
      ORDER BY id DESC LIMIT 1
    `).then(r => r.rows).catch(() => [] as any[]);

    res.json({ ...serializeAdv(adv), settlements, repayments, installment_schedule, approvalRequest: approvalRequest ?? null });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── POST / — Create advance ───────────────────────────────────────────────────
router.post("/", async (req: Request, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const {
      advance_type, party_name, amount, date, purpose, notes,
      payment_method, counterparty_type, vendor_id, user_id, project_id,
      department_id, division_id, currency, exchange_rate, category,
      // Dana Talangan extended fields
      category_other, funding_source_type,
      source_company_id, source_bank_name, source_party_name,
      responsible_party_type, responsible_company_id, responsible_bank_name,
      responsible_vendor_id, responsible_employee_id, responsible_party_name,
      reference_number,
    } = req.body;
    let { receivable_account_id, cash_bank_account_id } = req.body;

    if (!ADVANCE_TYPES.includes(advance_type)) {
      return res.status(400).json({ message: `advance_type harus salah satu dari: ${ADVANCE_TYPES.join(", ")}` });
    }
    if (!party_name?.trim()) return res.status(400).json({ message: "party_name wajib diisi" });
    const amountN = Number(amount);
    if (!amount || amountN <= 0) return res.status(400).json({ message: "amount harus > 0" });
    if (!date) return res.status(400).json({ message: "date wajib diisi" });

    // ── Validasi tambahan khusus Dana Talangan ───────────────────────────────
    const isTalangan = advance_type !== "EMPLOYEE";
    const VALID_FUNDING_SOURCES = ["kas_perusahaan", "rekening_bank", "perusahaan_lain", "bank", "pribadi", "pihak_lain"] as const;
    const VALID_RESPONSIBLE_TYPES = ["perusahaan_aktif", "perusahaan_lain", "bank", "vendor", "karyawan", "pihak_lain"] as const;

    if (isTalangan) {
      // ── Top-level wajib ──
      if (!category?.trim()) return res.status(400).json({ message: "Kategori dana talangan wajib diisi." });
      if (category === "lainnya" && !category_other?.trim()) return res.status(400).json({ message: "Kategori Lainnya wajib diisi saat memilih 'Lainnya'." });
      if (!purpose?.trim()) return res.status(400).json({ message: "Tujuan / keperluan dana talangan wajib diisi." });
      if (!funding_source_type) return res.status(400).json({ message: "Sumber dana wajib dipilih." });
      if (!VALID_FUNDING_SOURCES.includes(funding_source_type as any)) return res.status(400).json({ message: `funding_source_type tidak valid. Pilih salah satu: ${VALID_FUNDING_SOURCES.join(", ")}` });
      if (!responsible_party_type) return res.status(400).json({ message: "Pihak yang bertanggung jawab wajib dipilih." });
      if (!VALID_RESPONSIBLE_TYPES.includes(responsible_party_type as any)) return res.status(400).json({ message: `responsible_party_type tidak valid. Pilih salah satu: ${VALID_RESPONSIBLE_TYPES.join(", ")}` });

      // ── Matriks validasi kondisional: sumber dana ──
      switch (funding_source_type) {
        case "kas_perusahaan":
        case "rekening_bank":
          // cash_bank_account_id wajib — divalidasi di bawah setelah auto-resolve
          break;
        case "perusahaan_lain":
          if (!source_company_id && !source_party_name?.trim()) {
            return res.status(400).json({ message: "Pilih perusahaan sumber dana atau isi nama perusahaan secara manual." });
          }
          break;
        case "bank":
          if (!source_bank_name?.trim()) {
            return res.status(400).json({ message: "Nama bank sumber dana wajib diisi." });
          }
          break;
        case "pribadi":
        case "pihak_lain":
          if (!source_party_name?.trim()) {
            return res.status(400).json({ message: "Nama pemberi dana wajib diisi." });
          }
          break;
      }

      // ── Matriks validasi kondisional: pihak penanggung ──
      switch (responsible_party_type) {
        case "perusahaan_aktif":
          // Otomatis dari header — tidak perlu input tambahan
          break;
        case "perusahaan_lain":
          if (!responsible_company_id && !responsible_party_name?.trim()) {
            return res.status(400).json({ message: "Pilih perusahaan penanggung atau isi nama perusahaan secara manual." });
          }
          break;
        case "bank":
          if (!responsible_bank_name?.trim()) {
            return res.status(400).json({ message: "Nama bank penanggung wajib diisi." });
          }
          break;
        case "vendor":
          if (!responsible_vendor_id) {
            return res.status(400).json({ message: "Pilih vendor penanggung." });
          }
          break;
        case "karyawan":
          // ID opsional — bisa manual name juga
          if (!responsible_employee_id && !responsible_party_name?.trim()) {
            return res.status(400).json({ message: "Pilih atau isi nama karyawan / direksi penanggung." });
          }
          break;
        case "pihak_lain":
          if (!responsible_party_name?.trim()) {
            return res.status(400).json({ message: "Nama pihak penanggung wajib diisi." });
          }
          break;
      }
    }

    // Server-side company validation: only active internal companies may be
    // used for a paired intercompany posting, and the two books must differ.
    let sourceCompanyRow: { id: number; company_name: string } | null = null;
    let responsibleCompanyRow: { id: number; company_name: string } | null = null;
    if (source_company_id) {
      sourceCompanyRow = (await db.execute<{ id: number; company_name: string }>(sql`
        SELECT id, company_name
        FROM companies
        WHERE id = ${Number(source_company_id)}
          AND is_active IS DISTINCT FROM false
        LIMIT 1
      `).then(r => r.rows))[0] ?? null;
      if (!sourceCompanyRow) {
        return res.status(400).json({ message: "Perusahaan sumber dana tidak ditemukan atau tidak aktif.", code: "INVALID_FUNDING_COMPANY" });
      }
      if (Number(source_company_id) === companyId) {
        return res.status(400).json({ message: "Perusahaan sumber dana harus berbeda dari perusahaan aktif.", code: "SAME_INTERCOMPANY_COMPANY" });
      }
    }
    if (responsible_company_id) {
      responsibleCompanyRow = (await db.execute<{ id: number; company_name: string }>(sql`
        SELECT id, company_name
        FROM companies
        WHERE id = ${Number(responsible_company_id)}
          AND is_active IS DISTINCT FROM false
        LIMIT 1
      `).then(r => r.rows))[0] ?? null;
      if (!responsibleCompanyRow) {
        return res.status(400).json({ message: "Perusahaan penanggung tidak ditemukan atau tidak aktif.", code: "INVALID_RESPONSIBLE_COMPANY" });
      }
    }
    if (
      sourceCompanyRow &&
      responsibleCompanyRow &&
      sourceCompanyRow.id === responsibleCompanyRow.id
    ) {
      return res.status(400).json({ message: "Perusahaan sumber dana dan penanggung tidak boleh sama.", code: "SAME_INTERCOMPANY_COMPANY" });
    }
    const allowedCompanyIds = getAllowedCompanyIds(req);
    if (
      allowedCompanyIds &&
      ((sourceCompanyRow && !allowedCompanyIds.includes(sourceCompanyRow.id)) ||
        (responsibleCompanyRow && !allowedCompanyIds.includes(responsibleCompanyRow.id)))
    ) {
      return res.status(403).json({
        message: "Anda tidak memiliki akses ke kedua perusahaan untuk transaksi intercompany.",
        code: "COMPANY_ACCESS_DENIED",
      });
    }

    const internalFundingCompanyId =
      funding_source_type === "perusahaan_lain" && source_company_id
        ? Number(source_company_id)
        : companyId;
    const isInternalFunding = Boolean(
      funding_source_type === "perusahaan_lain" && source_company_id,
    );
    const isOwnFunds = !funding_source_type || ["kas_perusahaan", "rekening_bank"].includes(funding_source_type);
    // Perusahaan lain adalah sumber internal yang tetap harus diposting berpasangan.
    // Sumber eksternal (bank/pribadi/pihak lain) tetap dicatat manual.
    if (!isOwnFunds && !isInternalFunding) {
      cash_bank_account_id = null;
    }

    // Auto-resolve receivable + cash/bank accounts when not explicitly provided,
    // mirroring routes/cashAdvances.ts so the unified engine has feature parity.
    if (!receivable_account_id) {
      receivable_account_id = await resolveReceivableAccount(advance_type, companyId);
    }
    if ((isOwnFunds || isInternalFunding) && !cash_bank_account_id) {
      const settings = await ensureAccountingSettings(internalFundingCompanyId);
      cash_bank_account_id = await resolveCashBankAccount(payment_method ?? "bank", settings);
    }

    // Validasi kas/bank account wajib diisi jika sumber dana dari kas/bank perusahaan
    if (isTalangan && (isOwnFunds || isInternalFunding) && !cash_bank_account_id) {
      return res.status(400).json({ message: "Akun kas / rekening bank perusahaan wajib dipilih sebagai sumber dana." });
    }

    // ── Bangun deskripsi jurnal yang diperkaya (semua branch) ───────────────
    let journalDescription: string | undefined;
    if (isTalangan && category) {
      const katLabel = category === "lainnya" ? (category_other?.trim() || "Lainnya") : category.trim();
      const parts: string[] = [`Dana Talangan – ${katLabel}`];

      // Sumber dana
      const fundingLabel: Record<string, string> = {
        kas_perusahaan: "Kas Perusahaan", rekening_bank: "Rekening Bank",
        perusahaan_lain: "Perusahaan Lain", bank: "Dana Bank",
        pribadi: "Dana Pribadi", pihak_lain: "Pihak Lain",
      };
      const fundingDetail =
        funding_source_type === "bank" ? (source_bank_name?.trim() ?? "") :
        funding_source_type === "perusahaan_lain" ? (source_party_name?.trim() ?? "") :
        ["pribadi", "pihak_lain"].includes(funding_source_type ?? "") ? (source_party_name?.trim() ?? "") : "";
      const fundingPart = [fundingLabel[funding_source_type ?? ""] ?? "", fundingDetail].filter(Boolean).join(": ");
      if (fundingPart) parts.push(`Sumber: ${fundingPart}`);

      // Tujuan
      if (purpose?.trim()) parts.push(String(purpose).trim().substring(0, 80));

      // Pihak penanggung
      const responsibleLabel: Record<string, string> = {
        perusahaan_aktif: "Perusahaan Aktif", perusahaan_lain: "Perusahaan Lain",
        bank: "Bank", vendor: "Vendor", karyawan: "Karyawan/Direksi", pihak_lain: "Pihak Lain",
      };
      const responsibleDetail =
        responsible_party_type === "perusahaan_aktif" ? "" :
        responsible_party_type === "bank" ? (responsible_bank_name?.trim() ?? "") :
        (responsible_party_name?.trim() ?? "");
      const responsiblePart = [responsibleLabel[responsible_party_type ?? ""] ?? "", responsibleDetail].filter(Boolean).join(": ");
      if (responsiblePart) parts.push(`Penanggung: ${responsiblePart}`);

      journalDescription = parts.join(" · ");
    }

    // Server decides approval routing based on expense_approval_limits — this
    // MUST NOT be controllable by the client (state-machine bypass guard).
    const { needsApproval, limit } = await checkApprovalLimit(advance_type, companyId, amountN);
    const advanceNumber = await generateAdvanceNumber(companyId, advance_type);
    const initialStatus = needsApproval ? "pending_approval" : "approved";

    const [created] = await db.execute<any>(sql`
      INSERT INTO cash_advances (
        company_id, advance_number, type, advance_type, lifecycle_status,
        party_name, amount, remaining_amount, paid_amount, settled_amount,
        date, notes, payment_method,
        receivable_account_id, cash_bank_account_id,
        counterparty_type, vendor_id, user_id, project_id,
        department_id, division_id, purpose,
        currency, exchange_rate, source_system,
        status, created_by_id, created_at, updated_at
      ) VALUES (
        ${companyId}, ${advanceNumber},
        ${advance_type === "EMPLOYEE" ? "employee_kasbon" : "talangan"},
        ${advance_type}, ${initialStatus},
        ${party_name.trim()}, ${amountN}, ${amountN}, 0, 0,
        ${date}, ${notes ?? null}, ${payment_method ?? "bank"},
        ${receivable_account_id ?? null}, ${cash_bank_account_id ?? null},
        ${counterparty_type ?? null}, ${vendor_id ?? null}, ${user_id ?? null}, ${project_id ?? null},
        ${department_id ?? null}, ${division_id ?? null}, ${purpose ?? null},
        ${currency ?? "IDR"}, ${exchange_rate ?? 1}, 'advance_management',
        ${initialStatus === "pending_approval" ? "pending_approval" : "active"},
        ${(req as any).user?.id ?? null}, NOW(), NOW()
      )
      RETURNING *
    `).then(r => r.rows);

    if (!needsApproval) {
      // Under the auto-approve limit — disburse immediately once accounts are known,
      // matching legacy single-step create behavior for small advances.
      if (receivable_account_id && cash_bank_account_id) {
        const responsibleCompanyId =
          responsible_company_id && ["perusahaan_lain", "perusahaan_aktif"].includes(responsible_party_type ?? "")
            ? Number(responsible_company_id)
            : companyId;
        const isInternalPair = Boolean(
          ["perusahaan_lain", "perusahaan_aktif"].includes(responsible_party_type ?? "") &&
          internalFundingCompanyId !== responsibleCompanyId,
        );
        if (isInternalPair) {
          const accounts = await resolveIntercompanyAccounts({
            fundingCompanyId: internalFundingCompanyId,
            responsibleCompanyId,
            category,
          });
          const [fundingCash] = await db.execute<{ id: number }>(sql`
            SELECT id FROM chart_of_accounts
            WHERE id = ${Number(cash_bank_account_id)}
              AND company_id = ${internalFundingCompanyId}
              AND type = 'asset' AND is_active = true
              AND (subtype = 'cash_bank' OR code LIKE '1-101%' OR code LIKE '1-102%')
            LIMIT 1
          `).then(r => r.rows);
          if (!fundingCash) {
            throw new Error("Akun kas/bank sumber dana tidak valid atau bukan milik perusahaan pemberi dana.");
          }
          const pair = await AdvanceJournalService.postIntercompanyDisbursementPair({
            fundingCompanyId: internalFundingCompanyId,
            responsibleCompanyId,
            advanceNumber,
            partyName: party_name,
            category,
            purpose,
            amount: amountN,
            date,
            fundingReceivableAccountId: accounts.fundingReceivable.id,
            fundingCashBankAccountId: Number(fundingCash.id),
            responsibleExpenseAccountId: accounts.responsibleExpense.id,
            responsiblePayableAccountId: accounts.responsiblePayable.id,
            sourceAdvanceId: created.id,
            afterPost: async (tx, entries) => {
              await tx.execute(sql`
                UPDATE cash_advances
                SET entry_id = ${entries.sourceEntry.id},
                    funding_entry_id = ${entries.sourceEntry.id},
                    responsible_entry_id = ${entries.mirrorEntry.id},
                    funding_company_id = ${internalFundingCompanyId},
                    intercompany_reference = ${`IC-ADV-${advanceNumber}`},
                    intercompany_status = 'open',
                    lifecycle_status = 'outstanding', status = 'active',
                    disbursed_at = NOW(), disbursed_by = ${(req as any).user?.id ?? null},
                    updated_at = NOW()
                WHERE id = ${created.id}
              `);
              await tx.execute(sql`
                INSERT INTO ar_subledger (
                  company_id, invoice_id, invoice_number, invoice_date, currency,
                  gross_amount, outstanding_amount, paid_amount, status, gl_entry_id,
                  period, notes, updated_at
                ) VALUES (
                  ${internalFundingCompanyId}, ${created.id}, ${advanceNumber}, ${date},
                  ${currency ?? "IDR"}, ${amountN}, ${amountN}, 0, 'OPEN',
                  ${entries.sourceEntry.id}, ${String(date).slice(0, 7)},
                  ${`Piutang intercompany Dana Talangan ${advanceNumber}`}, NOW()
                )
                ON CONFLICT (company_id, invoice_id) WHERE invoice_id IS NOT NULL
                DO UPDATE SET
                  gross_amount = EXCLUDED.gross_amount,
                  outstanding_amount = EXCLUDED.outstanding_amount,
                  gl_entry_id = EXCLUDED.gl_entry_id,
                  updated_at = NOW()
              `);
              await tx.execute(sql`
                INSERT INTO ap_subledger (
                  company_id, bill_id, bill_number, bill_date, currency,
                  payable_amount, paid_amount, status, gl_entry_id,
                  period, notes, updated_at
                ) VALUES (
                  ${responsibleCompanyId}, ${created.id}, ${advanceNumber}, ${date},
                  ${currency ?? "IDR"}, ${amountN}, 0, 'OPEN',
                  ${entries.mirrorEntry.id}, ${String(date).slice(0, 7)},
                  ${`Hutang intercompany Dana Talangan ${advanceNumber}`}, NOW()
                )
                ON CONFLICT (company_id, bill_id) WHERE bill_id IS NOT NULL
                DO UPDATE SET
                  payable_amount = EXCLUDED.payable_amount,
                  gl_entry_id = EXCLUDED.gl_entry_id,
                  updated_at = NOW()
              `);
            },
          });
          void pair;
        } else {
          const { entryId: autoEntryId } = await AdvanceJournalService.postDisbursementJournal({
            companyId,
            advanceNumber,
            partyName: party_name,
            advanceType: advance_type,
            amount: amountN,
            date,
            receivableAccountId: Number(receivable_account_id),
            cashBankAccountId: Number(cash_bank_account_id),
            paymentMethod: payment_method ?? "bank",
            description: journalDescription,
          });
          await db.execute(sql`
            UPDATE cash_advances
            SET entry_id = ${autoEntryId}, lifecycle_status = 'disbursed', status = 'active',
                disbursed_at = NOW(), disbursed_by = ${(req as any).user?.id ?? null}
            WHERE id = ${created.id}
          `);
        }
      }
    } else {
      // Needs approval — create the expense_approval_requests row so the existing
      // approvals.tsx/dashboard.tsx surfaces keep working unchanged (Sprint 2:
      // no new approval UI, reuse existing pending-approval infrastructure).
      let requesterName: string | null = null;
      const creatorUserId = (req as any).user?.id ?? null;
      if (creatorUserId) {
        const ur = await db.execute(sql`SELECT name FROM users WHERE id = ${creatorUserId} LIMIT 1`);
        requesterName = (ur.rows[0] as any)?.name ?? null;
      }
      let l1Name: string | null = null, l2Name: string | null = null;
      if (limit?.l1_approver_id) {
        const r = await db.execute(sql`SELECT name FROM users WHERE id = ${limit.l1_approver_id} LIMIT 1`);
        l1Name = (r.rows[0] as any)?.name ?? null;
      }
      if (limit?.l2_approver_id) {
        const r = await db.execute(sql`SELECT name FROM users WHERE id = ${limit.l2_approver_id} LIMIT 1`);
        l2Name = (r.rows[0] as any)?.name ?? null;
      }
      const refType = advance_type === "EMPLOYEE" ? "kasbon" : "talangan";
      const typeLabel = refType === "kasbon" ? "Kasbon" : "Dana Talangan";
      const desc = `${typeLabel} ${party_name} — ${new Intl.NumberFormat("id-ID").format(amountN)}`;

      const arResult = await db.execute(sql`
        INSERT INTO expense_approval_requests
          (company_id, ref_type, ref_id, description, amount, requester_id, requester_name,
           status, l1_approver_id, l1_approver_name, l1_status,
           l2_approver_id, l2_approver_name, l2_status)
        VALUES
          (
            ${companyId}, ${refType}, ${created.id}, ${desc}, ${amountN},
            ${creatorUserId}, ${requesterName}, 'pending',
            ${limit?.l1_approver_id ?? null}, ${l1Name}, ${limit?.l1_approver_id ? "pending" : null},
            ${limit?.l2_approver_id ?? null}, ${l2Name}, ${limit?.l2_approver_id ? "pending" : null}
          )
        RETURNING id
      `);
      const arId = (arResult.rows[0] as any)?.id;
      if (arId) {
        await db.execute(sql`UPDATE cash_advances SET approval_request_id = ${arId} WHERE id = ${created.id}`).catch(() => {});
      }

      try {
        const { getAdminGroupWa } = await import("../lib/adminWa.js");
        const { sendViaService: sendWhatsApp } = await import("../lib/waTransport.js");
        const adminGroup = await getAdminGroupWa();
        if (adminGroup) {
          const approverInfo = l1Name ? `Menunggu persetujuan: *${l1Name}*` : "Tidak ada approver yang dikonfigurasi";
          const msg = `🔔 *Permintaan ${typeLabel} Baru*\n\nNo: ${advanceNumber}\nNama: ${party_name}\nNominal: Rp ${new Intl.NumberFormat("id-ID").format(amountN)}\n${approverInfo}`;
          sendWhatsApp(adminGroup, msg, { context: "expense_approval_request", refId: String(arId) }).catch(() => {});
        }
      } catch { /* non-fatal */ }
    }

    // Simpan category + semua field extended Dana Talangan via UPDATE post-insert
    // (Pendekatan ini menjaga agar perubahan schema tetap backward-compatible)
    const categoryVal = category ? String(category).trim() : null;
    await db.execute(sql`
      UPDATE cash_advances SET
        category                = ${categoryVal},
        category_other          = ${category_other ? String(category_other).trim() : null},
        funding_source_type     = ${funding_source_type ?? null},
        source_company_id       = ${source_company_id ? Number(source_company_id) : null},
        source_bank_name        = ${source_bank_name ? String(source_bank_name).trim() : null},
        source_party_name       = ${source_party_name ? String(source_party_name).trim() : null},
        responsible_party_type  = ${responsible_party_type ?? null},
        responsible_company_id  = ${responsible_company_id ? Number(responsible_company_id) : null},
        responsible_bank_name   = ${responsible_bank_name ? String(responsible_bank_name).trim() : null},
        responsible_vendor_id   = ${responsible_vendor_id ? Number(responsible_vendor_id) : null},
        responsible_employee_id = ${responsible_employee_id ?? null},
        responsible_party_name  = ${responsible_party_name ? String(responsible_party_name).trim() : null},
        reference_number        = ${reference_number ? String(reference_number).trim() : null}
      WHERE id = ${created.id}
    `).catch((e: any) => console.warn("[advances] gagal simpan extended fields:", e?.message));

    auditFromReq(req, {
      action: "advance_created", module: "advance_management",
      newData: { id: created.id, advance_number: advanceNumber, advance_type, amount: amountN, party_name, needsApproval, category: categoryVal, funding_source_type, responsible_party_type },
    });

    const [finalRow] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${created.id}`).then(r => r.rows);
    res.status(201).json({ ...serializeAdv(finalRow ?? created), needsApproval });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── PATCH /:id/update-responsible — koreksi pihak penanggung jawab ───────────
router.patch("/:id/update-responsible", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const [adv] = await db.execute<any>(
      sql`SELECT id, lifecycle_status, status FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`
    ).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    // Hanya boleh diedit jika belum void/repaid/settled
    const lockedStatuses = ["void", "repaid", "settled", "reversed"];
    const curStatus = adv.lifecycle_status ?? adv.status;
    if (lockedStatuses.includes(curStatus)) {
      return res.status(400).json({ message: `Dana talangan dengan status '${curStatus}' tidak dapat diubah penanggung jawabnya.` });
    }

    const {
      responsible_party_type, responsible_company_id,
      responsible_vendor_id, responsible_employee_id,
      responsible_bank_name, responsible_party_name,
    } = req.body;

    const VALID_RESPONSIBLE_TYPES = ["perusahaan_aktif", "perusahaan_lain", "bank", "vendor", "karyawan", "pihak_lain"] as const;
    if (!responsible_party_type || !VALID_RESPONSIBLE_TYPES.includes(responsible_party_type as any)) {
      return res.status(400).json({ message: "responsible_party_type tidak valid." });
    }

    await db.execute(sql`
      UPDATE cash_advances SET
        responsible_party_type  = ${responsible_party_type},
        responsible_company_id  = ${responsible_company_id ? Number(responsible_company_id) : null},
        responsible_vendor_id   = ${responsible_vendor_id ? Number(responsible_vendor_id) : null},
        responsible_employee_id = ${responsible_employee_id ?? null},
        responsible_bank_name   = ${responsible_bank_name ? String(responsible_bank_name).trim() : null},
        responsible_party_name  = ${responsible_party_name ? String(responsible_party_name).trim() : null},
        updated_at              = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `);

    auditFromReq(req, {
      action: "advance_responsible_updated", module: "advance_management",
      newData: { id, responsible_party_type, responsible_company_id },
    });

    res.json({ success: true });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── PATCH /:id/approve ────────────────────────────────────────────────────────
router.patch("/:id/approve", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });
    const currentStatus = (adv.lifecycle_status ?? adv.status) as LifecycleStatus;
    if (!["pending_approval", "draft"].includes(currentStatus)) {
      return res.status(400).json({
        message: `Advance dengan status '${currentStatus}' tidak bisa diapprove.`,
        code: "INVALID_TRANSITION",
      });
    }
    await db.execute(sql`
      UPDATE cash_advances
      SET lifecycle_status = 'approved', status = 'active',
          approved_by = ${(req as any).user?.id ?? null}, approved_at = NOW(), updated_at = NOW()
      WHERE id = ${id}
    `);
    // Keep expense_approval_requests in sync so approvals.tsx / dashboard.tsx
    // (which read from that table, not cash_advances) do not show stale
    // "pending" items forever once advances migrate off the legacy engine.
    await db.execute(sql`
      UPDATE expense_approval_requests
      SET l1_status = 'approved', status = 'approved', updated_at = NOW()
      WHERE ref_type IN ('kasbon','talangan') AND ref_id = ${id}
    `).catch(() => {});
    auditFromReq(req, {
      action: "advance_approved", module: "advance_management",
      newData: { id },
    });
    res.json({ success: true });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── PATCH /:id/reject ─────────────────────────────────────────────────────────
router.patch("/:id/reject", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const { reason } = req.body;
    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });
    const currentStatus = (adv.lifecycle_status ?? adv.status) as LifecycleStatus;
    if (!["pending_approval", "draft"].includes(currentStatus)) {
      return res.status(400).json({ message: `Advance dengan status '${currentStatus}' tidak bisa ditolak`, code: "INVALID_TRANSITION" });
    }
    // FIX: lifecycle_status must be 'rejected', not 'void'
    await db.execute(sql`
      UPDATE cash_advances
      SET lifecycle_status = 'rejected', status = 'rejected',
          rejection_reason = ${reason ?? null}, updated_at = NOW()
      WHERE id = ${id}
    `);
    await db.execute(sql`
      UPDATE expense_approval_requests
      SET l1_status = 'rejected', l1_notes = ${reason ?? null}, status = 'rejected', updated_at = NOW()
      WHERE ref_type IN ('kasbon','talangan') AND ref_id = ${id}
    `).catch(() => {});
    auditFromReq(req, {
      action: "advance_rejected", module: "advance_management",
      newData: { id, reason },
    });
    res.json({ success: true });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── PATCH /:id/disburse — Post disbursement journal ──────────────────────────
router.patch("/:id/disburse", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    // STATE MACHINE: only 'approved' may be disbursed — prevents approval bypass
    const currentStatus = (adv.lifecycle_status ?? adv.status) as LifecycleStatus;
    if (currentStatus !== "approved") {
      return res.status(400).json({
        message: `Hanya advance dengan status 'approved' yang bisa di-disburse. Status saat ini: '${currentStatus}'. Approve terlebih dahulu.`,
        code: "INVALID_TRANSITION",
      });
    }

    // ── EXTERNAL FUNDING GUARD ─────────────────────────────────────────────
    // Dana Talangan dengan sumber dana eksternal (bukan kas/rekening perusahaan)
    // tidak boleh auto-post jurnal — pencairan dicatat secara manual.
    // Endpoint ini hanya mengubah status; tidak ada jurnal yang dibuat.
    const EXTERNAL_FUNDING_TYPES = ["bank", "pribadi", "pihak_lain"];
    const fundingSourceType = adv.funding_source_type as string | null;
    if (fundingSourceType && EXTERNAL_FUNDING_TYPES.includes(fundingSourceType)) {
      if (adv.entry_id) {
        return res.status(400).json({ message: "Jurnal disbursement sudah pernah diposting", code: "DUPLICATE_JOURNAL" });
      }
      // Hanya update status — tidak post jurnal
      await db.execute(sql`
        UPDATE cash_advances
        SET lifecycle_status = 'outstanding', status = 'active',
            disbursed_at = NOW(), disbursed_by = ${(req as any).user?.id ?? null},
            updated_at = NOW()
        WHERE id = ${id}
      `);
      auditFromReq(req, {
        action: "advance_disbursed_external", module: "advance_management",
        newData: { id, funding_source_type: fundingSourceType, note: "Pencairan dana eksternal — jurnal manual diperlukan" },
      });
      return res.json({ success: true, entry_id: null, note: "Dana dari sumber eksternal. Jurnal dicatat secara manual." });
    }
    // ── END EXTERNAL FUNDING GUARD ─────────────────────────────────────────

    // Auto-resolve accounts if not yet linked (e.g. created before COA existed)
    let receivableAccountId = adv.receivable_account_id ? Number(adv.receivable_account_id) : null;
    let cashBankAccountId   = adv.cash_bank_account_id  ? Number(adv.cash_bank_account_id)  : null;

    if (!receivableAccountId || !cashBankAccountId) {
      const settings = await ensureAccountingSettings(companyId);
      if (!receivableAccountId) {
        // Normalize fallback: if advance_type is non-canonical (null / 'lump_sum' / etc.)
        // derive from the type bucket ('kasbon'→'EMPLOYEE') so approvalCategoryForType
        // routes to the correct COA (1-1032 kasbon, not 1-1033 talangan).
        // Use ILIKE '%kasbon%' to catch 'kasbon', 'employee_kasbon', etc.
        const isKasbonType = typeof adv.type === "string" && adv.type.toLowerCase().includes("kasbon");
        const advTypeKey = (adv.advance_type && ADVANCE_TYPES.includes(adv.advance_type as any))
          ? adv.advance_type
          : (isKasbonType ? "EMPLOYEE" : "OPERATIONAL");
        receivableAccountId = await resolveReceivableAccount(advTypeKey, companyId);

        // If still null and this is a kasbon, auto-create 1-1032-{company} from 1-1033 sibling
        if (!receivableAccountId && isKasbonType) {
          const talanganCoa = await db.execute<{ code: string }>(sql`
            SELECT code FROM chart_of_accounts
            WHERE code LIKE '1-1033%' AND company_id = ${companyId}
            ORDER BY company_id DESC NULLS LAST LIMIT 1
          `).then(r => r.rows[0] ?? null);
          const suffix = talanganCoa ? talanganCoa.code.replace(/^1-1033/, "") : "";
          const newCode = `1-1032${suffix}`;
          const newName = `Piutang Karyawan (Kasbon)${suffix ? " " + suffix.replace(/^[-_]/, "") : ""}`;
          const newCoa = await db.execute<{ id: number }>(sql`
            INSERT INTO chart_of_accounts (company_id, code, name, type, subtype, is_active, created_at)
            VALUES (${companyId}, ${newCode}, ${newName}, 'asset', 'receivable', true, NOW())
            ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
          `).then(r => r.rows[0] ?? null);
          receivableAccountId = newCoa?.id ?? null;
        }
      }
      if (!cashBankAccountId) {
        cashBankAccountId = await resolveCashBankAccount(adv.payment_method ?? "bank", settings);
      }
      // Persist the resolved accounts so future calls don't need to re-resolve
      if (receivableAccountId || cashBankAccountId) {
        await db.execute(sql`
          UPDATE cash_advances
          SET receivable_account_id = COALESCE(${receivableAccountId}, receivable_account_id),
              cash_bank_account_id  = COALESCE(${cashBankAccountId},  cash_bank_account_id),
              updated_at = NOW()
          WHERE id = ${id}
        `);
      }
    }

    if (!receivableAccountId || !cashBankAccountId) {
      return res.status(400).json({
        message: "Akun receivable dan bank tidak ditemukan di Chart of Accounts. Pastikan akun dengan kode 1-1032 (kasbon) atau 1-1033 (talangan) sudah ada di COA perusahaan ini.",
        code: "ACCOUNTING_CONFIG_MISSING",
      });
    }
    if (adv.entry_id) {
      return res.status(400).json({ message: "Jurnal disbursement sudah pernah diposting", code: "DUPLICATE_JOURNAL" });
    }

    const disbDate = req.body.date ?? adv.date;

    const fundingCompanyId =
      adv.funding_source_type === "perusahaan_lain" && adv.source_company_id
        ? Number(adv.source_company_id)
        : companyId;
    const responsibleCompanyId =
      adv.responsible_company_id && ["perusahaan_lain", "perusahaan_aktif"].includes(adv.responsible_party_type ?? "")
        ? Number(adv.responsible_company_id)
        : companyId;
    const isInternalPair = Boolean(
      ["perusahaan_lain", "perusahaan_aktif"].includes(adv.responsible_party_type ?? "") &&
      fundingCompanyId !== responsibleCompanyId,
    );
    let entryId: number;
    if (isInternalPair) {
      const accounts = await resolveIntercompanyAccounts({
        fundingCompanyId,
        responsibleCompanyId,
        category: adv.category,
      });
      const [fundingCash] = await db.execute<{ id: number }>(sql`
        SELECT id FROM chart_of_accounts
        WHERE id = ${cashBankAccountId}
          AND company_id = ${fundingCompanyId}
          AND type = 'asset' AND is_active = true
          AND (subtype = 'cash_bank' OR code LIKE '1-101%' OR code LIKE '1-102%')
        LIMIT 1
      `).then(r => r.rows);
      if (!fundingCash) throw new Error("Akun kas/bank sumber dana tidak valid atau bukan milik perusahaan pemberi dana.");
      const pair = await AdvanceJournalService.postIntercompanyDisbursementPair({
        fundingCompanyId,
        responsibleCompanyId,
        advanceNumber: adv.advance_number,
        partyName: adv.party_name,
        category: adv.category,
        purpose: adv.purpose,
        amount: Number(adv.amount),
        date: disbDate,
        fundingReceivableAccountId: accounts.fundingReceivable.id,
        fundingCashBankAccountId: fundingCash.id,
        responsibleExpenseAccountId: accounts.responsibleExpense.id,
        responsiblePayableAccountId: accounts.responsiblePayable.id,
        sourceAdvanceId: id,
        afterPost: async (tx, entries) => {
          await tx.execute(sql`
            UPDATE cash_advances
            SET entry_id = ${entries.sourceEntry.id},
                funding_entry_id = ${entries.sourceEntry.id},
                responsible_entry_id = ${entries.mirrorEntry.id},
                funding_company_id = ${fundingCompanyId},
                intercompany_reference = ${`IC-ADV-${adv.advance_number}`},
                intercompany_status = 'open',
                lifecycle_status = 'outstanding', status = 'active',
                disbursed_at = NOW(), disbursed_by = ${(req as any).user?.id ?? null},
                updated_at = NOW()
            WHERE id = ${id}
          `);
          await tx.execute(sql`
            INSERT INTO ar_subledger (
              company_id, invoice_id, invoice_number, invoice_date, currency,
              gross_amount, outstanding_amount, paid_amount, status, gl_entry_id,
              period, notes, updated_at
            ) VALUES (
              ${fundingCompanyId}, ${id}, ${adv.advance_number}, ${disbDate},
              ${adv.currency ?? "IDR"}, ${Number(adv.amount)}, ${Number(adv.amount)}, 0,
              'OPEN', ${entries.sourceEntry.id}, ${String(disbDate).slice(0, 7)},
              ${`Piutang intercompany Dana Talangan ${adv.advance_number}`}, NOW()
            )
            ON CONFLICT (company_id, invoice_id) WHERE invoice_id IS NOT NULL
            DO UPDATE SET
              gross_amount = EXCLUDED.gross_amount,
              outstanding_amount = EXCLUDED.outstanding_amount,
              gl_entry_id = EXCLUDED.gl_entry_id,
              updated_at = NOW()
          `);
          await tx.execute(sql`
            INSERT INTO ap_subledger (
              company_id, bill_id, bill_number, bill_date, currency,
              payable_amount, paid_amount, status, gl_entry_id,
              period, notes, updated_at
            ) VALUES (
              ${responsibleCompanyId}, ${id}, ${adv.advance_number}, ${disbDate},
              ${adv.currency ?? "IDR"}, ${Number(adv.amount)}, 0, 'OPEN',
              ${entries.mirrorEntry.id}, ${String(disbDate).slice(0, 7)},
              ${`Hutang intercompany Dana Talangan ${adv.advance_number}`}, NOW()
            )
            ON CONFLICT (company_id, bill_id) WHERE bill_id IS NOT NULL
            DO UPDATE SET
              payable_amount = EXCLUDED.payable_amount,
              gl_entry_id = EXCLUDED.gl_entry_id,
              updated_at = NOW()
          `);
        },
      });
      entryId = pair.fundingEntryId;
    } else {
      const result = await AdvanceJournalService.postDisbursementJournal({
        companyId,
        advanceNumber: adv.advance_number,
        partyName: adv.party_name,
        advanceType: adv.advance_type ?? adv.type,
        amount: Number(adv.amount),
        date: disbDate,
        receivableAccountId,
        cashBankAccountId,
        paymentMethod: adv.payment_method,
      });
      entryId = result.entryId;
      await db.execute(sql`
        UPDATE cash_advances
        SET lifecycle_status = 'outstanding', status = 'active',
            entry_id = ${entryId},
            disbursed_at = NOW(), disbursed_by = ${(req as any).user?.id ?? null},
            updated_at = NOW()
        WHERE id = ${id}
      `);
    }

    auditFromReq(req, {
      action: "advance_disbursed", module: "advance_management",
      newData: { id, entry_id: entryId, amount: adv.amount },
    });

    res.json({ success: true, entry_id: entryId });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── POST /:id/settle — Settlement with allocation engine ──────────────────────
router.post("/:id/settle", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const {
      date, bank_account_id, amount_received, currency, exchange_rate,
      reference, counterparty_name, notes,
      allocation_lines,   // Array<{ allocation_type, coa_id, reference_doc_id, reference_doc_type, amount, remarks }>
    } = req.body;

    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });
    // STATE MACHINE settle guard
    const currentStatus = (adv.lifecycle_status ?? adv.status) as LifecycleStatus;
    if (!canSettle(currentStatus)) {
      return res.status(400).json({
        message: `Advance dengan status '${currentStatus}' tidak bisa di-settle. Status harus outstanding/partially_settled/disbursed.`,
        code: "INVALID_TRANSITION",
      });
    }

    if (!Array.isArray(allocation_lines) || allocation_lines.length === 0) {
      return res.status(400).json({ message: "allocation_lines wajib diisi" });
    }

    // Validation: sum of allocation lines must equal amount_received
    const totalAlloc = allocation_lines.reduce((s: number, l: any) => s + Number(l.amount), 0);
    if (Math.abs(totalAlloc - Number(amount_received)) > 0.01) {
      return res.status(400).json({
        message: `Total alokasi (${totalAlloc}) tidak sama dengan jumlah diterima (${amount_received}). Selisih: ${Math.abs(totalAlloc - Number(amount_received))}`,
      });
    }

    // ── PA-03: Validate remaining BEFORE any writes ────────────────────────────
    // This must happen before journal posting so no orphan journal is created.
    const advancePrincipalSettled = allocation_lines
      .filter((l: any) => l.allocation_type === "ADVANCE_PRINCIPAL")
      .reduce((s: number, l: any) => s + Number(l.amount), 0);
    const currentRemaining = Number(adv.remaining_amount ?? 0);
    const rawProjected = currentRemaining - advancePrincipalSettled;
    if (rawProjected < -0.01) {
      return res.status(400).json({
        message: `Jumlah settlement ADVANCE_PRINCIPAL (${advancePrincipalSettled}) melebihi sisa piutang (${currentRemaining}). remaining tidak boleh negatif.`,
        code: "REMAINING_NEGATIVE",
      });
    }
    const projectedRemaining = Math.max(0, rawProjected);

    // Generate settlement number
    const stlCount = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS cnt FROM advance_settlements WHERE company_id = ${companyId}
    `).then(r => Number(r.rows[0]?.cnt ?? 0));
    const settlementNumber = `ADV-STL-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,"0")}-${String(stlCount+1).padStart(4,"0")}`;

    // Build journal lines for settlement
    // DR Bank (amount_received total)
    // CR Advance Receivable (ADVANCE_PRINCIPAL lines)
    // CR AR / Revenue / etc. (other lines by coa_id)
    const jLines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [];

    if (bank_account_id && Number(amount_received) > 0) {
      jLines.push({ accountId: Number(bank_account_id), debit: Number(amount_received), credit: 0, description: `Settlement ${settlementNumber}` });
    }

    for (const line of allocation_lines) {
      const lineAmt = Number(line.amount);
      if (lineAmt <= 0) continue;
      let creditAccountId: number | null = null;
      if (line.allocation_type === "ADVANCE_PRINCIPAL") {
        creditAccountId = Number(adv.receivable_account_id);
      } else if (line.coa_id) {
        creditAccountId = Number(line.coa_id);
      }
      if (!creditAccountId) continue;
      jLines.push({ accountId: creditAccountId, debit: 0, credit: lineAmt, description: `${line.allocation_type}${line.remarks ? ` — ${line.remarks}` : ""}` });
    }

    // Post journal via AdvanceJournalService (single implementation)
    let entryId: number | null = null;
    if (bank_account_id && Number(amount_received) > 0 && allocation_lines.length > 0) {
      try {
        const result = await AdvanceJournalService.postAllocationSettlement({
          companyId,
          advanceNumber: adv.advance_number,
          settlementNumber,
          partyName: adv.party_name,
          amountReceived: Number(amount_received),
          date,
          bankAccountId: Number(bank_account_id),
          receivableAccountId: Number(adv.receivable_account_id),
          allocationLines: allocation_lines.map((l: any) => ({
            allocation_type: l.allocation_type,
            coa_id: l.coa_id ?? null,
            amount: Number(l.amount),
            remarks: l.remarks ?? null,
          })),
        });
        entryId = result.entryId;
      } catch (jErr: any) {
        console.warn("[advances/settle] journal posting failed:", jErr?.message);
        throw jErr; // re-throw — settlement without journal is an error
      }
    }

    // Insert settlement header
    const [settlement] = await db.execute<any>(sql`
      INSERT INTO advance_settlements (
        company_id, advance_id, settlement_number, date,
        bank_account_id, amount_received, currency, exchange_rate,
        reference, counterparty_name, notes, journal_id, created_by
      ) VALUES (
        ${companyId}, ${id}, ${settlementNumber}, ${date},
        ${bank_account_id ?? null}, ${amount_received}, ${currency ?? "IDR"}, ${exchange_rate ?? 1},
        ${reference ?? null}, ${counterparty_name ?? null}, ${notes ?? null},
        ${entryId ?? null}, ${(req as any).user?.id ?? null}
      ) RETURNING *
    `).then(r => r.rows);

    // Insert allocation lines
    for (const line of allocation_lines) {
      await db.execute(sql`
        INSERT INTO advance_allocation_lines (
          settlement_id, advance_id, allocation_type,
          reference_doc_id, reference_doc_type, coa_id,
          amount, remarks, journal_id
        ) VALUES (
          ${settlement.id}, ${id}, ${line.allocation_type},
          ${line.reference_doc_id ?? null}, ${line.reference_doc_type ?? null},
          ${line.coa_id ?? null}, ${line.amount}, ${line.remarks ?? null}, ${entryId ?? null}
        )
      `).catch(() => {});
    }

    await db.execute(sql`
      UPDATE cash_advances
      SET settled_amount   = LEAST(COALESCE(settled_amount, 0) + ${advancePrincipalSettled}, amount),
          remaining_amount = ${projectedRemaining},
          -- PA-01 FIX: link settlement journal to advance when no disbursement
          -- journal was previously recorded (COALESCE preserves existing entry_id).
          entry_id         = COALESCE(entry_id, ${entryId ?? null}),
          lifecycle_status = CASE
            WHEN ${projectedRemaining} <= 0 THEN 'settled'
            ELSE 'partially_settled'
          END,
          status = CASE
            WHEN ${projectedRemaining} <= 0 THEN 'repaid'
            ELSE 'partial'
          END,
          updated_at = NOW()
      WHERE id = ${id}
    `);

    auditFromReq(req, {
      action: "advance_settled", module: "advance_management",
      newData: { id, settlement_id: settlement.id, amount_received, allocation_lines },
    });

    res.status(201).json({ success: true, settlement_id: settlement.id, entry_id: entryId });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── POST /:id/settle-expense — Pertanggungjawaban (no-cash reclass) ───────────
// Closes an advance as an expense: DR Expense (chosen COA) / CR Advance
// Receivable, no cash movement. This is the flow the Unified Engine's
// allocation-based /:id/settle above cannot express (it always requires a
// bank leg). Exposed inline both from the Kasbon detail page and directly
// from the Dana Karyawan hub so a spent kasbon can be closed without
// navigating to a separate page.
router.post("/:id/settle-expense", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const { date, expense_account_id, amount, category, notes, receipt_url } = req.body;

    if (!date) return res.status(400).json({ message: "Tanggal wajib diisi" });
    if (!expense_account_id) return res.status(400).json({ message: "Akun beban wajib dipilih" });
    const amountN = Number(amount);
    if (!amountN || amountN <= 0) return res.status(400).json({ message: "Nominal harus lebih dari 0" });

    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    const currentStatus = (adv.lifecycle_status ?? adv.status) as LifecycleStatus;
    if (!canSettle(currentStatus)) {
      return res.status(400).json({
        message: `Advance dengan status '${currentStatus}' tidak bisa ditutup sebagai beban. Status harus outstanding/partially_settled/disbursed.`,
        code: "INVALID_TRANSITION",
      });
    }
    if (!adv.receivable_account_id) {
      return res.status(400).json({ message: "Akun piutang belum diatur pada advance ini", code: "ACCOUNTING_CONFIG_MISSING" });
    }

    const currentRemaining = Number(adv.remaining_amount ?? 0);
    if (amountN - currentRemaining > 0.01) {
      return res.status(400).json({
        message: `Nominal (${amountN}) melebihi sisa piutang (${currentRemaining}).`,
        code: "REMAINING_NEGATIVE",
      });
    }
    const projectedRemaining = Math.max(0, currentRemaining - amountN);

    // Generate settlement number (shares the sequence with allocation settlements)
    const stlCount = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS cnt FROM advance_settlements WHERE company_id = ${companyId}
    `).then(r => Number(r.rows[0]?.cnt ?? 0));
    const settlementNumber = `ADV-EXP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(stlCount + 1).padStart(4, "0")}`;

    let entryId: number | null = null;
    try {
      const result = await AdvanceJournalService.postExpenseSettlement({
        companyId,
        advanceNumber: adv.advance_number,
        settlementRef: settlementNumber,
        partyName: adv.party_name,
        amount: amountN,
        date,
        receivableAccountId: Number(adv.receivable_account_id),
        expenseAccountId: Number(expense_account_id),
        category: category ?? null,
      });
      entryId = result.entryId;
    } catch (jErr: any) {
      console.warn("[advances/settle-expense] journal posting failed:", jErr?.message);
      throw jErr; // settlement without journal is an error
    }

    const [settlement] = await db.execute<any>(sql`
      INSERT INTO advance_settlements (
        company_id, advance_id, settlement_number, date,
        bank_account_id, amount_received, currency, exchange_rate,
        notes, receipt_url, journal_id, created_by
      ) VALUES (
        ${companyId}, ${id}, ${settlementNumber}, ${date},
        NULL, 0, 'IDR', 1,
        ${notes ?? category ?? null}, ${receipt_url ?? null}, ${entryId}, ${(req as any).user?.id ?? null}
      ) RETURNING *
    `).then(r => r.rows);

    await db.execute(sql`
      INSERT INTO advance_allocation_lines (
        settlement_id, advance_id, allocation_type, coa_id, amount, remarks, journal_id
      ) VALUES (
        ${settlement.id}, ${id}, 'EXPENSE_RECLASS', ${expense_account_id}, ${amountN}, ${category ?? notes ?? null}, ${entryId}
      )
    `).catch(() => {});

    const newLifecycle = deriveStatusAfterPayment(projectedRemaining);
    await db.execute(sql`
      UPDATE cash_advances
      SET settled_amount   = LEAST(COALESCE(settled_amount, 0) + ${amountN}, amount),
          remaining_amount = ${projectedRemaining},
          entry_id         = COALESCE(entry_id, ${entryId}),
          lifecycle_status = ${newLifecycle},
          status           = ${mapToLegacyStatus(newLifecycle)},
          updated_at       = NOW()
      WHERE id = ${id}
    `);

    auditFromReq(req, {
      action: "advance_settled_expense", module: "advance_management",
      newData: { id, settlement_id: settlement.id, amount: amountN, expense_account_id },
    });

    res.status(201).json({ success: true, settlement_id: settlement.id, entry_id: entryId });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── POST /:id/void ────────────────────────────────────────────────────────────
router.post("/:id/void", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const { reason } = req.body;
    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    const currentStatus = (adv.lifecycle_status ?? adv.status) as LifecycleStatus;
    // moneyMoved = cash has physically moved via repayment.
    // NOTE: do NOT check entry_id here — an auto-disbursed approved advance can still be
    // voided+reversed (the reversal branch at line ~1212 handles that). Using entry_id would
    // block void+reversal for approved advances with a disbursement journal, which is a regression.
    // settle-to-expense advances (lifecycle_status='settled') are blocked by canVoid() status check.
    const moneyMoved = Number(adv.paid_amount ?? 0) > 0;

    // STATE MACHINE void guard
    if (!canVoid(currentStatus, moneyMoved)) {
      if (currentStatus === "void" || currentStatus === "reversed") {
        return res.status(400).json({ message: "Advance sudah di-void/reversed sebelumnya.", code: "ALREADY_VOIDED" });
      }
      if (moneyMoved) {
        return res.status(400).json({
          message: "Dana sudah bergerak — tidak bisa Void. Gunakan Repayment atau Settlement.",
          code: "MONEY_MOVED",
        });
      }
      return res.status(400).json({
        message: `Advance dengan status '${currentStatus}' tidak bisa di-void.`,
        code: "INVALID_TRANSITION",
      });
    }

    let reversalId: number | null = null;

    // If a disbursement journal was already posted (entry_id exists), create reversal
    if (adv.entry_id) {
      // Validate via guard (uses correct interface: TransactionJournalState)
      const guard = assertCanVoidTransaction({
        entryId: Number(adv.entry_id),
        entryStatus: "posted",
        moneyMoved,
      });
      if (!guard.allowed) {
        return res.status(400).json({ message: guard.reason ?? "Void tidak diizinkan", code: guard.code });
      }

      // Create reversal via AdvanceJournalService (single reversal implementation)
      const { entryId } = await AdvanceJournalService.postVoidReversal({
        originalEntryId: Number(adv.entry_id),
        companyId,
        advanceNumber: adv.advance_number,
        actor: (req as any).user?.id ?? (req as any).userId ?? null,
        reason: reason ?? "Void by admin",
      });
      reversalId = entryId;
    }

    // When a reversal entry was posted, status moves to 'reversed' (counter-entry in GL).
    // When no journal existed (draft/pending), status is 'void' (administrative cancellation).
    const finalStatus = reversalId ? "reversed" : "void";

    await db.execute(sql`
      UPDATE cash_advances
      SET lifecycle_status = ${finalStatus}, status = 'void',
          voided_at = NOW(), voided_by = ${(req as any).user?.id ?? (req as any).userId ?? null},
          void_reason = ${reason ?? null},
          reversal_journal_id = ${reversalId},
          updated_at = NOW()
      WHERE id = ${id}
    `);

    auditFromReq(req, {
      action: "advance_voided", module: "advance_management",
      newData: { id, final_status: finalStatus, reversal_id: reversalId, reason },
    });

    res.json({ success: true, lifecycle_status: finalStatus, reversal_id: reversalId });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── GET /:id/installment-schedule ─────────────────────────────────────────────
router.get("/:id/installment-schedule", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const [adv] = await db.execute<any>(sql`SELECT id, company_id FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    // Auto-mark overdue before returning
    await db.execute(sql`
      UPDATE cash_advance_installment_schedules
      SET status = 'overdue', updated_at = NOW()
      WHERE advance_id = ${id}
        AND status = 'pending'
        AND due_date < CURRENT_DATE
    `).catch(() => {});

    const rows = await db.execute<any>(sql`
      SELECT s.*,
        r.date AS repayment_date, r.payment_method AS repayment_method
      FROM cash_advance_installment_schedules s
      LEFT JOIN cash_advance_repayments r ON r.id = s.repayment_id
      WHERE s.advance_id = ${id}
      ORDER BY s.installment_number ASC
    `).then(r => r.rows);

    res.json(rows);
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── POST /:id/installment-schedule — Generate jadwal cicilan ──────────────────
router.post("/:id/installment-schedule", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const { start_date, installment_count, interval_months = 1, custom_amounts, notes } = req.body;

    if (!start_date) return res.status(400).json({ message: "start_date wajib diisi" });
    const count = Number(installment_count);
    if (!count || count < 1 || count > 120) return res.status(400).json({ message: "installment_count harus antara 1–120" });
    const intervalMonths = Number(interval_months);
    if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 120) {
      return res.status(400).json({ message: "interval_months harus bilangan bulat antara 1–120" });
    }
    if (custom_amounts !== undefined && (!Array.isArray(custom_amounts) || custom_amounts.length !== count)) {
      return res.status(400).json({
        message: "custom_amounts harus berisi nominal untuk setiap cicilan.",
        code: "INVALID_INSTALLMENT_AMOUNTS",
      });
    }

    const [adv] = await db.execute<any>(sql`
      SELECT id, company_id, remaining_amount, amount, lifecycle_status
      FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}
    `).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    const allowed = ["approved", "disbursed", "outstanding", "partially_settled"];
    if (!allowed.includes(adv.lifecycle_status)) {
      return res.status(400).json({
        message: `Jadwal cicilan hanya bisa dibuat untuk advance yang sudah disetujui/dicairkan. Status saat ini: ${adv.lifecycle_status}`,
        code: "INVALID_STATUS",
      });
    }

    // Check existing schedule
    const existing = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS cnt FROM cash_advance_installment_schedules WHERE advance_id = ${id}
    `).then(r => Number(r.rows[0]?.cnt ?? 0));
    if (existing > 0) {
      return res.status(409).json({
        message: "Jadwal cicilan sudah ada. Hapus jadwal lama dulu sebelum membuat yang baru.",
        code: "SCHEDULE_EXISTS",
      });
    }

    const totalAmount = Number(adv.remaining_amount ?? adv.amount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({
        message: "Sisa outstanding advance tidak valid atau sudah lunas.",
        code: "INVALID_REMAINING_AMOUNT",
      });
    }
    const customTotal = Array.isArray(custom_amounts)
      ? custom_amounts.reduce((sum: number, value: unknown) => {
          const amount = Number(value);
          return sum + (Number.isFinite(amount) ? amount : Number.NaN);
        }, 0)
      : totalAmount;
    if (
      !Number.isFinite(customTotal) ||
      (Array.isArray(custom_amounts) && custom_amounts.some((value: unknown) => Number(value) <= 0)) ||
      Math.abs(customTotal - totalAmount) > 0.01
    ) {
      return res.status(400).json({
        message: `Total nominal cicilan harus sama dengan sisa outstanding (${totalAmount}).`,
        code: "INVALID_INSTALLMENT_AMOUNTS",
      });
    }
    const baseAmount = Math.floor(totalAmount / count);
    const lastAmount = totalAmount - baseAmount * (count - 1);

    const startDt = new Date(start_date);
    const inserted = [];
    for (let i = 0; i < count; i++) {
      const due = new Date(startDt);
      due.setMonth(due.getMonth() + i * intervalMonths);
      const dueStr = due.toISOString().slice(0, 10);
      const amt = Array.isArray(custom_amounts)
        ? Number(custom_amounts[i])
        : (i === count - 1 ? lastAmount : baseAmount);

      const [row] = await db.execute<any>(sql`
        INSERT INTO cash_advance_installment_schedules
          (advance_id, company_id, installment_number, due_date, amount, status, notes)
        VALUES
          (${id}, ${companyId}, ${i + 1}, ${dueStr}, ${amt}, 'pending', ${notes ?? null})
        RETURNING *
      `).then(r => r.rows);
      inserted.push(row);
    }

    auditFromReq(req, {
      action: "installment_schedule_created", module: "advance_management",
      newData: { advance_id: id, installment_count: count, start_date, total: totalAmount },
    });

    res.status(201).json({ success: true, schedules: inserted });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── DELETE /:id/installment-schedule — Hapus jadwal (hanya jika belum ada yg paid) ──
router.delete("/:id/installment-schedule", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const [adv] = await db.execute<any>(sql`SELECT id FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    const paidCount = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS cnt FROM cash_advance_installment_schedules
      WHERE advance_id = ${id} AND status = 'paid'
    `).then(r => Number(r.rows[0]?.cnt ?? 0));
    if (paidCount > 0) {
      return res.status(400).json({
        message: `Tidak bisa menghapus jadwal — ${paidCount} cicilan sudah dibayar.`,
        code: "HAS_PAID_INSTALLMENTS",
      });
    }

    await db.execute(sql`DELETE FROM cash_advance_installment_schedules WHERE advance_id = ${id} AND status != 'paid'`);
    res.json({ success: true });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── PATCH /:id/installment-schedule/:schedId/pay — Bayar satu cicilan ─────────
router.patch("/:id/installment-schedule/:schedId/pay", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const schedId = Number(req.params.schedId);
    const companyId = resolveCompanyId(req);
    const {
      date, source_account_id, payment_method = "bank", notes: payNotes,
      // Intercompany fields (same as POST /:id/repay)
      payer_company_id: schedPayerCompanyId,
      payer_coa_account_id: schedPayerCoaId,
    } = req.body;

    if (!date) return res.status(400).json({ message: "date wajib diisi" });

    const [adv] = await db.execute<any>(sql`
      SELECT * FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}
    `).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Advance not found" });

    const [sched] = await db.execute<any>(sql`
      SELECT * FROM cash_advance_installment_schedules WHERE id = ${schedId} AND advance_id = ${id}
    `).then(r => r.rows);
    if (!sched) return res.status(404).json({ message: "Jadwal cicilan tidak ditemukan" });
    if (sched.status === "paid") return res.status(400).json({ message: "Cicilan ini sudah dibayar", code: "ALREADY_PAID" });
    if (sched.status === "waived") return res.status(400).json({ message: "Cicilan ini sudah diwaivkan", code: "WAIVED" });

    const repayAmt = Number(sched.amount);
    if (!Number.isFinite(repayAmt) || repayAmt <= 0) {
      return res.status(400).json({
        message: "Nominal cicilan tidak valid.",
        code: "INVALID_INSTALLMENT_AMOUNT",
      });
    }
    if (repayAmt > Number(adv.remaining_amount) + 0.01) {
      return res.status(400).json({
        message: `Nominal cicilan (${repayAmt}) melebihi sisa outstanding (${adv.remaining_amount}).`,
        code: "INSUFFICIENT_REMAINING",
      });
    }
    const currentStatus = (adv.lifecycle_status ?? adv.status) as LifecycleStatus;
    if (!canRepay(currentStatus)) {
      return res.status(400).json({
        message: `Advance tidak bisa direpay dari status '${currentStatus}'.`,
        code: "INVALID_TRANSITION",
      });
    }

    // Count existing repayments for unique refSuffix
    const repayCount = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS count FROM cash_advance_repayments WHERE advance_id = ${id}
    `).then(r => Number(r.rows[0]?.count ?? 0));
    const refSuffix = String(repayCount + 1).padStart(3, "0");

    // ── Intercompany check for installment pay ────────────────────────────────
    const INTERNAL_SCHED = ["perusahaan_lain", "perusahaan_aktif"];
    const isIntercompanySched = Boolean(
      schedPayerCompanyId &&
      adv.responsible_company_id &&
      INTERNAL_SCHED.includes(adv.responsible_party_type ?? "") &&
      Number(adv.responsible_company_id) !== companyId
    );

    // Validate payer COA if provided
    if (schedPayerCompanyId && schedPayerCoaId) {
      const [payerAcct] = await db.execute<{ id: number }>(sql`
        SELECT id FROM chart_of_accounts
        WHERE id = ${Number(schedPayerCoaId)}
          AND company_id = ${Number(schedPayerCompanyId)}
          AND type = 'asset' AND is_active = true
          AND (subtype = 'cash_bank' OR code LIKE '1-101%' OR code LIKE '1-102%')
        LIMIT 1
      `).then(r => r.rows);
      if (!payerAcct) {
        return res.status(400).json({
          message: "Akun COA pengembali tidak valid: bukan kas/bank atau bukan milik perusahaan pengembali.",
          code: "INVALID_PAYER_ACCOUNT",
        });
      }
    }

    // New intercompany installment path: both ledgers, repayment row, advance
    // balance, subledgers, and installment status are committed together.
    if (isIntercompanySched && schedPayerCoaId) {
      const fundingCompanyId = Number(adv.funding_company_id ?? companyId);
      const responsibleCompanyId = Number(adv.responsible_company_id);
      const fundingCashAccountId = Number(source_account_id ?? adv.cash_bank_account_id);
      if (!fundingCashAccountId) {
        return res.status(400).json({
          message: "Akun kas/bank perusahaan pemberi dana wajib dipilih.",
          code: "INVALID_RECEIVER_ACCOUNT",
        });
      }
      const [fundingCash] = await db.execute<{ id: number }>(sql`
        SELECT id FROM chart_of_accounts
        WHERE id = ${fundingCashAccountId}
          AND company_id = ${fundingCompanyId}
          AND type = 'asset' AND is_active = true
          AND (subtype = 'cash_bank' OR code LIKE '1-101%' OR code LIKE '1-102%')
        LIMIT 1
      `).then(r => r.rows);
      if (!fundingCash) {
        return res.status(400).json({
          message: "Akun kas/bank penerima tidak valid atau bukan milik perusahaan pemberi dana.",
          code: "INVALID_RECEIVER_ACCOUNT",
        });
      }
      const accounts = await resolveIntercompanyAccounts({
        fundingCompanyId,
        responsibleCompanyId,
        category: adv.category,
      });
      const repaymentNumber = `SCHED-${sched.installment_number}-${schedId}`;
      const icReference = `IC-RPY-${adv.advance_number}-${repaymentNumber}`;
      const pair = await AdvanceJournalService.postIntercompanyRepaymentPair({
        fundingCompanyId,
        responsibleCompanyId,
        advanceNumber: adv.advance_number,
        partyName: adv.party_name,
        amount: repayAmt,
        date,
        repaymentNumber,
        fundingReceivableAccountId: accounts.fundingReceivable.id,
        fundingCashBankAccountId: fundingCash.id,
        responsiblePayableAccountId: accounts.responsiblePayable.id,
        responsibleCashBankAccountId: Number(schedPayerCoaId),
        afterPost: async (tx, entries) => {
          const newRemaining = Math.max(0, Number(adv.remaining_amount) - repayAmt);
          const newLifecycle = deriveStatusAfterPayment(newRemaining);
          const [repRow] = await tx.execute(sql`
            INSERT INTO cash_advance_repayments (
              advance_id, amount, payment_method, source_account_id, date, notes, entry_id,
              payer_company_id, payer_coa_account_id, receiver_company_id, receiver_coa_account_id,
              intercompany_reference, payer_journal_id, receiver_journal_id, posted_at, created_by
            ) VALUES (
              ${id}, ${repayAmt}, ${payment_method}, ${fundingCash.id}, ${date},
              ${payNotes ?? `Cicilan ${sched.installment_number}`}, ${entries.mirrorEntry.id},
              ${responsibleCompanyId}, ${Number(schedPayerCoaId)}, ${fundingCompanyId},
              ${fundingCash.id}, ${icReference}, ${entries.sourceEntry.id},
              ${entries.mirrorEntry.id}, NOW(),
              ${(req as any).user?.name ?? (req as any).user?.email ?? null}
            )
            RETURNING id
          `).then((r: any) => r.rows);
          await tx.execute(sql`
            UPDATE cash_advances
            SET paid_amount = COALESCE(paid_amount, 0) + ${repayAmt},
                remaining_amount = ${newRemaining},
                lifecycle_status = ${newLifecycle},
                status = ${mapToLegacyStatus(newLifecycle)},
                repayment_journal_id = ${entries.mirrorEntry.id},
                intercompany_paid_amount = COALESCE(intercompany_paid_amount, 0) + ${repayAmt},
                intercompany_status = ${newRemaining <= 0 ? "settled" : "partial"},
                updated_at = NOW()
            WHERE id = ${id}
          `);
          await tx.execute(sql`
            UPDATE cash_advance_installment_schedules
            SET status = 'paid', repayment_id = ${repRow?.id ?? null},
                paid_date = ${date}, paid_amount = ${repayAmt}, updated_at = NOW()
            WHERE id = ${schedId}
          `);
          await tx.execute(sql`
            UPDATE ar_subledger
            SET paid_amount = LEAST(gross_amount, COALESCE(paid_amount, 0) + ${repayAmt}),
                outstanding_amount = GREATEST(0, outstanding_amount - ${repayAmt}),
                status = CASE WHEN outstanding_amount - ${repayAmt} <= 0 THEN 'CLOSED' ELSE 'PARTIAL' END,
                updated_at = NOW()
            WHERE company_id = ${fundingCompanyId} AND invoice_id = ${id}
          `);
          await tx.execute(sql`
            UPDATE ap_subledger
            SET paid_amount = LEAST(payable_amount, COALESCE(paid_amount, 0) + ${repayAmt}),
                status = CASE WHEN payable_amount - (COALESCE(paid_amount, 0) + ${repayAmt}) <= 0 THEN 'PAID' ELSE 'PARTIAL' END,
                updated_at = NOW()
            WHERE company_id = ${responsibleCompanyId} AND bill_id = ${id}
          `);
          return { repaymentId: repRow?.id ?? null, newLifecycle };
        },
      });
      const result = pair.afterPostResult as { repaymentId?: number | null; newLifecycle?: string } | undefined;
      auditFromReq(req, {
        action: "installment_paid", module: "advance_management",
        newData: {
          advance_id: id, schedule_id: schedId,
          installment_number: sched.installment_number, amount: repayAmt,
          entry_id: pair.fundingEntryId, intercompany: true,
        },
      });
      return res.json({
        success: true,
        repayment_id: result?.repaymentId ?? null,
        entry_id: pair.fundingEntryId,
        payer_journal_id: pair.responsibleEntryId,
        new_lifecycle: result?.newLifecycle,
        intercompany_reference: icReference,
      });
    }

    // ── ATOMICITY: Post PAYER journal first (if intercompany with payer COA) ──
    let payerJournalId: number | null = null;
    let icReference: string | null = null;

    if (isIntercompanySched && schedPayerCoaId) {
      icReference = `IC-RPY-${adv.advance_number}-SCHED-${sched.installment_number}`;
      try {
        const [liabilityCoa] = await db.execute<{ id: number }>(sql`
          SELECT id FROM chart_of_accounts
          WHERE company_id = ${Number(adv.responsible_company_id)} AND code = '2-2098' LIMIT 1
        `).then(r => r.rows);
        if (!liabilityCoa) throw new Error("Akun hutang intercompany (2-2098) tidak ditemukan di perusahaan pengembali. Pastikan advance telah dicairkan terlebih dahulu.");

        const payerJournal = await AdvanceJournalService.postRepaymentJournal({
          companyId: Number(adv.responsible_company_id),
          advanceNumber: adv.advance_number,
          partyName: adv.party_name,
          amount: repayAmt,
          date,
          receivableAccountId: liabilityCoa.id,              // CR: Hutang Intercompany
          cashBankAccountId: Number(schedPayerCoaId),        // DR: Kas/Bank Pengembali
          paymentMethod: payment_method,
          refSuffix: `IC-SCHED-${sched.installment_number}`,
        });
        payerJournalId = payerJournal.entryId;
      } catch (icErr: any) {
        return res.status(400).json({
          message: `Gagal memposting jurnal perusahaan pengembali: ${icErr?.message ?? "Kesalahan tidak diketahui"}`,
          code: "INTERCOMPANY_JOURNAL_FAILED",
        });
      }
    }

    // Post receiver journal (advance company): DR Kas/Bank Penerima / CR Piutang
    let entryId: number | null = null;
    try {
      const result = await AdvanceJournalService.postRepaymentJournal({
        companyId,
        advanceNumber: adv.advance_number,
        partyName: adv.party_name,
        amount: repayAmt,
        date,
        receivableAccountId: Number(adv.receivable_account_id),
        cashBankAccountId: Number(source_account_id ?? adv.cash_bank_account_id),
        paymentMethod: payment_method,
        refSuffix,
      });
      entryId = result.entryId;
    } catch (jErr: any) {
      // Void payer if receiver failed
      if (payerJournalId) {
        try {
          await AdvanceJournalService.postVoidReversal({
            originalEntryId: payerJournalId,
            companyId: Number(adv.responsible_company_id),
            advanceNumber: adv.advance_number,
            actor: (req as any).user?.name ?? null,
            reason: "Auto-void: receiver journal failed during cicilan payment",
          });
        } catch {}
      }
      console.warn("[installment/pay] journal failed:", jErr?.message);
      throw jErr;
    }

    // Insert repayment record with payer fields
    const [repRow] = await db.execute<any>(sql`
      INSERT INTO cash_advance_repayments (
        advance_id, amount, payment_method, source_account_id, date, notes, entry_id,
        payer_company_id, payer_coa_account_id, receiver_company_id, receiver_coa_account_id,
        intercompany_reference, payer_journal_id, posted_at, created_by
      ) VALUES (
        ${id}, ${repayAmt}, ${payment_method}, ${source_account_id ?? null}, ${date},
        ${payNotes ?? `Cicilan ${sched.installment_number}`}, ${entryId ?? null},
        ${schedPayerCompanyId ? Number(schedPayerCompanyId) : null},
        ${schedPayerCoaId ? Number(schedPayerCoaId) : null},
        ${companyId},
        ${source_account_id ? Number(source_account_id) : null},
        ${icReference},
        ${payerJournalId},
        NOW(),
        ${(req as any).user?.name ?? (req as any).user?.email ?? null}
      )
      RETURNING id
    `).then(r => r.rows);
    const repaymentId = repRow?.id;

    // Update advance totals
    const newRemaining = Math.max(0, Number(adv.remaining_amount) - repayAmt);
    const newLifecycle = deriveStatusAfterPayment(newRemaining);
    await db.execute(sql`
      UPDATE cash_advances
      SET paid_amount       = COALESCE(paid_amount, 0) + ${repayAmt},
          remaining_amount  = ${newRemaining},
          lifecycle_status  = ${newLifecycle},
          status            = ${mapToLegacyStatus(newLifecycle)},
          repayment_journal_id = ${entryId},
          updated_at        = NOW()
      WHERE id = ${id}
    `);

    // Mark schedule as paid
    await db.execute(sql`
      UPDATE cash_advance_installment_schedules
      SET status       = 'paid',
          repayment_id = ${repaymentId},
          paid_date    = ${date},
          paid_amount  = ${repayAmt},
          updated_at   = NOW()
      WHERE id = ${schedId}
    `);

    auditFromReq(req, {
      action: "installment_paid", module: "advance_management",
      newData: { advance_id: id, schedule_id: schedId, installment_number: sched.installment_number, amount: repayAmt, entry_id: entryId },
    });

    res.json({ success: true, repayment_id: repaymentId, entry_id: entryId, new_lifecycle: newLifecycle });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── PATCH /:id/installment-schedule/:schedId/waive — Waive satu cicilan ───────
router.patch("/:id/installment-schedule/:schedId/waive", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const schedId = Number(req.params.schedId);
    const companyId = resolveCompanyId(req);
    const { reason } = req.body;

    const [adv] = await db.execute<any>(sql`SELECT id FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    const [sched] = await db.execute<any>(sql`
      SELECT * FROM cash_advance_installment_schedules WHERE id = ${schedId} AND advance_id = ${id}
    `).then(r => r.rows);
    if (!sched) return res.status(404).json({ message: "Jadwal tidak ditemukan" });
    if (sched.status === "paid") return res.status(400).json({ message: "Cicilan sudah dibayar, tidak bisa diwaive" });

    await db.execute(sql`
      UPDATE cash_advance_installment_schedules
      SET status = 'waived', notes = COALESCE(notes || ' | ', '') || ${'Waived: ' + (reason ?? '-')}, updated_at = NOW()
      WHERE id = ${schedId}
    `);
    res.json({ success: true });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── POST /:id/repay — Cash repayment from counterparty ───────────────────────
router.post("/:id/repay", async (req: Request, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const {
      date, amount, notes, payment_method,
      // Legacy field (backward compat) — receiver's account
      source_account_id,
      // New intercompany fields
      payer_company_id,
      payer_coa_account_id,
      receiver_coa_account_id,
      payment_reference,
      idempotency_key,
    } = req.body;

    // Resolve receiver account: new field takes priority over legacy source_account_id
    const resolvedReceiverAccountId = receiver_coa_account_id ?? source_account_id;

    // ── Idempotency check — prevent double-submit ──────────────────────────────
    if (idempotency_key) {
      const [existing] = await db.execute<any>(
        sql`SELECT id FROM cash_advance_repayments WHERE idempotency_key = ${idempotency_key} LIMIT 1`
      ).then(r => r.rows);
      if (existing) {
        return res.json({ success: true, duplicate: true, repayment_id: existing.id });
      }
    }

    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    // STATE MACHINE repay guard
    const currentStatus = (adv.lifecycle_status ?? adv.status) as LifecycleStatus;
    if (!canRepay(currentStatus)) {
      return res.status(400).json({
        message: `Advance dengan status '${currentStatus}' tidak bisa direpay. Status harus outstanding/partially_settled/disbursed.`,
        code: "INVALID_TRANSITION",
      });
    }
    const repayAmt = Number(amount);
    if (repayAmt <= 0) return res.status(400).json({ message: "amount harus > 0" });
    if (repayAmt > Number(adv.remaining_amount) + 0.01) {
      return res.status(400).json({
        message: `Jumlah repayment (${repayAmt}) melebihi sisa outstanding (${adv.remaining_amount})`,
        code: "INSUFFICIENT_REMAINING",
      });
    }

    // ── Multi-company validation ───────────────────────────────────────────────
    // New advances store the actual funding company separately from the
    // company that owns the advance workflow. Repayment must therefore use the
    // funding book for the receiver side and the responsible book for the payer.
    const fundingCompanyId = Number(adv.funding_company_id ?? companyId);
    const responsibleCompanyId = Number(adv.responsible_company_id ?? companyId);
    const INTERNAL_PARTY_TYPES = ["perusahaan_lain", "perusahaan_aktif"];
    const isIntercompany = Boolean(
      payer_company_id &&
      Number(payer_company_id) === responsibleCompanyId &&
      INTERNAL_PARTY_TYPES.includes(adv.responsible_party_type ?? "") &&
      fundingCompanyId !== responsibleCompanyId,
    );

    // Validate payer_coa_account_id belongs to payer_company_id and is kas/bank
    if (payer_company_id && payer_coa_account_id) {
      const [payerAcct] = await db.execute<{ id: number; company_id: number; type: string }>(sql`
        SELECT id, company_id, type FROM chart_of_accounts
        WHERE id = ${Number(payer_coa_account_id)}
          AND company_id = ${Number(payer_company_id)}
          AND type = 'asset'
          AND is_active = true
          AND (subtype = 'cash_bank' OR code LIKE '1-101%' OR code LIKE '1-102%')
        LIMIT 1
      `).then(r => r.rows);
      if (!payerAcct) {
        return res.status(400).json({
          message: "Akun COA pengembali tidak valid: akun tidak ditemukan, bukan kas/bank, atau bukan milik perusahaan pengembali.",
          code: "INVALID_PAYER_ACCOUNT",
        });
      }
    }

    // Validate receiver_coa_account_id belongs to the advance's company (not trusted from frontend)
    if (resolvedReceiverAccountId) {
      const [recvrAcct] = await db.execute<{ id: number }>(sql`
        SELECT id FROM chart_of_accounts
        WHERE id = ${Number(resolvedReceiverAccountId)}
          AND (company_id = ${fundingCompanyId} OR company_id IS NULL)
          AND type = 'asset'
          AND is_active = true
          AND (subtype = 'cash_bank' OR code LIKE '1-101%' OR code LIKE '1-102%')
        LIMIT 1
      `).then(r => r.rows);
      if (!recvrAcct) {
        return res.status(400).json({
          message: "Akun COA penerima tidak valid: akun tidak ditemukan, bukan kas/bank, atau bukan milik perusahaan pemberi dana.",
          code: "INVALID_RECEIVER_ACCOUNT",
        });
      }
    }

    // ── Journal posting ────────────────────────────────────────────────────────
    let entryId: number | null = null;
    let payerJournalId: number | null = null;
    let icReference: string | null = null;
    let repaymentPersistedInPair = false;
    let pairedRepaymentId: number | null = null;

    if (resolvedReceiverAccountId && adv.receivable_account_id) {
      // Count existing repayments first so each one gets a distinct refSuffix
      const [{ count: existingRepaymentCount }] = await db.execute<any>(
        sql`SELECT COUNT(*)::int AS count FROM cash_advance_repayments WHERE advance_id = ${id}`
      ).then(r => r.rows);
      const repayNumber = String(Number(existingRepaymentCount) + 1);

      // ── ATOMICITY: Post PAYER journal FIRST (if intercompany) ────────────────
      // Order: payer → receiver
      //   - If payer fails  → nothing committed → safe to return error
      //   - If receiver fails after payer → void payer → return error
      //   This prevents the old "receiver committed, payer failed" half-posted state.
      if (isIntercompany) {
        icReference = `IC-RPY-${adv.advance_number}-${repayNumber}`;
        if (!payer_coa_account_id) {
          return res.status(400).json({
            message: "Akun kas/bank perusahaan penanggung wajib dipilih untuk repayment intercompany.",
            code: "INVALID_PAYER_ACCOUNT",
          });
        }
        const accounts = await resolveIntercompanyAccounts({
          fundingCompanyId,
          responsibleCompanyId,
          category: adv.category,
        });
        const pair = await AdvanceJournalService.postIntercompanyRepaymentPair({
          fundingCompanyId,
          responsibleCompanyId,
          advanceNumber: adv.advance_number,
          partyName: adv.party_name,
          amount: repayAmt,
          date,
          repaymentNumber: repayNumber,
          fundingReceivableAccountId: accounts.fundingReceivable.id,
          fundingCashBankAccountId: Number(resolvedReceiverAccountId),
          responsiblePayableAccountId: accounts.responsiblePayable.id,
          responsibleCashBankAccountId: Number(payer_coa_account_id),
          afterPost: async (tx, entries) => {
            const [lockedAdvance] = await tx.execute(sql`
              SELECT remaining_amount
              FROM cash_advances
              WHERE id = ${id}
              FOR UPDATE
            `).then((r: any) => r.rows as any[]);
            const lockedRemaining = Number(lockedAdvance?.remaining_amount);
            if (!Number.isFinite(lockedRemaining) || repayAmt > lockedRemaining + 0.01) {
              throw new Error(
                `INSUFFICIENT_REMAINING: repayment ${repayAmt} exceeds remaining ${lockedRemaining}`,
              );
            }
            const newRemaining = Math.max(0, lockedRemaining - repayAmt);
            const newLifecycle = deriveStatusAfterPayment(newRemaining);
            const newLegacyStatus = mapToLegacyStatus(newLifecycle);
            const [repRow] = await tx.execute(sql`
              INSERT INTO cash_advance_repayments (
                advance_id, amount, payment_method, source_account_id, date, notes, entry_id,
                payer_company_id, payer_coa_account_id, receiver_company_id, receiver_coa_account_id,
                payment_reference, intercompany_reference, payer_journal_id, receiver_journal_id,
                idempotency_key, posted_at, created_by
              ) VALUES (
                ${id}, ${repayAmt}, ${payment_method ?? "bank"}, ${Number(resolvedReceiverAccountId)},
                ${date}, ${notes ?? null}, ${entries.mirrorEntry.id},
                ${responsibleCompanyId}, ${Number(payer_coa_account_id)}, ${fundingCompanyId},
                ${Number(resolvedReceiverAccountId)}, ${payment_reference ?? null}, ${icReference},
                ${entries.sourceEntry.id}, ${entries.mirrorEntry.id}, ${idempotency_key ?? null},
                NOW(), ${(req as any).user?.name ?? (req as any).user?.email ?? null}
              )
              RETURNING id
            `).then((r: any) => r.rows);
            await tx.execute(sql`
              UPDATE cash_advances
              SET paid_amount = COALESCE(paid_amount, 0) + ${repayAmt},
                  remaining_amount = ${newRemaining},
                  lifecycle_status = ${newLifecycle},
                  status = ${newLegacyStatus},
                  repayment_journal_id = ${entries.mirrorEntry.id},
                  intercompany_paid_amount = COALESCE(intercompany_paid_amount, 0) + ${repayAmt},
                  intercompany_status = ${newRemaining <= 0 ? "settled" : "partial"},
                  updated_at = NOW()
              WHERE id = ${id}
            `);
            await tx.execute(sql`
              UPDATE ar_subledger
              SET paid_amount = LEAST(gross_amount, COALESCE(paid_amount, 0) + ${repayAmt}),
                  outstanding_amount = GREATEST(0, outstanding_amount - ${repayAmt}),
                  status = CASE
                    WHEN outstanding_amount - ${repayAmt} <= 0 THEN 'CLOSED'
                    ELSE 'PARTIAL'
                  END,
                  updated_at = NOW()
              WHERE company_id = ${fundingCompanyId} AND invoice_id = ${id}
            `);
            await tx.execute(sql`
              UPDATE ap_subledger
              SET paid_amount = LEAST(payable_amount, COALESCE(paid_amount, 0) + ${repayAmt}),
                  status = CASE
                    WHEN payable_amount - (COALESCE(paid_amount, 0) + ${repayAmt}) <= 0 THEN 'PAID'
                    ELSE 'PARTIAL'
                  END,
                  updated_at = NOW()
              WHERE company_id = ${responsibleCompanyId} AND bill_id = ${id}
            `);
            pairedRepaymentId = repRow?.id ?? null;
            repaymentPersistedInPair = true;
          },
        });
        entryId = pair.fundingEntryId;
        payerJournalId = pair.responsibleEntryId;
      }

      // Post receiver (advance company) journal: DR Kas/Bank Penerima / CR Piutang Dana Talangan
      // Posted SECOND — if this fails and payer was already posted, we void the payer.
      if (!repaymentPersistedInPair) try {
        const result = await AdvanceJournalService.postRepaymentJournal({
          companyId: fundingCompanyId,
          advanceNumber: adv.advance_number,
          partyName: adv.party_name,
          amount: repayAmt,
          date,
          receivableAccountId: Number(adv.receivable_account_id),
          cashBankAccountId: Number(resolvedReceiverAccountId),
          paymentMethod: payment_method ?? "bank",
          refSuffix: repayNumber,
        });
        entryId = result.entryId;
      } catch (recvErr: any) {
        // Receiver failed — try to void the payer journal if it was posted
        if (payerJournalId) {
          console.error("[advances/repay] receiver journal failed after payer — voiding payer journal:", recvErr?.message);
          try {
            await AdvanceJournalService.postVoidReversal({
              originalEntryId: payerJournalId,
            companyId: responsibleCompanyId,
              advanceNumber: adv.advance_number,
              actor: (req as any).user?.name ?? null,
              reason: "Auto-void: receiver journal failed during repayment",
            });
          } catch (voidErr: any) {
            console.error("[advances/repay] payer void also failed — needs manual intervention:", voidErr?.message);
          }
        }
        throw recvErr;
      }
    }

    // ── Persist repayment row ──────────────────────────────────────────────────
    const [repRow] = repaymentPersistedInPair
      ? [{ id: pairedRepaymentId }]
      : await db.execute<any>(sql`
      INSERT INTO cash_advance_repayments (
        advance_id, amount, payment_method, source_account_id, date, notes, entry_id,
        payer_company_id, payer_coa_account_id, receiver_company_id, receiver_coa_account_id,
        payment_reference, intercompany_reference, payer_journal_id, receiver_journal_id,
        idempotency_key, posted_at, created_by
      ) VALUES (
        ${id}, ${repayAmt}, ${payment_method ?? "bank"}, ${resolvedReceiverAccountId ?? null},
        ${date}, ${notes ?? null}, ${entryId ?? null},
        ${payer_company_id ? Number(payer_company_id) : null},
        ${payer_coa_account_id ? Number(payer_coa_account_id) : null},
        ${fundingCompanyId},
        ${resolvedReceiverAccountId ? Number(resolvedReceiverAccountId) : null},
        ${payment_reference ?? null},
        ${icReference},
        ${payerJournalId},
        ${entryId},
        ${idempotency_key ?? null},
        NOW(),
        ${(req as any).user?.name ?? (req as any).user?.email ?? null}
      )
      RETURNING id
    `).then(r => r.rows);

    const newRemaining = Math.max(0, Number(adv.remaining_amount) - repayAmt);
    const newLifecycle = deriveStatusAfterPayment(newRemaining);
    const newLegacyStatus = mapToLegacyStatus(newLifecycle);

    if (!repaymentPersistedInPair) await db.execute(sql`
      UPDATE cash_advances
      SET paid_amount      = COALESCE(paid_amount, 0) + ${repayAmt},
          remaining_amount = ${newRemaining},
          lifecycle_status = ${newLifecycle},
          status           = ${newLegacyStatus},
          repaid_at        = ${newLifecycle === "settled" ? sql`NOW()` : sql`repaid_at`},
          repayment_journal_id = ${entryId},
          updated_at = NOW()
      WHERE id = ${id}
    `);

    auditFromReq(req, {
      action: "advance_repaid", module: "advance_management",
      newData: {
        id, repay_amount: repayAmt, new_lifecycle: newLifecycle, remaining: newRemaining,
        entry_id: entryId, payer_journal_id: payerJournalId, is_intercompany: isIntercompany,
      },
    });

    res.json({
      success: true,
      remaining_amount: newRemaining,
      lifecycle_status: newLifecycle,
      entry_id: entryId,
      payer_journal_id: payerJournalId,
      intercompany_reference: icReference,
      repayment_id: repRow?.id ?? null,
    });
  } catch (err: any) {
    // ── Structured server-side logging — NEVER forward raw SQL to client ──────
    const cause = err?.cause ?? {};
    const pgCode   = cause.code    ?? "";
    const pgMsg    = cause.message ?? "";
    const pgDetail = cause.detail  ?? "";
    const pgConstr = cause.constraint ?? "";
    const reqId = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 7);
    console.error("[advances/repay] journal error", {
      requestId: reqId,
      advanceId: req.params.id,
      companyId: resolveCompanyId(req),
      errorMessage: err?.message ?? String(err),
      pgCode, pgMsg, pgDetail, pgConstr,
    });
    sendAdvanceError(res, err, reqId);
  }
});

// ── DELETE /:id — Hard delete (only if no journal posted) ─────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const companyId = resolveCompanyId(req);
    const [adv] = await db.execute<any>(sql`SELECT * FROM cash_advances WHERE id = ${id} AND company_id = ${companyId}`).then(r => r.rows);
    if (!adv) return res.status(404).json({ message: "Not found" });

    // STATE MACHINE delete guard
    const currentStatus = (adv.lifecycle_status ?? adv.status) as LifecycleStatus;
    const entryId = adv.entry_id ? Number(adv.entry_id) : null;
    if (!canDelete(currentStatus, entryId)) {
      if (entryId) {
        return res.status(400).json({
          message: "Advance yang sudah diposting tidak bisa dihapus — gunakan Void/Repayment.",
          code: "POSTED_JOURNAL_BLOCKED",
        });
      }
      return res.status(400).json({
        message: `Advance dengan status '${currentStatus}' tidak bisa dihapus. Hanya draft/pending_approval/rejected/cancelled yang bisa dihapus.`,
        code: "INVALID_TRANSITION",
      });
    }

    await db.execute(sql`DELETE FROM expense_approval_requests WHERE ref_id = ${id} AND ref_type IN ('kasbon','talangan','advance')`).catch(() => {});
    await db.execute(sql`DELETE FROM cash_advances WHERE id = ${id}`);

    auditFromReq(req, {
      action: "advance_deleted", module: "advance_management",
      oldData: { id, advance_number: adv.advance_number, status: currentStatus },
    });

    res.json({ success: true });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

// ── POST /admin/fix-coa-reclassify ─────────────────────────────────────────────
// ONE-TIME admin utility: creates correcting reclassification journal entries for
// kasbon advances whose disbursement journal was mistakenly posted to the talangan
// COA (1-1033*) instead of the kasbon COA (1-1032*).
//
// Safe to call multiple times — idempotent via "already-corrected" detection.
// Creates a new posted journal entry: DR Piutang Karyawan (1-1032) / CR Piutang Dana Talangan (1-1033).
router.post("/admin/fix-coa-reclassify", async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);

    // Find kasbon advances that have posted entry lines debiting a talangan COA (code LIKE '1-1033%').
    // Join via ca.entry_id (direct link set at disburse time) OR via description fallback for
    // advances created before entry_id was persisted.
    const affected = await db.execute<{
      advance_id: number;
      advance_number: string;
      company_id: number;
      wrong_account_id: number;
      wrong_account_code: string;
      wrong_account_name: string;
      wrong_debit: string;
    }>(sql`
      SELECT
        ca.id            AS advance_id,
        ca.advance_number,
        ca.company_id,
        ael.account_id   AS wrong_account_id,
        coa.code         AS wrong_account_code,
        coa.name         AS wrong_account_name,
        SUM(ael.debit)   AS wrong_debit
      FROM cash_advances ca
      JOIN accounting_entries ae ON ae.status = 'posted'
        AND (
          ae.id = ca.entry_id
          OR ae.description ILIKE '%' || ca.advance_number || '%'
          OR ae.ref ILIKE '%' || ca.advance_number || '%'
        )
      JOIN accounting_entry_lines ael ON ael.entry_id = ae.id AND ael.debit > 0
      JOIN chart_of_accounts coa ON coa.id = ael.account_id
        AND coa.code LIKE '1-1033%'
      WHERE ca.type ILIKE '%kasbon%'
        AND ca.company_id = ${companyId}
        AND NOT EXISTS (
          SELECT 1 FROM accounting_entries ae2
          WHERE ae2.ref LIKE 'KOREKSI-COA: ' || ca.advance_number || '%'
            AND ae2.status = 'posted'
        )
      GROUP BY ca.id, ca.advance_number, ca.company_id, ael.account_id, coa.code, coa.name
      HAVING SUM(ael.debit) > 0
    `).then(r => r.rows);

    if (affected.length === 0) {
      return res.json({ success: true, corrected: 0, message: "Tidak ada kasbon yang perlu dikoreksi." });
    }

    const corrections: Array<{ advance_number: string; amount: number; entry_id: number }> = [];

    for (const adv of affected) {
      const amount = parseFloat(adv.wrong_debit);
      if (!amount || amount <= 0) continue;

      // Get kasbon COA for this company — auto-create if missing
      let kasbonCoa = await db.execute<{ id: number; code: string; name: string }>(sql`
        SELECT id, code, name FROM chart_of_accounts
        WHERE code LIKE '1-1032%'
          AND (company_id = ${adv.company_id} OR company_id IS NULL)
        ORDER BY company_id DESC NULLS LAST LIMIT 1
      `).then(r => r.rows[0] ?? null);

      if (!kasbonCoa) {
        // 1-1032-{company} belum ada — derive code suffix dari 1-1033 sibling (e.g. '1-1033-CST' → '1-1032-CST')
        const talanganCoa = await db.execute<{ code: string }>(sql`
          SELECT code FROM chart_of_accounts
          WHERE code LIKE '1-1033%' AND company_id = ${adv.company_id}
          ORDER BY company_id DESC NULLS LAST LIMIT 1
        `).then(r => r.rows[0] ?? null);
        const suffix = talanganCoa ? talanganCoa.code.replace(/^1-1033/, "") : "";
        const newCode = `1-1032${suffix}`;
        const newName = `Piutang Karyawan (Kasbon)${suffix ? " " + suffix.replace(/^[-_]/, "") : ""}`;
        const created = await db.execute<{ id: number; code: string; name: string }>(sql`
          INSERT INTO chart_of_accounts (company_id, code, name, type, subtype, is_active, created_at)
          VALUES (${adv.company_id}, ${newCode}, ${newName}, 'asset', 'receivable', true, NOW())
          ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name
          RETURNING id, code, name
        `).then(r => r.rows[0] ?? null);
        kasbonCoa = created ?? null;
      }

      if (!kasbonCoa) continue;

      // Get general journal
      const journal = await db.execute<{ id: number }>(sql`
        SELECT id FROM accounting_journals
        WHERE (company_id = ${adv.company_id} OR company_id IS NULL)
          AND type IN ('general','bank')
        ORDER BY type DESC, company_id DESC NULLS LAST LIMIT 1
      `).then(r => r.rows[0] ?? null);
      if (!journal) continue;

      // Generate entry_number: JNL/YYYY/NNNNNN (NOT NULL, no DB default)
      const entryNumRes = await db.execute<{ next_seq: string }>(sql`
        SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number, '/', 3) AS INTEGER)), 0) + 1 AS next_seq
        FROM accounting_entries
        WHERE company_id = ${adv.company_id}
          AND entry_number LIKE 'JNL/%'
      `);
      const nextSeq = Number(entryNumRes.rows[0]?.next_seq ?? 1);
      const entryYear = new Date().getFullYear();
      const entryNumber = `JNL/${entryYear}/${String(nextSeq).padStart(6, "0")}`;
      const entryRef = `KOREKSI-COA: ${adv.advance_number}`;
      const entryDesc = `KOREKSI-COA: ${adv.advance_number} — Reklasifikasi Kasbon dari ${adv.wrong_account_code} (${adv.wrong_account_name}) ke ${kasbonCoa.code} (${kasbonCoa.name})`;

      const newEntry = await db.execute<{ id: number }>(sql`
        INSERT INTO accounting_entries (
          company_id, entry_number, journal_id, date, ref, description,
          status, source, total_debit, total_credit, system_override
        ) VALUES (
          ${adv.company_id},
          ${entryNumber},
          ${journal.id},
          NOW()::DATE,
          ${entryRef},
          ${entryDesc},
          'posted',
          'manual',
          ${amount},
          ${amount},
          true
        )
        RETURNING id
      `).then(r => r.rows[0] ?? null);
      if (!newEntry) continue;

      await db.execute(sql`
        INSERT INTO accounting_entry_lines (entry_id, account_id, description, debit, credit, company_id)
        VALUES
          (${newEntry.id}, ${kasbonCoa.id},
           ${'Koreksi: Reklasifikasi ke ' + kasbonCoa.name}, ${amount}, 0, ${adv.company_id}),
          (${newEntry.id}, ${adv.wrong_account_id},
           ${'Koreksi: Reklasifikasi dari ' + adv.wrong_account_name}, 0, ${amount}, ${adv.company_id})
      `);

      corrections.push({ advance_number: adv.advance_number, amount, entry_id: newEntry.id });

      auditFromReq(req, {
        action: "advance_coa_reclassified", module: "advance_management",
        newData: { advance_id: adv.advance_id, advance_number: adv.advance_number, amount, from_coa: adv.wrong_account_code, to_coa: kasbonCoa.code, entry_id: newEntry.id },
      });
    }

    res.json({
      success: true,
      corrected: corrections.length,
      corrections,
      message: `${corrections.length} kasbon berhasil direklasifikasi ke akun Piutang Karyawan (Kasbon).`,
    });
  } catch (err: any) {
    sendAdvanceError(res, err);
  }
});

export default router;
