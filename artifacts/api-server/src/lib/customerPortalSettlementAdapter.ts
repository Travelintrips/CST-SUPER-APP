import pg from "pg";
import type { FinanceProjectConfig } from "./financeProjectConfigResolver.js";

type QueryClient = Pick<pg.PoolClient, "query">;

export type CustomerPortalSettlementInput = {
  paymentId: number;
  companyId: number;
  providerCode: string;
  providerReference: string | null;
  settlementDate: string;
  grossAmount: number;
  config: FinanceProjectConfig;
};

export type CustomerPortalSettlementResult = {
  settlementId: number;
  journalEntryId: number;
  publicMutationId: number;
  skipped: boolean;
  grossAmount: number;
  mdrAmount: number;
  netAmount: number;
};

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function requireAmount(value: number, field: string): number {
  const result = money(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`SETTLEMENT_${field}_INVALID`);
  return result;
}

/**
 * Customer Portal settlement owner. It uses only public accounting and
 * Customer Portal settlement tables; it never calls sport_center.*.
 */
export async function settleCustomerPortalPayment(
  client: QueryClient,
  input: CustomerPortalSettlementInput,
): Promise<CustomerPortalSettlementResult> {
  const grossAmount = requireAmount(input.grossAmount, "GROSS_AMOUNT");
  const mdrAmount = money(grossAmount * input.config.mdrRate);
  const fixedFee = money(input.config.fixedProviderFee);
  const feeTax = money(input.config.feeTaxRate * (mdrAmount + fixedFee));
  const netAmount = money(grossAmount - mdrAmount - fixedFee - feeTax);
  if (netAmount <= 0) throw new Error("SETTLEMENT_NET_AMOUNT_INVALID");

  const canonicalKey = `customer_portal:payment:${input.paymentId}`;
  const mutationKey = `CP-PAY-${input.paymentId}`;

  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1))`,
    [`customer-portal-settlement:${canonicalKey}`],
  );
  const existing = await client.query<{
    settlement_id: string;
    journal_entry_id: number;
    public_mutation_id: number;
    gross_amount: string;
    mdr_amount: string;
    net_amount: string;
  }>(
    `SELECT b.id AS settlement_id, b.settlement_journal_id AS journal_entry_id,
            b.canonical_bank_mutation_id AS public_mutation_id,
            b.gross_amount, b.mdr_amount, b.net_amount
       FROM customer_portal_settlement_batches b
       JOIN customer_portal_settlement_items i ON i.settlement_id=b.id
      WHERE i.payment_id=$1
      FOR UPDATE OF b`,
    [input.paymentId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (
      Number(row.gross_amount) !== grossAmount ||
      Number(row.mdr_amount) !== mdrAmount ||
      Number(row.net_amount) !== netAmount
    ) {
      throw new Error("SETTLEMENT_IDEMPOTENCY_CONFLICT");
    }
    return {
      settlementId: Number(row.settlement_id),
      journalEntryId: Number(row.journal_entry_id),
      publicMutationId: Number(row.public_mutation_id),
      skipped: true,
      grossAmount,
      mdrAmount,
      netAmount,
    };
  }

  const settings = await client.query<{ ar_account_id: number }>(
    `SELECT ar_account_id FROM accounting_settings
      WHERE company_id=$1 OR company_id IS NULL
      ORDER BY company_id NULLS LAST, id
      LIMIT 1`,
    [input.companyId],
  );
  const arAccountId = Number(settings.rows[0]?.ar_account_id);
  const bankAccountId = input.config.accountIds.RECEIVING_BANK;
  const mdrAccountId = input.config.accountIds.MDR_EXPENSE;
  if (!arAccountId || !bankAccountId || !mdrAccountId) {
    throw new Error("BLOCKED_CONFIG_SETTLEMENT_COA_MISSING");
  }

  const journal = await client.query<{ id: number }>(
    `SELECT id FROM accounting_journals
      WHERE code='BNK-CST' AND is_active
        AND (company_id=$1 OR company_id IS NULL)
      ORDER BY company_id NULLS LAST, id LIMIT 1`,
    [input.companyId],
  );
  const journalId = Number(journal.rows[0]?.id);
  if (!journalId) throw new Error("BLOCKED_CONFIG_SETTLEMENT_JOURNAL_MISSING");

  const entry = await client.query<{ id: number }>(
    `INSERT INTO accounting_entries
      (company_id, entry_number, journal_id, date, ref, description,
       payment_method, payment_provider, status, source, source_id,
       source_event_id, total_debit, total_credit, source_module,
       source_table, posted_at)
       VALUES ($1,$2,$3,$4::date,$5,$6,'qris',$7,'draft','sales_payment',$8,
              NULL,$9,$9,'central_finance','payments',NULL)
     RETURNING id`,
    [
      input.companyId,
      mutationKey,
      journalId,
      input.settlementDate,
      mutationKey,
      `Customer Portal settlement ${mutationKey}`,
      input.providerCode,
      input.paymentId,
      grossAmount,
    ],
  );
  let journalEntryId = Number(entry.rows[0]?.id);
  if (!journalEntryId) {
    const existingEntry = await client.query<{ id: number }>(
      `SELECT id FROM accounting_entries
        WHERE source='sales_payment' AND source_id=$1
        FOR UPDATE`,
      [input.paymentId],
    );
    journalEntryId = Number(existingEntry.rows[0]?.id);
  }
  if (!journalEntryId) throw new Error("SETTLEMENT_JOURNAL_NOT_CREATED");

  const lineCount = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM accounting_entry_lines WHERE entry_id=$1`,
    [journalEntryId],
  );
  if (Number(lineCount.rows[0]?.count) === 0) {
    await client.query(
      `INSERT INTO accounting_entry_lines
        (entry_id, account_id, description, debit, credit)
       VALUES
        ($1,$2,$3,$4,0),
        ($1,$5,$6,$7,0),
        ($1,$8,$9,0,$10)`,
      [
        journalEntryId, bankAccountId, `Paylabs settlement net ${mutationKey}`, netAmount,
        mdrAccountId, `Paylabs MDR ${mutationKey}`, mdrAmount + fixedFee + feeTax,
        arAccountId, `Customer Portal payment ${mutationKey}`, grossAmount,
      ],
    );
  }
  await client.query(
    `UPDATE accounting_entries
        SET status='posted', posted_at=COALESCE(posted_at,NOW())
      WHERE id=$1 AND status='draft'`,
    [journalEntryId],
  );

  const batch = await client.query<{ id: string }>(
    `INSERT INTO customer_portal_settlement_batches
      (company_id,provider_code,bank_account_id,settlement_date,
       gross_amount,mdr_amount,fixed_fee_amount,fee_tax_amount,net_amount,
       settlement_journal_id,canonical_key)
     VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (canonical_key) DO UPDATE SET updated_at=NOW()
     RETURNING id`,
    [
      input.companyId, input.providerCode, String(input.config.bankAccountId),
      input.settlementDate, grossAmount, mdrAmount, fixedFee, feeTax, netAmount,
      journalEntryId, canonicalKey,
    ],
  );
  const settlementId = Number(batch.rows[0]?.id);
  if (!settlementId) throw new Error("SETTLEMENT_BATCH_NOT_CREATED");

  const mutation = await client.query<{ id: number }>(
    `INSERT INTO public.bank_mutations
      (bank_account_id,transaction_date,description,credit_amount,debit_amount,
       amount,direction,mutation_key,normalized_description,provider_name,
       provider_order_id,status,company_id,source,source_classification,
       source_app,source_module,source_table,source_id,accounting_posted,
       journal_entry_id,canonical_key)
     VALUES ($1,$2::date,$3,$4,0,$4,'IN',$5,$3,$6,$7,'unmatched',$8,
             'customer_portal_settlement','actual_bank_mutation','customer_portal',
             'central_finance','payments',$9,TRUE,$10,$11)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      String(input.config.bankAccountId), input.settlementDate,
      `Paylabs ${input.providerCode} settlement ${mutationKey}`, netAmount,
      mutationKey, input.providerCode, input.providerReference, input.companyId,
      input.paymentId, journalEntryId, canonicalKey,
    ],
  );
  let publicMutationId = Number(mutation.rows[0]?.id);
  if (!publicMutationId) {
    const existingMutation = await client.query<{ id: number }>(
      `SELECT id FROM public.bank_mutations WHERE canonical_key=$1 FOR UPDATE`,
      [canonicalKey],
    );
    publicMutationId = Number(existingMutation.rows[0]?.id);
  }
  if (!publicMutationId) throw new Error("SETTLEMENT_PUBLIC_MUTATION_NOT_CREATED");

  await client.query(
    `INSERT INTO customer_portal_settlement_items
      (settlement_id,payment_id,gross_amount)
     VALUES ($1,$2,$3)
     ON CONFLICT (payment_id) DO NOTHING`,
    [settlementId, input.paymentId, grossAmount],
  );
  await client.query(
    `UPDATE customer_portal_settlement_batches
        SET canonical_bank_mutation_id=$2, updated_at=NOW()
      WHERE id=$1`,
    [settlementId, publicMutationId],
  );

  return {
    settlementId,
    journalEntryId,
    publicMutationId,
    skipped: false,
    grossAmount,
    mdrAmount,
    netAmount,
  };
}