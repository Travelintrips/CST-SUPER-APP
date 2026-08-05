/**
 * Seed / re-seed service_templates table dari @workspace/service-templates.
 *
 * Behavior:
 *  - CREATE TABLE IF NOT EXISTS (idempoten)
 *  - UPSERT semua 17 in-code templates (INSERT ON CONFLICT DO UPDATE)
 *  - Tidak menghapus row yang sudah ada & tidak ada di in-code (custom override aman)
 *  - Tidak mengubah vendorMiniForm.ts / SERVICE_SCHEMAS
 *
 * Run:
 *   node --import tsx/esm scripts/seed-service-templates.mjs
 *   OR
 *   pnpm exec tsx scripts/seed-service-templates.mjs
 */

import pg from "pg";
import { getAllInCodeServiceTemplates } from "@workspace/service-templates";

const { Pool } = pg;

const connectionString = (
  process.env.SUPABASE_PG_URL      ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL          ||
  ""
).replace(/:6543\//, ":5432/");

if (!connectionString) {
  console.error("ERROR: Tidak ada connection string DB (SUPABASE_PG_URL / DATABASE_URL)");
  process.exit(1);
}

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    // ── 1. Create table ───────────────────────────────────────────────────
    process.stdout.write("  ▸ CREATE TABLE IF NOT EXISTS service_templates... ");
    await client.query(`
      CREATE TABLE IF NOT EXISTS service_templates (
        id                  SERIAL PRIMARY KEY,
        service_type        TEXT NOT NULL UNIQUE,
        label               TEXT NOT NULL,
        emoji               TEXT NOT NULL DEFAULT '📋',
        version             TEXT NOT NULL DEFAULT '1.0.0',
        is_active           BOOLEAN NOT NULL DEFAULT TRUE,
        description         TEXT,
        sort_order          INTEGER NOT NULL DEFAULT 0,
        fields              JSONB NOT NULL DEFAULT '[]',
        required_documents  JSONB NOT NULL DEFAULT '[]',
        checklist           JSONB NOT NULL DEFAULT '[]',
        conditional_rules   JSONB NOT NULL DEFAULT '[]',
        validation_rules    JSONB NOT NULL DEFAULT '[]',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS service_templates_service_type_idx
      ON service_templates (service_type)
    `);
    console.log("OK");

    // ── 2. Load in-code templates ─────────────────────────────────────────
    const templates = getAllInCodeServiceTemplates();
    console.log(`\n  Template yang akan di-upsert: ${templates.length}`);

    // ── 3. Upsert each template ───────────────────────────────────────────
    let inserted = 0;
    let updated  = 0;

    for (let i = 0; i < templates.length; i++) {
      const t = templates[i];
      process.stdout.write(`  ▸ [${String(i + 1).padStart(2, "0")}/17] ${t.serviceType.padEnd(25)} `);

      const result = await client.query(
        `
        INSERT INTO service_templates
          (service_type, label, emoji, version, is_active, sort_order,
           fields, required_documents, checklist, conditional_rules, validation_rules)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)
        ON CONFLICT (service_type) DO UPDATE SET
          label              = EXCLUDED.label,
          emoji              = EXCLUDED.emoji,
          version            = EXCLUDED.version,
          fields             = EXCLUDED.fields,
          required_documents = EXCLUDED.required_documents,
          checklist          = EXCLUDED.checklist,
          conditional_rules  = EXCLUDED.conditional_rules,
          validation_rules   = EXCLUDED.validation_rules,
          updated_at         = NOW()
        RETURNING (xmax = 0) AS is_insert
        `,
        [
          t.serviceType,
          t.label,
          t.emoji,
          t.version,
          t.isActive,
          i,
          JSON.stringify(t.fields),
          JSON.stringify(t.requiredDocuments),
          JSON.stringify(t.checklist),
          JSON.stringify(t.conditionalRules),
          JSON.stringify(t.validationRules),
        ],
      );

      const wasInsert = result.rows[0]?.is_insert;
      if (wasInsert) { inserted++; console.log("INSERT"); }
      else           { updated++;  console.log("UPDATE"); }
    }

    // ── 4. Count rows ─────────────────────────────────────────────────────
    const { rows } = await client.query("SELECT COUNT(*) AS n FROM service_templates");
    const totalRows = Number(rows[0]?.n ?? 0);

    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ seed-service-templates selesai
   Inserted : ${inserted}
   Updated  : ${updated}
   Total DB : ${totalRows} rows
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // ── 5. Print summary ──────────────────────────────────────────────────
    const { rows: allRows } = await client.query(
      "SELECT service_type, label, emoji, version FROM service_templates ORDER BY sort_order, service_type",
    );
    console.log("\n  service_type                label                           emoji  version");
    console.log("  " + "─".repeat(80));
    for (const r of allRows) {
      console.log(
        `  ${r.service_type.padEnd(28)} ${r.label.padEnd(34)} ${r.emoji.padEnd(4)} ${r.version}`,
      );
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
