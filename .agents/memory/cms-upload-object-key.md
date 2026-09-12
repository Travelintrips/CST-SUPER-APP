---
name: CMS upload object keys
description: Public CMS uploads must use storage keys with an extension that matches the prepared image bytes.
---

Public CMS image uploads must persist an object key with a real extension matching the prepared content type, including `.webp` after compression; bare UUID keys are rejected by the frontend image resolver as legacy references.

**Why:** The upload and CMS save can both return success while the preview silently falls back when the resolver rejects a bare UUID URL, even though the underlying object exists.

**How to apply:** Keep the extension decision in the shared public upload primitive, and preserve the existing resolver rule that rejects legacy bare UUID paths.