# Deployment Architecture

## Ringkasan

| Komponen | Platform | Alasan |
|---|---|---|
| **API Server (Express)** | Replit Deployment | Persistent server, workers, WebSocket |
| **Background Workers** | Replit Deployment | `setInterval`, startup orchestrator |
| **WebSocket** | Replit Deployment | Real-time alerts, driver tracking |
| **Session / Cookie Auth** | Replit Deployment | Butuh domain sama dengan backend |
| **Supabase** | Supabase Cloud | Database, storage, realtime, auth portal |
| **BizPortal (React/Vite)** | Replit Deployment *(default)* | Session cookie sama domain |
| **Customer Portal (React/Vite)** | Replit Deployment *(default)* | Proxy `/api` lewat Gateway |
| **Logistic Order Shim** | Replit Deployment | Redirect ke customer portal |

---

## Kenapa Backend Tidak Bisa di Vercel

Backend (`artifacts/api-server`) memiliki:

- `app.listen()` — persistent TCP server
- **15 background workers** via `startupOrchestrator`: IMAP poller, WA retry, workflow worker,
  driver job worker, DB backup scheduler, recurring expense, rekonsiliasi, sport center sync, dll.
- **WebSocket server** — real-time Intelligence Alerts
- **Startup migration chain** — 30+ DB migrations berantai saat boot
- **In-memory state** — `migrationsComplete`, circuit breakers, retry queues

Semua ini tidak kompatibel dengan Vercel serverless functions (timeout, stateless, no persistent process).

---

## Arsitektur Production (Replit)

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  Replit Deployment  (satu domain, misal:            │
│  https://api-server-xxx.replit.app)                 │
│                                                     │
│  Gateway (port 5000)                                │
│    ├── /bizportal/*       → BizPortal (18442)       │
│    ├── /customer-portal/* → Customer Portal (23434) │
│    ├── /api/*             → API Server (18444)      │
│    ├── /logistic-order/*  → Logistic Shim (19368)   │
│    └── /wa-gateway/*      → WA Gateway (8000)       │
│                                                     │
│  API Server (port 8080→18444)                       │
│    ├── Express routes                               │
│    ├── Session auth (cookie-based)                  │
│    ├── Supabase auth (bearer, portal/mobile)        │
│    └── 15+ background workers                       │
└─────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
   Supabase DB           Replit Object
   + Storage             Storage
   + Realtime
```

---

## Opsi: BizPortal di Vercel (Advanced)

BizPortal bisa di-deploy ke Vercel sebagai static site **jika dan hanya jika**:

1. Replit backend sudah di-deploy dan punya domain tetap
2. `vercel.json` di `artifacts/bizportal/` dikonfigurasi dengan Replit backend URL
3. Vercel rewrites memproxy `/api/*` dan `/objects/*` ke Replit backend
4. CORS backend diset untuk menerima domain Vercel (`CORS_EXTRA_ORIGINS`)
5. Cookie session: backend harus set `SameSite=None; Secure; Domain=<shared-parent-domain>`
   atau gunakan custom domain yang sama parent-nya

Config sudah tersedia di `artifacts/bizportal/vercel.json`.

**⚠️ Catatan**: Cookie session cross-domain memerlukan konfigurasi `SameSite=None` yang saat ini
belum diset. Vercel deployment untuk BizPortal hanya direkomendasikan jika menggunakan
custom domain yang satu parent dengan backend.

---

## Customer Portal di Vercel (Lebih Mudah)

Customer Portal menggunakan Supabase bearer token (bukan session cookie), sehingga lebih
mudah di-deploy terpisah ke Vercel. Tetap perlu:

1. Vercel rewrites `/api/*` → Replit backend
2. `CORS_EXTRA_ORIGINS` di backend mencakup domain Vercel customer portal
3. `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` di-set di Vercel project settings

---

## Environment Variables

### Backend (Replit Secrets)

| Var | Keterangan |
|---|---|
| `FONNTE_TOKEN` | Fonnte WhatsApp API token |
| `FONNTE_ADMIN_WA` | Fallback WA admin group ID |
| `ADMIN_EMAIL` | Email admin |
| `SMTP_HOST/USER/PASS` | SMTP untuk email |
| `PORTAL_ADMIN_KEY` | Klaim admin customer portal |
| `CASHIER_TOKEN_SECRET` | Token kasir POS |
| `SUPABASE_DATABASE_URL` | PostgreSQL connection string |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `APP_URL` | Base URL deployment (untuk CORS) |
| `CORS_EXTRA_ORIGINS` | Comma-separated extra CORS origins (misal domain Vercel) |

### Frontend Vercel (jika di-deploy ke Vercel)

| Var | Keterangan |
|---|---|
| `VITE_API_BASE_URL` | Replit backend URL (misal `https://api-xxx.replit.app`) |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `BASE_PATH` | Set ke `/` untuk Vercel (default `/bizportal/`) |

---

## File yang Sudah Dihapus

- `vercel.json` (root) — backend tidak kompatibel Vercel
- `artifacts/api-server/vercel.json` — sama

## File Konfigurasi Deployment

- `artifacts/bizportal/vercel.json` — config Vercel untuk BizPortal (jika dibutuhkan)
- `artifacts/api-server/build.mjs` — production build, auto-compile `lib/db` + `lib/api-zod`
- `artifacts/api-server/start-dev.sh` — dev startup, auto-compile libs + start server
- `gateway.mjs` — reverse proxy untuk semua service
