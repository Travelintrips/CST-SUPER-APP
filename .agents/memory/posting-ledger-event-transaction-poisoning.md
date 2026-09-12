---
name: postLedgerEvent transaction poisoning — FIXED
description: postLedgerEvent must never be called with a transaction client; using global db (no client param) prevents 25P02 from poisoning the caller's transaction.
---

**Root cause:** `postLedgerEvent()` in `lib/accounting.ts` catches its own INSERT errors
(intentional — audit trail is fire-and-forget). But when called with `client = tx` inside
a `db.transaction()`, a swallowed INSERT failure still poisons the Postgres transaction —
subsequent queries in that `tx` fail with PG code `25P02 → JOURNAL_TX_ABORTED`, which
surfaces to users as "Pengembalian dana gagal dicatat / transaksi dibatalkan".

**Fix applied:** Both `postLedgerEvent` call sites in `lib/accounting.ts` had the `client`
parameter removed:
1. `_postEntryCore` (~line 508) — used by ALL journal postings including intercompany pair
2. `closeFinancialPeriod` (~line 997) — used by period closing transaction

By omitting `client`, `postLedgerEvent` always uses the global `db` (auto-commit), so a
failed ledger_events INSERT never aborts the caller's transaction.

**Why:** discovered again when `postIntercompanyRepaymentPair` (which runs inside
`db.transaction()`) triggered the bug because `ledger_events` had the wrong schema
(fleet module's version vs accounting module's version; the fleet CREATE TABLE ran first,
missing `period`/`entry_id`/`payload` columns).

**How to apply:** Never pass `client` (transaction) to `postLedgerEvent`. The function
comment already says "fire-and-forget" — enforce it by keeping it global-db-only.
Any future caller of `_postEntryCore` or `postEntryWithClient` inside a `db.transaction()`
is safe as long as this rule holds.
