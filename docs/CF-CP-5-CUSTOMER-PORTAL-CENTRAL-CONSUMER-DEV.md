# CF-CP-5 — Customer Portal Central Consumer (Development Only)

**Status:** `IMPLEMENTED / DEVELOPMENT-ONLY`

CF-CP-5 menambahkan consumer finance Customer Portal yang terpisah dari consumer
Sport Center. Consumer ini memakai event `customer_payment_finance_events` dan
state queue `customer_finance_processing`; tidak ada schema Sport Center yang
dipakai untuk intake atau claim Customer Portal.

## Mode boundary

Mode dikontrol oleh `CUSTOMER_PORTAL_FINANCE_MODE`:

- `legacy` (default): payment tetap menjalankan accounting legacy.
- `shadow`: payment transition menulis durable `payment_confirmed` event, tetapi
  tidak menjalankan consumer central.
- `central`: development-only consumer memproses event dan legacy accounting
  write pada route payment diputus.

Production selalu dipaksa kembali ke `legacy`, walaupun environment variable
memiliki nilai lain.

## Processing contract

Consumer hanya aktif jika `APP_ENV=development` dan mode `central`.

1. Event `payment_confirmed` diproyeksikan secara idempotent ke
   `customer_finance_processing`.
2. Claim menggunakan `FOR UPDATE SKIP LOCKED`, state `processing`, attempt
   counter, lock timestamp, dan retry availability.
3. Ownership wajib deterministik untuk company Customer Portal (`company_id=1`)
   pada event, payment, dan sales document.
4. Product scope harus `goods` atau `jasa`; `jasa` wajib memiliki service scope
   dan tepat satu mapping revenue aktif.
5. Tax snapshot harus lengkap dan exclusive.
6. Posting memakai canonical `postSalesInvoice`; kegagalan posting tidak
   menandai queue sebagai `posted`.
7. Ambiguitas ownership, mapping, tax, atau dokumen menjadi `manual_review`;
   error lain tetap `failed` dan dapat di-retry.

Payment transition tetap dikunci pada row payment dan event memiliki unique
identity berdasarkan source project, source payment, dan event type. Dengan
demikian webhook atau simulate-paid berulang tidak membuat event baru, dan
consumer tidak memiliki jalur payment-level paralel yang menggandakan sumber.

## Startup and verification

Schema queue adalah migration development-only dan terdaftar sebagai stage
startup yang idempotent. API development readiness harus menunjukkan:

```text
GET /api/health/ready
ready: true
customer_portal_ready: true
startup_registry_progress.completed_stages = total_stages
```

Verifikasi kontrak:

- CF-CP payment boundary + startup registry: `24/24` targeted tests passed.
- API typecheck: passed.
- Development API workflow: running and readiness returned HTTP 200.

Full suite tetap memerlukan `TEST_DATABASE_URL` atau
`STAGING_DATABASE_URL`; test database tidak boleh fallback ke development atau
production database.