/**
 * PPJK Phase 2 — Transactional Auto-create ppjk_orders from logistic_orders.
 *
 * IMPORTANT: autoCreatePpjkOrderInTx() MUST be called inside a db.transaction()
 * at the call site (logisticOrders.ts). Failure rolls back the logistic order too.
 *
 * Idempotency: a unique constraint on ppjk_orders.portal_order_id prevents
 * duplicate PPJK orders when a logistic order is retried.
 */
import { db, ppjkOrdersTable, ppjkStatusLogsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Shipment types that trigger PPJK auto-creation (case-insensitive) ──────────
const PPJK_TRIGGERS = [
  "ppjk",
  "pabean",
  "custom clearance",
  "custom_clearance",
  "pib",
  "peb",
  "kepabeanan",
];

export function isPpjkOrder(shipmentType: string): boolean {
  const lower = shipmentType.toLowerCase();
  return PPJK_TRIGGERS.some((t) => lower.includes(t));
}

function detectTradeType(shipmentType: string, notes?: string | null): "import" | "export" {
  const combined = `${shipmentType} ${notes ?? ""}`.toLowerCase();
  return combined.includes("ekspor") || combined.includes("export") ? "export" : "import";
}

function detectJenisPelayanan(shipmentType: string): string {
  const lower = shipmentType.toLowerCase();
  if (lower.includes("custom clearance") || lower.includes("handling")) return "customs_clearance";
  if (lower.includes("pib")) return "customs_import";
  if (lower.includes("peb")) return "customs_export";
  if (lower.includes("undername")) return "customs_undername";
  if (lower.includes("konsultan") || lower.includes("konsultasi")) return "consulting";
  return "customs_clearance";
}

/** Generates a PPJK order number — must be called within the same transaction. */
async function generatePpjkNumber(txOrDb: typeof db): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const [row] = await txOrDb
    .select({
      maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(order_number, '/', 4) AS INTEGER)), 0)`,
    })
    .from(ppjkOrdersTable);
  const seq = String((row?.maxSeq ?? 0) + 1).padStart(5, "0");
  return `PPJK/${year}/${month}/${seq}`;
}

export interface AutoCreatePpjkParams {
  portalOrderId: number;
  companyId?: number | null;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerCompany?: string | null;
  shipmentType: string;
  commodity?: string | null;
  grossWeight?: string | null;
  volumeCbm?: string | null;
  origin?: string | null;
  destination?: string | null;
  notes?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AutoCreatePpjkResult {
  ppjkOrderId: number;
  ppjkOrderNumber: string;
  alreadyExisted: boolean;
}

/**
 * Creates a ppjk_orders record INSIDE an existing Drizzle transaction.
 * Must be called with a `tx` from `db.transaction(async (tx) => { ... })`.
 *
 * Idempotency:
 * - If a PPJK order for this portalOrderId already exists (retry / duplicate request),
 *   returns the existing record without inserting a new one.
 * - The unique constraint on ppjk_orders(portal_order_id) is the DB-level guard.
 */
export async function autoCreatePpjkOrderInTx(
  tx: typeof db,
  params: AutoCreatePpjkParams,
): Promise<AutoCreatePpjkResult> {
  // Idempotency check: return existing if already created (safe for retries)
  const [existing] = await (tx as any)
    .select({ id: ppjkOrdersTable.id, orderNumber: ppjkOrdersTable.orderNumber })
    .from(ppjkOrdersTable)
    .where(eq((ppjkOrdersTable as any).portalOrderId, params.portalOrderId))
    .limit(1);

  if (existing) {
    logger.info(`[ppjkAutoCreate] Idempotency hit — PPJK order already exists for portalOrderId=${params.portalOrderId}: ${existing.orderNumber}`);
    return {
      ppjkOrderId: existing.id,
      ppjkOrderNumber: existing.orderNumber,
      alreadyExisted: true,
    };
  }

  const orderNumber = await generatePpjkNumber(tx);
  const tradeType = detectTradeType(params.shipmentType, params.notes);
  const jenisPelayanan = detectJenisPelayanan(params.shipmentType);

  const [created] = await (tx as any).insert(ppjkOrdersTable).values({
    orderNumber,
    portalOrderId: params.portalOrderId,
    companyId: params.companyId ?? null,
    customerName: params.customerName,
    customerEmail: params.customerEmail ?? null,
    customerPhone: params.customerPhone ?? null,
    customerCompany: params.customerCompany ?? null,
    tradeType,
    commodity: params.commodity ?? null,
    grossWeight: params.grossWeight ?? null,
    cbm: params.volumeCbm ?? null,
    origin: params.origin ?? null,
    destination: params.destination ?? null,
    jenisPelayanan,
    notes: params.notes ?? null,
    status: "draft",
    createdById: "auto",
  } as any).returning();

  // Status log — non-fatal (best-effort, same tx)
  await (tx as any).insert(ppjkStatusLogsTable as any).values({
    ppjkOrderId: created.id,
    oldStatus: null,
    newStatus: "draft",
    changedBy: "system",
    changedById: "auto",
    notes: `Auto-dibuat dari logistic order #${params.portalOrderId}`,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  logger.info(`[ppjkAutoCreate] Created PPJK order ${orderNumber} for portalOrderId=${params.portalOrderId}`);

  return { ppjkOrderId: created.id, ppjkOrderNumber: orderNumber, alreadyExisted: false };
}

/**
 * Standalone wrapper — creates a NEW transaction and auto-creates the PPJK order.
 * Use this only when NOT already inside a transaction (e.g. BizPortal manual create).
 * For logistic order creation, always use autoCreatePpjkOrderInTx() with db.transaction().
 *
 * @deprecated Prefer autoCreatePpjkOrderInTx inside db.transaction() at call site.
 */
export async function autoCreatePpjkOrder(
  params: AutoCreatePpjkParams,
): Promise<AutoCreatePpjkResult | null> {
  try {
    return await db.transaction(async (tx) => autoCreatePpjkOrderInTx(tx as unknown as typeof db, params));
  } catch (err) {
    logger.error({ err }, "[ppjkAutoCreate] Failed to auto-create PPJK order");
    return null;
  }
}
