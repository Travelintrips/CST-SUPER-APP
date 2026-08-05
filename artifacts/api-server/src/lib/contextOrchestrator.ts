/**
 * Context Orchestrator — Phase 1 Cognitive Enterprise Foundation
 *
 * Mengagregasi state dari semua domain (order, vendor, finance, ops, AI)
 * menjadi satu OperationalContext object per order/shipment.
 *
 * Dipakai sebagai "multiplier" — setiap AI feature yang memakai context ini
 * mendapat situational awareness penuh tanpa query ulang.
 *
 * Usage:
 *   const ctx = await buildOrderContext(orderId)
 *   const ctx = await buildShipmentContext(shipmentId)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VendorState {
  vendorId: number | null;
  vendorName: string | null;
  serviceType: string | null;
  isActive: boolean;
  etaDaysMin: number | null;
  etaDaysMax: number | null;
  /** Performance scores (0–100 scale) */
  performance: {
    totalOrders: number;
    ontimePercentage: number;
    etaAccuracyScore: number;
    orderSuccessRate: number;
    recommendationScore: number;
    cancelRate: number;
    podCompletenessScore: number;
  } | null;
  /** VMF submissions pendng for this order */
  pendingVmfSubmissions: number;
  approvedVmfPrice: number | null;
}

export interface FinancialState {
  salesDocId: number | null;
  salesDocNumber: string | null;
  salesDocStatus: string | null;
  grandTotal: number | null;
  invoiceStatus: string | null;
  paymentStatus: string | null;
  amountPaid: number | null;
  /** Gross margin % = (grandTotal - actualCost) / grandTotal * 100 */
  marginPct: number | null;
  actualCost: number | null;
  currency: string;
}

export interface OperationalState {
  status: string;
  origin: string | null;
  destination: string | null;
  transportMode: string | null;
  eta: string | null;
  etd: string | null;
  /** For freight shipments */
  currentStage: string | null;
  stageHistory: Array<{
    stageFrom: string | null;
    stageTo: string;
    actorName: string | null;
    actorType: string;
    notes: string | null;
    createdAt: string;
  }>;
  /** Days until ETA (negative = overdue) */
  etaDaysRemaining: number | null;
  delayRisk: "none" | "low" | "medium" | "high" | "critical";
}

export interface AlertState {
  id: number;
  alertType: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  status: string;
  createdAt: string;
}

export interface AiActivityState {
  recentExecutions: Array<{
    id: number;
    agentType: string;
    action: string;
    status: string;
    confidence: number | null;
    outputSummary: string | null;
    createdAt: string;
  }>;
  pendingApprovals: Array<{
    id: number;
    action: string;
    actionDescription: string;
    priority: string;
    expiresAt: string;
    requestedAt: string;
  }>;
  totalExecutions: number;
  lastActivityAt: string | null;
}

export interface OperationalContext {
  /** Entity type and ID */
  entityType: "logistic_order" | "freight_shipment";
  entityId: number;
  entityRef: string;
  companyId: number | null;

  /** All domain states */
  vendor: VendorState;
  financial: FinancialState;
  operational: OperationalState;
  alerts: AlertState[];
  aiActivity: AiActivityState;

  /** Overall health signal derived from alerts + risk */
  healthSignal: "healthy" | "warning" | "critical" | "unknown";

  /** Context build timestamp (use for cache invalidation) */
  builtAt: string;
  /** Cache TTL in seconds used */
  cacheTtlSeconds: number;
}

// ── In-memory TTL cache ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000; // 30 seconds

interface CacheEntry {
  context: OperationalContext;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(key: string): OperationalContext | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.context;
}

function setCache(key: string, context: OperationalContext): void {
  // Evict oldest if cache grows large
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { context, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateContextCache(entityType: "logistic_order" | "freight_shipment", entityId: number): void {
  cache.delete(`${entityType}:${entityId}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function calcDelayRisk(etaStr: string | null, status: string): OperationalContext["operational"]["delayRisk"] {
  if (!etaStr) return "none";
  const doneStatuses = ["completed", "delivered", "done", "cancelled"];
  if (doneStatuses.includes(status?.toLowerCase())) return "none";
  const eta = new Date(etaStr);
  const now = new Date();
  const diffDays = (eta.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "critical";
  if (diffDays < 1) return "high";
  if (diffDays < 2) return "medium";
  if (diffDays < 4) return "low";
  return "none";
}

function deriveHealthSignal(
  alerts: AlertState[],
  risk: OperationalContext["operational"]["delayRisk"]
): OperationalContext["healthSignal"] {
  const hasCriticalAlert = alerts.some(a => a.severity === "critical" && a.status === "open");
  if (hasCriticalAlert || risk === "critical") return "critical";
  const hasWarningAlert = alerts.some(a => a.severity === "warning" && a.status === "open");
  if (hasWarningAlert || risk === "high" || risk === "medium") return "warning";
  if (alerts.length === 0 && risk === "none") return "healthy";
  return "warning";
}

function calcMarginPct(grandTotal: number | null, actualCost: number | null): number | null {
  if (!grandTotal || !actualCost || grandTotal === 0) return null;
  return Math.round(((grandTotal - actualCost) / grandTotal) * 10000) / 100;
}

// ── Build Logistic Order Context ───────────────────────────────────────────────

export async function buildOrderContext(orderId: number): Promise<OperationalContext | null> {
  const cacheKey = `logistic_order:${orderId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    // All queries fire in parallel
    const [orderResult, stageLogsResult, vmfResult, alertsResult, aiExecResult, aiApprovalResult] =
      await Promise.all([
        // 1. Order + vendor + sales doc + vendor performance
        db.execute(sql`
          SELECT
            lo.id, lo.order_number, lo.company_id, lo.customer_name,
            lo.origin, lo.destination, lo.transport_mode,
            lo.status, lo.eta, lo.etd,
            lo.grand_total, lo.subtotal, lo.final_price, lo.final_selling_price,
            lo.approved_vendor_id,
            lo.customer_confirm_status,
            s.name             AS vendor_name,
            s.service_type     AS vendor_service_type,
            s.is_active        AS vendor_is_active,
            s.eta_days_min,
            s.eta_days_max,
            vp.total_orders,
            vp.ontime_percentage,
            vp.eta_accuracy_score,
            vp.order_success_rate,
            vp.recommendation_score,
            vp.cancel_rate,
            vp.pod_completeness_score,
            sd.id              AS sales_doc_id,
            sd.doc_number      AS sales_doc_number,
            sd.status          AS sales_doc_status,
            sd.grand_total     AS sales_grand_total,
            sd.amount_paid     AS sales_amount_paid,
            sd.invoice_status,
            sd.payment_status
          FROM logistic_orders lo
          LEFT JOIN suppliers s         ON s.id = lo.approved_vendor_id
          LEFT JOIN vendor_performance vp ON vp.vendor_id = lo.approved_vendor_id
          LEFT JOIN sales_documents sd  ON sd.logistic_order_id = lo.id
          WHERE lo.id = ${orderId}
          LIMIT 1
        `),

        // 2. Stage history (order_stage_logs)
        db.execute(sql`
          SELECT stage_from, stage_to, actor_name, actor_type, notes, created_at
          FROM order_stage_logs
          WHERE order_id = ${orderId}
          ORDER BY created_at ASC
          LIMIT 20
        `),

        // 3. VMF submissions (approved price + pending count)
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE vms.response_status = 'submitted') AS pending_count,
            vms.vendor_price AS approved_price
          FROM vendor_mini_form_links vml
          LEFT JOIN vendor_mini_form_submissions vms ON vms.link_id = vml.id
          WHERE vml.order_id = ${orderId}
            AND vml.item_status = 'approved'
          GROUP BY vms.vendor_price
          LIMIT 1
        `),

        // 4. Active alerts for this order
        db.execute(sql`
          SELECT id, alert_type, severity, title, message, status, created_at
          FROM intelligence_alerts
          WHERE entity_type = 'logistic_order'
            AND entity_id = ${orderId}
            AND status != 'resolved'
          ORDER BY created_at DESC
          LIMIT 10
        `),

        // 5. Recent AI executions
        db.execute(sql`
          SELECT id, agent_type, action, status, confidence, output_summary, created_at
          FROM ai_agent_executions
          WHERE order_id = ${orderId}
          ORDER BY created_at DESC
          LIMIT 10
        `),

        // 6. Pending AI approvals
        db.execute(sql`
          SELECT id, action, action_description, priority, expires_at, requested_at
          FROM ai_approval_queue
          WHERE order_id = ${orderId}
            AND status = 'pending'
          ORDER BY requested_at DESC
        `),
      ]);

    const row = orderResult.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    const grandTotal = row.final_selling_price
      ? parseFloat(String(row.final_selling_price))
      : row.final_price
        ? parseFloat(String(row.final_price))
        : row.grand_total
          ? parseFloat(String(row.grand_total))
          : null;

    const salesGrandTotal = row.sales_grand_total ? parseFloat(String(row.sales_grand_total)) : null;
    const actualCost = null; // logistic orders track cost via VMF/quotes

    const stageLogs = stageLogsResult.rows as Array<Record<string, unknown>>;
    const currentStage = stageLogs.length > 0
      ? String(stageLogs[stageLogs.length - 1].stage_to)
      : null;

    const etaStr = row.eta ? String(row.eta) : null;
    const delayRisk = calcDelayRisk(etaStr, String(row.status ?? ""));
    const etaDaysRemaining = etaStr
      ? Math.round((new Date(etaStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    const vmfRow = vmfResult.rows[0] as Record<string, unknown> | undefined;
    const alerts = alertsResult.rows as Array<Record<string, unknown>>;
    const aiExecs = aiExecResult.rows as Array<Record<string, unknown>>;
    const aiApprovals = aiApprovalResult.rows as Array<Record<string, unknown>>;
    const lastActivityAt = aiExecs.length > 0 ? String(aiExecs[0].created_at) : null;

    const ctx: OperationalContext = {
      entityType: "logistic_order",
      entityId: orderId,
      entityRef: String(row.order_number ?? orderId),
      companyId: row.company_id ? Number(row.company_id) : null,

      vendor: {
        vendorId: row.approved_vendor_id ? Number(row.approved_vendor_id) : null,
        vendorName: row.vendor_name ? String(row.vendor_name) : null,
        serviceType: row.vendor_service_type ? String(row.vendor_service_type) : null,
        isActive: Boolean(row.vendor_is_active ?? false),
        etaDaysMin: row.eta_days_min ? Number(row.eta_days_min) : null,
        etaDaysMax: row.eta_days_max ? Number(row.eta_days_max) : null,
        performance: row.total_orders != null ? {
          totalOrders: Number(row.total_orders ?? 0),
          ontimePercentage: parseFloat(String(row.ontime_percentage ?? 0)),
          etaAccuracyScore: parseFloat(String(row.eta_accuracy_score ?? 0)),
          orderSuccessRate: parseFloat(String(row.order_success_rate ?? 0)),
          recommendationScore: parseFloat(String(row.recommendation_score ?? 0)),
          cancelRate: parseFloat(String(row.cancel_rate ?? 0)),
          podCompletenessScore: parseFloat(String(row.pod_completeness_score ?? 0)),
        } : null,
        pendingVmfSubmissions: vmfRow ? Number(vmfRow.pending_count ?? 0) : 0,
        approvedVmfPrice: vmfRow?.approved_price ? parseFloat(String(vmfRow.approved_price)) : null,
      },

      financial: {
        salesDocId: row.sales_doc_id ? Number(row.sales_doc_id) : null,
        salesDocNumber: row.sales_doc_number ? String(row.sales_doc_number) : null,
        salesDocStatus: row.sales_doc_status ? String(row.sales_doc_status) : null,
        grandTotal: salesGrandTotal ?? grandTotal,
        invoiceStatus: row.invoice_status ? String(row.invoice_status) : null,
        paymentStatus: row.payment_status ? String(row.payment_status) : null,
        amountPaid: row.sales_amount_paid ? parseFloat(String(row.sales_amount_paid)) : null,
        marginPct: calcMarginPct(salesGrandTotal ?? grandTotal, actualCost),
        actualCost,
        currency: "IDR",
      },

      operational: {
        status: String(row.status ?? ""),
        origin: row.origin ? String(row.origin) : null,
        destination: row.destination ? String(row.destination) : null,
        transportMode: row.transport_mode ? String(row.transport_mode) : null,
        eta: etaStr,
        etd: row.etd ? String(row.etd) : null,
        currentStage,
        stageHistory: stageLogs.map(s => ({
          stageFrom: s.stage_from ? String(s.stage_from) : null,
          stageTo: String(s.stage_to),
          actorName: s.actor_name ? String(s.actor_name) : null,
          actorType: String(s.actor_type ?? "system"),
          notes: s.notes ? String(s.notes) : null,
          createdAt: String(s.created_at),
        })),
        etaDaysRemaining,
        delayRisk,
      },

      alerts: alerts.map(a => ({
        id: Number(a.id),
        alertType: String(a.alert_type),
        severity: (a.severity as "critical" | "warning" | "info") ?? "info",
        title: String(a.title),
        message: String(a.message),
        status: String(a.status),
        createdAt: String(a.created_at),
      })),

      aiActivity: {
        recentExecutions: aiExecs.map(e => ({
          id: Number(e.id),
          agentType: String(e.agent_type),
          action: String(e.action),
          status: String(e.status),
          confidence: e.confidence ? parseFloat(String(e.confidence)) : null,
          outputSummary: e.output_summary ? String(e.output_summary) : null,
          createdAt: String(e.created_at),
        })),
        pendingApprovals: aiApprovals.map(a => ({
          id: Number(a.id),
          action: String(a.action),
          actionDescription: String(a.action_description),
          priority: String(a.priority),
          expiresAt: String(a.expires_at),
          requestedAt: String(a.requested_at),
        })),
        totalExecutions: aiExecs.length,
        lastActivityAt,
      },

      healthSignal: "unknown",
      builtAt: new Date().toISOString(),
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
    };

    ctx.healthSignal = deriveHealthSignal(ctx.alerts, ctx.operational.delayRisk);
    setCache(cacheKey, ctx);
    return ctx;

  } catch (err) {
    logger.error({ err, orderId }, "[contextOrchestrator] buildOrderContext failed");
    return null;
  }
}

// ── Build Freight Shipment Context ─────────────────────────────────────────────

export async function buildShipmentContext(shipmentId: number): Promise<OperationalContext | null> {
  const cacheKey = `freight_shipment:${shipmentId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const [shipmentResult, stagesResult, quotesResult, alertsResult, aiExecResult, aiApprovalResult] =
      await Promise.all([
        // 1. Shipment + linked sales/purchase docs
        db.execute(sql`
          SELECT
            fs.id, fs.shipment_number, fs.company_id,
            fs.shipper_name, fs.consignee_name, fs.commodity,
            fs.origin, fs.destination, fs.transport_mode,
            fs.status, fs.actual_cost,
            fs.departure_date, fs.arrival_date,
            fs.approved_vendor_name,
            fs.vessel, fs.voyage, fs.tracking_number,
            fs.hs_code, fs.gross_weight,
            sd.id              AS sales_doc_id,
            sd.doc_number      AS sales_doc_number,
            sd.status          AS sales_doc_status,
            sd.grand_total     AS sales_grand_total,
            sd.amount_paid     AS sales_amount_paid,
            sd.invoice_status,
            sd.payment_status
          FROM freight_shipments fs
          LEFT JOIN sales_documents sd ON sd.id = fs.sales_doc_id
          WHERE fs.id = ${shipmentId}
          LIMIT 1
        `),

        // 2. Stage history
        db.execute(sql`
          SELECT stage_type, vendor_name, status, notes, created_at
          FROM shipment_stages
          WHERE shipment_id = ${shipmentId}
          ORDER BY created_at ASC
          LIMIT 20
        `),

        // 3. Latest quote (best price + vendor info)
        db.execute(sql`
          SELECT fq.vendor_name, fq.total_cost, fq.estimated_days, fq.status,
                 s.id AS vendor_id, s.is_active,
                 vp.total_orders, vp.ontime_percentage, vp.eta_accuracy_score,
                 vp.order_success_rate, vp.recommendation_score, vp.cancel_rate,
                 vp.pod_completeness_score, s.eta_days_min, s.eta_days_max,
                 s.service_type AS vendor_service_type
          FROM freight_quotes fq
          LEFT JOIN freight_rfqs fr ON fr.id = fq.rfq_id
          LEFT JOIN suppliers s ON s.name = fq.vendor_name
          LEFT JOIN vendor_performance vp ON vp.vendor_id = s.id
          WHERE fr.shipment_id = ${shipmentId}
            AND fq.status = 'approved'
          ORDER BY fq.created_at DESC
          LIMIT 1
        `),

        // 4. Active alerts for this shipment
        db.execute(sql`
          SELECT id, alert_type, severity, title, message, status, created_at
          FROM intelligence_alerts
          WHERE entity_type IN ('freight_shipment', 'shipment')
            AND entity_id = ${shipmentId}
            AND status != 'resolved'
          ORDER BY created_at DESC
          LIMIT 10
        `),

        // 5. Recent AI executions (linked via rfq_id or via entity ref)
        db.execute(sql`
          SELECT id, agent_type, action, status, confidence, output_summary, created_at
          FROM ai_agent_executions
          WHERE rfq_id IN (SELECT id FROM freight_rfqs WHERE shipment_id = ${shipmentId})
             OR (req_id IS NOT NULL AND order_id IS NULL AND rfq_id IS NULL)
          ORDER BY created_at DESC
          LIMIT 10
        `),

        // 6. Pending AI approvals
        db.execute(sql`
          SELECT id, action, action_description, priority, expires_at, requested_at
          FROM ai_approval_queue
          WHERE rfq_id IN (SELECT id FROM freight_rfqs WHERE shipment_id = ${shipmentId})
            AND status = 'pending'
          ORDER BY requested_at DESC
        `),
      ]);

    const row = shipmentResult.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    const stages = stagesResult.rows as Array<Record<string, unknown>>;
    const quoteRow = quotesResult.rows[0] as Record<string, unknown> | undefined;
    const alerts = alertsResult.rows as Array<Record<string, unknown>>;
    const aiExecs = aiExecResult.rows as Array<Record<string, unknown>>;
    const aiApprovals = aiApprovalResult.rows as Array<Record<string, unknown>>;

    const currentStage = stages.length > 0
      ? String(stages[stages.length - 1].stage_type ?? stages[stages.length - 1].status)
      : null;

    const etaStr = row.arrival_date ? String(row.arrival_date) : null;
    const etdStr = row.departure_date ? String(row.departure_date) : null;
    const delayRisk = calcDelayRisk(etaStr, String(row.status ?? ""));
    const etaDaysRemaining = etaStr
      ? Math.round((new Date(etaStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    const salesGrandTotal = row.sales_grand_total ? parseFloat(String(row.sales_grand_total)) : null;
    const actualCost = row.actual_cost ? parseFloat(String(row.actual_cost)) : null;

    const ctx: OperationalContext = {
      entityType: "freight_shipment",
      entityId: shipmentId,
      entityRef: String(row.shipment_number ?? shipmentId),
      companyId: row.company_id ? Number(row.company_id) : null,

      vendor: {
        vendorId: quoteRow?.vendor_id ? Number(quoteRow.vendor_id) : null,
        vendorName: quoteRow?.vendor_name
          ? String(quoteRow.vendor_name)
          : row.approved_vendor_name
            ? String(row.approved_vendor_name)
            : null,
        serviceType: quoteRow?.vendor_service_type ? String(quoteRow.vendor_service_type) : null,
        isActive: Boolean(quoteRow?.is_active ?? true),
        etaDaysMin: quoteRow?.eta_days_min ? Number(quoteRow.eta_days_min) : null,
        etaDaysMax: quoteRow?.eta_days_max ? Number(quoteRow.eta_days_max) : null,
        performance: quoteRow?.total_orders != null ? {
          totalOrders: Number(quoteRow.total_orders ?? 0),
          ontimePercentage: parseFloat(String(quoteRow.ontime_percentage ?? 0)),
          etaAccuracyScore: parseFloat(String(quoteRow.eta_accuracy_score ?? 0)),
          orderSuccessRate: parseFloat(String(quoteRow.order_success_rate ?? 0)),
          recommendationScore: parseFloat(String(quoteRow.recommendation_score ?? 0)),
          cancelRate: parseFloat(String(quoteRow.cancel_rate ?? 0)),
          podCompletenessScore: parseFloat(String(quoteRow.pod_completeness_score ?? 0)),
        } : null,
        pendingVmfSubmissions: 0,
        approvedVmfPrice: quoteRow?.total_cost ? parseFloat(String(quoteRow.total_cost)) : null,
      },

      financial: {
        salesDocId: row.sales_doc_id ? Number(row.sales_doc_id) : null,
        salesDocNumber: row.sales_doc_number ? String(row.sales_doc_number) : null,
        salesDocStatus: row.sales_doc_status ? String(row.sales_doc_status) : null,
        grandTotal: salesGrandTotal,
        invoiceStatus: row.invoice_status ? String(row.invoice_status) : null,
        paymentStatus: row.payment_status ? String(row.payment_status) : null,
        amountPaid: row.sales_amount_paid ? parseFloat(String(row.sales_amount_paid)) : null,
        marginPct: calcMarginPct(salesGrandTotal, actualCost),
        actualCost,
        currency: "IDR",
      },

      operational: {
        status: String(row.status ?? ""),
        origin: row.origin ? String(row.origin) : null,
        destination: row.destination ? String(row.destination) : null,
        transportMode: row.transport_mode ? String(row.transport_mode) : null,
        eta: etaStr,
        etd: etdStr,
        currentStage,
        stageHistory: stages.map(s => ({
          stageFrom: null,
          stageTo: String(s.stage_type ?? s.status ?? ""),
          actorName: s.vendor_name ? String(s.vendor_name) : null,
          actorType: "system",
          notes: s.notes ? String(s.notes) : null,
          createdAt: String(s.created_at),
        })),
        etaDaysRemaining,
        delayRisk,
      },

      alerts: alerts.map(a => ({
        id: Number(a.id),
        alertType: String(a.alert_type),
        severity: (a.severity as "critical" | "warning" | "info") ?? "info",
        title: String(a.title),
        message: String(a.message),
        status: String(a.status),
        createdAt: String(a.created_at),
      })),

      aiActivity: {
        recentExecutions: aiExecs.map(e => ({
          id: Number(e.id),
          agentType: String(e.agent_type),
          action: String(e.action),
          status: String(e.status),
          confidence: e.confidence ? parseFloat(String(e.confidence)) : null,
          outputSummary: e.output_summary ? String(e.output_summary) : null,
          createdAt: String(e.created_at),
        })),
        pendingApprovals: aiApprovals.map(a => ({
          id: Number(a.id),
          action: String(a.action),
          actionDescription: String(a.action_description),
          priority: String(a.priority),
          expiresAt: String(a.expires_at),
          requestedAt: String(a.requested_at),
        })),
        totalExecutions: aiExecs.length,
        lastActivityAt: aiExecs.length > 0 ? String(aiExecs[0].created_at) : null,
      },

      healthSignal: "unknown",
      builtAt: new Date().toISOString(),
      cacheTtlSeconds: CACHE_TTL_MS / 1000,
    };

    ctx.healthSignal = deriveHealthSignal(ctx.alerts, ctx.operational.delayRisk);
    setCache(cacheKey, ctx);
    return ctx;

  } catch (err) {
    logger.error({ err, shipmentId }, "[contextOrchestrator] buildShipmentContext failed");
    return null;
  }
}
