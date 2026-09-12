# Bank Allocation Phase 2 — UAT Readiness Score

**Tanggal**: 2026-07-07  
**Berdasarkan**: `bank-allocation-runtime-verification.md`

---

## Verdict

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                    │
│   ⛔  NEEDS PATCH                                                 │
│                                                                    │
│   Terdapat 1 bug terverifikasi (P1) dan 6 gap kritis yang         │
│   belum dapat diverifikasi runtime. Happy path confirm/           │
│   reject/split BELUM TERBUKTI bekerja di runtime.                │
│                                                                    │
│   Patch BUG-01 + verifikasi happy path wajib sebelum UAT.        │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Readiness Score

| Kategori | Bobot | Score | Nilai |
|---|---|---|---|
| Auth & Security | 20% | 10/10 | **20.0** |
| Route Registration | 10% | 10/10 | **10.0** |
| Scoring Engine | 20% | 8/10 | **16.0** |
| Error Handling / Validation | 20% | 9/10 | **18.0** |
| Happy Path (confirm/reject/split) | 25% | 0/10 | **0.0** |
| Reports / Metrics | 5% | 3/10 | **1.5** |
| **TOTAL** | **100%** | | **65.5 / 100** |

**Threshold SAFE FOR UAT**: ≥ 80 / 100  
**Score aktual**: **65.5** — **TIDAK MEMENUHI THRESHOLD**

---

## Rincian Penilaian Per Kategori

### Auth & Security (10/10 → 20.0)
- ✅ `requireAdmin` aktif di semua 8 endpoint — no bypass
- ✅ Company isolation via `req.user.companyId` di semua query
- ✅ Session cookie `sid` required (tidak ada auth bypass via header)
- ✅ `/dev-login` hanya aktif di non-PROD (`!process.env.REPLIT_DEPLOYMENT`)
- Deduction: 0

### Route Registration (10/10 → 10.0)
- ✅ Semua 8 group endpoint terdaftar dan merespons (bukan 404 Express)
- ✅ Middleware chain benar: `requireAdmin → handler`
- ✅ Error Express tidak bocor (500 ditangkap try/catch)
- Deduction: 0

### Scoring Engine (8/10 → 16.0)
- ✅ POST /run memproses 6 mutations (scored=6)
- ✅ Idempotent: run ke-2 scored=0
- ✅ OVERPAYMENT detection bekerja (400k mutation vs 300k advance → exception)
- ✅ UNDERPAYMENT detection bekerja (4 mutations, amounts < 300k → exceptions)
- ✅ Company isolation dalam candidate query
- ⚠️ -1pt: Auto-suggest threshold (95) belum ter-trigger (tidak ada exact match data)
- ⚠️ -1pt: Scoring weights (amount: 40pt) menyebabkan tidak ada mutation yang mencapai manual_review_floor=50 dengan data aktual → 0 rows di bank_allocation_matches
- Deduction: -4.0

### Error Handling / Validation (9/10 → 18.0)
- ✅ 400 untuk reject tanpa `reason`
- ✅ 400 untuk split dengan < 2 lines
- ✅ 400 untuk merge body tidak lengkap
- ✅ 404 untuk semua endpoint dengan matchId tidak ada di DB
- ✅ Tab validation: 400 "Tab tidak dikenal" untuk tab name invalid
- ⚠️ -1pt: Merge endpoint: body format ambiguous (response error muncul sebelum DB check untuk body kosong)
- Deduction: -2.0

### Happy Path (0/10 → 0.0)
- ❌ Confirm: NOT TESTED — tidak ada `bank_allocation_matches` row
- ❌ Reject (success): NOT TESTED
- ❌ Split: NOT TESTED — tidak ada matches
- ❌ Split sum validation: NOT TESTED
- ❌ Allocation header creation: NOT TESTED
- ❌ Auto-posting: berdasarkan code review, confirm hanya buat `allocation_headers` status=draft, TIDAK auto-post → ini **benar**, tapi belum terverifikasi runtime

> **Catatan penting**: Berdasarkan code review, confirm flow:  
> 1. Query `bank_allocation_matches` by matchId  
> 2. Status guard: hanya `CANDIDATE/MATCHED` bisa dikonfirm  
> 3. Buat `allocation_headers` (status=draft) + `allocation_lines`  
> 4. Update `bank_allocation_matches.status = CONFIRMED`  
> 5. Update `bank_mutations.status = 'matched'`  
>
> Flow tampak benar secara logis, tapi runtime tidak terverifikasi.

### Reports / Metrics (3/10 → 1.5)
- ✅ GET /reports/summary: endpoint aktif, HTTP 200
- ✅ Struktur response benar (semua fields ada)
- ✅ `open_exceptions=5` benar (5 exceptions di DB)
- ❌ `exception_rate=500` — BUG: kalkulasi overflow (denominator salah)
- Deduction: -7.0

---

## Checklist Pra-UAT

Selesaikan semua item ini sebelum memulai UAT:

### WAJIB (Blocker)

- [ ] **[BUG-01]** Fix `exception_rate` kalkulasi di `GET /reports/summary`
  - File: `artifacts/api-server/src/routes/bankAllocationMatching.ts` line ~677
  - Fix: ganti `total = COUNT(bank_allocation_matches) || 1` dengan `COUNT(bank_mutations WHERE company_id = ?)` 
  
- [ ] **[GAP-G1]** Verifikasi happy path confirm dengan data matching
  - Setup: buat bank_mutation dengan amount=300,000 (matching existing advance TLG/2026/00001) via channel yang set company_id=1
  - Jalankan `/run` → verify bank_allocation_matches row terbuat
  - Jalankan `POST /match/:id/confirm` → verify allocation_header terbuat status=draft

- [ ] **[GAP-G2]** Verifikasi happy path reject
  - Gunakan match dari langkah G1
  - Jalankan `POST /match/:id/reject {"reason":"..."}` → verify status=REJECTED

- [ ] **[GAP-G3]** Verifikasi happy path split
  - Perlu mutation dengan amount yang bisa dibagi ke beberapa advances
  - Test sum validation: `|sum(lines) - mutation.amount| > 0.01` → expect 400

### DIREKOMENDASIKAN (Sebelum UAT)

- [ ] **[R-01]** Tambah DB-level constraint untuk prevent double-confirm:
  ```sql
  CREATE UNIQUE INDEX CONCURRENTLY idx_ba_matches_confirmed
    ON bank_allocation_matches (bank_mutation_id)
    WHERE status = 'CONFIRMED';
  ```
  
- [ ] **[BUG-02]** Klarifikasi merge endpoint body format: apakah `lines` atau `mutationIds`?
  - Update API doc atau fix body validation order

- [ ] **[R-03]** Fix `/run` response: field `exceptions` harus mencakup OVERPAYMENT/UNDERPAYMENT bukan hanya NO_CANDIDATE

---

## Path Tercepat ke SAFE FOR UAT

**Estimasi effort**: 2-4 jam developer

1. **Fix BUG-01** (30 menit) — satu baris perubahan kalkulasi denominator
2. **Siapkan test data** (30 menit) — insert bank_mutation amount=300k via endpoint yang set company_id, atau direct DB insert
3. **Verifikasi happy path** (1 jam) — confirm/reject/split dengan data nyata
4. **Implement DB constraint R-01** (30 menit) — `CREATE UNIQUE INDEX` idempotent migration
5. **Re-run verifikasi** (30 menit) — semua tests ulang setelah patch

---

## Risk Matrix

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Confirm bug saat happy path (allocation_header tidak terbuat) | Medium | Critical | Mandatory pre-UAT test |
| Double-confirm race condition | Low | High | DB unique index (R-01) |
| exception_rate misleading metrics di dashboard | High (sudah terjadi) | Medium | Fix BUG-01 |
| Scoring floor terlalu tinggi → tidak ada matches di UAT | High | High | Turunkan manual_review_floor atau setup data amount-match |

---

## Lampiran: Environment

```
API Server  : Express 5, port 8080
DB          : Supabase PostgreSQL (SUPABASE_DATABASE_URL)
Admin Email : admcst001@gmail.com
Company ID  : 1 (CST)
Tables      : bank_allocation_matches, bank_allocation_exceptions,
              bank_allocation_rules, bank_allocation_match_logs,
              allocation_headers, allocation_lines
Sprint      : Bank Allocation Phase 2 (Sprint 4)
```
