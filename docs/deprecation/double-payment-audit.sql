-- ============================================================================
-- Double Payment Audit Query — Phase 3 Deprecation
-- Deteksi invoice/vendor bill yang dibayar dari lebih dari satu jalur:
--   Jalur 1: vendor_payments (VP) — deprecated
--   Jalur 2: bank_disbursement_items tipe supplier_payment (BD)
--   Jalur 3: accounting_payments outbound (AP) — jika tabel ada
--
-- Jalankan query ini setelah tabel vendor_payments dan bank_disbursements
-- terisi data (keduanya dibuat secara lazy via migration on first request).
-- ============================================================================

-- ── Cek tabel yang tersedia ──────────────────────────────────────────────────
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'vendor_payments',
    'bank_disbursements',
    'bank_disbursement_items',
    'accounting_payments',
    'purchase_documents'
  )
ORDER BY table_name;

-- ── Audit utama: suspect double payment per purchase_document_id ─────────────
WITH vp_payments AS (
  -- Pembayaran dari jalur Vendor Payments (deprecated)
  SELECT
    purchase_document_id                                          AS doc_id,
    SUM(amount)                                                   AS vp_total,
    COUNT(*)::int                                                 AS vp_count,
    STRING_AGG(payment_number, ', ' ORDER BY payment_date)        AS vp_refs
  FROM vendor_payments
  WHERE purchase_document_id IS NOT NULL
  GROUP BY purchase_document_id
),
bd_payments AS (
  -- Pembayaran dari jalur Bank Disbursement (sole executor)
  SELECT
    bdi.reference_id                                              AS doc_id,
    SUM(bdi.amount)                                               AS bd_total,
    COUNT(*)::int                                                 AS bd_count,
    STRING_AGG(bd.disbursement_number, ', ' ORDER BY bd.disbursement_date) AS bd_refs
  FROM bank_disbursement_items bdi
  JOIN bank_disbursements bd ON bd.id = bdi.disbursement_id
  WHERE bdi.transaction_type = 'supplier_payment'
    AND bdi.reference_id IS NOT NULL
  GROUP BY bdi.reference_id
)
SELECT
  COALESCE(v.doc_id, b.doc_id)::text                  AS purchase_document_id,
  pd.document_number                                    AS doc_number,
  pd.total_amount                                       AS doc_total,
  -- Jalur VP
  COALESCE(v.vp_total, 0)                              AS vendor_payment_total,
  COALESCE(v.vp_count, 0)                              AS vendor_payment_count,
  COALESCE(v.vp_refs, '—')                             AS vendor_payment_refs,
  -- Jalur BD
  COALESCE(b.bd_total, 0)                              AS bank_disbursement_total,
  COALESCE(b.bd_count, 0)                              AS bank_disbursement_count,
  COALESCE(b.bd_refs, '—')                             AS bank_disbursement_refs,
  -- Jumlah jalur yang dipakai (suspect jika > 1)
  (CASE WHEN v.doc_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN b.doc_id IS NOT NULL THEN 1 ELSE 0 END)  AS jalur_count,
  -- Total dari semua jalur vs nilai dokumen
  (COALESCE(v.vp_total, 0) + COALESCE(b.bd_total, 0)) AS total_paid_all_jalur,
  -- Overpayment flag
  CASE
    WHEN pd.total_amount IS NOT NULL AND
         (COALESCE(v.vp_total, 0) + COALESCE(b.bd_total, 0)) > pd.total_amount
    THEN 'OVERPAID'
    ELSE 'OK'
  END                                                   AS overpayment_status
FROM vp_payments v
FULL OUTER JOIN bd_payments b ON b.doc_id = v.doc_id
LEFT JOIN purchase_documents pd
  ON pd.id = COALESCE(v.doc_id, b.doc_id)
WHERE (
  CASE WHEN v.doc_id IS NOT NULL THEN 1 ELSE 0 END +
  CASE WHEN b.doc_id IS NOT NULL THEN 1 ELSE 0 END
) > 1
ORDER BY jalur_count DESC, total_paid_all_jalur DESC;

-- ── Audit tambahan: KTF entries (kas transfer lama) ──────────────────────────
-- Cari accounting_entries dengan ref KTF/... yang masih ada sebagai historis
SELECT
  COUNT(*)                                  AS ktf_entry_count,
  SUM(ael.debit)                            AS ktf_total_debit,
  MIN(ae.date)                              AS oldest_entry,
  MAX(ae.date)                              AS newest_entry
FROM accounting_entries ae
JOIN accounting_entry_lines ael ON ael.entry_id = ae.id AND ael.debit > 0
WHERE ae.ref LIKE 'KTF/%';

-- ── Cek vendor_payments yang tidak terhubung ke purchase_document (floating) ──
SELECT
  vp.payment_number,
  vp.vendor_name,
  vp.payment_date,
  vp.amount,
  vp.payment_method,
  vp.reference
FROM vendor_payments vp
WHERE vp.purchase_document_id IS NULL
ORDER BY vp.payment_date DESC
LIMIT 50;
