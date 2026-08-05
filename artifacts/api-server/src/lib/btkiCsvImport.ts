import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * CSV Import handler for official BTKI 2022 data from Kemenkeu RI.
 *
 * Expected CSV columns (from btki.kemenkeu.go.id export):
 *   hs_code, description_id, description_en, unit, bm_mfn, bm_acfta, bm_afta,
 *   bm_aifta, bm_aanzfta, bm_ahkfta, bm_asfta, bm_akfta, ppn_rate, ppnbm_rate,
 *   pph22_rate, lartas_import, lartas_export, lartas_desc, regulator_import,
 *   regulator_export, notes, category
 *
 * Delimiter: comma (,) — encoding: UTF-8
 */

export type CsvImportResult = {
  total: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
};

export async function importBtkiFromCsv(
  csvText: string,
  opts: { dryRun?: boolean } = {}
): Promise<CsvImportResult> {
  const result: CsvImportResult = { total: 0, inserted: 0, updated: 0, failed: 0, errors: [] };
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  // Parse header
  const headers = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  logger.info({ headers }, "[btki-import] CSV headers detected");

  // Validate required columns
  const required = ["hs_code", "description_id", "bm_mfn"];
  for (const col of required) {
    if (!headers.includes(col)) {
      throw new Error(`CSV missing required column: ${col}. Found: ${headers.join(", ")}`);
    }
  }

  function col(row: string[], name: string): string {
    const idx = headers.indexOf(name);
    return idx >= 0 ? (row[idx] ?? "").trim() : "";
  }

  function numOrNull(v: string): number | null {
    const n = parseFloat(v.replace(",", ".").replace("%", ""));
    return isNaN(n) ? null : n;
  }

  function boolVal(v: string): boolean {
    const lower = v.toLowerCase();
    return lower === "true" || lower === "ya" || lower === "yes" || lower === "1";
  }

  // Process data rows
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]!);
    result.total++;

    const hsCode = col(row, "hs_code").replace(/\s/g, "");
    if (!hsCode) {
      result.errors.push(`Row ${i + 1}: empty hs_code`);
      result.failed++;
      continue;
    }

    // Normalize hs_code format (e.g. 01012100 → 0101.21.00)
    const hsNorm = normalizeHsCode(hsCode);
    const hs = hsNorm.replace(/\./g, "");
    const hs6 = hs.slice(0, 6);
    const hs4 = hs.slice(0, 4);
    const hs2 = hs.slice(0, 2);

    const descId = col(row, "description_id") || col(row, "deskripsi_id") || col(row, "uraian") || col(row, "description");
    const descEn = col(row, "description_en") || col(row, "deskripsi_en") || null;
    const unit = col(row, "unit") || col(row, "satuan") || null;
    const bmMfn = numOrNull(col(row, "bm_mfn") || col(row, "bea_masuk") || "0") ?? 0;
    const bmAcfta = numOrNull(col(row, "bm_acfta"));
    const bmAfta = numOrNull(col(row, "bm_afta"));
    const bmAifta = numOrNull(col(row, "bm_aifta"));
    const bmAanzfta = numOrNull(col(row, "bm_aanzfta"));
    const bmAhkfta = numOrNull(col(row, "bm_ahkfta"));
    const ppnRate = numOrNull(col(row, "ppn_rate") || col(row, "ppn")) ?? 11;
    const ppnbmRate = numOrNull(col(row, "ppnbm_rate") || col(row, "ppnbm")) ?? 0;
    const pph22Rate = numOrNull(col(row, "pph22_rate") || col(row, "pph_22")) ?? 2.5;
    const lartasImport = boolVal(col(row, "lartas_import") || col(row, "lartas"));
    const lartasExport = boolVal(col(row, "lartas_export"));
    const lartasDesc = col(row, "lartas_desc") || col(row, "lartas_keterangan") || null;
    const regulatorImport = col(row, "regulator_import") || col(row, "regulator") || null;
    const regulatorExport = col(row, "regulator_export") || null;
    const notes = col(row, "notes") || col(row, "catatan") || null;
    const category = col(row, "category") || col(row, "kategori") || col(row, "chapter_name") || "Umum";

    // New spec columns
    const dutyExport = numOrNull(col(row, "duty_export") || col(row, "bea_keluar") || "");
    const exportDutyActual = numOrNull(col(row, "export_duty_actual") || "");
    const royaltyRate = numOrNull(col(row, "royalty_rate") || col(row, "royalti") || "");
    const ftaFlag = boolVal(col(row, "fta_flag") || col(row, "fta") || "");
    const btkiVersion = col(row, "btki_version") || col(row, "versi") || "2022";
    const source = col(row, "source") || col(row, "sumber") || "BTKI 2022";

    if (!descId) {
      result.errors.push(`Row ${i + 1}: hs_code=${hsNorm} — empty description_id`);
      result.failed++;
      continue;
    }

    if (opts.dryRun) {
      result.inserted++;
      continue;
    }

    try {
      const existing = await db.execute(sql`
        SELECT id FROM btki_tariff WHERE hs_code = ${hsNorm} LIMIT 1
      `);
      const isUpdate = existing.rows.length > 0;

      await db.execute(sql`
        INSERT INTO btki_tariff (
          hs_code, hs_code_6, hs_code_4, hs_code_2,
          description_id, description_en, unit,
          bm_mfn, bm_acfta, bm_afta, bm_aifta, bm_aanzfta, bm_ahkfta,
          ppn_rate, ppnbm_rate, pph22_rate, pph22_non_api,
          lartas_import, lartas_export, lartas_desc,
          regulator_import, regulator_export,
          notes, category,
          duty_export, export_duty_actual, royalty_rate, fta_flag, btki_version, source
        ) VALUES (
          ${hsNorm}, ${hs6}, ${hs4}, ${hs2},
          ${descId}, ${descEn}, ${unit},
          ${bmMfn}, ${bmAcfta}, ${bmAfta}, ${bmAifta}, ${bmAanzfta}, ${bmAhkfta},
          ${ppnRate}, ${ppnbmRate}, ${pph22Rate}, 7.5,
          ${lartasImport}, ${lartasExport}, ${lartasDesc},
          ${regulatorImport}, ${regulatorExport},
          ${notes}, ${category},
          ${dutyExport}, ${exportDutyActual}, ${royaltyRate}, ${ftaFlag}, ${btkiVersion}, ${source}
        )
        ON CONFLICT (hs_code) DO UPDATE SET
          description_id    = EXCLUDED.description_id,
          description_en    = EXCLUDED.description_en,
          unit              = EXCLUDED.unit,
          bm_mfn            = EXCLUDED.bm_mfn,
          bm_acfta          = EXCLUDED.bm_acfta,
          bm_afta           = EXCLUDED.bm_afta,
          bm_aifta          = EXCLUDED.bm_aifta,
          bm_aanzfta        = EXCLUDED.bm_aanzfta,
          bm_ahkfta         = EXCLUDED.bm_ahkfta,
          ppn_rate          = EXCLUDED.ppn_rate,
          ppnbm_rate        = EXCLUDED.ppnbm_rate,
          pph22_rate        = EXCLUDED.pph22_rate,
          lartas_import     = EXCLUDED.lartas_import,
          lartas_export     = EXCLUDED.lartas_export,
          lartas_desc       = EXCLUDED.lartas_desc,
          regulator_import  = EXCLUDED.regulator_import,
          regulator_export  = EXCLUDED.regulator_export,
          notes             = EXCLUDED.notes,
          category          = EXCLUDED.category,
          duty_export       = EXCLUDED.duty_export,
          export_duty_actual= EXCLUDED.export_duty_actual,
          royalty_rate      = EXCLUDED.royalty_rate,
          fta_flag          = EXCLUDED.fta_flag,
          btki_version      = EXCLUDED.btki_version,
          source            = EXCLUDED.source,
          updated_at        = NOW()
      `);

      if (isUpdate) result.updated++;
      else result.inserted++;
    } catch (e) {
      const msg = `Row ${i + 1}: hs_code=${hsNorm} — ${String(e)}`;
      logger.warn({ err: String(e), hs_code: hsNorm }, "[btki-import] row failed");
      result.errors.push(msg);
      result.failed++;
    }
  }

  logger.info(result, "[btki-import] CSV import complete");
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a single CSV line, handling quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Normalize raw HS code digits to formatted string e.g. "01012100" → "0101.21.00" */
function normalizeHsCode(raw: string): string {
  const digits = raw.replace(/\./g, "").replace(/[^0-9]/g, "");
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}.${digits.slice(4)}`;
  if (digits.length <= 8) return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
}
