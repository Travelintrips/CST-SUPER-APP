import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export const PROGRESS_STEPS = [
  { key: "ORDER_RECEIVED",   label: "Order Diterima"           },
  { key: "ADMIN_REVIEW",     label: "Ditinjau Admin"           },
  { key: "RFQ_SENT",         label: "RFQ ke Vendor"            },
  { key: "QUOTE_RECEIVED",   label: "Penawaran Masuk"          },
  { key: "CUSTOMER_APPROVAL",label: "Menunggu Persetujuan"     },
  { key: "VENDOR_CONFIRMED", label: "Vendor Dikonfirmasi"      },
  { key: "IN_PROGRESS",      label: "Sedang Diproses"          },
  { key: "PICKUP",           label: "Penjemputan"              },
  { key: "IN_TRANSIT",       label: "Dalam Perjalanan"         },
  { key: "ARRIVED",          label: "Tiba di Tujuan"           },
  { key: "DELIVERED",        label: "Terkirim"                 },
  { key: "POD_UPLOADED",     label: "Bukti Pengiriman"         },
  { key: "INVOICE_ISSUED",   label: "Invoice Diterbitkan"      },
  { key: "PAYMENT_RECEIVED", label: "Pembayaran Diterima"      },
  { key: "COMPLETED",        label: "Selesai"                  },
] as const;

export type StepKey = typeof PROGRESS_STEPS[number]["key"] | (string & {});
export type ProgressSource = "admin" | "customer_wa" | "vendor_wa" | "system" | "driver";

export interface GpsFields {
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  deviceTimestamp?: string | null;
  mapUrl?: string | null;
  streetViewUrl?: string | null;
  photoUrl?: string | null;
}

export async function updateOrderProgress(
  orderId: number,
  stepKey: StepKey,
  source: ProgressSource,
  actorName: string,
  notes?: string,
  metadata?: Record<string, unknown>,
  gps?: GpsFields,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO order_progress_events
        (order_id, step_key, status, source, actor_name, notes, metadata,
         gps_latitude, gps_longitude, device_timestamp, map_url, street_view_url,
         photo_url)
      VALUES
        (${orderId}, ${stepKey}, 'completed', ${source}, ${actorName},
         ${notes ?? null}, ${metadata ? JSON.stringify(metadata) : null}::jsonb,
         ${gps?.gpsLatitude ?? null}, ${gps?.gpsLongitude ?? null},
         ${gps?.deviceTimestamp ?? null},
         ${gps?.mapUrl ?? null}, ${gps?.streetViewUrl ?? null},
         ${gps?.photoUrl ?? null})
      ON CONFLICT (order_id, step_key) DO UPDATE
        SET status          = 'completed',
            actor_name      = EXCLUDED.actor_name,
            notes           = COALESCE(EXCLUDED.notes, order_progress_events.notes),
            metadata        = COALESCE(EXCLUDED.metadata, order_progress_events.metadata),
            gps_latitude    = COALESCE(EXCLUDED.gps_latitude, order_progress_events.gps_latitude),
            gps_longitude   = COALESCE(EXCLUDED.gps_longitude, order_progress_events.gps_longitude),
            device_timestamp= COALESCE(EXCLUDED.device_timestamp, order_progress_events.device_timestamp),
            map_url         = COALESCE(EXCLUDED.map_url, order_progress_events.map_url),
            street_view_url = COALESCE(EXCLUDED.street_view_url, order_progress_events.street_view_url),
            photo_url       = COALESCE(EXCLUDED.photo_url, order_progress_events.photo_url),
            created_at      = NOW()
    `);
  } catch (err) {
    logger.warn({ err, orderId, stepKey }, "updateOrderProgress: non-fatal insert failed");
  }
}

export async function getOrderProgressEvents(orderId: number): Promise<Array<{
  id: number;
  step_key: string;
  status: string;
  source: string;
  actor_name: string | null;
  notes: string | null;
  created_at: string;
  gps_latitude: number | null;
  gps_longitude: number | null;
  device_timestamp: string | null;
  map_url: string | null;
  street_view_url: string | null;
  photo_url: string | null;
}>> {
  try {
    const result = await db.execute(sql`
      SELECT id, step_key, status, source, actor_name, notes, created_at,
             gps_latitude, gps_longitude, device_timestamp, map_url, street_view_url,
             photo_url
      FROM order_progress_events
      WHERE order_id = ${orderId}
      ORDER BY created_at ASC
    `);
    return (result.rows ?? []) as any[];
  } catch {
    return [];
  }
}

export async function deleteOrderProgress(orderId: number, stepKey: StepKey): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM order_progress_events
      WHERE order_id = ${orderId} AND step_key = ${stepKey}
    `);
  } catch (err) {
    logger.warn({ err, orderId, stepKey }, "deleteOrderProgress: non-fatal delete failed");
  }
}

export async function runOrderProgressMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS order_progress_events (
        id          SERIAL PRIMARY KEY,
        order_id    INTEGER NOT NULL REFERENCES logistic_orders(id) ON DELETE CASCADE,
        step_key    TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'completed',
        source      TEXT NOT NULL DEFAULT 'admin',
        actor_name  TEXT,
        actor_phone TEXT,
        notes       TEXT,
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (order_id, step_key)
      );

      CREATE INDEX IF NOT EXISTS ope_order_idx ON order_progress_events(order_id);
      CREATE INDEX IF NOT EXISTS ope_step_idx  ON order_progress_events(order_id, step_key);
    `);

    await db.execute(sql`
      ALTER TABLE order_progress_events
        ADD COLUMN IF NOT EXISTS gps_latitude    NUMERIC(10,7),
        ADD COLUMN IF NOT EXISTS gps_longitude   NUMERIC(10,7),
        ADD COLUMN IF NOT EXISTS device_timestamp TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS map_url         TEXT,
        ADD COLUMN IF NOT EXISTS street_view_url TEXT,
        ADD COLUMN IF NOT EXISTS photo_url       TEXT
    `);

    // Backfill: copy photoUrl dari JSONB metadata → kolom photo_url untuk row lama
    await db.execute(sql`
      UPDATE order_progress_events
        SET photo_url = metadata->>'photoUrl'
      WHERE photo_url IS NULL
        AND metadata IS NOT NULL
        AND metadata->>'photoUrl' IS NOT NULL
        AND metadata->>'photoUrl' <> ''
    `);

    logger.info("Order progress migration: ok");
  } catch (err) {
    logger.warn({ err }, "Order progress migration warn");
  }
}
