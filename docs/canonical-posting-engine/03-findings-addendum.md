# Tahap 3 — Temuan Baru (Addendum)

Ditemukan saat menguji migrasi pilot `ingestModulePayment.ts` ke `CanonicalPostingEngine`.

## Temuan #1 (P0): `postLedgerEvent` bisa mem-"poison" transaksi pemanggil tanpa terlihat

**Lokasi:** `lib/accounting.ts` → `postLedgerEvent()`, dipanggil dari dalam `_postEntryCore()`.

**Masalah:**
`postLedgerEvent` menangkap error INSERT-nya sendiri (`try/catch` → `logger.warn`, tidak
di-rethrow) — ini didesain sebagai audit trail "fire-and-forget" yang tidak boleh
menggagalkan posting jurnal. Namun jika fungsi ini dijalankan **di dalam transaksi
Postgres milik pemanggil** (`db.transaction(...)`), sebuah error yang tertelan di sini
tetap membuat *seluruh transaksi* masuk status *aborted* di level koneksi Postgres.
Semua statement berikutnya dalam transaksi yang sama (termasuk INSERT
`accounting_entry_lines`) otomatis gagal, tapi `COMMIT` di akhir tidak melempar error —
ia hanya menjadi ROLLBACK diam-diam. Pemanggil menerima `{ ok: true, entryId }` untuk
baris yang **sebenarnya tidak pernah tersimpan**.

**Reproduksi nyata (dev DB):** kolom `entry_id` belum ada di tabel `ledger_events` di
environment dev (schema drift dev vs prod — lihat `dev-prod-schema-drift.md`). Saat
`CanonicalPostingEngine` sempat membungkus `postEntryWithClient` dengan
`db.transaction()`, INSERT `ledger_events` gagal dengan `entry_id` tidak ada → tertelan
→ transaksi Postgres poisoned → entry dan lines tidak pernah commit → tapi hasil
`postEntry`/`_postEntryCore` tetap mengembalikan objek entry dengan id valid dari
`RETURNING` sebelum abort terjadi.

**Dampak:**
- **Kode saya (`CanonicalPostingEngine`) sudah diperbaiki** — untuk saat ini TIDAK
  membungkus `postEntryWithClient` dalam `db.transaction()` eksplisit (persis seperti
  `postEntry()` asli hari ini, yang aman karena tiap statement auto-commit sendiri di
  luar transaksi eksplisit).
- **Kode yang SUDAH ADA berpotensi terkena bug yang sama**: `postIntercompanyPair()`
  di `lib/accounting.ts` memakai pola persis ini — `_postEntryCore(tx, ...)` dua kali di
  dalam satu `db.transaction()`. Ini belum diverifikasi rusak di produksi (schema
  `ledger_events` di prod mungkin lengkap), tapi pola ini rapuh untuk *error apa pun*
  yang bisa terjadi di `postLedgerEvent` (bukan cuma kolom hilang — juga race condition,
  connection drop, dll).

**Rekomendasi perbaikan (belum dieksekusi, di luar scope pilot ini):**
Tambahkan `SAVEPOINT` di dalam `postLedgerEvent` sebelum INSERT-nya sendiri, lalu
`ROLLBACK TO SAVEPOINT` di blok catch — supaya error di situ benar-benar terisolasi dan
tidak meracuni transaksi pemanggil, sesuai desain aslinya ("fire-and-forget"). Ini
perbaikan kecil, aman, dan sebaiknya jadi prioritas P0 sebelum `CanonicalPostingEngine`
mengaktifkan mode transaksional (dibutuhkan untuk atomic tax posting di tahap
berikutnya).

## Temuan #2 (P2, sudah diketahui): schema drift `ledger_events.entry_id` dev vs prod

Kolom `entry_id` tidak ada di tabel `ledger_events` pada database dev. Ini menegaskan
kembali temuan `dev-prod-schema-drift.md` — bukan bug baru, tapi jadi lebih terlihat
karena Temuan #1 di atas.
