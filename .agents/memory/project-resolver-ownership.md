---
name: Project resolver ownership
description: Rules for routing shared finance configuration and preserving transaction atomicity.
---

Project-aware finance resolution must explicitly allow only certified project owners; unknown project codes must fail closed rather than defaulting to Sport Center.

**Why:** A generic fallback silently crossed ownership boundaries, and resolving through a separate database connection would break the atomicity of a Customer Portal processor transaction.

**How to apply:** Keep project dispatch explicit and expose a client-backed resolver for processors that already hold a transaction client; use the same live SQL owner and contract.