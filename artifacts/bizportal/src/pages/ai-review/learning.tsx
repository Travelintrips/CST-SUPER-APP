/**
 * AI Learning Center — Learning Patterns Tab
 * Shows patterns discovered by the AI learning engine.
 * Read-only: no auto-learning, all changes require human approval.
 */

import { useState } from "react";
import { Link } from "wouter";
import { Brain, CheckCircle2, Clock, AlertCircle, RefreshCw, ChevronRight, Search } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useLearningPatterns } from "@/hooks/useAiLearning";
import type { LearningPattern } from "@/lib/ai-learning-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  if (pct >= 90)
    return <Badge className="bg-green-600 text-white text-xs">{pct}%</Badge>;
  if (pct >= 70)
    return <Badge className="bg-yellow-500 text-white text-xs">{pct}%</Badge>;
  return <Badge className="bg-gray-400 text-white text-xs">{pct}%</Badge>;
}

function AgreementBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  if (pct >= 90)
    return (
      <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" /> {pct}%
      </span>
    );
  if (pct >= 60)
    return (
      <span className="flex items-center gap-1 text-yellow-600 text-sm font-medium">
        {pct}%
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-red-600 text-sm font-medium">
      {pct}%
    </span>
  );
}

// ── Pattern Card ──────────────────────────────────────────────────────────────

function PatternCard({ pattern }: { pattern: LearningPattern }) {
  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="text-sm font-semibold text-foreground truncate">
                {pattern.intent ?? "—"}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="text-sm font-mono text-indigo-700 truncate">
                {pattern.recommendedCoa ?? "—"}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Transaksi</p>
                <p className="text-sm font-semibold">{pattern.occurrenceCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Confidence</p>
                <ConfidenceBadge value={pattern.confidence} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Reviewer Agreement</p>
                <AgreementBadge value={pattern.reviewerAgreement} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Last Seen</p>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatRelativeTime(pattern.lastSeen)}
                </span>
              </div>
            </div>
          </div>

          <Link href={`/ai/review/learning/${pattern.id}`}>
            <Button variant="outline" size="sm" className="shrink-0 gap-1">
              Lihat Detail <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AiLearningPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading, isError, refetch } = useLearningPatterns();

  const patterns = data?.patterns ?? [];
  const filtered = search.trim()
    ? patterns.filter(
        (p) =>
          p.intent?.toLowerCase().includes(search.toLowerCase()) ||
          p.recommendedCoa?.toLowerCase().includes(search.toLowerCase()) ||
          p.description.toLowerCase().includes(search.toLowerCase()),
      )
    : patterns;

  return (
    <AppShell>
      <PageHeader
        title="Learning Patterns"
        description="Pola yang ditemukan AI dari histori keputusan reviewer"
        breadcrumb={[
          { label: "AI Review", href: "/ai/review" },
          { label: "Learning" },
        ]}
      />

      {/* Summary bar */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="text-sm text-muted-foreground">
          {isLoading ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <span>
              <strong>{filtered.length}</strong> pola ditemukan
              {search && ` (difilter dari ${patterns.length})`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari intent atau COA..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 w-52 text-sm"
            />
          </div>
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
            Gagal memuat learning patterns.{" "}
            <button className="underline" onClick={() => refetch()}>
              Coba lagi
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Brain className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {search ? "Tidak ada pola yang cocok dengan pencarian." : "Belum ada learning patterns."}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Pola muncul setelah reviewer menyelesaikan beberapa transaksi sejenis.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pattern list */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((p) => (
            <PatternCard key={p.id} pattern={p} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
