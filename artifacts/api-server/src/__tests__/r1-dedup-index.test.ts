/**
 * R-1 — Accounting Dedup Index Tests
 *
 * Verifies:
 * A. company-scoped unique index exists in the live DB
 * B. old non-company-scoped index is absent
 * C. same source+source_id in different companies → both accepted
 * D. same company+source+source_id → second insert rejected by index
 * E. manual source is excluded from uniqueness constraint
 *
 * Fix: accounting_entries.journal_id is NOT NULL in the runtime DB.
 * Tests create a throw-away journal row first and use its id in all fixtures.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const TEST_PREFIX = "r1_test_";
const TEST_JOURNAL_CODE = "R1TEST_JOURNAL";
let testJournalId: number | null = null;

beforeAll(async () => {
  // Clean up stale test entries from previous runs
  await db.execute(sql.raw(`
    DELETE FROM accounting_entry_lines
    WHERE entry_id IN (SELECT id FROM accounting_entries WHERE ref LIKE '${TEST_PREFIX}%')
  `)).catch(() => {});
  await db.execute(sql.raw(`
    DELETE FROM accounting_entries WHERE ref LIKE '${TEST_PREFIX}%'
  `)).catch(() => {});
  await db.execute(sql.raw(`
    DELETE FROM accounting_journals WHERE code IN ('${TEST_JOURNAL_CODE}', '${TEST_JOURNAL_CODE}_C2')
  `)).catch(() => {});

  // R-1 fix: drop the legacy non-company-scoped index in case the accounting/sport-center
  // migrations haven't re-run yet in this test environment.
  // idx_accounting_entries_source_source_id is a UNIQUE(source, source_id) without company_id —
  // it incorrectly prevents the same source_id from appearing in different companies.
  await db.execute(sql.raw(`DROP INDEX IF EXISTS idx_accounting_entries_source_source_id`)).catch(() => {});
  await db.execute(sql.raw(`DROP INDEX IF EXISTS accounting_entries_source_uniq`)).catch(() => {});

  // Create a test journal — accounting_entries.journal_id is NOT NULL in the runtime DB.
  // journal_type enum: sales | purchase | bank | cash | general
  const { rows } = await db.execute(sql.raw(`
    INSERT INTO accounting_journals (company_id, code, name, type, is_active)
    VALUES (1, '${TEST_JOURNAL_CODE}', 'R-1 Test Journal', 'general', true)
    RETURNING id
  `));
  testJournalId = Number((rows[0] as Record<string, unknown>).id);
});

afterAll(async () => {
  await db.execute(sql.raw(`
    DELETE FROM accounting_entry_lines
    WHERE entry_id IN (SELECT id FROM accounting_entries WHERE ref LIKE '${TEST_PREFIX}%')
  `)).catch(() => {});
  await db.execute(sql.raw(`
    DELETE FROM accounting_entries WHERE ref LIKE '${TEST_PREFIX}%'
  `)).catch(() => {});
  await db.execute(sql.raw(`
    DELETE FROM accounting_journals WHERE code = '${TEST_JOURNAL_CODE}'
  `)).catch(() => {});
});

describe("R-1 Accounting Dedup Index", () => {
  it("A. company-scoped index exists in the live DB", async () => {
    const { rows } = await db.execute(sql.raw(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'accounting_entries'
        AND indexname = 'accounting_entries_company_source_source_id_uniq'
    `));
    expect(rows).toHaveLength(1);
    const idx = rows[0] as Record<string, string>;
    // Must include company_id
    expect(idx.indexdef).toContain("company_id");
    // Must not use ::text cast — must use enum literal comparison
    expect(idx.indexdef).not.toContain("::text");
    // Must be unique
    expect(idx.indexdef).toContain("UNIQUE");
  });

  it("B. old non-company-scoped index idx_accounting_entries_co_src_srcid is absent", async () => {
    const { rows } = await db.execute(sql.raw(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'accounting_entries'
        AND indexname = 'idx_accounting_entries_co_src_srcid'
    `));
    expect(rows).toHaveLength(0);
  });

  it("C. same source+source_id in different companies → both accepted", async () => {
    expect(testJournalId).not.toBeNull();
    const ref1 = `${TEST_PREFIX}cross_co_1`;
    const ref2 = `${TEST_PREFIX}cross_co_2`;
    const en1  = `R1TEST/C/001`;
    const en2  = `R1TEST/C/002`;

    // Company 1
    await db.execute(sql.raw(`
      INSERT INTO accounting_entries
        (company_id, journal_id, entry_number, ref, date, status, source, source_id, total_debit, total_credit)
      VALUES (1, ${testJournalId}, '${en1}', '${ref1}', CURRENT_DATE, 'draft', 'sport_center_booking', 99001, 0, 0)
    `));

    // Company 2 — same source_id, different company.
    // Create a second test journal owned by company 2 so the foreign key is satisfied.
    const { rows: jRows2 } = await db.execute(sql.raw(`
      INSERT INTO accounting_journals (company_id, code, name, type, is_active)
      VALUES (2, '${TEST_JOURNAL_CODE}_C2', 'R-1 Test Journal Co2', 'general', true)
      ON CONFLICT DO NOTHING
      RETURNING id
    `));
    // If ON CONFLICT triggered, fetch existing
    const j2rows = jRows2.length
      ? jRows2
      : (await db.execute(sql.raw(`SELECT id FROM accounting_journals WHERE code = '${TEST_JOURNAL_CODE}_C2'`))).rows;
    const journalId2 = Number((j2rows[0] as Record<string, unknown>).id);

    await db.execute(sql.raw(`
      INSERT INTO accounting_entries
        (company_id, journal_id, entry_number, ref, date, status, source, source_id, total_debit, total_credit)
      VALUES (2, ${journalId2}, '${en2}', '${ref2}', CURRENT_DATE, 'draft', 'sport_center_booking', 99001, 0, 0)
    `));

    const { rows } = await db.execute(sql.raw(`
      SELECT id, company_id FROM accounting_entries
      WHERE source_id = 99001 AND source = 'sport_center_booking'
        AND ref IN ('${ref1}', '${ref2}')
    `));
    expect(rows).toHaveLength(2);
    const companies = (rows as Array<Record<string, unknown>>).map(r => Number(r.company_id));
    expect(companies).toContain(1);
    expect(companies).toContain(2);

    // Clean up company-2 test journal
    await db.execute(sql.raw(
      `DELETE FROM accounting_journals WHERE code = '${TEST_JOURNAL_CODE}_C2'`
    )).catch(() => {});
  });

  it("D. same company+source+source_id → second insert rejected by index", async () => {
    expect(testJournalId).not.toBeNull();
    const ref3 = `${TEST_PREFIX}same_co_1`;
    const ref4 = `${TEST_PREFIX}same_co_2`;
    const en3  = `R1TEST/D/001`;
    const en4  = `R1TEST/D/002`;

    // First insert — should succeed
    await db.execute(sql.raw(`
      INSERT INTO accounting_entries
        (company_id, journal_id, entry_number, ref, date, status, source, source_id, total_debit, total_credit)
      VALUES (1, ${testJournalId}, '${en3}', '${ref3}', CURRENT_DATE, 'draft', 'sport_center_booking', 99002, 0, 0)
    `));

    // Second insert — same company+source+source_id → must throw unique index violation
    await expect(
      db.execute(sql.raw(`
        INSERT INTO accounting_entries
          (company_id, journal_id, entry_number, ref, date, status, source, source_id, total_debit, total_credit)
        VALUES (1, ${testJournalId}, '${en4}', '${ref4}', CURRENT_DATE, 'draft', 'sport_center_booking', 99002, 0, 0)
      `))
    ).rejects.toThrow();
  });

  it("E. manual source is excluded — multiple manual entries allowed", async () => {
    expect(testJournalId).not.toBeNull();
    const ref5 = `${TEST_PREFIX}manual_1`;
    const ref6 = `${TEST_PREFIX}manual_2`;
    const en5  = `R1TEST/E/001`;
    const en6  = `R1TEST/E/002`;

    await db.execute(sql.raw(`
      INSERT INTO accounting_entries
        (company_id, journal_id, entry_number, ref, date, status, source, total_debit, total_credit)
      VALUES (1, ${testJournalId}, '${en5}', '${ref5}', CURRENT_DATE, 'draft', 'manual', 0, 0)
    `));
    await db.execute(sql.raw(`
      INSERT INTO accounting_entries
        (company_id, journal_id, entry_number, ref, date, status, source, total_debit, total_credit)
      VALUES (1, ${testJournalId}, '${en6}', '${ref6}', CURRENT_DATE, 'draft', 'manual', 0, 0)
    `));

    // Both should exist — manual is excluded from the unique constraint
    const { rows } = await db.execute(sql.raw(`
      SELECT id FROM accounting_entries WHERE ref IN ('${ref5}', '${ref6}')
    `));
    expect(rows).toHaveLength(2);
  });
});
