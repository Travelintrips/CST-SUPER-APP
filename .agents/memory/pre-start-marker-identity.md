---
name: Pre-start marker identity
description: Distinguishes the persistent startup gate from the nested legacy compatibility marker during schema-stall diagnosis.
---

The persistent startup stage uses `pre_start_schema`; the nested legacy compatibility check uses `api_pre_start_schema`. They have different lifecycle behavior and must not be treated as the same marker during reproduction or recovery.

**Why:** Resetting only the compatibility marker leaves the outer registry snapshot completed, so the pre-start callback is skipped and the expected substep trace never appears.

**How to apply:** When reproducing a pre-start stall, inspect and manipulate only the `pre_start_schema` gate for the outer running/completed transition; use `api_pre_start_schema` only to test the nested legacy DDL branch.