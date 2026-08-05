/**
 * Seed demo vendor catalog items for the Marketplace.
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/seed-marketplace.ts
 *
 * Idempotent: vendors are identified by name; existing ones are skipped.
 */
import pg from "pg";
const { Pool } = pg;

const connStr =
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.SUPABASE_PG_URL ||
  process.env.DATABASE_URL;
if (!connStr) throw new Error("No DB connection string found");

const pool = new Pool({ connectionString: connStr, max: 3 });

// ── Template snapshots (mirrors actual templates) ────────────────────────────

const COFFEE_SNAPSHOT = {
  customFields: [
    { key: "bean_type", label: "Jenis Biji", type: "select", options: ["Arabica", "Robusta", "Liberica", "Blend"] },
    { key: "grade", label: "Grade", type: "select", options: ["Specialty", "Grade 1", "Grade 2", "Grade B", "Grade C"] },
    { key: "moisture_pct", label: "Kadar Air (%)", type: "number" },
    { key: "origin", label: "Daerah Asal", type: "text" },
    { key: "quantity_kg", label: "Stok Tersedia (kg)", type: "number" },
    { key: "process", label: "Proses", type: "select", options: ["Natural", "Washed", "Honey", "Wet-Hulled"] },
  ],
};

const COAL_SNAPSHOT = {
  customFields: [
    { key: "gar", label: "GAR (Kkal/kg)", type: "number" },
    { key: "tm", label: "TM (%)", type: "number" },
    { key: "ash", label: "Ash (%)", type: "number" },
    { key: "sulfur", label: "Sulfur (%)", type: "number" },
    { key: "size", label: "Ukuran Bongkah", type: "select", options: ["0-50mm", "50-200mm", "ROM"] },
    { key: "origin", label: "Tambang Asal", type: "text" },
  ],
};

const PALM_OIL_SNAPSHOT = {
  customFields: [
    { key: "product_type", label: "Jenis Produk", type: "select", options: ["CPO", "CPKO", "RBD Palm Olein", "RBD Palm Stearin", "PKO"] },
    { key: "ffa", label: "FFA (%)", type: "number" },
    { key: "moisture", label: "Moisture (%)", type: "number" },
    { key: "iodine", label: "Iodine Value", type: "number" },
    { key: "origin", label: "Asal", type: "text" },
  ],
};

const TRUCKING_SNAPSHOT = {
  fields: [
    { key: "truck_type", label: "Jenis Armada", type: "select", required: true, options: ["CDD", "CDE", "Fuso", "Tronton", "Trailer 20ft", "Trailer 40ft", "Pick Up", "Box Truck"], section: "quotation" },
    { key: "capacity", label: "Kapasitas (ton)", type: "number", section: "quotation" },
    { key: "area_pickup", label: "Area Pickup", type: "text", required: true, section: "quotation" },
    { key: "area_delivery", label: "Area Delivery", type: "text", required: true, section: "quotation" },
    { key: "price", label: "Harga (Rp)", type: "number", required: true, section: "quotation" },
    { key: "eta_delivery", label: "Estimasi Delivery", type: "text", section: "quotation" },
    { key: "notes", label: "Catatan", type: "textarea", section: "quotation" },
    { key: "driver_name", label: "Nama Driver", type: "text", required: true, section: "operational" },
    { key: "driver_phone", label: "No HP Driver", type: "text", required: true, section: "operational" },
  ],
};

const SEA_FREIGHT_SNAPSHOT = {
  fields: [
    { key: "vessel_type", label: "Jenis Kapal", type: "select", options: ["Container", "Bulk Carrier", "Tanker", "General Cargo", "Ro-Ro"], section: "quotation" },
    { key: "container_size", label: "Ukuran Container", type: "select", options: ["20ft", "40ft", "40ft HC", "LCL"], section: "quotation" },
    { key: "route_from", label: "Pelabuhan Muat", type: "text", required: true, section: "quotation" },
    { key: "route_to", label: "Pelabuhan Bongkar", type: "text", required: true, section: "quotation" },
    { key: "transit_days", label: "Transit Time (hari)", type: "number", section: "quotation" },
    { key: "price_usd", label: "Harga (USD)", type: "number", section: "quotation" },
    { key: "thc_included", label: "THC Included", type: "select", options: ["Ya", "Tidak"], section: "quotation" },
    { key: "bl_included", label: "B/L Fee Included", type: "select", options: ["Ya", "Tidak"], section: "quotation" },
  ],
};

const PPJK_SNAPSHOT = {
  fields: [
    { key: "service_type", label: "Jenis Layanan", type: "select", options: ["Impor", "Ekspor", "Impor + Ekspor"], section: "quotation" },
    { key: "commodity", label: "Komoditas", type: "text", section: "quotation" },
    { key: "hs_code", label: "HS Code", type: "text", section: "quotation" },
    { key: "port", label: "Pelabuhan", type: "select", options: ["Tanjung Priok", "Tanjung Perak", "Belawan", "Makassar"], section: "quotation" },
    { key: "price", label: "Biaya Handling (Rp)", type: "number", section: "quotation" },
    { key: "validity", label: "Masa Berlaku", type: "text", section: "quotation" },
  ],
};

// ── Vendor + items data ───────────────────────────────────────────────────────

interface CatalogItem {
  name: string;
  description: string;
  templateKind: "product" | "service";
  categoryKey: string | null;
  serviceType: string | null;
  templateId: string;
  snapshot: object;
  priceSell: number | null;
  priceBase: number;
  markupPct: number;
  currency: string;
  unit: string;
  moq: number;
  stockStatus: string;
  origin: string | null;
  location: string | null;
  leadTime: string | null;
  specValues: object;
  sortOrder: number;
}

interface VendorSeed {
  name: string;
  serviceType: string;
  logo: string;
  items: CatalogItem[];
}

const VENDORS: VendorSeed[] = [
  // ── Vendor 1: Kopi & Commodity Trader ────────────────────────────────────
  {
    name: "PT Nusantara Agro Prima",
    serviceType: "commodity",
    logo: "☕",
    items: [
      {
        name: "Kopi Arabica Gayo — Grade Specialty",
        description: "Kopi Arabica Gayo Aceh dengan cup score 85+. Proses Natural dan Washed tersedia. Aroma fruity floral, body medium-high. Cocok untuk specialty coffee roaster dan eksportir.",
        templateKind: "product", categoryKey: "coffee", serviceType: null,
        templateId: "coffee", snapshot: COFFEE_SNAPSHOT,
        priceSell: 75000, priceBase: 52000, markupPct: 44.23, currency: "IDR", unit: "kg",
        moq: 500, stockStatus: "available", origin: "Gayo, Aceh", location: "Medan, Sumatera Utara",
        leadTime: "3-5 hari kerja",
        specValues: { bean_type: "Arabica", grade: "Specialty", moisture_pct: 11.5, origin: "Gayo, Aceh", quantity_kg: 20000, process: "Natural" },
        sortOrder: 1,
      },
      {
        name: "Kopi Arabica Toraja — Grade 1",
        description: "Kopi Arabica Toraja Sulawesi dengan karakter earthy, spicy, dan dark chocolate. Ideal untuk ekspor ke Jepang dan Korea. Stok rutin setiap panen.",
        templateKind: "product", categoryKey: "coffee", serviceType: null,
        templateId: "coffee", snapshot: COFFEE_SNAPSHOT,
        priceSell: 68000, priceBase: 47000, markupPct: 44.68, currency: "IDR", unit: "kg",
        moq: 300, stockStatus: "available", origin: "Tana Toraja, Sulawesi Selatan", location: "Makassar, Sulawesi Selatan",
        leadTime: "5-7 hari kerja",
        specValues: { bean_type: "Arabica", grade: "Grade 1", moisture_pct: 12, origin: "Tana Toraja", quantity_kg: 15000, process: "Wet-Hulled" },
        sortOrder: 2,
      },
      {
        name: "Kopi Robusta Lampung — Grade B",
        description: "Kopi Robusta Lampung grade B, kadar air 12-13%, cocok untuk blending dan industri kopi sachet. Harga kompetitif dengan kualitas stabil.",
        templateKind: "product", categoryKey: "coffee", serviceType: null,
        templateId: "coffee", snapshot: COFFEE_SNAPSHOT,
        priceSell: 32000, priceBase: 22000, markupPct: 45.45, currency: "IDR", unit: "kg",
        moq: 1000, stockStatus: "available", origin: "Lampung", location: "Lampung",
        leadTime: "2-3 hari kerja",
        specValues: { bean_type: "Robusta", grade: "Grade B", moisture_pct: 12.5, origin: "Lampung", quantity_kg: 50000, process: "Natural" },
        sortOrder: 3,
      },
    ],
  },
  // ── Vendor 2: Batubara & Mineral ──────────────────────────────────────────
  {
    name: "PT Bara Energi Kalimantan",
    serviceType: "commodity",
    logo: "⛏️",
    items: [
      {
        name: "Batubara Thermal — GAR 4200",
        description: "Batubara thermal kalori 4200 Kkal/kg asal Kalimantan Selatan. Cocok untuk PLTU dan industri semen. Pengiriman via tongkang dari Pelabuhan Taboneo.",
        templateKind: "product", categoryKey: "coal", serviceType: null,
        templateId: "coal", snapshot: COAL_SNAPSHOT,
        priceSell: 850000, priceBase: 620000, markupPct: 37.10, currency: "IDR", unit: "MT",
        moq: 5000, stockStatus: "available", origin: "Kalimantan Selatan", location: "Banjarmasin",
        leadTime: "14-21 hari (FOB tongkang)",
        specValues: { gar: 4200, tm: 36, ash: 8, sulfur: 0.5, size: "0-50mm", origin: "Kalsel" },
        sortOrder: 1,
      },
      {
        name: "Batubara Thermal — GAR 5000",
        description: "Batubara medium-high kalori 5000 Kkal/kg. Kandungan sulfur rendah (<0.8%), ideal untuk ekspor dan industri besar. Tersedia dalam jumlah besar.",
        templateKind: "product", categoryKey: "coal", serviceType: null,
        templateId: "coal", snapshot: COAL_SNAPSHOT,
        priceSell: 1150000, priceBase: 830000, markupPct: 38.55, currency: "IDR", unit: "MT",
        moq: 3000, stockStatus: "available", origin: "Kalimantan Timur", location: "Samarinda",
        leadTime: "14-21 hari (FOB tongkang)",
        specValues: { gar: 5000, tm: 28, ash: 6.5, sulfur: 0.7, size: "0-50mm", origin: "Kaltim" },
        sortOrder: 2,
      },
    ],
  },
  // ── Vendor 3: Trucking ────────────────────────────────────────────────────
  {
    name: "CV Maju Transport Nusantara",
    serviceType: "trucking",
    logo: "🚛",
    items: [
      {
        name: "Trucking CDD — Jakarta ke Surabaya",
        description: "Layanan trucking CDD (Colt Diesel Double) rute Jakarta–Surabaya via Pantura. Kapasitas muatan 5-6 ton, lead time 2-3 hari. Driver berpengalaman, dilengkapi GPS tracking.",
        templateKind: "service", categoryKey: null, serviceType: "trucking",
        templateId: "trucking", snapshot: TRUCKING_SNAPSHOT,
        priceSell: 4500000, priceBase: 3200000, markupPct: 40.63, currency: "IDR", unit: "ritase",
        moq: 1, stockStatus: "available", origin: null, location: "Jakarta Utara",
        leadTime: "2-3 hari",
        specValues: { truck_type: "CDD", capacity: 6, area_pickup: "Jakarta", area_delivery: "Surabaya", price: 4500000, eta_delivery: "2-3 hari" },
        sortOrder: 1,
      },
      {
        name: "Trucking Fuso — Jakarta ke Semarang",
        description: "Trucking Fuso kapasitas 8-10 ton untuk rute Jakarta–Semarang. Dilengkapi terpal/bak tertutup, cocok untuk muatan packaged goods dan bahan industri.",
        templateKind: "service", categoryKey: null, serviceType: "trucking",
        templateId: "trucking", snapshot: TRUCKING_SNAPSHOT,
        priceSell: 3200000, priceBase: 2300000, markupPct: 39.13, currency: "IDR", unit: "ritase",
        moq: 1, stockStatus: "available", origin: null, location: "Jakarta Barat",
        leadTime: "1-2 hari",
        specValues: { truck_type: "Fuso", capacity: 10, area_pickup: "Jakarta", area_delivery: "Semarang", price: 3200000, eta_delivery: "1-2 hari" },
        sortOrder: 2,
      },
      {
        name: "Trucking Tronton — Antar Pulau (via Ferry)",
        description: "Layanan trucking Tronton 20+ ton untuk pengiriman antar pulau via ferry. Rute Jawa–Sumatera, Jawa–Bali, dan Jawa–Kalimantan. Harga belum termasuk biaya ferry.",
        templateKind: "service", categoryKey: null, serviceType: "trucking",
        templateId: "trucking", snapshot: TRUCKING_SNAPSHOT,
        priceSell: 8500000, priceBase: 6200000, markupPct: 37.10, currency: "IDR", unit: "ritase",
        moq: 1, stockStatus: "available", origin: null, location: "Surabaya, Jawa Timur",
        leadTime: "3-5 hari",
        specValues: { truck_type: "Tronton", capacity: 20, area_pickup: "Surabaya", area_delivery: "Makassar (via Ferry)", price: 8500000, eta_delivery: "3-5 hari" },
        sortOrder: 3,
      },
    ],
  },
  // ── Vendor 4: Sea Freight & Forwarding ───────────────────────────────────
  {
    name: "PT Samudera Lintas Benua",
    serviceType: "sea_freight",
    logo: "🚢",
    items: [
      {
        name: "FCL 20ft — Surabaya ke Singapura",
        description: "Full Container Load 20ft rute Surabaya (Tanjung Perak) ke Singapura (PSA). Transit time 4-5 hari. Sudah termasuk D/O, THC, dan B/L fee. Cocok untuk general cargo dan non-hazardous.",
        templateKind: "service", categoryKey: null, serviceType: "sea_freight",
        templateId: "sea_freight", snapshot: SEA_FREIGHT_SNAPSHOT,
        priceSell: null, priceBase: 0, markupPct: 0, currency: "USD", unit: "container",
        moq: 1, stockStatus: "available", origin: null, location: "Surabaya (Tanjung Perak)",
        leadTime: "4-5 hari transit",
        specValues: { vessel_type: "Container", container_size: "20ft", route_from: "Surabaya", route_to: "Singapura", transit_days: 5, thc_included: "Ya", bl_included: "Ya" },
        sortOrder: 1,
      },
      {
        name: "FCL 40ft HC — Jakarta ke Rotterdam",
        description: "Full Container Load 40ft High Cube rute Jakarta (Tanjung Priok) ke Rotterdam. Transit time 21-25 hari via Eropa route. Kapal pelayaran regular mingguan.",
        templateKind: "service", categoryKey: null, serviceType: "sea_freight",
        templateId: "sea_freight", snapshot: SEA_FREIGHT_SNAPSHOT,
        priceSell: null, priceBase: 0, markupPct: 0, currency: "USD", unit: "container",
        moq: 1, stockStatus: "available", origin: null, location: "Jakarta (Tanjung Priok)",
        leadTime: "21-25 hari transit",
        specValues: { vessel_type: "Container", container_size: "40ft HC", route_from: "Jakarta", route_to: "Rotterdam", transit_days: 23, thc_included: "Ya", bl_included: "Tidak" },
        sortOrder: 2,
      },
    ],
  },
  // ── Vendor 5: CPO & Palm Oil ─────────────────────────────────────────────
  {
    name: "PT Sawit Jaya Makmur",
    serviceType: "commodity",
    logo: "🌴",
    items: [
      {
        name: "Crude Palm Oil (CPO) — FOB Pelabuhan Belawan",
        description: "CPO berkualitas dari perkebunan bersertifikat RSPO. Kadar FFA <3.5%, moisture <0.15%. Tersedia pengiriman FOB dari Pelabuhan Belawan, Medan.",
        templateKind: "product", categoryKey: "palm_oil", serviceType: null,
        templateId: "palm_oil", snapshot: PALM_OIL_SNAPSHOT,
        priceSell: 11800000, priceBase: 10500000, markupPct: 12.38, currency: "IDR", unit: "MT",
        moq: 100, stockStatus: "available", origin: "Sumatera Utara", location: "Belawan, Medan",
        leadTime: "7-14 hari",
        specValues: { product_type: "CPO", ffa: 3.2, moisture: 0.12, iodine: 53, origin: "Sumut" },
        sortOrder: 1,
      },
      {
        name: "RBD Palm Olein — Grade A",
        description: "Refined, Bleached, Deodorized Palm Olein untuk industri makanan dan biodiesel. Iodine Value 56-60, FFA <0.1%. Kemasan drum 200L atau bulk tanker.",
        templateKind: "product", categoryKey: "palm_oil", serviceType: null,
        templateId: "palm_oil", snapshot: PALM_OIL_SNAPSHOT,
        priceSell: 13500000, priceBase: 11800000, markupPct: 14.41, currency: "IDR", unit: "MT",
        moq: 50, stockStatus: "limited", origin: "Sumatera Utara", location: "Dumai, Riau",
        leadTime: "5-10 hari",
        specValues: { product_type: "RBD Palm Olein", ffa: 0.08, moisture: 0.1, iodine: 58, origin: "Riau" },
        sortOrder: 2,
      },
    ],
  },
  // ── Vendor 6: PPJK / Customs Clearance ───────────────────────────────────
  {
    name: "PT Buana Customs Clearance",
    serviceType: "ppjk",
    logo: "📋",
    items: [
      {
        name: "Customs Clearance Impor — Tanjung Priok",
        description: "Layanan PPJK (Pengusaha Pengurusan Jasa Kepabeanan) untuk impor via Tanjung Priok. Meliputi PIB, pemeriksaan fisik, jalur merah/hijau/kuning. Berpengalaman 20+ tahun.",
        templateKind: "service", categoryKey: null, serviceType: "ppjk",
        templateId: "ppjk", snapshot: PPJK_SNAPSHOT,
        priceSell: 2500000, priceBase: 1800000, markupPct: 38.89, currency: "IDR", unit: "shipment",
        moq: 1, stockStatus: "available", origin: null, location: "Jakarta Utara (Tanjung Priok)",
        leadTime: "1-3 hari kerja",
        specValues: { service_type: "Impor", commodity: "General Cargo", hs_code: "Semua komoditas", port: "Tanjung Priok", price: 2500000, validity: "Per September 2025" },
        sortOrder: 1,
      },
      {
        name: "Customs Clearance Ekspor + Impor — Tanjung Perak",
        description: "Paket lengkap layanan ekspor dan impor via Tanjung Perak, Surabaya. Pengurusan PEB, PIB, dokumen COO, fumigasi, dan koordinasi dengan instansi terkait.",
        templateKind: "service", categoryKey: null, serviceType: "ppjk",
        templateId: "ppjk", snapshot: PPJK_SNAPSHOT,
        priceSell: 3800000, priceBase: 2700000, markupPct: 40.74, currency: "IDR", unit: "shipment",
        moq: 1, stockStatus: "available", origin: null, location: "Surabaya (Tanjung Perak)",
        leadTime: "1-3 hari kerja",
        specValues: { service_type: "Impor + Ekspor", commodity: "General + Bulk", hs_code: "Semua komoditas", port: "Tanjung Perak", price: 3800000, validity: "Per September 2025" },
        sortOrder: 2,
      },
    ],
  },
];

// ── DB operations ─────────────────────────────────────────────────────────────

async function getOrCreateVendor(name: string, serviceType: string, logo: string): Promise<number> {
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM suppliers WHERE name = $1 LIMIT 1`,
    [name],
  );
  if (existing.rows.length > 0) {
    console.log(`  ↩  Vendor sudah ada: "${name}" (id: ${existing.rows[0].id})`);
    return existing.rows[0].id;
  }
  const res = await pool.query<{ id: number }>(
    `INSERT INTO suppliers (name, service_type, is_active, logo, sort_order)
     VALUES ($1, $2, true, $3, 0) RETURNING id`,
    [name, serviceType, logo],
  );
  console.log(`  ✓ Vendor baru: "${name}" (id: ${res.rows[0].id})`);
  return res.rows[0].id;
}

async function seedItem(vendorId: number, vendorName: string, item: CatalogItem) {
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM vendor_catalog_items WHERE vendor_id = $1 AND name = $2 LIMIT 1`,
    [vendorId, item.name],
  );
  if (existing.rows.length > 0) {
    console.log(`    ↩  Item sudah ada: "${item.name}"`);
    return;
  }
  await pool.query(
    `INSERT INTO vendor_catalog_items
       (vendor_id, vendor_name, template_kind, category_key, service_type,
        template_id, template_snapshot, name, description,
        price_sell, price_base, markup_pct, currency, unit, moq,
        stock_status, origin, location, lead_time, spec_values,
        is_published, is_active, status, published_at, sort_order)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,
        $10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20::jsonb,
        true,true,'published',NOW(),$21)`,
    [
      vendorId, vendorName, item.templateKind, item.categoryKey, item.serviceType,
      item.templateId, JSON.stringify(item.snapshot), item.name, item.description,
      item.priceSell, item.priceBase, item.markupPct, item.currency, item.unit, item.moq,
      item.stockStatus, item.origin, item.location, item.leadTime, JSON.stringify(item.specValues),
      item.sortOrder,
    ],
  );
  console.log(`    ✓ Item: "${item.name}"`);
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  SEED — Vendor Catalog Marketplace Demo Data        ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  let totalVendors = 0;
  let totalItems = 0;

  for (const vendor of VENDORS) {
    console.log(`\n📦 ${vendor.name}`);
    const vendorId = await getOrCreateVendor(vendor.name, vendor.serviceType, vendor.logo);
    totalVendors++;
    for (const item of vendor.items) {
      await seedItem(vendorId, vendor.name, item);
      totalItems++;
    }
  }

  await pool.end();

  console.log("\n══════════════════════════════════════════════════════");
  console.log(`  Selesai!`);
  console.log(`  Vendors  : ${totalVendors}`);
  console.log(`  Items    : ${totalItems}`);
  console.log("══════════════════════════════════════════════════════\n");
  console.log("  Cek marketplace: http://localhost:5173/marketplace");
  console.log("  atau via Gateway: https://$REPLIT_DEV_DOMAIN/marketplace\n");
}

main().catch((err) => {
  console.error("❌ FATAL:", err.message ?? err);
  process.exit(1);
});
