/**
 * Faktur Pajak Validator — validasi format nomor faktur pajak Indonesia.
 *
 * Format e-Faktur (eNofa, berlaku sejak 2014):
 *   KKK.SSS-TT.SSSSSSSS
 *   dimana:
 *   KKK = Kode Transaksi (3 digit, 010-070 untuk barang/jasa, dll.)
 *   SSS = Kode Status Faktur (3 digit: 000 = normal, 001-100 = perubahan)
 *   TT  = 2 digit tahun (misal 24 = 2024)
 *   SSSSSSSS = nomor urut faktur (8 digit, 00000001-99999999)
 *
 * Contoh valid:
 *   010.000-24.00000001
 *   030.000-24.12345678
 *   070.000-23.00000099
 *
 * Kode transaksi valid:
 *   010 = penyerahan BKP/JKP kepada selain pemungut PPN
 *   011 = penyerahan BKP/JKP kepada pemungut bendahara
 *   012 = penyerahan BKP/JKP kepada pemungut KPS migas
 *   020 = penyerahan BKP/JKP yang mendapat fasilitas PPN dibebaskan
 *   030 = penyerahan BKP/JKP yang mendapat fasilitas tidak dipungut
 *   040 = penyerahan BKP/JKP yang tidak termasuk DPP
 *   050 = penyerahan BKP/JKP yang menggunakan nilai lain sebagai DPP
 *   060 = penyerahan jasa oleh badan usaha
 *   070 = penyerahan BKP/JKP oleh PKP pedagang eceran
 */

export interface FakturValidation {
  valid: boolean;
  normalized: string | null;
  formatted: string | null;
  kodeTransaksi?: string;
  kodeStatus?: string;
  tahun?: string;
  nomorUrut?: string;
  error?: string;
}

const VALID_KODE_TRANSAKSI = new Set([
  "010", "011", "012", "013",
  "020", "021",
  "030", "031",
  "040",
  "050",
  "060",
  "070",
]);

/**
 * Strip semua non-digit dan non-separator, normalisasi ke hanya angka (16 digit).
 */
export function stripFaktur(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Format 16 digit → KKK.SSS-TT.SSSSSSSS
 */
export function formatFaktur(digits: string): string | null {
  if (digits.length !== 16) return null;
  return [
    digits.slice(0, 3),
    ".",
    digits.slice(3, 6),
    "-",
    digits.slice(6, 8),
    ".",
    digits.slice(8, 16),
  ].join("");
}

export function validateFakturPajak(raw: string | null | undefined): FakturValidation {
  if (!raw || !raw.trim()) {
    return { valid: false, normalized: null, formatted: null, error: "Nomor faktur tidak boleh kosong" };
  }

  const digits = stripFaktur(raw.trim());

  if (digits.length !== 16) {
    return {
      valid: false,
      normalized: digits.length > 0 ? digits : null,
      formatted: null,
      error: `Nomor faktur harus 16 digit (ditemukan ${digits.length} digit)`,
    };
  }

  const kodeTransaksi = digits.slice(0, 3);
  const kodeStatus = digits.slice(3, 6);
  const tahun = digits.slice(6, 8);
  const nomorUrut = digits.slice(8, 16);

  // Kode transaksi harus dikenali (soft check — warn saja)
  const kodeValid = VALID_KODE_TRANSAKSI.has(kodeTransaksi);

  // Nomor urut tidak boleh 00000000
  if (nomorUrut === "00000000") {
    return {
      valid: false,
      normalized: digits,
      formatted: formatFaktur(digits),
      kodeTransaksi, kodeStatus, tahun, nomorUrut,
      error: "Nomor urut faktur tidak valid (00000000)",
    };
  }

  // Tahun sanity (10 - 99, tahun 2010-2099)
  const tahunNum = parseInt(tahun, 10);
  if (tahunNum < 10 || tahunNum > 99) {
    return {
      valid: false,
      normalized: digits,
      formatted: formatFaktur(digits),
      kodeTransaksi, kodeStatus, tahun, nomorUrut,
      error: `Tahun faktur tidak valid: ${tahun}`,
    };
  }

  return {
    valid: true,
    normalized: digits,
    formatted: formatFaktur(digits)!,
    kodeTransaksi,
    kodeStatus,
    tahun: `20${tahun}`,
    nomorUrut,
    ...(!kodeValid ? { error: `Kode transaksi ${kodeTransaksi} tidak dikenal (non-fatal)` } : {}),
  };
}
