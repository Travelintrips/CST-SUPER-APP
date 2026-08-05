/**
 * FASE 5 — Vendor Catalog Engine
 * Flow: Vendor Submit → Pending Review → Admin Approve → Published
 *
 * Public  : GET  /api/vendor-catalog-engine/form/:token
 *           POST /api/vendor-catalog-engine/submit/:token
 * Admin   : POST /api/trading/catalog-engine/links
 *           GET  /api/trading/catalog-engine/links
 *           GET  /api/trading/catalog-engine/submissions
 *           GET  /api/trading/catalog-engine/submissions/:id
 *           POST /api/trading/catalog-engine/submissions/:id/approve
 *           POST /api/trading/catalog-engine/submissions/:id/reject
 *           GET  /api/trading/catalog-engine/queue          ← pending_review catalog items
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  vendorCatalogSubmissionLinksTable,
  vendorCatalogSubmissionsTable,
  vendorCatalogItemsTable,
  suppliersTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import {
  resolveTemplate,
  resolveTemplateStrict,
  validateTemplatePayload,
  getUnknownFields,
  specValuesToFormValues,
} from "@workspace/product-templates";
import { resolveServiceTemplate, hasInCodeServiceTemplate } from "@workspace/service-templates";
import { dualTokenParams } from "../lib/tokenUtils.js";
import {
  sendProductApprovedNotification,
  sendProductRejectedNotification,
} from "../lib/services/vendorLifecycleService.js";

// ── Public router ─────────────────────────────────────────────────────────────
export const vendorCatalogEnginePublicRouter = Router();

/**
 * GET /api/vendor-catalog-engine/form/:token
 * Vendor opens this URL to see what the form is about before submitting.
 */
vendorCatalogEnginePublicRouter.get("/form/:token", async (req, res) => {
  const { token } = req.params;
  // P0 — hash-first lookup, fallback plaintext for legacy tokens
  const dv = dualTokenParams(token);
  const [link] = await db
    .select()
    .from(vendorCatalogSubmissionLinksTable)
    .where(sql`(token_hash = ${dv.hash} OR (token_hash IS NULL AND token = ${dv.raw}))`);

  if (!link) return res.status(404).json({ message: "Link tidak ditemukan atau sudah tidak aktif" });
  if (!link.isActive) return res.status(410).json({ message: "Link ini sudah dinonaktifkan" });
  if (link.expiresAt && link.expiresAt < new Date())
    return res.status(410).json({ message: "Link sudah kadaluarsa" });
  if (link.maxSubmissions != null && link.submissionCount >= link.maxSubmissions)
    return res.status(410).json({ message: "Batas maksimal submission sudah tercapai" });

  // Cek apakah vendor sudah submit sebelumnya
  const [existing] = await db
    .select({ id: vendorCatalogSubmissionsTable.id, status: vendorCatalogSubmissionsTable.status })
    .from(vendorCatalogSubmissionsTable)
    .where(
      and(
        eq(vendorCatalogSubmissionsTable.linkId, link.id),
        eq(vendorCatalogSubmissionsTable.supplierId, link.supplierId),
      )
    );

  return res.json({
    linkId:           link.id,
    vendorName:       link.vendorName,
    title:            link.title ?? "Form Submission Katalog",
    notes:            link.notes,
    categoryKey:      link.categoryKey,
    serviceType:      link.serviceType,
    templateKind:     link.templateKind,
    templateSnapshot: link.templateSnapshot,
    alreadySubmitted: !!existing,
    priorStatus:      existing?.status ?? null,
  });
});

/**
 * POST /api/vendor-catalog-engine/submit/:token
 * Vendor submits catalog data. Creates a vendor_catalog_submissions record
 * and a vendor_catalog_items entry in status = pending_review.
 */
vendorCatalogEnginePublicRouter.post("/submit/:token", async (req, res) => {
  const { token } = req.params;
  // P0 — hash-first lookup, fallback plaintext for legacy tokens
  const dv = dualTokenParams(token);
  const [link] = await db
    .select()
    .from(vendorCatalogSubmissionLinksTable)
    .where(sql`(token_hash = ${dv.hash} OR (token_hash IS NULL AND token = ${dv.raw}))`);

  if (!link) return res.status(404).json({ message: "Link tidak ditemukan" });
  if (!link.isActive) return res.status(410).json({ message: "Link ini sudah dinonaktifkan" });
  if (link.expiresAt && link.expiresAt < new Date())
    return res.status(410).json({ message: "Link sudah kadaluarsa" });
  if (link.maxSubmissions != null && link.submissionCount >= link.maxSubmissions)
    return res.status(410).json({ message: "Batas maksimal submission sudah tercapai" });

  const {
    name, description, unit,
    specValues, mediaAssets,
    priceBase, currency,
    stockStatus, stockQty, leadTime, validityDate,
    location, origin,
  } = req.body as {
    name?: string;
    description?: string;
    unit?: string;
    specValues?: Record<string, unknown>;
    mediaAssets?: Record<string, unknown>[];
    priceBase?: number;
    currency?: string;
    stockStatus?: string;
    stockQty?: number;
    leadTime?: string;
    validityDate?: string;
    location?: string;
    origin?: string;
  };

  if (!name?.trim()) return res.status(400).json({ message: "Nama item wajib diisi" });

  // Ambil nama vendor
  const [supplier] = await db
    .select({ name: suppliersTable.name })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, link.supplierId));

  // ── Phase 3: Server-side template resolution & spec validation ─────────────
  // Branch by templateKind: service items use service registry, product items
  // use product registry. Never cross resolvers. Fail-closed on both paths.
  const _isServiceSubmit = link.templateKind === "service";
  let _submTpl: ReturnType<typeof resolveTemplateStrict> | null = null;
  let _submSvcTpl: ReturnType<typeof resolveServiceTemplate> | null = null;

  if (_isServiceSubmit) {
    // Fail-closed guard: resolveServiceTemplate() always returns a value (fallback
    // to "document"), so !_submSvcTpl would never fire for unknown service types.
    // hasInCodeServiceTemplate() is the only reliable guard against unknown keys.
    const _svcKey = link.serviceType ?? null;
    if (!_svcKey || !hasInCodeServiceTemplate(_svcKey)) {
      return res.status(400).json({
        message: "Template layanan tidak ditemukan",
        code: "SERVICE_TEMPLATE_NOT_FOUND",
      });
    }
    _submSvcTpl = resolveServiceTemplate(_svcKey);
  } else {
    // Product: strict resolver — unknown categoryKey is rejected, no "general" fallback
    _submTpl = link.categoryKey ? resolveTemplateStrict(link.categoryKey) : null;
    if (link.categoryKey && !_submTpl && specValues != null) {
      return res.status(400).json({
        message: "Template produk tidak ditemukan",
        code: "TEMPLATE_NOT_FOUND",
      });
    }
    if (_submTpl && specValues) {
      const formValues = specValuesToFormValues(specValues as Record<string, unknown>);
      const unknown = getUnknownFields(_submTpl, formValues);
      if (unknown.length > 0) {
        console.warn("[catalog-engine/submit] unknown spec fields (ignored):", unknown);
      }
      const tplErrors = validateTemplatePayload(_submTpl, formValues);
      if (tplErrors.length > 0) {
        return res.status(400).json({
          message: "Spec values tidak valid menurut template produk",
          errors: tplErrors,
        });
      }
    }
  }
  // Snapshot selalu dari registry (server-authoritative), tidak pernah dari client
  const _submResolvedSnapshot = _submSvcTpl
    ? { ..._submSvcTpl }
    : _submTpl
      ? { ..._submTpl }
      : null;

  const submissionToken = randomUUID();
  const priceBaseStr    = String(parseFloat(String(priceBase ?? 0)) || 0);

  // 1. Buat submission record
  const [submission] = await db
    .insert(vendorCatalogSubmissionsTable)
    .values({
      linkId:           link.id,
      token:            submissionToken,
      supplierId:       link.supplierId,
      vendorName:       supplier?.name ?? link.vendorName ?? null,
      categoryKey:      link.categoryKey,
      serviceType:      link.serviceType,
      templateKind:     link.templateKind,
      templateId:       _submTpl ? _submTpl.category : (link.templateId ?? null),
      templateVersion:  (_submSvcTpl ?? _submTpl)?.version ?? (link.templateVersion ?? null),
      templateSnapshot: _submResolvedSnapshot ?? (link.templateSnapshot ?? null),
      specValues:       specValues ?? null,
      name:             name.trim(),
      description:      description?.trim() ?? null,
      unit:             unit?.trim() ?? null,
      mediaAssets:      mediaAssets ?? [],
      priceBase:        priceBaseStr,
      currency:         currency ?? "IDR",
      stockStatus:      stockStatus ?? null,
      stockQty:         stockQty != null ? String(parseFloat(String(stockQty))) : null,
      leadTime:         leadTime?.trim() ?? null,
      validityDate:     validityDate ?? null,
      location:         location?.trim() ?? null,
      origin:           origin?.trim() ?? null,
      status:           "submitted",
    })
    .returning();

  // 2. Buat atau update vendor_catalog_items dengan status pending_review
  // Cek dulu apakah sudah ada item yang berasal dari link ini
  const [existingItem] = await db
    .select({ id: vendorCatalogItemsTable.id })
    .from(vendorCatalogItemsTable)
    .where(
      and(
        eq(vendorCatalogItemsTable.vendorId, link.supplierId),
        eq(vendorCatalogItemsTable.sourceSubmissionId, submission.id),
      )
    );

  let catalogItemId: number;
  if (existingItem) {
    // Update existing item
    await db
      .update(vendorCatalogItemsTable)
      .set({
        name:             name.trim(),
        description:      description?.trim() ?? null,
        unit:             unit?.trim() ?? null,
        categoryKey:      link.categoryKey ?? null,
        serviceType:      link.serviceType ?? null,
        templateKind:     link.templateKind ?? null,
        templateSnapshot: _submResolvedSnapshot ?? (link.templateSnapshot ?? null),
        specValues:       specValues ?? null,
        mediaAssets:      mediaAssets ?? [],
        priceBase:        priceBaseStr,
        currency:         currency ?? "IDR",
        stockStatus:      stockStatus ?? null,
        stockQty:         stockQty != null ? String(parseFloat(String(stockQty))) : null,
        leadTime:         leadTime?.trim() ?? null,
        validityDate:     validityDate ?? null,
        location:         location?.trim() ?? null,
        origin:           origin?.trim() ?? null,
        status:           "pending_review",
        isPublished:      false,
        updatedAt:        new Date(),
      })
      .where(eq(vendorCatalogItemsTable.id, existingItem.id));
    catalogItemId = existingItem.id;
  } else {
    const [newItem] = await db
      .insert(vendorCatalogItemsTable)
      .values({
        vendorId:         link.supplierId,
        vendorName:       supplier?.name ?? link.vendorName ?? null,
        type:             link.templateKind === "product" ? "product" : "service",
        name:             name.trim(),
        description:      description?.trim() ?? null,
        unit:             unit?.trim() ?? null,
        categoryKey:      link.categoryKey ?? null,
        serviceType:      link.serviceType ?? null,
        templateKind:     link.templateKind ?? null,
        templateSnapshot: _submResolvedSnapshot ?? (link.templateSnapshot ?? null),
        specValues:       specValues ?? null,
        mediaAssets:      mediaAssets ?? [],
        priceBase:        priceBaseStr,
        currency:         currency ?? "IDR",
        stockStatus:      stockStatus ?? null,
        stockQty:         stockQty != null ? String(parseFloat(String(stockQty))) : null,
        leadTime:         leadTime?.trim() ?? null,
        validityDate:     validityDate ?? null,
        location:         location?.trim() ?? null,
        origin:           origin?.trim() ?? null,
        status:           "pending_review",
        isPublished:      false,
        isActive:         true,
        sourceSubmissionId: submission.id,
      })
      .returning();
    catalogItemId = newItem.id;
  }

  // 3. Update submission.catalogItemId + increment link counter
  await db
    .update(vendorCatalogSubmissionsTable)
    .set({ catalogItemId, updatedAt: new Date() })
    .where(eq(vendorCatalogSubmissionsTable.id, submission.id));

  await db
    .update(vendorCatalogSubmissionLinksTable)
    .set({ submissionCount: link.submissionCount + 1 })
    .where(eq(vendorCatalogSubmissionLinksTable.id, link.id));

  return res.status(201).json({
    submissionId:  submission.id,
    catalogItemId,
    status:        "pending_review",
    message:       "Submission berhasil, menunggu review admin",
  });
});

// ── Admin router ──────────────────────────────────────────────────────────────
export const vendorCatalogEngineAdminRouter = Router();

/**
 * POST /api/trading/catalog-engine/links
 * Admin membuat link submission untuk vendor tertentu.
 */
vendorCatalogEngineAdminRouter.post("/links", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const {
    supplierId, vendorName, title, notes,
    categoryKey, serviceType, templateKind,
    templateId, templateVersion, templateSnapshot,
    maxSubmissions, expiresAt,
  } = req.body as {
    supplierId: number;
    vendorName?: string;
    title?: string;
    notes?: string;
    categoryKey?: string;
    serviceType?: string;
    templateKind?: string;
    templateId?: string;
    templateVersion?: string;
    templateSnapshot?: Record<string, unknown>;
    maxSubmissions?: number;
    expiresAt?: string;
  };

  if (!supplierId) return res.status(400).json({ message: "supplierId wajib diisi" });

  const [supplier] = await db
    .select({ id: suppliersTable.id, name: suppliersTable.name })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, supplierId));
  if (!supplier) return res.status(404).json({ message: "Vendor tidak ditemukan" });

  const user = (req as any).session?.user;

  const [link] = await db
    .insert(vendorCatalogSubmissionLinksTable)
    .values({
      token:            randomUUID(),
      supplierId,
      vendorName:       vendorName ?? supplier.name,
      title:            title?.trim() ?? null,
      notes:            notes?.trim() ?? null,
      categoryKey:      categoryKey ?? null,
      serviceType:      serviceType ?? null,
      templateKind:     templateKind ?? null,
      templateId:       templateId ?? null,
      templateVersion:  templateVersion ?? null,
      templateSnapshot: templateSnapshot ?? null,
      maxSubmissions:   maxSubmissions ?? null,
      expiresAt:        expiresAt ? new Date(expiresAt) : null,
      isActive:         true,
      createdBy:        user?.email ?? user?.name ?? "admin",
    })
    .returning();

  return res.status(201).json({
    ...link,
    formUrl: `/api/vendor-catalog-engine/form/${link.token}`,
    submitUrl: `/api/vendor-catalog-engine/submit/${link.token}`,
  });
});

/**
 * GET /api/trading/catalog-engine/links
 * List semua submission links, opsional filter per vendor.
 */
vendorCatalogEngineAdminRouter.get("/links", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const { supplierId } = req.query as { supplierId?: string };
  const rows = await db
    .select({
      link:        vendorCatalogSubmissionLinksTable,
      vendorName:  suppliersTable.name,
    })
    .from(vendorCatalogSubmissionLinksTable)
    .innerJoin(suppliersTable, eq(vendorCatalogSubmissionLinksTable.supplierId, suppliersTable.id))
    .orderBy(desc(vendorCatalogSubmissionLinksTable.createdAt));

  let filtered = rows;
  if (supplierId) {
    const vid = Number(supplierId);
    if (!Number.isNaN(vid)) filtered = filtered.filter(r => r.link.supplierId === vid);
  }

  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  return res.json(filtered.map(({ link, vendorName }) => ({
    ...link,
    vendorName,
    formUrl: devDomain
      ? `https://${devDomain}/api/vendor-catalog-engine/form/${link.token}`
      : `/api/vendor-catalog-engine/form/${link.token}`,
  })));
});

/**
 * PATCH /api/trading/catalog-engine/links/:id/deactivate
 * Admin deactivates a link.
 */
vendorCatalogEngineAdminRouter.patch("/links/:id/deactivate", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const [updated] = await db
    .update(vendorCatalogSubmissionLinksTable)
    .set({ isActive: false })
    .where(eq(vendorCatalogSubmissionLinksTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ message: "Link tidak ditemukan" });
  return res.json({ message: "Link dinonaktifkan", id });
});

/**
 * GET /api/trading/catalog-engine/submissions
 * List semua submission, opsional filter status.
 */
vendorCatalogEngineAdminRouter.get("/submissions", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const { status, supplierId } = req.query as { status?: string; supplierId?: string };

  const rows = await db
    .select({
      sub:        vendorCatalogSubmissionsTable,
      vendorName: suppliersTable.name,
    })
    .from(vendorCatalogSubmissionsTable)
    .leftJoin(suppliersTable, eq(vendorCatalogSubmissionsTable.supplierId, suppliersTable.id))
    .orderBy(desc(vendorCatalogSubmissionsTable.submittedAt));

  let filtered = rows;
  if (status) filtered = filtered.filter(r => r.sub.status === status);
  if (supplierId) {
    const vid = Number(supplierId);
    if (!Number.isNaN(vid)) filtered = filtered.filter(r => r.sub.supplierId === vid);
  }

  return res.json(filtered.map(({ sub, vendorName }) => ({
    id:               sub.id,
    token:            sub.token,
    linkId:           sub.linkId,
    supplierId:       sub.supplierId,
    vendorName:       vendorName ?? sub.vendorName,
    name:             sub.name,
    description:      sub.description,
    categoryKey:      sub.categoryKey,
    serviceType:      sub.serviceType,
    templateKind:     sub.templateKind,
    specValues:       sub.specValues,
    mediaAssets:      sub.mediaAssets,
    priceBase:        Number(sub.priceBase ?? 0),
    currency:         sub.currency,
    stockStatus:      sub.stockStatus,
    stockQty:         sub.stockQty != null ? Number(sub.stockQty) : null,
    leadTime:         sub.leadTime,
    validityDate:     sub.validityDate,
    location:         sub.location,
    origin:           sub.origin,
    status:           sub.status,
    catalogItemId:    sub.catalogItemId,
    reviewedBy:       sub.reviewedBy,
    reviewedAt:       sub.reviewedAt?.toISOString() ?? null,
    reviewNotes:      sub.reviewNotes,
    submittedAt:      sub.submittedAt.toISOString(),
  })));
});

/**
 * GET /api/trading/catalog-engine/submissions/:id
 * Detail satu submission beserta templateSnapshot + specValues penuh.
 */
vendorCatalogEngineAdminRouter.get("/submissions/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const [row] = await db
    .select({
      sub:        vendorCatalogSubmissionsTable,
      vendorName: suppliersTable.name,
    })
    .from(vendorCatalogSubmissionsTable)
    .leftJoin(suppliersTable, eq(vendorCatalogSubmissionsTable.supplierId, suppliersTable.id))
    .where(eq(vendorCatalogSubmissionsTable.id, id));

  if (!row) return res.status(404).json({ message: "Submission tidak ditemukan" });

  const { sub, vendorName } = row;
  return res.json({
    id:               sub.id,
    token:            sub.token,
    linkId:           sub.linkId,
    supplierId:       sub.supplierId,
    vendorName:       vendorName ?? sub.vendorName,
    name:             sub.name,
    description:      sub.description,
    unit:             sub.unit,
    categoryKey:      sub.categoryKey,
    serviceType:      sub.serviceType,
    templateKind:     sub.templateKind,
    templateSnapshot: sub.templateSnapshot,
    specValues:       sub.specValues,
    mediaAssets:      sub.mediaAssets,
    priceBase:        Number(sub.priceBase ?? 0),
    currency:         sub.currency,
    stockStatus:      sub.stockStatus,
    stockQty:         sub.stockQty != null ? Number(sub.stockQty) : null,
    leadTime:         sub.leadTime,
    validityDate:     sub.validityDate,
    location:         sub.location,
    origin:           sub.origin,
    status:           sub.status,
    catalogItemId:    sub.catalogItemId,
    reviewedBy:       sub.reviewedBy,
    reviewedAt:       sub.reviewedAt?.toISOString() ?? null,
    reviewNotes:      sub.reviewNotes,
    submittedAt:      sub.submittedAt.toISOString(),
  });
});

/**
 * POST /api/trading/catalog-engine/submissions/:id/approve
 * Admin approves submission.
 * Copies: templateSnapshot, specValues, mediaAssets, price, stock, leadTime
 * → vendor_catalog_items.status = published
 */
vendorCatalogEngineAdminRouter.post("/submissions/:id/approve", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const [row] = await db
    .select()
    .from(vendorCatalogSubmissionsTable)
    .where(eq(vendorCatalogSubmissionsTable.id, id));
  if (!row) return res.status(404).json({ message: "Submission tidak ditemukan" });
  if (row.status !== "submitted")
    return res.status(409).json({ message: `Submission sudah berstatus '${row.status}'` });
  if (!row.catalogItemId)
    return res.status(409).json({ message: "Catalog item belum terbuat untuk submission ini" });

  const user = (req as any).session?.user;
  const reviewNotes = req.body.reviewNotes as string | undefined;

  // ── Fail-closed template guard before publishing ──────────────────────────
  // Branch by templateKind: service items use service registry, product items
  // use product registry. Never cross resolvers. Fail-closed on both paths.
  const _isServiceApproval = row.templateKind === "service";
  let _approveTpl: ReturnType<typeof resolveTemplateStrict> | null = null;
  let _approveSvcTpl: ReturnType<typeof resolveServiceTemplate> | null = null;

  if (_isServiceApproval) {
    // Fail-closed guard: resolveServiceTemplate() always returns a value (fallback
    // to "document"), so !_approveSvcTpl would never fire for unknown service types.
    // hasInCodeServiceTemplate() is the only reliable guard against unknown keys.
    const _svcKey = row.serviceType ?? null;
    if (!_svcKey || !hasInCodeServiceTemplate(_svcKey)) {
      return res.status(400).json({
        message: "Template layanan tidak ditemukan",
        code: "SERVICE_TEMPLATE_NOT_FOUND",
      });
    }
    _approveSvcTpl = resolveServiceTemplate(_svcKey);
  } else {
    // Product: strict resolver — unknown categoryKey rejected, no "general" fallback
    _approveTpl = row.categoryKey ? resolveTemplateStrict(row.categoryKey) : null;
    if (!_approveTpl && (row.categoryKey || row.specValues != null)) {
      return res.status(400).json({
        message: "Template produk tidak ditemukan",
        code: "TEMPLATE_NOT_FOUND",
      });
    }
  }
  // Snapshot selalu dari registry (server-authoritative), tidak pernah dari client
  const _approveResolvedSnapshot = _approveSvcTpl
    ? { ..._approveSvcTpl }
    : _approveTpl
      ? { ..._approveTpl }
      : null;

  // Copy semua submission data ke catalog item + publish
  const now = new Date();
  const [updatedItem] = await db
    .update(vendorCatalogItemsTable)
    .set({
      // Copy fields dari submission; override snapshot dengan server-resolved version
      templateSnapshot: _approveResolvedSnapshot ?? (row.templateSnapshot ?? undefined),
      specValues:       row.specValues ?? undefined,
      mediaAssets:      row.mediaAssets ?? [],
      priceBase:        row.priceBase,
      currency:         row.currency,
      stockStatus:      row.stockStatus ?? undefined,
      stockQty:         row.stockQty ?? undefined,
      leadTime:         row.leadTime ?? undefined,
      validityDate:     row.validityDate ?? undefined,
      location:         row.location ?? undefined,
      origin:           row.origin ?? undefined,
      // Publish
      status:           "published",
      isPublished:      true,
      isActive:         true,
      publishedAt:      now,
      updatedAt:        now,
    })
    .where(eq(vendorCatalogItemsTable.id, row.catalogItemId))
    .returning();

  if (!updatedItem) return res.status(404).json({ message: "Catalog item tidak ditemukan" });

  // Update submission status
  await db
    .update(vendorCatalogSubmissionsTable)
    .set({
      status:      "approved",
      reviewedBy:  user?.email ?? user?.name ?? "admin",
      reviewedAt:  now,
      reviewNotes: reviewNotes?.trim() ?? null,
      updatedAt:   now,
    })
    .where(eq(vendorCatalogSubmissionsTable.id, id));

  // Notify vendor via WA (non-blocking)
  void sendProductApprovedNotification(
    updatedItem.vendorId,
    updatedItem.name,
    updatedItem.id,
  );

  return res.json({
    message:       "Submission disetujui & item dipublish",
    catalogItemId: row.catalogItemId,
    status:        "published",
  });
});

/**
 * POST /api/trading/catalog-engine/submissions/:id/reject
 * Admin rejects submission → vendor_catalog_items kembali ke draft.
 */
vendorCatalogEngineAdminRouter.post("/submissions/:id/reject", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const [row] = await db
    .select()
    .from(vendorCatalogSubmissionsTable)
    .where(eq(vendorCatalogSubmissionsTable.id, id));
  if (!row) return res.status(404).json({ message: "Submission tidak ditemukan" });
  if (row.status !== "submitted")
    return res.status(409).json({ message: `Submission sudah berstatus '${row.status}'` });

  const user = (req as any).session?.user;
  const reviewNotes = req.body.reviewNotes as string | undefined;
  const now = new Date();

  // Set catalog item kembali ke draft
  if (row.catalogItemId) {
    await db
      .update(vendorCatalogItemsTable)
      .set({ status: "draft", isPublished: false, updatedAt: now })
      .where(eq(vendorCatalogItemsTable.id, row.catalogItemId));
  }

  // Update submission
  await db
    .update(vendorCatalogSubmissionsTable)
    .set({
      status:      "rejected",
      reviewedBy:  user?.email ?? user?.name ?? "admin",
      reviewedAt:  now,
      reviewNotes: reviewNotes?.trim() ?? null,
      updatedAt:   now,
    })
    .where(eq(vendorCatalogSubmissionsTable.id, id));

  // Notify vendor via WA (non-blocking)
  if (row.catalogItemId) {
    const [rejectedItem] = await db
      .select({ vendorId: vendorCatalogItemsTable.vendorId, name: vendorCatalogItemsTable.name })
      .from(vendorCatalogItemsTable)
      .where(eq(vendorCatalogItemsTable.id, row.catalogItemId));
    if (rejectedItem) {
      void sendProductRejectedNotification(
        rejectedItem.vendorId,
        rejectedItem.name,
        row.catalogItemId,
        reviewNotes?.trim() ?? null,
      );
    }
  }

  return res.json({
    message:       "Submission ditolak, item dikembalikan ke draft",
    catalogItemId: row.catalogItemId,
    status:        "rejected",
  });
});

/**
 * GET /api/trading/catalog-engine/queue
 * Shortcut: vendor_catalog_items dengan status = pending_review (review queue).
 */
vendorCatalogEngineAdminRouter.get("/queue", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const rows = await db
    .select({
      id:          vendorCatalogItemsTable.id,
      vendorId:    vendorCatalogItemsTable.vendorId,
      vendorName:  suppliersTable.name,
      name:        vendorCatalogItemsTable.name,
      categoryKey: vendorCatalogItemsTable.categoryKey,
      serviceType: vendorCatalogItemsTable.serviceType,
      templateKind:vendorCatalogItemsTable.templateKind,
      specValues:  vendorCatalogItemsTable.specValues,
      mediaAssets: vendorCatalogItemsTable.mediaAssets,
      priceBase:   vendorCatalogItemsTable.priceBase,
      currency:    vendorCatalogItemsTable.currency,
      stockStatus: vendorCatalogItemsTable.stockStatus,
      stockQty:    vendorCatalogItemsTable.stockQty,
      leadTime:    vendorCatalogItemsTable.leadTime,
      status:      vendorCatalogItemsTable.status,
      sourceSubmissionId: vendorCatalogItemsTable.sourceSubmissionId,
      createdAt:   vendorCatalogItemsTable.createdAt,
      updatedAt:   vendorCatalogItemsTable.updatedAt,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(eq(vendorCatalogItemsTable.status, "pending_review"))
    .orderBy(desc(vendorCatalogItemsTable.updatedAt));

  return res.json(rows.map(r => ({
    ...r,
    priceBase: Number(r.priceBase ?? 0),
    stockQty:  r.stockQty != null ? Number(r.stockQty) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  })));
});

/**
 * GET /api/trading/catalog-engine/stats
 * Summary stats untuk dashboard.
 */
vendorCatalogEngineAdminRouter.get("/stats", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const [allSubmissions, allItems] = await Promise.all([
    db.select({ status: vendorCatalogSubmissionsTable.status })
      .from(vendorCatalogSubmissionsTable),
    db.select({ status: vendorCatalogItemsTable.status })
      .from(vendorCatalogItemsTable),
  ]);

  const subCount  = { submitted: 0, approved: 0, rejected: 0 };
  for (const s of allSubmissions) {
    const k = s.status as keyof typeof subCount;
    if (k in subCount) subCount[k]++;
  }

  const itemCount = { draft: 0, pending_review: 0, published: 0, archived: 0 };
  for (const s of allItems) {
    const k = s.status as keyof typeof itemCount;
    if (k in itemCount) itemCount[k]++;
  }

  return res.json({ submissions: subCount, items: itemCount });
});
