import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { RefreshCw, TrendingUp, ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";

const API = "/api";
function fmt(n: number | string) { return new Intl.NumberFormat("id-ID").format(Number(n) || 0); }

export default function CashBankForecast() {
  const { activeCompanyId } = useCompany();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [horizon, setHorizon] = useState("30");

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const r = await fetch(`${API}/cash-bank/forecast?companyId=${activeCompanyId}&horizon=${horizon}`, { credentials: "include" })
      .then(d => d.json()).catch(() => ({ data: null }));
    setData(r.data);
    setLoading(false);
  }, [activeCompanyId, horizon]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!activeCompanyId) return;
    setGenerating(true);
    await fetch(`${API}/cash-bank/forecast/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ companyId: activeCompanyId, horizon_days: parseInt(horizon) }),
    });
    setGenerating(false);
    await load();
  };

  const breakdown = data?.source_breakdown ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Cash Flow Forecast</h1>
          <p className="text-sm text-slate-400 mt-0.5">Proyeksi arus kas berdasarkan AR, AP, dan data historis</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={horizon} onValueChange={setHorizon}>
            <SelectTrigger className="w-32 bg-slate-800 border-slate-700 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 Hari</SelectItem>
              <SelectItem value="30">30 Hari</SelectItem>
              <SelectItem value="90">90 Hari</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={generate} disabled={generating} className="bg-orange-500 hover:bg-orange-600 text-white">
            {generating ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : <TrendingUp size={14} className="mr-1.5" />}
            {generating ? "Generating..." : "Generate Forecast"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="animate-spin text-orange-400" size={28} />
        </div>
      ) : !data ? (
        <div className="text-center py-20">
          <TrendingUp size={40} className="mx-auto mb-4 text-slate-700" />
          <p className="text-slate-400 text-lg font-semibold">Belum ada snapshot forecast</p>
          <p className="text-slate-500 text-sm mt-1">Klik "Generate Forecast" untuk membuat proyeksi {horizon} hari</p>
          <Button onClick={generate} disabled={generating} className="mt-4 bg-orange-500 hover:bg-orange-600 text-white">
            {generating ? "Generating..." : `Generate Forecast ${horizon} Hari`}
          </Button>
        </div>
      ) : (
        <>
          {/* Generated Info */}
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <RefreshCw size={10} />
            Terakhir diperbarui: {data.generated_at ? new Date(data.generated_at).toLocaleString("id-ID") : "—"}
            <span className="text-slate-700">•</span>
            Horizon: {data.horizon_days} hari
          </div>

          {/* Main Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Saldo Awal", value: data.opening_balance, icon: Landmark, color: "text-slate-300", bg: "rgba(100,116,139,0.1)", border: "rgba(100,116,139,0.2)" },
              { label: `Expected Inflow (${horizon}h)`, value: data.expected_inflow, icon: ArrowDownLeft, color: "text-green-400", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.2)" },
              { label: `Expected Outflow (${horizon}h)`, value: data.expected_outflow, icon: ArrowUpRight, color: "text-red-400", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)" },
              { label: "Proyeksi Saldo Penutup", value: data.closing_balance, icon: TrendingUp, color: parseFloat(data.closing_balance) >= 0 ? "text-blue-400" : "text-red-400", bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.2)" },
            ].map(item => (
              <Card key={item.label} style={{ background: item.bg, border: `1px solid ${item.border}` }}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <item.icon size={13} className={item.color} />
                    <p className="text-[11px] text-slate-400">{item.label}</p>
                  </div>
                  <p className={`text-xl font-black ${item.color}`}>Rp {fmt(item.value)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Net Cash Flow */}
          <Card style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-slate-300 uppercase tracking-widest">Breakdown Sumber Forecast</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl p-4" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)" }}>
                  <p className="text-xs text-green-400 font-semibold uppercase mb-1">AR (Piutang)</p>
                  <p className="text-2xl font-black text-green-400">Rp {fmt(breakdown.ar ?? 0)}</p>
                  <p className="text-xs text-slate-500 mt-1">Expected inflow dari invoice & SO</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}>
                  <p className="text-xs text-red-400 font-semibold uppercase mb-1">AP (Hutang)</p>
                  <p className="text-2xl font-black text-red-400">Rp {fmt(breakdown.ap ?? 0)}</p>
                  <p className="text-xs text-slate-500 mt-1">Expected outflow dari PO & vendor</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)" }}>
                  <p className="text-xs text-blue-400 font-semibold uppercase mb-1">Net Cash Flow</p>
                  <p className={`text-2xl font-black ${parseFloat(breakdown.net ?? "0") >= 0 ? "text-blue-400" : "text-red-400"}`}>
                    Rp {fmt(breakdown.net ?? 0)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">AR − AP = net proyeksi</p>
                </div>
              </div>

              {data.notes && (
                <div className="mt-4 p-3 rounded-xl text-xs text-slate-400" style={{ background: "rgba(255,255,255,0.04)" }}>
                  {data.notes}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
