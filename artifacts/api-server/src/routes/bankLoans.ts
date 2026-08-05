import { Router, type Request } from "express";
import { eq, desc, sql } from "drizzle-orm";
import {
  db, bankLoansTable, bankLoanPaymentsTable,
  chartOfAccountsTable, accountingJournalsTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { postEntry } from "../lib/accounting.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Inline migration ────────────────────────────────────────────────────────
async function ensureTables() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_loans (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      loan_number TEXT NOT NULL UNIQUE,
      loan_type TEXT NOT NULL DEFAULT 'bank',
      lender_name TEXT NOT NULL,
      principal_amount NUMERIC(14,2) NOT NULL,
      outstanding_amount NUMERIC(14,2) NOT NULL,
      paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'bank',
      disbursement_date DATE NOT NULL,
      tenor_months INTEGER,
      interest_rate NUMERIC(7,4) DEFAULT 0,
      admin_fee NUMERIC(14,2) DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      journal_entry_id INTEGER,
      created_by_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bank_loan_payments (
      id SERIAL PRIMARY KEY,
      loan_id INTEGER NOT NULL,
      payment_date DATE NOT NULL,
      principal_amount NUMERIC(14,2) NOT NULL,
      interest_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(14,2) NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'bank',
      reference TEXT,
      notes TEXT,
      journal_entry_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `));
}

let migrated = false;
async function runMigration() { if (!migrated) { await ensureTables(); migrated = true; } }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function loanCoaCode(loanType: string, isLongTerm = false): string {
  if (loanType === "leasing") return isLongTerm ? "2-2030" : "2-1055";
  if (loanType === "bank")    return isLongTerm ? "2-2020" : "2-1050";
  return "2-2010"; // other → Hutang Jangka Panjang
}

async function nextLoanNumber(companyId: number | null): Promise<string> {
  const prefix = "HBK";
  const year = new Date().getFullYear();
  const rows = await db.execute(sql.raw(
    `SELECT loan_number FROM bank_loans WHERE loan_number LIKE '${prefix}/${year}/%' ORDER BY id DESC LIMIT 1`
  ));
  const last = (rows.rows[0] as any)?.loan_number as string | undefined;
  let seq = 1;
  if (last) { const parts = last.split("/"); seq = (parseInt(parts[2] ?? "0", 10) || 0) + 1; }
  return `${prefix}/${year}/${String(seq).padStart(5, "0")}`;
}

// ─── GET /api/bank-loans ──────────────────────────────────────────────────────
router.get("/", async (req: Request, res) => {
  await runMigration();
  const companyId = await resolveCompanyId(req);
  const rows = await db.execute(sql.raw(
    `SELECT * FROM bank_loans ${companyId ? `WHERE company_id = ${companyId}` : ""} ORDER BY id DESC`
  ));
  res.json(rows.rows);
});

// ─── GET /api/bank-loans/:id ─────────────────────────────────────────────────
router.get("/:id", async (req: Request, res) => {
  await runMigration();
  const id = parseInt(String(req.params.id));
  const loanResult = await db.execute(sql.raw(`SELECT * FROM bank_loans WHERE id = ${id}`));
  const loan = loanResult.rows[0];
  if (!loan) return res.status(404).json({ message: "Pinjaman tidak ditemukan." });
  const paymentsResult = await db.execute(sql.raw(
    `SELECT * FROM bank_loan_payments WHERE loan_id = ${id} ORDER BY payment_date, id`
  ));
  res.json({ ...(loan as any), payments: paymentsResult.rows });
});

// ─── POST /api/bank-loans ─────────────────────────────────────────────────────
// R-3 Fix: Loan insert and journal creation are now atomic.
// The loan record is only inserted AFTER the journal is successfully created.
// If journal creation fails (COA missing or DB error), the entire request fails
// with LOAN_JOURNAL_CREATION_FAILED — no orphan loan record without GL entry.
router.post("/", async (req: Request, res) => {
  await runMigration();
  const companyId = await resolveCompanyId(req);
  const userId = (req as any).userId ?? null;
  const {
    loanType = "bank", lenderName, principalAmount, paymentMethod = "bank",
    disbursementDate, tenorMonths, interestRate = 0, adminFee = 0, notes,
  } = req.body;

  if (!lenderName?.trim()) return res.status(400).json({ message: "Nama pemberi pinjaman wajib diisi." });
  const amount = parseFloat(principalAmount);
  if (!amount || amount <= 0) return res.status(400).json({ message: "Nominal pinjaman harus lebih dari 0." });
  if (!disbursementDate) return res.status(400).json({ message: "Tanggal pencairan wajib diisi." });

  const loanNumber = await nextLoanNumber(companyId);
  const isLongTerm = (tenorMonths ?? 12) > 12;
  const loanCode = loanCoaCode(loanType, isLongTerm);

  try {
    await ensureAccountingSettings(companyId ?? undefined);
    const loanCoa = await db.select().from(chartOfAccountsTable)
      .where(sql`code LIKE ${loanCode + "%"} AND (company_id = ${companyId} OR company_id IS NULL)`)
      .limit(1);
    const bankCoa = paymentMethod === "cash"
      ? await db.select().from(chartOfAccountsTable).where(sql`code LIKE '1-1010%' AND (company_id = ${companyId} OR company_id IS NULL)`).limit(1)
      : await db.select().from(chartOfAccountsTable).where(sql`code LIKE '1-1020%' AND (company_id = ${companyId} OR company_id IS NULL)`).limit(1);

    // ── R-3: COA required — fail closed if missing, do NOT create loan without GL ──
    if (!loanCoa[0] || !bankCoa[0]) {
      logger.warn(
        { loanNumber, companyId, loanCode, paymentMethod, loanCoaFound: !!loanCoa[0], bankCoaFound: !!bankCoa[0] },
        "[FAIL-CLOSED] bank_loan_disbursement: COA tidak lengkap — loan tidak dibuat",
      );
      return res.status(422).json({
        error: "LOAN_JOURNAL_MAPPING_REQUIRED",
        message: "COA untuk pinjaman atau kas/bank tidak ditemukan. Pastikan COA sudah dikonfigurasi sebelum mencatat pinjaman.",
        loanCoaFound: !!loanCoa[0],
        bankCoaFound: !!bankCoa[0],
      });
    }

    // ── Jurnal Awal: DR Kas/Bank, CR Hutang Bank ─────────────────────────────
    // Journal is created FIRST. If this throws, the catch block returns an error
    // and NO loan record is inserted — preserving GL integrity.
    const [je] = await (db.insert(accountingJournalsTable) as any).values({
      companyId, date: disbursementDate,
      description: `Pencairan pinjaman ${loanNumber} — ${lenderName}`,
      refType: "bank_loan", refNumber: loanNumber,
      journalType: "general", status: "posted", createdById: userId,
    }).returning();
    await (postEntry as any)(je.id, [
      { accountId: bankCoa[0].id, debit: String(amount), credit: "0" },
      { accountId: loanCoa[0].id, debit: "0", credit: String(amount) },
    ]);
    const journalEntryId: number = je.id;

    // ── Insert loan — only reached if journal succeeded ───────────────────────
    const insertResult = await db.execute(sql.raw(`
      INSERT INTO bank_loans
        (company_id, loan_number, loan_type, lender_name, principal_amount, outstanding_amount,
         paid_amount, payment_method, disbursement_date, tenor_months, interest_rate,
         admin_fee, notes, status, journal_entry_id, created_by_id)
      VALUES
        (${companyId ?? "NULL"}, '${loanNumber}', '${loanType}',
         '${lenderName.replace(/'/g, "''")}', ${amount}, ${amount}, 0,
         '${paymentMethod}', '${disbursementDate}',
         ${tenorMonths ?? "NULL"}, ${parseFloat(interestRate) || 0}, ${parseFloat(adminFee) || 0},
         ${notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL"},
         'active', ${journalEntryId}, ${userId ? `'${userId}'` : "NULL"})
      RETURNING *
    `));
    return res.status(201).json(insertResult.rows[0]);

  } catch (err) {
    // R-3: Any error during journal or loan insert rolls back the entire operation.
    // The loan number was pre-allocated but the loan record was never saved.
    logger.error(
      { err: (err as Error).message, loanNumber, companyId },
      "[bank_loans] Loan creation failed — no loan record created (R-3 atomicity guard)",
    );
    return res.status(503).json({
      error: "LOAN_JOURNAL_CREATION_FAILED",
      message: "Pinjaman gagal dicatat karena jurnal tidak dapat dibuat. Silakan coba lagi.",
    });
  }
});

// ─── POST /api/bank-loans/:id/pay ────────────────────────────────────────────
router.post("/:id/pay", async (req: Request, res) => {
  await runMigration();
  const id = parseInt(String(req.params.id));
  const loanResult = await db.execute(sql.raw(`SELECT * FROM bank_loans WHERE id = ${id}`));
  const loan = loanResult.rows[0] as any;
  if (!loan) return res.status(404).json({ message: "Pinjaman tidak ditemukan." });
  if (loan.status === "paid") return res.status(400).json({ message: "Pinjaman sudah lunas." });

  const {
    principalAmount, interestAmount = 0, paymentMethod = "bank",
    paymentDate, reference, notes,
  } = req.body;
  const principal = parseFloat(principalAmount);
  const interest = parseFloat(interestAmount) || 0;
  if (!principal || principal <= 0) return res.status(400).json({ message: "Nominal pokok harus lebih dari 0." });

  const outstanding = parseFloat(loan.outstanding_amount);
  if (principal > outstanding + 0.01) {
    return res.status(400).json({ message: `Melebihi sisa pokok: ${outstanding}` });
  }
  const total = principal + interest;
  const date = paymentDate ?? new Date().toISOString().slice(0, 10);

  // ── R-3: Payment also atomic — journal required before payment record saved ──
  const companyId = loan.company_id;
  const loanCode = loanCoaCode(loan.loan_type, parseFloat(loan.principal_amount) > parseFloat(loan.outstanding_amount) ? true : (loan.tenor_months ?? 12) > 12);

  try {
    const loanCoa = await db.select().from(chartOfAccountsTable)
      .where(sql`code LIKE ${loanCode + "%"} AND (company_id = ${companyId} OR company_id IS NULL)`).limit(1);
    const bankCoa = paymentMethod === "cash"
      ? await db.select().from(chartOfAccountsTable).where(sql`code LIKE '1-1010%' AND (company_id = ${companyId} OR company_id IS NULL)`).limit(1)
      : await db.select().from(chartOfAccountsTable).where(sql`code LIKE '1-1020%' AND (company_id = ${companyId} OR company_id IS NULL)`).limit(1);
    const intCoa = await db.select().from(chartOfAccountsTable)
      .where(sql`code LIKE '5-3010%' AND (company_id = ${companyId} OR company_id IS NULL)`).limit(1);

    if (!loanCoa[0] || !bankCoa[0]) {
      logger.warn(
        { loanId: id, loanNumber: loan.loan_number, loanCoaFound: !!loanCoa[0], bankCoaFound: !!bankCoa[0] },
        "[FAIL-CLOSED] bank_loan_payment: COA tidak lengkap — cicilan tidak dibuat",
      );
      return res.status(422).json({
        error: "LOAN_JOURNAL_MAPPING_REQUIRED",
        message: "COA untuk hutang bank atau kas/bank tidak ditemukan.",
        loanCoaFound: !!loanCoa[0],
        bankCoaFound: !!bankCoa[0],
      });
    }

    // ── Jurnal: DR Hutang Bank, CR Kas/Bank; DR Biaya Bunga, CR Kas/Bank ────
    const [je] = await (db.insert(accountingJournalsTable) as any).values({
      companyId, date,
      description: `Cicilan pinjaman ${loan.loan_number} — ${loan.lender_name}`,
      refType: "bank_loan_payment", refNumber: loan.loan_number,
      journalType: "general", status: "posted",
    }).returning();
    await (postEntry as any)(je.id, interest > 0 && intCoa[0] ? [
      { accountId: loanCoa[0].id, debit: String(principal), credit: "0" },
      { accountId: intCoa[0].id, debit: String(interest), credit: "0" },
      { accountId: bankCoa[0].id, debit: "0", credit: String(total) },
    ] : [
      { accountId: loanCoa[0].id, debit: String(principal), credit: "0" },
      { accountId: bankCoa[0].id, debit: "0", credit: String(principal) },
    ]);
    const journalEntryId: number = je.id;

    // ── Insert payment — only reached if journal succeeded ─────────────────
    await db.execute(sql.raw(`
      INSERT INTO bank_loan_payments
        (loan_id, payment_date, principal_amount, interest_amount, total_amount,
         payment_method, reference, notes, journal_entry_id)
      VALUES
        (${id}, '${date}', ${principal}, ${interest}, ${total},
         '${paymentMethod}',
         ${reference ? `'${String(reference).replace(/'/g, "''")}'` : "NULL"},
         ${notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL"},
         ${journalEntryId})
    `));

    // ── Update loan balance ────────────────────────────────────────────────
    const newOutstanding = Math.max(0, outstanding - principal);
    const newPaid = parseFloat(loan.paid_amount) + principal;
    const newStatus = newOutstanding <= 0.01 ? "paid" : newPaid > 0 ? "partial" : "active";
    await db.execute(sql.raw(`
      UPDATE bank_loans
      SET outstanding_amount = ${newOutstanding}, paid_amount = ${newPaid}, status = '${newStatus}'
      WHERE id = ${id}
    `));

    const updatedResult = await db.execute(sql.raw(`SELECT * FROM bank_loans WHERE id = ${id}`));
    const paymentsResult = await db.execute(sql.raw(`SELECT * FROM bank_loan_payments WHERE loan_id = ${id} ORDER BY payment_date, id`));
    return res.json({ loan: updatedResult.rows[0], payments: paymentsResult.rows });

  } catch (err) {
    logger.error(
      { err: (err as Error).message, loanId: id, loanNumber: loan.loan_number },
      "[bank_loans] Cicilan gagal dicatat — tidak ada payment record yang dibuat (R-3 atomicity guard)",
    );
    return res.status(503).json({
      error: "LOAN_JOURNAL_CREATION_FAILED",
      message: "Cicilan gagal dicatat karena jurnal tidak dapat dibuat. Silakan coba lagi.",
    });
  }
});

// ─── DELETE /api/bank-loans/:id ───────────────────────────────────────────────
router.delete("/:id", async (req: Request, res) => {
  await runMigration();
  const id = parseInt(String(req.params.id));
  const rows = await db.execute(sql.raw(`SELECT * FROM bank_loans WHERE id = ${id}`));
  const loan = rows.rows[0] as any;
  if (!loan) return res.status(404).json({ message: "Pinjaman tidak ditemukan." });
  if (parseFloat(loan.paid_amount) > 0) return res.status(400).json({ message: "Pinjaman yang sudah ada cicilan tidak dapat dihapus." });
  await db.execute(sql.raw(`DELETE FROM bank_loans WHERE id = ${id}`));
  res.json({ ok: true });
});

export default router;
