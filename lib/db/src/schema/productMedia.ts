import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { vendorCatalogItemsTable } from "./suppliers";

export const productMediaTable = pgTable("product_media", {
  id: serial("id").primaryKey(),
  vendorCatalogItemId: integer("vendor_catalog_item_id").references(() => vendorCatalogItemsTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id"),
  mediaType: text("media_type").notNull().default("image"),
  fileUrl: text("file_url"),
  thumbnailUrl: text("thumbnail_url"),
  externalUrl: text("external_url"),
  title: text("title"),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  uploadedBy: text("uploaded_by"),
  uploadedByRole: text("uploaded_by_role"),
  storagePath: text("storage_path"),
  imageSource: text("image_source").default("admin"),
  aiImageStatus: text("ai_image_status"),
  generationPrompt: text("generation_prompt"),
  duration: integer("duration"),
  fileSizeBytes: integer("file_size_bytes"),
  documentType: text("document_type"),
  visibility: text("visibility").default("public"),
  originalFilename: text("original_filename"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ProductMedia = typeof productMediaTable.$inferSelect;
export type InsertProductMedia = typeof productMediaTable.$inferInsert;
