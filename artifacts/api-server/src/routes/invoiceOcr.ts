import { Router } from "express";
import { getOpenAI } from "../lib/openaiClient.js";
import { createRequire } from "node:module";
import { logger } from "../lib/logger.js";
import { requireClerkUser, requireClerkUserMiddleware } from "../lib/requireAdmin.js";
import { imagePdfUpload } from "../lib/uploadMiddleware.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runInvoiceTaxEngine, type InvoiceTaxInput } from "../lib/invoiceTaxEngine.js";
import { runSapTaxEngine, buildSapTaxInput, type SapTaxInput } from "../lib/sapTaxEngine.js";
import { ocrIpRateLimiter, ocrUserRateLimiter, ocrCompanyRateLimiter } from "../middlewares/securityRateLimiter.js";

const execFileAsync = promisify(execFile);

const require_ = createRequire(import.meta.url);
type PdfParseFn = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
const pdfParse = require_("pdf-parse/lib/pdf-parse.js") as PdfParseFn;

const router = Router();
const upload = imagePdfUpload(20);

const PDF_TEXT_MIN_CHARS = 200;
const PDF_TEXT_MAX_CHARS = 8000;

// Placeholder lines injected by some PDF generators for whitespace — strip entirely
const PLACEHOLDER_PATTERNS = [
  /^kosong\s+saja/i,
  /^mengisi\s+slot\s+untuk/i,
  /^spasi\s+saja/i,
  /^kosong\s+hanya/i,
  /^separator\s+only/i,
  /^dummy\s+line/i,
];

// Boilerplate section headers — cut everything from here onward
const BOILERPLATE_HEADERS = [
  "terms and conditions",
  "terms & conditions",
  "syarat dan ketentuan",
  "syarat & ketentuan",
  "general conditions",
  "conditions of contract",
  "ketentuan umum",
  "ketentuan dan kondisi",
  "limitation of liability",
  "disclaimer",
  "governing law",
  "arbitration clause",
];

function cleanPdfText(raw: string): string {
  const lines = raw.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Hard-stop at boilerplate sections
    const isBoilerplate = BOILERPLATE_HEADERS.some(
      (h) => lower === h || lower.startsWith(h + ":") || lower.startsWith(h + " ") || lower.startsWith(h + "."),
    );
    if (isBoilerplate) break;

    // Drop PDF placeholder filler lines
    const isPlaceholder = PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
    if (isPlaceholder) continue;

    // Drop pure divider lines (----, ====, ....)
    if (/^[-_.=*]{4,}\s*$/.test(trimmed)) continue;

    kept.push(line);
  }

  // Collapse 3+ consecutive blank lines into 2
  let text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.slice(0, PDF_TEXT_MAX_CHARS);
}

const INVOICE_EXTRACTION_PROMPT = `You are an AI Invoice Extraction Engine.

Extract structured data from the following document text (may come from OCR or PDF text extraction).
The document may be in Indonesian or English. Vendor formats vary.

RULES:
- Normalize all numbers to plain integers (no commas, no dots as thousands separators).
  Example: "53.792.335" → 53792335 | "5,330,772" → 5330772
- Normalize currency to "IDR" if Indonesian context and no currency stated.
- Dates must be ISO format (YYYY-MM-DD). "07 Juli 2025" → "2025-07-01".
  Indonesian months: Januari=01, Februari=02, Maret=03, April=04, Mei=05, Juni=06,
  Juli=07, Agustus=08, September=09, Oktober=10, November=11, Desember=12.
- If data is missing, use null — do not guess.
- If multiple totals exist, pick the final GRAND TOTAL / GROSS amount.
- Indonesian terms:
  "jumlah" = total | "total tagihan" = total_amount | "grand total" = total_amount
  "jatuh tempo" = due_date | "tanggal" = invoice_date | "nomor" = invoice_number
  "subtotal" / "DPP" / "NET" = subtotal | "PPN" / "VAT" = tax
  "diskon" = discount | "GROSS" = total_amount | "faktur" = invoice
  "kepada" = recipient / our company (not the vendor) | "dari" / "vendor" = vendor_name
  "terbilang" = amount in words — cross-check against numeric total
  "debitur" = debtor (our company) | "kreditur" / "penerbit" = issuing vendor
- For vendor_name: this is the ISSUING company (sender), NOT the recipient ("Kepada").
  Look for company name in the header/footer/letterhead, NOT under "Kepada".
- For line_items: if explicit rows are not available, create a single line from the description and total.
- payment_status_hint: "PAID" if marked lunas/paid, "UNPAID" if has due date without payment, "PARTIAL" if partial.
- raw_confidence: 0.0–1.0. High if text is clear. Low if messy/OCR noise.
- flags: array of strings noting anomalies, assumptions, or missing data.

CRITICAL — DPP vs PPN (very common mistake, do NOT make this error):
  DPP (Dasar Pengenaan Pajak) = the TAXABLE BASE = goes into "subtotal". This is usually the SMALLER number.
  PPN = the TAX AMOUNT calculated on DPP (typically 11% of DPP in Indonesia) = goes into "tax". This is always MUCH SMALLER than DPP.
  Example: DPP = 48.000.000 → subtotal=48000000 | PPN 11% = 5.280.000 → tax=5280000 | Total = 53.280.000 → total_amount=53280000
  RULE: tax must NEVER be larger than subtotal. If you see two numbers where one is labeled DPP and another is labeled PPN/Pajak, the DPP number → subtotal, the PPN number → tax.
  RULE: total_amount = subtotal + tax (approximately). If total_amount equals the largest number on the invoice, that is correct.
  RULE: If the invoice only shows a grand total with no explicit DPP/PPN breakdown, set subtotal=total_amount and tax=null.

OUTPUT FORMAT — strict JSON only, no markdown, no explanation:
{
  "vendor_name": string | null,
  "vendor_tax_id": string | null,
  "invoice_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "due_date": "YYYY-MM-DD" | null,
  "currency": "IDR" | "USD" | "OTHER" | null,
  "subtotal": number | null,
  "tax": number | null,
  "tax_type": "PPN" | "VAT" | "NONE" | null,
  "discount": number | null,
  "shipping_cost": number | null,
  "total_amount": number | null,
  "line_items": [
    {
      "description": string | null,
      "quantity": number | null,
      "unit_price": number | null,
      "total": number | null,
      "tax": number | null
    }
  ],
  "payment_status_hint": "PAID" | "UNPAID" | "PARTIAL" | null,
  "raw_confidence": number,
  "flags": [string]
}`;

/**
 * Sanity-check and auto-correct common AI extraction errors.
 * Most common mistake: AI sets tax ≈ subtotal (swaps DPP and PPN).
 */
function sanitizeOcrResult(data: Record<string, unknown>): Record<string, unknown> {
  const subtotal = typeof data.subtotal === "number" ? data.subtotal : null;
  const tax = typeof data.tax === "number" ? data.tax : null;
  const total = typeof data.total_amount === "number" ? data.total_amount : null;
  const flags: string[] = Array.isArray(data.flags) ? [...data.flags as string[]] : [];

  // Case 1: tax is unreasonably large (≥ 50% of subtotal or total).
  // This almost always means the AI swapped DPP (→ subtotal) with PPN (→ tax).
  // Correction: the "tax" value is actually the DPP (subtotal).
  //             Derive real PPN = total_amount - DPP, or null if ambiguous.
  if (tax !== null && subtotal !== null && tax >= subtotal * 0.5) {
    const realSubtotal = tax; // what AI called "tax" is actually the DPP
    const realTax = total !== null ? Math.round(total - realSubtotal) : null;
    logger.warn(
      { originalSubtotal: subtotal, originalTax: tax, correctedSubtotal: realSubtotal, correctedTax: realTax },
      "[invoiceOcr] DPP/PPN swap detected — auto-correcting",
    );
    flags.push("AUTO-CORRECTED: DPP/PPN swap detected. Tax was larger than expected; values were swapped.");
    return { ...data, subtotal: realSubtotal, tax: realTax, flags };
  }

  // Case 2: subtotal equals total_amount and tax is non-null.
  // Means AI set subtotal = grand total instead of the pre-tax base.
  // Correction: subtotal = total_amount - tax.
  if (subtotal !== null && total !== null && tax !== null && subtotal === total && tax > 0) {
    const realSubtotal = Math.round(total - tax);
    logger.warn(
      { total, tax, correctedSubtotal: realSubtotal },
      "[invoiceOcr] subtotal=total_amount with non-zero tax — correcting subtotal",
    );
    flags.push("AUTO-CORRECTED: Subtotal was equal to grand total; adjusted to total_amount − tax.");
    return { ...data, subtotal: realSubtotal, flags };
  }

  return { ...data, flags };
}

router.post(
  "/extract",
  ocrIpRateLimiter,             // pre-auth: gross abuse/bot guard only
  requireClerkUserMiddleware,   // auth runs before the per-user/company budgets below
  ocrUserRateLimiter,
  ocrCompanyRateLimiter,
  upload.single("file"),
  async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "File tidak dilampirkan" });
    return;
  }

  const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
  const isImage = file.mimetype.startsWith("image/");

  if (!isPdf && !isImage) {
    res.status(400).json({ error: "Hanya menerima file PDF atau gambar (JPG, PNG, WEBP)" });
    return;
  }

  const openai = getOpenAI();

  try {
    let extractedJson: unknown;

    if (isPdf) {
      let pdfText = "";
      let pdfParseOk = false;
      try {
        const parsed = await pdfParse(file.buffer);
        pdfText = parsed.text ?? "";
        pdfParseOk = true;
      } catch (e) {
        logger.warn({ err: e }, "[invoiceOcr] pdf-parse failed, falling back to vision");
      }

      const cleaned = pdfParseOk ? cleanPdfText(pdfText) : "";
      const useVision = cleaned.length < PDF_TEXT_MIN_CHARS;

      logger.info(
        { pdfParseOk, rawLen: pdfText.length, cleanedLen: cleaned.length, useVision },
        "[invoiceOcr] PDF analysis",
      );

      if (!useVision) {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 2000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: INVOICE_EXTRACTION_PROMPT },
            { role: "user", content: `Extract invoice data from this text and return as JSON only.\n\n${cleaned}` },
          ],
        });
        const raw = completion.choices[0]?.message?.content ?? "{}";
        extractedJson = JSON.parse(raw);
      } else {
        // PDF has no extractable text — render first page to PNG via pdftoppm, then use vision
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "inv-ocr-"));
        const pdfPath = path.join(tmpDir, "invoice.pdf");
        const pngPrefix = path.join(tmpDir, "page");
        try {
          await fs.writeFile(pdfPath, file.buffer);
          // pdftoppm renders page 1 as <pngPrefix>-1.png (PNG format, 150 DPI)
          await execFileAsync("pdftoppm", ["-f", "1", "-l", "1", "-r", "150", "-png", "-singlefile", pdfPath, pngPrefix]);
          const pngPath = `${pngPrefix}.png`;
          const pngBuffer = await fs.readFile(pngPath);
          const b64 = pngBuffer.toString("base64");
          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            max_tokens: 2000,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: INVOICE_EXTRACTION_PROMPT },
              {
                role: "user",
                content: [
                  { type: "text", text: "Extract invoice data from this scanned invoice image and return as JSON only." },
                  { type: "image_url", image_url: { url: `data:image/png;base64,${b64}`, detail: "high" } },
                ],
              },
            ],
          });
          const raw = completion.choices[0]?.message?.content ?? "{}";
          extractedJson = JSON.parse(raw);
        } finally {
          // Clean up temp files
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } else {
      // Image file — always use vision
      const b64 = file.buffer.toString("base64");
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INVOICE_EXTRACTION_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract invoice data from this invoice image and return as JSON only." },
              { type: "image_url", image_url: { url: `data:${file.mimetype};base64,${b64}`, detail: "high" } },
            ],
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      extractedJson = JSON.parse(raw);
    }

    const sanitized = sanitizeOcrResult(extractedJson as Record<string, unknown>);

    // ── Build tax engine input ──────────────────────────────────────────────
    // FIX 3: Detect Angkasa Pura / header-based tax pattern.
    // When the AI returned all three of subtotal(NET) + tax(VAT) + total_amount(GROSS)
    // at the header level, this is unambiguously a header-tax invoice.
    const ocrNet   = typeof sanitized.subtotal     === "number" ? sanitized.subtotal     : null;
    const ocrVat   = typeof sanitized.tax          === "number" ? sanitized.tax          : null;
    const ocrGross = typeof sanitized.total_amount === "number" ? sanitized.total_amount : null;
    const hasHeaderTax = ocrNet !== null && ocrVat !== null && ocrGross !== null;

    // FIX 1: Sum per-line VAT only when individual line_items have a tax field.
    // This is the fallback; header_vat always wins over the sum (inside the engine).
    const lineItems = Array.isArray(sanitized.line_items) ? sanitized.line_items as Record<string, unknown>[] : [];
    const itemVatSum = lineItems.reduce<number | null>((acc, item) => {
      const lineTax = typeof item.tax === "number" ? item.tax : null;
      if (lineTax === null) return acc;         // item has no tax — leave accumulator
      return (acc ?? 0) + lineTax;
    }, null);

    // Run the SAP-level tax engine on the extracted data
    const taxInput: InvoiceTaxInput = {
      net:            ocrNet,
      vat:            null,        // prefer header_vat / items_vat_sum over bare vat
      gross:          ocrGross,
      tax_rate_hint:  null,        // prompt already guides 11% PPN; let engine classify
      currency:       typeof sanitized.currency === "string" ? sanitized.currency : "IDR",
      vendor_country: null,        // OCR does not extract country; engine defaults to Indonesia
      header_vat:     ocrVat,      // FIX 1 — explicit header-level PPN field
      items_vat_sum:  itemVatSum,  // FIX 1 — sum of per-line tax (null if no lines had tax)
      has_header_tax: hasHeaderTax, // FIX 2/3 — force HEADER mode for this invoice type
    };
    const taxResult = runInvoiceTaxEngine(taxInput);
    logger.info({ taxResult }, "[invoiceOcr] tax engine result");

    // ── SAP Enterprise Tax Engine (strict header-only, spec-compliant output) ──
    const sapInput = buildSapTaxInput(sanitized);
    const sapTax = runSapTaxEngine(sapInput);
    logger.info({ sapTax }, "[invoiceOcr] SAP tax engine result");

    res.json({ ok: true, data: sanitized, tax: taxResult, sap_tax: sapTax });
  } catch (err) {
    logger.error({ err }, "[invoiceOcr] extraction error");
    res.status(500).json({ error: "Gagal mengekstrak invoice", detail: String(err) });
  }
});

// ── POST /api/invoice-ocr/tax-validate ────────────────────────────────────────
// Standalone tax validation endpoint — accepts raw invoice amounts and returns
// a fully reconciled SAP-style tax audit result without any file upload.
//
// Request body (application/json):
//   { net, vat, gross, tax_rate_hint, currency, vendor_country }
//
// Response: { ok: true, tax: InvoiceTaxResult }
router.post(
  "/tax-validate",
  ocrIpRateLimiter,             // pre-auth: gross abuse/bot guard only
  requireClerkUserMiddleware,   // auth runs before the per-user/company budgets below
  ocrUserRateLimiter,
  ocrCompanyRateLimiter,
  async (req, res): Promise<void> => {
  const body = req.body ?? {};

  /** Parse a field to a finite number, or null if absent/non-numeric. */
  function parseFinite(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const input: InvoiceTaxInput = {
    net:            parseFinite(body.net),
    vat:            parseFinite(body.vat),
    gross:          parseFinite(body.gross),
    tax_rate_hint:  parseFinite(body.tax_rate_hint),
    currency:       typeof body.currency       === "string" ? body.currency       : "IDR",
    vendor_country: typeof body.vendor_country === "string" ? body.vendor_country : null,
    // FIX 1/2/3/4 fields — optional; if omitted the engine falls back to `vat`
    header_vat:     parseFinite(body.header_vat),
    items_vat_sum:  parseFinite(body.items_vat_sum),
    has_header_tax: false, // resolved below after fields are parsed
  };

  // Resolve has_header_tax using already-parsed input fields (no double-parsing)
  input.has_header_tax = body.has_header_tax === true ||
    // Auto-detect Angkasa Pura pattern: caller supplied all three header amounts
    (input.net !== null && input.header_vat !== null && input.gross !== null);

  // Reject if any provided numeric field was non-finite (NaN / Infinity / string)
  const numericFields = ["net", "vat", "gross", "tax_rate_hint", "header_vat", "items_vat_sum"] as const;
  const nonFiniteFields: string[] = [];
  for (const field of numericFields) {
    if (body[field] != null && input[field] == null) {
      nonFiniteFields.push(field);
    }
  }
  if (nonFiniteFields.length) {
    res.status(400).json({
      error: "Nilai numerik tidak valid",
      fields: nonFiniteFields,
      detail: `Field berikut mengandung nilai non-numerik: ${nonFiniteFields.join(", ")}`,
    });
    return;
  }

  // Require at least one resolvable numeric field
  if (input.net == null && input.vat == null && input.gross == null) {
    res.status(400).json({ error: "Berikan minimal satu nilai: net, vat, atau gross" });
    return;
  }

  // Guard against negative values — flag, not reject
  const flags: string[] = [];
  if (input.net   != null && input.net   < 0) flags.push("NEGATIVE_NET: net is negative");
  if (input.vat   != null && input.vat   < 0) flags.push("NEGATIVE_VAT: vat is negative");
  if (input.gross != null && input.gross < 0) flags.push("NEGATIVE_GROSS: gross is negative");

  const result = runInvoiceTaxEngine(input);

  // Prepend any input-validation flags
  if (flags.length) {
    result.flags.unshift(...flags);
  }

  // ── SAP Enterprise Tax Engine (strict header-only, spec-compliant output) ──
  const sapInput: SapTaxInput = {
    vendor_name:    typeof body.vendor_name    === "string" ? body.vendor_name    : null,
    invoice_number: typeof body.invoice_number === "string" ? body.invoice_number : null,
    invoice_date:   typeof body.invoice_date   === "string" ? body.invoice_date   : null,
    currency:       typeof body.currency       === "string" ? body.currency       : null,
    net:            input.net,
    vat:            input.header_vat ?? input.vat,
    gross:          input.gross,
  };
  const sapTax = runSapTaxEngine(sapInput);

  logger.info({ input, result, sapTax }, "[invoiceOcr] /tax-validate called");

  res.json({ ok: true, tax: result, sap_tax: sapTax });
});

export { router as invoiceOcrRouter };
