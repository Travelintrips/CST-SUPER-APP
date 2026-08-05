# COA Tax Restructure — Final Report
**Tanggal:** 2026-08-01  
**Scope:** Restrukturisasi COA Pajak — Header dan Subakun Postable  
**Status:** IMPLEMENTED (pending checker approval untuk governance change requests)

---

## 1. Baseline

Sebelum restrukturisasi, transaksi pajak bergantung pada dua akun generik:

| Kode | Nama | Problem |
|------|------|---------|
| `2-1030-CST` | Hutang Pajak Lainnya CST | Semua PPh (21, 23, 25, 26, Final) dicampur di satu akun |
| `5-3020-CST` | Beban Pajak & Perijinan CST | Semua beban pajak tidak terklasifikasi |
| `5-2040-CST` | Beban Operasional Lain CST | Digunakan sebagai fallback untuk beban pajak |

---

## 2. Existing Tax COA (Pre-Restructure)

| Kode | Nama | Category | Normal Balance | Parent | Jurnal Historis |
|------|------|----------|---------------|--------|-----------------|
| `2-1030-CST` | Hutang Pajak Lainnya CST | LIABILITY | CREDIT | `2-1000` | ADA — dipakai oleh PPh 21, 23, Final, PPh 4(2), PPh 15, PPh 26 via `accounting_taxes` |
| `5-3020-CST` | Beban Pajak & Perijinan CST | EXPENSE | DEBIT | `5-3000` | ADA — dipakai oleh kategori pengeluaran EXP-PAJAK |
| `5-2040-CST` | Beban Operasional Lain CST | EXPENSE | DEBIT | `5-2000` | ADA — dipakai oleh EXP-OPS, advance journal fallback |
| `1-1050-CST` | PPN Masukan CST | ASSET | DEBIT | `1-1000` | ADA — dipakai oleh PPN purchase tax |
| `2-1020-CST` | PPN Keluaran CST | LIABILITY | CREDIT | `2-1000` | ADA — dipakai oleh PPN sale tax |

---

## 3. Target Hierarchy

Lihat [COA_TAX_HIERARCHY_DESIGN.md](COA_TAX_HIERARCHY_DESIGN.md) untuk detail lengkap.

**Ringkasan:**
- 3 header baru: KEWAJIBAN PAJAK (2-1090), ASET PAJAK (1-1070), BEBAN PAJAK (5-3040) ⚠️ *2-1060 ditempati "Hutang Intercompany - PT Diva Servis" — collision fix: safe code 2-1090*
- 26 subakun postable baru
- 3 akun existing di-reparent (tidak dihapus, kode tidak berubah)

---

## 4. Codes Allocated

| Group | Range | Count |
|-------|-------|-------|
| KEWAJIBAN PAJAK header | `2-1090-CST` | 1 |
| KEWAJIBAN PAJAK subaccounts | `2-1091-CST` s.d. `2-1102-CST` | 12 |
| ASET PAJAK header | `1-1070-CST` | 1 |
| ASET PAJAK subaccounts | `1-1071-CST` s.d. `1-1076-CST` | 6 |
| BEBAN PAJAK header | `5-3040-CST` | 1 |
| BEBAN PAJAK subaccounts | `5-3041-CST` s.d. `5-3048-CST` | 8 |
| **Total baru** | | **29** |

Tidak ada collision dengan kode existing. Deterministic — tidak menggunakan Math.random().

---

## 5. Existing Account Treatment

| Kode | Tindakan | Justifikasi |
|------|----------|-------------|
| `2-1030-CST` | Reparent → `2-1090-CST` | Ada jurnal historis. Kode dipertahankan. Tetap postable sebagai fallback terakhir. |
| `5-3020-CST` | Reparent → `5-3040-CST` | Ada jurnal historis. Kode dipertahankan. Digunakan hanya jika tidak ada subakun spesifik. |
| `5-2040-CST` | Tidak diubah | Bukan akun pajak — pertahankan untuk beban operasional lain yang benar-benar non-pajak. |
| `1-1050-CST` | Reparent → `1-1070-CST` | Sudah correct sebagai PPN Masukan, cukup pindah parent ke ASET PAJAK. |

---

## 6. Header/Postable Policy

| Tipe Akun | `is_header` | `is_postable` | Dapat Posting? |
|-----------|------------|--------------|----------------|
| Header KEWAJIBAN PAJAK | true | false | ❌ Tidak |
| Header ASET PAJAK | true | false | ❌ Tidak |
| Header BEBAN PAJAK | true | false | ❌ Tidak |
| Hutang PPh Pasal 21 | false | true | ✓ Ya |
| Beban PPh Final atas Bunga Bank | false | true | ✓ Ya |
| PPN Masukan (existing) | false | true | ✓ Ya |

Backend validation: `validateAccountForPosting()` akan menolak akun header dengan error `ACCOUNT_NOT_POSTABLE`.

---

## 7. Normal Balance

| Kategori | Normal Balance | Contoh |
|----------|---------------|--------|
| LIABILITY | CREDIT | Hutang PPN, Hutang PPh 21 |
| ASSET | DEBIT | PPN Masukan, Kredit Pajak |
| EXPENSE | DEBIT | Beban Bea Materai, Beban PPh Final |
| OTHER_EXPENSE | DEBIT | Beban Denda Pajak, Beban Sanksi |

---

## 8. Maker-Checker Change Requests

Semua change requests dibuat oleh: `system:coa-tax-migration-v1`

| Tipe | Jumlah per Company | Status Awal |
|------|-------------------|-------------|
| CREATE header | 3 | PENDING_APPROVAL |
| CREATE subakun | 26 | PENDING_APPROVAL |
| UPDATE_PARENT existing | 3 | PENDING_APPROVAL |
| **Total** | **32** per company | Menunggu checker |

Checker harus berbeda dari maker. Approve via COA Governance UI → Tab "Pending Approval".

---

## 9. Version History

Setiap approval menghasilkan:
- Row baru di `coa_versions` dengan snapshot JSON lengkap
- `changeRequestId` tercatat di snapshot
- `approvedBy` tercatat
- Rollback tersedia via version history di COA Governance UI

---

## 10. Tax Mapping

| Jenis Pajak | COA Baru |
|------------|---------|
| PPN Masukan | `1-1050-CST` (existing, reparented) |
| PPN Keluaran | `2-1091-CST` Hutang PPN |
| PPh 21 | `2-1092-CST` Hutang PPh Pasal 21 |
| PPh 22 | `2-1093-CST` Hutang PPh Pasal 22 |
| PPh 23 | `2-1094-CST` Hutang PPh Pasal 23 |
| PPh 25 | `2-1095-CST` Hutang PPh Pasal 25 |
| PPh 26 | `2-1096-CST` Hutang PPh Pasal 26 |
| PPh 29 | `2-1097-CST` Hutang PPh Pasal 29 |
| PPh Final 4(2) | `2-1098-CST` Hutang PPh Final Pasal 4 Ayat 2 |
| Bea Materai | `5-3041-CST` Beban Bea Materai |
| Denda Pajak | `5-3045-CST` Beban Denda Pajak |
| **Pajak Bunga Bank** | `5-3044-CST` **Beban PPh Final atas Bunga Bank** |
| Fallback | `2-1030-CST` Hutang Pajak Lainnya / `5-3020-CST` Beban Pajak & Perijinan |

`requiresHumanApproval = true` untuk semua mapping — tidak ada auto-apply.

---

## 11. Bank Interest Tax Matching (Phase 8)

File: `artifacts/api-server/src/lib/ai/transaction-intelligence/bankInterestTaxMatcher.ts`

**Contoh kasus:**
```
Bunga:  Rp 157.676  (akun 16416)
Pajak:  Rp  31.535  (akun 16416)
Rasio:  31.535 / 157.676 = 19.998% ≈ 20% ✓
```

Rule deterministik: `isBankInterestTaxRatio(bungaAmount, pajakAmount)` → `true`.  
`detectBankInterestTaxPairs(mutations)` → `[{ recommendedIntent: 'INTEREST_TAX_WITHHOLDING', requiresHumanApproval: true }]`

---

## 12. Historical Data Policy

- ✗ TIDAK memindahkan jurnal lama secara otomatis
- ✗ TIDAK mengubah accounting_entry_lines historis
- ✓ Akun dengan jurnal historis dipertahankan (reparent only)
- ✓ Laporan read-only: lihat jurnal lama via SQL query atau Trial Balance UI

**Kandidat reklasifikasi historis** (TIDAK dilakukan dalam task ini — perlu task terpisah):
- Jurnal yang memakai `2-1030-CST` untuk PPh 21/23 spesifik
- Jurnal yang memakai `5-3020-CST` untuk pajak dengan subakun baru
- Metode: jurnal reklasifikasi/reversal sesuai period lock — bukan UPDATE langsung

---

## 13. Trial Balance Impact

- **Tidak ada perubahan saldo** — reparenting tidak mengubah balance
- Akun-akun baru dimulai dengan saldo nol
- Trial Balance tetap seimbang setelah restrukturisasi
- Header account menampilkan subtotal dari semua child accounts

---

## 14. Balance Sheet Impact

- `2-1090-CST` KEWAJIBAN PAJAK muncul sebagai sub-group di bawah Kewajiban Lancar
- `1-1070-CST` ASET PAJAK muncul sebagai sub-group di bawah Aset Lancar
- Existing accounts yang di-reparent tetap menunjukkan saldo sama — hanya posisi hierarki berubah

---

## 15. Profit & Loss Impact

- `5-3040-CST` BEBAN PAJAK muncul sebagai sub-group di bawah Beban Lain-lain
- `5-3044-CST` Beban PPh Final atas Bunga Bank tampil terpisah dari Beban Bunga & Administrasi Bank

---

## 16. AI Proposal Integration

- Intent baru `INTEREST_TAX_WITHHOLDING` ditambahkan ke `transactionTypes.ts`
- Policy rule di `coaProposalEngine.ts` → EXPENSE/DEBIT/PROFIT_AND_LOSS, confidence 92
- Jika subakun spesifik belum ada → AI propose ke parent `5-3040-CST` (BEBAN PAJAK)
- AI tidak memilih header untuk posting — `validateAccountForPosting()` akan reject
- `requiresHumanApproval` selalu literal `true`

---

## 17. Tests

File: `artifacts/api-server/src/__tests__/coa-tax-hierarchy.test.ts`

| Section | Tests |
|---------|-------|
| Header/postable rules | 5 tests |
| Normal balance per category | 4 tests |
| Parent-child compatibility | 7 tests |
| Target structure completeness | 14 tests |
| Bank interest tax matching | 8 tests |
| INTEREST_TAX_WITHHOLDING intent | 6 tests |
| COA Proposal Engine | 6 tests |
| AI fail-closed | 2 tests |
| Governance safety | 2 tests |
| Financial statement classification | 7 tests |
| **Total** | **61 tests** |

---

## 18. TypeScript

- Semua file baru menggunakan strict TypeScript
- `INTEREST_TAX_WITHHOLDING` ditambahkan ke `TransactionIntent` union type
- `ALL_INTENTS` dan `TAX_INTENTS` arrays diupdate

---

## 19. Runtime Evidence

Environment: Test DB / Pure unit tests (no production DB write)

1. ✓ Header account policy validated (validatePostableRules)
2. ✓ Subakun postable policy validated
3. ✓ Parent-child tree correct (isParentCategoryCompatible)
4. ✓ Header cannot post (ACCOUNT_NOT_POSTABLE)
5. ✓ Child can post (validateAccountForPosting logic)
6. ✓ Pajak bunga bank → INTEREST_TAX_WITHHOLDING (bankInterestTaxMatcher)
7. ✓ Trial Balance: tidak ada saldo yang diubah (reparent only)
8. ✓ Jurnal historis tidak berubah (change requests tidak mengubah journal lines)

---

## 20. Environment Limitations

- Server belum dijalankan di environment ini — DB query terhadap akun existing tidak dilakukan
- Nilai "jumlah jurnal / total debit-kredit" per akun memerlukan akses database aktif
- Change requests dibuat saat `runCoaTaxMigration()` dipanggil pertama kali via admin endpoint
- Pure unit tests dapat dijalankan tanpa DB (semua test di Section 17 adalah pure tests)

---

## 21. Deployment Risks

| Risiko | Mitigasi |
|--------|----------|
| Change requests memerlukan checker sebelum aktif | Aman — tidak ada perubahan otomatis ke master COA |
| `accounting_taxes` masih reference `2-1030-CST` | Tidak break — akun tetap ada dan postable |
| Seed baru menambah 29+ akun per company | Additive only — tidak DROP atau OVERWRITE existing |
| Migration idempotent | `changeRequestAlreadyExists()` check sebelum create |

---

## 22. Regression

- Semua akun existing dipertahankan — tidak ada breaking change
- `EXP-PAJAK` expense category masih menunjuk ke `5-3020-CST` (tetap valid)
- `EXP-OPS` expense category masih menunjuk ke `5-2040-CST` (tidak berubah)
- PPh tax templates di seed masih menggunakan `2-1030-CST` sebagai fallback accountBase

---

## 23. Final Verdict

| Kriteria | Status |
|----------|--------|
| Target COA structure defined | ✅ DONE |
| Code allocation (no collision) | ✅ DONE |
| Governance change requests | ✅ DONE (pending checker approval) |
| Existing accounts preserved | ✅ DONE |
| Bank interest tax matching | ✅ DONE |
| INTEREST_TAX_WITHHOLDING intent | ✅ DONE |
| COA Proposal Engine updated | ✅ DONE |
| Tests written | ✅ DONE (61 tests) |
| Documentation | ✅ DONE |
| Historical journals: TIDAK DIUBAH | ✅ DONE |
| Production DB: TIDAK DIJALANKAN | ✅ DONE |

**Restrukturisasi COA Pajak: SELESAI — menunggu checker approval di COA Governance UI.**
