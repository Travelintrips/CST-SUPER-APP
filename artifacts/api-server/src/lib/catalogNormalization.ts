/**
 * Shared catalog normalization utilities.
 *
 * Moved from portal.ts so both route handlers and service files can import
 * without creating circular dependencies.
 */

export const SERVICE_CATEGORY_ALIASES: Record<string, string> = {
  trucking:           "trucking",
  truck:              "trucking",
  "land freight":     "trucking",
  land_freight:       "trucking",
  darat:              "trucking",
  pengiriman_darat:   "trucking",
  "pengiriman darat": "trucking",
  "sea freight":      "sea_freight",
  sea_freight:        "sea_freight",
  sea:                "sea_freight",
  ocean:              "sea_freight",
  ocean_freight:      "sea_freight",
  "ocean freight":    "sea_freight",
  fcl:                "sea_freight",
  lcl:                "sea_freight",
  laut:               "sea_freight",
  pengiriman_laut:    "sea_freight",
  "pengiriman laut":  "sea_freight",
  "air freight":      "air_freight",
  air_freight:        "air_freight",
  air:                "air_freight",
  udara:              "air_freight",
  cargo_udara:        "air_freight",
  "cargo udara":      "air_freight",
  pengiriman_udara:   "air_freight",
  "pengiriman udara": "air_freight",
  ppjk:               "ppjk",
  customs:            "ppjk",
  custom:             "ppjk",
  pabean:             "ppjk",
  kepabeanan:         "ppjk",
  pib:                "ppjk",
  peb:                "ppjk",
  handling:           "handling",
  warehouse:          "handling",
  warehousing:        "handling",
  gudang:             "handling",
  stuffing:           "handling",
  stripping:          "handling",
  loading:            "handling",
  unloading:          "handling",
  document:           "document",
  documents:          "document",
  dokumen:            "document",
  legal_doc:          "document",
  "legal doc":        "document",
  perizinan:          "document",
};

export const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  trucking:    "Trucking",
  sea_freight: "Sea Freight",
  air_freight: "Air Freight",
  ppjk:        "PPJK / Customs",
  handling:    "Handling",
  document:    "Document",
};

/**
 * Normalize a category value to a canonical key.
 * - empty/null → null
 * - lowercase + trim
 * - replace spaces AND dashes with underscore
 * - apply alias map
 */
export function normalizeServiceCategory(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim().replace(/[\s-]+/g, "_");
  const withSpaces = normalized.replace(/_/g, " ");
  const result =
    SERVICE_CATEGORY_ALIASES[withSpaces] ??
    SERVICE_CATEGORY_ALIASES[normalized] ??
    normalized;
  if (process.env.NODE_ENV === "development") {
    console.debug(`[marketplace] normalizeServiceCategory: "${value}" → "${result}"`);
  }
  return result;
}

export function normalizeMarketplaceStockStatus(raw: string | null): string | null {
  if (!raw) return null;
  const MAP: Record<string, string> = {
    "ready stock": "available", ready: "available", in_stock: "available",
    indent:        "limited",
    "pre-order":   "pre_order", preorder: "pre_order", "pre order": "pre_order",
    "out of stock": "out_of_stock", kosong: "out_of_stock",
  };
  return MAP[raw.toLowerCase().trim()] ?? raw;
}
