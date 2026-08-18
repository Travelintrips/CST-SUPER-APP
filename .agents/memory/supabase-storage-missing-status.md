---
name: Supabase missing-object status
description: Public Supabase Storage may wrap a missing object as HTTP 400 while the JSON body carries a 404/NoSuchKey status.
---

Treat a missing public Supabase Storage object as a semantic not-found when the response is HTTP 400 with JSON `statusCode: "404"` and `code: "NoSuchKey"`. Verification should combine HTTP status/body evidence with Storage listing absence and, where possible, a known-good replacement object; do not retry deletion solely because the wrapper is not HTTP 404.

**Why:** The development Hero cleanup returned HTTP 400 after `storage.remove`, but the body explicitly reported `Object not found`, while the object was absent from listing and the restored legacy Hero remained 200 `image/webp`.

**How to apply:** For missing-object checks, record both transport status and semantic body status, and require listing absence plus a valid referenced replacement before declaring cleanup safe.