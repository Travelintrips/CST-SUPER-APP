export type GoogleOAuthFlow = "customer_portal" | "bizportal";

export const CUSTOMER_GOOGLE_LOGIN_FAILURE = "/login?oauth_error=google_callback_failed";
export const BIZPORTAL_GOOGLE_LOGIN_FAILURE = "/bizportal/";

const CUSTOMER_PORTAL_RETURN_PREFIXES = [
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
];

function isAllowedCustomerPortalPath(value: string): boolean {
  const pathname = value.split(/[?#]/, 1)[0];
  return pathname === "/" || CUSTOMER_PORTAL_RETURN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function safeReturnTo(value: unknown, flow: GoogleOAuthFlow = "bizportal"): string {
  if (value === "popup") return "popup";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  if (flow === "customer_portal" && !isAllowedCustomerPortalPath(value)) {
    return "/";
  }
  return value;
}

export function encodeGoogleOAuthContext(flow: GoogleOAuthFlow, returnTo: unknown): string {
  return flow === "customer_portal"
    ? `portal:${safeReturnTo(returnTo, flow)}`
    : safeReturnTo(returnTo);
}

export function decodeGoogleOAuthContext(
  storedReturnTo: string | null | undefined,
): { flow: GoogleOAuthFlow; returnTo: string } | null {
  if (!storedReturnTo) return null;
  if (storedReturnTo.startsWith("portal:")) {
    return {
      flow: "customer_portal",
      returnTo: safeReturnTo(storedReturnTo.slice("portal:".length), "customer_portal"),
    };
  }
  if (storedReturnTo.startsWith("/")) {
    return { flow: "bizportal", returnTo: safeReturnTo(storedReturnTo) };
  }
  if (storedReturnTo === "popup") {
    return { flow: "bizportal", returnTo: "popup" };
  }
  return null;
}

export function getGoogleOAuthFailureRedirect(flow: GoogleOAuthFlow | null): string {
  return flow === "customer_portal"
    ? CUSTOMER_GOOGLE_LOGIN_FAILURE
    : flow === "bizportal"
      ? BIZPORTAL_GOOGLE_LOGIN_FAILURE
      : CUSTOMER_GOOGLE_LOGIN_FAILURE;
}

export function getGoogleOAuthCallbackContext(
  storedReturnTo: string | null | undefined,
): { flow: GoogleOAuthFlow; returnTo: string } {
  return decodeGoogleOAuthContext(storedReturnTo) ?? {
    flow: "customer_portal",
    returnTo: CUSTOMER_GOOGLE_LOGIN_FAILURE,
  };
}