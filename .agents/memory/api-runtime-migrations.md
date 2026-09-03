---
name: API runtime database migrations
description: Runtime API memakai database Supabase terpisah dari database yang dipakai drizzle-kit di workspace.
---

Migrasi tabel yang dipakai API harus dijalankan melalui migration runner aplikasi terhadap database runtime yang dipilih environment, bukan hanya melalui drizzle-kit atau database Replit lokal.

**Why:** Fitur proposal COA sudah memiliki schema dan kode service, tetapi tabel runtime belum ada sehingga create request jatuh ke “Internal error” meskipun build dan test unit lulus.

**How to apply:** Untuk tabel baru yang dipakai API, tambahkan migrasi idempoten ke startup chain dan `run-dev-migrations.ts`, lalu verifikasi schema pada database development runtime sebelum menguji endpoint.

Posting dapat tetap sukses ketika penulisan audit/event dibuat non-fatal, walaupun kolom runtime yang dibutuhkan event belum ada. Verifikasi schema harus mencakup jalur audit yang dipanggil oleh operasi utama, bukan hanya tabel posting.

**Why:** Bukti posting Sport Center berhasil membuat jurnal balanced, tetapi insert `ledger_events` gagal karena `entry_id` belum ada di runtime development.

**How to apply:** Setelah migrasi, cek kolom yang dipakai helper audit/event dan sertakan persistensi event dalam proof untuk operasi accounting kritis.

Setiap kolom yang dipakai jalur repair idempoten harus ikut dalam migration gate additive
(`IF NOT EXISTS`) dan diverifikasi pada database runtime target; keberadaan tabel saja tidak
menjamin jalur repair dapat berjalan.

**Why:** Historical QRIS repair baru gagal saat insert match karena runtime PROD tertinggal
kolom metadata reviewer, meskipun tabel dan approval path sudah tersedia.

**How to apply:** Saat menambah write path pada tabel runtime, audit semua kolom baru dan
jalankan preflight schema terhadap target sebelum menjalankan repair atau posting massal.