/**
 * Token Security Stats — P2.3 Observability
 *
 * Admin-only endpoint untuk melihat metrik keamanan token:
 * jumlah token dibuat, dipakai, expired, revoked, invalid,
 * brute force attempts, dan rate limit hits.
 *
 * GET /api/admin/token-security/stats
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const tokenSecurityStatsRouter = Router();

tokenSecurityStatsRouter.get("/", async (req: Request, res: Response) => {
  try {
    // ── Token Access Log Stats (last 30 days) ─────────────────────────────
    const [logStats] = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE outcome = 'ok')                 AS total_ok,
        COUNT(*) FILTER (WHERE outcome = 'denied_expired')     AS total_expired,
        COUNT(*) FILTER (WHERE outcome = 'denied_used')        AS total_used_again,
        COUNT(*) FILTER (WHERE outcome = 'denied_revoked')     AS total_revoked_attempts,
        COUNT(*) FILTER (WHERE outcome = 'denied_not_found')   AS total_not_found,
        COUNT(*) FILTER (WHERE outcome = 'denied_context_mismatch') AS total_context_mismatch
      FROM token_access_log
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `).then((r) => (r.rows ?? [r]) as any[]);

    // ── Tokens Created per type (last 30 days) ─────────────────────────────
    const tokenCountsByTable = await db.execute(sql`
      SELECT
        'admin_action_links'       AS table_name,
        COUNT(*)                   AS total,
        COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked,
        COUNT(*) FILTER (WHERE used_at IS NOT NULL)    AS used,
        COUNT(*) FILTER (WHERE expires_at < NOW() AND used_at IS NULL AND revoked_at IS NULL) AS expired_unused
      FROM admin_action_links WHERE created_at >= NOW() - INTERVAL '30 days'
      UNION ALL
      SELECT
        'rfq_vendor_links',
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'revoked'),
        COUNT(*) FILTER (WHERE submitted_at IS NOT NULL),
        COUNT(*) FILTER (WHERE expired_at < NOW() AND submitted_at IS NULL AND status NOT IN ('revoked'))
      FROM rfq_vendor_links WHERE created_at >= NOW() - INTERVAL '30 days'
      UNION ALL
      SELECT
        'vendor_fulfillment_links',
        COUNT(*),
        COUNT(*) FILTER (WHERE revoked_at IS NOT NULL),
        COUNT(*) FILTER (WHERE status = 'submitted'),
        COUNT(*) FILTER (WHERE expires_at < NOW() AND status = 'pending' AND revoked_at IS NULL)
      FROM vendor_fulfillment_links WHERE created_at >= NOW() - INTERVAL '30 days'
    `).then((r) => r.rows ?? r as any);

    // ── Rate limit hits — from audit_logs (RATE_LIMIT_EXCEEDED events) ────
    const [rateLimitStats] = await db.execute(sql`
      SELECT COUNT(*) AS rate_limit_hits
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND action IN ('RATE_LIMIT_EXCEEDED')
        AND module IN ('token-get', 'token-post', 'public-token')
    `).then((r) => (r.rows ?? [r]) as any[]).catch(() => [{ rate_limit_hits: 0 }]);

    // ── Brute force heuristic: >3 denied_not_found from same IP in 1h ─────
    const [bruteForce] = await db.execute(sql`
      SELECT COUNT(DISTINCT ip_address) AS suspicious_ips
      FROM (
        SELECT ip_address, COUNT(*) AS attempts
        FROM token_access_log
        WHERE created_at >= NOW() - INTERVAL '1 hour'
          AND outcome = 'denied_not_found'
          AND ip_address IS NOT NULL
        GROUP BY ip_address
        HAVING COUNT(*) >= 3
      ) sub
    `).then((r) => (r.rows ?? [r]) as any[]).catch(() => [{ suspicious_ips: 0 }]);

    // ── Top token types by access in last 24h ──────────────────────────────
    const topTokenTypes = await db.execute(sql`
      SELECT token_type, COUNT(*) AS access_count, 
             COUNT(*) FILTER (WHERE outcome != 'ok') AS denied_count
      FROM token_access_log
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY token_type
      ORDER BY access_count DESC
      LIMIT 10
    `).then((r) => r.rows ?? r as any).catch(() => []);

    return res.json({
      generatedAt: new Date().toISOString(),
      window: "30 days (unless noted)",
      accessLog: {
        totalOk:             Number(logStats?.total_ok ?? 0),
        totalExpired:        Number(logStats?.total_expired ?? 0),
        totalUsedAgain:      Number(logStats?.total_used_again ?? 0),
        totalRevokedAttempts:Number(logStats?.total_revoked_attempts ?? 0),
        totalNotFound:       Number(logStats?.total_not_found ?? 0),
        totalContextMismatch:Number(logStats?.total_context_mismatch ?? 0),
      },
      tokenCounts: tokenCountsByTable.map((r: any) => ({
        table:          r.table_name,
        total:          Number(r.total ?? 0),
        revoked:        Number(r.revoked ?? 0),
        used:           Number(r.used ?? 0),
        expiredUnused:  Number(r.expired_unused ?? 0),
      })),
      security: {
        rateLimitHits24h: Number(rateLimitStats?.rate_limit_hits ?? 0),
        suspiciousIps1h:  Number(bruteForce?.suspicious_ips ?? 0),
      },
      topTokenTypes: topTokenTypes.slice(0, 10).map((r: any) => ({
        tokenType:   r.token_type,
        accessCount: Number(r.access_count ?? 0),
        deniedCount: Number(r.denied_count ?? 0),
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: "Gagal mengambil statistik token", detail: String(err) });
  }
});
