---
name: Supabase Storage Migration
description: Migration from Replit Object Storage (GCS) to Supabase Storage; key config, bucket names, DEV fallback pattern.
---

## Rule
Seluruh jalur object storage aktif menggunakan Supabase Storage melalui `ObjectStorageService`; pemilihan kredensial dipisahkan oleh `APP_ENV` dan tidak boleh fallback dari production ke DEV.

**Why:** Storage Replit/GCS tidak boleh menjadi backend aktif. Fallback lintas environment dapat menulis file ke project Supabase yang salah dan mencampur data development dengan production.

**How to apply:** `objectStorage.ts` memilih URL/key berdasarkan `APP_ENV`, hanya menerima hosted Supabase URL, dan memakai bucket `public-assets` atau `private-uploads`. Jangan menambahkan fallback Replit/GCS.

## Buckets
- DEV project: `https://xssrfshdrtdfupgqwfdw.supabase.co`
  - `public-assets` (public, 50MB limit) ✅ dibuat
  - `private-uploads` (private, 50MB limit) ✅ dibuat
- Production project: `https://nzdweipzckfszczzqtuw.supabase.co`
  - `public-assets` (public, 50MB limit) ✅ tersedia
  - `private-uploads` (private, 50MB limit) ✅ tersedia

## Upload path format
`uploadPrivateEntity()` → `/objects/uploads/<uuid>.<ext>` (private-uploads bucket, subpath `uploads/<uuid>.<ext>`)

## WebSocket config
Semua `createClient()` di Node.js harus pakai `realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket }` — tanpa ini ada warning di startup.

## SUPABASE_URL_DEV env var
Berisi `/rest/v1/` suffix — harus di-strip sebelum dipakai sebagai base URL untuk storage API: `.replace(/\/rest\/v1\/?$/, "")`.
