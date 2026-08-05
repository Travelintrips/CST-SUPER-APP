import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { Request, Response } from "express";
import { logger } from "./logger.js";

let wss: WebSocketServer | null = null;

export interface AlertBroadcastPayload {
  id: number;
  alertType: string;
  entityType: string;
  entityId?: number | null;
  entityRef?: string | null;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  createdAt: string;
}

// ── SSE clients ────────────────────────────────────────────────────────────────
interface SseClient {
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
}
const sseClients = new Set<SseClient>();

export function handleAlertSse(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(`:heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  const client: SseClient = { res, heartbeat };
  sseClients.add(client);

  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
}

// ── WebSocket (kept for backward compat; unreachable in Replit dev proxy) ─────
export function initAlertsBroadcast(server: Server): void {
  wss = new WebSocketServer({ server, path: "/api/alerts/ws" });

  wss.on("connection", (ws) => {
    ws.on("error", () => {});

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30_000);

    ws.on("close", () => clearInterval(ping));

    try {
      ws.send(JSON.stringify({ type: "connected" }));
    } catch {}
  });

  logger.info("Intelligence Alerts WebSocket ready at /api/alerts/ws");
  logger.info("Intelligence Alerts SSE ready at /api/alerts/stream");
}

// ── Broadcast query-invalidation hint to all SSE clients ──────────────────────
/**
 * Sends a lightweight `{ type: "invalidate", scope, entityId? }` event to
 * every connected SSE client.  The BizPortal frontend maps each scope to the
 * matching TanStack Query key(s) and calls invalidateQueries() automatically.
 *
 * Supported scopes: "rfq" | "logistic_orders" | "sales_documents" |
 *   "freight_shipments" | "approvals" | "purchase_documents"
 */
export function broadcastInvalidation(scope: string, entityId?: number): void {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ type: "invalidate", scope, entityId })}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(payload);
    } catch {
      clearInterval(client.heartbeat);
      sseClients.delete(client);
    }
  }
}

// ── Broadcast to all connected clients (WS + SSE) ─────────────────────────────
export function broadcastNewAlert(alert: AlertBroadcastPayload): void {
  const payload = JSON.stringify({ type: "new_alert", alert });

  if (wss && wss.clients.size > 0) {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch {}
      }
    }
  }

  if (sseClients.size > 0) {
    const ssePayload = `data: ${payload}\n\n`;
    for (const client of sseClients) {
      try {
        client.res.write(ssePayload);
      } catch {
        clearInterval(client.heartbeat);
        sseClients.delete(client);
      }
    }
  }

  logger.debug({ alertId: alert.id, severity: alert.severity }, "Alert broadcast sent");
}
