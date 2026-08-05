import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, PlusCircle, CheckCircle, Send, RefreshCw, ChevronDown, ChevronUp, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(parseFloat(String(v ?? 0)) || 0);
}
function fmtDate(v: unknown) {
  if (!v) return "-";
  return new Date(String(v)).toLocaleDateString("id-ID", { dateStyle: "medium" });
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-500/20 text-slate-300 border-slate-600" },
  approved: { label: "Disetujui", cls: "bg-blue-500/20 text-blue-300 border-blue-600" },
  posted: { label: "Diposting", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-600" },
};

type Journal = {
  id: number;
  journal_date: string;
  reference_no: string;
  status: string;
  period_start: string;
  period_end: string;
  gross_revenue: string;
  net_revenue: string;
  ppn_amount: string;
  ppn_rate: string;
  driver_payout: string;
  outstanding_amount: string;
  commission_total: string;
  incentive_total: string;
  created_by: string;
  approved_by: string;
  approved_at: string;
  posted_by: string;
  posted_at: string;
  notes: string;
};

export default function FleetAccountingPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [showGenForm, setShowGenForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [genForm, setGenForm] = useState({
    periodStart: "",
    periodEnd: "",
    ppnRate: "11",
    notes: "",
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["fleet-accounting-journals", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/logistics/fleet/accounting/journals?${params}`, { credentials: "include" });
      return res.json() as Promise<{ journals: Journal[]; total: number }>;
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!genForm.periodStart || !genForm.periodEnd) throw new Error("Periode wajib diisi");
      const res = await fetch("/api/logistics/fleet/accounting/journals/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(genForm),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error ?? "Gagal generate jurnal"));
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Jurnal akuntansi berhasil di-generate");
      setShowGenForm(false);
      qc.invalidateQueries({ queryKey: ["fleet-accounting-journals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/logistics/fleet/accounting/journals/${id}/approve`, {
        method: "PUT",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error ?? "Gagal approve"));
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Jurnal disetujui");
      qc.invalidateQueries({ queryKey: ["fleet-accounting-journals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const postMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/logistics/fleet/accounting/journals/${id}/post`, {
        method: "PUT",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(err.error ?? "Gagal posting"));
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Jurnal berhasil diposting ke buku besar");
      qc.invalidateQueries({ queryKey: ["fleet-accounting-journals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const journals = data?.journals ?? [];
  const draftCount = journals.filter((j) => j.status === "draft").length;
  const approvedCount = journals.filter((j) => j.status === "approved").length;
  const postedCount = journals.filter((j) => j.status === "posted").length;

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Accounting — Fleet Intelligence</h1>
            <p className="text-slate-400 text-sm mt-1">Jurnal akuntansi otomatis dari data transaksi fleet Gojek</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-slate-400">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-700 gap-2"
              onClick={() => setShowGenForm((v) => !v)}
            >
              <PlusCircle className="w-4 h-4" />
              Generate Jurnal
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Draft", count: draftCount, cls: "text-slate-300" },
            { label: "Disetujui", count: approvedCount, cls: "text-blue-400" },
            { label: "Diposting", count: postedCount, cls: "text-emerald-400" },
          ].map((s) => (
            <Card key={s.label} className="bg-slate-800/60 border-slate-700">
              <CardContent className="p-4 text-center">
                <div className={`text-3xl font-bold ${s.cls}`}>{s.count}</div>
                <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Generate form */}
        {showGenForm && (
          <Card className="bg-slate-800/60 border-indigo-700/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-400" />
                Generate Jurnal Otomatis dari Transaksi Fleet
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-slate-400 text-sm">
                Sistem akan mengagregasi semua transaksi di periode yang dipilih dan membuat jurnal akuntansi (Debit AR/Bank, Kredit Revenue, PPN Keluaran, dll).
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Periode Mulai *</Label>
                  <DatePicker value={genForm.periodStart} onChange={(v) => setGenForm((f) => ({ ...f, periodStart: v }))} className="bg-slate-700 border-slate-600 text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Periode Akhir *</Label>
                  <DatePicker value={genForm.periodEnd} onChange={(v) => setGenForm((f) => ({ ...f, periodEnd: v }))} className="bg-slate-700 border-slate-600 text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">PPN Rate (%)</Label>
                  <Input
                    type="number"
                    value={genForm.ppnRate}
                    min="0"
                    max="20"
                    step="0.5"
                    onChange={(e) => setGenForm((f) => ({ ...f, ppnRate: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Catatan</Label>
                  <Input
                    placeholder="Opsional..."
                    value={genForm.notes}
                    onChange={(e) => setGenForm((f) => ({ ...f, notes: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700 gap-2"
                  disabled={generateMutation.isPending || !genForm.periodStart || !genForm.periodEnd}
                  onClick={() => generateMutation.mutate()}
                >
                  {generateMutation.isPending ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Memproses...</>
                  ) : (
                    <><BookOpen className="w-4 h-4" /> Generate Jurnal</>
                  )}
                </Button>
                <Button variant="ghost" onClick={() => setShowGenForm(false)} className="text-slate-400">
                  Batal
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-slate-400 text-sm">Filter:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-slate-700 border-slate-600 text-white w-36 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="approved">Disetujui</SelectItem>
              <SelectItem value="posted">Diposting</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-slate-500 text-sm">{data?.total ?? 0} jurnal</span>
        </div>

        {/* Journals list */}
        <div className="space-y-3">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 bg-slate-800/60 border border-slate-700 rounded-xl animate-pulse" />
              ))
            : journals.length === 0
              ? (
                <div className="text-center py-16">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 text-slate-600" />
                  <p className="text-slate-400">Belum ada jurnal akuntansi fleet</p>
                  <p className="text-slate-600 text-sm mt-1">Klik "Generate Jurnal" untuk membuat jurnal dari transaksi fleet</p>
                </div>
              )
              : journals.map((j) => {
                  const expanded = expandedId === j.id;
                  const st = STATUS_LABELS[j.status] ?? { label: j.status, cls: "bg-slate-500/20 text-slate-300 border-slate-600" };
                  return (
                    <Card key={j.id} className="bg-slate-800/60 border-slate-700">
                      <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-700/20 rounded-t-xl gap-3"
                        onClick={() => setExpandedId(expanded ? null : j.id)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <BookOpen className="w-5 h-5 text-slate-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-white font-medium text-sm">{j.reference_no ?? `JNL-${j.id}`}</p>
                              <Badge className={`text-xs border ${st.cls}`}>{st.label}</Badge>
                            </div>
                            <p className="text-slate-400 text-xs mt-0.5">
                              {fmtDate(j.journal_date)} · Periode {j.period_start ? `${j.period_start} s/d ${j.period_end}` : "—"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0">
                          <div className="text-right hidden sm:block">
                            <p className="text-emerald-400 font-semibold text-sm">{fmtIdr(j.gross_revenue)}</p>
                            <p className="text-slate-500 text-xs">Gross Revenue</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {j.status === "draft" && (
                              <Button
                                size="sm"
                                className="h-8 bg-blue-600 hover:bg-blue-700 gap-1.5 text-xs"
                                onClick={(e) => { e.stopPropagation(); approveMutation.mutate(j.id); }}
                                disabled={approveMutation.isPending}
                              >
                                <CheckCircle className="w-3.5 h-3.5" /> Approve
                              </Button>
                            )}
                            {j.status === "approved" && (
                              <Button
                                size="sm"
                                className="h-8 bg-emerald-600 hover:bg-emerald-700 gap-1.5 text-xs"
                                onClick={(e) => { e.stopPropagation(); postMutation.mutate(j.id); }}
                                disabled={postMutation.isPending}
                              >
                                <Send className="w-3.5 h-3.5" /> Post
                              </Button>
                            )}
                          </div>
                          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </div>
                      </div>

                      {expanded && (
                        <div className="px-4 pb-4 border-t border-slate-700/50 pt-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                            {[
                              { label: "Gross Revenue", value: fmtIdr(j.gross_revenue), cls: "text-white" },
                              { label: "Net Revenue", value: fmtIdr(j.net_revenue), cls: "text-emerald-400" },
                              { label: `PPN ${j.ppn_rate}%`, value: fmtIdr(j.ppn_amount), cls: "text-yellow-400" },
                              { label: "Driver Payout", value: fmtIdr(j.driver_payout), cls: "text-blue-400" },
                              { label: "Outstanding (AR)", value: fmtIdr(j.outstanding_amount), cls: "text-amber-400" },
                              { label: "Total Komisi", value: fmtIdr(j.commission_total), cls: "text-slate-300" },
                              { label: "Total Insentif", value: fmtIdr(j.incentive_total), cls: "text-slate-300" },
                            ].map((item) => (
                              <div key={item.label}>
                                <p className={`text-sm font-semibold ${item.cls}`}>{item.value}</p>
                                <p className="text-xs text-slate-400">{item.label}</p>
                              </div>
                            ))}
                          </div>

                          {/* Accounting entries table */}
                          <div className="bg-slate-900/40 rounded-lg p-3 text-xs font-mono space-y-1">
                            <p className="text-slate-400 font-sans font-medium mb-2">Entri Jurnal (Preview)</p>
                            <div className="grid grid-cols-3 gap-2 text-slate-500 border-b border-slate-700 pb-1 mb-1">
                              <span>Akun</span><span className="text-right">Debit</span><span className="text-right">Kredit</span>
                            </div>
                            {[
                              { account: "Kas / Accounts Receivable", debit: fmtIdr(j.gross_revenue), credit: "" },
                              { account: `  ↳ ${j.outstanding_amount && Number(j.outstanding_amount) > 0 ? "AR" : "Kas/Bank"} (${j.outstanding_amount && Number(j.outstanding_amount) > 0 ? "Outstanding" : "Langsung"})`, debit: "", credit: "" },
                              { account: "Fleet Revenue", debit: "", credit: fmtIdr(j.net_revenue) },
                              { account: `PPN Keluaran (${j.ppn_rate}%)`, debit: "", credit: fmtIdr(j.ppn_amount) },
                              { account: "Driver Payout / Cost of Service", debit: fmtIdr(j.driver_payout), credit: "" },
                            ].map((e, i) => (
                              <div key={i} className="grid grid-cols-3 gap-2">
                                <span className="text-slate-300">{e.account}</span>
                                <span className="text-right text-emerald-400">{e.debit}</span>
                                <span className="text-right text-red-400">{e.credit}</span>
                              </div>
                            ))}
                          </div>

                          {/* Audit info */}
                          <div className="mt-3 text-xs text-slate-500 space-y-0.5">
                            {j.created_by && <p>Dibuat oleh: <span className="text-slate-400">{j.created_by}</span></p>}
                            {j.approved_by && <p>Disetujui oleh: <span className="text-slate-400">{j.approved_by}</span> · {fmtDate(j.approved_at)}</p>}
                            {j.posted_by && <p>Diposting oleh: <span className="text-slate-400">{j.posted_by}</span> · {fmtDate(j.posted_at)}</p>}
                            {j.notes && <p>Catatan: <span className="text-slate-400">{j.notes}</span></p>}
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
        </div>
      </div>
    </AppShell>
  );
}
