import { Router, Request, Response } from "express";
import type OpenAI from "openai";
import { getOpenAI } from "../lib/openaiClient.js";
import { db } from "@workspace/db";
import { suppliersTable, btkiTariffTable } from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { ilike, eq, and, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

// ─── System Prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah AI Import Advisor dari B2B Marketplace and Logistic — spesialis pengurusan impor dari China ke Indonesia, dengan akses ke database BTKI 2022 dan informasi LARTAS (Larangan dan Pembatasan) resmi.

ALUR KERJA WAJIB — ikuti urutan ini:
1. Saat customer menyebut "mau import" / "impor" / "kirim dari China" → SEGERA panggil request_documents
2. Saat commodity/barang sudah diketahui → panggil lookup_hs_code
3. Setelah punya HS Code → SEGERA panggil lookup_btki_tariff untuk cek tarif BM + LARTAS
4. Saat customer menyebut nilai barang (harga, invoice, USD) → SEGERA panggil calculate_landed_cost
5. Setelah punya info cukup (barang + rute + moda) → panggil generate_import_rfq
6. Setelah RFQ → panggil recommend_vendors
7. Saat tahu estimasi berat/CBM tapi belum ada nilai invoice → panggil estimate_cost

ATURAN:
- Bahasa Indonesia sopan dan ringkas
- Jangan tanya satu per satu — panggil tools SEGERA saat info cukup
- Setelah setiap tool selesai: rangkum hasil dalam 1–3 kalimat
- Jika ada beberapa pilihan (moda laut vs udara), tanyakan SEKALI lalu lanjutkan
- Tujuan akhir: customer punya draft RFQ + estimasi biaya yang jelas
- Saat lookup_btki_tariff menunjukkan LARTAS = true, WAJIB jelaskan perizinan yang diperlukan

PENGETAHUAN BTKI & LARTAS:
- Database BTKI 2022 (Buku Tarif Kepabeanan Indonesia) mencakup tarif BM MFN dan preferensial (ACFTA/AFTA/AIFTA/dll)
- LARTAS (Larangan dan Pembatasan): barang yang memerlukan izin khusus dari kementerian/lembaga sebelum impor
- ACFTA (ASEAN-China FTA): COO Form E dari China memberi tarif preferensial lebih rendah atau 0%
- PPN Impor: 11% dari (Nilai CIF + Bea Masuk)
- PPh Pasal 22: 2.5% (API/importir berlisensi) atau 7.5% (non-API)
- Dokumen wajib PIB: Packing List, Invoice, B/L atau AWB, COO (untuk tarif preferensial)
- Referensi resmi: INSW (insw.go.id), BTKI (btki.kemenkeu.go.id), Beacukai (beacukai.go.id)`;

// ─── Tools ─────────────────────────────────────────────────────────────────────
const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "request_documents",
      description: "Tampilkan checklist dokumen yang dibutuhkan untuk proses impor. WAJIB dipanggil pertama kali saat customer mau impor.",
      parameters: {
        type: "object",
        properties: {
          commodity:  { type: "string", description: "Nama/deskripsi barang yang akan diimpor" },
          origin:     { type: "string", description: "Negara asal (default: China)" },
          mode:       { type: "string", enum: ["sea", "air", "both", "unknown"], description: "Moda pengiriman" },
        },
        required: ["commodity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_hs_code",
      description: "Cari dan sarankan kode HS (Harmonized System / Bea Cukai) untuk komoditas impor.",
      parameters: {
        type: "object",
        properties: {
          commodity: { type: "string", description: "Nama/deskripsi barang" },
          details:   { type: "string", description: "Spesifikasi tambahan: material, fungsi, dimensi, kapasitas (opsional)" },
        },
        required: ["commodity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_import_rfq",
      description: "Buat draft RFQ (Request for Quotation) impor berdasarkan informasi yang sudah dikumpulkan.",
      parameters: {
        type: "object",
        properties: {
          commodity:       { type: "string", description: "Nama barang" },
          origin:          { type: "string", description: "Kota/negara asal" },
          destination:     { type: "string", description: "Kota/negara tujuan (default: Jakarta, Indonesia)" },
          hsCode:          { type: "string", description: "Kode HS (opsional)" },
          estimatedWeight: { type: "number", description: "Estimasi berat total (kg)" },
          estimatedCbm:    { type: "number", description: "Estimasi volume (CBM)" },
          mode:            { type: "string", enum: ["Sea Freight", "Air Freight"], description: "Moda pengiriman" },
          quantity:        { type: "string", description: "Jumlah barang/unit" },
          notes:           { type: "string", description: "Catatan tambahan" },
        },
        required: ["commodity", "origin", "mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_vendors",
      description: "Rekomendasikan vendor freight forwarder yang aktif untuk rute impor ini.",
      parameters: {
        type: "object",
        properties: {
          mode:   { type: "string", enum: ["Sea Freight", "Air Freight", "Both"], description: "Moda pengiriman" },
          origin: { type: "string", description: "Negara asal barang" },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estimate_cost",
      description: "Hitung estimasi biaya pengiriman impor berdasarkan berat, volume, dan rute.",
      parameters: {
        type: "object",
        properties: {
          mode:      { type: "string", enum: ["Sea Freight", "Air Freight"], description: "Moda pengiriman" },
          origin:    { type: "string", description: "Negara asal" },
          weightKg:  { type: "number", description: "Berat total (kg)" },
          cbm:       { type: "number", description: "Volume (CBM)" },
          commodity: { type: "string", description: "Nama barang (untuk estimasi bea masuk)" },
          hsCode:    { type: "string", description: "Kode HS jika sudah diketahui" },
          invoiceUsd:{ type: "number", description: "Nilai invoice (USD) untuk kalkulasi bea masuk" },
        },
        required: ["mode", "origin"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_btki_tariff",
      description: "Cari tarif bea masuk resmi dari database BTKI 2022 berdasarkan HS Code. Mengembalikan BM MFN, tarif preferensial ACFTA/AFTA, PPn, PPh22, dan status LARTAS (perizinan impor). WAJIB dipanggil setelah lookup_hs_code berhasil.",
      parameters: {
        type: "object",
        properties: {
          hsCode:    { type: "string", description: "Kode HS 4–10 digit (contoh: 8471.30.00 atau 847130)" },
          commodity: { type: "string", description: "Nama barang untuk fallback pencarian keyword" },
        },
        required: ["hsCode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_lartas",
      description: "Cek LARTAS (Larangan dan Pembatasan) untuk komoditas impor/ekspor — mengembalikan daftar perizinan, regulator, dan dokumen yang diperlukan dari database BTKI 2022.",
      parameters: {
        type: "object",
        properties: {
          hsCode:    { type: "string", description: "HS Code yang sudah diketahui (opsional)" },
          commodity: { type: "string", description: "Nama/deskripsi barang untuk pencarian LARTAS" },
          tradeType: { type: "string", enum: ["import", "export", "both"], description: "Jenis perdagangan (default: import)" },
        },
        required: ["commodity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_landed_cost",
      description: "Hitung total biaya impor (landed cost) secara akurat berdasarkan nilai invoice, tarif BTKI nyata, dan biaya freight. Panggil ini setelah lookup_btki_tariff berhasil dan customer memberikan nilai barang (USD). Hasilkan breakdown lengkap: BM, PPN, PPh22, freight, dan total biaya dalam Rupiah.",
      parameters: {
        type: "object",
        properties: {
          hsCode:        { type: "string",  description: "HS Code 8 digit (wajib untuk tarif BTKI akurat)" },
          invoiceUsd:    { type: "number",  description: "Nilai invoice/harga barang dalam USD (FOB)" },
          freightUsd:    { type: "number",  description: "Biaya pengiriman (freight) dalam USD — estimasi atau aktual" },
          insuranceUsd:  { type: "number",  description: "Biaya asuransi dalam USD (opsional, default 0.5% dari invoice)" },
          hasCoo:        { type: "boolean", description: "Apakah ada COO Form E (ACFTA) dari China? Menentukan apakah tarif preferensial dipakai" },
          importerType:  { type: "string",  enum: ["api", "non_api"], description: "Tipe importir: API (2.5% PPh22) atau non-API (7.5% PPh22). Default: api" },
          usdRate:       { type: "number",  description: "Kurs USD/IDR yang dipakai (default: 16000)" },
          weightKg:      { type: "number",  description: "Berat total (kg) — untuk estimasi freight jika freightUsd tidak diberikan" },
          cbm:           { type: "number",  description: "Volume (CBM) — untuk estimasi freight sea freight" },
          mode:          { type: "string",  enum: ["Sea Freight", "Air Freight"], description: "Moda pengiriman" },
          commodity:     { type: "string",  description: "Nama barang (untuk fallback jika HS Code tidak ditemukan di BTKI)" },
          quantity:      { type: "number",  description: "Jumlah unit (opsional, untuk kalkulasi biaya per unit)" },
        },
        required: ["hsCode", "invoiceUsd", "mode"],
      },
    },
  },
];

// ─── Tool Executors ────────────────────────────────────────────────────────────

function execRequestDocuments(args: { commodity: string; origin?: string; mode?: string }) {
  const origin = args.origin ?? "China";
  const mode   = args.mode ?? "unknown";

  const docs = [
    { id: "packing_list", label: "Packing List", desc: "Daftar isi paket dari pengirim — wajib untuk kepabeanan", required: true,  icon: "📋" },
    { id: "invoice",      label: "Commercial Invoice", desc: "Faktur komersial dari supplier China — nilai barang untuk kalkulasi bea masuk", required: true, icon: "🧾" },
    { id: "hs_code",      label: "HS Code",  desc: "Kode tarif bea cukai Indonesia (8 digit) — menentukan tarif bea masuk", required: true, icon: "🏷️" },
    { id: "bl_awb",       label: mode === "air" ? "Airway Bill (AWB)" : "Bill of Lading (B/L)", desc: mode === "air" ? "Dokumen pengangkutan udara dari maskapai" : "Dokumen pengangkutan laut dari pelayaran", required: true, icon: "🚢" },
    { id: "coo",          label: "Certificate of Origin (COO)", desc: "Sertifikat asal barang — wajib untuk tarif preferensial ASEAN-China (ACFTA)", required: false, icon: "📜" },
    { id: "pib",          label: "PIB (Pemberitahuan Impor Barang)", desc: "Dokumen pabean Indonesia — dibuat saat barang tiba, dibantu PPJK/forwarder", required: true, icon: "🇮🇩" },
  ];

  return JSON.stringify({
    step: "documents",
    commodity: args.commodity,
    origin,
    mode,
    checklist: docs,
    tips: [
      "Minta Packing List & Invoice dalam format PDF atau Excel dari supplier",
      "COO form E dari China memberi diskon tarif ACFTA (0–5% vs normal 5–25%)",
      "PPJK/forwarder akan bantu proses PIB dan kepabeanan setibanya barang",
    ],
  });
}

async function execLookupHsCode(args: { commodity: string; details?: string }): Promise<string> {
  try {
    const openai  = getOpenAI();
    const prompt  = `Berikan 3 kemungkinan kode HS (Harmonized System) Indonesia untuk barang berikut:
Barang: ${args.commodity}
${args.details ? `Detail: ${args.details}` : ""}

Format respons JSON (array of 3):
[
  {"hsCode": "XXXXXXXX", "description": "Deskripsi HS Indonesia", "dutyRate": "X%", "confidence": "high|medium|low", "notes": "catatan singkat"},
  ...
]
Jawab HANYA JSON array, tanpa markdown.`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 400,
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "[]";
    const suggestions = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return JSON.stringify({ step: "hs_code", commodity: args.commodity, suggestions });
  } catch (e) {
    logger.warn({ err: e }, "HS code lookup error");
    return JSON.stringify({
      step: "hs_code",
      commodity: args.commodity,
      suggestions: [
        { hsCode: "84XX.XX.XX", description: "Mesin dan peralatan mekanis", dutyRate: "0–5%", confidence: "medium", notes: "Perlu verifikasi dengan BTKI 2022" },
      ],
      warning: "Estimasi AI — wajib konfirmasi dengan PPJK atau portal beacukai.go.id",
    });
  }
}

// ─── BTKI Tariff Lookup ───────────────────────────────────────────────────────

async function execLookupBtkiTariff(args: { hsCode: string; commodity?: string }): Promise<string> {
  try {
    const raw    = args.hsCode.trim().replace(/\./g, "");
    const hs8    = raw.slice(0, 8);
    const hs6    = raw.slice(0, 6);
    const hs4    = raw.slice(0, 4);

    // Try exact, then 8-digit, then 6-digit, then keyword fallback
    const rows = await db
      .select()
      .from(btkiTariffTable)
      .where(
        or(
          sql`REPLACE(${btkiTariffTable.hsCode}, '.', '') = ${raw}`,
          sql`REPLACE(${btkiTariffTable.hsCode}, '.', '') LIKE ${hs8 + "%"}`,
          eq(btkiTariffTable.hsCode6, hs6),
          eq(btkiTariffTable.hsCode4, hs4),
        )
      )
      .limit(5);

    if (rows.length === 0 && args.commodity) {
      const kwRows = await db
        .select()
        .from(btkiTariffTable)
        .where(
          or(
            ilike(btkiTariffTable.descriptionId, `%${args.commodity}%`),
            ilike(btkiTariffTable.descriptionEn, `%${args.commodity}%`),
          )
        )
        .limit(3);
      if (kwRows.length > 0) {
        return JSON.stringify({
          step:          "btki_tariff",
          queried:       args.hsCode,
          found:         false,
          keywordMatch:  true,
          results:       kwRows.map(formatBtkiRow),
          warning:       "HS Code tidak ditemukan — menampilkan hasil berdasarkan kata kunci komoditas",
          source:        "BTKI 2022 — database lokal",
          inswLink:      "https://www.insw.go.id/intr",
        });
      }
      return JSON.stringify({
        step: "btki_tariff", found: false, queried: args.hsCode,
        warning: "HS Code dan komoditas tidak ditemukan dalam database BTKI lokal. Cek langsung: https://btki.kemenkeu.go.id",
        inswLink: "https://www.insw.go.id/intr",
      });
    }

    const best = rows[0]!;
    const pref: Record<string, string> = {};
    if (best.bmAcfta  != null) pref["ACFTA (China-ASEAN)"]    = `${best.bmAcfta}%`;
    if (best.bmAfta   != null) pref["AFTA (ASEAN)"]            = `${best.bmAfta}%`;
    if (best.bmAifta  != null) pref["AIFTA (India)"]           = `${best.bmAifta}%`;
    if (best.bmAanzfta!= null) pref["AANZFTA (Aus/NZ)"]        = `${best.bmAanzfta}%`;
    if (best.bmAhkfta != null) pref["AHKFTA (Hong Kong)"]      = `${best.bmAhkfta}%`;
    if (best.bmAkfta  != null) pref["AKFTA (Korea)"]           = `${best.bmAkfta}%`;

    const bmMfn = Number(best.bmMfn ?? 0);
    const bmAcfta = best.bmAcfta != null ? Number(best.bmAcfta) : null;
    const acftaSaving = bmAcfta !== null ? bmMfn - bmAcfta : null;

    return JSON.stringify({
      step:         "btki_tariff",
      found:        true,
      hsCode:       best.hsCode,
      category:     best.category,
      descriptionId: best.descriptionId,
      descriptionEn: best.descriptionEn,
      unit:         best.unit,
      tariff: {
        bmMfn:        `${bmMfn}%`,
        preferensial: pref,
        ppn:          `${best.ppnRate ?? 11}%`,
        ppnbm:        `${best.ppnbmRate ?? 0}%`,
        pph22Api:     `${best.pph22Rate ?? 2.5}%`,
        pph22NonApi:  `${best.pph22NonApi ?? 7.5}%`,
        acftaSavingNote: acftaSaving !== null && acftaSaving > 0
          ? `Dengan COO Form E ACFTA, hemat ${acftaSaving}% BM (${bmMfn}% → ${bmAcfta}%)`
          : bmAcfta === 0 ? "ACFTA: BM 0% — pastikan supplier siapkan COO Form E" : null,
      },
      lartas: {
        import:          best.lartasImport,
        export:          best.lartasExport,
        description:     best.lartasDesc,
        regulatorImport: best.regulatorImport,
        regulatorExport: best.regulatorExport,
        perizinanImport: best.perizinanImport,
        perizinanExport: best.perizinanExport,
        alert:           best.lartasImport
          ? `⚠️ LARTAS AKTIF — izin dari ${best.regulatorImport ?? "kementerian terkait"} wajib sebelum proses impor`
          : "Tidak ada LARTAS khusus untuk komoditas ini",
      },
      source:   "BTKI 2022 — Buku Tarif Kepabeanan Indonesia (database lokal, diperbarui per 2022)",
      inswLink: "https://www.insw.go.id/intr",
      btkiLink: "https://btki.kemenkeu.go.id/",
      note:     "Selalu konfirmasi tarif final dengan PPJK/Bea Cukai karena bisa berubah setiap tahun",
    });
  } catch (err) {
    logger.warn({ err }, "execLookupBtkiTariff error");
    return JSON.stringify({
      step: "btki_tariff", found: false,
      error: "Gagal query database BTKI. Cek langsung: https://btki.kemenkeu.go.id",
    });
  }
}

async function execLookupLartas(args: { hsCode?: string; commodity: string; tradeType?: string }): Promise<string> {
  const tradeType = args.tradeType ?? "import";
  try {
    let rows: (typeof btkiTariffTable.$inferSelect)[] = [];

    if (args.hsCode) {
      const raw = args.hsCode.replace(/\./g, "");
      rows = await db.select().from(btkiTariffTable).where(
        or(
          sql`REPLACE(${btkiTariffTable.hsCode}, '.', '') = ${raw}`,
          eq(btkiTariffTable.hsCode6, raw.slice(0, 6)),
          eq(btkiTariffTable.hsCode4, raw.slice(0, 4)),
        )
      ).limit(5);
    }

    if (rows.length === 0) {
      rows = await db.select().from(btkiTariffTable).where(
        or(
          ilike(btkiTariffTable.descriptionId, `%${args.commodity}%`),
          ilike(btkiTariffTable.descriptionEn,  `%${args.commodity}%`),
          ilike(btkiTariffTable.category,        `%${args.commodity}%`),
        )
      ).limit(5);
    }

    const lartasRows = rows.filter((r) =>
      tradeType === "export" ? r.lartasExport : tradeType === "both" ? (r.lartasImport || r.lartasExport) : r.lartasImport
    );

    if (rows.length === 0) {
      return JSON.stringify({
        step: "lartas",
        found: false,
        commodity: args.commodity,
        message: "Komoditas tidak ditemukan dalam database LARTAS lokal. Cek INSW: https://www.insw.go.id/intr atau INATRADE: https://inatrade.kemendag.go.id",
      });
    }

    if (lartasRows.length === 0) {
      const row = rows[0]!;
      return JSON.stringify({
        step:       "lartas",
        found:      true,
        hsCode:     row.hsCode,
        commodity:  args.commodity,
        tradeType,
        lartasActive: false,
        message:    `Tidak ada LARTAS ${tradeType} untuk HS ${row.hsCode} — ${row.descriptionId}`,
        source:     "BTKI 2022",
      });
    }

    const row = lartasRows[0]!;
    const isImport = tradeType !== "export";
    return JSON.stringify({
      step:         "lartas",
      found:        true,
      hsCode:       row.hsCode,
      descriptionId: row.descriptionId,
      category:     row.category,
      tradeType,
      lartasActive: true,
      regulator:    isImport ? row.regulatorImport : row.regulatorExport,
      description:  row.lartasDesc,
      perizinan:    isImport ? row.perizinanImport : row.perizinanExport,
      alert:        `⚠️ LARTAS AKTIF — wajib urus izin sebelum impor/ekspor`,
      references: {
        insw:    "https://www.insw.go.id/intr",
        inatrade: "https://inatrade.kemendag.go.id",
        bpom:    row.regulatorImport?.includes("BPOM") ? "https://srs-import.pom.go.id" : undefined,
        kemendag: row.regulatorImport?.includes("Kemendag") ? "https://inatrade.kemendag.go.id" : undefined,
        kominfo:  row.regulatorImport?.includes("Kominfo") ? "https://sdppi.kominfo.go.id" : undefined,
      },
      source: "BTKI 2022 — database lokal",
    });
  } catch (err) {
    logger.warn({ err }, "execLookupLartas error");
    return JSON.stringify({
      step: "lartas", found: false,
      error: "Gagal query LARTAS. Cek INSW: https://www.insw.go.id/intr",
    });
  }
}

// ─── Landed Cost Calculator ───────────────────────────────────────────────────

async function execCalculateLandedCost(args: {
  hsCode: string;
  invoiceUsd: number;
  freightUsd?: number;
  insuranceUsd?: number;
  hasCoo?: boolean;
  importerType?: string;
  usdRate?: number;
  weightKg?: number;
  cbm?: number;
  mode: string;
  commodity?: string;
  quantity?: number;
}): Promise<string> {
  const usdRate     = args.usdRate ?? 16000;
  const invoiceUsd  = args.invoiceUsd;
  const hasCoo      = args.hasCoo ?? false;
  const importerType = args.importerType ?? "api";
  const isSea       = args.mode === "Sea Freight";
  const qty         = args.quantity;

  // ── Freight estimate (if not provided) ─────────────────────────────────────
  let freightUsd = args.freightUsd ?? 0;
  let freightEstimated = false;
  if (freightUsd === 0) {
    freightEstimated = true;
    const kg  = args.weightKg ?? 0;
    const cbm = args.cbm ?? 0;
    if (isSea) {
      const cbmEst = cbm > 0 ? cbm : kg / 500;
      freightUsd = cbmEst > 0 ? Math.round(cbmEst * 80) : Math.round(invoiceUsd * 0.05);
    } else {
      const chargeable = kg > 0 && cbm > 0 ? Math.max(kg, cbm * 167) : (kg || cbm * 167 || 0);
      freightUsd = chargeable > 0 ? Math.round(chargeable * 5) : Math.round(invoiceUsd * 0.10);
    }
  }

  // ── Insurance ──────────────────────────────────────────────────────────────
  const insuranceUsd = args.insuranceUsd ?? Math.round(invoiceUsd * 0.005 * 100) / 100;

  // ── CIF value ─────────────────────────────────────────────────────────────
  const cifUsd = invoiceUsd + freightUsd + insuranceUsd;

  // ── Fetch real BTKI tariff ─────────────────────────────────────────────────
  let bmPct    = 0;
  let ppnPct   = 11;
  let ppnbmPct = 0;
  let pph22Pct = importerType === "api" ? 2.5 : 7.5;
  let tariffSource = "estimasi default";
  let tariffNote   = "";
  let lartasAlert  = "";

  try {
    const raw = args.hsCode.replace(/\./g, "");
    const rows = await db.select().from(btkiTariffTable).where(
      or(
        sql`REPLACE(${btkiTariffTable.hsCode}, '.', '') = ${raw}`,
        sql`REPLACE(${btkiTariffTable.hsCode}, '.', '') LIKE ${raw.slice(0, 8) + "%"}`,
        eq(btkiTariffTable.hsCode6, raw.slice(0, 6)),
        eq(btkiTariffTable.hsCode4, raw.slice(0, 4)),
      )
    ).limit(1);

    if (rows.length > 0) {
      const r = rows[0]!;
      const mfn   = Number(r.bmMfn ?? 0);
      const acfta = r.bmAcfta != null ? Number(r.bmAcfta) : null;

      bmPct    = (hasCoo && acfta !== null) ? acfta : mfn;
      ppnPct   = Number(r.ppnRate ?? 11);
      ppnbmPct = Number(r.ppnbmRate ?? 0);
      pph22Pct = importerType === "api" ? Number(r.pph22Rate ?? 2.5) : Number(r.pph22NonApi ?? 7.5);
      tariffSource = `BTKI 2022 — HS ${r.hsCode}`;

      if (hasCoo && acfta !== null && acfta < mfn) {
        tariffNote = `COO Form E ACFTA aktif → BM ${acfta}% (hemat ${mfn - acfta}% dari MFN ${mfn}%)`;
      } else if (!hasCoo && acfta !== null && acfta < mfn) {
        tariffNote = `💡 Dengan COO Form E dari China, BM bisa turun dari ${mfn}% → ${acfta}% (hemat ${(mfn - acfta) / 100 * cifUsd * usdRate / 1e6 > 0.5 ? `Rp ${((mfn - acfta) / 100 * cifUsd * usdRate / 1e6).toFixed(1)} juta` : `${mfn - acfta}%`})`;
      }
      if (r.lartasImport) {
        lartasAlert = `⚠️ LARTAS: wajib izin dari ${r.regulatorImport ?? "kementerian terkait"} sebelum impor`;
      }
    } else if (args.commodity) {
      const kwRows = await db.select().from(btkiTariffTable).where(
        ilike(btkiTariffTable.descriptionId, `%${args.commodity}%`)
      ).limit(1);
      if (kwRows.length > 0) {
        const r = kwRows[0]!;
        bmPct        = Number(r.bmMfn ?? 0);
        tariffSource = `BTKI 2022 — HS ${r.hsCode} (match keyword)`;
      }
    }
  } catch (e) {
    logger.warn({ e }, "landed cost BTKI lookup failed");
  }

  // ── Tax calculations ────────────────────────────────────────────────────────
  const cifIdr    = cifUsd * usdRate;
  const bmIdr     = Math.round(cifIdr * bmPct / 100);
  const ppnBaseIdr = cifIdr + bmIdr;
  const ppnIdr    = Math.round(ppnBaseIdr * ppnPct / 100);
  const ppnbmIdr  = Math.round(cifIdr * ppnbmPct / 100);
  const pph22Idr  = Math.round(cifIdr * pph22Pct / 100);
  const totalTaxIdr = bmIdr + ppnIdr + ppnbmIdr + pph22Idr;

  // ── Total landed cost ───────────────────────────────────────────────────────
  const freightIdr   = Math.round(freightUsd * usdRate);
  const invoiceIdr   = Math.round(invoiceUsd * usdRate);
  const totalLandedIdr = invoiceIdr + freightIdr + Math.round(insuranceUsd * usdRate) + totalTaxIdr;

  const fmt = (n: number) => `Rp ${(n / 1e6).toFixed(2)}jt`;
  const fmtPct = (p: number) => `${p}%`;
  const perUnit = qty && qty > 0 ? Math.round(totalLandedIdr / qty) : null;

  return JSON.stringify({
    step:          "landed_cost",
    hsCode:        args.hsCode,
    commodity:     args.commodity,
    hasCoo,
    importerType,
    usdRate,
    mode:          args.mode,
    tariffSource,
    tariffNote,
    lartasAlert,

    input: {
      invoiceUsd,
      freightUsd,
      freightEstimated,
      insuranceUsd,
      cifUsd: Math.round(cifUsd * 100) / 100,
    },

    rates: {
      bm:    fmtPct(bmPct),
      ppn:   fmtPct(ppnPct),
      ppnbm: fmtPct(ppnbmPct),
      pph22: fmtPct(pph22Pct),
    },

    breakdown: {
      invoiceIdr:    { label: "Nilai Barang (FOB)",        usd: invoiceUsd,   idr: invoiceIdr,   idrFmt: fmt(invoiceIdr) },
      freightIdr:    { label: "Biaya Freight",             usd: freightUsd,   idr: freightIdr,   idrFmt: fmt(freightIdr), estimated: freightEstimated },
      insuranceIdr:  { label: "Asuransi",                  usd: insuranceUsd, idr: Math.round(insuranceUsd * usdRate), idrFmt: fmt(Math.round(insuranceUsd * usdRate)) },
      cifIdr:        { label: "CIF (Cost+Insurance+Freight)", usd: cifUsd,   idr: Math.round(cifIdr), idrFmt: fmt(Math.round(cifIdr)), isSubtotal: true },
      bmIdr:         { label: `Bea Masuk (${fmtPct(bmPct)} × CIF)`,   idr: bmIdr,    idrFmt: fmt(bmIdr) },
      ppnIdr:        { label: `PPN Impor (${fmtPct(ppnPct)} × CIF+BM)`, idr: ppnIdr, idrFmt: fmt(ppnIdr) },
      ppnbmIdr:      ppnbmPct > 0 ? { label: `PPnBM (${fmtPct(ppnbmPct)} × CIF)`, idr: ppnbmIdr, idrFmt: fmt(ppnbmIdr) } : null,
      pph22Idr:      { label: `PPh 22 (${fmtPct(pph22Pct)} × CIF)`,   idr: pph22Idr, idrFmt: fmt(pph22Idr) },
      totalTaxIdr:   { label: "Total Pajak & Bea Masuk",   idr: totalTaxIdr, idrFmt: fmt(totalTaxIdr), isSubtotal: true },
      totalLandedIdr:{ label: "TOTAL LANDED COST",          idr: totalLandedIdr, idrFmt: fmt(totalLandedIdr), isTotal: true },
      perUnit:       perUnit ? { label: `Biaya per Unit (${qty} unit)`, idr: perUnit, idrFmt: fmt(perUnit) } : null,
    },

    summary: `Total landed cost: ${fmt(totalLandedIdr)} (pajak: ${fmt(totalTaxIdr)}, BM: ${fmt(bmIdr)}, PPN: ${fmt(ppnIdr)}, PPh22: ${fmt(pph22Idr)})`,
    disclaimer: "Kalkulasi berdasarkan BTKI 2022. Tarif aktual dikonfirmasi saat PIB oleh PPJK/Bea Cukai.",
  });
}

function formatBtkiRow(row: typeof btkiTariffTable.$inferSelect) {
  return {
    hsCode: row.hsCode, descriptionId: row.descriptionId,
    bmMfn: `${row.bmMfn ?? 0}%`, bmAcfta: row.bmAcfta != null ? `${row.bmAcfta}%` : null,
    lartasImport: row.lartasImport, lartasExport: row.lartasExport,
    category: row.category,
  };
}

function execGenerateRfq(args: {
  commodity: string; origin: string; destination?: string; hsCode?: string;
  estimatedWeight?: number; estimatedCbm?: number; mode: string;
  quantity?: string; notes?: string;
}) {
  const rfqNumber = `DRAFT-IMP/${new Date().getFullYear()}/${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const now       = new Date().toISOString().split("T")[0];
  const destination = args.destination ?? "Jakarta, Indonesia";

  const rfq = {
    step:        "rfq",
    rfqNumber,
    createdAt:   now,
    status:      "draft",
    details: {
      commodity:   args.commodity,
      origin:      args.origin,
      destination,
      mode:        args.mode,
      hsCode:      args.hsCode ?? "—",
      weight:      args.estimatedWeight ? `${args.estimatedWeight} kg` : "Belum diketahui",
      volume:      args.estimatedCbm    ? `${args.estimatedCbm} CBM`  : "Belum diketahui",
      quantity:    args.quantity ?? "—",
      notes:       args.notes ?? "",
    },
    nextSteps: [
      "Konfirmasi berat dan volume dengan supplier",
      "Upload Packing List & Invoice dari supplier",
      "Pilih vendor freight forwarder dari rekomendasi",
      "Kirim RFQ ke vendor untuk mendapatkan penawaran harga",
    ],
  };

  return JSON.stringify(rfq);
}

async function execRecommendVendors(args: { mode: string; origin?: string }): Promise<string> {
  try {
    const vendors = await db
      .select({
        id:          suppliersTable.id,
        name:        suppliersTable.name,
        serviceType: suppliersTable.serviceType,
        phone:       suppliersTable.phone,
        email:       suppliersTable.contactEmail,
        eta:         suppliersTable.eta,
        etaDaysMin:  suppliersTable.etaDaysMin,
        etaDaysMax:  suppliersTable.etaDaysMax,
        logo:        suppliersTable.logo,
        note:        suppliersTable.note,
      })
      .from(suppliersTable)
      .where(
        and(
          eq(suppliersTable.isActive, true),
          or(
            ilike(suppliersTable.serviceType, "%freight%"),
            ilike(suppliersTable.serviceType, "%logistic%"),
            ilike(suppliersTable.serviceType, "%forwarder%"),
            ilike(suppliersTable.serviceType, "%import%"),
            ilike(suppliersTable.serviceType, "%customs%"),
            ilike(suppliersTable.serviceType, "%pabean%"),
          ),
        ),
      )
      .limit(8);

    if (vendors.length === 0) {
      return JSON.stringify({
        step: "vendors",
        vendors: [],
        note: "Belum ada vendor freight terdaftar di sistem. Tambahkan vendor via menu Pembelian → Vendor.",
      });
    }

    return JSON.stringify({
      step: "vendors",
      mode:    args.mode,
      origin:  args.origin ?? "China",
      vendors: vendors.map((v) => ({
        id:   v.id,
        name: v.name,
        logo: v.logo,
        serviceType: v.serviceType ?? "Freight/Logistik",
        phone: v.phone,
        email: v.email,
        eta:   v.etaDaysMin && v.etaDaysMax
          ? `${v.etaDaysMin}–${v.etaDaysMax} hari`
          : v.eta ?? "Hubungi vendor",
        note: v.note,
      })),
    });
  } catch (e) {
    logger.warn({ err: e }, "recommend vendors error");
    return JSON.stringify({ step: "vendors", vendors: [], error: "Gagal memuat vendor" });
  }
}

function execEstimateCost(args: {
  mode: string; origin: string; weightKg?: number; cbm?: number;
  commodity?: string; hsCode?: string; invoiceUsd?: number;
}) {
  const isSea = args.mode === "Sea Freight";
  const kg    = args.weightKg ?? 0;
  const cbm   = args.cbm ?? 0;

  let freightMin = 0;
  let freightMax = 0;
  let unit       = "";

  if (isSea) {
    if (cbm > 0) {
      const rate = { min: 45, max: 120 };
      freightMin = Math.round(cbm * rate.min);
      freightMax = Math.round(cbm * rate.max);
      unit = `${cbm} CBM × $${rate.min}–$${rate.max}/CBM`;
    } else if (kg > 0) {
      const cbmEst = kg / 500;
      const rate   = { min: 45, max: 120 };
      freightMin = Math.round(cbmEst * rate.min);
      freightMax = Math.round(cbmEst * rate.max);
      unit = `~${cbmEst.toFixed(2)} CBM (dari ${kg} kg) × $${rate.min}–$${rate.max}/CBM`;
    } else {
      return JSON.stringify({
        step: "estimate",
        mode: args.mode,
        error: "Butuh berat (kg) atau volume (CBM) untuk menghitung estimasi Sea Freight",
        hint:  "Minta supplier berikan detail berat dan dimensi paket",
      });
    }
  } else {
    const chargeable = kg > 0 && cbm > 0 ? Math.max(kg, cbm * 167) : (kg || cbm * 167);
    if (chargeable === 0) {
      return JSON.stringify({
        step:  "estimate",
        mode:  args.mode,
        error: "Butuh berat (kg) untuk menghitung estimasi Air Freight",
      });
    }
    const rate = { min: 3, max: 8 };
    freightMin = Math.round(chargeable * rate.min);
    freightMax = Math.round(chargeable * rate.max);
    unit = `${chargeable.toFixed(1)} kg chargeable × $${rate.min}–$${rate.max}/kg`;
  }

  const usdToIdr  = 15800;
  const invoiceUsd = args.invoiceUsd ?? 0;
  const cifUsd    = invoiceUsd + freightMax * 0.1 + (freightMin + freightMax) / 2;

  let taxEstMin = 0;
  let taxEstMax = 0;
  if (invoiceUsd > 0) {
    const bm  = cifUsd * 0.05;
    const ppn = (cifUsd + bm) * 0.11;
    const pph = cifUsd * 0.025;
    taxEstMin = Math.round((bm + ppn + pph) * usdToIdr);
    taxEstMax = Math.round((cifUsd * 0.25 + (cifUsd + cifUsd * 0.25) * 0.11 + cifUsd * 0.025) * usdToIdr * 0.8);
  }

  return JSON.stringify({
    step:     "estimate",
    mode:     args.mode,
    origin:   args.origin,
    currency: "USD",
    freight: {
      min:  freightMin,
      max:  freightMax,
      unit,
      note: "Belum termasuk asuransi, THC, dokumentasi, dan handling",
    },
    customs: invoiceUsd > 0 ? {
      invoiceUsd,
      estimatedBmIdr:  Math.round(invoiceUsd * usdToIdr * 0.05),
      estimatedTaxIdr: { min: taxEstMin, max: taxEstMax },
      note:            "Estimasi kasar — actual tergantung HS Code, COO, dan nilai CIF final",
    } : { note: "Tambahkan nilai invoice (USD) untuk estimasi bea masuk & pajak impor" },
    disclaimer: "Semua angka adalah ESTIMASI. Harga final dikonfirmasi vendor setelah pengajuan RFQ resmi.",
  });
}

// ─── Streaming helper ──────────────────────────────────────────────────────────

async function streamImportChat(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  res: Response,
): Promise<void> {
  const openai = getOpenAI();

  const sse = (data: object) => { res.write(`data: ${JSON.stringify(data)}\n\n`); };

  let loopCount = 0;
  const chatMessages = [...messages];

  while (loopCount++ < 6) {
    const stream = await openai.chat.completions.create({
      model:       "gpt-4o",
      messages:    chatMessages,
      tools:       TOOLS,
      tool_choice: "auto",
      stream:      true,
      temperature: 0.4,
      max_tokens:  1200,
    });

    let textBuffer = "";
    const toolCallMap: Record<number, { id: string; name: string; arguments: string }> = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        textBuffer += delta.content;
        sse({ type: "delta", text: delta.content });
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallMap[tc.index]) toolCallMap[tc.index] = { id: "", name: "", arguments: "" };
          if (tc.id)               toolCallMap[tc.index].id        += tc.id;
          if (tc.function?.name)   toolCallMap[tc.index].name      += tc.function.name;
          if (tc.function?.arguments) toolCallMap[tc.index].arguments += tc.function.arguments;
        }
      }
    }

    const pending = Object.values(toolCallMap).filter((tc) => tc.name);

    if (pending.length === 0) {
      sse({ type: "done" });
      return;
    }

    chatMessages.push({
      role:       "assistant",
      content:    textBuffer || null,
      tool_calls: pending.map((tc) => ({
        id:       tc.id,
        type:     "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    const toolResults: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    for (const tc of pending) {
      let result = "";
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.arguments || "{}"); } catch {}

      sse({ type: "tool_start", name: tc.name, args });

      try {
        if (tc.name === "request_documents") {
          result = execRequestDocuments(args as Parameters<typeof execRequestDocuments>[0]);
        } else if (tc.name === "lookup_hs_code") {
          result = await execLookupHsCode(args as Parameters<typeof execLookupHsCode>[0]);
        } else if (tc.name === "lookup_btki_tariff") {
          result = await execLookupBtkiTariff(args as Parameters<typeof execLookupBtkiTariff>[0]);
        } else if (tc.name === "lookup_lartas") {
          result = await execLookupLartas(args as Parameters<typeof execLookupLartas>[0]);
        } else if (tc.name === "calculate_landed_cost") {
          result = await execCalculateLandedCost(args as Parameters<typeof execCalculateLandedCost>[0]);
        } else if (tc.name === "generate_import_rfq") {
          result = execGenerateRfq(args as Parameters<typeof execGenerateRfq>[0]);
        } else if (tc.name === "recommend_vendors") {
          result = await execRecommendVendors(args as Parameters<typeof execRecommendVendors>[0]);
        } else if (tc.name === "estimate_cost") {
          result = execEstimateCost(args as Parameters<typeof execEstimateCost>[0]);
        } else {
          result = JSON.stringify({ error: "Unknown tool" });
        }
      } catch (e: unknown) {
        result = JSON.stringify({ error: String(e) });
      }

      const parsed = (() => { try { return JSON.parse(result); } catch { return null; } })();
      sse({ type: "tool_result", name: tc.name, data: parsed ?? result });

      toolResults.push({ role: "tool", tool_call_id: tc.id, content: result });
    }

    chatMessages.push(...toolResults);
  }

  sse({ type: "done" });
}

// ─── Routes ────────────────────────────────────────────────────────────────────

router.post("/chat", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { messages } = req.body as { messages?: OpenAI.Chat.ChatCompletionMessageParam[] };

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  const fullMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];

  try {
    await streamImportChat(fullMessages, res);
  } catch (e: unknown) {
    logger.error({ err: e }, "importAdvisor chat error");
    res.write(`data: ${JSON.stringify({ type: "error", message: String(e) })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
