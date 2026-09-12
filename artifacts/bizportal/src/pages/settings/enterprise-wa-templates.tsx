import { useState, useEffect, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Save, RotateCcw, Loader2, ArrowLeft, MessageSquare, CheckCircle,
  ShoppingCart, DollarSign, FileText, CheckSquare, Truck, Settings2,
} from "lucide-react";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

type RecipientKey = "admin_personal" | "admin_group" | "customer" | "vendor";
type CategoryKey  = "procurement" | "finance" | "document" | "approval" | "ops" | "system";

interface WorkflowDef {
  key: string;
  label: string;
  icon: string;
  desc: string;
  recipients: RecipientKey[];
  category: CategoryKey;
}

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META: Record<CategoryKey, { label: string; icon: React.ReactNode; color: string }> = {
  procurement: { label: "Procurement",  icon: <ShoppingCart className="h-3.5 w-3.5" />, color: "text-blue-600" },
  finance:     { label: "Finance",      icon: <DollarSign  className="h-3.5 w-3.5" />, color: "text-emerald-600" },
  document:    { label: "Dokumen",      icon: <FileText    className="h-3.5 w-3.5" />, color: "text-amber-600" },
  approval:    { label: "Approval",     icon: <CheckSquare className="h-3.5 w-3.5" />, color: "text-purple-600" },
  ops:         { label: "Operasional",  icon: <Truck       className="h-3.5 w-3.5" />, color: "text-orange-600" },
  system:      { label: "Sistem",       icon: <Settings2   className="h-3.5 w-3.5" />, color: "text-slate-600" },
};

// ─── Workflow definitions ─────────────────────────────────────────────────────

const WORKFLOWS: WorkflowDef[] = [
  // PROCUREMENT
  { key:"procurement_purchase_request",  label:"Purchase Request",     icon:"📋", desc:"Notifikasi PR baru ke admin dan permintaan penawaran ke vendor",          category:"procurement", recipients:["admin_personal","admin_group","vendor"] },
  { key:"procurement_vendor_comparison", label:"Perbandingan Vendor",  icon:"📊", desc:"Kirim ringkasan perbandingan penawaran vendor ke admin",                   category:"procurement", recipients:["admin_personal","admin_group"] },
  { key:"procurement_po_release",        label:"PO Diterbitkan",       icon:"📄", desc:"Notifikasi PO ke grup admin dan konfirmasi ke vendor penerima PO",          category:"procurement", recipients:["admin_group","vendor"] },
  { key:"procurement_goods_receipt",     label:"Penerimaan Barang",    icon:"📦", desc:"Konfirmasi GRN ke admin dan notifikasi status penerimaan ke vendor",        category:"procurement", recipients:["admin_personal","admin_group","vendor"] },
  { key:"procurement_invoice_matching",  label:"Invoice Matching",     icon:"🔍", desc:"Hasil 3-way match (PO × GRN × Invoice) ke admin",                          category:"procurement", recipients:["admin_personal","admin_group"] },
  // FINANCE
  { key:"finance_customer_invoice",      label:"Invoice Customer",     icon:"🧾", desc:"Kirim invoice tagihan ke customer beserta link pembayaran",                 category:"finance",     recipients:["customer","admin_personal"] },
  { key:"finance_vendor_invoice",        label:"Invoice Vendor",       icon:"📥", desc:"Konfirmasi penerimaan invoice vendor dan notifikasi admin",                 category:"finance",     recipients:["vendor","admin_personal"] },
  { key:"finance_payment_reminder",      label:"Reminder Pembayaran",  icon:"⏰", desc:"Pengingat tagihan jatuh tempo ke customer",                                 category:"finance",     recipients:["customer","admin_personal"] },
  { key:"finance_payment_confirmation",  label:"Konfirmasi Pembayaran",icon:"💳", desc:"Konfirmasi pembayaran diterima ke customer atau vendor",                   category:"finance",     recipients:["customer","vendor","admin_personal"] },
  { key:"finance_outstanding_alert",     label:"Alert Piutang",        icon:"💸", desc:"Alert piutang/outstanding jatuh tempo ke grup admin",                       category:"finance",     recipients:["admin_group","admin_personal"] },
  // DOCUMENT
  { key:"doc_missing",                   label:"Dokumen Kurang",       icon:"📁", desc:"Minta kelengkapan dokumen ke customer atau vendor",                         category:"document",    recipients:["customer","vendor","admin_personal"] },
  { key:"doc_approved",                  label:"Dokumen Disetujui",    icon:"✅", desc:"Konfirmasi dokumen telah diverifikasi ke customer atau vendor",             category:"document",    recipients:["customer","vendor","admin_personal"] },
  { key:"doc_customs_released",          label:"Customs Released",     icon:"🏛️", desc:"Notifikasi barang release bea cukai + detail SPPB ke customer",           category:"document",    recipients:["customer","admin_personal"] },
  { key:"doc_bl_released",              label:"BL Diterbitkan",        icon:"📃", desc:"Notifikasi Bill of Lading terbit beserta detail vessel ke customer",        category:"document",    recipients:["customer","admin_personal"] },
  { key:"doc_coa_uploaded",              label:"COA Tersedia",         icon:"📋", desc:"Notifikasi Certificate of Analysis siap diunduh ke customer",              category:"document",    recipients:["customer","admin_personal"] },
  // APPROVAL
  { key:"approval_waiting",             label:"Menunggu Approval",     icon:"⏳", desc:"Kirim permintaan approval dengan link setuju/tolak ke admin",               category:"approval",    recipients:["admin_personal","admin_group"] },
  { key:"approval_approved",            label:"Disetujui",             icon:"✅", desc:"Konfirmasi persetujuan ke admin, customer, atau vendor",                   category:"approval",    recipients:["admin_personal","customer","vendor"] },
  { key:"approval_rejected",            label:"Ditolak",               icon:"❌", desc:"Notifikasi penolakan beserta alasan ke admin, customer, atau vendor",       category:"approval",    recipients:["admin_personal","customer","vendor"] },
  { key:"approval_revision_requested",  label:"Revisi Diminta",        icon:"🔄", desc:"Minta perbaikan dokumen/penawaran beserta catatan revisi",                  category:"approval",    recipients:["admin_personal","customer","vendor"] },
  // OPERATIONS
  { key:"ops_shipment_delayed",         label:"Pengiriman Terlambat",  icon:"⚠️", desc:"Informasi keterlambatan + ETA baru ke customer, grup admin, dan admin",    category:"ops",         recipients:["customer","admin_group","admin_personal"] },
  { key:"ops_truck_arrived",            label:"Armada Tiba",           icon:"🚛", desc:"Notifikasi armada/driver sudah tiba di lokasi ke customer",                 category:"ops",         recipients:["customer","admin_personal"] },
  { key:"ops_driver_checkin",           label:"Driver Check-in",       icon:"📍", desc:"Rekam lokasi & waktu check-in driver ke admin",                             category:"ops",         recipients:["admin_personal","admin_group"] },
  { key:"ops_warehouse_ready",          label:"Gudang Siap",           icon:"🏭", desc:"Notifikasi barang siap di gudang beserta lokasi ke customer",               category:"ops",         recipients:["customer","admin_personal"] },
  // SYSTEM
  { key:"sys_template_updated",         label:"Template Diperbarui",   icon:"⚙️", desc:"Notifikasi ke admin saat ada template WA yang diubah",                     category:"system",      recipients:["admin_personal"] },
  { key:"sys_required_field_missing",   label:"Field Wajib Kosong",    icon:"⚠️", desc:"Alert ke admin saat ada field wajib yang belum diisi di sistem",            category:"system",      recipients:["admin_personal","admin_group"] },
  { key:"sys_required_doc_missing",     label:"Dokumen Wajib Kurang",  icon:"📁", desc:"Alert dokumen wajib yang belum dilengkapi ke admin dan customer",           category:"system",      recipients:["admin_personal","customer"] },
];

const RECIPIENT_META: Record<RecipientKey, { label: string; icon: string }> = {
  admin_personal: { label: "Admin Pribadi", icon: "👤" },
  admin_group:    { label: "Grup Admin",    icon: "👥" },
  customer:       { label: "Customer",      icon: "🛍️" },
  vendor:         { label: "Vendor",        icon: "🏭" },
};

// ─── Variable groups per category ─────────────────────────────────────────────

type VarGroup = { label: string; color: string; vars: string[] };

const COMMON_VARS: VarGroup[] = [
  { label: "Dasar",    color: "bg-slate-100 text-slate-700 border-slate-300",   vars: ["tanggal","timestamp","notes"] },
  { label: "Order",    color: "bg-blue-50 text-blue-700 border-blue-200",       vars: ["orderNumber","route","serviceType"] },
  { label: "Customer", color: "bg-green-50 text-green-700 border-green-200",    vars: ["customerName","customerPhone"] },
  { label: "Vendor",   color: "bg-purple-50 text-purple-700 border-purple-200", vars: ["vendorName","vendorPhone"] },
  { label: "Link",     color: "bg-indigo-50 text-indigo-700 border-indigo-200", vars: ["approvalLink","rejectLink","uploadLink","paymentLink","poLink"] },
];

const CATEGORY_VARS: Record<CategoryKey, VarGroup[]> = {
  procurement: [
    { label: "Procurement", color: "bg-blue-50 text-blue-700 border-blue-200",    vars: ["prNumber","poNumber","grnNumber","invoiceNumber","requestedBy","department","priority","items","totalAmount","requiredDate","deliveryDate","deliveryAddress","paymentTerms","receiptItems","isComplete","shortage","rejected","matchStatus","variance","matchNotes","vendorComparison","vendorCount","recommendedVendor","recommendation","compareLink","poConfirmLink","grnLink","reviewLink","vendorFormUrl","quoteDeadline"] },
    { label: "Keuangan",    color: "bg-amber-50 text-amber-700 border-amber-200",  vars: ["invoiceAmount","poAmount","grnAmount"] },
  ],
  finance: [
    { label: "Invoice",     color: "bg-emerald-50 text-emerald-700 border-emerald-200", vars: ["invoiceNumber","vendorInvoiceNumber","invoiceAmount","invoiceStatus","dueDate","totalAmount","subtotalAmount","taxAmount","priceBreakdown","bankAccount","paymentRef","paidAmount","paymentMethod","daysUntilDue"] },
    { label: "Piutang",     color: "bg-amber-50 text-amber-700 border-amber-200",       vars: ["totalOutstanding","invoiceCount","overdueCount","overdueAmount","outstandingList","reportLink","oldestDueDate"] },
    { label: "Entitas",     color: "bg-blue-50 text-blue-700 border-blue-200",          vars: ["payeeName","poNumber"] },
  ],
  document: [
    { label: "Dokumen",     color: "bg-amber-50 text-amber-700 border-amber-200",  vars: ["documentName","documentType","missingDocs","uploadDeadline","approvedBy","adminEmail"] },
    { label: "Customs",     color: "bg-rose-50 text-rose-700 border-rose-200",     vars: ["ajuNumber","bcType","sppbNumber","estimatedDelivery"] },
    { label: "BL / Kapal",  color: "bg-cyan-50 text-cyan-700 border-cyan-200",     vars: ["blNumber","vessel","voyage","containerNumber","etd","etaDestination","blDocumentLink"] },
    { label: "COA",         color: "bg-teal-50 text-teal-700 border-teal-200",     vars: ["coaRef","productName","batchNumber","coaDownloadLink"] },
  ],
  approval: [
    { label: "Approval",    color: "bg-purple-50 text-purple-700 border-purple-200", vars: ["approvalRef","approvalType","requestedBy","priority","approvalDetail","amount","approvedBy","rejectedBy","rejectionReason","revisionNotes","revisionLink"] },
  ],
  ops: [
    { label: "Armada",      color: "bg-orange-50 text-orange-700 border-orange-200", vars: ["driverName","driverPhone","plateNumber","vehicleType","arrivalTime","checkinTime","location","coordinates","checkinStatus","driverNotes"] },
    { label: "Delay",       color: "bg-red-50 text-red-700 border-red-200",          vars: ["originalEta","newEta","delayReason","delayHours","actionTaken","contactNumber","notifiedCustomer","orderLink"] },
    { label: "Gudang",      color: "bg-teal-50 text-teal-700 border-teal-200",       vars: ["warehouseCode","warehouseAddress","readyTime","warehouseNotes","warehouseContact"] },
  ],
  system: [
    { label: "Sistem",      color: "bg-slate-100 text-slate-700 border-slate-300",   vars: ["templateName","recipientRole","workflowKey","updatedBy","templatePreview","templateLink","entityType","entityRef","missingFields","requiredAction","editLink","actionLink"] },
  ],
};

// ─── Sample data per category ─────────────────────────────────────────────────

const SAMPLE: Record<string, string> = {
  tanggal: "28 Mei 2026", timestamp: "28 Mei 2026, 09:00 WIB", notes: "Perhatikan kondisi barang",
  orderNumber: "CST/2026/000456", route: "Jakarta → Surabaya", serviceType: "Trucking",
  customerName: "PT. Maju Sejahtera", customerPhone: "6281234567890",
  vendorName: "PT. Trans Cepat", vendorPhone: "6289876543210",
  approvalLink: "https://cst.app/approve/xxxxx", rejectLink: "https://cst.app/reject/xxxxx",
  uploadLink: "https://cst.app/upload/xxxxx", paymentLink: "https://cst.app/pay/xxxxx",
  poLink: "https://cst.app/po/PO-2026-001",
  // Procurement
  prNumber: "PR-2026-001", poNumber: "PO-2026-001", grnNumber: "GRN-2026-001",
  requestedBy: "Budi Santoso", department: "Operasional", priority: "Tinggi",
  items: "• Pallet kayu 10 pcs @ Rp 150.000\n• Strapping band 5 roll @ Rp 80.000",
  totalAmount: "1.900.000", requiredDate: "30 Mei 2026", deliveryDate: "1 Juni 2026",
  deliveryAddress: "Jl. Raya Pelabuhan No. 10, Jakarta Utara",
  paymentTerms: "Net 30", receiptItems: "• Pallet kayu 10 pcs ✅\n• Strapping band 4 roll ✅ (1 kurang)",
  isComplete: "Tidak (1 item kurang)", shortage: "1 roll Strapping band", rejected: "-",
  invoiceNumber: "INV-2026-001", matchStatus: "✅ MATCH", variance: "0",
  matchNotes: "PO, GRN, dan Invoice sesuai", vendorComparison: "1. PT. Trans Cepat — Rp 1.850.000 ⭐\n2. PT. Maju Trans — Rp 2.100.000\n3. CV. Cargo Express — Rp 2.350.000",
  vendorCount: "3", recommendedVendor: "PT. Trans Cepat", recommendation: "Harga terbaik + track record 95%",
  compareLink: "https://cst.app/vendor-comparison/PR-2026-001",
  poConfirmLink: "https://cst.app/po-confirm/PO-2026-001", grnLink: "https://cst.app/grn/GRN-2026-001",
  reviewLink: "https://cst.app/review/INV-2026-001", vendorFormUrl: "https://cst.app/vendor-form/PR-2026-001",
  quoteDeadline: "29 Mei 2026, 12:00 WIB",
  // Finance
  vendorInvoiceNumber: "INV-VENDOR-2026-042", invoiceAmount: "18.500.000",
  invoiceStatus: "Menunggu Pembayaran", dueDate: "15 Juni 2026",
  subtotalAmount: "16.818.182", taxAmount: "1.681.818", paidAmount: "18.500.000",
  priceBreakdown: "• Sea Freight: Rp 12.000.000\n• Customs Clearance: Rp 4.818.182",
  bankAccount: "BCA: 1234567890 a/n PT. B2B Marketplace and Logistic",
  paymentRef: "TRF-20260528-001", paymentMethod: "Transfer Bank BCA",
  daysUntilDue: "7", totalOutstanding: "125.000.000", invoiceCount: "8",
  overdueCount: "3", overdueAmount: "45.000.000",
  outstandingList: "1. PT. Maju Sejahtera — Rp 45.000.000 (overdue 5 hari)\n2. CV. Karya Maju — Rp 32.500.000 (jatuh tempo 3 hari)",
  reportLink: "https://cst.app/finance/ar-report", oldestDueDate: "23 Mei 2026",
  payeeName: "PT. Maju Sejahtera",
  // Document
  documentName: "Commercial Invoice", documentType: "Dokumen Kepabeanan",
  missingDocs: "1. Commercial Invoice\n2. Packing List\n3. Bill of Lading",
  uploadDeadline: "29 Mei 2026, 17:00 WIB", approvedBy: "Siti Rahayu",
  adminEmail: "ops@cstlogistic.co.id", ajuNumber: "090100-2026-000456",
  bcType: "BC 2.0", sppbNumber: "SPPB-2026-000789", estimatedDelivery: "30 Mei 2026",
  blNumber: "MSCUA2026456", vessel: "MV CST Express", voyage: "V.045W",
  containerNumber: "MSCU7654321", etd: "30 Mei 2026", etaDestination: "10 Juni 2026",
  blDocumentLink: "https://cst.app/docs/bl/MSCUA2026456",
  coaRef: "COA-2026-089", productName: "Green Bean Arabica Grade 1",
  batchNumber: "BATCH-2026-034", coaDownloadLink: "https://cst.app/docs/coa/COA-2026-089",
  partyName: "PT. Maju Sejahtera",
  // Approval
  approvalRef: "APV-2026-001", approvalType: "Purchase Order",
  approvalDetail: "PO kepada PT. Trans Cepat untuk pengadaan pallet",
  amount: "1.900.000", rejectedBy: "Siti Rahayu",
  rejectionReason: "Harga di atas budget yang disetujui", revisionNotes: "Harga harus di bawah Rp 2.000.000",
  revisionLink: "https://cst.app/approval/APV-2026-001/revise",
  // Operations
  driverName: "Budi Santoso", driverPhone: "6287654321098",
  plateNumber: "B 1234 XYZ", vehicleType: "Truk CDD",
  arrivalTime: "28 Mei 2026, 08:45 WIB", checkinTime: "28 Mei 2026, 08:45 WIB",
  location: "Gudang Cilincing, Jakarta Utara",
  coordinates: "-6.1018, 106.9025", checkinStatus: "Check-in Masuk",
  driverNotes: "Kondisi barang aman", originalEta: "28 Mei 2026",
  newEta: "30 Mei 2026", delayReason: "Kemacetan tol Jakarta–Cikampek",
  delayHours: "48", actionTaken: "Rerouting via jalur alternatif Pantura",
  contactNumber: "(021) 6241234", notifiedCustomer: "Ya",
  orderLink: "https://cst.app/logistics/orders/CST-2026-000456",
  warehouseCode: "WH-JKT-01", warehouseAddress: "Jl. Raya Pelabuhan No. 10, Jakarta Utara",
  readyTime: "28 Mei 2026, 10:00 WIB", warehouseNotes: "Barang sudah di area loading dock C",
  warehouseContact: "(021) 6241234",
  // System
  templateName: "procurement_purchase_request (admin_personal)", recipientRole: "admin_personal",
  workflowKey: "procurement_purchase_request", updatedBy: "Admin CST",
  templatePreview: "📋 *PURCHASE REQUEST BARU*\nNo. PR: PR-2026-001…",
  templateLink: "https://cst.app/settings/enterprise-wa-templates",
  entityType: "Purchase Order", entityRef: "PO-2026-001",
  missingFields: "• deliveryDate\n• vendorContact",
  requiredAction: "Lengkapi data di halaman detail PO",
  editLink: "https://cst.app/purchase/orders/PO-2026-001",
  actionLink: "https://cst.app/purchase/orders/PO-2026-001",
};

function renderPreview(body: string): string {
  let result = body.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, cond, content: string) =>
    `‹${cond.toUpperCase()}›${content.trim()}‹/${cond.toUpperCase()}›`
  );
  result = result.replace(/\{\{(\w+)\}\}/g, (_m, k) => SAMPLE[k] ?? `{{${k}}}`);
  return result.split("\n").filter(line => !line.includes("{{") || line.trim() === "").join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EnterpriseWaTemplatesPage() {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [configs, setConfigs]     = useState<Record<string, string>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved]         = useState(false);

  const [category, setCategory]   = useState<CategoryKey>("procurement");
  const [workflowKey, setWorkflowKey] = useState<string>("procurement_purchase_request");
  const [recipient, setRecipient] = useState<RecipientKey>("admin_personal");

  // ── Derived ──
  const categoryWorkflows = WORKFLOWS.filter(w => w.category === category);
  const activeWorkflow    = WORKFLOWS.find(w => w.key === workflowKey) ?? categoryWorkflows[0]!;
  const validRecipients   = activeWorkflow?.recipients ?? (["admin_personal"] as RecipientKey[]);
  const effectiveRecipient = validRecipients.includes(recipient) ? recipient : validRecipients[0]!;
  const cfgKey = (r: string, w: string) => `${r}__${w}`;
  const currentBody = configs[cfgKey(effectiveRecipient, activeWorkflow?.key ?? "")] ?? "";
  const isSaved     = savedKeys.has(cfgKey(effectiveRecipient, activeWorkflow?.key ?? ""));
  const preview     = renderPreview(currentBody);

  const categoryCustomCount = (cat: CategoryKey) =>
    WORKFLOWS.filter(w => w.category === cat).reduce((acc, w) =>
      acc + w.recipients.filter(r => savedKeys.has(cfgKey(r, w.key))).length, 0);

  const totalCustomized = [...savedKeys].length;

  // ── Data fetch ──
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/wa-template-configs", { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as { configs: Record<string, string>; savedKeys: string[] };
          setConfigs(data.configs ?? {});
          setSavedKeys(new Set(data.savedKeys ?? []));
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  // ── When category changes, switch to first workflow ──
  function handleCategoryChange(cat: CategoryKey) {
    setCategory(cat);
    const first = WORKFLOWS.find(w => w.category === cat);
    if (first) {
      setWorkflowKey(first.key);
      setRecipient(first.recipients[0]!);
    }
  }

  // ── When workflow changes, reset recipient to first valid ──
  function handleWorkflowChange(key: string) {
    setWorkflowKey(key);
    const wf = WORKFLOWS.find(w => w.key === key);
    if (wf) setRecipient(wf.recipients[0]!);
  }

  const setBody = (body: string) =>
    setConfigs(prev => ({ ...prev, [cfgKey(effectiveRecipient, activeWorkflow?.key ?? "")]: body }));

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    if (!el) { setBody(currentBody + text); return; }
    const s = el.selectionStart, e = el.selectionEnd;
    setBody(currentBody.slice(0, s) + text + currentBody.slice(e));
    setTimeout(() => { el.selectionStart = el.selectionEnd = s + text.length; el.focus(); }, 0);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/wa-template-configs", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ recipient: effectiveRecipient, workflow: activeWorkflow?.key, body: currentBody }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedKeys(prev => new Set([...prev, cfgKey(effectiveRecipient, activeWorkflow?.key ?? "")]));
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      toast({ title: "Template tersimpan ✅" });
    } catch (e) {
      toast({ title: "Gagal menyimpan", description: String(e), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function handleReset() {
    setResetting(true);
    try {
      await fetch(`/api/settings/wa-template-configs/${effectiveRecipient}/${activeWorkflow?.key}`, {
        method: "DELETE", credentials: "include",
      });
      const key = cfgKey(effectiveRecipient, activeWorkflow?.key ?? "");
      setSavedKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
      const refetch = await fetch("/api/settings/wa-template-configs", { credentials: "include" });
      if (refetch.ok) {
        const data = await refetch.json() as { configs: Record<string, string>; savedKeys: string[] };
        setConfigs(data.configs ?? {}); setSavedKeys(new Set(data.savedKeys ?? []));
      }
      toast({ title: "Template direset ke default" });
    } catch (e) {
      toast({ title: "Gagal reset", description: String(e), variant: "destructive" });
    } finally { setResetting(false); }
  }

  const catVarGroups = [...COMMON_VARS, ...(CATEGORY_VARS[category] ?? [])];

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="p-6 pb-0">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" />Kembali
          </Button>
        </div>
        {/* ── Header ── */}
        <div className="flex items-start gap-4">
          <Link href="/settings">
            <button type="button" className="mt-1 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <MessageSquare className="h-6 w-6 text-green-500" />
                Enterprise WA Workflow Templates
              </h1>
              {totalCustomized > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-900/20">
                  {totalCustomized} dikustomisasi
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              60 template WA enterprise untuk Procurement, Finance, Dokumen, Approval, Operasional & Sistem.
              Gunakan <code className="bg-muted px-1 rounded text-xs">{"{{variabel}}"}</code> untuk data dinamis.
              Baris dengan variabel kosong dihapus otomatis saat pengiriman.
            </p>
          </div>
          <Link href="/settings/wa-templates">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs whitespace-nowrap">
              <MessageSquare className="h-3.5 w-3.5" />
              Logistik Templates
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-muted rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* ── Category Tabs ── */}
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CATEGORY_META) as CategoryKey[]).map(cat => {
                const meta  = CATEGORY_META[cat];
                const count = categoryCustomCount(cat);
                const total = WORKFLOWS.filter(w => w.category === cat).reduce((a, w) => a + w.recipients.length, 0);
                const isActive = cat === category;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleCategoryChange(cat)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      isActive
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-card hover:bg-accent border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {meta.icon}
                    <span>{meta.label}</span>
                    <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${
                      isActive
                        ? "bg-white/20 text-primary-foreground"
                        : count > 0
                        ? "bg-amber-400/30 text-amber-700 dark:text-amber-400"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {count > 0 ? `${count}/` : ""}{total}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">

              {/* ── Left: Editor ── */}
              <div className="space-y-4">

                {/* Workflow selector */}
                <Card className="bg-card border-border">
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Workflow — {CATEGORY_META[category].label}:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {categoryWorkflows.map(wf => {
                        const isActive   = wf.key === activeWorkflow?.key;
                        const customCount = wf.recipients.filter(r => savedKeys.has(cfgKey(r, wf.key))).length;
                        return (
                          <button
                            key={wf.key}
                            type="button"
                            title={wf.desc}
                            onClick={() => handleWorkflowChange(wf.key)}
                            className={`text-xs px-2.5 py-1.5 rounded-full border transition-all flex items-center gap-1 ${
                              isActive
                                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                : "bg-muted hover:bg-accent text-muted-foreground border-border hover:text-foreground"
                            }`}
                          >
                            <span>{wf.icon}</span>
                            {wf.label}
                            {customCount > 0 && !isActive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Recipient Tabs */}
                <Tabs value={effectiveRecipient} onValueChange={v => setRecipient(v as RecipientKey)}>
                  <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50">
                    {(["admin_personal","admin_group","customer","vendor"] as RecipientKey[]).map(r => {
                      const disabled = !validRecipients.includes(r);
                      const hasSaved = savedKeys.has(cfgKey(r, activeWorkflow?.key ?? ""));
                      return (
                        <TabsTrigger
                          key={r} value={r} disabled={disabled}
                          className={`gap-1.5 ${disabled ? "opacity-30 cursor-not-allowed" : ""}`}
                        >
                          <span>{RECIPIENT_META[r].icon}</span>
                          {RECIPIENT_META[r].label}
                          {hasSaved && !disabled && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                          )}
                          {disabled && <span className="text-[9px] ml-0.5 text-muted-foreground">(N/A)</span>}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>

                {/* Editor Card */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{activeWorkflow?.icon}</span>
                        <div>
                          <CardTitle className="text-base">{activeWorkflow?.label}</CardTitle>
                          <CardDescription className="text-xs mt-0.5">{activeWorkflow?.desc}</CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {RECIPIENT_META[effectiveRecipient].icon} {RECIPIENT_META[effectiveRecipient].label}
                        </span>
                        {isSaved ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-[10px]">
                            ● Dikustomisasi
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-[10px]">
                            ○ Default
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">

                    {/* Textarea */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                        ✏️ Edit Template
                        <span className="font-normal">(klik variabel di panel kanan untuk insert ke kursor)</span>
                      </p>
                      <Textarea
                        ref={textareaRef}
                        className="font-mono text-xs min-h-[300px] resize-y border-primary/40 focus:border-primary leading-relaxed"
                        value={currentBody}
                        onChange={e => setBody(e.target.value)}
                        placeholder={`Template "${activeWorkflow?.label}" — penerima "${RECIPIENT_META[effectiveRecipient].label}"…`}
                        spellCheck={false}
                      />
                      <p className="text-xs text-muted-foreground text-right">{currentBody.length} karakter</p>
                    </div>

                    {/* Preview */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview Real-time</p>
                      <div className="font-mono text-xs bg-muted/40 border rounded-md p-3 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                        {preview
                          ? preview.split(/(\{\{[^}]+\}\})/).map((part, i) =>
                              part.startsWith("{{")
                                ? <span key={i} className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 rounded px-0.5">{part}</span>
                                : part
                            )
                          : <span className="text-muted-foreground italic">Template kosong</span>}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <Button size="sm" className="gap-1.5 min-w-[90px]" disabled={saving} onClick={() => void handleSave()}>
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <CheckCircle className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                        {saving ? "Menyimpan…" : saved ? "Tersimpan!" : "Simpan"}
                      </Button>
                      {isSaved && (
                        <Button size="sm" variant="outline" className="gap-1.5 text-muted-foreground" disabled={resetting} onClick={() => void handleReset()}>
                          {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          Reset Default
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">Berlaku langsung tanpa restart</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* ── Right: Variables Panel ── */}
              <div className="space-y-4">
                <Card className="bg-card border-border sticky top-4">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Variabel Template</CardTitle>
                    <CardDescription className="text-xs">Klik untuk insert ke posisi kursor</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 max-h-[calc(100vh-240px)] overflow-y-auto">

                    {catVarGroups.map(g => (
                      <div key={g.label} className="space-y-1">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{g.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {g.vars.map(v => (
                            <button
                              key={v} type="button"
                              className={`text-[10px] font-mono border rounded px-1.5 py-0.5 cursor-pointer transition-all hover:opacity-80 hover:scale-105 active:scale-95 ${g.color}`}
                              title={`Insert {{${v}}}`}
                              onClick={() => insertAtCursor(`{{${v}}}`)}
                            >
                              {`{{${v}}}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div className="border-t pt-3 space-y-1.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Tips</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li>• Gunakan <code className="bg-muted px-0.5 rounded">*teks*</code> untuk bold WA</li>
                        <li>• Gunakan <code className="bg-muted px-0.5 rounded">_teks_</code> untuk italic WA</li>
                        <li>• Gunakan <code className="bg-muted px-0.5 rounded">`teks`</code> untuk monospace</li>
                        <li>• Baris kosong antara section = lebih mudah dibaca</li>
                        <li>• Variabel kosong → baris dihapus otomatis</li>
                      </ul>
                    </div>

                    {/* Workflow coverage summary */}
                    <div className="border-t pt-3 space-y-2">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Coverage Kategori Ini</p>
                      {categoryWorkflows.map(wf => {
                        const customized = wf.recipients.filter(r => savedKeys.has(cfgKey(r, wf.key)));
                        return (
                          <div key={wf.key} className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <span>{wf.icon}</span>
                              {wf.label}
                            </span>
                            <span className="text-[10px]">
                              {customized.length > 0
                                ? <span className="text-amber-600">{customized.length}/{wf.recipients.length} custom</span>
                                : <span className="text-muted-foreground">{wf.recipients.length} default</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>

            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
