/**
 * PPh 21 Calculator — tarif progresif (UU HPP No. 7/2021) + TER method (PMK 168/2023).
 *
 * === Tarif Progresif Tahunan (Pasal 17) ===
 * PKP  0  – 60 jt  :  5%
 * PKP  60 – 250 jt : 15%
 * PKP 250 – 500 jt : 25%
 * PKP 500 jt – 5 M : 30%
 * PKP  > 5 M        : 35%
 *
 * === PTKP (PMK 101/PMK.010/2016, masih berlaku) ===
 * TK/0: 54.000.000  | TK/1: 58.500.000 | TK/2: 63.000.000 | TK/3: 67.500.000
 * K/0:  58.500.000  | K/1:  63.000.000  | K/2:  67.500.000  | K/3:  72.000.000
 * K/I/0-3: tambahan Rp 54.000.000 jika suami/istri penghasilan digabung
 *
 * === TER (Tarif Efektif Rata-rata) — PMK 168/2023 ===
 * Metode bulanan: gunakan tarif efektif berdasarkan penghasilan bruto bulanan + kategori PTKP.
 * Diimplementasikan sebagai tabel lookup berdasarkan bracket bulanan.
 */

export type PtkpStatus =
  | "TK/0" | "TK/1" | "TK/2" | "TK/3"
  | "K/0"  | "K/1"  | "K/2"  | "K/3"
  | "K/I/0"| "K/I/1"| "K/I/2"| "K/I/3";

export interface Pph21Input {
  /** Penghasilan bruto BULANAN (gaji pokok + tunjangan + bonus/12 dsb.) */
  grossMonthly: number;
  ptkpStatus: PtkpStatus;
  /** Apakah pakai metode TER (PMK 168/2023)? Default: false (metode umum progresif) */
  useTer?: boolean;
  /** Bulan ke berapa dalam setahun (1-12). Default 1. Dipakai untuk anualisasi sebagian. */
  month?: number;
}

export interface Pph21Result {
  method: "progresif" | "TER";
  grossMonthly: number;
  ptkpAnnual: number;
  ptkpStatus: PtkpStatus;
  biayaJabatanMonthly: number;
  pkpAnnual: number;
  taxAnnual: number;
  /** PPh 21 yang harus dipotong bulan ini */
  taxMonthly: number;
  /** Tarif efektif tahunan (%) */
  effectiveRateAnnual: number;
  /** Rincian perhitungan per bracket */
  brackets?: BracketDetail[];
  terRate?: number;
}

interface BracketDetail {
  limit: string;
  rate: number;
  base: number;
  tax: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PTKP Table
// ─────────────────────────────────────────────────────────────────────────────

const PTKP: Record<PtkpStatus, number> = {
  "TK/0":  54_000_000,
  "TK/1":  58_500_000,
  "TK/2":  63_000_000,
  "TK/3":  67_500_000,
  "K/0":   58_500_000,
  "K/1":   63_000_000,
  "K/2":   67_500_000,
  "K/3":   72_000_000,
  "K/I/0": 112_500_000, // 54 + 54 + 4.5
  "K/I/1": 117_000_000,
  "K/I/2": 121_500_000,
  "K/I/3": 126_000_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Progressive Brackets (UU HPP 2021)
// ─────────────────────────────────────────────────────────────────────────────

const BRACKETS = [
  { limit: 60_000_000,    rate: 0.05,  label: "s.d. Rp 60 juta" },
  { limit: 250_000_000,   rate: 0.15,  label: "Rp 60 jt – Rp 250 jt" },
  { limit: 500_000_000,   rate: 0.25,  label: "Rp 250 jt – Rp 500 jt" },
  { limit: 5_000_000_000, rate: 0.30,  label: "Rp 500 jt – Rp 5 M" },
  { limit: Infinity,      rate: 0.35,  label: "Di atas Rp 5 M" },
] as const;

function calcProgressive(pkp: number): { tax: number; brackets: BracketDetail[] } {
  let remaining = Math.max(0, pkp);
  let prev = 0;
  let totalTax = 0;
  const details: BracketDetail[] = [];

  for (const b of BRACKETS) {
    if (remaining <= 0) break;
    const upper = b.limit;
    const slice = Math.min(remaining, upper - prev);
    const taxSlice = Math.round(slice * b.rate);
    totalTax += taxSlice;
    details.push({ limit: b.label, rate: b.rate * 100, base: slice, tax: taxSlice });
    remaining -= slice;
    prev = upper;
  }

  return { tax: totalTax, brackets: details };
}

// ─────────────────────────────────────────────────────────────────────────────
// TER Method (PMK 168/2023) — Kategori & Tabel Tarif Bulanan
// ─────────────────────────────────────────────────────────────────────────────

/** Kategori TER berdasarkan PTKP */
function terCategory(ptkp: PtkpStatus): "A" | "B" | "C" {
  if (["TK/0", "TK/1", "K/0"].includes(ptkp)) return "A";
  if (["TK/2", "TK/3", "K/1", "K/2"].includes(ptkp)) return "B";
  return "C"; // K/3, K/I/0..3
}

/** TER table: [maxGrossBulanan, rate%]. Sumber: Lampiran PMK 168/2023 */
const TER_TABLE: Record<"A" | "B" | "C", Array<[number, number]>> = {
  A: [
    [5_400_000,    0],
    [5_650_000,    0.25],
    [5_950_000,    0.5],
    [6_300_000,    0.75],
    [6_750_000,    1],
    [7_500_000,    1.25],
    [8_550_000,    1.5],
    [9_650_000,    1.75],
    [10_050_000,   2],
    [10_350_000,   2.25],
    [10_700_000,   2.5],
    [11_050_000,   3],
    [11_600_000,   3.25],
    [12_500_000,   3.5],
    [13_750_000,   4],
    [15_100_000,   4.5],
    [16_950_000,   5],
    [19_750_000,   5.5],
    [24_150_000,   6],
    [26_450_000,   7],
    [28_000_000,   7.5],
    [30_050_000,   8],
    [32_400_000,   8.5],
    [35_400_000,   9],
    [38_900_000,   9.5],
    [43_850_000,   10],
    [47_800_000,   10.5],
    [51_400_000,   11],
    [56_300_000,   11.5],
    [62_200_000,   12],
    [64_700_000,   12.5],
    [66_700_000,   13],
    [69_000_000,   13.5],
    [71_500_000,   14],
    [74_000_000,   14.5],
    [Infinity,     15],
  ],
  B: [
    [6_200_000,    0],
    [6_500_000,    0.25],
    [6_850_000,    0.5],
    [7_300_000,    0.75],
    [9_200_000,    1],
    [10_750_000,   1.5],
    [11_250_000,   1.75],
    [11_600_000,   2],
    [12_600_000,   3],
    [13_600_000,   3.5],
    [14_950_000,   4],
    [16_400_000,   4.5],
    [18_450_000,   5],
    [21_850_000,   5.5],
    [26_000_000,   6],
    [27_700_000,   7],
    [29_350_000,   7.5],
    [31_450_000,   8],
    [33_950_000,   8.5],
    [37_100_000,   9],
    [41_100_000,   9.5],
    [45_800_000,   10],
    [49_500_000,   10.5],
    [53_800_000,   11],
    [58_500_000,   11.5],
    [64_000_000,   12],
    [66_700_000,   12.5],
    [68_600_000,   13],
    [71_000_000,   13.5],
    [73_500_000,   14],
    [76_000_000,   14.5],
    [Infinity,     15],
  ],
  C: [
    [6_600_000,    0],
    [6_950_000,    0.25],
    [7_350_000,    0.5],
    [7_800_000,    0.75],
    [8_850_000,    1],
    [9_800_000,    1.25],
    [10_350_000,   1.5],
    [10_700_000,   1.75],
    [11_050_000,   2],
    [11_600_000,   2.5],
    [12_500_000,   3],
    [13_100_000,   3.5],
    [14_350_000,   4],
    [15_700_000,   4.5],
    [17_050_000,   5],
    [19_500_000,   5.5],
    [22_700_000,   6],
    [24_200_000,   7],
    [25_650_000,   7.5],
    [27_350_000,   8],
    [29_500_000,   8.5],
    [32_300_000,   9],
    [35_750_000,   9.5],
    [39_900_000,   10],
    [43_600_000,   10.5],
    [47_400_000,   11],
    [51_200_000,   11.5],
    [55_800_000,   12],
    [60_400_000,   12.5],
    [65_600_000,   13],
    [68_000_000,   13.5],
    [70_200_000,   14],
    [72_600_000,   14.5],
    [Infinity,     15],
  ],
};

function lookupTer(category: "A" | "B" | "C", grossBulanan: number): number {
  const table = TER_TABLE[category];
  for (const [maxGross, rate] of table) {
    if (grossBulanan <= maxGross) return rate;
  }
  return 15; // fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

const BIAYA_JABATAN_RATE = 0.05;
const BIAYA_JABATAN_MAX_ANNUAL = 6_000_000;

export function calculatePph21(input: Pph21Input): Pph21Result {
  const { grossMonthly, ptkpStatus, useTer = false } = input;
  const ptkpAnnual = PTKP[ptkpStatus] ?? PTKP["TK/0"];

  const biayaJabatanMonthly = Math.min(
    Math.round(grossMonthly * BIAYA_JABATAN_RATE),
    BIAYA_JABATAN_MAX_ANNUAL / 12,
  );

  if (useTer) {
    const category = terCategory(ptkpStatus);
    const terRate = lookupTer(category, grossMonthly);
    const taxMonthly = Math.round((grossMonthly * terRate) / 100);

    // Annualize untuk estimasi
    const taxAnnual = taxMonthly * 12;
    const grossAnnual = grossMonthly * 12;
    const biayaJabatanAnnual = Math.min(biayaJabatanMonthly * 12, BIAYA_JABATAN_MAX_ANNUAL);
    const pkpAnnual = Math.max(0, grossAnnual - biayaJabatanAnnual - ptkpAnnual);

    return {
      method: "TER",
      grossMonthly,
      ptkpAnnual,
      ptkpStatus,
      biayaJabatanMonthly,
      pkpAnnual,
      taxAnnual,
      taxMonthly,
      terRate,
      effectiveRateAnnual: grossAnnual > 0 ? Math.round((taxAnnual / grossAnnual) * 10000) / 100 : 0,
    };
  }

  // Metode progresif standar (anualisasi)
  const grossAnnual = grossMonthly * 12;
  const biayaJabatanAnnual = Math.min(biayaJabatanMonthly * 12, BIAYA_JABATAN_MAX_ANNUAL);
  const pkpAnnual = Math.max(0, grossAnnual - biayaJabatanAnnual - ptkpAnnual);
  const { tax: taxAnnual, brackets } = calcProgressive(pkpAnnual);
  const taxMonthly = Math.round(taxAnnual / 12);

  return {
    method: "progresif",
    grossMonthly,
    ptkpAnnual,
    ptkpStatus,
    biayaJabatanMonthly,
    pkpAnnual,
    taxAnnual,
    taxMonthly,
    effectiveRateAnnual: grossAnnual > 0 ? Math.round((taxAnnual / grossAnnual) * 10000) / 100 : 0,
    brackets,
  };
}

/**
 * Hitung PPh 21 untuk penghasilan yang TIDAK tetap / honorarium (tanpa biaya jabatan).
 * Dipakai untuk pemotongan PPh 21 atas jasa/honor non-pegawai.
 */
export function calculatePph21NonPegawai(input: {
  grossAmount: number;
  /** true jika punya NPWP, false berarti tarif naik 20% */
  hasNpwp?: boolean;
}): { taxAmount: number; rate: number; hasNpwp: boolean } {
  const rate = 5; // Pasal 17 tarif terendah, atau bisa disesuaikan
  const multiplier = input.hasNpwp === false ? 1.2 : 1;
  const effectiveRate = rate * multiplier;
  return {
    taxAmount: Math.round(input.grossAmount * effectiveRate / 100),
    rate: effectiveRate,
    hasNpwp: input.hasNpwp !== false,
  };
}

/** Daftar semua nilai PTKP untuk UI dropdown */
export const PTKP_OPTIONS = Object.entries(PTKP).map(([status, amount]) => ({
  status: status as PtkpStatus,
  label: `${status} — Rp ${amount.toLocaleString("id-ID")}`,
  amount,
}));
