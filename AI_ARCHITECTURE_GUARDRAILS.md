# AI ARCHITECTURE GUARDRAILS

> **Architecture Constitution — CST Super App**
>
> Dokumen ini adalah referensi permanen untuk semua AI agent
> (Replit Agent, Cursor, Copilot, Claude, Gemini, dan lainnya).
> Baca dokumen ini **sebelum** menyentuh kode apapun.

---

## ⚠️ PERINGATAN KERAS

Perilaku berikut **telah terjadi berulang kali** dan **TIDAK BOLEH terulang**:

- Menggabungkan dev dan production environment
- Menghapus `APP_ENV` atau menggantinya dengan `NODE_ENV`
- Mengganti GCP Secret Manager dengan Replit Secrets
- Membuat satu startup script untuk semua environment
- Menggabungkan database dev dan production
- Menyederhanakan secret loader
- Menghapus isolasi environment

**Semua hal di atas adalah pelanggaran arsitektur.**

---

## SECTION 1 — PROJECT ARCHITECTURE

### Environment Map

```
┌─────────────────────────────────────────────────────────────┐
│                    CST Super App Environments               │
├──────────────┬──────────────┬────────────┬──────────────────┤
│ Development  │ Production   │ QA/Staging │ Local Testing    │
├──────────────┼──────────────┼────────────┼──────────────────┤
│ APP_ENV=dev  │ APP_ENV=prod │ APP_ENV=qa │ NODE_ENV=test    │
│ dev.mjs      │ production   │ (subset of │ vitest           │
│ Replit DB    │ .mjs         │ production │ In-memory / mock │
│ Replit Sec.  │ GCP Sec. Mgr │ config)    │ No real DB       │
│ *_DEV keys   │ Prod keys    │            │                  │
└──────────────┴──────────────┴────────────┴──────────────────┘
```

### Setiap environment adalah ENTITAS TERPISAH

- Database berbeda
- Secret berbeda
- Startup script berbeda
- Tidak ada sharing, tidak ada fallback antar environment

---

## SECTION 2 — DEVELOPMENT ENVIRONMENT

### Wajib menggunakan:

| Komponen | Nilai |
|---|---|
| `APP_ENV` | `development` |
| Startup | `dev.mjs` |
| Secrets | Replit Secrets → GCP Secret Manager (`*_DEV` keys) |
| Database | `SUPABASE_DATABASE_URL_DEV` |
| Port API | `18444` |

### DILARANG:

- ❌ Mengakses production database
- ❌ Menggunakan production credentials
- ❌ Menghapus `APP_ENV=development`
- ❌ Memakai `SUPABASE_DATABASE_URL` tanpa `_DEV` suffix di dev environment
- ❌ Mem-fallback ke production jika dev DB tidak tersedia

### Alur Secret di Development:

```
Replit Secrets
  GCP_PROJECT_ID + GCP_SECRET_ID + GCP_SECRET_MANAGER_BOOTSTRAP_JSON
        ↓
load-secrets.mjs  (APP_ENV=development)
  – Membaca payload dari GCP Secret Manager
  – Meng-inject *_DEV keys sebagai canonical names
  – Contoh: SUPABASE_DATABASE_URL_DEV → SUPABASE_DATABASE_URL
        ↓
process.env.SUPABASE_DATABASE_URL  (berisi dev DB URL)
```

---

## SECTION 3 — PRODUCTION ENVIRONMENT

### Wajib menggunakan:

| Komponen | Nilai |
|---|---|
| `APP_ENV` | `production` |
| Startup | `production.mjs` atau `npm run start:secure` |
| Secrets | GCP Secret Manager saja |
| Database | `SUPABASE_DATABASE_URL` (production pool) |

### DILARANG:

- ❌ Memakai Replit Secrets untuk secret production (kecuali 3 bootstrap key)
- ❌ Menyimpan production DB URL di Replit Secrets
- ❌ Menghapus `production.mjs`
- ❌ Menggabungkan `dev.mjs` dan `production.mjs` menjadi satu file

### Alur Secret di Production:

```
Replit Secrets  (hanya 3 bootstrap keys)
        ↓
GCP Secret Manager
  – Hanya production keys (tanpa _DEV suffix)
        ↓
load-secrets.mjs  (APP_ENV=production)
  – Inject production keys langsung
        ↓
process.env.SUPABASE_DATABASE_URL  (berisi production DB URL)
```

---

## SECTION 4 — DATABASE ISOLATION

### Aturan absolut:

```
SUPABASE_DATABASE_URL_DEV   ≠   SUPABASE_DATABASE_URL
Development DB              ≠   Production DB
```

| Larangan | Alasan |
|---|---|
| Sharing credentials | Mutasi dev → production = data corruption |
| Fallback ke prod jika dev down | Tidak ada fallback yang aman |
| Menggabungkan connection pool | Isolasi adalah fitur, bukan overhead |
| Migration prod dari dev context | Harus via CI/CD terpisah |

### Guard yang ada di kodebase:

File: `artifacts/api-server/src/index.ts`  
Function: `envGuard` — memblokir startup jika production DB dipakai di dev context  
File: `docs/db-dev-prod-safety.md` — kebijakan lengkap

---

## SECTION 5 — SECRET MANAGEMENT

### Bootstrap Credential (Replit Secret)

**New mode (ADR-0005) — ONE Replit Secret:**

| Secret | Status | Description |
|---|---|---|
| `GCP_SECRET_MANAGER_BOOTSTRAP_JSON` | ✅ Replit Secret (REQUIRED) | SA JSON — project_id extracted from it |
| `GCP_PROJECT_ID` | ⚠ Deprecated (legacy compat) | Remove after migrating to new-mode bundles |
| `GCP_SECRET_ID` | ⚠ Deprecated (legacy compat) | Remove after migrating to new-mode bundles |

### GCP Bundle Matrix

| GCP Bundle Name | Fetched when | Contains |
|---|---|---|
| `cst-super-app-development` | `APP_ENV=development` | All dev secrets, flat JSON, `APP_ENV="development"` |
| `cst-super-app-production` | `APP_ENV=production` | All prod secrets, flat JSON, `APP_ENV="production"` |

### Application Secrets (NEVER in Replit)

| Secret | Location |
|---|---|
| `SUPABASE_DATABASE_URL` | 🔒 GCP bundle (dev: dev URL, prod: prod URL) |
| `SESSION_SECRET` | 🔒 GCP bundle |
| `OPENAI_API_KEY` | 🔒 GCP bundle |
| `PAYLABS_PRIVATE_KEY` | 🔒 GCP bundle |
| `FONNTE_TOKEN` | 🔒 GCP bundle |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 🔒 GCP bundle |
| Semua secret lainnya | 🔒 GCP bundle |

### AI DILARANG:

- ❌ Menyarankan menambah application secret ke Replit Secrets
- ❌ Mengganti GCP Secret Manager dengan `.env` file
- ❌ Mengganti GCP Secret Manager dengan Replit Secrets
- ❌ Menghapus `load-secrets.mjs`
- ❌ Menggabungkan mekanisme secret dev dan production
- ❌ Menyarankan developer menambah `GCP_PROJECT_ID` atau `GCP_SECRET_ID` sebagai Replit Secret baru
- ❌ Menggabungkan `cst-super-app-development` dan `cst-super-app-production` menjadi satu bundle
- ❌ Menghapus verifikasi `payload.APP_ENV` dari loader
- ❌ Menggunakan `NODE_ENV` sebagai pengganti `APP_ENV` untuk memilih GCP bundle
- ❌ Menulis `APP_ENV` dari bundle ke `process.env` (APP_ENV harus tidak pernah di-overwrite)

---

## SECTION 6 — STARTUP ISOLATION

### Dua startup script yang TIDAK BOLEH digabung:

```
dev.mjs         → Development only  → APP_ENV=development
production.mjs  → Production only   → APP_ENV=production
```

### AI DILARANG:

- ❌ Menghapus `dev.mjs`
- ❌ Menghapus `production.mjs`
- ❌ Membuat satu script yang menangani keduanya
- ❌ Menggunakan `NODE_ENV` sebagai pengganti `APP_ENV`
- ❌ Menyederhanakan startup dengan argumen `--env`

### Alasan:

Dua startup terpisah adalah **satu-satunya jaminan** bahwa dev code path tidak
pernah menyentuh production resources. Ini bukan code duplication — ini firewall.

---

## SECTION 7 — APP_ENV IS THE SOURCE OF TRUTH

```
APP_ENV=development  →  dev path  →  _DEV secrets  →  dev DB
APP_ENV=production   →  prod path →  prod secrets  →  prod DB
```

### NODE_ENV bukan pengganti APP_ENV

| Variable | Fungsi |
|---|---|
| `APP_ENV` | Routing secret dan database (CST-specific) |
| `NODE_ENV` | Library behavior (React, Express, etc.) |

Keduanya bisa berbeda secara sah:
- `APP_ENV=production` + `NODE_ENV=development` → pakai prod DB tapi enable source maps
- `APP_ENV=development` + `NODE_ENV=production` → pakai dev DB dengan prod build artifacts

### AI DILARANG:

- ❌ Menghapus `APP_ENV`
- ❌ Mengganti `APP_ENV` dengan `NODE_ENV`
- ❌ Mengasumsikan `APP_ENV === NODE_ENV`

---

## SECTION 8 — ACCOUNTING IMMUTABILITY

Journal accounting adalah **append-only, immutable**.

### Yang boleh:

- ✅ Membuat journal baru (dengan approval)
- ✅ Reversal entry (dengan approval)
- ✅ Void dengan audit trail

### Yang DILARANG:

- ❌ UPDATE journal yang sudah posted
- ❌ DELETE journal
- ❌ Overwrite accounting_entries
- ❌ Auto-approve journal tanpa human review
- ❌ Auto-post setelah auto-create

### Database trigger yang menjaga:

Table `accounting_entries` memiliki trigger `trg_block_lines_mutation` yang
memblokir modifikasi lines pada entry yang sudah `posted`.

---

## SECTION 9 — BANK RECONCILIATION: UNIVERSAL JOURNAL REUSE

### Aturan Wajib:

**Sebelum membuat journal baru, SELALU cek apakah journal sudah ada.**

Lookup order:
1. Cek `accounting_entries` WHERE `source = <source_type>` AND `source_id = <id>`
2. Jika ada → **REUSE**, link ke bank_mutation, JANGAN buat baru
3. Jika tidak ada → buat journal baru (bukan default, ini fallback)

### File implementasi:

`artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts`  
Function: `approveAndCreateJournal` (lines 644–1037)

### Known Bug (per 2026-08-03):

Lookup untuk `sport_payment` candidate type menggunakan JOIN ke kolom
`sport_payments.accounting_payment_id` yang **tidak ada**. Bug ini menyebabkan
double journal (lihat `SPORT_CENTER_DOUBLE_JOURNAL_ROOT_CAUSE.md`).

---

## SECTION 10 — AI GOVERNANCE

### AI hanya boleh:

- ✅ Recommend — merekomendasikan tindakan
- ✅ Detect — mendeteksi anomali
- ✅ Suggest — menyarankan COA mapping
- ✅ Predict — memprediksi kategori transaksi

### AI TIDAK BOLEH:

- ❌ Auto Approve — posting tanpa manusia
- ❌ Auto Post — journal langsung posted
- ❌ Auto Create Journal — tanpa approval workflow
- ❌ Auto Change COA — mengubah chart of accounts
- ❌ Bypass `MANUAL_REVIEW_REQUIRED` status

---

## SECTION 11 — COA GOVERNANCE: MAKER-CHECKER

```
Maker (propose) → Checker (approve) → COA updated
```

- Maker dan Checker WAJIB orang berbeda
- AI boleh jadi Maker (suggest), tapi tidak boleh jadi Checker
- Approval COA tanpa Checker = pelanggaran governance
- File: `COA_MASTER_GOVERNANCE.md`

---

## SECTION 12 — FAIL CLOSED POLICY

Jika kondisi error terjadi, sistem WAJIB berhenti, bukan fallback:

```
lookup gagal       →  MANUAL_REVIEW_REQUIRED (BUKAN fallback COA)
mapping gagal      →  MANUAL_REVIEW_REQUIRED (BUKAN guess)
secret hilang      →  HARD STOP startup (BUKAN pakai nilai kosong)
config hilang      →  HTTP 422 + error detail (BUKAN silent skip)
database error     →  transaction rollback (BUKAN partial commit)
```

### AI DILARANG:

- ❌ Menambahkan fallback yang menyebabkan posting tanpa mapping valid
- ❌ Mengganti `throw` dengan `console.warn` pada error kritis
- ❌ Mengubah `MANUAL_REVIEW_REQUIRED` menjadi auto-approve

---

## SECTION 13 — AI MUST NEVER (Complete List)

Ini adalah daftar larangan absolut untuk semua AI agent:

### Environment & Infrastructure

| Larangan | Dampak |
|---|---|
| Merge dev and production | Data corruption, security breach |
| Merge startup scripts | Tidak ada firewall antar environment |
| Merge secret mechanisms | Production secrets exposed ke dev |
| Merge APP_ENV logic | Environment routing rusak |
| Merge databases | Prod data bisa dimodifikasi dari dev |
| Simplify environment setup | Menghilangkan isolasi |
| Replace GCP Secret Manager | Production secrets exposed |
| Replace Replit Secrets | Bootstrap flow rusak |
| Remove architecture isolation | Full collapse of security model |
| Delete dev.mjs | Dev environment tidak bisa jalan |
| Delete production.mjs | Production tidak bisa jalan |
| Delete load-secrets.mjs | Semua secrets tidak ter-inject |
| Delete APP_ENV handling | Environment routing hilang |

### Accounting & Finance

| Larangan | Dampak |
|---|---|
| Bypass accounting rules | Neraca tidak balance |
| Bypass governance | Fraud risk |
| Bypass maker-checker | Segregation of duties violation |
| Bypass journal reuse check | Double journal, double cash movement |
| Bypass AI review queue | Unapproved COA changes |
| Auto approve journal | Unauthorized financial posting |
| Auto post without human | Violation of accounting controls |
| Update posted journal | Immutability violation |
| Delete journal | Audit trail hilang |
| Silent fallback on error | Partial journal = unbalanced ledger |

---

## Referensi Dokumen

| Dokumen | Isi |
|---|---|
| `ARCHITECTURE_DECISIONS.md` | ADR formal (ADR-0001 sampai ADR-0004) |
| `AI_RULES.md` | Rules teknis untuk AI agent |
| `docs/secret-architecture.md` | Arsitektur secret lengkap |
| `docs/db-dev-prod-safety.md` | Database isolation policy |
| `docs/deployment-architecture.md` | Deployment topology |
| `COA_MASTER_GOVERNANCE.md` | COA governance rules |
| `SPORT_CENTER_DOUBLE_JOURNAL_ROOT_CAUSE.md` | Contoh nyata bug double journal |

---

*Dokumen ini dibuat 2026-08-03. Jangan hapus, jangan overwrite — hanya UPDATE dengan append.*
