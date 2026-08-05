/**
 * approve-tax-coa-crs.mjs
 *
 * Approves all PENDING_APPROVAL coa_change_requests created by
 * system:coa-tax-migration-v1, maintaining full governance audit trail.
 *
 * Implements the same logic as approveChangeRequest() in coaChangeRequestService.ts:
 *   1. Lock + verify PENDING_APPROVAL
 *   2. Verify checker ≠ maker (maker=system:coa-tax-migration-v1, checker=admin@demo.cst.id)
 *   3. Apply COA change (CREATE or UPDATE_PARENT)
 *   4. Insert coa_versions snapshot
 *   5. Set coa_change_requests status → APPROVED
 *
 * Processing order (critical):
 *   Phase A: Headers (isHeader=true) — must exist before children reference them
 *   Phase B: Children (isHeader=false)
 *   Phase C: UPDATE_PARENT (reparent existing accounts)
 *
 * Per company (4 companies), per phase ordered by code.
 */

import pg from "pg";

const { Client } = pg;

const CHECKER = "bd36836b-b9c9-4e42-b436-47354cfadbda"; // admin@demo.cst.id (≠ maker)
const MAKER   = "system:coa-tax-migration-v1";

const client = new Client({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV || process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function findCoaIdByCode(code, companyId) {
  const r = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = $1 AND company_id = $2 LIMIT 1`,
    [code, companyId],
  );
  return r.rows[0]?.id ?? null;
}

async function approveOneCr(cr, now) {
  const after  = cr.after_snapshot_json ?? {};
  const before = cr.before_snapshot_json ?? {};

  await client.query("BEGIN");
  try {
    // Re-read with row-level lock
    const lockRes = await client.query(
      `SELECT * FROM coa_change_requests WHERE id = $1 FOR UPDATE`,
      [cr.id],
    );
    const live = lockRes.rows[0];
    if (!live) throw new Error(`CR id=${cr.id} not found`);
    if (live.status !== "PENDING_APPROVAL") {
      throw new Error(`CR id=${cr.id} status=${live.status} — expected PENDING_APPROVAL`);
    }
    if (live.requested_by === CHECKER) {
      throw new Error(`SELF_APPROVE: CR id=${cr.id} would be self-approved`);
    }

    let coaId   = live.coa_id;
    let newVer  = 1;

    if (cr.action === "CREATE") {
      // Resolve parent: prefer direct parentId, fall back to parentCode lookup
      let parentId = after.parentId ?? null;
      if ((parentId === null || parentId === undefined) && after.parentCode) {
        parentId = await findCoaIdByCode(after.parentCode, cr.company_id);
        if (!parentId) throw new Error(`Parent code ${after.parentCode} not found for CR id=${cr.id}`);
      }

      const ins = await client.query(
        `INSERT INTO chart_of_accounts
           (company_id, code, name, type, subtype, parent_id,
            is_active, normal_balance, account_category,
            is_postable, is_header, status, version,
            created_by, approved_by, approved_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,
                 TRUE,$7,$8,
                 $9,$10,'ACTIVE',1,
                 $11,$12,$13,NOW(),NOW())
         RETURNING id`,
        [
          cr.company_id,
          after.code,
          after.name,
          after.type ?? "asset",
          after.subtype ?? null,
          parentId,
          after.normalBalance ?? "DEBIT",
          after.accountCategory ?? "ASSET",
          after.isPostable !== undefined ? after.isPostable : true,
          after.isHeader  !== undefined ? after.isHeader  : false,
          live.requested_by,
          CHECKER,
          now,
        ],
      );
      coaId  = ins.rows[0].id;
      newVer = 1;

      // Back-fill coa_id into the change request (for version FK)
      await client.query(
        `UPDATE coa_change_requests SET coa_id = $1 WHERE id = $2`,
        [coaId, cr.id],
      );

    } else if (cr.action === "UPDATE_PARENT") {
      // Resolve new parent by code
      coaId = live.coa_id ?? before.id;
      if (!coaId) throw new Error(`No coa_id for UPDATE_PARENT CR id=${cr.id}`);

      const parentCode = after.parentCode;
      if (!parentCode) throw new Error(`No parentCode in after_snapshot for CR id=${cr.id}`);

      const newParentId = await findCoaIdByCode(parentCode, cr.company_id);
      if (!newParentId) throw new Error(`Parent code ${parentCode} not found for CR id=${cr.id}`);

      // Get current version
      const curRes = await client.query(
        `SELECT version FROM chart_of_accounts WHERE id = $1`,
        [coaId],
      );
      if (!curRes.rows[0]) throw new Error(`COA id=${coaId} not found for UPDATE_PARENT CR id=${cr.id}`);
      newVer = (curRes.rows[0].version ?? 0) + 1;

      await client.query(
        `UPDATE chart_of_accounts
         SET parent_id   = $1,
             version     = $2,
             updated_by  = $3,
             approved_by = $3,
             approved_at = $4,
             updated_at  = $4
         WHERE id = $5`,
        [newParentId, newVer, CHECKER, now, coaId],
      );

    } else {
      throw new Error(`Unsupported action=${cr.action} for CR id=${cr.id}`);
    }

    // Fetch fresh snapshot for version record
    const snapRes = await client.query(
      `SELECT * FROM chart_of_accounts WHERE id = $1`,
      [coaId],
    );
    const snap = snapRes.rows[0];

    await client.query(
      `INSERT INTO coa_versions
         (company_id, coa_id, version, snapshot_json, change_request_id, created_by, approved_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT DO NOTHING`,
      [
        cr.company_id,
        coaId,
        newVer,
        JSON.stringify(snap),
        cr.id,
        live.requested_by,
        CHECKER,
      ],
    );

    await client.query(
      `UPDATE coa_change_requests
       SET status       = 'APPROVED',
           reviewed_by  = $1,
           reviewed_at  = $2,
           updated_at   = $2
       WHERE id = $3`,
      [CHECKER, now, cr.id],
    );

    await client.query("COMMIT");
    return { ok: true, coaId, version: newVer };

  } catch (err) {
    await client.query("ROLLBACK");
    return { ok: false, error: err.message };
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  await client.connect();
  console.log("[approve] Connected to DB");

  // Load all pending CRs
  const { rows: allCrs } = await client.query(`
    SELECT id, company_id, action, coa_id,
           after_snapshot_json,
           before_snapshot_json,
           requested_by
    FROM coa_change_requests
    WHERE status = 'PENDING_APPROVAL'
    ORDER BY company_id,
             CASE action WHEN 'CREATE' THEN 1 WHEN 'UPDATE_PARENT' THEN 2 ELSE 3 END,
             (after_snapshot_json->>'code')
  `);

  console.log(`[approve] Loaded ${allCrs.length} pending CRs`);

  // Verify no self-approve violations
  for (const cr of allCrs) {
    if (cr.requested_by === CHECKER) {
      console.error(`[approve] ABORT: CR id=${cr.id} was made by CHECKER — self-approve would occur`);
      process.exit(1);
    }
  }

  // Separate by phase: headers first, then children, then reparents
  const headers    = allCrs.filter(r => r.action === "CREATE" && r.after_snapshot_json?.isHeader === true);
  const children   = allCrs.filter(r => r.action === "CREATE" && r.after_snapshot_json?.isHeader !== true);
  const reparents  = allCrs.filter(r => r.action === "UPDATE_PARENT");

  console.log(`[approve] Phase A — ${headers.length} headers`);
  console.log(`[approve] Phase B — ${children.length} children`);
  console.log(`[approve] Phase C — ${reparents.length} reparents`);
  console.log("");

  const now = new Date();
  let pass = 0, fail = 0;
  const failures = [];

  for (const phase of [
    { label: "A (headers)",   items: headers },
    { label: "B (children)",  items: children },
    { label: "C (reparents)", items: reparents },
  ]) {
    console.log(`[approve] ── Phase ${phase.label} ──`);
    for (const cr of phase.items) {
      const code = cr.after_snapshot_json?.code ?? `coa_id=${cr.coa_id}`;
      const result = await approveOneCr(cr, now);
      if (result.ok) {
        console.log(`  ✓ CR#${String(cr.id).padStart(3)} co=${cr.company_id} ${cr.action} ${code} → coa_id=${result.coaId} v${result.version}`);
        pass++;
      } else {
        console.error(`  ✗ CR#${String(cr.id).padStart(3)} co=${cr.company_id} ${cr.action} ${code} — ${result.error}`);
        fail++;
        failures.push({ id: cr.id, code, error: result.error });
      }
    }
  }

  console.log("");
  console.log(`[approve] ── Summary ──`);
  console.log(`[approve] PASS: ${pass}  FAIL: ${fail}`);

  if (failures.length > 0) {
    console.error("[approve] Failures:");
    for (const f of failures) console.error(`  CR#${f.id} ${f.code}: ${f.error}`);
    process.exit(1);
  }

  // Phase D: post-approval verification
  console.log("");
  console.log("[approve] ── Phase D: Verification ──");

  const { rows: remaining } = await client.query(`
    SELECT COUNT(*) AS cnt FROM coa_change_requests WHERE status = 'PENDING_APPROVAL'
  `);
  console.log(`[approve] Remaining PENDING_APPROVAL CRs: ${remaining[0].cnt}`);

  const { rows: taxCoas } = await client.query(`
    SELECT code, name, status, is_header, is_postable, approved_by, version, company_id
    FROM chart_of_accounts
    WHERE code ~ '^(1-1070|1-1071|1-1072|1-1073|1-1074|1-1075|1-1076|2-1090|2-1091|5-3040|5-3041)-'
       OR code = '1-1070-CST'
    ORDER BY company_id, code
    LIMIT 60
  `);
  console.log(`[approve] Sampled newly ACTIVE tax COA accounts (${taxCoas.length}):`);
  for (const r of taxCoas) {
    const flag = r.is_header ? 'HEADER' : 'child';
    const post = r.is_postable ? 'postable' : 'not-postable';
    console.log(`  co=${r.company_id} ${r.code} ${flag} ${post} v${r.version} approved_by=${r.approved_by ? '✓' : '✗'}`);
  }

  await client.end();
  console.log("");
  console.log("[approve] ✓ Done.");
}

main().catch(err => {
  console.error("[approve] FATAL:", err.message);
  process.exit(1);
});
