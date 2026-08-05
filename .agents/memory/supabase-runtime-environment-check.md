---
name: Supabase runtime environment check
description: How to distinguish configured runtime environment values from Replit Secret inventory when verifying Supabase connectivity.
---

Runtime Supabase connectivity may come from environment values injected by the project configuration rather than from entries visible in the Replit Secret inventory. A real masked environment check followed by a read-only connection probe is the reliable verification method.

**Why:** The secret inventory and the process environment represent different configuration surfaces, so checking only one can incorrectly report that Supabase is disconnected.

**How to apply:** Never print credential values. Check only presence, use the project’s target verifier, and confirm the database responds before declaring the connection ready. Verify development and production targets separately.