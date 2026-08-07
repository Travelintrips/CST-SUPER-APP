import {
  db,
  accountingEntriesTable,
  accountingEntryLinesTable,
  accountingTaxesTable,
  accountingPostingErrorsTable,
  chartOfAccountsTable,
  costCentersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
type EntryLine = typeof accountingEntryLinesTable.$inferSelect;
import { ensureAccountingSettings, applyAccountingEnumPatches } from "./accountingSeed.js";
import { logger } from "./logger.js";
import { validateMultiCurrencyBalance } from "./currencyTolerance.js";

/**
 * Generate SHA-256 audit hash dari ledger snapshot rows.
 * Hash mencakup: companyId + period + sorted account balances.
 * Digunakan sebagai audit trail fingerprint saat period closing.
 */
export function generateSnapshotHash(
  snapRows: LedgerSnapshotRow[],
  companyId: number,
  period: string,
): string {
  const sorted = [...snapRows].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const payload = JSON.stringify({
    companyId,
    period,
    accounts: sorted.map((r) => ({
      code:    r.accountCode,
      id:      r.accountId,
      opening: r.openingBalance,
      debit:   r.periodDebit,
      credit:  r.periodCredit,
      closing: r.closingBalance,
    })),
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Post event ke ledger_events table untuk audit trail.
 * event_type: POST | REVERSE | ADJUST | CLOSE_PERIOD
 * Fire-and-forget: error tidak melempar, hanya di-log.
 */
export async function postLedgerEvent(opts: {
  companyId:      number;
  eventType:      "POST" | "REVERSE" | "ADJUST" | "CLOSE_PERIOD";
  period:         string;
  entryId?:       number | null;
  ledgerEntryId?: number | bigint | null;
  actor?:         string | null;
  payload?:       Record<string, unknown> | null;
  client?:        DbClient;
}): Promise<void> {
  const client = opts.client ?? db;
  try {
    await client.execute(sql`
      INSERT INTO ledger_events
        (company_id, event_type, period, entry_id, ledger_entry_id, actor, payload)
      VALUES
        (${opts.companyId}, ${opts.eventType}, ${opts.period},
         ${opts.entryId ?? null}, ${opts.ledgerEntryId ? String(opts.ledgerEntryId) : null},
         ${opts.actor ?? null}, ${opts.payload ? JSON.stringify(opts.payload) : null}::jsonb)
    `);
  } catch (err) {
    logger.warn({ err, eventType: opts.eventType, period: opts.period }, "[ledgerEvent] non-fatal");
  }
}

export interface PostingLine {
  accountId: number;
  debit: number;
  credit: number;
  description?: string | null;
  /** ISO-4217 currency code. Null/undefined = base currency (IDR). */
  currency?: string | null;
  /** Rate dari foreign currency ke IDR. Null/undefined = 1.0 (same as IDR). */
  exchangeRate?: number | null;
}

export interface PostingInput {
  journalId: number;
  date: Date;
  ref?: string | null;
  description?: string | null;
  source?:
    | "manual"
    | "sales_invoice"
    | "purchase_bill"
    | "sales_payment"
    | "purchase_payment"
    | "ecommerce_order"
    | "stock_received"
    | "manual_payment"
    | "cogs_delivery"
    | "purchase_return"
    | "sales_return"
    | "opname_adjust"
    | "damage_adjust"
    | "grn_receipt"
    | "reversal"
    | "wh_transfer"
    | "sport_center_booking"
    | "sport_center_booking_reversal"
    | "sport_center_booking_refund"
    | "sport_center_refund"
    | "sport_center_membership"
    | "sport_center_operational_expense"
    | "sport_center_qris_mdr"
    | "logistic_vendor_cost"
    | "tenant_rent_payment"
    | "bank_mutation_import"
    | "bank_reconciliation"
    | "bank_reconciliation_void"
    | "closing_entry"
    | "gsheet_import"
    | "fleet_cash_payment"
    | "kasbon"
    | "payroll"
    | "hrd_salary_payment"
    | "sport_center_ppn_correction"
    | "sport_center_amount_correction";
  /** Sub-module identifier stored to source_module column (e.g. "allocation_engine", "advance_disbursement"). */
  sourceModule?: string | null;
  sourceId?: number | null;
  createdById?: string | null;
  companyId?: number | null;
  costCenterId?: number | null;
  /** Sport Center: links entry ke fasilitas spesifik */
  facilityId?: number | null;
  /** Kategori expense hasil classifyExpense() */
  expenseCategory?: string | null;
  lines: PostingLine[];
}

/**
 * Resolve akun Pendapatan Sewa Tenant (4-1021) dari settings lalu fallback ke COA lookup.
 * Urutan: settings.tenantRentIncomeAccountId → COA LIKE '4-1021%' → fallbackId.
 */
async function resolveTenantRentIncomeAccountId(
  companyId: number | null | undefined,
  fallbackId: number | null | undefined,
  settingsOverride?: number | null,
): Promise<number | null> {
  if (settingsOverride) return settingsOverride;
  const cFilter = companyId ?? 1;
  let [row] = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(sql`${chartOfAccountsTable.code} LIKE '4-1021%' AND ${chartOfAccountsTable.companyId} = ${cFilter}`)
    .limit(1);
  if (!row) {
    [row] = await db
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} LIKE '4-1021%' AND ${chartOfAccountsTable.companyId} IS NOT NULL`)
      .limit(1);
  }
  return row?.id ?? fallbackId ?? null;
}

/**
 * Resolve akun pendapatan Sport Center booking (4-1017) dari COA.
 * Fallback ke salesIncomeAccountId jika belum di-seed.
 *
 * B1 FIX: menerima optional `client` agar lookup memakai transaction context
 * yang sama dengan caller — backward-compatible (caller lama tidak perlu berubah).
 */
export async function resolveSportCenterBookingAccountId(
  companyId: number | null | undefined,
  fallbackId: number | null | undefined,
  client?: DbClient,
): Promise<number | null> {
  const q = client ?? db;
  const cFilter = companyId ?? 1;
  // Akun disimpan dengan suffix abbr perusahaan: "4-1017-CST", "4-1017-WS", dst.
  // Gunakan LIKE '4-1017%' agar cocok dengan format kode yang sebenarnya.
  let [row] = await q
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(sql`${chartOfAccountsTable.code} LIKE '4-1017%' AND ${chartOfAccountsTable.companyId} = ${cFilter}`)
    .limit(1);
  if (!row) {
    [row] = await q
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} LIKE '4-1017%' AND ${chartOfAccountsTable.companyId} IS NOT NULL`)
      .limit(1);
  }
  return row?.id ?? fallbackId ?? null;
}

/**
 * Resolve cost center ID by code. Returns null if not found (backward-compat).
 *
 * B1 FIX: menerima optional `client` agar lookup memakai transaction context
 * yang sama dengan caller — backward-compatible (caller lama tidak perlu berubah).
 */
export async function resolveCostCenterId(
  code: string,
  companyId?: number | null,
  client?: DbClient,
): Promise<number | null> {
  const q = client ?? db;
  try {
    let [row] = companyId
      ? await q
          .select({ id: costCentersTable.id })
          .from(costCentersTable)
          .where(sql`${costCentersTable.code} = ${code} AND ${costCentersTable.companyId} = ${companyId}`)
          .limit(1)
      : [];
    if (!row) {
      [row] = await q
        .select({ id: costCentersTable.id })
        .from(costCentersTable)
        .where(sql`${costCentersTable.code} = ${code} AND ${costCentersTable.companyId} IS NULL`)
        .limit(1);
    }
    return row?.id ?? null;
  } catch {
    return null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Internal Drizzle client type ─────────────────────────────────────────────
// db.transaction(async tx => ...) memberikan `tx` dengan interface identik db.
// Keduanya structural-compatible dengan typeof db, sehingga bisa digunakan
// sebagai parameter bertipe DbClient tanpa memerlukan import tambahan.
export type DbClient = typeof db;

/**
 * Atomic sequence counter via UPSERT — aman terhadap race condition concurrency.
 *
 * INSERT ... ON CONFLICT DO UPDATE SET next_seq = next_seq + 1 RETURNING next_seq - 1
 * →  INSERT case: next_seq menjadi 2, RETURNING 1 (claimed = 1)
 * →  UPDATE case: next_seq naik dari N ke N+1, RETURNING N (claimed = N)
 *
 * Sebelum dipakai, pastikan `runFinancialClosingMigration` sudah seed
 * journal_sequences dari accounting_entries yang ada agar tidak tabrakan.
 */
async function _nextEntryNumber(
  client: DbClient,
  journalCode: string,
  source?: string,
  companyId?: number | null,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = (source === "manual" || !source) ? "JE" : journalCode;
  const cid = companyId ?? 0;

  try {
    const result = await client.execute(sql`
      INSERT INTO journal_sequences (journal_prefix, company_id, year, next_seq)
      VALUES (${prefix}, ${cid}, ${year}, 2)
      ON CONFLICT (journal_prefix, company_id, year)
      DO UPDATE SET next_seq = journal_sequences.next_seq + 1
      RETURNING (next_seq - 1)::int AS claimed_seq
    `);
    const row = (result as { rows: Array<Record<string, unknown>> }).rows?.[0]
      ?? (Array.isArray(result) ? (result as unknown[])[0] : null);
    const seq = Number((row as Record<string, unknown>)?.["claimed_seq"] ?? 1)
      .toString().padStart(6, "0");
    return `${prefix}/${year}/${seq}`;
  } catch (seqErr) {
    // Fallback ke MAX-based jika tabel journal_sequences belum siap (migration in progress).
    // PENTING: gunakan `db` global, BUKAN `client` — jika `client` adalah transaction
    // yang sedang abort (INSERT gagal → transaction poisoned), semua query berikutnya
    // pada `client` yang sama akan gagal dengan "current transaction is aborted".
    // `db` adalah koneksi fresh di luar transaksi sehingga SELECT-nya tetap berhasil.
    logger.warn({ seqErr, prefix, cid, year }, "_nextEntryNumber: fallback to MAX-based sequence");
    const pattern = `${prefix}/${year}/%`;
    const [{ maxSeq }] = await db
      .select({ maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(entry_number, '/', 3) AS int)), 0)` })
      .from(accountingEntriesTable)
      .where(sql`entry_number LIKE ${pattern} AND SPLIT_PART(entry_number, '/', 3) ~ '^[0-9]+$'`);
    const seq = (Number(maxSeq) + 1).toString().padStart(6, "0");
    return `${prefix}/${year}/${seq}`;
  }
}

/**
 * Core posting logic — menggunakan `client` (db global atau tx dalam transaction).
 * Jangan export langsung; gunakan `postEntry` atau `postIntercompanyPair`.
 */
async function _postEntryCore(
  client: DbClient,
  input: PostingInput,
  journalCode: string,
  initialStatus: "posted" | "draft" | "pending_approval" = "posted",
): Promise<typeof accountingEntriesTable.$inferSelect> {
  if (input.lines.length === 0) {
    throw new Error("Journal entry must have at least one line");
  }

  const source = input.source ?? "manual";
  const sourceId = input.sourceId ?? null;

  // ── Idempotency check SEBELUM generate entry number ──────────────────────────
  // Mencegah race condition: dua concurrent call keduanya generate nomor berbeda
  // tapi untuk source+sourceId yang sama → keduanya berhasil insert (duplikasi).
  // Phase 4 hardening: scope by company_id so two different companies with the
  // same source_id are NOT treated as duplicates (cross-company false conflict).
  if (source !== "manual" && sourceId !== null) {
    const companyFilter = input.companyId != null
      ? sql` AND ${accountingEntriesTable.companyId} = ${input.companyId}`
      : sql``;
    const existing = await client
      .select()
      .from(accountingEntriesTable)
      .where(
        sql`${accountingEntriesTable.source} = ${source} AND ${accountingEntriesTable.sourceId} = ${sourceId}${companyFilter}`,
      )
      .limit(1);
    if (existing[0]) {
      logger.info(`[accounting] Skipping duplicate auto-post source=${source} sourceId=${sourceId} companyId=${input.companyId}`);
      return existing[0];
    }
  }

  // ── Defense-in-depth: period lock check ──────────────────────────────────────
  // safeAccountingPost() sudah cek period lock (Step 0). Guard ini sebagai lapisan
  // kedua untuk caller yang memanggil _postEntryCore langsung (misal: closeFinancialPeriod,
  // test scripts) tanpa melalui safeAccountingPost.
  // Sumber "closing_entry" dikecualikan — closing entry dibuat sebelum period di-lock.
  const PERIOD_LOCK_EXEMPT_SOURCES = new Set([
    "closing_entry", "reversal", "bank_reconciliation_void",
  ]);
  if (input.companyId && input.date && !PERIOD_LOCK_EXEMPT_SOURCES.has(source)) {
    try {
      const d = input.date;
      const year  = d.getFullYear();
      const month = d.getMonth() + 1;
      const { rows: periodRows } = await client.execute(sql`
        SELECT is_closed, override_allowed
        FROM financial_periods
        WHERE company_id = ${input.companyId}
          AND year  = ${year}
          AND month = ${month}
        LIMIT 1
      `);
      const period = (periodRows as Array<Record<string, unknown>>)[0];
      if (period?.["is_closed"] && !period?.["override_allowed"]) {
        const periodStr = `${year}-${String(month).padStart(2, "0")}`;
        throw new Error(`PERIOD_CLOSED: Fiscal period ${periodStr} sudah ditutup. Gunakan reversal entry di period baru.`);
      }
    } catch (err) {
      // Jika error adalah period-closed (kita throw sendiri), re-throw.
      // Jika error adalah DB error (tabel belum ada dll), lanjutkan saja.
      if (err instanceof Error && err.message.startsWith("PERIOD_CLOSED:")) throw err;
      logger.warn({ err }, "[_postEntryCore] Period lock check failed (non-fatal on DB error) — proceeding");
    }
  }

  // ── Multi-currency balance validation ───────────────────────────────────────
  // Mendukung IDR, USD, EUR, dsb. Toleransi per-mata uang sesuai CURRENCY_DECIMAL_PLACES.
  // Kalau semua line tidak memiliki `currency` → diperlakukan sebagai IDR (base currency).
  const balanceResult = validateMultiCurrencyBalance(input.lines);
  if (!balanceResult.balanced) {
    throw new Error(
      `Journal entry not balanced: ${balanceResult.detail}`,
    );
  }

  const totalDebit  = round2(input.lines.reduce((s, l) => s + (l.debit  ?? 0), 0));
  const totalCredit = round2(input.lines.reduce((s, l) => s + (l.credit ?? 0), 0));

  const entryNumber = await _nextEntryNumber(client, journalCode, input.source, input.companyId);
  const dateStr = input.date.toISOString().split("T")[0]!;

  const entryValues = {
    journalId: input.journalId,
    date: dateStr,
    ref: input.ref ?? null,
    description: input.description ?? null,
    // Always insert as 'draft' first so trg_block_lines_mutation allows line inserts.
    // After lines are inserted, we'll UPDATE to initialStatus (draft→posted is allowed).
    status: "draft" as "posted",
    source,
    sourceId,
    sourceModule: input.sourceModule ?? null,
    totalDebit: String(totalDebit),
    totalCredit: String(totalCredit),
    createdById: input.createdById ?? null,
    // RC2.1 Blocker 3 — guard against missing companyId.
    // Callers MUST always pass an explicit companyId. The ?? 1 fallback is kept
    // as a last resort but triggers a warning so the missing caller can be fixed.
    companyId: (() => {
      if (input.companyId == null) {
        logger.warn({ source, sourceId }, "[_postEntryCore] companyId missing — defaulting to 1. Fix the caller to pass an explicit companyId.");
      }
      return input.companyId ?? 1;
    })(),
    costCenterId: input.costCenterId ?? null,
    facilityId: input.facilityId ?? null,
    expenseCategory: input.expenseCategory ?? null,
  };

  // Retry hingga 5x jika terjadi race condition pada entry_number
  let entry: typeof accountingEntriesTable.$inferSelect | undefined;
  let currentEntryNumber = entryNumber;
  let enumPatchedOnce = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    let inserted: (typeof accountingEntriesTable.$inferSelect)[];
    try {
      inserted = await client
        .insert(accountingEntriesTable)
        .values({ entryNumber: currentEntryNumber, ...entryValues })
        .onConflictDoNothing()
        .returning();
    } catch (insertErr: unknown) {
      // ── Extract PostgreSQL error details (safe, no credentials logged) ─────
      const cause = (insertErr as { cause?: Record<string, unknown> })?.cause ?? {};
      const pgCode    = String(cause["code"]       ?? "");
      const pgMsg     = String(cause["message"]    ?? (insertErr instanceof Error ? insertErr.message : ""));
      const pgDetail  = String(cause["detail"]     ?? "");
      const pgConstr  = String(cause["constraint"] ?? "");
      const pgColumn  = String(cause["column"]     ?? "");
      const pgTable   = String(cause["table"]      ?? "");

      // Always log full PG details (server-side only — never reaches frontend).
      logger.error({
        pgCode, pgMsg, pgDetail, pgConstr, pgColumn, pgTable,
        source, sourceId, entryNumber: currentEntryNumber,
        attempt,
      }, "_postEntryCore INSERT failed — full PG error");

      if (pgCode === "22P02" && !enumPatchedOnce) {
        // PostgreSQL 22P02 = invalid input value for enum — self-heal once.
        enumPatchedOnce = true;
        logger.warn({ source, pgCode }, "_postEntryCore: enum value missing — applying enum patches and retrying");
        await applyAccountingEnumPatches();
        inserted = await client
          .insert(accountingEntriesTable)
          .values({ entryNumber: currentEntryNumber, ...entryValues })
          .onConflictDoNothing()
          .returning();
      } else if (pgCode === "P0001" || pgMsg.includes("PERIOD_LOCKED")) {
        // DB trigger period-lock — translate to a structured, user-friendly error.
        // Extract month/year from the PG message if present.
        const periodMatch = pgMsg.match(/PERIOD_LOCKED[^:]*:\s*(.*)/);
        const periodDetail = periodMatch?.[1] ?? pgMsg;
        throw new Error(`PERIOD_CLOSED: Jurnal tidak bisa diposting karena periode keuangan sudah ditutup. ${periodDetail}`);
      } else if (pgCode === "25P02") {
        // Transaction aborted (likely from a previous failed query in the same tx).
        throw new Error("JOURNAL_TX_ABORTED: Transaksi jurnal dibatalkan karena ada operasi sebelumnya yang gagal.");
      } else if (pgCode === "23503") {
        // Foreign key violation — give structured detail.
        throw new Error(`JOURNAL_FK_VIOLATION: Referensi tidak valid pada jurnal (${pgConstr || pgColumn || "foreign key"}). Periksa akun, jurnal, dan perusahaan yang dipilih.`);
      } else if (pgCode === "23502") {
        // Not-null violation.
        throw new Error(`JOURNAL_NULL_VIOLATION: Kolom wajib tidak terisi pada insert jurnal (${pgColumn}). Periksa konfigurasi akuntansi.`);
      } else {
        throw insertErr;
      }
    }
    entry = inserted[0];
    if (entry) break;

    // Conflict terjadi (entry_number duplikat ATAU unique constraint source+source_id).
    // Cek apakah entry untuk source+sourceId ini sudah ada (mungkin dari concurrent call).
    // Phase 4: scope by company_id to avoid false cross-company conflict returns.
    if (source !== "manual" && sourceId !== null) {
      const companyFilter = input.companyId != null
        ? sql` AND ${accountingEntriesTable.companyId} = ${input.companyId}`
        : sql``;
      const [existing] = await client
        .select()
        .from(accountingEntriesTable)
        .where(
          sql`${accountingEntriesTable.source} = ${source} AND ${accountingEntriesTable.sourceId} = ${sourceId}${companyFilter}`,
        )
        .limit(1);
      if (existing) {
        logger.info(`[accounting] Entry already inserted by concurrent call source=${source} sourceId=${sourceId} companyId=${input.companyId}`);
        return existing;
      }
    }

    if (attempt < 4) {
      currentEntryNumber = await _nextEntryNumber(
        client,
        journalCode,
        input.source,
        input.companyId,
      );
      logger.warn({ attempt: attempt + 1, newNum: currentEntryNumber }, "postEntry: entry_number conflict, retrying with new number");
    }
  }

  if (!entry) {
    throw new Error(`Failed to create journal entry after retries (last tried: ${currentEntryNumber})`);
  }

  await client.insert(accountingEntryLinesTable).values(
    input.lines.map((l) => ({
      entryId: entry!.id,
      accountId: l.accountId,
      description: l.description ?? null,
      debit: String(round2(Number(l.debit) || 0)),
      credit: String(round2(Number(l.credit) || 0)),
    })),
  );

  // Promote entry from 'draft' to target status now that lines are safely inserted.
  // trg_block_posted_entry_update allows draft→posted/pending_approval transitions.
  if (initialStatus !== "draft") {
    await client
      .update(accountingEntriesTable)
      .set({ status: initialStatus as "posted" })
      .where(eq(accountingEntriesTable.id, entry!.id));
    entry = { ...entry!, status: initialStatus as "posted" };
  }

  // Emit POST ledger event (fire-and-forget — intentionally uses global `db`,
  // NOT the caller's transaction client). Passing the tx client here would
  // abort the whole transaction if ledger_events INSERT fails (PG 25P02).
  // Audit events are non-critical; they must never poison the main tx.
  const entryPeriod = input.date.toISOString().slice(0, 7);
  const eventType = (source === "reversal") ? "REVERSE" : "POST";
  await postLedgerEvent({
    companyId:  Number(input.companyId ?? 1),
    eventType,
    period:     entryPeriod,
    entryId:    entry!.id,
    actor:      input.createdById ?? null,
    payload: {
      entryNumber: entry!.entryNumber,
      source,
      sourceId,
      totalDebit:  Number(entry!.totalDebit),
      totalCredit: Number(entry!.totalCredit),
    },
    // client intentionally omitted → uses global db, never poisons caller's tx
  });

  // ── Rule 6: Compute + persist checksum_hash + previous_entry_id ─────────
  // Non-blocking UPDATE — tidak memblok return, non-fatal jika gagal.
  const previousEntryId = (source === "reversal" && typeof sourceId === "number") ? sourceId : null;
  const checksumPayload = JSON.stringify({
    entryNumber: entry.entryNumber,
    source,
    sourceId,
    totalDebit,
    totalCredit,
    companyId: Number(input.companyId ?? 1),
    date: dateStr,
  });
  const checksumHash = createHash("sha256").update(checksumPayload).digest("hex");
  void db.execute(sql`
    UPDATE accounting_entries
    SET checksum_hash     = ${checksumHash},
        previous_entry_id = ${previousEntryId}
    WHERE id = ${entry!.id}
  `).catch(() => {});

  // ── Rule 3: Write to outbox (non-blocking) ───────────────────────────────
  void (import("./accounting/outboxProcessor.js") as unknown as Promise<{ writeToOutbox: (p: Record<string, unknown>) => Promise<void> }>)
    .then(({ writeToOutbox }) => writeToOutbox({
      eventType:  source === "reversal" ? "JOURNAL_VOIDED" : "JOURNAL_CREATED",
      entryId:    entry!.id,
      sourceType: source,
      sourceId:   sourceId != null ? String(sourceId) : null,
      amount:     totalDebit,
      actor:      input.createdById ?? null,
      companyId:  input.companyId ?? null,
    })).catch(() => {});

  // ── Rule 4: Event-driven spot check (non-blocking) ───────────────────────
  void (import("./jobs/ledgerConsistencyCheck.js") as Promise<{ scheduleSpotCheck: (id: number) => void }>)
    .then(({ scheduleSpotCheck }) => scheduleSpotCheck(entry!.id))
    .catch(() => {});

  return entry;
}

/**
 * Canonical Posting Engine (Tahap 3) — expose `_postEntryCore` publicly so that
 * `CanonicalPostingEngine` (lib/posting-engine/) can run it INSIDE a
 * `db.transaction()` it controls, alongside tax-line inserts, so journal +
 * pajak commit/rollback atomically. Do not call this directly from route
 * handlers — use `getPostingEngine().post()` instead. Existing callers of
 * `postEntry()` / `createDraftEntry()` / `postIntercompanyPair()` are
 * unaffected; this is a pure additive export around the same core logic.
 */
export async function postEntryWithClient(
  client: DbClient,
  input: PostingInput,
  journalCode: string,
  initialStatus: "posted" | "draft" | "pending_approval" = "posted",
): Promise<typeof accountingEntriesTable.$inferSelect> {
  return _postEntryCore(client, input, journalCode, initialStatus);
}

/**
 * Create a DRAFT journal entry for governance review.
 * Does NOT post or auto-lock — entry must go through DRAFT → PENDING_APPROVAL → APPROVED → POSTED.
 * For manual journal creation via the governance posting path.
 */
export async function createDraftEntry(
  input: PostingInput,
  journalCode: string,
): Promise<typeof accountingEntriesTable.$inferSelect> {
  return _postEntryCore(db, input, journalCode, "draft");
}

/** Create and post a balanced journal entry. Throws if not balanced. */
// Manual sources that MUST go through governance workflow (DRAFT → PENDING_APPROVAL → APPROVED → POSTED).
// Direct postEntry calls for these sources bypass the approval workflow and trigger HIGH-severity audit events.
const GOVERNANCE_MANUAL_SOURCES = new Set(["manual", "manual_payment", "manual_bank", "manual_cash", "manual_journal"]);
// Sources exempt from governance warning — these are system-generated or guard-validated
// FIX: tambahkan "closing_entry" dan "governance_approval" agar tidak men-trigger
// false-positive DIRECT_POST_BYPASS warning saat period closing atau approval flow.
const GOVERNANCE_EXEMPT_SOURCES = new Set([
  "reversal",
  "bank_reconciliation",
  "bank_reconciliation_void",
  "closing_entry",       // digunakan oleh closeFinancialPeriod()
  "governance_approval", // digunakan oleh financeGovernance approve route
]);

export async function postEntry(
  input: PostingInput,
  journalCode: string,
): Promise<typeof accountingEntriesTable.$inferSelect> {
  // ── GOVERNANCE INTERCEPT: detect direct-post bypass for manual sources ───
  // Direct callers of postEntry for manual sources bypass the approval workflow.
  // Log HIGH-severity event to integrity_audit_queue and sap_audit_trail so
  // compliance teams can investigate. The entry still posts (backward compat for
  // existing payment/adjustment flows) but the bypass is fully escalated.
  if (GOVERNANCE_MANUAL_SOURCES.has(input.source ?? "") && !GOVERNANCE_EXEMPT_SOURCES.has(input.source ?? "")) {
    Promise.all([
      import("./errorContainment.js").then(({ queueIntegrityError }) =>
        queueIntegrityError({
          companyId: input.companyId ?? 1,
          classification: "HIGH",
          module: "accounting_governance",
          errorCode: "DIRECT_POST_BYPASS",
          message: `Manual source '${input.source}' called postEntry directly, bypassing governance draft→approval workflow. Route: use safeAccountingPost or createDraftEntry.`,
          context: { source: input.source, journalCode, createdById: input.createdById ?? "SYSTEM" },
          entityType: "accounting_entry",
          entityId: null,
        }).catch(() => {})),
    ]).catch(() => {});
  }

  const entry = await _postEntryCore(db, input, journalCode);

  // ── SAP HARDENING FASE 1: Auto-lock entry setelah berhasil di-POST ──────
  // Fire-and-forget — tidak boleh melempar exception ke caller.
  import("./ledgerImmutability.js").then(({ lockAccountingEntry }) => {
    lockAccountingEntry(entry.id, input.createdById ?? "SYSTEM").catch(() => {});
  }).catch(() => {});

  return entry;
}

/**
 * Post source + mirror entry ATOMICALLY dalam satu DB transaction.
 *
 * Jaminan: kalau salah satu gagal (termasuk period lock trigger), keduanya
 * di-rollback penuh — tidak ada orphan journal.
 *
 * @returns sourceEntry dan mirrorEntry yang sudah ter-commit.
 */
export async function postIntercompanyPair(opts: {
  sourceInput: PostingInput;
  mirrorInput: PostingInput;
  sourceJournalCode: string;
  mirrorJournalCode: string;
  /**
   * Callback yang dijalankan di dalam transaksi yang sama setelah kedua jurnal
   * berhasil dibuat. Gunakan untuk menyimpan link subledger dan state sumber.
   */
  afterPost?: (tx: any, entries: {
    sourceEntry: typeof accountingEntriesTable.$inferSelect;
    mirrorEntry: typeof accountingEntriesTable.$inferSelect;
  }) => Promise<unknown>;
}): Promise<{
  sourceEntry: typeof accountingEntriesTable.$inferSelect;
  mirrorEntry: typeof accountingEntriesTable.$inferSelect;
  afterPostResult?: unknown;
}> {
  return db.transaction(async (tx: any) => {
    const sourceEntry = await _postEntryCore(tx as unknown as DbClient, opts.sourceInput, opts.sourceJournalCode);
    const mirrorEntry = await _postEntryCore(tx as unknown as DbClient, opts.mirrorInput, opts.mirrorJournalCode);
    const afterPostResult = opts.afterPost
      ? await opts.afterPost(tx as unknown as DbClient, { sourceEntry, mirrorEntry })
      : undefined;
    return { sourceEntry, mirrorEntry, afterPostResult };
  });
}

// ─── Financial Closing Engine ─────────────────────────────────────────────────

export interface LedgerSnapshotRow {
  accountId:      number;
  accountCode:    string;
  accountName:    string;
  accountType:    string | null;
  openingBalance: number;
  periodDebit:    number;
  periodCredit:   number;
  closingBalance: number;
  entryCount:     number;
}

export interface ClosingResult {
  closingId:     number;
  period:        string;
  snapshotCount: number;
  netIncome:     number;
  closingEntryId: number | null;
}

/**
 * Buat ledger snapshot untuk semua akun pada periode tertentu.
 * Dipanggil oleh closeFinancialPeriod — bisa juga dipanggil mandiri untuk preview.
 *
 * SOURCE OF TRUTH: fleet_ledger_entries (bukan accounting_entry_lines).
 * Ini menghapus dual-computation yang sebelumnya terjadi antara journal layer dan ledger layer.
 *
 * Opening balance diambil dari snapshot periode sebelumnya (jika ada).
 * Closing balance = opening + period_debit - period_credit (raw debit-side).
 */
export async function createLedgerSnapshot(opts: {
  companyId: number;
  period:    string;  // 'YYYY-MM'
  closingId?: number | null;
  client?:   DbClient;
}): Promise<LedgerSnapshotRow[]> {
  const client    = opts.client ?? db;
  const cid       = opts.companyId;
  const period    = opts.period;
  const [yearStr, monthStr] = period.split("-");
  const year  = Number(yearStr);
  const month = Number(monthStr);

  // Periode sebelumnya untuk opening balance
  const prevDate    = new Date(year, month - 1, 0);  // last day of previous month
  const prevPeriod  = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // ── 1. Activity dari fleet_ledger_entries (SINGLE SOURCE OF TRUTH) ─────────
  // Tidak lagi menggunakan accounting_entry_lines/accounting_entries.
  // fleet_ledger_entries adalah satu-satunya sumber kebenaran finansial.
  const activityRows = await client.execute(sql`
    SELECT
      fle.account_id,
      fle.account_code,
      fle.account_name,
      fle.account_type,
      COALESCE(SUM(fle.debit),  0)::numeric(14,2) AS period_debit,
      COALESCE(SUM(fle.credit), 0)::numeric(14,2) AS period_credit,
      COUNT(fle.id)::int                          AS entry_count
    FROM fleet_ledger_entries fle
    WHERE fle.company_id = ${cid}
      AND fle.period     = ${period}
      AND fle.is_voided  = false
    GROUP BY fle.account_id, fle.account_code, fle.account_name, fle.account_type
    ORDER BY fle.account_code
  `);

  type ActivityRow = {
    account_id:   string | number;
    account_code: string;
    account_name: string;
    account_type: string | null;
    period_debit: string | number;
    period_credit: string | number;
    entry_count:  string | number;
  };
  const activities: ActivityRow[] = (activityRows as unknown as { rows: ActivityRow[] }).rows
    ?? (activityRows as unknown as ActivityRow[]);

  if (activities.length === 0) return [];

  // ── 2. Opening balance dari snapshot periode sebelumnya ────────────────────
  const prevSnapRows = await client.execute(sql`
    SELECT account_id, closing_balance
    FROM ledger_snapshots
    WHERE company_id = ${cid} AND period = ${prevPeriod}
  `);
  type PrevSnap = { account_id: string | number; closing_balance: string | number };
  const prevSnaps: PrevSnap[] = (prevSnapRows as unknown as { rows: PrevSnap[] }).rows
    ?? (prevSnapRows as unknown as PrevSnap[]);
  const prevMap = new Map<number, number>(
    prevSnaps.map((r) => [Number(r.account_id), Number(r.closing_balance)]),
  );

  // ── 3. Hitung closing balance dan upsert snapshot ──────────────────────────
  const rows: LedgerSnapshotRow[] = [];
  for (const row of activities) {
    const accountId      = Number(row.account_id);
    const openingBalance = prevMap.get(accountId) ?? 0;
    const periodDebit    = Number(row.period_debit);
    const periodCredit   = Number(row.period_credit);
    const closingBalance = openingBalance + periodDebit - periodCredit;
    const entryCount     = Number(row.entry_count);

    await client.execute(sql`
      INSERT INTO ledger_snapshots
        (company_id, period, account_id, account_code, account_name, account_type,
         opening_balance, period_debit, period_credit, closing_balance, entry_count,
         snapshot_at, closing_id)
      VALUES
        (${cid}, ${period}, ${accountId}, ${row.account_code}, ${row.account_name},
         ${row.account_type ?? null},
         ${openingBalance.toFixed(2)}, ${periodDebit.toFixed(2)}, ${periodCredit.toFixed(2)},
         ${closingBalance.toFixed(2)}, ${entryCount}, NOW(), ${opts.closingId ?? null})
      ON CONFLICT (company_id, period, account_id) DO UPDATE SET
        opening_balance  = EXCLUDED.opening_balance,
        period_debit     = EXCLUDED.period_debit,
        period_credit    = EXCLUDED.period_credit,
        closing_balance  = EXCLUDED.closing_balance,
        entry_count      = EXCLUDED.entry_count,
        snapshot_at      = NOW(),
        closing_id       = EXCLUDED.closing_id
    `);

    rows.push({
      accountId, openingBalance, periodDebit, periodCredit, closingBalance, entryCount,
      accountCode: row.account_code, accountName: row.account_name,
      accountType: row.account_type ?? null,
    });
  }

  return rows;
}

/**
 * Close a financial period atomically:
 *   1. Buat ledger snapshot semua akun
 *   2. (Opsional) Post closing entry ke Retained Earnings
 *   3. Lock periode di financial_periods
 *   4. Simpan status CLOSED di financial_closings
 *
 * Closing entry dibuat SEBELUM period di-lock agar trigger check_period_locked tidak memblok.
 */
export async function closeFinancialPeriod(opts: {
  companyId:                  number;
  period:                     string;   // 'YYYY-MM'
  closedBy:                   string;
  notes?:                     string;
  retainedEarningsAccountId?: number;   // jika diisi → buat closing entry
  closingJournalId?:          number;   // journal untuk closing entry
}): Promise<ClosingResult> {
  const [yearStr, monthStr] = opts.period.split("-");
  const year  = Number(yearStr);
  const month = Number(monthStr);

  return db.transaction(async (tx) => {
    // ── 0. Cek belum closed ────────────────────────────────────────────────
    const checkRows = await tx.execute(sql`
      SELECT status FROM financial_closings
      WHERE company_id = ${opts.companyId} AND period = ${opts.period}
      FOR UPDATE
    `);
    type StatusRow = { status: string };
    const existing: StatusRow | undefined = ((checkRows as unknown as { rows: StatusRow[] }).rows
      ?? (checkRows as unknown as StatusRow[]))[0];
    if (existing?.status === "CLOSED") {
      throw new Error(`ALREADY_CLOSED: Period ${opts.period} sudah ditutup.`);
    }

    // ── 1. Snapshot semua akun (sebelum lock) ─────────────────────────────
    const snapRows = await createLedgerSnapshot({
      companyId: opts.companyId,
      period:    opts.period,
      client:    tx as unknown as DbClient,
    });

    // ── 2. Hitung net income dari snapshot ────────────────────────────────
    // Revenue (code '4%'): credit-normal → net = credit - debit
    // Expense (code '5%'|'6%'): debit-normal → net = debit - credit
    let totalRevenue = 0;
    let totalExpense = 0;
    for (const r of snapRows) {
      const code = r.accountCode ?? "";
      if (code.startsWith("4")) totalRevenue += r.periodCredit - r.periodDebit;
      else if (code.startsWith("5") || code.startsWith("6")) totalExpense += r.periodDebit - r.periodCredit;
    }
    const netIncome = round2(totalRevenue - totalExpense);

    // ── 3. Closing entry ke Retained Earnings (opsional) ─────────────────
    let closingEntryId: number | null = null;
    if (
      opts.retainedEarningsAccountId &&
      opts.closingJournalId &&
      Math.abs(netIncome) > 0.01
    ) {
      const closingEntry = await _postEntryCore(tx as unknown as DbClient, {
        journalId:   opts.closingJournalId,
        date:        new Date(year, month, 0),  // last day of period
        description: `Closing entry ${opts.period} — Net income ${netIncome >= 0 ? "laba" : "rugi"} IDR ${Math.abs(netIncome).toLocaleString()}`,
        // FIX: gunakan "closing_entry" bukan "manual" agar tidak memicu
        // governance DIRECT_POST_BYPASS warning yang salah.
        source:      "closing_entry" as unknown as "manual",
        companyId:   opts.companyId,
        lines: netIncome >= 0
          ? [
              // Laba: debit semua revenue (close ke 0), credit retained earnings
              ...snapRows.filter((r) => r.accountCode.startsWith("4") && Math.abs(r.periodCredit - r.periodDebit) > 0.005).map((r) => ({
                accountId:   r.accountId,
                debit:       round2(r.periodCredit - r.periodDebit),
                credit:      0,
                description: `Close ${r.accountCode}`,
              })),
              ...snapRows.filter((r) => (r.accountCode.startsWith("5") || r.accountCode.startsWith("6")) && Math.abs(r.periodDebit - r.periodCredit) > 0.005).map((r) => ({
                accountId: r.accountId,
                debit:     0,
                credit:    round2(r.periodDebit - r.periodCredit),
                description: `Close ${r.accountCode}`,
              })),
              {
                accountId:   opts.retainedEarningsAccountId,
                debit:       0,
                credit:      netIncome,
                description: "Net income → Retained Earnings",
              },
            ]
          : [
              // Rugi: debit retained earnings, credit semua expense (close ke 0)
              ...snapRows.filter((r) => r.accountCode.startsWith("4") && Math.abs(r.periodCredit - r.periodDebit) > 0.005).map((r) => ({
                accountId:   r.accountId,
                debit:       round2(r.periodCredit - r.periodDebit),
                credit:      0,
                description: `Close ${r.accountCode}`,
              })),
              ...snapRows.filter((r) => (r.accountCode.startsWith("5") || r.accountCode.startsWith("6")) && Math.abs(r.periodDebit - r.periodCredit) > 0.005).map((r) => ({
                accountId: r.accountId,
                debit:     0,
                credit:    round2(r.periodDebit - r.periodCredit),
                description: `Close ${r.accountCode}`,
              })),
              {
                accountId:   opts.retainedEarningsAccountId,
                debit:       Math.abs(netIncome),
                credit:      0,
                description: "Net loss → Retained Earnings",
              },
            ],
      }, "GEN");
      closingEntryId = closingEntry.id;
    }

    // ── 4. Lock periode (SETELAH closing entry agar trigger tidak memblok) ─
    await tx.execute(sql`
      INSERT INTO financial_periods (company_id, month, year, is_closed, closed_at, closed_by)
      VALUES (${opts.companyId}, ${month}, ${year}, TRUE, NOW(), ${opts.closedBy})
      ON CONFLICT (company_id, month, year) DO UPDATE SET
        is_closed  = TRUE,
        closed_at  = NOW(),
        closed_by  = ${opts.closedBy}
    `);

    // ── 5. Simpan/update financial_closings ───────────────────────────────
    const closeRows = await tx.execute(sql`
      INSERT INTO financial_closings
        (company_id, period, status, net_income, closing_entry_id, closed_at, closed_by, notes)
      VALUES
        (${opts.companyId}, ${opts.period}, 'CLOSED', ${netIncome}, ${closingEntryId}, NOW(), ${opts.closedBy}, ${opts.notes ?? null})
      ON CONFLICT (company_id, period) DO UPDATE SET
        status           = 'CLOSED',
        net_income       = EXCLUDED.net_income,
        closing_entry_id = EXCLUDED.closing_entry_id,
        closed_at        = NOW(),
        closed_by        = EXCLUDED.closed_by,
        notes            = EXCLUDED.notes
      RETURNING id
    `);
    type IdRow = { id: string | number };
    const closingId = Number(
      ((closeRows as unknown as { rows: IdRow[] }).rows ?? (closeRows as unknown as IdRow[]))[0]?.id
    );

    // ── 6. Ambil hash periode sebelumnya (chained audit trail) ────────────────
    const prevPeriodForHash = (() => {
      const [y, m] = opts.period.split("-").map(Number);
      const d = new Date(y, m - 1, 0);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const prevHashRows = await tx.execute(sql`
      SELECT snapshot_hash FROM ledger_snapshots
      WHERE company_id = ${opts.companyId} AND period = ${prevPeriodForHash}
      LIMIT 1
    `);
    type HashRow = { snapshot_hash: string | null };
    const prevHashArr: HashRow[] = (prevHashRows as unknown as { rows: HashRow[] }).rows
      ?? (prevHashRows as unknown as HashRow[]);
    const previousSnapshotHash = prevHashArr[0]?.snapshot_hash ?? null;

    // ── 7. Hitung hash dengan chain dari hash periode sebelumnya ──────────────
    const snapshotHash = generateSnapshotHash(snapRows, opts.companyId, opts.period);
    await tx.execute(sql`
      UPDATE ledger_snapshots
      SET closing_id             = ${closingId},
          snapshot_hash          = ${snapshotHash},
          previous_snapshot_hash = ${previousSnapshotHash}
      WHERE company_id = ${opts.companyId} AND period = ${opts.period}
    `);

    // ── 8. Update period_status → 'closed' ────────────────────────────────
    await tx.execute(sql`
      UPDATE financial_periods
      SET period_status = 'closed'
      WHERE company_id = ${opts.companyId} AND month = ${month} AND year = ${year}
    `);

    // ── 9. Emit CLOSE_PERIOD ledger event ─────────────────────────────────
    // Use global db (not tx) to avoid poisoning the closing transaction if
    // ledger_events INSERT fails (PG 25P02 on next query in same tx).
    await postLedgerEvent({
      companyId: opts.companyId,
      eventType: "CLOSE_PERIOD",
      period:    opts.period,
      actor:     opts.closedBy,
      payload: {
        closingId,
        netIncome,
        snapshotHash,
        previousSnapshotHash,
        snapshotCount: snapRows.length,
        closingEntryId,
      },
      // client intentionally omitted → uses global db, never poisons closing tx
    });

    logger.info(
      { companyId: opts.companyId, period: opts.period, closingId, netIncome, snapCount: snapRows.length, snapshotHash, previousSnapshotHash },
      "[closing] Period closed successfully",
    );

    return {
      closingId,
      period:         opts.period,
      snapshotCount:  snapRows.length,
      netIncome,
      closingEntryId,
    };
  });
}

/** Compute tax amount from a tax id and net amount. Returns 0 if tax not found. */
export async function computeTaxAmount(
  taxId: number | null | undefined,
  netAmount: number,
): Promise<{ taxAmount: number; tax: typeof accountingTaxesTable.$inferSelect | null }> {
  if (!taxId) return { taxAmount: 0, tax: null };
  const [tax] = await db
    .select()
    .from(accountingTaxesTable)
    .where(eq(accountingTaxesTable.id, taxId));
  if (!tax || !tax.isActive) return { taxAmount: 0, tax: null };
  const taxAmount = round2((netAmount * Number(tax.rate)) / 100);
  return { taxAmount, tax };
}

/** Auto-post when a Sales document gets invoiced. */
export async function postSalesInvoice(args: {
  salesDocId: number;
  docNumber: string;
  customerName: string;
  netAmount: number;
  taxAmount: number;
  taxAccountId: number | null;
  createdById?: string | null;
  companyId?: number | null;
}): Promise<boolean> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? undefined);
    if (!settings.arAccountId || !settings.salesIncomeAccountId || !settings.salesJournalId) {
      logger.warn(
        { salesDocId: args.salesDocId },
        "Skipping auto-post sales invoice: accounting settings incomplete",
      );
      await recordAccountingPostingFailure({
        companyId: args.companyId,
        sourceId: args.salesDocId,
        sourceRef: args.docNumber,
        sourceModule: "sales",
        sourceTable: "sales_documents",
        errorCode: "ACCOUNTING_CONFIG_INCOMPLETE",
        errorMessage: "Accounting settings incomplete for sales invoice posting",
      });
      return false;
    }
    const grand = round2(args.netAmount + args.taxAmount);
    const lines: PostingLine[] = [
      {
        accountId: settings.arAccountId,
        debit: grand,
        credit: 0,
        description: `Piutang ${args.customerName} - ${args.docNumber}`,
      },
      {
        accountId: settings.salesIncomeAccountId,
        debit: 0,
        credit: round2(args.netAmount),
        description: `Pendapatan ${args.docNumber}`,
      },
    ];
    if (args.taxAmount > 0 && (args.taxAccountId ?? settings.ppnOutputAccountId)) {
      lines.push({
        accountId: (args.taxAccountId ?? settings.ppnOutputAccountId)!,
        debit: 0,
        credit: round2(args.taxAmount),
        description: `PPN Keluaran ${args.docNumber}`,
      });
    }
    await postEntry(
      {
        journalId: settings.salesJournalId,
        date: new Date(),
        ref: args.docNumber,
        description: `Faktur penjualan ${args.docNumber}`,
        source: "sales_invoice",
        sourceId: args.salesDocId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? null,
        lines,
      },
      "SAL",
    );
    return true;
  } catch (err) {
    logger.error({ err, salesDocId: args.salesDocId }, "Auto-post sales invoice failed");
    await recordAccountingPostingFailure({
      companyId: args.companyId,
      sourceId: args.salesDocId,
      sourceRef: args.docNumber,
      sourceModule: "sales",
      sourceTable: "sales_documents",
      errorCode: "SALES_INVOICE_POST_FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ── Logistic serviceType → COA base code mapping ────────────────────────────
const SERVICE_TYPE_COA_CODES: Record<string, string> = {
  trucking:    "4-1013",  // Pendapatan Land Freight
  sea_freight: "4-1011",  // Pendapatan Sea Freight
  air_freight: "4-1012",  // Pendapatan Air Freight
  ppjk:        "4-1014",  // Pendapatan Custom Clearance
  handling:    "4-1018",  // Pendapatan Handling Service
  document:    "4-1019",  // Pendapatan Document Service
};

/**
 * Resolve COA account id untuk service type tertentu.
 * Coba company-specific code dulu (misal "4-1011-CST"), fallback ke global, lalu ke fallbackId.
 */
async function resolveServiceTypeAccountId(
  serviceType: string | null | undefined,
  companyId: number | null | undefined,
  fallbackId: number | null | undefined,
): Promise<number | null> {
  const baseCode = serviceType ? SERVICE_TYPE_COA_CODES[serviceType.toLowerCase().trim()] : null;
  if (!baseCode) return fallbackId ?? null;

  const cFilter = companyId ?? 1;
  // Coba company-specific (code LIKE "4-1011%" + company filter)
  let [row] = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(sql`${chartOfAccountsTable.code} LIKE ${baseCode + "%"} AND ${chartOfAccountsTable.companyId} = ${cFilter}`)
    .limit(1);
  if (!row) {
    // Fallback: global atau any company
    [row] = await db
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} LIKE ${baseCode + "%"}`)
      .limit(1);
  }
  return row?.id ?? fallbackId ?? null;
}

/** Normalize shipmentType string ke service type key */
export function normalizeShipmentServiceType(shipmentType: string | null | undefined): string | null {
  if (!shipmentType) return null;
  const s = shipmentType.toLowerCase().replace(/[\s\-]/g, "_");
  if (s.includes("sea") || s.includes("laut") || s.includes("fcl") || s.includes("lcl")) return "sea_freight";
  if (s.includes("air") || s.includes("udara")) return "air_freight";
  if (s.includes("truck") || s.includes("land") || s.includes("darat")) return "trucking";
  if (s.includes("custom") || s.includes("pabean") || s.includes("ppjk") || s.includes("clearance")) return "ppjk";
  if (s.includes("handling") || s.includes("stuffing")) return "handling";
  if (s.includes("document") || s.includes("dokumen")) return "document";
  return null;
}

/**
 * Line input untuk postLogisticSalesInvoice.
 * Revenue HARUS dari priceSnapshot.subtotal atau subtotal dari order item — BUKAN priceBase.
 */
export interface LogisticInvoiceLine {
  serviceType?: string | null;
  /** Revenue amount — dari priceSnapshot.subtotal, BUKAN priceBase */
  subtotal: number;
  orderItemId?: number | null;
  vendorCatalogItemId?: number | null;
  lineName?: string | null;
}

/**
 * Post jurnal akuntansi untuk invoice logistik customer.
 *
 * Struktur:
 *   Debit:  Piutang Usaha (grand total)
 *   Credit: Revenue per serviceType (menggunakan SERVICE_TYPE_COA_CODES mapping)
 *   Credit: PPN Keluaran (jika ada tax)
 *
 * Setiap credit line menyimpan referensi: orderId, salesDocId, orderItemId, vendorCatalogItemId.
 * Revenue HARUS dari priceSnapshot, bukan priceBase.
 */
export async function postLogisticSalesInvoice(args: {
  logisticOrderId: number;
  salesDocId: number;
  docNumber: string;
  customerName: string;
  lines: LogisticInvoiceLine[];
  taxAmount: number;
  taxAccountId?: number | null;
  createdById?: string | null;
  companyId?: number | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? undefined);
    if (!settings.arAccountId || !settings.salesIncomeAccountId || !settings.salesJournalId) {
      logger.warn(
        { logisticOrderId: args.logisticOrderId },
        "Skipping logistic invoice journal: accounting settings incomplete",
      );
      return;
    }

    const netAmount = round2(args.lines.reduce((s, l) => s + l.subtotal, 0));
    const grand = round2(netAmount + args.taxAmount);

    // Agregasi revenue berdasarkan serviceType
    const revenueGroups = new Map<string | null, { subtotal: number; items: LogisticInvoiceLine[] }>();
    for (const line of args.lines) {
      const key = line.serviceType?.toLowerCase().trim() ?? null;
      const g = revenueGroups.get(key) ?? { subtotal: 0, items: [] };
      g.subtotal += line.subtotal;
      g.items.push(line);
      revenueGroups.set(key, g);
    }

    const postingLines: PostingLine[] = [];

    // Debit: Piutang Usaha (grand total termasuk PPN)
    postingLines.push({
      accountId: settings.arAccountId,
      debit: grand,
      credit: 0,
      description: `Piutang ${args.customerName} - ${args.docNumber} [orderId:${args.logisticOrderId}]`,
    });

    // Credit: Revenue per serviceType
    for (const [serviceType, group] of revenueGroups) {
      const revenueAccountId = await resolveServiceTypeAccountId(
        serviceType,
        args.companyId,
        settings.salesIncomeAccountId,
      );

      // Referensi per item dalam description
      const itemRefs = group.items
        .map((l) => {
          const parts: string[] = [];
          if (l.orderItemId)          parts.push(`itemId:${l.orderItemId}`);
          if (l.vendorCatalogItemId)  parts.push(`catalogId:${l.vendorCatalogItemId}`);
          return parts.join(",");
        })
        .filter(Boolean)
        .join("; ");

      const desc = [
        serviceType
          ? `Pendapatan ${serviceType} - ${args.docNumber}`
          : `Pendapatan Jasa - ${args.docNumber}`,
        `[orderId:${args.logisticOrderId}, invId:${args.salesDocId}${itemRefs ? ", " + itemRefs : ""}]`,
      ].join(" ");

      postingLines.push({
        accountId: revenueAccountId ?? settings.salesIncomeAccountId!,
        debit: 0,
        credit: round2(group.subtotal),
        description: desc,
      });
    }

    // Credit: PPN Keluaran
    if (args.taxAmount > 0) {
      const ppnAccountId = args.taxAccountId ?? settings.ppnOutputAccountId;
      if (ppnAccountId) {
        postingLines.push({
          accountId: ppnAccountId,
          debit: 0,
          credit: round2(args.taxAmount),
          description: `PPN Keluaran ${args.docNumber} [orderId:${args.logisticOrderId}, invId:${args.salesDocId}]`,
        });
      }
    }

    await postEntry(
      {
        journalId: settings.salesJournalId,
        date: new Date(),
        ref: args.docNumber,
        description: `Invoice Logistik ${args.docNumber} [orderId:${args.logisticOrderId}, invId:${args.salesDocId}]`,
        source: "sales_invoice",
        sourceId: args.salesDocId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? null,
        lines: postingLines,
      },
      "SAL",
    );
  } catch (err) {
    logger.error(
      { err, logisticOrderId: args.logisticOrderId, salesDocId: args.salesDocId },
      "postLogisticSalesInvoice: gagal post jurnal",
    );
  }
}

// ── Logistic serviceType → COGS COA base code mapping ───────────────────────
const SERVICE_TYPE_COGS_CODES: Record<string, string> = {
  trucking:    "5-1023",  // HPP Trucking / Land Freight
  sea_freight: "5-1021",  // HPP Sea Freight
  air_freight: "5-1022",  // HPP Air Freight
  ppjk:        "5-1024",  // HPP PPJK / Kepabeanan
  handling:    "5-1025",  // HPP Handling Service
  document:    "5-1026",  // HPP Document Service
};

/** Resolve COGS account id untuk service type tertentu (company-specific, fallback ke 5-1020). */
async function resolveServiceTypeCOGSAccountId(
  serviceType: string | null | undefined,
  companyId: number | null | undefined,
  fallbackId: number | null | undefined,
): Promise<number | null> {
  const baseCode = serviceType ? SERVICE_TYPE_COGS_CODES[serviceType.toLowerCase().trim()] : null;
  if (!baseCode) {
    // Fallback: HPP Jasa Logistik (5-1020)
    const cFilter = companyId ?? 1;
    let [row] = await db
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} LIKE ${"5-1020%"} AND ${chartOfAccountsTable.companyId} = ${cFilter}`)
      .limit(1);
    if (!row) {
      [row] = await db
        .select({ id: chartOfAccountsTable.id })
        .from(chartOfAccountsTable)
        .where(sql`${chartOfAccountsTable.code} LIKE ${"5-1020%"}`)
        .limit(1);
    }
    return row?.id ?? fallbackId ?? null;
  }

  const cFilter = companyId ?? 1;
  let [row] = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(sql`${chartOfAccountsTable.code} LIKE ${baseCode + "%"} AND ${chartOfAccountsTable.companyId} = ${cFilter}`)
    .limit(1);
  if (!row) {
    [row] = await db
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} LIKE ${baseCode + "%"}`)
      .limit(1);
  }
  return row?.id ?? fallbackId ?? null;
}

/**
 * Post jurnal COGS untuk Vendor PO dari marketplace service.
 *
 * Struktur:
 *   Debit:  HPP per serviceType (dari vendorCostSnapshot.vendorCost — BUKAN priceSell)
 *   Credit: Hutang Usaha / AP
 *
 * Trigger: saat Vendor PO di-confirm (approved) ATAU vendor invoice received (mark_billed).
 * Deduplication: source="logistic_vendor_cost" + sourceId=vendorPoId — hanya posting sekali.
 *
 * Tidak posting jika:
 *   - vendorCostSnapshot tidak ada
 *   - vendorCost = 0 (belum ada cost review)
 */
export async function postLogisticVendorCostJournal(args: {
  vendorPoId: number;
  docNumber: string;
  supplierName: string;
  vendorId?: number | null;
  serviceType?: string | null;
  vendorCostSnapshot: {
    vendorCost: number;
    currency?: string;
    unit?: string;
    source?: string;
  };
  /** References dari poSnapshot (fulfillmentId, orderId, orderItemId, vendorCatalogItemId) */
  refs?: {
    vendorFulfillmentId?: number | null;
    orderId?: number | null;
    orderItemId?: number | null;
    vendorCatalogItemId?: number | null;
  };
  companyId?: number | null;
  createdById?: string | null;
}): Promise<void> {
  try {
    const { vendorCostSnapshot } = args;
    const vendorCost = Number(vendorCostSnapshot.vendorCost ?? 0);

    // Rule: jangan post jika belum ada cost
    if (!vendorCost || vendorCost <= 0) {
      logger.warn(
        { vendorPoId: args.vendorPoId },
        "postLogisticVendorCostJournal: skip — vendorCost = 0 (belum ada cost review)",
      );
      return;
    }

    const settings = await ensureAccountingSettings(args.companyId ?? undefined);
    if (!settings.apAccountId || !settings.purchaseJournalId) {
      logger.warn(
        { vendorPoId: args.vendorPoId },
        "postLogisticVendorCostJournal: skip — accounting settings incomplete (apAccountId atau purchaseJournalId null)",
      );
      return;
    }

    // Resolve COGS account berdasarkan serviceType
    const cogsAccountId = await resolveServiceTypeCOGSAccountId(
      args.serviceType,
      args.companyId,
      settings.purchaseExpenseAccountId,
    );
    if (!cogsAccountId) {
      logger.warn(
        { vendorPoId: args.vendorPoId, serviceType: args.serviceType },
        "postLogisticVendorCostJournal: skip — tidak bisa resolve COGS account",
      );
      return;
    }

    // Bangun reference string untuk description
    const r = args.refs ?? {};
    const refParts: string[] = [`poId:${args.vendorPoId}`];
    if (r.vendorFulfillmentId) refParts.push(`fulfillmentId:${r.vendorFulfillmentId}`);
    if (args.vendorId)          refParts.push(`vendorId:${args.vendorId}`);
    if (r.orderId)              refParts.push(`orderId:${r.orderId}`);
    if (r.orderItemId)          refParts.push(`orderItemId:${r.orderItemId}`);
    if (r.vendorCatalogItemId)  refParts.push(`catalogId:${r.vendorCatalogItemId}`);
    const refStr = `[${refParts.join(", ")}]`;

    const stLabel = args.serviceType ? ` ${args.serviceType}` : "";

    await postEntry(
      {
        journalId:   settings.purchaseJournalId,
        date:        new Date(),
        ref:         args.docNumber,
        description: `Vendor Cost${stLabel} - ${args.docNumber} ${refStr}`,
        source:      "logistic_vendor_cost",
        sourceId:    args.vendorPoId,
        createdById: args.createdById ?? null,
        companyId:   args.companyId ?? null,
        lines: [
          {
            accountId:   cogsAccountId,
            debit:       round2(vendorCost),
            credit:      0,
            description: `HPP${stLabel} - ${args.docNumber} - ${args.supplierName} ${refStr}`,
          },
          {
            accountId:   settings.apAccountId,
            debit:       0,
            credit:      round2(vendorCost),
            description: `Hutang ${args.supplierName} - ${args.docNumber} ${refStr}`,
          },
        ],
      },
      "PUR",
    );

    logger.info(
      { vendorPoId: args.vendorPoId, serviceType: args.serviceType, vendorCost, cogsAccountId },
      "postLogisticVendorCostJournal: jurnal COGS berhasil diposting",
    );
  } catch (err) {
    logger.error(
      { err, vendorPoId: args.vendorPoId },
      "postLogisticVendorCostJournal: gagal post jurnal",
    );
  }
}

/** Auto-post when a Purchase document gets billed.
 *
 * Debit allocation (per line):
 *  - Lines with productId (barang/inventory):
 *      → if grirAccountId exists: DR 2-1045 GR/IR Clearing (clears the GRN accrual)
 *      → else fallback: DR 1-1040 Persediaan
 *  - Lines without productId (jasa/beban)     → DR purchaseExpenseAccountId (5-1011)
 *  - Tax                                      → DR 1-1050 PPN Masukan
 *  Credit: 2-1010 Hutang Usaha (grand total)
 */
export async function postPurchaseBill(args: {
  purchaseDocId: number;
  docNumber: string;
  supplierName: string;
  /** Lines from purchase_document_lines — used to split inventory vs expense debit */
  docLines?: Array<{ productId: number | null; unitCost: number; quantity: number }>;
  /** Fallback if docLines not provided */
  netAmount?: number;
  taxAmount: number;
  taxAccountId: number | null;
  createdById?: string | null;
  companyId?: number | null;
  /** Sport Center: cost center ID resolved from SPORT_CENTER code */
  costCenterId?: number | null;
  /** Sport Center: links entry ke fasilitas spesifik */
  facilityId?: number | null;
  /** Sport Center: expense category dari classifyExpense() */
  expenseCategory?: string | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? undefined);
    if (!settings.apAccountId || !settings.purchaseJournalId) {
      logger.warn({ purchaseDocId: args.purchaseDocId }, "Skipping auto-post purchase bill: accounting settings incomplete");
      return;
    }

    // Split net amount into inventory portion vs service/expense portion
    let inventoryAmount = 0;
    let expenseAmount = 0;

    if (args.docLines && args.docLines.length > 0) {
      for (const line of args.docLines) {
        const lineTotal = round2(Number(line.unitCost) * Number(line.quantity));
        if (line.productId != null) {
          inventoryAmount = round2(inventoryAmount + lineTotal);
        } else {
          expenseAmount = round2(expenseAmount + lineTotal);
        }
      }
    } else {
      // Fallback: treat full amount as expense (legacy behaviour)
      expenseAmount = round2(args.netAmount ?? 0);
    }

    const netTotal = round2(inventoryAmount + expenseAmount);
    const taxAmount = round2(args.taxAmount);
    const grand = round2(netTotal + taxAmount);

    if (grand <= 0) {
      logger.warn({ purchaseDocId: args.purchaseDocId }, "Skipping purchase bill post: grand total is 0");
      return;
    }

    const lines: PostingLine[] = [];

    // DR GR/IR (clears GRN accrual) or DR Persediaan for product lines
    if (inventoryAmount > 0) {
      // Prefer GR/IR account — clears the liability posted when GRN was confirmed.
      // Fallback chain: settings.grirAccountId → direct lookup 2-1045 → settings.inventoryAccountId
      let grirAccountId: number | null = settings.grirAccountId ?? null;
      if (!grirAccountId) {
        const grirRows = await db.execute(sql`
          SELECT id FROM chart_of_accounts
          WHERE code LIKE '2-1045%' AND company_id = ${args.companyId ?? 1}
          ORDER BY code LIMIT 1
        `);
        const grirRow = (grirRows as unknown as Record<string, unknown>[])[0];
        if (grirRow?.["id"]) grirAccountId = Number(grirRow["id"]);
      }
      const productDebitAccountId = grirAccountId ?? settings.inventoryAccountId;
      if (!productDebitAccountId) {
        logger.warn({ purchaseDocId: args.purchaseDocId }, "grirAccountId & inventoryAccountId missing — falling back to expense account for product lines");
        expenseAmount = round2(expenseAmount + inventoryAmount);
        inventoryAmount = 0;
      } else {
        const isGrir = !!grirAccountId;
        lines.push({
          accountId: productDebitAccountId,
          debit: inventoryAmount,
          credit: 0,
          description: isGrir
            ? `GR/IR clearing: ${args.docNumber}`
            : `Persediaan barang: ${args.docNumber}`,
        });
      }
    }

    // DR Beban/Jasa for non-product lines
    if (expenseAmount > 0) {
      const expAcct = settings.purchaseExpenseAccountId;
      if (!expAcct) {
        logger.warn({ purchaseDocId: args.purchaseDocId }, "purchaseExpenseAccountId missing — skipping service/expense lines");
      } else {
        lines.push({
          accountId: expAcct,
          debit: expenseAmount,
          credit: 0,
          description: `Pembelian jasa/beban: ${args.docNumber}`,
        });
      }
    }

    // DR PPN Masukan
    if (taxAmount > 0 && (args.taxAccountId ?? settings.ppnInputAccountId)) {
      lines.push({
        accountId: (args.taxAccountId ?? settings.ppnInputAccountId)!,
        debit: taxAmount,
        credit: 0,
        description: `PPN Masukan ${args.docNumber}`,
      });
    }

    // CR Hutang Usaha
    const totalDebitCheck = round2(lines.reduce((s, l) => s + l.debit, 0));
    lines.push({
      accountId: settings.apAccountId,
      debit: 0,
      credit: totalDebitCheck,
      description: `Hutang ${args.supplierName} - ${args.docNumber}`,
    });

    if (lines.length < 2) {
      logger.warn({ purchaseDocId: args.purchaseDocId }, "Skipping purchase bill post: no debit lines generated");
      return;
    }

    await postEntry(
      {
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: args.docNumber,
        description: `Tagihan pembelian ${args.docNumber}`,
        source: "purchase_bill",
        sourceId: args.purchaseDocId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? null,
        costCenterId: args.costCenterId ?? null,
        facilityId: args.facilityId ?? null,
        expenseCategory: args.expenseCategory ?? null,
        lines,
      },
      "PUR",
    );
    logger.info({ purchaseDocId: args.purchaseDocId, inventoryAmount, expenseAmount, taxAmount }, "Purchase bill journal entry posted");
  } catch (err) {
    logger.error({ err, purchaseDocId: args.purchaseDocId }, "Auto-post purchase bill failed");
  }
}

/** Auto-post when an e-commerce order reaches "delivered" status. */
export async function postEcommerceOrder(args: {
  orderId: number;
  customerName: string;
  totalAmount: number;
  taxAmount?: number;
  grandTotal?: number;
  createdById?: string | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings();
    if (!settings.arAccountId || !settings.salesIncomeAccountId || !settings.salesJournalId) {
      logger.warn({ orderId: args.orderId }, "Skipping ecommerce order post: accounting settings incomplete");
      return;
    }
    const subtotal = round2(args.totalAmount);
    const taxAmt = round2(args.taxAmount ?? 0);
    const grandTotal = round2(args.grandTotal ?? subtotal + taxAmt);

    if (taxAmt > 0 && !settings.ppnOutputAccountId) {
      logger.warn({ orderId: args.orderId, taxAmt }, "Skipping ecommerce order post: taxAmount > 0 but ppnOutputAccountId not configured");
      return;
    }

    const lines: PostingLine[] = [
      { accountId: settings.arAccountId, debit: grandTotal, credit: 0, description: `Piutang order #${args.orderId} - ${args.customerName}` },
      { accountId: settings.salesIncomeAccountId, debit: 0, credit: subtotal, description: `Pendapatan e-commerce #${args.orderId}` },
    ];

    if (taxAmt > 0) {
      lines.push({ accountId: settings.ppnOutputAccountId!, debit: 0, credit: taxAmt, description: `PPN Keluaran order #${args.orderId}` });
    }

    await postEntry(
      {
        journalId: settings.salesJournalId,
        date: new Date(),
        ref: `ECO-${args.orderId}`,
        description: `Order e-commerce #${args.orderId} - ${args.customerName}`,
        source: "ecommerce_order",
        sourceId: args.orderId,
        createdById: args.createdById ?? null,
        lines,
      },
      "SAL",
    );
  } catch (err) {
    logger.error({ err, orderId: args.orderId }, "Auto-post ecommerce order failed");
  }
}

/** Auto-post COGS when a Sales Order is delivered (DR HPP / CR Persediaan). */
export async function postSalesCogs(args: {
  salesDocId: number;
  docNumber: string;
  lines: Array<{ name: string; qty: number; costPrice: number }>;
  createdById?: string | null;
  companyId?: number | null;
}): Promise<void> {
  try {
    const validLines = args.lines.filter((l) => l.costPrice > 0 && l.qty > 0);
    if (validLines.length === 0) {
      logger.info({ salesDocId: args.salesDocId }, "postSalesCogs: all cost prices are 0 — skipping COGS entry");
      return;
    }
    const settings = await ensureAccountingSettings();
    if (!settings.cogsAccountId || !settings.inventoryAccountId || !settings.purchaseJournalId) {
      logger.warn({ salesDocId: args.salesDocId }, "Skipping COGS post: cogsAccountId/inventoryAccountId/purchaseJournalId missing in settings");
      return;
    }
    const totalCogs = round2(validLines.reduce((s, l) => s + l.costPrice * l.qty, 0));
    if (totalCogs <= 0) return;
    const description = validLines.map((l) => `${l.name} ×${l.qty}`).join(", ");
    await postEntry(
      {
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: args.docNumber,
        description: `HPP Penjualan: ${args.docNumber}`,
        source: "cogs_delivery",
        sourceId: args.salesDocId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? null,
        lines: [
          { accountId: settings.cogsAccountId, debit: totalCogs, credit: 0, description: `HPP: ${description}` },
          { accountId: settings.inventoryAccountId, debit: 0, credit: totalCogs, description: `Persediaan keluar: ${description}` },
        ],
      },
      "PUR",
    );
    logger.info({ salesDocId: args.salesDocId, totalCogs, lineCount: validLines.length }, "COGS journal entry posted");
  } catch (err) {
    logger.error({ err, salesDocId: args.salesDocId }, "Auto-post COGS delivery failed");
  }
}

/** Auto-post when new stock is received in Trading (DR Persediaan / CR Hutang Usaha). */
export async function postStockReceived(args: {
  stockId: number;
  productName: string;
  quantity: number;
  costPrice: number;
  createdById?: string | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings();
    if (!settings.inventoryAccountId || !settings.apAccountId || !settings.purchaseJournalId) {
      logger.warn({ stockId: args.stockId }, "Skipping stock received post: accounting settings incomplete");
      return;
    }
    const total = round2(args.quantity * args.costPrice);
    if (total <= 0) return;
    await postEntry(
      {
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: `STK-${args.stockId}`,
        description: `Penerimaan stok: ${args.productName} (${args.quantity} unit)`,
        source: "stock_received",
        sourceId: args.stockId,
        createdById: args.createdById ?? null,
        lines: [
          { accountId: settings.inventoryAccountId, debit: total, credit: 0, description: `Persediaan: ${args.productName}` },
          { accountId: settings.apAccountId, debit: 0, credit: total, description: `Hutang usaha stok #${args.stockId}` },
        ],
      },
      "PUR",
    );
  } catch (err) {
    logger.error({ err, stockId: args.stockId }, "Auto-post stock received failed");
  }
}

/** Auto-post when a payment becomes paid.
 *
 * @param args.paymentMethod - Opsional. "cash" | "tunai" → posting ke akun Kas (CSH journal). "qris" dan metode lain → akun Bank (BNK journal).
 *   Selain itu atau tidak diisi → posting ke akun Bank (BNK journal). Backward compatible.
 */
async function recordAccountingPostingFailure(args: {
  companyId?: number | null;
  sourceId: number;
  sourceRef?: string | null;
  sourceModule?: string;
  sourceTable?: string;
  errorCode: string;
  errorMessage: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(accountingPostingErrorsTable).values({
      companyId: args.companyId ?? null,
      sourceModule: args.sourceModule ?? "payments",
      sourceTable: args.sourceTable ?? "payments",
      sourceId: args.sourceId,
      sourceRef: args.sourceRef ?? null,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage.slice(0, 2000),
      payload: args.payload ?? null,
    });
  } catch (recordErr) {
    logger.error(
      { err: recordErr, sourceId: args.sourceId, errorCode: args.errorCode },
      "Failed to persist accounting posting failure",
    );
  }
}

export async function postPaymentReceived(args: {
  paymentId: number;
  refKind: "sales" | "purchase" | "logistic";
  refDocNumber: string;
  amount: number;
  paymentMethod?: string;
  companyId?: number | null;
}): Promise<boolean> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? undefined);

    // Tentukan apakah tunai (kas) atau non-tunai (bank transfer / QRIS)
    // QRIS = non-cash → masuk ke Bank journal (BNK), bukan Cash journal (CSH)
    const isCash =
      args.paymentMethod === "cash" ||
      args.paymentMethod === "tunai";

    const targetAccountId = isCash
      ? (settings.defaultCashAccountId ?? settings.defaultBankAccountId)
      : settings.defaultBankAccountId;
    const targetJournalId = isCash
      ? (settings.cashJournalId ?? settings.bankJournalId)
      : settings.bankJournalId;
    const journalCode = isCash ? "CSH" : "BNK";

    if (!targetJournalId || !targetAccountId) {
      logger.warn(
        { paymentId: args.paymentId, isCash },
        "Skipping auto-post payment: bank/cash account or journal settings missing",
      );
      await recordAccountingPostingFailure({
        companyId: args.companyId,
        sourceId: args.paymentId,
        sourceRef: args.refDocNumber,
        errorCode: "ACCOUNTING_CONFIG_INCOMPLETE",
        errorMessage: "Bank/cash account or journal settings missing for payment posting",
      });
      return false;
    }

    const amt = round2(args.amount);
    let lines: PostingLine[];
    let source: "sales_payment" | "purchase_payment";

    if (args.refKind === "sales") {
      if (!settings.arAccountId) {
        await recordAccountingPostingFailure({
          companyId: args.companyId,
          sourceId: args.paymentId,
          sourceRef: args.refDocNumber,
          errorCode: "AR_ACCOUNT_MISSING",
          errorMessage: "Accounts receivable account missing for sales payment posting",
        });
        return false;
      }
      source = "sales_payment";
      lines = [
        {
          accountId: targetAccountId,
          debit: amt,
          credit: 0,
          description: `Penerimaan ${args.refDocNumber}`,
        },
        {
          accountId: settings.arAccountId,
          debit: 0,
          credit: amt,
          description: `Pelunasan piutang ${args.refDocNumber}`,
        },
      ];
    } else {
      if (!settings.apAccountId) {
        await recordAccountingPostingFailure({
          companyId: args.companyId,
          sourceId: args.paymentId,
          sourceRef: args.refDocNumber,
          errorCode: "AP_ACCOUNT_MISSING",
          errorMessage: "Accounts payable account missing for payment posting",
        });
        return false;
      }
      source = "purchase_payment";
      lines = [
        {
          accountId: settings.apAccountId,
          debit: amt,
          credit: 0,
          description: `Pelunasan hutang ${args.refDocNumber}`,
        },
        {
          accountId: targetAccountId,
          debit: 0,
          credit: amt,
          description: `Pembayaran ${args.refDocNumber}`,
        },
      ];
    }

    await postEntry(
      {
        journalId: targetJournalId,
        date: new Date(),
        ref: args.refDocNumber,
        description: `Pembayaran ${args.refDocNumber}`,
        source,
        sourceId: args.paymentId,
        companyId: args.companyId ?? null,
        lines,
      },
      journalCode,
    );
    return true;
  } catch (err) {
    logger.error({ err, paymentId: args.paymentId }, "Auto-post payment failed");
    await recordAccountingPostingFailure({
      companyId: args.companyId,
      sourceId: args.paymentId,
      sourceRef: args.refDocNumber,
      errorCode: "PAYMENT_POST_FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Auto-post when a Purchase Return is confirmed (DR Hutang Usaha / CR Persediaan / CR Beban). */
export async function postPurchaseReturn(args: {
  returnId: number;
  returnNumber: string;
  supplierName: string;
  lines: Array<{ productId: number | null; qty: number; unitCost: number }>;
  createdById?: string | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings();
    if (!settings.apAccountId || !settings.purchaseJournalId) {
      logger.warn({ returnId: args.returnId }, "Skipping purchase return post: settings incomplete");
      return;
    }

    let inventoryTotal = 0;
    let expenseTotal = 0;
    for (const line of args.lines) {
      const lineAmt = round2(line.qty * line.unitCost);
      if (line.productId != null) {
        inventoryTotal = round2(inventoryTotal + lineAmt);
      } else {
        expenseTotal = round2(expenseTotal + lineAmt);
      }
    }

    const grand = round2(inventoryTotal + expenseTotal);
    if (grand <= 0) return;

    const lines: PostingLine[] = [];
    lines.push({
      accountId: settings.apAccountId,
      debit: grand,
      credit: 0,
      description: `Pelunasan hutang retur ${args.returnNumber} - ${args.supplierName}`,
    });
    if (inventoryTotal > 0 && settings.inventoryAccountId) {
      lines.push({
        accountId: settings.inventoryAccountId,
        debit: 0,
        credit: inventoryTotal,
        description: `Persediaan keluar retur ${args.returnNumber}`,
      });
    } else if (inventoryTotal > 0) {
      expenseTotal = round2(expenseTotal + inventoryTotal);
    }
    if (expenseTotal > 0 && settings.purchaseExpenseAccountId) {
      lines.push({
        accountId: settings.purchaseExpenseAccountId,
        debit: 0,
        credit: expenseTotal,
        description: `Beban/jasa retur ${args.returnNumber}`,
      });
    }

    if (lines.length < 2) return;

    await postEntry(
      {
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: args.returnNumber,
        description: `Retur pembelian ${args.returnNumber} - ${args.supplierName}`,
        source: "purchase_return",
        sourceId: args.returnId,
        createdById: args.createdById ?? null,
        lines,
      },
      "PRR",
    );
    logger.info({ returnId: args.returnId, grand }, "Purchase return journal entry posted");
  } catch (err) {
    logger.error({ err, returnId: args.returnId }, "Auto-post purchase return failed");
  }
}

/** Auto-post when a Sales Return is confirmed (DR Pendapatan / CR Piutang). */
export async function postSalesReturn(args: {
  returnId: number;
  returnNumber: string;
  customerName: string;
  /** Nilai net penjualan yang diretur (tidak termasuk PPN) */
  netAmount: number;
  /** Nilai PPN Keluaran yang ikut diretur. Jika diisi, jurnal akan DR PPN Keluaran / CR Piutang. */
  taxAmount?: number;
  createdById?: string | null;
  companyId?: number | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? undefined);
    if (!settings.salesIncomeAccountId || !settings.arAccountId || !settings.salesJournalId) {
      logger.warn({ returnId: args.returnId }, "Skipping sales return post: settings incomplete");
      return;
    }
    const net = round2(args.netAmount);
    const tax = round2(args.taxAmount ?? 0);
    const total = round2(net + tax);
    if (total <= 0) return;

    const lines: PostingLine[] = [
      {
        accountId: settings.salesIncomeAccountId,
        debit: net,
        credit: 0,
        description: `Retur pendapatan ${args.returnNumber}`,
      },
    ];

    // DR PPN Keluaran (membalik PPN yang sudah dikreditkan saat invoice)
    if (tax > 0 && settings.ppnOutputAccountId) {
      lines.push({
        accountId: settings.ppnOutputAccountId,
        debit: tax,
        credit: 0,
        description: `Retur PPN Keluaran ${args.returnNumber}`,
      });
    }

    // CR Piutang Usaha (mengurangi piutang senilai total retur)
    lines.push({
      accountId: settings.arAccountId,
      debit: 0,
      credit: total,
      description: `Pengurangan piutang retur ${args.returnNumber} - ${args.customerName}`,
    });

    await postEntry(
      {
        journalId: settings.salesJournalId,
        date: new Date(),
        ref: args.returnNumber,
        description: `Retur penjualan ${args.returnNumber} - ${args.customerName}`,
        source: "sales_return",
        sourceId: args.returnId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? null,
        lines,
      },
      "SRR",
    );
    logger.info({ returnId: args.returnId, net, tax, total }, "Sales return journal entry posted (with PPN reversal)");
  } catch (err) {
    logger.error({ err, returnId: args.returnId }, "Auto-post sales return failed");
  }
}

/** Auto-post when damage/loss is confirmed (DR Beban Kerusakan / CR Persediaan). */
export async function postDamageJournal(args: {
  damageReportId: number;
  reportNumber: string;
  totalValue: number;
  companyId?: number | null;
  createdById?: string | null;
}): Promise<void> {
  try {
    if (args.totalValue <= 0) return;
    const settings = await ensureAccountingSettings();
    if (!settings.inventoryAccountId || !settings.cogsAccountId || !settings.purchaseJournalId) {
      logger.warn({ damageReportId: args.damageReportId }, "Skipping damage post: accounting settings incomplete");
      return;
    }
    const amt = round2(args.totalValue);
    await postEntry(
      {
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: args.reportNumber,
        description: `Kerugian barang rusak/hilang: ${args.reportNumber}`,
        source: "damage_adjust",
        sourceId: args.damageReportId,
        companyId: args.companyId ?? 1,
        createdById: args.createdById ?? null,
        lines: [
          { accountId: settings.cogsAccountId, debit: amt, credit: 0, description: `Beban kerusakan ${args.reportNumber}` },
          { accountId: settings.inventoryAccountId, debit: 0, credit: amt, description: `Persediaan keluar rusak ${args.reportNumber}` },
        ],
      },
      "DMG",
    );
    logger.info({ damageReportId: args.damageReportId, amt }, "Damage journal entry posted");
  } catch (err) {
    logger.error({ err, damageReportId: args.damageReportId }, "Auto-post damage journal failed");
  }
}

/** Auto-post opname/stock adjustment (DR or CR Persediaan vs HPP/Variance). */
export async function postOpnameAdjust(args: {
  opnameId: number;
  opnameNumber: string;
  /** Positive = surplus (physical > system), Negative = shortage */
  diffAmount: number;
  createdById?: string | null;
}): Promise<void> {
  try {
    if (args.diffAmount === 0) return;
    const settings = await ensureAccountingSettings();
    if (!settings.inventoryAccountId || !settings.cogsAccountId || !settings.purchaseJournalId) {
      logger.warn({ opnameId: args.opnameId }, "Skipping opname adjust post: settings incomplete");
      return;
    }

    const amt = round2(Math.abs(args.diffAmount));
    const isSurplus = args.diffAmount > 0;

    await postEntry(
      {
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: args.opnameNumber,
        description: `Penyesuaian stok opname ${args.opnameNumber} (${isSurplus ? "surplus" : "susut"})`,
        source: "opname_adjust",
        sourceId: args.opnameId,
        createdById: args.createdById ?? null,
        lines: isSurplus
          ? [
              { accountId: settings.inventoryAccountId, debit: amt, credit: 0, description: `Tambah persediaan opname ${args.opnameNumber}` },
              { accountId: settings.cogsAccountId, debit: 0, credit: amt, description: `Selisih stok opname ${args.opnameNumber}` },
            ]
          : [
              { accountId: settings.cogsAccountId, debit: amt, credit: 0, description: `Selisih stok opname ${args.opnameNumber}` },
              { accountId: settings.inventoryAccountId, debit: 0, credit: amt, description: `Kurang persediaan opname ${args.opnameNumber}` },
            ],
      },
      "OPN",
    );
    logger.info({ opnameId: args.opnameId, diffAmount: args.diffAmount }, "Opname adjust journal entry posted");
  } catch (err) {
    logger.error({ err, opnameId: args.opnameId }, "Auto-post opname adjust failed");
  }
}

/** Auto-post Sales Return COGS reversal (DR Persediaan / CR HPP). */
export async function postSalesCogsReturn(args: {
  salesDocId: number;
  docNumber: string;
  lines: Array<{ name: string; qty: number; costPrice: number }>;
  createdById?: string | null;
  companyId?: number | null;
}): Promise<void> {
  try {
    const validLines = args.lines.filter((l) => l.costPrice > 0 && l.qty > 0);
    if (validLines.length === 0) {
      logger.info({ salesDocId: args.salesDocId }, "postSalesCogsReturn: all cost prices are 0 — skipping reversal entry");
      return;
    }
    const settings = await ensureAccountingSettings();
    if (!settings.cogsAccountId || !settings.inventoryAccountId || !settings.purchaseJournalId) {
      logger.warn({ salesDocId: args.salesDocId }, "Skipping sales cogs return post: accounting settings incomplete");
      return;
    }
    const totalCogs = round2(validLines.reduce((s, l) => s + l.costPrice * l.qty, 0));
    if (totalCogs <= 0) return;
    const description = validLines.map((l) => `${l.name} ×${l.qty}`).join(", ");
    await postEntry(
      {
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: args.docNumber,
        description: `Retur Penjualan HPP: ${args.docNumber}`,
        source: "sales_return",
        sourceId: args.salesDocId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? null,
        lines: [
          { accountId: settings.inventoryAccountId, debit: totalCogs, credit: 0, description: `Persediaan masuk kembali: ${description}` },
          { accountId: settings.cogsAccountId, debit: 0, credit: totalCogs, description: `HPP reversal: ${description}` },
        ],
      },
      "PUR",
    );
    logger.info({ salesDocId: args.salesDocId, totalCogs, lineCount: validLines.length }, "Sales COGS return journal entry posted");
  } catch (err) {
    logger.error({ err, salesDocId: args.salesDocId }, "Auto-post sales COGS return failed");
  }
}

/** Auto-post Warehouse Transfer: DR Persediaan Tujuan / CR Persediaan Asal (in-company transfer). */
export async function postWarehouseTransfer(args: {
  transferId: number;
  fromWarehouseId: number;
  toWarehouseId: number;
  items: Array<{ productId: number; productName: string; qty: number; costPrice: number }>;
  companyId?: number | null;
}): Promise<void> {
  try {
    const validItems = args.items.filter((i) => i.qty > 0 && i.costPrice > 0);
    if (validItems.length === 0) return;

    const settings = await ensureAccountingSettings(args.companyId ?? undefined);
    if (!settings.inventoryAccountId || !settings.purchaseJournalId) {
      logger.warn({ transferId: args.transferId }, "Skipping warehouse transfer post: settings incomplete");
      return;
    }

    const totalValue = round2(validItems.reduce((s, i) => s + i.qty * i.costPrice, 0));
    const description = `Transfer antar gudang #${args.transferId} (gudang ${args.fromWarehouseId} → ${args.toWarehouseId})`;
    const lineDesc = validItems.map((i) => `${i.productName} ×${i.qty}`).join(", ");

    await postEntry(
      {
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: `WH-TRF-${args.transferId}`,
        description,
        source: "wh_transfer",
        sourceId: args.transferId,
        createdById: null,
        companyId: args.companyId ?? null,
        lines: [
          { accountId: settings.inventoryAccountId, debit: totalValue, credit: 0, description: `Persediaan masuk gudang tujuan: ${lineDesc}` },
          { accountId: settings.inventoryAccountId, debit: 0, credit: totalValue, description: `Persediaan keluar gudang asal: ${lineDesc}` },
        ],
      },
      "WHT",
    );
    logger.info({ transferId: args.transferId, totalValue, itemCount: validItems.length }, "Warehouse transfer journal entry posted");
  } catch (err) {
    logger.error({ err, transferId: args.transferId }, "Auto-post warehouse transfer failed");
  }
}

/**
 * Auto-post when a Sport Center booking is confirmed.
 * Debit  : Kas (cash)
 * Credit : Pendapatan Sport Center (sales income)
 */
export async function postSportCenterBooking(args: {
  bookingId: number;
  bookingCode: string;
  customerName: string;
  facilityName: string;
  date: string;
  totalPrice: number;
  createdById?: string | null;
  companyId?: number | null;
}): Promise<void> {
  try {
    // Idempoten (primary): skip jika jurnal booking ini sudah diposting berdasarkan booking_id
    const [existingEntry] = await db
      .select()
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'sport_center_booking' AND ${accountingEntriesTable.sourceId} = ${args.bookingId}`)
      .limit(1);
    if (existingEntry) {
      logger.info({ bookingId: args.bookingId }, "Sport Center booking journal already posted — skipping");
      return;
    }

    // Idempoten (secondary): skip jika sudah ada JNL dengan ref yang sama (booking_code)
    // Mencegah duplikasi ketika booking yang sama punya multiple local booking_id
    if (args.bookingCode) {
      const [existingByRef] = await db
        .select()
        .from(accountingEntriesTable)
        .where(sql`${accountingEntriesTable.source} = 'sport_center_booking' AND ${accountingEntriesTable.ref} = ${args.bookingCode} AND ${accountingEntriesTable.companyId} = ${args.companyId ?? 1}`)
        .limit(1);
      if (existingByRef) {
        logger.info({ bookingId: args.bookingId, ref: args.bookingCode }, "Sport Center booking journal already posted (by ref) — skipping duplicate");
        return;
      }
    }

    const settings = await ensureAccountingSettings(args.companyId ?? 1);

    const debitAccountId = settings.defaultCashAccountId ?? settings.defaultBankAccountId;
    const creditAccountId = await resolveSportCenterBookingAccountId(args.companyId, settings.salesIncomeAccountId);
    const journalId = settings.cashJournalId ?? settings.bankJournalId;
    const journalCode = settings.cashJournalId ? "CSH" : "BNK";

    if (!debitAccountId || !creditAccountId || !journalId) {
      logger.warn(
        {
          bookingId: args.bookingId,
          companyId: args.companyId,
          settingsId: settings.id,
          defaultCashAccountId: settings.defaultCashAccountId,
          defaultBankAccountId: settings.defaultBankAccountId,
          salesIncomeAccountId: settings.salesIncomeAccountId,
          cashJournalId: settings.cashJournalId,
          bankJournalId: settings.bankJournalId,
          debitAccountId,
          creditAccountId,
          journalId,
        },
        "Skipping Sport Center booking post: akun kas/pendapatan atau jurnal belum dikonfigurasi",
      );
      return;
    }

    const costCenterId = await resolveCostCenterId("SPORT_CENTER", args.companyId);
    const amt = round2(args.totalPrice);
    await postEntry(
      {
        journalId,
        date: new Date(args.date),
        ref: args.bookingCode,
        description: `Booking Sport Center: ${args.facilityName} — ${args.customerName} (${args.date})`,
        source: "sport_center_booking",
        sourceId: args.bookingId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? 1,
        costCenterId,
        lines: [
          {
            accountId: debitAccountId,
            debit: amt,
            credit: 0,
            description: `Penerimaan booking ${args.bookingCode}`,
          },
          {
            accountId: creditAccountId,
            debit: 0,
            credit: amt,
            description: `Pendapatan Sport Center: ${args.facilityName}`,
          },
        ],
      },
      journalCode,
    );

    logger.info(
      { bookingId: args.bookingId, bookingCode: args.bookingCode, amt },
      "Sport Center booking journal entry posted",
    );
  } catch (err) {
    logger.error({ err, bookingId: args.bookingId }, "Auto-post Sport Center booking failed");
  }
}

// ─── Atomic Sport Center payment posting ─────────────────────────────────────

export interface SportCenterPaymentAtomicArgs {
  /** sport_payments.id — idempotency key for accounting_payments */
  paymentId:     number;
  paymentNumber: string;
  /** 'booking' → source=sport_center_booking, COA 4-1017
   *  'membership' → source=sport_center_membership, COA 4-1016 */
  type:          "booking" | "membership";
  /** Idempotency key for accounting_entries:
   *    booking   → public.sport_bookings.id
   *    membership → sport_payments.id */
  sourceId:      number;
  /** booking_number or member_number */
  sourceRef:     string;
  customerName:  string;
  facilityName?: string;
  memberNumber?: string;
  amount:        number;
  method:        string;
  date:          string;   // YYYY-MM-DD
  companyId:     number;
  createdById?:  string | null;
}

export interface SportCenterPaymentAtomicResult {
  entryId:   number;
  paymentId: number;
  /** true if an existing entry was found and no new write occurred */
  skipped:   boolean;
}

/**
 * Post Sport Center payment (booking OR membership) atomically inside a
 * caller-provided database transaction.
 *
 * Contract:
 *  • Call this inside db.transaction(async (tx) => ...) so that sport_payments
 *    INSERT + sport_bookings UPDATE + accounting all commit/roll back together.
 *  • THROWS instead of silently returning void when COA or journal is missing.
 *    The error propagates up so the caller's transaction rolls back and the route
 *    handler can return HTTP 422 — the sport_payments row is never committed.
 *  • Idempotent: if an entry for (source, sourceId) already exists in
 *    accounting_entries the function returns it without creating a duplicate.
 *  • accounting_payments.entry_id is always set — no split-brain null FK.
 */
export async function postSportCenterPaymentAtomic(
  client: DbClient,
  args: SportCenterPaymentAtomicArgs,
): Promise<SportCenterPaymentAtomicResult> {
  const entrySource = (
    args.type === "membership" ? "sport_center_membership" : "sport_center_booking"
  ) as PostingInput["source"];

  // ── 1. Idempotency check inside the same tx for race safety ──────────────
  const [existingEntry] = await client
    .select({ id: accountingEntriesTable.id })
    .from(accountingEntriesTable)
    .where(
      sql`${accountingEntriesTable.source} = ${entrySource as string}
          AND ${accountingEntriesTable.sourceId} = ${args.sourceId}`,
    )
    .limit(1);

  if (existingEntry) {
    logger.info(
      { sourceId: args.sourceId, entrySource, paymentId: args.paymentId },
      "[postSportCenterPaymentAtomic] Entry already posted — idempotent skip",
    );
    const existPay = await client.execute(sql`
      SELECT id FROM accounting_payments
      WHERE source_type = 'sport_center' AND source_doc_id = ${args.paymentId}
      LIMIT 1
    `);
    const existPayId = Number(
      (existPay.rows[0] as Record<string, unknown>)?.id ?? 0,
    );
    return { entryId: existingEntry.id, paymentId: existPayId, skipped: true };
  }

  // ── 2. Resolve COA + journal — THROW (not silent void) on missing ────────
  const settings = await ensureAccountingSettings(args.companyId);

  const isCash = ["cash", "tunai"].includes((args.method ?? "").toLowerCase());
  const journalId = isCash
    ? (settings.cashJournalId  ?? settings.bankJournalId)
    : (settings.bankJournalId ?? settings.cashJournalId);
  const journalCode = (settings.cashJournalId && (isCash || !settings.bankJournalId))
    ? "CSH" : "BNK";

  // Pilih akun debit berdasarkan metode pembayaran:
  // - cash/tunai → defaultCashAccountId (Kas kecil CST)
  // - qris/transfer/card/other → defaultBankAccountId (Bank Mandiri CST)
  const debitAccountId = isCash
    ? (settings.defaultCashAccountId ?? settings.defaultBankAccountId)
    : (settings.defaultBankAccountId ?? settings.defaultCashAccountId);

  // COA for credit side: 4-1017 booking, 4-1016 membership
  // B1 FIX: gunakan client (transaction context) bukan global db agar lookup
  // memakai snapshot yang sama dengan transaksi — mencegah baca data stale/uncommitted.
  let creditAccountId: number | null;
  if (args.type === "membership") {
    const cFilter = args.companyId;
    let [row] = await client
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} LIKE '4-1016%' AND ${chartOfAccountsTable.companyId} = ${cFilter}`)
      .limit(1);
    if (!row) {
      [row] = await client
        .select({ id: chartOfAccountsTable.id })
        .from(chartOfAccountsTable)
        .where(sql`${chartOfAccountsTable.code} LIKE '4-1016%' AND ${chartOfAccountsTable.companyId} IS NOT NULL`)
        .limit(1);
    }
    creditAccountId = row?.id ?? settings.salesIncomeAccountId ?? null;
  } else {
    // B1 FIX: pass client agar booking COA lookup juga memakai transaction context
    creditAccountId = await resolveSportCenterBookingAccountId(
      args.companyId, settings.salesIncomeAccountId, client,
    );
  }

  if (!debitAccountId) {
    throw new Error(
      `COA_MISSING: Akun Kas/Bank (1-10xx) belum dikonfigurasi untuk company_id=${args.companyId}. ` +
      `Isi Accounting → Settings → Default Cash Account atau Default Bank Account.`,
    );
  }
  if (!creditAccountId) {
    const coaCode = args.type === "membership" ? "4-1016" : "4-1017";
    throw new Error(
      `COA_MISSING: Akun Pendapatan Sport Center (${coaCode}) tidak ditemukan untuk ` +
      `company_id=${args.companyId}. Tambahkan akun ini di Chart of Accounts.`,
    );
  }
  if (!journalId) {
    throw new Error(
      `JOURNAL_MISSING: Tidak ada jurnal Kas/Bank untuk company_id=${args.companyId}. ` +
      `Konfigurasi di Accounting → Settings → Cash Journal atau Bank Journal.`,
    );
  }

  // ── 3. Post accounting_entries via canonical engine ───────────────────────
  // B1 FIX: pass client agar cost center lookup memakai transaction context
  const costCenterId = await resolveCostCenterId("SPORT_CENTER", args.companyId, client);
  const amt = round2(args.amount);

  const description = args.type === "membership"
    ? `Pembayaran Membership Sport Center: ${args.customerName} (${args.memberNumber ?? args.sourceRef})`
    : `Booking Sport Center: ${args.facilityName ?? ""} — ${args.customerName} (${args.date})`;

  const entry = await _postEntryCore(
    client,
    {
      journalId,
      date:        new Date(args.date),
      ref:         args.sourceRef,
      description,
      source:      entrySource,
      sourceId:    args.sourceId,
      createdById: args.createdById ?? null,
      companyId:   args.companyId,
      costCenterId,
      lines: [
        {
          accountId:   debitAccountId,
          debit:       amt,
          credit:      0,
          description: `Penerimaan ${args.type === "membership" ? "membership" : "booking"} ${args.sourceRef}`,
        },
        {
          accountId:   creditAccountId,
          debit:       0,
          credit:      amt,
          description: args.type === "membership"
            ? `Pendapatan Membership Sport Center: ${args.customerName}`
            : `Pendapatan Sport Center: ${args.facilityName ?? ""}`,
        },
      ],
    },
    journalCode,
  );

  // ── 4. Insert accounting_payments with entryId properly set ──────────────
  // Uses journal_sequences for a concurrency-safe PAY sequence number.
  const year = args.date.slice(0, 4);
  const seqResult = await client.execute(sql`
    INSERT INTO journal_sequences (journal_prefix, company_id, year, next_seq)
    VALUES ('PAY', ${args.companyId}, ${Number(year)}, 2)
    ON CONFLICT (journal_prefix, company_id, year)
    DO UPDATE SET next_seq = journal_sequences.next_seq + 1
    RETURNING (next_seq - 1)::int AS claimed_seq
  `);
  const seq = String(
    Number((seqResult.rows[0] as Record<string, unknown>)?.claimed_seq ?? 1),
  ).padStart(4, "0");
  const acctPayNumber = `PAY/${year}/${seq}`;

  const payInsert = await client.execute(sql`
    INSERT INTO accounting_payments
      (company_id, payment_number, payment_type, status, amount,
       journal_id, partner_name, date, ref, memo,
       entry_id, source_type, source_doc_id, created_by_id)
    VALUES
      (${args.companyId}, ${acctPayNumber}, 'inbound', 'posted', ${String(amt)},
       ${journalId}, ${args.customerName || null}, ${args.date},
       ${args.sourceRef || null},
       ${"Pembayaran sport center " + args.type + " " + args.sourceRef},
       ${entry.id}, 'sport_center', ${args.paymentId}, ${args.createdById ?? null})
    RETURNING id
  `);
  const paymentId = Number(
    (payInsert.rows[0] as Record<string, unknown>)?.id ?? 0,
  );

  logger.info(
    { entryId: entry.id, paymentId, sourceId: args.sourceId, sportPaymentId: args.paymentId, amt },
    "[postSportCenterPaymentAtomic] Journal + payment posted atomically",
  );
  return { entryId: entry.id, paymentId, skipped: false };
}

/**
 * Auto-post saat pembayaran sewa Tenant dikonfirmasi.
 * Debit  : Kas/Bank
 * Credit : Pendapatan Sewa (fallback ke akun pendapatan penjualan)
 */
export async function postTenantRentPayment(args: {
  paymentId: number;
  paymentNumber: string;
  orderNumber: string;
  businessName: string;
  date: string;
  amount: number;
  createdById?: string | null;
  companyId?: number | null;
}): Promise<void> {
  try {
    const [existingEntry] = await db
      .select()
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'tenant_rent_payment' AND ${accountingEntriesTable.sourceId} = ${args.paymentId} AND ${accountingEntriesTable.companyId} = ${args.companyId ?? 1}`)
      .limit(1);
    if (existingEntry) {
      logger.info({ paymentId: args.paymentId, companyId: args.companyId }, "Tenant rent payment journal already posted — skipping");
      return;
    }

    const settings = await ensureAccountingSettings(args.companyId ?? 1);

    const debitAccountId = settings.defaultCashAccountId ?? settings.defaultBankAccountId;
    const creditAccountId = await resolveTenantRentIncomeAccountId(args.companyId, settings.salesIncomeAccountId, settings.tenantRentIncomeAccountId);
    const journalId = settings.cashJournalId ?? settings.bankJournalId;
    const journalCode = settings.cashJournalId ? "CSH" : "BNK";

    if (!debitAccountId || !creditAccountId || !journalId) {
      logger.warn(
        { paymentId: args.paymentId, companyId: args.companyId, debitAccountId, creditAccountId, journalId },
        "Skipping tenant rent payment post: akun kas/pendapatan atau jurnal belum dikonfigurasi",
      );
      return;
    }

    const costCenterId = await resolveCostCenterId("SPORT_CENTER", args.companyId);
    const amt = round2(args.amount);
    await postEntry(
      {
        journalId,
        date: new Date(args.date),
        ref: args.paymentNumber,
        description: `Pembayaran Sewa Tenant: ${args.businessName} (${args.orderNumber})`,
        source: "tenant_rent_payment",
        sourceId: args.paymentId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? 1,
        costCenterId,
        lines: [
          { accountId: debitAccountId, debit: amt, credit: 0, description: `Penerimaan sewa ${args.paymentNumber}` },
          { accountId: creditAccountId, debit: 0, credit: amt, description: `Pendapatan Sewa Tenant: ${args.businessName}` },
        ],
      },
      journalCode,
    );

    // Update posting_status setelah entry berhasil dibuat
    await db.execute(sql`
      UPDATE tenant_payments
      SET posting_status = 'posted',
          posted_to_accounting_at = NOW(),
          posting_error = NULL
      WHERE id = ${args.paymentId}
    `);

    logger.info({ paymentId: args.paymentId, amt }, "Tenant rent payment journal entry posted");
  } catch (err) {
    logger.error({ err, paymentId: args.paymentId }, "Auto-post tenant rent payment failed");
    // Tandai sebagai failed agar bisa di-retry
    try {
      await db.execute(sql`
        UPDATE tenant_payments
        SET posting_status = 'failed',
            posting_error = ${String((err as Error)?.message ?? "unknown error").slice(0, 500)}
        WHERE id = ${args.paymentId}
      `);
    } catch { /* non-fatal */ }
  }
}

/**
 * Post jurnal reversal saat booking Sport Center dibatalkan setelah pembayaran.
 * Membalik: Debit Pendapatan Sport Center, Credit Kas.
 */
export async function reverseSportCenterBooking(args: {
  bookingId: number;
  bookingNumber: string;
  amountReversed: number;
  createdById?: string | null;
  companyId?: number | null;
}): Promise<void> {
  try {
    if (args.amountReversed <= 0) return;

    const settings = await ensureAccountingSettings(args.companyId ?? 1);
    const debitAccountId = await resolveSportCenterBookingAccountId(args.companyId, settings.salesIncomeAccountId); // Pendapatan (di-debit untuk reversal)
    const creditAccountId = settings.defaultCashAccountId ?? settings.defaultBankAccountId; // Kas (di-kredit untuk reversal)
    const journalId = settings.cashJournalId ?? settings.bankJournalId;
    const journalCode = settings.cashJournalId ? "CSH" : "BNK";

    if (!debitAccountId || !creditAccountId || !journalId) {
      logger.warn(
        { bookingId: args.bookingId },
        "Skipping Sport Center reversal: akun atau jurnal belum dikonfigurasi",
      );
      return;
    }

    const costCenterId = await resolveCostCenterId("SPORT_CENTER", args.companyId);
    const amt = round2(args.amountReversed);
    await postEntry(
      {
        journalId,
        date: new Date(),
        ref: args.bookingNumber,
        description: `Cancellation of booking ${args.bookingNumber}`,
        source: "sport_center_booking_reversal",
        sourceId: args.bookingId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? 1,
        costCenterId,
        lines: [
          {
            accountId: debitAccountId,
            debit: amt,
            credit: 0,
            description: `Reversal pendapatan booking ${args.bookingNumber}`,
          },
          {
            accountId: creditAccountId,
            debit: 0,
            credit: amt,
            description: `Reversal kas booking ${args.bookingNumber}`,
          },
        ],
      },
      journalCode,
    );

    logger.info(
      { bookingId: args.bookingId, bookingNumber: args.bookingNumber, amt },
      "Sport Center booking reversal journal entry posted",
    );
  } catch (err) {
    logger.error({ err, bookingId: args.bookingId }, "Auto-post Sport Center reversal failed");
  }
}

/**
 * Post jurnal reversal saat bill pembelian dibatalkan.
 * Membalik semua baris debit/kredit dari jurnal purchase_bill asli.
 */
export async function postPurchaseBillReversal(args: {
  purchaseDocId: number;
  docNumber: string;
  supplierName: string;
  companyId?: number | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? undefined);
    if (!settings.purchaseJournalId) {
      logger.warn({ purchaseDocId: args.purchaseDocId }, "Skipping bill reversal: purchaseJournalId missing");
      return;
    }

    // Cari entri purchase_bill asli untuk PO ini
    const [entry] = await db
      .select()
      .from(accountingEntriesTable)
      .where(
        sql`${accountingEntriesTable.source} = 'purchase_bill' AND ${accountingEntriesTable.sourceId} = ${args.purchaseDocId}`,
      )
      .limit(1);

    if (!entry) {
      logger.warn({ purchaseDocId: args.purchaseDocId }, "No purchase_bill entry found to reverse — skipping");
      return;
    }

    // Pastikan belum pernah di-reversal (cek entri reversal dengan sourceId sama)
    const [existingReversal] = await db
      .select()
      .from(accountingEntriesTable)
      .where(
        sql`${accountingEntriesTable.source} = 'reversal' AND ${accountingEntriesTable.sourceId} = ${args.purchaseDocId}`,
      )
      .limit(1);
    if (existingReversal) {
      logger.info({ purchaseDocId: args.purchaseDocId }, "Bill reversal already posted — skipping");
      return;
    }

    // Ambil baris entri asli
    const entryLines = await db
      .select()
      .from(accountingEntryLinesTable)
      .where(eq(accountingEntryLinesTable.entryId, entry.id));

    if (!entryLines.length) {
      logger.warn({ purchaseDocId: args.purchaseDocId, entryId: entry.id }, "Original entry has no lines — skipping reversal");
      return;
    }

    // Balik debit/kredit
    const reversalLines: PostingLine[] = entryLines.map((l: EntryLine) => ({
      accountId: l.accountId,
      debit: round2(Number(l.credit)),
      credit: round2(Number(l.debit)),
      description: `[Batal] ${l.description ?? ""}`.trim(),
    }));

    await postEntry(
      {
        journalId: settings.purchaseJournalId,
        date: new Date(),
        ref: args.docNumber,
        description: `Pembatalan tagihan pembelian ${args.docNumber} - ${args.supplierName}`,
        source: "reversal",
        sourceId: args.purchaseDocId,
        companyId: args.companyId ?? null,
        lines: reversalLines,
      },
      "PUR",
    );

    logger.info({ purchaseDocId: args.purchaseDocId }, "Purchase bill reversal posted");
  } catch (err) {
    logger.error({ err, purchaseDocId: args.purchaseDocId }, "Auto-post purchase bill reversal failed");
  }
}

/**
 * Reversal jurnal penjualan saat SO dibatalkan.
 * Membalik entri sales_invoice: Credit AR / Debit Revenue.
 * Idempoten — hanya berjalan sekali per salesDocId.
 *
 * B2 FIX (true atomicity): menerima `client` (DbClient) sehingga semua operasi
 * — UPDATE status SO, SELECT lookup, INSERT accounting_entries, INSERT lines —
 * berjalan dalam SATU transaction yang sama dengan caller (sales.ts db.transaction).
 * Jika salah satu gagal → semua ROLLBACK. Tidak ada kondisi SO cancelled tanpa
 * reversal journal, maupun reversal journal tanpa SO cancelled.
 *
 * Menggunakan _postEntryCore(client, ...) langsung (bukan postEntry) agar
 * tidak memulai koneksi DB baru di dalam transaksi yang sudah berjalan.
 */
export async function postSalesInvoiceReversal(
  client: DbClient,
  args: {
    salesDocId: number;
    docNumber: string;
    customerName: string;
    companyId?: number | null;
  },
): Promise<void> {
  // Error harus propagate ke caller — tidak ada try/catch di sini.
  // Caller (sales.ts) sudah membungkus dalam db.transaction().
  const settings = await ensureAccountingSettings(args.companyId ?? undefined);
  if (!settings.salesJournalId) {
    logger.warn({ salesDocId: args.salesDocId }, "Skipping sales reversal: salesJournalId missing");
    return;
  }

  // Cari entri sales_invoice asli untuk SO ini — gunakan client (tx context)
  const [entry] = await client
    .select()
    .from(accountingEntriesTable)
    .where(
      sql`${accountingEntriesTable.source} = 'sales_invoice' AND ${accountingEntriesTable.sourceId} = ${args.salesDocId}`,
    )
    .limit(1);

  if (!entry) {
    logger.warn({ salesDocId: args.salesDocId }, "No sales_invoice entry found to reverse — skipping");
    return;
  }

  // Idempoten: cek apakah reversal untuk SO ini sudah ada — gunakan client (tx context)
  const [existingReversal] = await client
    .select()
    .from(accountingEntriesTable)
    .where(
      sql`${accountingEntriesTable.source} = 'reversal' AND ${accountingEntriesTable.sourceId} = ${args.salesDocId} AND ${accountingEntriesTable.journalId} = ${settings.salesJournalId}`,
    )
    .limit(1);
  if (existingReversal) {
    logger.info({ salesDocId: args.salesDocId }, "Sales invoice reversal already posted — skipping");
    return;
  }

  // Ambil baris entri asli — gunakan client (tx context)
  const entryLines = await client
    .select()
    .from(accountingEntryLinesTable)
    .where(eq(accountingEntryLinesTable.entryId, entry.id));

  if (!entryLines.length) {
    logger.warn({ salesDocId: args.salesDocId, entryId: entry.id }, "Original sales entry has no lines — skipping reversal");
    return;
  }

  // Balik debit/kredit
  const reversalLines: PostingLine[] = entryLines.map((l: EntryLine) => ({
    accountId: l.accountId,
    debit: round2(Number(l.credit)),
    credit: round2(Number(l.debit)),
    description: `[Batal] ${l.description ?? ""}`.trim(),
  }));

  // Gunakan _postEntryCore(client, ...) langsung — bukan postEntry(db, ...) —
  // agar INSERT accounting_entries + INSERT accounting_entry_lines memakai
  // KONEKSI YANG SAMA dengan tx.update(salesDocuments) di caller.
  await _postEntryCore(
    client,
    {
      journalId: settings.salesJournalId,
      date: new Date(),
      ref: args.docNumber,
      description: `Pembatalan penjualan ${args.docNumber} - ${args.customerName}`,
      source: "reversal",
      sourceId: args.salesDocId,
      companyId: args.companyId ?? null,
      lines: reversalLines,
    },
    "SAL",
  );

  logger.info({ salesDocId: args.salesDocId }, "Sales invoice reversal posted");
}

/**
 * Reversal jurnal booking Sport Center saat booking dibatalkan.
 * Membalik entri sport_center_booking: Debit Pendapatan / Credit Kas.
 * Idempoten — hanya berjalan sekali per bookingId.
 */
export async function postSportCenterBookingReversal(args: {
  bookingId: number;
  bookingCode: string;
  customerName: string;
  facilityName: string;
  companyId?: number | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? 1);
    const journalId = settings.cashJournalId ?? settings.bankJournalId;
    const journalCode = settings.cashJournalId ? "CSH" : "BNK";

    if (!journalId) {
      logger.warn({ bookingId: args.bookingId }, "Skipping sport center booking reversal: journal not configured");
      return;
    }

    const [entry] = await db
      .select()
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'sport_center_booking' AND ${accountingEntriesTable.sourceId} = ${args.bookingId}`)
      .limit(1);

    if (!entry) {
      logger.warn({ bookingId: args.bookingId }, "No sport_center_booking entry found to reverse — skipping");
      return;
    }

    const [existingReversal] = await db
      .select()
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'reversal' AND ${accountingEntriesTable.sourceId} = ${args.bookingId} AND ${accountingEntriesTable.journalId} = ${journalId}`)
      .limit(1);
    if (existingReversal) {
      logger.info({ bookingId: args.bookingId }, "Sport center booking reversal already posted — skipping");
      return;
    }

    const entryLines = await db
      .select()
      .from(accountingEntryLinesTable)
      .where(eq(accountingEntryLinesTable.entryId, entry.id));

    if (!entryLines.length) {
      logger.warn({ bookingId: args.bookingId, entryId: entry.id }, "Original sport center entry has no lines — skipping reversal");
      return;
    }

    const reversalLines: PostingLine[] = entryLines.map((l: EntryLine) => ({
      accountId: l.accountId,
      debit: round2(Number(l.credit)),
      credit: round2(Number(l.debit)),
      description: `[Batal] ${l.description ?? ""}`.trim(),
    }));

    await postEntry(
      {
        journalId,
        date: new Date(),
        ref: args.bookingCode,
        description: `Pembatalan booking Sport Center: ${args.facilityName} — ${args.customerName}`,
        source: "reversal",
        sourceId: args.bookingId,
        companyId: args.companyId ?? null,
        lines: reversalLines,
      },
      journalCode,
    );

    logger.info({ bookingId: args.bookingId, bookingCode: args.bookingCode }, "Sport Center booking reversal posted");
  } catch (err) {
    logger.error({ err, bookingId: args.bookingId }, "Auto-post sport center booking reversal failed");
  }
}

/**
 * Post jurnal refund Sport Center saat refund berstatus 'paid'.
 * Debit: Beban Operasional Lain (5-2040) / Credit: Kas.
 * Idempoten — hanya berjalan sekali per refundId.
 */
export async function postSportCenterRefund(args: {
  refundId: number;
  refundNumber: string;
  bookingCode: string;
  customerName: string;
  amount: number;
  companyId?: number | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? 1);
    const cashAccountId = settings.defaultCashAccountId ?? settings.defaultBankAccountId;
    const journalId = settings.cashJournalId ?? settings.bankJournalId;
    const journalCode = settings.cashJournalId ? "CSH" : "BNK";

    if (!cashAccountId || !journalId) {
      logger.warn({ refundId: args.refundId }, "Skipping sport center refund post: kas/bank atau jurnal belum dikonfigurasi");
      return;
    }

    // Task #6: fail-closed — hanya cari COA spesifik milik company ini.
    // TIDAK ada fallback ke company lain atau ke akun beban generik apapun.
    const companyFilter = args.companyId ?? 1;
    const [expenseAccount] = await db
      .select()
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} LIKE '5-2040%' AND ${chartOfAccountsTable.companyId} = ${companyFilter} AND ${chartOfAccountsTable.isActive} = true`)
      .limit(1);
    if (!expenseAccount) {
      // FAIL-CLOSED: COA spesifik tidak ditemukan → jurnal tidak dibuat, status tetap reviewable.
      logger.warn(
        { refundId: args.refundId, companyId: companyFilter },
        "[FAIL-CLOSED] sport_center_refund: COA 5-2040 spesifik tidak tersedia untuk perusahaan ini — jurnal tidak dibuat (SPECIFIC_COA_REQUIRED)",
      );
      throw Object.assign(
        new Error(`COA spesifik belum tersedia untuk "sport_center_refund" (intent: EXPENSE). Jurnal tidak dibuat — butuh review manual.`),
        { code: "SPECIFIC_COA_REQUIRED", manual_review_required: true },
      );
    }

    // Idempoten
    const [existing] = await db
      .select()
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'sport_center_refund' AND ${accountingEntriesTable.sourceId} = ${args.refundId}`)
      .limit(1);
    if (existing) {
      logger.info({ refundId: args.refundId }, "Sport center refund journal already posted — skipping");
      return;
    }

    const costCenterId = await resolveCostCenterId("SPORT_CENTER", args.companyId);
    const amt = round2(args.amount);
    await postEntry(
      {
        journalId,
        date: new Date(),
        ref: args.refundNumber,
        description: `Refund booking Sport Center ${args.bookingCode} — ${args.customerName}`,
        source: "sport_center_refund",
        sourceId: args.refundId,
        companyId: args.companyId ?? null,
        costCenterId,
        lines: [
          {
            accountId: expenseAccount.id,
            debit: amt,
            credit: 0,
            description: `Beban refund booking ${args.bookingCode}`,
          },
          {
            accountId: cashAccountId,
            debit: 0,
            credit: amt,
            description: `Pengembalian kas refund ${args.refundNumber}`,
          },
        ],
      },
      journalCode,
    );

    logger.info({ refundId: args.refundId, refundNumber: args.refundNumber, amt }, "Sport Center refund journal posted");
  } catch (err) {
    logger.error({ err, refundId: args.refundId }, "Auto-post sport center refund failed");
  }
}

/**
 * Post jurnal pembayaran membership Sport Center.
 * Debit  : Kas (defaultCashAccountId)
 * Credit : Pendapatan Membership Sport Center (COA 4-1016)
 * Source : sport_center_membership
 */
export async function postSportCenterMembershipPayment(args: {
  paymentId: number;
  paymentNumber: string;
  memberNumber: string;
  memberName: string;
  amount: number;
  companyId?: number | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? 1);
    const cashAccountId = settings.defaultCashAccountId;
    const journalId = settings.cashJournalId;

    if (!cashAccountId || !journalId) {
      logger.warn({ paymentId: args.paymentId }, "Skipping membership payment post: kas atau jurnal belum dikonfigurasi");
      return;
    }

    // Cari akun Pendapatan Membership Sport Center (4-1016-CST / 4-1016-WS / dst.)
    // Gunakan LIKE agar cocok dengan semua varian suffix perusahaan.
    const cFilter = args.companyId ?? 1;
    let [membershipAcc] = await db
      .select()
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} LIKE '4-1016%' AND ${chartOfAccountsTable.companyId} = ${cFilter}`)
      .limit(1);
    if (!membershipAcc) {
      [membershipAcc] = await db
        .select()
        .from(chartOfAccountsTable)
        .where(sql`${chartOfAccountsTable.code} LIKE '4-1016%' AND ${chartOfAccountsTable.companyId} IS NOT NULL`)
        .limit(1);
    }
    // Fallback ke Pendapatan Usaha jika COA 4-1016 belum di-seed
    if (!membershipAcc && settings.salesIncomeAccountId) {
      [membershipAcc] = await db
        .select()
        .from(chartOfAccountsTable)
        .where(eq(chartOfAccountsTable.id, settings.salesIncomeAccountId))
        .limit(1);
    }
    if (!membershipAcc) {
      logger.warn({ paymentId: args.paymentId }, "Skipping membership payment post: akun pendapatan membership tidak ditemukan di COA");
      return;
    }

    // Idempoten: skip jika sudah pernah diposting
    const [existing] = await db
      .select()
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'sport_center_membership' AND ${accountingEntriesTable.sourceId} = ${args.paymentId}`)
      .limit(1);
    if (existing) {
      logger.info({ paymentId: args.paymentId }, "Membership payment journal already posted — skipping");
      return;
    }

    const costCenterId = await resolveCostCenterId("SPORT_CENTER", args.companyId);
    const amt = round2(args.amount);
    await postEntry(
      {
        journalId,
        date: new Date(),
        ref: args.paymentNumber,
        description: `Membership Payment ${args.memberNumber} — ${args.memberName}`,
        source: "sport_center_membership",
        sourceId: args.paymentId,
        companyId: args.companyId ?? 1,
        costCenterId,
        lines: [
          {
            accountId: cashAccountId,
            debit: amt,
            credit: 0,
            description: `Penerimaan membership ${args.memberNumber}`,
          },
          {
            accountId: membershipAcc.id,
            debit: 0,
            credit: amt,
            description: `Pendapatan membership ${args.memberNumber}`,
          },
        ],
      },
      "CSH",
    );

    logger.info(
      { paymentId: args.paymentId, paymentNumber: args.paymentNumber, memberNumber: args.memberNumber, amt },
      "Sport Center membership payment journal posted",
    );
  } catch (err) {
    logger.error({ err, paymentId: args.paymentId }, "Auto-post Sport Center membership payment failed");
  }
}

/**
 * Post jurnal pembayaran booking Sport Center dengan PPN (3-arah).
 * Debit  : Kas                  = base_amount + tax_amount
 * Credit : Pendapatan           = base_amount
 * Credit : PPN Keluaran (2-2010)= tax_amount   (hanya jika tax_amount > 0)
 * Source : sport_center_booking
 * Idempoten — skip jika sourceId sudah diposting.
 */
export async function postSportCenterBookingWithTax(args: {
  bookingId: number;
  bookingCode: string;
  customerName: string;
  facilityName: string;
  date: string;
  baseAmount: number;
  taxAmount: number;
  createdById?: string | null;
  companyId?: number | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? 1);
    const cashAccountId = settings.defaultCashAccountId ?? settings.defaultBankAccountId;
    const incomeAccountId = await resolveSportCenterBookingAccountId(args.companyId, settings.salesIncomeAccountId);
    const journalId = settings.cashJournalId ?? settings.bankJournalId;
    const journalCode = settings.cashJournalId ? "CSH" : "BNK";

    if (!cashAccountId || !incomeAccountId || !journalId) {
      logger.warn({ bookingId: args.bookingId }, "Skipping Sport Center booking (with tax): akun atau jurnal belum dikonfigurasi");
      return;
    }

    // Idempoten (primary): by booking_id
    const [existing] = await db
      .select()
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'sport_center_booking' AND ${accountingEntriesTable.sourceId} = ${args.bookingId}`)
      .limit(1);
    if (existing) {
      logger.info({ bookingId: args.bookingId }, "Sport center booking (tax) journal already posted — skipping");
      return;
    }

    // Idempoten (secondary): by ref — mencegah duplikasi jika booking punya multiple local IDs
    if (args.bookingCode) {
      const [existingByRef] = await db
        .select()
        .from(accountingEntriesTable)
        .where(sql`${accountingEntriesTable.source} = 'sport_center_booking' AND ${accountingEntriesTable.ref} = ${args.bookingCode} AND ${accountingEntriesTable.companyId} = ${args.companyId ?? 1}`)
        .limit(1);
      if (existingByRef) {
        logger.info({ bookingId: args.bookingId, ref: args.bookingCode }, "Sport center booking (tax) journal already posted (by ref) — skipping duplicate");
        return;
      }
    }

    const base = round2(args.baseAmount);
    const tax  = round2(args.taxAmount);
    const total = round2(base + tax);

    const lines: PostingLine[] = [
      {
        accountId: cashAccountId,
        debit: total,
        credit: 0,
        description: `Penerimaan booking ${args.bookingCode}`,
      },
      {
        accountId: incomeAccountId,
        debit: 0,
        credit: base,
        description: `Pendapatan Sport Center: ${args.facilityName}`,
      },
    ];

    // Tambah baris PPN Keluaran jika ada pajak
    if (tax > 0 && settings.ppnOutputAccountId) {
      lines.push({
        accountId: settings.ppnOutputAccountId,
        debit: 0,
        credit: tax,
        description: `PPN Keluaran booking ${args.bookingCode}`,
      });
    }

    const costCenterId = await resolveCostCenterId("SPORT_CENTER", args.companyId);
    await postEntry(
      {
        journalId,
        date: new Date(args.date),
        ref: args.bookingCode,
        description: `Booking Sport Center: ${args.facilityName} — ${args.customerName} (${args.date})`,
        source: "sport_center_booking",
        sourceId: args.bookingId,
        createdById: args.createdById ?? null,
        companyId: args.companyId ?? 1,
        costCenterId,
        lines,
      },
      journalCode,
    );

    logger.info({ bookingId: args.bookingId, base, tax, total }, "Sport Center booking (with tax) journal posted");
  } catch (err) {
    logger.error({ err, bookingId: args.bookingId }, "Auto-post Sport Center booking (with tax) failed");
  }
}

/**
 * Post jurnal refund langsung booking Sport Center (source: sport_center_booking_refund).
 * Debit  : Pendapatan Sport Center
 * Credit : Kas
 * Idempoten per bookingId.
 */
export async function postSportCenterBookingRefundDirect(args: {
  bookingId: number;
  bookingCode: string;
  customerName: string;
  amount: number;
  companyId?: number | null;
}): Promise<void> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? 1);
    const cashAccountId = settings.defaultCashAccountId ?? settings.defaultBankAccountId;
    const incomeAccountId = await resolveSportCenterBookingAccountId(args.companyId, settings.salesIncomeAccountId);
    const journalId = settings.cashJournalId ?? settings.bankJournalId;
    const journalCode = settings.cashJournalId ? "CSH" : "BNK";

    if (!cashAccountId || !incomeAccountId || !journalId) {
      logger.warn({ bookingId: args.bookingId }, "Skipping sport center booking refund direct: akun atau jurnal belum dikonfigurasi");
      return;
    }

    // Idempoten — satu refund langsung per booking
    const [existing] = await db
      .select()
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'sport_center_booking_refund' AND ${accountingEntriesTable.sourceId} = ${args.bookingId}`)
      .limit(1);
    if (existing) {
      logger.info({ bookingId: args.bookingId }, "Sport center booking refund direct already posted — skipping");
      return;
    }

    const costCenterId = await resolveCostCenterId("SPORT_CENTER", args.companyId);
    const amt = round2(args.amount);
    await postEntry(
      {
        journalId,
        date: new Date(),
        ref: args.bookingCode,
        description: `Refund booking Sport Center ${args.bookingCode} — ${args.customerName}`,
        source: "sport_center_booking_refund",
        sourceId: args.bookingId,
        companyId: args.companyId ?? null,
        costCenterId,
        lines: [
          {
            accountId: incomeAccountId,
            debit: amt,
            credit: 0,
            description: `Debit pendapatan refund ${args.bookingCode}`,
          },
          {
            accountId: cashAccountId,
            debit: 0,
            credit: amt,
            description: `Pengembalian kas refund ${args.bookingCode}`,
          },
        ],
      },
      journalCode,
    );

    logger.info({ bookingId: args.bookingId, amt }, "Sport Center booking refund direct journal posted");
  } catch (err) {
    logger.error({ err, bookingId: args.bookingId }, "Auto-post sport center booking refund direct failed");
  }
}

/**
 * Post jurnal beban operasional Sport Center dari tabel sport_expenses.
 * Debit  : Beban Operasional (COA 5-2040-xxx)
 * Credit : Kas / Bank / Hutang Usaha (tergantung paymentMethod)
 * Idempoten per expenseId.
 */
export async function postSportCenterExpenseEntry(args: {
  expenseId: number;
  expenseNumber: string;
  facilityId?: number | null;
  category: string;
  description?: string | null;
  amount: number;
  paymentMethod: "cash" | "transfer" | "hutang";
  date: string;
  companyId?: number | null;
}): Promise<number | null> {
  try {
    const settings = await ensureAccountingSettings(args.companyId ?? 1);
    const journalId = settings.cashJournalId ?? settings.bankJournalId;
    const journalCode = settings.cashJournalId ? "CSH" : "BNK";

    if (!journalId) {
      logger.warn({ expenseId: args.expenseId }, "Skipping sport expense post: jurnal belum dikonfigurasi");
      return null;
    }

    // Resolusi akun kredit berdasarkan paymentMethod
    let creditAccountId: number | null = null;
    if (args.paymentMethod === "hutang") {
      creditAccountId = (settings as any).defaultPayableAccountId ?? settings.defaultBankAccountId ?? null;
    } else {
      creditAccountId = settings.defaultCashAccountId ?? settings.defaultBankAccountId ?? null;
    }

    if (!creditAccountId) {
      logger.warn({ expenseId: args.expenseId }, "Skipping sport expense post: akun kas/hutang tidak ditemukan");
      return null;
    }

    // Task #6: fail-closed — hanya cari COA spesifik milik company ini.
    // TIDAK ada fallback ke company lain atau ke akun beban generik apapun.
    const companyFilter = args.companyId ?? 1;
    const [expenseAccount] = await db
      .select()
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} LIKE '5-2040%' AND ${chartOfAccountsTable.companyId} = ${companyFilter} AND ${chartOfAccountsTable.isActive} = true`)
      .limit(1);
    if (!expenseAccount) {
      // FAIL-CLOSED: COA spesifik tidak ditemukan → jurnal tidak dibuat, status tetap reviewable.
      logger.warn(
        { expenseId: args.expenseId, companyId: companyFilter, category: args.category },
        "[FAIL-CLOSED] sport_center_expense: COA 5-2040 spesifik tidak tersedia untuk perusahaan ini — jurnal tidak dibuat (SPECIFIC_COA_REQUIRED)",
      );
      throw Object.assign(
        new Error(`COA spesifik belum tersedia untuk "sport_center_expense:${args.category}" (intent: EXPENSE). Jurnal tidak dibuat — butuh review manual.`),
        { code: "SPECIFIC_COA_REQUIRED", manual_review_required: true },
      );
    }

    // Idempoten
    const [existing] = await db
      .select()
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'sport_center_operational_expense' AND ${accountingEntriesTable.sourceId} = ${args.expenseId}`)
      .limit(1);
    if (existing) {
      logger.info({ expenseId: args.expenseId }, "Sport expense journal already posted — skipping");
      return existing.id;
    }

    const costCenterId = await resolveCostCenterId("SPORT_CENTER", args.companyId);
    const amt = round2(args.amount);
    const desc = args.description
      ? `[SC-EXP] ${args.expenseNumber} — ${args.category}: ${args.description}`
      : `[SC-EXP] ${args.expenseNumber} — ${args.category}`;

    const entry = await postEntry(
      {
        journalId,
        date: new Date(args.date),
        ref: args.expenseNumber,
        description: desc,
        source: "sport_center_operational_expense",
        sourceId: args.expenseId,
        companyId: args.companyId ?? null,
        costCenterId,
        facilityId: args.facilityId ?? null,
        expenseCategory: args.category,
        lines: [
          {
            accountId: expenseAccount.id,
            debit: amt,
            credit: 0,
            description: `Beban ${args.category} — ${args.expenseNumber}`,
          },
          {
            accountId: creditAccountId,
            debit: 0,
            credit: amt,
            description: args.paymentMethod === "hutang"
              ? `Hutang beban ${args.expenseNumber}`
              : `Pembayaran kas ${args.expenseNumber}`,
          },
        ],
      },
      journalCode,
    );

    logger.info({ expenseId: args.expenseId, expenseNumber: args.expenseNumber, amt }, "Sport Center expense journal posted");
    return entry?.id ?? null;
  } catch (err) {
    logger.error({ err, expenseId: args.expenseId }, "Auto-post sport center expense failed");
    return null;
  }
}
