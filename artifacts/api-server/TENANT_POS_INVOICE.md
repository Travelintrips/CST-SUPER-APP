# Tenant Invoice System

## Skema Database

### `tenant_invoices`
| Kolom | Tipe | Keterangan |
|-------|------|------------|
| id | SERIAL PK | |
| company_id | INTEGER | Multi-company (default 1) |
| tenant_id | INTEGER FK | Ref ke `tenants` |
| booking_id | INTEGER FK | Ref ke `tenant_bookings` |
| unit_id | INTEGER FK | Ref ke `tenant_units` |
| invoice_number | VARCHAR(50) UNIQUE | Format: `TIN/YYYY/MM/0001` |
| invoice_date | DATE | Tanggal invoice dibuat |
| period_start | DATE | Awal periode sewa |
| period_end | DATE | Akhir periode sewa |
| due_date | DATE | Jatuh tempo |
| subtotal | NUMERIC(14,2) | Biaya sewa sebelum pajak |
| tax_amount | NUMERIC(14,2) | Pajak/PPN |
| discount_amount | NUMERIC(14,2) | Diskon |
| penalty_amount | NUMERIC(14,2) | Denda keterlambatan |
| total_amount | NUMERIC(14,2) | = subtotal + tax - discount + penalty |
| paid_amount | NUMERIC(14,2) | Sudah dibayar |
| outstanding_amount | NUMERIC(14,2) | = total - paid |
| status | VARCHAR(20) | Lihat di bawah |
| notes | TEXT | Catatan bebas |
| sent_at | TIMESTAMPTZ | Kapan dikirim ke penyewa |
| paid_at | TIMESTAMPTZ | Kapan lunas |
| cancelled_at | TIMESTAMPTZ | Kapan dibatalkan |
| created_by | VARCHAR(255) | User ID pembuat |

### Status Invoice
| Status | Keterangan |
|--------|------------|
| `draft` | Invoice dibuat, belum dikirim |
| `sent` | Sudah dikirim ke penyewa, tapi belum konfirmasi pembayaran |
| `unpaid` | Sudah terkirim/aktif, belum ada pembayaran |
| `partial` | Sebagian sudah dibayar |
| `paid` | Lunas 100% |
| `overdue` | Melewati due_date dan belum paid |
| `cancelled` | Dibatalkan |

### `tenant_payments.invoice_id`
Kolom baru yang menghubungkan pembayaran ke invoice. Saat pembayaran dikonfirmasi (`/payments/:id/confirm`), sistem otomatis memanggil `applyPaymentToInvoice()` untuk mengupdate `paid_amount`, `outstanding_amount`, dan `status` invoice.

## Nomor Invoice
Format: `TIN/YYYY/MM/0001`
- `TIN` = Tenant Invoice
- `YYYY` = Tahun 4 digit
- `MM` = Bulan 2 digit
- `0001` = Sequence bulan berjalan (auto-increment)

## API Endpoints

Semua endpoint membutuhkan autentikasi admin (`requireAdmin`).
Base path: `/api/tenant/invoices`

### GET `/api/tenant/invoices`
List invoice dengan filter.

Query params:
- `companyId` — filter per company
- `status` — filter status (all/draft/sent/unpaid/partial/paid/overdue/cancelled)
- `search` — cari no. invoice / nama bisnis
- `tenant_id` — filter per tenant
- `booking_id` — filter per booking
- `from` / `to` — filter range invoice_date

Response: `{ data: Invoice[], total: number }`

### GET `/api/tenant/invoices/:id`
Detail invoice + `payment_history` array dari `tenant_payments`.

### POST `/api/tenant/invoices/generate-from-booking/:bookingId`
Generate invoice otomatis dari booking. Mengisi subtotal dari `total_price` booking.

Body (semua opsional):
```json
{
  "periodStart": "2026-06-01",
  "periodEnd": "2026-06-30",
  "dueDate": "2026-07-05",
  "notes": "Invoice sewa bulan Juni"
}
```

Response 201: invoice baru + `isNew: true`
Response 409: invoice sudah ada → `{ invoice_id, invoice_number }`

### POST `/api/tenant/invoices`
Buat invoice manual.

Body:
```json
{
  "tenant_id": 1,
  "booking_id": null,
  "subtotal": 5000000,
  "tax_amount": 0,
  "discount_amount": 0,
  "penalty_amount": 0,
  "invoice_date": "2026-06-01",
  "period_start": "2026-06-01",
  "period_end": "2026-06-30",
  "due_date": "2026-07-05",
  "status": "draft",
  "notes": null
}
```

### PUT `/api/tenant/invoices/:id`
Update invoice (tidak bisa edit jika sudah `paid` atau `cancelled`).
Field yang bisa diubah: `subtotal`, `tax_amount`, `discount_amount`, `penalty_amount`, `period_start`, `period_end`, `due_date`, `invoice_date`, `status`, `notes`.

### DELETE `/api/tenant/invoices/:id`
Batalkan invoice (set status = `cancelled`, set `cancelled_at`). Tidak bisa membatalkan invoice lunas.

### POST `/api/tenant/invoices/:id/cancel`
Batalkan dengan alasan. Body: `{ "reason": "alasan" }`.

### POST `/api/tenant/invoices/:id/send`
Tandai invoice terkirim. Status berubah dari `draft` → `unpaid`, set `sent_at`.

### POST `/api/tenant/invoices/:id/mark-paid`
Tandai invoice lunas manual. Set `paid_amount = total_amount`, `outstanding_amount = 0`, `paid_at = NOW()`.

## Alur Pembayaran

### Via Konfirmasi Pembayaran
1. Buat pembayaran (`POST /api/tenant/payments`) dengan `invoice_id` di body.
2. Konfirmasi (`POST /api/tenant/payments/:id/confirm`) → sistem otomatis panggil `applyPaymentToInvoice()`.
3. `applyPaymentToInvoice()` menambah `paid_amount`, menghitung ulang `outstanding_amount`, dan mengubah status:
   - `paid_amount >= total_amount` → `paid`
   - `paid_amount > 0` → `partial`
   - `paid_amount = 0` → `unpaid`

### Via Mark-Paid Manual
Admin bisa langsung tandai lunas via `POST /invoices/:id/mark-paid` tanpa perlu membuat payment record.

## Dashboard Stats

Endpoint dashboard `/api/tenant/dashboard` sudah mengembalikan statistik invoice:
```json
{
  "invoices": {
    "total": 10,
    "paid": 5,
    "unpaid_count": 3,
    "overdue": 2,
    "total_outstanding": 15000000,
    "paid_this_month": 8000000
  }
}
```

## Generate dari Halaman Bookings

Tombol **"⚡ Invoice"** ada di setiap baris penyewaan. Klik akan:
1. Memanggil `POST /api/tenant/invoices/generate-from-booking/:bookingId`
2. Jika berhasil: toast sukses + navigate ke halaman invoice
3. Jika sudah ada (409): toast info nomor invoice yang sudah ada + navigate ke halaman invoice
