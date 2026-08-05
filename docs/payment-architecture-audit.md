# Audit Arsitektur Modul Payment — CST BizPortal

> Tanggal audit: 28 Juni 2026  
> Scope: Semua jalur pengeluaran kas (outbound payment) di `artifacts/api-server` dan `artifacts/bizportal`

---

## 1. Peta Jalur Pembayaran Saat Ini

Saat ini terdapat **6 jalur eksekusi pembayaran** yang berjalan paralel dan saling tumpang tindih:

| # | Nama Modul | Frontend Route | Backend Endpoint | Tabel DB | Journal Source | Tipe Transaksi |
|---|---|---|---|---|---|---|
| 1 | **Bank Disbursements** | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | `bank_disbursements` + `bank_disbursement_items` | `manual_payment` | expense / supplier_payment / tax_payment / employee_advance / fund_transfer / other |
| 2 | **Vendor Payments** | `/expense/vendor-payments` | `POST /api/vendor-payments` | `vendor_payments` | `purchase_payment` | Bayar vendor (DR AP / CR Bank) |
| 3 | **Accounting Payments (outbound)** | `/accounting/payments` | `POST /api/accounting/payments` | `accounting_payments` | `manual_payment` | Inbound & outbound manual |
| 4 | **Bills — tombol "Bayar"** | `/purchase/bills` | `POST /api/accounting/payments` | `accounting_payments` | `manual_payment` | Outbound (bayar PO) — *shared endpoint dengan #3* |
| 5 | **Kas Transfer** | `/expense/kas-transfer` | `POST /api/expenses/kas-transfer` | *(tidak ada tabel khusus — hanya accounting_entries)* | `manual` | Transfer antar bank/kas |
| 6 | **Payment Request (action=pay)** | `/purchase/payment-requests/:id` | `POST /api/purchase-workflow/payment-requests/:id/action` | `payment_requests` | `purchase_payment` | Bayar vendor + update vendor_invoices |

---

## 2. Diagram Aliran Kas Saat Ini

```
                    UANG KELUAR DARI BANK
                           │
        ┌──────────────────┼──────────────────────┐
        │                  │                       │
   Bayar Vendor      Transfer Bank         Beban Operasional
        │                  │                       │
   ┌────┴─────┐       ┌────┴─────┐           ┌────┴──────┐
   │          │       │          │           │           │
VendorPay  BillsPay  KasTransfer BankDisb   Expenses   CashAdv
(#2)       (#3/#4)   (#5)       (#1 type:   (expenses  (#6 type:
                                fund_trfr)  route)     employee_adv)
   │          │
   └────┬─────┘
        │ DOUBLE-COUNT RISK
        ▼
 purchase_documents.payment_status
 (diupdate oleh DUA sistem berbeda)
```

---

## 3. Tumpang Tindih (Overlaps) yang Ditemukan

### 3.1 Overlap Kritis: Bayar Hutang Vendor (AP Settlement)

**Tiga modul berbeda** bisa dipakai untuk membayar hutang vendor ke purchase order yang sama:

| Modul | Tabel | Jurnal | Update payment_status PO? |
|---|---|---|---|
| Vendor Payments (#2) | `vendor_payments` | DR AP (2-1010) / CR Bank | ✅ via `recalculateVendorDocPaymentStatus()` — sum dari `vendor_payments` |
| Bills tombol Bayar (#4) | `accounting_payments` | DR AP / CR Bank | ✅ via `recalculatePaymentStatus()` — sum dari `accounting_payments` |
| Bank Disbursements supplier_payment (#1) | `bank_disbursements` | DR AP / CR Bank | ❌ **Tidak ada** |

**Risiko konkret:** Jika admin membayar PO #123 via Vendor Payments (Rp 5 juta) DAN via Bills (Rp 5 juta), `amount_paid` di `purchase_documents` akan menjadi **Rp 10 juta** (dua query sum yang independen, tidak saling tahu). Purchase order akan terbaca "paid" padahal hanya dibayar sekali.

### 3.2 Overlap: Transfer Antar Bank/Kas

**Dua jalur** untuk memindahkan dana antar rekening:

| Modul | Tabel | Cara Kerja |
|---|---|---|
| Kas Transfer (#5) | *(tidak ada — hanya `accounting_entries` dengan ref `KTF/YYYY/NNNNN`)* | Frontend khusus, validate kode akun 1-101x / 1-102x |
| Bank Disbursements fund_transfer (#1) | `bank_disbursements` + `bank_disbursement_items` | Satu baris di disbursement, validate subtype = cash_bank |

**Perbedaan:** Kas Transfer tidak punya tabel sendiri (hanya journal entry dengan prefix KTF), tidak ada audit trail berbasis tabel, tidak bisa di-void. Bank Disbursements punya tabel + void support.

### 3.3 Overlap: Kasbon/Talangan vs Bank Disbursements employee_advance

| Modul | Tabel | Catatan |
|---|---|---|
| Cash Advances (#6) | `cash_advances`, `cash_advance_repayments` | Punya tracking sisa piutang, repayment, status (active/settled), OCR receipt, approval workflow |
| Bank Disbursements employee_advance (#1) | `bank_disbursements` | Single-line, tidak ada tracking sisa piutang |

**Ini bukan overlap murni** — Cash Advances punya fitur yang jauh lebih kaya (tracking saldo, pelunasan bertahap, approval). Tidak perlu digabung.

### 3.4 Ketidakkonsistenan: Payment Request action=pay

Payment Request saat approved dan action=`pay` dipanggil, langsung call `postEntry()` tanpa lewat Bank Disbursements:

```typescript
// purchaseWorkflow.ts line 1477
const entry = await postEntry({
  journalId: settings.bankJournalId,
  source: "purchase_payment",
  lines: [
    { accountId: settings.apAccountId!, debit: totalAmount },
    { accountId: settings.defaultBankAccountId!, debit: 0, credit: totalAmount },
  ],
}, "BANK");
```

- Tidak ada record di `bank_disbursements`
- Tidak ada nomor disbursement
- Jika journal settings tidak ada → payment tetap di-mark "paid" **tanpa journal** (silent fallback di catch block)
- Tidak bisa di-void

---

## 4. Masalah per Modul

### Bank Disbursements (Modul Target)
**Kelebihan saat ini:**
- ✅ Compound journal (multi-line per satu disbursement)
- ✅ Void dengan reversal journal
- ✅ Nomor disbursement (`BD/YYYY/NNNN`)
- ✅ Support 6 jenis transaksi
- ✅ Validasi tipe akun COA per transaction type

**Kekurangan yang perlu ditambah agar jadi sole executor:**
- ❌ Tidak ada link ke `purchase_document_id` → tidak update `payment_status` PO
- ❌ Tidak ada WHT split (Vendor Payments punya WHT deduction + CR Hutang Pajak)
- ❌ Tidak ada link ke `vendor_invoices` (Payment Request punya ini)
- ❌ Tidak update `vendor_invoices.amount_paid` saat dibayar

### Vendor Payments (#2) — Kandidat Deprecated
**Duplikasi dengan Bank Disbursements** untuk kasus `supplier_payment`. Perbedaan fungsional:
- ✅ Link ke `purchase_document_id` dan auto-update payment_status
- ✅ WHT split (potong pajak penghasilan)
- ❌ Tidak ada void (hanya delete — jurnal tidak di-reverse, audit trail hilang)
- ❌ Tidak support compound (hanya satu vendor per payment)

### Accounting Payments (#3/#4) — Partial Retain (Inbound Only)
**Saat ini dipakai untuk dua hal berbeda:**
- Outbound: bayar vendor/tagihan (tumpang tindih dengan #2 dan #1)
- Inbound: terima pembayaran dari customer (unik — tidak ada di modul lain)
- Trigger auto-transition logistic order status ke "Payment Received" (fitur unik)
- Trigger WA notification ke admin (fitur unik)

**Rekomendasi:** Pertahankan hanya untuk **inbound** (AR), hapus outbound path.

### Kas Transfer (#5) — Kandidat Deprecated
- Tidak punya tabel sendiri → tidak bisa di-list dengan filter yang rich
- Tidak bisa di-void
- Sepenuhnya terduplikasi oleh Bank Disbursements `fund_transfer`

---

## 5. Target Arsitektur yang Direkomendasikan

### Prinsip Utama
> **Bank Disbursement = satu-satunya executor pembayaran keluar.**  
> **Bills & Payments = hanya manajemen invoice (AP), tidak mengeksekusi pembayaran.**

### 5.1 Bank Disbursements — Enhancement Wajib

Sebelum Bank Disbursements bisa jadi sole executor, perlu 4 enhancement:

#### Enhancement A: Link ke Purchase Document (AP Settlement)
Tambah field `purchase_document_id` ke `bank_disbursement_items` untuk item bertipe `supplier_payment`. Setelah disbursement posted, jalankan `recalculateVendorDocPaymentStatus(purchaseDocumentId)`.

```sql
-- Migration
ALTER TABLE bank_disbursement_items ADD COLUMN IF NOT EXISTS purchase_document_id INTEGER;
ALTER TABLE bank_disbursement_items ADD COLUMN IF NOT EXISTS vendor_invoice_id INTEGER;
```

Saat void, recalculate ulang → payment_status kembali ke unpaid/partial.

#### Enhancement B: WHT Split
Tambah optional field `wht_amount` dan `wht_account_id` per item untuk `supplier_payment` type:

```
DR Hutang Usaha (AP)    → amount (full invoice)
CR Bank                 → amount - wht_amount
CR Hutang Pajak (WHT)   → wht_amount
```

#### Enhancement C: Void yang Benar untuk Vendor Payments
Saat Vendor Payments dideprec, semua payment lama harus bisa di-void (reversal journal), bukan delete. Tambah `void` endpoint ke Bank Disbursements yang juga trigger recalculate payment_status.

#### Enhancement D: Nomor Disbursement per Category
Saat ini semua pakai prefix `BD/`. Pertimbangkan prefix berbeda per transaction_type agar mudah difilter di laporan:
- `BD/YYYY/NNNN` — expense umum
- `SP/YYYY/NNNN` — supplier payment  
- `KTF/YYYY/NNNN` — fund transfer (gantikan Kas Transfer)

### 5.2 Bills & Payments — Scope Reduction

**Hapus dari Bills (`/purchase/bills`):**
- Tombol "Bayar" yang memanggil `useCreateAccountingPayment`
- Replace dengan: tombol "Buat Disbursement" yang pre-fill Bank Disbursements form dengan `supplier_payment` type + `purchase_document_id`

**Tetap di Bills:**
- List invoice/tagihan per PO
- Status payment (unpaid/partial/paid) — readonly, dihitung dari Bank Disbursements
- Tombol "Lihat Pembayaran" → list disbursements terkait PO ini

### 5.3 Accounting Payments — Inbound Only

**Hapus:**
- Form outbound (paymentType=`outbound`) dari `/accounting/payments`
- `useCreateAccountingPayment` dengan outbound type

**Pertahankan:**
- Form inbound (paymentType=`inbound`) untuk terima pembayaran customer
- Auto-transition logistic order status ke "Payment Received"
- WA notification

### 5.4 Vendor Payments — Deprecate

1. Sembunyikan menu `/expense/vendor-payments` dari sidebar
2. Data historis tetap ada di `vendor_payments` table untuk referensi
3. Tidak terima payment baru setelah cutover

### 5.5 Kas Transfer — Deprecate

1. Sembunyikan menu `/expense/kas-transfer`
2. Gunakan Bank Disbursements `fund_transfer` type sebagai pengganti
3. Data historis (ref `KTF/`) tetap terbaca di general ledger

### 5.6 Payment Request — Redirect ke Bank Disbursements

Saat action=`pay`:
- **Sebelum:** langsung `postEntry()` tanpa record disbursement
- **Sesudah:** create Bank Disbursement (`supplier_payment` type) → Bank Disbursement yang post journal

```typescript
// purchaseWorkflow.ts — setelah refactor
} else if (action === "pay") {
  // Buat bank disbursement alih-alih langsung postEntry
  const disbResult = await createBankDisbursementInternal({
    companyId: pr.companyId,
    journalId: settings.bankJournalId,
    date: paidDate,
    ref: pr.payReqNumber,
    memo: `Payment Request ${pr.payReqNumber} — ${pr.supplierName}`,
    items: items.map(item => ({
      transactionType: "supplier_payment",
      accountId: settings.apAccountId,
      description: item.description,
      amount: item.amount,
      purchaseDocumentId: item.purchaseDocumentId ?? null,
    })),
  });
  await db.update(paymentRequestsTable)
    .set({ status: "paid", disbursementId: disbResult.id, ... })
    ...
}
```

---

## 6. Ringkasan Perubahan per File

| File | Tindakan | Prioritas |
|---|---|---|
| `bankDisbursements.ts` | Tambah field `purchase_document_id` + `wht_amount` + `wht_account_id` per item; trigger recalculate saat post & void | **P1 — Blocker** |
| `lib/db/schema/` | Migration: ALTER bank_disbursement_items tambah 3 kolom baru | **P1 — Blocker** |
| `purchase/bills.tsx` | Hapus tombol Bayar → ganti tombol "Buat Disbursement" | **P2** |
| `purchaseWorkflow.ts` | action=pay → call `createBankDisbursementInternal()` | **P2** |
| `accounting/payments.tsx` | Sembunyikan form outbound | **P2** |
| `accounting.ts` | Block POST payment dengan paymentType=outbound (atau soft deprecate) | **P2** |
| `expense/vendor-payments.tsx` | Sembunyikan dari sidebar + tampilkan banner "Gunakan Bank Disbursements" | **P3** |
| `expense/kas-transfer.tsx` | Sembunyikan dari sidebar + tampilkan banner redirect | **P3** |
| `routes/vendorPayments.ts` | Tandai deprecated, block POST baru (return 410 Gone) | **P3** |
| `expenses.ts` kas-transfer handler | Tandai deprecated, block POST baru | **P3** |

---

## 7. Urutan Implementasi yang Aman

```
Phase 1 — Foundation (tidak breaking)
  1.1  Migration: tambah kolom baru ke bank_disbursement_items
  1.2  Backend: Bank Disbursements POST support purchase_document_id + WHT split
  1.3  Backend: Bank Disbursements VOID trigger recalculate payment_status

Phase 2 — Redirect (user-visible, soft)
  2.1  Bills: hapus tombol "Bayar", tambah tombol "Buat Disbursement"
  2.2  Payment Request action=pay: create disbursement, bukan postEntry langsung
  2.3  Accounting Payments: disable form outbound

Phase 3 — Deprecate (cleanup)
  3.1  Vendor Payments: banner + POST returns 410
  3.2  Kas Transfer: banner + POST returns 410
  3.3  Remove routes dari sidebar navigation setelah 2 sprint
```

> ⚠️ **Jangan hapus tabel `vendor_payments` dan `vendor_payments`** — data historis diperlukan untuk audit trail dan laporan pembayaran lama.

---

## 8. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Cutover sebelum Phase 1 selesai | Bank Disbursements tidak update payment_status → PO stuck "unpaid" | Selesaikan Phase 1 penuh sebelum deprecate Vendor Payments |
| Data lama di `vendor_payments` tidak ada di Bank Disbursements | Laporan pembayaran historis tidak komplet | Buat view/report yang union dari kedua tabel selama periode transisi |
| Payment Request yang sudah "paid" tanpa disbursement_id | Tidak bisa di-audit | Backfill: scan `payment_requests` dengan status=paid tapi tanpa journalEntryId, buat disbursement retroaktif |
| Double-count yang sudah terjadi | amount_paid PO lebih tinggi dari aktual | Audit query: bandingkan SUM(vendor_payments) vs SUM(accounting_payments) per purchase_document_id |

**Query audit double-count:**
```sql
SELECT 
  pd.doc_number,
  pd.grand_total,
  COALESCE(SUM(vp.amount), 0) AS total_via_vendor_payments,
  COALESCE(SUM(ap.amount) FILTER (WHERE ap.payment_type = 'outbound'), 0) AS total_via_accounting_payments,
  pd.amount_paid AS stored_amount_paid
FROM purchase_documents pd
LEFT JOIN vendor_payments vp ON vp.purchase_document_id = pd.id
LEFT JOIN accounting_payments ap ON ap.source_type = 'purchase_order' AND ap.source_doc_id = pd.id
GROUP BY pd.id, pd.doc_number, pd.grand_total, pd.amount_paid
HAVING COALESCE(SUM(vp.amount), 0) + COALESCE(SUM(ap.amount) FILTER (WHERE ap.payment_type = 'outbound'), 0) <> pd.amount_paid
ORDER BY pd.id;
```
