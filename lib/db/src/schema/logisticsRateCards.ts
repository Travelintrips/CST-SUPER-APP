import { pgTable, serial, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const logisticsServiceTypeEnum = pgEnum("logistics_service_type", [
  "seaFreight",
  "airFreight",
  "customs",
  "trucking",
  "warehousing",
  "projectCargo",
]);

export const logisticsRateCardsTable = pgTable("logistics_rate_cards", {
  id: serial("id").primaryKey(),
  serviceType: logisticsServiceTypeEnum("service_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  currency: text("currency").notNull().default("IDR"),
  isActive: boolean("is_active").notNull().default(true),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validTo: timestamp("valid_to", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LogisticsRateCard = typeof logisticsRateCardsTable.$inferSelect;
export type InsertLogisticsRateCard = typeof logisticsRateCardsTable.$inferInsert;
