import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle, CheckCircle2, Clock, Download, RefreshCw,
  Scale, ChevronDown, ChevronRight, Info, ArrowLeft,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";
import { BackButton } from "@/components/ui/back-button";

function fmtRp(n: number) { return "Rp " + Math.abs(Math.round(n)).toLocaleString("id-ID"); }
function fmtPct(a: number, total: number) {
  if (!total) return "0%";
  return Math.round((a / total) * 100) + "%";
}
function generateYears() {
  const y = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => String(y - i));
}
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
function monthLabel(p: string) {
  const m = parseInt((p.split("-")[1] ?? "1")) - 1;
  return (MONTH_NAMES[m] ?? p) + " " + p.slice(0, 4);
}

interface SummaryRow {
  tax_name: string; direction: string;
  total_tx: number; total_dpp: string; total_tax: string;
  paid: string; reported: string; pending: string;
  missing_npwp: number; missing_faktur: number;
}
interface GapRow {
  id: number; period: string; tax_name: string; direction: string;
  transaction_type: string; transaction_ref: string | null;
  partner_name: string | null; npwp: string | null; tax_invoice_number: string | null;
  base_amount: string; tax_amount: string; status: string; created_at: string;
}
interface PeriodRow {
  period: string; tax_name: string; direction: string;
  total_tx: number; total_tax: string;
  paid: string; reported: string; pending: string;
  missing_npwp: number; missing_faktur: number;
}
interface ReconciliationData {
  year: string;
  summary: SummaryRow[];
  gaps: GapRow[];
  byPeriod: PeriodRow[];
}

function ProgressBar({ paid, reported, pending }: { paid: number; reported: number; pending: number }) {
  const total = paid + reported + pending;
  if (!total) return <span className="text-xs text-muted-foreground">–</span>;
  const paidPct = (paid / total) * 100;
  const repPct = (reported / total) * 100;
  const donePct = Math.round(paidPct + repPct);
  return (
    <div className="flex items-center gap-1.5 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden flex">
        <div className="bg-emerald-500 h-full transition-all" style={{ width: `${paidPct}%` }} />
        <div className="bg-blue-400 h-full transition-all" style={{ width: `${repPct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground w-10 text-right">{donePct}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "paid")     return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Disetor</Badge>;
  if (status === "reported") return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px]">Dilaporkan</Badge>;
  return <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">Pending</Badge>;
}

export default function TaxReconciliationPage() {
  const { selectedCompanyId } = useCompany();
  const qc = useQueryClient();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"summary" | "gaps" | "by-period">("summary");

  const params = new URLSearchParams({ year });
  if (selectedCompanyId) params.set("companyId", String(selectedCompanyId));

  const { data, isLoading, isFetching, refetch } = useQuery<ReconciliationData>({
    queryKey: ["tax-reconciliation", selectedCompanyId, year],
    queryFn: () => fetch(`/api/tax/reconciliation?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const bulkMutation = useMutation({
    mutationFn: (body: { period?: string; taxName?: string; status: string }) =>
      fetch("/api/tax/reconciliation/bulk-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...body, companyId: selectedCompanyId ?? 1 }),
      }).then((r) => r.json()),
    onSuccess: (d) => {
      toast.success(`${d.updated} transaksi diperbarui`);
      qc.invalidateQueries({ queryKey: ["tax-reconciliation"] });
    },
    onError: () => toast.error("Gagal memperbarui status"),
  });

  const summary = data?.summary ?? [];
  const gaps = data?.gaps ?? [];

  // Group byPeriod rows by period
  const byPeriodGroups: Record<string, PeriodRow[]> = {};
  for (const r of data?.byPeriod ?? []) {
    if (!byPeriodGroups[r.period]) byPeriodGroups[r.period] = [];
    byPeriodGroups[r.period].push(r);
  }
  const periods = Object.keys(byPeriodGroups).sort().reverse();

  const grandTax     = summary.reduce((s, r) => s + Number(r.total_tax), 0);
  const grandPaid    = summary.reduce((s, r) => s + Number(r.paid), 0);
  const grandReported= summary.reduce((s, r) => s + Number(r.reported), 0);
  const grandPending = summary.reduce((s, r) => s + Number(r.pending), 0);
  const totalGaps    = gaps.length;

  return (
    <AppShell>
      <BackButton href="/finance/workspace/tax-center" />
      <TooltipProvider>
        <div className="p-6 space-y-6 max-w-6xl mx-auto">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" />Kembali
          </Button>
          {/* Header */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Scale className="h-5 w-5 text-violet-600" />
                Rekonsiliasi Pajak
              </h1>
              <p className="text-sm text-muted-foreground">Bandingkan pajak tercatat vs sudah disetor/dilaporkan ke DJP — {year}</p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{generateYears().map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="sm"
                onClick={() => window.open(`/api/tax/export?period_from=${year}-01&period_to=${year}-12${selectedCompanyId ? `&companyId=${selectedCompanyId}` : ""}`, "_blank")}>
                <Download className="h-4 w-4 mr-1.5" />Export
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Total Pajak Tercatat</p>
                <p className="text-2xl font-bold">{fmtRp(grandTax)}</p>
              </CardContent>
            </Card>
            <Card className="bg-emerald-50/60 border-emerald-200">
              <CardContent className="p-4">
                <p className="text-xs text-emerald-700">Sudah Disetor</p>
                <p className="text-2xl font-bold text-emerald-800">{fmtRp(grandPaid)}</p>
                <p className="text-xs text-emerald-600">{fmtPct(grandPaid, grandTax)} dari total</p>
              </CardContent>
            </Card>
            <Card className="bg-blue-50/60 border-blue-200">
              <CardContent className="p-4">
                <p className="text-xs text-blue-700">Sudah Dilaporkan</p>
                <p className="text-2xl font-bold text-blue-800">{fmtRp(grandReported)}</p>
                <p className="text-xs text-blue-600">{fmtPct(grandReported, grandTax)} dari total</p>
              </CardContent>
            </Card>
            <Card className={grandPending > 0 ? "bg-orange-50/60 border-orange-200" : ""}>
              <CardContent className="p-4">
                <p className={`text-xs ${grandPending > 0 ? "text-orange-700" : "text-muted-foreground"}`}>Selisih / Belum Disetor</p>
                <p className={`text-2xl font-bold ${grandPending > 0 ? "text-orange-800" : ""}`}>{fmtRp(grandPending)}</p>
                {totalGaps > 0 && (
                  <p className="text-xs text-orange-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />{totalGaps} baris kurang NPWP/Faktur
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <div className="flex border-b gap-1">
            {(["summary", "by-period", "gaps"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === t ? "border-violet-600 text-violet-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t === "summary" ? "Per Jenis Pajak" : t === "by-period" ? "Per Bulan" : `Gap & Alert (${totalGaps})`}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />
            ))}</div>
          ) : (
            <>
              {/* Summary tab */}
              {tab === "summary" && (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Jenis Pajak</TableHead>
                          <TableHead>Arah</TableHead>
                          <TableHead className="text-right">Tx</TableHead>
                          <TableHead className="text-right">Total DPP</TableHead>
                          <TableHead className="text-right">Total Pajak</TableHead>
                          <TableHead className="text-right">Disetor</TableHead>
                          <TableHead className="text-right">Dilaporkan</TableHead>
                          <TableHead className="text-right">Selisih</TableHead>
                          <TableHead>Progress</TableHead>
                          <TableHead className="text-center">Gap</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={11} className="text-center py-10 text-muted-foreground">
                              Tidak ada data pajak untuk {year}
                            </TableCell>
                          </TableRow>
                        ) : summary.map((r, i) => {
                          const selisih = Number(r.pending);
                          const doneAmt = Number(r.paid) + Number(r.reported);
                          return (
                            <TableRow key={i} className={selisih > 0 ? "bg-orange-50/30" : ""}>
                              <TableCell className="font-medium">{r.tax_name}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">{r.direction ?? "output"}</Badge>
                              </TableCell>
                              <TableCell className="text-right text-sm">{r.total_tx}</TableCell>
                              <TableCell className="text-right text-sm">{fmtRp(Number(r.total_dpp))}</TableCell>
                              <TableCell className="text-right font-semibold">{fmtRp(Number(r.total_tax))}</TableCell>
                              <TableCell className="text-right text-emerald-700">{fmtRp(Number(r.paid))}</TableCell>
                              <TableCell className="text-right text-blue-700">{fmtRp(Number(r.reported))}</TableCell>
                              <TableCell className={`text-right font-semibold ${selisih > 0 ? "text-orange-700" : "text-emerald-700"}`}>
                                {selisih > 0 ? fmtRp(selisih) : <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />}
                              </TableCell>
                              <TableCell>
                                <ProgressBar paid={Number(r.paid)} reported={Number(r.reported)} pending={selisih} />
                              </TableCell>
                              <TableCell className="text-center">
                                {(r.missing_npwp > 0 || r.missing_faktur > 0) ? (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <AlertTriangle className="h-4 w-4 text-orange-500 mx-auto" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>{r.missing_npwp} tanpa NPWP · {r.missing_faktur} tanpa no. faktur</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" />}
                              </TableCell>
                              <TableCell>
                                {selisih > 0 && (
                                  <div className="flex gap-1">
                                    <Button size="sm" variant="outline" className="h-7 text-xs"
                                      onClick={() => bulkMutation.mutate({ taxName: r.tax_name, status: "paid" })}
                                      disabled={bulkMutation.isPending}>
                                      Setor Semua
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 text-xs"
                                      onClick={() => bulkMutation.mutate({ taxName: r.tax_name, status: "reported" })}
                                      disabled={bulkMutation.isPending}>
                                      Lapor Semua
                                    </Button>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* By-period tab */}
              {tab === "by-period" && (
                <div className="space-y-3">
                  {periods.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <Scale className="h-10 w-10 mx-auto mb-3 opacity-20" />
                      <p>Tidak ada data untuk {year}</p>
                    </div>
                  ) : periods.map((period) => {
                    const rows = byPeriodGroups[period];
                    const mTotal   = rows.reduce((s, r) => s + Number(r.total_tax), 0);
                    const mPaid    = rows.reduce((s, r) => s + Number(r.paid), 0);
                    const mRep     = rows.reduce((s, r) => s + Number(r.reported), 0);
                    const mPending = rows.reduce((s, r) => s + Number(r.pending), 0);
                    const mGaps    = rows.reduce((s, r) => s + r.missing_npwp + r.missing_faktur, 0);
                    const allDone  = mPending <= 0;
                    const open     = expanded[period] ?? false;

                    return (
                      <Card key={period} className={allDone ? "border-emerald-200" : mPending > 0 ? "border-orange-200" : ""}>
                        <CardContent className="p-0">
                          <button className="w-full flex items-center justify-between px-5 py-3 text-left"
                            onClick={() => setExpanded((p) => ({ ...p, [period]: !p[period] }))}>
                            <div className="flex items-center gap-2">
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              {allDone
                                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                : <Clock className="h-4 w-4 text-orange-400" />}
                              <span className="font-semibold">{monthLabel(period)}</span>
                              <span className="text-xs text-muted-foreground">({rows.length} jenis pajak)</span>
                              {mGaps > 0 && (
                                <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">
                                  <AlertTriangle className="h-3 w-3 mr-1" />{mGaps} gap
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              <ProgressBar paid={mPaid} reported={mRep} pending={mPending} />
                              <span className="font-bold text-sm">{fmtRp(mTotal)}</span>
                              {mPending > 0 && (
                                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                  <Button size="sm" variant="outline" className="h-7 text-xs"
                                    onClick={() => bulkMutation.mutate({ period, status: "paid" })}
                                    disabled={bulkMutation.isPending}>
                                    Setor Bulan Ini
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs"
                                    onClick={() => bulkMutation.mutate({ period, status: "reported" })}
                                    disabled={bulkMutation.isPending}>
                                    Lapor
                                  </Button>
                                </div>
                              )}
                            </div>
                          </button>

                          {open && (
                            <div className="border-t">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Jenis Pajak</TableHead>
                                    <TableHead>Arah</TableHead>
                                    <TableHead className="text-right">Tx</TableHead>
                                    <TableHead className="text-right">Total Pajak</TableHead>
                                    <TableHead className="text-right">Disetor</TableHead>
                                    <TableHead className="text-right">Dilaporkan</TableHead>
                                    <TableHead className="text-right">Selisih</TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead className="text-center">Gap</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {rows.map((r, i) => {
                                    const sel = Number(r.pending);
                                    return (
                                      <TableRow key={i} className={sel > 0 ? "bg-orange-50/20" : ""}>
                                        <TableCell className="text-sm">{r.tax_name}</TableCell>
                                        <TableCell><Badge variant="outline" className="text-[10px]">{r.direction ?? "output"}</Badge></TableCell>
                                        <TableCell className="text-right text-sm">{r.total_tx}</TableCell>
                                        <TableCell className="text-right font-semibold text-sm">{fmtRp(Number(r.total_tax))}</TableCell>
                                        <TableCell className="text-right text-emerald-700 text-sm">{fmtRp(Number(r.paid))}</TableCell>
                                        <TableCell className="text-right text-blue-700 text-sm">{fmtRp(Number(r.reported))}</TableCell>
                                        <TableCell className={`text-right font-semibold text-sm ${sel > 0 ? "text-orange-700" : "text-muted-foreground"}`}>
                                          {sel > 0 ? fmtRp(sel) : "–"}
                                        </TableCell>
                                        <TableCell>
                                          <ProgressBar paid={Number(r.paid)} reported={Number(r.reported)} pending={sel} />
                                        </TableCell>
                                        <TableCell className="text-center">
                                          {(r.missing_npwp > 0 || r.missing_faktur > 0) ? (
                                            <Tooltip>
                                              <TooltipTrigger>
                                                <AlertTriangle className="h-3.5 w-3.5 text-orange-500 mx-auto" />
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p>{r.missing_npwp}× tanpa NPWP · {r.missing_faktur}× tanpa faktur</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          ) : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mx-auto" />}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Gaps tab */}
              {tab === "gaps" && (
                <Card>
                  <CardContent className="p-0">
                    {gaps.length === 0 ? (
                      <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
                        <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                        <p className="font-medium text-emerald-700">Semua transaksi sudah lengkap NPWP & faktur pajak</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 px-4 py-3 border-b bg-orange-50/50">
                          <Info className="h-4 w-4 text-orange-500" />
                          <span className="text-sm text-orange-700">
                            {gaps.length} transaksi masih pending dan belum lengkap NPWP / nomor faktur pajak.
                          </span>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Periode</TableHead>
                              <TableHead>Referensi</TableHead>
                              <TableHead>Jenis Pajak</TableHead>
                              <TableHead>Partner</TableHead>
                              <TableHead>NPWP</TableHead>
                              <TableHead>No. Faktur</TableHead>
                              <TableHead className="text-right">Pajak</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {gaps.map((r) => (
                              <TableRow key={r.id} className="text-sm">
                                <TableCell className="text-xs text-muted-foreground">{r.period}</TableCell>
                                <TableCell>
                                  <div className="font-medium">{r.transaction_ref ?? "–"}</div>
                                  <div className="text-[10px] text-muted-foreground">{r.transaction_type}</div>
                                </TableCell>
                                <TableCell>{r.tax_name}</TableCell>
                                <TableCell>{r.partner_name ?? <span className="text-muted-foreground">–</span>}</TableCell>
                                <TableCell>
                                  {r.npwp ? (
                                    <span className="font-mono text-xs">{r.npwp}</span>
                                  ) : (
                                    <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">
                                      <AlertTriangle className="h-3 w-3 mr-1" />Kosong
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {r.tax_invoice_number ? (
                                    <span className="font-mono text-xs">{r.tax_invoice_number}</span>
                                  ) : (
                                    <Badge variant="outline" className="text-orange-600 border-orange-300 text-[10px]">
                                      <AlertTriangle className="h-3 w-3 mr-1" />Kosong
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-semibold">{fmtRp(Number(r.tax_amount))}</TableCell>
                                <TableCell><StatusBadge status={r.status} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </TooltipProvider>
    </AppShell>
  );
}
