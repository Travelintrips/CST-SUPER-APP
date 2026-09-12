---
name: Financial Immutability Layer
description: 6-rule guard system untuk accounting — canonical entry point, DB triggers, outbox pattern, event-driven spot check, checksum + previous_entry_id.
---

# Financial Immutability Layer

## Files

- `artifacts/api-server/src/lib/accounting/ledgerGuard.ts` — Rule 1 (`createJournal()`) + Rule 2/5 (DB triggers via `runGuardMigration()`) + Rule 3 (`validateJournalCreation()`)
- `artifacts/api-server/src/lib/accounting/approveAndCreateJournal.ts` — reconciliation-specific approval gate; calls `postEntry(source:"bank_reconciliation")`
- `artifacts/api-server/src/lib/events/financialEventBus.ts` — Rule 5 event bus, DB persistence ke `financial_events`
- `artifacts/api-server/src/lib/accounting/outboxProcessor.ts` — Rule 3 outbox, `financial_outbox_events` table, worker polls every 10s
- `artifacts/api-server/src/lib/jobs/ledgerConsistencyCheck.ts` — Rule 4 event-driven spot check (`scheduleSpotCheck(entryId)`) + cron (4h)

## DB Tables Added

- `ledger_guard_audit` — setiap `validateJournalCreation()` + `createJournal()` call dicatat
- `financial_events` — canonical event log (persisted by financialEventBus)
- `financial_outbox_events` — outbox buffer (status: pending → processing → done/failed)
- `ledger_consistency_alerts` — temuan dari consistency check

## DB Columns Added (via ALTER TABLE IF NOT EXISTS)

On `accounting_entries`:
- `ledger_source_type TEXT`
- `ledger_source_id TEXT`
- `checksum_hash TEXT` — SHA-256 dari (entryNumber + source + sourceId + totalDebit + totalCredit + companyId + date)
- `previous_entry_id INTEGER` — untuk reversal, menunjuk ke entry asli

## DB Triggers

- `ae_insert_guard` (BEFORE INSERT) — block jika `source IS NULL`; warn jika `created_by_id IS NULL` dan source bukan manual
- `ae_immutability` (BEFORE UPDATE) — block status change dari 'posted' ke selain 'voided'; block perubahan financial fields (total_debit, total_credit, journal_id, date, source, source_id) pada posted entry

## Worker Registration (index.ts)

- `financial-outbox-processor` → `startOutboxProcessor`, delay 3000ms
- `ledger-consistency-check` → `startLedgerConsistencyWorker`, delay 95000ms

## Key Design Decisions

**Why**: DB trigger sebagai final safety net karena application-level guard (ledgerGuard.createJournal) bisa di-bypass dengan direct SQL. Trigger memastikan TIDAK ADA bypass.

**Why outbox vs in-process emit**: outbox survives process crash; financial_events bisa diisi ulang dari outbox jika hilang.

**Why spot check 50ms delay**: jika dilakukan synchronous, akan menambah latency ke setiap journal creation. 50ms delay cukup untuk lines sudah ter-insert sebelum check berjalan.

**Checksum computed AFTER insert**: via non-blocking UPDATE karena checksum tidak diperlukan untuk idempotency check (yang menggunakan source+sourceId unique index). Checksum adalah audit trail only.

**tagJournalEntry UPDATE vs insert field**: ledger_source_type dan ledger_source_id diset via UPDATE setelah insert karena columns tidak ada di Drizzle schema — hanya via raw SQL ALTER TABLE. Columns ini tidak diblok oleh immutability trigger (hanya financial fields yang diblok).

**GOVERNANCE_EXEMPT_SOURCES**: ['reversal', 'bank_reconciliation', 'bank_reconciliation_void'] dikecualikan dari governance warning di postEntry() — mereka sudah melalui guard layer.
