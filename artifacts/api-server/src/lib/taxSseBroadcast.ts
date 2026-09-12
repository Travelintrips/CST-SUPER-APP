import type { Request, Response } from "express";
import { logger } from "./logger.js";

export interface TaxUpdatePayload {
  event: "tax_recorded" | "tax_marked" | "tax_seeded" | "tax_voided";
  period?: string;
  companyId?: number;
  transactionType?: string;
  count?: number;
  timestamp: string;
}

interface TaxSseClient {
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
  companyId?: number;
}

const taxSseClients = new Set<TaxSseClient>();

export function handleTaxSse(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const companyId = req.query.companyId ? Number(req.query.companyId) : undefined;

  res.write(`data: ${JSON.stringify({ type: "connected", companyId })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(":heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  const client: TaxSseClient = { res, heartbeat, companyId };
  taxSseClients.add(client);

  const cleanup = () => {
    clearInterval(heartbeat);
    taxSseClients.delete(client);
  };

  req.on("close", cleanup);
  req.on("error", cleanup);

  logger.debug({ companyId, totalClients: taxSseClients.size }, "[taxSse] client connected");
}

export function broadcastTaxUpdate(payload: TaxUpdatePayload): void {
  if (taxSseClients.size === 0) return;

  const ssePayload = `data: ${JSON.stringify({ type: "tax_update", ...payload })}\n\n`;

  for (const client of taxSseClients) {
    if (payload.companyId !== undefined && client.companyId !== undefined && client.companyId !== payload.companyId) {
      continue;
    }
    try {
      client.res.write(ssePayload);
    } catch {
      clearInterval(client.heartbeat);
      taxSseClients.delete(client);
    }
  }

  logger.debug({ event: payload.event, period: payload.period, clients: taxSseClients.size }, "[taxSse] broadcast sent");
}

export function getTaxSseClientCount(): number {
  return taxSseClients.size;
}
