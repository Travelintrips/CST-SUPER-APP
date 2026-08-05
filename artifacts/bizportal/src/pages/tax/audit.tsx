import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, Download,
  ShieldCheck, FileText, Receipt, ArrowRight, ExternalLink,
  ClipboardCheck, AlertCircle, Info, DatabaseZap, ArrowLeft,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { cn } from "@/lib/utils";
import { BackButton } from "@/components/ui/back-button";

function formatRp(n: number) {
  return "Rp " + Math.abs(Math.round(n)).toLocaleString("id-ID");
}

function generateYears() {
  const now = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => String(now - i));
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function monthLabel(period: string) {
  const [, m] = period.split("-");
  return MONTH_NAMES[(parseInt(m ?? "1") - 1)] ?? period;
}

const TX_TYPE_LABEL: Record<string, string> = {
  sales_invoice:    "Faktur Penjualan",
  sales_order:      "Sales Order",
  purchase_invoice: "Faktur Pembelian",
  purchase_order:   "Purchase Order",
  expense:          "Beban / Expense",
  logistic_order:   "Order Logistik",
  freight_shipment: "Freight Shipment",
  journal:          "Jurnal Umum",
};

const DIR_LABEL: Record<string, string> = {
  output:      "PPN Keluaran",
  input:       "PPN Masukan",
  withholding: "PPh Dipotong",
};

interface Grand {
  totalLines: number; txCount: number; totalDpp: number; totalPajak: number;
  paid: number; reported: number; pending: number;
  npwpMissing: number; fakturMissing: number; bukpotMissing: number;
  totalIssues: number; readyToReport: boolean;
}

interface TypeRow {
  transaction_type: string; lines: number; tx_count: number; dpp: number;
  pajak: number; pending: number; npwp_missing: number; faktur_missing: number; bukpot_missing: number;
}

interface MonthRow {
  period: string; total_lines: number; tx_count: number; total_pajak: number;
  paid: number; reported: number; pending: number;
  npwp_missing: number; faktur_missing: number; bukpot_missing: number;
  ppn_keluaran: number; ppn_masukan: number; pph_total: number;
}

interface AuditData {
  year: string;
  grand: Grand;
  byType: TypeRow[];
  monthly: MonthRow[];
}

function IssueChip({ n, label }: { n: number; label: string }) {
  if (n === 0) return <span className="text-[11px] text-emerald-600 flex items-center gap-0.5"><CheckCircle2 className="h-3 w-3" /> OK</span>;
  return (
    <span className="text-[11px] text-amber-600 flex items-center gap-0.5">
      <AlertTriangle className="h-3 w-3" /> {n} {label}
    </span>
  );
}

function ReadyBadge({ ready, issues }: { ready: boolean; issues: number }) {
  if (ready) return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">✅ Siap Lapor</Badge>;
  return <Badge variant="outline" className="border-amber-400 text-amber-700 text-[10px]">⚠️ {issues} masalah</Badge>;
}

function StatusPill({ value, total, color }: { value: number; total: number; color: string }) {
  if (total === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = Math.round((value / total) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums">{value}/{total}</span>
    </div>
  );
}

function CheckIcon({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
    : <XCircle className="h-4 w-4 text-rose-400 mx-auto" />;
}

interface SyncResult { total: number; inserted: number; skipped: number; noTaxId: number; errors: number; }

export default function TaxAuditPage() {
  const { selectedCompanyId } = useCompany();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams({ year });
  if (selectedCompanyId) params.set("companyId", String(selectedCompanyId));

  const { data, isLoading, isFetching, refetch } = useQuery<AuditData>({
    queryKey: ["tax-coverage-audit", selectedCompanyId, year],
    queryFn: () => fetch(`/api/tax/coverage-audit?${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const p = new URLSearchParams();
      if (selectedCompanyId) p.set("companyId", String(selectedCompanyId));
      const r = await fetch(`/api/tax/sync-from-ledger?${p}`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<SyncResult & { ok: boolean }>;
    },
    onSuccess: (res) => {
      setSyncResult(res);
      qc.invalidateQueries({ queryKey: ["tax-coverage-audit"] });
    },
  });

  const grand = data?.grand;
  const byType = data?.byType ?? [];
  const monthly = data?.monthly ?? [];

  const totalIssues = grand?.totalIssues ?? 0;
  const allPaid = (grand?.pending ?? 0) === 0;

  return (
    <AppShell>
      <BackButton href="/finance/workspace/tax-center" />
      <div className="space-y-6 p-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Audit Kesiapan Pajak & SPT</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Audit cakupan transaksi pajak dan kesiapan pelaporan ke Core Tax DJP
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {generateYears().map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline" size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              title="Sync dari tax_transactions (ledger otomatis) ke transaction_taxes (register SPT)"
            >
              <DatabaseZap className={cn("h-3.5 w-3.5 mr-1.5", syncMutation.isPending && "animate-pulse")} />
              {syncMutation.isPending ? "Syncing…" : "Sync dari Ledger"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Sync Result Banner */}
        {syncResult && (
          <div className={cn(
            "rounded-lg border px-4 py-3 text-sm flex items-start gap-3",
            syncResult.errors > 0 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"
          )}>
            <DatabaseZap className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">Sync selesai</span>
              {" — "}
              <span>{syncResult.total} data diproses: </span>
              <span className="font-medium">{syncResult.inserted} ditambahkan</span>
              {syncResult.skipped > 0 && <span>, {syncResult.skipped} sudah ada</span>}
              {syncResult.noTaxId > 0 && <span className="text-amber-700">, {syncResult.noTaxId} tidak ditemukan jenis pajak (akun pajak perlu dikonfigurasi)</span>}
              {syncResult.errors > 0 && <span className="text-rose-700">, {syncResult.errors} error</span>}
            </div>
            <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setSyncResult(null)}>✕</button>
          </div>
        )}

        {/* Grand Summary Cards */}
        {grand && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className={cn("border", grand.readyToReport ? "border-emerald-300 bg-emerald-50/40" : "border-amber-300 bg-amber-50/40")}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", grand.readyToReport ? "bg-emerald-100" : "bg-amber-100")}>
                  {grand.readyToReport
                    ? <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    : <AlertCircle className="h-5 w-5 text-amber-600" />
                  }
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status Tahun {year}</p>
                  <p className={cn("text-sm font-bold", grand.readyToReport ? "text-emerald-700" : "text-amber-700")}>
                    {grand.readyToReport ? "✅ Siap Lapor Core Tax" : `⚠️ ${totalIssues} masalah tersisa`}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <Receipt className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Pajak Terekam</p>
                  <p className="text-lg font-bold tabular-nums">{formatRp(grand.totalPajak)}</p>
                  <p className="text-[11px] text-muted-foreground">{grand.txCount.toLocaleString("id-ID")} transaksi · DPP {formatRp(grand.totalDpp)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100">
                  <ClipboardCheck className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status Pembayaran</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs"><span className="font-semibold text-emerald-600">{grand.paid}</span> Lunas</span>
                    <span className="text-xs"><span className="font-semibold text-blue-600">{grand.reported}</span> Dilaporkan</span>
                    <span className="text-xs"><span className={cn("font-semibold", grand.pending > 0 ? "text-amber-600" : "text-muted-foreground")}>{grand.pending}</span> Pending</span>
                  </div>
                  <StatusPill value={grand.paid + grand.reported} total={grand.totalLines} color="bg-emerald-500" />
                </div>
              </CardContent>
            </Card>

            <Card className={cn(totalIssues > 0 ? "border-rose-200 bg-rose-50/30" : "")}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", totalIssues > 0 ? "bg-rose-100" : "bg-muted")}>
                  <AlertTriangle className={cn("h-5 w-5", totalIssues > 0 ? "text-rose-600" : "text-muted-foreground")} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Masalah Dokumen</p>
                  <div className="space-y-0.5 mt-0.5">
                    <IssueChip n={grand.npwpMissing} label="NPWP kosong" />
                    <IssueChip n={grand.fakturMissing} label="Faktur kosong" />
                    <IssueChip n={grand.bukpotMissing} label="Bukpot kosong" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="monthly">
          <TabsList className="h-8 text-xs">
            <TabsTrigger value="monthly" className="text-xs">Matrix Kesiapan SPT per Bulan</TabsTrigger>
            <TabsTrigger value="bytype" className="text-xs">Cakupan per Jenis Transaksi</TabsTrigger>
            <TabsTrigger value="actions" className="text-xs">Tindakan & Ekspor</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Matrix per bulan ─────────────────────────────── */}
          <TabsContent value="monthly" className="mt-4">
            <Card>
              <CardHeader className="pb-3 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">
                  Kesiapan SPT Masa Per Bulan — {year}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Setiap bulan harus hijau semua sebelum bisa dilaporkan ke Core Tax DJP
                </p>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground px-4 py-6 text-center">Memuat data...</p>
                ) : monthly.length === 0 ? (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Tidak ada data pajak untuk tahun {year}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[11px]">
                        <TableHead className="w-16">Bulan</TableHead>
                        <TableHead className="text-right">PPN Keluaran</TableHead>
                        <TableHead className="text-right">PPN Masukan</TableHead>
                        <TableHead className="text-right">PPh</TableHead>
                        <TableHead className="text-center">NPWP</TableHead>
                        <TableHead className="text-center">Faktur</TableHead>
                        <TableHead className="text-center">Bukpot</TableHead>
                        <TableHead className="text-center">Lunas</TableHead>
                        <TableHead className="text-center">Status SPT</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthly.map((row) => {
                        const issues = Number(row.npwp_missing) + Number(row.faktur_missing) + Number(row.bukpot_missing);
                        const allLunas = Number(row.pending) === 0;
                        const ready = issues === 0 && allLunas;
                        return (
                          <TableRow key={row.period} className="text-xs">
                            <TableCell className="font-medium">{monthLabel(row.period)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatRp(Number(row.ppn_keluaran))}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatRp(Number(row.ppn_masukan))}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatRp(Number(row.pph_total))}</TableCell>
                            <TableCell className="text-center"><CheckIcon ok={Number(row.npwp_missing) === 0} /></TableCell>
                            <TableCell className="text-center"><CheckIcon ok={Number(row.faktur_missing) === 0} /></TableCell>
                            <TableCell className="text-center"><CheckIcon ok={Number(row.bukpot_missing) === 0} /></TableCell>
                            <TableCell className="text-center"><CheckIcon ok={allLunas} /></TableCell>
                            <TableCell className="text-center">
                              <ReadyBadge ready={ready} issues={issues + (allLunas ? 0 : Number(row.pending))} />
                            </TableCell>
                            <TableCell>
                              <Link href={`/tax/export-djp?period=${row.period}`}>
                                <Button variant="ghost" size="icon" className="h-6 w-6" title="Buka e-Faktur / e-Bupot">
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Core Tax info */}
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3 flex gap-2.5">
              <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-xs text-blue-800 space-y-0.5">
                <p className="font-semibold">Cara Lapor ke Core Tax DJP</p>
                <p>1. Pastikan semua kolom di atas berstatus ✅ — NPWP, Faktur, Bukti Potong terisi dan semua sudah <em>Lunas</em>.</p>
                <p>2. Unduh file <strong>e-Faktur</strong> (PPN) dan <strong>e-Bupot</strong> (PPh) dari halaman Ekspor DJP.</p>
                <p>3. Upload file tersebut ke <strong>coretax.pajak.go.id</strong> sesuai masa pajak yang bersangkutan.</p>
                <p>4. Setelah berhasil submit, ubah status transaksi menjadi <em>Dilaporkan</em> di halaman Rekonsiliasi.</p>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 2: Per jenis transaksi ─────────────────────────── */}
          <TabsContent value="bytype" className="mt-4">
            <Card>
              <CardHeader className="pb-3 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Cakupan per Jenis Transaksi — {year}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Menampilkan seluruh transaksi yang sudah masuk ke tabel pajak (<code>transaction_taxes</code>)
                </p>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground px-4 py-6 text-center">Memuat data...</p>
                ) : byType.length === 0 ? (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Tidak ada data pajak untuk tahun {year}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[11px]">
                        <TableHead>Jenis Transaksi</TableHead>
                        <TableHead className="text-right">Tx</TableHead>
                        <TableHead className="text-right">DPP</TableHead>
                        <TableHead className="text-right">Pajak</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-center">NPWP</TableHead>
                        <TableHead className="text-center">Faktur</TableHead>
                        <TableHead className="text-center">Bukpot</TableHead>
                        <TableHead className="text-center">Kelengkapan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byType.map((row) => {
                        const issues = Number(row.npwp_missing) + Number(row.faktur_missing) + Number(row.bukpot_missing);
                        const ok = issues === 0;
                        return (
                          <TableRow key={row.transaction_type} className="text-xs">
                            <TableCell className="font-medium">
                              {TX_TYPE_LABEL[row.transaction_type] ?? row.transaction_type}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{Number(row.tx_count).toLocaleString("id-ID")}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatRp(Number(row.dpp))}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{formatRp(Number(row.pajak))}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {Number(row.pending) > 0
                                ? <span className="text-amber-600 font-medium">{row.pending}</span>
                                : <span className="text-emerald-600">0</span>
                              }
                            </TableCell>
                            <TableCell className="text-center"><CheckIcon ok={Number(row.npwp_missing) === 0} /></TableCell>
                            <TableCell className="text-center"><CheckIcon ok={Number(row.faktur_missing) === 0} /></TableCell>
                            <TableCell className="text-center"><CheckIcon ok={Number(row.bukpot_missing) === 0} /></TableCell>
                            <TableCell className="text-center">
                              {ok
                                ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">✅ Lengkap</Badge>
                                : <Badge variant="outline" className="border-amber-400 text-amber-700 text-[10px]">⚠️ {issues} masalah</Badge>
                              }
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab 3: Tindakan & Ekspor ───────────────────────────── */}
          <TabsContent value="actions" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Masalah yang perlu diselesaikan */}
              <Card>
                <CardHeader className="pb-3 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Tindakan Wajib Sebelum Lapor
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2.5">
                  {grand && (
                    <>
                      <ActionItem
                        ok={grand.npwpMissing === 0}
                        label={`NPWP kosong: ${grand.npwpMissing} transaksi`}
                        desc="NPWP mitra wajib terisi untuk e-Faktur & e-Bupot"
                        href="/tax/missing-compliance"
                        linkLabel="Lengkapi NPWP"
                      />
                      <ActionItem
                        ok={grand.fakturMissing === 0}
                        label={`Nomor Faktur Pajak kosong: ${grand.fakturMissing} transaksi`}
                        desc="PPN Keluaran wajib punya nomor faktur 16 digit yang valid"
                        href="/tax/export-djp"
                        linkLabel="Autofill Faktur"
                      />
                      <ActionItem
                        ok={grand.bukpotMissing === 0}
                        label={`Bukti Potong kosong: ${grand.bukpotMissing} transaksi`}
                        desc="PPh Dipotong wajib punya nomor bukti potong"
                        href="/tax/missing-compliance"
                        linkLabel="Lengkapi Bukpot"
                      />
                      <ActionItem
                        ok={grand.pending === 0}
                        label={`Status belum Lunas: ${grand.pending} transaksi`}
                        desc="Semua pajak harus berstatus Lunas sebelum dilaporkan"
                        href="/tax/reconciliation"
                        linkLabel="Rekonsiliasi WHT"
                      />
                    </>
                  )}
                  {grand?.readyToReport && (
                    <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 font-medium">
                      ✅ Semua cek lulus — siap diekspor dan dilaporkan ke Core Tax!
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Ekspor dokumen */}
              <Card>
                <CardHeader className="pb-3 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Download className="h-4 w-4 text-blue-500" />
                    Ekspor ke Core Tax DJP
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2.5">
                  <ExportCard
                    icon={<FileText className="h-4 w-4 text-blue-600" />}
                    title="e-Faktur (SPT Masa PPN)"
                    desc="Format pipe-delimited siap upload ke coretax.pajak.go.id — PPN Keluaran & Masukan"
                    href="/tax/export-djp"
                    tag="PPN 11%"
                  />
                  <ExportCard
                    icon={<Receipt className="h-4 w-4 text-purple-600" />}
                    title="e-Bupot (PPh 21/23/4(2)/15)"
                    desc="Format CSV Bukti Potong untuk pelaporan PPh Masa"
                    href="/tax/export-djp"
                    tag="PPh Masa"
                  />
                  <ExportCard
                    icon={<ClipboardCheck className="h-4 w-4 text-emerald-600" />}
                    title="Ringkasan SPT Tahunan"
                    desc="Rekap DPP & Pajak per bulan untuk SPT Badan/Orang Pribadi"
                    href="/tax/spt"
                    tag="Tahunan"
                  />
                  <ExportCard
                    icon={<ShieldCheck className="h-4 w-4 text-amber-600" />}
                    title="Transaksi Bermasalah"
                    desc="Daftar transaksi dengan NPWP / Faktur / Bukpot belum lengkap"
                    href="/tax/missing-compliance"
                    tag="Audit"
                  />
                </CardContent>
              </Card>
            </div>

            {/* Checklist SPT */}
            <Card className="mt-4">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Checklist SPT Masa — Core Tax DJP</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {[
                    { label: "NPWP semua mitra sudah terisi dan valid (15 digit)", ok: grand ? grand.npwpMissing === 0 : null },
                    { label: "Nomor Faktur Pajak (e-Faktur) sudah terisi dan valid (16 digit)", ok: grand ? grand.fakturMissing === 0 : null },
                    { label: "Nomor Bukti Potong (e-Bupot) sudah terisi", ok: grand ? grand.bukpotMissing === 0 : null },
                    { label: "Semua transaksi pajak berstatus Lunas / Dilaporkan", ok: grand ? grand.pending === 0 : null },
                    { label: "File e-Faktur sudah didownload dan divalidasi", ok: null },
                    { label: "File e-Bupot sudah didownload dan divalidasi", ok: null },
                    { label: "Upload e-Faktur ke coretax.pajak.go.id berhasil", ok: null },
                    { label: "Upload e-Bupot ke coretax.pajak.go.id berhasil", ok: null },
                    { label: "Bukti penerimaan SPT sudah disimpan", ok: null },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-border/40 last:border-0">
                      {item.ok === true
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                        : item.ok === false
                          ? <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                          : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 shrink-0 mt-0.5" />
                      }
                      <span className={item.ok === false ? "text-rose-700" : ""}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function ActionItem({
  ok, label, desc, href, linkLabel,
}: { ok: boolean; label: string; desc: string; href: string; linkLabel: string }) {
  return (
    <div className={cn(
      "flex items-start gap-2.5 rounded-lg border p-3 text-xs",
      ok ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50",
    )}>
      <div className="shrink-0 mt-0.5">
        {ok
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          : <AlertTriangle className="h-4 w-4 text-amber-500" />
        }
      </div>
      <div className="flex-1">
        <p className={cn("font-medium", ok ? "text-emerald-800 line-through opacity-60" : "text-amber-900")}>{label}</p>
        <p className="text-muted-foreground mt-0.5">{desc}</p>
      </div>
      {!ok && (
        <Link href={href}>
          <Button variant="outline" size="sm" className="h-6 text-[11px] shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100">
            {linkLabel} <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      )}
    </div>
  );
}

function ExportCard({
  icon, title, desc, href, tag,
}: { icon: React.ReactNode; title: string; desc: string; href: string; tag: string }) {
  return (
    <Link href={href}>
      <div className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 cursor-pointer transition-colors group">
        <div className="p-1.5 rounded bg-muted shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold group-hover:underline">{title}</p>
          <p className="text-[11px] text-muted-foreground truncate">{desc}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="secondary" className="text-[10px]">{tag}</Badge>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}
