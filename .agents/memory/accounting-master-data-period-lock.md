---
name: Accounting master-data period lock
description: Boundary between fiscal-period governance and accounting master-data CRUD.
---

Period-lock hanya boleh memvalidasi operasi yang membuat atau mengubah accounting entry/ledger. CRUD master data seperti chart of accounts, accounting journals, dan accounting settings tidak memiliki tanggal transaksi sehingga tidak boleh dipaksa mengirim `date`.

**Why:** Governance middleware yang dipasang pada seluruh router accounting sempat memblokir penyimpanan jurnal master dengan `PERIOD_DATE_REQUIRED`, walaupun tidak ada mutasi ledger.

**How to apply:** Saat menambah endpoint master data baru di bawah router accounting, beri pengecualian route yang spesifik dari write-method period governance; jangan melemahkan guard pada endpoint posting atau transaksi.