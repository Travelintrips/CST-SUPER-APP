/**
 * Shared safety and transport helpers for development-only HTTP regressions.
 *
 * These helpers deliberately do not start the API or load credentials. The
 * official command remains:
 *
 *   APP_ENV=development node artifacts/api-server/load-secrets.mjs \
 *     node <regression-script>
 *
 * The loader injects the canonical SUPABASE_DATABASE_URL for the selected
 * bundle. Keeping startup outside the test process makes accidental
 * production execution fail closed instead of silently selecting a fallback.
 */

const DEFAULT_API_BASE_URL = "http://127.0.0.1:18444";

export function getApiBaseUrl() {
  const configured = (process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  return configured.replace(/\/api$/, "");
}

export function getApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}

export function assertDevelopmentHarness({ requireDatabase = false } = {}) {
  if (process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Refusing regression harness in a production deployment");
  }
  if (process.env.APP_ENV !== "development") {
    throw new Error(
      "APP_ENV=development is required. Run through artifacts/api-server/load-secrets.mjs.",
    );
  }
  if (requireDatabase && !process.env.SUPABASE_DATABASE_URL) {
    throw new Error(
      "SUPABASE_DATABASE_URL is required after the official development secret loader",
    );
  }
  if (
    process.env.SUPABASE_DATABASE_URL_DEV &&
    process.env.SUPABASE_DATABASE_URL &&
    process.env.SUPABASE_DATABASE_URL_DEV === process.env.SUPABASE_DATABASE_URL
  ) {
    throw new Error("Refusing regression harness when development and production DB URLs are identical");
  }
}

function parseCookieHeader(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .find((value) => value.startsWith("sid="));
  }
  const raw = response.headers.get("set-cookie") ?? "";
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith("sid="));
}

export async function waitForApiReady({ timeoutMs = 120_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown readiness response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(getApiUrl("/api/health/ready"), {
        signal: AbortSignal.timeout(Math.min(intervalMs * 2, 5_000)),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.ready === true) return body;
      lastError = `HTTP ${response.status} ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`API did not become ready within ${timeoutMs}ms: ${lastError}`);
}

export async function devLogin({ email } = {}) {
  const usersResponse = await fetch(getApiUrl("/api/dev-users"));
  if (!usersResponse.ok) {
    throw new Error(`dev-users failed: HTTP ${usersResponse.status}`);
  }
  const usersBody = await usersResponse.json().catch(() => null);
  const admin = usersBody?.users?.find(
    (user) =>
      user?.role === "admin" &&
      typeof user?.email === "string" &&
      (!email || user.email === email),
  );
  if (!admin) {
    throw new Error(`No development admin user found${email ? ` for ${email}` : ""}`);
  }

  const response = await fetch(getApiUrl("/api/dev-login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: admin.email }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true || body?.role !== "admin") {
    throw new Error(`dev-login failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  const cookie = parseCookieHeader(response);
  if (!cookie) throw new Error("dev-login did not set the official sid cookie");
  return { cookie, email: admin.email };
}

export async function apiRequest(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const response = await fetch(getApiUrl(path), {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => null);
  return {
    status: response.status,
    body: json,
    headers: Object.fromEntries(response.headers.entries()),
  };
}