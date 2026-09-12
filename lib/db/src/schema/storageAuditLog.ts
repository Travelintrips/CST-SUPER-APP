import { pgTable, serial, text, integer, bigint, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const storageAuditActionEnum = pgEnum("storage_audit_action", [
  "upload",
  "upload_presigned_issued",
  "download",
  "delete",
  "delete_orphan",
]);

export const storageAuditEntityTypeEnum = pgEnum("storage_audit_entity_type", [
  "freight_attachment",
  "expense_attachment",
  "media_asset",
  "pod_ocr",
  "presigned_upload",
  "other",
]);

export const storageAuditLogTable = pgTable("storage_audit_log", {
  id: serial("id").primaryKey(),
  action: storageAuditActionEnum("action").notNull(),
  entityType: storageAuditEntityTypeEnum("entity_type").notNull(),
  entityId: integer("entity_id"),
  objectPath: text("object_path"),
  fileName: text("file_name"),
  contentType: text("content_type"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  actorId: text("actor_id"),
  actorType: text("actor_type").default("staff"),
  ipAddress: text("ip_address"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type StorageAuditLog = typeof storageAuditLogTable.$inferSelect;
export type InsertStorageAuditLog = typeof storageAuditLogTable.$inferInsert;
