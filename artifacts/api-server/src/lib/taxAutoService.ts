import { db, accountingTaxesTable, transactionTaxesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { broadcastTaxUpdate } from "./taxSseBroadcast.js";
import { assertTaxPeriodEditable } from "./taxPeriodGuard.js";
import { criticalAlert } from "./criticalAlert.js";

// ── Dev-test hook — paksa catch block dieksekusi di test environment ──────────
// Jangan ubah langsung — gunakan _setForceFailForTesting() dari devTestRoutes.
let _forceFailForTesting = false;
export function _setForceFailForTesting(v: boolean): void { _forceFailForTesting = v; }

// ── Tax Capture Retry Queue ────────────────────────────────────────────────────
// Tabel dibuat sekali saat startup. Digunakan agar tax capture yang gagal
// tidak hilang begitu saja — bisa di-retry manual atau via scheduled job.
(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tax_capture_queue (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      transaction_type TEXT    NOT NULL,
      transaction_id   INTEGER NOT NULL,
      params_json      JSONB   NOT NULL,
      error_message    TEXT,
      attempts         INTEGER NOT NULL DEFAULT 0,
      status           TEXT    NOT NULL DEFAULT 'pending',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      next_retry_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
})();

async function enqueueTaxCaptureRetry(
  companyId: number,
  transactionType: string,
  transactionId: number,
  paramsJson: unknown,
  errMsg: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO tax_capture_queue
      (company_id, transaction_type, transaction_id, params_json, error_message, status)
    VALUES (${companyId}, ${transactionType}, ${transactionId}, ${JSON.stringify(paramsJson)}::jsonb, ${errMsg}, 'pending')
  `).catch((qErr) => {
    void criticalAlert(
      "[taxAutoService] CRITICAL: tax capture gagal DAN queue juga gagal — butuh investigasi manual",
      { err: String(qErr), companyId, transactionType, transactionId },
    );
  });
}

export type TxType =
  | "logistic_order"
  | "sales_order"
  | "purchase_order"
  | "expense"
  | "bank_loan"
  | "employee_advance"
  | "fixed_asset"
  | "sport_center"
  | "manual_journal"
  | "other";

interface RecordTaxParams {
  companyId: number;
  transactionType: TxType;
  transactionId: number;
  transactionRef?: string | null;
  baseAmount: number;
  taxAmount?: number;
  subType?: string | null;
  partnerName?: string | null;
  npwp?: string | null;
  nik?: string | null;
  fakturPajakNumber?: string | null;
  buktiPotongNumber?: string | null;
  invoiceDate?: string | null;
  fakturDate?: string | null;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function findTaxByName(
  companyId: number,
  namePart: string,
): Promise<typeof accountingTaxesTable.$inferSelect | null> {
  const rows = await db
    .select()
    .from(accountingTaxesTable)
    .where(
      sql`${accountingTaxesTable.companyId} = ${companyId}
          AND ${accountingTaxesTable.isActive} = true
          AND LOWER(${accountingTaxesTable.name}) LIKE LOWER(${`%${namePart}%`})`,
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findTaxByKind(
  companyId: number,
  kind: "sale" | "purchase" | "withholding",
): Promise<typeof accountingTaxesTable.$inferSelect | null> {
  const rows = await db
    .select()
    .from(accountingTaxesTable)
    .where(
      sql`${accountingTaxesTable.companyId} = ${companyId}
          AND ${accountingTaxesTable.isActive} = true
          AND ${accountingTaxesTable.kind} = ${kind}`,
    )
    .limit(1);
  return rows[0] ?? null;
}

function subIncludes(sub: string, ...keywords: string[]): boolean {
  return keywords.some((k) => sub.includes(k));
}

/**
 * Hitung PPh 21 menggunakan tarif progresif Pasal 17 UU PPh (berlaku 2024).
 * Input: gaji kotor TAHUNAN (rupiah). Output: pajak tahunan.
 * Bracket: 0-60jt@5%, 60jt-250jt@15%, 250jt-500jt@25%, 500jt-5M@30%, >5M@35%.
 */
function calculatePph21Progressive(annualGross: number): number {
  const brackets: Array<[number, number]> = [
    [60_000_000,    0.05],
    [250_000_000,   0.15],
    [500_000_000,   0.25],
    [5_000_000_000, 0.30],
    [Infinity,      0.35],
  ];
  let tax = 0;
  let remaining = Math.max(annualGross, 0);
  let prevLimit = 0;
  for (const [limit, rate] of brackets) {
    const bracket = Math.min(remaining, limit - prevLimit);
    if (bracket <= 0) break;
    tax += bracket * rate;
    remaining -= bracket;
    prevLimit = limit;
    if (remaining <= 0) break;
  }
  return tax;
}

async function detectTax(
  companyId: number,
  txType: TxType,
  subType?: string | null,
): Promise<typeof accountingTaxesTable.$inferSelect | null> {
  const sub = (subType ?? "").toLowerCase();

  switch (txType) {
    case "logistic_order": {
      // PPh 15: khusus pelayaran laut / ocean / sea freight
      if (subIncludes(sub, "laut", "sea", "ocean", "pelayaran", "kapal", "fcl", "lcl", "b/l", "bl", "mbl")) {
        const isLN = subIncludes(sub, "ln", "luar negeri", "international", "overseas", "foreign");
        if (isLN) {
          return (
            (await findTaxByName(companyId, "PPh 15 Pelayaran LN")) ??
            (await findTaxByName(companyId, "Pelayaran LN")) ??
            (await findTaxByName(companyId, "PPh 15"))
          );
        }
        return (
          (await findTaxByName(companyId, "PPh 15 Pelayaran DN")) ??
          (await findTaxByName(companyId, "Pelayaran DN")) ??
          (await findTaxByName(companyId, "PPh 15"))
        );
      }
      // Default freight darat/udara → PPh Freight Paket 1,1%
      return (
        (await findTaxByName(companyId, "Freight Paket")) ??
        (await findTaxByName(companyId, "PPh Freight")) ??
        (await findTaxByName(companyId, "Freight")) ??
        (await findTaxByKind(companyId, "withholding"))
      );
    }

    case "sales_order":
      return (
        (await findTaxByName(companyId, "PPN Keluaran")) ??
        (await findTaxByKind(companyId, "sale"))
      );

    case "purchase_order":
      return (
        (await findTaxByName(companyId, "PPN Masukan")) ??
        (await findTaxByKind(companyId, "purchase"))
      );

    case "expense": {
      // Sewa → PPh 4(2) Final 10%
      if (subIncludes(sub, "sewa", "rental", "sewa_kantor", "kantor")) {
        return (
          (await findTaxByName(companyId, "PPh 4(2)")) ??
          (await findTaxByName(companyId, "PPh 4")) ??
          (await findTaxByName(companyId, "PPh 23"))
        );
      }
      // Gaji / honorarium → PPh 21
      if (subIncludes(sub, "gaji", "honor", "salary", "tunjangan", "upah", "pph_21")) {
        return (
          (await findTaxByName(companyId, "PPh 21")) ??
          (await findTaxByKind(companyId, "withholding"))
        );
      }
      // Luar negeri → PPh 26
      if (subIncludes(sub, "luar negeri", "overseas", "foreign", "pph_26")) {
        return (
          (await findTaxByName(companyId, "PPh 26")) ??
          (await findTaxByKind(companyId, "withholding"))
        );
      }
      // Default jasa → PPh 23
      return (
        (await findTaxByName(companyId, "PPh 23")) ??
        (await findTaxByKind(companyId, "withholding"))
      );
    }

    case "bank_loan":
      // Bunga pinjaman → PPh 23 (bunga) atau PPh Final sesuai kebijakan
      return (
        (await findTaxByName(companyId, "PPh 23")) ??
        (await findTaxByKind(companyId, "withholding"))
      );

    case "sport_center":
      // Sport center → PPN Keluaran (jasa olahraga)
      return (
        (await findTaxByName(companyId, "PPN Keluaran")) ??
        (await findTaxByKind(companyId, "sale"))
      );

    case "employee_advance":
    case "fixed_asset":
      // Kasbon & Aset Tetap umumnya tidak kena pajak otomatis
      return null;

    default:
      return null;
  }
}

function taxDirection(tax: typeof accountingTaxesTable.$inferSelect): string {
  if (tax.kind === "sale") return "output";
  if (tax.kind === "purchase") return "input";
  return "withholding";
}

export async function recordTransactionTax(params: RecordTaxParams): Promise<void> {
  try {
    if (_forceFailForTesting) throw new Error("DEV TEST: forced tax capture failure");
    const {
      companyId,
      transactionType,
      transactionId,
      transactionRef,
      baseAmount,
      subType,
      partnerName,
      fakturPajakNumber,
      buktiPotongNumber,
    } = params;

    if (!baseAmount || baseAmount <= 0) return;

    const tax = await detectTax(companyId, transactionType, subType);
    if (!tax) {
      logger.debug(
        { companyId, transactionType, transactionId },
        "[taxAutoService] No matching tax found, skipping",
      );
      return;
    }

    // PPh 21: gunakan tarif progresif Pasal 17 UU PPh — asumsikan baseAmount = gaji bulanan
    let taxAmount: number;
    if (params.taxAmount != null) {
      taxAmount = round2(params.taxAmount);
    } else if (tax.name.toLowerCase().includes("pph 21")) {
      const annualGross = baseAmount * 12;
      const annualTax = calculatePph21Progressive(annualGross);
      taxAmount = round2(annualTax / 12);
    } else {
      taxAmount = round2((baseAmount * Number(tax.rate)) / 100);
    }

    const period = currentPeriod();
    const direction = taxDirection(tax);

    // Cek period lock — jika locked/exported, jangan update existing record
    const periodGuard = await assertTaxPeriodEditable(companyId, period);
    const isPeriodEditable = periodGuard.editable;

    const insertValues = {
      companyId,
      transactionType,
      transactionId,
      transactionRef: transactionRef ?? null,
      taxId: tax.id,
      taxName: tax.name,
      taxRate: String(tax.rate),
      cutType: tax.cutType,
      baseAmount: String(round2(baseAmount)),
      taxAmount: String(taxAmount),
      accountId: tax.accountId ?? null,
      period,
      status: "pending",
      direction,
      partnerName: partnerName ?? null,
      npwp: params.npwp ?? null,
      nik: params.nik ?? null,
      fakturPajakNumber: fakturPajakNumber ?? null,
      buktiPotongNumber: buktiPotongNumber ?? null,
      invoiceDate: params.invoiceDate ?? null,
      fakturDate: params.fakturDate ?? null,
    };

    if (isPeriodEditable) {
      await db
        .insert(transactionTaxesTable)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [
            transactionTaxesTable.transactionType,
            transactionTaxesTable.transactionId,
            transactionTaxesTable.taxId,
          ],
          set: {
            baseAmount: String(round2(baseAmount)),
            taxAmount: String(taxAmount),
            direction,
            partnerName: partnerName ?? null,
            npwp: params.npwp ?? null,
            nik: params.nik ?? null,
            fakturPajakNumber: fakturPajakNumber ?? null,
            buktiPotongNumber: buktiPotongNumber ?? null,
            invoiceDate: params.invoiceDate ?? null,
            fakturDate: params.fakturDate ?? null,
            updatedAt: new Date(),
          },
        });
    } else {
      // Period locked/exported — hanya INSERT jika belum ada (DO NOTHING pada konflik)
      logger.warn(
        { companyId, transactionType, transactionId, period, periodStatus: periodGuard.status },
        "[taxAutoService] Period locked — using INSERT ON CONFLICT DO NOTHING (no update to existing record)",
      );
      await db
        .insert(transactionTaxesTable)
        .values(insertValues)
        .onConflictDoNothing();
    }

    logger.info(
      { companyId, transactionType, transactionId, taxName: tax.name, taxAmount },
      "[taxAutoService] Transaction tax recorded",
    );

    broadcastTaxUpdate({
      event: "tax_recorded",
      period,
      companyId,
      transactionType,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.warn(
      { err: e, companyId: params.companyId, transactionType: params.transactionType, transactionId: params.transactionId },
      "[taxAutoService] Tax capture gagal — dimasukkan ke retry queue (tax_capture_queue)",
    );
    await enqueueTaxCaptureRetry(
      params.companyId,
      params.transactionType,
      params.transactionId,
      params,
      errMsg,
    );
  }
}

/**
 * Batalkan (void) semua tax record yang terkait dengan sebuah transaksi.
 * Digunakan saat booking di-refund atau di-reverse agar laporan PPN
 * tidak over-count PPN Keluaran yang sudah dikembalikan ke pelanggan.
 * Idempoten — skip jika record sudah 'voided'.
 */
export async function reverseTransactionTax(params: {
  companyId: number;
  transactionType: TxType;
  transactionId: number;
}): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE transaction_taxes
         SET status     = 'voided',
             updated_at = NOW()
       WHERE transaction_type = ${params.transactionType}
         AND transaction_id   = ${params.transactionId}
         AND company_id       = ${params.companyId}
         AND status          <> 'voided'
    `);
    const affected = (result as { rowCount?: number }).rowCount ?? 0;
    if (affected > 0) {
      logger.info(
        { ...params, affected },
        "[taxAutoService] Transaction tax voided (reversal)",
      );
      broadcastTaxUpdate({
        event: "tax_voided",
        period: currentPeriod(),
        companyId: params.companyId,
        transactionType: params.transactionType,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    logger.warn({ err: e }, "[taxAutoService] Failed to reverse transaction tax (non-fatal)");
  }
}

/**
 * T007 — Auto Tax untuk Manual Journal.
 *
 * Dipanggil setelah manual journal berhasil di-post (status = 'posted').
 * Mendeteksi baris jurnal yang menggunakan akun pajak (via JOIN ke accounting_taxes),
 * lalu merekam transaction_taxes untuk setiap akun pajak yang ditemukan.
 *
 * Idempotent — konflik pada (transactionType, transactionId, taxId) di-handle via
 * ON CONFLICT DO UPDATE / DO NOTHING tergantung period lock status.
 */
export async function captureManualJournalTax(params: {
  companyId: number;
  entryId: number;
  entryNumber?: string | null;
  entryDate: string;
  partnerName?: string | null;
  npwp?: string | null;
  nik?: string | null;
  invoiceDate?: string | null;
  fakturDate?: string | null;
}): Promise<{ captured: number; skipped: number }> {
  try {
    // Ambil entry lines yang account_id-nya cocok dengan akun pajak perusahaan
    const { rows: taxLines } = await db.execute(sql`
      SELECT
        ael.account_id,
        SUM(ael.debit)::numeric  AS total_debit,
        SUM(ael.credit)::numeric AS total_credit,
        at.id          AS tax_id,
        at.name        AS tax_name,
        at.rate::numeric AS tax_rate,
        at.kind        AS tax_kind,
        at.cut_type
      FROM accounting_entry_lines ael
      JOIN accounting_taxes at
        ON at.account_id = ael.account_id
       AND at.company_id = ${params.companyId}
       AND at.is_active  = true
      WHERE ael.entry_id = ${params.entryId}
      GROUP BY ael.account_id, at.id, at.name, at.rate, at.kind, at.cut_type
    `);

    if (!taxLines.length) return { captured: 0, skipped: 0 };

    const d = new Date(params.entryDate);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    const periodGuard = await assertTaxPeriodEditable(params.companyId, period);

    let captured = 0;
    let skipped = 0;

    for (const row of taxLines as any[]) {
      const totalDebit  = Number(row.total_debit  ?? 0);
      const totalCredit = Number(row.total_credit ?? 0);
      const taxAmount   = round2(Math.max(totalDebit, totalCredit));
      if (taxAmount <= 0) { skipped++; continue; }

      const rate       = Number(row.tax_rate ?? 0);
      const baseAmount = rate > 0 ? round2((taxAmount * 100) / rate) : taxAmount;
      const direction  = row.tax_kind === "sale" ? "output"
                       : row.tax_kind === "purchase" ? "input"
                       : "withholding";

      const insertValues = {
        companyId:       params.companyId,
        transactionType: "manual_journal" as TxType,
        transactionId:   params.entryId,
        transactionRef:  params.entryNumber ?? null,
        taxId:           Number(row.tax_id),
        taxName:         String(row.tax_name),
        taxRate:         String(row.tax_rate),
        cutType:         String(row.cut_type ?? "self_borne"),
        baseAmount:      String(baseAmount),
        taxAmount:       String(taxAmount),
        accountId:       Number(row.account_id),
        period,
        status:          "pending",
        direction,
        partnerName:     params.partnerName ?? null,
        npwp:            params.npwp ?? null,
        nik:             params.nik ?? null,
        postingDate:     new Date(),
        invoiceDate:     params.invoiceDate ?? null,
        fakturDate:      params.fakturDate ?? null,
      };

      if (periodGuard.editable) {
        await db
          .insert(transactionTaxesTable)
          .values(insertValues)
          .onConflictDoUpdate({
            target: [
              transactionTaxesTable.transactionType,
              transactionTaxesTable.transactionId,
              transactionTaxesTable.taxId,
            ],
            set: {
              baseAmount:  String(baseAmount),
              taxAmount:   String(taxAmount),
              partnerName: params.partnerName ?? null,
              npwp:        params.npwp ?? null,
              nik:         params.nik ?? null,
              invoiceDate: params.invoiceDate ?? null,
              fakturDate:  params.fakturDate ?? null,
              updatedAt:   new Date(),
            },
          });
      } else {
        await db
          .insert(transactionTaxesTable)
          .values(insertValues)
          .onConflictDoNothing();
      }
      captured++;
    }

    if (captured > 0) {
      logger.info(
        { companyId: params.companyId, entryId: params.entryId, captured },
        "[taxAutoService] Manual journal tax captured",
      );
      broadcastTaxUpdate({
        event: "tax_recorded",
        period,
        companyId: params.companyId,
        transactionType: "manual_journal",
        timestamp: new Date().toISOString(),
      });
    }

    return { captured, skipped };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    logger.warn(
      { err: e, companyId: params.companyId, entryId: params.entryId },
      "[taxAutoService] captureManualJournalTax gagal — dimasukkan ke retry queue",
    );
    await enqueueTaxCaptureRetry(
      params.companyId,
      "manual_journal",
      params.entryId,
      params,
      errMsg,
    );
    return { captured: 0, skipped: 0 };
  }
}
