#!/usr/bin/env node
/**
 * audit-unused-supabase-tables.mjs
 *
 * Audit semua tabel di Supabase public schema:
 *   - Row count, FK masuk/keluar, index count
 *   - Scan kode satu-pass (bulk grep → inverse map) — jauh lebih cepat dari 457x grep
 *   - Klasifikasi: KEEP | MERGE | ARCHIVE | DELETE_CANDIDATE
 *   - Output: docs/supabase-table-cleanup-audit.md
 *             docs/supabase-table-cleanup-audit.json
 *             migrations/cleanup-unused-tables.review.sql
 *
 * Usage:
 *   node scripts/audit-unused-supabase-tables.mjs
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Koneksi ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!SUPABASE_URL) {
  console.error("ERROR: SUPABASE_DATABASE_URL tidak di-set");
  process.exit(1);
}

// ── Tabel accounting pusat yang WAJIB dipertahankan ─────────────────────────
const ALWAYS_KEEP = new Set([
  "companies", "branches", "cost_centers",
  "chart_of_accounts", "accounting_journals", "accounting_journal_lines",
  "accounting_ar", "accounting_ap", "cash_transactions", "bank_transactions",
  "financial_periods", "intercompany_transactions", "accounting_payments",
  "accounting_attachments", "audit_logs",
  // Accounting turunan penting
  "accounting_entries", "accounting_entry_lines", "accounting_settings",
  "accounting_taxes", "transaction_taxes", "financial_closings",
  "journal_approval_workflow", "journal_approval_logs", "journal_sequences",
  "master_bank_accounts", "ledger_entries", "ledger_events", "ledger_snapshots",
  "ledger_transaction_rules", "gl_elimination_entries", "elimination_runs",
  "gl_journal_bridge", "gl_tax_lines", "ap_subledger", "ar_subledger",
  "audit_accounting_events", "finance_audit_trail", "finance_anomaly_log",
  "intercompany_mirrors",
]);

// ── Tabel modul yang boleh tetap sebagai source data ────────────────────────
const MODULE_KEEP = new Set([
  "sport_bookings", "sport_facilities", "sport_payments", "sport_members",
  "sport_expenses", "sport_customers", "sport_settings", "sport_pricing_rules",
  "sport_promos", "sport_notifications", "sport_audit_logs", "sport_company_invoices",
  "sport_company_invoice_items", "sport_company_clients", "sport_maintenance_requests",
  "sport_blocked_schedules", "sport_refunds", "sport_member_reminder_logs",
  "tenant_invoices", "tenant_payments", "tenant_bookings", "tenant_units",
  "tenants", "tenant_user_access", "tenant_draft_agreements",
  "logistic_orders", "logistic_order_items", "logistic_order_quotes", "logistic_order_rfqs",
  "logistic_vendor_fulfillments", "logistic_order_vendor_tracking", "logistic_order_vendor_tracking_logs",
  "fleet_transactions", "fleet_outstanding", "fleet_drivers", "fleet_reports",
  "fleet_alerts", "fleet_alert_suppression", "fleet_daily_summary",
  "bank_mutations", "bank_mutation_imports", "bank_mutation_import_batches",
  "bank_mutation_import_rows", "bank_mutation_normalized_entries", "bank_mutation_import_audit",
  "cash_advances", "cash_advance_repayments",
  "payroll", "payroll_runs", "payroll_items",
  "gojek_raw_transactions", "gojek_ingestion_queue", "gojek_ingestion_reports",
  "gojek_uploaded_files", "gojek_failed_rows", "gojek_pipeline_audit_logs",
]);

// ── Tabel kasir (POS) aktif — ada data ──────────────────────────────────────
const KASIR_KEEP = new Set([
  "kasir_branches", "kasir_categories", "kasir_companies", "kasir_devices",
  "kasir_ingredients", "kasir_products", "kasir_users", "kasir_transactions",
  "kasir_bom_ingredients", "kasir_bom_recipes", "kasir_shifts",
  "kasir_stock_movements", "kasir_stock_transfers", "kasir_sync_queue",
]);

// ── Tabel POS sistem baru ─────────────────────────────────────────────────────
const POS_KEEP = new Set([
  "pos_audit_logs", "pos_branches", "pos_cashiers", "pos_inventory_items",
  "pos_inventory_stocks", "pos_order_items", "pos_orders", "pos_products",
  "pos_qr_orders", "pos_racks", "pos_recipe_items", "pos_recipes",
  "pos_role_permissions", "pos_roles", "pos_settings", "pos_shifts",
  "pos_stock_adjustments", "pos_stock_items", "pos_stock_losses",
  "pos_stock_mutations", "pos_stock_opname_items", "pos_stock_opnames",
  "pos_stock_quarantine", "pos_stock_return_items", "pos_stock_returns",
  "pos_stock_transfer_items", "pos_stock_transfers", "pos_warehouses",
]);

// ── Tabel yang diketahui legacy/tidak aktif ───────────────────────────────────
const KNOWN_LEGACY = new Set([
  "workflow_events", "shipments", "shipment_stages", "shipment_events", "shipment_trackings",
  "transaction_datetime_normalized", "fleet_pipeline_health", "fleet_outstanding_import_log",
  "fleet_partners", "fleet_wa_logs", "fleet_accounting_journals", "fleet_reconciliation_reports",
  "fleet_vehicles", "fleet_expenses", "fleet_ledger_entries",
  "sport_center_bookings", "sport_center_expenses", "sport_center_facilities",
  "sport_center_memberships", // superceded oleh sport_bookings, sport_facilities
  "sc_admin_notes", "sc_blocked_schedules", "sc_facility_images",
  "sc_payments", "sc_promos", "sc_settings", // duplikat sport_* tables
]);

// ── Tabel meta / system internal ─────────────────────────────────────────────
const SYSTEM_TABLES = new Set([
  "__drizzle_migrations", "schema_migrations", "sessions", "oauth_states",
]);

// ── snake_case → camelCase converter (untuk deteksi ORM variable names) ───────
function toCamelCase(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ── Scan kode: satu-pass bulk grep → inverse map ──────────────────────────────
// Scan BOTH snake_case (table name di SQL/string) AND camelCase (ORM variable)
function buildCodeUsageMap(tableNames) {
  console.log("🔍 Scanning kode (bulk pass — snake_case + camelCase)...");
  const SCAN_DIRS = ["artifacts", "lib", "packages", "scripts"]
    .map(d => path.join(ROOT, d))
    .filter(d => fs.existsSync(d))
    .map(d => `"${d}"`)
    .join(" ");

  // inverse map: tableName → Set<file>
  const usageMap = {};
  // Bangun peta: setiap search term → table name asli
  const termToTable = {};
  for (const name of tableNames) {
    usageMap[name] = new Set();
    termToTable[name] = name;
    const cc = toCamelCase(name);
    if (cc !== name) termToTable[cc] = name; // camelCase variant
  }

  const allTerms = Object.keys(termToTable);

  // Split batch dari terms (bukan table names)
  const BATCH_SIZE = 40;
  const batches = [];
  for (let i = 0; i < allTerms.length; i += BATCH_SIZE) {
    batches.push(allTerms.slice(i, i + BATCH_SIZE));
  }

  const processedFiles = new Set();

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const pattern = batch.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    try {
      const raw = execSync(
        `grep -rPl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.sql" ` +
        `"${pattern}" ${SCAN_DIRS} 2>/dev/null || true`,
        { encoding: "utf8", timeout: 20000, maxBuffer: 10 * 1024 * 1024 }
      );
      const matchedFiles = raw.trim().split("\n").filter(Boolean);

      for (const absFile of matchedFiles) {
        let content = "";
        try { content = fs.readFileSync(absFile, "utf8"); } catch { continue; }
        const relFile = path.relative(ROOT, absFile);
        const isNew = !processedFiles.has(absFile);
        processedFiles.add(absFile);

        for (const term of batch) {
          if (content.includes(term)) {
            const tableName = termToTable[term];
            usageMap[tableName].add(relFile);
          }
        }
        // Jika file sudah pernah di-scan di batch sebelumnya, scan term baru di file ini
        if (!isNew) continue; // sudah di-scan, term baru sudah di-check di atas
      }
      process.stdout.write(`   Batch ${bi + 1}/${batches.length} selesai (${processedFiles.size} file total)\n`);
    } catch (e) {
      process.stdout.write(`   Batch ${bi + 1}/${batches.length} ERROR: ${e.message}\n`);
    }
  }

  // Convert Set ke Array
  for (const name of tableNames) usageMap[name] = [...usageMap[name]];
  return usageMap;
}

// ── Klasifikasi tabel ─────────────────────────────────────────────────────────
function classifyTable(t) {
  const name = t.table_name;
  const rows = Number(t.row_count);
  const hasFkIn = t.fk_references_in > 0;
  const hasFkOut = t.fk_references_out > 0;
  const usedInCode = t.code_files.length > 0;

  if (SYSTEM_TABLES.has(name))
    return { status: "KEEP", reason: "Tabel system/migration internal", risk: "CRITICAL" };
  if (ALWAYS_KEEP.has(name))
    return { status: "KEEP", reason: "Tabel accounting pusat — wajib dipertahankan", risk: "CRITICAL" };
  if (MODULE_KEEP.has(name))
    return { status: "KEEP", reason: "Tabel modul aktif sebagai source data", risk: "HIGH" };
  if (KASIR_KEEP.has(name))
    return { status: "KEEP", reason: "Tabel kasir/POS lama — ada data operasional", risk: "HIGH" };
  if (POS_KEEP.has(name))
    return { status: "KEEP", reason: "Tabel POS sistem baru — aktif", risk: "HIGH" };

  // Legacy duplikat sport_center_* vs sport_*
  if (KNOWN_LEGACY.has(name)) {
    if (hasFkIn)
      return { status: "ARCHIVE", reason: "Legacy — masih ada FK masuk, investigasi dulu sebelum drop", risk: "MEDIUM" };
    if (rows > 100)
      return { status: "ARCHIVE", reason: `Legacy — ${rows.toLocaleString()} rows, backup dulu sebelum drop`, risk: "MEDIUM" };
    if (rows === 0 && !usedInCode && !hasFkIn)
      return { status: "DELETE_CANDIDATE", reason: "Legacy, kosong, tidak dipakai di kode, tidak ada FK masuk", risk: "LOW" };
    return { status: "ARCHIVE", reason: "Legacy — perlu konfirmasi tim sebelum drop", risk: "MEDIUM" };
  }

  // Tabel yang ada di kode → KEEP
  if (usedInCode) {
    // Journal tambahan di luar sistem accounting pusat?
    const isExtraJournal = name.includes("journal") &&
      !["accounting_journals", "accounting_journal_lines", "journal_sequences",
        "journal_approval_logs", "journal_approval_workflow", "fleet_accounting_journals",
        "gl_journal_bridge", "bank_journal_entries"].includes(name);
    if (isExtraJournal)
      return { status: "MERGE", reason: "Tabel journal di luar accounting pusat — evaluasi konsolidasi", risk: "MEDIUM" };
    return { status: "KEEP", reason: "Dipakai di kode", risk: rows > 10000 ? "HIGH" : "MEDIUM" };
  }

  // Tidak ada di kode, tidak ada FK masuk, kosong → DELETE_CANDIDATE
  if (!hasFkIn && !usedInCode && rows === 0)
    return { status: "DELETE_CANDIDATE", reason: "Kosong, tidak ada FK masuk, tidak ditemukan di kode", risk: "LOW" };

  // Ada FK masuk tapi tidak di kode
  if (hasFkIn && !usedInCode)
    return { status: "ARCHIVE", reason: "Ada FK masuk tapi tidak ditemukan di kode — kemungkinan dependency tersembunyi", risk: "MEDIUM" };

  // Ada data tapi tidak di kode dan tidak ada FK masuk
  if (rows > 0 && !usedInCode && !hasFkIn) {
    if (rows > 500)
      return { status: "ARCHIVE", reason: `${rows.toLocaleString()} rows tapi tidak ditemukan di kode — arsip sebelum keputusan`, risk: "MEDIUM" };
    return { status: "DELETE_CANDIDATE", reason: `${rows} row(s) kecil, tidak ditemukan di kode, tidak ada FK masuk`, risk: "LOW" };
  }

  // Ada FK keluar atau data → pertahankan
  if (rows > 0 || hasFkOut)
    return { status: "KEEP", reason: "Memiliki data atau FK keluar — pertahankan", risk: "MEDIUM" };

  return { status: "DELETE_CANDIDATE", reason: "Tidak ada data, FK masuk, atau pemakaian di kode", risk: "LOW" };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = new Client({
    connectionString: SUPABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 60000,
    query_timeout: 60000,
  });

  console.log("🔌 Menghubungkan ke Supabase...");
  await client.connect();
  console.log("✅ Terhubung.\n");

  // ── 1. Ambil semua tabel public schema ────────────────────────────────────
  console.log("📋 Mengambil daftar tabel...");
  const { rows: tables } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`   Ditemukan ${tables.length} tabel.\n`);

  // ── 2. Row count sekaligus via UNION (lebih cepat dari 457x query) ─────────
  console.log("🔢 Menghitung row count per tabel (batch)...");
  const results = [];
  const BATCH_SIZE = 20;
  for (let i = 0; i < tables.length; i += BATCH_SIZE) {
    const batch = tables.slice(i, i + BATCH_SIZE);
    const parts = batch.map(t => `SELECT '${t.table_name}' AS tname, COUNT(*) AS cnt FROM "${t.table_name}"`);
    try {
      const { rows } = await client.query(parts.join(" UNION ALL "));
      for (const r of rows) results.push({ table_name: r.tname, row_count: parseInt(r.cnt, 10) });
    } catch {
      // Fallback: per-tabel jika UNION gagal
      for (const t of batch) {
        let rc = 0;
        try {
          const r = await client.query(`SELECT COUNT(*) AS c FROM "${t.table_name}"`);
          rc = parseInt(r.rows[0].c, 10);
        } catch { rc = -1; }
        results.push({ table_name: t.table_name, row_count: rc });
      }
    }
    process.stdout.write(`   ${Math.min(i + BATCH_SIZE, tables.length)}/${tables.length} tabel diproses\n`);
  }

  // ── 3. FK relationships ───────────────────────────────────────────────────
  console.log("\n🔗 Mengambil foreign key relationships...");
  const { rows: fkRows } = await client.query(`
    SELECT
      tc.table_name AS source_table,
      ccu.table_name AS target_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `);
  const fkIn = {}, fkOut = {};
  for (const fk of fkRows) {
    fkOut[fk.source_table] = (fkOut[fk.source_table] || 0) + 1;
    fkIn[fk.target_table] = (fkIn[fk.target_table] || 0) + 1;
  }
  console.log(`   ${fkRows.length} FK ditemukan.\n`);

  // ── 4. Indeks per tabel ───────────────────────────────────────────────────
  const { rows: indexRows } = await client.query(`
    SELECT tablename AS table_name, COUNT(*) AS index_count
    FROM pg_indexes WHERE schemaname = 'public'
    GROUP BY tablename
  `);
  const indexMap = {};
  for (const r of indexRows) indexMap[r.table_name] = parseInt(r.index_count, 10);

  // ── 5. Tutup koneksi DB sebelum scan kode ─────────────────────────────────
  await client.end();
  console.log("✅ DB queries selesai. Koneksi ditutup.\n");

  // Attach FK & index ke results
  for (const t of results) {
    t.fk_references_in = fkIn[t.table_name] || 0;
    t.fk_references_out = fkOut[t.table_name] || 0;
    t.index_count = indexMap[t.table_name] || 0;
  }

  // ── 6. Scan kode: bulk pass ───────────────────────────────────────────────
  const tableNames = results.map(t => t.table_name);
  const usageMap = buildCodeUsageMap(tableNames);
  for (const t of results) t.code_files = usageMap[t.table_name] || [];

  // ── 7. Klasifikasi ────────────────────────────────────────────────────────
  console.log("\n🏷️  Mengklasifikasikan tabel...");
  for (const t of results) {
    const cls = classifyTable(t);
    t.status = cls.status;
    t.reason = cls.reason;
    t.risk = cls.risk;
  }

  // ── 8. Ringkasan ──────────────────────────────────────────────────────────
  const byStatus = { KEEP: [], MERGE: [], ARCHIVE: [], DELETE_CANDIDATE: [] };
  for (const t of results) byStatus[t.status].push(t);

  console.log("\n" + "═".repeat(60));
  console.log("RINGKASAN AUDIT");
  console.log("═".repeat(60));
  console.log(`Total tabel          : ${results.length}`);
  console.log(`KEEP                 : ${byStatus.KEEP.length}`);
  console.log(`MERGE                : ${byStatus.MERGE.length}`);
  console.log(`ARCHIVE              : ${byStatus.ARCHIVE.length}`);
  console.log(`DELETE_CANDIDATE     : ${byStatus.DELETE_CANDIDATE.length}`);
  const dFk = byStatus.DELETE_CANDIDATE.filter(t => t.fk_references_in > 0);
  const dData = byStatus.DELETE_CANDIDATE.filter(t => t.row_count > 0);
  console.log(`  ⚠️  Kandidat hapus dg FK masuk : ${dFk.length}`);
  console.log(`  ⚠️  Kandidat hapus dg data     : ${dData.length}`);
  console.log("═".repeat(60) + "\n");

  // ── 9. Generate output files ──────────────────────────────────────────────
  await writeMarkdown(results, byStatus);
  await writeJson(results, byStatus);
  await writeSql(byStatus.DELETE_CANDIDATE, byStatus.ARCHIVE);

  console.log("\n✅ Selesai. Output:");
  console.log("   docs/supabase-table-cleanup-audit.md");
  console.log("   docs/supabase-table-cleanup-audit.json");
  console.log("   migrations/cleanup-unused-tables.review.sql");
}

// ── Write Markdown ─────────────────────────────────────────────────────────
async function writeMarkdown(results, byStatus) {
  const now = new Date().toISOString().slice(0, 10);
  const sIcon = { KEEP: "✅", MERGE: "🔀", ARCHIVE: "📦", DELETE_CANDIDATE: "🗑️" };
  const rBadge = { CRITICAL: "🔴 CRITICAL", HIGH: "🟠 HIGH", MEDIUM: "🟡 MEDIUM", LOW: "🟢 LOW" };

  const tRow = t =>
    `| \`${t.table_name}\` | ${t.row_count < 0 ? "ERR" : t.row_count.toLocaleString()} | ${t.fk_references_in} | ${t.fk_references_out} | ${t.index_count} | ${sIcon[t.status]} ${t.status} | ${rBadge[t.risk]} | ${t.reason} |`;

  const section = (label, icon, items) => {
    if (!items.length) return "";
    return `## ${icon} ${label} (${items.length})\n\n` +
      `| Tabel | Rows | FK↓ | FK↑ | Idx | Status | Risiko | Alasan |\n` +
      `|-------|-----:|----:|----:|----:|--------|--------|--------|\n` +
      items.map(tRow).join("\n") + "\n\n";
  };

  const md = `# Supabase Table Cleanup Audit
> Dibuat oleh \`scripts/audit-unused-supabase-tables.mjs\` — ${now}

## Ringkasan Eksekutif

| Kategori | Jumlah |
|----------|-------:|
| ✅ KEEP | **${byStatus.KEEP.length}** |
| 🔀 MERGE | **${byStatus.MERGE.length}** |
| 📦 ARCHIVE | **${byStatus.ARCHIVE.length}** |
| 🗑️ DELETE_CANDIDATE | **${byStatus.DELETE_CANDIDATE.length}** |
| **Total** | **${results.length}** |

> **FK↓** = FK masuk (tabel lain mengacu ke tabel ini)
> **FK↑** = FK keluar (tabel ini mengacu ke tabel lain)
> ⚠️ DELETE_CANDIDATE dengan FK masuk: **${byStatus.DELETE_CANDIDATE.filter(t => t.fk_references_in > 0).length}** — jangan drop sebelum investigasi FK
> ⚠️ DELETE_CANDIDATE dengan data: **${byStatus.DELETE_CANDIDATE.filter(t => t.row_count > 0).length}** — backup dulu

## Rekomendasi Langkah Selanjutnya

1. **Review ARCHIVE**: Konfirmasi apakah data perlu dipindahkan sebelum drop. Buat archive schema jika perlu.
2. **Review MERGE**: Evaluasi apakah tabel tambahan bisa konsolidasi ke tabel accounting pusat.
3. **Uncomment DELETE_CANDIDATE**: Buka \`migrations/cleanup-unused-tables.review.sql\`, uncomment dan jalankan hanya setelah konfirmasi penuh.
4. **Selalu pg_dump production** sebelum menjalankan DROP apapun.
5. **Maintenance window**: Jalankan cleanup di luar jam operasional.

---

${section("KEEP — Pertahankan", "✅", byStatus.KEEP)}
${section("MERGE — Evaluasi Konsolidasi", "🔀", byStatus.MERGE)}
${section("ARCHIVE — Arsip Dulu", "📦", byStatus.ARCHIVE)}
${section("DELETE_CANDIDATE — Kandidat Hapus", "🗑️", byStatus.DELETE_CANDIDATE)}

---

## Tabel Accounting Pusat (Tidak Boleh Dihapus)

\`companies\`, \`branches\`, \`cost_centers\`, \`chart_of_accounts\`, \`accounting_journals\`,
\`accounting_journal_lines\`, \`accounting_ar\`, \`accounting_ap\`, \`cash_transactions\`,
\`bank_transactions\`, \`financial_periods\`, \`intercompany_transactions\`,
\`accounting_payments\`, \`accounting_attachments\`, \`audit_logs\`

---
*Auto-generated — jangan edit manual. Jalankan ulang script untuk refresh.*
`;

  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "docs/supabase-table-cleanup-audit.md"), md, "utf8");
  console.log("📄 Wrote: docs/supabase-table-cleanup-audit.md");
}

// ── Write JSON ─────────────────────────────────────────────────────────────
async function writeJson(results, byStatus) {
  const output = {
    generated_at: new Date().toISOString(),
    generator: "scripts/audit-unused-supabase-tables.mjs",
    summary: {
      total: results.length,
      KEEP: byStatus.KEEP.length,
      MERGE: byStatus.MERGE.length,
      ARCHIVE: byStatus.ARCHIVE.length,
      DELETE_CANDIDATE: byStatus.DELETE_CANDIDATE.length,
      delete_with_fk_in: byStatus.DELETE_CANDIDATE.filter(t => t.fk_references_in > 0).length,
      delete_with_data: byStatus.DELETE_CANDIDATE.filter(t => t.row_count > 0).length,
    },
    tables: results.map(t => ({
      table_name: t.table_name,
      row_count: t.row_count,
      fk_references_in: t.fk_references_in,
      fk_references_out: t.fk_references_out,
      index_count: t.index_count,
      code_file_count: t.code_files.length,
      code_files: t.code_files.slice(0, 10), // max 10 file per entry di JSON
      status: t.status,
      risk: t.risk,
      reason: t.reason,
    })),
  };
  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "docs/supabase-table-cleanup-audit.json"),
    JSON.stringify(output, null, 2), "utf8"
  );
  console.log("📄 Wrote: docs/supabase-table-cleanup-audit.json");
}

// ── Write SQL ──────────────────────────────────────────────────────────────
async function writeSql(deleteCandidates, archiveCandidates) {
  const now = new Date().toISOString().slice(0, 10);
  const safe = deleteCandidates.filter(t => t.fk_references_in === 0);
  const unsafe = deleteCandidates.filter(t => t.fk_references_in > 0);

  const verifyRows = deleteCandidates.map(t =>
    `SELECT '${t.table_name}' AS tabel, COUNT(*) AS rows FROM "${t.table_name}";`
  ).join("\n");

  const safeDrop = safe.map(t => `
-- Tabel : ${t.table_name}
-- Rows  : ${t.row_count < 0 ? "ERROR saat query" : t.row_count.toLocaleString()}
-- Alasan: ${t.reason}
-- Risiko: ${t.risk}
-- DROP TABLE IF EXISTS "${t.table_name}" CASCADE;
`).join("\n");

  const unsafeDrop = unsafe.length > 0 ? `
-- ── ⚠️  DELETE_CANDIDATE DENGAN FK MASUK — JANGAN DROP DULU ─────────────────
${unsafe.map(t => `
-- ⚠️  Tabel : ${t.table_name}
-- Rows    : ${t.row_count < 0 ? "ERROR" : t.row_count.toLocaleString()}
-- FK Masuk: ${t.fk_references_in} — INVESTIGASI FK DULU
-- Alasan  : ${t.reason}
-- DROP TABLE IF EXISTS "${t.table_name}" CASCADE;  -- JANGAN uncomment sebelum FK aman
`).join("\n")}
` : "-- (Tidak ada DELETE_CANDIDATE dengan FK masuk)\n";

  const archiveDrop = archiveCandidates.length > 0 ? `
-- ── ARCHIVE — Pindah ke schema archive dulu ────────────────────────────────
-- Jalankan CREATE TABLE archive."..." AS TABLE terlebih dahulu,
-- baru DROP TABLE public."..." setelah data terkonfirmasi aman.
${archiveCandidates.map(t => `
-- Tabel  : ${t.table_name}
-- Rows   : ${t.row_count < 0 ? "ERROR" : t.row_count.toLocaleString()}
-- FK↓    : ${t.fk_references_in}
-- Alasan : ${t.reason}
-- CREATE SCHEMA IF NOT EXISTS archive;
-- CREATE TABLE IF NOT EXISTS archive."${t.table_name}" AS TABLE public."${t.table_name}";
-- DROP TABLE IF EXISTS public."${t.table_name}" CASCADE;
`).join("\n")}
` : "";

  const sql = `-- ============================================================================
-- cleanup-unused-tables.review.sql
-- Dibuat : ${now} oleh scripts/audit-unused-supabase-tables.mjs
-- Status : DRAFT — JANGAN JALANKAN TANPA REVIEW PENUH
--
-- SEMUA DROP DIKOMENTARI. Uncomment dan jalankan HANYA setelah:
--   1. Konfirmasi audit report dengan seluruh tim engineering
--   2. pg_dump production disimpan dan diverifikasi
--   3. Validasi row count = 0 atau data sudah dimigrasikan
--   4. Semua FK aktif sudah diputus / dipindahkan
--   5. Dijalankan di maintenance window dengan rollback siap
-- ============================================================================

-- ── STEP 0: VERIFIKASI ROW COUNT (jalankan dulu, pastikan sesuai ekspektasi) ─

${verifyRows}

-- ── STEP 1: DELETE_CANDIDATE — Tidak ada FK masuk ─────────────────────────────

${safeDrop}

${unsafeDrop}

${archiveDrop}
`;

  fs.mkdirSync(path.join(ROOT, "migrations"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "migrations/cleanup-unused-tables.review.sql"),
    sql, "utf8"
  );
  console.log("📄 Wrote: migrations/cleanup-unused-tables.review.sql");
}

main().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
