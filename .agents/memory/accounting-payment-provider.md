---
name: Accounting payment provider metadata
description: Kontrak penyimpanan dan propagasi provider pembayaran dari Sport Center ke Accounting.
---

## Rule

`payment_provider` adalah metadata nullable yang diproyeksikan dari payment Sport Center ke `accounting_payments` dan `accounting_entries`. Koreksi provider boleh memperbarui jurnal posted selama tidak mengubah nominal, tanggal finansial, atau status jurnal.

**Why:** Provider dibutuhkan untuk rekonsiliasi dan settlement, tetapi bukan bagian dari nilai debit/kredit. Menolak koreksi metadata akan mempertahankan data sumber yang salah, sedangkan membuka perubahan finansial akan merusak audit trail.

**How to apply:** Pertahankan propagasi melalui mirror trigger dan backfill idempotent; jangan gunakan provider untuk mengubah akun, nominal, atau status entry yang sudah posted.