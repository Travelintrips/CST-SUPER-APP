---
name: Customer tracking disclosure boundary
description: Security boundary for public and authenticated customer tracking responses.
---

Public tracking endpoints must return only status-safe shipment information and enforce a tight per-IP rate limit. Customer identity, invoice/payment values, proof-of-delivery files, driver/location details, and other private documents require canonical portal ownership; an email, display name, or guessed order number is not an ownership proof.

**Why:** Order-number and tokenized tracking URLs are easy to enumerate or forward. Returning financial, PII, or operational detail from those URLs creates cross-customer disclosure even when the underlying order lookup is read-only.

**How to apply:** When adding a tracking route, use the authenticated portal customer identity or an intentionally scoped, unguessable capability token. Keep anonymous/token fallback responses status-only and fail closed for private document or payment actions.

Legacy aliases are part of the public attack surface: if a frontend still calls an older tracking path, it must share the same safelist, redaction, and rate-limit middleware as the canonical route.

**Why:** The older Air Freight alias remained active through the Customer Portal and could disclose fields even though the newer tracking route was already hardened.

**How to apply:** Audit every mounted alias and frontend URL, not only the preferred route name, before certifying public tracking.