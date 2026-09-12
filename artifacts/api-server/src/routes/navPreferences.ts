import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";

const router = Router();

(async () => {
  try {
    await db.execute(sql`
      ALTER TABLE user_nav_preferences
        ADD COLUMN IF NOT EXISTS child_order JSONB DEFAULT '{}'::jsonb
    `);
  } catch (_) {}
})();

router.use(async (req: Request, res: Response, next) => {
  const ok = await requireClerkUser(req, res);
  if (ok) next();
});

router.get("/", async (req: Request, res: Response) => {
  const userId = (req.user as { id: string }).id;
  const result = await db.execute(sql`
    SELECT hidden_items, item_order, child_order
    FROM user_nav_preferences
    WHERE user_id = ${userId}
  `);
  const row = result.rows[0] as {
    hidden_items?: string[];
    item_order?: string[];
    child_order?: Record<string, string[]>;
  } | undefined;
  res.json({
    hiddenItems: row?.hidden_items ?? [],
    itemOrder: row?.item_order ?? [],
    childOrder: row?.child_order ?? {},
  });
});

router.put("/", async (req: Request, res: Response) => {
  const userId = (req.user as { id: string }).id;
  const body = req.body as { hiddenItems?: unknown; itemOrder?: unknown; childOrder?: unknown };

  if (body.hiddenItems !== undefined && !Array.isArray(body.hiddenItems)) {
    res.status(400).json({ error: "hiddenItems must be an array" });
    return;
  }
  if (body.itemOrder !== undefined && !Array.isArray(body.itemOrder)) {
    res.status(400).json({ error: "itemOrder must be an array" });
    return;
  }
  if (
    body.childOrder !== undefined &&
    (typeof body.childOrder !== "object" || Array.isArray(body.childOrder) || body.childOrder === null)
  ) {
    res.status(400).json({ error: "childOrder must be an object" });
    return;
  }

  const hiddenItems = (body.hiddenItems ?? []) as string[];
  const itemOrder = (body.itemOrder ?? []) as string[];
  const childOrder = (body.childOrder ?? {}) as Record<string, string[]>;
  const hiddenItemsJson = JSON.stringify(hiddenItems);
  const itemOrderJson = JSON.stringify(itemOrder);
  const childOrderJson = JSON.stringify(childOrder);

  await db.execute(sql`
    INSERT INTO user_nav_preferences (user_id, hidden_items, item_order, child_order, updated_at)
    VALUES (
      ${userId},
      ${hiddenItemsJson}::jsonb,
      ${itemOrderJson}::jsonb,
      ${childOrderJson}::jsonb,
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE
      SET hidden_items = ${hiddenItemsJson}::jsonb,
          item_order   = ${itemOrderJson}::jsonb,
          child_order  = ${childOrderJson}::jsonb,
          updated_at   = NOW()
  `);

  try {
    const newDataJson = JSON.stringify({
      parentCount: itemOrder.length,
      childGroupCount: Object.keys(childOrder).length,
      hiddenCount: hiddenItems.length,
      itemOrder,
      hiddenItems,
    });
    await db.execute(sql`
      INSERT INTO erp_audit_logs (user_id, module, action, reference_id, new_data, created_at)
      VALUES (${userId}, 'settings', 'sidebar_layout_update', ${userId}, ${newDataJson}::jsonb, NOW())
    `);
  } catch (_) {}

  res.json({ ok: true });
});

export default router;
