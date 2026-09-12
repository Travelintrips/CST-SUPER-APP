---
name: Customer order WhatsApp ownership
description: Durable boundary for Customer Portal logistic-order lifecycle notifications.
---

The canonical logistic-order transition service owns customer-facing WhatsApp notifications for lifecycle status changes. Driver, vendor-tracking, webhook, payment, and admin routes may trigger the transition, but must not send a second generic customer message for the same status.

**Why:** Multiple operational routes previously sent generic customer WhatsApp messages in addition to the status transition notification, creating duplicate or inconsistent messages and tracking links.

**How to apply:** Route-specific notifications may remain for admins, vendors, POD evidence, or operational alerts. Customer lifecycle status messages must use the transition service so idempotency, tracking URL selection, phone validation, provider failure logging, and audit behavior stay centralized.