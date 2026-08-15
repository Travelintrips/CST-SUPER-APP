# DEV vs PROD Canonical Schema Status

**Audit date:** 2026-08-15  
**Repository:** `CST-SUPER-APP`  
**Scope:** read-only canonicalization of the Supabase development and production
runtime databases. Business rows were not compared.

## Repository and database identity

| Check | Result |
|---|---|
| Branch | `main` |
| HEAD | `a21481176293ad97e75b32c697f3bcfb79af7139` |
| `origin/main` | `a21481176293ad97e75b32c697f3bcfb79af7139` |
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

## Final normalized application drift

The counts below are **confirmed canonical application defects**, not raw
catalog/review-set sizes. The larger review sets above remain available for
owner-led review and are not treated as automatic migration instructions.

| Object class | Real canonical defects |
|---|---:|
| Tables | 0 |
| Columns | 0 confirmed |
| Enums | 0 confirmed |
| PK | 0 confirmed |
| FK | 0 confirmed |
| Unique | 0 confirmed |
| Checks | 0 confirmed |
| Indexes | 0 confirmed |
| Functions | 2 |
| Triggers | 0 confirmed |
| Views | 0 confirmed |
| RLS enablement | 0 real defects |
| RLS policies | 0 real defects |
| Grants | 0 real defects |
| Sequences | 0 confirmed |

The two confirmed function defects are source-sensitive runtime objects. The
552 RLS enablement differences, 20 deny-policy semantics, and other review-set
differences remain classified as production hardening, valid environment
differences, legacy objects, or owner-decision items as listed below.

## Final classification

### REQUIRED PROD REMEDIATION

1. Resolve and install the owner-approved definition of
   `sport_center.mirror_confirmed_payment_to_public()`. PROD currently has a
   materially different exception-swallowing path from the fail-closed
   repository contract.
2. Resolve the owner-approved complete contract for
   `sport_center.create_payment_accounting_draft(integer)` and install it in
   PROD only after the contract is proven. The current repository migration
   patches an existing owner definition; it is not a complete replacement.
3. Add `APP_ENV=production` to the production GCP bundle through the approved
   Secret Manager process. This is required for the strict schema-sync gate.

### REQUIRED DEV REMEDIATION

None identified from the existing normalized evidence. DEV already contains the
canonical active application table set and the fail-closed mirror behavior.
The accounting-draft function still requires the same owner-contract decision
before either environment is certified byte-identical.

### VALID ENVIRONMENT DIFFERENCES

- DEV and PROD are separate PostgreSQL 17.6 databases.
- Production may have stronger RLS enablement and deny policies.
- Production-only legacy/manual objects listed in the report are preserved.
- Sequence ownership/range and other environment-managed details require
  owner approval before any normalization.

### PROD SECURITY HARDENING

- RLS enabled on approximately 552 active application tables in PROD while
  absent in DEV.
- Approximately 20 PROD-only deny-policy semantics for `anon` or
  `authenticated` using `USING (false)` and/or `WITH CHECK (false)`.
- These must not be disabled, copied downward, or weakened.

### LEGACY OBJECTS

`public.recipes`, `public.employee_kasbon`, `public.hr_kasbon`,
`public.hr_kasbon_installments`, `public.employee_advances`,
`public.cash_advance_installments`, `public.sales_deliveries`,
`public.sales_delivery_lines`, and legacy `sport_center.bookings`.
The active Sport Center contract uses `sport_center.sport_bookings` and
`sport_center.sport_payments`.

### OWNER DECISION REQUIRED

- The complete owner definition of `sport_center.create_payment_accounting_draft(integer)`.
- Any non-additive column/type changes.
- Ambiguous constraint/index differences.
- Sequence ownership/range differences.
- Replacement of either live Sport Center function.

## Sport Center function drift

### Function 1

- **Function:** `sport_center.create_payment_accounting_draft(integer)`
- **Canonical source:** `artifacts/api-server/src/modules/sport-center/migration.ts`,
  runtime patch at lines 936–980.
- **Canonical safe summary:** preserve the existing owner implementation,
  expose `public` in `search_path`, and resolve the external bank identity
  through `sport_center.resolve_internal_bank_account_id(...)` before
  accounting insertion. The source is intentionally a patch, not a complete
  function definition.
- **DEV state:** exists; runtime definition MD5
  `c060fec112c68ba78e8fbf1ad7e630e4`; resolver marker present.
- **PROD state:** exists; runtime definition MD5
  `7c9399907817f45c311693a83cf2314f`; resolver marker present.
- **Outdated environment:** not safely assignable from the current repository.
  Both definitions depend on an existing owner implementation, and the
  repository does not provide a complete canonical replacement. DEV also has
  repeated `public` search-path artifacts.
- **Impact:** accounting-draft bank identity resolution can diverge between
  environments and affect journal/account mapping.
- **Remediation required:** YES, after owner contract approval.
- **Plan:** capture both current definitions, approve one complete function
  contract, then use `CREATE OR REPLACE FUNCTION` with the unchanged signature
  inside a controlled transaction. Verify the resolver marker, function hash,
  and a rollback copy of the prior definition. No trigger replacement is
  required by the checked-in patch.

### Function 2

- **Function:** `sport_center.mirror_confirmed_payment_to_public()`
- **Canonical source:** `artifacts/api-server/src/modules/sport-center/migration.ts`,
  function at lines 314–556 and trigger recreation at lines 558–573.
- **Canonical safe summary:** fail-closed metadata resolution, exactly-one
  public booking bridge, exactly-one company/bank/rule resolution, idempotent
  public payment projection, and no exception swallowing.
- **DEV state:** runtime definition MD5
  `828cf0c5a381165960e31d27c326a914`; fail-closed booking markers present and
  `WHEN OTHERS` swallowing absent.
- **PROD state:** runtime definition MD5
  `3e50d577cc1112830cc65df385a97a9c`; fail-closed booking markers present but
  `WHEN OTHERS` swallowing is present.
- **Outdated environment:** PROD is outdated relative to the repository
  fail-closed behavior.
- **Impact:** a confirmed Sport Center payment can be projected differently
  into public payments, and PROD may hide mirror failures instead of stopping
  the transaction.
- **Remediation required:** YES.
- **Plan:** after owner approval, apply the source-controlled function with
  `CREATE OR REPLACE FUNCTION`; recreate
  `trg_mirror_confirmed_payment_to_public` on
  `sport_center.sport_payments` with its current AFTER INSERT/UPDATE and
  confirmed-row condition. The function depends on the canonical Sport Center
  tables, public booking/payment bridge, metadata resolver, company mapping,
  bank mapping, settlement configuration, and business calendar. Run in a
  controlled transaction; function replacement is atomic, while trigger
  recreation has a short catalog-lock/gap risk. Roll back using the captured
  prior function and trigger definitions. Verify function hash, trigger
  definition, and a transaction rollback proof without modifying business
  rows.

## APP_ENV gate

The application runtime still requires the process-level `APP_ENV` to select an
environment. However, the production bundle's missing `APP_ENV` field is
accepted by the backward-compatible application loader with a warning. The
field becomes mandatory only when `SCHEMA_SYNC_REQUIRE_BUNDLE_ENV=1` is used.
Therefore this is a **TOOLING/CONFIGURATION WARNING**, not proof that the
production application runtime is currently unable to start. The strict
canonical schema worker remains correctly blocked until the bundle metadata is
added.

## Final gate

| Item | Result |
|---|---|
| Safe remediation applied | **NO** |
| Production writes | **0** |
| DEV writes | **0** |
| Business data modified | **NO** |
| RLS weakened | **NO** |
| Destructive operations | **0** |
| Master republish | **BLOCKED** |

## Final verdict

❌ **CANONICAL PRODUCTION SCHEMA DEFECT REMAINS**  
**DO NOT REPUBLISH**

The blocking condition is the two active source-sensitive Sport Center
function drifts, especially the PROD exception-swallowing mirror behavior.
The missing production bundle `APP_ENV` is a separate strict schema-sync
tooling gate. Production security hardening and legacy objects were preserved.

## Final 2-function canonical remediation gate

**Phase result:** BLOCKED BEFORE DATABASE WRITE

### Baseline

| Item | Result |
|---|---|
| Branch | `main` |
| HEAD | `c2b5a4103f9e9b72685faf23e8d526a51d4c164c` |
| `origin/main` | `a21481176293ad97e75b32c697f3bcfb79af7139` |
| Working tree before phase | Clean |
| Existing report | `docs/dev-prod-canonical-schema-status.md` |
| `git diff --check` | PASS |

### Function 1

- **Function/signature:** `sport_center.create_payment_accounting_draft(integer)`
- **Canonical source:** `artifacts/api-server/src/modules/sport-center/migration.ts`,
  lines 936–980.
- **Previous DEV state:** exists; definition MD5
  `c060fec112c68ba78e8fbf1ad7e630e4`.
- **Previous PROD state:** exists; definition MD5
  `7c9399907817f45c311693a83cf2314f`.
- **Semantic defect:** definitions differ, and DEV contains repeated
  `public` search-path artifacts.
- **Safety result:** **OWNER DECISION REQUIRED**. The installer reads and
  patches an existing owner definition; it does not contain a complete
  canonical function body. Replacing either side would require inventing or
  choosing an owner contract.
- **Production result:** NOT ATTEMPTED.
- **Canonical parity:** BLOCKED.
- **Dependent trigger/caller:** accounting-draft runtime owner/call path; no
  trigger replacement is specified by the installer.
- **Rollback available:** not captured because the write phase was not entered.

### Function 2

- **Function/signature:** `sport_center.mirror_confirmed_payment_to_public()`
- **Canonical source:** `artifacts/api-server/src/modules/sport-center/migration.ts`,
  lines 314–556; trigger installer at lines 558–573.
- **Previous DEV state:** definition MD5
  `828cf0c5a381165960e31d27c326a914`; fail-closed markers present and no
  `WHEN OTHERS` swallowing.
- **Previous PROD state:** definition MD5
  `3e50d577cc1112830cc65df385a97a9c`; `WHEN OTHERS` swallowing present.
- **Semantic defect:** PROD can swallow mirror failures and diverge from the
  fail-closed public-payment projection contract.
- **Safety result:** `CREATE OR REPLACE FUNCTION` is structurally suitable for
  the unchanged signature, but the two-function transaction was not entered
  because Function 1 is ambiguous.
- **Production result:** NOT ATTEMPTED.
- **Canonical parity:** NOT VERIFIED AFTER REMEDIATION.
- **Dependent trigger/caller:** `trg_mirror_confirmed_payment_to_public` on
  `sport_center.sport_payments`; no trigger was changed.
- **Rollback available:** not captured because the write phase was not entered.

### Database safety

| Item | Result |
|---|---|
| Production functions changed | **0** |
| Tables changed | **0** |
| Columns changed | **0** |
| Enums changed | **0** |
| Indexes changed | **0** |
| Constraints changed | **0** |
| RLS changed | **0** |
| RLS weakened | **NO** |
| Business rows modified | **NO** |
| Unrelated functions modified | **0** |
| Destructive operations | **0** |

### Verification

| Gate | Result |
|---|---|
| Function 1 canonical parity | **BLOCKED** |
| Function 2 canonical parity | **NOT RUN** |
| Dependent trigger integrity | **NOT CHANGED / NOT RUN AFTER REMEDIATION** |
| Focused remediation tests | **NOT RUN** |
| API typecheck | **NOT RUN** |
| API build | **NOT RUN** |
| `git diff --check` | **PASS** |

### Stop condition

The phase stopped under the explicit condition **canonical source genuinely
ambiguous**. No destructive workaround, guessed function body, partial
production remediation, or republish was performed.

**MASTER REPUBLISH: BLOCKED**

**FINAL VERDICT:**
❌ **CANONICAL PRODUCTION FUNCTION DEFECT REMAINS**
**MASTER REPUBLISH BLOCKED**

## Sport Center function contract recovery

**Phase:** evidence-only recovery
**Database writes:** `0`
**Business data modified:** `NO`
**RLS changed:** `NO`
**Republish:** `BLOCKED`

### Function 1

- **Function:** `sport_center.create_payment_accounting_draft(integer)`
- **Repository complete definition found:** `NO`
- **Historical commit:** `c1e25dcd359a633007ebfed0d1dac69e89ea1237`
  introduced only the owner-definition patch.
- **Historical file:** `artifacts/api-server/src/modules/sport-center/migration.ts`
  lines 936–980; the parent revision contains no complete Function 1 body.
- **DEV definition:** complete runtime body, `RETURNS integer`,
  `LANGUAGE plpgsql`, `SECURITY DEFINER`; current read-only definition MD5
  `dd75dce283fccdd1c47cb6e4ffda7239`. It serializes by payment, locks and
  validates a confirmed payment, reuses an existing confirmed-payment journal,
  calculates tax, selects Payment Clearing/CASH/BANK_RECEIPT mapping, inserts
  the journal and lines, validates the journal, and returns the journal ID.
- **PROD definition:** same complete runtime body after semantic normalization;
  current read-only definition MD5
  `7c9399907817f45c311693a83cf2314f`. The remaining runtime difference is
  duplicate `public` entries in `search_path`; normalized body SHA-256 is the
  same in DEV and PROD:
  `dc487bc7d49e30867553cb1e193dbf26606a9ea8404c24770c0e59aff496c6ae`.
- **Caller contract:** no repository API caller, repository trigger, or
  repository-owned wrapper for this exact function was found. The runtime body
  itself establishes the side effects and return value described above.
- **Test contract:** no focused repository test proving this exact function's
  owner contract, duplicate policy, journal line mapping, tax behavior, or
  exception contract was found.
- **Canonical classification:** **D — CANONICAL BODY STILL AMBIGUOUS**
- **Canonical source:** unresolved. The repository proves the bank-account
  resolver patch, but not the complete owner function contract.
- **Exact owner decision required:** approve the complete journal contract,
  including payment-method-to-debit mapping, tax-inclusive calculation,
  external-to-internal bank-account resolution, reuse/idempotency rule,
  draft validation behavior, exception behavior, and canonical `search_path`.
- **Remediation:** do not replace or normalize this function until that contract
  is source-controlled as a complete body.

### Function 2

- **Function:** `sport_center.mirror_confirmed_payment_to_public()`
- **Repository complete definition found:** `YES`
- **Canonical classification:** **A — CANONICAL BODY RECOVERED FROM
  REPOSITORY HISTORY**
- **Canonical source:** `artifacts/api-server/src/modules/sport-center/migration.ts`,
  lines 314–556, with trigger installer at lines 558–573.
- **Historical versions:** complete function introduced in commit
  `6295ad1f` (`Implement sport center migration and update provenance
  documentation`); subsequent semantic updates include `b0000b22` and the
  metadata changes attributed to `55d562b1`.
- **Repository test contract:** `artifacts/api-server/src/__tests__/phase4c7a5-mirror-contract.test.ts`
  verifies deterministic booking bridging, fail-closed company/bank/provider
  resolution, canonical provider/settlement/source identity, trigger ownership,
  and stable `SCPAY-SC-<id>` idempotency.
- **DEV definition:** current report hash
  `828cf0c5a381165960e31d27c326a914`; fail-closed booking checks present and
  no exception swallowing.
- **PROD definition:** current report hash
  `3e50d577cc1112830cc65df385a97a9c`; exception-swallowing behavior remains
  present and is outdated relative to the repository contract.
- **Remediation:** the repository body is sufficient for a future controlled
  `CREATE OR REPLACE FUNCTION` after Function 1 is resolved. Do not remediate
  this function alone in the current phase.

### Recovery decision

`create_payment_accounting_draft(integer)` remains the explicit blocker.
Function 2 is recoverable and unambiguous, but both functions must remain
unmodified until the owner contract for Function 1 is complete and
source-controlled.

**FINAL VERDICT:**
⚠️ **OWNER DECISION REQUIRED — FUNCTION CONTRACT**
**DO NOT REPUBLISH**

## Function 1 owner contract freeze

**Function:** `sport_center.create_payment_accounting_draft(integer)`

| Contract area | Current runtime behavior | Repository evidence | Owner decision |
|---|---|---|---|
| Journal mapping | QRIS/provider → `PAYMENT_CLEARING`; cash/tunai → `CASH`; otherwise `BANK_RECEIPT`. Revenue is `Pendapatan Sport Center`. | Full canonical body in `artifacts/api-server/src/modules/sport-center/migration.ts:937` and focused contract test. | No |
| Tax | Gross is rounded; DPP is gross divided by `1 + PPN%`; tax is gross minus DPP; PPN credit line only when tax > 0. | Full body and `payment-accounting-draft-contract.test.ts`. | No |
| Bank account resolution | Uses `resolve_internal_bank_account_id(company_id, external bank id)`; zero or multiple active matches throw. | Existing resolver and full canonical body. | No |
| Idempotency | Transaction advisory lock plus `payment_confirmed` non-reversal journal lookup; lowest existing journal ID wins. | Full canonical body and focused test. | No |
| Exception behavior | Throws on missing payment, non-confirmed status, missing booking, invalid amount, unresolved bank mapping, and failed journal validation. | Full canonical body and focused test. | No |
| Fee handling | No fee calculation or fee line is present in the current runtime body. | Full canonical body. | No behavior added |

### Freeze result

- **DEV/PROD runtime semantic parity:** `PASS`
- **Runtime normalized DEV/PROD body hash:**
  `dc487bc7d49e30867553cb1e193dbf26606a9ea8404c24770c0e59aff496c6ae`
- **Canonical source/runtime normalized body hash:**
  `759315773a89a4f4b5b9b7916a37e15860be04ab94f2f4e20e5d66927c4acdb1`
- **Current runtime contract:** de facto owner baseline, preserved without
  behavior changes.
- **Canonical repository definition:** CREATED at
  `artifacts/api-server/src/modules/sport-center/migration.ts:937`.
- **Search path:** normalized to exactly
  `pg_catalog, sport_center, public`.
- **Focused contract test:** PASS — 5 tests in
  `artifacts/api-server/src/__tests__/payment-accounting-draft-contract.test.ts`.

### Function 2 joint-remediation status

`sport_center.mirror_confirmed_payment_to_public()` remains unchanged and its
canonical body remains ready for joint remediation with Function 1. Neither
function has been applied to DEV or PROD in this phase.

### Quality gates

| Gate | Result |
|---|---|
| Focused Function 1 contract test | **PASS** |
| API typecheck | **PASS** |
| API build | **PASS** |
| `git diff --check` | **PASS** |
| Database writes | **0** |
| Business data modified | **NO** |
| RLS changed | **NO** |
| Master republish | **BLOCKED** |

## Final owner-contract freeze verdict

✅ **FUNCTION 1 CANONICAL CONTRACT FROZEN**
✅ **BOTH FUNCTIONS READY FOR JOINT REMEDIATION**

Production remediation and master republish remain separate phases and were not
performed here.