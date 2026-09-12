import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetGeneralLedger, useListAccounts, getGetGeneralLedgerQueryKey } from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";
import { BookOpen, Printer, Download, CalendarDays, ChevronRight } from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";
import { Link } from "wouter";
import { BackButton } from "@/components/ui/back-button";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

export default function GeneralLedgerPage() {
  const { activeCompanyId, isConsolidated, activeCompany } = useCompany();
  const [from, setFrom] = useState(() => new URLSearchParams(window.location.search).get("startDate") ?? "");
  const [to, setTo] = useState(() => new URLSearchParams(window.location.search).get("endDate") ?? "");
  const [accountId, setAccountId] = useState<number | undefined>();
  const params = useMemo(() => ({
    ...(from ? { from: new Date(from).toISOString() } : {}),
    ...(to ? { to: new Date(to + "T23:59:59").toISOString() } : {}),
    ...(accountId ? { accountId } : {}),
    company: (isConsolidated ? "all" : activeCompanyId) as unknown as number,
  }), [from, to, accountId, activeCompanyId, isConsolidated]);
  const { data, isLoading } = useGetGeneralLedger(params, { query: { queryKey: getGetGeneralLedgerQueryKey(params) } });
  const { data: accounts } = useListAccounts();

  function buildExportRows() {
    if (!data) return [];
    const rows: (string | number | null | undefined)[][] = [];
    for (const acc of data.accounts) {
      rows.push([`${acc.code} - ${acc.name}`, "", "", "", "", "", ""]);
      for (const r of acc.rows) {
        rows.push([
          "", new Date(r.date).toLocaleDateString("id-ID"), r.entryNumber,
          r.ref ?? "", r.description ?? "",
          r.debit > 0 ? r.debit : "", r.credit > 0 ? r.credit : "", r.balance,
        ]);
      }
      rows.push(["Total", "", "", "", "", acc.totalDebit, acc.totalCredit, acc.endingBalance]);
    }
    return rows;
  }

  const headers = ["Akun / Tanggal", "Tanggal", "Nomor", "Ref", "Deskripsi", "Debit", "Kredit", "Saldo"];
  const hasData = (data?.accounts.length ?? 0) > 0;

  return (
    <AppShell>
      <BackButton href="/finance/workspace/financial-reports" />
      <div className="space-y-6 p-6">

        <PageHeader
          onBack={() => window.history.back()}
          title="Buku Besar (General Ledger)"
          description="Mutasi & saldo per akun"
          breadcrumb={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Finance", href: "/finance" },
            { label: "Laporan Keuangan", href: "/finance/workspace/financial-statements" },
            { label: "Buku Besar" },
          ]}
          favoriteEnabled
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => printWindow("Buku Besar (General Ledger)", headers, buildExportRows(), [5, 6, 7])} disabled={!hasData}>
                <Printer className="h-4 w-4 mr-1.5" />Print Preview
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportXlsx("Buku_Besar", headers, buildExportRows())} disabled={!hasData}>
                <Download className="h-4 w-4 mr-1.5" />Export XLSX
              </Button>
            </div>
          }
        />

        <Card><CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Akun</Label>
            <Select value={accountId ? String(accountId) : "all"} onValueChange={(v) => setAccountId(v === "all" ? undefined : parseInt(v))}>
              <SelectTrigger data-testid="select-gl-account"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Akun</SelectItem>
                {(accounts ?? []).map((a) => (<SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Dari</Label><DatePicker value={from} onChange={setFrom} data-testid="input-from" /></div>
          <div><Label>Sampai</Label><DatePicker value={to} onChange={setTo} data-testid="input-to" /></div>
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
        {data && data.accounts.length > 0 && (() => {
          const totalDebit = data.accounts.reduce((s, a) => s + a.totalDebit, 0);
          const totalCredit = data.accounts.reduce((s, a) => s + a.totalCredit, 0);
          const closingBalance = data.accounts.reduce((s, a) => s + a.endingBalance, 0);
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">Total Akun</p>
                <p className="text-2xl font-bold text-slate-200">{data.accounts.length}</p>
                <p className="text-[11px] text-slate-500 mt-1">akun ditampilkan</p>
              </div>
              <div className="rounded-xl border border-blue-800/50 bg-blue-950/40 p-4">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">Total Debit</p>
                <p className="text-xl font-bold font-mono text-blue-300">{idr(totalDebit)}</p>
              </div>
              <div className="rounded-xl border border-orange-800/50 bg-orange-950/40 p-4">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">Total Kredit</p>
                <p className="text-xl font-bold font-mono text-orange-300">{idr(totalCredit)}</p>
              </div>
              <div className={`rounded-xl border p-4 ${closingBalance >= 0 ? "border-emerald-800/50 bg-emerald-950/40" : "border-rose-800/50 bg-rose-950/40"}`}>
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1">Closing Balance</p>
                <p className={`text-xl font-bold font-mono ${closingBalance >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{idr(closingBalance)}</p>
              </div>
            </div>
          );
        })()}

        {isLoading ? <Card><CardContent className="p-4">Memuat...</CardContent></Card> : !data || data.accounts.length === 0 ? <Card><CardContent className="p-4 text-center text-muted-foreground">Tidak ada data</CardContent></Card> : data.accounts.map((acc) => (
          <Card key={acc.accountId}>
            <CardContent className="p-4">
              <div className="font-semibold mb-2">{acc.code} - {acc.name} <span className="text-xs text-muted-foreground uppercase">({acc.type})</span></div>
              <Table>
                <TableHeader><TableRow><TableHead className="w-28">Tanggal</TableHead><TableHead className="w-32">Nomor</TableHead><TableHead>Ref</TableHead><TableHead>Deskripsi</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Kredit</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
                <TableBody>
                  {acc.rows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Tidak ada mutasi</TableCell></TableRow>
                  ) : acc.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{new Date(r.date).toLocaleDateString("id-ID")}</TableCell>
                      <TableCell className="font-mono text-xs">{r.entryNumber}</TableCell>
                      <TableCell className="text-xs">{r.ref ?? "-"}</TableCell>
                      <TableCell className="text-xs">{r.description ?? "-"}</TableCell>
                      <TableCell className="text-right font-mono">{r.debit > 0 ? idr(r.debit) : ""}</TableCell>
                      <TableCell className="text-right font-mono">{r.credit > 0 ? idr(r.credit) : ""}</TableCell>
                      <TableCell className="text-right font-mono">{idr(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold border-t bg-muted/30">
                    <TableCell colSpan={4}>Total</TableCell>
                    <TableCell className="text-right font-mono">{idr(acc.totalDebit)}</TableCell>
                    <TableCell className="text-right font-mono">{idr(acc.totalCredit)}</TableCell>
                    <TableCell className="text-right font-mono">{idr(acc.endingBalance)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
