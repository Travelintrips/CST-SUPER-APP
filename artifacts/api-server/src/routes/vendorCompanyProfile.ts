/**
 * Vendor Company Profile & Supplier Info routes
 * Mounts under /api/trading/suppliers (see index.ts)
 *
 * Endpoints:
 *   GET    /api/trading/suppliers/:id/company-profile
 *   PATCH  /api/trading/suppliers/:id/company-profile
 *   POST   /api/trading/suppliers/:id/company-profile/logo
 *   POST   /api/trading/suppliers/:id/company-profile/banner
 *   PATCH  /api/trading/suppliers/:id/info
 *   GET    /api/trading/suppliers/:id/completion
 *   GET    /api/trading/suppliers/document-types
 *   POST   /api/trading/suppliers/document-types
 *   POST   /api/trading/suppliers/catalog/:itemId/documents/upload
 */

import { Router } from "express";
import multer from "multer";
import { db, suppliersTable, vendorCatalogItemsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { uploadToSupabase } from "../lib/supabaseStorage.js";
import { requireClerkUser } from "../lib/requireAdmin.js";

export const vendorCompanyProfileRouter = Router();

// Auth guard — all routes require internal BizPortal session
vendorCompanyProfileRouter.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseId(raw: string) {
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

// ── GET /api/trading/suppliers/:id/company-profile ─────────────────────────────
vendorCompanyProfileRouter.get("/:id/company-profile", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });

  const [s] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!s) return res.status(404).json({ message: "Vendor tidak ditemukan" });

  return res.json({
    id: s.id,
    name: s.name,
    contactEmail: s.contactEmail ?? null,
    contactPerson: s.contactPerson ?? null,
    phone: s.phone ?? null,
    address: s.address ?? null,
    npwp: (s as any).npwp ?? null,
    nib: (s as any).nib ?? null,
    taxId: s.taxId ?? null,
    logoUrl: s.logoUrl ?? null,
    companyBanner: (s as any).companyBanner ?? null,
    descriptionPublic: s.descriptionPublic ?? null,
    vision: (s as any).vision ?? null,
    mission: (s as any).mission ?? null,
    establishedYear: (s as any).establishedYear ?? null,
    mainMarket: (s as any).mainMarket ?? null,
    factoryAddress: (s as any).factoryAddress ?? null,
    officeAddress: (s as any).officeAddress ?? null,
    warehouseAddress: (s as any).warehouseAddress ?? null,
    website: (s as any).website ?? null,
    socialMedia: (s as any).socialMedia ?? null,
    latitude: (s as any).latitude ?? null,
    longitude: (s as any).longitude ?? null,
    serviceType: s.serviceType ?? null,
  });
});

// ── PATCH /api/trading/suppliers/:id/company-profile ──────────────────────────
vendorCompanyProfileRouter.patch("/:id/company-profile", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });

  const ALLOWED = [
    "descriptionPublic", "vision", "mission", "establishedYear",
    "mainMarket", "factoryAddress", "officeAddress", "warehouseAddress",
    "website", "socialMedia", "latitude", "longitude",
  ];
  const patch: Record<string, unknown> = {};
  for (const f of ALLOWED) {
    if (req.body[f] !== undefined) patch[f] = req.body[f] ?? null;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ message: "Tidak ada field yang diupdate" });
  }

  await db.update(suppliersTable).set(patch as any).where(eq(suppliersTable.id, id));
  return res.json({ ok: true });
});

// ── PATCH /api/trading/suppliers/:id/info ─────────────────────────────────────
vendorCompanyProfileRouter.patch("/:id/info", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });

  const ALLOWED = ["contactEmail", "phone", "address", "npwp", "nib", "contactPerson"];
  const patch: Record<string, unknown> = {};
  for (const f of ALLOWED) {
    if (req.body[f] !== undefined) patch[f] = req.body[f] ?? null;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ message: "Tidak ada field yang diupdate" });
  }

  await db.update(suppliersTable).set(patch as any).where(eq(suppliersTable.id, id));
  return res.json({ ok: true });
});

// ── POST /api/trading/suppliers/:id/company-profile/logo ──────────────────────
vendorCompanyProfileRouter.post(
  "/:id/company-profile/logo",
  (req: any, res: any, next: any) =>
    upload.single("file")(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE")
        return res.status(413).json({ error: "Maks 10MB" });
      next(err);
    }),
  async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });

    const result = await uploadToSupabase(
      req.file.buffer,
      req.file.mimetype,
      "vendor/logos",
    ).catch(() => null);
    if (!result) return res.status(500).json({ error: "Upload gagal" });

    await db
      .update(suppliersTable)
      .set({ logoUrl: result.publicUrl } as any)
      .where(eq(suppliersTable.id, id));
    return res.json({ ok: true, logoUrl: result.publicUrl });
  },
);

// ── POST /api/trading/suppliers/:id/company-profile/banner ────────────────────
vendorCompanyProfileRouter.post(
  "/:id/company-profile/banner",
  (req: any, res: any, next: any) =>
    upload.single("file")(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE")
        return res.status(413).json({ error: "Maks 10MB" });
      next(err);
    }),
  async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid id" });
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });

    const result = await uploadToSupabase(
      req.file.buffer,
      req.file.mimetype,
      "vendor/banners",
    ).catch(() => null);
    if (!result) return res.status(500).json({ error: "Upload gagal" });

    await db
      .update(suppliersTable)
      .set({ companyBanner: result.publicUrl } as any)
      .where(eq(suppliersTable.id, id));
    return res.json({ ok: true, bannerUrl: result.publicUrl });
  },
);

// ── POST /api/trading/suppliers/catalog/:itemId/documents/upload ──────────────
vendorCompanyProfileRouter.post(
  "/catalog/:itemId/documents/upload",
  (req: any, res: any, next: any) =>
    upload.single("file")(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE")
        return res.status(413).json({ error: "Maks 10MB" });
      next(err);
    }),
  async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;
    if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });

    const ALLOWED_MIME = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    if (!ALLOWED_MIME.includes(req.file.mimetype)) {
      return res.status(400).json({
        error: "Format tidak didukung. Gunakan PDF, DOC, DOCX, XLS, XLSX, JPG, atau PNG.",
      });
    }

    const result = await uploadToSupabase(
      req.file.buffer,
      req.file.mimetype,
      "vendor/product-docs",
    ).catch(() => null);
    if (!result) return res.status(500).json({ error: "Upload gagal" });

    return res.json({
      ok: true,
      url: result.publicUrl,
      name: req.file.originalname,
      mimeType: req.file.mimetype,
    });
  },
);

// ── GET /api/trading/suppliers/document-types ─────────────────────────────────
const DEFAULT_DOC_TYPES = [
  { key: "coa",         label: "Certificate of Analysis (COA)", is_custom: false },
  { key: "coo",         label: "Certificate of Origin (COO)",   is_custom: false },
  { key: "phyto",       label: "Phytosanitary Certificate",      is_custom: false },
  { key: "health_cert", label: "Health Certificate",             is_custom: false },
  { key: "halal",       label: "Halal Certificate",              is_custom: false },
  { key: "invoice",     label: "Commercial Invoice",             is_custom: false },
  { key: "packing_list",label: "Packing List",                   is_custom: false },
  { key: "certificate", label: "Certificate",                    is_custom: false },
  { key: "msds",        label: "MSDS",                           is_custom: false },
  { key: "tds",         label: "Technical Data Sheet",           is_custom: false },
  { key: "catalogue",   label: "Product Catalogue",              is_custom: false },
  { key: "brochure",    label: "Brochure",                        is_custom: false },
  { key: "test_report", label: "Test Report",                    is_custom: false },
  { key: "other",       label: "Other",                          is_custom: false },
];

// Note: these two routes must be BEFORE /:id routes to avoid param shadowing
vendorCompanyProfileRouter.get("/document-types", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const rows = await db.execute(
      sql`SELECT id, key, label, is_custom FROM product_document_types ORDER BY is_custom, label`,
    );
    const data = (rows as any).rows ?? rows;
    return res.json(Array.isArray(data) && data.length > 0 ? data : DEFAULT_DOC_TYPES);
  } catch {
    return res.json(DEFAULT_DOC_TYPES);
  }
});

vendorCompanyProfileRouter.post("/document-types", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { key, label } = req.body ?? {};
  if (!key?.trim() || !label?.trim()) {
    return res.status(400).json({ message: "key dan label wajib diisi" });
  }
  try {
    await db.execute(
      sql`INSERT INTO product_document_types (key, label, is_custom) VALUES (${key.trim()}, ${label.trim()}, true) ON CONFLICT (key) DO NOTHING`,
    );
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: "Gagal menambah tipe dokumen" });
  }
});

// ── GET /api/trading/suppliers/:id/completion ─────────────────────────────────
vendorCompanyProfileRouter.get("/:id/completion", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid id" });

  const [supplier] = await db
    .select()
    .from(suppliersTable)
    .where(eq(suppliersTable.id, id));
  if (!supplier) return res.status(404).json({ message: "Vendor tidak ditemukan" });

  const s = supplier as any;

  // ── Company Profile score (weight 20%) ────────────────────────────────────
  const cpFields: Array<{ key: string; ok: boolean }> = [
    { key: "Logo",            ok: !!(s.logoUrl) },
    { key: "Company Banner",  ok: !!(s.companyBanner) },
    { key: "Deskripsi",       ok: !!(s.descriptionPublic?.trim()) },
    { key: "Vision",          ok: !!(s.vision?.trim()) },
    { key: "Mission",         ok: !!(s.mission?.trim()) },
    { key: "Tahun Berdiri",   ok: !!(s.establishedYear) },
    { key: "Pasar Utama",     ok: !!(s.mainMarket?.trim()) },
    { key: "Tipe Bisnis",     ok: !!(s.serviceType?.trim()) },
  ];
  const cpScore = cpFields.filter((f) => f.ok).length / cpFields.length;

  // ── Supplier Data score (weight 15%) ──────────────────────────────────────
  const sdFields: Array<{ key: string; ok: boolean }> = [
    { key: "Email",          ok: !!(s.contactEmail?.trim()) },
    { key: "Telepon",        ok: !!(s.phone?.trim()) },
    { key: "Alamat",         ok: !!(s.address?.trim()) },
    { key: "NPWP",           ok: !!(s.npwp?.trim()) },
    { key: "NIB",            ok: !!(s.nib?.trim()) },
    { key: "Contact Person", ok: !!(s.contactPerson?.trim()) },
  ];
  const sdScore = sdFields.filter((f) => f.ok).length / sdFields.length;

  // ── Per-product scores ────────────────────────────────────────────────────
  const items = await db
    .select()
    .from(vendorCatalogItemsTable)
    .where(eq(vendorCatalogItemsTable.vendorId, id));

  let galleryOk = 0, specOk = 0, docOk = 0, hsOk = 0, descOk = 0;
  const total = items.length;

  const productDetails = items.map((item) => {
    const assets = ((item.mediaAssets ?? []) as any[]);
    const docs = ((item.documents ?? []) as any[]);
    const specVals = item.specValues as Record<string, unknown> | null;

    const checks = {
      hasGallery: assets.filter((a) => a.mediaType === "image" || a.type === "image").length >= 1,
      hasSpec: specVals != null && Object.keys(specVals).length > 0,
      hasDescription: !!(item.description?.trim()),
      hasHsCode: !!((item as any).hsCode?.trim()),
      hasDocument: docs.some((d) => d.reference?.trim() || d.fileUrl?.trim()),
    };

    if (checks.hasGallery) galleryOk++;
    if (checks.hasSpec) specOk++;
    if (checks.hasDocument) docOk++;
    if (checks.hasHsCode) hsOk++;
    if (checks.hasDescription) descOk++;

    return {
      id: item.id,
      name: item.name,
      status: item.status,
      checks,
    };
  });

  const ratio = (n: number) => (total > 0 ? n / total : 0);
  const galleryScore = ratio(galleryOk);
  const specScore = ratio(specOk);
  const docScore = ratio(docOk);
  const hsScore = ratio(hsOk);
  const descScore = ratio(descOk);

  const overall = Math.round(
    cpScore * 20 +
      sdScore * 15 +
      galleryScore * 15 +
      specScore * 15 +
      docScore * 20 +
      hsScore * 5 +
      descScore * 10,
  );

  return res.json({
    supplierId: id,
    supplierName: supplier.name,
    overall,
    breakdown: {
      companyProfile:  { score: Math.round(cpScore * 100), weight: 20, fields: cpFields },
      supplierData:    { score: Math.round(sdScore * 100), weight: 15, fields: sdFields },
      gallery:         { score: Math.round(galleryScore * 100), weight: 15 },
      specification:   { score: Math.round(specScore * 100), weight: 15 },
      documents:       { score: Math.round(docScore * 100), weight: 20 },
      hsCode:          { score: Math.round(hsScore * 100), weight: 5 },
      description:     { score: Math.round(descScore * 100), weight: 10 },
    },
    products: productDetails,
  });
});
