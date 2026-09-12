# RUNTIME DATABASE POLICY — CST-SUPER-APP

## TUJUAN

Dokumen ini adalah **aturan wajib** untuk semua audit, debugging, remediation, migration, UAT, dan runtime verification.

Tujuannya agar agent/Replit **langsung menggunakan database runtime aplikasi yang benar** dan tidak membuang waktu memeriksa database workspace/Helium yang bukan source of truth aplikasi.

---

# 1. DATABASE SOURCE OF TRUTH

## APPLICATION DATABASE

Source of truth aplikasi adalah:

**Supabase PostgreSQL**

Bukan:

* Replit Database
* Helium DB
* database workspace default
* `DATABASE_URL` generik yang tidak terbukti berasal dari Supabase runtime aplikasi

Untuk seluruh modul CST-SUPER-APP, termasuk:

* Sport Center
* Customer Portal
* BizPortal
* Bank Reconciliation
* Accounting
* Settlement
* QRIS
* Logistics

database runtime harus diambil dari konfigurasi Supabase environment yang sesuai.

---

# 2. DEVELOPMENT DATABASE

Untuk DEVELOPMENT, gunakan hanya:

`SUPABASE_DATABASE_URL_DEV`

atau variable/connection yang secara eksplisit di-resolve oleh loader resmi project sebagai **Supabase DEVELOPMENT**.

Sebelum query pertama, verifikasi:

* environment = development
* target = Supabase development
* schema aplikasi yang diharapkan tersedia

Contoh schema evidence:

* `sport_center`
* canonical application tables
* relevant `public` application tables

Jika schema tersebut tidak ada, anggap connection SALAH.

---

# 3. PRODUCTION DATABASE

Untuk PRODUCTION gunakan hanya:

`SUPABASE_DATABASE_URL`

atau production connection yang secara eksplisit di-resolve oleh loader resmi.

PRODUCTION harus dianggap:

**READ-ONLY kecuali prompt secara eksplisit memberi izin write/deploy/migration.**

Jangan pernah fallback dari development ke production.

---

# 4. SECRET SOURCE OF TRUTH

Application secrets berasal dari:

**Google Cloud Secret Manager**

Gunakan loader resmi repository/project.

Replit Secrets hanya berfungsi sebagai:

* bootstrap credential
* access credential ke Secret Manager
* tooling credential yang diperlukan

Jangan meminta user menyalin seluruh application secrets secara manual ke Replit jika loader resmi dapat mengambilnya.

---

# 5. FORBIDDEN DEFAULT DATABASE

Jangan menggunakan secara otomatis:

`DATABASE_URL`

`PGDATABASE`

Replit PostgreSQL

Helium DB

workspace database

local postgres

hanya karena variable tersebut tersedia.

Database tersebut **bukan application source of truth** kecuali ada instruksi eksplisit yang menyatakan sebaliknya.

---

# 6. HELIUM DB RULE

Jika ditemukan database seperti:

`heliumdb`

atau database Replit/workspace lainnya:

**JANGAN audit schema aplikasi di sana.**

Jangan mencoba:

* mencari `sport_center`
* menyimpulkan table hilang
* menjalankan migration aplikasi
* melakukan recovery
* membandingkan data financial

Jika target terdeteksi sebagai Helium/non-Supabase:

**STOP** query tersebut dan langsung pindah ke loader Supabase DEVELOPMENT.

Tidak perlu membuat laporan panjang mengenai Helium.

Cukup internal note:

`Ignored non-application workspace database; using canonical Supabase runtime.`

---

# 7. REQUIRED CONNECTION ORDER

Untuk setiap audit/runtime task, gunakan urutan ini:

1. Baca environment target.
2. Jalankan secret loader resmi.
3. Resolve Supabase URL yang sesuai.
4. Verifikasi DEVELOPMENT atau PRODUCTION secara eksplisit.
5. Tes koneksi.
6. Verifikasi expected schema.
7. Baru lakukan query/audit.

JANGAN:

workspace DB
→ gagal
→ Helium
→ gagal
→ local DB
→ baru Supabase.

Urutan tersebut dilarang karena boros waktu dan kuota.

---

# 8. DEVELOPMENT CONNECTION FAIL-CLOSED

Jika `SUPABASE_DATABASE_URL_DEV` tidak langsung tersedia di shell:

JANGAN menyimpulkan database tidak tersedia.

Gunakan terlebih dahulu:

* Secret Manager bootstrap
* loader resmi project
* runtime environment loader
* existing secure development startup path

Hanya setelah semua approved loader path gagal, laporkan:

`DEVELOPMENT SUPABASE CONNECTION UNAVAILABLE`

Jangan fallback ke Helium.

---

# 9. SCHEMA SANITY CHECK

Sebelum audit besar, lakukan satu sanity query ringan.

Contoh conceptual check:

* current database identity
* expected schema existence
* one canonical application table existence

Jika expected schema tidak ditemukan:

connection dianggap salah.

Jangan lanjutkan audit di database tersebut.

---

# 10. QUERY POLICY

Setelah Supabase DEVELOPMENT tervalidasi:

langsung lakukan audit yang diminta.

Jangan mengulang:

* environment discovery
* database discovery
* schema discovery

di setiap subtask.

Evidence connection yang sudah tervalidasi berlaku untuk seluruh execution run kecuali koneksi berubah.

---

# 11. MIGRATION POLICY

Migration aplikasi hanya boleh diarahkan ke Supabase environment yang sudah diverifikasi.

Sebelum migration:

* target DEVELOPMENT harus terbukti
* production harus tidak tersentuh

Jangan pernah menjalankan migration canonical ke Helium/workspace DB.

---

# 12. AUDIT EXECUTION MODE

Untuk audit/remediation:

langsung:

`LOAD SUPABASE DEVELOPMENT`
→ `VERIFY`
→ `AUDIT`
→ `FIX`
→ `TEST`
→ `FINAL REPORT`

Jangan melakukan database exploration yang tidak relevan.

Do not stop after every technical finding.

Technical blockers that can be resolved from source/database evidence should be resolved within the same run.

---

# 13. RUNTIME WORKFLOW

Untuk runtime API:

gunakan startup command resmi repository.

Startup harus menggunakan:

* correct APP_ENV
* Secret Manager loader
* Supabase runtime connection

Jangan mengganti runtime DB hanya agar API dapat start.

---

# 14. DATABASE IDENTITY LOGGING

Agent boleh menampilkan:

* environment: development / production
* connection type: Supabase
* database/schema identity
* readiness result

Agent DILARANG menampilkan:

* database password
* complete connection URL
* Secret Manager payload
* service account private key
* access token

---

# 15. AUDIT REPORT POLICY

Jangan memenuhi laporan dengan percobaan koneksi yang tidak relevan.

Tidak perlu menulis:

* "Helium tidak punya table X"
* "Replit DB tidak punya schema Y"

jika database tersebut memang bukan source of truth.

Final report cukup menyatakan:

`Database target verified: Supabase DEVELOPMENT`

atau

`Database target verified: Supabase PRODUCTION (read-only)`

---

# 16. MANDATORY AGENT INSTRUCTION

Untuk SEMUA task database:

> Never use Helium/Replit workspace database as the application database unless explicitly instructed by the owner. Load the project-approved Secret Manager environment first and connect directly to the appropriate Supabase runtime. Fail closed rather than falling back to another database.

---

# 17. PRIORITY

Jika instruksi lain bertentangan dengan dokumen ini mengenai pemilihan database:

**RUNTIME_DATABASE_POLICY.md harus dipatuhi**, kecuali owner secara eksplisit mengubah target database.

---

# 18. EXPECTED BEHAVIOR

Contoh behavior yang BENAR:

`Need Sport Center audit`

→ load Secret Manager development

→ resolve `SUPABASE_DATABASE_URL_DEV`

→ verify `sport_center` schema

→ audit langsung

Contoh behavior yang SALAH:

`Need Sport Center audit`

→ try DATABASE_URL

→ inspect Helium

→ table missing

→ try local postgres

→ inspect workspace DB

→ finally discover Supabase

Pola kedua dilarang.

---

# FINAL RULE

**SUPABASE IS THE APPLICATION DATABASE SOURCE OF TRUTH.**

**HELIUM/REPLIT WORKSPACE DATABASE MUST NOT BE USED AS A FALLBACK.**

For DEVELOPMENT:

**LOAD SECRET MANAGER → SUPABASE DEVELOPMENT → VERIFY → EXECUTE.**

For PRODUCTION:

**LOAD SECRET MANAGER → SUPABASE PRODUCTION → READ-ONLY UNLESS EXPLICITLY AUTHORIZED.**