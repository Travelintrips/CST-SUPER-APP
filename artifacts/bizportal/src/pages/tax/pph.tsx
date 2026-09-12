import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, RefreshCw, ChevronDown, ChevronUp, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { BackButton } from "@/components/ui/back-button";

function formatRp(n: number) { return "Rp " + Math.abs(Math.round(n)).toLocaleString("id-ID"); }
function generatePeriods() {
  const p: string[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    p.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return p;
}
const PERIODS = ["all", ...generatePeriods()];

interface PphGroup {
  taxName: string;
  total: number;
  count: number;
  rows: {
    period: string;
    transaction_ref: string | null;
    partner_name: string | null;
    npwp: string | null;
    base_amount: string;
    tax_amount: string;
    tax_rate: string;
    status: string;
  }[];
}

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-orange-100 text-orange-700",
  paid: "bg-emerald-100 text-emerald-700",
  reported: "bg-blue-100 text-blue-700",
};

function PphGroupCard({ group }: { group: PphGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 bg-muted/50 hover:bg-muted/80 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">{group.taxName}</span>
          <span className="text-xs text-muted-foreground">{group.count} transaksi</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm">{formatRp(group.total)}</span>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Periode</th>
                <th className="px-4 py-2 text-left">Referensi</th>
                <th className="px-4 py-2 text-left">Partner / NPWP</th>
                <th className="px-4 py-2 text-right">DPP</th>
                <th className="px-4 py-2 text-right">PPh</th>
                <th className="px-4 py-2 text-right">Tarif</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {group.rows.map((r, i) => (
                <tr key={i} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.period}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.transaction_ref ?? "-"}</td>
                  <td className="px-4 py-2 text-xs">
                    <div>{r.partner_name ?? <span className="text-muted-foreground/50">-</span>}</div>
                    {r.npwp && <div className="font-mono text-[10px] text-muted-foreground">{r.npwp}</div>}
                  </td>
                  <td className="px-4 py-2 text-right text-xs">{formatRp(Number(r.base_amount))}</td>
                  <td className="px-4 py-2 text-right font-semibold">{formatRp(Number(r.tax_amount))}</td>
                  <td className="px-4 py-2 text-right text-xs">{Number(r.tax_rate).toFixed(1)}%</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status] ?? "bg-muted text-muted-foreground"}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function TaxPphPage() {
  const { selectedCompanyId } = useCompany();
  const [period, setPeriod] = useState(generatePeriods()[0]);

  const params = new URLSearchParams({ period });
  if (selectedCompanyId) params.set("companyId", String(selectedCompanyId));

  const { data, isLoading, isFetching, refetch } = useQuery<{ groups: PphGroup[] }>({
    queryKey: ["tax-pph", selectedCompanyId, period],
    queryFn: () => fetch(`/api/tax/pph?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const groups = data?.groups ?? [];
  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  return (
    <AppShell>
      <BackButton href="/finance/workspace/tax-center" />
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">PPh Witholding</h1>
            <p className="text-sm text-muted-foreground">Ringkasan PPh 21 / 23 / 4(2) per periode</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p} value={p}>{p === "all" ? "Semua" : p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/tax/export?${params}&type=pph`, "_blank")}>
              <Download className="h-4 w-4 mr-1.5" />Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {grandTotal > 0 && (
          <Card className="bg-amber-50/60 border-amber-200">
            <CardContent className="p-4 flex items-center justify-between">
              <span className="text-sm font-medium text-amber-800">Total PPh Yang Harus Disetor ({period})</span>
              <span className="text-2xl font-bold text-amber-900">{formatRp(grandTotal)}</span>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p>Tidak ada PPh untuk periode ini</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => <PphGroupCard key={group.taxName} group={group} />)}
          </div>
        )}
      </div>
    </AppShell>
  );
}
