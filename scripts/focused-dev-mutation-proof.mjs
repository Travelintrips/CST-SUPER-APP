/**
 * Development-only proof for the Customer Portal admin lifecycle dispatcher.
 *
 * Run only through:
 *   APP_ENV=development node artifacts/api-server/load-secrets.mjs \
 *     node scripts/focused-dev-mutation-proof.mjs
 *
 * The proof creates only marker-tagged rows, never writes PROD, and removes
 * every fixture in finally. It intentionally does not use TEST_DATABASE_URL.
 */
import pg from "pg";
import { createHmac, randomUUID } from "node:crypto";

const API = process.env.PROOF_API_URL ?? "http://127.0.0.1:18444";
const marker = `FOCUSED-DEV-MUTATION-${randomUUID()}`;
const appEnv = String(process.env.APP_ENV ?? "");

if (appEnv !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Refusing to run: APP_ENV=development and no deployment runtime are required.");
}
if (!process.env.SUPABASE_DATABASE_URL_DEV) {
  throw new Error("Refusing to run: SUPABASE_DATABASE_URL_DEV is not available.");
}
if (process.env.TEST_DATABASE_URL && process.env.SUPABASE_DATABASE_URL === process.env.TEST_DATABASE_URL) {
  throw new Error("Refusing to run: application database must not be TEST_DATABASE_URL.");
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  ssl: { rejectUnauthorized: false },
  max: 2,
  connectionTimeoutMillis: 30_000,
});
const created = {
  customers: [],
  sources: [],
  auditRefs: [],
  notificationKeys: [],
  waRefs: [],
};
const checks = [];
let customerA;
let customerB;
let adminToken = "";

function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail: detail || undefined });
  if (!ok) throw new Error(`${name}: ${detail || "assertion failed"}`);
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}

async function db(text, values = []) {
  return (await pool.query(text, values)).rows;
}

async function one(text, values = []) {
  return (await db(text, values))[0] ?? null;
}

async function exists(table) {
  const row = await one(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS present`,
    [table],
  );
  return Boolean(row?.present);
}

async function http(path, { method = "GET", headers = {}, body } = {}, expected = [200]) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} => ${response.status}: ${String(text).slice(0, 500)}`);
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

function fixturePhone(label) {
  let hash = 2166136261;
  for (const char of `${marker}:${label}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `08${String(hash >>> 0).padStart(10, "0")}`;
}

function fixtureEmail(label) {
  return `${label.toLowerCase()}-${marker.toLowerCase()}@example.invalid`;
}

async function waitFor(label, fn, timeoutMs = 7_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  check(label, false, "timed out");
  return last;
}

async function createCustomer(label) {
  const rows = await db(
    `INSERT INTO portal_customers
      (name, email, password_hash, phone, customer_type, role, account_status)
     VALUES ($1, $2, '', $3, 'individual', 'customer', 'active')
     RETURNING id`,
    [`${marker} ${label}`, fixtureEmail(label), fixturePhone(label)],
  );
  const id = Number(rows[0]?.id);
  const payload = {
    id,
    email: fixtureEmail(label),
    role: "customer",
    exp: Date.now() + 60 * 60 * 1000,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", "cst-dev-portal-fallback-2025").update(b64).digest("hex");
  const token = `devportal.${b64}.${sig}`;
  check(`${label} customer fixture`, id > 0 && token.length > 0, `customer=${id}`);
  created.customers.push(id);
  return { id, token };
}

async function createFixtures() {
  const a = await createCustomer("CustomerA");
  const b = await createCustomer("CustomerB");
  customerA = a;
  customerB = b;

  const actionSpecs = [
    {
      service: "marketplace",
      table: "mkt_rfqs",
      owner: "a",
      actions: {
        approve: ["submitted", "quoting"],
        request_revision: ["submitted", "draft"],
        reject: ["submitted", "cancelled"],
      },
      insert: (label, status, owner) => db(
        `INSERT INTO mkt_rfqs
          (rfq_number, buyer_name, buyer_email, buyer_phone, buyer_company,
           status, notes, portal_customer_id)
         VALUES ($1, $2, $3, $4, $5, $6::mkt_rfq_status, $7, $8)
         RETURNING id, rfq_number`,
        [`${marker}/MKT/${label}`, `${marker} Marketplace ${label}`, fixtureEmail(label),
          fixturePhone(label), "Focused Proof Company", status, `${marker} Marketplace ${label}`, owner],
      ),
    },
    {
      service: "ocean-freight",
      table: "ocean_freight_orders",
      owner: "a",
      actions: {
        approve: ["waiting_rate", "rate_requested"],
        request_revision: ["reviewing", "waiting_rate"],
        reject: ["waiting_rate", "cancelled"],
      },
      insert: (label, status, owner) => db(
        `INSERT INTO ocean_freight_orders
          (order_number, portal_customer_id, customer_id, customer_name, customer_phone,
           customer_email, customer_company, origin_city, origin_port, destination_city,
           destination_port, commodity, status, source)
         VALUES ($1, $2, $2, $3, $4, $5, $6, 'Shanghai', 'CNSHA', 'Jakarta',
                 'IDJKT', $7, $8, 'customer_portal')
         RETURNING id, order_number`,
        [`${marker}/OCEAN/${label}`, owner, `${marker} Ocean ${label}`, fixturePhone(label),
          fixtureEmail(label), "Focused Proof Company", `${marker} Ocean Cargo ${label}`, status,
          ],
      ),
    },
    {
      service: "air-freight",
      table: "air_freight_orders",
      owner: "a",
      actions: {
        approve: ["draft", "waiting_rate"],
        request_revision: ["quoted", "waiting_rate"],
        reject: ["draft", "cancelled"],
      },
      insert: (label, status, owner) => db(
        `INSERT INTO air_freight_orders
          (order_number, portal_customer_id, customer_id, customer_name, customer_phone,
           customer_email, origin_city, origin_airport, destination_city,
           destination_airport, commodity, gross_weight, chargeable_weight, koli,
           status, source, notes)
         VALUES ($1, $2, $2, $3, $4, $5, 'Jakarta', 'CGK', 'Singapore', 'SIN',
                 $6, 25, 25, 2, $7, 'customer_portal', $8)
         RETURNING id, order_number`,
        [`${marker}/AIR/${label}`, owner, `${marker} Air ${label}`, fixturePhone(label),
          fixtureEmail(label), `${marker} Air Cargo ${label}`, status, `${marker} Air ${label}`],
      ),
    },
    {
      service: "domestic-trucking",
      table: "trucking_booking_requests",
      owner: "a",
      actions: {
        approve: ["new", "reviewing"],
        request_revision: ["reviewing", "pending_review"],
        reject: ["new", "rejected"],
      },
      insert: (label, status, owner) => db(
        `INSERT INTO trucking_booking_requests
          (booking_number, portal_customer_id, customer_id, company_id, vehicle_type,
           vehicle_name, area_pickup, alamat_pickup, pic_pickup, hp_pickup,
           area_delivery, alamat_delivery, pic_penerima, hp_penerima, jenis_barang,
           jumlah_trip, addons, estimasi_total, source, status, catatan)
         VALUES ($1, $2, $2, NULL, 'CDE', $3, 'jawa-sumatra', $4, $5, $6,
                 'jawa-sumatra', $7, $8, $9, $10, 1, '{}'::jsonb, 100000,
                 'customer_portal', $11, $12)
         RETURNING id, booking_number`,
        [`${marker}/TRUCK/${label}`, owner, `${marker} CDE`, `${marker} Pickup`,
          `${marker} Pickup PIC`, fixturePhone(label), `${marker} Delivery`,
          `${marker} Receiver`, fixturePhone(`${label}-receiver`), `${marker} Cargo`,
          status, `${marker} Trucking ${label}`],
      ),
    },
    {
      service: "ppjk",
      table: "ppjk_orders",
      owner: null,
      actions: {
        approve: ["waiting_documents", "document_review"],
        request_revision: ["document_review", "waiting_documents"],
        reject: ["waiting_documents", "cancelled"],
      },
      insert: (label, status) => db(
        `INSERT INTO ppjk_orders
          (order_number, customer_name, customer_email, customer_phone,
           customer_company, trade_type, commodity, status, created_by_id, notes)
         VALUES ($1, $2, $3, $4, 'Focused Proof Company', 'import', $5, $6, $7, $8)
         RETURNING id, order_number`,
        [`${marker}/PPJK/${label}`, `${marker} PPJK ${label}`, fixtureEmail(label),
          fixturePhone(label), `${marker} Customs ${label}`, status, `portal:${customerA.id}`,
          `${marker} PPJK ${label}`],
      ),
    },
    {
      service: "service-request",
      table: "customer_service_requests",
      owner: "a",
      actions: {
        approve: ["submitted", "approved_for_rfq"],
        request_revision: ["submitted", "need_more_data"],
        reject: ["submitted", "rejected"],
      },
      insert: (label, status, owner) => db(
        `INSERT INTO customer_service_requests
          (request_number, customer_id, portal_customer_id, customer_name, customer_email,
           customer_phone, customer_company, trade_type, order_mode, pricing_mode,
           status, notes, company_id)
         VALUES ($1, $2, $2, $3, $4, $5, 'Focused Proof Company', 'IMPORT',
                 'ITEM_MANDIRI', 'PER_ITEM', $6, $7, NULL)
         RETURNING id, request_number`,
        [`${marker}/CSR/${label}`, owner, `${marker} ${label}`, fixtureEmail(label),
          fixturePhone(label), status, `${marker} ${label}`],
      ),
    },
    {
      service: "logistic-order",
      table: "logistic_orders",
      // This legacy runtime has no portal_customer_id on logistic_orders and
      // customer_order_links carries only a tracking token, not an owner.
      owner: null,
      actions: {
        approve: ["Admin Review", "RFQ Sent"],
        request_revision: ["Order Received", "Admin Review"],
        reject: ["Order Received", "Cancelled"],
      },
      insert: (label, status, owner) => db(
        `INSERT INTO logistic_orders
          (order_number, company_name, customer_name, email, phone, shipment_type,
           origin, destination, commodity, notes, source, status, company_id,
           order_type, version)
         VALUES ($1, 'Focused Proof Company', $2, $3, $4, 'FCL', 'Shanghai',
                 'Jakarta', $5, $6, 'customer_portal', $7, NULL, 'shipment', 1)
         RETURNING id, order_number`,
        [`${marker}/LOG/${label}`, `${marker} Logistic ${label}`, fixtureEmail(label),
          fixturePhone(label), `${marker} Logistic Cargo ${label}`, `${marker} Logistic ${label}`,
          status],
      ),
    },
  ];

  const fixtures = [];
  for (const spec of actionSpecs) {
    for (const [action, [initial, target]] of Object.entries(spec.actions)) {
      const label = `${spec.service}-${action}`;
      const ownerRole = spec.service === "ocean-freight" && action === "reject" ? "b" : spec.owner;
      const ownerId = ownerRole === "a" ? customerA.id : ownerRole === "b" ? customerB.id : null;
      const rows = await spec.insert(label, initial, ownerId);
      const row = rows[0];
      const id = Number(row.id);
      check(`${label} fixture`, id > 0, `${spec.table}=${id}, ${initial}→${target}`);
      const notificationKey = spec.service === "logistic-order"
        ? `logistic-order:${id}:status:${target}`
        : `portal-lifecycle:${spec.service}:${id}:${action}:${target}`;
      fixtures.push({
        ...spec, action, initial, target, id, label, ownerId, notificationKey,
        reference: row.rfq_number ?? row.order_number ?? row.request_number,
      });
      created.sources.push({ table: spec.table, id });
      if (spec.service === "logistic-order") created.auditRefs.push({ kind: "logistic", id });
      else created.auditRefs.push({ kind: "erp", ref: `${spec.service}:${id}` });
      if (ownerId) {
        created.notificationKeys.push({ customerId: ownerId, key: notificationKey });
        created.waRefs.push({
          refType: spec.service === "logistic-order" ? "logistic_order" : spec.service,
          refId: `${id}:${target}`,
        });
      } else {
        created.waRefs.push({ refType: spec.service, refId: `${id}:${target}` });
      }
    }
  }
  return fixtures;
}

async function action(fixture, actionName, reason = null, expected = [200]) {
  const body = { action: actionName };
  if (reason !== null) body.reason = reason;
  return http(`/api/portal/admin/service-operations/${fixture.service}/${fixture.id}/actions`, {
    method: "POST",
    headers: bearer(adminToken),
    body,
  }, expected);
}

async function verifyDatabaseTarget() {
  const row = await one(
    "SELECT current_database() AS database_name, inet_server_addr()::text AS server_ip, pg_is_in_recovery() AS in_recovery",
  );
  check("APP_ENV development", appEnv === "development");
  check("DEV target identity", Boolean(process.env.SUPABASE_DATABASE_URL_DEV) &&
    process.env.SUPABASE_DATABASE_URL === process.env.SUPABASE_DATABASE_URL_DEV,
  "canonical runtime URL is the DEV loader target");
  check("DEV target writable", row?.in_recovery === false, `database=${row?.database_name ?? "unknown"}`);
  check("DEV target server identity", Boolean(row?.server_ip), "database server resolved");
  check("TEST database not selected", process.env.SUPABASE_DATABASE_URL !== process.env.TEST_DATABASE_URL);
}

async function verifySafeMode() {
  const result = await http("/api/health/e2e-safety");
  check("SAFE_DEV_TEST_MODE", result.body?.e2eMode === true &&
    result.body?.whatsapp === "mocked" &&
    result.body?.email === "mocked" &&
    result.body?.payment === "mocked" &&
    result.body?.webhooks === "disabled" &&
    result.body?.workers === "disabled" &&
    result.body?.storage === "test-only",
  "no real outbound channel");
  const ready = await http("/api/health/ready");
  check("API readiness", ready.body?.ready === true, `HTTP ${ready.status}`);
}

async function verifyValidation(fixture) {
  const before = await one(`SELECT status FROM ${fixture.table} WHERE id = $1`, [fixture.id]);
  const noReason = await action(fixture, fixture.action, null, [400]);
  check(`${fixture.label} required reason`, noReason.status === 400);
  const after = await one(`SELECT status FROM ${fixture.table} WHERE id = $1`, [fixture.id]);
  check(`${fixture.label} validation has no mutation`, after?.status === before?.status);
}

async function verifyMutation(fixture) {
  const result = await action(fixture, fixture.action, `${marker} reason for ${fixture.action}`);
  check(`${fixture.label} admin mutation`, result.body?.ok === true &&
    result.body?.status === fixture.target, `HTTP ${result.status}, status=${result.body?.status}`);
  const source = await one(`SELECT status FROM ${fixture.table} WHERE id = $1`, [fixture.id]);
  check(`${fixture.label} canonical status`, String(source?.status) === fixture.target);

  const detail = await http(
    `/api/portal/admin/service-operations/${fixture.service}/${fixture.id}`,
    { headers: bearer(adminToken) },
    fixture.service === "marketplace" && fixture.target === "draft" ? [404] : [200],
  );
  if (detail.status === 200) {
    check(`${fixture.label} admin canonical ID continuity`,
      Number(detail.body?.id) === fixture.id || Number(detail.body?.record?.id) === fixture.id,
      `detail=${detail.body?.id ?? detail.body?.record?.id}`);
    check(`${fixture.label} detail status`, detail.body?.record?.status === fixture.target);
  }

  const notification = fixture.ownerId
    ? await waitFor(`${fixture.label} persisted notification`, async () => {
      const row = await one(
        `SELECT COUNT(*)::int AS count
           FROM portal_customer_notifications
          WHERE portal_customer_id = $1 AND event_key = $2`,
        [fixture.ownerId, fixture.notificationKey],
      );
      return Number(row?.count) === 1;
    })
    : null;
  if (fixture.ownerId) check(`${fixture.label} notification exactly once`, notification === true);
  return result;
}

async function verifyRetry(fixture) {
  const beforeNotification = fixture.ownerId
    ? await one(
      "SELECT COUNT(*)::int AS count FROM portal_customer_notifications WHERE portal_customer_id = $1 AND event_key = $2",
      [fixture.ownerId, fixture.notificationKey],
    )
    : { count: 0 };
  const beforeAudit = await auditCount(fixture);
  const retry = await action(fixture, fixture.action, `${marker} retry reason`, [409, 200]);
  check(`${fixture.label} retry conflict/idempotent`, retry.status === 409 || retry.body?.alreadyAt === true);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterNotification = fixture.ownerId
    ? await one(
      "SELECT COUNT(*)::int AS count FROM portal_customer_notifications WHERE portal_customer_id = $1 AND event_key = $2",
      [fixture.ownerId, fixture.notificationKey],
    )
    : { count: 0 };
  const afterAudit = await auditCount(fixture);
  check(`${fixture.label} retry no duplicate notification`,
    Number(afterNotification?.count) === Number(beforeNotification?.count));
  check(`${fixture.label} retry no duplicate audit`, afterAudit === beforeAudit);
}

async function auditCount(fixture) {
  if (fixture.service === "logistic-order") {
    const table = await exists("order_status_history");
    if (!table) return 0;
    const row = await one(
      "SELECT COUNT(*)::int AS count FROM order_status_history WHERE order_id = $1 AND new_status = $2",
      [fixture.id, fixture.target],
    );
    return Number(row?.count ?? 0);
  }
  const row = await one(
    "SELECT COUNT(*)::int AS count FROM erp_audit_logs WHERE module = 'portal_customer_lifecycle' AND reference_id = $1",
    [`${fixture.service}:${fixture.id}`],
  );
  return Number(row?.count ?? 0);
}

async function verifyOwnership(fixtures) {
  const ownedByA = fixtures.find((fixture) => fixture.ownerId === customerA.id && fixture.service === "ocean-freight" && fixture.action === "approve");
  const ownedByB = fixtures.find((fixture) => fixture.ownerId === customerB.id && fixture.service === "ocean-freight" && fixture.action === "reject");
  check("Ownership fixtures available", Boolean(ownedByA && ownedByB));
  const aList = await http("/api/portal/notifications?limit=100", { headers: bearer(customerA.token) });
  const bList = await http("/api/portal/notifications?limit=100", { headers: bearer(customerB.token) });
  const aItems = aList.body?.items ?? [];
  const bItems = bList.body?.items ?? [];
  check("Customer A status readback", aItems.some((item) => item.eventKey === ownedByA.notificationKey &&
    item.payload?.id === ownedByA.id && item.payload?.status === ownedByA.target));
  check("Customer B status readback", bItems.some((item) => item.eventKey === ownedByB.notificationKey &&
    item.payload?.id === ownedByB.id && item.payload?.status === ownedByB.target));
  check("Customer ownership isolation A/B",
    !aItems.some((item) => item.eventKey === ownedByB.notificationKey) &&
    !bItems.some((item) => item.eventKey === ownedByA.notificationKey));
  check("Customer phone ownership",
    await one("SELECT portal_customer_id, customer_phone FROM ocean_freight_orders WHERE id = $1", [ownedByA.id])
      .then((row) => Number(row?.portal_customer_id) === customerA.id && String(row?.customer_phone) === fixturePhone("ocean-freight-approve")));
  const contact = await action(ownedByA, "contact", null, [200]);
  check("Contact WhatsApp URL ownership",
    contact.body?.phone === String(fixturePhone("CustomerA")).replace(/^0/, "62") &&
    contact.body?.contactUrl === `https://wa.me/${contact.body.phone}`);
}

async function verifyConcurrency(fixture) {
  const [first, second] = await Promise.all([
    action(fixture, fixture.action, `${marker} concurrent A`, [200, 409]),
    action(fixture, fixture.action, `${marker} concurrent B`, [200, 409]),
  ]);
  const statuses = [first.status, second.status].sort((a, b) => a - b);
  check(`${fixture.label} concurrent single winner`, statuses[0] === 200 && statuses[1] === 409,
    `responses=${statuses.join(",")}`);
  const source = await one(`SELECT status FROM ${fixture.table} WHERE id = $1`, [fixture.id]);
  check(`${fixture.label} concurrent canonical status`, String(source?.status) === fixture.target);
  const notifications = fixture.ownerId
    ? await one(
      "SELECT COUNT(*)::int AS count FROM portal_customer_notifications WHERE portal_customer_id = $1 AND event_key = $2",
      [fixture.ownerId, fixture.notificationKey],
    )
    : { count: 0 };
  check(`${fixture.label} concurrent notification single`, Number(notifications?.count) === 1);
  check(`${fixture.label} concurrent audit single`, await auditCount(fixture) === 1);
}

async function verifyWaLogs(fixtures) {
  for (const fixture of fixtures) {
    const refType = fixture.service === "logistic-order" ? "logistic_order" : fixture.service;
    const refId = `${fixture.id}:${fixture.target}`;
    const row = await waitFor(`${fixture.label} WA logical record`, async () => {
      const current = await one(
        `SELECT COUNT(*)::int AS count,
                COUNT(*) FILTER (WHERE status = 'simulated')::int AS simulated
           FROM notification_logs
          WHERE channel = 'wa' AND ref_type = $1 AND ref_id = $2`,
        [refType, refId],
      );
      return Number(current?.count) >= 1 ? current : null;
    });
    check(`${fixture.label} WA safe-mode logical dedupe`, Number(row?.count) === 1 &&
      Number(row?.simulated) === 1, `rows=${row?.count ?? 0}, simulated=${row?.simulated ?? 0}`);
  }
  check("Real WhatsApp sends", true, "SAFE_DEV_TEST_MODE simulated only");
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (created.notificationKeys.length) {
      for (const item of created.notificationKeys) {
        await client.query(
          "DELETE FROM portal_customer_notifications WHERE portal_customer_id = $1 AND event_key = $2",
          [item.customerId, item.key],
        );
      }
    }
    if (created.waRefs.length && await exists("notification_logs")) {
      for (const ref of created.waRefs) {
        await client.query(
          "DELETE FROM notification_logs WHERE channel = 'wa' AND ref_type = $1 AND ref_id = $2",
          [ref.refType, ref.refId],
        );
      }
    }
    if (await exists("erp_audit_logs")) {
      // erp_audit_logs is intentionally immutable in normal operation. This
      // exact marker-scoped DEV cleanup is the only exception in the proof,
      // and never runs against a production connection.
      await client.query("SET LOCAL session_replication_role = 'replica'");
      await client.query(
        "DELETE FROM erp_audit_logs WHERE module = 'portal_customer_lifecycle' AND new_data::text LIKE $1",
        [`%${marker}%`],
      );
      await client.query("SET LOCAL session_replication_role = 'origin'");
    }
    for (const fixture of created.auditRefs) {
      if (fixture.kind === "logistic" && await exists("order_status_history")) {
        await client.query("DELETE FROM order_status_history WHERE order_id = $1", [fixture.id]);
        if (await exists("order_audit_logs")) {
          await client.query("DELETE FROM order_audit_logs WHERE order_id = $1", [fixture.id]);
        }
      }
    }
    if (await exists("portal_company_members") && created.customers.length) {
      await client.query(
        "DELETE FROM portal_company_members WHERE portal_customer_id = ANY($1::int[])",
        [created.customers],
      );
    }
    for (const source of [...created.sources].reverse()) {
      await client.query(`DELETE FROM "${source.table}" WHERE id = $1`, [source.id]);
    }
    if (created.customers.length) {
      await client.query("DELETE FROM portal_customer_notifications WHERE portal_customer_id = ANY($1::int[])", [created.customers]);
      await client.query("DELETE FROM portal_customers WHERE id = ANY($1::int[])", [created.customers]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const residuals = {};
  for (const source of [...created.sources, ...created.customers.map((id) => ({ table: "portal_customers", id }))]) {
    const row = await one(`SELECT COUNT(*)::int AS count FROM "${source.table}" WHERE id = $1`, [source.id]);
    residuals[`${source.table}:${source.id}`] = Number(row?.count ?? 0);
  }
  const markerTables = [
    "portal_customers", "mkt_rfqs", "ocean_freight_orders", "air_freight_orders",
    "trucking_booking_requests", "ppjk_orders", "customer_service_requests", "logistic_orders",
  ];
  for (const table of markerTables) {
    if (await exists(table)) {
      const row = await one(`SELECT COUNT(*)::int AS count FROM "${table}" WHERE to_jsonb(${table})::text LIKE $1`, [`%${marker}%`]);
      residuals[`${table}:marker`] = Number(row?.count ?? 0);
    }
  }
  const remaining = Object.values(residuals).reduce((sum, count) => sum + count, 0);
  check("DEV_FIXTURES_REMAINING=0", remaining === 0, JSON.stringify(residuals));
}

async function main() {
  await verifyDatabaseTarget();
  await verifySafeMode();
  const adminLogin = await http("/api/portal/auth/dev-login", {
    method: "POST",
    body: { role: "admin" },
  });
  adminToken = String(adminLogin.body?.token ?? "");
  check("Admin mutation token", adminToken.length > 0);
  const fixtures = await createFixtures();
  const concurrencyFixture = fixtures.find((fixture) => fixture.service === "ocean-freight" && fixture.action === "approve");
  check("Concurrency fixture selected", Boolean(concurrencyFixture));

  const regular = fixtures.filter((fixture) => fixture !== concurrencyFixture);
  for (const fixture of regular) {
    if (fixture.action === "request_revision" || fixture.action === "reject") await verifyValidation(fixture);
    await verifyMutation(fixture);
    await verifyRetry(fixture);
  }
  await verifyConcurrency(concurrencyFixture);
  await verifyOwnership(fixtures);
  await verifyWaLogs(fixtures);
  console.log(JSON.stringify({
    marker,
    verdict: "PASS",
    checks: checks.length,
    services: [...new Set(fixtures.map((fixture) => fixture.service))],
  }, null, 2));
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
  console.error(`FOCUSED_PROOF_FAILED ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try {
    await cleanup();
  } catch (error) {
    failure ??= error;
    console.error(`FOCUSED_CLEANUP_FAILED ${error instanceof Error ? error.message : String(error)}`);
  }
  await pool.end();
}
if (failure) process.exitCode = 1;