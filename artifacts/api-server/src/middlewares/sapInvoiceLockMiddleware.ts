/**
 * SAP INVOICE LOCK MIDDLEWARE
 * ============================
 * Express middleware that enforces SAP-level invoice immutability rules
 * on incoming PUT/PATCH requests to vendor invoice endpoints.
 *
 * Rules enforced (per spec):
 *  1. STATUS LOCK    — POSTED / APPROVED / matched / paid → 403 INVOICE_LOCKED
 *  2. HEADER TAX     — If net + vat + gross present → tax_mode = HEADER_TAX_LOCKED
 *  3. ITEM TAX STRIP — item-level vat is forced to 0 (ignored)
 *  4. MISMATCH FLAG  — |gross - (net+vat)| > 100 → flag TAX_MISMATCH (no auto-fix)
 *  5. LOCK METADATA  — attach lock_meta to req.body for downstream audit
 *
 * Usage:
 *   router.put("/vendor-invoices/:id", sapInvoiceLockMiddleware, handler)
 *   — or —
 *   router.use("/vendor-invoices", sapInvoiceLockMiddleware)  // all mutating methods
 */

import type { Request, Response, NextFunction } from "express";
import { INVOICE_LOCK_STATUSES, SAP_TAX_TOLERANCE_IDR } from "../lib/sapInvoiceLockEngine.js";
import { logger } from "../lib/logger.js";

/** Statuses that map to the "APPROVED" / "POSTED" concept from the spec. */
const HARD_LOCK_STATUSES = new Set([
  ...INVOICE_LOCK_STATUSES,
  "POSTED",
  "APPROVED",
  "posted",
  "approved",
  "matched",
  "paid",
]);

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Middleware — enforces SAP invoice lock rules on the request body.
 * Requires `req.params.id` or `req.body.id` to identify the invoice.
 * Attaches `req.body.lock_meta` with validation metadata.
 */
export function sapInvoiceLockMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only apply to mutating methods
  if (!["PUT", "PATCH", "POST"].includes(req.method)) {
    next();
    return;
  }

  const invoice = req.body as Record<string, unknown>;

  // ── 1. STATUS LOCK ─────────────────────────────────────────────────────────
  const status = String(invoice.status ?? "").toLowerCase();
  if (HARD_LOCK_STATUSES.has(status)) {
    logger.warn({
      invoiceId: req.params.id ?? invoice.id,
      status: invoice.status,
      method: req.method,
      path: req.path,
    }, "[sap-invoice-lock-mw] BLOCKED — invoice status is locked");

    res.status(403).json({
      error: "INVOICE_LOCKED",
      message: "Invoice is immutable (SAP LOCK ACTIVE)",
      sap_lock: {
        status: "LOCKED",
        locked_status: invoice.status,
        rule: "STATUS_LOCK",
      },
    });
    return;
  }

  // ── 2. FORCE HEADER TAX MODE ────────────────────────────────────────────────
  const net   = toNum(invoice.net   ?? invoice.totalAmount   ?? invoice.total_amount);
  const vat   = toNum(invoice.vat   ?? invoice.taxAmount     ?? invoice.tax_amount);
  const gross = toNum(invoice.gross ?? invoice.grandTotal    ?? invoice.grand_total);

  if (net != null && vat != null && gross != null) {
    invoice.tax_mode = "HEADER_TAX_LOCKED";
  }

  // ── 3. STRIP ITEM-LEVEL TAX ─────────────────────────────────────────────────
  if (Array.isArray(invoice.items)) {
    invoice.items = (invoice.items as Record<string, unknown>[]).map((item) => ({
      ...item,
      vat: 0,
    }));
  }
  // Also handle "lines" (the ERP convention)
  if (Array.isArray(invoice.lines)) {
    invoice.lines = (invoice.lines as Record<string, unknown>[]).map((line) => ({
      ...line,
      vat: 0,
    }));
  }

  // ── 4. VALIDATION ENGINE (flag only — DO NOT auto-fix) ────────────────────
  const flags: string[] = Array.isArray(invoice.flags) ? [...(invoice.flags as string[])] : [];

  if (net != null && vat != null && gross != null) {
    const expectedGross = net + vat;
    const diff = Math.abs(expectedGross - gross);
    if (diff > SAP_TAX_TOLERANCE_IDR) {
      if (!flags.includes("TAX_MISMATCH")) {
        flags.push("TAX_MISMATCH");
      }
      logger.warn({
        invoiceId: req.params.id ?? invoice.id,
        net,
        vat,
        gross,
        expectedGross,
        diff,
      }, "[sap-invoice-lock-mw] TAX_MISMATCH flagged — not auto-fixed per SAP spec");
    }
    invoice.flags = flags;
  }

  // ── 5. ATTACH LOCK METADATA ─────────────────────────────────────────────────
  invoice.lock_meta = {
    locked: false,
    mode: "SAP_HEADER_LOCK",
    validated_at: new Date().toISOString(),
    flags,
    tax_mode: invoice.tax_mode ?? "NONE",
    middleware_version: "v1",
  };

  req.body = invoice;
  next();
}
