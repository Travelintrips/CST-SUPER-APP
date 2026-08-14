import pg from "pg";

const { Pool } = pg;
const API = "http://127.0.0.1:18444/api/portal";
const startedAt = new Date();
const marker = `E2E Vendor ${Date.now()}`;
const email = `e2e-vendor-${Date.now()}@example.test`;
const phone = `62811${String(Date.now()).slice(-8)}`;
const productName = `${marker} Product`;
const password = "E2E-Vendor-Pass-2026!";

type Json = Record<string, any> | any[];
type Jar = Map<string, string>;
type ResponseData = { status: number; body: any; headers: Headers };

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV || process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 20_000,
});

let invitationId: number | null = null;
let invitationToken: string | null = null;
let supplierId: number | null = null;
let portalCustomerId: number | null = null;
let catalogItemId: number | null = null;
let vendorJar: Jar | null = null;
let adminJar: Jar | null = null;
const steps: Array<{ name: string; pass: boolean; detail?: string }> = [];

function record(name: string, pass: boolean, detail?: string) {
  steps.push({ name, pass, ...(detail ? { detail } : {}) });
  if (!pass) throw new Error(`${name}: ${detail || "failed"}`);
}

function extractCookies(headers: Headers, jar: Jar) {
  const getSetCookie = (headers as any).getSetCookie;
  const values: string[] = typeof getSetCookie === "function"
    ? getSetCookie.call(headers)
    : ((headers.get("set-cookie") || "").match(/(?:^|,\s*)([^=;,]+=[^;]*)/g) || [])
        .map((v: string) => v.replace(/^,\s*/, ""));
  for (const value of values) {
    const pair = value.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}

function cookieHeader(jar: Jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function request(
  path: string,
  opts: { method?: string; body?: unknown; jar?: Jar; form?: FormData } = {},
): Promise<ResponseData> {
  const headers: Record<string, string> = {};
  if (opts.jar && opts.jar.size) headers.cookie = cookieHeader(opts.jar);
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API}${path}`, { method: opts.method || "GET", headers, body });
  if (opts.jar) extractCookies(res.headers, opts.jar);
  const text = await res.text();
  let parsed: any = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: res.status, body: parsed, headers: res.headers };
}

function bodyMessage(body: any): string {
  if (body && typeof body === "object") {
    for (const key of ["message", "error", "detail"]) {
      if (typeof body[key] === "string") return body[key].slice(0, 180);
    }
  }
  return `HTTP response ${typeof body === "string" ? body.slice(0, 100) : ""}`.trim();
}

function containsItem(value: any, id: number, name: string): boolean {
  if (Array.isArray(value)) return value.some((v) => containsItem(v, id, name));
  if (!value || typeof value !== "object") return false;
  if (Number(value.id) === id && (value.name === name || value.product_name === name || value.title === name)) return true;
  return Object.values(value).some((v) => containsItem(v, id, name));
}

async function query<T = any>(text: string, values: any[] = []): Promise<T[]> {
  const result = await pool.query(text, values);
  return result.rows as T[];
}

async function dbOne<T = any>(text: string, values: any[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] || null;
}

async function publicMarketplaceHasItem(): Promise<boolean> {
  const response = await request("/marketplace");
  if (response.status !== 200) throw new Error(`marketplace returned ${response.status}`);
  return containsItem(response.body, catalogItemId, productName);
}

async function cleanup() {
  const cleanupErrors: string[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (catalogItemId) {
      await client.query("DELETE FROM vendor_catalog_items WHERE id = $1", [catalogItemId]);
    }
    if (portalCustomerId) {
      await client.query("DELETE FROM vendor_notifications WHERE vendor_id = $1", [portalCustomerId]).catch(() => {});
      await client.query("DELETE FROM user_profiles WHERE customer_id = $1", [portalCustomerId]).catch(() => {});
      await client.query("DELETE FROM vendor_profiles WHERE customer_id = $1", [portalCustomerId]).catch(() => {});
      await client.query("DELETE FROM onboarding_approvals WHERE customer_id = $1", [portalCustomerId]).catch(() => {});
      await client.query("DELETE FROM portal_customer_services WHERE customer_id = $1", [portalCustomerId]).catch(() => {});
      await client.query("DELETE FROM portal_customers WHERE id = $1", [portalCustomerId]);
    }
    if (supplierId) {
      await client.query("DELETE FROM suppliers WHERE id = $1", [supplierId]);
    }
    if (invitationId) {
      await client.query("DELETE FROM portal_vendor_invitations WHERE id = $1", [invitationId]);
    }
    await client.query(
      "DELETE FROM notification_logs WHERE channel = 'email' AND recipient = $1 AND created_at >= $2",
      [email, startedAt],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    cleanupErrors.push(error instanceof Error ? error.message : String(error));
  } finally {
    client.release();
  }

  const leftovers = await query<{ table_name: string; count: string }>(
    `SELECT 'invitation' AS table_name, count(*)::text AS count FROM portal_vendor_invitations WHERE vendor_name = $1
     UNION ALL SELECT 'supplier', count(*)::text FROM suppliers WHERE name = $2
     UNION ALL SELECT 'catalog', count(*)::text FROM vendor_catalog_items WHERE name = $3
     UNION ALL SELECT 'customer', count(*)::text FROM portal_customers WHERE email = $4
     UNION ALL SELECT 'notifications', count(*)::text FROM notification_logs WHERE recipient = $4 AND created_at >= $5`,
    [marker, marker, productName, email, startedAt],
  ).catch((error) => {
    cleanupErrors.push(error instanceof Error ? error.message : String(error));
    return [];
  });
  const remaining = leftovers.filter((row) => Number(row.count) > 0);
  record("fixture cleanup", cleanupErrors.length === 0 && remaining.length === 0,
    cleanupErrors.length ? cleanupErrors.join("; ") : remaining.map((row) => `${row.table_name}=${row.count}`).join(", "));
}

async function run() {
  await dbOne("SELECT 1");
  record("database connection", true);

  const safety = await fetch("http://127.0.0.1:18444/api/health/e2e-safety").then(async (res) => ({
    status: res.status,
    body: await res.json(),
  }));
  record("development safe mode", safety.status === 200 && safety.body.e2eMode === true &&
    safety.body.whatsapp === "mocked" &&
    safety.body.email === "mocked" &&
    safety.body.payment === "mocked" &&
    safety.body.webhooks === "disabled" &&
    safety.body.workers === "disabled" &&
    safety.body.storage === "test-only", bodyMessage(safety.body));

  const readiness = await fetch("http://127.0.0.1:18444/api/health/ready").then(async (res) => ({
    status: res.status,
    body: await res.json(),
  }));
  record("development readiness", readiness.status === 200 && readiness.body.ready === true, bodyMessage(readiness.body));

  const adminLogin = await request("/auth/dev-login", { method: "POST", body: { role: "admin" }, jar: new Map() });
  adminJar = new Map();
  extractCookies(adminLogin.headers, adminJar);
  if (adminLogin.status !== 200) throw new Error(`admin dev login: ${adminLogin.status}`);
  record("admin authentication", adminJar.size > 0 || Boolean(adminLogin.body?.token), "session established");

  const invitation = await request("/admin/vendor-invitations", {
    method: "POST",
    jar: adminJar,
    body: {
      vendor_name: marker,
      phone,
      email,
      service_type: "marketplace",
      notes: "controlled development lifecycle fixture",
      send_wa: false,
    },
  });
  record("invitation creation", invitation.status === 201 && typeof invitation.body?.token === "string", bodyMessage(invitation.body));
  invitationToken = invitation.body.token;
  const invitationRow = await dbOne<{ id: number; status: string; documents: any }>(
    "SELECT id, status, documents FROM portal_vendor_invitations WHERE token = $1",
    [invitationToken],
  );
  if (!invitationRow) throw new Error("invitation lookup failed");
  invitationId = invitationRow.id;

  await query(
    `UPDATE portal_vendor_invitations SET documents = $2::jsonb WHERE id = $1`,
    [invitationId, JSON.stringify([
      { docType: "npwp", fileName: `${marker}-npwp.pdf`, url: null },
      { docType: "siup_nib", fileName: `${marker}-nib.pdf`, url: null },
      { docType: "ktp_pic", fileName: `${marker}-ktp.pdf`, url: null },
    ])],
  );

  const accept = await request(`/vendor-invite/${invitationToken}/accept`, {
    method: "POST",
    body: {
      contact_name: "E2E Contact",
      email,
      phone,
      company_name: marker,
      message: "controlled lifecycle registration",
      products: [{
        name: productName,
        description: "Development-only catalog fixture",
         category: "Bahan Baku & Industri",
        mediaUrls: [],
      }],
    },
  });
  record("vendor registration", accept.status === 200 || accept.status === 201, bodyMessage(accept.body));

  const afterAccept = await dbOne<{ status: string; supplier_id: number | null }>(
    "SELECT status, supplier_id FROM portal_vendor_invitations WHERE id = $1",
    [invitationId],
  );
  supplierId = Number(afterAccept?.supplier_id || 0) || null;

  const approve = await request(`/admin/vendor-invitations/${invitationId}/approve`, {
    method: "POST",
    jar: adminJar,
    body: { note: "controlled development approval" },
  });
  record("vendor approval", approve.status === 200 && approve.body?.ok === true, bodyMessage(approve.body));
  portalCustomerId = Number(approve.body?.portal_customer_id || 0) || null;

  const state = await dbOne<any>(
    `SELECT i.status AS invitation_status, s.status AS supplier_status, s.is_verified,
            s.marketplace_status, s.id AS supplier_id,
            vp.customer_id AS vendor_profile_customer_id,
            up.status AS user_profile_status,
            ci.id AS catalog_item_id, ci.status AS catalog_status,
            ci.is_published, ci.is_active
       FROM portal_vendor_invitations i
       JOIN suppliers s ON s.id = i.supplier_id
       JOIN vendor_profiles vp ON vp.supplier_id = s.id
       JOIN user_profiles up ON up.customer_id = vp.customer_id
       LEFT JOIN vendor_catalog_items ci ON ci.vendor_id = s.id AND ci.name = $2
      WHERE i.id = $1`,
    [invitationId, productName],
  );
  catalogItemId = Number(state?.catalog_item_id || 0) || null;
  supplierId = Number(state?.supplier_id || supplierId || 0) || null;
  portalCustomerId = Number(state?.vendor_profile_customer_id || portalCustomerId || 0) || null;
  record("supplier mapping", Boolean(supplierId && portalCustomerId && Number(state?.supplier_id) === supplierId &&
    Number(state?.vendor_profile_customer_id) === portalCustomerId), "approval linked vendor profile to supplier");
  record("vendor user created", Boolean(portalCustomerId && state?.user_profile_status === "active"), "active vendor user exists");
  record("vendor profile", Boolean(portalCustomerId && Number(state?.vendor_profile_customer_id) === portalCustomerId), "vendor profile is linked to supplier");
  record("approved vendor state", (state?.invitation_status === "approved" || state?.invitation_status === "accepted") &&
    ["active", "approved"].includes(String(state?.supplier_status)) &&
    state?.is_verified === true &&
    ["published"].includes(String(state?.marketplace_status)) &&
    state?.user_profile_status === "active" &&
    Boolean(catalogItemId), "supplier active/verified, marketplace published, product present");

  const firstSupplierId = supplierId;
  const retry = await request(`/admin/vendor-invitations/${invitationId}/approve`, {
    method: "POST",
    jar: adminJar,
    body: { note: "idempotent retry proof" },
  });
  record("approval retry idempotency", retry.status === 200 && Number(retry.body?.supplier_id) === firstSupplierId,
    bodyMessage(retry.body));
  const duplicateCount = await dbOne<{ count: string }>(
    "SELECT count(*)::text AS count FROM vendor_catalog_items WHERE vendor_id = $1 AND name = $2",
    [supplierId, productName],
  );
  record("approval retry no duplicate catalog", Number(duplicateCount?.count) === 1, `count=${duplicateCount?.count}`);

  const visibleBefore = await publicMarketplaceHasItem();
  record("marketplace product visibility", visibleBefore, "published vendor and product are public");

  await query("UPDATE suppliers SET is_verified = false WHERE id = $1", [supplierId]);
  record("negative guard unverified supplier", !(await publicMarketplaceHasItem()), "hidden while supplier is unverified");
  await query("UPDATE suppliers SET is_verified = true WHERE id = $1", [supplierId]);

  await query("UPDATE suppliers SET marketplace_status = 'draft' WHERE id = $1", [supplierId]);
  record("negative guard unpublished vendor", !(await publicMarketplaceHasItem()), "hidden while vendor marketplace status is draft");
  await query("UPDATE suppliers SET marketplace_status = 'published' WHERE id = $1", [supplierId]);

  await query("UPDATE vendor_catalog_items SET status = 'draft', is_published = false WHERE id = $1", [catalogItemId]);
  record("negative guard draft product", !(await publicMarketplaceHasItem()), "hidden while product is draft/unpublished");
  await query("UPDATE vendor_catalog_items SET status = 'published', is_published = true WHERE id = $1", [catalogItemId]);
  record("marketplace guard restore", await publicMarketplaceHasItem(), "fixture restored to published state");

  const emptyPasswordLogin = await request("/auth/login", {
    method: "POST",
    body: { email, password: "wrong-before-setup" },
  });
  record("empty credential rejected", [400, 401, 403].includes(emptyPasswordLogin.status), `status=${emptyPasswordLogin.status}`);

  const resetNotification = await dbOne<{ message: string }>(
    `SELECT message FROM notification_logs
      WHERE channel = 'email' AND recipient = $1 AND context = 'forgot-password' AND created_at >= $2
      ORDER BY id DESC LIMIT 1`,
    [email, startedAt],
  );
  const tokenMatch = resetNotification?.message.match(/reset-password\?token=([^&\s]+)&email=/);
  record("canonical credential setup artifact", Boolean(tokenMatch), "safe-mode reset message captured without outbound delivery");
  const resetToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : "";
  const reset = await request("/auth/reset-password-with-token", {
    method: "POST",
    body: { email, token: resetToken, password },
  });
  record("canonical credential setup", reset.status === 200 && reset.body?.ok === true, bodyMessage(reset.body));

  vendorJar = new Map();
  const vendorLogin = await request("/auth/login", {
    method: "POST",
    body: { email, password },
    jar: vendorJar,
  });
  record("vendor login", vendorLogin.status === 200 && vendorJar.size > 0, "email/password login established session");

  const profile = await request("/vendor/profile", { jar: vendorJar });
  record("vendor profile access", profile.status === 200 && Number(profile.body?.supplier?.id || profile.body?.supplier_id || profile.body?.supplierId) === supplierId,
    bodyMessage(profile.body));
  const me = await request("/auth/me", { jar: vendorJar });
  record("session persistence", me.status === 200 && me.body?.email === email, bodyMessage(me.body));

  const ownCatalog = await request("/vendor/catalog", { jar: vendorJar });
  record("vendor dashboard catalog access", ownCatalog.status === 200 && containsItem(ownCatalog.body, catalogItemId, productName),
    bodyMessage(ownCatalog.body));

  const otherItem = await dbOne<{ id: number }>(
    "SELECT id FROM vendor_catalog_items WHERE vendor_id <> $1 AND id <> $2 ORDER BY id LIMIT 1",
    [supplierId, catalogItemId],
  );
  record("supplier isolation fixture", Boolean(otherItem), "another supplier catalog item available");
  const crossForm = new FormData();
  crossForm.append("file", new Blob(["e2e isolation"], { type: "image/png" }), "isolation.png");
  const crossSupplierAttempt = await request(`/vendor/catalog/${otherItem?.id}/media/upload`, {
    method: "POST",
    jar: vendorJar,
    form: crossForm,
  });
  record("supplier isolation", [403, 404].includes(crossSupplierAttempt.status), `status=${crossSupplierAttempt.status}`);

  const logout = await request("/auth/logout", { method: "POST", jar: vendorJar });
  record("vendor logout", logout.status === 200 || logout.status === 204, `status=${logout.status}`);
  const afterLogout = await request("/vendor/profile", { jar: vendorJar });
  record("logout invalidates session", afterLogout.status === 401, `status=${afterLogout.status}`);
}

let runError: unknown = null;
try {
  await run();
} catch (error) {
  runError = error;
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    completed: steps.filter((step) => step.pass).map((step) => step.name),
  }));
} finally {
  try {
    await cleanup();
  } catch (error) {
    console.error("cleanup failure:", error instanceof Error ? error.message : String(error));
  }
  await pool.end();
}

if (!runError) {
  console.log(JSON.stringify({ ok: true, steps }));
}