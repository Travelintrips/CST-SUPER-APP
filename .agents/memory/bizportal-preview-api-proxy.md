---
name: BizPortal preview API proxy
description: Preview BizPortal harus meneruskan request /api ke API server port 18444 (bukan 8080).
---

API server artifact workflow mengikat port **18444** (`API_PORT=18444` di `artifacts/api-server/start-dev.sh`). BizPortal Vite proxy (`vite.config.ts`) membaca `process.env.API_PORT ?? process.env.FORWARDER_PORT ?? 8080` — fallback defaultnya 8080 sehingga semua `/api/*` gagal dengan ECONNREFUSED kalau env var tidak di-set.

**Fix yang diterapkan (Agustus 2026):** tambah `API_PORT=${API_PORT:-18444}` di depan perintah Vite di `artifacts/bizportal/start-dev.sh`.

**Why:** Proxy Vite di-start oleh bash, jadi env var harus di-inject eksplisit; env artifact workflow tidak otomatis mewariskan ke proses Vite.

**How to apply:** Setiap kali API port berubah, update nilai default di `start-dev.sh` baris perintah Vite, atau set `API_PORT` sebagai env di workflow BizPortal.

**Tanda masalah:** browser console 500 pada `/api/auth/user`, `/api/dev-users`, `/api/translations/*` saat BizPortal baru start.