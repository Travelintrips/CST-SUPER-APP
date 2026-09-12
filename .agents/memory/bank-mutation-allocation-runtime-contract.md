---
name: Bank mutation allocation runtime contract
description: Runtime migration and legacy date-type constraints for multi-allocation bank mutation flows.
---

Additive schema changes for payment allocation lineage must be registered with the persistent startup migration registry using the exact display name passed to the startup chain. A migration file and chain registration alone are insufficient; an unregistered stage fails startup readiness.

**Why:** The original Batch 3 marker could already be complete, so lineage DDL needed an independent stage. A missing registry row caused the API to stay non-ready with `Startup stage is not registered`.

**How to apply:** For every additive repair, add the migration function, register its stable stage name/version, invoke it from startup and the development runner, then verify the runtime registry row is `completed`.

The development runtime may expose `bank_mutations.transaction_date` as text even when the logical contract is an ISO date.

**Why:** Comparing that column directly to a PostgreSQL `date` produced `operator does not exist: text = date` during previous-allocation lookup.

**How to apply:** Normalize and validate reviewer input as `YYYY-MM-DD`, then compare against the stored ISO text without casting legacy column values.