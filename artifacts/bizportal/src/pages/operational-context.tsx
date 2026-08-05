import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Truck, Building2, DollarSign, Activity, Bot, AlertTriangle,
  ShieldCheck, CheckCircle2, XCircle, Clock, RefreshCw,
  TrendingUp, Route, Calendar, Layers, Sparkles, ChevronDown, ChevronUp,
  Search,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

// ── Types ──────────────────────────────────────────────────────────────────────

interface VendorPerf {
  totalOrders: number;
  ontimePercentage: number;
  etaAccuracyScore: number;
  orderSuccessRate: number;
  recommendationScore: number;
  cancelRate: number;
  podCompletenessScore: number;
}

interface OperationalContext {
  entityType: "logistic_order" | "freight_shipment";
  entityId: number;
  entityRef: string;
  companyId: number | null;
  vendor: {
    vendorId: number | null;
    vendorName: string | null;
    serviceType: string | null;
    isActive: boolean;
    etaDaysMin: number | null;
    etaDaysMax: number | null;
    performance: VendorPerf | null;
    pendingVmfSubmissions: number;
    approvedVmfPrice: number | null;
  };
  financial: {
    salesDocId: number | null;
    salesDocNumber: string | null;
    salesDocStatus: string | null;
    grandTotal: number | null;
    invoiceStatus: string | null;
    paymentStatus: string | null;
    amountPaid: number | null;
    marginPct: number | null;
    actualCost: number | null;
    currency: string;
  };
  operational: {
    status: string;
    origin: string | null;
    destination: string | null;
    transportMode: string | null;
    eta: string | null;
    etd: string | null;
    currentStage: string | null;
    stageHistory: Array<{
      stageFrom: string | null;
      stageTo: string;
      actorName: string | null;
      actorType: string;
      notes: string | null;
      createdAt: string;
    }>;
    etaDaysRemaining: number | null;
    delayRisk: "none" | "low" | "medium" | "high" | "critical";
  };
  alerts: Array<{
    id: number;
    alertType: string;
    severity: "critical" | "warning" | "info";
    title: string;
    message: string;
    status: string;
    createdAt: string;
  }>;
  aiActivity: {
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
  };
  healthSignal: "healthy" | "warning" | "critical" | "unknown";
  builtAt: string;
  cacheTtlSeconds: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const HEALTH_CONFIG = {
  healthy:  { label: "Sehat",      color: "bg-green-100 text-green-800 border-green-200",   dot: "bg-green-500"  },
  warning:  { label: "Perhatian",  color: "bg-yellow-100 text-yellow-800 border-yellow-200", dot: "bg-yellow-500" },
  critical: { label: "Kritis",     color: "bg-red-100 text-red-800 border-red-200",          dot: "bg-red-500"    },
  unknown:  { label: "Tidak Diketahui", color: "bg-gray-100 text-gray-600 border-gray-200", dot: "bg-gray-400"   },
};

const DELAY_RISK_CONFIG = {
  none:     { label: "Aman",      color: "text-green-600"  },
  low:      { label: "Rendah",    color: "text-blue-600"   },
  medium:   { label: "Sedang",    color: "text-yellow-600" },
  high:     { label: "Tinggi",    color: "text-orange-600" },
  critical: { label: "Kritis",    color: "text-red-600"    },
};

const SEVERITY_COLOR = {
  critical: "bg-red-50 border-red-200 text-red-700",
  warning:  "bg-yellow-50 border-yellow-200 text-yellow-700",
  info:     "bg-blue-50 border-blue-200 text-blue-700",
};

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtRp(n: number | null | undefined): string {
  if (n == null) return "—";
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  try { return format(new Date(s), "dd MMM yyyy HH:mm", { locale: idLocale }); } catch { return s; }
}

function fmtAgo(s: string | null): string {
  if (!s) return "—";
  try { return formatDistanceToNow(new Date(s), { addSuffix: true, locale: idLocale }); } catch { return s; }
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{fmt(pct, 1)}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Context Panels ─────────────────────────────────────────────────────────────

function VendorPanel({ vendor }: { vendor: OperationalContext["vendor"] }) {
  const [showPerf, setShowPerf] = useState(false);
  if (!vendor.vendorName) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        <Building2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
        Belum ada vendor yang di-assign
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{vendor.vendorName}</p>
          <p className="text-xs text-muted-foreground">{vendor.serviceType ?? "—"}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={vendor.isActive ? "default" : "destructive"} className="text-[10px]">
            {vendor.isActive ? "Aktif" : "Nonaktif"}
          </Badge>
          {vendor.etaDaysMin != null && (
            <Badge variant="outline" className="text-[10px]">
              ETA {vendor.etaDaysMin}–{vendor.etaDaysMax ?? "?"} hari
            </Badge>
          )}
        </div>
      </div>
      {vendor.approvedVmfPrice != null && (
        <div className="bg-green-50 border border-green-200 rounded p-2 text-xs">
          <span className="font-medium text-green-700">Harga disetujui: </span>
          <span className="font-mono">{fmtRp(vendor.approvedVmfPrice)}</span>
        </div>
      )}
      {vendor.pendingVmfSubmissions > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-700">
          {vendor.pendingVmfSubmissions} penawaran VMF menunggu review
        </div>
      )}
      {vendor.performance && (
        <>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowPerf(v => !v)}
          >
            {showPerf ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Performa vendor ({vendor.performance.totalOrders} order)
          </button>
          {showPerf && (
            <div className="space-y-2 pt-1">
              <ScoreBar value={vendor.performance.ontimePercentage} label="On-time Delivery" />
              <ScoreBar value={vendor.performance.etaAccuracyScore} label="ETA Accuracy" />
              <ScoreBar value={vendor.performance.orderSuccessRate} label="Order Success Rate" />
              <ScoreBar value={vendor.performance.podCompletenessScore} label="POD Completeness" />
              <ScoreBar value={vendor.performance.recommendationScore} label="Recommendation Score" />
              <div className="text-[10px] text-muted-foreground">
                Cancel Rate: {fmt(vendor.performance.cancelRate, 1)}%
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FinancialPanel({ financial }: { financial: OperationalContext["financial"] }) {
  const marginColor = financial.marginPct == null ? "text-muted-foreground"
    : financial.marginPct >= 20 ? "text-green-600"
    : financial.marginPct >= 10 ? "text-yellow-600"
    : "text-red-600";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted/40 rounded p-2.5">
          <p className="text-[10px] text-muted-foreground mb-0.5">Nilai Penjualan</p>
          <p className="font-mono font-medium text-sm">{fmtRp(financial.grandTotal)}</p>
        </div>
        <div className="bg-muted/40 rounded p-2.5">
          <p className="text-[10px] text-muted-foreground mb-0.5">Biaya Aktual</p>
          <p className="font-mono font-medium text-sm">{fmtRp(financial.actualCost)}</p>
        </div>
        <div className="bg-muted/40 rounded p-2.5">
          <p className="text-[10px] text-muted-foreground mb-0.5">Margin</p>
          <p className={`font-mono font-medium text-sm ${marginColor}`}>
            {financial.marginPct != null ? `${fmt(financial.marginPct, 1)}%` : "—"}
          </p>
        </div>
        <div className="bg-muted/40 rounded p-2.5">
          <p className="text-[10px] text-muted-foreground mb-0.5">Sudah Dibayar</p>
          <p className="font-mono font-medium text-sm">{fmtRp(financial.amountPaid)}</p>
        </div>
      </div>
      {financial.salesDocNumber && (
        <div className="border rounded p-2.5 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">No. Dokumen</span>
            <span className="font-mono">{financial.salesDocNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status Dokumen</span>
            <Badge variant="outline" className="text-[10px]">{financial.salesDocStatus ?? "—"}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status Invoice</span>
            <Badge variant="outline" className="text-[10px]">{financial.invoiceStatus ?? "—"}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status Pembayaran</span>
            <Badge variant="outline" className="text-[10px]">{financial.paymentStatus ?? "—"}</Badge>
          </div>
        </div>
      )}
    </div>
  );
}

function OperationalPanel({ operational }: { operational: OperationalContext["operational"] }) {
  const [showHistory, setShowHistory] = useState(false);
  const riskCfg = DELAY_RISK_CONFIG[operational.delayRisk];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted/40 rounded p-2.5">
          <p className="text-[10px] text-muted-foreground mb-0.5">Status</p>
          <Badge variant="outline" className="text-[10px]">{operational.status}</Badge>
        </div>
        <div className="bg-muted/40 rounded p-2.5">
          <p className="text-[10px] text-muted-foreground mb-0.5">Stage Saat Ini</p>
          <p className="text-sm font-medium">{operational.currentStage ?? "—"}</p>
        </div>
        <div className="bg-muted/40 rounded p-2.5">
          <p className="text-[10px] text-muted-foreground mb-0.5">ETA</p>
          <p className="text-sm">{operational.eta ? fmtDate(operational.eta) : "—"}</p>
          {operational.etaDaysRemaining != null && (
            <p className={`text-[10px] mt-0.5 ${riskCfg.color}`}>
              {operational.etaDaysRemaining >= 0
                ? `${operational.etaDaysRemaining} hari lagi`
                : `${Math.abs(operational.etaDaysRemaining)} hari lewat`}
            </p>
          )}
        </div>
        <div className="bg-muted/40 rounded p-2.5">
          <p className="text-[10px] text-muted-foreground mb-0.5">Delay Risk</p>
          <p className={`text-sm font-medium ${riskCfg.color}`}>{riskCfg.label}</p>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <div className="flex gap-2">
          <Route className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{operational.origin ?? "—"} → {operational.destination ?? "—"}</span>
        </div>
        {operational.transportMode && (
          <div className="flex gap-2">
            <Truck className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{operational.transportMode}</span>
          </div>
        )}
        {operational.etd && (
          <div className="flex gap-2">
            <Calendar className="h-3 w-3 mt-0.5 shrink-0" />
            <span>ETD: {fmtDate(operational.etd)}</span>
          </div>
        )}
      </div>

      {operational.stageHistory.length > 0 && (
        <>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowHistory(v => !v)}
          >
            {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Riwayat stage ({operational.stageHistory.length})
          </button>
          {showHistory && (
            <div className="space-y-1.5 border-l-2 border-muted pl-3 ml-1">
              {operational.stageHistory.map((s, i) => (
                <div key={i} className="text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground -ml-4 mr-2 shrink-0" />
                    <span className="font-medium">{s.stageTo}</span>
                    {s.actorName && <span className="text-muted-foreground">oleh {s.actorName}</span>}
                  </div>
                  <p className="text-muted-foreground/70 ml-0 pl-0">{fmtAgo(s.createdAt)}</p>
                  {s.notes && <p className="text-muted-foreground italic">{s.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AlertsPanel({ alerts }: { alerts: OperationalContext["alerts"] }) {
  if (alerts.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-400" />
        Tidak ada alert aktif
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {alerts.map(alert => (
        <div key={alert.id} className={`rounded border p-2.5 text-xs ${SEVERITY_COLOR[alert.severity]}`}>
          <div className="flex justify-between gap-2">
            <p className="font-medium">{alert.title}</p>
            <span className="text-[10px] shrink-0">{fmtAgo(alert.createdAt)}</span>
          </div>
          <p className="mt-0.5 opacity-80">{alert.message}</p>
        </div>
      ))}
    </div>
  );
}

function AiActivityPanel({ aiActivity }: { aiActivity: OperationalContext["aiActivity"] }) {
  return (
    <div className="space-y-4">
      {aiActivity.pendingApprovals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-yellow-700 flex items-center gap-1">
            <Clock className="h-3 w-3" /> Menunggu Persetujuan ({aiActivity.pendingApprovals.length})
          </p>
          {aiActivity.pendingApprovals.map(a => (
            <div key={a.id} className="bg-yellow-50 border border-yellow-200 rounded p-2.5 text-xs">
              <p className="font-medium">{a.actionDescription}</p>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline" className="text-[10px]">{a.priority}</Badge>
                <span className="text-muted-foreground">Exp: {fmtDate(a.expiresAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {aiActivity.recentExecutions.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <Bot className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
          Belum ada aktivitas AI
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
            <Activity className="h-3 w-3" /> Eksekusi AI Terbaru
          </p>
          {aiActivity.recentExecutions.map(e => (
            <div key={e.id} className="flex items-start gap-3 border rounded p-2.5 text-xs">
              <div className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                e.status === "completed" ? "bg-green-500"
                : e.status === "failed" ? "bg-red-500"
                : e.status === "awaiting_approval" ? "bg-yellow-500"
                : "bg-blue-500"
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{e.action}</span>
                  <span className="text-muted-foreground shrink-0">{fmtAgo(e.createdAt)}</span>
                </div>
                <p className="text-muted-foreground">{e.agentType}</p>
                {e.outputSummary && <p className="mt-0.5 text-muted-foreground/70 truncate">{e.outputSummary}</p>}
                {e.confidence != null && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Sparkles className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{Math.round(e.confidence * 100)}% confidence</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Context Card ──────────────────────────────────────────────────────────

function ContextViewer({ ctx, onRefresh }: { ctx: OperationalContext; onRefresh: () => void }) {
  const healthCfg = HEALTH_CONFIG[ctx.healthSignal];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold font-mono">{ctx.entityRef}</h2>
            <Badge variant="outline" className="text-[10px]">
              {ctx.entityType === "logistic_order" ? "Logistic Order" : "Freight Shipment"}
            </Badge>
            <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium ${healthCfg.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${healthCfg.dot}`} />
              {healthCfg.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Context dibangun {fmtAgo(ctx.builtAt)} · cache {ctx.cacheTtlSeconds}s
            {ctx.alerts.length > 0 && ` · ${ctx.alerts.length} alert aktif`}
            {ctx.aiActivity.pendingApprovals.length > 0 && ` · ${ctx.aiActivity.pendingApprovals.length} approval pending`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Domain Panels */}
      <Tabs defaultValue="vendor">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="vendor" className="text-xs">
            <Building2 className="h-3 w-3 mr-1" /> Vendor
          </TabsTrigger>
          <TabsTrigger value="financial" className="text-xs">
            <DollarSign className="h-3 w-3 mr-1" /> Finance
          </TabsTrigger>
          <TabsTrigger value="operational" className="text-xs">
            <Truck className="h-3 w-3 mr-1" /> Ops
          </TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Alert {ctx.alerts.length > 0 && <span className="ml-1 rounded-full bg-red-500 text-white text-[9px] px-1">{ctx.alerts.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="ai" className="text-xs">
            <Bot className="h-3 w-3 mr-1" />
            AI {ctx.aiActivity.pendingApprovals.length > 0 && <span className="ml-1 rounded-full bg-yellow-500 text-white text-[9px] px-1">{ctx.aiActivity.pendingApprovals.length}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="vendor" className="mt-4"><VendorPanel vendor={ctx.vendor} /></TabsContent>
        <TabsContent value="financial" className="mt-4"><FinancialPanel financial={ctx.financial} /></TabsContent>
        <TabsContent value="operational" className="mt-4"><OperationalPanel operational={ctx.operational} /></TabsContent>
        <TabsContent value="alerts" className="mt-4"><AlertsPanel alerts={ctx.alerts} /></TabsContent>
        <TabsContent value="ai" className="mt-4"><AiActivityPanel aiActivity={ctx.aiActivity} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function OperationalContextPage() {
  const [entityType, setEntityType] = useState<"order" | "shipment">("order");
  const [inputId, setInputId] = useState("");
  const [searchId, setSearchId] = useState<number | null>(null);

  const queryKey = ["operational-context", entityType, searchId];

  const { data: ctx, isLoading, error, refetch } = useQuery<OperationalContext>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/operational-context/${entityType}/${searchId}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? "Tidak ditemukan");
      }
      return res.json();
    },
    enabled: searchId != null,
    staleTime: 25_000,
    retry: false,
  });

  function handleSearch() {
    const id = parseInt(inputId.trim(), 10);
    if (!id || isNaN(id)) return;
    setSearchId(id);
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="h-6 w-6 text-indigo-500" />
            Operational Context
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Unified context per order/shipment — vendor, finance, ops, alerts, dan AI activity dalam satu tampilan.
          </p>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-3 items-end">
              <div className="flex gap-2">
                <Button
                  variant={entityType === "order" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setEntityType("order"); setSearchId(null); }}
                >
                  Logistic Order
                </Button>
                <Button
                  variant={entityType === "shipment" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setEntityType("shipment"); setSearchId(null); }}
                >
                  Freight Shipment
                </Button>
              </div>
              <div className="flex gap-2 flex-1">
                <Input
                  type="number"
                  placeholder={`ID ${entityType === "order" ? "logistic order" : "freight shipment"}...`}
                  value={inputId}
                  onChange={e => setInputId(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                  className="max-w-xs"
                />
                <Button onClick={handleSearch} disabled={!inputId.trim()}>
                  <Search className="h-4 w-4 mr-2" /> Lihat Context
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Result */}
        {isLoading && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent mx-auto mb-3" />
              Mengambil context dari semua domain...
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-red-200">
            <CardContent className="py-8 text-center">
              <XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-600">{(error as Error).message}</p>
            </CardContent>
          </Card>
        )}

        {ctx && !isLoading && (
          <Card>
            <CardContent className="pt-5">
              <ContextViewer ctx={ctx} onRefresh={() => refetch()} />
            </CardContent>
          </Card>
        )}

        {!searchId && !isLoading && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              <Layers className="h-12 w-12 mx-auto mb-3 text-indigo-200" />
              <p className="text-sm font-medium">Masukkan ID order atau shipment</p>
              <p className="text-xs mt-1">Context akan menampilkan vendor, finance, ops, alerts, dan AI activity sekaligus.</p>
            </CardContent>
          </Card>
        )}

        {/* Info Box */}
        <Card className="bg-indigo-50 border-indigo-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-indigo-700 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> Context Orchestrator — Phase 1 Cognitive Foundation
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-indigo-700/80 space-y-1 pb-4">
            <p>Service ini mengagregasi data dari <strong>6 domain</strong> secara paralel (vendor, finance, ops, alerts, AI executions, AI approvals) dalam satu query batch.</p>
            <p>Cache TTL 30 detik — setiap AI feature yang menggunakan context ini tidak perlu query ulang ke database.</p>
            <p className="font-medium">Dapat diimport langsung oleh AI agents: <code className="bg-indigo-100 px-1 rounded">import {"{ buildOrderContext }"} from "@/lib/contextOrchestrator"</code></p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
