import { pgTable, serial, integer, text, numeric, date, timestamp, boolean } from "drizzle-orm/pg-core";

export const fixedAssetsTable = pgTable("fixed_assets", {
  id:                     serial("id").primaryKey(),
  companyId:              integer("company_id"),
  assetNumber:            text("asset_number").notNull().unique(),
  assetName:              text("asset_name").notNull(),
  assetType:              text("asset_type").notNull().default("equipment"), // equipment | vehicle | building | land | other
  purchaseDate:           date("purchase_date").notNull(),
  purchasePrice:          numeric("purchase_price", { precision: 14, scale: 2 }).notNull(),
  usefulLifeMonths:       integer("useful_life_months").notNull().default(60),
  salvageValue:           numeric("salvage_value", { precision: 14, scale: 2 }).notNull().default("0"),
  depreciationMethod:     text("depreciation_method").notNull().default("straight_line"), // straight_line | declining_balance
  accumulatedDepreciation:numeric("accumulated_depreciation", { precision: 14, scale: 2 }).notNull().default("0"),
  bookValue:              numeric("book_value", { precision: 14, scale: 2 }).notNull(),
  paymentMethod:          text("payment_method").notNull().default("bank"),
  notes:                  text("notes"),
  taxRelated:             boolean("tax_related").notNull().default(false),
  isActive:               boolean("is_active").notNull().default(true),
  journalEntryId:         integer("journal_entry_id"),
  createdById:            text("created_by_id"),
  createdAt:              timestamp("created_at").defaultNow(),
});

export const assetDepreciationRecordsTable = pgTable("asset_depreciation_records", {
  id:                 serial("id").primaryKey(),
  assetId:            integer("asset_id").notNull(),
  periodDate:         date("period_date").notNull(), // YYYY-MM-01
  depreciationAmount: numeric("depreciation_amount", { precision: 14, scale: 2 }).notNull(),
  accumulatedAfter:   numeric("accumulated_after", { precision: 14, scale: 2 }).notNull(),
  bookValueAfter:     numeric("book_value_after", { precision: 14, scale: 2 }).notNull(),
  journalEntryId:     integer("journal_entry_id"),
  notes:              text("notes"),
  createdAt:          timestamp("created_at").defaultNow(),
});
