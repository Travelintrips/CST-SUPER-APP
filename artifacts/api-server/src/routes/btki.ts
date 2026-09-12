import { Router, Request, Response } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { btkiTariffTable } from "@workspace/db";
import { ilike, eq, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { importBtkiFromCsv } from "../lib/btkiCsvImport.js";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();

// Multer — memory storage, CSV only, max 50 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file CSV yang diperbolehkan"));
    }
  },
});

// GET /api/btki/search?q=<hs_or_keyword>&limit=20
router.get("/search", async (req: Request, res: Response) => {
  const q = String(req.query["q"] ?? "").trim();
  const limit = Math.min(Number(req.query["limit"] ?? 20), 50);

  if (!q || q.length < 2) {
    res.status(400).json({ error: "Parameter q minimal 2 karakter" });
    return;
  }

  try {
    const isHsCode = /^[\d.]+$/.test(q);

    const rows = await db
      .select()
      .from(btkiTariffTable)
      .where(
        isHsCode
          ? or(
              ilike(btkiTariffTable.hsCode, `${q}%`),
              ilike(btkiTariffTable.hsCode6, `${q.replace(/\./g, "").slice(0, 6)}%`),
              ilike(btkiTariffTable.hsCode4, `${q.replace(/\./g, "").slice(0, 4)}%`),
            )
          : or(
              ilike(btkiTariffTable.descriptionId, `%${q}%`),
              ilike(btkiTariffTable.descriptionEn, `%${q}%`),
              ilike(btkiTariffTable.category, `%${q}%`),
            )
      )
      .limit(limit);

    res.json({
      query: q,
      total: rows.length,
      results: rows.map(formatRow),
    });
  } catch (err) {
    logger.error({ err }, "BTKI search error");
    res.status(500).json({ error: "Gagal mencari data BTKI" });
  }
});

// GET /api/btki/count — dataset statistics
router.get("/count", async (_req: Request, res: Response) => {
  try {
    const [row] = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        lastUpdated: sql<string>`MAX(${btkiTariffTable.updatedAt})::text`,
        chapters: sql<number>`COUNT(DISTINCT ${btkiTariffTable.hsCode2})::int`,
      })
      .from(btkiTariffTable);

    res.json({
      total: row?.total ?? 0,
      chapters: row?.chapters ?? 0,
      lastUpdated: row?.lastUpdated ?? null,
      source: "BTKI 2022 — Buku Tarif Kepabeanan Indonesia (Kemenkeu RI)",
    });
  } catch (err) {
    logger.error({ err }, "BTKI count error");
    res.status(500).json({ error: "Gagal mengambil statistik BTKI" });
  }
});

// GET /api/btki/:hsCode — exact lookup
router.get("/:hsCode", async (req: Request, res: Response) => {
  const raw = String(req.params["hsCode"] ?? "").trim();
  const hsNorm = raw.replace(/\./g, "");
  const hsFormatted = formatHsCode(raw);

  try {
    const [row] = await db
      .select()
      .from(btkiTariffTable)
      .where(
        or(
          eq(btkiTariffTable.hsCode, hsFormatted),
          eq(btkiTariffTable.hsCode, raw),
          sql`REPLACE(${btkiTariffTable.hsCode}, '.', '') = ${hsNorm}`,
        )
      )
      .limit(1);

    if (!row) {
      const related = await db
        .select()
        .from(btkiTariffTable)
        .where(
          or(
            ilike(btkiTariffTable.hsCode6, `${hsNorm.slice(0, 6)}%`),
            ilike(btkiTariffTable.hsCode4, `${hsNorm.slice(0, 4)}%`),
          )
        )
        .limit(5);

      res.status(404).json({
        error: `HS Code ${raw} tidak ditemukan dalam database BTKI lokal`,
        hint: "Coba cari dengan 4-6 digit pertama atau gunakan /api/btki/search?q=",
        related: related.map(formatRow),
        inswLink: `https://www.insw.go.id/intr/tariff-search?hs=${hsNorm}`,
        btkiLink: `https://btki.kemenkeu.go.id/`,
      });
      return;
    }

    res.json(formatRow(row));
  } catch (err) {
    logger.error({ err }, "BTKI lookup error");
    res.status(500).json({ error: "Gagal memuat data BTKI" });
  }
});

// POST /api/btki/import-csv — upload CSV, seed/update Supabase (admin only)
router.post("/import-csv", upload.single("file"), async (req: Request, res: Response) => {
  if (!await requireAdmin(req, res)) return;

  const dryRun = req.query["dry_run"] === "true" || req.body?.dry_run === true;

  if (!req.file) {
    res.status(400).json({ error: "Tidak ada file CSV yang diupload. Gunakan field name 'file'." });
    return;
  }

  const csvText = req.file.buffer.toString("utf-8");

  try {
    logger.info({ size: req.file.size, dryRun }, "[btki-import] CSV upload received");
    const result = await importBtkiFromCsv(csvText, { dryRun });
    res.json({
      ok: true,
      dryRun,
      ...result,
      message: dryRun
        ? `Dry-run selesai: ${result.total} baris divalidasi, ${result.failed} gagal`
        : `Import selesai: ${result.inserted} inserted, ${result.updated} updated, ${result.failed} gagal`,
    });
  } catch (err) {
    logger.error({ err }, "[btki-import] Import failed");
    res.status(400).json({ error: String(err) });
  }
});

// ─── Formatter ────────────────────────────────────────────────────────────────

function formatRow(row: typeof btkiTariffTable.$inferSelect) {
  const pref: Record<string, string | null> = {};
  if (row.bmAcfta !== null)  pref["ACFTA (China)"]     = pct(row.bmAcfta);
  if (row.bmAfta !== null)   pref["AFTA (ASEAN)"]       = pct(row.bmAfta);
  if (row.bmAifta !== null)  pref["AIFTA (India)"]      = pct(row.bmAifta);
  if (row.bmAanzfta !== null) pref["AANZFTA (Aus/NZ)"] = pct(row.bmAanzfta);
  if (row.bmAhkfta !== null) pref["AHKFTA (HK)"]        = pct(row.bmAhkfta);
  if (row.bmAsfta !== null)  pref["ASFTA (Swiss)"]      = pct(row.bmAsfta);
  if (row.bmAkfta !== null)  pref["AKFTA (Korea)"]      = pct(row.bmAkfta);

  return {
    hsCode:          row.hsCode,
    descriptionId:   row.descriptionId,
    descriptionEn:   row.descriptionEn,
    unit:            row.unit,
    category:        row.category,
    tariff: {
      bmMfn:         pct(row.bmMfn),
      preferensial:  pref,
      ppn:           pct(row.ppnRate),
      ppnbm:         pct(row.ppnbmRate),
      pph22Api:      pct(row.pph22Rate),
      pph22NonApi:   pct(row.pph22NonApi),
      totalImportTaxNote: `BM MFN ${pct(row.bmMfn)} + PPN ${pct(row.ppnRate)} + PPh22 ${pct(row.pph22Rate)} (API)`,
    },
    lartas: {
      import: row.lartasImport,
      export: row.lartasExport,
      description: row.lartasDesc,
      regulatorImport: row.regulatorImport,
      regulatorExport: row.regulatorExport,
      perizinanImport: row.perizinanImport,
      perizinanExport: row.perizinanExport,
    },
    notes:    row.notes,
    source:   row.source ?? "BTKI 2022 — Buku Tarif Kepabeanan Indonesia (Kemenkeu RI)",
    btkiVersion: row.btkiVersion ?? "2022",
    fta: {
      flag: row.ftaFlag ?? false,
      preferensial: pref,
    },
    dutyExport:       row.dutyExport !== null ? pct(row.dutyExport) : null,
    exportDutyActual: row.exportDutyActual !== null ? pct(row.exportDutyActual) : null,
    royaltyRate:      row.royaltyRate !== null ? pct(row.royaltyRate) : null,
    inswLink: `https://www.insw.go.id/intr`,
    btkiLink: `https://btki.kemenkeu.go.id/`,
    updatedAt: row.updatedAt,
  };
}

function pct(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return `${Number(val)}%`;
}

function formatHsCode(raw: string): string {
  const digits = raw.replace(/\./g, "");
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
}

export default router;
