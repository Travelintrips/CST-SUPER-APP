-- Minimal isolated TEST tenant required by database-backed integration fixtures.
-- This does not copy DEV/PROD business data.

INSERT INTO companies (
  company_name,
  company_code,
  is_active,
  is_holding
)
SELECT
  'Isolated TEST Tenant',
  'TEST-ISOLATED',
  TRUE,
  FALSE
WHERE NOT EXISTS (
  SELECT 1
  FROM companies
  WHERE company_code = 'TEST-ISOLATED'
);
--> statement-breakpoint

ALTER TABLE ppjk_audit_logs
  DROP CONSTRAINT IF EXISTS ppjk_audit_logs_ppjk_order_id_fkey;