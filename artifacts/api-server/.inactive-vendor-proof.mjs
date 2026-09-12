import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const API = "http://127.0.0.1:18444/api/portal";
const runId = `AUDIT-INACTIVE-${Date.now()}`;
const email = `${runId.toLowerCase()}@example.test`;
const phone = `62811${String(Date.now()).slice(-8)}`;
const password = "AuditInactivePass!2026";
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL_DEV, max: 1 });
const jar = new Map();
const results = [];
let customerId;
let supplierId;
let profileId;
let itemId;

function cookies(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (headers.get("set-cookie") || "").split(/,(?=[^;]+=)/);
  for (const value of values) {
    const pair = value.split(";")[0];
    const at = pair.indexOf("=");
    if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.body ? { "content-type": "application/json" } : {}) };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  cookies(response.headers);
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body };
}

async function check(label, method, path, options, blocked = true) {
  const response = await request(path, { method, ...options });
  const pass = blocked ? [401, 403, 404].includes(response.status) : response.status < 500;
  results.push({ label, method, path, status: response.status, expected: blocked ? "403/404" : "executed" , pass });
  if (!pass) throw new Error(`${label}: unexpected HTTP ${response.status}`);
}

try {
  if (process.env.APP_ENV === "production" || process.env.REPLIT_DEPLOYMENT) throw new Error("production refused");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hash = await bcrypt.hash(password, 10);
    const customer = await client.query(
      `INSERT INTO portal_customers (name,email,password_hash,phone,role)
       VALUES ($1,$2,$3,$4,'vendor') RETURNING id`,
      [runId, email, hash, phone],
    );
    customerId = customer.rows[0].id;
    const supplier = await client.query(
      `INSERT INTO suppliers (name,vendor_code,contact_email,phone,is_active,status,is_verified,marketplace_status)
       VALUES ($1,$2,$3,$4,false,'inactive',false,'draft') RETURNING id`,
      [runId, `${runId}-CODE`, email, phone],
    );
    supplierId = supplier.rows[0].id;
    const profile = await client.query(
      `INSERT INTO vendor_profiles (customer_id,supplier_id,company_name,email,phone)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [customerId, supplierId, runId, email, phone],
    );
    profileId = profile.rows[0].id;
    await client.query(
      `INSERT INTO user_profiles (customer_id,account_type,status,full_name)
       VALUES ($1,'vendor','pending',$2)`,
      [customerId, runId],
    );
    const item = await client.query(
      `INSERT INTO vendor_catalog_items (vendor_id,vendor_name,type,name,status,is_published,is_active)
       VALUES ($1,$2,'product',$3,'pending_review',false,true) RETURNING id`,
      [supplierId, runId, `${runId}-PRODUCT`],
    );
    itemId = item.rows[0].id;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const login = await request("/auth/login", { method: "POST", body: { email, password } });
  if (login.status !== 200 || !jar.size) throw new Error(`login failed: ${login.status}`);

  await check("read profile", "GET", "/vendor/profile");
  await check("update profile", "PATCH", "/vendor/profile", { body: { companyDescription: `${runId} blocked` } });
  await check("list catalog", "GET", "/vendor/catalog");
  await check("create catalog", "POST", "/vendor/catalog", { body: { name: `${runId}-CREATE`, templateKind: "product" } });
  await check("edit catalog", "PUT", `/vendor/catalog/${itemId}`, { body: { name: `${runId}-EDIT`, templateKind: "product" } });
  await check("publish", "POST", `/vendor/catalog/${itemId}/publish`, { body: {} });
  await check("unpublish", "POST", `/vendor/catalog/${itemId}/unpublish`, { body: {} });
  await check("media assets", "PATCH", `/vendor/catalog/${itemId}/media-assets`, { body: { mediaAssets: [] } });
  await check("catalog archive", "POST", `/vendor/catalog/${itemId}/archive`, { body: {} });
  await check("quote submission", "POST", "/vendor/quotes", { body: { rfqId: 999999999, vendorPrice: 1 } });
  await check("catalog submissions", "GET", "/vendor/catalog-submissions");
  await check("featured requests", "GET", "/vendor/featured-requests");
  await check("featured create", "POST", "/vendor/featured-requests", { body: { catalogItemId: itemId, packageId: 999999999 } });
  await check("notifications", "GET", "/vendor/notifications");
  await check("notifications read-all", "POST", "/vendor/notifications/read-all", { body: {} });

  console.log(JSON.stringify({ ok: true, runId, inactiveVendorBypass: results.filter((r) => !r.pass).length, results }));
} finally {
  const cleanup = await pool.connect();
  try {
    await cleanup.query("BEGIN");
    if (itemId) await cleanup.query("DELETE FROM vendor_catalog_items WHERE id=$1", [itemId]);
    if (profileId) await cleanup.query("DELETE FROM vendor_profiles WHERE id=$1", [profileId]);
    if (supplierId) await cleanup.query("DELETE FROM suppliers WHERE id=$1", [supplierId]);
    if (customerId) {
      await cleanup.query("DELETE FROM user_profiles WHERE customer_id=$1", [customerId]);
      await cleanup.query("DELETE FROM portal_customers WHERE id=$1", [customerId]);
    }
    await cleanup.query("COMMIT");
  } catch (error) {
    await cleanup.query("ROLLBACK").catch(() => {});
    console.error("cleanup failed", error);
  } finally {
    cleanup.release();
    await pool.end();
  }
}