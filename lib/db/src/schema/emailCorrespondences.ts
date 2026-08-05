import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const emailCorrespondencesTable = pgTable("email_correspondences", {
  id: serial("id").primaryKey(),
  emailMessageId: text("email_message_id").unique(),
  fromEmail: text("from_email"),
  toEmail: text("to_email"),
  ccEmail: text("cc_email"),
  subject: text("subject").notNull().default(""),
  body: text("body"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  status: text("status").notNull().default("new"),
  validatedBy: text("validated_by"),
  validatedAt: timestamp("validated_at"),
  aiProcessed: boolean("ai_processed").notNull().default(false),
  aiSkipReason: text("ai_skip_reason"),
  linkedSalesDocId: integer("linked_sales_doc_id"),
  inReplyTo: text("in_reply_to"),
  emailRole: text("email_role").default("inquiry"),
  threadSalesDocId: integer("thread_sales_doc_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmailCorrespondence = typeof emailCorrespondencesTable.$inferSelect;

export const emailAttachmentsTable = pgTable("email_attachments", {
  id: serial("id").primaryKey(),
  emailCorrespondenceId: integer("email_correspondence_id").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type EmailAttachment = typeof emailAttachmentsTable.$inferSelect;

export const emailLinksTable = pgTable("email_links", {
  id: serial("id").primaryKey(),
  emailCorrespondenceId: integer("email_correspondence_id").notNull(),
  linkedType: text("linked_type").notNull(),
  linkedId: integer("linked_id").notNull(),
  linkReason: text("link_reason"),
  isValidated: boolean("is_validated").notNull().default(false),
  validatedBy: text("validated_by"),
  validatedAt: timestamp("validated_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type EmailLink = typeof emailLinksTable.$inferSelect;
