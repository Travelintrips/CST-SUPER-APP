---
name: Tax SSE & Journal Mapping
description: Tax auto-detection expansion + journal mapping service for kasbon/talangan/hutang bank/leasing/aset tetap/penyusutan
---

## Tax SSE (sudah terpasang sebelumnya)
- `taxSseBroadcast.ts`: `handleTaxSse` + `broadcastTaxUpdate`
- Endpoint: `GET /api/accounting/tax-stream`
- Frontend: `useTaxSse` hook di `tax-report.tsx` sudah subscribe & invalidate queries on `tax_update` event

## taxAutoService.ts — expanded detectTax logic
- `logistic_order` + subType `laut|sea|ocean|pelayaran|fcl|lcl` → PPh 15 Pelayaran DN 1.2%
- `logistic_order` + subType mengandung `ln|international|overseas` → PPh 15 Pelayaran LN 2.64%
- `expense` + subType `sewa|rental` → PPh 4(2) Sewa 10%
- `expense` + subType `luar negeri|overseas|pph_26` → PPh 26 20%
- `expense` + subType `gaji|honor|upah` → PPh 21
- Default expense → PPh 23
- `bank_loan` → PPh 23
- `employee_advance`, `fixed_asset` → null (tidak dipotong pajak otomatis)

## journalMappingService.ts
- `resolveAccounts(companyId)` — resolves all needed COA by suffix CST/WS/DV/ER, plus bankJournalId/cashJournalId/generalJournalId from accounting_settings
- COA codes: kasbon=1-1032, talangan=1-1033, hutang_bank_pendek=2-1050, hutang_leasing_pendek=2-1055, hutang_bank_panjang=2-2020, beban_penyusutan=5-2100, beban_bunga=5-3010, aset_tetap=1-2010, akum_depresiasi=1-2020
- **Always use source="manual"** — "advance"/"bank_loan"/"fixed_asset" bukan valid source di PostingInput
- `getJournalMappingSummary(companyId)` → mapping ringkasan akun DR/CR per jenis transaksi

## API Routes (admin-only)
- `GET  /api/accounting/journal-mapping/summary`
- `POST /api/accounting/journal-mapping/kasbon` (`repayment: true` untuk pelunasan)
- `POST /api/accounting/journal-mapping/talangan` (`repayment: true` untuk pelunasan)
- `POST /api/accounting/journal-mapping/loan-disbursement` (`loanType: bank|leasing`, `isLongTerm`)
- `POST /api/accounting/journal-mapping/loan-repayment` (`principalAmount` + `interestAmount`)
- `POST /api/accounting/journal-mapping/asset-purchase`
- `POST /api/accounting/journal-mapping/depreciation`
