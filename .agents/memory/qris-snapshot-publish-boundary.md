---
name: QRIS snapshot publish boundary
description: Production candidate snapshots can be recreated by an older deployed generator after a manual correction.
---

A production QRIS candidate snapshot repair is not durable until the generator code that produced the corrected membership is published. An older deployed API can supersede the corrected row when a reviewer regenerates or refreshes the candidate.

**Why:** A corrected snapshot was replaced by a newer production snapshot containing the previously excluded duplicate payment because the running production generator had not received the code change.

**How to apply:** After a guarded production snapshot repair, verify the newest active row, then publish the generator before allowing regeneration. If publish is pending, avoid treating a manual snapshot repair as the final fix.