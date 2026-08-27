import crypto from "node:crypto";
import pg from "pg";

const API = process.env.PROOF_API_URL ?? "http://127.0.0.1:18444";
const RUN = `maps-rfq-proof-${Date.now()}`;
const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  max: 3,
  ssl: { rejectUnauthorized: false },
});
const created = {
  rfqIds: [],
  orderIds: [],
  customerIds: [],
  companyIds: [],
  membershipIds: [],
  devCustomerId: null,
  devCustomerType: null,
  devCustomerCompany: null,
};
let requestIpCounter = 20;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function query(text, params = []) {
  return (await pool.query(text, params)).rows;
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.authorization ? { authorization: `Bearer ${options.authorization}` } : {}),
      ...(options.forwardedFor ? { "x-forwarded-for": options.forwardedFor } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: response.status, data, headers: response.headers };
}

function cookiesFrom(headers) {
  const values = headers.getSetCookie?.() ?? [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function signDevToken(payload) {
  const secret = process.env.DEV_PORTAL_SECRET ?? "cst-dev-portal-fallback-2025";
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  return `devportal.${encoded}.${signature}`;
}

async function login(role = "customer") {
  const result = await request("/api/portal/auth/dev-login", {
    method: "POST",
    body: { role },
  });
  assert(result.status === 200, `dev-login ${role} failed: HTTP ${result.status}`);
  const cookie = cookiesFrom(result.headers);
  assert(cookie.includes("portal_session="), `dev-login ${role} did not set session cookie`);
  return { cookie, profile: result.data.profile };
}

async function expectStatus(label, result, status) {
  assert(result.status === status, `${label}: expected HTTP ${status}, got ${result.status} ${JSON.stringify(result.data)}`);
}

async function submit(itemId, auth, destination, extra = {}) {
  const forwardedFor = `198.51.100.${requestIpCounter++}`;
  return request(`/api/portal/marketplace/${itemId}/quote`, {
    method: "POST",
    cookie: auth.cookie,
    authorization: auth.token,
    forwardedFor,
    body: {
      buyer_name: `${RUN} buyer`,
      email: `${RUN}@example.test`,
      phone: "081234567890",
      destination,
      required_date: "2026-09-15",
      quantity: 2,
      notes: RUN,
      ...extra,
    },
  });
}

async function setupFixtures() {
  const dev = await query(
    "SELECT id, customer_type, company FROM portal_customers WHERE email = $1",
    ["dev-customer@dev.local"],
  );
  assert(dev.length === 1, "dev customer row not found");
  created.devCustomerId = dev[0].id;
  created.devCustomerType = dev[0].customer_type;
  created.devCustomerCompany = dev[0].company;
  await query(
    "UPDATE portal_customers SET customer_type = 'individual' WHERE id = $1",
    [created.devCustomerId],
  );

  const company = await query(
    "INSERT INTO companies (company_name, company_code, is_active) VALUES ($1, $2, true) RETURNING id",
    [`${RUN} Company`, `QA-MAPS-${Date.now()}-${process.pid}`],
  );
  created.companyIds.push(company[0].id);

  const customer = await query(
    `INSERT INTO portal_customers
      (name, email, password_hash, company, customer_type, role)
     VALUES ($1, $2, '', $3, 'company', 'customer')
     RETURNING id, email`,
    [`${RUN} Company Buyer`, `${RUN}-company@example.test`, `${RUN} Company`],
  );
  created.customerIds.push(customer[0].id);

  const membership = await query(
    `INSERT INTO portal_company_members
      (portal_customer_id, company_id, buyer_role, department, cost_center, approval_level, is_active, joined_at)
     VALUES ($1, $2, 'procurement', 'QA', $3, 1, true, NOW())
     RETURNING id`,
    [customer[0].id, company[0].id, `${RUN}-CC`],
  );
  created.membershipIds.push(membership[0].id);

  const other = await query(
    `INSERT INTO portal_customers
      (name, email, password_hash, customer_type, role)
     VALUES ($1, $2, '', 'individual', 'customer')
     RETURNING id, email`,
    [`${RUN} Other Buyer`, `${RUN}-other@example.test`],
  );
  created.customerIds.push(other[0].id);

  return {
    dev,
    companyId: company[0].id,
    companyCustomer: customer[0],
    otherCustomer: other[0],
  };
}

async function cleanup() {
  const errors = [];
  const ids = [...new Set(created.rfqIds)];
  const orderIds = [...new Set(created.orderIds)];
  const customerIds = [...new Set(created.customerIds)];
  const companyIds = [...new Set(created.companyIds)];
  const membershipIds = [...new Set(created.membershipIds)];

  async function safe(label, text, params = []) {
    try {
      await query(text, params);
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }

  if (ids.length) {
    await safe("activity logs", "DELETE FROM activity_logs WHERE mkt_rfq_id = ANY($1::int[])", [ids]);
    await safe("rfq approvals", "DELETE FROM mkt_rfq_approvals WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("guest claims", "DELETE FROM mkt_rfq_guest_claims WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("vendor quotes", "DELETE FROM mkt_vendor_quotes WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("purchase orders", "DELETE FROM mkt_purchase_orders WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("rfq lines", "DELETE FROM mkt_rfq_lines WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("dual write logs", "DELETE FROM mkt_dual_write_log WHERE mkt_rfq_id = ANY($1::int[])", [ids]);
    await safe("rfqs", "DELETE FROM mkt_rfqs WHERE id = ANY($1::int[])", [ids]);
  }
  if (orderIds.length) {
    await safe("order items", "DELETE FROM portal_product_order_items WHERE order_id = ANY($1::int[])", [orderIds]);
    await safe("orders", "DELETE FROM portal_product_orders WHERE id = ANY($1::int[])", [orderIds]);
  }
  if (membershipIds.length) {
    await safe("memberships", "DELETE FROM portal_company_members WHERE id = ANY($1::int[])", [membershipIds]);
  }
  if (customerIds.length) {
    await safe("user profiles", "DELETE FROM user_profiles WHERE customer_id = ANY($1::int[])", [customerIds]);
    await safe("customers", "DELETE FROM portal_customers WHERE id = ANY($1::int[])", [customerIds]);
  }
  if (companyIds.length) {
    await safe("companies", "DELETE FROM companies WHERE id = ANY($1::int[])", [companyIds]);
  }
  if (created.devCustomerId != null) {
    await safe(
      "restore dev customer",
      "UPDATE portal_customers SET customer_type = $1, company = $2 WHERE id = $3",
      [created.devCustomerType, created.devCustomerCompany, created.devCustomerId],
    );
  }
  return errors;
}

async function main() {
  const fixtures = await setupFixtures();
  const individual = await login("customer");
  assert(individual.profile.id === created.devCustomerId, "individual session id mismatch");
  const companyToken = signDevToken({
    id: fixtures.companyCustomer.id,
    email: fixtures.companyCustomer.email,
    role: "customer",
    exp: Date.now() + 60 * 60 * 1000,
  });
  const company = { token: companyToken, cookie: "" };
  const otherToken = signDevToken({
    id: fixtures.otherCustomer.id,
    email: fixtures.otherCustomer.email,
    role: "customer",
    exp: Date.now() + 60 * 60 * 1000,
  });
  const other = { token: otherToken, cookie: "" };

  const list = await request("/api/portal/marketplace");
  expectStatus("marketplace catalog", list, 200);
  const item = (Array.isArray(list.data) ? list.data : list.data.items ?? []).find((entry) => entry?.id != null && entry?.name);
  assert(item, "no published marketplace catalog item available");
  const detail = await request(`/api/portal/marketplace/${item.id}`);
  expectStatus("marketplace item detail", detail, 200);

  const autocomplete = await request("/api/places/autocomplete?input=Jakarta&country=id");
  expectStatus("Google autocomplete", autocomplete, 200);
  const predictions = autocomplete.data.predictions ?? autocomplete.data.suggestions ?? [];
  assert(predictions.length > 0, "Google autocomplete returned no suggestions");
  const placeId = predictions[0].place_id ?? predictions[0].placePrediction?.placeId;
  assert(placeId, "autocomplete suggestion has no place_id");
  const place = await request(`/api/places/detail?place_id=${encodeURIComponent(placeId)}`);
  expectStatus("Google place detail", place, 200);
  const placeData = place.data.result ?? place.data;
  const address = placeData.formatted_address ?? placeData.address;
  const lat = Number(placeData.geometry?.location?.lat ?? placeData.lat ?? placeData.latitude);
  const lng = Number(placeData.geometry?.location?.lng ?? placeData.lng ?? placeData.longitude);
  assert(address && Number.isFinite(lat) && Number.isFinite(lng), "Google place detail missing address/coordinates");

  const invalidLat = await submit(item.id, individual, address, {
    destination_place_id: placeId,
    destination_lat: 91,
    destination_lng: lng,
  });
  expectStatus("invalid latitude", invalidLat, 400);
  const forgedPlace = await submit(item.id, individual, address, {
    destination_place_id: placeId,
    destination_lat: 0,
    destination_lng: 0,
  });
  expectStatus("forged place coordinates", forgedPlace, 400);

  const google = await submit(item.id, individual, address, {
    destination_place_id: placeId,
    destination_lat: lat,
    destination_lng: lng,
    company_id: fixtures.companyId,
  });
  expectStatus("individual Google RFQ", google, 201);
  assert(google.data.rfqId, `Google RFQ did not return rfqId: ${JSON.stringify(google.data)}`);
  created.rfqIds.push(Number(google.data.rfqId));
  if (google.data.id) created.orderIds.push(Number(google.data.id));

  const manualAddress = `${RUN} Manual Address, Jakarta`;
  const manual = await submit(item.id, individual, manualAddress, {
    company_id: fixtures.companyId,
  });
  expectStatus("individual manual RFQ", manual, 201);
  assert(manual.data.rfqId, `manual RFQ did not return rfqId: ${JSON.stringify(manual.data)}`);
  created.rfqIds.push(Number(manual.data.rfqId));
  if (manual.data.id) created.orderIds.push(Number(manual.data.id));

  const companyRfq = await submit(item.id, company, `${RUN} Company Address`, {
    company_id: 999999999,
  });
  expectStatus("company RFQ", companyRfq, 201);
  assert(companyRfq.data.rfqId, `company RFQ did not return rfqId: ${JSON.stringify(companyRfq.data)}`);
  created.rfqIds.push(Number(companyRfq.data.rfqId));
  if (companyRfq.data.id) created.orderIds.push(Number(companyRfq.data.id));

  const googleRow = (await query(
    `SELECT id, portal_customer_id, company_id, delivery_address, destination_place_id,
            destination_lat::text, destination_lng::text, buyer_company
       FROM mkt_rfqs WHERE id = $1`,
    [google.data.rfqId],
  ))[0];
  const manualRow = (await query(
    `SELECT id, portal_customer_id, company_id, delivery_address, destination_place_id,
            destination_lat::text, destination_lng::text
       FROM mkt_rfqs WHERE id = $1`,
    [manual.data.rfqId],
  ))[0];
  const companyRow = (await query(
    `SELECT id, portal_customer_id, company_id, delivery_address, buyer_role
       FROM mkt_rfqs WHERE id = $1`,
    [companyRfq.data.rfqId],
  ))[0];
  assert(googleRow, "Google RFQ missing on DB re-query");
  assert(manualRow, "manual RFQ missing on DB re-query");
  assert(companyRow, "company RFQ missing on DB re-query");
  assert(Number(googleRow.portal_customer_id) === individual.profile.id, "Google RFQ session owner mismatch");
  assert(googleRow.company_id == null, "forged company_id bypassed individual ownership");
  assert(googleRow.delivery_address === address, "Google canonical address mismatch");
  assert(googleRow.destination_place_id === placeId, "Google place_id not persisted");
  assert(Number(googleRow.destination_lat) === lat && Number(googleRow.destination_lng) === lng, "Google coordinates mismatch");
  assert(Number(manualRow.portal_customer_id) === individual.profile.id, "manual RFQ session owner mismatch");
  assert(manualRow.company_id == null, "forged company_id bypassed manual individual ownership");
  assert(manualRow.delivery_address === manualAddress, "manual canonical address mismatch");
  assert(manualRow.destination_place_id == null && manualRow.destination_lat == null && manualRow.destination_lng == null, "manual RFQ has unexpected Google metadata");
  assert(Number(companyRow.portal_customer_id) === fixtures.companyCustomer.id, "company RFQ session owner mismatch");
  assert(Number(companyRow.company_id) === fixtures.companyId, "company context did not come from membership");
  assert(companyRow.buyer_role === "procurement", "company buyer role snapshot mismatch");

  const individualDetail = await request(`/api/mkt/portal/rfqs/${google.data.rfqId}`, { cookie: individual.cookie });
  expectStatus("individual RFQ detail", individualDetail, 200);
  const crossCustomerDetail = await request(`/api/mkt/portal/rfqs/${google.data.rfqId}`, { authorization: other.token });
  assert([403, 404].includes(crossCustomerDetail.status), `cross-customer detail bypass: HTTP ${crossCustomerDetail.status}`);
  const crossCompanyDetail = await request(`/api/mkt/portal/rfqs/${google.data.rfqId}`, { authorization: company.token });
  assert([403, 404].includes(crossCompanyDetail.status), `cross-company detail bypass: HTTP ${crossCompanyDetail.status}`);

  console.log(JSON.stringify({
    PASS: true,
    itemId: item.id,
    googlePlace: { placeId, lat, lng },
    invalidValidation: { invalidLat: invalidLat.status, forgedPlace: forgedPlace.status },
    rfqs: {
      individualGoogle: { id: googleRow.id, metadata: true, companyId: googleRow.company_id },
      individualManual: { id: manualRow.id, metadataNull: true, companyId: manualRow.company_id },
      company: { id: companyRow.id, companyId: companyRow.company_id, buyerRole: companyRow.buyer_role },
    },
    ownership: {
      sessionOwner: true,
      forgedCompanyIdBypass: false,
      crossCustomerBypass: false,
      crossCompanyBypass: false,
    },
  }));
}

let cleanupErrors = [];
try {
  await main();
} catch (error) {
  console.error(JSON.stringify({ PASS: false, error: error.message }));
  process.exitCode = 1;
} finally {
  cleanupErrors = await cleanup();
  console.log(JSON.stringify({ CLEANUP_ERRORS: cleanupErrors.length, cleanupDetails: cleanupErrors }));
  await pool.end();
}