/**
 * sheetSyncService.ts
 *
 * Multi-company Google Sheet → bank_mutations auto-sync pipeline.
 *
 * Mode 1 (legacy): GOOGLE_SHEET_ID_BANK_MUTATIONS env var → satu sheet global
 * Mode 2 (multi):  bank_sheet_configs table → N sheet per company
 *
 * Config:
 *   GOOGLE_SERVICE_ACCOUNT_JSON      — Service Account JSON key (wajib)
 *   GOOGLE_SHEET_ID_BANK_MUTATIONS   — (opsional, legacy fallback)
 *   GOOGLE_SHEET_MUTATIONS_TAB       — Tab default legacy (default: "Mutasi_Bank")
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { readSheet, batchUpdateSheet, ensureSheets, clearAndWriteSheet, formatRowsColor, type RowColor } from "./googleSheets.js";
import { runUnifiedMatching } from "./reconciliation/unifiedMatchingEngine.js";
import { logger } from "./logger.js";
import { canonicalMutationKey, canonicalNormalizeDesc } from "./reconciliation/canonicalMutationKey.js";

// ── Config ────────────────────────────────────────────────────────────────────

const LEGACY_SHEET_ID = () => process.env.GOOGLE_SHEET_ID_BANK_MUTATIONS ?? "";
const LEGACY_TAB      = () => process.env.GOOGLE_SHEET_MUTATIONS_TAB ?? "Mutasi_Bank";
const SYNC_MS         = 60_000;

const COL_MUTATION_KEY = "mutation_key";
const COL_STATUS_REKON = "status_rekon";
const COL_MATCH_SCORE  = "match_score";
const COL_MATCH_RESULT = "match_result";
const COL_LAST_SYNC_AT = "last_sync_at";
const COL_NAMA         = "nama_customer";
const COL_REFERENSI    = "nomor_referensi";
const COL_KATEGORI     = "kategori";
const COL_PERUSAHAAN   = "nama_perusahaan";
const COL_FASILITAS    = "fasilitas";

// ── Helpers ───────────────────────────────────────────────────────────────────

// canonicalNormalizeDesc is re-exported from canonicalMutationKey — do NOT duplicate here.
// All description normalization must use the canonical version for cross-source key parity.

function parseAmt(val: unknown): number {
  if (!val && val !== 0) return 0;
  const s = String(val).replace(/[^0-9.,\-]/g, "").replace(/\./g, "").replace(",", ".");
  return Math.abs(parseFloat(s) || 0);
}

function detectProvider(d: string): string | null {
  const u = d.toUpperCase();
  if (u.includes("GOPAY") || u.includes("GOJEK")) return "GOPAY";
  if (u.includes("OVO"))    return "OVO";
  if (u.includes("DANA"))   return "DANA";
  if (u.includes("LINKAJA") || u.includes("LINK AJA")) return "LINKAJA";
  if (u.includes("SHOPEE")) return "SHOPEEPAY";
  if (u.includes("QRIS"))   return "QRIS";
  return null;
}

function colLetter(idx: number): string {
  let s = "";
  let n = idx + 1;
  while (n > 0) {
    s = String.fromCharCode(64 + (n % 26 || 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ── Row type ──────────────────────────────────────────────────────────────────

interface ParsedRow {
  rowIndex: number;
  transaction_date: string;
  description: string;
  debit: number;
  kredit: number;
  amount: number;
  direction: "IN" | "OUT";
  mutation_key: string;
  normalized_description: string;
  provider_name: string | null;
  bank: string | null;
}

const ID_MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, ags: 8,
  sep: 9, okt: 10, nov: 11, des: 12,
};

function parseIndonesianDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // 1. Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // 2. M/D/YYYY (Google Sheets default US locale: 6/9/2026 = June 9, 2026)
  //    Must come BEFORE DD/MM/YYYY to handle Google Sheets "/" separator correctly
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(date.getTime())) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 3. DD-MM-YYYY (Indonesian format with dash separator)
  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(date.getTime())) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 4. "26 Juni 2026" or "26-Juni-2026"
  const textDmy = s.match(/^(\d{1,2})[\s\-]([a-zA-Z]+)[\s\-](\d{4})$/);
  if (textDmy) {
    const [, d, monthStr, y] = textDmy;
    const m = ID_MONTHS[monthStr.toLowerCase()];
    if (m) return `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 5. "Juni 26, 2026" or "Juni 26 2026"
  const textMdy = s.match(/^([a-zA-Z]+)\s+(\d{1,2})[,\s]+(\d{4})$/);
  if (textMdy) {
    const [, monthStr, d, y] = textMdy;
    const m = ID_MONTHS[monthStr.toLowerCase()];
    if (m) return `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 6. Google Sheets serial number (e.g. "46205")
  const serial = Number(s);
  if (!isNaN(serial) && Number.isInteger(serial) && serial > 1000 && serial < 100000) {
    const result = sheetSerialToDate(serial);
    if (result) return result;
  }

  // 7. Fallback: native Date parser (handles ISO variants)
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];

  return null;
}

// Handle Google Sheets serial date numbers (days since Dec 30, 1899)
function sheetSerialToDate(serial: number): string | null {
  if (serial < 1 || serial > 99999) return null;
  const msPerDay = 86400000;
  // Google Sheets epoch: Dec 30, 1899
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(epoch.getTime() + serial * msPerDay);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function parseSheetRows(rows: string[][], logLabel = ""): { headers: string[]; parsed: ParsedRow[] } {
  if (rows.length < 2) return { headers: [], parsed: [] };

  const rawHeaders = rows[0].map((h) => String(h ?? "").trim());
  logger.info({ label: logLabel, headers: rawHeaders }, "[sheetSync] Header kolom sheet");

  // Collect sample data rows for smart detection
  const sampleRows = rows.slice(1, Math.min(6, rows.length));

  const colIdx = (candidates: string[]) => {
    for (const c of candidates) {
      const i = rawHeaders.findIndex((h) => h.toLowerCase() === c.toLowerCase());
      if (i >= 0) return i;
    }
    for (const c of candidates) {
      const i = rawHeaders.findIndex((h) => h.toLowerCase().includes(c.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };

  // Smart date column: pick candidate whose sample values actually parse as dates
  const findDateColSmart = (): number => {
    const dateCandidates = ["tanggal", "tgl", "date", "id", "waktu", "time", "tgltransaksi"];
    const checked = new Set<number>();
    const tryList: number[] = [];
    for (const c of dateCandidates) {
      const i = rawHeaders.findIndex((h) => h.toLowerCase() === c.toLowerCase());
      if (i >= 0 && !checked.has(i)) { checked.add(i); tryList.push(i); }
    }
    for (const c of dateCandidates) {
      const i = rawHeaders.findIndex((h) => h.toLowerCase().includes(c.toLowerCase()));
      if (i >= 0 && !checked.has(i)) { checked.add(i); tryList.push(i); }
    }
    let bestIdx = -1;
    let bestScore = 0;
    for (const ci of tryList) {
      let score = 0;
      for (const r of sampleRows) {
        const val = String(r[ci] ?? "").trim();
        if (val && parseIndonesianDate(val)) score++;
      }
      if (score > bestScore) { bestScore = score; bestIdx = ci; }
    }
    return bestIdx;
  };

  // Smart description column: among text candidates, pick the one with longest average value (narasi)
  const findDescColSmart = (excludeCol: number): number => {
    const descCandidates = ["keterangan", "narasi", "ket", "description", "desc", "berita", "remark", "info", "tanggal", "tgl"];
    const checked = new Set<number>();
    const tryList: number[] = [];
    for (const c of descCandidates) {
      const i = rawHeaders.findIndex((h) => h.toLowerCase() === c.toLowerCase());
      if (i >= 0 && i !== excludeCol && !checked.has(i)) { checked.add(i); tryList.push(i); }
    }
    for (const c of descCandidates) {
      const i = rawHeaders.findIndex((h) => h.toLowerCase().includes(c.toLowerCase()));
      if (i >= 0 && i !== excludeCol && !checked.has(i)) { checked.add(i); tryList.push(i); }
    }
    let bestIdx = -1;
    let bestAvgLen = 0;
    for (const ci of tryList) {
      const lengths = sampleRows.map((r) => String(r[ci] ?? "").trim().length).filter((l) => l > 1);
      const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
      if (avg > bestAvgLen) { bestAvgLen = avg; bestIdx = ci; }
    }
    return bestIdx;
  };

  const dateCol   = findDateColSmart();
  const descCol   = findDescColSmart(dateCol);
  const kreditCol = colIdx(["kredit", "credit", "masuk", "cr", "jumlah masuk"]);
  const debitCol  = colIdx(["debit", "keluar", "db", "out", "jumlah keluar"]);
  const bankCol   = colIdx(["bank", "rekening", "akun"]);

  logger.info(
    { label: logLabel, dateCol, descCol, kreditCol, debitCol, bankCol,
      dateName: dateCol >= 0 ? rawHeaders[dateCol] : "NOT FOUND",
      descName: descCol >= 0 ? rawHeaders[descCol] : "NOT FOUND",
      kreditName: kreditCol >= 0 ? rawHeaders[kreditCol] : "NOT FOUND",
      debitName: debitCol >= 0 ? rawHeaders[debitCol] : "NOT FOUND",
    },
    "[sheetSync] Mapping kolom"
  );

  const parsed: ParsedRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !c?.trim())) continue;

    const get = (idx: number) => (idx >= 0 ? String(row[idx] ?? "").trim() : "");

    const rawDate = get(dateCol);
    if (!rawDate) continue;

    let parsedDate = parseIndonesianDate(rawDate);
    if (!parsedDate) continue; // skip row if date unparseable

    const kreditAmt = parseAmt(get(kreditCol));
    const debitAmt  = parseAmt(get(debitCol));
    const amount    = kreditAmt || debitAmt;
    if (!amount) continue;

    // Konvensi akuntansi standar: Debit = uang masuk ke rekening (IN), Kredit = uang keluar (OUT)
    const direction: "IN" | "OUT" = debitAmt > 0 ? "IN" : "OUT";
    const description = get(descCol);
    const bank        = bankCol >= 0 ? (get(bankCol) || null) : null;
    // Use canonical key — same algorithm as CSV/Excel so cross-source dedup works.
    const mutation_key = canonicalMutationKey({
      transaction_date: parsedDate,
      debit:  debitAmt,
      credit: kreditAmt,
      description,
      company_id:      null, // overridden with cfg.company_id at insert time
      bank_account_id: null,
    });

    parsed.push({
      rowIndex: i + 1,
      transaction_date: parsedDate,
      description,
      debit: debitAmt,
      kredit: kreditAmt,
      amount,
      direction,
      mutation_key,
      normalized_description: canonicalNormalizeDesc(description),
      provider_name: detectProvider(description),
      bank,
    });
  }

  return { headers: rawHeaders, parsed };
}

type ColIndexMap = {
  mutationKeyIdx: number;
  statusIdx: number;
  scoreIdx: number;
  resultIdx: number;
  lastSyncIdx: number;
  namaIdx: number;
  referensiIdx: number;
  kategoriIdx: number;
  perusahaanIdx: number;
  fasilitasIdx: number;
};

async function ensureSystemColumns(
  sheetId: string,
  tabName: string,
  headers: string[],
): Promise<ColIndexMap> {
  const updates: Array<{ range: string; values: string[][] }> = [];

  const ensure = (colName: string): number => {
    let idx = headers.findIndex((h) => h === colName);
    if (idx < 0) {
      idx = headers.length;
      headers.push(colName);
      updates.push({ range: `'${tabName}'!${colLetter(idx)}1`, values: [[colName]] });
    }
    return idx;
  };

  const mutationKeyIdx = ensure(COL_MUTATION_KEY);
  const statusIdx      = ensure(COL_STATUS_REKON);
  const scoreIdx       = ensure(COL_MATCH_SCORE);
  const resultIdx      = ensure(COL_MATCH_RESULT);
  const lastSyncIdx    = ensure(COL_LAST_SYNC_AT);
  const namaIdx        = ensure(COL_NAMA);
  const referensiIdx   = ensure(COL_REFERENSI);
  const kategoriIdx    = ensure(COL_KATEGORI);
  const perusahaanIdx  = ensure(COL_PERUSAHAAN);
  const fasilitasIdx   = ensure(COL_FASILITAS);

  if (updates.length > 0) {
    await batchUpdateSheet(sheetId, updates);
    logger.info({ sheetId, tabName, added: updates.length }, "[sheetSync] Header kolom system ditambahkan");
  }

  return { mutationKeyIdx, statusIdx, scoreIdx, resultIdx, lastSyncIdx, namaIdx, referensiIdx, kategoriIdx, perusahaanIdx, fasilitasIdx };
}

function kategoriLabel(type: string): string {
  switch (type) {
    case "logistic_order":     return "Logistik";
    case "accounting_payment": return "Pembayaran";
    case "invoice":            return "Invoice";
    case "expense":            return "Pengeluaran";
    case "sport_payment":      return "Sport Center";
    case "tenant_invoice":     return "Sewa Tenant";
    default:                   return type ?? "";
  }
}

// ── Core sync for a single sheet config ───────────────────────────────────────

interface SheetConfig {
  id: number;
  company_id: number | null;
  sheet_id: string;
  tab_name: string;
  label: string;
}

export async function syncOneConfig(cfg: SheetConfig): Promise<{
  imported: number;
  total: number;
}> {
  const { id: configId, company_id, sheet_id: sheetId, tab_name: tabName, label } = cfg;
  const syncStartMs = Date.now();

  // Read sheet
  let rows: string[][];
  try {
    rows = await readSheet(sheetId, tabName);
  } catch (err: any) {
    // Update status in DB
    const errMsg = String(err?.message ?? err).slice(0, 500).replace(/'/g, "''");
    await db.execute(sql.raw(`
      UPDATE bank_sheet_configs
      SET last_sync_status = 'error', last_sync_error = '${errMsg}', last_synced_at = NOW(), updated_at = NOW()
      WHERE id = ${configId}
    `)).catch(() => {});
    throw err;
  }

  const { headers, parsed } = parseSheetRows(rows, label);
  if (parsed.length === 0) {
    await db.execute(sql.raw(`
      UPDATE bank_sheet_configs
      SET last_sync_status = 'ok', last_sync_error = NULL, last_synced_at = NOW(), updated_at = NOW()
      WHERE id = ${configId}
    `)).catch(() => {});
    return { imported: 0, total: 0 };
  }

  const { mutationKeyIdx, statusIdx, scoreIdx, resultIdx, lastSyncIdx, namaIdx, referensiIdx, kategoriIdx, perusahaanIdx, fasilitasIdx } =
    await ensureSystemColumns(sheetId, tabName, headers);

  // Fetch existing keys for dedup — check BOTH mutation_key AND canonical_key
  const existingKeys = new Set<string>();
  try {
    const { rows: ekRows } = await db.execute(sql.raw(
      `SELECT mutation_key, canonical_key FROM bank_mutations WHERE sheet_config_id = ${configId}`,
    ));
    for (const r of ekRows as any[]) {
      if (r.mutation_key) existingKeys.add(r.mutation_key);
      if (r.canonical_key) existingKeys.add(r.canonical_key);
    }
  } catch {
    // Fallback: fetch all keys across the table
    const { rows: ekRows } = await db.execute(sql.raw(
      `SELECT mutation_key, canonical_key FROM bank_mutations WHERE mutation_key IS NOT NULL`,
    ));
    for (const r of ekRows as any[]) {
      if (r.mutation_key) existingKeys.add(r.mutation_key);
      if (r.canonical_key) existingKeys.add(r.canonical_key);
    }
  }

  // Insert new mutations
  const newMutations: Array<{ id: number; parsed: ParsedRow }> = [];
  const esc = (s: string) => (s ?? "").replace(/'/g, "''");

  for (const p of parsed) {
    // Compute canonical_key with the actual company_id from sheet config
    const cKey = canonicalMutationKey({
      transaction_date: p.transaction_date,
      debit:            p.debit,
      credit:           p.kredit,
      description:      p.description,
      company_id:       company_id ?? null,
      bank_account_id:  null,
    });

    // Dedup: skip if mutation_key (old format) OR canonical_key already exists
    if (existingKeys.has(p.mutation_key) || existingKeys.has(cKey)) continue;

    try {
      const { rows: ins } = await db.execute(sql.raw(`
        INSERT INTO bank_mutations
          (mutation_key, canonical_key, transaction_date, description, amount, direction,
           credit_amount, debit_amount, normalized_description, provider_name,
           status, source, source_account, company_id, sheet_config_id)
        VALUES (
          '${esc(p.mutation_key)}',
          '${esc(cKey)}',
          '${p.transaction_date}',
          '${esc(p.description)}',
          ${p.amount},
          '${p.direction}',
          ${p.kredit},
          ${p.debit},
          '${esc(p.normalized_description)}',
          ${p.provider_name ? `'${esc(p.provider_name)}'` : "NULL"},
          'unmatched',
          'google_sheet',
          ${p.bank ? `'${esc(p.bank)}'` : "NULL"},
          ${company_id ?? "NULL"},
          ${configId}
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `));

      const rowId = (ins as any[])[0]?.id;
      if (rowId) {
        existingKeys.add(p.mutation_key);
        existingKeys.add(cKey);
        newMutations.push({ id: Number(rowId), parsed: p });
      }
    } catch (err: any) {
      logger.warn({ err: err.message, key: p.mutation_key, label }, "[sheetSync] Gagal insert mutasi");
    }
  }

  // Run matching for new mutations
  for (const { id, parsed: p } of newMutations) {
    try {
      await runUnifiedMatching({
        id, amount: p.amount, transaction_date: p.transaction_date,
        mutation_key: p.mutation_key, normalized_description: p.normalized_description,
        direction: p.direction,
        company_id,
        provider_name: null,
      }, "sheet-sync");
    } catch (err: any) {
      logger.warn({ err: err.message, id }, "[sheetSync] Matching gagal (non-fatal)");
    }
  }

  // Write-back status → sheet
  const keyList = parsed.map((p) => `'${p.mutation_key.replace(/'/g, "''")}'`).join(",");
  let statusMap = new Map<string, {
    status: string;
    score: number | null;
    match_result: string;
    cand_type: string;
    is_approved: boolean;
    detail_name: string;
    detail_ref: string;
    detail_company: string;
    detail_service: string;
  }>();
  try {
    const { rows: sRows } = await db.execute(sql.raw(`
      SELECT
        bm.mutation_key,
        bm.status,
        brm_best.match_score                                              AS best_score,
        brm_cand.candidate_type || ':' || brm_cand.candidate_id          AS match_result,
        COALESCE(brm_cand.candidate_type, '')                            AS cand_type,
        COALESCE(brm_cand.is_approved, false)                            AS is_approved,
        COALESCE(
          CASE brm_cand.candidate_type
            WHEN 'logistic_order' THEN
              (SELECT COALESCE(lo.customer_name, '')
               FROM logistic_orders lo WHERE lo.id = brm_cand.candidate_id)
            WHEN 'accounting_payment' THEN
              (SELECT COALESCE(ap.partner_name, '')
               FROM accounting_payments ap
               WHERE ap.id = brm_cand.candidate_id)
            WHEN 'invoice' THEN
              (SELECT COALESCE(c.name, '')
               FROM sales_documents sd
               LEFT JOIN customers c ON c.id = sd.customer_id
               WHERE sd.id = brm_cand.candidate_id)
            WHEN 'expense' THEN
              (SELECT COALESCE(e.description, '')
               FROM expenses e WHERE e.id = brm_cand.candidate_id)
            WHEN 'sport_payment' THEN
              (SELECT COALESCE(c.name, sb.customer_name, '')
               FROM sport_payments sp
               LEFT JOIN customers c ON c.id = sp.customer_id
               LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
               WHERE sp.id = brm_cand.candidate_id)
            WHEN 'tenant_invoice' THEN
              (SELECT COALESCE(t.business_name, '')
               FROM tenant_invoices ti
               LEFT JOIN tenants t ON t.id = ti.tenant_id
               WHERE ti.id = brm_cand.candidate_id)
            ELSE NULL
          END, '') AS detail_name,
        COALESCE(
          CASE brm_cand.candidate_type
            WHEN 'logistic_order' THEN
              (SELECT order_number FROM logistic_orders WHERE id = brm_cand.candidate_id)
            WHEN 'accounting_payment' THEN
              (SELECT COALESCE(payment_number, ref, '') FROM accounting_payments WHERE id = brm_cand.candidate_id)
            WHEN 'invoice' THEN
              (SELECT doc_number FROM sales_documents WHERE id = brm_cand.candidate_id)
            WHEN 'expense' THEN
              (SELECT COALESCE(expense_number, '') FROM expenses WHERE id = brm_cand.candidate_id)
            WHEN 'sport_payment' THEN
              (SELECT 'SPORT-' || booking_id::text FROM sport_payments WHERE id = brm_cand.candidate_id)
            WHEN 'tenant_invoice' THEN
              (SELECT invoice_number FROM tenant_invoices WHERE id = brm_cand.candidate_id)
            ELSE NULL
          END, '') AS detail_ref,
        COALESCE(
          CASE brm_cand.candidate_type
            WHEN 'logistic_order' THEN
              (SELECT COALESCE(lo.company_name, '') FROM logistic_orders lo WHERE lo.id = brm_cand.candidate_id)
            WHEN 'invoice' THEN
              (SELECT COALESCE(c.company_name, '') FROM sales_documents sd LEFT JOIN customers c ON c.id = sd.customer_id WHERE sd.id = brm_cand.candidate_id)
            WHEN 'sport_payment' THEN
              (SELECT COALESCE(c.company_name, '') FROM sport_payments sp LEFT JOIN customers c ON c.id = sp.customer_id WHERE sp.id = brm_cand.candidate_id)
            ELSE NULL
          END, '') AS detail_company,
        COALESCE(
          CASE brm_cand.candidate_type
            WHEN 'logistic_order' THEN
              (SELECT TRIM(COALESCE(service_category,'') || ' ' || COALESCE(origin,'') || CASE WHEN destination IS NOT NULL THEN ' → ' || destination ELSE '' END) FROM logistic_orders WHERE id = brm_cand.candidate_id)
            WHEN 'accounting_payment' THEN
              (SELECT COALESCE(payment_type::text, '') FROM accounting_payments WHERE id = brm_cand.candidate_id)
            WHEN 'expense' THEN
              (SELECT COALESCE(description, '') FROM expenses WHERE id = brm_cand.candidate_id)
            WHEN 'sport_payment' THEN
              (SELECT COALESCE(sb.facility_name, 'Sport Center')
               FROM sport_payments sp
               LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
               WHERE sp.id = brm_cand.candidate_id)
            WHEN 'tenant_invoice' THEN 'Sewa Tenant'
            ELSE NULL
          END, '') AS detail_service
      FROM bank_mutations bm
      LEFT JOIN LATERAL (
        SELECT match_score
        FROM bank_reconciliation_matches
        WHERE mutation_id = bm.id
        ORDER BY match_score DESC LIMIT 1
      ) brm_best ON true
      LEFT JOIN LATERAL (
        -- Ambil kandidat terbaik: approved diprioritaskan, fallback ke candidate score tertinggi
        SELECT candidate_type, candidate_id,
               (status = 'approved') AS is_approved
        FROM bank_reconciliation_matches
        WHERE mutation_id = bm.id
        ORDER BY (status = 'approved') DESC, match_score DESC
        LIMIT 1
      ) brm_cand ON true
      WHERE bm.mutation_key IN (${keyList})
    `));
    for (const r of sRows as any[]) {
      statusMap.set(r.mutation_key, {
        status:       String(r.status ?? "unmatched"),
        score:        r.best_score != null ? Number(r.best_score) : null,
        match_result: String(r.match_result ?? ""),
        cand_type:    String(r.cand_type ?? ""),
        is_approved:  Boolean(r.is_approved),
        detail_name:    String(r.detail_name ?? ""),
        detail_ref:     String(r.detail_ref ?? ""),
        detail_company: String(r.detail_company ?? ""),
        detail_service: String(r.detail_service ?? ""),
      });
    }
  } catch (err: any) {
    logger.warn(
      { err: err.message, cause: err.cause?.message ?? err.cause },
      "[sheetSync] Gagal fetch status untuk write-back",
    );
  }

  const syncAt  = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const updates: Array<{ range: string; values: string[][] }> = [];

  for (const p of parsed) {
    const info = statusMap.get(p.mutation_key);
    const row  = p.rowIndex;
    updates.push({ range: `'${tabName}'!${colLetter(mutationKeyIdx)}${row}`, values: [[p.mutation_key]] });
    updates.push({ range: `'${tabName}'!${colLetter(lastSyncIdx)}${row}`,    values: [[syncAt]] });
    if (!info) continue;
    const statusLabel =
      info.status === "approved"       ? "✅ APPROVED"
      : info.status === "matched"      ? "🔍 MATCHED"
      : info.status === "manual_review" ? "⚠️ REVIEW"
      : "❌ UNMATCHED";
    // Nama & referensi: tampilkan kandidat terbaik meski belum approved (beri suffix ?)
    const namaSuffix      = info.detail_name    && !info.is_approved ? " (?)" : "";
    const refSuffix       = info.detail_ref     && !info.is_approved ? " (?)" : "";
    const companySuffix   = info.detail_company && !info.is_approved ? " (?)" : "";
    const serviceSuffix   = info.detail_service && !info.is_approved ? " (?)" : "";
    const kategori   = info.cand_type
      ? (info.is_approved ? kategoriLabel(info.cand_type) : `${kategoriLabel(info.cand_type)} (?)`)
      : "";
    updates.push({ range: `'${tabName}'!${colLetter(statusIdx)}${row}`,      values: [[statusLabel]] });
    updates.push({ range: `'${tabName}'!${colLetter(scoreIdx)}${row}`,       values: [[info.score != null ? String(info.score) : ""]] });
    updates.push({ range: `'${tabName}'!${colLetter(resultIdx)}${row}`,      values: [[info.match_result]] });
    updates.push({ range: `'${tabName}'!${colLetter(namaIdx)}${row}`,        values: [[info.detail_name + namaSuffix]] });
    updates.push({ range: `'${tabName}'!${colLetter(referensiIdx)}${row}`,   values: [[info.detail_ref + refSuffix]] });
    updates.push({ range: `'${tabName}'!${colLetter(kategoriIdx)}${row}`,    values: [[kategori]] });
    updates.push({ range: `'${tabName}'!${colLetter(perusahaanIdx)}${row}`,  values: [[info.detail_company + companySuffix]] });
    updates.push({ range: `'${tabName}'!${colLetter(fasilitasIdx)}${row}`,   values: [[info.detail_service + serviceSuffix]] });
  }

  if (updates.length > 0) {
    await batchUpdateSheet(sheetId, updates).catch((e) =>
      logger.warn({ err: e?.message }, "[sheetSync] Write-back gagal (non-fatal)"),
    );
  }

  // ── Warnai baris Google Sheet berdasarkan status ──────────────────────────
  const colorRows: RowColor[] = [];
  for (const p of parsed) {
    const info = statusMap.get(p.mutation_key);
    // default: putih
    let red = 1.0, green = 1.0, blue = 1.0;
    if (info) {
      if (info.status === "approved")       { red = 0.85; green = 0.95; blue = 0.85; } // hijau
      else if (info.status === "matched")   { red = 0.85; green = 0.91; blue = 0.98; } // biru muda
      else if (info.status === "manual_review") { red = 1.0; green = 0.92; blue = 0.80; } // oranye
      else                                  { red = 1.0;  green = 0.97; blue = 0.80; } // kuning
    }
    colorRows.push({ rowIndex: p.rowIndex, red, green, blue });
  }
  if (colorRows.length > 0) {
    await formatRowsColor(sheetId, tabName, colorRows).catch((e) =>
      logger.warn({ err: e?.message }, "[sheetSync] Format warna baris gagal (non-fatal)"),
    );
  }

  const execMs = Date.now() - syncStartMs;
  logger.info(
    { label, configId, total: parsed.length, newImported: newMutations.length, execMs },
    "[sheetSync] Sync selesai",
  );

  // Update sync status in DB
  await db.execute(sql.raw(`
    UPDATE bank_sheet_configs
    SET last_sync_status = 'ok', last_sync_error = NULL,
        last_synced_at = NOW(), updated_at = NOW()
    WHERE id = ${configId}
  `)).catch(() => {});

  // Log to monitoring
  try {
    const { logSyncResult } = await import("./monitoring/reconciliationMonitor.js");
    logSyncResult({
      sync_type: "SHEET_TO_DB",
      status: "SUCCESS",
      records_processed: parsed.length,
      records_failed: 0,
      execution_time_ms: execMs,
    }).catch(() => {});
  } catch { /* non-fatal */ }

  // Update revenue summary tab (non-fatal)
  await updateRevenueSummaryTab(sheetId, company_id ?? null);

  return { imported: newMutations.length, total: parsed.length };
}

// ── Revenue Summary Tab ────────────────────────────────────────────────────────

const SUMMARY_TAB = "Ringkasan_Revenue";

const KATEGORI_COLS: Array<{ type: string; label: string }> = [
  { type: "logistic_order",     label: "Logistik" },
  { type: "invoice",            label: "Invoice" },
  { type: "accounting_payment", label: "Pembayaran" },
  { type: "expense",            label: "Pengeluaran" },
  { type: "sport_payment",      label: "Sport Center" },
  { type: "tenant_invoice",     label: "Sewa Tenant" },
];

async function updateRevenueSummaryTab(
  sheetId: string,
  companyId: number | null,
): Promise<void> {
  try {
    // Query: jumlah per bulan per kategori (hanya mutasi yg approved/matched)
    const companyFilter = companyId ? `AND bm.company_id = ${companyId}` : "";
    const { rows } = await db.execute(sql.raw(`
      SELECT
        TO_CHAR(bm.transaction_date::date, 'YYYY-MM') AS bulan,
        COALESCE(brm.candidate_type, 'unmatched')     AS kategori,
        SUM(bm.amount)                                AS total
      FROM bank_mutations bm
      LEFT JOIN LATERAL (
        SELECT candidate_type
        FROM bank_reconciliation_matches
        WHERE mutation_id = bm.id AND status = 'approved'
        LIMIT 1
      ) brm ON true
      WHERE bm.status IN ('matched', 'approved')
        ${companyFilter}
      GROUP BY bulan, kategori
      ORDER BY bulan DESC, kategori
    `));

    if (!(rows as any[]).length) return;

    // Pivot: bulan → { kategori: total }
    const pivot = new Map<string, Map<string, number>>();
    for (const r of rows as any[]) {
      const bulan = String(r.bulan ?? "");
      const kat   = String(r.kategori ?? "");
      const total = Number(r.total ?? 0);
      if (!pivot.has(bulan)) pivot.set(bulan, new Map());
      pivot.get(bulan)!.set(kat, (pivot.get(bulan)!.get(kat) ?? 0) + total);
    }

    const updatedAt = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

    // Build sheet rows
    const header: string[] = [
      "Bulan",
      ...KATEGORI_COLS.map((k) => k.label),
      "TOTAL",
      "Diupdate",
    ];
    const dataRows: string[][] = [];

    // Sort bulan descending
    const bulanList = [...pivot.keys()].sort((a, b) => b.localeCompare(a));
    for (const bulan of bulanList) {
      const byKat = pivot.get(bulan)!;
      const vals = KATEGORI_COLS.map((k) => {
        const v = byKat.get(k.type) ?? 0;
        return v > 0 ? String(v) : "0";
      });
      const total = KATEGORI_COLS.reduce((s, k) => s + (byKat.get(k.type) ?? 0), 0);

      // Format bulan: "2026-06" → "Juni 2026"
      const [yr, mo] = bulan.split("-");
      const BULAN_ID = ["","Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];
      const bulanLabel = `${BULAN_ID[parseInt(mo, 10)] ?? mo} ${yr}`;

      dataRows.push([bulanLabel, ...vals, String(total), updatedAt]);
    }

    // Ensure tab exists then overwrite
    await ensureSheets(sheetId, [SUMMARY_TAB]);
    await clearAndWriteSheet(sheetId, SUMMARY_TAB, [header, ...dataRows]);

    logger.info(
      { sheetId, rows: dataRows.length },
      "[sheetSync] Ringkasan_Revenue tab diperbarui",
    );
  } catch (err: any) {
    logger.warn({ err: err.message }, "[sheetSync] updateRevenueSummaryTab gagal (non-fatal)");
  }
}

// ── Public: diagnose sheet config (read-only, no insert) ─────────────────────

export async function diagnoseSheetConfig(configId: number): Promise<object> {
  const { rows } = await db.execute(sql.raw(
    `SELECT * FROM bank_sheet_configs WHERE id = ${configId}`,
  ));
  if (!(rows as any[]).length) throw new Error("Config tidak ditemukan");
  const cfg = (rows as any[])[0] as SheetConfig;

  const rawRows = await readSheet(cfg.sheet_id, cfg.tab_name);
  if (rawRows.length === 0) return { headers: [], totalRows: 0, parsed: 0, skipped: 0, reason: "Sheet kosong atau tidak bisa dibaca" };

  const rawHeaders = rawRows[0].map((h: string) => String(h ?? "").trim());
  const { parsed } = parseSheetRows(rawRows, "diagnose");

  // Identify skipped rows
  const skipped: Array<{ row: number; reason: string; raw: string[] }> = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((c: string) => !c?.trim())) continue;
    const isInParsed = parsed.some((p) => p.rowIndex === i + 1);
    if (!isInParsed) {
      skipped.push({ row: i + 1, reason: "Tanggal tidak terbaca atau jumlah=0", raw: row.slice(0, 6) });
    }
  }

  // Existing mutation_keys count
  const { rows: ekRows } = await db.execute(sql.raw(
    `SELECT COUNT(*) AS cnt FROM bank_mutations WHERE sheet_config_id = ${configId}`,
  ));
  const existingCount = Number((ekRows as any[])[0]?.cnt ?? 0);

  return {
    sheetId: cfg.sheet_id,
    tabName: cfg.tab_name,
    headers: rawHeaders,
    totalRows: rawRows.length - 1,
    parsedOk: parsed.length,
    skippedCount: skipped.length,
    skippedSample: skipped.slice(0, 5),
    sampleParsed: parsed.slice(0, 3).map((p) => ({
      row: p.rowIndex,
      date: p.transaction_date,
      desc: p.description.slice(0, 60),
      amount: p.amount,
      direction: p.direction,
    })),
    existingInDb: existingCount,
  };
}

// ── Public: immediate writeback for a single mutation after approval ──────────
//
// Dipanggil fire-and-forget dari route /approve agar sheet langsung ter-update
// tanpa menunggu siklus sync 60-detik berikutnya.

export async function triggerWritebackForMutation(mutationId: number): Promise<void> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return;
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT bm.sheet_config_id,
             bsc.sheet_id, bsc.tab_name, bsc.label, bsc.company_id, bsc.id AS cfg_id
      FROM bank_mutations bm
      JOIN bank_sheet_configs bsc ON bsc.id = bm.sheet_config_id
      WHERE bm.id = ${mutationId}
        AND bm.sheet_config_id IS NOT NULL
        AND bsc.is_active = TRUE
      LIMIT 1
    `));
    const row = (rows as any[])[0];
    if (!row) return; // mutasi tidak berasal dari sheet, skip
    await syncOneConfig({
      id:         Number(row.cfg_id),
      company_id: row.company_id != null ? Number(row.company_id) : null,
      sheet_id:   String(row.sheet_id),
      tab_name:   String(row.tab_name),
      label:      String(row.label),
    });
  } catch (err: any) {
    logger.warn(
      { err: err.message, mutationId },
      "[sheetSync] triggerWritebackForMutation gagal (non-fatal)",
    );
  }
}

// ── Public: sync one config by ID (called from API) ──────────────────────────

export async function syncOneSheetConfig(configId: number): Promise<{
  ok: boolean; imported: number; total: number; message: string;
}> {
  const { rows } = await db.execute(sql.raw(
    `SELECT * FROM bank_sheet_configs WHERE id = ${configId} AND is_active = TRUE`,
  ));
  if (!(rows as any[]).length) throw new Error("Config tidak ditemukan atau tidak aktif");
  const cfg = (rows as any[])[0] as SheetConfig;
  const result = await syncOneConfig(cfg);
  return {
    ok: true,
    imported: result.imported,
    total: result.total,
    message: `Sync selesai: ${result.imported} mutasi baru dari ${result.total} baris`,
  };
}

// ── Public: sync all active DB configs ───────────────────────────────────────

export async function syncAllSheetConfigs(): Promise<void> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return;

  let configs: SheetConfig[] = [];
  try {
    const { rows } = await db.execute(sql.raw(
      `SELECT id, company_id, sheet_id, tab_name, label FROM bank_sheet_configs WHERE is_active = TRUE`,
    ));
    configs = rows as unknown as SheetConfig[];
  } catch { /* table may not exist yet */ }

  if (configs.length === 0) return;

  for (const cfg of configs) {
    await syncOneConfig(cfg).catch((err) =>
      logger.warn({ err: err?.message, label: cfg.label }, "[sheetSync] Config sync gagal (non-fatal)"),
    );
  }
}

// ── Legacy: single env-var sheet ─────────────────────────────────────────────

export async function syncSheetToReplit(): Promise<void> {
  const sheetId = LEGACY_SHEET_ID();
  if (!sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    logger.debug("[sheetSync] Legacy GOOGLE_SHEET_ID_BANK_MUTATIONS tidak dikonfigurasi — skip");
    return;
  }

  const legacyCfg: SheetConfig = {
    id: -1,  // sentinel: legacy mode, no DB record
    company_id: null,
    sheet_id: sheetId,
    tab_name: LEGACY_TAB(),
    label: "Legacy (env var)",
  };

  await syncOneConfig({ ...legacyCfg }).catch((err) =>
    logger.warn({ err: err?.message }, "[sheetSync] Legacy sync gagal (non-fatal)"),
  );
}

// ── Worker starter ─────────────────────────────────────────────────────────────

export function startSheetSyncWorker(): void {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    logger.info("[sheetSync] Sheet sync tidak aktif — set GOOGLE_SERVICE_ACCOUNT_JSON untuk mengaktifkan");
    return;
  }

  logger.info({ intervalMs: SYNC_MS }, "[sheetSync] Multi-sheet auto-sync dimulai");

  const runAll = async () => {
    // Mode 1: DB configs (multi-company)
    await syncAllSheetConfigs();
    // Mode 2: Legacy env var fallback (hanya kalau tidak ada DB config)
    const { rows } = await db.execute(sql.raw(
      `SELECT COUNT(*) AS n FROM bank_sheet_configs WHERE is_active = TRUE`,
    )).catch(() => ({ rows: [{ n: "0" }] }));
    const hasDbConfigs = Number((rows as any[])[0]?.n ?? 0) > 0;
    if (!hasDbConfigs && LEGACY_SHEET_ID()) {
      await syncSheetToReplit();
    }
  };

  // Sync awal
  runAll().catch((err) => logger.warn({ err: err?.message }, "[sheetSync] Initial sync gagal (non-fatal)"));

  // Auto sync tiap 1 menit
  setInterval(() => {
    runAll().catch((err) => logger.warn({ err: err?.message }, "[sheetSync] Periodic sync gagal (non-fatal)"));
  }, SYNC_MS).unref();
}
