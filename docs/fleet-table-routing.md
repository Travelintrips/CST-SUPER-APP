# Fleet Table Routing Map

> Generated: 2026-06-20  
> Status: DEV VALIDATED — PROD belum disentuh

## Peta Tabel Aktif (KEEP)

| User/Audit Name | Tabel Aktual di DB | Status | Keterangan |
|---|---|---|---|
| `fleet_partners` | `fleet_partners` | ✅ EXACT | CRITICAL KEEP — mitra Gojek/vendor |
| `fleet_vehicles` | `fleet_vehicles` | ✅ EXACT | CRITICAL KEEP — data kendaraan |
| `fleet_drivers` | `fleet_drivers` | ✅ EXACT | KEEP — data driver armada |
| `fleet_reports` | `fleet_reports` | ✅ EXACT | KEEP — tracking setiap upload CSV |
| `fleet_raw_transactions` | `fleet_transactions` | ⚠️ ALIAS | User menyebut "raw" tapi tabel aktual = transformed data. Raw CSV = `gojek_raw_transactions` |
| `gojek_raw_transactions` | `gojek_raw_transactions` | ✅ EXACT | KEEP — ground truth semua baris CSV |
| `fleet_outstanding_balances` | `fleet_outstanding` | ⚠️ VIEW | View `fleet_outstanding_balances` dibuat → mengarah ke `fleet_outstanding` |
| `fleet_cash_payments` | `fleet_cash_payments` | ✅ CREATED | HIGH KEEP — pencatatan pembayaran tunai driver |
| `fleet_reconciliation_batches` | `fleet_reconciliation_reports` | ⚠️ VIEW | View `fleet_reconciliation_batches` dibuat → mengarah ke `fleet_reconciliation_reports` |
| `fleet_ledger_entries` | `fleet_ledger_entries` | ✅ EXACT | HIGH KEEP — sync dengan accounting |

## Tabel Pendukung (KEEP, jangan drop)

| Tabel | Fungsi |
|---|---|
| `fleet_daily_summary` | Agregasi harian untuk dashboard KPI |
| `fleet_alerts` | Smart alerts & notifikasi armada |
| `fleet_alert_suppression` | Anti-spam alert |
| `fleet_accounting_journals` | Journal akuntansi dari data armada |
| `fleet_wa_logs` | Log WhatsApp reminder outstanding |
| `fleet_pipeline_health` | Health score setiap upload |
| `gojek_raw_transactions` | Raw data CSV, ground truth |
| `gojek_ingestion_queue` | Antrian transform pipeline |
| `gojek_ingestion_reports` | Log fase ingestion |
| `gojek_failed_rows` | DLQ — baris yang gagal transform |
| `gojek_pipeline_audit_logs` | Audit trail tiap field |
| `gojek_uploaded_files` | Dedup upload (file_hash) |
| `fleet_outstanding_import_log` | Riwayat import snapshot CSV outstanding |

## Routing API (prefix `/api/logistics/fleet/`)

| Endpoint | Tabel Utama | Keterangan |
|---|---|---|
| `GET /dashboard` | `fleet_transactions`, `fleet_outstanding`, `gojek_raw_transactions` | KPI + raw ground truth |
| `GET /drivers` | `fleet_drivers` | List driver |
| `GET /vehicles` | `fleet_vehicles` | List kendaraan |
| `GET /partners` | `fleet_partners` | List mitra |
| `GET /transactions` | `fleet_transactions` | Transaksi transformed |
| `GET /outstanding` | `fleet_outstanding` | Saldo outstanding |
| `POST /outstanding/repair` | `gojek_raw_transactions` → `fleet_outstanding` | Hitung ulang outstanding |
| `GET /accounting/journals` | `fleet_accounting_journals` | Journal akuntansi |
| `POST /accounting/journals/generate` | `fleet_transactions` → `fleet_ledger_entries` | Generate journal |
| `GET /alerts` | `fleet_alerts` | Smart alerts |
| `GET /reports` | `fleet_reports` | Daftar upload |
| `POST /reports/upload` | `gojek_raw_transactions` → `fleet_transactions` | Upload & transform CSV |
| `GET /validation/reconcile` | `fleet_reconciliation_reports` | Rekonsiliasi |
| `GET /cash-payments` | `fleet_cash_payments` | Pembayaran tunai driver |
| `POST /cash-payments` | `fleet_cash_payments` → `fleet_outstanding` | Catat pembayaran |

## Unique Indexes Aktif (Penyebab Potensial Data Drop)

| Index | Tabel | Kondisi | Efek |
|---|---|---|---|
| `gojek_raw_gopay_ref_company_uq` | `gojek_raw_transactions` | `WHERE gopay_ref IS NOT NULL AND != ''` | ✅ Deduplicate baris DENGAN gopay_ref |
| `gojek_raw_no_ref_dedup` | `gojek_raw_transactions` | `WHERE gopay_ref IS NULL OR = ''` | ✅ NEW — Deduplicate baris TANPA gopay_ref (Rental fee due) |
| `fleet_trx_gopay_ref_uq` | `fleet_transactions` | `WHERE gopay_ref IS NOT NULL AND != ''` | ✅ Deduplicate transformed transactions |
| `fleet_outstanding_company_driver_uq` | `fleet_outstanding` | `WHERE status = 'open'` | ⚠️ Dedup by driver_name — bisa salah jika nama sama |
| `fleet_drivers_company_extid_uq` | `fleet_drivers` | `WHERE ext_id IS NOT NULL AND != ''` | ✅ Safe upsert driver |

## Pipeline Data Flow

```
CSV Upload
  ↓
gojek_uploaded_files (dedup by file_hash)
  ↓
fleet_reports (1 record per upload)
  ↓
gojek_raw_transactions (100% baris CSV, dedup by gopay_ref OR composite)
  ↓
gojek_ingestion_queue (antrian transform)
  ↓
fleet_transactions (transformed, dedup by gopay_ref)
  ↓
fleet_outstanding (recalculateOutstanding — last balance per driver)
  ↓
fleet_daily_summary (regenerateDailySummary)
  ↓
fleet_accounting_journals (generate journal)
  ↓
fleet_ledger_entries (double-entry accounting)
```
