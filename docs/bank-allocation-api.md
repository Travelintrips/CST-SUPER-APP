# Bank Allocation API Reference

Base path: `/api/bank-allocation`

Auth: semua endpoint memerlukan session + `requireAdmin` + `financeAuditMiddleware` + RBAC `invoice`.

---

## POST /run

Jalankan matching engine untuk semua mutasi `unmatched` (atau satu mutasi jika `bank_mutation_id` disertakan).

**Request Body:**
```json
{
  "bank_mutation_id": 42   // opsional — jika kosong, proses semua unmatched (max 200)
}
```

**Response:**
```json
{
  "ok": true,
  "scored": 15,
  "auto_suggest": 3,
  "exceptions": 2
}
```

**Side effects:**
- Upsert `bank_allocation_matches` (CANDIDATE rows)
- Insert `bank_allocation_exceptions` (NO_CANDIDATE/OVERPAYMENT/UNDERPAYMENT)
- Update `bank_mutations.status = 'matched'`
- Write audit log

**TIDAK pernah:**
- Membuat `accounting_entries`
- Memanggil `AdvanceJournalService`
- Auto-approve alokasi

---

## GET /tabs/:tab

Ambil data untuk tab tertentu.

**Tab values:** `unmatched` | `suggested` | `matched` | `posted` | `exceptions`

**Response:**
```json
{
  "tab": "suggested",
  "rows": [ ... ]
}
```

**Company isolation:** hanya mengembalikan data `company_id` yang sesuai dengan user session.

---

## GET /mutation/:id

Detail lengkap satu mutasi: mutation info, semua kandidat yang sudah di-score, audit log.

**Response:**
```json
{
  "mutation": { "id": 42, "amount": 5000000, "description": "...", "transaction_date": "2024-01-15" },
  "candidates": [
    {
      "id": 101, "candidate_type": "invoice", "candidate_ref": "INV-2024-001",
      "match_score": 95, "is_auto_suggested": true, "status": "CANDIDATE",
      "score_breakdown": {
        "amount": { "matched": true, "points": 40, "max": 40 },
        "reference": { "matched": true, "points": 25, "max": 25 }
      }
    }
  ],
  "logs": [
    { "id": 1, "action": "MATCH_GENERATED", "actor": "system", "from_status": "UNMATCHED", "to_status": "CANDIDATE" }
  ]
}
```

---

## POST /match/:matchId/select

Finance memilih kandidat (CANDIDATE → MATCHED).

**Request Body:** `{}`

**Response:**
```json
{ "ok": true, "status": "MATCHED" }
```

---

## POST /match/:matchId/confirm

Finance mengkonfirmasi match → membuat `allocation_headers` + `allocation_lines` berstatus **draft**.

**Request Body:**
```json
{
  "coa_id": 1001,           // opsional — COA untuk jurnal (diisi saat posting di Allocation Center)
  "bank_account_id": 5      // opsional — override bank account
}
```

**Response:**
```json
{
  "ok": true,
  "status": "CONFIRMED",
  "allocation_header_id": 88,
  "allocation_no": "BAM-202401-0001"
}
```

**PENTING:** Allocation header berstatus `draft`. Tidak ada jurnal yang dibuat di sini. Finance harus ke Allocation Center → Submit → Approve → Post untuk memposting jurnal.

---

## POST /match/:matchId/reject

Reject kandidat dengan alasan wajib.

**Request Body:**
```json
{ "reason": "Bukan pembayaran ini — amount sama tapi reference berbeda" }
```

**Response:**
```json
{ "ok": true, "status": "REJECTED" }
```

---

## POST /match/:matchId/split

Satu mutasi dialokasikan ke banyak lines (misalnya: sebagian invoice, sebagian advance).

**Request Body:**
```json
{
  "bank_account_id": 5,
  "lines": [
    { "allocation_type": "SALES_INVOICE", "reference_type": "invoice", "reference_id": 55, "amount": 3000000, "remarks": "Invoice INV-001" },
    { "allocation_type": "CUSTOMER_DEPOSIT", "coa_id": 2010, "amount": 2000000, "remarks": "Sisa deposit" }
  ]
}
```

**Validasi:** Total `lines[].amount` harus = `mutation.amount` (toleransi Rp 0.01).

---

## GET /reports/summary

Summary statistik matching untuk dashboard header.

**Response:**
```json
{
  "match_rate": 78.5,
  "manual_rate": 15.2,
  "auto_suggest_rate": 63.3,
  "exception_rate": 6.3,
  "recovery_time_hours": 4.2,
  "allocation_accuracy": 94.1,
  "open_exceptions": 12
}
```

---

## Error Codes

| HTTP | Kondisi |
|------|---------|
| 400 | Status tidak valid untuk operasi yang diminta |
| 400 | Total split ≠ nominal mutasi |
| 400 | Reject tanpa alasan |
| 404 | Mutation / match tidak ditemukan |
| 401 | Tidak terautentikasi |
| 403 | Role tidak mencukupi |
| 500 | Database error |
