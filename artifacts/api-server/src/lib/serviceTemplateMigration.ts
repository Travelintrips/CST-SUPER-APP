import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getAllInCodeServiceTemplates } from "@workspace/service-templates";
import { logger } from "./logger.js";

export async function runServiceTemplateMigration(): Promise<void> {
  // ── 1. Create table ───────────────────────────────────────────────────────
  await db.execute(sql`
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

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS service_templates_service_type_idx
    ON service_templates (service_type)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS service_template_version_history (
      id            SERIAL PRIMARY KEY,
      service_type  TEXT NOT NULL,
      version       TEXT NOT NULL,
      label         TEXT,
      fields        JSONB NOT NULL DEFAULT '[]',
      required_docs JSONB NOT NULL DEFAULT '[]',
      checklist     JSONB NOT NULL DEFAULT '[]',
      change_note   TEXT,
      changed_by    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── 2. Upsert all 17 in-code templates ───────────────────────────────────
  const templates = getAllInCodeServiceTemplates();
  let upserted = 0;

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]!;
    await db.execute(sql`
      INSERT INTO service_templates
        (service_type, label, emoji, version, is_active, sort_order,
         fields, required_documents, checklist, conditional_rules, validation_rules)
      VALUES (
        ${t.serviceType},
        ${t.label},
        ${t.emoji},
        ${t.version},
        ${t.isActive},
        ${i},
        ${JSON.stringify(t.fields)},
        ${JSON.stringify(t.requiredDocuments)},
        ${JSON.stringify(t.checklist)},
        ${JSON.stringify(t.conditionalRules)},
        ${JSON.stringify(t.validationRules)}
      )
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
    `);
    upserted++;
  }

  // ── Media Foundation: idempotent ADD COLUMN IF NOT EXISTS ──────────────────
  await db.execute(sql`
    ALTER TABLE service_templates
      ADD COLUMN IF NOT EXISTS media_assets JSONB NOT NULL DEFAULT '[]'
  `);

  logger.info(
    { total: templates.length, upserted },
    "Service template migration: selesai",
  );
}
