/**
 * ingestModulePayment — ASK (Accounting Settlement Kit)
 *
 * Centralized engine for posting module payments (sport_center, tenant, logistics)
 * into the double-entry accounting system (accounting_payments + accounting_entries).
 *
 * Guarantee: idempotent — calling multiple times with the same moduleType + sourceDocId
 * is a no-op if the accounting_payment already exists.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getPostingEngine } from "./posting-engine/index.js";
import { isCashPaymentMethod, normalizePaymentMethod, resolvePaymentDestination } from "./accounting.js";

export type ModuleType = "sport_center" | "tenant" | "logistics";

export interface IngestModulePaymentInput {
  moduleType: ModuleType;
  sourceDocId: number;
  companyId: number;
  amount: number;
  method: string;
  partnerName?: string | null;
  date: string;
  ref?: string | null;
  description?: string | null;
  actorId?: string | null;
}

export interface IngestResult {
  ok: boolean;
  accountingPaymentId?: number;
  accountingEntryId?: number;
  alreadyPosted?: boolean;
  error?: string;
}

interface ExistingAccountingMatch {
  accountingPaymentId: number | null;
  accountingEntryId: number | null;
}

function isUniqueSourcePaymentError(error: unknown): boolean {
  const value = error as { code?: unknown; constraint?: unknown; message?: unknown; cause?: Record<string, unknown> };
  const cause = value?.cause ?? {};
  const code = String(value?.code ?? cause["code"] ?? "");
  const constraint = String(value?.constraint ?? cause["constraint"] ?? "");
  const message = String(value?.message ?? cause["message"] ?? error ?? "");
  return (
    (code === "23505" &&
      (constraint === "uq_public_accounting_entries_source_payment_id" ||
        message.includes("uq_public_accounting_entries_source_payment_id"))) ||
    message.includes("uq_public_accounting_entries_source_payment_id")
  );
}

/**
 * Resolve the canonical accounting owner before any INSERT.
 *
 * The payment source pair was historically the first idempotency key, while
 * newer canonical postings also carry source_payment_id on the entry. Both
 * identities must be checked because an adopted legacy entry can exist before
 * the handoff is retried.
 */
async function findExistingPostedSportPayment(
  sourceDocId: number,
  amount: number,
): Promise<ExistingAccountingMatch | null> {
  const result = await db.execute(sql`
    SELECT
      ap.id AS payment_id,
      ap.status AS payment_status,
      ap.amount AS payment_amount,
      ap.entry_id AS payment_entry_id,
      ae.id AS entry_id,
      ae.status AS entry_status,
      ae.total_debit AS entry_total_debit,
      ae.total_credit AS entry_total_credit,
      ae.source_payment_id AS entry_source_payment_id
    FROM accounting_payments ap
    LEFT JOIN accounting_entries ae ON ae.id = ap.entry_id
    WHERE (
      ap.source_type = 'sport_center'
      AND ap.source_doc_id = ${sourceDocId}
    )
    OR ae.source_payment_id = ${sourceDocId}
    ORDER BY ap.id
    LIMIT 1
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  // Compatibility with callers/tests that only project the legacy payment id.
  // The production projection below always includes the validation columns.
  if ("id" in row && !("payment_id" in row)) {
    return { accountingPaymentId: Number(row["id"]) || null, accountingEntryId: null };
  }

  const paymentId = Number(row["payment_id"] ?? row["id"] ?? 0) || null;
  const entryId = Number(row["entry_id"] ?? row["payment_entry_id"] ?? 0) || null;
  const expectedAmount = Math.round(amount * 100) / 100;
  const paymentAmount = Number(row["payment_amount"]);
  const debit = Number(row["entry_total_debit"]);
  const credit = Number(row["entry_total_credit"]);
  const balanced = Number.isFinite(debit) && Number.isFinite(credit) &&
    Math.abs(debit - expectedAmount) < 0.01 &&
    Math.abs(credit - expectedAmount) < 0.01;
  const paymentAmountMatches = !Number.isFinite(paymentAmount) ||
    Math.abs(paymentAmount - expectedAmount) < 0.01;
  const entryPosted = String(row["entry_status"] ?? "").toLowerCase() === "posted";
  const paymentPosted = String(row["payment_status"] ?? "").toLowerCase() === "posted";

  if (!entryId || !entryPosted || !balanced || !paymentAmountMatches ||
      (paymentId != null && !paymentPosted)) {
    throw new Error(
      `ACCOUNTING_IDEMPOTENCY_MISMATCH: payment=${sourceDocId} ` +
      `existing_payment=${paymentId ?? "none"} existing_entry=${entryId ?? "none"}`,
    );
  }

  return { accountingPaymentId: paymentId, accountingEntryId: entryId };
}

const JOURNAL_PREFERENCE_ORDER = ["cash", "bank", "general"];

async function resolveJournal(companyId: number, method: string): Promise<number | null> {
  const isCash = isCashPaymentMethod(method);
  const settingsRes = await db.execute(sql`
    SELECT cash_journal_id, bank_journal_id, qris_journal_id
    FROM accounting_settings
    WHERE company_id = ${companyId}
    LIMIT 1
  `);
  const settings = settingsRes.rows[0] as Record<string, unknown> | undefined;
  if (settings) {
    const cashJId = settings["cash_journal_id"] ? Number(settings["cash_journal_id"]) : null;
    const bankJId = settings["bank_journal_id"] ? Number(settings["bank_journal_id"]) : null;
    const qrisJId = settings["qris_journal_id"] ? Number(settings["qris_journal_id"]) : null;
    const destination = resolvePaymentDestination(method, {
      cashJournalId: cashJId,
      bankJournalId: bankJId,
      qrisJournalId: qrisJId,
    });
    if (destination.journalId) return destination.journalId;
    if (cashJId) return cashJId;
    if (bankJId) return bankJId;
  }
  for (const jType of isCash ? JOURNAL_PREFERENCE_ORDER : ["bank", "cash", "general"]) {
    const jRes = await db.execute(sql`
      SELECT id FROM accounting_journals
      WHERE (company_id = ${companyId} OR company_id IS NULL)
        AND type = ${jType}
        AND is_active = true
      ORDER BY company_id DESC NULLS LAST
      LIMIT 1
    `);
    if (jRes.rows.length > 0) {
      return Number((jRes.rows[0] as Record<string, unknown>)["id"]);
    }
  }
  return null;
}

async function resolveRevenueAccount(companyId: number): Promise<number | null> {
  const settingsRes = await db.execute(sql`
    SELECT sales_income_account_id FROM accounting_settings
    WHERE company_id = ${companyId} LIMIT 1
  `);
  const s = settingsRes.rows[0] as Record<string, unknown> | undefined;
  if (s?.["sales_income_account_id"]) return Number(s["sales_income_account_id"]);

  const accRes = await db.execute(sql`
    SELECT id FROM chart_of_accounts
    WHERE (company_id = ${companyId} OR company_id IS NULL)
      AND type = 'revenue'
      AND is_active = true
    ORDER BY company_id DESC NULLS LAST
    LIMIT 1
  `);
  if (accRes.rows.length > 0) return Number((accRes.rows[0] as Record<string, unknown>)["id"]);
  return null;
}

/**
 * Klasifikasi nama akun sebagai 'kas', 'bank', atau 'lainnya' berdasarkan nama.
 * Dipakai untuk memvalidasi bahwa akun yang dipilih benar-benar cocok dengan
 * kategori metode pembayaran, termasuk saat id berasal dari accounting_settings
 * (default_bank_account_id / default_cash_account_id) yang bisa saja salah
 * dikonfigurasi secara manual.
 */
function classifyAccountName(name: string | null | undefined): "kas" | "bank" | "other" {
  const n = (name ?? "").toLowerCase();
  if (n.includes("bank")) return "bank";
  if (n.includes("kas")) return "kas";
  return "other";
}

async function getAccountName(accountId: number): Promise<string | null> {
  const res = await db.execute(sql`SELECT name FROM chart_of_accounts WHERE id = ${accountId} LIMIT 1`);
  return res.rows.length > 0 ? String((res.rows[0] as Record<string, unknown>)["name"]) : null;
}

/**
 * Resolve akun debit (kas/bank) berdasarkan metode pembayaran.
 * - cash/tunai → prefer default_cash_account_id, fallback ke bank
 * - lainnya (transfer, bank, qris, dll) → prefer default_bank_account_id, fallback ke kas
 *
 * FIX: sebelumnya method-agnostic sehingga selalu memilih akun pertama sorted code ASC
 * (1-1010 Kas) bahkan untuk pembayaran transfer bank → salah catat ke Kas ER.
 *
 * SAFEGUARD: kandidat dari accounting_settings (default_bank_account_id /
 * default_cash_account_id) divalidasi terhadap nama akunnya sendiri — kalau
 * settingnya ternyata salah konfigurasi (mis. default_bank_account_id justru
 * menunjuk ke akun "Kas"), kita tidak diam-diam memakainya; fallback ke query
 * COA yang benar-benar cocok dengan kategori, dan kalau tetap tidak ada akun
 * yang valid untuk kategori tsb, function ini akan melempar error alih-alih
 * memposting ke akun yang salah kategori.
 */
async function resolveBankAccount(companyId: number, method: string): Promise<number | null> {
  const isCash = isCashPaymentMethod(method);
  const wantCategory: "kas" | "bank" = isCash ? "kas" : "bank";

  const settingsRes = await db.execute(sql`
    SELECT default_bank_account_id, default_cash_account_id FROM accounting_settings
    WHERE company_id = ${companyId} LIMIT 1
  `);
  const s = settingsRes.rows[0] as Record<string, unknown> | undefined;
  if (s) {
    const bankId = s["default_bank_account_id"] ? Number(s["default_bank_account_id"]) : null;
    const cashId = s["default_cash_account_id"] ? Number(s["default_cash_account_id"]) : null;
    const preferredId = isCash ? cashId : bankId;
    const fallbackId = isCash ? bankId : cashId;

    if (preferredId) {
      const name = await getAccountName(preferredId);
      if (classifyAccountName(name) === wantCategory) {
        return preferredId;
      }
      logger.error(
        { companyId, method, preferredId, accountName: name, wantCategory },
        "[ingestModulePayment] SAFEGUARD: accounting_settings default account tidak cocok kategori metode pembayaran — mengabaikan setting ini dan mencari akun yang benar",
      );
    }
    if (fallbackId) {
      const name = await getAccountName(fallbackId);
      if (classifyAccountName(name) === wantCategory) {
        return fallbackId;
      }
    }
  }

  // Fallback: cari di COA, HARUS cocok kategori (kas untuk isCash, bank untuk non-cash).
  // Tidak ada lagi fallback lintas-kategori — lebih baik gagal eksplisit daripada
  // salah posting (mis. transfer bank tercatat ke akun Kas).
  const accRes = await db.execute(sql`
    SELECT id, name FROM chart_of_accounts
    WHERE (company_id = ${companyId} OR company_id IS NULL)
      AND type = 'asset'
      AND is_active = true
      AND ${wantCategory === "kas" ? sql`lower(name) LIKE '%kas%'` : sql`lower(name) LIKE '%bank%'`}
    ORDER BY company_id DESC NULLS LAST, code ASC
    LIMIT 1
  `);
  if (accRes.rows.length > 0) {
    return Number((accRes.rows[0] as Record<string, unknown>)["id"]);
  }

  logger.error(
    { companyId, method, wantCategory },
    "[ingestModulePayment] SAFEGUARD: tidak ditemukan akun kategori yang sesuai untuk metode pembayaran ini — posting dibatalkan untuk mencegah salah klasifikasi",
  );
  return null;
}

async function generatePaymentNumber(companyId: number): Promise<string> {
  const year = new Date().getFullYear();
  const cntRes = await db.execute(sql`
    SELECT CAST(COUNT(*) AS int) AS cnt FROM accounting_payments WHERE company_id = ${companyId}
  `);
  const cnt = Number((cntRes.rows[0] as Record<string, unknown>)?.["cnt"] ?? 0);
  return `PAY/${year}/${String(cnt + 1).padStart(5, "0")}`;
}

function sourceLabel(moduleType: ModuleType): string {
  switch (moduleType) {
    case "sport_center": return "sport_center_booking";
    case "tenant": return "sales_payment";
    case "logistics": return "sales_payment";
  }
}

async function updatePostingStatus(
  moduleType: ModuleType,
  sourceDocId: number,
  accountingPaymentId: number,
  status: "posted" | "error",
  postingError: string | null = null,
): Promise<void> {
  try {
    if (moduleType === "sport_center") {
      await db.execute(sql`
        UPDATE sport_payments
        SET posting_status = ${status},
            accounting_payment_id = ${accountingPaymentId},
            posting_error = ${postingError},
            updated_at = NOW()
        WHERE id = ${sourceDocId}
      `);
    } else if (moduleType === "tenant") {
      await db.execute(sql`
        UPDATE tenant_payments
        SET posting_status = ${status},
            accounting_payment_id = ${accountingPaymentId},
            posting_error = ${postingError},
            updated_at = NOW()
        WHERE id = ${sourceDocId}
      `);
    } else if (moduleType === "logistics") {
      await db.execute(sql`
        UPDATE logistics_payments
        SET posting_status = ${status},
            accounting_payment_id = ${accountingPaymentId},
            posting_error = ${postingError},
            updated_at = NOW()
        WHERE id = ${sourceDocId}
      `);
    }
  } catch (err) {
    logger.warn({ err, moduleType, sourceDocId }, "[ingestModulePayment] updatePostingStatus failed (non-fatal)");
  }
}

export async function ingestModulePayment(input: IngestModulePaymentInput): Promise<IngestResult> {
  const { moduleType, sourceDocId, companyId, amount, partnerName, date, ref, description, actorId } = input;
  const method = normalizePaymentMethod(input.method) ?? "cash";

  try {
    if (moduleType === "sport_center") {
      const existingSportPayment = await findExistingPostedSportPayment(sourceDocId, amount);
      if (existingSportPayment) {
        logger.info(
          {
            moduleType,
            sourceDocId,
            accountingPaymentId: existingSportPayment.accountingPaymentId,
            accountingEntryId: existingSportPayment.accountingEntryId,
          },
          "[ingestModulePayment] existing canonical accounting recovered — no INSERT",
        );
        return {
          ok: true,
          alreadyPosted: true,
          accountingPaymentId: existingSportPayment.accountingPaymentId ?? undefined,
          accountingEntryId: existingSportPayment.accountingEntryId ?? undefined,
        };
      }
    } else {
      const existing = await db.execute(sql`
        SELECT id FROM accounting_payments
        WHERE source_type = ${moduleType}
          AND source_doc_id = ${sourceDocId}
        LIMIT 1
      `);
      if (existing.rows.length === 0) {
        // Continue into the normal posting flow.
      } else {
      return {
        ok: true,
        alreadyPosted: true,
        accountingPaymentId: Number((existing.rows[0] as Record<string, unknown>)["id"]),
      };
      }
    }

    const journalId = await resolveJournal(companyId, method);
    if (!journalId) {
      logger.warn({ moduleType, sourceDocId, companyId }, "[ingestModulePayment] No journal found — skipping");
      return { ok: false, error: "Tidak ada journal kas/bank yang dikonfigurasi untuk perusahaan ini" };
    }

    const paymentNumber = await generatePaymentNumber(companyId);
    const amountStr = String(Math.round(amount * 100) / 100);

    const insertRes = await db.execute(sql`
      INSERT INTO accounting_payments
        (company_id, payment_number, payment_type, status, amount, journal_id,
         partner_name, date, ref, memo, payment_method, source_type, source_doc_id, created_by_id, created_at)
      VALUES
        (${companyId}, ${paymentNumber}, 'inbound', 'posted', ${amountStr}, ${journalId},
         ${partnerName ?? null}, ${date}::date, ${ref ?? null},
         ${description ?? `Pembayaran ${moduleType.replace("_", " ")}`},
         ${method},
         ${moduleType}, ${sourceDocId}, ${actorId ?? null}, NOW())
      RETURNING id
    `);
    const accountingPaymentId = Number((insertRes.rows[0] as Record<string, unknown>)["id"]);

    let accountingEntryId: number | undefined;
    let recoveredExisting = false;

    // Resolve bank/cash account BEFORE entering the non-fatal try block so that
    // a null result (misconfigured accounting_settings + no COA fallback) surfaces
    // as an explicit ok:false instead of silently falling through to ok:true.
    const bankAccountId = await resolveBankAccount(companyId, method);
    if (!bankAccountId) {
      const error =
        "Akun kas/bank tidak ditemukan atau salah konfigurasi — pastikan default_bank_account_id / default_cash_account_id dikonfigurasi dengan benar di pengaturan akuntansi";
      await updatePostingStatus(moduleType, sourceDocId, accountingPaymentId, "error", error);
      return {
        ok: false,
        accountingPaymentId,
        error,
      };
    }

    try {
      const revenueAccountId = await resolveRevenueAccount(companyId);

      if (!revenueAccountId) {
        throw new Error("Akun pendapatan belum dikonfigurasi untuk perusahaan ini");
      }

      if (bankAccountId && revenueAccountId) {
        // Idempoten: cek apakah sudah ada JNL entry dengan ref yang sama (mencegah duplikasi lintas jalur)
        const existingEntryRef = ref ?? paymentNumber;
        const existingEntryRes = await db.execute(sql`
          SELECT id FROM accounting_entries
          WHERE company_id = ${companyId}
            AND source = ${sourceLabel(moduleType)}
            AND ref = ${existingEntryRef}
          LIMIT 1
        `);
        if (existingEntryRes.rows.length > 0) {
          accountingEntryId = Number((existingEntryRes.rows[0] as Record<string, unknown>)["id"]);
          await db.execute(sql`UPDATE accounting_payments SET entry_id = ${accountingEntryId} WHERE id = ${accountingPaymentId}`).catch(() => {});
          logger.info({ moduleType, sourceDocId, existingEntryRef, accountingEntryId }, "[ingestModulePayment] JNL entry sudah ada (by ref) — skip duplikasi, link ke payment");
        } else {
          // Tahap 3 (Canonical Posting Engine): dulu ini adalah raw SQL
          // `INSERT INTO accounting_entries` yang bypass idempotency check,
          // period-lock check, dan balance validation di `_postEntryCore`.
          // Sekarang lewat satu pintu masuk kanonik — lihat
          // docs/canonical-posting-engine/01-dependency-map.md §2c.
          const postResult = await getPostingEngine().post({
            journalId,
            journalCode: "JNL",
            date: new Date(`${date}T00:00:00`),
            ref: existingEntryRef,
            description: description ?? `Pembayaran ${moduleType.replace("_", " ")}`,
            source: sourceLabel(moduleType) as "sport_center_booking" | "sales_payment",
            sourceId: sourceDocId,
            companyId,
              createdById: actorId ?? null,
              paymentMethod: method,
            lines: [
              { accountId: bankAccountId, debit: Number(amountStr), credit: 0, description: description ?? "Penerimaan kas/bank" },
              { accountId: revenueAccountId, debit: 0, credit: Number(amountStr), description: description ?? "Pendapatan modul" },
            ],
          });

          if (!postResult.ok) {
            if (moduleType === "sport_center" && isUniqueSourcePaymentError(postResult.error)) {
              const recovered = await findExistingPostedSportPayment(sourceDocId, amount);
              if (recovered) {
                accountingEntryId = recovered.accountingEntryId ?? undefined;
                await db.execute(sql`
                  UPDATE accounting_payments
                  SET entry_id = ${accountingEntryId}
                  WHERE id = ${accountingPaymentId}
                `);
                recoveredExisting = true;
                logger.info(
                  { moduleType, sourceDocId, accountingEntryId },
                  "[ingestModulePayment] unique source_payment_id race recovered idempotently",
                );
              } else {
                throw new Error(
                  `Posting jurnal gagal: ${postResult.error} (${postResult.errorCode})`,
                );
              }
            } else {
              // Eksplisit: kegagalan jurnal tetap terlihat oleh caller dan
              // dapat di-retry/investigasi, bukan silently lost.
              throw new Error(`Posting jurnal gagal: ${postResult.error} (${postResult.errorCode})`);
            }
          } else {
            accountingEntryId = postResult.entryId;
          }
          await db.execute(sql`
            UPDATE accounting_payments SET entry_id = ${accountingEntryId} WHERE id = ${accountingPaymentId}
          `);
        } // end else (buat JNL baru)
      }
    } catch (entryErr) {
      logger.warn({ entryErr, moduleType, sourceDocId }, "[ingestModulePayment] accounting_entry creation failed (non-fatal, payment still recorded)");
      const error = entryErr instanceof Error ? entryErr.message : String(entryErr);
      await updatePostingStatus(moduleType, sourceDocId, accountingPaymentId, "error", error);
      return { ok: false, accountingPaymentId, error };
    }

    await updatePostingStatus(moduleType, sourceDocId, accountingPaymentId, "posted", null);

    logger.info({ moduleType, sourceDocId, accountingPaymentId, accountingEntryId, amount }, "[ingestModulePayment] posted OK");
    return {
      ok: true,
      accountingPaymentId,
      accountingEntryId,
      alreadyPosted: recoveredExisting,
    };
  } catch (err) {
    logger.error({ err, moduleType, sourceDocId }, "[ingestModulePayment] failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface BulkFailedRow {
  sourceDocId: number;
  companyId: number;
  error: string;
}

export interface BulkIngestResult {
  total: number;
  posted: number;
  skipped: number;
  errors: number;
  failedRows: BulkFailedRow[];
}

/**
 * Bulk ingest — posts all unposted paid payments for a given module.
 * Returns summary counts plus a failedRows list so callers can surface
 * exactly which source rows failed and why without digging through server logs.
 */
export async function bulkIngestModule(
  moduleType: ModuleType,
  companyId: number | null,
): Promise<BulkIngestResult> {
  let rows: Array<Record<string, unknown>> = [];

  if (moduleType === "sport_center") {
    const res = await db.execute(sql`
      SELECT sp.id, sp.company_id, sp.amount, sp.method, sp.paid_at, sp.payment_number,
             sb.customer_name, sb.booking_number
      FROM sport_payments sp
      LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
      WHERE sp.status = 'paid'
        AND (${companyId}::int IS NULL OR sp.company_id = ${companyId})
        AND (sp.posting_status IS NULL OR sp.posting_status = 'unposted')
        AND NOT EXISTS (
          SELECT 1 FROM accounting_payments ap
          WHERE ap.source_type = 'sport_center' AND ap.source_doc_id = sp.id
        )
      ORDER BY sp.id
    `);
    rows = res.rows as Array<Record<string, unknown>>;
  } else if (moduleType === "tenant") {
    const res = await db.execute(sql`
      SELECT tp.id, tp.company_id, tp.amount, tp.method, tp.paid_at, tp.payment_number,
             t.business_name AS customer_name
      FROM tenant_payments tp
      LEFT JOIN tenants t ON t.id = tp.tenant_id
      WHERE tp.status = 'paid'
        AND (${companyId}::int IS NULL OR tp.company_id = ${companyId})
        AND (tp.posting_status IS NULL OR tp.posting_status = 'unposted')
        AND NOT EXISTS (
          SELECT 1 FROM accounting_payments ap
          WHERE ap.source_type = 'tenant' AND ap.source_doc_id = tp.id
        )
      ORDER BY tp.id
    `);
    rows = res.rows as Array<Record<string, unknown>>;
  } else if (moduleType === "logistics") {
    const res = await db.execute(sql`
      SELECT lp.id, lp.company_id, lp.amount, lp.method, lp.paid_at, lp.payment_number,
             lp.customer_name
      FROM logistics_payments lp
      WHERE lp.status = 'paid'
        AND (${companyId}::int IS NULL OR lp.company_id = ${companyId})
        AND (lp.posting_status IS NULL OR lp.posting_status = 'unposted')
        AND NOT EXISTS (
          SELECT 1 FROM accounting_payments ap
          WHERE ap.source_type = 'logistics' AND ap.source_doc_id = lp.id
        )
      ORDER BY lp.id
    `);
    rows = res.rows as Array<Record<string, unknown>>;
  }

  let posted = 0, skipped = 0, errors = 0;
  const failedRows: BulkFailedRow[] = [];

  for (const row of rows) {
    if (moduleType === "sport_center" && !row["customer_name"]) {
      logger.warn({
        msg: "sport_center payment has no customer_name — booking may be deleted or orphaned",
        sport_payment_id: row["id"],
        company_id: row["company_id"],
      });
    }
    if (moduleType === "tenant" && !row["customer_name"]) {
      logger.warn({
        msg: "tenant payment has no business_name — tenant may be deleted or never existed",
        tenant_payment_id: row["id"],
        company_id: row["company_id"],
      });
    }
    const rowSourceDocId = Number(row["id"]);
    const rowCompanyId = Number(row["company_id"] ?? companyId ?? 1);
    const result = await ingestModulePayment({
      moduleType,
      sourceDocId: rowSourceDocId,
      companyId: rowCompanyId,
      amount: Number(row["amount"] ?? 0),
       method: normalizePaymentMethod(String(row["method"] ?? "cash")) ?? "cash",
      partnerName: String(row["customer_name"] ?? row["business_name"] ?? ""),
      date: row["paid_at"] ? String(row["paid_at"]).slice(0, 10) : new Date().toISOString().slice(0, 10),
      ref: String(row["payment_number"] ?? row["id"]),
      actorId: "SYSTEM",
    });
    if (result.alreadyPosted) {
      skipped++;
    } else if (result.ok) {
      posted++;
    } else {
      errors++;
      failedRows.push({
        sourceDocId: rowSourceDocId,
        companyId: rowCompanyId,
        error: result.error ?? "Unknown error",
      });
    }
  }

  return { total: rows.length, posted, skipped, errors, failedRows };
}
