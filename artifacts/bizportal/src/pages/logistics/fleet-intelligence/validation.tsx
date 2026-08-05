import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle, XCircle, AlertTriangle, ShieldCheck, RefreshCw,
  Search, ChevronDown, ChevronUp, ClipboardList, Database, Calculator, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    parseFloat(String(v ?? 0)) || 0
  );
}
function fmtNum(v: unknown) {
  return new Intl.NumberFormat("id-ID").format(parseFloat(String(v ?? 0)) || 0);
}
function fmtDate(v: unknown) {
  if (!v) return "-";
  return new Date(String(v)).toLocaleDateString("id-ID", { dateStyle: "medium" });
}

type CheckStatus = "ok" | "warn" | "fail" | "critical";

function StatusBadge({ status }: { status: CheckStatus }) {
  const map: Record<CheckStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    ok:       { label: "OK",       cls: "bg-emerald-500/20 text-emerald-300 border-emerald-600", icon: <CheckCircle className="h-3 w-3" /> },
    warn:     { label: "WARNING",  cls: "bg-yellow-500/20 text-yellow-300 border-yellow-600",   icon: <AlertTriangle className="h-3 w-3" /> },
    fail:     { label: "FAIL",     cls: "bg-red-500/20 text-red-300 border-red-600",             icon: <XCircle className="h-3 w-3" /> },
    critical: { label: "CRITICAL", cls: "bg-red-600/30 text-red-200 border-red-500",             icon: <XCircle className="h-3 w-3" /> },
  };
  const m = map[status] ?? map.warn;
  return (
    <Badge variant="outline" className={`${m.cls} flex items-center gap-1 font-mono text-xs`}>
      {m.icon}{m.label}
    </Badge>
  );
}

type ValidationReport = {
  generatedAt: string;
  companyId: number;
  summary: {
    totalTransactions: number;
    totalGrossRevenue: number;
    totalNetRevenue: number;
    totalPpn: number;
  };
  checks: {
    duplicateTransactions: { status: CheckStatus; count: number; items: Record<string, unknown>[] };
    summaryIntegrity: { status: CheckStatus; count: number; items: Record<string, unknown>[] };
    ppnConsistency: { status: CheckStatus; count: number; items: Record<string, unknown>[] };
    multiTenantSecurity: { status: CheckStatus; nullCounts: Record<string, unknown> };
    outstandingIntegrity: { status: CheckStatus; outstandingTableSum: number; transactionSum: number; diff: number };
    journalIntegrity: { status: CheckStatus; count: number; items: Record<string, unknown>[] };
  };
};

type TraceReport = {
  report: Record<string, unknown>;
  transactions: Record<string, unknown>[];
  transactionSummary: { count: number; totalGross: number; totalNet: number; totalPpn: number };
  affectedDailySummaries: Record<string, unknown>[];
};

function CheckSection({ title, status, count, children }: {
  title: string; status: CheckStatus; count?: number; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          <span className="text-sm font-medium text-slate-200">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="text-xs text-slate-400">({count} masalah ditemukan)</span>
          )}
        </div>
        {children && (open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />)}
      </button>
      {open && children && (
        <div className="border-t border-slate-700 p-4">{children}</div>
      )}
    </div>
  );
}

export default function FleetValidationPage() {
  const qc = useQueryClient();
  const [traceReportId, setTraceReportId] = useState("");

  const { data: report, isLoading, refetch } = useQuery<ValidationReport>({
    queryKey: ["fleet-validation-report"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/validation/report", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil validation report");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: trace, isLoading: traceLoading, refetch: refetchTrace } = useQuery<TraceReport>({
    queryKey: ["fleet-validation-trace", traceReportId],
    queryFn: async () => {
      const id = parseInt(traceReportId);
      if (!id) throw new Error("ID tidak valid");
      const res = await fetch(`/api/logistics/fleet/validation/trace/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil trace");
      return res.json();
    },
    enabled: false,
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/validation/reconcile", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error ?? "Gagal rekonsiliasi"));
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Rekonsiliasi berhasil — daily summary diperbarui dari raw transactions");
      qc.invalidateQueries({ queryKey: ["fleet-validation-report"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const overallStatus: CheckStatus = report
    ? (Object.values(report.checks).some((c) => (c as { status: CheckStatus }).status === "critical")
        ? "critical"
        : Object.values(report.checks).some((c) => (c as { status: CheckStatus }).status === "fail")
        ? "fail"
        : Object.values(report.checks).some((c) => (c as { status: CheckStatus }).status === "warn")
        ? "warn"
        : "ok")
    : "ok";

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-emerald-400" />
            <div>
              <h1 className="text-xl font-bold text-slate-100">System Validation Report</h1>
              <p className="text-sm text-slate-400">Audit integritas data Fleet Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              className="border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {report && overallStatus !== "ok" && (
              <Button
                size="sm"
                onClick={() => reconcileMutation.mutate()}
                disabled={reconcileMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Database className="h-4 w-4 mr-2" />
                {reconcileMutation.isPending ? "Memproses..." : "Rekonsiliasi"}
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-slate-400">Memuat validation report...</div>
        ) : !report ? (
          <div className="text-center py-16 text-slate-400">Gagal memuat report. Coba refresh.</div>
        ) : (
          <>
            {/* Overall status banner */}
            <Card className={`bg-slate-900 border ${overallStatus === "ok" ? "border-emerald-700" : overallStatus === "warn" ? "border-yellow-600" : "border-red-600"}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusBadge status={overallStatus} />
                  <span className="text-sm text-slate-300">
                    {overallStatus === "ok"
                      ? "Semua pemeriksaan integritas data lulus."
                      : overallStatus === "warn"
                      ? "Ada inkonsistensi ringan yang perlu diperhatikan."
                      : "Ditemukan masalah kritis — periksa detail di bawah."}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  Digenerate: {fmtDate(report.generatedAt)} {new Date(report.generatedAt).toLocaleTimeString("id-ID")}
                </span>
              </CardContent>
            </Card>

            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Transaksi", value: fmtNum(report.summary.totalTransactions) },
                { label: "Total Gross Revenue", value: fmtIdr(report.summary.totalGrossRevenue) },
                { label: "Total Net Revenue", value: fmtIdr(report.summary.totalNetRevenue) },
                { label: "Total PPN", value: fmtIdr(report.summary.totalPpn) },
              ].map((s) => (
                <Card key={s.label} className="bg-slate-900 border-slate-700">
                  <CardContent className="p-4">
                    <div className="text-xs text-slate-400 mb-1">{s.label}</div>
                    <div className="text-base font-semibold text-slate-100">{s.value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Check results */}
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-slate-100 flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-blue-400" />
                  Hasil Pemeriksaan Integritas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* 1. Duplicate transactions */}
                <CheckSection
                  title="Duplikasi Transaksi (cross-report)"
                  status={report.checks.duplicateTransactions.status}
                  count={report.checks.duplicateTransactions.count}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-slate-300">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-1 pr-3 text-slate-400">Driver</th>
                          <th className="text-left py-1 pr-3 text-slate-400">Tanggal</th>
                          <th className="text-right py-1 pr-3 text-slate-400">Jumlah Baris</th>
                          <th className="text-right py-1 text-slate-400">Total Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.checks.duplicateTransactions.items.map((r, i) => (
                          <tr key={i} className="border-b border-slate-800">
                            <td className="py-1 pr-3">{String(r.driver_name)}</td>
                            <td className="py-1 pr-3">{fmtDate(r.transaction_date)}</td>
                            <td className="py-1 pr-3 text-right text-red-400 font-mono">{String(r.cnt)}</td>
                            <td className="py-1 text-right">{fmtIdr(r.total_gross)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CheckSection>

                {/* 2. Daily summary integrity */}
                <CheckSection
                  title="Konsistensi Daily Summary vs Raw Transactions"
                  status={report.checks.summaryIntegrity.status}
                  count={report.checks.summaryIntegrity.count}
                >
                  {report.checks.summaryIntegrity.count > 0 && (
                    <div className="mb-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reconcileMutation.mutate()}
                        disabled={reconcileMutation.isPending}
                        className="border-amber-600 text-amber-400 hover:bg-amber-900/30 text-xs"
                      >
                        <Database className="h-3 w-3 mr-1" />
                        Perbaiki Otomatis (Rekonsiliasi)
                      </Button>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-slate-300">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-1 pr-3 text-slate-400">Tanggal</th>
                          <th className="text-right py-1 pr-3 text-slate-400">Summary Gross</th>
                          <th className="text-right py-1 pr-3 text-slate-400">TX Gross</th>
                          <th className="text-right py-1 text-slate-400">Selisih</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.checks.summaryIntegrity.items.map((r, i) => (
                          <tr key={i} className="border-b border-slate-800">
                            <td className="py-1 pr-3">{fmtDate(r.summary_date)}</td>
                            <td className="py-1 pr-3 text-right">{fmtIdr(r.summary_gross)}</td>
                            <td className="py-1 pr-3 text-right">{fmtIdr(r.tx_gross)}</td>
                            <td className="py-1 text-right text-yellow-400 font-mono">{fmtIdr(r.diff)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CheckSection>

                {/* 3. PPN consistency */}
                <CheckSection
                  title="Konsistensi PPN (ppn_amount = gross × rate / 100)"
                  status={report.checks.ppnConsistency.status}
                  count={report.checks.ppnConsistency.count}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-slate-300">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-1 pr-3 text-slate-400">Driver</th>
                          <th className="text-left py-1 pr-3 text-slate-400">Tanggal</th>
                          <th className="text-right py-1 pr-3 text-slate-400">Gross</th>
                          <th className="text-right py-1 pr-3 text-slate-400">Rate</th>
                          <th className="text-right py-1 pr-3 text-slate-400">PPN Tersimpan</th>
                          <th className="text-right py-1 pr-3 text-slate-400">PPN Seharusnya</th>
                          <th className="text-right py-1 text-slate-400">Selisih</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.checks.ppnConsistency.items.map((r, i) => (
                          <tr key={i} className="border-b border-slate-800">
                            <td className="py-1 pr-3">{String(r.driver_name)}</td>
                            <td className="py-1 pr-3">{fmtDate(r.transaction_date)}</td>
                            <td className="py-1 pr-3 text-right">{fmtIdr(r.gross_revenue)}</td>
                            <td className="py-1 pr-3 text-right">{String(r.ppn_rate)}%</td>
                            <td className="py-1 pr-3 text-right">{fmtIdr(r.ppn_amount)}</td>
                            <td className="py-1 pr-3 text-right">{fmtIdr(r.expected_ppn)}</td>
                            <td className="py-1 text-right text-yellow-400 font-mono">{fmtIdr(r.ppn_diff)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CheckSection>

                {/* 4. Multi-tenant security */}
                <CheckSection
                  title="Keamanan Multi-Tenant (tidak ada data tanpa company_id)"
                  status={report.checks.multiTenantSecurity.status}
                >
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    {Object.entries(report.checks.multiTenantSecurity.nullCounts).map(([k, v]) => (
                      <div key={k} className="bg-slate-800 rounded p-2">
                        <div className="text-slate-400 mb-1">{k}</div>
                        <div className={`font-mono font-semibold ${parseFloat(String(v)) > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {String(v)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CheckSection>

                {/* 5. Outstanding integrity */}
                <CheckSection
                  title="Integritas Data Outstanding"
                  status={report.checks.outstandingIntegrity.status}
                >
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="bg-slate-800 rounded p-2">
                      <div className="text-slate-400 mb-1">Total tabel fleet_outstanding</div>
                      <div className="font-mono text-slate-200">{fmtIdr(report.checks.outstandingIntegrity.outstandingTableSum)}</div>
                    </div>
                    <div className="bg-slate-800 rounded p-2">
                      <div className="text-slate-400 mb-1">SUM dari fleet_transactions</div>
                      <div className="font-mono text-slate-200">{fmtIdr(report.checks.outstandingIntegrity.transactionSum)}</div>
                    </div>
                    <div className={`rounded p-2 ${report.checks.outstandingIntegrity.diff < 1 ? "bg-emerald-900/30" : "bg-yellow-900/30"}`}>
                      <div className="text-slate-400 mb-1">Selisih</div>
                      <div className={`font-mono font-semibold ${report.checks.outstandingIntegrity.diff < 1 ? "text-emerald-400" : "text-yellow-400"}`}>
                        {fmtIdr(report.checks.outstandingIntegrity.diff)}
                      </div>
                    </div>
                  </div>
                </CheckSection>

                {/* 6. Journal integrity */}
                <CheckSection
                  title="Konsistensi Jurnal Akuntansi vs Transactions"
                  status={report.checks.journalIntegrity.status}
                  count={report.checks.journalIntegrity.count}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-slate-300">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-1 pr-3 text-slate-400">No. Ref</th>
                          <th className="text-left py-1 pr-3 text-slate-400">Periode</th>
                          <th className="text-right py-1 pr-3 text-slate-400">Jurnal Gross</th>
                          <th className="text-right py-1 pr-3 text-slate-400">TX Gross</th>
                          <th className="text-right py-1 text-slate-400">Selisih</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.checks.journalIntegrity.items.map((r, i) => (
                          <tr key={i} className="border-b border-slate-800">
                            <td className="py-1 pr-3 font-mono text-blue-400">{String(r.reference_no)}</td>
                            <td className="py-1 pr-3">{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</td>
                            <td className="py-1 pr-3 text-right">{fmtIdr(r.journal_gross)}</td>
                            <td className="py-1 pr-3 text-right">{fmtIdr(r.tx_gross)}</td>
                            <td className="py-1 text-right text-yellow-400 font-mono">{fmtIdr(r.diff)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CheckSection>
              </CardContent>
            </Card>
          </>
        )}

        {/* Transaction Trace Viewer */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-slate-100 flex items-center gap-2">
              <Search className="h-4 w-4 text-purple-400" />
              Trace Viewer — Lacak Report ke Transaksi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-xs">
                <Label className="text-xs text-slate-400 mb-1">Report ID</Label>
                <Input
                  type="number"
                  value={traceReportId}
                  onChange={(e) => setTraceReportId(e.target.value)}
                  placeholder="e.g. 42"
                  className="bg-slate-800 border-slate-600 text-slate-200 text-sm"
                />
              </div>
              <Button
                size="sm"
                onClick={() => refetchTrace()}
                disabled={!traceReportId || traceLoading}
                className="bg-purple-700 hover:bg-purple-800 text-white"
              >
                <Search className="h-4 w-4 mr-2" />
                {traceLoading ? "Memuat..." : "Trace"}
              </Button>
            </div>

            {trace && (
              <div className="space-y-4">
                {/* Report header */}
                <div className="bg-slate-800 rounded-lg p-4 text-sm">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-slate-200">
                      Report #{String(trace.report.id)} — {String(trace.report.file_name ?? "")}
                    </span>
                    <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
                      {String(trace.report.status ?? "unknown")}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-400">
                    <div>Partner: <span className="text-slate-200">{String(trace.report.partner_name ?? "-")}</span></div>
                    <div>Upload: <span className="text-slate-200">{fmtDate(trace.report.created_at)}</span></div>
                    <div>Transaksi: <span className="text-slate-200">{fmtNum(trace.transactionSummary.count)}</span></div>
                    <div>Total Gross: <span className="text-slate-200">{fmtIdr(trace.transactionSummary.totalGross)}</span></div>
                  </div>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Gross Revenue", value: fmtIdr(trace.transactionSummary.totalGross) },
                    { label: "Net Revenue", value: fmtIdr(trace.transactionSummary.totalNet) },
                    { label: "Total PPN", value: fmtIdr(trace.transactionSummary.totalPpn) },
                  ].map((s) => (
                    <div key={s.label} className="bg-slate-800 rounded p-3 text-center">
                      <div className="text-xs text-slate-400 mb-1">{s.label}</div>
                      <div className="text-sm font-semibold text-slate-200">{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Transactions table */}
                <div>
                  <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1">
                    <Calculator className="h-3 w-3" />
                    Transaksi ({trace.transactions.length} baris)
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs text-slate-300 min-w-[600px]">
                      <thead className="sticky top-0 bg-slate-900">
                        <tr className="border-b border-slate-700">
                          <th className="text-left py-1 pr-3 text-slate-400">Driver</th>
                          <th className="text-left py-1 pr-3 text-slate-400">Plat</th>
                          <th className="text-left py-1 pr-3 text-slate-400">Tanggal</th>
                          <th className="text-right py-1 pr-3 text-slate-400">Trip</th>
                          <th className="text-right py-1 pr-3 text-slate-400">Gross</th>
                          <th className="text-right py-1 pr-3 text-slate-400">Net</th>
                          <th className="text-right py-1 text-slate-400">PPN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trace.transactions.map((tx, i) => (
                          <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/40">
                            <td className="py-1 pr-3 font-medium">{String(tx.driver_name)}</td>
                            <td className="py-1 pr-3 text-slate-400 font-mono">{String(tx.vehicle_plate ?? "-")}</td>
                            <td className="py-1 pr-3">{fmtDate(tx.transaction_date)}</td>
                            <td className="py-1 pr-3 text-right">{String(tx.trip_count ?? 0)}</td>
                            <td className="py-1 pr-3 text-right">{fmtIdr(tx.gross_revenue)}</td>
                            <td className="py-1 pr-3 text-right">{fmtIdr(tx.net_revenue)}</td>
                            <td className="py-1 text-right">{fmtIdr(tx.ppn_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Affected daily summaries */}
                {trace.affectedDailySummaries.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-slate-400 mb-2">
                      Daily Summary Terpengaruh ({trace.affectedDailySummaries.length} tanggal)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-slate-300">
                        <thead>
                          <tr className="border-b border-slate-700">
                            <th className="text-left py-1 pr-3 text-slate-400">Tanggal</th>
                            <th className="text-right py-1 pr-3 text-slate-400">Driver Aktif</th>
                            <th className="text-right py-1 pr-3 text-slate-400">Total Trip</th>
                            <th className="text-right py-1 pr-3 text-slate-400">Summary Gross</th>
                            <th className="text-right py-1 text-slate-400">TX Gross</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trace.affectedDailySummaries.map((s, i) => {
                            const diff = Math.abs(parseFloat(String(s.summary_gross ?? 0)) - parseFloat(String(s.tx_gross_for_date ?? 0)));
                            return (
                              <tr key={i} className="border-b border-slate-800">
                                <td className="py-1 pr-3">{fmtDate(s.summary_date)}</td>
                                <td className="py-1 pr-3 text-right">{String(s.active_drivers)}</td>
                                <td className="py-1 pr-3 text-right">{String(s.total_trips)}</td>
                                <td className="py-1 pr-3 text-right">{fmtIdr(s.summary_gross)}</td>
                                <td className={`py-1 text-right ${diff > 1 ? "text-yellow-400" : "text-emerald-400"}`}>
                                  {fmtIdr(s.tx_gross_for_date)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
