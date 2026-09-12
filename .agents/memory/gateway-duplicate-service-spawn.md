---
name: Gateway duplicate service spawn
description: Gateway workflow re-spawning artifact services that already have dedicated workflows causes EADDRINUSE crash loops.
---

Setelah artifact workflows (api-server, bizportal, customer-portal, logistic-order) terdaftar, `start-dev-all.sh` TIDAK boleh spawn service tersebut lagi — hanya jalankan Watchdog + gateway.mjs, lalu `wait_for_port` untuk setiap port artifact.

**Why:** `start-dev.sh` API server memiliki guard `check_port` tapi ada race condition: kedua proses (Gateway spawn + artifact workflow) bisa lolos cek bersamaan sebelum salah satunya bind port internal 18445 → EADDRINUSE crash-loop. Fixed delay (12s) tidak cukup karena artifact workflow butuh ~40s untuk build lib/db dan bind port.

**Solusi yang benar:** `start-dev-all.sh` hanya menjalankan:
1. Watchdog (self-respawning loop)
2. `node gateway.mjs`

Dan menunggu port upstream via `wait_for_port`/`wait_for_api_healthy` — tidak spawn sendiri. Artifact workflows yang mengurus upstream services sepenuhnya.

**How to apply:** Jika EADDRINUSE muncul di artifact workflow setelah Gateway restart, cek apakah `start-dev-all.sh` masih punya blok spawn untuk service tersebut. Hapus semua blok spawn upstream — ganti dengan wait_for_port saja.
