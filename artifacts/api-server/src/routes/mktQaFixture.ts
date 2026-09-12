/**
 * mktQaFixture.ts — QA Fixture Manager
 * ======================================
 * BizPortal admin tool: load / reset / remove QA dataset for the Marketplace.
 * Registered at: /api/admin/marketplace/qa
 *
 * SAFETY: Triple production guard. ALL endpoints return HTTP 403 if any of:
 *   1. APP_ENV  === 'production'
 *   2. NODE_ENV === 'production'
 *   3. Primary DB URL contains PROD project ref (nzdweipzckfszczzqtuw)
 *
 * Allowed roles: super_admin | developer | qa_manager
 *
 * Endpoints:
 *   GET    /api/admin/marketplace/qa/status    — env info + dataset stats
 *   POST   /api/admin/marketplace/qa/load      — idempotent seed
 *   POST   /api/admin/marketplace/qa/reset     — restore to initial fixture state
 *   DELETE /api/admin/marketplace/qa/remove    — delete all qa items
 *   GET    /api/admin/marketplace/qa/report    — dataset report
 *   POST   /api/admin/marketplace/qa/validate  — validation checks
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireRole } from "../lib/requireAdmin.js";
import { auditFromReq } from "../lib/auditLog.js";
import { PROD_PROJECT_REF } from "../lib/envGuard.js";

const router = Router();

// ─── Constants ────────────────────────────────────────────────────────────────

const PROD_REF    = PROD_PROJECT_REF; // single source of truth — envGuard.ts
const QA_MODULE   = "marketplace_qa";
const QA_MARKER   = "qa";
const QA_VERSION  = "1.0.0";

const ALLOWED_ROLES = ["super_admin", "developer", "qa_manager"];

// Image URLs (Unsplash public domain)
const IMG: Record<string, string> = {
  coffee:    "https://images.unsplash.com/photo-1611854779393-1b2da9d400fe?w=800&q=80",
  coal:      "https://images.unsplash.com/photo-1601597111158-2fceff292cdc?w=800&q=80",
  palm_oil:  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80",
  seafood:   "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=800&q=80",
  cashew:    "https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?w=800&q=80",
  fresh_vegetable: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&q=80",
  pineapple: "https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=800&q=80",
};

const mkMedia = (cat: string) => JSON.stringify([{
  type: "image", url: IMG[cat] ?? IMG.coffee, isPrimary: true,
}]);

// ─── QA Fixture definitions (no hardcoded vendor IDs — resolved at runtime) ───

interface FixtureDef {
  slot: string;
  name: string;
  description: string;
  kategori: string;
  categoryKey: string;
  vendorKind: "internal" | "external";
  stockStatus: "available" | "on_order" | "limited";
  priceSell: number | null;
  currency: string;
  unit: string;
  moq: number;
  origin: string;
  location: string;
  hasImage: boolean;
}

const FIXTURES: FixtureDef[] = [
  // ── Coffee ──────────────────────────────────────────────────────────────────
  {
    slot: "coffee-1",
    name: "[QA] Coffee Arabica Premium",
    description: "Arabica single-origin premium, diproses natural, Grade 1. [QA fixture]",
    kategori: "coffee", categoryKey: "coffee",
    vendorKind: "internal", stockStatus: "available",
    priceSell: 150000, currency: "USD", unit: "MT", moq: 1,
    origin: "Aceh, Indonesia", location: "Banda Aceh, Aceh",
    hasImage: true,
  },
  {
    slot: "coffee-2",
    name: "[QA] Coffee Robusta Bulk",
    description: "Robusta bulk grade, kadar air <12%. Harga on request. [QA fixture — tanpa harga]",
    kategori: "coffee", categoryKey: "coffee",
    vendorKind: "external", stockStatus: "on_order",
    priceSell: null, currency: "USD", unit: "MT", moq: 5,
    origin: "Lampung, Indonesia", location: "Bandar Lampung, Lampung",
    hasImage: false,
  },
  // ── Coal ────────────────────────────────────────────────────────────────────
  {
    slot: "coal-1",
    name: "[QA] Batubara Thermal GAR 4200",
    description: "Batubara thermal low rank, GAR 4200 kcal/kg. Cocok untuk PLTU. [QA fixture]",
    kategori: "coal", categoryKey: "coal",
    vendorKind: "internal", stockStatus: "on_order",
    priceSell: 850000, currency: "IDR", unit: "MT", moq: 500,
    origin: "Kalimantan Selatan, Indonesia", location: "Banjarmasin, Kalimantan Selatan",
    hasImage: true,
  },
  {
    slot: "coal-2",
    name: "[QA] Batubara Coking Premium",
    description: "Coking coal premium, rendah sulfur, untuk industri baja. [QA fixture — tanpa foto]",
    kategori: "coal", categoryKey: "coal",
    vendorKind: "external", stockStatus: "on_order",
    priceSell: null, currency: "IDR", unit: "MT", moq: 1000,
    origin: "Kalimantan Timur, Indonesia", location: "Samarinda, Kalimantan Timur",
    hasImage: false,
  },
  // ── Palm Oil ─────────────────────────────────────────────────────────────────
  {
    slot: "palm-1",
    name: "[QA] Palm Acid Oil",
    description: "Palm acid oil, FFA 60-80%, untuk industri oleokimia. [QA fixture]",
    kategori: "palm_oil", categoryKey: "palm_oil",
    vendorKind: "internal", stockStatus: "on_order",
    priceSell: 8500000, currency: "IDR", unit: "MT", moq: 20,
    origin: "Sumatera Utara, Indonesia", location: "Medan, Sumatera Utara",
    hasImage: true,
  },
  {
    slot: "palm-2",
    name: "[QA] RBD Palm Olein",
    description: "RBD palm olein IV>56, cocok untuk minyak goreng. [QA fixture — available, tanpa harga]",
    kategori: "palm_oil", categoryKey: "palm_oil",
    vendorKind: "external", stockStatus: "available",
    priceSell: null, currency: "IDR", unit: "MT", moq: 10,
    origin: "Riau, Indonesia", location: "Pekanbaru, Riau",
    hasImage: false,
  },
  // ── Seafood ──────────────────────────────────────────────────────────────────
  {
    slot: "seafood-1",
    name: "[QA] Frozen Tuna Loin",
    description: "Yellowfin tuna loin frozen -18°C, sertifikasi HACCP. [QA fixture]",
    kategori: "seafood", categoryKey: "seafood",
    vendorKind: "internal", stockStatus: "on_order",
    priceSell: 85000, currency: "IDR", unit: "Kg", moq: 100,
    origin: "Jawa Timur, Indonesia", location: "Surabaya, Jawa Timur",
    hasImage: true,
  },
  {
    slot: "seafood-2",
    name: "[QA] Frozen Shrimp Vannamei",
    description: "Udang vaname beku HOSO, size 30/40. [QA fixture — limited, tanpa foto]",
    kategori: "seafood", categoryKey: "seafood",
    vendorKind: "external", stockStatus: "limited",
    priceSell: 95000, currency: "IDR", unit: "Kg", moq: 50,
    origin: "Jawa Timur, Indonesia", location: "Sidoarjo, Jawa Timur",
    hasImage: false,
  },
  // ── Cashew ──────────────────────────────────────────────────────────────────
  {
    slot: "cashew-1",
    name: "[QA] Raw Cashew Nut R320",
    description: "Kacang mete mentah R320, kadar air <12%. [QA fixture]",
    kategori: "cashew_nut", categoryKey: "cashew_nut",
    vendorKind: "internal", stockStatus: "available",
    priceSell: 32000, currency: "IDR", unit: "Kg", moq: 200,
    origin: "Sulawesi Barat, Indonesia", location: "Mamuju, Sulawesi Barat",
    hasImage: true,
  },
  {
    slot: "cashew-2",
    name: "[QA] Cashew Nut WW240",
    description: "Kacang mete WW240, harga on request. [QA fixture — tanpa harga]",
    kategori: "cashew_nut", categoryKey: "cashew_nut",
    vendorKind: "external", stockStatus: "on_order",
    priceSell: null, currency: "USD", unit: "MT", moq: 1,
    origin: "NTT, Indonesia", location: "Kupang, NTT",
    hasImage: false,
  },
  // ── Fresh Vegetable ──────────────────────────────────────────────────────────
  {
    slot: "veggie-1",
    name: "[QA] Bawang Merah Super",
    description: "Bawang merah grade A, kering sempurna. [QA fixture]",
    kategori: "fresh_vegetable", categoryKey: "fresh_vegetable",
    vendorKind: "external", stockStatus: "available",
    priceSell: 35000, currency: "IDR", unit: "Kg", moq: 50,
    origin: "Jawa Tengah, Indonesia", location: "Brebes, Jawa Tengah",
    hasImage: true,
  },
  {
    slot: "veggie-2",
    name: "[QA] Cabai Rawit Merah",
    description: "Cabai rawit merah, segar, tanpa pemutih. [QA fixture — tanpa foto & harga]",
    kategori: "fresh_vegetable", categoryKey: "fresh_vegetable",
    vendorKind: "external", stockStatus: "on_order",
    priceSell: null, currency: "IDR", unit: "Kg", moq: 30,
    origin: "Jawa Timur, Indonesia", location: "Kediri, Jawa Timur",
    hasImage: false,
  },
  // ── Pineapple ────────────────────────────────────────────────────────────────
  {
    slot: "pineapple-1",
    name: "[QA] Pineapple MD2 Fresh",
    description: "Nanas MD2 segar, manis, ready export. [QA fixture]",
    kategori: "pineapple", categoryKey: "pineapple",
    vendorKind: "external", stockStatus: "available",
    priceSell: 25000, currency: "IDR", unit: "Kg", moq: 100,
    origin: "Lampung, Indonesia", location: "Lampung Tengah, Lampung",
    hasImage: true,
  },
  {
    slot: "pineapple-2",
    name: "[QA] Pineapple Canned Slices",
    description: "Nanas kaleng irisan, ekspor grade. [QA fixture — limited, tanpa harga]",
    kategori: "pineapple", categoryKey: "pineapple",
    vendorKind: "internal", stockStatus: "limited",
    priceSell: null, currency: "IDR", unit: "Karton", moq: 20,
    origin: "Lampung, Indonesia", location: "Bandar Lampung, Lampung",
    hasImage: false,
  },
];

// ─── Triple production guard ──────────────────────────────────────────────────

function isProduction(): boolean {
  const appEnv  = process.env["APP_ENV"]  ?? "";
  const nodeEnv = process.env["NODE_ENV"] ?? "";
  // Check primary DB URLs for PROD project ref
  const dbUrls = [
    process.env["SUPABASE_DATABASE_URL"],
  ].filter(Boolean).join("|");
  return (
    appEnv  === "production" ||
    nodeEnv === "production" ||
    dbUrls.includes(PROD_REF)
  );
}

function prodGuardResponse(res: Response): boolean {
  if (isProduction()) {
    res.status(403).json({
      success: false,
      error: "QA Fixture Manager is disabled in Production",
      guard: {
        APP_ENV:  process.env["APP_ENV"]  ?? "(not set)",
        NODE_ENV: process.env["NODE_ENV"] ?? "(not set)",
        dbContainsProdRef: (
          process.env["SUPABASE_DATABASE_URL"] ?? ""
        ).includes(PROD_REF),
      },
    });
    return true;
  }
  return false;
}

// ─── Auth guard helper ────────────────────────────────────────────────────────

async function guardAuth(req: Request, res: Response): Promise<boolean> {
  if (prodGuardResponse(res)) return false;
  return requireRole(req, res, ALLOWED_ROLES);
}

// ─── Vendor resolver (no hardcoded IDs) ──────────────────────────────────────

interface VendorRow { id: number; name: string; is_internal_vendor: boolean | null; [key: string]: unknown }

async function resolveVendors(): Promise<{
  internalVendor: VendorRow | null;
  externalVendor: VendorRow | null;
}> {
  const [intRows, extRows] = await Promise.all([
    db.execute<VendorRow>(sql`
      SELECT id, name, is_internal_vendor
      FROM suppliers
      WHERE is_internal_vendor = true
      ORDER BY id
      LIMIT 1
    `),
    db.execute<VendorRow>(sql`
      SELECT id, name, is_internal_vendor
      FROM suppliers
      WHERE (is_internal_vendor = false OR is_internal_vendor IS NULL)
        AND status = 'approved'
      ORDER BY id
      LIMIT 1
    `),
  ]);

  const internalVendor = (intRows.rows[0] as VendorRow) ?? null;
  const externalVendor = (extRows.rows[0] as VendorRow) ?? null;
  return { internalVendor, externalVendor };
}

// ─── Dataset stats ────────────────────────────────────────────────────────────

async function getDatasetStats() {
  const rows = await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE is_active AND is_published)  AS active_published,
      COUNT(DISTINCT vendor_id)                           AS vendor_count,
      COUNT(DISTINCT COALESCE(category_key, kategori))    AS category_count,
      MAX(updated_at) AS last_updated
    FROM vendor_catalog_items
    WHERE fixture_source = ${QA_MARKER}
  `);
  return rows.rows[0] as {
    total: string;
    active_published: string;
    vendor_count: string;
    category_count: string;
    last_updated: string | null;
  };
}

// ─── GET /api/admin/marketplace/qa/status ─────────────────────────────────────

router.get("/status", async (req: Request, res: Response) => {
  if (!(await guardAuth(req, res))) return;

  try {
    const stats = await getDatasetStats();

    const dbUrl = process.env["SUPABASE_DATABASE_URL"] ?? "";
    const projectRefMatch = dbUrl.match(/db\.([a-z0-9]+)\.supabase\.co/)
      ?? dbUrl.match(/\/([a-z0-9]{20})\./);
    const projectRef = projectRefMatch?.[1] ?? "(unknown)";

    // last seed / reset from audit log
    const auditRows = await db.execute(sql`
      SELECT action, created_at
      FROM erp_audit_logs
      WHERE module = ${QA_MODULE}
        AND action IN ('LOAD_DATASET', 'RESET_DATASET')
      ORDER BY created_at DESC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    const auditArr = auditRows.rows as Array<{ action: string; created_at: string }>;
    const lastSeed  = auditArr.find((r) => r.action === "LOAD_DATASET")?.created_at  ?? null;
    const lastReset = auditArr.find((r) => r.action === "RESET_DATASET")?.created_at ?? null;

    res.json({
      success: true,
      environment: process.env["APP_ENV"]  ?? process.env["NODE_ENV"] ?? "development",
      nodeEnv:     process.env["NODE_ENV"] ?? "development",
      projectRef,
      isProduction: false, // can only reach here if guard passed
      qaDatasetVersion: QA_VERSION,
      totalQaProducts: Number(stats.total),
      totalQaVendors:  Number(stats.vendor_count),
      activePublished: Number(stats.active_published),
      categoryCount:   Number(stats.category_count),
      lastSeed,
      lastReset,
      fixtureCount: FIXTURES.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ─── POST /api/admin/marketplace/qa/load ─────────────────────────────────────

router.post("/load", async (req: Request, res: Response) => {
  if (!(await guardAuth(req, res))) return;

  try {
    const { internalVendor, externalVendor } = await resolveVendors();

    if (!internalVendor && !externalVendor) {
      res.status(422).json({
        success: false,
        error: "Tidak ada vendor di database. Pastikan supplier sudah ada sebelum load dataset.",
      });
      return;
    }

    // Use first available vendor as fallback if one kind is missing
    const intV = internalVendor ?? externalVendor!;
    const extV = externalVendor ?? internalVendor!;

    let inserted = 0, skipped = 0;

    await db.transaction(async (tx) => {
      for (const fix of FIXTURES) {
        const vendor = fix.vendorKind === "internal" ? intV : extV;
        const mediaJson = fix.hasImage
          ? mkMedia(fix.categoryKey)
          : "[]";

        const result = await tx.execute(sql`
          INSERT INTO vendor_catalog_items (
            vendor_id, vendor_name, name, description,
            kategori, category_key, template_kind,
            stock_status, is_active, is_published, is_featured,
            price_sell, currency, unit, moq,
            origin, location,
            media_assets, fixture_source,
            created_at, updated_at
          )
          SELECT
            ${vendor.id}::int,
            ${vendor.name},
            ${fix.name},
            ${fix.description},
            ${fix.kategori},
            ${fix.categoryKey},
            'product',
            ${fix.stockStatus},
            true, true, false,
            ${fix.priceSell !== null ? String(fix.priceSell) : null},
            ${fix.currency},
            ${fix.unit},
            ${String(fix.moq)},
            ${fix.origin},
            ${fix.location},
            ${mediaJson}::jsonb,
            ${QA_MARKER},
            NOW(), NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM vendor_catalog_items
            WHERE fixture_source = ${QA_MARKER}
              AND name = ${fix.name}
          )
        `);
        if ((result.rowCount ?? 0) > 0) {
          inserted++;
        } else {
          skipped++;
        }
      }
    });

    auditFromReq(req, {
      module: QA_MODULE,
      action: "LOAD_DATASET",
      newData: { version: QA_VERSION, inserted, skipped, total: FIXTURES.length },
    });

    res.json({
      success: true,
      message: skipped === FIXTURES.length
        ? "Dataset already loaded — tidak ada duplikasi."
        : `Dataset loaded: ${inserted} inserted, ${skipped} skipped.`,
      inserted,
      skipped,
      total: FIXTURES.length,
      alreadyLoaded: skipped === FIXTURES.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ─── POST /api/admin/marketplace/qa/reset ────────────────────────────────────

router.post("/reset", async (req: Request, res: Response) => {
  if (!(await guardAuth(req, res))) return;

  try {
    const { internalVendor, externalVendor } = await resolveVendors();
    if (!internalVendor && !externalVendor) {
      res.status(422).json({ success: false, error: "Tidak ada vendor di database." });
      return;
    }

    const intV = internalVendor ?? externalVendor!;
    const extV = externalVendor ?? internalVendor!;
    let updated = 0;

    await db.transaction(async (tx) => {
      for (const fix of FIXTURES) {
        const vendor   = fix.vendorKind === "internal" ? intV : extV;
        const mediaJson = fix.hasImage ? mkMedia(fix.categoryKey) : "[]";

        const result = await tx.execute(sql`
          UPDATE vendor_catalog_items SET
            vendor_id    = ${vendor.id}::int,
            vendor_name  = ${vendor.name},
            description  = ${fix.description},
            kategori     = ${fix.kategori},
            category_key = ${fix.categoryKey},
            stock_status = ${fix.stockStatus},
            is_active    = true,
            is_published = true,
            is_featured  = false,
            price_sell   = ${fix.priceSell !== null ? String(fix.priceSell) : null},
            currency     = ${fix.currency},
            unit         = ${fix.unit},
            moq          = ${String(fix.moq)},
            origin       = ${fix.origin},
            location     = ${fix.location},
            media_assets = ${mediaJson}::jsonb,
            updated_at   = NOW()
          WHERE fixture_source = ${QA_MARKER}
            AND name = ${fix.name}
        `);
        updated += result.rowCount ?? 0;
      }
    });

    auditFromReq(req, {
      module: QA_MODULE,
      action: "RESET_DATASET",
      newData: { version: QA_VERSION, updated },
    });

    res.json({
      success: true,
      message: `Dataset reset: ${updated} rows restored to initial state.`,
      updated,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ─── DELETE /api/admin/marketplace/qa/remove ─────────────────────────────────

router.delete("/remove", async (req: Request, res: Response) => {
  if (!(await guardAuth(req, res))) return;

  try {
    let removed = 0;

    await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        DELETE FROM vendor_catalog_items
        WHERE fixture_source = ${QA_MARKER}
      `);
      removed = result.rowCount ?? 0;
    });

    auditFromReq(req, {
      module: QA_MODULE,
      action: "REMOVE_DATASET",
      newData: { removed, marker: QA_MARKER },
    });

    res.json({
      success: true,
      message: `${removed} QA fixture items removed.`,
      removed,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ─── GET /api/admin/marketplace/qa/report ────────────────────────────────────

router.get("/report", async (req: Request, res: Response) => {
  if (!(await guardAuth(req, res))) return;

  try {
    const [summaryRows, catRows, dupRows, invalidRows] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*)                                                AS total_qa_products,
          COUNT(DISTINCT vendor_id)                             AS total_qa_vendors,
          COUNT(*) FILTER (WHERE media_assets IS NULL
            OR media_assets = '[]'::jsonb)                     AS products_without_image,
          COUNT(*) FILTER (WHERE price_sell IS NULL)           AS products_without_price,
          COUNT(*) FILTER (WHERE is_active AND is_published)   AS active_published,
          COUNT(*) FILTER (WHERE stock_status = 'available')   AS stock_available,
          COUNT(*) FILTER (WHERE stock_status = 'on_order')    AS stock_on_order,
          COUNT(*) FILTER (WHERE stock_status = 'limited')     AS stock_limited
        FROM vendor_catalog_items
        WHERE fixture_source = ${QA_MARKER}
      `),
      db.execute(sql`
        SELECT
          COALESCE(category_key, kategori) AS category,
          COUNT(*) AS count
        FROM vendor_catalog_items
        WHERE fixture_source = ${QA_MARKER}
        GROUP BY COALESCE(category_key, kategori)
        ORDER BY count DESC
      `),
      db.execute(sql`
        SELECT name, COUNT(*) AS cnt
        FROM vendor_catalog_items
        WHERE fixture_source = ${QA_MARKER}
        GROUP BY name
        HAVING COUNT(*) > 1
      `),
      db.execute(sql`
        SELECT id, name,
          CASE
            WHEN kategori IS NULL AND category_key IS NULL THEN 'missing_category'
            WHEN vendor_id IS NULL                         THEN 'missing_vendor'
            WHEN template_kind IS NULL                     THEN 'missing_template_kind'
          END AS issue
        FROM vendor_catalog_items
        WHERE fixture_source = ${QA_MARKER}
          AND (
            (kategori IS NULL AND category_key IS NULL)
            OR vendor_id IS NULL
            OR template_kind IS NULL
          )
      `),
    ]);

    auditFromReq(req, { module: QA_MODULE, action: "REPORT_DATASET" });

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      summary: summaryRows.rows[0],
      categories: catRows.rows,
      duplicateSku: dupRows.rows,
      invalidRecords: invalidRows.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ─── POST /api/admin/marketplace/qa/validate ─────────────────────────────────

router.post("/validate", async (req: Request, res: Response) => {
  if (!(await guardAuth(req, res))) return;

  try {
    const checks: Array<{ check: string; status: "PASS" | "FAIL" | "WARN"; detail: string }> = [];

    // 1. Has QA items
    const countRows = await db.execute(sql`
      SELECT COUNT(*) AS n FROM vendor_catalog_items WHERE fixture_source = ${QA_MARKER}
    `);
    const totalQa = Number((countRows.rows[0] as { n: string }).n);
    checks.push({
      check: "QA items exist",
      status: totalQa > 0 ? "PASS" : "FAIL",
      detail: `${totalQa} QA items found`,
    });

    // 2. Expected categories present
    const expectedCats = ["coffee", "coal", "palm_oil", "seafood", "cashew_nut", "fresh_vegetable", "pineapple"];
    const catRows = await db.execute(sql`
      SELECT DISTINCT COALESCE(category_key, kategori) AS cat
      FROM vendor_catalog_items
      WHERE fixture_source = ${QA_MARKER}
    `);
    const foundCats = (catRows.rows as Array<{ cat: string }>).map((r) => r.cat);
    const missingCats = expectedCats.filter((c) => !foundCats.includes(c));
    checks.push({
      check: "All categories present (7)",
      status: missingCats.length === 0 ? "PASS" : "FAIL",
      detail: missingCats.length === 0
        ? `All 7 categories found: ${expectedCats.join(", ")}`
        : `Missing: ${missingCats.join(", ")}`,
    });

    // 3. Both internal & external vendors represented
    const vendorRows = await db.execute(sql`
      SELECT s.is_internal_vendor, COUNT(*) AS n
      FROM vendor_catalog_items vci
      JOIN suppliers s ON s.id = vci.vendor_id
      WHERE vci.fixture_source = ${QA_MARKER}
      GROUP BY s.is_internal_vendor
    `);
    const vendorData = vendorRows.rows as Array<{ is_internal_vendor: boolean | null; n: string }>;
    const hasInternal = vendorData.some((r) => r.is_internal_vendor === true);
    const hasExternal = vendorData.some((r) => r.is_internal_vendor === false || r.is_internal_vendor === null);
    checks.push({
      check: "Internal vendor present",
      status: hasInternal ? "PASS" : "WARN",
      detail: hasInternal ? "Internal vendor items found" : "No internal vendor items found",
    });
    checks.push({
      check: "External vendor present",
      status: hasExternal ? "PASS" : "WARN",
      detail: hasExternal ? "External vendor items found" : "No external vendor items found",
    });

    // 4. Price coverage (mix of with/without price)
    const priceRows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE price_sell IS NOT NULL) AS with_price,
        COUNT(*) FILTER (WHERE price_sell IS NULL)     AS without_price
      FROM vendor_catalog_items WHERE fixture_source = ${QA_MARKER}
    `);
    const pr = priceRows.rows[0] as { with_price: string; without_price: string };
    checks.push({
      check: "Products with price",
      status: Number(pr.with_price) > 0 ? "PASS" : "FAIL",
      detail: `${pr.with_price} with price, ${pr.without_price} without price`,
    });

    // 5. Media coverage (mix of with/without image)
    const mediaRows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE media_assets IS NOT NULL AND media_assets != '[]'::jsonb) AS with_img,
        COUNT(*) FILTER (WHERE media_assets IS NULL OR media_assets = '[]'::jsonb)       AS without_img
      FROM vendor_catalog_items WHERE fixture_source = ${QA_MARKER}
    `);
    const mr = mediaRows.rows[0] as { with_img: string; without_img: string };
    checks.push({
      check: "Products with image",
      status: Number(mr.with_img) > 0 ? "PASS" : "FAIL",
      detail: `${mr.with_img} with image, ${mr.without_img} without image`,
    });

    // 6. Stock status coverage
    const stockRows = await db.execute(sql`
      SELECT stock_status, COUNT(*) AS n
      FROM vendor_catalog_items
      WHERE fixture_source = ${QA_MARKER}
      GROUP BY stock_status
    `);
    const stockData = stockRows.rows as Array<{ stock_status: string; n: string }>;
    const stockStatuses = stockData.map((r) => r.stock_status);
    const expectedStatuses = ["available", "on_order", "limited"];
    const missingStatuses = expectedStatuses.filter((s) => !stockStatuses.includes(s));
    checks.push({
      check: "All stock statuses present (available/on_order/limited)",
      status: missingStatuses.length === 0 ? "PASS" : "FAIL",
      detail: missingStatuses.length === 0
        ? `All stock statuses present: ${stockData.map((r) => `${r.stock_status}(${r.n})`).join(", ")}`
        : `Missing statuses: ${missingStatuses.join(", ")}`,
    });

    // 7. Province coverage
    const provinceRows = await db.execute(sql`
      SELECT COUNT(DISTINCT origin) AS n FROM vendor_catalog_items
      WHERE fixture_source = ${QA_MARKER} AND origin IS NOT NULL
    `);
    const provinceCount = Number((provinceRows.rows[0] as { n: string }).n);
    checks.push({
      check: "Province/origin coverage",
      status: provinceCount >= 3 ? "PASS" : "WARN",
      detail: `${provinceCount} distinct origins`,
    });

    // 8. Template kind set
    const templateRows = await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE template_kind IS NULL) AS missing
      FROM vendor_catalog_items WHERE fixture_source = ${QA_MARKER}
    `);
    const missingTemplate = Number((templateRows.rows[0] as { missing: string }).missing);
    checks.push({
      check: "Template kind set on all items",
      status: missingTemplate === 0 ? "PASS" : "FAIL",
      detail: missingTemplate === 0 ? "All items have template_kind" : `${missingTemplate} items missing template_kind`,
    });

    // 9. No duplicate names
    const dupRows = await db.execute(sql`
      SELECT COUNT(*) AS n
      FROM (
        SELECT name FROM vendor_catalog_items
        WHERE fixture_source = ${QA_MARKER}
        GROUP BY name HAVING COUNT(*) > 1
      ) t
    `);
    const dupCount = Number((dupRows.rows[0] as { n: string }).n);
    checks.push({
      check: "No duplicate item names",
      status: dupCount === 0 ? "PASS" : "FAIL",
      detail: dupCount === 0 ? "No duplicates found" : `${dupCount} duplicate names detected`,
    });

    const passed = checks.filter((c) => c.status === "PASS").length;
    const failed = checks.filter((c) => c.status === "FAIL").length;
    const warned = checks.filter((c) => c.status === "WARN").length;
    const overall = failed === 0 ? (warned > 0 ? "WARN" : "PASS") : "FAIL";

    auditFromReq(req, {
      module: QA_MODULE,
      action: "VALIDATE_DATASET",
      newData: { overall, passed, failed, warned },
    });

    res.json({
      success: true,
      overall,
      passed,
      failed,
      warned,
      checks,
      validatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
