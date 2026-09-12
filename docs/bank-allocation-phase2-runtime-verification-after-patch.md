# Bank Allocation Phase 2 — Runtime Verification After Security Patch

**Date:** 2026-07-07  
**Tester:** AI Agent (admcst001@gmail.com — admin, no bound company → super-admin)  
**Cross-company tester:** admin@demo.ws.id (separate company)  
**API Base:** http://localhost:8080  
**Patch ref:** bank-allocation-phase2-security-patch.md  

---

## Ringkasan Hasil

| # | Test ID | Skenario | Status |
|---|---------|----------|--------|
| 1 | T-P0a | Sequential duplicate confirm → ditolak kedua | ✅ PASS |
| 2 | T-P0b | Concurrent 3× confirm → 1 menang, 2 ditolak, DB: 1 header | ✅ PASS |
| 3 | T-P0b-SQL-1 | Injection string `"1; DROP TABLE…"` di `other_mutation_ids` | ✅ PASS |
| 4 | T-P0b-SQL-2 | Float `3.14` di `other_mutation_ids` | ✅ PASS |
| 5 | T-P0b-SQL-3 | Negatif `-5` di `other_mutation_ids` | ✅ PASS |
| 6 | T-P0c-select | Cross-company select → 403 | ✅ PASS |
| 7 | T-P0c-confirm | Cross-company confirm → 403 | ✅ PASS |
| 8 | T-P0c-split-valid | Cross-company split (body valid 2 lines) → 403 bukan 400 | ✅ PASS |
| 9 | T-P0c-split-invalid | Cross-company split (body invalid 1 line) → 403 bukan validation error | ✅ PASS |
| 10 | T-P0c-merge | Cross-company merge → 403 | ✅ PASS |
| 11 | T-P0c-reject | Cross-company reject → 403 | ✅ PASS |
| 12 | T-IDOR | GET /mutation/:id cross-company read → 403 | ✅ PASS |
| 13 | T-P1b-neg | Split dengan line amount negatif → 400 | ✅ PASS |
| 14 | T-P1b-zero | Split dengan line amount nol → 400 | ✅ PASS |
| 15 | T-P1-vis | CONFIRMED+draft muncul di matched tab (bukan hilang) | ✅ PASS |
| 16 | T-P2 | Company2 `/run` → scored=0, exceptions=1 (company1 muts tersembunyi) | ✅ PASS |

**16/16 PASS. Tidak ada failures.**

---

## Detail Setiap Test

### T-P0a — Sequential Duplicate Confirm

```
POST /match/20/confirm   → {"ok":true,"status":"CONFIRMED","allocation_header_id":20,"allocation_no":"BAM-202607-0003"}
POST /match/20/confirm   → {"error":"Match sudah diproses sebelumnya"}   HTTP 400  ✅
```

Status check berada dalam `db.transaction()` setelah `SELECT … FOR UPDATE`. ✅

---

### T-P0b — Concurrent 3× Confirm

```
3× simultaneous POST /match/22/confirm

R1: {"error":"Match sudah diproses sebelumnya"}
R2: {"ok":true,"status":"CONFIRMED","allocation_header_id":21,"allocation_no":"BAM-202607-0004"}
R3: {"error":"Match sudah diproses sebelumnya"}

Winners: 1  ✅
```

DB: satu baris CONFIRMED untuk mut_id=16, satu allocation_header. Partial unique index
`idx_bam_one_confirmed_per_mutation` + `FOR UPDATE` mencegah duplikat. ✅

---

### T-P0b-SQL — SQL Injection di Merge Handler

```
other_mutation_ids: ["1; DROP TABLE bank_mutations; --"]
→ {"error":"other_mutation_ids berisi nilai tidak valid: \"1; DROP TABLE bank_mutations; --\""}  ✅

other_mutation_ids: [3.14]
→ {"error":"other_mutation_ids berisi nilai tidak valid: 3.14"}  ✅

other_mutation_ids: [-5]
→ {"error":"other_mutation_ids berisi nilai tidak valid: -5"}  ✅
```

Validasi dua lapis: (1) `isPlainNumber || isPureDigitString` menolak non-integer strings,
(2) parameterized `sql.join` — tidak ada `sql.raw` pada input user. ✅

---

### T-P0c — Cross-Company Access Control (7 endpoint)

**Tester:** admin@demo.ws.id (company berbeda dari owner match)

```
POST /match/20/select                     → {"error":"Akses ditolak"}  403  ✅
POST /match/20/confirm                    → {"error":"Akses ditolak"}  403  ✅
POST /match/21/split  (2 lines, valid)    → {"error":"Akses ditolak"}  403  ✅
POST /match/21/split  (1 line, invalid)   → {"error":"Akses ditolak"}  403  ✅  ← ownership dievaluasi sebelum body validation
POST /match/20/merge                      → {"error":"Akses ditolak"}  403  ✅
POST /match/22/reject                     → {"error":"Akses ditolak"}  403  ✅
GET  /mutation/14                         → {"error":"Akses ditolak"}  403  ✅  ← IDOR fix
```

Semua 7 endpoint mengembalikan 403. Ownership check terjadi **sebelum** body validation
di split, sehingga user cross-company tidak bisa mendeteksi keberadaan match via
validation error vs 403. ✅

---

### T-P1b — Per-Line Amount Validation

```
lines: [{amount:400000}, {amount:-100000}]   → {"error":"Line 2: amount harus lebih dari 0"}  ✅
lines: [{amount:300000}, {amount:0}]          → {"error":"Line 2: amount harus lebih dari 0"}  ✅
```

Validasi berjalan setelah ownership check, sebelum transaksi DB membuat baris. ✅

---

### T-P1 — CONFIRMED+Draft Visibility di Matched Tab

**Setup:** match_id=20 dan match_id=21 keduanya CONFIRMED+draft, match_id=23 masih CANDIDATE.

```
GET /api/bank-allocation/tabs/matched
→ 4 rows:
  id=23  status=CANDIDATE   alloc_status=None   (belum dikonfirmasi)
  id=22  status=CONFIRMED   alloc_status=draft  ✅
  id=20  status=CONFIRMED   alloc_status=draft  ✅
  id=21  status=CONFIRMED   alloc_status=draft  ✅

GET /api/bank-allocation/tabs/posted → rows=0  ✅ (tidak ada yang auto-post)
```

CONFIRMED+draft terlihat di matched tab. Posted tab tetap kosong. ✅

---

### T-P2 — Company Isolation di Candidate SQL

```
Login: admin@demo.ws.id (company berbeda)
POST /api/bank-allocation/run {}
→ {"ok":true,"scored":0,"auto_suggest":0,"exceptions":1}
```

Company2 admin tidak bisa score mutations company1. Semua 4 test mutations (company_id=1)
disembunyi oleh filter `WHERE company_id = ${userCompanyId}` di dua tempat:
1. `/run` endpoint — `WHERE status='unmatched' AND company_id = ${userCompanyId}`
2. `fetchAllocationCandidates` — `AND ca.company_id = ${company_id}` (advance) / `AND sd.company_id = ${company_id}` (invoice) ✅

---

## No Auto-Posting Verification

```
allocation_headers setelah semua test:
  BAM-202607-0003  status=draft  journal_entry_id=NULL  ✅
  BAM-202607-0004  status=draft  journal_entry_id=NULL  ✅
  BAM-202607-0005  status=draft  journal_entry_id=NULL  ✅
```

Tidak ada satu pun yang auto-post. Rule "AI hanya merekomendasikan, TIDAK pernah
posting otomatis" tetap berlaku. ✅

---

## Merge Regression Fix Verification

```
POST /match/21/merge {"other_mutation_ids":[16]}
→ {"ok":true,"merged_count":2,"total_amount":600000}

DB check:
  mut_id=15: match_id=13 CONFIRMED  count=1  ✅
  mut_id=16: match_id=14 CONFIRMED  count=1  ✅
```

Primary match diupdate by `WHERE id = ${matchId}`. Other mutations diupdate via
`SELECT id … ORDER BY match_score DESC LIMIT 1` — tepat satu row CONFIRMED per mutation.
Tidak ada konflik dengan partial unique index. ✅

---

## Files Changed in This Patch

| File | Perubahan |
|------|-----------|
| `artifacts/api-server/src/lib/bankAllocationMigration.ts` | +1 partial unique index `idx_bam_one_confirmed_per_mutation WHERE status='CONFIRMED'` |
| `artifacts/api-server/src/lib/reconciliation/bankAllocationScoring.ts` | Tambah `company_id` param; kedua queries (invoice + advance) filter by `company_id`; hapus semua `sql.raw()` |
| `artifacts/api-server/src/routes/bankAllocationMatching.ts` | `SELECT FOR UPDATE` inside `db.transaction()` pada confirm/split/merge; `ownershipAllowed()` helper di 5+1 endpoints; strict int validation di merge; per-line amount>0 di split; split body validation dipindah setelah ownership check; matched tab filter extended; `/run` company filter; IDOR fix di `GET /mutation/:id` |

---

## Final Verdict

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║        ✅  SAFE FOR UAT                                           ║
║                                                                  ║
║   16/16 test cases PASS                                          ║
║                                                                  ║
║   P0  Race condition duplicate confirm      — FIXED & VERIFIED   ║
║   P0b SQL injection in merge handler        — FIXED & VERIFIED   ║
║   P0c Broken access control (6 endpoints)   — FIXED & VERIFIED   ║
║   IDOR GET /mutation/:id                    — FIXED & VERIFIED   ║
║   P1b Negative/zero split amounts           — FIXED & VERIFIED   ║
║   P1  CONFIRMED+draft tab visibility        — FIXED & VERIFIED   ║
║   P2  Company isolation in candidate SQL    — FIXED & VERIFIED   ║
║   +   /run company scope                   — FIXED & VERIFIED   ║
║   +   Merge UPDATE regression              — FIXED & VERIFIED   ║
║                                                                  ║
║   Non-blocking (post-UAT): P3 audit log     — writeMatchLog      ║
║   .catch(()=>{}) → silent failure. Consider logger.warn.        ║
║                                                                  ║
║   SAFE TO PROCEED dengan Bulk Confirm dan UAT.                   ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

*Verifikasi selesai 2026-07-07. API Server running, semua endpoint tested terhadap live dev DB.*
