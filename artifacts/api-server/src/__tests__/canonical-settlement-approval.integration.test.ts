import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { getIsolatedTestDatabaseUrl } from "../test-setup.js";
import {
  approveCanonicalSettlementLink,
  CANONICAL_APPROVAL_CODES,
  CANONICAL_SETTLEMENT_SOURCE,
  CanonicalSettlementApprovalError,
} from "../lib/reconciliation/canonicalSettlementApproval.js";

const { Pool } = pg;
const DB_URL = getIsolatedTestDatabaseUrl();
const ACTOR = "canonical-settlement-rollback-test";
const MUTATION_DATE = "2026-08-30";
const PAYMENT_DATE = "2026-08-30";
const GROSS_AMOUNT = 100_000;
const MDR_AMOUNT = 300;
const NET_AMOUNT = GROSS_AMOUNT - MDR_AMOUNT;

type FixtureOverrides = {
  mutationCompanyMismatch?: boolean;
  mutationDate?: string;
  mutationAmount?: number;
  settlementDate?: string;
  settlementBankAccount?: string;
  paymentMethod?: string;
  paymentStatus?: "confirmed" | "pending";
  journalStatus?: "posted" | "draft";
  journalType?: string;
};

type Fixture = {
  mutationId: number;
  settlementId: number;
  settlementJournalId: number;
  paymentJournalId: number;
  paymentId: number;
  bankAccountId: number;
};

type FixtureState = {
  match_count: number;
  approved_match_count: number;
  audit_count: number;
  settlement: {
    status: string;
    bank_mutation_id: number | null;
    canonical_bank_mutation_id: number | null;
    reconciled_at: string | null;
    reconciled_by: string | null;
  };
  mutation: {
    status: string;
    approved_by: string | null;
    approved_at: string | null;
  };
};

type AuditFailureTrigger = {
  triggerName: string;
  functionName: string;
};

let pool: pg.Pool;
let approvalDb: ReturnType<typeof drizzle>;
const rejectCases: Array<[string, FixtureOverrides]> = [
  ["cross-company", { mutationCompanyMismatch: true }],
  ["pending payment", { paymentStatus: "pending" }],
  ["non-QRIS payment", { paymentMethod: "BANK_TRANSFER" }],
  ["wrong settlement date", { settlementDate: "2026-08-31" }],
  ["wrong net amount", { mutationAmount: NET_AMOUNT - 1_000 }],
  ["wrong bank account", { settlementBankAccount: "WRONG-ACCOUNT" }],
  ["wrong settlement journal status", { journalStatus: "draft" }],
];

function id(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Fixture did not return a valid ID: ${String(value)}`);
  }
  return parsed;
}

async function createFixture(
  overrides: FixtureOverrides = {},
): Promise<Fixture> {
  const client = await pool.connect();
  const marker = randomUUID();

  try {
    await client.query("BEGIN");
    // Fixture rows intentionally bypass business triggers. The approval service
    // remains fully trigger-enabled and is exercised through its real Drizzle
    // transaction after this setup transaction commits.
    await client.query("SET LOCAL session_replication_role = replica");

    const company = await client.query(
      "SELECT id FROM public.companies ORDER BY id LIMIT 1",
    );
    const companyId = id(company.rows[0]?.id);
    const accountNumber = `ROLLBACK-${marker}`;

    const account = await client.query(
      `INSERT INTO public.company_bank_accounts
        (company_id, name, bank_name, account_number, is_active)
       VALUES ($1, $2, 'TEST BANK', $3, TRUE)
       RETURNING id`,
      [companyId, `Settlement rollback ${marker}`, accountNumber],
    );
    const bankAccountId = id(account.rows[0]?.id);

    const mutation = await client.query(
      `INSERT INTO public.bank_mutations
        (bank_account_id, transaction_date, description, credit_amount,
         debit_amount, amount, direction, mutation_key,
         normalized_description, provider_name, status, company_id)
       VALUES
        ($1, $2, $3, $4, 0, $4, 'IN', $5, $3, 'mandiri_direct',
         'unmatched', $6)
       RETURNING id`,
      [
        bankAccountId,
        overrides.mutationDate ?? MUTATION_DATE,
        `Canonical rollback ${marker}`,
        overrides.mutationAmount ?? NET_AMOUNT,
        `canonical-rollback-${marker}`,
        overrides.mutationCompanyMismatch ? companyId + 1_000_000 : companyId,
      ],
    );
    const mutationId = id(mutation.rows[0]?.id);

    const payment = await client.query(
      `INSERT INTO sport_center.sport_payments
        (booking_id, amount, status, payment_method, payment_type,
         payment_provider, company_id, bank_account_id,
         expected_settlement_date, settlement_rule_version,
         provider_name, provider_id, provider_order_id, confirmed_at, paid_at,
         uat_marker)
       VALUES
        (-1, $1, $2, $3, 'full_payment', 'mandiri_direct', $4, $5,
         $6, 'ROLLBACK-TEST-v1', 'mandiri_direct', $7, $7,
         $6::date::timestamptz, $6::date::timestamptz, $7)
       RETURNING id`,
      [
        GROSS_AMOUNT,
        overrides.paymentStatus ?? "confirmed",
        overrides.paymentMethod ?? "QRIS",
        companyId,
        accountNumber,
        PAYMENT_DATE,
        marker,
      ],
    );
    const paymentId = id(payment.rows[0]?.id);

    const paymentJournal = await client.query(
      `INSERT INTO sport_center.accounting_journals
        (order_number, journal_type, debit_amount, credit_revenue_amount,
         credit_ppn_amount, journal_date, is_reversal, company_id, status,
         gross_amount, payment_id, source_schema, source_table, source_id,
         correlation_id, created_by, posted_by, posted_at, updated_at)
       VALUES
        ($1, 'payment_confirmed', $2, $2, 0, $3, FALSE, $4, 'posted',
         $2, $5, 'sport_center', 'sport_payments', $5::text, $6, $7, $7,
         NOW(), NOW())
       RETURNING id`,
      [
        `ROLLBACK-PAYMENT-${marker}`,
        GROSS_AMOUNT,
        PAYMENT_DATE,
        companyId,
        paymentId,
        `payment-${marker}`,
        ACTOR,
      ],
    );
    const paymentJournalId = id(paymentJournal.rows[0]?.id);

    const settlement = await client.query(
      `INSERT INTO sport_center.payment_settlement_batches
        (settlement_reference, company_id, provider_code, provider_name,
         bank_account_id, settlement_date, gross_amount, mdr_amount,
         provider_fee_amount, fee_tax_amount, tax_withheld_amount,
         adjustment_amount, net_amount, status, calculated_at, posted_at,
         calculated_by, posted_by, settlement_rule_version, correlation_id,
         created_by, updated_at)
       VALUES
        ($1, $2, 'mandiri_direct', 'mandiri_direct', $3, $4, $5, $6,
         0, 0, 0, 0, $7, 'posted', NOW(), NOW(), $8, $8,
         'ROLLBACK-TEST-v1', $9, $8, NOW())
       RETURNING id`,
      [
        `ROLLBACK-${marker}`,
        companyId,
        overrides.settlementBankAccount ?? accountNumber,
        overrides.settlementDate ?? MUTATION_DATE,
        GROSS_AMOUNT,
        MDR_AMOUNT,
        NET_AMOUNT,
        ACTOR,
        marker,
      ],
    );
    const settlementId = id(settlement.rows[0]?.id);

    const journal = await client.query(
      `INSERT INTO sport_center.accounting_journals
        (order_number, journal_type, debit_amount, credit_revenue_amount,
         credit_ppn_amount, journal_date, is_reversal, company_id, status,
         gross_amount, settlement_id, settlement_reference, settlement_date,
         settlement_batch_id, source_schema, source_table, source_id,
         correlation_id, created_by, posted_by, posted_at, updated_at)
       VALUES
        ($1, $2, $3, $3, 0, $4, FALSE, $5, $6, $3, $7, $1, $4,
         $7, 'sport_center', 'payment_settlement_batches', $7::text,
         $8, $9, $9, NOW(), NOW())
       RETURNING id`,
      [
        `ROLLBACK-${marker}`,
        overrides.journalType ?? "settlement",
        GROSS_AMOUNT,
        overrides.settlementDate ?? MUTATION_DATE,
        companyId,
        overrides.journalStatus ?? "posted",
        settlementId,
        marker,
        ACTOR,
      ],
    );
    const journalId = id(journal.rows[0]?.id);

    await client.query(
      `UPDATE sport_center.payment_settlement_batches
          SET settlement_journal_id = $1
        WHERE id = $2`,
      [journalId, settlementId],
    );
    await client.query(
      `INSERT INTO sport_center.payment_settlement_items
        (settlement_id, payment_id, payment_journal_id, gross_amount,
         item_status, correlation_id, created_by, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, NOW())`,
      [settlementId, paymentId, paymentJournalId, GROSS_AMOUNT, marker, ACTOR],
    );

    const integrity = await client.query(
      `SELECT
         item.payment_journal_id = $3
         AND payment_journal.journal_type = 'payment_confirmed'
         AND payment_journal.status = 'posted'
         AND batch.settlement_journal_id = $4
         AND settlement_journal.journal_type = 'settlement'
         AND settlement_journal.settlement_batch_id = batch.id
           AS valid
       FROM sport_center.payment_settlement_items item
       JOIN sport_center.payment_settlement_batches batch
         ON batch.id = item.settlement_id
       JOIN sport_center.accounting_journals payment_journal
         ON payment_journal.id = item.payment_journal_id
       JOIN sport_center.accounting_journals settlement_journal
         ON settlement_journal.id = batch.settlement_journal_id
       WHERE item.settlement_id = $1
         AND item.payment_id = $2`,
      [settlementId, paymentId, paymentJournalId, journalId],
    );
    if (integrity.rows[0]?.valid !== true) {
      throw new Error("Canonical settlement fixture journal relationships are invalid.");
    }

    await client.query("COMMIT");
    return {
      mutationId,
      settlementId,
      settlementJournalId: journalId,
      paymentJournalId,
      paymentId,
      bankAccountId,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "DELETE FROM public.bank_reconciliation_audit WHERE mutation_id = $1",
      [fixture.mutationId],
    );
    await client.query(
      "DELETE FROM public.bank_reconciliation_matches WHERE mutation_id = $1",
      [fixture.mutationId],
    );
    await client.query(
      "DELETE FROM sport_center.payment_settlement_items WHERE settlement_id = $1",
      [fixture.settlementId],
    );
    await client.query(
      "DELETE FROM sport_center.accounting_journals WHERE id = ANY($1::integer[])",
      [[fixture.settlementJournalId, fixture.paymentJournalId]],
    );
    await client.query(
      "DELETE FROM sport_center.payment_settlement_batches WHERE id = $1",
      [fixture.settlementId],
    );
    await client.query(
      "DELETE FROM sport_center.sport_payments WHERE id = $1",
      [fixture.paymentId],
    );
    await client.query(
      "DELETE FROM public.bank_mutations WHERE id = $1",
      [fixture.mutationId],
    );
    await client.query(
      "DELETE FROM public.company_bank_accounts WHERE id = $1",
      [fixture.bankAccountId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function installAuditFailureTrigger(): Promise<AuditFailureTrigger> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const triggerName = `canonical_audit_failure_${suffix}`;
  const functionName = `canonical_audit_failure_fn_${suffix}`;
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE FUNCTION public."${functionName}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'controlled canonical settlement audit write failure';
      END;
      $$
    `);
    await client.query(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON public.bank_reconciliation_audit
      FOR EACH ROW
      WHEN (NEW.action = 'CANONICAL_SETTLEMENT_RECONCILIATION_APPROVED')
      EXECUTE FUNCTION public."${functionName}"()
    `);
    return { triggerName, functionName };
  } catch (error) {
    await client.query(
      `DROP FUNCTION IF EXISTS public."${functionName}"()`,
    ).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function removeAuditFailureTrigger(
  trigger: AuditFailureTrigger,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `DROP TRIGGER IF EXISTS "${trigger.triggerName}"
       ON public.bank_reconciliation_audit`,
    );
    await client.query(
      `DROP FUNCTION IF EXISTS public."${trigger.functionName}"()`,
    );
  } finally {
    client.release();
  }
}

async function fixtureState(fixture: Fixture): Promise<FixtureState> {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::integer
          FROM public.bank_reconciliation_matches
         WHERE mutation_id = $1
           AND candidate_type = 'qris_settlement'
           AND candidate_id = $2
           AND candidate_source = $3) AS match_count,
       (SELECT COUNT(*)::integer
          FROM public.bank_reconciliation_matches
         WHERE mutation_id = $1
           AND candidate_type = 'qris_settlement'
           AND candidate_id = $2
           AND candidate_source = $3
           AND status = 'approved') AS approved_match_count,
       (SELECT COUNT(*)::integer
          FROM public.bank_reconciliation_audit
         WHERE mutation_id = $1) AS audit_count,
       (SELECT json_build_object(
          'status', status,
          'bank_mutation_id', bank_mutation_id,
          'canonical_bank_mutation_id', canonical_bank_mutation_id,
          'reconciled_at', reconciled_at,
          'reconciled_by', reconciled_by
        )
          FROM sport_center.payment_settlement_batches
         WHERE id = $2) AS settlement,
       (SELECT json_build_object(
          'status', status,
          'approved_by', approved_by,
          'approved_at', approved_at
        )
          FROM public.bank_mutations
         WHERE id = $1) AS mutation`,
    [fixture.mutationId, fixture.settlementId, CANONICAL_SETTLEMENT_SOURCE],
  );
  const row = result.rows[0];
  return {
    match_count: Number(row.match_count),
    approved_match_count: Number(row.approved_match_count),
    audit_count: Number(row.audit_count),
    settlement: row.settlement,
    mutation: row.mutation,
  };
}

async function approveHistoricalRepair(fixture: Fixture) {
  return approveCanonicalSettlementLink(approvalDb as never, {
    mutationId: fixture.mutationId,
    candidateType: "qris_settlement",
    candidateId: fixture.settlementId,
    candidateSource: CANONICAL_SETTLEMENT_SOURCE,
    actor: ACTOR,
    manualOverride: true,
    overrideReason: "Integration proof for isolated historical repair",
    historicalRepair: true,
  });
}

beforeAll(async () => {
  pool = new Pool({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 15_000,
  });
  approvalDb = drizzle(pool);
  const required = await pool.query(
    `SELECT
       to_regclass('public.companies') IS NOT NULL
       AND to_regclass('public.company_bank_accounts') IS NOT NULL
       AND to_regclass('public.bank_mutations') IS NOT NULL
       AND to_regclass('public.bank_reconciliation_matches') IS NOT NULL
       AND to_regclass('public.bank_reconciliation_audit') IS NOT NULL
       AND to_regclass('sport_center.sport_payments') IS NOT NULL
       AND to_regclass('sport_center.payment_settlement_batches') IS NOT NULL
       AND to_regclass('sport_center.payment_settlement_items') IS NOT NULL
       AND to_regclass('sport_center.accounting_journals') IS NOT NULL
         AS ready`,
  );
  expect(required.rows[0]?.ready).toBe(true);
});


afterAll(async () => {
  await pool?.end();
});

describe("canonical historical settlement repair database transaction", () => {
  it.each(rejectCases)(
    "rolls back every partial effect for %s",
    async (_label, overrides) => {
      const fixture = await createFixture(overrides);
      try {
        const before = await fixtureState(fixture);

        await expect(approveHistoricalRepair(fixture)).rejects.toMatchObject({
          name: CanonicalSettlementApprovalError.name,
          code:
            overrides.journalStatus === "draft"
              ? CANONICAL_APPROVAL_CODES.JOURNAL_NOT_ELIGIBLE
              : CANONICAL_APPROVAL_CODES.MATCHING_EVIDENCE_INVALID,
        });

        expect(await fixtureState(fixture)).toEqual(before);
      } finally {
        await cleanupFixture(fixture);
      }
    },
  );

  it("commits the sole non-H-1 exception once and keeps its retry idempotent", async () => {
    const fixture = await createFixture();
    try {
      const first = await approveHistoricalRepair(fixture);
      expect(first).toMatchObject({
        ok: true,
        idempotent: false,
        historical_repair: true,
        candidate_id: fixture.settlementId,
        mutation_id: fixture.mutationId,
        settlement_status: "reconciled",
        bank_mutation_status: "approved",
        match_status: "approved",
      });

      const committed = await fixtureState(fixture);
      expect(committed).toMatchObject({
        match_count: 1,
        approved_match_count: 1,
        audit_count: 1,
        settlement: {
          status: "reconciled",
          bank_mutation_id: fixture.mutationId,
          canonical_bank_mutation_id: fixture.mutationId,
          reconciled_by: ACTOR,
        },
        mutation: {
          status: "approved",
          approved_by: ACTOR,
        },
      });
      expect(committed.settlement.reconciled_at).not.toBeNull();
      expect(committed.mutation.approved_at).not.toBeNull();

      const retry = await approveHistoricalRepair(fixture);
      expect(retry).toMatchObject({
        ok: true,
        idempotent: true,
        historical_repair: true,
      });
      expect(await fixtureState(fixture)).toEqual(committed);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rolls back settlement, match, and mutation changes when the final audit write fails", async () => {
    const fixture = await createFixture();
    let auditFailureTrigger: AuditFailureTrigger | undefined;

    try {
      const before = await fixtureState(fixture);
      auditFailureTrigger = await installAuditFailureTrigger();

      await expect(approveHistoricalRepair(fixture)).rejects.toMatchObject({
        message: expect.stringContaining(
          "controlled canonical settlement audit write failure",
        ),
      });

      const after = await fixtureState(fixture);
      expect(after).toEqual(before);
      expect(after).toMatchObject({
        match_count: 0,
        approved_match_count: 0,
        audit_count: 0,
        settlement: {
          status: "posted",
          bank_mutation_id: null,
          canonical_bank_mutation_id: null,
          reconciled_at: null,
          reconciled_by: null,
        },
        mutation: {
          status: "unmatched",
          approved_by: null,
          approved_at: null,
        },
      });
    } finally {
      try {
        if (auditFailureTrigger) {
          await removeAuditFailureTrigger(auditFailureTrigger);
        }
      } finally {
        await cleanupFixture(fixture);
      }
    }
  });

  it("allows QRIS metadata materialization while preserving posted journal amounts", async () => {
    const fixture = await createFixture();
    const before = await pool.query(
      `SELECT gross_amount, debit_amount, credit_revenue_amount,
              credit_ppn_amount
         FROM sport_center.accounting_journals
        WHERE id = $1`,
      [fixture.paymentJournalId],
    );
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "SET LOCAL sport_center.allow_posted_accounting_metadata_correction = 'on'",
      );
      await client.query(
        `UPDATE sport_center.sport_payments
            SET payment_provider = 'mandiri_direct',
                provider_name = 'qris-metadata-regression',
                bank_account_id = $1,
                expected_settlement_date = $2,
                settlement_rule_version = 'ROLLBACK-TEST-metadata-v2'
          WHERE id = $3`,
        [`ROLLBACK-ACCOUNT-${randomUUID()}`, PAYMENT_DATE, fixture.paymentId],
      );
      await client.query("COMMIT");

      const after = await pool.query(
        `SELECT gross_amount, debit_amount, credit_revenue_amount,
                credit_ppn_amount, provider_name, expected_settlement_date,
                settlement_status
           FROM sport_center.accounting_journals
          WHERE id = $1`,
        [fixture.paymentJournalId],
      );
      expect(after.rows[0]).toMatchObject({
        gross_amount: before.rows[0].gross_amount,
        debit_amount: before.rows[0].debit_amount,
        credit_revenue_amount: before.rows[0].credit_revenue_amount,
        credit_ppn_amount: before.rows[0].credit_ppn_amount,
        provider_name: "qris-metadata-regression",
        expected_settlement_date: PAYMENT_DATE,
        settlement_status: "unsettled",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
      await cleanupFixture(fixture);
    }
  });
});