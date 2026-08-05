/**
 * SAP HARDENING — FASE 3
 * Auto Repair Engine
 *
 * Menjalankan auto-healing sebelum NEED_REVIEW escalation:
 *
 *  1. COA MISSING    → similarity match → confidence > 80% = auto-assign, else NEED_COA_MAPPING
 *  2. SUBLEDGER MISSING → match by amount+date+customer → auto-link, else NEED_SUBLEDGER_LINK
 *  3. INTERNAL_TRANSFER UNPAIRED → retry pairing via transaction_pair_id + amount + timestamp
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { queueIntegrityError } from "./errorContainment.js";

// ─── Types ────────────────────────────────────────────────────────────────

export interface RepairResult {
  action: "AUTO_ASSIGNED" | "NEED_COA_MAPPING" | "AUTO_LINKED" | "NEED_SUBLEDGER_LINK" | "PAIRED" | "STILL_UNPAIRED" | "SKIPPED";
  confidence?: number;
  details?: string;
  coaDebit?: string | null;
  coaCredit?: string | null;
  linkedEntityId?: number | null;
}

// ─── P1: COA Missing Repair ───────────────────────────────────────────────

export async function repairCoaMissing(opts: {
  normalizedEntryId: number;
  description: string;
  erpCategory?: string | null;
  companyId?: number | null;
  actor?: string;
}): Promise<RepairResult> {
  try {
    // Look up master_coa_mapping by keyword similarity
    const keywords = extractKeywords(opts.description, opts.erpCategory);
    if (!keywords.length) {
      return { action: "NEED_COA_MAPPING", details: "Tidak ada keyword untuk matching" };
    }

    const keywordConditions = keywords
      .map((k) => `keyword ILIKE '%${k.replace(/'/g, "''")}%'`)
      .join(" OR ");
    const companyFilter = opts.companyId
      ? `AND (company_id = ${opts.companyId} OR company_id IS NULL)`
      : "";

    const { rows } = await db.execute(sql.raw(`
      SELECT coa_debit, coa_credit, confidence, keyword
      FROM master_coa_mapping
      WHERE is_active = TRUE
        AND (${keywordConditions})
        ${companyFilter}
      ORDER BY confidence DESC, LENGTH(keyword) DESC
      LIMIT 5
    `));

    if (!rows.length) {
      await escalateCoaMissing(opts.normalizedEntryId, opts.companyId);
      return { action: "NEED_COA_MAPPING", details: "Tidak ada mapping yang cocok" };
    }

    const best = rows[0] as any;
    const confidence = Number(best.confidence ?? 0);

    if (confidence >= 80) {
      // Auto-assign
      await db.execute(sql.raw(`
        UPDATE bank_mutation_normalized_entries
        SET coa_debit = '${(best.coa_debit ?? "").replace(/'/g, "''")}',
            coa_credit = '${(best.coa_credit ?? "").replace(/'/g, "''")}',
            coa_status = 'AUTO_ASSIGNED',
            updated_at = NOW()
        WHERE id = ${opts.normalizedEntryId}
      `));
      logger.info({
        normalizedEntryId: opts.normalizedEntryId,
        coaDebit: best.coa_debit,
        coaCredit: best.coa_credit,
        confidence,
      }, "[auto-repair] COA auto-assigned");
      return {
        action: "AUTO_ASSIGNED",
        confidence,
        coaDebit: best.coa_debit,
        coaCredit: best.coa_credit,
        details: `Matched via keyword "${best.keyword}" (${confidence}% confidence)`,
      };
    }

    // Confidence too low → escalate
    await escalateCoaMissing(opts.normalizedEntryId, opts.companyId);
    return {
      action: "NEED_COA_MAPPING",
      confidence,
      details: `Confidence ${confidence}% < 80% — membutuhkan review manual`,
    };
  } catch (err) {
    logger.warn({ err, id: opts.normalizedEntryId }, "[auto-repair] repairCoaMissing error");
    return { action: "NEED_COA_MAPPING", details: String(err) };
  }
}

// ─── P2: Subledger Missing Repair ────────────────────────────────────────

export async function repairSubledgerMissing(opts: {
  normalizedEntryId: number;
  amount: number;
  transactionDate: string;
  entityName?: string | null;
  companyId?: number | null;
}): Promise<RepairResult> {
  try {
    // Try to match invoice/booking/order by amount + date (±3 days) + customer name
    const dateFrom = shiftDate(opts.transactionDate, -3);
    const dateTo   = shiftDate(opts.transactionDate, 3);
    const amtMin   = (opts.amount * 0.999).toFixed(2);
    const amtMax   = (opts.amount * 1.001).toFixed(2);
    const companyFilter = opts.companyId ? `AND company_id = ${opts.companyId}` : "";
    const nameFilter = opts.entityName
      ? `AND (customer_name ILIKE '%${opts.entityName.replace(/'/g, "''").slice(0, 50)}%' OR partner_name ILIKE '%${opts.entityName.replace(/'/g, "''").slice(0, 50)}%')`
      : "";

    // Search sales_documents
    const { rows: salesRows } = await db.execute(sql.raw(`
      SELECT id, 'sales_invoice' AS entity_type, doc_number AS ref,
             grand_total AS amount, issue_date AS tx_date
      FROM sales_documents
      WHERE grand_total BETWEEN ${amtMin} AND ${amtMax}
        AND issue_date BETWEEN '${dateFrom}' AND '${dateTo}'
        AND status NOT IN ('cancelled','draft')
        ${companyFilter}
        ${nameFilter}
      LIMIT 1
    `));

    if (salesRows.length) {
      const match = salesRows[0] as any;
      await db.execute(sql.raw(`
        UPDATE bank_mutation_normalized_entries
        SET subledger_status = 'AUTO_LINKED',
            updated_at = NOW()
        WHERE id = ${opts.normalizedEntryId}
      `));
      logger.info({ normalizedEntryId: opts.normalizedEntryId, match }, "[auto-repair] subledger auto-linked");
      return {
        action: "AUTO_LINKED",
        linkedEntityId: match.id,
        details: `Linked ke ${match.entity_type} #${match.ref} (${match.amount})`,
      };
    }

    // No match → escalate
    await escalateSubledgerMissing(opts.normalizedEntryId, opts.companyId);
    return {
      action: "NEED_SUBLEDGER_LINK",
      details: "Tidak ada invoice/order yang cocok berdasarkan amount+date",
    };
  } catch (err) {
    logger.warn({ err, id: opts.normalizedEntryId }, "[auto-repair] repairSubledgerMissing error");
    return { action: "NEED_SUBLEDGER_LINK", details: String(err) };
  }
}

// ─── P3: Internal Transfer Pairing Retry ─────────────────────────────────

export async function repairUnpairedTransfer(opts: {
  normalizedEntryId: number;
  transactionPairId: string;
  amount: number;
  transactionDate: string;
  companyId?: number | null;
}): Promise<RepairResult> {
  try {
    // Find the mirror entry by transaction_pair_id + amount + date (±1 day)
    const dateFrom = shiftDate(opts.transactionDate, -1);
    const dateTo   = shiftDate(opts.transactionDate, 1);
    const amtMin   = (opts.amount * 0.999).toFixed(2);
    const amtMax   = (opts.amount * 1.001).toFixed(2);

    const { rows } = await db.execute(sql.raw(`
      SELECT id FROM bank_mutation_normalized_entries
      WHERE transaction_pair_id = '${opts.transactionPairId.replace(/'/g, "''")}'
        AND ABS(amount) BETWEEN ${amtMin} AND ${amtMax}
        AND transaction_date BETWEEN '${dateFrom}' AND '${dateTo}'
        AND id <> ${opts.normalizedEntryId}
        AND status NOT IN ('SUPERSEDED','DUPLICATE')
      LIMIT 1
    `));

    if (rows.length) {
      const mirror = rows[0] as any;
      // Mark both as paired (update status to READY if they were stuck)
      await db.execute(sql.raw(`
        UPDATE bank_mutation_normalized_entries
        SET subledger_status = 'PAIRED', updated_at = NOW()
        WHERE id IN (${opts.normalizedEntryId}, ${mirror.id})
          AND subledger_status <> 'PAIRED'
      `));
      logger.info({
        entryId: opts.normalizedEntryId,
        mirrorId: mirror.id,
        pairId: opts.transactionPairId,
      }, "[auto-repair] internal transfer paired");
      return {
        action: "PAIRED",
        linkedEntityId: mirror.id,
        details: `Dipasangkan dengan entry ID ${mirror.id} via pair_id=${opts.transactionPairId}`,
      };
    }

    return {
      action: "STILL_UNPAIRED",
      details: `Tidak ada mirror entry untuk pair_id=${opts.transactionPairId}`,
    };
  } catch (err) {
    logger.warn({ err, id: opts.normalizedEntryId }, "[auto-repair] repairUnpairedTransfer error");
    return { action: "STILL_UNPAIRED", details: String(err) };
  }
}

// ─── Run full auto-repair pass on a batch ────────────────────────────────

export async function runAutoRepairBatch(
  batchId: number,
  companyId?: number | null,
  actor: string = "SYSTEM",
): Promise<{ repaired: number; escalated: number; skipped: number }> {
  let repaired = 0;
  let escalated = 0;
  let skipped = 0;

  try {
    // Fetch entries that need repair (NEED_REVIEW, coa_status=MISSING or subledger_status=MISSING)
    const { rows } = await db.execute(sql.raw(`
      SELECT id, description, erp_category, amount, transaction_date,
             entity_name, coa_status, subledger_status, transaction_pair_id,
             coa_debit, coa_credit
      FROM bank_mutation_normalized_entries
      WHERE batch_id = ${batchId}
        AND status IN ('NEED_REVIEW','READY')
        AND is_latest_version = TRUE
        AND (
          (coa_status IN ('MISSING','PENDING') AND (coa_debit IS NULL OR coa_credit IS NULL))
          OR subledger_status IN ('MISSING')
          OR (transaction_pair_id IS NOT NULL AND subledger_status = 'MISSING')
        )
      LIMIT 200
    `));

    for (const row of rows as any[]) {
      let anyRepaired = false;

      // P1: COA missing
      if ((row.coa_status === "MISSING" || row.coa_status === "PENDING") && (!row.coa_debit || !row.coa_credit)) {
        const result = await repairCoaMissing({
          normalizedEntryId: row.id,
          description: row.description ?? "",
          erpCategory: row.erp_category,
          companyId,
          actor,
        });
        if (result.action === "AUTO_ASSIGNED") anyRepaired = true;
        else escalated++;
      }

      // P2: Subledger missing (only if no pair_id)
      if (row.subledger_status === "MISSING" && !row.transaction_pair_id) {
        const result = await repairSubledgerMissing({
          normalizedEntryId: row.id,
          amount: Number(row.amount ?? 0),
          transactionDate: row.transaction_date,
          entityName: row.entity_name,
          companyId,
        });
        if (result.action === "AUTO_LINKED") anyRepaired = true;
        else escalated++;
      }

      // P3: Internal transfer unpaired
      if (row.transaction_pair_id && row.subledger_status === "MISSING") {
        const result = await repairUnpairedTransfer({
          normalizedEntryId: row.id,
          transactionPairId: row.transaction_pair_id,
          amount: Number(row.amount ?? 0),
          transactionDate: row.transaction_date,
          companyId,
        });
        if (result.action === "PAIRED") anyRepaired = true;
        else escalated++;
      }

      if (anyRepaired) repaired++;
      else if (!anyRepaired) skipped++;
    }

    logger.info({ batchId, repaired, escalated, skipped }, "[auto-repair] batch selesai");
  } catch (err) {
    logger.warn({ err, batchId }, "[auto-repair] runAutoRepairBatch error");
    await queueIntegrityError({
      companyId,
      classification: "MEDIUM",
      module: "bank_mutation",
      errorCode: "AUTO_REPAIR_FAILED",
      message: `Auto repair batch ${batchId} error: ${(err as any)?.message}`,
      entityType: "batch",
      entityId: String(batchId),
    });
  }

  return { repaired, escalated, skipped };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function extractKeywords(description: string, erpCategory?: string | null): string[] {
  const words = new Set<string>();
  const stopWords = new Set(["dan", "the", "to", "of", "for", "dari", "ke", "ke", "pada"]);
  const rawWords = `${description ?? ""} ${erpCategory ?? ""}`
    .toLowerCase()
    .split(/[\s\-_/,]+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));
  for (const w of rawWords) words.add(w);
  return Array.from(words).slice(0, 8);
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

async function escalateCoaMissing(entryId: number, companyId?: number | null): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE bank_mutation_normalized_entries
    SET coa_status = 'NEED_COA_MAPPING', status = 'NEED_REVIEW', updated_at = NOW()
    WHERE id = ${entryId}
  `)).catch(() => {});
  await queueIntegrityError({
    companyId,
    classification: "MEDIUM",
    module: "bank_mutation",
    errorCode: "NEED_COA_MAPPING",
    message: `COA mapping diperlukan untuk normalized entry ID ${entryId}`,
    entityType: "normalized_entry",
    entityId: String(entryId),
  });
}

async function escalateSubledgerMissing(entryId: number, companyId?: number | null): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE bank_mutation_normalized_entries
    SET subledger_status = 'NEED_SUBLEDGER_LINK', status = 'NEED_REVIEW', updated_at = NOW()
    WHERE id = ${entryId}
  `)).catch(() => {});
  await queueIntegrityError({
    companyId,
    classification: "MEDIUM",
    module: "bank_mutation",
    errorCode: "NEED_SUBLEDGER_LINK",
    message: `Subledger link diperlukan untuk normalized entry ID ${entryId}`,
    entityType: "normalized_entry",
    entityId: String(entryId),
  });
}
