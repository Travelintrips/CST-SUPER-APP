# CF-SC-11 — Production Read-Only Parity Audit

**Audit date:** 2026-08-21  
**Scope:** production parity against the CF-SC-10C/10D-certified DEV Central
Finance contract  
**Safety boundary:** observation only; no production write, migration, cutover,
processor run, Paylabs call, WhatsApp send, backfill, settlement, or
reconciliation was performed.

## Executive result

```text
CF-SC-11 = BLOCKED
READY FOR PROD SHADOW = NO
```

Production connectivity was resolved through the production Secret Manager
bundle `cst-super-app-production`. The database probe opened a transaction and
executed `SET TRANSACTION READ ONLY`; the transaction was rolled back. The
production contract is not currently equivalent to the certified DEV contract.

The primary blockers are:

1. `sport_center.central_finance_processing` is missing in PROD.
2. All four shared-config tables are missing in PROD:
   `finance_project_configs`, `finance_project_payment_configs`,
   `finance_project_tax_mappings`, and `finance_project_coa_mappings`.
3. `sport_center.resolve_shared_finance_config` is missing in PROD.
4. `sport_center.ensure_canonical_bank_mutation_for_settlement` is missing in
   PROD.
5. PROD's `payment_settlement_batches.canonical_bank_mutation_id` FK is absent;
   DEV correctly references `sport_center.bank_mutations(id)`.
6. PROD startup state has only 63 marker rows and the `sport_center` stage is
   failed. The failure states that the canonical bank COA identity could not be
   resolved.

These findings are sufficient to stop the audit classification at
`BLOCKED_FOR_SHADOW`. No corrective action was taken.

## 1. Production connection safety

| Check | Result |
|---|---|
| PROD connection identified | YES |
| Production bundle | `cst-super-app-production` |
| Database | `postgres` |
| Connection user | `postgres` |
| Transaction read-only enforced | YES (`transaction_read_only = on`) |
| Production writes | 0 |
| Production migrations | 0 |

The connection was selected by `APP_ENV=production` through the existing
Secret Manager loader. The probe used the loaded `SUPABASE_DATABASE_URL`,
started a read-only transaction, issued only catalog/config/data `SELECT`
queries, and rolled the transaction back. Secret values were not printed.

## 2. Schema parity

| Contract relation | DEV | PROD | Result |
|---|---:|---:|---|
| `sport_center.payment_accounting_outbox` | present | present | partial |
| `sport_center.central_finance_processing` | present | **missing** | FAIL |
| `sport_center.payment_settlement_batches` | present | present | partial |
| `sport_center.bank_mutations` | present | present | partial |
| `public.bank_mutations` | present | present | partial |
| `public.finance_project_configs` | present | **missing** | FAIL |
| `public.finance_project_payment_configs` | present | **missing** | FAIL |
| `public.finance_project_tax_mappings` | present | **missing** | FAIL |
| `public.finance_project_coa_mappings` | present | **missing** | FAIL |
| `public.company_bank_accounts` | present | present | partial |
| `public.chart_of_accounts` | present | present | partial |
| `public.tax_rules` | present | present | partial |

Because required relations are absent, column, constraint, and index parity
cannot be certified as a whole. The relevant FK comparison is reported
separately below.

## 3. Function parity

Function identity hashes below are MD5 hashes of the live
`pg_get_functiondef()` output. They are comparison evidence, not a substitute
for semantic review.

| Function | DEV | PROD | Result |
|---|---|---|---|
| `sport_center.resolve_shared_finance_config(...)` | present | **missing** | FAIL |
| `sport_center.create_payment_accounting_draft(integer)` | present | present, different definition hash | FAIL |
| `sport_center.create_payment_settlement_batch(...)` | present | present, same signature/hash | PASS for this function |
| `sport_center.create_settlement_journal_draft(...)` | present | present, same signature/hash | PASS for this function |
| `sport_center.finalize_payment_settlement(...)` | present | present, same signature/hash | PASS for this function |
| `sport_center.ensure_canonical_bank_mutation_for_settlement(...)` | present | **missing** | FAIL |
| `sport_center.project_public_bank_mutation_to_canonical(integer)` | present, different definition hash | present, different definition hash | FAIL/REVIEW |

The DEV-only functions and their observed DEV definition hashes were:

```text
resolve_shared_finance_config(...)                         39f0b9c0d8ce522e35eae5238355c156
create_payment_accounting_draft(integer)                  023865839f62812b6953f85d6a7a1378
create_payment_settlement_batch(...)                      d1221f0de73bb9f144d2ec334fd09a5b
create_settlement_journal_draft(...)                      a0dcd4df545a01b2bc87b9c56b09ad43
ensure_canonical_bank_mutation_for_settlement(...)        a32d78d2beea4600908109645f40fde9
finalize_payment_settlement(...)                          d6b6ebe66133f967a25d612994503187
project_public_bank_mutation_to_canonical(integer)        cad845e2b2107c8a6229dd5b8dd4b886
```

The PROD-only observed hashes for functions that exist there were:

```text
create_payment_accounting_draft(integer)                  7c9399907817f45c311693a83cf2314f
create_payment_settlement_batch(...)                      d1221f0de73bb9f144d2ec334fd09a5b
create_settlement_journal_draft(...)                      a0dcd4df545a01b2bc87b9c56b09ad43
finalize_payment_settlement(...)                          d6b6ebe66133f967a25d612994503187
project_public_bank_mutation_to_canonical(integer)        cd7eb79cf57aeb4bb07d35c3536d3d75
```

Exact settlement identity, mutation-key re-resolution, canonical bridge
ownership, corrected settlement FK ownership, and supplemental settlement
fallback therefore cannot be certified in PROD.

## 4. Startup / migration marker parity

The current source registry contains 128 stages. The read-only PROD catalog
contains 63 marker rows, of which 62 are completed and one is failed.

```text
PROD STARTUP MARKER = 63 rows; 62 completed, 1 failed
LATEST REQUIRED STAGE = current registry, including
  sport_center_canonical_finance_config@3
  sport_center_payment_mirror_refresh@1
PARITY = NO
```

The failed PROD marker is:

```text
sport_center@1
Canonical bank COA identity unresolved:
expected exactly one active sport_center.coa_accounts row for
1-1023-CST/asset, found 0.
```

No marker was advanced and no migration was run.

## 5. Shared project and payment configuration

### Shared project configuration

DEV certified baseline:

```text
project_code = sport_center
company_id   = 1
project_config_id = 2 in DEV
```

PROD result:

```text
SPORT CENTER PROJECT CONFIG = MISSING
```

The required `public.finance_project_configs` relation is absent in PROD, so
equivalent business identity cannot exist in the inspected contract.

### QRIS / Mandiri Direct configuration

DEV certified baseline:

```text
payment_method                = QRIS
provider_code                 = mandiri_direct
currency                      = IDR
settlement_delay_business_days = 1
mdr_rate                     = 0.003
fixed_provider_fee            = 0
fee_tax_rate                 = 0
```

PROD result:

```text
QRIS MANDIRI CONFIG = MISSING
```

The required payment-config relation is absent. No production configuration
was changed.

## 6. Tax and COA parity

DEV certified semantic contract:

| Role | Certified business identity |
|---|---|
| Tax | PPN Sport Center, 11%, output, company 1 |
| `RECEIVING_BANK` | Bank Mandiri Ciputat |
| `REVENUE` | Pendapatan Booking Sport Center CST |
| `TAX_OUTPUT` | PPN Keluaran CST |
| `MDR_EXPENSE` | Biaya MDR & Payment Gateway CST |

PROD result:

```text
TAX RULE PARITY = NO — shared tax mapping relation missing
RECEIVING_BANK = FAIL — shared COA mapping relation missing; marker also reports missing legacy identity
REVENUE = FAIL — shared COA mapping relation missing
TAX_OUTPUT = FAIL — shared COA mapping relation missing
MDR_EXPENSE = FAIL — shared COA mapping relation missing
```

Numeric IDs were not compared across environments. No production COA or tax
row was inserted, updated, or repaired.

## 7. Foreign-key and bridge parity

DEV:

```text
canonical_bank_mutation_id -> sport_center.bank_mutations(id)
bank_mutation_id            -> sport_center.bank_mutations(id)
```

PROD:

```text
canonical_bank_mutation_id = FK missing
bank_mutation_id            -> sport_center.bank_mutations(id)
```

```text
CANONICAL FK OWNER = FAIL
LEGACY FK OWNER    = EXPECTED
PARITY             = FAIL
```

The legacy FK is preserved, but the canonical bridge FK required by the
certified DEV contract is not present.

## 8. Canonical mutation identity contract

The DEV source and runtime contract require:

```text
mutation_key  = SC-PAY-<payment_id>
canonical_key = sport_center:payment:<payment_id>
source_app    = sport_center
source_module = central_finance
source_table  = sport_payments
source_id     = payment identity
```

```text
CONTRACT SUPPORTED = NO
```

The result is fail-closed because the PROD processing table, shared resolver,
canonical settlement owner, and canonical FK are not all present. No mutation
row was created.

## 9. Existing PROD data compatibility

Only read-only aggregate inspection was attempted. Because
`sport_center.central_finance_processing` is absent, the full Central Finance
conflict matrix cannot be executed against PROD.

Observed safe catalog/data facts:

```text
public.bank_mutations and sport_center.bank_mutations exist
sport_center.payment_settlement_batches exists
duplicate canonical-key proof = not certifiable for the full contract
orphan canonical-FK proof = not certifiable because canonical FK is absent
posted settlement completeness = not certifiable for the full contract
```

```text
EXISTING PROD DATA = BLOCKER
```

This is a readiness blocker, not a claim that existing rows are corrupt. No
rows were repaired or deleted.

## 10. Mode status

The application source continues to default Sport Center finance to legacy
unless `SPORT_CENTER_FINANCE_MODE=central` is explicitly enabled. The
production secret bundle did not expose a separate mode override in the
read-only loader validation.

```text
PROD FINANCE MODE = LEGACY by source/default contract
```

No mode was changed. The absence of the central schema means production must
remain legacy.

## 11. Deployment source parity

Static inspection of the intended source found the certified implementation
paths for:

- shared config resolver
- processor orchestration
- accounting journal promotion
- settlement batch creation
- settlement journal owner
- settlement finalization
- canonical mutation handoff
- supplemental settlement fallback
- savepoint fallback
- exact settlement identity bridge
- test-only fixture filtering
- latest startup registry/stages

The current source therefore contains the CF-SC-10C/10D implementation surface:

```text
DEPLOYMENT SOURCE PARITY = PASS (source present)
```

This does not override the live PROD schema/function/marker failures. Source
parity and runtime parity are separate gates.

## 12. Shadow readiness classification

```text
SHADOW READINESS = BLOCKED_FOR_SHADOW
```

The following required gates are not met:

- schema parity
- function parity
- shared config availability
- tax parity
- COA parity
- canonical FK ownership
- canonical identity support
- complete existing-data compatibility evidence
- startup/migration marker parity

The following safety gates are met:

- production connection was identified safely
- read-only transaction was enforced
- production remains on the legacy source/default path
- no production writes or runtime processor execution occurred

## Final report

```text
CF-SC-11                     = BLOCKED
PROD CONNECTION              = PASS
READ ONLY ENFORCED           = YES
SCHEMA PARITY                = FAIL
FUNCTION PARITY              = FAIL
STARTUP/MIGRATION PARITY     = FAIL
SPORT CENTER PROJECT CONFIG = MISSING
QRIS MANDIRI CONFIG          = MISSING
TAX PARITY                   = FAIL
RECEIVING_BANK               = FAIL
REVENUE                     = FAIL
TAX_OUTPUT                  = FAIL
MDR_EXPENSE                 = FAIL
CANONICAL FK OWNER           = FAIL
CANONICAL MUTATION CONTRACT  = FAIL
EXISTING PROD DATA           = BLOCKER
PROD FINANCE MODE            = LEGACY
DEPLOYMENT SOURCE PARITY     = PASS
PROD WRITES                  = 0
PROD MIGRATIONS              = 0
PROD PROCESSOR RUNS          = 0
PROD PAYLABS CALLS           = 0
PROD WHATSAPP SENDS          = 0
READY FOR PROD SHADOW        = NO
BLOCKERS                     = missing central schema/config/resolver,
                               missing canonical owner/FK, failed startup marker
```

**STOP.**