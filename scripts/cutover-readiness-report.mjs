/**
 * Cutover Readiness Report — Step 1D
 * Membandingkan Sistem Lama (commodity_templates) vs Sistem Baru (product_templates)
 * untuk 5 komoditas: coal, iron_steel, coffee, palm_oil, rubber
 *
 * Run: node scripts/cutover-readiness-report.mjs
 */

import pg from "pg";
import http from "http";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.SUPABASE_PG_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const API_BASE = "http://localhost:8080";
const TARGET_KEYS = ["coal", "iron_steel", "coffee", "palm_oil", "rubber"];
const LABELS = { coal: "Batubara", iron_steel: "Besi & Baja", coffee: "Kopi", palm_oil: "Minyak Sawit", rubber: "Karet" };

/**
 * Canonical field key aliases per category.
 * Setelah Step 1E, key lama di-rename ke canonical key.
 * key   = key lama (di commodity_templates)
 * alias = canonical key baru (di product_templates setelah cleanup)
 */
const FIELD_KEY_ALIASES = {
  coal:    { total_moisture: "moisture", ash_content: "ash", sulfur_content: "sulfur" },
  coffee:  { moisture: "moisture_pct" },
};

/**
 * Option value aliases per category+field.
 * Opsi lama yang diganti nama jadi lebih deskriptif di sistem baru.
 * key = opsi lama, value = opsi baru (canonical)
 */
const OPTIONS_ALIASES = {
  palm_oil: {
    product_type: {
      "CPO":            "CPO (Crude Palm Oil)",
      "CPKO":           "CPKO (Crude Palm Kernel Oil)",
      "PKO":            "Palm Kernel Oil (PKO)",
      "RBD Palm Olein": "RBD Palm Olein",
      "RBD Palm Stearin": "RBD Palm Stearin",
    },
  },
};

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on("error", reject);
  });
}

// ── Slugify (same as migration script) ───────────────────────────────────────
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

// ── Load OLD system data ──────────────────────────────────────────────────────
async function loadOldSystem(client) {
  const result = {};
  const [templates, fields, docs, checklists] = await Promise.all([
    client.query("SELECT * FROM commodity_templates WHERE key = ANY($1) ORDER BY sort_order", [TARGET_KEYS]),
    client.query("SELECT f.*, ct.key as tpl_key FROM commodity_template_fields f JOIN commodity_templates ct ON ct.id = f.template_id WHERE ct.key = ANY($1) ORDER BY ct.sort_order, f.sort_order", [TARGET_KEYS]),
    client.query("SELECT d.*, ct.key as tpl_key FROM commodity_required_docs d JOIN commodity_templates ct ON ct.id = d.template_id WHERE ct.key = ANY($1) ORDER BY ct.sort_order, d.sort_order", [TARGET_KEYS]),
    client.query("SELECT c.*, ct.key as tpl_key FROM commodity_checklists c JOIN commodity_templates ct ON ct.id = c.template_id WHERE ct.key = ANY($1) ORDER BY ct.sort_order, c.sort_order", [TARGET_KEYS]),
  ]);

  for (const tpl of templates.rows) {
    result[tpl.key] = {
      label: tpl.name,
      icon: tpl.icon,
      fields: fields.rows
        .filter(f => f.tpl_key === tpl.key)
        .map(f => ({
          key: f.field_key,
          label: f.label,
          type: f.field_type,
          required: f.required,
          unit: f.unit || null,
          options: f.options ? (Array.isArray(f.options) ? f.options : JSON.parse(f.options)) : null,
        })),
      docs: docs.rows
        .filter(d => d.tpl_key === tpl.key)
        .map(d => ({ key: slugify(d.doc_name), label: d.doc_name, required: d.required })),
      checklist: checklists.rows
        .filter(c => c.tpl_key === tpl.key)
        .map(c => ({ key: slugify(c.item), label: c.item })),
    };
  }
  return result;
}

// ── Load NEW system data (from API) ──────────────────────────────────────────
async function loadNewSystem(client, tokens) {
  const result = {};
  for (const [key, token] of Object.entries(tokens)) {
    const { status, body } = await httpGet(`${API_BASE}/api/vendor-form/${token}`);
    if (status !== 200 || body.error) {
      result[key] = { error: body.error || `HTTP ${status}`, fields: [], docs: [], checklist: [] };
    } else {
      const pt = body.productTemplate;
      if (!pt) {
        result[key] = { error: "productTemplate null di response", fields: [], docs: [], checklist: [] };
      } else {
        result[key] = {
          label: pt.label,
          category: pt.category,
          version: pt.version,
          fields: pt.customFields || [],
          docs: pt.requiredDocuments || [],
          checklist: pt.checklist || [],
          packagingInstructions: pt.packagingInstructions || "",
        };
      }
    }
  }
  return result;
}

// ── Comparison logic ─────────────────────────────────────────────────────────
function compareTemplates(key, oldTpl, newTpl) {
  const issues = [];
  const warnings = [];

  if (newTpl.error) {
    issues.push(`❌ API ERROR: ${newTpl.error}`);
    return { issues, warnings, summary: "ERROR" };
  }

  // Build alias-aware lookup helpers
  const catAliases  = FIELD_KEY_ALIASES[key] || {};     // oldKey → newCanonicalKey
  const catOptAlias = (OPTIONS_ALIASES[key] || {});     // fieldKey → { oldOpt → newOpt }

  const oldFieldKeys = new Set(oldTpl.fields.map(f => f.key));
  const newFieldKeys = new Set(newTpl.fields.map(f => f.key));
  const oldDocLabels = new Set(oldTpl.docs.map(d => d.label.toLowerCase().trim()));
  const newDocLabels = new Set(newTpl.docs.map(d => d.label.toLowerCase().trim()));
  const oldClLabels  = new Set(oldTpl.checklist.map(c => c.label.toLowerCase().trim()));
  const newClLabels  = new Set(newTpl.checklist.map(c => c.label.toLowerCase().trim()));

  // Helper: resolve effective key in new system (accounting for canonical rename)
  const resolveNewKey = (oldKey) => {
    const alias = catAliases[oldKey];
    if (alias && newFieldKeys.has(alias)) return alias;  // canonical alias exists
    if (newFieldKeys.has(oldKey)) return oldKey;         // original key still exists
    return null;
  };

  // Fields: missing in new (alias-aware)
  const missingFields = oldTpl.fields.filter(f => resolveNewKey(f.key) === null);
  if (missingFields.length) {
    issues.push(`❌ FIELD HILANG (${missingFields.length}): ${missingFields.map(f => f.key).join(", ")}`);
  }

  // Fields: note canonical renames
  const renamedFields = oldTpl.fields.filter(f => {
    const alias = catAliases[f.key];
    return alias && newFieldKeys.has(alias) && !newFieldKeys.has(f.key);
  });
  if (renamedFields.length) {
    warnings.push(`ℹ️  CANONICAL RENAME (${renamedFields.length}): ${renamedFields.map(f => `${f.key}→${catAliases[f.key]}`).join(", ")}`);
  }

  // Fields: semantic duplicates (same label, different keys) in new system
  const labelToNewKeys = {};
  for (const f of newTpl.fields) {
    const lbl = f.label.toLowerCase().trim();
    if (!labelToNewKeys[lbl]) labelToNewKeys[lbl] = [];
    labelToNewKeys[lbl].push(f.key);
  }
  const semanticDupes = Object.entries(labelToNewKeys).filter(([, keys]) => keys.length > 1);
  if (semanticDupes.length) {
    warnings.push(`⚠️  DUPLIKAT LABEL (${semanticDupes.length}): ${semanticDupes.map(([lbl, keys]) => `"${lbl}" (${keys.join(" + ")})`).join("; ")}`);
  }

  // Fields: option mismatch (alias-aware)
  for (const oldField of oldTpl.fields) {
    const effectiveKey = resolveNewKey(oldField.key);
    if (!effectiveKey) continue;
    const newField = newTpl.fields.find(f => f.key === effectiveKey);
    if (!newField) continue;
    if (oldField.options && newField.options) {
      const fieldOptAliases = catOptAlias[effectiveKey] || catOptAlias[oldField.key] || {};
      const missing = oldField.options.filter(o => {
        const aliased = fieldOptAliases[o];
        return !newField.options.includes(o) && !(aliased && newField.options.includes(aliased));
      });
      if (missing.length) {
        warnings.push(`⚠️  OPTIONS HILANG untuk "${effectiveKey}": ${missing.join(", ")}`);
      }
    }
    if (oldField.required && !newField.required) {
      warnings.push(`⚠️  REQUIRED berubah jadi optional: "${effectiveKey}" (dari "${oldField.key}")`);
    }
  }

  // Docs: missing in new (by label)
  const missingDocs = oldTpl.docs.filter(d => !newDocLabels.has(d.label.toLowerCase().trim()));
  if (missingDocs.length) {
    issues.push(`❌ DOKUMEN HILANG (${missingDocs.length}): ${missingDocs.map(d => d.label).join(", ")}`);
  }

  // Docs: duplicate labels in new
  const docLabelCount = {};
  for (const d of newTpl.docs) {
    const lbl = d.label.toLowerCase().trim();
    docLabelCount[lbl] = (docLabelCount[lbl] || 0) + 1;
  }
  const dupeDocs = Object.entries(docLabelCount).filter(([, c]) => c > 1);
  if (dupeDocs.length) {
    warnings.push(`⚠️  DUPLIKAT DOKUMEN (${dupeDocs.length}): ${dupeDocs.map(([l]) => l).join("; ")}`);
  }

  // Checklist: missing in new (by label)
  const missingCl = oldTpl.checklist.filter(c => !newClLabels.has(c.label.toLowerCase().trim()));
  if (missingCl.length) {
    issues.push(`❌ CHECKLIST HILANG (${missingCl.length}): ${missingCl.map(c => c.label).join(", ")}`);
  }

  // Label/category mismatch
  if (newTpl.category !== key) {
    warnings.push(`⚠️  CATEGORY MISMATCH: expected="${key}" got="${newTpl.category}"`);
  }

  const hasIssues = issues.length > 0;

  // For stats, count "missing" using alias-aware logic
  const aliasAwareOldFieldKeys = new Set(oldTpl.fields.map(f => catAliases[f.key] || f.key));

  return {
    issues,
    warnings,
    fieldStats: {
      old: oldTpl.fields.length,
      new: newTpl.fields.length,
      missing: missingFields.length,
      renames: renamedFields.length,
      extra: newTpl.fields.filter(f => !aliasAwareOldFieldKeys.has(f.key)).length,
    },
    docStats: {
      old: oldTpl.docs.length,
      new: newTpl.docs.length,
      missing: missingDocs.length,
      extra: newTpl.docs.filter(d => !oldDocLabels.has(d.label.toLowerCase().trim())).length,
    },
    clStats: {
      old: oldTpl.checklist.length,
      new: newTpl.checklist.length,
      missing: missingCl.length,
      extra: newTpl.checklist.filter(c => !oldClLabels.has(c.label.toLowerCase().trim())).length,
    },
    summary: hasIssues ? "FAIL" : warnings.length > 0 ? "WARN" : "OK",
  };
}

// ── RFQ / WA Link test ────────────────────────────────────────────────────────
async function testRfqEndpoints() {
  const results = [];
  // Test public RFQ token endpoint (if any order has publicRfqToken)
  const { status: s1, body: b1 } = await httpGet(`${API_BASE}/api/logistic-orders/track/NONEXISTENT`);
  results.push({ endpoint: "GET /api/logistic-orders/track/:token (invalid)", status: s1, ok: s1 === 404 });

  // Test VMF form list (admin)
  const { status: s2 } = await httpGet(`${API_BASE}/api/vendor-form/admin/links`);
  results.push({ endpoint: "GET /api/vendor-form/admin/links (no auth)", status: s2, ok: s2 === 401 || s2 === 403 });

  // Test product_templates endpoint
  const { status: s3, body: b3 } = await httpGet(`${API_BASE}/api/product-templates`);
  const ptCount = Array.isArray(b3?.templates) ? b3.templates.length : (Array.isArray(b3) ? b3.length : "?");
  results.push({ endpoint: "GET /api/product-templates", status: s3, ok: s3 === 200, extra: `${ptCount} templates` });

  return results;
}

// ── Setup & teardown test tokens ──────────────────────────────────────────────
async function setupTestTokens(client) {
  const tokens = {};
  // Delete any leftover test tokens
  await client.query("DELETE FROM vendor_mini_form_links WHERE token LIKE 'CUTOVER-TEST-%'");

  for (const key of TARGET_KEYS) {
    const [ct] = (await client.query("SELECT id FROM commodity_templates WHERE key = $1", [key])).rows;
    if (!ct) { tokens[key] = null; continue; }
    const token = `CUTOVER-TEST-${key.toUpperCase().replace("_", "-")}-01`;
    await client.query(`
      INSERT INTO vendor_mini_form_links
        (token, service_type, title, mode, is_active, form_target, commodity_template_id, created_at)
      VALUES ($1, 'product', $2, 'rate_collection', true, 'vendor', $3, NOW())
      ON CONFLICT (token) DO UPDATE SET commodity_template_id = $3
    `, [token, `Cutover Test - ${LABELS[key]}`, ct.id]);
    tokens[key] = token;
  }
  return tokens;
}

async function teardownTestTokens(client) {
  await client.query("DELETE FROM vendor_mini_form_links WHERE token LIKE 'CUTOVER-TEST-%'");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const client = await pool.connect();
  const LINE = "═".repeat(66);
  const SEP  = "─".repeat(66);

  try {
    console.log(`\n${LINE}`);
    console.log("  CUTOVER READINESS REPORT — Step 1D");
    console.log(`  ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`);
    console.log(`  Feature Flag: USE_PRODUCT_TEMPLATE_ENGINE=${process.env.USE_PRODUCT_TEMPLATE_ENGINE || "(not set)"}`);
    console.log(LINE);

    // ── 1. Setup test tokens
    console.log("\n[1/5] Menyiapkan test token VMF...");
    const tokens = await setupTestTokens(client);
    console.log("  Token dibuat:", Object.entries(tokens).map(([k, t]) => `${k}=${t ?? "N/A"}`).join(", "));

    // ── 2. Load data lama
    console.log("\n[2/5] Memuat data dari Sistem Lama (commodity_templates)...");
    const oldSystem = await loadOldSystem(client);
    for (const k of TARGET_KEYS) {
      const o = oldSystem[k];
      if (o) console.log(`  ${LABELS[k].padEnd(18)} → ${o.fields.length} fields, ${o.docs.length} docs, ${o.checklist.length} checklist`);
      else    console.log(`  ${LABELS[k].padEnd(18)} → ⚠️  tidak ditemukan di commodity_templates`);
    }

    // ── 3. Load data baru via API
    console.log("\n[3/5] Memuat data dari Sistem Baru (product_templates via API)...");
    const newSystem = await loadNewSystem(client, Object.fromEntries(TARGET_KEYS.filter(k => tokens[k]).map(k => [k, tokens[k]])));
    for (const k of TARGET_KEYS) {
      const n = newSystem[k];
      if (!n || n.error) {
        console.log(`  ${LABELS[k].padEnd(18)} → ❌ ${n?.error || "no data"}`);
      } else {
        console.log(`  ${LABELS[k].padEnd(18)} → ${n.fields.length} fields, ${n.docs.length} docs, ${n.checklist.length} checklist | label="${n.label}" cat="${n.category}"`);
      }
    }

    // ── 4. Test endpoint pendukung
    console.log("\n[4/5] Test endpoint pendukung (RFQ / WA Link / product-templates)...");
    const rfqTests = await testRfqEndpoints();
    for (const t of rfqTests) {
      const mark = t.ok ? "✅" : "❌";
      console.log(`  ${mark} ${t.endpoint} → HTTP ${t.status}${t.extra ? ` (${t.extra})` : ""}`);
    }

    // ── 5. Generate full comparison report
    console.log(`\n${LINE}`);
    console.log("  PERBANDINGAN SISTEM LAMA vs SISTEM BARU");
    console.log(LINE);

    const results = {};
    let totalIssues = 0;
    let totalWarnings = 0;

    for (const key of TARGET_KEYS) {
      const label = LABELS[key];
      const oldTpl = oldSystem[key];
      const newTpl = newSystem[key];

      console.log(`\n${SEP}`);
      console.log(`  ${oldTpl?.icon || "📦"}  ${label.toUpperCase()} (${key})`);
      console.log(SEP);

      if (!oldTpl) {
        console.log("  ⚠️  Tidak ditemukan di Sistem Lama. Skip.\n");
        continue;
      }

      const cmp = compareTemplates(key, oldTpl, newTpl || { error: "no data", fields: [], docs: [], checklist: [] });
      results[key] = cmp;
      totalIssues += cmp.issues.length;
      totalWarnings += cmp.warnings.length;

      // Stats table
      console.log(`\n  Status: ${cmp.summary === "OK" ? "✅ OK" : cmp.summary === "WARN" ? "⚠️  WARN" : "❌ FAIL"}`);
      console.log(`\n  ┌──────────────┬────────┬────────┬─────────┬────────┐`);
      console.log(`  │ Aspek        │  Lama  │  Baru  │ Missing │ Extra+ │`);
      console.log(`  ├──────────────┼────────┼────────┼─────────┼────────┤`);
      if (cmp.fieldStats) {
        const fs = cmp.fieldStats;
        console.log(`  │ Custom Fields│ ${String(fs.old).padStart(6)} │ ${String(fs.new).padStart(6)} │ ${String(fs.missing).padStart(7)} │ ${String(fs.extra).padStart(6)} │`);
        const ds = cmp.docStats;
        console.log(`  │ Documents    │ ${String(ds.old).padStart(6)} │ ${String(ds.new).padStart(6)} │ ${String(ds.missing).padStart(7)} │ ${String(ds.extra).padStart(6)} │`);
        const cs = cmp.clStats;
        console.log(`  │ Checklist    │ ${String(cs.old).padStart(6)} │ ${String(cs.new).padStart(6)} │ ${String(cs.missing).padStart(7)} │ ${String(cs.extra).padStart(6)} │`);
      }
      console.log(`  └──────────────┴────────┴────────┴─────────┴────────┘`);

      // Field detail comparison (alias-aware)
      const catAliases2  = FIELD_KEY_ALIASES[key] || {};
      const catOptAlias2 = (OPTIONS_ALIASES[key] || {});
      console.log(`\n  Custom Fields:`);
      console.log(`  ${"Key (Lama)".padEnd(24)} ${"→ Canonical".padEnd(20)} ${"Type".padEnd(10)} ${"Req?".padEnd(5)} ${"Status"}`);
      console.log(`  ${"─".repeat(72)}`);
      const newFieldMap = new Map((newTpl?.fields || []).map(f => [f.key, f]));
      for (const of_ of oldTpl.fields) {
        const aliasKey = catAliases2[of_.key];
        const effectiveKey = aliasKey && newFieldMap.has(aliasKey) ? aliasKey
                           : newFieldMap.has(of_.key) ? of_.key : null;
        const nf = effectiveKey ? newFieldMap.get(effectiveKey) : null;
        const canonicalNote = aliasKey && effectiveKey === aliasKey ? `→ ${aliasKey}` : "=";
        let status = nf ? "✅ Ada" : "❌ HILANG";
        if (nf && aliasKey && effectiveKey === aliasKey) status = `✅ Renamed→${aliasKey}`;
        if (nf && of_.options && nf.options) {
          const fieldOptAliases2 = catOptAlias2[effectiveKey] || catOptAlias2[of_.key] || {};
          const lost = of_.options.filter(o => {
            const al = fieldOptAliases2[o];
            return !nf.options.includes(o) && !(al && nf.options.includes(al));
          });
          if (lost.length) status = `⚠️  options hilang: ${lost.join(", ")}`;
        }
        if (nf && of_.required && !nf.required) status += " ⚠️ req→opt";
        console.log(`  ${of_.key.padEnd(24)} ${canonicalNote.padEnd(20)} ${of_.type.padEnd(10)} ${String(of_.required).padEnd(5)} ${status}`);
      }

      // Extra new fields (exclude canonical aliases of old fields)
      const aliasAwareOldKeys2 = new Set([
        ...oldTpl.fields.map(f => f.key),
        ...oldTpl.fields.map(f => catAliases2[f.key]).filter(Boolean),
      ]);
      const extraFields = (newTpl?.fields || []).filter(f => !aliasAwareOldKeys2.has(f.key));
      if (extraFields.length) {
        console.log(`\n  (+) Field baru di Sistem Baru (enrichment):`);
        for (const ef of extraFields) {
          console.log(`    + ${ef.key.padEnd(26)} ${ef.type.padEnd(10)} req=${ef.required}`);
        }
      }

      // Docs comparison
      console.log(`\n  Required Documents:`);
      console.log(`  ${"Label".padEnd(42)} ${"Req?".padEnd(5)} ${"Status"}`);
      console.log(`  ${"─".repeat(62)}`);
      const newDocLabels2 = new Map((newTpl?.docs || []).map(d => [d.label.toLowerCase().trim(), d]));
      for (const od of oldTpl.docs) {
        const nd = newDocLabels2.get(od.label.toLowerCase().trim());
        const status = nd ? "✅ Ada" : "❌ HILANG";
        console.log(`  ${od.label.padEnd(42)} ${String(od.required).padEnd(5)} ${status}`);
      }
      // Duplicate docs
      const docLabelCount2 = {};
      for (const d of (newTpl?.docs || [])) { const l = d.label.toLowerCase().trim(); docLabelCount2[l] = (docLabelCount2[l]||0)+1; }
      const dupDocs = Object.entries(docLabelCount2).filter(([,c]) => c>1);
      if (dupDocs.length) {
        console.log(`\n  (!) Duplikat label dokumen di Sistem Baru:`);
        for (const [lbl, cnt] of dupDocs) console.log(`    ⚠️  "${lbl}" muncul ${cnt}x`);
      }

      // Checklist comparison
      console.log(`\n  Checklist:`);
      const newClLabels2 = new Set((newTpl?.checklist || []).map(c => c.label.toLowerCase().trim()));
      const oldClLabels2 = new Set(oldTpl.checklist.map(c => c.label.toLowerCase().trim()));
      for (const oc of oldTpl.checklist) {
        const found = newClLabels2.has(oc.label.toLowerCase().trim());
        console.log(`  ${found ? "✅" : "❌"} ${oc.label}`);
      }
      const extraCl = (newTpl?.checklist || []).filter(c => !oldClLabels2.has(c.label.toLowerCase().trim()));
      if (extraCl.length) {
        console.log(`\n  (+) Checklist baru di Sistem Baru:`);
        for (const ec of extraCl) console.log(`    + ${ec.label}`);
      }

      // Issues & warnings
      if (cmp.issues.length || cmp.warnings.length) {
        console.log();
        for (const iss of cmp.issues)  console.log(`  ${iss}`);
        for (const w of cmp.warnings)  console.log(`  ${w}`);
      }
    }

    // ── 6. Executive Summary
    console.log(`\n${LINE}`);
    console.log("  EXECUTIVE SUMMARY — CUTOVER READINESS");
    console.log(LINE);

    const allOk      = TARGET_KEYS.filter(k => results[k]?.summary === "OK");
    const allWarn    = TARGET_KEYS.filter(k => results[k]?.summary === "WARN");
    const allFail    = TARGET_KEYS.filter(k => results[k]?.summary === "FAIL");

    console.log(`\n  Templates ditest : ${TARGET_KEYS.length}`);
    console.log(`  ✅ OK             : ${allOk.length}  (${allOk.map(k => LABELS[k]).join(", ") || "—"})`);
    console.log(`  ⚠️  WARN           : ${allWarn.length}  (${allWarn.map(k => LABELS[k]).join(", ") || "—"})`);
    console.log(`  ❌ FAIL           : ${allFail.length}  (${allFail.map(k => LABELS[k]).join(", ") || "—"})`);
    console.log(`\n  Total Issues   : ${totalIssues}  (blocking)`);
    console.log(`  Total Warnings : ${totalWarnings}  (non-blocking, perlu review)`);

    console.log(`\n  Penilaian per Aspek:`);
    const aspectHeaders = ["Aspek", "Coal", "Iron/Steel", "Kopi", "Sawit", "Karet"];
    const row = (label, fn) => `  ${"  " + label.padEnd(20)} ${TARGET_KEYS.map(k => {
      if (!results[k]) return "  N/A ";
      return ("  " + fn(results[k])).padEnd(10);
    }).join(" ")}`;

    console.log(`  ${"Aspek".padEnd(22)} ${"Coal".padEnd(10)} ${"Iron/Steel".padEnd(12)} ${"Kopi".padEnd(10)} ${"Sawit".padEnd(10)} ${"Karet".padEnd(8)}`);
    console.log(`  ${"─".repeat(66)}`);
    const fmtStat = (r, fn) => { const v = fn(r); return (v === 0 ? "✅  0" : v > 0 ? `❌  ${v}` : "?").padEnd(10); };
    const fmtWarn = (r, fn) => { const v = fn(r); return (v === 0 ? "✅  0" : v > 0 ? `⚠️   ${v}` : "?").padEnd(10); };
    const fmtStatus = r => ({ OK: "✅ OK", WARN: "⚠️  WRN", FAIL: "❌FAIL", ERROR: "❌ERR" }[r?.summary] || "?");

    console.log(`  ${"Status".padEnd(22)} ${TARGET_KEYS.map(k => fmtStatus(results[k]).padEnd(10)).join(" ")}`);
    console.log(`  ${"Field Missing".padEnd(22)} ${TARGET_KEYS.map(k => fmtStat(results[k], r => r.fieldStats?.missing ?? "?")).join(" ")}`);
    console.log(`  ${"Doc Missing".padEnd(22)} ${TARGET_KEYS.map(k => fmtStat(results[k], r => r.docStats?.missing ?? "?")).join(" ")}`);
    console.log(`  ${"Checklist Missing".padEnd(22)} ${TARGET_KEYS.map(k => fmtStat(results[k], r => r.clStats?.missing ?? "?")).join(" ")}`);
    console.log(`  ${"Duplikat Doc".padEnd(22)} ${TARGET_KEYS.map(k => fmtWarn(results[k], r => r.warnings.filter(w => w.includes("DUPLIKAT DOKUMEN")).length > 0 ? r.warnings.filter(w=>w.includes("DUPLIKAT DOKUMEN"))[0].match(/\((\d+)\)/)?.[1] || 1 : 0)).join(" ")}`);
    console.log(`  ${"Duplikat Label".padEnd(22)} ${TARGET_KEYS.map(k => fmtWarn(results[k], r => r.warnings.filter(w => w.includes("DUPLIKAT LABEL")).length > 0 ? parseInt(r.warnings.find(w=>w.includes("DUPLIKAT LABEL"))?.match(/\((\d+)\)/)?.[1]||"0") : 0)).join(" ")}`);
    console.log(`  ${"Options Hilang".padEnd(22)} ${TARGET_KEYS.map(k => fmtWarn(results[k], r => r.warnings.filter(w => w.includes("OPTIONS HILANG")).length)).join(" ")}`);

    // ── Rekomendasi
    console.log(`\n${SEP}`);
    console.log("  REKOMENDASI SEBELUM CUTOVER");
    console.log(SEP);

    if (allFail.length === 0) {
      console.log("\n  ✅ Tidak ada blocking issue — cutover dapat dilanjutkan.");
    } else {
      console.log("\n  ❌ Ada blocking issue yang harus diperbaiki:");
      for (const k of allFail) {
        console.log(`\n  [${LABELS[k]}]`);
        for (const iss of results[k].issues) console.log(`    ${iss}`);
      }
    }

    if (allWarn.length > 0) {
      console.log("\n  ⚠️  Warning (non-blocking) yang perlu direview:");

      // Semantic duplicates
      const dupWarns = TARGET_KEYS.filter(k => results[k]?.warnings.some(w => w.includes("DUPLIKAT")));
      if (dupWarns.length) {
        console.log("\n  [DUPLIKAT] Field/dokumen dengan label sama tapi key berbeda ditemukan pada:");
        for (const k of dupWarns) {
          const dups = results[k].warnings.filter(w => w.includes("DUPLIKAT"));
          for (const d of dups) console.log(`    • [${LABELS[k]}] ${d}`);
        }
        console.log("  → Pertimbangkan cleanup dedup di product_templates sebelum go-live.");
      }

      // Options mismatches
      const optWarns = TARGET_KEYS.filter(k => results[k]?.warnings.some(w => w.includes("OPTIONS")));
      if (optWarns.length) {
        console.log("\n  [OPTIONS] Pilihan dropdown berkurang:");
        for (const k of optWarns) {
          const opts = results[k].warnings.filter(w => w.includes("OPTIONS"));
          for (const o of opts) console.log(`    • [${LABELS[k]}] ${o}`);
        }
        console.log("  → Pastikan vendor tidak membutuhkan opsi yang hilang sebelum go-live.");
      }
    }

    // ── Status tabel lama
    console.log(`\n${SEP}`);
    console.log("  STATUS TABEL LAMA (commodity_templates)");
    console.log(SEP);
    const [ctCount] = (await client.query("SELECT COUNT(*) as cnt FROM commodity_templates")).rows;
    const [ctfCount] = (await client.query("SELECT COUNT(*) as cnt FROM commodity_template_fields")).rows;
    const [cdCount] = (await client.query("SELECT COUNT(*) as cnt FROM commodity_required_docs")).rows;
    const [ccCount] = (await client.query("SELECT COUNT(*) as cnt FROM commodity_checklists")).rows;
    console.log(`\n  commodity_templates          : ${ctCount.cnt} rows — TIDAK DIHAPUS ✅`);
    console.log(`  commodity_template_fields    : ${ctfCount.cnt} rows — TIDAK DIHAPUS ✅`);
    console.log(`  commodity_required_docs      : ${cdCount.cnt} rows — TIDAK DIHAPUS ✅`);
    console.log(`  commodity_checklists         : ${ccCount.cnt} rows — TIDAK DIHAPUS ✅`);

    const overallVerdict = allFail.length === 0 && totalIssues === 0
      ? "✅ READY FOR CUTOVER"
      : "❌ NOT READY — BLOCKING ISSUES EXIST";

    console.log(`\n${LINE}`);
    console.log(`  VERDICT: ${overallVerdict}`);
    console.log(LINE + "\n");

    // Cleanup
    await teardownTestTokens(client);
    console.log("  Test token dibersihkan. ✅\n");

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error("FATAL:", e); process.exit(1); });
