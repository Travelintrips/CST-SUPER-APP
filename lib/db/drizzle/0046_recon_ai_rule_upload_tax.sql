-- Rule AI document/OCR requirements and explicit PPN routing.
ALTER TABLE "recon_ai_classification_rules"
  ADD COLUMN IF NOT EXISTS "requires_document_upload" BOOLEAN NOT NULL DEFAULT FALSE;
--> statement-breakpoint
ALTER TABLE "recon_ai_classification_rules"
  ADD COLUMN IF NOT EXISTS "tax_type" TEXT NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "recon_rules"
  ADD COLUMN IF NOT EXISTS "requires_document_upload" BOOLEAN NOT NULL DEFAULT FALSE;
--> statement-breakpoint
ALTER TABLE "recon_rules"
  ADD COLUMN IF NOT EXISTS "tax_type" TEXT NOT NULL DEFAULT 'none';