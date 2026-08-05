/**
 * rfqStatusService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH untuk perubahan:
 *   - logistic_order_rfqs.status   (RFQ header)
 *   - rfq_vendor_links.status      (per-vendor response links)
 *
 * FASE 1 — Service layer tersedia. Route lama BELUM dimigrasikan.
 * FASE 2 — logisticRfqV2.ts, vendorResponse.ts, workflowWorker.ts wajib
 *           memanggil service ini daripada update DB langsung.
 *
 * Catatan:
 *  - logistic_order_rfqs TIDAK memiliki kolom updatedAt — hanya createdAt.
 *  - rfq_vendor_links memiliki lastUpdatedAt.
 *  - logisticRfq.ts (V1/legacy) harus dimigrasikan ke V2 di Fase 2.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db } from "@workspace/db";
import { logisticOrderRfqsTable, rfqVendorLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";
import { writeAuditLog } from "../auditLog.js";

// ── RFQ Header State Machine ──────────────────────────────────────────────────
//
// Mengikuti V2 vocabulary (logisticRfqV2.ts).
// V1 vocabulary (logisticRfq.ts) harus dimapping ke V2 sebelum memanggil service.
//
export const RFQ_VALID_TRANSITIONS: Record<string, string[]> = {
  "admin_review":                ["vendor_blasted", "closed", "expired"],
  "vendor_blasted":              ["Quote Received", "vendor_selected", "closed", "expired"],
  "Quote Received":              ["vendor_selected", "vendor_blasted", "closed", "expired"],
  "vendor_selected":             ["customer_quoted", "closed", "expired"],
  "customer_quoted":             ["closed", "expired", "customer_approved", "customer_revision_requested", "customer_rejected"],
  "customer_approved":           ["closed", "expired"],
  "customer_revision_requested": ["closed", "expired", "customer_quoted"],
  "customer_rejected":           ["closed", "expired"],
  "closed":                      [],
  "expired":                     [],
};

// ── Vendor Link State Machine ─────────────────────────────────────────────────
//
// Status: waiting_response | accepted_basic_price | counter_offer | rejected
//         expired | selected | not_selected | late_response
//
export const VENDOR_LINK_VALID_TRANSITIONS: Record<string, string[]> = {
  "waiting_response":     ["accepted_basic_price", "counter_offer", "rejected", "expired", "late_response"],
  "accepted_basic_price": ["selected", "not_selected", "counter_offer", "expired"],
  "counter_offer":        ["selected", "not_selected", "accepted_basic_price", "expired"],
  "rejected":             ["selected"],
  "late_response":        ["selected", "not_selected", "rejected", "expired"],
  "selected":             [],
  "not_selected":         [],
  "expired":              ["late_response"],
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RfqTransitionOptions {
  actorType?: "admin" | "vendor" | "customer" | "driver" | "system";
  actorId?: string | null;
  actorName?: string | null;
  source?: string;
  /**
   * force=true bypassa state machine.
   * Hanya untuk admin super / script migrasi.
   * WAJIB disertai forceReason — tanpa alasan, force akan dicatat sebagai audit warning.
   */
  force?: boolean;
  /** Alasan menggunakan force bypass. Wajib jika force=true. */
  forceReason?: string;
}

export interface RfqTransitionResult {
  ok: boolean;
  rfqId?: number;
  vendorLinkId?: number;
  fromStatus?: string | null;
  toStatus?: string;
  alreadyAt?: boolean;
  allowedTransitions?: string[];
  error?: string;
}

// ── RFQ Header ────────────────────────────────────────────────────────────────

/**
 * Transisi status RFQ header (logistic_order_rfqs.status).
 */
export async function transitionRfqStatus(
  rfqId: number,
  newStatus: string,
  opts: RfqTransitionOptions = {},
): Promise<RfqTransitionResult> {
  if (!(newStatus in RFQ_VALID_TRANSITIONS)) {
    return { ok: false, rfqId, error: `RFQ status "${newStatus}" tidak dikenal` };
  }

  const [row] = await db
    .select({ status: logisticOrderRfqsTable.status })
    .from(logisticOrderRfqsTable)
    .where(eq(logisticOrderRfqsTable.id, rfqId));

  if (!row) {
    return { ok: false, rfqId, error: `RFQ #${rfqId} tidak ditemukan` };
  }

  if (row.status === newStatus) {
    return { ok: true, rfqId, fromStatus: row.status, toStatus: newStatus, alreadyAt: true };
  }

  // C3-REMEDIATION: force=true hanya diizinkan untuk admin/system actor.
  // Vendor dan customer tidak dapat membypass state machine meski route meneruskan force=true.
  const effectiveForce = opts.force === true && (opts.actorType === "admin" || opts.actorType === "system");
  if (!effectiveForce) {
    const allowed = RFQ_VALID_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(newStatus)) {
      return {
        ok: false,
        rfqId,
        fromStatus: row.status,
        toStatus: newStatus,
        allowedTransitions: allowed,
        error: `RFQ transisi "${row.status}" → "${newStatus}" tidak diizinkan`,
      };
    }
  }

  // ── C3 FIX: forceReason WAJIB; log force bypass ke audit trail ──────────────
  if (opts.force) {
    if (!opts.forceReason) {
      logger.error(
        { rfqId, from: row.status, to: newStatus, source: opts.source, actorType: opts.actorType },
        "[SECURITY] force=true tanpa forceReason — ditolak",
      );
      return {
        ok: false,
        rfqId,
        fromStatus: row.status,
        toStatus: newStatus,
        allowedTransitions: [],
        error: "force=true membutuhkan forceReason yang tidak kosong",
      };
    }
    writeAuditLog({
      action: "force_status_transition",
      module: "rfq_header",
      referenceId: String(rfqId),
      userId: opts.actorId ?? null,
      oldData: { status: row.status },
      newData: {
        status: newStatus,
        force: true,
        forceReason: opts.forceReason ?? "(tidak ada alasan)",
        actorType: opts.actorType ?? "system",
        source: opts.source ?? "service",
      },
    });
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // logisticOrderRfqsTable tidak punya updatedAt
  await db
    .update(logisticOrderRfqsTable)
    .set({ status: newStatus } as any)
    .where(eq(logisticOrderRfqsTable.id, rfqId));

  logger.info({ rfqId, from: row.status, to: newStatus, force: opts.force ?? false, source: opts.source ?? "service" }, "RFQ status transitioned");

  writeAuditLog({
    action: "status_transition",
    module: "rfq_header",
    referenceId: String(rfqId),
    userId: opts.actorId ?? null,
    oldData: { status: row.status },
    newData: { status: newStatus, actorType: opts.actorType ?? "system", source: opts.source ?? "service", actorName: opts.actorName ?? null },
  });

  return { ok: true, rfqId, fromStatus: row.status, toStatus: newStatus };
}

// ── Vendor Link ───────────────────────────────────────────────────────────────

/**
 * Transisi status vendor link (rfq_vendor_links.status).
 */
export async function transitionVendorLinkStatus(
  linkId: number,
  newStatus: string,
  opts: RfqTransitionOptions = {},
): Promise<RfqTransitionResult> {
  if (!(newStatus in VENDOR_LINK_VALID_TRANSITIONS)) {
    return { ok: false, vendorLinkId: linkId, error: `Vendor link status "${newStatus}" tidak dikenal` };
  }

  const [row] = await db
    .select({ status: rfqVendorLinksTable.status })
    .from(rfqVendorLinksTable)
    .where(eq(rfqVendorLinksTable.id, linkId));

  if (!row) {
    return { ok: false, vendorLinkId: linkId, error: `Vendor link #${linkId} tidak ditemukan` };
  }

  if (row.status === newStatus) {
    return { ok: true, vendorLinkId: linkId, fromStatus: row.status, toStatus: newStatus, alreadyAt: true };
  }

  // C3-REMEDIATION: force=true hanya diizinkan untuk admin/system actor.
  const effectiveForce = opts.force === true && (opts.actorType === "admin" || opts.actorType === "system");
  if (!effectiveForce) {
    const allowed = VENDOR_LINK_VALID_TRANSITIONS[row.status] ?? [];
    if (!allowed.includes(newStatus)) {
      return {
        ok: false,
        vendorLinkId: linkId,
        fromStatus: row.status,
        toStatus: newStatus,
        allowedTransitions: allowed,
        error: `Vendor link transisi "${row.status}" → "${newStatus}" tidak diizinkan`,
      };
    }
  }

  await db
    .update(rfqVendorLinksTable)
    .set({ status: newStatus, lastUpdatedAt: new Date() })
    .where(eq(rfqVendorLinksTable.id, linkId));

  logger.info({ linkId, from: row.status, to: newStatus, source: opts.source ?? "service" }, "vendorLink status transitioned");

  writeAuditLog({
    action: "status_transition",
    module: "rfq_vendor_link",
    referenceId: String(linkId),
    userId: opts.actorId ?? null,
    oldData: { status: row.status },
    newData: { status: newStatus, actorType: opts.actorType ?? "system", source: opts.source ?? "service", actorName: opts.actorName ?? null },
  });

  return { ok: true, vendorLinkId: linkId, fromStatus: row.status, toStatus: newStatus };
}

// ── Convenience Helpers ───────────────────────────────────────────────────────

/**
 * Expire vendor link — wrapper idempotent untuk workflowWorker.
 * Tidak throw jika sudah expired atau terminal (selected/not_selected).
 */
export async function expireVendorLink(linkId: number): Promise<RfqTransitionResult> {
  const result = await transitionVendorLinkStatus(linkId, "expired", {
    source: "workflowWorker:expire",
  });
  // Terminal states (selected/not_selected) tidak bisa di-expire — ok, bukan error
  if (!result.ok && result.allowedTransitions !== undefined && result.allowedTransitions.length === 0) {
    return { ...result, ok: true };
  }
  return result;
}

/**
 * Expire RFQ header — wrapper idempotent untuk workflowWorker.
 */
export async function expireRfq(rfqId: number): Promise<RfqTransitionResult> {
  return transitionRfqStatus(rfqId, "expired", { source: "workflowWorker:expire" });
}

/** Cek apakah transisi RFQ valid tanpa DB query. */
export function isRfqTransitionAllowed(from: string, to: string): boolean {
  return (RFQ_VALID_TRANSITIONS[from] ?? []).includes(to);
}

/** Cek apakah transisi vendor link valid tanpa DB query. */
export function isVendorLinkTransitionAllowed(from: string, to: string): boolean {
  return (VENDOR_LINK_VALID_TRANSITIONS[from] ?? []).includes(to);
}
