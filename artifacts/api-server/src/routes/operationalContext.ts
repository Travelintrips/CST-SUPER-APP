import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import {
  buildOrderContext,
  buildShipmentContext,
  invalidateContextCache,
} from "../lib/contextOrchestrator.js";

export const operationalContextRouter = Router();

// GET /api/operational-context/order/:id
operationalContextRouter.get("/order/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  const ctx = await buildOrderContext(id);
  if (!ctx) return res.status(404).json({ error: "Order tidak ditemukan" });
  return res.json(ctx) as unknown;
});

// GET /api/operational-context/shipment/:id
operationalContextRouter.get("/shipment/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  const ctx = await buildShipmentContext(id);
  if (!ctx) return res.status(404).json({ error: "Shipment tidak ditemukan" });
  return res.json(ctx) as unknown;
});

// POST /api/operational-context/order/:id/invalidate
operationalContextRouter.post("/order/:id/invalidate", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  invalidateContextCache("logistic_order", id);
  return res.json({ success: true }) as unknown;
});

// POST /api/operational-context/shipment/:id/invalidate
operationalContextRouter.post("/shipment/:id/invalidate", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  invalidateContextCache("freight_shipment", id);
  return res.json({ success: true }) as unknown;
});
