---
name: Release candidate validation
description: Constraints discovered while validating the Customer Portal and BizPortal release gate.
---

A shared-development release check must not run application write E2E while the running API can read live WhatsApp, SMTP, payment, webhook, or storage credentials. A standalone SQL harness with explicit outbound suppression is safer, but it does not prove UI/API behavior.

**Why:** The API process can have outbound credentials even when the test harness is configured as SAFE DEV TEST MODE; posting an order through the real route can therefore create real external side effects.

**How to apply:** Before any app-level write E2E, use a dedicated target or start an application instance with explicit no-outbound transport guards and run-scoped cleanup. Keep the production verdict NO-GO until the actual UI/API path is exercised.

The release gate must first verify that every documented command exists in package scripts and that the command names match the repository. A missing command is a gate failure, not a reason to substitute an untracked alias silently.

**Why:** A release procedure can appear complete while skipping its intended build layer when a documented script name is stale or absent.

**How to apply:** Run command discovery before the build sequence; record missing scripts as blockers and separately run the closest existing checks only for diagnosis.