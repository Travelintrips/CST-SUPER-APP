import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/contexts/CompanyContext";
import { Upload, RefreshCw, FileText, CheckCircle2, XCircle, Clock, ExternalLink } from "lucide-react";

const API = "/api";

const STATUS_CFG: Record<string, { label: string; color: string; icon: any }> = {
  completed: { label: "Selesai",    color: "text-green-400", icon: CheckCircle2 },
  success:   { label: "Selesai",    color: "text-green-400", icon: CheckCircle2 },
  failed:    { label: "Gagal",      color: "text-red-400",   icon: XCircle },
  pending:   { label: "Menunggu",   color: "text-yellow-400",icon: Clock },
  processing:{ label: "Proses...",  color: "text-blue-400",  icon: RefreshCw },
};

export default function CashBankImports() {
  const { activeCompanyId } = useCompany();
  const [imports, setImports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const r = await fetch(`${API}/cash-bank/imports?companyId=${activeCompanyId}`, { credentials: "include" })
      .then(d => d.json()).catch(() => ({ data: [] }));
    setImports(r.data ?? []);
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Import Bank Statement</h1>
          <p className="text-sm text-slate-400 mt-0.5">Riwayat impor mutasi rekening koran</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw size={14} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button asChild className="bg-orange-500 hover:bg-orange-600 text-white">
            <a href="/bizportal/bank-mutation-import" target="_blank" rel="noopener noreferrer">
              <Upload size={14} className="mr-1.5" /> Import Baru
              <ExternalLink size={12} className="ml-1.5" />
            </a>
          </Button>
        </div>
      </div>

      <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", color: "#93C5FD" }}>
        Import bank statement menggunakan modul impor yang sudah ada. Klik "Import Baru" untuk membuka halaman impor lengkap dengan parser CSV/XLSX.
      </div>

      <div className="space-y-3">
        {imports.map((imp: any) => {
          const cfg = STATUS_CFG[imp.status] ?? { label: imp.status, color: "text-slate-400", icon: FileText };
          const Icon = cfg.icon;
          return (
            <Card key={imp.id} style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(249,115,22,0.1)" }}>
                      <FileText size={16} className="text-orange-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{imp.label ?? imp.source ?? `Batch #${imp.id}`}</span>
                        <div className={`flex items-center gap-1 text-xs ${cfg.color}`}>
                          <Icon size={11} /> {cfg.label}
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {imp.created_at ? new Date(imp.created_at).toLocaleString("id-ID") : "—"}
                        {imp.imported_by ? ` • oleh ${imp.imported_by}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      {[
                        { label: "Total", value: imp.row_count ?? imp.row_count_actual ?? "—", color: "text-slate-300" },
                        { label: "OK", value: imp.success_rows ?? "—", color: "text-green-400" },
                        { label: "Gagal", value: imp.failed_rows ?? "—", color: "text-red-400" },
                      ].map(s => (
                        <div key={s.label} className="text-center">
                          <p className={`text-base font-black ${s.color}`}>{s.value}</p>
                          <p className="text-[10px] text-slate-500">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!loading && !imports.length && (
          <div className="text-center py-12 text-slate-500">
            <Upload size={32} className="mx-auto mb-3 text-slate-700" />
            <p>Belum ada impor. Klik "Import Baru" untuk mengunggah bank statement.</p>
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center py-10">
            <RefreshCw className="animate-spin text-orange-400" size={22} />
          </div>
        )}
      </div>
    </div>
  );
}
