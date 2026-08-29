---
name: Sport payment candidate visibility
description: Boundary between QRIS H-1 filtering and ordinary Sport Center bank-transfer candidates in bank reconciliation.
---

The bank-reconciliation API must apply the exact H-1 settlement-date gate only to QRIS evidence. A persisted `sport_payment` candidate classified as an ordinary bank transfer must remain visible for reviewer confirmation, even though it is not a QRIS settlement.

**Why:** Applying the QRIS gate to every `sport_payment` hid valid same-day Transfer Bank candidates from the API response while leaving their match rows in the database, producing a misleading “Kandidat Match (0)” UI.

**How to apply:** When changing candidate visibility or review-window SQL, classify the linked Sport Center payment before applying settlement-date rules; preserve the stricter H-1 rule for direct QRIS payments and QRIS settlement candidates.