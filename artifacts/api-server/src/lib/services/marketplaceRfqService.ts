/**
 * marketplaceRfqService — Phase 2A + 2A.1 + 2B + 2B.1
 *
 * Phase 2A:   menulis ke mkt_rfqs + mkt_rfq_lines saat flag aktif (dual-write).
 * Phase 2A.1: setiap percobaan dicatat ke mkt_dual_write_log melalui
 *             dualWriteReliabilityService — status: pending → success | failed.
 * Phase 2B:   Buyer Identity — RFQ dari logged-in portal customer di-link ke
 *             portal_customers.id via mkt_rfqs.portal_customer_id.
 *             Guest RFQ tetap portal_customer_id = NULL + guestToken = generated.
 *             Logged-in RFQ: guestToken = NULL, buyer data di-enriched dari DB.
 *             Activity log: mkt_rfq_buyer_linked saat portalCustomerId tersedia.
 * Phase 2B.1: Buyer Organization — mkt_rfqs.company_id, buyer_role, buyer_department,
 *             buyer_cost_center, buyer_approval_level di-snapshot dari
 *             portal_company_members saat RFQ dibuat.
 *             Caller (portal.ts) melakukan membership lookup dan meneruskan context
 *             ke options — service hanya menyimpannya tanpa join tambahan.
 *
 * Design contract:
 * - Hanya menulis ke tabel mkt_*.
 * - Legacy portal_product_orders tetap ditulis oleh caller (portal.ts).
 * - Jika flag false, caller tidak memanggil service ini sama sekali.
 * - logActivity() dipanggil di LUAR transaksi (non-fatal, fire-and-forget).
 *
 * Feature flag: FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE
 *   env var "true"/"1" → new pipeline aktif
 *   semua nilai lain (termasuk tidak ada) → legacy path
 *
 * rfq_number format: MKT-RFQ-YYYYMM-XXXX
 *   XXXX = zero-padded mkt_rfqs.id (serial PK).
 *   Insert dengan temp UUID-based rfq_number → ambil serial id → update ke number final.
 *   Dijamin unik. Prefix bulanan berdasarkan waktu pembuatan.
 *
 * Concurrency safety:
 *   Tiga mutasi DB (header insert, number update, line insert) berjalan dalam
 *   satu DB transaction. Jika ada langkah yang gagal, seluruh RFQ di-rollback —
 *   tidak ada orphan header atau stale temp number.
 *   Activity logging berjalan DI LUAR transaksi (non-fatal, fire-and-forget).
 *
 * Phase 2A.1 — Dual Write Reliability:
 *   createDualWriteLog() dipanggil sebelum transaksi → menghasilkan logId.
 *   Jika transaksi berhasil → markDualWriteSuccess(logId).
 *   Jika transaksi gagal → markDualWriteFailed(logId, error) → rethrow.
 *   linkMktRfqToLegacy() memanggil linkLegacyOrder(mktRfqId, ...) untuk
 *   menambahkan portal_order reference ke log entry.
 *   Semua panggilan reliability service bersifat fire-and-forget (non-fatal).
 */

import { randomUUID } from "crypto";
import { hashToken } from "../tokenUtils.js";
import { db, mktRfqsTable, mktRfqLinesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAppConfig } from "../appConfig.js";
import { logActivity } from "../activityLog.js";
import { logger } from "../logger.js";
import {
  createDualWriteLog,
  markDualWriteSuccess,
  markDualWriteFailed,
  linkLegacyOrder,
} from "./dualWriteReliabilityService.js";
import { initApprovalFlow } from "./rfqApprovalService.js";

// ── Feature flag ──────────────────────────────────────────────────────────────

export async function isMarketplaceNewPipelineEnabled(): Promise<boolean> {
  const val = await getAppConfig("FEATURE_FLAG_MARKETPLACE_NEW_PIPELINE", "false");
  return val === "true" || val === "1";
}

// ── Catalog item snapshot — minimal shape needed by the service ───────────────
// Matches fields returned by getCatalogItemPublic() in portal.ts.
// priceSell is string | null coming from Drizzle numeric column.
export interface CatalogItemSnapshot {
  id: number;
  vendorId: number;
  vendorName: string | null;
  name: string;
  description: string | null;
  unit: string | null;
  priceSell: string | number | null; // Drizzle numeric returns string; getCatalogItemPublic converts to number
  currency: string;
  categoryKey: string | null;
  serviceType: string | null;
  kategori: string | null;
  templateKind: string | null;
  templateId: string | null;
  templateVersion: string | null;
  specValues: unknown;
}

// ── Input / output types ──────────────────────────────────────────────────────

export interface CreateMktRfqOptions {
  catalogItem: CatalogItemSnapshot;

  // Buyer info
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerCompany?: string | null;

  // Phase 2B — Buyer Identity: logged-in portal_customers.id → set portalCustomerId; guest → null
  // Jika portalCustomerId tersedia: guestToken tidak dibuat.
  portalCustomerId?: number | null;

  // Phase 2B.1 — Buyer Organization: diselesaikan oleh caller dari portal_company_members.
  // Semua field nullable — diisi jika ada mapping, null jika guest atau belum mapped.
  companyId?: number | null;          // FK ke companies.id — terisi jika ada membership aktif
  buyerRole?: string | null;          // snapshot: requester | procurement | finance | admin | viewer
  buyerDepartment?: string | null;    // snapshot department dari membership
  buyerCostCenter?: string | null;    // snapshot cost center dari membership
  buyerApprovalLevel?: number | null; // snapshot approval level (fondasi approval chain)

  // Line item
  qty?: number | null;
  unit?: string | null;             // override catalog unit
  notes?: string | null;
  shippingAddress?: string | null;
  requiredDeliveryDate?: string | null; // ISO date string YYYY-MM-DD

  // Audit
  ipAddress?: string | null;
}

export interface CreateMktRfqResult {
  rfqId: number;
  rfqNumber: string;
}

// ── rfq_number builder ────────────────────────────────────────────────────────

function buildRfqNumber(id: number): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const seq = String(id).padStart(4, "0"); // grows beyond 9999 naturally (id 10000 → "10000")
  return `MKT-RFQ-${yyyy}${mm}-${seq}`;
}

// ── Guest token ───────────────────────────────────────────────────────────────

function generateGuestToken(): string {
  // 32-char hex token, URL-safe
  return randomUUID().replace(/-/g, "");
}

// ── Core service: create mkt_rfqs + mkt_rfq_lines (in one transaction) ────────

/**
 * createMktRfqEntry — inserts one mkt_rfqs row + one mkt_rfq_lines row dalam
 * satu DB transaction, dengan dual-write logging via Phase 2A.1 reliability layer.
 *
 * Phase 2A.1 — Reliability tracking:
 *   1. createDualWriteLog(opts) → logId     (sebelum transaksi)
 *   2. [tx success] markDualWriteSuccess(logId, rfqId, rfqNumber)
 *   3. [tx fail]    markDualWriteFailed(logId, errMsg) → rethrow
 *   Semua reliability calls bersifat fire-and-forget (non-fatal).
 *
 * rfq_number generation (collision-safe, inside tx):
 *   1. INSERT dengan temp rfq_number = UUID-based string (globally unique).
 *   2. UPDATE rfq_number ke MKT-RFQ-YYYYMM-<id padded to 4> dari serial id.
 *   3. INSERT mkt_rfq_lines.
 *   Jika ada step yang throw, transaksi di-rollback — tidak ada orphan row.
 *
 * Activity logging berjalan SETELAH transaksi commit (di luar tx, non-fatal).
 *
 * Returns { rfqId, rfqNumber }.
 * Throws on DB error — caller wraps in try/catch dengan non-fatal fallback.
 */
export async function createMktRfqEntry(opts: CreateMktRfqOptions): Promise<CreateMktRfqResult> {
  const { catalogItem } = opts;
  const qtyNum = Math.max(1, Number(opts.qty ?? 1) || 1);
  const unitStr = opts.unit?.trim() || catalogItem.unit || "unit";

  // Phase 2B: guest = no company_id AND no portal_customer_id
  const isGuest = !opts.companyId && !opts.portalCustomerId;
  const guestToken = isGuest ? generateGuestToken() : null;
  // Phase 1B token security: store HMAC-SHA256 hash; raw token only sent to client
  const guestTokenHash = guestToken ? hashToken(guestToken) : null;
  const guestTokenExpiresAt = guestToken ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;

  // Phase 2F: Buyer Approval Flow
  // needsApproval si buyer punya approval_level >= 2 DAN terkait company.
  // Jika needsApproval → status = 'draft', approvalStatus = 'pending' (admin tidak bisa lihat dulu).
  // Jika tidak → status = 'submitted', approvalStatus = 'none' (behavior lama).
  const needsApproval = (opts.buyerApprovalLevel ?? 0) >= 2 && !!opts.companyId;

  // UUID-based temp number — globally unique, safe under any concurrency
  const tempNumber = `MKT-RFQ-TEMP-${randomUUID()}`;

  // ── Phase 2A.2: create pending log BEFORE transaction ─────────────────────
  // Menggunakan CreateDualWriteLogOpts — kolom terstruktur diisi di sini.
  // Non-fatal: jika createDualWriteLog gagal, logId = 0 (skip reliability tracking)
  const logId = await createDualWriteLog({
    catalogItemId:   catalogItem.id,
    buyerName:       opts.buyerName.trim(),
    buyerEmail:      opts.buyerEmail.trim().toLowerCase(),
    buyerCompany:    opts.buyerCompany?.trim() ?? undefined,
    qty:             qtyNum,
    unit:            unitStr,
    shippingAddress: opts.shippingAddress?.trim() ?? undefined,
    payload:         opts as unknown as Record<string, unknown>,
  }).catch(() => 0);

  // ── Single transaction: header insert + number update + line insert ────────
  let rfqId: number;
  let rfqNumber: string;

  try {
    await db.transaction(async (tx) => {
      // 1. Insert header dengan temp rfq_number
      const [rfq] = await tx
        .insert(mktRfqsTable)
        .values({
          rfqNumber: tempNumber,
          companyId:        opts.companyId ?? null,          // Phase 2B.1: terisi jika ada membership
          portalCustomerId: opts.portalCustomerId ?? null,   // Phase 2B
          catalogVendorId:  catalogItem.vendorId,
          buyerName:    opts.buyerName.trim(),
          buyerEmail:   opts.buyerEmail.trim().toLowerCase(),
          buyerPhone:   opts.buyerPhone.trim(),
          buyerCompany: opts.buyerCompany?.trim() ?? null,
          // Phase 2B.1 — snapshot dari portal_company_members (immutable audit trail)
          buyerRole:          opts.buyerRole ?? null,
          buyerDepartment:    opts.buyerDepartment ?? null,
          buyerCostCenter:    opts.buyerCostCenter ?? null,
          buyerApprovalLevel: opts.buyerApprovalLevel ?? null,
          guestToken,
          guestTokenHash,
          guestTokenExpiresAt,
          // Phase 2F: conditional initial status based on buyer approval_level
          status: needsApproval ? "draft" : "submitted",
          approvalStatus: needsApproval ? "pending" : "none",
          priority: "normal",
          requiredDeliveryDate: opts.requiredDeliveryDate ?? null,
          deliveryAddress: opts.shippingAddress?.trim() ?? null,
          notes: opts.notes?.trim() ?? null,
          emailVerified: false,
          lineCount: 1,
          quoteCount: 0,
        })
        .returning({ id: mktRfqsTable.id });

      rfqId = rfq.id;

      // 2. Compute final rfq_number dari serial id dan update dalam tx yang sama
      rfqNumber = buildRfqNumber(rfqId);
      await tx
        .update(mktRfqsTable)
        .set({ rfqNumber })
        .where(eq(mktRfqsTable.id, rfqId));

      // 3. Insert mkt_rfq_lines — snapshot katalog item
      await tx.insert(mktRfqLinesTable).values({
        rfqId,
        vendorCatalogItemId: catalogItem.id,
        itemName: catalogItem.name,
        itemDescription: catalogItem.description ?? null,
        itemUnit: unitStr,
        requestedQty: String(qtyNum),
        // targetPricePerUnit — priceSell dari katalog, referensi budget buyer
        // Drizzle numeric column membutuhkan string; convert number→string jika perlu
        targetPricePerUnit: catalogItem.priceSell != null ? String(catalogItem.priceSell) : null,
        notes: null,
        sortOrder: 0,
      });
    });

    // ── Phase 2A.1: mark success (fire-and-forget) ─────────────────────────
    markDualWriteSuccess(logId, rfqId!, rfqNumber!).catch(() => {});

    // ── Phase 2F: init approval flow jika diperlukan (non-fatal, log error) ─
    if (needsApproval) {
      initApprovalFlow(rfqId!, rfqNumber!, opts.companyId!, opts.buyerApprovalLevel!).catch(async (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ err, rfqId, rfqNumber }, "[marketplaceRfq] initApprovalFlow gagal (non-fatal — RFQ tetap tersimpan)");
        await logActivity({
          mktRfqId:  rfqId ?? null,
          actorType: "system",
          action:    "mkt_approval_init_failed",
          description: `initApprovalFlow gagal untuk RFQ ${rfqNumber ?? rfqId}: ${errMsg.slice(0, 200)}`,
          newValue:  { rfqId, rfqNumber, companyId: opts.companyId, approvalLevel: opts.buyerApprovalLevel, error: errMsg.slice(0, 500) },
        });
      });
    }

  } catch (txErr: unknown) {
    // ── Phase 2A.1: mark failed (fire-and-forget) lalu rethrow ───────────
    const errMsg = txErr instanceof Error ? txErr.message : String(txErr);
    markDualWriteFailed(logId, errMsg).catch(() => {});
    throw txErr; // caller (portal.ts) harus tetap handle fallback
  }

  // ── Activity log DI LUAR transaksi (non-fatal) ─────────────────────────────
  await logActivity({
    mktRfqId: rfqId!,
    actorType: (opts.companyId ?? opts.portalCustomerId) ? "customer" : "system",
    actorId: opts.companyId
      ? String(opts.companyId)
      : opts.portalCustomerId
        ? String(opts.portalCustomerId)
        : null,
    actorName: opts.buyerName,
    action: "mkt_rfq_created",
    description: `RFQ ${rfqNumber!} dibuat untuk item: ${catalogItem.name} (qty: ${qtyNum} ${unitStr})`,
    newValue: {
      rfqId: rfqId!,
      rfqNumber: rfqNumber!,
      catalogItemId: catalogItem.id,
      catalogItemName: catalogItem.name,
      buyerEmail: opts.buyerEmail,
      qty: qtyNum,
      isGuest,
      portalCustomerId:   opts.portalCustomerId ?? null,
      companyId:          opts.companyId ?? null,
      buyerRole:          opts.buyerRole ?? null,
      buyerDepartment:    opts.buyerDepartment ?? null,
      buyerCostCenter:    opts.buyerCostCenter ?? null,
      buyerApprovalLevel: opts.buyerApprovalLevel ?? null,
      dualWriteLogId: logId || undefined,
    },
    ipAddress: opts.ipAddress ?? null,
  });

  // Phase 2B — log buyer identity link when logged-in customer is resolved
  if (opts.portalCustomerId) {
    await logActivity({
      mktRfqId: rfqId!,
      actorType: "system",
      actorId: String(opts.portalCustomerId),
      actorName: opts.buyerName,
      action: "mkt_rfq_buyer_linked",
      description: `Buyer identity linked: portal_customer_id=${opts.portalCustomerId} (${opts.buyerEmail}) → RFQ ${rfqNumber!}`,
      newValue: {
        rfqId: rfqId!,
        rfqNumber: rfqNumber!,
        portalCustomerId: opts.portalCustomerId,
        buyerEmail: opts.buyerEmail,
        buyerName: opts.buyerName,
        buyerCompany: opts.buyerCompany ?? null,
        isLoggedIn: true,
        // Phase 2B.1 — company mapping context
        companyId:          opts.companyId ?? null,
        buyerRole:          opts.buyerRole ?? null,
        buyerDepartment:    opts.buyerDepartment ?? null,
        buyerCostCenter:    opts.buyerCostCenter ?? null,
        buyerApprovalLevel: opts.buyerApprovalLevel ?? null,
        hasCompanyMapping:  !!opts.companyId,
      },
      ipAddress: opts.ipAddress ?? null,
    });
  }

  logger.info(
    { rfqId: rfqId!, rfqNumber: rfqNumber!, dualWriteLogId: logId },
    "[marketplaceRfq] mkt_rfq created (transaction committed)",
  );

  return { rfqId: rfqId!, rfqNumber: rfqNumber! };
}

// ── Backlink: record legacy order id setelah dual-write ──────────────────────

/**
 * linkMktRfqToLegacy — log cross-reference event agar kedua pipeline bisa
 * di-audit dari timeline yang sama.
 *
 * Phase 2A.1: Juga update mkt_dual_write_log via linkLegacyOrder() agar
 * entry di log table punya portal_order_id dan berstatus 'linked'.
 *
 * Non-fatal: tidak pernah throw.
 */
export async function linkMktRfqToLegacy(
  rfqId: number,
  rfqNumber: string,
  legacyOrderId: number,
  legacyOrderNumber: string,
): Promise<void> {
  // Phase 2A.1 — update dual-write log dengan portal_order reference
  linkLegacyOrder(rfqId, legacyOrderId, legacyOrderNumber).catch(() => {});

  await logActivity({
    mktRfqId: rfqId,
    actorType: "system",
    action: "mkt_rfq_dual_write_linked",
    description: `Dual-write: ${rfqNumber} linked ke legacy order ${legacyOrderNumber} (id ${legacyOrderId})`,
    newValue: {
      rfqId,
      rfqNumber,
      legacyOrderId,
      legacyOrderNumber,
      pipeline: "dual_write_phase2a",
    },
  });

  logger.info(
    { rfqId, rfqNumber, legacyOrderId, legacyOrderNumber },
    "[marketplaceRfq] dual-write backlink logged",
  );
}

// ── Public alias — Phase 2A spec name ────────────────────────────────────────
// Spec requires createRfqFromMarketplaceItem(); implementation lives in
// createMktRfqEntry() above. Keduanya di-export agar caller existing
// di portal.ts tidak perlu diubah, sementara code baru bisa pakai nama spec.
export const createRfqFromMarketplaceItem = createMktRfqEntry;
