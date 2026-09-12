---
name: Sport payment mirror ownership
description: Ownership contract for Sport Center payment mirrors and accounting posting.
---

The PostgreSQL trigger is the sole owner of `public.sport_payments` rows mirrored from `sport_center.sport_payments`. Application workers must not insert, refresh payment metadata, or delete these trigger-created rows.

**Why:** Two writers created duplicate/competing payment rows, and deletion sync could remove a trigger mirror before accounting reconciliation completed.

**How to apply:** Use the `SCPAY-SC-{canonical_payment_id}` lookup key. A worker may only fill a missing local `booking_id`, then post accounting from the mirror; `accounting_payments.source_doc_id` must equal the mirror row's public ID. Never use the canonical Supabase payment ID as `source_doc_id`.