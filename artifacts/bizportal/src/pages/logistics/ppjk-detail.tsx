/**
 * PPJK Order Detail — Phase 2 Enterprise
 * Integrates: Workflow (P2), SLA (P7), Assignment (P8), Checklist (P5/6),
 * Financial Breakdown (P9), AI Assistant (P10), Status Log Timeline (P4)
 */
import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Globe, ArrowLeft, RefreshCw, Loader2, FileText, CheckCircle,
  Clock, Pencil, Save, ChevronDown, ChevronUp, Package, Sparkles,
  Users, BarChart3, ClipboardList, History,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { FreightCustomsPanel } from "@/components/freight/FreightCustomsPanel";
import { PpjkWorkflowBar } from "@/components/ppjk/PpjkWorkflowBar";
import { PpjkChecklist } from "@/components/ppjk/PpjkChecklist";
import { PpjkSla } from "@/components/ppjk/PpjkSla";
import { PpjkAssignment } from "@/components/ppjk/PpjkAssignment";
import { PpjkFinancialBreakdown } from "@/components/ppjk/PpjkFinancialBreakdown";
import { PpjkAiAssistant } from "@/components/ppjk/PpjkAiAssistant";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PpjkOrder {
  id: number; orderNumber: string;
  customerName: string; customerEmail: string | null; customerPhone: string | null;
  customerCompany: string | null; customerNpwp: string | null;
  tradeType: string; commodity: string | null; hsCode: string | null;
  origin: string | null; destination: string | null;
  portOfEntry: string | null; kantorPabean: string | null;
  jenisPelayanan: string | null; status: string; customsStatus: string | null;
  nomorAju: string | null; nomorPib: string | null; nomorPeb: string | null;
  nomorSppb: string | null; tanggalAju: string | null;
  nilaiPabean: string | null; beaMasuk: string | null;
  ppnImpor: string | null; pphImpor: string | null; totalTagihanPabean: string | null;
  serviceFee: string | null; ppnServiceFee: string | null; totalServiceFee: string | null;
  bmtp: string | null; bmad: string | null; storageFee: string | null;
  handlingFee: string | null; thc: string | null; doFee: string | null;
  forwardingFee: string | null; truckingFee: string | null; miscFee: string | null;
  vendorName: string | null; notes: string | null; adminNotes: string | null;
  assignedOfficerName: string | null; assignedOfficerId: string | null;
  assignedTeam: string | null; assignedSupervisor: string | null; assignedAt: string | null;
  slaDeadline: string | null; isOverdue: string | null;
  allowedTransitions: string[];
  statusLabel: string;
  portalOrderId: number | null;
  workflowValidated: string;
  createdAt: string; updatedAt: string;
}

interface AuditLog {
  id: number; action: string; fromStatus: string | null; toStatus: string | null;
  field: string | null; oldValue: string | null; newValue: string | null;
  changedBy: string; notes: string | null; createdAt: string;
}

const CUSTOMS_STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu",
  aju_filed: "Nomor Aju Terdaftar",
  jalur_hijau: "Jalur Hijau",
  jalur_merah: "Jalur Merah",
  jalur_kuning: "Jalur Kuning",
  sppb_issued: "SPPB Terbit",
  paid: "Bea & Pajak Dibayar",
  released: "Barang Dikeluarkan",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  waiting_documents: "bg-yellow-100 text-yellow-800",
  document_review: "bg-blue-100 text-blue-800",
  document_completed: "bg-teal-100 text-teal-800",
  quotation: "bg-purple-100 text-purple-800",
  waiting_customer: "bg-orange-100 text-orange-800",
  customer_approved: "bg-emerald-100 text-emerald-800",
  preparing_pib: "bg-sky-100 text-sky-800",
  preparing_peb: "bg-sky-100 text-sky-800",
  submitted_ceisa: "bg-indigo-100 text-indigo-800",
  inspection: "bg-amber-100 text-amber-800",
  red_lane: "bg-red-100 text-red-800",
  yellow_lane: "bg-yellow-100 text-yellow-800",
  green_lane: "bg-green-100 text-green-800",
  hold: "bg-orange-100 text-orange-800",
  sppb: "bg-green-200 text-green-900",
  released: "bg-emerald-200 text-emerald-900",
  completed: "bg-emerald-300 text-emerald-950",
  cancelled: "bg-red-100 text-red-800",
};

// ─── Section ──────────────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, defaultOpen = true, badge }: {
  title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setOpen(!open)}>
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          {title}
          {badge && <span onClick={(e) => e.stopPropagation()}>{badge}</span>}
          <span className="ml-auto">{open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}</span>
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between items-start py-1.5 border-b last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 mr-4">{label}</span>
      <span className="text-xs font-medium text-right">{value}</span>
    </div>
  );
}

// ─── Edit Dialog ──────────────────────────────────────────────────────────────
function EditDialog({ order, open, onOpenChange, onSaved }: {
  order: PpjkOrder; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    customerName: order.customerName, customerEmail: order.customerEmail ?? "",
    customerPhone: order.customerPhone ?? "", customerCompany: order.customerCompany ?? "",
    customerNpwp: order.customerNpwp ?? "",
    tradeType: order.tradeType, commodity: order.commodity ?? "", hsCode: order.hsCode ?? "",
    origin: order.origin ?? "", destination: order.destination ?? "",
    portOfEntry: order.portOfEntry ?? "", kantorPabean: order.kantorPabean ?? "",
    jenisPelayanan: order.jenisPelayanan ?? "",
    nomorAju: order.nomorAju ?? "", nomorPib: order.nomorPib ?? "",
    nomorPeb: order.nomorPeb ?? "", nomorSppb: order.nomorSppb ?? "",
    tanggalAju: order.tanggalAju ?? "",
    vendorName: order.vendorName ?? "", notes: order.notes ?? "", adminNotes: order.adminNotes ?? "",
  });
  const f = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/ppjk/orders/${order.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    onSuccess: () => { toast.success("Data disimpan"); onSaved(); onOpenChange(false); },
    onError: () => toast.error("Gagal menyimpan"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit PPJK Order — {order.orderNumber}</DialogTitle></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 col-span-2"><Label>Nama Importir / Eksportir *</Label><Input value={form.customerName} onChange={(e) => f("customerName", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Perusahaan</Label><Input value={form.customerCompany} onChange={(e) => f("customerCompany", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>NPWP</Label><Input value={form.customerNpwp} onChange={(e) => f("customerNpwp", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.customerEmail} onChange={(e) => f("customerEmail", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Telepon</Label><Input value={form.customerPhone} onChange={(e) => f("customerPhone", e.target.value)} /></div>
          </div>
          <div className="border-t pt-4 grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Trade Type</Label>
              <Select value={form.tradeType} onValueChange={(v) => f("tradeType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="import">Import</SelectItem>
                  <SelectItem value="export">Export</SelectItem>
                  <SelectItem value="transit">Transit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Jenis Pelayanan</Label>
              <Select value={form.jenisPelayanan || "none"} onValueChange={(v) => f("jenisPelayanan", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Pilih..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="customs_clearance">Customs Clearance</SelectItem>
                  <SelectItem value="customs_import">PIB — Impor</SelectItem>
                  <SelectItem value="customs_export">PEB — Ekspor</SelectItem>
                  <SelectItem value="customs_undername">Undername</SelectItem>
                  <SelectItem value="consulting">Konsultasi</SelectItem>
                  <SelectItem value="full_service">Full Service PPJK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Komoditi</Label><Input value={form.commodity} onChange={(e) => f("commodity", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>HS Code</Label><Input value={form.hsCode} onChange={(e) => f("hsCode", e.target.value)} placeholder="0000.00.00" /></div>
            <div className="space-y-1.5"><Label>Origin</Label><Input value={form.origin} onChange={(e) => f("origin", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Destination</Label><Input value={form.destination} onChange={(e) => f("destination", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Port of Entry</Label><Input value={form.portOfEntry} onChange={(e) => f("portOfEntry", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Kantor Pabean</Label><Input value={form.kantorPabean} onChange={(e) => f("kantorPabean", e.target.value)} /></div>
          </div>
          <div className="border-t pt-4 grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Nomor Aju</Label><Input value={form.nomorAju} onChange={(e) => f("nomorAju", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Tanggal Aju</Label><DatePicker value={form.tanggalAju} onChange={(v) => f("tanggalAju", v)} /></div>
            <div className="space-y-1.5"><Label>Nomor PIB</Label><Input value={form.nomorPib} onChange={(e) => f("nomorPib", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Nomor PEB</Label><Input value={form.nomorPeb} onChange={(e) => f("nomorPeb", e.target.value)} /></div>
            <div className="space-y-1.5 col-span-2"><Label>Nomor SPPB</Label><Input value={form.nomorSppb} onChange={(e) => f("nomorSppb", e.target.value)} /></div>
          </div>
          <div className="border-t pt-4 grid grid-cols-1 gap-4">
            <div className="space-y-1.5"><Label>Vendor PPJK</Label><Input value={form.vendorName} onChange={(e) => f("vendorName", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Catatan Customer</Label><Textarea value={form.notes} onChange={(e) => f("notes", e.target.value)} rows={2} className="resize-none" /></div>
            <div className="space-y-1.5"><Label>Catatan Admin</Label><Textarea value={form.adminNotes} onChange={(e) => f("adminNotes", e.target.value)} rows={2} className="resize-none" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Audit Log Item ───────────────────────────────────────────────────────────
function AuditItem({ log }: { log: AuditLog }) {
  const actionLabel: Record<string, string> = {
    created: "Order dibuat",
    status_changed: "Status diubah",
    customs_status_changed: "Status kepabeanan diubah",
    field_updated: "Field diperbarui",
    assigned: "Tugas ditetapkan",
  };
  return (
    <div className="flex gap-3 items-start">
      <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Clock className="w-2.5 h-2.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0 pb-3">
        <p className="text-xs font-medium">{actionLabel[log.action] ?? log.action}</p>
        {log.fromStatus && log.toStatus && (
          <p className="text-xs text-muted-foreground">
            <span className="line-through">{log.fromStatus}</span> → <strong>{log.toStatus}</strong>
          </p>
        )}
        {log.field && (
          <p className="text-xs text-muted-foreground">
            {log.field}: <span className="line-through">{log.oldValue || "—"}</span> → <strong>{log.newValue || "—"}</strong>
          </p>
        )}
        {log.notes && <p className="text-xs text-muted-foreground italic">{log.notes}</p>}
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {log.changedBy} · {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale: idLocale })}
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PpjkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const orderId = parseInt(id || "0");

  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "checklist" | "financial" | "ai" | "timeline">("overview");

  const { data, isLoading, refetch } = useQuery<{
    order: PpjkOrder;
    docs: any[];
    auditLogs: AuditLog[];
    checklist: any[];
  }>({
    queryKey: ["ppjk-order", orderId],
    queryFn: async () => {
      const r = await fetch(`/api/ppjk/orders/${orderId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Tidak ditemukan");
      return r.json();
    },
    enabled: !!orderId,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["ppjk-order", orderId] });
    qc.invalidateQueries({ queryKey: ["ppjk-orders"] });
    qc.invalidateQueries({ queryKey: ["ppjk-checklist", orderId] });
    qc.invalidateQueries({ queryKey: ["ppjk-sla", orderId] });
  }

  if (isLoading) {
    return <AppShell><LoadingSkeleton variant="detail" /></AppShell>;
  }
  if (!data) {
    return <AppShell><div className="p-6 text-muted-foreground">Order tidak ditemukan.</div></AppShell>;
  }

  const { order, auditLogs } = data;

  const tabs = [
    { id: "overview",  label: "Ringkasan",  icon: Package },
    { id: "checklist", label: "Dokumen",    icon: ClipboardList },
    { id: "financial", label: "Finansial",  icon: BarChart3 },
    { id: "ai",        label: "AI Assist",  icon: Sparkles },
    { id: "timeline",  label: "Timeline",   icon: History },
  ] as const;

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate("/logistics/ppjk")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
          </Button>
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            <Globe className="w-5 h-5 text-blue-600" />
            <span className="font-mono font-bold text-lg">{order.orderNumber}</span>
            <Badge className={`text-xs ${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-700"}`}>
              {order.statusLabel ?? order.status}
            </Badge>
            {order.customsStatus && (
              <Badge variant="outline" className="text-xs">
                {CUSTOMS_STATUS_LABELS[order.customsStatus] ?? order.customsStatus}
              </Badge>
            )}
            {order.isOverdue === "yes" && (
              <Badge className="text-xs bg-red-100 text-red-700 border-red-200">⚠️ OVERDUE</Badge>
            )}
            {order.portalOrderId && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Portal #{order.portalOrderId}
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="w-4 h-4 mr-1" /> Edit
            </Button>
          </div>
        </div>

        {/* Workflow bar */}
        <Card>
          <CardContent className="pt-4">
            <PpjkWorkflowBar
              orderId={orderId}
              currentStatus={order.status}
              allowedTransitions={order.allowedTransitions ?? []}
              onUpdated={invalidate}
            />
          </CardContent>
        </Card>

        {/* SLA */}
        <PpjkSla orderId={orderId} />

        {/* Tab nav */}
        <div className="flex gap-1 border-b">
          {tabs.map(({ id: tabId, label, icon: Icon }) => (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId as any)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tabId
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Section title="Customer / Importir" icon={Globe}>
                <FieldRow label="Nama" value={order.customerName} />
                <FieldRow label="Perusahaan" value={order.customerCompany} />
                <FieldRow label="NPWP" value={order.customerNpwp} />
                <FieldRow label="Email" value={order.customerEmail} />
                <FieldRow label="Telepon" value={order.customerPhone} />
              </Section>

              <Section title="Detail Layanan" icon={Package}>
                <FieldRow label="Jenis Trade" value={<Badge variant="outline" className="text-xs capitalize">{order.tradeType}</Badge>} />
                <FieldRow label="Jenis Pelayanan" value={order.jenisPelayanan?.replace(/_/g, " ")} />
                <FieldRow label="Komoditi" value={order.commodity} />
                <FieldRow label="HS Code" value={order.hsCode} />
                <FieldRow label="Origin → Destination" value={order.origin && order.destination ? `${order.origin} → ${order.destination}` : null} />
                <FieldRow label="Port of Entry" value={order.portOfEntry} />
                <FieldRow label="Kantor Pabean" value={order.kantorPabean} />
                <FieldRow label="Vendor PPJK" value={order.vendorName} />
              </Section>

              <Section title="Nomor Dokumen" icon={FileText}>
                <FieldRow label="Nomor Aju" value={<span className="font-mono">{order.nomorAju}</span>} />
                <FieldRow label="Tanggal Aju" value={order.tanggalAju} />
                <FieldRow label="Nomor PIB" value={<span className="font-mono">{order.nomorPib}</span>} />
                <FieldRow label="Nomor PEB" value={<span className="font-mono">{order.nomorPeb}</span>} />
                <FieldRow label="Nomor SPPB" value={order.nomorSppb ? <span className="font-mono text-green-700 font-bold">{order.nomorSppb}</span> : null} />
              </Section>

              <Section title="Dokumen Kepabeanan (Upload)" icon={FileText}>
                <FreightCustomsPanel sourceModule="ppjk" sourceOrderId={orderId} />
              </Section>

              {(order.notes || order.adminNotes) && (
                <Card>
                  <CardContent className="pt-4 space-y-3">
                    {order.notes && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Catatan Customer</p>
                        <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
                      </div>
                    )}
                    {order.adminNotes && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Catatan Admin</p>
                        <p className="text-sm whitespace-pre-wrap">{order.adminNotes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right sidebar */}
            <div className="space-y-4">
              {/* Assignment */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" /> Penugasan
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <PpjkAssignment
                    orderId={orderId}
                    assignment={{
                      assignedOfficerName: order.assignedOfficerName,
                      assignedOfficerId: order.assignedOfficerId,
                      assignedTeam: order.assignedTeam,
                      assignedSupervisor: order.assignedSupervisor,
                      assignedAt: order.assignedAt,
                    }}
                  />
                </CardContent>
              </Card>

              {/* Audit log */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <History className="w-4 h-4 text-muted-foreground" /> Aktivitas Terakhir
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {auditLogs.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">Belum ada log</p>
                  ) : (
                    <div className="divide-y">
                      {auditLogs.slice(0, 8).map((log) => (
                        <AuditItem key={log.id} log={log} />
                      ))}
                    </div>
                  )}
                  {auditLogs.length > 8 && (
                    <button
                      className="text-xs text-blue-600 hover:underline mt-2"
                      onClick={() => setActiveTab("timeline")}
                    >
                      Lihat semua →
                    </button>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "checklist" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-muted-foreground" />
                Checklist Dokumen
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PpjkChecklist orderId={orderId} />
            </CardContent>
          </Card>
        )}

        {activeTab === "financial" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" /> Rincian Finansial
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PpjkFinancialBreakdown
                orderId={orderId}
                data={{
                  nilaiPabean: order.nilaiPabean,
                  beaMasuk: order.beaMasuk,
                  ppnImpor: order.ppnImpor,
                  pphImpor: order.pphImpor,
                  totalTagihanPabean: order.totalTagihanPabean,
                  bmtp: order.bmtp,
                  bmad: order.bmad,
                  storageFee: order.storageFee,
                  handlingFee: order.handlingFee,
                  thc: order.thc,
                  doFee: order.doFee,
                  forwardingFee: order.forwardingFee,
                  truckingFee: order.truckingFee,
                  miscFee: order.miscFee,
                  serviceFee: order.serviceFee,
                  ppnServiceFee: order.ppnServiceFee,
                  totalServiceFee: order.totalServiceFee,
                }}
              />
            </CardContent>
          </Card>
        )}

        {activeTab === "ai" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-500" /> AI Customs Assistant
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PpjkAiAssistant orderId={orderId} />
            </CardContent>
          </Card>
        )}

        {activeTab === "timeline" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" /> Audit Trail Lengkap
              </CardTitle>
            </CardHeader>
            <CardContent>
              {auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Belum ada log aktivitas</p>
              ) : (
                <div className="divide-y">
                  {auditLogs.map((log) => (
                    <AuditItem key={log.id} log={log} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <EditDialog order={order} open={editOpen} onOpenChange={setEditOpen} onSaved={invalidate} />
    </AppShell>
  );
}
