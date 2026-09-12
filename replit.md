# CST Super App

A multi-service monorepo ERP/operations platform for logistics and sport center management. Built with TypeScript, Express, React (Vite), Drizzle ORM, and Supabase.

## Project Structure

```
artifacts/
  api-server/       — Express REST API, Drizzle ORM, Supabase Postgres
  bizportal/        — Admin/back-office dashboard (React + Vite)
  customer-portal/  — Public-facing customer app (React + Vite)
  logistic-order/   — Logistics order management
  qr-menu/          — QR-based menu/ordering
  mockup-sandbox/   — UI prototyping sandbox
config/             — Shared configuration
docs/               — Architecture and deployment documentation
```
## Architecture

### Sub-apps (`artifacts/`)
| App | Port | Purpose |
|-----|------|---------|
| `api-server` | 18444 | Core REST API (Express + Drizzle ORM + Supabase Postgres) |
| `bizportal` | 18442 | Admin/back-office UI (React + Vite) |
| `customer-portal` | 23434 | Customer-facing storefront/booking UI |
| `logistic-order` | 19368 | Logistics order management UI |
| `customer-poster` | — | Customer poster/print generation |
| `qr-menu` | — | QR-code menu viewer |
| `mockup-sandbox` | — | UI component mockup sandbox |

## Key Architecture Decisions

- **Gateway on port 5000** routes to all internal services
- **APP_ENV** (not NODE_ENV) is the source of truth for dev vs. prod
- **GCP Secret Manager** loads production secrets at startup; dev secrets come from Replit Secrets
- **Supabase** for database (separate dev and prod projects)
- **Accounting entries are immutable** — no updates/deletes on posted journals; reversal only
- **AI is advisor only** — never auto-approves or auto-posts financial entries

## Required Secrets (to run)

See `.env.example` for the full list. Minimum to start the API:
- `GCP_PROJECT_ID`, `GCP_SECRET_ID`, `GCP_SECRET_MANAGER_BOOTSTRAP_JSON`
- `SUPABASE_DATABASE_URL_DEV`
- `SESSION_SECRET`

## To Run (development)

```bash
pnpm install
bash start-dev.sh
```

The gateway starts on port 5000 and proxies to all sub-services.
| Secret | Purpose |
|---|---|
| `GCP_PROJECT_ID` | GCP project that owns the Secret Manager secrets |
| `GCP_SECRET_ID` | Secret name in Secret Manager (e.g. `replit-app-secrets`) |
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | Service account JSON with `roles/secretmanager.secretAccessor` |
| `SUPABASE_DATABASE_URL_DEV` | PostgreSQL connection string for the **dev** Supabase project |
| `SUPABASE_URL_DEV` | Supabase API URL for the dev project |
| `SUPABASE_ANON_KEY_DEV` | Anon key for the dev project |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | Service role key for the dev project |

All other application secrets (OpenAI, Paylabs, SMTP, etc.) are loaded automatically from Google Cloud Secret Manager at startup via `load-secrets.mjs`. The `_DEV` Supabase keys above are read from Replit Secrets directly as a local override.

### Services & Ports

| Service | Dev Port | Workflow name |
|---|---|---|
| API Server | 18444 | `artifacts/api-server: API Server` |
| BizPortal (admin) | 18442 | `artifacts/bizportal: web` |
| Customer Portal | 23434 | `artifacts/customer-portal: web` |
| Logistic Order | varies | `artifacts/logistic-order: web` |

### Start / Restart

Each service has its own workflow. Start or restart them from the Workflows panel. The API server must be running for the frontends to function fully.

```bash
# Install all dependencies (run once after cloning or adding packages)
pnpm install
```

## Key Documentation

- `AI_ARCHITECTURE_GUARDRAILS.md` — Architecture constitution
- `ARCHITECTURE_DECISIONS.md` — Formal ADRs
- `AI_RULES.md` — Rules for AI agents
- `docs/ui-color-contrast-guidelines.md` — Aturan kontras warna untuk UI BizPortal bertema gelap
- `docs/` — Deployment, secret architecture, and more

## User Preferences

- This project was imported for exploration/study purposes only.
- `APP_ENV=development` is enforced in every `start-dev.sh` — never change this.
- `load-secrets.mjs` runs before the server starts and injects secrets. `*_DEV` keys from GCP (or Replit Secrets) are promoted to their canonical names in dev mode.
- The API server will **refuse to start** if it detects a production database in development mode. Always ensure `SUPABASE_DATABASE_URL_DEV` is set.
- See `AI_ARCHITECTURE_GUARDRAILS.md` and `ARCHITECTURE_DECISIONS.md` for immutable architecture rules.

## User preferences

- Keep the existing monorepo structure and stack
- Use pnpm (not npm or yarn)

---

## ⚠️ Aturan Wajib: Aset Gambar & File Biner

### DILARANG keras: menyimpan gambar/biner di git

Semua gambar, foto produk, foto menu, ilustrasi, dan file biner **WAJIB** disimpan di **Supabase Storage**, bukan di dalam repository git. Ini aturan permanen yang tidak boleh dilanggar oleh agen maupun developer.

**Yang DILARANG di-commit ke git:**
- File `*.png`, `*.jpg`, `*.jpeg`, `*.webp`, `*.gif` di dalam folder `public/` atau `assets/` manapun (kecuali yang dikecualikan di bawah)
- File upload hasil user (`pos-images/`, `portal/images/`, dsb.)
- Foto menu, foto produk, foto marketing, foto testimonial
- Screenshot atau gambar dokumentasi besar (>100KB)
- File biner apapun yang bisa berubah-ubah

**Yang BOLEH tetap di git (bawaan framework/build tool):**
| File | Alasan |
|------|--------|
| `favicon.svg` | Icon kecil, bagian dari build |
| `*/public/opengraph.jpg` | OG image statis untuk SEO — boleh di git jika <200KB |
| Logo vector (`*.svg`) | Ukuran kecil, bukan foto |

### Cara benar menyimpan gambar

```
1. Upload ke Supabase Storage via API:
   PUT /api/storage/upload  (bucket: portal/images/, pos-images/, menu/, dll.)

2. Simpan URL Supabase ke database (tabel products, menu_items, dst.)

3. Di frontend: gunakan URL Supabase langsung (bukan path lokal /public/...)
   Contoh: https://<project>.supabase.co/storage/v1/object/public/portal/images/hero.webp
```

### Status migrasi (per Agustus 2026)

| Folder | Status | Jumlah file | Prioritas |
|--------|--------|-------------|-----------|
| `customer-portal/public/images/` | ❌ Belum | ~150 file, 152MB | 🔴 Tinggi |
| `customer-portal/public/menu/` | ❌ Belum | ~20 file | 🔴 Tinggi |
| `bizportal/public/menu/` | ❌ Belum | ~10 file | 🟡 Sedang |
| `api-server/public/pos-images/` | ❌ Belum | 2 file | 🟡 Sedang |
| `bizportal/public/Screenshot_*.jpg` | ❌ Hapus | 4 file | 🟡 Sedang |
| `logistic-order/public/logocst*.jpg` | ❌ Belum | 2 file | 🟢 Rendah |

**Total gambar yang harus dimigrasikan: ±223 file**

### Untuk agen AI: instruksi wajib

Jika kamu (agen AI) perlu menambah gambar ke project ini:
1. **JANGAN** copy file ke folder `public/` atau `assets/`
2. **JANGAN** commit file gambar ke git
3. **WAJIB** gunakan Supabase Storage: upload via `uploadToSupabase()` di `artifacts/api-server/src/lib/supabaseStorage.ts`
4. Simpan URL hasil upload ke database, bukan path lokal
5. Jika ragu, tanya dulu sebelum menyimpan file biner apapun
