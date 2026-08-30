---
name: Public mutation cutover safety
description: Safety rule for moving settlement links from a mirrored mutation table to the public mutation identity.
---

The public bank-mutation identity is the only active reconciliation identity. Compatibility link columns must be written and cleared atomically, and approval must re-resolve the company-scoped bank account rather than trusting candidate-time filtering.

**Why:** A later public-only migration block is not sufficient if an earlier startup block first recreates legacy foreign keys or clears values that are valid only in the new identity space. That can silently damage links on the second startup.

**How to apply:** Disable obsolete projection/FK setup before the cutover runs. Translate legacy values only when the live FK target still proves they are legacy; after public FKs exist, never reinterpret numeric IDs. Verify a second pass and overlapping-ID cases.