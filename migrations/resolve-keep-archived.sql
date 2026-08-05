-- ============================================================================
-- RESOLVE KEEP-ARCHIVED TABLES
-- Tanggal dibuat  : 2026-06-23
-- Referensi       : docs/supabase-keep-archived-resolution.md
-- Status          : DRAFT — JANGAN DIJALANKAN OTOMATIS
--
-- KONTEKS:
--   Tiga tabel yang sebelumnya berstatus KEEP ARCHIVED telah diselesaikan:
--   1. workflow_events        → kode sudah dihapus, tabel tidak ada di DB
--   2. sport_center_memberships → tabel tidak ada di DB, tidak ada data
--   3. sport_center_bookings    → tabel tidak ada di DB (cooling period s/d 2026-07-23)
--
-- TEMUAN DB (2026-06-23):
--   SELECT COUNT(*) FROM information_schema.tables
--   WHERE table_name IN ('workflow_events','sport_center_memberships','sport_center_bookings');
--   → Result: 0 — semua tabel sudah tidak ada di DB
--
-- FILE INI:
--   Berisi SQL idempotent untuk berjaga-jaga jika tabel muncul kembali
--   (misal: setelah restore backup lama atau setelah deployment baru).
--   Semua statement menggunakan IF EXISTS — aman jika tabel tidak ada.
--
-- PRASYARAT SEBELUM MENJALANKAN:
--   1. Pastikan API Server sudah restart dan tidak ada error TypeScript
--   2. Jalankan Checklist Pre-Restart di docs/supabase-keep-archived-resolution.md
--   3. Konfirmasi row count = 0 sebelum DROP
--   4. Backup/snapshot DB sudah diambil
-- ============================================================================

-- ── STEP 1: VERIFIKASI ROW COUNT (jalankan ini dulu) ─────────────────────────

SELECT 'workflow_events'         AS tabel, COUNT(*) AS rows
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'workflow_events'
UNION ALL
SELECT 'sport_center_memberships', COUNT(*)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'sport_center_memberships'
UNION ALL
SELECT 'sport_center_bookings',   COUNT(*)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'sport_center_bookings';

-- Expected: semua row_count = 0 (tabel tidak ada)
-- Jika ada yang = 1 (tabel masih ada), cek row count data sebelum lanjut:
--   SELECT COUNT(*) FROM workflow_events;
--   SELECT COUNT(*) FROM sport_center_memberships;
--   SELECT COUNT(*) FROM sport_center_bookings;

-- ── STEP 2: workflow_events — DROP indexes + tabel ───────────────────────────
--
-- Konteks: Kode sudah bersih (2026-06-23):
--   - lib/db/src/schema/workflowEvents.ts → DIHAPUS
--   - lib/db/src/schema/index.ts → export dihapus
--   - phase1Migration.ts → CREATE TABLE block dihapus
-- Tabel sudah tidak ada di DB — statement IF EXISTS di bawah adalah no-op.

DROP INDEX IF EXISTS workflow_events_status_idx;
DROP INDEX IF EXISTS workflow_events_entity_idx;
DROP TABLE IF EXISTS workflow_events;

-- ── STEP 3: sport_center_memberships ─────────────────────────────────────────
--
-- Tabel tidak ada di DB, tidak ada data yang perlu dimigrasikan.
-- sport_members adalah tabel aktif pengganti.
-- Cooling period: berakhir 2026-07-23.
--
-- JANGAN EKSEKUSI sebelum 2026-07-23:

-- DROP TABLE IF EXISTS sport_center_memberships; -- uncomment setelah 2026-07-23

-- ── STEP 4: sport_center_bookings ─────────────────────────────────────────────
--
-- Tabel tidak ada di DB.
-- sport_bookings adalah tabel aktif pengganti.
-- Cooling period: berakhir 2026-07-23.
--
-- JANGAN EKSEKUSI sebelum 2026-07-23:

-- DROP TABLE IF EXISTS sport_center_bookings; -- uncomment setelah 2026-07-23

-- ── STEP 5: VERIFIKASI POST-CLEANUP ──────────────────────────────────────────

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('workflow_events', 'sport_center_memberships', 'sport_center_bookings');
-- Expected: 0 rows

SELECT indexname
FROM pg_indexes
WHERE tablename = 'workflow_events';
-- Expected: 0 rows

-- ── CATATAN ───────────────────────────────────────────────────────────────────
-- Setelah 2026-07-23:
--   1. Uncomment sport_center_memberships DROP di atas
--   2. Uncomment sport_center_bookings DROP di atas
--   3. Jalankan file ini
--   4. Update docs/supabase-final-cleanup-audit.md dan .json
-- ============================================================================
