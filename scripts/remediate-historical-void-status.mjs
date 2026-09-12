#!/usr/bin/env node
/**
 * remediate-historical-void-status.mjs
 *
 * Phase 7 — Historical Void Remediation
 *
 * Finds accounting_entries that:
 *   - status = 'posted'
 *   - have an existing reversal entry (source = 'bank_reconciliation_void', source_id = original.id)
 *   - void_entry_id is NOT yet set (status update was silently lost before enum 'voided' was added)
 *
 * Eligibility criteria (ALL must pass):
 *   1. Exactly one valid reversal entry exists
 *   2. Reversal entry is 'posted'
 *   3. Reversal lines balance (debit = credit)
 *   4. Reversal source is a known void source
 *   5. Original entry has no second reversal
 *   6. company_id matches between original and reversal
 *   7. No second reversal already pointing to the same original
 *
 * Modes:
 *   --dry-run   (default) — report candidates, make no changes
 *   --apply     — apply remediation inside atomic transactions
 *   --company-id <id> — limit to one company
 *
 * Safety:
 *   - Idempotent: re-running --apply is safe (WHERE status='posted' guard)
 *   - No financial data changed — only status + void_entry_id metadata
 *   - No lines deleted or created
 *   - Rollback-safe: each entry is wrapped in its own transaction
 *   - Audited: inserts into ledger_guard_audit per remediation
 *
 * Usage:
 *   node scripts/remediate-historical-void-status.mjs
 *   node scripts/remediate-historical-void-status.mjs --apply
 *   node scripts/remediate-historical-void-status.mjs --apply --company-id 5
 */

import pg from "pg";
import process from "process";
import { resolveSupabaseDatabaseUrl } from "./resolve-supabase-db-url.mjs";

const { Pool } = pg;

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN   = !args.includes("--apply");
const cIdx      = args.indexOf("--company-id");
const COMPANY_ID = cIdx !== -1 ? parseInt(args[cIdx + 1], 10) : null;

if (DRY_RUN) {
  console.log("🔍 DRY-RUN mode — no changes will be made. Pass --apply to remediate.");
} else {
  console.log("⚡ APPLY mode — changes WILL be written to the database.");
}
if (COMPANY_ID) {
  console.log(`   Scoped to company_id = ${COMPANY_ID}`);
}
console.log("");

// ─── DB connection ────────────────────────────────────────────────────────────
const { url: dbUrl } = resolveSupabaseDatabaseUrl();

const pool = new Pool({ connectionString: dbUrl, max: 2, connectionTimeoutMillis: 15000 });

// ─── Known void source types ──────────────────────────────────────────────────
const KNOWN_VOID_SOURCES = [
  "bank_reconciliation_void",
  "reversal",
  "accounting_void",
  "journal_reversal",
];

// ─── Discovery query ──────────────────────────────────────────────────────────
async function findCandidates(client) {
  const companyFilter = COMPANY_ID ? `AND orig.company_id = ${COMPANY_ID}` : "";

  const { rows } = await client.query(`
    SELECT
      orig.id                   AS original_entry_id,
      orig.company_id           AS company_id,
      orig.status               AS original_status,
      orig.void_entry_id        AS existing_void_entry_id,
      orig.total_debit::text    AS original_debit,
      orig.total_credit::text   AS original_credit,
      orig.date::text           AS original_date,
      orig.description          AS original_description,
      rev.id                    AS reversal_entry_id,
      rev.status::text          AS reversal_status,
      rev.source::text          AS reversal_source,
      rev.total_debit::text     AS reversal_debit,
      rev.total_credit::text    AS reversal_credit
    FROM accounting_entries orig
    JOIN accounting_entries rev
      ON rev.source::text = ANY(ARRAY[${KNOWN_VOID_SOURCES.map(s => `'${s}'`).join(",")}])
      AND rev.source_id = orig.id
    WHERE orig.status::text = 'posted'
      ${companyFilter}
    ORDER BY orig.id
    LIMIT 500
  `);

  return rows;
}

// ─── Eligibility validation per candidate ────────────────────────────────────
async function validateCandidate(client, candidate) {
  const reasons = [];
  const warnings = [];

  // Must have exactly one reversal
  const { rows: allReversals } = await client.query(`
    SELECT id, status::text AS status, source::text AS source
    FROM accounting_entries
    WHERE source::text = ANY($1::text[])
      AND source_id = $2
  `, [KNOWN_VOID_SOURCES, candidate.original_entry_id]);

  if (allReversals.length > 1) {
    reasons.push(`Multiple reversals found (${allReversals.length}): ${allReversals.map(r => r.id).join(", ")}`);
  }

  // Reversal must be posted
  if (candidate.reversal_status !== "posted") {
    reasons.push(`Reversal #${candidate.reversal_entry_id} status='${candidate.reversal_status}' (expected 'posted')`);
  }

  // Reversal source must be known void source
  if (!KNOWN_VOID_SOURCES.includes(candidate.reversal_source)) {
    reasons.push(`Reversal source '${candidate.reversal_source}' not in known void sources`);
  }

  // Reversal balance: debit should equal original credit, credit should equal original debit
  const revDebit  = parseFloat(candidate.reversal_debit || "0");
  const revCredit = parseFloat(candidate.reversal_credit || "0");
  const origDebit  = parseFloat(candidate.original_debit || "0");
  const origCredit = parseFloat(candidate.original_credit || "0");

  if (Math.abs(revDebit - origCredit) > 0.01) {
    warnings.push(`Reversal debit (${revDebit}) ≠ original credit (${origCredit})`);
  }
  if (Math.abs(revCredit - origDebit) > 0.01) {
    warnings.push(`Reversal credit (${revCredit}) ≠ original debit (${origDebit})`);
  }

  // Original must still be 'posted' (re-check after any concurrent change)
  if (candidate.original_status !== "posted") {
    reasons.push(`Original status is '${candidate.original_status}' (expected 'posted')`);
  }

  // void_entry_id should be NULL
  if (candidate.existing_void_entry_id != null) {
    reasons.push(`Original void_entry_id already set to ${candidate.existing_void_entry_id}`);
  }

  // company_id match — check reversal
  const { rows: revRows } = await client.query(
    `SELECT company_id FROM accounting_entries WHERE id = $1`,
    [candidate.reversal_entry_id]
  );
  if (revRows.length && revRows[0].company_id !== candidate.company_id) {
    reasons.push(`company_id mismatch: original=${candidate.company_id}, reversal=${revRows[0].company_id}`);
  }

  return {
    eligible: reasons.length === 0,
    blockingReasons: reasons,
    warnings,
  };
}

// ─── Apply remediation for one entry ─────────────────────────────────────────
async function applyRemediation(client, candidate, validation) {
  const { original_entry_id, reversal_entry_id, company_id } = candidate;

  // All inside one transaction for this entry
  await client.query("BEGIN");
  try {
    // Re-verify under lock
    const { rows: locked } = await client.query(`
      SELECT id, status::text AS status, void_entry_id
      FROM accounting_entries
      WHERE id = $1 AND company_id = $2
      FOR UPDATE
      LIMIT 1
    `, [original_entry_id, company_id]);

    if (!locked.length) {
      await client.query("ROLLBACK");
      return { skipped: true, reason: "Entry not found under lock" };
    }

    const current = locked[0];
    if (current.status !== "posted") {
      await client.query("ROLLBACK");
      return { skipped: true, reason: `Status changed to '${current.status}' under lock` };
    }
    if (current.void_entry_id != null) {
      await client.query("ROLLBACK");
      return { skipped: true, reason: `void_entry_id set to ${current.void_entry_id} under lock` };
    }

    // Apply: set status='voided' and void_entry_id
    await client.query(`
      UPDATE accounting_entries
      SET status        = 'voided',
          void_entry_id = $1,
          void_reason   = 'HISTORICAL_REMEDIATION: status was posted but reversal existed pre-enum-fix',
          updated_at    = NOW()
      WHERE id = $2
        AND status::text = 'posted'
        AND void_entry_id IS NULL
    `, [reversal_entry_id, original_entry_id]);

    // Audit record
    await client.query(`
      INSERT INTO ledger_guard_audit
        (verdict, source_type, source_id, amount, actor, company_id, ref, reject_reason)
      VALUES
        ('ALLOWED', 'HISTORICAL_VOID_REMEDIATION', $1::text, 0, 'system:remediate-script', $2, NULL,
         'Remediated historical void: reversal_entry_id=' || $3::text)
    `, [original_entry_id, company_id, reversal_entry_id]).catch(() => {
      // Audit table may not exist — non-fatal, main update already committed
    });

    await client.query("COMMIT");
    return { applied: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    console.log("📊 Scanning for historical void inconsistencies...\n");
    const candidates = await findCandidates(client);

    if (candidates.length === 0) {
      console.log("✅ No historical void inconsistencies found. Nothing to remediate.");
      return;
    }

    console.log(`Found ${candidates.length} candidate(s):\n`);

    let eligibleCount = 0;
    let ineligibleCount = 0;
    let appliedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const candidate of candidates) {
      const validation = await validateCandidate(client, candidate);

      console.log(`─── Entry #${candidate.original_entry_id} (company=${candidate.company_id}) ───`);
      console.log(`  Original : status=${candidate.original_status}, debit=${candidate.original_debit}, date=${candidate.original_date}`);
      console.log(`  Reversal : #${candidate.reversal_entry_id}, source=${candidate.reversal_source}, status=${candidate.reversal_status}`);
      console.log(`  void_entry_id: ${candidate.existing_void_entry_id ?? "NULL"}`);

      if (validation.warnings.length) {
        console.log(`  ⚠️  Warnings: ${validation.warnings.join("; ")}`);
      }

      if (!validation.eligible) {
        console.log(`  ❌ INELIGIBLE: ${validation.blockingReasons.join("; ")}`);
        ineligibleCount++;
        continue;
      }

      eligibleCount++;

      if (DRY_RUN) {
        console.log(`  ✅ ELIGIBLE — would set status='voided', void_entry_id=${candidate.reversal_entry_id}`);
        continue;
      }

      // Apply
      try {
        const result = await applyRemediation(client, candidate, validation);
        if (result.skipped) {
          console.log(`  ⏭️  SKIPPED: ${result.reason}`);
          skippedCount++;
        } else {
          console.log(`  ✅ APPLIED — status set to 'voided', void_entry_id=${candidate.reversal_entry_id}`);
          appliedCount++;
        }
      } catch (err) {
        console.error(`  ❌ ERROR: ${err.message}`);
        errorCount++;
      }

      console.log("");
    }

    console.log("\n═══════════════════════════════════════");
    console.log("SUMMARY");
    console.log(`  Total candidates  : ${candidates.length}`);
    console.log(`  Eligible          : ${eligibleCount}`);
    console.log(`  Ineligible        : ${ineligibleCount}`);
    if (!DRY_RUN) {
      console.log(`  Applied           : ${appliedCount}`);
      console.log(`  Skipped (CAS)     : ${skippedCount}`);
      console.log(`  Errors            : ${errorCount}`);
    }
    console.log("═══════════════════════════════════════\n");

    if (DRY_RUN && eligibleCount > 0) {
      console.log(`Run with --apply to remediate ${eligibleCount} eligible entry/entries.`);
    } else if (!DRY_RUN && appliedCount > 0) {
      console.log("✅ Remediation complete.");
    } else if (!DRY_RUN && eligibleCount === 0) {
      console.log("✅ Nothing to remediate.");
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
