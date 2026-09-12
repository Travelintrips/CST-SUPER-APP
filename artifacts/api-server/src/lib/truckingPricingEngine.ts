export type TollMode = "include" | "actual_cost" | "flat";
export type FerryMode = "actual_cost" | "flat" | "not_available";

export interface VendorTruckingPricingInput {
  vehicleType: string;
  pricePerKm: number;
  minimumCharge: number;
  innerCityRadiusKm: number;
  outOfCitySurchargePercent: number;
  interProvinceSurchargePercent: number;
  interIslandSurchargePercent: number;
  tollMode: TollMode;
  tollFlatAmount: number;
  ferryMode: FerryMode;
  ferryFlatAmount: number;
  loadingHelperFee: number;
  unloadingHelperFee: number;
  insurancePercent: number;
  urgentSurchargePercent: number;
  waitingFreeHours: number;
  waitingFeePerHour: number;
  multidropFeePerDrop: number;
  overnightFeePerNight: number;
  dailyRentalPrice: number;
}

export interface TruckingEstimateOptions {
  distanceKm?: number;
  pickupArea?: string;
  deliveryArea?: string;
  isDifferentProvince?: boolean;
  isDifferentIsland?: boolean;
  withLoadingHelper?: boolean;
  withUnloadingHelper?: boolean;
  tollActualCost?: number;
  ferryActualCost?: number;
  waitingHours?: number;
  extraDrops?: number;
  overnightNights?: number;
  isUrgent?: boolean;
  cargoValue?: number;
  rentalDays?: number;
}

export interface SurchargeBreakdown {
  out_of_city: number;
  inter_province: number;
  inter_island: number;
  total: number;
}

export interface ExtrasBreakdown {
  loading_helper: number;
  unloading_helper: number;
  toll: number;
  ferry: number;
  waiting: number;
  multidrop: number;
  overnight: number;
  urgent: number;
  insurance: number;
  total: number;
}

export interface TruckingEstimateResult {
  vehicle_type: string;
  distance_km: number;
  distance_source: "provided" | "matrix_estimate" | "unknown";
  price_per_km: number;
  minimum_charge: number;
  base_price: number;
  base_after_minimum: number;
  surcharge_breakdown: SurchargeBreakdown;
  extras_breakdown: ExtrasBreakdown;
  total_estimate: number;
}

const ROUTE_MATRIX: Record<string, Record<string, number>> = {
  "jakarta utara":    { "bekasi": 42, "cikarang": 52, "karawang": 78, "bandung": 175, "surabaya": 780, "default": 100 },
  "jakarta selatan":  { "bekasi": 38, "cikarang": 55, "karawang": 80, "bandung": 160, "surabaya": 790, "default": 100 },
  "jakarta barat":    { "bekasi": 50, "cikarang": 62, "karawang": 65, "bandung": 150, "surabaya": 800, "default": 100 },
  "jakarta timur":    { "bekasi": 25, "cikarang": 38, "karawang": 65, "bandung": 170, "surabaya": 775, "default": 90 },
  "jakarta pusat":    { "bekasi": 35, "cikarang": 48, "karawang": 72, "bandung": 165, "surabaya": 785, "default": 95 },
  "cilincing":        { "bekasi": 35, "cikarang": 45, "karawang": 70, "cibitung": 38, "default": 80 },
  "bekasi":           { "jakarta": 35, "cikarang": 15, "karawang": 40, "bandung": 130, "surabaya": 745, "default": 50 },
  "cikarang":         { "jakarta": 45, "bekasi": 15, "karawang": 28, "bandung": 120, "surabaya": 735, "default": 50 },
  "karawang":         { "jakarta": 75, "bekasi": 40, "cikarang": 28, "bandung": 95, "surabaya": 710, "default": 60 },
  "bandung":          { "jakarta": 165, "bekasi": 130, "surabaya": 615, "default": 80 },
  "surabaya":         { "jakarta": 780, "bandung": 615, "semarang": 310, "default": 100 },
  "semarang":         { "jakarta": 450, "surabaya": 310, "solo": 100, "default": 80 },
};

function estimateDistanceFromAreas(pickup: string, delivery: string): number {
  const p = pickup.toLowerCase().trim();
  const d = delivery.toLowerCase().trim();

  for (const [origin, dests] of Object.entries(ROUTE_MATRIX)) {
    if (p.includes(origin) || origin.includes(p)) {
      for (const [dest, km] of Object.entries(dests)) {
        if (dest === "default") continue;
        if (d.includes(dest) || dest.includes(d)) return km;
      }
      return dests["default"] ?? 100;
    }
  }
  return 150;
}

export function calculateTruckingEstimate(
  options: TruckingEstimateOptions,
  pricing: VendorTruckingPricingInput,
): TruckingEstimateResult {
  let distanceKm: number;
  let distanceSource: TruckingEstimateResult["distance_source"];

  if (options.distanceKm != null && options.distanceKm > 0) {
    distanceKm = options.distanceKm;
    distanceSource = "provided";
  } else if (options.pickupArea && options.deliveryArea) {
    distanceKm = estimateDistanceFromAreas(options.pickupArea, options.deliveryArea);
    distanceSource = "matrix_estimate";
  } else {
    distanceKm = 0;
    distanceSource = "unknown";
  }

  const base = distanceKm * pricing.pricePerKm;
  const baseAfterMinimum = Math.max(base, pricing.minimumCharge);

  const outOfCity =
    distanceKm > pricing.innerCityRadiusKm
      ? baseAfterMinimum * (pricing.outOfCitySurchargePercent / 100)
      : 0;
  const interProvince = options.isDifferentProvince
    ? baseAfterMinimum * (pricing.interProvinceSurchargePercent / 100)
    : 0;
  const interIsland = options.isDifferentIsland
    ? baseAfterMinimum * (pricing.interIslandSurchargePercent / 100)
    : 0;

  const surchargeBreakdown: SurchargeBreakdown = {
    out_of_city: Math.round(outOfCity),
    inter_province: Math.round(interProvince),
    inter_island: Math.round(interIsland),
    total: Math.round(outOfCity + interProvince + interIsland),
  };

  const baseWithSurcharge = baseAfterMinimum + surchargeBreakdown.total;

  const loadingHelper = options.withLoadingHelper ? pricing.loadingHelperFee : 0;
  const unloadingHelper = options.withUnloadingHelper ? pricing.unloadingHelperFee : 0;

  let toll = 0;
  if (pricing.tollMode === "flat") {
    toll = pricing.tollFlatAmount;
  } else if (pricing.tollMode === "actual_cost") {
    toll = options.tollActualCost ?? 0;
  }

  let ferry = 0;
  if (pricing.ferryMode === "flat") {
    ferry = pricing.ferryFlatAmount;
  } else if (pricing.ferryMode === "actual_cost") {
    ferry = options.ferryActualCost ?? 0;
  }

  const extraWaitingHours = Math.max(0, (options.waitingHours ?? 0) - pricing.waitingFreeHours);
  const waiting = extraWaitingHours * pricing.waitingFeePerHour;
  const multidrop = (options.extraDrops ?? 0) * pricing.multidropFeePerDrop;
  const overnight = (options.overnightNights ?? 0) * pricing.overnightFeePerNight;
  const urgent = options.isUrgent ? baseWithSurcharge * (pricing.urgentSurchargePercent / 100) : 0;
  const cargoValue = options.cargoValue ?? 0;
  const insurance = cargoValue > 0 ? cargoValue * (pricing.insurancePercent / 100) : 0;

  const extrasBreakdown: ExtrasBreakdown = {
    loading_helper: Math.round(loadingHelper),
    unloading_helper: Math.round(unloadingHelper),
    toll: Math.round(toll),
    ferry: Math.round(ferry),
    waiting: Math.round(waiting),
    multidrop: Math.round(multidrop),
    overnight: Math.round(overnight),
    urgent: Math.round(urgent),
    insurance: Math.round(insurance),
    total: Math.round(loadingHelper + unloadingHelper + toll + ferry + waiting + multidrop + overnight + urgent + insurance),
  };

  const totalEstimate = Math.round(baseWithSurcharge + extrasBreakdown.total);

  return {
    vehicle_type: pricing.vehicleType,
    distance_km: distanceKm,
    distance_source: distanceSource,
    price_per_km: pricing.pricePerKm,
    minimum_charge: pricing.minimumCharge,
    base_price: Math.round(base),
    base_after_minimum: Math.round(baseAfterMinimum),
    surcharge_breakdown: surchargeBreakdown,
    extras_breakdown: extrasBreakdown,
    total_estimate: totalEstimate,
  };
}

export function pricingRowToInput(row: Record<string, unknown>): VendorTruckingPricingInput {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    vehicleType: String(row.vehicle_type ?? ""),
    pricePerKm: n(row.price_per_km),
    minimumCharge: n(row.minimum_charge),
    innerCityRadiusKm: n(row.inner_city_radius_km),
    outOfCitySurchargePercent: n(row.out_of_city_surcharge_percent),
    interProvinceSurchargePercent: n(row.inter_province_surcharge_percent),
    interIslandSurchargePercent: n(row.inter_island_surcharge_percent),
    tollMode: (row.toll_mode as TollMode) ?? "actual_cost",
    tollFlatAmount: n(row.toll_flat_amount),
    ferryMode: (row.ferry_mode as FerryMode) ?? "not_available",
    ferryFlatAmount: n(row.ferry_flat_amount),
    loadingHelperFee: n(row.loading_helper_fee),
    unloadingHelperFee: n(row.unloading_helper_fee),
    insurancePercent: n(row.insurance_percent),
    urgentSurchargePercent: n(row.urgent_surcharge_percent),
    waitingFreeHours: n(row.waiting_free_hours),
    waitingFeePerHour: n(row.waiting_fee_per_hour),
    multidropFeePerDrop: n(row.multidrop_fee_per_drop),
    overnightFeePerNight: n(row.overnight_fee_per_night),
    dailyRentalPrice: n(row.daily_rental_price),
  };
}
