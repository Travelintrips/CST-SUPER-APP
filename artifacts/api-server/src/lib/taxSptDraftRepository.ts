/**
 * taxSptDraftRepository.ts
 *
 * Persistensi draft SPT ke tabel tax_spt_drafts.
 * Menjalankan boot migration (CREATE TABLE IF NOT EXISTS + ALTER TABLE IF NOT EXISTS).
 *
 * Tabel: tax_spt_drafts
 *   id, company_id, period, type, status, payload_json, created_at, updated_at
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import type { SptDraft } from "./taxSptBuilderService.js";

// ── Status & Type enums ────────────────────────────────────────────────────────

export type SptDraftType   = "PPN" | "PPh21" | "PPh23" | "PPh15" | "PPh4" | "ALL";
export type SptDraftStatus = "draft" | "validated" | "exported" | "submitted";

export interface TaxSptDraftRecord {
  id: number;
  company_id: number;
  period: string;
  type: SptDraftType;
  status: SptDraftStatus;
  payload_json: SptDraft | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ── Boot migration ─────────────────────────────────────────────────────────────

export async function bootMigrateSptDrafts(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS tax_spt_drafts (
        id           SERIAL PRIMARY KEY,
        company_id   INTEGER NOT NULL,
        period       VARCHAR(7) NOT NULL,
        type         VARCHAR(20) NOT NULL DEFAULT 'ALL',
        status       VARCHAR(20) NOT NULL DEFAULT 'draft',
        payload_json JSONB NOT NULL DEFAULT '{}',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));

    await db.execute(sql.raw(`
      ALTER TABLE tax_spt_drafts
        ADD COLUMN IF NOT EXISTS exported_at   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS submitted_at  TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS notes         TEXT,
        ADD COLUMN IF NOT EXISTS export_format VARCHAR(10) DEFAULT 'csv'
    `)).catch(() => {});

    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_tax_spt_drafts_company_period
        ON tax_spt_drafts (company_id, period, type)
    `)).catch(() => {});

    logger.info("[taxSptDraft] Tabel tax_spt_drafts OK");
  } catch (err: any) {
    logger.error({ err: err.message }, "[taxSptDraft] Boot migration gagal");
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function saveSptDraft(opts: {
  companyId: number;
  period: string;
  type: SptDraftType;
  draft: SptDraft;
  notes?: string;
}): Promise<number> {
  const payload = JSON.stringify(opts.draft).replace(/'/g, "''");
  const notes   = (opts.notes ?? "").replace(/'/g, "''");

  // Upsert: satu draft per (company_id, period, type)
  const { rows } = await db.execute(sql.raw(`
    INSERT INTO tax_spt_drafts (company_id, period, type, status, payload_json, notes, updated_at)
    VALUES (
      ${opts.companyId},
      '${opts.period}',
      '${opts.type}',
      'draft',
      '${payload}'::jsonb,
      '${notes}',
      NOW()
    )
    ON CONFLICT (company_id, period, type)
    DO UPDATE SET
      payload_json = EXCLUDED.payload_json,
      notes        = EXCLUDED.notes,
      updated_at   = NOW(),
      status       = CASE
        WHEN tax_spt_drafts.status = 'submitted' THEN 'submitted'
        ELSE 'draft'
      END
    RETURNING id
  `)).catch(async () => {
    // Fallback jika unique constraint belum ada — insert biasa
    const { rows: r2 } = await db.execute(sql.raw(`
      INSERT INTO tax_spt_drafts (company_id, period, type, status, payload_json, notes)
      VALUES (
        ${opts.companyId},
        '${opts.period}',
        '${opts.type}',
        'draft',
        '${payload}'::jsonb,
        '${notes}'
      )
      RETURNING id
    `));
    return { rows: r2 };
  });

  const id = Number((rows as any[])[0]?.id ?? 0);
  logger.info({ id, companyId: opts.companyId, period: opts.period, type: opts.type }, "[taxSptDraft] Draft disimpan");
  return id;
}

export async function listSptDrafts(
  companyId: number,
  year?: string,
): Promise<TaxSptDraftRecord[]> {
  const yearFilter = year ? `AND period LIKE '${year}-%'` : "";

  const { rows } = await db.execute(sql.raw(`
    SELECT id, company_id, period, type, status, payload_json, created_at, updated_at
    FROM tax_spt_drafts
    WHERE company_id = ${companyId}
      ${yearFilter}
    ORDER BY period DESC, type ASC
    LIMIT 200
  `)).catch(() => ({ rows: [] }));

  return (rows as any[]).map(mapRow);
}

export async function getSptDraft(
  id: number,
  companyId: number,
): Promise<TaxSptDraftRecord | null> {
  const { rows } = await db.execute(sql.raw(`
    SELECT id, company_id, period, type, status, payload_json, created_at, updated_at
    FROM tax_spt_drafts
    WHERE id = ${id} AND company_id = ${companyId}
    LIMIT 1
  `)).catch(() => ({ rows: [] }));

  if (!(rows as any[]).length) return null;
  return mapRow((rows as any[])[0]);
}

export async function updateSptDraftStatus(
  id: number,
  companyId: number,
  status: SptDraftStatus,
): Promise<boolean> {
  const extraField = status === "exported"
    ? ", exported_at = NOW()"
    : status === "submitted"
    ? ", submitted_at = NOW()"
    : "";

  const { rows } = await db.execute(sql.raw(`
    UPDATE tax_spt_drafts
    SET status     = '${status}',
        updated_at = NOW()
        ${extraField}
    WHERE id = ${id} AND company_id = ${companyId}
    RETURNING id
  `)).catch(() => ({ rows: [] }));

  return (rows as any[]).length > 0;
}

export async function deleteSptDraft(
  id: number,
  companyId: number,
): Promise<boolean> {
  const { rows } = await db.execute(sql.raw(`
    DELETE FROM tax_spt_drafts
    WHERE id = ${id} AND company_id = ${companyId}
      AND status NOT IN ('submitted')
    RETURNING id
  `)).catch(() => ({ rows: [] }));

  return (rows as any[]).length > 0;
}

// ── Unique constraint (idempotent) ─────────────────────────────────────────────

export async function ensureUniqueConstraint(): Promise<void> {
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tax_spt_drafts_company_period_type_key'
      ) THEN
        ALTER TABLE tax_spt_drafts
          ADD CONSTRAINT tax_spt_drafts_company_period_type_key
          UNIQUE (company_id, period, type);
      END IF;
    END $$;
  `)).catch(() => {});
}

// ── Row mapper ─────────────────────────────────────────────────────────────────

function mapRow(r: any): TaxSptDraftRecord {
  return {
    id: Number(r.id),
    company_id: Number(r.company_id),
    period: String(r.period ?? ""),
    type: String(r.type ?? "ALL") as SptDraftType,
    status: String(r.status ?? "draft") as SptDraftStatus,
    payload_json: typeof r.payload_json === "string"
      ? JSON.parse(r.payload_json)
      : (r.payload_json ?? {}),
    created_at: r.created_at ? new Date(r.created_at).toISOString() : "",
    updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : "",
  };
}
