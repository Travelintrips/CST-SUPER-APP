# CF-CP-6 — Customer Portal Paylabs Settlement (Development Only)

**Status:** `PARTIAL / RUNTIME BLOCKED`

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
| API typecheck | PASS |
| Bundle syntax check | PASS |
| API build | PASS |
| Goods E2E | BLOCKED_BOOTSTRAP_SECRET |
| Jasa E2E | NOT RUN |
| Negative matrix | NOT RUN |
| Retry/idempotency runtime | NOT RUN |
| Two-client race | NOT RUN |
| Rollback/cleanup runtime | NOT RUN |
| Existing DEV data changed | 0 writes performed |
| Sport Center direct effects | 0 writes performed |
| PROD writes/migrations/processors | 0 |
| PROD cutover | NO |

## Next runtime command

Setelah bootstrap secret tersedia, restart workflow API lalu jalankan:

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