---
name: BizPortal preview API proxy
description: Preview BizPortal harus meneruskan request /api ke API server port 18444 (bukan 8080).
---

API server artifact workflow mengikat port **18444** (`API_PORT=18444` di `artifacts/api-server/start-dev.sh`). BizPortal Vite proxy (`vite.config.ts`) membaca `process.env.API_PORT ?? process.env.FORWARDER_PORT ?? 8080` — fallback defaultnya 8080 sehingga semua `/api/*` gagal dengan ECONNREFUSED kalau env var tidak di-set.

**Fix yang diterapkan (Agustus 2026):** tambah `API_PORT=${API_PORT:-18444}` di baris launch Vite di `artifacts/bizportal/start-dev.sh`:

```bash
APP_ENV=${APP_ENV:-development} NODE_ENV=development API_PORT=${API_PORT:-18444} \
  node ../api-server/load-secrets.mjs node node_modules/vite/bin/vite.js \
  --config vite.config.ts --host 0.0.0.0 --port "${VITE_PORT}"
```

**Why:** Proxy Vite di-start oleh bash, jadi env var harus di-inject eksplisit; env artifact workflow tidak otomatis mewariskan ke proses Vite. Fix sebelumnya pernah hilang — pastikan baris ini tidak dihapus.

**How to apply:** Setiap kali API port berubah, update nilai default di baris launch Vite di `start-dev.sh`, atau set `API_PORT` sebagai env di workflow BizPortal.

**Tanda masalah:** browser console 500 pada `/api/auth/user`, `/api/dev-users`, `/api/translations/*` saat BizPortal baru start; dev user dropdown kosong di halaman login.
