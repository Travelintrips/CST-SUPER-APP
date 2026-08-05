import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  (req as Request & { id: string }).id = id;
  res.setHeader("X-Request-ID", id);
  next();
}
