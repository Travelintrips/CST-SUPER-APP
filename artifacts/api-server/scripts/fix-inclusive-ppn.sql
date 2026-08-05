-- ============================================================
-- One-time migration: fix PPN inklusif → eksklusif
-- pada tabel logistic_orders
--
-- Formula lama (inklusif): subtotal = grand_total / 1.11
--                           tax     = grand_total - subtotal
-- Formula baru (eksklusif): subtotal = DPP
--                            tax     = DPP × 11%
--                            grand_total = DPP + tax
--
-- Strategi:
--   1. Order punya items → DPP = SUM(item.subtotal)
--   2. Order tanpa items → DPP = grand_total lama
--      (grand_total lama = harga produk sebelum PPN)
--
-- Jalankan PREVIEW dulu (SELECT), lalu APPLY (UPDATE).
-- ============================================================

BEGIN;

-- ── STEP 1: buat tabel sementara berisi nilai baru ──────────
CREATE TEMP TABLE _ppn_fix AS
WITH item_sums AS (
  SELECT
    order_id,
    SUM(subtotal::numeric) AS items_dpp
  FROM logistic_order_items
  GROUP BY order_id
),
candidates AS (
  SELECT
    lo.id,
    lo.order_number,
    lo.subtotal::numeric       AS old_subtotal,
    lo.tax::numeric            AS old_tax,
    lo.grand_total::numeric    AS old_grand,
    -- DPP baru: dari items jika ada, fallback ke grand_total lama
    COALESCE(
      NULLIF(COALESCE(ims.items_dpp, 0), 0),
      lo.grand_total::numeric
    )                          AS new_dpp
  FROM logistic_orders lo
  LEFT JOIN item_sums ims ON ims.order_id = lo.id
  -- hanya order yang punya PPN
  WHERE lo.tax::numeric > 0
)
SELECT
  id,
  order_number,
  old_subtotal,
  old_tax,
  old_grand,
  new_dpp,
  ROUND(new_dpp * 0.11)                  AS new_tax,
  new_dpp + ROUND(new_dpp * 0.11)        AS new_grand,
  -- apakah sudah eksklusif? (subtotal + subtotal×11% ≈ grandTotal, toleransi 1)
  ABS(ROUND(old_subtotal + old_subtotal * 0.11) - old_grand) <= 1 AS already_ok
FROM candidates;

-- ── STEP 2: preview ─────────────────────────────────────────
SELECT
  order_number,
  old_subtotal,  new_dpp    AS new_subtotal,
  old_tax,       new_tax,
  old_grand,     new_grand,
  already_ok
FROM _ppn_fix
ORDER BY id;

-- ── STEP 3: apply update (hanya order yang belum ok) ────────
UPDATE logistic_orders lo
SET
  subtotal    = f.new_dpp,
  tax         = f.new_tax,
  grand_total = f.new_grand
FROM _ppn_fix f
WHERE lo.id = f.id
  AND f.already_ok = false;

-- Tampilkan ringkasan
SELECT
  COUNT(*)                       AS total_candidates,
  COUNT(*) FILTER (WHERE already_ok = false)  AS fixed,
  COUNT(*) FILTER (WHERE already_ok = true)   AS skipped_already_ok
FROM _ppn_fix;

COMMIT;
