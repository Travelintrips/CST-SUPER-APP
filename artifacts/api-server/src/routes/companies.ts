import { Router } from "express";
import { db, companiesTable, companyLegalDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { deleteFromSupabase } from "../lib/supabaseStorage.js";
import { logger } from "../lib/logger.js";
import { getOpenAI } from "../lib/openaiClient.js";
import { imageUpload } from "../lib/uploadMiddleware.js";
import * as archiver from "archiver";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();

const ALL_LEGAL_DOC_TYPES = [
  "akta_pendirian", "akta_perubahan", "sk_kumham", "nib_doc",
  "siup", "tdp", "skdp", "izin_usaha", "domisili", "sppkp", "lainnya",
];

function getDuplicateCompanyCodeMessage(err: any): string | null {
  const pgCode: string | undefined = err?.cause?.code ?? err?.code;
  if (pgCode !== "23505") return null;
  const detail: string = err?.cause?.constraint ?? err?.constraint ?? err?.cause?.message ?? err?.message ?? "";
  if (detail.includes("companies_company_code_unique") || detail.includes("company_code") || detail.includes("company code")) {
    return "Kode perusahaan sudah digunakan oleh perusahaan lain. Gunakan kode yang berbeda.";
  }
  if (pgCode === "23505") return "Terjadi konflik data unik pada perusahaan. Periksa kembali nilai yang Anda masukkan.";
  return null;
}

async function addCompanyToHoldingGroups(companyId: number): Promise<void> {
  try {
    const groups = await db.execute(sql`SELECT id FROM holding_groups ORDER BY id`);
    for (const row of groups.rows) {
      const holdingGroupId = (row as { id: number }).id;
      await db.execute(sql`
        INSERT INTO company_holding_members (holding_group_id, company_id, ownership_percentage, consolidation_method)
        VALUES (${holdingGroupId}, ${companyId}, 100.00, 'full')
        ON CONFLICT ON CONSTRAINT chm_holding_company_unique DO NOTHING
      `);
    }
  } catch {
    // non-fatal
  }
}

// GET /companies
router.get("/", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  try {
    const rows = await db.select().from(companiesTable).orderBy(companiesTable.id);
    return res.json(rows.map((c) => ({ ...c, createdAt: c.createdAt ? c.createdAt.toISOString() : null })));
  } catch (err: any) {
    logger.error({ err, url: req.url }, "[companies] GET / query failed");
    return res.status(500).json({ message: "Gagal memuat daftar perusahaan", detail: String(err?.message ?? err) });
  }
});

// GET /companies/list
router.get("/list", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const isEcb = (e: any) => String(e?.message ?? "").includes("ECIRCUITBREAKER");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { rows } = await db.execute(
        sql`SELECT id, company_name AS name, company_code AS code FROM companies WHERE is_active IS DISTINCT FROM false ORDER BY id`
      );
      logger.info({ count: rows.length, attempt }, "[companies] GET /list ok");
      return res.json(rows);
    } catch (err: any) {
      if (isEcb(err) && attempt < 3) {
        const wait = [5000, 15000, 30000][attempt] ?? 30000;
        logger.warn({ attempt, wait }, "[companies] GET /list ECIRCUITBREAKER — retrying");
        await sleep(wait);
        continue;
      }
      logger.error({ err, url: req.url }, "[companies] GET /list query failed");
      const status = isEcb(err) ? 503 : 500;
      return res.status(status).json({ message: "Gagal memuat daftar perusahaan", detail: String(err?.message ?? err), retryable: isEcb(err) });
    }
  }
});

// POST /companies
router.post("/", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { companyName, companyCode, logoUrl, address, phone, email, npwp, isHolding, parentCompanyId } = req.body ?? {};
  if (!companyName || !companyCode) return res.status(400).json({ message: "companyName and companyCode are required" });
  try {
    const [created] = await db
      .insert(companiesTable)
      .values({ companyName, companyCode, logoUrl, address, phone, email, npwp, isHolding: isHolding ?? false, parentCompanyId: parentCompanyId ? Number(parentCompanyId) : null })
      .returning();
    if (!created.isHolding) await addCompanyToHoldingGroups(created.id);
    return res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
  } catch (err: any) {
    const msg = getDuplicateCompanyCodeMessage(err);
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
});

// PATCH /companies/:id
router.patch("/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const body = req.body ?? {};
  const patch: Partial<typeof companiesTable.$inferInsert> = {};

  const textFields: Array<keyof typeof companiesTable.$inferInsert> = [
    "companyName", "companyCode", "logoUrl",
    "address", "city", "province", "postalCode", "kodeWilayah",
    "phone", "fax", "email", "website",
    "npwp", "npwpStatus", "kegiatanUtama", "jenisWajibPajak", "bentukBadanHukum",
    "tanggalTerdaftar", "tanggalAktivasi", "tanggalPkp",
    "kanwilDjp", "kppTerdaftar", "seksiPengawasan", "tanggalPembaruanProfil",
    "kodeKlu", "deskripsiKlu", "nib",
  ];
  for (const f of textFields) {
    if (body[f] !== undefined) (patch as any)[f] = body[f];
  }
  if (body.statusPkp !== undefined) patch.statusPkp = body.statusPkp;
  if (body.isActive !== undefined) patch.isActive = body.isActive;
  if (body.isHolding !== undefined) patch.isHolding = body.isHolding;
  if (body.parentCompanyId !== undefined) patch.parentCompanyId = body.parentCompanyId ? Number(body.parentCompanyId) : null;

  if (Object.keys(patch).length === 0) return res.status(400).json({ message: "No fields to update" });
  try {
    const [updated] = await db.update(companiesTable).set(patch).where(eq(companiesTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "Company not found" });
    return res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
  } catch (err: any) {
    const msg = getDuplicateCompanyCodeMessage(err);
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
});

// DELETE /companies/:id
router.delete("/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  if (id <= 4) return res.status(403).json({ message: "Tidak dapat menghapus perusahaan inti (id 1-4)" });
  const [company] = await db.select({ logoUrl: companiesTable.logoUrl }).from(companiesTable).where(eq(companiesTable.id, id));
  await db.delete(companiesTable).where(eq(companiesTable.id, id));
  if (company?.logoUrl) deleteFromSupabase(company.logoUrl).catch(() => {});
  return res.json({ success: true });
});

// ─── OCR Scan NPWP / NIB ─────────────────────────────────────────────────────

const npwpUpload = imageUpload(10);

// POST /companies/:id/scan-npwp
router.post("/:id/scan-npwp", npwpUpload.single("file"), async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (!req.file) return res.status(400).json({ message: "File gambar wajib diunggah" });

  const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
  if (!ALLOWED.has(req.file.mimetype)) {
    return res.status(400).json({ message: "Hanya format JPG, PNG, WEBP yang didukung" });
  }

  try {
    const openai = getOpenAI();
    const imageData = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Kamu adalah sistem OCR untuk dokumen pajak Indonesia (kartu NPWP, sertifikat NPWP, atau dokumen NIB dari OSS).
Ekstrak semua informasi yang ada dalam dokumen ini dan kembalikan HANYA sebagai JSON valid tanpa penjelasan tambahan:
{
  "npwp": "Nomor NPWP (format: 000.000.000.0-000.000 atau string mentah, atau null)",
  "npwp_status": "Status NPWP: 'Aktif' atau 'Non-Aktif' atau null",
  "nib": "Nomor Induk Berusaha (NIB) jika ada, atau null",
  "nama_wp": "Nama Wajib Pajak / nama perusahaan dari dokumen (atau null)",
  "kegiatan_utama": "Deskripsi kegiatan usaha utama (atau null)",
  "jenis_wajib_pajak": "Jenis WP: 'Badan', 'Orang Pribadi', atau null",
  "bentuk_badan_hukum": "Bentuk badan hukum: PT, CV, Firma, dll (atau null)",
  "tanggal_terdaftar": "Tanggal terdaftar (format teks seperti '30 Mei 2018', atau null)",
  "tanggal_aktivasi": "Tanggal aktivasi (format teks, atau null)",
  "status_pkp": true/false/null berdasarkan apakah ada tanda PKP aktif,
  "tanggal_pkp": "Tanggal pengukuhan PKP (teks, atau null)",
  "kanwil_djp": "Kantor Wilayah DJP lengkap (atau null)",
  "kpp_terdaftar": "Kantor Pelayanan Pajak (KPP) lengkap (atau null)",
  "seksi_pengawasan": "Seksi pengawasan (atau null)",
  "tanggal_pembaruan_profil": "Tanggal pembaruan profil (teks, atau null)",
  "kode_klu": "Kode KLU 5 digit (atau null)",
  "deskripsi_klu": "Deskripsi KLU (atau null)",
  "kode_wilayah": "Kode wilayah (atau null)",
  "alamat": "Alamat lengkap dari dokumen (atau null)",
  "confidence": angka 0-100 tingkat kepercayaan ekstraksi
}`,
          },
          {
            type: "image_url",
            image_url: { url: imageData, detail: "high" },
          },
        ],
      }],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let extracted: Record<string, any> = {};
    try { extracted = JSON.parse(cleaned); } catch { extracted = { confidence: 0 }; }

    logger.info({ companyId: req.params.id, confidence: extracted.confidence }, "[companies] NPWP OCR selesai");
    return res.json({ success: true, data: extracted });
  } catch (err: any) {
    logger.error({ err }, "[companies] NPWP OCR gagal");
    return res.status(500).json({ message: "OCR gagal. Pastikan gambar jelas dan coba lagi.", detail: String(err?.message ?? err) });
  }
});

// ─── Legal Documents ──────────────────────────────────────────────────────────

// GET /companies/:id/documents
router.get("/:id/documents", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  try {
    const docs = await db
      .select()
      .from(companyLegalDocumentsTable)
      .where(eq(companyLegalDocumentsTable.companyId, id))
      .orderBy(companyLegalDocumentsTable.createdAt);
    return res.json(docs.map(d => ({ ...d, createdAt: d.createdAt.toISOString() })));
  } catch (err: any) {
    return res.status(500).json({ message: "Gagal memuat dokumen", detail: String(err?.message ?? err) });
  }
});

// POST /companies/:id/documents
router.post("/:id/documents", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = Number(req.params.id);
  if (Number.isNaN(companyId)) return res.status(400).json({ message: "Invalid id" });
  const { docType, docName, fileUrl, fileSize, mimeType, notes } = req.body ?? {};
  if (!docType || !docName || !fileUrl) return res.status(400).json({ message: "docType, docName, fileUrl wajib diisi" });
  if (!ALL_LEGAL_DOC_TYPES.includes(docType)) return res.status(400).json({ message: `docType tidak valid. Pilihan: ${ALL_LEGAL_DOC_TYPES.join(", ")}` });
  const userId = (req.user as any)?.id ?? null;
  try {
    const [doc] = await db.insert(companyLegalDocumentsTable).values({
      companyId, docType, docName, fileUrl,
      fileSize: fileSize ? Number(fileSize) : null,
      mimeType: mimeType ?? null,
      notes: notes ?? null,
      uploadedBy: userId,
    }).returning();
    return res.status(201).json({ ...doc, createdAt: doc.createdAt.toISOString() });
  } catch (err: any) {
    return res.status(500).json({ message: "Gagal menyimpan dokumen", detail: String(err?.message ?? err) });
  }
});

// GET /companies/:id/documents/download-zip
router.get("/:id/documents/download-zip", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const companyId = Number(req.params.id);
  if (Number.isNaN(companyId)) return res.status(400).json({ message: "Invalid id" });
  try {
    const docs = await db
      .select()
      .from(companyLegalDocumentsTable)
      .where(eq(companyLegalDocumentsTable.companyId, companyId))
      .orderBy(companyLegalDocumentsTable.createdAt);

    if (docs.length === 0) return res.status(404).json({ message: "Tidak ada dokumen untuk di-download" });

    const storage = new ObjectStorageService();
    const DOC_TYPE_LABELS: Record<string, string> = {
      akta_pendirian: "Akta Pendirian", akta_perubahan: "Akta Perubahan",
      sk_kumham: "SK Kemenkumham", nib_doc: "NIB", siup: "SIUP", tdp: "TDP",
      skdp: "SKDP", izin_usaha: "Izin Usaha", domisili: "Domisili",
      sppkp: "SPPKP", lainnya: "Lainnya",
    };

    const companyName = (await db.select({ name: (companiesTable as any).name ?? (companiesTable as any).company_name })
      .from(companiesTable).where(eq(companiesTable.id, companyId)))[0]?.name ?? `Company_${companyId}`;

    const safeName = companyName.replace(/[^a-zA-Z0-9\-_]/g, "_");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="Dokumen_Legal_${safeName}.zip"`);

    const zip = (archiver as unknown as (format: string, options?: unknown) => any)("zip", { zlib: { level: 6 } });
    zip.on("error", (err: unknown) => { logger.error({ err }, "ZIP stream error"); res.end(); });
    zip.pipe(res);

    for (const doc of docs) {
      try {
        const fileHandle = await storage.getObjectEntityFile(doc.fileUrl);
        const response = await storage.downloadObject(fileHandle);
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = doc.fileUrl.split(".").pop() ?? "bin";
        const folder = DOC_TYPE_LABELS[doc.docType] ?? doc.docType;
        const safDocName = doc.docName.replace(/[^a-zA-Z0-9\-_. ]/g, "_");
        zip.append(buffer, { name: `${folder}/${safDocName}.${ext}` });
      } catch (err) {
        logger.warn({ err, docId: doc.id }, "Skipping doc in ZIP (download failed)");
      }
    }

    await zip.finalize();
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ message: "Gagal membuat ZIP", detail: String(err?.message ?? err) });
  }
});

// DELETE /companies/:id/documents/:docId
router.delete("/:id/documents/:docId", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = Number(req.params.id);
  const docId = Number(req.params.docId);
  if (Number.isNaN(companyId) || Number.isNaN(docId)) return res.status(400).json({ message: "Invalid id" });
  try {
    const [doc] = await db.select().from(companyLegalDocumentsTable).where(eq(companyLegalDocumentsTable.id, docId));
    if (!doc || doc.companyId !== companyId) return res.status(404).json({ message: "Dokumen tidak ditemukan" });
    await db.delete(companyLegalDocumentsTable).where(eq(companyLegalDocumentsTable.id, docId));
    if (doc.fileUrl) deleteFromSupabase(doc.fileUrl).catch(() => {});
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: "Gagal hapus dokumen", detail: String(err?.message ?? err) });
  }
});

export default router;
