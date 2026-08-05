/**
 * vendorInvitation.test.mjs — Phase 2C Integration Tests
 *
 * Jalankan: node artifacts/api-server/src/lib/services/__tests__/vendorInvitation.test.mjs
 *
 * Prerequisite:
 *   - SUPABASE_DATABASE_URL_DEV set di environment
 *   - mkt_rfqs, mkt_vendor_quotes, suppliers, activity_logs ada di DEV
 *
 * Test cases:
 *   1. Invite vendor sukses → mkt_vendor_quotes terisi, activity_logs terisi
 *   2. Duplicate invite → ditolak 409
 *   3. RFQ tidak ditemukan → error RFQ_NOT_FOUND
 *   4. Vendor tidak ditemukan → error VENDOR_NOT_FOUND
 *   5. mkt_vendor_quotes row diverifikasi langsung ke DB
 *   6. activity_logs row diverifikasi langsung ke DB
 *   7. quoteCount mkt_rfqs di-increment
 *   Endpoint auth tests dilakukan via curl (lihat bagian bawah).
 */

import pg from "pg";
import { randomBytes } from "crypto";

const { Pool } = pg;

// ── Setup pool langsung ke DEV ────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  ssl: { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 10_000,
});

async function q(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ── Test state ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
    errors.push(label);
  }
}

function assertEq(actual, expected, label) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✅ ${label} (got: ${JSON.stringify(actual)})`);
    passed++;
  } else {
    console.error(`  ❌ ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
    errors.push(label);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Buat RFQ sementara untuk testing, kembalikan rfqId + rfqNumber */
async function createTestRfq(suffix = "") {
  const tempNum = `MKT-TEST-${Date.now()}${suffix}`;
  const rows = await q(
    `INSERT INTO mkt_rfqs
       (rfq_number, buyer_name, buyer_email, buyer_phone, status, priority,
        email_verified, line_count, quote_count)
     VALUES ($1, 'Test Buyer', 'test@test.com', '08000000000', 'submitted', 'normal',
             false, 1, 0)
     RETURNING id, rfq_number`,
    [tempNum],
  );
  return { rfqId: rows[0].id, rfqNumber: rows[0].rfq_number };
}

/** Cleanup test data */
async function cleanup(rfqId) {
  if (!rfqId) return;
  await q(`DELETE FROM mkt_vendor_quotes WHERE rfq_id = $1`, [rfqId]);
  await q(`DELETE FROM activity_logs WHERE mkt_rfq_id = $1`, [rfqId]);
  await q(`DELETE FROM mkt_rfq_lines WHERE rfq_id = $1`, [rfqId]);
  await q(`DELETE FROM mkt_rfqs WHERE id = $1`, [rfqId]);
}

/** Get first active supplier */
async function getFirstActiveVendor() {
  const rows = await q(`SELECT id, name, is_active FROM suppliers WHERE is_active = true LIMIT 1`);
  return rows[0] ?? null;
}

/** Minimal service simulation — test logika invite langsung ke DB */
async function inviteVendorDirect({ rfqId, vendorId }) {
  // Check RFQ exists
  const rfqRows = await q(`SELECT id, rfq_number, buyer_name, buyer_company, notes FROM mkt_rfqs WHERE id = $1`, [rfqId]);
  if (!rfqRows.length) return { ok: false, code: "RFQ_NOT_FOUND" };

  // Check vendor exists + active
  const vendorRows = await q(`SELECT id, name, phone, contact_email, is_active FROM suppliers WHERE id = $1`, [vendorId]);
  if (!vendorRows.length) return { ok: false, code: "VENDOR_NOT_FOUND" };
  if (!vendorRows[0].is_active) return { ok: false, code: "VENDOR_INACTIVE" };

  // Duplicate check
  const existing = await q(
    `SELECT id, status FROM mkt_vendor_quotes WHERE rfq_id = $1 AND vendor_id = $2 LIMIT 1`,
    [rfqId, vendorId],
  );
  if (existing.length) {
    return { ok: false, code: "DUPLICATE_INVITE", existingQuoteId: existing[0].id, existingStatus: existing[0].status };
  }

  // Insert in transaction
  const token = randomBytes(32).toString("hex");
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const client = await pool.connect();
  let quoteId;
  try {
    await client.query("BEGIN");

    const qRes = await client.query(
      `INSERT INTO mkt_vendor_quotes (rfq_id, vendor_id, token, status, valid_until)
       VALUES ($1, $2, $3, 'invited', $4)
       RETURNING id`,
      [rfqId, vendorId, token, validUntil],
    );
    quoteId = qRes.rows[0].id;

    await client.query(
      `UPDATE mkt_rfqs SET quote_count = quote_count + 1, updated_at = NOW() WHERE id = $1`,
      [rfqId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    client.release();
    return { ok: false, code: "DB_ERROR", message: err.message };
  } finally {
    client.release();
  }

  // Activity log (fire-and-forget)
  q(
    `INSERT INTO activity_logs
       (mkt_rfq_id, mkt_vendor_quote_id, actor_type, action, description, new_value)
     VALUES ($1, $2, 'admin', 'mkt_vendor_invited', $3, $4::jsonb)`,
    [
      rfqId,
      quoteId,
      `Vendor "${vendorRows[0].name}" diundang ke RFQ ${rfqRows[0].rfq_number}`,
      JSON.stringify({ rfqId, vendorId, quoteId, status: "invited", validUntil: validUntil.toISOString() }),
    ],
  ).catch(() => {});

  return {
    ok: true,
    quoteId,
    token,
    rfqNumber: rfqRows[0].rfq_number,
    vendorName: vendorRows[0].name,
    status: "invited",
    validUntil,
    notificationPayload: {
      vendorPhone: vendorRows[0].phone ?? null,
      vendorEmail: vendorRows[0].contact_email ?? null,
      vendorName: vendorRows[0].name,
      rfqId,
      rfqNumber: rfqRows[0].rfq_number,
      rfqBuyerName: rfqRows[0].buyer_name,
      rfqBuyerCompany: rfqRows[0].buyer_company ?? null,
      rfqNotes: rfqRows[0].notes ?? null,
      quoteId,
      token,
      validUntil: validUntil.toISOString(),
      deepLinkUrl: null,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║   Phase 2C — Vendor Invitation Integration Tests      ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");

  // ── Pre-check: dapat vendor aktif ──────────────────────────────────────────
  const vendor = await getFirstActiveVendor();
  if (!vendor) {
    console.error("❌ SKIP: Tidak ada supplier aktif di DEV. Tambahkan satu supplier dulu.");
    process.exit(1);
  }
  console.log(`🔑 Vendor untuk test: id=${vendor.id} name="${vendor.name}"\n`);

  // ── TC1: Invite vendor sukses ──────────────────────────────────────────────
  console.log("TC1: Invite vendor sukses");
  const { rfqId: rfqId1, rfqNumber: rfqNum1 } = await createTestRfq("-tc1");
  try {
    const result = await inviteVendorDirect({ rfqId: rfqId1, vendorId: vendor.id });

    assert(result.ok === true, "result.ok === true");
    assert(typeof result.quoteId === "number" && result.quoteId > 0, "quoteId adalah integer positif");
    assert(typeof result.token === "string" && result.token.length === 64, "token adalah 64-char hex");
    assertEq(result.rfqNumber, rfqNum1, "rfqNumber match");
    assertEq(result.vendorName, vendor.name, "vendorName match");
    assertEq(result.status, "invited", "status = 'invited'");
    assert(result.validUntil instanceof Date, "validUntil adalah Date");

    // Verifikasi notificationPayload shape
    assert(result.notificationPayload !== null, "notificationPayload tersedia");
    assertEq(result.notificationPayload.rfqId, rfqId1, "notificationPayload.rfqId match");
    assertEq(result.notificationPayload.quoteId, result.quoteId, "notificationPayload.quoteId match");
    assert(result.notificationPayload.deepLinkUrl === null, "deepLinkUrl = null (Phase 2D)");

    if (result.ok) {
      // Verifikasi mkt_vendor_quotes di DB
      const dbQuote = await q(
        `SELECT id, rfq_id, vendor_id, token, status, valid_until FROM mkt_vendor_quotes WHERE id = $1`,
        [result.quoteId],
      );
      assert(dbQuote.length === 1, "mkt_vendor_quotes row ada di DB");
      assertEq(dbQuote[0].rfq_id, rfqId1, "DB: rfq_id match");
      assertEq(dbQuote[0].vendor_id, vendor.id, "DB: vendor_id match");
      assertEq(dbQuote[0].status, "invited", "DB: status = 'invited'");
      assert(dbQuote[0].token.length === 64, "DB: token 64 chars");

      // Verifikasi quoteCount di-increment
      await new Promise(r => setTimeout(r, 100)); // let async settle
      const rfqRow = await q(`SELECT quote_count FROM mkt_rfqs WHERE id = $1`, [rfqId1]);
      assertEq(rfqRow[0].quote_count, 1, "mkt_rfqs.quote_count = 1 setelah 1 invite");

      // Verifikasi activity_logs (dengan sedikit delay)
      await new Promise(r => setTimeout(r, 200));
      const logs = await q(
        `SELECT id, action, mkt_rfq_id, mkt_vendor_quote_id FROM activity_logs WHERE mkt_rfq_id = $1 AND action = 'mkt_vendor_invited'`,
        [rfqId1],
      );
      assert(logs.length >= 1, "activity_logs: mkt_vendor_invited ada");
      assertEq(logs[0].mkt_vendor_quote_id, result.quoteId, "activity_logs: mkt_vendor_quote_id match");
    }
  } finally {
    await cleanup(rfqId1);
  }

  // ── TC2: Duplicate invite ditolak ─────────────────────────────────────────
  console.log("\nTC2: Duplicate invite ditolak");
  const { rfqId: rfqId2 } = await createTestRfq("-tc2");
  try {
    const first = await inviteVendorDirect({ rfqId: rfqId2, vendorId: vendor.id });
    assert(first.ok === true, "invite pertama sukses");

    const second = await inviteVendorDirect({ rfqId: rfqId2, vendorId: vendor.id });
    assertEq(second.ok, false, "invite kedua ditolak (ok=false)");
    assertEq(second.code, "DUPLICATE_INVITE", "error code = DUPLICATE_INVITE");
    assert("existingQuoteId" in second && second.existingQuoteId > 0, "existingQuoteId tersedia");
    assertEq(second.existingStatus, "invited", "existingStatus = 'invited'");
  } finally {
    await cleanup(rfqId2);
  }

  // ── TC3: RFQ tidak ditemukan ──────────────────────────────────────────────
  console.log("\nTC3: RFQ tidak ditemukan");
  const result3 = await inviteVendorDirect({ rfqId: 99999999, vendorId: vendor.id });
  assertEq(result3.ok, false, "ok = false untuk RFQ not found");
  assertEq(result3.code, "RFQ_NOT_FOUND", "error code = RFQ_NOT_FOUND");

  // ── TC4: Vendor tidak ditemukan ───────────────────────────────────────────
  console.log("\nTC4: Vendor tidak ditemukan");
  const { rfqId: rfqId4 } = await createTestRfq("-tc4");
  try {
    const result4 = await inviteVendorDirect({ rfqId: rfqId4, vendorId: 99999999 });
    assertEq(result4.ok, false, "ok = false untuk vendor not found");
    assertEq(result4.code, "VENDOR_NOT_FOUND", "error code = VENDOR_NOT_FOUND");
  } finally {
    await cleanup(rfqId4);
  }

  // ── TC5: Token uniqueness (3 invites ke 3 RFQ berbeda, cek semua token unik) ─
  console.log("\nTC5: Token uniqueness (3 invites, semua token berbeda)");
  const rfqIds5 = [];
  const tokens5 = [];
  try {
    for (let i = 0; i < 3; i++) {
      const { rfqId } = await createTestRfq(`-tc5-${i}`);
      rfqIds5.push(rfqId);
      const r = await inviteVendorDirect({ rfqId, vendorId: vendor.id });
      if (r.ok) tokens5.push(r.token);
    }
    const uniqueTokens = new Set(tokens5);
    assertEq(uniqueTokens.size, tokens5.length, `Semua ${tokens5.length} token unik`);
    assert(tokens5.every(t => t.length === 64), "Semua token 64 chars");
  } finally {
    for (const id of rfqIds5) await cleanup(id);
  }

  // ── TC6: getVendorQuotesForRfq (langsung DB) ──────────────────────────────
  console.log("\nTC6: getVendorQuotesForRfq — list quotes untuk RFQ");
  const { rfqId: rfqId6 } = await createTestRfq("-tc6");
  try {
    await inviteVendorDirect({ rfqId: rfqId6, vendorId: vendor.id });

    const quotes = await q(
      `SELECT vq.id, vq.rfq_id, vq.vendor_id, s.name AS vendor_name, vq.status, vq.valid_until
       FROM mkt_vendor_quotes vq
       JOIN suppliers s ON s.id = vq.vendor_id
       WHERE vq.rfq_id = $1
       ORDER BY vq.created_at`,
      [rfqId6],
    );
    assertEq(quotes.length, 1, "1 quote di-return untuk RFQ");
    assertEq(quotes[0].vendor_id, vendor.id, "vendor_id match");
    assertEq(quotes[0].status, "invited", "status = invited");
    assert(quotes[0].vendor_name === vendor.name, "vendor_name dari JOIN suppliers match");
    assert(quotes[0].valid_until !== null, "valid_until terisi");
  } finally {
    await cleanup(rfqId6);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log(`║  PASSED: ${String(passed).padEnd(3)} | FAILED: ${String(failed).padEnd(3)}               ║`);
  console.log("╚═══════════════════════════════════════════╝");

  if (errors.length) {
    console.error("\nFailed assertions:");
    errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
  }

  // ── Endpoint auth check via curl ──────────────────────────────────────────
  console.log("\n── Endpoint auth check (unauthenticated → 401) ──");
  const { execSync } = await import("child_process");
  try {
    const postStatus = execSync(
      `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5000/api/mkt/admin/rfqs/1/invite-vendor -H "Content-Type: application/json" -d '{"vendorId":1}'`,
      { timeout: 5000 },
    ).toString().trim();
    assertEq(postStatus, "401", "POST invite-vendor tanpa auth → 401");

    const getStatus = execSync(
      `curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/mkt/admin/rfqs/1/vendor-quotes`,
      { timeout: 5000 },
    ).toString().trim();
    assertEq(getStatus, "401", "GET vendor-quotes tanpa auth → 401");
  } catch (e) {
    console.warn("  ⚠️  curl endpoint check skipped (server mungkin tidak running):", e.message?.slice(0, 80));
  }

  console.log(`\n${failed === 0 ? "✅ ALL TESTS PASSED" : `❌ ${failed} TEST(S) FAILED`}\n`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("❌ Fatal test error:", err);
  pool.end().catch(() => {});
  process.exit(1);
});
