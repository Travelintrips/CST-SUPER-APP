---
name: Customer Portal proof cleanup
description: Development-only multi-service fixtures need explicit cleanup for child tables whose live schema lacks foreign keys.
---

Marker-scoped fixture cleanup must delete known Customer Portal child rows explicitly before deleting canonical parent rows; FK graph discovery is not sufficient when the live Supabase schema has an unenforced relationship.

**Why:** The development Customer Service Request item table retained marker rows after its parent requests were removed because the live schema did not expose a foreign key for that relationship.

**How to apply:** Keep fixture creation canonical through HTTP, record every parent ID, delete request documents/items (including marker-based fallback rows) before parents inside the cleanup transaction, and run a post-cleanup marker count across roots, children, and notifications.