---
name: Asset storage rule
description: Gambar dan file biner harus ke Supabase Storage, bukan git. History sudah di-rewrite. Status migrasi dan aturan lengkap ada di sini.
---

## Aturan

Semua gambar, PDF, dan file biner harus disimpan di **Supabase Storage** dan direferensi via URL — bukan di-commit ke git.

**Why:** Repository pernah membengkak sampai 475 MB karena `attached_assets/` (chat uploads) dan `.agents/outputs/` (agent renders) ikut ter-commit. History sudah di-rewrite dengan `git-filter-repo` (Jul 2026), ukuran turun ke ~139 MB. Aturan ini ada agar history tidak membengkak lagi.

**How to apply:**
- Jika perlu menyimpan gambar hasil proses → upload ke Supabase Storage via `uploadToSupabase()` di `artifacts/api-server/src/lib/supabaseStorage.ts`, simpan URL-nya ke DB.
- Jangan pernah `import` atau copy file gambar ke dalam `public/` atau `assets/` di source code.
- Folder yang sudah di-ignore di .gitignore: `attached_assets/`, `.agents/outputs/`, `screenshots/`, semua `*/dist/`. Jangan di-un-ignore.
- Kalau force-push ke GitHub diperlukan pasca rewrite: `git push origin --force --all`.

## Yang BOLEH tetap di git

| File | Alasan |
|------|--------|
| `favicon.svg` | Icon kecil, bagian dari build |
| `*/public/opengraph.jpg` | OG image statis untuk SEO (jika <200KB) |
| Logo vector (`*.svg`) | Ukuran kecil, bukan foto |

## Status migrasi (Agustus 2026) — SELESAI

231 file gambar telah diupload ke Supabase Storage (`public-assets` bucket) dan di-rm dari git tracking. Semua referensi kode di-update ke storage URLs.

| Folder | Status | Storage path prefix |
|--------|--------|---------------------|
| `customer-portal/public/images/` | ✅ Selesai | `portal-assets/static/customer-portal/images/` |
| `customer-portal/public/menu/` | ✅ Selesai | `portal-assets/static/customer-portal/menu/` |
| `bizportal/public/menu/` | ✅ Selesai | `portal-assets/static/bizportal/menu/` |
| `api-server/public/pos-images/` | ✅ Selesai | `pos-images/` |
| `bizportal/public/Screenshot_*.jpg` | ✅ Dihapus | — |
| `logistic-order/public/logocst*.jpg` | ✅ Selesai | `portal-assets/static/logistic-order/` |

URL format untuk frontend: `/api/storage/public-objects/{storagePath}`
staticAssets.ts canonical root: `/api/storage/public-objects/portal-assets/static/customer-portal/`

**Catatan:** File masih ada di disk lokal (tidak dihapus fisik) agar dev lokal tidak rusak, tapi tidak di-track git. Jika repo di-clone ulang, file tidak ada — itu benar.

## Aturan untuk agen AI

1. **JANGAN** copy/write file gambar ke folder `public/` atau `assets/` di monorepo.
2. **WAJIB** upload via `uploadToSupabase()` (`artifacts/api-server/src/lib/supabaseStorage.ts`).
3. Simpan URL Supabase ke tabel database yang sesuai (products, menu_items, dst.).
4. Frontend gunakan URL Supabase langsung — bukan `/public/` path.
5. Jika ragu: tanya user sebelum menyimpan file biner apapun.
