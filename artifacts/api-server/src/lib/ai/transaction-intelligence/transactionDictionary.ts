/**
 * AI Transaction Intelligence — Phase 1 + Phase 2
 * Semantic Dictionary
 *
 * Maps synonym groups to transaction intents.
 * Rules are evaluated in order — place more specific / higher-priority intents first.
 *
 * Design principles:
 *   • Synonyms are UPPERCASE (matched against the uppercased normalized input).
 *   • Longer / more specific phrases have higher baseConfidence.
 *   • Order within an intent group: longest phrase first (prevents short tokens
 *     from stealing matches that belong to longer phrases).
 *   • Inter-intent order: intents that could overlap (e.g. BANK_REVERSAL vs REFUND)
 *     are separated by placing the more specific one first in the dictionary.
 */

import type { TransactionIntent } from './transactionTypes.js';

// ─── Dictionary entry ─────────────────────────────────────────────────────────

export interface DictionaryEntry {
  /** Lowercase keyword or phrase to search for in the normalized description. */
  term: string;
  /** Contribution weight 0.0 – 1.0 when this term is matched. */
  weight: number;
}

export type IntentDictionary = Record<TransactionIntent, readonly DictionaryEntry[]>;

// ─── Dictionary ────────────────────────────────────────────────────────────────

export const TRANSACTION_DICTIONARY: IntentDictionary = {

  // ── BANK_ADMIN_FEE ──────────────────────────────────────────────────────────
  BANK_ADMIN_FEE: [
    { term: 'biaya administrasi bulanan',  weight: 0.95 },
    { term: 'biaya admin rekening',        weight: 0.92 },
    { term: 'biaya pemeliharaan rekening', weight: 0.92 },
    { term: 'monthly maintenance fee',     weight: 0.90 },
    { term: 'account maintenance fee',     weight: 0.90 },
    { term: 'administration fee',          weight: 0.85 },
    { term: 'biaya administrasi',          weight: 0.80 },
    { term: 'adm rekening',                weight: 0.78 },
    { term: 'biaya bulanan',               weight: 0.75 },
    { term: 'biaya rekening',              weight: 0.72 },
    { term: 'fee bulanan',                 weight: 0.70 },
    { term: 'monthly fee',                 weight: 0.68 },
    { term: 'adm bln',                     weight: 0.65 },
    { term: 'adm',                         weight: 0.30 },
    { term: 'admin',                       weight: 0.25 },
  ],

  // ── TRANSFER_FEE ────────────────────────────────────────────────────────────
  TRANSFER_FEE: [
    { term: 'biaya bi fast',               weight: 0.95 },
    { term: 'biaya rtgs',                  weight: 0.95 },
    { term: 'biaya swift',                 weight: 0.95 },
    { term: 'biaya sknbi',                 weight: 0.95 },
    { term: 'biaya kliring',               weight: 0.92 },
    { term: 'biaya transfer antar bank',   weight: 0.90 },
    { term: 'rtgs fee',                    weight: 0.88 },
    { term: 'swift fee',                   weight: 0.88 },
    { term: 'transfer fee',                weight: 0.85 },
    { term: 'biaya transfer',              weight: 0.82 },
    { term: 'fee transfer',                weight: 0.80 },
    { term: 'ongkos transfer',             weight: 0.78 },
    { term: 'kliring fee',                 weight: 0.78 },
    { term: 'biaya pengiriman dana',       weight: 0.75 },
    { term: 'transfer charge',             weight: 0.72 },
    { term: 'bi fast',                     weight: 0.60 },
    { term: 'bifast',                      weight: 0.55 }, // "BIFAST FEE" → normalizeText → "bifast fee"
    { term: 'rtgs',                        weight: 0.55 },
    { term: 'sknbi',                       weight: 0.55 },
    { term: 'skn fee',                     weight: 0.88 }, // "SKN FEE" → normalizeText → "skn fee"
    { term: 'kliring',                     weight: 0.40 },
    { term: 'skn',                         weight: 0.40 }, // bare SKN abbreviation
    { term: 'transfer',                    weight: 0.25 }, // weak standalone signal; enables "TRANSFER ADM" collision detection
  ],

  // ── INTEREST_INCOME ─────────────────────────────────────────────────────────
  INTEREST_INCOME: [
    { term: 'pendapatan bunga',            weight: 0.95 },
    { term: 'bunga tabungan',              weight: 0.92 },
    { term: 'bunga deposito',              weight: 0.92 },
    { term: 'bunga berjangka',             weight: 0.90 },
    { term: 'jasa giro',                   weight: 0.90 },
    { term: 'interest income',             weight: 0.90 },
    { term: 'savings interest',            weight: 0.88 },
    { term: 'bunga rekening koran',        weight: 0.85 },
    { term: 'kredit bunga',                weight: 0.80 },
    { term: 'interest credit',             weight: 0.80 },
    { term: 'bunga',                       weight: 0.45 },
    { term: 'interest',                    weight: 0.40 },
    { term: 'giro',                        weight: 0.20 }, // low — giro alone is ambiguous
  ],

  // ── CUSTOMER_PAYMENT ────────────────────────────────────────────────────────
  CUSTOMER_PAYMENT: [
    { term: 'pembayaran dari pelanggan',   weight: 0.95 },
    { term: 'bayar tagihan pelanggan',     weight: 0.92 },
    { term: 'payment from customer',       weight: 0.92 },
    { term: 'transfer dari customer',      weight: 0.90 },  // Indonesian mixed: "transfer from customer"
    { term: 'pelunasan piutang',           weight: 0.90 },
    { term: 'pelunasan invoice',           weight: 0.88 },
    { term: 'dari pelanggan',              weight: 0.85 },  // "from customer/client"
    { term: 'setoran pelanggan',           weight: 0.85 },
    { term: 'dp pelanggan',                weight: 0.85 },
    { term: 'uang muka pelanggan',         weight: 0.85 },
    { term: 'cicilan masuk',               weight: 0.82 },
    { term: 'dari customer',               weight: 0.80 },  // Indonesian-English mixed: "from customer"
    { term: 'payment received',            weight: 0.65 },
    { term: 'received from',               weight: 0.60 },
    { term: 'invoice payment',             weight: 0.55 },
    { term: 'pembayaran masuk',            weight: 0.55 },
    { term: 'transfer masuk',              weight: 0.50 },
    { term: 'pelunasan',                   weight: 0.40 },
    { term: 'setoran',                     weight: 0.30 },
    { term: 'dp',                          weight: 0.20 },
  ],

  // ── VENDOR_PAYMENT ──────────────────────────────────────────────────────────
  VENDOR_PAYMENT: [
    { term: 'pembayaran ke vendor',        weight: 0.95 },
    { term: 'pembayaran vendor',           weight: 0.92 },
    { term: 'bayar supplier',              weight: 0.92 },
    { term: 'pembayaran supplier',         weight: 0.92 },
    { term: 'payment to vendor',           weight: 0.90 },
    { term: 'pelunasan hutang',            weight: 0.88 },
    { term: 'payment vendor',              weight: 0.85 },  // English word-order variant
    { term: 'hutang dagang',               weight: 0.85 },
    { term: 'purchase payment',            weight: 0.80 },
    { term: 'vendor payment',              weight: 0.80 },
    { term: 'supplier payment',            weight: 0.80 },
    { term: 'bayar purchase order',        weight: 0.82 },
    { term: 'pembayaran po',               weight: 0.80 },
    { term: 'ap payment',                  weight: 0.78 },
    { term: 'bayar po',                    weight: 0.75 },
    { term: 'payment to pt',               weight: 0.75 },  // payment to Indonesian company (PT = Perseroan Terbatas)
    { term: 'payment pt',                  weight: 0.70 },  // abbreviated form
    { term: 'transfer ke',                 weight: 0.35 },
    { term: 'payment to',                  weight: 0.35 },
    { term: 'bayar',                       weight: 0.20 },
  ],

  // ── PAYROLL ──────────────────────────────────────────────────────────────────
  PAYROLL: [
    { term: 'pembayaran gaji karyawan',    weight: 0.97 },
    { term: 'gaji karyawan',               weight: 0.95 },
    { term: 'payroll karyawan',            weight: 0.95 },
    { term: 'tunjangan hari raya',         weight: 0.95 },
    { term: 'salary payment',              weight: 0.93 },
    { term: 'gaji bulanan',                weight: 0.92 },
    { term: 'gaji pegawai',                weight: 0.92 },
    { term: 'upah karyawan',               weight: 0.90 },
    { term: 'honorarium',                  weight: 0.88 },
    { term: 'thr karyawan',                weight: 0.95 },
    { term: 'insentif karyawan',           weight: 0.85 },
    { term: 'payroll',                     weight: 0.82 },
    { term: 'salary',                      weight: 0.80 },
    { term: 'thr',                         weight: 0.75 },
    { term: 'gaji',                        weight: 0.70 },
    { term: 'upah',                        weight: 0.55 },
    { term: 'honor',                       weight: 0.40 },
  ],

  // ── LOAN_PAYMENT ─────────────────────────────────────────────────────────────
  LOAN_PAYMENT: [
    { term: 'angsuran kredit',             weight: 0.95 },
    { term: 'cicilan kpr',                 weight: 0.95 },
    { term: 'cicilan leasing',             weight: 0.95 },
    { term: 'loan repayment',              weight: 0.93 },
    { term: 'pembayaran pinjaman',         weight: 0.92 },
    { term: 'pelunasan pinjaman',          weight: 0.92 },
    { term: 'pokok pinjaman',              weight: 0.90 },
    { term: 'angsuran pinjaman',           weight: 0.90 },
    { term: 'cicilan pinjaman',            weight: 0.90 },
    { term: 'repayment',                   weight: 0.80 },
    { term: 'debt repayment',              weight: 0.85 },
    { term: 'loan payment',                weight: 0.83 },
    { term: 'kredit kendaraan',            weight: 0.85 },
    { term: 'angsuran',                    weight: 0.68 },
    { term: 'cicilan',                     weight: 0.65 },
    { term: 'pinjaman',                    weight: 0.50 },
    { term: 'kredit',                      weight: 0.30 },
  ],

  // ── TAX_PAYMENT ──────────────────────────────────────────────────────────────
  TAX_PAYMENT: [
    { term: 'setoran pajak penghasilan',   weight: 0.97 },
    { term: 'setoran pajak pertambahan nilai', weight: 0.97 },
    { term: 'pembayaran pph',              weight: 0.95 },
    { term: 'pembayaran ppn',              weight: 0.95 },
    { term: 'setoran pph',                 weight: 0.95 },
    { term: 'setoran ppn',                 weight: 0.95 },
    { term: 'bayar pajak',                 weight: 0.90 },
    { term: 'tax payment',                 weight: 0.90 },
    { term: 'surat setoran pajak',         weight: 0.95 },
    { term: 'ssp',                         weight: 0.80 },
    { term: 'pajak penghasilan',           weight: 0.88 },
    { term: 'pajak pertambahan nilai',     weight: 0.88 },
    { term: 'bphtb',                       weight: 0.88 },
    { term: 'pbb',                         weight: 0.80 },
    { term: 'pph 21',                      weight: 0.92 },
    { term: 'ppn masukan',                 weight: 0.88 },
    { term: 'ppn keluaran',                weight: 0.88 },
    { term: 'cukai',                       weight: 0.85 },
    { term: 'pajak',                       weight: 0.55 },
    { term: 'ppn',                         weight: 0.70 },
    { term: 'pph',                         weight: 0.70 },
    { term: 'tax',                         weight: 0.40 },
  ],

  // Specific tax intents. Keep article-specific phrases ahead of umbrella
  // TAX_PAYMENT so "PPh23" cannot fall through to generic expense handling.
  VAT_PAYMENT: [
    { term: 'ppn masukan',                 weight: 0.99 },
    { term: 'ppn keluaran',                weight: 0.99 },
    { term: 'vat input',                   weight: 0.98 },
    { term: 'vat output',                  weight: 0.98 },
    { term: 'faktur pajak masukan',        weight: 0.99 },
    { term: 'faktur pajak keluaran',       weight: 0.99 },
    { term: 'pajak pertambahan nilai',     weight: 0.96 },
    { term: 'pembayaran ppn',              weight: 0.95 },
    { term: 'setoran ppn',                 weight: 0.95 },
    { term: 'ppn',                          weight: 0.82 },
    { term: 'vat',                          weight: 0.70 },
  ],

  INCOME_TAX: [
    { term: 'pph pasal 4 ayat 2',          weight: 0.99 },
    { term: 'pph final',                    weight: 0.99 },
    { term: 'pajak penghasilan pasal 21',  weight: 0.99 },
    { term: 'pajak penghasilan pasal 22',  weight: 0.99 },
    { term: 'pajak penghasilan pasal 23',  weight: 0.99 },
    { term: 'pajak penghasilan pasal 25',  weight: 0.99 },
    { term: 'pajak penghasilan pasal 26',  weight: 0.99 },
    { term: 'pph 21',                       weight: 0.96 },
    { term: 'pph21',                        weight: 0.96 },
    { term: 'pph 22',                       weight: 0.96 },
    { term: 'pph22',                        weight: 0.96 },
    { term: 'pph 23',                       weight: 0.96 },
    { term: 'pph23',                        weight: 0.96 },
    { term: 'pph 25',                       weight: 0.96 },
    { term: 'pph25',                        weight: 0.96 },
    { term: 'pph 26',                       weight: 0.96 },
    { term: 'pph26',                        weight: 0.96 },
    { term: 'pasal 21',                     weight: 0.94 },
    { term: 'pasal 22',                     weight: 0.94 },
    { term: 'pasal 23',                     weight: 0.94 },
    { term: 'pasal 25',                     weight: 0.94 },
    { term: 'pasal 26',                     weight: 0.94 },
    { term: 'pasal 4 ayat 2',               weight: 0.94 },
    { term: 'pajak penghasilan',            weight: 0.84 },
    { term: 'pembayaran pph',               weight: 0.90 },
    { term: 'setoran pph',                  weight: 0.90 },
  ],

  IMPORT_DUTY: [
    { term: 'bea masuk',                    weight: 0.99 },
    { term: 'import duty',                  weight: 0.99 },
    { term: 'pajak impor',                  weight: 0.97 },
    { term: 'import tax',                   weight: 0.95 },
  ],

  CUSTOMS_DUTY: [
    { term: 'customs duty',                 weight: 0.99 },
    { term: 'customs',                      weight: 0.86 },
    { term: 'kepabeanan',                   weight: 0.92 },
    { term: 'bea cukai',                    weight: 0.92 },
  ],

  STAMP_DUTY: [
    { term: 'bea materai',                  weight: 0.99 },
    { term: 'bea meterai',                  weight: 0.99 },
    { term: 'e materai',                    weight: 0.98 },
    { term: 'e meterai',                    weight: 0.98 },
    { term: 'materai',                      weight: 0.88 },
    { term: 'meterai',                      weight: 0.88 },
  ],

  TAX_PENALTY: [
    { term: 'denda pajak',                  weight: 0.99 },
    { term: 'sanksi pajak',                 weight: 0.99 },
    { term: 'tax penalty',                  weight: 0.99 },
    { term: 'tax fine',                     weight: 0.98 },
    { term: 'denda keterlambatan pajak',    weight: 0.99 },
  ],

  TAX_REFUND: [
    { term: 'restitusi pajak',              weight: 0.99 },
    { term: 'pengembalian pajak',           weight: 0.99 },
    { term: 'tax refund',                   weight: 0.99 },
    { term: 'refund pajak',                 weight: 0.99 },
  ],

  TAX_INTEREST: [
    { term: 'bunga pajak',                  weight: 0.99 },
    { term: 'tax interest',                 weight: 0.99 },
    { term: 'sanksi bunga pajak',           weight: 0.99 },
  ],

  EXCISE_TAX: [
    { term: 'cukai',                         weight: 0.98 },
    { term: 'excise tax',                    weight: 0.99 },
    { term: 'excise',                        weight: 0.90 },
  ],

  LOCAL_TAX: [
    { term: 'pajak daerah',                 weight: 0.99 },
    { term: 'retribusi daerah',             weight: 0.99 },
    { term: 'retribusi',                    weight: 0.88 },
    { term: 'bphtb',                        weight: 0.96 },
    { term: 'pbb',                          weight: 0.92 },
  ],

  VEHICLE_TAX: [
    { term: 'pajak kendaraan',              weight: 0.99 },
    { term: 'pajak kendaraan bermotor',     weight: 0.99 },
    { term: 'pkb',                          weight: 0.95 },
    { term: 'samsat',                       weight: 0.96 },
  ],

  // ── INTERNAL_TRANSFER ────────────────────────────────────────────────────────
  INTERNAL_TRANSFER: [
    { term: 'transfer antar rekening sendiri', weight: 0.97 },
    { term: 'pemindahan kas internal',     weight: 0.95 },
    { term: 'transfer antar rekening perusahaan', weight: 0.95 },
    { term: 'intercompany transfer',       weight: 0.93 },
    { term: 'transfer intercompany',       weight: 0.93 },
    { term: 'kas besar ke kas kecil',      weight: 0.95 },
    { term: 'kas kecil ke kas besar',      weight: 0.95 },
    { term: 'transfer internal',           weight: 0.90 },
    { term: 'intrabank transfer',          weight: 0.90 },
    { term: 'internal fund transfer',      weight: 0.90 },
    { term: 'pemindahan dana',             weight: 0.85 },
    { term: 'transfer antar rek',          weight: 0.85 },
    { term: 'kas besar',                   weight: 0.75 },
    { term: 'petty cash',                  weight: 0.70 },
    { term: 'kas kecil',                   weight: 0.70 },
    { term: 'antar rekening',              weight: 0.65 },
    { term: 'internal',                    weight: 0.25 },
  ],

  // ── REFUND ───────────────────────────────────────────────────────────────────
  REFUND: [
    { term: 'pengembalian dana pelanggan', weight: 0.97 },
    { term: 'pengembalian pembayaran',     weight: 0.95 },
    { term: 'refund dana',                 weight: 0.95 },
    { term: 'customer refund',             weight: 0.92 },
    { term: 'pengembalian dana',           weight: 0.92 },  // "return of funds" — strong REFUND signal
    { term: 'balik dana',                  weight: 0.90 },
    { term: 'retur pembayaran',            weight: 0.90 },
    { term: 'credit memo',                 weight: 0.85 },
    { term: 'refund',                      weight: 0.80 },
    { term: 'pengembalian',                weight: 0.75 },
    { term: 'retur',                       weight: 0.45 },
    { term: 'kembali',                     weight: 0.35 },
    { term: 'balik',                       weight: 0.25 },
  ],

  // ── CASHBACK ─────────────────────────────────────────────────────────────────
  CASHBACK: [
    { term: 'cashback program',            weight: 0.97 },
    { term: 'reward cashback',             weight: 0.95 },
    { term: 'cashback transaksi',          weight: 0.95 },
    { term: 'program cashback',            weight: 0.93 },
    { term: 'premi cashback',              weight: 0.92 },
    { term: 'cashback pembelian',          weight: 0.90 },
    { term: 'cash back',                   weight: 0.85 },
    { term: 'reward bank',                 weight: 0.80 },
    { term: 'loyalty reward',              weight: 0.80 },
    { term: 'bonus transaksi',             weight: 0.75 },
    { term: 'cashback',                    weight: 0.82 },
    { term: 'reward',                      weight: 0.45 },
    { term: 'bonus',                       weight: 0.30 },
    { term: 'diskon masuk',                weight: 0.55 },
  ],

  // ── BANK_CHARGE ──────────────────────────────────────────────────────────────
  BANK_CHARGE: [
    { term: 'denda keterlambatan',         weight: 0.95 },
    { term: 'biaya penalti',               weight: 0.95 },
    { term: 'late payment fee',            weight: 0.93 },
    { term: 'service charge bank',         weight: 0.92 },
    { term: 'penalti bank',                weight: 0.90 },
    { term: 'denda bank',                  weight: 0.90 },
    { term: 'biaya overdraft',             weight: 0.90 },
    { term: 'overdraft fee',               weight: 0.90 },
    { term: 'service charge',              weight: 0.72 },
    { term: 'bank charge',                 weight: 0.80 },
    { term: 'bank charges',                weight: 0.80 },
    { term: 'denda',                       weight: 0.55 },
    { term: 'penalti',                     weight: 0.55 },
    { term: 'charge',                      weight: 0.25 },
  ],

  // ── BANK_REVERSAL ────────────────────────────────────────────────────────────
  BANK_REVERSAL: [
    { term: 'reversal transaksi',          weight: 0.97 },
    { term: 'pembalikan transaksi',        weight: 0.97 },
    { term: 'debit reversal',              weight: 0.95 },
    { term: 'credit reversal',             weight: 0.95 },
    { term: 'storno transaksi',            weight: 0.95 },
    { term: 'jurnal koreksi',              weight: 0.92 },
    { term: 'koreksi transaksi',           weight: 0.90 },
    { term: 'transaction reversal',        weight: 0.90 },
    { term: 'pembatalan transaksi',        weight: 0.88 },
    { term: 'batal transfer',              weight: 0.85 },
    { term: 'reversal',                    weight: 0.78 },
    { term: 'storno',                      weight: 0.75 },
    { term: 'koreksi',                     weight: 0.50 },
    { term: 'pembatalan',                  weight: 0.40 },
    { term: 'rev',                         weight: 0.25 },
  ],

  // ── CHEQUE ───────────────────────────────────────────────────────────────────
  CHEQUE: [
    { term: 'pencairan cek',               weight: 0.97 },
    { term: 'kliring cek',                 weight: 0.95 },
    { term: 'warkat cek',                  weight: 0.95 },
    { term: 'pembayaran cek',              weight: 0.92 },
    { term: 'cheque clearance',            weight: 0.92 },
    { term: 'bayar cek',                   weight: 0.90 },
    { term: 'terima cek',                  weight: 0.88 },
    { term: 'cheque payment',              weight: 0.88 },
    { term: 'check clearance',             weight: 0.88 },
    { term: 'cek',                         weight: 0.65 },
    { term: 'cheque',                      weight: 0.65 },
    { term: 'check',                       weight: 0.35 }, // low — English "check" is ambiguous
  ],

  // ── GIRO ─────────────────────────────────────────────────────────────────────
  GIRO: [
    { term: 'pencairan bilyet giro',       weight: 0.97 },
    { term: 'kliring bilyet giro',         weight: 0.95 },
    { term: 'warkat bilyet giro',          weight: 0.95 },
    { term: 'bilyet giro',                 weight: 0.92 },
    { term: 'kliring giro',                weight: 0.90 },
    { term: 'pembayaran giro',             weight: 0.88 },
    { term: 'giro clearing',               weight: 0.88 },
    { term: 'bg clearing',                 weight: 0.85 },
    { term: 'warkat giro',                 weight: 0.88 },
    { term: 'bg',                          weight: 0.45 }, // ambiguous alone
    { term: 'giro',                        weight: 0.55 }, // see also INTEREST_INCOME for "jasa giro"
  ],

  // ── INTEREST_TAX_WITHHOLDING ─────────────────────────────────────────────────
  INTEREST_TAX_WITHHOLDING: [
    { term: 'pph final bunga bank',          weight: 0.95 },
    { term: 'pph final atas bunga',          weight: 0.95 },
    { term: 'pajak bunga bank',              weight: 0.90 },
    { term: 'pajak bunga deposito',          weight: 0.90 },
    { term: 'pot pajak bunga',              weight: 0.88 },
    { term: 'potongan pajak bunga',         weight: 0.88 },
    { term: 'pajak jasa giro',              weight: 0.85 },
    { term: 'withholding tax interest',     weight: 0.90 },
    { term: 'interest tax',                weight: 0.85 },
    { term: 'bank interest tax',           weight: 0.90 },
  ],

  // ── UNKNOWN ──────────────────────────────────────────────────────────────────
  // No keywords — UNKNOWN is only assigned when no other intent wins.
  UNKNOWN: [],
};

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Returns all dictionary entries for a given intent (empty array for UNKNOWN). */
export function getEntries(intent: TransactionIntent): readonly DictionaryEntry[] {
  return TRANSACTION_DICTIONARY[intent];
}

/** All intents that have at least one dictionary entry (excludes UNKNOWN). */
export const CLASSIFIABLE_INTENTS = (
  Object.keys(TRANSACTION_DICTIONARY) as TransactionIntent[]
).filter((k) => TRANSACTION_DICTIONARY[k].length > 0);

// ─── Bank abbreviation normalizations ─────────────────────────────────────────

/**
 * Applied during normalization before dictionary lookup.
 * Maps raw bank abbreviations/symbols to canonical uppercase tokens.
 */
export const BANK_ABBREVIATION_MAP: ReadonlyArray<[string, string]> = [
  // Transfer systems
  ["BI-FAST", "BI FAST"],
  ["BIFAST",  "BI FAST"],
  ["B.I.FAST","BI FAST"],
  // Common punctuation-as-separator patterns in bank descriptions
  ["/",  " "],
  ["\\", " "],
  ["-",  " "],
  ["_",  " "],
  [".",  " "],
  [",",  " "],
  [":",  " "],
  [";",  " "],
  ["(",  " "],
  [")",  " "],
  ["[",  " "],
  ["]",  " "],
];

