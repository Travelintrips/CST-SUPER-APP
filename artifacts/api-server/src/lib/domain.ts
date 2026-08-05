/**
 * Returns the best public domain for generating public-facing URLs.
 *
 * Priority:
 *  1. APP_URL env var (explicit override, e.g. https://cstlogistic.co.id)
 *  2. Custom domain from REPLIT_DOMAINS (non-Replit domain)
 *  3. First entry in REPLIT_DOMAINS (Replit subdomain as last resort)
 *
 * Returns only the hostname (no trailing slash).
 */
export function getPreferredDomain(): string {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      return new URL(appUrl).hostname;
    } catch {
      // fall through
    }
  }
  const raw = process.env.REPLIT_DOMAINS ?? "";
  const domains = raw.split(",").map((d) => d.trim()).filter(Boolean);
  if (!domains.length) return "";
  const custom = domains.find(
    (d) => !d.endsWith(".replit.app") && !d.endsWith(".replit.dev") && !d.endsWith(".repl.co")
  );
  return custom ?? domains[0];
}
