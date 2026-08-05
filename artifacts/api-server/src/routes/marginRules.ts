import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";

export const marginRulesRouter = Router();

marginRulesRouter.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// GET /api/margin-rules
marginRulesRouter.get("/", async (_req: Request, res: Response) => {
  const result = await db.execute(sql`SELECT * FROM margin_rules ORDER BY priority DESC, created_at ASC`);
  return res.json(result.rows);
});

// POST /api/margin-rules
marginRulesRouter.post("/", async (req: Request, res: Response) => {
  const { name, serviceType, route, customerType, marginType, marginValue, minimumMargin, isActive, priority, notes } = req.body as Record<string, unknown>;
  if (!name || !marginValue == null) return res.status(400).json({ message: "name dan marginValue wajib diisi" });
  const result = await db.execute(sql`
    INSERT INTO margin_rules (name, service_type, route, customer_type, margin_type, margin_value, minimum_margin, is_active, priority, notes)
    VALUES (
      ${String(name)},
      ${serviceType ? String(serviceType) : null},
      ${route ? String(route) : null},
      ${customerType ? String(customerType) : null},
      ${marginType ? String(marginType) : "percentage"},
      ${Number(marginValue ?? 0)},
      ${minimumMargin != null ? Number(minimumMargin) : null},
      ${isActive !== false},
      ${Number(priority ?? 0)},
      ${notes ? String(notes) : null}
    ) RETURNING *
  `);
  return res.status(201).json(result.rows[0]);
});

// PUT /api/margin-rules/:id
marginRulesRouter.put("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const { name, serviceType, route, customerType, marginType, marginValue, minimumMargin, isActive, priority, notes } = req.body as Record<string, unknown>;
  const result = await db.execute(sql`
    UPDATE margin_rules SET
      name = ${name ? String(name) : null},
      service_type = ${serviceType ? String(serviceType) : null},
      route = ${route ? String(route) : null},
      customer_type = ${customerType ? String(customerType) : null},
      margin_type = ${marginType ? String(marginType) : "percentage"},
      margin_value = ${Number(marginValue ?? 0)},
      minimum_margin = ${minimumMargin != null ? Number(minimumMargin) : null},
      is_active = ${isActive !== false},
      priority = ${Number(priority ?? 0)},
      notes = ${notes ? String(notes) : null},
      updated_at = NOW()
    WHERE id = ${id} RETURNING *
  `);
  if (!result.rows[0]) return res.status(404).json({ message: "Margin rule tidak ditemukan" });
  return res.json(result.rows[0]);
});

// DELETE /api/margin-rules/:id
marginRulesRouter.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  await db.execute(sql`DELETE FROM margin_rules WHERE id = ${id}`);
  return res.json({ ok: true });
});

// POST /api/margin-rules/compute — compute margin for a given context
marginRulesRouter.post("/compute", async (req: Request, res: Response) => {
  const { serviceType, vendorPrice } = req.body as { serviceType?: string; vendorPrice?: number };
  if (!vendorPrice) return res.status(400).json({ message: "vendorPrice wajib diisi" });

  // Find best matching rule (active, by priority DESC)
  const result = await db.execute(sql`
    SELECT * FROM margin_rules
    WHERE is_active = true
      AND (service_type IS NULL OR LOWER(service_type) = LOWER(${serviceType ?? ""}))
    ORDER BY priority DESC, id ASC
    LIMIT 1
  `);
  const rule = result.rows[0] as Record<string, unknown> | undefined;

  if (!rule) {
    return res.json({ vendorPrice, suggestedSellingPrice: vendorPrice, margin: 0, rule: null });
  }

  const marginType = String(rule["margin_type"] ?? "percentage");
  const marginValue = Number(rule["margin_value"] ?? 0);
  const minimumMargin = rule["minimum_margin"] != null ? Number(rule["minimum_margin"]) : null;

  let margin = 0;
  if (marginType === "percentage") {
    margin = vendorPrice * marginValue / 100;
  } else if (marginType === "fixed") {
    margin = marginValue;
  }

  if (minimumMargin != null && margin < minimumMargin) {
    margin = minimumMargin;
  }

  const suggestedSellingPrice = vendorPrice + margin;
  return res.json({ vendorPrice, suggestedSellingPrice, margin, rule });
});
