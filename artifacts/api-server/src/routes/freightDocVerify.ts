/**
 * POST /api/freight/cross-doc-verify
 *
 * Cross-document verification untuk forwarding & logistik.
 * Upload hingga 5 dokumen (MAWB, BL, Invoice, Packing List, Customs),
 * AI mengekstrak data dari masing-masing lalu membandingkan cross-document
 * untuk mendeteksi ketidaksesuaian berat, jumlah, shipper, consignee, HS Code, dll.
 */

import { Router } from "express";
import { getOpenAI } from "../lib/openaiClient.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { imagePdfUpload } from "../lib/uploadMiddleware.js";
import { logger } from "../lib/logger.js";
import { createRequire } from "node:module";
import { createTwoTierRateLimiter, extractRateLimitKey } from "../lib/userRateLimiter.js";

const require_ = createRequire(import.meta.url);
type PdfParseFn = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
const pdfParse = require_("pdf-parse/lib/pdf-parse.js") as PdfParseFn;

export const freightDocVerifyRouter = Router();
const upload = imagePdfUpload(20);

const verifyLimiter = createTwoTierRateLimiter(
  { windowMs: 60_000, limit: 10 },
  { windowMs: 60 * 60_000, limit: 50 },
);

// ── Boot migration ────────────────────────────────────────────────────────────
export async function runFreightDocVerifyMigration() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS freight_doc_verifications (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by TEXT,
        company_id INTEGER,
        shipment_ref TEXT,
        doc_labels TEXT[],
        doc_data JSONB,
        discrepancies JSONB,
        verdict TEXT CHECK (verdict IN ('ok', 'warning', 'critical')),
        ai_summary TEXT,
        checked_fields JSONB
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_freight_doc_verify_company ON freight_doc_verifications(company_id)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_freight_doc_verify_created ON freight_doc_verifications(created_at DESC)
    `).catch(() => {});
    logger.info("Freight doc verify migration: table ready");
  } catch (err) {
    logger.warn({ err }, "Freight doc verify migration: non-fatal error");
  }
}

// ── Doc types ─────────────────────────────────────────────────────────────────
const VALID_DOC_LABELS = [
  "MAWB", "HAWB", "BL", "Sea Waybill", "Invoice", "Packing List",
  "PIB", "PEB", "SPPB", "NPE", "Delivery Order", "Other",
] as const;

type DocLabel = typeof VALID_DOC_LABELS[number];

// ── PDF fast path (same as scanDocument) ─────────────────────────────────────
const PDF_MIN_CHARS = 200;
const PDF_MAX_CHARS = 5000;
const BOILERPLATE = [
  "terms and conditions", "terms & conditions", "conditions of carriage",
  "conditions of contract", "general conditions", "syarat dan ketentuan",
  "syarat & ketentuan", "ketentuan umum", "limitation of liability",
  "disclaimer", "important notice", "governing law",
];

function cleanPdfText(raw: string): string {
  let text = raw.replace(/\n{3,}/g, "\n\n").replace(/^[-_.=*]{5,}\s*$/gm, "").trim();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].trim().toLowerCase();
    if (BOILERPLATE.some(h => lower === h || lower.startsWith(h + " ") || lower.startsWith(h + ":"))) {
      text = lines.slice(0, i).join("\n").trim();
      break;
    }
  }
  return text.slice(0, PDF_MAX_CHARS);
}

// ── Single-doc extraction prompt ──────────────────────────────────────────────
const EXTRACT_SYSTEM = `You are a logistics document data extraction assistant.
Extract structured data from the document and return ONLY valid JSON (no markdown, no explanation).

Return this JSON structure:
{
  "docType": string,
  "awbNumber": string | null,
  "blNumber": string | null,
  "shipperName": string | null,
  "consigneeName": string | null,
  "origin": string | null,
  "destination": string | null,
  "vessel": string | null,
  "voyage": string | null,
  "containerNo": string | null,
  "commodity": string | null,
  "hsCode": string | null,
  "grossWeight": number | null,
  "netWeight": number | null,
  "pieces": number | null,
  "cbm": number | null,
  "packingType": string | null,
  "invoiceValue": number | null,
  "currency": string | null,
  "invoiceDate": string | null,
  "country": string | null
}

Rules:
- Weights as plain numbers in kg
- CBM as plain number
- Invoice value as plain number (no currency symbol)
- Dates as YYYY-MM-DD
- AWB number format: "XXX-XXXXXXXX"
- For sea freight: awbNumber = null, blNumber = B/L number
- For air freight: awbNumber = AWB number, blNumber = null
- Extract ALL container numbers comma-separated
- If field not found, return null`;

async function extractOneDoc(
  fileBuffer: Buffer,
  mimeType: string,
  docLabel: string,
): Promise<Record<string, unknown>> {
  const openai = getOpenAI();
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  let content: Parameters<typeof openai.chat.completions.create>[0]["messages"][1]["content"];
  let model: string;

  if (isPdf) {
    let pdfText = "";
    try {
      const parsed = await pdfParse(fileBuffer);
      pdfText = (parsed.text ?? "").trim();
    } catch {}

    if (pdfText.length >= PDF_MIN_CHARS) {
      model = "gpt-5-mini";
      content = `Extract all data from this ${docLabel} document.\n\n${cleanPdfText(pdfText)}`;
    } else {
      model = "gpt-5.1";
      content = [
        { type: "text" as const, text: `Extract all data from this ${docLabel} document.` },
        { type: "image_url" as const, image_url: { url: `data:application/pdf;base64,${fileBuffer.toString("base64")}` } },
      ];
    }
  } else if (isImage) {
    model = "gpt-5.1";
    content = [
      { type: "text" as const, text: `Extract all data from this ${docLabel} document image.` },
      { type: "image_url" as const, image_url: { url: `data:${mimeType};base64,${fileBuffer.toString("base64")}` } },
    ];
  } else {
    throw new Error(`Unsupported MIME type: ${mimeType}`);
  }

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 2000,
    messages: [
      { role: "system", content: EXTRACT_SYSTEM },
      { role: "user", content },
    ],
  });

  const raw = (response.choices[0]?.message?.content ?? "{}").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw, parseError: true };
  }
}

// ── Cross-document comparison prompt ──────────────────────────────────────────
const COMPARE_SYSTEM = `You are a logistics compliance auditor. Given extracted data from multiple shipping documents, identify discrepancies.

Compare the following fields across all documents:
- grossWeight (tolerance: ±0.5 kg is OK, >0.5 kg is WARNING, >5 kg is CRITICAL)
- netWeight (same tolerance as grossWeight)
- pieces / quantity (exact match required — any difference is CRITICAL)
- cbm / volume (tolerance: ±0.1 CBM is OK)
- shipperName (fuzzy match — minor abbreviation/spacing differences are OK, clearly different names are CRITICAL)
- consigneeName (same as shipperName)
- hsCode (exact match required — any difference is CRITICAL)
- commodity (semantic match — same goods described differently is OK, clearly different goods is CRITICAL)
- awbNumber / blNumber (exact match where present — difference is CRITICAL)
- containerNo (exact match — difference is CRITICAL)
- origin / destination (fuzzy match — port code vs city name is OK, different locations is CRITICAL)
- invoiceValue + currency (cross-check declared customs value vs invoice)

Return ONLY valid JSON:
{
  "verdict": "ok" | "warning" | "critical",
  "summary": string,
  "discrepancies": [
    {
      "field": string,
      "severity": "ok" | "warning" | "critical",
      "description": string,
      "values": { [docLabel: string]: string | number | null }
    }
  ]
}

- "ok" verdict: no discrepancies or only minor formatting differences
- "warning" verdict: minor discrepancies that need attention but not necessarily errors
- "critical" verdict: clear mismatches that indicate errors, fraud risk, or compliance issues

If only one document is provided, return ok verdict with a note that cross-checking requires multiple documents.
Write the summary in Indonesian.`;

async function compareDocuments(
  docs: Array<{ label: string; data: Record<string, unknown> }>,
): Promise<{ verdict: string; summary: string; discrepancies: unknown[] }> {
  const openai = getOpenAI();
  const docsJson = docs.map(d => `--- ${d.label} ---\n${JSON.stringify(d.data, null, 2)}`).join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 2500,
    messages: [
      { role: "system", content: COMPARE_SYSTEM },
      { role: "user", content: `Compare these ${docs.length} documents:\n\n${docsJson}` },
    ],
  });

  const raw = (response.choices[0]?.message?.content ?? "{}").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    return JSON.parse(raw) as { verdict: string; summary: string; discrepancies: unknown[] };
  } catch {
    return { verdict: "warning", summary: "Gagal parse hasil perbandingan AI", discrepancies: [] };
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────
freightDocVerifyRouter.use(async (req, res, next) => {
  const ok = await requireClerkUser(req, res);
  if (!ok) return;
  next();
});

// ── POST /api/freight/cross-doc-verify ───────────────────────────────────────
freightDocVerifyRouter.post(
  "/cross-doc-verify",
  upload.fields(
    Array.from({ length: 5 }, (_, i) => ({ name: `doc${i}`, maxCount: 1 })),
  ),
  async (req, res): Promise<void> => {
    // Rate limit check
    const rlKey = extractRateLimitKey(req);
    if (!verifyLimiter.check(rlKey)) {
      res.status(429).json({ message: "Terlalu banyak permintaan, coba lagi nanti" });
      return;
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    if (!files || Object.keys(files).length === 0) {
      res.status(400).json({ message: "Minimal 1 dokumen harus diupload" });
      return;
    }

    const rawLabels: Record<string, string> = req.body ?? {};
    const shipmentRef: string | undefined = req.body?.shipmentRef;
    const companyId: number | null = req.body?.companyId ? Number(req.body.companyId) : null;

    const docEntries: Array<{ label: string; buffer: Buffer; mimeType: string }> = [];
    for (let i = 0; i < 5; i++) {
      const key = `doc${i}`;
      const file = files[key]?.[0];
      if (!file) continue;
      const labelKey = `label${i}`;
      const rawLabel = rawLabels[labelKey] ?? "Other";
      const label = VALID_DOC_LABELS.includes(rawLabel as DocLabel) ? rawLabel : "Other";
      docEntries.push({ label, buffer: file.buffer, mimeType: file.mimetype });
    }

    if (docEntries.length === 0) {
      res.status(400).json({ message: "Tidak ada file valid yang ditemukan" });
      return;
    }

    try {
      // Extract all docs in parallel
      const extracted = await Promise.all(
        docEntries.map(async (entry) => ({
          label: entry.label,
          data: await extractOneDoc(entry.buffer, entry.mimeType, entry.label),
        })),
      );

      // Cross-compare
      const comparison = await compareDocuments(extracted);

      // Save to DB
      let savedId: number | null = null;
      try {
        const clerkUserId = (req as unknown as { auth?: { userId?: string } }).auth?.userId ?? null;
        const result = await db.execute(sql`
          INSERT INTO freight_doc_verifications
            (created_by, company_id, shipment_ref, doc_labels, doc_data, discrepancies, verdict, ai_summary)
          VALUES (
            ${clerkUserId},
            ${companyId},
            ${shipmentRef ?? null},
            ${sql.raw(`ARRAY[${docEntries.map((_, i) => `$${i + 1}`).join(",")}]::TEXT[]`
              .replace(/\$\d+/g, (_, idx) => `'${docEntries[parseInt(idx) - 1]?.label ?? ""}'`))},
            ${JSON.stringify(extracted)}::JSONB,
            ${JSON.stringify(comparison.discrepancies)}::JSONB,
            ${comparison.verdict},
            ${comparison.summary}
          )
          RETURNING id
        `);
        savedId = (result.rows[0] as { id: number })?.id ?? null;
      } catch (dbErr) {
        logger.warn({ dbErr }, "[freight-doc-verify] DB save failed (non-fatal)");
      }

      res.json({
        id: savedId,
        docs: extracted,
        verdict: comparison.verdict,
        summary: comparison.summary,
        discrepancies: comparison.discrepancies,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "[freight-doc-verify] verification failed");
      res.status(500).json({ message: "Verifikasi gagal", error: msg });
    }
  },
);

// ── GET /api/freight/cross-doc-verify/history ────────────────────────────────
freightDocVerifyRouter.get("/cross-doc-verify/history", async (req, res): Promise<void> => {
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const limit = Math.min(Number(req.query.limit ?? 20), 50);

  try {
    const result = companyId
      ? await db.execute(sql`
          SELECT id, created_at, created_by, shipment_ref, doc_labels, verdict, ai_summary
          FROM freight_doc_verifications
          WHERE company_id = ${companyId}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `)
      : await db.execute(sql`
          SELECT id, created_at, created_by, shipment_ref, doc_labels, verdict, ai_summary
          FROM freight_doc_verifications
          ORDER BY created_at DESC
          LIMIT ${limit}
        `);
    res.json({ items: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Gagal ambil histori", error: String(err) });
  }
});

// ── GET /api/freight/cross-doc-verify/:id ────────────────────────────────────
freightDocVerifyRouter.get("/cross-doc-verify/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ message: "ID tidak valid" }); return; }

  try {
    const result = await db.execute(sql`
      SELECT * FROM freight_doc_verifications WHERE id = ${id}
    `);
    if (!result.rows[0]) { res.status(404).json({ message: "Data tidak ditemukan" }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Gagal ambil detail", error: String(err) });
  }
});
