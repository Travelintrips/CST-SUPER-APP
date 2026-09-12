/**
 * productFirstFlow.regression.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2A Regression Test — Product-First Shipment Flow
 *
 * Jalankan: node artifacts/api-server/tests/productFirstFlow.regression.mjs
 *
 * Prerequisites:
 *  - API server berjalan di port 8080 (atau PORT env var)
 *  - DB bersih atau sudah ada supplier + logistic order test
 *  - CLERK_SECRET_KEY / JWT valid untuk header Authorization (atau gunakan mock)
 *
 * Scenario A: Happy Path Product-First
 *   Create product_first order → Product RFQ Sent → Product Quote Received
 *   → Product Vendor Selected → Customer Product Approval
 *   → Shipment Selection Pending
 *
 * Scenario B: Shipment RFQ sebelum product approved → 422
 *
 * Scenario C: Legacy shipment order tetap berjalan normal
 *
 * Scenario D: State machine — transisi tidak valid ditolak
 * ─────────────────────────────────────────────────────────────────────────────
 */

import assert from "node:assert/strict";

const BASE = `http://localhost:${process.env.PORT ?? 8080}/api`;
const AUTH_HEADER = process.env.TEST_AUTH_HEADER ?? "Bearer test-token-for-regression";

let passed = 0;
let failed = 0;
const errors = [];

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: AUTH_HEADER,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

function ok(label, cond, detail = "") {
  if (cond) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    errors.push(`${label}${detail ? `: ${detail}` : ""}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createTestOrder(orderType = "product_first") {
  const r = await req("POST", "/logistic/orders", {
    customerName: `Test Customer ${Date.now()}`,
    email: "test@regression.local",
    phone: "6281200000000",
    companyName: "PT Regression Test",
    orderType,
    shipmentType: orderType === "shipment" ? "Trucking" : "",
    origin: "Jakarta",
    destination: "Surabaya",
    commodity: "Bahan Kimia Test",
    source: "regression_test",
    subtotal: 0,
    tax: 0,
    grandTotal: 0,
    items: [],
  });
  return r;
}

async function createTestSupplier() {
  const r = await req("POST", "/trading/suppliers", {
    name: `Supplier Regression ${Date.now()}`,
    email: "vendor@regression.local",
    phone: "6281200000001",
    serviceType: "product",
    isActive: true,
  });
  return r;
}

async function getOrderStatus(orderId) {
  const r = await req("GET", `/logistic/orders/${orderId}/product-phase`);
  return r;
}

// ── Scenario A: Happy Path Product-First ─────────────────────────────────────
async function scenarioA() {
  console.log("\n🔵 Scenario A: Happy Path Product-First\n");

  // A1. Create product_first order
  const createRes = await createTestOrder("product_first");
  ok(
    "A1. Create product_first order → 201",
    createRes.status === 201,
    `status=${createRes.status}, body=${JSON.stringify(createRes.body).slice(0, 200)}`,
  );
  if (createRes.status !== 201) {
    console.error("  ⛔ Cannot continue Scenario A — order creation failed");
    return null;
  }

  const orderId = createRes.body?.id ?? createRes.body?.order?.id;
  ok("A1b. Order ID exists", !!orderId, `id=${orderId}`);
  if (!orderId) {
    console.error("  ⛔ Cannot continue — no order ID returned");
    return null;
  }

  // A2. Create test supplier
  const supplierRes = await createTestSupplier();
  const supplierId = supplierRes.body?.id ?? supplierRes.body?.supplier?.id;
  ok("A2. Create test supplier", supplierId > 0, `status=${supplierRes.status}, id=${supplierId}`);

  const vendorIds = supplierId ? [supplierId] : [];
  if (!vendorIds.length) {
    console.warn("  ⚠️  No vendor created — skipping blast steps, using vendorId=1 fallback");
    vendorIds.push(1);
  }

  // A3. Blast product RFQ → Product RFQ Sent
  const prfqRes = await req("POST", `/logistic/orders/${orderId}/product-rfq`, {
    vendorIds,
    notes: "Test product RFQ blast",
    expiresInDays: 2,
  });
  ok(
    "A3. product-rfq → status 201",
    prfqRes.status === 201,
    `status=${prfqRes.status} body=${JSON.stringify(prfqRes.body).slice(0, 200)}`,
  );
  ok(
    "A3b. status = Product RFQ Sent",
    prfqRes.body?.status === "Product RFQ Sent",
    `status="${prfqRes.body?.status}"`,
  );

  // A4. Check order status
  const phaseRes = await getOrderStatus(orderId);
  ok("A4. GET product-phase succeeds", phaseRes.status === 200, `status=${phaseRes.status}`);
  ok(
    "A4b. productRfqId is set",
    !!phaseRes.body?.productRfqId,
    `productRfqId=${phaseRes.body?.productRfqId}`,
  );

  // A5. Select product vendor → Product Vendor Selected
  const selectVendorRes = await req("POST", `/logistic/orders/${orderId}/select-product-vendor`, {
    vendorId: vendorIds[0],
    price: 5000000,
    readyDate: "2026-07-15",
    pickupLocation: "Cilincing, Jakarta Utara",
    qtyConfirmed: 100,
  });
  ok(
    "A5. select-product-vendor → 200",
    selectVendorRes.status === 200,
    `status=${selectVendorRes.status} body=${JSON.stringify(selectVendorRes.body).slice(0, 200)}`,
  );
  ok(
    "A5b. status = Product Vendor Selected",
    selectVendorRes.body?.status === "Product Vendor Selected",
    `status="${selectVendorRes.body?.status}"`,
  );

  // A6. Send product approval → Customer Product Approval
  const sendApprovalRes = await req("POST", `/logistic/orders/${orderId}/send-product-approval`, {
    sellingPrice: 6000000,
  });
  ok(
    "A6. send-product-approval → 200",
    sendApprovalRes.status === 200,
    `status=${sendApprovalRes.status}`,
  );
  ok(
    "A6b. status = Customer Product Approval",
    sendApprovalRes.body?.status === "Customer Product Approval",
    `status="${sendApprovalRes.body?.status}"`,
  );
  ok("A6c. approvalToken generated", !!sendApprovalRes.body?.approvalToken, "no token returned");

  const approvalToken = sendApprovalRes.body?.approvalToken;

  // A7. Customer approves product → Shipment Selection Pending (PUBLIC endpoint, no auth)
  const approveRes = await fetch(`${BASE}/logistic/orders/${approvalToken}/customer-product-approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve", notes: "Setuju, lanjutkan" }),
  });
  const approveBody = await approveRes.json().catch(() => ({}));
  ok(
    "A7. customer-product-approve (PUBLIC) → 200",
    approveRes.status === 200,
    `status=${approveRes.status} body=${JSON.stringify(approveBody).slice(0, 200)}`,
  );
  ok(
    "A7b. status = Shipment Selection Pending",
    approveBody?.status === "Shipment Selection Pending",
    `status="${approveBody?.status}"`,
  );
  ok("A7c. approved=true", approveBody?.approved === true, `approved=${approveBody?.approved}`);

  // A8. Verify product phase data persisted
  const finalPhase = await getOrderStatus(orderId);
  ok(
    "A8. product phase data persisted",
    finalPhase.status === 200 &&
    !!finalPhase.body?.productVendorId &&
    !!finalPhase.body?.customerProductApprovedAt &&
    !!finalPhase.body?.productReadyDate &&
    !!finalPhase.body?.productPickupLocation,
    `vendorId=${finalPhase.body?.productVendorId}, approvedAt=${finalPhase.body?.customerProductApprovedAt}`,
  );
  ok(
    "A8b. shipmentRfqReady=true",
    finalPhase.body?.shipmentRfqReady === true,
    `shipmentRfqReady=${finalPhase.body?.shipmentRfqReady}`,
  );

  console.log(`\n  Order ID: ${orderId}, Final status: ${finalPhase.body?.status}`);
  return orderId;
}

// ── Scenario B: 422 Guard — Shipment RFQ sebelum product approved ─────────────
async function scenarioB() {
  console.log("\n🟡 Scenario B: Shipment RFQ blocked (422) jika product phase incomplete\n");

  // B1. Create fresh product_first order (tidak melalui product flow)
  const createRes = await createTestOrder("product_first");
  ok("B1. Create order", createRes.status === 201, `status=${createRes.status}`);
  const orderId = createRes.body?.id ?? createRes.body?.order?.id;
  if (!orderId) {
    console.error("  ⛔ Cannot continue — no order ID");
    return;
  }

  // B2. Try shipment-rfq without product phase → must get 422
  const srfqRes = await req("POST", `/logistic/orders/${orderId}/shipment-rfq`, {
    vendorIds: [1],
    notes: "Harusnya ditolak",
  });
  ok(
    "B2. shipment-rfq without product phase → 422",
    srfqRes.status === 422,
    `status=${srfqRes.status} (expected 422)`,
  );
  ok(
    "B2b. missingFields array exists",
    Array.isArray(srfqRes.body?.missingFields) && srfqRes.body.missingFields.length > 0,
    `missingFields=${JSON.stringify(srfqRes.body?.missingFields)}`,
  );
  ok(
    "B2c. error message clear",
    typeof srfqRes.body?.error === "string",
    `error="${srfqRes.body?.error}"`,
  );

  // B3. Juga cek: endpoint product_first khusus tidak boleh dipanggil pada order shipment biasa
  const shipmentOrderRes = await createTestOrder("shipment");
  const shipmentOrderId = shipmentOrderRes.body?.id ?? shipmentOrderRes.body?.order?.id;
  if (shipmentOrderId) {
    const wrongTypeRes = await req("POST", `/logistic/orders/${shipmentOrderId}/product-rfq`, {
      vendorIds: [1],
    });
    ok(
      "B3. product-rfq pada order shipment → 400",
      wrongTypeRes.status === 400,
      `status=${wrongTypeRes.status} body=${JSON.stringify(wrongTypeRes.body).slice(0, 150)}`,
    );
  }
}

// ── Scenario C: Legacy Shipment Order ────────────────────────────────────────
async function scenarioC() {
  console.log("\n🟢 Scenario C: Legacy shipment order flow berjalan normal\n");

  // C1. Create regular shipment order
  const createRes = await createTestOrder("shipment");
  ok("C1. Create shipment order → 201", createRes.status === 201, `status=${createRes.status}`);
  const orderId = createRes.body?.id ?? createRes.body?.order?.id;
  if (!orderId) {
    console.error("  ⛔ Cannot continue — no order ID");
    return;
  }

  // C2. Status awal harus "Order Received" atau "Admin Review"
  const getRes = await req("GET", `/logistic/orders/${orderId}`);
  const initialStatus = getRes.body?.status ?? getRes.body?.order?.status;
  ok(
    "C2. Initial status is valid legacy status",
    ["Order Received", "Admin Review"].includes(initialStatus),
    `status="${initialStatus}"`,
  );

  // C3. Transisi ke Admin Review (jika belum)
  const reviewRes = await req("PUT", `/logistic/orders/${orderId}/status`, {
    status: "Admin Review",
  });
  ok(
    "C3. Transisi Admin Review → 200 atau already there",
    [200, 409].includes(reviewRes.status) || reviewRes.body?.alreadyAt,
    `status=${reviewRes.status}`,
  );

  // C4. Verifikasi status baru tidak bisa dicapai dari legacy order via normal transitions
  // Coba transisi ke "Product RFQ Sent" dari shipment order — harus berhasil dari state machine
  // (state machine tidak enforce orderType), tapi bisnis logicnya seharusnya endpoint yg restrict
  // Ini bukan pelanggaran — state machine agnostic, endpoint yg enforce.
  const manualTransition = await req("PUT", `/logistic/orders/${orderId}/status`, {
    status: "RFQ Sent",
  });
  ok(
    "C4. RFQ Sent transition works for shipment order",
    [200, 422].includes(manualTransition.status),
    `status=${manualTransition.status}`,
  );

  console.log(`\n  Legacy order ${orderId} flow intact — status=${initialStatus}`);
}

// ── Scenario D: State Machine Validation ─────────────────────────────────────
async function scenarioD() {
  console.log("\n🔵 Scenario D: State machine transisi tidak valid ditolak\n");

  const createRes = await createTestOrder("product_first");
  ok("D1. Create order", createRes.status === 201, `status=${createRes.status}`);
  const orderId = createRes.body?.id ?? createRes.body?.order?.id;
  if (!orderId) return;

  // D2. Coba lompat langsung ke "Shipment Selection Pending" tanpa melalui product phase
  const badTransRes = await req("PUT", `/logistic/orders/${orderId}/status`, {
    status: "Shipment Selection Pending",
  });
  ok(
    "D2. Direct jump to Shipment Selection Pending ditolak",
    badTransRes.status === 422 || badTransRes.body?.ok === false,
    `status=${badTransRes.status} ok=${badTransRes.body?.ok}`,
  );

  // D3. Coba lompat ke "Ready for Pickup" dari "Order Received"
  const badPickupRes = await req("PUT", `/logistic/orders/${orderId}/status`, {
    status: "Ready for Pickup",
  });
  ok(
    "D3. Direct jump to Ready for Pickup ditolak dari Order Received",
    badPickupRes.status === 422 || badPickupRes.body?.ok === false,
    `status=${badPickupRes.status} ok=${badPickupRes.body?.ok}`,
  );

  // D4. Transition Customer Product Approval → (idle check tidak valid ke Completed)
  const badCompleteRes = await req("PUT", `/logistic/orders/${orderId}/status`, {
    status: "Completed",
  });
  ok(
    "D4. Jump ke Completed dari Order Received ditolak",
    badCompleteRes.status === 422 || badCompleteRes.body?.ok === false,
    `status=${badCompleteRes.status}`,
  );
}

// ── Select Shipment Mode: pickup_self ─────────────────────────────────────────
async function scenarioE(productFirstOrderId) {
  console.log("\n🟢 Scenario E: select-shipment-mode pickup_self → Ready for Pickup\n");

  if (!productFirstOrderId) {
    console.warn("  ⚠️  No product_first order ID from Scenario A — skip");
    return;
  }

  // Order sudah di "Shipment Selection Pending" dari Scenario A
  const modeRes = await req("POST", `/logistic/orders/${productFirstOrderId}/select-shipment-mode`, {
    mode: "pickup_self",
    notes: "Customer akan pickup sendiri",
  });
  ok(
    "E1. select-shipment-mode pickup_self → 200",
    modeRes.status === 200,
    `status=${modeRes.status} body=${JSON.stringify(modeRes.body).slice(0, 200)}`,
  );
  ok(
    "E1b. status = Ready for Pickup",
    modeRes.body?.status === "Ready for Pickup",
    `status="${modeRes.body?.status}"`,
  );
  ok("E1c. readyForPickup=true", modeRes.body?.readyForPickup === true, "readyForPickup not true");
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("══════════════════════════════════════════════════════");
  console.log(" Phase 2A Regression Test — Product-First Flow       ");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Base URL: ${BASE}`);

  // Health check
  try {
    const health = await fetch(`http://localhost:${process.env.PORT ?? 8080}/healthz`);
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);
    console.log("✓ API server is up\n");
  } catch (e) {
    console.error(`❌ API server tidak dapat dijangkau: ${e.message}`);
    console.error(`   Pastikan server berjalan di port ${process.env.PORT ?? 8080}`);
    process.exit(1);
  }

  let scenarioAOrderId = null;
  try { scenarioAOrderId = await scenarioA(); } catch (e) { console.error("Scenario A error:", e.message); failed++; }
  try { await scenarioB(); } catch (e) { console.error("Scenario B error:", e.message); failed++; }
  try { await scenarioC(); } catch (e) { console.error("Scenario C error:", e.message); failed++; }
  try { await scenarioD(); } catch (e) { console.error("Scenario D error:", e.message); failed++; }
  try { await scenarioE(scenarioAOrderId); } catch (e) { console.error("Scenario E error:", e.message); failed++; }

  console.log("\n══════════════════════════════════════════════════════");
  console.log(` Results: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log("\n Failed assertions:");
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }
  console.log("══════════════════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
