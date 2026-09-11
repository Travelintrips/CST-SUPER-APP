---
name: Customer tracking disclosure boundary
description: Security boundary for public and authenticated customer tracking responses.
---

Public tracking endpoints must return only status-safe shipment information and enforce a tight per-IP rate limit. Customer identity, invoice/payment values, proof-of-delivery files, driver/location details, and other private documents require canonical portal ownership; an email, display name, or guessed order number is not an ownership proof.

**Why:** Order-number and tokenized tracking URLs are easy to enumerate or forward. Returning financial, PII, or operational detail from those URLs creates cross-customer disclosure even when the underlying order lookup is read-only.

**How to apply:** When adding a tracking route, use the authenticated portal customer identity or an intentionally scoped, unguessable capability token. Keep anonymous/token fallback responses status-only and fail closed for private document or payment actions.