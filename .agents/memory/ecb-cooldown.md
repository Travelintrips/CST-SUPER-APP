---
name: ECB cooldown dev vs prod
description: Dev ECB cooldown tuning and startup probe CB trigger scope
---

## Rules

### 1. Dev ECB_PAUSE_MS = 55 seconds (bukan 2 menit atau 30 menit)
Dalam `lib/db/src/index.ts`:
```ts
const ECB_PAUSE_MS = isProdEnv ? 5 * 60 * 1000 : 55 * 1000;
```

### 2. Startup probe hanya set CB untuk pgBouncer throttle, BUKAN credential error
```ts
const isPgBouncerThrottle =
  msg.includes("ECIRCUITBREAKER") ||
  msg.includes("too many authentication failures");
// Jangan pakai: msg.includes("password authentication failed")
```

## Why
- 30 menit terlalu lama — semua query blocked setengah jam.
- 2 menit menyebabkan **infinite loop**: startup migration retry backoff max 120s = sama dengan CB 120s → setiap retry tiba tepat saat CB reset → tidak pernah clear.
- 55 detik: backoff attempt ke-4 adalah 60s > 55s → CB sudah expired sebelum attempt ke-4 → loop berhenti dalam ~90 detik.
- "password authentication failed for user 'postgres'" adalah credential error (salah DB URL atau Replit native PG), BUKAN pgBouncer throttle. Jika ini di-set sebagai CB, setiap server restart akan blokir semua query selama 55s tanpa alasan.

## How to apply
1. `ECB_PAUSE_MS = 55 * 1000` di `lib/db/src/index.ts` untuk dev
2. Startup probe check: hanya match "ECIRCUITBREAKER" atau "too many authentication failures"
3. Jika CB terpicu dan loop: jangan `rm -f /tmp/db-startup-cb.json` lalu restart (akan trigger ulang) — biarkan CB expire natural (55s), baru restart
