import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  useListSalesDocuments,
  useDeleteSalesDocument,
  useSalesDocumentAction,
  getListSalesDocumentsQueryKey,
  getGetSalesDocumentQueryOptions,
} from "@workspace/api-client-react";
import type { SalesDocument } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePrefetchOnHover } from "@/hooks/use-prefetch-on-hover";
import { ArrowLeft, Plus, Trash2, X, Search, RefreshCw, FileText, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCompany } from "@/contexts/CompanyContext";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  confirmed: "Confirmed",
  done: "Done",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  draft:     "bg-slate-100 text-slate-700 border-slate-200",
  sent:      "bg-blue-100 text-blue-700 border-blue-200",
  confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  done:      "bg-green-100 text-green-800 border-green-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

const STAT_CARD_COLORS: Record<string, string> = {
  draft:     "text-slate-400",
  sent:      "text-blue-400",
  confirmed: "text-emerald-400",
  done:      "text-green-400",
  cancelled: "text-red-400",
};

type PaymentFilter = "all" | "unpaid" | "partial" | "paid" | "overdue";

const PAYMENT_LABELS: Record<PaymentFilter, string> = {
  all: "Semua",
  unpaid: "Belum Bayar",
  partial: "Sebagian",
  paid: "Lunas",
  overdue: "Jatuh Tempo",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`text-xs border ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700 border-gray-200"} capitalize`}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

function PaymentBadge({ status }: { status: string }) {
  if (status === "paid") return <Badge className="bg-emerald-900/50 text-emerald-300 border-emerald-700 text-xs">Lunas</Badge>;
  if (status === "partial") return <Badge className="bg-amber-900/50 text-amber-300 border-amber-700 text-xs">Sebagian</Badge>;
  if (status === "overdue") return <Badge className="bg-red-900/50 text-red-300 border-red-700 text-xs">Jatuh Tempo</Badge>;
  return <Badge variant="outline" className="text-slate-400 border-slate-600 text-xs">Belum Bayar</Badge>;
}

function isOverdue(doc: SalesDocument): boolean {
  if (!(doc as any).dueDate) return false;
  if (doc.paymentStatus === "paid") return false;
  if (doc.invoiceStatus === "none") return false;
  return new Date((doc as any).dueDate as string) < new Date(new Date().toDateString());
}

interface Props { kind?: "quote" | "order" }

const PAGE_SIZE = 50;

export default function SalesDocumentsListPage({ kind = "quote" }: Props) {
  const isQuote = kind === "quote";
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const prefetchHover = usePrefetchOnHover();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { activeCompanyId } = useCompany();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [quickViewDoc, setQuickViewDoc] = useState<SalesDocument | null>(null);

  const { data: templateCategories = [] } = useQuery<string[]>({
    queryKey: ["/api/sales/documents/template-categories", kind],
    queryFn: () =>
      fetch(`/api/sales/documents/template-categories?kind=${kind}`, { credentials: "include" })
        .then((r) => r.ok ? r.json() : []),
    staleTime: 60_000,
  });

  const deleteMut = useDeleteSalesDocument();
  const actionMut = useSalesDocumentAction();

  const apiParams = {
    kind,
    ...(activeCompanyId ? { company: activeCompanyId } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter as SalesDocument["status"] } : {}),
    ...(paymentFilter !== "all" ? { paymentStatus: paymentFilter } : {}),
    ...(categoryFilter !== "all" ? { categoryKey: categoryFilter } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    page,
    limit: PAGE_SIZE,
  };

  const { data: result, refetch } = useListSalesDocuments(apiParams as any);
  const filtered = result?.data ?? [];
  const pagination = result?.pagination;

  const handleFilterChange = (fn: () => void) => { fn(); setPage(1); setSelectedIds(new Set()); };

  const counts = {
    total: pagination?.total ?? 0,
    draft: statusFilter === "draft" ? (pagination?.total ?? 0) : 0,
    sent: statusFilter === "sent" ? (pagination?.total ?? 0) : 0,
    confirmed: statusFilter === "confirmed" ? (pagination?.total ?? 0) : 0,
    done: statusFilter === "done" ? (pagination?.total ?? 0) : 0,
    cancelled: statusFilter === "cancelled" ? (pagination?.total ?? 0) : 0,
    unpaid: paymentFilter === "unpaid" ? (pagination?.total ?? 0) : 0,
    toDeliver: 0,
  };

  const title = isQuote ? "Quotations" : "Sales Orders";
  const desc = isQuote ? "Penawaran ke pelanggan." : "Pesanan penjualan terkonfirmasi.";
  const detailBase = isQuote ? "/sales/quotations" : "/sales/orders";

  // Stat cards definition
  const statCards = isQuote
    ? [
        { label: "Total",     value: counts.total,     key: "all",       color: "text-foreground" },
        { label: "Draft",     value: counts.draft,     key: "draft",     color: STAT_CARD_COLORS.draft },
        { label: "Sent",      value: counts.sent,      key: "sent",      color: STAT_CARD_COLORS.sent },
        { label: "Confirmed", value: counts.confirmed, key: "confirmed", color: STAT_CARD_COLORS.confirmed },
      ]
    : [
        { label: "Total",      value: counts.total,     key: "all",       color: "text-foreground" },
        { label: "Draft",      value: counts.draft,     key: "draft",     color: STAT_CARD_COLORS.draft },
        { label: "Belum Bayar",value: counts.unpaid,    key: "unpaid_pay",color: "text-yellow-500" },
        { label: "Done",       value: counts.done,      key: "done",      color: STAT_CARD_COLORS.done },
      ];

  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allSelected = filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id));
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(filtered.map((d) => d.id)));

  const handleDelete = async (id: number) => {
    if (!confirm("Hapus dokumen ini? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      await deleteMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey({ kind }) });
      if (quickViewDoc?.id === id) setQuickViewDoc(null);
      toast({ title: t.common.success });
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Hapus ${selectedIds.size} dokumen terpilih?`)) return;
    setBulkDeleting(true);
    let ok = 0, fail = 0;
    for (const id of selectedIds) {
      try { await deleteMut.mutateAsync({ id }); ok++; } catch { fail++; }
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey({ kind }) });
    toast({ title: fail === 0 ? `${ok} dokumen dihapus` : `${ok} berhasil, ${fail} gagal`, variant: fail > 0 ? "destructive" : "default" });
  };

  const handleCancel = async (id: number) => {
    if (!confirm("Batalkan dokumen ini?")) return;
    try {
      await actionMut.mutateAsync({ id, data: { action: "cancel" } });
      queryClient.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey({ kind }) });
      toast({ title: t.common.success });
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    }
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      params.set("kind", kind);
      params.set("limit", "5000");
      if (activeCompanyId) params.set("company", String(activeCompanyId));
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (paymentFilter !== "all") params.set("paymentStatus", paymentFilter);
      if (categoryFilter !== "all") params.set("categoryKey", categoryFilter);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/sales/documents?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil data");
      const json = await res.json() as { data: SalesDocument[] };
      const rows = json.data;

      const headers = isQuote
        ? ["No. Dokumen", "Customer", "Status", "Valid Sampai", "Total (IDR)", "Tanggal Dibuat"]
        : ["No. Dokumen", "Customer", "Status", "Pembayaran", "Jatuh Tempo", "Total (IDR)", "Origin", "Tujuan", "Tanggal Dibuat"];

      const escape = (v: string | null | undefined) => {
        if (v == null) return "";
        const s = String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const lines = [
        headers.join(","),
        ...rows.map((d) =>
          isQuote
            ? [d.docNumber, d.customerName, STATUS_LABELS[d.status] ?? d.status,
                d.validUntil ? new Date(d.validUntil).toLocaleDateString("id-ID") : "",
                d.grandTotal != null ? String(d.grandTotal) : "",
                new Date(d.createdAt).toLocaleDateString("id-ID")]
              .map(escape).join(",")
            : [d.docNumber, d.customerName, STATUS_LABELS[d.status] ?? d.status,
                PAYMENT_LABELS[d.paymentStatus as PaymentFilter] ?? d.paymentStatus ?? "",
                d.expectedDate ? new Date(d.expectedDate).toLocaleDateString("id-ID") : "",
                d.grandTotal != null ? String(d.grandTotal) : "",
                d.origin ?? "", d.destination ?? "",
                new Date(d.createdAt).toLocaleDateString("id-ID")]
              .map(escape).join(",")
        ),
      ];

      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${isQuote ? "quotations" : "sales-orders"}-${ts}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export gagal", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const colCount = isQuote ? 7 : 10;

  return (
    <AppShell>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <Link href="/sales"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6" /> {title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{desc}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={isExporting}
              className="gap-2"
              title={`Export ${isQuote ? "quotations" : "sales orders"} ke CSV`}
            >
              <Download className="h-4 w-4" />
              {isExporting ? "Mengexport..." : "Export CSV"}
            </Button>
            {isQuote && (
              <Button onClick={() => navigate("/sales/quotations/new")} data-testid="button-new-quote">
                <Plus className="mr-2 h-4 w-4" /> New Quotation
              </Button>
            )}
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map((s) => (
            <Card
              key={s.key}
              className={`cursor-pointer hover:border-primary transition-colors ${
                (statusFilter === s.key || (s.key === "all" && statusFilter === "all") ||
                 (s.key === "unpaid_pay" && paymentFilter === "unpaid" && statusFilter === "all"))
                  ? "border-primary bg-primary/5" : ""
              }`}
              onClick={() => {
                if (s.key === "unpaid_pay") {
                  handleFilterChange(() => { setStatusFilter("all"); setPaymentFilter(paymentFilter === "unpaid" ? "all" : "unpaid"); });
                } else {
                  handleFilterChange(() => { setPaymentFilter("all"); setStatusFilter(s.key === statusFilter ? "all" : s.key); });
                }
              }}
            >
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search + Status Filter row */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Cari nomor ${isQuote ? "penawaran" : "order"}, customer...`}
              className={`pl-9 ${search ? "pr-9" : ""}`}
              value={search}
              onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
            />
            {search && (
              <button
                onClick={() => handleFilterChange(() => setSearch(""))}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                aria-label="Hapus pencarian"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={(v) => handleFilterChange(() => { setStatusFilter(v); setPaymentFilter("all"); })}>
            <SelectTrigger className="w-44" data-testid="status-filter">
              <SelectValue placeholder="Semua Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {templateCategories.length > 0 && (
            <Select value={categoryFilter} onValueChange={(v) => handleFilterChange(() => setCategoryFilter(v))}>
              <SelectTrigger className="w-52" data-testid="category-filter">
                <SelectValue placeholder="Semua Komoditi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Komoditi</SelectItem>
                {templateCategories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Payment filter chips — orders only */}
        {!isQuote && (
          <div className="flex flex-wrap gap-2" data-testid="payment-status-filter">
            {(Object.keys(PAYMENT_LABELS) as PaymentFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => handleFilterChange(() => { setPaymentFilter(f); if (f !== "all") setStatusFilter("all"); })}
                data-testid={`filter-payment-${f}`}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  paymentFilter === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                }`}
              >
                {PAYMENT_LABELS[f]}
                {f !== "all" && paymentFilter === f && (
                  <span className="ml-1.5 opacity-70">{pagination?.total ?? 0}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-lg">
            <span className="text-sm font-medium">{selectedIds.size} dipilih</span>
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {bulkDeleting ? "Menghapus..." : "Hapus Terpilih"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Batal</Button>
          </div>
        )}

        {/* Table Card */}
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm text-muted-foreground">
              {pagination ? `${pagination.total} ` : ""}{isQuote ? "penawaran" : "order"}
              {statusFilter !== "all" ? ` · ${STATUS_LABELS[statusFilter] ?? statusFilter}` : ""}
              {!isQuote && paymentFilter !== "all" ? ` · ${PAYMENT_LABELS[paymentFilter]}` : ""}
              {categoryFilter !== "all" ? ` · ${categoryFilter}` : ""}
              {search ? ` · "${search}"` : ""}
              {pagination && pagination.totalPages > 1 ? ` · hal. ${pagination.page}/${pagination.totalPages}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    {filtered.length > 0 && (
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Pilih semua" />
                    )}
                  </TableHead>
                  <TableHead>No.</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  {!isQuote && <TableHead>Invoice</TableHead>}
                  {!isQuote && <TableHead>Pengiriman</TableHead>}
                  {!isQuote && <TableHead>Bayar</TableHead>}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Tanggal</TableHead>
                  <TableHead className="w-16 pr-4"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow
                    key={d.id}
                    className="cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => setQuickViewDoc(d)}
                    data-testid={`row-doc-${d.id}`}
                    {...prefetchHover(getGetSalesDocumentQueryOptions(d.id))}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(d.id)}
                        onCheckedChange={() => toggleSelect(d.id)}
                        aria-label={`Pilih ${d.docNumber}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm font-semibold">
                      <div className="flex items-center gap-2">
                        {d.docNumber}
                        {!isQuote && isOverdue(d) && (
                          <Badge className="bg-red-900/50 text-red-300 border-red-700 text-xs" data-testid="badge-overdue">Jatuh Tempo</Badge>
                        )}
                        {d.aiGenerated && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 border border-violet-200">🤖 AI</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{d.customerName}</TableCell>
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    {!isQuote && (
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{d.invoiceStatus.replace("_", " ")}</Badge>
                      </TableCell>
                    )}
                    {!isQuote && (
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{d.deliveryStatus.replace("_", " ")}</Badge>
                      </TableCell>
                    )}
                    {!isQuote && <TableCell><PaymentBadge status={d.paymentStatus} /></TableCell>}
                    <TableCell className="text-right font-semibold">{idr(Number(d.grandTotal ?? d.totalAmount))}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {new Date(d.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                    </TableCell>
                    <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                      {d.status !== "draft" && d.status !== "cancelled" && d.status !== "done" && (
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          title="Batalkan"
                          onClick={() => handleCancel(d.id)}
                          data-testid={`btn-cancel-${d.id}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Hapus"
                        onClick={() => handleDelete(d.id)}
                        data-testid={`btn-delete-${d.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colCount} className="text-center text-muted-foreground py-12">
                      <FileText className="w-10 h-10 mx-auto mb-2 opacity-20" />
                      <p>
                        {search
                          ? `Tidak ada hasil untuk "${search}"`
                          : statusFilter !== "all"
                            ? `Tidak ada dokumen dengan status ${STATUS_LABELS[statusFilter] ?? statusFilter}`
                            : paymentFilter !== "all"
                              ? `Tidak ada order dengan pembayaran ${PAYMENT_LABELS[paymentFilter]}`
                              : `Belum ada ${isQuote ? "penawaran" : "sales order"}`}
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>

          {/* Pagination controls */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} dari {pagination.total}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline" size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs px-2">{pagination.page} / {pagination.totalPages}</span>
                <Button
                  variant="outline" size="sm"
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Quick View Dialog */}
      {quickViewDoc && (
        <Dialog open onOpenChange={() => setQuickViewDoc(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono">
                <FileText className="h-4 w-4 shrink-0" />
                {quickViewDoc.docNumber}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
                <QRow label="Customer" value={quickViewDoc.customerName} />
                <QRow label="Status">
                  <StatusBadge status={quickViewDoc.status} />
                </QRow>
                {!isQuote && (
                  <QRow label="Pembayaran">
                    <PaymentBadge status={quickViewDoc.paymentStatus} />
                  </QRow>
                )}
                {quickViewDoc.origin && quickViewDoc.destination && (
                  <QRow label="Rute" value={`${quickViewDoc.origin} → ${quickViewDoc.destination}`} />
                )}
                {quickViewDoc.transportMode && (
                  <QRow label="Moda" value={quickViewDoc.transportMode} />
                )}
                {quickViewDoc.validUntil && isQuote && (
                  <QRow label="Berlaku s/d" value={new Date(quickViewDoc.validUntil).toLocaleDateString("id-ID")} />
                )}
                {quickViewDoc.expectedDate && !isQuote && (
                  <QRow label="Jatuh Tempo" value={new Date(quickViewDoc.expectedDate).toLocaleDateString("id-ID")} />
                )}
                {quickViewDoc.notes && (
                  <QRow label="Catatan" value={quickViewDoc.notes} />
                )}
                <div className="border-t pt-2 mt-1">
                  <QRow label="Total">
                    <span className="font-bold text-base text-primary">
                      {idr(Number(quickViewDoc.grandTotal ?? quickViewDoc.totalAmount))}
                    </span>
                  </QRow>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Dibuat: {new Date(quickViewDoc.createdAt).toLocaleString("id-ID")}
              </p>
            </div>

            <DialogFooter className="gap-2">
              {quickViewDoc.status !== "draft" && quickViewDoc.status !== "cancelled" && quickViewDoc.status !== "done" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => { handleCancel(quickViewDoc.id); setQuickViewDoc(null); }}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Batalkan
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={() => { void handleDelete(quickViewDoc.id); }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Hapus
              </Button>
              <Button
                onClick={() => { setQuickViewDoc(null); navigate(`${detailBase}/${quickViewDoc.id}`); }}
              >
                Buka Detail →
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}

function QRow({
  label,
  value,
  children,
}: { label: string; value?: string | null; children?: React.ReactNode }) {
  if (!value && !children) return null;
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium">{children ?? value}</span>
    </div>
  );
}
