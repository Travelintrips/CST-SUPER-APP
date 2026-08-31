/**
 * Development-only Customer Portal → Admin/BizPortal all-services proof.
 *
 * This harness intentionally creates data through the public/canonical HTTP
 * routes. It never writes fixture rows directly. Every fixture is tagged with
 * one unique marker and is removed in finally, including FK descendants.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";

const API = process.env.PROOF_API_URL ?? "http://127.0.0.1:8080";
const marker = `AUDIT-ADMIN-ALL-SERVICES-${randomUUID()}`;
const safeMode = String(process.env.SAFE_DEV_TEST_MODE).toLowerCase() === "true";
const appEnv = String(process.env.APP_ENV ?? "");

if (appEnv !== "development" || !safeMode || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Refusing to run: this proof requires APP_ENV=development, SAFE_DEV_TEST_MODE=true, and no deployment runtime.");
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

const created = {
  ocean: [],
  air: [],
  trucking: [],
  csr: [],
};
const checks = [];
let adminToken = "";

function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail: detail ? String(detail) : undefined });
  if (!ok) throw new Error(`${name}: ${detail || "assertion failed"}`);
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}

async function http(path, options = {}, expected = [200]) {
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${text.slice(0, 600)}`);
  }
  return { status: response.status, body, headers: response.headers };
}

const adminHeaders = () => ({ authorization: `Bearer ${adminToken}` });

async function db(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function waitForNotifications(ids, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await db(
      `SELECT id, order_id, order_number, dedupe_key, read_at, payload
         FROM admin_notifications
        WHERE payload::text LIKE $1
           OR order_number LIKE $1
           OR customer_name LIKE $1
           OR body LIKE $1
        ORDER BY id`,
      [`%${marker}%`],
    );
    if (ids.every((id) => rows.some((row) => Number(row.order_id) === Number(id)))) return rows;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return db(
    `SELECT id, order_id, order_number, dedupe_key, read_at, payload
       FROM admin_notifications
      WHERE payload::text LIKE $1
         OR order_number LIKE $1
         OR customer_name LIKE $1
         OR body LIKE $1
      ORDER BY id`,
    [`%${marker}%`],
  );
}

async function createCsr(serviceType, label) {
  const draft = await http("/api/customer-service-requests", {
    method: "POST",
    body: JSON.stringify({
      customerName: `${marker} ${label}`,
      customerEmail: `${label.toLowerCase()}-${marker.toLowerCase()}@example.invalid`,
      customerPhone: "081234567890",
      customerCompany: "Audit Fixture Company",
      tradeType: "IMPORT",
      orderMode: "ITEM_MANDIRI",
      pricingMode: "PER_ITEM",
      notes: `${marker} ${label}`,
    }),
  }, [201]);
  const requestId = Number(draft.body.id);
  check(`${label} canonical draft`, Number.isInteger(requestId) && requestId > 0, `request ${requestId}`);

  const item = await http(`/api/customer-service-requests/${requestId}/items`, {
    method: "POST",
    body: JSON.stringify({
      itemType: serviceType,
      title: `${marker} ${label}`,
      description: `${marker} canonical ${label} item`,
    }),
  }, [201]);
  check(`${label} canonical item`, Number(item.body?.id) > 0, `item ${item.body?.id}`);

  const submitted = await http(`/api/customer-service-requests/${requestId}/submit`, {
    method: "POST",
    body: JSON.stringify({}),
  }, [200]);
  check(`${label} customer submit`, submitted.body?.status === "submitted", `request ${requestId}`);
  created.csr.push(requestId);
  return requestId;
}

async function createFixtures() {
  const ocean = await http("/api/ocean-freight/inquiry", {
    method: "POST",
    body: JSON.stringify({
      customer_name: `${marker} Ocean`,
      customer_phone: "081234567890",
      customer_email: `ocean-${marker.toLowerCase()}@example.invalid`,
      customer_company: "Audit Fixture Company",
      origin_port: "CNSHA",
      destination_port: "IDJKT",
      origin_city: "Shanghai",
      destination_city: "Jakarta",
      trade_type: "import",
      service_mode: "port_to_port",
      shipment_type: "FCL",
      container_type: "20GP",
      container_qty: 1,
      gross_weight: 1000,
      koli: 10,
      commodity: `${marker} Ocean Cargo`,
      notes: marker,
    }),
  }, [201]);
  created.ocean.push(Number(ocean.body?.id));
  check("Ocean Freight customer submit", Number(ocean.body?.id) > 0, `order ${ocean.body?.id}`);

  const air = await http("/api/air-freight/public/orders", {
    method: "POST",
    body: JSON.stringify({
      customer_name: `${marker} Air`,
      customer_phone: "081234567890",
      customer_email: `air-${marker.toLowerCase()}@example.invalid`,
      company_name: "Audit Fixture Company",
      origin_city: "Jakarta",
      origin_airport: "CGK",
      destination_city: "Singapore",
      destination_airport: "SIN",
      trade_type: "export",
      service_mode: "airport_to_airport",
      service_level: "standard",
      incoterm: "EXW",
      commodity: `${marker} Air Cargo`,
      cargo_type: "general",
      gross_weight: 25,
      chargeable_weight: 25,
      koli: 2,
      notes: marker,
    }),
  }, [201]);
  created.air.push(Number(air.body?.id));
  check("Air Freight customer submit", Number(air.body?.id) > 0, `order ${air.body?.id}`);

  const trucking = await http("/api/trucking/bookings", {
    method: "POST",
    body: JSON.stringify({
      vehicleType: "CDE",
      vehicleName: `${marker} CDE`,
      areaPickup: "jawa-sumatra",
      alamatPickup: `${marker} Pickup`,
      picPickup: `${marker} Trucking`,
      hpPickup: "081234567890",
      areaDelivery: "jawa-sumatra",
      alamatDelivery: `${marker} Delivery`,
      picPenerima: `${marker} Receiver`,
      hpPenerima: "081234567891",
      jadwalType: "nanti",
      tanggalPickup: "2026-09-01",
      jamPickup: "10:00",
      jenisBarang: `${marker} Cargo`,
      beratKg: 500,
      jumlahKoli: 5,
      volumeM3: 2,
      catatan: marker,
      jumlahTrip: 1,
      addons: {},
      estimasiTotal: 100000,
      estimatedDistanceKm: 20,
      estimatedPrice: 100000,
      candidateVendorIds: [35],
      source: "customer_portal",
    }),
  }, [201]);
  created.trucking.push(Number(trucking.body?.id));
  check("Domestic/Trucking customer submit", Number(trucking.body?.id) > 0, `booking ${trucking.body?.id}`);

  created.csr.push(await createCsr("ppjk", "Pabean"));
  created.csr.push(await createCsr("ppjk", "Custom Clearance"));
}

function rowFor(data, service, id) {
  return data.find((row) => row.service_key === service && Number(row.id) === Number(id));
}

async function proveAdminReadModel() {
  const all = await http("/api/portal/admin/service-operations?service=all&limit=100", {
    headers: adminHeaders(),
  });
  const data = all.body?.data ?? [];
  check("Admin Customer Portal all-services list", created.ocean.concat(created.air, created.trucking, created.csr)
    .every((id) => data.some((row) => Number(row.id) === Number(id))), `found ${data.length} rows`);
  check("Admin unread badge/count", Number(all.body?.unreadNotifications) >= 5, `unread=${all.body?.unreadNotifications}`);

  const mappings = [
    ["ocean-freight", created.ocean[0], "Ocean Freight"],
    ["air-freight", created.air[0], "Air Freight"],
    ["domestic-trucking", created.trucking[0], "Domestic/Trucking"],
    ["service-request", created.csr[0], "Pabean"],
    ["service-request", created.csr[1], "Custom Clearance"],
  ];
  for (const [service, id, label] of mappings) {
    const row = rowFor(data, service, id);
    check(`${label} Admin visibility`, Boolean(row), `service=${service}, id=${id}`);
    check(`${label} Admin management path`, Boolean(row?.management_path), row?.management_path ?? "");

    const searched = await http(`/api/portal/admin/service-operations?search=${encodeURIComponent(marker)}&limit=100`, {
      headers: adminHeaders(),
    });
    check(`${label} search/filter`, searched.body?.data?.some((r) => Number(r.id) === Number(id)), `search rows=${searched.body?.data?.length}`);

    const filtered = await http(`/api/portal/admin/service-operations?service=${service}&limit=100`, {
      headers: adminHeaders(),
    });
    check(`${label} service filter`, filtered.body?.data?.some((r) => Number(r.id) === Number(id)), `service=${service}`);

    const detail = await http(`/api/portal/admin/service-operations/${service}/${id}`, {
      headers: adminHeaders(),
    });
    check(`${label} detail`, Number(detail.body?.id) === Number(id), `detail id=${detail.body?.id}`);
  }

  for (const [service, id, label] of mappings) {
    const sourceStatus = service === "ocean-freight" ? "waiting_rate"
      : service === "air-freight" ? "waiting_rate"
      : service === "domestic-trucking" ? "pending_review"
      : "submitted";
    const filtered = await http(`/api/portal/admin/service-operations?service=${service}&status=${sourceStatus}&limit=100`, {
      headers: adminHeaders(),
    });
    check(`${label} status filter`, filtered.body?.data?.some((r) => Number(r.id) === Number(id)), `status=${sourceStatus}`);
  }

  // The shared read model is the exact data contract consumed by BizPortal.
  check("BizPortal canonical ID continuity", mappings.every(([service, id]) => {
    const row = rowFor(data, service, id);
    return row && row.management_path.includes(String(id));
  }));
}

async function proveNotifications() {
  const ids = created.ocean.concat(created.air, created.trucking, created.csr);
  const before = await waitForNotifications(ids);
  check("Admin notification generated per canonical submit", ids.every((id) =>
    before.some((row) => Number(row.order_id) === Number(id))), `notifications=${before.length}`);

  const row = before.find((candidate) => Number(candidate.order_id) === Number(created.ocean[0]));
  check("Notification dedupe key persisted", Boolean(row?.dedupe_key), row?.dedupe_key ?? "");
  const countBefore = Number((await db(
    "SELECT COUNT(*)::int AS count FROM admin_notifications WHERE dedupe_key = $1",
    [row.dedupe_key],
  ))[0].count);

  // Re-submit the exact logical event through the canonical notification
  // service; ON CONFLICT must keep one row and no second unread badge.
  const payload = row.payload ?? {};
  const duplicatePayload = {
    ...payload,
    type: "portal_service_submitted",
    orderId: Number(created.ocean[0]),
    orderNumber: row.order_number,
    customerName: `${marker} Ocean`,
    companyName: "Audit Fixture Company",
    serviceKey: "ocean-freight",
    dedupeKey: row.dedupe_key,
    title: "Duplicate proof event",
    body: marker,
  };
  await db("SELECT 1");
  const duplicateScript = `
    import { NotificationService } from "../src/lib/services/notificationService.ts";
    await NotificationService.saveAndBroadcast("admin_notification", ${JSON.stringify(duplicatePayload)});
  `;
  const artifactDir = new URL("..", import.meta.url).pathname;
  const entryPath = `${artifactDir}/scripts/.all-services-notification-proof-entry.ts`;
  const bundlePath = `${artifactDir}/scripts/.all-services-notification-proof.mjs`;
  await writeFile(entryPath, duplicateScript);
  await new Promise((resolve, reject) => {
    execFile("pnpm", ["exec", "esbuild", "--bundle", "--platform=node", "--format=esm",
      "--packages=bundle", "--external:pg", "--external:pino", "--external:pino-pretty",
      "--external:thread-stream", "--external:ws", `--outfile=${bundlePath}`, entryPath], {
      cwd: artifactDir,
    }, (error) => error ? reject(error) : resolve());
  });
  await new Promise((resolve, reject) => {
    execFile("node", [bundlePath], {
      cwd: artifactDir,
      env: process.env,
    }, (error) => error ? reject(error) : resolve());
  });
  await rm(entryPath, { force: true });
  await rm(bundlePath, { force: true });
  const countAfter = Number((await db(
    "SELECT COUNT(*)::int AS count FROM admin_notifications WHERE dedupe_key = $1",
    [row.dedupe_key],
  ))[0].count);
  check("Notification duplicate dedupe", countAfter === countBefore, `${countBefore} → ${countAfter}`);

  const notificationList = await http("/api/portal/admin/service-operations/notifications?limit=100", {
    headers: adminHeaders(),
  });
  check("Notification center list", notificationList.body?.data?.some((n) => Number(n.order_id) === Number(created.ocean[0])));
  const beforeBadge = await http("/api/portal/admin/service-operations?limit=100", {
    headers: adminHeaders(),
  });
  const unreadBeforeRead = Number(beforeBadge.body?.unreadNotifications ?? 0);

  const notificationId = Number(row.id);
  await http(`/api/portal/admin/service-operations/notifications/${notificationId}/read`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({}),
  });
  const afterRead = await db("SELECT read_at FROM admin_notifications WHERE id = $1", [notificationId]);
  check("Notification read state", Boolean(afterRead[0]?.read_at));
  const afterReadList = await http("/api/portal/admin/service-operations?limit=100", {
    headers: adminHeaders(),
  });
  check("Unread badge decreases after read",
    Number(afterReadList.body?.unreadNotifications) < unreadBeforeRead,
    `${unreadBeforeRead} → ${afterReadList.body?.unreadNotifications}`);
}

async function proveVendorDiscovery() {
  const ppjk = await http("/api/ppjk/vendors", { headers: adminHeaders() });
  const ppjkVendors = ppjk.body?.vendors ?? [];
  check("Pabean/Customs vendor discovery", ppjkVendors.some((v) => Number(v.id) === 36), "PT Wangsamas eligible");
  check("Custom Clearance vendor discovery excludes non-capability vendor",
    !ppjkVendors.some((v) => Number(v.id) === 35), "PT Diva Servis excluded from customs");

  const delivery = await http("/api/portal/delivery-vendors");
  const deliveryVendors = Array.isArray(delivery.body) ? delivery.body : (delivery.body?.vendors ?? []);
  const diva = deliveryVendors.find((v) => Number(v.id) === 35);
  const wangsamas = deliveryVendors.find((v) => Number(v.id) === 36);
  check("Trucking vendor discovery includes active capability", Boolean(diva), "PT Diva Servis listed");
  check("Trucking eligibility does not over-claim Wangsamas", !wangsamas || String(wangsamas.service_type ?? "").toLowerCase().includes("trucking") === false,
    "PT Wangsamas is not a trucking capability");
}

async function proveRbac() {
  const unauth = await http("/api/portal/admin/service-operations?limit=1", {}, [401, 403]);
  check("Admin workload unauthenticated RBAC", [401, 403].includes(unauth.status), `HTTP ${unauth.status}`);
  const customer = await http("/api/portal/auth/dev-login", {
    method: "POST",
    body: JSON.stringify({ role: "customer" }),
  }, [200]);
  const customerCheck = await http("/api/portal/admin/service-operations?limit=1", {
    headers: { authorization: `Bearer ${customer.body.token}` },
  }, [401, 403]);
  check("Admin workload customer RBAC", [401, 403].includes(customerCheck.status), `HTTP ${customerCheck.status}`);
  const vendor = await http("/api/portal/auth/dev-login", {
    method: "POST",
    body: JSON.stringify({ role: "vendor" }),
  }, [200]);
  const vendorCheck = await http("/api/portal/admin/service-operations?limit=1", {
    headers: { authorization: `Bearer ${vendor.body.token}` },
  }, [401, 403]);
  check("Admin workload vendor RBAC", [401, 403].includes(vendorCheck.status), `HTTP ${vendorCheck.status}`);
}

async function cleanup() {
  // Resolve marker parents from their identifying customer fields. This is
  // deliberately explicit and development-only; no global deletes or IDs from
  // another run are accepted.
  const roots = {
    ocean_freight_orders: (await db("SELECT id FROM ocean_freight_orders WHERE customer_name LIKE $1", [`${marker}%`])).map((r) => Number(r.id)),
    air_freight_orders: (await db("SELECT id FROM air_freight_orders WHERE customer_name LIKE $1", [`${marker}%`])).map((r) => Number(r.id)),
    trucking_booking_requests: (await db("SELECT id FROM trucking_booking_requests WHERE pic_pickup LIKE $1 OR catatan LIKE $1", [`${marker}%`])).map((r) => Number(r.id)),
    customer_service_requests: (await db("SELECT id FROM customer_service_requests WHERE customer_name LIKE $1 OR notes LIKE $1", [`${marker}%`])).map((r) => Number(r.id)),
  };
  const rootEntries = Object.entries(roots).filter(([, ids]) => ids.length);
  if (!rootEntries.length) return { roots: 0, descendants: 0, notifications: 0 };

  const client = await pool.connect();
  let descendants = 0;
  try {
    await client.query("BEGIN");
    const edges = [];
    const queue = rootEntries.map(([table, ids]) => ({ table, ids, depth: 0 }));
    const visited = new Set(queue.map(({ table, ids }) => `${table}:${ids.join(",")}`));
    while (queue.length) {
      const current = queue.shift();
      const refs = await client.query(`
        SELECT child.relname AS child_table, child_att.attname AS child_column,
               parent.relname AS parent_table, parent_att.attname AS parent_column
          FROM pg_constraint c
          JOIN pg_class child ON child.oid = c.conrelid
          JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
          JOIN pg_class parent ON parent.oid = c.confrelid
          JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
          JOIN LATERAL unnest(c.conkey) WITH ORDINALITY ck(attnum, ord) ON TRUE
          JOIN LATERAL unnest(c.confkey) WITH ORDINALITY pk(attnum, ord) ON pk.ord = ck.ord
          JOIN pg_attribute child_att ON child_att.attrelid = child.oid AND child_att.attnum = ck.attnum
          JOIN pg_attribute parent_att ON parent_att.attrelid = parent.oid AND parent_att.attnum = pk.attnum
         WHERE c.contype = 'f' AND cardinality(c.conkey) = 1 AND cardinality(c.confkey) = 1
           AND child_ns.nspname = 'public' AND parent_ns.nspname = 'public'
           AND parent.relname = $1`, [current.table]);
      for (const ref of refs.rows) {
        const childTable = `"${ref.child_table.replaceAll('"', '""')}"`;
        const childColumn = `"${ref.child_column.replaceAll('"', '""')}"`;
        const result = await client.query(
          `SELECT * FROM ${childTable} WHERE ${childColumn} = ANY($1::int[])`,
          [current.ids],
        );
        if (!result.rows.length) continue;
        edges.push({ ...ref, parentIds: current.ids, depth: current.depth + 1 });
        descendants += result.rows.length;
        const childIds = result.rows.map((row) => Number(row.id)).filter(Number.isInteger);
        if (childIds.length) {
          const key = `${ref.child_table}:${childIds.join(",")}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push({ table: ref.child_table, ids: childIds, depth: current.depth + 1 });
          }
        }
      }
    }
    for (const edge of edges.sort((a, b) => b.depth - a.depth)) {
      const table = `"${edge.child_table.replaceAll('"', '""')}"`;
      const column = `"${edge.child_column.replaceAll('"', '""')}"`;
      await client.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::int[])`, [edge.parentIds]);
    }
    for (const [table, ids] of rootEntries) {
      await client.query(`DELETE FROM "${table}" WHERE id = ANY($1::int[])`, [ids]);
    }
    await client.query(
      `DELETE FROM admin_notifications
        WHERE payload::text LIKE $1 OR order_number LIKE $1 OR customer_name LIKE $1
           OR company_name LIKE $1 OR body LIKE $1`,
      [`%${marker}%`],
    );
    await client.query("COMMIT");
    const remaining = await client.query(
      `SELECT COUNT(*)::int AS count FROM admin_notifications
        WHERE payload::text LIKE $1 OR order_number LIKE $1 OR customer_name LIKE $1
           OR company_name LIKE $1 OR body LIKE $1`,
      [`%${marker}%`],
    );
    if (Number(remaining.rows[0].count) !== 0) throw new Error("marker notification cleanup incomplete");
    return { roots: rootEntries.reduce((n, [, ids]) => n + ids.length, 0), descendants, notifications: 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  console.log(`Starting development-only proof with marker ${marker}`);
  const login = await http("/api/portal/auth/dev-login", {
    method: "POST",
    body: JSON.stringify({ role: "admin" }),
  }, [200]);
  adminToken = String(login.body?.token ?? "");
  check("Development admin session", Boolean(adminToken));
  await createFixtures();
  await proveAdminReadModel();
  await proveNotifications();
  await proveVendorDiscovery();
  await proveRbac();
  console.log(JSON.stringify({ marker, verdict: "PASS", checks: checks.length }, null, 2));
}

try {
  await main();
} finally {
  const result = await cleanup();
  console.log(`CLEANUP roots=${result.roots} descendants=${result.descendants} notifications=${result.notifications}`);
  await pool.end();
}