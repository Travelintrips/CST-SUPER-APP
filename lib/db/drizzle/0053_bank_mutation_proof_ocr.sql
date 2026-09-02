-- Persist OpenAI OCR status and structured evidence for bank mutation proof uploads.
ALTER TABLE "bank_mutations"
  ADD COLUMN IF NOT EXISTS "proof_ocr_status" TEXT NOT NULL DEFAULT 'not_started';
--> statement-breakpoint
ALTER TABLE "bank_mutations"
  ADD COLUMN IF NOT EXISTS "proof_ocr_result" JSONB;
--> statement-breakpoint
ALTER TABLE "bank_mutations"
  ADD COLUMN IF NOT EXISTS "proof_ocr_error" TEXT;
--> statement-breakpoint
ALTER TABLE "bank_mutations"
  ADD COLUMN IF NOT EXISTS "proof_ocr_completed_at" TIMESTAMPTZ;