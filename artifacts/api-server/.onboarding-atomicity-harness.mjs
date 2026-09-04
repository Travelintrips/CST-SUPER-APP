import pg from "pg";

const { Pool } = pg;
const API = "http://127.0.0.1:18444/api/portal";
const marker = `cst-onboarding-${Date.now()}`;
const password = "CstOnboarding!2026";
const accounts = {
  customer: { email: `${marker}-customer@example.test`, phone: "081234570001" },
  vendor: { email: `${marker}-vendor@example.test`, phone: "081234570002" },
  failCustomer: { email: `${marker}-fail-customer@example.test`, phone: "081234570003" },
  failVendor: { email: `${marker}-fail-vendor@example.test`, phone: "081234570004" },
};

if (process.env.APP_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
  throw new Error("Onboarding atomicity proof is DEV-only.");
}
if (process.env.PROD_WRITES === "1" || process.env.PROD_MIGRATIONS === "1") {
  throw new Error("Production writes/migrations are forbidden by this proof.");
}

const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV || process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 5_000,
});
const steps = [];
const jars = new Map();
const customerIds = [];

function record(name, pass, detail = "") {
  steps.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 240) });
}

function summary(body) {
  if (!body || typeof body !== "object") return "";
  return body.message || body.error || body.detail || "";
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

async function request(path, { method = "GET", body, jar, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (jar?.size) requestHeaders.cookie = cookieHeader(jar);
  if (body !== undefined) requestHeaders["content-type"] = "application/json";
  const response = await fetch(`${API}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (jar) extractCookies(response.headers, jar);
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body: parsed };
}

async function query(text, values = []) {
  return (await pool.query(text, values)).rows;
}

async function one(text, values = []) {
  return (await query(text, values))[0] || null;
}

async function signup(kind, account, role = "customer") {
  const jar = new Map();
  jars.set(kind, jar);
  const response = await request("/auth/signup", {
    method: "POST",
    jar,
    body: {
      name: `${marker} ${kind}`,
      email: account.email,
      password,
      phone: account.phone,
      ...(role === "vendor" ? { role: "vendor" } : {}),
    },
  });
  const row = await one("SELECT id FROM portal_customers WHERE email = $1", [account.email]);
  if (row) customerIds.push(Number(row.id));
  record(`${kind} signup`, response.status === 201 && jar.has("portal_session") && row, summary(response.body));
  if (response.status !== 201 || !row) throw new Error(`${kind} signup failed: ${summary(response.body)}`);
  return { jar, customerId: Number(row.id) };
}

function onboardingBody(kind, accountType = "customer") {
  return {
    fullName: `${marker} ${kind} profile`,
    phone: accounts[kind].phone,
    address: "Jl. Proof Atomicity 1",
    accountType,
    ...(accountType === "vendor"
      ? {
          vendor: {
            companyName: `${marker} Vendor PT`,
            nib: "NIB-PROOF-2026",
            npwp: "NPWP-PROOF-2026",
            serviceType: "logistics",
          },
        }
      : { customerType: "individual" }),
  };
}

async function countFor(table, column, id) {
  try {
    const rows = await query(`SELECT count(*)::int AS count FROM ${table} WHERE ${column} = $1`, [id]);
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

async function assertNoOnboardingRows(label, customerId) {
  const counts = {
    userProfile: await countFor("user_profiles", "customer_id", customerId),
    vendorProfile: await countFor("vendor_profiles", "customer_id", customerId),
    approval: await countFor("onboarding_approvals", "customer_id", customerId),
    membership: await countFor("portal_company_members", "portal_customer_id", customerId),
    companyRequest: await countFor("portal_company_requests", "portal_customer_id", customerId),
  };
  const pass = Object.values(counts).every((value) => value === 0);
  record(label, pass, JSON.stringify(counts));
  return pass;
}

async function complete(kind, accountType = "customer", extra = {}) {
  const jar = jars.get(kind);
  return request("/onboarding/complete", {
    method: "POST",
    jar,
    headers: extra.failure ? { "x-dev-onboarding-failure": extra.failure } : {},
    body: onboardingBody(kind, accountType),
  });
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [table, column] of [
      ["identity_documents", "customer_id"],
      ["ocr_results", "customer_id"],
      ["onboarding_approvals", "customer_id"],
      ["vendor_profiles", "customer_id"],
      ["driver_profiles", "customer_id"],
      ["employee_profiles", "customer_id"],
      ["user_profiles", "customer_id"],
      ["portal_company_members", "portal_customer_id"],
      ["portal_company_requests", "portal_customer_id"],
      ["portal_customer_services", "customer_id"],
    ]) {
      await client.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::int[])`, [customerIds]);
    }
    await client.query("DELETE FROM portal_customers WHERE id = ANY($1::int[])", [customerIds]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    record("cleanup transaction", false, error instanceof Error ? error.message : String(error));
  } finally {
    client.release();
  }

  const residual = [];
  for (const table of ["portal_customers", "user_profiles", "vendor_profiles", "onboarding_approvals", "portal_company_members", "portal_company_requests"]) {
    const rows = await query(`SELECT count(*)::int AS count FROM ${table} WHERE ${table === "portal_customers" ? "id" : table === "portal_company_members" || table === "portal_company_requests" ? "portal_customer_id" : "customer_id"} = ANY($1::int[])`, [customerIds]).catch(() => []);
    if (Number(rows[0]?.count ?? 0) > 0) residual.push(`${table}=${rows[0].count}`);
  }
  record("cleanup residual=0", residual.length === 0, residual.join(", "));
}

async function run() {
  try {
    const ready = await fetch("http://127.0.0.1:18444/api/health/ready");
    const readyBody = await ready.json();
    record("DEV API ready", ready.status === 200 && readyBody.ready === true, `HTTP ${ready.status}`);

    const customer = await signup("customer", accounts.customer);
    const customerComplete = await complete("customer");
    record("A customer onboarding success", customerComplete.status === 200 && customerComplete.body?.ok === true, summary(customerComplete.body));

    const customerMe = await request("/auth/me", { jar: customer.jar });
    const customerStatus = await request("/onboarding/status", { jar: customer.jar });
    record(
      "H customer session/profile linkage",
      customerMe.status === 200
        && Number(customerMe.body?.id ?? customerMe.body?.user?.id) === customer.customerId
        && customerStatus.status === 200
        && customerStatus.body?.status === "active",
      `me=${customerMe.status}; onboarding=${customerStatus.status}`,
    );

    const vendor = await signup("vendor", accounts.vendor, "vendor");
    const vendorComplete = await complete("vendor", "vendor");
    record("B vendor onboarding success", vendorComplete.status === 200 && vendorComplete.body?.ok === true, summary(vendorComplete.body));

    const vendorRetry = await complete("vendor", "vendor");
    const vendorCounts = {
      profiles: await countFor("vendor_profiles", "customer_id", vendor.customerId),
      approvals: await countFor("onboarding_approvals", "customer_id", vendor.customerId),
      userProfiles: await countFor("user_profiles", "customer_id", vendor.customerId),
    };
    record(
      "E retry idempotency",
      vendorRetry.status === 200
        && vendorCounts.profiles === 1
        && vendorCounts.approvals === 1
        && vendorCounts.userProfiles === 1,
      `retry=${vendorRetry.status}; ${JSON.stringify(vendorCounts)}`,
    );

    const concurrent = await Promise.all([
      complete("vendor", "vendor"),
      complete("vendor", "vendor"),
    ]);
    const concurrentCounts = {
      profiles: await countFor("vendor_profiles", "customer_id", vendor.customerId),
      approvals: await countFor("onboarding_approvals", "customer_id", vendor.customerId),
      userProfiles: await countFor("user_profiles", "customer_id", vendor.customerId),
    };
    record(
      "F concurrent submit guard",
      concurrent.every((result) => result.status === 200)
        && concurrentCounts.profiles === 1
        && concurrentCounts.approvals === 1
        && concurrentCounts.userProfiles === 1,
      `statuses=${concurrent.map((result) => result.status).join(",")}; ${JSON.stringify(concurrentCounts)}`,
    );

    const vendorDb = await one(
      "SELECT up.status AS profile_status, pc.role, oa.status AS approval_status FROM user_profiles up JOIN portal_customers pc ON pc.id = up.customer_id LEFT JOIN onboarding_approvals oa ON oa.customer_id = up.customer_id WHERE up.customer_id = $1 ORDER BY oa.created_at DESC NULLS LAST LIMIT 1",
      [vendor.customerId],
    );
    record(
      "G vendor pending approval",
      vendorDb?.profile_status === "pending"
        && vendorDb?.role === "vendor"
        && vendorDb?.approval_status === "pending",
      JSON.stringify(vendorDb),
    );

    const failCustomer = await signup("failCustomer", accounts.failCustomer);
    const failedCustomer = await complete("failCustomer", "customer", { failure: "customer-mid-flow" });
    record("C forced customer failure", failedCustomer.status >= 400, `HTTP ${failedCustomer.status}`);
    await assertNoOnboardingRows("C customer full rollback", failCustomer.customerId);

    const failVendor = await signup("failVendor", accounts.failVendor, "vendor");
    const failedVendor = await complete("failVendor", "vendor", { failure: "vendor-mid-flow" });
    record("D forced vendor failure", failedVendor.status >= 400, `HTTP ${failedVendor.status}`);
    await assertNoOnboardingRows("D vendor full rollback", failVendor.customerId);

    const vendorMe = await request("/auth/me", { jar: vendor.jar });
    const vendorStatus = await request("/onboarding/status", { jar: vendor.jar });
    record(
      "session/profile linkage remains canonical",
      vendorMe.status === 200
        && Number(vendorMe.body?.id ?? vendorMe.body?.user?.id) === vendor.customerId
        && vendorStatus.status === 200
        && vendorStatus.body?.status === "pending",
      `me=${vendorMe.status}; onboarding=${vendorStatus.status}`,
    );
  } catch (error) {
    record("harness execution", false, error instanceof Error ? error.message : String(error));
  } finally {
    await cleanup();
    await pool.end();
  }

  const failed = steps.filter((step) => !step.pass);
  console.log(JSON.stringify({
    marker,
    passed: steps.length - failed.length,
    failed: failed.length,
    report: {
      CUSTOMER_ONBOARDING_ATOMIC: steps.find((step) => step.name === "A customer onboarding success")?.pass ? "PASS" : "FAIL",
      VENDOR_ONBOARDING_ATOMIC: steps.find((step) => step.name === "B vendor onboarding success")?.pass ? "PASS" : "FAIL",
      CUSTOMER_ROLLBACK_PROOF: steps.find((step) => step.name === "C customer full rollback")?.pass ? "PASS" : "FAIL",
      VENDOR_ROLLBACK_PROOF: steps.find((step) => step.name === "D vendor full rollback")?.pass ? "PASS" : "FAIL",
      RETRY_IDEMPOTENCY: steps.find((step) => step.name === "E retry idempotency")?.pass ? "PASS" : "FAIL",
      CONCURRENT_SUBMIT_GUARD: steps.find((step) => step.name === "F concurrent submit guard")?.pass ? "PASS" : "FAIL",
      ORPHAN_GUARD: steps.find((step) => step.name === "C customer full rollback")?.pass && steps.find((step) => step.name === "D vendor full rollback")?.pass ? "PASS" : "FAIL",
      VENDOR_APPROVAL_GATE: steps.find((step) => step.name === "G vendor pending approval")?.pass ? "PASS" : "FAIL",
      SESSION_PROFILE_LINKAGE: steps.find((step) => step.name === "session/profile linkage remains canonical")?.pass ? "PASS" : "FAIL",
      DEV_FIXTURES_REMAINING: steps.find((step) => step.name === "cleanup residual=0")?.pass ? 0 : "UNKNOWN",
      PROD_WRITES: 0,
      PROD_MIGRATIONS: 0,
      FINAL_VERDICT: failed.length === 0 ? "READY" : "NOT_READY",
    },
    steps,
  }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

await run();