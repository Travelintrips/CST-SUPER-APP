---
name: Sport payment reconciliation canonical source
description: Sport Center payments must be represented by the source payment row, not its accounting mirror, during bank matching.
---

`sport_payments` adalah kandidat canonical untuk rekonsiliasi bank. Baris `accounting_payments` dengan `source_type = 'sport_center'` hanya menjadi relasi menuju jurnal accounting yang sudah ada dan tidak boleh menjadi kandidat kedua.

**Why:** Satu pembayaran Sport Center disalin ke `accounting_payments`; menampilkan kedua baris dapat menghasilkan dua kandidat untuk satu economic event dan meningkatkan risiko salah pilih atau double posting.

**How to apply:** Keluarkan `accounting_payments.source_type = 'sport_center'` dari semua query kandidat bank/ERP. Tetap gunakan relasi `source_doc_id` → `sport_payments.id` pada journal reuse untuk menemukan dan memakai jurnal existing.

Untuk pencocokan bank, metode pembayaran menentukan kontrak tanggal: transfer bank memakai tanggal pembayaran (`paid_at`/tanggal transaksi), sedangkan QRIS memakai tanggal settlement yang dapat H+1.

**Why:** Memakai settlement date untuk semua `sport_payments` membuat transfer bank yang sah hilang dari kandidat ketika settlement date berbeda dari tanggal mutasi.

**How to apply:** Pilih ekspresi tanggal berdasarkan `sp.method` di engine matching, dan gunakan `details.date` untuk filter kandidat transfer bank di UI; jangan gunakan `details.settlementDate` untuk kandidat non-QRIS.