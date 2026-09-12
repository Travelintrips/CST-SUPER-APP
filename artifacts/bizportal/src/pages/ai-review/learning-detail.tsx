/**
 * AI Learning Center — Learning Pattern Detail Page
 * Shows evidence records for a specific learning pattern.
 */

import { useParams, useLocation } from "wouter";
import { ArrowLeft, Brain, CheckCircle2, XCircle, AlertCircle, RefreshCw, Clock } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useLearningPattern } from "@/hooks/useAiLearning";

export default function LearningDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data, isLoading, isError, refetch } = useLearningPattern(id);

  const agreedPct = data ? Math.round(data.reviewerAgreement * 100) : 0;
  const confidencePct = data ? Math.round(data.confidence * 100) : 0;

  return (
    <AppShell>
      <PageHeader
        title="Learning Detail"
        description={data ? data.description : "Loading..."}
        breadcrumb={[
          { label: "AI Review", href: "/ai/review" },
          { label: "Learning", href: "/ai/review/learning" },
          { label: "Detail" },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/ai/review/learning")}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Kembali
            </Button>
          </div>
        }
      />

      {isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Pola tidak ditemukan.{" "}
            <button className="underline" onClick={() => navigate("/ai/review/learning")}>
              Kembali
            </button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      )}

      {!isLoading && data && (
        <div className="space-y-4">
          {/* Summary card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-indigo-500" />
                <CardTitle className="text-base">Pattern Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Intent</p>
                  <p className="text-sm font-semibold">{data.intent ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Recommended COA</p>
                  <p className="text-sm font-mono font-semibold text-indigo-700">{data.recommendedCoa ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Total Transaksi</p>
                  <p className="text-sm font-semibold">{data.occurrenceCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Confidence</p>
                  <Badge className={`text-xs ${confidencePct >= 90 ? "bg-green-600" : confidencePct >= 70 ? "bg-yellow-500" : "bg-gray-400"} text-white`}>
                    {confidencePct}%
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reviewer Agreement</p>
                  <p className={`text-sm font-semibold ${agreedPct >= 90 ? "text-green-600" : agreedPct >= 60 ? "text-yellow-600" : "text-red-600"}`}>
                    {agreedPct}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Last Seen</p>
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {data.lastSeen ? new Date(data.lastSeen).toLocaleDateString("id-ID") : "—"}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Perlu Approval</p>
                  <span className="text-sm text-amber-600 font-medium">Ya</span>
                </div>
              </div>

              {data.reviewerSelectedCoaCodes && data.reviewerSelectedCoaCodes.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Reviewer COA yang dipilih</p>
                  <div className="flex flex-wrap gap-1">
                    {data.reviewerSelectedCoaCodes.map((c) => (
                      <Badge key={c} variant="outline" className="text-xs font-mono">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Feedback records timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                Reviewer History ({data.feedbackRecords.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.feedbackRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Tidak ada feedback records.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>AI COA</TableHead>
                        <TableHead>Reviewer COA</TableHead>
                        <TableHead>Agreement</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Waktu</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.feedbackRecords.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs font-mono">#{r.id}</TableCell>
                          <TableCell className="text-xs font-mono">{r.aiRecommendedCoaCode ?? "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{r.reviewerSelectedCoaCode ?? "—"}</TableCell>
                          <TableCell>
                            {r.agreement === true ? (
                              <span className="flex items-center gap-1 text-green-600 text-xs">
                                <CheckCircle2 className="h-3 w-3" /> Setuju
                              </span>
                            ) : r.agreement === false ? (
                              <span className="flex items-center gap-1 text-red-600 text-xs">
                                <XCircle className="h-3 w-3" /> Tidak
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                            {r.reasonCode ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                r.status === "PROCESSED"
                                  ? "border-green-500 text-green-600"
                                  : r.status === "PENDING"
                                  ? "border-amber-500 text-amber-600"
                                  : ""
                              }`}
                            >
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(r.createdAt).toLocaleDateString("id-ID")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
