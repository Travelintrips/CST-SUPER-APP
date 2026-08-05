/**
 * MARKETPLACE E2E TEST — Vendor Catalog
 * Scenarios: A (Kopi), B (Trucking), C (Security)
 *
 * Run: pnpm exec tsx scripts/marketplace-e2e-test.mts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, inArray } from "drizzle-orm";

// ── Inline DB connection (mirror lib/db/src/index.ts logic) ──────────────────
const connStr =
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_PG_URL ||
  process.env.DATABASE_URL;

if (!connStr) throw new Error("No DB connection string found");

const pool = new pg.Pool({ connectionString: connStr, max: 3 });
const db = drizzle(pool);

// ── Inline table references (raw SQL to avoid workspace import issues) ────────
const API_BASE = "http://localhost:8080";

// ── Result tracking ───────────────────────────────────────────────────────────
interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}
const results: TestResult[] = [];

function pass(name: string, detail: string) {
  results.push({ name, passed: true, detail });
  console.log(`  ✅ ${name}`);
  if (detail) console.log(`     ${detail}`);
}
function fail(name: string, detail: string) {
  results.push({ name, passed: false, detail });
  console.log(`  ❌ ${name}`);
  console.log(`     ${detail}`);
}

// ── Coffee templateSnapshot (product template, customFields format) ───────────
const COFFEE_SNAPSHOT = {
  customFields: [
    { key: "bean_type", label: "Jenis Biji", type: "select", options: ["Arabica", "Robusta", "Liberica", "Blend"] },
    { key: "grade", label: "Grade", type: "select", options: ["Grade B", "Grade C"] },
    { key: "moisture_pct", label: "Kadar Air (%)", type: "number" },
    { key: "origin", label: "Daerah Asal", type: "text" },
    { key: "quantity_kg", label: "Kuantitas (kg)", type: "number" },
  ],
};

// ── Trucking templateSnapshot (service template, fields+section format) ───────
const TRUCKING_SNAPSHOT = {
  fields: [
    { key: "truck_type", label: "Jenis Armada", type: "select", required: true, options: ["CDD", "CDE", "Fuso", "Tronton", "Trailer 20ft", "Trailer 40ft", "Pick Up", "Box Truck"], section: "quotation" },
    { key: "capacity", label: "Kapasitas (ton)", type: "number", section: "quotation" },
    { key: "area_pickup", label: "Area Pickup", type: "text", required: true, section: "quotation" },
    { key: "area_delivery", label: "Area Delivery", type: "text", required: true, section: "quotation" },
    { key: "price", label: "Harga Trucking (Rp)", type: "number", required: true, section: "quotation" },
    { key: "eta_delivery", label: "Estimasi Delivery", type: "text", section: "quotation" },
    { key: "notes", label: "Catatan Penawaran", type: "textarea", section: "quotation" },
    { key: "driver_name", label: "Nama Driver", type: "text", required: true, section: "operational" },
    { key: "driver_phone", label: "No HP Driver", type: "text", required: true, section: "operational" },
    { key: "op_notes", label: "Catatan Operasional", type: "textarea", section: "operational" },
  ],
};

// ── Insert / cleanup helpers using raw SQL via pool ───────────────────────────
async function insertSupplier(name: string): Promise<number> {
  const res = await pool.query(
    `INSERT INTO suppliers (name, service_type, is_active, logo, sort_order)
     VALUES ($1, 'test', true, '🧪', 999)
     RETURNING id`,
    [name],
  );
  return res.rows[0].id as number;
}

async function insertCatalogItem(data: Record<string, unknown>): Promise<number> {
  const keys = Object.keys(data);
  const vals = Object.values(data);
  const cols = keys.map((k) => toSnake(k)).join(", ");
  const params = keys.map((_, i) => (typeof vals[i] === "object" ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ");
  const res = await pool.query(
    `INSERT INTO vendor_catalog_items (${cols}) VALUES (${params}) RETURNING id`,
    vals.map((v) => (typeof v === "object" ? JSON.stringify(v) : v)),
  );
  return res.rows[0].id as number;
}

function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

async function cleanupVendors(ids: number[]) {
  if (ids.length === 0) return;
  await pool.query(`DELETE FROM vendor_catalog_items WHERE vendor_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM suppliers WHERE id = ANY($1)`, [ids]);
}

// ── Filter logic (mirrors catalogFilters.ts — duplicated for server-side use) ─
type MarketplaceItem = Record<string, unknown>;

function buildCatalogFilters(items: MarketplaceItem[]): Record<string, { type: string; options?: string[] }> {
  const templateFieldMap = new Map<string, { type: string; options: string[]; values: Set<string>; numbers: number[] }>();

  for (const item of items) {
    const snap = item.templateSnapshot as Record<string, unknown> | null;
    const specVals = (item.specValues as Record<string, unknown>) ?? {};
    const fields: Array<{ key: string; label: string; type: string; options?: string[]; section?: string }> = [];
    if (snap && Array.isArray(snap["customFields"])) {
      fields.push(...(snap["customFields"] as typeof fields));
    } else if (snap && Array.isArray(snap["fields"])) {
      fields.push(...(snap["fields"] as typeof fields).filter((f) => f.section === "quotation" || f.section === "both"));
    }
    for (const field of fields) {
      if (field.type === "textarea" || field.type === "date") continue;
      if (!templateFieldMap.has(field.key)) {
        templateFieldMap.set(field.key, { type: field.type === "number" ? "number-range" : "select", options: field.options ?? [], values: new Set(), numbers: [] });
      }
      const def = templateFieldMap.get(field.key)!;
      const rawVal = specVals[field.key];
      if (field.type === "number") {
        const n = Number(rawVal);
        if (!isNaN(n) && rawVal !== null && rawVal !== undefined) def.numbers.push(n);
      } else if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "") {
        def.values.add(String(rawVal));
      }
    }
  }

  const result: Record<string, { type: string; options?: string[] }> = {};
  for (const [key, def] of templateFieldMap) {
    if (def.type === "select") {
      const uniqueVals = [...def.values];
      if (uniqueVals.length < 2) continue;
      const optsByTemplate = def.options.length > 0 ? def.options.filter((o) => uniqueVals.includes(o)) : [];
      const opts = optsByTemplate.length >= 2 ? optsByTemplate : uniqueVals;
      if (opts.length < 2) continue;
      result[key] = { type: "select", options: opts };
    } else if (def.type === "number-range") {
      if (def.numbers.length < 2) continue;
      const mn = Math.min(...def.numbers);
      const mx = Math.max(...def.numbers);
      if (mn === mx) continue;
      result[key] = { type: "number-range" };
    }
  }
  return result;
}

function matchItem(item: MarketplaceItem, filter: Record<string, string>): boolean {
  const specVals = (item.specValues as Record<string, unknown>) ?? {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === "__vendor") { if (item.vendorName !== value) return false; continue; }
    if (key === "__stockStatus") { if (item.stockStatus !== value) return false; continue; }
    const rawVal = specVals[key];
    if (rawVal === undefined || rawVal === null) return false;
    if (String(rawVal).toLowerCase() !== value.toLowerCase()) return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ══════════════════════════════════════════════════════════════════════════════
async function run() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   MARKETPLACE E2E TEST — CST BizPortal                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const vendorIds: number[] = [];

  try {
    // ────────────────────────────────────────────────────────────────────────
    // SETUP: Insert test vendors
    // ────────────────────────────────────────────────────────────────────────
    console.log("📦 SETUP — Inserting test data...\n");

    const vendorAId = await insertSupplier("[TEST] Vendor A — Kopi & Trucking");
    const vendorBId = await insertSupplier("[TEST] Vendor B — Kopi & Trucking");
    vendorIds.push(vendorAId, vendorBId);

    // ── Scenario A: Kopi items ──────────────────────────────────────────────
    await insertCatalogItem({
      vendorId: vendorAId,
      vendorName: "[TEST] Vendor A",
      templateKind: "product",
      categoryKey: "coffee",
      templateId: "coffee",
      templateSnapshot: COFFEE_SNAPSHOT,
      name: "Kopi Arabica Gayo Premium",
      description: "Kopi Arabica Grade B asal Gayo, kadar air 12%",
      priceSell: "50000",
      priceBase: "38000",
      markupPct: "31.58",
      currency: "IDR",
      unit: "kg",
      moq: 100,
      stockStatus: "available",
      isPublished: true,
      isActive: true,
      status: "published",
      publishedAt: new Date().toISOString(),
      origin: "Gayo, Aceh",
      specValues: {
        bean_type: "Arabica",
        grade: "Grade B",
        moisture_pct: 12,
        origin: "Gayo, Aceh",
        quantity_kg: 5000,
      },
      sortOrder: 0,
    });

    await insertCatalogItem({
      vendorId: vendorBId,
      vendorName: "[TEST] Vendor B",
      templateKind: "product",
      categoryKey: "coffee",
      templateId: "coffee",
      templateSnapshot: COFFEE_SNAPSHOT,
      name: "Kopi Robusta Lampung",
      description: "Kopi Robusta Grade C asal Lampung, kadar air 13%",
      priceSell: "45000",
      priceBase: "33000",
      markupPct: "36.36",
      currency: "IDR",
      unit: "kg",
      moq: 100,
      stockStatus: "available",
      isPublished: true,
      isActive: true,
      status: "published",
      publishedAt: new Date().toISOString(),
      origin: "Lampung",
      specValues: {
        bean_type: "Robusta",
        grade: "Grade C",
        moisture_pct: 13,
        origin: "Lampung",
        quantity_kg: 8000,
      },
      sortOrder: 0,
    });

    // ── Scenario B: Trucking items ──────────────────────────────────────────
    await insertCatalogItem({
      vendorId: vendorAId,
      vendorName: "[TEST] Vendor A",
      templateKind: "service",
      serviceType: "trucking",
      templateId: "trucking",
      templateSnapshot: TRUCKING_SNAPSHOT,
      name: "Trucking CDD Jakarta–Surabaya",
      description: "Layanan trucking CDD rute Jakarta ke Surabaya, lead time 2 hari",
      priceSell: "3500000",
      priceBase: "2800000",
      markupPct: "25.00",
      currency: "IDR",
      unit: "ritase",
      moq: 1,
      stockStatus: "available",
      isPublished: true,
      isActive: true,
      status: "published",
      publishedAt: new Date().toISOString(),
      leadTime: "2 hari",
      specValues: {
        truck_type: "CDD",
        area_pickup: "Jakarta",
        area_delivery: "Surabaya",
        price: 3500000,
        eta_delivery: "2 hari",
      },
      sortOrder: 0,
    });

    await insertCatalogItem({
      vendorId: vendorBId,
      vendorName: "[TEST] Vendor B",
      templateKind: "service",
      serviceType: "trucking",
      templateId: "trucking",
      templateSnapshot: TRUCKING_SNAPSHOT,
      name: "Trucking Fuso Jakarta–Bandung",
      description: "Layanan trucking Fuso rute Jakarta ke Bandung",
      priceSell: "2500000",
      priceBase: "1900000",
      markupPct: "31.58",
      currency: "IDR",
      unit: "ritase",
      moq: 1,
      stockStatus: "available",
      isPublished: true,
      isActive: true,
      status: "published",
      publishedAt: new Date().toISOString(),
      specValues: {
        truck_type: "Fuso",
        area_pickup: "Jakarta",
        area_delivery: "Bandung",
        price: 2500000,
        eta_delivery: "1 hari",
      },
      sortOrder: 0,
    });

    console.log("  ✓ Vendor A inserted  (id:", vendorAId, ")");
    console.log("  ✓ Vendor B inserted  (id:", vendorBId, ")");
    console.log("  ✓ 2 Kopi catalog items inserted");
    console.log("  ✓ 2 Trucking catalog items inserted\n");

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO A — KOPI
    // ────────────────────────────────────────────────────────────────────────
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║  SCENARIO A — Kopi                                      ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const kopiRes = await fetch(`${API_BASE}/api/portal/marketplace?kind=product&category=coffee`);
    if (!kopiRes.ok) throw new Error(`API error ${kopiRes.status}`);
    const allKopi: MarketplaceItem[] = await kopiRes.json();
    const kopiItems = allKopi.filter((i) =>
      i.vendorName === "[TEST] Vendor A" || i.vendorName === "[TEST] Vendor B"
    );

    // A1 — Kedua item tampil di marketplace
    if (kopiItems.length === 2) {
      pass("A1 — Kedua Kopi item muncul di marketplace", `Total: ${kopiItems.length} item`);
    } else {
      fail("A1 — Kedua Kopi item muncul di marketplace", `Expected 2, got ${kopiItems.length}`);
    }

    // A2 — Harga Vendor A = 50.000
    const vendorA_kopi = kopiItems.find((i) => i.vendorName === "[TEST] Vendor A");
    if (vendorA_kopi && Number(vendorA_kopi.priceSell) === 50000) {
      pass("A2 — Harga Vendor A = 50.000", `priceSell: ${Number(vendorA_kopi.priceSell).toLocaleString("id-ID")}`);
    } else {
      fail("A2 — Harga Vendor A = 50.000", `Got: ${vendorA_kopi?.priceSell}`);
    }

    // A3 — Harga Vendor B = 45.000
    const vendorB_kopi = kopiItems.find((i) => i.vendorName === "[TEST] Vendor B");
    if (vendorB_kopi && Number(vendorB_kopi.priceSell) === 45000) {
      pass("A3 — Harga Vendor B = 45.000", `priceSell: ${Number(vendorB_kopi.priceSell).toLocaleString("id-ID")}`);
    } else {
      fail("A3 — Harga Vendor B = 45.000", `Got: ${vendorB_kopi?.priceSell}`);
    }

    // A4 — Filter Grade muncul di filter engine
    const kopiFilters = buildCatalogFilters(kopiItems);
    if (kopiFilters["grade"] && kopiFilters["grade"].type === "select") {
      const opts = kopiFilters["grade"].options ?? [];
      pass("A4 — Filter 'Grade' tersedia", `Options: [${opts.join(", ")}]`);
    } else {
      fail("A4 — Filter 'Grade' tersedia", `Filters found: ${Object.keys(kopiFilters).join(", ") || "none"}`);
    }

    // A5 — Filter Grade B → hanya Vendor A muncul
    const filteredGradeB = kopiItems.filter((i) => matchItem(i, { grade: "Grade B" }));
    if (filteredGradeB.length === 1 && filteredGradeB[0].vendorName === "[TEST] Vendor A") {
      pass("A5 — Filter Grade B → hanya Vendor A muncul", `Items: ${filteredGradeB.map((i) => i.vendorName).join(", ")}`);
    } else {
      fail("A5 — Filter Grade B → hanya Vendor A muncul", `Got: ${filteredGradeB.map((i) => i.vendorName).join(", ") || "kosong"}`);
    }

    // A6 — Filter Grade C → hanya Vendor B muncul
    const filteredGradeC = kopiItems.filter((i) => matchItem(i, { grade: "Grade C" }));
    if (filteredGradeC.length === 1 && filteredGradeC[0].vendorName === "[TEST] Vendor B") {
      pass("A6 — Filter Grade C → hanya Vendor B muncul", `Items: ${filteredGradeC.map((i) => i.vendorName).join(", ")}`);
    } else {
      fail("A6 — Filter Grade C → hanya Vendor B muncul", `Got: ${filteredGradeC.map((i) => i.vendorName).join(", ") || "kosong"}`);
    }

    // A7 — Harga Vendor B setelah filter Grade C = 45.000
    if (filteredGradeC[0] && Number(filteredGradeC[0].priceSell) === 45000) {
      pass("A7 — Harga Vendor B setelah filter Grade C = 45.000", `priceSell: ${Number(filteredGradeC[0].priceSell).toLocaleString("id-ID")}`);
    } else {
      fail("A7 — Harga Vendor B setelah filter Grade C = 45.000", `Got: ${filteredGradeC[0]?.priceSell}`);
    }

    // A8 — Origin Vendor A = Gayo
    const specA = (vendorA_kopi?.specValues as Record<string, unknown>) ?? {};
    if (String(specA["origin"] ?? "").toLowerCase().includes("gayo")) {
      pass("A8 — Origin Vendor A = Gayo", `spec.origin: ${specA["origin"]}`);
    } else {
      fail("A8 — Origin Vendor A = Gayo", `spec.origin: ${specA["origin"]}`);
    }

    // A9 — Moisture Vendor A = 12%
    if (Number(specA["moisture_pct"]) === 12) {
      pass("A9 — Moisture Vendor A = 12%", `spec.moisture_pct: ${specA["moisture_pct"]}`);
    } else {
      fail("A9 — Moisture Vendor A = 12%", `spec.moisture_pct: ${specA["moisture_pct"]}`);
    }

    // A10 — Stock Vendor A = available
    if (vendorA_kopi?.stockStatus === "available") {
      pass("A10 — Stock Vendor A = available", `stockStatus: ${vendorA_kopi.stockStatus}`);
    } else {
      fail("A10 — Stock Vendor A = available", `stockStatus: ${vendorA_kopi?.stockStatus}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO B — TRUCKING
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║  SCENARIO B — Trucking                                  ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const truckRes = await fetch(`${API_BASE}/api/portal/marketplace?kind=service&category=trucking`);
    if (!truckRes.ok) throw new Error(`API error ${truckRes.status}`);
    const allTruck: MarketplaceItem[] = await truckRes.json();
    const truckItems = allTruck.filter((i) =>
      i.vendorName === "[TEST] Vendor A" || i.vendorName === "[TEST] Vendor B"
    );

    // B1 — Kedua trucking item tampil
    if (truckItems.length === 2) {
      pass("B1 — Kedua Trucking item muncul di marketplace", `Total: ${truckItems.length} item`);
    } else {
      fail("B1 — Kedua Trucking item muncul di marketplace", `Expected 2, got ${truckItems.length}`);
    }

    // B2 — Filter truck_type muncul
    const truckFilters = buildCatalogFilters(truckItems);
    if (truckFilters["truck_type"] && truckFilters["truck_type"].type === "select") {
      const opts = truckFilters["truck_type"].options ?? [];
      pass("B2 — Filter 'Jenis Armada' tersedia", `Options: [${opts.join(", ")}]`);
    } else {
      fail("B2 — Filter 'Jenis Armada' tersedia", `Filters: ${Object.keys(truckFilters).join(", ") || "none"}`);
    }

    // B3 — Filter CDD → hanya Vendor A muncul
    const filteredCDD = truckItems.filter((i) => matchItem(i, { truck_type: "CDD" }));
    if (filteredCDD.length === 1 && filteredCDD[0].vendorName === "[TEST] Vendor A") {
      pass("B3 — Filter truck_type CDD → hanya Vendor A muncul", `Items: ${filteredCDD.map((i) => i.vendorName).join(", ")}`);
    } else {
      fail("B3 — Filter truck_type CDD → hanya Vendor A muncul", `Got: ${filteredCDD.map((i) => i.vendorName).join(", ") || "kosong"}`);
    }

    // B4 — Harga CDD = 3.500.000
    if (filteredCDD[0] && Number(filteredCDD[0].priceSell) === 3500000) {
      pass("B4 — Harga CDD (Vendor A) = Rp 3.500.000", `priceSell: ${Number(filteredCDD[0].priceSell).toLocaleString("id-ID")}`);
    } else {
      fail("B4 — Harga CDD (Vendor A) = Rp 3.500.000", `Got: ${filteredCDD[0]?.priceSell}`);
    }

    // B5 — Filter Fuso → hanya Vendor B
    const filteredFuso = truckItems.filter((i) => matchItem(i, { truck_type: "Fuso" }));
    if (filteredFuso.length === 1 && filteredFuso[0].vendorName === "[TEST] Vendor B") {
      pass("B5 — Filter truck_type Fuso → hanya Vendor B muncul", `Items: ${filteredFuso.map((i) => i.vendorName).join(", ")}`);
    } else {
      fail("B5 — Filter truck_type Fuso → hanya Vendor B muncul", `Got: ${filteredFuso.map((i) => i.vendorName).join(", ") || "kosong"}`);
    }

    // B6 — Lead time Vendor A = 2 hari
    const specTruckA = (filteredCDD[0]?.specValues as Record<string, unknown>) ?? {};
    if (String(specTruckA["eta_delivery"] ?? "").includes("2")) {
      pass("B6 — Lead time Vendor A (CDD) = 2 hari", `spec.eta_delivery: ${specTruckA["eta_delivery"]}`);
    } else {
      fail("B6 — Lead time Vendor A (CDD) = 2 hari", `spec.eta_delivery: ${specTruckA["eta_delivery"]}`);
    }

    // B7 — Route Vendor A: Jakarta → Surabaya
    const pickupA = String(specTruckA["area_pickup"] ?? "").toLowerCase();
    const deliveryA = String(specTruckA["area_delivery"] ?? "").toLowerCase();
    if (pickupA.includes("jakarta") && deliveryA.includes("surabaya")) {
      pass("B7 — Route Vendor A: Jakarta → Surabaya", `${specTruckA["area_pickup"]} → ${specTruckA["area_delivery"]}`);
    } else {
      fail("B7 — Route Vendor A: Jakarta → Surabaya", `Got: ${specTruckA["area_pickup"]} → ${specTruckA["area_delivery"]}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // SCENARIO C — SECURITY (priceBase / margin / internal notes TIDAK muncul)
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║  SCENARIO C — Security                                  ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    // Ambil raw response JSON untuk memeriksa field-level security
    const rawKopiJson = await fetch(`${API_BASE}/api/portal/marketplace?kind=product&category=coffee`);
    const rawKopiText = await rawKopiJson.text();

    // C1 — priceBase TIDAK ada di response
    if (!rawKopiText.includes('"priceBase"') && !rawKopiText.includes('"price_base"')) {
      pass("C1 — priceBase TIDAK terekspos di API response", "Field tidak ditemukan di JSON");
    } else {
      fail("C1 — priceBase TIDAK terekspos di API response", "KRITIS: priceBase ditemukan di response!");
    }

    // C2 — markupPct TIDAK ada di response
    if (!rawKopiText.includes('"markupPct"') && !rawKopiText.includes('"markup_pct"')) {
      pass("C2 — markupPct TIDAK terekspos di API response", "Field tidak ditemukan di JSON");
    } else {
      fail("C2 — markupPct TIDAK terekspos di API response", "KRITIS: markupPct ditemukan di response!");
    }

    // C3 — Nilai priceBase (38000) tidak ada di response
    if (!rawKopiText.includes("38000") && !rawKopiText.includes("33000")) {
      pass("C3 — Nilai priceBase internal TIDAK bocor di response", "38000 dan 33000 tidak ditemukan");
    } else {
      fail("C3 — Nilai priceBase internal TIDAK bocor di response", "Nilai priceBase internal ditemukan di response JSON!");
    }

    // C4 — Trucking: internal notes TIDAK muncul (notes ada di spec_values tapi tidak dalam snapshot quotation section)
    const rawTruckJson = await fetch(`${API_BASE}/api/portal/marketplace?kind=service&category=trucking`);
    const rawTruckText = await rawTruckJson.text();
    // op_notes ada di section "operational" → tidak tampil di specChips customer
    // Tapi kita verify snapshot yang dikembalikan masih include field definitions (bukan values operational)
    // Yang penting: priceBase trucking (2800000, 1900000) tidak bocor
    if (!rawTruckText.includes("2800000") && !rawTruckText.includes("1900000")) {
      pass("C4 — Trucking priceBase internal TIDAK bocor", "2800000 dan 1900000 tidak ditemukan");
    } else {
      fail("C4 — Trucking priceBase internal TIDAK bocor", "priceBase trucking ditemukan di response!");
    }

    // C5 — priceSell tampil dengan benar (boleh muncul)
    if (rawKopiText.includes("50000") && rawKopiText.includes("45000")) {
      pass("C5 — priceSell (harga jual) tampil dengan benar di response", "50000 dan 45000 ditemukan");
    } else {
      fail("C5 — priceSell (harga jual) tampil dengan benar di response", "priceSell tidak ditemukan!");
    }

    // C6 — Only published items returned (is_published = true)
    const allItems = [...kopiItems, ...truckItems];
    const allPublished = allItems.every((i) => i.isPublished !== false);
    if (allPublished) {
      pass("C6 — Semua item yang dikembalikan berstatus published", `${allItems.length} item, semua published`);
    } else {
      fail("C6 — Semua item yang dikembalikan berstatus published", "Ada item tidak published di response!");
    }

    // ────────────────────────────────────────────────────────────────────────
    // ADDITIONAL: Marketplace endpoint tanpa filter (semua)
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║  ADDITIONAL — Marketplace General                       ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const allRes = await fetch(`${API_BASE}/api/portal/marketplace`);
    const allData: MarketplaceItem[] = await allRes.json();
    const testItems = allData.filter((i) =>
      i.vendorName === "[TEST] Vendor A" || i.vendorName === "[TEST] Vendor B"
    );

    if (testItems.length === 4) {
      pass("D1 — Semua 4 test items muncul di marketplace (tanpa filter)", `Total test items: ${testItems.length}`);
    } else {
      fail("D1 — Semua 4 test items muncul di marketplace (tanpa filter)", `Expected 4, got ${testItems.length}`);
    }

    // Filter by kind=product
    const prodRes = await fetch(`${API_BASE}/api/portal/marketplace?kind=product`);
    const prodData: MarketplaceItem[] = await prodRes.json();
    const testProds = prodData.filter((i) => i.vendorName === "[TEST] Vendor A" || i.vendorName === "[TEST] Vendor B");
    if (testProds.every((i) => i.templateKind === "product")) {
      pass("D2 — Filter kind=product mengembalikan hanya produk", `${testProds.length} produk`);
    } else {
      fail("D2 — Filter kind=product mengembalikan hanya produk", "Ada non-product di response");
    }

    // Filter by kind=service
    const svcRes = await fetch(`${API_BASE}/api/portal/marketplace?kind=service`);
    const svcData: MarketplaceItem[] = await svcRes.json();
    const testSvcs = svcData.filter((i) => i.vendorName === "[TEST] Vendor A" || i.vendorName === "[TEST] Vendor B");
    if (testSvcs.every((i) => i.templateKind === "service")) {
      pass("D3 — Filter kind=service mengembalikan hanya jasa", `${testSvcs.length} jasa`);
    } else {
      fail("D3 — Filter kind=service mengembalikan hanya jasa", "Ada non-service di response");
    }

  } finally {
    // ── CLEANUP ──────────────────────────────────────────────────────────────
    console.log("\n🧹 CLEANUP — Menghapus test data...");
    await cleanupVendors(vendorIds);
    console.log("  ✓ Test vendors dan catalog items dihapus\n");

    await pool.end();
  }

  // ── REPORT ───────────────────────────────────────────────────────────────
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const pct = Math.round((passed / total) * 100);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  MARKETPLACE E2E TEST REPORT");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Tanggal  : ${new Date().toLocaleString("id-ID")}`);
  console.log(`  Total    : ${total} test cases`);
  console.log(`  Lulus    : ${passed} ✅`);
  console.log(`  Gagal    : ${failed} ${failed > 0 ? "❌" : "—"}`);
  console.log(`  Score    : ${pct}%`);
  console.log("═══════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    console.log("  FAILED TESTS:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ❌ ${r.name}`);
      console.log(`     ${r.detail}`);
    }
    console.log();
  }

  console.log("  SCENARIO SUMMARY:");
  console.log(`  Scenario A (Kopi)     : ${results.filter((r) => r.name.startsWith("A") && r.passed).length}/${results.filter((r) => r.name.startsWith("A")).length} passed`);
  console.log(`  Scenario B (Trucking) : ${results.filter((r) => r.name.startsWith("B") && r.passed).length}/${results.filter((r) => r.name.startsWith("B")).length} passed`);
  console.log(`  Scenario C (Security) : ${results.filter((r) => r.name.startsWith("C") && r.passed).length}/${results.filter((r) => r.name.startsWith("C")).length} passed`);
  console.log(`  Additional            : ${results.filter((r) => r.name.startsWith("D") && r.passed).length}/${results.filter((r) => r.name.startsWith("D")).length} passed`);
  console.log();

  const verdict = failed === 0
    ? "✅ MARKETPLACE SIAP DIPAKAI CUSTOMER PORTAL"
    : `⚠️  MARKETPLACE PERLU PERBAIKAN (${failed} test gagal)`;
  console.log(`  VERDICT: ${verdict}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("❌ TEST FATAL ERROR:", err);
  process.exit(1);
});
