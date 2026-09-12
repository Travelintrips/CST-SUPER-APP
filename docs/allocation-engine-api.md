# Allocation Engine — API Reference

Base path: `/api/allocation`

Auth: semua endpoint memerlukan `requireAdmin` (session cookie BizPortal).

---

## GET /api/allocation/dashboard-stats

Stats ringkasan untuk dashboard.

**Response:**
```json
{
  "outstanding_amount": 15000000,
  "pending_count": 3,
  "pending_amount": 5000000,
  "customer_deposit": 2500000,
  "recovered_today": 1000000,
  "avg_recovery_days": 2.5
}
```

---

## GET /api/allocation

List allocation headers dengan filter dan pagination.

**Query params:**
| Param       | Type    | Default | Deskripsi                      |
|-------------|---------|---------|-------------------------------|
| `companyId` | number  |         | Filter per company             |
| `status`    | string  | all     | draft/submitted/approved/...   |
| `search`    | string  |         | Cari allocation_no / ref_no    |
| `page`      | number  | 1       |                                |
| `limit`     | number  | 50      |                                |

**Response:**
```json
{
  "data": [ { "id": 1, "allocation_no": "ALLOC-202507-0001", ... } ],
  "total": 12,
  "page": 1,
  "limit": 50
}
```

---

## POST /api/allocation

Buat allocation header + lines.

**Body:**
```json
{
  "company_id": 1,
  "bank_account_id": 5,
  "received_amount": 5000000,
  "reference_no": "TF-2025-001",
  "allocation_date": "2025-07-06",
  "notes": "Penerimaan dari PT ABC",
  "lines": [
    {
      "allocation_type": "ADVANCE_PRINCIPAL",
      "coa_id": 120,
      "amount": 3000000,
      "remarks": "Advance ADV-2025-001"
    },
    {
      "allocation_type": "DIRECT_REVENUE",
      "coa_id": 410,
      "amount": 2000000,
      "remarks": "Service fee"
    }
  ]
}
```

**Validasi:**
- `received_amount > 0` wajib
- `Σ lines.amount` harus = `received_amount` (toleransi < 0.01)

**Response 201:**
```json
{ "id": 1, "allocation_no": "ALLOC-202507-0001", "status": "draft" }
```

---

## GET /api/allocation/:id

Detail allocation dengan lines dan audit trail.

**Response:** Full header + `lines[]` + `audit_logs[]`

---

## PATCH /api/allocation/:id

Update allocation (hanya status `draft`). Jika `lines` disertakan, semua baris lama dihapus dan diganti.

---

## POST /api/allocation/:id/submit

`draft` → `submitted`. Validasi balance dijalankan ulang.

---

## POST /api/allocation/:id/approve

`submitted` → `approved`.

**Body (opsional):** `{ "notes": "LGTM" }`

---

## POST /api/allocation/:id/reject

`submitted`/`approved` → `draft`.

**Body (opsional):** `{ "notes": "Revisi dulu" }`

---

## POST /api/allocation/:id/post

`approved` → `posted`. Membuat accounting entry via `AdvanceJournalService.postAllocationEngineJournal`.

**Prasyarat:**
- `bank_account_id` harus terisi
- `journal_entry_id` harus null (anti double-post)

**Response:**
```json
{ "ok": true, "status": "posted", "journal_entry_id": 9901 }
```

---

## POST /api/allocation/:id/reverse

`posted` → `reversed`. Membuat counter-journal via `createReversalJournal`.

**Body:**
```json
{ "reason": "Kesalahan posting" }
```

**Response:**
```json
{ "ok": true, "status": "reversed", "reversal_entry_id": 9902 }
```
