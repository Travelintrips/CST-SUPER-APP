import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { QueryState } from "@/components/ui/query-state";
import { useToast } from "@/hooks/use-toast";
import {
  Star, RefreshCw, TrendingUp, Clock, Package, AlertCircle,
  CheckCircle, Trophy, Zap, Shield, DollarSign, FileText,
  MessageSquareWarning, ArrowLeft, BarChart3, XCircle,
} from "lucide-react";
import { Link } from "wouter";

const fmt = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `${(n / 1_000).toFixed(0)}K`
    : n.toFixed(0);

const pct = (n: string | null | undefined) =>
  n == null ? "—" : `${Number(n).toFixed(1)}%`;

const num = (n: string | number | null | undefined, fallback = "0") =>
  n == null ? fallback : Number(n).toLocaleString("id-ID");

const GRADE_META: Record<string, { color: string; bg: string; label: string }> = {
  "A+": { color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-300", label: "Terbaik" },
  "A":  { color: "text-blue-700",    bg: "bg-blue-50 border-blue-300",       label: "Sangat Baik" },
  "B":  { color: "text-yellow-700",  bg: "bg-yellow-50 border-yellow-300",   label: "Baik" },
  "C":  { color: "text-orange-700",  bg: "bg-orange-50 border-orange-300",   label: "Cukup" },
  "D":  { color: "text-red-700",     bg: "bg-red-50 border-red-300",         label: "Perlu Perbaikan" },
};

const SCORE_WEIGHTS = [
  { label: "On Time",            pct: "25%", key: "ontimePercentage",    icon: <CheckCircle className="h-3 w-3 text-green-500" /> },
  { label: "Win Rate",           pct: "20%", key: "winRate",             icon: <Trophy className="h-3 w-3 text-yellow-500" /> },
  { label: "Margin",             pct: "20%", key: "marginPct",           icon: <DollarSign className="h-3 w-3 text-emerald-500" /> },
  { label: "Response Speed",     pct: "15%", key: "avgResponseHours",    icon: <Zap className="h-3 w-3 text-blue-500" /> },
  { label: "POD Completeness",   pct: "10%", key: "podCompletenessScore",icon: <Package className="h-3 w-3 text-purple-500" /> },
  { label: "Cancellation Rate",  pct: "10%", key: "cancelRate",          icon: <Shield className="h-3 w-3 text-red-400" /> },
];

async function fetchVendorPerformance() {
  const r = await fetch("/api/vendor-performance");
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

async function recalcAll() {
  const r = await fetch("/api/vendor-performance/recalculate-all", { method: "POST" });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

function ScoreBar({ score, max = 100, color }: { score: number; max?: number; color?: string }) {
  const pct = Math.min((score / max) * 100, 100);
  const c = color ?? (pct >= 70 ? "bg-emerald-500" : pct >= 55 ? "bg-blue-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-400");
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`${c} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold w-8 text-right tabular-nums">{score.toFixed(0)}</span>
    </div>
  );
}

function GradeBadge({ grade }: { grade: string }) {
  const meta = GRADE_META[grade] ?? GRADE_META["D"];
  return (
    <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl border-2 font-black text-2xl ${meta.bg} ${meta.color}`}>
      {grade}
    </div>
  );
}

function StatBox({ label, value, sub, icon, accent }: {
  label: string; value: React.ReactNode; sub?: string;
  icon?: React.ReactNode; accent?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex items-center gap-1 text-xs text-muted-foreground`}>
        {icon}{label}
      </div>
      <div className={`text-sm font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function VendorPerformancePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"grade" | "margin" | "ontime" | "orders">("grade");

  const { data = [], isLoading } = useQuery({
    queryKey: ["vendor-performance"],
    queryFn: fetchVendorPerformance,
  });

  const recalcMut = useMutation({
    mutationFn: recalcAll,
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["vendor-performance"] });
      toast({ title: `Recalculate selesai — ${d.updated} vendor diperbarui` });
    },
    onError: () => toast({ title: "Gagal recalculate", variant: "destructive" }),
  });

  const filtered = (data as any[])
    .filter((v: any) => v.vendor.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a: any, b: any) => {
      const ap = a.perf, bp = b.perf;
      if (sortBy === "grade") return Number(bp?.preferredVendorScore ?? 0) - Number(ap?.preferredVendorScore ?? 0);
      if (sortBy === "margin") return Number(bp?.marginPct ?? 0) - Number(ap?.marginPct ?? 0);
      if (sortBy === "ontime") return Number(bp?.ontimePercentage ?? 0) - Number(ap?.ontimePercentage ?? 0);
      return Number(bp?.totalOrders ?? 0) - Number(ap?.totalOrders ?? 0);
    });

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href="/logistics-vendors">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                Vendor Performance & Rating
              </h1>
              <p className="text-muted-foreground text-xs">Scoring, grade, dan analitik performa vendor</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => recalcMut.mutate()} disabled={recalcMut.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${recalcMut.isPending ? "animate-spin" : ""}`} />
            Recalculate All
          </Button>
        </div>

        {/* Score formula legend */}
        <Card className="p-3">
          <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
            <BarChart3 className="h-3.5 w-3.5" /> Preferred Score Formula
          </div>
          <div className="flex flex-wrap gap-2">
            {SCORE_WEIGHTS.map(w => (
              <div key={w.key} className="flex items-center gap-1 text-xs bg-muted/50 rounded px-2 py-1">
                {w.icon}
                <span className="font-medium">{w.pct}</span>
                <span className="text-muted-foreground">{w.label}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Grade legend */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(GRADE_META).map(([g, m]) => (
            <div key={g} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-semibold ${m.bg} ${m.color}`}>
              <span className="font-black">{g}</span>
              <span className="font-normal opacity-70">{m.label}</span>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Cari vendor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="max-w-xs text-sm"
          />
          <div className="flex gap-1">
            {(["grade", "margin", "ontime", "orders"] as const).map(s => (
              <Button key={s} variant={sortBy === s ? "default" : "outline"} size="sm"
                onClick={() => setSortBy(s)} className="text-xs capitalize">
                {s === "grade" ? "Grade" : s === "margin" ? "Margin" : s === "ontime" ? "On-time" : "Orders"}
              </Button>
            ))}
          </div>
        </div>

        {/* Vendor Cards */}
        <QueryState loading={isLoading} empty={filtered.length === 0} emptyMessage="Tidak ada vendor ditemukan">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((v: any) => {
              const p = v.perf;
              const preferredScore = Number(p?.preferredVendorScore ?? 0);
              const grade = p?.vendorGrade ?? "D";
              const gradeMeta = GRADE_META[grade] ?? GRADE_META["D"];
              const totalRevenue = Number(p?.totalRevenue ?? 0);
              const totalCost    = Number(p?.totalCost    ?? 0);
              const totalMargin  = Number(p?.totalMargin  ?? 0);
              const marginPct    = Number(p?.marginPct    ?? 0);
              const winRate = (p?.totalRfqInvites ?? 0) > 0
                ? ((Number(p?.totalSelected ?? 0) / Number(p?.totalRfqInvites)) * 100)
                : 0;

              return (
                <Card key={v.vendor.id} className="hover:shadow-md transition-shadow overflow-hidden">
                  <CardContent className="p-0">
                    {/* Top strip: grade + name + score */}
                    <div className={`px-4 py-3 border-b flex items-center gap-3 ${gradeMeta.bg}`}>
                      <GradeBadge grade={grade} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{v.vendor.name}</div>
                        {v.vendor.serviceType && (
                          <div className="text-xs text-muted-foreground">{v.vendor.serviceType}</div>
                        )}
                        <div className="text-xs font-medium mt-0.5">
                          <span className={gradeMeta.color}>{gradeMeta.label}</span>
                          <span className="text-muted-foreground"> · {preferredScore.toFixed(1)} / 100</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-muted-foreground">{p?.totalOrders ?? 0} order</div>
                      </div>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Preferred Score bar */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 font-medium">Preferred Score</div>
                        <ScoreBar score={preferredScore} />
                      </div>

                      {/* Financial metrics */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 pb-3 border-b">
                        <StatBox
                          label="Revenue"
                          value={`Rp ${fmt(totalRevenue)}`}
                          icon={<DollarSign className="h-3 w-3 text-emerald-500" />}
                        />
                        <StatBox
                          label="Cost"
                          value={`Rp ${fmt(totalCost)}`}
                          icon={<DollarSign className="h-3 w-3 text-orange-400" />}
                        />
                        <StatBox
                          label="Margin"
                          value={`Rp ${fmt(totalMargin)}`}
                          icon={<TrendingUp className="h-3 w-3 text-blue-500" />}
                          accent={totalMargin >= 0 ? "text-emerald-600" : "text-red-500"}
                        />
                        <StatBox
                          label="Margin %"
                          value={`${marginPct.toFixed(1)}%`}
                          icon={<TrendingUp className="h-3 w-3 text-blue-500" />}
                          accent={marginPct >= 10 ? "text-emerald-600" : marginPct >= 0 ? "text-yellow-600" : "text-red-500"}
                        />
                      </div>

                      {/* Order stats */}
                      <div className="grid grid-cols-3 gap-x-2 gap-y-2 pb-3 border-b text-center">
                        <div>
                          <div className="text-xs text-muted-foreground flex items-center justify-center gap-0.5">
                            <CheckCircle className="h-3 w-3 text-green-500" /> Selesai
                          </div>
                          <div className="font-semibold text-sm text-green-600">{p?.completedOrders ?? 0}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground flex items-center justify-center gap-0.5">
                            <XCircle className="h-3 w-3 text-red-400" /> Batal
                          </div>
                          <div className="font-semibold text-sm text-red-500">{p?.cancelledOrders ?? 0}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Cancel Rate</div>
                          <div className={`font-semibold text-sm ${Number(p?.cancelRate ?? 0) > 20 ? "text-red-500" : "text-foreground"}`}>
                            {pct(p?.cancelRate)}
                          </div>
                        </div>
                      </div>

                      {/* POD & Invoice */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 pb-3 border-b">
                        <div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                            <Package className="h-3 w-3 text-purple-500" /> POD
                          </div>
                          <div className="flex gap-2 text-xs">
                            <span className="text-green-600 font-medium">✓ {p?.podUploadedCount ?? 0}</span>
                            <span className="text-red-500 font-medium">✗ {p?.podMissingCount ?? 0}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{pct(p?.podCompletenessScore)} lengkap</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                            <FileText className="h-3 w-3 text-blue-500" /> Invoice
                          </div>
                          <div className="flex gap-2 text-xs">
                            <span className="font-medium">{p?.invoiceIssuedCount ?? 0} issued</span>
                          </div>
                          <div className={`text-xs font-medium ${Number(p?.invoiceDisputeCount ?? 0) > 0 ? "text-red-500" : "text-muted-foreground"}`}>
                            {p?.invoiceDisputeCount ?? 0} dispute
                          </div>
                        </div>
                      </div>

                      {/* Performance KPIs */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pb-3 border-b text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <CheckCircle className="h-3 w-3 text-green-500" /> On-time
                          </span>
                          <span className="font-medium">{pct(p?.ontimePercentage)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Trophy className="h-3 w-3 text-yellow-500" /> Win Rate
                          </span>
                          <span className="font-medium">{winRate.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3 text-blue-500" /> Respon
                          </span>
                          <span className="font-medium">
                            {Number(p?.avgResponseHours ?? 0) > 0
                              ? `${Number(p.avgResponseHours).toFixed(1)} jam`
                              : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <MessageSquareWarning className="h-3 w-3 text-orange-400" /> Komplain
                          </span>
                          <span className={`font-medium ${Number(p?.customerComplaintCount ?? 0) > 0 ? "text-red-500" : ""}`}>
                            {p?.customerComplaintCount ?? 0}
                          </span>
                        </div>
                      </div>

                      {/* RFQ stats */}
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>RFQ: <b className="text-foreground">{p?.totalRfqInvites ?? 0}</b> undangan</span>
                        <span>·</span>
                        <span><b className="text-foreground">{p?.totalSelected ?? 0}</b> dipilih</span>
                        <span>·</span>
                        <span><b className="text-foreground">{p?.totalRejected ?? 0}</b> ditolak</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </QueryState>
      </div>
    </AppShell>
  );
}
