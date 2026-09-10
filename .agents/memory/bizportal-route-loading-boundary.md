---
name: BizPortal route loading boundary
description: The boundary between frontend route-chunk latency and an active API process that may be stale or misconfigured.
---

Route preloading is useful for the first navigation to a lazy BizPortal page, but it cannot hide latency from authenticated page data requests. In this workspace, restarting the artifact API workflow may only start a yielding instance when an older primary API process already owns the ports; verify the active process/build before treating a backend error as a frontend loading problem.

**Why:** A current BizPortal preview can look healthy while the active API still serves an older build or repeatedly retries invalid development database credentials, making menu navigation appear slow or stuck.

**How to apply:** First measure and preload route chunks on menu intent. Then verify the actual API owner, `/api/health/live`, authenticated request timings, and database target before changing page-level fetches or adding more frontend loading work.