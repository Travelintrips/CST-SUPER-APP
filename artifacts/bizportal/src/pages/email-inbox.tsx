import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import {
  useListEmailCorrespondences,
  useGetEmailCorrespondence,
  useValidateEmailCorrespondenceStatus,
  useCreateEmailLink,
  useValidateEmailLink,
  useDeleteEmailLink,
  useListSalesDocuments,
  useListPurchaseDocuments,
  useListExpenses,
  useListPayments,
  useListFreightShipments,
  useSyncCorrespondencesImap,
  useDeleteEmailCorrespondence,
  getListEmailCorrespondencesQueryKey,
  getGetEmailCorrespondenceQueryKey,
  getListSalesDocumentsQueryKey,
  getListPurchaseDocumentsQueryKey,
  getListExpensesQueryKey,
  getListPaymentsQueryKey,
  getListFreightShipmentsQueryKey,
  type EmailCorrespondence,
  type EmailLink,
  type EmailAttachment,
} from "@workspace/api-client-react";
import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Mail, Search, RefreshCw, Loader2, ShieldCheck, XCircle, Archive,
  Link2, Paperclip, CheckCircle2, Trash2, Download, FileImage, Filter, CalendarDays,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  linked: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  validated: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  archived: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  new: "Baru", linked: "Ditautkan", validated: "Divalidasi",
  rejected: "Ditolak", archived: "Diarsipkan",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  sales_order: "Sales Order",
  purchase_order: "Purchase Order",
  invoice: "Invoice",
  expense: "Biaya (Expense)",
  payment: "Pembayaran (Payment)",
  shipment: "Pengiriman / Job",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? STATUS_COLORS["new"]}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function resolveFileUrl(fileUrl: string) {
  if (!fileUrl) return null;
  if (fileUrl.startsWith("/objects/")) return `/api/storage${fileUrl}`;
  if (fileUrl.startsWith("/api/")) return fileUrl;
  return fileUrl;
}

function isImage(mimeType?: string | null, fileName?: string) {
  if (mimeType?.startsWith("image/")) return true;
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext ?? "");
  }
  return false;
}

// Transaction picker component — shows a list of real records for a given doc type
function TransactionList({
  docType,
  selectedId,
  onSelect,
  searchQ,
}: {
  docType: string;
  selectedId: number | null;
  onSelect: (id: number, label: string) => void;
  searchQ: string;
}) {
  const soParams = useMemo(() => ({ kind: "order" as const }), []);
  const poParams = useMemo(() => ({ kind: "order" as const }), []);

  const { data: _salesDocsPaginated, isLoading: soLoading } = useListSalesDocuments(
    { ...soParams, limit: 500 },
    { query: { enabled: docType === "sales_order", queryKey: getListSalesDocumentsQueryKey(soParams) } }
  );
  const salesDocs = _salesDocsPaginated?.data ?? [];
  const invoiceParams = useMemo(() => ({}), []);
  const { data: _invoiceDocsPaginated, isLoading: invLoading } = useListSalesDocuments(
    { ...invoiceParams, limit: 500 },
    { query: { enabled: docType === "invoice", queryKey: getListSalesDocumentsQueryKey(invoiceParams) } }
  );
  const invoiceDocs = _invoiceDocsPaginated?.data ?? [];
  const { data: purchaseDocs = [], isLoading: poLoading } = useListPurchaseDocuments(
    poParams,
    { query: { enabled: docType === "purchase_order", queryKey: getListPurchaseDocumentsQueryKey(poParams) } }
  );
  const expParams = useMemo(() => ({}), []);
  const { data: expenses = [], isLoading: expLoading } = useListExpenses(
    expParams,
    { query: { enabled: docType === "expense", queryKey: getListExpensesQueryKey(expParams) } }
  );
  const { data: payments = [], isLoading: payLoading } = useListPayments(
    { query: { enabled: docType === "payment", queryKey: getListPaymentsQueryKey() } }
  );
  const shipParams = useMemo(() => ({}), []);
  const { data: shipments = [], isLoading: shipLoading } = useListFreightShipments(
    shipParams,
    { query: { enabled: docType === "shipment", queryKey: getListFreightShipmentsQueryKey(shipParams) } }
  );

  const q = searchQ.toLowerCase();

  if (docType === "sales_order") {
    if (soLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-4" />;
    const filtered = salesDocs.filter((d) =>
      !q || d.docNumber.toLowerCase().includes(q) || (d.customerName ?? "").toLowerCase().includes(q)
    );
    return (
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Tidak ada data</p>}
        {filtered.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id, `SO #${d.docNumber} — ${d.customerName ?? ""}`)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${selectedId === d.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
          >
            <span className="font-medium">{d.docNumber}</span>
            <span className="text-muted-foreground ml-2">{d.customerName ?? ""}</span>
            <Badge variant="outline" className="ml-2 text-xs">{d.status}</Badge>
          </button>
        ))}
      </div>
    );
  }

  if (docType === "invoice") {
    if (invLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-4" />;
    const filtered = invoiceDocs.filter((d) =>
      !q || d.docNumber.toLowerCase().includes(q) || (d.customerName ?? "").toLowerCase().includes(q)
    );
    return (
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Tidak ada data</p>}
        {filtered.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id, `INV #${d.docNumber} — ${d.customerName ?? ""}`)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${selectedId === d.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
          >
            <span className="font-medium">{d.docNumber}</span>
            <span className="text-muted-foreground ml-2">{d.customerName ?? ""}</span>
            <Badge variant="outline" className="ml-2 text-xs">{d.invoiceStatus}</Badge>
          </button>
        ))}
      </div>
    );
  }

  if (docType === "purchase_order") {
    if (poLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-4" />;
    const filtered = purchaseDocs.filter((d) =>
      !q || d.docNumber.toLowerCase().includes(q) || (d.supplierName ?? "").toLowerCase().includes(q)
    );
    return (
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Tidak ada data</p>}
        {filtered.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id, `PO #${d.docNumber} — ${d.supplierName ?? ""}`)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${selectedId === d.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
          >
            <span className="font-medium">{d.docNumber}</span>
            <span className="text-muted-foreground ml-2">{d.supplierName ?? ""}</span>
            <Badge variant="outline" className="ml-2 text-xs">{d.status}</Badge>
          </button>
        ))}
      </div>
    );
  }

  if (docType === "expense") {
    if (expLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-4" />;
    const filtered = expenses.filter((d) =>
      !q || d.expenseNumber.toLowerCase().includes(q) || (d.description ?? "").toLowerCase().includes(q)
    );
    return (
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Tidak ada data</p>}
        {filtered.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id, `EXP #${d.expenseNumber}${d.description ? " — " + d.description : ""}`)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${selectedId === d.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
          >
            <span className="font-medium">{d.expenseNumber}</span>
            {d.description && <span className="text-muted-foreground ml-2 truncate">{d.description}</span>}
            <Badge variant="outline" className="ml-2 text-xs">{d.status}</Badge>
          </button>
        ))}
      </div>
    );
  }

  if (docType === "payment") {
    if (payLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-4" />;
    const filtered = (payments as any[]).filter((d: any) =>
      !q || String(d.id).includes(q) || (d.reference ?? "").toLowerCase().includes(q) || (d.partyName ?? "").toLowerCase().includes(q)
    );
    return (
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Tidak ada data</p>}
        {filtered.map((d: any) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id, `PAY #${d.id}${d.reference ? " — " + d.reference : ""}${d.partyName ? " — " + d.partyName : ""}`)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${selectedId === d.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
          >
            <span className="font-medium">#{d.id}</span>
            {d.reference && <span className="text-muted-foreground ml-2">{d.reference}</span>}
            {d.partyName && <span className="text-muted-foreground ml-2">{d.partyName}</span>}
          </button>
        ))}
      </div>
    );
  }

  if (docType === "shipment") {
    if (shipLoading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-4" />;
    const filtered = (shipments as any[]).filter((d: any) =>
      !q || (d.jobNumber ?? String(d.id)).toLowerCase().includes(q) || (d.customerName ?? "").toLowerCase().includes(q)
    );
    return (
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Tidak ada data</p>}
        {filtered.map((d: any) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id, `JOB #${d.jobNumber ?? d.id}${d.customerName ? " — " + d.customerName : ""}`)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${selectedId === d.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}
          >
            <span className="font-medium">{d.jobNumber ?? `#${d.id}`}</span>
            {d.customerName && <span className="text-muted-foreground ml-2">{d.customerName}</span>}
            {d.status && <Badge variant="outline" className="ml-2 text-xs">{d.status}</Badge>}
          </button>
        ))}
      </div>
    );
  }

  return null;
}

export default function EmailInboxPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const search = useSearch();
  const [, setLocation] = useLocation();

  const [searchQ, setSearchQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("__all__");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterLinkedType, setFilterLinkedType] = useState("__all__");
  const [filterIsValidated, setFilterIsValidated] = useState("__all__");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Auto-open email from URL param: /email-inbox?emailId=123
  useEffect(() => {
    const params = new URLSearchParams(search);
    const emailId = params.get("emailId");
    if (emailId) {
      const id = parseInt(emailId, 10);
      if (!isNaN(id)) {
        setSelectedId(id);
        setDetailOpen(true);
        // Clean up URL param without reload
        setLocation("/email-inbox", { replace: true });
      }
    }
  }, [search, setLocation]);

  // Link dialog state
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDocType, setLinkDocType] = useState("sales_order");
  const [linkSearchQ, setLinkSearchQ] = useState("");
  const [linkSelectedId, setLinkSelectedId] = useState<number | null>(null);
  const [linkSelectedLabel, setLinkSelectedLabel] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [linkNotes, setLinkNotes] = useState("");

  const queryParams = useMemo(() => ({
    ...(searchQ.trim() ? { q: searchQ.trim() } : {}),
    ...(filterStatus !== "__all__" ? { status: filterStatus as any } : {}),
    ...(filterFrom.trim() ? { from: filterFrom.trim() } : {}),
    ...(filterSubject.trim() ? { subject: filterSubject.trim() } : {}),
    ...(filterDateFrom ? { dateFrom: filterDateFrom } : {}),
    ...(filterDateTo ? { dateTo: filterDateTo } : {}),
    ...(filterLinkedType !== "__all__" ? { linkedType: filterLinkedType } : {}),
    ...(filterIsValidated !== "__all__" ? { isValidated: filterIsValidated as any } : {}),
  }), [searchQ, filterStatus, filterFrom, filterSubject, filterDateFrom, filterDateTo, filterLinkedType, filterIsValidated]);

  const { data: emails = [], isLoading } = useListEmailCorrespondences(queryParams, {
    query: { queryKey: getListEmailCorrespondencesQueryKey(queryParams) },
  });

  const { data: detail, isLoading: detailLoading } = useGetEmailCorrespondence(
    selectedId ?? 0,
    {
      query: {
        enabled: selectedId !== null,
        queryKey: getGetEmailCorrespondenceQueryKey(selectedId ?? 0),
      },
    }
  );

  const validateStatus = useValidateEmailCorrespondenceStatus();
  const createLink = useCreateEmailLink();
  const validateLink = useValidateEmailLink();
  const deleteLink = useDeleteEmailLink();
  const deleteEmail = useDeleteEmailCorrespondence();
  const syncImap = useSyncCorrespondencesImap();

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const allIds = useMemo(() => emails.map((e) => e.id), [emails]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  function toggleSelect(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll(e: React.MouseEvent) {
    e.stopPropagation();
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  }

  async function handleBulkDelete() {
    setIsBulkDeleting(true);
    const ids = Array.from(selectedIds);
    let successCount = 0;
    for (const id of ids) {
      await new Promise<void>((resolve) => {
        deleteEmail.mutate({ id }, {
          onSuccess: () => { successCount++; resolve(); },
          onError: () => resolve(),
        });
      });
    }
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);
    setIsBulkDeleting(false);
    queryClient.invalidateQueries({ queryKey: getListEmailCorrespondencesQueryKey() });
    toast({ title: `${successCount} email dihapus` });
  }

  function openDetail(email: EmailCorrespondence) {
    setSelectedId(email.id);
    setDetailOpen(true);
  }

  function invalidateLists() {
    queryClient.invalidateQueries({ queryKey: getListEmailCorrespondencesQueryKey() });
    if (selectedId) {
      queryClient.invalidateQueries({ queryKey: getGetEmailCorrespondenceQueryKey(selectedId) });
    }
  }

  function handleDeleteEmail(id: number) {
    deleteEmail.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEmailCorrespondencesQueryKey() });
        setDeleteConfirmId(null);
        setDetailOpen(false);
        setSelectedId(null);
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleStatusUpdate(status: string) {
    if (!selectedId) return;
    validateStatus.mutate({ id: selectedId, data: { status: status as any } }, {
      onSuccess: () => {
        invalidateLists();
        toast({ title: t.common.success, description: STATUS_LABELS[status] ?? status });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleSync() {
    syncImap.mutate(undefined, {
      onSuccess: (result) => {
        invalidateLists();
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function openLinkDialog() {
    setLinkDocType("sales_order");
    setLinkSearchQ("");
    setLinkSelectedId(null);
    setLinkSelectedLabel("");
    setLinkReason("");
    setLinkNotes("");
    setLinkOpen(true);
  }

  function handleCreateLink() {
    if (!selectedId || !linkSelectedId) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    createLink.mutate({
      id: selectedId,
      data: {
        linkedType: linkDocType as any,
        linkedId: linkSelectedId,
        linkReason: linkReason || null,
        notes: linkNotes || null,
      }
    }, {
      onSuccess: () => {
        invalidateLists();
        setLinkOpen(false);
        toast({ title: t.common.success, description: linkSelectedLabel });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleValidateLink(link: EmailLink) {
    if (!selectedId) return;
    validateLink.mutate({ id: selectedId, linkId: link.id, data: {} }, {
      onSuccess: () => {
        invalidateLists();
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleDeleteLink(link: EmailLink) {
    if (!selectedId) return;
    deleteLink.mutate({ id: selectedId, linkId: link.id }, {
      onSuccess: () => {
        invalidateLists();
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Kotak Masuk Email</h1>
            <p className="text-sm text-muted-foreground">Email masuk dari {import.meta.env.VITE_IMAP_USER ?? "admcst001@gmail.com"}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncImap.isPending}
            data-testid="button-sync-email"
          >
            {syncImap.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1.5 hidden sm:inline">Sinkron Email</span>
          </Button>
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Cari subjek, pengirim, isi..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                data-testid="input-email-search"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus} data-testid="filter-email-status">
              <SelectTrigger className="sm:w-[160px]"><SelectValue placeholder="Semua Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua Status</SelectItem>
                <SelectItem value="new">Baru</SelectItem>
                <SelectItem value="linked">Ditautkan</SelectItem>
                <SelectItem value="validated">Divalidasi</SelectItem>
                <SelectItem value="rejected">Ditolak</SelectItem>
                <SelectItem value="archived">Diarsipkan</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => setShowMoreFilters((v) => !v)}
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">{showMoreFilters ? "Sembunyikan Filter" : "Filter Lanjut"}</span>
            </Button>
          </div>

          {showMoreFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3 border rounded-lg bg-muted/20">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Dari (From)</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder="email@domain.com"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Subjek</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder="Kata kunci subjek..."
                  value={filterSubject}
                  onChange={(e) => setFilterSubject(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Jenis Tautan</Label>
                <Select value={filterLinkedType} onValueChange={setFilterLinkedType}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua Jenis" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Semua Jenis</SelectItem>
                    <SelectItem value="sales_order">Sales Order</SelectItem>
                    <SelectItem value="purchase_order">Purchase Order</SelectItem>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="expense">Biaya (Expense)</SelectItem>
                    <SelectItem value="payment">Pembayaran</SelectItem>
                    <SelectItem value="shipment">Pengiriman / Job</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Tanggal Dari</Label>
                <DatePicker value={filterDateFrom} onChange={(v) => setFilterDateFrom(v)} className="h-8 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Tanggal Sampai</Label>
                <DatePicker value={filterDateTo} onChange={(v) => setFilterDateTo(v)} className="h-8 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Status Validasi</Label>
                <Select value={filterIsValidated} onValueChange={setFilterIsValidated}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Semua</SelectItem>
                    <SelectItem value="true">Sudah Divalidasi</SelectItem>
                    <SelectItem value="false">Belum Divalidasi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => {
                    setFilterFrom("");
                    setFilterSubject("");
                    setFilterDateFrom("");
                    setFilterDateTo("");
                    setFilterLinkedType("__all__");
                    setFilterIsValidated("__all__");
                  }}
                >
                  Reset Filter
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Bulk action bar */}
        {someSelected && (
          <div className="flex items-center gap-3 px-3 py-2 bg-muted/60 border rounded-lg">
            <Checkbox
              checked={allSelected}
              onCheckedChange={() => toggleSelectAll({ stopPropagation: () => {} } as React.MouseEvent)}
              id="select-all-top"
            />
            <span className="text-sm font-medium flex-1">{selectedIds.size} email dipilih</span>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Hapus Dipilih
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              Batal
            </Button>
          </div>
        )}

        {/* Email List */}
        <div className="space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-14 w-full" /></CardContent></Card>
            ))
          ) : emails.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <Mail className="h-10 w-10 mb-3 mx-auto opacity-40" />
                <p className="font-medium">Tidak ada email.</p>
                <p className="text-sm mt-1">Klik "Sinkron Email" untuk menarik email dari IMAP.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Select all row */}
              <div className="flex items-center gap-3 px-1 pb-1">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => toggleSelectAll({ stopPropagation: () => {} } as React.MouseEvent)}
                  id="select-all"
                />
                <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer select-none">
                  Pilih semua ({emails.length})
                </label>
              </div>
              {emails.map((email) => (
                <Card
                  key={email.id}
                  className={`hover:bg-muted/30 transition-colors cursor-pointer ${email.status === "new" ? "border-blue-200 dark:border-blue-800/50" : ""} ${selectedIds.has(email.id) ? "ring-2 ring-primary/40 bg-primary/5" : ""}`}
                  onClick={() => openDetail(email)}
                  data-testid={`card-email-${email.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className="mt-0.5 shrink-0"
                        onClick={(e) => toggleSelect(email.id, e)}
                      >
                        <Checkbox
                          checked={selectedIds.has(email.id)}
                          onCheckedChange={() => {}}
                          className="pointer-events-none"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <StatusBadge status={email.status} />
                          {email.fromEmail && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{email.fromEmail}</span>
                          )}
                        </div>
                        <p className={`truncate ${email.status === "new" ? "font-semibold" : "font-medium"}`}>{email.subject}</p>
                        {email.body && (
                          <p className="text-sm text-muted-foreground truncate mt-0.5">
                            {email.body.slice(0, 120)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(email.receivedAt)}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Hapus email"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(email.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </div>
      </div>

      {/* DETAIL DIALOG */}
      <Dialog open={detailOpen} onOpenChange={(o) => { if (!o) { setDetailOpen(false); setSelectedId(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailLoading || !detail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <StatusBadge status={detail.status} />
                </div>
                <DialogTitle className="text-lg leading-snug">{detail.subject}</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-1 text-sm mt-1">
                    <p className="text-muted-foreground">{formatDateTime(detail.receivedAt)}</p>
                    {detail.fromEmail && (
                      <p>Dari: <span className="font-medium">{detail.fromEmail}</span></p>
                    )}
                    {detail.toEmail && (
                      <p>Ke: <span className="font-medium">{detail.toEmail}</span></p>
                    )}
                    {detail.ccEmail && (
                      <p>CC: <span className="font-medium">{detail.ccEmail}</span></p>
                    )}
                  </div>
                </DialogDescription>
              </DialogHeader>

              {/* Body */}
              {detail.body && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Isi Email</p>
                  <div className="text-sm bg-muted/30 rounded-md p-3 whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto border">
                    {detail.body}
                  </div>
                </div>
              )}

              {/* Attachments */}
              {(detail.attachments as EmailAttachment[]).length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Lampiran ({(detail.attachments as EmailAttachment[]).length})
                  </p>
                  <div className="space-y-2">
                    {(detail.attachments as EmailAttachment[]).map((att) => {
                      const url = resolveFileUrl(att.fileUrl);
                      return (
                        <div key={att.id} className="border rounded-md overflow-hidden">
                          {isImage(att.mimeType, att.fileName) && url && (
                            <a href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt={att.fileName} className="w-full max-h-48 object-contain bg-muted" />
                            </a>
                          )}
                          <div className="flex items-center gap-2 p-2 bg-muted/20">
                            <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-sm truncate flex-1">{att.fileName}</span>
                            {url && (
                              <a href={url} target="_blank" rel="noreferrer" download>
                                <Button size="icon" variant="ghost" className="h-7 w-7">
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Linked Transactions */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Tautan Transaksi ({(detail.links as EmailLink[]).length})
                  </p>
                </div>
                {(detail.links as EmailLink[]).length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-4 border border-dashed rounded-md">
                    <p className="text-sm text-muted-foreground">Belum ada tautan transaksi.</p>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={openLinkDialog}>
                      <Link2 className="h-3.5 w-3.5" /> Tautkan ke Transaksi
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(detail.links as EmailLink[]).map((link) => (
                      <div key={link.id} className="border rounded-md p-3 bg-muted/20">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">
                                {DOC_TYPE_LABELS[link.linkedType] ?? link.linkedType} #{link.linkedId}
                              </span>
                              {link.isValidated ? (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                                  <CheckCircle2 className="h-3 w-3" /> Divalidasi
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  Belum divalidasi
                                </span>
                              )}
                            </div>
                            {link.linkReason && (
                              <p className="text-xs text-muted-foreground mt-0.5">{link.linkReason}</p>
                            )}
                            {link.notes && (
                              <p className="text-xs text-muted-foreground mt-0.5 italic">{link.notes}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!link.isValidated && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-emerald-600"
                                title="Validasi tautan"
                                onClick={() => handleValidateLink(link)}
                                disabled={validateLink.isPending}
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Hapus tautan"
                              onClick={() => handleDeleteLink(link)}
                              disabled={deleteLink.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Status Actions */}
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={openLinkDialog}
                >
                  <Link2 className="h-3.5 w-3.5" /> Tautkan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                  onClick={() => handleStatusUpdate("validated")}
                  disabled={validateStatus.isPending || detail.status === "validated"}
                  data-testid="button-validate-email"
                >
                  <ShieldCheck className="h-3.5 w-3.5" /> Validasi
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20"
                  onClick={() => handleStatusUpdate("rejected")}
                  disabled={validateStatus.isPending || detail.status === "rejected"}
                >
                  <XCircle className="h-3.5 w-3.5" /> Tolak
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-gray-600"
                  onClick={() => handleStatusUpdate("archived")}
                  disabled={validateStatus.isPending || detail.status === "archived"}
                >
                  <Archive className="h-3.5 w-3.5" /> Arsipkan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5 ml-auto"
                  onClick={() => setDeleteConfirmId(detail.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Hapus Email
                </Button>
              </div>

              <DialogFooter className="mt-2">
                <Button variant="outline" onClick={() => { setDetailOpen(false); setSelectedId(null); }}>Tutup</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* LINK DIALOG */}
      <Dialog open={linkOpen} onOpenChange={(o) => { if (!o) setLinkOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Tautkan ke Transaksi
            </DialogTitle>
            <DialogDescription>
              Pilih jenis dokumen lalu pilih transaksi dari daftar.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Doc type */}
            <div className="grid gap-2">
              <Label>Jenis Dokumen</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["sales_order", "purchase_order", "invoice", "expense", "payment", "shipment"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setLinkDocType(t); setLinkSelectedId(null); setLinkSelectedLabel(""); setLinkSearchQ(""); }}
                    className={`text-xs rounded-md border px-2 py-1.5 transition-colors font-medium ${linkDocType === t ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/20 hover:bg-muted"}`}
                  >
                    {DOC_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9 h-9"
                placeholder={`Cari ${DOC_TYPE_LABELS[linkDocType]}...`}
                value={linkSearchQ}
                onChange={(e) => setLinkSearchQ(e.target.value)}
              />
            </div>

            {/* Transaction list */}
            <div className="border rounded-md p-2 min-h-[80px]">
              <TransactionList
                docType={linkDocType}
                selectedId={linkSelectedId}
                onSelect={(id, label) => { setLinkSelectedId(id); setLinkSelectedLabel(label); }}
                searchQ={linkSearchQ}
              />
            </div>

            {linkSelectedId && (
              <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Dipilih: </span>
                <span className="font-medium">{linkSelectedLabel}</span>
              </div>
            )}

            {/* Optional reason and notes */}
            <div className="grid gap-2">
              <Label htmlFor="link-reason" className="text-sm">Alasan Tautan <span className="text-muted-foreground font-normal">(opsional)</span></Label>
              <Input
                id="link-reason"
                value={linkReason}
                onChange={(e) => setLinkReason(e.target.value)}
                placeholder="Contoh: Email konfirmasi PO ini"
                className="h-9"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="link-notes" className="text-sm">Catatan <span className="text-muted-foreground font-normal">(opsional)</span></Label>
              <Textarea
                id="link-notes"
                value={linkNotes}
                onChange={(e) => setLinkNotes(e.target.value)}
                placeholder="Catatan tambahan..."
                rows={2}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Batal</Button>
            <Button
              onClick={handleCreateLink}
              disabled={createLink.isPending || !linkSelectedId}
              data-testid="button-confirm-link"
            >
              {createLink.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
              Tautkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BULK DELETE CONFIRM DIALOG */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(o) => { if (!o) setBulkDeleteOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" /> Hapus {selectedIds.size} Email
            </DialogTitle>
            <DialogDescription>
              {selectedIds.size} email yang dipilih akan dihapus permanen beserta semua tautan transaksinya. Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={isBulkDeleting}>Batal</Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Ya, Hapus Semua
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRM DIALOG */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(o) => { if (!o) setDeleteConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" /> Hapus Email
            </DialogTitle>
            <DialogDescription>
              Email ini akan dihapus permanen beserta semua tautan transaksinya. Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Batal</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDeleteEmail(deleteConfirmId)}
              disabled={deleteEmail.isPending}
            >
              {deleteEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Ya, Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
