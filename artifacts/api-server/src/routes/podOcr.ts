import { Router } from "express";
import { getOpenAI } from "../lib/openaiClient.js";
import { db, podOcrResultsTable, logisticOrdersTable, driverJobsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";
import { createTwoTierRateLimiter, extractRateLimitKey } from "../lib/userRateLimiter.js";
import { imagePdfUpload } from "../lib/uploadMiddleware.js";

const router = Router();
const upload = imagePdfUpload(20);
const objectStorage = new ObjectStorageService();

// Per-user OCR rate limit: burst 5/minute + 20/hour.
// Prevents one account/driver from draining OpenAI Vision quota.
const ocrScanLimiter = createTwoTierRateLimiter(
  { windowMs: 60_000, limit: 5 },       // 5 per minute
  { windowMs: 60 * 60_000, limit: 20 }, // 20 per hour
);

// Allowed MIME types for POD OCR scan (images only — no executables or scripts)
const POD_OCR_ALLOWED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/gif", "image/tiff", "image/heic", "image/heif",
  "application/pdf",
]);

// Background OCR processor — runs after request responds.
// Updates the DB record in place when done.
async function runOcrInBackground(
  resultId: number,
  fileBuffer: Buffer,
  fileMimetype: string,
  orderId: number | null,
  orderNumber: string | null,
  imageUrl: string,
) {
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
    const imageData = `data:${fileMimetype};base64,${fileBuffer.toString("base64")}`;

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
    logger.error({ err: e, resultId }, "POD OCR: OpenAI vision failed");
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

  // Update the existing pending record with results
  await db.update(podOcrResultsTable)
    .set({
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
    })
    .where(eq(podOcrResultsTable.id, resultId));

  logger.info({ resultId, verificationStatus }, "POD OCR: background job complete");
}

// POST /api/pod-ocr/scan — upload POD image and start async OCR
// Returns immediately with a jobId. Poll GET /api/pod-ocr/:id for status.
// verificationStatus="pending" means OCR is still running.
router.post("/scan", upload.single("file"), async (req, res) => {
  // Auth gate: must have a valid Clerk/session OR a driver bearer token.
  const isClerkAuth = req.isAuthenticated();
  const hasBearerToken = typeof req.headers["authorization"] === "string" &&
    req.headers["authorization"].startsWith("Bearer ");
  if (!isClerkAuth && !hasBearerToken) {
    res.status(401).json({ error: "Unauthorized. Login diperlukan untuk menggunakan fitur POD OCR." });
    return;
  }

  // Per-user/per-token OCR rate limit — applied after auth so key is stable
  const rlKey = extractRateLimitKey(req);
  if (!ocrScanLimiter.check(rlKey)) {
    res.status(429).json({ error: "Terlalu banyak scan OCR. Batas: 5/menit dan 20/jam per akun." });
    return;
  }

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) { res.status(400).json({ error: "File wajib diupload" }); return; }

  // MIME type whitelist — reject non-image/non-PDF files
  if (!POD_OCR_ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
    res.status(415).json({ error: `Tipe file tidak didukung: ${file.mimetype}. Hanya gambar dan PDF yang diperbolehkan.` });
    return;
  }

  const { orderId, orderNumber, jobToken } = req.body ?? {};

  // Upload to object storage
  let imageUrl = "";
  try {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
    const key = `pod-ocr/${Date.now()}-${safeName}`;
    imageUrl = await objectStorage.uploadPublicRaw(key, file.buffer, file.mimetype);
  } catch (e) {
    logger.warn({ err: e }, "POD OCR: object storage upload failed, continuing with OCR");
  }

  // Save a "pending" record immediately — return this to client without waiting for OpenAI
  const [pendingResult] = await db.insert(podOcrResultsTable).values({
    orderId: orderId ? Number(orderId) : null,
    orderNumber: orderNumber ? String(orderNumber) : null,
    imageUrl,
    extractedText: null,
    extractedOrderNumber: null,
    extractedDate: null,
    extractedReceiver: null,
    extractedCompany: null,
    hasSignature: null,
    verificationStatus: "pending",
    mismatchFields: "",
    confidenceScore: "0",
    rawResponse: null,
  }).returning();

  // Fire OCR in background — do NOT await, request returns immediately
  runOcrInBackground(
    pendingResult.id,
    file.buffer,
    file.mimetype,
    orderId ? Number(orderId) : null,
    orderNumber ? String(orderNumber) : null,
    imageUrl,
  ).catch((err) => logger.error({ err, resultId: pendingResult.id }, "POD OCR: background job crash"));

  // Respond immediately — client polls GET /api/pod-ocr/:id until verificationStatus != "pending"
  res.json({
    ok: true,
    jobId: pendingResult.id,
    result: pendingResult,
    verificationStatus: "pending",
    extracted: {},
    mismatchFields: [],
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

// GET /api/pod-ocr/:id — single result (poll this until verificationStatus != "pending")
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
