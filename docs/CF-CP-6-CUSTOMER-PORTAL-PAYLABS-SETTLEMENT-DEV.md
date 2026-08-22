# CF-CP-6 — Customer Portal Paylabs Settlement (Development Only)

**Status:** `PASS / DEVELOPMENT_ONLY / READY_FOR_CF_CP_7`

Dokumen ini mencatat proof Customer Portal Central Finance yang aman untuk
development. Tidak ada jalur CF-CP-6 yang mengaktifkan central mode di
production; API normal tetap memakai `legacy`.

## Harness packaging

Harness durable berada di:

```text
artifacts/api-server/scripts/cf-cp-6-e2e-harness.mjs
```

Command:

```text
pnpm --filter @workspace/api-server cf-cp-6:dev
```

Command tersebut melakukan bundle dengan esbuild di dalam workspace API,
membundle package workspace TypeScript, tetap meng-external-kan `pg` dan
runtime logger, menjalankan hasilnya, lalu menghapus bundle generated.
Tidak ada package yang di-vendor serta tidak ada bundle yang dijalankan dari
`/tmp`.

**HARNESS PACKAGING = PASS**  
**PG MODULE RESOLUTION = PASS**

## Runtime contract

Harness memverifikasi sebelum fixture write:

- `APP_ENV=development`;
- `SAFE_DEV_TEST_MODE=true`;
- project ref database sama dengan DEV Supabase dan bukan PROD;
- `CUSTOMER_PORTAL_FINANCE_MODE=central` hanya di proses harness;
- `SPORT_CENTER_FINANCE_MODE=legacy`;
- resolver `customer_portal` memakai `company_id=1`, `qris`, `paylabs`, dan
  `IDR`;
- config bank account `17`, MDR `0.003`, fixed fee `0`, fee tax `0`, dan
  settlement delay satu hari kerja.

Fixture memakai prefix `CFCP6C_<run>_<pid>_`, memanggil
`confirmCustomerPortalPayment()`, memanggil consumer
`processCustomerPortalFinance()`, memeriksa accounting/public mutation/
Customer Portal settlement, mengulang consumer untuk idempotency, memeriksa
isolasi Sport Center, dan membersihkan semua row fixture.

The cleanup path also transitions the harness-created posted journal entries
to `draft` with the existing cancellation metadata before deleting their
lines. This is limited to the exact fixture IDs and preserves the posted-ledger
immutability guard.

## Boundary migration and snapshot

Boundary migration sudah memiliki additive snapshot columns:

- `product_scope`;
- `service_scope`;
- `tax_rule_id`;
- `tax_rate`;
- `tax_amount`;
- `tax_treatment`.

Penyebab gap sebelumnya adalah persistent startup marker yang melewati
additive boundary. Stage version telah dinaikkan dan restart DEV sebelumnya
melaporkan `executed=1`, `failed=0`.

**BOUNDARY MIGRATION = PASS (reported checkpoint)**  
**SNAPSHOT COLUMNS = PASS (reported checkpoint)**

## Quality gates

The canonical workspace order was executed on 2026-08-22:

1. shared/generated declaration build: `pnpm run typecheck:libs` — **PASS**;
2. API typecheck: `pnpm --filter @workspace/api-server typecheck` —
   **PASS**;
3. workspace typecheck: `pnpm run typecheck` — **PASS**;
4. API build: `pnpm --filter @workspace/api-server build` — **PASS**;
5. focused CF-CP tests — **14/14 PASS**;
6. `git diff --check` — **PASS**.

Focused test files:

```text
artifacts/api-server/src/__tests__/customer-portal-payment-boundary.test.ts
artifacts/api-server/src/__tests__/customer-portal-resolver-routing.test.ts
artifacts/api-server/src/__tests__/paylabs-accounting-consistency.test.ts
```

The broad Vitest suite was not used for this gate. It is intentionally excluded
from the CF-CP result because its historical invocation included unrelated
projects and environment-dependent database tests. No `RELATED_CF_CP_REGRESSION`
was found in the focused set.

## Runtime execution result

The development Secret Manager bootstrap credential is now configured through
Replit Secrets, and the API successfully loaded the development bundle. The
existing Goods harness was rerun against the guarded DEV project and passed:

```text
Goods accounting = 1
Goods public mutation = 1
Goods settlement = 1
MDR = 333.00
net settlement = 110667.00
retry idempotency = PASS
rollback cleanup = PASS
existing DEV data changed = 0
Sport Center direct effects = 0
```

The dedicated CF-CP-6C/6D harness is now present and was executed successfully
against the guarded DEV Supabase database. It covers six Jasa scopes,
`exim_service` fail-closed behavior, two-client concurrency, two payments on
one document, the complete 15-case negative matrix, transient retry, and
post-`finally` fixture verification.

## CF-CP-6C fixture isolation hardening

The dedicated Jasa harness now treats fixture IDs as unsafe until they pass a
pre-processing collision check. Each document/payment allocation runs inside a
savepoint, and the newly generated payment ID is checked against every
non-system table discovered from the live schema that has `payment_id`,
`source_payment_id`, or `source_id`. For `source_id`, both the payment and
document identities are checked. A collision rolls back only the new fixture
rows to the savepoint and retries with the normal PostgreSQL allocator, up to a
finite limit. No sequence is restarted or lowered.

This is required because a missing row in `payments` does not prove that its
integer ID is unused: historical DEV accounting, settlement, mutation, or
processing rows may still reference the identity. The harness therefore never
deletes or repairs a pre-existing collision. It maintains an ownership registry
for every created document, payment, event, processing row, accounting entry,
journal line, mutation, settlement, and settlement item; cleanup deletes only
IDs recorded in that registry. Sequence advancement caused by rolled-back
`nextval` calls is reported separately from business-row changes.

The two-payments-one-document proof uses the same allocator for both payment
rows, so document uniqueness is not bypassed and payment identity collisions
cannot be hidden by direct inserts.

| Gate | Result |
|---|---|
| Harness packaging | PASS |
| PG module resolution | PASS |
| Shared declaration build | PASS |
| API typecheck | PASS |
| Workspace typecheck | PASS |
| Bundle syntax check | PASS |
| API build | PASS |
| Focused CF-CP tests | 14/14 PASS |
| Broad suite | NOT RUN (baseline/unrelated excluded) |
| Goods E2E | PASS |
| Jasa mapping inventory | 6/6 present in DEV |
| Jasa E2E | PASS |
| Negative matrix | 15/15 PASS |
| Retry/idempotency runtime | PASS |
| Two-client race | PASS (1 + 0 claims) |
| Two payments / one document | PASS (2 posted) |
| Rollback/cleanup runtime | PASS |
| Existing DEV data changed | 0 |
| Sport Center direct effects | 0 |
| Readiness | PASS (HTTP 200; dynamic registry complete) |
| Customer Portal ready | YES |
| Sport Center ready | YES |
| Normal Customer Portal mode | LEGACY (configured default) |
| PROD writes/migrations/processors | 0 |
| PROD cutover | NO |

## Final status

```text
CF-CP-6 = PASS
GOODS E2E = PASS
JASA MAPPING INVENTORY = 6/6
JASA E2E = PASS (6/6)
EXIM_SERVICE = FAIL_CLOSED
NEGATIVE MATRIX = 15/15 PASS
TRANSIENT RETRY = PASS (attempts 0 -> 1 -> 2)
TWO-CLIENT = PASS (claims 1 + 0)
TWO PAYMENTS SAME DOCUMENT = PASS (2 accounting / 2 mutations / 2 settlements)
GOODS ACCOUNTING = 1
PUBLIC MUTATION = 1
SETTLEMENT = 1
RETRY IDEMPOTENCY = PASS
ROLLBACK/CLEANUP = PASS
EXISTING DEV DATA CHANGED = 0
SPORT CENTER DIRECT EFFECTS = 0
SHARED DECLARATION BUILD = PASS
API TYPECHECK = PASS
WORKSPACE TYPECHECK = PASS
API BUILD = PASS
FOCUSED TESTS = 14/14 PASS
BROAD SUITE = NOT_RUN / BASELINE_UNRELATED_EXCLUDED
GIT DIFF CHECK = PASS
READINESS = PASS
CUSTOMER PORTAL READY = YES
SPORT CENTER READY = YES
NORMAL CUSTOMER PORTAL MODE = LEGACY
PROD WRITES = 0
PROD CUTOVER = NO
READY FOR CF-CP-7 = YES
BLOCKER = NONE
```

The DEV bootstrap secret is available and readiness is proven. The DEV mapping
inventory contains the six supported service scopes:

```text
trucking    -> 4-1013-CST
sea_freight -> 4-1011-CST
air_freight -> 4-1012-CST
ppjk        -> 4-1014-CST
handling    -> 4-1018-CST
document    -> 4-1019-CST
```

The negative matrix covered unknown provider, missing/ambiguous payment and
COA configuration, company mismatch, missing/unknown Jasa service scope,
`exim_service`, missing/ambiguous revenue and tax mappings, and tax snapshot
mismatch. Every case proved its precondition, ended in `manual_review`, and
created zero accounting, public mutation, or settlement effects. Corruption
was inside a transaction/savepoint and canonical configuration was restored
before the next case.

During closure, two deterministic harness/runtime issues were corrected:

1. ambiguity fixtures now allocate an unused historical `effective_from` date
   instead of colliding with the mapping identity unique key;
2. processing enqueue now uses conflict-safe idempotency for all unique
   constraints, including `correlation_id`, so concurrent clients produce one
   processing row without a unique-key error.

The savepoint option remains opt-in to the guarded proof path. Normal worker
execution does not enable it, and the focused suite confirms the default
runtime path remains unchanged. Historical pre-existing DEV orphan references
were detected and preserved; they were not deleted or repaired.

## CF-CP-6D closure evidence

```text
Jasa scopes                  = 6/6 PASS
Negative matrix              = 15/15 PASS
All negative financial       = 0 accounting / 0 mutation / 0 settlement
Goods regression             = PASS
Goods MDR / net              = 333.00 / 110667.00
Same-payment race            = PASS (1 + 0 claims)
Same-document payments      = PASS (2 / 2 / 2)
Transient retry              = PASS (attempts 0 -> 1 -> 2)
Fixture persistence         = 0
Existing DEV business change = 0
Sport Center direct effects  = 0
Focused tests               = 14/14 PASS
API typecheck/build          = PASS / PASS
Workspace typecheck         = PASS
git diff --check             = PASS
Readiness                    = HTTP 200, ready=true
Customer Portal / Sport     = YES / YES
Normal Customer Portal mode  = LEGACY
PROD writes/migrations       = 0
PROD cutover                 = NO
```

## Next runtime command

Untuk mengulang goods proof setelah perubahan kode, restart workflow API lalu
jalankan:

```text
cd artifacts/api-server
APP_ENV=development NODE_ENV=development \
SAFE_DEV_TEST_MODE=true \
CUSTOMER_PORTAL_FINANCE_MODE=central \
SPORT_CENTER_FINANCE_MODE=legacy \
node load-secrets.mjs pnpm cf-cp-6:dev
```

Setelah proof selesai, mode normal Customer Portal harus kembali `legacy` dan
`/api/health/ready` harus mengembalikan HTTP 200 dengan
`customer_portal_ready=true` serta `sport_center_ready=true`.