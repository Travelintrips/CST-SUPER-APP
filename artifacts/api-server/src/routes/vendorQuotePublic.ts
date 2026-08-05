/**
 * vendorQuotePublic.ts — Phase 2D: Vendor Quote Submission Endpoints
 *
 * Public routes — no session required. Token-based auth only.
 * Mounted at: /api/vendor-quote
 *
 * Endpoints:
 *   GET  /:token                 — Load RFQ + existing quote data
 *   POST /:token/save            — Save draft (unlimited)
 *   POST /:token/submit          — Submit final quotation (once only)
 *   POST /:token/attachment      — Upload attachment (PDF/DOCX/XLSX/ZIP)
 *
 * Security:
 *   - Token validated on every request
 *   - Internal fields (commission, rank, buyer target price) never exposed
 *   - Submit is transactional + atomic (409 on double-submit)
 *   - No session cookie required — designed for external vendor access
 */

import { Router, type Request, type Response, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { documentUpload } from "../lib/uploadMiddleware.js";
import {
  loadQuoteByToken,
  markQuoteOpened,
  saveQuoteDraft,
  submitQuote,
  uploadQuoteAttachment,
  ALLOWED_CURRENCIES,
} from "../lib/services/vendorQuoteSubmissionService.js";
import type { QuoteLineInput, QuoteHeaderInput } from "../lib/services/vendorQuoteSubmissionService.js";
import { enqueueNotification } from "../lib/services/marketplaceNotificationQueueService.js";

const router = Router();

// 20 MB max untuk attachment vendor (PDF/DOCX/XLSX/ZIP)
const attachmentUpload = documentUpload(20);

// ── Rate limiters ─────────────────────────────────────────────────────────────

const quoteSaveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", message: "Terlalu banyak permintaan, coba lagi dalam 15 menit" },
  keyGenerator: (req) => `vq-save:${String((req.params as { token?: string }).token ?? "")}`,
});

const quoteSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", message: "Terlalu banyak percobaan submit, coba lagi dalam 15 menit" },
  keyGenerator: (req) => `vq-submit:${String((req.params as { token?: string }).token ?? "")}`,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map error code ke HTTP status */
function errorStatus(code: string): number {
  switch (code) {
    case "TOKEN_INVALID":      return 404;
    case "TOKEN_EXPIRED":      return 410;
    case "TOKEN_NOT_ACTIVE":   return 403;
    case "ALREADY_SUBMITTED":  return 409;
    case "VALIDATION_ERROR":   return 422;
    case "RFQ_LINE_MISMATCH":  return 422;
    case "DB_ERROR":           return 500;
    default:                   return 500;
  }
}

/**
 * Shared: load quote + validate token dari param.
 * Returns { quoteId, rfqId, vendorId, rfqLineIds } on success.
 * Sends error response and returns null on failure.
 */
async function resolveToken(
  req: Request,
  res: Response,
  allowSubmitted = false,
) {
  const rawToken = String(req.params["token"] ?? "").trim();
  const result = await loadQuoteByToken(rawToken);

  if (!result.ok) {
    res.status(errorStatus(result.code)).json({ ok: false, error: result.code, message: result.message });
    return null;
  }

  const { view } = result;
  const { quote, rfq, rfqLines } = view;

  // Cek apakah status masih aktif (kecuali GET yang boleh lihat submitted)
  if (!allowSubmitted && quote.status === "submitted") {
    res.status(409).json({
      ok: false,
      error: "ALREADY_SUBMITTED",
      message: "Quotation sudah disubmit — tidak dapat diedit",
      submittedAt: quote.submittedAt,
    });
    return null;
  }

  // Cek status tidak terminal (expired/rejected/withdrawn)
  const terminalStatuses = new Set(["expired", "rejected", "withdrawn"]);
  if (terminalStatuses.has(quote.status) && !allowSubmitted) {
    res.status(403).json({
      ok: false,
      error: "TOKEN_NOT_ACTIVE",
      message: `Undangan sudah tidak aktif (status: ${quote.status})`,
      currentStatus: quote.status,
    });
    return null;
  }

  return {
    rawToken,
    view,
    quoteId: quote.id,
    rfqId: rfq.id,
    vendorId: quote.vendorId,
    rfqLineIds: new Set(rfqLines.map((l) => l.id)),
    currentStatus: quote.status,
  };
}

// ── GET /:token — Load quote view ─────────────────────────────────────────────

router.get("/:token", async (req: Request, res: Response) => {
  const resolved = await resolveToken(req, res, /* allowSubmitted */ true);
  if (!resolved) return;

  const { view, quoteId, rfqId, vendorId, currentStatus } = resolved;

  // Mark sebagai opened jika baru pertama kali dibuka (hanya dari 'invited')
  if (currentStatus === "invited") {
    // Non-blocking — jangan await, jangan block response
    markQuoteOpened(quoteId, rfqId, vendorId).catch(() => {});
    // Update view status locally untuk response yang konsisten
    view.quote.status = "opened";
  }

  res.json({
    ok: true,
    data: {
      ...view,
      // Informasi tambahan untuk frontend
      meta: {
        allowedCurrencies: [...ALLOWED_CURRENCIES].sort(),
        canEdit: !["submitted", "expired", "rejected", "withdrawn"].includes(view.quote.status),
        canSubmit: !["submitted", "expired", "rejected", "withdrawn"].includes(view.quote.status),
      },
    },
  });
});

// ── POST /:token/save — Save draft ────────────────────────────────────────────

router.post("/:token/save", quoteSaveLimiter as unknown as RequestHandler, async (req: Request, res: Response) => {
  const resolved = await resolveToken(req, res, /* allowSubmitted */ false);
  if (!resolved) return;

  const { quoteId, rfqId, vendorId, rfqLineIds } = resolved;
  const body = req.body as Record<string, unknown>;

  // Parse input
  const header: QuoteHeaderInput = {
    quotationNumber:  body.quotationNumber as string ?? null,
    quotationDate:    body.quotationDate as string ?? null,
    paymentTerms:     body.paymentTerms as string ?? null,
    incoterm:         body.incoterm as string ?? null,
    deliveryLocation: body.deliveryLocation as string ?? null,
    notes:            body.notes as string ?? null,
  };

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: QuoteLineInput[] = rawLines.map((l: Record<string, unknown>) => ({
    rfqLineId:          Number(l.rfqLineId),
    offeredUnitPrice:   Number(l.offeredUnitPrice),
    offeredQty:         Number(l.offeredQty),
    currency:           String(l.currency ?? "").toUpperCase(),
    minimumOrderQty:    l.minimumOrderQty != null ? Number(l.minimumOrderQty) : undefined,
    validUntil:         String(l.validUntil ?? ""),
    leadTimeDays:       l.leadTimeDays != null ? Number(l.leadTimeDays) : undefined,
    stockStatus:        (l.stockStatus as QuoteLineInput["stockStatus"]) ?? undefined,
    notes:              l.notes as string ?? null,
    vendorCatalogItemId: l.vendorCatalogItemId != null ? Number(l.vendorCatalogItemId) : null,
  }));

  const result = await saveQuoteDraft(quoteId, rfqId, vendorId, rfqLineIds, { header, lines });

  if (!result.ok) {
    return res.status(errorStatus(result.code)).json({
      ok: false,
      error: result.code,
      message: result.message,
      ...(result.code === "VALIDATION_ERROR" ? { fields: result.fields } : {}),
    });
  }

  res.json({
    ok: true,
    message: `Draft disimpan — ${result.savedLines} line item`,
    savedLines: result.savedLines,
  });
});

// ── POST /:token/submit — Submit final ────────────────────────────────────────

router.post("/:token/submit", quoteSubmitLimiter as unknown as RequestHandler, async (req: Request, res: Response) => {
  const resolved = await resolveToken(req, res, /* allowSubmitted */ false);
  if (!resolved) return;

  const { quoteId, rfqId, vendorId, rfqLineIds } = resolved;
  const body = req.body as Record<string, unknown>;

  const header: QuoteHeaderInput = {
    quotationNumber:  body.quotationNumber as string ?? null,
    quotationDate:    body.quotationDate as string ?? null,
    paymentTerms:     body.paymentTerms as string ?? null,
    incoterm:         body.incoterm as string ?? null,
    deliveryLocation: body.deliveryLocation as string ?? null,
    notes:            body.notes as string ?? null,
  };

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: QuoteLineInput[] = rawLines.map((l: Record<string, unknown>) => ({
    rfqLineId:          Number(l.rfqLineId),
    offeredUnitPrice:   Number(l.offeredUnitPrice),
    offeredQty:         Number(l.offeredQty),
    currency:           String(l.currency ?? "").toUpperCase(),
    minimumOrderQty:    l.minimumOrderQty != null ? Number(l.minimumOrderQty) : undefined,
    validUntil:         String(l.validUntil ?? ""),
    leadTimeDays:       l.leadTimeDays != null ? Number(l.leadTimeDays) : undefined,
    stockStatus:        (l.stockStatus as QuoteLineInput["stockStatus"]) ?? undefined,
    notes:              l.notes as string ?? null,
    vendorCatalogItemId: l.vendorCatalogItemId != null ? Number(l.vendorCatalogItemId) : null,
  }));

  // Simpan status sebelum submit untuk deteksi requote resubmit
  const wasRequoteStatus = resolved.view.quote.status === "requote_requested";

  const result = await submitQuote(quoteId, rfqId, vendorId, rfqLineIds, { header, lines });

  if (!result.ok) {
    const payload: Record<string, unknown> = {
      ok: false,
      error: result.code,
      message: result.message,
    };
    if (result.code === "ALREADY_SUBMITTED") payload["submittedAt"] = result.submittedAt;
    if (result.code === "VALIDATION_ERROR")   payload["fields"] = result.fields;
    return res.status(errorStatus(result.code)).json(payload);
  }

  // Phase 2F — notifikasi ke buyer jika ini adalah requote resubmit — fire-and-forget
  if (wasRequoteStatus || result.wasRequote) {
    enqueueNotification({
      eventType:     "mkt_vendor_resubmitted",
      recipientType: "buyer",
      vendorQuoteId: quoteId,
      rfqId,
      payloadJson: {
        rfqNumber:   resolved.view.rfq.rfqNumber,
        vendorId,
        submittedAt: result.submittedAt.toISOString(),
      },
    }).catch(() => {});
  }

  res.status(200).json({
    ok: true,
    message: wasRequoteStatus
      ? "Revisi quotation berhasil disubmit"
      : "Quotation berhasil disubmit",
    submittedAt: result.submittedAt.toISOString(),
  });
});

// ── POST /:token/attachment — Upload attachment ───────────────────────────────

router.post(
  "/:token/attachment",
  quoteSaveLimiter as unknown as RequestHandler,
  attachmentUpload.single("file") as unknown as RequestHandler,
  async (req: Request, res: Response) => {
    const resolved = await resolveToken(req, res, /* allowSubmitted */ false);
    if (!resolved) return;

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "NO_FILE", message: "Tidak ada file yang diupload" });
    }

    const { quoteId, rfqId, vendorId } = resolved;

    const result = await uploadQuoteAttachment(
      quoteId,
      rfqId,
      vendorId,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname ?? "attachment",
    );

    if (!result.ok) {
      return res.status(errorStatus(result.code)).json({
        ok: false,
        error: result.code,
        message: result.message,
      });
    }

    res.json({
      ok: true,
      message: "Attachment berhasil diupload",
      attachmentUrl: result.attachmentUrl,
      filename: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  },
);

export { router as vendorQuotePublicRouter };
