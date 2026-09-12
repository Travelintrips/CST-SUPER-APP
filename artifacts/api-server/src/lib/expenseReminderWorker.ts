/**
 * Fase 10: Expense Reminder Worker
 * Scans all financial obligations and sends WA reminders for overdue/upcoming items.
 * Also stores reminders in `expense_reminders` table for dashboard display.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const INTERVAL_MIN = 60 * 6; // every 6 hours
const INITIAL_DELAY_MIN = 5;

// ─── Ensure tables ────────────────────────────────────────────────────────────
async function ensureReminderTable() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS expense_reminders (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      ref_type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      ref_number TEXT,
      party_name TEXT,
      amount NUMERIC(14,2),
      due_days INTEGER,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      sent_wa BOOLEAN NOT NULL DEFAULT FALSE,
      dismissed BOOLEAN NOT NULL DEFAULT FALSE,
      reminder_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `));
  // add reminder_date column if table existed without it
  await db.execute(sql.raw(`
    ALTER TABLE expense_reminders ADD COLUMN IF NOT EXISTS reminder_date DATE NOT NULL DEFAULT CURRENT_DATE
  `));
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS expense_reminders_daily_uniq
      ON expense_reminders(ref_type, ref_id, reminder_date)
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS expense_reminders_company_idx ON expense_reminders(company_id)
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS expense_reminders_dismissed_idx ON expense_reminders(dismissed)
  `));
}
let tableMigrated = false;

async function ensureOnce() {
  if (!tableMigrated) { await ensureReminderTable(); tableMigrated = true; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysSince(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

function severity(days: number): "warning" | "danger" | "info" {
  if (days > 60) return "danger";
  if (days > 30) return "warning";
  return "info";
}

const idr = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

// ─── Insert reminder (idempotent — 1 per ref per day) ────────────────────────
async function upsertReminder(opts: {
  companyId: number | null;
  refType: string;
  refId: number;
  refNumber?: string;
  partyName?: string;
  amount?: number;
  dueDays?: number;
  severity: "info" | "warning" | "danger";
  message: string;
}) {
  const co = opts.companyId ?? "NULL";
  const refNum = opts.refNumber ? `'${opts.refNumber.replace(/'/g, "''")}'` : "NULL";
  const party  = opts.partyName ? `'${opts.partyName.replace(/'/g, "''")}'`  : "NULL";
  const amt    = opts.amount != null ? opts.amount : "NULL";
  const days   = opts.dueDays != null ? opts.dueDays : "NULL";
  const msg    = opts.message.replace(/'/g, "''");
  await db.execute(sql.raw(`
    INSERT INTO expense_reminders
      (company_id, ref_type, ref_id, ref_number, party_name, amount, due_days, severity, message, reminder_date)
    VALUES
      (${co}, '${opts.refType}', ${opts.refId}, ${refNum}, ${party}, ${amt}, ${days}, '${opts.severity}', '${msg}', CURRENT_DATE)
    ON CONFLICT (ref_type, ref_id, reminder_date)
    DO UPDATE SET message = EXCLUDED.message, severity = EXCLUDED.severity
  `)).catch(() => {});
}

// ─── Send WA (fire-and-forget) ────────────────────────────────────────────────
async function notifyWa(message: string, refType: string, refId: number) {
  try {
    const { getAdminGroupWa } = await import("./adminWa.js");
    const { sendViaService: sendWhatsApp } = await import("./waTransport.js");
    const group = await getAdminGroupWa();
    if (!group) return;
    await sendWhatsApp(group, message, { context: `expense_reminder_${refType}`, refId: String(refId) });
  } catch { /* non-fatal */ }
}

// ─── Kasbon / Talangan reminders ──────────────────────────────────────────────
async function checkCashAdvances() {
  const rows = await db.execute(sql.raw(`
    SELECT id, company_id, advance_number, type, party_name, remaining_amount, created_at, updated_at
    FROM cash_advances
    WHERE status IN ('active','partial')
  `));
  const typeLabel: Record<string, string> = { kasbon: "Kasbon", talangan: "Dana Talangan" };
  for (const r of rows.rows as any[]) {
    const days = daysSince(String(r.updated_at || r.created_at));
    if (days < 30) continue;
    const sev = severity(days);
    const amount = parseFloat(r.remaining_amount);
    const msg = `⏰ *Reminder ${typeLabel[r.type] ?? r.type}*\n\nNo: ${r.advance_number}\nKaryawan: ${r.party_name}\nSisa: ${idr(amount)}\nSudah ${days} hari belum dilunasi.\n\nBuka BizPortal → Expense → ${typeLabel[r.type] ?? "Kasbon"} untuk tindak lanjut.`;
    await upsertReminder({
      companyId: r.company_id, refType: r.type, refId: r.id,
      refNumber: r.advance_number, partyName: r.party_name,
      amount, dueDays: days, severity: sev, message: msg,
    });
    if (sev !== "info") await notifyWa(msg, r.type, r.id);
  }
}

// ─── Vendor installments reminders ───────────────────────────────────────────
async function checkVendorInstallments() {
  const rows = await db.execute(sql.raw(`
    SELECT id, company_id, installment_number, vendor_name, remaining_amount, updated_at, created_at
    FROM vendor_installments
    WHERE status IN ('active','partial')
  `)).catch(() => ({ rows: [] }));
  for (const r of rows.rows as any[]) {
    const days = daysSince(String(r.updated_at || r.created_at));
    if (days < 14) continue;
    const sev = severity(days);
    const amount = parseFloat(r.remaining_amount);
    const msg = `⏰ *Reminder Cicilan Vendor*\n\nNo: ${r.installment_number}\nVendor: ${r.vendor_name}\nSisa: ${idr(amount)}\nSudah ${days} hari belum dibayar.\n\nBuka BizPortal → Expense → Cicilan Vendor.`;
    await upsertReminder({
      companyId: r.company_id, refType: "vendor_installment", refId: r.id,
      refNumber: r.installment_number, partyName: r.vendor_name,
      amount, dueDays: days, severity: sev, message: msg,
    });
    if (sev === "danger") await notifyWa(msg, "vendor_installment", r.id);
  }
}

// ─── Bank loans reminders ─────────────────────────────────────────────────────
async function checkBankLoans() {
  const rows = await db.execute(sql.raw(`
    SELECT id, company_id, loan_number, loan_type, lender_name, outstanding_amount, disbursement_date, tenor_months, created_at
    FROM bank_loans
    WHERE status IN ('active','partial')
  `)).catch(() => ({ rows: [] }));
  const typeLabel: Record<string, string> = { bank: "Hutang Bank", leasing: "Leasing", other: "Hutang Lain" };
  for (const r of rows.rows as any[]) {
    // Calculate months elapsed
    const disburse = new Date(r.disbursement_date);
    const now = new Date();
    const monthsElapsed = (now.getFullYear() - disburse.getFullYear()) * 12 + (now.getMonth() - disburse.getMonth());
    const tenor = parseInt(r.tenor_months ?? "0", 10);
    const monthsLeft = tenor > 0 ? Math.max(0, tenor - monthsElapsed) : null;
    const overdueDays = daysSince(String(r.created_at));
    const sev = monthsLeft !== null && monthsLeft <= 1 ? "danger"
               : monthsLeft !== null && monthsLeft <= 3 ? "warning"
               : overdueDays > 90 ? "warning" : "info";
    if (sev === "info") continue;

    const amount = parseFloat(r.outstanding_amount);
    const tenorInfo = monthsLeft !== null ? `Sisa tenor: ${monthsLeft} bulan.` : "";
    const msg = `⏰ *Reminder ${typeLabel[r.loan_type] ?? "Hutang"}*\n\nNo: ${r.loan_number}\nKreditur: ${r.lender_name}\nSisa Pokok: ${idr(amount)}\n${tenorInfo}\n\nBuka BizPortal → Expense → Hutang Bank / Leasing.`;
    await upsertReminder({
      companyId: r.company_id, refType: "bank_loan", refId: r.id,
      refNumber: r.loan_number, partyName: r.lender_name,
      amount, dueDays: monthsLeft != null ? monthsLeft * 30 : overdueDays, severity: sev, message: msg,
    });
    if (sev === "danger") await notifyWa(msg, "bank_loan", r.id);
  }
}

// ─── Pending approval reminders ───────────────────────────────────────────────
async function checkPendingApprovals() {
  const rows = await db.execute(sql.raw(`
    SELECT id, company_id, ref_type, ref_id, description, amount, requester_name, l1_approver_name, created_at
    FROM expense_approval_requests
    WHERE status IN ('pending','l1_approved')
  `)).catch(() => ({ rows: [] }));
  for (const r of rows.rows as any[]) {
    const days = daysSince(String(r.created_at));
    if (days < 2) continue;
    const amount = parseFloat(r.amount);
    const sev = days >= 5 ? "danger" : "warning";
    const approver = r.l1_approver_name ?? "Approver";
    const msg = `⏳ *Approval Belum Diproses (${days} hari)*\n\nID: #${r.id}\nDeskripsi: ${r.description}\nNominal: ${idr(amount)}\nPemohon: ${r.requester_name ?? "-"}\nMenunggu: ${approver}\n\nBuka BizPortal → Expense → Approval untuk segera diproses.`;
    await upsertReminder({
      companyId: r.company_id, refType: "approval_request", refId: r.id,
      partyName: r.requester_name ?? undefined, amount, dueDays: days, severity: sev, message: msg,
    });
    if (sev === "danger") await notifyWa(msg, "approval_request", r.id);
  }
}

// ─── Main runner ──────────────────────────────────────────────────────────────
export async function runExpenseReminders() {
  try {
    await ensureOnce();
    await Promise.allSettled([
      checkCashAdvances(),
      checkVendorInstallments(),
      checkBankLoans(),
      checkPendingApprovals(),
    ]);
    logger.debug("expenseReminderWorker: scan complete");
  } catch (err) {
    logger.warn({ err }, "expenseReminderWorker: error during scan");
  }
}

export function startExpenseReminderWorker() {
  const initialDelayMs = INITIAL_DELAY_MIN * 60 * 1000;
  const intervalMs = INTERVAL_MIN * 60 * 1000;
  setTimeout(() => {
    runExpenseReminders();
    setInterval(runExpenseReminders, intervalMs);
  }, initialDelayMs);
  logger.info(
    { intervalMin: INTERVAL_MIN, initialDelayMin: INITIAL_DELAY_MIN },
    "expenseReminderWorker started"
  );
}
