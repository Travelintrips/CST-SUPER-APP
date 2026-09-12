import express from "express";
import pg from "pg";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getIsolatedTestDatabaseUrl } from "../test-setup.js";

const hasIsolatedDatabase = Boolean(
  process.env.TEST_DATABASE_URL || process.env.STAGING_DATABASE_URL,
);

type RecoveryCase =
  | "linked-balanced"
  | "orphan"
  | "source-mismatch"
  | "unbalanced";

type Fixture = {
  companyId: number;
  invoiceId: number;
  journalId: number;
  entryId: number;
  marker: string;
  withholdingTaxAmount: string;
};

describe.skipIf(!hasIsolatedDatabase)(
  "isolated vendor invoice journal recovery",
  () => {
    const { Pool } = pg;
    let pool: pg.Pool;
    let app: express.Express;

    beforeAll(async () => {
      const dbUrl = getIsolatedTestDatabaseUrl();
      pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
        max: 4,
        connectionTimeoutMillis: 15_000,
      });

      const { default: purchaseWorkflowRouter } = await import(
        "../routes/purchaseWorkflow.js"
      );

      app = express();
      app.use(express.json());
      app.use((req: any, _res, next) => {
        req.user = {
          id: `vendor-recovery-${randomUUID()}`,
          email: "vendor-recovery@test.invalid",
          role: "admin",
          companyId: null,
        };
        req.isAuthenticated = () => true;
        req.isInternalSession = true;
        next();
      });
      app.use("/api/purchase-workflow", purchaseWorkflowRouter);
    });

    afterAll(async () => {
      await pool?.end();
    });

    async function createFixture(kind: RecoveryCase): Promise<Fixture> {
      const marker = randomUUID();
      const withholdingTaxAmount = "123.45";
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");

        const companyResult = await client.query(
          "SELECT id FROM public.companies ORDER BY id LIMIT 1",
        );
        const companyId = Number(companyResult.rows[0]?.id);
        if (!Number.isSafeInteger(companyId) || companyId <= 0) {
          throw new Error("Isolated recovery fixture requires a company row");
        }

        const accountResult = await client.query(
          "SELECT id FROM public.chart_of_accounts WHERE company_id = $1 ORDER BY id LIMIT 1",
          [companyId],
        );
        const accountId = Number(accountResult.rows[0]?.id);
        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
          throw new Error("Isolated recovery fixture requires a COA row");
        }

        const journalResult = await client.query(
          `INSERT INTO public.accounting_journals
             (company_id, code, name, type, is_active)
           VALUES ($1, $2, $3, 'purchase', TRUE)
           RETURNING id`,
          [companyId, `REC-${marker}`, `Recovery fixture ${marker}`],
        );
        const journalId = Number(journalResult.rows[0]?.id);

        const invoiceResult = await client.query(
          `INSERT INTO public.vendor_invoices
             (invoice_number, company_id, supplier_name, status,
              total_amount, tax_amount, withholding_tax_amount, grand_total,
              amount_paid, three_way_match_status)
           VALUES ($1, $2, $3, 'posted',
                   1000.00, 110.00, $4, 1000.00, 0.00, 'matched')
           RETURNING id`,
          [
            `REC-VI-${marker}`,
            companyId,
            `Recovery supplier ${marker}`,
            withholdingTaxAmount,
          ],
        );
        const invoiceId = Number(invoiceResult.rows[0]?.id);

        const source = kind === "source-mismatch" ? "manual" : "purchase_bill";
        const sourceId =
          kind === "source-mismatch" ? null : invoiceId;
        const totalDebit = kind === "unbalanced" ? "100.00" : "1000.00";
        const totalCredit = kind === "unbalanced" ? "90.00" : "1000.00";
        const entryResult = await client.query(
          `INSERT INTO public.accounting_entries
             (company_id, entry_number, journal_id, date, ref, description,
              status, source, source_id, total_debit, total_credit)
           VALUES ($1, $2, $3, CURRENT_DATE, $4, $5,
                   'draft', $6, $7, $8, $9)
           RETURNING id`,
          [
            companyId,
            `REC-ENTRY-${marker}`,
            journalId,
            `REC-REF-${marker}`,
            `Vendor recovery fixture ${marker}`,
            source,
            sourceId,
            totalDebit,
            totalCredit,
          ],
        );
        const entryId = Number(entryResult.rows[0]?.id);

        await client.query(
          `INSERT INTO public.accounting_entry_lines
             (entry_id, account_id, description, debit, credit)
           VALUES
             ($1, $2, 'Recovery debit', $3, 0),
             ($1, $2, 'Recovery credit', 0, $4)`,
          [entryId, accountId, totalDebit, totalCredit],
        );

        if (kind !== "orphan") {
          await client.query(
            "UPDATE public.vendor_invoices SET journal_entry_id = $1 WHERE id = $2",
            [entryId, invoiceId],
          );
        }

        await client.query("COMMIT");
        return {
          companyId,
          invoiceId,
          journalId,
          entryId,
          marker,
          withholdingTaxAmount,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    async function readState(fixture: Fixture) {
      const result = await pool.query(
        `SELECT
           vi.status AS invoice_status,
           vi.journal_entry_id,
           vi.withholding_tax_amount,
           ae.status AS journal_status,
           ae.source,
           ae.source_id,
           ae.posted_at,
           (SELECT COUNT(*) FROM public.accounting_entries
             WHERE company_id = $1 AND source = 'purchase_bill' AND source_id = $2) AS purchase_entry_count
         FROM public.vendor_invoices vi
         LEFT JOIN public.accounting_entries ae ON ae.id = vi.journal_entry_id
         WHERE vi.id = $2`,
        [fixture.companyId, fixture.invoiceId],
      );
      return result.rows[0];
    }

    async function cleanup(fixture: Fixture) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(
          "DELETE FROM public.vendor_invoices WHERE id = $1",
          [fixture.invoiceId],
        );
        await client.query(
          "DELETE FROM public.accounting_entries WHERE id = $1",
          [fixture.entryId],
        );
        await client.query(
          "DELETE FROM public.accounting_journals WHERE id = $1",
          [fixture.journalId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    async function recover(fixture: Fixture) {
      return supertest(app)
        .post(
          `/api/purchase-workflow/vendor-invoices/${fixture.invoiceId}/recover-journal`,
        )
        .query({ company: fixture.companyId });
    }

    it("promotes only the exact linked balanced journal and preserves withholding", async () => {
      const fixture = await createFixture("linked-balanced");
      try {
        const response = await recover(fixture);
        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.journal.status).toBe("posted");
        expect(response.body.journal.posted_at).not.toBeNull();

        const state = await readState(fixture);
        expect(state.invoice_status).toBe("posted");
        expect(state.journal_status).toBe("posted");
        expect(state.withholding_tax_amount).toBe(fixture.withholdingTaxAmount);
        expect(Number(state.purchase_entry_count)).toBe(1);
      } finally {
        await cleanup(fixture);
      }
    });

    it("does not scan or promote an orphan journal", async () => {
      const fixture = await createFixture("orphan");
      try {
        const response = await recover(fixture);
        expect(response.status).toBe(422);
        expect(response.body.error).toBe("vendor_invoice_journal_missing");

        const state = await readState(fixture);
        expect(state.invoice_status).toBe("posted");
        expect(state.journal_entry_id).toBeNull();
        expect(state.journal_status).toBeNull();
        expect(state.withholding_tax_amount).toBe(fixture.withholdingTaxAmount);

        const orphan = await pool.query(
          "SELECT status, posted_at FROM public.accounting_entries WHERE id = $1",
          [fixture.entryId],
        );
        expect(orphan.rows[0]).toEqual({
          status: "draft",
          posted_at: null,
        });
      } finally {
        await cleanup(fixture);
      }
    });

    it("rejects a linked journal whose source does not identify this invoice", async () => {
      const fixture = await createFixture("source-mismatch");
      try {
        const response = await recover(fixture);
        expect(response.status).toBe(422);
        expect(response.body.error).toBe(
          "vendor_invoice_journal_identity_mismatch",
        );

        const state = await readState(fixture);
        expect(state.journal_status).toBe("draft");
        expect(state.source).toBe("manual");
        expect(state.source_id).toBeNull();
        expect(state.withholding_tax_amount).toBe(fixture.withholdingTaxAmount);
        expect(Number(state.purchase_entry_count)).toBe(0);
      } finally {
        await cleanup(fixture);
      }
    });

    it("rejects an unbalanced linked journal without promoting it", async () => {
      const fixture = await createFixture("unbalanced");
      try {
        const response = await recover(fixture);
        expect(response.status).toBe(422);
        expect(response.body.error).toBe(
          "vendor_invoice_draft_journal_unbalanced",
        );

        const state = await readState(fixture);
        expect(state.journal_status).toBe("draft");
        expect(state.posted_at).toBeNull();
        expect(state.withholding_tax_amount).toBe(fixture.withholdingTaxAmount);
      } finally {
        await cleanup(fixture);
      }
    });

    it("serializes concurrent recovery so exactly one request promotes the journal", async () => {
      const fixture = await createFixture("linked-balanced");
      try {
        const responses = await Promise.all([recover(fixture), recover(fixture)]);
        expect(responses.map((response) => response.status).sort()).toEqual([
          200,
          409,
        ]);

        const state = await readState(fixture);
        expect(state.journal_status).toBe("posted");
        expect(state.posted_at).not.toBeNull();
        expect(state.withholding_tax_amount).toBe(fixture.withholdingTaxAmount);
        expect(Number(state.purchase_entry_count)).toBe(1);
      } finally {
        await cleanup(fixture);
      }
    });
  },
);