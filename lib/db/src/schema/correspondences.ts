import { pgTable, serial, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const correspondenceKindEnum = pgEnum("correspondence_kind", [
  "email",
  "whatsapp",
  "letter",
  "other",
]);

export const correspondenceDirectionEnum = pgEnum("correspondence_direction", [
  "inbound",
  "outbound",
]);

export const correspondencesTable = pgTable("correspondences", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  kind: correspondenceKindEnum("kind").notNull().default("email"),
  direction: correspondenceDirectionEnum("direction").notNull().default("inbound"),
  subject: text("subject").notNull(),
  body: text("body"),
  extractedText: text("extracted_text"),
  senderName: text("sender_name"),
  senderEmail: text("sender_email"),
  receiverName: text("receiver_name"),
  receiverEmail: text("receiver_email"),
  ccEmail: text("cc_email"),
  status: text("status").notNull().default("new"),
  linkedDocType: text("linked_doc_type"),
  linkedDocId: integer("linked_doc_id"),
  customerId: integer("customer_id"),
  supplierId: integer("supplier_id"),
  tags: text("tags"),
  attachments: text("attachments"),
  emailMessageId: text("email_message_id"),
  emailThreadId: text("email_thread_id"),
  correspondedAt: timestamp("corresponded_at").notNull().defaultNow(),
  createdById: text("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("correspondences_company_idx").on(t.companyId),
]);

export const insertCorrespondenceSchema = createInsertSchema(correspondencesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCorrespondence = z.infer<typeof insertCorrespondenceSchema>;
export type Correspondence = typeof correspondencesTable.$inferSelect;

export const correspondenceAttachmentsTable = pgTable("correspondence_attachments", {
  id: serial("id").primaryKey(),
  correspondenceId: integer("correspondence_id").notNull(),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  mimeType: text("mime_type"),
  extractedText: text("extracted_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CorrespondenceAttachment = typeof correspondenceAttachmentsTable.$inferSelect;
