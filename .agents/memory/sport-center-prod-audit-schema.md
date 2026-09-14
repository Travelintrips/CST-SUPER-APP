---
name: Sport Center PROD audit schema
description: Live production schema differences that affect read-only Sport Center payment and accounting audits.
---

For PROD Sport Center audits, do not assume `sport_center.sport_payments` carries `journal_id`, `entry_id`, or `accounting_payment_id`; resolve posted payment journals from `sport_center.accounting_journals.payment_id`. `payment_provider` is an enum and must be cast to text before empty-string normalization. The public booking mirror exposes `booking_number`, while the canonical Sport Center booking exposes `order_number`.

**Why:** The live external Supabase schema is ahead of or different from repository/mirror assumptions. Reusing mirror projections caused query failures and could have produced incomplete journal coverage.

**How to apply:** Inspect live `information_schema` columns before composing cross-schema audit SQL, cast enum fields explicitly, and keep the audit runner read-only with `SET statement_timeout` after opening the pooler connection.