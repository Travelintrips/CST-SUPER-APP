# Auto-Matching Design — Sprint 4 Phase 2

## Desain Sistem

### Filosofi

> "AI memberi skor, manusia memutuskan."

Tidak ada posting otomatis, tidak ada jurnal tanpa approval manusia. Engine ini adalah **decision support tool**, bukan automation tool.

### Komponen

| Komponen | File | Tanggung Jawab |
|----------|------|----------------|
| Migration | `lib/bankAllocationMigration.ts` | Create/idempotent schema tables |
| Scoring Engine | `lib/reconciliation/bankAllocationScoring.ts` | Pure deterministic scoring, no DB write |
| Route Handler | `routes/bankAllocationMatching.ts` | REST API, auth guard, DB orchestration |
| Frontend | `pages/finance/bank-allocation.tsx` | Tab UI, action workflow |

### Candidate Sources

1. **Sales Documents (invoice)**: `sales_documents` WHERE `doc_type = 'invoice'` AND status NOT IN ('paid','cancelled','void') AND date dalam window ±30 hari.
2. **Cash Advances (advance)**: `cash_advances` WHERE lifecycle_status IN ('outstanding','partially_settled','disbursed','approved') AND date dalam window ±30 hari.

Sumber tambahan (future): purchase invoices, debit notes, deposit customer.

### Matching Pipeline

```
1. Fetch mutations: bank_mutations WHERE status='unmatched' (max 200 per run)
2. Per mutation:
   a. getActiveWeights(company_id)  — DB lookup atau fallback DEFAULT_WEIGHTS
   b. fetchAllocationCandidates()   — query 2 sumber dengan date window
   c. scoreAllocationCandidate()    — pure function, returns score + breakdown
   d. classifyAllocationMatch()     — auto_suggest | manual_review | unmatched
   e. Upsert bank_allocation_matches ON CONFLICT (mutation, candidate)
   f. Detect overpayment/underpayment → insert exceptions
   g. Update bank_mutations.status = 'matched'
   h. Write audit log entry
```

### Exception Types

| Type | Trigger | Saran |
|------|---------|-------|
| NO_CANDIDATE | Tidak ada kandidat ditemukan | Manual match atau write-off |
| OVERPAYMENT | `mutation.amount > best.candidate.amount` | Customer Deposit line |
| UNDERPAYMENT | `mutation.amount < best.candidate.amount` | Outstanding tetap terbuka |

### Duplicate Prevention

Unique index `(bank_mutation_id, candidate_type, candidate_id)` pada `bank_allocation_matches` memastikan setiap pasangan (mutasi, kandidat) hanya punya satu row — scoring ulang melakukan UPDATE bukan INSERT.

### Immutability Guarantee

`bank_allocation_match_logs` adalah append-only. Setiap state transition (SELECT, CONFIRM, REJECT) selalu menulis log baru, tidak pernah memodifikasi log lama.
