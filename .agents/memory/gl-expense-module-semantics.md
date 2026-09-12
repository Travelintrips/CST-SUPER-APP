---
name: GL expense module semantics
description: General Ledger module filters identify journal origin, while Beban Administrasi Bank from reconciliation remains a bank-reconciliation journal.
---

The Buku Besar “Pengeluaran/Biaya” filter is source-module based, not a universal filter for every COA account whose type is `expense`. Bank fees and Beban Administrasi Bank created through bank mutation approval therefore remain under `bank_reconciliation`; only expense-origin journals belong under `expense`.

**Why:** Reclassifying reconciliation journals by account type would hide their provenance and could mix both sides of a balanced journal into an unrelated module.

**How to apply:** Preserve source provenance in the module filter. Normalize legacy expense source-module aliases to `expense`, and use account-type filtering as a separate report/filter when users need all expense accounts across modules.