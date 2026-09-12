---
name: AI policy COA contract
description: Contract boundary between Phase 3 COA prediction and Phase 9 decision policy.
---

The decision policy must consume the Phase 3 `primaryRecommendation` field. Do
not reintroduce the legacy `recommendedCoa` name in policy rules or fixtures.

**Why:** The legacy name made otherwise clean transactions appear to have no
COA recommendation, forcing unnecessary manual review and breaking auto-clear
regression tests.

**How to apply:** When changing Phase 3 or Phase 9, verify the shared type and
the policy rule read the same recommendation field, then run the policy
regression suite.