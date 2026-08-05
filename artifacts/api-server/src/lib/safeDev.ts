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

    if (!isLocal) {
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
  console.info(`[${tag}] WhatsApp, email, payment gateway, webhook, external HTTP, and background notification workers disabled`);
}