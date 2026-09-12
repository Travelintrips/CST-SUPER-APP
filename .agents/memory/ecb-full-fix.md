---
name: ECIRCUITBREAKER full fix
description: Semua layer fix untuk session 401 akibat pgBouncer ECIRCUITBREAKER throttle saat server restart.
---

## Root Cause

Supabase pgBouncer (port 6543) mengembalikan `FATAL: (ECIRCUITBREAKER) too many authentication failures` saat terlalu banyak concurrent auth attempts. Di server restart, burst koneksi dari 16+ background workers + route-level top-level DB calls memicu throttle ini. Setelah CB aktif, `getSession()` gagal → 401 untuk semua authenticated request.

**Why:** pgBouncer throttle adalah server-side state yang persisten — server restart tidak meng-clear-nya. Setiap restart langsung kena throttle lagi jika dilakukan terlalu cepat.

## Fix Layers (semua harus ada)

### Layer 1: Session cache fallback (auth)
- `artifacts/api-server/src/lib/auth.ts` — export `getSessionFromCacheOnly()`
- `artifacts/api-server/src/middlewares/authMiddleware.ts` — jika CB open, gunakan `getSessionFromCacheOnly()` sehingga session tetap valid dari cache tanpa query DB baru.

### Layer 2: Pool circuit breaker (lib/db)
- `lib/db/src/index.ts` — patch `pool.connect` untuk mendeteksi ECIRCUITBREAKER dan memblokir semua koneksi baru secara lokal selama 5 menit (ECB_PAUSE_MS).
- Jika `pool.connect` mendapat ECIRCUITBREAKER → set `ecbBlockedUntil`, semua connect berikutnya langsung rejected lokal (tanpa hit pgBouncer).

### Layer 3: Startup probe (TOP-LEVEL AWAIT)
- `lib/db/src/index.ts` — `await (async function startupProbe()...)()` — probe pgBouncer dengan temp raw pool (tanpa CB patch) DI MODULE LEVEL sebelum export resolve.
- Jika pgBouncer throttled saat startup → CB lokal di-set proaktif SEBELUM route-level top-level DB calls (approvalWorkflow, cashAdvances, paymentProof, dll.) sempat hit pgBouncer.
- **KRITIS**: Harus top-level await, bukan IIFE biasa. IIFE async tidak block importer sehingga route-level code jalan concurrently dan masih bisa trigger CB via pool.connect-cb.

### Layer 4: Startup orchestrator (worker stagger)
- `artifacts/api-server/src/lib/startupOrchestrator.ts` — `registerWorker(name, fn, delayMs)` + `startAll()`.
- Workers dengan delayMs > 0 dijadwalkan via setTimeout; jika CB open saat jadwal, retry setelah CB expire + small jitter.
- Delay slots: 0s (no-DB workers), 10s, 12s, 15s, 20s, 30s, ..., 68s untuk 16 workers.
- `index.ts` mengganti semua direct worker calls dengan `registerWorker(...)` + `startAll()`.

### Layer 5: Pool config env vars
- `lib/db/src/index.ts` — `PG_POOL_MAX` (dev=3, prod=5), `PG_IDLE_TIMEOUT_MS`, `PG_CONNECTION_TIMEOUT_MS` dari env vars.
- Dev default max=3 (bukan 5 atau lebih) untuk mengurangi tekanan pgBouncer.

### Layer 6: Admin diagnostic endpoints
- `GET /api/system/db-connections` — CB status + pool stats
- `POST /api/system/reset-circuit-breaker` — manual reset CB (admin only, pakai setelah pgBouncer pulih)
- `GET /api/system/startup-workers` — status semua worker dari orchestrator
- `GET /api/system/runtime-check` — startup validator result

### Layer 7: startupValidator checkPg fix
- `artifacts/api-server/src/lib/startupValidator.ts` — pakai `pingDbNoCb()` (exported dari lib/db) bukan `pool.query()`, sehingga health check tidak trigger CB lokal.

## How to Apply

- Setiap perubahan schema/route di lib/db: `cd artifacts/api-server && node build.mjs` lalu restart workflow.
- Jika ECIRCUITBREAKER tetap setelah 5+ menit: cek credentials di SUPABASE_DATABASE_URL (pgBouncer user/password).
- Jika ingin force-clear CB lokal: `POST /api/system/reset-circuit-breaker` (admin endpoint).
- Kalau pgBouncer masih throttle setelah credentials benar: tunggu pgBouncer auto-reset (~5-10 menit tanpa connection attempts), atau restart dari Supabase dashboard.

## Known Limitations

- Startup probe masih membuat 1 connection attempt ke pgBouncer saat server start. Kalau pgBouncer throttle persisten (credentials benar-benar salah), server akan selalu CB.
- Migrations yang gagal saat CB open tidak auto-retry setelah CB expire — mereka hanya retry via `runWithRetry` di migration chain.
- Route-level top-level DB calls (paymentProof, oceanFreight, approvalWorkflow, cashAdvances) masih ada; mereka gagal dengan CB lokal error (tidak hit pgBouncer), yang OK.
