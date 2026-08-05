/**
 * Backfill sport-center statcard:
 * - Upsert sport_bookings (non-cancelled) → sport_center_bookings
 * - Update payment_status dari sport_payments (paid) ke sport_center_bookings
 *
 * Jalankan: node scripts/backfill-sport-statcard.mjs
 */

import pg from "pg";

const { Pool } = pg;

const connStr = process.env.SUPABASE_PG_URL || process.env.DATABASE_URL;
if (!connStr) {
  console.error("❌  Set SUPABASE_PG_URL atau DATABASE_URL terlebih dahulu.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: connStr,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ── 1. Build facility name → Supabase facility_id (TEXT) map ─────────────────
async function buildFacilityMap() {
  const { rows } = await query(`SELECT id, name FROM sport_center_facilities`);
  const map = new Map();
  for (const r of rows) {
    map.set(r.name.trim().toLowerCase(), String(r.id));
  }
  console.log(`[facility] ${map.size} fasilitas ditemukan di sport_center_facilities.`);
  return map;
}

// ── 2. Sync bookings ─────────────────────────────────────────────────────────
async function syncBookings(facilityMap) {
  const { rows } = await query(`
    SELECT
      b.*,
      p.status AS pay_status
    FROM sport_bookings b
    LEFT JOIN sport_payments p
      ON p.booking_id = b.id AND p.status = 'paid'
    WHERE b.status != 'cancelled'
    ORDER BY b.id ASC
  `);

  console.log(`[booking] Ditemukan ${rows.length} booking aktif.`);

  let ok = 0;
  let fail = 0;

  for (const b of rows) {
    // Cari facility_id dari Supabase facilities via nama, fallback ke local id sebagai string
    const facilityId = facilityMap.get((b.facility_name ?? "").trim().toLowerCase())
      ?? (b.facility_id ? String(b.facility_id) : "0");

    // Format tanggal & waktu sebagai TEXT (sesuai schema Supabase)
    const dateStr   = b.booking_date instanceof Date
      ? b.booking_date.toISOString().split("T")[0]
      : String(b.booking_date ?? "").split("T")[0];

    const startTime = typeof b.start_time === "string"
      ? b.start_time.slice(0, 5)
      : String(b.start_time ?? "00:00").slice(0, 5);

    const endTime = typeof b.end_time === "string"
      ? b.end_time.slice(0, 5)
      : String(b.end_time ?? "01:00").slice(0, 5);

    try {
      await query(`
        INSERT INTO sport_center_bookings
          (booking_code, facility_id, facility_name, customer_name, customer_phone,
           customer_email, date, start_time, end_time,
           total_hours, total_price, status, payment_status, notes, updated_at)
        VALUES
          ($1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10, $11, $12, $13, $14, NOW())
        ON CONFLICT (booking_code) DO UPDATE SET
          facility_id    = EXCLUDED.facility_id,
          facility_name  = EXCLUDED.facility_name,
          customer_name  = EXCLUDED.customer_name,
          customer_phone = EXCLUDED.customer_phone,
          customer_email = EXCLUDED.customer_email,
          date           = EXCLUDED.date,
          start_time     = EXCLUDED.start_time,
          end_time       = EXCLUDED.end_time,
          total_hours    = EXCLUDED.total_hours,
          total_price    = EXCLUDED.total_price,
          status         = EXCLUDED.status,
          payment_status = EXCLUDED.payment_status,
          notes          = EXCLUDED.notes,
          updated_at     = NOW()
      `, [
        b.booking_number,
        facilityId,
        b.facility_name ?? "",
        b.customer_name ?? "",
        b.customer_phone ?? "",
        b.customer_email ?? null,
        dateStr,
        startTime,
        endTime,
        Number(b.duration_hours ?? 1),
        Math.round(Number(b.total_amount ?? 0)),
        b.status,
        b.pay_status ? "paid" : (b.payment_status ?? "unpaid"),
        b.notes ?? null,
      ]);
      process.stdout.write(".");
      ok++;
    } catch (err) {
      console.error(`\n  ✗ booking ${b.booking_number}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n[booking] Selesai: ${ok} OK, ${fail} gagal.`);
}

// ── 3. Sync payment_status dari sport_payments ────────────────────────────────
async function syncPaymentStatus() {
  const { rows } = await query(`
    SELECT p.status, b.booking_number
    FROM sport_payments p
    JOIN sport_bookings b ON b.id = p.booking_id
    WHERE p.status = 'paid'
  `);

  console.log(`[payment] Ditemukan ${rows.length} pembayaran paid.`);

  let ok = 0;
  for (const p of rows) {
    if (!p.booking_number) continue;
    try {
      const r = await query(`
        UPDATE sport_center_bookings
        SET payment_status = 'paid', updated_at = NOW()
        WHERE booking_code = $1
      `, [p.booking_number]);
      if (r.rowCount > 0) ok++;
    } catch (err) {
      console.error(`  ✗ payment booking ${p.booking_number}: ${err.message}`);
    }
  }
  console.log(`[payment] Updated ${ok} booking → payment_status = 'paid'.`);
}

// ── 4. Ringkasan membership payments ─────────────────────────────────────────
async function logMembershipSummary() {
  const { rows } = await query(`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total
    FROM sport_payments
    WHERE payment_type = 'membership' AND status = 'paid'
  `);
  const r = rows[0];
  console.log(`[membership] ${r.cnt} transaksi membership, total Rp ${Number(r.total).toLocaleString("id-ID")}`);
}

// ── 5. Ringkasan akhir ────────────────────────────────────────────────────────
async function printSummary() {
  const { rows } = await query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid,
      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending
    FROM sport_center_bookings
  `);
  const r = rows[0];
  console.log("\n📊  sport_center_bookings (after backfill):");
  console.log(`   Total : ${r.total}`);
  console.log(`   Paid  : ${r.paid}`);
  console.log(`   Status: confirmed=${r.confirmed}, completed=${r.completed}, pending=${r.pending}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log("🔄  Backfill Sport Center Statcard dimulai...\n");

    const facilityMap = await buildFacilityMap();
    await syncBookings(facilityMap);
    await syncPaymentStatus();
    await logMembershipSummary();
    await printSummary();

    console.log("\n✅  Backfill selesai.");
  } catch (err) {
    console.error("❌  Fatal:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
