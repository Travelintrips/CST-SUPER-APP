/**
 * sync-sport-center-payments.mjs
 *
 * Menemukan semua sport_bookings dengan payment_status='paid'
 * yang belum punya record di sport_payments, lalu membuat payment
 * via API (yang secara otomatis menangani sync Supabase + jurnal akuntansi).
 *
 * Run: node scripts/sync-sport-center-payments.mjs
 * Requires: SUPABASE_PG_URL atau DATABASE_URL env var
 */

import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;

const DB_URL = process.env.SUPABASE_PG_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: Set env SUPABASE_PG_URL atau DATABASE_URL terlebih dahulu.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
});

// API server berjalan di port 8080
const BASE = "http://localhost:8080/api";

// ── 1. Buat session admin sementara ────────────────────────────────────────────
const sid = crypto.randomBytes(32).toString("hex");

const { rows: userRows } = await pool.query(
  `SELECT id, email, first_name, last_name, role, company_id
   FROM public.users
   WHERE role = 'admin'
   ORDER BY id LIMIT 1`
);

const adminUser = userRows.length > 0 ? {
  id: userRows[0].id,
  email: userRows[0].email,
  firstName: userRows[0].first_name ?? "Admin",
  lastName: userRows[0].last_name ?? "",
  profileImageUrl: null,
  role: userRows[0].role,
  companyId: userRows[0].company_id ?? 1,
} : {
  id: "sync-script-admin",
  email: "admcst001@gmail.com",
  firstName: "Sync",
  lastName: "Script",
  profileImageUrl: null,
  role: "admin",
  companyId: 1,
};

await pool.query(
  `INSERT INTO sessions (sid, sess, expire)
   VALUES ($1, $2, $3)
   ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
  [sid, JSON.stringify({ user: adminUser }), new Date(Date.now() + 3_600_000)]
);
console.log(`[sync] Session admin dibuat: ${adminUser.email}`);

// ── Helper: panggil API ────────────────────────────────────────────────────────
async function apiPost(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `sid=${sid}`,
    },
    body: JSON.stringify(body),
  });
  let json;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, body: json };
}

// ── 2. Temukan booking yang belum punya sport_payments ─────────────────────────
const { rows: bookings } = await pool.query(`
  SELECT
    sb.id            AS booking_id,
    sb.booking_number,
    sb.customer_name,
    sb.facility_name,
    sb.booking_date::text AS booking_date,
    sb.total_amount  AS amount,
    sb.tax_amount,
    sb.payment_status,
    sb.company_id
  FROM sport_bookings sb
  LEFT JOIN sport_payments sp ON sp.booking_id = sb.id
  WHERE sb.payment_status = 'paid'
    AND sp.id IS NULL
  ORDER BY sb.booking_date ASC, sb.id ASC
`);

if (bookings.length === 0) {
  console.log("[sync] Tidak ada booking yang perlu disinkronisasi. Semua sudah lengkap ✅");
  await cleanup();
  process.exit(0);
}

console.log(`[sync] Ditemukan ${bookings.length} booking yang perlu disinkronisasi:`);
for (const b of bookings) {
  console.log(`  → [${b.booking_number}] ${b.customer_name} — ${b.facility_name} (${b.booking_date}) Rp${Number(b.amount).toLocaleString("id-ID")}`);
}
console.log("");

// ── 3. Proses satu per satu lewat API ─────────────────────────────────────────
let success = 0;
let failed = 0;
const errors = [];

for (const b of bookings) {
  const bookingDate = String(b.booking_date ?? "").slice(0, 10);

  const { status, body } = await apiPost("/sport-center/payments", {
    booking_id: b.booking_id,
    amount: Number(b.amount),
    method: "cash",
    payment_date: bookingDate,
    notes: "Sinkronisasi otomatis — booking sudah paid tanpa payment record",
  });

  if (status === 200 || status === 201) {
    const payNum = body?.payment?.payment_number ?? body?.data?.payment_number ?? "OK";
    console.log(`  ✅ [${b.booking_number}] payment dibuat — ${payNum}`);
    success++;
  } else {
    const errMsg = body?.error ?? body?.message ?? `HTTP ${status}`;
    console.error(`  ❌ [${b.booking_number}] GAGAL: ${errMsg}`);
    errors.push({ booking_number: b.booking_number, error: errMsg });
    failed++;
  }
}

// ── 4. Ringkasan ───────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────");
console.log(`Sinkronisasi Sport Center selesai`);
console.log(`  Berhasil : ${success}`);
console.log(`  Gagal    : ${failed}`);
console.log(`  Total    : ${bookings.length}`);
if (errors.length > 0) {
  console.log("\nDetail error:");
  for (const e of errors) {
    console.log(`  [${e.booking_number}] ${e.error}`);
  }
}
console.log("────────────────────────────────────────────");
if (failed === 0) {
  console.log("Sinkronisasi semua pembayaran Sport Center selesai ✅");
} else {
  console.log("Ada sebagian yang gagal — periksa log di atas ⚠️");
}

await cleanup();
process.exit(failed > 0 ? 1 : 0);

async function cleanup() {
  try { await pool.query("DELETE FROM sessions WHERE sid = $1", [sid]); } catch { }
  await pool.end();
}
