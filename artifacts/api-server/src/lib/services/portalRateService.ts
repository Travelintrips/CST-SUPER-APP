/**
 * Portal Rate Service
 *
 * Business logic for trucking & freight pricing rates stored
 * in the portal_content table as JSON blobs.
 *
 * Controller (portal.ts) handles HTTP and broadcast side-effects.
 */

import { db, portalContentTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Keys ────────────────────────────────────────────────────────────────────

const TRUCKING_RATES_KEY       = "logistic_trucking_rates";
const FREIGHT_RATES_KEY        = "logistic_freight_rates";
const CALCULATOR_RATES_KEY     = "calculator_rates";
const CALCULATOR_RATES_V2_KEY  = "calculator_rates_v2";

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_TRUCKING_RATES: Record<string, { ratePerKm: number; loadingFee: number }> = {
  CDE:     { ratePerKm: 5000,  loadingFee: 500000  },
  CDD:     { ratePerKm: 7000,  loadingFee: 700000  },
  Fuso:    { ratePerKm: 10000, loadingFee: 1000000 },
  Wingbox: { ratePerKm: 12000, loadingFee: 1200000 },
  Trailer: { ratePerKm: 15000, loadingFee: 1500000 },
};

export const DEFAULT_FREIGHT_RATES = {
  seaLcl:          { ratePerCbm: 250000,  label: "Sea Freight LCL (per CBM)" },
  seaFcl20:        { flatRate: 8000000,   label: "Sea Freight FCL 20ft"       },
  seaFcl40:        { flatRate: 14000000,  label: "Sea Freight FCL 40ft"       },
  air:             { ratePerKg: 50000,    label: "Air Freight (per kg)"       },
  customClearance: { flatRate: 2500000,   label: "Custom Clearance"           },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function _getKey<T>(key: string, def: T): Promise<T> {
  const [row] = await db.select().from(portalContentTable).where(eq(portalContentTable.key, key));
  if (!row) return def;
  try { return JSON.parse(row.value) as T; } catch { return def; }
}

async function _setKey(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  const existing = await db.select().from(portalContentTable).where(eq(portalContentTable.key, key));
  if (existing.length > 0) {
    await db.update(portalContentTable).set({ value: json }).where(eq(portalContentTable.key, key));
  } else {
    await db.insert(portalContentTable).values({ key, value: json });
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

// ─── Defaults ── Calculator Rates ────────────────────────────────────────────

export const DEFAULT_CALCULATOR_RATES = {
  airFreight:  { baseCost: 500000,  ratePerKg: 90000,    handlingPct: 5, customsFee: 1200000 },
  seaFreight:  { baseCost: 750000,  ratePerCbm: 2500000, handlingPct: 5, customsFee: 1500000 },
  customs:     { baseCost: 1500000, ratePerKg: 5000,     handlingFee: 500000, customsPct: 0.5 },
  domestic:    { baseCost: 500000,  ratePerKg: 8500,     handlingPct: 5 },
  warehousing: { baseCost: 5000000, ratePerCbm: 2500000, handlingFee: 500000 },
};

export const DEFAULT_CALCULATOR_RATES_V2 = {
  airFreight: {
    ratePerKg: 90000,
    fuelSurchargePct: 25,
    securityFeePerKg: 2000,
    handlingFee: 350000,
    awbFee: 250000,
    documentationFee: 200000,
    insurancePct: 0.15,
    ppnPct: 11,
  },
  seaFreight: {
    ratePerCbmLcl: 2500000,
    ratePerContainer: {
      "20GP": 12000000,
      "40GP": 18000000,
      "40HC": 20000000,
      "Reefer": 35000000,
      "Open Top": 25000000,
      "Flat Rack": 28000000,
    },
    thc: 1500000,
    documentationFee: 750000,
    customsClearance: 1500000,
    truckingFee: 1200000,
    insurancePct: 0.10,
    ppnPct: 11,
  },
  customs: {
    jasaPpjk: 2500000,
    customsHandling: 750000,
    documentProcessing: 500000,
    pibSubmission: 350000,
    courierFee: 150000,
    additionalServiceFee: 500000,
  },
  domestic: {
    vehicleRates: {
      pickup: 500000,
      blindVan: 600000,
      CDE: 750000,
      CDD: 1000000,
      Fuso: 1500000,
      Wingbox: 2000000,
      "Trailer 20FT": 3500000,
      "Trailer 40FT": 5000000,
    },
    distanceRatePerKm: 8500,
    loadingFee: 350000,
    unloadingFee: 350000,
    overnightFee: 500000,
    helperFeePerDay: 200000,
  },
  warehousing: {
    palletRatePerDay: 15000,
    cbmRatePerDay: 25000,
    sqmRatePerDay: 8000,
    inboundFee: 25000,
    outboundFeePerPallet: 25000,
    inventoryFeePerMonth: 500000,
  },
};

export async function getCalculatorRates() {
  try { return await _getKey(CALCULATOR_RATES_KEY, DEFAULT_CALCULATOR_RATES); }
  catch { return DEFAULT_CALCULATOR_RATES; }
}

export async function getCalculatorRatesV2() {
  try { return await _getKey(CALCULATOR_RATES_V2_KEY, DEFAULT_CALCULATOR_RATES_V2); }
  catch { return DEFAULT_CALCULATOR_RATES_V2; }
}

export async function getTruckingRates() {
  return _getKey(TRUCKING_RATES_KEY, DEFAULT_TRUCKING_RATES);
}

export async function setTruckingRates(
  rates: Record<string, { ratePerKm: number; loadingFee: number }>
): Promise<void> {
  await _setKey(TRUCKING_RATES_KEY, rates);
}

export async function getFreightRates() {
  return _getKey(FREIGHT_RATES_KEY, DEFAULT_FREIGHT_RATES);
}

export async function setFreightRates(rates: unknown): Promise<void> {
  await _setKey(FREIGHT_RATES_KEY, rates);
}
