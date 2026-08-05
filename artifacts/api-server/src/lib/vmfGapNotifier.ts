/**
 * VMF Gap Notifier
 *
 * Runs daily and sends a WhatsApp digest to the admin group listing every
 * logistic order that has stalled in the VMF flow.
 *
 * "Stalled" = has at least one critical step recorded but is missing a
 * subsequent step, AND the last recorded event is older than
 * VMF_GAP_NOTIFY_DAYS (default 2 days).
 *
 * Deduplication: a `gap_notified` row is written to vmf_activity_log for each
 * notified order.  Orders that already have a `gap_notified` entry within the
 * last 23 hours are skipped so we never send the same order twice in one day.
 */

import { db, vmfActivityLogTable, portalContentTable } from "@workspace/db";
import { sql, and, eq, gte } from "drizzle-orm";
import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { getAdminGroupWa } from "./adminWa.js";
import { logger } from "./logger.js";

const INTERVAL_MS  = 24 * 60 * 60 * 1000; // run once per day
const INITIAL_DELAY_MS = 2 * 60 * 1000;   // wait 2 min after boot

const CRITICAL = [
  "link_generated",
  "approval_sent",
  "so_created",
  "op_confirm_sent",
] as const;
type CriticalAction = typeof CRITICAL[number];

const STEP_LABEL: Record<CriticalAction, string> = {
  link_generated:  "🔗 Link Generated",
  approval_sent:   "📤 Approval Sent",
  so_created:      "📋 SO Created",
  op_confirm_sent: "🔧 Op-Confirm Sent",
};

const NEXT_ACTION: Record<CriticalAction, string> = {
  link_generated:  "→ kirim link approval ke customer",
  approval_sent:   "→ tunggu customer approve / buat SO",
  so_created:      "→ kirim link op-confirm ke vendor",
  op_confirm_sent: "→ selesai",
};

// ── Config key in portal_content ─────────────────────────────────────────────
const CFG_THRESHOLD_KEY   = "vmf_gap_notify_days";
const CFG_ENABLED_KEY     = "vmf_gap_notify_enabled";

/** Read threshold from DB, fallback to env var, fallback to 2 days. */
export async function getThresholdDays(): Promise<number> {
  try {
    const [row] = await db
      .select({ value: portalContentTable.value })
      .from(portalContentTable)
      .where(eq(portalContentTable.key, CFG_THRESHOLD_KEY))
      .limit(1);
    if (row?.value) {
      const n = parseInt(row.value, 10);
      if (!isNaN(n) && n >= 1) return n;
    }
  } catch { /* ignore */ }
  const raw = process.env["VMF_GAP_NOTIFY_DAYS"];
  const n = raw ? parseInt(raw, 10) : 2;
  return isNaN(n) || n < 1 ? 2 : n;
}

/** Read enabled flag from DB (default: true). */
export async function getNotifierEnabled(): Promise<boolean> {
  try {
    const [row] = await db
      .select({ value: portalContentTable.value })
      .from(portalContentTable)
      .where(eq(portalContentTable.key, CFG_ENABLED_KEY))
      .limit(1);
    if (row?.value) return row.value !== "false";
  } catch { /* ignore */ }
  return true;
}

/** Persist threshold to DB. */
export async function setThresholdDays(days: number): Promise<void> {
  await db
    .insert(portalContentTable)
    .values({ key: CFG_THRESHOLD_KEY, value: String(days), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: portalContentTable.key,
      set: { value: String(days), updatedAt: new Date() },
    });
}

/** Persist enabled flag to DB. */
export async function setNotifierEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(portalContentTable)
    .values({ key: CFG_ENABLED_KEY, value: enabled ? "true" : "false", updatedAt: new Date() })
    .onConflictDoUpdate({
      target: portalContentTable.key,
      set: { value: enabled ? "true" : "false", updatedAt: new Date() },
    });
}

// ── Core gap query ────────────────────────────────────────────────────────────

type GapOrder = {
  orderNumber: string;
  present: CriticalAction[];
  missing: CriticalAction[];
  lastEvent: Date;
  daysSinceLastEvent: number;
};

async function findStalledOrders(thresholdDays: number): Promise<GapOrder[]> {
  const cutoff = new Date(Date.now() - thresholdDays * 86_400_000);

  // Aggregate critical step presence per orderNumber
  const aggResult = await db.execute(sql`
    SELECT
      ${vmfActivityLogTable.data}->>'orderNumber'          AS order_number,
      bool_or(${vmfActivityLogTable.action} = 'link_generated')   AS has_link_generated,
      bool_or(${vmfActivityLogTable.action} = 'approval_sent')    AS has_approval_sent,
      bool_or(${vmfActivityLogTable.action} = 'so_created')       AS has_so_created,
      bool_or(${vmfActivityLogTable.action} = 'op_confirm_sent')  AS has_op_confirm_sent,
      MAX(${vmfActivityLogTable.createdAt})                        AS last_event
    FROM ${vmfActivityLogTable}
    WHERE ${vmfActivityLogTable.data}->>'orderNumber' IS NOT NULL
      AND ${vmfActivityLogTable.action} IN ('link_generated','approval_sent','so_created','op_confirm_sent')
    GROUP BY ${vmfActivityLogTable.data}->>'orderNumber'
    HAVING MAX(${vmfActivityLogTable.createdAt}) <= ${cutoff}
  `);

  type Row = {
    order_number: string;
    has_link_generated: boolean;
    has_approval_sent: boolean;
    has_so_created: boolean;
    has_op_confirm_sent: boolean;
    last_event: Date;
  };

  const hasMap: Record<CriticalAction, keyof Row> = {
    link_generated:  "has_link_generated",
    approval_sent:   "has_approval_sent",
    so_created:      "has_so_created",
    op_confirm_sent: "has_op_confirm_sent",
  };

  const stalled: GapOrder[] = [];
  for (const r of aggResult.rows as unknown as Row[]) {
    const present = CRITICAL.filter(a => r[hasMap[a]]);
    const missing = CRITICAL.filter(a => !r[hasMap[a]]);
    const lastPresentIdx = Math.max(-1, ...present.map(a => CRITICAL.indexOf(a)));
    const hasGap = lastPresentIdx >= 0 && missing.some(a => CRITICAL.indexOf(a) <= lastPresentIdx + 2);
    if (!hasGap || present.length === 0) continue;

    const lastEvent = new Date(r.last_event);
    const daysSinceLastEvent = Math.floor((Date.now() - lastEvent.getTime()) / 86_400_000);
    stalled.push({ orderNumber: r.order_number, present, missing, lastEvent, daysSinceLastEvent });
  }
  return stalled;
}

// ── Dedup: orders already notified within the last 23h ───────────────────────

async function filterAlreadyNotified(orders: GapOrder[]): Promise<GapOrder[]> {
  if (orders.length === 0) return [];

  const window23h = new Date(Date.now() - 23 * 60 * 60 * 1000);
  const recentRows = await db
    .select({ data: vmfActivityLogTable.data, createdAt: vmfActivityLogTable.createdAt })
    .from(vmfActivityLogTable)
    .where(
      and(
        eq(vmfActivityLogTable.action, "gap_notified"),
        gte(vmfActivityLogTable.createdAt, window23h),
      )
    );

  const notifiedSet = new Set(
    recentRows.map(r => (r.data as Record<string, unknown>)?.orderNumber as string).filter(Boolean)
  );

  return orders.filter(o => !notifiedSet.has(o.orderNumber));
}

// ── Write gap_notified log rows ───────────────────────────────────────────────

async function markNotified(orders: GapOrder[]): Promise<void> {
  if (orders.length === 0) return;
  const now = new Date();
  await db.insert(vmfActivityLogTable).values(
    orders.map(o => ({
      entityType: "link" as const,
      entityId:   0,
      action:     "gap_notified" as string,
      actor:      "system",
      note:       `Auto-alert: gap setelah ${o.present.at(-1) ?? "?"}, stuck ${o.daysSinceLastEvent} hari`,
      data:       { orderNumber: o.orderNumber, present: o.present, missing: o.missing },
      createdAt:  now,
    }))
  );
}

// ── Build WA message ──────────────────────────────────────────────────────────

function buildWaMessage(orders: GapOrder[], thresholdDays: number): string {
  const header =
    `⚠️ *VMF Gap Alert* — ${new Date().toLocaleDateString("id-ID", { dateStyle: "long" })}\n` +
    `Ditemukan *${orders.length} order* yang stuck di alur VMF lebih dari ${thresholdDays} hari:\n\n`;

  const lines = orders.map((o, i) => {
    const lastPresent = o.present.at(-1)!;
    const nextMissing = o.missing[0]!;
    return (
      `${i + 1}. *${o.orderNumber}* (${o.daysSinceLastEvent} hari)\n` +
      `   ✅ Terakhir: ${STEP_LABEL[lastPresent]}\n` +
      `   ❌ Belum: ${STEP_LABEL[nextMissing]}\n` +
      `   💡 ${NEXT_ACTION[lastPresent]}`
    );
  });

  const footer = `\n\nBuka BizPortal › Purchase › Audit Trail VMF › Tab Gap Detection untuk detail.`;
  return header + lines.join("\n\n") + footer;
}

// ── Main check function ───────────────────────────────────────────────────────

export async function runVmfGapCheck(): Promise<void> {
  const [enabled, thresholdDays] = await Promise.all([getNotifierEnabled(), getThresholdDays()]);
  if (!enabled) {
    logger.info("VMF gap check: notifier disabled — skipping");
    return;
  }
  logger.info({ thresholdDays }, "VMF gap check: starting");

  try {
    const stalled   = await findStalledOrders(thresholdDays);
    const toNotify  = await filterAlreadyNotified(stalled);

    logger.info(
      { totalStalled: stalled.length, toNotify: toNotify.length },
      "VMF gap check: stalled orders found"
    );

    if (toNotify.length === 0) {
      logger.info("VMF gap check: nothing new to notify");
      return;
    }

    const adminGroupWa = await getAdminGroupWa();
    if (adminGroupWa) {
      const msg = buildWaMessage(toNotify, thresholdDays);
      await sendWhatsApp(adminGroupWa, msg, {
        context: "vmf_gap_alert",
        refType:  "vmf_gap",
        refId:    `batch-${new Date().toISOString().slice(0, 10)}`,
      });
      logger.info({ count: toNotify.length }, "VMF gap check: WA alert sent");
    } else {
      logger.warn("VMF gap check: admin group WA not configured — skipping WA");
    }

    await markNotified(toNotify);
  } catch (err) {
    logger.error({ err }, "VMF gap check: error (non-fatal)");
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

export function startVmfGapNotifier(): void {
  const run = () => runVmfGapCheck().catch(err => {
    logger.warn({ err }, "VMF gap notifier: uncaught error");
  });

  // First run after a short delay so migrations/seeds finish first
  setTimeout(() => {
    run();
    setInterval(run, INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  logger.info(
    { intervalHours: INTERVAL_MS / 3_600_000, initialDelayMin: INITIAL_DELAY_MS / 60_000 },
    "VMF gap notifier started"
  );
}
