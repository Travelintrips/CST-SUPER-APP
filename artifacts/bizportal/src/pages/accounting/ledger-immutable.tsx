import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, CheckCircle, AlertTriangle, RefreshCw, Database, Shield, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";

function fmt(n: unknown) {
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(Number(n ?? 0)));
}

export default function LedgerImmutablePage() {
  const { activeCompanyId: selectedCompanyId } = useCompany();
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  const summaryQ = useQuery({
    queryKey: ["ledger-summary", selectedCompanyId, period],
    queryFn: () =>
      fetch(`/api/accounting/ledger/summary?company_id=${selectedCompanyId}&period=${period}`, { credentials: "include" })
        .then((r) => r.json()) as Promise<any[]>,
    enabled: !!selectedCompanyId,
  });

  const balanceQ = useQuery({
    queryKey: ["ledger-balance", selectedCompanyId, period],
    queryFn: () =>
      fetch(`/api/accounting/ledger/balance?company_id=${selectedCompanyId}&period=${period}`, { credentials: "include" })
        .then((r) => r.json()) as Promise<any[]>,
    enabled: !!selectedCompanyId && !!period,
  });

  async function runIntegrityCheck() {
    if (!selectedCompanyId) return;
    setChecking(true);
    try {
      const r = await fetch(
        `/api/accounting/ledger/integrity-check?company_id=${selectedCompanyId}&period=${period}`,
        { credentials: "include" },
      );
      setCheckResult(await r.json());
    } catch {
      setCheckResult(null);
    } finally {
      setChecking(false);
    }
  }

  const summary = summaryQ.data ?? [];
  const currentPeriod = summary.find((s: any) => s.period === period) ?? summary[0];
  const balances = balanceQ.data ?? [];

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <Lock className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold">Ledger Immutable</h1>
            <p className="text-sm text-muted-foreground">Append-only financial ledger — sumber kebenaran tunggal semua transaksi</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex items-end gap-4">
          <div className="space-y-1">
            <Label>Periode</Label>
            <div className="flex gap-1.5">
              <select
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={period ? period.slice(5, 7) : ""}
                onChange={(e) => {
                  const y = period ? period.slice(0, 4) : String(new Date().getFullYear());
                  setPeriod(`${y}-${e.target.value}`);
                }}
              >
                <option value="">Bulan</option>
                {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m, i) => (
                  <option key={m} value={m}>{["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][i]}</option>
                ))}
              </select>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={period ? period.slice(0, 4) : ""}
                onChange={(e) => {
                  const m = period ? period.slice(5, 7) : "01";
                  setPeriod(`${e.target.value}-${m}`);
                }}
              >
                <option value="">Tahun</option>
                {Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - 2 + i)).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={runIntegrityCheck}
            disabled={checking}
          >
            {checking ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Shield className="w-4 h-4 mr-2" />
            )}
            Integrity Check
          </Button>
        </div>

        {/* Integrity Check Result */}
        {checkResult && (
          <Alert
            className={
              checkResult.isClean
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }
          >
            {checkResult.isClean ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600" />
            )}
            <AlertDescription>
              <div className="font-medium mb-1">
                {checkResult.isClean ? "✓ Ledger BERSIH — cocok dengan journal entries" : "⚠ MISMATCH terdeteksi!"}
              </div>
              <div className="text-sm grid grid-cols-2 gap-x-8 gap-y-0.5 text-muted-foreground">
                <span>Ledger Debit: {fmt(checkResult.ledger?.debit)}</span>
                <span>Journal Debit: {fmt(checkResult.journal?.debit)}</span>
                <span>Ledger Credit: {fmt(checkResult.ledger?.credit)}</span>
                <span>Journal Credit: {fmt(checkResult.journal?.credit)}</span>
                {!checkResult.isClean && (
                  <>
                    <span className="text-red-600">Debit Diff: {fmt(checkResult.diff?.debit)}</span>
                    <span className="text-red-600">Credit Diff: {fmt(checkResult.diff?.credit)}</span>
                  </>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Database className="w-4 h-4" />
                <span className="text-sm">Total Entry Lines</span>
              </div>
              <div className="text-2xl font-bold">
                {Number(currentPeriod?.line_count ?? 0).toLocaleString("id-ID")}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground mb-1">Total Debit</div>
              <div className="text-2xl font-bold text-blue-700">
                {fmt(currentPeriod?.total_debit)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground mb-1">Total Kredit</div>
              <div className="text-2xl font-bold text-purple-700">
                {fmt(currentPeriod?.total_credit)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground mb-1">Net Balance</div>
              <div
                className={`text-2xl font-bold ${Number(currentPeriod?.net_balance ?? 0) >= 0 ? "text-green-700" : "text-red-600"}`}
              >
                {fmt(currentPeriod?.net_balance)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Account Balances */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Saldo per Akun — Periode {period}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {balanceQ.isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Memuat...</div>
            ) : balances.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Tidak ada data ledger untuk periode ini
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kode</TableHead>
                    <TableHead>Nama Akun</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Kredit</TableHead>
                    <TableHead className="text-right">Net Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((row: any) => (
                    <TableRow key={row.account_id}>
                      <TableCell className="font-mono text-xs">{row.account_code}</TableCell>
                      <TableCell>{row.account_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {row.account_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(row.total_debit)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(row.total_credit)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs font-medium ${Number(row.net_balance) >= 0 ? "text-green-700" : "text-red-600"}`}
                      >
                        {fmt(row.net_balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Immutability notice */}
        <Alert className="border-blue-200 bg-blue-50">
          <Lock className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800 text-sm">
            <strong>Ledger Immutable:</strong> Semua entri di tabel ini bersifat append-only.
            Tidak bisa di-update atau dihapus. Koreksi dilakukan via void counter-entry.
            Trigger database aktif memblokir UPDATE/DELETE pada field inti.
          </AlertDescription>
        </Alert>
      </div>
    </AppShell>
  );
}
