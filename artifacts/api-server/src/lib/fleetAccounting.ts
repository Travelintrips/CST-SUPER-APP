import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { postEntry } from "./accounting.js";
import { logger } from "./logger.js";

interface FleetSettings {
  fleetCashAccountId: number;
  fleetDriverReceivableAccountId: number;
  journalId: number;
}

async function resolveFleetSettings(companyId: number): Promise<FleetSettings> {
  const result = await db.execute(sql.raw(`
    SELECT
      fleet_cash_account_id,
      fleet_driver_receivable_account_id,
      COALESCE(cash_journal_id, bank_journal_id,
        (SELECT id FROM accounting_journals WHERE company_id = ${companyId} ORDER BY id LIMIT 1)
      ) AS journal_id
    FROM accounting_settings
    WHERE company_id = ${companyId}
    LIMIT 1
  `));
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw Object.assign(new Error("Fleet cash payment COA belum disetup. Konfigurasikan fleet_cash_account_id dan fleet_driver_receivable_account_id di Accounting > Settings."), { code: "COA_MISSING" });
  }
  if (!row.fleet_cash_account_id || !row.fleet_driver_receivable_account_id) {
    throw Object.assign(new Error("Fleet cash payment COA belum disetup. Konfigurasikan fleet_cash_account_id dan fleet_driver_receivable_account_id di Accounting > Settings."), { code: "COA_MISSING" });
  }
  if (!row.journal_id) {
    throw Object.assign(new Error("Fleet cash payment: tidak ada accounting journal yang dikonfigurasi untuk perusahaan ini."), { code: "COA_MISSING" });
  }
  return {
    fleetCashAccountId: Number(row.fleet_cash_account_id),
    fleetDriverReceivableAccountId: Number(row.fleet_driver_receivable_account_id),
    journalId: Number(row.journal_id),
  };
}

export async function postFleetCashPaymentJournal(args: {
  paymentId: number;
  companyId: number;
  amount: number;
  driverName: string;
  paymentDate: string;
  referenceNo?: string | null;
  recordedBy?: string | null;
}): Promise<{ entryId: number }> {
  const settings = await resolveFleetSettings(args.companyId);
  const ref = args.referenceNo || `FCP-${args.paymentId}`;
  const description = `Cash payment driver ${args.driverName}`;

  const entry = await postEntry(
    {
      journalId:   settings.journalId,
      date:        new Date(args.paymentDate),
      ref,
      description,
      source:      "fleet_cash_payment" as any,
      sourceId:    args.paymentId,
      createdById: args.recordedBy ?? null,
      companyId:   args.companyId,
      lines: [
        {
          accountId:   settings.fleetCashAccountId,
          debit:       args.amount,
          credit:      0,
          description: `Kas masuk — ${description} (${ref})`,
        },
        {
          accountId:   settings.fleetDriverReceivableAccountId,
          debit:       0,
          credit:      args.amount,
          description: `Piutang driver — ${description} (${ref})`,
        },
      ],
    },
    "FLEET",
  );

  logger.info(
    { paymentId: args.paymentId, entryId: entry.id, amount: args.amount },
    "[fleetAccounting] Fleet cash payment journal posted",
  );

  return { entryId: entry.id };
}

export async function voidFleetCashPaymentJournal(args: {
  originalEntryId: number;
  companyId: number;
  amount: number;
  driverName: string;
  paymentDate: string;
  referenceNo?: string | null;
  recordedBy?: string | null;
}): Promise<{ entryId: number }> {
  const settings = await resolveFleetSettings(args.companyId);
  const ref = args.referenceNo ? `VOID-${args.referenceNo}` : `VOID-ENTRY-${args.originalEntryId}`;
  const description = `VOID — Cash payment driver ${args.driverName}`;

  const entry = await postEntry(
    {
      journalId:   settings.journalId,
      date:        new Date(),
      ref,
      description,
      source:      "reversal" as any,
      sourceId:    args.originalEntryId,
      createdById: args.recordedBy ?? null,
      companyId:   args.companyId,
      lines: [
        {
          accountId:   settings.fleetDriverReceivableAccountId,
          debit:       args.amount,
          credit:      0,
          description: `Reversal piutang driver — ${description} (${ref})`,
        },
        {
          accountId:   settings.fleetCashAccountId,
          debit:       0,
          credit:      args.amount,
          description: `Reversal kas — ${description} (${ref})`,
        },
      ],
    },
    "FLEET",
  );

  logger.info(
    { originalEntryId: args.originalEntryId, reversalEntryId: entry.id, amount: args.amount },
    "[fleetAccounting] Fleet cash payment reversal posted",
  );

  return { entryId: entry.id };
}
