-- ============================================================
-- KOREKSI PPN SPORT CENTER — harga fasilitas sudah INKLUSIF PPN 11%
-- Formula yang benar: PPN = total × 11/111 (bukan total × 11/100)
-- Jalankan di Supabase SQL Editor (database prod)
-- STEP 1: Preview dulu, step 2: eksekusi koreksi
-- ============================================================

-- STEP 1 — DRY RUN: lihat booking mana yang terpengaruh
SELECT
  sb.id                                                      AS booking_id,
  sb.booking_number,
  sb.facility_name,
  sb.booking_date,
  sb.total_amount::numeric                                   AS total_amount,
  sb.tax_amount::numeric                                     AS stored_tax_wrong,
  ROUND(sb.total_amount::numeric * 11 / 111, 2)             AS correct_tax,
  ROUND(sb.tax_amount::numeric - sb.total_amount::numeric * 11 / 111, 2) AS selisih_ppn,
  ae.id                                                      AS entry_id,
  ae.entry_number
FROM public.sport_bookings sb
LEFT JOIN public.accounting_entries ae
  ON ae.source = 'sport_center_booking' AND ae.source_id = sb.id
WHERE sb.tax_amount::numeric > 0
  AND ABS(sb.tax_amount::numeric - ROUND(sb.total_amount::numeric * 11 / 111, 2)) > 1
ORDER BY sb.booking_date DESC;


-- ============================================================
-- STEP 2 — KOREKSI: Update tax_amount di sport_bookings
-- Jalankan hanya setelah mereview hasil STEP 1
-- ============================================================
/*
UPDATE public.sport_bookings
SET
  tax_amount = ROUND(total_amount::numeric * 11 / 111, 2),
  updated_at = NOW()
WHERE tax_amount::numeric > 0
  AND ABS(tax_amount::numeric - ROUND(total_amount::numeric * 11 / 111, 2)) > 1;

-- Verifikasi hasil update
SELECT COUNT(*) as fixed_count FROM public.sport_bookings WHERE tax_amount::numeric > 0;
*/


-- ============================================================
-- STEP 3 — JURNAL ADJUSTMENT: Buat entri koreksi per booking
-- (Opsional — hanya jika Anda ingin koreksi GL journal juga)
-- Ini membuat adjustment entry: debit PPN Keluaran, kredit Pendapatan
-- Jalankan SETELAH deploy kode baru ke production dan server berjalan
-- ============================================================
-- Dari terminal atau curl, panggil endpoint:
--
--   curl -X POST https://YOUR_DOMAIN/api/sport-center/admin/fix-ppn-journals \
--     -H "Content-Type: application/json" \
--     -H "x-admin-key: YOUR_PORTAL_ADMIN_KEY" \
--     -d '{"dry_run": false}'
--
-- Atau dry run dulu:
--   curl -X POST https://YOUR_DOMAIN/api/sport-center/admin/fix-ppn-journals \
--     -H "Content-Type: application/json" \
--     -H "x-admin-key: YOUR_PORTAL_ADMIN_KEY" \
--     -d '{"dry_run": true}'
-- ============================================================
