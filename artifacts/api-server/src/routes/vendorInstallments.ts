import { Router, type Request } from "express";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import {
  db, vendorInstallmentsTable, vendorInstallmentPaymentsTable,
  chartOfAccountsTable, accountingJournalsTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { postEntry } from "../lib/accounting.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Inline migration ────────────────────────────────────────────────────────
async function ensureTables() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS vendor_installments (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      installment_number TEXT NOT NULL UNIQUE,
      vendor_name TEXT NOT NULL,
      total_amount NUMERIC(14,2) NOT NULL,
      paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      remaining_amount NUMERIC(14,2) NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'bank',
      date DATE NOT NULL,
      reference TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      ap_account_id INTEGER,
      cash_bank_account_id INTEGER,
      entry_id INTEGER,
      created_by_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS vendor_installment_payments (
      id SERIAL PRIMARY KEY,
      installment_id INTEGER NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'bank',
      date DATE NOT NULL,
      reference TEXT,
      notes TEXT,
      entry_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS vendor_installments_company_idx ON vendor_installments(company_id);
    CREATE INDEX IF NOT EXISTS vendor_installments_status_idx ON vendor_installments(status);
    CREATE INDEX IF NOT EXISTS vendor_installment_payments_inst_idx ON vendor_installment_payments(installment_id);
  `));
}
ensureTables().catch(console.error);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeInst(r: typeof vendorInstallmentsTable.$inferSelect) {
  return {
    ...r,
    totalAmount: Number(r.totalAmount),
    paidAmount: Number(r.paidAmount),
    remainingAmount: Number(r.remainingAmount),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
function serializePay(r: typeof vendorInstallmentPaymentsTable.$inferSelect) {
  return { ...r, amount: Number(r.amount), createdAt: r.createdAt.toISOString() };
}

async function nextInstallmentNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`cast(count(*) as int)` })
    .from(vendorInstallmentsTable)
    .where(sql`installment_number LIKE ${"VCI/" + year + "/%"}`);
  return `VCI/${year}/${String(Number(cnt) + 1).padStart(5, "0")}`;
}

async function resolveApAccount(companyId: number | null) {
  const [row] = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(sql`code LIKE '2-1010%' ${companyId ? sql`AND (company_id = ${companyId} OR company_id IS NULL)` : sql``}`)
    .orderBy(sql`company_id DESC NULLS LAST`)
    .limit(1);
  return row?.id ?? null;
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get("/", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const { status, from, to } = req.query as Record<string, string>;
  const conds: ReturnType<typeof eq>[] = [eq(vendorInstallmentsTable.companyId, companyId)];
  if (status) conds.push(eq(vendorInstallmentsTable.status, status));
  if (from) conds.push(gte(vendorInstallmentsTable.date, from));
  if (to) conds.push(lte(vendorInstallmentsTable.date, to));
  const rows = await db
    .select().from(vendorInstallmentsTable)
    .where(and(...conds))
    .orderBy(desc(vendorInstallmentsTable.date), desc(vendorInstallmentsTable.id))
    .limit(500);
  return res.json(rows.map(serializeInst));
});

// ─── Detail ───────────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const [inst] = await db.select().from(vendorInstallmentsTable).where(eq(vendorInstallmentsTable.id, id));
  if (!inst) return res.status(404).json({ message: "Not found" });
  const payments = await db
    .select().from(vendorInstallmentPaymentsTable)
    .where(eq(vendorInstallmentPaymentsTable.installmentId, id))
    .orderBy(desc(vendorInstallmentPaymentsTable.date), desc(vendorInstallmentPaymentsTable.id));
  return res.json({ ...serializeInst(inst), payments: payments.map(serializePay) });
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res) => {
  const { vendorName, totalAmount, paymentMethod, date, reference, notes, apAccountId } = req.body ?? {};
  if (!vendorName?.trim()) return res.status(400).json({ message: "Nama vendor wajib diisi." });
  const totalN = Number(totalAmount ?? 0);
  if (totalN <= 0) return res.status(400).json({ message: "Total cicilan harus lebih dari 0." });
  if (!date) return res.status(400).json({ message: "Tanggal wajib diisi." });

  const companyId = resolveCompanyId(req);
  const settings = await ensureAccountingSettings(companyId);

  const resolvedApId = apAccountId ? Number(apAccountId) : await resolveApAccount(companyId);
  if (!resolvedApId)
    return res.status(400).json({ message: "Akun Hutang Usaha (2-1010) belum ada di COA." });

  const pm = paymentMethod ?? "bank";
  const cashBankId = pm === "cash"
    ? (settings.defaultCashAccountId ?? settings.defaultBankAccountId)
    : (settings.defaultBankAccountId ?? settings.defaultCashAccountId);
  if (!cashBankId)
    return res.status(400).json({ message: "Akun Kas/Bank default belum dikonfigurasi di Pengaturan Akuntansi." });

  const installmentNumber = await nextInstallmentNumber();
  const [inst] = await db.insert(vendorInstallmentsTable).values({
    companyId,
    installmentNumber,
    vendorName: String(vendorName).trim(),
    totalAmount: String(totalN),
    paidAmount: "0",
    remainingAmount: String(totalN),
    paymentMethod: pm,
    date: String(date),
    reference: reference ? String(reference) : null,
    notes: notes ? String(notes) : null,
    status: "active",
    apAccountId: resolvedApId,
    cashBankAccountId: cashBankId,
    createdById: (req as any).userId ?? null,
  }).returning();

  return res.status(201).json(serializeInst(inst!));
});

// ─── Pay (cicilan) ────────────────────────────────────────────────────────────

router.post("/:id/pay", async (req: Request, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const [inst] = await db.select().from(vendorInstallmentsTable).where(eq(vendorInstallmentsTable.id, id));
  if (!inst) return res.status(404).json({ message: "Not found" });
  if (inst.status === "paid") return res.status(400).json({ message: "Vendor cicilan ini sudah lunas." });

  const { amount, paymentMethod, date, reference, notes } = req.body ?? {};
  const amountN = Number(amount ?? 0);
  if (amountN <= 0) return res.status(400).json({ message: "Nominal cicilan harus lebih dari 0." });
  if (!date) return res.status(400).json({ message: "Tanggal wajib diisi." });

  const remaining = Number(inst.remainingAmount);
  if (amountN > remaining + 0.01)
    return res.status(400).json({ message: `Cicilan (${amountN}) melebihi sisa hutang (${remaining}).` });

  const companyId = inst.companyId ?? resolveCompanyId(req);
  const settings = await ensureAccountingSettings(companyId);

  const apAccountId = inst.apAccountId;
  if (!apAccountId) return res.status(400).json({ message: "Akun AP tidak ditemukan di record ini." });

  const pm = paymentMethod ?? inst.paymentMethod;
  const cashBankId = pm === "cash"
    ? (settings.defaultCashAccountId ?? settings.defaultBankAccountId)
    : (settings.defaultBankAccountId ?? settings.defaultCashAccountId);
  if (!cashBankId) return res.status(400).json({ message: "Akun Kas/Bank default belum dikonfigurasi." });

  const journalType = pm === "cash" ? "cash" : "bank";
  const [journal] = await db.select().from(accountingJournalsTable)
    .where(eq(accountingJournalsTable.type, journalType as any)).limit(1);
  const fallback = !journal
    ? (await db.select().from(accountingJournalsTable).limit(1))[0]
    : null;
  const j = journal ?? fallback;
  if (!j) return res.status(400).json({ message: "Jurnal kas/bank tidak ditemukan." });

  const payNum = `${inst.installmentNumber}-P${String(Math.floor(Number(inst.paidAmount) / amountN) + 1).padStart(2, "0")}`;
  const entry = await postEntry({
    journalId: j.id,
    date: new Date(String(date)),
    ref: payNum,
    description: `${payNum} — Cicilan Hutang ${inst.vendorName}${reference ? ` / ${reference}` : ""}`,
    source: "manual",
    companyId,
    lines: [
      { accountId: apAccountId, debit: amountN, credit: 0, description: `Hutang Vendor — ${inst.vendorName}` },
      { accountId: cashBankId, debit: 0, credit: amountN, description: pm === "cash" ? "Kas" : "Bank" },
    ],
  }, j.code);

  const [pay] = await db.insert(vendorInstallmentPaymentsTable).values({
    installmentId: id,
    amount: String(amountN),
    paymentMethod: pm,
    date: String(date),
    reference: reference ? String(reference) : null,
    notes: notes ? String(notes) : null,
    entryId: entry.id,
  }).returning();

  const newPaid = Number(inst.paidAmount) + amountN;
  const newRemaining = Math.max(0, remaining - amountN);
  const newStatus = newRemaining <= 0.005 ? "paid" : "partial";

  await db.update(vendorInstallmentsTable).set({
    paidAmount: String(newPaid),
    remainingAmount: String(newRemaining),
    status: newStatus,
    updatedAt: new Date(),
  }).where(eq(vendorInstallmentsTable.id, id));

  const [updated] = await db.select().from(vendorInstallmentsTable).where(eq(vendorInstallmentsTable.id, id));
  return res.status(201).json({ payment: serializePay(pay!), installment: serializeInst(updated!) });
});

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const [inst] = await db.select().from(vendorInstallmentsTable).where(eq(vendorInstallmentsTable.id, id));
  if (!inst) return res.status(404).json({ message: "Not found" });
  if (inst.status !== "active" || Number(inst.paidAmount) > 0)
    return res.status(400).json({ message: "Hanya cicilan yang belum ada pembayaran yang bisa dihapus." });
  await db.delete(vendorInstallmentsTable).where(eq(vendorInstallmentsTable.id, id));
  return res.json({ message: "Deleted" });
});

export default router;
