/**
 * NotificationService
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized in-app notification service.
 *
 * Channels:
 *   - admin_in_app  → saves to admin_notifications + broadcasts via SSE (broadcastToAdmins)
 *   - vendor_in_app → saves to vendor_notifications (per-vendor, fetched by portal)
 *
 * Extensible for later:
 *   - email  → plug in SMTP/SES here
 *   - push   → plug in FCM/APNS here
 */

import { saveAndBroadcast as _saveAndBroadcast, type AdminNotifPayload, saveVendorNotification } from "../notificationStore.js";
import { broadcastToAdmins } from "../sseManager.js";

export type { AdminNotifPayload };

export interface InAppNotifPayload extends AdminNotifPayload {
  title?: string;
  body?: string;
  targetRole?: "admin" | "vendor" | "all";
}

export class NotificationService {
  /**
   * Save to admin_notifications + SSE broadcast.
   * Non-throwing.
   */
  static async saveAndBroadcast(
    sseEvent: string,
    payload: InAppNotifPayload,
  ): Promise<void> {
    await _saveAndBroadcast(sseEvent, payload).catch((e: unknown) => {
      console.error("[NotificationService] saveAndBroadcast failed:", e);
    });
  }

  static async save(
    sseEvent: string,
    payload: InAppNotifPayload,
  ): Promise<void> {
    await _saveAndBroadcast(sseEvent, payload).catch((e: unknown) => {
      console.error("[NotificationService] save failed:", e);
    });
  }

  static broadcast(sseEvent: string, payload: InAppNotifPayload): void {
    try {
      broadcastToAdmins(sseEvent, payload);
    } catch (e) {
      console.error("[NotificationService] broadcast failed:", e);
    }
  }

  // ── Admin convenience methods (unchanged) ──────────────────────────────────

  static async notifyVendorApproved(opts: {
    supplierId: number;
    supplierName: string;
    customerId: number;
    submissionLinkUrl: string;
    waNotificationSent: boolean;
    reviewedBy: string;
  }): Promise<void> {
    await NotificationService.saveAndBroadcast("admin_notification", {
      type:         "vendor_approved",
      orderNumber:  String(opts.supplierId),
      customerName: opts.supplierName,
      title:        "Vendor Disetujui",
      body:         `${opts.supplierName} telah diverifikasi dan link submission dikirim.`,
      targetRole:   "admin",
      supplierId:         opts.supplierId,
      customerId:         opts.customerId,
      submissionLinkUrl:  opts.submissionLinkUrl,
      waNotificationSent: opts.waNotificationSent,
      reviewedBy:         opts.reviewedBy,
    });
  }

  static async notifyProductApproved(opts: {
    supplierId: number;
    vendorName: string;
    productName: string;
    catalogItemId: number;
  }): Promise<void> {
    await NotificationService.saveAndBroadcast("admin_notification", {
      type:         "vendor_product_approved",
      orderNumber:  String(opts.catalogItemId),
      customerName: opts.vendorName,
      title:        "Produk Disetujui",
      body:         `"${opts.productName}" dari ${opts.vendorName} telah dipublikasikan.`,
      targetRole:   "admin",
      supplierId:    opts.supplierId,
      productName:   opts.productName,
      catalogItemId: opts.catalogItemId,
    });
  }

  static async notifyProductRejected(opts: {
    supplierId: number;
    vendorName: string;
    productName: string;
    catalogItemId: number;
    reviewNotes: string | null;
  }): Promise<void> {
    await NotificationService.saveAndBroadcast("admin_notification", {
      type:         "vendor_product_rejected",
      orderNumber:  String(opts.catalogItemId),
      customerName: opts.vendorName,
      title:        "Produk Ditolak",
      body:         `"${opts.productName}" dari ${opts.vendorName} ditolak.`,
      targetRole:   "admin",
      supplierId:    opts.supplierId,
      productName:   opts.productName,
      catalogItemId: opts.catalogItemId,
      reviewNotes:   opts.reviewNotes ?? null,
    });
  }

  // ── Vendor convenience methods (write to vendor_notifications) ─────────────

  /**
   * Notify vendor that their account has been approved.
   * Call this OUTSIDE any DB transaction (it is non-blocking / fire-and-forget).
   */
  static async notifyVendorApprovedForVendor(opts: {
    vendorId: number;
    supplierName: string;
    submissionLinkUrl: string;
  }): Promise<void> {
    await saveVendorNotification({
      vendorId: opts.vendorId,
      type:     "vendor_approved",
      title:    "✅ Akun Vendor Anda Disetujui",
      message:  `Selamat! Akun vendor ${opts.supplierName} telah diverifikasi. Silakan upload katalog produk/layanan melalui link yang dikirim via WhatsApp.`,
      payload:  { submissionLinkUrl: opts.submissionLinkUrl },
    }).catch((e: unknown) => console.error("[NotificationService] notifyVendorApprovedForVendor failed:", e));
  }

  /**
   * Notify vendor that their product has been approved.
   */
  static async notifyProductApprovedForVendor(opts: {
    vendorId: number;
    productName: string;
    catalogItemId: number;
  }): Promise<void> {
    await saveVendorNotification({
      vendorId: opts.vendorId,
      type:     "product_approved",
      title:    "🎉 Produk Berhasil Dipublikasikan",
      message:  `Produk "${opts.productName}" Anda telah disetujui dan kini tersedia di marketplace.`,
      payload:  { catalogItemId: opts.catalogItemId, productName: opts.productName },
    }).catch((e: unknown) => console.error("[NotificationService] notifyProductApprovedForVendor failed:", e));
  }

  /**
   * Notify vendor that their product has been rejected.
   */
  static async notifyProductRejectedForVendor(opts: {
    vendorId: number;
    productName: string;
    catalogItemId: number;
    reviewNotes: string | null;
  }): Promise<void> {
    await saveVendorNotification({
      vendorId: opts.vendorId,
      type:     "product_rejected",
      title:    "❌ Produk Ditolak",
      message:  `Produk "${opts.productName}" tidak dapat disetujui. Alasan: ${opts.reviewNotes ?? "Tidak memenuhi persyaratan katalog"}`,
      payload:  { catalogItemId: opts.catalogItemId, productName: opts.productName, reviewNotes: opts.reviewNotes },
    }).catch((e: unknown) => console.error("[NotificationService] notifyProductRejectedForVendor failed:", e));
  }
}
