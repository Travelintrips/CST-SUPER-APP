import pg from "pg";

const { Pool } = pg;
const API = "http://127.0.0.1:18444/api/portal";
const marker = `cst-customer-lifecycle-${Date.now()}`;
const emailA = `${marker}-a@example.test`;
const emailB = `${marker}-b@example.test`;
const password = "CstLifecyclePass!2026";
const startedAt = new Date();
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV || process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 20_000,
});

const steps = [];
const orderIds = [];
const jars = { a: new Map(), b: new Map(), vendor: new Map(), admin: new Map() };
let resetToken;

function record(name, pass, detail = "") {
  steps.push({ name, pass, detail: detail ? String(detail).slice(0, 180) : undefined });
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
      .map((v) => v.replace(/^,\s*/, ""));
  for (const value of values) {
    const pair = value.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(path, { method = "GET", body, jar, form } = {}) {
  const headers = {};
  if (jar?.size) headers.cookie = cookieHeader(jar);
  let requestBody;
  if (form) requestBody = form;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(`${API}${path}`, { method, headers, body: requestBody });
  if (jar) extractCookies(response.headers, jar);
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body: parsed, headers: response.headers };
}

async function query(text, values = []) {
  const result = await pool.query(text, values);
  return result.rows;
}

async function dbOne(text, values = []) {
  return (await query(text, values))[0] || null;
}

async function otpLogin(email, jar) {
  const otp = await request("/auth/otp/request", { method: "POST", body: { email } });
  const code = otp.body?._dev_code;
  const verified = code
    ? await request("/auth/otp/verify", { method: "POST", body: { email, code }, jar })
    : { status: 0, body: {} };
  const cookieHeaderValue = verified.headers.get("set-cookie") || "";
  const hasHttpOnlySession = /portal_session=[^;]+;[^]*HttpOnly/i.test(cookieHeaderValue)
    || (typeof verified.headers.getSetCookie === "function"
      && verified.headers.getSetCookie().some((value) => /^portal_session=/.test(value) && /HttpOnly/i.test(value)));
  record(`${email.endsWith("-a@example.test") ? "customer A" : "customer B"} OTP authentication`,
    otp.status === 200 && typeof code === "string" && verified.status === 200 && jar.has("portal_session"),
    otp.status !== 200 ? summary(otp.body) : verified.status !== 200 ? summary(verified.body) : "session established");
  record(`${email.endsWith("-a@example.test") ? "customer A" : "customer B"} portal_session HttpOnly`,
    verified.status === 200 && hasHttpOnlySession,
    "cookie attribute checked without exposing value");
  return verified;
}

async function roleLogin(role, jar) {
  const result = await request("/auth/dev-login", { method: "POST", body: { role }, jar });
  record(`${role} authentication`, result.status === 200 && jar.has("portal_session"), summary(result.body));
  return result;
}

async function assertStatus(name, result, expected) {
  const pass = Array.isArray(expected) ? expected.includes(result.status) : result.status === expected;
  record(name, pass, pass ? `HTTP ${result.status}` : `HTTP ${result.status}: ${summary(result.body)}`);
  return pass;
}

async function cleanup() {
  const errors = [];
  const client = await pool.connect();
  try {
    if (orderIds.length) {
      await client.query("DELETE FROM sales_document_lines WHERE document_id = ANY($1::int[])", [orderIds]).catch(() => {});
      await client.query("DELETE FROM sales_documents WHERE id = ANY($1::int[])", [orderIds]).catch((e) => errors.push(e.message));
    }
    await client.query("DELETE FROM notification_logs WHERE recipient = ANY($1::text[]) AND created_at >= $2", [[emailA, emailB], startedAt]).catch(() => {});
    const customerRows = await client.query(
      "SELECT id FROM portal_customers WHERE email = ANY($1::text[])",
      [[emailA, emailB]],
    );
    const ids = customerRows.rows.map((row) => Number(row.id));
    if (ids.length) {
      for (const table of [
        "portal_customer_services",
        "trusted_devices",
        "wa_otp_codes",
        "user_profiles",
        "portal_customer_profiles",
      ]) {
        await client.query(`DELETE FROM ${table} WHERE customer_id = ANY($1::int[])`, [ids]).catch(() => {});
      }
      await client.query("DELETE FROM portal_customers WHERE id = ANY($1::int[])", [ids]).catch((e) => errors.push(e.message));
    }
    await client.query("DELETE FROM customers WHERE email = ANY($1::text[])", [[emailA, emailB]]).catch(() => {});
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    client.release();
  }

  const leftovers = await query(
    `SELECT 'portal_customers' AS item, count(*)::text AS count FROM portal_customers WHERE email = ANY($1::text[])
     UNION ALL SELECT 'customers', count(*)::text FROM customers WHERE email = ANY($1::text[])
     UNION ALL SELECT 'sales_documents', count(*)::text FROM sales_documents WHERE id = ANY($2::int[])`,
    [[emailA, emailB], orderIds],
  ).catch((error) => {
    errors.push(error instanceof Error ? error.message : String(error));
    return [];
  });
  const remaining = leftovers.filter((row) => Number(row.count) > 0);
  record("fixture cleanup", errors.length === 0 && remaining.length === 0,
    errors.length ? errors.join("; ") : remaining.map((row) => `${row.item}=${row.count}`).join(", "));
}

async function cleanupStaleFixtures() {
  const client = await pool.connect();
  try {
    const customerRows = await client.query(
      "SELECT id FROM portal_customers WHERE email LIKE 'cst-customer-lifecycle-%@example.test'",
    );
    const ids = customerRows.rows.map((row) => Number(row.id));
    const orderRows = await client.query(
      "SELECT id FROM sales_documents WHERE notes LIKE 'cst-customer-lifecycle-%'",
    );
    const staleOrderIds = orderRows.rows.map((row) => Number(row.id));
    if (staleOrderIds.length) {
      await client.query("DELETE FROM sales_document_lines WHERE document_id = ANY($1::int[])", [staleOrderIds]).catch(() => {});
      await client.query("DELETE FROM sales_documents WHERE id = ANY($1::int[])", [staleOrderIds]).catch(() => {});
    }
    if (ids.length) {
      for (const table of [
        "portal_customer_services",
        "trusted_devices",
        "wa_otp_codes",
        "user_profiles",
        "portal_customer_profiles",
      ]) {
        await client.query(`DELETE FROM ${table} WHERE customer_id = ANY($1::int[])`, [ids]).catch(() => {});
      }
      await client.query("DELETE FROM portal_customers WHERE id = ANY($1::int[])", [ids]).catch(() => {});
    }
    await client.query(
      "DELETE FROM customers WHERE email LIKE 'cst-customer-lifecycle-%@example.test'",
    ).catch(() => {});
  } finally {
    client.release();
  }
}

async function waitForReadiness(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch("http://127.0.0.1:18444/api/health/ready");
    const body = await response.json();
    if (response.status === 200 && body.ready === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return false;
}

async function run() {
  try {
    await cleanupStaleFixtures();
    const dbReady = await dbOne("SELECT 1 AS ok");
    record("development database connection", dbReady?.ok === 1, "development pool reachable");

    const safetyResponse = await fetch("http://127.0.0.1:18444/api/health/e2e-safety");
    const safety = await safetyResponse.json();
    record("development safe mode",
      safetyResponse.status === 200 && safety.e2eMode === true &&
      safety.whatsapp === "mocked" && safety.email === "mocked" &&
      safety.payment === "mocked" && safety.webhooks === "disabled" &&
      safety.workers === "disabled" && safety.storage === "test-only",
      "all outbound channels checked by status");

    record("development readiness", await waitForReadiness(), "HTTP 200 with ready:true");

    await otpLogin(emailA, jars.a);
    await otpLogin(emailB, jars.b);
    await roleLogin("vendor", jars.vendor);
    await roleLogin("admin", jars.admin);

    await assertStatus("customer A /auth/me", await request("/auth/me", { jar: jars.a }), 200);
    await assertStatus("customer A own profile", await request("/auth/me", { jar: jars.a }), 200);
    await assertStatus("customer A own orders", await request("/orders", { jar: jars.a }), 200);
    await assertStatus("customer A own logistic orders", await request("/logistic-orders", { jar: jars.a }), 200);
    await assertStatus("customer A own product orders", await request("/product-orders", { jar: jars.a }), 200);
    await assertStatus("customer A own invoices", await request("/me/invoices", { jar: jars.a }), 200);
    await assertStatus("customer A dashboard", await request("/me/dashboard-stats", { jar: jars.a }), 200);

    const bOrder = await request("/orders", {
      method: "POST",
      jar: jars.b,
      body: { items: [{ name: `${marker} B order`, quantity: 1, unitPrice: 0 }], notes: marker },
    });
    const bOrderId = Number(bOrder.body?.id);
    if (bOrder.status === 201 && Number.isInteger(bOrderId)) orderIds.push(bOrderId);
    record("customer B fixture order", bOrder.status === 201 && Number.isInteger(bOrderId), summary(bOrder.body));
    const aOrder = await request("/orders", {
      method: "POST",
      jar: jars.a,
      body: { items: [{ name: `${marker} A order`, quantity: 1, unitPrice: 0 }], notes: marker },
    });
    const aOrderId = Number(aOrder.body?.id);
    if (aOrder.status === 201 && Number.isInteger(aOrderId)) orderIds.push(aOrderId);
    record("customer A fixture order", aOrder.status === 201 && Number.isInteger(aOrderId), summary(aOrder.body));

    if (Number.isInteger(bOrderId)) {
      await assertStatus("customer A → customer B resource denied",
        await request(`/orders/${bOrderId}/cancel`, { method: "PATCH", jar: jars.a }), [403, 404]);
    } else {
      record("customer A → customer B resource denied", false, "B fixture order was not created");
    }
    if (Number.isInteger(aOrderId)) {
      await assertStatus("customer A → own resource", await request(`/orders/${aOrderId}/cancel`, { method: "PATCH", jar: jars.a }), 200);
    } else {
      record("customer A → own resource", false, "A fixture order was not created");
    }

    for (const [role, jar] of [["vendor", jars.vendor], ["admin", jars.admin]]) {
      for (const path of ["/orders", "/logistic-orders", "/product-orders", "/me/invoices"]) {
        await assertStatus(`${role} → ${path} denied`, await request(path, { jar }), [403, 404]);
      }
      await assertStatus(`${role} → customer payment upload denied`,
        await request("/payment-proof-upload", { method: "POST", jar, body: {} }), [403, 404]);
    }
    await assertStatus("customer → vendor API denied", await request("/vendor/profile", { jar: jars.a }), [403, 404]);
    await assertStatus("customer → admin API denied", await request("/admin/products", { jar: jars.a }), [403, 404]);

    const initial = await dbOne(
      "SELECT password_hash, reset_password_token, reset_password_expiry FROM portal_customers WHERE email = $1",
      [emailA],
    );
    record("passwordless account initial state", initial && !String(initial.password_hash || "").trim(), "empty password hash");

    const forgot = await request("/auth/forgot-password", {
      method: "POST",
      body: { email: emailA, origin: "http://127.0.0.1:18444" },
    });
    record("forgot-password request", forgot.status === 200, summary(forgot.body));
    const artifact = await dbOne(
      "SELECT reset_password_token, reset_password_expiry FROM portal_customers WHERE email = $1",
      [emailA],
    );
    record("reset artifact created", !!artifact?.reset_password_token?.startsWith("pwreset:") && new Date(artifact.reset_password_expiry) > new Date(),
      "hashed artifact present with future expiry");
    const capture = await request(`/auth/dev-reset-capture?email=${encodeURIComponent(emailA)}`);
    resetToken = capture.body?.token;
    record("reset artifact test capture", capture.status === 200 && typeof resetToken === "string" && resetToken.length > 0,
      "ephemeral harness capture used; token not printed");

    const reset = await request("/auth/reset-password-with-token", {
      method: "POST",
      body: { email: emailA, token: resetToken, password },
    });
    record("credential setup", reset.status === 200 && reset.body?.ok === true, summary(reset.body));
    const afterReset = await dbOne(
      "SELECT password_hash, reset_password_token, reset_password_expiry FROM portal_customers WHERE email = $1",
      [emailA],
    );
    record("reset artifact consumed after use",
      !!afterReset && String(afterReset.password_hash || "").length > 0 &&
      afterReset.reset_password_token == null && afterReset.reset_password_expiry == null,
      "password set and artifact cleared");
    const reuse = await request("/auth/reset-password-with-token", {
      method: "POST",
      body: { email: emailA, token: resetToken, password: `${password}2` },
    });
    await assertStatus("reuse old reset artifact denied", reuse, 400);

    const passwordLoginJar = new Map();
    const passwordLogin = await request("/auth/login", {
      method: "POST", body: { email: emailA, password }, jar: passwordLoginJar,
    });
    record("password login", passwordLogin.status === 200 && passwordLoginJar.has("portal_session"), summary(passwordLogin.body));
    await assertStatus("invalid password denied",
      await request("/auth/login", { method: "POST", body: { email: emailA, password: "wrong-password" } }), 401);

    const otpAgain = await request("/auth/otp/request", { method: "POST", body: { email: emailA } });
    const otpAgainLoginJar = new Map();
    const otpAgainVerify = await request("/auth/otp/verify", {
      method: "POST", body: { email: emailA, code: otpAgain.body?._dev_code }, jar: otpAgainLoginJar,
    });
    record("OTP login after password setup",
      otpAgain.status === 200 && otpAgainVerify.status === 200 && otpAgainLoginJar.has("portal_session"),
      summary(otpAgainVerify.body));

    const oldSessionJar = new Map(passwordLoginJar);
    await assertStatus("logout", await request("/auth/logout", { method: "POST", jar: passwordLoginJar }), 200);
    const oldSession = await request("/auth/me", { jar: oldSessionJar });
    await assertStatus("old session rejected", oldSession, [401, 403]);
    record("logout cookie cleared", !passwordLoginJar.has("portal_session"), "client jar no longer has session cookie");
  } catch (error) {
    record("harness execution", false, error instanceof Error ? error.message : String(error));
  } finally {
    await cleanup();
    await pool.end();
  }

  const passed = steps.filter((step) => step.pass).length;
  const failed = steps.filter((step) => !step.pass).length;
  console.log(JSON.stringify({ marker, passed, failed, steps }, null, 2));
  process.exitCode = failed ? 1 : 0;
}

await run();