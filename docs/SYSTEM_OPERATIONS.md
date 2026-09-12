# Fleet Intelligence — System Operations Manual

> **Dokumen ini adalah panduan tunggal operasi harian sistem Fleet Intelligence.**
> Versi: 1.0 | Berlaku untuk: PT Cahaya Sejati (CST) & PT Diva Servis (DVS)

---

## 1. DAILY CHECKS (Cek Harian Wajib)

Lakukan setiap pagi sebelum jam 09:00 WIB:

| # | Cek | Cara | Threshold |
|---|-----|------|-----------|
| 1 | **Control Center Health Score** | Buka `/logistics/fleet-intelligence/control-center` | ≥ 80 (hijau) |
| 2 | **DLQ unresolved rows** | Lihat card "Dead Letter Queue" | = 0 (ideal) / ≤ 5 (toleransi) |
| 3 | **Reconciliation status** | Lihat card "Reconciliation" | "In Sync" |
| 4 | **Upload success rate (7 hari)** | Lihat "Upload Trend" | ≥ 90% |
| 5 | **Critical alerts unread** | Lihat card "Alerts" | = 0 |
| 6 | **System boundary violations** | Lihat banner merah di Control Center | Tidak ada |

---

## 2. INGESTION PIPELINE STATES

Status report dalam `fleet_reports`:

```
pending → processing → completed
                    ↘ failed (→ DLQ)
```

| Status | Artinya | Tindakan |
|--------|---------|----------|
| `pending` | Antri untuk diproses | Normal, tunggu |
| `processing` | Sedang diparse & dimasukkan | Normal, jangan interrupt |
| `completed` | Sukses masuk ke `fleet_transactions` | ✅ |
| `failed` | Gagal parse/insert | Cek DLQ, retry dari UI Upload |

**Batas aman:** maks 500 report `pending+processing` secara bersamaan.

---

## 3. FAILURE HANDLING

### 3a. Upload Gagal (status = `failed`)

1. Buka `/logistics/fleet-intelligence/upload` → tab "DLQ / Failed Rows"
2. Klik row yang gagal → lihat error message
3. Kemungkinan penyebab:
   - Format kolom CSV berubah → upload ulang dengan mapping kolom yang benar
   - Duplikasi file (file_hash sama) → sudah terlindungi, tidak perlu re-upload
   - DB timeout → retry otomatis; jika tidak berhasil, klik tombol Retry di UI
4. Jika DLQ > 5 row → jalankan "Rekonsiliasi" dari Control Center

### 3b. Reconciliation Mismatch

Terjadi jika `fleet_daily_summary.gross_revenue` ≠ `SUM(fleet_transactions.gross_revenue)` untuk tanggal yang sama.

**Langkah recovery:**
1. Buka Control Center → klik "Rekonsiliasi Sekarang"
2. Atau buka Validation Report → klik "Perbaiki Otomatis"
3. Ini akan menjalankan `regenerateDailySummary()` — aman, idempotent
4. Jika mismatch masih ada setelah rekonsiliasi → cek di Validation Trace apakah ada duplikasi

### 3c. DLQ Menumpuk (> 20 rows)

1. Buka `/logistics/fleet-intelligence/upload`
2. Filter by status = "failed"
3. Identify pattern error (biasanya: kolom hilang, encoding issue, data kosong)
4. Fix sumber file, upload ulang
5. Resolve row DLQ lama via tombol "Resolve All" per report

### 3d. Health Score Merah (< 50)

Biasanya kombinasi dari:
- Success rate rendah + DLQ tinggi + reconciliation off

Urutan tindakan:
1. Resolve DLQ dulu (paling cepat naik 30 poin)
2. Jalankan rekonsiliasi (naik 20 poin)
3. Cek dan bersihkan critical alerts (naik 10 poin)

---

## 4. RESTART ORDER

Jika sistem perlu restart total (urutan wajib diikuti):

```
1. Stop: BizPortal (frontend)
2. Stop: API Server
3. Tunggu 10 detik
4. Start: API Server  ← tunggu sampai log "API Server started on port 8080"
5. Start: BizPortal  ← tunggu sampai "VITE ready"
6. Start: Gateway    ← selalu terakhir
```

**Tidak boleh restart API Server saat ada report dengan status `processing`** — akan menyebabkan stuck state. Pastikan tidak ada `processing` sebelum restart.

**Cek sebelum restart:**
```sql
SELECT COUNT(*) FROM fleet_reports WHERE status = 'processing';
-- harus = 0 sebelum restart
```

---

## 5. SYSTEM BOUNDARY GUARDRAILS

Batas sistem yang tidak boleh dilampaui:

| Metric | Batas Aman | Batas Kritis | Action jika Kritis |
|--------|-----------|-------------|-------------------|
| Queue size (pending+processing) | < 300 | 500 | Hentikan upload baru, selesaikan antrian |
| DLQ unresolved rows | < 50 | 200 | Resolve DLQ, cari root cause |
| Active drivers | < 2000 | 5000 | Audit data driver, nonaktifkan yang tidak aktif |
| Transaksi per hari | < 20.000 | 50.000 | Cek apakah ada duplikasi upload |
| Concurrent services | < 10 | 20 | Jangan tambah worker baru |

---

## 6. TROUBLESHOOTING GUIDE

### "Validation report error 500"
- Cek apakah tabel `fleet_daily_summary`, `fleet_transactions`, `fleet_accounting_journals` exist
- Kemungkinan migration belum jalan → restart API server

### "DLQ tidak berkurang setelah retry"
- Cek apakah error adalah "duplicate key" (berarti data sudah ada, bisa di-resolve)
- Cek apakah error adalah "null constraint" (berarti kolom wajib kosong di CSV)
- Cek apakah format tanggal di CSV cocok dengan `YYYY-MM-DD`

### "Health score 100 tapi ada data aneh di analytics"
- Health score hanya mengukur pipeline health, bukan data quality
- Gunakan Validation Report untuk cek data quality secara mendalam
- Jalankan "Trace Viewer" untuk lacak report ID yang mencurigakan

### "Jurnal akuntansi tidak match dengan transaksi"
- Periode jurnal harus mencakup semua tanggal transaksi
- Buka Validation Report → "Konsistensi Jurnal Akuntansi vs Transactions"
- Regenerate jurnal untuk periode yang bermasalah

### "System boundary violation muncul"
- Banner merah di Control Center = satu atau lebih batas system terlampaui
- Lihat detail di card "System Boundary Limits"
- Tindakan sesuai tabel di section 5 di atas

---

## 7. COGNITIVE LOAD RULES (Baca Sebelum Membuat Perubahan)

Untuk menjaga sistem tetap operabel:

- ❌ **JANGAN** buat pipeline layer baru tanpa menghapus yang lama
- ❌ **JANGAN** buat model ingestion baru; gunakan `fleet_reports` + `fleet_transactions`
- ❌ **JANGAN** buat governance dimension baru tanpa persetujuan
- ❌ **JANGAN** buat tabel baru tanpa prefix `fleet_`, `gojek_`
- ✅ **SELALU** cek guardrail di section 5 sebelum deploy perubahan besar
- ✅ **SELALU** update Health Score formula jika menambah metric baru
- ✅ **SELALU** pastikan setiap fitur baru terdaftar di Control Center

---

## 8. SUPABASE CONNECTION

Sistem terhubung ke **Supabase PostgreSQL** (production-grade).

- **Host:** `aws-1-ap-southeast-2.pooler.supabase.com:6543` (pgBouncer pool)
- **Mode:** Transaction pooling via pgBouncer
- **Connection string:** via env `SUPABASE_DATABASE_URL`
- **Pool config:** max=8 connections, connTimeout=8000ms, idleTimeout=30000ms

**Status koneksi:** Dapat dicek di API server startup log:
```
[db startup probe] pgBouncer OK — DB siap, tidak ada pre-existing throttle
```

Jika koneksi gagal:
1. Cek `SUPABASE_DATABASE_URL` di Replit secrets
2. Hapus circuit breaker: `rm -f /tmp/db-startup-cb.json`
3. Restart API Server

---

## 9. REFERENSI HALAMAN UTAMA

| Halaman | Path | Fungsi |
|---------|------|--------|
| **Control Center** | `/logistics/fleet-intelligence/control-center` | Single pane of glass — cek pertama setiap hari |
| Fleet Dashboard | `/logistics/fleet-intelligence` | KPI & trend revenue |
| Upload | `/logistics/fleet-intelligence/upload` | Import CSV Gojek, kelola DLQ |
| Transactions | `/logistics/fleet-intelligence/transactions` | Raw data semua transaksi |
| Drivers | `/logistics/fleet-intelligence/drivers` | Master data driver |
| Analytics | `/logistics/fleet-intelligence/analytics` | Analisis performa mendalam |
| Alerts | `/logistics/fleet-intelligence/alerts` | Notifikasi & warning otomatis |
| Accounting | `/logistics/fleet-intelligence/accounting` | Jurnal akuntansi double-entry |
| **Validation** | `/logistics/fleet-intelligence/validation` | Audit integritas data |

---

*Dokumen ini otomatis menjadi panduan referensi bagi siapapun yang mengoperasikan sistem Fleet Intelligence.*
