# Laporan Audit Akuntansi, Pajak & Keuangan
**BizPortal ERP — Audit Menyeluruh**
Tanggal: 2026-06-11 | Auditor: AI Architect Review (7 sub-agent paralel)

---

## Ringkasan Eksekutif

Sistem BizPortal memiliki fondasi akuntansi yang **cukup solid**: double-entry journaling ter-enforce, reversal yang idempoten, dan tax engine yang komprehensif. Namun terdapat **gap kritis** terutama di: audit trail field yang tidak lengkap di skema utama, tax fields yang hanya ada via raw SQL (tidak sinkron di Drizzle schema), tidak adanya endpoint audit "transaksi tanpa jurnal" untuk modul Sales/Purchase/Logistik, serta rekonsiliasi AR/AP yang belum punya UI formal.

---

## 1. Modul yang Sudah Benar ✅

### 1.1 Alur Penjualan (Sales)
| Fitur | Status | Catatan |
|-------|--------|---------|
| Jurnal invoice (DR Piutang / CR Revenue / CR PPN Keluaran) | ✅ | `postSalesInvoice()` di `lib/accounting.ts` |
| Jurnal COGS & pengurangan inventory saat delivery | ✅ | `postSalesCogs()`, `postStockOut()` |
| Status transitions (draft→sent→confirmed→done) | ✅ | `invoiceStatus`, `deliveryStatus`, `paymentStatus` |
| Reversal jurnal saat cancellation | ✅ | `postSalesInvoiceReversal()` — idempoten via sourceId check |
| Sales return (credit note) | ✅ | `POST /documents/:id/return` → `postSalesReturn()` + `postSalesCogsReturn()` |
| Pencatatan tax di `transaction_taxes` saat confirm | ✅ | `recordTransactionTax()` dipanggil di action "confirm" |

### 1.2 Alur Pembelian (Purchase)
| Fitur | Status | Catatan |
|-------|--------|---------|
| Jurnal bill (DR Expense/Inventory + DR PPN Masukan / CR AP) | ✅ | `postPurchaseBill()` |
| Jurnal logistic vendor cost | ✅ | `postLogisticVendorCostJournal()` per service type |
| Penerimaan barang → tambah stok | ✅ | `postStockIn()`, `inventory_stock` table |
| Reversal bill saat cancel_bill | ✅ | `postPurchaseBillReversal()` — idempoten |
| Status tracking (billStatus, receiveStatus, paymentStatus) | ✅ | Tersedia di `purchase_documents` |

### 1.3 Accounting Engine
| Fitur | Status | Catatan |
|-------|--------|---------|
| Double-entry validation (DR = CR) | ✅ | `postEntry()` validasi balance sebelum insert |
| COA Indonesia standard | ✅ | Seed otomatis via `accountingSeed.ts` |
| Journal types (Sales, Purchase, Bank, Cash, General) | ✅ | `accounting_journals` table |
| Cost centers | ✅ | `cost_centers` table, propagated ke entry lines |
| Multi-company via `company_id` | ✅ | Filter di semua query |
| Kasbon / Employee Advance journaling | ✅ | `journalMappingService.ts` |
| Bank Loan journaling | ✅ | `postLoanRepaymentJournal()` |
| Fixed Asset journaling | ✅ | `postFixedAssetJournal()` |
| Logistic revenue per service type | ✅ | Sea/Air/Trucking → COA spesifik |

### 1.4 Tax Engine
| Fitur | Status | Catatan |
|-------|--------|---------|
| `tax_rules` table (company, tx_type, tax_type, rate, direction) | ✅ | Via `taxRulesMigration.ts` (raw SQL) |
| `transaction_taxes` table di Drizzle schema | ✅ | Status: pending/paid/reported |
| PPN Keluaran terpisah dari PPN Masukan | ✅ | `direction` field di tax_rules |
| PPh 21 kalkulator progresif (bracket UU PPh 2024) | ✅ | `pph21Calculator.ts` |
| PPh 23/26 withholding | ✅ | `taxAutoService.ts` |
| PPh 4 ayat 2 | ✅ | Via tax rules, dikelompokkan di `pph.tsx` |
| Endpoint tax dashboard, PPN, PPh | ✅ | `routes/tax.ts` |
| SSE real-time broadcast untuk tax updates | ✅ | `taxSseBroadcast.ts` |
| Faktur pajak validator | ✅ | `fakturPajakValidator.ts` |
| NPWP validator | ✅ | `npwpValidator.ts` |

### 1.5 Laporan Pajak (Frontend)
| Laporan | Status | File |
|---------|--------|------|
| SPT Masa PPN (rekap per periode) | ✅ | `tax/spt.tsx` |
| Rekap PPN Masukan & Keluaran + Kurang/Lebih Bayar | ✅ | `tax/ppn.tsx` |
| Rekap PPh (21/23/4(2)) | ✅ | `tax/pph.tsx` |
| Tax dashboard | ✅ | `tax/dashboard.tsx` |
| Tax transactions detail | ✅ | `tax/transactions.tsx` |
| Tax reconciliation + bulk status update | ✅ | `tax/reconciliation.tsx` |
| WHT reconciliation (WHT Payable COA 2-1030) | ✅ | `accounting/wht-reconciliation.tsx` |
| Export Excel/CSV semua laporan pajak | ✅ | `window.open('/api/tax/export?...')` |
| Laporan Laba Rugi | ✅ | `accounting/reports/profit-loss.tsx` |
| Neraca (Balance Sheet) | ✅ | `accounting/reports/balance-sheet.tsx` |
| Neraca Saldo (Trial Balance) | ✅ | `accounting/reports/trial-balance.tsx` |
| Buku Besar (General Ledger) | ✅ | `accounting/reports/general-ledger.tsx` |

### 1.6 Audit Trail (Parsial)
| Fitur | Status | Catatan |
|-------|--------|---------|
| `erp_audit_logs` table | ✅ | `old_data` + `new_data` JSONB, user_id, action, module |
| `unifiedAudit.ts` service | ✅ | Standard logging, dipakai di tax route |
| `auditLog.ts` per module | ✅ | Per-transaksi logging |
| Audit report module | ✅ | `auditReports.ts`, numbering AUD/YYYY/NNNNN |
| `storageAuditLog` | ✅ | File upload/access tracking |

### 1.7 Rekonsiliasi
| Fitur | Status | Catatan |
|-------|--------|---------|
| Bank vs Google Sheets rekonsiliasi | ✅ | `rekonsiliasiWorker.ts` — COCOK/DUPLIKAT/TIDAK ADA |
| Bank reconciliation UI | ✅ | `accounting/reconciliation.tsx` |
| Expense missing journal endpoint | ✅ | `GET /api/expenses/missing-journals` |
| Expense bulk repost journal | ✅ | `POST /api/expenses/bulk-repost` |
| Tax reconciliation gaps (NPWP, faktur) | ✅ | `GET /api/tax/reconciliation` |

---

## 2. Modul yang Belum Lengkap ⚠️

### 2.1 Audit Trail — Field Tidak Lengkap di Schema

**GAP KRITIS:** Tabel utama transaksi hanya punya `created_by_id` (di sales_documents saja). Field `approved_by`, `posted_by`, `cancelled_by`, `cancel_reason`, `edit_reason`, `reversal_reason` **tidak ada** di Drizzle schema manapun.

| Tabel | `created_by_id` | `approved_by` | `cancelled_by` | `cancel_reason` | `edit_reason` |
|-------|:-:|:-:|:-:|:-:|:-:|
| `sales_documents` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `purchase_documents` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `accounting_entries` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `accounting_entry_lines` | ❌ | — | — | — | — |
| `expenses` | — | ❌ | ❌ | ❌ | ❌ |

**Dampak:** Tidak bisa trace siapa yang approve, batalkan, atau edit transaksi penting. `erp_audit_logs` mencatat perubahan tapi tidak embedded di dokumen transaksi itu sendiri sehingga butuh join extra dan bisa terlewat.

### 2.2 Tax Schema — Field Ada di DB Tapi Tidak di Drizzle (Raw SQL Only)

Field berikut ditambahkan via `taxRulesMigration.ts` menggunakan raw `ALTER TABLE` — **tidak ada** di Drizzle schema file `lib/db/src/schema/accounting.ts`:

| Field | Tabel | Status |
|-------|-------|--------|
| `direction` (input/output/withholding) | `transaction_taxes` | ⚠️ Raw SQL ALTER TABLE only |
| `tax_rule_id` | `transaction_taxes` | ⚠️ Raw SQL ALTER TABLE only |
| `partner_name` | `transaction_taxes` | ⚠️ Raw SQL ALTER TABLE only |
| `npwp` | `transaction_taxes` | ⚠️ Raw SQL ALTER TABLE only |
| `faktur_pajak_number` / `bukti_potong_number` | `transaction_taxes` | ❌ Belum ada sama sekali |
| Seluruh tabel `tax_rules` | — | ⚠️ Raw SQL only — tidak ada di Drizzle schema |

**Dampak:** Drizzle ORM tidak bisa generate type-safe queries untuk field ini. Jika `drizzle-kit push` dijalankan pada DB fresh, field-field ini tidak akan dibuat.

### 2.3 Status Tax — Kurang Lengkap

`transaction_taxes.status` hanya: `pending` → `paid` → `reported`.

**Seharusnya:** `draft` → `calculated` → `posted` → `reported` → `paid`

Tidak ada status `calculated` (sudah dihitung tapi belum diposting ke jurnal akuntansi) dan `posted` (sudah masuk jurnal, menunggu pelaporan SPT).

### 2.4 Audit Query — Transaksi Tanpa Jurnal

Hanya **expenses** yang punya endpoint `/missing-journals`. Modul lain tidak ada:

| Modul | Missing Journal Endpoint | Bulk Repost |
|-------|:---:|:---:|
| Expenses | ✅ | ✅ |
| Sales Documents | ❌ | ❌ |
| Purchase Documents | ❌ | ❌ |
| Logistic Orders | ❌ | ❌ |
| Payments (Penerimaan) | ❌ | ❌ |
| Vendor Payments (Pengeluaran) | ❌ | ❌ |
| Cash Advances (Kasbon) | ❌ | ❌ |
| Bank Loans | ❌ | ❌ |
| Fixed Assets | ❌ | ❌ |

### 2.5 Rekonsiliasi AR/AP — Tidak Ada UI Formal

`rekonsiliasiWorker.ts` hanya rekonsiliasi **bank vs Google Sheets** (hasil ditulis ke GSheet, bukan ke DB). Tidak ada:
- Laporan invoice belum dilunasi (AR unmatched)
- Laporan vendor bill belum dibayar (AP unmatched)
- Partial match report (invoice dibayar sebagian)
- Manual approval untuk matching yang ambigu
- Endpoint `GET /api/accounting/reconciliation/ar-unmatched`
- Endpoint `GET /api/accounting/reconciliation/ap-unmatched`
- Aging report AR/AP

### 2.6 Laporan Pajak — Gap

| Laporan | Status | Catatan |
|---------|--------|---------|
| Daftar transaksi tanpa NPWP/NIK | ❌ | Belum ada endpoint/halaman |
| Daftar transaksi tanpa faktur pajak/bukti potong | ❌ | Belum ada (field pun belum ada di schema) |
| Daftar pajak belum diposting ke jurnal | ❌ | Tidak bisa — tidak ada status "posted" |
| Daftar pajak belum dibayar (formal) | ⚠️ | Ada via filter `status=pending` tapi bukan laporan formal |
| Export **PDF** untuk laporan pajak | ❌ | Semua export hanya Excel/CSV |
| SPT Masa PPh 21 detail per karyawan | ❌ | Tidak ada halaman detail |
| SPT Masa PPh 4(2) laporan terpisah | ❌ | Hanya di-group di `pph.tsx` |
| Rekap PPh 23/26 detail per vendor | ⚠️ | Ada tapi kurang detail (tidak ada nama vendor per baris) |

### 2.7 Jurnal Tidak Balance — Tidak Ada Audit Query

Tidak ada endpoint batch untuk cek **total debit ≠ total kredit** di `accounting_entries`. Validasi hanya real-time saat `postEntry()` dipanggil — tidak ada retrospective audit untuk data lama.

### 2.8 Rekonsiliasi Mutasi Bank — Hasil Tidak Masuk DB

`rekonsiliasiWorker.ts` menulis hasil ke Google Sheets, bukan ke tabel database. Akibatnya:
- Tidak ada history rekonsiliasi yang bisa di-query via API
- Tidak ada status per line item (matched/unmatched/manual) yang persisten
- Tidak ada approval workflow untuk item yang perlu manual review

---

## 3. Bug / Risiko 🔴

### 3.1 🔴 KRITIS — Faktur Pajak & Bukti Potong Tidak Tersimpan
**Risiko:** Field `faktur_pajak_number` dan `bukti_potong_number` tidak ada di `transaction_taxes` (baik di Drizzle maupun raw SQL). Ini berarti tidak ada cara menyimpan atau melacak nomor faktur pajak PPN dan bukti potong PPh per transaksi — **kewajiban perpajakan Indonesia**.
**File:** `lib/db/src/schema/accounting.ts`, `artifacts/api-server/src/lib/taxRulesMigration.ts`

### 3.2 🔴 KRITIS — Drizzle Schema & DB Out of Sync
**Risiko:** Field `direction`, `npwp`, `tax_rule_id`, `partner_name` di `transaction_taxes` + seluruh tabel `tax_rules` hanya ada via raw `ALTER TABLE`. Jika `drizzle-kit push` dijalankan pada DB baru/fresh, field ini tidak dibuat. Deploy baru akan fail.
**File:** `lib/db/src/schema/accounting.ts`, `artifacts/api-server/src/lib/taxRulesMigration.ts`

### 3.3 🟠 TINGGI — `purchase_documents` Tidak Ada `created_by_id` Sama Sekali
Berbeda dengan `sales_documents` (punya `created_by_id`), tabel `purchase_documents` tidak memiliki **field apapun** untuk tracking user. Tidak bisa audit siapa yang buat PO/bill.
**File:** `lib/db/src/schema/purchaseDocuments.ts`

### 3.4 🟠 TINGGI — Reversal Idempoten Bergantung `journalId` dari Settings
`postSalesInvoiceReversal()` cek idempoten: `source = 'reversal' AND sourceId = salesDocId AND journalId = salesJournalId`. Jika `salesJournalId` di settings berubah (misal setting di-reset), reversal bisa dieksekusi ulang → double-posting.
**File:** `artifacts/api-server/src/lib/accounting.ts` line ~1706–1715

### 3.5 🟡 SEDANG — PPh Expense Tidak Selalu Rekam `transaction_taxes`
Expense yang kena PPh potong (PPh 23 jasa) tidak selalu memanggil `recordTransactionTax()`. Bergantung apakah expense di-link ke vendor atau tidak. Laporan PPh dari expenses kemungkinan tidak lengkap.
**File:** `artifacts/api-server/src/routes/expenses.ts`

### 3.6 🟡 SEDANG — `transaction_taxes` uniqueIndex Berisiko Upsert Conflict
`uniqueIndex("tx_taxes_tx_uniq").on(transactionType, transactionId, taxId)` — Logika upsert di `taxAutoService.ts` perlu dicek apakah selalu melakukan `ON CONFLICT DO UPDATE` dengan benar, atau bisa menghasilkan constraint violation jika tax diperhitungkan ulang.
**File:** `lib/db/src/schema/accounting.ts`, `artifacts/api-server/src/lib/taxAutoService.ts`

### 3.7 🟡 SEDANG — Rekonsiliasi Bank Output ke GSheet Saja
Jika Google Sheets API quota habis atau token expired, hasil rekonsiliasi hilang tanpa fallback. Tidak ada persistensi ke DB.
**File:** `artifacts/api-server/src/lib/rekonsiliasiWorker.ts`

### 3.8 🟡 SEDANG — Tidak Ada Audit untuk Cross-Company Entry Lines
Tidak ada query yang memeriksa apakah `accounting_entry_lines.company_id` cocok dengan `accounting_entries.company_id`. Data multi-company bisa tercampur tanpa terdeteksi.
**File:** `artifacts/api-server/src/routes/accounting.ts`

---

## 4. File yang Perlu Diubah

### Fase 1 — Schema (`lib/db/src/schema/`)
| File | Perubahan |
|------|-----------|
| `accounting.ts` | Pindahkan `tax_rules` ke Drizzle; tambah `direction`, `npwp`, `fakturPajakNumber`, `buktiPotongNumber`, `taxRuleId`, `partnerName` ke `transactionTaxesTable`; tambah `approvedBy`, `cancelledBy`, `cancelReason` ke `accountingEntriesTable` |
| `salesDocuments.ts` | Tambah `approvedBy`, `approvedAt`, `cancelledBy`, `cancelledAt`, `cancelReason`, `editReason`, `reversalReason` |
| `purchaseDocuments.ts` | Tambah `createdById`, `approvedBy`, `approvedAt`, `cancelledBy`, `cancelledAt`, `cancelReason`, `editReason` |

### Fase 2 — Lib & Routes (API Server)
| File | Perubahan |
|------|-----------|
| `lib/taxAutoService.ts` | Tambah status `calculated` & `posted`; fix upsert logic |
| `lib/taxRulesMigration.ts` | Hapus ALTER TABLE yang sudah pindah ke Drizzle schema |
| `lib/accounting.ts` | Fix reversal idempoten; propagate `approvedBy`/`cancelledBy` |
| `routes/sales.ts` | Simpan `approvedBy`/`cancelledBy`/`cancelReason` di tiap action handler |
| `routes/purchase.ts` | Simpan `createdById`/`approvedBy`/`cancelledBy` di tiap action handler |
| `routes/expenses.ts` | Pastikan `recordTransactionTax()` dipanggil untuk semua expense dengan vendor |

### Fase 3 — Endpoint Audit & Compliance
| File | Endpoint Baru |
|------|---------------|
| `routes/accounting.ts` | `GET /api/accounting/audit/missing-journals` (lintas modul) |
| `routes/accounting.ts` | `GET /api/accounting/audit/unbalanced-entries` |
| `routes/accounting.ts` | `GET /api/accounting/audit/cross-company` |
| `routes/accounting.ts` | `GET /api/accounting/audit/no-coa` |
| `routes/tax.ts` | `GET /api/tax/npwp-missing` |
| `routes/tax.ts` | `GET /api/tax/faktur-missing` |
| `routes/tax.ts` | `GET /api/tax/unposted` |
| `routes/tax.ts` | `GET /api/tax/unpaid` |
| `routes/payments.ts` | `GET /api/payments/reconciliation/ar-unmatched` |
| `routes/payments.ts` | `GET /api/payments/reconciliation/ar-partial` |
| `routes/vendorPayments.ts` | `GET /api/vendor-payments/reconciliation/ap-unmatched` |

### Fase 4 — Frontend BizPortal
| File | Perubahan |
|------|-----------|
| `pages/accounting/audit-report.tsx` (BARU) | Halaman audit: transaksi tanpa jurnal, jurnal tidak balance, cross-company, COA invalid |
| `pages/tax/missing-compliance.tsx` (BARU) | Laporan: tanpa NPWP, tanpa faktur/bukti potong, belum posting, belum dibayar |
| `pages/accounting/reconciliation-ar.tsx` (BARU) | AR unmatched, partial match, manual approval |
| `pages/accounting/reconciliation-ap.tsx` (BARU) | AP unmatched, aging report |
| `pages/tax/ppn.tsx` | Tambah kolom faktur pajak, filter missing faktur |
| `pages/tax/pph.tsx` | Detail per karyawan (PPh 21), export PDF |

### Fase 5 — Hardening
| File | Perubahan |
|------|-----------|
| `lib/accounting.ts` | Fix reversal idempoten tanpa bergantung journalId settings |
| `lib/rekonsiliasiWorker.ts` | Tambah fallback simpan hasil ke DB |
| `lib/db/src/schema/accounting.ts` | Tambah tabel `bank_reconciliation_items` |

---

## 5. Tabel Rekomendasi Prioritas

| No | Item | Modul | Risiko | Prioritas |
|----|------|-------|--------|-----------|
| 1 | Tambah `faktur_pajak_number` & `bukti_potong_number` ke Drizzle schema `transaction_taxes` | Tax | KRITIS | **P1** |
| 2 | Sinkronkan Drizzle schema: pindah `tax_rules` & field `direction`/`npwp` dari raw SQL | Tax | KRITIS | **P1** |
| 3 | Tambah `approved_by`, `cancelled_by`, `cancel_reason` ke `sales_documents` | Sales | TINGGI | **P1** |
| 4 | Tambah `created_by_id`, `approved_by`, `cancelled_by` ke `purchase_documents` | Purchase | TINGGI | **P1** |
| 5 | Endpoint audit `missing-journals` lintas modul (sales/purchase/logistik/kasbon) | Accounting | TINGGI | **P1** |
| 6 | Laporan transaksi tanpa NPWP & tanpa faktur/bukti potong | Tax | TINGGI | **P1** |
| 7 | Tambah status `calculated` & `posted` ke `transaction_taxes` | Tax | SEDANG | **P2** |
| 8 | Endpoint `unbalanced-entries` — cek DR ≠ CR retrospective | Accounting | SEDANG | **P2** |
| 9 | Endpoint AR unmatched & AP unmatched | Accounting | SEDANG | **P2** |
| 10 | Fix reversal idempoten (jangan bergantung journalId dari settings) | Accounting | SEDANG | **P2** |
| 11 | PPh recording untuk semua expense dengan vendor (PPh 23) | Tax | SEDANG | **P2** |
| 12 | Halaman audit report di frontend | Frontend | SEDANG | **P2** |
| 13 | Halaman missing compliance di frontend | Frontend | SEDANG | **P2** |
| 14 | Halaman AR/AP reconciliation formal di frontend | Frontend | SEDANG | **P2** |
| 15 | Export PDF untuk SPT, PPN, PPh | Tax | RENDAH | **P3** |
| 16 | Simpan hasil rekonsiliasi bank ke DB (bukan hanya GSheet) | Accounting | RENDAH | **P3** |
| 17 | Detail PPh 21 per karyawan per periode | Tax | RENDAH | **P3** |

---

## 6. Rencana Implementasi Per Fase

### Fase 1 — Schema & Data Integrity *(Estimasi: 1–2 hari)*
**Tujuan:** Memperbaiki fondasi data sebelum fitur lain bisa berjalan benar.

- [ ] **F1.1** Drizzle schema `accounting.ts`:
  - `transactionTaxesTable`: tambah `direction`, `npwp`, `fakturPajakNumber`, `buktiPotongNumber`, `taxRuleId`, `partnerName`
  - `accountingEntriesTable`: tambah `approvedBy`, `cancelledBy`, `cancelReason`
  - Buat `taxRulesTable` di Drizzle (migrasi dari raw SQL)
- [ ] **F1.2** Drizzle schema `salesDocuments.ts`: tambah `approvedBy`, `approvedAt`, `cancelledBy`, `cancelledAt`, `cancelReason`, `editReason`, `reversalReason`
- [ ] **F1.3** Drizzle schema `purchaseDocuments.ts`: tambah `createdById`, `approvedBy`, `approvedAt`, `cancelledBy`, `cancelledAt`, `cancelReason`, `editReason`
- [ ] **F1.4** Update `taxRulesMigration.ts` — hapus ALTER TABLE duplikat yang sudah masuk Drizzle
- [ ] **F1.5** Generate & push: `drizzle-kit generate && drizzle-kit push`

### Fase 2 — Audit Trail & Tax Status Flow *(Estimasi: 1 hari)*
**Tujuan:** Semua action penting menyimpan siapa yang melakukan, tax flow lengkap.

- [ ] **F2.1** `routes/sales.ts`: simpan `approvedBy`/`cancelledBy`/`cancelReason` di action "confirm"/"cancel"
- [ ] **F2.2** `routes/purchase.ts`: simpan `createdById`/`approvedBy`/`cancelledBy` di tiap action
- [ ] **F2.3** `lib/accounting.ts` `postEntry()`: propagate `approvedBy`, fix reversal idempoten (gunakan `source_doc_type + source_doc_id`, tidak bergantung `journalId` dari settings)
- [ ] **F2.4** `lib/taxAutoService.ts`: tambah status `calculated` → `posted` → `reported` → `paid`; propagasi `fakturPajakNumber`/`buktiPotongNumber` saat posting
- [ ] **F2.5** `routes/expenses.ts`: pastikan `recordTransactionTax()` dipanggil untuk semua expense dengan vendor PPh 23

### Fase 3 — Endpoint Audit & Compliance *(Estimasi: 1–2 hari)*
**Tujuan:** Backend menyediakan data monitoring & kepatuhan lengkap.

- [ ] **F3.1** `routes/accounting.ts` — sub-router `/api/accounting/audit/`:
  - `GET /missing-journals?module=all|sales|purchase|logistic|kasbon|payment` — query lintas modul
  - `GET /unbalanced-entries` — accounting_entries di mana sum(debit_amount) ≠ sum(credit_amount)
  - `GET /cross-company` — entry lines dengan company_id berbeda dari header
  - `GET /no-coa` — entry lines dengan account_id null atau COA tidak aktif
- [ ] **F3.2** `routes/tax.ts` — tambah endpoint:
  - `GET /npwp-missing` — `transaction_taxes` di mana npwp IS NULL atau ''
  - `GET /faktur-missing` — PPN output tanpa `faktur_pajak_number`, PPh tanpa `bukti_potong_number`
  - `GET /unposted` — status 'calculated' (hitung sudah, posting belum)
  - `GET /unpaid` — status 'posted' atau 'reported' tapi belum paid
- [ ] **F3.3** `routes/payments.ts`: `GET /reconciliation/ar-unmatched` dan `GET /reconciliation/ar-partial`
- [ ] **F3.4** `routes/vendorPayments.ts`: `GET /reconciliation/ap-unmatched`

### Fase 4 — Frontend Monitoring & Laporan *(Estimasi: 2 hari)*
**Tujuan:** Semua laporan tersedia dan bisa diaksi di UI.

- [ ] **F4.1** Halaman baru `pages/accounting/audit-report.tsx`:
  - Tab: Transaksi Tanpa Jurnal | Jurnal Tidak Balance | Cross-Company | COA Tidak Valid
  - Tombol "Repost" untuk yang bisa di-repost otomatis
  - Export CSV
- [ ] **F4.2** Halaman baru `pages/tax/missing-compliance.tsx`:
  - Tab: Tanpa NPWP | Tanpa Faktur Pajak | Belum Diposting | Belum Dibayar
  - Filter per periode, modul, company
  - Inline edit untuk isi NPWP / nomor faktur
  - Export Excel
- [ ] **F4.3** Halaman baru `pages/accounting/reconciliation-ar.tsx`:
  - Daftar invoice belum lunas (unmatched)
  - Daftar bayar sebagian (partial match)
  - Manual link payment ke invoice
  - Aging report AR (0-30, 31-60, 61-90, >90 hari)
- [ ] **F4.4** Halaman baru `pages/accounting/reconciliation-ap.tsx`:
  - Daftar vendor bill belum dibayar
  - Aging report AP
- [ ] **F4.5** Update `pages/tax/ppn.tsx`: tambah kolom `faktur_pajak_number`, filter missing
- [ ] **F4.6** Update `pages/tax/pph.tsx`: detail per karyawan (PPh 21), export PDF

### Fase 5 — Hardening & Export PDF *(Estimasi: 1 hari)*
**Tujuan:** Keandalan, kelengkapan output, dan ketahanan sistem.

- [ ] **F5.1** `lib/rekonsiliasiWorker.ts`: tambah tabel `bank_reconciliation_items` di DB sebagai fallback penyimpanan hasil rekonsiliasi
- [ ] **F5.2** Export PDF menggunakan `@react-pdf/renderer` untuk: SPT Masa PPN, PPh 21, PPh 23
- [ ] **F5.3** Halaman detail PPh 21 per karyawan per periode
- [ ] **F5.4** Regression test: verifikasi semua jurnal balance setelah implementasi fase 1–4

---

## Lampiran: Peta Alur Jurnal Saat Ini

```
PENJUALAN:
  Confirm SO      → postSalesInvoice()         : DR Piutang Dagang   / CR Pendapatan + CR PPN Keluaran
  Delivery        → postSalesCogs()            : DR HPP              / CR Persediaan
  Payment recv.   → postSalesPayment()         : DR Kas/Bank         / CR Piutang Dagang
  Cancel          → postSalesInvoiceReversal() : Semua di-balik (idempoten via sourceId)
  Return          → postSalesReturn()          : Credit note + COGS reversal

PEMBELIAN:
  Receive barang  → postStockIn()              : DR Persediaan       / CR Titipan GRN
  Bill posting    → postPurchaseBill()         : DR Expense/Inventory + DR PPN Masukan / CR Hutang Vendor
  Vendor payment  → postVendorPayment()        : DR Hutang Vendor    / CR Kas/Bank
  Cancel bill     → postPurchaseBillReversal() : Semua di-balik (idempoten)

LOGISTIK:
  Revenue posting → postLogisticSalesInvoice()      : DR Piutang   / CR Revenue (per service type)
  Vendor cost     → postLogisticVendorCostJournal() : DR COGS      / CR Hutang Vendor

KASBON:
  Disbursement    →                            : DR Piutang Karyawan / CR Kas/Bank
  Repayment       →                            : DR Kas/Bank         / CR Piutang Karyawan

PINJAMAN BANK:
  Disbursement    →                            : DR Kas/Bank        / CR Hutang Bank (+ admin fee → DR Biaya Bunga)
  Repayment       →                            : DR Hutang Pokok + DR Biaya Bunga / CR Kas/Bank

ASET TETAP:
  Purchase        →                            : DR Aset Tetap      / CR Kas/Bank
  Depreciation    →                            : DR Beban Penyusutan / CR Akumulasi Depresiasi
```

---

## Lampiran: Status Audit per Poin Permintaan

| # | Permintaan Audit | Status |
|---|-----------------|--------|
| 1 | Audit Alur Penjualan | ✅ Alur benar, jurnal lengkap, reversal ada. Gap: audit trail field |
| 2 | Audit Alur Pembelian | ✅ Alur benar, jurnal lengkap, reversal ada. Gap: created_by_id tidak ada |
| 3 | Audit Penerimaan | ✅ Payment journaling ada. Gap: AR unmatched report belum ada |
| 4 | Audit Pengeluaran | ✅ Expense journaling ada. Gap: PPh 23 tidak selalu direkam |
| 5 | Audit Accounting Posting | ⚠️ Hanya expenses punya missing-journal check. Modul lain belum ada |
| 6 | Audit Pajak | ⚠️ Tax engine ada tapi field faktur/bukti potong & status lengkap belum ada |
| 7 | Audit Laporan Pajak | ⚠️ SPT/PPN/PPh ada, tapi laporan compliance (tanpa NPWP/faktur) belum ada |
| 8 | Audit Rekonsiliasi | ⚠️ Bank rekonsiliasi ada tapi AR/AP formal belum ada |
| 9 | Audit Trail | ⚠️ erp_audit_logs ada, tapi field di tabel transaksi tidak lengkap |
| 10 | Output Laporan Audit | ✅ Laporan ini (AUDIT_ACCOUNTING_TAX_REPORT.md) |

---

*Laporan ini hasil audit otomatis berdasarkan analisis kode sumber secara menyeluruh. Lanjutkan implementasi per fase setelah laporan di-review dan disetujui.*
