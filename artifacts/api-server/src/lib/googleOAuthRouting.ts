export type GoogleOAuthFlow = "customer_portal" | "bizportal";

export const CUSTOMER_GOOGLE_LOGIN_FAILURE = "/login?oauth_error=google_callback_failed";
export const BIZPORTAL_GOOGLE_LOGIN_FAILURE = "/bizportal/";

function safeReturnTo(value: unknown): string {
  if (value === "popup") return "popup";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export function encodeGoogleOAuthContext(flow: GoogleOAuthFlow, returnTo: unknown): string {
  return flow === "customer_portal"
    ? `portal:${safeReturnTo(returnTo)}`
    : safeReturnTo(returnTo);
}

export function decodeGoogleOAuthContext(
  storedReturnTo: string | null | undefined,
): { flow: GoogleOAuthFlow; returnTo: string } | null {
  if (!storedReturnTo) return null;
  if (storedReturnTo.startsWith("portal:")) {
    return {
      flow: "customer_portal",
      returnTo: safeReturnTo(storedReturnTo.slice("portal:".length)),
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