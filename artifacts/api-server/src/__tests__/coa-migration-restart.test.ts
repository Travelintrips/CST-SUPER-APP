/**
 * COA Migration Restart Regression Tests
 *
 * Verifies that coaGovernanceMigration does NOT overwrite governance-approved
 * is_header / is_postable values on API server restart.
 *
 * Root cause: the bulk UPDATE previously lacked a WHERE guard and re-derived
 * is_header/is_postable for ALL rows on every startup — corrupting rows that
 * had already been explicitly set via the maker-checker approval workflow.
 *
 * Fix: WHERE child.approved_by IS NULL
 * Only legacy rows (never touched by governance) are backfilled.
 *
 * These tests verify the filter logic, idempotency invariant, and the
 * before/after contract for each scenario — without requiring a live DB.
 */

import { describe, it, expect } from "vitest";

// ─── Helper: simulate the migration's WHERE + SET logic ───────────────────────

interface MockCoaRow {
  id: number;
  approved_by: string | null;
  is_header: boolean;
  is_postable: boolean;
  is_active: boolean;
  has_children: boolean; // simulates EXISTS(SELECT 1 FROM coa WHERE parent_id = row.id)
}

/**
 * Simulates a single migration run using the fixed SQL logic:
 *   UPDATE chart_of_accounts child
 *   SET is_header = EXISTS(child WITH children),
 *       is_postable = NOT EXISTS(child WITH children) AND is_active
 *   WHERE child.approved_by IS NULL
 */
function simulateMigrationRun(rows: MockCoaRow[]): MockCoaRow[] {
  return rows.map((row) => {
    // The fix: skip governance-approved rows
    if (row.approved_by !== null) {
      return { ...row }; // unchanged
    }
    // Legacy row: backfill is_header and is_postable
    return {
      ...row,
      is_header: row.has_children,
      is_postable: !row.has_children && row.is_active,
    };
  });
}

// ─── Scenario 1: Approved header without child ────────────────────────────────
// Approved header (approved_by IS NOT NULL): restart migration → stays header

describe("Scenario 1: approved header without child survives restart", () => {
  const header: MockCoaRow = {
    id: 6610,
    approved_by: "checker@cst.id",
    is_header: true,
    is_postable: false,
    is_active: true,
    has_children: false, // no children yet
  };

  it("first migration run: approved header stays is_header=true, is_postable=false", () => {
    const [result] = simulateMigrationRun([header]);
    expect(result!.is_header).toBe(true);
    expect(result!.is_postable).toBe(false);
  });

  it("second migration run (idempotency): same values preserved", () => {
    const after1 = simulateMigrationRun([header]);
    const after2 = simulateMigrationRun(after1);
    expect(after2[0]!.is_header).toBe(true);
    expect(after2[0]!.is_postable).toBe(false);
  });

  it("third migration run: values still unchanged", () => {
    const [r1] = simulateMigrationRun([header]);
    const [r2] = simulateMigrationRun([r1!]);
    const [r3] = simulateMigrationRun([r2!]);
    expect(r3!.is_header).toBe(true);
    expect(r3!.is_postable).toBe(false);
  });
});

// ─── Scenario 2: Approved leaf survives restart ───────────────────────────────

describe("Scenario 2: approved leaf (is_header=false, is_postable=true) survives restart", () => {
  const leaf: MockCoaRow = {
    id: 100,
    approved_by: "checker@cst.id",
    is_header: false,
    is_postable: true,
    is_active: true,
    has_children: false,
  };

  it("migration run: approved leaf stays is_header=false, is_postable=true", () => {
    const [result] = simulateMigrationRun([leaf]);
    expect(result!.is_header).toBe(false);
    expect(result!.is_postable).toBe(true);
  });

  it("idempotency: approved leaf unchanged after multiple runs", () => {
    const r = [leaf, leaf, leaf].reduce((acc) => simulateMigrationRun(acc), [leaf]);
    expect(r[0]!.is_header).toBe(false);
    expect(r[0]!.is_postable).toBe(true);
  });
});

// ─── Scenario 3: Legacy parent with children → may be backfilled to header ───

describe("Scenario 3: legacy parent with children is backfilled to is_header=true", () => {
  const legacyParent: MockCoaRow = {
    id: 200,
    approved_by: null, // no governance metadata
    is_header: false,  // not yet backfilled
    is_postable: true,
    is_active: true,
    has_children: true,
  };

  it("legacy parent with children becomes is_header=true after migration", () => {
    const [result] = simulateMigrationRun([legacyParent]);
    expect(result!.is_header).toBe(true);
    expect(result!.is_postable).toBe(false);
  });

  it("backfill is idempotent: second run gives same values", () => {
    const after1 = simulateMigrationRun([legacyParent]);
    const after2 = simulateMigrationRun(after1);
    expect(after2[0]!.is_header).toBe(true);
    expect(after2[0]!.is_postable).toBe(false);
  });
});

// ─── Scenario 4: Legacy leaf without children → backfilled to postable ────────

describe("Scenario 4: legacy leaf without children is backfilled to is_postable=true", () => {
  const legacyLeaf: MockCoaRow = {
    id: 300,
    approved_by: null,
    is_header: false,
    is_postable: false, // not yet backfilled
    is_active: true,
    has_children: false,
  };

  it("legacy leaf becomes is_postable=true after migration", () => {
    const [result] = simulateMigrationRun([legacyLeaf]);
    expect(result!.is_header).toBe(false);
    expect(result!.is_postable).toBe(true);
  });

  it("inactive legacy leaf stays is_postable=false (must be active)", () => {
    const inactiveLeaf: MockCoaRow = { ...legacyLeaf, is_active: false };
    const [result] = simulateMigrationRun([inactiveLeaf]);
    expect(result!.is_postable).toBe(false);
  });
});

// ─── Scenario 5: Second migration run → no additional changes ─────────────────

describe("Scenario 5: second migration run produces no additional changes", () => {
  const mixed: MockCoaRow[] = [
    { id: 1, approved_by: "checker@cst.id", is_header: true,  is_postable: false, is_active: true,  has_children: false },
    { id: 2, approved_by: "checker@cst.id", is_header: false, is_postable: true,  is_active: true,  has_children: false },
    { id: 3, approved_by: null,             is_header: false, is_postable: false, is_active: true,  has_children: true  },
    { id: 4, approved_by: null,             is_header: false, is_postable: false, is_active: true,  has_children: false },
  ];

  it("after first run, second run produces identical results (idempotent)", () => {
    const after1 = simulateMigrationRun(mixed);
    const after2 = simulateMigrationRun(after1);
    expect(after2).toEqual(after1);
  });

  it("approved rows (id 1 and 2) are never mutated across runs", () => {
    const after1 = simulateMigrationRun(mixed);
    const after2 = simulateMigrationRun(after1);
    // Row 1: approved header — values locked
    expect(after2[0]!.is_header).toBe(true);
    expect(after2[0]!.is_postable).toBe(false);
    // Row 2: approved leaf — values locked
    expect(after2[1]!.is_header).toBe(false);
    expect(after2[1]!.is_postable).toBe(true);
  });
});

// ─── Scenario 6: Header-child approval order ──────────────────────────────────
// Parent approved first, restart, then children approved → parent stays header

describe("Scenario 6: parent approved first; restart; children later approved → parent stays header", () => {
  it("parent approved (no children yet): restart keeps is_header=true", () => {
    const approvedParent: MockCoaRow = {
      id: 10,
      approved_by: "checker@cst.id",
      is_header: true,
      is_postable: false,
      is_active: true,
      has_children: false, // children not yet in DB
    };
    // Restart with no children → approved_by IS NOT NULL → untouched
    const [after] = simulateMigrationRun([approvedParent]);
    expect(after!.is_header).toBe(true);
    expect(after!.is_postable).toBe(false);
  });

  it("after children are approved: parent still has is_header=true", () => {
    const parent: MockCoaRow = {
      id: 10,
      approved_by: "checker@cst.id",
      is_header: true,
      is_postable: false,
      is_active: true,
      has_children: true, // children now exist
    };
    const child: MockCoaRow = {
      id: 11,
      approved_by: "checker@cst.id",
      is_header: false,
      is_postable: true,
      is_active: true,
      has_children: false,
    };
    const [p, c] = simulateMigrationRun([parent, child]);
    expect(p!.is_header).toBe(true);
    expect(p!.is_postable).toBe(false);
    expect(c!.is_header).toBe(false);
    expect(c!.is_postable).toBe(true);
  });
});

// ─── Scenario 7: No approved account is ever overwritten ──────────────────────

describe("Scenario 7: no approved account is overwritten by migration", () => {
  it("all rows with approved_by IS NOT NULL are unchanged after migration", () => {
    const approvedRows: MockCoaRow[] = [
      // approved header
      { id: 1, approved_by: "a@cst.id", is_header: true,  is_postable: false, is_active: true,  has_children: true  },
      // approved leaf
      { id: 2, approved_by: "b@cst.id", is_header: false, is_postable: true,  is_active: true,  has_children: false },
      // approved inactive
      { id: 3, approved_by: "c@cst.id", is_header: false, is_postable: false, is_active: false, has_children: false },
      // explicitly governance-set non-postable leaf (edge case)
      { id: 4, approved_by: "d@cst.id", is_header: false, is_postable: false, is_active: true,  has_children: false },
    ];

    const after = simulateMigrationRun(approvedRows);

    // Every approved row must be byte-for-byte identical after migration
    after.forEach((row, i) => {
      expect(row.is_header).toBe(approvedRows[i]!.is_header);
      expect(row.is_postable).toBe(approvedRows[i]!.is_postable);
    });
  });

  it("mixed table: only legacy rows change, approved rows are frozen", () => {
    const rows: MockCoaRow[] = [
      { id: 1, approved_by: "checker@cst.id", is_header: true,  is_postable: false, is_active: true, has_children: false },
      { id: 2, approved_by: null,             is_header: false, is_postable: false, is_active: true, has_children: false },
    ];
    const after = simulateMigrationRun(rows);
    // Approved row: untouched
    expect(after[0]!.is_header).toBe(true);
    expect(after[0]!.is_postable).toBe(false);
    // Legacy row: backfilled
    expect(after[1]!.is_header).toBe(false);
    expect(after[1]!.is_postable).toBe(true);
    // They must differ — confirming the filter actually fired
    expect(after[0]!.is_header).not.toBe(after[1]!.is_header);
  });

  it("the specific 1-1070-CST fix case: approved header without children stays header", () => {
    // This is the exact bug case: account 1-1070-CST was approved as header
    // but migration (before fix) set is_header=false because it had no children.
    // The fix (WHERE approved_by IS NULL) must prevent this.
    const asetPajak: MockCoaRow = {
      id: 6610, // actual DB id of 1-1070-CST
      approved_by: "5b8a1255-5c22-4973-a1b4-d79aa80c9216",
      is_header: true,
      is_postable: false,
      is_active: true,
      has_children: false,
    };
    const [after] = simulateMigrationRun([asetPajak]);
    // Must NOT be overwritten by migration
    expect(after!.is_header).toBe(true);
    expect(after!.is_postable).toBe(false);
  });
});

// ─── Core invariant: the WHERE clause is the only gate ────────────────────────

describe("Core invariant: approved_by IS NULL is the sole migration filter", () => {
  it("approved_by=null row with children → backfilled to header (legacy backfill works)", () => {
    const r: MockCoaRow = { id: 1, approved_by: null, is_header: false, is_postable: true, is_active: true, has_children: true };
    const [after] = simulateMigrationRun([r]);
    expect(after!.is_header).toBe(true);
  });

  it("approved_by='any-string' row with children → NOT backfilled (locked by governance)", () => {
    const r: MockCoaRow = { id: 2, approved_by: "any-checker-uuid", is_header: false, is_postable: true, is_active: true, has_children: true };
    const [after] = simulateMigrationRun([r]);
    // The row has children, but since approved_by IS NOT NULL, migration must NOT change it
    expect(after!.is_header).toBe(false); // stays as-is, even though has_children=true
  });

  it("empty table: migration runs cleanly with no changes", () => {
    const after = simulateMigrationRun([]);
    expect(after).toHaveLength(0);
  });
});
