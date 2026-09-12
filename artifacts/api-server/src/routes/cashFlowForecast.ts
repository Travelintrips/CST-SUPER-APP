import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

function execRows<T>(result: any): T[] {
  return (result?.rows ?? []) as T[];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// GET /api/accounting/cash-flow-forecast
// Returns cash flow forecast for 7, 30, 90 days in a single call
router.get("/", async (req, res) => {
  try {
    const companyId = Number(req.headers["x-company-id"]) || 1;

    const [
      bankBalRows,
      arRows,
      vendorInvRows,
      loanRows,
      taxRows,
      kasbonRows,
      installmentRows,
    ] = await Promise.all([
      // 1. Current bank balance (cash & bank accounts)
      db.execute<{ balance: string }>(sql`
        SELECT COALESCE(SUM(ael.debit) - SUM(ael.credit), 0)::numeric AS balance
        FROM accounting_entry_lines ael
        JOIN chart_of_accounts coa ON ael.account_id = coa.id
        JOIN accounting_entries ae ON ael.entry_id = ae.id
        WHERE (coa.company_id = ${companyId} OR coa.company_id IS NULL)
          AND ae.company_id = ${companyId}
          AND ae.status = 'posted'
          AND coa.type = 'asset'
          AND (
            coa.subtype = 'cash_bank'
            OR (coa.subtype IS NULL AND (
              coa.name ILIKE '%kas%'
              OR coa.name ILIKE '%bank%'
              OR coa.name ILIKE '%giro%'
              OR coa.name ILIKE '%tabungan%'
            ))
          )
      `),

      // 2. AR outstanding — all invoiced sales documents not yet paid
      // NOTE: due_date is stored as TEXT in sales_documents (same pattern as purchase_documents)
      db.execute<{ due_date: string | null; amount: string }>(sql`
        SELECT
          due_date,
          (grand_total::numeric - COALESCE(amount_paid::numeric, 0))::numeric AS amount
        FROM sales_documents
        WHERE company_id = ${companyId}
          AND invoice_status = 'invoiced'
          AND grand_total::numeric > COALESCE(amount_paid::numeric, 0)
      `),

      // 3. Vendor invoice outstanding — all billed purchase documents not yet paid
      // NOTE: due_date is TEXT in purchase_documents
      db.execute<{ due_date: string | null; amount: string }>(sql`
        SELECT
          due_date,
          (grand_total - COALESCE(amount_paid, 0))::numeric AS amount
        FROM purchase_documents
        WHERE company_id = ${companyId}
          AND bill_status = 'billed'
          AND cancelled_at IS NULL
          AND grand_total > COALESCE(amount_paid, 0)
      `),

      // 4. Active bank loans — remaining outstanding amounts
      db.execute<{ outstanding: string; tenor_months: number | null; lender_name: string }>(sql`
        SELECT
          outstanding_amount::numeric AS outstanding,
          tenor_months,
          lender_name
        FROM bank_loans
        WHERE company_id = ${companyId}
          AND status = 'active'
      `),

      // 5. Tax obligations pending — grouped by period
      db.execute<{ period: string; tax_amount: string }>(sql`
        SELECT
          period,
          COALESCE(SUM(tax_amount), 0)::numeric AS tax_amount
        FROM tax_transactions
        WHERE company_id = ${companyId}
          AND status = 'pending'
        GROUP BY period
        ORDER BY period ASC
      `),

      // 6. Kasbon (employee advances) outstanding
      db.execute<{ outstanding: string; count: number }>(sql`
        SELECT
          COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0)::numeric AS outstanding,
          COUNT(*)::int AS count
        FROM cash_advances
        WHERE company_id = ${companyId}
          AND type = 'kasbon'
          AND status = 'active'
          AND amount > COALESCE(paid_amount, 0)
      `),

      // 7. Vendor installments remaining
      db.execute<{ outstanding: string; count: number }>(sql`
        SELECT
          COALESCE(SUM(remaining_amount), 0)::numeric AS outstanding,
          COUNT(*)::int AS count
        FROM vendor_installments
        WHERE company_id = ${companyId}
          AND status = 'active'
      `),
    ]);

    const bankBalance = Number(execRows<{ balance: string }>(bankBalRows)[0]?.balance ?? 0);
    const arItems = execRows<{ due_date: string | null; amount: string }>(arRows);
    const vendorItems = execRows<{ due_date: string | null; amount: string }>(vendorInvRows);
    const loans = execRows<{ outstanding: string; tenor_months: number | null; lender_name: string }>(loanRows);
    const taxItems = execRows<{ period: string; tax_amount: string }>(taxRows);
    const kasbon = execRows<{ outstanding: string; count: number }>(kasbonRows)[0];
    const installment = execRows<{ outstanding: string; count: number }>(installmentRows)[0];

    const kasbonTotal = Number(kasbon?.outstanding ?? 0);
    const kasbonCount = Number(kasbon?.count ?? 0);
    const installmentTotal = Number(installment?.outstanding ?? 0);
    const installmentCount = Number(installment?.count ?? 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    // Compute forecasts for each period
    const forecasts: Record<string, any> = {};

    for (const days of [7, 30, 90] as const) {
      const cutoffDate = addDays(today, days);
      const cutoffStr = cutoffDate.toISOString().slice(0, 10);
      const cutoffMonth = cutoffDate.toISOString().slice(0, 7); // YYYY-MM
      const todayMonth = todayStr.slice(0, 7);

      // ── Cash In ──────────────────────────────────────────────────────────
      // AR: include overdue (due_date <= today) + due within N days + no due_date
      const arFiltered = arItems.filter(
        (item) => !item.due_date || item.due_date <= cutoffStr
      );
      const arAmount = arFiltered.reduce((s, i) => s + Number(i.amount), 0);
      const arOverdueAmount = arItems
        .filter((i) => i.due_date && i.due_date < todayStr)
        .reduce((s, i) => s + Number(i.amount), 0);

      const totalCashIn = arAmount;

      // ── Cash Out ─────────────────────────────────────────────────────────
      // Vendor invoices due within period (+ overdue)
      const vendorFiltered = vendorItems.filter(
        (item) => !item.due_date || item.due_date <= cutoffStr
      );
      const vendorAmount = vendorFiltered.reduce((s, i) => s + Number(i.amount), 0);
      const vendorOverdueAmount = vendorItems
        .filter((i) => i.due_date && i.due_date < todayStr)
        .reduce((s, i) => s + Number(i.amount), 0);

      // Loan repayment estimate: monthly installment × period_months
      // Use outstanding/remaining_tenor as monthly payment estimate
      const loanAmount = loans.reduce((s, loan) => {
        const outst = Number(loan.outstanding);
        const tenor = Math.max(loan.tenor_months ?? 12, 1);
        const monthlyPay = outst / tenor;
        const periodMonths = days / 30;
        return s + monthlyPay * periodMonths;
      }, 0);

      // Tax: pending for periods that fall within the forecast window
      const taxAmount = taxItems
        .filter((t) => t.period >= todayMonth && t.period <= cutoffMonth)
        .reduce((s, t) => s + Number(t.tax_amount), 0);

      // Tax overdue (past periods still pending)
      const taxOverdueAmount = taxItems
        .filter((t) => t.period < todayMonth)
        .reduce((s, t) => s + Number(t.tax_amount), 0);

      // Kasbon: include in 30+ day forecast
      const kasbonAmount = days >= 30 ? kasbonTotal : 0;

      // Vendor installments: include in 90-day forecast
      const installAmt = days >= 90 ? installmentTotal : 0;

      const totalCashOut =
        vendorAmount + loanAmount + taxAmount + taxOverdueAmount + kasbonAmount + installAmt;

      const projectedClosing = bankBalance + totalCashIn - totalCashOut;
      const isNegative = projectedClosing < 0;

      const formatIDR = (n: number) =>
        new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.abs(n));

      forecasts[String(days)] = {
        days,
        openingCash: bankBalance,
        cashIn: {
          arOutstanding: {
            amount: arAmount,
            count: arFiltered.length,
            overdueAmount: arOverdueAmount,
          },
          total: totalCashIn,
          items: [
            {
              category: "AR Outstanding",
              label: "Piutang Pelanggan",
              amount: arAmount,
              overdueAmount: arOverdueAmount,
              count: arFiltered.length,
              description: `Piutang jatuh tempo dalam ${days} hari`,
            },
          ],
        },
        cashOut: {
          vendorInvoices: {
            amount: vendorAmount,
            count: vendorFiltered.length,
            overdueAmount: vendorOverdueAmount,
          },
          loanRepayments: {
            amount: loanAmount,
            count: loans.length,
            description: "Estimasi angsuran pinjaman bank",
          },
          taxObligations: {
            amount: taxAmount + taxOverdueAmount,
            pendingAmount: taxAmount,
            overdueAmount: taxOverdueAmount,
          },
          kasbonOutstanding: {
            amount: kasbonAmount,
            count: days >= 30 ? kasbonCount : 0,
          },
          vendorInstallments: {
            amount: installAmt,
            count: days >= 90 ? installmentCount : 0,
          },
          total: totalCashOut,
          items: [
            {
              category: "Vendor Invoice",
              label: "Hutang Vendor",
              amount: vendorAmount,
              overdueAmount: vendorOverdueAmount,
              count: vendorFiltered.length,
              description: `Hutang vendor jatuh tempo dalam ${days} hari`,
            },
            {
              category: "Loan Repayment",
              label: "Angsuran Pinjaman",
              amount: loanAmount,
              count: loans.length,
              description: `Estimasi cicilan ${days / 30 < 1 ? "1" : Math.round(days / 30).toString()} bulan`,
            },
            {
              category: "Tax Obligation",
              label: "Kewajiban Pajak",
              amount: taxAmount + taxOverdueAmount,
              count: taxItems.filter(
                (t) => t.period <= cutoffMonth
              ).length,
              description: `Pajak pending dalam periode ${days} hari`,
            },
            ...(days >= 30
              ? [
                  {
                    category: "Kasbon",
                    label: "Kasbon Karyawan",
                    amount: kasbonAmount,
                    count: kasbonCount,
                    description: "Kasbon aktif belum dipertanggungjawabkan",
                  },
                ]
              : []),
            ...(days >= 90
              ? [
                  {
                    category: "Vendor Installment",
                    label: "Cicilan Vendor",
                    amount: installAmt,
                    count: installmentCount,
                    description: "Sisa cicilan vendor aktif",
                  },
                ]
              : []),
          ],
        },
        projectedClosing,
        isNegative,
        warning: isNegative
          ? `⚠️ Proyeksi saldo ${days} hari ke depan NEGATIF Rp ${formatIDR(projectedClosing)}. Perlu tindakan pengamanan kas segera.`
          : null,
      };
    }

    return res.json({
      asOf: todayStr,
      openingCash: bankBalance,
      periods: forecasts,
    });
  } catch (err: any) {
    console.error("Cash flow forecast error:", err);
    return res.status(500).json({
      message: "Gagal menghitung cash flow forecast",
      detail: err?.message,
    });
  }
});

export default router;
