# Temporary PROD reconciliation maintenance

Correlation tetap: `RECON_MAINT_20260914`.

Tool ini **tidak men-disable trigger**. Ia hanya mengganti sementara definisi
`public.guard_canonical_settlement_match_root()` dan hanya melewati exception
duplicate-root jika sesi operasi memenuhi semua syarat berikut:

- `reconciliation.maintenance_flag = RECON_MAINT_20260914`
- `reconciliation.maintenance_correlation = RECON_MAINT_20260914`
- `application_name = RECON_MAINT_20260914`

Validasi schema canonical, correlation root, advisory lock, keberadaan bank
mutation sumber, FK, PK/unique, period lock, balance, posted-journal
immutability, payment validation, dan ledger protection tetap aktif. Tidak ada
`ALTER TABLE ... DISABLE TRIGGER`.

## Preflight read-only

Jalankan melalui loader resmi agar target pasti `SUPABASE_DATABASE_URL` PROD:

```bash
cd /home/runner/workspace
APP_ENV=production NODE_ENV=production \
env -u SUPABASE_DATABASE_URL_DEV -u DATABASE_URL \
node artifacts/api-server/load-secrets.mjs node \
scripts/reconciliation-maintenance-prod.mjs preflight
```

Preflight berhenti jika target function/trigger ambigu, ada protected trigger
disabled, atau protected index invalid/not-ready. Constraint PK/unique/FK
berstatus `NOT VALID` hanya dilaporkan sebagai drift historis; runner tidak
men-disable, me-recreate, atau memvalidasi ulang constraint tersebut.

## Enable dan restore

Agent tidak menjalankan perintah mutasi PROD. Operator yang memiliki approved
production write path harus menggunakan confirmation yang sama persis:

```bash
# Enable — hanya menyiapkan guard bersyarat sesi
APP_ENV=production NODE_ENV=production \
node artifacts/api-server/load-secrets.mjs node \
scripts/reconciliation-maintenance-prod.mjs enable \
  --execute \
  --correlation RECON_MAINT_20260914 \
  --confirm RECON_MAINT_20260914

# Setelah matching selesai, wajib restore
APP_ENV=production NODE_ENV=production \
node artifacts/api-server/load-secrets.mjs node \
scripts/reconciliation-maintenance-prod.mjs restore \
  --execute \
  --correlation RECON_MAINT_20260914 \
  --confirm RECON_MAINT_20260914
```

Connection yang menjalankan matching harus secara eksplisit memakai:

```sql
SET application_name = 'RECON_MAINT_20260914';
SET reconciliation.maintenance_flag = 'RECON_MAINT_20260914';
SET reconciliation.maintenance_correlation = 'RECON_MAINT_20260914';
```

Tanpa ketiga setting tersebut, guard berjalan normal. Jika function atau
trigger berubah di luar manifest, restore menolak overwrite dan fail closed.
Definisi asli disimpan bersama SHA-256 di `public.bank_reconciliation_audit`
sebagai audit evidence; restore membandingkan hash hasil catalog, bukan hanya
status command.

## Exact-target cleanup

Tool hanya menyediakan cleanup untuk tabel khusus artifact test non-reconciliation
`public.recon_maintenance_test_artifacts`, dengan correlation dan prefix key
tetap. Ia tidak pernah menghapus baris dari bank mutation, reconciliation match,
payment, journal, ledger, atau audit evidence.

```bash
# Record artifact test deterministik (opsional)
APP_ENV=production NODE_ENV=production \
node artifacts/api-server/load-secrets.mjs node \
scripts/reconciliation-maintenance-prod.mjs record-test-artifact \
  --execute \
  --correlation RECON_MAINT_20260914 \
  --confirm RECON_MAINT_20260914 \
  --artifact-key RECON_MAINT_20260914_TEST_example \
  --payload-json '{"purpose":"matching smoke test"}'

# Cleanup exact target — hanya setelah restore
APP_ENV=production NODE_ENV=production \
node artifacts/api-server/load-secrets.mjs node \
scripts/reconciliation-maintenance-prod.mjs cleanup-test-artifacts \
  --execute \
  --correlation RECON_MAINT_20260914 \
  --confirm RECON_MAINT_20260914
```

## Final verification

Jalankan `preflight` lagi. Hasil yang diterima:

- target function hash sama dengan `original_sha256` pada enable manifest;
- target trigger kembali `O` dan definisinya sama;
- `disabledProtectionTriggerCount = 0`;
- protected index semuanya valid/ready;
- jumlah PK/unique/FK `NOT VALID` sama seperti sebelum maintenance (tidak ada
  constraint yang diubah);
- audit terakhir untuk correlation adalah `RECON_MAINTENANCE_RESTORED`.

Jika salah satu tidak terpenuhi, jangan lanjutkan cleanup atau matching ulang.