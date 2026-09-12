# Audit Modul ERP/Accounting — Overlap & Restrukturisasi

**Tanggal:** 2026-07-07  
**Auditor:** Agent (automated codebase analysis)  
**Scope:** BizPortal + API Server — modul keuangan  
**Instruksi:** Laporan saja, tidak ada perubahan kode.

---

## Bagian 1 — Daftar Semua Modul/Menu/Form yang Ditemukan

### 1.1 Navigation Tree BizPortal (Aktual)

```
Finance Hub (/finance)
├── Finance Hub Dashboard          /finance
├── Allocation Center              /finance/allocation
├── Bank Allocation                /finance/bank-allocation
├── Advance Management             /finance/advances
├── Kas & Bank                     /accounting/kas-bank
├── Bank Disbursement              /accounting/bank-disbursements
├── Bank Receipt                   /accounting/bank-receipts
└── Tax (Dashboard/Audit/Setup/DJP) /tax/*, /accounting/taxes

Biaya Operasional (/expense)
├── Daftar Biaya (Expense List)    /expense
├── Kasbon Karyawan                /expense/kasbon
├── Dana Talangan (Audit COA)      /expense/audit-dana-talangan
├── Anggaran / Budget              /expense/budget
└── Audit Disbursement             /expense/audit-disbursement

Cash & Bank (/cash-bank)
├── Transfer Antar Rekening        /cash-bank/transfers
└── Rekonsiliasi Bank              /cash-bank/reconciliation
```

### 1.2 Entry Point Transaksi Keuangan yang Ditemukan

| # | Entry Point | Path | API Endpoint | Keterangan |
|---|---|---|---|---|
| 1 | Buat Expense | `/expense/new` | `POST /api/expenses` | Form biaya operasional |
| 2 | Kasbon Karyawan | `/expense/kasbon` | `POST /api/advances` | Uang muka karyawan |
| 3 | Bank Disbursement — type=expense | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | Pengeluaran langsung via bank |
| 4 | Bank Disbursement — type=employee_advance | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | Kasbon via bank disbursement |
| 5 | Bank Disbursement — type=supplier_payment | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | Bayar vendor via BD |
| 6 | Bank Disbursement — type=loan_payment | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | Bayar cicilan pinjaman via BD |
| 7 | Bank Disbursement — type=tax_payment | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | Bayar pajak via BD |
| 8 | Bank Disbursement — type=vendor_invoice | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | Bayar invoice vendor via BD |
| 9 | Bank Disbursement — type=equity_withdrawal | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | Penarikan modal |
| 10 | Bank Disbursement — type=fund_transfer | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | Transfer internal |
| 11 | Bank Disbursement — type=other | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | Lain-lain |
| 12 | Bank Receipt — customer_payment | `/accounting/bank-receipts` | `POST /api/bank-receipts` | Penerimaan dari pelanggan |
| 13 | Bank Receipt — kasbon_return | `/accounting/bank-receipts` | `POST /api/bank-receipts` | Pengembalian kasbon via BR |
| 14 | Bank Receipt — other_income | `/accounting/bank-receipts` | `POST /api/bank-receipts` | Pendapatan lain-lain |
| 15 | Bank Receipt — equity_injection | `/accounting/bank-receipts` | `POST /api/bank-receipts` | Setoran modal |
| 16 | Bank Receipt — loan_receipt | `/accounting/bank-receipts` | `POST /api/bank-receipts` | Penerimaan pinjaman |
| 17 | Advance Settle | `POST /api/advances/:id/settle` | `POST /api/advances/:id/settle` | Settlement kasbon (setor nota) |
| 18 | Advance Repay | `POST /api/advances/:id/repay` | `POST /api/advances/:id/repay` | Kembalikan sisa kasbon |
| 19 | Expense Pay | `POST /api/expenses/:id/pay` | `POST /api/expenses/:id/pay` | Bayar expense, auto-buat BD |
| 20 | Petty Cash — ADVANCE | `/accounting/kas-bank` | `POST /api/cash-bank/petty-cash` | Kasbon via kas kecil |
| 21 | Petty Cash — EXPENSE | `/accounting/kas-bank` | `POST /api/cash-bank/petty-cash` | Pengeluaran via kas kecil |
| 22 | Petty Cash — REIMBURSEMENT | `/accounting/kas-bank` | `POST /api/cash-bank/petty-cash` | Reimburse via kas kecil |
| 23 | Petty Cash — SETTLEMENT | `/accounting/kas-bank` | `POST /api/cash-bank/petty-cash` | Settlement via kas kecil |
| 24 | Transfer Antar Rekening | `/cash-bank/transfers` | `POST /api/kas-bank/transfers` | Transfer internal bank |
| 25 | Advance Management | `/finance/advances` | `POST /api/advances` | Kasbon via Finance Hub |
| 26 | Expenses with type=kasbon | `/expense` | `POST /api/expenses` | Kasbon diinput via form expense |
| 27 | Expenses with type=talangan | `/expense` | `POST /api/expenses` | Dana talangan via form expense |
| 28 | Expenses with type=reimbursement | `/expense` | `POST /api/expenses` | Reimbursement via form expense |
| 29 | Loan Module — Repayment | `/finance` (inferred) | `bankLoans.ts` | Cicilan pinjaman |
| 30 | Allocation Center | `/finance/allocation` | `POST /api/allocation` | Alokasi penerimaan |

---

## Bagian 2 — Daftar Overlap & Duplikasi Fungsi

### ⚠️ OVERLAP 1 — Kasbon Karyawan (4 entry point berbeda)

| Entry Point | Route | API | Tabel |
|---|---|---|---|
| Biaya Operasional > Kasbon | `/expense/kasbon` | `POST /api/advances` | `cash_advances` |
| Finance Hub > Advance Management | `/finance/advances` | `POST /api/advances` | `cash_advances` |
| Bank Disbursement > type=employee_advance | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | `bank_disbursements` |
| Kas & Bank > Petty Cash > ADVANCE | `/accounting/kas-bank` | `POST /api/cash-bank/petty-cash` | `petty_cash_transactions` |
| Expense Form > expense_type=kasbon | `/expense/new` | `POST /api/expenses` | `expenses` |

**Dampak:** Data kasbon tersebar di 4 tabel berbeda (`cash_advances`, `bank_disbursements`, `petty_cash_transactions`, `expenses`). Tidak ada single source of truth. Laporan kasbon tidak akan konsisten.

---

### ⚠️ OVERLAP 2 — Dana Talangan (3 entry point, 2 tabel)

| Entry Point | Route | API | Tabel |
|---|---|---|---|
| Biaya Operasional > Kasbon (type=talangan) | `/expense/kasbon` | `POST /api/advances` | `cash_advances` (type='talangan') |
| Expense Form > expense_type=talangan | `/expense/new` | `POST /api/expenses` | `expenses` |
| Dana Talangan > Audit COA | `/expense/audit-dana-talangan` | (audit/view only?) | `cash_advances` (view) |

**Dampak:** Dana talangan dan kasbon menggunakan tabel yang sama (`cash_advances` dengan kolom `type`), tapi juga bisa masuk via `expenses`. Tidak ada UI yang membedakan keduanya secara tegas.

---

### ⚠️ OVERLAP 3 — Reimbursement (3 entry point, 2–3 tabel)

| Entry Point | Route | API | Tabel |
|---|---|---|---|
| Expense Form > type=reimbursement | `/expense/new` | `POST /api/expenses` | `expenses` |
| Kas & Bank > Petty Cash > REIMBURSEMENT | `/accounting/kas-bank` | `POST /api/cash-bank/petty-cash` | `petty_cash_transactions` |
| Bank Mutation Import > class=REIMBURSEMENT | Import flow | `bankMutationImport.ts` | `bank_mutations` |

**Dampak:** Tidak ada modul reimbursement yang berdiri sendiri. Reimbursement tersebar di expense form, petty cash, dan mutation import. Tidak ada approval flow khusus untuk reimbursement.

---

### ⚠️ OVERLAP 4 — Pengeluaran/Expense (3 entry point berbeda)

| Entry Point | Route | API | Tabel |
|---|---|---|---|
| Biaya Operasional > Daftar Biaya | `/expense/new` | `POST /api/expenses` | `expenses` |
| Bank Disbursement > type=expense | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | `bank_disbursements` |
| Kas & Bank > Petty Cash > EXPENSE | `/accounting/kas-bank` | `POST /api/cash-bank/petty-cash` | `petty_cash_transactions` |

**Dampak:** User bisa memasukkan pengeluaran tanpa melalui modul biaya operasional, melewati workflow approval dan budget tracking. Bank Disbursement > type=expense tidak terhubung ke `expenses` table, sehingga laporan biaya tidak akurat.

---

### ⚠️ OVERLAP 5 — Vendor Payment (3 entry point)

| Entry Point | Route | API | Tabel |
|---|---|---|---|
| Bank Disbursement > type=vendor_invoice | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | `bank_disbursements` + link ke `vendor_invoices` |
| Bank Disbursement > type=supplier_payment | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | `bank_disbursements` (tanpa link invoice) |
| Vendor Installments Module | (inferred) | `vendor_installments.ts` | `vendor_installments`, `vendor_installment_payments` |

**Dampak:** Pembayaran vendor bisa dilakukan tanpa invoice terkait (bypass hutang dagang). Akun AP tidak selalu ter-debit saat payment. Dua channel payment yang berbeda untuk satu tujuan.

---

### ⚠️ OVERLAP 6 — Pengembalian Kasbon / Kasbon Return (2 entry point)

| Entry Point | Route | API | Tabel |
|---|---|---|---|
| Biaya Operasional > Kasbon > Repay | `/expense/kasbon` | `POST /api/advances/:id/repay` | `cash_advance_repayments` |
| Bank Receipt > type=kasbon_return | `/accounting/bank-receipts` | `POST /api/bank-receipts` | `bank_receipts` |

**Dampak:** Jika kasbon dikembalikan via Bank Receipt tanpa link ke `cash_advances`, saldo kasbon karyawan tidak ter-update. Risiko saldo piutang karyawan ghost.

---

### ⚠️ OVERLAP 7 — Pembayaran Pinjaman/Cicilan (2 entry point)

| Entry Point | Route | API | Tabel |
|---|---|---|---|
| Loan Module — Repayment | Finance/Bank Loans page | `bankLoans.ts` | `bank_loan_payments` |
| Bank Disbursement > type=loan_payment | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | `bank_disbursements` |

**Dampak:** Jika cicilan dibayar via Bank Disbursement (tanpa link ke `bank_loans`), saldo pinjaman tidak berkurang. Outstanding loan di laporan akan salah.

---

### ⚠️ OVERLAP 8 — Pembayaran Pajak (2 entry point)

| Entry Point | Route | API | Tabel |
|---|---|---|---|
| Tax Module — Payment | `/tax/*` | `tax.ts` | `transaction_taxes` |
| Bank Disbursement > type=tax_payment | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` | `bank_disbursements` |

**Dampak:** Pajak yang dibayar via Bank Disbursement mungkin tidak terhubung ke `transaction_taxes`, sehingga SPT tidak akurat.

---

### ⚠️ OVERLAP 9 — Transfer Antar Rekening (2 entry point)

| Entry Point | Route | API |
|---|---|---|
| Cash & Bank > Transfer | `/cash-bank/transfers` | `POST /api/kas-bank/transfers` |
| Bank Disbursement > type=fund_transfer | `/accounting/bank-disbursements` | `POST /api/accounting/bank-disbursements` |

**Dampak:** Duplikasi minor — keduanya harusnya menghasilkan hasil yang sama, tapi bisa menyebabkan double-entry.

---

### ⚠️ OVERLAP 10 — Penerimaan Pelanggan (Customer Receipt + Allocation)

| Entry Point | Route | API | Keterangan |
|---|---|---|---|
| Bank Receipt > customer_payment | `/accounting/bank-receipts` | `POST /api/bank-receipts` | Auto-apply ke AR subledger |
| Allocation Center | `/finance/allocation` | `POST /api/allocation` | Alokasi penerimaan manual |
| Bank Allocation | `/finance/bank-allocation` | (separate module) | Alokasi dari bank mutation |

**Dampak:** Tiga cara mencatat penerimaan pelanggan. Tidak jelas kapan pakai mana.

---

## Bagian 3 — Tabel Mapping Lengkap

| Proses Bisnis | Entry Point Saat Ini | Masalah | Source of Truth yang Disarankan | Modul Final | Tabel Utama | Tabel Posting Bank/Jurnal |
|---|---|---|---|---|---|---|
| **Kasbon Karyawan** | 5 entry point: Expense/kasbon, Finance/advances, Bank Disb/employee_advance, Petty Cash/ADVANCE, Expense form/type=kasbon | Data tersebar di 4 tabel berbeda; tidak ada single source of truth; laporan kasbon tidak akurat | `cash_advances` | Biaya Operasional > Kasbon Karyawan | `cash_advances` | `bank_disbursements` (auto, source_type='cash_advance'), `accounting_entries` |
| **Dana Talangan** | 3 entry point: Advances (type=talangan), Expense form, Audit page | Sama dengan kasbon tapi dibedakan hanya oleh type flag; tidak ada UI yang tegas | `cash_advances` (type=talangan) ATAU digabung ke `employee_fund_requests` | Biaya Operasional > Dana Karyawan > Dana Talangan | `cash_advances` / `employee_fund_requests` | `bank_disbursements` (auto), `accounting_entries` |
| **Reimbursement** | 3 entry point: Expense/reimbursement, Petty Cash, Mutation Import | Tidak ada modul dedicated; tidak ada approval flow khusus | `expenses` (expense_type=reimbursement) ATAU tabel baru | Biaya Operasional > Reimbursement | `expenses` atau `employee_fund_requests` | `bank_disbursements` (auto, setelah approved) |
| **Pengeluaran Operasional** | 3 entry point: Expense form, Bank Disb/expense, Petty Cash/EXPENSE | Pengeluaran bisa bypass approval & budget via Bank Disbursement | `expenses` | Biaya Operasional > Daftar Biaya | `expenses` | `bank_disbursements` (auto via /pay), `accounting_entries` |
| **Pembayaran Vendor** | 3 entry point: Bank Disb/vendor_invoice, Bank Disb/supplier_payment, Vendor Installments | Bisa bayar vendor tanpa invoice; AP tidak selalu di-debit; 2 channel berbeda | `vendor_invoices` + `vendor_payments` | Pembelian > Invoice Vendor > Bayar | `vendor_invoices`, `vendor_payments` | `bank_disbursements` (auto, source_type='vendor_payment'), `accounting_entries` |
| **Pengembalian Kasbon** | 2 entry point: Advances/repay, Bank Receipt/kasbon_return | Bank Receipt tidak selalu update saldo di `cash_advances` | `cash_advance_repayments` | Biaya Operasional > Kasbon > Kembalikan | `cash_advance_repayments` | `bank_receipts` (auto), `accounting_entries` |
| **Pembayaran Cicilan Pinjaman** | 2 entry point: Loan module, Bank Disb/loan_payment | BD loan_payment tidak selalu update `bank_loans.outstanding_amount` | `bank_loan_payments` | Keuangan > Pinjaman > Bayar Cicilan | `bank_loans`, `bank_loan_payments` | `bank_disbursements` (auto), `accounting_entries` |
| **Pembayaran Pajak** | 2 entry point: Tax module, Bank Disb/tax_payment | BD tax_payment tidak terhubung ke `transaction_taxes` | `transaction_taxes` | Pajak > Bayar Pajak | `transaction_taxes`, `tax_periods` | `bank_disbursements` (auto), `accounting_entries` |
| **Transfer Antar Rekening** | 2 entry point: Cash&Bank/transfer, Bank Disb/fund_transfer | Potensi double-entry | `fund_transfers` | Kas & Bank > Transfer | `fund_transfers` | `bank_disbursements` + `bank_receipts` (auto, pasangan) |
| **Penerimaan Pelanggan** | 3 entry point: Bank Receipt/customer_payment, Allocation Center, Bank Allocation | Tiga cara berbeda; tidak jelas kapan pakai mana | `bank_receipts` + `ar_subledger` | Penjualan > Invoice > Terima Pembayaran | `bank_receipts`, `accounting_entry_lines` | `bank_receipts` (auto-apply AR) |
| **Setoran/Penarikan Modal** | Bank Disb/equity_withdrawal, Bank Receipt/equity_injection | Sudah benar — ini murni transaksi bank | `bank_disbursements` / `bank_receipts` | Finance Hub > Jurnal Manual ATAU Bank | `bank_disbursements` / `bank_receipts` | `accounting_entries` |
| **Bunga Bank / Biaya Bank** | Bank Disb/other, Petty Cash/other | Tidak ada kategori khusus | `bank_disbursements` | Bank Disbursement > Biaya Bank | `bank_disbursements` | `accounting_entries` |

---

## Bagian 4 — Rekomendasi Menu Final

### Prinsip Desain
> "User harus menjawab pertanyaan: _Saya mau melakukan apa?_ — bukan _Saya mau input ke tabel apa?_"

### Struktur Menu yang Disarankan

```
🏢 BIAYA OPERASIONAL
├── Daftar Biaya (Expense)           ← semua pengeluaran operasional
├── Dana Karyawan                    ← gabungan kasbon + talangan + reimbursement
│   ├── Kasbon Karyawan              ← source of truth: cash_advances (type=kasbon)
│   ├── Dana Talangan                ← source of truth: cash_advances (type=talangan)
│   └── Reimbursement                ← source of truth: expenses (type=reimbursement)
└── Anggaran (Budget)

💼 PEMBELIAN & HUTANG
├── Invoice Vendor                   ← source of truth: vendor_invoices
├── Pembayaran Vendor                ← dari invoice; auto-buat bank disbursement
└── Hutang Dagang (AP Aging)

📦 PENJUALAN & PIUTANG
├── Invoice Pelanggan                ← source of truth: sales_documents
├── Penerimaan Pembayaran            ← dari invoice; auto-buat bank receipt
└── Piutang Dagang (AR Aging)

🏦 KAS & BANK
├── Transfer Antar Rekening          ← satu-satunya cara transfer
├── Bank Disbursement                ← HANYA untuk: modal, bunga, biaya bank, setoran
├── Bank Receipt                     ← HANYA untuk: penerimaan modal, bunga, lain-lain
└── Rekonsiliasi Bank

💰 PINJAMAN
├── Daftar Pinjaman
└── Bayar Cicilan                    ← dari modul pinjaman; auto-buat bank disbursement

🧾 PAJAK
├── Dashboard Pajak
├── Bayar Pajak                      ← dari modul pajak; auto-buat bank disbursement
└── Ekspor SPT / DJP

📊 JURNAL & LAPORAN
├── Jurnal Manual (Journal Entry)
├── Allocation Center
└── Budget Tracking

⚙️ APPROVAL
└── Pusat Approval                   ← semua approval dari semua modul di satu tempat
```

### Apa yang Dihapus/Dilarang

| Item | Rekomendasi |
|---|---|
| Bank Disbursement > employee_advance | ❌ Hapus — kasbon harus dari Dana Karyawan |
| Bank Disbursement > expense | ❌ Hapus — pengeluaran harus dari Daftar Biaya |
| Bank Disbursement > supplier_payment (tanpa invoice) | ❌ Hapus — pembayaran vendor harus dari Invoice Vendor |
| Bank Disbursement > loan_payment (standalone) | ❌ Hapus — cicilan harus dari modul Pinjaman |
| Bank Disbursement > tax_payment (standalone) | ❌ Hapus — pajak harus dari modul Pajak |
| Petty Cash > ADVANCE | ❌ Hapus — kasbon via petty cash harus melalui Dana Karyawan |
| Expense form > type=kasbon/talangan | ❌ Hapus — pisahkan ke Dana Karyawan |
| Bank Receipt > kasbon_return | ❌ Hapus — pengembalian kasbon harus dari modul kasbon |
| Finance Hub > Advance Management | 🔀 Redirect ke Biaya Operasional > Dana Karyawan |
| Bank Allocation vs Allocation Center | 🔀 Evaluasi — gabungkan ke satu tempat |

---

## Bagian 5 — Rekomendasi Perubahan Database Minimal

### 5.1 Tambah Kolom Referensi ke bank_disbursements (CRITICAL)

```sql
-- Sudah ada source_module + source_id di bankDisbursements, pastikan KONSISTEN dipakai
-- Tambahkan constraint agar BD yang dibuat dari business object selalu punya source_id
ALTER TABLE bank_disbursements
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50),  -- 'cash_advance', 'expense', 'vendor_payment', 'loan', 'tax'
  ADD COLUMN IF NOT EXISTS source_id INTEGER;        -- FK ke tabel sumber

-- Tambahkan constraint: jika bukan 'bank_general', source_id wajib ada
-- (implementasi via CHECK atau trigger)
```

### 5.2 Konsolidasi Dana Karyawan (OPTIONAL, high impact)

```sql
-- Opsi: buat tabel unified untuk semua dana karyawan
CREATE TABLE IF NOT EXISTS employee_fund_requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  request_type VARCHAR(20) NOT NULL,  -- 'kasbon', 'talangan', 'reimbursement', 'operational_advance'
  employee_id INTEGER,
  party_name VARCHAR(255),
  amount NUMERIC(14,2) NOT NULL,
  paid_amount NUMERIC(14,2) DEFAULT 0,
  remaining_amount NUMERIC(14,2),
  status VARCHAR(30) DEFAULT 'draft',  -- draft, submitted, approved, disbursed, settled, repaid, voided
  settlement_deadline DATE,
  notes TEXT,
  bank_account_id INTEGER,
  journal_entry_id INTEGER,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
-- Migrasi: cash_advances → employee_fund_requests (data lama tetap di cash_advances, view layer merge)
```

### 5.3 Blokir Akses Langsung BD untuk Business Objects (CRITICAL)

```sql
-- Tambah flag di bank_disbursements untuk distinguishing "business object disbursement" 
-- vs "direct bank transaction"
-- Field yang sudah ada (source_module, source_id) harus di-enforce via API layer, bukan DB
-- Rekomendasi: tambah enum constraint pada transaction_type

-- Kategorikan ulang transaction_type:
-- BANK_ONLY (boleh manual dari BD UI): fund_transfer, equity_withdrawal, bank_fee, bank_interest, other
-- BUSINESS_OBJECT (hanya via auto-generate): expense, employee_advance, supplier_payment, loan_payment, tax_payment
```

### 5.4 Tabel yang TIDAK Perlu Diubah (data lama aman)

- `cash_advances` — tetap, tambah view `v_employee_funds` yang merge dengan `expenses`
- `bank_disbursements` — tetap, tambah constraint kolom
- `expenses` — tetap, hapus type kasbon/talangan dari enum (deprecate)
- `accounting_entries` — tidak berubah sama sekali

---

## Bagian 6 — Rekomendasi Perubahan UI/UX

### 6.1 Prioritas Tinggi (Quick Wins)

| # | Perubahan | Dampak | Effort |
|---|---|---|---|
| 1 | Hapus opsi `employee_advance` dari dropdown tipe Bank Disbursement | Menutup entry point duplikat kasbon | Rendah |
| 2 | Hapus opsi `expense` dari dropdown tipe Bank Disbursement | Menutup entry point duplikat expense | Rendah |
| 3 | Pada Bank Disbursement > `supplier_payment`, wajibkan pilih invoice (FK) | Mencegah pembayaran vendor tanpa hutang | Sedang |
| 4 | Pada Bank Disbursement > `loan_payment`, wajibkan pilih pinjaman yang ada | Mencegah cicilan orphan | Sedang |
| 5 | Pada Bank Disbursement > `tax_payment`, link ke tax period yang ada | Mencegah pajak orphan | Sedang |
| 6 | Hapus `kasbon_return` dari tipe Bank Receipt | Pengembalian kasbon harus via modul kasbon | Rendah |

### 6.2 Prioritas Sedang (Refactor UI)

| # | Perubahan | Dampak |
|---|---|---|
| 7 | Gabungkan menu Kasbon + Dana Talangan ke satu menu "Dana Karyawan" dengan tabs | UX lebih jelas |
| 8 | Tambahkan tab "Reimbursement" di Dana Karyawan | Consolidate entry point |
| 9 | Pisahkan Finance Hub > Advance Management → redirect ke Biaya Operasional | Hapus duplikasi menu |
| 10 | Pada halaman Bank Disbursement, tampilkan banner: "Untuk kasbon/expense, gunakan modul terkait" | Edukasi user |
| 11 | Tambahkan wizard di halaman Bank Disbursement: "Apa yang ingin Anda catat?" → routing ke modul yang tepat | Prevent misuse |
| 12 | Tambahkan approval status badge di semua daftar transaksi bisnis | Visibility |

### 6.3 Prioritas Rendah (Long Term)

| # | Perubahan |
|---|---|
| 13 | Single Approval Center — semua approval dari semua modul di satu halaman |
| 14 | Cash flow dashboard yang mengagregasi data dari semua tabel (bukan hanya BD) |
| 15 | Notifikasi otomatis ke manager saat kasbon/talangan melewati batas approval |

---

## Bagian 7 — Risiko Perubahan

| Risiko | Level | Mitigasi |
|---|---|---|
| Data lama di bank_disbursements dengan type=employee_advance tidak punya referensi ke cash_advances | 🔴 HIGH | Jalankan migration script untuk match berdasarkan party_name + amount + date sebelum mengubah UI |
| Menghapus opsi dari dropdown BD bisa break workflow user yang terbiasa | 🟡 MEDIUM | Phase out bertahap: deprecation warning dulu (1 bulan), baru hapus |
| Expense report sudah ada yang mengambil dari bank_disbursements langsung (bukan expenses) | 🟡 MEDIUM | Audit semua query/report yang join bank_disbursements sebelum mengubah |
| Menggabungkan kasbon + talangan ke satu table baru memerlukan data migration | 🟡 MEDIUM | Buat view dulu (tidak migrasi data), baru migrasi setelah UI stabil |
| Approval workflow yang sudah running untuk expense/kasbon bisa terputus | 🔴 HIGH | Jangan ubah status enum atau tabel approval sebelum mapping selesai |
| Rekonsiliasi bank yang sudah match ke bank_disbursements orphan bisa salah | 🟡 MEDIUM | Flag matched BD sebagai immutable, jangan hapus record lama |
| User yang terbiasa input kasbon via BD akan protes | 🟢 LOW | Training + in-app tooltip |

---

## Bagian 8 — Rencana Refactor Bertahap

### Phase 0 — Persiapan (tanpa ubah kode) — 1 minggu
- [ ] Audit data: query semua bank_disbursements dengan type=employee_advance yang tidak punya source_id referensi ke cash_advances
- [ ] Audit data: query semua bank_disbursements dengan type=expense yang tidak punya source_id referensi ke expenses
- [ ] Dokumentasikan semua report/dashboard yang mengambil data dari bank_disbursements langsung
- [ ] Identifikasi user mana yang aktif menggunakan BD sebagai entry point kasbon/expense

### Phase 1 — Enforce Linkage (API layer, tidak ubah UI) — 2 minggu
- [ ] Tambah kolom `auto_generated BOOLEAN DEFAULT FALSE` ke `bank_disbursements`
- [ ] Saat kasbon diapprove dan dicairkan, pastikan BD yang dibuat punya `source_type='cash_advance'` dan `source_id=cash_advances.id`
- [ ] Saat expense dibayar via `/pay`, pastikan BD yang dibuat punya `source_type='expense'` dan `source_id=expenses.id`
- [ ] Saat vendor invoice dibayar, pastikan BD punya `source_type='vendor_payment'`
- [ ] Saat cicilan pinjaman dibayar dari loan module, pastikan BD punya `source_type='bank_loan'`

### Phase 2 — Deprecate Entry Points di UI — 3 minggu
- [ ] Tambahkan warning banner di Bank Disbursement untuk type=employee_advance/expense/supplier_payment/loan_payment/tax_payment: "⚠️ Untuk kasbon, gunakan Biaya Operasional > Kasbon. Opsi ini akan dihapus."
- [ ] Tambahkan warning banner di Bank Receipt untuk type=kasbon_return
- [ ] Tambahkan redirect wizard: klik "Kasbon" di BD → redirect ke `/expense/kasbon`
- [ ] Gabungkan menu Kasbon + Dana Talangan di nav → "Dana Karyawan"

### Phase 3 — Hapus Entry Points Duplikat — 2 minggu
- [ ] Hapus opsi `employee_advance` dari Bank Disbursement create form
- [ ] Hapus opsi `expense` (direct, bukan linked) dari Bank Disbursement create form
- [ ] Hapus opsi `kasbon_return` dari Bank Receipt create form
- [ ] Hapus expense_type `kasbon` dan `talangan` dari expense create form

### Phase 4 — Konsolidasi Dana Karyawan (Optional) — 4 minggu
- [ ] Evaluasi apakah perlu `employee_fund_requests` unified table atau cukup dengan view
- [ ] Buat view `v_employee_funds` yang UNION dari `cash_advances` + `expenses` (type=reimbursement)
- [ ] Tampilkan view ini di halaman Dana Karyawan
- [ ] Setelah stabil, pertimbangkan migrasi ke tabel terpadu

### Phase 5 — Audit & Cleanup — 2 minggu
- [ ] Verifikasi semua report mengambil data dari source of truth, bukan dari BD
- [ ] Hapus kolom/enum yang sudah deprecated
- [ ] Update dokumentasi API

---

## Bagian 9 — File/Component/API/Service yang Perlu Diubah

### API Server (artifacts/api-server/src)

| File | Perubahan |
|---|---|
| `routes/bankDisbursements.ts` | Hapus/restrict type=employee_advance, expense (non-linked), tambah source_id enforcement |
| `routes/bankReceipts.ts` | Hapus/restrict type=kasbon_return, redirect ke advance repay |
| `routes/expenses.ts` | Hapus expense_type kasbon/talangan dari CREATE, tambah auto-BD creation saat status=paid |
| `routes/advances.ts` | Pastikan disbursement auto-create BD dengan source_type='cash_advance' |
| `routes/cashAdvances.ts` | Sama seperti advances.ts |
| `routes/bankLoans.ts` | Pastikan loan repayment auto-create BD dengan source_type='bank_loan' |
| `routes/tax.ts` | Pastikan tax payment auto-create BD dengan source_type='tax_payment' |
| `routes/kasBank.ts` | Hapus ADVANCE, EXPENSE, REIMBURSEMENT dari petty cash types (atau restrict ke amount kecil) |
| `routes/index.ts` | Tidak ada perubahan besar — routing tetap sama |
| `lib/accounting.ts` | Pastikan PostingInput.sourceModule konsisten dengan source_type di BD |

### BizPortal (artifacts/bizportal/src)

| File | Perubahan |
|---|---|
| `pages/accounting/bank-disbursements.tsx` | Hapus/sembunyikan option employee_advance, expense, loan_payment, tax_payment dari dropdown; tambah warning banner |
| `pages/accounting/bank-receipts.tsx` | Hapus/sembunyikan option kasbon_return; tambah link ke modul kasbon |
| `pages/expense/kasbon.tsx` | Tambahkan tabs: Kasbon / Dana Talangan / Reimbursement |
| `pages/expense/audit-dana-talangan.tsx` | Evaluasi — apakah masih relevan setelah konsolidasi? |
| `pages/finance/advances.tsx` | Redirect atau merge ke kasbon page |
| `components/layout/Sidebar.tsx` (atau nav config) | Restrukturisasi menu sesuai rekomendasi |

### Database

| Tabel | Perubahan |
|---|---|
| `bank_disbursements` | Tambah `auto_generated BOOLEAN`, pastikan `source_type` + `source_id` dipakai konsisten |
| `bank_receipts` | Tambah `auto_generated BOOLEAN`, `source_type`, `source_id` |
| `expenses` | Deprecate `expense_type` IN ('kasbon', 'talangan') — tambah warning di API |
| `cash_advances` | Tidak berubah (jadi source of truth) |
| `petty_cash_transactions` | Review tipe transaksi yang diizinkan |
| *(baru)* `employee_fund_requests` | Hanya jika Phase 4 jalan — tabel unified |

---

## Bagian 10 — Ringkasan Eksekutif

### Temuan Kritis

**Sistem ini punya 10 area overlap**, dengan yang paling kritis adalah:

1. **Kasbon** bisa dibuat dari 5 tempat berbeda dan tersimpan di 4 tabel berbeda → laporan kasbon tidak bisa dipercaya
2. **Expense/Biaya Operasional** bisa bypass approval dan budget via Bank Disbursement → budget control tidak efektif
3. **Pembayaran Vendor** bisa dilakukan tanpa invoice → AP aging tidak akurat
4. **Cicilan Pinjaman** dibayar via Bank Disbursement tidak selalu update saldo pinjaman
5. **Pembayaran Pajak** via Bank Disbursement tidak terhubung ke SPT

### Root Cause

Bank Disbursement dijadikan "Swiss Army Knife" — satu modul untuk semua jenis transaksi — padahal seharusnya hanya untuk **arus kas bank murni** (transfer, modal, biaya bank).

### Solusi Inti

```
Business Object Module  →  Approval  →  Auto-generate Bank Posting
(Kasbon, Expense, etc.)                  (bank_disbursements/receipts)
```

Bukan:
```
Bank Disbursement  →  (langsung ke akun, tanpa lifecycle business object)
```

### Prioritas Tindakan

| Prioritas | Aksi | Dampak |
|---|---|---|
| 🔴 P0 — Segera | Tambah `source_id` enforcement di API untuk BD dari business objects | Data integrity |
| 🔴 P0 — Segera | Pastikan loan repayment & tax payment selalu link ke modul sumber | Data integrity |
| 🟡 P1 — 2 minggu | Hapus/warning opsi kasbon & expense dari Bank Disbursement UI | UX |
| 🟡 P1 — 2 minggu | Gabungkan menu Kasbon + Dana Talangan | UX |
| 🟢 P2 — 1 bulan | Hapus entry point duplikat setelah deprecation period | Cleanup |
| 🟢 P3 — 3 bulan | Evaluasi unified `employee_fund_requests` table | Architecture |

---

*Laporan ini dibuat berdasarkan analisis static codebase. Tidak ada perubahan kode yang dilakukan.*  
*File audit tersimpan di: `docs/audit-accounting-overlap-2026-07.md`*
