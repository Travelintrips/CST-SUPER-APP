import { db, intelligenceAlertsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { broadcastNewAlert } from "./alertsBroadcast.js";
import { logger } from "./logger.js";

export async function createAlertAndBroadcast(data: {
  companyId?: number | null;
  alertType: string;
  entityType: string;
  entityId?: number | null;
  entityRef?: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  contextJson?: Record<string, unknown>;
  skipDedupCheck?: boolean;
}): Promise<void> {
  try {
    if (!data.skipDedupCheck) {
      const existing = await db
        .select({ id: intelligenceAlertsTable.id })
        .from(intelligenceAlertsTable)
        .where(
          and(
            eq(intelligenceAlertsTable.alertType, data.alertType),
            eq(intelligenceAlertsTable.entityType, data.entityType),
            data.entityId != null
              ? eq(intelligenceAlertsTable.entityId, data.entityId)
              : isNull(intelligenceAlertsTable.entityId),
            eq(intelligenceAlertsTable.status, "open"),
          )
        )
        .limit(1);
      if (existing.length > 0) return;
    }

    const inserted = await db
      .insert(intelligenceAlertsTable)
      .values({
        companyId: data.companyId ?? null,
        alertType: data.alertType,
        entityType: data.entityType,
        entityId: data.entityId ?? null,
        entityRef: data.entityRef,
        severity: data.severity,
        title: data.title,
        message: data.message,
        contextJson: data.contextJson ?? {},
      })
      .returning();

    if (inserted[0]) {
      broadcastNewAlert({
        id: inserted[0].id,
        alertType: inserted[0].alertType,
        entityType: inserted[0].entityType,
        entityId: inserted[0].entityId,
        entityRef: inserted[0].entityRef,
        severity: inserted[0].severity as "critical" | "warning" | "info",
        title: inserted[0].title,
        message: inserted[0].message,
        createdAt: (inserted[0].createdAt ?? new Date()).toISOString(),
      });
    }
  } catch (e) {
    logger.warn({ e }, "[alertHelpers] createAlertAndBroadcast failed");
  }
}
