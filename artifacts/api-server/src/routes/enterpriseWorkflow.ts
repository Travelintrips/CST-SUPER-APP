/**
 * Enterprise Workflow Routes
 * POST /api/enterprise-workflow/:category/:action
 *
 * Provides REST endpoints to trigger any enterprise WA notification workflow.
 * All routes are admin-only.
 *
 * Categories: procurement | finance | document | approval | ops | system
 */

import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import {
  notifyPurchaseRequest,
  notifyVendorComparison,
  notifyPoRelease,
  notifyGoodsReceipt,
  notifyInvoiceMatching,
  notifyCustomerInvoice,
  notifyVendorInvoice,
  notifyPaymentReminder,
  notifyPaymentConfirmation,
  notifyOutstandingAlert,
  notifyDocMissing,
  notifyDocApproved,
  notifyCustomsReleased,
  notifyBlReleased,
  notifyCoaUploaded,
  notifyApprovalWaiting,
  notifyApprovalApproved,
  notifyApprovalRejected,
  notifyApprovalRevisionRequested,
  notifyShipmentDelayed,
  notifyTruckArrived,
  notifyDriverCheckin,
  notifyWarehouseReady,
  notifyTemplateUpdated,
  notifyRequiredFieldMissing,
  notifyRequiredDocMissing,
} from "../lib/enterpriseWorkflowNotify.js";
import { DEFAULT_ENTERPRISE_TPL } from "../lib/enterpriseWorkflowTemplates.js";
import { db, waTemplateConfigsTable } from "@workspace/db";

export const enterpriseWorkflowRouter = Router();

// ── GET /api/enterprise-workflow/catalog ──────────────────────────────────────
// Returns the full workflow catalog: all workflow keys, recipients, and whether
// each has been customised in the DB.

enterpriseWorkflowRouter.get("/catalog", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  try {
    const rows = await db.select().from(waTemplateConfigsTable);
    const dbKeys = new Set(rows.map(r => `${r.recipient}__${r.workflow}`));

    const catalog: Array<{
      category: string;
      workflow: string;
      recipient: string;
      isCustomised: boolean;
      defaultBody: string;
      dbBody?: string;
    }> = [];

    const tpl = DEFAULT_ENTERPRISE_TPL as Record<string, Record<string, string>>;
    for (const [workflow, recipientMap] of Object.entries(tpl)) {
      const category = workflow.split("_")[0] ?? "other";
      for (const [recipient, defaultBody] of Object.entries(recipientMap)) {
        const key = `${recipient}__${workflow}`;
        const dbRow = rows.find(r => r.recipient === recipient && r.workflow === workflow);
        catalog.push({
          category,
          workflow,
          recipient,
          isCustomised: dbKeys.has(key),
          defaultBody,
          dbBody: dbRow?.body,
        });
      }
    }

    return res.json({ catalog, total: catalog.length });
  } catch (err) {
    return res.status(500).json({ message: "Gagal memuat katalog workflow" });
  }
});

// ── GET /api/enterprise-workflow/audit ───────────────────────────────────────
// Returns audit summary: existing vs missing workflow coverage

enterpriseWorkflowRouter.get("/audit", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;

  const EXISTING_LOGISTIC_WORKFLOWS = [
    "order_new", "vendor_request", "vendor_submission", "vendor_revision",
    "vendor_confirmed", "vendor_rejected", "vendor_submit_confirm", "vendor_rfq_forward",
    "vendor_submission_summary", "revision_fallback", "customer_approval",
    "customer_approved", "customer_options", "customer_revised", "customer_rejected",
    "so_created", "op_request", "task_link", "task_update",
    "driver_assigned", "shipment_update", "customs_update",
    "operational_update", "delivery_completed",
    "rfq_vendor_recap", "customer_rejection", "op_confirm_submitted",
    "customer_rfq_response", "product_vendor_response", "vendor_awarded",
    "vendor_selected_admin", "product_order_new", "product_order_status_update",
    "quotation_send",
  ];

  const WORKER_AUTOMATIONS = [
    "rfq_no_response (T+warningHours)",
    "rfq_no_response (T+criticalHours — escalation)",
    "quote_reminder (T+3d)",
    "quote_expired (T+7d)",
    "order_eta_breach",
  ];

  const tpl = DEFAULT_ENTERPRISE_TPL as Record<string, Record<string, string>>;
  const enterpriseWorkflows = Object.keys(tpl);

  const byCategory: Record<string, string[]> = {};
  for (const wf of enterpriseWorkflows) {
    const cat = wf.split("_")[0] ?? "other";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(wf);
  }

  return res.json({
    summary: {
      existingLogisticWorkflows: EXISTING_LOGISTIC_WORKFLOWS.length,
      workerAutomations: WORKER_AUTOMATIONS.length,
      enterpriseWorkflowsAdded: enterpriseWorkflows.length,
      totalCoverage: EXISTING_LOGISTIC_WORKFLOWS.length + WORKER_AUTOMATIONS.length + enterpriseWorkflows.length,
    },
    existing: {
      logistic_workflows: EXISTING_LOGISTIC_WORKFLOWS,
      worker_automations: WORKER_AUTOMATIONS,
    },
    enterprise_added: {
      by_category: byCategory,
      all: enterpriseWorkflows,
    },
  });
});

// ── POST /api/enterprise-workflow/procurement/purchase-request ────────────────
enterpriseWorkflowRouter.post("/procurement/purchase-request", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyPurchaseRequest(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim notifikasi PR" });
  }
});

enterpriseWorkflowRouter.post("/procurement/vendor-comparison", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyVendorComparison(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim notifikasi vendor comparison" });
  }
});

enterpriseWorkflowRouter.post("/procurement/po-release", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyPoRelease(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim notifikasi PO release" });
  }
});

enterpriseWorkflowRouter.post("/procurement/goods-receipt", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyGoodsReceipt(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim notifikasi GRN" });
  }
});

enterpriseWorkflowRouter.post("/procurement/invoice-matching", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyInvoiceMatching(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim notifikasi invoice matching" });
  }
});

// ── Finance ───────────────────────────────────────────────────────────────────
enterpriseWorkflowRouter.post("/finance/customer-invoice", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyCustomerInvoice(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim customer invoice" });
  }
});

enterpriseWorkflowRouter.post("/finance/vendor-invoice", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyVendorInvoice(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim vendor invoice" });
  }
});

enterpriseWorkflowRouter.post("/finance/payment-reminder", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyPaymentReminder(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim payment reminder" });
  }
});

enterpriseWorkflowRouter.post("/finance/payment-confirmation", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyPaymentConfirmation(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim payment confirmation" });
  }
});

enterpriseWorkflowRouter.post("/finance/outstanding-alert", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyOutstandingAlert(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim outstanding alert" });
  }
});

// ── Document ──────────────────────────────────────────────────────────────────
enterpriseWorkflowRouter.post("/document/missing", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyDocMissing(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim doc missing" });
  }
});

enterpriseWorkflowRouter.post("/document/approved", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyDocApproved(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim doc approved" });
  }
});

enterpriseWorkflowRouter.post("/document/customs-released", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyCustomsReleased(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim customs released" });
  }
});

enterpriseWorkflowRouter.post("/document/bl-released", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyBlReleased(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim BL released" });
  }
});

enterpriseWorkflowRouter.post("/document/coa-uploaded", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyCoaUploaded(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim COA uploaded" });
  }
});

// ── Approval ──────────────────────────────────────────────────────────────────
enterpriseWorkflowRouter.post("/approval/waiting", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyApprovalWaiting(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim approval waiting" });
  }
});

enterpriseWorkflowRouter.post("/approval/approved", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyApprovalApproved(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim approval approved" });
  }
});

enterpriseWorkflowRouter.post("/approval/rejected", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyApprovalRejected(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim approval rejected" });
  }
});

enterpriseWorkflowRouter.post("/approval/revision-requested", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyApprovalRevisionRequested(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim revision requested" });
  }
});

// ── Operations ────────────────────────────────────────────────────────────────
enterpriseWorkflowRouter.post("/ops/shipment-delayed", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyShipmentDelayed(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim shipment delayed" });
  }
});

enterpriseWorkflowRouter.post("/ops/truck-arrived", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyTruckArrived(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim truck arrived" });
  }
});

enterpriseWorkflowRouter.post("/ops/driver-checkin", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyDriverCheckin(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim driver checkin" });
  }
});

enterpriseWorkflowRouter.post("/ops/warehouse-ready", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyWarehouseReady(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim warehouse ready" });
  }
});

// ── System ────────────────────────────────────────────────────────────────────
enterpriseWorkflowRouter.post("/system/template-updated", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyTemplateUpdated(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim template updated" });
  }
});

enterpriseWorkflowRouter.post("/system/required-field-missing", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyRequiredFieldMissing(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim required field missing" });
  }
});

enterpriseWorkflowRouter.post("/system/required-doc-missing", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await notifyRequiredDocMissing(req.body);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Gagal mengirim required doc missing" });
  }
});
