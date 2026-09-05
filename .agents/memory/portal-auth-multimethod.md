---
name: Customer Portal multi-method auth
description: Durable rules for linking public portal login methods and exposing provider availability safely.
---

The Customer/Vendor Portal must keep `portal_customers` as the single canonical account. Verified email, password, Google, and WhatsApp identities link to that account through a provider+subject uniqueness boundary; never merge accounts from display names or unverified contact data.

**Why:** Different providers can represent the same human or organization, while provider collisions and concurrent signup can otherwise create duplicate profiles or silently take over an existing identity.

**How to apply:** Additive auth persistence needs its own registered startup migration stage because the legacy portal migration marker may already be complete. Frontend login/register controls must consume a public capability contract and keep unconfigured providers disabled/fail-closed. In SAFE_DEV_TEST_MODE, choose the simulated OTP branch before checking provider-token presence; development secret bundles can still contain real provider configuration.