-- Phase 2G — Marketplace PO Fulfillment (Batch 1)
-- Scope: Marketplace module ONLY. Additive only — no DROP/RENAME, no data
-- backfill, no changes to existing rows. Existing mkt_po_status values
-- (pending, confirmed, in_progress, delivered, completed, cancelled) are
-- preserved as-is.
--
-- Adds:
--   1. 10 new mkt_po_status enum values (additive)
--   2. 9 new nullable columns on mkt_purchase_orders (vendor token + KPI dates)
--   3. mkt_purchase_order_lines        — immutable PO line snapshot
--   4. mkt_po_shipments                — shipment header (parent of items/events)
--   5. mkt_po_shipment_items           — PO line portion carried per shipment
--   6. mkt_po_shipment_events          — append-only shipment timeline
--   7. mkt_po_goods_receipts           — goods receipt header (per shipment)
--   8. mkt_po_goods_receipt_items      — goods receipt detail (per shipment item)
--
-- No changes to activity_logs or mkt_notification_queue structure — both are
-- reused as-is (generic text event_type / action columns already support new
-- Marketplace event strings without any DDL).

-- ── 1. mkt_po_status — additive enum values ─────────────────────────────────
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- statement that uses the new value. Each is issued as its own statement
-- (statement-breakpoint separated) so the migration runner (which executes
-- statements individually, see scripts/apply-migrations.mjs) applies them
-- safely one at a time.
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'issued';
--> statement-breakpoint
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'vendor_accepted';
--> statement-breakpoint
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'revision_requested';
--> statement-breakpoint
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'vendor_rejected';
--> statement-breakpoint
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'production';
--> statement-breakpoint
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'ready_to_ship';
--> statement-breakpoint
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'in_transit';
--> statement-breakpoint
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'partially_delivered';
--> statement-breakpoint
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'closed';
--> statement-breakpoint
ALTER TYPE "mkt_po_status" ADD VALUE IF NOT EXISTS 'rejected_goods';
--> statement-breakpoint

-- ── 2. mkt_purchase_orders — new nullable columns (no data touched) ────────
ALTER TABLE "mkt_purchase_orders" ADD COLUMN IF NOT EXISTS "vendor_token" TEXT;
--> statement-breakpoint
ALTER TABLE "mkt_purchase_orders" ADD COLUMN IF NOT EXISTS "vendor_token_version" INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "mkt_purchase_orders" ADD COLUMN IF NOT EXISTS "vendor_token_expires_at" TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "mkt_purchase_orders" ADD COLUMN IF NOT EXISTS "vendor_token_used_at" TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "mkt_purchase_orders" ADD COLUMN IF NOT EXISTS "last_token_generated_at" TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "mkt_purchase_orders" ADD COLUMN IF NOT EXISTS "revision_notes" TEXT;
--> statement-breakpoint
ALTER TABLE "mkt_purchase_orders" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "mkt_purchase_orders" ADD COLUMN IF NOT EXISTS "expected_completion_date" DATE;
--> statement-breakpoint
ALTER TABLE "mkt_purchase_orders" ADD COLUMN IF NOT EXISTS "actual_completion_date" DATE;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "mkt_purchase_orders_vendor_token_unique"
  ON "mkt_purchase_orders" ("vendor_token");
--> statement-breakpoint

-- ── 3. mkt_purchase_order_lines — immutable snapshot of winning quote lines ─
CREATE TABLE IF NOT EXISTS "mkt_purchase_order_lines" (
  "id"          SERIAL PRIMARY KEY,
  "po_id"       INTEGER NOT NULL REFERENCES "mkt_purchase_orders"("id") ON DELETE RESTRICT,
  "item_name"   TEXT NOT NULL,
  "qty"         NUMERIC(14,2) NOT NULL,
  "unit"        TEXT,
  "unit_price"  NUMERIC(14,2) NOT NULL,
  "subtotal"    NUMERIC(14,2) NOT NULL,
  "notes"       TEXT,
  "created_at"  TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mkt_po_lines_po_idx" ON "mkt_purchase_order_lines" ("po_id");
--> statement-breakpoint

-- ── 4. mkt_po_shipments — shipment header (parent of items/events) ─────────
CREATE TABLE IF NOT EXISTS "mkt_po_shipments" (
  "id"                  SERIAL PRIMARY KEY,
  "po_id"               INTEGER NOT NULL REFERENCES "mkt_purchase_orders"("id") ON DELETE RESTRICT,
  "shipment_number"     TEXT NOT NULL UNIQUE,
  "shipment_status"     TEXT NOT NULL DEFAULT 'planned',
  "shipment_type"       TEXT,
  "carrier_name"        TEXT,
  "tracking_number"     TEXT,
  "vehicle_type"        TEXT,
  "vehicle_number"      TEXT,
  "driver_name"         TEXT,
  "driver_phone"        TEXT,
  "container_number"    TEXT,
  "seal_number"         TEXT,
  "origin"              TEXT,
  "destination"         TEXT,
  "incoterm_snapshot"   TEXT,
  "planned_departure"   TIMESTAMP,
  "actual_departure"    TIMESTAMP,
  "estimated_arrival"   TIMESTAMP,
  "actual_arrival"      TIMESTAMP,
  "notes"               TEXT,
  "created_by"          TEXT,
  "created_at"          TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mkt_po_shipments_po_idx" ON "mkt_po_shipments" ("po_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_po_shipments_po_status_idx" ON "mkt_po_shipments" ("po_id", "shipment_status");
--> statement-breakpoint

-- ── 5. mkt_po_shipment_items — PO line portion carried per shipment ────────
CREATE TABLE IF NOT EXISTS "mkt_po_shipment_items" (
  "id"             SERIAL PRIMARY KEY,
  "shipment_id"    INTEGER NOT NULL REFERENCES "mkt_po_shipments"("id") ON DELETE CASCADE,
  "po_line_id"     INTEGER NOT NULL REFERENCES "mkt_purchase_order_lines"("id") ON DELETE RESTRICT,
  "line_number"    INTEGER NOT NULL,
  "qty"            NUMERIC(14,2) NOT NULL,
  "uom"            TEXT,
  "weight"         NUMERIC(12,3),
  "volume"         NUMERIC(12,3),
  "package_count"  INTEGER,
  "remarks"        TEXT,
  "created_at"     TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mkt_po_shipment_items_shipment_idx" ON "mkt_po_shipment_items" ("shipment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_po_shipment_items_po_line_idx" ON "mkt_po_shipment_items" ("po_line_id");
--> statement-breakpoint

-- ── 6. mkt_po_shipment_events — append-only timeline ────────────────────────
-- Application layer never issues UPDATE/DELETE against this table; only
-- INSERT is used by the service layer (enforced in code, Batch 2).
CREATE TABLE IF NOT EXISTS "mkt_po_shipment_events" (
  "id"                      SERIAL PRIMARY KEY,
  "shipment_id"             INTEGER NOT NULL REFERENCES "mkt_po_shipments"("id") ON DELETE CASCADE,
  "event_sequence"          INTEGER NOT NULL,
  "event_type"              TEXT NOT NULL,
  "note"                    TEXT,
  "location"                TEXT,
  "latitude"                NUMERIC(10,7),
  "longitude"               NUMERIC(10,7),
  "attachment_object_path"  TEXT,
  "actor_type"              TEXT NOT NULL DEFAULT 'vendor',
  "actor_id"                TEXT,
  "created_at"              TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mkt_po_shipment_events_shipment_idx" ON "mkt_po_shipment_events" ("shipment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_po_shipment_events_shipment_created_idx" ON "mkt_po_shipment_events" ("shipment_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_po_shipment_events_shipment_seq_unique" ON "mkt_po_shipment_events" ("shipment_id", "event_sequence");
--> statement-breakpoint

-- ── 7. mkt_po_goods_receipts — header, one per receiving action per shipment ─
CREATE TABLE IF NOT EXISTS "mkt_po_goods_receipts" (
  "id"                  SERIAL PRIMARY KEY,
  "shipment_id"         INTEGER NOT NULL REFERENCES "mkt_po_shipments"("id") ON DELETE RESTRICT,
  "receipt_number"      TEXT NOT NULL UNIQUE,
  "receipt_type"        TEXT NOT NULL,
  "inspection_status"   TEXT NOT NULL DEFAULT 'pending',
  "received_by"         TEXT,
  "received_at"         TIMESTAMP,
  "notes"               TEXT,
  "created_at"          TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mkt_po_goods_receipts_shipment_idx" ON "mkt_po_goods_receipts" ("shipment_id");
--> statement-breakpoint

-- ── 8. mkt_po_goods_receipt_items — detail per shipment item ────────────────
CREATE TABLE IF NOT EXISTS "mkt_po_goods_receipt_items" (
  "id"                 SERIAL PRIMARY KEY,
  "goods_receipt_id"   INTEGER NOT NULL REFERENCES "mkt_po_goods_receipts"("id") ON DELETE CASCADE,
  "shipment_item_id"   INTEGER NOT NULL REFERENCES "mkt_po_shipment_items"("id") ON DELETE RESTRICT,
  "received_qty"       NUMERIC(14,2) NOT NULL,
  "accepted_qty"       NUMERIC(14,2) NOT NULL DEFAULT 0,
  "rejected_qty"       NUMERIC(14,2) NOT NULL DEFAULT 0,
  "condition"          TEXT NOT NULL DEFAULT 'GOOD',
  "notes"              TEXT,
  "created_at"         TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mkt_po_goods_receipt_items_receipt_idx" ON "mkt_po_goods_receipt_items" ("goods_receipt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mkt_po_goods_receipt_items_shipment_item_idx" ON "mkt_po_goods_receipt_items" ("shipment_item_id");

COMMENT ON TABLE "mkt_po_shipments" IS 'Phase 2G — Shipment header, parent of shipment_items and shipment_events. One PO can have multiple shipments (partial/multi-container/multi-carrier).';
COMMENT ON TABLE "mkt_po_shipment_events" IS 'Phase 2G — Append-only shipment timeline (packing/loaded/departed/arrived/delivered/completed). No UPDATE/DELETE by application design.';
COMMENT ON TABLE "mkt_po_goods_receipts" IS 'Phase 2G — Goods receipt header per shipment. Detail (per shipment item, with condition) is in mkt_po_goods_receipt_items.';
