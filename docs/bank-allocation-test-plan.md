# Bank Allocation — Test Plan

## Scope

Sprint 4 Phase 2: Bank Allocation & Auto-Matching Foundation.

Lingkup pengujian mencakup backend API, scoring engine, dan frontend UI. **Tidak termasuk** Allocation Center posting flow (sudah diuji di Sprint 3).

---

## 1. Unit Tests — Scoring Engine

### 1.1 Amount Scoring
| Test Case | Input | Expected |
|-----------|-------|----------|
| Exact match | mutation.amount = 5000000, cand.amount = 5000000 | amountPts = 40 |
| Rounding tolerance | mutation.amount = 5000000, cand.amount = 4999999.995 | amountPts = 40 |
| Mismatch | mutation.amount = 5000000, cand.amount = 5001000 | amountPts = 0 |

### 1.2 Reference Scoring
| Test Case | Expected |
|-----------|----------|
| Exact case-insensitive match | referencePts = 25 |
| Leading/trailing spaces | referencePts = 25 (after trim) |
| Partial match | referencePts = 0 |
| Either ref is null | referencePts = 0 |

### 1.3 Customer Fuzzy
| Test Case | Expected |
|-----------|----------|
| "PT MAJU BERSAMA" vs "maju bersama jaya" | matched = true (>40% overlap) |
| "PT XYZ" vs "CV ABC" | matched = false |
| Either name null | matched = false |

### 1.4 Date Scoring
| Test Case | Expected |
|-----------|----------|
| Same day | datePts = 5 |
| +1 day | datePts = 5 |
| +2 days | datePts = 0 |
| Invalid date | datePts = 0 |

### 1.5 Classification
| Skor | Expected Classification |
|------|------------------------|
| 95 | auto_suggest |
| 94.99 | manual_review |
| 50 | manual_review |
| 49.99 | unmatched |

---

## 2. Integration Tests — API Endpoints

### 2.1 POST /api/bank-allocation/run
```bash
# Setup: insert 1 unmatched bank_mutation + 1 invoice di sales_documents
curl -X POST /api/bank-allocation/run \
  -H "Cookie: sid=<valid_session>" \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: { ok: true, scored: 1, auto_suggest: ?, exceptions: ? }
# Verify: bank_allocation_matches row exists
# Verify: bank_mutations.status = 'matched'
# Verify: NO accounting_entries created
```

### 2.2 GET /api/bank-allocation/tabs/unmatched
```bash
curl /api/bank-allocation/tabs/unmatched -H "Cookie: sid=<valid>"
# Expected: { tab: 'unmatched', rows: [...] }
# Verify: semua rows milik company user
```

### 2.3 POST /api/bank-allocation/match/:id/confirm
```bash
curl -X POST /api/bank-allocation/match/1/confirm \
  -H "Cookie: sid=<valid>" -d '{}'
# Expected: { ok: true, allocation_header_id: N, allocation_no: "BAM-..." }
# Verify: allocation_headers.status = 'draft'
# Verify: allocation_lines dibuat
# Verify: TIDAK ada accounting_entries
# Verify: bank_allocation_matches.status = 'CONFIRMED'
```

### 2.4 POST /api/bank-allocation/match/:id/split (validasi total)
```bash
# Lines total = 3000000, mutation.amount = 5000000
# Expected: 400 "Total split tidak sama dengan nominal mutasi"
```

### 2.5 POST /api/bank-allocation/match/:id/reject
```bash
# Without reason: Expected 400
curl -X POST /api/bank-allocation/match/1/reject \
  -H "Cookie: sid=<valid>" -d '{"reason":"Test reject"}'
# Expected: { ok: true, status: 'REJECTED' }
```

### 2.6 Auth Guard
```bash
# Without session cookie:
curl /api/bank-allocation/tabs/unmatched
# Expected: 401
```

---

## 3. Company Isolation Tests

### 3.1 Cross-company data tidak bocor
```
Setup: User A (company_id=1) dan User B (company_id=2)
User A runs matching → bank_allocation_matches company_id=1 dibuat
User B GET /tabs/suggested → rows hanya company_id=2
```

### 3.2 Confirm cross-company harus blocked
```
Match ID 50 milik company_id=1
User company_id=2 POST /match/50/confirm → harus 400/403
(match.company_id diperiksa sebelum INSERT allocation_headers)
```

---

## 4. No-Auto-Post Tests

### 4.1 Jalankan matching engine
```
Sebelum: COUNT(*) FROM accounting_entries = N
POST /api/bank-allocation/run
Sesudah: COUNT(*) FROM accounting_entries = N (tidak berubah)
```

### 4.2 Confirm match
```
Sebelum: COUNT(*) FROM accounting_entries = N
POST /api/bank-allocation/match/:id/confirm
Sesudah: COUNT(*) FROM accounting_entries = N (tidak berubah)
Sesudah: allocation_headers.status = 'draft' (bukan 'posted')
```

---

## 5. Frontend Smoke Tests

| Test | Steps | Expected |
|------|-------|----------|
| Halaman load | Navigate /finance/bank-allocation | Halaman tampil, 5 tabs terlihat |
| Menu Finance | Buka sidebar Finance | "Bank Allocation" muncul |
| Run matching | Klik "Jalankan Matching" | Toast "Matching engine selesai" |
| Refresh | Klik Refresh | Tabel di-reload |
| View detail | Klik Lihat pada row Unmatched | Dialog muncul dengan kandidat |
| Confirm | Klik Confirm pada kandidat MATCHED | Toast success, allocation_no tampil |
| Reject | Klik reject icon → isi alasan → submit | Toast success, row hilang dari tab |
| Summary strip | Summary cards tampil | 6 metrics terlihat jika ada data |

---

## 6. Exception Handling Tests

| Skenario | Expected |
|----------|---------|
| Mutation tanpa kandidat | exception_type=NO_CANDIDATE di tab Exceptions |
| Mutation > kandidat terbaik | exception_type=OVERPAYMENT + CUSTOMER_DEPOSIT line saat confirm |
| Mutation < kandidat terbaik | exception_type=UNDERPAYMENT, outstanding tetap |
| Konfirmasi match sudah CONFIRMED | 400 "Match sudah diproses" |
| Scoring ulang (ON CONFLICT) | Score di-update, status tidak berubah jika sudah CONFIRMED |

---

## Acceptance Criteria Sprint 4

- [ ] GET /api/bank-allocation/tabs/:tab → 200 (bukan 500)
- [ ] POST /api/bank-allocation/run → scored ≥ 0
- [ ] POST /api/bank-allocation/match/:id/confirm → `allocation_headers.status = 'draft'`
- [ ] Tidak ada `accounting_entries` yang dibuat oleh modul ini
- [ ] /finance/bank-allocation accessible dari sidebar Finance
- [ ] Company isolation: user hanya lihat data company sendiri
- [ ] Reject wajib alasan: tanpa alasan → 400
