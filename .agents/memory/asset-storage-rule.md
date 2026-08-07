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
| `cst-driver/assets/images/icon.png` | Wajib ada untuk Expo build |
| `*/public/opengraph.jpg` | OG image statis untuk SEO (jika <200KB) |
| Logo vector (`*.svg`) | Ukuran kecil, bukan foto |

## Status migrasi (Agustus 2026) — BELUM dilakukan

Total ±223 file gambar masih di git, belum dipindah ke Supabase Storage:

| Folder | File | Ukuran | Prioritas |
|--------|------|--------|-----------|
| `customer-portal/public/images/` | ~150 | 152MB | 🔴 Tinggi |
| `customer-portal/public/menu/` | ~20 | ~5MB | 🔴 Tinggi |
| `bizportal/public/menu/` | ~10 | ~2MB | 🟡 Sedang |
| `api-server/public/pos-images/` | 2 | ~400KB | 🟡 Sedang |
| `bizportal/public/Screenshot_*.jpg` | 4 | ~1MB | 🟡 Hapus |
| `cst-driver/assets/hero-*.png` | 4 | ~3MB | 🟢 Rendah |
| `logistic-order/public/logocst*.jpg` | 2 | ~200KB | 🟢 Rendah |

Migrasi ini belum dikerjakan karena memerlukan: upload setiap file ke Supabase Storage, update semua referensi kode (src/href dari path lokal ke URL Supabase), kemudian hapus dari git + rewrite history.

## Aturan untuk agen AI

1. **JANGAN** copy/write file gambar ke folder `public/` atau `assets/` di monorepo.
2. **WAJIB** upload via `uploadToSupabase()` (`artifacts/api-server/src/lib/supabaseStorage.ts`).
3. Simpan URL Supabase ke tabel database yang sesuai (products, menu_items, dst.).
4. Frontend gunakan URL Supabase langsung — bukan `/public/` path.
5. Jika ragu: tanya user sebelum menyimpan file biner apapun.
