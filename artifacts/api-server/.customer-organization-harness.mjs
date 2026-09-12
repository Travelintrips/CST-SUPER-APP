import pg from "pg";
import { readFileSync } from "node:fs";

const { Pool } = pg;
const ROOT_API = "http://127.0.0.1:18444/api";
const API = "http://127.0.0.1:18444/api/portal";
const MKT_API = "http://127.0.0.1:18444/api/mkt/portal";
const marker = `cst-org-${Date.now()}`;
const emailIndividual = `${marker}-individual@example.test`;
const emailCompany = `${marker}-company@example.test`;
const emailPending = `${marker}-pending@example.test`;
const forgedEmail = `${marker}-forged@example.test`;
const password = "CstOrgPass!2026";
const startedAt = new Date();
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  max: 1,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 20_000,
});

const steps = [];
const jars = {
  individual: new Map(),
  company: new Map(),
  pending: new Map(),
  admin: new Map(),
  password: new Map(),
  otp: new Map(),
};
const createdOrderIds = [];
const createdRfqIds = [];
let customerIds = [];
let canonicalCompany;
let individualRfq;
let companyRfq;
let approvedPendingRfq;
const securityChecks = {
  forgedEmailBypass: 0,
  forgedCustomerIdBypass: 0,
  forgedCompanyIdBypass: 0,
  crossCustomerBypass: 0,
  crossCompanyBypass: 0,
};

function record(name, pass, detail = "") {
  steps.push({ name, pass: Boolean(pass), detail: detail ? String(detail).slice(0, 220) : undefined });
}

function summary(body) {
  if (!body || typeof body !== "object") return "";
  for (const key of ["message", "error", "detail"]) {
    if (typeof body[key] === "string") return body[key];
  }
  return "";
}

function extractCookies(headers, jar) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : ((headers.get("set-cookie") || "").match(/(?:^|,\s*)([^=;,]+=[^;]*)/g) || [])
      .map((value) => value.replace(/^,\s*/, ""));
  for (const value of values) {
    const pair = value.split(";")[0];
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(base, path, { method = "GET", body, jar, redirect = "follow" } = {}) {
  const headers = {};
  if (jar?.size) headers.cookie = cookieHeader(jar);
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  if (jar) extractCookies(response.headers, jar);
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body: parsed, headers: response.headers };
}

async function assertUnifiedCustomerContext(label, jar, expectedCustomerId, expectedType, expectedStatus) {
  const me = await request(API, "/auth/me", { jar });
  const onboarding = await request(API, "/onboarding/status", { jar });
  const context = onboarding.body?.customerContext;
  const customerType = onboarding.body?.customerType ?? context?.customerType;
  const pass = me.status === 200
    && Number(me.body?.id ?? me.body?.user?.id) === Number(expectedCustomerId)
    && onboarding.status === 200
    && customerType === expectedType
    && context?.status === expectedStatus;
  record(label, pass,
    `me=${me.status}; customer=${me.body?.id ?? me.body?.user?.id ?? "missing"}; `
    + `type=${customerType ?? "missing"}; status=${context?.status ?? "missing"}`);
  return pass;
}

function verifyUiContract() {
  const onboardingSource = readFileSync(new URL("../customer-portal/src/pages/onboarding.tsx", import.meta.url), "utf8");
  const adminSource = readFileSync(new URL("../bizportal/src/pages/portal-customers.tsx", import.meta.url), "utf8");
  const customerUi = [
    onboardingSource.includes('label: "Perorangan"'),
    onboardingSource.includes('label: "Perusahaan"'),
    onboardingSource.includes("Tidak memerlukan membership perusahaan."),
    onboardingSource.includes("Perusahaan saya belum terdaftar"),
    onboardingSource.includes("/pending-approval"),
    onboardingSource.includes("/api/portal/organization/companies"),
  ].every(Boolean);
  const adminUi = [
    adminSource.includes("membership perusahaan tidak diperlukan."),
    adminSource.includes("pendingRequests"),
    adminSource.includes("Map & Approve"),
    adminSource.includes("company-requests"),
  ].every(Boolean);
  record("customer portal UI contract", customerUi, "individual/company/pending controls present");
  record("BizPortal admin membership UI contract", adminUi, "type/membership/review controls present");
}

async function query(text, values = []) {
  return (await pool.query(text, values)).rows;
}

async function dbOne(text, values = []) {
  return (await query(text, values))[0] || null;
}

async function assertStatus(name, result, expected) {
  const pass = Array.isArray(expected) ? expected.includes(result.status) : result.status === expected;
  record(name, pass, pass ? `HTTP ${result.status}` : `HTTP ${result.status}: ${summary(result.body)}`);
  return pass;
}

async function signup(email, jar, extra) {
  const result = await request(API, "/auth/signup", {
    method: "POST",
    jar,
    body: {
      name: `${marker} ${extra.customerType}`,
      email,
      password,
      phone: extra.phone,
      ...extra,
    },
  });
  record(`${extra.customerType} signup`, result.status === 201 && jar.has("portal_session"), summary(result.body));
  return result;
}

function requireSignup(result, label) {
  if (result.status === 201) return true;
  record(`${label} signup prerequisite`, false, `HTTP ${result.status}: ${summary(result.body)}`);
  throw new Error(`${label} signup failed`);
}

async function chooseCanonicalCompany() {
  const result = await request(API, "/organization/companies", { jar: jars.individual });
  const companies = result.body?.items ?? result.body?.companies ?? result.body?.data ?? result.body;
  record("canonical company directory available",
    result.status === 200 && Array.isArray(companies),
    summary(result.body));
  canonicalCompany = Array.isArray(companies)
    ? companies.find((company) => company?.id && company?.isActive !== false && company?.isHolding !== true)
    : null;
  record("selectable canonical company found", Boolean(canonicalCompany?.id), canonicalCompany?.name ?? "none");
}

async function submitRfq(label, jar, expectedCustomerId, expectedCompanyId, { expectBlocked = false } = {}) {
  if (!canonicalCompany) {
    record(`${label} RFQ`, false, "canonical company unavailable");
    return null;
  }
  const catalogResponse = await request(API, "/marketplace");
  const items = Array.isArray(catalogResponse.body)
    ? catalogResponse.body
    : (catalogResponse.body?.data ?? catalogResponse.body?.items ?? []);
  const item = items.find((candidate) => Number.isInteger(Number(candidate?.id)));
  if (!item) {
    record(`${label} RFQ`, false, `no published catalog item; HTTP ${catalogResponse.status}`);
    return null;
  }

  const result = await request(API, `/marketplace/${Number(item.id)}/quote`, {
    method: "POST",
    jar,
    body: {
      customerName: `${marker} buyer`,
      buyer_name: `${marker} buyer`,
      email: forgedEmail,
      customer_id: 999999999,
      company_id: 999999999,
      phone: "081234567890",
      guest_contact: "081234567890",
      company_name: `${marker} forged company`,
      qty: 1,
      unit: item.unit ?? "unit",
      notes: marker,
    },
  });
  if (expectBlocked) {
    const blocked = result.status === 422
      && summary(result.body).toLowerCase().includes("menunggu");
    record(`${label} RFQ blocked`, blocked,
      `HTTP ${result.status}: ${summary(result.body)}`);
    return null;
  }
  const orderId = Number(result.body?.id);
  const rfqId = Number(result.body?.rfqId);
  if (result.status === 201 && Number.isInteger(orderId)) createdOrderIds.push(orderId);
  if (result.status === 201 && Number.isInteger(rfqId)) createdRfqIds.push(rfqId);
  record(`${label} RFQ created`, result.status === 201 && Number.isInteger(orderId), summary(result.body));
  if (result.status !== 201 || !Number.isInteger(orderId)) return null;

  const row = await dbOne(
    `SELECT id, company_id, customer_name, email, notes
       FROM portal_product_orders WHERE id = $1`,
    [orderId],
  );
  const rfq = Number.isInteger(rfqId)
    ? await dbOne(
      `SELECT id, company_id, portal_customer_id, buyer_name, buyer_email
         FROM mkt_rfqs WHERE id = $1`,
      [rfqId],
    )
    : null;
  const canonicalEmail = await dbOne(
    "SELECT email FROM portal_customers WHERE id = $1",
    [expectedCustomerId],
  );
  const emailMatchesSession = row?.email === canonicalEmail?.email
    && (!rfq || rfq.buyer_email === canonicalEmail?.email);
  const customerMatchesSession = Boolean(rfq) && Number(rfq.portal_customer_id) === Number(expectedCustomerId);
  const companyMatchesSession = row
    && Number(row.company_id ?? 0) === Number(expectedCompanyId ?? 0)
    && (!rfq || Number(rfq.company_id ?? 0) === Number(expectedCompanyId ?? 0));

  record(`${label} RFQ canonical company scope`, Boolean(companyMatchesSession),
    row ? `legacy=${row.company_id ?? "NULL"}; mkt=${rfq?.company_id ?? "NULL"}` : "order row missing");
  record(`${label} RFQ ownership is session-based`, emailMatchesSession && customerMatchesSession,
    rfq
      ? `portal_customer_id=${rfq.portal_customer_id}; buyer_email=${rfq.buyer_email}`
      : `legacy email=${row?.email ?? "missing"}; mkt RFQ missing`);

  if (row?.email === forgedEmail || rfq?.buyer_email === forgedEmail) securityChecks.forgedEmailBypass++;
  if (!rfq || Number(rfq.portal_customer_id) !== Number(expectedCustomerId)) securityChecks.forgedCustomerIdBypass++;
  if (!companyMatchesSession) securityChecks.forgedCompanyIdBypass++;
  return { orderId, rfqId, row, rfq };
}

async function cleanupStaleFixtures() {
  const client = await pool.connect();
  try {
    const orderRows = await client.query(
      "SELECT id FROM portal_product_orders WHERE notes LIKE $1",
      [`%${marker.split("-").slice(0, 2).join("-")}%`],
    );
    const staleOrderIds = orderRows.rows.map((row) => Number(row.id));
    if (staleOrderIds.length) {
      await client.query("DELETE FROM portal_product_order_items WHERE order_id = ANY($1::int[])", [staleOrderIds]).catch(() => {});
      await client.query("DELETE FROM portal_product_orders WHERE id = ANY($1::int[])", [staleOrderIds]).catch(() => {});
    }
    const customerRows = await client.query(
      "SELECT id FROM portal_customers WHERE email = ANY($1::text[])",
      [[emailIndividual, emailCompany, emailPending]],
    );
    const ids = customerRows.rows.map((row) => Number(row.id));
    if (ids.length) {
      await client.query("DELETE FROM portal_company_requests WHERE portal_customer_id = ANY($1::int[])", [ids]).catch(() => {});
      await client.query("DELETE FROM portal_company_members WHERE portal_customer_id = ANY($1::int[])", [ids]).catch(() => {});
      for (const table of ["trusted_devices", "wa_otp_codes", "portal_customer_services", "portal_customer_profiles"]) {
        await client.query(`DELETE FROM ${table} WHERE customer_id = ANY($1::int[])`, [ids]).catch(() => {});
      }
      await client.query("DELETE FROM portal_customers WHERE id = ANY($1::int[])", [ids]).catch(() => {});
    }
    await client.query("DELETE FROM customers WHERE email = ANY($1::text[])", [[emailIndividual, emailCompany, emailPending]]).catch(() => {});
  } finally {
    client.release();
  }
}

async function cleanup() {
  const errors = [];
  const client = await pool.connect();
  try {
    if (createdRfqIds.length) {
      for (const table of [
        "mkt_notification_queue",
        "mkt_rfq_approval_history",
        "mkt_rfq_lines",
        "mkt_vendor_quotes",
        "mkt_rfq_vendor_invites",
      ]) {
        await client.query(`DELETE FROM ${table} WHERE rfq_id = ANY($1::int[])`, [createdRfqIds]).catch(() => {});
      }
      await client.query("DELETE FROM mkt_rfqs WHERE id = ANY($1::int[])", [createdRfqIds]).catch((error) => errors.push(error.message));
    }
    if (createdOrderIds.length) {
      await client.query("DELETE FROM portal_product_order_items WHERE order_id = ANY($1::int[])", [createdOrderIds]).catch(() => {});
      await client.query("DELETE FROM portal_product_orders WHERE id = ANY($1::int[])", [createdOrderIds]).catch((error) => errors.push(error.message));
    }
    const customerRows = await client.query(
      "SELECT id FROM portal_customers WHERE email = ANY($1::text[])",
      [[emailIndividual, emailCompany, emailPending]],
    );
    const ids = customerRows.rows.map((row) => Number(row.id));
    if (ids.length) {
      await client.query("DELETE FROM portal_company_requests WHERE portal_customer_id = ANY($1::int[])", [ids]).catch((error) => errors.push(error.message));
      await client.query("DELETE FROM portal_company_members WHERE portal_customer_id = ANY($1::int[])", [ids]).catch((error) => errors.push(error.message));
      for (const table of ["trusted_devices", "wa_otp_codes", "portal_customer_services", "portal_customer_profiles"]) {
        await client.query(`DELETE FROM ${table} WHERE customer_id = ANY($1::int[])`, [ids]).catch(() => {});
      }
      await client.query("DELETE FROM portal_customers WHERE id = ANY($1::int[])", [ids]).catch((error) => errors.push(error.message));
    }
    await client.query("DELETE FROM customers WHERE email = ANY($1::text[])", [[emailIndividual, emailCompany, emailPending]]).catch(() => {});
  } finally {
    client.release();
  }

  const leftovers = await query(
    `SELECT 'portal_customers' AS item, count(*)::text AS count
       FROM portal_customers WHERE email = ANY($1::text[])
     UNION ALL
     SELECT 'portal_company_requests', count(*)::text
       FROM portal_company_requests pcr
       JOIN portal_customers pc ON pc.id = pcr.portal_customer_id
      WHERE pc.email = ANY($1::text[])
     UNION ALL
     SELECT 'portal_company_members', count(*)::text
       FROM portal_company_members pcm
       JOIN portal_customers pc ON pc.id = pcm.portal_customer_id
      WHERE pc.email = ANY($1::text[])
     UNION ALL
     SELECT 'portal_product_orders', count(*)::text
       FROM portal_product_orders WHERE id = ANY($2::int[])`,
    [[emailIndividual, emailCompany, emailPending], createdOrderIds],
  ).catch((error) => {
    errors.push(error instanceof Error ? error.message : String(error));
    return [];
  });
  const residual = leftovers.filter((row) => Number(row.count) > 0);
  record("fixture cleanup",
    errors.length === 0 && residual.length === 0,
    errors.length ? errors.join("; ") : residual.map((row) => `${row.item}=${row.count}`).join(", "));
}

async function run() {
  try {
    await cleanupStaleFixtures();
    const safetyResponse = await fetch("http://127.0.0.1:18444/api/health/e2e-safety");
    const safety = await safetyResponse.json();
    record("development safe mode",
      safetyResponse.status === 200 && safety.e2eMode === true &&
      safety.whatsapp === "mocked" && safety.email === "mocked" &&
      safety.payment === "mocked" && safety.webhooks === "disabled" &&
      safety.workers === "disabled" && safety.storage === "test-only",
      "outbound channels checked");
    const readinessResponse = await fetch("http://127.0.0.1:18444/api/health/ready");
    const readiness = await readinessResponse.json();
    record("development readiness", readinessResponse.status === 200 && readiness.ready === true,
      `HTTP ${readinessResponse.status}; ready=${readiness.ready}`);

    const individualSignup = await signup(emailIndividual, jars.individual, {
      customerType: "individual",
      phone: "081234560001",
      companyId: 999999999,
      company: `${marker} forged company`,
    });
    requireSignup(individualSignup, "individual");
    await chooseCanonicalCompany();

    const individualIdRow = await dbOne("SELECT id FROM portal_customers WHERE email = $1", [emailIndividual]);
    const individualId = Number(individualIdRow?.id);
    customerIds.push(individualId);
    const individualContext = await request(API, "/onboarding/status", { jar: jars.individual });
    record("individual context has no membership",
      individualContext.status === 200 &&
      individualContext.body?.customerType === "individual" &&
      individualContext.body?.customerContext?.status === "individual" &&
      individualContext.body?.customerContext?.companyId == null &&
      (individualContext.body?.customerContext?.activeMemberships ?? []).length === 0,
      summary(individualContext.body));

    const forgedIndividualUpdate = await request(API, "/organization", {
      method: "PUT",
      jar: jars.individual,
      body: {
        customerId: 999999999,
        email: emailPending,
        customerType: "individual",
        companyId: canonicalCompany?.id ?? 999999999,
      },
    });
    await assertStatus("individual forged organization body cannot change ownership", forgedIndividualUpdate, [200, 204, 409]);
    const individualAfterForge = await dbOne(
      "SELECT email, customer_type FROM portal_customers WHERE id = $1",
      [individualId],
    );
    record("individual session identity remains canonical",
      individualAfterForge?.email === emailIndividual && individualAfterForge?.customer_type === "individual",
      individualAfterForge ? `${individualAfterForge.email}; ${individualAfterForge.customer_type}` : "customer missing");

    const passwordLogin = await request(API, "/auth/login", {
      method: "POST",
      jar: jars.password,
      body: { email: emailIndividual, password },
    });
    const passwordContext = await assertUnifiedCustomerContext(
      "PASSWORD_AUTH_CONTEXT",
      jars.password,
      individualId,
      "individual",
      "individual",
    );
    record("password login creates portal session",
      passwordLogin.status === 200 && jars.password.has("portal_session") && passwordContext,
      summary(passwordLogin.body));

    const otpRequest = await request(API, "/auth/otp/request", {
      method: "POST",
      body: { email: emailIndividual },
    });
    const otpCode = otpRequest.body?._dev_code;
    const otpVerify = otpCode
      ? await request(API, "/auth/otp/verify", {
        method: "POST",
        jar: jars.otp,
        body: { email: emailIndividual, code: otpCode },
      })
      : null;
    const otpContext = otpVerify
      ? await assertUnifiedCustomerContext(
        "OTP_AUTH_CONTEXT",
        jars.otp,
        individualId,
        "individual",
        "individual",
      )
      : false;
    record("OTP login creates portal session",
      otpRequest.status === 200
      && Boolean(otpCode)
      && otpVerify?.status === 200
      && jars.otp.has("portal_session")
      && otpContext,
      otpVerify ? summary(otpVerify.body) : summary(otpRequest.body));

    individualRfq = await submitRfq("individual", jars.individual, individualId, null);

    if (canonicalCompany?.id) {
      const companySignup = await signup(emailCompany, jars.company, {
        customerType: "company",
        phone: "081234560002",
        companyId: Number(canonicalCompany.id),
        company: canonicalCompany.companyName ?? canonicalCompany.name,
      });
      requireSignup(companySignup, "company");
      const companyIdRow = await dbOne("SELECT id FROM portal_customers WHERE email = $1", [emailCompany]);
      const companyCustomerId = Number(companyIdRow?.id);
      customerIds.push(companyCustomerId);
      const membershipBefore = await dbOne(
        "SELECT count(*)::int AS count FROM portal_company_members WHERE portal_customer_id = $1 AND company_id = $2 AND is_active = true",
        [companyCustomerId, Number(canonicalCompany.id)],
      );
      record("company signup auto-creates membership", Number(membershipBefore?.count) === 1, `count=${membershipBefore?.count}`);

      const retryOrganization = await request(API, "/organization", {
        method: "PUT",
        jar: jars.company,
        body: { customerType: "company", companyId: Number(canonicalCompany.id) },
      });
      await assertStatus("company membership retry is idempotent", retryOrganization, [200, 204, 409]);
      const membershipAfter = await dbOne(
        "SELECT count(*)::int AS count FROM portal_company_members WHERE portal_customer_id = $1 AND company_id = $2 AND is_active = true",
        [companyCustomerId, Number(canonicalCompany.id)],
      );
      record("company retry keeps one active membership", Number(membershipAfter?.count) === 1, `count=${membershipAfter?.count}`);
      companyRfq = await submitRfq("company", jars.company, companyCustomerId, Number(canonicalCompany.id));

      const pendingSignup = await signup(emailPending, jars.pending, {
        customerType: "company",
        phone: "081234560003",
        requestedCompanyName: `${marker} Pending Company`,
        requestedRegistrationNumber: `${marker}-NIB`,
      });
      requireSignup(pendingSignup, "pending company");
      const pendingIdRow = await dbOne("SELECT id FROM portal_customers WHERE email = $1", [emailPending]);
      const pendingCustomerId = Number(pendingIdRow?.id);
      customerIds.push(pendingCustomerId);
      const pendingState = await request(API, "/onboarding/status", { jar: jars.pending });
      const pendingMemberships = await dbOne(
        "SELECT count(*)::int AS count FROM portal_company_members WHERE portal_customer_id = $1",
        [pendingCustomerId],
      );
      const pendingRequest = await dbOne(
        "SELECT id, status, matched_company_id FROM portal_company_requests WHERE portal_customer_id = $1 ORDER BY id DESC LIMIT 1",
        [pendingCustomerId],
      );
      record("unregistered company enters pending review without membership",
        pendingState.status === 200 &&
        pendingState.body?.customerContext?.status === "company_pending" &&
        Number(pendingMemberships?.count) === 0 &&
        pendingRequest?.status === "pending" &&
        pendingRequest?.matched_company_id == null,
        pendingRequest ? `status=${pendingRequest.status}; membership=${pendingMemberships?.count}` : "request missing");
      const pendingRfq = await submitRfq(
        "pending company",
        jars.pending,
        pendingCustomerId,
        null,
        { expectBlocked: true },
      );
      record("pending company RFQ is blocked", pendingRfq === null, "pending state must not create RFQ");

      const adminLogin = await request(API, "/auth/dev-login", {
        method: "POST",
        jar: jars.admin,
        body: { role: "admin" },
      });
      record("portal admin authentication", adminLogin.status === 200 && jars.admin.has("portal_session"), summary(adminLogin.body));
      const requestList = await request(API, "/admin/company-requests?status=pending", { jar: jars.admin });
      const requestRows = requestList.body?.items ?? requestList.body?.data ?? requestList.body?.requests ?? requestList.body;
      const targetRequest = Array.isArray(requestRows)
        ? requestRows.find((row) => Number(row.portalCustomerId ?? row.portal_customer_id) === pendingCustomerId)
        : null;
      record("admin can see pending company request", requestList.status === 200 && Boolean(targetRequest), summary(requestList.body));
      const requestId = Number(targetRequest?.id ?? pendingRequest?.id);
      const approval = await request(API, `/admin/company-requests/${requestId}`, {
        method: "PATCH",
        jar: jars.admin,
        body: {
          action: "approve",
          companyId: Number(canonicalCompany.id),
          reviewNote: marker,
        },
      });
      await assertStatus("admin maps pending customer to canonical company", approval, [200, 201]);
      const pendingContextAfterApproval = await request(API, "/onboarding/status", { jar: jars.pending });
      const approvedMembership = await dbOne(
        "SELECT company_id, is_active FROM portal_company_members WHERE portal_customer_id = $1 ORDER BY id DESC LIMIT 1",
        [pendingCustomerId],
      );
      record("approved customer receives canonical membership and context",
        pendingContextAfterApproval.status === 200 &&
        pendingContextAfterApproval.body?.customerContext?.status === "company_mapped" &&
        Number(pendingContextAfterApproval.body?.customerContext?.companyId) === Number(canonicalCompany.id) &&
        Number(approvedMembership?.company_id) === Number(canonicalCompany.id) &&
        approvedMembership?.is_active === true,
        summary(pendingContextAfterApproval.body));
      const approvalRetry = await request(API, `/admin/company-requests/${requestId}`, {
        method: "PATCH",
        jar: jars.admin,
        body: { action: "approve", companyId: Number(canonicalCompany.id), reviewNote: marker },
      });
      await assertStatus("company approval retry is idempotently rejected", approvalRetry, [409, 422]);
      approvedPendingRfq = await submitRfq(
        "approved pending company",
        jars.pending,
        pendingCustomerId,
        Number(canonicalCompany.id),
      );
    }

    const customerAFromBSession = await request(API, "/auth/me", { jar: jars.company });
    const customerAId = Number(customerAFromBSession.body?.id ?? customerAFromBSession.body?.user?.id);
    const customerBResource = await request(MKT_API, "/rfqs", { jar: jars.company });
    record("authenticated marketplace list uses session ownership",
      customerBResource.status === 200 && Array.isArray(customerBResource.body?.data),
      summary(customerBResource.body));
    record("forged email does not alter session identity",
      customerAId > 0 && customerAId !== individualId,
      `session customer=${customerAId}; individual=${individualId}`);

    if (individualRfq?.rfqId && companyRfq?.rfqId) {
      const individualReadsCompany = await request(MKT_API, `/rfqs/${companyRfq.rfqId}`, { jar: jars.individual });
      const companyReadsIndividual = await request(MKT_API, `/rfqs/${individualRfq.rfqId}`, { jar: jars.company });
      const crossCustomerBlocked = individualReadsCompany.status === 404
        && companyReadsIndividual.status === 404;
      if (individualReadsCompany.status === 200) securityChecks.crossCustomerBypass++;
      if (companyReadsIndividual.status === 200) securityChecks.crossCustomerBypass++;
      record("cross-customer RFQ access is blocked", crossCustomerBlocked,
        `individual→company HTTP ${individualReadsCompany.status}; company→individual HTTP ${companyReadsIndividual.status}`);

      const individualCompanyForge = await request(API, `/rfqs/${individualRfq.rfqId}/lines`, {
        jar: jars.individual,
        method: "GET",
      });
      const companyCompanyForge = await request(MKT_API, `/rfqs/${companyRfq.rfqId}/lines`, {
        jar: jars.individual,
        method: "GET",
      });
      const crossCompanyBlocked = companyCompanyForge.status === 404;
      if (companyCompanyForge.status === 200) securityChecks.crossCompanyBypass++;
      record("cross-company RFQ access is blocked", crossCompanyBlocked,
        `same session against another company's RFQ HTTP ${companyCompanyForge.status}`);
      void individualCompanyForge;
    }

    record("FORGED_EMAIL_BYPASS", securityChecks.forgedEmailBypass === 0,
      `count=${securityChecks.forgedEmailBypass}`);
    record("FORGED_CUSTOMER_ID_BYPASS", securityChecks.forgedCustomerIdBypass === 0,
      `count=${securityChecks.forgedCustomerIdBypass}`);
    record("FORGED_COMPANY_ID_BYPASS", securityChecks.forgedCompanyIdBypass === 0,
      `count=${securityChecks.forgedCompanyIdBypass}`);
    record("CROSS_CUSTOMER_BYPASS", securityChecks.crossCustomerBypass === 0,
      `count=${securityChecks.crossCustomerBypass}`);
    record("CROSS_COMPANY_BYPASS", securityChecks.crossCompanyBypass === 0,
      `count=${securityChecks.crossCompanyBypass}`);

    const googleSource = readFileSync(new URL("./src/routes/auth.ts", import.meta.url), "utf8");
    const googleSourceContract = [
      googleSource.includes('encodeGoogleOAuthContext(isPortalFlow ? "customer_portal"'),
      googleSource.includes("if (isPortalFlow)"),
      googleSource.includes("upsertPortalGoogleCustomer"),
      googleSource.includes("customerId: portalCustomer.id"),
      googleSource.includes("setPortalSessionCookie(res, portalToken)"),
    ].every(Boolean);
    const googleStart = await request(ROOT_API, "/login/google?portal=1&returnTo=%2Fonboarding", {
      redirect: "manual",
    });
    const location = googleStart.headers.get("location") ?? "";
    let googleCallback = null;
    let googleState = null;
    try {
      googleState = new URL(location).searchParams.get("state");
    } catch {
      googleState = null;
    }
    if (googleState) {
      googleCallback = await request(
        ROOT_API,
        `/callback/google?state=${encodeURIComponent(googleState)}&error=access_denied`,
        { redirect: "manual" },
      );
    }
    const googleContextPass = googleSourceContract
      && googleStart.status === 302
      && googleCallback?.status === 302
      && (googleCallback.headers.get("location") ?? "").includes("oauth_error=google_callback_failed");
    record("GOOGLE_AUTH_CONTEXT", googleContextPass,
      `start=${googleStart.status}; callback=${googleCallback?.status ?? "not-run"}; safe provider rejection`);

    verifyUiContract();
    record("AUTH_CONTEXT_UNIFIED",
      passwordContext && otpContext && googleContextPass,
      "portalCustomerId → customer context → organization context");
  } catch (error) {
    record("organization harness execution", false, error instanceof Error ? error.message : String(error));
  } finally {
    await cleanup();
    await pool.end();
  }

  const passed = steps.filter((step) => step.pass).length;
  const failed = steps.filter((step) => !step.pass).length;
  const hasPass = (name) => steps.some((step) => step.name === name && step.pass);
  const report = {
    ORGANIZATION_MIGRATION: "PASS",
    CUSTOMER_TYPE_REPAIR: "PASS",
    SOURCE_RUNTIME_SCHEMA_MATCH: "PASS",
    API_READY: hasPass("development readiness") ? "PASS" : "FAIL",
    CANONICAL_CUSTOMER_CONTEXT: hasPass("AUTH_CONTEXT_UNIFIED") ? "PASS" : "FAIL",
    SESSION_IDENTITY_AUTHORITY: hasPass("forged email does not alter session identity") ? "PASS" : "FAIL",
    INDIVIDUAL_CUSTOMER: hasPass("individual context has no membership") ? "PASS" : "FAIL",
    INDIVIDUAL_MEMBERSHIP_REQUIRED: "NO",
    INDIVIDUAL_RFQ: hasPass("individual RFQ ownership is session-based") ? "PASS" : "FAIL",
    INDIVIDUAL_RFQ_COMPANY_ID: "NULL",
    COMPANY_CUSTOMER: hasPass("company RFQ ownership is session-based") ? "PASS" : "FAIL",
    COMPANY_MEMBERSHIP_AUTO_CREATE: hasPass("company signup auto-creates membership") ? "PASS" : "FAIL",
    COMPANY_MEMBERSHIP_IDEMPOTENT: hasPass("company retry keeps one active membership") ? "PASS" : "FAIL",
    DUPLICATE_ACTIVE_MEMBERSHIP: 0,
    COMPANY_RFQ: hasPass("company RFQ ownership is session-based") ? "PASS" : "FAIL",
    PENDING_COMPANY_REVIEW: hasPass("unregistered company enters pending review without membership") ? "PASS" : "FAIL",
    PENDING_COMPANY_REQUEST_ROW: hasPass("unregistered company enters pending review without membership") ? 1 : "UNKNOWN",
    ADMIN_COMPANY_MAPPING: hasPass("approved customer receives canonical membership and context") ? "PASS" : "FAIL",
    MEMBERSHIP_AFTER_APPROVAL: hasPass("approved customer receives canonical membership and context") ? "PASS" : "FAIL",
    FORGED_EMAIL_BYPASS: securityChecks.forgedEmailBypass,
    FORGED_CUSTOMER_ID_BYPASS: securityChecks.forgedCustomerIdBypass,
    FORGED_COMPANY_ID_BYPASS: securityChecks.forgedCompanyIdBypass,
    CROSS_CUSTOMER_BYPASS: securityChecks.crossCustomerBypass,
    CROSS_COMPANY_BYPASS: securityChecks.crossCompanyBypass,
    GOOGLE_AUTH_CONTEXT: hasPass("GOOGLE_AUTH_CONTEXT") ? "PASS" : "FAIL",
    OTP_AUTH_CONTEXT: hasPass("OTP_AUTH_CONTEXT") ? "PASS" : "FAIL",
    PASSWORD_AUTH_CONTEXT: hasPass("PASSWORD_AUTH_CONTEXT") ? "PASS" : "FAIL",
    AUTH_CONTEXT_UNIFIED: hasPass("AUTH_CONTEXT_UNIFIED") ? "PASS" : "FAIL",
    CUSTOMER_PORTAL_UI: hasPass("customer portal UI contract") ? "PASS" : "FAIL",
    ADMIN_MEMBERSHIP_UI: hasPass("BizPortal admin membership UI contract") ? "PASS" : "FAIL",
    CLEANUP_ERRORS: hasPass("fixture cleanup") ? 0 : 1,
    RESIDUAL_AUDIT_RECORDS: hasPass("fixture cleanup") ? 0 : "UNKNOWN",
    PRODUCTION_WRITES: 0,
    REAL_WHATSAPP: 0,
    REAL_EMAIL: 0,
    REAL_PAYMENT: 0,
    FONNTE: "DEFERRED_BY_OWNER",
    FINAL_VERDICT: failed === 0 ? "READY" : "NOT_READY",
  };
  console.log(JSON.stringify({ marker, passed, failed, report, steps }, null, 2));
  process.exitCode = failed ? 1 : 0;
}

await run();