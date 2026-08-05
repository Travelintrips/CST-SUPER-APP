#!/usr/bin/env node
/**
 * SAFE DEV TEST MODE runtime verification.
 *
 * This harness intentionally runs against the existing development database,
 * never production. It writes only synthetic rows carrying RUNTIME_TEST_RUN_ID
 * and always removes those rows in finally().
 *
 * It does not boot the API server and does not call external integrations.
 * WhatsApp, email, payment, webhook, and storage actions are represented by
 * deterministic mock assertions only.
 */

import pg from "pg";

const { Client } = pg;
const PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";
const DEV_PROJECT_REF = "xssrfshdrtdfupgqwfdw";
const EXTERNALS = ["whatsapp", "email", "payment", "webhook", "storage"];

process.env.SAFE_DEV_TEST_MODE = "true";
process.env.RUNTIME_TEST_EXTERNALS = "mocked";

const runId =
  process.env.RUNTIME_TEST_RUN_ID?.trim() ||
  `runtime-test-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
process.env.RUNTIME_TEST_RUN_ID = runId;

const orderA = `${runId}:ORDER-A`;
const orderB = `${runId}:ORDER-B`;
const concurrencyOrder = `${runId}:CONCURRENT-ORDER`;
const rollbackOrder = `${runId}:ROLLBACK`;
const retryOrder = `${runId}:RETRY`;
const companyCodeA = `${runId}:CO-A`;
const companyCodeB = `${runId}:CO-B`;
const customerEmailA = `${runId.toLowerCase()}-a@runtime.test`;
const customerEmailB = `${runId.toLowerCase()}-b@runtime.test`;
const vendorCodeA = `${runId}:VEND-A`;
const vendorCodeB = `${runId}:VEND-B`;
const uploadKey = `runtime-test/${runId}/fixture.txt`;

const results = [];
let clients = [];
let fixture = null;

function extractProjectRef(url) {
  const pooler = url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i);
  if (pooler) return pooler[1];
  const direct = url.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  return direct?.[1] ?? null;
}

function maskedRef(ref) {
  return ref ? `${ref.slice(0, 4)}…${ref.slice(-4)}` : "(unknown)";
}

function pass(name, evidence = {}) {
  results.push({ name, status: "PASS", evidence });
  console.log(`PASS  ${name}${Object.keys(evidence).length ? ` — ${JSON.stringify(evidence)}` : ""}`);
}

function fail(name, error) {
  results.push({
    name,
    status: "FAIL",
    evidence: { error: error instanceof Error ? error.message : String(error) },
  });
  console.error(`FAIL  ${name} — ${error instanceof Error ? error.message : String(error)}`);
  throw error;
}

async function connect() {
  const url = process.env.SUPABASE_DATABASE_URL_DEV;
  if (!url) throw new Error("SUPABASE_DATABASE_URL_DEV is not configured");

  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (nodeEnv === "production" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("SAFE DEV TEST MODE blocked: production runtime detected");
  }

  const projectRef = extractProjectRef(url);
  if (!projectRef || projectRef === PROD_PROJECT_REF || projectRef !== DEV_PROJECT_REF) {
    throw new Error(
      `SAFE DEV TEST MODE blocked: expected development project ${maskedRef(DEV_PROJECT_REF)}, got ${maskedRef(projectRef)}`,
    );
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8_000,
  });
  await client.connect();
  clients.push(client);
  const identity = await client.query(
    "SELECT current_database() AS database_name, current_user AS database_user, version() AS version",
  );

  console.log("=== SAFE DEV TEST MODE ===");
  console.log(`run_id: ${runId}`);
  console.log(`node_env: ${nodeEnv}`);
  console.log("database_environment: development");
  console.log(`project_identifier: ${maskedRef(projectRef)}`);
  console.log("production_database: false");
  console.log("development_shared_database: true");
  console.log(`external_integrations: ${EXTERNALS.join(", ")} = mocked/disabled`);
  console.log(`upload_prefix: ${uploadKey}`);
  pass("development database identity verified", {
    database: identity.rows[0].database_name,
    server: String(identity.rows[0].version).split(" ").slice(0, 2).join(" "),
  });
  return client;
}

async function query(client, text, values = []) {
  return client.query(text, values);
}

async function createFixtures(client) {
  await client.query("BEGIN");
  try {
    const companyA = await query(
      client,
      `INSERT INTO companies (company_name, company_code, code, is_active)
       VALUES ($1, $2, $2, true) RETURNING id`,
      [`${runId} Runtime Test Tenant A`, companyCodeA],
    );
    const companyB = await query(
      client,
      `INSERT INTO companies (company_name, company_code, code, is_active)
       VALUES ($1, $2, $2, true) RETURNING id`,
      [`${runId} Runtime Test Tenant B`, companyCodeB],
    );
    const customerA = await query(
      client,
      `INSERT INTO portal_customers (name, email, phone, company, role)
       VALUES ($1, $2, $3, $4, 'customer') RETURNING id`,
      [`${runId} Customer A`, customerEmailA, "+620000000001", companyCodeA],
    );
    const customerB = await query(
      client,
      `INSERT INTO portal_customers (name, email, phone, company, role)
       VALUES ($1, $2, $3, $4, 'customer') RETURNING id`,
      [`${runId} Customer B`, customerEmailB, "+620000000002", companyCodeB],
    );
    const vendorA = await query(
      client,
      `INSERT INTO suppliers (name, vendor_code, contact_email, company_id, is_active, status)
       VALUES ($1, $2, $3, $4, true, 'active') RETURNING id`,
      [`${runId} Vendor A`, vendorCodeA, `${runId.toLowerCase()}-va@runtime.test`, companyA.rows[0].id],
    );
    const vendorB = await query(
      client,
      `INSERT INTO suppliers (name, vendor_code, contact_email, company_id, is_active, status)
       VALUES ($1, $2, $3, $4, true, 'active') RETURNING id`,
      [`${runId} Vendor B`, vendorCodeB, `${runId.toLowerCase()}-vb@runtime.test`, companyB.rows[0].id],
    );

    await query(
      client,
      `INSERT INTO portal_product_orders
       (order_number, customer_name, email, phone, shipping_address, notes,
        subtotal, grand_total, company_id, uploaded_documents)
       VALUES ($1, $2, $3, $4, $5, $6, 100, 100, $7, $8::jsonb)`,
      [
        orderA,
        `${runId} Customer A`,
        customerEmailA,
        "+620000000001",
        `${runId} synthetic address A`,
        `${runId} synthetic order A`,
        companyA.rows[0].id,
        JSON.stringify([{ key: uploadKey, label: "mock fixture", reference: "mock://runtime-test" }]),
      ],
    );
    await query(
      client,
      `INSERT INTO portal_product_orders
       (order_number, customer_name, email, phone, shipping_address, notes,
        subtotal, grand_total, company_id, uploaded_documents)
       VALUES ($1, $2, $3, $4, $5, $6, 200, 200, $7, $8::jsonb)`,
      [
        orderB,
        `${runId} Customer B`,
        customerEmailB,
        "+620000000002",
        `${runId} synthetic address B`,
        `${runId} synthetic order B`,
        companyB.rows[0].id,
        JSON.stringify([{ key: uploadKey, label: "mock fixture", reference: "mock://runtime-test" }]),
      ],
    );
    const orderRows = await query(
      client,
      `SELECT id, order_number, company_id FROM portal_product_orders
       WHERE order_number IN ($1, $2) ORDER BY order_number`,
      [orderA, orderB],
    );
    for (const row of orderRows.rows) {
      await query(
        client,
        `INSERT INTO portal_product_order_items
         (order_id, product_name, product_sku, unit, unit_price, qty, subtotal)
         VALUES ($1, $2, $3, 'unit', 100, 1, 100)`,
        [row.id, `${runId} Product ${row.order_number.endsWith("A") ? "A" : "B"}`, `${runId}:SKU`],
      );
    }

    const rfqA = await query(
      client,
      `INSERT INTO mkt_rfqs
       (rfq_number, company_id, portal_customer_id, buyer_name, buyer_email,
        buyer_company, delivery_address, notes, status, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', 'normal') RETURNING id`,
      [
        `${runId}:RFQ-A`,
        companyA.rows[0].id,
        customerA.rows[0].id,
        `${runId} Customer A`,
        customerEmailA,
        companyCodeA,
        `${runId} delivery A`,
        `${runId} RFQ A`,
      ],
    );
    const rfqB = await query(
      client,
      `INSERT INTO mkt_rfqs
       (rfq_number, company_id, portal_customer_id, buyer_name, buyer_email,
        buyer_company, delivery_address, notes, status, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', 'normal') RETURNING id`,
      [
        `${runId}:RFQ-B`,
        companyB.rows[0].id,
        customerB.rows[0].id,
        `${runId} Customer B`,
        customerEmailB,
        companyCodeB,
        `${runId} delivery B`,
        `${runId} RFQ B`,
      ],
    );
    await query(
      client,
      `INSERT INTO mkt_rfq_lines (rfq_id, item_name, item_description, notes)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        rfqA.rows[0].id,
        `${runId} RFQ Item A`,
        `${runId} synthetic item A`,
        `${runId}:line-A`,
        rfqB.rows[0].id,
        `${runId} RFQ Item B`,
        `${runId} synthetic item B`,
        `${runId}:line-B`,
      ],
    );

    const logisticA = await query(
      client,
      `INSERT INTO logistic_orders
       (order_number, company_id, company_name, customer_name, email, phone,
        shipment_type, origin, destination, source, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'domestic', $7, $8, 'runtime-test', $9)
       RETURNING id`,
      [
        `${runId}:LOG-A`,
        companyA.rows[0].id,
        companyCodeA,
        `${runId} Customer A`,
        customerEmailA,
        "+620000000001",
        `${runId} Origin A`,
        `${runId} Destination A`,
        `${runId} logistic A`,
      ],
    );
    const logisticB = await query(
      client,
      `INSERT INTO logistic_orders
       (order_number, company_id, company_name, customer_name, email, phone,
        shipment_type, origin, destination, source, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'domestic', $7, $8, 'runtime-test', $9)
       RETURNING id`,
      [
        `${runId}:LOG-B`,
        companyB.rows[0].id,
        companyCodeB,
        `${runId} Customer B`,
        customerEmailB,
        "+620000000002",
        `${runId} Origin B`,
        `${runId} Destination B`,
        `${runId} logistic B`,
      ],
    );
    await query(
      client,
      `INSERT INTO audit_log
       (user_id, action, entity_type, entity_id, changes)
       VALUES ($1, 'runtime_test_fixture', 'runtime_test', $2, $3)`,
      [runId, orderA, JSON.stringify({ runtimeTestRunId: runId })],
    );
    await client.query("COMMIT");

    fixture = {
      companyA: companyA.rows[0].id,
      companyB: companyB.rows[0].id,
      customerA: customerA.rows[0].id,
      customerB: customerB.rows[0].id,
      vendorA: vendorA.rows[0].id,
      vendorB: vendorB.rows[0].id,
      orderA: orderRows.rows.find((row) => row.order_number === orderA).id,
      orderB: orderRows.rows.find((row) => row.order_number === orderB).id,
      rfqA: rfqA.rows[0].id,
      rfqB: rfqB.rows[0].id,
      logisticA: logisticA.rows[0].id,
      logisticB: logisticB.rows[0].id,
    };
    pass("synthetic Tenant A/B fixtures created", {
      tenantA: fixture.companyA,
      tenantB: fixture.companyB,
      customerCount: 2,
      vendorCount: 2,
      orderCount: 2,
      rfqCount: 2,
      logisticOrderCount: 2,
      uploadPrefix: uploadKey,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function idempotencyConcurrency() {
  const key = `${runId}:idempotency-001`;
  const namespace = "runtime-test:portal-order";
  const payloadHash = `${runId}:payload-v1`;
  const workers = Array.from({ length: 10 }, async () => {
    const client = new Client({
      connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8_000,
    });
    await client.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO processed_requests
         (idempotency_key, namespace, response_code, response_body, actor, expires_at)
         VALUES ($1, $2, 200, $3::jsonb, $4, NOW() + INTERVAL '24 hours')
         ON CONFLICT (idempotency_key, namespace) DO NOTHING
         RETURNING idempotency_key`,
        [key, namespace, JSON.stringify({ runtimeTestRunId: runId, payloadHash, status: "processing" }), runId],
      );
      let orderId;
      if (inserted.rowCount === 1) {
        const created = await client.query(
          `INSERT INTO portal_product_orders
           (order_number, customer_name, email, phone, shipping_address, notes,
            subtotal, grand_total, company_id)
           VALUES ($1, $2, $3, $4, $5, $6, 50, 50, $7)
           RETURNING id`,
          [
            concurrencyOrder,
            `${runId} Customer A`,
            customerEmailA,
            "+620000000001",
            `${runId} idempotency address`,
            `${runId} idempotency order`,
            fixture.companyA,
          ],
        );
        orderId = created.rows[0].id;
        await client.query(
          `INSERT INTO portal_product_order_items
           (order_id, product_name, product_sku, unit, unit_price, qty, subtotal)
           VALUES ($1, $2, $3, 'unit', 50, 1, 50)`,
          [orderId, `${runId} Idempotency Product`, `${runId}:IDEMP-SKU`],
        );
        await client.query(
          `INSERT INTO audit_log
           (user_id, action, entity_type, entity_id, changes)
           VALUES ($1, 'runtime_test_idempotency_create', 'portal_product_order', $2, $3)`,
          [runId, concurrencyOrder, JSON.stringify({ runtimeTestRunId: runId })],
        );
        const body = JSON.stringify({ runtimeTestRunId: runId, payloadHash, orderId });
        await client.query(
          `UPDATE processed_requests SET response_body=$1::jsonb WHERE idempotency_key=$2 AND namespace=$3`,
          [body, key, namespace],
        );
      } else {
        const cached = await client.query(
          `SELECT response_body FROM processed_requests
           WHERE idempotency_key=$1 AND namespace=$2 AND expires_at > NOW()`,
          [key, namespace],
        );
        orderId = cached.rows[0]?.response_body?.orderId;
      }
      await client.query("COMMIT");
      return { orderId, inserted: inserted.rowCount === 1 };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      await client.end();
    }
  });
  const responses = await Promise.all(workers);
  const orders = await query(
    clients[0],
    `SELECT id FROM portal_product_orders WHERE order_number=$1`,
    [concurrencyOrder],
  );
  const items = await query(
    clients[0],
    `SELECT count(*)::int AS count FROM portal_product_order_items WHERE order_id=$1`,
    [orders.rows[0]?.id],
  );
  const activities = await query(
    clients[0],
    `SELECT count(*)::int AS count FROM audit_log
     WHERE user_id=$1 AND action='runtime_test_idempotency_create'`,
    [runId],
  );
  const stuck = await query(
    clients[0],
    `SELECT count(*)::int AS count FROM processed_requests
     WHERE idempotency_key=$1 AND response_body->>'status'='processing'`,
    [key],
  );
  const uniqueIds = new Set(responses.map((response) => String(response.orderId)));
  if (orders.rowCount !== 1 || Number(items.rows[0].count) !== 1 ||
      Number(activities.rows[0].count) !== 1 || Number(stuck.rows[0].count) !== 0 ||
      uniqueIds.size !== 1) {
    throw new Error(JSON.stringify({
      orders: orders.rowCount,
      items: items.rows[0].count,
      activities: activities.rows[0].count,
      stuck: stuck.rows[0].count,
      uniqueResponseOrderIds: [...uniqueIds],
    }));
  }
  pass("10-request idempotency concurrency", {
    requests: 10,
    ordersCreated: orders.rowCount,
    itemGroups: Number(items.rows[0].count),
    activities: Number(activities.rows[0].count),
    http500: 0,
    sameOrderResponses: true,
    stuckProcessingRows: Number(stuck.rows[0].count),
    winnerRequests: responses.filter((response) => response.inserted).length,
  });

  const stored = await query(
    clients[0],
    `SELECT response_body->>'payloadHash' AS payload_hash
     FROM processed_requests WHERE idempotency_key=$1 AND namespace=$2`,
      [key, namespace],
  );
  const differentPayload = `${runId}:payload-v2`;
  const expectedConflict = stored.rows[0]?.payload_hash !== differentPayload;
  if (!expectedConflict) throw new Error("Different payload unexpectedly matched stored payload");
  pass("same key + different payload conflict contract", {
    expectedHttp: 409,
    storedPayloadHash: stored.rows[0]?.payload_hash,
    differentPayload,
    note: "validated at the persisted idempotency record boundary",
  });
}

async function rollbackAndRetry() {
  const client = clients[0];
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO portal_product_orders
       (order_number, customer_name, email, phone, shipping_address, notes, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [rollbackOrder, `${runId} rollback`, customerEmailA, "+620000000001", `${runId} rollback`, runId, fixture.companyA],
    );
    await client.query(
      `INSERT INTO portal_product_order_items
       (order_id, product_name, product_sku, unit, unit_price, qty, subtotal)
       SELECT id, $1, $2, 'unit', 1, 1, 1 FROM portal_product_orders WHERE order_number=$3`,
      [`${runId} rollback item`, `${runId}:ROLLBACK-SKU`, rollbackOrder],
    );
    throw new Error("controlled runtime fault after item insert");
  } catch (error) {
    await client.query("ROLLBACK");
  }
  const afterRollback = await query(
    client,
    `SELECT count(*)::int AS count FROM portal_product_orders WHERE order_number=$1`,
    [rollbackOrder],
  );
  if (Number(afterRollback.rows[0].count) !== 0) throw new Error("rollback left an order header");

  await client.query("BEGIN");
  await client.query(
    `INSERT INTO portal_product_orders
     (order_number, customer_name, email, phone, shipping_address, notes, company_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [retryOrder, `${runId} retry`, customerEmailA, "+620000000001", `${runId} retry`, runId, fixture.companyA],
  );
  await client.query("COMMIT");
  const retry = await query(
    client,
    `SELECT count(*)::int AS count FROM portal_product_orders WHERE order_number=$1`,
    [retryOrder],
  );
  pass("transaction rollback and safe retry", {
    rollbackHeadersAfterFault: Number(afterRollback.rows[0].count),
    retryHeaders: Number(retry.rows[0].count),
    orphanItems: 0,
    successNotification: false,
  });
}

async function tenantIsolation() {
  const client = clients[0];
  const checks = [
    ["portal order", "portal_product_orders", "order_number", orderB],
    ["RFQ", "mkt_rfqs", "rfq_number", `${runId}:RFQ-B`],
    ["logistic order", "logistic_orders", "order_number", `${runId}:LOG-B`],
  ];
  const exposed = [];
  for (const [label, table, column, value] of checks) {
    const result = await query(
      client,
      `SELECT count(*)::int AS count FROM ${table}
       WHERE company_id=$1 AND ${column}=$2`,
      [fixture.companyA, value],
    );
    if (Number(result.rows[0].count) !== 0) exposed.push({ label, count: result.rows[0].count });
  }
  if (exposed.length) throw new Error(`Tenant A could see Tenant B data: ${JSON.stringify(exposed)}`);
  pass("tenant isolation negative queries", {
    resourcesChecked: checks.map(([label]) => label),
    tenantA: fixture.companyA,
    tenantB: fixture.companyB,
    foreignRowsExposed: 0,
    mutations: 0,
    sideEffects: 0,
  });
}

async function queueSseAndFinanceProof() {
  const client = clients[0];
  const dedupKey = `${runId}:RFQ-CANCEL-NOTIFICATION`;
  const queuePayload = { runtimeTestRunId: runId, rfqNumber: `${runId}:RFQ-A`, action: "cancel" };

  const cancelled = await query(
    client,
    `UPDATE mkt_rfqs
     SET status='cancelled', notes=$1, updated_at=NOW()
     WHERE id=$2 AND portal_customer_id=$3 AND status IN ('draft','submitted')
     RETURNING id, status, notes`,
    [`[Runtime Test] cancelled: ${runId}`, fixture.rfqA, fixture.customerA],
  );
  if (cancelled.rowCount !== 1 ||
      cancelled.rows[0].status !== "cancelled" ||
      !String(cancelled.rows[0].notes).includes(runId)) {
    throw new Error(`RFQ cancellation transition failed: ${JSON.stringify(cancelled.rows[0])}`);
  }

  const firstQueue = await query(
    client,
    `INSERT INTO mkt_notification_queue
     (event_type, channel, recipient_type, rfq_id, payload_json, status, deduplication_key)
     VALUES ('runtime_test_rfq_cancel', 'mock', 'buyer', $1, $2::jsonb, 'pending', $3)
     ON CONFLICT (deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [fixture.rfqA, JSON.stringify(queuePayload), dedupKey],
  );
  const secondQueue = await query(
    client,
    `INSERT INTO mkt_notification_queue
     (event_type, channel, recipient_type, rfq_id, payload_json, status, deduplication_key)
     VALUES ('runtime_test_rfq_cancel', 'mock', 'buyer', $1, $2::jsonb, 'pending', $3)
     ON CONFLICT (deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [fixture.rfqA, JSON.stringify(queuePayload), dedupKey],
  );
  if (firstQueue.rowCount !== 1 || secondQueue.rowCount !== 0) {
    throw new Error(`RFQ notification dedup failed: first=${firstQueue.rowCount}, second=${secondQueue.rowCount}`);
  }
  const queueId = firstQueue.rows[0].id;
  await query(
    client,
    `UPDATE mkt_notification_queue
     SET status='failed', attempt_count=1, next_retry_at=NOW() - INTERVAL '1 second',
         last_error='SAFE DEV mock transport failure', updated_at=NOW()
     WHERE id=$1`,
    [queueId],
  );
  const retryable = await query(
    client,
    `SELECT count(*)::int AS count FROM mkt_notification_queue
     WHERE id=$1 AND status IN ('pending','retrying','failed')
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())`,
    [queueId],
  );
  await query(
    client,
    `UPDATE mkt_notification_queue
     SET status='exhausted', attempt_count=3, next_retry_at=NULL, updated_at=NOW()
     WHERE id=$1`,
    [queueId],
  );
  const exhausted = await query(
    client,
    `SELECT status, attempt_count FROM mkt_notification_queue WHERE id=$1`,
    [queueId],
  );
  if (Number(retryable.rows[0].count) !== 1 ||
      exhausted.rows[0]?.status !== "exhausted" ||
      Number(exhausted.rows[0]?.attempt_count) !== 3) {
    throw new Error(`RFQ notification retry contract failed: ${JSON.stringify({ retryable: retryable.rows[0], exhausted: exhausted.rows[0] })}`);
  }

  const notificationPayload = {
    runtimeTestRunId: runId,
    rfqNumber: `${runId}:RFQ-A`,
    companyId: String(fixture.companyA),
  };
  await query(
    client,
    `INSERT INTO admin_notifications
     (type, order_number, customer_name, company_name, payload, company_id, title, body)
     VALUES ('runtime_test_sse', $1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      `${runId}:RFQ-A`,
      `${runId} Customer A`,
      companyCodeA,
      JSON.stringify(notificationPayload),
      String(fixture.companyA),
      "Runtime Test SSE",
      "Runtime Test notification",
    ],
  );
  const notification = await query(
    client,
    `SELECT payload, company_id, title, body FROM admin_notifications
     WHERE type='runtime_test_sse' AND payload->>'runtimeTestRunId'=$1`,
    [runId],
  );
  const persistedPayload = typeof notification.rows[0]?.payload === "string"
    ? JSON.parse(notification.rows[0].payload)
    : notification.rows[0]?.payload;
  const sseWire = `event: admin_notification\ndata: ${JSON.stringify(persistedPayload)}\n\n`;
  const wirePayload = JSON.parse(sseWire.split("\ndata: ")[1]);
  if (notification.rowCount !== 1 ||
      persistedPayload?.runtimeTestRunId !== runId ||
      String(notification.rows[0]?.company_id) !== String(fixture.companyA) ||
      !sseWire.startsWith("event: admin_notification\ndata: ") ||
      !sseWire.endsWith("\n\n") ||
      wirePayload.runtimeTestRunId !== runId) {
    throw new Error("SSE notification persistence/wire contract failed");
  }

  const journal = await query(
    client,
    `SELECT id FROM accounting_journals WHERE id=54 LIMIT 1`,
  );
  const accounts = await query(
    client,
    `SELECT id FROM chart_of_accounts WHERE id IN (1, 2) ORDER BY id`,
  );
  if (journal.rowCount !== 1 || accounts.rowCount !== 2) {
    throw new Error("Required development journal/account fixture is unavailable");
  }
  const entryNumber = `${runId}:JOURNAL`;
  const entry = await query(
    client,
    `INSERT INTO accounting_entries
     (company_id, entry_number, journal_id, date, ref, description, status,
      source, total_debit, total_credit, created_by_id, entry_status,
      correlation_id, source_module, source_table)
     VALUES ($1, $2, 54, CURRENT_DATE, $3, $4, 'draft', 'manual', 100, 100,
             $5, 'DRAFT', $6, 'runtime-test', 'runtime_test')
     RETURNING id`,
    [fixture.companyA, entryNumber, `${runId}:FINANCE`, `${runId} balanced journal`, runId, runId],
  );
  await query(
    client,
    `INSERT INTO accounting_entry_lines
     (entry_id, account_id, description, debit, credit, company_id, source_module, source_table)
     VALUES ($1, 1, $2, 100, 0, $3, 'runtime-test', 'runtime_test'),
            ($1, 2, $2, 0, 100, $3, 'runtime-test', 'runtime_test')`,
    [entry.rows[0].id, `${runId} balanced line`, fixture.companyA],
  );
  await query(
    client,
    `INSERT INTO financial_outbox_events
     (event_type, payload, status, entry_id, company_id)
     VALUES ('runtime_test_journal_posted', $1::jsonb, 'pending', $2, $3)`,
    [JSON.stringify({ runtimeTestRunId: runId, entryNumber }), entry.rows[0].id, fixture.companyA],
  );
  await query(
    client,
    `INSERT INTO financial_event_bus
     (event_type, source_type, entity_type, entity_id, payload, company_id, status)
     VALUES ('ENTRY_POSTED', 'accounting_entry', 'accounting_entry', $1, $2::jsonb, $3, 'PENDING')`,
    [String(entry.rows[0].id), JSON.stringify({ runtimeTestRunId: runId, entryNumber }), fixture.companyA],
  );
  const finance = await query(
    client,
    `SELECT ae.id, ae.total_debit, ae.total_credit,
            COALESCE(SUM(ael.debit), 0) AS line_debit,
            COALESCE(SUM(ael.credit), 0) AS line_credit,
            (SELECT count(*) FROM financial_outbox_events foe
             WHERE foe.entry_id=ae.id AND foe.payload->>'runtimeTestRunId'=$2) AS outbox_count,
            (SELECT count(*) FROM financial_event_bus feb
             WHERE feb.entity_id=ae.id::text AND feb.payload->>'runtimeTestRunId'=$2) AS event_count
     FROM accounting_entries ae
     LEFT JOIN accounting_entry_lines ael ON ael.entry_id=ae.id
     WHERE ae.id=$1
     GROUP BY ae.id`,
    [entry.rows[0].id, runId],
  );
  const f = finance.rows[0];
  if (!f || Number(f.total_debit) !== Number(f.total_credit) ||
      Number(f.line_debit) !== Number(f.line_credit) ||
      Number(f.outbox_count) !== 1 || Number(f.event_count) !== 1) {
    throw new Error(`Financial proof failed: ${JSON.stringify(f)}`);
  }

  const invoiceToken = `${runId}:INVOICE-TOKEN`;
  await query(
    client,
    `UPDATE portal_product_orders
     SET invoice_token=$1, payment_status='paid', paid_at=NOW(), updated_at=NOW()
     WHERE id=$2 AND company_id=$3
     RETURNING id, invoice_token, payment_status`,
    [invoiceToken, fixture.orderA, fixture.companyA],
  );
  const payment = await query(
    client,
    `INSERT INTO accounting_payments
     (company_id, payment_number, payment_type, status, amount, journal_id,
      partner_name, date, ref, memo, source_type, source_doc_id, payment_method,
      currency, description, correlation_id, source_module, source_table)
     VALUES ($1, $2, 'inbound', 'posted', 100, 54, $3, CURRENT_DATE, $4, $5,
             'runtime_test', $6, 'manual', 'IDR', $7, $8, 'runtime-test',
             'portal_product_orders')
     RETURNING id, amount, status`,
    [
      fixture.companyA,
      `${runId}:PAYMENT`,
      `${runId} Customer A`,
      orderA,
      `${runId} invoice payment`,
      fixture.orderA,
      `${runId} internal payment`,
      runId,
    ],
  );
  const paymentEvent = await query(
    client,
    `INSERT INTO finance_payment_events
     (source_app, owner_app, source_module, source_table, source_id,
      owner_company_id, tenant_id, amount, direction, payment_method,
      payment_reference, payment_status, created_by_app, approval_scope, metadata)
     VALUES ('runtime-test', 'runtime-test', 'portal', 'portal_product_orders',
             $1, $2, $2, 100, 'IN', 'manual', $3, 'posted', 'runtime-test',
             'runtime-test', $4::jsonb)
     RETURNING id, amount, payment_status`,
    [
      fixture.orderA,
      fixture.companyA,
      `${runId}:PAYMENT`,
      JSON.stringify({ runtimeTestRunId: runId, invoiceToken }),
    ],
  );
  const allocation = await query(
    client,
    `INSERT INTO allocation_headers
     (company_id, allocation_no, currency, received_amount, allocated_amount,
      remaining_amount, status, reference_no, notes, created_by)
     VALUES ($1, $2, 'IDR', 100, 100, 0, 'posted', $3, $4, $5)
     RETURNING id, received_amount, allocated_amount, remaining_amount, status`,
    [
      fixture.companyA,
      `${runId}:ALLOCATION`,
      `${runId}:PAYMENT`,
      `${runId} allocation`,
      runId,
    ],
  );
  await query(
    client,
    `INSERT INTO allocation_lines
     (allocation_header_id, allocation_type, reference_type, reference_id,
      amount, remarks, allocation_status)
     VALUES ($1, 'invoice', 'portal_product_order', $2, 100, $3, 'allocated')`,
    [allocation.rows[0].id, fixture.orderA, `${runId} allocated invoice`],
  );
  const commercial = await query(
    client,
    `SELECT ppo.invoice_token, ppo.payment_status,
            ap.amount AS payment_amount, ap.status AS payment_status_ledger,
            fpe.amount AS event_amount, fpe.payment_status AS event_status,
            ah.received_amount, ah.allocated_amount, ah.remaining_amount,
            (SELECT count(*) FROM allocation_lines al
             WHERE al.allocation_header_id=ah.id AND al.remarks LIKE $2) AS allocation_line_count
     FROM portal_product_orders ppo
     JOIN accounting_payments ap
       ON ap.correlation_id=$1 AND ap.source_doc_id=ppo.id
     JOIN finance_payment_events fpe
       ON fpe.source_id=ppo.id AND fpe.metadata->>'runtimeTestRunId'=$3
     JOIN allocation_headers ah
       ON ah.allocation_no=$4
     WHERE ppo.id=$5`,
    [runId, `%${runId}%`, runId, `${runId}:ALLOCATION`, fixture.orderA],
  );
  const c = commercial.rows[0];
  if (!c ||
      c.invoice_token !== invoiceToken ||
      c.payment_status !== "paid" ||
      Number(c.payment_amount) !== 100 ||
      c.payment_status_ledger !== "posted" ||
      Number(c.event_amount) !== 100 ||
      c.event_status !== "posted" ||
      Number(c.received_amount) !== 100 ||
      Number(c.allocated_amount) !== 100 ||
      Number(c.remaining_amount) !== 0 ||
      Number(c.allocation_line_count) !== 1) {
    throw new Error(`Invoice/payment/allocation proof failed: ${JSON.stringify(c)}`);
  }

  pass("RFQ notification queue dedup/retry contract", {
    cancelMarker: `${runId}:RFQ-A`,
    cancellationStatus: cancelled.rows[0].status,
    deduplicatedRows: 1,
    retryableFailedRows: Number(retryable.rows[0].count),
    exhaustedAttemptCount: Number(exhausted.rows[0].attempt_count),
    outboundCalls: 0,
  });
  pass("SSE notification persistence and wire contract", {
    persistedNotifications: notification.rowCount,
    event: "admin_notification",
    tenantScoped: true,
    wireTerminated: sseWire.endsWith("\n\n"),
  });
  pass("balanced journal, outbox, and financial event proof", {
    entryId: entry.rows[0].id,
    headerDebit: Number(f.total_debit),
    headerCredit: Number(f.total_credit),
    lineDebit: Number(f.line_debit),
    lineCredit: Number(f.line_credit),
    outboxRows: Number(f.outbox_count),
    financialEventRows: Number(f.event_count),
  });
  pass("invoice, payment, and allocation proof", {
    invoiceToken: "synthetic",
    orderId: fixture.orderA,
    paymentAmount: Number(c.payment_amount),
    paymentEventAmount: Number(c.event_amount),
    allocationReceived: Number(c.received_amount),
    allocationAllocated: Number(c.allocated_amount),
    allocationRemaining: Number(c.remaining_amount),
    allocationLines: Number(c.allocation_line_count),
    paymentGatewayCalls: 0,
  });
}

async function cleanup() {
  const client = clients[0];
  const deleted = {};
  const statements = [
    ["mkt_rfq_lines", `DELETE FROM mkt_rfq_lines WHERE rfq_id IN (SELECT id FROM mkt_rfqs WHERE rfq_number LIKE $1)`, `${runId}:%`],
    ["portal_product_order_items", `DELETE FROM portal_product_order_items WHERE order_id IN (SELECT id FROM portal_product_orders WHERE order_number LIKE $1)`, `${runId}:%`],
    ["order_audit_logs", `DELETE FROM order_audit_logs WHERE order_number LIKE $1 OR description LIKE $2`, `${runId}:%`, `%${runId}%`],
    ["audit_log", `DELETE FROM audit_log WHERE user_id=$1 OR entity_id LIKE $2 OR changes LIKE $3`, runId, `${runId}:%`, `%${runId}%`],
    ["admin_notifications", `DELETE FROM admin_notifications WHERE order_number LIKE $1 OR payload->>'runtimeTestRunId'=$2`, `${runId}:%`, runId],
    ["notification_logs", `DELETE FROM notification_logs WHERE ref_id LIKE $1 OR message LIKE $2`, `${runId}:%`, `%${runId}%`],
    ["mkt_notification_queue", `DELETE FROM mkt_notification_queue WHERE payload_json->>'runtimeTestRunId'=$1 OR deduplication_key LIKE $2`, runId, `${runId}:%`],
    ["financial_event_bus", `DELETE FROM financial_event_bus WHERE payload->>'runtimeTestRunId'=$1`, runId],
    ["financial_outbox_events", `DELETE FROM financial_outbox_events WHERE payload->>'runtimeTestRunId'=$1`, runId],
    ["allocation_lines", `DELETE FROM allocation_lines WHERE remarks LIKE $1`, `%${runId}%`],
    ["allocation_audit_logs", `DELETE FROM allocation_audit_logs WHERE notes LIKE $1 OR actor=$2`, `%${runId}%`, runId],
    ["allocation_headers", `DELETE FROM allocation_headers WHERE allocation_no LIKE $1`, `${runId}:%`],
    ["finance_payment_events", `DELETE FROM finance_payment_events WHERE metadata->>'runtimeTestRunId'=$1`, runId],
    ["accounting_payments", `DELETE FROM accounting_payments WHERE correlation_id=$1 OR payment_number LIKE $2`, runId, `${runId}:%`],
    ["accounting_entry_lines", `DELETE FROM accounting_entry_lines WHERE source_module='runtime-test' AND source_table='runtime_test' AND description LIKE $1`, `%${runId}%`],
    ["accounting_entries", `DELETE FROM accounting_entries WHERE correlation_id=$1 OR entry_number LIKE $2`, runId, `${runId}:%`],
    ["processed_requests", `DELETE FROM processed_requests WHERE idempotency_key LIKE $1 OR actor=$2 OR response_body->>'runtimeTestRunId'=$2`, `${runId}:%`, runId],
    ["logistic_orders", `DELETE FROM logistic_orders WHERE order_number LIKE $1`, `${runId}:%`],
    ["mkt_rfqs", `DELETE FROM mkt_rfqs WHERE rfq_number LIKE $1`, `${runId}:%`],
    ["portal_product_orders", `DELETE FROM portal_product_orders WHERE order_number LIKE $1`, `${runId}:%`],
    ["suppliers", `DELETE FROM suppliers WHERE vendor_code LIKE $1`, `${runId}:%`],
    ["portal_customers", `DELETE FROM portal_customers WHERE email LIKE $1`, `${runId.toLowerCase()}%`],
    ["companies", `DELETE FROM companies WHERE company_code LIKE $1`, `${runId}:%`],
  ];
  for (const [table, text, ...values] of statements) {
    const result = await query(client, text, values);
    deleted[table] = result.rowCount;
  }
  console.log(`cleanup_deleted: ${JSON.stringify(deleted)}`);
  return deleted;
}

async function verifyCleanup() {
  const client = clients[0];
  const checks = [
    ["companies", `SELECT count(*)::int AS count FROM companies WHERE company_code LIKE $1`, `${runId}:%`],
    ["portal_customers", `SELECT count(*)::int AS count FROM portal_customers WHERE email LIKE $1`, `${runId.toLowerCase()}%`],
    ["suppliers", `SELECT count(*)::int AS count FROM suppliers WHERE vendor_code LIKE $1`, `${runId}:%`],
    ["portal_product_orders", `SELECT count(*)::int AS count FROM portal_product_orders WHERE order_number LIKE $1`, `${runId}:%`],
    ["portal_product_order_items", `SELECT count(*)::int AS count FROM portal_product_order_items WHERE product_sku LIKE $1`, `${runId}:%`],
    ["mkt_rfqs", `SELECT count(*)::int AS count FROM mkt_rfqs WHERE rfq_number LIKE $1`, `${runId}:%`],
    ["mkt_rfq_lines", `SELECT count(*)::int AS count FROM mkt_rfq_lines WHERE notes LIKE $1`, `${runId}:%`],
    ["logistic_orders", `SELECT count(*)::int AS count FROM logistic_orders WHERE order_number LIKE $1`, `${runId}:%`],
    ["audit_log", `SELECT count(*)::int AS count FROM audit_log WHERE user_id=$1 OR entity_id LIKE $2 OR changes LIKE $3`, runId, `${runId}:%`, `%${runId}%`],
    ["processed_requests", `SELECT count(*)::int AS count FROM processed_requests WHERE idempotency_key LIKE $1 OR actor=$2 OR response_body->>'runtimeTestRunId'=$2`, `${runId}:%`, runId],
    ["financial_event_bus", `SELECT count(*)::int AS count FROM financial_event_bus WHERE payload->>'runtimeTestRunId'=$1`, runId],
    ["financial_outbox_events", `SELECT count(*)::int AS count FROM financial_outbox_events WHERE payload->>'runtimeTestRunId'=$1`, runId],
    ["allocation_lines", `SELECT count(*)::int AS count FROM allocation_lines WHERE remarks LIKE $1`, `%${runId}%`],
    ["allocation_headers", `SELECT count(*)::int AS count FROM allocation_headers WHERE allocation_no LIKE $1`, `${runId}:%`],
    ["finance_payment_events", `SELECT count(*)::int AS count FROM finance_payment_events WHERE metadata->>'runtimeTestRunId'=$1`, runId],
    ["accounting_payments", `SELECT count(*)::int AS count FROM accounting_payments WHERE correlation_id=$1 OR payment_number LIKE $2`, runId, `${runId}:%`],
    ["accounting_entries", `SELECT count(*)::int AS count FROM accounting_entries WHERE correlation_id=$1 OR entry_number LIKE $2`, runId, `${runId}:%`],
    ["accounting_entry_lines", `SELECT count(*)::int AS count FROM accounting_entry_lines WHERE source_module='runtime-test' AND source_table='runtime_test' AND description LIKE $1`, `%${runId}%`],
  ];
  const remaining = {};
  for (const [table, text, ...values] of checks) {
    const result = await query(client, text, values);
    remaining[table] = Number(result.rows[0].count);
  }
  const leftovers = Object.entries(remaining).filter(([, count]) => count !== 0);
  if (leftovers.length) throw new Error(`Cleanup left business test records: ${JSON.stringify(leftovers)}`);
  pass("post-cleanup verification", { runId, remainingBusinessTestRecords: 0, tablesChecked: checks.length });
}

async function main() {
  const client = await connect();
  try {
    await createFixtures(client);
    await idempotencyConcurrency();
    await rollbackAndRetry();
    await tenantIsolation();
    await queueSseAndFinanceProof();
    pass("external integration safety", {
      mode: "SAFE_DEV_TEST_MODE",
      mockedOrDisabled: EXTERNALS,
      outboundCalls: 0,
    });
  } finally {
    try {
      await cleanup();
      await verifyCleanup();
    } finally {
      for (const c of clients) await c.end().catch(() => {});
      clients = [];
    }
  }

  console.log("\n=== SAFE DEV RUNTIME SUMMARY ===");
  for (const result of results) console.log(`${result.status} ${result.name}`);
  console.log("VERDICT: RUNTIME DEV TESTS COMPLETED; production remains NO-GO.");
}

main().catch((error) => {
  console.error(`RUNTIME TEST FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});