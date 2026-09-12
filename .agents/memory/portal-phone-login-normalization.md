---
name: Portal phone login normalization
description: Compatibility rule for WhatsApp OTP login against legacy portal customer phone formats.
---

Portal phone authentication must compare the canonical normalized phone identity, while accepting legacy stored representations such as local `0` and international `+62`/`62` forms. OTP delivery alone is not proof that an account exists: delivery stores an OTP first, then login performs the account lookup.

**Why:** Existing accounts can predate canonical phone storage. A raw string equality check makes a valid old account appear unregistered even though the OTP was delivered successfully.

**How to apply:** Reuse the canonical phone normalizer for both login lookup and duplicate-registration checks. Treat multiple normalized matches as an ambiguity requiring review rather than silently selecting an account.