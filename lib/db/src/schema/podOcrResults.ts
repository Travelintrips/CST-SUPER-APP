import { pgTable, serial, integer, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { logisticOrdersTable } from "./logisticOrders";

export const podOcrResultsTable = pgTable("pod_ocr_results", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
  orderNumber: text("order_number"),
  imageUrl: text("image_url"),
  extractedText: text("extracted_text"),
  extractedOrderNumber: text("extracted_order_number"),
  extractedDate: text("extracted_date"),
  extractedReceiver: text("extracted_receiver"),
  extractedCompany: text("extracted_company"),
  hasSignature: text("has_signature"),
  verificationStatus: text("verification_status").notNull().default("pending"),
  mismatchFields: text("mismatch_fields"),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }).default("0"),
  rawResponse: text("raw_response"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("pod_ocr_order_idx").on(t.orderId),
  index("pod_ocr_status_idx").on(t.verificationStatus),
]);

export type PodOcrResult = typeof podOcrResultsTable.$inferSelect;
export type InsertPodOcrResult = typeof podOcrResultsTable.$inferInsert;
