# Bank Allocation Phase 2 — Implementation Report

**Sprint:** Sprint 4 Phase 2  
**Tanggal:** 2026-07-06  
**Status:** ✅ COMPLETE

---

## Ringkasan Eksekutif

Sprint 4 Phase 2 mengimplementasikan fondasi Bank Allocation & Auto-Matching untuk BizPortal ERP. Engine mencocokkan mutasi bank ke invoice/advance menggunakan scoring deterministik terbobot, menghasilkan rekomendasi yang **wajib dikonfirmasi oleh finance** sebelum alokasi dibuat. Tidak ada jurnal yang diposting secara otomatis.

---

## Deliverables

### Backend

| File | Status | Keterangan |
|------|--------|-----------|
| `artifacts/api-server/src/lib/bankAllocationMigration.ts` | ✅ Complete | 4 tabel baru, seed global rule |
| `artifacts/api-server/src/lib/reconciliation/bankAllocationScoring.ts` | ✅ Complete | Scoring engine deterministik, 6 dimensi |
| `artifacts/api-server/src/routes/bankAllocationMatching.ts` | ✅ Complete | 8 endpoints, auth guard, audit log |
| `artifacts/api-server/src/index.ts` | ✅ Registered | Migration + route terdaftar |
| `artifacts/api-server/src/routes/index.ts` | ✅ Registered | `/api/bank-allocation/*` aktif |

### Frontend

| File | Status | Keterangan |
|------|--------|-----------|
| `artifacts/bizportal/src/pages/finance/bank-allocation.tsx` | ✅ Complete | Tab UI + action workflow |
| `artifacts/bizportal/src/routes.tsx` | ✅ Wired | Route `/finance/bank-allocation` terdaftar |
| `artifacts/bizportal/src/components/layout/AppShell.tsx` | ✅ Wired | Menu Finance → Bank Allocation |

### Dokumentasi

| File | Status |
|------|--------|
| `docs/bank-allocation-engine.md` | ✅ |
| `docs/auto-matching-design.md` | ✅ |
| `docs/auto-matching-scoring.md` | ✅ |
| `docs/bank-allocation-api.md` | ✅ |
| `docs/bank-allocation-test-plan.md` | ✅ |
| `docs/bank-allocation-risk-register.md` | ✅ |
| `docs/bank-allocation-phase2-implementation-report.md` | ✅ (ini) |

---

## Database Schema

### Tabel Baru (additive only — tidak memodifikasi tabel existing)

```sql
bank_allocation_matches        -- scored candidate pairs (CANDIDATE→MATCHED→CONFIRMED)
bank_allocation_match_logs     -- immutable audit trail (append-only)
bank_allocation_rules          -- configurable scoring weights per company
bank_allocation_exceptions     -- NO_CANDIDATE / OVERPAYMENT / UNDERPAYMENT
```

### Relasi ke Tabel Existing (read-only dari modul ini)

```
bank_mutations          → read: fetch unmatched mutations
sales_documents         → read: invoice candidates
cash_advances           → read: advance candidates
allocation_headers      → write: confirm creates DRAFT header
allocation_lines        → write: confirm creates lines
```

---

## API Endpoints

| Method | Path | Fungsi |
|--------|------|--------|
| POST | `/api/bank-allocation/run` | Jalankan scoring engine |
| GET | `/api/bank-allocation/tabs/:tab` | Data per tab (5 tabs) |
| GET | `/api/bank-allocation/mutation/:id` | Detail + kandidat + log |
| POST | `/api/bank-allocation/match/:id/select` | CANDIDATE → MATCHED |
| POST | `/api/bank-allocation/match/:id/confirm` | MATCHED → CONFIRMED + buat draft allocation |
| POST | `/api/bank-allocation/match/:id/reject` | Reject dengan alasan |
| POST | `/api/bank-allocation/match/:id/split` | Split allocation manual |
| GET | `/api/bank-allocation/reports/summary` | Statistik dashboard |

---

## Scoring Algorithm

Deterministik, 6 dimensi, total 100 poin:

```
Amount     40 — exact match (±Rp 0.01)
Reference  25 — exact match provider_order_id vs ref
Invoice    15 — hanya tipe invoice, exact doc number
Customer   10 — fuzzy token overlap ≥ 40%
Date        5 — same day atau ±1 hari
Company     5 — company_id exact match
```

**Threshold:** `auto_suggest ≥ 95`, `manual_review 50–94`, `< 50 tidak ditampilkan`

---

## Jaminan Keamanan

### Anti-Auto-Post
- `bankAllocationMatching.ts` TIDAK mengimpor `AdvanceJournalService`
- `confirm` hanya membuat `allocation_headers.status = 'draft'`
- Posting jurnal sesungguhnya tetap melalui Allocation Center yang sudah ada

### Company Isolation
- Semua query memfilter `company_id = ${req.user.companyId}`
- Confirm memvalidasi `m.company_id` sebelum membuat allocation_header

### Auth Guard
- Semua endpoint: `requireAdmin` + `financeAuditMiddleware` + RBAC `invoice`
- Unauthenticated → 401

### Audit Trail
- Setiap action (MATCH_GENERATED, SELECT, CONFIRM, REJECT, SPLIT) menulis ke `bank_allocation_match_logs`
- Log bersifat append-only, tidak pernah di-update

---

## Smoke Test Results

| Test | Status |
|------|--------|
| Route `/api/bank-allocation/*` aktif | ✅ 401 (auth guard berjalan) |
| Migration tabel berjalan di startup | ✅ Log: "Tables ready" |
| Frontend route `/finance/bank-allocation` | ✅ Terdaftar |
| Menu Finance → Bank Allocation | ✅ Tampil di sidebar |
| TypeScript Sprint 4 files | ✅ Tidak ada error baru |

---

## Typecheck Status

### API Server Sprint 4 Files
- `bankAllocationMigration.ts` — ✅ Tidak ada error Sprint 4
- `bankAllocationScoring.ts` — ✅ Tidak ada error Sprint 4
- `bankAllocationMatching.ts` — ✅ Tidak ada error Sprint 4

### Pre-existing Errors (bukan Sprint 4)
- `accounting.ts` — 'kasbon' source type (pre-existing, diketahui)
- `cashAdvances.ts` — receiptUrl/settledAmount/disbursedAt (pre-existing, diketahui)
- `api-zod` TS6305 — output not built (pre-existing)

Baseline error count **tidak bertambah** karena Sprint 4.

---

## Batas Fase Ini

### In Scope (Phase 2) ✅
- Scoring engine deterministik
- Tab UI: Unmatched, Suggested, Matched, Posted, Exceptions
- Select, Confirm, Reject, Split actions
- Exception detection (NO_CANDIDATE, OVERPAYMENT, UNDERPAYMENT)
- Configurable weights per company
- Audit trail lengkap

### Next Phase (Phase 3) 📋
- **Merge**: banyak mutasi kecil → satu allocation
- Database-level constraint untuk prevent duplicate confirm (race condition)
- Bulk confirm (batch action dari tab Suggested)
- Custom kandidat manual (di luar invoice/advance yang ada)
- Notifikasi ke finance jika ada exception baru
- Integration test otomatis

---

## Cara Penggunaan

1. **Finance** navigasi ke **Finance → Bank Allocation**
2. Klik **Jalankan Matching** untuk menjalankan scoring engine
3. Tab **Suggested** menampilkan kandidat dengan skor ≥ 95 (auto-suggest ditandai ⭐)
4. Klik **Lihat** untuk melihat score breakdown per kandidat
5. Klik **Confirm** untuk membuat draft allocation (masuk Allocation Center)
6. Di **Allocation Center**: Submit → Approve → Post untuk posting jurnal
