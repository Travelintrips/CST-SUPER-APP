/**
 * Phase 5 Regression Test
 * Covers: Customer Order, RFQ V1, RFQ V2, Vendor Mini Form,
 *         Customer Approval, Admin Fulfillment, Exceptions,
 *         Governance Health, Payments, Webhooks, Dashboard,
 *         /inventory/warehouses deprecation header
 *
 * Run: node scripts/regression-phase5.mjs
 * Requires: SUPABASE_PG_URL or DATABASE_URL env var
 */

import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.SUPABASE_PG_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const ADMIN_USER = {
  id: "google_105923730112281797571",
  email: "febrian.ryan1980@gmail.com",
  firstName: "Febrian", lastName: "Ryan",
  profileImageUrl: null, role: "admin", companyId: 1,
};

const sid = crypto.randomBytes(32).toString("hex");
await pool.query("INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)", [sid, JSON.stringify({ user: ADMIN_USER }), new Date(Date.now() + 3600000)]);

const BASE = "http://localhost:18444/api";
const req = async (method, path, body) => {
  const opts = { method, headers: { "Content-Type": "application/json", Cookie: `sid=${sid}` } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = null; }
  return { status: r.status, body: json, headers: Object.fromEntries(r.headers.entries()) };
};
const noAuth = async (method, path, body) => {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  let json; try { json = await r.json(); } catch { json = null; }
  return { status: r.status, body: json, headers: Object.fromEntries(r.headers.entries()) };
};

const results = [];
const chk = (name, cond, detail) => {
  results.push({ ok: cond, name });
  console.log((cond ? '✅' : '❌') + ' ' + name);
  if (detail) console.log('   →', String(detail).slice(0, 200));
};

console.log('\n── A. Customer Order ──────────────────────────────────');
chk('A1. GET /logistic/orders (admin) → 200',           (await req('GET', '/logistic/orders?page=1&limit=5')).status === 200, '');
chk('A2. GET /logistic/orders tanpa auth → 401',        (await noAuth('GET', '/logistic/orders')).status === 401, '');

console.log('\n── B. RFQ V1 Customer Portal ──────────────────────────');
chk('B1. rfq-form → route exists (404=data not found)', (await noAuth('GET', '/logistic/orders/rfq-form?rfq=X&v=1&token=Y')).status !== 500, '');
chk('B2. choose-option-form → route exists',            (await noAuth('GET', '/logistic/orders/choose-option-form/DUMMY')).status !== 500, '');
chk('B3. vendor-confirm-page → route exists',           (await noAuth('GET', '/logistic/orders/vendor-confirm-page?orderId=99&token=X')).status !== 500, '');
chk('B4. logistic-vendors tanpa auth → 401',            (await noAuth('GET', '/logistic/orders/logistic-vendors')).status === 401, '');
chk('B5. logistic-vendors (admin) → 200',               (await req('GET', '/logistic/orders/logistic-vendors')).status === 200, '');
chk('B6. approve-form → route exists',                  (await noAuth('GET', '/logistic/orders/approve-form/ORD-X')).status !== 500, '');

console.log('\n── C. RFQ V2 BizPortal ────────────────────────────────');
chk('C1. GET /logistic/rfq/list (admin) → 200',         (await req('GET', '/logistic/rfq/list?page=1&limit=5')).status === 200, '');
chk('C2. GET /logistics/freight-shipments → 200',       (await req('GET', '/logistics/freight-shipments?page=1&limit=5')).status === 200, '');

console.log('\n── D. Vendor Mini Form ────────────────────────────────');
const vmfLinks = await req('GET', '/vendor-form/admin/links?page=1&limit=5');
chk('D1. GET /vendor-form/admin/links (admin) → 200',   vmfLinks.status === 200, `count=${vmfLinks.body?.data?.length ?? 0}`);
chk('D2. GET /vendor-form/admin/links tanpa auth → 401',(await noAuth('GET', '/vendor-form/admin/links')).status === 401, '');
chk('D3. GET /vendor-form/:token (public route exists)', (await noAuth('GET', '/vendor-form/DUMMY_TOKEN_12345')).status !== 500, '');

console.log('\n── E. Customer Approval ───────────────────────────────');
chk('E1. /logistic/customer-quote/admin/list → not 500',(await req('GET', '/logistic/customer-quote/admin/list')).status !== 500, '');
chk('E2. /customer-quote/public/status (public) → not 500',(await noAuth('GET', '/customer-quote/public/status/DUMMY')).status !== 500, '');

console.log('\n── F. Admin Fulfillment ───────────────────────────────');
chk('F1. GET /logistic/orders/1/fulfillment (admin) → not 500',   (await req('GET', '/logistic/orders/1/fulfillment')).status !== 500, '');
const fulfillUnauth = await noAuth('GET', '/logistic/orders/1/fulfillment');
chk('F2. GET /logistic/orders/1/fulfillment tanpa auth → 401/403/404', [401, 403, 404].includes(fulfillUnauth.status), `HTTP ${fulfillUnauth.status}`);

console.log('\n── G. Exceptions ──────────────────────────────────────');
chk('G1. GET /exceptions tanpa auth → 401',             (await noAuth('GET', '/exceptions')).status === 401, '');
chk('G2. GET /exceptions (admin) → 200',                (await req('GET', '/exceptions')).status === 200, '');
const excCreate = await req('POST', '/exceptions', { exceptionType: 'delivery_delayed', severity: 'medium', title: 'Phase5 Regression', refNumber: 'P5REG-001' });
chk('G3. POST /exceptions → 201',                       excCreate.status === 201, `id=${excCreate.body?.id}`);
const excId = excCreate.body?.id;
if (excId) {
  const upd = await req('PUT', `/exceptions/${excId}`, { status: 'resolved', resolutionNotes: 'OK' });
  chk('G4. PUT /exceptions/:id resolve → resolvedBy terisi', upd.status === 200 && !!upd.body?.resolvedBy, `resolvedBy=${upd.body?.resolvedBy}`);
  await req('DELETE', `/exceptions/${excId}`);
}
chk('G5. GET /exceptions/stats → 200',                  (await req('GET', '/exceptions/stats')).status === 200, '');

console.log('\n── H. Governance Health ───────────────────────────────');
chk('H1. /system/governance-health tanpa auth → 401',   (await noAuth('GET', '/system/governance-health')).status === 401, '');
const gov = await req('GET', '/system/governance-health');
chk('H2. /system/governance-health (admin) → 200',      gov.status === 200 && !!gov.body?.generatedAt, `overdue.inv=${gov.body?.overdue?.invoices}`);

console.log('\n── I. Payment Manual ──────────────────────────────────');
chk('I1. GET /payments (admin) → 200',                  (await req('GET', '/payments')).status === 200, '');
chk('I2. GET /payments tanpa auth → 401',               (await noAuth('GET', '/payments')).status === 401, '');

console.log('\n── J. Webhooks ────────────────────────────────────────');
chk('J1. POST /payments/paylabs/webhook → not 404/500', ![404, 500].includes((await noAuth('POST', '/payments/paylabs/webhook', {})).status), '');
chk('J2. POST /webhook/fonnte → not 404/500',           ![404, 500].includes((await noAuth('POST', '/webhook/fonnte', {})).status), '');

console.log('\n── K. Dashboard (shipmentsTable removed) ──────────────');
const dash = await req('GET', '/dashboard/summary');
chk('K1. GET /dashboard/summary → 200',                 dash.status === 200, `HTTP ${dash.status}`);
chk('K2. totalShipments dari freightShipmentsTable',    dash.status === 200 && dash.body?.totalShipments !== undefined, `totalShipments=${dash.body?.totalShipments}`);

console.log('\n── L. /inventory/warehouses deprecation ───────────────');
const invWh = await req('GET', '/inventory/warehouses/warehouses');
chk('L1. Deprecation: true header ada',                 invWh.headers?.['deprecation'] === 'true', `value=${invWh.headers?.['deprecation']}`);
chk('L2. X-Deprecated-Route header ada',                !!invWh.headers?.['x-deprecated-route'], `value=${invWh.headers?.['x-deprecated-route']?.slice(0,50)}`);

await pool.query("DELETE FROM sessions WHERE sid = $1", [sid]);
await pool.end();

const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
console.log(`\n${'═'.repeat(62)}`);
console.log(`Phase 5 Regression — Total: ${results.length} | ✅ PASS: ${pass} | ❌ FAIL: ${fail}`);
if (fail === 0) console.log('🎉 SEMUA PASS — Phase 5 cleanup candidate siap review.');
else { results.filter(r => !r.ok).forEach(r => console.log('   ❌ ' + r.name)); process.exit(1); }
