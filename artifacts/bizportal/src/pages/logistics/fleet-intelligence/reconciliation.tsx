import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle, XCircle, AlertTriangle, RefreshCw,
  Database, GitCompare, ShieldAlert, TrendingUp, FileText,
  Table2, ChevronDown, ChevronRight, ArrowLeftRight, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

function fmtNum(v: unknown) {
  return new Intl.NumberFormat("id-ID").format(parseFloat(String(v ?? 0)) || 0);
}
function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  }).format(parseFloat(String(v ?? 0)) || 0);
}
function fmtDelta(v: number) {
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${fmtIdr(abs)}`;
}

// ── Pipeline reconcile types ──────────────────────────────────────────────────
type ReportRecon = {
  reportId: number;
  rawCount: number;
  txCount: number;
  dlqCount: number;
  missingRows: number;
  excessRows: number;
  amountMismatch: boolean;
  rawAmountSum: number;
  txAmountSum: number;
  mismatches: string[];
  status: "ok" | "mismatch";
  healthScore: number;
  healthGrade: string;
};
type ReconSummary = {
  totalReports: number;
  ok: number;
  mismatch: number;
  totalMissing: number;
  totalAmountMismatches: number;
  avgHealthScore: number;
};
type ReconResult = { reconciliation: ReportRecon[]; summary: ReconSummary };

// ── Row-diff types ────────────────────────────────────────────────────────────
type RowDiffReport = { report_id: number; file_name: string; uploaded_at: string; raw_count: number; tx_count: number };
type MatchedRow = {
  rawId: number; txId: number; gopayRef: string | null;
  driverExternalId: string; driverName: string;
  dateIso: string; txDate: string; transactionType: string;
  rawAmount: number; txAmount: number; delta: number; amountMismatch: boolean;
  rawOutstanding: number; txOutstanding: number; outstandingMismatch: boolean;
  matchMethod: "gopay_ref" | "fallback";
};
type MissingRow = {
  rawId: number; gopayRef: string | null; driverExternalId: string;
  driverName: string; dateIso: string; transactionType: string;
  rawAmount: number; rawOutstanding: number; vehicle: string; serviceType: string; dateTimeJkt: string;
};
type ExcessRow = {
  txId: number; gopayRef: string | null; driverExternalId: string;
  driverName: string; txDate: string; transactionType: string;
  txAmount: number; txOutstanding: number; vehiclePlate: string; serviceType: string;
};
type RowDiffResult = {
  reportId: number;
  summary: {
    rawCount: number; txCount: number; matchedCount: number;
    missingCount: number; excessCount: number; amountMismatchCount: number;
    totalRawAmount: number; totalTxAmount: number; totalDelta: number; totalMismatchDelta: number;
  };
  matched: MatchedRow[];
  missingInTx: MissingRow[];
  excessInTx: ExcessRow[];
};

// ── Shared helpers ────────────────────────────────────────────────────────────
function gradeColor(g: string) {
  if (g === "A") return "text-emerald-400";
  if (g === "B") return "text-green-400";
  if (g === "C") return "text-yellow-400";
  if (g === "D") return "text-orange-400";
  return "text-red-400";
}
function StatusBadge({ status }: { status: "ok" | "mismatch" }) {
  if (status === "ok") return (
    <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-600 gap-1 text-xs">
      <CheckCircle className="w-3 h-3" /> Seimbang
    </Badge>
  );
  return (
    <Badge className="bg-red-500/20 text-red-300 border border-red-600 gap-1 text-xs">
      <XCircle className="w-3 h-3" /> Mismatch
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: Pipeline Reconcile (existing)
// ─────────────────────────────────────────────────────────────────────────────
function PipelineReconTab() {
  const [result, setResult] = useState<ReconResult | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const reconMutation = useMutation({
    mutationFn: async (reportId?: number) => {
      const res = await fetch("/api/logistics/fleet/pipeline/reconcile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reportId ? { reportId } : {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error ?? "Rekonsiliasi gagal"));
      }
      return res.json() as Promise<ReconResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      const { summary } = data;
      if (summary.mismatch === 0) toast.success(`Semua ${summary.totalReports} report seimbang`);
      else toast.warning(`${summary.mismatch} dari ${summary.totalReports} report mismatch`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleExpand = (id: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const { summary } = result ?? {};

  return (
    <div className="space-y-6">
      <Button
        onClick={() => reconMutation.mutate(undefined)}
        disabled={reconMutation.isPending}
        className="bg-blue-600 hover:bg-blue-700 h-11 px-6 gap-2"
      >
        {reconMutation.isPending
          ? <><RefreshCw className="w-4 h-4 animate-spin" /> Menjalankan Rekonsiliasi...</>
          : <><GitCompare className="w-4 h-4" /> Jalankan Rekonsiliasi Semua Report</>}
      </Button>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Report", value: fmtNum(summary.totalReports), color: "text-white" },
            { label: "Seimbang (OK)", value: fmtNum(summary.ok), color: "text-emerald-400" },
            { label: "Mismatch", value: fmtNum(summary.mismatch), color: summary.mismatch > 0 ? "text-red-400" : "text-slate-400" },
            { label: "Avg Health", value: String(summary.avgHealthScore), color: gradeColor(summary.avgHealthScore >= 95 ? "A" : summary.avgHealthScore >= 80 ? "B" : summary.avgHealthScore >= 60 ? "C" : "F") },
          ].map((c) => (
            <Card key={c.label} className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4">
                <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{c.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {summary && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          summary.mismatch === 0 ? "bg-emerald-900/20 border-emerald-700/40" : "bg-red-900/20 border-red-700/40"
        }`}>
          {summary.mismatch === 0
            ? <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            : <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />}
          <div>
            {summary.mismatch === 0
              ? <p className="text-emerald-300 font-semibold">Pipeline Seimbang — {summary.totalReports} report terverifikasi</p>
              : <p className="text-red-300 font-semibold">
                  {summary.mismatch} report mismatch — {fmtNum(summary.totalMissing)} baris mungkin hilang
                  {summary.totalAmountMismatches > 0 && `, ${summary.totalAmountMismatches} amount tidak cocok`}
                </p>}
            <p className="text-slate-400 text-xs mt-0.5">Health score rata-rata: {summary.avgHealthScore}/100</p>
          </div>
        </div>
      )}

      {result && result.reconciliation.length > 0 && (
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              Detail per Report ({result.reconciliation.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-700/50">
              {result.reconciliation.map((r) => {
                const isExp = expanded.has(r.reportId);
                const coveragePct = r.rawCount > 0 ? Math.round(((r.txCount + r.dlqCount) / r.rawCount) * 100) : 100;
                return (
                  <div key={r.reportId} className="px-4 py-3">
                    <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => toggleExpand(r.reportId)}>
                      <div className="flex-shrink-0 w-5">
                        {r.status === "ok" ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-400 text-xs font-mono">Report #{r.reportId}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex-1 bg-slate-700 rounded-full h-1.5 max-w-[200px]">
                            <div className={`h-1.5 rounded-full transition-all ${coveragePct === 100 ? "bg-emerald-500" : coveragePct >= 90 ? "bg-yellow-500" : "bg-red-500"}`}
                              style={{ width: `${Math.min(100, coveragePct)}%` }} />
                          </div>
                          <span className="text-xs text-slate-400">{coveragePct}% coverage</span>
                        </div>
                      </div>
                      <div className="hidden md:flex items-center gap-4 text-right text-sm flex-shrink-0">
                        <div><p className="text-white font-semibold">{fmtNum(r.rawCount)}</p><p className="text-xs text-slate-500">Raw</p></div>
                        <div className="text-slate-600">→</div>
                        <div><p className="text-emerald-400 font-semibold">{fmtNum(r.txCount)}</p><p className="text-xs text-slate-500">Transformed</p></div>
                        <div className="text-slate-600">+</div>
                        <div><p className={`font-semibold ${r.dlqCount > 0 ? "text-amber-400" : "text-slate-400"}`}>{fmtNum(r.dlqCount)}</p><p className="text-xs text-slate-500">DLQ</p></div>
                        {r.missingRows > 0 && <><div className="text-slate-600">=</div><div><p className="text-red-400 font-bold">{fmtNum(r.missingRows)}</p><p className="text-xs text-red-500">Hilang!</p></div></>}
                      </div>
                      <div className="flex-shrink-0 text-center">
                        <p className={`text-xl font-bold ${gradeColor(r.healthGrade)}`}>{r.healthGrade}</p>
                        <p className="text-xs text-slate-500">{r.healthScore}/100</p>
                      </div>
                      <div className="flex-shrink-0 text-slate-500 text-xs">{isExp ? "▲" : "▼"}</div>
                    </div>

                    {isExp && (
                      <div className="mt-3 ml-8 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-slate-900/50 rounded-lg p-3">
                            <p className="text-xs text-slate-500 mb-1">Total Amount — Raw</p>
                            <p className="text-white font-semibold">{fmtIdr(r.rawAmountSum)}</p>
                          </div>
                          <div className="bg-slate-900/50 rounded-lg p-3">
                            <p className="text-xs text-slate-500 mb-1">Total Amount — Transformed</p>
                            <p className={`font-semibold ${r.amountMismatch ? "text-red-400" : "text-emerald-400"}`}>{fmtIdr(r.txAmountSum)}</p>
                          </div>
                        </div>
                        <div className="bg-slate-900/40 rounded-lg p-3 font-mono text-xs space-y-1">
                          <div className="flex justify-between text-slate-400"><span>Raw CSV baris masuk</span><span className="text-white">{fmtNum(r.rawCount)}</span></div>
                          <div className="flex justify-between text-slate-400"><span>= Transformed (fleet_transactions)</span><span className="text-emerald-400">{fmtNum(r.txCount)}</span></div>
                          <div className="flex justify-between text-slate-400"><span>+ DLQ (gojek_failed_rows)</span><span className="text-amber-400">{fmtNum(r.dlqCount)}</span></div>
                          <div className="border-t border-slate-700 pt-1 flex justify-between">
                            <span className="text-slate-300">Terhitung</span>
                            <span className={r.missingRows > 0 ? "text-red-400" : "text-emerald-400"}>{fmtNum(r.txCount + r.dlqCount)}</span>
                          </div>
                          {r.missingRows > 0
                            ? <div className="flex justify-between text-red-400 font-bold"><span>⚠ Baris Hilang</span><span>{fmtNum(r.missingRows)}</span></div>
                            : <div className="flex justify-between text-emerald-400"><span>✓ Tidak ada data hilang</span><span>0</span></div>}
                        </div>
                        {r.mismatches.length > 0 && (
                          <div className="space-y-1">
                            {r.mismatches.map((m, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-red-300">
                                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-red-400" /> {m}
                              </div>
                            ))}
                          </div>
                        )}
                        <Button size="sm" variant="outline"
                          className="border-slate-600 text-slate-300 hover:text-white gap-1.5 h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); reconMutation.mutate(r.reportId); }}
                          disabled={reconMutation.isPending}>
                          <RefreshCw className={`w-3 h-3 ${reconMutation.isPending ? "animate-spin" : ""}`} />
                          Re-run Report #{r.reportId}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {!result && !reconMutation.isPending && (
        <Card className="bg-slate-800/40 border-slate-700/50">
          <CardContent className="py-16 text-center space-y-3">
            <GitCompare className="w-12 h-12 text-slate-600 mx-auto" />
            <p className="text-slate-400 font-medium">Belum ada hasil rekonsiliasi</p>
            <p className="text-slate-500 text-sm">Klik tombol di atas untuk memverifikasi integritas pipeline</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-slate-500 px-1">
        <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5 text-blue-400" /> Raw = <span className="font-mono">gojek_raw_transactions</span></span>
        <span className="flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> Transformed = <span className="font-mono">fleet_transactions</span></span>
        <span className="flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> DLQ = <span className="font-mono">gojek_failed_rows</span></span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: Row-by-Row Diff
// ─────────────────────────────────────────────────────────────────────────────
function RowDiffSection({ rows, title, color, icon }: {
  rows: any[]; title: string; color: string; icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (rows.length === 0) return null;
  return (
    <Card className="bg-slate-800/60 border-slate-700">
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setOpen((p) => !p)}>
        <CardTitle className={`text-sm flex items-center gap-2 ${color}`}>
          {icon}
          {title} ({rows.length})
          {open ? <ChevronDown className="w-4 h-4 ml-auto text-slate-400" /> : <ChevronRight className="w-4 h-4 ml-auto text-slate-400" />}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400">
                {Object.keys(rows[0]).map((k) => (
                  <th key={k} className="px-3 py-2 text-left font-medium whitespace-nowrap">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-700/40 hover:bg-slate-700/20">
                  {Object.values(row).map((v, j) => {
                    const k = Object.keys(row)[j];
                    const isAmt = k.includes("Amount") || k.includes("amount") || k.includes("delta") || k.includes("Delta");
                    const isDelta = k === "delta";
                    const val = v as any;
                    return (
                      <td key={j} className={`px-3 py-1.5 whitespace-nowrap font-mono
                        ${isDelta && val !== 0 ? (val > 0 ? "text-red-400" : "text-amber-400") : ""}
                        ${k === "amountMismatch" && val ? "text-red-400 font-bold" : ""}
                        ${k === "matchMethod" && val === "fallback" ? "text-yellow-400" : ""}
                        ${!isDelta && !k.includes("Mismatch") ? "text-slate-300" : ""}
                      `}>
                        {isDelta
                          ? fmtDelta(val)
                          : isAmt && typeof val === "number"
                            ? fmtIdr(val)
                            : typeof val === "boolean"
                              ? (val ? <span className="text-red-400">⚠ Ya</span> : <span className="text-emerald-400">✓ Tidak</span>)
                              : String(val ?? "—")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      )}
    </Card>
  );
}

function RowDiffTab() {
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [result, setResult] = useState<RowDiffResult | null>(null);
  const [showMatched, setShowMatched] = useState(false);

  const { data: reportsData, isLoading: reportsLoading } = useQuery({
    queryKey: ["fleet-row-diff-reports"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/row-diff/reports", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat daftar report");
      return res.json() as Promise<{ reports: RowDiffReport[] }>;
    },
  });

  const diffMutation = useMutation({
    mutationFn: async (reportId: number) => {
      const res = await fetch(`/api/logistics/fleet/row-diff?reportId=${reportId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error ?? "Gagal menjalankan row-diff"));
      }
      return res.json() as Promise<RowDiffResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      const s = data.summary;
      if (s.missingCount === 0 && s.amountMismatchCount === 0 && s.excessCount === 0) {
        toast.success("Semua baris cocok sempurna — tidak ada selisih!");
      } else {
        const parts: string[] = [];
        if (s.missingCount > 0) parts.push(`${s.missingCount} baris hilang`);
        if (s.amountMismatchCount > 0) parts.push(`${s.amountMismatchCount} amount mismatch`);
        if (s.excessCount > 0) parts.push(`${s.excessCount} baris berlebih`);
        toast.warning(parts.join(", "));
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reports = reportsData?.reports ?? [];
  const s = result?.summary;

  const missingDisplayRows = (result?.missingInTx ?? []).map((r) => ({
    "raw_id": r.rawId,
    "gopay_ref": r.gopayRef ?? "—",
    "driver_id": r.driverExternalId,
    "driver_name": r.driverName,
    "tanggal": r.dateIso,
    "tipe": r.transactionType,
    "raw_amount": r.rawAmount,
    "outstanding": r.rawOutstanding,
    "kendaraan": r.vehicle ?? "—",
  }));

  const excessDisplayRows = (result?.excessInTx ?? []).map((r) => ({
    "tx_id": r.txId,
    "gopay_ref": r.gopayRef ?? "—",
    "driver_id": r.driverExternalId,
    "driver_name": r.driverName,
    "tanggal": r.txDate,
    "tipe": r.transactionType,
    "tx_amount": r.txAmount,
    "outstanding": r.txOutstanding,
  }));

  const mismatchDisplayRows = (result?.matched ?? [])
    .filter((m) => m.amountMismatch || m.outstandingMismatch)
    .map((m) => ({
      "raw_id": m.rawId,
      "tx_id": m.txId,
      "gopay_ref": m.gopayRef ?? "—",
      "driver_id": m.driverExternalId,
      "driver_name": m.driverName,
      "tanggal": m.dateIso,
      "tipe": m.transactionType,
      "raw_amount": m.rawAmount,
      "tx_amount": m.txAmount,
      "delta": m.delta,
      "amountMismatch": m.amountMismatch,
      "match_via": m.matchMethod,
    }));

  const matchedDisplayRows = showMatched
    ? (result?.matched ?? [])
        .filter((m) => !m.amountMismatch && !m.outstandingMismatch)
        .slice(0, 200)
        .map((m) => ({
          "raw_id": m.rawId,
          "tx_id": m.txId,
          "gopay_ref": m.gopayRef ?? "—",
          "driver_id": m.driverExternalId,
          "driver_name": m.driverName,
          "tanggal": m.dateIso,
          "tipe": m.transactionType,
          "raw_amount": m.rawAmount,
          "tx_amount": m.txAmount,
          "delta": m.delta,
          "match_via": m.matchMethod,
        }))
    : [];

  return (
    <div className="space-y-6">
      {/* Select report */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label className="text-xs text-slate-400 mb-1.5 block">Pilih Report</label>
          <select
            className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedReportId ?? ""}
            onChange={(e) => setSelectedReportId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">-- pilih report --</option>
            {reportsLoading && <option disabled>Memuat...</option>}
            {reports.map((r) => (
              <option key={r.report_id} value={r.report_id}>
                #{r.report_id} — {r.file_name ?? "Tanpa nama"} ({r.raw_count} raw / {r.tx_count} tx)
              </option>
            ))}
          </select>
        </div>
        <Button
          onClick={() => selectedReportId && diffMutation.mutate(selectedReportId)}
          disabled={!selectedReportId || diffMutation.isPending}
          className="bg-violet-600 hover:bg-violet-700 gap-2 h-10"
        >
          {diffMutation.isPending
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Membandingkan...</>
            : <><ArrowLeftRight className="w-4 h-4" /> Bandingkan Baris</>}
        </Button>
      </div>

      {/* Summary cards */}
      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-white">{fmtNum(s.rawCount)}</p>
                <p className="text-xs text-slate-400 mt-0.5">Raw CSV baris</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-emerald-400">{fmtNum(s.matchedCount)}</p>
                <p className="text-xs text-slate-400 mt-0.5">Cocok (matched)</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4">
                <p className={`text-2xl font-bold ${s.missingCount > 0 ? "text-red-400" : "text-slate-500"}`}>
                  {fmtNum(s.missingCount)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Hilang di fleet_tx</p>
              </CardContent>
            </Card>
            <Card className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4">
                <p className={`text-2xl font-bold ${s.amountMismatchCount > 0 ? "text-yellow-400" : "text-slate-500"}`}>
                  {fmtNum(s.amountMismatchCount)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Amount mismatch</p>
              </CardContent>
            </Card>
          </div>

          {/* Selisih banner */}
          <div className={`flex items-start gap-3 px-4 py-4 rounded-xl border ${
            Math.abs(s.totalDelta) < 1
              ? "bg-emerald-900/20 border-emerald-700/40"
              : "bg-red-900/20 border-red-700/40"
          }`}>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                {Math.abs(s.totalDelta) < 1
                  ? <CheckCircle className="w-5 h-5 text-emerald-400" />
                  : <AlertTriangle className="w-5 h-5 text-red-400" />}
                <p className={`font-bold text-base ${Math.abs(s.totalDelta) < 1 ? "text-emerald-300" : "text-red-300"}`}>
                  {Math.abs(s.totalDelta) < 1 ? "Tidak ada selisih total" : `Selisih Total: ${fmtDelta(s.totalDelta)}`}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="bg-slate-900/40 rounded-lg px-3 py-2">
                  <p className="text-xs text-slate-500 mb-0.5">Total Raw (CSV)</p>
                  <p className="text-white font-semibold font-mono">{fmtIdr(s.totalRawAmount)}</p>
                </div>
                <div className="bg-slate-900/40 rounded-lg px-3 py-2">
                  <p className="text-xs text-slate-500 mb-0.5">Total fleet_transactions</p>
                  <p className="text-emerald-400 font-semibold font-mono">{fmtIdr(s.totalTxAmount)}</p>
                </div>
                <div className="bg-slate-900/40 rounded-lg px-3 py-2">
                  <p className="text-xs text-slate-500 mb-0.5">Selisih dari row mismatch</p>
                  <p className={`font-semibold font-mono ${Math.abs(s.totalMismatchDelta) > 0 ? "text-yellow-400" : "text-slate-400"}`}>
                    {fmtDelta(s.totalMismatchDelta)}
                  </p>
                </div>
              </div>
              {s.excessCount > 0 && (
                <p className="text-xs text-orange-300 mt-2">
                  ⚠ {s.excessCount} baris ada di fleet_transactions tapi tidak ada di raw CSV
                </p>
              )}
            </div>
          </div>

          {/* Missing rows */}
          <RowDiffSection
            rows={missingDisplayRows}
            title="Baris Hilang — ada di Raw CSV, tidak ada di fleet_transactions"
            color="text-red-300"
            icon={<XCircle className="w-4 h-4" />}
          />

          {/* Amount mismatches */}
          <RowDiffSection
            rows={mismatchDisplayRows}
            title="Transformasi Salah — amount berbeda antara raw CSV dan fleet_transactions"
            color="text-yellow-300"
            icon={<AlertTriangle className="w-4 h-4" />}
          />

          {/* Excess in tx */}
          <RowDiffSection
            rows={excessDisplayRows}
            title="Baris Berlebih — ada di fleet_transactions tapi tidak ada di Raw CSV"
            color="text-orange-300"
            icon={<ShieldAlert className="w-4 h-4" />}
          />

          {/* Matched (clean) */}
          <Card className="bg-slate-800/40 border-slate-700/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <p className="text-emerald-300 text-sm font-medium">
                    {fmtNum(result!.matched.filter((m) => !m.amountMismatch && !m.outstandingMismatch).length)} baris cocok sempurna
                  </p>
                </div>
                <Button
                  size="sm" variant="ghost"
                  className="text-xs text-slate-400 h-7"
                  onClick={() => setShowMatched((p) => !p)}
                >
                  {showMatched ? "Sembunyikan" : "Tampilkan (maks 200)"}
                </Button>
              </div>
            </CardContent>
            {showMatched && matchedDisplayRows.length > 0 && (
              <CardContent className="p-0 overflow-x-auto border-t border-slate-700">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      {Object.keys(matchedDisplayRows[0]).map((k) => (
                        <th key={k} className="px-3 py-2 text-left font-medium whitespace-nowrap">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matchedDisplayRows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/10">
                        {Object.entries(row).map(([k, v]) => (
                          <td key={k} className={`px-3 py-1.5 whitespace-nowrap font-mono text-slate-400
                            ${k === "match_via" && v === "fallback" ? "text-yellow-400" : ""}
                          `}>
                            {(k.includes("amount") || k.includes("Amount") || k === "delta")
                              ? fmtIdr(v as number)
                              : String(v ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            )}
          </Card>
        </>
      )}

      {!result && !diffMutation.isPending && (
        <Card className="bg-slate-800/40 border-slate-700/50">
          <CardContent className="py-16 text-center space-y-3">
            <Table2 className="w-12 h-12 text-slate-600 mx-auto" />
            <p className="text-slate-400 font-medium">Pilih report dan klik "Bandingkan Baris"</p>
            <p className="text-slate-500 text-sm">
              Setiap baris Raw CSV akan dibandingkan 1:1 dengan fleet_transactions menggunakan GoPay Reference ID.<br />
              Baris tanpa GoPay Ref akan dicocokkan via (driver_id + tanggal + amount).
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function FleetReconciliationPage() {
  const [tab, setTab] = useState<"pipeline" | "rowdiff">("pipeline");

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <GitCompare className="w-6 h-6 text-blue-400" />
              Rekonsiliasi Pipeline
            </h1>
            <Badge className="bg-blue-500/15 text-blue-300 border border-blue-600/50 text-xs px-2 py-0.5">
              Zero-Loss Verifier
            </Badge>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Bandingkan <span className="font-mono text-slate-300">gojek_raw_transactions</span> vs{" "}
            <span className="font-mono text-slate-300">fleet_transactions</span> — deteksi baris hilang dan transformasi salah
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-800/60 p-1 rounded-lg w-fit border border-slate-700/50">
          <button
            onClick={() => setTab("pipeline")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "pipeline"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <GitCompare className="w-4 h-4" /> Pipeline (per report)
          </button>
          <button
            onClick={() => setTab("rowdiff")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "rowdiff"
                ? "bg-violet-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Table2 className="w-4 h-4" /> Row-by-Row Diff
            <Badge className="bg-red-500/20 text-red-300 border-0 text-xs px-1.5 py-0">Rp 68k</Badge>
          </button>
        </div>

        {tab === "pipeline" ? <PipelineReconTab /> : <RowDiffTab />}
      </div>
    </AppShell>
  );
}
