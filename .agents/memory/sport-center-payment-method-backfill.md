---
name: Sport Center payment method backfill
description: Menjaga metadata metode pembayaran tetap terlihat pada accounting payment dan journal header.
---

## Rule

Saat memperbaiki atau menyinkronkan payment Sport Center, `payment_method` harus diisi pada dua objek Accounting: `accounting_payments` dan `accounting_entries`. Untuk data lama, sumber canonical adalah `public.sport_payments.method`; relasi utama ke journal adalah `accounting_payments.entry_id`, dengan fallback legacy `accounting_entries.source_id = sport_payments.booking_id`.

**Why:** Jalur sinkronisasi lama hanya melakukan backfill ke `accounting_payments`, sementara journal header yang sudah terlanjur dibuat tetap `NULL`. Ini membuat metode pembayaran terlihat ada di sumber Sport Center tetapi hilang di daftar Accounting Entries.

**How to apply:** Backfill hanya baris `accounting_entries.payment_method IS NULL`; jangan mengubah nominal, akun, status, atau jurnal posted. Jalankan repair saat migrasi startup dan saat sync menemukan entry lama.