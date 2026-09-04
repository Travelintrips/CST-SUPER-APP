import { DatePicker } from "@/components/ui/date-picker";
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { QueryState } from "@/components/ui/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle, AlertTriangle, XCircle, FileText, Users, ArrowRight,
  TrendingUp, TrendingDown, Clock, Filter, RefreshCw, Activity, Trash2,
  BookOpen, Loader2, Undo2, BarChart3, ChevronDown, ChevronUp, ArrowLeft, Download,
} from "lucide-react";

const fmt = (n: number | string | undefined) =>
  Number(n || 0).toLocaleString("id-ID", { minimumFractionDigits: 0 });

function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const fmtDate = (s: string | undefined | null) =>
  s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—";

const fmtDateOnly = (s: string | undefined | null) =>
  s ? new Date(s).toLocaleDateString("id-ID") : "—";

async function api(path: string, qs?: Record<string, string>) {
  const params = qs ? "?" + new URLSearchParams(qs).toString() : "";
  const r = await fetch(`/api/bank-mutation-masters${path}${params}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request gagal");
  return j;
}

const ACTION_LABEL: Record<string, string> = {
  update_class: "Ubah Kelas",
  update_category: "Ubah Kategori",
  unpost: "Unpost Jurnal",
  update_status: "Ubah Status",
  posted: "Posting Jurnal",
  imported: "Import",
};

const ACTION_COLOR: Record<string, string> = {
  update_class: "bg-blue-100 text-blue-800",
  update_category: "bg-purple-100 text-purple-800",
  unpost: "bg-orange-100 text-orange-800",
  update_status: "bg-yellow-100 text-yellow-800",
  posted: "bg-green-100 text-green-800",
  imported: "bg-gray-100 text-gray-700",
};

function StatCard({
  title, value, sub, icon: Icon, iconColor, problem = false, href,
}: {
  title: string; value: number | string; sub?: string;
  icon: any; iconColor: string; problem?: boolean; href?: string;
}) {
  const [, navigate] = useLocation();
  const isZero = Number(value) === 0;
  const valColor = problem ? (isZero ? "text-green-600" : "text-red-600") : "text-foreground";
  return (
    <Card
      className={`transition-shadow ${href ? "cursor-pointer hover:shadow-md" : ""}`}
      onClick={() => href && navigate(href)}
    >
      <CardHeader className="pb-1 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </CardHeader>
      <CardContent className="pt-0">
        <div className={`text-2xl font-bold ${valColor}`}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        {href && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            Lihat <ArrowRight className="w-3 h-3" />
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AuditImportPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [batchToDelete, setBatchToDelete] = useState<{ id: number; filename: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [postingId, setPostingId] = useState<number | null>(null);
  const [batchToPost, setBatchToPost] = useState<{ id: number; filename: string; rowCount: number } | null>(null);
  const [unpostingId, setUnpostingId] = useState<number | null>(null);
  const [batchToUnpost, setBatchToUnpost] = useState<{ id: number; filename: string; importedCount: number } | null>(null);

  async function unpostBatch() {
    if (!batchToUnpost) return;
    const id = batchToUnpost.id;
    setBatchToUnpost(null);
    setUnpostingId(id);
    try {
      const res = await fetch(`/api/bank-mutation-import/${id}/unpost`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Gagal unpost");
      toast({
        title: "Posting dibatalkan",
        description: `Batch #${id} — ${j.reversed_journals} jurnal dihapus, status kembali ke DRAFT_IMPORT.`,
      });
      refetch();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Gagal unpost", description: err.message ?? "Terjadi kesalahan" });
    } finally {
      setUnpostingId(null);
    }
  }

  async function postBatch() {
    if (!batchToPost) return;
    const id = batchToPost.id;
    setBatchToPost(null);
    setPostingId(id);
    try {
      const res = await fetch(`/api/bank-mutation-import/${id}/post`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Gagal posting");
      toast({
        title: "Berhasil diposting ke ERP",
        description: `Batch #${id} — ${j.posted} jurnal dibuat${j.failed > 0 ? ` · ${j.failed} gagal` : ""}`,
      });
      refetch();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Gagal posting", description: err.message ?? "Terjadi kesalahan" });
    } finally {
      setPostingId(null);
    }
  }

  async function deleteBatch() {
    if (!batchToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/bank-mutation-import/${batchToDelete.id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Gagal menghapus batch");
      const extra = j.deleted_journals > 0 ? ` · ${j.deleted_journals} jurnal akuntansi ikut dihapus.` : "";
      toast({ title: "Batch dihapus", description: `Batch #${batchToDelete.id} (${batchToDelete.filename}) berhasil dihapus.${extra}` });
      setBatchToDelete(null);
      refetch();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Gagal", description: err.message ?? "Terjadi kesalahan" });
    } finally {
      setDeleting(false);
    }
  }

  const [batchMonth, setBatchMonth] = useState<string>("all");
  const [showRecap, setShowRecap] = useState(false);
  const [recapFrom, setRecapFrom] = useState("");
  const [recapTo, setRecapTo]     = useState("");
  const [companyId, setCompanyId] = useState<string>("all");
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/companies/list")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCompanies(d); })
      .catch(() => {});
  }, []);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit-summary", from, to, companyId],
    queryFn: () => {
      const qs: Record<string, string> = {};
      if (from) qs.from = from;
      if (to)   qs.to   = to;
      if (companyId !== "all") qs.company_id = companyId;
      return api("/audit-summary", qs);
    },
    refetchInterval: 60000,
  });

  const { data: recapData, isLoading: recapLoading, refetch: recapRefetch } = useQuery({
    queryKey: ["recap-by-coa", recapFrom, recapTo, companyId],
    queryFn: () => {
      const qs: Record<string, string> = {};
      if (recapFrom) qs.from = recapFrom;
      if (recapTo)   qs.to   = recapTo;
      if (companyId !== "all") qs.company_id = companyId;
      return api("/recap-by-coa", qs);
    },
    enabled: showRecap,
  });

  const counts: any    = data?.counts ?? {};
  const pendingER: number = data?.pending_entity_review ?? 0;
  const batches = useMemo<any[]>(() => data?.batches ?? [], [data?.batches]);
  const activity: any[] = data?.recent_activity ?? [];

  const batchMonthOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const b of batches) {
      if (!b.created_at) continue;
      const d = new Date(b.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!seen.has(key)) {
        seen.add(key);
        opts.push({
          value: key,
          label: d.toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
        });
      }
    }
    return opts.sort((a, b) => b.value.localeCompare(a.value));
  }, [batches]);

  const filteredBatches = useMemo(() => {
    if (batchMonth === "all") return batches;
    return batches.filter((b: any) => {
      if (!b.created_at) return false;
      const d = new Date(b.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return key === batchMonth;
    });
  }, [batches, batchMonth]);

  const totalImported    = Number(counts.total_imported    ?? 0);
  const totalNeedReview  = Number(counts.total_need_review ?? 0);
  const totalUnkEntity   = Number(counts.total_unknown_entity ?? 0);
  const totalUnkCategory = Number(counts.total_unknown_category ?? 0);
  const totalDraft       = Number(counts.total_draft ?? 0);

  const isClean = totalNeedReview === 0 && totalUnkEntity === 0 && totalUnkCategory === 0 && pendingER === 0;

  const totalCredit = Number(counts.total_credit_imported ?? 0);
  const totalDebit  = Number(counts.total_debit_imported  ?? 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <FileText className="w-6 h-6" />
          <div>
            <h1 className="text-2xl font-semibold">Audit Import Mutasi</h1>
            <p className="text-sm text-muted-foreground">
              Validasi & audit trail semua import mutasi rekening
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isClean ? (
            <Badge className="bg-green-100 text-green-800 text-sm px-3 py-1">
              <CheckCircle className="w-4 h-4 mr-1" />Semua bersih
            </Badge>
          ) : (
            <Badge className="bg-yellow-100 text-yellow-800 text-sm px-3 py-1">
              <AlertTriangle className="w-4 h-4 mr-1" />Ada item perlu ditangani
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="w-4 h-4 text-muted-foreground" />
            {companies.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Perusahaan:</span>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger className="h-8 w-52 text-sm">
                    <SelectValue placeholder="Semua perusahaan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua perusahaan</SelectItem>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Dari:</span>
              <DatePicker value={from} onChange={(v) => setFrom(v)} className="w-38 h-8 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Sampai:</span>
              <DatePicker value={to} onChange={(v) => setTo(v)} className="w-38 h-8 text-sm" />
            </div>
            {(from || to || companyId !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setCompanyId("all"); }}>
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <QueryState loading={isLoading}>{null}</QueryState>
      {!isLoading && (
        <>
          {/* Amount summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="Total Diimport" value={fmt(totalImported)} sub="transaksi" icon={CheckCircle} iconColor="text-green-600" />
            <StatCard title="Draft / Menunggu" value={totalDraft} icon={Clock} iconColor="text-gray-500" />
            <StatCard title="Total Kredit (Masuk)" value={`Rp ${fmt(totalCredit)}`} icon={TrendingUp} iconColor="text-green-600" />
            <StatCard title="Total Debit (Keluar)" value={`Rp ${fmt(totalDebit)}`} icon={TrendingDown} iconColor="text-red-600" />
          </div>

          {/* Problem stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard title="Need Review" value={totalNeedReview} icon={AlertTriangle} iconColor="text-yellow-600" problem href="/accounting/bank-mutation-import" />
            <StatCard title="Unknown Entity" value={totalUnkEntity} icon={Users} iconColor="text-orange-600" problem href="/accounting/entity-review" />
            <StatCard title="Unknown Category" value={totalUnkCategory} icon={XCircle} iconColor="text-red-600" problem href="/accounting/bank-mutation-import" />
            <StatCard title="Entity Pending Review" value={pendingER} icon={Users} iconColor="text-orange-600" problem href="/accounting/entity-review" />
          </div>

          {/* Kategori khusus */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard title="Intercompany" value={fmt(counts.total_intercompany ?? 0)} icon={ArrowRight} iconColor="text-blue-600" href="/accounting/entity-review" />
            <StatCard title="Reimbursement" value={fmt(counts.total_reimbursement ?? 0)} icon={FileText} iconColor="text-purple-600" />
            <StatCard title="Tax Payment" value={fmt(counts.total_tax_payment ?? 0)} icon={FileText} iconColor="text-indigo-600" />
          </div>

          {/* Target box */}
          <Card className={isClean ? "border-green-300 bg-green-50" : "border-yellow-300 bg-yellow-50"}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 font-medium mb-3">
                {isClean ? <CheckCircle className="w-5 h-5 text-green-600" /> : <AlertTriangle className="w-5 h-5 text-yellow-600" />}
                <span>Target Sistem</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                {[
                  { label: "UNKNOWN Entity = 0", value: totalUnkEntity },
                  { label: "NEED_REVIEW = 0",   value: totalNeedReview },
                  { label: "Unknown Category = 0", value: totalUnkCategory },
                  { label: "Entity Review Queue = 0", value: pendingER },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between bg-white rounded px-3 py-1.5 gap-2">
                    <span className="text-xs">{label}</span>
                    {value === 0 ? (
                      <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    ) : (
                      <span className="font-semibold text-red-600 shrink-0">{value}</span>
                    )}
                  </div>
                ))}
              </div>
              {counts.earliest_date && (
                <p className="text-xs text-muted-foreground mt-3">
                  Rentang data: {fmtDateOnly(counts.earliest_date)} — {fmtDateOnly(counts.latest_date)}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Batch list */}
          <div>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <h2 className="text-base font-semibold">Status per Batch Import</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Filter bulan:</span>
                <Select value={batchMonth} onValueChange={setBatchMonth}>
                  <SelectTrigger className="h-8 w-48 text-sm">
                    <SelectValue placeholder="Semua bulan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua bulan</SelectItem>
                    {batchMonthOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {batchMonth !== "all" && (
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setBatchMonth("all")}>
                    Reset
                  </Button>
                )}
                <Badge variant="secondary" className="text-xs">
                  {filteredBatches.length} batch
                </Badge>
              </div>
            </div>
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">ID</TableHead>
                    <TableHead>Filename</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">Imported</TableHead>
                    <TableHead className="text-right text-yellow-700">Need Review</TableHead>
                    <TableHead className="text-right text-red-700">Unknown Cat.</TableHead>
                    <TableHead className="text-right">Total Kredit</TableHead>
                    <TableHead className="text-right">Total Debit</TableHead>
                    <TableHead>Dibuat</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBatches.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                        {batches.length === 0 ? "Belum ada batch import" : "Tidak ada batch di bulan ini"}
                      </TableCell>
                    </TableRow>
                  ) : filteredBatches.map((b: any) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">#{b.id}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-sm" title={b.filename}>{b.filename}</TableCell>
                      <TableCell>
                        <Badge
                          variant={b.status === "IMPORTED" ? "default" : b.status === "DRAFT_IMPORT" ? "secondary" : "outline"}
                          className="text-xs"
                        >
                          {b.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{b.row_count ?? 0}</TableCell>
                      <TableCell className="text-right text-sm text-green-700">{b.imported_count ?? 0}</TableCell>
                      <TableCell className="text-right">
                        {Number(b.need_review) > 0 ? (
                          <span className="text-yellow-700 font-semibold text-sm">{b.need_review}</span>
                        ) : <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(b.unknown_category) > 0 ? (
                          <span className="text-red-700 font-semibold text-sm">{b.unknown_category}</span>
                        ) : <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />}
                      </TableCell>
                      <TableCell className="text-right text-xs text-green-700">
                        {Number(b.total_credit) > 0 ? `Rp ${fmt(b.total_credit)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-red-700">
                        {Number(b.total_debit) > 0 ? `Rp ${fmt(b.total_debit)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDateOnly(b.created_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate" title={b.created_by ?? ""}>
                        {b.created_by ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {b.status === "DRAFT_IMPORT" && Number(b.row_count) > 0 && Number(b.need_review) === 0 && Number(b.unknown_category) === 0 ? (
                            <Button
                              size="sm"
                              variant="default"
                              className="gap-1 h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                              disabled={postingId === b.id}
                              onClick={() => setBatchToPost({ id: b.id, filename: b.filename, rowCount: b.row_count })}
                            >
                              {postingId === b.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <BookOpen className="w-3 h-3" />}
                              Post ke ERP
                            </Button>
                          ) : b.status === "DRAFT_IMPORT" && (Number(b.need_review) > 0 || Number(b.unknown_category) > 0) ? (
                            <span className="text-xs text-amber-600 flex items-center gap-1 mr-1">
                              <AlertTriangle className="w-3 h-3" /> Perlu review
                            </span>
                          ) : b.status === "IMPORTED" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 h-7 text-xs text-orange-600 border-orange-300 hover:bg-orange-50"
                              disabled={unpostingId === b.id}
                              onClick={() => setBatchToUnpost({ id: b.id, filename: b.filename, importedCount: b.imported_count ?? 0 })}
                            >
                              {unpostingId === b.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Undo2 className="w-3 h-3" />}
                              Unpost
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => navigate(`/accounting/bank-mutation-import/${b.id}`)}
                          >
                            Detail
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7"
                            onClick={() => setBatchToDelete({ id: b.id, filename: b.filename })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Recent Activity */}
          {activity.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4" />
                <h2 className="text-base font-semibold">Aktivitas Terbaru</h2>
              </div>
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Waktu</TableHead>
                      <TableHead>Aksi</TableHead>
                      <TableHead>Aktor</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Sebelum</TableHead>
                      <TableHead>Sesudah</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activity.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(a.created_at)}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLOR[a.action] ?? "bg-gray-100 text-gray-700"}`}>
                            {ACTION_LABEL[a.action] ?? a.action}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs max-w-[140px] truncate" title={a.actor}>{a.actor}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate" title={a.batch_filename ?? ""}>
                          {a.batch_id ? (
                            <button
                              className="underline hover:no-underline text-left"
                              onClick={() => navigate(`/accounting/bank-mutation-import/${a.batch_id}`)}
                            >
                              #{a.batch_id} {a.batch_filename}
                            </button>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{a.field ?? "—"}</TableCell>
                        <TableCell className="text-xs text-red-700 max-w-[120px] truncate" title={a.before_val ?? ""}>{a.before_val ?? "—"}</TableCell>
                        <TableCell className="text-xs text-green-700 max-w-[120px] truncate" title={a.after_val ?? ""}>{a.after_val ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {activity.length === 0 && (
            <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Belum ada aktivitas audit tercatat. Audit trail akan muncul setelah ada perubahan pada baris import.
            </div>
          )}

          {/* ─── Rekap per COA ─── */}
          <div className="border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
              onClick={() => setShowRecap(v => !v)}
            >
              <div className="flex items-center gap-2 font-medium text-sm">
                <BarChart3 className="w-4 h-4 text-blue-600" />
                Rekap per Akun COA (dari Jurnal Posting)
              </div>
              {showRecap ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {showRecap && (
              <div className="p-4 space-y-4">
                {/* Filter tanggal rekap */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Dari:</span>
                    <DatePicker value={recapFrom} onChange={v => setRecapFrom(v)} className="w-38 h-8 text-sm" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Sampai:</span>
                    <DatePicker value={recapTo} onChange={v => setRecapTo(v)} className="w-38 h-8 text-sm" />
                  </div>
                  {(recapFrom || recapTo) && (
                    <Button variant="ghost" size="sm" onClick={() => { setRecapFrom(""); setRecapTo(""); }}>Reset</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => recapRefetch()} disabled={recapLoading}>
                    <RefreshCw className={`w-3.5 h-3.5 mr-1 ${recapLoading ? "animate-spin" : ""}`} />Refresh
                  </Button>
                </div>

                <QueryState loading={recapLoading}>{null}</QueryState>
                {!recapLoading && (
                  <>
                    {/* Per akun COA */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase">Per Akun COA</p>
                        <Button
                          variant="outline" size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={!(recapData?.by_account?.length)}
                          onClick={() => exportCSV(
                            `rekap-coa${recapFrom ? `-${recapFrom}` : ""}${recapTo ? `_${recapTo}` : ""}.csv`,
                            ["Kode Akun", "Nama Akun", "Tipe", "Jumlah Jurnal", "Total Debit", "Total Kredit", "Net (D-K)"],
                            (recapData?.by_account ?? []).map((r: any) => [
                              r.account_code, r.account_name, r.account_type,
                              r.journal_count,
                              Number(r.total_debit).toFixed(2),
                              Number(r.total_credit).toFixed(2),
                              Number(r.net).toFixed(2),
                            ])
                          )}
                        >
                          <Download className="w-3 h-3" />Export CSV
                        </Button>
                      </div>
                      <div className="border rounded overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-28">Kode</TableHead>
                              <TableHead>Nama Akun</TableHead>
                              <TableHead>Tipe</TableHead>
                              <TableHead className="text-right">Jurnal</TableHead>
                              <TableHead className="text-right text-red-700">Total Debit</TableHead>
                              <TableHead className="text-right text-green-700">Total Kredit</TableHead>
                              <TableHead className="text-right">Net (D-K)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(recapData?.by_account ?? []).length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                                  Belum ada data jurnal yang diposting
                                </TableCell>
                              </TableRow>
                            ) : (recapData?.by_account ?? []).map((row: any) => {
                              const net = Number(row.net);
                              return (
                                <TableRow key={row.account_code}>
                                  <TableCell className="font-mono text-xs">{row.account_code}</TableCell>
                                  <TableCell className="text-sm">{row.account_name}</TableCell>
                                  <TableCell><Badge variant="outline" className="text-xs">{row.account_type}</Badge></TableCell>
                                  <TableCell className="text-right text-xs text-muted-foreground">{row.journal_count}</TableCell>
                                  <TableCell className="text-right text-xs text-red-700">
                                    {Number(row.total_debit) > 0 ? `Rp ${fmt(row.total_debit)}` : "—"}
                                  </TableCell>
                                  <TableCell className="text-right text-xs text-green-700">
                                    {Number(row.total_credit) > 0 ? `Rp ${fmt(row.total_credit)}` : "—"}
                                  </TableCell>
                                  <TableCell className={`text-right text-xs font-medium ${net > 0 ? "text-red-700" : net < 0 ? "text-green-700" : "text-muted-foreground"}`}>
                                    {net !== 0 ? `Rp ${fmt(Math.abs(net))}` : "—"}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* Per Accounting Class */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase">Per Kelas Akuntansi</p>
                        <Button
                          variant="outline" size="sm"
                          className="h-7 text-xs gap-1"
                          disabled={!(recapData?.by_class?.length)}
                          onClick={() => exportCSV(
                            `rekap-class${recapFrom ? `-${recapFrom}` : ""}${recapTo ? `_${recapTo}` : ""}.csv`,
                            ["Accounting Class", "ERP Category", "Jumlah Baris", "Total Debit", "Total Kredit"],
                            (recapData?.by_class ?? []).map((r: any) => [
                              r.accounting_class, r.erp_category,
                              r.row_count,
                              Number(r.total_debit).toFixed(2),
                              Number(r.total_credit).toFixed(2),
                            ])
                          )}
                        >
                          <Download className="w-3 h-3" />Export CSV
                        </Button>
                      </div>
                      <div className="border rounded overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Accounting Class</TableHead>
                              <TableHead>ERP Category</TableHead>
                              <TableHead className="text-right">Jumlah Baris</TableHead>
                              <TableHead className="text-right text-red-700">Total Debit</TableHead>
                              <TableHead className="text-right text-green-700">Total Kredit</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(recapData?.by_class ?? []).map((row: any) => (
                              <TableRow key={`${row.accounting_class}-${row.erp_category}`}>
                                <TableCell><Badge variant="secondary" className="text-xs font-mono">{row.accounting_class}</Badge></TableCell>
                                <TableCell className="text-xs text-muted-foreground">{row.erp_category}</TableCell>
                                <TableCell className="text-right text-xs">{row.row_count}</TableCell>
                                <TableCell className="text-right text-xs text-red-700">
                                  {Number(row.total_debit) > 0 ? `Rp ${fmt(row.total_debit)}` : "—"}
                                </TableCell>
                                <TableCell className="text-right text-xs text-green-700">
                                  {Number(row.total_credit) > 0 ? `Rp ${fmt(row.total_credit)}` : "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <AlertDialog open={!!batchToUnpost} onOpenChange={(open) => { if (!open) setBatchToUnpost(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan Posting Jurnal?</AlertDialogTitle>
            <AlertDialogDescription>
              Batch <strong>#{batchToUnpost?.id}</strong> — <span className="font-mono text-xs">{batchToUnpost?.filename}</span>.<br />
              <strong>{batchToUnpost?.importedCount} jurnal akuntansi akan dihapus</strong> dan status batch kembali ke <strong>DRAFT_IMPORT</strong>.<br />
              Data batch & baris import tetap ada — kamu bisa koreksi lalu post ulang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-orange-600 hover:bg-orange-700 text-white" onClick={unpostBatch}>
              Ya, Batalkan Posting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!batchToPost} onOpenChange={(open) => { if (!open) setBatchToPost(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Konfirmasi Post ke ERP</AlertDialogTitle>
            <AlertDialogDescription>
              Batch <strong>#{batchToPost?.id}</strong> — <span className="font-mono text-xs">{batchToPost?.filename}</span> akan diposting ke jurnal akuntansi ERP (<strong>{batchToPost?.rowCount} baris</strong>). Aksi ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-green-600 hover:bg-green-700 text-white" onClick={postBatch}>
              Ya, Post Sekarang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!batchToDelete} onOpenChange={(open) => { if (!open) setBatchToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Batch Import?</AlertDialogTitle>
            <AlertDialogDescription>
              Batch <strong>#{batchToDelete?.id}</strong> — <span className="font-mono text-xs">{batchToDelete?.filename}</span> akan dihapus permanen beserta seluruh baris importnya. Aksi ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleting}
              onClick={deleteBatch}
            >
              {deleting ? "Menghapus..." : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
