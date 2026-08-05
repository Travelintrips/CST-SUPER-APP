/**
 * exceptionService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Idempotent exception creator.
 *
 * Idempotency rule: jika ada exception dengan kombinasi
 *   refType + refId + exceptionType  DAN  status IN ('open', 'in_progress')
 * maka INSERT dilewati dan existing row dikembalikan.
 *
 * Enum values yang tersedia:
 *   order_rejected | vendor_reject_rfq | vendor_out_of_stock | price_changed |
 *   delivery_delayed | failed_delivery | customer_complaint | document_missing |
 *   payment_overdue | vendor_rejected | pod_pending_review
 *
 * Boot migration: runExceptionEnumMigration() menambah nilai enum baru ke
 * PostgreSQL jika belum ada. Dipanggil sekali saat server start.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db, exceptionsTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExceptionType =
  | "order_rejected"
  | "vendor_reject_rfq"
  | "vendor_out_of_stock"
  | "price_changed"
  | "delivery_delayed"
  | "failed_delivery"
  | "customer_complaint"
  | "document_missing"
  | "payment_overdue"
  | "vendor_rejected"
  | "pod_pending_review"
  | "vendor_no_response"
  | "customer_reject"
  | "damaged_goods"
  | "missing_goods"
  | "pricing_dispute"
  | "delivery_failed"
  | "payment_issue";

export type ExceptionSeverity = "low" | "medium" | "high" | "critical";

export interface CreateExceptionParams {
  companyId?: number | null;
  exceptionType: ExceptionType;
  severity?: ExceptionSeverity;
  title: string;
  description?: string | null;
  refType?: string | null;
  refId?: string | null;
  refNumber?: string | null;
  customerName?: string | null;
  supplierName?: string | null;
  createdBy?: string | null;
}

export interface CreateExceptionResult {
  ok: boolean;
  id?: number;
  skipped?: boolean;
  error?: string;
}

// ── Boot migration ────────────────────────────────────────────────────────────

/**
 * Tambahkan nilai enum baru ke PostgreSQL.
 * Idempotent — tidak throw jika nilai sudah ada.
 * Harus dipanggil sekali saat server start (dari index.ts atau app.ts).
 */
export async function runExceptionEnumMigration(): Promise<void> {
  try {
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exception_type')
        AND NOT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'exception_type' AND e.enumlabel = 'vendor_rejected'
        ) THEN
          ALTER TYPE exception_type ADD VALUE 'vendor_rejected';
        END IF;
      END $$;
    `);

    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exception_type')
        AND NOT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON e.enumtypid = t.oid
          WHERE t.typname = 'exception_type' AND e.enumlabel = 'pod_pending_review'
        ) THEN
          ALTER TYPE exception_type ADD VALUE 'pod_pending_review';
        END IF;
      END $$;
    `);

    logger.debug("exceptionService: enum migration complete");
  } catch (err) {
    logger.warn({ err }, "exceptionService: enum migration failed — non-fatal");
  }
}

/**
 * FASE 6E — Order Exception Management migration.
 * Tambah kolom + enum values baru ke tabel exceptions.
 * Idempotent (IF NOT EXISTS).
 */
export async function runOrderExceptionsMigration(): Promise<void> {
  try {
    // Kolom baru di exceptions
    await db.execute(sql`
      ALTER TABLE exceptions
        ADD COLUMN IF NOT EXISTS reported_by_type TEXT,
        ADD COLUMN IF NOT EXISTS reported_by_id   TEXT,
        ADD COLUMN IF NOT EXISTS attachments       JSONB
    `);

    // Enum values baru: exception_type
    // DO $$ block tidak mendukung parameterized query — gunakan sql.raw
    const newExcTypes = [
      "vendor_no_response",
      "customer_reject",
      "damaged_goods",
      "missing_goods",
      "pricing_dispute",
      "delivery_failed",
      "payment_issue",
    ];
    for (const v of newExcTypes) {
      await db.execute(
        sql.raw(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exception_type')
            AND NOT EXISTS (
              SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
              WHERE t.typname = 'exception_type' AND e.enumlabel = '${v}'
            ) THEN
              ALTER TYPE exception_type ADD VALUE '${v}';
            END IF;
          END $$;
        `)
      );
    }

    // Enum values baru: exception_status
    const newStatuses = ["investigating", "rejected"];
    for (const v of newStatuses) {
      await db.execute(
        sql.raw(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'exception_status')
            AND NOT EXISTS (
              SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
              WHERE t.typname = 'exception_status' AND e.enumlabel = '${v}'
            ) THEN
              ALTER TYPE exception_status ADD VALUE '${v}';
            END IF;
          END $$;
        `)
      );
    }

    logger.info("Order exceptions migration: selesai");
  } catch (err) {
    logger.warn({ err }, "runOrderExceptionsMigration failed — non-fatal");
  }
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Insert exception secara idempotent.
 *
 * Jika kombinasi (refType, refId, exceptionType) sudah ada dengan status
 * 'open' atau 'in_progress', INSERT dilewati.
 *
 * Non-fatal: error tidak dilempar ke caller, di-log sebagai warning.
 */
export async function createExceptionIdempotent(
  params: CreateExceptionParams,
): Promise<CreateExceptionResult> {
  try {
    // Idempotency check — hanya jika refType + refId tersedia
    if (params.refType && params.refId) {
      const conditions = [
        eq(exceptionsTable.exceptionType, params.exceptionType as never),
        eq(exceptionsTable.refType, params.refType),
        eq(exceptionsTable.refId, params.refId),
        inArray(exceptionsTable.status, ["open", "in_progress"]),
      ];
      if (params.companyId != null) {
        conditions.push(eq(exceptionsTable.companyId, params.companyId));
      }

      const [existing] = await db
        .select({ id: exceptionsTable.id })
        .from(exceptionsTable)
        .where(and(...conditions))
        .limit(1);

      if (existing) {
        return { ok: true, id: existing.id, skipped: true };
      }
    }

    const [created] = await db
      .insert(exceptionsTable)
      .values({
        companyId: params.companyId ?? null,
        exceptionType: params.exceptionType as never,
        severity: params.severity ?? "medium",
        status: "open",
        title: params.title,
        description: params.description ?? null,
        refType: params.refType ?? null,
        refId: params.refId ?? null,
        refNumber: params.refNumber ?? null,
        customerName: params.customerName ?? null,
        supplierName: params.supplierName ?? null,
        createdBy: params.createdBy ?? "system",
      })
      .returning({ id: exceptionsTable.id });

    logger.info(
      {
        id: created?.id,
        exceptionType: params.exceptionType,
        refType: params.refType,
        refId: params.refId,
      },
      "exceptionService: exception created",
    );

    return { ok: true, id: created?.id, skipped: false };
  } catch (err) {
    logger.warn({ err, params }, "exceptionService: createExceptionIdempotent failed — non-fatal");
    return { ok: false, error: String(err) };
  }
}
