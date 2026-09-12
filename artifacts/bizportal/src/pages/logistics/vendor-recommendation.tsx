import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { QueryState } from "@/components/ui/query-state";
import {
  Star, Search, Trophy, Shield, Zap, Package, TrendingUp,
  AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ArrowLeft,
} from "lucide-react";
import { CompanySelect } from "@/components/CompanySelect";
import { BackButton } from "@/components/ui/back-button";

const idr = (v: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);

type Candidate = {
  vendorId: number;
  vendorName: string;
  serviceType: string | null;
  vendorGrade: string;
  preferredScore: number;
  finalScore: number;
  confidence: "high" | "medium" | "low" | "none";
  routeOrderCount: number;
  routeOnTimePct: number | null;
  commodityOrderCount: number;
  explanation: string[];
  badges: string[];
};

const GRADE_COLOR: Record<string, string> = {
  "A+": "bg-emerald-500 text-white",
  "A":  "bg-green-500 text-white",
  "B":  "bg-blue-500 text-white",
  "C":  "bg-yellow-500 text-black",
  "D":  "bg-red-500 text-white",
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   "text-emerald-400",
  medium: "text-yellow-400",
  low:    "text-orange-400",
  none:   "text-slate-500",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high:   "Data kuat",
  medium: "Data cukup",
  low:    "Data terbatas",
  none:   "Belum ada data rute",
};

const BADGE_ICON: Record<string, React.ReactNode> = {
  "Route Expert":       <Star className="w-3 h-3" />,
  "Top Vendor":         <Trophy className="w-3 h-3" />,
  "Fast Response":      <Zap className="w-3 h-3" />,
  "Commodity Specialist": <Package className="w-3 h-3" />,
  "Trusted":            <Shield className="w-3 h-3" />,
};

function ScoreBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 bg-slate-800 rounded-full h-2">
        <div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-9 text-right">{value.toFixed(0)}</span>
    </div>
  );
}

function CandidateCard({ c, rank }: { c: Candidate; rank: number }) {
  const [open, setOpen] = useState(false);
  const gradeClass = GRADE_COLOR[c.vendorGrade] ?? "bg-slate-700 text-white";

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Rank */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
            rank === 1 ? "bg-yellow-500 text-black" :
            rank === 2 ? "bg-slate-400 text-black" :
            rank === 3 ? "bg-amber-700 text-white" : "bg-slate-800 text-slate-400"
          }`}>
            {rank}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white">{c.vendorName}</span>
              <Badge className={`text-xs px-1.5 py-0 ${gradeClass}`}>{c.vendorGrade}</Badge>
              {c.serviceType && (
                <Badge variant="outline" className="text-xs text-slate-400 border-slate-700">
                  {c.serviceType}
                </Badge>
              )}
            </div>

            {/* Badges */}
            {c.badges.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {c.badges.map(b => (
                  <span key={b} className="flex items-center gap-1 text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">
                    {BADGE_ICON[b]} {b}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-slate-500 w-16">Final Score</span>
                <ScoreBar value={c.finalScore} />
              </div>
            </div>

            <div className="flex items-center gap-4 mt-1">
              <div className={`text-xs ${CONFIDENCE_COLOR[c.confidence]} flex items-center gap-1`}>
                {c.confidence === "high" ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                {CONFIDENCE_LABEL[c.confidence]}
              </div>
              {c.routeOrderCount > 0 && (
                <span className="text-xs text-slate-500">
                  {c.routeOrderCount} order pd rute ini
                  {c.routeOnTimePct !== null && ` · ${c.routeOnTimePct.toFixed(0)}% on-time`}
                </span>
              )}
              {c.commodityOrderCount > 0 && (
                <span className="text-xs text-slate-500">
                  {c.commodityOrderCount} komoditas
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => setOpen(!open)}
            className="text-slate-500 hover:text-slate-300 ml-2 mt-1"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {open && (
          <>
            <Separator className="my-3 border-slate-800" />
            <div className="space-y-1 pl-11">
              <p className="text-xs text-slate-500 font-medium mb-2">Alasan rekomendasi:</p>
              {c.explanation.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-slate-400">
                  <span className="text-slate-600 mt-0.5">•</span>
                  <span>{e}</span>
                </div>
              ))}
              <div className="flex items-center gap-4 mt-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Base score</span>
                  <ScoreBar value={c.preferredScore} />
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function VendorRecommendationPage() {
  const [origin, setOrigin]           = useState("");
  const [destination, setDestination] = useState("");
  const [commodity, setCommodity]     = useState("");
  const [shipmentType, setShipmentType] = useState("");
  const [submitted, setSubmitted]     = useState(false);
  const [companyId, setCompanyId]     = useState("all");

  const params = new URLSearchParams();
  if (origin)           params.set("origin", origin);
  if (destination)      params.set("destination", destination);
  if (commodity)        params.set("commodity", commodity);
  if (shipmentType)     params.set("shipmentType", shipmentType);
  if (companyId !== "all") params.set("companyId", companyId);

  const { data, isLoading, refetch } = useQuery<{ candidates: Candidate[] }>({
    queryKey: ["vendor-recommendation", origin, destination, commodity, shipmentType, companyId],
    queryFn: () => fetch(`/api/vendor-recommendation/candidates?${params}`, { credentials: "include" }).then(r => r.json()),
    enabled: submitted,
  });

  const candidates = data?.candidates ?? [];
  const topCandidate = candidates[0];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    refetch();
  }

  return (
    <AppShell>
      <BackButton href="/logistics" />
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Star className="w-6 h-6 text-yellow-400" />
            Vendor Recommendation Engine
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            AI scoring berdasarkan performa historis, rute, komoditas, dan grade vendor.
          </p>
        </div>

        {/* Input Form */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white">Parameter Pencarian</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Asal (Origin)</Label>
                <Input
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  placeholder="cth: Jakarta"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Tujuan (Destination)</Label>
                <Input
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  placeholder="cth: Surabaya"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <CompanySelect value={companyId} onChange={setCompanyId} />
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Komoditas</Label>
                <Input
                  value={commodity}
                  onChange={e => setCommodity(e.target.value)}
                  placeholder="cth: Elektronik, Garmen..."
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Jenis Pengiriman</Label>
                <Input
                  value={shipmentType}
                  onChange={e => setShipmentType(e.target.value)}
                  placeholder="cth: FCL, LCL, Air, Land..."
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="col-span-2">
                <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  <Search className="w-4 h-4 mr-2" />
                  Cari Vendor Terbaik
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Results */}
        <QueryState loading={isLoading} empty={submitted && candidates.length === 0} emptyMessage="Tidak ada vendor aktif dengan data performa ditemukan.">
          {candidates.length > 0 && (
          <>
            {/* Top Recommendation Banner */}
            {topCandidate && (
              <Card className="bg-gradient-to-r from-yellow-900/40 to-amber-900/20 border-yellow-800/50">
                <CardContent className="p-4 flex items-center gap-4">
                  <Trophy className="w-8 h-8 text-yellow-400 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-yellow-600 font-medium">VENDOR REKOMENDASI UTAMA</p>
                    <p className="text-lg font-bold text-white">{topCandidate.vendorName}</p>
                    <p className="text-sm text-slate-400">
                      Score: <span className="text-yellow-400 font-semibold">{topCandidate.finalScore.toFixed(1)}/100</span>
                      {" · "}Grade <span className="text-white">{topCandidate.vendorGrade}</span>
                      {topCandidate.routeOrderCount > 0 && ` · ${topCandidate.routeOrderCount} order pada rute ini`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* All Candidates */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-slate-400">{candidates.length} vendor ditemukan, diurutkan berdasarkan skor</p>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Skor = base + boost rute & komoditas</span>
                </div>
              </div>
              <div className="space-y-3">
                {candidates.slice(0, 20).map((c, i) => (
                  <CandidateCard key={c.vendorId} c={c} rank={i + 1} />
                ))}
              </div>
              {candidates.length > 20 && (
                <p className="text-center text-slate-600 text-sm mt-3">
                  + {candidates.length - 20} vendor lainnya tidak ditampilkan
                </p>
              )}
            </div>
          </>
          )}
        </QueryState>
      </div>
    </AppShell>
  );
}
