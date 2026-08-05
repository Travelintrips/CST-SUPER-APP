# Fleet Active Tables — KEEP List

> Status: AKTIF — Jangan hapus, rename, atau archive tabel berikut.  
> Berlaku untuk DEV dan PROD.

## CRITICAL KEEP (Jangan sentuh sama sekali)

### `fleet_partners`
- **Fungsi**: Master data mitra armada (Gojek, dsb). Direferensikan oleh `fleet_drivers`, `fleet_vehicles`, `fleet_reports`.
- **Resiko jika dihapus**: Cascade delete ke semua driver, kendaraan, dan laporan armada.
- **Owner**: Modul Fleet Intelligence > Partners

### `fleet_vehicles`
- **Fungsi**: Master data kendaraan armada. Linked ke driver dan transaksi.
- **Resiko jika dihapus**: Hilangnya tracking kendaraan dan korelasi plat-driver.
- **Owner**: Modul Fleet Intelligence > Vehicles

## HIGH KEEP

### `fleet_ledger_entries`
- **Fungsi**: Double-entry accounting dari aktivitas armada. Sync dengan COA sistem.
- **Resiko jika dihapus**: Putusnya audit trail akuntansi — tidak bisa di-reconstruct.
- **Sync**: `POST /accounting/journals/generate` → `fleet_accounting_journals` → `fleet_ledger_entries`

### `fleet_cash_payments`
- **Fungsi**: Rekam pembayaran tunai driver terhadap outstanding.
- **Resiko jika dihapus**: Hilangnya bukti pelunasan — outstanding tidak bisa di-reconcile.
- **Created**: Migration v15 (2026-06-20)

### `gojek_raw_transactions`
- **Fungsi**: Ground truth semua baris CSV yang pernah diupload. Tidak bisa di-reconstruct.
- **Resiko jika dihapus**: Kehilangan data asal — `recalculateOutstanding` dan reprocess tidak bisa jalan.

## KEEP (Aktif, Operasional)

| Tabel | Fungsi | Jangan Drop Karena |
|---|---|---|
| `fleet_drivers` | Master driver | Direferensikan oleh transaksi & outstanding |
| `fleet_reports` | Tracking upload | Audit trail setiap upload CSV |
| `fleet_transactions` | Data transformed | Sumber KPI dashboard & accounting |
| `fleet_outstanding` | Saldo piutang driver | Dipakai rekonsiliasi & WA reminder |
| `fleet_daily_summary` | KPI harian | Sumber chart dashboard |
| `fleet_alerts` | Smart alerts | Aktif dipakai notifikasi |
| `fleet_accounting_journals` | Jurnal armada | Linked ke finance |
| `fleet_reconciliation_reports` | Hasil rekonsiliasi | Audit trail pipeline |
| `gojek_ingestion_queue` | Antrian pipeline | Proses upload aktif |
| `gojek_failed_rows` | DLQ | Retry & audit baris gagal |
| `gojek_uploaded_files` | Dedup upload | Mencegah upload file duplikat |
| `fleet_outstanding_import_log` | Riwayat import snapshot | Audit trail impor outstanding manual |

## VIEW (Alias untuk backward compatibility)

| View | Target Tabel | Alasan |
|---|---|---|
| `fleet_outstanding_balances` | `fleet_outstanding` | Nama user/audit berbeda dengan tabel aktual |
| `fleet_reconciliation_batches` | `fleet_reconciliation_reports` | Nama user/audit berbeda dengan tabel aktual |

## Tabel yang SUDAH TIDAK AKTIF (jangan buat ulang)

Tidak ada tabel fleet yang sudah di-archive/drop di instance ini. Semua tabel fleet aktif.

## Aturan Penambahan Tabel Fleet Baru

Sebelum membuat tabel baru:
1. Cek `docs/LOGISTICS_MODULE_MAP.md` §7 Guardrail
2. Prefix wajib: `fleet_` atau `gojek_`
3. Harus ada di `initFleetSchema()` di `fleetIntelligence.ts`
4. Tambahkan ke daftar KEEP di file ini
5. Uji di DEV terlebih dahulu
