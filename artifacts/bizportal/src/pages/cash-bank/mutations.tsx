import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { ArrowLeft, RefreshCw, ArrowDownLeft, ArrowUpRight, List } from "lucide-react";

const API = "/api";
function fmt(n: number | string) { return new Intl.NumberFormat("id-ID").format(Number(n) || 0); }

export default function CashBankMutations() {
  const { activeCompanyId } = useCompany();
  const [mutations, setMutations] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const params = new URLSearchParams({ companyId: String(activeCompanyId), limit: "100" });
    if (accountId !== "all") params.append("account_id", accountId);
    if (from) params.append("from", from);
    if (to) params.append("to", to);

    const [mutR, accR] = await Promise.all([
      fetch(`${API}/cash-bank/mutations?${params}`, { credentials: "include" }).then(r => r.json()),
      fetch(`${API}/cash-bank/accounts?companyId=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
    ]);
    setMutations(mutR.data ?? []);
    setTotal(mutR.total ?? 0);
    setAccounts(accR.data ?? []);
    setLoading(false);
  }, [activeCompanyId, accountId, from, to]);

  useEffect(() => { load(); }, [load]);

  const totalDebit = mutations.reduce((s, m) => s + parseFloat(m.debit || "0"), 0);
  const totalCredit = mutations.reduce((s, m) => s + parseFloat(m.credit || "0"), 0);

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
            <h1 className="text-2xl font-black text-white">Mutasi Kas & Bank</h1>
            <p className="text-sm text-slate-400 mt-0.5">Riwayat seluruh transaksi per rekening</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw size={14} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-52 bg-slate-800 border-slate-700 text-white"><SelectValue placeholder="Semua Rekening" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Rekening</SelectItem>
            {accounts.map((a: any) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <DatePicker value={from} onChange={(v) => setFrom(v)} className="w-36 bg-slate-800 border-slate-700 text-white" placeholder="Dari" />
        <DatePicker value={to} onChange={(v) => setTo(v)} className="w-36 bg-slate-800 border-slate-700 text-white" placeholder="Sampai" />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Debit (Masuk)", value: totalDebit, color: "text-green-400" },
          { label: "Total Kredit (Keluar)", value: totalCredit, color: "text-red-400" },
          { label: "Net Cash Flow", value: totalDebit - totalCredit, color: (totalDebit - totalCredit) >= 0 ? "text-blue-400" : "text-red-400" },
        ].map(item => (
          <Card key={item.label} style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
            <CardContent className="p-3">
              <p className="text-[10px] text-slate-500 uppercase">{item.label}</p>
              <p className={`text-lg font-black ${item.color}`}>Rp {fmt(item.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "#0F172A" }}>
                {["Tanggal", "No. Jurnal", "Keterangan", "Rekening", "Debit", "Kredit", "Saldo Berjalan"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-slate-400 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mutations.map((m, i) => (
                <tr key={m.line_id} style={{ background: i % 2 === 0 ? "rgba(30,41,59,0.5)" : "rgba(15,23,42,0.5)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{m.entry_date}</td>
                  <td className="px-3 py-2 font-mono text-slate-300 whitespace-nowrap">{m.entry_number}</td>
                  <td className="px-3 py-2 text-slate-300 max-w-xs truncate">{m.line_desc || m.entry_desc}</td>
                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{m.bank_account_name}</td>
                  <td className="px-3 py-2 text-green-400 font-mono text-right whitespace-nowrap">
                    {parseFloat(m.debit || "0") > 0 ? `Rp ${fmt(m.debit)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-red-400 font-mono text-right whitespace-nowrap">
                    {parseFloat(m.credit || "0") > 0 ? `Rp ${fmt(m.credit)}` : "—"}
                  </td>
                  <td className={`px-3 py-2 font-mono font-bold text-right whitespace-nowrap ${parseFloat(m.running_balance || "0") >= 0 ? "text-blue-300" : "text-red-400"}`}>
                    Rp {fmt(m.running_balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !mutations.length && (
          <div className="text-center py-12 text-slate-500">
            <List size={28} className="mx-auto mb-3 text-slate-700" />
            <p>Belum ada mutasi. Pilih rekening dan rentang tanggal.</p>
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center py-10">
            <RefreshCw className="animate-spin text-orange-400" size={22} />
          </div>
        )}
      </div>
      {total > 0 && (
        <p className="text-xs text-slate-500 text-right">Menampilkan {mutations.length} dari {total} transaksi</p>
      )}
    </div>
  );
}
