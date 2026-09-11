---
name: Sheet sync runtime gates
description: Google Sheet bank sync requires a loaded service-account credential and an active company account binding; zero parsed rows can falsely leave config status as ok.
---

The bank Sheet sync is fail-closed only when it reaches account binding: `GOOGLE_SERVICE_ACCOUNT_JSON` must be present in the API runtime, and a configured account number must match an active `company_bank_accounts` row for the config company. A Sheet with zero parsed rows returns `ok` before that account validation, so `last_sync_status=ok` does not prove that any mutation was imported.

**Why:** Runtime DEV can retain a stale successful status while the current API cannot read the Sheet or while the parser drops every row, making an empty mutation list look like a filtering problem.

**How to apply:** Check secret presence, config/account identity, and parser diagnostics/counts in that order before investigating list filters or reconciliation matching.