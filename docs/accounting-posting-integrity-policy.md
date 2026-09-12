# Accounting Posting Integrity — Policy

## Prinsip Inti

**"Posted Journal is Immutable."** Sekali sebuah transaksi operasional (Kasbon, Dana Talangan, AR/AP Payment, Installment, Expense, Bank Reconciliation, Asset Transaction, Tenant/Sport Center Payment, Vendor/Customer Payment, Refund) membuat entry di `accounting_entries` dengan status `posted`, entry tersebut **tidak boleh diubah atau dihapus** — baik secara langsung (UPDATE/DELETE SQL) maupun tidak langsung (menghapus record sumber yang mereferensikannya).

Penegakan berlapis:
1. **DB trigger** (`ae_insert_guard`, `ae_immutability` — `lib/accounting/ledgerGuard.ts`) — baris terakhir pertahanan, aktif di level Postgres, tidak bisa dilewati kode aplikasi mana pun.
2. **API guard** (`accountingPostingGuard.ts`) — pre-condition check di setiap route sebelum DELETE/VOID/REVERSE dijalankan, memberi pesan error yang jelas ke user (bukan hanya SQL error mentah).

## Tiga Jalur Pembatalan

| Jalur | Kapan dipakai | Efek ke jurnal asal | Efek ke record sumber |
|-------|---------------|----------------------|------------------------|
| **DELETE (hard)** | `entryId == null` DAN uang belum bergerak sama sekali (masih draft/pending/rejected sebelum approval) | Tidak ada jurnal untuk dihapus | Row dihapus fisik dari tabel |
| **VOID** | Jurnal sudah `posted`, tapi belum ada pertanggungjawaban/pemakaian dana (`paidAmount == 0` / belum ada cicilan/settlement) | Jurnal pembalik 100% dibuat (debit↔kredit ditukar); jurnal asal ditandai `voided_at` + `void_entry_id`, TIDAK dihapus | Status diubah jadi `void`; kolom `voided_at/voided_by/void_reason/reversal_journal_id` diisi. Row TETAP ADA (untuk audit trail) |
| **REPAYMENT / SETTLEMENT** | Uang sudah keluar/masuk DAN sudah (sebagian) dipertanggungjawabkan | Jurnal asal tidak disentuh sama sekali; jurnal BARU dibuat (DR Kas/Bank, CR Piutang atau sebaliknya) | `paidAmount`/`remainingAmount` diupdate; status jadi `partial`/`repaid` sesuai sisa saldo |

**Aturan keputusan cepat:**
```
entryId == null?
  ├─ ya → DELETE diizinkan (tidak ada jurnal untuk dijaga)
  └─ tidak (jurnal sudah posted)
        ├─ paidAmount/uang belum bergerak sama sekali → VOID (jurnal pembalik)
        └─ sudah ada cicilan/pemakaian dana           → REPAYMENT (jurnal baru), TIDAK BISA void lagi
```

## Implementasi Referensi — Kasbon / Dana Talangan

File: `artifacts/api-server/src/routes/cashAdvances.ts`, `lib/db/src/schema/cashAdvances.ts`.

- Kolom baru (additive, `ALTER TABLE ADD COLUMN IF NOT EXISTS`): `disbursed_at`, `repaid_at`, `voided_at`, `voided_by`, `void_reason`, `reversal_journal_id`, `repayment_journal_id`.
- `DELETE /api/cash-advances/:id` — sekarang memanggil `assertCanDeleteTransaction({ entryId, moneyMoved })`. Ditolak dengan `400` + kode `POSTED_JOURNAL_BLOCKED` jika `entryId` sudah terisi, terlepas dari status. Hanya `pending_approval`/`rejected` (belum pernah posting) yang bisa dihapus.
- `POST /api/cash-advances/:id/void` (baru) — memanggil `assertCanVoidTransaction()`, lalu `createReversalJournal()` dari `accountingPostingGuard.ts`. Ditolak jika `paidAmount > 0` (sudah ada cicilan) atau sudah `void` sebelumnya.
- Repayment (`POST /:id/repay`, sudah ada sebelumnya) tetap menjadi satu-satunya jalur mengurangi saldo kasbon setelah dana dipertanggungjawabkan — tidak diubah oleh audit ini karena sudah membuat jurnal baru (bukan reversal).
- Frontend (`artifacts/bizportal/src/pages/expense/kasbon.tsx`): tombol "Hapus" hanya muncul untuk status `pending_approval`/`rejected` tanpa `entryId`. Tombol "Void Kasbon" muncul untuk status `active` dengan jurnal posted dan `paidAmount == 0`. Status `partial` menampilkan pesan mengarahkan ke Repayment, tanpa opsi hapus/void.

## Pola untuk Modul Lain (Rencana Lanjutan)

Modul dengan struktur serupa (single row + `entryId` langsung diisi saat posting) — AR/AP Vendor Payment, Installment, Expense, Asset Transaction, Vendor/Customer Payment — mengikuti pola yang identik:

1. Tambah kolom audit (`voided_at`, `voided_by`, `void_reason`, `reversal_journal_id`) via migrasi additive.
2. Ganti pengecekan delete dari "berdasarkan status saja" menjadi `assertCanDeleteTransaction({ entryId, moneyMoved })`.
3. Tambah endpoint `POST /:id/void` yang memanggil `createReversalJournal()`.
4. Modul yang sudah punya jalur "settlement/repayment baru" (bukan reversal) — biarkan tidak berubah; itu sudah pola REPAYMENT yang benar.
5. Update frontend agar tombol "Hapus" hanya tampil ketika `entryId` belum ada.

Bank Reconciliation, Tenant/Sport Center Payment, dan Refund sudah punya arsitektur append-only/approve-then-post (`unifiedMatchingEngine`, `ingestModulePayment()`) yang secara desain mencegah orphan journal — audit menegaskan pola ini SEBAGAI REFERENSI untuk modul lain, bukan sebagai temuan yang perlu diperbaiki.

## Audit Trail

Semua aksi VOID/REVERSE/DELETE-blocked dicatat lewat `logPostingGuardAction()` → `erp_audit_logs` dengan `action = posting_guard_{void|reverse|delete_blocked}`, sehingga riwayat siapa membatalkan apa dan kapan selalu bisa ditelusuri terpisah dari audit log modul asal (`kasbon_created`, dst).

## Deteksi Drift

Jalankan `node scripts/audit-accounting-integrity.mjs` untuk memindai orphan journal (transaksi sumber hilang tapi `accounting_entries` masih ada) dan transaksi ber-status non-void/non-repaid yang jurnalnya sudah `voided` tanpa alasan tercatat. Lihat header script untuk detail masing-masing pemeriksaan.
