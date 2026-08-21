# CF-CP-6 — Customer Portal Paylabs Settlement (Development Only)

**Status:** `PARTIAL / JASA_MAPPING_AND_REMAINING_RUNTIME_PROOFS`

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

Runtime proof belum dapat dijalankan pada workspace ini karena API
development gagal start sebelum membuka port `18444`. Log loader menunjukkan:

```text
GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not set
```

Secret tersebut harus dipasang melalui Replit Secrets; nilainya tidak pernah
dimasukkan ke source code atau chat. Karena database DEV belum dapat dimuat,
fixture write, consumer, accounting, settlement, negative matrix, retry
runtime, two-client race, rollback, dan readiness tidak boleh diklaim lulus.

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
| Jasa E2E | BLOCKED_SERVICE_MAPPING |
| Negative matrix | NOT RUN |
| Retry/idempotency runtime | NOT RUN |
| Two-client race | NOT RUN |
| Rollback/cleanup runtime | NOT RUN |
| Existing DEV data changed | 0 |
| Sport Center direct effects | 0 |
| Readiness | PASS |
| Customer Portal ready | YES |
| Sport Center ready | YES |
| Normal Customer Portal mode | LEGACY (configured default) |
| PROD writes/migrations/processors | 0 |
| PROD cutover | NO |

## Final status

```text
CF-CP-6 = PARTIAL
GOODS E2E = PASS
JASA E2E = BLOCKED_SERVICE_MAPPING
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
BLOCKER = no active Jasa service-specific COA mapping; negative/retry/concurrency live proofs still need dedicated DEV harness coverage
```

The DEV bootstrap secret is now available and readiness is proven. This status
does not claim the unexecuted negative, transient, or two-client runtime gates,
and does not invent a Jasa mapping that is absent from DEV configuration.

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