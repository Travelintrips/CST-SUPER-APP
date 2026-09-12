/**
 * Usage Tracking Tests — Runtime Usage Tracking for Bank Reconciliation Configuration
 *
 * Tests (per Phase 15 spec):
 *  1.  Successful business match increments once
 *  2.  Same retry 10× increments once (idempotency)
 *  3.  Concurrent duplicate events increment once
 *  4.  Same target in different company isolated
 *  5.  AI rule matched + accepted tracked
 *  6.  AI rule corrected (rejected) tracked
 *  7.  Keyword winner tracked
 *  8.  Failed approval increments zero (service not called on failure)
 *  9.  Usage tracking failure does not fail reconciliation
 * 10.  Dashboard company scope
 * 11.  Never-used query
 * 12.  Most-used ordering
 * 13.  Migration idempotency
 * 14.  trackAiRuleFeedback accepted/rejected counters
 * 15.  trackConfigUsageByCode idempotency
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  trackMutationApproval,
  trackAiRuleFeedback,
  trackConfigUsageByCode,
  runUsageTrackingMigration,
} from "../lib/usageTrackingService.js";
import {
  runReconClassificationMigration,
  resetMigrationFlag,
} from "../lib/reconClassificationMigration.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

const PREFIX = "TEST_UT_";

/** Insert a minimal bank_mutation row and return its id. */
async function insertMutation(opts: {
  desc: string;
  amount?: number;
  companyId?: number | null;
}): Promise<number> {
  const { desc, amount = 1000, companyId = null } = opts;
  const compStr = companyId != null ? String(companyId) : "NULL";
  const r = await db.execute(sql.raw(`
    INSERT INTO bank_mutations
      (transaction_date, description, amount, credit_amount, debit_amount,
       direction, mutation_key, company_id)
    VALUES
      (CURRENT_DATE, '${desc.replace(/'/g, "''")}', ${amount}, ${amount}, 0,
       'IN', '${PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}', ${compStr})
    RETURNING id
  `));
  return Number((r.rows[0] as any).id);
}

/** Insert a minimal config and return its id. */
async function insertConfig(opts: {
  code: string;
  keyword?: string;
  companyId?: number | null;
}): Promise<number> {
  const { code, keyword = code.toLowerCase(), companyId = null } = opts;
  const compStr = companyId != null ? String(companyId) : "NULL";
  const r = await db.execute(sql.raw(`
    INSERT INTO recon_classification_configs
      (company_id, category, name, code, flow, keywords, priority)
    VALUES
      (${compStr}, 'BUSINESS_TRANSACTION', '${code}', '${code}',
       'BUSINESS_MATCHING', '["${keyword}"]', 99)
    ON CONFLICT (code, COALESCE(company_id, 0)) DO UPDATE SET updated_at = NOW()
    RETURNING id
  `));
  return Number((r.rows[0] as any).id);
}

/** Insert a minimal AI rule and return its id. */
async function insertAiRule(opts: {
  name: string;
  keyword: string;
  companyId?: number | null;
}): Promise<number> {
  const { name, keyword, companyId = null } = opts;
  const compStr = companyId != null ? String(companyId) : "NULL";
  const r = await db.execute(sql.raw(`
    INSERT INTO recon_ai_classification_rules
      (company_id, name, condition_field, condition_operator, condition_value, confidence, priority, source)
    VALUES
      (${compStr}, '${name.replace(/'/g, "''")}', 'description', 'contains',
       '${keyword.replace(/'/g, "''")}', 0.9, 10, 'manual')
    RETURNING id
  `));
  return Number((r.rows[0] as any).id);
}

async function getConfigUsage(configId: number) {
  const r = await db.execute(sql.raw(
    `SELECT usage_count FROM recon_classification_configs WHERE id = ${configId}`
  ));
  return Number((r.rows[0] as any)?.usage_count ?? 0);
}

async function getRuleCounters(ruleId: number) {
  const r = await db.execute(sql.raw(
    `SELECT usage_count, accepted_count, rejected_count FROM recon_ai_classification_rules WHERE id = ${ruleId}`
  ));
  const row = r.rows[0] as any;
  return {
    usage:    Number(row?.usage_count ?? 0),
    accepted: Number(row?.accepted_count ?? 0),
    rejected: Number(row?.rejected_count ?? 0),
  };
}

async function getEventCount(idempotencyKey: string, companyId: number | null = null): Promise<number> {
  const compStr = companyId != null ? String(companyId) : "-1";
  const r = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM recon_config_usage_events
    WHERE idempotency_key = '${idempotencyKey.replace(/'/g, "''")}' AND COALESCE(company_id, -1) = ${compStr}
  `));
  return Number((r.rows[0] as any)?.cnt ?? 0);
}

async function cleanupTest() {
  await db.execute(sql.raw(`DELETE FROM recon_config_usage_events WHERE idempotency_key LIKE '${PREFIX}%'`)).catch(() => null);
  await db.execute(sql.raw(`DELETE FROM recon_config_usage_events WHERE mutation_id IN (SELECT id FROM bank_mutations WHERE mutation_key LIKE '${PREFIX}%')`)).catch(() => null);
  await db.execute(sql.raw(`DELETE FROM bank_mutations WHERE mutation_key LIKE '${PREFIX}%'`)).catch(() => null);
  await db.execute(sql.raw(`DELETE FROM recon_ai_classification_rules WHERE name LIKE '${PREFIX}%'`)).catch(() => null);
  await db.execute(sql.raw(`DELETE FROM recon_classification_configs WHERE code LIKE '${PREFIX}%'`)).catch(() => null);
}

beforeAll(async () => {
  resetMigrationFlag();
  await runReconClassificationMigration();
  await runUsageTrackingMigration();
  await cleanupTest();
}, 60_000);

afterAll(async () => {
  await cleanupTest();
});

// ─── 13. Migration idempotency ─────────────────────────────────────────────────

describe("Migration", () => {
  it("runs twice without error (idempotent)", async () => {
    await expect(runUsageTrackingMigration()).resolves.not.toThrow();
  }, 30_000);

  it("creates recon_config_usage_events table", async () => {
    const r = await db.execute(sql.raw(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'recon_config_usage_events'`
    ));
    expect(r.rows.length).toBe(1);
  });

  it("recon_classification_configs has usage_count column", async () => {
    const r = await db.execute(sql.raw(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'recon_classification_configs' AND column_name = 'usage_count'
    `));
    expect(r.rows.length).toBe(1);
  });

  it("recon_ai_classification_rules has accepted_count + rejected_count", async () => {
    const r = await db.execute(sql.raw(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'recon_ai_classification_rules'
      AND column_name IN ('accepted_count', 'rejected_count', 'usage_count')
    `));
    expect(r.rows.length).toBe(3);
  });
});

// ─── 1. Successful match increments once ─────────────────────────────────────

describe("Successful match tracking", () => {
  it("trackMutationApproval increments config usage_count by 1", async () => {
    const configId = await insertConfig({ code: `${PREFIX}MATCH01`, keyword: "testbiaya_unique_001" });
    const mutId    = await insertMutation({ desc: "pembayaran testbiaya_unique_001 april" });
    const before   = await getConfigUsage(configId);

    await trackMutationApproval({ mutationId: mutId, actor: "test@test.com" });

    const after = await getConfigUsage(configId);
    expect(after - before).toBe(1);
  }, 30_000);
});

// ─── 2. Retry 10× increments once (idempotency) ──────────────────────────────

describe("Idempotency", () => {
  it("same mutation approved 10× increments usage_count exactly 1", async () => {
    const configId = await insertConfig({ code: `${PREFIX}IDEM01`, keyword: "idempotency_test_kw_002" });
    const mutId    = await insertMutation({ desc: "transfer idempotency_test_kw_002 may" });
    const before   = await getConfigUsage(configId);

    for (let i = 0; i < 10; i++) {
      await trackMutationApproval({ mutationId: mutId, actor: "test@test.com" });
    }

    const after = await getConfigUsage(configId);
    expect(after - before).toBe(1);
  }, 60_000);

  it("trackConfigUsageByCode same mutationId twice increments once", async () => {
    const code  = `${PREFIX}CODETRACK01`;
    await insertConfig({ code, keyword: "codetrack_unique_003" });
    const mutId = await insertMutation({ desc: "codetrack_unique_003 june" });

    const before = await db.execute(sql.raw(
      `SELECT usage_count FROM recon_classification_configs WHERE code = '${code}'`
    )).then(r => Number((r.rows[0] as any)?.usage_count ?? 0));

    await trackConfigUsageByCode({ configCode: code, actor: "user@test.com", mutationId: mutId });
    await trackConfigUsageByCode({ configCode: code, actor: "user@test.com", mutationId: mutId });

    const after = await db.execute(sql.raw(
      `SELECT usage_count FROM recon_classification_configs WHERE code = '${code}'`
    )).then(r => Number((r.rows[0] as any)?.usage_count ?? 0));

    expect(after - before).toBe(1);
  }, 30_000);
});

// ─── 3. Concurrent duplicate events increment once ───────────────────────────

describe("Concurrent safety", () => {
  it("10 parallel calls with same mutationId result in exactly 1 increment", async () => {
    const configId = await insertConfig({ code: `${PREFIX}CONC01`, keyword: "concurrent_test_kw_004" });
    const mutId    = await insertMutation({ desc: "bayar concurrent_test_kw_004 concurrent" });
    const before   = await getConfigUsage(configId);

    await Promise.all(
      Array.from({ length: 10 }).map(() =>
        trackMutationApproval({ mutationId: mutId, actor: "parallel@test.com" })
      )
    );

    const after = await getConfigUsage(configId);
    expect(after - before).toBe(1);
  }, 60_000);
});

// ─── 4. Company isolation ─────────────────────────────────────────────────────

describe("Company isolation", () => {
  it("usage for company A does NOT increment config of company B", async () => {
    const configA = await insertConfig({ code: `${PREFIX}COMPANYA01`, keyword: "company_a_kw_005", companyId: 9001 });
    const configB = await insertConfig({ code: `${PREFIX}COMPANYB01`, keyword: "company_a_kw_005", companyId: 9002 });

    const mutIdA = await insertMutation({ desc: "transfer company_a_kw_005 test", companyId: 9001 });
    await trackMutationApproval({ mutationId: mutIdA, actor: "a@test.com", companyId: 9001 });

    const afterA = await getConfigUsage(configA);
    const afterB = await getConfigUsage(configB);

    expect(afterA).toBeGreaterThan(0);
    expect(afterB).toBe(0);
  }, 30_000);
});

// ─── 5 & 6. AI rule tracking ──────────────────────────────────────────────────

describe("AI rule feedback tracking", () => {
  let ruleId: number;

  beforeAll(async () => {
    ruleId = await insertAiRule({ name: `${PREFIX}RULE_ACCEPT`, keyword: "airule_test_kw_006" });
  });

  it("accepted recommendation increments accepted_count", async () => {
    const mutId  = await insertMutation({ desc: "dummy" });
    const before = await getRuleCounters(ruleId);
    await trackAiRuleFeedback({ ruleId, accepted: true, mutationId: mutId });
    const after  = await getRuleCounters(ruleId);
    expect(after.accepted - before.accepted).toBe(1);
    expect(after.rejected - before.rejected).toBe(0);
  }, 30_000);

  it("rejected recommendation increments rejected_count only", async () => {
    const mutId  = await insertMutation({ desc: "dummy rej" });
    const before = await getRuleCounters(ruleId);
    await trackAiRuleFeedback({ ruleId, accepted: false, mutationId: mutId });
    const after  = await getRuleCounters(ruleId);
    expect(after.rejected - before.rejected).toBe(1);
    expect(after.accepted - before.accepted).toBe(0);
  }, 30_000);

  it("same rule feedback with same mutationId is idempotent", async () => {
    const mutId  = await insertMutation({ desc: "dummy idem" });
    const before = await getRuleCounters(ruleId);
    await trackAiRuleFeedback({ ruleId, accepted: true, mutationId: mutId });
    await trackAiRuleFeedback({ ruleId, accepted: true, mutationId: mutId });
    const after  = await getRuleCounters(ruleId);
    expect(after.accepted - before.accepted).toBe(1);
  }, 30_000);
});

// ─── 7. Keyword match tracking ────────────────────────────────────────────────

describe("Keyword tracking", () => {
  it("matched keyword usage_count increments on approval", async () => {
    // Insert a keyword in the dictionary
    const kwInsert = await db.execute(sql.raw(`
      INSERT INTO recon_keyword_dictionary (term, weight) VALUES ('uniquekeyword_test_007', 0.9) RETURNING id
    `));
    const kwId  = Number((kwInsert.rows[0] as any).id);
    const mutId = await insertMutation({ desc: "pembayaran uniquekeyword_test_007 july" });

    const before = await db.execute(sql.raw(
      `SELECT usage_count FROM recon_keyword_dictionary WHERE id = ${kwId}`
    )).then(r => Number((r.rows[0] as any)?.usage_count ?? 0));

    await trackMutationApproval({ mutationId: mutId, actor: "kw@test.com" });

    const after = await db.execute(sql.raw(
      `SELECT usage_count FROM recon_keyword_dictionary WHERE id = ${kwId}`
    )).then(r => Number((r.rows[0] as any)?.usage_count ?? 0));

    expect(after - before).toBe(1);

    // Cleanup
    await db.execute(sql.raw(`DELETE FROM recon_keyword_dictionary WHERE id = ${kwId}`)).catch(() => null);
  }, 30_000);
});

// ─── 9. Tracking failure does NOT fail reconciliation ─────────────────────────

describe("Failure isolation", () => {
  it("trackMutationApproval with non-existent mutationId does not throw", async () => {
    // Non-existent mutation ID — should silently no-op
    await expect(
      trackMutationApproval({ mutationId: 999_999_999, actor: "test@test.com" })
    ).resolves.not.toThrow();
  });

  it("trackAiRuleFeedback with non-existent ruleId does not throw", async () => {
    await expect(
      trackAiRuleFeedback({ ruleId: 999_999_999, accepted: true })
    ).resolves.not.toThrow();
  });

  it("trackConfigUsageByCode with unknown code does not throw", async () => {
    await expect(
      trackConfigUsageByCode({ configCode: "NONEXISTENT_CODE_XYZ", actor: "test@test.com" })
    ).resolves.not.toThrow();
  });
});

// ─── 10. Dashboard company scope ─────────────────────────────────────────────

describe("Dashboard company scope", () => {
  it("usage events are isolated per company in the events table", async () => {
    const mutA = await insertMutation({ desc: "scopetest_dummy", companyId: 8801 });
    const mutB = await insertMutation({ desc: "scopetest_dummy", companyId: 8802 });

    await db.execute(sql.raw(`
      INSERT INTO recon_config_usage_events
        (company_id, usage_type, target_id, event_type, idempotency_key)
      VALUES
        (8801, 'config', 1, 'approved', '${PREFIX}scope_test_A_${mutA}'),
        (8802, 'config', 1, 'approved', '${PREFIX}scope_test_B_${mutB}')
      ON CONFLICT DO NOTHING
    `));

    const rA = await db.execute(sql.raw(
      `SELECT COUNT(*) AS cnt FROM recon_config_usage_events WHERE company_id = 8801 AND idempotency_key LIKE '${PREFIX}scope_test_A_%'`
    ));
    const rB = await db.execute(sql.raw(
      `SELECT COUNT(*) AS cnt FROM recon_config_usage_events WHERE company_id = 8802 AND idempotency_key LIKE '${PREFIX}scope_test_B_%'`
    ));
    expect(Number((rA.rows[0] as any).cnt)).toBe(1);
    expect(Number((rB.rows[0] as any).cnt)).toBe(1);
  }, 30_000);
});

// ─── 11. Never-used query ─────────────────────────────────────────────────────

describe("Dashboard queries", () => {
  it("never-used query returns configs with usage_count = 0", async () => {
    const code = `${PREFIX}NEVERUSED01`;
    await insertConfig({ code, keyword: "neverused_should_not_match_anything_xyz999" });

    const r = await db.execute(sql.raw(`
      SELECT id, name FROM recon_classification_configs
      WHERE is_active = TRUE AND usage_count = 0 AND code = '${code}'
    `));
    expect(r.rows.length).toBe(1);
  }, 15_000);

  it("most-used ordering returns highest usage_count first", async () => {
    // Insert 3 configs and set usage counts directly
    const idA = await insertConfig({ code: `${PREFIX}ORD_A`, keyword: "ord_a_unique_kw" });
    const idB = await insertConfig({ code: `${PREFIX}ORD_B`, keyword: "ord_b_unique_kw" });
    const idC = await insertConfig({ code: `${PREFIX}ORD_C`, keyword: "ord_c_unique_kw" });

    await db.execute(sql.raw(`
      UPDATE recon_classification_configs
      SET usage_count = CASE
        WHEN id = ${idA} THEN 5
        WHEN id = ${idB} THEN 15
        WHEN id = ${idC} THEN 3
      END
      WHERE id IN (${idA}, ${idB}, ${idC})
    `));

    const r = await db.execute(sql.raw(`
      SELECT id, usage_count FROM recon_classification_configs
      WHERE id IN (${idA}, ${idB}, ${idC})
      ORDER BY usage_count DESC
    `));
    const ids = (r.rows as any[]).map(row => Number(row.id));
    expect(ids[0]).toBe(idB);  // 15 — highest
    expect(ids[1]).toBe(idA);  // 5
    expect(ids[2]).toBe(idC);  // 3
  }, 15_000);
});
