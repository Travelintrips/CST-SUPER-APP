import {
  pgTable,
  serial,
  text,
  numeric,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

export const btkiTariffTable = pgTable(
  "btki_tariff",
  {
    id:              serial("id").primaryKey(),
    hsCode:          text("hs_code").notNull(),
    hsCode6:         text("hs_code_6").notNull(),
    hsCode4:         text("hs_code_4").notNull(),
    hsCode2:         text("hs_code_2").notNull(),
    descriptionId:   text("description_id").notNull(),
    descriptionEn:   text("description_en"),
    unit:            text("unit"),

    bmMfn:           numeric("bm_mfn"),
    bmAcfta:         numeric("bm_acfta"),
    bmAfta:          numeric("bm_afta"),
    bmAifta:         numeric("bm_aifta"),
    bmAanzfta:       numeric("bm_aanzfta"),
    bmAhkfta:        numeric("bm_ahkfta"),
    bmAsfta:         numeric("bm_asfta"),
    bmAkfta:         numeric("bm_akfta"),
    bmIndonesiaAustralia: numeric("bm_indonesia_australia"),

    ppnRate:         numeric("ppn_rate").default("11"),
    ppnbmRate:       numeric("ppnbm_rate").default("0"),
    pph22Rate:       numeric("pph22_rate").default("2.5"),
    pph22NonApi:     numeric("pph22_non_api").default("7.5"),

    lartasImport:    boolean("lartas_import").default(false),
    lartasExport:    boolean("lartas_export").default(false),
    lartasDesc:      text("lartas_desc"),
    regulatorImport: text("regulator_import"),
    regulatorExport: text("regulator_export"),
    perizinanImport: jsonb("perizinan_import"),
    perizinanExport: jsonb("perizinan_export"),

    // Spec fields: duty_export, export_duty_actual, royalty_rate, fta_flag, btki_version, source
    dutyExport:      numeric("duty_export"),
    exportDutyActual: numeric("export_duty_actual"),
    royaltyRate:     numeric("royalty_rate"),
    ftaFlag:         boolean("fta_flag").default(false),
    btkiVersion:     text("btki_version").default("2022"),
    source:          text("source").default("BTKI 2022"),

    notes:           text("notes"),
    category:        text("category"),
    updatedAt:       timestamp("updated_at").defaultNow(),
  },
  (t) => [
    uniqueIndex("btki_hs_code_unique").on(t.hsCode),
    index("btki_hs_code_6_idx").on(t.hsCode6),
    index("btki_hs_code_4_idx").on(t.hsCode4),
    index("btki_hs_code_2_idx").on(t.hsCode2),
    index("btki_category_idx").on(t.category),
  ]
);
