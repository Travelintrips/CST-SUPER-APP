#!/usr/bin/env node
/**
 * Temporary, narrowly-scoped PROD reconciliation maintenance controller.
 *
 * This tool never disables a trigger. It temporarily replaces only the
 * reconciliation duplicate-root guard with a definition that still validates
 * the canonical schema, settlement correlation root, advisory lock, and source
 * bank mutation. The only skipped branch is the duplicate-root exception, and
 * only for one explicitly marked database session.
 *
 * Run through the official production loader:
 *   APP_ENV=production NODE_ENV=production \
 *     node artifacts/api-server/load-secrets.mjs node \
 *     scripts/reconciliation-maintenance-prod.mjs preflight
 *
 * Mutating commands additionally require:
 *   --execute --confirm RECON_MAINT_20260914
 *
 * The agent does not execute mutating commands against PROD. An operator with
 * the approved production write path must run them.
 */

import crypto from "node:crypto";
import pg from "pg";

const { Client } = pg;

export const CORRELATION = "RECON_MAINT_20260914";
const LOCK_KEY = "reconciliation-maintenance:RECON_MAINT_20260914";
const TARGET_SCHEMA = "public";
const TARGET_FUNCTION = "guard_canonical_settlement_match_root";
const TARGET_TRIGGER = "trg_guard_canonical_settlement_match_root";
const TEST_ARTIFACT_TABLE = "public.recon_maintenance_test_artifacts";
const TEST_ARTIFACT_PREFIX = `${CORRELATION}_TEST_`;

const PROTECTED_RELATIONS = [
  ["public", "accounting_entries"],
  ["public", "accounting_entry_lines"],
  ["public", "accounting_payments"],
  ["public", "fleet_ledger_entries"],
  ["public", "erp_audit_logs"],
  ["sport_center", "accounting_journals"],
  ["sport_center", "accounting_journal_lines"],
  ["sport_center", "payment_settlement_batches"],
];

const PROTECTED_RECON_RELATIONS = [
  ["public", "bank_mutations"],
  ["public", "bank_reconciliation_matches"],
  ["sport_center", "bank_mutations"],
  ["sport_center", "bank_reconciliation_matches"],
];

function parseArgs(argv) {
  const [command = "preflight", ...rest] = argv;
  const args = { command, execute: false, confirm: null, correlation: null };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--execute") args.execute = true;
    else if (token === "--confirm") args.confirm = rest[++i] ?? null;
    else if (token === "--correlation") args.correlation = rest[++i] ?? null;
    else if (token === "--artifact-key") args.artifactKey = rest[++i] ?? null;
    else if (token === "--payload-json") args.payloadJson = rest[++i] ?? null;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function requireExactCorrelation(value, label = "correlation") {
  if (value !== CORRELATION) {
    throw new Error(
      `${label} harus tepat ${CORRELATION}; maintenance diblokir.`,
    );
  }
}

function requireMutationConfirmation(args) {
  if (!args.execute) {
    throw new Error("Mutating command memerlukan --execute.");
  }
  requireExactCorrelation(args.confirm, "confirmation");
  requireExactCorrelation(args.correlation, "correlation");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function relationValues(relations) {
  return relations.flatMap(([schema, table]) => [schema, table]);
}

function relationPredicate(namespaceAlias, relationAlias, relations) {
  const clauses = relations.map(
    (_, index) =>
      `(${namespaceAlias}.nspname = $${index * 2 + 1} AND ${relationAlias}.relname = $${index * 2 + 2})`,
  );
  return clauses.join(" OR ");
}

function assertProductionEnvironment() {
  if (process.env.APP_ENV !== "production" || process.env.NODE_ENV !== "production") {
    throw new Error(
      "Production maintenance memerlukan APP_ENV=production dan NODE_ENV=production.",
    );
  }
  if (!process.env.SUPABASE_DATABASE_URL) {
    throw new Error(
      "SUPABASE_DATABASE_URL canonical production tidak tersedia; fail closed.",
    );
  }
}

async function connect() {
  assertProductionEnvironment();
  const client = new Client({
    connectionString: process.env.SUPABASE_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    application_name: CORRELATION,
  });
  await client.connect();
  await client.query("SET search_path TO public");
  return client;
}

async function withAdvisoryLock(client, callback) {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
  try {
    return await callback();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]).catch(() => {});
  }
}

async function getTargetFunction(client) {
  const result = await client.query(
    `SELECT p.oid::text AS oid,
            pg_get_function_identity_arguments(p.oid) AS identity_arguments,
            pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1
        AND p.proname = $2
        AND pg_get_function_identity_arguments(p.oid) = $3`,
    [TARGET_SCHEMA, TARGET_FUNCTION, ""],
  );
  if (result.rows.length !== 1) {
    throw new Error(
      `Expected exactly one ${TARGET_SCHEMA}.${TARGET_FUNCTION}() function; found ${result.rows.length}.`,
    );
  }
  const row = result.rows[0];
  return {
    oid: String(row.oid),
    definition: String(row.definition),
    sha256: sha256(String(row.definition)),
  };
}

async function getTargetTrigger(client) {
  const result = await client.query(
    `SELECT c.relname AS table_name,
            t.tgenabled,
            pg_get_triggerdef(t.oid, true) AS definition,
            p.pronamespace::regnamespace::text AS function_schema,
            p.proname AS function_name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal
        AND n.nspname = $1
        AND c.relname = 'bank_reconciliation_matches'
        AND t.tgname = $2`,
    [TARGET_SCHEMA, TARGET_TRIGGER],
  );
  if (result.rows.length !== 1) {
    throw new Error(
      `Expected exactly one ${TARGET_SCHEMA}.${TARGET_TRIGGER} trigger; found ${result.rows.length}.`,
    );
  }
  const row = result.rows[0];
  return {
    tableName: String(row.table_name),
    enabled: String(row.tgenabled),
    definition: String(row.definition),
    functionSchema: String(row.function_schema),
    functionName: String(row.function_name),
  };
}

function relationParams(relations) {
  return relationValues(relations);
}

async function getDisabledProtectionTriggers(client) {
  const relations = [...PROTECTED_RELATIONS, ...PROTECTED_RECON_RELATIONS];
  const values = relationParams(relations);
  const result = await client.query(
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name,
            t.tgname,
            t.tgenabled
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
        AND (${relationPredicate("n", "c", relations)})
        AND t.tgenabled <> 'O'
      ORDER BY 1, 2, 3`,
    values,
  );
  return result.rows;
}

async function getInvalidProtectedIndexes(client) {
  const relations = [...PROTECTED_RELATIONS, ...PROTECTED_RECON_RELATIONS];
  const values = relationParams(relations);
  const result = await client.query(
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name,
            i.indexrelid::regclass::text AS index_name,
            i.indisvalid,
            i.indisready,
            i.indisunique
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE (${relationPredicate("n", "c", relations)})
        AND (NOT i.indisvalid OR NOT i.indisready)
      ORDER BY 1, 2, 3`,
    values,
  );
  return result.rows;
}

async function getUnvalidatedProtectedConstraints(client) {
  const relations = [...PROTECTED_RELATIONS, ...PROTECTED_RECON_RELATIONS];
  const values = relationParams(relations);
  const result = await client.query(
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name,
            con.conname,
            con.contype,
            con.convalidated,
            pg_get_constraintdef(con.oid, true) AS definition
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE (${relationPredicate("n", "c", relations)})
        AND con.contype IN ('p', 'u', 'f')
        AND NOT con.convalidated
      ORDER BY 1, 2, 3`,
    values,
  );
  return result.rows;
}

async function getMaintenanceEvent(client, correlation = CORRELATION) {
  const result = await client.query(
    `SELECT id, action, actor, meta, created_at
       FROM public.bank_reconciliation_audit
      WHERE mutation_id IS NULL
        AND action IN ('RECON_MAINTENANCE_ENABLED', 'RECON_MAINTENANCE_RESTORED')
        AND meta->>'correlation' = $1
      ORDER BY id DESC
      LIMIT 1`,
    [correlation],
  );
  return result.rows[0] ?? null;
}

export function buildPatchedDefinition(originalDefinition) {
  const requiredMarkers = [
    "CANONICAL_SETTLEMENT_MATCH_ROOT_CONFLICT",
    "v_duplicate_id IS NOT NULL",
    "public.bank_reconciliation_matches",
    "pg_advisory_xact_lock",
  ];
  for (const marker of requiredMarkers) {
    if (!originalDefinition.includes(marker)) {
      throw new Error(
        `Original guard tidak memiliki marker wajib "${marker}"; patch ditolak.`,
      );
    }
  }

  const marker = "      IF v_duplicate_id IS NOT NULL THEN";
  if (originalDefinition.indexOf(marker) < 0) {
    throw new Error("Lokasi duplicate-root branch tidak ditemukan; patch ditolak.");
  }
  const branch = `      IF COALESCE(current_setting('reconciliation.maintenance_flag', true), '') = '${CORRELATION}'\n` +
    `         AND COALESCE(current_setting('reconciliation.maintenance_correlation', true), '') = '${CORRELATION}'\n` +
    `         AND COALESCE(current_setting('application_name', true), '') = '${CORRELATION}'\n` +
    `      THEN\n` +
    `        -- Maintenance skips only the duplicate-root exception. Schema,\n` +
    `        -- correlation-root, source-mutation, and row locks remain active.\n` +
    `        RETURN NEW;\n` +
    `      END IF;\n\n`;
  return originalDefinition.replace(marker, `${branch}${marker}`);
}

async function assertPreconditions(client, { allowActive = false } = {}) {
  const functionState = await getTargetFunction(client);
  const triggerState = await getTargetTrigger(client);
  const disabledTriggers = await getDisabledProtectionTriggers(client);
  const invalidIndexes = await getInvalidProtectedIndexes(client);
  const unvalidatedConstraints = await getUnvalidatedProtectedConstraints(client);
  const activeEvent = await getMaintenanceEvent(client);

  if (triggerState.enabled !== "O") {
    throw new Error(
      `Target trigger ${TARGET_TRIGGER} tidak enabled (state=${triggerState.enabled}); fail closed.`,
    );
  }
  if (triggerState.functionSchema !== TARGET_SCHEMA || triggerState.functionName !== TARGET_FUNCTION) {
    throw new Error(
      `Target trigger tidak menunjuk ke ${TARGET_SCHEMA}.${TARGET_FUNCTION}(); fail closed.`,
    );
  }
  if (disabledTriggers.length > 0) {
    throw new Error(
      `Ada ${disabledTriggers.length} protection trigger disabled; tidak boleh melanjutkan.`,
    );
  }
  if (invalidIndexes.length > 0) {
    throw new Error("Ada protected index yang invalid/not-ready; fail closed.");
  }
  // NOT VALID is historical constraint drift, not a disabled constraint. It
  // still enforces new writes. Never rewrite or validate it as part of this
  // temporary mode; report it so the operator has explicit evidence.
  if (!allowActive && activeEvent?.action === "RECON_MAINTENANCE_ENABLED") {
    throw new Error("Maintenance correlation masih aktif; enable kedua diblokir.");
  }

  return {
    functionState,
    triggerState,
    disabledTriggers,
    invalidIndexes,
    unvalidatedConstraints,
    activeEvent,
  };
}

async function insertAudit(client, action, meta) {
  await client.query(
    `INSERT INTO public.bank_reconciliation_audit
       (mutation_id, action, actor, meta)
     VALUES (NULL, $1, $2, $3::jsonb)`,
    [action, `recon-maint:${CORRELATION}`, JSON.stringify(meta)],
  );
}

async function preflight(client) {
  const identity = await client.query(
    `SELECT current_database() AS database_name,
            current_user AS database_user,
            current_setting('server_version') AS server_version,
            current_setting('search_path') AS search_path`,
  );
  const state = await assertPreconditions(client, { allowActive: true });
  return {
    identity: identity.rows[0],
    correlation: CORRELATION,
    targetFunction: {
      name: `${TARGET_SCHEMA}.${TARGET_FUNCTION}()`,
      sha256: state.functionState.sha256,
      oid: state.functionState.oid,
    },
    targetTrigger: state.triggerState,
    disabledProtectionTriggerCount: state.disabledTriggers.length,
    invalidProtectedIndexCount: state.invalidIndexes.length,
    unvalidatedProtectedConstraintCount: state.unvalidatedConstraints.length,
    latestMaintenanceEvent: state.activeEvent
      ? { id: state.activeEvent.id, action: state.activeEvent.action, created_at: state.activeEvent.created_at }
      : null,
  };
}

async function enable(client, args) {
  requireMutationConfirmation(args);
  return withAdvisoryLock(client, async () => {
    await client.query("BEGIN");
    try {
      const state = await assertPreconditions(client);
      if (state.activeEvent?.action === "RECON_MAINTENANCE_ENABLED") {
        throw new Error("Maintenance state sudah aktif; restore dulu sebelum enable ulang.");
      }
      const original = state.functionState;
      if (original.definition.includes("reconciliation.maintenance_flag") ||
          original.definition.includes("reconciliation.maintenance_correlation")) {
        throw new Error(
          "Target function sudah mengandung maintenance branch tanpa manifest aktif; fail closed.",
        );
      }
      const patchedDefinition = buildPatchedDefinition(original.definition);
      await client.query(patchedDefinition);
      const patched = await getTargetFunction(client);
      if (!patched.definition.includes("reconciliation.maintenance_flag") ||
          patched.definition.includes("RECON_MAINTENANCE_RESTORED")) {
        throw new Error("Patched function tidak sesuai contract; rollback.");
      }
      await insertAudit(client, "RECON_MAINTENANCE_ENABLED", {
        correlation: CORRELATION,
        target_function: `${TARGET_SCHEMA}.${TARGET_FUNCTION}()`,
        target_function_oid: original.oid,
        original_sha256: original.sha256,
        original_definition: original.definition,
        patched_sha256: patched.sha256,
        trigger_definition: state.triggerState.definition,
        trigger_enabled: state.triggerState.enabled,
        disabled_protection_trigger_count: 0,
        protected_indexes_checked: true,
        protected_constraints_checked: true,
        unvalidated_protected_constraint_count: state.unvalidatedConstraints.length,
      });
      await client.query("COMMIT");
      return {
        action: "enabled",
        correlation: CORRELATION,
        originalSha256: original.sha256,
        patchedSha256: patched.sha256,
        disabledProtectionTriggerCount: 0,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

async function restore(client, args) {
  requireMutationConfirmation(args);
  return withAdvisoryLock(client, async () => {
    await client.query("BEGIN");
    try {
      const state = await assertPreconditions(client, { allowActive: true });
      const event = state.activeEvent;
      if (!event || event.action !== "RECON_MAINTENANCE_ENABLED") {
        throw new Error("Tidak ada maintenance state aktif untuk correlation ini.");
      }
      const meta = event.meta ?? {};
      requireExactCorrelation(meta.correlation, "stored correlation");
      const originalDefinition = String(meta.original_definition ?? "");
      const originalSha256 = String(meta.original_sha256 ?? "");
      const patchedSha256 = String(meta.patched_sha256 ?? "");
      const triggerDefinition = String(meta.trigger_definition ?? "");
      if (!originalDefinition || !originalSha256 || !patchedSha256 || !triggerDefinition) {
        throw new Error("Maintenance manifest tidak lengkap; restore ditolak.");
      }
      if (sha256(originalDefinition) !== originalSha256) {
        throw new Error("Hash original_definition pada manifest rusak; fail closed.");
      }
      if (state.functionState.sha256 !== patchedSha256) {
        throw new Error(
          "Function PROD berubah di luar manifest maintenance; tidak menimpa perubahan pihak lain.",
        );
      }
      if (state.triggerState.definition !== triggerDefinition || state.triggerState.enabled !== "O") {
        throw new Error("Trigger PROD berubah atau disabled; restore ditolak.");
      }

      await client.query(originalDefinition);
      const restored = await getTargetFunction(client);
      if (restored.sha256 !== originalSha256) {
        throw new Error("Definisi guard tidak kembali identik; rollback dan fail closed.");
      }
      const after = await assertPreconditions(client, { allowActive: true });
      if (after.disabledTriggers.length !== 0) {
        throw new Error("Ada protection trigger disabled setelah restore; rollback.");
      }
      if (after.triggerState.definition !== triggerDefinition ||
          after.triggerState.enabled !== "O" ||
          after.triggerState.functionName !== TARGET_FUNCTION) {
        throw new Error("Trigger tidak identik setelah restore; rollback.");
      }
      await insertAudit(client, "RECON_MAINTENANCE_RESTORED", {
        correlation: CORRELATION,
        target_function: `${TARGET_SCHEMA}.${TARGET_FUNCTION}()`,
        restored_sha256: restored.sha256,
        original_sha256: originalSha256,
        trigger_definition: after.triggerState.definition,
        disabled_protection_trigger_count: after.disabledTriggers.length,
        protected_indexes_checked: true,
        protected_constraints_checked: true,
        unvalidated_protected_constraint_count: after.unvalidatedConstraints.length,
      });
      await client.query("COMMIT");
      return {
        action: "restored",
        correlation: CORRELATION,
        restoredSha256: restored.sha256,
        disabledProtectionTriggerCount: 0,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

async function ensureTestArtifactTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.recon_maintenance_test_artifacts (
      id BIGSERIAL PRIMARY KEY,
      correlation TEXT NOT NULL,
      artifact_key TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT recon_maintenance_test_artifacts_unique
        UNIQUE (correlation, artifact_key)
    )
  `);
}

async function recordTestArtifact(client, args) {
  requireMutationConfirmation(args);
  if (!/^RECON_MAINT_20260914_TEST_[A-Za-z0-9_-]+$/.test(args.artifactKey ?? "")) {
    throw new Error(`artifact-key harus diawali ${TEST_ARTIFACT_PREFIX}.`);
  }
  let payload = {};
  if (args.payloadJson) {
    payload = JSON.parse(args.payloadJson);
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("payload-json harus berupa object JSON.");
    }
  }
  return withAdvisoryLock(client, async () => {
    await client.query("BEGIN");
    try {
      const state = await assertPreconditions(client, { allowActive: true });
      if (state.activeEvent?.action === "RECON_MAINTENANCE_ENABLED") {
        throw new Error("Record test artifact hanya boleh setelah maintenance di-restore.");
      }
      await ensureTestArtifactTable(client);
      const result = await client.query(
        `INSERT INTO public.recon_maintenance_test_artifacts
           (correlation, artifact_key, payload)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (correlation, artifact_key)
         DO UPDATE SET payload = EXCLUDED.payload
         RETURNING id, correlation, artifact_key, payload`,
        [CORRELATION, args.artifactKey, JSON.stringify(payload)],
      );
      await client.query("COMMIT");
      return { action: "test-artifact-recorded", row: result.rows[0] };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

async function cleanupTestArtifacts(client, args) {
  requireMutationConfirmation(args);
  return withAdvisoryLock(client, async () => {
    await client.query("BEGIN");
    try {
      const state = await assertPreconditions(client, { allowActive: true });
      if (state.activeEvent?.action === "RECON_MAINTENANCE_ENABLED") {
        throw new Error("Cleanup diblokir selama maintenance aktif; restore terlebih dahulu.");
      }
      const exists = await client.query(
        "SELECT to_regclass($1)::text AS relation_name",
        [TEST_ARTIFACT_TABLE],
      );
      if (!exists.rows[0]?.relation_name) {
        await client.query("COMMIT");
        return { action: "test-artifact-cleanup", deleted: 0, relation: TEST_ARTIFACT_TABLE };
      }
      const result = await client.query(
        `DELETE FROM public.recon_maintenance_test_artifacts
          WHERE correlation = $1
            AND artifact_key LIKE $2
         RETURNING id`,
        [CORRELATION, `${TEST_ARTIFACT_PREFIX}%`],
      );
      await client.query("COMMIT");
      return {
        action: "test-artifact-cleanup",
        relation: TEST_ARTIFACT_TABLE,
        correlation: CORRELATION,
        deleted: result.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

async function execute(client, args) {
  const command = args.command;
  if (!["preflight", "verify", "enable", "restore", "record-test-artifact", "cleanup-test-artifacts"].includes(command)) {
    throw new Error(`Command tidak dikenal: ${command}`);
  }
  if (command === "preflight" || command === "verify") {
    return preflight(client);
  }
  if (command === "enable") return enable(client, args);
  if (command === "restore") return restore(client, args);
  if (command === "record-test-artifact") return recordTestArtifact(client, args);
  return cleanupTestArtifacts(client, args);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = await connect();
  try {
    const result = await execute(client, args);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[recon-maintenance] BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
