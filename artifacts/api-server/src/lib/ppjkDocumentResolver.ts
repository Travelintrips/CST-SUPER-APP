/**
 * PPJK Document Rule Engine — Phase 2 Remediation
 * Pure deterministic function — no DB calls, fully unit-testable.
 *
 * Rules (from Indonesian customs regulations):
 *  - Invoice + Packing List: always required
 *  - PIB: import required; PEB: export required
 *  - BL: sea freight required for import; optional for export
 *  - AWB: air freight required
 *  - MSDS: required for hazardous/DG/chemical/B3 commodity
 *  - COO/SKA: required when preferential tariff facility is requested
 *  - LS (Laporan Surveyor): required for certain regulated commodities (food, electronics, textiles, steel)
 *  - Insurance: required when CIF incoterm; otherwise optional
 *  - Surat Kuasa / POA: required for undername / third-party clearance
 *  - NPWP: required for import
 */

export interface DocumentResolverParams {
  tradeType: "import" | "export";
  transportMode: "sea" | "air" | "land" | "multimodal" | null | undefined;
  serviceType?: string | null | undefined; // e.g. "customs_clearance", "customs_undername"
  commodity?: string | null | undefined;
  isHazardous?: boolean;
  preferentialTariff?: boolean; // SKA / COO facility requested
  incoterm?: string | null;
}

export interface DocRequirement {
  docType: string;
  docLabel: string;
  isRequired: boolean;
  reason: string;
}

/** Canonical document labels — single source of truth */
export const DOC_LABELS: Record<string, string> = {
  invoice:       "Commercial Invoice",
  packing_list:  "Packing List",
  pib:           "PIB (Pemberitahuan Impor Barang)",
  peb:           "PEB (Pemberitahuan Ekspor Barang)",
  bl:            "Bill of Lading (B/L)",
  awb:           "Air Waybill (AWB)",
  coo:           "Certificate of Origin / SKA",
  insurance:     "Polis Asuransi",
  msds:          "MSDS (Material Safety Data Sheet)",
  ls:            "Laporan Surveyor (LS)",
  surat_kuasa:   "Surat Kuasa / Power of Attorney",
  npwp:          "NPWP Importir / Eksportir",
  photo_cargo:   "Foto Kargo",
};

/** Commodity patterns that trigger LS requirement */
const LS_COMMODITY_PATTERNS = [
  /makanan|food|pangan/i,
  /elektronik|electronic|gadget|laptop|handphone|phone/i,
  /tekstil|textile|garmen|garment|kain|fabric/i,
  /besi|steel|baja|iron|metal/i,
  /kimia|chemical|pestisida|pesticide/i,
];

/** Commodity patterns that trigger MSDS requirement */
const HAZARDOUS_COMMODITY_PATTERNS = [
  /b3|berbahaya|hazardous|dangerous|dg\b|dgr/i,
  /kimia|chemical|acid|asam|basa|alkali/i,
  /bahan\s+bakar|fuel|bbm|minyak|petroleum|petro/i,
  /cat\b|paint|solvent|pelarut/i,
  /gas\b|lpg|lng|compressed/i,
  /eksplosif|explosive|pyrotechnic|kembang\s+api/i,
  /pestisida|pesticide|herbisida|herbicide|fungisida/i,
  /radioaktif|radioactive/i,
];

function isCommodityHazardous(commodity: string | null | undefined): boolean {
  if (!commodity) return false;
  return HAZARDOUS_COMMODITY_PATTERNS.some((p) => p.test(commodity));
}

function isCommodityLsRequired(commodity: string | null | undefined): boolean {
  if (!commodity) return false;
  return LS_COMMODITY_PATTERNS.some((p) => p.test(commodity));
}

function isUndername(serviceType: string | null | undefined): boolean {
  return !!(serviceType?.toLowerCase().includes("undername"));
}

function isCif(incoterm: string | null | undefined): boolean {
  const t = incoterm?.toUpperCase() ?? "";
  return t === "CIF" || t === "CIP";
}

/**
 * Resolves the required document checklist for a PPJK order.
 * Deterministic: same inputs → same output, no side effects.
 */
export function resolveRequiredDocuments(params: DocumentResolverParams): DocRequirement[] {
  const {
    tradeType,
    transportMode,
    serviceType,
    commodity,
    isHazardous = false,
    preferentialTariff = false,
    incoterm = null,
  } = params;

  const isImport = tradeType === "import";
  const isExport = tradeType === "export";
  const isSea = transportMode === "sea" || transportMode === "multimodal" || !transportMode; // default sea
  const isAir = transportMode === "air";
  const hazardous = isHazardous || isCommodityHazardous(commodity);
  const needsLs = isCommodityLsRequired(commodity);
  const needsSKA = preferentialTariff;
  const needsSuratKuasa = isUndername(serviceType);
  const needsInsurance = isCif(incoterm);

  const docs: DocRequirement[] = [
    {
      docType: "invoice",
      docLabel: DOC_LABELS.invoice,
      isRequired: true,
      reason: "Selalu wajib untuk semua transaksi pabean",
    },
    {
      docType: "packing_list",
      docLabel: DOC_LABELS.packing_list,
      isRequired: true,
      reason: "Selalu wajib untuk semua transaksi pabean",
    },
    {
      docType: "pib",
      docLabel: DOC_LABELS.pib,
      isRequired: isImport,
      reason: isImport ? "Wajib untuk semua pengiriman impor" : "Hanya untuk impor",
    },
    {
      docType: "peb",
      docLabel: DOC_LABELS.peb,
      isRequired: isExport,
      reason: isExport ? "Wajib untuk semua pengiriman ekspor" : "Hanya untuk ekspor",
    },
    {
      docType: "bl",
      docLabel: DOC_LABELS.bl,
      isRequired: isSea && isImport,
      reason: isSea
        ? (isImport ? "Wajib untuk sea freight impor" : "Opsional untuk sea freight ekspor")
        : "Hanya relevan untuk sea freight",
    },
    {
      docType: "awb",
      docLabel: DOC_LABELS.awb,
      isRequired: isAir,
      reason: isAir ? "Wajib untuk air freight" : "Hanya relevan untuk air freight",
    },
    {
      docType: "coo",
      docLabel: DOC_LABELS.coo,
      isRequired: needsSKA,
      reason: needsSKA
        ? "Wajib untuk mendapatkan fasilitas tarif preferensial (SKA/COO)"
        : "Diperlukan jika ada fasilitas tarif preferensial",
    },
    {
      docType: "msds",
      docLabel: DOC_LABELS.msds,
      isRequired: hazardous,
      reason: hazardous
        ? "Wajib untuk barang berbahaya / B3 / DG"
        : "Hanya untuk barang berbahaya / B3 / Kimia",
    },
    {
      docType: "ls",
      docLabel: DOC_LABELS.ls,
      isRequired: needsLs,
      reason: needsLs
        ? "Wajib untuk komoditi yang diatur (makanan, elektronik, tekstil, besi, kimia)"
        : "Hanya untuk komoditi tertentu yang diatur",
    },
    {
      docType: "insurance",
      docLabel: DOC_LABELS.insurance,
      isRequired: needsInsurance,
      reason: needsInsurance
        ? "Wajib untuk pengiriman dengan incoterm CIF/CIP"
        : "Diperlukan jika incoterm CIF/CIP",
    },
    {
      docType: "surat_kuasa",
      docLabel: DOC_LABELS.surat_kuasa,
      isRequired: needsSuratKuasa,
      reason: needsSuratKuasa
        ? "Wajib untuk layanan undername / kuasa kepabeanan pihak ketiga"
        : "Hanya untuk layanan undername",
    },
    {
      docType: "npwp",
      docLabel: DOC_LABELS.npwp,
      isRequired: isImport,
      reason: isImport ? "Wajib untuk importir (peraturan DJBC)" : "Hanya untuk impor",
    },
  ];

  return docs;
}

/**
 * Checks whether all required documents are verified for CEISA submission.
 * Returns { ready: true } or { ready: false, missing: string[] }.
 */
export function checkReadyForCeisa(
  docs: DocRequirement[],
  checklist: Array<{ docType: string; status: string; isRequired: boolean }>,
): { ready: boolean; missing: string[] } {
  const requiredTypes = new Set(docs.filter((d) => d.isRequired).map((d) => d.docType));
  const checklistMap = new Map(checklist.map((c) => [c.docType, c]));

  const missing: string[] = [];
  for (const docType of requiredTypes) {
    const item = checklistMap.get(docType);
    if (!item || item.status !== "verified") {
      const label = DOC_LABELS[docType] ?? docType;
      missing.push(label);
    }
  }

  return { ready: missing.length === 0, missing };
}
