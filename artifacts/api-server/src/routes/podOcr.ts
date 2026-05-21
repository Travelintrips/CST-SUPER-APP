import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import { db, podOcrResultsTable, logisticOrdersTable, driverJobsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const objectStorage = new ObjectStorageService();

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

// POST /api/pod-ocr/scan — upload POD image and run OCR
// This endpoint is public so drivers can also submit POD without login
router.post("/scan", upload.single("file"), async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) { res.status(400).json({ error: "File wajib diupload" }); return; }

  const { orderId, orderNumber, jobToken } = req.body ?? {};

  // Upload to object storage
  let imageUrl = "";
  try {
    const key = `pod-ocr/${Date.now()}-${file.originalname}`;
    const url = await objectStorage.uploadPublicFile(file.buffer, key, file.mimetype);
    imageUrl = url;
  } catch (e) {
    logger.warn({ err: e }, "POD OCR: object storage upload failed, continuing with OCR");
  }

  // Run OpenAI Vision OCR
  let extractedData: {
    order_number?: string;
    date?: string;
    receiver?: string;
    company?: string;
    has_signature?: string;
    raw_text?: string;
    confidence?: number;
  } = {};

  try {
    const openai = getOpenAI();
    const imageData = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Kamu adalah sistem OCR untuk dokumen POD (Proof of Delivery) / Surat Jalan logistik.
Ekstrak informasi berikut dari gambar dokumen ini dan kembalikan sebagai JSON:
{
  "order_number": "nomor order/surat jalan (string atau null)",
  "date": "tanggal dokumen (string atau null)",
  "receiver": "nama penerima (string atau null)",
  "company": "nama perusahaan penerima (string atau null)",
  "has_signature": "yes/no/unclear",
  "raw_text": "teks lengkap yang terbaca dari dokumen (string)",
  "confidence": angka 0-100 tingkat kepercayaan ekstraksi
}
Hanya kembalikan JSON, tanpa penjelasan tambahan.`,
            },
            {
              type: "image_url",
              image_url: { url: imageData, detail: "high" },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    extractedData = JSON.parse(cleaned);
  } catch (e) {
    logger.error({ err: e }, "POD OCR: OpenAI vision failed");
    extractedData = { confidence: 0, raw_text: "OCR gagal" };
  }

  // Determine verification status
  let verificationStatus = "unverified";
  const mismatchFields: string[] = [];

  if (orderId || orderNumber) {
    const targetOrderNumber = orderNumber || String(orderId);
    const extractedON = extractedData.order_number?.toLowerCase().replace(/[-\s]/g, "") ?? "";
    const targetON = targetOrderNumber.toLowerCase().replace(/[-\s]/g, "");

    if (extractedON && targetON && !extractedON.includes(targetON) && !targetON.includes(extractedON)) {
      mismatchFields.push("order_number");
    }

    verificationStatus = mismatchFields.length === 0
      ? (extractedData.confidence ?? 0) >= 60 ? "verified" : "low_confidence"
      : "mismatch";
  }

  // Save to DB
  const [result] = await db.insert(podOcrResultsTable).values({
    orderId: orderId ? Number(orderId) : null,
    orderNumber: orderNumber ? String(orderNumber) : null,
    imageUrl,
    extractedText: extractedData.raw_text ?? null,
    extractedOrderNumber: extractedData.order_number ?? null,
    extractedDate: extractedData.date ?? null,
    extractedReceiver: extractedData.receiver ?? null,
    extractedCompany: extractedData.company ?? null,
    hasSignature: extractedData.has_signature ?? null,
    verificationStatus,
    mismatchFields: mismatchFields.join(","),
    confidenceScore: String(extractedData.confidence ?? 0),
    rawResponse: JSON.stringify(extractedData),
  }).returning();

  res.json({
    ok: true,
    result,
    verificationStatus,
    extracted: extractedData,
    mismatchFields,
    imageUrl,
  });
});

// GET /api/pod-ocr/order/:orderId — get OCR results for an order
router.get("/order/:orderId", async (req, res) => {
  const ok = await requireClerkUser(req, res);
  if (!ok) return;

  const results = await db
    .select()
    .from(podOcrResultsTable)
    .where(eq(podOcrResultsTable.orderId, Number(req.params.orderId)));

  res.json(results);
});

// GET /api/pod-ocr/:id — single result
router.get("/:id", async (req, res) => {
  const ok = await requireClerkUser(req, res);
  if (!ok) return;

  const [result] = await db
    .select()
    .from(podOcrResultsTable)
    .where(eq(podOcrResultsTable.id, Number(req.params.id)));

  if (!result) { res.status(404).json({ error: "Not found" }); return; }
  res.json(result);
});

export { router as podOcrRouter };
