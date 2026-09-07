import { db, portalCustomersTable, userProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getPortalCustomerContextForCustomer,
  type PortalCustomerContext,
} from "./portalCustomerContextService.js";
import {
  resolveOnboardingStatus,
  type OnboardingStatusResult,
} from "./portalVendorOnboardingService.js";

const CUSTOMER_RETURN_PREFIXES = [
  "/login",
  "/register",
  "/dashboard",
  "/vendor-dashboard",
  "/orders",
  "/admin",
  "/services",
  "/marketplace",
  "/jasa",
  "/vendor",
  "/freight-forwarding",
  "/pabean",
  "/custom-clearance",
  "/book",
  "/logistic-order-success",
  "/track",
  "/calculator",
  "/kalkulator-biaya-logistik",
  "/kalkulator-impor",
  "/order-produk",
  "/onboarding",
  "/pending-approval",
  "/account-security",
  "/portal-dokumen",
  "/portal-invoice",
  "/company-profile",
  "/profile",
  "/air-freight-booking",
  "/ocean-freight-booking",
  "/ocean-freight",
  "/service-cart",
] as const;

const BLOCKED_CUSTOMER_RETURN_PREFIXES = [
  "/login",
  "/register",
  "/onboarding",
  "/pending-approval",
  "/admin",
  "/vendor-dashboard",
] as const;

export type PortalAuthBootstrapTiming = {
  USER_PROFILE_MS: number;
  ROLE_RESOLUTION_MS: number;
  ONBOARDING_STATUS_MS: number;
  COMPANY_CONTEXT_MS: number;
  VENDOR_APPROVAL_MS: number;
  REDIRECT_DECISION_MS: number;
  TOTAL_RESOLUTION_MS: number;
};

export type PortalAuthBootstrap = {
  authenticated: true;
  user: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    company: string | null;
    role: string;
    customerType: string | null;
  };
  role: string;
  onboardingComplete: boolean;
  onboardingStatus: string;
  customerType: string | null;
  customerContext: Pick<
    PortalCustomerContext,
    "status" | "companyId" | "company" | "activeMemberships" | "pendingRequest"
  >;
  vendorApprovalStatus: string | null;
  allowedDestination: string;
  safeReturnTo: string | null;
  timings: PortalAuthBootstrapTiming;
};

export class PortalAuthBootstrapError extends Error {
  constructor(public readonly statusCode: 401 | 404, message: string) {
    super(message);
    this.name = "PortalAuthBootstrapError";
  }
}

export function safePortalReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;

  let parsed: URL;
  try {
    parsed = new URL(value, "https://portal.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://portal.invalid" || parsed.pathname.startsWith("//")) return null;
  if (!CUSTOMER_RETURN_PREFIXES.some((prefix) =>
    parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`),
  )) {
    return null;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function isBlockedCustomerReturnTo(value: string): boolean {
  return BLOCKED_CUSTOMER_RETURN_PREFIXES.some((prefix) =>
    value === prefix || value.startsWith(`${prefix}/`),
  );
}

function resolveAllowedDestination(
  role: string,
  onboarding: OnboardingStatusResult,
  context: PortalCustomerContext,
  safeReturnTo: string | null,
): string {
  if (role === "admin") return "/admin";
  if (
    role === "customer"
    && onboarding.status === "active"
    && (context.status === "legacy_unresolved" || context.status === "company_unresolved")
  ) {
    return "/onboarding";
  }
  if (context.status === "company_pending" || onboarding.status === "company_pending") {
    return "/pending-approval";
  }
  if (onboarding.status === "incomplete") return "/onboarding";
  if (onboarding.status === "pending" || onboarding.status === "rejected") {
    return "/pending-approval";
  }
  if (safeReturnTo && !isBlockedCustomerReturnTo(safeReturnTo)) return safeReturnTo;
  return role === "vendor" ? "/vendor-dashboard" : "/dashboard";
}

/**
 * Canonical post-auth decision. It is intentionally server-side: the browser
 * receives the already-authorized destination, but protected APIs still
 * enforce the session and tenant/role boundary independently.
 */
export async function getPortalAuthBootstrap(
  customerId: number,
  requestedReturnTo?: unknown,
): Promise<PortalAuthBootstrap> {
  const totalStart = performance.now();
  const [customer] = await db
    .select({
      id: portalCustomersTable.id,
      name: portalCustomersTable.name,
      email: portalCustomersTable.email,
      phone: portalCustomersTable.phone,
      company: portalCustomersTable.company,
      role: portalCustomersTable.role,
      customerType: portalCustomersTable.customerType,
    })
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId))
    .limit(1);

  if (!customer) {
    throw new PortalAuthBootstrapError(404, "Customer tidak ditemukan.");
  }

  // The DEV transaction pooler penalizes concurrent queries from the same
  // authenticated bootstrap more than it benefits from parallelism. Keep the
  // two independent reads serial here; this is measured faster end-to-end.
  const profileStart = performance.now();
  const [profile] = await db
    .select({
      status: userProfilesTable.status,
      accountType: userProfilesTable.accountType,
      rejectionReason: userProfilesTable.rejectionReason,
      fullName: userProfilesTable.fullName,
      phone: userProfilesTable.phone,
      address: userProfilesTable.address,
      ktpUrl: userProfilesTable.ktpUrl,
    })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.customerId, customerId));
  const profileMs = performance.now() - profileStart;

  const contextStart = performance.now();
  const context = await getPortalCustomerContextForCustomer(customerId, {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    customerType: customer.customerType,
    legacyCompany: customer.company,
  });
  const contextMs = performance.now() - contextStart;

  const roleStart = performance.now();
  const onboarding = resolveOnboardingStatus(profile ?? null, customer.role);
  const roleMs = performance.now() - roleStart;
  const onboardingStart = performance.now();
  const onboardingStatus = onboarding.status;
  const onboardingMs = performance.now() - onboardingStart;

  const vendorApprovalStart = performance.now();
  const vendorApprovalStatus = customer.role === "vendor"
    ? onboardingStatus === "active" ? "approved" : onboardingStatus
    : null;
  const vendorApprovalMs = performance.now() - vendorApprovalStart;

  const safeReturnTo = safePortalReturnTo(requestedReturnTo);
  const redirectStart = performance.now();
  const allowedDestination = resolveAllowedDestination(
    customer.role,
    onboarding,
    context,
    safeReturnTo,
  );
  const redirectMs = performance.now() - redirectStart;

  const onboardingComplete =
    onboardingStatus === "active"
    && context.status !== "legacy_unresolved"
    && context.status !== "company_unresolved"
    && context.status !== "company_pending";

  return {
    authenticated: true,
    user: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      role: customer.role,
      customerType: context.customerType,
    },
    role: customer.role,
    onboardingComplete,
    onboardingStatus,
    customerType: context.customerType,
    customerContext: {
      status: context.status,
      companyId: context.companyId,
      company: context.company,
      activeMemberships: context.activeMemberships,
      pendingRequest: context.pendingRequest,
    },
    vendorApprovalStatus,
    allowedDestination,
    safeReturnTo,
    timings: {
      USER_PROFILE_MS: Math.round(profileMs),
      ROLE_RESOLUTION_MS: Math.round(roleMs),
      ONBOARDING_STATUS_MS: Math.round(onboardingMs),
      COMPANY_CONTEXT_MS: Math.round(contextMs),
      VENDOR_APPROVAL_MS: Math.round(vendorApprovalMs),
      REDIRECT_DECISION_MS: Math.round(redirectMs),
      TOTAL_RESOLUTION_MS: Math.round(performance.now() - totalStart),
    },
  };
}