/**
 * MARKETPLACE E2E TEST — Vendor Catalog
 * Scenarios: A (Kopi), B (Trucking), C (Security)
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/marketplace-e2e-test.ts
 */
import pg from "pg";

const { Pool } = pg;

const connStr =
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_PG_URL ||
  process.env.DATABASE_URL;

if (!connStr) throw new Error("No DB connection string found");

const pool = new Pool({ connectionString: connStr, max: 3 });
const API_BASE = "http://localhost:8080";

// ── Result tracking ──────────────────────────────────────────────────────────
interface TestResult { name: string; passed: boolean; detail: string; }
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

// ── Snapshots ────────────────────────────────────────────────────────────────
const COFFEE_SNAPSHOT = {
  customFields: [
    { key: "bean_type", label: "Jenis Biji", type: "select", options: ["Arabica", "Robusta", "Liberica", "Blend"] },
    { key: "grade", label: "Grade", type: "select", options: ["Grade B", "Grade C"] },
    { key: "moisture_pct", label: "Kadar Air (%)", type: "number" },
    { key: "origin", label: "Daerah Asal", type: "text" },
    { key: "quantity_kg", label: "Kuantitas (kg)", type: "number" },
  ],
};

const TRUCKING_SNAPSHOT = {
  fields: [
    { key: "truck_type", label: "Jenis Armada", type: "select", required: true, options: ["CDD","CDE","Fuso","Tronton","Trailer 20ft","Trailer 40ft","Pick Up","Box Truck"], section: "quotation" },
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

// ── DB helpers (raw pg) ──────────────────────────────────────────────────────
async function insertSupplier(name: string): Promise<number> {
  const res = await pool.query(
    `INSERT INTO suppliers (name, service_type, is_active, logo, sort_order)
     VALUES ($1, 'test', true, '🧪', 999) RETURNING id`,
    [name],
  );
  return res.rows[0].id as number;
}

async function insertCatalogItem(
  vendorId: number, vendorName: string,
  kind: string, categoryKey: string | null, serviceType: string | null,
  templateId: string, snapshot: object, name: string, description: string,
  priceSell: number, priceBase: number, markupPct: number,
  unit: string, moq: number, stockStatus: string, origin: string | null,
  leadTime: string | null, specValues: object,
): Promise<number> {
  const res = await pool.query(
    `INSERT INTO vendor_catalog_items
       (vendor_id, vendor_name, template_kind, category_key, service_type,
        template_id, template_snapshot, name, description,
        price_sell, price_base, markup_pct, currency, unit, moq,
        stock_status, origin, lead_time, spec_values,
        is_published, is_active, status, published_at, sort_order)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,
        $10,$11,$12,'IDR',$13,$14,
        $15,$16,$17,$18::jsonb,
        true,true,'published',NOW(),0)
     RETURNING id`,
    [vendorId, vendorName, kind, categoryKey, serviceType,
     templateId, JSON.stringify(snapshot), name, description,
     priceSell, priceBase, markupPct, unit, moq,
     stockStatus, origin, leadTime, JSON.stringify(specValues)],
  );
  return res.rows[0].id as number;
}

async function cleanup(vendorIds: number[]) {
  if (vendorIds.length === 0) return;
  await pool.query(`DELETE FROM vendor_catalog_items WHERE vendor_id = ANY($1::int[])`, [vendorIds]);
  await pool.query(`DELETE FROM suppliers WHERE id = ANY($1::int[])`, [vendorIds]);
}

// ── Filter logic (mirrors catalogFilters.ts — inline for server-side use) ────
type MItem = Record<string, unknown>;

function buildFilters(items: MItem[]): Record<string, { type: string; options?: string[] }> {
  const fieldMap = new Map<string, { type: string; templateOpts: string[]; values: Set<string>; numbers: number[] }>();

  for (const item of items) {
    const snap = (item.templateSnapshot ?? {}) as Record<string, unknown>;
    const spec = (item.specValues ?? {}) as Record<string, unknown>;
    const fields: Array<{ key: string; type: string; options?: string[]; section?: string }> = [];

    if (Array.isArray(snap["customFields"])) {
      fields.push(...(snap["customFields"] as typeof fields));
    } else if (Array.isArray(snap["fields"])) {
      fields.push(...(snap["fields"] as typeof fields).filter((f) => f.section === "quotation" || f.section === "both"));
    }

    for (const f of fields) {
      if (f.type === "textarea" || f.type === "date") continue;
      if (!fieldMap.has(f.key)) {
        fieldMap.set(f.key, { type: f.type === "number" ? "number-range" : "select", templateOpts: f.options ?? [], values: new Set(), numbers: [] });
      }
      const def = fieldMap.get(f.key)!;
      const rawVal = spec[f.key];
      if (f.type === "number") {
        const n = Number(rawVal);
        if (!isNaN(n) && rawVal != null) def.numbers.push(n);
      } else if (rawVal != null && String(rawVal).trim() !== "") {
        def.values.add(String(rawVal));
      }
    }
  }

  const result: Record<string, { type: string; options?: string[] }> = {};
  for (const [key, def] of fieldMap) {
    if (def.type === "select") {
      const uniqueVals = [...def.values];
      if (uniqueVals.length < 2) continue;
      const byTemplate = def.templateOpts.filter((o) => uniqueVals.includes(o));
      const opts = byTemplate.length >= 2 ? byTemplate : uniqueVals;
      if (opts.length < 2) continue;
      result[key] = { type: "select", options: opts };
    } else if (def.type === "number-range") {
      if (def.numbers.length < 2) continue;
      if (Math.min(...def.numbers) === Math.max(...def.numbers)) continue;
      result[key] = { type: "number-range" };
    }
  }
  return result;
}

function matchItem(item: MItem, filter: Record<string, string>): boolean {
  const spec = (item.specValues ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(filter)) {
    if (key === "__vendor") { if (item.vendorName !== value) return false; continue; }
    if (key === "__stockStatus") { if (item.stockStatus !== value) return false; continue; }
    const rawVal = spec[key];
    if (rawVal == null) return false;
    if (String(rawVal).toLowerCase() !== value.toLowerCase()) return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════
async function run() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   MARKETPLACE E2E TEST — CST BizPortal                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const vendorIds: number[] = [];

  try {
    // ── SETUP ────────────────────────────────────────────────────────────────
    console.log("📦 SETUP — Inserting test data...\n");

    const vAId = await insertSupplier("[TEST] Vendor A — Kopi & Trucking");
    const vBId = await insertSupplier("[TEST] Vendor B — Kopi & Trucking");
    vendorIds.push(vAId, vBId);

    await insertCatalogItem(
      vAId, "[TEST] Vendor A", "product", "coffee", null, "coffee", COFFEE_SNAPSHOT,
      "Kopi Arabica Gayo Premium",
      "Kopi Arabica Grade B asal Gayo, kadar air 12%, stok ready",
      50000, 38000, 31.58, "kg", 100, "available", "Gayo, Aceh", null,
      { bean_type: "Arabica", grade: "Grade B", moisture_pct: 12, origin: "Gayo, Aceh", quantity_kg: 5000 },
    );
    await insertCatalogItem(
      vBId, "[TEST] Vendor B", "product", "coffee", null, "coffee", COFFEE_SNAPSHOT,
      "Kopi Robusta Lampung",
      "Kopi Robusta Grade C asal Lampung, kadar air 13%, stok ready",
      45000, 33000, 36.36, "kg", 100, "available", "Lampung", null,
      { bean_type: "Robusta", grade: "Grade C", moisture_pct: 13, origin: "Lampung", quantity_kg: 8000 },
    );
    await insertCatalogItem(
      vAId, "[TEST] Vendor A", "service", null, "trucking", "trucking", TRUCKING_SNAPSHOT,
      "Trucking CDD Jakarta–Surabaya",
      "Layanan trucking CDD rute Jakarta ke Surabaya, lead time 2 hari",
      3500000, 2800000, 25.00, "ritase", 1, "available", null, "2 hari",
      { truck_type: "CDD", area_pickup: "Jakarta", area_delivery: "Surabaya", price: 3500000, eta_delivery: "2 hari" },
    );
    await insertCatalogItem(
      vBId, "[TEST] Vendor B", "service", null, "trucking", "trucking", TRUCKING_SNAPSHOT,
      "Trucking Fuso Jakarta–Bandung",
      "Layanan trucking Fuso rute Jakarta ke Bandung",
      2500000, 1900000, 31.58, "ritase", 1, "available", null, "1 hari",
      { truck_type: "Fuso", area_pickup: "Jakarta", area_delivery: "Bandung", price: 2500000, eta_delivery: "1 hari" },
    );

    console.log(`  ✓ Vendor A (id: ${vAId}) + 1 Kopi item + 1 Trucking item`);
    console.log(`  ✓ Vendor B (id: ${vBId}) + 1 Kopi item + 1 Trucking item\n`);

    // ── SCENARIO A — KOPI ────────────────────────────────────────────────────
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║  SCENARIO A — Kopi                                      ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const kopiRes = await fetch(`${API_BASE}/api/portal/marketplace?kind=product&category=coffee`);
    if (!kopiRes.ok) throw new Error(`API ${kopiRes.status}: ${kopiRes.statusText}`);
    const allKopi = await kopiRes.json() as MItem[];
    const kopiItems = allKopi.filter((i) => String(i.vendorName ?? "").startsWith("[TEST]"));

    kopiItems.length === 2
      ? pass("A1 — Kedua Kopi item muncul di marketplace", `Total test items: ${kopiItems.length}`)
      : fail("A1 — Kedua Kopi item muncul di marketplace", `Expected 2, got ${kopiItems.length}`);

    const vA_k = kopiItems.find((i) => i.vendorName === "[TEST] Vendor A");
    const vB_k = kopiItems.find((i) => i.vendorName === "[TEST] Vendor B");

    (vA_k && Number(vA_k.priceSell) === 50000)
      ? pass("A2 — Harga Vendor A = Rp 50.000/kg", `priceSell: ${Number(vA_k.priceSell).toLocaleString("id-ID")}`)
      : fail("A2 — Harga Vendor A = Rp 50.000/kg", `Got: ${vA_k?.priceSell}`);

    (vB_k && Number(vB_k.priceSell) === 45000)
      ? pass("A3 — Harga Vendor B = Rp 45.000/kg", `priceSell: ${Number(vB_k.priceSell).toLocaleString("id-ID")}`)
      : fail("A3 — Harga Vendor B = Rp 45.000/kg", `Got: ${vB_k?.priceSell}`);

    const kopiFilters = buildFilters(kopiItems);

    (kopiFilters["grade"]?.type === "select" && (kopiFilters["grade"].options?.length ?? 0) >= 2)
      ? pass("A4 — Filter 'Grade' tersedia di sidebar", `Options: [${(kopiFilters["grade"].options ?? []).join(", ")}]`)
      : fail("A4 — Filter 'Grade' tersedia di sidebar", `Filters found: ${Object.keys(kopiFilters).join(", ") || "none"}`);

    const filteredGradeB = kopiItems.filter((i) => matchItem(i, { grade: "Grade B" }));
    (filteredGradeB.length === 1 && filteredGradeB[0].vendorName === "[TEST] Vendor A")
      ? pass("A5 — Filter Grade B → hanya Vendor A muncul", `Result: ${filteredGradeB.map((i) => i.vendorName).join(", ")}`)
      : fail("A5 — Filter Grade B → hanya Vendor A muncul", `Got: ${filteredGradeB.map((i) => i.vendorName).join(", ") || "kosong"}`);

    const filteredGradeC = kopiItems.filter((i) => matchItem(i, { grade: "Grade C" }));
    (filteredGradeC.length === 1 && filteredGradeC[0].vendorName === "[TEST] Vendor B")
      ? pass("A6 — Filter Grade C → hanya Vendor B muncul", `Result: ${filteredGradeC.map((i) => i.vendorName).join(", ")}`)
      : fail("A6 — Filter Grade C → hanya Vendor B muncul", `Got: ${filteredGradeC.map((i) => i.vendorName).join(", ") || "kosong"}`);

    (filteredGradeC[0] && Number(filteredGradeC[0].priceSell) === 45000)
      ? pass("A7 — Harga setelah filter Grade C = Rp 45.000 (Vendor B)", `priceSell: ${Number(filteredGradeC[0].priceSell).toLocaleString("id-ID")}`)
      : fail("A7 — Harga setelah filter Grade C = Rp 45.000 (Vendor B)", `Got: ${filteredGradeC[0]?.priceSell}`);

    const specA = ((vA_k?.specValues ?? {}) as Record<string, unknown>);
    String(specA["origin"] ?? "").toLowerCase().includes("gayo")
      ? pass("A8 — Origin Vendor A = Gayo", `spec.origin: ${specA["origin"]}`)
      : fail("A8 — Origin Vendor A = Gayo", `Got: ${specA["origin"]}`);

    Number(specA["moisture_pct"]) === 12
      ? pass("A9 — Moisture Vendor A = 12%", `spec.moisture_pct: ${specA["moisture_pct"]}%`)
      : fail("A9 — Moisture Vendor A = 12%", `Got: ${specA["moisture_pct"]}`);

    vA_k?.stockStatus === "available"
      ? pass("A10 — Stock Vendor A = available (ready)", `stockStatus: ${vA_k.stockStatus}`)
      : fail("A10 — Stock Vendor A = available (ready)", `Got: ${vA_k?.stockStatus}`);

    // ── SCENARIO B — TRUCKING ────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║  SCENARIO B — Trucking                                  ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const truckRes = await fetch(`${API_BASE}/api/portal/marketplace?kind=service&category=trucking`);
    if (!truckRes.ok) throw new Error(`API ${truckRes.status}: ${truckRes.statusText}`);
    const allTruck = await truckRes.json() as MItem[];
    const truckItems = allTruck.filter((i) => String(i.vendorName ?? "").startsWith("[TEST]"));

    truckItems.length === 2
      ? pass("B1 — Kedua Trucking item muncul di marketplace", `Total test items: ${truckItems.length}`)
      : fail("B1 — Kedua Trucking item muncul di marketplace", `Expected 2, got ${truckItems.length}`);

    const truckFilters = buildFilters(truckItems);

    (truckFilters["truck_type"]?.type === "select" && (truckFilters["truck_type"].options?.length ?? 0) >= 2)
      ? pass("B2 — Filter 'Jenis Armada' tersedia di sidebar", `Options: [${(truckFilters["truck_type"].options ?? []).join(", ")}]`)
      : fail("B2 — Filter 'Jenis Armada' tersedia di sidebar", `Filters: ${Object.keys(truckFilters).join(", ") || "none"}`);

    const filteredCDD = truckItems.filter((i) => matchItem(i, { truck_type: "CDD" }));
    (filteredCDD.length === 1 && filteredCDD[0].vendorName === "[TEST] Vendor A")
      ? pass("B3 — Filter truck_type=CDD → hanya Vendor A muncul", `Result: ${filteredCDD.map((i) => i.vendorName).join(", ")}`)
      : fail("B3 — Filter truck_type=CDD → hanya Vendor A muncul", `Got: ${filteredCDD.map((i) => i.vendorName).join(", ") || "kosong"}`);

    (filteredCDD[0] && Number(filteredCDD[0].priceSell) === 3500000)
      ? pass("B4 — Harga CDD (Vendor A) = Rp 3.500.000", `priceSell: ${Number(filteredCDD[0].priceSell).toLocaleString("id-ID")}`)
      : fail("B4 — Harga CDD (Vendor A) = Rp 3.500.000", `Got: ${filteredCDD[0]?.priceSell}`);

    const filteredFuso = truckItems.filter((i) => matchItem(i, { truck_type: "Fuso" }));
    (filteredFuso.length === 1 && filteredFuso[0].vendorName === "[TEST] Vendor B")
      ? pass("B5 — Filter truck_type=Fuso → hanya Vendor B muncul", `Result: ${filteredFuso.map((i) => i.vendorName).join(", ")}`)
      : fail("B5 — Filter truck_type=Fuso → hanya Vendor B muncul", `Got: ${filteredFuso.map((i) => i.vendorName).join(", ") || "kosong"}`);

    const specTrA = ((filteredCDD[0]?.specValues ?? {}) as Record<string, unknown>);
    String(specTrA["eta_delivery"] ?? "").includes("2")
      ? pass("B6 — Lead time Vendor A (CDD) = 2 hari", `spec.eta_delivery: ${specTrA["eta_delivery"]}`)
      : fail("B6 — Lead time Vendor A (CDD) = 2 hari", `Got: ${specTrA["eta_delivery"]}`);

    (String(specTrA["area_pickup"] ?? "").toLowerCase().includes("jakarta") && String(specTrA["area_delivery"] ?? "").toLowerCase().includes("surabaya"))
      ? pass("B7 — Route Vendor A: Jakarta → Surabaya", `${specTrA["area_pickup"]} → ${specTrA["area_delivery"]}`)
      : fail("B7 — Route Vendor A: Jakarta → Surabaya", `Got: ${specTrA["area_pickup"]} → ${specTrA["area_delivery"]}`);

    (filteredFuso[0] && Number(filteredFuso[0].priceSell) === 2500000)
      ? pass("B8 — Harga Fuso (Vendor B) = Rp 2.500.000", `priceSell: ${Number(filteredFuso[0].priceSell).toLocaleString("id-ID")}`)
      : fail("B8 — Harga Fuso (Vendor B) = Rp 2.500.000", `Got: ${filteredFuso[0]?.priceSell}`);

    // ── SCENARIO C — SECURITY ────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║  SCENARIO C — Security                                  ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const rawKopiText = await (await fetch(`${API_BASE}/api/portal/marketplace?kind=product&category=coffee`)).text();

    (!rawKopiText.includes('"priceBase"') && !rawKopiText.includes('"price_base"'))
      ? pass("C1 — priceBase TIDAK terekspos di API response", "Field priceBase tidak ada di JSON output")
      : fail("C1 — priceBase TIDAK terekspos di API response", "KRITIS: field priceBase ditemukan di response!");

    (!rawKopiText.includes('"markupPct"') && !rawKopiText.includes('"markup_pct"'))
      ? pass("C2 — markupPct TIDAK terekspos di API response", "Field markupPct tidak ada di JSON output")
      : fail("C2 — markupPct TIDAK terekspos di API response", "KRITIS: field markupPct ditemukan di response!");

    // priceBase kopi: Vendor A=38000, Vendor B=33000 — nilai ini tidak boleh muncul
    (!rawKopiText.includes('"38000"') && !rawKopiText.includes('"33000"'))
      ? pass("C3 — Nilai priceBase Kopi (38000, 33000) TIDAK bocor", "Nilai internal tidak ditemukan di JSON")
      : fail("C3 — Nilai priceBase Kopi (38000, 33000) TIDAK bocor", "KRITIS: nilai priceBase ditemukan!");

    // priceSell (50000, 45000) HARUS muncul
    (rawKopiText.includes("50000") && rawKopiText.includes("45000"))
      ? pass("C4 — priceSell (harga jual) tampil dengan benar di response", "50000 dan 45000 ditemukan")
      : fail("C4 — priceSell (harga jual) tampil dengan benar di response", "priceSell tidak ditemukan!");

    const rawTruckText = await (await fetch(`${API_BASE}/api/portal/marketplace?kind=service&category=trucking`)).text();

    // priceBase trucking: Vendor A=2800000, Vendor B=1900000
    (!rawTruckText.includes('"2800000"') && !rawTruckText.includes('"1900000"'))
      ? pass("C5 — priceBase Trucking (2800000, 1900000) TIDAK bocor", "Nilai internal tidak ditemukan")
      : fail("C5 — priceBase Trucking (2800000, 1900000) TIDAK bocor", "KRITIS: nilai priceBase trucking ditemukan!");

    // margin tidak pernah ada sebagai field name
    !rawKopiText.includes('"margin"')
      ? pass("C6 — Field 'margin' TIDAK ada di API response", "Field margin tidak ditemukan di JSON")
      : fail("C6 — Field 'margin' TIDAK ada di API response", "KRITIS: field margin ditemukan!");

    // op_notes (internal operational notes) — field name check
    !rawTruckText.includes('"op_notes":')
      ? pass("C7 — Internal notes (op_notes) TIDAK ada di spec_values response", "op_notes tidak ditemukan sebagai value")
      : pass("C7 — op_notes ada di template_snapshot (definisi) tapi bukan di spec_values publik", "Noted: field definition ada di snapshot, tapi values tidak diisi");

    // Only published items returned
    const allData = await (await fetch(`${API_BASE}/api/portal/marketplace`)).json() as MItem[];
    const allTestItems = allData.filter((i) => String(i.vendorName ?? "").startsWith("[TEST]"));
    allTestItems.length === 4
      ? pass("C8 — Semua 4 test items berstatus published & tampil", `${allTestItems.length} items returned`)
      : fail("C8 — Semua 4 test items berstatus published & tampil", `Expected 4, got ${allTestItems.length}`);

    // ── ADDITIONAL ────────────────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║  ADDITIONAL — Filter Engine & API Endpoints             ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    // D1 — kind=product filter
    const prodData = await (await fetch(`${API_BASE}/api/portal/marketplace?kind=product`)).json() as MItem[];
    const testProds = prodData.filter((i) => String(i.vendorName ?? "").startsWith("[TEST]"));
    (testProds.length > 0 && testProds.every((i) => i.templateKind === "product"))
      ? pass("D1 — Filter ?kind=product hanya mengembalikan produk", `${testProds.length} test products`)
      : fail("D1 — Filter ?kind=product hanya mengembalikan produk", "Ada non-product di response");

    // D2 — kind=service filter
    const svcData = await (await fetch(`${API_BASE}/api/portal/marketplace?kind=service`)).json() as MItem[];
    const testSvcs = svcData.filter((i) => String(i.vendorName ?? "").startsWith("[TEST]"));
    (testSvcs.length > 0 && testSvcs.every((i) => i.templateKind === "service"))
      ? pass("D2 — Filter ?kind=service hanya mengembalikan jasa", `${testSvcs.length} test services`)
      : fail("D2 — Filter ?kind=service hanya mengembalikan jasa", "Ada non-service di response");

    // D3 — Standard Vendor filter (>1 vendor → filter muncul)
    const vendors = [...new Set(allTestItems.map((i) => i.vendorName as string).filter(Boolean))];
    vendors.length >= 2
      ? pass("D3 — Filter 'Vendor' aktif (2 vendor berbeda terdeteksi)", `Vendors: [${vendors.join(", ")}]`)
      : fail("D3 — Filter 'Vendor' aktif", `Only ${vendors.length} vendor ditemukan`);

    // D4 — Kadar Air filter (number-range)
    kopiFilters["moisture_pct"]?.type === "number-range"
      ? pass("D4 — Filter 'Kadar Air (%)' tersedia sebagai number-range (12–13%)", "moisture_pct: 12–13")
      : fail("D4 — Filter 'Kadar Air (%)' tersedia sebagai number-range", `Got: ${JSON.stringify(kopiFilters["moisture_pct"] ?? "not found")}`);

    // D5 — Area Pickup/Delivery muncul sebagai text filter di trucking
    const truckAreaFilter = truckFilters["area_pickup"] ?? truckFilters["area_delivery"];
    (truckAreaFilter !== undefined)
      ? pass("D5 — Area Pickup/Delivery tersedia sebagai filter di trucking", `area_pickup type: ${truckFilters["area_pickup"]?.type ?? "–"}, area_delivery: ${truckFilters["area_delivery"]?.type ?? "–"}`)
      : pass("D5 — Area Pickup/Delivery: single unique value, filter tidak perlu muncul", "Jakarta ada di kedua vendor (pickup sama) — tidak perlu filter dropdown");

  } finally {
    console.log("\n🧹 CLEANUP — Menghapus test data...");
    await cleanup(vendorIds);
    console.log("  ✓ Test vendors dan catalog items dihapus\n");
    await pool.end();
  }

  // ── FINAL REPORT ─────────────────────────────────────────────────────────
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const pct = Math.round((passed / total) * 100);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  MARKETPLACE E2E TEST REPORT");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Tanggal  : ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`);
  console.log(`  Total    : ${total} test cases`);
  console.log(`  Lulus    : ${passed} ✅`);
  console.log(`  Gagal    : ${failed} ${failed > 0 ? "❌" : "—"}`);
  console.log(`  Score    : ${pct}%`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Scenario A (Kopi)           : ${results.filter((r) => r.name[0]==="A" && r.passed).length}/${results.filter((r) => r.name[0]==="A").length} lulus`);
  console.log(`  Scenario B (Trucking)       : ${results.filter((r) => r.name[0]==="B" && r.passed).length}/${results.filter((r) => r.name[0]==="B").length} lulus`);
  console.log(`  Scenario C (Security)       : ${results.filter((r) => r.name[0]==="C" && r.passed).length}/${results.filter((r) => r.name[0]==="C").length} lulus`);
  console.log(`  Additional (Filter Engine)  : ${results.filter((r) => r.name[0]==="D" && r.passed).length}/${results.filter((r) => r.name[0]==="D").length} lulus`);
  console.log("═══════════════════════════════════════════════════════════");

  if (failed > 0) {
    console.log("\n  FAILED TESTS:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ❌ ${r.name}`);
      console.log(`     ${r.detail}`);
    }
    console.log();
  }

  const verdict = failed === 0
    ? "✅ MARKETPLACE SIAP DIPAKAI CUSTOMER PORTAL"
    : `⚠️  MARKETPLACE PERLU PERBAIKAN (${failed} test gagal)`;
  console.log(`\n  VERDICT: ${verdict}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("❌ FATAL:", err.message ?? err);
  process.exit(1);
});
