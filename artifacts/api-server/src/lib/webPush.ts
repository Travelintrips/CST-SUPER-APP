import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// LAZY import: web-push di-load hanya saat pertama kali digunakan.
let _webpushCache: any = null;

async function getWebPush(): Promise<any> {
  if (_webpushCache) return _webpushCache;
  try {
    const mod = await import("web-push");
    _webpushCache = mod.default ?? mod;
    // Init VAPID saat pertama kali load
    const pub  = process.env.VAPID_PUBLIC_KEY  ?? "";
    const priv = process.env.VAPID_PRIVATE_KEY ?? "";
    const mail = process.env.VAPID_EMAIL       ?? "mailto:admin@example.com";
    if (pub && priv) {
      _webpushCache.setVapidDetails(mail, pub, priv);
    }
    return _webpushCache;
  } catch {
    throw new Error(
      "Package 'web-push' tidak tersedia. Jalankan: pnpm add web-push --filter @workspace/api-server",
    );
  }
}

// ── VAPID Public Key (readable without loading web-push) ──────────────────────
export const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";

// ── DB Migration ──────────────────────────────────────────────────────────────
export async function migratePushSubscriptions() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          SERIAL PRIMARY KEY,
      order_number TEXT NOT NULL,
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_push_subs_order_number
    ON push_subscriptions (order_number)
  `);
}

// ── Send push to all subscribers of an order ─────────────────────────────────
export async function sendPushToOrder(
  orderNumber: string,
  payload: { title: string; body: string; url?: string }
) {
  const pub  = process.env.VAPID_PUBLIC_KEY  ?? "";
  const priv = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!pub || !priv) return;

  const webpush = await getWebPush();

  const rows = await db.execute(sql`
    SELECT endpoint, p256dh, auth FROM push_subscriptions
    WHERE order_number = ${orderNumber}
  `);

  const dead: string[] = [];

  await Promise.allSettled(
    rows.rows.map(async (row) => {
      const sub = {
        endpoint: row.endpoint as string,
        keys: { p256dh: row.p256dh as string, auth: row.auth as string },
      };
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          dead.push(row.endpoint as string);
        }
      }
    })
  );

  if (dead.length > 0) {
    for (const ep of dead) {
      await db.execute(sql`DELETE FROM push_subscriptions WHERE endpoint = ${ep}`).catch(() => {});
    }
  }
}
