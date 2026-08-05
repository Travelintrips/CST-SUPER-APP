/**
 * FASE 6C — Recurring Expense Worker
 *
 * Setiap interval (default 1 jam), cek recurring_expenses yang next_run <= NOW()
 * dan is_active = true, lalu auto-generate vendor bill draft.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

const INTERVAL_MS = 60 * 60 * 1000; // 1 jam

async function processRecurringExpenses(): Promise<void> {
  try {
    const due = await db.execute(sql`
      SELECT * FROM recurring_expenses
      WHERE is_active = TRUE
        AND (next_run IS NULL OR next_run <= CURRENT_DATE)
      ORDER BY next_run ASC NULLS FIRST
    `);

    if (due.rows.length === 0) return;

    logger.info({ count: due.rows.length }, "[recurringExpenseWorker] Processing due recurring expenses");

    for (const row of due.rows) {
      const r = row as Record<string, unknown>;
      try {
        // Buat vendor bill draft di purchase module (vendor_invoices)
        const invoiceNumber = `RE-${Date.now()}-${r.id}`;
        const description = `[RECURRING] ${r.name}${r.facility_id ? ` (Facility #${r.facility_id})` : ""}`;

        await db.execute(sql`
          INSERT INTO vendor_invoices
            (invoice_number, company_id, status, grand_total, net_amount, tax_amount,
             notes, created_at, updated_at)
          VALUES
            (${invoiceNumber}, ${r.company_id ?? 1}, 'draft',
             ${String(r.amount ?? 0)}, ${String(r.amount ?? 0)}, '0',
             ${description}, NOW(), NOW())
        `);

        // Hitung next_run berdasarkan frequency
        const freq = String(r.frequency ?? "monthly");
        const nextRunSql =
          freq === "weekly"
            ? sql`CURRENT_DATE + INTERVAL '7 days'`
            : sql`CURRENT_DATE + INTERVAL '1 month'`;

        await db.execute(sql`
          UPDATE recurring_expenses
          SET next_run = ${nextRunSql}, updated_at = NOW()
          WHERE id = ${r.id}
        `);

        logger.info({ id: r.id, name: r.name }, "[recurringExpenseWorker] Draft vendor bill created");
      } catch (itemErr) {
        logger.error({ err: itemErr, id: r.id }, "[recurringExpenseWorker] Failed to process recurring expense");
      }
    }
  } catch (err) {
    logger.error({ err }, "[recurringExpenseWorker] Tick error");
  }
}

export function startRecurringExpenseWorker(
  intervalMs = INTERVAL_MS,
  initialDelayMin = 10,
): void {
  const initialDelay = initialDelayMin * 60 * 1000;
  setTimeout(() => {
    processRecurringExpenses().catch(() => {});
    setInterval(() => {
      processRecurringExpenses().catch(() => {});
    }, intervalMs).unref();
  }, initialDelay).unref();

  logger.info(
    { intervalMin: Math.round(intervalMs / 60_000), initialDelayMin },
    "[recurringExpenseWorker] started",
  );
}
