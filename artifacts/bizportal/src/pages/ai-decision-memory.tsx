import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  RefreshCw,
  Search,
  ChevronRight,
  BarChart3,
  Route,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DecisionMemoryItem {
  id: number;
  decision_type: string;
  origin: string | null;
  destination: string | null;
  shipment_type: string | null;
  transport_mode: string | null;
  commodity: string | null;
  chosen_entity_type: string;
  chosen_entity_id: number | null;
  chosen_entity_name: string;
  reasoning: string | null;
  confidence: string | null;
  decided_by: string;
  order_id: number | null;
  order_number: string | null;
  outcome: string | null;
  on_time_delivery: boolean | null;
  delay_days: number | null;
  actual_vendor_price: string | null;
  quoted_vendor_price: string | null;
  outcome_notes: string | null;
  outcome_updated_at: string | null;
  created_at: string;
}

interface ListResponse {
  items: DecisionMemoryItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface VendorStat {
  vendor_name: string;
  vendor_id: number;
  total_orders: string;
  completed_orders: string;
  on_time: string;
  late: string;
  on_time_pct: string | null;
  avg_delay_days: string | null;
  success_count: string;
  failure_count: string;
  last_used_at: string;
}

interface GlobalStat {
  total_decisions: string;
  with_outcome: string;
  pending_outcome: string;
  success_count: string;
  failure_count: string;
  on_time_count: string;
  late_count: string;
  avg_delay_days: string | null;
  unique_vendors: string;
}

interface RouteStats {
  origin: string;
  destination: string;
  shipment_type: string | null;
  total_decisions: string;
  on_time_pct: string | null;
}

interface StatsResponse {
  global: GlobalStat;
  byVendor: VendorStat[];
  recentDecisions: DecisionMemoryItem[];
  topRoutes: RouteStats[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const OUTCOME_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  success: { label: "Sukses", variant: "default" },
  failure: { label: "Gagal", variant: "destructive" },
  partial: { label: "Parsial", variant: "secondary" },
  cancelled: { label: "Dibatalkan", variant: "outline" },
};

const DECISION_TYPE_LABEL: Record<string, string> = {
  vendor_assignment: "Pilih Vendor",
  route_selection: "Pilih Rute",
  pricing: "Pricing",
  escalation: "Eskalasi",
  classification: "Klasifikasi",
};

function OnTimeIndicator({ value, delayDays }: { value: boolean | null; delayDays?: number | null }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground text-xs">—</span>;
  if (value) return (
    <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
      <CheckCircle2 className="h-3.5 w-3.5" /> On-time
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-red-600 text-xs font-medium">
      <AlertTriangle className="h-3.5 w-3.5" />
      Terlambat {delayDays ? `${delayDays} hari` : ""}
    </span>
  );
}

function OnTimePctBadge({ pct }: { pct: string | null }) {
  if (!pct) return <span className="text-muted-foreground text-xs">—</span>;
  const num = parseFloat(pct);
  const color = num >= 80 ? "text-green-600" : num >= 60 ? "text-yellow-600" : "text-red-600";
  return <span className={`font-bold text-sm ${color}`}>{num.toFixed(1)}%</span>;
}

// ─── API Calls ───────────────────────────────────────────────────────────────

async function fetchList(params: Record<string, string>): Promise<ListResponse> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/ai/decision-memory?${qs}`, { credentials: "include" });
  if (!res.ok) throw new Error("Gagal mengambil data");
  return res.json();
}

async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch("/api/ai/decision-memory/stats", { credentials: "include" });
  if (!res.ok) throw new Error("Gagal mengambil statistik");
  return res.json();
}

async function updateOutcome(id: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/ai/decision-memory/${id}/outcome`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Gagal update outcome");
  return res.json();
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AiDecisionMemoryPage() {
  const qc = useQueryClient();

  // Filters
  const [search, setSearch] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [page, setPage] = useState(1);

  // Outcome dialog
  const [outcomeDialog, setOutcomeDialog] = useState<DecisionMemoryItem | null>(null);
  const [outcomeForm, setOutcomeForm] = useState({ outcome: "success", onTime: "true", delayDays: "", notes: "" });

  // Build query params
  const listParams: Record<string, string> = { page: String(page), limit: "25" };
  if (filterOutcome !== "all") {
    if (filterOutcome === "pending") listParams["hasOutcome"] = "false";
    else listParams["outcome"] = filterOutcome;
  }
  if (filterType !== "all") listParams["decisionType"] = filterType;
  if (search) listParams["origin"] = search;

  const listQuery = useQuery({
    queryKey: ["ai-decision-memory-list", listParams],
    queryFn: () => fetchList(listParams),
    refetchInterval: 30_000,
  });

  const statsQuery = useQuery({
    queryKey: ["ai-decision-memory-stats"],
    queryFn: fetchStats,
    refetchInterval: 60_000,
  });

  const outcomeMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => updateOutcome(id, body),
    onSuccess: () => {
      toast({ title: "Outcome diperbarui" });
      qc.invalidateQueries({ queryKey: ["ai-decision-memory-list"] });
      qc.invalidateQueries({ queryKey: ["ai-decision-memory-stats"] });
      setOutcomeDialog(null);
    },
    onError: () => toast({ title: "Gagal update outcome", variant: "destructive" }),
  });

  const stats = statsQuery.data;
  const global = stats?.global;

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Brain className="h-6 w-6 text-violet-600" />
              <Link href="/settings"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

              <h1 className="text-2xl font-bold">Decision Memory Store</h1>
              <Badge variant="outline" className="text-xs border-violet-300 text-violet-700 bg-violet-50">
                <Sparkles className="h-3 w-3 mr-1" />
                Memori Institusional AI
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Rekam jejak setiap keputusan AI — vendor dipilih, hasil pengiriman, dan pola performa historis.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["ai-decision-memory-list"] });
              qc.invalidateQueries({ queryKey: ["ai-decision-memory-stats"] });
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Global Stats */}
        {global && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground mb-1">Total Keputusan</p>
                <p className="text-2xl font-bold">{global.total_decisions}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground mb-1">Ada Outcome</p>
                <p className="text-2xl font-bold text-green-600">{global.with_outcome}</p>
                <p className="text-xs text-muted-foreground">{global.pending_outcome} pending</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground mb-1">On-time Rate</p>
                <p className="text-2xl font-bold text-blue-600">
                  {global.on_time_count && global.with_outcome
                    ? `${Math.round((parseInt(global.on_time_count) / parseInt(global.with_outcome)) * 100)}%`
                    : "—"}
                </p>
                <p className="text-xs text-muted-foreground">{global.late_count} terlambat</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground mb-1">Rata-rata Delay</p>
                <p className="text-2xl font-bold text-orange-600">
                  {global.avg_delay_days ? `${parseFloat(global.avg_delay_days).toFixed(1)} hr` : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground mb-1">Vendor Unik</p>
                <p className="text-2xl font-bold text-violet-600">{global.unique_vendors}</p>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Vendor Performance Table */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-violet-600" />
                  Performa Vendor
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {statsQuery.isLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">Memuat...</div>
                ) : (stats?.byVendor ?? []).length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">Belum ada data</div>
                ) : (
                  <div className="divide-y">
                    {(stats?.byVendor ?? []).map((v) => (
                      <div key={v.vendor_id} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate max-w-[160px]" title={v.vendor_name}>
                            {v.vendor_name}
                          </span>
                          <OnTimePctBadge pct={v.on_time_pct} />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{v.total_orders} order</span>
                          <span className="text-green-600">{v.on_time} on-time</span>
                          {v.late !== "0" && <span className="text-red-500">{v.late} terlambat</span>}
                        </div>
                        {v.avg_delay_days && parseFloat(v.avg_delay_days) > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Avg delay: {parseFloat(v.avg_delay_days).toFixed(1)} hari
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Routes */}
            {(stats?.topRoutes ?? []).length > 0 && (
              <Card className="mt-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Route className="h-4 w-4 text-blue-600" />
                    Rute Teratas
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {(stats?.topRoutes ?? []).slice(0, 6).map((r, i) => (
                      <div key={i} className="px-4 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">
                            {r.origin} <ChevronRight className="h-3 w-3 inline" /> {r.destination}
                          </span>
                          <OnTimePctBadge pct={r.on_time_pct} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {r.total_decisions}x · {r.shipment_type ?? "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Decision List */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari origin..."
                  className="pl-8 h-9"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                />
              </div>
              <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(1); }}>
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="Tipe keputusan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua tipe</SelectItem>
                  <SelectItem value="vendor_assignment">Pilih Vendor</SelectItem>
                  <SelectItem value="route_selection">Pilih Rute</SelectItem>
                  <SelectItem value="pricing">Pricing</SelectItem>
                  <SelectItem value="escalation">Eskalasi</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterOutcome} onValueChange={(v) => { setFilterOutcome(v); setPage(1); }}>
                <SelectTrigger className="h-9 w-[130px]">
                  <SelectValue placeholder="Outcome" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="pending">Pending outcome</SelectItem>
                  <SelectItem value="success">Sukses</SelectItem>
                  <SelectItem value="failure">Gagal</SelectItem>
                  <SelectItem value="partial">Parsial</SelectItem>
                  <SelectItem value="cancelled">Dibatalkan</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* List */}
            {listQuery.isLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Memuat data...</div>
            ) : (listQuery.data?.items ?? []).length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Brain className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
                  <p className="text-muted-foreground text-sm">Belum ada keputusan terekam.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Keputusan akan otomatis dicatat saat vendor di-assign ke order.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {(listQuery.data?.items ?? []).map((item) => (
                  <DecisionCard
                    key={item.id}
                    item={item}
                    onUpdateOutcome={() => {
                      setOutcomeDialog(item);
                      setOutcomeForm({ outcome: "success", onTime: "true", delayDays: "", notes: "" });
                    }}
                  />
                ))}

                {/* Pagination */}
                {listQuery.data && listQuery.data.pages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-xs text-muted-foreground">
                      {listQuery.data.total} total · halaman {page}/{listQuery.data.pages}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                        Sebelumnya
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= listQuery.data.pages}>
                        Berikutnya
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Outcome Dialog */}
      <Dialog open={!!outcomeDialog} onOpenChange={(open) => !open && setOutcomeDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Outcome Keputusan</DialogTitle>
          </DialogHeader>
          {outcomeDialog && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground bg-muted rounded p-3">
                <p className="font-medium text-foreground">{outcomeDialog.chosen_entity_name}</p>
                <p>{outcomeDialog.origin ?? "—"} → {outcomeDialog.destination ?? "—"}</p>
                <p>Order: {outcomeDialog.order_number ?? "—"}</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Outcome</label>
                <Select value={outcomeForm.outcome} onValueChange={(v) => setOutcomeForm(f => ({ ...f, outcome: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="success">Sukses</SelectItem>
                    <SelectItem value="failure">Gagal</SelectItem>
                    <SelectItem value="partial">Parsial</SelectItem>
                    <SelectItem value="cancelled">Dibatalkan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">On-time delivery?</label>
                <Select value={outcomeForm.onTime} onValueChange={(v) => setOutcomeForm(f => ({ ...f, onTime: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Ya — on-time</SelectItem>
                    <SelectItem value="false">Tidak — terlambat</SelectItem>
                    <SelectItem value="unknown">Tidak diketahui</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {outcomeForm.onTime === "false" && (
                <div>
                  <label className="text-sm font-medium mb-1 block">Hari terlambat</label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="contoh: 2"
                    value={outcomeForm.delayDays}
                    onChange={(e) => setOutcomeForm(f => ({ ...f, delayDays: e.target.value }))}
                  />
                </div>
              )}
              <div>
                <label className="text-sm font-medium mb-1 block">Catatan outcome (opsional)</label>
                <Textarea
                  rows={2}
                  placeholder="Keterangan tambahan..."
                  value={outcomeForm.notes}
                  onChange={(e) => setOutcomeForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutcomeDialog(null)}>Batal</Button>
            <Button
              onClick={() => {
                if (!outcomeDialog) return;
                outcomeMutation.mutate({
                  id: outcomeDialog.id,
                  body: {
                    outcome: outcomeForm.outcome,
                    onTimeDelivery: outcomeForm.onTime === "unknown" ? undefined : outcomeForm.onTime === "true",
                    delayDays: outcomeForm.delayDays ? parseInt(outcomeForm.delayDays) : undefined,
                    outcomeNotes: outcomeForm.notes || undefined,
                  },
                });
              }}
              disabled={outcomeMutation.isPending}
            >
              {outcomeMutation.isPending ? "Menyimpan..." : "Simpan Outcome"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// ─── Decision Card ───────────────────────────────────────────────────────────

function DecisionCard({ item, onUpdateOutcome }: { item: DecisionMemoryItem; onUpdateOutcome: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const outcomeInfo = item.outcome ? OUTCOME_BADGE[item.outcome] : null;

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Top row */}
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <span className="text-sm font-semibold truncate">{item.chosen_entity_name}</span>
              <Badge variant="outline" className="text-xs shrink-0">
                {DECISION_TYPE_LABEL[item.decision_type] ?? item.decision_type}
              </Badge>
              {outcomeInfo ? (
                <Badge variant={outcomeInfo.variant} className="text-xs shrink-0">{outcomeInfo.label}</Badge>
              ) : (
                <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground border-dashed">
                  <Clock className="h-3 w-3 mr-1" />Belum ada outcome
                </Badge>
              )}
            </div>

            {/* Route */}
            {(item.origin || item.destination) && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <Truck className="h-3.5 w-3.5" />
                <span>{item.origin ?? "?"}</span>
                <ChevronRight className="h-3 w-3" />
                <span>{item.destination ?? "?"}</span>
                {item.shipment_type && <span className="ml-1 text-muted-foreground">· {item.shipment_type}</span>}
              </div>
            )}

            {/* On-time + timing */}
            <div className="flex items-center flex-wrap gap-3 text-xs text-muted-foreground">
              <OnTimeIndicator value={item.on_time_delivery} delayDays={item.delay_days} />
              {item.order_number && (
                <span>Order #{item.order_number}</span>
              )}
              <span>{formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: idLocale })}</span>
              <span className="capitalize">{item.decided_by === "ai" ? "🤖 AI" : "👤 Admin"}</span>
            </div>

            {/* Expanded: reasoning */}
            {expanded && item.reasoning && (
              <div className="mt-2 p-2 rounded bg-muted text-xs text-muted-foreground border-l-2 border-violet-300">
                <p className="font-medium text-foreground mb-0.5">Reasoning:</p>
                {item.reasoning}
              </div>
            )}
            {expanded && item.outcome_notes && (
              <div className="mt-1 p-2 rounded bg-muted text-xs text-muted-foreground border-l-2 border-blue-300">
                <p className="font-medium text-foreground mb-0.5">Catatan outcome:</p>
                {item.outcome_notes}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1 shrink-0">
            {!item.outcome && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onUpdateOutcome}>
                Set Outcome
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setExpanded(e => !e)}
            >
              {expanded ? "Sembunyikan" : "Detail"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
