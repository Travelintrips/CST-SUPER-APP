import { checkGeofenceWithThreshold } from "./geofence.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getAdminWa } from "./adminWa.js";
import { sendWhatsApp } from "./fonnte.js";
import { logger } from "./logger.js";
import { getPreferredDomain } from "./domain.js";

const COOLDOWN_MINUTES = 30;

async function hasCooldown(orderId: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT id FROM order_updates
    WHERE order_id = ${orderId}
      AND actor_type = 'geofence_alert'
      AND created_at > ${cutoff}
    LIMIT 1
  `);
  return ((rows as any).rows?.length ?? (rows as any).length ?? 0) > 0;
}

function nowWIB(): string {
  return new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

export async function checkOrderGeofence(
  orderId: number,
  lat: number,
  lng: number,
  actorLabel: string,
): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT order_number, origin, destination,
             geofence_enabled, geofence_radius_km
      FROM logistic_orders
      WHERE id = ${orderId}
      LIMIT 1
    `);
    const order = ((rows as any).rows?.[0] ?? (rows as any)[0]) as Record<string, unknown> | undefined;
    if (!order) return;
    if (!order.geofence_enabled) return;

    const radiusKm = Number(order.geofence_radius_km ?? 75);
    const result = await checkGeofenceWithThreshold(
      lat, lng,
      String(order.origin ?? ""),
      String(order.destination ?? ""),
      radiusKm,
    );
    if (!result || !result.deviated) return;

    if (await hasCooldown(orderId)) return;

    const notes = `Deviasi ${result.deviationKm.toFixed(1)} km (maks ${radiusKm} km). Posisi: ${lat.toFixed(5)}, ${lng.toFixed(5)}. Driver/Vendor: ${actorLabel}`;

    await db.execute(sql`
      INSERT INTO order_updates (order_id, actor_type, actor_name, status, notes, is_public, created_at)
      VALUES (
        ${orderId}, 'geofence_alert', ${"Geofence System"}, 'geofence_alert',
        ${notes}, false, NOW()
      )
    `);

    const adminWa = await getAdminWa();
    if (!adminWa) return;

    const domain = getPreferredDomain() || "cstlogistic.co.id";
    const bizportalUrl = `https://${domain}/bizportal/logistics/orders/${orderId}`;
    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;

    const msg =
      `⚠️ *GEOFENCE ALERT — Order Keluar Jalur*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `No. Order : *${order.order_number}*\n` +
      `Rute      : ${order.origin} → ${order.destination}\n` +
      `Deviasi   : *${result.deviationKm.toFixed(1)} km* (maks ${radiusKm} km)\n` +
      `Posisi    : ${lat.toFixed(5)}, ${lng.toFixed(5)}\n` +
      `Pelapor   : ${actorLabel}\n` +
      `Waktu     : ${nowWIB()} WIB\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📍 Google Maps : ${mapsUrl}\n` +
      `🖥️ Detail Order : ${bizportalUrl}`;

    await sendWhatsApp(adminWa, msg, {
      context: "geofence_alert",
      refType: "order",
      refId: String(orderId),
    });

    logger.info({ orderId, deviationKm: result.deviationKm, radiusKm, actorLabel }, "Geofence alert sent");
  } catch (err) {
    logger.warn({ err, orderId }, "checkOrderGeofence: non-critical error, skipping");
  }
}
