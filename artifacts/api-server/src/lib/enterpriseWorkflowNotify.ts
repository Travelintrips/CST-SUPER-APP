/**
 * Enterprise Workflow Notification Triggers
 *
 * Provides ready-to-call send functions for every enterprise workflow category:
 *   PROCUREMENT  — PR, Vendor Comparison, PO Release, GRN, Invoice Matching
 *   FINANCE      — Customer Invoice, Vendor Invoice, Payment Reminder/Confirmation, Outstanding Alert
 *   DOCUMENT     — Doc Missing/Approved, Customs Released, BL Released, COA Uploaded
 *   APPROVAL     — Waiting, Approved, Rejected, Revision Requested
 *   OPERATIONS   — Shipment Delayed, Truck Arrived, Driver Check-in, Warehouse Ready
 *   SYSTEM       — Template Updated, Required Field Missing, Required Doc Missing
 *
 * All functions:
 *  - Fetch template from DB (with fallback to DEFAULT_ENTERPRISE_TPL)
 *  - Support {{variable}} substitution + {{#if serviceType}} conditionals
 *  - Send via Fonnte WA with dedup context
 *  - Are fire-and-forget (catch errors internally, non-fatal)
 */

import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { getAdminWa, getAdminGroupWa } from "./adminWa.js";
import { renderTemplate } from "./orderNotification.js";
import { getEnterpriseTemplate } from "./enterpriseWorkflowTemplates.js";
import { logger } from "./logger.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function nowWIB(): string {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}
function fmtRp(n: number | string | null | undefined): string {
  if (n == null || n === "") return "-";
  const num = typeof n === "string" ? parseFloat(n) : n;
  return isNaN(num) ? String(n) : Math.round(num).toLocaleString("id-ID");
}

async function send(
  to: string | null | undefined,
  recipient: string,
  workflow: string,
  vars: Record<string, string | null | undefined>,
  opts?: { context?: string; refType?: string; refId?: string; serviceType?: string },
): Promise<void> {
  if (!to) return;
  try {
    const tpl = await getEnterpriseTemplate(recipient, workflow as never);
    if (!tpl) return;
    const body = renderTemplate(tpl, { ...vars, timestamp: vars.timestamp ?? nowWIB() }, opts?.serviceType ?? "");
    await sendWhatsApp(to, body, {
      context: opts?.context ?? `${workflow}_${recipient}`,
      refType: opts?.refType,
      refId: opts?.refId,
    });
  } catch (err) {
    logger.warn({ err, recipient, workflow }, "Enterprise WA send failed (non-fatal)");
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PROCUREMENT
// ══════════════════════════════════════════════════════════════════════════════

export interface PurchaseRequestVars {
  prNumber: string;
  tanggal?: string;
  requestedBy: string;
  department?: string;
  priority?: string;
  items: string;
  totalAmount: string | number;
  notes?: string;
  approvalLink?: string;
  vendorName?: string;
  requiredDate?: string;
  vendorFormUrl?: string;
  quoteDeadline?: string;
}

/** Notify admin + (optionally) vendor about a new Purchase Request */
export async function notifyPurchaseRequest(
  data: PurchaseRequestVars & { vendorPhone?: string },
): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    prNumber: data.prNumber,
    tanggal: data.tanggal ?? nowWIB(),
    requestedBy: data.requestedBy,
    department: data.department ?? null,
    priority: data.priority ?? "Normal",
    items: data.items,
    totalAmount: fmtRp(data.totalAmount),
    notes: data.notes ?? null,
    approvalLink: data.approvalLink ?? null,
    vendorName: data.vendorName ?? null,
    requiredDate: data.requiredDate ?? null,
    vendorFormUrl: data.vendorFormUrl ?? null,
    quoteDeadline: data.quoteDeadline ?? null,
    timestamp: nowWIB(),
  };

  const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);
  await Promise.allSettled([
    send(adminWa, "admin_personal", "procurement_purchase_request", vars, { refId: data.prNumber, refType: "pr" }),
    send(adminGroupWa, "admin_group", "procurement_purchase_request", vars, { refId: data.prNumber, refType: "pr" }),
    data.vendorPhone
      ? send(data.vendorPhone, "vendor", "procurement_purchase_request", vars, { refId: data.prNumber, refType: "pr" })
      : Promise.resolve(),
  ]);
}

export interface VendorComparisonVars {
  prNumber: string;
  itemDescription: string;
  quantity: string | number;
  unit?: string;
  vendorComparison: string;
  vendorCount: string | number;
  recommendedVendor?: string;
  recommendation?: string;
  compareLink?: string;
}

export async function notifyVendorComparison(data: VendorComparisonVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    quantity: String(data.quantity),
    vendorCount: String(data.vendorCount),
    timestamp: nowWIB(),
  };
  const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);
  await Promise.allSettled([
    send(adminWa, "admin_personal", "procurement_vendor_comparison", vars, { refId: data.prNumber }),
    send(adminGroupWa, "admin_group", "procurement_vendor_comparison", vars, { refId: data.prNumber }),
  ]);
}

export interface PoReleaseVars {
  poNumber: string;
  prNumber?: string;
  vendorName: string;
  vendorPhone?: string;
  tanggal?: string;
  deliveryDate?: string;
  items: string;
  totalAmount: string | number;
  paymentTerms?: string;
  deliveryAddress?: string;
  notes?: string;
  poLink?: string;
  poConfirmLink?: string;
}

export async function notifyPoRelease(data: PoReleaseVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: data.tanggal ?? nowWIB(),
    totalAmount: fmtRp(data.totalAmount),
    timestamp: nowWIB(),
  };
  const adminGroupWa = await getAdminGroupWa();
  await Promise.allSettled([
    send(adminGroupWa, "admin_group", "procurement_po_release", vars, { refId: data.poNumber, refType: "po" }),
    data.vendorPhone
      ? send(data.vendorPhone, "vendor", "procurement_po_release", vars, { refId: data.poNumber, refType: "po" })
      : Promise.resolve(),
  ]);
}

export interface GoodsReceiptVars {
  grnNumber: string;
  poNumber?: string;
  vendorName: string;
  vendorPhone?: string;
  tanggal?: string;
  receivedBy?: string;
  receiptItems: string;
  isComplete?: string;
  shortage?: string;
  rejected?: string;
  notes?: string;
  grnLink?: string;
  receiptStatus?: string;
}

export async function notifyGoodsReceipt(data: GoodsReceiptVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: data.tanggal ?? nowWIB(),
    isComplete: data.isComplete ?? "Ya",
    shortage: data.shortage ?? "-",
    rejected: data.rejected ?? "-",
    timestamp: nowWIB(),
  };
  const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);
  await Promise.allSettled([
    send(adminWa, "admin_personal", "procurement_goods_receipt", vars, { refId: data.grnNumber, refType: "grn" }),
    send(adminGroupWa, "admin_group", "procurement_goods_receipt", vars, { refId: data.grnNumber, refType: "grn" }),
    data.vendorPhone
      ? send(data.vendorPhone, "vendor", "procurement_goods_receipt", vars, { refId: data.grnNumber, refType: "grn" })
      : Promise.resolve(),
  ]);
}

export interface InvoiceMatchingVars {
  invoiceNumber: string;
  poNumber?: string;
  grnNumber?: string;
  vendorName: string;
  invoiceAmount: string | number;
  poAmount?: string | number;
  grnAmount?: string | number;
  matchStatus: string;
  variance?: string | number;
  matchNotes?: string;
  approveLink?: string;
  reviewLink?: string;
}

export async function notifyInvoiceMatching(data: InvoiceMatchingVars): Promise<void> {
  const isOk = data.matchStatus?.toLowerCase().includes("ok") || data.matchStatus?.toLowerCase().includes("match");
  const vars: Record<string, string | null | undefined> = {
    ...data,
    invoiceAmount: fmtRp(data.invoiceAmount),
    poAmount: fmtRp(data.poAmount),
    grnAmount: fmtRp(data.grnAmount),
    variance: fmtRp(data.variance),
    timestamp: nowWIB(),
  };
  const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);
  await Promise.allSettled([
    send(adminWa, "admin_personal", "procurement_invoice_matching", vars, {
      refId: data.invoiceNumber,
      serviceType: isOk ? "match_ok" : "match_fail",
    }),
    send(adminGroupWa, "admin_group", "procurement_invoice_matching", vars, { refId: data.invoiceNumber }),
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// FINANCE
// ══════════════════════════════════════════════════════════════════════════════

export interface CustomerInvoiceVars {
  invoiceNumber: string;
  orderNumber?: string;
  customerName: string;
  customerPhone?: string;
  tanggal?: string;
  dueDate: string;
  priceBreakdown?: string;
  subtotalAmount?: string | number;
  taxAmount?: string | number;
  totalAmount: string | number;
  bankAccount?: string;
  paymentLink?: string;
  invoiceStatus?: string;
}

export async function notifyCustomerInvoice(data: CustomerInvoiceVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: data.tanggal ?? nowWIB(),
    subtotalAmount: fmtRp(data.subtotalAmount),
    taxAmount: fmtRp(data.taxAmount),
    totalAmount: fmtRp(data.totalAmount),
    invoiceStatus: data.invoiceStatus ?? "Belum Bayar",
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "finance_customer_invoice", vars, {
          refId: data.invoiceNumber, refType: "invoice",
        })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "finance_customer_invoice", vars, { refId: data.invoiceNumber }),
  ]);
}

export interface VendorInvoiceVars {
  vendorInvoiceNumber: string;
  poNumber?: string;
  vendorName: string;
  vendorPhone?: string;
  invoiceAmount: string | number;
  dueDate?: string;
  invoiceStatus?: string;
  notes?: string;
  approveLink?: string;
}

export async function notifyVendorInvoice(data: VendorInvoiceVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    invoiceAmount: fmtRp(data.invoiceAmount),
    invoiceStatus: data.invoiceStatus ?? "Diterima",
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.vendorPhone
      ? send(data.vendorPhone, "vendor", "finance_vendor_invoice", vars, { refId: data.vendorInvoiceNumber })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "finance_vendor_invoice", vars, { refId: data.vendorInvoiceNumber }),
  ]);
}

export interface PaymentReminderVars {
  invoiceNumber: string;
  customerName: string;
  customerPhone?: string;
  dueDate: string;
  totalAmount: string | number;
  daysUntilDue: string | number;
  paymentLink?: string;
  bankAccount?: string;
}

export async function notifyPaymentReminder(data: PaymentReminderVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    totalAmount: fmtRp(data.totalAmount),
    daysUntilDue: String(data.daysUntilDue),
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "finance_payment_reminder", vars, {
          context: `payment_reminder__${data.invoiceNumber}`,
          refId: data.invoiceNumber, refType: "invoice",
        })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "finance_payment_reminder", vars, { refId: data.invoiceNumber }),
  ]);
}

export interface PaymentConfirmationVars {
  invoiceNumber?: string;
  vendorInvoiceNumber?: string;
  orderNumber?: string;
  payeeName: string;
  payeePhone?: string;
  customerName?: string;
  vendorName?: string;
  paidAmount: string | number;
  remainingBalance?: string | number;
  paymentRef?: string;
  paymentMethod?: string;
  tanggal?: string;
  isVendor?: boolean;
}

export async function notifyPaymentConfirmation(data: PaymentConfirmationVars): Promise<void> {
  const remaining = data.remainingBalance != null ? Number(data.remainingBalance) : null;
  const isFullyPaid = remaining == null || remaining <= 0;
  const vars: Record<string, string | null | undefined> = {
    ...(data as unknown as Record<string, string | null | undefined>),
    invoiceNumber: data.invoiceNumber ?? data.vendorInvoiceNumber ?? null,
    orderNumber: data.orderNumber ?? null,
    paidAmount: fmtRp(data.paidAmount),
    remainingBalance: remaining != null && remaining > 0 ? `Rp ${Math.round(remaining).toLocaleString("id-ID")}` : null,
    paymentStatus: isFullyPaid ? "✅ LUNAS" : `⏳ BAYAR SEBAGIAN`,
    tanggal: data.tanggal ?? nowWIB(),
    paymentMethod: data.paymentMethod ?? "Transfer Bank",
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  const recipientRole = data.isVendor ? "vendor" : "customer";
  await Promise.allSettled([
    data.payeePhone
      ? send(data.payeePhone, recipientRole, "finance_payment_confirmation", vars, {
          refId: data.invoiceNumber ?? data.vendorInvoiceNumber,
          context: `payment_confirm__${data.invoiceNumber ?? data.vendorInvoiceNumber}`,
        })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "finance_payment_confirmation", vars, {
      refId: data.invoiceNumber ?? data.vendorInvoiceNumber,
    }),
  ]);
}

export interface OutstandingAlertVars {
  totalOutstanding: string | number;
  invoiceCount: string | number;
  overdueCount?: string | number;
  overdueAmount?: string | number;
  outstandingList?: string;
  reportLink?: string;
  customerName?: string;
  oldestDueDate?: string;
  notes?: string;
  perCustomer?: boolean;
}

export async function notifyOutstandingAlert(data: OutstandingAlertVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...(data as unknown as Record<string, string | null | undefined>),
    totalOutstanding: fmtRp(data.totalOutstanding),
    invoiceCount: String(data.invoiceCount),
    overdueCount: String(data.overdueCount ?? 0),
    overdueAmount: fmtRp(data.overdueAmount),
    timestamp: nowWIB(),
  };
  const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);
  await Promise.allSettled([
    send(adminGroupWa, "admin_group", "finance_outstanding_alert", vars, { context: "outstanding_alert_group" }),
    data.perCustomer
      ? send(adminWa, "admin_personal", "finance_outstanding_alert", vars, { context: `outstanding_${data.customerName}` })
      : Promise.resolve(),
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENT
// ══════════════════════════════════════════════════════════════════════════════

export interface DocMissingVars {
  orderNumber: string;
  customerName?: string;
  customerPhone?: string;
  vendorName?: string;
  vendorPhone?: string;
  partyName?: string;
  missingDocs: string;
  uploadDeadline?: string;
  uploadLink?: string;
  adminEmail?: string;
  notes?: string;
}

export async function notifyDocMissing(data: DocMissingVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: nowWIB(),
    partyName: data.partyName ?? data.customerName ?? data.vendorName ?? null,
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "doc_missing", vars, {
          refId: data.orderNumber, context: `doc_missing_customer_${data.orderNumber}`,
        })
      : Promise.resolve(),
    data.vendorPhone
      ? send(data.vendorPhone, "vendor", "doc_missing", vars, {
          refId: data.orderNumber, context: `doc_missing_vendor_${data.orderNumber}`,
        })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "doc_missing", vars, { refId: data.orderNumber }),
  ]);
}

export interface DocApprovedVars {
  orderNumber: string;
  documentName: string;
  customerName?: string;
  customerPhone?: string;
  vendorName?: string;
  vendorPhone?: string;
  approvedBy?: string;
  tanggal?: string;
  notes?: string;
}

export async function notifyDocApproved(data: DocApprovedVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: data.tanggal ?? nowWIB(),
    approvedBy: data.approvedBy ?? "Admin CST",
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "doc_approved", vars, { refId: data.orderNumber })
      : Promise.resolve(),
    data.vendorPhone
      ? send(data.vendorPhone, "vendor", "doc_approved", vars, { refId: data.orderNumber })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "doc_approved", vars, { refId: data.orderNumber }),
  ]);
}

export interface CustomsReleasedVars {
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  ajuNumber?: string;
  sppbNumber: string;
  bcType?: string;
  tanggal?: string;
  estimatedDelivery?: string;
  notes?: string;
}

export async function notifyCustomsReleased(data: CustomsReleasedVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: data.tanggal ?? nowWIB(),
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "doc_customs_released", vars, {
          refId: data.orderNumber, context: `customs_released_${data.orderNumber}`,
        })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "doc_customs_released", vars, { refId: data.orderNumber }),
  ]);
}

export interface BlReleasedVars {
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  blNumber: string;
  vessel?: string;
  voyage?: string;
  containerNumber?: string;
  etd?: string;
  etaDestination?: string;
  notes?: string;
  blDocumentLink?: string;
}

export async function notifyBlReleased(data: BlReleasedVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: nowWIB(),
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "doc_bl_released", vars, {
          refId: data.blNumber, context: `bl_released_${data.orderNumber}`,
        })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "doc_bl_released", vars, { refId: data.blNumber }),
  ]);
}

export interface CoaUploadedVars {
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  coaRef: string;
  productName?: string;
  batchNumber?: string;
  coaDownloadLink?: string;
}

export async function notifyCoaUploaded(data: CoaUploadedVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: nowWIB(),
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "doc_coa_uploaded", vars, { refId: data.coaRef })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "doc_coa_uploaded", vars, { refId: data.coaRef }),
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// APPROVAL
// ══════════════════════════════════════════════════════════════════════════════

export interface ApprovalVars {
  approvalRef: string;
  approvalType: string;
  requestedBy?: string;
  tanggal?: string;
  priority?: string;
  approvalDetail?: string;
  amount?: string | number;
  notes?: string;
  approveLink?: string;
  rejectLink?: string;
  approvedBy?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  revisionNotes?: string;
  revisionLink?: string;
  customerName?: string;
  customerPhone?: string;
  vendorName?: string;
  vendorPhone?: string;
}

export async function notifyApprovalWaiting(data: ApprovalVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: data.tanggal ?? nowWIB(),
    amount: fmtRp(data.amount),
    priority: data.priority ?? "Normal",
    approvalDetail: data.approvalDetail ?? null,
    timestamp: nowWIB(),
  };
  const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);
  await Promise.allSettled([
    send(adminWa, "admin_personal", "approval_waiting", vars, {
      refId: data.approvalRef, context: `approval_waiting_${data.approvalRef}`,
    }),
    send(adminGroupWa, "admin_group", "approval_waiting", vars, { refId: data.approvalRef }),
  ]);
}

export async function notifyApprovalApproved(data: ApprovalVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...(data as unknown as Record<string, string | null | undefined>),
    tanggal: data.tanggal ?? nowWIB(),
    amount: fmtRp(data.amount),
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    send(adminWa, "admin_personal", "approval_approved", vars, { refId: data.approvalRef }),
    data.customerPhone
      ? send(data.customerPhone, "customer", "approval_approved", vars, { refId: data.approvalRef })
      : Promise.resolve(),
    data.vendorPhone
      ? send(data.vendorPhone, "vendor", "approval_approved", vars, { refId: data.approvalRef })
      : Promise.resolve(),
  ]);
}

export async function notifyApprovalRejected(data: ApprovalVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...(data as unknown as Record<string, string | null | undefined>),
    tanggal: data.tanggal ?? nowWIB(),
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    send(adminWa, "admin_personal", "approval_rejected", vars, { refId: data.approvalRef }),
    data.customerPhone
      ? send(data.customerPhone, "customer", "approval_rejected", vars, { refId: data.approvalRef })
      : Promise.resolve(),
    data.vendorPhone
      ? send(data.vendorPhone, "vendor", "approval_rejected", vars, { refId: data.approvalRef })
      : Promise.resolve(),
  ]);
}

export async function notifyApprovalRevisionRequested(data: ApprovalVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...(data as unknown as Record<string, string | null | undefined>),
    tanggal: data.tanggal ?? nowWIB(),
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    send(adminWa, "admin_personal", "approval_revision_requested", vars, { refId: data.approvalRef }),
    data.customerPhone
      ? send(data.customerPhone, "customer", "approval_revision_requested", vars, { refId: data.approvalRef })
      : Promise.resolve(),
    data.vendorPhone
      ? send(data.vendorPhone, "vendor", "approval_revision_requested", vars, { refId: data.approvalRef })
      : Promise.resolve(),
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// OPERATIONS
// ══════════════════════════════════════════════════════════════════════════════

export interface ShipmentDelayedVars {
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  route?: string;
  originalEta?: string;
  newEta: string;
  delayReason?: string;
  delayHours?: string | number;
  vendorName?: string;
  actionTaken?: string;
  orderLink?: string;
  contactNumber?: string;
  notifiedCustomer?: string;
}

export async function notifyShipmentDelayed(data: ShipmentDelayedVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    delayHours: String(data.delayHours ?? "-"),
    notifiedCustomer: data.customerPhone ? "Ya" : "Tidak",
    contactNumber: data.contactNumber ?? "(021) 6241234",
    timestamp: nowWIB(),
  };
  const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "ops_shipment_delayed", vars, {
          refId: data.orderNumber, context: `delay_${data.orderNumber}`,
        })
      : Promise.resolve(),
    send(adminGroupWa, "admin_group", "ops_shipment_delayed", vars, { refId: data.orderNumber }),
    send(adminWa, "admin_personal", "ops_shipment_delayed", vars, { refId: data.orderNumber }),
  ]);
}

export interface TruckArrivedVars {
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  arrivalTime?: string;
  location?: string;
  driverName?: string;
  driverPhone?: string;
  plateNumber?: string;
  vehicleType?: string;
}

export async function notifyTruckArrived(data: TruckArrivedVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    arrivalTime: data.arrivalTime ?? nowWIB(),
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "ops_truck_arrived", vars, {
          refId: data.orderNumber, context: `truck_arrived_${data.orderNumber}`,
        })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "ops_truck_arrived", vars, { refId: data.orderNumber }),
  ]);
}

export interface DriverCheckinVars {
  orderNumber: string;
  driverName: string;
  driverPhone?: string;
  plateNumber?: string;
  checkinTime?: string;
  location?: string;
  coordinates?: string;
  checkinStatus?: string;
  driverNotes?: string;
  orderLink?: string;
}

export async function notifyDriverCheckin(data: DriverCheckinVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: nowWIB(),
    checkinTime: data.checkinTime ?? nowWIB(),
    checkinStatus: data.checkinStatus ?? "Check-in",
    timestamp: nowWIB(),
  };
  const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);
  await Promise.allSettled([
    send(adminWa, "admin_personal", "ops_driver_checkin", vars, {
      refId: data.orderNumber, context: `driver_checkin_${data.orderNumber}`,
    }),
    send(adminGroupWa, "admin_group", "ops_driver_checkin", vars, { refId: data.orderNumber }),
  ]);
}

export interface WarehouseReadyVars {
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  warehouseCode?: string;
  warehouseAddress?: string;
  readyTime?: string;
  warehouseNotes?: string;
  warehouseContact?: string;
}

export async function notifyWarehouseReady(data: WarehouseReadyVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: nowWIB(),
    readyTime: data.readyTime ?? nowWIB(),
    warehouseCode: data.warehouseCode ?? "Gudang Pusat",
    warehouseContact: data.warehouseContact ?? "(021) 6241234",
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    data.customerPhone
      ? send(data.customerPhone, "customer", "ops_warehouse_ready", vars, {
          refId: data.orderNumber, context: `warehouse_ready_${data.orderNumber}`,
        })
      : Promise.resolve(),
    send(adminWa, "admin_personal", "ops_warehouse_ready", vars, { refId: data.orderNumber }),
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

export interface TemplateUpdatedVars {
  templateName: string;
  recipientRole: string;
  workflowKey: string;
  updatedBy?: string;
  templatePreview?: string;
  templateLink?: string;
}

export async function notifyTemplateUpdated(data: TemplateUpdatedVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    tanggal: nowWIB(),
    updatedBy: data.updatedBy ?? "Admin",
    templatePreview: data.templatePreview
      ? data.templatePreview.slice(0, 200) + (data.templatePreview.length > 200 ? "…" : "")
      : null,
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await send(adminWa, "admin_personal", "sys_template_updated", vars, {
    context: `tpl_updated_${data.workflowKey}`,
  });
}

export interface RequiredFieldMissingVars {
  entityType: string;
  entityRef: string;
  missingFields: string;
  requiredAction?: string;
  editLink?: string;
}

export async function notifyRequiredFieldMissing(data: RequiredFieldMissingVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    requiredAction: data.requiredAction ?? "Lengkapi data di sistem",
    timestamp: nowWIB(),
  };
  const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);
  await Promise.allSettled([
    send(adminWa, "admin_personal", "sys_required_field_missing", vars, { refId: data.entityRef }),
    send(adminGroupWa, "admin_group", "sys_required_field_missing", vars, { refId: data.entityRef }),
  ]);
}

export interface RequiredDocMissingVars {
  entityType: string;
  entityRef: string;
  customerName?: string;
  customerPhone?: string;
  missingDocs: string;
  uploadDeadline?: string;
  uploadLink?: string;
  actionLink?: string;
}

export async function notifyRequiredDocMissing(data: RequiredDocMissingVars): Promise<void> {
  const vars: Record<string, string | null | undefined> = {
    ...data,
    timestamp: nowWIB(),
  };
  const adminWa = await getAdminWa();
  await Promise.allSettled([
    send(adminWa, "admin_personal", "sys_required_doc_missing", vars, { refId: data.entityRef }),
    data.customerPhone
      ? send(data.customerPhone, "customer", "sys_required_doc_missing", vars, {
          refId: data.entityRef, context: `req_doc_missing_${data.entityRef}`,
        })
      : Promise.resolve(),
  ]);
}
