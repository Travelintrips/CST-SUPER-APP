# CF-SC-12 — PROD Additive Central Finance Foundation Parity

**Date:** 2026-08-21  
**Input gate:** CF-SC-11 PROD read-only parity = `BLOCKED`  
**Scope:** additive foundation only; production must remain legacy

## Final result

```text
CF-SC-12 = BLOCKED
PROD MODE BEFORE = LEGACY
PROD MODE AFTER  = LEGACY
CENTRAL PROCESSOR RUNS = 0
PROD WRITES = 0
PROD PAYLABS CALLS = 0
PROD WHATSAPP SENDS = 0
PROD CUTOVER = NO
PROD SHADOW ENABLED = NO
LEGACY CLEANUP = NO
READY FOR POST-MIGRATION PROD PARITY AUDIT = NO
```

The phase stopped before any production migration, schema change, function
replacement, shared-config seed, or startup-marker update.

## Why the phase stopped

CF-SC-12 requires exact PROD business identities before shared configuration is
seeded. The read-only PROD discovery found:

| Required identity | PROD result |
|---|---|
| `RECEIVING_BANK` — `1-1023-CST`, Bank Mandiri Ciputat | **MISSING** from `public.chart_of_accounts`; no matching `sport_center.coa_accounts` row |
| `REVENUE` — `4-1017-CST` | resolved uniquely: PROD ID `72354`, active |
| `TAX_OUTPUT` — `2-1020-CST` | resolved uniquely: PROD ID `49109`, active |
| `MDR_EXPENSE` — `5-3050-CST` | **MISSING** from the exact-code lookup |
| Sport Center tax rule | resolved uniquely: ID `8`, PPN Sport Center 11%, output, company 1 |
| QRIS/Mandiri bank account | resolved through the owner-approved legacy config: `company_bank_accounts.id=2`, account `1640006707220`, IDR, MDR `0.003` |

The missing receiving-bank and MDR expense identities are not safe to infer
from similarly named accounts. The instruction therefore requires:

```text
BLOCKED_CONFIG_IDENTITY
STOP before shared config seed
```

No numeric DEV IDs were copied into PROD.

## Pre-migration PROD state

The CF-SC-11 evidence remains authoritative:

- `sport_center.central_finance_processing` missing.
- `public.finance_project_configs` missing.
- `public.finance_project_payment_configs` missing.
- `public.finance_project_tax_mappings` missing.
- `public.finance_project_coa_mappings` missing.
- `sport_center.resolve_shared_finance_config` missing.
- `sport_center.ensure_canonical_bank_mutation_for_settlement` missing.
- `canonical_bank_mutation_id` FK missing.
- `sport_center` startup marker is failed because the canonical bank COA
  identity cannot be resolved.

The production connection was resolved through the production Secret Manager
bundle and all discovery queries ran in a transaction with:

```sql
SET TRANSACTION READ ONLY;
```

The transaction was rolled back.

## Certified DEV contract freeze

The source of truth was kept as the certified DEV runtime and checked-in
CF-SC-10 implementation, not reconstructed business definitions. The exact
live DEV function identity evidence from CF-SC-11 remains:

```text
resolve_shared_finance_config(...)                  39f0b9c0d8ce522e35eae5238355c156
create_payment_accounting_draft(integer)            023865839f62812b6953f85d6a7a1378
create_payment_settlement_batch(...)                d1221f0de73bb9f144d2ec334fd09a5b
create_settlement_journal_draft(...)                a0dcd4df545a01b2bc87b9c56b09ad43
ensure_canonical_bank_mutation_for_settlement(...)  a32d78d2beea4600908109645f40fde9
finalize_payment_settlement(...)                    d6b6ebe66133f967a25d612994503187
project_public_bank_mutation_to_canonical(integer)  cad845e2b2107c8a6229dd5b8dd4b886
```

No PROD function was replaced because the required canonical identities were
not proven and the complete additive migration could not be safely completed.

## Migration application

```text
EXACT MIGRATION APPLIED = NO
SHARED CONFIG CREATED   = NO
FK INSTALLED             = NO
FUNCTIONS REPLACED       = NO
STARTUP MARKER ADVANCED  = NO
ORPHAN ROWS MODIFIED     = 0
PAYMENT/ACCOUNTING ROWS MODIFIED = 0
```

An attempt was made to use the installed `pg_dump` client to freeze exact DEV
table definitions. The local client was PostgreSQL 16.10 while the DEV server
reported PostgreSQL 17.6, so the extraction tool stopped before producing a
usable dump. This was a local tooling mismatch only; it made no PROD request
that could mutate data and did not alter the repository.

## Idempotency and quality gates

Because no migration was applied:

```text
MIGRATION IDEMPOTENCY = NOT RUN
TYPECHECK             = NOT RUN for CF-SC-12 changes
TARGETED TESTS        = NOT RUN for CF-SC-12 changes
BUILD                 = NOT RUN for CF-SC-12 changes
GIT DIFF CHECK        = PASS for the documentation-only change
READINESS             = BLOCKED
```

The application remains in the legacy path. No production restart or runtime
mode change was performed.

## Required resolution before retry

Resolve and owner-approve exact active PROD identities for:

1. `RECEIVING_BANK`: Bank Mandiri Ciputat / `1-1023-CST`.
2. `MDR_EXPENSE`: `5-3050-CST`, Biaya MDR & Payment Gateway CST.

Then repeat the read-only precheck, freeze exact DEV catalog definitions with a
PostgreSQL 17-compatible tool, and only after all identities are unique apply
one reviewed additive migration. Do not advance the startup marker merely to
hide the failed COA identity check.

**STOP.**