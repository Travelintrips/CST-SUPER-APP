---
name: rfq_vendor_links FK ambiguity fix
description: rfq_vendor_links belongs to the logistic RFQ domain only; a prior patch wrongly FK'd it to mkt_rfqs based on naming, not usage
---

`rfq_vendor_links.rfq_id` is logistic-only (references `logistic_order_rfqs`), never marketplace. A prior FK-completion patch added a second FK to `mkt_rfqs` purely from table-name pattern-matching ("rfq" → assumed marketplace), without checking the Drizzle schema (`lib/db/src/schema/rfqVendorLinks.ts`) or actual consumers (`rfqStatusService.ts`, `vendorInvitationService.ts`, `adminAction.ts`, etc.), all of which exclusively use the logistic chain.

**Why:** Table/column naming patterns are not reliable evidence of FK target — always verify against the Drizzle schema's `.references()` call and real query usage before adding a cross-domain FK, especially when two parallel domains (logistics vs. marketplace) have similarly-named RFQ/quote tables.

**How to apply:** Before adding any FK to a table shared between the logistics and marketplace RFQ chains (`logistic_order_rfqs`/`rfq_vendor_links` vs `mkt_rfqs`/`mkt_vendor_quotes`), grep actual usage first. Also: boot migrations that self-correct a prior mistake should not swallow all errors into a warn+continue — let genuine DDL failures propagate so `runWithRetry` retries, and add a postcondition check after DROP/ALTER to confirm the change actually took effect before logging success.
