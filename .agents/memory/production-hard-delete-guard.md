---
name: Production hard-delete guard
description: Safe boundary for explicitly approved deletion of posted bank-reconciliation data in production
---

Hard deletion of posted bank-reconciliation data must cover both the accounting journal/line guard and the immutable fleet-ledger mirror; disable only those delete guards inside one locked transaction and restore them before commit while keeping foreign keys active. Auto-post discovery must combine audit evidence with journal-line markers and source provenance because historical auto-posts may have incomplete audit rows.

**Why:** The posted-journal workflow is intentionally reversal-first, and the fleet mirror has an independent immutable guard. Deleting only the primary journal guard either fails or leaves derived ledger rows behind; relying only on `MATCH_APPROVED_AUTO_POSTED` misses older auto-post journals whose source mutation or audit history is gone.

**How to apply:** Re-identify exact targets at execution time from source, line-description and audit evidence, fail closed on count or reference changes, remove derived mirror rows and source rows atomically, and verify every targeted surface plus trigger state after commit.

During a production purge, pause both the active DB sheet configuration and the legacy environment-based sheet fallback first; marking every DB config inactive alone can cause the legacy worker to reimport the same sheet.

**Why:** The nightly sync treats “no active DB config” as permission to use `GOOGLE_SHEET_ID_BANK_MUTATIONS`, so a successful delete can be undone minutes later.

**How to apply:** Keep the source sheet untouched, use a reversible pause/circuit-breaker state for the configured sheet, delete only after the sync cycle stops, then verify zero rows over a stability window.

If a cleanup script reports an error after issuing `COMMIT`, treat the commit outcome as unknown; never retry the delete from the stale pre-transaction manifest. Re-query the live target predicate first, then run post-commit verification separately.

**Why:** A production cleanup can successfully commit while a subsequent in-process verification formatter fails, making a retry unsafe even though the original command exits non-zero.

**How to apply:** Separate mutation and verification phases, make the delete manifest fail-closed, and use a fresh read-only query to distinguish “not committed” from “committed but verifier failed.”