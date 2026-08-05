---
name: ECIRCUITBREAKER Session Resilience
description: Saat pgBouncer ECIRCUITBREAKER aktif, getSession DB query gagal → return null → authMiddleware treat sebagai unauthenticated → 401 pada semua endpoint.
---

## Masalah
`getSession(sid)` → DB query (Drizzle) → ECIRCUITBREAKER throw → catch → return null → `session?.user` falsy → authMiddleware skip auth → `req.user` tidak di-set → `req.isAuthenticated()` = false → endpoint yang require auth return 401.

Ini terjadi walaupun user sudah login, karena:
1. Server restart → `_sessionReadCache` kosong
2. CB aktif karena startup workers membanjiri pooler dengan koneksi yang timeout
3. Request pertama masuk → getSession → null → 401

## Fix
Tiga layer perbaikan di `lib/auth.ts`, `authMiddleware.ts`, `lib/db/src/index.ts`:

### 1. `lib/auth.ts` — read-through cache + cache-only export
- `_sessionReadCache`: Map (max 500 entries) yang diisi setiap kali DB read berhasil
- `getSession` catch block: jika ada cached entry, return dari cache (bukan null)
- Export `getSessionFromCacheOnly(sid)`: check `_memSessions` then `_sessionReadCache`, no DB

### 2. `authMiddleware.ts` — CB fallback
Setelah `getSession` return null, cek `getCircuitBreakerStatus().open`. Jika CB aktif, call `getSessionFromCacheOnly(sid)`. Jika cache ada data, gunakan untuk req.user.
Session yang cached = pernah diverifikasi dari DB sebelum CB terbuka, aman untuk dipercaya selama window CB.

### 3. `lib/db/src/index.ts` — kurangi timeout
`connectionTimeoutMillis`: 20000 → 8000. Fail faster, kurangi tekanan ke pgBouncer yang menyebabkan ECIRCUITBREAKER.

**Why:** pgBouncer ECIRCUITBREAKER adalah defense mechanism yang memblokir koneksi baru saat terlalu banyak auth failure. Jika timeout 20s dan ada 2 pool conn, server bisa hang 40s per request sebelum CB aktif. Dengan 8s timeout, CB terbuka lebih cepat tapi juga lebih sedikit req yang menunggu.

**How to apply:** Jika session 401 dilaporkan saat DB/Supabase pooler tidak stabil, cek apakah CB aktif via `GET /api/sport-center/sync/debug` dan lihat field `circuitBreaker.open`.

## Debug endpoint
`GET /api/sport-center/sync/debug` — selalu return JSON (outer try-catch), root cause analysis per kategori, CB info detail. Perlu auth admin.
