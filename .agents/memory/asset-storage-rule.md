---
name: Asset storage rule
description: Gambar dan file biner harus ke Supabase Storage, bukan git. History sudah di-rewrite.
---

## Aturan

Semua gambar, PDF, dan file biner harus disimpan di **Supabase Storage** dan direferensi via URL — bukan di-commit ke git.

**Why:** Repository pernah membengkak sampai 475 MB karena `attached_assets/` (chat uploads) dan `.agents/outputs/` (agent renders) ikut ter-commit. History sudah di-rewrite dengan `git-filter-repo` (Jul 2026), ukuran turun ke ~139 MB.

**How to apply:**
- Jika agent perlu menyimpan gambar hasil proses → upload ke Supabase Storage via `uploadToSupabase()` di `artifacts/api-server/src/lib/supabaseStorage.ts`, simpan URL-nya ke DB.
- Jangan pernah `import` file dari `attached_assets/` ke dalam source code (kecuali `jasa-detail.tsx` yang sudah ada — itu harus direfactor ke URL Supabase suatu saat).
- Folder yang sudah di-ignore: `attached_assets/`, `.agents/outputs/`, `screenshots/`. Jangan di-un-ignore.
- Kalau force-push ke GitHub diperlukan pasca rewrite: `git push origin --force --all`.
