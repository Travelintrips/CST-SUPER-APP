import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Clock, RefreshCw, Upload, Zap, AlertTriangle, History, ArrowLeft } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { BackButton } from "@/components/ui/back-button";

const API = "/api/accounting";

type ModuleFilter = "all" | "sport_center" | "tenant" | "logistics";

interface BulkFailedRow {
  sourceDocId: number;
  companyId: number;
  error: string;
}

interface BulkModuleResult {
  total: number;
  posted: number;
  skipped: number;
  errors: number;
  failedRows: BulkFailedRow[];
}

interface PaymentRow {
  module: string;
  source_id: number;
  ref: string | null;
  partner_name: string | null;
  amount: string | number;
  method: string;
  payment_status: string;
  posting_status: string;
  accounting_payment_id: number | null;
  paid_at: string | null;
  created_at: string;
}

interface MonitorData {
  rows: PaymentRow[];
  summary: { total: number; posted: number; unposted: number };
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtAmt(n: string | number) {
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(Number(n ?? 0));
}

const MODULE_LABELS: Record<string, string> = {
  sport_center: "Sport Center",
  tenant: "Tenant",
  logistics: "Logistik",
};

function PostingStatusBadge({ status }: { status: string }) {
  if (status === "posted") {
    return (
      <Badge className="bg-green-100 text-green-800 border border-green-300 gap-1">
        <CheckCircle className="w-3 h-3" /> Posted
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge className="bg-red-100 text-red-800 border border-red-300 gap-1">
        <AlertTriangle className="w-3 h-3" /> Error
      </Badge>
    );
  }
  return (
    <Badge className="bg-yellow-100 text-yellow-800 border border-yellow-300 gap-1">
      <Clock className="w-3 h-3" /> Belum Diposting
    </Badge>
  );
}

function ModuleBadge({ module }: { module: string }) {
  const colors: Record<string, string> = {
    sport_center: "bg-blue-100 text-blue-700",
    tenant: "bg-purple-100 text-purple-700",
    logistics: "bg-orange-100 text-orange-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[module] ?? "bg-gray-100 text-gray-700"}`}>
      {MODULE_LABELS[module] ?? module}
    </span>
  );
}

export default function PostingMonitorPage() {
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
  const [postingRow, setPostingRow] = useState<number | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<MonitorData>({
    queryKey: ["posting-monitor", activeCompanyId, moduleFilter],
    queryFn: () =>
      fetch(`${API}/posting-monitor?module=${moduleFilter}&limit=200${activeCompanyId ? `&company_id=${activeCompanyId}` : ""}`, {
        credentials: "include",
      }).then((r) => r.json()),
    enabled: true,
    refetchInterval: 60_000,
  });

  const postOne = useMutation({
    mutationFn: ({ moduleType, sourceDocId }: { moduleType: string; sourceDocId: number }) =>
      fetch(`${API}/posting-monitor/post`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleType, sourceDocId }),
      }).then((r) => r.json()),
    onMutate: ({ sourceDocId }) => setPostingRow(sourceDocId),
    onSettled: () => {
      setPostingRow(null);
      qc.invalidateQueries({ queryKey: ["posting-monitor"] });
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast({ title: result.alreadyPosted ? "Sudah posted sebelumnya" : "Berhasil diposting ke akuntansi" });
      } else {
        toast({ title: "Gagal posting", description: result.error, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Gagal posting", variant: "destructive" }),
  });

  const [bulkResult, setBulkResult] = useState<{ totals: { posted: number; skipped: number; errors: number }; failedRows: BulkFailedRow[] } | null>(null);

  const bulkPost = useMutation({
    mutationFn: (moduleType: string) =>
      fetch(`${API}/posting-monitor/bulk`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleType }),
      }).then((r) => r.json()),
    onSettled: () => qc.invalidateQueries({ queryKey: ["posting-monitor"] }),
    onSuccess: (result) => {
      if (result.ok) {
        const moduleResults = result.results as Record<string, BulkModuleResult>;
        const totals = Object.values(moduleResults)
          .reduce((a, b) => ({ posted: a.posted + b.posted, skipped: a.skipped + b.skipped, errors: a.errors + b.errors }), { posted: 0, skipped: 0, errors: 0 });
        const failedRows: BulkFailedRow[] = Object.values(moduleResults).flatMap((m) => m.failedRows ?? []);
        setBulkResult({ totals, failedRows });
        toast({ title: `Bulk posting selesai: ${totals.posted} diposting, ${totals.skipped} sudah ada, ${totals.errors} error` });
      } else {
        toast({ title: "Gagal bulk posting", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Gagal bulk posting", variant: "destructive" }),
  });

  const [backfillResult, setBackfillResult] = useState<{ total: number; posted: number; skipped: number; errors: number; detail?: { invoice_number: string; status: string }[] } | null>(null);

  const backfillTenant = useMutation({
    mutationFn: () =>
      fetch(`${API}/hub/backfill-tenant`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: activeCompanyId }),
      }).then((r) => r.json()),
    onSuccess: (result) => {
      if (result.ok) {
        setBackfillResult(result);
        qc.invalidateQueries({ queryKey: ["posting-monitor"] });
        toast({
          title: `Backfill selesai`,
          description: `${result.posted} diposting, ${result.skipped} sudah ada, ${result.errors} error`,
        });
      } else {
        toast({ title: "Backfill gagal", description: result.error, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Backfill gagal", variant: "destructive" }),
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? { total: 0, posted: 0, unposted: 0 };
  const unpostedRows = rows.filter((r) => r.posting_status !== "posted");
  const postedRows = rows.filter((r) => r.posting_status === "posted");

  return (
    <AppShell>
      <BackButton href="/accounting" />
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Posting Monitor</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor dan posting pembayaran modul (Sport Center, Tenant, Logistik) ke jurnal akuntansi
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => bulkPost.mutate(moduleFilter)}
              disabled={bulkPost.isPending || unpostedRows.length === 0}
              className="gap-1"
            >
              <Zap className="w-4 h-4" />
              Bulk Post {unpostedRows.length > 0 ? `(${unpostedRows.length})` : ""}
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-gray-50 border-0">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-gray-800">{isLoading ? "…" : summary.total}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Total Pembayaran</div>
            </CardContent>
          </Card>
          <Card className="bg-green-50 border-0">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-green-700">{isLoading ? "…" : summary.posted}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Sudah Diposting</div>
            </CardContent>
          </Card>
          <Card className="bg-yellow-50 border-0">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-yellow-700">{isLoading ? "…" : summary.unposted}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Belum Diposting</div>
            </CardContent>
          </Card>
        </div>

        {summary.unposted > 0 && (
          <Alert className="border-yellow-300 bg-yellow-50">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800 text-sm">
              <strong>{summary.unposted} pembayaran</strong> belum diposting ke jurnal akuntansi.
              Gunakan tombol <strong>Bulk Post</strong> untuk memposting semua sekaligus, atau klik <strong>Post</strong> per baris.
            </AlertDescription>
          </Alert>
        )}

        {bulkResult && bulkResult.failedRows.length > 0 && (
          <Alert className="border-red-300 bg-red-50">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800 text-sm space-y-2">
              <div>
                <strong>{bulkResult.failedRows.length} baris gagal diposting</strong> pada batch terakhir.
                Periksa konfigurasi jurnal atau akun COA untuk ID berikut:
              </div>
              <div className="max-h-40 overflow-y-auto rounded border border-red-200 bg-white text-xs divide-y font-mono">
                {bulkResult.failedRows.map((row, i) => (
                  <div key={i} className="flex items-start gap-3 px-2 py-1.5">
                    <span className="text-red-700 shrink-0">
                      ID {row.sourceDocId} · Perusahaan {row.companyId}
                    </span>
                    <span className="text-gray-500 truncate">{row.error}</span>
                  </div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Filter */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Filter Modul:</span>
          <Select value={moduleFilter} onValueChange={(v) => setModuleFilter(v as ModuleFilter)}>
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Modul</SelectItem>
              <SelectItem value="sport_center">Sport Center</SelectItem>
              <SelectItem value="tenant">Tenant</SelectItem>
              <SelectItem value="logistics">Logistik</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ── Backfill Invoice Tenant ─────────────────────────────────── */}
        <Card className="border-dashed border-blue-300 bg-blue-50/40">
          <CardHeader className="py-3 px-4 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <History className="w-4 h-4 text-blue-600" />
                  Backfill Jurnal dari Invoice Tenant
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Posting akuntansi untuk invoice yang sudah dibayar (paid/partial) tapi belum punya jurnal.
                  Aman dijalankan berkali-kali — proses idempoten, tidak akan duplikasi.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-blue-400 text-blue-700 hover:bg-blue-100 shrink-0"
                onClick={() => backfillTenant.mutate()}
                disabled={backfillTenant.isPending}
              >
                {backfillTenant.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <History className="w-3.5 h-3.5" />
                )}
                {backfillTenant.isPending ? "Memproses…" : "Jalankan Backfill"}
              </Button>
            </div>
          </CardHeader>
          {backfillResult && (
            <CardContent className="pt-0 px-4 pb-3">
              <div className="flex gap-4 mt-1">
                <span className="text-xs text-muted-foreground">Total: <strong>{backfillResult.total}</strong></span>
                <span className="text-xs text-green-700">Diposting: <strong>{backfillResult.posted}</strong></span>
                <span className="text-xs text-gray-500">Sudah ada: <strong>{backfillResult.skipped}</strong></span>
                {backfillResult.errors > 0 && (
                  <span className="text-xs text-red-600">Error: <strong>{backfillResult.errors}</strong></span>
                )}
              </div>
              {backfillResult.detail && backfillResult.detail.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto rounded border border-blue-200 bg-white text-xs divide-y">
                  {backfillResult.detail.map((d, i) => (
                    <div key={i} className="flex items-center justify-between px-2 py-1">
                      <span className="font-mono text-gray-700">{d.invoice_number}</span>
                      <span className={d.status === "posted" ? "text-green-600 font-medium" : d.status.includes("error") ? "text-red-500" : "text-gray-400"}>
                        {d.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <Tabs defaultValue="unposted">
          <TabsList>
            <TabsTrigger value="unposted">
              Belum Diposting
              {unpostedRows.length > 0 && (
                <span className="ml-1.5 bg-yellow-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {unpostedRows.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="posted">
              Sudah Diposting
              {postedRows.length > 0 && (
                <span className="ml-1.5 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {postedRows.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="unposted">
            <Card>
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm font-semibold text-muted-foreground">
                  Pembayaran Belum Diposting ke Akuntansi
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Memuat data…</div>
                ) : unpostedRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
                    <CheckCircle className="w-8 h-8 text-green-400" />
                    Semua pembayaran sudah diposting ke akuntansi
                  </div>
                ) : (
                  <PaymentTable
                    rows={unpostedRows}
                    postingRow={postingRow}
                    onPost={(moduleType, sourceDocId) => postOne.mutate({ moduleType, sourceDocId })}
                    isPending={postOne.isPending}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="posted">
            <Card>
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm font-semibold text-muted-foreground">
                  Riwayat Pembayaran Sudah Diposting
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Memuat data…</div>
                ) : postedRows.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">Belum ada pembayaran yang diposting</div>
                ) : (
                  <PaymentTable rows={postedRows} postingRow={null} onPost={() => {}} isPending={false} showAction={false} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function PaymentTable({
  rows,
  postingRow,
  onPost,
  isPending,
  showAction = true,
}: {
  rows: PaymentRow[];
  postingRow: number | null;
  onPost: (moduleType: string, sourceDocId: number) => void;
  isPending: boolean;
  showAction?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="text-xs">Modul</TableHead>
            <TableHead className="text-xs">Ref. Pembayaran</TableHead>
            <TableHead className="text-xs">Mitra</TableHead>
            <TableHead className="text-xs text-right">Jumlah (Rp)</TableHead>
            <TableHead className="text-xs">Metode</TableHead>
            <TableHead className="text-xs">Status Posting</TableHead>
            <TableHead className="text-xs">ID Akuntansi</TableHead>
            <TableHead className="text-xs">Dibayar</TableHead>
            {showAction && <TableHead className="text-xs text-center">Aksi</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.module}-${row.source_id}`} className="hover:bg-muted/20">
              <TableCell className="py-2">
                <ModuleBadge module={row.module} />
              </TableCell>
              <TableCell className="py-2 text-xs font-mono">{row.ref ?? "—"}</TableCell>
              <TableCell className="py-2 text-xs max-w-[160px] truncate">{row.partner_name ?? "—"}</TableCell>
              <TableCell className="py-2 text-xs text-right font-medium">
                {fmtAmt(row.amount)}
              </TableCell>
              <TableCell className="py-2 text-xs capitalize">{row.method}</TableCell>
              <TableCell className="py-2">
                <PostingStatusBadge status={row.posting_status} />
              </TableCell>
              <TableCell className="py-2 text-xs text-muted-foreground">
                {row.accounting_payment_id ? `#${row.accounting_payment_id}` : "—"}
              </TableCell>
              <TableCell className="py-2 text-xs text-muted-foreground">{fmtDate(row.paid_at)}</TableCell>
              {showAction && (
                <TableCell className="py-2 text-center">
                  {row.posting_status !== "posted" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      disabled={isPending && postingRow === row.source_id}
                      onClick={() => onPost(row.module, row.source_id)}
                    >
                      {isPending && postingRow === row.source_id ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Upload className="w-3 h-3" />
                      )}
                      Post
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
