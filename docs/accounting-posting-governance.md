# Accounting Posting Governance — ASK (Accounting Settlement Kit)

## Ringkasan

ASK adalah layer governance yang memastikan setiap pembayaran dari modul-modul operasional (Sport Center, Tenant, Logistik) **otomatis dicatat** dalam sistem akuntansi double-entry (tabel `accounting_payments` + `accounting_entries`).

---

## Arsitektur

```
┌──────────────────────────────────────────────────────────────┐
│  Modul Operasional                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ sport_payments│  │tenant_payments│  │logistics_payments  │ │
│  │ posting_status│  │ posting_status│  │  posting_status    │ │
│  │ = unposted   │  │ = unposted   │  │  = unposted        │ │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘ │
│         └─────────────────┼───────────────────┘             │
│                           ▼                                  │
│              ingestModulePayment()                           │
│          (lib/ingestModulePayment.ts)                        │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Akuntansi Double-Entry                                       │
│  ┌─────────────────────┐   ┌──────────────────────────────┐  │
│  │  accounting_payments │   │     accounting_entries       │  │
│  │  source_type=modul  │──▶│  DR: Kas/Bank                │  │
│  │  source_doc_id=id   │   │  CR: Pendapatan              │  │
│  └─────────────────────┘   └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Tabel yang Terlibat

| Tabel | Modul | Kolom Posting |
|-------|-------|---------------|
| `sport_payments` | Sport Center | `posting_status`, `accounting_payment_id` |
| `tenant_payments` | Tenant | `posting_status`, `accounting_payment_id` |
| `logistics_payments` | Logistik | `posting_status`, `accounting_payment_id` |
| `accounting_payments` | Akuntansi | `source_type`, `source_doc_id` |
| `accounting_entries` | Akuntansi | `source`, `source_id` |
| `accounting_entry_lines` | Akuntansi | Baris debit/kredit |

---

## Nilai `posting_status`

| Nilai | Arti |
|-------|------|
| `unposted` | Pembayaran sudah ada, belum diposting ke akuntansi |
| `posted` | Sudah ada record di `accounting_payments` yang sesuai |
| `error` | Proses posting gagal (lihat log untuk detail) |

---

## Fungsi Utama

### `ingestModulePayment(input)` — `lib/ingestModulePayment.ts`

Memposting satu payment ke akuntansi. Idempoten: jika sudah ada `accounting_payment` dengan `source_type + source_doc_id` yang sama, tidak membuat duplikat.

**Parameter:**
```ts
{
  moduleType:  "sport_center" | "tenant" | "logistics"
  sourceDocId: number       // ID di tabel asal (sport_payments.id, dll)
  companyId:   number
  amount:      number
  method:      string       // "cash" | "transfer" | "bank" | ...
  partnerName: string | null
  date:        string       // ISO date "YYYY-MM-DD"
  ref:         string | null
  description: string | null
  actorId:     string | null
}
```

**Return:**
```ts
{
  ok:                   boolean
  accountingPaymentId?: number
  accountingEntryId?:   number
  alreadyPosted?:       boolean
  error?:               string
}
```

### `bulkIngestModule(moduleType, companyId)` — `lib/ingestModulePayment.ts`

Memposting semua payment yang belum diposting untuk satu modul. Digunakan oleh endpoint `POST /api/accounting/posting-monitor/bulk`.

---

## API Endpoints

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/api/accounting/posting-monitor` | List semua payment modul + status posting |
| `POST` | `/api/accounting/posting-monitor/post` | Post satu payment ke akuntansi |
| `POST` | `/api/accounting/posting-monitor/bulk` | Bulk post semua yang belum posted |

### GET `/api/accounting/posting-monitor`

Query params:
- `module` — `all` (default) | `sport_center` | `tenant` | `logistics`
- `limit` — max 500, default 100
- `offset` — default 0
- `company_id` — opsional

Response:
```json
{
  "ok": true,
  "rows": [
    {
      "module": "sport_center",
      "source_id": 42,
      "ref": "SCPAY-042",
      "partner_name": "Budi Santoso",
      "amount": "350000.00",
      "method": "cash",
      "payment_status": "paid",
      "posting_status": "unposted",
      "accounting_payment_id": null,
      "paid_at": "2026-06-15T10:00:00Z"
    }
  ],
  "summary": { "total": 15, "posted": 12, "unposted": 3 }
}
```

### POST `/api/accounting/posting-monitor/post`

Body:
```json
{ "moduleType": "sport_center", "sourceDocId": 42 }
```

### POST `/api/accounting/posting-monitor/bulk`

Body:
```json
{ "moduleType": "all" }
```

Response:
```json
{
  "ok": true,
  "results": {
    "sport_center": { "total": 3, "posted": 2, "skipped": 1, "errors": 0 },
    "tenant":       { "total": 1, "posted": 1, "skipped": 0, "errors": 0 }
  }
}
```

---

## BizPortal Page

Path: `/accounting/posting-monitor`

Fitur:
- **KPI cards**: Total, Sudah Diposting, Belum Diposting
- **Filter modul**: Semua / Sport Center / Tenant / Logistik
- **Tab "Belum Diposting"**: Daftar payment yang perlu diposting + tombol Post per baris
- **Tab "Sudah Diposting"**: Riwayat posting
- **Tombol Bulk Post**: Post semua yang belum sekaligus
- **Alert warning**: Muncul jika ada payment belum diposting

---

## Aturan Governance

1. **Idempotent**: `ingestModulePayment()` tidak membuat duplikat; safe dipanggil berulang kali.
2. **Non-blocking**: Kegagalan pembuatan `accounting_entry` (jurnal) tidak membatalkan `accounting_payment` — payment tetap tercatat, hanya jurnal yang tidak ada.
3. **Backfill otomatis**: Saat startup, migration ASK menandai `posting_status = 'posted'` untuk semua payment yang sudah ada di `accounting_payments`.
4. **Audit trail**: Setiap `accounting_payment` menyimpan `source_type` + `source_doc_id` untuk traceability penuh.
5. **Journal resolution**: Sistem mencari journal yang sesuai (cash → cash journal, bank → bank journal) dari `accounting_settings` dulu, baru fallback ke `accounting_journals` langsung.

---

## Migrasi

Kolom baru di tabel lama ditambahkan via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (idempoten):

- `sport_payments.posting_status TEXT DEFAULT 'unposted'`
- `sport_payments.accounting_payment_id INTEGER`
- `tenant_payments.posting_status TEXT DEFAULT 'unposted'`
- `tenant_payments.accounting_payment_id INTEGER`
- Tabel baru `logistics_payments` dibuat via startup migration di `index.ts`

---

## Cara Integrasi Modul Baru

Untuk menambahkan modul baru ke ASK:

1. Tambahkan tipe baru ke `ModuleType` di `lib/ingestModulePayment.ts`
2. Tambahkan case di `bulkIngestModule()` untuk query tabel sumber
3. Tambahkan case di `updatePostingStatus()` untuk UPDATE tabel sumber
4. Tambahkan kolom `posting_status` + `accounting_payment_id` ke tabel payment modul baru
5. Tambahkan query di `GET /api/accounting/posting-monitor` untuk include modul baru
6. Tambahkan nilai filter di halaman BizPortal

---

*Dokumen ini dibuat otomatis sebagai bagian dari implementasi ASK (Accounting Settlement Kit).*
