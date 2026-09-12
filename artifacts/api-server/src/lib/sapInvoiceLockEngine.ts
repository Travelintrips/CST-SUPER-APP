/**
 * SAP-LEVEL ERP INVOICE LOCK ENGINE
 * ===================================
 * Final financial data integrity layer for vendor invoices.
 *
 * CRITICAL RULES (NON-NEGOTIABLE):
 *  1. Backend is the ONLY source of truth for all financial values.
 *  2. NEVER allow recalculation from frontend or items.
 *  3. NEVER allow AI or OCR to override final locked values.
 *  4. All invoices are immutable after posting.
 *
 * TAX RULE — STRICT HEADER MODE:
 *  If invoice has totalAmount (net) + taxAmount (vat) + grandTotal (gross):
 *    → tax_mode = HEADER_TAX_LOCKED
 *    → IGNORE all item-level tax
 *    → IGNORE all item-level calculations
 *    → NEVER recompute totals
 *
 * IMMUTABILITY RULE:
 *  If invoice.status IN (posted, matched, paid):
 *    → BLOCK updates to net / vat / gross / journal entries
 *    → Only allowed action: CREATE reversal entry
 *
 * VALIDATION ENGINE:
 *  expected_gross = net + vat
 *  IF |gross - expected_gross| > 100 → flag TAX_MISMATCH (DO NOT FIX)
 *
 * POSTING RULE:
 *  When invoice is POSTED:
 *    1. Generate journal entry (handled by purchaseWorkflow.ts)
 *    2. Lock invoice (status → posted)
 *    3. Store immutable snapshot (sap_lock_snapshot column)
 *
 * OUTPUT FORMAT (always):
 *  { status, tax_mode, validated, flags }
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { reportImmutabilityViolation } from "./ledgerImmutability.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Statuses that trigger full immutability. */
export const INVOICE_LOCK_STATUSES = ["posted", "matched", "paid"] as const;
export type InvoiceLockStatus = typeof INVOICE_LOCK_STATUSES[number];

/** TAX_MISMATCH tolerance in IDR. Per spec: DO NOT fix, only flag. */
export const SAP_TAX_TOLERANCE_IDR = 100;

/** Financial fields that become immutable once invoice is locked. */
export const SAP_INVOICE_IMMUTABLE_FIELDS = [
  "totalAmount",   // net / DPP
  "taxAmount",     // vat / PPN
  "grandTotal",    // gross / TOTAL
  "journalEntryId",
  "total_amount",
  "tax_amount",
  "grand_total",
  "journal_entry_id",
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SapTaxMode = "HEADER_TAX_LOCKED" | "NONE";
export type SapInvoiceStatus = "LOCKED" | "DRAFT";
export type SapFlag = "TAX_MISMATCH" | "MISSING_NET" | "MISSING_VAT" | "MISSING_GROSS";

export interface SapInvoiceLockInput {
  id: number;
  status: string;
  totalAmount: string | number | null;   // net / DPP
  taxAmount: string | number | null;     // vat / PPN
  grandTotal: string | number | null;   // gross / TOTAL
  invoiceNumber?: string;
  companyId?: number | null;
}

export interface SapInvoiceLockResult {
  /** "LOCKED" if status in posted/matched/paid; "DRAFT" otherwise. */
  status: SapInvoiceStatus;
  /** HEADER_TAX_LOCKED if all three fields present; NONE otherwise. */
  tax_mode: SapTaxMode;
  /** True if gross === net + vat within tolerance. */
  validated: boolean;
  /** TAX_MISMATCH if |gross - (net+vat)| > 100, etc. */
  flags: SapFlag[];
  /** Parsed financial values (always from DB, never recomputed). */
  values: {
    net: number | null;
    vat: number | null;
    gross: number | null;
    expected_gross: number | null;
    mismatch_amount: number | null;
  };
}

// ── Core Engine ───────────────────────────────────────────────────────────────

function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Run the SAP Invoice Lock Engine against a vendor invoice record.
 * Pure function — reads from input, writes nothing.
 */
export function runSapInvoiceLockEngine(input: SapInvoiceLockInput): SapInvoiceLockResult {
  const flags: SapFlag[] = [];

  // STEP 0: Determine lock status
  const isLocked = INVOICE_LOCK_STATUSES.includes(input.status as InvoiceLockStatus);
  const status: SapInvoiceStatus = isLocked ? "LOCKED" : "DRAFT";

  // STEP 1: Extract header values ONLY — no derivation
  const net   = toNum(input.totalAmount);
  const vat   = toNum(input.taxAmount);
  const gross = toNum(input.grandTotal);

  // STEP 2: Determine tax mode — HEADER_TAX_LOCKED only if all three present
  const hasAllThree = net != null && vat != null && gross != null;
  const tax_mode: SapTaxMode = hasAllThree ? "HEADER_TAX_LOCKED" : "NONE";

  // STEP 3: Flag individual missing fields (warning, not blocking)
  if (net   == null) flags.push("MISSING_NET");
  if (vat   == null) flags.push("MISSING_VAT");
  if (gross == null) flags.push("MISSING_GROSS");

  // STEP 4: Validation engine
  // expected_gross = net + vat
  // IF |gross - expected_gross| > SAP_TAX_TOLERANCE_IDR → flag TAX_MISMATCH
  // DO NOT FIX THE VALUE — only flag.
  let validated = false;
  let expected_gross: number | null = null;
  let mismatch_amount: number | null = null;

  if (net != null && vat != null && gross != null) {
    expected_gross = net + vat;
    mismatch_amount = Math.abs(gross - expected_gross);

    if (mismatch_amount > SAP_TAX_TOLERANCE_IDR) {
      flags.push("TAX_MISMATCH");
      validated = false;
    } else {
      validated = true;
    }
  }

  return {
    status,
    tax_mode,
    validated,
    flags,
    values: {
      net,
      vat,
      gross,
      expected_gross,
      mismatch_amount,
    },
  };
}

// ── Immutability Guard ────────────────────────────────────────────────────────

export interface InvoiceImmutabilityResult {
  /** True = update is BLOCKED. */
  blocked: boolean;
  blockedFields: string[];
  message?: string;
  sapResult?: SapInvoiceLockResult;
}

/**
 * Guard for PUT /vendor-invoices/:id
 *
 * Call BEFORE applying any update.
 * Returns { blocked: true } if the invoice is locked AND any attempted
 * field is a financial/journal field.
 */
export async function guardInvoiceUpdate(
  invoiceId: number,
  attemptedBodyKeys: string[],
  actor?: string,
): Promise<InvoiceImmutabilityResult> {
  let row: any;
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, status, total_amount, tax_amount, grand_total, invoice_number, company_id
      FROM vendor_invoices
      WHERE id = ${invoiceId}
      LIMIT 1
    `));
    row = rows[0];
  } catch (err) {
    logger.warn({ err, invoiceId }, "[sap-invoice-lock] DB read failed in guardInvoiceUpdate");
    return { blocked: false, blockedFields: [] };
  }

  if (!row) return { blocked: false, blockedFields: [] };

  const sapResult = runSapInvoiceLockEngine({
    id: invoiceId,
    status: String(row.status ?? "draft"),
    totalAmount: row.total_amount,
    taxAmount: row.tax_amount,
    grandTotal: row.grand_total,
    invoiceNumber: row.invoice_number,
    companyId: row.company_id ? Number(row.company_id) : null,
  });

  if (sapResult.status !== "LOCKED") {
    return { blocked: false, blockedFields: [], sapResult };
  }

  // Invoice is locked — check if any attempted field is immutable
  const blockedFields = attemptedBodyKeys.filter((k) =>
    SAP_INVOICE_IMMUTABLE_FIELDS.includes(k as any),
  );

  if (blockedFields.length === 0) {
    // Non-financial fields (notes, etc.) are still updatable
    return { blocked: false, blockedFields: [], sapResult };
  }

  // Report to integrity audit queue
  await reportImmutabilityViolation({
    companyId: row.company_id ? Number(row.company_id) : null,
    entryId: invoiceId,
    attemptedAction: "UPDATE",
    actor: actor ?? "UNKNOWN",
  }).catch(() => {});

  logger.warn({
    invoiceId,
    status: row.status,
    blockedFields,
    actor,
  }, "[sap-invoice-lock] IMMUTABILITY VIOLATION — update blocked on locked invoice");

  return {
    blocked: true,
    blockedFields,
    message: `Invoice ${row.invoice_number ?? invoiceId} sudah ${String(row.status).toUpperCase()} — field [${blockedFields.join(", ")}] tidak bisa diubah. Buat reversal entry untuk koreksi.`,
    sapResult,
  };
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

/**
 * Store an immutable SAP lock snapshot on the vendor invoice record.
 * Called AFTER posting succeeds — captures the final locked state.
 *
 * Writes to: vendor_invoices.sap_lock_snapshot (JSONB, added via boot migration)
 */
export async function lockInvoiceSnapshot(
  invoiceId: number,
  vi: SapInvoiceLockInput,
  actor: string = "SYSTEM",
): Promise<void> {
  const sapResult = runSapInvoiceLockEngine(vi);

  const snapshot = {
    locked_at: new Date().toISOString(),
    locked_by: actor,
    sap_status: sapResult.status,
    sap_tax_mode: sapResult.tax_mode,
    sap_validated: sapResult.validated,
    sap_flags: sapResult.flags,
    values: sapResult.values,
    source: "SAP_INVOICE_LOCK_ENGINE_v1",
  };

  try {
    await db.execute(sql.raw(`
      UPDATE vendor_invoices
      SET sap_lock_snapshot = '${JSON.stringify(snapshot).replace(/'/g, "''")}'::jsonb
      WHERE id = ${invoiceId}
    `));
    logger.info({ invoiceId, actor, flags: sapResult.flags }, "[sap-invoice-lock] snapshot stored");
  } catch (err) {
    // Column may not exist yet (boot migration pending) — non-fatal
    logger.warn({ err, invoiceId }, "[sap-invoice-lock] snapshot write skipped (column may be pending)");
  }
}

// ── Validate API Input (for OCR / AI / external submission) ──────────────────

export interface SapInputValidationResult {
  accepted: boolean;
  rejectReason?: string;
  sapResult: SapInvoiceLockResult;
}

/**
 * Validate incoming invoice data from ANY source (OCR, AI, frontend, API).
 *
 * Rules:
 *  - If invoice is already LOCKED → reject ALL financial field updates
 *  - If HEADER_TAX_LOCKED → reject any attempt to recompute from items
 *  - TAX_MISMATCH > 100 → accept but flag (DO NOT auto-fix)
 */
export function validateSapInvoiceInput(
  existingInvoice: SapInvoiceLockInput,
  incomingData: Record<string, unknown>,
): SapInputValidationResult {
  const sapResult = runSapInvoiceLockEngine(existingInvoice);

  if (sapResult.status === "LOCKED") {
    const financialAttempts = Object.keys(incomingData).filter((k) =>
      SAP_INVOICE_IMMUTABLE_FIELDS.includes(k as any),
    );
    if (financialAttempts.length > 0) {
      return {
        accepted: false,
        rejectReason: `SAP LOCK: Invoice sudah ${existingInvoice.status.toUpperCase()} — field [${financialAttempts.join(", ")}] tidak bisa dioverride dari sumber manapun (OCR/AI/frontend/API). Buat reversal entry.`,
        sapResult,
      };
    }
  }

  return { accepted: true, sapResult };
}

// ── SAP Journal Posting Engine (FI Module) ───────────────────────────────────

export interface SapJournalEntry {
  account: string;
  debit: number;
  credit: number;
}

export interface SapJournal {
  journal_id: string;
  invoice_id: number | string;
  entries: SapJournalEntry[];
  /** POSTED = immutable live journal | REVERSED = reversal journal */
  status: "POSTED" | "REVERSED";
  reversed_from?: string;
  created_at: string;
}

/**
 * SAP JOURNAL POSTING ENGINE (FI Module)
 * ----------------------------------------
 * Converts a POSTED invoice into a balanced double-entry journal.
 *
 * RULES (NON-NEGOTIABLE per spec):
 *  1. Only POSTED invoices can generate journals → throw INVOICE_NOT_POSTED
 *  2. SUM(debit) MUST equal SUM(credit)         → throw JOURNAL_NOT_BALANCED
 *  3. Journals are immutable after creation     → use reverseJournal() for corrections
 *
 * Account mapping (SAP FI convention):
 *   NET   → Expense / Revenue (DR)
 *   VAT   → VAT Payable        (CR)
 *   GROSS → Accounts Payable   (CR)
 */
export function createSapJournal(invoice: {
  id: number | string;
  status: string;
  net?: number | null;
  vat?: number | null;
  gross?: number | null;
  totalAmount?: number | string | null;
  taxAmount?: number | string | null;
  grandTotal?: number | string | null;
}): SapJournal {
  if (!invoice || invoice.status.toLowerCase() !== "posted") {
    throw new Error("INVOICE_NOT_POSTED");
  }

  const net   = Number(invoice.net   ?? invoice.totalAmount   ?? 0) || 0;
  const vat   = Number(invoice.vat   ?? invoice.taxAmount     ?? 0) || 0;
  const gross = Number(invoice.gross ?? invoice.grandTotal    ?? 0) || 0;

  const entries: SapJournalEntry[] = [
    { account: "Expense",          debit: net,   credit: 0     },
    { account: "VAT Payable",      debit: 0,     credit: vat   },
    { account: "Accounts Payable", debit: 0,     credit: gross },
  ];

  const totalDebit  = entries.reduce((s, e) => s + e.debit,  0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

  if (totalDebit !== totalCredit) {
    throw new Error(
      `JOURNAL_NOT_BALANCED — debit=${totalDebit} credit=${totalCredit} diff=${totalDebit - totalCredit}`,
    );
  }

  return {
    journal_id: crypto.randomUUID(),
    invoice_id: invoice.id,
    entries,
    status:     "POSTED",
    created_at: new Date().toISOString(),
  };
}

/**
 * SAP REVERSE ENGINE
 * -------------------
 * Swaps every debit↔credit from an existing POSTED journal.
 *
 * RULES (NON-NEGOTIABLE per spec):
 *  1. Only POSTED journals can be reversed → throw ONLY_POSTED_JOURNAL_CAN_BE_REVERSED
 *  2. NEVER edit the original journal — always create a new REVERSED journal
 *  3. reversed_from stores the original journal_id for audit trail
 */
export function reverseJournal(originalJournal: SapJournal): SapJournal {
  if (!originalJournal || originalJournal.status !== "POSTED") {
    throw new Error("ONLY_POSTED_JOURNAL_CAN_BE_REVERSED");
  }

  const reversedEntries: SapJournalEntry[] = originalJournal.entries.map((e) => ({
    account: e.account,
    debit:   e.credit,
    credit:  e.debit,
  }));

  return {
    journal_id:    crypto.randomUUID(),
    invoice_id:    originalJournal.invoice_id,
    reversed_from: originalJournal.journal_id,
    entries:       reversedEntries,
    status:        "REVERSED",
    created_at:    new Date().toISOString(),
  };
}

/**
 * Persist a SapJournal to `sap_journals` + `sap_journal_entries`.
 * Statements are split per pgBouncer transaction-mode multi-statement restriction.
 */
export async function storeSapJournal(journal: SapJournal): Promise<SapJournal> {
  await db.execute(sql`
    INSERT INTO sap_journals (id, invoice_id, status, reversed_from, created_at)
    VALUES (
      ${journal.journal_id},
      ${String(journal.invoice_id)},
      ${journal.status},
      ${journal.reversed_from ?? null},
      ${journal.created_at}::timestamptz
    )
  `);

  for (const entry of journal.entries) {
    await db.execute(sql`
      INSERT INTO sap_journal_entries (id, journal_id, account, debit, credit)
      VALUES (
        ${crypto.randomUUID()},
        ${journal.journal_id},
        ${entry.account},
        ${entry.debit},
        ${entry.credit}
      )
    `);
  }

  return journal;
}

/**
 * Fetch the latest POSTED SapJournal (with entries) for an invoice.
 * Returns null if none exists.
 */
export async function getSapJournalByInvoice(invoiceId: number | string): Promise<SapJournal | null> {
  const result = await db.execute<{
    journal_id: string;
    invoice_id: string;
    status: string;
    reversed_from: string | null;
    created_at: string;
    account: string;
    debit: string;
    credit: string;
  }>(sql`
    SELECT j.id          AS journal_id,
           j.invoice_id,
           j.status,
           j.reversed_from,
           j.created_at::text,
           e.account,
           e.debit::text,
           e.credit::text
    FROM   sap_journals j
    JOIN   sap_journal_entries e ON e.journal_id = j.id
    WHERE  j.invoice_id = ${String(invoiceId)}
      AND  j.status = 'POSTED'
    ORDER  BY j.created_at DESC, e.id
  `);

  if (!result.rows.length) return null;
  const first = result.rows[0];
  return {
    journal_id:    first.journal_id,
    invoice_id:    first.invoice_id,
    status:        first.status as "POSTED" | "REVERSED",
    reversed_from: first.reversed_from ?? undefined,
    created_at:    first.created_at,
    entries: result.rows.map((r) => ({
      account: r.account,
      debit:   Number(r.debit),
      credit:  Number(r.credit),
    })),
  };
}

// ── Journal Entry Guard ───────────────────────────────────────────────────────

export interface JournalEntryLine {
  account: string;
  debit: number;
  credit: number;
}

export interface JournalEntryResult {
  invoice_id: number;
  entries: JournalEntryLine[];
}

/**
 * Create a journal entry structure for a vendor invoice.
 *
 * JOURNAL LOCK RULE (ERP CORE):
 *  If invoice.is_locked = true → throw immediately.
 *  This is the last safety gate before any accounting write.
 *
 * The returned structure is passed to postEntry() / safeAccountingPost().
 * Actual DB write is handled by the caller — this function is pure.
 *
 * Account mapping (SAP convention):
 *   Debit  Expense / Revenue   = net   (DPP)
 *   Debit  VAT Payable (input) = vat   (PPN Masukan)
 *   Credit Accounts Payable    = gross (Total Hutang)
 */
export function createJournalEntry(invoice: {
  id: number;
  is_locked?: boolean;
  net: number | null;
  vat: number | null;
  gross: number | null;
}): JournalEntryResult {
  if (invoice.is_locked === true) {
    throw new Error(
      `Cannot modify journal of locked invoice (id=${invoice.id}). ` +
      "Invoice is LOCKED — create a reversal entry instead.",
    );
  }

  const net   = invoice.net   ?? 0;
  const vat   = invoice.vat   ?? 0;
  const gross = invoice.gross ?? net + vat;

  const entries: JournalEntryLine[] = [
    { account: "Expense / Revenue", debit: net,   credit: 0     },
    { account: "VAT Payable",       debit: vat,   credit: 0     },
    { account: "Accounts Payable",  debit: 0,     credit: gross },
  ];

  return { invoice_id: invoice.id, entries };
}
