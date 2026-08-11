---
name: Canonical settlement builder contract
description: Spec-only contract and fail-closed gates for future Sport Center settlement building.
---

The canonical settlement builder must reuse `sport_center.*` tables and the verified canonical journal owner; it must not reuse generic QRIS settlement or bank reconciliation posting.

**Why:** The repository has canonical settlement read/approval paths and generic accounting engines, but no proven Sport Center settlement creation owner. Guessing the payment-journal bridge, fee columns, payment status transition, or batch uniqueness would risk duplicate financial records.

**How to apply:** Before implementation, prove the live payment-to-posted-journal bridge, owner-approved fee/rate columns, settlement journal creator/finalizer, payment success-state transition, and batch-group concurrency backstop. Keep builder scope separate from 4C-8.