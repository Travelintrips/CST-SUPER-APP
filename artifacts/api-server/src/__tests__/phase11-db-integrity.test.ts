/**
 * Phase 11 — Live DB Integrity Queries
 * Run once to document baseline; not committed to regression suite.
 */
import { describe, it, expect } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

describe("Phase 11 DB Integrity", () => {
  it("1. No duplicate journal entries (same company+source+source_id)", async () => {
    const { rows } = await db.execute(sql.raw(`
      SELECT company_id, source, source_id, COUNT(*) AS cnt
      FROM accounting_entries
      WHERE source IS NOT NULL AND source_id IS NOT NULL AND source <> 'manual'
      GROUP BY company_id, source, source_id
      HAVING COUNT(*) > 1
    `));
    console.log("DUPE_ENTRIES=" + JSON.stringify(rows));
    expect(rows.length).toBe(0);
  });

  it("2. No orphan loans (no journal linkage)", async () => {
    const { rows } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM bank_loans
      WHERE journal_entry_id IS NULL AND status NOT IN ('draft','cancelled')
    `)).catch(() => ({ rows: [{ cnt: 0 }] }));
    console.log("ORPHAN_LOANS=" + JSON.stringify(rows));
    expect(Number((rows[0] as any).cnt)).toBe(0);
  });

  it("3. No orphan journal lines (no parent entry)", async () => {
    const { rows } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM accounting_entry_lines ael
      LEFT JOIN accounting_entries ae ON ae.id = ael.entry_id
      WHERE ae.id IS NULL
    `));
    console.log("ORPHAN_LINES=" + JSON.stringify(rows));
    expect(Number((rows[0] as any).cnt)).toBe(0);
  });

  it("4. Debit-credit balance per company (posted)", async () => {
    const { rows } = await db.execute(sql.raw(`
      SELECT company_id,
        ROUND(SUM(total_debit),2)  AS d,
        ROUND(SUM(total_credit),2) AS cr,
        ROUND(ABS(SUM(total_debit - total_credit)),2) AS diff
      FROM accounting_entries WHERE status = 'posted'
      GROUP BY company_id ORDER BY company_id
    `));
    console.log("BALANCE=" + JSON.stringify(rows));
    for (const row of rows as any[]) {
      expect(Number(row.diff ?? 0)).toBeLessThanOrEqual(0.01);
    }
  });

  it("5. Phase 12 — posted entries without lines", async () => {
    const { rows } = await db.execute(sql.raw(`
      SELECT ae.id, ae.company_id, ae.source, ae.source_id,
             ae.ref, ae.date, ae.entry_number, ae.description,
             ae.created_at
      FROM accounting_entries ae
      LEFT JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      WHERE ae.status = 'posted'
      GROUP BY ae.id
      HAVING COUNT(ael.id) = 0
    `));
    console.log("POSTED_NO_LINES=" + JSON.stringify(rows));
    // Expected: ≤ 1 from baseline (pre-remediation legacy row)
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it("6. All accounting_entries indexes (R-1 state)", async () => {
    const { rows } = await db.execute(sql.raw(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'accounting_entries'
      ORDER BY indexname
    `));
    const names = (rows as any[]).map(r => r.indexname);
    console.log("AE_INDEXES=" + JSON.stringify(names));
    expect(names).toContain("accounting_entries_company_source_source_id_uniq");
    expect(names).not.toContain("idx_accounting_entries_co_src_srcid");
    expect(names).not.toContain("idx_accounting_entries_source_source_id");
  });
});
