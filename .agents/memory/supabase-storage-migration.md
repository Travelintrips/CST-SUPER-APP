---
name: Supabase Storage Migration
description: Migration from Replit Object Storage (GCS) to Supabase Storage; key config, bucket names, DEV fallback pattern.
---

## Rule
`SUPABASE_SERVICE_ROLE_KEY` dalam Replit Secrets saat ini berisi nilai literal `"SUPABASE_SERVICE_ROLE_KEY"` (nama variable, bukan JWT). Sampai difix, sistem otomatis fallback ke `SUPABASE_SERVICE_ROLE_KEY_DEV` + `SUPABASE_URL_DEV`.

**Why:** User salah input secret (paste nama variable bukan nilai). Key production JWT dimulai `eyJ` dan panjangnya ~220 karakter. DEV key tersimpan benar di `SUPABASE_SERVICE_ROLE_KEY_DEV`.

**How to apply:** `objectStorage.ts` dan `dbBackup.ts` cek `_rawKey.length > 100` sebelum memilih URL+key mana yang dipakai.

## Buckets
- DEV project: `https://xssrfshdrtdfupgqwfdw.supabase.co`
  - `public-assets` (public, 50MB limit) ✅ dibuat
  - `private-uploads` (private, 50MB limit) ✅ dibuat
- Production project: `https://nzdweipzckfszczzqtuw.supabase.co` — belum ada buckets (key tidak valid)

## Upload path format
`uploadPrivateEntity()` → `/objects/uploads/<uuid>.<ext>` (private-uploads bucket, subpath `uploads/<uuid>.<ext>`)

## WebSocket config
Semua `createClient()` di Node.js harus pakai `realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket }` — tanpa ini ada warning di startup.

## SUPABASE_URL_DEV env var
Berisi `/rest/v1/` suffix — harus di-strip sebelum dipakai sebagai base URL untuk storage API: `.replace(/\/rest\/v1\/?$/, "")`.
