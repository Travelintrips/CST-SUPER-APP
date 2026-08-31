---
name: Marketplace destination production migration
description: Production RFQ submissions require the destination metadata columns before the new pipeline can accept requests.
---

The Marketplace RFQ service always includes destination_place_id, destination_lat, and destination_lng in its mkt_rfqs INSERT. If production mkt_rfqs lacks those nullable columns, every new-pipeline RFQ returns a generic HTTP 500 after the database rejects the INSERT.

**Why:** The development-only destination migration intentionally skips production, so adding the Drizzle SQL file alone does not update the external Supabase runtime database.

**How to apply:** Before enabling or publishing the RFQ flow, verify the three columns in the target production database and apply the additive migration through the approved production migration process. Do not bypass the production guard by changing preview startup behavior.