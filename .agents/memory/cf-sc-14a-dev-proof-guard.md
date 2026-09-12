---
name: CF-SC-14A DEV proof guard
description: Shared DEV is forbidden for generic tests but may be used by an explicitly identified, fail-closed runtime proof.
---

The generic isolated-test guard must continue rejecting shared DEV and PROD. A
named DEV runtime proof needs its own narrow contract: explicit development
environment, SAFE_DEV_TEST_MODE, canonical DEV project fingerprint, distinct
PROD fingerprint, no PROD target selection, and an approved harness identity.

**Why:** Generic regression tests and owner-approved DEV certification have
different safety models; weakening the generic guard would make accidental
shared-database mutation possible.

**How to apply:** Reuse the authorized-proof helper for future CF runtime
certifications. When the DEV database uses transaction pooling, set per-proof
database mode with SET LOCAL inside the same explicit transaction as the
function call.