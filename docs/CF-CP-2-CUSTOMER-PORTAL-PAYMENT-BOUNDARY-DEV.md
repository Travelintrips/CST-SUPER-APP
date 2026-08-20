# CF-CP-2 — Customer Portal Payment Boundary (Development)

Status: implemented as a development-only shadow boundary. This phase does
not cut over production and does not add settlement, bank mutation, or
reconciliation behavior.

## Canonical contract

- Canonical payment: `public.payments.id`
- `source_project`: `customer_portal`
- `source_payment_id`: `public.payments.id`
- `event_type`: `payment_confirmed`
- Correlation: `customer_portal:payment:<payment_id>:payment_confirmed`
- Snapshot company: resolved from the payment or its authoritative parent
  document; confirmation fails closed when it is ambiguous.

Invoice/document number, provider reference, and payment-proof ID remain
metadata only. They are not finance identity.

## Durable shadow event

The additive table `customer_payment_finance_events` stores an immutable
confirmation snapshot: company/customer/document or order identity, amount,
currency, method, provider, provider reference, paid/confirmed timestamps,
schema version, and creation timestamp.

Database uniqueness is enforced on:

```text
(source_project, source_payment_id, event_type)
correlation_id
```

Retries therefore reuse the same event. There is no downstream consumer in
this phase.

The mode is `shadow` only outside production. `central` is intentionally not
implemented. Production remains on the legacy path unless a future,
explicitly reviewed cutover changes the mode.

## Transition and race boundary

Both Paylabs callback and admin `simulate-paid` call the same confirmation
helper. It:

1. locks the canonical payment row with `FOR UPDATE`;
2. transitions it to `paid` and creates/reuses the durable event in one
   transaction;
3. returns `firstPaidTransition`;
4. lets the existing legacy accounting path run only for that first
   transition.

This covers callback retry, callback/callback race, callback/admin race, and
simulate-paid retry without creating channel-specific finance identities.
The known direct legacy accounting producers remain:

- Paylabs webhook
- admin `simulate-paid`

They were not removed in this transitional phase.

## Payment-proof boundary

Uploading proof updates the existing sales-document proof fields and audit
trail only. It does not call the confirmation helper, create a finance event,
post accounting, create a bank mutation, settle, or reconcile. Only a
confirmed canonical `payments` row emits `payment_confirmed`.

## Safety and verification

- No real Paylabs call was added.
- No production write or cutover was performed.
- No BizPortal or Sport Center code was changed.
- No settlement or reconciliation implementation was added.
- Migration is additive and idempotent; no `DROP` or destructive fixture is
  used.
- Fixture creation is not part of the HTTP path; tests use source contracts
  and do not commit payment data.

Verified locally:

- API typecheck: PASS
- API build: PASS
- `git diff --check`: PASS
- CF-CP-2 boundary regression tests: added

Runtime API readiness and customer portal workflow should be checked after
the configured development workflows are restarted. Production writes: 0.
Production cutover: NO.
