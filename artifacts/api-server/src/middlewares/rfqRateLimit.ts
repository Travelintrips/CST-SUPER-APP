import type { Request, Response, NextFunction } from "express";

interface Window { count: number; resetAt: number }
const store = new Map<string, Window>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;

setInterval(() => {
  const now = Date.now();
  for (const [key, w] of store) {
    if (now > w.resetAt) store.delete(key);
  }
}, 60_000);

export function rfqRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
  const now = Date.now();
  const w = store.get(ip);

  if (!w || now > w.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  w.count++;
  if (w.count > MAX_REQUESTS) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
}
