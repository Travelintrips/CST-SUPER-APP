import { pgTable, serial, integer, text, boolean, timestamp, numeric, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { logisticsRateCardsTable } from "./logisticsRateCards";

export const rateValueTypeEnum = pgEnum("rate_value_type", ["fixed", "percentage"]);

export const logisticsServiceRatesTable = pgTable("logistics_service_rates", {
  id: serial("id").primaryKey(),
  rateCardId: integer("rate_card_id")
    .notNull()
    .references(() => logisticsRateCardsTable.id, { onDelete: "cascade" }),
  rateKey: text("rate_key").notNull(),
  label: text("label").notNull(),
  valueType: rateValueTypeEnum("value_type").notNull().default("fixed"),
  valueAmount: numeric("value_amount", { precision: 18, scale: 4 }).notNull().default("0"),
  containerType: text("container_type"),
  vehicleType: text("vehicle_type"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LogisticsServiceRate = typeof logisticsServiceRatesTable.$inferSelect;
export type InsertLogisticsServiceRate = typeof logisticsServiceRatesTable.$inferInsert;

export const logisticsServiceRatesRelations = relations(logisticsServiceRatesTable, ({ one }) => ({
  rateCard: one(logisticsRateCardsTable, {
    fields: [logisticsServiceRatesTable.rateCardId],
    references: [logisticsRateCardsTable.id],
  }),
}));
