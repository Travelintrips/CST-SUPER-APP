import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runTaxRulesMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tax_rules (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      name            TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      module_source   TEXT NOT NULL DEFAULT 'all',
      partner_type    TEXT NOT NULL DEFAULT 'all',
      partner_pkp_status TEXT NOT NULL DEFAULT 'all',
      partner_has_npwp TEXT NOT NULL DEFAULT 'all',
      tax_type        TEXT NOT NULL,
      tax_rate        NUMERIC(8,4) NOT NULL DEFAULT 0,
      tax_base_type   TEXT NOT NULL DEFAULT 'dpp',
      direction       TEXT NOT NULL DEFAULT 'output',
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      effective_from  DATE,
      effective_to    DATE,
      notes           TEXT,
      created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tax_rules_company_idx  ON tax_rules (company_id, is_active)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS tax_rules_tx_type_idx  ON tax_rules (transaction_type)
  `);

  // Add direction + notes columns to transaction_taxes if missing
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_taxes' AND column_name = 'direction'
      ) THEN
        ALTER TABLE transaction_taxes ADD COLUMN direction TEXT NOT NULL DEFAULT 'output';
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_taxes' AND column_name = 'tax_rule_id'
      ) THEN
        ALTER TABLE transaction_taxes ADD COLUMN tax_rule_id INTEGER REFERENCES tax_rules(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_taxes' AND column_name = 'partner_name'
      ) THEN
        ALTER TABLE transaction_taxes ADD COLUMN partner_name TEXT;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_taxes' AND column_name = 'npwp'
      ) THEN
        ALTER TABLE transaction_taxes ADD COLUMN npwp TEXT;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_taxes' AND column_name = 'tax_invoice_number'
      ) THEN
        ALTER TABLE transaction_taxes ADD COLUMN tax_invoice_number TEXT;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_taxes' AND column_name = 'faktur_pajak_number'
      ) THEN
        ALTER TABLE transaction_taxes ADD COLUMN faktur_pajak_number TEXT;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_taxes' AND column_name = 'bukti_potong_number'
      ) THEN
        ALTER TABLE transaction_taxes ADD COLUMN bukti_potong_number TEXT;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_taxes' AND column_name = 'posted_at'
      ) THEN
        ALTER TABLE transaction_taxes ADD COLUMN posted_at TIMESTAMPTZ;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'accounting_entries' AND column_name = 'approved_by'
      ) THEN
        ALTER TABLE accounting_entries ADD COLUMN approved_by TEXT;
        ALTER TABLE accounting_entries ADD COLUMN approved_at TIMESTAMPTZ;
        ALTER TABLE accounting_entries ADD COLUMN cancelled_by TEXT;
        ALTER TABLE accounting_entries ADD COLUMN cancelled_at TIMESTAMPTZ;
        ALTER TABLE accounting_entries ADD COLUMN cancel_reason TEXT;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sales_documents' AND column_name = 'cancelled_by'
      ) THEN
        ALTER TABLE sales_documents ADD COLUMN cancelled_by TEXT;
        ALTER TABLE sales_documents ADD COLUMN cancel_reason TEXT;
        ALTER TABLE sales_documents ADD COLUMN approved_by TEXT;
        ALTER TABLE sales_documents ADD COLUMN approved_at TIMESTAMPTZ;
        ALTER TABLE sales_documents ADD COLUMN edit_reason TEXT;
        ALTER TABLE sales_documents ADD COLUMN reversal_reason TEXT;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_documents' AND column_name = 'cancelled_by'
      ) THEN
        ALTER TABLE purchase_documents ADD COLUMN cancelled_by TEXT;
        ALTER TABLE purchase_documents ADD COLUMN cancel_reason TEXT;
        ALTER TABLE purchase_documents ADD COLUMN approved_by TEXT;
        ALTER TABLE purchase_documents ADD COLUMN approved_at TIMESTAMPTZ;
        ALTER TABLE purchase_documents ADD COLUMN edit_reason TEXT;
      END IF;
    END $$;
  `);

  logger.info("Tax rules migration: selesai (tax_rules table + transaction_taxes columns ready)");
}

export async function seedDefaultTaxRules(companyId: number): Promise<void> {
  const existing = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM tax_rules WHERE company_id = ${companyId}
  `);
  const cnt = (existing.rows[0] as { cnt: number }).cnt;
  if (cnt > 0) return;

  const rules = [
    { name: "PPN Keluaran 11%", transaction_type: "sales_order", module_source: "sales", tax_type: "PPN_KELUARAN", tax_rate: 11, direction: "output" },
    { name: "PPN Masukan 11%", transaction_type: "purchase_order", module_source: "purchase", tax_type: "PPN_MASUKAN", tax_rate: 11, direction: "input" },
    { name: "PPh 23 Jasa 2%", transaction_type: "expense", module_source: "expense", tax_type: "PPH_23", tax_rate: 2, direction: "withholding" },
    { name: "PPh 21 Gaji", transaction_type: "expense", module_source: "payroll", tax_type: "PPH_21", tax_rate: 5, direction: "withholding" },
    { name: "PPh 4(2) Sewa 10%", transaction_type: "expense", module_source: "expense", tax_type: "PPH_4_AYAT_2", tax_rate: 10, direction: "withholding" },
    { name: "PPh 15 Freight DN 1.1%", transaction_type: "logistic_order", module_source: "logistics", tax_type: "PPH_15", tax_rate: 1.1, direction: "withholding" },
    { name: "PPN Logistik 11%", transaction_type: "logistic_order", module_source: "logistics", tax_type: "PPN_KELUARAN", tax_rate: 11, direction: "output" },
    { name: "PPN Sport Center 11%", transaction_type: "sport_center", module_source: "sport_center", tax_type: "PPN_KELUARAN", tax_rate: 11, direction: "output" },
  ];

  for (const r of rules) {
    await db.execute(sql`
      INSERT INTO tax_rules (company_id, name, transaction_type, module_source, tax_type, tax_rate, direction, is_active)
      VALUES (${companyId}, ${r.name}, ${r.transaction_type}, ${r.module_source}, ${r.tax_type}, ${r.tax_rate}, ${r.direction}, true)
      ON CONFLICT DO NOTHING
    `);
  }
  logger.info({ companyId }, "Tax rules: default rules seeded");
}

/**
 * Resolve an active tax rule for a company. Callers must not invent a tax
 * rate when configuration is missing; returning null lets them fail clearly.
 */
export async function getActiveTaxRate(
  companyId: number,
  transactionTypes: string[],
  taxType = "PPN_KELUARAN",
): Promise<number | null> {
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new Error("Company context is required to resolve tax rules");
  }
  const types = transactionTypes.map((type) => `'${type.replace(/'/g, "''")}'`).join(", ");
  const result = await db.execute(sql.raw(`
    SELECT tax_rate
    FROM tax_rules
    WHERE company_id = ${companyId}
      AND is_active = true
      AND tax_type = '${taxType.replace(/'/g, "''")}'
      AND transaction_type IN (${types})
    ORDER BY effective_from DESC NULLS LAST, id DESC
    LIMIT 1
  `));
  const rate = Number((result.rows[0] as { tax_rate?: unknown } | undefined)?.tax_rate);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}
