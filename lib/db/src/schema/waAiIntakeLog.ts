import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const waAiIntakeLogTable = pgTable("wa_ai_intake_log", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  senderName: text("sender_name"),
  status: text("status").notNull(),
  skipReason: text("skip_reason"),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});

export type WaAiIntakeLog = typeof waAiIntakeLogTable.$inferSelect;
