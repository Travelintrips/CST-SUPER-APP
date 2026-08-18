---
name: QRIS account rule defaults
description: Safe handling of incomplete account-scoped QRIS provider configuration
---

Account-scoped QRIS provider rows can contain only the provider identity and core settlement fields; optional variance tolerances may be absent from the query or legacy data. The rule builder must merge the row with the provider default before reading any optional field.

**Why:** An account rule with omitted tolerance fields previously dereferenced the not-yet-created provider rule and crashed candidate generation instead of returning a reviewable result.

**How to apply:** When adding or changing QRIS provider-rule loading, treat account-specific configuration as an override of `DEFAULT_QRIS_PROVIDER_RULES`, and keep a regression test for a sparse account row.