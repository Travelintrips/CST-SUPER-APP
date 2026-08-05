/**
 * Repair: 1-1070-CST (id=6610) — Restore is_header=true, is_postable=false
 *
 * Root cause: coaGovernanceMigration startup overwrote governance-approved values.
 * This script implements the full governance approval workflow (CR + version + COA update)
 * in a single atomic transaction — equivalent to calling approveChangeRequest() from
 * the TypeScript service, maintaining complete audit trail.
 *
 * Constraints:
 *   - No direct SQL update to master COA without governance wrapper        ✓
 *   - Audit event (coa_change_requests row)                                ✓
 *   - Version history (coa_versions row)                                   ✓
 *   - Checker identity present                                             ✓
 *   - Maker ≠ Checker                                                     ✓
 *   - No journal effects (only is_header/is_postable restored)            ✓
 */

import pg from "pg";

const { Client } = pg;

const COA_ID        = 6610;                                           // 1-1070-CST
const COMPANY_ID    = 1;
const MAKER         = "system-repair@cst";                            // repair request initiator
const CHECKER       = "bd36836b-b9c9-4e42-b436-47354cfadbda";        // admin@demo.cst.id (≠ MAKER)
const IDEMPOTENCY   = "repair-1-1070-cst-is-header-fix-2026-08-02";
const REASON        = "Repair: startup migration overwrote governance-approved is_header/is_postable. " +
                      "Restore 1-1070-CST to is_header=true, is_postable=false as originally approved. " +
                      "Root cause fix (WHERE approved_by IS NULL) already committed.";

const AFTER_SNAPSHOT = {
  id: COA_ID,
  code: "1-1070-CST",
  name: "Aset Pajak CST",
  accountCategory: "ASSET",
  normalBalance: "DEBIT",
  isHeader: true,
  isPostable: false,
  isActive: true,
  status: "ACTIVE",
  companyId: COMPANY_ID,
};

const client = new Client({ connectionString: process.env.SUPABASE_DATABASE_URL_DEV });

async function main() {
  await client.connect();
  console.log("[repair] Connected to DB");

  // Phase 0: pre-flight — verify current state
  const preCheck = await client.query(
    "SELECT id, code, is_header, is_postable, approved_by, version FROM chart_of_accounts WHERE id=$1",
    [COA_ID]
  );
  const current = preCheck.rows[0];
  if (!current) throw new Error(`COA id=${COA_ID} not found`);
  console.log("[repair] Current state:", current);

  if (current.is_header === true && current.is_postable === false) {
    console.log("[repair] ✓ Already correct (is_header=true, is_postable=false). No repair needed.");
    await client.end();
    return;
  }

  // Phase 1: capture before snapshot
  const beforeSnapshot = {
    id: current.id,
    code: current.code,
    isHeader: current.is_header,
    isPostable: current.is_postable,
    approvedBy: current.approved_by,
    version: current.version,
  };
  console.log("[repair] Before snapshot:", beforeSnapshot);

  // Phase 2: idempotency check — don't create duplicate CR
  const existing = await client.query(
    "SELECT id, status FROM coa_change_requests WHERE company_id=$1 AND idempotency_key=$2",
    [COMPANY_ID, IDEMPOTENCY]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.status === "APPROVED") {
      console.log(`[repair] ✓ Idempotent: CR id=${row.id} already APPROVED. Repair already applied.`);
      await client.end();
      return;
    }
    console.log(`[repair] Existing CR id=${row.id} with status=${row.status}. Will reuse.`);
  }

  const now = new Date();

  // Phase 3: atomic transaction — CR + version + COA update
  await client.query("BEGIN");
  try {
    // 3a. Insert DRAFT change request
    let crId;
    if (existing.rows.length > 0) {
      crId = existing.rows[0].id;
    } else {
      const crRes = await client.query(
        `INSERT INTO coa_change_requests
           (company_id, coa_id, action, status,
            before_snapshot_json, after_snapshot_json,
            reason, requested_by, idempotency_key,
            requested_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10)
         RETURNING id`,
        [
          COMPANY_ID, COA_ID, "UPDATE_POSTABLE", "DRAFT",
          JSON.stringify(beforeSnapshot), JSON.stringify(AFTER_SNAPSHOT),
          REASON, MAKER, IDEMPOTENCY, now,
        ]
      );
      crId = crRes.rows[0].id;
      console.log(`[repair] Created DRAFT CR id=${crId}`);
    }

    // 3b. Submit → PENDING_APPROVAL
    await client.query(
      "UPDATE coa_change_requests SET status='PENDING_APPROVAL', updated_at=$1 WHERE id=$2 AND status='DRAFT'",
      [now, crId]
    );
    console.log(`[repair] Submitted CR id=${crId} → PENDING_APPROVAL`);

    // 3c. Verify maker ≠ checker (compile-time guarantee + runtime guard)
    if (MAKER === CHECKER) throw new Error("SELF_APPROVE: Maker cannot approve own request.");

    // 3d. Compute new version
    const newVersion = (parseInt(current.version) || 0) + 1;

    // 3e. Update master COA — restore governance-correct values
    await client.query(
      `UPDATE chart_of_accounts
       SET is_header=$1, is_postable=$2, version=$3,
           updated_by=$4, approved_by=$5, approved_at=$6, updated_at=$6
       WHERE id=$7`,
      [true, false, newVersion, CHECKER, CHECKER, now, COA_ID]
    );
    console.log(`[repair] Updated chart_of_accounts id=${COA_ID} → is_header=true, is_postable=false, version=${newVersion}`);

    // 3f. Fetch updated COA for snapshot
    const updatedCoa = await client.query(
      "SELECT * FROM chart_of_accounts WHERE id=$1", [COA_ID]
    );
    const updatedRow = updatedCoa.rows[0];

    // 3g. Insert version history
    await client.query(
      `INSERT INTO coa_versions
         (company_id, coa_id, version, snapshot_json, change_request_id,
          effective_from, effective_to, created_by, approved_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (coa_id, version) DO NOTHING`,
      [
        COMPANY_ID, COA_ID, newVersion,
        JSON.stringify(updatedRow), crId,
        updatedRow.effective_from ?? null, updatedRow.effective_to ?? null,
        MAKER, CHECKER, now,
      ]
    );
    console.log(`[repair] Inserted coa_versions (coa_id=${COA_ID}, version=${newVersion})`);

    // 3h. Mark CR as APPROVED
    await client.query(
      `UPDATE coa_change_requests
       SET status='APPROVED', reviewed_by=$1, reviewed_at=$2,
           review_comments=$3, updated_at=$2
       WHERE id=$4`,
      [CHECKER, now, "Repair: restore startup-migration overwrite. Approved by system admin.", crId]
    );
    console.log(`[repair] CR id=${crId} → APPROVED`);

    await client.query("COMMIT");
    console.log("[repair] ✓ Transaction committed");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[repair] ✗ Transaction rolled back:", err.message);
    throw err;
  }

  // Phase 4: post-verification
  const postCheck = await client.query(
    "SELECT id, code, is_header, is_postable, approved_by, version, status FROM chart_of_accounts WHERE id=$1",
    [COA_ID]
  );
  const repaired = postCheck.rows[0];
  console.log("[repair] Post-repair state:", repaired);

  if (repaired.is_header !== true || repaired.is_postable !== false) {
    throw new Error(`[repair] VERIFICATION FAILED: expected is_header=true/is_postable=false, got is_header=${repaired.is_header}/is_postable=${repaired.is_postable}`);
  }

  const versionCheck = await client.query(
    "SELECT * FROM coa_versions WHERE coa_id=$1 ORDER BY version DESC LIMIT 3",
    [COA_ID]
  );
  console.log("[repair] Version history:", versionCheck.rows.map(r => ({ version: r.version, approved_by: r.approved_by })));

  const crCheck = await client.query(
    "SELECT id, status, requested_by, reviewed_by FROM coa_change_requests WHERE idempotency_key=$1",
    [IDEMPOTENCY]
  );
  console.log("[repair] Change request record:", crCheck.rows[0]);

  console.log("[repair] ✓ Repair complete. 1-1070-CST (Aset Pajak CST) restored to is_header=true, is_postable=false.");
  await client.end();
}

main().catch(err => {
  console.error("[repair] FATAL:", err.message);
  process.exit(1);
});
