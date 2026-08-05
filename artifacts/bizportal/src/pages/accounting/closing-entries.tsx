import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { ArrowLeft, BookLock, Eye, Play, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Math.abs(n));

type LinePreview = { accountId: number; code?: string; name?: string; debit: number; credit: number; description?: string };
type EntryPreview = { description: string; lines: LinePreview[] };
type PreviewData = {
  dry_run: boolean;
  period_end: string;
  journal: { id: number; code: string; name: string };
  income_summary_account: { id: number; code: string; name: string };
  retained_earnings_account: { id: number; code: string; name: string };
  summary: { total_revenue: number; total_expense: number; net_income: number };
  entries: EntryPreview[];
  created_entries?: { id: number; entryNumber: string; description?: string }[];
};

type HistoryEntry = {
  id: number;
  entryNumber: string;
  date: string;
  description?: string;
  totalDebit: number;
  totalCredit: number;
};

export default function ClosingEntriesPage() {
  const { activeCompanyId } = useCompany();
  const [periodEnd, setPeriodEnd] = useState("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const qc = useQueryClient();

  const historyQuery = useQuery<{ entries: HistoryEntry[] }>({
    queryKey: ["closing-entries-history", activeCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/accounting/closing-entries?company=${activeCompanyId}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!activeCompanyId,
  });

  const dryRunMutation = useMutation({
    mutationFn: async () => {
      if (!periodEnd) throw new Error("Pilih tanggal akhir periode terlebih dahulu");
      const r = await fetch("/api/accounting/closing-entries", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: activeCompanyId,
          period_end: periodEnd,
          dry_run: true,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Gagal");
      return data as PreviewData;
    },
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: (e: Error) => {
      setError(e.message);
      setPreview(null);
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (force: boolean) => {
      if (!periodEnd) throw new Error("Pilih tanggal akhir periode");
      const r = await fetch("/api/accounting/closing-entries", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: activeCompanyId,
          period_end: periodEnd,
          dry_run: false,
          force,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? "Gagal");
      return data as PreviewData;
    },
    onSuccess: (data) => {
      const n = data.created_entries?.length ?? 0;
      setSuccess(`✅ ${n} jurnal penutup berhasil dibuat. Saldo revenue/expense telah dipindahkan ke Laba Ditahan.`);
      setError(null);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["closing-entries-history"] });
    },
    onError: (e: Error) => {
      setError(e.message);
    },
  });

  const netColor = (preview?.summary.net_income ?? 0) >= 0 ? "text-green-700" : "text-red-700";

  return (
    <AppShell>
      <div className="space-y-6 p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Link href="/accounting/dashboard">
            <Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookLock className="h-6 w-6 text-indigo-600" />
              Jurnal Penutup (Closing Entries)
            </h1>
            <p className="text-sm text-muted-foreground">
              Tutup akun pendapatan &amp; beban ke Laba Ditahan akhir periode
            </p>
          </div>
        </div>

        {/* Form */}
        <Card>
          <CardHeader><CardTitle className="text-base">Parameter Penutupan</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 items-end">
              <div className="flex-1 max-w-xs">
                <Label>Tanggal Akhir Periode</Label>
                <DatePicker value={periodEnd} onChange={setPeriodEnd} />
                <p className="text-xs text-muted-foreground mt-1">
                  Semua saldo revenue/expense s.d. tanggal ini akan ditutup
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => dryRunMutation.mutate()}
                  disabled={!periodEnd || dryRunMutation.isPending}
                >
                  {dryRunMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
                  Preview
                </Button>
                <Button
                  onClick={() => executeMutation.mutate(false)}
                  disabled={!periodEnd || executeMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {executeMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Eksekusi
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 flex gap-2 items-start">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div className="text-sm text-red-700">
                  <p>{error}</p>
                  {error.includes("sudah ada") && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="mt-2"
                      onClick={() => executeMutation.mutate(true)}
                      disabled={executeMutation.isPending}
                    >
                      Paksa Buat Ulang (force)
                    </Button>
                  )}
                </div>
              </div>
            )}

            {success && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 flex gap-2 items-start">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <p className="text-sm text-green-700">{success}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Preview */}
        {preview && (
          <Card className="border-indigo-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Preview Jurnal Penutup — {preview.period_end}
                <Badge variant="outline" className="ml-2">DRY RUN</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Pendapatan</p>
                  <p className="text-lg font-bold text-green-700">Rp {idr(preview.summary.total_revenue)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Beban</p>
                  <p className="text-lg font-bold text-red-700">Rp {idr(preview.summary.total_expense)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">
                    {preview.summary.net_income >= 0 ? "Laba Bersih" : "Rugi Bersih"}
                  </p>
                  <p className={`text-lg font-bold ${netColor}`}>
                    {preview.summary.net_income < 0 ? "(" : ""}Rp {idr(preview.summary.net_income)}{preview.summary.net_income < 0 ? ")" : ""}
                  </p>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Jurnal: <strong>{preview.journal.name} ({preview.journal.code})</strong> •
                Akun Ikhtisar: <strong>{preview.income_summary_account.code} {preview.income_summary_account.name}</strong> •
                Laba Ditahan: <strong>{preview.retained_earnings_account.code} {preview.retained_earnings_account.name}</strong>
              </div>

              {/* Entry Lines */}
              {preview.entries.map((entry, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">{entry.description}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Keterangan</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Kredit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entry.lines.map((l, j) => (
                        <TableRow key={j}>
                          <TableCell className="text-xs">{l.description ?? `Akun #${l.accountId}`}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{l.debit > 0 ? idr(l.debit) : ""}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{l.credit > 0 ? idr(l.credit) : ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}

              <div className="flex justify-end">
                <Button
                  onClick={() => executeMutation.mutate(false)}
                  disabled={executeMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {executeMutation.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Eksekusi Sekarang
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Riwayat Jurnal Penutup</span>
              <Button variant="ghost" size="sm" onClick={() => setShowHistory(h => !h)}>
                {showHistory ? "Sembunyikan" : "Tampilkan"}
              </Button>
            </CardTitle>
          </CardHeader>
          {showHistory && (
            <CardContent>
              {historyQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Memuat...</p>
              ) : !historyQuery.data?.entries?.length ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Belum ada jurnal penutup. Buat yang pertama di atas.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Jurnal</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Keterangan</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Kredit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyQuery.data.entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-xs">
                          <Link href={`/accounting/entries/${e.id}`} className="text-indigo-600 hover:underline">
                            {e.entryNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">{e.date}</TableCell>
                        <TableCell className="text-xs">{e.description ?? "-"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{idr(e.totalDebit)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{idr(e.totalCredit)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
