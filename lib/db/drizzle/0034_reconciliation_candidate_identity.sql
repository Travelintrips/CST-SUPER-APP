-- Phase 4C-7M: source-aware active candidate identity.
--
-- Do not delete old evidence. Duplicate non-approved candidate rows are
-- retained as superseded history; approved and historical NULL-source rows are
-- intentionally not rewritten.
WITH duplicate_groups AS (
  SELECT mutation_id, candidate_type, candidate_id, candidate_source,
         MIN(id) AS keep_id
  FROM public.bank_reconciliation_matches
  WHERE candidate_source IS NOT NULL
    AND status = 'candidate'
  GROUP BY mutation_id, candidate_type, candidate_id, candidate_source
  HAVING COUNT(*) > 1
)
UPDATE public.bank_reconciliation_matches m
SET status = 'superseded'
FROM duplicate_groups d
WHERE m.mutation_id = d.mutation_id
  AND m.candidate_type = d.candidate_type
  AND m.candidate_id = d.candidate_id
  AND m.candidate_source = d.candidate_source
  AND m.id <> d.keep_id
  AND m.status = 'candidate';

CREATE UNIQUE INDEX IF NOT EXISTS brm_source_identity_active_unique
  ON public.bank_reconciliation_matches
    (mutation_id, candidate_type, candidate_id, candidate_source)
  WHERE candidate_source IS NOT NULL
    AND status IN ('candidate', 'approved');