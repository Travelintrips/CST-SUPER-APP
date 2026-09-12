-- ============================================================================
-- ENTERPRISE MARKETPLACE — PHASE 1B ROLLBACK PLAN (REVIEW ONLY)
-- Tanggal dibuat  : 2026-07-02
-- Pasangan file   : migrations/enterprise-marketplace-p0.review.sql
-- Status          : DRAFT — JANGAN DIJALANKAN OTOMATIS.
--
-- Urutan rollback DIBALIK dari urutan CREATE (child sebelum parent,
-- supaya tidak melanggar FK constraint saat DROP).
-- Semua statement idempotent (IF EXISTS) — aman dijalankan ulang / sebagian.
-- ============================================================================


-- ── ROLLBACK GROUP D — ALTER TABLE ERP existing ──────────────────────────────
-- (Jalankan paling dulu karena kolom ini mereferensikan tabel mkt_* di bawah)

DROP INDEX IF EXISTS activity_logs_mkt_purchase_order_idx;
DROP INDEX IF EXISTS activity_logs_mkt_vendor_quote_idx;
DROP INDEX IF EXISTS activity_logs_mkt_rfq_idx;

ALTER TABLE activity_logs DROP COLUMN IF EXISTS mkt_purchase_order_id;
ALTER TABLE activity_logs DROP COLUMN IF EXISTS mkt_vendor_quote_id;
ALTER TABLE activity_logs DROP COLUMN IF EXISTS mkt_rfq_id;

DROP INDEX IF EXISTS purchase_documents_mkt_po_idx;
ALTER TABLE purchase_documents DROP COLUMN IF EXISTS mkt_purchase_order_id;


-- ── ROLLBACK GROUP C — CREATE INDEX (otomatis ikut hilang saat DROP TABLE,
--    tapi didaftarkan eksplisit untuk kejelasan dokumentasi) ─────────────────
-- (tidak perlu DROP INDEX manual untuk index di tabel mkt_* — akan terhapus
--  otomatis saat DROP TABLE di Group B di bawah)


-- ── ROLLBACK GROUP B — DROP TABLE 7 tabel P0 ─────────────────────────────────
-- Urutan: child dulu, parent terakhir.

DROP TABLE IF EXISTS mkt_company_settings;
DROP TABLE IF EXISTS mkt_rfq_guest_claims;
DROP TABLE IF EXISTS mkt_purchase_orders;
DROP TABLE IF EXISTS mkt_vendor_quote_lines;
DROP TABLE IF EXISTS mkt_vendor_quotes;
DROP TABLE IF EXISTS mkt_rfq_lines;
DROP TABLE IF EXISTS mkt_rfqs;


-- ── ROLLBACK GROUP A — DROP TYPE enum baru ───────────────────────────────────
-- CATATAN PENTING: accounting_entry_source TIDAK BISA rollback dengan DROP
-- VALUE — PostgreSQL tidak mendukung penghapusan satu value dari enum yang
-- sudah ada. Jika value 'marketplace_commission' sudah dipakai di baris
-- accounting_entries manapun, value TIDAK BOLEH dihapus (akan merusak data).
-- Rollback untuk accounting_entry_source HANYA berupa dokumentasi: pastikan
-- tidak ada baris accounting_entries dengan source = 'marketplace_commission'
-- sebelum melanjutkan ke rollback penuh, dan biarkan value enum tetap ada
-- (tidak berbahaya jika tidak dipakai).

DROP TYPE IF EXISTS mkt_claim_status;
DROP TYPE IF EXISTS mkt_po_status;
DROP TYPE IF EXISTS mkt_stock_status;
DROP TYPE IF EXISTS mkt_quote_status;
DROP TYPE IF EXISTS mkt_rfq_priority;
DROP TYPE IF EXISTS mkt_rfq_status;

-- ============================================================================
-- VERIFIKASI PASCA-ROLLBACK
-- ============================================================================
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'mkt_%';
--   → harus mengembalikan 0 baris.
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name IN ('activity_logs','purchase_documents') AND column_name LIKE 'mkt_%';
--   → harus mengembalikan 0 baris.
-- ============================================================================
