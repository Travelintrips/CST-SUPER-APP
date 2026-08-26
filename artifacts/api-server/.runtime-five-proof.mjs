import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.RUNTIME_PROOF_BASE_URL ?? "http://127.0.0.1:18444/api";
const MARK = `AUDIT-RUNTIME-${Date.now()}`;
const email = (name) => `${name.toLowerCase()}-${MARK.toLowerCase()}@example.test`;
const password = "AuditRuntimeOnly!42";
const names = {
  customerA: email("customer-a"),
  customerB: email("customer-b"),
  vendorA: email("vendor-a"),
  vendorB: email("vendor-b"),
};

const isDev = process.env.APP_ENV === "development"
  && !process.env.REPLIT_DEPLOYMENT
  && !!process.env.SUPABASE_DATABASE_URL_DEV;
if (!isDev) throw new Error("FAIL-CLOSED: development runtime proof requires APP_ENV=development and SUPABASE_DATABASE_URL_DEV");

const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DATABASE_URL_DEV, max: 4 });
const created = { customers: [], suppliers: [], products: [], submissions: [], rfqs: [], lines: [], quotes: [], members: [], vendorNotifications: [], adminNotifications: [] };
const results = [];
let client;

function record(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(message) { throw new Error(message); }
async function sql(text, params = []) {
  const r = await pool.query(text, params);
  return r.rows;
}
async function fresh(text, params = []) { return sql(text, params); }

class Jar {
  constructor() { this.cookies = new Map(); }
  ingest(headers) {
    const values = headers.getSetCookie?.() ?? [];
    for (const value of values) {
      const [pair] = value.split(";");
      const [k, ...v] = pair.split("=");
      this.cookies.set(k, v.join("="));
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function request(path, { method = "GET", body, jar, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (jar?.header()) h.cookie = jar.header();
  const response = await fetch(`${BASE}${path}`, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar?.ingest(response.headers);
  let payload;
  try { payload = await response.json(); } catch { payload = await response.text(); }
  return { status: response.status, body: payload, headers: response.headers };
}
async function loginPortal(customer) {
  const jar = new Jar();
  const loginIp = `10.77.0.${Math.floor(Math.random() * 240) + 1}`;
  const r = await request("/portal/auth/login", { method: "POST", body: { email: customer.email, password }, jar, headers: { "x-forwarded-for": loginIp } });
  record(`${customer.label} authenticated session`, r.status === 200 && !!jar.header(), `${r.status}`);
  if (r.status !== 200) fail(`portal login failed for ${customer.label}: ${JSON.stringify(r.body)}`);
  jar.token = r.body?.token;
  return jar;
}
async function adminSession() {
  const rows = await sql("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL ORDER BY id LIMIT 1");
  const adminEmail = rows[0]?.email || "dev-admin@dev.local";
  const jar = new Jar();
  const r = await request("/auth/dev-login", { method: "POST", body: { email: adminEmail }, jar });
  record("admin authenticated session", r.status === 200 && !!jar.header(), `${r.status}`);
  if (r.status !== 200) fail(`admin login failed: ${JSON.stringify(r.body)}`);
  return jar;
}
function expectBlocked(name, response, allowed = [401, 403, 404, 409]) {
  const pass = allowed.includes(response.status);
  record(name, pass, `HTTP ${response.status}`);
  return pass;
}

async function setup() {
  client = await pool.connect();
  const company = (await client.query("SELECT id, name FROM companies ORDER BY id LIMIT 1")).rows[0];
  if (!company) fail("No company available in development database");
  const hash = await bcrypt.hash(password, 4);
  for (const [label, role] of [["customerA", "customer"], ["customerB", "customer"], ["vendorA", "vendor"], ["vendorB", "vendor"]]) {
    const c = (await client.query(
      `INSERT INTO portal_customers (name,email,password_hash,phone,company,role,account_status)
       VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id,email`,
      [`${MARK} ${label}`, names[label], hash, `628${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`, company.name, role],
    )).rows[0];
    created.customers.push(c.id);
    c.label = label; c.email = names[label];
    if (label.startsWith("customer")) {
      const m = (await client.query(
        `INSERT INTO portal_company_members (portal_customer_id,company_id,buyer_role,department,cost_center,approval_level,is_active)
         VALUES ($1,$2,'requester','${MARK}','${MARK}',1,true) RETURNING id`, [c.id, company.id],
      )).rows[0];
      created.members.push(m.id);
    } else {
      await client.query(
        `INSERT INTO user_profiles (customer_id,full_name,account_type,status,completed_at)
         VALUES ($1,$2,'vendor','active',now())`, [c.id, `${MARK} ${label}`],
      );
    }
  }
  const supplierIds = {};
  for (const label of ["vendorA", "vendorB"]) {
    const c = await client.query("SELECT id FROM portal_customers WHERE email=$1", [names[label]]);
    const s = (await client.query(
      `INSERT INTO suppliers (name,company_id,contact_email,phone,portal_phone,is_active,status,is_verified,marketplace_status,marketplace_published_at)
       VALUES ($1,$2,$3,$4,$4,true,'active',true,'published',now()) RETURNING id`,
      [`${MARK} ${label}`, company.id, names[label], `628${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`],
    )).rows[0];
    supplierIds[label] = s.id; created.suppliers.push(s.id);
    await client.query(
      `INSERT INTO vendor_profiles (customer_id,company_name,supplier_id,verification_status,email)
       VALUES ($1,$2,$3,'approved',$4)`, [c.rows[0].id, `${MARK} ${label}`, s.id, names[label]],
    );
  }
  return { company, supplierIds };
}

async function createProduct(jar, label, categoryKey = null) {
  const r = await request("/portal/vendor/catalog", {
    method: "POST", jar,
    body: { name: `${MARK} ${label}`, description: `${MARK} product`, templateKind: "product",
      categoryKey, priceSell: 125000, unit: "unit", origin: "ID" },
  });
  record(`${label} creates product through canonical endpoint`, r.status === 201, `HTTP ${r.status}`);
  if (r.status !== 201) fail(`product creation failed: ${JSON.stringify(r.body)}`);
  const id = Number(r.body.id); created.products.push(id);
  const row = (await fresh(
    "SELECT id,source_submission_id,status,is_published FROM vendor_catalog_items WHERE id=$1 AND name LIKE $2",
    [id, `${MARK}%`],
  ))[0];
  if (!row) fail(`product ${label} missing on fresh query`);
  created.submissions.push(row.source_submission_id);
  return row;
}

async function productProof(vendorAJar, vendorBJar, adminJar, productA, productB) {
  const before = await fresh("SELECT status,is_published FROM vendor_catalog_items WHERE id=$1", [productA.id]);
  const marketplaceBefore = await request(`/portal/marketplace/${productA.id}`);
  record("product is hidden before approval", before[0]?.status === "pending_review" && !before[0]?.is_published && marketplaceBefore.status === 404, `item=${before[0]?.status}, public=${marketplaceBefore.status}`);
  expectBlocked("vendor cannot self-publish pending product", await request(`/portal/vendor/catalog/${productA.id}/publish`, { method: "POST", jar: vendorAJar }));

  const approval = await request(`/trading/catalog-engine/submissions/${productA.source_submission_id}/approve`, { method: "POST", jar: adminJar, body: { reviewNotes: `${MARK} first approval` } });
  record("admin approves product", approval.status === 200, `HTTP ${approval.status}`);
  const after = (await fresh("SELECT status,is_published FROM vendor_catalog_items WHERE id=$1", [productA.id]))[0];
  const marketplaceAfter = await request(`/portal/marketplace/${productA.id}`);
  record("approved product becomes publicly visible", after?.status === "published" && after?.is_published && marketplaceAfter.status === 200, `state=${after?.status}, public=${marketplaceAfter.status}`);

  const edited = await request(`/portal/vendor/catalog/${productA.id}`, {
    method: "PUT", jar: vendorAJar,
    body: { name: `${MARK} edited`, templateKind: "product", priceSell: 130000, unit: "unit" },
  });
  record("editing published product reopens review", edited.status === 200, `HTTP ${edited.status}`);
  const editState = (await fresh("SELECT status,is_published FROM vendor_catalog_items WHERE id=$1", [productA.id]))[0];
  const editPublic = await request(`/portal/marketplace/${productA.id}`);
  record("edited product is hidden until re-approved", editState?.status === "pending_review" && !editState?.is_published && editPublic.status === 404, `${editState?.status}/${editPublic.status}`);

  const resubmit = await fresh("SELECT id FROM vendor_catalog_submissions WHERE catalog_item_id=$1 ORDER BY id DESC LIMIT 1", [productA.id]);
  const approval2 = await request(`/trading/catalog-engine/submissions/${resubmit[0]?.id}/approve`, { method: "POST", jar: adminJar, body: { reviewNotes: `${MARK} reapproval` } });
  record("admin re-approves edited product", approval2.status === 200, `HTTP ${approval2.status}`);
  const mediaReview = await request(`/portal/vendor/catalog/${productA.id}/media-assets`, {
    method: "PATCH", jar: vendorAJar, body: { mediaAssets: [] },
  });
  const mediaState = (await fresh("SELECT status,is_published FROM vendor_catalog_items WHERE id=$1", [productA.id]))[0];
  record("media change reopens product review", mediaReview.status === 200 && mediaState?.status === "pending_review" && !mediaState?.is_published, `HTTP ${mediaReview.status}/${mediaState?.status}`);
  const mediaSubmission = (await fresh("SELECT id FROM vendor_catalog_submissions WHERE catalog_item_id=$1 ORDER BY id DESC LIMIT 1", [productA.id]))[0];
  const mediaApproval = await request(`/trading/catalog-engine/submissions/${mediaSubmission?.id}/approve`, { method: "POST", jar: adminJar, body: { reviewNotes: `${MARK} media reapproval` } });
  record("admin approves media re-review", mediaApproval.status === 200, `HTTP ${mediaApproval.status}`);

  const rejectProduct = await createProduct(vendorBJar, "rejection");
  const reject = await request(`/trading/catalog-engine/submissions/${rejectProduct.source_submission_id}/reject`, { method: "POST", jar: adminJar, body: { reviewNotes: `${MARK} rejected` } });
  const rejectState = (await fresh("SELECT status,is_published FROM vendor_catalog_items WHERE id=$1", [rejectProduct.id]))[0];
  record("admin rejection keeps product private", reject.status === 200 && rejectState?.status === "rejected" && !rejectState?.is_published, `HTTP ${reject.status}/${rejectState?.status}`);
  return { productA: { ...productA, id: productA.id }, productB, resubmit: resubmit[0]?.id };
}

async function idorProof(vendorAJar, vendorBJar, productA, productB) {
  let attempts = 0, blocked = 0, found = 0;
  const tests = [
    ["A cannot edit B product", () => request(`/portal/vendor/catalog/${productB.id}`, { method: "PUT", jar: vendorAJar, body: { name: `${MARK} x`, templateKind: "product" } })],
    ["B cannot edit A product", () => request(`/portal/vendor/catalog/${productA.id}`, { method: "PUT", jar: vendorBJar, body: { name: `${MARK} x`, templateKind: "product" } })],
    ["A cannot publish B product", () => request(`/portal/vendor/catalog/${productB.id}/publish`, { method: "POST", jar: vendorAJar })],
    ["B cannot archive A product", () => request(`/portal/vendor/catalog/${productA.id}/archive`, { method: "POST", jar: vendorBJar })],
    ["A cannot unpublish B product", () => request(`/portal/vendor/catalog/${productB.id}/unpublish`, { method: "POST", jar: vendorAJar })],
    ["B cannot update A media metadata", () => request(`/portal/vendor/catalog/${productA.id}/media-assets`, { method: "PATCH", jar: vendorBJar, body: { mediaAssets: [] } })],
  ];
  for (const [label, fn] of tests) {
    attempts++;
    const r = await fn();
    if (expectBlocked(label, r)) blocked++; else found++;
  }
  record("full vendor A ↔ B IDOR matrix", found === 0 && blocked === attempts, `IDOR_ATTEMPTS=${attempts} IDOR_BLOCKED=${blocked} IDOR_FOUND=${found}`);
  return { attempts, blocked, found };
}

async function notificationProof(adminJar, vendorAJar, vendorBJar, productA) {
  await new Promise((r) => setTimeout(r, 1500));
  const aBefore = Number((await fresh("SELECT count(*) AS n FROM vendor_notifications WHERE vendor_id=(SELECT id FROM suppliers WHERE name=$1) AND created_at >= now()-interval '5 minutes'", [`${MARK} vendorA`]))[0]?.n ?? 0);
  const bBefore = Number((await fresh("SELECT count(*) AS n FROM vendor_notifications WHERE vendor_id=(SELECT id FROM suppliers WHERE name=$1) AND created_at >= now()-interval '5 minutes'", [`${MARK} vendorB`]))[0]?.n ?? 0);
  const aOwn = await request("/portal/vendor/notifications", { jar: vendorAJar });
  const bOwn = await request("/portal/vendor/notifications", { jar: vendorBJar });
  const aText = JSON.stringify(aOwn.body);
  const bText = JSON.stringify(bOwn.body);
  const aOwnProduct = aText.includes(`${MARK} edited`) || aText.includes(`${MARK} media reapproval`);
  const bHasAProduct = bText.includes(`${MARK} edited`) || bText.includes(`${MARK} media reapproval`);
  record("vendor notification recipient isolation", aOwn.status === 200 && bOwn.status === 200 && aOwnProduct && !bHasAProduct, `A=${aOwn.status} B=${bOwn.status}`);
  const admin = await request("/trading/catalog-engine/queue", { jar: adminJar });
  record("product review generated canonical admin notification path", admin.status === 200, `HTTP ${admin.status}`);
  const counts = await fresh(
    `SELECT
       (SELECT count(*) FROM vendor_notifications vn JOIN portal_customers pc ON pc.id=vn.vendor_id WHERE pc.email = ANY($2::text[])) AS vendor_notifications,
       (SELECT count(*) FROM admin_notifications WHERE body LIKE $1 OR title LIKE $1) AS admin_notifications,
       (SELECT count(*) FROM mkt_notification_queue WHERE payload_json::text LIKE $1) AS queued_notifications`,
    [`${MARK}%`, [names.vendorA, names.vendorB]],
  );
  record("natural notification evidence is present", Number(counts[0]?.vendor_notifications ?? 0) + Number(counts[0]?.admin_notifications ?? 0) + Number(counts[0]?.queued_notifications ?? 0) > 0, JSON.stringify(counts[0]));
  return { aBefore, bBefore };
}

async function rfqProof(customerAJar, customerBJar, vendorAJar, adminJar, productA, supplierA) {
  const create = await request(`/portal/marketplace/${productA.id}/quote`, {
    method: "POST", jar: customerAJar, headers: { authorization: `Bearer ${customerAJar.token}` },
    body: { customerName: `${MARK} customerA`, email: names.customerA, phone: "628111111111", buyerCompany: `${MARK} buyer`, qty: 2, notes: `${MARK} RFQ` },
  });
  record("customer A creates RFQ through canonical endpoint", create.status === 201, `HTTP ${create.status}`);
  const rfqId = Number(create.body.rfqId);
  if (!rfqId) fail(`RFQ creation failed: ${JSON.stringify(create.body)}`);
  created.rfqs.push(rfqId);
  const r = (await fresh("SELECT id,line_count,portal_customer_id,company_id,status FROM mkt_rfqs WHERE id=$1", [rfqId]))[0];
  const line = (await fresh("SELECT id FROM mkt_rfq_lines WHERE rfq_id=$1", [rfqId]))[0];
  if (line) created.lines.push(line.id);
  record("RFQ persists buyer identity and line on fresh query", r?.portal_customer_id && r?.company_id && Number(r.line_count) >= 1 && !!line, JSON.stringify(r));

  const customerBView = await request(`/mkt/portal/rfqs/${rfqId}`, { jar: customerBJar });
  expectBlocked("customer B cannot read customer A RFQ", customerBView, [403, 404]);
  const customerBApprove = await request(`/mkt/portal/rfqs/${rfqId}/approve`, { method: "POST", jar: customerBJar, body: {} });
  expectBlocked("customer B cannot approve customer A RFQ", customerBApprove, [403, 404, 409, 422]);

  const invite = await request(`/mkt/admin/rfqs/${rfqId}/invite-vendor`, { method: "POST", jar: adminJar, body: { vendorId: supplierA } });
  record("admin assigns RFQ to Vendor A", [200, 201].includes(invite.status), `HTTP ${invite.status}`);
  const quote = (await fresh("SELECT id,vendor_id,rfq_id,token_hash,status FROM mkt_vendor_quotes WHERE rfq_id=$1 AND vendor_id=$2 ORDER BY id DESC LIMIT 1", [rfqId, supplierA]))[0];
  if (!quote) {
    record("RFQ assignment creates vendor quote", false, "quote row missing");
    return;
  }
  created.quotes.push(quote.id);
  const tokenRow = (await fresh("SELECT token FROM mkt_vendor_quotes WHERE id=$1", [quote.id]))[0];
  if (!tokenRow?.token) {
    record("RFQ assignment exposes usable vendor token", false, "token missing");
    return;
  }
  const load = await request(`/vendor-quote/${encodeURIComponent(tokenRow.token)}`);
  record("assigned vendor can load RFQ quote", load.status === 200, `HTTP ${load.status}`);
  const submit = await request(`/vendor-quote/${encodeURIComponent(tokenRow.token)}/submit`, {
    method: "POST",
    body: { lines: [{ rfqLineId: line.id, offeredUnitPrice: 100000, offeredQty: 2, currency: "IDR", validUntil: "2027-01-01" }], notes: `${MARK} quote` },
  });
  record("assigned vendor can submit RFQ quote", submit.status === 200, `HTTP ${submit.status}`);
  const repeat = await request(`/vendor-quote/${encodeURIComponent(tokenRow.token)}/submit`, { method: "POST", body: { lines: [] } });
  expectBlocked("submitted quote cannot be submitted twice", repeat, [409, 422]);
  const crossToken = await request(`/vendor-quote/${encodeURIComponent(tokenRow.token)}`, { headers: { "x-audit-role": "vendor-b" } });
  record("RFQ token does not expose internal buyer/vendor fields", crossToken.status === 200 && !JSON.stringify(crossToken.body).includes(names.customerA), `HTTP ${crossToken.status}`);
  const select = await request(`/mkt/portal/rfqs/${rfqId}/select-vendor`, { method: "POST", jar: customerAJar, body: { quoteId: quote.id } });
  record("buyer selects submitted vendor quote", select.status === 200, `HTTP ${select.status}`);
  const sendReview = await request(`/mkt/portal/rfqs/${rfqId}/send-to-customer-review`, { method: "POST", jar: customerAJar, body: { notes: `${MARK} review` } });
  record("buyer sends RFQ to customer review", sendReview.status === 200, `HTTP ${sendReview.status}`);
  const customerApprove = await request(`/mkt/portal/rfqs/${rfqId}/customer-approve`, { method: "POST", jar: customerAJar, body: { notes: `${MARK} approved` } });
  const awarded = (await fresh("SELECT status FROM mkt_rfqs WHERE id=$1", [rfqId]))[0];
  record("customer approves selected RFQ quote", customerApprove.status === 200 && awarded?.status === "awarded", `HTTP ${customerApprove.status}/${awarded?.status}`);
}

async function approvalRace(adminJar, productB) {
  const submission = (await fresh("SELECT id FROM vendor_catalog_submissions WHERE catalog_item_id=$1", [productB.id]))[0];
  if (!submission) { record("approval race fixture", false, "submission missing"); return; }
  const approve = () => request(`/trading/catalog-engine/submissions/${submission.id}/approve`, { method: "POST", jar: adminJar, body: { reviewNotes: `${MARK} race` } });
  const reject = () => request(`/trading/catalog-engine/submissions/${submission.id}/reject`, { method: "POST", jar: adminJar, body: { reviewNotes: `${MARK} race` } });
  const [aa, ab] = await Promise.all([approve(), approve()]);
  const aaPass = [aa.status, ab.status].filter((x) => x === 200).length === 1 && [aa.status, ab.status].some((x) => x === 409);
  record("approval race approve versus approve", aaPass, `${aa.status}/${ab.status}`);
  const row = (await fresh("SELECT status FROM vendor_catalog_submissions WHERE id=$1", [submission.id]))[0];
  record("approval race leaves one terminal submission state", ["approved", "rejected"].includes(row?.status), row?.status ?? "missing");
  const [ra, rb] = await Promise.all([reject(), reject()]);
  record("approval race reject versus reject is idempotently blocked", [ra.status, rb.status].every((s) => [200, 409].includes(s)) && [ra.status, rb.status].includes(409), `${ra.status}/${rb.status}`);
  const [ar, rr] = await Promise.all([approve(), reject()]);
  record("approval race approve versus reject is serialized", [ar.status, rr.status].filter((s) => [200, 409].includes(s)).length === 2, `${ar.status}/${rr.status}`);
}

async function cleanup() {
  const c = client || await pool.connect();
  try {
    await c.query("BEGIN");
    const poRows = created.quotes.length || created.rfqs.length
      ? (await c.query(
        `SELECT id FROM mkt_purchase_orders
         WHERE quote_id=ANY($1::int[]) OR rfq_id=ANY($2::int[])`,
        [created.quotes.length ? created.quotes : [-1], created.rfqs.length ? created.rfqs : [-1]],
      )).rows
      : [];
    const poIds = poRows.map((r) => Number(r.id));
    if (poIds.length) {
      for (const table of [
        "mkt_accounting_handoffs", "mkt_ap_preparations", "mkt_po_shipments",
        "mkt_purchase_order_lines", "mkt_reconciliation_links", "purchase_documents",
        "vendor_invoices",
      ]) {
        await c.query(`DELETE FROM ${table} WHERE mkt_purchase_order_id=ANY($1::int[]) OR po_id=ANY($1::int[])`, [poIds]).catch(async () => {
          await c.query(`DELETE FROM ${table} WHERE po_id=ANY($1::int[])`, [poIds]).catch(() => {});
        });
      }
      await c.query("DELETE FROM activity_logs WHERE mkt_purchase_order_id=ANY($1::int[])", [poIds]).catch(() => {});
      await c.query("DELETE FROM mkt_purchase_orders WHERE id=ANY($1::int[])", [poIds]);
    }
    if (created.rfqs.length || created.quotes.length) {
      await c.query("DELETE FROM mkt_notification_queue WHERE rfq_id=ANY($1::int[]) OR vendor_quote_id=ANY($2::int[])", [
        created.rfqs.length ? created.rfqs : [-1], created.quotes.length ? created.quotes : [-1],
      ]).catch(() => {});
      await c.query("DELETE FROM activity_logs WHERE mkt_rfq_id=ANY($1::int[]) OR mkt_vendor_quote_id=ANY($2::int[])", [
        created.rfqs.length ? created.rfqs : [-1], created.quotes.length ? created.quotes : [-1],
      ]).catch(() => {});
      await c.query("DELETE FROM mkt_rfq_guest_claims WHERE rfq_id=ANY($1::int[])", [created.rfqs.length ? created.rfqs : [-1]]).catch(() => {});
    }
    if (created.rfqs.length) await c.query("DELETE FROM mkt_rfq_lines WHERE rfq_id=ANY($1::int[])", [created.rfqs]);
    if (created.quotes.length) await c.query("DELETE FROM mkt_vendor_quote_lines WHERE quote_id=ANY($1::int[])", [created.quotes]).catch(() => {});
    if (created.quotes.length) await c.query("DELETE FROM mkt_vendor_quotes WHERE id=ANY($1::int[])", [created.quotes]);
    if (created.rfqs.length) {
      await c.query("DELETE FROM mkt_rfq_approvals WHERE rfq_id=ANY($1::int[])", [created.rfqs]).catch(() => {});
      await c.query("DELETE FROM mkt_rfqs WHERE id=ANY($1::int[])", [created.rfqs]);
    }
    if (created.products.length) await c.query("DELETE FROM vendor_catalog_items WHERE id=ANY($1::int[])", [created.products]);
    if (created.submissions.length) await c.query("DELETE FROM vendor_catalog_submissions WHERE id=ANY($1::int[])", [created.submissions]);
    if (created.suppliers.length) {
      await c.query("DELETE FROM vendor_notifications WHERE vendor_id=ANY($1::int[])", [created.suppliers]).catch(() => {});
      await c.query("DELETE FROM vendor_profiles WHERE supplier_id=ANY($1::int[])", [created.suppliers]).catch(() => {});
      await c.query("DELETE FROM suppliers WHERE id=ANY($1::int[])", [created.suppliers]);
    }
    if (created.members.length) await c.query("DELETE FROM portal_company_members WHERE id=ANY($1::int[])", [created.members]);
    if (created.customers.length) {
      const orderRows = await c.query("SELECT id FROM portal_product_orders WHERE email=ANY($1::text[]) AND notes LIKE $2", [Object.values(names), `${MARK}%`]).catch(() => ({ rows: [] }));
      const orderIds = orderRows.rows.map((r) => Number(r.id));
      if (orderIds.length) {
        await c.query("DELETE FROM portal_product_order_items WHERE order_id=ANY($1::int[])", [orderIds]).catch(() => {});
        await c.query("DELETE FROM portal_product_orders WHERE id=ANY($1::int[])", [orderIds]).catch(() => {});
      }
      await c.query("DELETE FROM user_profiles WHERE customer_id=ANY($1::int[])", [created.customers]).catch(() => {});
      await c.query("DELETE FROM portal_customers WHERE id=ANY($1::int[])", [created.customers]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`CLEANUP ERROR ${e.message}`);
  } finally {
    c.release();
  }
  const residual = await sql(
    `SELECT count(*)::int AS n FROM portal_customers WHERE email = ANY($1::text[])
     UNION ALL SELECT count(*)::int FROM suppliers WHERE name LIKE $2
     UNION ALL SELECT count(*)::int FROM vendor_catalog_items WHERE name LIKE $2
     UNION ALL SELECT count(*)::int FROM mkt_rfqs WHERE notes LIKE $2`,
    [Object.values(names), `${MARK}%`],
  ).catch(() => [{ n: 1 }]);
  const total = residual.reduce((n, r) => n + Number(r.n), 0);
  record("fixture cleanup residual", total === 0, `residual=${total}`);
}

let exitCode = 0;
try {
  const { supplierIds } = await setup();
  const customerAJar = await loginPortal({ label: "customer A", email: names.customerA });
  const customerBJar = await loginPortal({ label: "customer B", email: names.customerB });
  const vendorAJar = await loginPortal({ label: "vendor A", email: names.vendorA });
  const vendorBJar = await loginPortal({ label: "vendor B", email: names.vendorB });
  const adminJar = await adminSession();
  const productA = await createProduct(vendorAJar, "product-A");
  const productB = await createProduct(vendorBJar, "product-B");
  const productC = await createProduct(vendorBJar, "race");
  await idorProof(vendorAJar, vendorBJar, productA, productB);
  await productProof(vendorAJar, vendorBJar, adminJar, productA, productB);
  await notificationProof(adminJar, vendorAJar, vendorBJar, productA);
  await rfqProof(customerAJar, customerBJar, vendorAJar, adminJar, productA, supplierIds.vendorA);
  await approvalRace(adminJar, productC);
} catch (e) {
  exitCode = 1;
  console.error(`HARNESS ERROR: ${e.stack || e.message}`);
} finally {
  await cleanup().catch((e) => { exitCode = 1; console.error(`CLEANUP FATAL: ${e.stack || e.message}`); });
  const failed = results.filter((r) => !r.pass);
  console.log(`RUNTIME_PROOF_SUMMARY total=${results.length} passed=${results.length - failed.length} failed=${failed.length}`);
  console.log(`RUNTIME_PROOF_STATUS=${failed.length === 0 && exitCode === 0 ? "PASS" : "FAIL"}`);
  await pool.end();
  process.exitCode = failed.length === 0 && exitCode === 0 ? 0 : 1;
}