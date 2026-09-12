CREATE TABLE IF NOT EXISTS portal_company_requests (
  id SERIAL PRIMARY KEY,
  portal_customer_id INTEGER NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
  requested_company_name TEXT NOT NULL,
  requested_registration_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  matched_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_by INTEGER REFERENCES portal_customers(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portal_company_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS pcr_customer_idx
  ON portal_company_requests (portal_customer_id);
CREATE INDEX IF NOT EXISTS pcr_status_idx
  ON portal_company_requests (status);
CREATE INDEX IF NOT EXISTS pcr_company_idx
  ON portal_company_requests (matched_company_id);