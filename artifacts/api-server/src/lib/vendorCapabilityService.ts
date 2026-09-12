import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Runtime contract for public.vendor_capabilities.
 *
 * This table is part of the existing DEVELOPMENT Supabase schema but is not
 * represented by the Drizzle schema package. Keep this adapter raw and small
 * until the table is promoted into the shared schema/migration chain.
 */
export const VENDOR_CAPABILITY_KEYS = {
  SEA_FREIGHT: "seaFreight",
  AIR_FREIGHT: "airFreight",
  CUSTOMS: "customs",
  TRUCKING: "trucking",
} as const;

export type VendorCapabilityKey =
  (typeof VENDOR_CAPABILITY_KEYS)[keyof typeof VENDOR_CAPABILITY_KEYS];

export function capabilityForServiceRequest(
  serviceRequest: string | null | undefined,
): VendorCapabilityKey | null {
  const value = (serviceRequest ?? "").toLowerCase();
  if (/(^|[^a-z])(air|udara|air_freight)([^a-z]|$)/.test(value)) {
    return VENDOR_CAPABILITY_KEYS.AIR_FREIGHT;
  }
  if (/(^|[^a-z])(sea|ocean|laut|sea_freight|fcl|lcl)([^a-z]|$)/.test(value)) {
    return VENDOR_CAPABILITY_KEYS.SEA_FREIGHT;
  }
  if (/(custom|customs|clearance|kepabeanan|ppjk)/.test(value)) {
    return VENDOR_CAPABILITY_KEYS.CUSTOMS;
  }
  if (/(truck|trucking|land|darat|delivery|courier|kurir)/.test(value)) {
    return VENDOR_CAPABILITY_KEYS.TRUCKING;
  }
  return null;
}

export type SupplierCapabilityCandidate = SupplierLike & {
  vendorName?: string | null;
  [key: string]: unknown;
};

type SupplierLike = {
  id: number;
  serviceType?: string | null;
};

type CapabilityState = {
  configured: boolean;
  active: Set<string>;
};

const EMPTY_STATE: CapabilityState = {
  configured: false,
  active: new Set<string>(),
};

function positiveIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function idList(ids: number[]): ReturnType<typeof sql.raw> {
  return sql.raw(ids.join(","));
}

/**
 * Read capability state for a set of suppliers.
 *
 * A vendor with any capability row is governed by that explicit configuration,
 * including inactive rows. Vendors without capability rows retain the legacy
 * service_type fallback so existing configurations (notably PT Diva) remain
 * valid while the table is adopted incrementally.
 */
export async function getVendorCapabilityStates(
  vendorIds: number[],
  companyId?: number | null,
): Promise<Map<number, CapabilityState>> {
  const ids = positiveIds(vendorIds);
  const states = new Map<number, CapabilityState>();
  if (ids.length === 0) return states;

  const companyScope = Number.isSafeInteger(companyId) && Number(companyId) > 0
    ? String(companyId)
    : null;
  const rows = await db.execute(sql`
    SELECT vendor_id, company_id, service_type, is_active
    FROM vendor_capabilities
    WHERE vendor_id = ANY(ARRAY[${idList(ids)}]::int[])
  `);

  for (const row of rows.rows as Array<{
    vendor_id: number;
    company_id: string;
    service_type: string;
    is_active: boolean;
  }>) {
    const vendorId = Number(row.vendor_id);
    const current = states.get(vendorId) ?? {
      configured: false,
      active: new Set<string>(),
    };
    current.configured = true;

    const inScope = row.company_id === "default"
      || companyScope == null
      || row.company_id === companyScope;
    if (inScope && row.is_active) current.active.add(row.service_type);
    states.set(vendorId, current);
  }

  return states;
}

export async function filterSuppliersByCapability<T extends SupplierLike>(
  suppliers: T[],
  capability: VendorCapabilityKey,
  legacyMatch: (serviceType: string) => boolean,
  companyId?: number | null,
): Promise<T[]> {
  const states = await getVendorCapabilityStates(
    suppliers.map((supplier) => supplier.id),
    companyId,
  );

  return suppliers.filter((supplier) => {
    const state = states.get(supplier.id);
    if (state?.configured) return state.active.has(capability);
    return legacyMatch((supplier.serviceType ?? "").toLowerCase());
  });
}

/**
 * Filter an already-loaded supplier/pricing result without losing the
 * pricing row. This keeps capability precedence in one place for public
 * discovery and authenticated submission validation.
 */
export async function filterRowsByCapability<T extends SupplierCapabilityCandidate>(
  rows: T[],
  capability: VendorCapabilityKey,
  legacyMatch: (serviceType: string) => boolean,
  companyId?: number | null,
): Promise<T[]> {
  const eligible = await filterSuppliersByCapability(
    rows,
    capability,
    legacyMatch,
    companyId,
  );
  return eligible;
}

export function capabilityMatches(
  state: CapabilityState | undefined,
  capability: VendorCapabilityKey,
  serviceType: string | null | undefined,
  legacyMatch: (normalisedServiceType: string) => boolean,
): boolean {
  if (state?.configured) return state.active.has(capability);
  return legacyMatch((serviceType ?? "").toLowerCase());
}

export { EMPTY_STATE };