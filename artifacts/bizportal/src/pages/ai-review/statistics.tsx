/**
 * AI Learning Center — Statistics Tab
 * Shows aggregated learning accuracy and rule metrics.
 */

import {
  TrendingUp, TrendingDown, Minus, Brain, CheckCircle2, XCircle,
  AlertCircle, RefreshCw, Zap, BarChart3,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { useLearningStatistics } from "@/hooks/useAiLearning";

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  trend?: "up" | "down" | "neutral";
}

function StatCard({ label, value, sub, icon, variant = "default", trend }: StatCardProps) {
  const color = {
    default: "text-foreground",
    success: "text-green-600",
    warning: "text-amber-600",
    danger: "text-red-600",
  }[variant];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            {trend === "up" && <TrendingUp className="h-4 w-4 text-green-500" />}
            {trend === "down" && <TrendingDown className="h-4 w-4 text-red-500" />}
            {trend === "neutral" && <Minus className="h-4 w-4 text-gray-400" />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AiStatisticsPage() {
  const { data, isLoading, isError, refetch } = useLearningStatistics();

  return (
    <AppShell>
      <PageHeader
        title="Statistics"
        description="Metrik akurasi AI, pola pembelajaran, dan statistik rule"
        breadcrumb={[
          { label: "AI Review", href: "/ai/review" },
          { label: "Statistics" },
        ]}
        actions={
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      {isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Gagal memuat statistik.{" "}
            <button className="underline" onClick={() => refetch()}>
              Coba lagi
            </button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(11)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Section: Accuracy */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Akurasi AI
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <StatCard
                label="Learning Accuracy"
                value={`${data.accuracy.toFixed(1)}%`}
                sub={`${data.agreedFeedback} dari ${data.totalFeedback} feedback`}
                icon={<Brain className="h-5 w-5" />}
                variant={data.accuracy >= 90 ? "success" : data.accuracy >= 70 ? "warning" : "danger"}
                trend={data.trend.direction}
              />
              <StatCard
                label="Recommendation Accuracy"
                value={`${data.averageConfidence.toFixed(1)}%`}
                icon={<Zap className="h-5 w-5" />}
                variant={data.averageConfidence >= 90 ? "success" : data.averageConfidence >= 70 ? "warning" : "danger"}
              />
              <StatCard
                label="False Positive"
                value={`${data.falsePositive.toFixed(1)}%`}
                sub="AI salah rekomendasikan"
                icon={<XCircle className="h-5 w-5" />}
                variant={data.falsePositive <= 10 ? "success" : data.falsePositive <= 20 ? "warning" : "danger"}
              />
              <StatCard
                label="Manual Review Saved"
                value={data.totalFeedback - data.manualCorrections}
                sub="transaksi diterima otomatis"
                icon={<CheckCircle2 className="h-5 w-5" />}
                variant="success"
              />
            </div>
          </div>

          {/* Section: Rules */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Rule & Learning
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <StatCard
                label="Rule Generated"
                value={data.totalRulePackages}
                sub="semua paket rule"
                icon={<BarChart3 className="h-5 w-5" />}
              />
              <StatCard
                label="Rules Approved"
                value={data.approvedRules}
                icon={<CheckCircle2 className="h-5 w-5" />}
                variant="success"
              />
              <StatCard
                label="Rules Rejected"
                value={data.ignoredRules}
                icon={<XCircle className="h-5 w-5" />}
                variant={data.ignoredRules > 0 ? "warning" : "default"}
              />
              <StatCard
                label="Learning Pattern"
                value={data.learningPatterns}
                sub="pola unik ditemukan"
                icon={<Brain className="h-5 w-5" />}
              />
            </div>
          </div>

          {/* Section: Feedback */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Feedback Reviewer
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <StatCard
                label="Average Confidence"
                value={`${data.averageConfidence.toFixed(1)}%`}
                icon={<Zap className="h-5 w-5" />}
                variant={data.averageConfidence >= 90 ? "success" : "warning"}
              />
              <StatCard
                label="Reviewer Agreement"
                value={`${data.accuracy.toFixed(1)}%`}
                sub="reviewer setuju dengan AI"
                variant={data.accuracy >= 90 ? "success" : "warning"}
              />
              <StatCard
                label="False Negative"
                value="—"
                sub="tidak tersedia dari data ini"
              />
              <StatCard
                label="Manual Corrections"
                value={data.manualCorrections}
                sub="reviewer mengubah COA"
                variant={data.manualCorrections > 50 ? "warning" : "default"}
              />
            </div>
          </div>

          {/* Trend */}
          {data.trend.recentAccuracy !== null && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Learning Trend (30 Hari Terakhir)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground">30 Hari Ini</p>
                    <p className="text-xl font-bold">{data.trend.recentAccuracy?.toFixed(1)}%</p>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    {data.trend.direction === "up" ? (
                      <TrendingUp className="h-5 w-5 text-green-500" />
                    ) : data.trend.direction === "down" ? (
                      <TrendingDown className="h-5 w-5 text-red-500" />
                    ) : (
                      <Minus className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">30 Hari Lalu</p>
                    <p className="text-xl font-bold">
                      {data.trend.priorAccuracy !== null ? `${data.trend.priorAccuracy.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                  <Badge
                    className={
                      data.trend.direction === "up"
                        ? "bg-green-100 text-green-700"
                        : data.trend.direction === "down"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-600"
                    }
                  >
                    {data.trend.direction === "up"
                      ? "↑ Meningkat"
                      : data.trend.direction === "down"
                      ? "↓ Menurun"
                      : "Stabil"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </AppShell>
  );
}
