import { registerHeartbeat, beat } from "../workerHeartbeat.js";

/**
 * marketplaceNotificationWorker.ts — Phase 2E.1
 *
 * Background worker yang mem-poll mkt_notification_queue setiap 3 menit
 * dan mengirimkan WA notification untuk event marketplace:
 *   - mkt_vendor_invitation_notification  → WA invite vendor submit quote
 *   - mkt_vendor_winner_notification      → WA vendor menang
 *   - mkt_vendor_rejected_notification    → WA vendor tidak terpilih
 *
 * Setiap item di-retry sampai max_attempts, lalu status → 'exhausted'.
 * Activity log: mkt_notification_queued, mkt_notification_sent,
 *               mkt_notification_failed, mkt_notification_retrying, mkt_notification_exhausted
 *
 * Didaftarkan ke startupOrchestrator di index.ts dengan delay 160_000ms.
 *
 * P0-2: recoverStuckSendingRows dipanggil saat startup — reset stuck 'sending' rows
 * P0-3: Menggunakan fetchAndClaimNotifications (atomic UPDATE...RETURNING) —
 *        rows sudah di-mark 'sending' saat fetch; markSending() tidak dipanggil lagi.
 */

import { logger } from "../logger.js";
import { logActivity } from "../activityLog.js";
import {
  fetchAndClaimNotifications,
  recoverStuckSendingRows,
  markSent,
  markFailed,
  markRetrying,
  type NotifQueueRow,
} from "./marketplaceNotificationQueueService.js";

// ── Config ────────────────────────────────────────────────────────────────────

const WORKER_INTERVAL_MS      = 3 * 60 * 1000;   // 3 menit
// Catatan: startupOrchestrator sudah memberikan stagger delay 160s via registerWorker.
// Internal delay cukup kecil — hanya memberi waktu DB settle sebelum batch pertama.
const WORKER_INITIAL_DELAY_MS = 10_000;           // 10 detik setelah startFn dipanggil
const BATCH_SIZE              = 20;

// ── Guard ─────────────────────────────────────────────────────────────────────

let _workerRunning = false;

// ── Message builders ──────────────────────────────────────────────────────────

function buildInvitationMessage(payload: Record<string, unknown>): string {
  const rfqNumber       = String(payload["rfqNumber"] ?? "");
  const vendorName      = String(payload["vendorName"] ?? "Vendor");
  const rfqBuyerCompany = payload["rfqBuyerCompany"] ? String(payload["rfqBuyerCompany"]) : null;
  const rfqNotes        = payload["rfqNotes"] ? String(payload["rfqNotes"]) : null;
  const validUntil      = payload["validUntil"] ? String(payload["validUntil"]).split("T")[0] : null;

  const lines: string[] = [
    `📋 *Undangan RFQ / Request for Quotation*`,
    ``,
    `Halo ${vendorName},`,
    ``,
    `Anda diundang untuk mengajukan penawaran (quote) atas RFQ berikut:`,
    ``,
    `RFQ: *${rfqNumber}*`,
  ];

  if (rfqBuyerCompany) lines.push(`Pembeli: *${rfqBuyerCompany}*`);
  if (rfqNotes) lines.push(`Keterangan: ${rfqNotes}`);
  if (validUntil) lines.push(`Berlaku hingga: *${validUntil}*`);

  lines.push(
    ``,
    `Silakan login ke portal vendor kami untuk mengajukan penawaran.`,
    ``,
    `Terima kasih.`,
  );

  return lines.join("\n");
}

function buildWinnerMessage(payload: Record<string, unknown>): string {
  const rfqNumber   = String(payload["rfqNumber"] ?? "");
  const poNumber    = payload["poNumber"] ? String(payload["poNumber"]) : null;
  const totalAmount = payload["totalAmount"] ? String(payload["totalAmount"]) : null;

  const lines: string[] = [
    `✅ *Selamat! Quote Anda Dipilih*`,
    ``,
    `RFQ: *${rfqNumber}*`,
  ];

  if (poNumber)    lines.push(`PO Number: *${poNumber}*`);
  if (totalAmount) lines.push(`Total: *${totalAmount}*`);

  lines.push(
    ``,
    `Tim kami akan menghubungi Anda untuk koordinasi selanjutnya.`,
  );

  return lines.join("\n");
}

function buildRejectedMessage(payload: Record<string, unknown>): string {
  const rfqNumber = String(payload["rfqNumber"] ?? "");

  return [
    `Terima kasih telah berpartisipasi dalam RFQ *${rfqNumber}*.`,
    ``,
    `Kami mohon maaf, pada kali ini vendor lain terpilih.`,
    `Kami harap dapat bekerja sama di kesempatan berikutnya.`,
  ].join("\n");
}

// ── Featured Product / Produk Unggulan message builders ────────────────────

function buildFeaturedRequestSubmittedMessage(payload: Record<string, unknown>): string {
  const catalogItemName = String(payload["catalogItemName"] ?? "produk Anda");
  const packageName = String(payload["packageName"] ?? "");
  return [
    `📢 *Pengajuan Produk Unggulan Diterima*`,
    ``,
    `Pengajuan untuk menjadikan *${catalogItemName}* sebagai Produk Unggulan (paket: ${packageName}) telah kami terima dan sedang ditinjau oleh admin.`,
  ].join("\n");
}

function buildFeaturedApprovedMessage(payload: Record<string, unknown>, waived: boolean): string {
  const requestId = String(payload["requestId"] ?? "");
  if (waived) {
    return [
      `✅ *Pengajuan Produk Unggulan Disetujui*`,
      ``,
      `Pengajuan #${requestId} disetujui dan akan segera diaktifkan (biaya digratiskan admin).`,
    ].join("\n");
  }
  return [
    `✅ *Pengajuan Produk Unggulan Disetujui*`,
    ``,
    `Pengajuan #${requestId} disetujui. Silakan lakukan pembayaran dan unggah bukti pembayaran melalui portal vendor agar produk Anda segera diaktifkan.`,
  ].join("\n");
}

function buildFeaturedRejectedMessage(payload: Record<string, unknown>): string {
  const requestId = String(payload["requestId"] ?? "");
  const reason = payload["reason"] ? String(payload["reason"]) : null;
  const lines = [
    `❌ *Pengajuan Produk Unggulan Ditolak*`,
    ``,
    `Mohon maaf, pengajuan #${requestId} tidak dapat disetujui.`,
  ];
  if (reason) lines.push(`Alasan: ${reason}`);
  return lines.join("\n");
}

function buildFeaturedPaymentVerifiedMessage(): string {
  return [
    `💳 *Pembayaran Terverifikasi*`,
    ``,
    `Bukti pembayaran Anda telah diverifikasi. Produk Unggulan Anda akan segera diaktifkan oleh admin.`,
  ].join("\n");
}

function buildFeaturedPaymentRejectedMessage(payload: Record<string, unknown>): string {
  const reason = payload["reason"] ? String(payload["reason"]) : null;
  const lines = [
    `⚠️ *Bukti Pembayaran Ditolak*`,
    ``,
    `Bukti pembayaran yang Anda unggah tidak dapat diverifikasi. Silakan unggah ulang bukti pembayaran yang valid.`,
  ];
  if (reason) lines.push(`Catatan admin: ${reason}`);
  return lines.join("\n");
}

function buildFeaturedActivatedMessage(): string {
  return [
    `🌟 *Produk Unggulan Aktif!*`,
    ``,
    `Selamat! Produk Anda kini tampil sebagai Produk Unggulan di marketplace.`,
  ].join("\n");
}

function buildFeaturedCancelledMessage(payload: Record<string, unknown>): string {
  const reason = payload["reason"] ? String(payload["reason"]) : null;
  const lines = [`ℹ️ *Promosi Produk Unggulan Dihentikan*`, ``, `Promosi Produk Unggulan Anda telah dihentikan oleh admin.`];
  if (reason) lines.push(`Alasan: ${reason}`);
  return lines.join("\n");
}

function buildFeaturedExpiredMessage(): string {
  return [
    `⏰ *Masa Promosi Produk Unggulan Berakhir*`,
    ``,
    `Masa aktif Produk Unggulan Anda telah berakhir. Ajukan kembali promosi untuk tetap tampil di posisi unggulan.`,
  ].join("\n");
}

function buildFeaturedExpiringSoonMessage(payload: Record<string, unknown>): string {
  const expiresAt = payload["expiresAt"] ? String(payload["expiresAt"]).split("T")[0] : null;
  const lines = [`⏳ *Promosi Produk Unggulan Akan Segera Berakhir*`, ``, `Promosi Produk Unggulan Anda akan berakhir dalam waktu dekat.`];
  if (expiresAt) lines.push(`Tanggal berakhir: *${expiresAt}*`);
  lines.push(``, `Ajukan perpanjangan sebelum masa aktif berakhir agar produk Anda tetap tampil unggulan.`);
  return lines.join("\n");
}

// ── Sprint 1.1 bug-fix: buyer-facing RFQ quotation messages ─────────────────
// Events already enqueued elsewhere (mktAdmin.ts send-to-customer,
// mktPortal.ts customer-approve/customer-reject, rfqApprovalService.ts) but
// previously fell through to the JSON default — no readable WA message was
// ever sent. Added here only (no new event types, no queue schema changes).

function buildRfqVendorSelectedMessage(payload: Record<string, unknown>): string {
  const rfqNumber  = String(payload["rfqNumber"] ?? "");
  const vendorName = payload["vendorName"] ? String(payload["vendorName"]) : null;
  const notes      = payload["notes"] ? String(payload["notes"]) : null;

  const lines: string[] = [
    `📄 *Quotation Siap Untuk Ditinjau*`,
    ``,
    `RFQ: *${rfqNumber}*`,
  ];
  if (vendorName) lines.push(`Vendor: *${vendorName}*`);
  if (notes) lines.push(`Catatan: ${notes}`);
  lines.push(``, `Silakan login ke portal untuk meninjau dan menyetujui penawaran ini.`);
  return lines.join("\n");
}

function buildRfqApprovedMessage(payload: Record<string, unknown>): string {
  const rfqNumber = String(payload["rfqNumber"] ?? "");
  const poNumber  = payload["poNumber"] ? String(payload["poNumber"]) : null;

  // Two call sites share this event type: portal customer approving a
  // quotation (poNumber present) and an internal approver approving a draft
  // RFQ (poNumber absent). Message adapts to whichever payload is present.
  if (poNumber) {
    return [
      `✅ *Quotation Disetujui*`,
      ``,
      `RFQ: *${rfqNumber}*`,
      `PO Number: *${poNumber}*`,
      ``,
      `Terima kasih, Purchase Order telah dibuat.`,
    ].join("\n");
  }

  const approverName = payload["approverName"] ? String(payload["approverName"]) : null;
  const lines = [`✅ *RFQ Disetujui*`, ``, `RFQ: *${rfqNumber}*`];
  if (approverName) lines.push(`Disetujui oleh: ${approverName}`);
  lines.push(``, `RFQ Anda telah disetujui dan akan dilanjutkan ke tahap berikutnya.`);
  return lines.join("\n");
}

function buildRfqRejectedMessage(payload: Record<string, unknown>): string {
  const rfqNumber = String(payload["rfqNumber"] ?? "");
  const reason = payload["rejectionNotes"]
    ? String(payload["rejectionNotes"])
    : payload["reason"]
      ? String(payload["reason"])
      : null;

  const lines = [`❌ *Quotation Ditolak*`, ``, `RFQ: *${rfqNumber}*`];
  if (reason) lines.push(`Alasan: ${reason}`);
  lines.push(``, `Silakan hubungi tim kami untuk info lebih lanjut.`);
  return lines.join("\n");
}

export function buildMessage(item: NotifQueueRow): string {
  switch (item.eventType) {
    case "mkt_rfq_vendor_selected":
      return buildRfqVendorSelectedMessage(item.payloadJson);
    case "mkt_rfq_approved":
      return buildRfqApprovedMessage(item.payloadJson);
    case "mkt_rfq_rejected":
      return buildRfqRejectedMessage(item.payloadJson);
    case "mkt_vendor_invitation_notification":
      return buildInvitationMessage(item.payloadJson);
    case "mkt_vendor_winner_notification":
      return buildWinnerMessage(item.payloadJson);
    case "mkt_vendor_rejected_notification":
      return buildRejectedMessage(item.payloadJson);
    case "mkt_featured_request_submitted":
      return buildFeaturedRequestSubmittedMessage(item.payloadJson);
    case "mkt_featured_approved_awaiting_payment":
      return buildFeaturedApprovedMessage(item.payloadJson, false);
    case "mkt_featured_approved_waived":
      return buildFeaturedApprovedMessage(item.payloadJson, true);
    case "mkt_featured_rejected":
      return buildFeaturedRejectedMessage(item.payloadJson);
    case "mkt_featured_payment_verified":
      return buildFeaturedPaymentVerifiedMessage();
    case "mkt_featured_payment_rejected":
      return buildFeaturedPaymentRejectedMessage(item.payloadJson);
    case "mkt_featured_activated":
      return buildFeaturedActivatedMessage();
    case "mkt_featured_cancelled":
      return buildFeaturedCancelledMessage(item.payloadJson);
    case "mkt_featured_expired":
      return buildFeaturedExpiredMessage();
    case "mkt_featured_expiring_soon":
      return buildFeaturedExpiringSoonMessage(item.payloadJson);
    default:
      return JSON.stringify(item.payloadJson);
  }
}

// ── Core: proses satu notif item ──────────────────────────────────────────────

/**
 * processNotification — memproses satu item dari queue.
 *
 * P0-3: Rows sudah dalam status 'sending' saat diterima dari fetchAndClaimNotifications.
 *        markSending() tidak dipanggil lagi.
 *        Untuk retry, markRetrying() tetap dipanggil untuk tracking.
 */
async function processNotification(item: NotifQueueRow): Promise<void> {
  const { id, recipientPhone, rfqId, vendorQuoteId, purchaseOrderId, eventType, attemptCount, maxAttempts } = item;

  // Row sudah 'sending' (atomic claim di fetchAndClaimNotifications).
  // Untuk retry: ubah ke 'retrying' untuk tracking, log activity.
  const isRetry = attemptCount > 0;
  if (isRetry) {
    await markRetrying(id);
    void logActivity({
      mktRfqId:         rfqId,
      mktVendorQuoteId: vendorQuoteId,
      actorType:        "system",
      action:           "mkt_notification_retrying",
      description:      `Retry attempt ${attemptCount + 1}/${maxAttempts} untuk notif id=${id} (${eventType})`,
      newValue:         { queueId: id, attempt: attemptCount + 1, eventType },
    }).catch(() => {});
  }
  // Untuk attempt pertama: sudah 'sending' dari atomic claim, tidak perlu markSending().

  if (!recipientPhone) {
    // Tidak ada nomor HP — terminal langsung (exhausted), tidak perlu retry
    // Gunakan attemptCount = maxAttempts - 1 agar markFailed mengeluarkan status exhausted
    await markFailed(id, "recipient_phone kosong — tidak bisa dikirim", maxAttempts - 1, maxAttempts);
    void logActivity({
      mktRfqId:         rfqId,
      mktVendorQuoteId: vendorQuoteId,
      actorType:        "system",
      action:           "mkt_notification_exhausted",
      description:      `Notif id=${id} EXHAUSTED: recipient_phone kosong`,
      newValue:         { queueId: id, eventType, reason: "no_phone" },
    }).catch(() => {});
    return;
  }

  const message = buildMessage(item);

  try {
    const { sendViaService } = await import("../waTransport.js");
    await sendViaService(recipientPhone, message);

    await markSent(id);

    void logActivity({
      mktRfqId:          rfqId,
      mktVendorQuoteId:  vendorQuoteId,
      mktPurchaseOrderId: purchaseOrderId,
      actorType:         "system",
      action:            "mkt_notification_sent",
      description:       `WA ${eventType} terkirim ke ${recipientPhone} (queueId=${id}, attempt=${attemptCount + 1})`,
      newValue:          { queueId: id, eventType, recipientPhone, attempt: attemptCount + 1 },
    }).catch(() => {});

    logger.info(
      { queueId: id, eventType, recipientPhone, attempt: attemptCount + 1 },
      "[mktNotifWorker] WA terkirim",
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const nextAttempt = attemptCount + 1;
    const isExhausted = nextAttempt >= maxAttempts;

    await markFailed(id, errMsg, attemptCount, maxAttempts);

    void logActivity({
      mktRfqId:         rfqId,
      mktVendorQuoteId: vendorQuoteId,
      actorType:        "system",
      action:           isExhausted ? "mkt_notification_exhausted" : "mkt_notification_failed",
      description:      `Notif id=${id} ${isExhausted ? "EXHAUSTED" : "gagal"} attempt ${nextAttempt}/${maxAttempts}: ${errMsg.slice(0, 200)}`,
      newValue:         { queueId: id, eventType, recipientPhone, attempt: nextAttempt, error: errMsg.slice(0, 500) },
    }).catch(() => {});

    if (isExhausted) {
      logger.error(
        { queueId: id, eventType, recipientPhone, attempt: nextAttempt, err: errMsg },
        `[mktNotifWorker] EXHAUSTED setelah ${nextAttempt} attempts`,
      );
    } else {
      logger.warn(
        { queueId: id, eventType, recipientPhone, attempt: nextAttempt, err: errMsg },
        "[mktNotifWorker] WA gagal, akan di-retry",
      );
    }
  }
}

// ── Worker loop ───────────────────────────────────────────────────────────────

export async function runMarketplaceNotificationWorkerCycle(): Promise<{
  processed: number; sent: number; failed: number;
}> {
  if (_workerRunning) return { processed: 0, sent: 0, failed: 0 };
  _workerRunning = true;

  const stats = { processed: 0, sent: 0, failed: 0 };

  try {
    // P0-3: fetchAndClaimNotifications — atomic claim, rows sudah 'sending'
    const items = await fetchAndClaimNotifications(BATCH_SIZE);
    if (!items.length) return stats;

    for (const item of items) {
      stats.processed++;
      try {
        await processNotification(item);
        stats.sent++;
      } catch (err: unknown) {
        // processNotification tidak throw, tapi jaga-jaga
        logger.warn({ err, queueId: item.id }, "[mktNotifWorker] processNotification unexpected throw");
        stats.failed++;
      }
    }

    if (stats.processed > 0) {
      logger.info(stats, "[mktNotifWorker] Batch selesai");
    }
  } finally {
    _workerRunning = false;
  }

  return stats;
}

// ── Start function — dipanggil oleh startupOrchestrator ──────────────────────

export function startMarketplaceNotificationWorker(): void {
  registerHeartbeat("mkt-notification-queue", WORKER_INTERVAL_MS);
  setTimeout(async () => {
    // P0-2: Recovery — reset stuck 'sending' rows dari crash sebelumnya
    try {
      const recovered = await recoverStuckSendingRows();
      if (recovered > 0) {
        logger.warn({ recovered }, "[mktNotifWorker] Startup recovery: stuck sending rows direset ke pending");
      }
    } catch { /* non-fatal */ }

    // Jalankan cycle pertama
    beat("mkt-notification-queue");
    void runMarketplaceNotificationWorkerCycle().catch((err: unknown) => {
      logger.warn({ err }, "[mktNotifWorker] Worker cycle error");
    });

    // Polling interval setelah cycle pertama
    setInterval(() => {
      beat("mkt-notification-queue");
      void runMarketplaceNotificationWorkerCycle().catch((err: unknown) => {
        logger.warn({ err }, "[mktNotifWorker] Worker cycle error");
      });
    }, WORKER_INTERVAL_MS);
  }, WORKER_INITIAL_DELAY_MS);

  logger.info(
    { initialDelayMs: WORKER_INITIAL_DELAY_MS, intervalMs: WORKER_INTERVAL_MS },
    "[mktNotifWorker] Worker terdaftar",
  );
}
