/**
 * Multi-currency tolerance layer untuk journal balance validation.
 *
 * PRINSIP:
 * 1. Setiap mata uang memiliki jumlah desimal yang berbeda → toleransi berbeda.
 * 2. Kalau journal multi-currency:
 *    a. Setiap kelompok mata uang harus balance sendiri (DR_USD = CR_USD, dst.)
 *    b. ATAU semua dikonversi ke base currency (IDR) via exchangeRate, lalu DR_IDR = CR_IDR.
 * 3. Kalau tidak ada exchangeRate → mode "per-currency grouping" (strict per mata uang).
 *
 * Tidak memerlukan perubahan schema — currency & exchangeRate bersifat opsional di PostingLine.
 */

/** Jumlah desimal standar per ISO-4217 currency code */
export const CURRENCY_DECIMAL_PLACES: Record<string, number> = {
  IDR: 0,   // Rupiah — tidak ada desimal praktis
  JPY: 0,   // Yen Jepang
  KRW: 0,   // Won Korea
  VND: 0,   // Dong Vietnam
  CLP: 0,   // Peso Chili
  HUF: 0,   // Forint Hungaria
  TWD: 0,   // Dolar Taiwan (rounded to 0 in most FX)
  USD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  SGD: 2,
  MYR: 2,
  CNY: 2,
  HKD: 2,
  THB: 2,
  PHP: 2,
  INR: 2,
  SAR: 2,
  AED: 2,
  CAD: 2,
  CHF: 2,
  NZD: 2,
  BHD: 3,   // Dinar Bahrain — 3 desimal
  KWD: 3,   // Dinar Kuwait
  OMR: 3,
};

/**
 * Kembalikan toleransi imbalance yang diperbolehkan untuk mata uang tertentu.
 * Rumus: 0.5 × (10 ^ -decimalPlaces) — setengah dari unit terkecil.
 */
export function getCurrencyTolerance(currency?: string | null): number {
  const code = (currency ?? "IDR").toUpperCase().trim();
  const dec  = CURRENCY_DECIMAL_PLACES[code] ?? 2;
  if (dec === 0) return 1;       // IDR: toleransi 1 rupiah (pembulatan)
  if (dec === 2) return 0.01;    // USD/EUR: toleransi 1 sen
  if (dec === 3) return 0.001;   // BHD/KWD: toleransi 1 fils
  return Math.pow(10, -dec);
}

export interface CurrencyLine {
  debit:        number;
  credit:       number;
  currency?:    string | null;   // ISO-4217; null/undefined = base currency (IDR)
  exchangeRate?: number | null;  // rate to base currency; null = 1.0
}

export interface CurrencyValidationResult {
  balanced:          boolean;
  /** Imbalance dalam base currency (IDR equivalent) */
  imbalanceBase:     number;
  /** Per-currency breakdown: { USD: { dr, cr, imbalance, balanced } } */
  perCurrency:       Record<string, { dr: number; cr: number; imbalance: number; balanced: boolean; tolerance: number }>;
  /** True kalau semua mata uang balance per-group */
  allGroupsBalanced: boolean;
  /** True kalau konversi ke base currency juga balance (memerlukan exchangeRate) */
  baseBalanced:      boolean | null;  // null = tidak bisa dihitung (ada line tanpa rate)
  detail:            string;
}

/**
 * Validasi balance multi-currency.
 *
 * Mode 1 (per-currency grouping):
 *   Semua line dikelompokkan per currency → cek DR = CR di setiap kelompok.
 *   Dipakai ketika SEMUA line pada currency yang sama, ATAU ketika ada exchangeRate.
 *
 * Mode 2 (base conversion):
 *   Kalau ada exchangeRate di semua line → hitung total dalam base currency (IDR).
 *   Jika base total tidak balance → tambahan error.
 *
 * Journal dianggap BALANCED jika:
 *   - allGroupsBalanced = true  (setiap currency kelompok DR = CR), DAN
 *   - baseBalanced != false     (base total juga balance, jika bisa dihitung)
 */
export function validateMultiCurrencyBalance(lines: CurrencyLine[]): CurrencyValidationResult {
  const groups: Record<string, { dr: number; cr: number }> = {};
  let baseDr = 0;
  let baseCr = 0;
  let hasAllRates = true;

  for (const line of lines) {
    const ccy    = (line.currency ?? "IDR").toUpperCase().trim();
    const dr     = Number(line.debit)  || 0;
    const cr     = Number(line.credit) || 0;
    const rate   = Number(line.exchangeRate ?? 1) || 1;

    if (!groups[ccy]) groups[ccy] = { dr: 0, cr: 0 };
    groups[ccy].dr += dr;
    groups[ccy].cr += cr;

    if (line.exchangeRate == null) {
      // Kalau tidak ada rate untuk non-IDR → tidak bisa hitung base total
      if (ccy !== "IDR") hasAllRates = false;
      // IDR → rate = 1
      baseDr += ccy === "IDR" ? dr : 0;
      baseCr += ccy === "IDR" ? cr : 0;
    } else {
      baseDr += dr * rate;
      baseCr += cr * rate;
    }
  }

  const perCurrency: CurrencyValidationResult["perCurrency"] = {};
  let allGroupsBalanced = true;
  const detailParts: string[] = [];

  for (const [ccy, { dr, cr }] of Object.entries(groups)) {
    const tolerance = getCurrencyTolerance(ccy);
    const imbalance = Math.abs(dr - cr);
    const balanced  = imbalance <= tolerance;
    perCurrency[ccy] = { dr: round4(dr), cr: round4(cr), imbalance: round4(imbalance), balanced, tolerance };
    if (!balanced) {
      allGroupsBalanced = false;
      detailParts.push(`${ccy}: DR=${round4(dr)} CR=${round4(cr)} imbalance=${round4(imbalance)} (tolerance=${tolerance})`);
    }
  }

  // Base currency check (hanya kalau semua line punya exchange rate atau semua IDR)
  const baseTolerance  = getCurrencyTolerance("IDR");
  const baseImbalance  = Math.abs(baseDr - baseCr);
  const baseBalanced   = hasAllRates ? baseImbalance <= baseTolerance : null;
  const imbalanceBase  = round4(baseImbalance);

  if (baseBalanced === false) {
    detailParts.push(`BASE(IDR): DR=${round4(baseDr)} CR=${round4(baseCr)} imbalance=${imbalanceBase}`);
  }

  const balanced = allGroupsBalanced && baseBalanced !== false;
  const detail   = balanced
    ? `OK (${Object.keys(groups).join(", ")})`
    : `UNBALANCED — ${detailParts.join("; ")}`;

  return { balanced, imbalanceBase, perCurrency, allGroupsBalanced, baseBalanced, detail };
}

/** Shortcut: validasi single-currency lines (backward-compat wrapper). */
export function validateSingleCurrencyBalance(
  lines: Array<{ debit: number; credit: number }>,
  currency?: string | null,
): { balanced: boolean; imbalance: number } {
  const result = validateMultiCurrencyBalance(
    lines.map((l) => ({ debit: l.debit, credit: l.credit, currency: currency ?? "IDR" })),
  );
  return { balanced: result.balanced, imbalance: result.imbalanceBase };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
