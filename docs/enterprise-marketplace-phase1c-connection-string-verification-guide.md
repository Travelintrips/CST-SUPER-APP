# Panduan Verifikasi Connection String — Session Pooler (5432) vs Transaction Pooler (6543)

**Status:** DRAFT — PANDUAN SAJA, TIDAK ADA EKSEKUSI
**Tanggal dibuat:** 2026-07-02
**Terkait:** `docs/enterprise-marketplace-phase1c-execution-runbook.md` Section 3

> Dokumen ini hanya berisi panduan verifikasi. Tidak ada migration yang dijalankan, tidak ada DDL, tidak ada schema yang diubah, dan tidak ada koneksi database yang dibuka saat membuat dokumen ini.

---

## 0. Temuan Awal — Cek Env Var yang Tersedia Sekarang

Saya sudah mengecek **nama** environment variable yang ada di environment ini (tanpa membuka/mencetak nilainya):

```
SUPABASE_ANON_KEY_DEV
SUPABASE_DATABASE_URL_DEV
SUPABASE_SERVICE_ROLE_KEY_DEV
SUPABASE_STORAGE_BUCKET_DEV
SUPABASE_URL_DEV
VITE_SUPABASE_ANON_KEY_DEV
VITE_SUPABASE_URL_DEV
DATABASE_URL
PGDATABASE / PGHOST / PGPASSWORD / PGPORT / PGUSER
```

**Catatan penting:**
- Yang ada di sini hanya varian **`_DEV`** untuk Supabase (`SUPABASE_DATABASE_URL_DEV`). Tidak ada `SUPABASE_DATABASE_URL` (prod, tanpa suffix `_DEV`) di environment saya saat ini.
- `DATABASE_URL`, `PGHOST`, `PGPORT`, dst adalah environment variable milik database Postgres bawaan Replit (jika ada) — **bukan** Supabase, dan **tidak boleh** dipakai untuk migration ini.
- Ini artinya: connection string session pooler production untuk migration Group A–D **kemungkinan belum ada di environment ini**, atau kamu akan memasukkannya secara manual saat mau eksekusi nanti. Ini perlu dikonfirmasi eksplisit sebelum lanjut ke tahap pre-check.

---

## 1. Cara Mendapatkan Connection String Session Pooler dari Supabase Dashboard

1. Login ke [Supabase Dashboard](https://supabase.com/dashboard) → pilih project (`nzdweipzckfszczzqtuw` sesuai catatan project).
2. Buka **Project Settings → Database**.
3. Di bagian **Connection string**, Supabase menyediakan beberapa mode:
   - **Direct connection** — port `5432`, langsung ke Postgres, tanpa pooling. Cocok untuk migration/DDL, tapi jumlah koneksi simultan terbatas.
   - **Session pooler (Supavisor, session mode)** — port `5432`, via pooler tapi berlaku seperti direct connection per sesi. **Ini yang direkomendasikan runbook untuk migration manual.**
   - **Transaction pooler (Supavisor, transaction mode)** — port `6543`. **DILARANG untuk migration ini** (tidak mendukung multi-statement session state, dan `ALTER TYPE ADD VALUE` bisa gagal atau berlaku tidak konsisten).
4. Salin connection string dari opsi **Session pooler** atau **Direct connection** (keduanya port `5432`), BUKAN dari opsi **Transaction pooler**.

Format umum session pooler Supabase:
```
postgresql://postgres.<project_ref>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres
```

Format transaction pooler (JANGAN dipakai untuk migration):
```
postgresql://postgres.<project_ref>:<password>@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres
```

**Cara cepat membedakan tanpa buka dashboard:** lihat angka setelah `.pooler.supabase.com:` — kalau `5432` aman, kalau `6543` STOP, jangan dipakai untuk DDL manual.

---

## 2. Cara Verifikasi Connection String yang Sudah Ada (di Secrets/Env)

Sebelum eksekusi apa pun, verifikasi tanpa membuka nilai secret ke chat/log:

### a) Cek port di dalam string tanpa mencetak keseluruhan secret

Jika kamu perlu memverifikasi sendiri secara manual (di luar sesi ini), jalankan di terminal kamu:
```bash
echo "$SUPABASE_DATABASE_URL" | grep -oE ':[0-9]{4,5}/' 
```
Output harus `:5432/`. Kalau muncul `:6543/`, connection string itu transaction pooler — jangan dipakai untuk migration.

### b) Verifikasi via query setelah connect (langkah ini BUKAN bagian dari dokumen ini — baru dilakukan nanti saat pre-check benar-benar dijalankan)

Sesuai runbook Section 3, setelah connect nanti akan dijalankan:
```sql
SHOW port;
SELECT current_setting('port');
```
Expected: `5432`.

---

## 3. Checklist Sebelum Konfirmasi ke Saya

Sebelum kamu kirim konfirmasi "backup selesai, lanjut pre-check", pastikan:

- [ ] Backup/snapshot Supabase sudah diambil manual via dashboard.
- [ ] Kamu sudah menentukan **connection string mana** yang akan dipakai untuk pre-check + migration (session pooler atau direct connection, port `5432`).
- [ ] Connection string tersebut **disimpan sebagai secret** di Replit (bukan ditulis langsung di chat/kode) — jika belum ada secret yang sesuai, beri tahu saya nama secret yang akan kamu buat (misal `SUPABASE_MIGRATION_URL`) supaya saya bisa memvalidasi baru menggunakannya, tanpa saya perlu melihat isi password-nya.
- [ ] Kamu konfirmasi secret yang dipakai BUKAN `SUPABASE_DATABASE_URL_DEV` biasa yang mungkin masih mengarah ke pooler mode transaksi — pastikan secara eksplisit itu session pooler/direct (port 5432), sesuai Section 1–2 di atas.

---

## 4. Yang TIDAK Dilakukan di Tahap Ini

- Tidak ada koneksi ke database yang dibuka.
- Tidak ada query yang dijalankan (termasuk `SHOW port` — itu baru nanti di tahap pre-check setelah kamu konfirmasi).
- Tidak ada DDL/migration yang dijalankan.
- Tidak ada schema yang diubah.
- Tidak ada secret yang dibuat/diminta secara otomatis — menunggu konfirmasi kamu dulu di Section 3.

---

**Alur yang disepakati:**
```
Backup manual Supabase (kamu, sedang berjalan)
↓
Konfirmasi connection string 5432 (sesuai panduan ini)
↓
Pre-check read-only (saya jalankan setelah kamu konfirmasi)
↓
Review hasil pre-check
↓
Approval terakhir dari kamu
↓
Migration manual (Group A–D)
```

Saya menunggu di langkah "Konfirmasi connection string 5432" — tidak ada tindakan lain yang akan saya lakukan sampai kamu kirim konfirmasi backup selesai + connection string yang akan dipakai.
