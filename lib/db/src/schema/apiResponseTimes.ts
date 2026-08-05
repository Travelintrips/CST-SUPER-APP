import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const apiResponseTimesTable = pgTable("api_response_times", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  path: text("path").notNull(),
  durationMs: integer("duration_ms").notNull(),
});

export type ApiResponseTime = typeof apiResponseTimesTable.$inferSelect;
