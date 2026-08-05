import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const mediaAssetsTable = pgTable("media_assets", {
  id: serial("id").primaryKey(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes"),
  url: text("url").notNull(),
  objectPath: text("object_path").notNull(),
  uploadedBy: text("uploaded_by"),
  folder: text("folder").notNull().default("Umum"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  publicUrl: text("public_url"),
});
