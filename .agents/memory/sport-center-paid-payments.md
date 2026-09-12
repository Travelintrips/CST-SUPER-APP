---
name: Sport Center paid booking → sport_payments invariant
description: Why some paid sport bookings vanish from the Pembayaran list, and the rule every write path must follow.
---

# Sport Center: paid booking must create a sport_payments row

The Pembayaran list (`GET /sport-center/payments`) reads only `sport_payments`. A booking
that is `payment_status='paid'` in `sport_bookings` but has NO `sport_payments` row will
silently disappear from Pembayaran (revenue KPIs still count it because dashboard sums
`sport_bookings.total_amount`, which masks the gap).

**Rule:** every code path that sets `sport_bookings.payment_status='paid'` MUST also ensure a
`sport_payments` row exists. Use the shared helper `ensurePaymentForPaidBooking(row, createdById)`
in `modules/sport-center/routes.ts` — it is idempotent (skips if a payment exists), inserts the
payment, posts the accounting journal, writes an audit log, and broadcasts.

**Why:** the legacy sync path (`POST .../push-bookings`) historically wrote `payment_status='paid'`
straight from legacy data without creating a payment, unlike `POST /payments` and the
`PATCH /bookings/:id` safety-net. That orphaned paid bookings (e.g. SC-0024, SC-0026).

**How to apply:** when adding any new endpoint/sync that can mark a booking paid, call the helper
right after the status write. Backfilling existing orphans = insert into `sport_payments` for
`payment_status='paid'` bookings that have no payment row.

**Known gaps (not yet fixed, would need user OK for schema change):**
- No DB unique constraint on `sport_payments.booking_id` → the SELECT-then-INSERT idempotency is
  best-effort, not race-proof. A unique partial index + `ON CONFLICT DO NOTHING` would harden it.
- Status update + payment insert are not in one transaction, so a mid-failure can re-orphan.
- Accounting journals are already double-post-safe (idempotent via `source`+`sourceId=bookingId`).
