-- Complete the Air Freight order contract for databases that predate the
-- canonical order table. This is intentionally additive and non-destructive.

DO $$ BEGIN
  ALTER TABLE air_freight_orders
    ADD COLUMN IF NOT EXISTS dest_airport TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS pieces INTEGER,
    ADD COLUMN IF NOT EXISTS packing_type TEXT,
    ADD COLUMN IF NOT EXISTS volumetric_weight NUMERIC(12,3),
    ADD COLUMN IF NOT EXISTS volume_cbm NUMERIC(12,3),
    ADD COLUMN IF NOT EXISTS etd_requested TEXT,
    ADD COLUMN IF NOT EXISTS additional_services TEXT[],
    ADD COLUMN IF NOT EXISTS special_instructions TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS selected_rfq_submission_id INTEGER,
    ADD COLUMN IF NOT EXISTS final_rate_per_kg NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS fuel_surcharge NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS security_surcharge NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS awb_fee NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS handling_fee NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS xray_fee NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS doc_fee NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS customs_clearance_fee NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS pickup_trucking NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS delivery_trucking NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS cargo_surcharge NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS ppn_pct NUMERIC(5,2) DEFAULT 11,
    ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS airline TEXT,
    ADD COLUMN IF NOT EXISTS flight_number TEXT,
    ADD COLUMN IF NOT EXISTS etd TEXT,
    ADD COLUMN IF NOT EXISTS eta TEXT,
    ADD COLUMN IF NOT EXISTS transit_days INTEGER,
    ADD COLUMN IF NOT EXISTS awb_number TEXT,
    ADD COLUMN IF NOT EXISTS tracking_notes TEXT;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;