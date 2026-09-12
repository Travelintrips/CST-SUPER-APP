import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Trophy, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, ChevronUp,
  Star, Zap, Shield, Award, Search, BarChart3, AlertCircle
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

interface VendorRaw {
  vendor: {
    id: number;
    name: string;
    contactPhone?: string;
    serviceType?: string;
  };
  perf: {
    totalOrders: number;
    completedOrders: number;
    ontimePercentage: string;
    averageResponseMinutes: string;
    podCompletenessScore: string;
    cancelRate: string;
    recommendationScore: string;
  } | null;
  badges: string[];
}

interface ScoreEntry {
  vendorId: number;
  vendorName: string;
  aiScore: number;
  tier: "top" | "good" | "moderate" | "new";
  globalScore: number;
  routeOrderCount: number;
  routeOnTimePct: number | null;
  avgDelayDays: number;
  dataConfidence: "high" | "medium" | "low" | "none";
  scoreBullets: string[];
  badges: string[];
}

interface TrendPoint {
  month: string;
  aiScore: number;
  ontimePct: number;
  successRate: number;
  avgResponseMin: number;
  totalOrders: number;
}

const TIER_CONFIG = {
  top:      { label: "Top Tier",   cls: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: Trophy,  bar: "bg-yellow-500" },
  good:     { label: "Good",       cls: "bg-blue-100 text-blue-800 border-blue-300",       icon: Star,    bar: "bg-blue-500"   },
  moderate: { label: "Moderate",   cls: "bg-gray-100 text-gray-700 border-gray-300",       icon: Minus,   bar: "bg-gray-400"   },
  new:      { label: "New Vendor", cls: "bg-slate-100 text-slate-600 border-slate-200",    icon: AlertCircle, bar: "bg-slate-300" },
};

const BADGE_ICONS: Record<string, React.ReactNode> = {
  "Top Vendor":    <Trophy className="h-3 w-3" />,
  "Route Expert":  <Award className="h-3 w-3" />,
  "Fast Response": <Zap className="h-3 w-3" />,
  "Trusted":       <Shield className="h-3 w-3" />,
  "Trusted Vendor":<Shield className="h-3 w-3" />,
  "Best ETA":      <Star className="h-3 w-3" />,
};

const SHIPMENT_TYPES = ["FCL", "LCL", "Trucking", "Air", "Rail", "Multimodal"];

function ScoreBar({ score, tier }: { score: number; tier: keyof typeof TIER_CONFIG }) {
  const pct = Math.min(100, Math.max(0, score));
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${TIER_CONFIG[tier].bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums w-8 text-right">{score}</span>
    </div>
  );
}

function TrendChart({ vendorId, vendorName }: { vendorId: number; vendorName: string }) {
  const { data, isLoading } = useQuery<TrendPoint[]>({
    queryKey: ["vendor-trend", vendorId],
    queryFn: async () => {
      const r = await fetch(`/api/vendor-performance/trend/${vendorId}`);
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data || data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
        <BarChart3 className="h-5 w-5 mr-2 opacity-40" />
        Belum ada data historis untuk {vendorName}
      </div>
    );
  }

  const fmt = (m: string) => {
    const [y, mo] = m.split("-");
    return `${mo}/${String(y).slice(2)}`;
  };

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tickFormatter={fmt} tick={{ fontSize: 10 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
        <Tooltip
          formatter={(v: number, name: string) => [`${v}%`, name === "aiScore" ? "AI Score" : name === "ontimePct" ? "On-Time %" : "Success %"]}
          labelFormatter={(l) => fmt(String(l))}
        />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="aiScore"     name="AI Score"  stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="ontimePct"   name="On-Time %" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" />
        <Line type="monotone" dataKey="successRate" name="Success %"  stroke="#10b981" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="2 2" />
      </LineChart>
    </ResponsiveContainer>
  );
}

function VendorRow({
  rank, entry, raw, expanded, onToggle, onRecalc
}: {
  rank: number;
  entry: ScoreEntry;
  raw: VendorRaw | undefined;
  expanded: boolean;
  onToggle: () => void;
  onRecalc: (id: number) => void;
}) {
  const tier = TIER_CONFIG[entry.tier];
  const TierIcon = tier.icon;
  const perf = raw?.perf;

  const trend = entry.routeOrderCount > 0
    ? entry.routeOnTimePct !== null && entry.routeOnTimePct >= 80
      ? <TrendingUp className="h-3.5 w-3.5 text-green-600" />
      : <TrendingDown className="h-3.5 w-3.5 text-red-500" />
    : <Minus className="h-3.5 w-3.5 text-muted-foreground" />;

  return (
    <>
      <tr
        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        {/* Rank */}
        <td className="py-3 px-4 text-center">
          {rank <= 3
            ? <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${rank === 1 ? "bg-yellow-400 text-yellow-900" : rank === 2 ? "bg-gray-300 text-gray-700" : "bg-amber-600 text-white"}`}>{rank}</span>
            : <span className="text-sm text-muted-foreground">{rank}</span>
          }
        </td>
        {/* Vendor */}
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <TierIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="font-medium text-sm">{entry.vendorName}</p>
              {raw?.vendor.serviceType && (
                <p className="text-xs text-muted-foreground">{raw.vendor.serviceType}</p>
              )}
            </div>
          </div>
        </td>
        {/* AI Score */}
        <td className="py-3 px-4">
          <ScoreBar score={entry.aiScore} tier={entry.tier} />
        </td>
        {/* Tier */}
        <td className="py-3 px-4">
          <Badge variant="outline" className={`text-xs gap-1 ${tier.cls}`}>
            <TierIcon className="h-3 w-3" />
            {tier.label}
          </Badge>
        </td>
        {/* Confidence */}
        <td className="py-3 px-4 text-center">
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
            entry.dataConfidence === "high"   ? "bg-green-100 text-green-700" :
            entry.dataConfidence === "medium" ? "bg-blue-100 text-blue-700"  :
            entry.dataConfidence === "low"    ? "bg-yellow-100 text-yellow-700" :
            "bg-gray-100 text-gray-500"
          }`}>
            {entry.dataConfidence === "none" ? "—" : entry.dataConfidence}
          </span>
        </td>
        {/* Key metrics */}
        <td className="py-3 px-4 text-center text-sm">
          {perf ? `${Number(perf.ontimePercentage).toFixed(0)}%` : "—"}
        </td>
        <td className="py-3 px-4 text-center text-sm">
          {perf ? `${Number(perf.averageResponseMinutes).toFixed(0)} min` : "—"}
        </td>
        <td className="py-3 px-4 text-center text-sm">
          {perf?.totalOrders ?? 0}
        </td>
        {/* Trend */}
        <td className="py-3 px-4 text-center">{trend}</td>
        {/* Badges */}
        <td className="py-3 px-4">
          <div className="flex flex-wrap gap-1">
            {entry.badges.slice(0, 2).map(b => (
              <span key={b} className="flex items-center gap-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded-full font-medium">
                {BADGE_ICONS[b]} {b}
              </span>
            ))}
          </div>
        </td>
        {/* Expand */}
        <td className="py-3 px-4 text-center">
          {expanded ? <ChevronUp className="h-4 w-4 mx-auto text-muted-foreground" /> : <ChevronDown className="h-4 w-4 mx-auto text-muted-foreground" />}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b bg-muted/10">
          <td colSpan={11} className="p-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Detail stats */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Detail Performa</h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <span className="text-muted-foreground">Global Score</span>
                  <span className="font-medium">{entry.globalScore}</span>
                  <span className="text-muted-foreground">Route Orders</span>
                  <span className="font-medium">{entry.routeOrderCount}</span>
                  {entry.routeOnTimePct !== null && (
                    <>
                      <span className="text-muted-foreground">Route On-Time</span>
                      <span className="font-medium">{entry.routeOnTimePct}%</span>
                    </>
                  )}
                  {entry.avgDelayDays > 0 && (
                    <>
                      <span className="text-muted-foreground">Rata-rata Delay</span>
                      <span className="font-medium text-orange-600">{entry.avgDelayDays} hari</span>
                    </>
                  )}
                  {perf && (
                    <>
                      <span className="text-muted-foreground">POD Completeness</span>
                      <span className="font-medium">{Number(perf.podCompletenessScore).toFixed(0)}%</span>
                      <span className="text-muted-foreground">Cancel Rate</span>
                      <span className={`font-medium ${Number(perf.cancelRate) > 10 ? "text-red-600" : ""}`}>{Number(perf.cancelRate).toFixed(1)}%</span>
                      <span className="text-muted-foreground">Completed Orders</span>
                      <span className="font-medium">{perf.completedOrders}</span>
                    </>
                  )}
                </div>
                <div className="space-y-1">
                  {entry.scoreBullets.map((b, i) => (
                    <p key={i} className="text-xs text-muted-foreground">• {b}</p>
                  ))}
                </div>
                {entry.badges.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {entry.badges.map(b => (
                      <span key={b} className="flex items-center gap-0.5 text-[10px] bg-muted border px-2 py-0.5 rounded-full font-medium">
                        {BADGE_ICONS[b]} {b}
                      </span>
                    ))}
                  </div>
                )}
                <Button
                  size="sm" variant="outline" className="text-xs h-7 mt-1"
                  onClick={(e) => { e.stopPropagation(); onRecalc(entry.vendorId); }}
                >
                  <RefreshCw className="h-3 w-3 mr-1" /> Recalculate Score
                </Button>
              </div>
              {/* Trend chart */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Tren Score (12 Bulan)</h4>
                <TrendChart vendorId={entry.vendorId} vendorName={entry.vendorName} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function VendorLeaderboardPage() {
  const { toast } = useToast();

  // Route filter
  const [origin, setOrigin]             = useState("");
  const [destination, setDestination]   = useState("");
  const [shipmentType, setShipmentType] = useState("__all__");
  const [search, setSearch]             = useState("");
  const [expandedId, setExpandedId]     = useState<number | null>(null);

  // Vendor IDs from global list
  const { data: rawVendors = [], isLoading: loadingRaw, refetch: refetchRaw } = useQuery<VendorRaw[]>({
    queryKey: ["vendor-performance"],
    queryFn: async () => {
      const r = await fetch("/api/vendor-performance");
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    staleTime: 2 * 60_000,
  });

  const vendorIds = rawVendors.map(v => v.vendor.id);

  const scoreParams = new URLSearchParams({ vendorIds: vendorIds.join(",") });
  if (origin.trim())       scoreParams.set("origin", origin.trim());
  if (destination.trim())  scoreParams.set("destination", destination.trim());
  if (shipmentType !== "__all__") scoreParams.set("shipmentType", shipmentType);

  const { data: scores = [], isLoading: loadingScores } = useQuery<ScoreEntry[]>({
    queryKey: ["vendor-scores-bulk", vendorIds.join(","), origin, destination, shipmentType],
    queryFn: async () => {
      if (vendorIds.length === 0) return [];
      const r = await fetch(`/api/vendor-performance/scores-bulk?${scoreParams}`);
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    enabled: vendorIds.length > 0,
    staleTime: 2 * 60_000,
  });

  async function recalcAll() {
    try {
      const r = await fetch("/api/vendor-performance/recalculate-all", { method: "POST" });
      if (!r.ok) throw new Error();
      toast({ title: "Semua skor diperbarui" });
      refetchRaw();
    } catch {
      toast({ title: "Gagal recalculate", variant: "destructive" });
    }
  }

  async function recalcOne(vendorId: number) {
    try {
      const r = await fetch(`/api/vendor-performance/${vendorId}/recalculate`, { method: "POST" });
      if (!r.ok) throw new Error();
      toast({ title: "Skor vendor diperbarui" });
      refetchRaw();
    } catch {
      toast({ title: "Gagal recalculate", variant: "destructive" });
    }
  }

  const rawMap = Object.fromEntries(rawVendors.map(v => [v.vendor.id, v]));

  const filtered = scores.filter(s =>
    !search.trim() || s.vendorName.toLowerCase().includes(search.toLowerCase())
  );

  const tierCounts = { top: 0, good: 0, moderate: 0, new: 0 };
  for (const s of scores) tierCounts[s.tier] = (tierCounts[s.tier] ?? 0) + 1;
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, s) => a + s.aiScore, 0) / scores.length) : 0;

  const isLoading = loadingRaw || loadingScores;
  const hasRouteFilter = origin.trim() || destination.trim() || shipmentType !== "__all__";

  return (
    <AppShell>
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
        <ArrowLeft className="h-4 w-4 mr-1" />Kembali
      </Button>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href="/logistics-vendors"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

          <h1 className="text-2xl font-bold tracking-tight">Vendor Leaderboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Ranking vendor berdasarkan AI Score — blend performa global & rute spesifik
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={recalcAll} className="gap-1.5">
          <RefreshCw className="h-4 w-4" /> Recalculate All
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold text-yellow-600">{tierCounts.top}</p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Trophy className="h-3 w-3" /> Top Tier</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold text-blue-600">{tierCounts.good}</p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Star className="h-3 w-3" /> Good</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold text-gray-600">{tierCounts.moderate + tierCounts.new}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Moderate / New</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-2xl font-bold">{avgScore}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Avg AI Score</p>
          </CardContent>
        </Card>
      </div>

      {/* Route filter */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">Filter Rute & Pencarian</CardTitle>
          {hasRouteFilter && (
            <CardDescription className="text-xs text-blue-600">
              AI Score dihitung dengan konteks rute yang dipilih
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Origin</Label>
              <Input
                placeholder="Misal: Jakarta"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Destination</Label>
              <Input
                placeholder="Misal: Surabaya"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Shipment Type</Label>
              <Select value={shipmentType} onValueChange={setShipmentType}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Semua tipe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua tipe</SelectItem>
                  {SHIPMENT_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cari Vendor</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Nama vendor..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-sm pl-7"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Leaderboard table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Ranking Vendor
            {hasRouteFilter && (
              <span className="ml-2 text-xs font-normal text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                Rute: {[origin, destination, shipmentType !== "__all__" ? shipmentType : ""].filter(Boolean).join(" → ")}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="py-2.5 px-4 text-center w-10">#</th>
                  <th className="py-2.5 px-4 text-left">Vendor</th>
                  <th className="py-2.5 px-4 text-left w-40">AI Score</th>
                  <th className="py-2.5 px-4 text-left">Tier</th>
                  <th className="py-2.5 px-4 text-center">Confidence</th>
                  <th className="py-2.5 px-4 text-center">On-Time</th>
                  <th className="py-2.5 px-4 text-center">Resp.</th>
                  <th className="py-2.5 px-4 text-center">Orders</th>
                  <th className="py-2.5 px-4 text-center">Trend</th>
                  <th className="py-2.5 px-4 text-left">Badges</th>
                  <th className="py-2.5 px-4 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: 11 }).map((_, j) => (
                      <td key={j} className="py-3 px-4">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-16 text-center text-muted-foreground text-sm">
                      <Trophy className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      Tidak ada vendor ditemukan
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.map((entry, i) => (
                  <VendorRow
                    key={entry.vendorId}
                    rank={i + 1}
                    entry={entry}
                    raw={rawMap[entry.vendorId]}
                    expanded={expandedId === entry.vendorId}
                    onToggle={() => setExpandedId(expandedId === entry.vendorId ? null : entry.vendorId)}
                    onRecalc={recalcOne}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        AI Score = blend global recommendation score + performa rute spesifik dari Decision Memory.
        Confidence level menunjukkan seberapa banyak data rute tersedia.
      </p>
    </div>
    </AppShell>
  );
}
