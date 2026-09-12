import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getOpenAI } from "./openaiClient.js";

const execFileAsync = promisify(execFile);
const require_ = createRequire(import.meta.url);
type PdfParseFn = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
const pdfParse = require_("pdf-parse/lib/pdf-parse.js") as PdfParseFn;

export type BankProofOcrData = {
  document_type: string | null;
  vendor_name: string | null;
  vendor_tax_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  tax_type: "PPN_INPUT" | "PPN_OUTPUT" | "NONE" | "UNKNOWN";
  tax_rate: number | null;
  total_amount: number | null;
  payment_reference: string | null;
  raw_confidence: number;
  flags: string[];
};

export type BankProofOcrResult = {
  provider: "openai";
  model: string;
  data: BankProofOcrData;
};

const OCR_PROMPT = `You extract accounting evidence from Indonesian bank proof documents, invoices, receipts, and payment screenshots.

Return ONLY valid JSON with this exact shape:
{
  "document_type": string | null,
  "vendor_name": string | null,
  "vendor_tax_id": string | null,
  "invoice_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "currency": "IDR" | "USD" | "OTHER" | null,
  "subtotal": number | null,
  "tax_amount": number | null,
  "tax_type": "PPN_INPUT" | "PPN_OUTPUT" | "NONE" | "UNKNOWN",
  "tax_rate": number | null,
  "total_amount": number | null,
  "payment_reference": string | null,
  "raw_confidence": number,
  "flags": string[]
}

Rules:
- Use plain numbers for amounts. Convert Indonesian thousands separators, for example 53.792.335 to 53792335.
- Use ISO dates. If a date is incomplete or ambiguous, return null.
- PPN_INPUT means a purchase/vendor tax invoice received by the company. PPN_OUTPUT means a sales invoice issued by the company. Use UNKNOWN when the document does not establish the direction.
- "PPN", "VAT", or "pajak" without enough context means tax_type UNKNOWN, not PPN_INPUT.
- Never invent missing values. Put uncertainty or inconsistencies in flags.
- tax_amount is the PPN/VAT amount, not DPP/subtotal.
- raw_confidence must be between 0 and 1.`;

function cleanText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12000);
}

function parseJson(content: string): BankProofOcrData {
  const raw = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(raw) as Partial<BankProofOcrData>;
  const allowedTaxTypes = new Set<BankProofOcrData["tax_type"]>([
    "PPN_INPUT",
    "PPN_OUTPUT",
    "NONE",
    "UNKNOWN",
  ]);
  const numberOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const stringOrNull = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  return {
    document_type: stringOrNull(parsed.document_type),
    vendor_name: stringOrNull(parsed.vendor_name),
    vendor_tax_id: stringOrNull(parsed.vendor_tax_id),
    invoice_number: stringOrNull(parsed.invoice_number),
    invoice_date: stringOrNull(parsed.invoice_date),
    currency: stringOrNull(parsed.currency),
    subtotal: numberOrNull(parsed.subtotal),
    tax_amount: numberOrNull(parsed.tax_amount),
    tax_type: allowedTaxTypes.has(parsed.tax_type as BankProofOcrData["tax_type"])
      ? parsed.tax_type as BankProofOcrData["tax_type"]
      : "UNKNOWN",
    tax_rate: numberOrNull(parsed.tax_rate),
    total_amount: numberOrNull(parsed.total_amount),
    payment_reference: stringOrNull(parsed.payment_reference),
    raw_confidence: Math.min(1, Math.max(0, numberOrNull(parsed.raw_confidence) ?? 0)),
    flags: Array.isArray(parsed.flags)
      ? parsed.flags.filter((flag): flag is string => typeof flag === "string").slice(0, 20)
      : [],
  };
}

async function renderPdfFirstPage(buffer: Buffer): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bank-proof-ocr-"));
  const pdfPath = path.join(tmpDir, "proof.pdf");
  const pngPrefix = path.join(tmpDir, "page");
  try {
    await fs.writeFile(pdfPath, buffer);
    await execFileAsync("pdftoppm", [
      "-f", "1", "-l", "1", "-r", "150", "-png", "-singlefile", pdfPath, pngPrefix,
    ]);
    return await fs.readFile(`${pngPrefix}.png`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractBankProofOcr(
  buffer: Buffer,
  mimeType: string,
): Promise<BankProofOcrResult> {
  const openai = getOpenAI();
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");
  if (!isPdf && !isImage) throw new Error("Format dokumen tidak didukung OCR.");

  let model = "gpt-4o-mini";
  let content: Parameters<typeof openai.chat.completions.create>[0]["messages"][1]["content"];

  if (isPdf) {
    let text = "";
    try {
      text = cleanText((await pdfParse(buffer)).text ?? "");
    } catch {
      // Scanned PDFs are handled by the vision path below.
    }

    if (text.length >= 80) {
      content = `Extract this bank proof or invoice text:\n\n${text}`;
    } else {
      model = "gpt-4o";
      const rendered = await renderPdfFirstPage(buffer);
      content = [
        { type: "text" as const, text: "Extract this scanned bank proof or invoice image." },
        { type: "image_url" as const, image_url: { url: `data:image/png;base64,${rendered.toString("base64")}`, detail: "high" as const } },
      ];
    }
  } else {
    model = "gpt-4o";
    content = [
      { type: "text" as const, text: "Extract this bank proof, invoice, receipt, or payment screenshot." },
      { type: "image_url" as const, image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}`, detail: "high" as const } },
    ];
  }

  const completion = await openai.chat.completions.create({
    model,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: OCR_PROMPT },
      { role: "user", content },
    ],
  });
  const responseContent = completion.choices[0]?.message?.content;
  if (!responseContent) throw new Error("OpenAI tidak mengembalikan hasil OCR.");

  return {
    provider: "openai",
    model,
    data: parseJson(responseContent),
  };
}