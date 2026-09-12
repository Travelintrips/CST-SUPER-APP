/**
 * AI Learning Center — Recommendations Tab
 * Shows rule recommendation packages awaiting human review.
 * Phase 9: AI cannot approve its own recommendations — human approval required.
 */

import { useState } from "react";
import { Link } from "wouter";
import {
  Lightbulb, CheckCircle2, XCircle, Clock, AlertCircle,
  RefreshCw, ChevronRight, Search, Shield,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useRecommendations } from "@/hooks/useAiLearning";
import type { RecommendationItem } from "@/lib/ai-learning-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PENDING_REVIEW":
      return <Badge className="bg-amber-500 text-white text-xs">Menunggu Review</Badge>;
    case "DRAFT":
      return <Badge className="bg-gray-400 text-white text-xs">Draft</Badge>;
    case "APPROVED":
      return (
        <Badge className="bg-green-600 text-white text-xs gap-1">
          <CheckCircle2 className="h-3 w-3" /> Disetujui
        </Badge>
      );
    case "REJECTED":
      return (
        <Badge className="bg-red-600 text-white text-xs gap-1">
          <XCircle className="h-3 w-3" /> Ditolak
        </Badge>
      );
    case "ARCHIVED":
      return <Badge variant="secondary" className="text-xs">Diarsipkan</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function RiskBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const map: Record<string, string> = {
    LOW: "bg-green-100 text-green-700",
    MEDIUM: "bg-yellow-100 text-yellow-700",
    HIGH: "bg-red-100 text-red-700",
    CRITICAL: "bg-red-700 text-white",
  };
  return (
    <Badge className={`text-xs ${map[level] ?? "bg-gray-100 text-gray-600"}`}>
      Risiko {level}
    </Badge>
  );
}

// ── Recommendation Card ───────────────────────────────────────────────────────

function RecommendationCard({ rec }: { rec: RecommendationItem }) {
  const isPending = rec.status === "PENDING_REVIEW" || rec.status === "DRAFT";

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Lightbulb className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-sm font-semibold truncate">{rec.ruleName || rec.packageType}</span>
              <StatusBadge status={rec.status} />
              <RiskBadge level={rec.riskLevel} />
            </div>

            {/* AI Recommendation summary */}
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 my-2">
              <p className="text-xs text-amber-700 font-medium mb-1">AI Recommendation</p>
              {rec.occurrence > 0 && (
                <p className="text-sm">
                  <strong>{rec.occurrence} transaksi</strong> selalu dipilih{" "}
                  {rec.recommendedCoa && (
                    <span>
                      ↓ <span className="font-mono font-medium text-indigo-700">{rec.recommendedCoa}</span>
                    </span>
                  )}
                </p>
              )}
              {rec.reason && (
                <p className="text-xs text-muted-foreground mt-1">{rec.reason}</p>
              )}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Confidence</p>
                <p className="text-sm font-semibold">
                  {rec.confidence > 0 ? `${Math.round(rec.confidence * 100)}%` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                {isPending ? (
                  <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Belum menjadi Rule
                  </span>
                ) : (
                  <StatusBadge status={rec.status} />
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Akurasi</p>
                <p className="text-sm font-semibold">
                  {rec.expectedAccuracy > 0 ? `${Math.round(rec.expectedAccuracy * 100)}%` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Perlu Approval</p>
                {rec.requiresHumanApproval ? (
                  <span className="flex items-center gap-1 text-xs text-amber-600">
                    <Shield className="h-3 w-3" /> Ya
                  </span>
                ) : (
                  <span className="text-xs text-green-600">Tidak</span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 shrink-0">
            <Link href={`/ai/review/recommendations/${rec.id}`}>
              <Button variant="outline" size="sm" className="gap-1 w-full">
                Lihat Evidence <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
            {/* Note: Approve/Ignore actions are in the detail page with proper role checks */}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AiRecommendationsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data, isLoading, isError, refetch } = useRecommendations();

  const allRecs = data?.recommendations ?? [];
  const filtered = allRecs.filter((r) => {
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      r.ruleName.toLowerCase().includes(q) ||
      r.recommendedCoa.toLowerCase().includes(q) ||
      r.packageType.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  return (
    <AppShell>
      <PageHeader
        title="Recommendations"
        description="Rekomendasi rule yang diusulkan AI dan menunggu persetujuan manusia"
        breadcrumb={[
          { label: "AI Review", href: "/ai/review" },
          { label: "Recommendations" },
        ]}
      />

      {/* Notice: no auto-approve */}
      <Alert className="mb-4 border-amber-200 bg-amber-50">
        <Shield className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-700 text-sm">
          AI tidak dapat langsung mengubah rule atau mapping. Setiap rekomendasi harus disetujui oleh manusia.
        </AlertDescription>
      </Alert>

      {/* Filters */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {isLoading ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <span>
              <strong>{filtered.length}</strong> rekomendasi
              {statusFilter !== "all" && ` (${statusFilter})`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari rule atau COA..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 w-48 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="PENDING_REVIEW">Menunggu</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="APPROVED">Disetujui</SelectItem>
              <SelectItem value="REJECTED">Ditolak</SelectItem>
              <SelectItem value="ARCHIVED">Diarsipkan</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Error */}
      {isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Gagal memuat recommendations.{" "}
            <button className="underline" onClick={() => refetch()}>
              Coba lagi
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">
            {search || statusFilter !== "all"
              ? "Tidak ada rekomendasi yang cocok."
              : "Belum ada rekomendasi dari AI."}
          </p>
          <p className="text-xs mt-1">
            Rekomendasi muncul setelah AI menemukan pola yang cukup kuat.
          </p>
        </div>
      )}

      {/* List */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((r) => (
            <RecommendationCard key={r.id} rec={r} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
