/**
 * sportSyncNotifier.ts
 * Kirim notifikasi WhatsApp ke admin group jika sinkronisasi Sport Center gagal
 * setelah semua retry habis.
 *
 * Dedup: Fonnte built-in DEDUP_WINDOW_MS (default 30 menit) via context + refId.
 * Aturan:
 *  - Error single fasilitas      → context="sport_sync_error" refId="facility_upsert_<id>"
 *  - Error delete fasilitas      → context="sport_sync_error" refId="facility_delete_<id>"
 *  - Error bulk resync fasilitas → context="sport_sync_error" refId="bulk_facility_resync"
 *  - Error single booking        → context="sport_sync_error" refId="booking_upsert_<id>"
 *  - Error bulk resync booking   → context="sport_sync_error" refId="bulk_booking_resync"
 */

import { sendViaService } from "../../lib/waTransport.js";
import { getAdminGroupWa } from "../../lib/adminWa.js";
import { logger } from "../../lib/logger.js";

const PREFIX = "[SportSyncNotifier]";

export type SyncEntity = "facility" | "booking";

export interface SyncErrorEntry {
  entity: SyncEntity;
  entityId: number | null;
  entityName: string;
  action: "upsert" | "delete" | "resync";
  error: string;
}

function fmtNow(): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date());
}

function entityLabel(entity: SyncEntity): string {
  return entity === "facility" ? "fasilitas" : "booking";
}

function buildMessage(errors: SyncErrorEntry[]): string {
  const ts = fmtNow();
  const entity = errors[0]?.entity ?? "facility";
  const isBulk = errors.length > 1 || errors.some(e => e.action === "resync");

  if (isBulk) {
    const lines = errors
      .map(e => `❌ ${e.entityName}${e.entityId ? ` (ID: ${e.entityId})` : ""}: ${e.error}`)
      .join("\n");
    return (
      `🚨 *Sport Center Sync Error*\n\n` +
      `Waktu: ${ts} WIB\n` +
      `Aksi: resync semua ${entityLabel(entity)}\n` +
      `Total gagal: ${errors.length} ${entityLabel(entity)}\n\n` +
      `${lines}\n\n` +
      `Cek riwayat di BizPortal → Sport Center → Dashboard.`
    );
  }

  const e = errors[0]!;
  const aksiLabel = e.action === "delete" ? "hapus (soft-delete)" : "upsert";
  return (
    `🚨 *Sport Center Sync Error*\n\n` +
    `Waktu: ${ts} WIB\n` +
    `Aksi: ${aksiLabel} ${entityLabel(entity)}\n` +
    `${entity === "facility" ? "Fasilitas" : "Booking"}: ${e.entityName}${e.entityId ? ` (ID: ${e.entityId})` : ""}\n\n` +
    `❌ Error: ${e.error}\n\n` +
    `Cek riwayat di BizPortal → Sport Center → Dashboard.`
  );
}

function buildRefId(errors: SyncErrorEntry[]): string {
  const entity = errors[0]?.entity ?? "facility";
  const isBulk = errors.length > 1 || errors[0]?.action === "resync";
  if (isBulk) return `bulk_${entity}_resync`;
  const firstId = errors[0]?.entityId;
  const firstAction = errors[0]?.action ?? "upsert";
  return `${entity}_${firstAction}_${firstId ?? "unknown"}`;
}

/**
 * Kirim WA error sync ke admin group.
 * Non-blocking — panggil via `void notifySyncError(...)`.
 */
export async function notifySyncError(errors: SyncErrorEntry[]): Promise<void> {
  if (!errors.length) return;

  let adminGroup = "";
  try {
    adminGroup = await getAdminGroupWa();
  } catch (err) {
    logger.warn({ err }, `${PREFIX} gagal mengambil admin group WA`);
  }

  if (!adminGroup) {
    logger.warn(`${PREFIX} admin group WA tidak dikonfigurasi — notifikasi sync error dilewati`);
    return;
  }

  const message = buildMessage(errors);
  const refId = buildRefId(errors);

  try {
    await sendViaService(adminGroup, message, {
      context: "sport_sync_error",
      refType: "sport_sync",
      refId,
    });
    logger.info({ refId, count: errors.length }, `${PREFIX} notifikasi WA terkirim`);
  } catch (err) {
    logger.error({ err, refId }, `${PREFIX} gagal mengirim notifikasi WA`);
  }
}
