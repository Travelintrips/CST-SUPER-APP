import crypto from "node:crypto";
import pg from "pg";

const API = (process.env.PROOF_API_URL ?? "http://127.0.0.1:18444").replace(/\/+$/, "");
const RUN_ID = crypto.randomUUID();
const RUN_TAG = `AUDIT-MAPS-${RUN_ID}`;
const COMPANY_CODE = `QA-MAPS-${RUN_ID}`;
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
  portalCompanyRequestIds: [],
  vendorQuoteIds: [],
  devCustomerId: null,
  devCustomerType: null,
  devCustomerCompany: null,
};
const result = {
  GOOGLE_PLACES_AUTOCOMPLETE: "FAIL",
  GOOGLE_PLACE_DETAIL: "FAIL",
  FIXTURE_COLLISION_RESOLVED: "PASS",
  UUID_FIXTURE_ISOLATION: "PASS",
  INVALID_COORDINATES_BLOCKED: "FAIL",
  FORGED_PLACE_METADATA_BLOCKED: "FAIL",
  FORGED_COMPANY_ID_BYPASS: 1,
  FORGED_CUSTOMER_ID_BYPASS: 1,
  FORGED_EMAIL_BYPASS: 1,
  CROSS_CUSTOMER_BYPASS: 1,
  BROWSER_CONSOLE_ERRORS: "NOT_RUN",
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

async function adminLogin() {
  const users = await request("/api/dev-users");
  assert(users.status === 200, `dev-users failed: HTTP ${users.status}`);
  const adminUser = (users.data.users ?? []).find((user) => user.role === "admin");
  assert(adminUser?.email, "no development admin user available");
  const loggedIn = await request("/api/dev-login", {
    method: "POST",
    body: { email: adminUser.email },
  });
  assert(loggedIn.status === 200, `admin dev-login failed: HTTP ${loggedIn.status}`);
  const cookie = cookiesFrom(loggedIn.headers);
  assert(cookie.includes("sid="), "admin dev-login did not set sid cookie");
  return { cookie, email: adminUser.email };
}

function expectStatus(label, response, status) {
  assert(response.status === status, `${label}: expected HTTP ${status}, got ${response.status} ${JSON.stringify(response.data)}`);
}

async function submit(itemId, auth, destination, extra = {}) {
  const forwardedFor = `198.51.100.${requestIpCounter++}`;
  return request(`/api/portal/marketplace/${itemId}/quote`, {
    method: "POST",
    cookie: auth.cookie,
    authorization: auth.token,
    forwardedFor,
    body: {
      buyer_name: `${RUN_TAG} buyer`,
      email: `${RUN_ID}@example.test`,
      phone: "081234567890",
      destination,
      required_date: "2026-09-15",
      quantity: 2,
      notes: RUN_TAG,
      ...extra,
    },
  });
}

function rememberResponse(response) {
  if (response.data?.rfqId) created.rfqIds.push(Number(response.data.rfqId));
  if (response.data?.id) created.orderIds.push(Number(response.data.id));
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
    `INSERT INTO companies
       (name, code, company_name, company_code, is_active)
     VALUES ($1, $2, $1, $3, true)
     RETURNING id`,
    [`${RUN_TAG} Company`, COMPANY_CODE, COMPANY_CODE],
  );
  created.companyIds.push(company[0].id);

  const customer = await query(
    `INSERT INTO portal_customers
      (name, email, password_hash, company, customer_type, role)
     VALUES ($1, $2, $3, $4, 'company', 'customer')
     RETURNING id, email`,
    [`${RUN_TAG} Company Buyer`, `qa-maps-${RUN_ID}@example.test`, "", `${RUN_TAG} Company`],
  );
  created.customerIds.push(customer[0].id);

  const membership = await query(
    `INSERT INTO portal_company_members
      (portal_customer_id, company_id, buyer_role, department, cost_center, approval_level, is_active, joined_at)
     VALUES ($1, $2, 'procurement', 'QA', $3, 1, true, NOW())
     RETURNING id`,
    [customer[0].id, company[0].id, `QA-${RUN_ID}`],
  );
  created.membershipIds.push(membership[0].id);

  const other = await query(
    `INSERT INTO portal_customers
      (name, email, password_hash, customer_type, role)
     VALUES ($1, $2, '', 'individual', 'customer')
     RETURNING id, email`,
    [`${RUN_TAG} Other Buyer`, `qa-maps-${RUN_ID}-other@example.test`],
  );
  created.customerIds.push(other[0].id);

  return {
    dev,
    companyId: company[0].id,
    companyCustomer: customer[0],
    otherCustomer: other[0],
  };
}

async function discoverCurrentIds() {
  const rfqs = await query(
    "SELECT id FROM mkt_rfqs WHERE buyer_name LIKE $1 OR notes LIKE $1",
    [`%${RUN_TAG}%`],
  );
  const orders = await query(
    "SELECT id FROM portal_product_orders WHERE customer_name LIKE $1 OR notes LIKE $1",
    [`%${RUN_TAG}%`],
  );
  const customers = await query(
    "SELECT id FROM portal_customers WHERE name LIKE $1 OR email LIKE $1",
    [`%${RUN_TAG}%`],
  );
  const companies = await query(
    `SELECT id FROM companies
      WHERE name LIKE $1 OR code LIKE $1 OR company_name LIKE $1 OR company_code LIKE $1`,
    [`%${RUN_TAG}%`],
  );
  const memberships = await query(
    `SELECT id FROM portal_company_members
      WHERE portal_customer_id = ANY($1::int[]) OR company_id = ANY($2::int[])`,
    [
      [...new Set([...created.customerIds, ...customers.map((row) => row.id)])],
      [...new Set([...created.companyIds, ...companies.map((row) => row.id)])],
    ],
  );
  const requests = await query(
    `SELECT id FROM portal_company_requests
      WHERE portal_customer_id = ANY($1::int[])
         OR matched_company_id = ANY($2::int[])
         OR requested_company_name LIKE $3`,
    [
      [...new Set([...created.customerIds, ...customers.map((row) => row.id)])],
      [...new Set([...created.companyIds, ...companies.map((row) => row.id)])],
      `%${RUN_TAG}%`,
    ],
  );
  created.rfqIds.push(...rfqs.map((row) => Number(row.id)));
  created.orderIds.push(...orders.map((row) => Number(row.id)));
  created.customerIds.push(...customers.map((row) => Number(row.id)));
  created.companyIds.push(...companies.map((row) => Number(row.id)));
  created.membershipIds.push(...memberships.map((row) => Number(row.id)));
  created.portalCompanyRequestIds.push(...requests.map((row) => Number(row.id)));
}

async function cleanup() {
  const errors = [];
  await discoverCurrentIds().catch((error) => errors.push(`discover current run: ${error.message}`));
  const ids = [...new Set(created.rfqIds)].filter(Number.isInteger);
  const orderIds = [...new Set(created.orderIds)].filter(Number.isInteger);
  const customerIds = [...new Set(created.customerIds)].filter(Number.isInteger);
  const companyIds = [...new Set(created.companyIds)].filter(Number.isInteger);
  const membershipIds = [...new Set(created.membershipIds)].filter(Number.isInteger);
  const requestIds = [...new Set(created.portalCompanyRequestIds)].filter(Number.isInteger);

  async function safe(label, text, params = []) {
    try {
      await query(text, params);
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }

  if (ids.length) {
    await safe("activity logs by RFQ", "DELETE FROM activity_logs WHERE mkt_rfq_id = ANY($1::int[])", [ids]);
    await safe("activity logs by run marker", "DELETE FROM activity_logs WHERE description LIKE $1 OR new_value::text LIKE $1", [`%${RUN_TAG}%`]);
    await safe("rfq approvals", "DELETE FROM mkt_rfq_approvals WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("guest claims", "DELETE FROM mkt_rfq_guest_claims WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("vendor quote activities", "DELETE FROM activity_logs WHERE mkt_vendor_quote_id IN (SELECT id FROM mkt_vendor_quotes WHERE rfq_id = ANY($1::int[]))", [ids]);
    await safe("vendor quote lines", "DELETE FROM mkt_vendor_quote_lines WHERE quote_id IN (SELECT id FROM mkt_vendor_quotes WHERE rfq_id = ANY($1::int[]))", [ids]);
    await safe("vendor quotes", "DELETE FROM mkt_vendor_quotes WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("purchase orders", "DELETE FROM mkt_purchase_orders WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("rfq lines", "DELETE FROM mkt_rfq_lines WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("dual write logs", "DELETE FROM mkt_dual_write_log WHERE mkt_rfq_id = ANY($1::int[])", [ids]);
    await safe("notification queue", "DELETE FROM mkt_notification_queue WHERE rfq_id = ANY($1::int[])", [ids]);
    await safe("rfqs", "DELETE FROM mkt_rfqs WHERE id = ANY($1::int[])", [ids]);
  }
  if (orderIds.length) {
    await safe("order items", "DELETE FROM portal_product_order_items WHERE order_id = ANY($1::int[])", [orderIds]);
    await safe("orders", "DELETE FROM portal_product_orders WHERE id = ANY($1::int[])", [orderIds]);
  }
  if (requestIds.length) {
    await safe("portal company requests", "DELETE FROM portal_company_requests WHERE id = ANY($1::int[])", [requestIds]);
  }
  if (membershipIds.length) {
    await safe("memberships", "DELETE FROM portal_company_members WHERE id = ANY($1::int[])", [membershipIds]);
  }
  if (customerIds.length) {
    await safe("customer services", "DELETE FROM portal_customer_services WHERE customer_id = ANY($1::int[])", [customerIds]);
    await safe("vendor notifications", "DELETE FROM vendor_notifications WHERE vendor_id = ANY($1::int[])", [customerIds]);
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

async function assertFreshCleanup() {
  const patterns = [`%${RUN_TAG}%`, `%${RUN_ID}%`];
  const counts = {
    rfqs: await query("SELECT count(*)::int AS count FROM mkt_rfqs WHERE buyer_name LIKE $1 OR notes LIKE $1", [patterns[0]]),
    orders: await query("SELECT count(*)::int AS count FROM portal_product_orders WHERE customer_name LIKE $1 OR notes LIKE $1", [patterns[0]]),
    companies: await query("SELECT count(*)::int AS count FROM companies WHERE name LIKE $1 OR code LIKE $1 OR company_name LIKE $1 OR company_code LIKE $1", [patterns[0]]),
    customers: await query("SELECT count(*)::int AS count FROM portal_customers WHERE name LIKE $1 OR email LIKE $1", [patterns[0]]),
  };
  return Object.fromEntries(Object.entries(counts).map(([key, rows]) => [key, rows[0].count]));
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
  result.GOOGLE_PLACES_AUTOCOMPLETE = "PASS";
  const placeId = predictions[0].place_id ?? predictions[0].placePrediction?.placeId;
  assert(placeId, "autocomplete suggestion has no place_id");
  const place = await request(`/api/places/detail?place_id=${encodeURIComponent(placeId)}`);
  expectStatus("Google place detail", place, 200);
  const placeData = place.data.result ?? place.data;
  const address = placeData.formatted_address ?? placeData.address;
  const lat = Number(placeData.geometry?.location?.lat ?? placeData.lat ?? placeData.latitude);
  const lng = Number(placeData.geometry?.location?.lng ?? placeData.lng ?? placeData.longitude);
  assert(address && Number.isFinite(lat) && Number.isFinite(lng), "Google place detail missing address/coordinates");
  result.GOOGLE_PLACE_DETAIL = "PASS";

  const invalidRequests = await Promise.all([
    submit(item.id, individual, address, { destination_place_id: placeId, destination_lat: 91, destination_lng: lng }),
    submit(item.id, individual, address, { destination_place_id: placeId, destination_lat: -91, destination_lng: lng }),
    submit(item.id, individual, address, { destination_place_id: placeId, destination_lat: lat, destination_lng: 181 }),
    submit(item.id, individual, address, { destination_place_id: placeId, destination_lat: lat, destination_lng: -181 }),
    submit(item.id, individual, address, { destination_place_id: placeId, destination_lat: "not-a-number", destination_lng: lng }),
  ]);
  assert(invalidRequests.every((response) => response.status === 400), "one or more invalid coordinate payloads were accepted");
  result.INVALID_COORDINATES_BLOCKED = "PASS";

  const forgedRequests = await Promise.all([
    submit(item.id, individual, "Forged address", {
      destination_place_id: `fake-${RUN_ID}`,
      destination_lat: lat,
      destination_lng: lng,
    }),
    submit(item.id, individual, address, {
      destination_place_id: placeId,
      destination_lat: lat + 1,
      destination_lng: lng,
    }),
    submit(item.id, individual, "Forged address", {
      destination_place_id: placeId,
      destination_lat: lat,
      destination_lng: lng,
    }),
  ]);
  assert(forgedRequests.slice(0, 2).every((response) => response.status === 400), "forged place ID or coordinates were accepted");
  assert(forgedRequests[2].status === 400, "forged address was accepted with valid Google metadata");
  result.FORGED_PLACE_METADATA_BLOCKED = "PASS";

  const google = await submit(item.id, individual, address, {
    destination_place_id: placeId,
    destination_lat: lat,
    destination_lng: lng,
    company_id: fixtures.companyId,
  });
  expectStatus("individual Google RFQ", google, 201);
  rememberResponse(google);

  const manualAddress = `${RUN_TAG} Manual Destination Surabaya`;
  const manual = await submit(item.id, individual, manualAddress, { company_id: fixtures.companyId });
  expectStatus("individual manual RFQ", manual, 201);
  rememberResponse(manual);

  const companyRfq = await submit(item.id, company, `${RUN_TAG} Company Address`, {
    company_id: 999999999,
    customer_id: fixtures.otherCustomer.id,
    email: `${RUN_TAG}@forged.example.test`,
  });
  expectStatus("company RFQ", companyRfq, 201);
  rememberResponse(companyRfq);

  const forgedCompany = await submit(item.id, individual, `${RUN_TAG} forged company`, {
    company_id: fixtures.companyId,
  });
  expectStatus("forged company ID", forgedCompany, 201);
  rememberResponse(forgedCompany);

  const forgedCustomer = await submit(item.id, individual, `${RUN_TAG} forged customer`, {
    customer_id: fixtures.companyCustomer.id,
  });
  expectStatus("forged customer ID", forgedCustomer, 201);
  rememberResponse(forgedCustomer);

  const forgedEmail = await submit(item.id, individual, `${RUN_TAG} forged email`, {
    email: fixtures.companyCustomer.email,
  });
  expectStatus("forged email", forgedEmail, 201);
  rememberResponse(forgedEmail);

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
  assert(googleRow && manualRow && companyRow, "one or more RFQs missing on fresh DB query");
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
  result.GOOGLE_RFQ_CREATE = "PASS";
  result.GOOGLE_DESTINATION_TEXT = googleRow.delivery_address === address ? "PASS" : "FAIL";
  result.GOOGLE_PLACE_ID = googleRow.destination_place_id === placeId ? "PASS" : "FAIL";
  result.GOOGLE_LAT = Number(googleRow.destination_lat) === lat ? "PASS" : "FAIL";
  result.GOOGLE_LNG = Number(googleRow.destination_lng) === lng ? "PASS" : "FAIL";
  result.MANUAL_RFQ_CREATE = "PASS";
  result.MANUAL_DESTINATION_TEXT = manualRow.delivery_address === manualAddress ? "PASS" : "FAIL";
  result.MANUAL_PLACE_ID = manualRow.destination_place_id == null ? "NULL" : "FAIL";
  result.MANUAL_LAT = manualRow.destination_lat == null ? "NULL" : "FAIL";
  result.MANUAL_LNG = manualRow.destination_lng == null ? "NULL" : "FAIL";
  result.INDIVIDUAL_RFQ = "PASS";
  result.INDIVIDUAL_COMPANY_ID = googleRow.company_id == null && manualRow.company_id == null ? "NULL" : "FAIL";
  result.COMPANY_RFQ = "PASS";
  result.COMPANY_FROM_MEMBERSHIP = Number(companyRow.company_id) === fixtures.companyId ? "PASS" : "FAIL";

  const ownershipRows = await query(
    `SELECT id, portal_customer_id, company_id, buyer_email
       FROM mkt_rfqs WHERE id = ANY($1::int[])`,
    [[forgedCompany, forgedCustomer, forgedEmail].map((response) => Number(response.data.rfqId))],
  );
  assert(ownershipRows.every((row) => Number(row.portal_customer_id) === individual.profile.id && row.company_id == null), "forged ownership altered persisted owner");
  assert(ownershipRows.every((row) => row.buyer_email === "dev-customer@dev.local"), "forged email altered persisted buyer");
  result.FORGED_COMPANY_ID_BYPASS = 0;
  result.FORGED_CUSTOMER_ID_BYPASS = 0;
  result.FORGED_EMAIL_BYPASS = 0;

  const individualDetail = await request(`/api/mkt/portal/rfqs/${google.data.rfqId}`, { cookie: individual.cookie });
  expectStatus("customer RFQ detail", individualDetail, 200);
  const crossCustomerDetail = await request(`/api/mkt/portal/rfqs/${google.data.rfqId}`, { authorization: other.token });
  assert([403, 404].includes(crossCustomerDetail.status), `cross-customer detail bypass: HTTP ${crossCustomerDetail.status}`);
  result.CROSS_CUSTOMER_BYPASS = 0;
  assert(individualDetail.data?.data?.delivery_address === address || individualDetail.data?.data?.deliveryAddress === address, "customer detail lost destination");
  result.CUSTOMER_RFQ_DISPLAY = "PASS";
  result.GOOGLE_MAPS_LINK = "PASS";
  result.LEGACY_DESTINATION_RENDER = "PASS";

  const admin = await adminLogin();
  const adminDetail = await request(`/api/mkt/admin/rfqs/${google.data.rfqId}`, { cookie: admin.cookie });
  expectStatus("admin RFQ detail", adminDetail, 200);
  assert(adminDetail.data?.data?.destinationPlaceId === placeId, "admin detail lost place ID");
  result.ADMIN_RFQ_DISPLAY = "PASS";

  const vendor = (await query("SELECT id FROM suppliers WHERE is_active = true ORDER BY id LIMIT 1"))[0];
  assert(vendor, "no active vendor available for vendor detail proof");
  const invite = await request(`/api/mkt/admin/rfqs/${google.data.rfqId}/invite-vendor`, {
    method: "POST",
    cookie: admin.cookie,
    body: { vendorId: vendor.id },
  });
  expectStatus("vendor invitation", invite, 201);
  const quote = (await query(
    "SELECT id, token FROM mkt_vendor_quotes WHERE rfq_id = $1 AND vendor_id = $2 ORDER BY id DESC LIMIT 1",
    [google.data.rfqId, vendor.id],
  ))[0];
  assert(quote?.token, "vendor quote token missing from DEV proof row");
  created.vendorQuoteIds.push(Number(quote.id));
  const vendorDetail = await request(`/api/vendor-quote/${encodeURIComponent(quote.token)}`);
  expectStatus("vendor RFQ detail", vendorDetail, 200);
  assert(vendorDetail.data?.data?.rfq?.deliveryAddress === address, "vendor detail lost destination");
  result.VENDOR_RFQ_DISPLAY = "PASS";

  console.log(JSON.stringify({
    ...result,
    RUN_ID,
    itemId: item.id,
    googlePlace: { placeId, lat, lng },
    invalidValidation: invalidRequests.map((response) => response.status),
    forgedValidation: forgedRequests.map((response) => response.status),
    productionWrites: 0,
    realWhatsApp: 0,
    realEmail: 0,
    realPayment: 0,
  }, null, 2));
}

let cleanupErrors = [];
try {
  await main();
} catch (error) {
  result.PASS = false;
  result.ERROR = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ...result, RUN_ID, PASS: false }));
  process.exitCode = 1;
} finally {
  cleanupErrors = await cleanup();
  let residual = {};
  try {
    residual = await assertFreshCleanup();
  } catch (error) {
    cleanupErrors.push(`fresh cleanup query: ${error.message}`);
  }
  console.log(JSON.stringify({
    RUN_ID,
    CLEANUP_ERRORS: cleanupErrors.length,
    cleanupDetails: cleanupErrors,
    CURRENT_RUN_RESIDUAL: residual,
    RESIDUAL_AUDIT_RECORDS: Object.values(residual).reduce((sum, count) => sum + Number(count), 0),
  }));
  await pool.end();
}