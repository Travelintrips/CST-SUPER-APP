#!/usr/bin/env node
import fs from "node:fs";

const [devPath, prodPath] = process.argv.slice(2);
if (!devPath || !prodPath) throw new Error("Usage: cf-sc-13b-compare.mjs DEV.json PROD.json");
const dev = JSON.parse(fs.readFileSync(devPath, "utf8"));
const prod = JSON.parse(fs.readFileSync(prodPath, "utf8"));

const devMap = new Map(dev.columns.map((row) => [`${row.table}.${row.column}`, row]));
const prodMap = new Map(prod.columns.map((row) => [`${row.table}.${row.column}`, row]));
const columnDiff = [];
for (const key of new Set([...devMap.keys(), ...prodMap.keys()])) {
  const left = devMap.get(key);
  const right = prodMap.get(key);
  if (!left || !right) {
    const row = left ?? right;
    columnDiff.push({
      table: row.table,
      column: row.column,
      dev: left ?? null,
      prod: right ?? null,
      classification: row.classification,
      action: !left ? "KEEP_PROD_EXTENSION" : row.classification === "CUSTOMER_PORTAL_ONLY" ? "OUT_OF_SCOPE" : "ADD_COLUMN",
    });
    continue;
  }
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    columnDiff.push({
      table: key.split(".").slice(0, 2).join("."),
      column: left.column,
      dev: left,
      prod: right,
      classification: left.classification,
      action: left.classification === "PROD_ALLOWED_EXTENSION" ? "KEEP_PROD_EXTENSION" : "REVIEW",
    });
  }
}

const devRoutineMap = new Map(dev.routines.map((row) => [row.signature, row.body_sha256]));
const prodRoutineMap = new Map(prod.routines.map((row) => [row.signature, row.body_sha256]));
const routineDiff = [];
for (const key of new Set([...devRoutineMap.keys(), ...prodRoutineMap.keys()])) {
  if (devRoutineMap.get(key) !== prodRoutineMap.get(key)) routineDiff.push({
    signature: key,
    dev_body_sha256: devRoutineMap.get(key) ?? null,
    prod_body_sha256: prodRoutineMap.get(key) ?? null,
  });
}

// DEV-only columns are not migration instructions. Only a missing shared
// contract column in PROD is unresolved; customer-portal and fixture fields
// remain explicitly allowed differences.
const requiredColumnDrift = prod.required_column_drift;
const requiredDrift = requiredColumnDrift.filter((row) =>
  row.classification === "SHARED_FINANCE_REQUIRED");
const fkBlocker = Number(prod.canonical_settlement_fk.invalid_references ?? 0);
const routineBlocker = prod.required_routines_present ? 0 : 1;
const provenanceBlocker = Object.values(prod.mutation_provenance).every(Boolean) ? 0 : 1;
const prodIndexDefs = prod.indexes.map((row) => row.indexdef.toLowerCase());
const indexParity = {
  processing_business_key: prodIndexDefs.some((def) =>
    def.includes("source_project") && def.includes("source_payment_id") && def.includes("event_type") && def.includes("unique")),
  processing_correlation: prodIndexDefs.some((def) =>
    def.includes("correlation_id") && def.includes("unique")),
  canonical_mutation: prodIndexDefs.some((def) =>
    def.includes("canonical_bank_mutation_id") && def.includes("unique")),
  project_identity: prodIndexDefs.some((def) =>
    def.includes("finance_project_configs") && def.includes("project_code") && def.includes("company_id")),
};
const indexBlocker = Object.values(indexParity).every(Boolean) ? 0 : 1;
const report = {
  audit: "CF-SC-13B",
  dev: {
    project_ref: dev.project_ref,
    read_only: dev.read_only,
    required_routines_present: dev.required_routines_present,
    finance_mode: dev.finance_mode,
    data_checks: dev.data_checks,
  },
  prod: {
    project_ref: prod.project_ref,
    read_only: prod.read_only,
    required_routines_present: prod.required_routines_present,
    finance_mode: prod.finance_mode,
    data_checks: prod.data_checks,
  },
  column_diff: columnDiff,
  routine_diff: routineDiff,
  canonical_settlement_fk: prod.canonical_settlement_fk,
  mutation_provenance: prod.mutation_provenance,
  constraint_parity: prod.canonical_settlement_fk.fk_exists &&
    prod.canonical_settlement_fk.invalid_references === 0 ? "PASS" : "FAIL",
  index_parity: indexParity,
  unresolved_sport_center_required_drift: requiredDrift.length,
  blockers: [
    ...requiredDrift.map((row) => `missing PROD shared column ${row.table}.${row.column}`),
    ...(fkBlocker > 0 ? [`${fkBlocker} invalid canonical settlement FK reference(s)`] : []),
    ...(routineBlocker ? ["required PROD routine is missing"] : []),
    ...(provenanceBlocker ? ["required mutation provenance column is missing"] : []),
    ...(indexBlocker ? ["required PROD idempotency/performance index is missing"] : []),
  ],
  classifications: {
    product_scope: "CUSTOMER_PORTAL_ONLY",
    service_scope: "CUSTOMER_PORTAL_ONLY",
    config_version: "PROD_ALLOWED_EXTENSION",
  },
  business_effects: {
    processing_rows: prod.data_checks.processing_rows,
    payment_writes: 0,
    accounting_writes: 0,
    settlement_effects: 0,
    mutation_effects: 0,
    processor_runs: 0,
  },
};
console.log(JSON.stringify(report, null, 2));
if (report.blockers.length > 0) process.exitCode = 1;