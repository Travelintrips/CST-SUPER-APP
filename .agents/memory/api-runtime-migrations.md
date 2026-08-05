---
name: API runtime database migrations
description: Runtime API memakai database Supabase terpisah dari database yang dipakai drizzle-kit di workspace.
---

Migrasi tabel yang dipakai API harus dijalankan melalui migration runner aplikasi terhadap database runtime yang dipilih environment, bukan hanya melalui drizzle-kit atau database Replit lokal.

**Why:** Fitur proposal COA sudah memiliki schema dan kode service, tetapi tabel runtime belum ada sehingga create request jatuh ke “Internal error” meskipun build dan test unit lulus.

**How to apply:** Untuk tabel baru yang dipakai API, tambahkan migrasi idempoten ke startup chain dan `run-dev-migrations.ts`, lalu verifikasi schema pada database development runtime sebelum menguji endpoint.