# CF-CP-6 — Customer Portal Paylabs Settlement (Development Only)

**Status:** `PARTIAL / DEDICATED_CFCP6C_RUNTIME_HARNESS_REQUIRED`

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

Fixture memakai prefix `CFCP6_E2E_`, memanggil
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
5. focused CF-CP tests — **11/11 PASS**;
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

The attached CF-CP-6C checklist requires a dedicated harness for six Jasa
scopes, `exim_service` fail-closed behavior, two-client concurrency, two
payments on one document, deterministic negative cases, transient retry, and
post-`finally` fixture verification. That harness is not present in the
current repository, so those gates remain unexecuted and are not claimed here.

| Gate | Result |
|---|---|
| Harness packaging | PASS |
| PG module resolution | PASS |
| Shared declaration build | PASS |
| API typecheck | PASS |
| Workspace typecheck | PASS |
| Bundle syntax check | PASS |
| API build | PASS |
| Focused CF-CP tests | 11/11 PASS |
| Broad suite | NOT RUN (baseline/unrelated excluded) |
| Goods E2E | PASS |
| Jasa mapping inventory | 6/6 present in DEV |
| Jasa E2E | NOT RUN (dedicated CFCP6C harness absent) |
| Negative matrix | NOT RUN |
| Retry/idempotency runtime | NOT RUN |
| Two-client race | NOT RUN |
| Rollback/cleanup runtime | NOT RUN |
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
CF-CP-6 = PARTIAL
GOODS E2E = PASS
JASA MAPPING INVENTORY = 6/6
JASA E2E = NOT_RUN (DEDICATED_CFCP6C_HARNESS_ABSENT)
NEGATIVE MATRIX = NOT_RUN
TRANSIENT RETRY = NOT_RUN
TWO-CLIENT = NOT_RUN
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
FOCUSED TESTS = 11/11 PASS
BROAD SUITE = NOT_RUN / BASELINE_UNRELATED_EXCLUDED
GIT DIFF CHECK = PASS
READINESS = PASS
CUSTOMER PORTAL READY = YES
SPORT CENTER READY = YES
NORMAL CUSTOMER PORTAL MODE = LEGACY
PROD WRITES = 0
PROD CUTOVER = NO
READY FOR CF-CP-7 = NO
BLOCKER = dedicated six-scope/negative/retry/concurrency CFCP6C harness is absent
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

This status does not claim the unexecuted six-scope, negative, transient, or
two-client runtime gates.

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