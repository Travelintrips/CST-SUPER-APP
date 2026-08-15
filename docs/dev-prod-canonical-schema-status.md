# DEV vs PROD Canonical Schema Status

**Audit date:** 2026-08-15  
**Repository:** `CST-SUPER-APP`  
**Scope:** read-only canonicalization of the Supabase development and production
runtime databases. Business rows were not compared.

## Repository and database identity

| Check | Result |
|---|---|
| Branch | `main` |
| HEAD | `07f8de1525f46d69882dd851c41327e284722ad9` |
| `origin/main` | `07f8de1525f46d69882dd851c41327e284722ad9` |
| Working tree at audit start | Clean |
| PostgreSQL | 17.6 on both databases |
| DEV safe fingerprint | `c08754327a1da154` |
| PROD safe fingerprint | `4f400bad2854ae32` |
| Different databases confirmed | **YES** |

The official Secret Manager loader resolved both environment bundles without
printing credentials. The development bundle passed validation. The production
bundle passed required-secret validation but is missing its `APP_ENV` metadata.
The strict schema-sync wrapper therefore failed closed before the production
report; the read-only catalog was collected through the same official loader
without the strict metadata gate.

## Raw catalog observation

These are current catalog sizes, not defect counts:

| Object | DEV | PROD |
|---|---:|---:|
| Schemas | 13 | 13 |
| Tables | 1,169 | 1,144 |
| Columns | 17,090 | 16,791 |
| Enums/values | 821 | 785 |
| Constraints | 2,422 | 2,561 |
| Indexes | 3,245 | 3,239 |
| Functions | 361 | 369 |
| Triggers | 32 | 36 |
| Views/materialized views | 19 | 20 |
| Policies | 54 | 59 |
| Sequences | 1,024 | 981 |

Raw differences are intentionally not used as the final parity verdict.

## Canonical ownership mapping

| Group | Canonical owner and conclusion |
|---|---|
| Source-controlled | Public application tables represented by Drizzle schemas and committed SQL migrations |
| Runtime-managed | Sport Center functions, mirror triggers, settlement objects, and idempotent API startup migrations |
| PROD security-managed | Production RLS enablement, deny policies, and service-role grants; these must not be weakened to match DEV |
| Legacy/manual | Old `migration_02_prod_to_dev.sql` objects, unused recipe/kasbon/delivery tables, old Sport Center `bookings`, and AI/menu/UAT fixtures |
| Owner decision | Existing function replacements, non-additive column/type changes, sequence ownership/range changes, and ambiguous constraint/index differences |

## Normalized application scope

Repository and runtime references identify **663 candidate application tables**.
After removing legacy/manual candidates, **654 active application tables exist
in both DEV and PROD**.

Nine source-referenced candidates exist only in PROD but are not part of the
active canonical contract:

- `public.recipes`
- `public.employee_kasbon`
- `public.hr_kasbon`
- `public.hr_kasbon_installments`
- `public.employee_advances`
- `public.cash_advance_installments`
- `public.sales_deliveries`
- `public.sales_delivery_lines`
- `sport_center.bookings`

The active Sport Center contract uses `sport_center.sport_bookings` and
`sport_center.sport_payments`; the old `sport_center.bookings` route/table is
legacy. No canonical active table is missing from PROD, and no active canonical
table requires automatic creation in DEV.

Semantic differences found inside the active application scope:

| Object class | Normalized candidates |
|---|---:|
| Columns | 443 |
| Enum definitions/values | 26 |
| PK/FK/unique/check constraints | 234 |
| Index definitions | 237 |
| Function catalog differences | 12 |
| Trigger catalog differences | 8 |
| View definitions/presence | 2 |
| RLS enablement differences | 552 |
| RLS policy semantics | 20 |
| Table grants | 23 |
| Sequence definitions/ownership | 13 |

The column, constraint, index, enum, and sequence counts are review sets, not
automatic migration instructions. Existing PROD definitions may be intentional
hardening or the owner-approved production form.

## Security classification

The 552 active-table RLS differences are primarily PROD-enabled/DEV-disabled.
They are classified as **PROD security hardening to preserve**, not as defects
that should be copied downward. The 20 PROD-only policy semantics are deny
policies for `anon`/`authenticated` with `USING (false)` and `WITH CHECK
(false)`; they are also preserved pending explicit owner review.

No operation disabled RLS, dropped a policy, weakened a grant, or changed
business data.

## Blocking canonical drift

Two runtime-managed Sport Center functions have material DEV/PROD differences:

1. `sport_center.create_payment_accounting_draft(integer)`
2. `sport_center.mirror_confirmed_payment_to_public()`

The repository runtime migration defines the mirror function as fail-closed and
recreates its trigger from the canonical source. The current PROD definition
contains a materially different exception-swallowing path and different public
booking bridge behavior. The accounting-draft function also differs while the
runtime migration only patches an existing owner definition rather than
providing a complete replacement contract.

These are **OWNER DECISION REQUIRED**. They were not replaced automatically
because replacing an existing live function can alter accounting and payment
behavior. The repository must first choose and prove the expected function
contract for both environments.

Other function/trigger/view differences are either PROD security/infra objects
with no repository owner or legacy objects with no active application
reference. They were preserved.

## Remediation gate

| Item | Result |
|---|---|
| Safe remediation applied | **NO** |
| Production writes | **0** |
| Destructive operations | **0** |
| RLS weakened | **NO** |
| Business data modified | **NO** |
| Canonical migration | **NONE** |
| Post-remediation verification | **NOT APPLIED** |

The production Secret Manager bundle also needs an owner-approved metadata-only
update to add `APP_ENV=production`; until then, the strict schema-sync gate
must remain blocked rather than bypassed in the source-controlled wrapper.

## Final verdict

❌ **CANONICAL PRODUCTION SCHEMA DEFECT REMAINS**  
**DO NOT REPUBLISH**

The verdict is based on the two material source-sensitive function drifts and
the unresolved production bundle metadata gate, not on raw catalog differences
alone. PROD security hardening and legacy objects were preserved.