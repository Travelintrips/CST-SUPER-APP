/**
 * MARKETPLACE TEMPLATE HARDENING PHASE 2 — Fase 6 (audit only, no changes).
 * Cek konsistensi specValues:
 *  - field bertipe number tapi belum punya metadata `unit`
 *  - key customField yang sama dipakai di lebih dari satu kategori dengan
 *    type/unit yang BERBEDA (potensi bentrok makna saat filter/compare lintas kategori)
 *  - untuk data spec_values yang sudah ada di DB: apakah value numerik tersimpan
 *    sebagai number JSON atau berubah jadi string
 */
import pg from "pg";
import { templates } from "../../lib/product-templates/src/templates";
import { resolveSupabaseDatabaseUrl } from "../resolve-supabase-db-url.mjs";

const { Pool } = pg;
const { url: connStr } = resolveSupabaseDatabaseUrl();
const pool = new Pool({ connectionString: connStr, options: "-c search_path=public" });

async function main() {
  // 1. number fields without unit
  const missingUnit: string[] = [];
  const keyMap = new Map<string, { category: string; type: string; unit?: string }[]>();
  for (const t of Object.values(templates)) {
    for (const f of t.customFields) {
      if (f.type === "number" && !f.unit) missingUnit.push(`${t.category}.${f.key} ("${f.label}")`);
      if (!keyMap.has(f.key)) keyMap.set(f.key, []);
      keyMap.get(f.key)!.push({ category: t.category, type: f.type, unit: f.unit });
    }
  }

  console.log("=== Number field tanpa unit metadata ===");
  if (missingUnit.length === 0) console.log("  (tidak ada)");
  missingUnit.forEach((m) => console.log("  " + m));

  console.log("\n=== Key dipakai di >1 kategori dengan type/unit BERBEDA (potensi bentrok) ===");
  let collisionFound = false;
  for (const [key, entries] of keyMap.entries()) {
    if (entries.length < 2) continue;
    const signatures = new Set(entries.map((e) => `${e.type}|${e.unit ?? ""}`));
    if (signatures.size > 1) {
      collisionFound = true;
      console.log(`  key="${key}":`);
      entries.forEach((e) => console.log(`     - ${e.category}: type=${e.type} unit=${e.unit ?? "(none)"}`));
    }
  }
  if (!collisionFound) console.log("  (tidak ada bentrok — key yang sama selalu punya type & unit yang konsisten)");

  console.log("\n=== Key dipakai di >1 kategori dengan type/unit SAMA (aman, hanya info) ===");
  for (const [key, entries] of keyMap.entries()) {
    if (entries.length < 2) continue;
    const signatures = new Set(entries.map((e) => `${e.type}|${e.unit ?? ""}`));
    if (signatures.size === 1) {
      console.log(`  key="${key}" dipakai di: ${entries.map((e) => e.category).join(", ")}`);
    }
  }

  // 2. Cek tipe data spec_values yang sudah ada di DB (semua vendor_catalog_items yang punya spec_values non-null)
  console.log("\n=== Cek tipe data value dalam spec_values yang sudah terisi di DB ===");
  const rows = (await pool.query(`select id, name, category_key, spec_values from vendor_catalog_items where spec_values is not null`)).rows;
  if (rows.length === 0) {
    console.log("  Tidak ada baris vendor_catalog_items dengan spec_values terisi saat ini.");
  } else {
    for (const r of rows) {
      const tpl = templates[r.category_key as string];
      const numberKeys = new Set((tpl?.customFields ?? []).filter((f) => f.type === "number").map((f) => f.key));
      const problems: string[] = [];
      for (const [k, v] of Object.entries(r.spec_values || {})) {
        if (numberKeys.has(k) && typeof v !== "number") {
          problems.push(`${k}=${JSON.stringify(v)} (type=${typeof v}, seharusnya number)`);
        }
      }
      console.log(`  #${r.id} ${r.name} [${r.category_key}]: ${problems.length ? "WARNING -> " + problems.join(", ") : "OK"}`);
    }
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
