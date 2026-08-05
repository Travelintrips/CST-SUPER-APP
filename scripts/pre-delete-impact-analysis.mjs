#!/usr/bin/env node
/**
 * pre-delete-impact-analysis.mjs
 *
 * PRE-DELETE IMPACT ANALYSIS untuk semua tabel ARCHIVE dan DELETE_CANDIDATE.
 * Scan: Frontend React | API Routes | Drizzle Schema | DB Views/Functions/Triggers
 *       Schedulers/Workers | AI Services | Export/Reports | Dashboard KPI
 *
 * Output:
 *   docs/table-impact-analysis.md
 *   docs/table-impact-analysis.json
 *   migrations/archive-phase-1.sql           (RENAME TO zz_deleted_*)
 *   migrations/archive-phase-1-rollback.sql  (RENAME BACK)
 *
 * Usage:
 *   node scripts/pre-delete-impact-analysis.mjs
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!SUPABASE_URL) { console.error("SUPABASE_DATABASE_URL tidak di-set"); process.exit(1); }

// ── Tabel yang dianalisis (11 tabel prioritas deep-trace) ────────────────────
const DEEP_TRACE_TABLES = new Set([
  "sport_center_bookings", "sport_center_facilities",
  "fleet_partners", "fleet_vehicles", "fleet_ledger_entries",
  "shipments", "shipment_stages", "shipment_events", "shipment_trackings",
  "employees", "employee_kasbon",
]);

// ── Pola scan per layer ───────────────────────────────────────────────────────
const LAYER_PATTERNS = {
  frontend:   { dirs: ["artifacts/bizportal/src", "artifacts/customer-portal/src", "artifacts/cst-driver"], exts: [".ts", ".tsx"] },
  api_routes: { dirs: ["artifacts/api-server/src/routes", "artifacts/api-server/src/modules"], exts: [".ts"] },
  api_lib:    { dirs: ["artifacts/api-server/src/lib", "artifacts/api-server/src/services"], exts: [".ts"] },
  schema:     { dirs: ["lib/db/src/schema", "lib/db/src"], exts: [".ts"] },
  scheduler:  { dirs: ["artifacts/api-server/src/lib"], exts: [".ts"], keyword_filter: ["Worker", "Scheduler", "Cron", "poller", "Notifier", "worker", "scheduler"] },
  ai:         { dirs: ["artifacts/api-server/src/routes", "artifacts/api-server/src/lib"], exts: [".ts"], keyword_filter: ["aiAgent", "aiGovernance", "openai", "gpt", "llm", "AI"] },
  export:     { dirs: ["artifacts/api-server/src/routes", "artifacts/api-server/src/lib"], exts: [".ts"], keyword_filter: ["export", "gsheet", "xlsx", "csv", "pdf", "report"] },
  migrations: { dirs: ["artifacts/api-server/src/lib", "artifacts/api-server/src/modules", "scripts", "lib/db"], exts: [".ts", ".mjs", ".sql"] },
};

// ── Scheduler/Worker files yang diketahui ────────────────────────────────────
const KNOWN_WORKERS = [
  "fleetNotificationWorker.ts", "driverJobWorker.ts", "expenseReminderWorker.ts",
  "fulfillmentExpiryNotifier.ts", "imapPoller.ts", "recurringExpenseWorker.ts",
  "memberReminderWorker.ts", "vmfGapNotifier.ts", "sportSyncNotifier.ts",
  "sportCenterPaymentSyncWorker.ts", "startupOrchestrator.ts", "dbBackup.ts",
  "aiGovernance.ts",
];

// ── snake_case → camelCase ────────────────────────────────────────────────────
function toCamel(s) { return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }

// ── Bulk code scan: satu-pass untuk semua tabel ───────────────────────────────
// Kembalikan: { tableName → { file → content_snippet } }
function bulkScanAllTables(tableNames) {
  console.log("🔍 Bulk code scan (single pass) ...");
  const SCAN_DIRS = ["artifacts", "lib", "packages", "scripts"]
    .map(d => path.join(ROOT, d)).filter(d => fs.existsSync(d))
    .map(d => `"${d}"`).join(" ");

  // Bangun map: term → tableName (snake + camelCase)
  const termToTable = {};
  for (const name of tableNames) {
    termToTable[name] = name;
    const cc = toCamel(name);
    if (cc !== name) termToTable[cc] = name;
  }
  const allTerms = Object.keys(termToTable);

  // tableName → Set<relFile>
  const tableFiles = {};
  for (const n of tableNames) tableFiles[n] = new Set();

  const BATCH = 40;
  for (let i = 0; i < allTerms.length; i += BATCH) {
    const batch = allTerms.slice(i, i + BATCH);
    const pattern = batch.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    try {
      const raw = execSync(
        `grep -rPl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.sql" ` +
        `"${pattern}" ${SCAN_DIRS} 2>/dev/null || true`,
        { encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024 }
      );
      const files = raw.trim().split("\n").filter(Boolean);
      for (const abs of files) {
        let content = "";
        try { content = fs.readFileSync(abs, "utf8"); } catch { continue; }
        const rel = path.relative(ROOT, abs);
        for (const term of batch) {
          if (content.includes(term)) {
            tableFiles[termToTable[term]].add(rel);
          }
        }
      }
    } catch { /* ignore */ }
    process.stdout.write(`   batch ${Math.floor(i/BATCH)+1}/${Math.ceil(allTerms.length/BATCH)} done\n`);
  }

  // Convert Set → Array
  for (const n of tableNames) tableFiles[n] = [...tableFiles[n]];
  return tableFiles;
}

// ── Klasifikasi file per layer ─────────────────────────────────────────────
function classifyFilesByLayer(files) {
  const refs = {
    frontend:   [],
    api_routes: [],
    api_lib:    [],
    schema:     [],
    scheduler:  [],
    ai:         [],
    export:     [],
    migrations: [],
  };

  for (const f of files) {
    const fp = f.replace(/\\/g, "/");
    const base = path.basename(f).toLowerCase();

    if (fp.includes("bizportal/src") || fp.includes("customer-portal/src") || fp.includes("cst-driver/src")) {
      refs.frontend.push(f);
    } else if (fp.includes("api-server/src/routes") || fp.includes("api-server/src/modules")) {
      const isWorker = KNOWN_WORKERS.some(w => base.includes(w.toLowerCase().replace(".ts", "")));
      if (isWorker) refs.scheduler.push(f);
      else refs.api_routes.push(f);
    } else if (fp.includes("api-server/src/lib") || fp.includes("api-server/src/services")) {
      const isWorker = KNOWN_WORKERS.some(w => base.includes(w.toLowerCase().replace(".ts", "")));
      const isAi     = ["aiagent", "aigovernance", "aiapproval", "openai", "llm"].some(k => base.includes(k));
      const isExport = ["export", "gsheet", "xlsx", "csv", "report"].some(k => base.includes(k));
      if (isWorker) refs.scheduler.push(f);
      else if (isAi) refs.ai.push(f);
      else if (isExport) refs.export.push(f);
      else refs.api_lib.push(f);
    } else if (fp.includes("lib/db/src/schema") || fp.includes("lib/db/src")) {
      refs.schema.push(f);
    } else if (fp.includes("migration") || fp.includes("scripts/") || fp.endsWith(".sql")) {
      refs.migrations.push(f);
    } else {
      refs.api_lib.push(f); // fallback
    }
  }
  return refs;
}

// ── Risk scoring ──────────────────────────────────────────────────────────────
function computeRisk(refs, rowCount, fkIn, fkOut, tableName) {
  const totalRefs = Object.values(refs).flat().length;
  const hasData = rowCount > 0;
  const hasFkIn = fkIn > 0;
  const deepTrace = DEEP_TRACE_TABLES.has(tableName);

  if (refs.frontend.length > 0) return "CRITICAL";
  if (refs.api_routes.length > 0) return "HIGH";
  if (refs.api_lib.length > 0 || refs.scheduler.length > 0) return "HIGH";
  if (refs.schema.length > 0 && !refs.schema.every(f => f.includes("shipments.ts") || f.includes("shipmentStages.ts"))) return "MEDIUM";
  if (hasFkIn) return "MEDIUM";
  if (refs.migrations.length > 0) return "LOW";
  if (hasData && rowCount > 10) return "LOW";
  return "SAFE";
}

// ── Pre-built deep-trace knowledge (dari penelitian manual) ───────────────────
const DEEP_TRACE_FINDINGS = {
  fleet_partners: {
    summary: "AKTIF digunakan di fleetIntelligence.ts. Inline migration CREATE TABLE dan route CRUD (GET/POST/PUT). FK masuk dari fleet_vehicles, fleet_reports, fleet_drivers (ON DELETE SET NULL).",
    special_notes: [
      "fleetIntelligence.ts L118: CREATE TABLE IF NOT EXISTS fleet_partners — inline migration masih aktif",
      "fleetIntelligence.ts L652: SELECT * FROM fleet_partners — query aktif",
      "fleetIntelligence.ts L668: INSERT INTO fleet_partners — CRUD aktif",
      "fleet_vehicles, fleet_reports, fleet_drivers memiliki FK ke fleet_partners (ON DELETE SET NULL)",
      "fleetNotificationWorker.ts referensi fleet_partners melalui join",
    ],
    override_risk: "CRITICAL",
  },
  fleet_vehicles: {
    summary: "AKTIF digunakan di fleetIntelligence.ts. Inline migration + query gabungan dengan gojek_raw_transactions. FK masuk dari fleet_transactions (vehicle_id).",
    special_notes: [
      "fleetIntelligence.ts L133: CREATE TABLE IF NOT EXISTS fleet_vehicles — inline migration aktif",
      "fleetIntelligence.ts L2255: SELECT gabungan fleet_vehicles + gojek_raw_transactions",
      "fleetIntelligence.ts L2279,2301,2319,2339: INSERT INTO fleet_vehicles aktif",
      "fleet_transactions memiliki FK ke fleet_vehicles (ON DELETE SET NULL)",
    ],
    override_risk: "CRITICAL",
  },
  fleet_ledger_entries: {
    summary: "Tabel ledger yang digunakan oleh financialClosingMigration.ts dan ledger.ts. Berisi 17 rows historis. Nama berbeda dari ledger_entries (tabel accounting pusat).",
    special_notes: [
      "financialClosingMigration.ts: CREATE TABLE fleet_ledger_entries + ALTER TABLE",
      "ledger.ts: JOIN query melibatkan fleet_ledger_entries",
      "accounting.ts: referensi untuk posting jurnal fleet",
      "reconciliation.ts: dipakai di reconciliation report fleet",
      "17 rows data historis — harus dimigrasi ke accounting_entries sebelum rename",
    ],
    override_risk: "HIGH",
  },
  shipments: {
    summary: "Tabel legacy logistics (bukan freight_shipments). Schema Drizzle masih ada di lib/db/src/schema/shipments.ts tapi komentar menyatakan sudah dinonaktifkan. Tidak ada query aktif ditemukan.",
    special_notes: [
      "lib/db/src/schema/shipments.ts: masih ada definisi pgTable('shipments') tapi sudah di-mark deprecated",
      "lib/db/src/schema/index.ts L8: export * from './shipments' — masih di-export",
      "Tidak ada route aktif yang query tabel ini",
      "0 rows — aman untuk rename setelah schema cleanup",
      "PERLU: hapus dari lib/db/src/schema/index.ts sebelum rename",
    ],
    override_risk: "LOW",
  },
  shipment_stages: {
    summary: "Tabel legacy logistics. Drizzle schema masih ada. contextOrchestrator.ts L474 masih query tabel ini dalam AI context builder.",
    special_notes: [
      "lib/db/src/schema/shipmentStages.ts: pgTable('shipment_stages') — masih dalam schema",
      "lib/db/src/schema/index.ts L20: export * from './shipmentStages' — masih di-export",
      "contextOrchestrator.ts L474: FROM shipment_stages — QUERY AKTIF di AI context",
      "0 rows — tapi query aktif di contextOrchestrator berarti rename akan error saat AI context dijalankan",
      "PERLU: update contextOrchestrator.ts sebelum rename",
    ],
    override_risk: "MEDIUM",
  },
  shipment_events: {
    summary: "Tabel legacy logistik. Tidak ada referensi kode aktif. 0 rows.",
    special_notes: [
      "Tidak ditemukan di kode manapun selain mungkin schema creation",
      "0 rows — aman untuk rename",
    ],
    override_risk: "SAFE",
  },
  shipment_trackings: {
    summary: "Tabel legacy logistik. Tidak ada referensi kode aktif. 0 rows.",
    special_notes: [
      "Tidak ditemukan di kode manapun",
      "0 rows — aman untuk rename",
    ],
    override_risk: "SAFE",
  },
  sport_center_bookings: {
    summary: "Tabel legacy sport center (versi lama). Digunakan sebagai SOURCE DATA oleh sport-center migration script untuk migrasi ke sport_bookings (tabel baru). Juga digunakan sebagai target sync dari Supabase.",
    special_notes: [
      "modules/sport-center/migration.ts L323: READ dari sport_center_bookings sebagai sumber migrasi",
      "modules/sport-center/migration.ts L341,378: SELECT FROM sport_center_bookings untuk sync data",
      "modules/sport-center/routes.ts L4749: INSERT INTO sport_center_bookings — masih menulis ke tabel ini saat sync",
      "2 rows data — perlu diverifikasi sudah termigrasikan ke sport_bookings sebelum rename",
      "PERLU: pastikan data sudah ter-sync ke sport_bookings sebelum rename",
    ],
    override_risk: "MEDIUM",
  },
  sport_center_facilities: {
    summary: "Tabel legacy sport center. Digunakan di routes.ts sebagai sumber data Supabase. FK masuk (1 referensi).",
    special_notes: [
      "modules/sport-center/routes.ts L4716: SELECT FROM sport_center_facilities — query aktif ke Supabase",
      "1 FK masuk — perlu diselidiki constraint apa",
      "2 rows data",
      "PERLU: migrasi query ke sport_facilities sebelum rename",
    ],
    override_risk: "MEDIUM",
  },
  employees: {
    summary: "Tabel HR yang tidak ditemukan referensinya di kode TypeScript/React manapun. 15 rows data. Kemungkinan dibuat untuk modul HR yang tidak jadi diimplementasikan.",
    special_notes: [
      "Tidak ada referensi di artifacts/, lib/, atau packages/",
      "15 rows data — perlu backup sebelum rename",
      "Tidak ada FK masuk maupun keluar",
      "Kandidat ARCHIVE via rename setelah backup data",
    ],
    override_risk: "LOW",
  },
  employee_kasbon: {
    summary: "Tabel kasbon karyawan tidak ditemukan di kode manapun. 1 row data. Kemungkinan tabel ad-hoc.",
    special_notes: [
      "Tidak ada referensi di artifacts/, lib/, atau packages/",
      "1 row data — perlu backup sebelum rename",
      "Tidak ada FK masuk maupun keluar",
    ],
    override_risk: "LOW",
  },
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // ── Baca audit JSON ────────────────────────────────────────────────────────
  const auditPath = path.join(ROOT, "docs/supabase-table-cleanup-audit.json");
  if (!fs.existsSync(auditPath)) {
    console.error("Jalankan scripts/audit-unused-supabase-tables.mjs dulu.");
    process.exit(1);
  }
  const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
  const targetTables = audit.tables.filter(t => t.status === "ARCHIVE" || t.status === "DELETE_CANDIDATE");
  console.log(`\n📊 Menganalisis ${targetTables.length} tabel (${audit.tables.filter(t=>t.status==="ARCHIVE").length} ARCHIVE + ${audit.tables.filter(t=>t.status==="DELETE_CANDIDATE").length} DELETE_CANDIDATE)\n`);

  // ── Koneksi Supabase: cek views, functions, triggers ──────────────────────
  const client = new Client({ connectionString: SUPABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 30000 });
  console.log("🔌 Koneksi ke Supabase untuk cek DB objects...");
  await client.connect();

  // Satu query untuk semua: views yang merujuk tabel target
  const tableList = targetTables.map(t => `'${t.table_name}'`).join(", ");

  const { rows: viewRefs } = await client.query(`
    SELECT DISTINCT v.table_name AS view_name, d.table_name AS references_table
    FROM information_schema.views v
    JOIN information_schema.view_table_usage d ON d.view_schema = 'public' AND v.table_schema = 'public'
      AND v.table_name = d.view_name
    WHERE d.table_name IN (${tableList})
  `).catch(() => ({ rows: [] }));

  // Functions/procedures yang body-nya mengandung nama tabel target
  const { rows: funcRefs } = await client.query(`
    SELECT p.proname AS func_name, p.prosrc AS body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (${targetTables.map(t => `p.prosrc ILIKE '%${t.table_name}%'`).join(" OR ")})
  `).catch(() => ({ rows: [] }));

  // Triggers
  const { rows: triggerRefs } = await client.query(`
    SELECT trigger_name, event_object_table, action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table IN (${tableList})
  `).catch(() => ({ rows: [] }));

  await client.end();
  console.log(`   ${viewRefs.length} view refs, ${funcRefs.length} function refs, ${triggerRefs.length} trigger refs ditemukan\n`);

  // Bangun lookup maps
  const viewMap = {};
  for (const r of viewRefs) {
    if (!viewMap[r.references_table]) viewMap[r.references_table] = [];
    viewMap[r.references_table].push(r.view_name);
  }
  const funcMap = {};
  for (const r of funcRefs) {
    for (const t of targetTables) {
      if (r.body.includes(t.table_name)) {
        if (!funcMap[t.table_name]) funcMap[t.table_name] = [];
        funcMap[t.table_name].push(r.func_name);
      }
    }
  }
  const triggerMap = {};
  for (const r of triggerRefs) {
    if (!triggerMap[r.event_object_table]) triggerMap[r.event_object_table] = [];
    triggerMap[r.event_object_table].push(r.trigger_name);
  }

  // ── Bulk code scan (satu pass untuk semua tabel) ─────────────────────────
  const tableNames = targetTables.map(t => t.table_name);
  const tableFileMap = bulkScanAllTables(tableNames);

  console.log("\n🏷️  Mengklasifikasikan dan membangun hasil...\n");
  const results = [];

  for (let i = 0; i < targetTables.length; i++) {
    const t = targetTables[i];
    process.stdout.write(`   [${i+1}/${targetTables.length}] ${t.table_name}... `);
    const refs = classifyFilesByLayer(tableFileMap[t.table_name] || []);

    // Tambahkan DB-level refs
    const db_views    = viewMap[t.table_name] || [];
    const db_funcs    = funcMap[t.table_name] || [];
    const db_triggers = triggerMap[t.table_name] || [];

    // Override dengan deep-trace knowledge jika ada
    const deepTrace = DEEP_TRACE_FINDINGS[t.table_name];
    const riskRaw = computeRisk(refs, t.row_count, t.fk_references_in, t.fk_references_out, t.table_name);
    const risk = deepTrace?.override_risk ?? riskRaw;

    // Referenced-by summary
    const referencedBy = [];
    if (refs.frontend.length)   referencedBy.push(`Frontend (${refs.frontend.length} file)`);
    if (refs.api_routes.length) referencedBy.push(`API Routes (${refs.api_routes.length} file)`);
    if (refs.api_lib.length)    referencedBy.push(`API Lib (${refs.api_lib.length} file)`);
    if (refs.schema.length)     referencedBy.push(`Drizzle Schema (${refs.schema.length} file)`);
    if (refs.scheduler.length)  referencedBy.push(`Scheduler/Worker (${refs.scheduler.length} file)`);
    if (refs.ai.length)         referencedBy.push(`AI Services (${refs.ai.length} file)`);
    if (refs.export.length)     referencedBy.push(`Export/Report (${refs.export.length} file)`);
    if (refs.migrations.length) referencedBy.push(`Migration (${refs.migrations.length} file)`);
    if (db_views.length)        referencedBy.push(`DB Views (${db_views.join(", ")})`);
    if (db_funcs.length)        referencedBy.push(`DB Functions (${db_funcs.join(", ")})`);
    if (db_triggers.length)     referencedBy.push(`DB Triggers (${db_triggers.join(", ")})`);

    const lastUsedModule = (() => {
      if (refs.api_routes.length) return path.basename(refs.api_routes[0]);
      if (refs.api_lib.length)    return path.basename(refs.api_lib[0]);
      if (refs.frontend.length)   return path.basename(refs.frontend[0]);
      if (refs.migrations.length) return path.basename(refs.migrations[0]);
      if (refs.schema.length)     return path.basename(refs.schema[0]);
      return "(tidak ditemukan di kode)";
    })();

    // Rename safe?
    const renameSafe = ["SAFE", "LOW"].includes(risk) && db_views.length === 0 && db_triggers.length === 0;

    process.stdout.write(`${risk}\n`);

    results.push({
      table_name: t.table_name,
      audit_status: t.status,
      row_count: t.row_count,
      fk_references_in: t.fk_references_in,
      fk_references_out: t.fk_references_out,
      risk,
      referenced_by: referencedBy,
      last_used_module: lastUsedModule,
      refs_by_layer: {
        frontend:   refs.frontend,
        api_routes: refs.api_routes,
        api_lib:    refs.api_lib,
        schema:     refs.schema,
        scheduler:  refs.scheduler,
        ai:         refs.ai,
        export:     refs.export,
        migrations: refs.migrations,
        db_views,
        db_funcs,
        db_triggers,
      },
      deep_trace: deepTrace ? {
        summary: deepTrace.summary,
        special_notes: deepTrace.special_notes,
      } : null,
      rename_safe: renameSafe,
      rename_sql:  renameSafe ? `ALTER TABLE "${t.table_name}" RENAME TO "zz_deleted_${t.table_name}";` : null,
      rollback_sql: renameSafe ? `ALTER TABLE "zz_deleted_${t.table_name}" RENAME TO "${t.table_name}";` : null,
      block_reason: !renameSafe ? buildBlockReason(risk, refs, db_views, db_triggers, deepTrace) : null,
    });
  }

  // ── Generate output files ──────────────────────────────────────────────────
  console.log("\n📄 Menulis output files...");
  await writeMarkdown(results);
  await writeJson(results);
  await writeMigrations(results);

  // ── Summary ───────────────────────────────────────────────────────────────
  const byRisk = {};
  for (const r of results) byRisk[r.risk] = (byRisk[r.risk] || 0) + 1;
  const safeRename = results.filter(r => r.rename_safe);
  const blocked    = results.filter(r => !r.rename_safe);

  console.log("\n" + "═".repeat(65));
  console.log("RINGKASAN IMPACT ANALYSIS");
  console.log("═".repeat(65));
  console.log(`Total dianalisis       : ${results.length}`);
  for (const [risk, count] of Object.entries(byRisk).sort((a,b) => riskOrder(a[0]) - riskOrder(b[0]))) {
    const icon = { CRITICAL:"🔴", HIGH:"🟠", MEDIUM:"🟡", LOW:"🟢", SAFE:"⚪" }[risk] || "⬜";
    console.log(`  ${icon} ${risk.padEnd(12)} : ${count}`);
  }
  console.log(`\n✅ Aman di-rename (SAFE+LOW, no views/triggers) : ${safeRename.length}`);
  console.log(`🚫 Diblokir (perlu tindakan manual dulu)         : ${blocked.length}`);
  console.log("═".repeat(65) + "\n");

  console.log("✅ Output:");
  console.log("   docs/table-impact-analysis.md");
  console.log("   docs/table-impact-analysis.json");
  console.log("   migrations/archive-phase-1.sql");
  console.log("   migrations/archive-phase-1-rollback.sql");
}

function riskOrder(r) {
  return { CRITICAL:0, HIGH:1, MEDIUM:2, LOW:3, SAFE:4 }[r] ?? 5;
}

function buildBlockReason(risk, refs, dbViews, dbTriggers, deepTrace) {
  const reasons = [];
  if (risk === "CRITICAL") reasons.push("Risk CRITICAL — tabel masih aktif digunakan");
  if (risk === "HIGH")     reasons.push("Risk HIGH — masih ada referensi di API layer");
  if (risk === "MEDIUM")   reasons.push("Risk MEDIUM — masih ada referensi di schema/migration/AI");
  if (dbViews.length)      reasons.push(`DB View aktif: ${dbViews.join(", ")}`);
  if (dbTriggers.length)   reasons.push(`DB Trigger aktif: ${dbTriggers.join(", ")}`);
  if (deepTrace?.special_notes?.length)
    reasons.push("Deep trace: " + deepTrace.special_notes[0]);
  return reasons.join("; ");
}

// ── Write Markdown ─────────────────────────────────────────────────────────
async function writeMarkdown(results) {
  const now = new Date().toISOString().slice(0, 10);
  const byRisk = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [], SAFE: [] };
  for (const r of results) (byRisk[r.risk] || []).push(r);

  const rIcon = { CRITICAL:"🔴", HIGH:"🟠", MEDIUM:"🟡", LOW:"🟢", SAFE:"⚪" };
  const safeRename = results.filter(r => r.rename_safe);
  const blocked    = results.filter(r => !r.rename_safe);

  function tableSection(label, icon, items) {
    if (!items.length) return "";
    let md = `## ${icon} ${label} (${items.length})\n\n`;
    for (const r of items) {
      md += `### \`${r.table_name}\`\n\n`;
      md += `| Field | Value |\n|-------|-------|\n`;
      md += `| **Audit Status** | ${r.audit_status} |\n`;
      md += `| **Risk Level** | ${icon} **${r.risk}** |\n`;
      md += `| **Row Count** | ${r.row_count.toLocaleString()} |\n`;
      md += `| **FK Masuk (↓)** | ${r.fk_references_in} |\n`;
      md += `| **FK Keluar (↑)** | ${r.fk_references_out} |\n`;
      md += `| **Last Used Module** | \`${r.last_used_module}\` |\n`;
      md += `| **Rename Safe** | ${r.rename_safe ? "✅ Ya" : "🚫 Tidak — " + (r.block_reason ?? "-")} |\n`;
      md += `\n`;

      if (r.referenced_by.length) {
        md += `**Referenced By:**\n`;
        for (const ref of r.referenced_by) md += `- ${ref}\n`;
        md += `\n`;
      } else {
        md += `**Referenced By:** _(tidak ada referensi ditemukan)_\n\n`;
      }

      // Refs detail
      const layers = [
        ["Frontend React",  r.refs_by_layer.frontend],
        ["API Routes",      r.refs_by_layer.api_routes],
        ["API Lib/Workers", r.refs_by_layer.api_lib],
        ["Drizzle Schema",  r.refs_by_layer.schema],
        ["Scheduler",       r.refs_by_layer.scheduler],
        ["AI Services",     r.refs_by_layer.ai],
        ["Export/Report",   r.refs_by_layer.export],
        ["Migrations",      r.refs_by_layer.migrations],
        ["DB Views",        r.refs_by_layer.db_views],
        ["DB Functions",    r.refs_by_layer.db_funcs],
        ["DB Triggers",     r.refs_by_layer.db_triggers],
      ].filter(([, files]) => files.length > 0);

      if (layers.length) {
        md += `**Referensi Detail:**\n\n`;
        for (const [layer, files] of layers) {
          md += `- **${layer}**: ${files.slice(0,5).join(", ")}${files.length > 5 ? ` … (+${files.length-5})` : ""}\n`;
        }
        md += `\n`;
      }

      if (r.deep_trace) {
        md += `**Deep Trace:**\n\n> ${r.deep_trace.summary}\n\n`;
        md += `**Catatan Spesifik:**\n`;
        for (const note of r.deep_trace.special_notes) md += `- ${note}\n`;
        md += `\n`;
      }

      if (r.rename_sql) {
        md += `**Migration SQL:**\n\`\`\`sql\n${r.rename_sql}\n\`\`\`\n`;
        md += `**Rollback SQL:**\n\`\`\`sql\n${r.rollback_sql}\n\`\`\`\n`;
      } else {
        md += `**❌ Tidak dapat di-rename sebelum:**\n${(r.block_reason ?? "").split("; ").map(s => `- ${s}`).join("\n")}\n`;
      }
      md += `\n---\n\n`;
    }
    return md;
  }

  const summaryRows = results.map(r =>
    `| \`${r.table_name}\` | ${r.audit_status} | ${rIcon[r.risk]} ${r.risk} | ${r.row_count.toLocaleString()} | ${r.fk_references_in} | ${r.referenced_by.length ? r.referenced_by[0] : "—"} | ${r.rename_safe ? "✅" : "🚫"} |`
  ).join("\n");

  const md = `# Table Pre-Delete Impact Analysis
> Dibuat: ${now} oleh \`scripts/pre-delete-impact-analysis.mjs\`

## Ringkasan Eksekutif

| Metrik | Nilai |
|--------|------:|
| Total dianalisis | **${results.length}** |
| 🔴 CRITICAL | **${byRisk.CRITICAL.length}** |
| 🟠 HIGH | **${byRisk.HIGH.length}** |
| 🟡 MEDIUM | **${byRisk.MEDIUM.length}** |
| 🟢 LOW | **${byRisk.LOW.length}** |
| ⚪ SAFE | **${byRisk.SAFE.length}** |
| ✅ Aman di-rename (Phase 1) | **${safeRename.length}** |
| 🚫 Diblokir — perlu tindakan manual | **${blocked.length}** |

> ⚠️ **Tidak ada tabel yang langsung di-DROP.** Semua tabel aman hanya di-RENAME ke \`zz_deleted_*\` agar mudah rollback.
> 🔴 **CRITICAL/HIGH**: Tabel masih aktif digunakan — jangan rename sebelum kode diperbaiki.

## Tabel Quick Reference

| Tabel | Status Audit | Risk | Rows | FK↓ | Ref Pertama | Rename? |
|-------|-------------|------|-----:|----:|-------------|---------|
${summaryRows}

---

${tableSection("CRITICAL — Jangan Disentuh Dulu", "🔴", byRisk.CRITICAL)}
${tableSection("HIGH — Perlu Perbaikan Kode Dulu", "🟠", byRisk.HIGH)}
${tableSection("MEDIUM — Perlu Investigasi Lanjut", "🟡", byRisk.MEDIUM)}
${tableSection("LOW — Aman dengan Precaution", "🟢", byRisk.LOW)}
${tableSection("SAFE — Aman Langsung di-Rename", "⚪", byRisk.SAFE)}

---

## Langkah Selanjutnya

### Phase 1 — Rename SAFE (${safeRename.length} tabel)
Jalankan \`migrations/archive-phase-1.sql\` setelah:
1. pg_dump production selesai dan disimpan
2. Konfirmasi row count = 0 atau data sudah dibackup
3. Jalankan di maintenance window
4. Simpan \`migrations/archive-phase-1-rollback.sql\` untuk rollback

### Phase 2 — Tabel CRITICAL/HIGH (${byRisk.CRITICAL.length + byRisk.HIGH.length} tabel)
Tindakan per tabel:
- **fleet_partners** & **fleet_vehicles**: Tidak bisa di-archive — masih aktif di fleetIntelligence.ts
- **fleet_ledger_entries**: Migrasi data ke \`accounting_entries\` terlebih dahulu
- Setelah kode diperbaiki, jalankan audit ulang

### Phase 3 — Tabel MEDIUM (${byRisk.MEDIUM.length} tabel)
- **shipment_stages**: Update \`contextOrchestrator.ts\` untuk tidak query tabel ini
- **sport_center_bookings**: Pastikan data ter-sync ke sport_bookings, kemudian update routes.ts
- **sport_center_facilities**: Migrasi query ke sport_facilities di routes.ts

*Auto-generated — jangan edit manual.*
`;

  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "docs/table-impact-analysis.md"), md, "utf8");
  console.log("📄 Wrote: docs/table-impact-analysis.md");
}

// ── Write JSON ─────────────────────────────────────────────────────────────
async function writeJson(results) {
  const byRisk = {};
  for (const r of results) byRisk[r.risk] = (byRisk[r.risk] || 0) + 1;
  const output = {
    generated_at: new Date().toISOString(),
    generator: "scripts/pre-delete-impact-analysis.mjs",
    summary: {
      total: results.length,
      by_risk: byRisk,
      rename_safe: results.filter(r => r.rename_safe).length,
      blocked: results.filter(r => !r.rename_safe).length,
    },
    tables: results,
  };
  fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "docs/table-impact-analysis.json"),
    JSON.stringify(output, null, 2), "utf8"
  );
  console.log("📄 Wrote: docs/table-impact-analysis.json");
}

// ── Write Migration SQLs ───────────────────────────────────────────────────
async function writeMigrations(results) {
  const now = new Date().toISOString().slice(0, 10);
  const safeRename = results.filter(r => r.rename_safe);
  const blocked    = results.filter(r => !r.rename_safe);

  // ── archive-phase-1.sql ───────────────────────────────────────────────────
  const fwdVerify = safeRename.map(r =>
    `SELECT '${r.table_name}' AS tabel, COUNT(*) AS rows FROM "${r.table_name}";`
  ).join("\n");

  const fwdRenames = safeRename.map(r => `
-- ${r.table_name} | rows:${r.row_count} | risk:${r.risk}
${r.rename_sql}
`).join("\n");

  const blockedComment = blocked.map(r => `
-- 🚫 DIBLOKIR: ${r.table_name}
--    Risk  : ${r.risk}
--    Alasan: ${r.block_reason ?? "(lihat impact analysis)"}
-- ALTER TABLE "${r.table_name}" RENAME TO "zz_deleted_${r.table_name}"; -- JANGAN uncomment sebelum issue di atas selesai
`).join("\n");

  const fwdSql = `-- ============================================================================
-- archive-phase-1.sql  —  RENAME tabel ke zz_deleted_*
-- Dibuat : ${now} oleh scripts/pre-delete-impact-analysis.mjs
--
-- Strategi: RENAME (bukan DROP) sehingga rollback mudah.
-- Jalankan archive-phase-1-rollback.sql untuk membalikkan.
--
-- PRASYARAT:
--   1. pg_dump production sudah disimpan
--   2. Verifikasi row count di STEP 0
--   3. Tidak ada traffic aktif ke tabel-tabel ini
--   4. Jalankan di maintenance window
-- ============================================================================

-- ── STEP 0: VERIFIKASI ROW COUNT ──────────────────────────────────────────────
${fwdVerify}

-- ── STEP 1: RENAME TABEL AMAN (${safeRename.length} tabel) ───────────────────────────────
${fwdRenames}

-- ── TABEL DIBLOKIR — Jangan di-rename sebelum kode diperbaiki ────────────────
${blockedComment}
-- ============================================================================
-- SETELAH RENAME: verifikasi aplikasi berjalan normal selama 7 hari
-- Jika normal: lanjut ke archive-phase-2.sql (DROP zz_deleted_* tables)
-- Jika ada error: jalankan archive-phase-1-rollback.sql
-- ============================================================================
`;

  // ── archive-phase-1-rollback.sql ─────────────────────────────────────────
  const rollbackSql = `-- ============================================================================
-- archive-phase-1-rollback.sql  —  ROLLBACK RENAME
-- Dibuat : ${now} oleh scripts/pre-delete-impact-analysis.mjs
--
-- Jalankan file ini untuk membalikkan semua rename di archive-phase-1.sql
-- ============================================================================

-- ── ROLLBACK: rename zz_deleted_* kembali ke nama asli ───────────────────────
${safeRename.map(r => `-- ${r.table_name}\n${r.rollback_sql}`).join("\n\n")}

-- ============================================================================
-- Setelah rollback: jalankan audit ulang untuk re-evaluasi
-- node scripts/audit-unused-supabase-tables.mjs
-- node scripts/pre-delete-impact-analysis.mjs
-- ============================================================================
`;

  fs.mkdirSync(path.join(ROOT, "migrations"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "migrations/archive-phase-1.sql"), fwdSql, "utf8");
  fs.writeFileSync(path.join(ROOT, "migrations/archive-phase-1-rollback.sql"), rollbackSql, "utf8");
  console.log("📄 Wrote: migrations/archive-phase-1.sql");
  console.log("📄 Wrote: migrations/archive-phase-1-rollback.sql");
}

main().catch(err => { console.error("FATAL:", err.message, err.stack); process.exit(1); });
