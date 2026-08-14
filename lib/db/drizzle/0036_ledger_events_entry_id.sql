-- Forward migration for legacy ledger_events tables created by the fleet
-- schema. Accounting audit events use entry_id to link POST events to the
-- canonical accounting journal.
DO $$
BEGIN
  IF to_regclass('public.ledger_events') IS NOT NULL THEN
    ALTER TABLE public.ledger_events
      ADD COLUMN IF NOT EXISTS entry_id INTEGER;
    CREATE INDEX IF NOT EXISTS ledger_events_entry_id_idx
      ON public.ledger_events (entry_id);
  END IF;
END $$;
