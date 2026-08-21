---
name: CF-CP-6B migration
description: Durable constraints for Customer Portal Jasa mapping and its DEV proof harness.
---

CF-CP-6B service mappings are keyed by service scope. The mapping identity must
include normalized `service_scope`; otherwise multiple valid Jasa services collide
under a legacy product-level unique index.

**Why:** The first live application exposed that the pre-existing uniqueness rule
treated all Jasa revenue mappings as one identity even though the resolver requires
one mapping per canonical service type.

**How to apply:** When adding or repairing service-scoped COA mappings, recreate
the DEV identity index with service scope and keep unsupported service types
unmapped until an exact revenue identity is proven.

One-off CF-CP harnesses must run through the development Secret Manager loader;
setting `APP_ENV` alone does not provide the external Supabase DEV URL.

**Why:** Direct harness execution fell back to the local helium database and
failed the target guard before exercising any proof.

**How to apply:** Use the same development loader as the API for harness execution,
while retaining explicit safe-mode and DEV project-ref assertions.