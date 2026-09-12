import { pgTable, serial, text, timestamp, index, uniqueIndex, integer } from "drizzle-orm/pg-core";

export const notificationLogsTable = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject"),
  message: text("message").notNull(),
  status: text("status").notNull().default("sent"),
  errorMsg: text("error_msg"),
  context: text("context").notNull().default("general"),
  refType: text("ref_type"),
  refId: text("ref_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /**
   * Dedup key — hash dari (channel:recipient:context:refId:timeBucket) untuk status 'sent'.
   * NULL untuk status 'failed' / 'deduped' supaya retry tetap bisa dilog.
   * UNIQUE constraint mencegah dua concurrent INSERT lolos dedup in-memory bersamaan.
   */
  dedupKey: text("dedup_key"),
  /**
   * Retry tracking — hanya digunakan untuk channel='wa' status='failed'.
   * retryCount: berapa kali sudah dicoba ulang (0 = belum pernah retry).
   * nextRetryAt: kapan retry berikutnya boleh dijalankan (NULL = segera boleh dicoba).
   */
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at"),
  /**
   * URL media (gambar/dokumen) yang dikirim bersama pesan WA.
   * Disimpan agar retry worker bisa mengirim ulang dengan media yang sama.
   */
  mediaUrl: text("media_url"),
  /**
   * WA Delivery Tracking — diisi dari Fonnte API response saat kirim.
   * waMessageId: ID pesan dari Fonnte, dipakai untuk match delivery callback.
   * waDeliveryStatus: status terakhir dari Fonnte callback ('sent'|'delivered'|'read').
   * deliveredAt / readAt: timestamp dari delivery callback.
   */
  waMessageId: text("wa_message_id"),
  waDeliveryStatus: text("wa_delivery_status"),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
}, (t) => [
  index("notif_logs_channel_idx").on(t.channel),
  index("notif_logs_status_idx").on(t.status),
  index("notif_logs_context_idx").on(t.context),
  index("notif_logs_created_idx").on(t.createdAt),
  index("notif_logs_retry_idx").on(t.status, t.channel, t.retryCount, t.nextRetryAt),
  uniqueIndex("notif_logs_dedup_key_idx").on(t.dedupKey),
]);

export type NotificationLog = typeof notificationLogsTable.$inferSelect;
export type InsertNotificationLog = typeof notificationLogsTable.$inferInsert;
