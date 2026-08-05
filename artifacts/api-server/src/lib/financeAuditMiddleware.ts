/**
 * Finance Governance — FASE 5
 * Finance Audit Middleware — inject correlation_id into every request
 * hitting /api/accounting/*, /api/ledger/*, /api/financial-periods/*
 */

import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

declare global {
  namespace Express {
    interface Request {
      financeCorrelationId?: string;
      financeAuditContext?: {
        userId: string | null;
        userRole: string | null;
        ipAddress: string | null;
        correlationId: string;
      };
    }
  }
}

export function financeAuditMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const correlationId = (req.headers["x-correlation-id"] as string) || `FIN-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  const userId = req.user?.id ?? req.user?.email ?? null;
  const userRole = (req.user as any)?.role ?? (req.user as any)?.system_role ?? null;
  const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null;

  req.financeCorrelationId = correlationId;
  req.financeAuditContext = { userId, userRole, ipAddress, correlationId };
  next();
}

export async function writeFinanceAuditTrail(opts: {
  correlationId: string;
  companyId?: number | null;
  entryId?: number | null;
  action: string;
  requestSource?: string | null;
  userId?: string | null;
  userRole?: string | null;
  ipAddress?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  approvalChain?: unknown[];
}): Promise<void> {
  try {
    const before = opts.beforeState ? `'${JSON.stringify(opts.beforeState).replace(/'/g, "''")}'::jsonb` : "NULL";
    const after = opts.afterState ? `'${JSON.stringify(opts.afterState).replace(/'/g, "''")}'::jsonb` : "NULL";
    const chain = JSON.stringify(opts.approvalChain ?? []).replace(/'/g, "''");
    await db.execute(sql.raw(`
      INSERT INTO finance_audit_trail
        (company_id, correlation_id, entry_id, action, request_source, user_id, user_role, ip_address, before_state, after_state, approval_chain)
      VALUES (
        ${opts.companyId ?? "NULL"},
        '${opts.correlationId.replace(/'/g, "''")}',
        ${opts.entryId ?? "NULL"},
        '${opts.action.replace(/'/g, "''")}',
        ${opts.requestSource ? `'${opts.requestSource.replace(/'/g, "''")}'` : "NULL"},
        ${opts.userId ? `'${opts.userId.replace(/'/g, "''")}'` : "NULL"},
        ${opts.userRole ? `'${opts.userRole.replace(/'/g, "''")}'` : "NULL"},
        ${opts.ipAddress ? `'${opts.ipAddress.replace(/'/g, "''")}'` : "NULL"},
        ${before},
        ${after},
        '${chain}'::jsonb
      )
    `));
  } catch (err) {
    logger.warn({ err, opts }, "[finance-audit] writeFinanceAuditTrail failed (non-fatal)");
  }
}

export async function getAuditTrailByCorrelation(correlationId: string): Promise<any[]> {
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM finance_audit_trail
      WHERE correlation_id = '${correlationId.replace(/'/g, "''")}'
      ORDER BY created_at ASC
    `));
    return rows;
  } catch (err) {
    logger.warn({ err }, "[finance-audit] getAuditTrailByCorrelation failed");
    return [];
  }
}
