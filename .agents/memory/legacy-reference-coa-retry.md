---
name: Legacy Referensi COA retry
description: Controlled recovery path for historical manual-review bank mutations that never attempted a COA journal.
---

Historical `manual_review` mutations may retry Reference COA matching only when a rule match exists and no auto-post attempt or block was ever recorded.

**Why:** The old fallback message represented missing processing evidence, not a failed journal safeguard. Retrying every manual-review mutation could bypass a real accounting block or make unintended financial changes.

**How to apply:** Make recovery an explicit reviewer action. On retry, run the normal matching and journal safeguards; record the actual block reason if it fails, and keep rows with an existing attempt/block on the normal manual-review path.