# Bank Disbursement — Sole Executor untuk Pembayaran Keluar via Bank

> **Berlaku sejak:** Phase 3 Deprecation  
> **Status:** ENFORCED — endpoint POST lama sudah disabled (HTTP 410)

---

## Arsitektur Pembayaran Keluar

### 1. Bank Disbursement (`/accounting/bank-disbursements`)
**Peran:** Sole executor untuk semua pembayaran keluar via bank.

- Satu-satunya modul yang boleh membuat jurnal debit kas/bank untuk pembayaran keluar.
- Mendukung tipe transaksi: `expense`, `supplier_payment`, `tax_payment`, `employee_advance`, `fund_transfer`, `other`.
- Setiap disbursement membuat compound journal entry:
  - DR [Akun per item] (Beban/Aset/Liabilitas)
  - CR [WHT Payable] (jika ada withholding tax)
  - CR [Akun Bank] (net amount)
- Endpoint: `POST /api/bank-disbursements`
- UI: Finance → Bank Disbursement

### 2. Bills & Payments (`/accounting/bills`)
**Peran:** Source dan approval dokumen invoice/vendor bill.

- Mengelola siklus hutang usaha: draft → approved → paid.
- Pembayaran bill dilakukan melalui Bank Disbursement (tipe: `supplier_payment`), bukan langsung posting jurnal.
- Tidak boleh membuat jurnal kas/bank secara langsung.

### 3. Payment Request
**Peran:** Source approval, bukan executor jurnal.

- Digunakan untuk pengajuan dan approval pembayaran internal.
- Setelah disetujui, eksekusi dilakukan oleh Bank Disbursement.
- Tidak boleh memanggil `postEntry()` untuk akun kas/bank secara langsung.

---

## Modul yang Sudah Deprecated (Historical Only)

### Vendor Payments (`/expense/vendor-payments`)
- **Status:** DEPRECATED — HTTP 410 Gone
- **Endpoint disabled:** `POST /api/vendor-payments`
- **Endpoint aktif (read-only):** `GET /api/vendor-payments`, `GET /api/vendor-payments/summary`, `GET /api/vendor-payments/:id`
- **Migrasi:** Gunakan Bank Disbursement tipe `supplier_payment`
- **Data historis:** Tabel `vendor_payments` dipertahankan, tidak dihapus.

### Kas Transfer (`/expense/kas-transfer`)
- **Status:** DEPRECATED — HTTP 410 Gone
- **Endpoint disabled:** `POST /api/expenses/kas-transfer`
- **Endpoint aktif (read-only):** `GET /api/expenses/kas-transfer-history`
- **Migrasi:** Gunakan Bank Disbursement tipe `fund_transfer`
- **Data historis:** Entri jurnal dengan ref `KTF/…` dipertahankan di `accounting_entries`.

---

## Guard Anti-Bypass

### postEntry() — Outbound Payment Calls
Seluruh pemanggilan `postEntry()` yang terkait pembayaran keluar kas/bank harus melalui Bank Disbursement.
Dua jalur yang sebelumnya bypass dan kini sudah di-disable:

| File | Handler | Status |
|------|---------|--------|
| `routes/vendorPayments.ts` | `router.post("/")` | ✅ Disabled — 410 Gone |
| `routes/expenses.ts` | `router.post("/kas-transfer")` | ✅ Disabled — 410 Gone |

Pemanggilan `postEntry()` yang masih aktif dan diizinkan (bukan outbound bank payment):

| File | Konteks | Keterangan |
|------|---------|------------|
| `routes/accounting.ts` | Manual journal, void, reversal | General ledger ops — diizinkan |
| `lib/journalMappingService.ts` | Mapped journal events | Service layer — diizinkan |
| `lib/fleetAccounting.ts` | Fleet cash payments | Fleet-specific — diizinkan |
| `lib/accounting/ledgerGuard.ts` | Ledger guard validation | Guard layer — diizinkan |
| `lib/accounting/approveAndCreateJournal.ts` | Bank recon approval | Bank recon workflow — diizinkan |
| `routes/bankDisbursements.ts` | Disbursement posting | ✅ Sole executor resmi |

---

## Alur yang Benar (Post-Deprecation)

```
Pembayaran Vendor/Supplier
  → Bills & Payments (approval dokumen)
  → Bank Disbursement (type: supplier_payment)
  → postEntry() [via bankDisbursements.ts]

Transfer Dana Antar Rekening
  → Bank Disbursement (type: fund_transfer)
  → postEntry() [via bankDisbursements.ts]

Pembayaran Beban Operasional
  → Expense (approval)
  → Bank Disbursement (type: expense)
  → postEntry() [via bankDisbursements.ts]
```

---

## Catatan Teknis

- Tabel `vendor_payments` dan entri `KTF/…` di `accounting_entries` **tidak dihapus** — data historis tetap dapat diaudit.
- Jika ada sistem eksternal yang memanggil `POST /api/vendor-payments` atau `POST /api/expenses/kas-transfer`, mereka akan menerima HTTP 410 dengan `redirectTo` ke endpoint pengganti.
- Untuk audit trail double payment, jalankan query deteksi di `docs/deprecation/double-payment-audit.sql`.
