---
name: Marketplace invoice upload idempotency
description: Private invoice attachments must be cleaned up when invoice creation is duplicate or fails.
---

Marketplace vendor invoice creation may upload the private attachment before the database transaction finishes.

**Why:** A retry can legitimately return the existing invoice. Keeping the newly uploaded object in that case creates orphaned private files even though no second invoice exists.

**How to apply:** Delete the newly uploaded object on duplicate results and on every failed transaction; only retain it after a new invoice header and lines commit successfully.