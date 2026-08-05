import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, RefreshCw, RotateCcw, CheckCircle,
  XCircle, ChevronDown, ChevronUp, Database, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

type DLQRow = {
  id: number;
  report_id: number | null;
  row_index: number | null;
  error_reason: string | null;
  error_stage: string | null;
  raw_data: Record<string, unknown> | null;
  retry_count: number;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
  original_filename: string | null;
};

type DLQResponse = {
  failedRows: DLQRow[];
  summary: { total: string; transform_errors: string };
};

type Report = { id: number; original_filename: string; status: string };

function fmtDate(v: unknown) {
  if (!v) return "—";
  try { return new Date(String(v)).toLocaleString("id-ID"); } catch { return String(v); }
}

function stageBadgeCls(stage: string | null) {
  if (stage === "transform") return "bg-orange-500/20 text-orange-300 border-orange-600";
  if (stage === "validate") return "bg-yellow-500/20 text-yellow-300 border-yellow-600";
  return "bg-red-500/20 text-red-300 border-red-600";
}

const LIMIT = 50;

export default function FleetDLQPage() {
  const qc = useQueryClient();
  const [reportId, setReportId] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const qs = new URLSearchParams({
    resolved: String(showResolved),
    page: String(page),
    limit: String(LIMIT),
    ...(reportId ? { reportId } : {}),
  });

  const { data, isLoading, error, refetch } = useQuery<DLQResponse>({
    queryKey: ["fleet-dlq", reportId, showResolved, page],
    queryFn: async () => {
      const r = await fetch(`/api/logistics/fleet/pipeline/dlq?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: reportsData } = useQuery<{ reports: Report[] }>({
    queryKey: ["fleet-reports-list"],
    queryFn: async () => {
      const r = await fetch("/api/logistics/fleet/reports", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/logistics/fleet/pipeline/dlq/${id}/retry`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error ?? "Gagal");
      return body;
    },
    onSuccess: () => {
      toast.success("Retry berhasil — baris ditransform ke fleet_transactions");
      qc.invalidateQueries({ queryKey: ["fleet-dlq"] });
    },
    onError: (e: Error) => toast.error(`Retry gagal: ${e.message}`),
  });

  const resolveAllMutation = useMutation({
    mutationFn: async (rptId: string) => {
      const r = await fetch(`/api/logistics/fleet/pipeline/dlq/resolve-all/${rptId}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error ?? "Gagal");
      return body as { resolvedCount: number };
    },
    onSuccess: (d) => {
      toast.success(`${d.resolvedCount} baris DLQ di-resolve`);
      qc.invalidateQueries({ queryKey: ["fleet-dlq"] });
    },
    onError: (e: Error) => toast.error(`Resolve all gagal: ${e.message}`),
  });

  const total = parseInt(String(data?.summary?.total ?? "0")) || 0;
  const transformErrors = parseInt(String(data?.summary?.transform_errors ?? "0")) || 0;
  const rows = data?.failedRows ?? [];
  const unresolvedInPage = rows.filter((r) => !r.resolved).length;
  const resolvedInPage = rows.filter((r) => r.resolved).length;

  return (
    <AppShell>
      <div className="min-h-screen bg-slate-950 p-6 space-y-6">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-red-400" />
              DLQ Retry Panel
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Dead Letter Queue — baris gagal transform, dapat di-retry satu per satu
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-slate-600 text-slate-300 hover:text-white"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-slate-800/60 border-slate-700">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-red-400">{total}</p>
              <p className="text-xs text-slate-400 mt-1">Total DLQ</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/60 border-slate-700">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-orange-400">{transformErrors}</p>
              <p className="text-xs text-slate-400 mt-1">Transform Errors</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/60 border-slate-700">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-white">{unresolvedInPage}</p>
              <p className="text-xs text-slate-400 mt-1">Unresolved (hal. ini)</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/60 border-slate-700">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-emerald-400">{resolvedInPage}</p>
              <p className="text-xs text-slate-400 mt-1">Resolved (hal. ini)</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-slate-300 text-sm block">Filter Report</label>
                <select
                  value={reportId}
                  onChange={(e) => { setReportId(e.target.value); setPage(1); }}
                  className="h-9 bg-slate-700 border border-slate-600 rounded-md text-white text-sm px-3 min-w-[240px]"
                >
                  <option value="">— Semua Report —</option>
                  {(reportsData?.reports ?? []).map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      [{r.id}] {r.original_filename} ({r.status})
                    </option>
                  ))}
                </select>
              </div>

              <Button
                variant="outline"
                size="sm"
                className={`border-slate-600 ${
                  showResolved
                    ? "bg-emerald-900/30 text-emerald-300 border-emerald-700"
                    : "text-slate-300"
                }`}
                onClick={() => { setShowResolved(!showResolved); setPage(1); }}
              >
                <CheckCircle className="w-3.5 h-3.5 mr-1" />
                {showResolved ? "Tampil: Resolved" : "Tampil: Unresolved"}
              </Button>

              {reportId && !showResolved && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-orange-700 text-orange-300 hover:bg-orange-900/20"
                  disabled={resolveAllMutation.isPending}
                  onClick={() => resolveAllMutation.mutate(reportId)}
                >
                  {resolveAllMutation.isPending ? (
                    <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle className="w-3.5 h-3.5 mr-1" />
                  )}
                  Resolve All (Report #{reportId})
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Database className="w-4 h-4 text-slate-400" />
              DLQ Rows
              {total > 0 && (
                <Badge className="bg-red-500/20 text-red-300 border-red-600 border text-xs">
                  {total} total
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && <LoadingSkeleton skeletonRows={5} />}
            {!isLoading && error && (
              <div className="flex items-center justify-center py-12 text-red-400 gap-2">
                <XCircle className="w-5 h-5" />
                Gagal memuat DLQ
              </div>
            )}
            {!isLoading && !error && rows.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-40 text-emerald-400" />
                <p>
                  {showResolved
                    ? "Tidak ada DLQ yang resolved"
                    : "Tidak ada DLQ unresolved 🎉"}
                </p>
              </div>
            )}
            {!isLoading && !error && rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-700">
                    <tr>
                      {["ID", "Report", "Row#", "Stage", "Error", "Retry", "Waktu", "Status", "Aksi"].map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2.5 text-slate-400 font-medium whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <>
                        <tr
                          key={row.id}
                          className="border-b border-slate-700/50 hover:bg-slate-700/20 cursor-pointer"
                          onClick={() =>
                            setExpandedId(expandedId === row.id ? null : row.id)
                          }
                        >
                          <td className="px-3 py-2 text-slate-400 font-mono">#{row.id}</td>
                          <td
                            className="px-3 py-2 text-slate-300 max-w-[160px] truncate"
                            title={row.original_filename ?? ""}
                          >
                            {row.original_filename ?? `Report #${row.report_id}`}
                          </td>
                          <td className="px-3 py-2 text-slate-400">{row.row_index ?? "—"}</td>
                          <td className="px-3 py-2">
                            <Badge
                              className={`text-xs border ${stageBadgeCls(row.error_stage)}`}
                            >
                              {row.error_stage ?? "unknown"}
                            </Badge>
                          </td>
                          <td
                            className="px-3 py-2 text-red-300 max-w-[200px] truncate"
                            title={row.error_reason ?? ""}
                          >
                            {row.error_reason ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-400 text-center">{row.retry_count}</td>
                          <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                            {fmtDate(row.created_at)}
                          </td>
                          <td className="px-3 py-2">
                            {row.resolved ? (
                              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-600 border text-xs">
                                Resolved
                              </Badge>
                            ) : (
                              <Badge className="bg-red-500/20 text-red-300 border-red-600 border text-xs">
                                Open
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              {!row.resolved && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-xs border-blue-700 text-blue-300 hover:bg-blue-900/20"
                                  disabled={retryMutation.isPending}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    retryMutation.mutate(row.id);
                                  }}
                                >
                                  <RotateCcw className="w-3 h-3 mr-1" />
                                  Retry
                                </Button>
                              )}
                              {expandedId === row.id ? (
                                <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedId === row.id && (
                          <tr
                            key={`${row.id}-expand`}
                            className="border-b border-slate-700/50 bg-slate-900/40"
                          >
                            <td colSpan={9} className="px-4 py-3">
                              <p className="text-slate-400 text-xs font-medium mb-2">Raw Data:</p>
                              <pre className="text-xs text-slate-300 bg-slate-900 rounded p-3 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                                {row.raw_data
                                  ? JSON.stringify(row.raw_data, null, 2)
                                  : "Tidak ada raw data"}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>
              Halaman {page} · {total} total
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-slate-600"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                ← Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-600"
                disabled={page * LIMIT >= total}
                onClick={() => setPage(page + 1)}
              >
                Next →
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
