/**
 * Marketplace vendor invoice endpoints.
 *
 * Vendor access is token-scoped to the Marketplace PO. The request body never
 * supplies the authoritative vendor, company, or PO identity.
 */
import { Router } from "express";
import { z } from "zod/v4";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  vendorInvoicesTable,
} from "@workspace/db";
import { imagePdfUpload, sanitizeFilename } from "../lib/uploadMiddleware.js";
import { validateMagicBytes } from "../lib/uploadValidation.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { validateBody } from "../lib/middleware/validateBody.js";
import { findPoByVendorToken } from "../lib/services/mktVendorPoTokenService.js";
import {
  createMarketplaceVendorInvoice,
  getMarketplaceVendorInvoice,
  safeMarketplaceVendorInvoiceView,
  submitMarketplaceVendorInvoice,
} from "../lib/services/mktVendorInvoiceService.js";
import { tokenGetRateLimiter, tokenPostRateLimiter } from "../middlewares/securityRateLimiter.js";
import { logger } from "../lib/logger.js";

const router = Router();
const upload = imagePdfUpload(20);
const storage = new ObjectStorageService();

const InvoiceLineSchema = z.object({
  poLineId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().finite().positive(),
  unitPrice: z.coerce.number().finite().nonnegative(),
  subtotal: z.coerce.number().finite().nonnegative(),
  taxAmount: z.coerce.number().finite().nonnegative().optional(),
  name: z.string().trim().max(500).optional(),
  unit: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();

const InvoiceBodySchema = z.object({
  grId: z.coerce.number().int().positive(),
  vendorInvoiceRef: z.string().trim().min(1).max(120),
  invoiceDate: z.coerce.date(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  totalAmount: z.coerce.number().finite().nonnegative(),
  taxAmount: z.coerce.number().finite().nonnegative(),
  grandTotal: z.coerce.number().finite().nonnegative(),
  notes: z.string().trim().max(4000).nullable().optional(),
  lines: z.string().min(2).transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value);
      const result = z.array(InvoiceLineSchema).min(1).max(500).safeParse(parsed);
      if (!result.success) {
        ctx.addIssue({ code: "custom", message: "Format lines invoice tidak valid" });
        return z.NEVER;
      }
      return result.data;
    } catch {
      ctx.addIssue({ code: "custom", message: "lines harus berupa JSON array" });
      return z.NEVER;
    }
  }),
}).strict();

function tokenStatus(code: string): number {
  if (code === "MALFORMED") return 400;
  if (code === "EXPIRED") return 410;
  return 404;
}

function failureStatus(code: string): number {
  if (["PO_NOT_FOUND", "GR_NOT_FOUND", "GR_NOT_FOR_PO"].includes(code)) return 404;
  if (["DUPLICATE_INVOICE", "INVALID_STATUS", "SHIPMENT_NOT_DELIVERED", "RECEIPT_NOT_ACCEPTED"].includes(code)) return 409;
  if (["NO_LINES", "INVALID_LINE", "INVALID_TOTAL", "INVALID_CURRENCY", "INVALID_DATE", "INVALID_REFERENCE"].includes(code)) return 422;
  return 400;
}

async function resolveVendorPo(token: string, res: any) {
  const result = await findPoByVendorToken(token);
  if (!result.ok) {
    res.status(tokenStatus(result.code)).json({ ok: false, error: "TOKEN_INVALID", code: result.code });
    return null;
  }
  return result.po;
}

// GET /api/mkt/vendor-invoice/:token/invoices — vendor's invoices for this PO
router.get("/:token/invoices", tokenGetRateLimiter, async (req, res) => {
  try {
    const po = await resolveVendorPo(String(req.params.token ?? ""), res);
    if (!po) return;
    const invoices = await db.select().from(vendorInvoicesTable)
      .where(and(
        eq(vendorInvoicesTable.mktPurchaseOrderId, po.id),
        eq(vendorInvoicesTable.supplierId, po.vendorId),
      ))
      .orderBy(asc(vendorInvoicesTable.id));
    const views = await Promise.all(invoices.map(async (invoice) => {
      const detail = await getMarketplaceVendorInvoice(invoice.id);
      return safeMarketplaceVendorInvoiceView(invoice, detail?.lines ?? []);
    }));
    return res.json({ ok: true, data: views });
  } catch (err) {
    logger.warn({ err }, "[mktVendorInvoice] list invoices error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// POST /api/mkt/vendor-invoice/:token — upload/create a draft invoice
router.post("/:token", tokenPostRateLimiter, upload.single("file"), async (req, res) => {
  let objectPath: string | null = null;
  try {
    const po = await resolveVendorPo(String(req.params.token ?? ""), res);
    if (!po) return;
    const parsed = InvoiceBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(422).json({ ok: false, error: "INVALID_BODY", details: parsed.error.flatten() });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "INVOICE_FILE_REQUIRED" });
    const magic = validateMagicBytes(file.buffer, file.mimetype);
    if (!magic.ok) {
      return res.status(400).json({ ok: false, error: "INVALID_FILE", message: magic.errorMessage });
    }

    objectPath = await storage.uploadPrivateEntity(file.buffer, file.mimetype);
    const result = await createMarketplaceVendorInvoice({
      poId: po.id,
      grId: parsed.data.grId,
      vendorInvoiceRef: parsed.data.vendorInvoiceRef,
      invoiceDate: parsed.data.invoiceDate,
      currency: parsed.data.currency,
      totalAmount: parsed.data.totalAmount,
      taxAmount: parsed.data.taxAmount,
      grandTotal: parsed.data.grandTotal,
      notes: parsed.data.notes,
      lines: parsed.data.lines,
      attachment: {
        objectPath,
        fileName: sanitizeFilename(file.originalname),
        contentType: file.mimetype,
        size: file.size,
      },
      supplierId: po.vendorId,
      supplierName: po.vendorNameSnapshot ?? `Vendor ${po.vendorId}`,
      companyId: po.companyId,
      createdBy: String(po.vendorId),
    }, {
      actorType: "vendor",
      actorId: String(po.vendorId),
      actorName: po.vendorNameSnapshot,
    });
    if (result.ok) {
      if (result.alreadyExists) {
        await storage.tryDeletePrivateEntity(objectPath);
        objectPath = null;
      }
      return res.status(result.alreadyExists ? 200 : 201).json({
        ok: true,
        alreadyExists: result.alreadyExists === true,
        data: safeMarketplaceVendorInvoiceView(result.invoice, result.lines),
      });
    } else {
      await storage.tryDeletePrivateEntity(objectPath);
      objectPath = null;
      return res.status(failureStatus(result.code)).json({ ok: false, error: result.code, message: result.message });
    }
  } catch (err) {
    if (objectPath) await storage.tryDeletePrivateEntity(objectPath);
    logger.warn({ err }, "[mktVendorInvoice] create invoice error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// GET/POST /api/mkt/vendor-invoice/:token/invoices/:invoiceId
router.get("/:token/invoices/:invoiceId", tokenGetRateLimiter, async (req, res) => {
  try {
    const po = await resolveVendorPo(String(req.params.token ?? ""), res);
    if (!po) return;
    const invoiceId = Number(req.params.invoiceId);
    const detail = Number.isInteger(invoiceId) ? await getMarketplaceVendorInvoice(invoiceId) : null;
    if (!detail || detail.invoice.mktPurchaseOrderId !== po.id || detail.invoice.supplierId !== po.vendorId) {
      return res.status(404).json({ ok: false, error: "INVOICE_NOT_FOUND" });
    }
    return res.json({ ok: true, data: safeMarketplaceVendorInvoiceView(detail.invoice, detail.lines) });
  } catch (err) {
    logger.warn({ err }, "[mktVendorInvoice] get invoice error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/:token/invoices/:invoiceId/submit", tokenPostRateLimiter, validateBody(z.object({}).strict()), async (req, res) => {
  try {
    const po = await resolveVendorPo(String(req.params.token ?? ""), res);
    if (!po) return;
    const invoiceId = Number(req.params.invoiceId);
    const detail = Number.isInteger(invoiceId) ? await getMarketplaceVendorInvoice(invoiceId) : null;
    if (!detail || detail.invoice.mktPurchaseOrderId !== po.id || detail.invoice.supplierId !== po.vendorId) {
      return res.status(404).json({ ok: false, error: "INVOICE_NOT_FOUND" });
    }
    const result = await submitMarketplaceVendorInvoice(invoiceId, {
      actorType: "vendor",
      actorId: String(po.vendorId),
      actorName: po.vendorNameSnapshot,
    });
    if (result.ok) {
      return res.json({
        ok: true,
        alreadySubmitted: result.alreadyExists === true,
        data: safeMarketplaceVendorInvoiceView(result.invoice, result.lines),
        match: result.match,
      });
    }
    return res.status(failureStatus(result.code)).json({ ok: false, error: result.code, message: result.message });
  } catch (err) {
    logger.warn({ err }, "[mktVendorInvoice] submit invoice error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;