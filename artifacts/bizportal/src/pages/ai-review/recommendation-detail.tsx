/**
 * AI Learning Center — Recommendation Detail Page
 * Shows full evidence, confidence breakdown, and affected transactions for a recommendation.
 * Phase 9: Approve/Reject only by authorized human reviewers. AI cannot self-approve.
 */

import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, Lightbulb, Shield, CheckCircle2, XCircle, BarChart3,
  AlertCircle, RefreshCw, ExternalLink,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

import { useRecommendation } from "@/hooks/useAiLearning";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { aiLearningKeys } from "@/hooks/useAiLearning";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PENDING_REVIEW: { label: "Menunggu Review", className: "bg-amber-500 text-white" },
    DRAFT: { label: "Draft", className: "bg-gray-400 text-white" },
    APPROVED: { label: "Disetujui", className: "bg-green-600 text-white" },
    REJECTED: { label: "Ditolak", className: "bg-red-600 text-white" },
    ARCHIVED: { label: "Diarsipkan", className: "bg-gray-500 text-white" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-400 text-white" };
  return <Badge className={`${cfg.className} text-xs`}>{cfg.label}</Badge>;
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value ?? "—"}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecommendationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: dbUser } = useGetCurrentUser({});
  const { data, isLoading, isError, refetch } = useRecommendation(id);

  // ── Permission check (Phase 8) ────────────────────────────────────────────
  const role = dbUser?.role ?? "";
  const canApprove = ["admin", "finance", "accounting"].includes(role);
  const canReject = ["admin", "accounting"].includes(role);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleAction(action: "approve" | "reject") {
    if (!id) return;
    try {
      await api.post(`/api/ai-transaction/rule-packages/${id}/review`, {
        status: action === "approve" ? "APPROVED" : "REJECTED",
      });
      toast({
        title: action === "approve" ? "Rule disetujui" : "Rule ditolak",
        description: "Status rekomendasi berhasil diperbarui.",
      });
      qc.invalidateQueries({ queryKey: aiLearningKeys.recommendations() });
      qc.invalidateQueries({ queryKey: aiLearningKeys.recommendation(id) });
      navigate("/ai/review/recommendations");
    } catch (err) {
      toast({
        title: "Gagal",
        description: (err as Error).message ?? "Terjadi kesalahan.",
        variant: "destructive",
      });
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <PageHeader
          title="Recommendation Detail"
          breadcrumb={[
            { label: "AI Review", href: "/ai/review" },
            { label: "Recommendations", href: "/ai/review/recommendations" },
            { label: "Detail" },
          ]}
        />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      </AppShell>
    );
  }

  if (isError || !data) {
    return (
      <AppShell>
        <PageHeader
          title="Recommendation Detail"
          breadcrumb={[
            { label: "AI Review", href: "/ai/review" },
            { label: "Recommendations", href: "/ai/review/recommendations" },
            { label: "Detail" },
          ]}
        />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Rekomendasi tidak ditemukan atau gagal dimuat.{" "}
            <button className="underline" onClick={() => refetch()}>
              Coba lagi
            </button>
          </AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  const isPending = data.status === "PENDING_REVIEW" || data.status === "DRAFT";

  return (
    <AppShell>
      <PageHeader
        title="Recommendation Detail"
        description={`Package #${data.id} — ${data.packageType}`}
        breadcrumb={[
          { label: "AI Review", href: "/ai/review" },
          { label: "Recommendations", href: "/ai/review/recommendations" },
          { label: `#${data.id}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/ai/review/recommendations")}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Kembali
            </Button>
          </div>
        }
      />

      {/* Phase 9 notice */}
      <Alert className="mb-4 border-amber-200 bg-amber-50">
        <Shield className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-700 text-sm">
          AI tidak dapat langsung mengubah rule. Semua perubahan memerlukan persetujuan manusia (Approve Rule).
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: main info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Header card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Lightbulb className="h-5 w-5 text-amber-500" />
                <CardTitle className="text-base">{data.packageType}</CardTitle>
                <StatusBadge status={data.status} />
                {data.riskLevel && (
                  <Badge className="text-xs bg-gray-100 text-gray-700">
                    Risiko {data.riskLevel}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <FieldRow label="Package ID" value={`#${data.id}`} />
              <FieldRow label="Dibuat oleh" value={data.createdBy ?? "System"} />
              <FieldRow
                label="Dibuat pada"
                value={new Date(data.createdAt).toLocaleString("id-ID")}
              />
              {data.reviewedBy && (
                <FieldRow label="Direview oleh" value={data.reviewedBy} />
              )}
              {data.reviewedAt && (
                <FieldRow
                  label="Direview pada"
                  value={new Date(data.reviewedAt).toLocaleString("id-ID")}
                />
              )}
            </CardContent>
          </Card>

          {/* Detected Patterns / Rule Recommendations */}
          {data.recommendations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-indigo-500" />
                  Detected Pattern & Evidence
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.recommendations.map((r, i) => (
                  <div key={i} className="bg-muted/50 rounded-md p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold">{r.ruleName}</span>
                      <Badge className="text-xs">{r.packageType}</Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      {r.recommendedCoa && (
                        <div>
                          <p className="text-xs text-muted-foreground">Selected COA</p>
                          <p className="font-mono font-medium text-indigo-700">{r.recommendedCoa}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground">Occurrences</p>
                        <p className="font-semibold">{r.occurrence}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Confidence</p>
                        <p className="font-semibold">
                          {r.confidence > 0 ? `${Math.round(r.confidence * 100)}%` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Affected Transactions</p>
                        <p className="font-semibold">{r.affectedTransactions}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Expected Accuracy</p>
                        <p className="font-semibold">
                          {r.expectedAccuracy > 0 ? `${Math.round(r.expectedAccuracy * 100)}%` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Perlu Approval</p>
                        {r.requiresHumanApproval ? (
                          <span className="flex items-center gap-1 text-amber-600 text-xs">
                            <Shield className="h-3 w-3" /> Ya
                          </span>
                        ) : (
                          <span className="text-green-600 text-xs">Tidak</span>
                        )}
                      </div>
                    </div>
                    {r.reason && (
                      <p className="text-xs text-muted-foreground mt-2 border-t pt-2">{r.reason}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Impact */}
          {data.impact && Object.keys(data.impact).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Impact Estimate</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted rounded p-3 overflow-x-auto">
                  {JSON.stringify(data.impact, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* Simulation */}
          {data.simulation && Object.keys(data.simulation).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Simulation Result</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted rounded p-3 overflow-x-auto">
                  {JSON.stringify(data.simulation, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Tindakan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isPending ? (
                <>
                  {canApprove && (
                    <Button
                      className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleAction("approve")}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve Rule
                    </Button>
                  )}
                  {canReject && (
                    <Button
                      variant="outline"
                      className="w-full gap-2 text-red-600 border-red-300 hover:bg-red-50"
                      onClick={() => handleAction("reject")}
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </Button>
                  )}
                  {!canApprove && !canReject && (
                    <Alert className="border-amber-200 bg-amber-50">
                      <Shield className="h-4 w-4 text-amber-600" />
                      <AlertDescription className="text-xs text-amber-700">
                        Hanya Finance Manager atau Accounting Manager yang dapat menyetujui rule.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  Rekomendasi ini sudah {data.status === "APPROVED" ? "disetujui" : "ditolak/diarsipkan"}.
                </div>
              )}

              <Separator />

              <Button
                variant="ghost"
                size="sm"
                className="w-full gap-2 text-muted-foreground"
                onClick={() => navigate("/ai/review/recommendations")}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Kembali ke Recommendations
              </Button>
            </CardContent>
          </Card>

          {/* Confidence Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Confidence Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recommendations.length > 0 ? (
                data.recommendations.slice(0, 3).map((r, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 border-b last:border-0">
                    <span className="text-xs text-muted-foreground truncate mr-2">{r.ruleName}</span>
                    <div className="flex items-center gap-1">
                      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.round(r.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium w-10 text-right">
                        {r.confidence > 0 ? `${Math.round(r.confidence * 100)}%` : "—"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">Tidak ada data confidence.</p>
              )}
            </CardContent>
          </Card>

          {/* Related Rule */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Related Rule</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Package Type: <span className="font-medium text-foreground">{data.packageType}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Priority: <span className="font-medium text-foreground">{data.priority}</span>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
