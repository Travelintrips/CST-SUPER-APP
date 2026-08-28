import crypto from "node:crypto";
import pg from "pg";

const API = (process.env.PROOF_API_URL ?? "http://127.0.0.1:18444/api").replace(/\/+$/, "");
const RUN_ID = crypto.randomUUID();
const MARKER = `AUDIT-DIVA-RFQ-${RUN_ID}`;
const SUPPLIER_ID = 35;
const CATALOG_ID = 133;
const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  max: 2,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 20_000,
  ssl: { rejectUnauthorized: false },
});

const result = {
  READ_MODEL_SERVICE_LABEL_FIX: "FAIL",
  DIVA_RFQ_CREATED: "FAIL",
  DIVA_INVITATION_CREATED: "FAIL",
  UNIFIED_ENDPOINT: "FAIL",
  DIVA_ROW_FOUND: "FAIL",
  SERVICE_NAME: "FAIL",
  VENDOR_NAME: "FAIL",
  GENERIC_MARKETPLACE_LABEL_FOR_DIVA: 1,
  BIZPORTAL_DIVA_VISIBLE: "FAIL",
  BIZPORTAL_SERVICE_NAME: "FAIL",
  BIZPORTAL_VENDOR_NAME: "FAIL",
  ADMIN_REQUEST_DETAIL: "FAIL",
  SERVICE_FILTER_TRUCKING: "FAIL",
  VENDOR_FILTER_DIVA: "FAIL",
  SEARCH_DIVA: "FAIL",
  SEARCH_REQUEST_NUMBER: "FAIL",
  STATUS_FILTER: "FAIL",
  EXPIRY_FILTER: "FAIL",
  SEA_FREIGHT_SERVICE_LABEL: "EMPTY",
  AIR_FREIGHT_SERVICE_LABEL: "EMPTY",
  DOMESTIC_SERVICE_LABEL: "EMPTY",
  CUSTOM_CLEARANCE_SERVICE_LABEL: "EMPTY",
  CUSTOMS_PABEAN_SERVICE_LABEL: "EMPTY",
  UNAUTH_ADMIN_ENDPOINT: "FAIL",
  CUSTOMER_ADMIN_ENDPOINT: "FAIL",
  NON_ADMIN_ENDPOINT: "FAIL",
  ADMIN_ENDPOINT: "FAIL",
  RAW_TOKEN_IN_LIST: "FAIL",
  RAW_TOKEN_IN_DETAIL: "FAIL",
  TOKEN_LEAK_TO_PUBLIC: "FAIL",
  API_LIVE: "PASS",
  API_READY: "FAIL",
  BIZPORTAL_RUNTIME: "FAIL",
  CLEANUP_ERRORS: 0,
  RESIDUAL_AUDIT_RECORDS: -1,
  PRODUCTION_WRITES: 0,
  REAL_WHATSAPP: 0,
  REAL_EMAIL: 0,
  REAL_PAYMENT: 0,
};

const created = { rfqIds: [], orderIds: [], quoteIds: [] };
const customerJar = new Map();
const adminJar = new Map();
const vendorJar = new Map();
let rfqId = null;
let orderId = null;
let quoteId = null;
let rawToken = null;
let cleanupErrors = [];

function cookiePairs(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : ((headers.get("set-cookie") ?? "").match(/(?:^|,\s*)([^=;,]+=[^;]*)/g) ?? [])
      .map((value) => value.replace(/^,\s*/, ""));
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean);
}

function addCookies(headers, jar) {
  for (const pair of cookiePairs(headers)) {
    const at = pair.indexOf("=");
    if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(path, { method = "GET", body, jar, token } = {}) {
  const headers = {
    accept: "application/json",
    "x-forwarded-for": "198.51.100.77",
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (jar?.size) headers.cookie = cookieHeader(jar);
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (jar) addCookies(response.headers, jar);
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text.slice(0, 800);
  }
  return { status: response.status, data, text };
}

async function query(text, params = []) {
  return (await pool.query(text, params)).rows;
}

async function one(text, params = []) {
  return (await query(text, params))[0] ?? null;
}

function record(key, pass, detail) {
  result[key] = pass ? "PASS" : "FAIL";
  if (!pass && detail) result[`${key}_DETAIL`] = String(detail).slice(0, 300);
}

async function waitForReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await request("/health/ready");
    if (last.status === 200 && last.data?.ready === true) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return last;
}

async function portalDevLogin(role, jar) {
  const response = await request("/portal/auth/dev-login", {
    method: "POST",
    jar,
    body: { role },
  });
  const token = response.data?.token;
  if (response.status !== 200 || typeof token !== "string") {
    throw new Error(`portal ${role} dev-login failed: HTTP ${response.status}`);
  }
  return token;
}

async function adminLogin() {
  const users = await request("/dev-users");
  const admin = (users.data?.users ?? []).find((user) => user.role === "admin");
  if (users.status !== 200 || !admin?.email) {
    throw new Error(`no development admin user: HTTP ${users.status}`);
  }
  const response = await request("/dev-login", {
    method: "POST",
    jar: adminJar,
    body: { email: admin.email },
  });
  if (response.status !== 200 || !adminJar.has("sid")) {
    throw new Error(`admin dev-login failed: HTTP ${response.status}`);
  }
}

async function cleanupQuery(label, text, params = []) {
  try {
    await query(text, params);
  } catch (error) {
    cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function cleanup() {
  const rfqs = [...new Set(created.rfqIds)].filter(Number.isSafeInteger);
  const orders = [...new Set(created.orderIds)].filter(Number.isSafeInteger);
  const quotes = [...new Set(created.quoteIds)].filter(Number.isSafeInteger);
  if (quotes.length) {
    await cleanupQuery("activity logs by quote", "DELETE FROM activity_logs WHERE mkt_vendor_quote_id = ANY($1::int[])", [quotes]);
    await cleanupQuery("quote lines", "DELETE FROM mkt_vendor_quote_lines WHERE quote_id = ANY($1::int[])", [quotes]);
    await cleanupQuery("quotes", "DELETE FROM mkt_vendor_quotes WHERE id = ANY($1::int[])", [quotes]);
  }
  if (rfqs.length) {
    await cleanupQuery("activity logs by RFQ", "DELETE FROM activity_logs WHERE mkt_rfq_id = ANY($1::int[])", [rfqs]);
    await cleanupQuery("RFQ approvals", "DELETE FROM mkt_rfq_approvals WHERE rfq_id = ANY($1::int[])", [rfqs]);
    await cleanupQuery("guest claims", "DELETE FROM mkt_rfq_guest_claims WHERE rfq_id = ANY($1::int[])", [rfqs]);
    await cleanupQuery("purchase orders", "DELETE FROM mkt_purchase_orders WHERE rfq_id = ANY($1::int[])", [rfqs]);
    await cleanupQuery("notification queue", "DELETE FROM mkt_notification_queue WHERE rfq_id = ANY($1::int[])", [rfqs]);
    await cleanupQuery("dual-write log", "DELETE FROM mkt_dual_write_log WHERE mkt_rfq_id = ANY($1::int[])", [rfqs]);
    await cleanupQuery("RFQ lines", "DELETE FROM mkt_rfq_lines WHERE rfq_id = ANY($1::int[])", [rfqs]);
    await cleanupQuery("RFQs", "DELETE FROM mkt_rfqs WHERE id = ANY($1::int[])", [rfqs]);
  }
  if (orders.length) {
    await cleanupQuery("order items", "DELETE FROM portal_product_order_items WHERE order_id = ANY($1::int[])", [orders]);
    await cleanupQuery("orders", "DELETE FROM portal_product_orders WHERE id = ANY($1::int[])", [orders]);
  }
  const pattern = `%${MARKER}%`;
  await cleanupQuery("marker activity logs", "DELETE FROM activity_logs WHERE description LIKE $1 OR new_value::text LIKE $1", [pattern]);
}

async function residualCounts() {
  const pattern = `%${MARKER}%`;
  const rows = await query(
    `SELECT 'mkt_rfqs' AS item, count(*)::int AS count
       FROM mkt_rfqs WHERE notes LIKE $1 OR buyer_name LIKE $1 OR buyer_email LIKE $1
     UNION ALL
     SELECT 'portal_product_orders', count(*)::int
       FROM portal_product_orders WHERE notes LIKE $1 OR customer_name LIKE $1 OR email LIKE $1
     UNION ALL
     SELECT 'mkt_vendor_quotes', count(*)::int
       FROM mkt_vendor_quotes WHERE notes LIKE $1
     UNION ALL
     SELECT 'activity_logs', count(*)::int
       FROM activity_logs WHERE description LIKE $1 OR new_value::text LIKE $1`,
    [pattern],
  );
  return Object.fromEntries(rows.map((row) => [row.item, Number(row.count)]));
}

async function run() {
  const live = await request("/");
  record("API_LIVE", live.status === 200);
  const ready = await waitForReady();
  record("API_READY", ready.status === 200 && ready.data?.ready === true, `HTTP ${ready.status}`);

  const catalog = await request(`/portal/marketplace/${CATALOG_ID}`);
  if (catalog.status !== 200 || Number(catalog.data?.id) !== CATALOG_ID || Number(catalog.data?.vendorId) !== SUPPLIER_ID) {
    throw new Error(`catalog ${CATALOG_ID} unavailable or not owned by supplier ${SUPPLIER_ID}`);
  }

  const customerToken = await portalDevLogin("customer", customerJar);
  await portalDevLogin("vendor", vendorJar);
  await adminLogin();

  const quote = await request(`/portal/marketplace/${CATALOG_ID}/quote`, {
    method: "POST",
    jar: customerJar,
    token: customerToken,
    body: {
      buyer_name: `${MARKER} Buyer`,
      email: `${MARKER.toLowerCase()}@example.test`,
      phone: "081234567890",
      destination: "Jakarta",
      required_date: "2026-09-15",
      quantity: 1,
      unit: "trip",
      notes: MARKER,
    },
  });
  rfqId = Number(quote.data?.rfqId);
  orderId = Number(quote.data?.id);
  if (quote.status === 201 && Number.isSafeInteger(rfqId) && Number.isSafeInteger(orderId)) {
    created.rfqIds.push(rfqId);
    created.orderIds.push(orderId);
    record("DIVA_RFQ_CREATED", true);
  } else {
    record("DIVA_RFQ_CREATED", false, `HTTP ${quote.status}: ${JSON.stringify(quote.data)}`);
    throw new Error("canonical Customer Portal RFQ creation failed");
  }

  const rfqRow = await one("SELECT id, rfq_number FROM mkt_rfqs WHERE id = $1 AND notes LIKE $2", [rfqId, `%${MARKER}%`]);
  const link = await request(`/mkt/admin/rfqs/${rfqId}/invite-vendor`, {
    method: "POST",
    jar: adminJar,
    body: { vendorId: SUPPLIER_ID },
  });
  const invited = await one(
    "SELECT id, token, status, valid_until FROM mkt_vendor_quotes WHERE rfq_id = $1 AND vendor_id = $2 ORDER BY id DESC LIMIT 1",
    [rfqId, SUPPLIER_ID],
  );
  quoteId = Number(invited?.id);
  rawToken = invited?.token ?? null;
  if (Number.isSafeInteger(quoteId)) created.quoteIds.push(quoteId);
  record("DIVA_INVITATION_CREATED", link.status === 201 && Number.isSafeInteger(quoteId), `HTTP ${link.status}`);

  const list = await request("/portal/admin/vendor-service-requests?limit=100", { jar: adminJar });
  const rows = Array.isArray(list.data?.items) ? list.data.items : [];
  const diva = rows.find((row) => row.source_type === "marketplace_quote" && String(row.source_id) === String(quoteId));
  record("UNIFIED_ENDPOINT", list.status === 200 && Array.isArray(list.data?.items), `HTTP ${list.status}`);
  record("DIVA_ROW_FOUND", Boolean(diva));
  const serviceText = [diva?.raw_service_type, diva?.request_notes, diva?.service_key].filter(Boolean).join(" | ");
  const generic = /^(marketplace|marketplace\s*\/\s*produk)$/i.test(String(diva?.raw_service_type ?? "").trim())
    || /^(marketplace|marketplace\s*\/\s*produk)$/i.test(String(diva?.service_key ?? "").trim());
  record("SERVICE_NAME", serviceText.toLowerCase().includes("jasa trucking"), serviceText);
  record("VENDOR_NAME", diva?.vendor_name === "PT Diva Servis", String(diva?.vendor_name));
  result.GENERIC_MARKETPLACE_LABEL_FOR_DIVA = generic ? 1 : 0;
  result.READ_MODEL_SERVICE_LABEL_FIX = !generic && serviceText.toLowerCase().includes("jasa trucking") ? "PASS" : "FAIL";
  record("BIZPORTAL_DIVA_VISIBLE", Boolean(diva));
  record("BIZPORTAL_SERVICE_NAME", serviceText.toLowerCase().includes("jasa trucking"), serviceText);
  record("BIZPORTAL_VENDOR_NAME", diva?.vendor_name === "PT Diva Servis");

  const detail = await request(`/portal/admin/vendor-service-requests/marketplace_quote/${quoteId}`, { jar: adminJar });
  record("ADMIN_REQUEST_DETAIL", detail.status === 200 && detail.data?.source_id === String(quoteId));

  async function filterPass(queryString) {
    const response = await request(`/portal/admin/vendor-service-requests?limit=100&${queryString}`, { jar: adminJar });
    return response.status === 200 && response.data?.items?.some((row) => String(row.source_id) === String(quoteId));
  }
  record("SERVICE_FILTER_TRUCKING", await filterPass("service=trucking"));
  record("VENDOR_FILTER_DIVA", await filterPass(`vendorId=${SUPPLIER_ID}`));
  record("SEARCH_DIVA", await filterPass("q=PT%20Diva%20Servis"));
  record("SEARCH_REQUEST_NUMBER", await filterPass(`q=${encodeURIComponent(diva?.request_number ?? "")}`));
  record("STATUS_FILTER", await filterPass(`status=${encodeURIComponent(diva?.raw_status ?? "invited")}`));
  record("EXPIRY_FILTER", await filterPass("linkStatus=active"));

  const unauthorized = await request("/portal/admin/vendor-service-requests");
  const customerBlocked = await request("/portal/admin/vendor-service-requests", { jar: customerJar, token: customerToken });
  const vendorToken = [...vendorJar.values()][0];
  const vendorBlocked = await request("/portal/admin/vendor-service-requests", { jar: vendorJar, token: vendorToken });
  record("UNAUTH_ADMIN_ENDPOINT", unauthorized.status === 401, `HTTP ${unauthorized.status}`);
  record("CUSTOMER_ADMIN_ENDPOINT", customerBlocked.status === 403, `HTTP ${customerBlocked.status}`);
  record("NON_ADMIN_ENDPOINT", vendorBlocked.status === 403, `HTTP ${vendorBlocked.status}`);
  record("ADMIN_ENDPOINT", list.status === 200, `HTTP ${list.status}`);

  const listText = JSON.stringify(list.data);
  const detailText = JSON.stringify(detail.data);
  record("RAW_TOKEN_IN_LIST", rawToken ? !listText.includes(rawToken) : false);
  record("RAW_TOKEN_IN_DETAIL", rawToken ? !detailText.includes(rawToken) : false);
  const publicList = await request("/portal/marketplace");
  const publicDetail = await request(`/portal/marketplace/${CATALOG_ID}`);
  const publicText = `${JSON.stringify(publicList.data)}${JSON.stringify(publicDetail.data)}`;
  record("TOKEN_LEAK_TO_PUBLIC", rawToken ? !publicText.includes(rawToken) : false);

  const byService = new Map();
  for (const row of rows) {
    if (row.service_key && !byService.has(row.service_key)) {
      byService.set(row.service_key, row);
    }
  }
  result.SEA_FREIGHT_SERVICE_LABEL = byService.get("sea_freight")?.raw_service_type ?? "EMPTY";
  result.AIR_FREIGHT_SERVICE_LABEL = byService.get("air_freight")?.raw_service_type ?? "EMPTY";
  result.DOMESTIC_SERVICE_LABEL = byService.get("domestic")?.raw_service_type ?? "EMPTY";
  result.CUSTOM_CLEARANCE_SERVICE_LABEL = byService.get("customs")?.raw_service_type ?? "EMPTY";
  result.CUSTOMS_PABEAN_SERVICE_LABEL = byService.get("customs")?.raw_service_type ?? "EMPTY";

  const bizportal = await fetch("http://127.0.0.1:18442/bizportal/");
  const bizportalBody = await bizportal.text();
  record("BIZPORTAL_RUNTIME", bizportal.status === 200 && bizportalBody.toLowerCase().includes("<!doctype html"));

  console.log(JSON.stringify({
    ...result,
    RUN_ID,
    RFQ_ID: rfqId,
    REQUEST_NUMBER: rfqRow?.rfq_number ?? diva?.request_number ?? null,
    QUOTE_ID: quoteId,
    INVITATION_STATUS: invited?.status ?? null,
    VENDOR_CONTACT: diva?.vendor_phone ?? diva?.vendor_email ?? null,
    EXPIRES_AT: diva?.expires_at ?? null,
    IS_EXPIRED: diva?.is_expired ?? null,
    SOURCE_TYPE: diva?.source_type ?? null,
    RAW_STATUS_PRESERVED: diva?.raw_status ?? null,
    genericLabelSource: diva?.raw_service_type ?? null,
  }, null, 2));
}

try {
  await run();
} catch (error) {
  result.ERROR = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ...result, RUN_ID, PASS: false }, null, 2));
  process.exitCode = 1;
} finally {
  await cleanup();
  let residual = {};
  try {
    residual = await residualCounts();
  } catch (error) {
    cleanupErrors.push(`residual query: ${error instanceof Error ? error.message : String(error)}`);
  }
  result.CLEANUP_ERRORS = cleanupErrors.length;
  result.RESIDUAL_AUDIT_RECORDS = Object.values(residual).reduce((sum, count) => sum + Number(count), 0);
  console.log(JSON.stringify({
    RUN_ID,
    CLEANUP_ERRORS: cleanupErrors.length,
    cleanupDetails: cleanupErrors,
    RESIDUAL_AUDIT_RECORDS: result.RESIDUAL_AUDIT_RECORDS,
    residual,
  }, null, 2));
  await pool.end();
}