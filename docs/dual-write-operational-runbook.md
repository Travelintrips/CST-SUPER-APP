# Operational Runbook — Dual Write Reliability Pipeline
## Phase 2A.2 | Production-Grade Dual Write

---

## 1. Ringkasan Arsitektur

Dual Write Reliability Pipeline memastikan setiap permintaan RFQ dari customer portal
tercatat di **dua sistem** secara atomik:

| Sistem | Tabel |
|---|---|
| Legacy portal (ERP) | `portal_product_orders` |
| Marketplace pipeline | `mkt_rfqs` |

Log seluruh operasi disimpan di: **`mkt_dual_write_log`**

---

## 2. Feature Flag

Reliability layer **diaktifkan otomatis** jika tabel `mkt_dual_write_log` ada di database.

```
_reliabilityEnabled = true   → tabel ada, layer aktif
_reliabilityEnabled = false  → tabel tidak ada, semua fungsi graceful no-op
```

Cek status:
```
GET /api/mkt/admin/reliability/summary
→ field: reliabilityEnabled
```

Jika tabel belum ada, jalankan migration:
```bash
# Development
pnpm migrate:dev

# Production
pnpm migrate:prod
```

Setelah migration, restart service agar `_reliabilityEnabled` di-re-check.

---

## 3. Status State Machine

```
[created] → pending
              │
              ├── mkt_ write OK  → success → (link backfill) → linked
              │
              └── mkt_ write FAIL → failed
                                      │
                                      ├── retry OK  → success → linked
                                      ├── retry FAIL (attempt < MAX_RETRY=3) → failed
                                      └── retry FAIL (attempt ≥ MAX_RETRY)  → exhausted
```

| Status | Artinya | Tindakan |
|---|---|---|
| `pending` | Baru dibuat, belum ada hasil | Normal — tunggu |
| `success` | mkt_ write OK | Normal |
| `linked` | Fully reconciled (mkt_ + portal) | Normal |
| `retrying` | Sedang di-retry oleh worker | Normal |
| `failed` | Gagal, masuk retry queue | Worker akan retry otomatis |
| `exhausted` | Gagal setelah 3x retry | **Butuh manual recovery** |

---

## 4. Normal Flow

```
[Customer submit RFQ]
       │
       ▼
createDualWriteLog()        → INSERT pending
       │
       ▼
[portal_product_orders INSERT]
       │
       ▼
[mkt_rfqs INSERT via createMktRfqEntry()]
       │
       ├── OK  → markDualWriteSuccess()  → status: success
       └── FAIL → markDualWriteFailed()  → status: failed → masuk retry queue
```

---

## 5. Retry Flow

**Worker otomatis** berjalan setiap **5 menit** (initial delay 4 menit).

```
retryFailedDualWrites()
  ├── SELECT failed WHERE attempt < 3  (batch 20)
  ├── FOR UPDATE SKIP LOCKED            (safe concurrent)
  ├── Set status = retrying
  ├── Call createMktRfqEntry()
  │     ├── OK  → status: success, catat retry_completed_at
  │     └── FAIL
  │           ├── attempt < 3 → status: failed (coba lagi di cycle berikutnya)
  │           └── attempt ≥ 3 → status: exhausted → ALERT dikirim via WhatsApp
  └── Log summary batch
```

Monitor retry queue:
```
GET /api/mkt/admin/dual-write/stats
→ pendingRetry: <jumlah entri yang masih bisa di-retry>
```

Trigger retry manual (tanpa menunggu cycle worker):
```
POST /api/mkt/admin/dual-write/retry
```

---

## 6. Manual Recovery (Exhausted)

Entri `exhausted` gagal setelah 3x retry otomatis. Perlu intervensi manual.

### Langkah 1 — Identifikasi

```
GET /api/mkt/admin/dual-write/failed
→ list entri status: failed, exhausted, pending
```

atau dari DB:
```sql
SELECT id, buyer_email, buyer_name, catalog_item_id, attempt, last_error, created_at
FROM mkt_dual_write_log
WHERE status = 'exhausted'
ORDER BY created_at DESC;
```

### Langkah 2 — Diagnosa

Baca `last_error` untuk memahami penyebab kegagalan.
Penyebab umum:
- `catalog_item_id` tidak ditemukan di `mkt_catalog_items`
- Seller tidak aktif / tidak punya company_id
- DB timeout saat beban tinggi

### Langkah 3 — Retry Manual (satu entri)

```
POST /api/mkt/admin/dual-write/retry/:id
```

Jika berhasil: status → `success`, resolution: `MANUAL_RECOVERY`

### Langkah 4 — Jika Retry Manual Juga Gagal

Berarti ada masalah data yang perlu diperbaiki dulu.
Perbaiki root cause (mis. perbaiki catalog entry, aktifkan seller),
lalu retry kembali.

Jika memang tidak bisa di-recover (mis. catalog item dihapus permanen):
```sql
UPDATE mkt_dual_write_log
SET resolution = 'MANUAL_CLOSED',
    updated_at = NOW()
WHERE id = <id>;
-- JANGAN ubah status ke deleted — biarkan di exhausted untuk audit trail.
```

---

## 7. Escalation

### Level 1 — Otomatis (worker)
- Retry hingga 3x. Alert WhatsApp jika ≥ 3 exhausted dalam 1 jam.

### Level 2 — Operator (manual retry via API)
- Gunakan `POST /api/mkt/admin/dual-write/retry/:id`
- Cek `GET /api/mkt/admin/reliability/summary` setiap hari

### Level 3 — Developer (root cause)
- Query langsung ke DB untuk diagnosa
- Perbaiki data atau code, lalu trigger retry

### Level 4 — Emergency (data loss risk)
- Jika `exhausted` terus bertambah tanpa bisa di-recover
- Cek apakah `createMktRfqEntry` memiliki breaking bug
- Rollback deployment jika perlu

---

## 8. Retention Policy

| Status | Kebijakan | Threshold |
|---|---|---|
| `success` / `linked` | Archive setelah 90 hari | 90 hari |
| `failed` | Simpan minimum 1 tahun | 365 hari |
| `exhausted` (resolved) | Archive setelah di-resolve manual | resolution IS NOT NULL |
| `exhausted` (unresolved) | **JANGAN SENTUH** | — |

> ⚠️ **Delete belum diimplementasi.** Cleanup worker hanya melaporkan (tidak menghapus data).
> Delete boleh dilakukan setelah:
> 1. Konfirmasi manual dari tim ops
> 2. Review cleanup report selama ≥ 2 minggu
> 3. Opsional: export ke cold storage sebelum delete

Lihat cleanup report:
```
GET /api/mkt/admin/cleanup/report
```

---

## 9. Monitoring

### Dashboard Utama
```
GET /api/mkt/admin/reliability/summary
```

Response fields:
| Field | Artinya | Target |
|---|---|---|
| `dualWriteSuccessPct` | % success 24 jam terakhir | ≥ 99% |
| `retryQueue` | Entri failed yang bisa di-retry | 0 (normal) |
| `failedQueue` | Total failed + exhausted | 0 (ideal) |
| `integrityScore` | (success+linked)/total × 100, 48 jam | ≥ 99 |
| `orphanCount` | Failed/exhausted dengan portal order ada | 0 (ideal) |
| `avgRetryTimeSec` | Rata-rata durasi 1 retry cycle | < 30s |
| `avgRecoveryTimeSec` | Rata-rata waktu dari created → resolved | < 600s |
| `failedLast24h` | Count failed 24 jam terakhir | < 5 |
| `exhaustedLast24h` | Count exhausted 24 jam terakhir | 0 |
| `pendingOldestAgeSec` | Umur entri pending tertua | < 600s |

### Raw Metrics
```
GET /api/mkt/admin/reliability/metrics
```

### Integrity Check (on-demand)
```
GET /api/mkt/admin/integrity
→ status: ok | warn | alert
```

---

## 10. Alert

Alert otomatis dikirim via **WhatsApp** ke semua nomor admin jika:
- ≥ 3 entri `exhausted` dalam 1 jam

Cooldown alert: **30 menit** (tidak spam).

Isi alert:
```
[DUAL WRITE ALERT]
<jumlah> dual-write RFQ exhausted dalam 1 jam terakhir.
mkt_ write gagal total setelah 3x retry.
Data ada di portal_product_orders tapi TIDAK di mkt_rfqs.

Cek: GET /api/mkt/admin/reliability/summary
```

---

## 11. Maintenance

### Worker yang berjalan:

| Worker | Delay awal (total dari start) | Interval |
|---|---|---|
| `mkt-dual-write-retry` | ~4 menit (115s stagger + 4m internal) | 5 menit |
| `mkt-dual-write-integrity` | ~12 menit (130s stagger + 10m internal) | 30 menit |
| `mkt-dual-write-cleanup` | ~27 menit (145s stagger + 25m internal) | 6 jam |

> Catatan: `registerWorker` delay adalah startup stagger antar-worker saja.
> Setiap worker masih memiliki initial delay internal sendiri sebelum cycle pertama.

### Restart service (jika diperlukan):
```bash
# Reset table readiness cache setelah migration
# (otomatis saat restart, atau via resetTableReadinessCache() di code)
```

### Cek tabel ada di DB:
```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'mkt_dual_write_log'
) AS "table_exists";
```

### Cek enum ada:
```sql
SELECT typname FROM pg_type WHERE typname = 'mkt_dual_write_status';
```

### Lihat distribusi status saat ini:
```sql
SELECT status, COUNT(*) FROM mkt_dual_write_log GROUP BY status;
```

---

## 12. File Referensi

| File | Keterangan |
|---|---|
| `artifacts/api-server/src/lib/services/dualWriteReliabilityService.ts` | Core service: create, mark, retry, metrics |
| `artifacts/api-server/src/lib/services/marketplaceDualWriteCleanupWorker.ts` | Cleanup & retention report worker |
| `artifacts/api-server/src/routes/mktAdmin.ts` | Admin API endpoints |
| `lib/db/src/schema/mktDualWriteLog.ts` | Drizzle schema + enum definition |
| `lib/db/drizzle/0014_mkt_dual_write_log.sql` | Migration DDL (idempotent) |

---

*Dokumen ini adalah bagian dari Phase 2A.2 — Dual Write Reliability Hardening.*
*Setelah reliability layer stabil, lanjut ke Phase 2B — Buyer Identity (company_id).*
