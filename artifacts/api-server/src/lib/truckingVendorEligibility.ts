import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  filterRowsByCapability,
  VENDOR_CAPABILITY_KEYS,
  type SupplierCapabilityCandidate,
} from "./vendorCapabilityService.js";

export const TRUCKING_AREA_LABELS: Record<string, string[]> = {
  "jawa-sumatra": ["Jabodetabek", "Jawa Barat", "Jawa Tengah", "Jawa Timur", "Sumatra"],
  kalimantan: ["Kalimantan"],
  sulawesi: ["Sulawesi"],
  "bali-nusra": ["Bali", "Nusa Tenggara"],
};

export function truckingAreaLabels(slugs: unknown[]): string[] {
  return [...new Set(
    slugs.flatMap((slug) => TRUCKING_AREA_LABELS[String(slug ?? "").trim()] ?? []),
  )];
}

function legacyTruckingMatch(serviceType: string): boolean {
  return /(^|[^a-z])(truck|trucking|land|darat|delivery|courier|kurir)([^a-z]|$)/i.test(serviceType);
}

export async function getEligibleTruckingPricingRows(
  vehicleType: string,
  areaSlugs: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const labels = truckingAreaLabels(areaSlugs);
  const areaFilter = labels.length
    ? sql`
        AND (
          cardinality(vtp.operation_areas) = 0
          OR vtp.operation_areas && ARRAY[
            ${sql.raw(labels.map((label) => `'${label.replace(/'/g, "''")}'`).join(","))}
          ]::text[]
        )
      `
    : sql``;

  const result = await db.execute(sql`
    SELECT vtp.*, s.name AS vendor_name, s.service_type AS "serviceType"
    FROM vendor_trucking_pricing vtp
    JOIN suppliers s ON s.id = vtp.vendor_id
    WHERE vtp.is_active = TRUE
      AND lower(vtp.vehicle_type) = lower(${vehicleType})
      ${areaFilter}
    ORDER BY vtp.price_per_km ASC
  `);

  const rows = result.rows as Array<Record<string, unknown> & SupplierCapabilityCandidate>;
  return filterRowsByCapability(
    rows,
    VENDOR_CAPABILITY_KEYS.TRUCKING,
    legacyTruckingMatch,
  );
}

export async function getEligibleTruckingVendorIds(
  vendorIds: number[],
): Promise<Set<number>> {
  const ids = [...new Set(vendorIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return new Set();

  const result = await db.execute(sql`
    SELECT id, service_type AS "serviceType"
    FROM suppliers
    WHERE id = ANY(ARRAY[${sql.raw(ids.join(","))}]::int[])
      AND is_active = TRUE
  `);
  const eligible = await filterRowsByCapability(
    result.rows as Array<SupplierCapabilityCandidate>,
    VENDOR_CAPABILITY_KEYS.TRUCKING,
    legacyTruckingMatch,
  );
  return new Set(eligible.map((supplier) => Number(supplier.id)));
}

export async function validateTruckingVendorIds(
  vendorIds: unknown[],
): Promise<{
  requestedVendorIds: number[];
  eligibleVendorIds: Set<number>;
  invalidVendorIds: number[];
}> {
  const requestedVendorIds = vendorIds.map((vendorId) => Number(vendorId));
  const eligibleVendorIds = await getEligibleTruckingVendorIds(requestedVendorIds);
  const invalidVendorIds = [...new Set(
    requestedVendorIds.filter((vendorId) =>
      !Number.isSafeInteger(vendorId) ||
      vendorId <= 0 ||
      !eligibleVendorIds.has(vendorId),
    ),
  )];
  return { requestedVendorIds, eligibleVendorIds, invalidVendorIds };
}