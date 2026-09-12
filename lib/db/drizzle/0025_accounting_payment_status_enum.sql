-- Fix accounting_payment_status enum: tambah nilai yang dipakai di kode
-- (pending_approval, approved, rejected) tapi belum ada di enum DB.
-- ALTER TYPE ... ADD VALUE bersifat idempoten via DO block.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'accounting_payment_status'::regtype
      AND enumlabel = 'pending_approval'
  ) THEN
    ALTER TYPE accounting_payment_status ADD VALUE 'pending_approval';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'accounting_payment_status'::regtype
      AND enumlabel = 'approved'
  ) THEN
    ALTER TYPE accounting_payment_status ADD VALUE 'approved';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'accounting_payment_status'::regtype
      AND enumlabel = 'rejected'
  ) THEN
    ALTER TYPE accounting_payment_status ADD VALUE 'rejected';
  END IF;
END
$$;
