
name: QRIS settlement matching
description: QRIS daily settlement can miss Sport Center matches when source payments are not stored as qris, settlement amounts are net, or the matcher excludes sport payments.

QRIS settlement reconciliation requires a payment source with `method=qris`, a stable reference or settlement relationship, and gross/net fee handling. A bank mutation containing a QRIS-like settlement description may still have no candidate when the Sport Center payment was stored as `transfer bank`, the settlement amount is net of MDR, or the settlement date differs from the booking payment date.

**Why:** The current data model and matcher paths do not consistently carry QRIS semantics: one matching path filters accounting payments to `posted`, another ERP document path does not include Sport Center payments as an active source, and exact-amount matching rejects net settlement amounts.

**How to apply:** When implementing QRIS reconciliation, preserve provider/reference and gross amount, record MDR/settlement net separately, include company-scoped Sport Center payments in the active matcher, and allow an explicit settlement relation rather than weakening exact matching globally. Treat `sport_center.sport_payments.payment_method` as the user-selected source of truth; mirror its value to local payment records during both full and incremental sync. `accounting_entries` are booking-level posted journals, so payment-method changes belong in `accounting_payments`; changing a posted journal's lines or metadata requires reversal/repost, never disabling immutability.