---
name: Bank reconciliation approval readiness
description: Boundary between candidate evidence, manual review, and approval-ready bank mutations.
---

Candidate evidence is not approval readiness. If the matcher persists a score-based review reason alongside `status = matched`, the read projection and summary must expose it as `manual_review`; the UI must not present a direct candidate approval action for that row. Multiple Sport Center candidates remain a selection state until one candidate is explicitly chosen.

**Why:** A raw `matched` status previously let low-confidence or ambiguous candidates enter “Siap Disetujui” and made the UI offer an approval action that could fail later on accounting safeguards.

**How to apply:** Keep list, count, and summary endpoints on the same effective-status projection, and use the same readiness boundary for candidate action labels and buttons.