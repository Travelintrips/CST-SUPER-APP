# Allocation Engine Phase 1 — Runtime Verification

**Tanggal:** 2026-07-06  
**Environment:** Development (Supabase DEV — `xssrfshdrtdfupgqwfdw`)  
**Base URL:** `http://localhost:5000/api`  
**Auth:** dev-login sebagai `admcst001@gmail.com` (role: admin)  
**Smoke test run ID:** `SMOKE1783357814`

---

## Hasil Smoke Test — 18/18 PASS

### Auth
| Test | Method | Status | Result |
|---|---|---|---|
| Dev login | `POST /auth/dev-login` | 200 | ✅ role=admin, session cookie set |

### Read Endpoints
| Test | Method | Status | Result |
|---|---|---|---|
| Dashboard stats | `GET /allocation/dashboard-stats` | 200 | ✅ 6 field: outstanding_amount, pending_count, pending_amount, customer_deposit, recovered_today, avg_recovery_days |
| List allocation | `GET /allocation?limit=5` | 200 | ✅ `total`, `data`, `page`, `limit` fields |
| Get detail | `GET /allocation/1` | 200 | ✅ header + 2 lines + audit_logs array |
| Not found guard | `GET /allocation/99999999` | 404 | ✅ company isolation + 404 |

### Write — Lifecycle Flow
| Test | Method | Status | Result |
|---|---|---|---|
| Create (balanced) | `POST /allocation` | 201 | ✅ `id=1`, `allocation_no=ALLOC-202607-0001`, `status=draft` |
| Update notes | `PATCH /allocation/1` | 200 | ✅ partial update |
| Update lines (no received_amount) | `PATCH /allocation/1` | 200 | ✅ fetches existing received_amount dari DB untuk validasi balance |
| Submit | `POST /allocation/1/submit` | 200 | ✅ `status=submitted` |
| Approve | `POST /allocation/1/approve` | 200 | ✅ `status=approved` |
| Post journal | `POST /allocation/1/post` | 200 | ✅ `status=posted`, `journal_entry_id=16` |
| Reverse | `POST /allocation/1/reverse` | 200 | ✅ `status=reversed`, `reversal_entry_id=17` |

### Guard/Error Cases
| Test | Expected | Actual | Result |
|---|---|---|---|
| Double-post guard | 400 | 400 | ✅ `"Journal sudah pernah dibuat"` |
| Balance mismatch | 400 | 400 | ✅ `"Total alokasi tidak sama dengan received amount"` |
| No auth (no cookie) | 401 | 401 | ✅ `"Unauthorized"` |
| Not found (ID 99999999) | 404 | 404 | ✅ filtered by company_id |

---

## Journal Balance Verification

### Original Journal (entry_id=16)

```sql
SELECT SUM(debit), SUM(credit),
       CASE WHEN SUM(debit)=SUM(credit) THEN 'BALANCED' ELSE 'UNBALANCED' END
FROM accounting_entry_lines WHERE entry_id=16;
```

| total_debit | total_credit | status |
|---|---|---|
| 5,000,000.00 | 5,000,000.00 | **BALANCED** |

**Lines:**
- DR Bank (COA 1303) 5,000,000 ← Bank Receipt ALLOC-202607-0001
- CR Piutang (COA 21) 3,000,000 ← ADVANCE_PRINCIPAL
- CR Revenue (COA 1303→19) 2,000,000 ← DIRECT_REVENUE

### Reversal Journal (entry_id=17)

| total_debit | total_credit | status |
|---|---|---|
| 5,000,000.00 | 5,000,000.00 | **BALANCED** |

---

## sourceModule Persistence

```sql
SELECT source, source_module FROM accounting_entries WHERE id=16;
```

| source | source_module |
|---|---|
| `manual` | `allocation_engine` |

**✅ sourceModule tersimpan ke DB** — fix Bug 6 verified.

---

## No-Hang Verification

Semua request selesai dalam <2 detik. Tidak ada request yang hang setelah auth. Ini membuktikan:
- Bug 1 (requireAdmin wrapper tidak memanggil next()) sudah fixed
- Gateway proxy tidak timeout

---

## Allocation Header State Machine — Verified Transitions

```
draft → submitted → approved → posted → reversed
  ↑                                         
  └──── (rejected dari submitted/approved)
```

Semua transisi diverifikasi via API + audit log di DB:

```sql
SELECT action, from_status, to_status, created_at
FROM allocation_audit_logs WHERE allocation_header_id=1
ORDER BY id;
```

| action | from_status | to_status |
|---|---|---|
| create | NULL | draft |
| edit | draft | draft |
| edit | draft | draft |
| submit | draft | submitted |
| approve | submitted | approved |
| post | approved | posted |
| reverse | posted | reversed |

---

## Tidak Ada Request Hang

Semua 18 test selesai dalam <15 detik total. Tidak ada timeout. Tidak ada zombie process.

---

## DB State Setelah Smoke Test

```sql
SELECT id, allocation_no, status, received_amount, journal_entry_id
FROM allocation_headers WHERE id=1;
```

| id | allocation_no | status | received_amount | journal_entry_id |
|---|---|---|---|---|
| 1 | ALLOC-202607-0001 | reversed | 5,000,000.00 | 16 |
