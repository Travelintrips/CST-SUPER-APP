/**
 * e2eSafetyGuard.ts — Phase 4: Safe HTTP E2E Mode Guard
 *
 * Saat E2E_TEST_MODE=true atau SAFE_DEV_TEST_MODE=true:
 *   - Semua outbound eksternal HARUS disabled atau mocked
 *   - Guard mencetak startup banner
 *   - Guard menyediakan endpoint status read-only GET /api/health/e2e-safety
 *   - Guard TIDAK mencetak secret
 *   - Jika e2e mode aktif tapi outbound belum dinonaktifkan → fail startup
 *
 * Di production mode, endpoint e2e-safety TIDAK tersedia.
 */

export type OutboundStatus = "mocked" | "disabled" | "live" | "unconfigured";

export interface E2ESafetyStatus {
  e2eMode: boolean;
  whatsapp: OutboundStatus;
  email: OutboundStatus;
  payment: OutboundStatus;
  webhooks: OutboundStatus;
  workers: OutboundStatus;
  storage: OutboundStatus;
  activatedAt: string | null;
  issues: string[];
}

let _status: E2ESafetyStatus | null = null;

export function isE2EMode(): boolean {
  return (
    process.env["E2E_TEST_MODE"] === "true" ||
    process.env["SAFE_DEV_TEST_MODE"] === "true"
  );
}

export function isProductionMode(): boolean {
  return (
    process.env["NODE_ENV"] === "production" ||
    !!process.env["REPLIT_DEPLOYMENT"]
  );
}

/**
 * Menentukan status outbound berdasarkan env flags.
 * Jangan memanggil layanan eksternal di sini.
 */
function resolveOutboundStatus(): Omit<E2ESafetyStatus, "e2eMode" | "activatedAt" | "issues"> {
  const e2e = isE2EMode();

  // WhatsApp (Fonnte)
  // MOCK_WHATSAPP/DISABLE_WHATSAPP take precedence — explicit mock flag means "mocked"
  // regardless of whether actual credentials are configured.
  const waMocked =
    process.env["MOCK_WHATSAPP"] === "true" ||
    process.env["DISABLE_WHATSAPP"] === "true";
  const waConfigured = !!process.env["FONNTE_TOKEN"]?.trim();
  let whatsapp: OutboundStatus;
  if (waMocked) whatsapp = "mocked";
  else if (!waConfigured) whatsapp = "unconfigured";
  else if (e2e) whatsapp = "live"; // e2e but not explicitly mocked → issue
  else whatsapp = "live";

  // Email / SMTP
  const emailMocked =
    process.env["DISABLE_EMAIL"] === "true" ||
    process.env["MOCK_EMAIL"] === "true";
  const emailConfigured = !!process.env["SMTP_PASS"]?.trim();
  let email: OutboundStatus;
  if (emailMocked) email = "mocked";
  else if (!emailConfigured) email = "unconfigured";
  else if (e2e) email = "live"; // issue
  else email = "live";

  // Payment (Paylabs)
  const paymentMocked =
    process.env["MOCK_PAYMENT"] === "true" ||
    process.env["USE_PAYMENT_SANDBOX"] === "true";
  const paymentConfigured = !!process.env["PAYLABS_PRIVATE_KEY"]?.trim();
  let payment: OutboundStatus;
  if (paymentMocked) payment = "mocked";
  else if (!paymentConfigured) payment = "unconfigured";
  else if (e2e) payment = "live"; // issue
  else payment = "live";

  // Webhooks
  const webhooksDisabled =
    process.env["DISABLE_WEBHOOKS"] === "true" ||
    e2e && process.env["MOCK_WEBHOOKS"] !== "false";
  const webhooks: OutboundStatus = webhooksDisabled ? "disabled" : "live";

  // Background workers
  const workersDisabled =
    process.env["DISABLE_WORKERS"] === "true" ||
    e2e && process.env["KEEP_WORKERS"] !== "true";
  const workers: OutboundStatus = workersDisabled ? "disabled" : "live";

  // Storage
  const storageMocked =
    process.env["MOCK_STORAGE"] === "true" ||
    process.env["USE_TEST_STORAGE"] === "true";
  const storage: OutboundStatus = storageMocked ? "test-only" as OutboundStatus : "live";

  return { whatsapp, email, payment, webhooks, workers, storage };
}

/**
 * Dipanggil saat startup.
 * Jika E2E mode aktif dan ada outbound yang masih "live" → throw.
 */
export function checkE2ESafety(): void {
  const e2e = isE2EMode();

  if (!e2e) {
    _status = {
      e2eMode: false,
      whatsapp: "live",
      email: "live",
      payment: "live",
      webhooks: "live",
      workers: "live",
      storage: "live",
      activatedAt: null,
      issues: [],
    };
    return;
  }

  const outbound = resolveOutboundStatus();
  const issues: string[] = [];

  // Dalam E2E mode, "live" pada outbound berbahaya adalah masalah
  const dangerousLive: Array<[keyof typeof outbound, string]> = [
    ["whatsapp", "WhatsApp (FONNTE) masih live — set MOCK_WHATSAPP=true atau DISABLE_WHATSAPP=true"],
    ["email",    "Email/SMTP masih live — set MOCK_EMAIL=true atau DISABLE_EMAIL=true"],
    ["payment",  "Paylabs payment masih live — set MOCK_PAYMENT=true atau USE_PAYMENT_SANDBOX=true"],
  ];

  for (const [key, msg] of dangerousLive) {
    if (outbound[key] === "live") {
      issues.push(msg);
    }
  }

  _status = {
    e2eMode: true,
    ...outbound,
    activatedAt: new Date().toISOString(),
    issues,
  };

  // Cetak startup banner
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║         E2E / SAFE TEST MODE AKTIF              ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  E2E_TEST_MODE       = ${process.env["E2E_TEST_MODE"] ?? "false"}`);
  console.log(`║  SAFE_DEV_TEST_MODE  = ${process.env["SAFE_DEV_TEST_MODE"] ?? "false"}`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  whatsapp  → ${outbound.whatsapp}`);
  console.log(`║  email     → ${outbound.email}`);
  console.log(`║  payment   → ${outbound.payment}`);
  console.log(`║  webhooks  → ${outbound.webhooks}`);
  console.log(`║  workers   → ${outbound.workers}`);
  console.log(`║  storage   → ${outbound.storage}`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  if (issues.length > 0) {
    console.error("[e2eSafetyGuard] FATAL: E2E mode aktif tapi outbound berikut belum dinonaktifkan:");
    for (const issue of issues) {
      console.error(`  ✗  ${issue}`);
    }
    throw new Error(
      `[e2eSafetyGuard] Startup dibatalkan: ${issues.length} outbound channel masih live dalam E2E mode.\n` +
      `Set env vars yang diperlukan untuk menonaktifkan outbound sebelum menjalankan E2E test.`
    );
  }

  console.log("[e2eSafetyGuard] OK — semua outbound channel aman untuk E2E testing.");
}

/**
 * Mengembalikan status E2E safety untuk health endpoint.
 * Hanya boleh dipanggil setelah checkE2ESafety().
 */
export function getE2ESafetyStatus(): E2ESafetyStatus {
  if (!_status) {
    // checkE2ESafety belum dipanggil — inisialisasi default
    checkE2ESafety();
  }
  return _status!;
}

/**
 * Alias for checkE2ESafety() — throws if E2E mode is declared but outbound
 * is not suppressed. Called at startup to fail fast on misconfiguration.
 */
export function assertE2ESafetyOrDie(): void {
  // checkE2ESafety() already throws on unsafe configuration; call it if not
  // yet run so the startup banner is printed and issues are surfaced.
  if (!_status) {
    checkE2ESafety();
  }
  // If checkE2ESafety() detected issues it already threw; reaching here is safe.
}

/**
 * Registers GET /api/health/e2e-safety on the provided router.
 * Only exposed when E2E_TEST_MODE or SAFE_DEV_TEST_MODE is active.
 */
export function registerE2ESafetyEndpoint(router: { get: (path: string, handler: (req: unknown, res: { status: (n: number) => { json: (b: unknown) => void }, json: (b: unknown) => void }) => void) => void }): void {
  router.get("/api/health/e2e-safety", (_req, res) => {
    if (!isE2EMode()) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(getE2ESafetyStatus());
  });
}
