/**
 * PPJK Financial Calculation Service — Phase 2 Remediation
 * Pure, deterministic, decimal-safe backend calculation.
 * Backend MUST recalculate grand_total — never trust frontend values.
 *
 * All monetary values are stored as TEXT in the DB (legacy decision).
 * Internally we use integer arithmetic in "basis points" (1/100 of IDR sen)
 * to avoid floating-point drift on large amounts (e.g. 10 billion IDR).
 */

/** All financial input fields for a PPJK order. */
export interface PpjkFinancialInput {
  /** Customs (pabean) components */
  nilaiPabean?: string | number | null;   // Customs value (CIF)
  beaMasuk?: string | number | null;      // Import duty (BM)
  ppnImpor?: string | number | null;      // PPN import 11%
  pphImpor?: string | number | null;      // PPh 22 import
  bmtp?: string | number | null;          // Anti-dumping duty (BMTP)
  bmad?: string | number | null;          // Anti-dumping measure (BMAD)

  /** Logistic / handling components */
  storageFee?: string | number | null;    // Storage / gudang
  handlingFee?: string | number | null;   // Handling fee
  thc?: string | number | null;          // THC (Terminal Handling Charge)
  doFee?: string | number | null;        // DO fee (Delivery Order)
  forwardingFee?: string | number | null; // Freight forwarding fee
  truckingFee?: string | number | null;   // Trucking / delivery

  /** PPJK service components */
  serviceFee?: string | number | null;    // PPJK service fee (honorarium)
  ppnServiceFee?: string | number | null; // PPN on service fee 11%
  miscFee?: string | number | null;       // Miscellaneous / lain-lain
}

export interface PpjkFinancialResult {
  /** Pabean total = beaMasuk + ppnImpor + pphImpor + bmtp + bmad */
  totalTagihanPabean: string;

  /** Service total = serviceFee + ppnServiceFee */
  totalServiceFee: string;

  /** Logistic total = storageFee + handlingFee + thc + doFee + forwardingFee + truckingFee */
  totalLogisticFee: string;

  /** Grand total = totalTagihanPabean + totalServiceFee + totalLogisticFee + miscFee */
  grandTotal: string;

  /** Individual validated components (null for missing, "0" for explicit zero) */
  components: {
    nilaiPabean: string;
    beaMasuk: string;
    ppnImpor: string;
    pphImpor: string;
    bmtp: string;
    bmad: string;
    storageFee: string;
    handlingFee: string;
    thc: string;
    doFee: string;
    forwardingFee: string;
    truckingFee: string;
    serviceFee: string;
    ppnServiceFee: string;
    miscFee: string;
  };
}

export class PpjkFinancialError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "PpjkFinancialError";
  }
}

/**
 * Parse a monetary string/number to integer basis points (IDR × 100).
 * Throws PpjkFinancialError for invalid values.
 * Returns 0 for null/undefined/empty.
 */
function parseToBasisPoints(value: string | number | null | undefined, field: string): bigint {
  if (value === null || value === undefined || value === "") return 0n;

  const s = String(value).trim().replace(/,/g, "");
  if (s === "0" || s === "0.00") return 0n;

  // Reject clearly invalid
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) {
    throw new PpjkFinancialError(`Nilai tidak valid untuk ${field}: "${value}"`, field);
  }

  // Reject negative
  if (s.startsWith("-")) {
    throw new PpjkFinancialError(`Nilai tidak boleh negatif untuk ${field}: "${value}"`, field);
  }

  // Split on decimal
  const [intPart, decPart = ""] = s.split(".");
  const cents = decPart.padEnd(2, "0").slice(0, 2);

  const intVal = BigInt(intPart || "0");
  const centVal = BigInt(cents);

  return intVal * 100n + centVal;
}

/** Format BigInt basis points back to IDR string (2 decimal places). */
function formatFromBasisPoints(bp: bigint): string {
  const abs = bp < 0n ? -bp : bp;
  const intPart = abs / 100n;
  const centPart = abs % 100n;
  const sign = bp < 0n ? "-" : "";
  return `${sign}${intPart}.${String(centPart).padStart(2, "0")}`;
}

/**
 * Calculate all PPJK financial totals from raw inputs.
 * Throws PpjkFinancialError if any value is invalid.
 */
export function calculatePpjkFinancials(input: PpjkFinancialInput): PpjkFinancialResult {
  // Parse all fields
  const bp = {
    nilaiPabean:    parseToBasisPoints(input.nilaiPabean,    "nilaiPabean"),
    beaMasuk:       parseToBasisPoints(input.beaMasuk,       "beaMasuk"),
    ppnImpor:       parseToBasisPoints(input.ppnImpor,       "ppnImpor"),
    pphImpor:       parseToBasisPoints(input.pphImpor,       "pphImpor"),
    bmtp:           parseToBasisPoints(input.bmtp,           "bmtp"),
    bmad:           parseToBasisPoints(input.bmad,           "bmad"),
    storageFee:     parseToBasisPoints(input.storageFee,     "storageFee"),
    handlingFee:    parseToBasisPoints(input.handlingFee,    "handlingFee"),
    thc:            parseToBasisPoints(input.thc,            "thc"),
    doFee:          parseToBasisPoints(input.doFee,          "doFee"),
    forwardingFee:  parseToBasisPoints(input.forwardingFee,  "forwardingFee"),
    truckingFee:    parseToBasisPoints(input.truckingFee,    "truckingFee"),
    serviceFee:     parseToBasisPoints(input.serviceFee,     "serviceFee"),
    ppnServiceFee:  parseToBasisPoints(input.ppnServiceFee,  "ppnServiceFee"),
    miscFee:        parseToBasisPoints(input.miscFee,        "miscFee"),
  };

  // Validate large amount (> 10 trillion IDR is suspicious)
  const MAX_AMOUNT_BP = BigInt("10000000000000") * 100n; // 10T IDR in basis points
  for (const [field, val] of Object.entries(bp)) {
    if (val > MAX_AMOUNT_BP) {
      throw new PpjkFinancialError(`Nilai terlalu besar untuk ${field}: maks 10 triliun IDR`, field);
    }
  }

  const totalTagihanPabean = bp.beaMasuk + bp.ppnImpor + bp.pphImpor + bp.bmtp + bp.bmad;
  const totalServiceFee    = bp.serviceFee + bp.ppnServiceFee;
  const totalLogisticFee   = bp.storageFee + bp.handlingFee + bp.thc + bp.doFee + bp.forwardingFee + bp.truckingFee;
  const grandTotal         = totalTagihanPabean + totalServiceFee + totalLogisticFee + bp.miscFee;

  return {
    totalTagihanPabean: formatFromBasisPoints(totalTagihanPabean),
    totalServiceFee:    formatFromBasisPoints(totalServiceFee),
    totalLogisticFee:   formatFromBasisPoints(totalLogisticFee),
    grandTotal:         formatFromBasisPoints(grandTotal),
    components: {
      nilaiPabean:   formatFromBasisPoints(bp.nilaiPabean),
      beaMasuk:      formatFromBasisPoints(bp.beaMasuk),
      ppnImpor:      formatFromBasisPoints(bp.ppnImpor),
      pphImpor:      formatFromBasisPoints(bp.pphImpor),
      bmtp:          formatFromBasisPoints(bp.bmtp),
      bmad:          formatFromBasisPoints(bp.bmad),
      storageFee:    formatFromBasisPoints(bp.storageFee),
      handlingFee:   formatFromBasisPoints(bp.handlingFee),
      thc:           formatFromBasisPoints(bp.thc),
      doFee:         formatFromBasisPoints(bp.doFee),
      forwardingFee: formatFromBasisPoints(bp.forwardingFee),
      truckingFee:   formatFromBasisPoints(bp.truckingFee),
      serviceFee:    formatFromBasisPoints(bp.serviceFee),
      ppnServiceFee: formatFromBasisPoints(bp.ppnServiceFee),
      miscFee:       formatFromBasisPoints(bp.miscFee),
    },
  };
}
