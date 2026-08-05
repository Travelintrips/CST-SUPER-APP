# Kebijakan Reversal, Void & Repayment — Accounting Posting Integrity

Status: **Aktif**. Dokumen ini melengkapi `docs/accounting-posting-integrity-policy.md`
dan `docs/accounting-posting-integrity-audit.md`. Sumber kebenaran implementasi ada
di `artifacts/api-server/src/lib/accountingPostingGuard.ts` — dokumen ini menjelaskan
**kapan** tiap mekanisme dipakai dan **apa yang WAJIB terjadi di database**.

## Prinsip inti: "Posted Journal is Immutable"

Jurnal (`accounting_entries` berstatus `posted`) **tidak pernah** di-`UPDATE` isinya
atau di-`DELETE` secara fisik setelah dibuat. Pembatalan/koreksi HARUS selalu berupa
baris baru di ledger. ada tiga mekanisme, dipilih berdasarkan **apakah uang sudah
benar-benar berpindah**:

| Mekanisme | Jurnal sudah ada? | Uang sudah bergerak? | Aksi DB |
|---|---|---|---|
| **DELETE** (hard) | Tidak (`entry_id IS NULL`) | Tidak | Hapus baris transaksi asli. Tidak menyentuh ledger sama sekali. |
| **VOID** | Ya | **Belum** (mis. approved tapi belum disbursed) | Buat jurnal pembalik 100% (debit↔credit ditukar) + tandai entry asal `status='voided'`, `voided_at=NOW()`, `void_entry_id=<id jurnal baru>`. Baris transaksi sumber ditandai `status='void'`, bukan dihapus. |
| **REPAYMENT** | Ya | **Sudah** (dana sudah keluar/diterima) | Buat jurnal BARU (DR Kas/Bank, CR Piutang/Utang terkait) — **bukan** pembalik jurnal disbursement asal. Jurnal disbursement asal tetap `posted` selamanya. |

`REVERSE` (koreksi jurnal yang sudah posted karena kesalahan input, bukan karena
pembatalan bisnis) memakai mesin yang sama dengan VOID (`createReversalJournal`),
tapi diperbolehkan kapan saja pada entry yang belum pernah di-void — lihat
`assertCanReverseJournal`.

## Alur keputusan (dipakai oleh setiap modul: Kasbon, Talangan, Vendor Installment, dst.)

```
Ada entry_id di record?
 ├─ TIDAK → boleh DELETE fisik (assertCanDeleteTransaction: NO_JOURNAL_OK)
 └─ YA
     ├─ Uang belum bergerak (moneyMoved=false)
     │    → VOID diperbolehkan (assertCanVoidTransaction: OK)
     │      → createReversalJournal({ originalEntryId, reason, tag })
     │      → record sumber: status='void', voided_at=NOW(), void_entry_id/reversal_journal_id=<hasil>
     └─ Uang sudah bergerak (moneyMoved=true)
          → VOID DILARANG (MONEY_MOVED_BLOCKED)
          → gunakan REPAYMENT: createRepaymentJournal({ debitAccountId, creditAccountId, amount })
          → record sumber: status='partial'|'repaid', repayment_journal_id diisi per cicilan
```

## Invarian database yang WAJIB selalu benar

Invarian ini adalah dasar dari `scripts/audit-accounting-integrity.mjs`:

1. **Tidak ada jurnal posted tanpa transaksi sumber.** Untuk source dengan
   `source_id` eksplisit (`reversal`, `sales_invoice`, `purchase_bill`, dll.),
   baris di tabel sumber harus tetap ada (soft-cancel, bukan hard-delete).
2. **Tidak ada transaksi sumber yang `void`/`cancelled` tanpa jurnal pembalik.**
   Jika `status IN ('void','cancelled')` maka kolom penunjuk jurnal pembalik
   (`reversal_journal_id`, `void_entry_id`, dsb.) WAJIB terisi.
3. **Setiap jurnal harus balance.** `SUM(debit) = SUM(credit)` per `entry_id`,
   toleransi ≤ 0.01 (pembulatan).
4. **Tidak ada pembayaran berstatus "paid"/"posted" tanpa jurnal.** Kolom
   penunjuk jurnal (`entry_id`, `journal_entry_id`, dsb.) wajib terisi begitu
   status berubah ke final (`paid`/`posted`).
5. **Jurnal kas/bank harus punya sumber yang valid.** Entry pada jurnal
   bertipe `cash`/`bank` yang menunjuk ke `source_id` eksplisit harus bisa
   ditelusuri balik ke baris sumbernya.
6. **Record yang hilang/dihapus tidak boleh meninggalkan jurnal yatim.**
   Karena aturan #1 (delete fisik hanya boleh sebelum ada jurnal), jika
   sebuah kasbon/talangan hilang dari tabel sumber padahal `entry_id` masih
   dirujuk oleh jurnal manapun, itu adalah pelanggaran data integrity yang
   HARUS diinvestigasi manual — bukan di-auto-fix oleh script.

## Yang TIDAK boleh dilakukan siapapun (termasuk migrasi/skrip perbaikan)

- Tidak pernah `DELETE FROM accounting_entries WHERE status = 'posted'`.
- Tidak pernah `DROP TABLE`/`TRUNCATE` pada tabel akuntansi atau tabel modul
  sumber (`cash_advances`, `vendor_installments`, dst.) untuk "membersihkan" data.
- Tidak pernah mengubah `debit`/`credit` pada `accounting_entry_lines` milik
  entry yang sudah `posted` — perbaikan HARUS berupa entry baru.
- Perbaikan bug yang ditemukan audit (mis. kolom void yang belum ada, hasil
  race condition) HANYA boleh berupa `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  atau patch logic tambahan — tidak pernah migrasi destruktif.

## Referensi

- `docs/accounting-posting-integrity-policy.md` — aturan per-modul (Kasbon sudah implementasi penuh).
- `docs/accounting-posting-integrity-audit.md` — hasil audit awal yang melahirkan guard ini.
- `artifacts/api-server/src/lib/accountingPostingGuard.ts` — implementasi `assertCanDeleteTransaction`,
  `assertCanVoidTransaction`, `assertCanReverseJournal`, `createReversalJournal`, `createRepaymentJournal`.
- `scripts/audit-accounting-integrity.mjs` — deteksi pelanggaran invarian di atas terhadap DB live.
- `docs/accounting-integrity-findings.md` — hasil scan terakhir.
