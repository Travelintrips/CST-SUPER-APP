/**
 * Migration: commodity_templates → product_templates
 *
 * Konversi 4 tabel normalized (commodity_templates, commodity_template_fields,
 * commodity_required_docs, commodity_checklists) ke format JSONB product_templates.
 *
 * Strategi:
 *   - Template yang sudah ada di product_templates → MERGE (tambah fields/docs/checklist
 *     dari commodity yang belum ada, berdasarkan key uniqueness)
 *   - Template baru (rubber) → INSERT
 *   - Tabel lama TIDAK dihapus
 *
 * Run: node scripts/migrate-commodity-to-product-templates.mjs
 */

import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.SUPABASE_PG_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function mapFieldType(fieldType) {
  const map = { text: "text", number: "number", select: "select", date: "date", textarea: "textarea", boolean: "select" };
  return map[fieldType] ?? "text";
}

function buildCustomField(row) {
  const field = {
    key: row.field_key,
    label: row.label,
    type: mapFieldType(row.field_type),
    required: Boolean(row.required),
  };
  if (row.unit) field.unit = row.unit;
  if (row.options) {
    field.options = Array.isArray(row.options) ? row.options : (typeof row.options === "string" ? JSON.parse(row.options) : row.options);
  }
  if (row.field_type === "boolean" && !field.options) {
    field.options = ["Ya", "Tidak"];
  }
  return field;
}

function buildRequiredDoc(row) {
  const key = slugify(row.doc_name);
  return {
    key: key || `doc_${row.id}`,
    label: row.doc_name,
    required: Boolean(row.required),
  };
}

function buildChecklistItem(row) {
  const key = slugify(row.item);
  return {
    key: key || `cl_${row.id}`,
    label: row.item,
  };
}

// De-duplicate array by key field, new items take precedence
function mergeByKey(existing, incoming) {
  const map = new Map();
  for (const item of existing) map.set(item.key, item);
  for (const item of incoming) {
    if (!map.has(item.key)) map.set(item.key, item);
  }
  return Array.from(map.values());
}

// ── Validation Report ─────────────────────────────────────────────────────────

async function collectBeforeReport(client) {
  const [ctRes, ctfRes, crdRes, ccRes, ptRes] = await Promise.all([
    client.query("SELECT id, key, name FROM commodity_templates ORDER BY sort_order"),
    client.query("SELECT template_id, COUNT(*) as cnt FROM commodity_template_fields GROUP BY template_id"),
    client.query("SELECT template_id, COUNT(*) as cnt FROM commodity_required_docs GROUP BY template_id"),
    client.query("SELECT template_id, COUNT(*) as cnt FROM commodity_checklists GROUP BY template_id"),
    client.query("SELECT category_key, jsonb_array_length(custom_fields) as fields, jsonb_array_length(required_documents) as docs, jsonb_array_length(checklist) as checklist FROM product_templates ORDER BY sort_order"),
  ]);

  const fieldMap = Object.fromEntries(ctfRes.rows.map(r => [r.template_id, parseInt(r.cnt)]));
  const docMap   = Object.fromEntries(crdRes.rows.map(r => [r.template_id, parseInt(r.cnt)]));
  const clMap    = Object.fromEntries(ccRes.rows.map(r => [r.template_id, parseInt(r.cnt)]));

  return {
    commodity: {
      templates: ctRes.rows.map(r => ({
        id: r.id, key: r.key, name: r.name,
        fields: fieldMap[r.id] ?? 0,
        docs: docMap[r.id] ?? 0,
        checklists: clMap[r.id] ?? 0,
      })),
      totals: {
        templates: ctRes.rows.length,
        fields: Object.values(fieldMap).reduce((a, b) => a + b, 0),
        docs: Object.values(docMap).reduce((a, b) => a + b, 0),
        checklists: Object.values(clMap).reduce((a, b) => a + b, 0),
      },
    },
    productBefore: {
      templates: ptRes.rows,
      totals: {
        templates: ptRes.rows.length,
        fields: ptRes.rows.reduce((a, r) => a + parseInt(r.fields ?? 0), 0),
        docs: ptRes.rows.reduce((a, r) => a + parseInt(r.docs ?? 0), 0),
        checklists: ptRes.rows.reduce((a, r) => a + parseInt(r.checklist ?? 0), 0),
      },
    },
  };
}

async function collectAfterReport(client) {
  const res = await client.query(`
    SELECT 
      category_key,
      label,
      jsonb_array_length(custom_fields) as fields,
      jsonb_array_length(required_documents) as docs,
      jsonb_array_length(checklist) as checklist
    FROM product_templates
    ORDER BY sort_order
  `);
  return {
    templates: res.rows,
    totals: {
      templates: res.rows.length,
      fields: res.rows.reduce((a, r) => a + parseInt(r.fields ?? 0), 0),
      docs: res.rows.reduce((a, r) => a + parseInt(r.docs ?? 0), 0),
      checklists: res.rows.reduce((a, r) => a + parseInt(r.checklist ?? 0), 0),
    },
  };
}

// ── Main Migration ────────────────────────────────────────────────────────────

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1. Collect BEFORE state ───────────────────────────────────────────
    console.log("\n══════════════════════════════════════════════════════════");
    console.log("  VALIDATION REPORT — SEBELUM MIGRASI");
    console.log("══════════════════════════════════════════════════════════");

    const before = await collectBeforeReport(client);

    console.log("\n📦 Tabel commodity_templates (sumber):");
    console.log(`   Total templates  : ${before.commodity.totals.templates}`);
    console.log(`   Total fields     : ${before.commodity.totals.fields}`);
    console.log(`   Total docs       : ${before.commodity.totals.docs}`);
    console.log(`   Total checklists : ${before.commodity.totals.checklists}`);
    console.log("\n   Detail per template:");
    for (const t of before.commodity.templates) {
      console.log(`   [${t.key.padEnd(12)}] ${t.name.padEnd(20)} | fields=${t.fields} docs=${t.docs} checklists=${t.checklists}`);
    }

    console.log("\n📋 Tabel product_templates (tujuan, sebelum migrasi):");
    console.log(`   Total templates  : ${before.productBefore.totals.templates}`);
    console.log(`   Total fields     : ${before.productBefore.totals.fields}`);
    console.log(`   Total docs       : ${before.productBefore.totals.docs}`);
    console.log(`   Total checklists : ${before.productBefore.totals.checklists}`);

    // ── 2. Load all commodity data ────────────────────────────────────────
    const ctRes = await client.query(
      "SELECT * FROM commodity_templates ORDER BY sort_order"
    );
    const allFieldsRes = await client.query(
      "SELECT * FROM commodity_template_fields ORDER BY template_id, sort_order"
    );
    const allDocsRes = await client.query(
      "SELECT * FROM commodity_required_docs ORDER BY template_id, sort_order"
    );
    const allClRes = await client.query(
      "SELECT * FROM commodity_checklists ORDER BY template_id, sort_order"
    );

    // Group by template_id
    const fieldsByTpl  = {};
    const docsByTpl    = {};
    const clsByTpl     = {};
    for (const r of allFieldsRes.rows)  (fieldsByTpl[r.template_id]  ??= []).push(r);
    for (const r of allDocsRes.rows)    (docsByTpl[r.template_id]    ??= []).push(r);
    for (const r of allClRes.rows)      (clsByTpl[r.template_id]     ??= []).push(r);

    // ── 3. Process each commodity template ───────────────────────────────
    console.log("\n══════════════════════════════════════════════════════════");
    console.log("  PROSES MIGRASI");
    console.log("══════════════════════════════════════════════════════════\n");

    const results = [];

    for (const ct of ctRes.rows) {
      const incomingFields  = (fieldsByTpl[ct.id]  ?? []).map(buildCustomField);
      const incomingDocs    = (docsByTpl[ct.id]    ?? []).map(buildRequiredDoc);
      const incomingCls     = (clsByTpl[ct.id]     ?? []).map(buildChecklistItem);

      // Check if product_template with this category_key already exists
      const existing = await client.query(
        "SELECT id, category_key, label, custom_fields, required_documents, checklist FROM product_templates WHERE category_key = $1",
        [ct.key]
      );

      if (existing.rows.length > 0) {
        // MERGE mode
        const pt = existing.rows[0];
        const existingFields = pt.custom_fields ?? [];
        const existingDocs   = pt.required_documents ?? [];
        const existingCls    = pt.checklist ?? [];

        const mergedFields  = mergeByKey(existingFields, incomingFields);
        const mergedDocs    = mergeByKey(existingDocs, incomingDocs);
        const mergedCls     = mergeByKey(existingCls, incomingCls);

        const addedFields  = mergedFields.length  - existingFields.length;
        const addedDocs    = mergedDocs.length    - existingDocs.length;
        const addedCls     = mergedCls.length     - existingCls.length;

        await client.query(`
          UPDATE product_templates SET
            custom_fields       = $1::jsonb,
            required_documents  = $2::jsonb,
            checklist           = $3::jsonb,
            description         = COALESCE(description, $4),
            icon                = COALESCE(icon, $5),
            updated_at          = NOW()
          WHERE category_key = $6
        `, [
          JSON.stringify(mergedFields),
          JSON.stringify(mergedDocs),
          JSON.stringify(mergedCls),
          ct.description ?? null,
          ct.icon ?? null,
          ct.key,
        ]);

        results.push({ action: "MERGE", key: ct.key, name: ct.name, addedFields, addedDocs, addedCls });
        console.log(`  ✔ MERGE  [${ct.key}] — ditambah: +${addedFields} fields, +${addedDocs} docs, +${addedCls} checklist`);
      } else {
        // INSERT mode
        await client.query(`
          INSERT INTO product_templates
            (category_key, label, version, is_active, icon, description, sort_order,
             custom_fields, required_documents, checklist,
             packaging_instructions, conditional_rules, validation_rules,
             created_at, updated_at)
          VALUES ($1, $2, '1.0.0', true, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, '', '[]'::jsonb, '[]'::jsonb, NOW(), NOW())
          ON CONFLICT (category_key) DO NOTHING
        `, [
          ct.key,
          ct.name,
          ct.icon ?? null,
          ct.description ?? null,
          ct.sort_order ?? 0,
          JSON.stringify(incomingFields),
          JSON.stringify(incomingDocs),
          JSON.stringify(incomingCls),
        ]);

        results.push({ action: "INSERT", key: ct.key, name: ct.name, fields: incomingFields.length, docs: incomingDocs.length, cls: incomingCls.length });
        console.log(`  ✔ INSERT [${ct.key}] — ${ct.name}: ${incomingFields.length} fields, ${incomingDocs.length} docs, ${incomingCls.length} checklist`);
      }
    }

    await client.query("COMMIT");

    // ── 4. Collect AFTER state ────────────────────────────────────────────
    const after = await collectAfterReport(client);

    console.log("\n══════════════════════════════════════════════════════════");
    console.log("  VALIDATION REPORT — SESUDAH MIGRASI");
    console.log("══════════════════════════════════════════════════════════");

    console.log("\n📋 Tabel product_templates (setelah migrasi):");
    console.log(`   Total templates  : ${after.totals.templates}`);
    console.log(`   Total fields     : ${after.totals.fields}`);
    console.log(`   Total docs       : ${after.totals.docs}`);
    console.log(`   Total checklists : ${after.totals.checklists}`);
    console.log("\n   Detail per template:");
    for (const t of after.templates) {
      console.log(`   [${t.category_key.padEnd(16)}] ${(t.label || "").padEnd(34)} | fields=${t.fields} docs=${t.docs} checklist=${t.checklist}`);
    }

    // ── 5. Summary ───────────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════════════════════");
    console.log("  RINGKASAN MIGRASI");
    console.log("══════════════════════════════════════════════════════════");
    console.log(`\n  Templates diproses    : ${results.length}`);
    const merges  = results.filter(r => r.action === "MERGE");
    const inserts = results.filter(r => r.action === "INSERT");
    console.log(`  - Di-MERGE            : ${merges.length} (${merges.map(r => r.key).join(", ")})`);
    console.log(`  - Di-INSERT           : ${inserts.length} (${inserts.map(r => r.key).join(", ")})`);
    console.log(`\n  product_templates sebelum → sesudah:`);
    console.log(`  - Templates  : ${before.productBefore.totals.templates} → ${after.totals.templates} (+${after.totals.templates - before.productBefore.totals.templates})`);
    console.log(`  - Fields     : ${before.productBefore.totals.fields} → ${after.totals.fields} (+${after.totals.fields - before.productBefore.totals.fields})`);
    console.log(`  - Docs       : ${before.productBefore.totals.docs} → ${after.totals.docs} (+${after.totals.docs - before.productBefore.totals.docs})`);
    console.log(`  - Checklists : ${before.productBefore.totals.checklists} → ${after.totals.checklists} (+${after.totals.checklists - before.productBefore.totals.checklists})`);
    console.log(`\n  ✅ Tabel lama (commodity_templates, commodity_template_fields,`);
    console.log(`     commodity_required_docs, commodity_checklists) TIDAK dihapus.`);
    console.log("\n══════════════════════════════════════════════════════════\n");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ MIGRATION FAILED — ROLLBACK dilakukan");
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
