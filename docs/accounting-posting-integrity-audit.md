# Accounting Posting Integrity — Audit Report

**Tanggal audit:** 2026-07-05
**Trigger:** Kasbon yang dihapus dari UI meninggalkan jurnal GL (posted) yatim (orphan) — status "sudah dibayar" secara akuntansi tapi transaksi sumbernya sudah tidak ada.

**Prinsip inti:** *Posted Journal is Immutable.* Begitu sebuah transaksi operasional membuat entry di `accounting_entries` dengan status `posted`, transaksi sumber tersebut **tidak boleh** di-hard-delete. Pembatalan hanya boleh lewat:
- **VOID** — jurnal sudah posted, tapi uang **belum benar-benar bergerak** (mis. disbursed tapi belum ada cicilan/pemakaian). Membuat jurnal pembalik 100% (debit↔kredit ditukar) dan menandai baik jurnal asal (`voided_at`, `void_entry_id`) maupun record sumber (`status='void'`).
- **REVERSAL** — koreksi jurnal yang salah/dibatalkan setelah uang bergerak. Sama seperti VOID secara teknis (jurnal pembalik), tapi dipakai untuk kasus "batalkan seluruhnya karena salah input", bukan pembatalan bisnis normal.
- **REPAYMENT / SETTLEMENT** — uang sudah keluar dan **sudah dipertanggungjawabkan sebagian/seluruhnya** (ada cicilan). Tidak membalik jurnal asal — membuat jurnal BARU (DR Kas/Bank, CR Piutang) yang mengurangi saldo piutang. Jurnal asal tetap utuh selamanya sebagai bukti disbursement awal.

Hard delete HANYA sah jika `entryId == null` (belum pernah posting jurnal sama sekali) DAN uang belum bergerak.

---

## Bug Awal (Kasbon)

`DELETE /api/cash-advances/:id` (di `artifacts/api-server/src/routes/cashAdvances.ts`) mengizinkan hard-delete untuk status `active | pending_approval | rejected` selama `paidAmount == 0` — **tanpa memeriksa apakah `entryId` sudah terisi**. Karena kasbon di sistem ini langsung posting jurnal saat status berubah menjadi `active` (tidak ada state "approved tapi belum disbursed" terpisah), kasbon yang statusnya `active` (jurnal SUDAH posted) tapi belum ada cicilan bisa dihapus — meninggalkan `accounting_entries` + `accounting_entry_lines` yatim yang tetap mempengaruhi neraca/laba-rugi selamanya.

**Status: DIPERBAIKI.** Lihat `docs/accounting-posting-integrity-policy.md` bagian Kasbon.

---

## Temuan Per Modul

| # | Modul | File | Status Sebelum Audit | Risiko | Prioritas Fix |
|---|-------|------|----------------------|--------|----------------|
| 1 | Kasbon / Dana Talangan | `routes/cashAdvances.ts` | Hard delete tanpa cek `entryId` | **Tinggi** — bug pemicu, journal orphan | **Selesai** (patch VOID + guard delete) |
| 2 | AR/AP Vendor Payment | `routes/vendorPayments.ts` | Hard delete payment yang sudah posting jurnal AP | **Tinggi** — payment vendor terhapus, hutang tidak berkurang di UI tapi jurnal tetap ada | Tinggi (lanjutan) |
| 3 | Installment (Cicilan) | `routes/vendorInstallments.ts` | Hard delete cicilan meski entry sudah posted | **Tinggi** — cicilan hilang, saldo hutang jadi tidak akurat vs GL | Tinggi (lanjutan) |
| 4 | Expense | `routes/expenses.ts` | Perlu verifikasi delete guard vs entryId | Sedang | Sedang (lanjutan) |
| 5 | Bank Reconciliation | `routes/bankReconciliation.ts` + `unifiedMatchingEngine` | Sudah punya alur approve→createJournal terpisah; jurnal hanya dibuat saat approval | Rendah (arsitektur sudah baik) | Verifikasi saja |
| 6 | Asset Transaction | `routes/assets.ts` | Perlu verifikasi | Sedang | Sedang (lanjutan) |
| 7 | Tenant / Sport Center Payment | `routes/sportPayments.ts`, `routes/tenantPayments.ts` | Sudah pakai `ingestModulePayment()` idempoten + `posting_status`; delete payment perlu dicek | Rendah–Sedang | Verifikasi + guard delete |
| 8 | Vendor/Customer Payment (umum) | berbagai `routes/*Payment*.ts` | Bervariasi per modul | Sedang | Lanjutan |
| 9 | Refund | `routes/*.ts` (refund flows) | Umumnya sudah pakai reversal-style jurnal terpisah | Rendah | Verifikasi |

**Catatan:** Baris 2–4 dan 8 adalah modul dengan pola paling mirip Kasbon (single-table + `entryId` langsung di-set saat posting) — pola guard yang sama (`accountingPostingGuard.ts`) langsung bisa dipakai ulang begitu di-patch.

---

## Infrastruktur yang Sudah Ada (Reused, Tidak Diduplikasi)

- `postEntry()` — `artifacts/api-server/src/lib/accounting.ts` — satu-satunya jalur resmi membuat jurnal baru (validasi balance built-in).
- `voidApprovedJournal()` — `artifacts/api-server/src/lib/accounting/approveAndCreateJournal.ts` — pola reversal referensi (dipakai Bank Reconciliation).
- DB triggers `ae_insert_guard`, `ae_immutability` — `artifacts/api-server/src/lib/accounting/ledgerGuard.ts` — memblokir UPDATE/DELETE langsung ke `accounting_entries` yang sudah `posted` di level database (defense-in-depth, independen dari kode aplikasi mana pun yang mencoba melewatinya).
- `auditFromReq()` — `artifacts/api-server/src/lib/auditLog.ts` — audit trail ke `erp_audit_logs`.

## Infrastruktur Baru

- `artifacts/api-server/src/lib/accountingPostingGuard.ts` — layer generic berisi:
  - `assertCanDeleteTransaction()`, `assertCanVoidTransaction()`, `assertCanReverseJournal()` — pre-condition checks dipanggil route handler SEBELUM delete/void/reverse.
  - `validateJournalBalance()` — validasi debit=kredit untuk jurnal buatan sendiri (defense-in-depth di atas `postEntry`).
  - `createReversalJournal()` — factory jurnal pembalik generic (dipakai VOID/REVERSE lintas modul).
  - `createRepaymentJournal()` — factory jurnal settlement baru generic (dipakai REPAYMENT lintas modul).
  - `logPostingGuardAction()` — wrapper audit log konsisten `posting_guard_*`.

---

## Assumption Log (per prinsip "Assumption Limit Rule")

- **ASSUMPTION:** Kasbon/Talangan di sistem ini tidak punya state "approved tapi belum disbursed" terpisah dari "posted" — begitu approval selesai, jurnal langsung dibuat dan status jadi `active`. Karena itu, `entryId != null` dipakai sebagai proxy untuk "uang sudah bergerak/disbursed" pada guard DELETE. VOID tetap diizinkan selama `paidAmount == 0` (belum ada pertanggungjawaban/cicilan) — ini adalah kompromi pragmatis, bukan pemisahan penuh disbursed vs approved. Didokumentasikan di sini agar eksplisit, bukan diam-diam diasumsikan di kode.
- **ASSUMPTION:** Status `void` ditambahkan sebagai nilai baru pada kolom `status` (bukan mengganti enum status lama `active/partial/repaid/pending_approval/rejected`) untuk menghindari breaking change di frontend/reporting yang sudah ada. Tidak ada tabel atau kolom SCHEMA baru di luar yang sudah dikonfirmasi lewat kolom-kolom `disbursedAt/repaidAt/voidedAt/voidedBy/voidReason/reversalJournalId/repaymentJournalId` yang additive-only (ALTER TABLE ADD COLUMN IF NOT EXISTS).
