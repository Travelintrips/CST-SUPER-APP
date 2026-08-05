import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Table Creation ───────────────────────────────────────────────────────────

async function createBtkiTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS btki_tariff (
      id              SERIAL PRIMARY KEY,
      hs_code         TEXT    NOT NULL,
      hs_code_6       TEXT    NOT NULL DEFAULT '',
      hs_code_4       TEXT    NOT NULL DEFAULT '',
      hs_code_2       TEXT    NOT NULL DEFAULT '',
      description_id  TEXT    NOT NULL,
      description_en  TEXT,
      unit            TEXT,
      bm_mfn          NUMERIC,
      bm_acfta        NUMERIC,
      bm_afta         NUMERIC,
      bm_aifta        NUMERIC,
      bm_aanzfta      NUMERIC,
      bm_ahkfta       NUMERIC,
      bm_asfta        NUMERIC,
      bm_akfta        NUMERIC,
      bm_indonesia_australia NUMERIC,
      ppn_rate        NUMERIC DEFAULT 11,
      ppnbm_rate      NUMERIC DEFAULT 0,
      pph22_rate      NUMERIC DEFAULT 2.5,
      pph22_non_api   NUMERIC DEFAULT 7.5,
      lartas_import   BOOLEAN DEFAULT false,
      lartas_export   BOOLEAN DEFAULT false,
      lartas_desc     TEXT,
      regulator_import TEXT,
      regulator_export TEXT,
      perizinan_import JSONB,
      perizinan_export JSONB,
      notes           TEXT,
      category        TEXT,
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS btki_hs_code_unique ON btki_tariff(hs_code)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS btki_hs_code_6_idx ON btki_tariff(hs_code_6)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS btki_hs_code_4_idx ON btki_tariff(hs_code_4)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS btki_hs_code_2_idx ON btki_tariff(hs_code_2)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS btki_category_idx ON btki_tariff(category)
  `).catch(() => {});
  // Text search index for autocomplete
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS btki_desc_id_idx ON btki_tariff USING gin(to_tsvector('simple', description_id))
  `).catch(() => {});

  // ── Schema upgrades: add new spec columns if missing ─────────────────────
  await db.execute(sql`ALTER TABLE btki_tariff ADD COLUMN IF NOT EXISTS duty_export NUMERIC`).catch(() => {});
  await db.execute(sql`ALTER TABLE btki_tariff ADD COLUMN IF NOT EXISTS export_duty_actual NUMERIC`).catch(() => {});
  await db.execute(sql`ALTER TABLE btki_tariff ADD COLUMN IF NOT EXISTS royalty_rate NUMERIC`).catch(() => {});
  await db.execute(sql`ALTER TABLE btki_tariff ADD COLUMN IF NOT EXISTS fta_flag BOOLEAN DEFAULT false`).catch(() => {});
  await db.execute(sql`ALTER TABLE btki_tariff ADD COLUMN IF NOT EXISTS btki_version TEXT DEFAULT '2022'`).catch(() => {});
  await db.execute(sql`ALTER TABLE btki_tariff ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'BTKI 2022'`).catch(() => {});
}

// ─── Seed Data: BTKI 2022 (Buku Tarif Kepabeanan Indonesia) ──────────────────
// Source: Kemenkeu RI — covers major HS chapters for common import goods.
// Rates: BM MFN = Most Favoured Nation tariff rate.
// This seed covers representative codes across all 99 chapters.

type BtkiRow = {
  hs_code: string; description_id: string; description_en?: string; unit?: string;
  bm_mfn: number; bm_acfta?: number; bm_afta?: number; bm_aifta?: number;
  bm_aanzfta?: number; bm_ahkfta?: number; bm_akfta?: number; bm_asfta?: number;
  ppn_rate?: number; ppnbm_rate?: number; pph22_rate?: number;
  lartas_import?: boolean; lartas_export?: boolean; lartas_desc?: string;
  regulator_import?: string; regulator_export?: string;
  perizinan_import?: object; perizinan_export?: object;
  category: string; notes?: string;
};

const SEED_DATA: BtkiRow[] = [
  // ── Chapter 01: Hewan Hidup ───────────────────────────────────────────────
  { hs_code: "0101.21.00", description_id: "Kuda ras murni untuk pembiakan", description_en: "Pure-bred breeding horses", unit: "ekor", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / BPOM", lartas_desc: "Wajib karantina hewan dan izin impor Kementan; pemeriksaan kesehatan", category: "Hewan Hidup" },
  { hs_code: "0102.21.00", description_id: "Sapi ras murni untuk pembiakan", description_en: "Pure-bred breeding bovine animals", unit: "ekor", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan", lartas_desc: "Wajib karantina hewan, sertifikat kesehatan, dan RIPH dari Kementan", category: "Hewan Hidup" },
  { hs_code: "0103.10.00", description_id: "Babi ras murni untuk pembiakan", description_en: "Pure-bred breeding swine", unit: "ekor", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan", lartas_desc: "Wajib karantina hewan dan izin RIPH Kementan", category: "Hewan Hidup" },
  { hs_code: "0105.11.00", description_id: "Ayam ras (Gallus domesticus), berat ≤ 185g", description_en: "Day-old chicks of domestic fowls", unit: "ekor", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan", lartas_desc: "DOC impor wajib izin pemasukan dari Kementan dan karantina hewan", category: "Hewan Hidup" },
  { hs_code: "0106.11.00", description_id: "Primata (monyet, orang utan, dll.)", description_en: "Live primates", unit: "ekor", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "KLHK / CITES", lartas_desc: "Dilarang/sangat dibatasi — hanya untuk riset/kebun binatang; wajib CITES permit", category: "Hewan Hidup" },

  // ── Chapter 02: Daging & Jeroan ───────────────────────────────────────────
  { hs_code: "0201.10.00", description_id: "Daging sapi segar/dingin, karkas dan setengah karkas", description_en: "Carcasses and half-carcasses of bovine animals, fresh/chilled", unit: "kg", bm_mfn: 5, bm_acfta: 0, bm_afta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Wajib SPI Kemendag, RIPH Kementan, sertifikat halal, karantina hewan", perizinan_import: { docs: ["SPI (Surat Persetujuan Impor) Kemendag", "RIPH Kementan", "Sertifikat Halal MUI", "Sertifikat Kesehatan Negara Asal", "Karantina Hewan (BKIPM)"] }, category: "Daging" },
  { hs_code: "0202.10.00", description_id: "Daging sapi beku, karkas dan setengah karkas", description_en: "Carcasses and half-carcasses of bovine animals, frozen", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Wajib SPI, RIPH, halal, karantina — impor daging beku ketat", category: "Daging" },
  { hs_code: "0203.11.00", description_id: "Karkas dan setengah karkas babi segar/dingin", description_en: "Carcasses and half-carcasses of swine, fresh/chilled", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Wajib SPI Kemendag dan RIPH Kementan; karantina hewan wajib; non-halal", category: "Daging" },
  { hs_code: "0207.12.00", description_id: "Daging ayam segar/dingin, tidak dipotong-potong", description_en: "Poultry (Gallus domesticus), not cut in pieces, fresh/chilled", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Wajib SPI Kemendag, RIPH Kementan, sertifikat halal, karantina hewan", category: "Daging" },

  // ── Chapter 03: Ikan & Produk Perikanan ───────────────────────────────────
  { hs_code: "0302.11.00", description_id: "Ikan trout segar/dingin (Salmo trutta, dll.)", description_en: "Trout, fresh or chilled", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "KKP", lartas_desc: "Wajib izin KKP (Kementerian Kelautan dan Perikanan) dan karantina ikan", category: "Ikan & Perikanan" },
  { hs_code: "0303.12.00", description_id: "Ikan salmon Pasifik beku (Oncorhynchus spp.)", description_en: "Pacific salmon, frozen", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "KKP", lartas_desc: "Wajib izin impor KKP dan karantina ikan di pelabuhan masuk", category: "Ikan & Perikanan" },
  { hs_code: "0306.17.10", description_id: "Udang beku (frozen shrimp)", description_en: "Shrimps and prawns, frozen", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "KKP / Kemendag", lartas_desc: "Wajib izin impor KKP; cek apakah terdapat pembatasan daerah asal karena penyakit udang", category: "Ikan & Perikanan" },
  { hs_code: "0307.11.00", description_id: "Tiram (oyster) hidup, segar, atau dingin", description_en: "Oysters, live, fresh or chilled", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "KKP", lartas_desc: "Wajib izin KKP dan karantina ikan", category: "Ikan & Perikanan" },

  // ── Chapter 04: Susu & Produk Susu ───────────────────────────────────────
  { hs_code: "0401.10.00", description_id: "Susu segar, kadar lemak ≤ 1%", description_en: "Milk and cream, fat content ≤1%, not concentrated", unit: "liter", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM / Kemendag", lartas_desc: "Produk susu segar wajib izin edar BPOM dan SPI Kemendag", category: "Susu & Produk Dairy" },
  { hs_code: "0402.10.10", description_id: "Susu bubuk, kadar lemak ≤ 1.5%", description_en: "Milk powder, fat content ≤1.5%", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM / Kemendag", lartas_desc: "Wajib SPI Kemendag, izin edar BPOM, SNI untuk susu bubuk tertentu", category: "Susu & Produk Dairy" },
  { hs_code: "0406.10.00", description_id: "Keju segar (fresh cheese, unripened)", description_en: "Fresh cheese, unripened/uncured", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM / Kemendag", lartas_desc: "Keju impor wajib SPI Kemendag dan izin edar BPOM", category: "Susu & Produk Dairy" },

  // ── Chapter 07: Sayuran ───────────────────────────────────────────────────
  { hs_code: "0701.10.00", description_id: "Benih kentang untuk bibit", description_en: "Seed potatoes", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan", lartas_desc: "Benih wajib izin pemasukan Kementan dan karantina tumbuhan", category: "Sayuran" },
  { hs_code: "0702.00.00", description_id: "Tomat segar atau dingin", description_en: "Tomatoes, fresh or chilled", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan", lartas_desc: "Wajib karantina tumbuhan dan izin pemasukan hortikultura Kementan", category: "Sayuran" },
  { hs_code: "0703.10.10", description_id: "Bawang merah segar atau dingin", description_en: "Shallots (onions), fresh or chilled", unit: "kg", bm_mfn: 20, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Bawang merah LARTAS ketat — wajib RIPH Kementan, SPI Kemendag, karantina", category: "Sayuran" },
  { hs_code: "0703.20.00", description_id: "Bawang putih segar atau dingin", description_en: "Garlic, fresh or chilled", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Bawang putih LARTAS — wajib RIPH Kementan, SPI Kemendag, kuota impor", perizinan_import: { docs: ["RIPH Kementan", "SPI Kemendag", "Karantina Tumbuhan", "Fumigasi jika diperlukan"] }, category: "Sayuran" },

  // ── Chapter 08: Buah-Buahan ───────────────────────────────────────────────
  { hs_code: "0805.10.00", description_id: "Jeruk manis (sweet orange) segar atau kering", description_en: "Sweet oranges, fresh or dried", unit: "kg", bm_mfn: 25, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Buah jeruk wajib RIPH Kementan dan SPI Kemendag; karantina tumbuhan", category: "Buah-Buahan" },
  { hs_code: "0806.10.00", description_id: "Anggur segar", description_en: "Grapes, fresh", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Buah anggur wajib RIPH Kementan dan SPI Kemendag; karantina tumbuhan", category: "Buah-Buahan" },
  { hs_code: "0808.10.00", description_id: "Apel segar", description_en: "Apples, fresh", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Apel impor LARTAS — wajib RIPH Kementan, SPI Kemendag, karantina tumbuhan", category: "Buah-Buahan" },

  // ── Chapter 09: Kopi, Teh, Rempah ────────────────────────────────────────
  { hs_code: "0901.11.00", description_id: "Kopi tidak dipanggang, tidak mengandung kafein", description_en: "Coffee, not roasted, not decaffeinated", unit: "kg", bm_mfn: 20, bm_acfta: 0, lartas_export: true, regulator_export: "Kemendag", lartas_desc: "Ekspor kopi mentah wajib ET-Kopi (Eksportir Terdaftar Kopi) dari Kemendag", category: "Kopi & Rempah" },
  { hs_code: "0902.10.00", description_id: "Teh hijau (tidak difermentasi) dalam kemasan ≤ 3kg", description_en: "Green tea, not fermented, in packaging ≤3kg", unit: "kg", bm_mfn: 15, bm_acfta: 5, lartas_import: true, regulator_import: "BPOM / Kemendag", lartas_desc: "Wajib izin edar BPOM dan SPI Kemendag untuk produk pangan", category: "Kopi & Rempah" },
  { hs_code: "0904.11.00", description_id: "Lada (merica) tidak dihancurkan/ditumbuk", description_en: "Pepper (Piper spp.), not crushed or ground", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_export: true, regulator_export: "Kemendag", lartas_desc: "Ekspor lada wajib ET-Lada dari Kemendag", category: "Kopi & Rempah" },

  // ── Chapter 10: Serealia ──────────────────────────────────────────────────
  { hs_code: "1001.99.10", description_id: "Gandum durum keras untuk pangan", description_en: "Durum wheat for food", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Bulog", lartas_desc: "Wajib karantina pertanian (SPS), izin impor gandum dari Bulog/importir terdaftar", category: "Serealia" },
  { hs_code: "1006.10.10", description_id: "Benih padi (gabah untuk bibit)", description_en: "Rice in husk (paddy/rough), for sowing", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan", lartas_desc: "Benih padi impor sangat terbatas, wajib izin Kementan dan karantina", category: "Serealia" },
  { hs_code: "1006.30.00", description_id: "Beras setengah atau seluruhnya digiling", description_en: "Semi-milled or wholly milled rice", unit: "kg", bm_mfn: 25, bm_acfta: 20, lartas_import: true, regulator_import: "Bulog / Kementan", lartas_desc: "Impor beras hanya Perum Bulog atau pemegang izin khusus Kementan; kuota dan karantina wajib", perizinan_import: { docs: ["Izin Kementan / SPI khusus", "SPS Karantina Pertanian", "Fumigasi"] }, category: "Serealia" },
  { hs_code: "1007.10.10", description_id: "Benih sorgum (untuk bibit)", description_en: "Sorghum grain, seed quality, for sowing", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan", lartas_desc: "Benih serealia wajib izin Kementan dan karantina pertanian", category: "Serealia" },

  // ── Chapter 11: Tepung & Pati ─────────────────────────────────────────────
  { hs_code: "1101.00.10", description_id: "Tepung terigu dari gandum", description_en: "Wheat or meslin flour", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Tepung & Pati" },
  { hs_code: "1108.12.00", description_id: "Pati jagung (maize starch)", description_en: "Maize (corn) starch", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Tepung & Pati" },

  // ── Chapter 15: Lemak & Minyak Nabati ─────────────────────────────────────
  { hs_code: "1511.10.00", description_id: "Minyak sawit mentah (CPO)", description_en: "Palm oil, crude", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_export: true, regulator_export: "Kemendag", lartas_desc: "Ekspor CPO diatur kuota dan pungutan ekspor; wajib ET-CPO dari Kemendag", category: "Lemak & Minyak" },
  { hs_code: "1511.90.36", description_id: "Refined Bleached Deodorized Palm Oil (RBD)", description_en: "RBD palm oil, in packings ≤20kg", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, notes: "Pasar domestik kuat; impor jarang, ekspor dominan", category: "Lemak & Minyak" },
  { hs_code: "1507.10.00", description_id: "Minyak kedelai mentah (crude soybean oil)", description_en: "Soya-bean oil, crude", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Lemak & Minyak" },
  { hs_code: "1512.11.00", description_id: "Minyak bunga matahari, minyak safflower — mentah", description_en: "Sunflower-seed or safflower oil, crude", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Lemak & Minyak" },

  // ── Chapter 17: Gula ──────────────────────────────────────────────────────
  { hs_code: "1701.12.00", description_id: "Gula tebu mentah (raw cane sugar)", description_en: "Raw cane sugar, not containing added flavouring", unit: "kg", bm_mfn: 5, bm_acfta: 5, lartas_import: true, regulator_import: "Kemendag / Kemenperin", lartas_desc: "Gula mentah impor wajib SPI Kemendag, kuota, dan diperuntukkan untuk industri pengolahan", category: "Gula" },
  { hs_code: "1701.91.10", description_id: "Gula putih (white/refined sugar) kadar pol ≥ 99.7", description_en: "Refined white sugar, pol ≥ 99.7", unit: "kg", bm_mfn: 50, bm_acfta: 30, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "Gula putih impor — tarif BM tinggi dan kuota ketat dari Kemendag", category: "Gula" },

  // ── Chapter 21: Makanan Olahan ────────────────────────────────────────────
  { hs_code: "2101.11.00", description_id: "Ekstrak, esens, dan konsentrat kopi", description_en: "Extracts, essences and concentrates of coffee", unit: "kg", bm_mfn: 15, bm_acfta: 5, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Produk pangan olahan wajib izin edar BPOM (MD/ML) dan SPS karantina pangan", category: "Makanan Olahan" },
  { hs_code: "2106.10.00", description_id: "Konsentrat protein dan bahan berprotein tekstur", description_en: "Protein concentrates and textured protein substances", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Wajib izin edar BPOM (MD/ML) untuk produk pangan olahan", category: "Makanan Olahan" },
  { hs_code: "2103.10.00", description_id: "Kecap kedelai (soy sauce)", description_en: "Soya sauce", unit: "liter", bm_mfn: 20, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Wajib izin edar BPOM", category: "Makanan Olahan" },

  // ── Chapter 22: Minuman ───────────────────────────────────────────────────
  { hs_code: "2204.21.10", description_id: "Anggur/wine dalam kemasan ≤ 2 liter", description_en: "Wine in containers ≤2L", unit: "liter", bm_mfn: 150, bm_acfta: 150, ppnbm_rate: 20, lartas_import: true, regulator_import: "BPOM / Kemendag / BC", lartas_desc: "Minuman beralkohol dikenai cukai dan tarif BM sangat tinggi; wajib izin edar BPOM dan Persetujuan Impor BC", category: "Minuman Beralkohol" },
  { hs_code: "2208.30.10", description_id: "Whisky (skotlandia/bourbon) dalam kemasan ≤ 2 liter", description_en: "Whiskies in containers ≤2L", unit: "liter", bm_mfn: 150, bm_acfta: 150, ppnbm_rate: 40, lartas_import: true, regulator_import: "BPOM / BC", lartas_desc: "Minuman keras — cukai alkohol tinggi, wajib izin edar BPOM dan cukai BC", category: "Minuman Beralkohol" },
  { hs_code: "2009.11.00", description_id: "Jus jeruk beku (frozen orange juice)", description_en: "Orange juice, frozen", unit: "liter", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Wajib izin edar BPOM (MD/ML) untuk produk minuman", category: "Minuman" },

  // ── Chapter 24: Tembakau ──────────────────────────────────────────────────
  { hs_code: "2401.10.10", description_id: "Tembakau Virginia tidak dipanggang, untuk Virginia flue cured", description_en: "Unstemmed flue-cured Virginia tobacco", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / BC", lartas_desc: "Tembakau impor wajib SPI Kemendag dan cukai", category: "Tembakau" },
  { hs_code: "2402.20.00", description_id: "Rokok mengandung tembakau", description_en: "Cigarettes containing tobacco", unit: "batang", bm_mfn: 40, bm_acfta: 40, ppnbm_rate: 57, ppn_rate: 11, pph22_rate: 0, lartas_import: true, regulator_import: "BC / Kemenkeu", lartas_desc: "Rokok impor dikenai cukai pita cukai dan BM sangat tinggi; hanya untuk konsumsi sangat terbatas", category: "Tembakau" },

  // ── Chapter 25: Mineral ───────────────────────────────────────────────────
  { hs_code: "2515.11.00", description_id: "Marmer dan travertin (untuk bangunan)", description_en: "Marble and travertine, crude or roughly trimmed", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Mineral & Batu" },
  { hs_code: "2523.29.00", description_id: "Semen Portland lainnya (putih, dll)", description_en: "Other Portland cements", unit: "kg", bm_mfn: 15, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenperin", lartas_desc: "Semen wajib SNI 15-7064 dan izin impor Kemenperin", category: "Bahan Bangunan" },

  // ── Chapter 27: BBM & Minyak Bumi ────────────────────────────────────────
  { hs_code: "2709.00.00", description_id: "Minyak mentah bumi (crude petroleum)", description_en: "Petroleum oils, crude", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "SKK Migas / BPH Migas", lartas_desc: "Impor minyak mentah hanya oleh Pertamina atau pemegang IUP; pengawasan SKK Migas", category: "Energi & BBM" },
  { hs_code: "2710.12.11", description_id: "Bensin (petrol) oktan ≥ 95 (RON 95+)", description_en: "Motor spirit (petrol) RON ≥ 95", unit: "liter", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPH Migas", lartas_desc: "Impor BBM hanya badan usaha berlisensi BPH Migas; Pertamina/PPI", category: "Energi & BBM" },
  { hs_code: "2710.19.21", description_id: "Solar (automotive diesel oil)", description_en: "Automotive diesel oil (gasoil)", unit: "liter", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPH Migas", lartas_desc: "Wajib izin BPH Migas; importir BBM terbatas", category: "Energi & BBM" },
  { hs_code: "2711.19.00", description_id: "Gas alam cair (LNG) dalam keadaan cair", description_en: "Liquefied natural gas", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kementerian ESDM / PGN", lartas_desc: "LNG impor hanya oleh badan usaha berlisensi ESDM; termasuk PGN dan Pertamina LNG", category: "Energi & BBM" },

  // ── Chapter 28: Kimia Anorganik ───────────────────────────────────────────
  { hs_code: "2801.10.00", description_id: "Klor (chlorine)", description_en: "Chlorine", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, notes: "Bahan kimia berbahaya — wajib MSDS dan label berbahaya; pengawasan BAPETEN jika radioaktif", category: "Kimia Anorganik" },
  { hs_code: "2804.10.00", description_id: "Hidrogen (hydrogen gas)", description_en: "Hydrogen", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, notes: "Gas berbahaya — wajib standar keamanan IATA/IMDG untuk pengiriman", category: "Kimia Anorganik" },
  { hs_code: "2814.10.00", description_id: "Amonia anhidrat (anhydrous ammonia)", description_en: "Anhydrous ammonia", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "ESDM / BC", lartas_desc: "Bahan kimia berbahaya — wajib pengawasan keamanan dan standar transportasi; Bapedal", category: "Kimia Anorganik" },

  // ── Chapter 29: Kimia Organik ─────────────────────────────────────────────
  { hs_code: "2905.31.00", description_id: "Etilen glikol (monoetilen glikol)", description_en: "Ethylene glycol (ethanediol)", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Kimia Organik" },
  { hs_code: "2917.32.00", description_id: "Asam ftalat (asam ortoftalat)", description_en: "Dioctyl orthophthalates", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Kimia Organik" },
  { hs_code: "2933.21.10", description_id: "Hidantoin dan turunannya (bahan farmasi)", description_en: "Hydantoin and its derivatives", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Kimia / Farmasi" },

  // ── Chapter 30: Produk Farmasi ────────────────────────────────────────────
  { hs_code: "3001.90.10", description_id: "Kelenjar dan organ lain (kering, untuk farmasetik)", description_en: "Glands and other organs, dried, for therapeutic use", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM / Kemenkes", lartas_desc: "Bahan baku farmasetik wajib izin BPOM dan sertifikat GMP negara asal", category: "Farmasi" },
  { hs_code: "3002.11.00", description_id: "Reagen diagnostik malaria (IVD)", description_en: "Malaria diagnostic reagents (IVD)", unit: "kit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM / Kemenkes", lartas_desc: "Alat kesehatan IVD wajib izin edar BPOM (PKRT/Alkes)", category: "Alat Kesehatan" },
  { hs_code: "3004.90.30", description_id: "Obat-obatan untuk penjualan eceran (campuran)", description_en: "Medicaments mixed or unmixed, for retail sale", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Wajib izin edar BPOM sebelum impor; perlu notifikasi pre-market", perizinan_import: { docs: ["Izin Edar BPOM", "Sertifikat GMP", "QC Release"] }, category: "Farmasi" },
  { hs_code: "3002.20.00", description_id: "Vaksin untuk penggunaan manusia", description_en: "Vaccines for human medicine", unit: "dosis", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM / Kemenkes", lartas_desc: "Vaksin wajib izin edar BPOM, COA (Certificate of Analysis), GMP", category: "Farmasi" },
  { hs_code: "3004.50.10", description_id: "Obat-obatan mengandung vitamin/provitamin", description_en: "Medicaments containing vitamins/provitamins", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Wajib izin edar BPOM; suplemen kesehatan termasuk kategori ini", category: "Farmasi" },
  { hs_code: "3005.10.00", description_id: "Kasa pembalut (surgical dressing) beradhesif", description_en: "Adhesive dressings and articles for surgical use", unit: "pcs", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Alat kesehatan PKRT wajib izin edar BPOM", category: "Alat Kesehatan" },
  { hs_code: "3006.10.10", description_id: "Benang bedah yang dapat diserap (catgut)", description_en: "Sterile surgical catgut", unit: "pcs", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Alat kesehatan invasif wajib izin edar BPOM (Alkes Kelas 3)", category: "Alat Kesehatan" },

  // ── Chapter 31: Pupuk ─────────────────────────────────────────────────────
  { hs_code: "3102.10.00", description_id: "Urea (mengandung N > 45%)", description_en: "Urea, whether or not in aqueous solution", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan / Kemendag", lartas_desc: "Pupuk urea impor wajib SPI Kemendag dan izin distribusi Kementan; subsidi diatur ketat", category: "Pupuk" },
  { hs_code: "3105.20.00", description_id: "Pupuk NPK (nitrogen, fosfor, kalium) campuran", description_en: "Mineral or chemical fertiliser containing N, P, and K", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, notes: "Pupuk NPK untuk industri pertanian; importir terdaftar Kementan", category: "Pupuk" },

  // ── Chapter 32: Cat & Pigmen ──────────────────────────────────────────────
  { hs_code: "3208.10.00", description_id: "Cat dan vernis berbasis polimer poliester", description_en: "Paints and varnishes based on polyesters", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Cat & Pigmen" },
  { hs_code: "3210.00.10", description_id: "Cat dan vernis lainnya berbasis air", description_en: "Other paints and varnishes (water-based)", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Cat & Pigmen" },
  { hs_code: "3215.11.00", description_id: "Tinta hitam untuk percetakan (printing ink, black)", description_en: "Printing ink, black", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Cat & Pigmen" },

  // ── Chapter 33: Kosmetik & Wewangian ─────────────────────────────────────
  { hs_code: "3301.12.00", description_id: "Minyak atsiri dari jeruk (orange essential oil)", description_en: "Essential oils of orange", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Kosmetik & Kecantikan" },
  { hs_code: "3303.00.00", description_id: "Parfum dan air wewangian (perfume, cologne)", description_en: "Perfumes and toilet waters", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Kosmetik impor wajib notifikasi/registrasi BPOM sebelum beredar", category: "Kosmetik & Kecantikan" },
  { hs_code: "3304.10.00", description_id: "Sediaan bibir (lipstick, lip balm)", description_en: "Lip make-up preparations", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Kosmetik wajib notifikasi BPOM; label Bahasa Indonesia wajib", category: "Kosmetik & Kecantikan" },
  { hs_code: "3305.10.00", description_id: "Sampo (hair shampoo)", description_en: "Shampoos", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Wajib notifikasi BPOM sebagai kosmetik; label Bahasa Indonesia wajib", category: "Kosmetik & Kecantikan" },

  // ── Chapter 34: Sabun & Deterjen ─────────────────────────────────────────
  { hs_code: "3401.11.00", description_id: "Sabun mandi (toilet soap)", description_en: "Soap for toilet use", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Sabun mandi wajib notifikasi BPOM sebagai kosmetik; label Bahasa Indonesia", category: "Sabun & Deterjen" },
  { hs_code: "3402.20.10", description_id: "Bahan aktif deterjen, disiapkan dalam kemasan retail", description_en: "Surface-active preparations for retail sale", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Sabun & Deterjen" },

  // ── Chapter 38: Produk Kimia Lainnya ─────────────────────────────────────
  { hs_code: "3808.91.10", description_id: "Insektisida (mengandung pyrethroid)", description_en: "Insecticides containing pyrethroid", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: true, regulator_import: "Kementan", lartas_desc: "Pestisida impor wajib terdaftar di Kementan (Komisi Pestisida); izin edar wajib", perizinan_import: { docs: ["Pendaftaran Pestisida Kementan", "Izin Distribusi", "MSDS"] }, category: "Pestisida" },
  { hs_code: "3824.99.90", description_id: "Sediaan kimia lainnya (NCEK) — campuran", description_en: "Other chemical preparations, NEC", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Kimia Lainnya" },

  // ── Chapter 39: Plastik ───────────────────────────────────────────────────
  { hs_code: "3901.10.00", description_id: "Polietilena (PE) densitas rendah (LDPE), bentuk primer", description_en: "Polyethylene having density < 0.94, in primary forms", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Plastik" },
  { hs_code: "3902.10.00", description_id: "Polipropilena (PP) dalam bentuk primer", description_en: "Polypropylene in primary forms", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Plastik" },
  { hs_code: "3904.10.00", description_id: "PVC (Polyvinyl chloride) murni, bentuk primer", description_en: "Poly(vinyl chloride) not mixed with any other substances", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Plastik" },
  { hs_code: "3905.12.00", description_id: "Poli(vinil asetat), dalam larutan (PVAc)", description_en: "Poly(vinyl acetate), in aqueous dispersion", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Plastik" },
  { hs_code: "3917.21.00", description_id: "Tabung, pipa, dan slang plastik polimer etilena", description_en: "Tubes, pipes of polyethylene", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Plastik" },
  { hs_code: "3923.10.00", description_id: "Kotak, peti, dan wadah sejenisnya dari plastik", description_en: "Boxes, cases, crates of plastics", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Plastik" },
  { hs_code: "3926.90.99", description_id: "Barang plastik lainnya (NCEK)", description_en: "Other articles of plastics, NEC", unit: "kg", bm_mfn: 10, bm_acfta: 0, bm_afta: 0, lartas_import: false, category: "Plastik" },

  // ── Chapter 40: Karet ─────────────────────────────────────────────────────
  { hs_code: "4002.11.00", description_id: "Lateks karet sintetis SBR (styrene-butadiene)", description_en: "Styrene-butadiene rubber (SBR) latex", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_export: true, regulator_export: "Kemendag", lartas_desc: "Ekspor karet alam wajib ET-Karet", category: "Karet" },
  { hs_code: "4011.10.00", description_id: "Ban karet baru untuk kendaraan penumpang", description_en: "New pneumatic tyres for motor cars", unit: "unit", bm_mfn: 15, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenperin / Kemendag", lartas_desc: "Ban wajib SNI, Pertek Kemendag; BMAD berlaku untuk ban dari China (China antidumping)", perizinan_import: { docs: ["SNI (wajib)", "PI Kemendag / Pertek", "Cek BMAD compliance"] }, category: "Karet / Otomotif" },
  { hs_code: "4011.20.00", description_id: "Ban karet baru untuk bus dan truk", description_en: "New pneumatic tyres for buses or lorries", unit: "unit", bm_mfn: 15, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenperin / Kemendag", lartas_desc: "Wajib SNI dan Pertek Kemendag; ban truk dikenai BMAD jika dari China", category: "Karet / Otomotif" },
  { hs_code: "4011.40.00", description_id: "Ban karet baru untuk sepeda motor", description_en: "New pneumatic tyres for motorcycles", unit: "unit", bm_mfn: 15, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenperin / Kemendag", lartas_desc: "Ban motor wajib SNI dan PI Kemendag", category: "Karet / Otomotif" },
  { hs_code: "4016.93.00", description_id: "Gasket dan seal dari karet vulkanisasi", description_en: "Gaskets and similar joints of vulcanised rubber", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Karet" },

  // ── Chapter 42: Tas & Koper ───────────────────────────────────────────────
  { hs_code: "4202.11.10", description_id: "Koper keras dengan casing logam", description_en: "Trunks and suitcases with outer surface of metal", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_import: false, category: "Tas & Koper" },
  { hs_code: "4202.22.10", description_id: "Dompet kulit kecil (wallets, purses)", description_en: "Wallets, purses of leather or composition leather", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_import: false, category: "Tas & Koper" },

  // ── Chapter 44: Kayu & Produk Kayu ───────────────────────────────────────
  { hs_code: "4403.11.00", description_id: "Kayu bulat (log) kayu jenis konifera, treated", description_en: "Coniferous wood in the rough, treated", unit: "m3", bm_mfn: 0, bm_acfta: 0, lartas_export: true, regulator_export: "KLHK", lartas_desc: "Ekspor kayu bulat dari hutan alam dilarang; wajib V-Legal (SVLK)", category: "Kayu" },
  { hs_code: "4407.10.10", description_id: "Kayu gergajian konifera, tebal > 6 mm", description_en: "Coniferous wood sawn/chipped lengthwise, > 6mm thick", unit: "m3", bm_mfn: 0, bm_acfta: 0, lartas_export: true, regulator_export: "KLHK", lartas_desc: "Ekspor kayu olahan wajib V-Legal (SVLK) dari KLHK", category: "Kayu" },
  { hs_code: "4412.33.00", description_id: "Kayu lapis (plywood) non-konifera, ≥ 6 lapisan", description_en: "Plywood of non-coniferous wood, ≥ 6 plies", unit: "m3", bm_mfn: 15, bm_acfta: 0, lartas_import: false, lartas_export: true, regulator_export: "KLHK", lartas_desc: "Ekspor plywood wajib V-Legal (SVLK)", category: "Kayu" },

  // ── Chapter 47-48: Pulp & Kertas ─────────────────────────────────────────
  { hs_code: "4702.00.00", description_id: "Pulp kimia dari kayu, larut (dissolving pulp)", description_en: "Chemical wood pulp, dissolving grades", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, lartas_export: true, regulator_export: "KLHK", lartas_desc: "Ekspor pulp wajib V-Legal SVLK dan izin KLHK", category: "Pulp & Kertas" },
  { hs_code: "4802.55.00", description_id: "Kertas dan karton tidak dilapisi, berat 40–150 g/m²", description_en: "Uncoated paper and paperboard, 40–150 g/m²", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Pulp & Kertas" },
  { hs_code: "4820.10.00", description_id: "Buku tulis, agenda, notepad dari kertas", description_en: "Registers, account books, notebooks, order books", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Kertas & Alat Tulis" },

  // ── Chapter 50-63: Tekstil & Pakaian ─────────────────────────────────────
  { hs_code: "5209.41.00", description_id: "Kain denim dari kapas, minimal 85% kapas, > 200 g/m²", description_en: "Denim woven fabrics of cotton, ≥ 85% cotton, > 200 g/m²", unit: "m²", bm_mfn: 25, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / Kemenperin", lartas_desc: "Kain impor wajib PI Kemendag dan LS Surveyor untuk produk tekstil (Permendag No. 36/2023)", category: "Tekstil" },
  { hs_code: "5407.61.00", description_id: "Kain tenunan dari benang filamen sintetis >= 85% poliester", description_en: "Woven fabrics of synthetic filament yarn, ≥ 85% polyester", unit: "m²", bm_mfn: 25, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "Wajib PI Kemendag dan LS Surveyor — kategori TPT tertentu", category: "Tekstil" },
  { hs_code: "6109.10.00", description_id: "Kaos (T-shirt) dari kapas, rajutan", description_en: "T-shirts of cotton, knitted or crocheted", unit: "pcs", bm_mfn: 25, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / Kemenperin", lartas_desc: "TPT wajib PI Kemendag dan LS (Laporan Surveyor) — Permendag 36/2023", perizinan_import: { docs: ["PI (Persetujuan Impor) Kemendag", "LS Surveyor ditunjuk"] }, category: "Pakaian" },
  { hs_code: "6110.20.11", description_id: "Sweater/pullover dari kapas, rajutan", description_en: "Jerseys, pullovers of cotton, knitted", unit: "pcs", bm_mfn: 25, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "TPT wajib PI Kemendag dan LS Surveyor", category: "Pakaian" },
  { hs_code: "6204.62.00", description_id: "Celana panjang wanita dari kapas", description_en: "Women's trousers of cotton", unit: "pcs", bm_mfn: 25, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "TPT — wajib PI Kemendag dan LS Surveyor", category: "Pakaian" },
  { hs_code: "6302.10.00", description_id: "Linen tidur rajutan atau kaitan", description_en: "Bed linen, knitted or crocheted", unit: "pcs", bm_mfn: 20, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "Kategori TPT — wajib PI Kemendag", category: "Linen & Sprei" },
  { hs_code: "6305.33.00", description_id: "Karung dan kantongan dari polipropilena", description_en: "Sacks and bags of polypropylene strip", unit: "kg", bm_mfn: 15, bm_acfta: 0, lartas_import: false, category: "Kemasan Tekstil" },

  // ── Chapter 64: Alas Kaki ─────────────────────────────────────────────────
  { hs_code: "6402.91.10", description_id: "Sepatu olahraga (sport shoes) sol & upper karet/plastik", description_en: "Footwear with rubber/plastic sole and upper, outer ankle coverage", unit: "pasang", bm_mfn: 20, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / Kemenperin", lartas_desc: "Alas kaki impor wajib PI Kemendag dan SNI jika tercakup SNI wajib", category: "Alas Kaki" },
  { hs_code: "6403.51.00", description_id: "Sepatu kulit (leather upper) menutupi pergelangan kaki", description_en: "Footwear with leather upper covering the ankle", unit: "pasang", bm_mfn: 20, bm_acfta: 0, lartas_import: false, category: "Alas Kaki" },

  // ── Chapter 68: Batu, Semen, Keramik ─────────────────────────────────────
  { hs_code: "6907.21.10", description_id: "Ubin keramik lantai, penyerapan air ≤ 0.5%", description_en: "Glazed ceramic floor tiles, water absorption ≤0.5%", unit: "m²", bm_mfn: 20, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenperin", lartas_desc: "Keramik lantai wajib SNI ISO 13006; cek BMAD untuk produk China", perizinan_import: { docs: ["SNI ISO 13006", "SPI Kemendag jika kuota berlaku", "Cek BMAD China"] }, category: "Keramik & Bahan Bangunan" },
  { hs_code: "6910.10.00", description_id: "Wastafel/lavatory dari porselen atau keramik", description_en: "Ceramic sinks/wash basins, of porcelain/china", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_import: false, category: "Keramik Sanitasi" },

  // ── Chapter 69: Produk Keramik ────────────────────────────────────────────
  { hs_code: "6903.20.00", description_id: "Bata tahan api mengandung > 50% alumina (Al₂O₃)", description_en: "Refractory bricks containing > 50% alumina", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Keramik Industri" },
  { hs_code: "6912.00.10", description_id: "Peralatan meja keramik (bukan porselen)", description_en: "Ceramic tableware and kitchenware, not porcelain", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_import: false, category: "Keramik Rumah Tangga" },

  // ── Chapter 70: Kaca ──────────────────────────────────────────────────────
  { hs_code: "7005.21.00", description_id: "Kaca float (flat glass) tidak diarmature, tidak diwarnai", description_en: "Non-wired float glass, uncoloured, rectangular, ≤5mm", unit: "m²", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Kaca" },
  { hs_code: "7020.00.11", description_id: "Barang kaca lainnya untuk keperluan laboratorium", description_en: "Other glassware for laboratory use", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Kaca Laboratorium" },

  // ── Chapter 72: Besi & Baja ───────────────────────────────────────────────
  { hs_code: "7204.10.00", description_id: "Skrap besi tuang (cast iron scrap)", description_en: "Cast iron waste and scrap", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "KLHK", lartas_desc: "Skrap logam masuk kategori Limbah B3 — wajib izin KLHK dan verifikasi teknis", perizinan_import: { docs: ["Izin KLHK (bila B3)", "Rekomendasi Kemenperin", "LS Surveyor"] }, category: "Besi & Baja / Skrap" },
  { hs_code: "7209.16.00", description_id: "Lembaran baja digulung dingin (cold-rolled) ≤ 0.5 mm", description_en: "Cold-rolled flat-rolled steel ≤0.5mm", unit: "kg", bm_mfn: 12.5, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenperin", lartas_desc: "Baja tertentu wajib SNI, API, dan laporan surveyor Kemenperin", category: "Baja & Metal" },
  { hs_code: "7214.91.00", description_id: "Batang baja (steel bar/rod) — bukan tulangan", description_en: "Other bars and rods of steel", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Baja & Metal" },
  { hs_code: "7217.10.00", description_id: "Kawat baja karbon rendah (wire rod) tidak dilapisi", description_en: "Wire of non-alloy steel, not plated/coated", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Baja & Metal" },
  { hs_code: "7227.90.00", description_id: "Kawat baja dari baja lainnya/alloy steel (wire rod)", description_en: "Bars and rods of alloy steel, hot-rolled in irregular coils", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Baja & Metal" },
  { hs_code: "7306.30.10", description_id: "Pipa baja las, diameter ≤ 406.4 mm", description_en: "Welded steel pipes ≤406.4mm diameter", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenperin", lartas_desc: "Pipa baja tertentu wajib SNI dan terdaftar di Kemenperin", category: "Baja & Metal" },
  { hs_code: "7308.90.99", description_id: "Konstruksi baja lainnya (NCEK)", description_en: "Other structures of iron or steel, NEC", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenperin", lartas_desc: "Konstruksi baja tertentu wajib SNI bila masuk kategori produk yang diawasi", category: "Konstruksi Baja" },

  // ── Chapter 73: Barang Besi & Baja ────────────────────────────────────────
  { hs_code: "7312.10.10", description_id: "Kawat baja beruntai (wire strand) untuk beton pratekan", description_en: "Stranded wire of iron/steel, for prestressed concrete", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Baja & Metal" },
  { hs_code: "7318.15.11", description_id: "Baut (bolt) dari besi/baja, M6–M16", description_en: "Bolts of iron or steel, M6–M16", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Fastener & Hardware" },
  { hs_code: "7318.16.10", description_id: "Mur (nuts) dari baja stainless", description_en: "Nuts of stainless steel", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Fastener & Hardware" },

  // ── Chapter 74: Tembaga ───────────────────────────────────────────────────
  { hs_code: "7401.00.00", description_id: "Matte tembaga; tembaga semen (cement copper)", description_en: "Copper mattes; cement copper", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_export: true, regulator_export: "ESDM", lartas_desc: "Ekspor bijih tembaga dan konsentrat dilarang (PMK mineral), wajib pengolahan dalam negeri", category: "Tembaga" },
  { hs_code: "7408.11.00", description_id: "Kawat tembaga murni (diameter > 6 mm)", description_en: "Copper wire of refined copper, > 6mm diameter", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Tembaga" },

  // ── Chapter 76: Aluminium ─────────────────────────────────────────────────
  { hs_code: "7601.10.00", description_id: "Aluminium tidak dicampur (aluminium unwrought)", description_en: "Aluminium, not alloyed, unwrought", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Aluminium" },
  { hs_code: "7604.10.10", description_id: "Batang aluminium (aluminium bar/rod) tidak dicampur", description_en: "Bars and rods of aluminium, not alloyed", unit: "kg", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Aluminium" },
  { hs_code: "7610.10.00", description_id: "Pintu, jendela, bingkai dari aluminium", description_en: "Aluminium doors, windows, door frames", unit: "kg", bm_mfn: 12.5, bm_acfta: 0, lartas_import: false, category: "Aluminium" },

  // ── Chapter 84: Mesin & Peralatan Mekanis ────────────────────────────────
  { hs_code: "8408.10.11", description_id: "Motor diesel untuk propulsi kapal, daya ≤ 15 kW", description_en: "Marine propulsion diesel engines, ≤15 kW", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Mesin & Motor" },
  { hs_code: "8413.11.00", description_id: "Pompa cairan untuk bahan bakar, pelumas, cairan pendingin", description_en: "Fuel, lubricant or cooling medium pumps for engines", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Pompa & Kompresor" },
  { hs_code: "8414.51.11", description_id: "Kipas angin (fan) untuk kamar mandi, daya ≤ 125 W", description_en: "Fans for bathrooms/kitchens, power ≤125 W", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "Kipas/ventilasi listrik wajib SNI dan label hemat energi ESDM", category: "Peralatan Rumah Tangga" },
  { hs_code: "8415.10.10", description_id: "AC split dinding, kapasitas ≤ 21,000 BTU", description_en: "Air conditioning split units (wall-mounted), ≤21,000 BTU", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / ESDM", lartas_desc: "AC wajib SNI, label hemat energi ESDM, dan Pertek Kemendag untuk produk tertentu", perizinan_import: { docs: ["SNI", "Label Hemat Energi ESDM", "Pertek Kemendag"] }, category: "HVAC & Elektronik" },
  { hs_code: "8418.10.11", description_id: "Kulkas kombinasi (refrigerator-freezer), volume ≤ 230 liter", description_en: "Combined refrigerator-freezer, ≤230L", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / ESDM", lartas_desc: "Kulkas wajib SNI dan label hemat energi ESDM", category: "Peralatan Rumah Tangga" },
  { hs_code: "8421.21.10", description_id: "Mesin pengolah air minum (water purifier) rumah tangga", description_en: "Apparatus for filtering/purifying water, household type", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Mesin & Peralatan" },
  { hs_code: "8443.31.00", description_id: "Mesin cetak (printer) inkjet — bukan multifunction", description_en: "Inkjet printing machines (not multifunction)", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Mesin Cetak" },
  { hs_code: "8443.32.10", description_id: "Printer inkjet multifungsi (MFP)", description_en: "Inkjet multifunction printers", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "Wajib SNI dan PI Kemendag untuk produk IT tertentu", category: "Mesin Cetak & IT" },
  { hs_code: "8450.11.00", description_id: "Mesin cuci kapasitas ≤ 10 kg (untuk rumah tangga)", description_en: "Washing machines of dry linen capacity ≤10 kg", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / ESDM", lartas_desc: "Mesin cuci wajib SNI dan label hemat energi ESDM", category: "Peralatan Rumah Tangga" },
  { hs_code: "8452.10.10", description_id: "Mesin jahit rumah tangga", description_en: "Sewing machines for domestic use", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Mesin Jahit" },
  { hs_code: "8471.30.20", description_id: "Laptop termasuk notebook dan subnotebook", description_en: "Laptops including notebooks and subnotebooks", unit: "unit", bm_mfn: 0, bm_acfta: 0, bm_afta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "Wajib SNI IEC 62368-1, Pertek Kemendag, label Bahasa Indonesia", perizinan_import: { docs: ["SNI IEC 62368-1", "Pertek Kemendag (PI)", "Label BI"] }, category: "Komputer & IT" },
  { hs_code: "8471.41.00", description_id: "Mesin pengolah data otomatis (PC desktop)", description_en: "Other automatic data processing machines — desktop type", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "PC desktop wajib SNI, Pertek Kemendag, label BI", category: "Komputer & IT" },
  { hs_code: "8471.50.00", description_id: "Unit pengolah (processor/CPU) komputer", description_en: "Processing units for data processing machines", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Komputer & IT" },
  { hs_code: "8471.60.20", description_id: "Unit masukan/keluaran komputer — keyboard, mouse", description_en: "Input or output units for data processing machines", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Komputer & IT" },
  { hs_code: "8471.70.20", description_id: "Unit penyimpanan data — SSD, HDD eksternal", description_en: "Storage units for data processing machines", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Komputer & IT" },
  { hs_code: "8473.30.90", description_id: "Spare part laptop dan komputer lainnya", description_en: "Parts and accessories of computers, NEC", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Komputer & IT" },
  { hs_code: "8479.89.99", description_id: "Mesin mekanis lainnya (NCEK) untuk industri", description_en: "Other mechanical appliances, NEC", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Mesin Industri" },
  { hs_code: "8481.20.10", description_id: "Katup (valve) untuk transmisi oleo-hidraulik", description_en: "Valves for oleohydraulic or pneumatic transmissions", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Mesin & Komponen" },
  { hs_code: "8482.10.00", description_id: "Bearing bola radial (ball bearing) — semua ukuran", description_en: "Ball bearings, all sizes", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Mesin & Komponen" },
  { hs_code: "8501.10.11", description_id: "Motor listrik AC, daya output ≤ 37.5 W", description_en: "AC motors of output ≤37.5W", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Motor Listrik" },
  { hs_code: "8502.11.20", description_id: "Generator diesel (genset), daya output ≤ 75 kVA", description_en: "Electric generating sets — diesel, ≤75 kVA", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Genset & Generator" },
  { hs_code: "8504.40.10", description_id: "Adaptor daya / power supply ≤ 1 kVA", description_en: "Static converters (power supply units), ≤1 kVA", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Elektronik" },
  { hs_code: "8516.50.00", description_id: "Oven microwave", description_en: "Microwave ovens", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "Wajib SNI IEC 60335, Pertek Kemendag", category: "Peralatan Rumah Tangga" },
  { hs_code: "8516.60.10", description_id: "Oven listrik (bukan microwave) untuk dapur", description_en: "Electric cooking ranges/ovens (not microwave)", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "Oven listrik wajib SNI dan Pertek Kemendag untuk produk elektronik rumah tangga tertentu", category: "Peralatan Rumah Tangga" },
  { hs_code: "8537.10.99", description_id: "Panel listrik / switchboard tegangan ≤ 1000V lainnya", description_en: "Other boards/panels for voltage ≤1000V", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Listrik & Panel" },
  { hs_code: "8541.40.00", description_id: "Panel surya fotovoltaik (solar panel/PV module)", description_en: "Photovoltaic cells — solar panels", unit: "Wp", bm_mfn: 0, bm_acfta: 0, lartas_import: false, notes: "Panel surya impor dikenai safeguard measure KPPI; cek regulasi terbaru", category: "Energi Terbarukan" },
  { hs_code: "8543.70.99", description_id: "Mesin dan peralatan elektrik lainnya (NCEK)", description_en: "Other electrical machines and apparatus, NEC", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Elektronik Lainnya" },

  // ── Chapter 85: Mesin Listrik & Elektronik ────────────────────────────────
  { hs_code: "8507.60.00", description_id: "Baterai lithium-ion (Li-ion battery)", description_en: "Lithium-ion accumulators", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, notes: "Kargo udara butuh perlakuan khusus DG (Dangerous Goods) IATA", category: "Elektronik / Baterai" },
  { hs_code: "8517.12.11", description_id: "Telepon genggam (smartphone)", description_en: "Smartphones (mobile/cellular phones)", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / Kominfo / Kemenperin", lartas_desc: "Smartphone wajib IMEI terdaftar Kemenperin, SNI, Pertek Kominfo, PI Kemendag, label BI", perizinan_import: { docs: ["Registrasi IMEI Kemenperin", "SNI", "Pertek Kominfo", "PI Kemendag", "Label BI"], note: "Smartphone LARTAS ketat — wajib sertifikasi sebelum impor" }, category: "Elektronik / Handphone" },
  { hs_code: "8517.62.90", description_id: "Alat penerima sinyal untuk komunikasi nirkabel (router, AP)", description_en: "Machines for receiving/converting/transmitting wireless signals", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kominfo / Kemendag", lartas_desc: "Perangkat telekomunikasi/WiFi wajib sertifikasi Kominfo (SDPPI), SNI, dan PI Kemendag", category: "Telekomunikasi" },
  { hs_code: "8518.10.10", description_id: "Mikrofon dan dudukannya untuk studio/broadcast", description_en: "Microphones having a frequency range 300–3400 Hz", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Audio & Elektronik" },
  { hs_code: "8518.22.10", description_id: "Loudspeaker tunggal dalam tabung — speaker PA", description_en: "Single loudspeakers, mounted in their enclosures", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Audio & Elektronik" },
  { hs_code: "8518.40.11", description_id: "Amplifier audio untuk siaran radio", description_en: "Audio-frequency electric amplifiers for radio", unit: "unit", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Audio & Elektronik" },
  { hs_code: "8518.30.00", description_id: "Headset/earphone (combined microphone & loudspeaker)", description_en: "Headphones, earphones and combined microphone/speaker sets", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Audio & Elektronik" },
  { hs_code: "8521.10.00", description_id: "Perekam/pemutar video dengan pita magnetik (VCR/VTR)", description_en: "Video recording or reproducing apparatus, magnetic tape type", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Audio-Video" },
  { hs_code: "8525.80.31", description_id: "Kamera digital (still image) multifungsi ≥ 6 megapixel", description_en: "Digital cameras of ≥6 megapixels", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Kamera & Optik" },
  { hs_code: "8526.10.00", description_id: "Radar (alat deteksi gelombang radio)", description_en: "Radar apparatus", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kominfo / Kemhan", lartas_desc: "Radar tertentu wajib izin Kominfo dan/atau Kemhan — terutama untuk penggunaan militer", category: "Telekomunikasi" },
  { hs_code: "8528.72.11", description_id: "Televisi LCD/LED ≤ 36 inci", description_en: "LCD/LED TV sets ≤36 inch", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / Kemenperin", lartas_desc: "TV LCD/LED wajib SNI IEC 62368, Pertek Kemendag, label BI", category: "Elektronik / TV" },
  { hs_code: "8528.72.21", description_id: "Televisi LCD/LED > 36 s.d. 60 inci", description_en: "LCD/LED TV sets >36 to 60 inch", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag", lartas_desc: "Wajib SNI, Pertek Kemendag, label BI", category: "Elektronik / TV" },
  { hs_code: "8531.10.00", description_id: "Alarm pencuri atau kebakaran listrik (smoke/burglar alarm)", description_en: "Burglar or fire alarms and similar apparatus", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Keamanan Elektronik" },
  { hs_code: "8544.11.10", description_id: "Kawat gulungan dari tembaga berlapis (copper winding wire)", description_en: "Winding wire of copper, lacquered", unit: "kg", bm_mfn: 5, bm_acfta: 0, lartas_import: false, category: "Listrik & Kabel" },
  { hs_code: "8544.42.10", description_id: "Kabel listrik berinsulasi tegangan ≤ 80V", description_en: "Electric conductors ≤80V, insulated", unit: "kg", bm_mfn: 15, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenperin", lartas_desc: "Kabel listrik wajib SNI dan terdaftar di LSPro Kemenperin", category: "Listrik & Kabel" },
  { hs_code: "8545.19.10", description_id: "Elektrode karbon/grafit (carbon electrode) untuk industri", description_en: "Carbon/graphite electrodes for industrial use", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Listrik & Industri" },

  // ── Chapter 86: Kereta Api ────────────────────────────────────────────────
  { hs_code: "8601.10.00", description_id: "Lokomotif tenaga diesel-elektrik", description_en: "Rail locomotives powered by diesel-electric", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenhub", lartas_desc: "Kereta api wajib tipe approval Kemenhub, sertifikat laik operasi", category: "Kereta Api" },

  // ── Chapter 87: Kendaraan Bermotor ────────────────────────────────────────
  { hs_code: "8703.23.52", description_id: "Kendaraan bermotor roda 4, mesin 1500–3000cc, CBU", description_en: "Motor cars 1500–3000cc, CBU", unit: "unit", bm_mfn: 50, bm_acfta: 0, ppnbm_rate: 15, lartas_import: true, regulator_import: "Kemendag / Kemenperin", lartas_desc: "Kendaraan CBU wajib Pertek dan PI Kemendag serta Tipe Approval Kemenhub", perizinan_import: { docs: ["Pertek Kemendag", "PI Kemendag", "Tipe Approval Kemenhub", "SNI"] }, category: "Otomotif" },
  { hs_code: "8703.24.52", description_id: "Kendaraan bermotor roda 4, mesin > 3000cc, CBU", description_en: "Motor cars > 3000cc, CBU", unit: "unit", bm_mfn: 50, bm_acfta: 0, ppnbm_rate: 40, lartas_import: true, regulator_import: "Kemendag / Kemenperin", lartas_desc: "Kendaraan premium CBU — tarif BM dan PPnBM sangat tinggi", category: "Otomotif" },
  { hs_code: "8703.40.52", description_id: "Kendaraan listrik murni (BEV), CBU", description_en: "Electric vehicles (BEV), CBU, fully battery-powered", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / Kemenperin / Kemenhub", lartas_desc: "EV CBU mendapat insentif BM 0% (2023-2025); wajib Pertek Kemendag dan Tipe Approval Kemenhub", notes: "Insentif EV: tarif BM 0%, PPnBM 0% untuk periode 2023-2026 berdasarkan regulasi terbaru", category: "Otomotif EV" },
  { hs_code: "8706.00.11", description_id: "Chassis kendaraan bermotor dengan mesin dipasang, untuk bus", description_en: "Chassis for buses, with engine mounted", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / Kemenhub", lartas_desc: "Chassis kendaraan wajib Tipe Approval Kemenhub dan PI Kemendag", category: "Otomotif" },
  { hs_code: "8708.29.99", description_id: "Suku cadang bodi kendaraan lainnya (NCEK)", description_en: "Other body parts for motor vehicles, NEC", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Suku Cadang Otomotif" },
  { hs_code: "8708.40.10", description_id: "Gearbox kendaraan bermotor (transmisi)", description_en: "Gear boxes and parts for motor vehicles", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Suku Cadang Otomotif" },
  { hs_code: "8708.94.00", description_id: "Kemudi kendaraan bermotor (steering wheels)", description_en: "Steering wheels, steering columns and steering boxes", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Suku Cadang Otomotif" },
  { hs_code: "8708.99.99", description_id: "Suku cadang kendaraan bermotor lainnya (NCEK)", description_en: "Other parts and accessories of motor vehicles, NEC", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Suku Cadang Otomotif" },
  { hs_code: "8711.60.10", description_id: "Sepeda motor listrik (electric motorcycle/moped)", description_en: "Electric motorcycles", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / Kemenperin", lartas_desc: "Motor listrik mendapat insentif; wajib Pertek Kemendag dan Tipe Approval Kemenhub", notes: "Motor listrik: insentif PPnBM 0% untuk 2023-2026", category: "Otomotif EV" },

  // ── Chapter 88: Pesawat Udara ─────────────────────────────────────────────
  { hs_code: "8802.11.00", description_id: "Helikopter, berat kosong ≤ 2000 kg", description_en: "Helicopters of unladen weight ≤2000 kg", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenhub (DGCA)", lartas_desc: "Pesawat udara wajib type certificate DGCA, airworthiness certificate, dan izin impor Kemenhub", category: "Pesawat & Penerbangan" },
  { hs_code: "8802.40.00", description_id: "Pesawat terbang, berat kosong > 15,000 kg", description_en: "Aeroplanes of unladen weight > 15,000 kg", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenhub (DGCA)", lartas_desc: "Pesawat komersial wajib izin DGCA, certificate of airworthiness, dan aircraft registration DGCA", category: "Pesawat & Penerbangan" },
  { hs_code: "8806.21.00", description_id: "Drone/UAV tanpa awak untuk pengawasan ≤ 250g", description_en: "Unmanned aircraft (UAV) for surveillance, ≤250g", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kominfo / Kemhub", lartas_desc: "UAV/drone wajib registrasi di Kominfo dan izin terbang Kemenhub (khusus > 250g)", category: "Drone & UAV" },

  // ── Chapter 89: Kapal & Perahu ────────────────────────────────────────────
  { hs_code: "8901.10.00", description_id: "Kapal penumpang dan kapal feri", description_en: "Cruise ships, excursion boats, ferry boats", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenhub / DJPL", lartas_desc: "Kapal wajib survey kelas (BKI), flagging dari DJPL, SOLAS compliance", category: "Kapal & Transportasi Laut" },
  { hs_code: "8903.19.00", description_id: "Yacht dan kapal rekreasi lainnya (panjang > 7.5m)", description_en: "Other sailboats and other vessels for pleasure/sports, >7.5m", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "Kemenhub", lartas_desc: "Kapal rekreasi wajib izin Kemenhub dan registrasi kapal; cek asas cabotage", category: "Kapal" },

  // ── Chapter 90: Instrumen Optik & Presisi ────────────────────────────────
  { hs_code: "9001.10.00", description_id: "Serat optik (optical fibre) — kabel komunikasi", description_en: "Optical fibres and optical fibre bundles", unit: "m", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Optik & Instrumen" },
  { hs_code: "9006.30.00", description_id: "Kamera fotografi khusus untuk film bawah air", description_en: "Cameras for underwater use, aerial survey etc.", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Kamera & Optik" },
  { hs_code: "9018.11.10", description_id: "Alat elektrokardiografi (EKG/ECG)", description_en: "Electrocardiographs", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM / Kemenkes", lartas_desc: "Alat kesehatan diagnostik wajib izin edar BPOM (Alkes Kelas 2)", category: "Alat Kesehatan" },
  { hs_code: "9018.19.10", description_id: "Alat elektromedis lainnya (termasuk USG, defibrilator)", description_en: "Electro-medical apparatus, NEC (incl. USG, defibrillators)", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM / Kemenkes", lartas_desc: "Alat kesehatan diagnostik/terapi wajib izin edar BPOM; Kelas 2 atau 3 tergantung risiko", category: "Alat Kesehatan" },
  { hs_code: "9018.32.00", description_id: "Jarum suntik (syringe) tanpa jarum", description_en: "Tubular metal needles/syringes without needles", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM / Kemenkes", lartas_desc: "Alat kesehatan PKRT wajib izin edar BPOM", category: "Alat Kesehatan" },
  { hs_code: "9021.10.00", description_id: "Alat penyangga tulang (splint dan perlengkapan fraktur)", description_en: "Orthopaedic splints and fracture appliances", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "BPOM", lartas_desc: "Alat kesehatan ortopedi wajib izin edar BPOM (Alkes Kelas 2)", category: "Alat Kesehatan" },
  { hs_code: "9027.10.00", description_id: "Alat analisis gas/asap (gas analysis apparatus)", description_en: "Gas analysis apparatus", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Instrumen & Laboratorium" },

  // ── Chapter 91: Jam & Arloji ──────────────────────────────────────────────
  { hs_code: "9101.11.00", description_id: "Jam tangan kuarsa dari emas/platina (wrist watch)", description_en: "Wrist watches, battery-operated, of precious metal case", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Jam & Arloji" },
  { hs_code: "9102.11.00", description_id: "Jam tangan kuarsa (non-precious metal case)", description_en: "Wrist watches, battery-operated, not precious metal", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Jam & Arloji" },

  // ── Chapter 94: Furnitur ─────────────────────────────────────────────────
  { hs_code: "9401.30.10", description_id: "Kursi putar (swivel chair) untuk kantor", description_en: "Swivel seats with variable height adjustment (office chairs)", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_import: false, category: "Furnitur" },
  { hs_code: "9401.61.00", description_id: "Kursi berlapis (upholstered seat) dari kayu", description_en: "Upholstered seats with wooden frame", unit: "unit", bm_mfn: 20, bm_acfta: 0, bm_afta: 0, lartas_import: false, category: "Furnitur" },
  { hs_code: "9401.80.10", description_id: "Kursi plastik (plastic chairs) untuk outdoor", description_en: "Seats of plastic, for outdoor use", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_import: false, category: "Furnitur" },
  { hs_code: "9403.20.00", description_id: "Furnitur logam untuk kantor/industri", description_en: "Other metal furniture (for offices/industry)", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Furnitur" },
  { hs_code: "9403.60.10", description_id: "Furnitur kayu untuk kamar tidur", description_en: "Wooden bedroom furniture", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_export: true, regulator_export: "KLHK", lartas_desc: "Ekspor furnitur kayu wajib V-Legal (SVLK) dan izin PHPL dari KLHK", category: "Furnitur" },
  { hs_code: "9404.90.10", description_id: "Kasur busa (foam mattress) dari poliuretan", description_en: "Mattresses of polyurethane foam", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_import: false, category: "Furnitur & Kasur" },

  // ── Chapter 95: Mainan & Alat Olahraga ───────────────────────────────────
  { hs_code: "9503.00.10", description_id: "Mainan anak — boneka mewah (stuffed toys)", description_en: "Stuffed toys for children", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / BSN", lartas_desc: "Mainan wajib SNI ISO 8124, PI Kemendag, label BI", perizinan_import: { docs: ["SNI ISO 8124", "PI Kemendag", "Label BI"] }, category: "Mainan" },
  { hs_code: "9503.00.90", description_id: "Mainan anak lainnya (NCEK)", description_en: "Other toys for children, NEC", unit: "unit", bm_mfn: 20, bm_acfta: 0, lartas_import: true, regulator_import: "Kemendag / BSN", lartas_desc: "Mainan NCEK wajib SNI ISO 8124 bila tercakup dan PI Kemendag", category: "Mainan" },
  { hs_code: "9504.50.00", description_id: "Konsol permainan video (game console)", description_en: "Video game consoles and machines", unit: "unit", bm_mfn: 0, bm_acfta: 0, lartas_import: false, category: "Mainan / Elektronik" },
  { hs_code: "9506.61.10", description_id: "Raket tenis (tennis racket)", description_en: "Tennis rackets, framed or unframed", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Alat Olahraga" },
  { hs_code: "9506.91.00", description_id: "Alat olahraga dan kebugaran (fitness equipment)", description_en: "Articles and equipment for general physical exercise/gymnastics", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Alat Olahraga & Kebugaran" },

  // ── Chapter 96-97: Berbagai ───────────────────────────────────────────────
  { hs_code: "9601.10.00", description_id: "Gading gajah yang dikerjakan (worked ivory)", description_en: "Worked ivory", unit: "kg", bm_mfn: 0, bm_acfta: 0, lartas_import: true, regulator_import: "KLHK / CITES", lartas_desc: "Dilarang impor/ekspor — CITES Appendix I; hanya untuk keperluan ilmiah/museum dengan izin khusus", category: "Barang Terlarang CITES" },
  { hs_code: "9608.10.00", description_id: "Pulpen dengan mata bola (ballpoint pen)", description_en: "Ball point pens", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Alat Tulis" },
  { hs_code: "9609.10.00", description_id: "Pensil grafit dengan alas kayu (pencil)", description_en: "Pencils with graphite core, wooden-cased", unit: "unit", bm_mfn: 10, bm_acfta: 0, lartas_import: false, category: "Alat Tulis" },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

// Minimum row count threshold — if DB already has this many rows, skip seeding.
// Set higher than SEED_DATA.length to force re-seed when data is expanded.
const MIN_SEED_ROWS = SEED_DATA.length;

export async function runBtkiMigration(): Promise<void> {
  try {
    await createBtkiTable();

    const existing = await db.execute(sql`SELECT COUNT(*) as cnt FROM btki_tariff`);
    const count = Number((existing.rows[0] as Record<string, unknown>)?.cnt ?? 0);
    if (count >= MIN_SEED_ROWS) {
      logger.info({ count, total: SEED_DATA.length }, "[btki] Table already seeded — skipping");
      return;
    }

    logger.info({ existing: count, toSeed: SEED_DATA.length }, "[btki] Seeding BTKI 2022 tariff data...");

    // Seed in batches of 20 to avoid pgBouncer multi-statement limits
    for (const row of SEED_DATA) {
      const hs = row.hs_code.replace(/\./g, "");
      const hs6 = hs.slice(0, 6);
      const hs4 = hs.slice(0, 4);
      const hs2 = hs.slice(0, 2);

      await db.execute(sql`
        INSERT INTO btki_tariff (
          hs_code, hs_code_6, hs_code_4, hs_code_2,
          description_id, description_en, unit,
          bm_mfn, bm_acfta, bm_afta, bm_aifta, bm_aanzfta, bm_ahkfta, bm_asfta, bm_akfta,
          ppn_rate, ppnbm_rate, pph22_rate, pph22_non_api,
          lartas_import, lartas_export, lartas_desc,
          regulator_import, regulator_export,
          perizinan_import, perizinan_export,
          notes, category
        ) VALUES (
          ${row.hs_code}, ${hs6}, ${hs4}, ${hs2},
          ${row.description_id}, ${row.description_en ?? null}, ${row.unit ?? null},
          ${row.bm_mfn ?? null}, ${row.bm_acfta ?? null}, ${row.bm_afta ?? null},
          ${row.bm_aifta ?? null}, ${row.bm_aanzfta ?? null}, ${row.bm_ahkfta ?? null},
          ${row.bm_asfta ?? null}, ${row.bm_akfta ?? null},
          ${row.ppn_rate ?? 11}, ${row.ppnbm_rate ?? 0}, ${row.pph22_rate ?? 2.5}, 7.5,
          ${row.lartas_import ?? false}, ${row.lartas_export ?? false},
          ${row.lartas_desc ?? null},
          ${row.regulator_import ?? null}, ${row.regulator_export ?? null},
          ${row.perizinan_import ? JSON.stringify(row.perizinan_import) : null},
          ${row.perizinan_export ? JSON.stringify(row.perizinan_export) : null},
          ${row.notes ?? null}, ${row.category}
        )
        ON CONFLICT (hs_code) DO UPDATE SET
          description_id   = EXCLUDED.description_id,
          description_en   = EXCLUDED.description_en,
          bm_mfn           = EXCLUDED.bm_mfn,
          bm_acfta         = EXCLUDED.bm_acfta,
          bm_afta          = EXCLUDED.bm_afta,
          ppn_rate         = EXCLUDED.ppn_rate,
          ppnbm_rate       = EXCLUDED.ppnbm_rate,
          pph22_rate       = EXCLUDED.pph22_rate,
          pph22_non_api    = EXCLUDED.pph22_non_api,
          lartas_import    = EXCLUDED.lartas_import,
          lartas_export    = EXCLUDED.lartas_export,
          lartas_desc      = EXCLUDED.lartas_desc,
          regulator_import = EXCLUDED.regulator_import,
          perizinan_import = EXCLUDED.perizinan_import,
          category         = EXCLUDED.category,
          notes            = EXCLUDED.notes,
          updated_at       = NOW()
      `).catch((e) => logger.warn({ hs_code: row.hs_code, err: String(e) }, "[btki] seed row failed"));
    }

    logger.info({ total: SEED_DATA.length }, "[btki] BTKI 2022 seed complete");
  } catch (err) {
    logger.error({ err }, "[btki] Migration failed");
    throw err;
  }
}
