---
name: Safe-dev Google Maps exception
description: Narrow outbound exception required for development address autocomplete.
---

Safe development mode may allow only the Google Maps web-service paths used by the address proxy, while continuing to block arbitrary external HTTP and other provider integrations.

**Why:** The customer portal's address autocomplete needs live Places predictions, but the development workflow intentionally enables a fail-closed outbound guard.

**How to apply:** Keep the exception limited to `maps.googleapis.com`, development only, and the exact Places/Distance Matrix paths; do not disable `SAFE_DEV_TEST_MODE` globally.

**Verification note:** Temporary browser-library installs can rewrite `replit.nix` ordering; compare it with the committed baseline and restore only the temporary environment delta before closing the proof.