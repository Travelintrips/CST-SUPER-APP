/**
 * COA Tax Hierarchy Migration — Restructure Tax COA
 *
 * Creates governance change requests (via Task #5) to establish:
 *   A. Header KEWAJIBAN PAJAK (2-1090-CST) + subaccounts
 *
 * CODE COLLISION NOTE:
 *   2-1060 is reserved by "Hutang Intercompany - PT Diva Servis" in company CST.
 *   Safe code selected: 2-1090 (Kewajiban Pajak header), children 2-1091…2-1102.
 *   B. Header ASET PAJAK (1-1070-CST) + subaccounts
 *   C. Header BEBAN PAJAK (5-3040-CST) + subaccounts
 *   D. Reparenting of existing accounts to new headers
 *
 * Safety rules (strictly enforced):
 *   ✗ No direct UPDATE to master COA
 *   ✗ No auto-approve
 *   ✗ No journal mutation
 *   ✗ No balance rewrite
 *   ✓ All changes via change requests (maker-checker flow)
 *   ✓ Idempotent (idempotency keys prevent duplicate requests)
 *   ✓ Existing accounts with journal history: reparent only, never delete
 *
 * This migration ONLY creates DRAFT/PENDING_APPROVAL change requests.
 * A checker must review and approve via the COA Governance UI.
 */

import { db } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { chartOfAccountsTable, coaChangeRequestsTable } from "@workspace/db/schema/accounting";
import { createChangeRequest, submitChangeRequest } from "./coaChangeRequestService.js";
import { logger } from "../logger.js";

// ─── Maker identity for this system migration ──────────────────────────────────
const MIGRATION_MAKER = "system:coa-tax-migration-v1";
const MIGRATION_IDEMPOTENCY_PREFIX = "coa-tax-v1";

// ─── Target structure definition ───────────────────────────────────────────────

interface TaxHeaderDef {
  baseCode: string;       // e.g. "2-1090"
  name: string;           // e.g. "Kewajiban Pajak"
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  category: string;       // e.g. "LIABILITY"
  normalBalance: "DEBIT" | "CREDIT";
  globalParentCode: string; // global parent, e.g. "2-1000"
}

interface TaxSubaccountDef {
  baseCode: string;         // e.g. "2-1061"
  name: string;             // e.g. "Hutang PPN"
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  category: string;
  normalBalance: "DEBIT" | "CREDIT";
  headerBaseCode: string;   // parent header base code, e.g. "2-1090"
}

interface ExistingAccountReparentDef {
  existingBaseCode: string; // e.g. "2-1030"
  newHeaderBaseCode: string; // e.g. "2-1090"
  reason: string;
}

// ─── A. KEWAJIBAN PAJAK ────────────────────────────────────────────────────────

const KEWAJIBAN_PAJAK_HEADER: TaxHeaderDef = {
  // 2-1060 is occupied by "Hutang Intercompany - PT Diva Servis" in company CST.
  // Safe alternative: 2-1090. Children: 2-1091 through 2-1102.
  baseCode:       "2-1090",
  name:           "Kewajiban Pajak",
  type:           "liability",
  category:       "LIABILITY",
  normalBalance:  "CREDIT",
  globalParentCode: "2-1000",
};

const KEWAJIBAN_PAJAK_SUBACCOUNTS: TaxSubaccountDef[] = [
  // 2-1060 occupied by Hutang Intercompany. Header = 2-1090; children = 2-1091…2-1102.
  { baseCode: "2-1091", name: "Hutang PPN",                        type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1092", name: "Hutang PPh Pasal 21",               type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1093", name: "Hutang PPh Pasal 22",               type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1094", name: "Hutang PPh Pasal 23",               type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1095", name: "Hutang PPh Pasal 25",               type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1096", name: "Hutang PPh Pasal 26",               type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1097", name: "Hutang PPh Pasal 29",               type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1098", name: "Hutang PPh Final Pasal 4 Ayat 2",   type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1099", name: "Hutang Pajak Daerah",               type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1100", name: "Hutang Pajak Kendaraan",            type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1101", name: "Hutang Bea Masuk",                  type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
  { baseCode: "2-1102", name: "Hutang Cukai",                      type: "liability", category: "LIABILITY", normalBalance: "CREDIT", headerBaseCode: "2-1090" },
];

// ─── B. ASET PAJAK ─────────────────────────────────────────────────────────────

const ASET_PAJAK_HEADER: TaxHeaderDef = {
  baseCode:       "1-1070",
  name:           "Aset Pajak",
  type:           "asset",
  category:       "ASSET",
  normalBalance:  "DEBIT",
  globalParentCode: "1-1000",
};

const ASET_PAJAK_SUBACCOUNTS: TaxSubaccountDef[] = [
  { baseCode: "1-1071", name: "Pajak Dibayar Dimuka",  type: "asset", category: "ASSET", normalBalance: "DEBIT", headerBaseCode: "1-1070" },
  { baseCode: "1-1072", name: "Piutang Pajak",         type: "asset", category: "ASSET", normalBalance: "DEBIT", headerBaseCode: "1-1070" },
  { baseCode: "1-1073", name: "Lebih Bayar Pajak",     type: "asset", category: "ASSET", normalBalance: "DEBIT", headerBaseCode: "1-1070" },
  { baseCode: "1-1074", name: "Kredit Pajak PPh 22",   type: "asset", category: "ASSET", normalBalance: "DEBIT", headerBaseCode: "1-1070" },
  { baseCode: "1-1075", name: "Kredit Pajak PPh 23",   type: "asset", category: "ASSET", normalBalance: "DEBIT", headerBaseCode: "1-1070" },
  { baseCode: "1-1076", name: "Kredit Pajak PPh 25",   type: "asset", category: "ASSET", normalBalance: "DEBIT", headerBaseCode: "1-1070" },
];

// ─── C. BEBAN PAJAK ────────────────────────────────────────────────────────────

const BEBAN_PAJAK_HEADER: TaxHeaderDef = {
  baseCode:       "5-3040",
  name:           "Beban Pajak",
  type:           "expense",
  category:       "EXPENSE",
  normalBalance:  "DEBIT",
  globalParentCode: "5-3000",
};

const BEBAN_PAJAK_SUBACCOUNTS: TaxSubaccountDef[] = [
  { baseCode: "5-3041", name: "Beban Bea Materai",                    type: "expense", category: "EXPENSE",       normalBalance: "DEBIT", headerBaseCode: "5-3040" },
  { baseCode: "5-3042", name: "Beban Pajak Daerah",                   type: "expense", category: "EXPENSE",       normalBalance: "DEBIT", headerBaseCode: "5-3040" },
  { baseCode: "5-3043", name: "Beban Pajak Kendaraan",                type: "expense", category: "EXPENSE",       normalBalance: "DEBIT", headerBaseCode: "5-3040" },
  { baseCode: "5-3044", name: "Beban PPh Final atas Bunga Bank",      type: "expense", category: "EXPENSE",       normalBalance: "DEBIT", headerBaseCode: "5-3040" },
  { baseCode: "5-3045", name: "Beban Denda Pajak",                    type: "expense", category: "OTHER_EXPENSE", normalBalance: "DEBIT", headerBaseCode: "5-3040" },
  { baseCode: "5-3046", name: "Beban Sanksi dan Bunga Pajak",         type: "expense", category: "OTHER_EXPENSE", normalBalance: "DEBIT", headerBaseCode: "5-3040" },
  { baseCode: "5-3047", name: "Beban Pajak Tidak Dapat Dikreditkan",  type: "expense", category: "EXPENSE",       normalBalance: "DEBIT", headerBaseCode: "5-3040" },
  { baseCode: "5-3048", name: "Beban Pajak Lainnya",                  type: "expense", category: "EXPENSE",       normalBalance: "DEBIT", headerBaseCode: "5-3040" },
];

// ─── D. Existing accounts to reparent ─────────────────────────────────────────

const REPARENTING: ExistingAccountReparentDef[] = [
  {
    existingBaseCode:  "2-1030",
    newHeaderBaseCode: "2-1090",
    reason: "Pindahkan Hutang Pajak Lainnya ke bawah header KEWAJIBAN PAJAK (2-1090). Akun tetap postable sebagai fallback terakhir. Kode dan jurnal historis tidak berubah.",
  },
  {
    existingBaseCode:  "5-3020",
    newHeaderBaseCode: "5-3040",
    reason: "Pindahkan Beban Pajak & Perijinan ke bawah header BEBAN PAJAK. Akun tetap postable untuk pajak/perizinan tanpa subakun spesifik. Kode dan jurnal historis tidak berubah.",
  },
  {
    existingBaseCode:  "1-1050",
    newHeaderBaseCode: "1-1070",
    reason: "Pindahkan PPN Masukan ke bawah header ASET PAJAK. Akun tetap postable. Kode dan jurnal historis tidak berubah.",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getCompanyIds(): Promise<number[]> {
  try {
    const rows = await db.execute<{ id: number }>(
      sql`SELECT id FROM companies WHERE is_active = true ORDER BY id`
    );
    return (rows.rows as Array<{ id: number }>).map((r) => r.id);
  } catch {
    return [1]; // fallback
  }
}

async function getCompanyAbbr(companyId: number): Promise<string> {
  try {
    const rows = await db.execute<{ company_code: string }>(
      sql`SELECT company_code FROM companies WHERE id = ${companyId} LIMIT 1`
    );
    const code = (rows.rows as Array<{ company_code: string }>)[0]?.company_code;
    return code ? code.slice(0, 8).toUpperCase() : "CST";
  } catch {
    return companyId === 1 ? "CST" : String(companyId);
  }
}

async function findCoaByCode(code: string, companyId: number): Promise<{ id: number } | null> {
  const [row] = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(
      and(
        eq(chartOfAccountsTable.code, code),
        eq(chartOfAccountsTable.companyId, companyId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findGlobalParentByCode(code: string): Promise<{ id: number } | null> {
  const rows = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(
      sql`${chartOfAccountsTable.code} = ${code} AND ${chartOfAccountsTable.companyId} IS NULL`
    )
    .limit(1);
  return rows[0] ?? null;
}

async function changeRequestAlreadyExists(
  companyId: number,
  idempotencyKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: coaChangeRequestsTable.id })
    .from(coaChangeRequestsTable)
    .where(
      and(
        eq(coaChangeRequestsTable.companyId, companyId),
        eq(coaChangeRequestsTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return !!row;
}

// ─── Main migration function ───────────────────────────────────────────────────

export interface TaxMigrationOptions {
  /** When true, simulate the migration without writing to the database. */
  dryRun?: boolean;
}

export interface TaxMigrationResult {
  companyId: number;
  abbr: string;
  created: string[];
  skipped: string[];
  errors: string[];
  /** Only populated when dryRun=true */
  dryRunProposed?: string[];
}

/**
 * Run the tax COA hierarchy migration for all active companies.
 *
 * Creates DRAFT change requests for:
 * 1. New header accounts (KEWAJIBAN PAJAK, ASET PAJAK, BEBAN PAJAK)
 * 2. New subaccounts under each header
 * 3. Reparenting of existing accounts (2-1030, 5-3020, 1-1050)
 *
 * All change requests start as DRAFT and are auto-submitted to PENDING_APPROVAL.
 * A checker must approve via the COA Governance UI.
 *
 * Idempotent — safe to call multiple times.
 * Does NOT modify production data directly.
 */
export async function runCoaTaxMigration(
  options: TaxMigrationOptions = {},
): Promise<TaxMigrationResult[]> {
  const { dryRun = false } = options;
  const companyIds = await getCompanyIds();
  const results: TaxMigrationResult[] = [];

  if (dryRun) {
    logger.info("[coaTaxMigration] DRY-RUN mode — no database writes will be performed.");
  }

  const HEADERS: TaxHeaderDef[] = [
    KEWAJIBAN_PAJAK_HEADER,
    ASET_PAJAK_HEADER,
    BEBAN_PAJAK_HEADER,
  ];

  const SUBACCOUNTS_BY_HEADER: Record<string, TaxSubaccountDef[]> = {
    "2-1090": KEWAJIBAN_PAJAK_SUBACCOUNTS,
    "1-1070": ASET_PAJAK_SUBACCOUNTS,
    "5-3040": BEBAN_PAJAK_SUBACCOUNTS,
  };

  for (const companyId of companyIds) {
    const abbr = await getCompanyAbbr(companyId);
    const result: TaxMigrationResult = { companyId, abbr, created: [], skipped: [], errors: [], dryRunProposed: dryRun ? [] : undefined };

    // ── Step 1: Create/submit change requests for header accounts ──────────────
    for (const hdr of HEADERS) {
      const companyCode = `${hdr.baseCode}-${abbr}`;
      const idempotencyKey = `${MIGRATION_IDEMPOTENCY_PREFIX}:create-header:${hdr.baseCode}:${abbr}`;

      // Skip if already requested
      if (await changeRequestAlreadyExists(companyId, idempotencyKey)) {
        result.skipped.push(`Header ${companyCode} — change request sudah ada`);
        continue;
      }

      // Skip if account already exists
      const existing = await findCoaByCode(companyCode, companyId);
      if (existing) {
        result.skipped.push(`Header ${companyCode} — akun sudah ada (id=${existing.id})`);
        continue;
      }

      const globalParent = await findGlobalParentByCode(hdr.globalParentCode);
      if (!globalParent) {
        result.errors.push(`Header ${companyCode} — parent global ${hdr.globalParentCode} tidak ditemukan`);
        continue;
      }

      if (dryRun) {
        result.dryRunProposed!.push(`[DRY-RUN] Header ${companyCode} — would CREATE (parent=${hdr.globalParentCode}, is_header=true, is_postable=false)`);
        continue;
      }

      const cr = await createChangeRequest({
        companyId,
        action: "CREATE",
        afterSnapshot: {
          code:            companyCode,
          name:            `${hdr.name} ${abbr}`,
          type:            hdr.type,
          accountCategory: hdr.category,
          normalBalance:   hdr.normalBalance,
          isHeader:        true,
          isPostable:      false,
          parentId:        globalParent.id,
          status:          "ACTIVE",
        },
        reason: `Restructure COA Pajak: buat header akun ${companyCode} (${hdr.name} ${abbr}). Header tidak postable — transaksi harus menggunakan subakun spesifik di bawahnya.`,
        requestedBy:     MIGRATION_MAKER,
        idempotencyKey,
      });

      if (!cr.ok) {
        result.errors.push(`Header ${companyCode}: createChangeRequest gagal — ${cr.error}`);
        continue;
      }

      // Auto-submit to PENDING_APPROVAL
      const submitResult = await submitChangeRequest(cr.data!.id, MIGRATION_MAKER, companyId);
      if (!submitResult.ok) {
        result.errors.push(`Header ${companyCode}: submitChangeRequest gagal — ${submitResult.error}`);
        continue;
      }

      result.created.push(`Header ${companyCode} — CR #${cr.data!.id} → PENDING_APPROVAL`);
    }

    // ── Step 2: Create/submit change requests for subaccounts ──────────────────
    for (const hdr of HEADERS) {
      const headerCompanyCode = `${hdr.baseCode}-${abbr}`;
      const subaccounts = SUBACCOUNTS_BY_HEADER[hdr.baseCode] ?? [];

      // Find the header account (may just have been requested, not yet approved)
      // For change request purposes, we reference the parent by code in afterSnapshot
      // (the approval flow will resolve actual parentId)
      let headerId: number | null = null;
      const existingHeader = await findCoaByCode(headerCompanyCode, companyId);
      if (existingHeader) headerId = existingHeader.id;

      for (const sub of subaccounts) {
        const subCode = `${sub.baseCode}-${abbr}`;
        const idempotencyKey = `${MIGRATION_IDEMPOTENCY_PREFIX}:create-sub:${sub.baseCode}:${abbr}`;

        if (await changeRequestAlreadyExists(companyId, idempotencyKey)) {
          result.skipped.push(`Subakun ${subCode} — change request sudah ada`);
          continue;
        }

        const existingSub = await findCoaByCode(subCode, companyId);
        if (existingSub) {
          result.skipped.push(`Subakun ${subCode} — akun sudah ada (id=${existingSub.id})`);
          continue;
        }

        if (dryRun) {
          result.dryRunProposed!.push(`[DRY-RUN] Subakun ${subCode} — would CREATE under ${headerCompanyCode} (is_postable=true)`);
          continue;
        }

        const cr = await createChangeRequest({
          companyId,
          action: "CREATE",
          afterSnapshot: {
            code:            subCode,
            name:            `${sub.name} ${abbr}`,
            type:            sub.type,
            accountCategory: sub.category,
            normalBalance:   sub.normalBalance,
            isHeader:        false,
            isPostable:      true,
            parentId:        headerId ?? null,
            parentCode:      headerCompanyCode, // reference for human reviewer
            status:          "ACTIVE",
          },
          reason: `Restructure COA Pajak: buat subakun postable ${subCode} (${sub.name} ${abbr}) di bawah header ${headerCompanyCode}.`,
          requestedBy:     MIGRATION_MAKER,
          idempotencyKey,
        });

        if (!cr.ok) {
          result.errors.push(`Subakun ${subCode}: createChangeRequest gagal — ${cr.error}`);
          continue;
        }

        const submitResult = await submitChangeRequest(cr.data!.id, MIGRATION_MAKER, companyId);
        if (!submitResult.ok) {
          result.errors.push(`Subakun ${subCode}: submitChangeRequest gagal — ${submitResult.error}`);
          continue;
        }

        result.created.push(`Subakun ${subCode} — CR #${cr.data!.id} → PENDING_APPROVAL`);
      }
    }

    // ── Step 3: Reparenting change requests for existing accounts ──────────────
    for (const rp of REPARENTING) {
      const existingCode = `${rp.existingBaseCode}-${abbr}`;
      const newHeaderCode = `${rp.newHeaderBaseCode}-${abbr}`;
      const idempotencyKey = `${MIGRATION_IDEMPOTENCY_PREFIX}:reparent:${rp.existingBaseCode}:${abbr}`;

      if (await changeRequestAlreadyExists(companyId, idempotencyKey)) {
        result.skipped.push(`Reparent ${existingCode} → ${newHeaderCode} — change request sudah ada`);
        continue;
      }

      const existing = await findCoaByCode(existingCode, companyId);
      if (!existing) {
        result.skipped.push(`Reparent ${existingCode} — akun tidak ditemukan, skip`);
        continue;
      }

      const newHeader = await findCoaByCode(newHeaderCode, companyId);
      // newHeader may not exist yet (not yet approved) — still create the change request
      // to signal the intent; human reviewer will complete the chain

      if (dryRun) {
        result.dryRunProposed!.push(`[DRY-RUN] Reparent ${existingCode} → ${newHeaderCode} — would UPDATE_PARENT`);
        continue;
      }

      const cr = await createChangeRequest({
        companyId,
        coaId: existing.id,
        action: "UPDATE_PARENT",
        afterSnapshot: {
          parentId:   newHeader?.id ?? null,
          parentCode: newHeaderCode, // for human reviewer
        },
        reason: rp.reason,
        requestedBy:     MIGRATION_MAKER,
        idempotencyKey,
      });

      if (!cr.ok) {
        result.errors.push(`Reparent ${existingCode}: createChangeRequest gagal — ${cr.error}`);
        continue;
      }

      const submitResult = await submitChangeRequest(cr.data!.id, MIGRATION_MAKER, companyId);
      if (!submitResult.ok) {
        result.errors.push(`Reparent ${existingCode}: submitChangeRequest gagal — ${submitResult.error}`);
        continue;
      }

      result.created.push(`Reparent ${existingCode} → ${newHeaderCode} — CR #${cr.data!.id} → PENDING_APPROVAL`);
    }

    logger.info(
      {
        companyId,
        abbr,
        created: result.created.length,
        skipped: result.skipped.length,
        errors: result.errors.length,
      },
      "[coaTaxMigration] Company migration summary",
    );

    results.push(result);
  }

  return results;
}

/**
 * Summary of the target tax COA structure (read-only, no DB access).
 * Used by documentation and validation tests.
 */
export function getTaxCoaTargetStructure(): {
  headers: TaxHeaderDef[];
  subaccounts: TaxSubaccountDef[];
  reparenting: ExistingAccountReparentDef[];
} {
  return {
    headers: [KEWAJIBAN_PAJAK_HEADER, ASET_PAJAK_HEADER, BEBAN_PAJAK_HEADER],
    subaccounts: [
      ...KEWAJIBAN_PAJAK_SUBACCOUNTS,
      ...ASET_PAJAK_SUBACCOUNTS,
      ...BEBAN_PAJAK_SUBACCOUNTS,
    ],
    reparenting: REPARENTING,
  };
}
