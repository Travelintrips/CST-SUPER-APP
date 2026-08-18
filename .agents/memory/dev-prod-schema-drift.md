---
name: dev-prod schema drift
description: Use the canonical additive report for DEV/PROD parity; preserve production hardening and require owner decisions for ambiguous dependencies.
---

The July 2, 2026 table-count snapshot is superseded. The current reconciliation
method compares normalized application scope rather than copying raw catalogs.

**Why:** DEV and PROD intentionally contain different legacy, security, and
runtime-managed objects. A raw catalog diff can misclassify production RLS
hardening or legacy dependencies as defects and cause unsafe promotion.

**How to apply:** Run `scripts/run-sync-schema-additive.mjs` through the official
Secret Manager loader. Use report-only mode first; only `--apply-safe` is allowed
for complete source-controlled additive objects. Never drop, replace, disable,
or weaken existing production objects through automatic reconciliation.

As of August 18, 2026, the canonical report found no promoted tables, columns,
enums, constraints, indexes, triggers, views, policies, or RLS changes. The
only safe additive promotion was the source-controlled Sport Center settlement
recovery function, which was installed in PROD and verified by a second
read-only report. One AI-table dependency remains an explicit owner decision;
do not promote it automatically.