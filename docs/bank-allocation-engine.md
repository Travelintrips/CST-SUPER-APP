# Bank Allocation Engine — Sprint 4 Phase 2

## Ikhtisar

Bank Allocation Engine adalah modul deterministic auto-matching yang mencocokkan mutasi bank (`bank_mutations`) ke kandidat alokasi (invoice `sales_documents` atau advance `cash_advances`) berdasarkan scoring terbobot. Engine **hanya menghasilkan rekomendasi** — tidak pernah memposting jurnal secara otomatis.

## Prinsip Utama (Immutable)

| Aturan | Status |
|--------|--------|
| AI hanya merekomendasikan, tidak auto-post | ✅ Enforced |
| Auto-suggest (skor ≥ 95) masuk tab Suggested — tetap butuh konfirmasi | ✅ Enforced |
| Konfirmasi menciptakan `allocation_headers` berstatus `draft` | ✅ Enforced |
| Posting jurnal sesungguhnya hanya dari Allocation Center (submit→approve→post) | ✅ Enforced |
| Company isolation via `company_id` di semua query | ✅ Enforced |

## Arsitektur

```
bank_mutations
    │
    ▼
fetchAllocationCandidates()          ← sales_documents + cash_advances
    │
    ▼
scoreAllocationCandidate()           ← deterministic weighted scoring
    │
    ▼
bank_allocation_matches              ← CANDIDATE rows, is_auto_suggested flag
    │
    ├── Tab: Suggested (score ≥ 95)
    ├── Tab: Manual Review (50–94)
    └── Tab: Exceptions (no candidate / over/underpayment)
    │
    ▼ Finance memilih (select) dan mengkonfirmasi (confirm)
    │
    ▼
allocation_headers (draft)           ← dibuat oleh /match/:id/confirm
allocation_lines (draft)
    │
    ▼ Finance submit → approve → post (existing Allocation Center flow)
    │
    ▼
accounting_entries                   ← HANYA dari AdvanceJournalService
```

## Scoring Weights (Default)

| Dimensi | Bobot | Logika |
|---------|-------|--------|
| Amount | 40 | Exact match (toleransi ±0.01) |
| Reference | 25 | Exact match `provider_order_id` vs `candidate_ref` |
| Invoice | 15 | Hanya untuk tipe invoice, exact doc number match |
| Customer | 10 | Fuzzy token overlap ≥ 40% (sama dengan unifiedMatchingEngine) |
| Date | 5 | Same day atau ±1 hari |
| Company | 5 | `company_id` exact match |
| **Total** | **100** | |

Threshold: `auto_suggest_threshold = 95`, `manual_review_floor = 50`

## Tabel Database

```
bank_allocation_matches       — scored candidate pairs per mutation
bank_allocation_match_logs    — immutable audit trail setiap action
bank_allocation_rules         — configurable weights per company
bank_allocation_exceptions    — NO_CANDIDATE / OVERPAYMENT / UNDERPAYMENT
```

## Flow Status

```
UNMATCHED (bank_mutations)
  → CANDIDATE (bank_allocation_matches, setelah scoring)
  → MATCHED   (setelah finance pilih / select)
  → CONFIRMED (setelah finance confirm — allocation_headers/lines dibuat)
  → POSTED    (diturunkan dari allocation_headers.status = 'posted')
```

## Company Isolation

Semua endpoint menggunakan `req.user.companyId` untuk mem-filter query. Route dilindungi `requireAdmin` + `financeAuditMiddleware` + `makeRbacGuard("invoice")`.

## Split & Merge

- **Split** (satu mutasi → banyak lines): tersedia via `POST /api/bank-allocation/match/:id/split`
- **Merge** (banyak mutasi → satu allocation): foundation dicatat sebagai next phase (Phase 3)
