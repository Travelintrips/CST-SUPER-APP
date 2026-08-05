import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

// ── SCHEMA — Enterprise Marketplace Blueprint v1.1.1, Section 6.7 ────────────
// MIGRATED — Phase 1C (2026-07-02). Table exists in Supabase production.
// F26 resolved — menggantikan rencana reuse `public.system_settings` (DITOLAK,
// isinya payroll/BPJS milik modul lain). Key-value config khusus marketplace,
// dipakai untuk COA mapping (Blueprint Section 15) dan setting operasional lain.

export const mktCompanySettingsTable = pgTable("mkt_company_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }), // NULL = global default

  settingKey: text("setting_key").notNull(), // contoh: 'mkt_coa_commission_revenue'
  settingValue: jsonb("setting_value").notNull().$type<unknown>(), // fleksibel: FK id, angka, string, dll
  description: text("description"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mkt_company_settings_company_key_uniq").on(t.companyId, t.settingKey),
  index("mkt_company_settings_key_idx").on(t.settingKey),
]);

export const insertMktCompanySettingSchema = createInsertSchema(mktCompanySettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMktCompanySetting = z.infer<typeof insertMktCompanySettingSchema>;
export type MktCompanySetting = typeof mktCompanySettingsTable.$inferSelect;
