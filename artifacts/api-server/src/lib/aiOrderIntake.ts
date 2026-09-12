import OpenAI from "openai";
import { createRequire } from "node:module";
import {
  db,
  salesDocumentsTable,
  salesDocumentLinesTable,
  emailCorrespondencesTable,
  waAiIntakeLogTable,
  portalContentTable,
  logisticOrdersTable,
  suppliersTable,
} from "@workspace/db";
import { eq, sql, and, gt, ilike } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendMail, isSmtpConfigured } from "./mailer.js";
import { sendLogisticOrderNotification } from "./orderNotification.js";

const require_ = createRequire(import.meta.url);
type PdfParseFn = (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
const pdfParse = require_("pdf-parse/lib/pdf-parse.js") as PdfParseFn;

/** Escape user-controlled strings before inserting into HTML email bodies. */
function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const AI_INTAKE_KEY = "ai_intake_enabled";
const AI_INTAKE_REPLY_WA_KEY = "ai_intake_reply_wa";
const AI_INTAKE_REPLY_EMAIL_KEY = "ai_intake_reply_email";
const AI_INTAKE_VENDOR_FILTER_KEY = "ai_intake_vendor_filter";

export type VendorFilterMode = "all" | "by-service-type";
const DEFAULT_VENDOR_FILTER: VendorFilterMode = "by-service-type";

const DEFAULT_REPLY_WA = `✅ *Terima kasih!*\nPesan Anda telah kami terima dan sedang diproses oleh tim kami.\nDraft penawaran telah dibuat dan akan segera kami konfirmasi.\nNomor Draft: *{docNumber}*`;
const DEFAULT_REPLY_EMAIL_SUBJECT = `[Draft Diterima] {docNumber} — Terima kasih`;
const DEFAULT_REPLY_EMAIL_BODY = `Terima kasih telah menghubungi kami.\n\nPesan Anda telah kami terima dan sedang diproses oleh tim kami. Draft penawaran *{docNumber}* untuk kebutuhan Anda telah dibuat.\n\nTim kami akan segera menghubungi Anda untuk konfirmasi lebih lanjut.\n\nSalam,\nB2B Marketplace and Logistic`;

const VALID_TRANSPORT_MODES = ["sea", "air", "land", "multimodal"] as const;
type ValidTransportMode = (typeof VALID_TRANSPORT_MODES)[number];

function toTransportMode(v: string | null | undefined): ValidTransportMode | null {
  if (!v) return null;
  return (VALID_TRANSPORT_MODES as ReadonlyArray<string>).includes(v)
    ? (v as ValidTransportMode)
    : null;
}

function buildOpenAi(): OpenAI {
  const directKey = process.env.OPENAI_API_KEY;
  const intKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!directKey && !intKey) throw new Error("OpenAI API key tidak dikonfigurasi.");
  return new OpenAI({
    apiKey: directKey || intKey,
    baseURL: directKey ? undefined : baseURL,
  });
}

const AI_INTAKE_PROMPT = `You are an order intake assistant for B2B Marketplace and Logistic, a freight forwarding company.
Your job is to read an email or WhatsApp message and extract order/freight inquiry data.
Always respond ONLY with valid JSON — no markdown, no code blocks, no explanation.

Extract the following into this JSON structure:
{
  "customerName": string,
  "customerEmail": string | null,
  "customerPhone": string | null,
  "origin": string | null,
  "destination": string | null,
  "transportMode": "sea" | "air" | "land" | "multimodal" | null,
  "cargoDescription": string | null,
  "grossWeight": number | null,
  "volumeCbm": number | null,
  "requiredDate": string | null,
  "notes": string | null,
  "lines": [
    {
      "name": string,
      "description": string | null,
      "quantity": number,
      "unitPrice": number
    }
  ],
  "confidence": "high" | "medium" | "low",
  "isOrderInquiry": boolean
}

Rules:
- Set isOrderInquiry: true only if the message clearly requests freight, logistics, shipping, or customs services. Set false for generic inquiries, complaints, or unrelated messages.
- If customerName is not mentioned, use "Prospective Customer" as placeholder.
- For lines: create at least one line from the service requested. If no price is mentioned, set unitPrice to 0.
  - Example: { "name": "Sea Freight Jakarta - Singapore", "description": "FCL 20ft", "quantity": 1, "unitPrice": 0 }
- requiredDate as ISO string (YYYY-MM-DD) or null.
- grossWeight and volumeCbm as plain numbers or null.
- confidence: "high" if data is clear and complete, "medium" if partial, "low" if very little info.
- Do NOT make up specific prices unless explicitly stated.`;

interface ExtractedOrder {
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  origin?: string | null;
  destination?: string | null;
  transportMode?: "sea" | "air" | "land" | "multimodal" | null;
  cargoDescription?: string | null;
  grossWeight?: number | null;
  volumeCbm?: number | null;
  requiredDate?: string | null;
  notes?: string | null;
  lines: Array<{
    name: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
  }>;
  confidence: "high" | "medium" | "low";
  isOrderInquiry: boolean;
}

export interface AiIntakeResult {
  docId: number;
  docNumber: string;
  customerName: string;
  confidence: string;
}

async function getSettingValue(key: string): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(portalContentTable)
      .where(eq(portalContentTable.key, key));
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function isAiIntakeEnabled(): Promise<boolean> {
  const val = await getSettingValue(AI_INTAKE_KEY);
  if (val === null) return true;
  return val !== "false";
}

function generateLogisticOrderNumber(): string {
  const date = new Date();
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `LOG-${y}${m}${d}-${rand}`;
}

function toShipmentType(mode: string | null | undefined): string {
  switch (mode) {
    case "sea": return "Sea Freight";
    case "air": return "Air Freight";
    case "land": return "Trucking";
    case "multimodal": return "Sea Freight";
    default: return "Sea Freight";
  }
}

async function nextDocNumber(offset = 0): Promise<string> {
  const prefix = "SQ";
  const year = new Date().getFullYear();
  const pattern = `${prefix}/${year}/%`;
  const [row] = await db
    .select({
      maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(doc_number, '/', 3) AS int)), 0)`,
    })
    .from(salesDocumentsTable)
    .where(sql`doc_number LIKE ${pattern}`);
  const seq = (Number(row?.maxSeq ?? 0) + 1 + offset).toString().padStart(5, "0");
  return `${prefix}/${year}/${seq}`;
}

// ── Vendor Reply Prompt ────────────────────────────────────────────────────
const AI_VENDOR_REPLY_PROMPT = `You are an assistant for B2B Marketplace and Logistic, a freight forwarding company.
Your job is to read a vendor's reply email and extract their pricing/quotation data.
Always respond ONLY with valid JSON — no markdown, no code blocks, no explanation.

Extract the following into this JSON structure:
{
  "isVendorQuote": boolean,
  "vendorName": string | null,
  "quotedItems": [
    {
      "name": string,
      "description": string | null,
      "price": number,
      "currency": "IDR" | "USD" | "EUR" | "SGD",
      "unit": string
    }
  ],
  "totalPrice": number | null,
  "currency": "IDR" | "USD" | "EUR" | "SGD",
  "transitTime": string | null,
  "validUntil": string | null,
  "notes": string | null,
  "confidence": "high" | "medium" | "low"
}

Rules:
- Set isVendorQuote: true if the email contains freight/logistics pricing, rates, or cost breakdown from a vendor/carrier/agent.
- vendorName: the company name of the sender if mentioned.
- quotedItems: each line of service quoted with its price. If no explicit line items, create one from the total.
- currency: guess from context (IDR for Rupiah, USD for Dollar, etc.).
- transitTime: estimated transit/delivery time (e.g. "7-14 days", "2 minggu").
- validUntil: ISO date string (YYYY-MM-DD) or null.
- If no price mentioned, set price to 0 and confidence to "low".`;

interface ExtractedVendorQuote {
  isVendorQuote: boolean;
  vendorName: string | null;
  quotedItems: Array<{
    name: string;
    description: string | null;
    price: number;
    currency: string;
    unit: string;
  }>;
  totalPrice: number | null;
  currency: string;
  transitTime: string | null;
  validUntil: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
}

// ── Customer Approval Prompt ───────────────────────────────────────────────
const AI_APPROVAL_PROMPT = `You are an assistant for B2B Marketplace and Logistic, a freight forwarding company.
Your job is to read a customer's reply email and determine if it is an approval, rejection, or counter-offer for a quotation.
Always respond ONLY with valid JSON — no markdown, no code blocks, no explanation.

Extract the following into this JSON structure:
{
  "isApproval": boolean,
  "isRejection": boolean,
  "isCounterOffer": boolean,
  "confidence": "high" | "medium" | "low",
  "notes": string | null
}

Rules:
- isApproval: true if customer clearly accepts/confirms the quote (e.g. "setuju", "ok", "approved", "proceed", "kami setuju", "silakan lanjutkan").
- isRejection: true if customer clearly declines (e.g. "tidak jadi", "cancel", "too expensive").
- isCounterOffer: true if customer proposes different terms or asks for discount.
- notes: brief summary of what the customer said.
- Only one of isApproval/isRejection/isCounterOffer should be true at a time.`;

interface CustomerApprovalResult {
  isApproval: boolean;
  isRejection: boolean;
  isCounterOffer: boolean;
  confidence: "high" | "medium" | "low";
  notes: string | null;
}

async function extractVendorQuote(content: string): Promise<ExtractedVendorQuote | null> {
  const openai = buildOpenAi();
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 1000,
      messages: [
        { role: "system", content: AI_VENDOR_REPLY_PROMPT },
        { role: "user", content: `Extract vendor quote data from this email:\n\n${content.slice(0, 4000)}` },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as ExtractedVendorQuote;
  } catch (err) {
    logger.warn({ err }, "AI intake: vendor quote extraction failed");
    return null;
  }
}

async function classifyCustomerApproval(content: string): Promise<CustomerApprovalResult | null> {
  const openai = buildOpenAi();
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 400,
      messages: [
        { role: "system", content: AI_APPROVAL_PROMPT },
        { role: "user", content: `Classify this customer email:\n\n${content.slice(0, 3000)}` },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as CustomerApprovalResult;
  } catch (err) {
    logger.warn({ err }, "AI intake: customer approval classification failed");
    return null;
  }
}

async function findLinkedSalesDocByReplyTo(inReplyTo: string): Promise<{
  emailId: number;
  salesDocId: number;
  customerName: string;
  docNumber: string;
} | null> {
  // Find the parent email by its Message-ID
  const [parentEmail] = await db
    .select({
      id: emailCorrespondencesTable.id,
      linkedSalesDocId: emailCorrespondencesTable.linkedSalesDocId,
    })
    .from(emailCorrespondencesTable)
    .where(eq(emailCorrespondencesTable.emailMessageId, inReplyTo))
    .limit(1);

  if (!parentEmail?.linkedSalesDocId) {
    // Also check if the parent itself has a threadSalesDocId
    const [parentWithThread] = await db
      .select({
        id: emailCorrespondencesTable.id,
        threadSalesDocId: emailCorrespondencesTable.threadSalesDocId,
      })
      .from(emailCorrespondencesTable)
      .where(eq(emailCorrespondencesTable.emailMessageId, inReplyTo))
      .limit(1);

    if (!parentWithThread?.threadSalesDocId) return null;

    const [doc] = await db
      .select({ id: salesDocumentsTable.id, customerName: salesDocumentsTable.customerName, docNumber: salesDocumentsTable.docNumber })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.id, parentWithThread.threadSalesDocId))
      .limit(1);
    if (!doc) return null;
    return { emailId: parentWithThread.id, salesDocId: doc.id, customerName: doc.customerName, docNumber: doc.docNumber };
  }

  const [doc] = await db
    .select({ id: salesDocumentsTable.id, customerName: salesDocumentsTable.customerName, docNumber: salesDocumentsTable.docNumber })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.id, parentEmail.linkedSalesDocId))
    .limit(1);
  if (!doc) return null;
  return { emailId: parentEmail.id, salesDocId: doc.id, customerName: doc.customerName, docNumber: doc.docNumber };
}

async function processVendorReply(opts: {
  emailCorrespondenceId: number;
  salesDocId: number;
  docNumber: string;
  fromEmail: string;
  subject: string;
  body: string;
  vendorName: string;
}): Promise<void> {
  const content = `Subject: ${opts.subject}\nFrom: ${opts.fromEmail}\n\n${opts.body}`;
  const quote = await extractVendorQuote(content);

  let notesAppend = `\n\n---\n📦 PENAWARAN VENDOR: ${opts.vendorName}`;
  if (quote?.isVendorQuote) {
    if (quote.quotedItems.length > 0) {
      notesAppend += "\n" + quote.quotedItems
        .map((i) => `• ${i.name}: ${i.currency} ${i.price.toLocaleString("id-ID")} / ${i.unit}`)
        .join("\n");
    }
    if (quote.totalPrice) {
      notesAppend += `\nTotal: ${quote.currency} ${quote.totalPrice.toLocaleString("id-ID")}`;
    }
    if (quote.transitTime) notesAppend += `\nEstimasi Transit: ${quote.transitTime}`;
    if (quote.validUntil) notesAppend += `\nBerlaku s/d: ${quote.validUntil}`;
    if (quote.notes) notesAppend += `\nCatatan: ${quote.notes}`;
  } else {
    notesAppend += `\n(Email vendor diterima — harga belum terdeteksi otomatis, silakan cek manual)`;
  }

  // Append vendor quote info to the sales doc notes
  const [doc] = await db
    .select({ notes: salesDocumentsTable.notes })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.id, opts.salesDocId));

  const existingNotes = doc?.notes ?? "";
  await db
    .update(salesDocumentsTable)
    .set({ notes: existingNotes + notesAppend, updatedAt: new Date() })
    .where(eq(salesDocumentsTable.id, opts.salesDocId));

  // Mark email with role and thread link
  await db
    .update(emailCorrespondencesTable)
    .set({
      aiProcessed: true,
      emailRole: "vendor_reply",
      threadSalesDocId: opts.salesDocId,
    })
    .where(eq(emailCorrespondencesTable.id, opts.emailCorrespondenceId));

  // Notify staff
  if (isSmtpConfigured()) {
    sendMail({
      to: process.env.ADMIN_EMAIL ?? process.env.SMTP_FROM ?? "",
      subject: `[Penawaran Vendor] ${opts.vendorName} — ${opts.docNumber}`,
      text: `Vendor ${opts.vendorName} telah membalas penawaran untuk quotation ${opts.docNumber}.\n${notesAppend}\n\nSilakan buka sistem untuk meninjau dan mengonfirmasi.`,
      html: `<p>Vendor <strong>${esc(opts.vendorName)}</strong> telah membalas penawaran untuk quotation <strong>${esc(opts.docNumber)}</strong>.</p><pre>${esc(notesAppend)}</pre><p>Silakan buka sistem untuk meninjau dan mengonfirmasi.</p>`,
    }).catch((err: unknown) => logger.warn({ err }, "AI intake: vendor reply notification email failed"));
  }

  logger.info({ salesDocId: opts.salesDocId, docNumber: opts.docNumber, vendorName: opts.vendorName }, "AI intake: vendor reply processed and appended to quotation");
}

async function processCustomerApproval(opts: {
  emailCorrespondenceId: number;
  salesDocId: number;
  docNumber: string;
  customerName: string;
  fromEmail: string;
  subject: string;
  body: string;
}): Promise<void> {
  const content = `Subject: ${opts.subject}\nFrom: ${opts.fromEmail}\n\n${opts.body}`;
  const classification = await classifyCustomerApproval(content);

  if (!classification) {
    await db
      .update(emailCorrespondencesTable)
      .set({ aiProcessed: true, emailRole: "other", threadSalesDocId: opts.salesDocId })
      .where(eq(emailCorrespondencesTable.id, opts.emailCorrespondenceId));
    return;
  }

  const role = classification.isApproval
    ? "customer_approval"
    : classification.isRejection
      ? "customer_rejection"
      : classification.isCounterOffer
        ? "customer_counter"
        : "other";

  await db
    .update(emailCorrespondencesTable)
    .set({ aiProcessed: true, emailRole: role, threadSalesDocId: opts.salesDocId })
    .where(eq(emailCorrespondencesTable.id, opts.emailCorrespondenceId));

  if (classification.isApproval && classification.confidence !== "low") {
    // Append approval note to sales doc
    const [doc] = await db
      .select({ notes: salesDocumentsTable.notes })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.id, opts.salesDocId));

    const approvalNote = `\n\n---\n✅ PERSETUJUAN CUSTOMER: ${opts.customerName} menyetujui penawaran ini via email.\n${classification.notes ? `Catatan: ${classification.notes}` : ""}`;
    await db
      .update(salesDocumentsTable)
      .set({ notes: (doc?.notes ?? "") + approvalNote, updatedAt: new Date() })
      .where(eq(salesDocumentsTable.id, opts.salesDocId));

    // Notify staff to confirm the quotation
    if (isSmtpConfigured()) {
      sendMail({
        to: process.env.ADMIN_EMAIL ?? process.env.SMTP_FROM ?? "",
        subject: `[Customer SETUJU] ${opts.customerName} — ${opts.docNumber}`,
        text: `Customer ${opts.customerName} telah menyetujui quotation ${opts.docNumber} via email.\n\nCatatan AI: ${classification.notes ?? "-"}\n\nSilakan buka sistem dan konfirmasi quotation tersebut.`,
        html: `<p>Customer <strong>${esc(opts.customerName)}</strong> telah <strong>menyetujui</strong> quotation <strong>${esc(opts.docNumber)}</strong> via email.</p><p>Catatan AI: ${esc(classification.notes ?? "-")}</p><p>Silakan buka sistem dan <strong>konfirmasi</strong> quotation tersebut.</p>`,
      }).catch((err: unknown) => logger.warn({ err }, "AI intake: customer approval notification email failed"));
    }

    logger.info({ salesDocId: opts.salesDocId, docNumber: opts.docNumber, customerName: opts.customerName }, "AI intake: customer approval detected — staff notified");
  } else if (classification.isRejection) {
    logger.info({ salesDocId: opts.salesDocId, docNumber: opts.docNumber }, "AI intake: customer rejection detected");
  } else {
    logger.info({ salesDocId: opts.salesDocId, docNumber: opts.docNumber, role }, "AI intake: customer follow-up classified");
  }
}

async function extractOrderFromText(content: string): Promise<ExtractedOrder | null> {
  const openai = buildOpenAi();
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 1200,
      messages: [
        { role: "system", content: AI_INTAKE_PROMPT },
        {
          role: "user",
          content: `Extract order inquiry data from this message:\n\n${content.slice(0, 4000)}`,
        },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as ExtractedOrder;
  } catch (err) {
    logger.warn({ err }, "AI intake: extraction failed");
    return null;
  }
}

async function createDraftQuotation(
  extracted: ExtractedOrder,
  opts: {
    emailCorrespondenceId?: number;
    waPhone?: string;
    fromEmail?: string | null;
  },
): Promise<AiIntakeResult | null> {
  const lines = extracted.lines ?? [];
  if (!lines.length) {
    lines.push({ name: "Layanan Freight", description: null, quantity: 1, unitPrice: 0 });
  }

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  const notesParts: string[] = [];
  if (extracted.cargoDescription) notesParts.push(`Kargo: ${extracted.cargoDescription}`);
  if (extracted.grossWeight) notesParts.push(`Berat: ${extracted.grossWeight} kg`);
  if (extracted.volumeCbm) notesParts.push(`Volume: ${extracted.volumeCbm} CBM`);
  if (extracted.requiredDate) notesParts.push(`Tgl Dibutuhkan: ${extracted.requiredDate}`);
  if (extracted.notes) notesParts.push(extracted.notes);

  let doc: typeof salesDocumentsTable.$inferSelect | undefined;
  let docNumber = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    docNumber = await nextDocNumber(attempt);
    try {
      const [inserted] = await db
        .insert(salesDocumentsTable)
        .values({
          docNumber,
          kind: "quote",
          status: "draft",
          customerName: extracted.customerName,
          totalAmount: String(subtotal),
          taxAmount: "0",
          grandTotal: String(subtotal),
          amountPaid: "0",
          origin: extracted.origin ?? null,
          destination: extracted.destination ?? null,
          transportMode: toTransportMode(extracted.transportMode),
          notes: notesParts.join("\n") || null,
          aiGenerated: true,
          aiSourceCorrespondenceId: opts.emailCorrespondenceId ?? null,
          aiSourceWaPhone: opts.waPhone ?? null,
        })
        .returning();
      doc = inserted;
      break;
    } catch (err: unknown) {
      const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code;
      if (code === "23505" && attempt < 4) continue;
      throw err;
    }
  }

  if (!doc) return null;

  for (const line of lines) {
    const sub = line.quantity * line.unitPrice;
    await db.insert(salesDocumentLinesTable).values({
      documentId: doc.id,
      name: line.name,
      description: line.description ?? null,
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      subtotal: String(sub),
    });
  }

  if (opts.emailCorrespondenceId != null) {
    await db
      .update(emailCorrespondencesTable)
      .set({ aiProcessed: true, linkedSalesDocId: doc.id })
      .where(eq(emailCorrespondencesTable.id, opts.emailCorrespondenceId));
  }

  logger.info(
    {
      docId: doc.id,
      docNumber,
      customerName: extracted.customerName,
      confidence: extracted.confidence,
    },
    "AI intake: draft quotation created",
  );

  // ── Create a Logistic Order so vendor notifications fire automatically ──
  // Only proceed if we have at least origin + destination (required DB fields).
  const origin = extracted.origin ?? null;
  const destination = extracted.destination ?? null;
  const shipmentType = toShipmentType(extracted.transportMode);
  const phone = opts.waPhone ?? extracted.customerPhone ?? "000000000000";
  const email = opts.fromEmail ?? extracted.customerEmail ?? `${phone}@ai.b2bmarketplace.id`;
  const now = new Date();
  const jamOrder = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);

  if (origin && destination) {
    try {
      const logOrderNumber = generateLogisticOrderNumber();
      const serviceList = `• ${shipmentType}`;

      const [logOrder] = await db.insert(logisticOrdersTable).values({
        orderNumber: logOrderNumber,
        companyName: "-",
        customerName: extracted.customerName,
        email,
        phone,
        shipmentType,
        origin,
        destination,
        commodity: extracted.cargoDescription ?? null,
        cargoDescription: extracted.cargoDescription ?? null,
        grossWeight: extracted.grossWeight != null ? String(extracted.grossWeight) : null,
        volumeCbm: extracted.volumeCbm != null ? String(extracted.volumeCbm) : null,
        requiredDate: extracted.requiredDate ?? null,
        notes: notesParts.join("\n") || null,
        jamOrder,
        subtotal: "0",
        tax: "0",
        grandTotal: "0",
        status: "New Order",
        source: "ai_intake",
      }).returning();

      if (logOrder) {
        sendLogisticOrderNotification({
          id: logOrder.id,
          orderNumber: logOrderNumber,
          customerName: extracted.customerName,
          companyName: "-",
          email,
          phone,
          shipmentType,
          origin,
          destination,
          commodity: extracted.cargoDescription ?? null,
          cargoDescription: extracted.cargoDescription ?? null,
          grossWeight: extracted.grossWeight ?? null,
          volumeCbm: extracted.volumeCbm ?? null,
          grandTotal: subtotal,
          serviceList,
          requiredDate: extracted.requiredDate ?? null,
          notes: notesParts.join("\n") || null,
          jamOrder,
          createdAt: logOrder.createdAt,
        }).catch((err: unknown) => logger.error({ err }, "AI intake: sendLogisticOrderNotification failed"));

        logger.info(
          { logOrderId: logOrder.id, logOrderNumber, docNumber, shipmentType, origin, destination },
          "AI intake: logistic order created and vendor notifications queued",
        );
      }
    } catch (err) {
      logger.warn({ err, docNumber }, "AI intake: failed to create logistic order (draft quotation still saved)");
    }
  } else {
    logger.info({ docNumber, origin, destination }, "AI intake: skipping logistic order — origin/destination missing from inquiry");
  }

  return {
    docId: doc.id,
    docNumber,
    customerName: extracted.customerName,
    confidence: extracted.confidence,
  };
}

export async function processEmailForAiIntake(
  emailCorrespondenceId: number,
  subject: string,
  body: string,
  fromEmail: string | null,
  inReplyTo?: string | null,
): Promise<AiIntakeResult | null> {
  if (!(await isAiIntakeEnabled())) return null;

  // ── Skip emails FROM internal/admin addresses — prevents self-processing loops ──
  if (fromEmail) {
    const internalAddresses = [
      process.env.IMAP_USER,
      process.env.ADMIN_EMAIL,
      process.env.SMTP_FROM,
    ].filter(Boolean).map((a) => a!.trim().toLowerCase());
    if (internalAddresses.includes(fromEmail.trim().toLowerCase())) {
      await db
        .update(emailCorrespondencesTable)
        .set({ aiProcessed: true, aiSkipReason: "internal_email", emailRole: "other" })
        .where(eq(emailCorrespondencesTable.id, emailCorrespondenceId));
      logger.info({ emailCorrespondenceId, fromEmail }, "AI intake: skipping email from internal address");
      return null;
    }
  }

  // ── Threading: check if this email is a reply to a known quotation thread ──
  if (inReplyTo && fromEmail) {
    const thread = await findLinkedSalesDocByReplyTo(inReplyTo);
    if (thread) {
      logger.info(
        { emailCorrespondenceId, salesDocId: thread.salesDocId, docNumber: thread.docNumber, fromEmail },
        "AI intake: email is a reply in a known quotation thread",
      );

      // Determine if sender is a known vendor
      const normalizedEmail = fromEmail.trim().toLowerCase();
      const [matchedVendor] = await db
        .select({ id: suppliersTable.id, name: suppliersTable.name, contactEmail: suppliersTable.contactEmail })
        .from(suppliersTable)
        .where(ilike(suppliersTable.contactEmail, normalizedEmail))
        .limit(1);

      if (matchedVendor) {
        // Sender is a registered vendor → process as vendor reply
        await processVendorReply({
          emailCorrespondenceId,
          salesDocId: thread.salesDocId,
          docNumber: thread.docNumber,
          fromEmail,
          subject,
          body,
          vendorName: matchedVendor.name,
        });
        return null;
      }

      // Not a known vendor — could be customer follow-up/approval
      await processCustomerApproval({
        emailCorrespondenceId,
        salesDocId: thread.salesDocId,
        docNumber: thread.docNumber,
        customerName: thread.customerName,
        fromEmail,
        subject,
        body,
      });
      return null;
    }
  }

  // ── No thread found: existing new-inquiry flow ─────────────────────────────
  const content = `Subject: ${subject}\nFrom: ${fromEmail ?? "unknown"}\n\n${body ?? ""}`;
  const extracted = await extractOrderFromText(content);
  if (!extracted) {
    await db
      .update(emailCorrespondencesTable)
      .set({ aiProcessed: true, aiSkipReason: "ai_error" })
      .where(eq(emailCorrespondencesTable.id, emailCorrespondenceId));
    logger.warn({ emailCorrespondenceId }, "AI intake: email extraction failed — marked as error");
    return null;
  }
  if (!extracted.isOrderInquiry) {
    await db
      .update(emailCorrespondencesTable)
      .set({ aiProcessed: true, aiSkipReason: "not_order_inquiry", emailRole: "other" })
      .where(eq(emailCorrespondencesTable.id, emailCorrespondenceId));
    logger.debug({ emailCorrespondenceId }, "AI intake: email not classified as order inquiry");
    return null;
  }
  const result = await createDraftQuotation(extracted, { emailCorrespondenceId, fromEmail });
  if (result && fromEmail) {
    try {
      const settings = await getAiIntakeSettings();
      if (settings.replyEmailSubject && settings.replyEmailBody && isSmtpConfigured()) {
        const replySubject = settings.replyEmailSubject.replace(/\{docNumber\}/g, result.docNumber);
        const replyBody = settings.replyEmailBody.replace(/\{docNumber\}/g, result.docNumber);
        await sendMail({
          to: fromEmail,
          subject: replySubject,
          text: replyBody,
          html: replyBody.replace(/\n/g, "<br>"),
        });
        logger.info({ docNumber: result.docNumber, to: fromEmail }, "AI intake: email auto-reply sent");
      }
    } catch (err) {
      logger.warn({ err }, "AI intake: failed to send email auto-reply");
    }
  }
  return result;
}

export async function processWaForAiIntake(
  phone: string,
  message: string,
  senderName?: string | null,
): Promise<AiIntakeResult | null> {
  if (!(await isAiIntakeEnabled())) return null;

  // ── Skip WA from known vendor phone numbers — vendor replies are NOT new customer orders ──
  const normalizePhone = (p: string) => p.replace(/\D/g, "").replace(/^0/, "62");
  const normalizedIncoming = normalizePhone(phone);
  const vendors = await db.select({ phone: suppliersTable.phone }).from(suppliersTable).where(eq(suppliersTable.isActive, true));
  const vendorPhones = vendors.map((v) => v.phone ? normalizePhone(v.phone) : "").filter(Boolean);
  if (vendorPhones.includes(normalizedIncoming)) {
    logger.info({ phone, normalizedIncoming }, "AI intake: WA from known vendor number — skipping order intake");
    return null;
  }

  // Idempotency: skip if a draft from same phone was created in the last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const [recent] = await db
    .select({ id: salesDocumentsTable.id })
    .from(salesDocumentsTable)
    .where(
      and(
        eq(salesDocumentsTable.aiSourceWaPhone, phone),
        gt(salesDocumentsTable.createdAt, tenMinutesAgo),
      ),
    )
    .limit(1);
  if (recent) {
    logger.info({ phone, existingDocId: recent.id }, "AI intake: duplicate WA skipped (recent draft exists)");
    return null;
  }

  const content = `From: ${senderName ?? phone}\nPhone: ${phone}\n\n${message}`;
  const extracted = await extractOrderFromText(content);
  if (!extracted) {
    // AI extraction failed — write a skip/error event so it appears in the intake log
    await db.insert(waAiIntakeLogTable).values({
      phone,
      senderName: senderName ?? null,
      status: "error",
      skipReason: "ai_error",
    });
    logger.warn({ phone }, "AI intake: WA extraction failed — logged as error");
    return null;
  }
  if (!extracted.isOrderInquiry) {
    // AI decided not an order inquiry — write a skipped event for the log
    await db.insert(waAiIntakeLogTable).values({
      phone,
      senderName: senderName ?? null,
      status: "skipped",
      skipReason: "not_order_inquiry",
    });
    logger.debug({ phone }, "AI intake: WA message not classified as order inquiry");
    return null;
  }
  return createDraftQuotation(extracted, { waPhone: phone });
}

export async function getAiIntakeSettings(): Promise<{
  enabled: boolean;
  replyWaTemplate: string;
  replyEmailSubject: string;
  replyEmailBody: string;
  vendorFilterMode: VendorFilterMode;
}> {
  const [enabled, replyWa, replyEmailSubj, replyEmailBody, vendorFilter] = await Promise.all([
    getSettingValue(AI_INTAKE_KEY),
    getSettingValue(AI_INTAKE_REPLY_WA_KEY),
    getSettingValue(AI_INTAKE_REPLY_EMAIL_KEY + "_subject"),
    getSettingValue(AI_INTAKE_REPLY_EMAIL_KEY + "_body"),
    getSettingValue(AI_INTAKE_VENDOR_FILTER_KEY),
  ]);
  return {
    enabled: enabled === null ? true : enabled !== "false",
    replyWaTemplate: replyWa ?? DEFAULT_REPLY_WA,
    replyEmailSubject: replyEmailSubj ?? DEFAULT_REPLY_EMAIL_SUBJECT,
    replyEmailBody: replyEmailBody ?? DEFAULT_REPLY_EMAIL_BODY,
    vendorFilterMode: (vendorFilter === "all" || vendorFilter === "by-service-type")
      ? vendorFilter
      : DEFAULT_VENDOR_FILTER,
  };
}

export async function getVendorFilterMode(): Promise<VendorFilterMode> {
  const val = await getSettingValue(AI_INTAKE_VENDOR_FILTER_KEY);
  return (val === "all" || val === "by-service-type") ? val : DEFAULT_VENDOR_FILTER;
}

export async function saveAiIntakeSettings(settings: {
  enabled: boolean;
  replyWaTemplate?: string;
  replyEmailSubject?: string;
  replyEmailBody?: string;
  vendorFilterMode?: VendorFilterMode;
}): Promise<void> {
  const upsert = async (key: string, value: string) => {
    await db
      .insert(portalContentTable)
      .values({ key, value, updatedAt: new Date() } as any)
      .onConflictDoUpdate({
        target: [portalContentTable.key, (portalContentTable as any).locale],
        set: { value, updatedAt: new Date() },
      });
  };
  await upsert(AI_INTAKE_KEY, settings.enabled ? "true" : "false");
  if (settings.replyWaTemplate !== undefined)
    await upsert(AI_INTAKE_REPLY_WA_KEY, settings.replyWaTemplate);
  if (settings.replyEmailSubject !== undefined)
    await upsert(AI_INTAKE_REPLY_EMAIL_KEY + "_subject", settings.replyEmailSubject);
  if (settings.replyEmailBody !== undefined)
    await upsert(AI_INTAKE_REPLY_EMAIL_KEY + "_body", settings.replyEmailBody);
  if (settings.vendorFilterMode !== undefined)
    await upsert(AI_INTAKE_VENDOR_FILTER_KEY, settings.vendorFilterMode);
}

export function buildAiReplyWa(template: string, docNumber: string): string {
  return template.replace(/\{docNumber\}/g, docNumber);
}

// ── WA Media (PDF / Image) intake ────────────────────────────────────────────

function guessMimeFromUrl(url: string): string {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "";
}

// SSRF guard: block fetches to private/loopback/link-local address ranges
function isSsrfSafeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();

  // Block loopback, private, and reserved hostnames
  const blockedHostnames = ["localhost", "metadata.google.internal"];
  if (blockedHostnames.includes(hostname)) return false;

  // Block private/reserved IPv4 CIDR ranges
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, 0.0.0.0/8
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return false;
    }
  }

  // Block IPv6 loopback/link-local (::1, fe80::, fc00::, fd00::)
  if (hostname === "::1" || hostname.startsWith("fe80") ||
      hostname.startsWith("fc") || hostname.startsWith("fd")) {
    return false;
  }

  return true;
}

async function downloadFileBuffer(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  // SSRF protection: reject private/internal URLs from untrusted webhook payloads
  if (!isSsrfSafeUrl(url)) {
    logger.warn({ url }, "AI media intake: blocked SSRF-unsafe URL");
    return null;
  }
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) {
      logger.warn({ url, status: resp.status }, "AI media intake: download failed");
      return null;
    }
    const contentType = (resp.headers.get("content-type") ?? "").split(";")[0].trim();
    const arrayBuffer = await resp.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimeType: contentType };
  } catch (err) {
    logger.warn({ err, url }, "AI media intake: download error");
    return null;
  }
}

const AI_MEDIA_INTAKE_PROMPT = `You are an order intake assistant for B2B Marketplace and Logistic, a freight forwarding company.
Your job is to read a document (invoice, quotation, Bill of Lading, Air Waybill, shipping order, customs form, or any business document) and extract order/freight inquiry data.
Always respond ONLY with valid JSON — no markdown, no code blocks, no explanation.

Extract the following into this JSON structure:
{
  "customerName": string,
  "customerEmail": string | null,
  "customerPhone": string | null,
  "origin": string | null,
  "destination": string | null,
  "transportMode": "sea" | "air" | "land" | "multimodal" | null,
  "cargoDescription": string | null,
  "grossWeight": number | null,
  "volumeCbm": number | null,
  "requiredDate": string | null,
  "notes": string | null,
  "lines": [
    {
      "name": string,
      "description": string | null,
      "quantity": number,
      "unitPrice": number
    }
  ],
  "confidence": "high" | "medium" | "low",
  "isOrderInquiry": boolean,
  "docSummary": string
}

Rules:
- Set isOrderInquiry: true if the document relates to freight, logistics, shipping, customs, or any business transaction/inquiry.
- docSummary: one-line summary of what the document is (e.g. "Bill of Lading — Jakarta to Singapore, 20ft FCL")
- For customerName: use the shipper, importer, or sender party name as it appears on the document. If not found use "Prospective Customer".
- For lines: create at least one line from the document. For freight docs without explicit line items, create one line from the service (e.g. {"name": "Sea Freight FCL Jakarta–Singapore", "description": "Container: TCNU1234567", "quantity": 1, "unitPrice": 0}).
- If no price is mentioned, set unitPrice to 0.
- requiredDate as ISO string (YYYY-MM-DD) or null.
- grossWeight and volumeCbm as plain numbers or null.
- confidence: "high" if data is clear and complete, "medium" if partial, "low" if very little info.
- Do NOT make up specific prices unless clearly stated in the document.`;

async function extractOrderFromMediaBuffer(
  buffer: Buffer,
  mimeType: string,
  caption: string,
): Promise<ExtractedOrder | null> {
  const openai = buildOpenAi();
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  if (!isImage && !isPdf) return null;

  const captionNote = caption.trim() ? `\n\nCaption/note from sender: ${caption.trim()}` : "";

  try {
    if (isPdf) {
      let pdfText = "";
      try {
        const parsed = await pdfParse(buffer);
        pdfText = (parsed.text ?? "").trim();
      } catch { /* fall through to vision */ }

      if (pdfText.length >= 200) {
        // Text-based PDF — fast text path
        const cleanText = pdfText.slice(0, 5000);
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_completion_tokens: 1500,
          messages: [
            { role: "system", content: AI_MEDIA_INTAKE_PROMPT },
            { role: "user", content: `Extract order data from this document:\n\n${cleanText}${captionNote}` },
          ],
        });
        const raw = response.choices[0]?.message?.content ?? "{}";
        return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()) as ExtractedOrder;
      } else {
        // Scanned/image PDF — vision path
        const base64 = buffer.toString("base64");
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          max_completion_tokens: 1500,
          messages: [
            { role: "system", content: AI_MEDIA_INTAKE_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: `Extract order data from this document:${captionNote}` },
                { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
              ],
            },
          ],
        });
        const raw = response.choices[0]?.message?.content ?? "{}";
        return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()) as ExtractedOrder;
      }
    } else {
      // Image (JPG, PNG, WEBP)
      const base64 = buffer.toString("base64");
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_completion_tokens: 1500,
        messages: [
          { role: "system", content: AI_MEDIA_INTAKE_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Extract order data from this document image:${captionNote}` },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      });
      const raw = response.choices[0]?.message?.content ?? "{}";
      return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()) as ExtractedOrder;
    }
  } catch (err) {
    logger.warn({ err }, "AI media intake: extraction failed");
    return null;
  }
}

export interface AiMediaIntakeResult extends AiIntakeResult {
  docSummary: string;
  mimeType: string;
}

/**
 * Process a media file URL (PDF or image) from a WhatsApp message.
 * Downloads the file, extracts order data via AI vision/OCR, and creates a draft quotation.
 */
export async function processWaMediaForAiIntake(
  fileUrl: string,
  phone: string,
  senderName?: string | null,
  caption?: string | null,
): Promise<AiMediaIntakeResult | null> {
  if (!(await isAiIntakeEnabled())) return null;

  // Idempotency: skip if a draft from same phone was created in the last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const [recentMedia] = await db
    .select({ id: salesDocumentsTable.id })
    .from(salesDocumentsTable)
    .where(
      and(
        eq(salesDocumentsTable.aiSourceWaPhone, phone),
        gt(salesDocumentsTable.createdAt, tenMinutesAgo),
      ),
    )
    .limit(1);
  if (recentMedia) {
    logger.info({ phone, existingDocId: recentMedia.id }, "AI media intake: duplicate WA media skipped (recent draft exists)");
    return null;
  }

  const downloaded = await downloadFileBuffer(fileUrl);
  if (!downloaded) {
    await db.insert(waAiIntakeLogTable).values({
      phone,
      senderName: senderName ?? null,
      status: "error",
      skipReason: "download_failed",
    });
    return null;
  }

  let { mimeType } = downloaded;
  if (!mimeType || mimeType === "application/octet-stream" || mimeType === "") {
    mimeType = guessMimeFromUrl(fileUrl);
  }

  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  if (!isImage && !isPdf) {
    logger.info({ mimeType, phone }, "AI media intake: unsupported file type, skipping");
    await db.insert(waAiIntakeLogTable).values({
      phone,
      senderName: senderName ?? null,
      status: "skipped",
      skipReason: "unsupported_file_type",
    });
    return null;
  }

  const extracted = await extractOrderFromMediaBuffer(
    downloaded.buffer,
    mimeType,
    caption ?? "",
  );

  if (!extracted) {
    await db.insert(waAiIntakeLogTable).values({
      phone,
      senderName: senderName ?? null,
      status: "error",
      skipReason: "ai_error",
    });
    return null;
  }

  // For documents, we always treat as order inquiry even if AI is unsure
  if (!extracted.isOrderInquiry) {
    logger.debug({ phone, mimeType }, "AI media intake: document not classified as order — forcing isOrderInquiry=true");
    extracted.isOrderInquiry = true;
  }

  const docSummary = (extracted as ExtractedOrder & { docSummary?: string }).docSummary ?? "Dokumen dari WA";

  const result = await createDraftQuotation(extracted, { waPhone: phone });
  if (!result) return null;

  logger.info(
    { phone, docId: result.docId, docNumber: result.docNumber, mimeType, docSummary },
    "AI media intake: draft created from WA media file",
  );

  return { ...result, docSummary, mimeType };
}
