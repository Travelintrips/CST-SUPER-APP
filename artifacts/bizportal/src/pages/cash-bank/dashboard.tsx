import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Landmark, Wallet, TrendingUp, TrendingDown, ArrowLeftRight,
  RefreshCw, AlertCircle, BarChart2, ArrowUpRight, ArrowDownLeft,
} from "lucide-react";

const API = "/api";
function fmt(n: number | string) {
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(Number(n) || 0);
}

const TYPE_LABEL: Record<string, string> = {
  bank: "Bank", cash: "Kas", giro: "Giro", deposito: "Deposito",
  CASH: "Kas", BANK: "Bank", PETTY_CASH: "Kas Kecil",
  ESCROW: "Escrow", VIRTUAL_ACCOUNT: "VA",
};
const TYPE_COLOR: Record<string, string> = {
  bank: "bg-blue-500/20 text-blue-300", cash: "bg-green-500/20 text-green-300",
  giro: "bg-purple-500/20 text-purple-300", deposito: "bg-yellow-500/20 text-yellow-300",
  CASH: "bg-green-500/20 text-green-300", BANK: "bg-blue-500/20 text-blue-300",
  PETTY_CASH: "bg-orange-500/20 text-orange-300",
};

export default function CashBankDashboard() {
  const { activeCompanyId } = useCompany();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshed, setRefreshed] = useState(0);

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    fetch(`${API}/cash-bank/dashboard?companyId=${activeCompanyId}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activeCompanyId, refreshed]);

  const refresh = () => { setRefreshed(x => x + 1); };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="animate-spin text-orange-400" size={28} />
    </div>
  );

  const byType = data?.balance_by_type ?? {};
  const history = data?.balance_history ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Cash & Bank Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">Ringkasan posisi kas & bank perusahaan</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw size={14} className="mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Total Balance */}
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: "linear-gradient(135deg, #1E3A5F 0%, #0F2645 100%)", border: "1px solid rgba(59,130,246,0.3)" }}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-blue-300 font-medium uppercase tracking-widest">Total Saldo Kas & Bank</p>
            <p className="text-4xl font-black text-white mt-1">Rp {fmt(data?.total_balance ?? 0)}</p>
            <p className="text-xs text-blue-400 mt-1">{data?.accounts?.length ?? 0} rekening aktif</p>
          </div>
          <Landmark size={48} className="text-blue-500/30" />
        </div>
        {/* By type */}
        <div className="flex flex-wrap gap-3 mt-4">
          {Object.entries(byType).map(([type, bal]) => (
            <div key={type} className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(255,255,255,0.06)" }}>
              <span className="text-slate-400">{TYPE_LABEL[type] ?? type}: </span>
              <span className="text-white font-bold">Rp {fmt(bal as number)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Cash In Hari Ini", value: data?.cash_in_today ?? 0, icon: ArrowDownLeft, color: "text-green-400", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.2)" },
          { label: "Cash Out Hari Ini", value: data?.cash_out_today ?? 0, icon: ArrowUpRight, color: "text-red-400", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)" },
          { label: "Transfer Hari Ini", value: data?.transfer_amount_today ?? 0, icon: ArrowLeftRight, color: "text-blue-400", bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.2)" },
          { label: "Kas Kecil", value: data?.petty_cash_balance ?? 0, icon: Wallet, color: "text-orange-400", bg: "rgba(249,115,22,0.1)", border: "rgba(249,115,22,0.2)" },
        ].map((item) => (
          <Card key={item.label} style={{ background: item.bg, border: `1px solid ${item.border}` }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <item.icon size={14} className={item.color} />
                <p className="text-xs text-slate-400">{item.label}</p>
              </div>
              <p className={`text-lg font-black ${item.color}`}>Rp {fmt(item.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Rekening List + Pending Recon */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Accounts */}
        <div className="lg:col-span-2">
          <Card style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <Landmark size={14} /> Saldo Per Rekening
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-80 overflow-y-auto">
              {(data?.accounts ?? []).map((acc: any) => (
                <div key={acc.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(59,130,246,0.15)" }}>
                      <Landmark size={14} className="text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{acc.name}</p>
                      <p className="text-xs text-slate-500">{acc.bank_name ?? ""} {acc.account_number ? `• ${acc.account_number}` : ""}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className={`text-sm font-bold ${parseFloat(acc.balance) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      Rp {fmt(acc.balance)}
                    </p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${TYPE_COLOR[acc.account_type] ?? "bg-slate-700 text-slate-300"}`}>
                      {TYPE_LABEL[acc.account_type] ?? acc.account_type}
                    </span>
                  </div>
                </div>
              ))}
              {!(data?.accounts?.length) && (
                <p className="text-sm text-slate-500 text-center py-6">Belum ada rekening. Tambahkan di menu Accounts.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Info Panel */}
        <div className="space-y-4">
          <Card style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-yellow-400" />
                <p className="text-xs font-bold text-slate-300">Pending Rekonsiliasi</p>
              </div>
              <p className="text-3xl font-black text-yellow-400">{data?.pending_reconciliation ?? 0}</p>
              <p className="text-xs text-slate-500">mutasi belum direkonsiliasi</p>
            </CardContent>
          </Card>

          <Card style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <BarChart2 size={14} className="text-purple-400" />
                <p className="text-xs font-bold text-slate-300">Transfer Hari Ini</p>
              </div>
              <p className="text-3xl font-black text-purple-400">{data?.transfer_count_today ?? 0}</p>
              <p className="text-xs text-slate-500">transaksi selesai</p>
            </CardContent>
          </Card>

          {history.length > 0 && (
            <Card style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold text-slate-400 uppercase">Riwayat 7 Hari</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {history.slice(-7).map((h: any) => (
                  <div key={h.snapshot_date} className="flex justify-between text-xs">
                    <span className="text-slate-500">{h.snapshot_date}</span>
                    <span className="text-white font-mono">Rp {fmt(h.total_balance)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
