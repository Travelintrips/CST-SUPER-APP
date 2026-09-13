import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import express from "express";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getIsolatedTestDatabaseUrl } from "../test-setup.js";

const routeSource = readFileSync(
  new URL("../routes/bankReconciliation.ts", import.meta.url),
  "utf8",
);

const deleteRouteStart = routeSource.indexOf(
  'router.delete("/:mutationId/candidates/:candidateId", async (req, res) => {',
);
const deleteRouteEnd = routeSource.indexOf(
  "// ─── DELETE /api/bank-reconciliation/:mutationId ──────────────────────────────",
  deleteRouteStart,
);
const deleteRoute = routeSource.slice(deleteRouteStart, deleteRouteEnd);

describe("DELETE duplicate bank-reconciliation candidate contract", () => {
  it("locks the mutation before checking the active duplicate and records the delete audit in the same transaction", () => {
    expect(deleteRouteStart).toBeGreaterThanOrEqual(0);
    expect(deleteRouteEnd).toBeGreaterThan(deleteRouteStart);
    expect(deleteRoute).toContain("AND company_id = ${companyId}");
    expect(deleteRoute).toContain("FROM bank_mutations");
    expect(deleteRoute).toContain("FOR UPDATE");
    expect(deleteRoute).toContain("status = 'candidate'");
    expect(deleteRoute).toContain("COUNT(*)::int AS count");
    expect(deleteRoute).toContain("SELECT MIN(id)::int AS keeper_id");
    expect(deleteRoute).toContain("candidateId === keeperId");
    expect(deleteRoute).toContain("RETURNING id");
    expect(deleteRoute).toContain('code: "CONCURRENT_CHANGE"');
    expect(deleteRoute).toContain("CANDIDATE_DUPLICATE_DELETED");
  });

  it("rejects finalized mutation and non-active candidate states before deletion", () => {
    expect(deleteRoute).toContain(
      '["approved_pending_posting", "approved", "posted", "void"].includes(mutationStatus)',
    );
    expect(deleteRoute).toContain("mutation.journal_entry_id != null");
    expect(deleteRoute).toContain('!== "candidate"');
    expect(deleteRoute).toContain('code: "NOT_ACTIVE_CANDIDATE"');
  });
});

const hasIsolatedDatabase = Boolean(
  process.env.TEST_DATABASE_URL || process.env.STAGING_DATABASE_URL,
);

describe.skipIf(!hasIsolatedDatabase)(
  "DELETE duplicate bank-reconciliation candidate (isolated HTTP integration)",
  () => {
    const { Pool } = pg;
    const marker = randomUUID();
    const actor = `delete-duplicate-${marker}@test.invalid`;
    const testUserId = `delete-duplicate-${marker}`;
    const companyId = 910001;
    const otherCompanyId = 910002;
    let pool: pg.Pool;
    let app: express.Express;
    const mutationIds: number[] = [];

    async function createMutation(
      status = "unmatched",
      mutationCompanyId = companyId,
      journalEntryId: number | null = null,
    ): Promise<number> {
      const result = await pool.query<{ id: number }>(
        `INSERT INTO public.bank_mutations
           (transaction_date, description, credit_amount, debit_amount, amount,
            direction, mutation_key, normalized_description, status, company_id,
            journal_entry_id, source)
         VALUES (CURRENT_DATE, $1, 0, 100, 100, 'OUT', $2, $3, $4, $5, $6, 'test')
         RETURNING id`,
        [
          `DELETE DUPLICATE ${marker}`,
          `delete-duplicate-${marker}-${mutationIds.length}-${randomUUID()}`,
          `DELETE DUPLICATE ${marker}`,
          status,
          mutationCompanyId,
          journalEntryId,
        ],
      );
      const id = Number(result.rows[0]?.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Delete-duplicate fixture mutation was not created");
      }
      mutationIds.push(id);
      return id;
    }

    async function createCandidate(
      mutationId: number,
      status = "candidate",
      candidateId = 880001,
    ): Promise<number> {
      const result = await pool.query<{ id: number }>(
        `INSERT INTO public.bank_reconciliation_matches
           (mutation_id, candidate_type, candidate_id, match_score, match_reason, status)
         VALUES ($1, 'vendor_invoice', $2, 99, 'duplicate fixture', $3)
         RETURNING id`,
        [mutationId, candidateId, status],
      );
      const id = Number(result.rows[0]?.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Delete-duplicate fixture candidate was not created");
      }
      return id;
    }

    async function auditCount(mutationId: number): Promise<number> {
      const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM public.bank_reconciliation_audit
          WHERE mutation_id = $1
            AND action = 'CANDIDATE_DUPLICATE_DELETED'`,
        [mutationId],
      );
      return Number(result.rows[0]?.count ?? 0);
    }

    beforeAll(async () => {
      const dbUrl = getIsolatedTestDatabaseUrl();
      pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
        max: 4,
        connectionTimeoutMillis: 15_000,
      });

      const { bankReconciliationRouter, runBankReconciliationCoreMigration } =
        await import("../routes/bankReconciliation.js");
      await runBankReconciliationCoreMigration();

      // The production backstop prevents creating new duplicates. These rows
      // model legacy duplicates that existed before that index was installed.
      await pool.query(
        "DROP INDEX IF EXISTS public.brm_source_identity_active_unique",
      );
      await pool.query(
        "DROP INDEX IF EXISTS public.brm_historical_identity_active_unique",
      );

      app = express();
      app.use(express.json());
      app.use((req: any, _res, next) => {
        req.user = {
          id: testUserId,
          email: actor,
          role: "admin",
          companyId,
        };
        req.isAuthenticated = () => true;
        req.isInternalSession = true;
        next();
      });
      app.use("/api/bank-reconciliation", bankReconciliationRouter);
    });

    afterAll(async () => {
      if (!pool) return;

      if (mutationIds.length > 0) {
        await pool.query(
          "DELETE FROM public.bank_reconciliation_audit WHERE mutation_id = ANY($1::int[])",
          [mutationIds],
        );
        await pool.query(
          "DELETE FROM public.bank_reconciliation_matches WHERE mutation_id = ANY($1::int[])",
          [mutationIds],
        );
        await pool.query(
          "DELETE FROM public.bank_mutations WHERE id = ANY($1::int[])",
          [mutationIds],
        );
      }

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS brm_source_identity_active_unique
        ON public.bank_reconciliation_matches
          (mutation_id, candidate_type, candidate_id, candidate_source)
        WHERE candidate_source IS NOT NULL
          AND status IN ('candidate', 'approved')
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS brm_historical_identity_active_unique
        ON public.bank_reconciliation_matches (mutation_id, candidate_type, candidate_id)
        WHERE candidate_source IS NULL
          AND status IN ('candidate', 'approved')
      `);
      await pool.end();
    });

    it("deletes only an active duplicate and preserves the MIN(id) keeper", async () => {
      const mutationId = await createMutation();
      const keeperId = await createCandidate(mutationId);
      const duplicateId = await createCandidate(mutationId);
      const otherDuplicateId = await createCandidate(mutationId);

      const response = await request(app).delete(
        `/api/bank-reconciliation/${mutationId}/candidates/${duplicateId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        deleted_candidate_id: duplicateId,
        keeper_candidate_id: keeperId,
        duplicate_count_remaining: 2,
      });
      const remaining = await pool.query<{ id: number; status: string }>(
        `SELECT id, status
           FROM public.bank_reconciliation_matches
          WHERE mutation_id = $1
          ORDER BY id`,
        [mutationId],
      );
      expect(remaining.rows).toEqual([
        { id: keeperId, status: "candidate" },
        { id: otherDuplicateId, status: "candidate" },
      ]);
      expect(await auditCount(mutationId)).toBe(1);

      const keeperResponse = await request(app).delete(
        `/api/bank-reconciliation/${mutationId}/candidates/${keeperId}`,
      );
      expect(keeperResponse.status).toBe(400);
      expect(keeperResponse.body.error).toMatch(/Kandidat utama/);
      expect(await auditCount(mutationId)).toBe(1);
    });

    it("rejects a singleton active candidate, approved candidate, and posted mutation", async () => {
      const singletonMutationId = await createMutation();
      const singletonCandidateId = await createCandidate(singletonMutationId);
      const singletonResponse = await request(app).delete(
        `/api/bank-reconciliation/${singletonMutationId}/candidates/${singletonCandidateId}`,
      );
      expect(singletonResponse.status).toBe(400);
      expect(singletonResponse.body.error).toMatch(/bukan duplikat aktif/);
      expect(await auditCount(singletonMutationId)).toBe(0);

      const approvedMutationId = await createMutation();
      const approvedCandidateId = await createCandidate(
        approvedMutationId,
        "approved",
      );
      const approvedResponse = await request(app).delete(
        `/api/bank-reconciliation/${approvedMutationId}/candidates/${approvedCandidateId}`,
      );
      expect(approvedResponse.status).toBe(400);
      expect(approvedResponse.body.error).toMatch(/Hanya kandidat aktif/);
      expect(await auditCount(approvedMutationId)).toBe(0);

      const postedMutationId = await createMutation(
        "posted",
        companyId,
        987654,
      );
      const postedCandidateId = await createCandidate(postedMutationId);
      const postedResponse = await request(app).delete(
        `/api/bank-reconciliation/${postedMutationId}/candidates/${postedCandidateId}`,
      );
      expect(postedResponse.status).toBe(400);
      expect(postedResponse.body.error).toMatch(/approval atau jurnal/);
      expect(await auditCount(postedMutationId)).toBe(0);
    });

    it("enforces company scope and does not create audit evidence for a cross-company request", async () => {
      const mutationId = await createMutation("unmatched", otherCompanyId);
      const candidateId = await createCandidate(mutationId);

      const response = await request(app).delete(
        `/api/bank-reconciliation/${mutationId}/candidates/${candidateId}`,
      );

      expect(response.status).toBe(404);
      expect(response.body.error).toMatch(/company scope/);
      const remaining = await pool.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM public.bank_reconciliation_matches WHERE mutation_id = $1",
        [mutationId],
      );
      expect(Number(remaining.rows[0]?.count)).toBe(1);
      expect(await auditCount(mutationId)).toBe(0);
    });

    it("serializes concurrent deletes so only one duplicate and one audit row are created", async () => {
      const mutationId = await createMutation();
      const keeperId = await createCandidate(mutationId);
      const duplicateId = await createCandidate(mutationId);
      const endpoint = `/api/bank-reconciliation/${mutationId}/candidates/${duplicateId}`;

      const responses = await Promise.all([
        request(app).delete(endpoint),
        request(app).delete(endpoint),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 404,
      ]);
      expect(
        responses.filter((response) => response.body.ok === true),
      ).toHaveLength(1);
      const rows = await pool.query<{ id: number; status: string }>(
        `SELECT id, status
           FROM public.bank_reconciliation_matches
          WHERE mutation_id = $1
          ORDER BY id`,
        [mutationId],
      );
      expect(rows.rows).toEqual([{ id: keeperId, status: "candidate" }]);
      expect(rows.rows.some((row) => row.id === duplicateId)).toBe(false);
      expect(await auditCount(mutationId)).toBe(1);
    });
  },
);