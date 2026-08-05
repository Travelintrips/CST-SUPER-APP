/**
 * Template Cleanup — Step 1E
 *
 * Membersihkan product_templates dari:
 *   1. Duplikat custom_fields  (label sama, key berbeda) → pertahankan canonical key
 *   2. Duplikat required_documents (label sama) → pertahankan canonical key
 *   3. Opsi dropdown yang hilang (coffee grade, palm_oil product_type)
 *   4. required flag yang salah akibat merge (invoice, phyto)
 *
 * TIDAK menghapus commodity_templates atau data historis.
 * Semua perubahan dalam satu transaksi — bila ada error, rollback otomatis.
 *
 * Run: node scripts/cleanup-product-templates.mjs
 */

import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.SUPABASE_PG_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ═════════════════════════════════════════════════════════════════════════════
// CANONICAL DEFINITIONS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Field dedup rules per category.
 * keepKey   = key yang dipertahankan (canonical)
 * removeKey = key yang dihapus
 * mergeProps = properti dari removeKey yang di-copy ke keepKey (bila keepKey tidak punya)
 */
const FIELD_DEDUP = [
  // COAL
  { cat: "coal",      keepKey: "moisture",    removeKey: "total_moisture", mergeProps: ["unit"] },
  { cat: "coal",      keepKey: "ash",         removeKey: "ash_content",    mergeProps: ["unit"] },
  { cat: "coal",      keepKey: "sulfur",      removeKey: "sulfur_content", mergeProps: ["unit"] },
  // COFFEE
  { cat: "coffee",    keepKey: "moisture_pct", removeKey: "moisture",      mergeProps: ["unit"] },
];

/**
 * Document dedup rules per category.
 * keepKey   = key yang dipertahankan
 * removeKey = key yang dihapus
 * updateRequired = override required flag pada keepKey (bila null → tidak diubah)
 */
const DOC_DEDUP = [
  // COAL
  { cat: "coal",      keepKey: "coa",    removeKey: "certificate_of_analysis_coa", updateRequired: null },
  // IRON_STEEL
  { cat: "iron_steel", keepKey: "mtc",     removeKey: "mill_test_certificate_mtc",  updateRequired: null },
  { cat: "iron_steel", keepKey: "invoice", removeKey: "commercial_invoice",          updateRequired: true },
  // COFFEE
  { cat: "coffee",    keepKey: "phyto",  removeKey: "phytosanitary_certificate",    updateRequired: null },
  // PALM_OIL
  { cat: "palm_oil",  keepKey: "phyto",  removeKey: "phytosanitary_certificate",    updateRequired: true },
];

/**
 * Options fix rules per category+field.
 * strategy:
 *   "add_missing" → tambah opsi dari oldOptions yang belum ada di newOptions
 *   "replace"     → ganti seluruh options dengan newOptions
 */
const OPTIONS_FIX = [
  {
    cat: "coffee",
    fieldKey: "grade",
    strategy: "add_missing",
    addOptions: ["Grade 4", "Grade 5"],
    note: "Grade 4 & Grade 5 hilang saat merge in-code overrides commodity",
  },
  {
    cat: "palm_oil",
    fieldKey: "product_type",
    strategy: "replace",
    newOptions: [
      "CPO (Crude Palm Oil)",
      "CPKO (Crude Palm Kernel Oil)",
      "RBD Palm Oil",
      "RBD Palm Olein",
      "Palm Kernel Oil (PKO)",
      "Palm Olein",
      "Palm Stearin",
      "RBD Palm Stearin",
    ],
    note: "CPKO, RBD Palm Olein, RBD Palm Stearin hilang dari opsi sistem lama",
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function snapshot(arr, type) {
  const items = Array.isArray(arr) ? arr : [];
  return {
    count: items.length,
    keys: items.map(i => i.key),
    labels: items.map(i => i.label || i.item || ""),
    raw: items,
    type,
  };
}

function removeDuplicatesByLabel(arr) {
  const seen = new Map();
  const removed = [];
  const kept = [];
  for (const item of arr) {
    const lbl = (item.label || "").toLowerCase().trim();
    if (seen.has(lbl)) {
      removed.push(item.key);
    } else {
      seen.set(lbl, item.key);
      kept.push(item);
    }
  }
  return { kept, removed };
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function run() {
  const client = await pool.connect();
  const LINE = "═".repeat(68);
  const SEP  = "─".repeat(68);

  console.log(`\n${LINE}`);
  console.log("  TEMPLATE CLEANUP REPORT — Step 1E");
  console.log(`  ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`);
  console.log(LINE);

  try {
    // ── Load BEFORE state ─────────────────────────────────────────────────
    console.log("\n[1/4] Memuat state SEBELUM cleanup...");

    const catKeys = ["coal", "iron_steel", "coffee", "palm_oil", "rubber"];
    const catLabels = {
      coal: "Batubara", iron_steel: "Besi & Baja",
      coffee: "Kopi", palm_oil: "Minyak Sawit", rubber: "Karet",
    };

    const rows = await client.query(
      `SELECT category_key, label, custom_fields, required_documents, checklist
       FROM product_templates WHERE category_key = ANY($1) ORDER BY sort_order`,
      [catKeys],
    );

    const before = {};
    for (const row of rows.rows) {
      before[row.category_key] = {
        label: row.label,
        fields:    snapshot(row.custom_fields,       "field"),
        docs:      snapshot(row.required_documents,  "doc"),
        checklist: snapshot(row.checklist,            "cl"),
      };
    }

    for (const k of catKeys) {
      const b = before[k];
      if (!b) { console.log(`  [${k}] ⚠️  tidak ditemukan di product_templates`); continue; }
      console.log(`  ${catLabels[k].padEnd(18)} → fields=${b.fields.count}  docs=${b.docs.count}  checklist=${b.checklist.count}`);
    }

    // ── Begin transaction ─────────────────────────────────────────────────
    await client.query("BEGIN");
    console.log("\n[2/4] Menjalankan cleanup dalam transaksi...\n");

    const changeLog = {};
    for (const k of catKeys) changeLog[k] = { fieldsRemoved: [], docsRemoved: [], optionsFixed: [], docRequiredUpdated: [] };

    // ─────────────────────────────────────────────────────────────────────
    // A. Field dedup
    // ─────────────────────────────────────────────────────────────────────
    console.log(`${SEP}`);
    console.log("  A. FIELD DEDUP (label sama, key berbeda)");
    console.log(SEP);

    for (const rule of FIELD_DEDUP) {
      const row = rows.rows.find(r => r.category_key === rule.cat);
      if (!row) continue;

      let fields = Array.isArray(row.custom_fields) ? [...row.custom_fields] : [];
      const keepIdx   = fields.findIndex(f => f.key === rule.keepKey);
      const removeIdx = fields.findIndex(f => f.key === rule.removeKey);

      if (keepIdx === -1) {
        console.log(`  [${rule.cat}] ⚠️  canonical key "${rule.keepKey}" tidak ditemukan — skip`);
        continue;
      }
      if (removeIdx === -1) {
        console.log(`  [${rule.cat}] ℹ️  duplicate key "${rule.removeKey}" tidak ada — skip`);
        continue;
      }

      const keepField   = { ...fields[keepIdx] };
      const removeField = fields[removeIdx];

      // Merge props dari removeKey ke keepKey bila keepKey tidak punya
      let merged = false;
      for (const prop of (rule.mergeProps || [])) {
        if (removeField[prop] !== undefined && keepField[prop] === undefined) {
          keepField[prop] = removeField[prop];
          merged = true;
        }
      }
      fields[keepIdx] = keepField;
      fields.splice(removeIdx, 1);

      // Update DB
      await client.query(
        "UPDATE product_templates SET custom_fields = $1::jsonb, updated_at = NOW() WHERE category_key = $2",
        [JSON.stringify(fields), rule.cat],
      );
      // Reflect in local row for later steps
      row.custom_fields = fields;

      console.log(`  ✅ [${rule.cat}] KEEP "${rule.keepKey}" | REMOVE "${rule.removeKey}"${merged ? ` (merge: ${rule.mergeProps.join(",")})` : ""}`);
      console.log(`       label="${keepField.label}" type=${keepField.type} req=${keepField.required}${keepField.unit ? ` unit=${keepField.unit}` : ""}`);
      changeLog[rule.cat].fieldsRemoved.push(rule.removeKey);
    }

    // ─────────────────────────────────────────────────────────────────────
    // B. Document dedup
    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n${SEP}`);
    console.log("  B. DOCUMENT DEDUP (label sama)");
    console.log(SEP);

    for (const rule of DOC_DEDUP) {
      const row = rows.rows.find(r => r.category_key === rule.cat);
      if (!row) continue;

      let docs = Array.isArray(row.required_documents) ? [...row.required_documents] : [];
      const keepIdx   = docs.findIndex(d => d.key === rule.keepKey);
      const removeIdx = docs.findIndex(d => d.key === rule.removeKey);

      if (keepIdx === -1) {
        console.log(`  [${rule.cat}] ⚠️  canonical doc key "${rule.keepKey}" tidak ditemukan — skip`);
        continue;
      }
      if (removeIdx === -1) {
        console.log(`  [${rule.cat}] ℹ️  duplicate doc key "${rule.removeKey}" tidak ada — skip`);
        continue;
      }

      let keepDoc = { ...docs[keepIdx] };

      // Update required flag bila diminta
      if (rule.updateRequired !== null && rule.updateRequired !== undefined) {
        const oldReq = keepDoc.required;
        keepDoc.required = rule.updateRequired;
        if (oldReq !== rule.updateRequired) {
          changeLog[rule.cat].docRequiredUpdated.push(`${rule.keepKey}: ${oldReq}→${rule.updateRequired}`);
        }
      }

      docs[keepIdx] = keepDoc;
      docs.splice(removeIdx, 1);

      await client.query(
        "UPDATE product_templates SET required_documents = $1::jsonb, updated_at = NOW() WHERE category_key = $2",
        [JSON.stringify(docs), rule.cat],
      );
      row.required_documents = docs;

      const reqNote = rule.updateRequired !== null ? ` (required updated → ${rule.updateRequired})` : "";
      console.log(`  ✅ [${rule.cat}] KEEP "${rule.keepKey}" | REMOVE "${rule.removeKey}"${reqNote}`);
      console.log(`       label="${keepDoc.label}" required=${keepDoc.required}`);
      changeLog[rule.cat].docsRemoved.push(rule.removeKey);
    }

    // ─────────────────────────────────────────────────────────────────────
    // C. Options fix
    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n${SEP}`);
    console.log("  C. OPTIONS FIX (opsi dropdown)");
    console.log(SEP);

    for (const rule of OPTIONS_FIX) {
      const row = rows.rows.find(r => r.category_key === rule.cat);
      if (!row) continue;

      let fields = Array.isArray(row.custom_fields) ? [...row.custom_fields] : [];
      const idx = fields.findIndex(f => f.key === rule.fieldKey);
      if (idx === -1) {
        console.log(`  [${rule.cat}] ⚠️  field "${rule.fieldKey}" tidak ditemukan — skip`);
        continue;
      }

      const field = { ...fields[idx] };
      const before_opts = [...(field.options || [])];

      if (rule.strategy === "add_missing") {
        const existing = new Set(field.options || []);
        const added = [];
        for (const opt of rule.addOptions) {
          if (!existing.has(opt)) { (field.options = field.options || []).push(opt); added.push(opt); }
        }
        if (!added.length) {
          console.log(`  ℹ️  [${rule.cat}] "${rule.fieldKey}" — opsi sudah lengkap, skip`);
          continue;
        }
        console.log(`  ✅ [${rule.cat}] "${rule.fieldKey}" → ditambah: ${added.join(", ")}`);
        console.log(`       Note: ${rule.note}`);
        changeLog[rule.cat].optionsFixed.push(`${rule.fieldKey}: +${added.join(", ")}`);
      } else if (rule.strategy === "replace") {
        field.options = rule.newOptions;
        const removed_opts = before_opts.filter(o => !rule.newOptions.includes(o));
        const added_opts   = rule.newOptions.filter(o => !before_opts.includes(o));
        console.log(`  ✅ [${rule.cat}] "${rule.fieldKey}" → replace options`);
        if (added_opts.length)   console.log(`       + Ditambah  : ${added_opts.join(", ")}`);
        if (removed_opts.length) console.log(`       - Dihapus   : ${removed_opts.join(", ")}`);
        console.log(`       Note: ${rule.note}`);
        changeLog[rule.cat].optionsFixed.push(`${rule.fieldKey}: replaced (${before_opts.length}→${rule.newOptions.length} opts)`);
      }

      fields[idx] = field;
      await client.query(
        "UPDATE product_templates SET custom_fields = $1::jsonb, updated_at = NOW() WHERE category_key = $2",
        [JSON.stringify(fields), rule.cat],
      );
      row.custom_fields = fields;
    }

    // ─────────────────────────────────────────────────────────────────────
    // D. Checklist: cek duplikat exact label
    // ─────────────────────────────────────────────────────────────────────
    console.log(`\n${SEP}`);
    console.log("  D. CHECKLIST DEDUP (exact label)");
    console.log(SEP);

    let totalClRemoved = 0;
    for (const k of catKeys) {
      const row = rows.rows.find(r => r.category_key === k);
      if (!row) continue;
      const cl = Array.isArray(row.checklist) ? [...row.checklist] : [];
      const { kept, removed } = removeDuplicatesByLabel(cl);
      if (removed.length) {
        await client.query(
          "UPDATE product_templates SET checklist = $1::jsonb, updated_at = NOW() WHERE category_key = $2",
          [JSON.stringify(kept), k],
        );
        row.checklist = kept;
        console.log(`  ✅ [${k}] Removed ${removed.length} duplicate checklist: ${removed.join(", ")}`);
        totalClRemoved += removed.length;
      } else {
        console.log(`  ✅ [${k}] Tidak ada duplikat checklist`);
      }
    }

    // ── COMMIT ────────────────────────────────────────────────────────────
    await client.query("COMMIT");
    console.log(`\n  ✅ COMMIT berhasil`);

    // ── Load AFTER state ──────────────────────────────────────────────────
    console.log("\n[3/4] Memuat state SETELAH cleanup...");

    const rowsAfter = await client.query(
      `SELECT category_key, label, custom_fields, required_documents, checklist
       FROM product_templates WHERE category_key = ANY($1) ORDER BY sort_order`,
      [catKeys],
    );

    const after = {};
    for (const row of rowsAfter.rows) {
      after[row.category_key] = {
        label: row.label,
        fields:    snapshot(row.custom_fields,      "field"),
        docs:      snapshot(row.required_documents, "doc"),
        checklist: snapshot(row.checklist,           "cl"),
      };
    }

    // ── Generate BEFORE/AFTER Report ─────────────────────────────────────
    console.log("\n[4/4] Generating report...\n");

    console.log(`${LINE}`);
    console.log("  BEFORE → AFTER COMPARISON");
    console.log(LINE);

    const ICONS = { coal: "⛏️ ", iron_steel: "🔩", coffee: "☕", palm_oil: "🌴", rubber: "🔵" };

    let totalFieldsRemoved = 0;
    let totalDocsRemoved   = 0;

    for (const k of catKeys) {
      const b = before[k];
      const a = after[k];
      if (!b || !a) continue;

      const fDiff = a.fields.count    - b.fields.count;
      const dDiff = a.docs.count      - b.docs.count;
      const cDiff = a.checklist.count - b.checklist.count;
      const cl    = changeLog[k];

      totalFieldsRemoved += cl.fieldsRemoved.length;
      totalDocsRemoved   += cl.docsRemoved.length;

      const fStatus = fDiff === 0 ? "✅" : fDiff < 0 ? "🔽" : "🔼";
      const dStatus = dDiff === 0 ? "✅" : dDiff < 0 ? "🔽" : "🔼";
      const cStatus = cDiff === 0 ? "✅" : cDiff < 0 ? "🔽" : "🔼";

      console.log(`\n  ${ICONS[k]}  ${catLabels[k]} (${k})`);
      console.log(`  ${"─".repeat(52)}`);
      console.log(`  ┌──────────────┬────────┬────────┬──────────────────────┐`);
      console.log(`  │ Aspek        │ Before │ After  │ Δ                    │`);
      console.log(`  ├──────────────┼────────┼────────┼──────────────────────┤`);
      console.log(`  │ Custom Fields│ ${String(b.fields.count).padStart(6)} │ ${String(a.fields.count).padStart(6)} │ ${fStatus} ${fDiff === 0 ? "tidak berubah" : `${fDiff} (${cl.fieldsRemoved.join(", ") || "—"})`}`.padEnd(54) + " │");
      console.log(`  │ Documents    │ ${String(b.docs.count).padStart(6)} │ ${String(a.docs.count).padStart(6)} │ ${dStatus} ${dDiff === 0 ? "tidak berubah" : `${dDiff} (${cl.docsRemoved.join(", ") || "—"})`}`.padEnd(54) + " │");
      console.log(`  │ Checklist    │ ${String(b.checklist.count).padStart(6)} │ ${String(a.checklist.count).padStart(6)} │ ${cStatus} ${cDiff === 0 ? "tidak berubah" : `${cDiff}`}`.padEnd(54) + " │");
      console.log(`  └──────────────┴────────┴────────┴──────────────────────┘`);

      if (cl.fieldsRemoved.length) {
        console.log(`\n  Fields dihapus  : ${cl.fieldsRemoved.join(", ")}`);
      }
      if (cl.docsRemoved.length) {
        console.log(`  Docs dihapus    : ${cl.docsRemoved.join(", ")}`);
      }
      if (cl.docRequiredUpdated.length) {
        console.log(`  Doc req updated : ${cl.docRequiredUpdated.join("; ")}`);
      }
      if (cl.optionsFixed.length) {
        console.log(`  Options fixed   : ${cl.optionsFixed.join("; ")}`);
      }

      // Verify options after cleanup
      for (const rule of OPTIONS_FIX.filter(r => r.cat === k)) {
        const field = (after[k]?.fields?.raw || []).find(f => f.key === rule.fieldKey);
        if (field?.options) {
          const toCheck = rule.strategy === "add_missing" ? rule.addOptions : rule.newOptions;
          const stillMissing = toCheck.filter(o => !field.options.includes(o));
          if (stillMissing.length === 0) {
            console.log(`  ✅ Options "${rule.fieldKey}" lengkap (${field.options.length} opsi)`);
          } else {
            console.log(`  ❌ Options "${rule.fieldKey}" masih kurang: ${stillMissing.join(", ")}`);
          }
        }
      }

      // After fields list
      console.log(`\n  Fields akhir (${a.fields.count}):`);
      for (const f of (after[k]?.fields?.raw || [])) {
        const req = f.required ? "req" : "opt";
        const opts = f.options ? ` [${f.options.length} opts]` : "";
        const unit = f.unit ? ` (${f.unit})` : "";
        console.log(`    ${f.key.padEnd(22)} ${f.type.padEnd(8)} ${req}${unit}${opts}`);
      }

      console.log(`\n  Docs akhir (${a.docs.count}):`);
      for (const d of (after[k]?.docs?.raw || [])) {
        const req = d.required ? "req" : "opt";
        console.log(`    ${d.key.padEnd(32)} ${req}  ${d.label}`);
      }
    }

    // ── Commodity tables still intact ─────────────────────────────────────
    const [ctCounts] = (await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM commodity_templates) as ct,
        (SELECT COUNT(*) FROM commodity_template_fields) as ctf,
        (SELECT COUNT(*) FROM commodity_required_docs) as crd,
        (SELECT COUNT(*) FROM commodity_checklists) as cc
    `)).rows;

    // ── Executive Summary ─────────────────────────────────────────────────
    console.log(`\n${LINE}`);
    console.log("  EXECUTIVE SUMMARY");
    console.log(LINE);
    console.log(`\n  Total field duplikat dihapus    : ${totalFieldsRemoved}`);
    console.log(`  Total dokumen duplikat dihapus  : ${totalDocsRemoved}`);
    console.log(`  Total checklist duplikat dihapus: ${totalClRemoved}`);
    console.log(`\n  Canonical Field Mapping yang diterapkan:`);
    for (const r of FIELD_DEDUP) {
      console.log(`    ${r.removeKey.padEnd(24)} → ${r.keepKey}  (${r.cat})`);
    }
    console.log(`\n  Options yang diperbaiki:`);
    for (const r of OPTIONS_FIX) {
      const strategy = r.strategy === "add_missing"
        ? `ditambah: ${r.addOptions.join(", ")}`
        : `replace → ${r.newOptions.length} opsi`;
      console.log(`    [${r.cat}] "${r.fieldKey}" — ${strategy}`);
    }

    console.log(`\n  Status tabel lama (TIDAK DIHAPUS):`);
    console.log(`    commodity_templates        : ${ctCounts.ct} rows ✅`);
    console.log(`    commodity_template_fields  : ${ctCounts.ctf} rows ✅`);
    console.log(`    commodity_required_docs    : ${ctCounts.crd} rows ✅`);
    console.log(`    commodity_checklists       : ${ctCounts.cc} rows ✅`);

    // ── Final comparison table ────────────────────────────────────────────
    console.log(`\n  ┌──────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐`);
    console.log(`  │ Template     │ F.Before │ F.After  │ D.Before │ D.After  │ CL       │`);
    console.log(`  ├──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤`);
    for (const k of catKeys) {
      const b = before[k]; const a = after[k];
      if (!b || !a) continue;
      const name = catLabels[k].slice(0, 12).padEnd(12);
      const fB = String(b.fields.count).padStart(8); const fA = String(a.fields.count).padStart(8);
      const dB = String(b.docs.count).padStart(8);   const dA = String(a.docs.count).padStart(8);
      const cl = String(a.checklist.count).padStart(8);
      console.log(`  │ ${name} │ ${fB} │ ${fA} │ ${dB} │ ${dA} │ ${cl} │`);
    }
    console.log(`  └──────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘`);

    console.log(`\n  ✅ Cleanup selesai. Data historis dan commodity_templates tidak tersentuh.`);
    console.log(`  ✅ product_templates siap untuk production cutover.\n`);
    console.log(`${LINE}\n`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ ERROR — ROLLBACK dilakukan");
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
