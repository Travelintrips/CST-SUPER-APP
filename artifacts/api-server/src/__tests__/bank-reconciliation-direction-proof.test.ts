/**
 * Authenticated proof for bank-reconciliation journal direction.
 *
 * Requires TEST_DATABASE_URL or STAGING_DATABASE_URL. The test injects only an
 * authenticated internal admin session and uses the real approval endpoint.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { getIsolatedTestDatabaseUrl } from "../test-setup.js";

const hasIsolatedDatabase =
  Boolean(process.env.TEST_DATABASE_URL || process.env.STAGING_DATABASE_URL);

describe.skipIf(!hasIsolatedDatabase)("authenticated bank direction approval", () => {
  const { Pool } = pg;
  const marker = randomUUID();
  const actor = `bank-direction-${marker}@test.invalid`;
  const testUserId = `bank-direction-${marker}`;
  const amount = 5_000_000;

  let pool: pg.Pool;
  let app: express.Express;
  let companyId: number;
  let bankJournalId: number;
  let bankCoaId: number;
  let outContraCoaId: number;
  let inContraCoaId: number;
  let bankAccountId: number;
  let outMutationId: number;
  let inMutationId: number;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: getIsolatedTestDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 2,
      connectionTimeoutMillis: 15_000,
    });

    const {
      bankReconciliationRouter,
      runBankReconciliationCoreMigration,
    } = await import("../routes/bankReconciliation.js");
    const { runKasBankMigration } = await import("../lib/kasBankMigration.js");
    await runKasBankMigration();
    await runBankReconciliationCoreMigration();

    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = {
        id: testUserId,
        email: actor,
        role: "admin",
        companyId: null,
      };
      req.isAuthenticated = () => true;
      req.isInternalSession = true;
      next();
    });
    app.use("/api/bank-reconciliation", bankReconciliationRouter);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");

      const company = await client.query(
        `INSERT INTO public.companies (company_name, company_code, is_active)
         VALUES ($1, $2, TRUE)
         RETURNING id`,
        [`Bank direction proof ${marker}`, `BDP-${marker.slice(0, 12)}`],
      );
      companyId = Number(company.rows[0]?.id);

      const accounts = await client.query(
        `INSERT INTO public.chart_of_accounts
           (company_id, code, name, type, subtype, is_active, is_header, is_postable)
         VALUES
           ($1, $2, $3, 'asset', 'cash_bank', TRUE, FALSE, TRUE),
           ($1, $4, $5, 'expense', NULL, TRUE, FALSE, TRUE),
           ($1, $6, $7, 'revenue', NULL, TRUE, FALSE, TRUE)
         RETURNING id, code`,
        [
          companyId,
          `BDP-BANK-${marker}`,
          `Bank direction proof bank ${marker}`,
          `BDP-OUT-${marker}`,
          `Bank direction proof OUT contra ${marker}`,
          `BDP-IN-${marker}`,
          `Bank direction proof IN contra ${marker}`,
        ],
      );
      bankCoaId = Number(accounts.rows.find((row) => row.code === `BDP-BANK-${marker}`)?.id);
      outContraCoaId = Number(accounts.rows.find((row) => row.code === `BDP-OUT-${marker}`)?.id);
      inContraCoaId = Number(accounts.rows.find((row) => row.code === `BDP-IN-${marker}`)?.id);

      const journal = await client.query(
        `INSERT INTO public.accounting_journals
           (company_id, code, name, type, is_active)
         VALUES ($1, $2, $3, 'bank', TRUE)
         RETURNING id`,
        [companyId, `BDP-JRN-${marker}`, `Bank direction proof journal ${marker}`],
      );
      bankJournalId = Number(journal.rows[0]?.id);

      const bankAccount = await client.query(
        `INSERT INTO public.company_bank_accounts
           (company_id, name, account_type, account_number, coa_id, is_active)
         VALUES ($1, $2, 'bank', $3, $4, TRUE)
         RETURNING id`,
        [
          companyId,
          `Bank direction proof account ${marker}`,
          `BDP-ACCOUNT-${marker}`,
          bankCoaId,
        ],
      );
      bankAccountId = Number(bankAccount.rows[0]?.id);

      await client.query(
        `INSERT INTO public.accounting_settings (company_id, bank_journal_id)
         VALUES ($1, $2)`,
        [companyId, bankJournalId],
      );

      const mutations = await client.query(
        `INSERT INTO public.bank_mutations
           (bank_account_id, transaction_date, description, credit_amount,
            debit_amount, amount, direction, mutation_key,
            normalized_description, status, company_id)
         VALUES
           ($1, CURRENT_DATE, $2, $3, 0, $3, 'OUT', $4, $5, 'unmatched', $6),
           ($1, CURRENT_DATE, $7, $3, 0, $3, 'IN', $8, $9, 'unmatched', $6)
         RETURNING id, direction`,
        [
          bankAccountId,
          `Bank direction proof OUT ${marker}`,
          amount,
          `BDP-OUT-MUT-${marker}`,
          `bank direction proof out ${marker}`,
          companyId,
          `Bank direction proof IN ${marker}`,
          `BDP-IN-MUT-${marker}`,
          `bank direction proof in ${marker}`,
        ],
      );
      outMutationId = Number(mutations.rows.find((row) => row.direction === "OUT")?.id);
      inMutationId = Number(mutations.rows.find((row) => row.direction === "IN")?.id);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `DELETE FROM public.bank_reconciliation_audit
          WHERE mutation_id IN ($1, $2)`,
        [outMutationId, inMutationId],
      );
      await client.query(
        `DELETE FROM public.bank_reconciliation_matches
          WHERE mutation_id IN ($1, $2)`,
        [outMutationId, inMutationId],
      );
      await client.query(
        `DELETE FROM public.accounting_entry_lines
          WHERE entry_id IN (
            SELECT id FROM public.accounting_entries
             WHERE source::text = 'bank_reconciliation'
               AND source_id IN ($1, $2)
          )`,
        [outMutationId, inMutationId],
      );
      await client.query(
        `DELETE FROM public.accounting_entries
          WHERE source::text = 'bank_reconciliation'
            AND source_id IN ($1, $2)`,
        [outMutationId, inMutationId],
      );
      await client.query(
        `DELETE FROM public.bank_mutations WHERE id IN ($1, $2)`,
        [outMutationId, inMutationId],
      );
      await client.query(
        `DELETE FROM public.accounting_settings WHERE company_id = $1`,
        [companyId],
      );
      await client.query(
        `DELETE FROM public.company_bank_accounts WHERE id = $1`,
        [bankAccountId],
      );
      await client.query(
        `DELETE FROM public.accounting_journals WHERE id = $1`,
        [bankJournalId],
      );
      await client.query(
        `DELETE FROM public.chart_of_accounts WHERE id IN ($1, $2, $3)`,
        [bankCoaId, outContraCoaId, inContraCoaId],
      );
      await client.query(
        `DELETE FROM public.companies WHERE id = $1`,
        [companyId],
      );
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => {});
    } finally {
      client.release();
      await pool.end();
    }
  });

  async function approveAndAssert(
    mutationId: number,
    manualCoaCode: string,
    contraCoaId: number,
    direction: "OUT" | "IN",
  ) {
    const response = await supertest(app)
      .post(`/api/bank-reconciliation/${mutationId}/approve`)
      .set("x-idempotency-key", `${marker}-${direction}`)
      .send({
        manual_coa_code: manualCoaCode,
        manual_override: true,
        override_reason: `Authenticated ${direction} bank direction proof`,
        note: `Authenticated ${direction} approval`,
      });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ ok: true });

    const proof = await pool.query(
      `SELECT
         bm.status AS mutation_status,
         bm.journal_entry_id,
         ae.status AS journal_status,
         ae.company_id AS journal_company_id,
         aj.type::text AS journal_type,
         COUNT(ael.id)::int AS line_count,
         COALESCE(SUM(ael.debit), 0)::numeric AS total_debit,
         COALESCE(SUM(ael.credit), 0)::numeric AS total_credit,
         COUNT(*) FILTER (
           WHERE ael.account_id = $2 AND ael.debit = $3 AND ael.credit = 0
         )::int AS bank_debit_lines,
         COUNT(*) FILTER (
           WHERE ael.account_id = $2 AND ael.debit = 0 AND ael.credit = $3
         )::int AS bank_credit_lines,
         COUNT(*) FILTER (
           WHERE ael.account_id = $4 AND ael.debit = $3 AND ael.credit = 0
         )::int AS contra_debit_lines,
         COUNT(*) FILTER (
           WHERE ael.account_id = $4 AND ael.debit = 0 AND ael.credit = $3
         )::int AS contra_credit_lines
       FROM public.bank_mutations bm
       JOIN public.accounting_entries ae ON ae.id = bm.journal_entry_id
       JOIN public.accounting_journals aj ON aj.id = ae.journal_id
       JOIN public.accounting_entry_lines ael ON ael.entry_id = ae.id
       WHERE bm.id = $1
       GROUP BY bm.status, bm.journal_entry_id, ae.status, ae.company_id, aj.type`,
      [mutationId, bankCoaId, amount, contraCoaId],
    );

    expect(proof.rows).toHaveLength(1);
    const row = proof.rows[0];
    expect(row).toMatchObject({
      mutation_status: "approved_pending_posting",
      journal_status: "draft",
      journal_company_id: companyId,
      journal_type: "bank",
      line_count: 2,
      total_debit: String(amount),
      total_credit: String(amount),
    });
    expect(direction === "OUT"
      ? row.bank_credit_lines === 1 && row.contra_debit_lines === 1
      : row.bank_debit_lines === 1 && row.contra_credit_lines === 1
    ).toBe(true);

    const count = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM public.accounting_entries
        WHERE source::text = 'bank_reconciliation'
          AND source_id = $1`,
      [mutationId],
    );
    expect(count.rows[0]?.count).toBe(1);

    const audit = await pool.query(
      `SELECT action, actor, meta->>'direction' AS direction,
              meta->>'bank_coa_id' AS bank_coa_id,
              meta->>'contra_coa_id' AS contra_coa_id
         FROM public.bank_reconciliation_audit
        WHERE mutation_id = $1 AND action = 'MATCH_APPROVED'
        ORDER BY id DESC`,
      [mutationId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: "MATCH_APPROVED",
      actor,
      direction,
      bank_coa_id: String(bankCoaId),
      contra_coa_id: String(contraCoaId),
    });
  }

  it("approves OUT with manual debit / bank credit and one audit row", async () => {
    await approveAndAssert(
      outMutationId,
      `BDP-OUT-${marker}`,
      outContraCoaId,
      "OUT",
    );
  });

  it("approves IN with bank debit / manual credit and one audit row", async () => {
    await approveAndAssert(
      inMutationId,
      `BDP-IN-${marker}`,
      inContraCoaId,
      "IN",
    );
  });
});