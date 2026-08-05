import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  servicePackagesTable,
  servicePackageItemsTable,
  customerServiceRequestsTable,
  customerServiceRequestItemsTable,
} from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export const servicePackagesRouter = Router();

// ── Idempotent migration ──────────────────────────────────────────────────────
db.execute(sql`
  CREATE TABLE IF NOT EXISTS service_packages (
    id SERIAL PRIMARY KEY,
    package_code TEXT NOT NULL UNIQUE,
    package_name TEXT NOT NULL,
    package_type TEXT NOT NULL,
    trade_type TEXT NOT NULL,
    description TEXT,
    pricing_mode TEXT NOT NULL DEFAULT 'PER_ITEM',
    icon_emoji TEXT DEFAULT '📦',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )
`).then(() => db.execute(sql`
  CREATE TABLE IF NOT EXISTS service_package_items (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    service_category TEXT,
    item_title TEXT NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    sequence_no INTEGER NOT NULL DEFAULT 1,
    default_form_schema JSONB DEFAULT '{}',
    required_documents JSONB DEFAULT '[]',
    description TEXT
  )
`)).then(() => seedPackages()).catch((e) => logger.warn({ e }, "[servicePackages] migration warn"));

// ── Seed packages ─────────────────────────────────────────────────────────────
async function seedPackages() {
  const PACKAGES = [
    {
      code: "PKG001",
      name: "Export Air Door to Door",
      type: "air_export",
      tradeType: "EXPORT",
      desc: "Layanan lengkap ekspor via udara: pickup, kepabeanan, penerbangan, & handling",
      pricing: "PER_ITEM",
      emoji: "✈️",
      sort: 1,
      items: [
        { type: "trucking", title: "Trucking Pickup", required: true, seq: 1, docs: ["Surat Jalan"] },
        { type: "ppjk", title: "PPJK Export / Kepabeanan", required: true, seq: 2, docs: ["PEB", "Invoice", "Packing List"] },
        { type: "air_freight", title: "Air Freight", required: true, seq: 3, docs: ["AWB", "Invoice", "Packing List"] },
        { type: "handling", title: "Handling & Stuffing", required: false, seq: 4, docs: [] },
        { type: "insurance", title: "Asuransi Kargo", required: false, seq: 5, docs: ["Invoice"] },
      ],
    },
    {
      code: "PKG002",
      name: "Import Sea Door to Door",
      type: "sea_import",
      tradeType: "IMPORT",
      desc: "Layanan lengkap impor via laut: pengapalan, kepabeanan, & delivery",
      pricing: "PER_ITEM",
      emoji: "🚢",
      sort: 2,
      items: [
        { type: "ocean_freight", title: "Ocean Freight", required: true, seq: 1, docs: ["B/L", "Invoice", "Packing List"] },
        { type: "ppjk", title: "PPJK Import / Kepabeanan", required: true, seq: 2, docs: ["PIB", "Invoice", "Packing List"] },
        { type: "handling", title: "THC / DO Handling", required: true, seq: 3, docs: ["DO"] },
        { type: "trucking", title: "Trucking Delivery", required: true, seq: 4, docs: ["Surat Jalan"] },
        { type: "warehousing", title: "Warehousing (Opsional)", required: false, seq: 5, docs: ["Inbound Receipt"] },
        { type: "insurance", title: "Asuransi Kargo", required: false, seq: 6, docs: ["Invoice"] },
      ],
    },
    {
      code: "PKG003",
      name: "Customs Clearance Only",
      type: "customs",
      tradeType: "ANY",
      desc: "Pengurusan kepabeanan & clearance dokumen saja (tanpa jasa pengiriman)",
      pricing: "TOTAL_BORONGAN",
      emoji: "📋",
      sort: 3,
      items: [
        { type: "ppjk", title: "PPJK / Customs Clearance", required: true, seq: 1, docs: ["PIB/PEB", "Invoice", "Packing List", "Surat Kuasa"] },
        { type: "survey", title: "HS Code & Lartas Review", required: true, seq: 2, docs: [] },
        { type: "handling", title: "Koordinasi Inspeksi Bea Cukai", required: false, seq: 3, docs: [] },
      ],
    },
    {
      code: "PKG004",
      name: "Domestic Trucking",
      type: "domestic",
      tradeType: "DOMESTIC",
      desc: "Pengiriman darat domestik dengan POD — antar kota seluruh Indonesia",
      pricing: "TOTAL_BORONGAN",
      emoji: "🚛",
      sort: 4,
      items: [
        { type: "trucking", title: "Pickup", required: true, seq: 1, docs: ["Surat Jalan"] },
        { type: "trucking", title: "Delivery", required: true, seq: 2, docs: ["DO", "POD"] },
        { type: "handling", title: "Bongkar Muat", required: false, seq: 3, docs: [] },
        { type: "insurance", title: "Asuransi Kargo", required: false, seq: 4, docs: ["Invoice"] },
      ],
    },
    {
      code: "PKG005",
      name: "Multimodal Logistics",
      type: "multimodal",
      tradeType: "ANY",
      desc: "Solusi logistik gabungan: trucking + air/sea freight + kepabeanan + delivery",
      pricing: "HYBRID",
      emoji: "🔄",
      sort: 5,
      items: [
        { type: "trucking", title: "Trucking Pickup", required: true, seq: 1, docs: ["Surat Jalan"] },
        { type: "air_freight", title: "Air Freight (atau Ocean Freight)", required: true, seq: 2, docs: ["AWB/B/L", "Invoice"] },
        { type: "ppjk", title: "PPJK / Kepabeanan", required: true, seq: 3, docs: ["PIB/PEB", "Invoice"] },
        { type: "handling", title: "Handling", required: false, seq: 4, docs: [] },
        { type: "trucking", title: "Trucking Delivery", required: true, seq: 5, docs: ["DO"] },
        { type: "insurance", title: "Asuransi Kargo", required: false, seq: 6, docs: ["Invoice"] },
      ],
    },
  ];

  for (const pkg of PACKAGES) {
    const [existing] = await db
      .select({ id: servicePackagesTable.id })
      .from(servicePackagesTable)
      .where(eq(servicePackagesTable.packageCode, pkg.code))
      .limit(1);

    if (existing) continue;

    const [inserted] = await db
      .insert(servicePackagesTable)
      .values({
        packageCode: pkg.code,
        packageName: pkg.name,
        packageType: pkg.type,
        tradeType: pkg.tradeType,
        description: pkg.desc,
        pricingMode: pkg.pricing as "TOTAL_BORONGAN" | "PER_ITEM" | "HYBRID",
        iconEmoji: pkg.emoji,
        sortOrder: pkg.sort,
        isActive: true,
      })
      .returning();

    for (const item of pkg.items) {
      await db.insert(servicePackageItemsTable).values({
        packageId: inserted.id,
        itemType: item.type,
        serviceCategory: item.type,
        itemTitle: item.title,
        isRequired: item.required,
        sequenceNo: item.seq,
        requiredDocuments: item.docs,
        defaultFormSchema: {},
      });
    }
  }

  logger.info("[servicePackages] seed OK");
}

// ── GET /api/service-packages ─────────────────────────────────────────────────
servicePackagesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const tradeType = req.query.tradeType as string | undefined;

    const packages = await db
      .select()
      .from(servicePackagesTable)
      .where(eq(servicePackagesTable.isActive, true))
      .orderBy(asc(servicePackagesTable.sortOrder));

    const filtered = tradeType
      ? packages.filter(
          (p) => p.tradeType === tradeType.toUpperCase() || p.tradeType === "ANY"
        )
      : packages;

    return res.json(filtered);
  } catch (err) {
    logger.error({ err }, "[servicePackages] list error");
    return res.status(500).json({ error: "Gagal mengambil paket" });
  }
});

// ── GET /api/service-packages/:id ────────────────────────────────────────────
servicePackagesRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [pkg] = await db
      .select()
      .from(servicePackagesTable)
      .where(eq(servicePackagesTable.id, id))
      .limit(1);
    if (!pkg) return res.status(404).json({ error: "Paket tidak ditemukan" });

    const items = await db
      .select()
      .from(servicePackageItemsTable)
      .where(eq(servicePackageItemsTable.packageId, id))
      .orderBy(asc(servicePackageItemsTable.sequenceNo));

    return res.json({ ...pkg, items });
  } catch (err) {
    logger.error({ err }, "[servicePackages] get error");
    return res.status(500).json({ error: "Gagal mengambil paket" });
  }
});

// ── POST /api/service-packages/:packageId/apply/:requestId ───────────────────
// Apply a package to an existing draft CSR — auto-creates items
servicePackagesRouter.post("/:packageId/apply/:requestId", async (req: Request, res: Response) => {
  try {
    const packageId = Number(req.params.packageId);
    const requestId = Number(req.params.requestId);

    const [pkg] = await db
      .select()
      .from(servicePackagesTable)
      .where(and(eq(servicePackagesTable.id, packageId), eq(servicePackagesTable.isActive, true)))
      .limit(1);
    if (!pkg) return res.status(404).json({ error: "Paket tidak ditemukan" });

    const [request] = await db
      .select()
      .from(customerServiceRequestsTable)
      .where(eq(customerServiceRequestsTable.id, requestId))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request tidak ditemukan" });
    if (request.status !== "draft") {
      return res.status(400).json({ error: "Request sudah disubmit — tidak bisa menerapkan paket" });
    }

    const pkgItems = await db
      .select()
      .from(servicePackageItemsTable)
      .where(eq(servicePackageItemsTable.packageId, packageId))
      .orderBy(asc(servicePackageItemsTable.sequenceNo));

    // Get current max seq
    const seqResult = await db.execute(
      sql`SELECT COALESCE(MAX(sequence_no),0) as max_seq FROM customer_service_request_items WHERE request_id = ${requestId}`
    );
    let seqBase = Number((seqResult.rows[0] as Record<string, unknown>)?.max_seq ?? 0);

    const createdItems = [];
    for (const pkgItem of pkgItems) {
      seqBase++;
      const [item] = await db
        .insert(customerServiceRequestItemsTable)
        .values({
          requestId,
          itemType: pkgItem.itemType,
          serviceCategory: pkgItem.serviceCategory ?? pkgItem.itemType,
          sequenceNo: seqBase,
          title: pkgItem.itemTitle,
          description: pkgItem.description ?? null,
          formData: (pkgItem.defaultFormSchema ?? {}) as Record<string, unknown>,
          requiredDocuments: (pkgItem.requiredDocuments ?? []) as string[],
          isRequired: pkgItem.isRequired,
          status: "pending",
        })
        .returning();
      createdItems.push(item);
    }

    // Update CSR with package info & pricing mode
    await db
      .update(customerServiceRequestsTable)
      .set({
        orderMode: "PAKET_BORONGAN",
        packageId,
        packageNameSnapshot: pkg.packageName,
        pricingMode: pkg.pricingMode,
        updatedAt: new Date(),
      })
      .where(eq(customerServiceRequestsTable.id, requestId));

    logger.info({ requestId, packageId, itemCount: createdItems.length }, "[servicePackages] package applied");
    return res.json({ ok: true, items: createdItems, package: pkg });
  } catch (err) {
    logger.error({ err }, "[servicePackages] apply error");
    return res.status(500).json({ error: "Gagal menerapkan paket" });
  }
});
