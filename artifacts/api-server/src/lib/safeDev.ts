/**
 * SAFE DEV TEST MODE safety boundary.
 *
 * When enabled, application-level E2E may exercise the real HTTP routes without
 * allowing the process to contact external providers. Database access remains
 * available so the run-scoped fixtures and cleanup can be verified.
 */

const SAFE_DEV_TEST_MODE = "true";
let outboundGuardInstalled = false;
let outboundBlockLogged = false;

export function isSafeDevTestMode(): boolean {
  return process.env.SAFE_DEV_TEST_MODE === SAFE_DEV_TEST_MODE;
}

/**
 * The development UI needs real image bytes in Supabase Storage so an upload
 * cannot report success while leaving only a database row behind. Keep the
 * broader safe-dev outbound block in place and allow only Storage API calls to
 * the configured development Supabase origin.
 */
function isAllowedDevelopmentStorageRequest(url: URL): boolean {
  if (process.env.APP_ENV !== "development" || process.env.ALLOW_DEV_STORAGE_WRITES !== "true") {
    return false;
  }

  const configuredUrls = [
    process.env.SUPABASE_URL_DEV,
    process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_URL_DEV,
    process.env.VITE_SUPABASE_URL,
  ].filter(Boolean) as string[];

  return configuredUrls.some((raw) => {
    try {
      const normalized = raw.startsWith("http://") || raw.startsWith("https://")
        ? raw
        : `https://${raw}.supabase.co`;
      const configured = new URL(normalized);
      return configured.origin === url.origin && url.pathname.startsWith("/storage/v1/");
    } catch {
      return false;
    }
  });
}

/**
 * Address autocomplete is a development UI capability, not a write-side
 * integration. Allow only the Google Maps web-service paths used by the
 * geocoding proxy while SAFE_DEV_TEST_MODE remains enabled.
 */
function isAllowedDevelopmentMapsRequest(url: URL): boolean {
  if (process.env.APP_ENV !== "development") return false;
  if (url.hostname !== "maps.googleapis.com") return false;

  return url.pathname === "/maps/api/place/autocomplete/json"
    || url.pathname === "/maps/api/place/details/json"
    || url.pathname === "/maps/api/distancematrix/json";
}

/**
 * Invoice OCR is an explicit development-preview capability. Allow only the
 * configured OpenAI endpoint, never arbitrary external HTTP. E2E runs remain
 * fully fail-closed even when a caller accidentally inherits the preview flag.
 */
function isAllowedDevelopmentAiRequest(url: URL): boolean {
  if (
    process.env.APP_ENV !== "development"
    || process.env.ALLOW_DEV_AI_REQUESTS !== "true"
    || process.env.E2E_TEST_MODE === "true"
  ) {
    return false;
  }

  const allowedBases: string[] = [];
  if (process.env.OPENAI_API_KEY?.trim()) {
    allowedBases.push(process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1");
  }
  if (
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim()
    && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim()
  ) {
    allowedBases.push(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL.trim());
  }
  if (allowedBases.length === 0) return false;

  return allowedBases.some((raw) => {
    try {
      const base = new URL(raw);
      return base.origin === url.origin
        && (base.pathname === "/" || url.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/"));
    } catch {
      return false;
    }
  });
}

/** Returns true when either SAFE_DEV_TEST_MODE or E2E_TEST_MODE is active. */
export function externalIntegrationsDisabled(): boolean {
  return isSafeDevTestMode() || process.env.E2E_TEST_MODE === "true";
}

export function installSafeDevOutboundGuard(): void {
  if (!externalIntegrationsDisabled() || outboundGuardInstalled) return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return originalFetch(input, init);
    }

    const isLocal = parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname === "::1";

    if (
      !isLocal
      && !isAllowedDevelopmentStorageRequest(parsed)
      && !isAllowedDevelopmentMapsRequest(parsed)
      && !isAllowedDevelopmentAiRequest(parsed)
    ) {
      if (!outboundBlockLogged) {
        outboundBlockLogged = true;
        console.info("[SAFE_DEV_TEST_MODE] External HTTP disabled; outbound request blocked");
      }
      throw new Error("SAFE_DEV_TEST_MODE: external HTTP is disabled");
    }

    return originalFetch(input, init);
  };

  outboundGuardInstalled = true;
}

export function logSafeDevStartupBanner(): void {
  if (!externalIntegrationsDisabled()) return;
  const tag = isSafeDevTestMode() ? "SAFE_DEV_TEST_MODE" : "E2E_TEST_MODE";
  console.info(`[${tag}] TEST SAFETY MODE ENABLED`);
  console.info(`[${tag}] External integrations disabled`);
  if (isSafeDevTestMode() && process.env.ALLOW_DEV_STORAGE_WRITES === "true") {
    console.info("[SAFE_DEV_TEST_MODE] Development Supabase Storage writes enabled for authenticated media uploads");
  }
  console.info(`[${tag}] WhatsApp, email, payment gateway, webhook, external HTTP, and background notification workers disabled`);
}