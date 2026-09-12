import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { VAPID_PUBLIC } from "../lib/webPush.js";

const pushRouter = Router();

// GET /api/push/vapid-key — public, no auth needed
pushRouter.get("/vapid-key", (_req: Request, res: Response) => {
  if (!VAPID_PUBLIC) return res.status(503).json({ message: "Push notifications tidak dikonfigurasi" });
  return res.json({ publicKey: VAPID_PUBLIC });
});

// POST /api/push/subscribe — simpan subscription untuk order tertentu
pushRouter.post("/subscribe", async (req: Request, res: Response) => {
  const { orderNumber, subscription } = req.body as {
    orderNumber?: string;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  };

  if (!orderNumber || !subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return res.status(400).json({ message: "Data tidak lengkap" });
  }

  await db.execute(sql`
    INSERT INTO push_subscriptions (order_number, endpoint, p256dh, auth)
    VALUES (${orderNumber}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
    ON CONFLICT (endpoint) DO UPDATE SET
      order_number = EXCLUDED.order_number,
      p256dh       = EXCLUDED.p256dh,
      auth         = EXCLUDED.auth
  `);

  return res.json({ ok: true });
});

// DELETE /api/push/unsubscribe — hapus subscription berdasarkan endpoint
pushRouter.delete("/unsubscribe", async (req: Request, res: Response) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) return res.status(400).json({ message: "endpoint diperlukan" });

  await db.execute(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
  return res.json({ ok: true });
});

export default pushRouter;
