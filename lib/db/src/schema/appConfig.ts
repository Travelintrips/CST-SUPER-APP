import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const appConfig = pgTable("app_config", {
  key:         text("key").primaryKey(),
  value:       text("value"),
  isSecret:    boolean("is_secret").notNull().default(false),
  description: text("description"),
  environment: text("environment").notNull().default("all"),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
  updatedBy:   text("updated_by"),
});

export type AppConfig       = typeof appConfig.$inferSelect;
export type InsertAppConfig = typeof appConfig.$inferInsert;
