import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Star, RefreshCw, TrendingUp, Clock, Package, AlertCircle,
  CheckCircle, Trophy, Zap, Timer, Shield,
} from "lucide-react";
import { Link } from "wouter";

const pct = (n: string | null | undefined) =>
  n == null ? "—" : `${Number(n).toFixed(1)}%`;

const BADGE_META: Record<string, { icon: React.ReactNode; color: string; desc: string }> = {
  "Top Vendor": {
    icon: <Trophy className="h-3 w-3" />,
    color: "bg-yellow-100 text-yellow-800 border-yellow-300",
    desc: "On-time ≥ 90%",
  },
  "Fast Response": {
    icon: <Zap className="h-3 w-3" />,
    color: "bg-blue-100 text-blue-800 border-blue-300",
    desc: "Resp ≤ 30 menit",
  },
  "Best ETA": {
    icon: <Timer className="h-3 w-3" />,
    color: "bg-green-100 text-green-800 border-green-300",
    desc: "Akurasi ETA ≥ 85%",
  },
  "Trusted Vendor": {
    icon: <Shield className="h-3 w-3" />,
    color: "bg-purple-100 text-purple-800 border-purple-300",
    desc: "≥ 20 order, cancel ≤ 5%",
  },
};

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

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <span className={`text-xs font-bold w-8 ${score >= 70 ? "text-green-600" : score >= 50 ? "text-yellow-600" : "text-red-500"}`}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

export default function VendorPerformancePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["vendor-performance"],
    queryFn: fetchVendorPerformance,
  });

  const recalcMut = useMutation({
    mutationFn: recalcAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-performance"] });
      toast({ title: "Recalculate selesai" });
    },
    onError: () => toast({ title: "Gagal recalculate", variant: "destructive" }),
  });

  const filtered = data.filter((v: any) =>
    v.vendor.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Star className="h-6 w-6 text-yellow-500" />
              Vendor Performance & Rating
            </h1>
            <p className="text-muted-foreground text-sm">Scoring & badge performa vendor</p>
          </div>
          <Button variant="outline" onClick={() => recalcMut.mutate()} disabled={recalcMut.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${recalcMut.isPending ? "animate-spin" : ""}`} />
            Recalculate All
          </Button>
        </div>

        {/* Badge Legend */}
        <Card className="p-3">
          <div className="flex flex-wrap gap-3">
            {Object.entries(BADGE_META).map(([name, meta]) => (
              <div key={name} className="flex items-center gap-1.5">
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${meta.color}`}>
                  {meta.icon} {name}
                </span>
                <span className="text-xs text-muted-foreground">{meta.desc}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Search */}
        <Input
          placeholder="Cari vendor..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />

        {/* Vendor Cards */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Memuat data...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Tidak ada vendor ditemukan</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((v: any) => {
              const p = v.perf;
              const score = Number(p?.recommendationScore ?? 0);
              const rating = Number(p?.customerRating ?? 0);
              return (
                <Card key={v.vendor.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-semibold">{v.vendor.name}</span>
                        {v.vendor.serviceType && (
                          <div className="text-xs text-muted-foreground mt-0.5">{v.vendor.serviceType}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                          <span className="font-bold text-sm">{rating > 0 ? rating.toFixed(1) : "—"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{p?.totalOrders ?? 0} orders</div>
                      </div>
                    </div>

                    {/* Badges */}
                    {v.badges?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {v.badges.map((b: string) => (
                          <span key={b} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${BADGE_META[b]?.color ?? "bg-gray-100 text-gray-700"}`}>
                            {BADGE_META[b]?.icon} {b}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Metrics */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        On-time: <span className="font-medium text-foreground ml-1">{pct(p?.ontimePercentage)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3 w-3 text-blue-500" />
                        Resp avg: <span className="font-medium text-foreground ml-1">
                          {p?.averageResponseMinutes && Number(p.averageResponseMinutes) > 0
                            ? `${Number(p.averageResponseMinutes).toFixed(0)} mnt`
                            : "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <TrendingUp className="h-3 w-3 text-green-500" />
                        Success: <span className="font-medium text-foreground ml-1">{pct(p?.orderSuccessRate)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <AlertCircle className="h-3 w-3 text-red-400" />
                        Cancel: <span className="font-medium text-foreground ml-1">{pct(p?.cancelRate)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Package className="h-3 w-3" />
                        POD: <span className="font-medium text-foreground ml-1">{pct(p?.podCompletenessScore)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Trophy className="h-3 w-3 text-yellow-500" />
                        Completed: <span className="font-medium text-foreground ml-1">{p?.completedOrders ?? 0}</span>
                      </div>
                    </div>

                    {/* Score bar */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Recommendation Score</span>
                      </div>
                      <ScoreBar score={score} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
