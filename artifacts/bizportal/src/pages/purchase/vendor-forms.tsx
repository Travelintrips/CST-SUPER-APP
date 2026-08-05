import { DatePicker } from "@/components/ui/date-picker";
import { useState, useMemo, useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Copy, CopyPlus, ExternalLink, Link2, Plus, Trash2, Eye, ToggleLeft, ToggleRight,
  Loader2, RotateCcw, CalendarDays, User, Phone, MessageCircle, XCircle,
  Clock, SendHorizonal, Pencil, CheckCircle, Package, Star, Building2, FileText,
  BarChart2, TrendingDown, TrendingUp, Minus, Award,
  Layers, ChevronDown, ChevronRight, AlertCircle, ClipboardList, PackageCheck, Info,
  Search, DollarSign, CreditCard, BadgeCheck, ChevronsUpDown, Check, ArrowLeft,
} from "lucide-react";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TemplateSnapshotCard } from "@/components/TemplateSnapshotCard";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { PaymentProofPreview } from "@/components/PaymentProofPreview";
import { inCodeTemplates } from "@workspace/product-templates";
import type { ProductTemplate, DynamicFormValues } from "@workspace/product-templates";
import {
  TemplateFieldRenderer,
  TemplateDocumentRenderer,
  TemplateChecklistRenderer,
  TemplateInstructionRenderer,
} from "@/components/template";
import { Link } from "wouter";
import { QueryState } from "@/components/ui/query-state";

// ── Types ──────────────────────────────────────────────────────────────────────

type FormLink = {
  id: number; token: string; supplierId: number | null; serviceType: string;
  title: string | null; notes: string | null; isActive: boolean;
  shortUrl: string | null; expiresAt: string | null; createdAt: string;
  vendorName: string | null; mode: string; orderId: number | null;
  orderNumber: string | null; orderItemId: number | null;
  itemStatus: string | null; phase: string | null;
  maxSubmissions: number | null; resubmitAllowed: boolean | null; adminNotes: string | null;
  categoryKey?: string | null;
};

type MediaAssetItem = {
  role: string; objectPath: string; filename: string; mimeType: string; size?: number;
};

type Submission = {
  id: number; linkId: number | null; token: string; supplierId: number | null;
  serviceType: string; vendorName: string | null; contactPerson: string | null;
  contactPhone: string | null; formData: Record<string, unknown>;
  staffData: Record<string, unknown>; submittedAt: string;
  waStatus: string | null; waRecipient: string | null; waAt: string | null;
  responseStatus: string | null; vendorPrice: string | null; currency: string | null;
  eta: string | null; validUntil: string | null; selectedByAdmin: boolean;
  selectedAt: string | null; locked: boolean | null; revisionCount: number | null;
  adminNotes: string | null; submittedIp: string | null;
  orderId: number | null;
  templateId: string | null; templateVersion: string | null;
  templateSnapshot: Record<string, unknown> | null;
  mediaAssets?: MediaAssetItem[] | null;
  attachmentUrl?: string | null;
};

type CustomerApproval = {
  id: number; token: string; orderId: number | null; orderNumber: string | null;
  customerName: string | null; customerPhone: string | null;
  offerSummary: Record<string, unknown>; sellingPrice: string | null;
  currency: string | null; termsNotes: string | null; status: string;
  approvedAt: string | null; rejectedAt: string | null; soNumber: string | null;
  salesDocId: number | null;
  createdAt: string; expiresAt: string | null;
  submissionId: number | null; vendorCost: string | null;
  ppnPct: string | null; ppnNominal: string | null; profitMarginPct: string | null;
  adminNotes: string | null; locked: boolean | null;
};

type ActivityLog = {
  id: number; entityType: string; entityId: number; action: string;
  actor: string | null; note: string | null; data: Record<string, unknown>;
  createdAt: string;
};

type PriceHistory = {
  id: number; submissionId: number | null; versionNumber: number;
  oldPrice: string | null; newPrice: string | null; currency: string | null;
  reason: string | null; changedBy: string | null; changedAt: string;
};

type OpConfirm = {
  id: number; token: string; orderId: number | null; orderNumber: string | null;
  orderItemId: number | null; supplierId: number | null; vendorName: string | null;
  serviceType: string; status: string; submittedAt: string | null;
  instruction: string | null; createdAt: string;
};

type Supplier = { id: number; name: string; serviceType: string | null; phone: string | null };
type Order = { id: number; orderNumber: string; customerName: string; status: string; createdAt: string };
type OrderItem = { id: number; orderId: number; category: string; serviceName: string; calculatorType: string; subtotal: string };

type CustomerInvoice = {
  id: number; token: string; orderId: number | null; orderNumber: string | null;
  salesDocId: number | null; invoiceNumber: string | null;
  customerName: string | null; customerPhone: string | null;
  currency: string; subtotal: string | null; taxRate: string;
  taxAmount: string | null; grandTotal: string | null; amountPaid: string;
  paymentStatus: string; paymentMethod: string | null;
  dueDate: string | null; notes: string | null;
  viewedAt: string | null; acknowledgedAt: string | null;
  status: string; createdAt: string; expiresAt: string | null;
  proofUrl: string | null; proofUploadedAt: string | null; proofRemarks: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_META: Record<string, { label: string; emoji: string }> = {
  product: { label: "Produk", emoji: "📦" },
  trucking: { label: "Trucking", emoji: "🚛" },
  air_freight: { label: "Air Freight", emoji: "✈️" },
  sea_freight: { label: "Sea Freight", emoji: "🚢" },
  ppjk: { label: "PPJK / Customs", emoji: "📋" },
  handling: { label: "Handling / WH", emoji: "🏭" },
  document: { label: "Document / Misc", emoji: "📄" },
  warehouse: { label: "Warehouse", emoji: "🏭" },
  customs_clearance: { label: "Customs Clearance", emoji: "🛃" },
  exim_service: { label: "Exim Service", emoji: "🌐" },
};
const SERVICE_TYPES = Object.keys(SERVICE_META);
const SERVICE_TYPES_ONLY = SERVICE_TYPES.filter(k => k !== "product");

const ITEM_STATUS_META: Record<string, { label: string; color: string }> = {
  waiting_vendor: { label: "Menunggu Vendor", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  vendor_submitted: { label: "Vendor Submitted", color: "bg-blue-100 text-blue-700 border-blue-200" },
  admin_review: { label: "Admin Review", color: "bg-purple-100 text-purple-700 border-purple-200" },
  waiting_customer: { label: "Menunggu Customer", color: "bg-orange-100 text-orange-700 border-orange-200" },
  customer_approved: { label: "Customer Approved ✅", color: "bg-green-100 text-green-700 border-green-200" },
  customer_rejected: { label: "Customer Rejected ❌", color: "bg-red-100 text-red-700 border-red-200" },
  so_created: { label: "SO Dibuat 🎉", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  vendor_confirmed: { label: "Vendor Operasional ✔", color: "bg-teal-100 text-teal-700 border-teal-200" },
};

const APPROVAL_STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "Menunggu", color: "bg-yellow-100 text-yellow-700" },
  approved: { label: "Disetujui ✅", color: "bg-green-100 text-green-700" },
  rejected: { label: "Ditolak ❌", color: "bg-red-100 text-red-700" },
};

const OP_STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "Belum Diisi", color: "bg-yellow-100 text-yellow-700" },
  submitted: { label: "Sudah Diisi ✅", color: "bg-green-100 text-green-700" },
};

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "API error");
  return data;
}

function buildFormUrl(token: string): string {
  return `${window.location.origin}/vendor-mini-form/${token}`;
}

function buildApprovalUrl(token: string): string {
  return `${window.location.origin}/customer-approval/${token}`;
}

function buildOpConfirmUrl(token: string): string {
  return `${window.location.origin}/op-confirm/${token}`;
}

function fmtPrice(price: string | null, currency: string | null) {
  if (!price) return "—";
  return `${currency ?? "IDR"} ${Number(price).toLocaleString("id-ID")}`;
}

// ── Badges ────────────────────────────────────────────────────────────────────

function ItemStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  const meta = ITEM_STATUS_META[status];
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${meta?.color ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {meta?.label ?? status}
    </span>
  );
}

function ApprovalStatusBadge({ status }: { status: string }) {
  const meta = APPROVAL_STATUS_META[status];
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${meta?.color ?? "bg-slate-100 text-slate-600"}`}>
      {meta?.label ?? status}
    </span>
  );
}

// ── Copy helper ───────────────────────────────────────────────────────────────

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <Button
      variant="ghost" size="icon" className="h-7 w-7"
      title={label ?? "Salin URL"}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true); setTimeout(() => setCopied(false), 1500);
          toast({ title: "Disalin!" });
        });
      }}
    >
      {copied ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

// ── WA Template Card Dialog ───────────────────────────────────────────────────

type WaTemplateType = "vendor_quotation" | "customer_approval" | "vendor_operational";

interface WaTemplateConfig {
  vendorName?: string | null;
  customerName?: string | null;
  serviceType?: string | null;
  orderNumber?: string | null;
  formLink?: string;
  approvalLink?: string;
  opLink?: string;
  expiresAt?: string | null;
}

const WA_TEMPLATE_META: Record<WaTemplateType, { label: string; icon: string; color: string; bg: string; border: string; headerBg: string }> = {
  vendor_quotation:   { label: "Vendor Quotation",   icon: "🏭", color: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200",   headerBg: "bg-blue-50" },
  customer_approval:  { label: "Customer Approval",  icon: "👤", color: "text-green-700",  bg: "bg-green-50",  border: "border-green-200",  headerBg: "bg-green-50" },
  vendor_operational: { label: "Vendor Operasional", icon: "⚙️", color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200", headerBg: "bg-orange-50" },
};

const WA_TEMPLATE_WORKFLOW: Record<WaTemplateType, { recipient: string; workflow: string }> = {
  vendor_quotation:   { recipient: "vendor",   workflow: "vendor_request" },
  customer_approval:  { recipient: "customer", workflow: "customer_approval" },
  vendor_operational: { recipient: "vendor",   workflow: "op_request" },
};

function renderWaTemplate(body: string, cfg: WaTemplateConfig): string {
  const svcLabel = cfg.serviceType ? (SERVICE_META[cfg.serviceType]?.label ?? cfg.serviceType) : "";
  const fmtExpiry = cfg.expiresAt
    ? new Date(cfg.expiresAt).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
    : null;
  const vars: Record<string, string | null> = {
    vendorName: cfg.vendorName ?? null,
    customerName: cfg.customerName ?? null,
    orderNumber: cfg.orderNumber ?? null,
    vendorMiniFormLink: cfg.formLink ?? null,
    customerApprovalLink: cfg.approvalLink ?? null,
    operationalFormLink: cfg.opLink ?? null,
    shipmentType: svcLabel || null,
    serviceType: svcLabel || null,
    expiresAt: fmtExpiry,
    timestamp: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
  };
  // Remove {{#if ...}} / {{/if}} condition blocks (not evaluated on frontend)
  const processed = body.replace(/\{\{#if \w+\}\}[\s\S]*?\{\{\/if\}\}/g, "").trim();
  return processed.split("\n").filter(line => {
    const matches = [...line.matchAll(/\{\{(\w+)\}\}/g)];
    if (matches.length === 0) return true;
    return matches.every(m => vars[m[1]] != null && vars[m[1]] !== "");
  }).map(line => {
    return line.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildWaTemplate(type: WaTemplateType, cfg: WaTemplateConfig): string {
  const svcLabel = cfg.serviceType ? (SERVICE_META[cfg.serviceType]?.label ?? cfg.serviceType) : "";
  const fmtExpiry = cfg.expiresAt
    ? new Date(cfg.expiresAt).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
    : null;

  if (type === "vendor_quotation") {
    return [
      `Halo ${cfg.vendorName ?? "[Nama Vendor]"},`,
      ``,
      `Kami mohon bantuannya untuk mengisi penawaran layanan *${svcLabel || "[Service Type]"}*${cfg.orderNumber ? ` untuk order *${cfg.orderNumber}*` : ""}.`,
      ``,
      `Silakan isi melalui link berikut:`,
      cfg.formLink ?? "[Mini Form Link]",
      fmtExpiry ? `\nLink valid hingga: ${fmtExpiry}` : ``,
      ``,
      `Terima kasih atas kerjasamanya 🙏`,
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (type === "customer_approval") {
    return [
      `Halo ${cfg.customerName ?? "[Customer]"},`,
      ``,
      `Berikut penawaran untuk request Anda${cfg.orderNumber ? ` *(${cfg.orderNumber})*` : ""}. Silakan review dan konfirmasi melalui link berikut:`,
      ``,
      cfg.approvalLink ?? "[Customer Approval Link]",
      ``,
      `Terima kasih telah menggunakan layanan B2B Marketplace and Logistic 🙏`,
    ].join("\n").trim();
  }
  // vendor_operational
  return [
    `Halo ${cfg.vendorName ?? "[Nama Vendor]"},`,
    ``,
    `Customer sudah menyetujui penawaran${cfg.orderNumber ? ` untuk order *${cfg.orderNumber}*` : ""}. Mohon lengkapi data operasional untuk layanan *${svcLabel || "[Service Type]"}* melalui link berikut:`,
    ``,
    cfg.opLink ?? "[Operational Confirmation Link]",
    ``,
    `Terima kasih atas kerjasamanya 🙏`,
  ].join("\n").trim();
}

function WaTemplateDialog({
  type, config, defaultPhone, onSend, trigger,
}: {
  type: WaTemplateType;
  config: WaTemplateConfig;
  defaultPhone?: string | null;
  onSend?: (phone: string, msg: string) => Promise<void>;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [customMsg, setCustomMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [settingsTemplate, setSettingsTemplate] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setPhone(defaultPhone ?? "");
      setCustomMsg("");
      setCopied(false);
      const { recipient, workflow } = WA_TEMPLATE_WORKFLOW[type];
      fetch(`/api/settings/wa-template-configs?recipient=${recipient}&workflow=${workflow}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then((data: { body?: string } | null) => {
          setSettingsTemplate(data?.body ?? null);
        })
        .catch(() => setSettingsTemplate(null));
    }
  }, [open, defaultPhone, type]);

  const tmeta = WA_TEMPLATE_META[type];
  const templateMsg = settingsTemplate ? renderWaTemplate(settingsTemplate, config) : buildWaTemplate(type, config);
  const finalMsg = customMsg.trim() || templateMsg;

  const handleCopy = () => {
    navigator.clipboard.writeText(finalMsg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Pesan disalin ke clipboard!" });
    });
  };

  const handleOpenWa = () => {
    const num = phone.trim().replace(/^0/, "62").replace(/\D/g, "");
    const url = num
      ? `https://wa.me/${num}?text=${encodeURIComponent(finalMsg)}`
      : `https://wa.me/?text=${encodeURIComponent(finalMsg)}`;
    window.open(url, "_blank", "noopener");
  };

  const handleSendApi = async () => {
    if (!onSend) return;
    if (!phone.trim()) { toast({ title: "Masukkan nomor WhatsApp", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await onSend(phone.trim(), finalMsg);
      toast({ title: "Pesan WA berhasil dikirim!" });
      setOpen(false);
    } catch (e: unknown) {
      toast({ title: "Gagal kirim WA", description: (e as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{tmeta.icon}</span> Template Pesan WhatsApp
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {/* Badge tipe */}
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${tmeta.color} ${tmeta.bg} ${tmeta.border}`}>
            <span>{tmeta.icon}</span> {tmeta.label}
          </span>

          {/* Preview card */}
          <div className={`rounded-xl border ${tmeta.border} overflow-hidden`}>
            <div className={`px-3 py-2 border-b ${tmeta.border} ${tmeta.headerBg} flex items-center justify-between`}>
              <span className={`text-xs font-semibold ${tmeta.color}`}>Preview Pesan</span>
              <Button
                type="button" variant="ghost" size="sm"
                className={`h-6 text-xs gap-1 px-2 ${tmeta.color} hover:${tmeta.bg}`}
                onClick={handleCopy}
              >
                {copied ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Disalin!" : "Copy"}
              </Button>
            </div>
            <pre className={`px-4 py-3 text-xs ${tmeta.color} whitespace-pre-wrap font-sans leading-relaxed ${tmeta.bg}`}>
              {customMsg.trim() || templateMsg}
            </pre>
          </div>

          {/* Custom message override */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Edit Pesan (opsional — kosongkan untuk pakai template)</Label>
            <Textarea
              value={customMsg}
              onChange={e => setCustomMsg(e.target.value)}
              rows={4}
              placeholder="Ketik di sini untuk mengubah pesan..."
              className="text-xs resize-none font-mono"
            />
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label>Nomor WhatsApp Tujuan</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Contoh: 628123456789" />
            <p className="text-xs text-slate-400">Format: 628xxxxxxxxx (tanpa + atau spasi)</p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <Button
              type="button" variant="outline"
              className="flex-1 gap-1.5 border-green-300 text-green-700 hover:bg-green-50 hover:border-green-400"
              onClick={handleOpenWa}
            >
              <MessageCircle className="h-4 w-4" /> Buka WhatsApp
            </Button>
            {onSend && (
              <Button
                type="button"
                className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                onClick={handleSendApi}
                disabled={loading || !phone.trim()}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
                Kirim via API
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Link Dialog ─────────────────────────────────────────────────────────


function CreateLinkDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"rate_collection" | "order_based">("rate_collection");
  const [serviceType, setServiceType] = useState("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [vendorName, setVendorName] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [orderId, setOrderId] = useState<string>("");
  const [orderItemId, setOrderItemId] = useState<string>("");
  const [maxSubmissions, setMaxSubmissions] = useState("");
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string>("");
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { companyQueryParam } = useCompany();

  const { data: allSuppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers-simple", companyQueryParam],
    queryFn: () => apiFetch<Supplier[]>(`/api/trading/suppliers?${companyQueryParam}`),
    enabled: open,
  });

  const suppliers = serviceType
    ? allSuppliers.filter(s => !s.serviceType || s.serviceType === serviceType)
    : allSuppliers;

  const { data: orders } = useQuery<Order[]>({
    queryKey: ["vmf-orders"],
    queryFn: () => apiFetch<Order[]>("/api/vendor-form/admin/orders"),
    enabled: open && mode === "order_based",
  });

  const { data: orderItems } = useQuery<OrderItem[]>({
    queryKey: ["vmf-order-items", orderId],
    queryFn: () => apiFetch<OrderItem[]>(`/api/vendor-form/admin/orders/${orderId}/items`),
    enabled: !!orderId && mode === "order_based",
  });

  const allCommodityTemplates = Object.entries(inCodeTemplates).sort(([, a], [, b]) =>
    a.label.localeCompare(b.label, "id")
  );

  const selectedOrder = orders?.find(o => String(o.id) === orderId);

  const reset = () => {
    setMode("rate_collection"); setServiceType(""); setSupplierId(""); setVendorName("");
    setTitle(""); setNotes(""); setExpiresInDays(""); setOrderId(""); setOrderItemId("");
    setMaxSubmissions(""); setSelectedCategoryKey(""); setVendorPickerOpen(false);
  };

  const handleCreate = async () => {
    if (!serviceType) { toast({ title: "Pilih service type dulu", variant: "destructive" }); return; }
    if (mode === "order_based" && !orderId) { toast({ title: "Pilih order dulu", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const result = await apiFetch<{ deactivatedCount?: number }>("/api/vendor-form/admin/links", {
        method: "POST",
        body: JSON.stringify({
          serviceType, supplierId: supplierId ? Number(supplierId) : undefined,
          vendorName: vendorName.trim() || undefined, title: title.trim() || undefined,
          notes: notes.trim() || undefined, expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
          mode, orderId: orderId ? Number(orderId) : undefined,
          orderNumber: selectedOrder?.orderNumber, orderItemId: orderItemId ? Number(orderItemId) : undefined,
          maxSubmissions: maxSubmissions ? Number(maxSubmissions) : undefined,
          categoryKey: selectedCategoryKey || undefined,
        }),
      });
      const deactivated = result?.deactivatedCount ?? 0;
      toast({
        title: "Link berhasil dibuat",
        description: deactivated > 0
          ? `${deactivated} link lama untuk order ini dinonaktifkan otomatis.`
          : undefined,
      });
      onCreated(); setOpen(false); reset();
    } catch (e: unknown) {
      toast({ title: "Gagal membuat link", description: (e as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Buat Link Form</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Buat Link Form Vendor Baru</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {/* Mode */}
          <div className="space-y-1.5">
            <Label>Mode <span className="text-red-500">*</span></Label>
            <Select value={mode} onValueChange={v => setMode(v as typeof mode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rate_collection">📊 Rate Collection (form umum)</SelectItem>
                <SelectItem value="order_based">📦 Order-Based (terkait order)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-400">
              {mode === "rate_collection"
                ? "Form penawaran umum — vendor isi rate tanpa konteks order spesifik."
                : "Form terkait order — vendor isi penawaran untuk order/item tertentu. Link lama untuk order yang sama akan dinonaktifkan otomatis."}
            </p>
          </div>

          {/* Order picker (order_based only) */}
          {mode === "order_based" && (
            <div className="space-y-1.5">
              <Label>Order <span className="text-red-500">*</span></Label>
              <Select value={orderId || "__none__"} onValueChange={v => { setOrderId(v === "__none__" ? "" : v); setOrderItemId(""); }}>
                <SelectTrigger><SelectValue placeholder="Pilih order" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Pilih order —</SelectItem>
                  {orders?.map(o => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.orderNumber} · {o.customerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {orderId && orderItems && (
                <div className="space-y-1.5 mt-2">
                  <Label>Item Spesifik (opsional)</Label>
                  <Select value={orderItemId || "__none__"} onValueChange={v => setOrderItemId(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Semua item / tidak spesifik" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Tidak spesifik —</SelectItem>
                      {orderItems.map(i => (
                        <SelectItem key={i.id} value={String(i.id)}>
                          {i.serviceName} · {i.category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Service type */}
          <div className="space-y-1.5">
            <Label>Jenis Form <span className="text-red-500">*</span></Label>
            <Select value={serviceType} onValueChange={v => { setServiceType(v); setSupplierId(""); if (v !== "product") setSelectedCategoryKey(""); }}>
              <SelectTrigger><SelectValue placeholder="Pilih jenis form" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="text-xs text-slate-400">Pembelian Produk</SelectLabel>
                  <SelectItem value="product">📦 Produk</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-xs text-slate-400">Layanan Logistik</SelectLabel>
                  {SERVICE_TYPES_ONLY.map(k => (
                    <SelectItem key={k} value={k}>{SERVICE_META[k]!.emoji} {SERVICE_META[k]!.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Vendor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Vendor dari Daftar (opsional)</Label>
              {serviceType && suppliers.length > 0 && (
                <span className="text-xs text-slate-400">{suppliers.length} vendor tersedia</span>
              )}
            </div>
            <Popover open={vendorPickerOpen} onOpenChange={setVendorPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={vendorPickerOpen}
                  className="w-full justify-between font-normal h-9 text-sm"
                >
                  {supplierId
                    ? (() => {
                        const s = allSuppliers.find(x => String(x.id) === supplierId);
                        return s ? s.name : "— Tidak spesifik —";
                      })()
                    : "— Tidak spesifik —"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[calc(100vw-2rem)] sm:w-[420px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Cari nama vendor..." />
                  <CommandList>
                    <CommandEmpty>Tidak ada vendor yang cocok.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="__tidak-spesifik__"
                        onSelect={() => { setSupplierId(""); setVendorPickerOpen(false); }}
                      >
                        <Check className={`mr-2 h-4 w-4 ${!supplierId ? "opacity-100" : "opacity-0"}`} />
                        <span className="text-slate-400">— Tidak spesifik —</span>
                      </CommandItem>
                      {suppliers.map(s => (
                        <CommandItem
                          key={s.id}
                          value={`${s.name} ${s.serviceType ?? ""}`}
                          onSelect={() => { setSupplierId(String(s.id)); setVendorPickerOpen(false); }}
                        >
                          <Check className={`mr-2 h-4 w-4 ${supplierId === String(s.id) ? "opacity-100" : "opacity-0"}`} />
                          <span className="flex-1">{s.name}</span>
                          {s.serviceType && (
                            <span className="ml-2 text-xs text-slate-400 shrink-0">
                              {SERVICE_META[s.serviceType]?.emoji} {SERVICE_META[s.serviceType]?.label ?? s.serviceType}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {serviceType && allSuppliers.length > 0 && suppliers.length === 0 && (
              <p className="text-xs text-amber-600">Tidak ada vendor dengan service type ini. Tambah vendor baru di Purchase → Vendors.</p>
            )}
          </div>

          {/* Commodity Template — hanya muncul jika jenis form = produk */}
          {serviceType === "product" && <div className="space-y-1.5">
            <Label>Template Komoditas (opsional)</Label>
            <Select value={selectedCategoryKey || "__none__"} onValueChange={v => {
              const key = v === "__none__" ? "" : v;
              setSelectedCategoryKey(key);
              if (key) setServiceType("product");
            }}>
              <SelectTrigger><SelectValue placeholder="Tanpa template komoditas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanpa template —</SelectItem>
                {allCommodityTemplates.map(([key, tpl]) => (
                  <SelectItem key={key} value={key}>
                    📦 {tpl.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCategoryKey && (
              <p className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">
                ✅ Vendor akan melihat custom fields, dokumen wajib, & checklist dari template ini.
              </p>
            )}
          </div>}

          {/* Vendor name override */}
          <div className="space-y-1.5">
            <Label>Nama Vendor (override / manual)</Label>
            <Input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Jika tidak ada di daftar" />
          </div>

          <div className="space-y-1.5">
            <Label>Judul Form (opsional)</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Contoh: Penawaran Rate Trucking Q3" />
          </div>
          <div className="space-y-1.5">
            <Label>Instruksi untuk Vendor</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Instruksi khusus untuk vendor..." />
          </div>
          <div className="space-y-1.5">
            <Label>Kadaluarsa (hari, opsional)</Label>
            <Input type="number" value={expiresInDays} onChange={e => setExpiresInDays(e.target.value)} placeholder="Contoh: 7" />
          </div>
          <div className="space-y-1.5">
            <Label>Maks. Submission (opsional)</Label>
            <Input type="number" value={maxSubmissions} onChange={e => setMaxSubmissions(e.target.value)} placeholder="Kosong = tidak dibatasi" />
            <p className="text-xs text-slate-400">Batas jumlah vendor yang bisa submit melalui link ini.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Buat Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Customer Approval Dialog ───────────────────────────────────────────

function CreateApprovalDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [termsNotes, setTermsNotes] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [offerItems, setOfferItems] = useState<{ label: string; value: string }[]>([]);
  const [adminNotes, setAdminNotes] = useState("");
  // Margin calculator
  const [vendorCost, setVendorCost] = useState("");
  const [ppnPct, setPpnPct] = useState("11");
  const [sellingPrice, setSellingPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const { data: orders } = useQuery<Order[]>({
    queryKey: ["vmf-orders"],
    queryFn: () => apiFetch<Order[]>("/api/vendor-form/admin/orders"),
    enabled: open,
  });

  const selectedOrder = orders?.find(o => String(o.id) === orderId);
  useEffect(() => {
    if (selectedOrder) setOrderNumber(selectedOrder.orderNumber);
  }, [selectedOrder]);

  const vendorCostNum = vendorCost ? Number(vendorCost) : null;
  const ppnPctNum = ppnPct ? Number(ppnPct) : 0;
  const ppnNominal = vendorCostNum !== null ? Math.round(vendorCostNum * ppnPctNum / 100) : null;
  const sellingPriceNum = sellingPrice ? Number(sellingPrice) : null;
  const profitMarginPct = sellingPriceNum && vendorCostNum
    ? Number((((sellingPriceNum - vendorCostNum) / sellingPriceNum) * 100).toFixed(2)) : null;

  const addItem = () => setOfferItems(p => [...p, { label: "", value: "" }]);
  const updateItem = (i: number, field: "label" | "value", val: string) => {
    setOfferItems(p => p.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  };
  const removeItem = (i: number) => setOfferItems(p => p.filter((_, idx) => idx !== i));

  const reset = () => {
    setOrderId(""); setOrderNumber(""); setCustomerName(""); setCustomerPhone("");
    setSellingPrice(""); setCurrency("IDR"); setTermsNotes(""); setExpiresInDays("7");
    setOfferItems([]); setAdminNotes(""); setVendorCost(""); setPpnPct("11");
  };

  const handleCreate = async () => {
    if (!sellingPrice) { toast({ title: "Masukkan harga total", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const offerSummary = Object.fromEntries(offerItems.filter(i => i.label).map(i => [i.label, i.value]));
      await apiFetch("/api/vendor-form/admin/customer-approvals", {
        method: "POST",
        body: JSON.stringify({
          orderId: orderId ? Number(orderId) : undefined, orderNumber,
          customerName, customerPhone, offerSummary,
          sellingPrice: sellingPrice ? Number(sellingPrice) : undefined,
          currency, termsNotes: termsNotes || undefined,
          expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
          adminNotes: adminNotes || undefined,
          vendorCost: vendorCost ? Number(vendorCost) : undefined,
          ppnPct: ppnPct ? Number(ppnPct) : undefined,
          ppnNominal: ppnNominal ?? undefined,
          profitMarginPct: profitMarginPct ?? undefined,
        }),
      });
      toast({ title: "Link approval berhasil dibuat!" });
      onCreated(); setOpen(false); reset();
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const fmt = (n: number | null) => n === null ? "—" : `${currency} ${n.toLocaleString("id-ID")}`;

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />Buat Link Approval Customer</Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Buat Link Approval Customer</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Order (opsional)</Label>
            <Select value={orderId || "__none__"} onValueChange={v => setOrderId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="— Pilih order —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanpa order —</SelectItem>
                {orders?.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.orderNumber} · {o.customerName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>No. Order (manual)</Label>
              <Input value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder="ORD/..." />
            </div>
            <div className="space-y-1.5">
              <Label>Nama Customer</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="PT. ..." />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>No. WA Customer</Label>
              <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="62812xxx" />
            </div>
            <div className="space-y-1.5">
              <Label>Mata Uang</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["IDR", "USD", "SGD", "EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Margin Calculator ── */}
          <div className="border border-indigo-200 rounded-xl p-4 space-y-3 bg-indigo-50/40">
            <p className="text-sm font-semibold text-indigo-700 flex items-center gap-1.5">
              🧮 Kalkulator Margin (internal)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Harga Vendor (Cost)</Label>
                <Input type="number" value={vendorCost} onChange={e => setVendorCost(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">PPN %</Label>
                <Select value={ppnPct} onValueChange={setPpnPct}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0% (tidak ada PPN)</SelectItem>
                    <SelectItem value="11">11% (PPN Normal)</SelectItem>
                    <SelectItem value="12">12%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {vendorCostNum !== null && sellingPriceNum !== null && (
              <div className="bg-white border border-indigo-100 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                <div>
                  <p className="text-slate-400 mb-0.5">Harga Dasar</p>
                  <p className="font-bold text-slate-800">{fmt(vendorCostNum)}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-0.5">PPN {ppnPct}%</p>
                  <p className="font-bold text-slate-600">{fmt(ppnNominal)}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-0.5">Harga Jual</p>
                  <p className="font-bold text-indigo-700 text-sm">{fmt(sellingPriceNum)}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-0.5">Profit</p>
                  <p className="font-bold text-green-600">
                    {vendorCostNum !== null && sellingPriceNum !== null
                      ? `${fmt(sellingPriceNum - vendorCostNum)} (${profitMarginPct ?? 0}%)`
                      : "—"}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Total Harga ke Customer <span className="text-red-500">*</span></Label>
            <Input type="number" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} placeholder="Auto dari kalkulator, atau isi manual" />
            <p className="text-xs text-slate-400">Harga ini yang akan dilihat oleh customer.</p>
          </div>

          {/* Offer line items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Detail Item Penawaran</Label>
              <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="h-3.5 w-3.5 mr-1" />Tambah</Button>
            </div>
            {offerItems.map((item, i) => (
              <div key={i} className="flex gap-2">
                <Input className="flex-1" placeholder="Label (cth: Trucking)" value={item.label} onChange={e => updateItem(i, "label", e.target.value)} />
                <Input className="flex-1" placeholder="Nilai (cth: Rp 2.000.000)" value={item.value} onChange={e => updateItem(i, "value", e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeItem(i)}><XCircle className="h-4 w-4 text-slate-400" /></Button>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>Terms & Conditions / Catatan</Label>
            <Textarea value={termsNotes} onChange={e => setTermsNotes(e.target.value)} rows={2} placeholder="Syarat pembayaran, masa berlaku, dll." />
          </div>
          <div className="space-y-1.5">
            <Label>Catatan Internal Admin</Label>
            <Textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={2} placeholder="Catatan internal, tidak terlihat oleh customer..." />
          </div>
          <div className="space-y-1.5">
            <Label>Berlaku (hari)</Label>
            <Input type="number" value={expiresInDays} onChange={e => setExpiresInDays(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Buat Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Op Confirm Dialog ───────────────────────────────────────────────────

function CreateOpConfirmDialog({ suppliers, onCreated }: { suppliers: Supplier[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const { data: orders } = useQuery<Order[]>({
    queryKey: ["vmf-orders"],
    queryFn: () => apiFetch<Order[]>("/api/vendor-form/admin/orders"),
    enabled: open,
  });
  const selectedOrder = orders?.find(o => String(o.id) === orderId);
  useEffect(() => { if (selectedOrder) setOrderNumber(selectedOrder.orderNumber); }, [selectedOrder]);

  const reset = () => {
    setOrderId(""); setOrderNumber(""); setSupplierId(""); setVendorName(""); setServiceType(""); setInstruction("");
  };

  const handleCreate = async () => {
    if (!serviceType) { toast({ title: "Pilih service type", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await apiFetch("/api/vendor-form/admin/op-confirms", {
        method: "POST",
        body: JSON.stringify({
          orderId: orderId ? Number(orderId) : undefined, orderNumber,
          supplierId: supplierId ? Number(supplierId) : undefined,
          vendorName: vendorName || undefined, serviceType,
          instruction: instruction || undefined,
        }),
      });
      toast({ title: "Link konfirmasi operasional dibuat!" });
      onCreated(); setOpen(false); reset();
    } catch (e: unknown) {
      toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />Buat Link Konfirmasi Operasional</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Buat Link Konfirmasi Operasional Vendor</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Order (opsional)</Label>
            <Select value={orderId || "__none__"} onValueChange={v => setOrderId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="— Pilih order —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanpa order —</SelectItem>
                {orders?.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.orderNumber} · {o.customerName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>No. Order (manual)</Label>
            <Input value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder="ORD/..." />
          </div>
          <div className="space-y-1.5">
            <Label>Jenis Form <span className="text-red-500">*</span></Label>
            <Select value={serviceType} onValueChange={setServiceType}>
              <SelectTrigger><SelectValue placeholder="Pilih jenis form" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="text-xs text-slate-400">Pembelian Produk</SelectLabel>
                  <SelectItem value="product">📦 Produk</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-xs text-slate-400">Layanan Logistik</SelectLabel>
                  {SERVICE_TYPES_ONLY.map(k => (
                    <SelectItem key={k} value={k}>{SERVICE_META[k]!.emoji} {SERVICE_META[k]!.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Vendor dari Daftar</Label>
            <Select value={supplierId || "__none__"} onValueChange={v => setSupplierId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="— Pilih vendor —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanpa vendor —</SelectItem>
                {suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Nama Vendor (manual)</Label>
            <Input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Jika tidak ada di daftar" />
          </div>
          <div className="space-y-1.5">
            <Label>Instruksi untuk Vendor</Label>
            <Textarea value={instruction} onChange={e => setInstruction(e.target.value)} rows={2} placeholder="Instruksi khusus operasional..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Buat Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Highlight helper ──────────────────────────────────────────────────────────

function getHighlight(serviceType: string, fd: Record<string, unknown>): string {
  const pick = (...keys: string[]) => keys.map(k => fd[k]).find(v => v && v !== "") as string | undefined;
  switch (serviceType) {
    case "trucking": return [pick("truck_type"), pick("area_pickup"), pick("area_delivery"), pick("price") ? `Rp ${Number(pick("price")).toLocaleString("id-ID")}` : null].filter(Boolean).join(" · ") || "—";
    case "sea_freight": return [pick("pol"), "→", pick("pod"), pick("container_type"), pick("freight_rate") ? `USD ${pick("freight_rate")}` : null].filter(Boolean).join(" ") || "—";
    case "air_freight": return [pick("origin_airport"), "→", pick("dest_airport"), pick("rate_per_kg") ? `Rp ${Number(pick("rate_per_kg")).toLocaleString("id-ID")}/kg` : null].filter(Boolean).join(" ") || "—";
    case "product": return [pick("product_name"), pick("unit_price") ? `Rp ${Number(pick("unit_price")).toLocaleString("id-ID")}` : null].filter(Boolean).join(" · ") || "—";
    default: return pick("price", "service_fee", "customs_service", "handling_fee") ? `Rp ${Number(pick("price", "service_fee", "customs_service", "handling_fee")).toLocaleString("id-ID")}` : "—";
  }
}

// ── Submission Card ───────────────────────────────────────────────────────────

// ── Media Gallery helper ──────────────────────────────────────────────────────

const MEDIA_ROLE_LABEL: Record<string, string> = {
  cover: "🖼️ Cover Image",
  gallery: "🖼️ Gallery",
  video: "🎬 Video",
  brochure: "📄 Brosur",
  certificate: "🏆 Sertifikat",
};

function SubmissionMediaGallery({ mediaAssets }: { mediaAssets: MediaAssetItem[] }) {
  const byRole = mediaAssets.reduce<Record<string, MediaAssetItem[]>>((acc, m) => {
    if (!acc[m.role]) acc[m.role] = [];
    acc[m.role].push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      {(["cover", "gallery", "video", "brochure", "certificate"] as const).map(role => {
        const items = byRole[role];
        if (!items || items.length === 0) return null;
        const isImage = (m: MediaAssetItem) => m.mimeType.startsWith("image/");
        const isVideo = (m: MediaAssetItem) => m.mimeType.startsWith("video/");
        const downloadUrl = (m: MediaAssetItem) => `/api/storage${m.objectPath}`;
        return (
          <div key={role}>
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">{MEDIA_ROLE_LABEL[role]}</p>
            {role === "gallery" || role === "certificate" ? (
              <div className="flex flex-wrap gap-2">
                {items.map(m => (
                  <a key={m.objectPath} href={downloadUrl(m)} target="_blank" rel="noreferrer"
                    className="block" title={m.filename}>
                    {isImage(m) ? (
                      <img src={downloadUrl(m)} alt={m.filename}
                        className="w-14 h-14 object-cover rounded-lg border border-slate-200 shadow-sm hover:opacity-80 transition-opacity" />
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-indigo-600 hover:underline bg-slate-50 rounded px-2 py-1.5 border border-slate-200">
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[120px]">{m.filename}</span>
                      </div>
                    )}
                  </a>
                ))}
              </div>
            ) : (
              items.map(m => (
                <a key={m.objectPath} href={downloadUrl(m)} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 text-xs text-indigo-600 hover:underline bg-slate-50 rounded-lg px-3 py-2 border border-slate-200 shadow-sm">
                  {isImage(m) ? (
                    <img src={downloadUrl(m)} alt={m.filename} className="w-10 h-10 object-cover rounded" />
                  ) : isVideo(m) ? (
                    <span className="text-base">🎬</span>
                  ) : (
                    <span className="text-base">📄</span>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate max-w-[160px]">{m.filename}</p>
                    {m.size && <p className="text-[10px] text-slate-400">{(m.size / 1024 / 1024).toFixed(1)} MB</p>}
                  </div>
                  <ExternalLink className="h-3 w-3 shrink-0 ml-1" />
                </a>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function SubmissionCard({
  sub, idx, onDelete, onSelect, onToggleDetail, showDetail,
}: {
  sub: Submission; idx: number;
  onDelete: (id: number) => void;
  onSelect: (id: number) => void;
  onToggleDetail: (id: number) => void;
  showDetail: boolean;
}) {
  const fd = sub.formData ?? {};
  const highlight = getHighlight(sub.serviceType, fd);
  const fields = Object.entries(fd).filter(([, v]) => v !== "" && v !== null && v !== undefined);
  const meta = SERVICE_META[sub.serviceType];
  const [selectConfirmOpen, setSelectConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  return (
    <div className={`border rounded-lg overflow-hidden shadow-sm ${sub.selectedByAdmin ? "ring-2 ring-green-400 border-green-300" : ""}`}>
      <div className={`flex items-start justify-between px-4 py-3 border-b gap-3 ${sub.selectedByAdmin ? "bg-green-50" : "bg-slate-50"}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800 text-sm">
            #{idx + 1} · {sub.vendorName ?? "—"}
            {sub.selectedByAdmin && <Star className="h-3.5 w-3.5 text-green-500 fill-green-500" />}
          </div>
          <div className="flex flex-wrap gap-x-3 mt-0.5">
            {sub.contactPerson && <span className="text-xs text-slate-500 flex items-center gap-1"><User className="h-3 w-3" />{sub.contactPerson}</span>}
            {sub.contactPhone && <span className="text-xs text-slate-500 flex items-center gap-1"><Phone className="h-3 w-3" />{sub.contactPhone}</span>}
          </div>
          <div className="flex gap-2 mt-1 flex-wrap">
            <span className="text-xs text-slate-400">{highlight}</span>
            {sub.vendorPrice && (
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                {fmtPrice(sub.vendorPrice, sub.currency)}
              </span>
            )}
            {sub.eta && <span className="text-xs text-slate-500">ETA: {sub.eta}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-slate-400 whitespace-nowrap">
            {new Date(sub.submittedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onToggleDetail(sub.id)}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {!sub.selectedByAdmin && (
            <Button
              variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700"
              title="Pilih vendor ini"
              onClick={() => setSelectConfirmOpen(true)}
            >
              <CheckCircle className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <AlertDialog open={selectConfirmOpen} onOpenChange={setSelectConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pilih Vendor</AlertDialogTitle>
            <AlertDialogDescription>
              Pilih <strong>{sub.vendorName ?? "vendor ini"}</strong> sebagai vendor terpilih untuk submission ini?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setSelectConfirmOpen(false); onSelect(sub.id); }}>
              Pilih
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Submission</AlertDialogTitle>
            <AlertDialogDescription>
              Submission dari <strong>{sub.vendorName ?? "vendor ini"}</strong> akan dihapus secara permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setDeleteConfirmOpen(false); onDelete(sub.id); }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {showDetail && (
        <div className="px-4 py-3 bg-white space-y-3">
          {sub.templateSnapshot && (
            <TemplateSnapshotCard templateSnapshot={sub.templateSnapshot} className="text-xs" />
          )}
          {fields.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              {fields.map(([k, v]) => (
                <div key={k}>
                  <span className="text-slate-400 capitalize block">{k.replace(/_/g, " ")}</span>
                  <span className="font-medium text-slate-800 break-words">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
          {/* Lampiran */}
          {sub.attachmentUrl && (
            <div className="pt-2 border-t border-dashed border-slate-100">
              <p className="text-xs text-slate-400 mb-1 font-medium">📎 Lampiran</p>
              <a
                href={`/api/storage${sub.attachmentUrl}`}
                target="_blank" rel="noreferrer"
                className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" /> Buka Lampiran
              </a>
            </div>
          )}
          {/* Media Assets */}
          {sub.mediaAssets && sub.mediaAssets.length > 0 && (
            <div className="pt-2 border-t border-dashed border-slate-100">
              <p className="text-xs text-slate-500 font-semibold mb-2">📷 Media Produk/Jasa</p>
              <SubmissionMediaGallery mediaAssets={sub.mediaAssets} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Compare Vendors Sheet ─────────────────────────────────────────────────────

type RankedSub = Submission & { rank: number; priceNum: number | null; isLowest: boolean; isHighest: boolean };

function rankSubmissions(subs: Submission[]): RankedSub[] {
  const withPrice = subs.map(s => ({ ...s, priceNum: s.vendorPrice ? Number(s.vendorPrice) : null }));
  const priced = withPrice.filter(s => s.priceNum !== null).sort((a, b) => (a.priceNum ?? 0) - (b.priceNum ?? 0));
  const unpriced = withPrice.filter(s => s.priceNum === null);
  const lowestPrice = priced[0]?.priceNum ?? null;
  const highestPrice = priced[priced.length - 1]?.priceNum ?? null;

  let rank = 1;
  return [
    ...priced.map(s => ({
      ...s, rank: rank++,
      isLowest: s.priceNum === lowestPrice && lowestPrice !== null,
      isHighest: s.priceNum === highestPrice && highestPrice !== null && priced.length > 1,
    })),
    ...unpriced.map(s => ({ ...s, rank: 0, isLowest: false, isHighest: false })),
  ];
}

function PriceTrendIcon({ isLowest, isHighest, hasPriced }: { isLowest: boolean; isHighest: boolean; hasPriced: boolean }) {
  if (!hasPriced) return <Minus className="h-3.5 w-3.5 text-slate-300" />;
  if (isLowest) return <TrendingDown className="h-3.5 w-3.5 text-green-500" />;
  if (isHighest) return <TrendingUp className="h-3.5 w-3.5 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-yellow-400" />;
}

function CompareVendorsSheet({
  link, submissions, open, onOpenChange, onSelect,
}: {
  link: FormLink; submissions: Submission[]; open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (id: number) => void;
}) {
  const meta = SERVICE_META[link.serviceType];
  const linkSubs = submissions.filter(s => s.linkId === link.id);
  const ranked = rankSubmissions(linkSubs);
  const allHavePrice = ranked.every(s => s.priceNum !== null);
  const anySelected = ranked.some(s => s.selectedByAdmin);

  const [selectingId, setSelectingId] = useState<number | null>(null);

  const handleSelect = async (id: number) => {
    setSelectingId(id);
    try { await onSelect(id); }
    finally { setSelectingId(null); }
  };

  const lowestPrice = ranked.find(s => s.isLowest)?.priceNum ?? null;

  const priceSavings = (price: number | null): string | null => {
    if (price === null || lowestPrice === null || price === lowestPrice) return null;
    const diff = price - lowestPrice;
    const pct = ((diff / lowestPrice) * 100).toFixed(1);
    return `+${Number(pct).toLocaleString("id-ID")}%`;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl flex flex-col p-0" side="right">
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-indigo-50 to-blue-50 shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-indigo-500" />
            <SheetTitle className="text-lg">Perbandingan Vendor</SheetTitle>
          </div>
          <p className="text-sm text-slate-600 mt-0.5">
            {meta?.emoji} {link.title ?? `Form ${meta?.label ?? link.serviceType}`}
            {link.orderNumber && <span className="ml-2 text-xs text-blue-600 font-medium">📦 {link.orderNumber}</span>}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-xs bg-indigo-100 text-indigo-700 border border-indigo-200 rounded px-2 py-0.5 font-medium">
              {ranked.length} vendor
            </span>
            {allHavePrice && (
              <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded px-2 py-0.5">
                Semua ada harga ✓
              </span>
            )}
            {anySelected && (
              <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded px-2 py-0.5">
                <Star className="h-3 w-3 inline mr-0.5 fill-amber-500 text-amber-500" />Vendor dipilih
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {ranked.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <BarChart2 className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">Belum ada submission untuk link ini</p>
            </div>
          ) : (
            <>
              {/* Summary bar */}
              {ranked.filter(s => s.priceNum !== null).length >= 2 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Harga Terendah</p>
                    <p className="font-bold text-green-600 text-sm">
                      {fmtPrice(ranked.find(s => s.isLowest)?.vendorPrice ?? null, ranked.find(s => s.isLowest)?.currency ?? null)}
                    </p>
                    <p className="text-xs text-slate-400">{ranked.find(s => s.isLowest)?.vendorName ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Rata-rata</p>
                    <p className="font-bold text-slate-700 text-sm">
                      {(() => {
                        const pricedRanked = ranked.filter(s => s.priceNum !== null);
                        if (!pricedRanked.length) return "—";
                        const avg = pricedRanked.reduce((a, s) => a + (s.priceNum ?? 0), 0) / pricedRanked.length;
                        const cur = pricedRanked[0]?.currency ?? "IDR";
                        return `${cur} ${Math.round(avg).toLocaleString("id-ID")}`;
                      })()}
                    </p>
                    <p className="text-xs text-slate-400">{ranked.filter(s => s.priceNum !== null).length} vendor</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Harga Tertinggi</p>
                    <p className="font-bold text-red-500 text-sm">
                      {fmtPrice(ranked.find(s => s.isHighest)?.vendorPrice ?? null, ranked.find(s => s.isHighest)?.currency ?? null)}
                    </p>
                    <p className="text-xs text-slate-400">{ranked.find(s => s.isHighest)?.vendorName ?? "—"}</p>
                  </div>
                </div>
              )}

              {/* Vendor cards */}
              <div className="space-y-3">
                {ranked.map((sub) => {
                  const isSelected = sub.selectedByAdmin;
                  const savings = priceSavings(sub.priceNum);
                  const cardBg = isSelected
                    ? "bg-green-50 border-green-300"
                    : sub.isLowest
                    ? "bg-emerald-50 border-emerald-200"
                    : sub.isHighest
                    ? "bg-red-50 border-red-200"
                    : "bg-white border-slate-200";

                  return (
                    <div key={sub.id} className={`border rounded-xl p-4 transition-all ${cardBg}`}>
                      <div className="flex items-start gap-3">
                        {/* Rank badge */}
                        <div className="shrink-0 mt-0.5">
                          {isSelected ? (
                            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                              <Award className="h-4 w-4 text-white" />
                            </div>
                          ) : sub.rank > 0 ? (
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                              sub.rank === 1 ? "bg-green-100 text-green-700" :
                              sub.rank === 2 ? "bg-blue-100 text-blue-700" :
                              sub.rank === 3 ? "bg-orange-100 text-orange-700" :
                              "bg-slate-100 text-slate-600"
                            }`}>
                              #{sub.rank}
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs">
                              —
                            </div>
                          )}
                        </div>

                        {/* Main info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-800 text-sm">{sub.vendorName ?? "—"}</span>
                            {isSelected && (
                              <span className="text-xs bg-green-600 text-white rounded px-1.5 py-0.5 font-medium flex items-center gap-0.5">
                                <Star className="h-2.5 w-2.5 fill-white" /> Dipilih
                              </span>
                            )}
                            {sub.isLowest && !isSelected && (
                              <span className="text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-medium">
                                Termurah 🏆
                              </span>
                            )}
                            {sub.isHighest && !isSelected && (
                              <span className="text-xs bg-red-100 text-red-600 rounded px-1.5 py-0.5">
                                Tertinggi
                              </span>
                            )}
                          </div>
                          {sub.contactPerson && (
                            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                              <User className="h-3 w-3" />{sub.contactPerson}
                              {sub.contactPhone && <span className="ml-1">· {sub.contactPhone}</span>}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Price + details grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                        <div className="col-span-2 sm:col-span-1">
                          <p className="text-xs text-slate-400 mb-0.5 flex items-center gap-1">
                            <PriceTrendIcon isLowest={sub.isLowest} isHighest={sub.isHighest} hasPriced={sub.priceNum !== null} />
                            Harga Penawaran
                          </p>
                          {sub.vendorPrice ? (
                            <div>
                              <p className={`font-bold text-base ${sub.isLowest ? "text-green-700" : sub.isHighest ? "text-red-600" : "text-slate-800"}`}>
                                {fmtPrice(sub.vendorPrice, sub.currency)}
                              </p>
                              {savings && (
                                <p className="text-xs text-red-400 font-medium">{savings} dari termurah</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-400 italic">Tidak diisi</p>
                          )}
                        </div>

                        <div>
                          <p className="text-xs text-slate-400 mb-0.5">⏱ ETA</p>
                          <p className="text-sm text-slate-700 font-medium">{sub.eta ?? <span className="text-slate-400 italic text-xs">—</span>}</p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-400 mb-0.5">📅 Berlaku Sampai</p>
                          <p className="text-sm text-slate-700">
                            {sub.validUntil
                              ? new Date(sub.validUntil).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
                              : <span className="text-slate-400 italic text-xs">—</span>}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-400 mb-0.5">📩 Dikirim</p>
                          <p className="text-xs text-slate-600">
                            {new Date(sub.submittedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                      </div>

                      {/* Template Snapshot */}
                      {sub.templateSnapshot && (
                        <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
                          <TemplateSnapshotCard templateSnapshot={sub.templateSnapshot} />
                        </div>
                      )}

                      {/* Form data snippet */}
                      {Object.keys(sub.formData).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-dashed border-slate-200 grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {Object.entries(sub.formData).slice(0, 6).map(([k, v]) => (
                            <div key={k}>
                              <p className="text-xs text-slate-400 truncate">{k}</p>
                              <p className="text-xs text-slate-700 font-medium truncate">{String(v)}</p>
                            </div>
                          ))}
                          {Object.keys(sub.formData).length > 6 && (
                            <p className="text-xs text-slate-400 col-span-full">+{Object.keys(sub.formData).length - 6} field lainnya…</p>
                          )}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                        {/* Locked badge */}
                        {(sub as Submission & { locked?: boolean | null }).locked && (
                          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 flex items-center gap-1">
                            🔒 Dikunci (customer approved)
                          </span>
                        )}
                        {/* Revision count badge */}
                        {(sub as Submission & { revisionCount?: number | null }).revisionCount != null &&
                          (sub as Submission & { revisionCount?: number | null }).revisionCount! > 0 && (
                          <span className="text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-2 py-0.5">
                            🔄 Rev-{(sub as Submission & { revisionCount?: number | null }).revisionCount}
                          </span>
                        )}
                        <div className="flex items-center gap-2 ml-auto">
                          {/* Request revision */}
                          {!(sub as Submission & { locked?: boolean | null }).locked && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 border-orange-300 text-orange-700 hover:bg-orange-50"
                              onClick={async () => {
                                const reason = prompt("Alasan minta revisi harga (opsional):");
                                if (reason === null) return;
                                try {
                                  await apiFetch(`/api/vendor-form/admin/submissions/${sub.id}/request-revision`, {
                                    method: "POST", body: JSON.stringify({ reason: reason || undefined }),
                                  });
                                  onSelect(sub.id);
                                } catch (e: unknown) {
                                  alert((e as Error).message);
                                }
                              }}
                            >
                              ↩ Minta Revisi
                            </Button>
                          )}
                          {/* Select button */}
                          {!isSelected && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
                              disabled={selectingId === sub.id}
                              onClick={() => handleSelect(sub.id)}
                            >
                              {selectingId === sub.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Star className="h-3 w-3" />}
                              Pilih Vendor Ini
                            </Button>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="mt-1 flex justify-end">
                          <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Vendor ini telah dipilih
                            {sub.selectedAt && (
                              <span className="text-slate-400 font-normal">
                                · {new Date(sub.selectedAt).toLocaleDateString("id-ID")}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Unpriced warning */}
              {ranked.some(s => s.priceNum === null) && (
                <p className="text-xs text-slate-400 text-center pt-2">
                  * Vendor tanpa harga tidak diikutkan dalam ranking
                </p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Link Detail Sheet ─────────────────────────────────────────────────────────

function LinkDetailSheet({
  link, submissions, open, onOpenChange, onDeleteSubmission, onSelectSubmission,
}: {
  link: FormLink; submissions: Submission[]; open: boolean;
  onOpenChange: (v: boolean) => void;
  onDeleteSubmission: (id: number) => void;
  onSelectSubmission: (id: number) => void;
}) {
  const meta = SERVICE_META[link.serviceType];
  const expired = link.expiresAt && new Date(link.expiresAt) < new Date();
  const linkSubs = submissions.filter(s => s.linkId === link.id);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleDetail = useCallback((id: number) => {
    setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const formUrl = link.shortUrl ?? buildFormUrl(link.token);

  const handleSendWa = async (phone: string, msg: string) => {
    await apiFetch(`/api/vendor-form/admin/links/${link.id}/send-wa`, {
      method: "POST",
      body: JSON.stringify({ phone, customMessage: msg || undefined }),
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b bg-slate-50 shrink-0">
          <SheetTitle className="text-lg leading-snug">
            {meta?.emoji} {link.title ?? `Form ${meta?.label ?? link.serviceType}`}
          </SheetTitle>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Badge variant="outline" className="text-xs">{link.mode === "order_based" ? "📦 Order-Based" : "📊 Rate Collection"}</Badge>
            <Badge variant={link.isActive && !expired ? "default" : "secondary"} className="text-xs">
              {link.isActive && !expired ? "Aktif" : "Nonaktif"}
            </Badge>
            {!link.isActive && link.adminNotes?.includes("[auto-replaced]") && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                ↩ Digantikan
              </span>
            )}
            {link.mode === "order_based" && <ItemStatusBadge status={link.itemStatus} />}
            <Badge variant="secondary" className="text-xs">{linkSubs.length} submission</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-sm">
            {link.vendorName && (
              <div className="flex items-center gap-1.5 text-slate-600">
                <Building2 className="h-3.5 w-3.5 text-slate-400" />
                <span>{link.vendorName}</span>
              </div>
            )}
            {link.orderNumber && (
              <div className="flex items-center gap-1.5 text-slate-600">
                <Package className="h-3.5 w-3.5 text-slate-400" />
                <span>Order: {link.orderNumber}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-slate-600">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              <span>Dibuat {new Date(link.createdAt).toLocaleDateString("id-ID")}</span>
            </div>
            {link.expiresAt && (
              <div className={`flex items-center gap-1.5 ${expired ? "text-red-500" : "text-slate-600"}`}>
                <CalendarDays className="h-3.5 w-3.5" />
                <span>{expired ? "⚠️ Kadaluarsa " : "Berakhir "}{new Date(link.expiresAt).toLocaleDateString("id-ID")}</span>
              </div>
            )}
          </div>

          {/* URL + actions */}
          <div className="mt-3 flex items-center gap-1">
            <span className="font-mono text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded flex-1 truncate">{formUrl}</span>
            <CopyBtn text={formUrl} label="Salin URL form" />
            <a href={formUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="h-3.5 w-3.5" /></Button>
            </a>
            <WaTemplateDialog
              type="vendor_quotation"
              config={{
                vendorName: link.vendorName,
                serviceType: link.serviceType,
                orderNumber: link.orderNumber,
                formLink: formUrl,
                expiresAt: link.expiresAt,
              }}
              onSend={handleSendWa}
              trigger={
                <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" title="Kirim WA ke vendor">
                  <MessageCircle className="h-3.5 w-3.5" />
                </Button>
              }
            />
          </div>

          {link.notes && (
            <div className="mt-2 bg-white border rounded-md px-3 py-2 text-sm text-slate-600">
              <span className="text-xs text-slate-400 block mb-0.5 font-medium uppercase tracking-wide">Instruksi untuk vendor</span>
              {link.notes}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {linkSubs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
              <Eye className="h-10 w-10 opacity-20" />
              <p className="text-sm">Belum ada submission untuk link ini.</p>
            </div>
          ) : (
            linkSubs.map((sub, idx) => (
              <SubmissionCard
                key={sub.id} sub={sub} idx={idx}
                showDetail={expandedIds.has(sub.id)}
                onDelete={onDeleteSubmission}
                onSelect={onSelectSubmission}
                onToggleDetail={toggleDetail}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Form Preview Sheet ────────────────────────────────────────────────────────

const EMPTY_TEMPLATE_VALUES: DynamicFormValues = {
  customFieldValues: {},
  uploadedDocuments: [],
  checklistStatus: {},
  packagingNotes: "",
  conditionalFlags: {},
};

function FormPreviewSheet({
  template, open, onOpenChange,
}: {
  template: ProductTemplate | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [values, setValues] = useState<DynamicFormValues>(EMPTY_TEMPLATE_VALUES);

  useEffect(() => {
    if (open) setValues(EMPTY_TEMPLATE_VALUES);
  }, [open, template]);

  if (!template) return null;
  const emoji = COMMODITY_EMOJIS[template.category] ?? "📦";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col p-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-5 pb-4 shrink-0 border-b bg-gradient-to-r from-violet-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-xl shrink-0">
              {emoji}
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base">Preview Form — {template.label}</SheetTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                Simulasi interaktif tampilan form vendor · data tidak tersimpan
              </p>
            </div>
            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
              👁️ PREVIEW
            </span>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
              {template.customFields.length} custom field
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
              {template.requiredDocuments.filter(d => d.required).length} dokumen wajib
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              {template.checklist.length} checklist
            </span>
          </div>
        </SheetHeader>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto">
          {/* Mock vendor form — mirrors admin-mini-form layout */}
          <div className="bg-slate-50 min-h-full p-5 space-y-4">
            {/* Form header card */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-3xl leading-none">{emoji}</span>
                <div>
                  <Link href="/purchase/vendors"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

                  <h1 className="text-lg font-bold text-slate-800">Form Template — {template.label}</h1>
                  <p className="text-sm text-slate-500">Untuk: [Nama Vendor]</p>
                </div>
              </div>
              <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 px-3 py-1.5 rounded-lg">
                🔐 Form Internal — hanya untuk penggunaan staf
              </div>
              <div className="mt-3 text-sm text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                Komoditas: {template.label} — mohon isi form sesuai spesifikasi komoditas ini.
              </div>
            </div>

            {/* Identity section */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Data Pengisi</h2>
              <div className="space-y-3">
                {[
                  { label: "Nama Lengkap", placeholder: "Nama Anda", required: true },
                  { label: "Jabatan / Divisi", placeholder: "Contoh: Staff Operasional, Manager Logistik" },
                  { label: "Nomor HP / WhatsApp", placeholder: "Contoh: 0812xxxx" },
                ].map(f => (
                  <div key={f.label}>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      type="text"
                      placeholder={f.placeholder}
                      disabled
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400 cursor-not-allowed"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Template custom fields — INTERACTIVE */}
            {template.customFields.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
                  {emoji} Spesifikasi {template.label}
                </h2>
                <TemplateFieldRenderer
                  template={template}
                  values={values}
                  onChange={setValues}
                />
              </div>
            )}

            {/* Documents */}
            {template.requiredDocuments.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
                  📎 Dokumen
                </h2>
                <TemplateDocumentRenderer
                  documents={template.requiredDocuments}
                  values={values.uploadedDocuments}
                  onChange={docs => setValues(v => ({ ...v, uploadedDocuments: docs }))}
                />
              </div>
            )}

            {/* Checklist */}
            {template.checklist.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <TemplateChecklistRenderer
                  checklist={template.checklist}
                  values={values.checklistStatus}
                  onChange={(key, checked) =>
                    setValues(v => ({ ...v, checklistStatus: { ...v.checklistStatus, [key]: checked } }))
                  }
                />
              </div>
            )}

            {/* Packaging instructions */}
            {template.packagingInstructions && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <TemplateInstructionRenderer
                  instructions={template.packagingInstructions}
                  notes={values.packagingNotes}
                  onNotesChange={notes => setValues(v => ({ ...v, packagingNotes: notes }))}
                />
              </div>
            )}

            {/* Submit button (disabled) */}
            <button
              disabled
              className="w-full rounded-xl bg-violet-300 text-white font-semibold py-3.5 text-sm cursor-not-allowed"
            >
              ✉️ Kirim Data
            </button>
            <p className="text-center text-xs text-slate-400 pb-4">
              Mode preview — form tidak dapat disubmit
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Create Link From Template Dialog ─────────────────────────────────────────

function CreateLinkFromTemplateDialog({
  template, open, onOpenChange, suppliers, onCreated,
}: {
  template: ProductTemplate | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suppliers: Supplier[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serviceType, setServiceType] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (template && open) {
      setTitle(`Form Template — ${template.label}`);
      setNotes(`Komoditas: ${template.label}\n\nMohon isi form sesuai spesifikasi komoditas ${template.label}.`);
    }
  }, [template, open]);

  const reset = () => {
    setServiceType(""); setSupplierId(""); setVendorName("");
    setTitle(""); setNotes(""); setExpiresInDays("7"); setLoading(false);
  };

  const handleCreate = async () => {
    if (!serviceType) { toast({ title: "Pilih service type dulu", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await apiFetch("/api/vendor-form/admin/links", {
        method: "POST",
        body: JSON.stringify({
          serviceType,
          supplierId: supplierId ? Number(supplierId) : undefined,
          vendorName: vendorName.trim() || undefined,
          title: title.trim() || undefined,
          notes: notes.trim() || undefined,
          expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
          mode: "rate_collection",
          adminNotes: `productCategory:${template?.category ?? "general"}`,
        }),
      });
      toast({ title: "Link berhasil dibuat", description: `Template ${template?.label} akan muncul di form.` });
      queryClient.invalidateQueries({ queryKey: ["vmf-links"] });
      onCreated();
      onOpenChange(false);
      reset();
    } catch (e: unknown) {
      toast({ title: "Gagal membuat link", description: (e as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  if (!template) return null;
  const emoji = COMMODITY_EMOJIS[template.category] ?? "📦";

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">{emoji}</span>
            Buat Form Link — {template.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
            <Layers className="h-4 w-4 text-indigo-600 shrink-0" />
            <p className="text-xs text-indigo-700">
              Link ini akan menyertakan template komoditas <strong>{template.label}</strong> — vendor akan melihat {template.customFields.length} custom field, {template.requiredDocuments.filter(d => d.required).length} dokumen wajib, dan {template.checklist.length} checklist.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Jenis Layanan <span className="text-red-500">*</span></Label>
            <Select value={serviceType} onValueChange={setServiceType}>
              <SelectTrigger><SelectValue placeholder="Pilih layanan logistik" /></SelectTrigger>
              <SelectContent>
                {SERVICE_TYPES_ONLY.map(k => (
                  <SelectItem key={k} value={k}>{SERVICE_META[k]!.emoji} {SERVICE_META[k]!.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Vendor (opsional)</Label>
            <Select value={supplierId || "__none__"} onValueChange={v => setSupplierId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Tidak spesifik" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tidak spesifik —</SelectItem>
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Nama Vendor (manual)</Label>
            <Input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Jika tidak ada di daftar" />
          </div>

          <div className="space-y-1.5">
            <Label>Judul Form</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Instruksi untuk Vendor</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
          </div>

          <div className="space-y-1.5">
            <Label>Kadaluarsa (hari)</Label>
            <Input type="number" value={expiresInDays} onChange={e => setExpiresInDays(e.target.value)} placeholder="7" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }}>Batal</Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Buat Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Product Template Engine ───────────────────────────────────────────────────

const COMMODITY_EMOJIS: Record<string, string> = {
  coal: "⛏️", iron_steel: "🔩", coffee: "☕", electronics: "💻",
  palm_oil: "🌴", nickel: "⚙️", copper: "🔶", rice: "🌾",
  sugar: "🍬", rubber: "🧤", cocoa: "🍫", timber: "🪵",
  fertilizer: "🌱", cement: "🏗️", textile: "🧵", medical_device: "💊",
  general: "📦",
};

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Teks", number: "Angka", select: "Pilihan", textarea: "Teks Panjang", date: "Tanggal",
};

function TemplateDetailSheet({
  template, open, onOpenChange,
}: {
  template: ProductTemplate | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [section, setSection] = useState<"fields" | "docs" | "checklist" | "packaging">("fields");

  if (!template) return null;
  const emoji = COMMODITY_EMOJIS[template.category] ?? "📦";
  const reqDocs = template.requiredDocuments.filter(d => d.required);
  const optDocs = template.requiredDocuments.filter(d => !d.required);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col p-0" side="right">
        <SheetHeader className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-slate-50 to-indigo-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-xl">
              {emoji}
            </div>
            <div>
              <SheetTitle className="text-lg">{template.label}</SheetTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                Kategori: <span className="font-mono text-indigo-600">{template.category}</span>
                {" · "}v{template.version}
              </p>
            </div>
          </div>
          {/* Section pills */}
          <div className="flex gap-1.5 flex-wrap mt-3">
            {(["fields", "docs", "checklist", "packaging"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                  section === s
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"
                }`}
              >
                {s === "fields" ? `📋 ${template.customFields.length} Custom Fields` :
                 s === "docs" ? `📎 ${template.requiredDocuments.length} Dokumen` :
                 s === "checklist" ? `✅ ${template.checklist.length} Checklist` :
                 "📦 Pengemasan"}
              </button>
            ))}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* CUSTOM FIELDS */}
          {section === "fields" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Custom Fields — ditampilkan di form vendor</p>
              {template.customFields.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Tidak ada custom field</p>
              ) : template.customFields.map(f => {
                const isConditional = template.conditionalRules.some(r => r.show.includes(f.key));
                return (
                  <div key={f.key} className={`border rounded-lg p-3.5 ${f.required ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-slate-800">{f.label}</span>
                          {f.required && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200">WAJIB</span>
                          )}
                          {isConditional && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-0.5">
                              <Info className="h-2.5 w-2.5" /> Kondisional
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">key: {f.key}</p>
                        {f.placeholder && <p className="text-xs text-slate-500 mt-1">Placeholder: {f.placeholder}</p>}
                        {f.options && f.options.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {f.options.map(o => (
                              <span key={o} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">{o}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${
                        f.type === "number" ? "bg-green-100 text-green-700" :
                        f.type === "select" ? "bg-purple-100 text-purple-700" :
                        f.type === "textarea" ? "bg-orange-100 text-orange-700" :
                        f.type === "date" ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-600"
                      }`}>
                        {FIELD_TYPE_LABELS[f.type] ?? f.type}
                      </span>
                    </div>
                  </div>
                );
              })}
              {template.conditionalRules.length > 0 && (
                <div className="mt-3 border border-amber-200 bg-amber-50 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1">
                    <Info className="h-3.5 w-3.5" /> Aturan Kondisional
                  </p>
                  {template.conditionalRules.map((r, i) => (
                    <p key={i} className="text-xs text-amber-700">
                      Jika <span className="font-mono bg-amber-100 px-1 rounded">{r.fieldKey}</span> = <span className="font-mono bg-amber-100 px-1 rounded">"{r.condition.value}"</span>, tampilkan: {r.show.join(", ")}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* DOCUMENTS */}
          {section === "docs" && (
            <div className="space-y-3">
              {reqDocs.length > 0 && (
                <>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Dokumen Wajib</p>
                  {reqDocs.map(d => (
                    <div key={d.key} className="flex items-center gap-3 border border-red-200 bg-red-50/40 rounded-lg p-3">
                      <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800">{d.label}</p>
                        <p className="text-xs text-slate-400 font-mono">key: {d.key}</p>
                      </div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 shrink-0">WAJIB</span>
                    </div>
                  ))}
                </>
              )}
              {optDocs.length > 0 && (
                <>
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mt-2">Dokumen Opsional</p>
                  {optDocs.map(d => (
                    <div key={d.key} className="flex items-center gap-3 border border-slate-200 bg-white rounded-lg p-3">
                      <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700">{d.label}</p>
                        <p className="text-xs text-slate-400 font-mono">key: {d.key}</p>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 shrink-0">Opsional</span>
                    </div>
                  ))}
                </>
              )}
              {template.requiredDocuments.length === 0 && (
                <p className="text-sm text-slate-400 italic">Tidak ada dokumen yang dikonfigurasi</p>
              )}
            </div>
          )}

          {/* CHECKLIST */}
          {section === "checklist" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Checklist Operasional</p>
              {template.checklist.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Tidak ada checklist</p>
              ) : template.checklist.map(c => (
                <div key={c.key} className="flex items-center gap-3 border border-slate-200 bg-white rounded-lg p-3 hover:bg-slate-50 transition-colors">
                  <div className="w-4 h-4 rounded border-2 border-slate-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800">{c.label}</p>
                    <p className="text-xs text-slate-400 font-mono">key: {c.key}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PACKAGING */}
          {section === "packaging" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Instruksi Pengemasan & Pengiriman</p>
              <div className="border border-emerald-200 bg-emerald-50/40 rounded-xl p-4">
                <div className="flex items-start gap-2 mb-2">
                  <PackageCheck className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <p className="text-xs font-semibold text-emerald-700">Panduan untuk Vendor</p>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{template.packagingInstructions}</p>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProductTemplateEngine() {
  const [search, setSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<ProductTemplate | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [linkTemplate, setLinkTemplate] = useState<ProductTemplate | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<ProductTemplate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { companyQueryParam } = useCompany();

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers-simple", companyQueryParam],
    queryFn: () => apiFetch<Supplier[]>(`/api/trading/suppliers?${companyQueryParam}`),
  });

  const allTemplates = Object.values(inCodeTemplates);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTemplates;
    return allTemplates.filter(t =>
      t.label.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  }, [search, allTemplates]);

  const openDetail = (t: ProductTemplate) => {
    setSelectedTemplate(t);
    setSheetOpen(true);
  };

  const openLinkDialog = (e: React.MouseEvent, t: ProductTemplate) => {
    e.stopPropagation();
    setLinkTemplate(t);
    setLinkDialogOpen(true);
  };

  const openPreview = (e: React.MouseEvent, t: ProductTemplate) => {
    e.stopPropagation();
    setPreviewTemplate(t);
    setPreviewOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* Header banner */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 p-5 text-white">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Layers className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-lg">Product Template Engine</h2>
            <p className="text-sm text-indigo-100 mt-0.5">
              Template komoditas multi-jenis untuk trading — custom fields, checklist, dan dokumen otomatis
              disesuaikan dengan jenis barang pada order.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {[
            { label: "Template Komoditas", value: allTemplates.length },
            { label: "Total Custom Fields", value: allTemplates.reduce((s, t) => s + t.customFields.length, 0) },
            { label: "Total Dokumen Terkonfigurasi", value: allTemplates.reduce((s, t) => s + t.requiredDocuments.length, 0) },
          ].map(s => (
            <div key={s.label} className="bg-white/15 rounded-lg p-3 text-center">
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-xs text-indigo-100 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Cari komoditas..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9 text-sm"
        />
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(t => {
          const emoji = COMMODITY_EMOJIS[t.category] ?? "📦";
          const reqDocs = t.requiredDocuments.filter(d => d.required).length;
          return (
            <div
              key={t.category}
              className="border border-slate-200 bg-white rounded-xl p-4 hover:border-indigo-300 hover:shadow-md transition-all group"
            >
              <button
                className="w-full text-left"
                onClick={() => openDetail(t)}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-center text-xl shrink-0 group-hover:bg-indigo-50 group-hover:border-indigo-200 transition-colors">
                    {emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm group-hover:text-indigo-700 transition-colors">{t.label}</p>
                    <p className="text-xs text-slate-400 font-mono">{t.category}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 shrink-0 mt-0.5 transition-colors" />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-50 rounded-lg p-2">
                    <p className="text-sm font-bold text-indigo-700">{t.customFields.length}</p>
                    <p className="text-[10px] text-slate-500">Fields</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <p className={`text-sm font-bold ${reqDocs > 0 ? "text-red-600" : "text-slate-400"}`}>{reqDocs}</p>
                    <p className="text-[10px] text-slate-500">Dok Wajib</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <p className="text-sm font-bold text-emerald-600">{t.checklist.length}</p>
                    <p className="text-[10px] text-slate-500">Checklist</p>
                  </div>
                </div>

                {t.requiredDocuments.filter(d => d.required).slice(0, 2).map(d => (
                  <div key={d.key} className="flex items-center gap-1.5 mt-2 text-xs text-slate-500">
                    <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
                    <span className="truncate">{d.label}</span>
                  </div>
                ))}
                {t.requiredDocuments.filter(d => d.required).length > 2 && (
                  <p className="text-xs text-slate-400 mt-1">+{t.requiredDocuments.filter(d => d.required).length - 2} dokumen wajib lainnya</p>
                )}
              </button>

              <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7 text-xs gap-1 text-slate-600 border-slate-200 hover:bg-slate-50"
                  onClick={e => openPreview(e, t)}
                >
                  <Eye className="h-3 w-3" />
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7 text-xs gap-1 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                  onClick={e => openLinkDialog(e, t)}
                >
                  <Plus className="h-3 w-3" />
                  Buat Link
                </Button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-400">
            <Layers className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Tidak ada template yang cocok dengan pencarian</p>
          </div>
        )}
      </div>

      <TemplateDetailSheet
        template={selectedTemplate}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
      <FormPreviewSheet
        template={previewTemplate}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
      <CreateLinkFromTemplateDialog
        template={linkTemplate}
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        suppliers={suppliers}
        onCreated={() => {}}
      />
    </div>
  );
}

// ── Create Invoice Dialog ─────────────────────────────────────────────────────

function CreateInvoiceDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [grandTotal, setGrandTotal] = useState("");
  const [taxRate, setTaxRate] = useState("11");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const mut = useMutation({
    mutationFn: () => apiFetch("/api/vendor-form/admin/customer-invoices", {
      method: "POST",
      body: JSON.stringify({
        orderId: orderId ? Number(orderId) : undefined,
        orderNumber: orderNumber || undefined,
        invoiceNumber: invoiceNumber || undefined,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        manualGrandTotal: grandTotal ? Number(grandTotal) : undefined,
        manualTaxRate: taxRate ? Number(taxRate) : 11,
        dueDate: dueDate || undefined,
        notes: notes || undefined,
      }),
    }),
    onSuccess: () => {
      toast({ title: "Invoice berhasil dibuat!" });
      setOpen(false);
      setOrderId(""); setOrderNumber(""); setInvoiceNumber(""); setCustomerName("");
      setCustomerPhone(""); setGrandTotal(""); setDueDate(""); setNotes("");
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Gagal buat invoice", description: e.message, variant: "destructive" }),
  });

  const suggestInvNum = () => {
    const yr = new Date().getFullYear();
    const num = String(Math.floor(Math.random() * 900000) + 100000);
    setInvoiceNumber(`INV/${yr}/${num}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Buat Invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Buat Invoice Customer</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">No. Invoice <span className="text-red-500">*</span></Label>
              <div className="flex gap-1.5">
                <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                  placeholder="INV/2025/..." className="h-9 text-sm" />
                <Button type="button" variant="outline" size="sm" className="h-9 px-2 shrink-0"
                  onClick={suggestInvNum} title="Generate otomatis">✨</Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">No. Order</Label>
              <Input value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
                placeholder="LOG/2025/..." className="h-9 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">ID Order <span className="text-slate-400 font-normal">(opsional, untuk link ke order)</span></Label>
              <Input value={orderId} onChange={e => setOrderId(e.target.value)}
                placeholder="ID angka order" type="number" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nama Customer</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)}
                placeholder="PT. Contoh" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">WA Customer</Label>
              <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                placeholder="628xxxxxxx" className="h-9 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Grand Total (IDR)</Label>
              <Input type="number" value={grandTotal} onChange={e => setGrandTotal(e.target.value)}
                placeholder="0" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">PPN (%)</Label>
              <Input type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)}
                placeholder="11" className="h-9 text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Jatuh Tempo</Label>
            <DatePicker value={dueDate} onChange={v => setDueDate(v)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Catatan</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Instruksi pembayaran, rekening bank, dll." rows={2}
              className="text-sm resize-none" />
          </div>
          {customerPhone && (
            <p className="text-xs text-green-600">✓ WA invoice akan dikirim otomatis ke {customerPhone}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !invoiceNumber.trim()}>
            {mut.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Membuat...</>
              : "Buat Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Confirm Payment Dialog ────────────────────────────────────────────────────

function ConfirmPaymentDialog({ invoice, onConfirmed }: { invoice: CustomerInvoice; onConfirmed: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amountPaid, setAmountPaid] = useState(String(Number(invoice.grandTotal ?? 0)));
  const [paymentMethod, setPaymentMethod] = useState("Transfer Bank");
  const [notes, setNotes] = useState("");

  const mut = useMutation({
    mutationFn: () => apiFetch(`/api/vendor-form/admin/customer-invoices/${invoice.id}/confirm-payment`, {
      method: "POST",
      body: JSON.stringify({
        amountPaid: amountPaid ? Number(amountPaid) : undefined,
        paymentMethod: paymentMethod || undefined,
        notes: notes || undefined,
      }),
    }),
    onSuccess: () => {
      toast({ title: "Pembayaran dikonfirmasi!" });
      setOpen(false);
      onConfirmed();
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"
          className="h-7 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50">
          <DollarSign className="h-3.5 w-3.5" />
          Konfirmasi Bayar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Konfirmasi Pembayaran</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="bg-slate-50 rounded-lg px-3 py-2 text-sm">
            <p className="text-slate-500 text-xs">Invoice</p>
            <p className="font-semibold text-slate-800">{invoice.invoiceNumber ?? `#${invoice.id}`}</p>
            <p className="text-xs text-slate-400">
              {invoice.orderNumber ?? ""}{invoice.orderNumber && invoice.customerName ? " • " : ""}{invoice.customerName ?? ""}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Jumlah Dibayar (IDR)</Label>
            <Input type="number" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
              className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Metode Pembayaran</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Transfer Bank">Transfer Bank</SelectItem>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Cek/Giro">Cek/Giro</SelectItem>
                <SelectItem value="Virtual Account">Virtual Account</SelectItem>
                <SelectItem value="QRIS">QRIS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Catatan (opsional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} className="text-sm resize-none" placeholder="No. bukti transfer, dll." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Konfirmasi...</>
              : "✅ Konfirmasi Pembayaran"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VendorFormsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { companyQueryParam } = useCompany();

  const [tab, setTab] = useState("links");
  const [selectedLink, setSelectedLink] = useState<FormLink | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [compareLink, setCompareLink] = useState<FormLink | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [searchLinks, setSearchLinks] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [filterCategoryKey, setFilterCategoryKey] = useState("all");
  const [approvalSearch, setApprovalSearch] = useState("");
  const [approvalStatusFilter, setApprovalStatusFilter] = useState("all");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [deleteLinkTarget, setDeleteLinkTarget] = useState<FormLink | null>(null);
  const [selectSubTarget, setSelectSubTarget] = useState<Submission | null>(null);
  const [deleteSubTarget, setDeleteSubTarget] = useState<Submission | null>(null);
  const [markCompleteTarget, setMarkCompleteTarget] = useState<CustomerInvoice | null>(null);
  const [markCompleting, setMarkCompleting] = useState(false);

  // ── Queries ──
  const { data: links = [], isLoading: linksLoading } = useQuery<FormLink[]>({
    queryKey: ["vmf-links"],
    queryFn: () => apiFetch<FormLink[]>("/api/vendor-form/admin/links"),
    refetchInterval: 30_000,
  });
  const { data: submissions = [], isLoading: subsLoading } = useQuery<Submission[]>({
    queryKey: ["vmf-submissions"],
    queryFn: () => apiFetch<Submission[]>("/api/vendor-form/admin/submissions"),
    refetchInterval: 30_000,
  });
  const { data: approvals = [], isLoading: approvalsLoading } = useQuery<CustomerApproval[]>({
    queryKey: ["vmf-approvals"],
    queryFn: () => apiFetch<CustomerApproval[]>("/api/vendor-form/admin/customer-approvals"),
    refetchInterval: 30_000,
  });
  const filteredApprovals = useMemo(() => {
    const q = approvalSearch.trim().toLowerCase();
    return approvals.filter(a => {
      if (approvalStatusFilter !== "all" && a.status !== approvalStatusFilter) return false;
      if (!q) return true;
      return (
        a.customerName?.toLowerCase().includes(q) ||
        a.orderNumber?.toLowerCase().includes(q) ||
        a.customerPhone?.toLowerCase().includes(q) ||
        a.soNumber?.toLowerCase().includes(q)
      );
    });
  }, [approvals, approvalSearch, approvalStatusFilter]);

  const approvalStats = useMemo(() => {
    const approved = approvals.filter(a => a.status === "approved");
    const totalRevenue = approved.reduce((s, a) => s + Number(a.sellingPrice ?? 0), 0);
    const totalCost    = approved.reduce((s, a) => s + Number(a.vendorCost ?? 0), 0);
    const totalProfit  = totalRevenue - totalCost;
    const marginPct    = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : null;
    const pending      = approvals.filter(a => a.status === "pending").length;
    return { count: approved.length, pending, totalRevenue, totalCost, totalProfit, marginPct };
  }, [approvals]);

  // Hitung per-order: total vendor diundang vs sudah submit (order_based active links)
  const orderVendorProgress = useMemo(() => {
    const stats: Record<number, { total: number; submitted: number; orderNumber: string | null }> = {};
    for (const link of links) {
      if (link.mode === "order_based" && link.orderId && link.isActive) {
        if (!stats[link.orderId]) stats[link.orderId] = { total: 0, submitted: 0, orderNumber: link.orderNumber };
        stats[link.orderId].total++;
        const doneStatuses = ["vendor_submitted", "admin_review", "waiting_customer", "customer_approved"];
        if (link.itemStatus && doneStatuses.includes(link.itemStatus)) {
          stats[link.orderId].submitted++;
        }
      }
    }
    return stats;
  }, [links]);

  // Map linkId → link untuk lookup cepat di tabel submissions
  const linkMap = useMemo(() => Object.fromEntries(links.map(l => [l.id, l])), [links]);

  const { data: opConfirms = [], isLoading: opLoading } = useQuery<OpConfirm[]>({
    queryKey: ["vmf-op-confirms"],
    queryFn: () => apiFetch<OpConfirm[]>("/api/vendor-form/admin/op-confirms"),
    refetchInterval: 30_000,
  });
  const { data: activityLogs = [], isLoading: actLoading } = useQuery<ActivityLog[]>({
    queryKey: ["vmf-activity-log"],
    queryFn: () => apiFetch<ActivityLog[]>("/api/vendor-form/admin/activity-log"),
    enabled: tab === "activity-log",
    refetchInterval: tab === "activity-log" ? 20_000 : false,
  });
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<CustomerInvoice[]>({
    queryKey: ["vmf-invoices"],
    queryFn: () => apiFetch<CustomerInvoice[]>("/api/vendor-form/admin/customer-invoices"),
    refetchInterval: tab === "invoices" ? 20_000 : false,
  });
  const filteredInvoices = useMemo(() => {
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(inv =>
      inv.invoiceNumber?.toLowerCase().includes(q) ||
      inv.customerName?.toLowerCase().includes(q) ||
      inv.orderNumber?.toLowerCase().includes(q) ||
      inv.customerPhone?.toLowerCase().includes(q)
    );
  }, [invoices, invoiceSearch]);
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["suppliers-simple", companyQueryParam],
    queryFn: () => apiFetch<Supplier[]>(`/api/trading/suppliers?${companyQueryParam}`),
  });

  // ── Mutations ──
  const toggleLinkMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/api/vendor-form/admin/links/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vmf-links"] }),
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteLinkMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/vendor-form/admin/links/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vmf-links"] });
      setSheetOpen(false);
    },
    onError: (e: Error) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  const deleteSubMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/vendor-form/admin/submissions/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vmf-submissions"] }),
    onError: (e: Error) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  const selectSubMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/vendor-form/admin/submissions/${id}/select`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vmf-submissions"] });
      queryClient.invalidateQueries({ queryKey: ["vmf-links"] });
      toast({ title: "Vendor berhasil dipilih!" });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const genShortLinkMut = useMutation({
    mutationFn: (id: number) => apiFetch<{ shortUrl: string }>(`/api/vendor-form/admin/links/${id}/short-link`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vmf-links"] }),
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const cloneLinkMut = useMutation({
    mutationFn: (id: number) => apiFetch<{ id: number; token: string }>(`/api/vendor-form/admin/links/${id}/clone`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vmf-links"] });
      toast({ title: "Link berhasil diklon!", description: "Link baru sudah dibuat dengan konfigurasi yang sama." });
    },
    onError: (e: Error) => toast({ title: "Gagal klon link", description: e.message, variant: "destructive" }),
  });

  const retrySoMut = useMutation({
    mutationFn: (id: number) => apiFetch<{ ok: boolean; docNumber: string; already?: boolean }>(`/api/vendor-form/admin/customer-approvals/${id}/retry-so`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["vmf-approvals"] });
      toast({ title: data.already ? "SO sudah ada" : "Sales Order berhasil dibuat", description: data.docNumber });
    },
    onError: (e: Error) => toast({ title: "Gagal buat SO", description: e.message, variant: "destructive" }),
  });

  // ── Filtered links ──
  const activeCategoryKeys = useMemo(() => {
    const keys = new Set(links.map(l => l.categoryKey).filter(Boolean) as string[]);
    return Array.from(keys).sort((a, b) =>
      (inCodeTemplates[a]?.label ?? a).localeCompare(inCodeTemplates[b]?.label ?? b, "id")
    );
  }, [links]);

  const filteredLinks = useMemo(() => {
    let list = links;
    if (filterMode !== "all") list = list.filter(l => l.mode === filterMode);
    if (filterCategoryKey !== "all") {
      if (filterCategoryKey === "__none__") {
        list = list.filter(l => !l.categoryKey);
      } else {
        list = list.filter(l => l.categoryKey === filterCategoryKey);
      }
    }
    if (searchLinks.trim()) {
      const q = searchLinks.toLowerCase();
      list = list.filter(l =>
        l.title?.toLowerCase().includes(q) ||
        l.vendorName?.toLowerCase().includes(q) ||
        l.serviceType.toLowerCase().includes(q) ||
        l.orderNumber?.toLowerCase().includes(q) ||
        l.token.includes(q)
      );
    }
    return list;
  }, [links, filterMode, filterCategoryKey, searchLinks]);

  const rateCollectionLinks = links.filter(l => l.mode === "rate_collection");
  const orderBasedLinks = links.filter(l => l.mode === "order_based");
  const pendingVendorLinks = orderBasedLinks.filter(l => l.itemStatus === "waiting_vendor");
  const submittedLinks = orderBasedLinks.filter(l => l.itemStatus === "vendor_submitted");

  const openLinkSheet = (link: FormLink) => { setSelectedLink(link); setSheetOpen(true); };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Vendor Mini Forms</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Kelola form penawaran vendor — Rate Collection & Order-Based
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Link", value: links.length, icon: Link2, color: "text-blue-600" },
            { label: "Menunggu Vendor", value: pendingVendorLinks.length, icon: Clock, color: "text-yellow-600" },
            { label: "Total Submission", value: submissions.length, icon: FileText, color: "text-indigo-600" },
            { label: "Customer Approval", value: approvals.length, icon: CheckCircle, color: "text-green-600" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="flex items-center gap-3 pt-4">
                <s.icon className={`h-6 w-6 ${s.color}`} />
                <div>
                  <p className="text-xl font-bold text-slate-800">{s.value}</p>
                  <p className="text-xs text-slate-500">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList className="gap-1 w-max">
              <TabsTrigger value="links">🔗 Links ({links.length})</TabsTrigger>
              <TabsTrigger value="submissions">📝 Submissions ({submissions.length})</TabsTrigger>
              <TabsTrigger value="approvals">✅ Customer Approval ({approvals.length})</TabsTrigger>
              <TabsTrigger value="op-confirms">🚚 Konfirmasi Operasional ({opConfirms.length})</TabsTrigger>
              <TabsTrigger value="invoices">🧾 Invoice ({invoices.length})</TabsTrigger>
              <TabsTrigger value="media-report">📷 Media Submission ({submissions.filter(s => s.mediaAssets && s.mediaAssets.length > 0).length})</TabsTrigger>
              <TabsTrigger value="product-templates">🏭 Product Templates</TabsTrigger>
              <TabsTrigger value="activity-log">📋 Log Aktivitas</TabsTrigger>
            </TabsList>
          </div>

          {/* ── LINKS TAB ── */}
          <TabsContent value="links" className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Input
                placeholder="Cari judul, vendor, order, token..."
                className="max-w-xs h-9 text-sm"
                value={searchLinks}
                onChange={e => setSearchLinks(e.target.value)}
              />
              <Select value={filterMode} onValueChange={setFilterMode}>
                <SelectTrigger className="w-44 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Mode</SelectItem>
                  <SelectItem value="rate_collection">📊 Rate Collection</SelectItem>
                  <SelectItem value="order_based">📦 Order-Based</SelectItem>
                </SelectContent>
              </Select>
              {activeCategoryKeys.length > 0 && (
                <Select value={filterCategoryKey} onValueChange={setFilterCategoryKey}>
                  <SelectTrigger className="w-48 h-9 text-sm"><SelectValue placeholder="Semua Komoditas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">📦 Semua Komoditas</SelectItem>
                    <SelectItem value="__none__">— Tanpa template —</SelectItem>
                    {activeCategoryKeys.map(k => (
                      <SelectItem key={k} value={k}>
                        {inCodeTemplates[k]?.label ?? k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="ml-auto">
                <CreateLinkDialog onCreated={() => queryClient.invalidateQueries({ queryKey: ["vmf-links"] })} />
              </div>
            </div>

            <QueryState loading={linksLoading} empty={filteredLinks.length === 0} emptyMessage='Belum ada link. Klik "Buat Link Form" untuk mulai.' skeletonRows={3}>
              <Card>
                <CardContent className="p-0">
                  <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Form / Vendor</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Submission</TableHead>
                        <TableHead>Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLinks.map(link => {
                        const meta = SERVICE_META[link.serviceType];
                        const expired = link.expiresAt && new Date(link.expiresAt) < new Date();
                        const linkSubs = submissions.filter(s => s.linkId === link.id);
                        const formUrl = link.shortUrl ?? buildFormUrl(link.token);
                        return (
                          <TableRow key={link.id} className="hover:bg-slate-50">
                            <TableCell>
                              <button className="text-left" onClick={() => openLinkSheet(link)}>
                                <p className="font-medium text-slate-800 text-sm hover:text-indigo-600">
                                  {link.title ?? `Form ${meta?.label ?? link.serviceType}`}
                                </p>
                                {link.vendorName && <p className="text-xs text-slate-500">{link.vendorName}</p>}
                                {link.orderNumber && <p className="text-xs text-blue-600">📦 {link.orderNumber}</p>}
                                <p className="text-xs font-mono text-slate-400">{link.token.slice(0, 12)}…</p>
                              </button>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-slate-600">
                                {link.mode === "order_based" ? "📦 Order" : "📊 Rate"}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm">{meta?.emoji} {meta?.label ?? link.serviceType}</span>
                              {link.mode === "order_based" && (
                                <div className="mt-0.5"><ItemStatusBadge status={link.itemStatus} /></div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => toggleLinkMut.mutate({ id: link.id, isActive: !link.isActive })}>
                                  {link.isActive && !expired
                                    ? <ToggleRight className="h-5 w-5 text-green-500" />
                                    : <ToggleLeft className="h-5 w-5 text-slate-400" />}
                                </button>
                                <span className="text-xs text-slate-500">{link.isActive && !expired ? "Aktif" : "Nonaktif"}</span>
                              </div>
                              {!link.isActive && link.adminNotes?.includes("[auto-replaced]") && (
                                <span className="inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                                  ↩ Digantikan
                                </span>
                              )}
                              {link.expiresAt && (
                                <p className={`text-xs mt-0.5 ${expired ? "text-red-500" : "text-slate-400"}`}>
                                  {expired ? "⚠️ " : ""}{new Date(link.expiresAt).toLocaleDateString("id-ID")}
                                </p>
                              )}
                            </TableCell>
                            <TableCell>
                              {link.mode === "order_based" && link.orderId && orderVendorProgress[link.orderId] ? (() => {
                                const stat = orderVendorProgress[link.orderId!]!;
                                const allDone = stat.submitted >= stat.total && stat.total > 0;
                                const readyToCompare = stat.submitted >= 2;
                                return (
                                  <div className="space-y-0.5">
                                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${
                                      allDone ? "bg-green-100 text-green-700 border-green-200" :
                                      stat.submitted > 0 ? "bg-blue-100 text-blue-700 border-blue-200" :
                                      "bg-yellow-50 text-yellow-600 border-yellow-200"
                                    }`}>
                                      {stat.submitted}/{stat.total} vendor
                                    </span>
                                    {readyToCompare && (
                                      <p className="text-[10px] font-medium text-indigo-600">⚖️ Siap dibandingkan!</p>
                                    )}
                                    {linkSubs.some(s => s.selectedByAdmin) && (
                                      <Star className="h-3 w-3 text-green-500 fill-green-500" />
                                    )}
                                  </div>
                                );
                              })() : (
                                <span className="text-sm font-semibold text-slate-700">
                                  {linkSubs.length}
                                  {linkSubs.some(s => s.selectedByAdmin) && <Star className="h-3 w-3 text-green-500 fill-green-500 inline ml-1" />}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-0.5">
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Lihat detail" onClick={() => openLinkSheet(link)}>
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                {linkSubs.length >= 1 && (
                                  <Button
                                    variant="ghost" size="icon"
                                    className="h-7 w-7 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50"
                                    title={`Bandingkan ${linkSubs.length} vendor`}
                                    onClick={() => { setCompareLink(link); setCompareOpen(true); }}
                                  >
                                    <BarChart2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <CopyBtn text={formUrl} />
                                <a href={formUrl} target="_blank" rel="noreferrer">
                                  <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="h-3.5 w-3.5" /></Button>
                                </a>
                                {!link.shortUrl && (
                                  <Button
                                    variant="ghost" size="icon" className="h-7 w-7" title="Buat short link"
                                    onClick={() => genShortLinkMut.mutate(link.id)}
                                    disabled={genShortLinkMut.isPending}
                                  >
                                    <Link2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-blue-400 hover:text-blue-600" title="Klon link (duplikat konfigurasi)"
                                  disabled={cloneLinkMut.isPending}
                                  onClick={() => cloneLinkMut.mutate(link.id)}
                                >
                                  <CopyPlus className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" title="Hapus link"
                                  onClick={() => setDeleteLinkTarget(link)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </QueryState>
          </TabsContent>

          {/* ── SUBMISSIONS TAB ── */}
          <TabsContent value="submissions" className="space-y-4">
            <QueryState loading={subsLoading} empty={submissions.length === 0} emptyMessage="Belum ada submission." skeletonRows={3}>
              <Card>
                <CardContent className="p-0">
                  <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Penawaran</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Status Vendor</TableHead>
                        <TableHead>Dikirim</TableHead>
                        <TableHead>Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {submissions.map(sub => {
                        const meta = SERVICE_META[sub.serviceType];
                        const parentLink = sub.linkId ? linkMap[sub.linkId] : null;
                        const orderId = sub.orderId ?? parentLink?.orderId ?? null;
                        const orderNum = parentLink?.orderNumber ?? null;
                        const stat = orderId ? orderVendorProgress[orderId] : null;
                        return (
                          <TableRow key={sub.id} className={sub.selectedByAdmin ? "bg-green-50" : ""}>
                            <TableCell>
                              <p className="font-medium text-sm">{sub.vendorName ?? "—"}{sub.selectedByAdmin && <Star className="h-3.5 w-3.5 text-green-500 fill-green-500 inline ml-1" />}</p>
                              {sub.contactPerson && <p className="text-xs text-slate-500">{sub.contactPerson}</p>}
                              {sub.contactPhone && <p className="text-xs text-slate-400">{sub.contactPhone}</p>}
                            </TableCell>
                            <TableCell><span className="text-sm">{meta?.emoji} {meta?.label ?? sub.serviceType}</span></TableCell>
                            <TableCell>
                              {sub.vendorPrice ? (
                                <p className="font-semibold text-sm text-indigo-700">{fmtPrice(sub.vendorPrice, sub.currency)}</p>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                              {sub.eta && <p className="text-xs text-slate-500">ETA: {sub.eta}</p>}
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${sub.responseStatus === "selected" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                                {sub.responseStatus ?? "submitted"}
                              </span>
                            </TableCell>
                            <TableCell>
                              {stat ? (
                                <div className="space-y-0.5">
                                  {orderNum && (
                                    <p className="text-xs text-blue-600 font-medium">📦 {orderNum}</p>
                                  )}
                                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${
                                    stat.submitted >= stat.total && stat.total > 0
                                      ? "bg-green-100 text-green-700 border-green-200"
                                      : stat.submitted > 0
                                        ? "bg-blue-100 text-blue-700 border-blue-200"
                                        : "bg-yellow-50 text-yellow-600 border-yellow-200"
                                  }`}>
                                    {stat.submitted}/{stat.total} vendor
                                  </span>
                                  {stat.submitted >= 2 && (
                                    <p className="text-[10px] font-medium text-indigo-600">⚖️ Siap dibandingkan!</p>
                                  )}
                                </div>
                              ) : orderNum ? (
                                <p className="text-xs text-blue-600">📦 {orderNum}</p>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <p className="text-xs text-slate-500">{new Date(sub.submittedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-0.5">
                                {!sub.selectedByAdmin && (
                                  <Button
                                    variant="ghost" size="icon" className="h-7 w-7 text-green-600" title="Pilih vendor ini"
                                    onClick={() => setSelectSubTarget(sub)}
                                  >
                                    <CheckCircle className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600"
                                  onClick={() => setDeleteSubTarget(sub)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </QueryState>
          </TabsContent>

          {/* ── CUSTOMER APPROVAL TAB ── */}
          <TabsContent value="approvals" className="space-y-4">
            <div className="flex justify-end">
              <CreateApprovalDialog onCreated={() => queryClient.invalidateQueries({ queryKey: ["vmf-approvals"] })} />
            </div>

            {/* ── Summary Cards ── */}
            {!approvalsLoading && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="bg-indigo-50 border-indigo-200">
                  <CardContent className="p-4">
                    <p className="text-xs text-indigo-500 font-medium mb-1">Total Revenue</p>
                    <p className="text-lg font-bold text-indigo-700">
                      {approvalStats.totalRevenue.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-indigo-400 mt-0.5">{approvalStats.count} disetujui</p>
                  </CardContent>
                </Card>
                <Card className="bg-slate-50 border-slate-200">
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500 font-medium mb-1">Total Biaya Vendor</p>
                    <p className="text-lg font-bold text-slate-700">
                      {approvalStats.totalCost.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{approvalStats.pending} masih pending</p>
                  </CardContent>
                </Card>
                <Card className={approvalStats.totalProfit >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}>
                  <CardContent className="p-4">
                    <p className={`text-xs font-medium mb-1 ${approvalStats.totalProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>Total Profit</p>
                    <p className={`text-lg font-bold flex items-center gap-1 ${approvalStats.totalProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {approvalStats.totalProfit >= 0
                        ? <TrendingUp className="h-4 w-4" />
                        : <TrendingDown className="h-4 w-4" />}
                      {Math.abs(approvalStats.totalProfit).toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })}
                    </p>
                    <p className={`text-xs mt-0.5 ${approvalStats.totalProfit >= 0 ? "text-emerald-500" : "text-red-400"}`}>
                      {approvalStats.marginPct !== null ? `Margin ${approvalStats.marginPct.toFixed(1)}%` : "Belum ada data biaya"}
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-amber-50 border-amber-200">
                  <CardContent className="p-4">
                    <p className="text-xs text-amber-600 font-medium mb-1">Rata-rata Margin</p>
                    <p className="text-lg font-bold text-amber-700 flex items-center gap-1">
                      {approvalStats.marginPct !== null
                        ? <><BarChart2 className="h-4 w-4" />{approvalStats.marginPct.toFixed(1)}%</>
                        : <><Minus className="h-4 w-4" />—</>}
                    </p>
                    <p className="text-xs text-amber-500 mt-0.5">dari {approvalStats.count} approval disetujui</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Filter Bar ── */}
            {!approvalsLoading && (
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Cari nama customer, no. order, no. SO..."
                  value={approvalSearch}
                  onChange={e => setApprovalSearch(e.target.value)}
                  className="sm:max-w-xs h-8 text-sm"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {(["all","pending","approved","rejected"] as const).map(s => (
                    <Button
                      key={s}
                      size="sm"
                      variant={approvalStatusFilter === s ? "default" : "outline"}
                      className="h-8 text-xs capitalize"
                      onClick={() => setApprovalStatusFilter(s)}
                    >
                      {s === "all" ? "Semua" : s === "pending" ? "Pending" : s === "approved" ? "Disetujui" : "Ditolak"}
                      <span className="ml-1 opacity-60">
                        ({s === "all" ? approvals.length : approvals.filter(a => a.status === s).length})
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <QueryState loading={approvalsLoading} empty={filteredApprovals.length === 0} emptyMessage="Belum ada link approval." skeletonRows={3}>
              <Card>
                <CardContent className="p-0">
                  <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order / Customer</TableHead>
                        <TableHead>Harga Jual</TableHead>
                        <TableHead>Profit Margin</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>SO Number</TableHead>
                        <TableHead>Link</TableHead>
                        <TableHead>Dibuat</TableHead>
                        <TableHead>Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredApprovals.map(a => {
                        const sell = Number(a.sellingPrice ?? 0);
                        const cost = Number(a.vendorCost ?? 0);
                        const margin = sell - cost;
                        const marginPct = sell > 0 ? (margin / sell) * 100 : null;
                        const marginColor = margin > 0 ? "text-emerald-700" : margin < 0 ? "text-red-600" : "text-slate-500";
                        return (
                        <TableRow key={a.id}>
                          <TableCell>
                            <p className="font-medium text-sm">{a.orderNumber ?? "—"}</p>
                            <p className="text-xs text-slate-500">{a.customerName ?? "—"}</p>
                            {a.customerPhone && <p className="text-xs text-slate-400">{a.customerPhone}</p>}
                          </TableCell>
                          <TableCell>
                            <p className="font-semibold text-sm text-indigo-700">{fmtPrice(a.sellingPrice, a.currency)}</p>
                          </TableCell>
                          <TableCell>
                            {a.vendorCost ? (
                              <div>
                                <p className={`font-semibold text-sm ${marginColor}`}>{fmtPrice(String(margin), a.currency)}</p>
                                {marginPct !== null && (
                                  <p className={`text-xs ${marginColor}`}>{marginPct.toFixed(1)}%</p>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell><ApprovalStatusBadge status={a.status} /></TableCell>
                          <TableCell>
                            {a.soNumber ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-mono bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded">{a.soNumber}</span>
                                {a.salesDocId && (
                                  <a href={`/sales/orders/${a.salesDocId}`} target="_blank" rel="noreferrer" title="Buka Sales Order">
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-green-700 hover:text-green-900 hover:bg-green-100">
                                      <ExternalLink className="h-3 w-3" />
                                    </Button>
                                  </a>
                                )}
                              </div>
                            ) : a.status === "approved" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50"
                                disabled={retrySoMut.isPending}
                                onClick={() => retrySoMut.mutate(a.id)}
                                title="SO belum terbuat — klik untuk coba lagi"
                              >
                                {retrySoMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                                Buat SO
                              </Button>
                            ) : <span className="text-xs text-slate-400">—</span>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-0.5">
                              <CopyBtn text={buildApprovalUrl(a.token)} label="Salin link approval" />
                              <a href={buildApprovalUrl(a.token)} target="_blank" rel="noreferrer">
                                <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="h-3.5 w-3.5" /></Button>
                              </a>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-xs text-slate-500">{new Date(a.createdAt).toLocaleDateString("id-ID")}</p>
                          </TableCell>
                          <TableCell>
                            <WaTemplateDialog
                              type="customer_approval"
                              config={{
                                customerName: a.customerName,
                                orderNumber: a.orderNumber,
                                approvalLink: buildApprovalUrl(a.token),
                              }}
                              defaultPhone={a.customerPhone}
                              onSend={async (phone, msg) => {
                                await apiFetch(`/api/vendor-form/admin/customer-approvals/${a.id}/send-wa`, {
                                  method: "POST", body: JSON.stringify({ phone, customMessage: msg || undefined }),
                                });
                              }}
                              trigger={
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" title="Kirim WA ke customer">
                                  <MessageCircle className="h-3.5 w-3.5" />
                                </Button>
                              }
                            />
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </QueryState>
          </TabsContent>

          {/* ── OP CONFIRM TAB ── */}
          <TabsContent value="op-confirms" className="space-y-4">
            <div className="flex justify-end">
              <CreateOpConfirmDialog suppliers={suppliers} onCreated={() => queryClient.invalidateQueries({ queryKey: ["vmf-op-confirms"] })} />
            </div>
            <QueryState loading={opLoading} empty={opConfirms.length === 0} emptyMessage="Belum ada link konfirmasi operasional." skeletonRows={3}>
              <Card>
                <CardContent className="p-0">
                  <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Link</TableHead>
                        <TableHead>Dibuat</TableHead>
                        <TableHead>Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {opConfirms.map(c => {
                        const meta = SERVICE_META[c.serviceType];
                        const statusMeta = OP_STATUS_META[c.status];
                        return (
                          <TableRow key={c.id}>
                            <TableCell>
                              <p className="font-medium text-sm">{c.orderNumber ?? "—"}</p>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm">{c.vendorName ?? "—"}</p>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm">{meta?.emoji} {meta?.label ?? c.serviceType}</span>
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusMeta?.color ?? "bg-slate-100 text-slate-600"}`}>
                                {statusMeta?.label ?? c.status}
                              </span>
                              {c.submittedAt && (
                                <p className="text-xs text-slate-400 mt-0.5">{new Date(c.submittedAt).toLocaleDateString("id-ID")}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-0.5">
                                <CopyBtn text={buildOpConfirmUrl(c.token)} label="Salin link konfirmasi" />
                                <a href={buildOpConfirmUrl(c.token)} target="_blank" rel="noreferrer">
                                  <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="h-3.5 w-3.5" /></Button>
                                </a>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="text-xs text-slate-500">{new Date(c.createdAt).toLocaleDateString("id-ID")}</p>
                            </TableCell>
                            <TableCell>
                              <WaTemplateDialog
                                type="vendor_operational"
                                config={{
                                  vendorName: c.vendorName,
                                  serviceType: c.serviceType,
                                  orderNumber: c.orderNumber,
                                  opLink: buildOpConfirmUrl(c.token),
                                }}
                                onSend={async (phone, msg) => {
                                  await apiFetch(`/api/vendor-form/admin/op-confirms/${c.id}/send-wa`, {
                                    method: "POST", body: JSON.stringify({ phone, customMessage: msg || undefined }),
                                  });
                                }}
                                trigger={
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-600" title="Kirim WA konfirmasi operasional">
                                    <MessageCircle className="h-3.5 w-3.5" />
                                  </Button>
                                }
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </QueryState>
          </TabsContent>

          {/* ── INVOICE TAB ── */}
          <TabsContent value="invoices" className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Input
                placeholder="Cari invoice, customer, order, WA..."
                className="max-w-xs h-9 text-sm"
                value={invoiceSearch}
                onChange={e => setInvoiceSearch(e.target.value)}
              />
              <div className="ml-auto">
                <CreateInvoiceDialog
                  onCreated={() => queryClient.invalidateQueries({ queryKey: ["vmf-invoices"] })}
                />
              </div>
            </div>
            <QueryState loading={invoicesLoading} empty={filteredInvoices.length === 0} emptyMessage='Belum ada invoice. Klik "Buat Invoice" untuk membuat.' skeletonRows={3}>
              <Card>
                <CardContent className="p-0">
                  <div className="w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Order</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status Bayar</TableHead>
                        <TableHead>Jatuh Tempo</TableHead>
                        <TableHead>Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInvoices.map(inv => {
                        const isOverdue = !!inv.dueDate && new Date(inv.dueDate) < new Date() && inv.paymentStatus !== "paid";
                        const isPaid = inv.paymentStatus === "paid";
                        const isCompleted = inv.status === "completed";
                        const grandTotalNum = inv.grandTotal ? Number(inv.grandTotal) : null;
                        const PAY_STATUS: Record<string, { label: string; cls: string }> = {
                          unpaid:  { label: "Belum Bayar", cls: "bg-red-100 text-red-700 border-red-200" },
                          partial: { label: "Sebagian",    cls: "bg-amber-100 text-amber-700 border-amber-200" },
                          paid:    { label: "Lunas ✅",    cls: "bg-green-100 text-green-700 border-green-200" },
                        };
                        const payInfo = PAY_STATUS[inv.paymentStatus] ?? { label: inv.paymentStatus, cls: "bg-slate-100 text-slate-700 border-slate-200" };
                        const invoiceUrl = `/customer-invoice/${inv.token}`;

                        return (
                          <TableRow key={inv.id} className={isCompleted ? "opacity-60 bg-green-50/40" : ""}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-sm text-slate-800 font-mono">
                                  {inv.invoiceNumber ?? `#${inv.id}`}
                                </p>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  {isCompleted && (
                                    <span className="text-xs text-green-700 font-semibold flex items-center gap-0.5">
                                      <BadgeCheck className="h-3 w-3" />Selesai
                                    </span>
                                  )}
                                  {inv.viewedAt && !isCompleted && (
                                    <span className="text-xs text-blue-500">👁 Dilihat</span>
                                  )}
                                  {inv.acknowledgedAt && (
                                    <span className="text-xs text-indigo-500">✔ Dikonfirmasi</span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm text-slate-800">{inv.customerName ?? "—"}</p>
                              {inv.customerPhone && (
                                <p className="text-xs text-slate-400 font-mono">{inv.customerPhone}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              {inv.orderNumber
                                ? <span className="text-xs text-blue-600 font-mono">{inv.orderNumber}</span>
                                : <span className="text-slate-400 text-xs">—</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              {grandTotalNum != null
                                ? <span className="font-semibold text-sm">
                                    {(inv.currency ?? "IDR")} {Math.round(grandTotalNum).toLocaleString("id-ID")}
                                  </span>
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border font-semibold w-fit ${payInfo.cls}`}>
                                  {payInfo.label}
                                </span>
                                <PaymentProofPreview
                                  proofUrl={inv.proofUrl}
                                  proofUploadedAt={inv.proofUploadedAt}
                                  proofRemarks={inv.proofRemarks}
                                  compact
                                />
                                {isOverdue && (
                                  <span className="text-xs text-red-500 font-medium flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3" />Jatuh tempo
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {inv.dueDate
                                ? <span className={`text-xs ${isOverdue ? "text-red-600 font-semibold" : "text-slate-600"}`}>
                                    {new Date(inv.dueDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                                  </span>
                                : <span className="text-slate-400 text-xs">—</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 flex-wrap">
                                {/* Kirim WA */}
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-green-600"
                                  title="Kirim WA invoice ke customer"
                                  onClick={async () => {
                                    if (!inv.customerPhone) {
                                      toast({ title: "Nomor WA customer tidak ada", variant: "destructive" });
                                      return;
                                    }
                                    try {
                                      await apiFetch(`/api/vendor-form/admin/customer-invoices/${inv.id}/send-wa`, { method: "POST" });
                                      toast({ title: "WA invoice terkirim!" });
                                    } catch (e: unknown) {
                                      toast({ title: "Gagal kirim WA", description: (e as Error).message, variant: "destructive" });
                                    }
                                  }}
                                >
                                  <MessageCircle className="h-3.5 w-3.5" />
                                </Button>
                                {/* Lihat Invoice */}
                                <a href={invoiceUrl} target="_blank" rel="noopener noreferrer">
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600" title="Lihat invoice">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </Button>
                                </a>
                                {/* Konfirmasi Pembayaran */}
                                {!isPaid && !isCompleted && (
                                  <ConfirmPaymentDialog
                                    invoice={inv}
                                    onConfirmed={() => queryClient.invalidateQueries({ queryKey: ["vmf-invoices"] })}
                                  />
                                )}
                                {/* Tandai Selesai */}
                                {isPaid && !isCompleted && (
                                  <Button
                                    size="sm" variant="outline"
                                    className="h-7 text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50"
                                    onClick={() => setMarkCompleteTarget(inv)}
                                  >
                                    <BadgeCheck className="h-3.5 w-3.5" />
                                    Selesai
                                  </Button>
                                )}
                                {/* Salin link invoice */}
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700"
                                  title="Salin link invoice"
                                  onClick={() => {
                                    const url = window.location.origin + invoiceUrl;
                                    navigator.clipboard.writeText(url).then(() => toast({ title: "Link disalin!" }));
                                  }}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </QueryState>
          </TabsContent>

          {/* ── MEDIA SUBMISSION REPORT TAB ── */}
          <TabsContent value="media-report" className="space-y-4">
            <div className="rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 p-5 text-white">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0 text-xl">📷</div>
                <div>
                  <h2 className="font-bold text-lg">Vendor Media Submission Report</h2>
                  <p className="text-sm text-violet-100 mt-0.5">
                    Media yang diunggah vendor — cover, gallery, video, brosur, dan sertifikat.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                {[
                  { label: "Vendor Kirim Media", value: submissions.filter(s => s.mediaAssets && s.mediaAssets.length > 0).length },
                  { label: "Total File Media", value: submissions.reduce((acc, s) => acc + (s.mediaAssets?.length ?? 0), 0) },
                  { label: "Dari Total Submissions", value: submissions.length },
                ].map(st => (
                  <div key={st.label} className="bg-white/15 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold">{st.value}</p>
                    <p className="text-xs text-violet-100 mt-0.5">{st.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <QueryState empty={submissions.filter(s => s.mediaAssets && s.mediaAssets.length > 0).length === 0} emptyMessage="Belum ada vendor yang mengunggah media.">
              <div className="space-y-4">
                {submissions
                  .filter(s => s.mediaAssets && s.mediaAssets.length > 0)
                  .map(sub => {
                    const meta = SERVICE_META[sub.serviceType];
                    return (
                      <Card key={sub.id} className="overflow-hidden">
                        <CardHeader className="pb-3 bg-slate-50 border-b">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                                {meta?.emoji} {sub.vendorName ?? "—"}
                                {sub.selectedByAdmin && (
                                  <span className="text-xs bg-green-100 text-green-700 border border-green-200 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                                    <Star className="h-2.5 w-2.5 fill-green-600 text-green-600" /> Dipilih
                                  </span>
                                )}
                              </CardTitle>
                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                {sub.contactPerson && (
                                  <span className="text-xs text-slate-500 flex items-center gap-1"><User className="h-3 w-3" />{sub.contactPerson}</span>
                                )}
                                <span className="text-xs text-slate-400">{meta?.label ?? sub.serviceType}</span>
                                <span className="text-xs text-slate-400">
                                  {new Date(sub.submittedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                                </span>
                                <span className="text-xs bg-violet-100 text-violet-700 rounded px-1.5 py-0.5 border border-violet-200">
                                  {sub.mediaAssets!.length} file media
                                </span>
                              </div>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-4">
                          <SubmissionMediaGallery mediaAssets={sub.mediaAssets!} />
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            </QueryState>
          </TabsContent>

          {/* ── PRODUCT TEMPLATE ENGINE TAB ── */}
          <TabsContent value="product-templates" className="space-y-4">
            <ProductTemplateEngine />
          </TabsContent>

          {/* ── ACTIVITY LOG TAB ── */}
          <TabsContent value="activity-log" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">200 aktivitas terakhir — update otomatis setiap 20 detik</p>
              <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["vmf-activity-log"] })}>
                ↻ Refresh
              </Button>
            </div>
            <QueryState loading={actLoading} empty={activityLogs.length === 0} emptyMessage="Belum ada aktivitas tercatat" skeletonRows={4}>
              <div className="space-y-1">
                {activityLogs.map(log => {
                  const actionEmoji: Record<string, string> = {
                    submitted: "📩", resubmitted: "🔄", selected: "⭐", revision_requested: "↩",
                    sent_wa: "💬", approved: "✅", rejected: "❌", so_created: "🎉",
                    locked: "🔒", unlocked: "🔓", created: "➕", op_submitted: "🚚",
                    price_updated: "💱",
                  };
                  const entityLabel: Record<string, string> = {
                    link: "Link", submission: "Submission", customer_approval: "Approval", op_confirm: "Op-Confirm",
                  };
                  return (
                    <div key={log.id} className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <span className="text-lg shrink-0 mt-0.5">{actionEmoji[log.action] ?? "•"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 font-mono">
                            {entityLabel[log.entityType] ?? log.entityType} #{log.entityId}
                          </span>
                          <span className="text-xs font-semibold text-slate-700">{log.action.replace(/_/g, " ")}</span>
                          {log.actor && log.actor !== "system" && (
                            <span className="text-xs text-slate-400">oleh {log.actor}</span>
                          )}
                        </div>
                        {log.note && <p className="text-xs text-slate-600 mt-0.5">{log.note}</p>}
                      </div>
                      <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </QueryState>
          </TabsContent>
        </Tabs>
      </div>

      {/* Link Detail Sheet */}
      {selectedLink && (
        <LinkDetailSheet
          link={selectedLink}
          submissions={submissions}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onDeleteSubmission={(id) => deleteSubMut.mutate(id)}
          onSelectSubmission={(id) => selectSubMut.mutate(id)}
        />
      )}

      {/* Compare Vendors Sheet */}
      {compareLink && (
        <CompareVendorsSheet
          link={compareLink}
          submissions={submissions}
          open={compareOpen}
          onOpenChange={setCompareOpen}
          onSelect={async (id) => {
            await new Promise<void>((resolve, reject) =>
              selectSubMut.mutate(id, { onSuccess: () => resolve(), onError: (e) => reject(e) })
            );
          }}
        />
      )}

      {/* ── AlertDialog: hapus link ── */}
      <AlertDialog open={deleteLinkTarget !== null} onOpenChange={(o) => { if (!o) setDeleteLinkTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Link</AlertDialogTitle>
            <AlertDialogDescription>
              Link <strong>{deleteLinkTarget?.title ?? "ini"}</strong> akan dihapus. Semua submission yang terkait akan dibebaskan dari link ini.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteLinkTarget) { deleteLinkMut.mutate(deleteLinkTarget.id); setDeleteLinkTarget(null); } }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── AlertDialog: pilih vendor submission ── */}
      <AlertDialog open={selectSubTarget !== null} onOpenChange={(o) => { if (!o) setSelectSubTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pilih Vendor</AlertDialogTitle>
            <AlertDialogDescription>
              Pilih <strong>{selectSubTarget?.vendorName ?? "vendor ini"}</strong> sebagai vendor terpilih?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (selectSubTarget) { selectSubMut.mutate(selectSubTarget.id); setSelectSubTarget(null); } }}
            >
              Pilih
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── AlertDialog: hapus submission ── */}
      <AlertDialog open={deleteSubTarget !== null} onOpenChange={(o) => { if (!o) setDeleteSubTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Submission</AlertDialogTitle>
            <AlertDialogDescription>
              Submission dari <strong>{deleteSubTarget?.vendorName ?? "vendor ini"}</strong> akan dihapus secara permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteSubTarget) { deleteSubMut.mutate(deleteSubTarget.id); setDeleteSubTarget(null); } }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── AlertDialog: tandai order selesai ── */}
      <AlertDialog open={markCompleteTarget !== null} onOpenChange={(o) => { if (!o) setMarkCompleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tandai Selesai</AlertDialogTitle>
            <AlertDialogDescription>
              Tandai order {markCompleteTarget?.orderNumber ? <strong>{markCompleteTarget.orderNumber}</strong> : "ini"} sebagai Selesai? WA notifikasi akan dikirim ke customer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={markCompleting}
              onClick={async () => {
                if (!markCompleteTarget) return;
                setMarkCompleting(true);
                try {
                  await apiFetch(`/api/vendor-form/admin/customer-invoices/${markCompleteTarget.id}/mark-completed`, { method: "POST" });
                  toast({ title: "Order ditandai Selesai! ✅" });
                  queryClient.invalidateQueries({ queryKey: ["vmf-invoices"] });
                } catch (e: unknown) {
                  toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" });
                } finally {
                  setMarkCompleting(false);
                  setMarkCompleteTarget(null);
                }
              }}
            >
              {markCompleting ? "Memproses..." : "Ya, Selesai"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
