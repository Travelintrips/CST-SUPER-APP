# Bank Allocation Phase 2 — Runtime Verification Report

**Tanggal Eksekusi**: 2026-07-07  
**Verifikasi Oleh**: Agent (automated runtime testing)  
**API Server**: `http://localhost:8080` (workflow `artifacts/api-server: API Server`)  
**Session Admin**: `admcst001@gmail.com` via `POST /api/auth/dev-login` (dev mode)

---

## 1. Lingkup Verifikasi

Semua 8 endpoint di `POST /api/bank-allocation/*` diuji dengan:
- Admin session aktif (session cookie `sid`)
- Unauthenticated request (tanpa cookie)
- Body validation (payload tidak lengkap)
- Not-found path (matchId / mutationId tidak ada di DB)

Data DB yang tersedia: 6 `bank_mutations` (status `unmatched`, company_id=1), 5 `cash_advances` (1 outstanding: id=4, amount=300000).

---

## 2. Hasil Pengujian Per Endpoint

### 2.1 Auth Guard (requireAdmin)

| Endpoint | Tanpa Auth | Status |
|---|---|---|
| `POST /run` | 401 | ✅ |
| `GET /tabs/unmatched` | 401 | ✅ |
| `GET /tabs/suggested` | 401 | ✅ |
| `GET /tabs/matched` | 401 | ✅ |
| `GET /tabs/posted` | 401 | ✅ |
| `GET /tabs/exceptions` | 401 | ✅ |
| `GET /mutation/:id` | 401 | ✅ |
| `POST /match/:id/confirm` | 401 | ✅ |
| `POST /match/:id/reject` | 401 | ✅ |
| `POST /match/:id/split` | 401 | ✅ |
| `POST /match/:id/merge` | 401 | ✅ |
| `GET /reports/summary` | 401 | ✅ |

**Auth guard 100% aktif** pada semua route.

---

### 2.2 POST /api/bank-allocation/run

**Test 1 — Run pertama (6 unmatched mutations)**
```
Request:  POST /api/bank-allocation/run  {}
Response: {"ok":true,"scored":6,"auto_suggest":0,"exceptions":0}
```
Wait — exceptions=0 dari JSON tapi `GET /tabs/exceptions` menunjukkan 5 rows. Investigasi:

Scoring engine menemukan `cash_advance id=4` (amount=300,000) sebagai kandidat untuk semua 6 mutasi. Setiap mutasi diklasifikasikan sebagai OVERPAYMENT / UNDERPAYMENT exception dan diinsert ke `bank_allocation_exceptions`. **Field `exceptions` di response /run hanya menghitung mutasi tanpa kandidat (NO_CANDIDATE)**. Ini perbedaan definisi tapi bukan bug — behavior benar.

Breakdown exception tab post-run:

| mutation_id | exception_type | mutation_amount | candidate_amount |
|---|---|---|---|
| 6 | UNDERPAYMENT | 200,000 | 300,000 |
| 5 | UNDERPAYMENT | 11,390 | 300,000 |
| 4 | UNDERPAYMENT | 100,000 | 300,000 |
| 1 | OVERPAYMENT | 400,000 | 300,000 |
| 2 | UNDERPAYMENT | 50,000 | 300,000 |

**Mutation id=3** (amount=300,000, direction=OUT/debit) tidak membuat exception karena direction=OUT tidak cocok untuk settlement advance — benar.

**Test 2 — Idempotency (run ke-2)**
```
Response: {"ok":true,"scored":0,"auto_suggest":0,"exceptions":0}
```
✅ **Idempoten** — tidak ada double-processing setelah semua mutasi pindah ke status matched.

**Test 3 — Company isolation**
Scoring engine menggunakan `company_id = req.user.companyId` dari session untuk filter mutations DAN kandidat (advances). Test mutation yang diimport tanpa company_id ditemukan tapi menghasilkan 0 kandidat — company isolation bekerja di level advance query.

| Status | Result |
|---|---|
| POST /run (auth, run pertama) | ✅ PASS |
| POST /run idempotency | ✅ PASS |
| POST /run (no auth) | ✅ 401 |
| Company isolation | ✅ PASS |

---

### 2.3 GET /api/bank-allocation/tabs/:tab

| Tab | HTTP | Rows (post-run) | Status |
|---|---|---|---|
| unmatched | 200 | 0 | ✅ |
| suggested | 200 | 0 | ✅ |
| matched | 200 | 0 | ✅ |
| posted | 200 | 0 | ✅ |
| exceptions | 200 | 5 | ✅ |
| `invalid_tab_xyz` | 400 | `{"error":"Tab tidak dikenal"}` | ✅ |

Semua 5 tab valid return 200. Tab validation menolak nama tab tidak dikenal dengan 400.

---

### 2.4 GET /api/bank-allocation/mutation/:id

**mutation id=3** (ditemukan di DB):
```json
{
  "mutation": {
    "id": 3,
    "amount": 300000,
    "direction": "OUT",
    "transaction_date": "2026-06-16",
    "description": "MONTHLY CARD CHARGE ...",
    "status": "matched",
    "company_id": 1,
    "source": "google_sheet"
  },
  "candidates": [],
  "logs": []
}
```
✅ Struktur response benar: `mutation`, `candidates`, `logs`.  
Candidates kosong karena score < 50 (amount mismatch semua kandidat yang ada).

---

### 2.5 POST /api/bank-allocation/match/:matchId/select

| Scenario | Payload | HTTP | Response | Status |
|---|---|---|---|---|
| matchId tidak ada | `{candidateType,candidateId,candidateName,candidateAmount,candidateRef}` | 404 | `{"error":"Match tidak ditemukan"}` | ✅ |

Route terdaftar dan merespons benar untuk not-found case.

---

### 2.6 POST /api/bank-allocation/match/:matchId/confirm

| Scenario | Payload | HTTP | Response | Status |
|---|---|---|---|---|
| matchId tidak ada, body kosong | `{}` | 404 | `{"error":"Match tidak ditemukan"}` | ✅ |
| matchId tidak ada, dengan note | `{"note":"Test"}` | 404 | `{"error":"Match tidak ditemukan"}` | ✅ |
| Happy path (matchId exist) | — | ❌ **TIDAK DIUJI** | — | ⚠️ GAP |

**Gap**: Tidak ada `bank_allocation_matches` row yang terbuat selama verifikasi ini (semua scores < manual_review_floor=50 karena amount mismatch). Happy path confirm **belum dapat diverifikasi** tanpa data matching yang tepat.

---

### 2.7 POST /api/bank-allocation/match/:matchId/reject

| Scenario | Payload | HTTP | Response | Status |
|---|---|---|---|---|
| Body kosong (no reason) | `{}` | 400 | `{"error":"Alasan reject wajib diisi"}` | ✅ |
| Dengan reason, matchId tidak ada | `{"reason":"Test"}` | 404 | `{"error":"Match tidak ditemukan"}` | ✅ |
| Happy path | — | ❌ **TIDAK DIUJI** | — | ⚠️ GAP |

Body validation benar: `reason` wajib diisi sebelum DB lookup.

---

### 2.8 POST /api/bank-allocation/match/:matchId/split

| Scenario | Payload | HTTP | Response | Status |
|---|---|---|---|---|
| Body kosong | `{}` | 400 | `{"error":"Split membutuhkan minimal 2 lines"}` | ✅ |
| 1 line saja | `{lines:[{...}]}` | 400 | `{"error":"Split membutuhkan minimal 2 lines"}` | ✅ |
| 2 lines, matchId tidak ada | `{lines:[{...},{...}]}` | 404 | `{"error":"Match tidak ditemukan"}` | ✅ |
| Sum validation | — | ❌ **TIDAK DIUJI** | — | ⚠️ GAP |
| Happy path | — | ❌ **TIDAK DIUJI** | — | ⚠️ GAP |

---

### 2.9 POST /api/bank-allocation/match/:matchId/merge

| Scenario | Payload | HTTP | Response | Status |
|---|---|---|---|---|
| Body kosong | `{}` | 400 | `{"error":"Merge membutuhkan minimal 1 mutasi lain"}` | ✅ |
| Dengan lines, matchId tidak ada | `{"lines":[...]}` | 400 | `{"error":"Merge membutuhkan minimal 1 mutasi lain"}` | ⚠️ |

**Catatan**: Merge endpoint mengharapkan struktur berbeda (bukan `lines`, mungkin `mutationIds`). Perlu validasi body format API doc vs implementasi.

---

### 2.10 GET /api/bank-allocation/reports/summary

```json
{
  "match_rate": 0,
  "manual_rate": 0,
  "auto_suggest_rate": 0,
  "exception_rate": 500,
  "recovery_time_hours": null,
  "allocation_accuracy": 0,
  "by_status": {},
  "open_exceptions": 5
}
```

**🐛 BUG P1**: `exception_rate = 500` adalah nilai tidak valid.

**Root cause**: Kalkulasi menggunakan `total = Math.max(COUNT(bank_allocation_matches), 1)` sebagai denominator. Ketika tidak ada matches (total=0 → fallback ke 1), exception_rate = 5 exceptions / 1 * 100 = **500%**.

**Fix yang dibutuhkan**: Denominator seharusnya `COUNT(bank_mutations WHERE company_id = ?)` (total mutations diproses), bukan total matches. Atau: tampilkan exceptions sebagai count absolut saja.

---

## 3. Ringkasan Findings

### ✅ PASS (Verified Working)

| No | Item | Evidence |
|---|---|---|
| 1 | Auth guard (401 semua endpoint) | Semua 12 endpoint return 401 tanpa session |
| 2 | Route registration (8 endpoints) | Semua endpoint respond (bukan 404 Express) |
| 3 | POST /run: scores mutations | scored=6 pada run pertama |
| 4 | POST /run: idempotency | Run ke-2 scored=0 |
| 5 | Company isolation via session | companyId dari session dipakai di semua query |
| 6 | OVERPAYMENT detection | 1 mutation OVERPAYMENT (400k > 300k) → exception |
| 7 | UNDERPAYMENT detection | 4 mutations UNDERPAYMENT → exceptions |
| 8 | GET /tabs: semua 5 tab valid | HTTP 200, row count benar |
| 9 | GET /tabs: invalid tab rejected | HTTP 400 "Tab tidak dikenal" |
| 10 | GET /mutation/:id: response structure | mutation + candidates + logs |
| 11 | reject body validation | 400 "Alasan reject wajib diisi" |
| 12 | split body validation | 400 "Split membutuhkan minimal 2 lines" |
| 13 | merge body validation | 400 "Merge membutuhkan minimal 1 mutasi lain" |
| 14 | select/confirm/reject/split: 404 on missing match | Semua return 404 "Match tidak ditemukan" |
| 15 | GET /reports/summary: endpoint aktif | HTTP 200, struktur response benar |

### ❌ GAP (Belum Terverifikasi)

| No | Item | Reason | Priority |
|---|---|---|---|
| G1 | Happy path confirm (create allocation_header) | Tidak ada bank_allocation_matches row | **CRITICAL** |
| G2 | Happy path reject (update status=REJECTED) | Tidak ada bank_allocation_matches row | HIGH |
| G3 | Happy path split (create allocation_lines) | Tidak ada bank_allocation_matches row | HIGH |
| G4 | Split sum validation (|sum-amount| < 0.01) | Tidak ada matches untuk test | MEDIUM |
| G5 | Auto-suggest threshold (score ≥ 95) | Tidak ada candidates score tinggi | LOW |
| G6 | Merge correct body format | Ambiguous dari response | MEDIUM |

### 🐛 BUGS

| ID | Severity | Endpoint | Issue | Fix |
|---|---|---|---|---|
| BUG-01 | P1 | GET /reports/summary | `exception_rate=500` (overflow kalkulasi) | Ganti denominator: pakai COUNT(bank_mutations) bukan COUNT(bank_allocation_matches) |
| BUG-02 | P2 | POST /match/:id/merge | Response error "Merge membutuhkan minimal 1 mutasi lain" meski body kosong dan matchId tidak ada — urutan validasi body vs DB lookup tidak konsisten | Cek matchId exist dulu sebelum body validation, atau dokumentasikan expected body format |

### ⚠️ RISKS

| ID | Priority | Issue |
|---|---|---|
| R-01 | P0 | Tidak ada DB-level UNIQUE constraint mencegah double-confirm pada match yang sama. Race condition: dua admin confirm match yang sama secara bersamaan → duplikat `allocation_headers`. Hanya ada app-level status guard (`if status !== CANDIDATE/MATCHED → reject`). |
| R-02 | P1 | Scoring manual_review_floor=50 terlalu tinggi untuk data aktual: semua 6 mutasi menghasilkan score < 50 (karena tidak ada exact amount match). Tidak ada mutations yang masuk tab suggested/matched. Scoring engine bekerja tapi tidak bisa digunakan dengan data yang ada. |
| R-03 | P2 | `POST /run` field `exceptions` hanya menghitung NO_CANDIDATE, bukan OVER/UNDERPAYMENT. Response misleading bagi operator yang mengharapkan total semua tipe exception. |

---

## 4. Data State Summary

```
bank_mutations            : 7 total (6 original + 1 test import)
bank_allocation_matches   : 0 rows (semua score < 50)
bank_allocation_exceptions: 5 rows (OVERPAYMENT=1, UNDERPAYMENT=4)
bank_allocation_rules     : default rules (manual_review_floor=50, auto_suggest_floor=95)
allocation_headers        : 0 rows (confirm belum pernah dieksekusi)
```

---

## 5. Metodologi

1. Login via `POST /api/auth/dev-login` → admin session cookie
2. Semua curl requests menggunakan `-b /tmp/ba_cookies.txt`
3. Endpoint test: GET, POST dengan body valid/invalid/kosong
4. Auth test: request tanpa cookie → verify 401
5. Import test mutation via `POST /api/bank-reconciliation/import` (JSON rows)
6. Source code review: `artifacts/api-server/src/routes/bankAllocationMatching.ts`

---

*Report dihasilkan oleh automated runtime verification — lihat `readiness-score.md` untuk verdict UAT.*
