import { db, storageAuditLogTable, type InsertStorageAuditLog } from "@workspace/db";
import type { Request } from "express";

type AuditAction = InsertStorageAuditLog["action"];
type AuditEntityType = InsertStorageAuditLog["entityType"];

export interface StorageAuditParams {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: number | null;
  objectPath?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  fileSizeBytes?: number | null;
  actorId?: string | null;
  actorType?: string;
  ipAddress?: string | null;
  details?: string | null;
}

/**
 * Write a storage audit log entry (non-fatal — errors are swallowed so callers
 * are never disrupted by logging failures).
 */
export async function logStorageEvent(params: StorageAuditParams): Promise<void> {
  try {
    await db.insert(storageAuditLogTable).values({
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      objectPath: params.objectPath ?? null,
      fileName: params.fileName ?? null,
      contentType: params.contentType ?? null,
      fileSizeBytes: params.fileSizeBytes ?? null,
      actorId: params.actorId ?? null,
      actorType: params.actorType ?? "staff",
      ipAddress: params.ipAddress ?? null,
      details: params.details ?? null,
    });
  } catch {
    // Never propagate — audit log must never break the primary operation.
  }
}

/**
 * Extract caller IP from request, respecting x-forwarded-for from the Replit
 * reverse-proxy (trusted because requests arrive via the internal gateway).
 */
export function getRequestIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) {
    const first = String(fwd).split(",")[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? null;
}

/**
 * Pull actor ID + type from an authenticated request.
 * Falls back to "anonymous" if the request is unauthenticated.
 */
export function getActor(req: Request): { actorId: string; actorType: string } {
  if (req.isAuthenticated() && req.user) {
    return { actorId: req.user.id, actorType: "staff" };
  }
  const bearer = req.headers["authorization"];
  if (bearer && bearer.startsWith("Bearer ")) {
    return { actorId: "bearer:" + bearer.slice(7, 20) + "...", actorType: "driver" };
  }
  return { actorId: "anonymous", actorType: "anonymous" };
}
