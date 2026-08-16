---
name: Trial balance parent rollup
description: Parent COA balances must be derived from descendant journal lines, and runtime evidence must preserve the endpoint's company/date scope.
---

## Rule
Trial Balance reports that promise hierarchical accounts must roll each posted line through its account and every ancestor; header accounts generally have no direct journal lines. Runtime assertions must use the same company and period filters as the authenticated endpoint.

**Why:** A direct-line query can make production parents appear missing even when the COA links are correct, while an all-company query can produce totals that do not match a scoped UI response.

**How to apply:** When comparing DEV and PROD or validating a reported amount, first identify the exact report route and request filters, then assert the child and ancestor rows within that same scope.