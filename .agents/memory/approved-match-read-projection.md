---
name: Approved match read projection
description: Read-side contract for hiding duplicate reconciliation actions when approved history is filtered from candidate details.
---

Project whether a bank mutation already has an approved reconciliation match as a separate read-model field. Do not infer ownership only from the visible candidate array, because source/date/history filters can hide the approved row while the approval guard still sees it.

**Why:** The approval endpoint correctly rejected a second settlement, but the UI offered the action because its candidate projection omitted the existing approved match. The user discovered the conflict only after clicking.

**How to apply:** Keep the mutation visible for audit or duplicate review, but make candidate actions non-actionable whenever the explicit approved-match flag is true. Keep backend approval guards authoritative for races.