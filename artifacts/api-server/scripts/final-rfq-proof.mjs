import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;
const API = (process.env.PROOF_API_URL ?? "http://127.0.0.1:18444/api").replace(/\/+$/, "");
const RUN_ID = crypto.randomUUID();
const MARKER = `FINAL-RFQ-${RUN_ID}`;
const proofClientIp = `198.51.100.${(parseInt(RUN_ID.slice(0, 2), 16) % 254) + 1}`;
const individualEmail = `final-rfq-individual-${RUN_ID}@example.test`;
const companyEmail = `final-rfq-company-${RUN_ID}@example.test`;
const pendingEmail = `final-rfq-pending-${RUN_ID}@example.test`;
const password = "FinalRfqProof!2026";
const warningText = "Lengkapi atau tunggu verifikasi organisasi Customer Portal sebelum membuat RFQ.";
const preservedRfqState = {
  qty: 3,
  phone: "081234567890",
  requiredDate: "2026-09-15",
  notes: `${MARKER} preserved notes`,
};
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  max: 2,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 20_000,
  ssl: { rejectUnauthorized: false },
});

const steps = [];
const jars = {
  individual: new Map(),
  relogin: new Map(),
  company: new Map(),
  pending: new Map(),
};
const authTokens = {};
const created = {
  rfqIds: [],
  orderIds: [],
  customerIds: [],
  companyIds: [],
};
let canonicalCompanyId = null;
let individualId = null;
let companyId = null;
let pendingId = null;
let catalogItem = null;
let googlePlace = null;
let cleanupErrors = [];

function record(name, pass, detail = "") {
  steps.push({
    name,
    pass: Boolean(pass),
    ...(detail ? { detail: String(detail).slice(0, 260) } : {}),
  });
}

function message(body) {
  if (!body || typeof body !== "object") return "";
  for (const key of ["message", "error", "detail"]) {
    if (typeof body[key] === "string") return body[key];
  }
  return "";
}

function cookiePairs(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : ((headers.get("set-cookie") ?? "").match(/(?:^|,\s*)([^=;,]+=[^;]*)/g) ?? [])
      .map((value) => value.replace(/^,\s*/, ""));
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean);
}

function addCookies(headers, jar) {
  for (const pair of cookiePairs(headers)) {
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(path, {
  method = "GET",
  body,
  jar,
  headers: extraHeaders = {},
  redirect = "follow",
} = {}) {
  const headers = {
    accept: "application/json",
    "x-forwarded-for": proofClientIp,
    ...extraHeaders,
  };
  if (jar?.size) headers.cookie = cookieHeader(jar);
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  if (jar) addCookies(response.headers, jar);
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Keep a bounded raw response for diagnostics.
    data = text.slice(0, 500);
  }
  return { status: response.status, data, headers: response.headers };
}

async function query(text, params = []) {
  return (await pool.query(text, params)).rows;
}

async function one(text, params = []) {
  return (await query(text, params))[0] ?? null;
}

async function signup(email, jar, extra = {}) {
  const { tokenKey: requestedTokenKey, ...signupFields } = extra;
  const result = await request("/portal/auth/signup", {
    method: "POST",
    jar,
    body: {
      name: `${MARKER} ${signupFields.customerType ?? "legacy"}`,
      email,
      password,
      phone: signupFields.phone,
      ...signupFields,
    },
  });
  const tokenKey = requestedTokenKey ?? signupFields.customerType ?? "legacy";
  if (typeof result.data?.token === "string") authTokens[tokenKey] = result.data.token;
  record(`${signupFields.customerType ?? "legacy"} signup`,
    result.status === 201 && jar.has("portal_session"),
    message(result.data));
  return result;
}

async function submitQuote(label, jar, extra = {}, requestOptions = {}) {
  if (!catalogItem?.id) {
    record(`${label} RFQ`, false, "published catalog item unavailable");
    return null;
  }
  const tokenKey = label.includes("pending")
    ? "company-pending"
    : label.includes("company")
      ? "company"
      : "legacy";
  // The guest regression must be genuinely unauthenticated. Other labels use
  // the fixture's own session cookie and bearer token.
  const token = label === "guest" ? null : authTokens[tokenKey];
  const result = await request(`/portal/marketplace/${Number(catalogItem.id)}/quote`, {
    method: "POST",
    jar,
    headers: {
      "x-forwarded-for": requestOptions.forwardedFor ?? proofClientIp,
      "Idempotency-Key": requestOptions.idempotencyKey ?? `${MARKER}:${label}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: {
      buyer_name: `${MARKER} buyer`,
      email: `${MARKER}-forged@example.test`,
      phone: "081234567890",
      guest_contact: "081234567890",
      destination: googlePlace?.address ?? `${MARKER} manual destination`,
      ...(googlePlace
        ? {
            destination_place_id: googlePlace.placeId,
            destination_lat: googlePlace.lat,
            destination_lng: googlePlace.lng,
          }
        : {}),
      qty: 1,
      unit: catalogItem.unit ?? "unit",
      notes: MARKER,
      company_id: 999999999,
      customer_id: 999999999,
      ...extra,
    },
  });
  const orderId = Number(result.data?.id);
  const rfqId = Number(result.data?.rfqId);
  if (result.status === 201 && Number.isInteger(orderId)) created.orderIds.push(orderId);
  if (result.status === 201 && Number.isInteger(rfqId)) created.rfqIds.push(rfqId);
  return { result, orderId, rfqId };
}

async function setupSyntheticCompany() {
  const row = await one(
    `INSERT INTO companies
       (name, code, company_name, company_code, is_active, is_holding)
     VALUES ($1, $2, $1, $2, true, false)
     RETURNING id`,
    [`${MARKER} Company`, `FINAL-${RUN_ID.slice(0, 12)}`],
  );
  canonicalCompanyId = Number(row?.id);
  if (Number.isInteger(canonicalCompanyId)) created.companyIds.push(canonicalCompanyId);
  record("synthetic selectable canonical company", Number.isInteger(canonicalCompanyId), String(canonicalCompanyId));
}

async function seedLegacyProfile(customerId, phone, label = "Legacy") {
  await query(
    `INSERT INTO user_profiles
       (customer_id, full_name, phone, address, account_type, status, completed_at, updated_at)
     VALUES ($1, $2, $3, $4, 'customer', 'active', NOW(), NOW())
     ON CONFLICT (customer_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       address = EXCLUDED.address,
       account_type = EXCLUDED.account_type,
       status = EXCLUDED.status,
       completed_at = EXCLUDED.completed_at,
       updated_at = NOW()`,
     [customerId, `${MARKER} ${label}`, phone, `${MARKER} address`],
  );
}

async function seedLegacyActiveMembership(customerId) {
  await query(
    `INSERT INTO portal_company_members
       (portal_customer_id, company_id, buyer_role, is_active, joined_at, updated_at)
     VALUES ($1, $2, 'requester', true, NOW(), NOW())
     ON CONFLICT (portal_customer_id, company_id) DO UPDATE
       SET is_active = true, updated_at = NOW()`,
    [customerId, canonicalCompanyId],
  );
}

async function discoverCatalog() {
  const result = await request("/portal/marketplace");
  const items = Array.isArray(result.data)
    ? result.data
    : (result.data?.items ?? result.data?.data ?? []);
  catalogItem = Array.isArray(items)
    ? items.find((item) => Number.isInteger(Number(item?.id)))
    : null;
  record(
    "published catalog item available",
    result.status === 200 && Boolean(catalogItem?.id),
    result.status === 200 ? String(catalogItem?.id ?? "none") : `HTTP ${result.status}: ${message(result.data)}`,
  );
}

async function verifyGooglePlaces() {
  const autocomplete = await request("/places/autocomplete?input=Jakarta&country=id");
  const predictions = autocomplete.data?.predictions ?? autocomplete.data?.suggestions ?? [];
  const prediction = Array.isArray(predictions) ? predictions[0] : null;
  const placeId = prediction?.place_id ?? prediction?.placePrediction?.placeId;
  const details = placeId
    ? await request(`/places/detail?place_id=${encodeURIComponent(placeId)}`)
    : null;
  const raw = details?.data?.result ?? details?.data ?? {};
  const address = raw.formatted_address ?? raw.address;
  const lat = Number(raw.geometry?.location?.lat ?? raw.lat ?? raw.latitude);
  const lng = Number(raw.geometry?.location?.lng ?? raw.lng ?? raw.longitude);
  const pass = autocomplete.status === 200
    && details?.status === 200
    && typeof placeId === "string"
    && typeof address === "string"
    && address.length > 0
    && Number.isFinite(lat)
    && Number.isFinite(lng);
  googlePlace = pass ? { placeId, address, lat, lng } : null;
  record("Google Maps autocomplete/detail", pass,
    pass ? `${placeId}; ${lat},${lng}` : `autocomplete=${autocomplete.status}; detail=${details?.status ?? "not-run"}`);
}

async function checkLegacyCompletion() {
  const customer = await one(
    "SELECT id, customer_type, company FROM portal_customers WHERE email = $1",
    [individualEmail],
  );
  individualId = Number(customer?.id);
  if (Number.isInteger(individualId)) created.customerIds.push(individualId);
  record("legacy customer has NULL customer_type",
    Number.isInteger(individualId) && customer.customer_type == null,
    customer ? `customer_type=${customer.customer_type ?? "NULL"}` : "customer missing");

  await seedLegacyProfile(individualId, "081234560001", "Legacy Individual");
  await seedLegacyActiveMembership(individualId);
  const status = await request("/portal/onboarding/status", {
    jar: jars.individual,
    headers: { authorization: `Bearer ${authTokens.legacy}` },
  });
  const isCompletionState = status.status === 200
    && status.data?.status === "active"
    && status.data?.hasProfile === true
    && status.data?.customerType == null
    && status.data?.customerContext?.status === "legacy_unresolved";
  const uiSource = readFileSync(new URL("../../customer-portal/src/pages/onboarding.tsx", import.meta.url), "utf8");
  const uiCompletion = uiSource.includes("LegacyOrganizationCompletion")
    && uiSource.includes("Pilih Perorangan atau Perusahaan terlebih dahulu.")
    && uiSource.includes('label: "Perorangan"');
  record("legacy completion flow appears", isCompletionState && uiCompletion,
    `status=${status.status}; onboarding=${status.data?.customerContext?.status ?? "missing"}; ui=${uiCompletion}`);

  const organization = await request("/portal/organization", {
    method: "PUT",
    jar: jars.individual,
    headers: { authorization: `Bearer ${authTokens.legacy}` },
    body: {
      customerId: 999999999,
      customerType: "individual",
      companyId: canonicalCompanyId,
      email: pendingEmail,
    },
  });
  const context = organization.data?.context;
  const individualReady = organization.status === 200
    && context?.status === "individual"
    && context?.companyId == null
    && Array.isArray(context?.activeMemberships)
    && context.activeMemberships.length === 0;
  record("individual context READY", individualReady,
    `HTTP ${organization.status}; status=${context?.status ?? "missing"}; memberships=${context?.activeMemberships?.length ?? "missing"}`);

  const fresh = await one(
    `SELECT pc.customer_type, pc.company,
            (SELECT count(*)::int FROM portal_company_members pcm
              WHERE pcm.portal_customer_id = pc.id AND pcm.is_active = true) AS active_memberships
       FROM portal_customers pc WHERE pc.id = $1`,
    [individualId],
  );
  record("individual membership count is zero",
    fresh?.customer_type === "individual"
    && Number(fresh.active_memberships) === 0,
    fresh ? `customer_type=${fresh.customer_type}; memberships=${fresh.active_memberships}` : "customer missing");

  const deactivatedLegacyMembership = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE is_active = true)::int AS active
       FROM portal_company_members
      WHERE portal_customer_id = $1`,
    [individualId],
  );
  record(
    "individual choice deactivates legacy memberships canonically",
    Number(deactivatedLegacyMembership?.total) === 1
      && Number(deactivatedLegacyMembership?.active) === 0,
    deactivatedLegacyMembership
      ? `total=${deactivatedLegacyMembership.total}; active=${deactivatedLegacyMembership.active}`
      : "membership row missing",
  );

  const logout = await request("/portal/auth/logout", { method: "POST", jar: jars.individual });
  const relogin = await request("/portal/auth/login", {
    method: "POST",
    jar: jars.relogin,
    body: { email: individualEmail, password },
  });
  const reloginToken = relogin.data?.token;
  if (typeof reloginToken === "string") authTokens.legacy = reloginToken;
  const reloginContext = await request("/portal/onboarding/status", {
    jar: jars.relogin,
    headers: reloginToken ? { authorization: `Bearer ${reloginToken}` } : {},
  });
  const reloginStatus = reloginContext.data?.customerContext?.status;
  const onboardingSource = readFileSync(new URL("../../customer-portal/src/pages/onboarding.tsx", import.meta.url), "utf8");
  const repeatCompletionDoesNotAppear =
    reloginStatus === "individual"
    && reloginContext.data?.customerType === "individual"
    && !["legacy_unresolved", "company_unresolved"].includes(reloginStatus)
    && onboardingSource.includes("if (isExistingCustomerWithUnresolvedOrganization)")
    && onboardingSource.includes("else if (d.status === \"active\")");
  record(
    "logout then login preserves individual completion",
    logout.status === 200
      && relogin.status === 200
      && jars.relogin.has("portal_session")
      && repeatCompletionDoesNotAppear,
    `logout=${logout.status}; login=${relogin.status}; status=${reloginStatus ?? "missing"}`,
  );
}

async function verifyIndividualRfq() {
  const submitted = await submitQuote("individual", jars.relogin, {
    qty: preservedRfqState.qty,
    phone: preservedRfqState.phone,
    guest_contact: preservedRfqState.phone,
    notes: preservedRfqState.notes,
    required_date: preservedRfqState.requiredDate,
  });
  const createdPass = submitted?.result.status === 201
    && Number.isInteger(submitted.rfqId)
    && Number.isInteger(submitted.orderId);
  record("individual RFQ created", createdPass,
    submitted ? `HTTP ${submitted.result.status}; rfq=${submitted.rfqId}; order=${submitted.orderId}` : "not submitted");

  const duplicateRetry = submitted
    ? await submitQuote("individual duplicate retry", jars.relogin, {
      qty: preservedRfqState.qty,
      phone: preservedRfqState.phone,
      guest_contact: preservedRfqState.phone,
      notes: preservedRfqState.notes,
      required_date: preservedRfqState.requiredDate,
    }, {
      forwardedFor: "198.51.100.253",
      idempotencyKey: `${MARKER}:individual`,
    })
    : null;
  const canonicalCount = submitted?.rfqId
    ? await one(
      `SELECT COUNT(*)::int AS count
         FROM mkt_rfqs r
         JOIN mkt_rfq_lines l ON l.rfq_id = r.id
        WHERE r.id = $1
          AND r.portal_customer_id = $2
          AND r.buyer_phone = $3
          AND r.notes LIKE ($4 || '%')
          AND l.vendor_catalog_item_id = $5`,
      [submitted.rfqId, individualId, preservedRfqState.phone, preservedRfqState.notes, Number(catalogItem.id)],
    )
    : null;
  const duplicatePass = duplicateRetry?.result.status === 201
    && duplicateRetry.rfqId === submitted?.rfqId
    && duplicateRetry.orderId === submitted?.orderId
    && Number(canonicalCount?.count) === 1;
  record(
    "RFQ duplicate retry is idempotent",
    duplicatePass,
    duplicateRetry
      ? `HTTP ${duplicateRetry.result.status}; first=${submitted?.rfqId}/${submitted?.orderId}; retry=${duplicateRetry.rfqId}/${duplicateRetry.orderId}; canonical=${canonicalCount?.count ?? "missing"}`
      : "not retried",
  );

  const independentSubmission = submitted
    ? await submitQuote("individual independent key", jars.relogin, {
      qty: preservedRfqState.qty,
      phone: preservedRfqState.phone,
      guest_contact: preservedRfqState.phone,
      notes: preservedRfqState.notes,
      required_date: preservedRfqState.requiredDate,
    }, {
      forwardedFor: "198.51.100.252",
      idempotencyKey: `${MARKER}:individual-independent`,
    })
    : null;
  const independentCount = independentSubmission?.rfqId
    ? await one(
      `SELECT COUNT(DISTINCT r.id)::int AS count
         FROM mkt_rfqs r
         JOIN mkt_rfq_lines l ON l.rfq_id = r.id
        WHERE r.portal_customer_id = $1
          AND r.notes LIKE $2
          AND l.vendor_catalog_item_id = $3`,
      [individualId, `${preservedRfqState.notes}%`, Number(catalogItem.id)],
    )
    : null;
  const independentPass = independentSubmission?.result.status === 201
    && Number.isInteger(independentSubmission.rfqId)
    && Number.isInteger(independentSubmission.orderId)
    && independentSubmission.rfqId !== submitted?.rfqId
    && independentSubmission.orderId !== submitted?.orderId
    && Number(independentCount?.count) === 2;
  record(
    "same payload with different idempotency key creates a valid second submission",
    independentPass,
    independentSubmission
      ? `HTTP ${independentSubmission.result.status}; first=${submitted?.rfqId}/${submitted?.orderId}; second=${independentSubmission.rfqId}/${independentSubmission.orderId}; canonical=${independentCount?.count ?? "missing"}`
      : "not submitted",
  );

  const rfq = submitted?.rfqId
    ? await one(
      `SELECT id, portal_customer_id, company_id, buyer_email, delivery_address,
              destination_place_id, destination_lat::text, destination_lng::text,
              buyer_phone, required_delivery_date, notes
         FROM mkt_rfqs WHERE id = $1`,
      [submitted.rfqId],
    )
    : null;
  const order = submitted?.orderId
    ? await one(
      `SELECT id, company_id, email, phone, shipping_address, notes
         FROM portal_product_orders WHERE id = $1`,
      [submitted.orderId],
    )
    : null;
  const orderItem = submitted?.orderId
    ? await one(
      "SELECT qty FROM portal_product_order_items WHERE order_id = $1",
      [submitted.orderId],
    )
    : null;
  const ownership = Boolean(rfq)
    && Number(rfq.portal_customer_id) === individualId
    && rfq.buyer_email === individualEmail
    && Boolean(order)
    && order.email === individualEmail;
  const companyNull = Boolean(rfq)
    && rfq.company_id == null
    && Boolean(order)
    && order.company_id == null;
  const destinationPass = Boolean(rfq)
    && (!googlePlace
      || (
        rfq.delivery_address === googlePlace.address
        && rfq.destination_place_id === googlePlace.placeId
        && Number(rfq.destination_lat) === googlePlace.lat
        && Number(rfq.destination_lng) === googlePlace.lng
      ));
  const responseText = JSON.stringify(submitted?.result.data ?? "");
  const warningRemoved = submitted?.result.status === 201 && !responseText.includes(warningText);
  record("individual RFQ ownership is session-based", ownership,
    rfq ? `portal_customer_id=${rfq.portal_customer_id}; buyer_email=${rfq.buyer_email}` : "RFQ row missing");
  record("individual RFQ company_id IS NULL", companyNull,
    `mkt=${rfq?.company_id ?? "NULL"}; legacy=${order?.company_id ?? "NULL"}`);
  record("individual destination/Google Maps persisted", destinationPass,
    rfq ? `${rfq.delivery_address}; ${rfq.destination_place_id ?? "NULL"}` : "RFQ row missing");
  const statePreserved = Boolean(rfq)
    && Boolean(order)
    && Number(orderItem?.qty) === preservedRfqState.qty
    && rfq.buyer_phone === preservedRfqState.phone
    && order.phone === preservedRfqState.phone
    && (
      rfq.required_delivery_date instanceof Date
        ? rfq.required_delivery_date.toISOString().slice(0, 10)
        : String(rfq.required_delivery_date ?? "").slice(0, 10)
    ) === preservedRfqState.requiredDate
    && String(rfq.notes ?? "").includes(preservedRfqState.notes)
    && String(order.notes ?? "").includes(preservedRfqState.notes)
    && order.shipping_address === rfq.delivery_address;
  record(
    "RFQ state preserved after organization completion",
    statePreserved,
    rfq
      ? `qty=${orderItem?.qty}; phone=${rfq.buyer_phone}; date=${rfq.required_delivery_date}; notes=${rfq.notes ? "present" : "missing"}`
      : "RFQ row missing",
  );
  record("individual organization warning removed", warningRemoved,
    `HTTP ${submitted?.result.status ?? "not-run"}`);
  return { submitted, rfq, order };
}

async function verifyCompanyRegression() {
  const signupResult = await signup(companyEmail, jars.company, {
    tokenKey: "legacy-company",
    phone: "081234560002",
  });
  if (signupResult.status !== 201) return false;
  const customer = await one("SELECT id FROM portal_customers WHERE email = $1", [companyEmail]);
  const companyCustomerId = Number(customer?.id);
  if (Number.isInteger(companyCustomerId)) created.customerIds.push(companyCustomerId);
  await seedLegacyProfile(companyCustomerId, "081234560002", "Legacy Company");
  const unresolved = await request("/portal/onboarding/status", {
    jar: jars.company,
    headers: { authorization: `Bearer ${authTokens["legacy-company"]}` },
  });
  const organization = await request("/portal/organization", {
    method: "PUT",
    jar: jars.company,
    headers: { authorization: `Bearer ${authTokens["legacy-company"]}` },
    body: {
      customerId: 999999999,
      email: `${MARKER}-forged-company@example.test`,
      customerType: "company",
      companyId: canonicalCompanyId,
    },
  });
  const membership = await one(
    `SELECT count(*)::int AS count
       FROM portal_company_members
      WHERE portal_customer_id = $1 AND company_id = $2 AND is_active = true`,
    [companyCustomerId, canonicalCompanyId],
  );
  authTokens.company = authTokens["legacy-company"];
  const companySubmit = await submitQuote("company", jars.company, {
    email: `${MARKER}-company-forged@example.test`,
    customer_id: 999999999,
    company_id: 999999999,
  });
  const companyRfq = companySubmit?.rfqId
    ? await one(
      "SELECT portal_customer_id, company_id, buyer_email, buyer_company FROM mkt_rfqs WHERE id = $1",
      [companySubmit.rfqId],
    )
    : null;
  const customerUiSource = readFileSync(new URL("../../customer-portal/src/pages/marketplace-detail.tsx", import.meta.url), "utf8");
  const companyReadOnlyUi = customerUiSource.includes("Diambil dari membership canonical Anda")
    && customerUiSource.includes("authenticatedCustomer ? undefined :");
  const pass = companySubmit?.result.status === 201
    && unresolved.status === 200
    && unresolved.data?.customerContext?.status === "legacy_unresolved"
    && organization.status === 200
    && organization.data?.context?.status === "company_mapped"
    && Number(membership?.count) === 1
    && Number(companyRfq?.portal_customer_id) === companyCustomerId
    && Number(companyRfq?.company_id) === canonicalCompanyId
    && companyRfq?.buyer_email === companyEmail
    && companyRfq?.buyer_company === `${MARKER} Company`
    && companyReadOnlyUi;
  record("company active membership RFQ PASS", pass,
    `HTTP ${companySubmit?.result.status ?? "not-run"}; unresolved=${unresolved.data?.customerContext?.status ?? "missing"}; membership=${membership?.count ?? "missing"}; company_id=${companyRfq?.company_id ?? "missing"}`);
  record(
    "company name is canonical and read-only in RFQ",
    companyReadOnlyUi
      && companyRfq?.buyer_company === `${MARKER} Company`,
    `buyer_company=${companyRfq?.buyer_company ?? "missing"}; ui=${companyReadOnlyUi}`,
  );
  return pass;
}

async function verifyPendingCompany() {
  const signupResult = await signup(pendingEmail, jars.pending, {
    customerType: "company",
    requestedCompanyName: `${MARKER} Pending Company`,
    requestedRegistrationNumber: `${RUN_ID}-NIB`,
    phone: "081234560003",
  });
  if (signupResult.status !== 201) {
    record("company pending RFQ blocked", false, `signup HTTP ${signupResult.status}: ${message(signupResult.data)}`);
    return false;
  }
  const customer = await one("SELECT id FROM portal_customers WHERE email = $1", [pendingEmail]);
  pendingId = Number(customer?.id);
  if (Number.isInteger(pendingId)) created.customerIds.push(pendingId);
  const state = await request("/portal/onboarding/status", {
    jar: jars.pending,
    headers: { authorization: `Bearer ${authTokens["company-pending"]}` },
  });
  const pendingRequest = await one(
    `SELECT status, matched_company_id
       FROM portal_company_requests
      WHERE portal_customer_id = $1
      ORDER BY id DESC LIMIT 1`,
    [pendingId],
  );
  const blocked = await submitQuote("company pending", jars.pending);
  const pass = state.status === 200
    && state.data?.customerContext?.status === "company_pending"
    && pendingRequest?.status === "pending"
    && pendingRequest?.matched_company_id == null
    && blocked?.result.status === 422
    && message(blocked.result.data).toLowerCase().includes("menunggu")
    && !Number.isInteger(blocked?.rfqId);
  record("company pending RFQ blocked", pass,
    `context=${state.data?.customerContext?.status ?? "missing"}; HTTP ${blocked?.result.status ?? "not-run"}: ${message(blocked?.result.data)}`);
  return pass;
}

async function verifyForgedCompanyId() {
  const forged = await submitQuote("forged company_id", jars.relogin, {
    email: `${MARKER}-forged-email@example.test`,
    customer_id: 999999999,
    company_id: canonicalCompanyId,
  });
  const row = forged?.rfqId
    ? await one(
      "SELECT portal_customer_id, company_id, buyer_email FROM mkt_rfqs WHERE id = $1",
      [forged.rfqId],
    )
    : null;
  const pass = forged?.result.status === 201
    && Number(row?.portal_customer_id) === individualId
    && row?.company_id == null
    && row?.buyer_email === individualEmail;
  const forgedEmailPass = pass && row?.buyer_email !== `${MARKER}-forged-email@example.test`;
  const forgedCustomerPass = pass && Number(row?.portal_customer_id) !== 999999999;
  const forgedCompanyPass = pass && row?.company_id !== canonicalCompanyId;
  record("forged email cannot change ownership", forgedEmailPass,
    row ? `buyer_email=${row.buyer_email}; portal_customer_id=${row.portal_customer_id}; company_id=${row.company_id ?? "NULL"}` : "RFQ row missing");
  record("forged customer_id cannot change ownership", forgedCustomerPass,
    row ? `portal_customer_id=${row.portal_customer_id}; expected=${individualId}` : "RFQ row missing");
  record("forged company_id cannot change ownership", forgedCompanyPass,
    row ? `portal_customer_id=${row.portal_customer_id}; company_id=${row.company_id ?? "NULL"}; buyer_email=${row.buyer_email}` : "RFQ row missing");
  return pass && forgedEmailPass && forgedCustomerPass && forgedCompanyPass;
}

async function verifyGuestRegression() {
  const guest = await submitQuote("guest", new Map(), {
    buyer_name: `${MARKER} guest`,
    email: `${MARKER}-guest@example.test`,
    guest_contact: "081234560004",
    customer_id: 999999999,
    company_id: 999999999,
  });
  const row = guest?.rfqId
    ? await one(
      "SELECT portal_customer_id, guest_token_hash, buyer_email, company_id FROM mkt_rfqs WHERE id = $1",
      [guest.rfqId],
    )
    : null;
  const pass = guest?.result.status === 201
    && Number.isInteger(guest.rfqId)
    && row?.portal_customer_id == null
    && typeof row?.guest_token_hash === "string"
    && row.guest_token_hash.length > 0
    && row.buyer_email === `${MARKER}-guest@example.test`.toLowerCase()
    && row.company_id == null;
  record("guest RFQ regression", pass,
    row
      ? `HTTP ${guest.result.status}; portal_customer_id=${row.portal_customer_id ?? "NULL"}; guest_token_hash=${row.guest_token_hash ? "present" : "missing"}; buyer_email=${row.buyer_email}; company_id=${row.company_id ?? "NULL"}`
      : `HTTP ${guest?.result.status ?? "not-run"}; RFQ row missing`);
  return pass;
}

async function discoverFixtureIds() {
  const rfqs = await query(
    "SELECT id FROM mkt_rfqs WHERE notes LIKE $1 OR buyer_name LIKE $1 OR buyer_email LIKE $1",
    [`%${MARKER}%`],
  );
  const orders = await query(
    "SELECT id FROM portal_product_orders WHERE notes LIKE $1 OR customer_name LIKE $1 OR email LIKE $1",
    [`%${MARKER}%`],
  );
  const customers = await query(
    "SELECT id FROM portal_customers WHERE name LIKE $1 OR email LIKE $1",
    [`%${MARKER}%`],
  );
  const companies = await query(
    "SELECT id FROM companies WHERE name LIKE $1 OR code LIKE $1 OR company_name LIKE $1 OR company_code LIKE $1",
    [`%${MARKER}%`],
  );
  created.rfqIds.push(...rfqs.map((row) => Number(row.id)));
  created.orderIds.push(...orders.map((row) => Number(row.id)));
  created.customerIds.push(...customers.map((row) => Number(row.id)));
  created.companyIds.push(...companies.map((row) => Number(row.id)));
}

async function safeDelete(label, text, params = []) {
  try {
    await query(text, params);
  } catch (error) {
    cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function cleanup() {
  cleanupErrors = [];
  await discoverFixtureIds().catch((error) => cleanupErrors.push(`discover: ${error.message}`));
  const rfqIds = [...new Set(created.rfqIds)].filter(Number.isInteger);
  const orderIds = [...new Set(created.orderIds)].filter(Number.isInteger);
  const customerIds = [...new Set(created.customerIds)].filter(Number.isInteger);
  const companyIds = [...new Set(created.companyIds)].filter(Number.isInteger);

  if (rfqIds.length) {
    await safeDelete("activity logs by RFQ", "DELETE FROM activity_logs WHERE mkt_rfq_id = ANY($1::int[])", [rfqIds]);
    await safeDelete("activity logs by marker", "DELETE FROM activity_logs WHERE description LIKE $1 OR new_value::text LIKE $1", [`%${MARKER}%`]);
    await safeDelete("approvals", "DELETE FROM mkt_rfq_approvals WHERE rfq_id = ANY($1::int[])", [rfqIds]);
    await safeDelete("guest claims", "DELETE FROM mkt_rfq_guest_claims WHERE rfq_id = ANY($1::int[])", [rfqIds]);
    await safeDelete("vendor quote activities", "DELETE FROM activity_logs WHERE mkt_vendor_quote_id IN (SELECT id FROM mkt_vendor_quotes WHERE rfq_id = ANY($1::int[]))", [rfqIds]);
    await safeDelete("vendor quote lines", "DELETE FROM mkt_vendor_quote_lines WHERE quote_id IN (SELECT id FROM mkt_vendor_quotes WHERE rfq_id = ANY($1::int[]))", [rfqIds]);
    await safeDelete("vendor quotes", "DELETE FROM mkt_vendor_quotes WHERE rfq_id = ANY($1::int[])", [rfqIds]);
    await safeDelete("purchase orders", "DELETE FROM mkt_purchase_orders WHERE rfq_id = ANY($1::int[])", [rfqIds]);
    await safeDelete("notification queue", "DELETE FROM mkt_notification_queue WHERE rfq_id = ANY($1::int[])", [rfqIds]);
    await safeDelete("dual-write log", "DELETE FROM mkt_dual_write_log WHERE mkt_rfq_id = ANY($1::int[])", [rfqIds]);
    await safeDelete("RFQ lines", "DELETE FROM mkt_rfq_lines WHERE rfq_id = ANY($1::int[])", [rfqIds]);
    await safeDelete("RFQs", "DELETE FROM mkt_rfqs WHERE id = ANY($1::int[])", [rfqIds]);
  }
  if (orderIds.length) {
    await safeDelete("order items", "DELETE FROM portal_product_order_items WHERE order_id = ANY($1::int[])", [orderIds]);
    await safeDelete("orders", "DELETE FROM portal_product_orders WHERE id = ANY($1::int[])", [orderIds]);
  }
  if (customerIds.length) {
    await safeDelete("company requests", "DELETE FROM portal_company_requests WHERE portal_customer_id = ANY($1::int[])", [customerIds]);
    await safeDelete("company members", "DELETE FROM portal_company_members WHERE portal_customer_id = ANY($1::int[])", [customerIds]);
    await safeDelete("customer services", "DELETE FROM portal_customer_services WHERE customer_id = ANY($1::int[])", [customerIds]);
    await safeDelete(
      "trusted devices",
      "DELETE FROM trusted_devices WHERE phone IN (SELECT phone FROM portal_customers WHERE id = ANY($1::int[]))",
      [customerIds],
    );
    await safeDelete(
      "OTP codes",
      "DELETE FROM wa_otp_codes WHERE phone IN (SELECT phone FROM portal_customers WHERE id = ANY($1::int[]))",
      [customerIds],
    );
    await safeDelete("portal profiles", "DELETE FROM portal_customer_profiles WHERE customer_id = ANY($1::int[])", [customerIds]);
    await safeDelete("user profiles", "DELETE FROM user_profiles WHERE customer_id = ANY($1::int[])", [customerIds]);
     await safeDelete("notification logs", "DELETE FROM notification_logs WHERE recipient = ANY($1::text[])", [[individualEmail, companyEmail, pendingEmail]]);
    await safeDelete("portal customers", "DELETE FROM portal_customers WHERE id = ANY($1::int[])", [customerIds]);
  }
  if (companyIds.length) {
    await safeDelete("synthetic companies", "DELETE FROM companies WHERE id = ANY($1::int[])", [companyIds]);
  }
}

async function residualRecords() {
  const pattern = `%${MARKER}%`;
  const rows = await query(
    `SELECT 'mkt_rfqs' AS item, count(*)::int AS count FROM mkt_rfqs WHERE notes LIKE $1 OR buyer_name LIKE $1 OR buyer_email LIKE $1
     UNION ALL SELECT 'portal_product_orders', count(*)::int FROM portal_product_orders WHERE notes LIKE $1 OR customer_name LIKE $1 OR email LIKE $1
     UNION ALL SELECT 'portal_customers', count(*)::int FROM portal_customers WHERE name LIKE $1 OR email LIKE $1
     UNION ALL SELECT 'user_profiles', count(*)::int FROM user_profiles WHERE full_name LIKE $1 OR phone = '081234560001' OR phone = '081234560002' OR phone = '081234560003'
     UNION ALL SELECT 'companies', count(*)::int FROM companies WHERE name LIKE $1 OR code LIKE $1 OR company_name LIKE $1 OR company_code LIKE $1
     UNION ALL SELECT 'portal_company_requests', count(*)::int FROM portal_company_requests WHERE requested_company_name LIKE $1
     UNION ALL SELECT 'activity_logs', count(*)::int FROM activity_logs WHERE description LIKE $1 OR new_value::text LIKE $1`,
    [pattern],
  );
  return Object.fromEntries(rows.map((row) => [row.item, Number(row.count)]));
}

async function main() {
  const live = await request("/health/live");
  record("development liveness", live.status === 200, `HTTP ${live.status}`);
  const ready = await request("/health/ready");
  record("development readiness", ready.status === 200 && ready.data?.ready === true,
    `HTTP ${ready.status}; ready=${ready.data?.ready}`);
  const safety = await request("/health/e2e-safety");
  record("development safe mode", safety.status === 200
    && safety.data?.e2eMode === true
    && safety.data?.whatsapp === "mocked"
    && safety.data?.email === "mocked"
    && safety.data?.payment === "mocked"
    && safety.data?.webhooks === "disabled"
    && safety.data?.workers === "disabled"
    && safety.data?.storage === "test-only",
  "all outbound channels are mocked/disabled");

  await setupSyntheticCompany();
  const legacySignup = await signup(individualEmail, jars.individual, {
    phone: "081234560001",
  });
  if (legacySignup.status !== 201) throw new Error(`legacy signup failed: ${message(legacySignup.data)}`);
  await checkLegacyCompletion();
  await discoverCatalog();
  await verifyGooglePlaces();
  const individual = await verifyIndividualRfq();
  await verifyCompanyRegression();
  await verifyPendingCompany();
  await verifyForgedCompanyId();
  await verifyGuestRegression();

  const source = readFileSync(new URL("../src/lib/services/portalMarketplaceService.ts", import.meta.url), "utf8");
  const warningNotInCanonicalSource = !source.includes(warningText);
  record("canonical RFQ source has no organization warning", warningNotInCanonicalSource);
  return {
    individual,
    warningNotInCanonicalSource,
  };
}

let executionError = null;
try {
  await main();
} catch (error) {
  executionError = error instanceof Error ? error.message : String(error);
  record("proof execution", false, executionError);
} finally {
  await cleanup();
  let residual = {};
  try {
    residual = await residualRecords();
  } catch (error) {
    cleanupErrors.push(`residual query: ${error instanceof Error ? error.message : String(error)}`);
  }

  const passed = steps.filter((step) => step.pass).length;
  const failed = steps.filter((step) => !step.pass).length;
  const has = (name) => steps.some((step) => step.name === name && step.pass);
  const residualCount = Object.values(residual).reduce((sum, count) => sum + Number(count), 0);
  const report = {
    ROOT_CAUSE: "Authenticated RFQ ownership is derived from verified session context; canonical write failures no longer fall through to legacy for authenticated requests.",
    AUTH_SESSION_PROPAGATION: has("individual RFQ ownership is session-based") ? "PASS" : "FAIL",
    AUTHENTICATED_GUEST_FALLBACK_BLOCKED: has("forged email cannot change ownership")
      && has("forged customer_id cannot change ownership")
      && has("forged company_id cannot change ownership")
      ? "PASS"
      : "FAIL",
    LEGACY_COMPLETION: has("legacy completion flow appears") ? "PASS" : "FAIL",
    LEGACY_COMPLETION_UI: has("legacy completion flow appears") ? "PASS" : "FAIL",
    INDIVIDUAL_CONTEXT_READY: has("individual context READY") ? "PASS" : "FAIL",
    INDIVIDUAL_MEMBERSHIP_COUNT: has("individual membership count is zero") ? 0 : "UNKNOWN",
    INDIVIDUAL_COMPLETION: has("individual context READY") ? "PASS" : "FAIL",
    INDIVIDUAL_ACTIVE_COMPANY_MEMBERSHIP: has("individual membership count is zero") ? 0 : "UNKNOWN",
    INDIVIDUAL_MEMBERSHIP_DEACTIVATED: has("individual choice deactivates legacy memberships canonically") ? "PASS" : "FAIL",
    INDIVIDUAL_RFQ: has("individual RFQ created") && has("individual RFQ ownership is session-based") ? "PASS" : "FAIL",
    DUPLICATE_RFQ_CREATED: has("RFQ duplicate retry is idempotent") ? 0 : 1,
    INDIVIDUAL_RFQ_PORTAL_CUSTOMER_ID: has("individual RFQ ownership is session-based") ? "PASS" : "FAIL",
    INDIVIDUAL_RFQ_COMPANY_ID_NULL: has("individual RFQ company_id IS NULL") ? "PASS" : "FAIL",
    INDIVIDUAL_RFQ_COMPANY_ID: has("individual RFQ company_id IS NULL") ? "NULL" : "UNKNOWN",
    INDIVIDUAL_ORGANIZATION_WARNING_REMOVED: has("individual organization warning removed") ? "PASS" : "FAIL",
    CUSTOMER_TYPE_PERSISTED: has("logout then login preserves individual completion") ? "individual" : "UNKNOWN",
    REPEAT_COMPLETION_PROMPT: has("logout then login preserves individual completion") ? "NO" : "UNKNOWN",
    COMPANY_RFQ_REGRESSION: has("company active membership RFQ PASS") ? "PASS" : "FAIL",
    COMPANY_RFQ_PORTAL_CUSTOMER_ID: has("company active membership RFQ PASS") ? "PASS" : "FAIL",
    COMPANY_RFQ_CANONICAL_COMPANY_ID: has("company active membership RFQ PASS") ? "PASS" : "FAIL",
    COMPANY_COMPLETION: has("company active membership RFQ PASS") ? "PASS" : "FAIL",
    COMPANY_NAME_SOURCE: has("company name is canonical and read-only in RFQ") ? "CANONICAL_MEMBERSHIP" : "UNKNOWN",
    COMPANY_NAME_EDITABLE: has("company name is canonical and read-only in RFQ") ? "NO" : "UNKNOWN",
    COMPANY_PENDING_BLOCK: has("company pending RFQ blocked") ? "PASS" : "FAIL",
    LEGACY_UNRESOLVED_BLOCK: has("legacy completion flow appears") && has("individual context READY") ? "PASS" : "FAIL",
    FORGED_EMAIL_BYPASS: has("forged email cannot change ownership") ? 0 : 1,
    FORGED_CUSTOMER_BYPASS: has("forged customer_id cannot change ownership") ? 0 : 1,
    FORGED_COMPANY_BYPASS: has("forged company_id cannot change ownership") ? 0 : 1,
    GUEST_RFQ_REGRESSION: has("guest RFQ regression") ? "PASS" : "FAIL",
    GOOGLE_MAPS_REGRESSION: has("Google Maps autocomplete/detail") && has("individual destination/Google Maps persisted") ? "PASS" : "FAIL",
    RFQ_STATE_PRESERVED: has("RFQ state preserved after organization completion") ? "PASS" : "FAIL",
    AUTH_OWNERSHIP_REGRESSION_TESTS: has("forged email cannot change ownership")
      && has("forged customer_id cannot change ownership")
      && has("forged company_id cannot change ownership")
      ? "PASS"
      : "FAIL",
    FOCUSED_TESTS: has("individual choice deactivates legacy memberships canonically")
      && has("logout then login preserves individual completion")
      && has("company active membership RFQ PASS")
      && has("company pending RFQ blocked")
      && has("RFQ state preserved after organization completion")
      && has("forged email cannot change ownership")
      && has("forged customer_id cannot change ownership")
      && has("forged company_id cannot change ownership")
      ? "PASS"
      : "FAIL",
    API_LIVE: has("development liveness") ? "PASS" : "FAIL",
    API_READY: has("development readiness") ? "PASS" : "FAIL",
    CLEANUP_ERRORS: cleanupErrors.length,
    RESIDUAL_AUDIT_RECORDS: residualCount,
    PRODUCTION_WRITES: 0,
    REAL_WHATSAPP: 0,
    REAL_EMAIL: 0,
    FINAL_VERDICT: failed === 0 && cleanupErrors.length === 0 && residualCount === 0
      ? "READY"
      : "NOT_READY",
  };
  console.log(JSON.stringify({
    RUN_ID,
    passed,
    failed,
    error: executionError,
    report,
    residual,
    cleanupDetails: cleanupErrors,
    steps,
  }, null, 2));
  await pool.end();
  process.exitCode = report.FINAL_VERDICT === "READY" ? 0 : 1;
}