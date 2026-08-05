---
name: due_date column type drift (purchase_documents vs vendor_invoices)
description: In Supabase, purchase_documents.due_date is TEXT while vendor_invoices.due_date is TIMESTAMP — opposite of what the Drizzle schema/naming would suggest. Relevant when writing raw SQL UNION queries across these two tables.
---

`purchase_documents.due_date` is stored as **text** in the actual Supabase DB, while `vendor_invoices.due_date` is a real **timestamp**. This is schema drift from the Drizzle definitions and is easy to get backwards.

**Why:** A raw SQL UNION ALL across both tables (e.g. building an "outstanding invoices" list) applied `to_char()`/`::text` casts based on the assumed types and picked the wrong side, causing Postgres to reject the UNION ("function to_char(text, unknown) does not exist") and the whole endpoint to 500 with no useful client-side error beyond a generic toast.

**How to apply:** Before writing raw SQL that mixes `due_date` (or similar) across `purchase_documents` and `vendor_invoices`, verify actual column types with `information_schema.columns` rather than trusting the Drizzle schema file — don't assume type parity between tables that look structurally similar. Use `LEFT(col, 10)` for the text column and `to_char(col, 'YYYY-MM-DD')` for the timestamp column to normalize both to `YYYY-MM-DD` strings before UNIONing.
