import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { RefreshCw, GitMerge, CheckCircle2, AlertCircle, ExternalLink, ArrowLeft } from "lucide-react";

const API = "/api";
function fmt(n: number | string) { return new Intl.NumberFormat("id-ID").format(Number(n) || 0); }

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  matched:   { label: "Matched",    color: "bg-green-500/20 text-green-300" },
  unmatched: { label: "Unmatched",  color: "bg-yellow-500/20 text-yellow-300" },
  pending:   { label: "Pending",    color: "bg-blue-500/20 text-blue-300" },
  ignored:   { label: "Ignored",    color: "bg-slate-700 text-slate-400" },
  partial:   { label: "Partial",    color: "bg-orange-500/20 text-orange-300" },
};

export default function CashBankReconciliation() {
  const { activeCompanyId } = useCompany();
  const [mutations, setMutations] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const params = new URLSearchParams({ companyId: String(activeCompanyId), limit: "100" });
    if (statusFilter !== "all") params.append("status", statusFilter);
    if (from) params.append("from", from);
    if (to) params.append("to", to);

    const r = await fetch(`${API}/cash-bank/reconciliation?${params}`, { credentials: "include" })
      .then(d => d.json()).catch(() => ({ data: [], stats: {}, total: 0 }));
    setMutations(r.data ?? []);
    setStats(r.stats ?? {});
    setTotal(r.total ?? 0);
    setLoading(false);
  }, [activeCompanyId, statusFilter, from, to]);

  useEffect(() => { load(); }, [load]);

  const matchedCount = parseInt(stats.matched_count || "0");
  const unmatchedCount = parseInt(stats.unmatched_count || "0");
  const totalCount = parseInt(stats.total_count || "0");
  const matchPct = totalCount > 0 ? Math.round((matchedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            aria-label="Kembali"
            className="rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-black text-white">Rekonsiliasi Bank</h1>
            <p className="text-sm text-slate-400 mt-0.5">Cocokkan mutasi bank dengan transaksi ERP</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw size={14} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button asChild className="bg-orange-500 hover:bg-orange-600 text-white">
            <a href="/bizportal/accounting/reconciliation" target="_blank" rel="noopener noreferrer">
              <GitMerge size={14} className="mr-1.5" /> Buka Engine Rekonsiliasi
              <ExternalLink size={12} className="ml-1.5" />
            </a>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Mutasi", value: totalCount, color: "text-slate-300" },
          { label: "Matched", value: matchedCount, color: "text-green-400" },
          { label: "Unmatched", value: unmatchedCount, color: "text-yellow-400" },
          { label: "Match Rate", value: `${matchPct}%`, color: matchPct > 80 ? "text-green-400" : matchPct > 50 ? "text-yellow-400" : "text-red-400" },
        ].map(item => (
          <Card key={item.label} style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
            <CardContent className="p-3">
              <p className="text-[10px] text-slate-500 uppercase">{item.label}</p>
              <p className={`text-xl font-black ${item.color}`}>{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <DatePicker value={from} onChange={(v) => setFrom(v)} className="w-36 bg-slate-800 border-slate-700 text-white" />
        <DatePicker value={to} onChange={(v) => setTo(v)} className="w-36 bg-slate-800 border-slate-700 text-white" />
      </div>

      {/* Mutations Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "#0F172A" }}>
                {["Tanggal", "Keterangan", "Bank", "Debit", "Kredit", "Status", "Ref"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-slate-400 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mutations.map((m, i) => {
                const cfg = STATUS_CFG[m.status] ?? { label: m.status, color: "bg-slate-700 text-slate-400" };
                return (
                  <tr key={m.id} style={{ background: i % 2 === 0 ? "rgba(30,41,59,0.5)" : "rgba(15,23,42,0.5)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{m.transaction_date}</td>
                    <td className="px-3 py-2 text-slate-300 max-w-xs truncate">{m.description}</td>
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{m.account_name ?? m.source_account ?? "—"}</td>
                    <td className="px-3 py-2 text-green-400 font-mono text-right whitespace-nowrap">
                      {parseFloat(m.credit_amount || m.debit || "0") > 0 && m.direction === "IN" ? `Rp ${fmt(m.credit_amount || m.debit)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-red-400 font-mono text-right whitespace-nowrap">
                      {parseFloat(m.debit_amount || m.credit || "0") > 0 && m.direction === "OUT" ? `Rp ${fmt(m.debit_amount || m.credit)}` : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">{m.reference_no ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && !mutations.length && (
          <div className="text-center py-12 text-slate-500">
            <GitMerge size={28} className="mx-auto mb-3 text-slate-700" />
            <p>Belum ada data mutasi untuk direkonsiliasi.</p>
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center py-10">
            <RefreshCw className="animate-spin text-orange-400" size={22} />
          </div>
        )}
      </div>
      {total > 0 && (
        <p className="text-xs text-slate-500 text-right">Menampilkan {mutations.length} dari {total} mutasi</p>
      )}
    </div>
  );
}
