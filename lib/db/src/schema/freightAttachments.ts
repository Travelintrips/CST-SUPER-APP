import { pgTable, serial, integer, text, timestamp, date, pgEnum } from "drizzle-orm/pg-core";
import { freightShipmentsTable } from "./freightShipments";

export const freightAttachmentTypeEnum = pgEnum("freight_attachment_type", [
  "photo",
  "document",
]);

export const freightAttachmentsTable = pgTable("freight_attachments", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id").notNull().references(() => freightShipmentsTable.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  fileType: freightAttachmentTypeEnum("file_type").notNull(),
  label: text("label"),
  uploadedById: text("uploaded_by_id"),
  // Document management fields
  docType: text("doc_type"),
  docNumber: text("doc_number"),
  docDate: date("doc_date"),
  docStatus: text("doc_status"),
  invoiceId: integer("invoice_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type FreightAttachment = typeof freightAttachmentsTable.$inferSelect;
