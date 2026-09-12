import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useGetTrialBalance, getGetTrialBalanceQueryKey } from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";
import { FileSpreadsheet, Printer, Download, CalendarDays, ChevronRight, Scale, CheckCircle2, AlertCircle } from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";
import { Link } from "wouter";
import { BackButton } from "@/components/ui/back-button";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

export default function TrialBalancePage() {
  const { activeCompanyId, isConsolidated, activeCompany } = useCompany();
  const [from, setFrom] = useState(() => new URLSearchParams(window.location.search).get("startDate") ?? "");
  const [to, setTo] = useState(() => new URLSearchParams(window.location.search).get("endDate") ?? "");
  const params = useMemo(() => ({
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to + "T23:59:59").toISOString() } : {}),
    company: (isConsolidated ? "all" : activeCompanyId) as unknown as number,
  }), [from, to, activeCompanyId, isConsolidated]);
  const { data, isLoading } = useGetTrialBalance(params, { query: { queryKey: getGetTrialBalanceQueryKey(params) } });

  const rows = data?.rows ?? [];
  const headers = ["Perusahaan", "Kode", "Nama Akun", "Tipe", "Debit", "Kredit", "Saldo"];
  const xlsxRows = () => rows.map((r) => [r.companyCode ?? "GLOBAL", r.code, r.name, r.type, r.debit > 0 ? r.debit : "", r.credit > 0 ? r.credit : "", r.balance]);

  return (
    <AppShell>
      <BackButton href="/finance/workspace/financial-reports" />
      <div className="space-y-6 p-6">

        <PageHeader
          onBack={() => window.history.back()}
          title="Neraca Saldo (Trial Balance)"
          description="Saldo seluruh akun pada periode terpilih"
          breadcrumb={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Finance", href: "/finance" },
            { label: "Laporan Keuangan", href: "/finance/workspace/financial-statements" },
            { label: "Neraca Saldo" },
          ]}
          favoriteEnabled
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => printWindow("Neraca Saldo (Trial Balance)", headers, xlsxRows(), [4, 5, 6])} disabled={rows.length === 0}>
                <Printer className="h-4 w-4 mr-1.5" />Print Preview
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportXlsx("Neraca_Saldo", headers, xlsxRows())} disabled={rows.length === 0}>
                <Download className="h-4 w-4 mr-1.5" />Export XLSX
              </Button>
            </div>
          }
        />

        <Card><CardContent className="p-4 flex flex-wrap gap-4">
          <div className="flex-1 min-w-[140px]"><Label>Dari</Label><DatePicker value={from} onChange={setFrom} data-testid="input-from" /></div>
          <div className="flex-1 min-w-[140px]"><Label>Sampai</Label><DatePicker value={to} onChange={setTo} data-testid="input-to" /></div>
        </CardContent></Card>

        {/* ── Filter Summary ── */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 flex-wrap">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span><span className="font-medium text-foreground">Periode:</span> {from || to ? `${from || "—"} s/d ${to || "—"}` : "Semua Periode"}</span>
          {!isConsolidated && activeCompany && (
            <><span className="text-muted-foreground/40">·</span><span><span className="font-medium text-foreground">Perusahaan:</span> {activeCompany.companyName}</span></>
          )}
        </div>

        {/* ── KPI Cards ── */}
        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(() => {
              const diff = data.totalDebit - data.totalCredit;
              const balanced = Math.abs(diff) < 1;
              return (
                <>
                  <div className="rounded-xl border border-blue-800/50 bg-blue-950/40 p-4">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">Total Debit</p>
                    <p className="text-xl font-bold font-mono text-blue-300">{idr(data.totalDebit)}</p>
                    <p className="text-[11px] text-slate-500 mt-1">{rows.length} akun</p>
                  </div>
                  <div className="rounded-xl border border-orange-800/50 bg-orange-950/40 p-4">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">Total Kredit</p>
                    <p className="text-xl font-bold font-mono text-orange-300">{idr(data.totalCredit)}</p>
                    <p className="text-[11px] text-slate-500 mt-1">{rows.length} akun</p>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">Selisih</p>
                    <p className={`text-xl font-bold font-mono ${balanced ? "text-emerald-400" : "text-rose-400"}`}>{idr(Math.abs(diff))}</p>
                    <p className="text-[11px] text-slate-500 mt-1">{balanced ? "Seimbang" : "Ada selisih"}</p>
                  </div>
                  <div className={`rounded-xl border p-4 ${balanced ? "border-emerald-800/50 bg-emerald-950/40" : "border-rose-800/50 bg-rose-950/40"}`}>
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">Status Balance</p>
                    <div className="flex items-center gap-1.5 mt-2">
                      {balanced
                        ? <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                        : <AlertCircle className="h-6 w-6 text-rose-400" />
                      }
                      <span className={`text-base font-bold ${balanced ? "text-emerald-400" : "text-rose-400"}`}>
                        {balanced ? "Balanced" : "Not Balanced"}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        <Card><CardContent className="p-4">
          {isLoading ? <div>Memuat...</div> : !data || data.rows.length === 0 ? <div className="text-center text-muted-foreground py-8">Tidak ada data</div> : (
            <Table>
              <TableHeader><TableRow><TableHead>Perusahaan</TableHead><TableHead>Kode</TableHead><TableHead>Nama Akun</TableHead><TableHead>Tipe</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Kredit</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.accountId} data-testid={`row-tb-${r.accountId}`}>
                    <TableCell><Badge variant="outline" className="font-mono text-[10px]">{r.companyCode ?? "GLOBAL"}</Badge></TableCell>
                    <TableCell className="font-mono">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-xs uppercase text-muted-foreground">{r.type}</TableCell>
                    <TableCell className="text-right font-mono">{r.debit > 0 ? idr(r.debit) : ""}</TableCell>
                    <TableCell className="text-right font-mono">{r.credit > 0 ? idr(r.credit) : ""}</TableCell>
                    <TableCell className="text-right font-mono font-medium">{idr(r.balance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold border-t-2 bg-muted/30">
                  <TableCell colSpan={4}>Total</TableCell>
                  <TableCell className="text-right font-mono">{idr(data.totalDebit)}</TableCell>
                  <TableCell className="text-right font-mono">{idr(data.totalCredit)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>
    </AppShell>
  );
}
