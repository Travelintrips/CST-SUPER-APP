# SECRET_MANAGER_RULES.md

# ============================================================
# Google Cloud Secret Manager Standards
# PT Cahaya Sejati Teknologi
# ============================================================

Version: 1.0

Status:
Mandatory

Applies To:
- BizPortal
- Customer Portal
- API Server
- Creative AI
- Sport Center
- Logistic Order
- Driver App
- Semua repository perusahaan

---

# OBJECTIVE

Seluruh credential aplikasi wajib dikelola menggunakan
Google Cloud Secret Manager.

Google Cloud Secret Manager merupakan SATU-SATUNYA
source of truth untuk seluruh secret aplikasi.

Tidak boleh ada secret yang di-hardcode,
di-commit ke repository,
atau disimpan di source code.

---

# SINGLE SOURCE OF TRUTH

Semua credential berasal dari:

Google Cloud Secret Manager

Tidak boleh menggunakan:

❌ .env.production

❌ .env.development

❌ constants.ts

❌ config.ts

❌ source code

❌ hardcoded credential

---

# REPLIT

Replit hanya boleh menyimpan bootstrap credential
yang diperlukan agar aplikasi dapat membaca
Google Cloud Secret Manager.

Bootstrap credential yang diperbolehkan:

GCP_PROJECT_ID

GCP_SECRET_ID

GCP_SECRET_MANAGER_BOOTSTRAP_JSON

Selain ketiga credential di atas,
seluruh secret harus berasal dari GCP Secret Manager.

Tidak boleh lagi menambahkan:

SUPABASE_DATABASE_URL

OPENAI_API_KEY

PAYLABS_PRIVATE_KEY

FONNTE_TOKEN

SESSION_SECRET

atau credential aplikasi lainnya ke Replit.

---

# ENVIRONMENT

Environment yang diperbolehkan hanya:

development

production

Tidak diperbolehkan menggunakan environment lain
tanpa persetujuan.

---

# ENVIRONMENT RESOLUTION

Loader wajib menentukan environment berdasarkan:

1.

APP_ENV

2.

NODE_ENV (fallback)

Contoh:

APP_ENV=development

↓

development

APP_ENV=production

↓

production

Jika keduanya tidak ada:

startup harus gagal.

Tidak boleh default ke production.

---

# SECRET NAMING

Production menggunakan nama normal.

Contoh:

SUPABASE_DATABASE_URL

OPENAI_API_KEY

PAYLABS_PRIVATE_KEY

FONNTE_TOKEN

SMTP_PASSWORD

JWT_SECRET

SESSION_SECRET

---

Development menggunakan suffix:

_DEV

Contoh:

SUPABASE_DATABASE_URL_DEV

OPENAI_API_KEY_DEV

PAYLABS_PRIVATE_KEY_DEV

FONNTE_TOKEN_DEV

SMTP_PASSWORD_DEV

JWT_SECRET_DEV

SESSION_SECRET_DEV

---

# SECRET LOADING

Loader harus menentukan secret secara otomatis.

Contoh:

APP_ENV=development

↓

ambil

SUPABASE_DATABASE_URL_DEV

↓

inject menjadi

process.env.SUPABASE_DATABASE_URL

Artinya:

seluruh aplikasi tetap menggunakan:

process.env.SUPABASE_DATABASE_URL

tanpa mengenal _DEV.

Hal yang sama berlaku untuk seluruh secret.

---

# NO DUPLICATE CODE

Kode aplikasi tidak boleh membaca:

process.env.SUPABASE_DATABASE_URL_DEV

atau

process.env.OPENAI_API_KEY_DEV

Seluruh aplikasi tetap membaca:

process.env.SUPABASE_DATABASE_URL

process.env.OPENAI_API_KEY

Loader bertugas melakukan mapping.

---

# SHARED SECRET

Jika secret memang sama antara dev dan production,
boleh dibuat sebagai Shared Secret.

Namun harus dinyatakan secara eksplisit.

Contoh:

GOOGLE_MAPS_API_KEY

atau

PUBLIC_FONT_AWESOME_KEY

Jika tidak dinyatakan,
anggap seluruh secret berbeda.

---

# STRICT ISOLATION

Development tidak boleh menggunakan secret production.

Production tidak boleh menggunakan secret development.

Tidak boleh fallback.

Contoh yang DILARANG:

development gagal membaca

SUPABASE_DATABASE_URL_DEV

↓

otomatis memakai

SUPABASE_DATABASE_URL

Hal ini tidak diperbolehkan.

---

# STARTUP VALIDATION

Saat aplikasi startup:

Loader wajib memverifikasi seluruh mandatory secret.

Jika ada yang hilang:

startup harus gagal.

Jangan menggunakan:

nilai kosong

dummy value

default value

atau fallback.

---

# ERROR REPORTING

Jika gagal:

laporkan hanya:

nama secret

contoh:

Missing Secret:

SUPABASE_DATABASE_URL_DEV

Jangan pernah menampilkan:

isi secret

password

private key

API key

database URL

token

---

# LOGGING

Yang diperbolehkan:

✓ Loaded:

OPENAI_API_KEY

✓ Loaded:

SUPABASE_DATABASE_URL

Yang DILARANG:

OPENAI_API_KEY=sk-...

SUPABASE_DATABASE_URL=postgres://...

PRIVATE_KEY=...

---

# SECRET ROTATION

Semua secret harus mendukung rotasi.

Gunakan:

versions/latest

atau version yang dikonfigurasi.

Jangan hardcode version.

---

# SECRET CACHE

Secret hanya boleh di-load sekali
saat startup.

Child process menerima:

process.env

Jangan fetch ulang seluruh secret
setiap hot reload.

---

# HOT RELOAD

Hot reload tidak boleh
mengambil ulang seluruh secret.

Loader hanya berjalan
sekali pada parent process.

---

# LOCAL DEVELOPMENT

Jika developer ingin menggunakan .env lokal,
harus menggunakan flag eksplisit.

Contoh:

USE_LOCAL_ENV=true

Default:

Google Cloud Secret Manager.

---

# SECURITY

Dilarang:

Hardcode credential

Commit credential

Print credential

Return credential

Upload credential

Log credential

Backup credential ke repository

---

# JSON SECRET

Secret yang berupa JSON
(contoh Google Service Account)

harus divalidasi.

Jika JSON invalid:

startup gagal.

---

# DATABASE

Database URL wajib berasal dari Secret Manager.

Tidak boleh:

hardcode

atau

commit ke repository.

---

# OPENAI

API Key OpenAI wajib berasal dari Secret Manager.

Tidak boleh berada di source code.

---

# PAYLABS

Private Key Paylabs
wajib berasal dari Secret Manager.

---

# SUPABASE

Seluruh credential Supabase berasal dari Secret Manager.

Development menggunakan:

SUPABASE_DATABASE_URL_DEV

Production menggunakan:

SUPABASE_DATABASE_URL

---

# GITHUB TOKEN

GitHub PAT wajib berasal dari Secret Manager.

---

# FONNTE

FONNTE_TOKEN

FONNTE_TOKEN_DEV

mengikuti environment.

---

# REPORT

Setiap perubahan pada Secret Manager
harus melaporkan:

Root Cause

Environment

Files Changed

Secret Resolution Flow

Startup Validation

Loaded Secret Names
(tanpa nilai)

Test Result

Risk

Deployment Notes

---

# FORBIDDEN

Tidak boleh:

Fallback Development → Production

Fallback Production → Development

Dummy Secret

Hardcoded Secret

Duplicate Secret

Commit Secret

Print Secret

Silent Catch

Skip Validation

---

# SUCCESS CRITERIA

Sistem dianggap benar apabila:

✓ Development selalu menggunakan *_DEV

✓ Production selalu menggunakan secret normal

✓ Seluruh aplikasi membaca nama environment yang sama

✓ Tidak ada perubahan pada business logic

✓ Tidak ada secret di repository

✓ Tidak ada credential di log

✓ Startup gagal jika mandatory secret hilang

✓ Seluruh credential berasal dari Google Cloud Secret Manager

---

END OF DOCUMENT
