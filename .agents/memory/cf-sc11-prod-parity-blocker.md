---
name: CF-SC-11 production parity blocker
description: Production Central Finance is not shadow-ready until the shared contract and canonical bridge are installed and startup state is healthy.
---

The production Central Finance contract can be materially behind DEV: missing
shared-config tables, resolver/bridge functions, canonical settlement FK, and
failed startup markers are independent blockers even when legacy settlement
tables and some functions exist.

**Why:** A read-only parity audit found PROD with legacy objects but without
the CF-SC-10C/10D contract; treating partial function/table presence as
readiness would allow an unsafe shadow cutover.

**How to apply:** Before any shadow or cutover decision, prove every required
relation, function definition, FK owner, shared config identity, and startup
stage against PROD in a read-only transaction. Keep finance mode legacy until
all blockers are resolved and re-audited.