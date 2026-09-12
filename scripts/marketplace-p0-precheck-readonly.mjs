#!/usr/bin/env node
/**
 * scripts/marketplace-p0-precheck-readonly.mjs
 *
 * Pre-check READ-ONLY sebelum eksekusi manual migration Enterprise Marketplace P0
 * (Group A–D: enum types, 7 tabel baru, indexes, ALTER TABLE existing).
 *
 * Referensi:
 *   - migrations/enterprise-marketplace-p0.review.sql
 *   - docs/enterprise-marketplace-phase1c-execution-runbook.md
 *   - docs/enterprise-marketplace-blueprint-v1.1.1.md (Section 6, 7, 18)
 *
 * ─── ATURAN KERAS ────────────────────────────────────────────────────────────
 *  ✗  TIDAK ADA statement INSERT / UPDATE / DELETE / DDL di file ini.
 *  ✗  Password dan full connection string TIDAK PERNAH di-print ke log/console.
 *  ✓  Script WAJIB baca secret khusus: SUPABASE_MIGRATION_URL
 *     (bukan SUPABASE_DATABASE_URL / SUPABASE_DATABASE_URL_DEV biasa).
 *  ✓  Port WAJIB 5432 (session pooler / direct) — pgBouncer 6543 dilarang.
 *  ✓  Koneksi langsung STOP + throw error jika port != 5432 atau secret kosong.
 *  ✓  Setelah koneksi, session langsung di-set READ ONLY di level Postgres.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─── CARA MENJALANKAN (MANUAL, setelah backup + approval eksplisit) ──────────
 *
 *   SUPABASE_MIGRATION_URL="postgresql://postgres.XXXX:PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres" \
 *   node scripts/marketplace-p0-precheck-readonly.mjs
 *
 *   Atau export dulu, lalu jalankan:
 *     export SUPABASE_MIGRATION_URL="postgresql://....:5432/postgres"
 *     node scripts/marketplace-p0-precheck-readonly.mjs
 *
 * ─── PRASYARAT SEBELUM BOLEH DIJALANKAN ──────────────────────────────────────
 *  1. Backup / snapshot Supabase project sudah diambil dan diverifikasi.
 *  2. Secret SUPABASE_MIGRATION_URL sudah di-set (session pooler port 5432).
 *  3. Approval eksplisit dari owner / operator sudah diberikan.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Exit code 0  = semua pre-check selesai; hasil perlu direview manual.
 * Exit code 1  = validasi gagal (secret tidak ada / port salah / query error).
 */

import pg from "pg";

const { Client } = pg;

// ─── Konstanta ────────────────────────────────────────────────────────────────

const REQUIRED_SECRET_KEY = "SUPABASE_MIGRATION_URL";
const REQUIRED_PORT       = "5432";

/** Enum types yang akan dibuat di Group A */
const MKT_ENUM_TYPES = [
  "mkt_rfq_status",
  "mkt_rfq_priority",
  "mkt_quote_status",
  "mkt_stock_status",
  "mkt_po_status",
  "mkt_claim_status",
];

/** 7 tabel marketplace baru yang akan dibuat di Group B */
const MKT_NEW_TABLES = [
  "mkt_rfqs",
  "mkt_rfq_lines",
  "mkt_vendor_quotes",
  "mkt_vendor_quote_lines",
  "mkt_purchase_orders",
  "mkt_rfq_guest_claims",
  "mkt_company_settings",
];

/** Tabel existing yang direferensi FK dari tabel marketplace baru */
const MKT_PARENT_TABLES = [
  "companies",
  "suppliers",
  "vendor_catalog_items",
  "accounting_taxes",
  "sales_documents",
];

/** Tabel existing yang akan di-ALTER TABLE di Group D */
const GROUP_D_TABLES = [
  "activity_logs",
  "purchase_documents",
];

// ─── 1. Load & validasi secret ────────────────────────────────────────────────

function loadMigrationUrl() {
  const url = process.env[REQUIRED_SECRET_KEY];
  if (!url) {
    console.error(`[precheck] STOP: secret "${REQUIRED_SECRET_KEY}" tidak ditemukan di environment.`);
    console.error(`[precheck] Set secret ini terlebih dahulu (session pooler / direct, port 5432)`);
    console.error(`[precheck] sebelum menjalankan script ini.`);
    throw new Error(`Missing required secret: ${REQUIRED_SECRET_KEY}`);
  }
  return url;
}

// ─── 2. Validasi port TANPA print full connection string / password ────────────

function assertSessionPoolerPort(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error("[precheck] STOP: connection string tidak valid (gagal di-parse sebagai URL).");
    console.error("[precheck] Tidak ada detail lain yang di-log demi keamanan.");
    throw new Error("Invalid connection string format");
  }

  const port   = parsed.port;
  const host   = parsed.hostname;                          // aman — bukan credential
  const dbName = (parsed.pathname ?? "").replace(/^\//, "") || "(unknown)";

  // Log hanya info non-sensitif
  console.log(`[precheck] Target host   : ${host}`);
  console.log(`[precheck] Target port   : ${port || "(default, tidak eksplisit)"}`);
  console.log(`[precheck] Target dbname : ${dbName}`);
  console.log(`[precheck] Username      : ${parsed.username ? "(ada, tidak ditampilkan)" : "(kosong)"}`);
  console.log(`[precheck] Password      : (tidak pernah ditampilkan)`);

  if (port !== REQUIRED_PORT) {
    console.error(
      `[precheck] STOP: port terdeteksi = "${port || "(kosong)"}" — WAJIB "${REQUIRED_PORT}".`,
    );
    console.error(
      "[precheck] Port 6543 (transaction pooler pgBouncer) DILARANG untuk migration ini.",
    );
    console.error(
      "[precheck] Ganti SUPABASE_MIGRATION_URL ke connection string session pooler port 5432.",
    );
    throw new Error(`Invalid pooler port: expected ${REQUIRED_PORT}, got ${port || "(empty)"}`);
  }

  console.log(`[precheck] ✓ Port ${REQUIRED_PORT} terverifikasi (session pooler / direct connection).`);
}

// ─── 3. Query read-only ───────────────────────────────────────────────────────

/**
 * Cek apakah enum types Group A sudah ada di database.
 * Jika belum ada → aman dijalankan.
 * Jika sudah ada semua → migration mungkin sudah pernah dijalankan (atau partial).
 */
async function checkGroupAEnumTypes(client) {
  console.log("\n[precheck] ══ GROUP A — Enum Types ══════════════════════════════");
  const { rows } = await client.query(`
    SELECT
      typname                         AS enum_name,
      array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = ANY($1::text[])
    GROUP BY typname
    ORDER BY typname;
  `, [MKT_ENUM_TYPES]);

  const found = new Set(rows.map(r => r.enum_name));
  const missing = MKT_ENUM_TYPES.filter(t => !found.has(t));

  if (rows.length > 0) {
    console.log("[precheck] Enum types yang SUDAH ADA di DB:");
    console.table(rows);
  }

  if (missing.length > 0) {
    console.log("[precheck] Enum types yang BELUM ADA (akan dibuat oleh Group A):", missing);
  } else {
    console.log("[precheck] ⚠ Semua enum types sudah ada — Group A kemungkinan pernah dijalankan.");
  }

  // Cek khusus: apakah 'marketplace_commission' sudah ada di accounting_entry_source
  const { rows: enumVals } = await client.query(`
    SELECT e.enumlabel AS value
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'accounting_entry_source'
    ORDER BY e.enumsortorder;
  `);
  const hasCommission = enumVals.some(r => r.value === "marketplace_commission");
  console.log(
    `[precheck] accounting_entry_source contains 'marketplace_commission': ${hasCommission ? "YA (sudah ada)" : "BELUM (perlu ALTER TYPE)"}`,
  );

  return { found: [...found], missing, hasCommission };
}

/**
 * Cek apakah 7 tabel marketplace Group B sudah ada.
 * Ini menentukan apakah Group B aman / perlu skip.
 */
async function checkGroupBNewTables(client) {
  console.log("\n[precheck] ══ GROUP B — Tabel Marketplace Baru (7 tabel) ════════");
  const { rows } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
    ORDER BY table_name;
  `, [MKT_NEW_TABLES]);

  const found   = new Set(rows.map(r => r.table_name));
  const missing = MKT_NEW_TABLES.filter(t => !found.has(t));

  console.log("[precheck] Status tabel marketplace:");
  for (const t of MKT_NEW_TABLES) {
    console.log(`  ${found.has(t) ? "✓ SUDAH ADA" : "✗ BELUM ADA"} : ${t}`);
  }

  if (found.size === 0) {
    console.log("[precheck] ✓ Semua tabel belum ada — Group B aman dijalankan.");
  } else if (found.size === MKT_NEW_TABLES.length) {
    console.log("[precheck] ⚠ Semua tabel sudah ada — Group B kemungkinan pernah dijalankan.");
  } else {
    console.log(`[precheck] ⚠ Partial: ${found.size}/${MKT_NEW_TABLES.length} tabel sudah ada — review manual diperlukan.`);
  }

  return { found: [...found], missing };
}

/**
 * Cek keberadaan & row count tabel parent/referensi yang di-FK oleh tabel marketplace baru.
 * Jika tabel parent tidak ada → migration Group B akan gagal karena FK constraint.
 */
async function checkParentTables(client) {
  console.log("\n[precheck] ══ Tabel Parent / Referensi FK ═══════════════════════");

  const errors = [];
  for (const tbl of MKT_PARENT_TABLES) {
    try {
      const { rows } = await client.query(
        `SELECT COUNT(*) AS row_count FROM ${tbl};`,
      );
      console.log(`  ✓ ${tbl}: ${rows[0].row_count} baris`);
    } catch (err) {
      console.error(`  ✗ ${tbl}: GAGAL — ${err.message} (tabel mungkin tidak ada)`);
      errors.push(`${tbl}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `checkParentTables: ${errors.length} tabel parent gagal di-query:\n  ${errors.join("\n  ")}`,
    );
  }
}

/**
 * Cek index Group C yang akan dibuat — apakah sebagian sudah ada.
 */
async function checkGroupCIndexes(client) {
  console.log("\n[precheck] ══ GROUP C — Indexes Marketplace (apakah sudah ada) ═");
  const { rows } = await client.query(`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE tablename = ANY($1::text[])
      AND schemaname = 'public'
    ORDER BY tablename, indexname;
  `, [MKT_NEW_TABLES]);

  if (rows.length === 0) {
    console.log("[precheck] ✓ Belum ada index pada tabel marketplace — Group C aman dijalankan.");
  } else {
    console.log("[precheck] Index yang sudah ada pada tabel marketplace:");
    console.table(rows);
  }

  return rows;
}

/**
 * Group D: row count, table size, index size, lock impact, existing indexes,
 * dan active queries pada tabel yang akan di-ALTER TABLE (activity_logs, purchase_documents).
 */
async function checkGroupDAlterTargets(client) {
  console.log("\n[precheck] ══ GROUP D — Tabel Existing yang Akan di-ALTER TABLE ═");
  console.log("[precheck] Target:", GROUP_D_TABLES.join(", "));

  // 1. Cek kolom marketplace yang akan ditambahkan — apakah sudah ada?
  console.log("\n[precheck] — D.0 Kolom Group D yang Akan Ditambahkan ───────────");
  const newCols = [
    { table: "purchase_documents", column: "mkt_purchase_order_id" },
    { table: "activity_logs",      column: "mkt_rfq_id"            },
    { table: "activity_logs",      column: "mkt_vendor_quote_id"   },
    { table: "activity_logs",      column: "mkt_purchase_order_id" },
  ];
  const { rows: existingCols } = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) = ANY(
        SELECT unnest($1::text[]), unnest($2::text[])
      );
  `, [
    newCols.map(c => c.table),
    newCols.map(c => c.column),
  ]);
  const existingColSet = new Set(existingCols.map(r => `${r.table_name}.${r.column_name}`));
  for (const { table, column } of newCols) {
    const key = `${table}.${column}`;
    console.log(`  ${existingColSet.has(key) ? "✓ SUDAH ADA" : "✗ BELUM ADA"} : ${key}`);
  }

  const tableList = GROUP_D_TABLES.map(t => `'${t}'`).join(", ");

  // 2. Row count
  console.log("\n[precheck] — D.1 Row Count ──────────────────────────────────────");
  const { rows: rowCounts } = await client.query(`
    SELECT 'activity_logs' AS table_name, COUNT(*) AS row_count FROM activity_logs
    UNION ALL
    SELECT 'purchase_documents', COUNT(*) FROM purchase_documents;
  `);
  console.table(rowCounts);

  // 3. Table size
  console.log("\n[precheck] — D.2 Table Size ─────────────────────────────────────");
  const { rows: tableSizes } = await client.query(`
    SELECT
      c.relname                                     AS table_name,
      pg_size_pretty(pg_table_size(c.oid))          AS table_size,
      pg_table_size(c.oid)                          AS table_size_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname IN (${tableList})
      AND c.relkind = 'r'
      AND n.nspname = 'public';
  `);
  console.table(tableSizes);

  // 4. Index size
  console.log("\n[precheck] — D.3 Index Size ─────────────────────────────────────");
  const { rows: indexSizes } = await client.query(`
    SELECT
      c.relname                                     AS table_name,
      pg_size_pretty(pg_indexes_size(c.oid))        AS total_index_size,
      pg_indexes_size(c.oid)                        AS total_index_size_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname IN (${tableList})
      AND c.relkind = 'r'
      AND n.nspname = 'public';
  `);
  console.table(indexSizes);

  // 5. Estimated lock impact
  console.log("\n[precheck] — D.4 Estimated Lock Impact ─────────────────────────");
  const { rows: lockImpact } = await client.query(`
    SELECT
      s.relname                                              AS table_name,
      s.n_live_tup                                          AS estimated_row_count,
      pg_size_pretty(pg_total_relation_size(c.oid))         AS total_size_incl_indexes,
      CASE
        WHEN s.n_live_tup < 100000
          THEN 'LOW — ALTER TABLE kemungkinan < 1 detik, lock singkat'
        WHEN s.n_live_tup < 1000000
          THEN 'MEDIUM — ALTER TABLE bisa beberapa detik, pertimbangkan low-traffic window'
        ELSE
          'HIGH — ALTER TABLE bisa lama, pertimbangkan maintenance window khusus'
      END AS lock_risk_estimate
    FROM pg_stat_user_tables s
    JOIN pg_class c ON c.relname = s.relname
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE s.relname IN (${tableList})
      AND n.nspname = 'public';
  `);
  console.table(lockImpact);

  // 6. Active queries / locks pada tabel target (cek apakah ada proses berjalan)
  // Dikecualikan: sesi ini sendiri (pg_backend_pid()) dan sesi idle tanpa query aktif.
  // Tidak menggunakan ILIKE pada teks query untuk menghindari false-positive dari
  // script precheck itu sendiri — deteksi berbasis pg_locks + relasi pg_class.
  console.log("\n[precheck] — D.5 Active Queries / Locks pada Tabel Target ──────");
  const { rows: activeLocks } = await client.query(`
    SELECT DISTINCT
      a.pid,
      a.state,
      a.wait_event_type,
      a.wait_event,
      a.query_start,
      LEFT(a.query, 120) AS query_snippet
    FROM pg_stat_activity a
    JOIN pg_locks l ON l.pid = a.pid
    JOIN pg_class c ON c.oid = l.relation
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE c.relname IN (${tableList})
      AND ns.nspname = 'public'
      AND a.pid <> pg_backend_pid()
      AND a.state <> 'idle'
    ORDER BY a.query_start;
  `);
  if (activeLocks.length === 0) {
    console.log("[precheck] ✓ Tidak ada query aktif yang menyentuh tabel target saat ini.");
  } else {
    console.log(`[precheck] ⚠ ${activeLocks.length} query aktif ditemukan:`);
    console.table(activeLocks);
  }

  // 7. Existing indexes pada tabel target
  console.log("\n[precheck] — D.6 Existing Indexes pada Tabel Target ────────────");
  const { rows: existingIndexes } = await client.query(`
    SELECT
      tablename,
      indexname,
      indexdef
    FROM pg_indexes
    WHERE tablename IN (${tableList})
      AND schemaname = 'public'
    ORDER BY tablename, indexname;
  `);
  console.table(existingIndexes);

  return { rowCounts, tableSizes, indexSizes, lockImpact, activeLocks, existingIndexes };
}

// ─── 4. Ringkasan akhir ───────────────────────────────────────────────────────

function printSummary({ enumCheck, tableCheck, groupDResult }) {
  console.log("\n[precheck] ══ RINGKASAN ═══════════════════════════════════════════");

  // Group A
  if (enumCheck.missing.length === 0) {
    console.log("[precheck] GROUP A : ⚠ Semua enum sudah ada — cek apakah migration pernah dijalankan");
  } else {
    console.log(`[precheck] GROUP A : ${enumCheck.missing.length} enum belum ada → perlu dibuat`);
  }
  console.log(`[precheck]           'marketplace_commission' di accounting_entry_source: ${enumCheck.hasCommission ? "✓ sudah ada" : "✗ belum ada (perlu ALTER TYPE)"}`);

  // Group B
  if (tableCheck.missing.length === 0) {
    console.log("[precheck] GROUP B : ⚠ Semua tabel marketplace sudah ada");
  } else if (tableCheck.found.length === 0) {
    console.log("[precheck] GROUP B : ✓ Semua tabel belum ada → aman dijalankan");
  } else {
    console.log(`[precheck] GROUP B : ⚠ Partial — ${tableCheck.found.length} ada, ${tableCheck.missing.length} belum ada`);
  }

  // Group D
  const highLock = groupDResult.lockImpact.filter(r => r.lock_risk_estimate.startsWith("HIGH"));
  const medLock  = groupDResult.lockImpact.filter(r => r.lock_risk_estimate.startsWith("MEDIUM"));
  if (highLock.length > 0) {
    console.log(`[precheck] GROUP D : ⚠ HIGH lock risk pada: ${highLock.map(r => r.table_name).join(", ")}`);
  } else if (medLock.length > 0) {
    console.log(`[precheck] GROUP D : ⚠ MEDIUM lock risk — pertimbangkan low-traffic window`);
  } else {
    console.log("[precheck] GROUP D : ✓ LOW lock risk — ALTER TABLE singkat");
  }

  if (groupDResult.activeLocks.length > 0) {
    console.log(`[precheck] LOCKS   : ⚠ ${groupDResult.activeLocks.length} query aktif pada tabel target — tunda eksekusi`);
  } else {
    console.log("[precheck] LOCKS   : ✓ Tidak ada query aktif pada tabel target");
  }

  console.log("\n[precheck] Semua query di atas READ-ONLY. Tidak ada perubahan data/schema.");
  console.log("[precheck] Review hasil di atas sebelum memberi approval eksekusi Group A–D.");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(70));
  console.log("[precheck] Enterprise Marketplace P0 — Pre-Check Read-Only");
  console.log("[precheck] Mode: READ-ONLY (SELECT + metadata only, tidak ada DDL/DML)");
  console.log("═".repeat(70));

  // Step 1 & 2: validasi secret + port SEBELUM koneksi apapun
  const url = loadMigrationUrl();
  assertSessionPoolerPort(url);

  const client = new Client({
    connectionString: url,
    // Tidak set statement_timeout agar query metadata tidak terpotong
  });

  try {
    await client.connect();
    console.log("[precheck] Koneksi berhasil (session pooler / direct, port 5432).");

    // Safety net: paksa session READ ONLY di level Postgres
    // Jika ada bug yang menyelipkan statement non-SELECT, server langsung menolak.
    await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;");
    console.log("[precheck] Session di-set READ ONLY di level Postgres.");

    // Jalankan semua pre-check
    const enumCheck   = await checkGroupAEnumTypes(client);
    const tableCheck  = await checkGroupBNewTables(client);
    await checkParentTables(client);
    await checkGroupCIndexes(client);
    const groupDResult = await checkGroupDAlterTargets(client);

    printSummary({ enumCheck, tableCheck, groupDResult });

  } finally {
    await client.end();
  }
}

// Jalankan hanya jika dieksekusi langsung via `node scripts/...mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("\n[precheck] GAGAL:", err.message);
    process.exit(1);
  });
}

export { loadMigrationUrl, assertSessionPoolerPort, main as runMarketplacePrecheck };
