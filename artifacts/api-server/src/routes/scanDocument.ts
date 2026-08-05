import { Router } from "express";
import { getOpenAI } from "../lib/openaiClient.js";
import { createRequire } from "node:module";
import { logger } from "../lib/logger";
import { db, aiAgentSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireClerkUser, requireAdmin } from "../lib/requireAdmin.js";
import { imagePdfUpload } from "../lib/uploadMiddleware.js";

const require_ = createRequire(import.meta.url);
type PdfParseFn = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
// pdf-parse v1.1.1 has a self-test loader issue when imported as the package
// root; importing the inner module path skips that and works in CJS+ESM.
const pdfParse = require_("pdf-parse/lib/pdf-parse.js") as PdfParseFn;


const router = Router();
const upload = imagePdfUpload(20);

// Minimum extracted text length to consider a PDF "text-based" (vs scanned image).
// Below this we fall back to vision OCR.
const PDF_TEXT_FAST_PATH_MIN_CHARS = 200;

// Maximum characters to send to the AI — cuts off legal boilerplate found on
// later pages / lower sections of B/Ls and MAWBs which only add tokens and
// slow down the response without contributing useful data.
const PDF_TEXT_MAX_CHARS = 5000;

// Boilerplate section headers — text from here onward is legal/T&C noise.
// Match at the start of a line, case-insensitive.
const BOILERPLATE_HEADERS = [
  "terms and conditions",
  "terms & conditions",
  "terms of service",
  "syarat dan ketentuan",
  "syarat & ketentuan",
  "general conditions",
  "conditions of contract",
  "conditions of carriage",
  "limitation of liability",
  "liability limitation",
  "disclaimer",
  "important notice",
  "ketentuan umum",
  "ketentuan dan kondisi",
  "notice to consignee",
  "governing law",
  "arbitration clause",
];

interface CleanPdfResult {
  text: string;
  truncatedAt: string | null;
  lineIndex: number;
  /** True when the text was cut at PDF_TEXT_MAX_CHARS without a boilerplate header — data on later pages/sections may have been missed */
  charLimitHit: boolean;
}

// Strip excessive blank lines and common boilerplate headers before sending to AI.
// Returns the cleaned text plus metadata about which phrase triggered truncation (if any).
function cleanPdfText(raw: string, headers: string[] = BOILERPLATE_HEADERS): CleanPdfResult {
  // Collapse 3+ consecutive newlines into 2
  let text = raw.replace(/\n{3,}/g, "\n\n");
  // Remove lines that are only dashes / underscores / dots (dividers)
  text = text.replace(/^[-_.=*]{5,}\s*$/gm, "").trim();

  // Truncate at the first boilerplate section header to drop T&C noise
  const lines = text.split("\n");
  let truncatedAt: string | null = null;
  let lineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].trim().toLowerCase();
    const hit = headers.find(
      (h) =>
        lower === h ||
        lower.startsWith(h + ":") ||
        lower.startsWith(h + " ") ||
        lower.startsWith(h + ".") ||
        lower.startsWith(h + "-"),
    );
    if (hit) {
      truncatedAt = hit;
      lineIndex = i;
      break;
    }
  }

  if (lineIndex >= 0) {
    text = lines.slice(0, lineIndex).join("\n").trim();
  }

  // Detect char-limit hit BEFORE slicing — if text is still longer than the cap,
  // we will cut it silently; warn the caller so they can surface this to the user.
  const charLimitHit = truncatedAt === null && text.length > PDF_TEXT_MAX_CHARS;

  return { text: text.slice(0, PDF_TEXT_MAX_CHARS), truncatedAt, lineIndex, charLimitHit };
}

router.use(async (req, res, next) => {
  const ok = await requireClerkUser(req, res);
  if (!ok) return;
  next();
});

// ─── Field Registry ──────────────────────────────────────────────────────────
export type DocGroup = "sales" | "freight" | "customs";

export interface FieldDef {
  key: string;
  label: string;
  description: string;
}

export const FIELD_REGISTRY: Record<DocGroup, FieldDef[]> = {
  sales: [
    { key: "partyName", label: "Nama Pihak", description: "Nama perusahaan atau individu (pembeli/penjual)" },
    { key: "partyEmail", label: "Email", description: "Alamat email pihak terkait" },
    { key: "partyPhone", label: "Telepon", description: "Nomor telepon pihak terkait" },
    { key: "partyAddress", label: "Alamat", description: "Alamat lengkap pihak terkait" },
    { key: "docDate", label: "Tanggal Dokumen", description: "Tanggal terbit dokumen (invoice, PO, dll)" },
    { key: "dueDate", label: "Tanggal Jatuh Tempo", description: "Batas waktu pembayaran" },
    { key: "notes", label: "Catatan", description: "Catatan atau keterangan tambahan di dokumen" },
    { key: "lines", label: "Item / Baris", description: "Daftar produk atau jasa beserta qty dan harga" },
  ],
  freight: [
    { key: "awbNumber", label: "No. AWB / B/L", description: "Nomor Air Waybill atau Bill of Lading" },
    { key: "shipperName", label: "Nama Shipper", description: "Nama pengirim barang" },
    { key: "shipperAddress", label: "Alamat Shipper", description: "Alamat lengkap pengirim" },
    { key: "consigneeName", label: "Nama Consignee", description: "Nama penerima barang" },
    { key: "consigneeAddress", label: "Alamat Consignee", description: "Alamat lengkap penerima" },
    { key: "notifyParty", label: "Notify Party", description: "Pihak yang perlu diberitahu saat barang tiba" },
    { key: "originAirport", label: "Pelabuhan / Bandara Asal", description: "Port of Loading atau Airport of Departure" },
    { key: "destinationAirport", label: "Pelabuhan / Bandara Tujuan", description: "Port of Discharge atau Airport of Destination" },
    { key: "vessel", label: "Nama Kapal / Maskapai", description: "Nama kapal laut atau nama maskapai penerbangan" },
    { key: "voyage", label: "Voyage / Flight No.", description: "Nomor voyage kapal atau nomor penerbangan" },
    { key: "containerNo", label: "No. Container", description: "Nomor kontainer (bisa lebih dari satu, dipisah koma)" },
    { key: "commodity", label: "Komoditi", description: "Jenis dan deskripsi barang yang dikirim" },
    { key: "hsCode", label: "HS Code", description: "Kode Harmonized System untuk klasifikasi barang" },
    { key: "grossWeight", label: "Berat Kotor (kg)", description: "Total berat kotor dalam kg" },
    { key: "netWeight", label: "Berat Bersih (kg)", description: "Total berat bersih dalam kg" },
    { key: "pieces", label: "Jumlah Pieces", description: "Total jumlah kemasan / koli" },
    { key: "packingType", label: "Jenis Kemasan", description: "Tipe kemasan (karton, palet, drum, dll)" },
    { key: "dimensions", label: "Dimensi / CBM", description: "Ukuran atau volume total dalam CBM" },
    { key: "measurement", label: "Measurement (CBM)", description: "Total cubic meter sebagai angka" },
    { key: "notes", label: "Catatan", description: "Keterangan tambahan pada dokumen pengiriman" },
    { key: "partyName", label: "Nama Pihak Utama", description: "Nama shipper atau consignee sisi BizPortal" },
  ],
  customs: [
    { key: "customsDocType", label: "Tipe Dokumen Pabean", description: "Jenis dokumen: PIB, PEB, SPPB, NPE, BC 2.3, dll" },
    { key: "nomorAju", label: "Nomor Pengajuan", description: "Nomor aju dari sistem kepabeanan" },
    { key: "nomorDokumen", label: "Nomor Dokumen", description: "Nomor resmi dokumen pabean" },
    { key: "tanggalDokumen", label: "Tanggal Dokumen", description: "Tanggal penerbitan dokumen" },
    { key: "namaPerusahaan", label: "Nama Perusahaan", description: "Nama importir atau eksportir" },
    { key: "npwpPerusahaan", label: "NPWP", description: "NPWP perusahaan importir/eksportir" },
    { key: "kantorPabean", label: "Kantor Pabean", description: "Nama kantor bea cukai yang menerbitkan" },
    { key: "posHS", label: "Pos HS", description: "Kode Pos Tarif HS barang impor/ekspor" },
    { key: "uraianBarang", label: "Uraian Barang", description: "Deskripsi barang sesuai dokumen pabean" },
    { key: "jumlahKoli", label: "Jumlah Koli", description: "Total jumlah kemasan" },
    { key: "beratBersih", label: "Berat Bersih (kg)", description: "Berat bersih barang dalam kg" },
    { key: "beratKotor", label: "Berat Kotor (kg)", description: "Berat kotor barang dalam kg" },
    { key: "negaraAsal", label: "Negara Asal", description: "Negara asal barang (untuk impor)" },
    { key: "negaraTujuan", label: "Negara Tujuan", description: "Negara tujuan barang (untuk ekspor)" },
    { key: "pelabuhan", label: "Pelabuhan", description: "Nama pelabuhan bongkar/muat" },
    { key: "nilaiPabean", label: "Nilai Pabean", description: "Nilai pabean / CIF dalam rupiah" },
    { key: "beaMasuk", label: "Bea Masuk", description: "Tagihan bea masuk dalam rupiah" },
    { key: "ppnImpor", label: "PPN Impor", description: "PPN impor dalam rupiah" },
    { key: "pphImpor", label: "PPh Impor", description: "PPh impor dalam rupiah" },
    { key: "totalTagihan", label: "Total Tagihan", description: "Total tagihan pungutan bea cukai" },
    { key: "nilaiEkspor", label: "Nilai Ekspor", description: "Nilai ekspor (untuk PEB)" },
    { key: "nomorPIBTerkait", label: "No. PIB Terkait", description: "Nomor PIB yang terkait (jika ada)" },
    { key: "nomorPEBTerkait", label: "No. PEB Terkait", description: "Nomor PEB yang terkait (jika ada)" },
    { key: "keteranganTambahan", label: "Keterangan Tambahan", description: "Catatan atau informasi lain dari dokumen pabean" },
  ],
};

const SCAN_FIELDS_KEY = "scan_document_fields";
const SCAN_BOILERPLATE_KEY = "scan_boilerplate_headers";

async function getScanFieldConfig(): Promise<Record<DocGroup, Record<string, boolean>>> {
  try {
    const [row] = await db
      .select()
      .from(aiAgentSettingsTable)
      .where(eq(aiAgentSettingsTable.key, SCAN_FIELDS_KEY));
    if (!row?.value) return {} as Record<DocGroup, Record<string, boolean>>;
    return JSON.parse(row.value) as Record<DocGroup, Record<string, boolean>>;
  } catch {
    return {} as Record<DocGroup, Record<string, boolean>>;
  }
}

async function getBoilerplateHeaders(): Promise<{ phrases: string[]; isCustom: boolean }> {
  try {
    const [row] = await db
      .select()
      .from(aiAgentSettingsTable)
      .where(eq(aiAgentSettingsTable.key, SCAN_BOILERPLATE_KEY));
    if (row?.value) {
      const parsed = JSON.parse(row.value) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { phrases: parsed, isCustom: true };
      }
    }
  } catch { /* fall through */ }
  return { phrases: BOILERPLATE_HEADERS, isCustom: false };
}

function isEnabled(cfg: Record<string, boolean>, field: string): boolean {
  if (cfg[field] === undefined) return true;
  return cfg[field];
}

function buildSalesSchema(cfg: Record<string, boolean>): string {
  const e = (f: string) => isEnabled(cfg, f);
  const lines: string[] = [`  "docType": "sales" | "purchase" | "freight"`];
  if (e("partyName")) lines.push(`  "partyName": string`);
  if (e("partyEmail")) lines.push(`  "partyEmail": string | null`);
  if (e("partyPhone")) lines.push(`  "partyPhone": string | null`);
  if (e("partyAddress")) lines.push(`  "partyAddress": string | null`);
  if (e("docDate")) lines.push(`  "docDate": string | null`);
  if (e("dueDate")) lines.push(`  "dueDate": string | null`);
  if (e("notes")) lines.push(`  "notes": string | null`);
  if (e("lines")) {
    lines.push(`  "lines": [\n    {\n      "name": string,\n      "description": string | null,\n      "quantity": number,\n      "unitPrice": number\n    }\n  ]`);
  }
  return `{\n${lines.join(",\n")}\n}`;
}

function buildFreightSchema(cfg: Record<string, boolean>): string {
  const e = (f: string) => isEnabled(cfg, f);
  const lines: string[] = [`  "docType": "freight"`];
  if (e("awbNumber")) lines.push(`  "awbNumber": string | null`);
  if (e("shipperName")) lines.push(`  "shipperName": string | null`);
  if (e("shipperAddress")) lines.push(`  "shipperAddress": string | null`);
  if (e("consigneeName")) lines.push(`  "consigneeName": string | null`);
  if (e("consigneeAddress")) lines.push(`  "consigneeAddress": string | null`);
  if (e("notifyParty")) lines.push(`  "notifyParty": string | null`);
  if (e("originAirport")) lines.push(`  "originAirport": string | null`);
  if (e("destinationAirport")) lines.push(`  "destinationAirport": string | null`);
  if (e("vessel")) lines.push(`  "vessel": string | null`);
  if (e("voyage")) lines.push(`  "voyage": string | null`);
  if (e("containerNo")) lines.push(`  "containerNo": string | null`);
  if (e("commodity")) lines.push(`  "commodity": string | null`);
  if (e("hsCode")) lines.push(`  "hsCode": string | null`);
  if (e("grossWeight")) lines.push(`  "grossWeight": number | null`);
  if (e("netWeight")) lines.push(`  "netWeight": number | null`);
  if (e("pieces")) lines.push(`  "pieces": number | null`);
  if (e("packingType")) lines.push(`  "packingType": string | null`);
  if (e("dimensions")) lines.push(`  "dimensions": string | null`);
  if (e("measurement")) lines.push(`  "measurement": number | null`);
  if (e("notes")) lines.push(`  "notes": string | null`);
  if (e("partyName")) lines.push(`  "partyName": string | null`);
  return `{\n${lines.join(",\n")}\n}`;
}

function buildCustomsSchema(cfg: Record<string, boolean>): string {
  const e = (f: string) => isEnabled(cfg, f);
  const lines: string[] = [`  "docType": "customs"`];
  if (e("customsDocType")) lines.push(`  "customsDocType": "PIB" | "PEB" | "SPPB" | "NPE" | "BC23" | "PP" | "SPTNP" | "other"`);
  if (e("nomorAju")) lines.push(`  "nomorAju": string | null`);
  if (e("nomorDokumen")) lines.push(`  "nomorDokumen": string | null`);
  if (e("tanggalDokumen")) lines.push(`  "tanggalDokumen": string | null`);
  if (e("namaPerusahaan")) lines.push(`  "namaPerusahaan": string | null`);
  if (e("npwpPerusahaan")) lines.push(`  "npwpPerusahaan": string | null`);
  if (e("kantorPabean")) lines.push(`  "kantorPabean": string | null`);
  if (e("posHS")) lines.push(`  "posHS": string | null`);
  if (e("uraianBarang")) lines.push(`  "uraianBarang": string | null`);
  if (e("jumlahKoli")) lines.push(`  "jumlahKoli": number | null`);
  if (e("beratBersih")) lines.push(`  "beratBersih": number | null`);
  if (e("beratKotor")) lines.push(`  "beratKotor": number | null`);
  if (e("negaraAsal")) lines.push(`  "negaraAsal": string | null`);
  if (e("negaraTujuan")) lines.push(`  "negaraTujuan": string | null`);
  if (e("pelabuhan")) lines.push(`  "pelabuhan": string | null`);
  if (e("nilaiPabean")) lines.push(`  "nilaiPabean": number | null`);
  if (e("beaMasuk")) lines.push(`  "beaMasuk": number | null`);
  if (e("ppnImpor")) lines.push(`  "ppnImpor": number | null`);
  if (e("pphImpor")) lines.push(`  "pphImpor": number | null`);
  if (e("totalTagihan")) lines.push(`  "totalTagihan": number | null`);
  if (e("nilaiEkspor")) lines.push(`  "nilaiEkspor": number | null`);
  if (e("nomorPIBTerkait")) lines.push(`  "nomorPIBTerkait": string | null`);
  if (e("nomorPEBTerkait")) lines.push(`  "nomorPEBTerkait": string | null`);
  if (e("keteranganTambahan")) lines.push(`  "keteranganTambahan": string | null`);
  return `{\n${lines.join(",\n")}\n}`;
}

const PROMPT_RULES = `Rules:
- Extract all monetary values as plain numbers (no currency symbols)
- Extract all weights, pieces, and volumes as plain numbers (no units like "kg", "pcs", "cbm")
- Dates as ISO strings (YYYY-MM-DD) or null if not found
- For origin/destination of sea freight (B/L): use PORT OF LOADING as originAirport and PORT OF DISCHARGE as destinationAirport (not the shipper's city). Format as "City, Country" e.g. "Nansha, China" or "Jakarta, Indonesia"
- For origin/destination of air freight (AWB/MAWB): use Airport of Departure as originAirport and Airport of Destination as destinationAirport. Prefer "City (IATA)" format e.g. "Jakarta (CGK)". In a MAWB, the 3-letter IATA code printed at top-left (before the carrier code) is the Airport of Destination
- For air freight (AWB/MAWB/HAWB): set "vessel" to the airline/carrier name (e.g., "China Southern Airlines Co., Ltd."), set "voyage" to the flight number (e.g., "CZ8353")
- For sea freight (B/L): set "vessel" to the SHIP/VESSEL NAME from the "VESSEL" row (e.g., "WADI ALRAYAN") — NOT the shipping line/carrier company name. Set "voyage" to the VOYAGE NUMBER from the "VOYAGE NUMBER" field (e.g., "0AUE9S1NC") — NOT the issue date
- For "awbNumber": use the AWB number for air freight, or the B/L number (BILL OF LADING NUMBER) for sea freight
- For "containerNo": list ALL container numbers from the document, comma-separated (e.g., "TCNU7361016, CMAU6579933"). Include seal numbers only if no container numbers are present
- AWB number format: "XXX-XXXXXXX" (3-digit airline prefix + 7 or 8-digit serial), e.g., "081-12345678" or "157-43470523"
- For shipper/consignee, copy the FULL name including company designation (PT., Pte. Ltd., Co. Ltd., etc.) and address as it appears
- For notifyParty: extract the "Notify Party" or "Also Notify" box if present; write "Same as Consignee" if the document states that; leave null if the field is absent from the document
- For commodity, list ALL distinct goods/product types exactly as they appear in the document, separated by newlines. Do NOT summarize or condense. If there are 7 SKUs, list all 7. Example: "MOTOR ASSY + COVER + SWITCH HFN 1210\nMOTOR ASSY + COVER + SWITCH 16SR 7116\n..."
- For "dimensions": for sea freight FCL/LCL use the CBM value as a string (e.g., "67.57 CBM"), for air freight use piece dimensions (e.g., "52X34X17")
- For "grossWeight": sum all container/package weights if multiple; report as total
- For "measurement": total CBM across all containers/packages
- Set partyName to the shipper or consignee name (whichever is the BizPortal customer side)
- If unsure of docType, default to "sales"
- Use Indonesian or English field values as they appear in the document
- IGNORE any terms & conditions, general conditions, conditions of carriage/contract, liability clauses, disclaimers, important notices, governing law sections, arbitration clauses, signature blocks, and any other legal boilerplate — extract data ONLY from the header, party boxes, cargo details, and line-item table sections of the document`;

async function buildSystemPrompt(): Promise<string> {
  const config = await getScanFieldConfig();
  const salesCfg = config.sales ?? {};
  const freightCfg = config.freight ?? {};
  const customsCfg = config.customs ?? {};

  return `You are a document data extraction assistant for a business management system (BizPortal).
Extract structured data from the uploaded document. Detect the document type and use the matching schema.
Always respond ONLY with valid JSON. Do not include markdown, code blocks, or any explanatory text.

For invoice/quotation/sales order/purchase order/expense:
${buildSalesSchema(salesCfg)}

For freight/shipment documents (Master Air Waybill / MAWB, House Air Waybill / HAWB, Bill of Lading / B/L, Sea Waybill, Delivery Order, Manifest, etc.):
${buildFreightSchema(freightCfg)}

For Indonesian customs documents (PIB, PEB, SPPB, NPE, BC 2.3, PP, SPTNP, etc.):
${buildCustomsSchema(customsCfg)}

${PROMPT_RULES}`;
}

router.post("/", upload.single("file"), async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }

  const mimeType = file.mimetype;
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  if (!isImage && !isPdf) {
    res.status(400).json({ message: "Only image files (JPG, PNG, WEBP) and PDF are supported" });
    return;
  }

  try {
    const [systemPrompt, { phrases: boilerplateHeaders }] = await Promise.all([
      buildSystemPrompt(),
      getBoilerplateHeaders(),
    ]);
    let extractedText: string;
    let mode: "pdf-text" | "pdf-vision" | "image-vision" = "image-vision";
    let truncation: { phrase: string; lineIndex: number } | null = null;
    let charLimitHit = false;

    if (isPdf) {
      // Fast path: try local PDF text extraction first.
      // For text-based PDFs (most airline-issued MAWBs/HAWBs/B/Ls), this is
      // 5–10x faster than sending the PDF as an image to a vision model.
      let pdfText = "";
      try {
        const parsedPdf = await pdfParse(file.buffer);
        pdfText = (parsedPdf.text ?? "").trim();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[scan-document] pdf-parse failed, falling back to vision:", msg);
      }

      if (pdfText.length >= PDF_TEXT_FAST_PATH_MIN_CHARS) {
        // Text-based PDF: send extracted text to a faster text-only model.
        mode = "pdf-text";
        const { text: cleanText, truncatedAt, lineIndex, charLimitHit: cLH } = cleanPdfText(pdfText, boilerplateHeaders);
        truncation = truncatedAt != null ? { phrase: truncatedAt, lineIndex } : null;
        charLimitHit = cLH;
        const response = await getOpenAI().chat.completions.create({
          model: "gpt-5-mini",
          max_completion_tokens: 3500,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Extract all data from this document and return as JSON only.\n\n----- DOCUMENT TEXT -----\n${cleanText}`,
            },
          ],
        });
        extractedText = response.choices[0]?.message?.content ?? "{}";
      } else {
        // Scanned image PDF (no text layer) — fall back to vision OCR.
        mode = "pdf-vision";
        const base64Pdf = file.buffer.toString("base64");
        const response = await getOpenAI().chat.completions.create({
          model: "gpt-5.1",
          max_completion_tokens: 3500,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract all data from this document and return as JSON only." },
                { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
              ],
            },
          ],
        });
        extractedText = response.choices[0]?.message?.content ?? "{}";
      }
    } else {
      mode = "image-vision";
      const base64Image = file.buffer.toString("base64");
      const response = await getOpenAI().chat.completions.create({
        model: "gpt-5.1",
        max_completion_tokens: 3500,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all data from this document image and return as JSON only." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          },
        ],
      });
      extractedText = response.choices[0]?.message?.content ?? "{}";
    }

    const cleanedText = extractedText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      res.status(422).json({ message: "Could not parse extracted data", raw: cleanedText, mode });
      return;
    }

    res.json({ data: parsed, mode, truncation, charLimitHit });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({
      err: err instanceof Error ? { message: err.message, name: err.name, stack: err.stack?.slice(0, 500) } : String(err),
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "NOT_SET",
      apiKeySet: !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
    }, "[scan-document] extraction failed");
    res.status(500).json({ message: "Extraction failed", error: msg });
  }
});

// ── GET /api/scan-document/fields ────────────────────────────────────────────
router.get("/fields", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const config = await getScanFieldConfig();

  const buildEnabled = (group: DocGroup): Record<string, boolean> => {
    const groupCfg = config[group] ?? {};
    const out: Record<string, boolean> = {};
    for (const f of FIELD_REGISTRY[group]) {
      out[f.key] = groupCfg[f.key] !== false;
    }
    return out;
  };

  res.json({
    fields: FIELD_REGISTRY,
    enabled: {
      sales: buildEnabled("sales"),
      freight: buildEnabled("freight"),
      customs: buildEnabled("customs"),
    },
  });
});

// ── PUT /api/scan-document/fields ─────────────────────────────────────────────
router.put("/fields", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const body = req.body as Partial<Record<DocGroup, Record<string, boolean>>>;
  const groups: DocGroup[] = ["sales", "freight", "customs"];

  const newConfig: Record<DocGroup, Record<string, boolean>> = {
    sales: {},
    freight: {},
    customs: {},
  };

  for (const group of groups) {
    const incoming = body[group];
    if (incoming && typeof incoming === "object") {
      const validKeys = new Set(FIELD_REGISTRY[group].map((f) => f.key));
      for (const [k, v] of Object.entries(incoming)) {
        if (validKeys.has(k) && typeof v === "boolean") {
          newConfig[group][k] = v;
        }
      }
    }
  }

  await db
    .insert(aiAgentSettingsTable)
    .values({ key: SCAN_FIELDS_KEY, value: JSON.stringify(newConfig) })
    .onConflictDoUpdate({
      target: aiAgentSettingsTable.key,
      set: { value: JSON.stringify(newConfig), updatedAt: new Date() },
    });

  res.json({ ok: true });
});

// ── POST /api/scan-document/extract-text ─────────────────────────────────────
// Admin-only: extract raw text from a PDF for client-side boilerplate testing.
// No AI is involved — returns the raw text as parsed by pdf-parse.
router.post("/extract-text", upload.single("file"), async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const file = req.file;
  if (!file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }
  if (file.mimetype !== "application/pdf") {
    res.status(400).json({ message: "Only PDF files are supported for text extraction" });
    return;
  }

  try {
    const parsedPdf = await pdfParse(file.buffer);
    const rawText = (parsedPdf.text ?? "").trim();
    if (rawText.length < PDF_TEXT_FAST_PATH_MIN_CHARS) {
      res.status(422).json({
        message:
          "PDF ini tidak memiliki cukup teks yang dapat diekstrak — kemungkinan merupakan PDF hasil scan (image). Gunakan PDF berbasis teks (digital).",
      });
      return;
    }
    res.json({ text: rawText, pages: parsedPdf.numpages, charCount: rawText.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[extract-text] pdf-parse failed");
    res.status(422).json({ message: `Gagal mengekstrak teks PDF: ${msg}` });
  }
});

// ── GET /api/scan-document/boilerplate-headers ────────────────────────────────
router.get("/boilerplate-headers", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const { phrases, isCustom } = await getBoilerplateHeaders();
  res.json({ phrases, isCustom, defaults: BOILERPLATE_HEADERS });
});

// ── PUT /api/scan-document/boilerplate-headers ────────────────────────────────
router.put("/boilerplate-headers", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const body = req.body as { phrases?: unknown };
  if (!Array.isArray(body.phrases)) {
    res.status(400).json({ message: "phrases must be an array of strings" });
    return;
  }
  const MAX_PHRASE_LENGTH = 200;
  const invalid = (body.phrases as unknown[]).find((p) => typeof p !== "string");
  if (invalid !== undefined) {
    res.status(400).json({ message: "each phrase must be a string" });
    return;
  }
  const seen = new Set<string>();
  const cleaned = (body.phrases as string[])
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0 && p.length <= MAX_PHRASE_LENGTH)
    .filter((p) => { if (seen.has(p)) return false; seen.add(p); return true; });

  if (cleaned.length === 0) {
    // Empty array means "reset to defaults" — delete the row
    await db
      .delete(aiAgentSettingsTable)
      .where(eq(aiAgentSettingsTable.key, SCAN_BOILERPLATE_KEY));
    res.json({ ok: true, isCustom: false, phrases: BOILERPLATE_HEADERS });
    return;
  }

  await db
    .insert(aiAgentSettingsTable)
    .values({ key: SCAN_BOILERPLATE_KEY, value: JSON.stringify(cleaned) })
    .onConflictDoUpdate({
      target: aiAgentSettingsTable.key,
      set: { value: JSON.stringify(cleaned), updatedAt: new Date() },
    });

  res.json({ ok: true, isCustom: true, phrases: cleaned });
});

export default router;
