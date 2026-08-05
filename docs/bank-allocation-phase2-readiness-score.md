# Bank Allocation Phase 2 — Readiness Score

**Date:** 2026-07-06  
**Based on:** Runtime Verification Report (`bank-allocation-phase2-runtime-verification.md`)

---

## Skor Per Dimensi

| Dimensi | Skor | Bobot | Weighted |
|---------|------|-------|---------|
| API Correctness | 9/10 | 25% | 2.25 |
| Scoring Engine | 9/10 | 20% | 1.80 |
| Data Integrity | 6/10 | 20% | 1.20 |
| Company Isolation | 8/10 | 15% | 1.20 |
| UX / Tab Visibility | 5/10 | 10% | 0.50 |
| Audit Trail | 9/10 | 10% | 0.90 |
| **Total** | | | **7.85/10** |

---

## Breakdown

### API Correctness — 9/10

| Check | Result |
|-------|--------|
| POST /run returns ok+scored | ✅ |
| GET /tabs/:tab — semua 5 tab HTTP 200 | ✅ |
| POST /match/:id/confirm creates DRAFT | ✅ |
| confirm TIDAK membuat journal | ✅ |
| POST /match/:id/split valid | ✅ |
| POST /match/:id/split invalid ditolak | ✅ |
| POST /match/:id/reject dengan reason | ✅ |
| Duplicate confirm (sequential) ditolak | ✅ |
| Concurrent confirm — hanya 1 sukses | ⚠️ (by timing, bukan constraint) |

**-1 poin:** Tidak ada DB-level constraint yang secara deterministik mencegah race condition concurrent confirm.

---

### Scoring Engine — 9/10

| Sinyal | Weight | Verified |
|--------|--------|----------|
| Exact amount | 40 | ✅ +40 pts saat nominal persis sama |
| Reference number | 25 | ✅ provider_order_id == candidate.ref |
| Invoice number | 15 | ✅ same code path untuk type=invoice |
| Advance number | 25 (ref) | ✅ advance ref matched sebagai reference |
| Customer name fuzzy | 10 | ✅ token overlap, threshold 40% |
| Date ±1 hari | 5 | ✅ |
| Company exact | 5 | ✅ |
| Klasifikasi auto_suggest/manual_review/unmatched | ✅ |
| Overpayment detection | ✅ |
| Underpayment detection | ✅ |
| Weights dari DB (bank_allocation_rules) | ✅ |

**-1 poin:** `fetchAllocationCandidates()` tidak memfilter by company_id di SQL — isolation bergantung pada score floor saja (risk rendah tapi ada gap).

---

### Data Integrity — 6/10

| Check | Result |
|-------|--------|
| Confirm buat allocation_headers dalam transaction | ✅ |
| Split buat allocation_headers+lines dalam transaction | ✅ |
| Semua draft allocation: journal_entry_id=NULL | ✅ |
| Tidak ada double allocation_header di data test | ✅ (test kondusif) |
| **DB unique constraint mencegah double-confirm** | ❌ TIDAK ADA |
| Confirm handler: SELECT FOR UPDATE sebelum cek status | ❌ TIDAK ADA |

**Ini adalah P0.** Tanpa DB-level guard, Bulk Confirm dengan concurrent workers BISA menciptakan duplikat allocation_headers untuk satu bank mutation. -4 poin dari skor penuh.

---

### Company Isolation — 8/10

| Check | Result |
|-------|--------|
| Query tabs memfilter `bm.company_id = userCompanyId` | ✅ |
| Admin company lain: 0 rows di semua tab | ✅ |
| Scoring: company mismatch = 0 pts company | ✅ |
| Mutation company_id=2 vs advance company_id=1 → tidak masuk tab (score 45 < floor 50) | ✅ |
| `fetchAllocationCandidates` memfilter by company_id | ❌ tidak ada filter SQL |

**-2 poin:** Edge case — jika reference persis sama lintas company, kandidat masih bisa muncul dengan skor cukup tinggi.

---

### UX / Tab Visibility — 5/10

| Check | Result |
|-------|--------|
| 'unmatched' menampilkan mutasi belum diproses | ✅ |
| 'suggested' menampilkan CANDIDATE+auto_suggested | ✅ |
| 'matched' menampilkan CANDIDATE/MATCHED yang finance pilih | ✅ |
| 'posted' menampilkan CONFIRMED+allocation_status=posted | ✅ |
| **'matched' menampilkan CONFIRMED+draft (sudah confirm, belum posting)** | ❌ TIDAK MUNCUL |
| 'exceptions' menampilkan OVERPAYMENT/UNDERPAYMENT | ✅ |

**P1:** Setelah finance melakukan Confirm, alokasi menghilang dari semua tab sampai jurnal diposting. Finance tidak punya visibilitas terhadap status "sudah konfirmasi, menunggu posting". -5 poin.

---

### Audit Trail — 9/10

| Check | Result |
|-------|--------|
| `bank_allocation_match_logs` diisi saat MATCH_GENERATED | ✅ |
| Log diisi saat SELECT | ✅ |
| Log diisi saat CONFIRM (dengan allocation_header_id) | ✅ |
| Log diisi saat SPLIT (dengan line_count) | ✅ |
| Log diisi saat REJECT (dengan reason) | ✅ |
| Log diisi saat MERGE | ✅ |
| writeMatchLog menggunakan `.catch(()=>{})` — audit failure tidak rollback tx | ⚠️ by design, tapi silent |

**-1 poin:** Silent audit failure tidak ideal untuk compliance (P3, dapat diterima untuk UAT).

---

## Daftar Issues

> **Independent architect code review mengkonfirmasi P0–P2 di bawah dan menambahkan P0b, P0c, P1b.**

---

### 🔴 P0 — Race Condition: No DB Constraint for Duplicate Confirm

**Harus dipatch SEBELUM Bulk Confirm.**

```sql
-- Migration yang diperlukan:
CREATE UNIQUE INDEX IF NOT EXISTS idx_bam_one_confirmed_per_mutation
ON bank_allocation_matches (bank_mutation_id)
WHERE status = 'CONFIRMED';
```

Dan di confirm handler, tambahkan `FOR UPDATE`:
```typescript
// Sebelum transaksi:
const rows = await db.execute(sql`
  SELECT * FROM bank_allocation_matches 
  WHERE id = ${matchId} FOR UPDATE
`);
```

Atau gunakan `ON CONFLICT` pada UPDATE status:
```sql
UPDATE bank_allocation_matches
SET status = 'CONFIRMED', ...
WHERE id = ${matchId} AND status IN ('CANDIDATE','MATCHED')
-- Cek affected rows; jika 0, berarti race terjadi, rollback
```

---

### 🔴 P0b — SQL Injection di Merge Handler

`POST /match/:matchId/merge` menggunakan `sql.raw(\`ARRAY[${allMutIds.join(",")}]\`)` dengan `other_mutation_ids` langsung dari req.body tanpa sanitasi. Harus diganti dengan parameterized query atau strict integer validation sebelum dipakai.

---

### 🔴 P0c — Broken Access Control di Semua Mutating Handlers

select/confirm/split/merge/reject hanya fetch by `matchId`, tidak cek `company_id == user.companyId`. Admin yang menebak matchId perusahaan lain bisa operate atas data mereka. Harus tambah ownership check di setiap handler.

---

### 🟡 P1 — Confirmed-but-not-Posted Invisible di Tab

**Patch di `GET /tabs/matched` filter:**
```typescript
// Tambahkan CONFIRMED+non-posted ke matched tab:
statusFilter = sql`AND (
  (bam.status IN ('CANDIDATE','MATCHED') AND ...)
  OR (bam.status = 'CONFIRMED' AND (ah.status IS NULL OR ah.status NOT IN ('posted')))
)`;
// Dan hapus post-query filter yang membuang CONFIRMED:
// filteredRows = rows.filter((r) => r.allocation_status && r.allocation_status !== "posted");
// Ganti dengan:
filteredRows = rows.filter((r) => r.allocation_status !== "posted");
```

---

### 🟡 P2 — fetchAllocationCandidates: No Company Filter

**Patch di `bankAllocationScoring.ts`:**
```typescript
// Di kedua source query, tambahkan:
// sales_documents:
AND sd.company_id = ${mutation.company_id ?? -1}
// cash_advances:
AND ca.company_id = ${mutation.company_id ?? -1}
```

---

### ℹ️ P3 — writeMatchLog: Silent Failure

Saat ini `.catch(()=>{})`. Pertimbangkan minimal `logger.warn` agar audit gap terdeteksi.

---

## Final Verdict

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║          ⛔  NEEDS PATCH  —  BELUM SAFE FOR UAT              ║
║                                                              ║
║   Score: 7.85/10 (runtime) / 5.5/10 (post-code-review)      ║
║                                                              ║
║   P0  Race condition duplicate confirm (no DB constraint)    ║
║   P0b SQL Injection di merge handler (sql.raw+user input)    ║
║   P0c Broken access control — no company_id ownership check  ║
║   P1  Confirmed+draft allocations invisible di semua tab     ║
║   P1b Split/merge boleh line amount negatif/nol              ║
║                                                              ║
║   P2, P3: Dapat ditunda ke patch post-UAT                    ║
║                                                              ║
║   JANGAN mulai Bulk Confirm sebelum P0/P0b/P0c dipatch.      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### Yang Sudah Siap:
- ✅ Scoring engine — 7 sinyal bekerja benar (amount/ref/invoice/advance/customer/date/company)
- ✅ Manual confirm → DRAFT allocation (bukan jurnal)
- ✅ Split validasi sum == nominal
- ✅ Reject dengan reason tersimpan
- ✅ Company isolation via query filter di tabs
- ✅ Audit trail di bank_allocation_match_logs
- ✅ Overpayment/underpayment detection di Exceptions tab

### Yang Harus Dipatch Sebelum UAT:
- ❌ **P0** — DB unique constraint untuk prevent double-confirm race
- ❌ **P0b** — SQL injection di merge handler
- ❌ **P0c** — Ownership check di semua mutating handlers
- ❌ **P1** — Tab matched harus menampilkan CONFIRMED+draft allocations
- ❌ **P1b** — Validasi per-line amount positif di split/merge

---

*Verifikasi dilakukan 2026-07-06 oleh AI Agent. Semua test dilakukan terhadap instance live dengan data real dan test data cleanup tersedia.*
