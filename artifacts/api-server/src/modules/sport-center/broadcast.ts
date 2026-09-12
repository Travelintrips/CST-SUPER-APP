import type { Request, Response } from "express";

interface SportCenterSseClient {
  res: Response;
  companyId?: number;
  heartbeat: ReturnType<typeof setInterval>;
}

const sseClients = new Set<SportCenterSseClient>();

export interface SportCenterEvent {
  module: "sport-center";
  entity: "booking" | "facility" | "payment" | "dashboard" | "member" | "customer" | "promo" | "notification";
  action: "created" | "updated" | "deleted" | "checkin";
  data: Record<string, unknown>;
  timestamp: string;
}

export function handleSportCenterSse(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;

  const heartbeat = setInterval(() => {
    try {
      res.write(`:heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  const client: SportCenterSseClient = { res, companyId, heartbeat };
  sseClients.add(client);

  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
}

export function broadcastSportCenterEvent(event: SportCenterEvent, companyId?: number): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;

  for (const client of sseClients) {
    if (companyId && client.companyId && client.companyId !== companyId) continue;
    try {
      client.res.write(payload);
    } catch {
      clearInterval(client.heartbeat);
      sseClients.delete(client);
    }
  }
}
