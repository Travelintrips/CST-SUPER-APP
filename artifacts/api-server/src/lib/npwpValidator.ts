/**
 * NPWP Validator — format dan checksum NPWP Indonesia.
 *
 * Format standar DJP: XX.XXX.XXX.X-XXX.XXX
 * - 15 digit total (strip semua non-digit)
 * - Digit 1-9  : nomor urut wajib pajak
 * - Digit 10   : cek digit (modulo 11)
 * - Digit 11-13: kode KPP (Kantor Pelayanan Pajak)
 * - Digit 14-15: kode cabang (00 = pusat)
 *
 * Algoritma cek digit (mod-11 DJP):
 * - Bobot digit 1-8: [8,7,6,5,4,3,2,9]
 * - Jumlahkan (digit_i × bobot_i), bagi 11, sisa = cek digit
 * - Jika sisa >= 10 → cek digit = 0
 */

export interface NpwpValidation {
  valid: boolean;
  /** NPWP terformat: XX.XXX.XXX.X-XXX.XXX */
  formatted: string | null;
  /** Hanya 15 digit tanpa pemisah */
  normalized: string | null;
  error?: string;
}

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 9];

function computeCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(digits[i]!, 10) * WEIGHTS[i]!;
  }
  const rem = sum % 11;
  return rem >= 10 ? 0 : rem;
}

/**
 * Normalisasi: strip semua karakter non-digit.
 */
export function stripNpwp(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Format 15 digit → XX.XXX.XXX.X-XXX.XXX
 */
export function formatNpwp(digits: string): string | null {
  if (digits.length !== 15) return null;
  return [
    digits.slice(0, 2),
    ".",
    digits.slice(2, 5),
    ".",
    digits.slice(5, 8),
    ".",
    digits[8],
    "-",
    digits.slice(9, 12),
    ".",
    digits.slice(12, 15),
  ].join("");
}

export function validateNpwp(raw: string | null | undefined): NpwpValidation {
  if (!raw || !raw.trim()) {
    return { valid: false, formatted: null, normalized: null, error: "NPWP tidak boleh kosong" };
  }

  const digits = stripNpwp(raw.trim());

  if (digits.length !== 15) {
    return {
      valid: false,
      formatted: null,
      normalized: digits.length > 0 ? digits : null,
      error: `NPWP harus 15 digit (ditemukan ${digits.length} digit)`,
    };
  }

  // Checksum validation
  const expected = computeCheckDigit(digits);
  const actual = parseInt(digits[8]!, 10);
  if (expected !== actual) {
    return {
      valid: false,
      formatted: formatNpwp(digits),
      normalized: digits,
      error: `Cek digit NPWP tidak valid (ekspektasi ${expected}, ditemukan ${actual})`,
    };
  }

  // KPP code sanity (digit 11-13 = 000 is suspicious but technically allowed for testing)
  return {
    valid: true,
    formatted: formatNpwp(digits)!,
    normalized: digits,
  };
}

/**
 * Loose validation — hanya cek panjang, tanpa checksum.
 * Berguna untuk data historis yang mungkin salah entri checksum.
 */
export function validateNpwpLoose(raw: string | null | undefined): NpwpValidation {
  if (!raw || !raw.trim()) {
    return { valid: false, formatted: null, normalized: null, error: "NPWP tidak boleh kosong" };
  }
  const digits = stripNpwp(raw.trim());
  if (digits.length !== 15) {
    return {
      valid: false,
      formatted: null,
      normalized: digits.length > 0 ? digits : null,
      error: `NPWP harus 15 digit (ditemukan ${digits.length} digit)`,
    };
  }
  return { valid: true, formatted: formatNpwp(digits)!, normalized: digits };
}
