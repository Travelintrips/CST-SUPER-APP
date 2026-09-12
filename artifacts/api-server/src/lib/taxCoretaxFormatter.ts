/**
 * taxCoretaxFormatter.ts
 *
 * Konversi draft SPT → format DJP Coretax (CSV & XML future-ready).
 *
 * Referensi format:
 *   - e-SPT PPN 1111 DJP
 *   - e-SPT PPh 23/26 DJP
 *
 * Rules mapping:
 *   NPWP Perusahaan : dari accounting_settings.company_npwp → companies.npwp → fallback placeholder
 *   NPWP Lawan      : dari transaction_taxes.npwp → supplier.tax_id → customer.tax_id (via join di builder)
 *   Tanggal         : transaction created_at
 *   DPP             : base_amount (numeric, tanpa titik/koma)
 *   PPN             : tax_amount
 *   Jenis TX        : dari transaction_type mapping
 *   WHT status      : direction = withholding
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { SptDraft, SptTransaction } from "./taxSptBuilderService.js";

// ── Company profile lookup (NPWP perusahaan dari DB) ──────────────────────────

export interface CompanyProfile {
  npwp: string;
  name: string;
}

/**
 * Ambil NPWP & nama perusahaan dari DB.
 * Priority: accounting_settings.company_npwp → companies.npwp.
 * Tidak ada fallback dummy — NPWP wajib diisi di Company Settings sebelum ekspor DJP.
 */
export async function fetchCompanyProfile(companyId: number): Promise<CompanyProfile> {
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT
        COALESCE(
          NULLIF(acs.company_npwp, ''),
          NULLIF(c.npwp, '')
        ) AS npwp,
        COALESCE(
          NULLIF(c.name, ''),
          'PERUSAHAAN'
        ) AS name
      FROM companies c
      LEFT JOIN accounting_settings acs ON acs.company_id = c.id
      WHERE c.id = ${companyId}
      LIMIT 1
    `));
    const row = rows[0] as any;
    return {
      npwp: row?.npwp ?? "",
      name: row?.name ?? "PERUSAHAAN",
    };
  } catch {
    return { npwp: "", name: "PERUSAHAAN" };
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CSV_DELIMITER = ",";
const CSV_LINE_END  = "\r\n";

// ── Helpers ───────────────────────────────────────────────────────────────────

function escCsv(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtDate(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function amtInt(n: number): string {
  return String(Math.round(Math.abs(n)));
}

function mapJenisTransaksi(txType: string): string {
  const map: Record<string, string> = {
    "sales_order":     "01",
    "invoice":         "01",
    "purchase_order":  "02",
    "purchase":        "02",
    "expense":         "03",
    "logistics":       "04",
    "logistic_order":  "04",
    "freight":         "04",
    "pos":             "05",
    "journal":         "06",
    "other":           "09",
  };
  const key = Object.keys(map).find((k) => txType.toLowerCase().includes(k));
  return key ? map[key] : "09";
}

// ── PPN CSV (format e-SPT PPN 1111) ──────────────────────────────────────────
// Kolom: No,NPWP_Lawan,Nama_Lawan,Tanggal,No_Faktur,DPP,PPN,Jenis

export interface CoretaxExportOptions {
  npwpPerusahaan?: string;
  namaPerusahaan?: string;
}

export interface CoretaxExportResult {
  type: "PPN" | "PPH23" | "PPH21" | "PPH_ALL";
  period: string;
  csv: string;
  row_count: number;
  total_dpp: number;
  total_pajak: number;
}

export function exportPpnCsv(
  draft: SptDraft,
  opts: CoretaxExportOptions = {},
): CoretaxExportResult {
  // NPWP perusahaan (pemungut/penjual) — wajib diisi, tidak ada fallback dummy
  if (!opts.npwpPerusahaan) {
    throw new Error(
      "NPWP Perusahaan wajib diisi sebelum ekspor CSV PPN DJP. " +
      "Isi di Company Settings > NPWP lalu coba lagi.",
    );
  }
  const npwpSelf = opts.npwpPerusahaan;
  const namaSelf = opts.namaPerusahaan ?? "PERUSAHAAN";

  const ppnTx = draft.transactions.filter((t) => {
    const n = t.tax_name.toLowerCase();
    return (n.includes("ppn") || n.includes("vat")) && t.direction !== "withholding";
  });

  const header = [
    "No", "NPWP_Lawan", "Nama_Lawan", "Tanggal_Faktur",
    "No_Faktur_Pajak", "DPP", "PPN", "Jenis_Transaksi",
    "Kode_Jenis_Faktur", "Status", "NPWP_Perusahaan",
  ].join(CSV_DELIMITER);

  let totalDpp = 0;
  let totalPajak = 0;
  let missingNpwp = 0;
  let missingFaktur = 0;

  const lines = ppnTx.map((t, i) => {
    totalDpp   += t.base_amount;
    totalPajak += t.tax_amount;

    // NPWP lawan: dari transaction data (sudah di-join dengan supplier/customer di builder)
    const npwpLawan = t.npwp ?? "";
    const namaLawan = t.partner_name ?? "";
    if (!npwpLawan) missingNpwp++;
    if (!t.faktur_pajak_number) missingFaktur++;

    const jenis = mapJenisTransaksi(t.transaction_type);
    const kodeFaktur = t.direction === "output" ? "01" : "02";

    return [
      escCsv(i + 1),
      escCsv(npwpLawan),       // NPWP lawan transaksi (real data)
      escCsv(namaLawan),       // Nama lawan transaksi (real data)
      escCsv(fmtDate(t.created_at)),
      escCsv(t.faktur_pajak_number ?? ""),
      escCsv(amtInt(t.base_amount)),
      escCsv(amtInt(t.tax_amount)),
      escCsv(jenis),
      escCsv(kodeFaktur),
      escCsv(t.status),
      escCsv(npwpSelf),        // NPWP perusahaan (pemungut/penjual)
    ].join(CSV_DELIMITER);
  });

  // Footer baris total
  const footer = [
    escCsv("TOTAL"), "", "", "", "",
    escCsv(amtInt(totalDpp)),
    escCsv(amtInt(totalPajak)),
    "", "", "", "",
  ].join(CSV_DELIMITER);

  // Warning row jika ada data yang belum lengkap
  const warningLines: string[] = [];
  if (missingNpwp > 0) warningLines.push(`# PERINGATAN: ${missingNpwp} baris NPWP lawan kosong — isi via Tax > Export DJP sebelum upload ke CoreTax`);
  if (missingFaktur > 0) warningLines.push(`# PERINGATAN: ${missingFaktur} baris No. Faktur Pajak kosong — wajib diisi sebelum upload ke CoreTax`);
  if (!opts.npwpPerusahaan) warningLines.push(`# PERINGATAN: NPWP Perusahaan belum diatur — isi di Company Settings > NPWP`);

  const csv = [...warningLines, header, ...lines, footer].join(CSV_LINE_END) + CSV_LINE_END;

  return {
    type: "PPN",
    period: draft.period,
    csv,
    row_count: ppnTx.length,
    total_dpp: totalDpp,
    total_pajak: totalPajak,
  };
}

// ── PPh 23 CSV (format e-SPT PPh 23/26) ──────────────────────────────────────
// Kolom: No,NPWP_WP,Nama_WP,Tanggal,No_BuktiPotong,Jenis_Penghasilan,DPP,Tarif,PPh_Dipotong

export function exportPph23Csv(
  draft: SptDraft,
  opts: CoretaxExportOptions = {},
): CoretaxExportResult {
  const namaSelf = opts.namaPerusahaan ?? "PERUSAHAAN";

  const pph23Tx = draft.transactions.filter((t) => {
    const n = t.tax_name.toLowerCase();
    return t.direction === "withholding" && (n.includes("23") || n.includes("26"));
  });

  const header = [
    "No", "NPWP_WP_Dipotong", "Nama_WP_Dipotong", "Tanggal",
    "No_Bukti_Potong", "Jenis_Penghasilan", "Bruto_DPP",
    "Tarif_Persen", "PPh_Dipotong", "Pemotong",
  ].join(CSV_DELIMITER);

  let totalDpp = 0;
  let totalPajak = 0;

  let missingNpwpPph23 = 0;
  const lines = pph23Tx.map((t, i) => {
    totalDpp   += t.base_amount;
    totalPajak += t.tax_amount;

    const npwpLawan = t.npwp ?? "";
    const namaLawan = t.partner_name ?? "";
    if (!npwpLawan) missingNpwpPph23++;

    return [
      escCsv(i + 1),
      escCsv(npwpLawan),    // NPWP WP dipotong (real data dari supplier master)
      escCsv(namaLawan),    // Nama WP dipotong (real data dari supplier master)
      escCsv(fmtDate(t.created_at)),
      escCsv(t.bukti_potong_number ?? ""),
      escCsv(t.tax_name),
      escCsv(amtInt(t.base_amount)),
      escCsv(Number(t.tax_rate).toFixed(2)),
      escCsv(amtInt(t.tax_amount)),
      escCsv(namaSelf),
    ].join(CSV_DELIMITER);
  });

  const footer = [
    escCsv("TOTAL"), "", "", "", "", "",
    escCsv(amtInt(totalDpp)), "",
    escCsv(amtInt(totalPajak)), "",
  ].join(CSV_DELIMITER);

  const warnLines23: string[] = [];
  if (missingNpwpPph23 > 0) warnLines23.push(`# PERINGATAN: ${missingNpwpPph23} baris NPWP WP dipotong kosong — isi NPWP di master supplier`);
  if (!opts.npwpPerusahaan) warnLines23.push(`# PERINGATAN: NPWP Perusahaan belum diatur — isi di Company Settings > NPWP`);

  const csv = [...warnLines23, header, ...lines, footer].join(CSV_LINE_END) + CSV_LINE_END;

  return {
    type: "PPH23",
    period: draft.period,
    csv,
    row_count: pph23Tx.length,
    total_dpp: totalDpp,
    total_pajak: totalPajak,
  };
}

// ── PPh 21 CSV (format ringkas) ───────────────────────────────────────────────

export function exportPph21Csv(
  draft: SptDraft,
  opts: CoretaxExportOptions = {},
): CoretaxExportResult {
  const namaSelf = opts.namaPerusahaan ?? "PERUSAHAAN";

  const pph21Tx = draft.transactions.filter((t) => {
    const n = t.tax_name.toLowerCase();
    return t.direction === "withholding" && n.includes("21");
  });

  const header = [
    "No", "Nama_Karyawan_Penerima", "NPWP_Penerima", "Tanggal",
    "No_Bukti_Potong", "Jenis_Penghasilan",
    "Bruto_Penghasilan", "Tarif_Persen", "PPh21_Dipotong", "Pemotong",
  ].join(CSV_DELIMITER);

  let totalDpp = 0;
  let totalPajak = 0;

  let missingNpwpPph21 = 0;
  const lines = pph21Tx.map((t, i) => {
    totalDpp   += t.base_amount;
    totalPajak += t.tax_amount;

    const namaKaryawan = t.partner_name ?? "";
    const npwpKaryawan = t.npwp ?? "";
    if (!npwpKaryawan) missingNpwpPph21++;

    return [
      escCsv(i + 1),
      escCsv(namaKaryawan),    // Nama karyawan/penerima (real data)
      escCsv(npwpKaryawan),    // NPWP karyawan/penerima (real data)
      escCsv(fmtDate(t.created_at)),
      escCsv(t.bukti_potong_number ?? ""),
      escCsv(t.tax_name),
      escCsv(amtInt(t.base_amount)),
      escCsv(Number(t.tax_rate).toFixed(2)),
      escCsv(amtInt(t.tax_amount)),
      escCsv(namaSelf),
    ].join(CSV_DELIMITER);
  });

  const footer = [
    escCsv("TOTAL"), "", "", "", "", "",
    escCsv(amtInt(totalDpp)), "",
    escCsv(amtInt(totalPajak)), "",
  ].join(CSV_DELIMITER);

  const warnLines21: string[] = [];
  if (missingNpwpPph21 > 0) warnLines21.push(`# PERINGATAN: ${missingNpwpPph21} baris NPWP karyawan kosong — isi NPWP di master karyawan/partner`);
  if (!opts.npwpPerusahaan) warnLines21.push(`# PERINGATAN: NPWP Perusahaan belum diatur — isi di Company Settings > NPWP`);

  const csv = [...warnLines21, header, ...lines, footer].join(CSV_LINE_END) + CSV_LINE_END;

  return {
    type: "PPH21",
    period: draft.period,
    csv,
    row_count: pph21Tx.length,
    total_dpp: totalDpp,
    total_pajak: totalPajak,
  };
}

// ── All WHT CSV (gabungan PPh semua jenis) ────────────────────────────────────

export function exportWhtCsv(
  draft: SptDraft,
  opts: CoretaxExportOptions = {},
): CoretaxExportResult {
  const namaSelf = opts.namaPerusahaan ?? "PERUSAHAAN";

  const whtTx = draft.transactions.filter((t) => t.direction === "withholding");


  let totalDpp = 0;
  let totalPajak = 0;

  const whtHeader = [
    "No", "Tanggal", "Jenis_PPh", "Nama_Pajak",
    "NPWP_Pihak_Dipotong", "Nama_Pihak_Dipotong",
    "No_Bukti_Potong", "DPP", "Tarif_Persen",
    "PPh_Dipotong", "Transaction_Type", "Pemotong",
  ].join(CSV_DELIMITER);

  const lines = whtTx.map((t, i) => {
    totalDpp   += t.base_amount;
    totalPajak += t.tax_amount;

    const jenisPph = t.tax_name.toLowerCase().includes("21") ? "PPh 21"
      : t.tax_name.toLowerCase().includes("23") ? "PPh 23"
      : t.tax_name.toLowerCase().includes("15") ? "PPh 15"
      : t.tax_name.toLowerCase().includes("4(2)") ? "PPh 4(2)"
      : "PPh Lainnya";

    return [
      escCsv(i + 1),
      escCsv(fmtDate(t.created_at)),
      escCsv(jenisPph),
      escCsv(t.tax_name),
      escCsv(t.npwp ?? ""),           // NPWP pihak yang dipotong (real data)
      escCsv(t.partner_name ?? ""),   // Nama pihak yang dipotong (real data)
      escCsv(t.bukti_potong_number ?? ""),
      escCsv(amtInt(t.base_amount)),
      escCsv(Number(t.tax_rate).toFixed(2)),
      escCsv(amtInt(t.tax_amount)),
      escCsv(t.transaction_type),
      escCsv(namaSelf),
    ].join(CSV_DELIMITER);
  });

  const footer = [
    escCsv("TOTAL"), "", "", "", "", "", "",
    escCsv(amtInt(totalDpp)), "",
    escCsv(amtInt(totalPajak)), "", "",
  ].join(CSV_DELIMITER);

  const csv = [whtHeader, ...lines, footer].join(CSV_LINE_END) + CSV_LINE_END;

  return {
    type: "PPH_ALL",
    period: draft.period,
    csv,
    row_count: whtTx.length,
    total_dpp: totalDpp,
    total_pajak: totalPajak,
  };
}

// ── XML (future-ready, Coretax XML schema placeholder) ───────────────────────

export function exportPpnXml(
  draft: SptDraft,
  opts: CoretaxExportOptions = {},
): string {
  // NPWP wajib untuk XML — tidak ada fallback dummy, DJP akan menolak submission
  if (!opts.npwpPerusahaan) {
    throw new Error(
      "NPWP Perusahaan wajib diisi sebelum ekspor XML Coretax. " +
      "Isi di Company Settings > NPWP lalu coba lagi.",
    );
  }
  const npwpSelf = opts.npwpPerusahaan;
  const namaSelf = opts.namaPerusahaan ?? "PERUSAHAAN";

  const ppnTx = draft.transactions.filter((t) => {
    const n = t.tax_name.toLowerCase();
    return (n.includes("ppn") || n.includes("vat")) && t.direction !== "withholding";
  });

  const lines = ppnTx.map((t, i) => `
    <Transaksi urut="${i + 1}">
      <NPWP_Perusahaan>${npwpSelf}</NPWP_Perusahaan>
      <Nama_Perusahaan>${namaSelf}</Nama_Perusahaan>
      <NPWP_Lawan>${t.npwp ?? ""}</NPWP_Lawan>
      <Nama_Lawan>${t.partner_name ?? ""}</Nama_Lawan>
      <Tanggal_Faktur>${fmtDate(t.created_at)}</Tanggal_Faktur>
      <No_Faktur_Pajak>${t.faktur_pajak_number ?? ""}</No_Faktur_Pajak>
      <DPP>${amtInt(t.base_amount)}</DPP>
      <PPN>${amtInt(t.tax_amount)}</PPN>
      <Jenis>${t.direction === "output" ? "Keluaran" : "Masukan"}</Jenis>
    </Transaksi>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<SPT_PPN>
  <Header>
    <NPWP_WP>${npwpSelf}</NPWP_WP>
    <Nama_WP>${namaSelf}</Nama_WP>
    <Masa_Pajak>${draft.period}</Masa_Pajak>
    <Total_PPN_Keluaran>${amtInt(draft.ppn.output_tax_total)}</Total_PPN_Keluaran>
    <Total_PPN_Masukan>${amtInt(draft.ppn.input_tax_total)}</Total_PPN_Masukan>
    <PPN_Kurang_Bayar>${amtInt(Math.max(0, draft.ppn.net_vat))}</PPN_Kurang_Bayar>
    <PPN_Lebih_Bayar>${amtInt(Math.max(0, -draft.ppn.net_vat))}</PPN_Lebih_Bayar>
  </Header>
  <Transaksi_List>
${lines}
  </Transaksi_List>
</SPT_PPN>`;
}
