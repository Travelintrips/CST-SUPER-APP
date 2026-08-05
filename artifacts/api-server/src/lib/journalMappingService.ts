/**
 * Journal Mapping Service
 * Helper untuk jurnal akuntansi otomatis:
 * - Kasbon / Employee Advance        : DR Piutang Karyawan / CR Bank
 * - Talangan                          : DR Piutang Talangan / CR Bank
 * - Pinjaman Bank/Leasing (cair)      : DR Bank / CR Hutang Bank/Leasing
 * - Cicilan Pinjaman                  : DR Hutang + DR Bunga / CR Bank
 * - Pembelian Aset Tetap              : DR Aset Tetap / CR Bank
 * - Penyusutan Aset                   : DR Beban Penyusutan / CR Akum. Depresiasi
 */

import { db, chartOfAccountsTable, accountingSettingsTable, accountingJournalsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { postEntry } from "./accounting.js";

// ── COA resolver ──────────────────────────────────────────────────────────────

async function findCOA(companyId: number, codePrefix: string): Promise<number | null> {
  const rows = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(
      sql`${chartOfAccountsTable.companyId} = ${companyId}
          AND ${chartOfAccountsTable.code} LIKE ${codePrefix + "%"}
          AND ${chartOfAccountsTable.isActive} = true`,
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

const COMPANY_SUFFIX: Record<number, string> = { 1: "CST", 2: "WS", 3: "DV", 4: "ER" };

function codeSuffix(companyId: number): string {
  return COMPANY_SUFFIX[companyId] ?? "CST";
}

interface ResolvedAccounts {
  bank: number | null;
  cash: number | null;
  bankJournalId: number | null;
  cashJournalId: number | null;
  generalJournalId: number | null;
  kasbonReceivable: number | null;
  talangReceivable: number | null;
  hutangBankPendek: number | null;
  hutangLeasingPendek: number | null;
  hutangBankPanjang: number | null;
  bebanPenyusutan: number | null;
  bebanBunga: number | null;
  asetTetap: number | null;
  akumDepresiasi: number | null;
}

async function resolveAccounts(companyId: number): Promise<ResolvedAccounts> {
  const s = codeSuffix(companyId);

  // Ambil accounting_settings untuk bank/cash account + journal IDs
  const [settings] = await db
    .select()
    .from(accountingSettingsTable)
    .where(eq(accountingSettingsTable.companyId, companyId))
    .limit(1);

  // Resolve general journal for depreciation/adjustments
  const [genJ] = await db
    .select({ id: accountingJournalsTable.id })
    .from(accountingJournalsTable)
    .where(
      sql`${accountingJournalsTable.type} = 'general'
          AND (${accountingJournalsTable.code} LIKE ${"%" + s + "%"}
          OR ${accountingJournalsTable.companyId} = ${companyId})`,
    )
    .limit(1);

  const [
    kasbonReceivable, talangReceivable,
    hutangBankPendek, hutangLeasingPendek, hutangBankPanjang,
    bebanPenyusutan, bebanBunga, asetTetap, akumDepresiasi,
  ] = await Promise.all([
    findCOA(companyId, `1-1032-${s}`),  // Piutang Karyawan (Kasbon)
    findCOA(companyId, `1-1033-${s}`),  // Piutang Dana Talangan
    findCOA(companyId, `2-1050-${s}`),  // Hutang Bank Jangka Pendek
    findCOA(companyId, `2-1055-${s}`),  // Hutang Leasing Jangka Pendek
    findCOA(companyId, `2-2020-${s}`),  // Hutang Bank Jangka Panjang
    findCOA(companyId, `5-2100-${s}`),  // Beban Penyusutan
    findCOA(companyId, `5-3010-${s}`),  // Beban Bunga & Administrasi Bank
    findCOA(companyId, `1-2010-${s}`),  // Aset Tetap
    findCOA(companyId, `1-2020-${s}`),  // Akumulasi Depresiasi
  ]);

  return {
    bank:              settings?.defaultBankAccountId ?? null,
    cash:              settings?.defaultCashAccountId ?? null,
    bankJournalId:     settings?.bankJournalId ?? null,
    cashJournalId:     settings?.cashJournalId ?? null,
    generalJournalId:  genJ?.id ?? null,
    kasbonReceivable,
    talangReceivable,
    hutangBankPendek,
    hutangLeasingPendek,
    hutangBankPanjang,
    bebanPenyusutan,
    bebanBunga,
    asetTetap,
    akumDepresiasi,
  };
}

// ── Kasbon / Employee Advance ─────────────────────────────────────────────────

export interface KasbonJournalParams {
  companyId: number;
  advanceId?: number;
  ref: string;
  description?: string;
  amount: number;
  date: Date;
  paymentMethod?: "cash" | "bank";
}

/** Disbursement: DR Piutang Karyawan / CR Bank */
export async function postKasbonJournal(p: KasbonJournalParams) {
  const accts = await resolveAccounts(p.companyId);
  const isCash = p.paymentMethod === "cash";
  const creditId = isCash ? accts.cash : accts.bank;
  const debitId  = accts.kasbonReceivable;

  if (!creditId || !debitId) throw new Error(`Akun Kasbon/Bank belum terkonfigurasi untuk company ${p.companyId}`);

  const journalId = isCash ? accts.cashJournalId : accts.bankJournalId;
  if (!journalId) throw new Error(`Jurnal Bank/Kas belum terkonfigurasi untuk company ${p.companyId}`);

  return postEntry({
    journalId,
    date: p.date,
    ref: p.ref,
    description: p.description ?? `Kasbon — ${p.ref}`,
    source: "manual",
    companyId: p.companyId,
    lines: [
      { accountId: debitId,  debit: p.amount, credit: 0,        description: "Piutang Karyawan" },
      { accountId: creditId, debit: 0,         credit: p.amount, description: isCash ? "Kas" : "Bank" },
    ],
  }, isCash ? "KAS" : "BNK");
}

/** Repayment: DR Bank / CR Piutang Karyawan */
export async function postKasbonRepaymentJournal(p: KasbonJournalParams) {
  const accts = await resolveAccounts(p.companyId);
  const isCash = p.paymentMethod === "cash";
  const debitId  = isCash ? accts.cash : accts.bank;
  const creditId = accts.kasbonReceivable;

  if (!debitId || !creditId) throw new Error(`Akun Kasbon belum terkonfigurasi untuk company ${p.companyId}`);

  const journalId = isCash ? accts.cashJournalId : accts.bankJournalId;
  if (!journalId) throw new Error(`Jurnal Bank/Kas belum terkonfigurasi untuk company ${p.companyId}`);

  return postEntry({
    journalId,
    date: p.date,
    ref: p.ref,
    description: p.description ?? `Pelunasan Kasbon — ${p.ref}`,
    source: "manual",
    companyId: p.companyId,
    lines: [
      { accountId: debitId,  debit: p.amount, credit: 0,        description: isCash ? "Kas" : "Bank" },
      { accountId: creditId, debit: 0,         credit: p.amount, description: "Piutang Karyawan" },
    ],
  }, isCash ? "KAS" : "BNK");
}

// ── Talangan / Dana Talangan ──────────────────────────────────────────────────

export interface TalanganJournalParams {
  companyId: number;
  ref: string;
  description?: string;
  amount: number;
  date: Date;
  paymentMethod?: "cash" | "bank";
}

/** Disbursement: DR Piutang Talangan / CR Bank */
export async function postTalanganJournal(p: TalanganJournalParams) {
  const accts = await resolveAccounts(p.companyId);
  const isCash = p.paymentMethod === "cash";
  const creditId = isCash ? accts.cash : accts.bank;
  const debitId  = accts.talangReceivable;

  if (!creditId || !debitId) throw new Error(`Akun Talangan belum terkonfigurasi untuk company ${p.companyId}`);

  const journalId = isCash ? accts.cashJournalId : accts.bankJournalId;
  if (!journalId) throw new Error(`Jurnal Bank/Kas belum terkonfigurasi untuk company ${p.companyId}`);

  return postEntry({
    journalId, date: p.date, ref: p.ref,
    description: p.description ?? `Dana Talangan — ${p.ref}`,
    source: "manual", companyId: p.companyId,
    lines: [
      { accountId: debitId,  debit: p.amount, credit: 0,        description: "Piutang Dana Talangan" },
      { accountId: creditId, debit: 0,         credit: p.amount, description: isCash ? "Kas" : "Bank" },
    ],
  }, isCash ? "KAS" : "BNK");
}

/** Repayment: DR Bank / CR Piutang Talangan */
export async function postTalanganRepaymentJournal(p: TalanganJournalParams) {
  const accts = await resolveAccounts(p.companyId);
  const isCash = p.paymentMethod === "cash";
  const debitId  = isCash ? accts.cash : accts.bank;
  const creditId = accts.talangReceivable;

  if (!debitId || !creditId) throw new Error(`Akun Talangan belum terkonfigurasi untuk company ${p.companyId}`);

  const journalId = isCash ? accts.cashJournalId : accts.bankJournalId;
  if (!journalId) throw new Error(`Jurnal Bank/Kas belum terkonfigurasi untuk company ${p.companyId}`);

  return postEntry({
    journalId, date: p.date, ref: p.ref,
    description: p.description ?? `Pelunasan Talangan — ${p.ref}`,
    source: "manual", companyId: p.companyId,
    lines: [
      { accountId: debitId,  debit: p.amount, credit: 0,        description: isCash ? "Kas" : "Bank" },
      { accountId: creditId, debit: 0,         credit: p.amount, description: "Piutang Dana Talangan" },
    ],
  }, isCash ? "KAS" : "BNK");
}

// ── Bank Loan / Leasing ───────────────────────────────────────────────────────

export interface LoanDisbursementParams {
  companyId: number;
  ref: string;
  description?: string;
  principalAmount: number;
  adminFee?: number;
  date: Date;
  loanType?: "bank" | "leasing";
  isLongTerm?: boolean;
}

/** Pencairan pinjaman: DR Bank / CR Hutang Bank atau Hutang Leasing */
export async function postLoanDisbursementJournal(p: LoanDisbursementParams) {
  const accts = await resolveAccounts(p.companyId);
  const bankId = accts.bank;

  let liabilityId: number | null;
  if (p.loanType === "leasing") {
    liabilityId = accts.hutangLeasingPendek;
  } else if (p.isLongTerm) {
    liabilityId = accts.hutangBankPanjang;
  } else {
    liabilityId = accts.hutangBankPendek;
  }

  if (!bankId || !liabilityId) throw new Error(`Akun Hutang Bank/Leasing belum terkonfigurasi untuk company ${p.companyId}`);

  const journalId = accts.bankJournalId;
  if (!journalId) throw new Error(`Jurnal Bank belum terkonfigurasi untuk company ${p.companyId}`);

  const adminFee = p.adminFee ?? 0;
  const netToBank = p.principalAmount - adminFee;

  const lines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [
    { accountId: bankId,      debit: netToBank,           credit: 0,                  description: "Penerimaan Pinjaman" },
    { accountId: liabilityId, debit: 0,                    credit: p.principalAmount,  description: p.loanType === "leasing" ? "Hutang Leasing" : "Hutang Bank" },
  ];

  if (adminFee > 0 && accts.bebanBunga) {
    lines.push({ accountId: accts.bebanBunga, debit: adminFee, credit: 0, description: "Biaya Admin Pinjaman" });
  }

  return postEntry({
    journalId, date: p.date, ref: p.ref,
    description: p.description ?? `Pinjaman ${p.loanType === "leasing" ? "Leasing" : "Bank"} — ${p.ref}`,
    source: "manual", companyId: p.companyId, lines,
  }, "BNK");
}

export interface LoanRepaymentParams {
  companyId: number;
  ref: string;
  description?: string;
  principalAmount: number;
  interestAmount: number;
  date: Date;
  loanType?: "bank" | "leasing";
  isLongTerm?: boolean;
}

/** Cicilan: DR Hutang Pokok + DR Beban Bunga / CR Bank */
export async function postLoanRepaymentJournal(p: LoanRepaymentParams) {
  const accts = await resolveAccounts(p.companyId);
  const bankId = accts.bank;

  let liabilityId: number | null;
  if (p.loanType === "leasing") {
    liabilityId = accts.hutangLeasingPendek;
  } else if (p.isLongTerm) {
    liabilityId = accts.hutangBankPanjang;
  } else {
    liabilityId = accts.hutangBankPendek;
  }

  if (!bankId || !liabilityId) throw new Error(`Akun Hutang Bank/Leasing belum terkonfigurasi untuk company ${p.companyId}`);

  const journalId = accts.bankJournalId;
  if (!journalId) throw new Error(`Jurnal Bank belum terkonfigurasi untuk company ${p.companyId}`);

  const total = p.principalAmount + p.interestAmount;
  const lines: Array<{ accountId: number; debit: number; credit: number; description: string }> = [
    { accountId: liabilityId, debit: p.principalAmount,  credit: 0,     description: "Cicilan Pokok" },
    { accountId: bankId,      debit: 0,                   credit: total, description: "Pembayaran Bank" },
  ];

  if (p.interestAmount > 0 && accts.bebanBunga) {
    lines.splice(1, 0, {
      accountId: accts.bebanBunga,
      debit: p.interestAmount, credit: 0,
      description: "Beban Bunga",
    });
  }

  return postEntry({
    journalId, date: p.date, ref: p.ref,
    description: p.description ?? `Cicilan ${p.loanType === "leasing" ? "Leasing" : "Bank"} — ${p.ref}`,
    source: "manual", companyId: p.companyId, lines,
  }, "BNK");
}

// ── Fixed Asset ───────────────────────────────────────────────────────────────

export interface AssetPurchaseParams {
  companyId: number;
  ref: string;
  description?: string;
  assetName: string;
  purchasePrice: number;
  date: Date;
  paymentMethod?: "cash" | "bank";
  assetAccountId?: number;
}

/** Pembelian: DR Aset Tetap / CR Bank */
export async function postAssetPurchaseJournal(p: AssetPurchaseParams) {
  const accts = await resolveAccounts(p.companyId);
  const isCash = p.paymentMethod === "cash";
  const creditId = isCash ? accts.cash : accts.bank;
  const debitId  = p.assetAccountId ?? accts.asetTetap;

  if (!creditId || !debitId) throw new Error(`Akun Aset Tetap/Bank belum terkonfigurasi untuk company ${p.companyId}`);

  const journalId = isCash ? accts.cashJournalId : accts.bankJournalId;
  if (!journalId) throw new Error(`Jurnal Bank/Kas belum terkonfigurasi untuk company ${p.companyId}`);

  return postEntry({
    journalId, date: p.date, ref: p.ref,
    description: p.description ?? `Pembelian Aset ${p.assetName} — ${p.ref}`,
    source: "manual", companyId: p.companyId,
    lines: [
      { accountId: debitId,  debit: p.purchasePrice, credit: 0,               description: p.assetName },
      { accountId: creditId, debit: 0,                credit: p.purchasePrice, description: isCash ? "Kas" : "Bank" },
    ],
  }, isCash ? "KAS" : "BNK");
}

export interface DepreciationParams {
  companyId: number;
  ref: string;
  description?: string;
  assetName: string;
  depreciationAmount: number;
  date: Date;
  accumAccountId?: number;
}

/** Penyusutan: DR Beban Penyusutan / CR Akumulasi Depresiasi */
export async function postDepreciationJournal(p: DepreciationParams) {
  const accts = await resolveAccounts(p.companyId);
  const debitId  = accts.bebanPenyusutan;
  const creditId = p.accumAccountId ?? accts.akumDepresiasi;

  if (!debitId || !creditId) throw new Error(`Akun Beban/Akumulasi Penyusutan belum terkonfigurasi untuk company ${p.companyId}`);

  const journalId = accts.generalJournalId;
  if (!journalId) throw new Error(`Jurnal Memorial belum terkonfigurasi untuk company ${p.companyId}`);

  return postEntry({
    journalId, date: p.date, ref: p.ref,
    description: p.description ?? `Penyusutan ${p.assetName} — ${p.ref}`,
    source: "manual", companyId: p.companyId,
    lines: [
      { accountId: debitId,  debit: p.depreciationAmount, credit: 0,                     description: `Beban Penyusutan ${p.assetName}` },
      { accountId: creditId, debit: 0,                     credit: p.depreciationAmount,  description: `Akum. Depresiasi ${p.assetName}` },
    ],
  }, "JU");
}

// ── Summary ───────────────────────────────────────────────────────────────────

export async function getJournalMappingSummary(companyId: number) {
  const accts = await resolveAccounts(companyId);
  return {
    kasbon: {
      debitAccountId:  accts.kasbonReceivable,
      creditAccountId: accts.bank,
      label:  "DR Piutang Karyawan (Kasbon) / CR Bank",
      reverse: "DR Bank / CR Piutang Karyawan",
    },
    talangan: {
      debitAccountId:  accts.talangReceivable,
      creditAccountId: accts.bank,
      label:  "DR Piutang Dana Talangan / CR Bank",
      reverse: "DR Bank / CR Piutang Dana Talangan",
    },
    bank_loan_disbursement: {
      debitAccountId:  accts.bank,
      creditAccountId: accts.hutangBankPendek,
      label:  "DR Bank / CR Hutang Bank Jangka Pendek",
    },
    bank_loan_longterm_disbursement: {
      debitAccountId:  accts.bank,
      creditAccountId: accts.hutangBankPanjang,
      label:  "DR Bank / CR Hutang Bank Jangka Panjang",
    },
    leasing_disbursement: {
      debitAccountId:  accts.bank,
      creditAccountId: accts.hutangLeasingPendek,
      label:  "DR Bank / CR Hutang Leasing Jangka Pendek",
    },
    loan_repayment: {
      debitAccountId1: accts.hutangBankPendek,
      debitAccountId2: accts.bebanBunga,
      creditAccountId: accts.bank,
      label:  "DR Hutang Pokok + DR Beban Bunga / CR Bank",
    },
    fixed_asset_purchase: {
      debitAccountId:  accts.asetTetap,
      creditAccountId: accts.bank,
      label:  "DR Aset Tetap / CR Bank",
    },
    depreciation: {
      debitAccountId:  accts.bebanPenyusutan,
      creditAccountId: accts.akumDepresiasi,
      label:  "DR Beban Penyusutan / CR Akumulasi Depresiasi",
    },
  };
}

logger.debug("[journalMappingService] loaded");
