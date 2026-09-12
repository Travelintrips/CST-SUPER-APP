
name: QRIS settlement matching
description: QRIS daily settlement can miss Sport Center matches when source payments are not stored as qris, settlement amounts are net, or the matcher excludes sport payments.

QRIS settlement reconciliation requires a payment source with `method=qris`, a stable reference or settlement relationship, and gross/net fee handling. A bank mutation containing a QRIS-like settlement description may still have no candidate when the Sport Center payment was stored as `transfer bank`, the settlement amount is net of MDR, or the settlement date differs from the booking payment date.

**Why:** The current data model and matcher paths do not consistently carry QRIS semantics: one matching path filters accounting payments to `posted`, another ERP document path does not include Sport Center payments as an active source, and exact-amount matching rejects net settlement amounts.

**How to apply:** When implementing QRIS reconciliation, preserve provider/reference and gross amount, record MDR/settlement net separately, include company-scoped Sport Center payments in the active matcher, and allow an explicit settlement relation rather than weakening exact matching globally. Treat `sport_center.sport_payments.payment_method` as the user-selected source of truth; mirror its value to local payment records during both full and incremental sync. `accounting_entries` are booking-level posted journals, so payment-method changes belong in `accounting_payments`; changing a posted journal's lines or metadata requires reversal/repost, never disabling immutability.
**How to apply:** When implementing QRIS reconciliation, preserve provider/reference and gross amount, record MDR/settlement net separately, include company-scoped Sport Center payments in the active matcher, and allow an explicit settlement relation rather than weakening exact matching globally. Treat `sport_center.sport_payments.payment_method` as the user-selected source of truth; mirror its value to local payment records during both full and incremental sync.

QRIS posting uses dedicated `accounting_settings` account/journal mappings when configured. Legacy fallback is bank-only; QRIS and other non-cash methods must never fall back to a cash account or cash journal.

**Why:** QRIS receipts are economically non-cash and may settle through a clearing account. Falling back to cash when bank configuration is incomplete can misstate the ledger and make settlement reconciliation misleading.

**How to apply:** Normalize provider and Sport Center method labels to `qris` before posting. Resolve the QRIS destination centrally for webhook, Sport Center atomic posting, incremental/bulk sync, and module ingest. Keep gross payment and MDR/net settlement as separate values. Bank descriptions may omit the literal `QRIS`; labels such as `QRTRAVELI` must still activate QRIS detection.
Important operational distinction: a paid `sport_payments` row is not itself a bank mutation. Matching runs from imported bank mutations toward candidate payments; every payment can only appear as a candidate when a corresponding bank credit/settlement has been imported. For unsettled payments, do not blindly treat `paid_at + 1 day` as the settlement date when the bank mutation is on the payment date.

**Why:** A runtime investigation found four paid QRIS Sport Center payments but only one QRIS bank mutation. The one candidate scored 70 because its null settlement date was derived as the next day, while the other three had no bank mutation to match at all.

**How to apply:** Diagnose both directions: first confirm a bank mutation exists for the expected amount/date (or a grouped `qris_settlements` row), then inspect candidate filters. Use explicit settlement data when available; otherwise use `paid_at` for unsettled direct credits and reserve next-day logic for a documented settlement rule.

Provider aliases such as `QRTRAVELI` must be treated as QRIS by the unified bank matcher, not only by the settlement-pattern module. Even after alias detection is fixed, an aggregate bank credit still requires an explicit `qris_settlements` row and item links; it must not be inferred from individual payments solely by amount.

**Why:** The UI can show a provider settlement description without the literal word `QRIS`, while the bank amount represents multiple Sport Center payments net of MDR. Literal-only QRIS detection sends the mutation through the wrong candidate path.

**How to apply:** Keep provider-alias detection shared across import, unified matching, and ERP matching. Match aggregate credits through an explicit settlement relation and preserve gross, fees, and net amounts separately.
