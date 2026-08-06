/**
 * @deprecated cashAdvances.ts — LEGACY ENGINE
 *
 * This file is DEPRECATED. It handles the original kasbon/talangan advance
 * routes that were written before the Unified Advance Engine was introduced.
 *
 * DO NOT ADD NEW FEATURES HERE.
 *
 * Migration path:
 *   - All new advance functionality → routes/advances.ts
 *   - All new advance types         → ADVANCE_TYPES in routes/advances.ts
 *   - API base URL                  → /api/advances/*
 *
 * These legacy routes (/api/cash-advances/*) remain active only while the
 * BizPortal frontend is being migrated. Once the frontend migration is
 * complete, this file will be removed.
 *
 * See: docs/advance-architecture-consolidation.md
 */
import { Router, type Request } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import multer from "multer";
import { logger } from "../lib/logger.js";
import {
  db, cashAdvancesTable, cashAdvanceRepaymentsTable,
  chartOfAccountsTable, accountingJournalsTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { postEntry } from "../lib/accounting.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { auditFromReq, auditFromReqSync } from "../lib/auditLog.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { getOpenAI } from "../lib/openaiClient.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
const _objStoreSvc = new ObjectStorageService();
import {
  assertCanDeleteTransaction,
  assertCanVoidTransaction,
  createReversalJournal,
  logPostingGuardAction,
} from "../lib/accountingPostingGuard.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ─── Inline migration ────────────────────────────────────────────────────────
async function ensureTables() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS cash_advances (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      advance_number TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      party_name TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      remaining_amount NUMERIC(14,2) NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'bank',
      date DATE NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      receivable_account_id INTEGER,
      cash_bank_account_id INTEGER,
      entry_id INTEGER,
      created_by_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS cash_advance_repayments (
      id SERIAL PRIMARY KEY,
      advance_id INTEGER NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'bank',
      date DATE NOT NULL,
      notes TEXT,
      entry_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS cash_advances_company_idx ON cash_advances(company_id)`,
    `CREATE INDEX IF NOT EXISTS cash_advances_type_idx ON cash_advances(type)`,
    `CREATE INDEX IF NOT EXISTS cash_advances_status_idx ON cash_advances(status)`,
    `CREATE INDEX IF NOT EXISTS cash_advance_repayments_advance_idx ON cash_advance_repayments(advance_id)`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS approval_request_id INTEGER`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS vendor_id INTEGER`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS user_id TEXT`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS category TEXT`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS receipt_url TEXT`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS ocr_raw_data TEXT`,
    // ── Accounting Posting Integrity columns ──────────────────────────────────
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMP`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS repaid_at TIMESTAMP`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS voided_by TEXT`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS void_reason TEXT`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS reversal_journal_id INTEGER`,
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS repayment_journal_id INTEGER`,
    `CREATE INDEX IF NOT EXISTS cash_advances_entry_idx ON cash_advances(entry_id)`,
    // ── Pertanggungjawaban (settle-to-expense) ────────────────────────────────
    // Berbeda dari repay: TIDAK ada uang kas yang kembali. Kasbon direklasifikasi
    // dari Piutang Karyawan menjadi Beban, dibuktikan dengan receipt.
    `ALTER TABLE cash_advances ADD COLUMN IF NOT EXISTS settled_amount NUMERIC(14,2) NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS cash_advance_settlements (
      id SERIAL PRIMARY KEY,
      advance_id INTEGER NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      expense_account_id INTEGER,
      category TEXT,
      date DATE NOT NULL,
      notes TEXT,
      receipt_url TEXT,
      entry_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS cash_advance_settlements_advance_idx ON cash_advance_settlements(advance_id)`,
    // ── Repayment receipt & source account ─────────────────────────────────────
    `ALTER TABLE cash_advance_repayments ADD COLUMN IF NOT EXISTS receipt_url TEXT`,
    `ALTER TABLE cash_advance_repayments ADD COLUMN IF NOT EXISTS source_account_id INTEGER`,
  ];
  for (const stmt of stmts) {
    await db.execute(sql.raw(stmt)).catch(() => {});
  }
}
ensureTables().catch(console.error);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeAdv(r: any) {
  return {
    ...r,
    id: Number(r.id),
    amount: Number(r.amount),
    paidAmount: Number(r.paid_amount ?? r.paidAmount ?? 0),
    remainingAmount: Number(r.remaining_amount ?? r.remainingAmount ?? 0),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at ?? r.createdAt,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at ?? r.updatedAt,
    ocrRawData: r.ocr_raw_data ? (() => { try { return JSON.parse(r.ocr_raw_data); } catch { return null; } })() : null,
  };
}
function serializeRep(r: typeof cashAdvanceRepaymentsTable.$inferSelect) {
  return {
    ...r,
    amount: Number(r.amount),
    createdAt: r.createdAt.toISOString(),
    receiptUrl: (r as any).receipt_url ?? r.receiptUrl ?? null,
    sourceAccountId: (r as any).source_account_id ?? r.sourceAccountId ?? null,
  };
}

const PREFIXES: Record<string, string> = { kasbon: "KSB", talangan: "TLG" };

async function nextAdvanceNumber(type: string): Promise<string> {
  const prefix = PREFIXES[type] ?? "ADV";
  const year = new Date().getFullYear();
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`cast(count(*) as int)` })
    .from(cashAdvancesTable)
    .where(and(
      eq(cashAdvancesTable.type, type),
      sql`advance_number LIKE ${`${prefix}/${year}/%`}`,
    ));
  return `${prefix}/${year}/${String(Number(cnt) + 1).padStart(5, "0")}`;
}

async function resolveReceivableAccount(type: string, companyId: number | null) {
  const coaCode = type === "kasbon" ? "1-1032" : "1-1033";
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

// ─── Helper: post journal for cash advance ────────────────────────────────────
export async function postCashAdvanceJournal(advId: number) {
  const result = await db.execute(sql`SELECT * FROM cash_advances WHERE id = ${advId}`);
  const r = result.rows[0] as any;
  if (!r) throw new Error("Kasbon tidak ditemukan");

  const companyId: number | null = r.company_id ?? null;
  const settings = await ensureAccountingSettings(companyId ?? undefined);
  const receivableAccountId: number = r.receivable_account_id;
  const cashBankAccountId: number = r.cash_bank_account_id ?? await resolveCashBankAccount(r.payment_method, settings);

  if (!receivableAccountId || !cashBankAccountId)
    throw new Error("Akun piutang/kas tidak ditemukan");

  const journalType = (r.payment_method ?? "bank") === "cash" ? "cash" : "bank";
  const [journal] = await db.select().from(accountingJournalsTable)
    .where(eq(accountingJournalsTable.type, journalType as any)).limit(1);
  const fallback = !journal
    ? (await db.select().from(accountingJournalsTable).limit(1))[0]
    : null;
  const j = journal ?? fallback;
  if (!j) throw new Error("Jurnal kas/bank tidak ditemukan");

  const typeLabel = r.type === "kasbon" ? "Kasbon" : "Dana Talangan";
  const amountN = Number(r.amount);
  const entry = await postEntry({
    journalId: j.id,
    date: new Date(r.date),
    ref: r.advance_number,
    description: `${r.advance_number} — ${typeLabel} ${r.party_name}`,
    source: "manual",
    companyId,
    lines: [
      { accountId: receivableAccountId, debit: amountN, credit: 0, description: `${typeLabel} — ${r.party_name}` },
      { accountId: cashBankAccountId, debit: 0, credit: amountN, description: r.payment_method === "cash" ? "Kas" : "Bank" },
    ],
  }, j.code);

  await db.execute(sql`UPDATE cash_advances SET entry_id = ${entry.id}, status = 'active', disbursed_at = NOW(), updated_at = NOW() WHERE id = ${advId}`);
  return entry;
}

// ─── Check approval limit ──────────────────────────────────────────────────────
async function checkApprovalLimit(type: string, companyId: number | null, amount: number) {
  const result = await db.execute(sql`
    SELECT * FROM expense_approval_limits
    WHERE category = ${type}
      AND (company_id = ${companyId} OR company_id IS NULL)
    ORDER BY company_id NULLS LAST
    LIMIT 1
  `);
  const limit = result.rows[0] as any | undefined;
  if (!limit) return { needsApproval: false, limit: null };
  const maxAuto = parseFloat(limit.max_auto_approve ?? "0");
  const needsApproval = maxAuto === 0 || amount > maxAuto;
  return { needsApproval, limit };
}

// ─── Expense accounts (untuk dropdown Pertanggungjawaban) ──────────────────────
router.get("/expense-accounts", async (req: Request, res) => {
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
  return res.json(rows);
});

// ─── List ──────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const { type, status, from, to } = req.query as Record<string, string>;
  const conditions = [sql`ca.company_id = ${companyId}`];
  if (type) conditions.push(sql`ca.type = ${type}`);
  if (status) conditions.push(sql`ca.status = ${status}`);
  if (from) conditions.push(sql`ca.date >= ${from}::date`);
  if (to) conditions.push(sql`ca.date <= ${to}::date`);

  const result = await db.execute(sql`
    SELECT ca.*,
      coa.code AS cash_bank_account_code,
      coa.name AS cash_bank_account_name,
      sup.name AS vendor_name,
      u.name AS employee_name,
      u.email AS employee_email,
      dep.name AS employee_department,
      dv.name AS employee_division,
      u.name   AS user_name
    FROM cash_advances ca
    LEFT JOIN chart_of_accounts coa ON ca.cash_bank_account_id = coa.id
    LEFT JOIN suppliers sup ON ca.vendor_id = sup.id
    LEFT JOIN users u ON ca.user_id = u.id
    LEFT JOIN departments dep ON u.department_id = dep.id
    LEFT JOIN divisions dv ON u.division_id = dv.id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ca.date DESC, ca.id DESC
    LIMIT 500
  `);

  return res.json((result.rows as any[]).map((r) => ({
    ...serializeAdv(r),
    cashBankAccount: r.cash_bank_account_id
      ? { id: r.cash_bank_account_id, code: r.cash_bank_account_code, name: r.cash_bank_account_name }
      : null,
    vendor: r.vendor_id ? { id: r.vendor_id, name: r.vendor_name } : null,
    employee: r.user_id
      ? { id: r.user_id, name: r.employee_name, email: r.employee_email, department: r.employee_department, division: r.employee_division }
      : null,
    user: r.user_id ? { id: r.user_id, name: r.user_name } : null,
  })));
});

// ─── Detail ────────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const result = await db.execute(sql`
    SELECT ca.*,
      u.name AS employee_name, u.email AS employee_email,
      dep.name AS employee_department, dv.name AS employee_division,
      sec.name AS employee_section
    FROM cash_advances ca
    LEFT JOIN users u ON ca.user_id = u.id
    LEFT JOIN departments dep ON u.department_id = dep.id
    LEFT JOIN divisions dv ON u.division_id = dv.id
    LEFT JOIN sections sec ON u.section_id = sec.id
    WHERE ca.id = ${id}
  `);
  const adv = result.rows[0] as any;
  if (!adv) return res.status(404).json({ message: "Not found" });
  // IDOR guard
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(Number(adv.company_id) || null, companyId, req, res, { resourceType: "cash_advance", resourceId: id })) return;
  const repayments = await db
    .select().from(cashAdvanceRepaymentsTable)
    .where(eq(cashAdvanceRepaymentsTable.advanceId, id))
    .orderBy(desc(cashAdvanceRepaymentsTable.date), desc(cashAdvanceRepaymentsTable.id));
  const settlementsResult = await db.execute(sql`
    SELECT s.*, coa.code AS expense_account_code, coa.name AS expense_account_name
    FROM cash_advance_settlements s
    LEFT JOIN chart_of_accounts coa ON s.expense_account_id = coa.id
    WHERE s.advance_id = ${id}
    ORDER BY s.date DESC, s.id DESC
  `).catch(() => ({ rows: [] }));
  const approvalResult = await db.execute(sql`
    SELECT * FROM expense_approval_requests WHERE ref_type IN ('kasbon','talangan') AND ref_id = ${id} ORDER BY id DESC LIMIT 1
  `);
  const auditResult = await db.execute(sql`
    SELECT action, module, new_data, created_at, user_email
    FROM erp_audit_logs
    WHERE module = 'kasbon' AND reference_id = ${String(id)}
    ORDER BY created_at DESC LIMIT 20
  `).catch(() => ({ rows: [] }));

  const employee = adv.user_id ? {
    id: adv.user_id,
    name: adv.employee_name,
    email: adv.employee_email,
    department: adv.employee_department,
    division: adv.employee_division,
    section: adv.employee_section,
  } : null;

  return res.json({
    ...serializeAdv(adv),
    employee,
    repayments: repayments.map(serializeRep),
    settlements: (settlementsResult.rows as any[]).map((s) => ({
      ...s,
      id: Number(s.id),
      amount: Number(s.amount),
      expenseAccount: s.expense_account_id ? { id: s.expense_account_id, code: s.expense_account_code, name: s.expense_account_name } : null,
    })),
    approvalRequest: approvalResult.rows[0] ?? null,
    auditLogs: auditResult.rows ?? [],
  });
});

// ─── Create ────────────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res) => {
  const { type, partyName, amount, paymentMethod, date, notes, vendorId, sourceAccountId, category, userId: bodyUserId } = req.body ?? {};
  if (!type || !["kasbon", "talangan"].includes(type))
    return res.status(400).json({ message: "type harus 'kasbon' atau 'talangan'." });
  if (!partyName?.trim()) return res.status(400).json({ message: "Nama pihak wajib diisi." });
  const amountN = Number(amount ?? 0);
  if (amountN <= 0) return res.status(400).json({ message: "Nominal harus lebih dari 0." });
  if (!date) return res.status(400).json({ message: "Tanggal wajib diisi." });

  const companyId = resolveCompanyId(req);
  const settings = await ensureAccountingSettings(companyId);

  const receivableAccountId = await resolveReceivableAccount(type, companyId);
  if (!receivableAccountId)
    return res.status(400).json({ message: `Akun piutang (${type === "kasbon" ? "1-1032" : "1-1033"}) belum ada di COA.` });

  const resolvedCashBank = sourceAccountId
    ? Number(sourceAccountId)
    : await resolveCashBankAccount(paymentMethod ?? "bank", settings);
  const cashBankAccountId = resolvedCashBank;
  if (!cashBankAccountId)
    return res.status(400).json({ message: "Akun Kas/Bank default belum dikonfigurasi." });

  const { needsApproval, limit } = await checkApprovalLimit(type, companyId, amountN);
  const advanceNumber = await nextAdvanceNumber(type);
  const creatorUserId = (req as any).userId ?? null;
  // bodyUserId = karyawan yang menerima kasbon (dari combobox di frontend)
  const employeeUserId = bodyUserId ? String(bodyUserId) : null;
  const categoryVal = category ? String(category).trim() : null;

  if (needsApproval && limit) {
    const [adv] = await db.insert(cashAdvancesTable).values({
      companyId,
      advanceNumber,
      type,
      partyName: String(partyName).trim(),
      amount: String(amountN),
      paidAmount: "0",
      remainingAmount: String(amountN),
      paymentMethod: paymentMethod ?? "bank",
      date: String(date),
      notes: notes ? String(notes) : null,
      status: "pending_approval",
      receivableAccountId,
      cashBankAccountId,
      vendorId: vendorId ? Number(vendorId) : null,
      userId: employeeUserId,
      createdById: creatorUserId,
    }).returning();

    if (!adv) return res.status(500).json({ message: "Gagal membuat kasbon — insert tidak mengembalikan data." });

    // Set category via parameterized SQL (column added via migration)
    if (categoryVal) {
      await db.execute(sql`UPDATE cash_advances SET category = ${categoryVal} WHERE id = ${adv.id}`);
    }

    let requesterName: string | null = null;
    if (creatorUserId) {
      const ur = await db.execute(sql`SELECT name FROM users WHERE id = ${creatorUserId} LIMIT 1`);
      requesterName = (ur.rows[0] as any)?.name ?? null;
    }
    let l1Name: string | null = null, l2Name: string | null = null;
    if (limit.l1_approver_id) {
      const r = await db.execute(sql`SELECT name FROM users WHERE id = ${limit.l1_approver_id} LIMIT 1`);
      l1Name = (r.rows[0] as any)?.name ?? null;
    }
    if (limit.l2_approver_id) {
      const r = await db.execute(sql`SELECT name FROM users WHERE id = ${limit.l2_approver_id} LIMIT 1`);
      l2Name = (r.rows[0] as any)?.name ?? null;
    }

    const typeLabel = type === "kasbon" ? "Kasbon" : "Dana Talangan";
    const desc = `${typeLabel} ${partyName} — ${new Intl.NumberFormat("id-ID").format(amountN)}`;

    const arResult = await db.execute(sql`
      INSERT INTO expense_approval_requests
        (company_id, ref_type, ref_id, description, amount, requester_id, requester_name,
         status, l1_approver_id, l1_approver_name, l1_status,
         l2_approver_id, l2_approver_name, l2_status)
      VALUES
        (
          ${companyId},
          ${type},
          ${adv.id},
          ${desc},
          ${amountN},
          ${creatorUserId},
          ${requesterName},
          'pending',
          ${limit.l1_approver_id ?? null},
          ${l1Name},
          ${limit.l1_approver_id ? "pending" : null},
          ${limit.l2_approver_id ?? null},
          ${l2Name},
          ${limit.l2_approver_id ? "pending" : null}
        )
      RETURNING id
    `);
    const arId = (arResult.rows[0] as any)?.id;
    if (arId) {
      await db.execute(sql`UPDATE cash_advances SET approval_request_id = ${arId} WHERE id = ${adv.id}`);
    }

    try {
      const { getAdminGroupWa } = await import("../lib/adminWa.js");
      const { sendViaService: sendWhatsApp } = await import("../lib/waTransport.js");
      const adminGroup = await getAdminGroupWa();
      if (adminGroup) {
        const approverInfo = l1Name ? `Menunggu persetujuan: *${l1Name}*` : "Tidak ada approver yang dikonfigurasi";
        const msg = `🔔 *Permintaan ${typeLabel} Baru*\n\nNo: ${advanceNumber}\nNama: ${partyName}\nKategori: ${categoryVal ?? "-"}\nNominal: Rp ${new Intl.NumberFormat("id-ID").format(amountN)}\n${approverInfo}`;
        sendWhatsApp(adminGroup, msg, { context: "expense_approval_request", refId: String(arId) }).catch(() => {});
      }
    } catch { /* non-fatal */ }

    auditFromReq(req, {
      action: "kasbon_created",
      module: "kasbon",
      referenceId: String(adv.id),
      newData: { advanceNumber, partyName, amount: amountN, status: "pending_approval", category: categoryVal },
    });

    return res.status(201).json({
      ...serializeAdv(adv),
      needsApproval: true,
      approvalRequestId: arId ?? null,
      message: `${typeLabel} menunggu persetujuan (melebihi limit auto-approve).`,
    });
  }

  // ── Tidak perlu approval — buat langsung dengan jurnal ──────────────────────
  const [adv] = await db.insert(cashAdvancesTable).values({
    companyId,
    advanceNumber,
    type,
    partyName: String(partyName).trim(),
    amount: String(amountN),
    paidAmount: "0",
    remainingAmount: String(amountN),
    paymentMethod: paymentMethod ?? "bank",
    date: String(date),
    notes: notes ? String(notes) : null,
    status: "active",
    receivableAccountId,
    cashBankAccountId,
    vendorId: vendorId ? Number(vendorId) : null,
    userId: employeeUserId,
    createdById: creatorUserId,
  }).returning();

  if (!adv) return res.status(500).json({ message: "Gagal membuat kasbon — insert tidak mengembalikan data." });

  if (categoryVal) {
    await db.execute(sql`UPDATE cash_advances SET category = ${categoryVal} WHERE id = ${adv.id}`);
  }

  const journalType = (paymentMethod ?? "bank") === "cash" ? "cash" : "bank";
  const [journal] = await db.select().from(accountingJournalsTable)
    .where(eq(accountingJournalsTable.type, journalType as any)).limit(1);
  const fallbackJournal = !journal
    ? (await db.select().from(accountingJournalsTable).limit(1))[0]
    : null;
  const j = journal ?? fallbackJournal;
  if (!j) return res.status(400).json({ message: "Jurnal kas/bank tidak ditemukan." });

  const typeLabel = type === "kasbon" ? "Kasbon" : "Dana Talangan";
  const entry = await postEntry({
    journalId: j.id,
    date: new Date(adv.date),
    ref: adv.advanceNumber,
    description: `${adv.advanceNumber} — ${typeLabel} ${adv.partyName}`,
    source: "manual",
    companyId,
    lines: [
      { accountId: receivableAccountId, debit: amountN, credit: 0, description: `${typeLabel} — ${partyName}` },
      { accountId: cashBankAccountId, debit: 0, credit: amountN, description: paymentMethod === "cash" ? "Kas" : "Bank" },
    ],
  }, j.code);

  await db.update(cashAdvancesTable).set({ entryId: entry.id, disbursedAt: new Date() }).where(eq(cashAdvancesTable.id, adv.id));

  auditFromReq(req, {
    action: "kasbon_created",
    module: "kasbon",
    referenceId: String(adv.id),
    newData: { advanceNumber, partyName, amount: amountN, status: "active", category: categoryVal },
  });

  return res.status(201).json({ ...serializeAdv({ ...adv, entryId: entry.id }), needsApproval: false });
});

// ─── Approve (BD) ──────────────────────────────────────────────────────────────
router.patch("/:id/approve", async (req: Request, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const result = await db.execute(sql`SELECT * FROM cash_advances WHERE id = ${id}`);
  const adv = result.rows[0] as any;
  if (!adv) return res.status(404).json({ message: "Kasbon tidak ditemukan." });
  // IDOR guard
  { const cid = resolveCompanyId(req); if (!await assertCompanyAccess(Number(adv.company_id) || null, cid, req, res, { resourceType: "cash_advance", resourceId: id })) return; }
  if (adv.status !== "pending_approval")
    return res.status(400).json({ message: `Kasbon status '${adv.status}' tidak bisa di-approve.` });

  // Post jurnal dan set status → active
  try {
    await postCashAdvanceJournal(id);
  } catch (e: any) {
    return res.status(400).json({ message: `Gagal posting jurnal: ${e.message}` });
  }

  // Update approval request
  await db.execute(sql`
    UPDATE expense_approval_requests
    SET l1_status = 'approved', status = 'approved', updated_at = NOW()
    WHERE ref_type IN ('kasbon','talangan') AND ref_id = ${id}
  `).catch(() => {});

  // Audit SYNCHRONOUS — approve adalah critical action; gagal audit → gagal approve
  try {
    await auditFromReqSync(req, {
      action: "kasbon_approved",
      module: "kasbon",
      referenceId: String(id),
      newData: { advanceNumber: adv.advance_number, partyName: adv.party_name, amount: Number(adv.amount) },
    });
  } catch (auditErr) {
    logger.error({ err: auditErr }, "[kasbon] Audit log gagal saat approve");
    return res.status(500).json({ message: "Kasbon disetujui, namun audit log gagal disimpan. Hubungi administrator." });
  }

  const updated = await db.execute(sql`SELECT * FROM cash_advances WHERE id = ${id}`);
  return res.json({ ...serializeAdv(updated.rows[0] as any), message: "Kasbon disetujui dan jurnal telah diposting." });
});

// ─── Reject (BD) ───────────────────────────────────────────────────────────────
router.patch("/:id/reject", async (req: Request, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { reason } = req.body ?? {};

  const result = await db.execute(sql`SELECT * FROM cash_advances WHERE id = ${id}`);
  const adv = result.rows[0] as any;
  if (!adv) return res.status(404).json({ message: "Kasbon tidak ditemukan." });
  // IDOR guard
  { const cid = resolveCompanyId(req); if (!await assertCompanyAccess(Number(adv.company_id) || null, cid, req, res, { resourceType: "cash_advance", resourceId: id })) return; }
  if (adv.status !== "pending_approval")
    return res.status(400).json({ message: `Kasbon status '${adv.status}' tidak bisa ditolak.` });

  const reasonStr = reason ? String(reason) : null;
  await db.execute(sql`
    UPDATE cash_advances
    SET status = 'rejected', rejection_reason = ${reasonStr}, updated_at = NOW()
    WHERE id = ${id}
  `);

  await db.execute(sql`
    UPDATE expense_approval_requests
    SET l1_status = 'rejected', l1_notes = ${reasonStr}, status = 'rejected', updated_at = NOW()
    WHERE ref_type IN ('kasbon','talangan') AND ref_id = ${id}
  `).catch(() => {});

  // Audit SYNCHRONOUS — reject adalah critical action
  try {
    await auditFromReqSync(req, {
      action: "kasbon_rejected",
      module: "kasbon",
      referenceId: String(id),
      newData: { advanceNumber: adv.advance_number, reason },
    });
  } catch (auditErr) {
    logger.error({ err: auditErr }, "[kasbon] Audit log gagal saat reject");
    return res.status(500).json({ message: "Kasbon ditolak, namun audit log gagal disimpan. Hubungi administrator." });
  }

  const updated = await db.execute(sql`SELECT * FROM cash_advances WHERE id = ${id}`);
  return res.json({ ...serializeAdv(updated.rows[0] as any), message: "Kasbon ditolak." });
});

// ─── OCR Preview: ekstrak nominal dari gambar bukti (tanpa butuh advance ID) ───
// Dipanggil client saat file baru dipilih di form Tambah Cicilan / Kasbon
// agar nominal & tanggal bisa di-auto-fill sebelum user menekan "Catat Cicilan".
router.post("/ocr-preview", upload.single("file"), async (req: Request, res) => {
  if (!req.file) return res.status(400).json({ message: "File wajib diupload." });

  const file = req.file;
  const ext = (file.originalname.split(".").pop() ?? "jpg").toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "webp"].includes(ext);

  if (!isImage && ext !== "pdf")
    return res.status(400).json({ message: "Format tidak didukung. Gunakan JPG, PNG, PDF, atau WEBP." });

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

    return res.json({
      amount: amount && amount > 0 ? amount : null,
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      partyName: parsed.partyName ?? null,
      bankInfo: parsed.bankInfo ?? null,
      confidence: parsed.confidence ?? "medium",
    });
  } catch (e) {
    console.error("[OCR-preview] error:", e);
    return res.status(500).json({ message: "OCR gagal, isi nominal manual.", amount: null, date: null, confidence: "low" });
  }
});

// ─── Upload Receipt + OCR ──────────────────────────────────────────────────────
router.post("/:id/upload-receipt", upload.single("receipt"), async (req: Request, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  if (!req.file) return res.status(400).json({ message: "File receipt wajib diupload." });

  const result = await db.execute(sql`SELECT * FROM cash_advances WHERE id = ${id}`);
  const adv = result.rows[0] as any;
  if (!adv) return res.status(404).json({ message: "Kasbon tidak ditemukan." });
  // IDOR guard
  { const cid = resolveCompanyId(req); if (!await assertCompanyAccess(Number(adv.company_id) || null, cid, req, res, { resourceType: "cash_advance", resourceId: id })) return; }

  const file = req.file;
  const ext = (file.originalname.split(".").pop() ?? "jpg").toLowerCase();
  const allowedExt = ["jpg", "jpeg", "png", "pdf", "webp"];
  if (!allowedExt.includes(ext))
    return res.status(400).json({ message: "Format file tidak didukung. Gunakan JPG, PNG, atau PDF." });

  // ── Upload ke Supabase Storage ───────────────────────────────────────────────
  let receiptUrl: string | null = null;
  try {
    receiptUrl = await _objStoreSvc.uploadPrivateEntity(file.buffer, file.mimetype);
  } catch {
    // Storage optional — OCR masih bisa berjalan
  }

  // ── OCR via OpenAI Vision ────────────────────────────────────────────────────
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
      // PDF — ekstrak teks dulu
      userContent = [
        {
          type: "text",
          text: `Analisa file PDF berikut (base64): ${file.buffer.toString("base64").slice(0, 2000)}...
Ini adalah struk/receipt pembayaran. Ekstrak dalam JSON: amount (angka), date (YYYY-MM-DD), partyName (nama toko), description (deskripsi pembelian), confidence (high/medium/low).
Kembalikan HANYA JSON valid.`,
        },
      ];
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
    console.error("[OCR] Failed:", e);
  }

  // ── Simpan ke DB ──────────────────────────────────────────────────────────────
  await db.execute(sql`
    UPDATE cash_advances
    SET receipt_url = ${receiptUrl}, ocr_raw_data = ${JSON.stringify(ocrResult)}, updated_at = NOW()
    WHERE id = ${id}
  `);

  auditFromReq(req, {
    action: "receipt_uploaded",
    module: "kasbon",
    referenceId: String(id),
    newData: { receiptUrl, ocr: ocrResult },
  });

  return res.json({
    receiptUrl,
    ocr: ocrResult,
    message: "Receipt berhasil diproses.",
  });
});

// ─── Repayment ─────────────────────────────────────────────────────────────────
router.post("/:id/repay", async (req: Request, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  // ── Pre-validate inputs (sebelum acquire lock) ────────────────────────────
  const { amount, paymentMethod, date, notes, sourceAccountId: bodySourceAccountId } = req.body ?? {};
  const amountN = Number(amount ?? 0);
  if (amountN <= 0) return res.status(400).json({ message: "Nominal cicilan harus lebih dari 0." });
  if (!date) return res.status(400).json({ message: "Tanggal wajib diisi." });

  // ── IDOR guard (pre-check cepat sebelum lock) ─────────────────────────────
  const [advPre] = await db.select().from(cashAdvancesTable).where(eq(cashAdvancesTable.id, id));
  if (!advPre) return res.status(404).json({ message: "Not found" });
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(advPre.companyId ?? null, _cid, req, res, { resourceType: "cash_advance", resourceId: id })) return; }

  // ── Pre-fetch settings & journal (pure reads, tidak perlu lock) ───────────
  const companyId = advPre.companyId ?? resolveCompanyId(req);
  const settings  = await ensureAccountingSettings(companyId);

  if (!advPre.receivableAccountId)
    return res.status(400).json({ message: "Akun piutang tidak ditemukan di record ini." });

  const pm = paymentMethod ?? advPre.paymentMethod;
  let cashBankId: number | null | undefined;
  if (bodySourceAccountId) {
    cashBankId = Number(bodySourceAccountId);
  } else {
    cashBankId = pm === "cash"
      ? (settings.defaultCashAccountId ?? settings.defaultBankAccountId)
      : (settings.defaultBankAccountId ?? settings.defaultCashAccountId);
  }
  if (!cashBankId) return res.status(400).json({ message: "Akun Kas/Bank belum dipilih atau belum dikonfigurasi." });

  const journalType = pm === "cash" ? "cash" : "bank";
  const [journal] = await db.select().from(accountingJournalsTable)
    .where(eq(accountingJournalsTable.type, journalType as any)).limit(1);
  const fallback = !journal ? (await db.select().from(accountingJournalsTable).limit(1))[0] : null;
  const j = journal ?? fallback;
  if (!j) return res.status(400).json({ message: "Jurnal kas/bank tidak ditemukan." });

  // ── Bagian kritis: FOR UPDATE mencegah concurrent double-repayment ─────────
  // db.transaction() menjaga satu koneksi — SELECT FOR UPDATE membuat request
  // concurrent antri di sini sampai transaksi pertama commit.
  let rep: (typeof cashAdvanceRepaymentsTable.$inferSelect) | undefined;
  let updated: (typeof cashAdvancesTable.$inferSelect) | undefined;

  try {
    await db.transaction(async (tx) => {
      // Lock baris advance — hanya satu thread yang bisa melanjutkan
      const lockedRows = await tx.execute(
        sql`SELECT * FROM cash_advances WHERE id = ${id} FOR UPDATE`
      );
      const adv = lockedRows.rows[0] as any;
      if (!adv) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });

      // Re-validasi di dalam lock: state bisa berubah sebelum kita dapat lock
      if (adv.status === "repaid")
        throw new Error("Kasbon/Talangan ini sudah lunas.");
      if (adv.status === "pending_approval")
        throw new Error("Kasbon masih menunggu approval, belum bisa dicicil.");
      if (adv.status === "rejected")
        throw new Error("Kasbon ini ditolak.");

      const remaining = Number(adv.remaining_amount);
      if (amountN > remaining + 0.01)
        throw new Error(`Cicilan (${amountN}) melebihi sisa piutang (${remaining}).`);

      const typeLabel = adv.type === "kasbon" ? "Kasbon" : "Talangan";
      const repNum = `${adv.advance_number}-R${String(Math.floor(Number(adv.paid_amount) / amountN) + 1).padStart(2, "0")}`;

      // postEntry menggunakan global db (koneksi terpisah dari tx) — berjalan
      // sementara lock dipegang, sehingga thread concurrent tidak bisa masuk.
      const entry = await postEntry({
        journalId: j.id,
        date: new Date(String(date)),
        ref: repNum,
        description: `${repNum} — Pelunasan ${typeLabel} ${adv.party_name}`,
        source: "manual",
        companyId,
        lines: [
          { accountId: cashBankId!, debit: amountN, credit: 0, description: pm === "cash" ? "Kas" : "Bank" },
          { accountId: adv.receivable_account_id, debit: 0, credit: amountN, description: `${typeLabel} — ${adv.party_name}` },
        ],
      }, j.code);

      const newPaid      = Number(adv.paid_amount) + amountN;
      const newRemaining = Math.max(0, remaining - amountN);
      const newStatus    = newRemaining <= 0.005 ? "repaid" : "partial";

      const repRows = await tx.insert(cashAdvanceRepaymentsTable).values({
        advanceId:       id,
        amount:          String(amountN),
        paymentMethod:   pm,
        sourceAccountId: cashBankId ?? null,
        date:            String(date),
        notes:           notes ? String(notes) : null,
        entryId:         entry.id,
      }).returning();
      rep = repRows[0];

      await tx.update(cashAdvancesTable).set({
        paidAmount:      String(newPaid),
        remainingAmount: String(newRemaining),
        status:          newStatus,
        updatedAt:       new Date(),
      }).where(eq(cashAdvancesTable.id, id));

      const updatedRows = await tx.select().from(cashAdvancesTable).where(eq(cashAdvancesTable.id, id));
      updated = updatedRows[0];
    });
  } catch (e: any) {
    if (e?.code === "NOT_FOUND") return res.status(404).json({ message: "Not found" });
    return res.status(400).json({ message: e?.message ?? "Gagal mencatat cicilan." });
  }

  // Audit fire-and-forget (repayment bukan approve/void/delete)
  auditFromReq(req, {
    action: "payment_processed",
    module: "kasbon",
    referenceId: String(id),
    newData: { repaymentAmount: amountN, newStatus: updated?.status, newRemaining: Number(updated?.remainingAmount) },
  });

  return res.status(201).json({ repayment: serializeRep(rep!), advance: serializeAdv(updated!) });
});

// ─── Upload bukti per-repayment ────────────────────────────────────────────────
router.post("/:id/repayments/:repId/upload-receipt", upload.single("receipt"), async (req: Request, res) => {
  const id = Number(String(req.params.id));
  const repId = Number(String(req.params.repId));
  if (isNaN(id) || isNaN(repId)) return res.status(400).json({ message: "Invalid id" });
  if (!req.file) return res.status(400).json({ message: "File bukti wajib diupload." });

  const [adv] = await db.select().from(cashAdvancesTable).where(eq(cashAdvancesTable.id, id));
  if (!adv) return res.status(404).json({ message: "Talangan tidak ditemukan." });
  { const cid = resolveCompanyId(req); if (!await assertCompanyAccess(adv.companyId ?? null, cid, req, res, { resourceType: "cash_advance", resourceId: id })) return; }

  const file = req.file;
  const ext = (file.originalname.split(".").pop() ?? "jpg").toLowerCase();
  const allowedExt = ["jpg", "jpeg", "png", "pdf", "webp"];
  if (!allowedExt.includes(ext))
    return res.status(400).json({ message: "Format tidak didukung. Gunakan JPG, PNG, atau PDF." });

  let receiptUrl: string | null = null;
  try {
    receiptUrl = await _objStoreSvc.uploadPrivateEntity(file.buffer, file.mimetype);
  } catch {
    return res.status(500).json({ message: "Gagal menyimpan file. Coba lagi." });
  }

  const updateResult = await db.execute(sql`
    UPDATE cash_advance_repayments SET receipt_url = ${receiptUrl} WHERE id = ${repId} AND advance_id = ${id}
  `);
  if ((updateResult.rowCount ?? 0) === 0)
    return res.status(404).json({ message: "Cicilan tidak ditemukan untuk talangan ini." });

  auditFromReq(req, {
    action: "repayment_receipt_uploaded",
    module: "kasbon",
    referenceId: String(id),
    newData: { repId, receiptUrl },
  });

  return res.json({ receiptUrl, message: "Bukti pengembalian berhasil diupload." });
});

// ─── Pertanggungjawaban (settle-to-expense) ────────────────────────────────────
// Berbeda dari /repay: TIDAK ADA uang kas yang kembali ke perusahaan. Dipakai
// ketika kasbon habis dibelanjakan (mis. beli ATK) dan sudah dibuktikan dengan
// receipt + barang. Jurnal: DEBIT Beban (sesuai kategori/akun) — KREDIT Piutang
// Karyawan. Mengurangi remaining_amount seperti repayment, tapi TIDAK menyentuh
// akun Kas/Bank sama sekali.
router.post("/:id/settle", async (req: Request, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const [adv] = await db.select().from(cashAdvancesTable).where(eq(cashAdvancesTable.id, id));
  if (!adv) return res.status(404).json({ message: "Not found" });
  // IDOR guard
  { const _cid = resolveCompanyId(req); if (!await assertCompanyAccess(adv.companyId ?? null, _cid, req, res, { resourceType: "cash_advance", resourceId: id })) return; }
  if (adv.status === "repaid" || adv.status === "accounted")
    return res.status(400).json({ message: "Kasbon/Talangan ini sudah selesai (lunas/dipertanggungjawabkan)." });
  if (adv.status === "pending_approval") return res.status(400).json({ message: "Kasbon masih menunggu approval, belum bisa dipertanggungjawabkan." });
  if (adv.status === "rejected") return res.status(400).json({ message: "Kasbon ini ditolak." });
  if (adv.status === "void") return res.status(400).json({ message: "Kasbon ini sudah di-void." });

  const { amount, expenseAccountId, date, notes, category } = req.body ?? {};
  const amountN = Number(amount ?? 0);
  if (amountN <= 0) return res.status(400).json({ message: "Nominal pertanggungjawaban harus lebih dari 0." });
  if (!date) return res.status(400).json({ message: "Tanggal wajib diisi." });
  if (!expenseAccountId) return res.status(400).json({ message: "Akun Beban wajib dipilih." });

  if (!adv.receiptUrl)
    return res.status(400).json({ message: "Upload receipt/bukti terlebih dahulu sebelum mempertanggungjawabkan kasbon ini." });

  const remaining = Number(adv.remainingAmount);
  if (amountN > remaining + 0.01)
    return res.status(400).json({ message: `Nominal (${amountN}) melebihi sisa piutang (${remaining}).` });

  const [expenseAccount] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, Number(expenseAccountId)));
  if (!expenseAccount) return res.status(400).json({ message: "Akun Beban tidak ditemukan di COA." });

  const companyId = adv.companyId ?? resolveCompanyId(req);
  const receivableAccountId = adv.receivableAccountId;
  if (!receivableAccountId)
    return res.status(400).json({ message: "Akun piutang tidak ditemukan di record ini." });

  // Cari jurnal umum (general) — tidak ada pergerakan kas/bank di transaksi ini.
  let journal = companyId
    ? (await db.select().from(accountingJournalsTable)
        .where(and(eq(accountingJournalsTable.companyId, companyId), eq(accountingJournalsTable.type, "general" as any)))
        .limit(1))[0]
    : undefined;
  if (!journal)
    journal = (await db.select().from(accountingJournalsTable).where(eq(accountingJournalsTable.type, "general" as any)).limit(1))[0];
  if (!journal) journal = (await db.select().from(accountingJournalsTable).limit(1))[0];
  if (!journal) return res.status(400).json({ message: "Jurnal umum (general) tidak ditemukan." });

  const typeLabel = adv.type === "kasbon" ? "Kasbon" : "Talangan";
  const settleResult = await db.execute(sql`SELECT COUNT(*) AS cnt FROM cash_advance_settlements WHERE advance_id = ${id}`);
  const settleNum = `${adv.advanceNumber}-PJ${String(Number((settleResult.rows[0] as any).cnt) + 1).padStart(2, "0")}`;

  const entry = await postEntry({
    journalId: journal.id,
    date: new Date(String(date)),
    ref: settleNum,
    description: `${settleNum} — Pertanggungjawaban ${typeLabel} ${adv.partyName}${category ? ` (${category})` : ""}`,
    // PA-06: standarkan source label untuk advance journals
    source: "kasbon",
    sourceModule: "advance_settlement",
    companyId,
    lines: [
      { accountId: Number(expenseAccountId), debit: amountN, credit: 0, description: `Beban — ${adv.partyName}` },
      { accountId: receivableAccountId, debit: 0, credit: amountN, description: `${typeLabel} — ${adv.partyName}` },
    ],
  }, journal.code);

  const settleInsert = await db.execute(sql`
    INSERT INTO cash_advance_settlements (advance_id, amount, expense_account_id, category, date, notes, receipt_url, entry_id)
    VALUES (${id}, ${amountN}, ${Number(expenseAccountId)}, ${category ? String(category) : null}, ${String(date)}, ${notes ? String(notes) : null}, ${adv.receiptUrl}, ${entry.id})
    RETURNING *
  `);
  const settlement = settleInsert.rows[0] as any;

  const newSettled = Number(adv.settledAmount ?? 0) + amountN;
  // PA-02 FIX: paid_amount = cash repayments ONLY. Settle-to-expense does NOT
  // move cash, so paid_amount must NOT be incremented here. Only settled_amount
  // is incremented. Formula: remaining = amount - paid_amount - settled_amount.
  // PA-03: Guard — remaining must never go negative. Check raw value before Math.max
  // so guard is reachable (primary check at line ~978 already blocks amountN > remaining+0.01,
  // this is a defence-in-depth double-check that must be BEFORE Math.max).
  const rawRemaining = remaining - amountN;
  if (rawRemaining < -0.01) {
    return res.status(400).json({ message: `Sisa piutang tidak boleh negatif (${rawRemaining.toFixed(2)}). Periksa nominal settlement.` });
  }
  const newRemaining = Math.max(0, rawRemaining);
  const newStatus = newRemaining <= 0.005 ? "accounted" : "partial";
  const newLifecycle = newRemaining <= 0.005 ? "settled" : "partially_settled";

  await db.execute(sql`
    UPDATE cash_advances
    SET settled_amount    = ${newSettled},
        remaining_amount  = ${newRemaining},
        lifecycle_status  = ${newLifecycle},
        status            = ${newStatus},
        -- PA-01 FIX: link the settlement journal back to the advance record so
        -- audit trail is never broken. COALESCE preserves an existing entry_id
        -- (disbursement journal) and only fills NULL (no prior disbursement).
        entry_id          = COALESCE(entry_id, ${entry.id}),
        updated_at        = NOW()
    WHERE id = ${id}
  `);

  auditFromReq(req, {
    action: "settled_to_expense",
    module: "kasbon",
    referenceId: String(id),
    newData: { settlementAmount: amountN, expenseAccountId: Number(expenseAccountId), category, newStatus, newRemaining, entryId: entry.id },
  });

  const [updatedAdv] = await db.select().from(cashAdvancesTable).where(eq(cashAdvancesTable.id, id));
  return res.status(201).json({
    settlement: { ...settlement, id: Number(settlement.id), amount: Number(settlement.amount), createdAt: settlement.created_at },
    advance: serializeAdv(updatedAdv!),
  });
});

// ─── Delete ────────────────────────────────────────────────────────────────────
// ACCOUNTING POSTING INTEGRITY: hard delete HANYA diizinkan jika kasbon belum
// pernah posting jurnal (entryId == null) — mis. masih pending_approval atau
// sudah rejected. Begitu entryId terisi (jurnal sudah POSTED / uang sudah
// keluar), delete WAJIB ditolak — gunakan endpoint /:id/void atau /:id/repay.
// Ini menutup bug: kasbon terhapus dari UI tapi jurnal GL tetap ada (orphan).
router.delete("/:id", async (req, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const [adv] = await db.select().from(cashAdvancesTable).where(eq(cashAdvancesTable.id, id));
  if (!adv) return res.status(404).json({ message: "Not found" });
  // IDOR guard
  { const cid = resolveCompanyId(req); if (!await assertCompanyAccess(adv.companyId ?? null, cid, req, res, { resourceType: "cash_advance", resourceId: id })) return; }

  const guard = assertCanDeleteTransaction({
    entryId: adv.entryId ?? null,
    moneyMoved: Number(adv.paidAmount) > 0 || !!adv.entryId,
  });
  if (!guard.allowed) {
    logPostingGuardAction(req, {
      action: "delete_blocked",
      module: "kasbon",
      referenceId: String(id),
      oldData: { advanceNumber: adv.advanceNumber, status: adv.status, entryId: adv.entryId },
    });
    return res.status(400).json({
      message: "Kasbon sudah masuk General Ledger. Gunakan Void/Repayment, bukan Delete.",
      code: guard.code,
      reason: guard.reason,
    });
  }
  if (!["pending_approval", "rejected"].includes(adv.status))
    return res.status(400).json({ message: "Hanya kasbon yang belum diposting (pending_approval/rejected) yang bisa dihapus." });

  await db.execute(sql`DELETE FROM expense_approval_requests WHERE ref_type IN ('kasbon','talangan') AND ref_id = ${id}`);
  await db.delete(cashAdvancesTable).where(eq(cashAdvancesTable.id, id));

  // Audit SYNCHRONOUS — delete adalah irreversible action; gagal audit → return 500
  // (record sudah terhapus, tapi client dapat sinyal kesalahan untuk diteruskan ke admin)
  try {
    await auditFromReqSync(req, {
      action: "kasbon_deleted",
      module: "kasbon",
      referenceId: String(id),
      oldData: { advanceNumber: adv.advanceNumber, status: adv.status },
    });
  } catch (auditErr) {
    logger.error({ err: auditErr }, "[kasbon] Audit log gagal saat delete");
    return res.status(500).json({ message: "Kasbon dihapus, namun audit log gagal disimpan. Hubungi administrator." });
  }
  return res.json({ message: "Deleted" });
});

// ─── Void (jurnal sudah posted, uang BELUM benar-benar keluar/dipertanggungjawabkan) ──
// Berbeda dari Delete: Void TIDAK menghapus record atau jurnal — ia membuat
// jurnal pembalik (reversal) 100% dan menandai kasbon sebagai 'void'.
// Void DITOLAK jika sudah ada cicilan/repayment (paidAmount > 0) — pada titik
// itu satu-satunya jalan adalah melunasi via /:id/repay (settlement), bukan
// membatalkan transaksi disbursement asal.
router.post("/:id/void", async (req: Request, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { reason } = req.body ?? {};
  const [adv] = await db.select().from(cashAdvancesTable).where(eq(cashAdvancesTable.id, id));
  if (!adv) return res.status(404).json({ message: "Not found" });
  const cid = resolveCompanyId(req);
  if (!await assertCompanyAccess(adv.companyId ?? null, cid, req, res, { resourceType: "cash_advance", resourceId: id })) return;

  if (adv.status === "void") return res.status(400).json({ message: "Kasbon ini sudah di-void sebelumnya." });

  const guard = assertCanVoidTransaction({
    entryId: adv.entryId ?? null,
    entryStatus: adv.status === "void" ? "voided" : "posted",
    moneyMoved: Number(adv.paidAmount) > 0,
  });
  if (!guard.allowed) {
    return res.status(400).json({
      message: guard.reason ?? "Kasbon tidak bisa di-void. Gunakan Repayment untuk melunasi.",
      code: guard.code,
    });
  }

  const actor = (req as any).userId ?? adv.createdById ?? null;
  const voidReason = reason ? String(reason) : "Dibatalkan sebelum dipertanggungjawabkan";

  const result = await createReversalJournal({
    originalEntryId: Number(adv.entryId),
    companyId: adv.companyId ?? null,
    actor,
    reason: voidReason,
    tag: adv.type === "kasbon" ? "[VOID KASBON]" : "[VOID TALANGAN]",
  });
  if (!result.ok) return res.status(400).json({ message: `Gagal membuat jurnal pembalik: ${result.error}` });

  await db.execute(sql`
    UPDATE cash_advances
    SET status = 'void', voided_at = NOW(), voided_by = ${actor}, void_reason = ${voidReason},
        reversal_journal_id = ${result.entryId}, updated_at = NOW()
    WHERE id = ${id}
  `);

  // Audit SYNCHRONOUS — void adalah critical action; gagal audit → return 500
  try {
    await auditFromReqSync(req, {
      action: "void",
      module: "kasbon",
      referenceId: String(id),
      oldData: { status: adv.status, entryId: adv.entryId },
      newData: { status: "void", reversalJournalId: result.entryId, reason: voidReason },
    });
  } catch (auditErr) {
    logger.error({ err: auditErr }, "[kasbon] Audit log gagal saat void");
    return res.status(500).json({ message: "Void berhasil, namun audit log gagal disimpan. Hubungi administrator." });
  }

  const updated = await db.execute(sql`SELECT * FROM cash_advances WHERE id = ${id}`);
  return res.json({
    ...serializeAdv(updated.rows[0] as any),
    message: "Kasbon di-void — jurnal pembalik telah diposting.",
  });
});

export default router;
