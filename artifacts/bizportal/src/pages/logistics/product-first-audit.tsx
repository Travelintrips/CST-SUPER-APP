import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  ShieldAlert, Clock, AlertTriangle, Database, Wrench, RefreshCw,
  CheckCircle, XCircle, Info, ArrowLeft,
} from "lucide-react";

const SEV_CLASS: Record<string, string> = {
  critical: "text-red-400 border-red-500/30 bg-red-500/10",
  high:     "text-orange-400 border-orange-500/30 bg-orange-500/10",
  medium:   "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  low:      "text-green-400 border-green-500/30 bg-green-500/10",
};

const SLA_CLASS = (s: string) =>
  s === "on_time" ? "text-emerald-400" : s === "breached" ? "text-red-400" : "text-slate-400";

type OverrideType = "force-product-approve" | "change-shipment-mode" | "reset-shipment-selection" | "resend-product-approval" | "flag-stock-unavailable" | "clear-stock-unavailable";

interface OverrideDialog {
  open: boolean;
  type: OverrideType | null;
  orderId: number | null;
  orderNumber: string;
}

// ── Sub-component: override manual card (must be outside main component to avoid hook-in-map) ──
function OverrideManualCard({
  type,
  label,
  description,
  openOverride,
}: {
  type: OverrideType;
  label: string;
  description: string;
  openOverride: (t: OverrideType, id: number, num: string) => void;
}) {
  const [manualId, setManualId] = useState("");
  return (
    <div className="p-4 rounded-lg bg-slate-700/40 border border-slate-600/50 space-y-2">
      <div className="text-sm font-medium text-slate-200">{label}</div>
      <div className="text-xs text-slate-400">{description}</div>
      <div className="flex gap-2">
        <Input
          placeholder="Order ID"
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          className="h-7 text-xs bg-slate-700 border-slate-600 text-white w-24"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-amber-500/40 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
          disabled={!manualId}
          onClick={() => { if (manualId) openOverride(type, Number(manualId), `Order #${manualId}`); }}
        >
          Jalankan
        </Button>
      </div>
    </div>
  );
}

const OVERRIDE_CARDS: { type: OverrideType; description: string }[] = [
  { type: "force-product-approve",    description: "Paksa transisi ke Shipment Selection Pending tanpa menunggu customer approve." },
  { type: "change-shipment-mode",     description: "Ubah mode pengiriman (trucking / pickup_self) tanpa mengubah status order." },
  { type: "reset-shipment-selection", description: "Reset order kembali ke Shipment Selection Pending, hapus mode yang sudah dipilih." },
  { type: "resend-product-approval",  description: "Kirim ulang link approval produk ke customer via WA." },
  { type: "flag-stock-unavailable",   description: "Tandai stok produk tidak tersedia — reset ke Product RFQ Sent untuk cari vendor baru." },
  { type: "clear-stock-unavailable",  description: "Hapus flag stok tidak tersedia (stok sudah tersedia kembali / vendor baru ditemukan)." },
];

function OverrideManualCards({
  overrideLabels,
  openOverride,
}: {
  overrideLabels: Record<OverrideType, string>;
  openOverride: (t: OverrideType, id: number, num: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {OVERRIDE_CARDS.map(({ type, description }) => (
        <OverrideManualCard
          key={type}
          type={type}
          label={overrideLabels[type]}
          description={description}
          openOverride={openOverride}
        />
      ))}
    </div>
  );
}

export default function ProductFirstAuditPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("sla");
  const [thresholdHours, setThresholdHours] = useState(24);
  const [override, setOverride] = useState<OverrideDialog>({ open: false, type: null, orderId: null, orderNumber: "" });
  const [overrideReason, setOverrideReason] = useState("");
  const [newShipmentMode, setNewShipmentMode] = useState("trucking");
  const [regenerateToken, setRegenerateToken] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const slaQ = useQuery({
    queryKey: ["pf-audit-sla"],
    queryFn: () => api.get("/api/logistic/product-first/audit/sla").then((r) => r.data),
  });

  const blockedQ = useQuery({
    queryKey: ["pf-audit-blocked", thresholdHours],
    queryFn: () => api.get(`/api/logistic/product-first/audit/blocked?thresholdHours=${thresholdHours}`).then((r) => r.data),
  });

  const missingQ = useQuery({
    queryKey: ["pf-audit-missing"],
    queryFn: () => api.get("/api/logistic/product-first/audit/missing-data").then((r) => r.data),
  });

  const excQ = useQuery({
    queryKey: ["pf-audit-exceptions"],
    queryFn: () => api.get("/api/logistic/product-first/audit/exceptions").then((r) => r.data),
  });

  // ── Override mutation ────────────────────────────────────────────────────────
  const overrideMut = useMutation({
    mutationFn: ({ type, orderId, body }: { type: OverrideType; orderId: number; body: Record<string, unknown> }) =>
      api.post(`/api/logistic/orders/${orderId}/override/${type}`, body).then((r) => r.data),
    onSuccess: (_, { type }) => {
      toast({ title: "Override berhasil", description: `Aksi ${type} dicatat di audit log.` });
      qc.invalidateQueries({ queryKey: ["pf-audit"] });
      setOverride((p) => ({ ...p, open: false }));
      setOverrideReason("");
    },
    onError: (err: any) => {
      toast({ title: "Override gagal", description: err?.response?.data?.error ?? err.message, variant: "destructive" });
    },
  });

  function openOverride(type: OverrideType, orderId: number, orderNumber: string) {
    setOverride({ open: true, type, orderId, orderNumber });
    setOverrideReason("");
  }

  function submitOverride() {
    if (!override.orderId || !override.type) return;
    if (!overrideReason.trim()) {
      toast({ title: "Reason wajib diisi", variant: "destructive" });
      return;
    }
    const body: Record<string, unknown> = { reason: overrideReason };
    if (override.type === "change-shipment-mode") body.shipmentMode = newShipmentMode;
    if (override.type === "resend-product-approval") body.regenerateToken = regenerateToken;
    overrideMut.mutate({ type: override.type!, orderId: override.orderId!, body });
  }

  const overrideLabels: Record<OverrideType, string> = {
    "force-product-approve":    "Force Approve Produk",
    "change-shipment-mode":     "Ubah Mode Pengiriman",
    "reset-shipment-selection": "Reset Shipment Selection",
    "resend-product-approval":  "Kirim Ulang Approval Link",
    "flag-stock-unavailable":   "Flag Stok Tidak Tersedia",
    "clear-stock-unavailable":  "Hapus Flag Stok Tidak Tersedia",
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => window.history.back()} aria-label="Kembali" className="shrink-0 rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-amber-400" />
              Audit Dashboard — Product-First
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              SLA, blocked orders, missing data, exceptions, dan admin override
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["pf-audit"] });
          }}
          className="gap-2 border-slate-600 text-slate-300 hover:text-white"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Clock className="w-3.5 h-3.5" /> SLA Breached
            </div>
            <div className="text-2xl font-bold text-red-400">
              {((slaQ.data as any)?.productPhaseSla ?? []).filter((r: any) => r.slaStatus === "breached").length
               + ((slaQ.data as any)?.shipmentPhaseSla ?? []).filter((r: any) => r.slaStatus === "breached").length}
            </div>
            <div className="text-xs text-slate-400">fase melewati target SLA</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Blocked Orders
            </div>
            <div className="text-2xl font-bold text-orange-400">
              {(blockedQ.data as any)?.summary?.total ?? 0}
            </div>
            <div className="text-xs text-slate-400">
              {(blockedQ.data as any)?.summary?.slaBreached ?? 0} SLA breached
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Database className="w-3.5 h-3.5" /> Data Tidak Lengkap
            </div>
            <div className="text-2xl font-bold text-yellow-400">
              {(missingQ.data as any)?.summary?.total ?? 0}
            </div>
            <div className="text-xs text-slate-400">orders dengan data kosong</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <ShieldAlert className="w-3.5 h-3.5" /> Open Exceptions
            </div>
            <div className="text-2xl font-bold text-red-400">
              {(excQ.data as any)?.recentOpen?.length ?? 0}
            </div>
            <div className="text-xs text-slate-400">
              {((excQ.data as any)?.bySeverity ?? []).filter((r: any) => ["critical","high"].includes(r.severity) && r.status !== "resolved").reduce((a: number, r: any) => a + r.count, 0)} high priority
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="sla" className="text-xs data-[state=active]:bg-slate-700">Product Phase SLA</TabsTrigger>
          <TabsTrigger value="shipment-sla" className="text-xs data-[state=active]:bg-slate-700">Shipment Phase SLA</TabsTrigger>
          <TabsTrigger value="blocked" className="text-xs data-[state=active]:bg-slate-700">Blocked Orders</TabsTrigger>
          <TabsTrigger value="missing" className="text-xs data-[state=active]:bg-slate-700">Missing Data</TabsTrigger>
          <TabsTrigger value="exceptions" className="text-xs data-[state=active]:bg-slate-700">Exceptions</TabsTrigger>
          <TabsTrigger value="override" className="text-xs data-[state=active]:bg-slate-700">Admin Override</TabsTrigger>
        </TabsList>

        {/* SLA: Product Phase */}
        <TabsContent value="sla">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Product Phase SLA</CardTitle>
            </CardHeader>
            <CardContent>
              {slaQ.isLoading && <div className="text-slate-400 text-sm py-4">Memuat...</div>}
              <div className="space-y-2">
                {((slaQ.data as any)?.productPhaseSla ?? []).map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-700/40">
                    <div>
                      <div className="text-sm font-medium text-slate-200">{r.status}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {r.orderCount} orders · Target: {r.slaTargetHours}h
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-mono font-medium ${SLA_CLASS(r.slaStatus)}`}>
                        avg {r.avgHours}h
                      </div>
                      <div className="text-xs text-slate-500">max {r.maxHours}h</div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`ml-3 text-xs ${r.slaStatus === "on_time" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : r.slaStatus === "breached" ? "text-red-400 border-red-500/30 bg-red-500/10" : "text-slate-400 border-slate-600"}`}
                    >
                      {r.slaStatus === "on_time" ? "✓ On Time" : r.slaStatus === "breached" ? "✗ Breached" : "No SLA"}
                    </Badge>
                  </div>
                ))}
                {!slaQ.isLoading && ((slaQ.data as any)?.productPhaseSla ?? []).length === 0 && (
                  <div className="text-center text-slate-500 text-sm py-6">Belum ada data SLA</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SLA: Shipment Phase */}
        <TabsContent value="shipment-sla">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Shipment Phase SLA</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {((slaQ.data as any)?.shipmentPhaseSla ?? []).map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-700/40">
                    <div>
                      <div className="text-sm font-medium text-slate-200">{r.status}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {r.orderCount} orders{r.slaTargetHours ? ` · Target: ${r.slaTargetHours}h` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-mono font-medium ${SLA_CLASS(r.slaStatus)}`}>
                        avg {r.avgHours}h
                      </div>
                      <div className="text-xs text-slate-500">max {r.maxHours}h</div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`ml-3 text-xs ${r.slaStatus === "on_time" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : r.slaStatus === "breached" ? "text-red-400 border-red-500/30 bg-red-500/10" : "text-slate-400 border-slate-600"}`}
                    >
                      {r.slaStatus === "on_time" ? "✓ On Time" : r.slaStatus === "breached" ? "✗ Breached" : "No SLA"}
                    </Badge>
                  </div>
                ))}
                {!slaQ.isLoading && ((slaQ.data as any)?.shipmentPhaseSla ?? []).length === 0 && (
                  <div className="text-center text-slate-500 text-sm py-6">Belum ada data SLA</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Blocked Orders */}
        <TabsContent value="blocked">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-slate-300">Blocked Orders</CardTitle>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-slate-400">Threshold (jam):</Label>
                <Input
                  type="number"
                  value={thresholdHours}
                  onChange={(e) => setThresholdHours(Number(e.target.value))}
                  className="w-16 h-7 text-xs bg-slate-700 border-slate-600 text-white"
                />
              </div>
            </CardHeader>
            <CardContent>
              {blockedQ.isLoading && <div className="text-slate-400 text-sm py-4">Memuat...</div>}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {((blockedQ.data as any)?.orders ?? []).map((r: any, i: number) => (
                  <div key={i} className={`p-3 rounded-lg bg-slate-700/40 border-l-2 ${r.slaBreached ? "border-red-500" : "border-slate-600"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-indigo-400">{r.order_number}</span>
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">{r.status}</Badge>
                          {r.slaBreached && <Badge variant="outline" className="text-xs text-red-400 border-red-500/30 bg-red-500/10">SLA Breached</Badge>}
                        </div>
                        <div className="text-sm text-slate-300 mt-0.5">{r.customer_name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {r.shipment_mode && <span className="mr-2">Mode: {r.shipment_mode}</span>}
                          {r.product_ready_date && <span>Ready: {r.product_ready_date}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-medium ${r.hoursStuck > 72 ? "text-red-400" : r.hoursStuck > 24 ? "text-orange-400" : "text-yellow-400"}`}>
                          {r.hoursStuck}h stuck
                        </div>
                        <div className="flex gap-1 mt-1 justify-end flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs border-slate-600 text-slate-300 hover:text-white px-2"
                            onClick={() => openOverride("force-product-approve", r.id, r.order_number)}
                          >
                            Force Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs border-slate-600 text-slate-300 hover:text-white px-2"
                            onClick={() => openOverride("reset-shipment-selection", r.id, r.order_number)}
                          >
                            Reset Selection
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs border-red-500/40 text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2"
                            onClick={() => openOverride("flag-stock-unavailable", r.id, r.order_number)}
                          >
                            Flag Stok
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {!blockedQ.isLoading && ((blockedQ.data as any)?.orders ?? []).length === 0 && (
                  <div className="text-center text-slate-500 text-sm py-6">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-500/40" />
                    Tidak ada blocked orders ✓
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Missing Data */}
        <TabsContent value="missing">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Orders dengan Data Tidak Lengkap</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Summary badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  { label: "Missing Ready Date", key: "missingReadyDate", color: "text-red-400 border-red-500/30 bg-red-500/10" },
                  { label: "Missing Pickup Location", key: "missingPickupLocation", color: "text-orange-400 border-orange-500/30 bg-orange-500/10" },
                  { label: "Missing Product Vendor", key: "missingProductVendor", color: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10" },
                  { label: "Missing Approval Token", key: "missingApprovalToken", color: "text-blue-400 border-blue-500/30 bg-blue-500/10" },
                ].map((b) => (
                  <Badge key={b.key} variant="outline" className={`text-xs ${b.color}`}>
                    {b.label}: {(missingQ.data as any)?.summary?.[b.key] ?? 0}
                  </Badge>
                ))}
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {((missingQ.data as any)?.orders ?? []).map((r: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-slate-700/40">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-indigo-400">{r.order_number}</span>
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">{r.status}</Badge>
                        </div>
                        <div className="text-sm text-slate-300 mt-0.5">{r.customer_name}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {r.missing_ready_date && <Badge variant="outline" className="text-xs text-red-400 border-red-500/30 bg-red-500/10">No ready date</Badge>}
                          {r.missing_pickup_location && <Badge variant="outline" className="text-xs text-orange-400 border-orange-500/30 bg-orange-500/10">No pickup loc</Badge>}
                          {r.missing_product_vendor && <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-500/30 bg-yellow-500/10">No vendor</Badge>}
                          {r.missing_approval_token && <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30 bg-blue-500/10">No token</Badge>}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-slate-600 text-slate-300 hover:text-white shrink-0"
                        onClick={() => openOverride("resend-product-approval", r.id, r.order_number)}
                      >
                        Resend Approval
                      </Button>
                    </div>
                  </div>
                ))}
                {!missingQ.isLoading && ((missingQ.data as any)?.orders ?? []).length === 0 && (
                  <div className="text-center text-slate-500 text-sm py-6">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-500/40" />
                    Semua data lengkap ✓
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Exceptions */}
        <TabsContent value="exceptions">
          <div className="space-y-4">
            {/* By type summary */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300">Open Exceptions by Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {((excQ.data as any)?.byType ?? []).map((t: any, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs border-slate-600 text-slate-300">
                      {t.exception_type.replace(/_/g, " ")}: {t.count}
                    </Badge>
                  ))}
                  {!excQ.isLoading && ((excQ.data as any)?.byType ?? []).length === 0 && (
                    <span className="text-slate-500 text-sm">Tidak ada open exceptions</span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Recent open exceptions */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300">Recent Open Exceptions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {((excQ.data as any)?.recentOpen ?? []).map((e: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg bg-slate-700/40 flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs ${SEV_CLASS[e.severity] ?? ""}`}>
                            {e.severity}
                          </Badge>
                          <span className="font-mono text-xs text-indigo-400">{e.order_number}</span>
                        </div>
                        <div className="text-sm text-slate-200 mt-0.5">{e.title}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {e.exception_type.replace(/_/g, " ")} · {e.customer_name}
                        </div>
                      </div>
                      <span className="text-xs text-slate-500 shrink-0">
                        {new Date(e.created_at).toLocaleDateString("id-ID")}
                      </span>
                    </div>
                  ))}
                  {!excQ.isLoading && ((excQ.data as any)?.recentOpen ?? []).length === 0 && (
                    <div className="text-center text-slate-500 text-sm py-6">
                      <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-500/40" />
                      Tidak ada open exceptions ✓
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Admin Override Tab */}
        <TabsContent value="override">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                <Wrench className="w-4 h-4 text-amber-400" />
                Admin Override Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 mb-6">
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-300">
                    Semua aksi override dicatat di <strong>order_audit_logs</strong> dengan alasan dan nama operator.
                    Override hanya untuk situasi emergency — perubahan tidak dapat di-undo otomatis.
                  </div>
                </div>
              </div>

              <div className="text-sm text-slate-400 mb-4">
                Pilih order dari tab <strong>Blocked Orders</strong> atau <strong>Missing Data</strong> untuk menjalankan override,
                atau gunakan tombol di bawah untuk memasukkan Order ID secara manual.
              </div>

              <OverrideManualCards overrideLabels={overrideLabels} openOverride={openOverride} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Override Dialog */}
      <Dialog open={override.open} onOpenChange={(o) => setOverride((p) => ({ ...p, open: o }))}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <Wrench className="w-4 h-4" />
              {override.type ? overrideLabels[override.type] : "Override"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="text-sm text-slate-300">
              Order: <span className="font-mono text-indigo-400">{override.orderNumber}</span>
            </div>

            {override.type === "change-shipment-mode" && (
              <div className="space-y-1">
                <Label className="text-xs text-slate-400">Mode Pengiriman Baru</Label>
                <Select value={newShipmentMode} onValueChange={setNewShipmentMode}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600 text-white">
                    <SelectItem value="trucking">Trucking</SelectItem>
                    <SelectItem value="pickup_self">Pickup Mandiri</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {override.type === "resend-product-approval" && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="regen"
                  checked={regenerateToken}
                  onChange={(e) => setRegenerateToken(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="regen" className="text-xs text-slate-300 cursor-pointer">
                  Generate token baru (link lama tidak berlaku)
                </Label>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Alasan Override <span className="text-red-400">*</span></Label>
              <Textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Jelaskan alasan override ini..."
                className="bg-slate-700 border-slate-600 text-white text-sm min-h-[80px] resize-none"
              />
            </div>

            <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                Aksi ini akan dicatat di audit log beserta nama Anda dan alasan yang diberikan.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-slate-600 text-slate-300"
              onClick={() => setOverride((p) => ({ ...p, open: false }))}
            >
              Batal
            </Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-500 text-white"
              onClick={submitOverride}
              disabled={!overrideReason.trim() || overrideMut.isPending}
            >
              {overrideMut.isPending ? "Memproses..." : "Konfirmasi Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
