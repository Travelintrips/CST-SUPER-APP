import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle, AlertTriangle, RefreshCw, GitMerge, Play, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

function fmt(n: unknown) {
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(Number(n ?? 0)));
}

function StatusBadge({ status }: { status: string }) {
  if (status === "clean")
    return <Badge className="bg-green-100 text-green-800 border-green-200">✓ Clean</Badge>;
  if (status === "mismatch")
    return <Badge className="bg-red-100 text-red-800 border-red-200">⚠ Mismatch</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function FinancialReconciliationPage() {
  const { activeCompanyId: selectedCompanyId } = useCompany();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selected, setSelected] = useState<any>(null);

  const listQ = useQuery({
    queryKey: ["recon-list", selectedCompanyId],
    queryFn: () =>
      fetch(`/api/accounting/reconciliation?company_id=${selectedCompanyId}&limit=50`, { credentials: "include" })
        .then((r) => r.json()) as Promise<any[]>,
    enabled: !!selectedCompanyId,
  });

  const runMutation = useMutation({
    mutationFn: () =>
      fetch("/api/accounting/reconciliation/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId, period }),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw data;
        return data;
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["recon-list"] });
      setSelected(data);
      if (data.summary?.status === "clean") {
        toast.success(`Rekonsiliasi ${period} bersih — tidak ada mismatch`);
      } else {
        toast.warning(
          `Rekonsiliasi ${period}: ${data.summary?.mismatchCount ?? 0} mismatch ditemukan`,
        );
      }
    },
    onError: () => toast.error("Gagal menjalankan rekonsiliasi"),
  });

  const reports = listQ.data ?? [];

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <GitMerge className="w-6 h-6 text-purple-600" />
          <div>
            <h1 className="text-xl font-semibold">Rekonsiliasi Finansial</h1>
            <p className="text-sm text-muted-foreground">Bandingkan ledger vs journal entries vs pembayaran — deteksi mismatch otomatis</p>
          </div>
        </div>

        {/* Run controls */}
        <Card>
          <CardContent className="pt-4">
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
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || !selectedCompanyId}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {runMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Jalankan Rekonsiliasi
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Last run result */}
        {selected && (
          <Card
            className={
              selected.summary?.status === "clean"
                ? "border-green-200"
                : "border-red-200"
            }
          >
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {selected.summary?.status === "clean" ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                )}
                Hasil Rekonsiliasi — {selected.report?.period}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary grid */}
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="space-y-1">
                  <div className="font-medium text-muted-foreground">Ledger (Sumber Utama)</div>
                  <div>Debit: <span className="font-mono">{fmt(selected.summary?.ledger?.debit)}</span></div>
                  <div>Kredit: <span className="font-mono">{fmt(selected.summary?.ledger?.credit)}</span></div>
                  <div className="text-muted-foreground">{selected.summary?.ledger?.lines ?? 0} baris</div>
                </div>
                <div className="space-y-1">
                  <div className="font-medium text-muted-foreground">Journal Entries</div>
                  <div>Debit: <span className="font-mono">{fmt(selected.summary?.journal?.debit)}</span></div>
                  <div>Kredit: <span className="font-mono">{fmt(selected.summary?.journal?.credit)}</span></div>
                  <div className="text-muted-foreground">{selected.summary?.journal?.lines ?? 0} baris</div>
                </div>
                <div className="space-y-1">
                  <div className="font-medium text-muted-foreground">Pembayaran</div>
                  <div>Total: <span className="font-mono">{fmt(selected.summary?.payment?.total)}</span></div>
                  <div className="text-muted-foreground">{selected.summary?.payment?.count ?? 0} transaksi</div>
                </div>
              </div>

              {selected.summary?.status === "mismatch" && (
                <>
                  <Alert className="border-red-200 bg-red-50">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-red-800">
                      <strong>{selected.summary?.mismatchCount} akun mismatch.</strong>{" "}
                      Debit diff: {fmt(selected.summary?.diff?.debit)} |{" "}
                      Kredit diff: {fmt(selected.summary?.diff?.credit)}
                    </AlertDescription>
                  </Alert>

                  <Accordion type="single" collapsible>
                    <AccordionItem value="discrepancies">
                      <AccordionTrigger className="text-sm font-medium">
                        Detail Discrepancies ({selected.discrepancies?.length ?? 0} akun)
                      </AccordionTrigger>
                      <AccordionContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Kode</TableHead>
                              <TableHead>Akun</TableHead>
                              <TableHead className="text-right">Ledger Dr</TableHead>
                              <TableHead className="text-right">Journal Dr</TableHead>
                              <TableHead className="text-right">Diff Dr</TableHead>
                              <TableHead className="text-right">Ledger Cr</TableHead>
                              <TableHead className="text-right">Journal Cr</TableHead>
                              <TableHead className="text-right">Diff Cr</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(selected.discrepancies ?? []).map((d: any, i: number) => (
                              <TableRow key={i}>
                                <TableCell className="font-mono text-xs">{d.account_code}</TableCell>
                                <TableCell className="text-xs">{d.account_name}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{fmt(d.ledger_debit)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{fmt(d.journal_debit)}</TableCell>
                                <TableCell className="text-right font-mono text-xs text-red-600 font-medium">
                                  {fmt(d.debit_diff)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">{fmt(d.ledger_credit)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{fmt(d.journal_credit)}</TableCell>
                                <TableCell className="text-right font-mono text-xs text-red-600 font-medium">
                                  {fmt(d.credit_diff)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Riwayat Rekonsiliasi</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {listQ.isLoading ? (
              <div className="p-6 text-center text-muted-foreground text-sm">Memuat...</div>
            ) : reports.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Belum ada rekonsiliasi. Jalankan rekonsiliasi pertama di atas.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Mismatch</TableHead>
                    <TableHead className="text-right">Ledger Debit</TableHead>
                    <TableHead className="text-right">Ledger Kredit</TableHead>
                    <TableHead className="text-right">Diff Debit</TableHead>
                    <TableHead>Dijalankan Oleh</TableHead>
                    <TableHead>Waktu</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono font-medium">{r.period}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell>
                        {r.mismatch_count > 0 ? (
                          <span className="text-red-600 font-medium">{r.mismatch_count}</span>
                        ) : (
                          <span className="text-green-600">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(r.ledger_debit)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmt(r.ledger_credit)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {Number(r.debit_diff) > 0 ? (
                          <span className="text-red-600">{fmt(r.debit_diff)}</span>
                        ) : (
                          <span className="text-green-600">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.run_by}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.run_at
                          ? format(new Date(r.run_at), "dd MMM yyyy HH:mm", { locale: localeId })
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setSelected({
                              report: r,
                              summary: {
                                status: r.status,
                                mismatchCount: r.mismatch_count,
                                ledger:  { debit: r.ledger_debit,  credit: r.ledger_credit },
                                journal: { debit: r.journal_debit, credit: r.journal_credit },
                                payment: { total: r.payment_total },
                                diff:    { debit: r.debit_diff, credit: r.credit_diff },
                              },
                              discrepancies: r.discrepancies ?? [],
                            })
                          }
                        >
                          Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
