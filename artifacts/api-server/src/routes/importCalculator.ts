/**
 * Import Tariff Calculator API — Enhanced
 * GET  /api/import-calculator/rates              — kurs mata uang (BI JISDOR + fallback)
 * GET  /api/import-calculator/hierarchy/:hsCode  — parent chapter/heading/sub lookup
 * GET  /api/import-calculator/fta/:scheme        — detail regulasi FTA
 * POST /api/import-calculator/calculate          — hitung pajak impor (single)
 * POST /api/import-calculator/multi-calculate    — hitung pajak impor (multi HS)
 */
import { Router, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "@workspace/db";
import { btkiTariffTable } from "@workspace/db";
import { or, eq, sql, ilike } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

// Rate limiters — public endpoints, protect against abuse
const calcLimit  = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false, message: { error: "Terlalu banyak permintaan, coba lagi dalam 1 menit" } });
const multiLimit = rateLimit({ windowMs: 60_000, max: 20,  standardHeaders: true, legacyHeaders: false, message: { error: "Terlalu banyak permintaan, coba lagi dalam 1 menit" } });
const ratesLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: "Terlalu banyak permintaan, coba lagi dalam 1 menit" } });

// ── Exchange Rate Cache ───────────────────────────────────────────────────────
interface RateCache {
  rates: Record<string, number>; // currency → IDR
  fetchedAt: number;
  source: "bi_jisdor" | "live" | "fallback";
  sourceLabel: string;
}

let rateCache: RateCache | null = null;
const RATE_TTL_MS = 60 * 60 * 1000; // 1 jam

const FALLBACK_RATES: Record<string, number> = {
  IDR: 1,
  USD: 16200,
  EUR: 17900,
  CNY: 2230,
  JPY: 107,
  GBP: 20900,
  SGD: 12100,
  MYR: 3600,
  AUD: 10500,
  HKD: 2080,
  KRW: 11.8,
  SAR: 4320,
  AED: 4410,
  THB: 470,
  INR: 195,
  TWD: 510,
  CHF: 19200,
  CAD: 11900,
};

/**
 * Coba ambil kurs BI JISDOR (Bank Indonesia).
 * BI publish JISDOR setiap hari kerja ~10.00 WIB.
 * Kita coba beberapa endpoint karena BI kadang ganti format.
 */
async function fetchBiJisdor(): Promise<Record<string, number> | null> {
  // Kandidat endpoint BI (diurutkan prioritas)
  const attempts: Array<() => Promise<number | null>> = [
    // Endpoint 1: BI Web API (format JSON baru)
    async () => {
      const res = await fetch(
        "https://api.bi.go.id/v1/kurs?type=usd_idr",
        { signal: AbortSignal.timeout(4000) }
      );
      if (!res.ok) return null;
      const data = await res.json() as { value?: number; data?: { value?: number }[] };
      const val = data?.value ?? data?.data?.[0]?.value;
      return val && typeof val === "number" && val > 1000 ? val : null;
    },
    // Endpoint 2: BI JISDOR tabel kurs (HTML scrape tidak mungkin, coba alternatif JSON)
    async () => {
      const res = await fetch(
        "https://www.bi.go.id/biwebservice/wskursbi.asmx/getKursJSDOR",
        { signal: AbortSignal.timeout(4000), headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;
      const text = await res.text();
      // Response kadang XML/JSON hybrid
      const match = text.match(/<KursTengah>([\d.,]+)<\/KursTengah>/);
      if (match) {
        const val = parseFloat(match[1].replace(/\./g, "").replace(",", "."));
        return val > 1000 ? val : null;
      }
      return null;
    },
    // Endpoint 3: BI Kurs Referensi (endpoint publik alternatif)
    async () => {
      const today = new Date().toISOString().split("T")[0];
      const res = await fetch(
        `https://www.bi.go.id/id/statistik/informasi-kurs/referensi/Default.aspx?val=USD&tgl=${today}`,
        { signal: AbortSignal.timeout(4000) }
      ).catch(() => null);
      if (!res || !res.ok) return null;
      // Too complex to parse HTML reliably, skip
      return null;
    },
  ];

  for (const attempt of attempts) {
    try {
      const usdIdr = await attempt();
      if (usdIdr) {
        logger.info({ usdIdr }, "[importCalculator] BI JISDOR rate diperoleh");
        return { USD: usdIdr };
      }
    } catch {
      // lanjut ke berikutnya
    }
  }
  return null;
}

async function getExchangeRates(): Promise<RateCache> {
  if (rateCache && Date.now() - rateCache.fetchedAt < RATE_TTL_MS) {
    return rateCache;
  }

  // ── 1. Coba Bank Indonesia JISDOR rate ──────────────────────────────────────
  const biData = await fetchBiJisdor();

  // ── 2. Coba Frankfurter API untuk semua mata uang ───────────────────────────
  try {
    const currencies = Object.keys(FALLBACK_RATES)
      .filter((c) => c !== "IDR")
      .join(",");
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=IDR&to=${currencies}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const data = (await res.json()) as { rates: Record<string, number> };

    const toIDR: Record<string, number> = { IDR: 1 };
    for (const [cur, rate] of Object.entries(data.rates)) {
      if (rate > 0) toIDR[cur] = 1 / rate;
    }
    // Fallback untuk mata uang yang tidak tersedia di Frankfurter
    for (const [cur, rate] of Object.entries(FALLBACK_RATES)) {
      if (!toIDR[cur]) toIDR[cur] = rate;
    }
    // Override USD dengan BI JISDOR jika tersedia (lebih akurat untuk Bea Cukai)
    if (biData?.USD) toIDR.USD = biData.USD;

    const source = biData?.USD ? "bi_jisdor" : "live";
    rateCache = {
      rates: toIDR,
      fetchedAt: Date.now(),
      source,
      sourceLabel: source === "bi_jisdor"
        ? "Bank Indonesia JISDOR + Frankfurter"
        : "Frankfurter Open Exchange",
    };
    return rateCache;
  } catch (err) {
    logger.warn({ err }, "[importCalculator] exchange rate fetch gagal, pakai fallback");
    const toIDR = { ...FALLBACK_RATES };
    if (biData?.USD) toIDR.USD = biData.USD;
    rateCache = {
      rates: toIDR,
      fetchedAt: Date.now(),
      source: "fallback",
      sourceLabel: "Kurs estimasi (tidak ada koneksi API)",
    };
    return rateCache;
  }
}

// ── GET /api/import-calculator/rates ─────────────────────────────────────────
router.get("/rates", ratesLimit, async (_req: Request, res: Response) => {
  try {
    const cache = await getExchangeRates();
    res.json({
      rates: cache.rates,
      source: cache.source,
      sourceLabel: cache.sourceLabel,
      updatedAt: new Date(cache.fetchedAt).toISOString(),
      note: "Kurs dalam IDR (1 unit mata uang = N IDR). USD dari BI JISDOR bila tersedia.",
    });
  } catch (err) {
    logger.error({ err }, "[importCalculator] rates error");
    res.status(500).json({ error: "Gagal mengambil kurs mata uang" });
  }
});

// ── GET /api/import-calculator/hierarchy/:hsCode ─────────────────────────────
// Mengembalikan pos tarif induk: Chapter (2 digit) → Heading (4 digit) → Sub-heading (6 digit) → Full
router.get("/hierarchy/:hsCode", async (req: Request, res: Response) => {
  const raw = String(req.params["hsCode"] ?? "").trim();
  const digits = raw.replace(/\./g, "");

  try {
    const hs2 = digits.slice(0, 2);
    const hs4 = digits.slice(0, 4);
    const hs6 = digits.slice(0, 6);

    // Ambil semua level
    const rows = await db
      .select({
        hsCode: btkiTariffTable.hsCode,
        hsCode6: btkiTariffTable.hsCode6,
        hsCode4: btkiTariffTable.hsCode4,
        hsCode2: btkiTariffTable.hsCode2,
        descriptionId: btkiTariffTable.descriptionId,
        bmMfn: btkiTariffTable.bmMfn,
        category: btkiTariffTable.category,
        lartasImport: btkiTariffTable.lartasImport,
      })
      .from(btkiTariffTable)
      .where(
        or(
          eq(btkiTariffTable.hsCode2, hs2),
          eq(btkiTariffTable.hsCode4, hs4),
          eq(btkiTariffTable.hsCode6, hs6),
        )
      )
      .limit(50);

    // Kelompokkan per level
    const chapter = rows.filter(r => r.hsCode.replace(/\./g, "").length === 4)
      .find(r => r.hsCode4 === hs4) ?? rows.find(r => r.hsCode2 === hs2);
    const heading = rows.filter(r => r.hsCode.replace(/\./g, "").length === 6)
      .find(r => r.hsCode6 === hs6);
    const siblings = rows.filter(r => r.hsCode6 === hs6 && r.hsCode.replace(/\./g, "").length > 6);

    res.json({ chapter, heading, siblings, allRelated: rows });
  } catch (err) {
    logger.error({ err }, "[importCalculator] hierarchy error");
    res.status(500).json({ error: "Gagal mengambil hierarki HS Code" });
  }
});

// ── GET /api/import-calculator/fta/:scheme ────────────────────────────────────
const FTA_DETAILS: Record<string, {
  name: string;
  parties: string[];
  formCoo: string;
  regulation: string;
  pmk: string;
  description: string;
  effectiveYear: number;
  link: string;
}> = {
  ACFTA: {
    name: "ASEAN–China Free Trade Area",
    parties: ["Indonesia", "China", "Brunei", "Kamboja", "Laos", "Malaysia", "Myanmar", "Filipina", "Singapura", "Thailand", "Vietnam"],
    formCoo: "Form E",
    regulation: "Permendag No. 25 Tahun 2018 jo. Permendag No. 56 Tahun 2019",
    pmk: "PMK No. 241/PMK.010/2017",
    description: "FTA antara ASEAN dan China. Sebagian besar produk manufaktur dan agrikultur mendapat tarif 0%. Wajib melampirkan Certificate of Origin Form E yang diterbitkan oleh otoritas berwenang China.",
    effectiveYear: 2010,
    link: "https://www.kemenkeu.go.id/acfta",
  },
  AFTA: {
    name: "ASEAN Free Trade Area",
    parties: ["Indonesia", "Brunei", "Kamboja", "Laos", "Malaysia", "Myanmar", "Filipina", "Singapura", "Thailand", "Vietnam"],
    formCoo: "Form D (ATIGA)",
    regulation: "Permendag No. 56 Tahun 2018 (ATIGA)",
    pmk: "PMK No. 229/PMK.010/2017",
    description: "FTA intra-ASEAN (ATIGA — ASEAN Trade in Goods Agreement). Hampir semua produk tarif 0% untuk sesama negara ASEAN. Gunakan Form D yang diterbitkan oleh instansi terkait negara eksportir ASEAN.",
    effectiveYear: 2010,
    link: "https://www.kemenkeu.go.id/afta",
  },
  AIFTA: {
    name: "ASEAN–India Free Trade Area",
    parties: ["Indonesia", "India", "Brunei", "Kamboja", "Laos", "Malaysia", "Myanmar", "Filipina", "Singapura", "Thailand", "Vietnam"],
    formCoo: "Form AI",
    regulation: "Permendag No. 32 Tahun 2019",
    pmk: "PMK No. 19/PMK.010/2018",
    description: "FTA antara ASEAN dan India. Cakupan terbatas untuk beberapa produk pertanian dan manufaktur. Wajib melampirkan Form AI dari otoritas India (Ministry of Commerce & Industry).",
    effectiveYear: 2010,
    link: "https://www.kemenkeu.go.id/aifta",
  },
  AANZFTA: {
    name: "ASEAN–Australia–New Zealand FTA",
    parties: ["Indonesia", "Australia", "Selandia Baru", "Brunei", "Kamboja", "Laos", "Malaysia", "Myanmar", "Filipina", "Singapura", "Thailand", "Vietnam"],
    formCoo: "Form AANZ",
    regulation: "Permendag No. 33 Tahun 2019",
    pmk: "PMK No. 229/PMK.010/2017",
    description: "FTA antara ASEAN dengan Australia dan Selandia Baru. Produk teknologi, pangan, dan manufaktur mendapat tarif preferensial. Form AANZ diterbitkan oleh Australian Border Force atau NZ Customs.",
    effectiveYear: 2012,
    link: "https://www.kemenkeu.go.id/aanzfta",
  },
  AHKFTA: {
    name: "ASEAN–Hong Kong FTA",
    parties: ["Indonesia", "Hong Kong SAR China", "Brunei", "Kamboja", "Laos", "Malaysia", "Myanmar", "Filipina", "Singapura", "Thailand", "Vietnam"],
    formCoo: "Form AHK",
    regulation: "Permendag No. 6 Tahun 2020",
    pmk: "PMK No. 18/PMK.010/2020",
    description: "FTA antara ASEAN dan Hong Kong SAR. Efektif 2019. Form AHK diterbitkan oleh Trade and Industry Department (TID) Hong Kong. Cocok untuk impor elektronik, aset keuangan, dan produk jasa.",
    effectiveYear: 2019,
    link: "https://www.kemenkeu.go.id/ahkfta",
  },
  AKFTA: {
    name: "ASEAN–Korea Free Trade Area",
    parties: ["Indonesia", "Korea Selatan", "Brunei", "Kamboja", "Laos", "Malaysia", "Myanmar", "Filipina", "Singapura", "Thailand", "Vietnam"],
    formCoo: "Form AK",
    regulation: "Permendag No. 25 Tahun 2019",
    pmk: "PMK No. 229/PMK.010/2017",
    description: "FTA antara ASEAN dan Korea Selatan. Produk elektronik, otomotif, dan bahan kimia mendapat tarif nol/rendah. Form AK diterbitkan oleh Korea Customs Service atau Chamber of Commerce Korea.",
    effectiveYear: 2007,
    link: "https://www.kemenkeu.go.id/akfta",
  },
  ASFTA: {
    name: "ASEAN–Swiss FTA (Eropa Selatan)",
    parties: ["Indonesia", "Swiss", "Liechtenstein", "Islandia", "Norwegia"],
    formCoo: "Form EFTA",
    regulation: "Permendag No. 15 Tahun 2022 (IE-CEPA)",
    pmk: "PMK No. 20/PMK.010/2022",
    description: "Indonesia-EFTA Comprehensive Economic Partnership Agreement (IE-CEPA). Mencakup Swiss, Norwegia, Islandia, dan Liechtenstein. Form EFTA diterbitkan oleh bea cukai negara EFTA.",
    effectiveYear: 2021,
    link: "https://www.kemenkeu.go.id/ie-cepa",
  },
  "IA-CEPA": {
    name: "Indonesia–Australia CEPA",
    parties: ["Indonesia", "Australia"],
    formCoo: "Form IA",
    regulation: "Permendag No. 1 Tahun 2020",
    pmk: "PMK No. 12/PMK.010/2020",
    description: "Indonesia–Australia Comprehensive Economic Partnership Agreement. Produk manufaktur, agrikultur, dan jasa mendapat akses pasar preferensial. Form IA diterbitkan oleh Australian Border Force.",
    effectiveYear: 2020,
    link: "https://www.kemenkeu.go.id/ia-cepa",
  },
};

router.get("/fta/:scheme", (req: Request, res: Response) => {
  const scheme = String(req.params["scheme"] ?? "").toUpperCase();
  const detail = FTA_DETAILS[scheme];
  if (!detail) {
    res.status(404).json({
      error: `Skema FTA ${scheme} tidak ditemukan`,
      available: Object.keys(FTA_DETAILS),
    });
    return;
  }
  res.json({ scheme, ...detail });
});

// ── Helper: format HS Code ────────────────────────────────────────────────────
function formatHsCode(raw: string): string {
  const d = raw.replace(/\./g, "");
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`;
  if (d.length <= 8) return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}.${d.slice(8)}`;
}

// ── Core calculation logic ────────────────────────────────────────────────────
interface CalcRequest {
  hsCode: string;
  goodsValue: number;
  currency: string;
  incoterm: string;
  freightCostIDR?: number;
  insurancePct?: number;
  isApi: boolean;
  preferentialScheme?: string;
}

async function performCalculation(body: CalcRequest, ratesCache: RateCache) {
  const {
    hsCode,
    goodsValue,
    currency,
    incoterm,
    freightCostIDR = 0,
    insurancePct = 0.5,
    isApi = true,
    preferentialScheme,
  } = body;

  const exchangeRate = ratesCache.rates[currency.toUpperCase()] ?? ratesCache.rates.USD ?? 16200;
  const goodsValueIDR = goodsValue * exchangeRate;

  // ── Lookup BTKI ──────────────────────────────────────────────────────────────
  const hsNorm = hsCode.replace(/\./g, "");
  const hsFormatted = formatHsCode(hsCode);

  const [row] = await db
    .select()
    .from(btkiTariffTable)
    .where(
      or(
        eq(btkiTariffTable.hsCode, hsFormatted),
        eq(btkiTariffTable.hsCode, hsCode.trim()),
        sql`REPLACE(${btkiTariffTable.hsCode}, '.', '') = ${hsNorm}`,
      )
    )
    .limit(1);

  if (!row) {
    // Cari yang paling mirip
    const similar = await db
      .select({ hsCode: btkiTariffTable.hsCode, descriptionId: btkiTariffTable.descriptionId })
      .from(btkiTariffTable)
      .where(
        or(
          ilike(btkiTariffTable.hsCode6, `${hsNorm.slice(0, 6)}%`),
          ilike(btkiTariffTable.hsCode4, `${hsNorm.slice(0, 4)}%`),
        )
      )
      .limit(5);

    throw Object.assign(new Error(`HS Code ${hsCode} tidak ditemukan dalam database BTKI`), {
      status: 404,
      hint: "Gunakan /api/btki/search?q= untuk mencari HS Code yang benar",
      similar,
      inswLink: `https://www.insw.go.id/intr/tariff-search?hs=${hsNorm}`,
    });
  }

  // ── Pilih tarif BM ──────────────────────────────────────────────────────────
  let bmRate = Number(row.bmMfn ?? 0);
  let bmScheme = "MFN";

  if (preferentialScheme) {
    const prefMap: Record<string, string | null> = {
      ACFTA:    String(row.bmAcfta ?? ""),
      AFTA:     String(row.bmAfta ?? ""),
      AIFTA:    String(row.bmAifta ?? ""),
      AANZFTA:  String(row.bmAanzfta ?? ""),
      AHKFTA:   String(row.bmAhkfta ?? ""),
      ASFTA:    String(row.bmAsfta ?? ""),
      AKFTA:    String(row.bmAkfta ?? ""),
      "IA-CEPA": String(row.bmIndonesiaAustralia ?? ""),
    };
    const prefVal = prefMap[preferentialScheme.toUpperCase()];
    if (prefVal && prefVal !== "" && !isNaN(Number(prefVal))) {
      bmRate = Number(prefVal);
      bmScheme = preferentialScheme.toUpperCase();
    }
  }

  const ppnRate   = Number(row.ppnRate ?? 11);
  const pphRate   = isApi ? Number(row.pph22Rate ?? 2.5) : Number(row.pph22NonApi ?? 7.5);
  const ppnbmRate = Number(row.ppnbmRate ?? 0);

  // ── Hitung CIF berdasarkan Incoterm ─────────────────────────────────────────
  let cifIDR: number;
  let incotermNote: string;
  const insuranceIDR = goodsValueIDR * (insurancePct / 100);

  switch (incoterm.toUpperCase()) {
    case "CIF":
      cifIDR = goodsValueIDR;
      incotermNote = "Nilai sudah termasuk Cost + Insurance + Freight (CIF)";
      break;
    case "CNF": case "CFR":
      cifIDR = goodsValueIDR + insuranceIDR;
      incotermNote = `CNF/CFR + asuransi ${insurancePct}% (IDR ${Math.round(insuranceIDR).toLocaleString("id-ID")})`;
      break;
    case "FOB":
      cifIDR = goodsValueIDR + freightCostIDR + insuranceIDR;
      incotermNote = `FOB + ongkir IDR ${Math.round(freightCostIDR).toLocaleString("id-ID")} + asuransi ${insurancePct}%`;
      break;
    case "EXW":
      cifIDR = goodsValueIDR + freightCostIDR + insuranceIDR;
      incotermNote = `EXW + ongkir IDR ${Math.round(freightCostIDR).toLocaleString("id-ID")} + asuransi ${insurancePct}%`;
      break;
    case "DAP": case "DDP": case "CPT":
      cifIDR = goodsValueIDR;
      incotermNote = `${incoterm.toUpperCase()} — nilai diperlakukan setara CIF untuk kalkulasi BM`;
      break;
    default:
      cifIDR = goodsValueIDR;
      incotermNote = "Incoterm tidak dikenal, nilai dipakai apa adanya";
  }

  const ndpbm = cifIDR;
  const bm    = ndpbm * (bmRate / 100);
  const nilaiImporKenaPajak = ndpbm + bm;
  const ppn   = nilaiImporKenaPajak * (ppnRate / 100);
  const ppnbm = nilaiImporKenaPajak * (ppnbmRate / 100);
  const pph   = nilaiImporKenaPajak * (pphRate / 100);
  const totalDuties = bm + ppn + ppnbm + pph;
  const ddp   = ndpbm + totalDuties;
  const effectiveRate = ndpbm > 0 ? ((totalDuties / ndpbm) * 100).toFixed(2) : "0.00";

  // ── Preferential rates untuk UI ─────────────────────────────────────────────
  const preferential: Record<string, string | null> = {};
  if (row.bmAcfta !== null)           preferential["ACFTA"]    = `${row.bmAcfta}%`;
  if (row.bmAfta !== null)            preferential["AFTA"]     = `${row.bmAfta}%`;
  if (row.bmAifta !== null)           preferential["AIFTA"]    = `${row.bmAifta}%`;
  if (row.bmAanzfta !== null)         preferential["AANZFTA"]  = `${row.bmAanzfta}%`;
  if (row.bmAhkfta !== null)          preferential["AHKFTA"]   = `${row.bmAhkfta}%`;
  if (row.bmAsfta !== null)           preferential["ASFTA"]    = `${row.bmAsfta}%`;
  if (row.bmAkfta !== null)           preferential["AKFTA"]    = `${row.bmAkfta}%`;
  if (row.bmIndonesiaAustralia !== null) preferential["IA-CEPA"] = `${row.bmIndonesiaAustralia}%`;

  return {
    hs: {
      code:          row.hsCode,
      descriptionId: row.descriptionId,
      descriptionEn: row.descriptionEn,
      unit:          row.unit,
      category:      row.category,
      hsCode2:       row.hsCode2,
      hsCode4:       row.hsCode4,
      hsCode6:       row.hsCode6,
    },
    input: {
      goodsValue,
      currency:          currency.toUpperCase(),
      exchangeRate,
      goodsValueIDR:     Math.round(goodsValueIDR),
      incoterm:          incoterm.toUpperCase(),
      freightCostIDR:    Math.round(freightCostIDR),
      insurancePct,
      isApi,
      preferentialScheme: bmScheme,
      incotermNote,
    },
    ndpbm: Math.round(ndpbm),
    rates: {
      bm:       `${bmRate}%`,
      bmRate,
      bmScheme,
      ppn:      `${ppnRate}%`,
      ppnRate,
      ppnbm:    `${ppnbmRate}%`,
      ppnbmRate,
      pph:      `${pphRate}% (${isApi ? "API / Importir Berlisensi" : "Non-API / Umum"})`,
      pphRate,
    },
    duties: {
      bm:           Math.round(bm),
      ppn:          Math.round(ppn),
      ppnbm:        Math.round(ppnbm),
      pph:          Math.round(pph),
      totalDuties:  Math.round(totalDuties),
      effectiveRate: `${effectiveRate}%`,
    },
    ddp: Math.round(ddp),
    lartas: {
      hasLartas:   !!row.lartasImport,
      hasExport:   !!row.lartasExport,
      description: row.lartasDesc,
      regulator:   row.regulatorImport,
      perizinan:   row.perizinanImport,
    },
    preferential,
    source:   "BTKI 2022 — Buku Tarif Kepabeanan Indonesia (Kemenkeu RI)",
    btkiLink: "https://btki.kemenkeu.go.id/",
    inswLink: `https://www.insw.go.id/intr/tariff-search?hs=${hsNorm}`,
  };
}

// ── POST /api/import-calculator/calculate ────────────────────────────────────
router.post("/calculate", calcLimit, async (req: Request, res: Response) => {
  const body = req.body as CalcRequest;

  if (!body.hsCode || !body.goodsValue || !body.currency || !body.incoterm) {
    res.status(400).json({ error: "hsCode, goodsValue, currency, dan incoterm wajib diisi" });
    return;
  }

  try {
    const cache = await getExchangeRates();
    const result = await performCalculation(body, cache);
    res.json(result);
  } catch (err: unknown) {
    const e = err as Error & { status?: number; hint?: string; similar?: unknown[]; inswLink?: string };
    if (e.status === 404) {
      res.status(404).json({ error: e.message, hint: e.hint, similar: e.similar, inswLink: e.inswLink });
    } else {
      logger.error({ err }, "[importCalculator] calculate error");
      res.status(500).json({ error: "Gagal menghitung pajak impor" });
    }
  }
});

// ── POST /api/import-calculator/multi-calculate ───────────────────────────────
// Hitung pajak untuk beberapa HS Code sekaligus (untuk tabel perbandingan)
router.post("/multi-calculate", multiLimit, async (req: Request, res: Response) => {
  const { items, currency, incoterm, freightCostIDR, insurancePct, isApi, preferentialScheme } = req.body as {
    items: Array<{ hsCode: string; goodsValue: number; label?: string }>;
    currency: string;
    incoterm: string;
    freightCostIDR?: number;
    insurancePct?: number;
    isApi: boolean;
    preferentialScheme?: string;
  };

  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "Field 'items' harus berupa array minimal 1 elemen" });
    return;
  }
  if (items.length > 10) {
    res.status(400).json({ error: "Maksimal 10 HS Code per request" });
    return;
  }

  try {
    const cache = await getExchangeRates();
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const result = await performCalculation({
            hsCode: item.hsCode,
            goodsValue: item.goodsValue,
            currency,
            incoterm,
            freightCostIDR,
            insurancePct,
            isApi,
            preferentialScheme,
          }, cache);
          return { ...result, label: item.label ?? item.hsCode, ok: true };
        } catch (err: unknown) {
          const e = err as Error & { status?: number };
          return { hsCode: item.hsCode, label: item.label ?? item.hsCode, ok: false, error: e.message };
        }
      })
    );
    res.json({ results, rateSource: cache.sourceLabel });
  } catch (err) {
    logger.error({ err }, "[importCalculator] multi-calculate error");
    res.status(500).json({ error: "Gagal menghitung multi HS Code" });
  }
});

export default router;
