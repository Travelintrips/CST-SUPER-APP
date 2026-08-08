import { Router } from "express";
import {
  db,
  paymentsTable,
  salesDocumentsTable,
  logisticOrdersTable,
  customersTable,
  paylabsConfigurationsTable,
} from "@workspace/db";
import { eq, desc, sql, or, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import { requireAdmin } from "../lib/requireAdmin.js";
import { requirePortalAdmin } from "../lib/supabaseAuth.js";
import { resolveCompanyScope } from "../lib/resolveCompany.js";
import { normalizePaymentMethod, postPaymentReceived, postSalesInvoice } from "../lib/accounting.js";
import { markSalesInvoiced, recalculatePaymentStatus } from "../lib/services/index.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { sendPaymentProofWaLink } from "../lib/paymentProofService.js";
import { isSafeDevTestMode } from "../lib/safeDev.js";
import { isNewPaidTransition } from "../lib/paymentWebhookConsistency.js";

const router = Router();

// Separate router for the Paylabs webhook — mounted BEFORE the RBAC guard in
// routes/index.ts because the webhook is provider-authenticated via RSA
// signature, not by a user session. Session-level RBAC must not gate it.
export const paymentsWebhookRouter = Router();

// Separate router for Paylabs admin settings — mounted BEFORE the RBAC guard
// in routes/index.ts at /payments/paylabs because Customer Portal admin uses
// portal JWT (requirePortalAdmin), not a BizPortal session. makeRbacGuard blocks
// portal JWT before it reaches requirePortalAdmin inside paymentsRouter.
// Security: every route here uses requirePortalAdmin — no route is public.
export const paylabsPortalRouter = Router();

const PAYLABS_MERCHANT_ID = process.env["PAYLABS_MERCHANT_ID"] ?? "";
const PAYLABS_API_URL =
  process.env["PAYLABS_API_URL"] ?? "https://sit-pay.paylabs.co.id/payment/v2.1/h5/createLink";
const PAYLABS_PUBLIC_KEY = process.env["PAYLABS_PUBLIC_KEY"] ?? "";

/**
 * Normalise a PEM key that was stored with spaces instead of newlines
 * (common when environment variables are set without escaping \n).
 */
function normalizePemKey(raw: string): string {
  if (!raw) return raw;
  // If already has real newlines, return as-is
  if (raw.includes("\n")) return raw;
  // Replace header/footer space separators, then chunk body into 64-char lines
  return raw
    .replace(/-----BEGIN RSA PRIVATE KEY-----\s+/, "-----BEGIN RSA PRIVATE KEY-----\n")
    .replace(/\s+-----END RSA PRIVATE KEY-----/, "\n-----END RSA PRIVATE KEY-----")
    .split("\n")
    .map((line) =>
      line.startsWith("-----")
        ? line
        : (line.replace(/ /g, "").match(/.{1,64}/g) ?? [line]).join("\n"),
    )
    .join("\n");
}

const PAYLABS_PRIVATE_KEY = normalizePemKey(process.env["PAYLABS_PRIVATE_KEY"] ?? "");

// Sandbox-specific env vars (alternative naming for sandbox/SIT environment)
const PAYLABS_MERCHANT_ID_SANDBOX = process.env["PAYLABS_MERCHANT_ID_SANDBOX"] ?? "";
const PAYLABS_PUBLIC_KEY_SANDBOX = process.env["PAYLABS_PUBLIC_KEY_SANDBOX"] ?? "";
const PAYLABS_PRIVATE_KEY_SANDBOX = normalizePemKey(process.env["PAYLABS_PRIVATE_KEY_SANDBOX"] ?? "");

function paylabsConfigured(): boolean {
  return !!PAYLABS_MERCHANT_ID && !!PAYLABS_PRIVATE_KEY;
}

function paylabsWebhookConfigured(): boolean {
  return paylabsConfigured() && !!PAYLABS_PUBLIC_KEY;
}

// Dynamic credential resolution: DB settings take priority; env vars are fallback
async function getActiveCredentials(): Promise<{ merchantId: string; privateKey: string; publicKey: string; sandboxMode: boolean; apiUrl: string }> {
  try {
    const rows = await db.select().from(paylabsConfigurationsTable).limit(1);
    const cfg = rows[0];
    if (cfg) {
      const isSandbox = cfg.sandboxMode;
      const merchantId = isSandbox
        ? (cfg.sandboxMerchantId || PAYLABS_MERCHANT_ID_SANDBOX || PAYLABS_MERCHANT_ID)
        : (cfg.prodMerchantId || PAYLABS_MERCHANT_ID);
      const privateKey = normalizePemKey(isSandbox
        ? (cfg.sandboxPrivateKey || PAYLABS_PRIVATE_KEY_SANDBOX || PAYLABS_PRIVATE_KEY)
        : (cfg.prodPrivateKey || PAYLABS_PRIVATE_KEY));
      const publicKey = isSandbox
        ? (cfg.sandboxPublicKey || PAYLABS_PUBLIC_KEY_SANDBOX || PAYLABS_PUBLIC_KEY)
        : (cfg.prodPublicKey || PAYLABS_PUBLIC_KEY);
      const apiUrl = isSandbox
        ? "https://sit-pay.paylabs.co.id/payment/v2.1/h5/createLink"
        : "https://pay.paylabs.co.id/payment/v2.1/h5/createLink";
      return { merchantId, privateKey, publicKey, sandboxMode: isSandbox, apiUrl };
    }
  } catch { /* fall through */ }
  return { merchantId: PAYLABS_MERCHANT_ID, privateKey: PAYLABS_PRIVATE_KEY, publicKey: PAYLABS_PUBLIC_KEY, sandboxMode: false, apiUrl: process.env["PAYLABS_API_URL"] ?? "https://sit-pay.paylabs.co.id/payment/v2.1/h5/createLink" };
}

function rsaSign(payload: string, privateKey?: string): string {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(payload);
  return sign.sign(privateKey ?? PAYLABS_PRIVATE_KEY, "base64");
}

function rsaVerify(payload: string, signature: string, publicKey?: string): boolean {
  const key = publicKey ?? PAYLABS_PUBLIC_KEY;
  if (!key || !signature) return false;
  try {
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(payload);
    return verify.verify(key, signature, "base64");
  } catch {
    return false;
  }
}

// ── Default Paylabs payment methods ──────────────────────────────────────────
const DEFAULT_PAYLABS_METHODS = [
  { code: "PAYLABS_GATEWAY", label: "Paylabs Payment Gateway", description: "Online Payment (Bank Transfer, Virtual Account, QRIS, E-Money)", iconUrl: "https://appserver.travelincars.com/img/paylab.png", isActive: false, sortOrder: 1 },
  { code: "QRIS", label: "Paylabs - QRIS", description: "Paylabs QRIS", iconUrl: "", isActive: false, sortOrder: 2 },
  { code: "BRI_VA", label: "Paylabs - BRI Virtual Account", description: "Paylabs BRI Virtual Account", iconUrl: "", isActive: false, sortOrder: 3 },
  { code: "BCA_VA", label: "Paylabs - BCA Virtual Account", description: "Paylabs BCA Virtual Account", iconUrl: "", isActive: false, sortOrder: 4 },
  { code: "BNI_VA", label: "Paylabs - BNI VA", description: "Paylabs BNI VA", iconUrl: "", isActive: false, sortOrder: 5 },
  { code: "MANDIRI_VA", label: "Paylabs - Mandiri VA", description: "Paylabs Mandiri VA", iconUrl: "", isActive: false, sortOrder: 6 },
  { code: "PERMATA_VA", label: "Paylabs - Permata VA", description: "Paylabs Permata VA", iconUrl: "", isActive: false, sortOrder: 7 },
  { code: "CIMB_VA", label: "Paylabs - CIMB VA", description: "Paylabs CIMB VA", iconUrl: "", isActive: false, sortOrder: 8 },
  { code: "BTN_VA", label: "Paylabs - BTN VA", description: "Paylabs BTN VA", iconUrl: "", isActive: false, sortOrder: 9 },
  { code: "DANAMON_VA", label: "Paylabs - Danamon VA", description: "Paylabs Danamon VA", iconUrl: "", isActive: false, sortOrder: 10 },
  { code: "OVO", label: "Paylabs - Ovo Balance", description: "Paylabs Ovo Balance", iconUrl: "", isActive: false, sortOrder: 11 },
  { code: "DANA", label: "Paylabs - Dana Balance", description: "Paylabs Dana Balance", iconUrl: "", isActive: false, sortOrder: 12 },
  { code: "SHOPEE_PAY", label: "Paylabs - ShopeePay", description: "Paylabs ShopeePay", iconUrl: "", isActive: false, sortOrder: 13 },
  { code: "LINK_AJA", label: "Paylabs - LinkAja", description: "Paylabs LinkAja", iconUrl: "", isActive: false, sortOrder: 14 },
  { code: "GOPAY", label: "Paylabs - Gopay Balance", description: "Paylabs Gopay Balance", iconUrl: "", isActive: false, sortOrder: 15 },
  { code: "MAYBANK_VA", label: "Paylabs - Maybank VA", description: "Paylabs Maybank Virtual Account", iconUrl: "", isActive: false, sortOrder: 16 },
  { code: "BSI_VA", label: "Paylabs - BSI VA", description: "Paylabs BSI Virtual Account", iconUrl: "", isActive: false, sortOrder: 17 },
  { code: "MUAMALAT_VA", label: "Paylabs - Muamalat Virtual Account", description: "Paylabs Muamalat Virtual Account", iconUrl: "", isActive: false, sortOrder: 18 },
  { code: "SINARMAS_VA", label: "Paylabs - Sinarmas VA", description: "Paylabs Sinarmas Virtual Account", iconUrl: "", isActive: false, sortOrder: 19 },
  { code: "INA_VA", label: "Paylabs - INA VA", description: "Paylabs INA Virtual Account", iconUrl: "", isActive: false, sortOrder: 20 },
] as const;

function buildSignaturePayload(
  method: string,
  endpoint: string,
  bodyJson: string,
  timestamp: string,
): string {
  const bodyHash = crypto.createHash("sha256").update(bodyJson).digest("hex").toLowerCase();
  return `${method}:${endpoint}:${bodyHash}:${timestamp}`;
}

/**
 * Legacy-row fallback: derive company_id for a payment from its parent
 * document (sales_documents / logistic_orders) when the payment row itself
 * predates the company_id column (nullable, Phase 1 backfill).
 * Safe because the parent document is the authoritative owner of the record;
 * "purchase" ref_kind has no company-scoped parent table wired here yet, so
 * it intentionally returns null (documented risk — see release-candidate-rc1.md).
 */
async function deriveLegacyPaymentCompanyId(
  refKind: "sales" | "purchase" | "logistic",
  refId: number,
): Promise<number | null> {
  try {
    if (refKind === "sales") {
      const [doc] = await db
        .select({ companyId: salesDocumentsTable.companyId })
        .from(salesDocumentsTable)
        .where(eq(salesDocumentsTable.id, refId));
      return doc?.companyId ?? null;
    }
    if (refKind === "logistic") {
      const [doc] = await db
        .select({ companyId: logisticOrdersTable.companyId })
        .from(logisticOrdersTable)
        .where(eq(logisticOrdersTable.id, refId));
      return doc?.companyId ?? null;
    }
  } catch {
    /* best-effort — legacy fallback must never break the request */
  }
  return null;
}

function serializePayment(p: typeof paymentsTable.$inferSelect) {
  return {
    ...p,
    amount: Number(p.amount),
    expiredAt: p.expiredAt?.toISOString() ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function getPaymentMethodFromPayload(payload: Record<string, unknown> | null | undefined): string | null {
  return normalizePaymentMethod(
    payload?.paymentMethod
      ?? payload?.payment_method
      ?? payload?.method
      ?? payload?.payMethod
      ?? payload?.paymentType
      ?? payload?.channel,
  );
}

export async function runPaylabsConfigMigration() {
  // Paylabs payments need to retain the selected channel so webhook posting
  // and later reconciliation do not have to infer QRIS from raw provider JSON.
  await db.execute(sql`
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method TEXT
  `).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS paylabs_configurations (
      id SERIAL PRIMARY KEY,
      sandbox_mode BOOLEAN NOT NULL DEFAULT FALSE,
      store_id TEXT,
      sandbox_public_key TEXT,
      sandbox_private_key TEXT,
      sandbox_merchant_id TEXT,
      prod_public_key TEXT,
      prod_private_key TEXT,
      prod_merchant_id TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
}

export async function runPaylabsPaymentMethodsMigration() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS paylabs_payment_methods (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT,
      icon_url TEXT,
      icon_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  for (const m of DEFAULT_PAYLABS_METHODS) {
    await db.execute(sql`
      INSERT INTO paylabs_payment_methods (code, label, description, icon_url, icon_enabled, is_active, sort_order)
      VALUES (${m.code}, ${m.label}, ${m.description}, ${m.iconUrl}, TRUE, ${m.isActive}, ${m.sortOrder})
      ON CONFLICT (code) DO NOTHING
    `).catch(() => {});
  }
}

router.get("/paylabs/payment-methods", requirePortalAdmin, async (req, res) => {
  const result = await db.execute(sql`SELECT code, label, description, icon_url, icon_enabled, is_active, sort_order, updated_at FROM paylabs_payment_methods ORDER BY sort_order ASC`);
  return res.json(result.rows.map((r: any) => ({
    code: r.code,
    label: r.label,
    description: r.description ?? "",
    iconUrl: r.icon_url ?? "",
    iconEnabled: r.icon_enabled ?? true,
    isActive: r.is_active ?? false,
    sortOrder: r.sort_order ?? 0,
    updatedAt: r.updated_at,
  })));
});

router.put("/paylabs/payment-methods/:code", requirePortalAdmin, async (req, res) => {
  const code = String(req.params.code);
  const body = req.body as { label?: string; description?: string; iconUrl?: string; iconEnabled?: boolean; isActive?: boolean; sortOrder?: number };
  await db.execute(sql`
    UPDATE paylabs_payment_methods SET
      label       = COALESCE(${body.label ?? null}, label),
      description = COALESCE(${body.description ?? null}, description),
      icon_url    = ${body.iconUrl ?? null},
      icon_enabled= ${body.iconEnabled ?? true},
      is_active   = ${body.isActive ?? false},
      sort_order  = COALESCE(${body.sortOrder ?? null}, sort_order),
      updated_at  = NOW()
    WHERE code = ${code}
  `);
  return res.json({ ok: true });
});

router.get("/paylabs/config", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const baseUrl = (req.headers["x-forwarded-proto"] ?? "https") + "://" + (req.headers.host ?? "");
  return res.json({
    merchantId: PAYLABS_MERCHANT_ID ? PAYLABS_MERCHANT_ID : null,
    apiUrl: PAYLABS_API_URL,
    hasPrivateKey: !!PAYLABS_PRIVATE_KEY,
    hasPublicKey: !!PAYLABS_PUBLIC_KEY,
    configured: paylabsConfigured(),
    webhookConfigured: paylabsWebhookConfigured(),
    webhookUrl: `${baseUrl}/api/payments/paylabs/webhook`,
    envVars: {
      PAYLABS_MERCHANT_ID: !!PAYLABS_MERCHANT_ID,
      PAYLABS_API_URL: !!PAYLABS_API_URL,
      PAYLABS_PRIVATE_KEY: !!PAYLABS_PRIVATE_KEY,
      PAYLABS_PUBLIC_KEY: !!PAYLABS_PUBLIC_KEY,
    },
  });
});

router.get("/paylabs/settings", requirePortalAdmin, async (req, res) => {
  const rows = await db.select().from(paylabsConfigurationsTable).limit(1);
  const cfg = rows[0] ?? null;
  return res.json({
    sandboxMode: cfg?.sandboxMode ?? false,
    storeId: cfg?.storeId ?? "",
    sandboxPublicKey: cfg?.sandboxPublicKey ? "***SAVED***" : "",
    sandboxPrivateKey: cfg?.sandboxPrivateKey ? "***SAVED***" : "",
    sandboxMerchantId: cfg?.sandboxMerchantId ?? "",
    prodPublicKey: cfg?.prodPublicKey ? "***SAVED***" : "",
    prodPrivateKey: cfg?.prodPrivateKey ? "***SAVED***" : "",
    prodMerchantId: cfg?.prodMerchantId ?? "",
    hasSandboxKeys: !!(cfg?.sandboxPublicKey && cfg?.sandboxPrivateKey && cfg?.sandboxMerchantId),
    hasProdKeys: !!(cfg?.prodPublicKey && cfg?.prodPrivateKey && cfg?.prodMerchantId),
    updatedAt: cfg?.updatedAt?.toISOString() ?? null,
  });
});

router.put("/paylabs/settings", requirePortalAdmin, async (req, res) => {
  const body = req.body as {
    sandboxMode?: boolean;
    storeId?: string;
    sandboxPublicKey?: string;
    sandboxPrivateKey?: string;
    sandboxMerchantId?: string;
    prodPublicKey?: string;
    prodPrivateKey?: string;
    prodMerchantId?: string;
  };

  const existing = await db.select({ id: paylabsConfigurationsTable.id }).from(paylabsConfigurationsTable).limit(1);

  const patch: Record<string, unknown> = {
    sandboxMode: body.sandboxMode ?? false,
    storeId: body.storeId ?? null,
    sandboxMerchantId: body.sandboxMerchantId ?? null,
    prodMerchantId: body.prodMerchantId ?? null,
    updatedAt: new Date(),
  };
  if (body.sandboxPublicKey && body.sandboxPublicKey !== "***SAVED***") patch.sandboxPublicKey = body.sandboxPublicKey;
  if (body.sandboxPrivateKey && body.sandboxPrivateKey !== "***SAVED***") patch.sandboxPrivateKey = body.sandboxPrivateKey;
  if (body.prodPublicKey && body.prodPublicKey !== "***SAVED***") patch.prodPublicKey = body.prodPublicKey;
  if (body.prodPrivateKey && body.prodPrivateKey !== "***SAVED***") patch.prodPrivateKey = body.prodPrivateKey;

  if (existing.length > 0) {
    await db.update(paylabsConfigurationsTable).set(patch).where(eq(paylabsConfigurationsTable.id, existing[0].id));
  } else {
    await db.insert(paylabsConfigurationsTable).values(patch as typeof paylabsConfigurationsTable.$inferInsert);
  }
  return res.json({ ok: true });
});

// ── paylabsPortalRouter ──────────────────────────────────────────────────────
// Mirrors the four Paylabs admin routes above, but on a router that is mounted
// WITHOUT makeRbacGuard so Customer Portal JWT (requirePortalAdmin) can reach
// the handlers. Auth is NOT weakened — every route still requires portal-admin.
// These routes are mounted in routes/index.ts at /payments/paylabs BEFORE the
// RBAC-guarded paymentsRouter, so the same URL (/api/payments/paylabs/…) works.

paylabsPortalRouter.get("/payment-methods", requirePortalAdmin, async (_req, res) => {
  const result = await db.execute(sql`SELECT code, label, description, icon_url, icon_enabled, is_active, sort_order, updated_at FROM paylabs_payment_methods ORDER BY sort_order ASC`);
  return res.json(result.rows.map((r: any) => ({
    code: r.code,
    label: r.label,
    description: r.description ?? "",
    iconUrl: r.icon_url ?? "",
    iconEnabled: r.icon_enabled ?? true,
    isActive: r.is_active ?? false,
    sortOrder: r.sort_order ?? 0,
    updatedAt: r.updated_at,
  })));
});

paylabsPortalRouter.put("/payment-methods/:code", requirePortalAdmin, async (req, res) => {
  const code = String(req.params.code);
  const body = req.body as { label?: string; description?: string; iconUrl?: string; iconEnabled?: boolean; isActive?: boolean; sortOrder?: number };
  await db.execute(sql`
    UPDATE paylabs_payment_methods SET
      label       = COALESCE(${body.label ?? null}, label),
      description = COALESCE(${body.description ?? null}, description),
      icon_url    = ${body.iconUrl ?? null},
      icon_enabled= ${body.iconEnabled ?? true},
      is_active   = ${body.isActive ?? false},
      sort_order  = COALESCE(${body.sortOrder ?? null}, sort_order),
      updated_at  = NOW()
    WHERE code = ${code}
  `);
  return res.json({ ok: true });
});

paylabsPortalRouter.get("/settings", requirePortalAdmin, async (_req, res) => {
  const rows = await db.select().from(paylabsConfigurationsTable).limit(1);
  const cfg = rows[0] ?? null;
  return res.json({
    sandboxMode: cfg?.sandboxMode ?? false,
    storeId: cfg?.storeId ?? "",
    sandboxPublicKey: cfg?.sandboxPublicKey ? "***SAVED***" : "",
    sandboxPrivateKey: cfg?.sandboxPrivateKey ? "***SAVED***" : "",
    sandboxMerchantId: cfg?.sandboxMerchantId ?? "",
    prodPublicKey: cfg?.prodPublicKey ? "***SAVED***" : "",
    prodPrivateKey: cfg?.prodPrivateKey ? "***SAVED***" : "",
    prodMerchantId: cfg?.prodMerchantId ?? "",
    hasSandboxKeys: !!(cfg?.sandboxPublicKey && cfg?.sandboxPrivateKey && cfg?.sandboxMerchantId),
    hasProdKeys: !!(cfg?.prodPublicKey && cfg?.prodPrivateKey && cfg?.prodMerchantId),
    updatedAt: cfg?.updatedAt?.toISOString() ?? null,
  });
});

paylabsPortalRouter.put("/settings", requirePortalAdmin, async (req, res) => {
  const body = req.body as {
    sandboxMode?: boolean;
    storeId?: string;
    sandboxPublicKey?: string;
    sandboxPrivateKey?: string;
    sandboxMerchantId?: string;
    prodPublicKey?: string;
    prodPrivateKey?: string;
    prodMerchantId?: string;
  };
  const existing = await db.select({ id: paylabsConfigurationsTable.id }).from(paylabsConfigurationsTable).limit(1);
  const patch: Record<string, unknown> = {
    sandboxMode: body.sandboxMode ?? false,
    storeId: body.storeId ?? null,
    sandboxMerchantId: body.sandboxMerchantId ?? null,
    prodMerchantId: body.prodMerchantId ?? null,
    updatedAt: new Date(),
  };
  if (body.sandboxPublicKey && body.sandboxPublicKey !== "***SAVED***") patch.sandboxPublicKey = body.sandboxPublicKey;
  if (body.sandboxPrivateKey && body.sandboxPrivateKey !== "***SAVED***") patch.sandboxPrivateKey = body.sandboxPrivateKey;
  if (body.prodPublicKey && body.prodPublicKey !== "***SAVED***") patch.prodPublicKey = body.prodPublicKey;
  if (body.prodPrivateKey && body.prodPrivateKey !== "***SAVED***") patch.prodPrivateKey = body.prodPrivateKey;
  if (existing.length > 0) {
    await db.update(paylabsConfigurationsTable).set(patch).where(eq(paylabsConfigurationsTable.id, existing[0].id));
  } else {
    await db.insert(paylabsConfigurationsTable).values(patch as typeof paylabsConfigurationsTable.$inferInsert);
  }
  return res.json({ ok: true });
});

// ── end paylabsPortalRouter ───────────────────────────────────────────────────

// Company scoping: restricted admins (or non-admin sessions) only see payments
// for their resolved company, PLUS legacy rows with company_id IS NULL that
// predate the Phase 1 backfill. scope === "all" (unrestricted admin / holding
// view) skips the filter entirely. See docs/release-candidate-rc1.md for the
// documented risk of the NULL fallback (legacy rows remain visible cross-company
// until backfilled).
router.get("/", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const scope = resolveCompanyScope(req);
  const rows = scope === "all"
    ? await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt)).limit(200)
    : await db
        .select()
        .from(paymentsTable)
        .where(or(eq(paymentsTable.companyId, scope), isNull(paymentsTable.companyId)))
        .orderBy(desc(paymentsTable.createdAt))
        .limit(200);
  return res.json(rows.map(serializePayment));
});

router.get("/by-doc/:kind/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  const kind = String(req.params.kind) === "sales" ? "sales" : String(req.params.kind) === "purchase" ? "purchase" : null;
  if (!kind || Number.isNaN(id)) return res.status(400).json({ message: "Invalid params" });
  const scope = resolveCompanyScope(req);
  const rows = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.refId, id))
    .orderBy(desc(paymentsTable.createdAt));
  const byKind = rows.filter((p) => p.refKind === kind);
  const scoped = scope === "all"
    ? byKind
    : byKind.filter((p) => p.companyId === scope || p.companyId == null);
  return res.json(scoped.map(serializePayment));
});

router.post("/sales/:id/create-link", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const [doc] = await db.select().from(salesDocumentsTable).where(eq(salesDocumentsTable.id, id));
  if (!doc) return res.status(404).json({ message: "Sales document not found" });
  if (doc.kind !== "order" || doc.status === "cancelled") {
    return res.status(400).json({ message: "Hanya sales order aktif yang bisa dibayar" });
  }

  // Company scoping: block creating a payment link for a sales document owned
  // by a different company than the caller's resolved scope. Documents with
  // company_id IS NULL (legacy) are allowed through (documented risk).
  const scope = resolveCompanyScope(req);
  if (scope !== "all" && doc.companyId != null && doc.companyId !== scope) {
    return res.status(403).json({ message: "Sales document belongs to a different company" });
  }
  const paymentCompanyId = doc.companyId ?? (scope !== "all" ? scope : null);

  // Lookup customer phone number for Paylabs (required field)
  let customerPhone = "081234567890"; // fallback
  if (doc.customerId) {
    const [cust] = await db.select({ phone: customersTable.phone }).from(customersTable).where(eq(customersTable.id, doc.customerId));
    if (cust?.phone) customerPhone = cust.phone.replace(/\D/g, ""); // strip non-digits
  }

  const merchantTradeNo = `BIZ-${doc.id}-${Date.now()}`;
  const amount = Number(doc.grandTotal ?? doc.totalAmount);
  const requestedPaymentMethod = normalizePaymentMethod(
    (req.body as { paymentMethod?: string; payment_method?: string; method?: string } | undefined)
      ?.paymentMethod
      ?? (req.body as { payment_method?: string } | undefined)?.payment_method
      ?? (req.body as { method?: string } | undefined)?.method,
  );

  if (!paylabsConfigured()) {
    // TODO Phase 3E: add createOrderLink(sales_documents → payments) here after simulation insert
    // Blocked: simulation path is dev-only; defer to Phase 3E with the production path.
    // File: artifacts/api-server/src/routes/payments.ts, simulation sales payment creation.
    const [created] = await db
      .insert(paymentsTable)
      .values({
        companyId: paymentCompanyId,
        refKind: "sales",
        refId: doc.id,
        refDocNumber: doc.docNumber,
        amount: String(amount),
        status: "pending",
        provider: "paylabs",
        paymentMethod: requestedPaymentMethod,
        providerMerchantTradeNo: merchantTradeNo,
        paymentUrl: null,
        raw: { simulation: true, reason: "PAYLABS credentials not configured" },
        expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning();
    return res.status(202).json({
      configured: false,
      message:
        "Paylabs belum terkonfigurasi. Tautan pembayaran simulasi dibuat. Set PAYLABS_MERCHANT_ID, PAYLABS_PRIVATE_KEY, PAYLABS_PUBLIC_KEY untuk produksi.",
      payment: serializePayment(created),
    });
  }

  const requestId = `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`;
  const timestamp = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "+07:00");
  const baseUrl = (req.headers["x-forwarded-proto"] ?? "https") + "://" + (req.headers.host ?? "");
  const notifyUrl = `${baseUrl}/api/payments/paylabs/webhook`;
  const redirectUrl = `${baseUrl}/sales/orders/${doc.id}`;

  const body = {
    merchantId: PAYLABS_MERCHANT_ID,
    merchantTradeNo,
    requestId,
    amount: amount.toFixed(2),
    productName: `Pembayaran ${doc.docNumber}`,
    payer: doc.customerName ?? "Customer",
    phoneNumber: customerPhone,
    notifyUrl,
    redirectUrl,
  };
  const bodyJson = JSON.stringify(body);
  const signaturePayload = buildSignaturePayload("POST", new URL(PAYLABS_API_URL).pathname, bodyJson, timestamp);
  let signature: string;
  try {
    signature = rsaSign(signaturePayload);
  } catch (err: any) {
    return res.status(500).json({ message: "Paylabs signing failed", error: err?.message });
  }

  // E2E / SAFE_DEV guard: block real Paylabs outbound call in test modes
  if (isSafeDevTestMode() || process.env.E2E_TEST_MODE === "true") {
    return res.json({
      message: "Paylabs payment link simulated (E2E/SAFE_DEV mode)",
      paymentUrl: `http://localhost/__e2e-mocked-payment/${requestId}`,
      requestId,
      simulated: true,
    });
  }

  let paylabsResp: any = null;
  try {
    const r = await fetch(PAYLABS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        "X-PARTNER-ID": PAYLABS_MERCHANT_ID,
        "X-REQUEST-ID": requestId,
      },
      body: bodyJson,
    });
    paylabsResp = await r.json().catch(() => ({}));
    if (!r.ok || paylabsResp?.errCode !== "0") {
      return res.status(502).json({
        message: "Paylabs error",
        status: r.status,
        response: paylabsResp,
      });
    }
  } catch (err: any) {
    return res.status(502).json({ message: "Paylabs request failed", error: err?.message });
  }

  const [created] = await db
    .insert(paymentsTable)
    .values({
      companyId: paymentCompanyId,
      refKind: "sales",
      refId: doc.id,
      refDocNumber: doc.docNumber,
      amount: String(amount),
      status: "pending",
      provider: "paylabs",
      paymentMethod: requestedPaymentMethod,
      providerOrderId: paylabsResp?.platformTradeNo ?? null,
      providerMerchantTradeNo: merchantTradeNo,
      paymentUrl: paylabsResp?.url ?? paylabsResp?.h5Url ?? null,
      raw: paylabsResp,
      expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();

  // Phase 3D: order_links — sales_document → payment (fire-and-forget, non-fatal)
  if (created?.id) {
    void import("../lib/services/orderLinkService.js").then(({ createOrderLink }) =>
      createOrderLink({
        sourceTable: "sales_documents",
        sourceId: doc.id,
        targetTable: "payments",
        targetId: created.id,
        linkType: "sales_document_to_payment",
        createdBy: "payments:paylabs_create",
      })
    ).catch(() => {});
  }

  return res.status(201).json({ configured: true, payment: serializePayment(created) });
});

paymentsWebhookRouter.post("/paylabs/webhook", async (req, res) => {
  if (!paylabsWebhookConfigured()) {
    return res.status(503).json({
      errCode: "503",
      errMsg: "Paylabs webhook not configured. Set PAYLABS_MERCHANT_ID, PAYLABS_PRIVATE_KEY, and PAYLABS_PUBLIC_KEY.",
    });
  }
  const signature = (req.headers["x-signature"] as string) ?? "";
  const timestamp = (req.headers["x-timestamp"] as string) ?? "";
  const bodyJson = JSON.stringify(req.body ?? {});
  const payload = buildSignaturePayload("POST", "/api/payments/paylabs/webhook", bodyJson, timestamp);
  if (!rsaVerify(payload, signature)) {
    return res.status(401).json({ errCode: "401", errMsg: "Invalid signature" });
  }
  const merchantTradeNo = req.body?.merchantTradeNo as string | undefined;
  if (!merchantTradeNo) return res.status(400).json({ errCode: "400", errMsg: "Missing merchantTradeNo" });
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.providerMerchantTradeNo, merchantTradeNo));
  if (!payment) return res.status(404).json({ errCode: "404", errMsg: "Payment not found" });

  // Provider payloads differ by channel. Prefer the explicit channel fields,
  // but never overwrite a method already selected when the callback omits it.
  const webhookPaymentMethod = getPaymentMethodFromPayload(req.body as Record<string, unknown>);

  const status: string = req.body?.status ?? "";
  let newStatus: "pending" | "paid" | "expired" | "cancelled" | "failed" = payment.status;
  let paidAt: Date | null = payment.paidAt;
  if (status === "02" || status === "SUCCESS" || status === "PAID") {
    newStatus = "paid";
    paidAt = new Date();
  } else if (status === "03" || status === "EXPIRED") newStatus = "expired";
  else if (status === "04" || status === "CANCELLED") newStatus = "cancelled";
  else if (status === "05" || status === "FAILED") newStatus = "failed";

  // Webhook is provider-authenticated (RSA signature), not session-scoped —
  // no company authorization check applies here. Opportunistically backfill
  // company_id on legacy rows (company_id IS NULL) from the parent document
  // so later admin reads/writes on this payment are correctly scoped.
  const webhookDerivedCompanyId = payment.companyId == null
    ? await deriveLegacyPaymentCompanyId(payment.refKind, payment.refId)
    : null;

  await db
    .update(paymentsTable)
    .set({
      status: newStatus,
      paidAt,
      raw: req.body,
      updatedAt: new Date(),
      ...(webhookPaymentMethod ? { paymentMethod: webhookPaymentMethod } : {}),
      ...(webhookDerivedCompanyId != null ? { companyId: webhookDerivedCompanyId } : {}),
    })
    .where(eq(paymentsTable.id, payment.id));

  if (isNewPaidTransition(payment.status, newStatus)) {
    if (payment.refKind === "sales") {
      const [salesDoc] = await db.select().from(salesDocumentsTable).where(eq(salesDocumentsTable.id, payment.refId));
      const invoiceResult = await markSalesInvoiced(payment.refId, "paylabs");
      if (invoiceResult.ok && !invoiceResult.alreadySet && salesDoc) {
        const invoicePosted = await postSalesInvoice({
          salesDocId: salesDoc.id,
          docNumber: salesDoc.docNumber,
          customerName: salesDoc.customerName,
          netAmount: Number(salesDoc.totalAmount),
          taxAmount: Number(salesDoc.taxAmount ?? 0),
          taxAccountId: null,
          companyId: webhookDerivedCompanyId ?? payment.companyId,
        });
        if (!invoicePosted) {
          console.warn(`[payments] sales invoice posting pending recovery for payment #${payment.id}`);
        }
      }
      void recalculatePaymentStatus(payment.refId, "sales_order").catch(
        (e: unknown) => console.warn("[payments] recalculatePaymentStatus failed (paylabs webhook)", e)
      );
      if (salesDoc?.logisticOrderId && Number(salesDoc.grandTotal) > 0 && Number(payment.amount) >= Number(salesDoc.grandTotal)) {
        void transitionLogisticOrderStatus(salesDoc.logisticOrderId, "Payment Received", {
          source: "paylabs:webhook",
          actorType: "system",
          notes: `Pembayaran lunas via Paylabs (merchantTradeNo: ${merchantTradeNo})`,
        }).catch((e: unknown) => console.warn("auto Payment Received transition failed (Paylabs webhook)", e));
      }
      if (salesDoc) {
        void sendPaymentProofWaLink(salesDoc.id).catch(
          (e: unknown) => console.warn("[payments] sendPaymentProofWaLink failed (paylabs webhook)", e)
        );
      }
    } else if (payment.refKind === "logistic") {
      // Logistic order direct payment — transition to "Payment Received"
      void transitionLogisticOrderStatus(payment.refId, "Payment Received", {
        source: "paylabs:webhook",
        actorType: "system",
        notes: `Pembayaran lunas via Paylabs (merchantTradeNo: ${merchantTradeNo})`,
      }).catch((e: unknown) => console.warn("auto Payment Received transition failed (Paylabs webhook/logistic)", e));
    }
    const paymentPosted = await postPaymentReceived({
      paymentId: payment.id,
      refKind: payment.refKind,
      refDocNumber: payment.refDocNumber,
      amount: Number(payment.amount),
      paymentMethod: webhookPaymentMethod ?? payment.paymentMethod,
      companyId: webhookDerivedCompanyId ?? payment.companyId,
    });
    if (!paymentPosted) {
      console.warn(`[payments] payment journal posting pending recovery for payment #${payment.id}`);
    }
  }

  return res.json({ errCode: "0", errMsg: "OK" });
});

router.post("/:id/simulate-paid", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
  if (!payment) return res.status(404).json({ message: "Payment not found" });

  // Company scoping: for legacy rows (company_id IS NULL) derive from the
  // parent document so we can both authorize correctly and backfill the
  // column on write. Documented risk: if the parent doc is also missing
  // company_id, the row stays unscoped and is treated as accessible (legacy
  // fallback) rather than blocking a legitimate admin operation.
  const scope = resolveCompanyScope(req);
  const derivedCompanyId = payment.companyId ?? (await deriveLegacyPaymentCompanyId(payment.refKind, payment.refId));
  if (scope !== "all" && derivedCompanyId != null && derivedCompanyId !== scope) {
    return res.status(403).json({ message: "Payment belongs to a different company" });
  }

  await db
    .update(paymentsTable)
    .set({
      status: "paid",
      paidAt: new Date(),
      updatedAt: new Date(),
      ...(payment.companyId == null && derivedCompanyId != null ? { companyId: derivedCompanyId } : {}),
    })
    .where(eq(paymentsTable.id, id));
  if (payment.status !== "paid") {
    if (payment.refKind === "sales") {
      const [salesDoc2] = await db.select().from(salesDocumentsTable).where(eq(salesDocumentsTable.id, payment.refId));
      const invoiceResult2 = await markSalesInvoiced(payment.refId, "paylabs");
      if (invoiceResult2.ok && !invoiceResult2.alreadySet && salesDoc2) {
        const invoicePosted = await postSalesInvoice({
          salesDocId: salesDoc2.id,
          docNumber: salesDoc2.docNumber,
          customerName: salesDoc2.customerName,
          netAmount: Number(salesDoc2.totalAmount),
          taxAmount: Number(salesDoc2.taxAmount ?? 0),
          taxAccountId: null,
          companyId: derivedCompanyId,
        });
        if (!invoicePosted) {
          console.warn(`[payments] sales invoice posting pending recovery for payment #${payment.id}`);
        }
      }
      void recalculatePaymentStatus(payment.refId, "sales_order").catch(
        (e: unknown) => console.warn("[payments] recalculatePaymentStatus failed (simulate-paid)", e)
      );
      if (salesDoc2?.logisticOrderId && Number(salesDoc2.grandTotal) > 0 && Number(payment.amount) >= Number(salesDoc2.grandTotal)) {
        void transitionLogisticOrderStatus(salesDoc2.logisticOrderId, "Payment Received", {
          source: "paylabs:simulate-paid",
          actorType: "admin",
          notes: `Simulasi pembayaran lunas via Paylabs (payment #${payment.id})`,
        }).catch((e: unknown) => console.warn("auto Payment Received transition failed (simulate-paid)", e));
      }
      if (salesDoc2) {
        void sendPaymentProofWaLink(salesDoc2.id).catch(
          (e: unknown) => console.warn("[payments] sendPaymentProofWaLink failed (simulate-paid)", e)
        );
      }
    } else if (payment.refKind === "logistic") {
      void transitionLogisticOrderStatus(payment.refId, "Payment Received", {
        source: "paylabs:simulate-paid",
        actorType: "admin",
        notes: `Simulasi pembayaran lunas via Paylabs (payment #${payment.id})`,
      }).catch((e: unknown) => console.warn("auto Payment Received transition failed (simulate-paid/logistic)", e));
    }
  }
  if (payment.status !== "paid") {
    const paymentPosted = await postPaymentReceived({
      paymentId: payment.id,
      refKind: payment.refKind,
      refDocNumber: payment.refDocNumber,
      amount: Number(payment.amount),
      paymentMethod: payment.paymentMethod,
      companyId: derivedCompanyId,
    });
    if (!paymentPosted) {
      console.warn(`[payments] payment journal posting pending recovery for payment #${payment.id}`);
    }
  }
  const [updated] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id));
  return res.json(serializePayment(updated));
});

export default router;
