-- Reconcile legacy nullable-source candidate identity before enforcing uniqueness.
--
-- The historical identity index is intentionally scoped to candidate_source IS
-- NULL and active candidate/approved rows. Repeated legacy matching runs left
-- duplicate candidate rows in some environments. Keep the earliest approved
-- row when one exists, otherwise keep the earliest row, and retain every
-- superseded row as history.
--
-- Fail closed when a group contains more than one approved row: that requires
-- domain review and must not be resolved by an automatic data migration.

BEGIN;

DO $$
DECLARE
  approved_duplicate_groups INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO approved_duplicate_groups
  FROM (
    SELECT mutation_id, candidate_type, candidate_id
    FROM public.bank_reconciliation_matches
    WHERE candidate_source IS NULL
      AND status IN ('candidate', 'approved')
    GROUP BY mutation_id, candidate_type, candidate_id
    HAVING COUNT(*) FILTER (WHERE status = 'approved') > 1
  ) duplicate_groups;

  IF approved_duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Refusing legacy reconciliation cleanup: % identity group(s) contain multiple approved rows',
      approved_duplicate_groups;
  END IF;
END
$$;

WITH ranked AS (
  SELECT
    id,
    status,
    ROW_NUMBER() OVER (
      PARTITION BY mutation_id, candidate_type, candidate_id
      ORDER BY (status = 'approved') DESC, id ASC
    ) AS identity_rank
  FROM public.bank_reconciliation_matches
  WHERE candidate_source IS NULL
    AND status IN ('candidate', 'approved')
)
UPDATE public.bank_reconciliation_matches AS matches
SET status = 'superseded'
FROM ranked
WHERE matches.id = ranked.id
  AND ranked.identity_rank > 1
  AND ranked.status = 'candidate';

CREATE UNIQUE INDEX IF NOT EXISTS brm_historical_identity_active_unique
  ON public.bank_reconciliation_matches (
    mutation_id,
    candidate_type,
    candidate_id
  )
  WHERE candidate_source IS NULL
    AND status IN ('candidate', 'approved');

COMMIT;