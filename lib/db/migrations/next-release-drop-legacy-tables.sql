-- ============================================================================
-- MIGRATION DRAFT — NEXT RELEASE ONLY
-- Tanggal dibuat : 2026-05-30
-- Tujuan         : Drop tabel legacy yang sudah dikonfirmasi tidak dipakai
-- Status         : DRAFT — JANGAN DIJALANKAN sebelum semua prasyarat terpenuhi
-- Dibuat oleh    : Phase 6 Production Lock
-- ============================================================================
--
-- PRASYARAT WAJIB SEBELUM MENJALANKAN MIGRATION INI:
--   1. Ambil DB snapshot / pg_dump penuh dari production
--   2. Semua regression test (Phase 6) PASS
--   3. Konfirmasi rows = 0 pada kedua tabel (SELECT COUNT(*) di bawah)
--   4. Deploy kode bersih (hapus Drizzle schema + file logistics.ts) ke production terlebih dulu
--   5. Run migration ini dalam maintenance window dengan rollback siap
--
-- URUTAN EKSEKUSI:
--   Step 1 → Verifikasi row count
--   Step 2 → Drop indexes workflow_events
--   Step 3 → Drop table workflow_events
--   Step 4 → Drop table shipments + enum
--   Step 5 → Verifikasi post-drop
-- ============================================================================

-- ── STEP 1: VERIFIKASI ROW COUNT (jalankan ini dulu, pastikan output = 0) ───

SELECT 'workflow_events' AS tabel, COUNT(*) AS rows FROM workflow_events;
SELECT 'shipments'       AS tabel, COUNT(*) AS rows FROM shipments;

-- Jika ada row > 0, STOP dan investigasi sebelum lanjut.

-- ── STEP 2: DROP INDEXES workflow_events ─────────────────────────────────────

DROP INDEX IF EXISTS workflow_events_status_idx;
DROP INDEX IF EXISTS workflow_events_entity_idx;

-- ── STEP 3: DROP TABLE workflow_events ───────────────────────────────────────
--
-- Alasan aman di-drop:
--   - 0 rows di production
--   - Tidak ada reader/writer aktif (grep seluruh artifacts/ + packages/ = 0 hasil)
--   - Dibuat Phase 1 sebagai event queue yang tidak pernah diimplementasikan
--   - Konfirmasi Phase 5 audit: "SAFE TO DELETE"

DROP TABLE IF EXISTS workflow_events;

-- ── STEP 4: DROP TABLE shipments + ENUM ──────────────────────────────────────
--
-- Alasan aman di-drop:
--   - 0 rows di production
--   - logistics.ts (satu-satunya writer) sudah di-unmount sejak Phase 4
--   - dashboard.ts sudah diganti ke freightShipmentsTable (Phase 5)
--   - Tidak ada reader/writer aktif setelah Phase 5
--   - Konfirmasi Phase 5 audit: "SAFE TO DELETE"

DROP TABLE IF EXISTS shipments;

-- Drop enum hanya setelah tabel yang menggunakannya sudah di-drop
DROP TYPE IF EXISTS shipment_status;

-- ── STEP 5: VERIFIKASI POST-DROP ─────────────────────────────────────────────

-- Konfirmasi tabel tidak ada lagi
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('workflow_events', 'shipments');
-- Expected: 0 rows

-- Konfirmasi enum tidak ada lagi
SELECT typname FROM pg_type WHERE typname = 'shipment_status';
-- Expected: 0 rows

-- ── CATATAN PEMBERSIHAN KODE (lakukan bersamaan di release ini) ───────────────
--
-- A. Hapus CREATE TABLE workflow_events block dari:
--      artifacts/api-server/src/lib/phase1Migration.ts  (lines 9–29)
--    Juga update log message di line 126 (hapus "workflow_events" dari teks)
--
-- B. Hapus dari lib/db/src/schema/workflowEvents.ts:
--    → Hapus seluruh file
--
-- C. Hapus export dari lib/db/src/schema/index.ts:
--    → Hapus baris: export * from "./workflowEvents";
--
-- D. Hapus dari lib/db/src/schema/shipments.ts:
--    → Hapus seluruh file (shipmentsTable, insertShipmentSchema, shipmentStatusEnum)
--
-- E. Hapus dari lib/db/src/schema/index.ts:
--    → Hapus baris: export * from "./shipments";
--    (jika ada — cek dulu)
--
-- F. Hapus file artifacts/api-server/src/routes/logistics.ts
--    (sudah di-unmount dari index.ts, tidak ada dependent import aktif)
-- ============================================================================
