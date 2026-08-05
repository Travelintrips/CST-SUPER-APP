import { useState } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useListPurchaseDocuments,
  useDeletePurchaseDocument,
  usePurchaseDocumentAction,
  getListPurchaseDocumentsQueryKey,
  getGetPurchaseDocumentQueryOptions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { usePrefetchOnHover } from "@/hooks/use-prefetch-on-hover";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCompany } from "@/contexts/CompanyContext";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const statusVariant = (s: string): "default" | "secondary" | "outline" | "destructive" => {
  switch (s) {
    case "draft": return "secondary";
    case "sent": return "outline";
    case "confirmed": return "default";
    case "done": return "default";
    case "cancelled": return "destructive";
    default: return "secondary";
  }
};

type PaymentFilter = "all" | "unpaid" | "partial" | "paid" | "overdue";

const PAYMENT_LABELS: Record<PaymentFilter, string> = {
  all: "Semua",
  unpaid: "Belum Bayar",
  partial: "Sebagian",
  paid: "Lunas",
  overdue: "Jatuh Tempo",
};

function PaymentBadge({ status }: { status: string }) {
  if (status === "paid") return <Badge className="bg-emerald-900/50 text-emerald-300 border-emerald-700">Lunas</Badge>;
  if (status === "partial") return <Badge className="bg-amber-900/50 text-amber-300 border-amber-700">Sebagian</Badge>;
  if (status === "overdue") return <Badge className="bg-red-900/50 text-red-300 border-red-700">Jatuh Tempo</Badge>;
  return <Badge variant="outline" className="text-slate-400 border-slate-600">Belum Bayar</Badge>;
}

function isOverduePurchase(
  expectedDate: string | null | undefined,
  paymentStatus: string,
  billStatus: string,
): boolean {
  if (!expectedDate) return false;
  if (paymentStatus === "paid") return false;
  if (billStatus === "none") return false;
  return new Date(expectedDate) < new Date(new Date().toDateString());
}

interface Props {
  kind: "rfq" | "order";
}

export default function PurchaseDocumentsListPage({ kind }: Props) {
  const isRfq = kind === "rfq";
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const prefetchHover = usePrefetchOnHover();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { activeCompanyId } = useCompany();
  const deleteMut = useDeletePurchaseDocument();
  const actionMut = usePurchaseDocumentAction();

  const { data: docs } = (useListPurchaseDocuments as any)({ kind, ...(!isRfq && paymentFilter !== "all" ? { paymentStatus: paymentFilter } : {}) });

  const allDocs = docs ?? [];

  const title = isRfq ? "Request for Quotation" : "Purchase Orders";
  const desc = isRfq ? "Permintaan penawaran ke vendor." : "Pesanan pembelian terkonfirmasi.";
  const detailBase = isRfq ? "/purchase/rfq" : "/purchase/orders";

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = allDocs.length > 0 && allDocs.every((d: any) => selectedIds.has(d.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allDocs.map((d: any) => d.id)));
    }
  };

  const handleDelete = (id: number) => { setDeleteTargetId(id); };

  const doDelete = async (id: number) => {
    setDeleteTargetId(null);
    try {
      await deleteMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey({ kind }) });
      toast({ title: t.common.success });
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setBulkDeleteOpen(true);
  };

  const doBulkDelete = async () => {
    setBulkDeleteOpen(false);
    setBulkDeleting(true);
    let success = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await deleteMut.mutateAsync({ id });
        success++;
      } catch {
        failed++;
      }
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey({ kind }) });
    if (failed === 0) {
      toast({ title: `${success} dokumen berhasil dihapus` });
    } else {
      toast({ title: `${success} berhasil, ${failed} gagal`, variant: "destructive" });
    }
  };

  const handleCancel = (id: number) => { setCancelTargetId(id); };

  const doCancel = async (id: number) => {
    setCancelTargetId(null);
    try {
      await actionMut.mutateAsync({ id, data: { action: "cancel" } });
      queryClient.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey({ kind }) });
      toast({ title: t.common.success });
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    }
  };

  const colCount = isRfq ? 7 : 10;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-sm text-muted-foreground">{desc}</p>
          </div>
          {isRfq && (
            <Link href="/purchase/rfq/new">
              <Button data-testid="button-new-rfq">
                <Plus className="mr-2 h-4 w-4" /> New RFQ
              </Button>
            </Link>
          )}
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-lg">
            <span className="text-sm font-medium">{selectedIds.size} dipilih</span>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {bulkDeleting ? "Menghapus..." : "Hapus Terpilih"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Batal
            </Button>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Daftar {title}</CardTitle>
            {!isRfq && (
              <div className="flex flex-wrap gap-2 mt-2" data-testid="payment-status-filter">
                {(Object.keys(PAYMENT_LABELS) as PaymentFilter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setPaymentFilter(f)}
                    data-testid={`filter-payment-${f}`}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                      paymentFilter === f
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                    }`}
                  >
                    {PAYMENT_LABELS[f]}
                  </button>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    {allDocs.length > 0 && (
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Pilih semua"
                      />
                    )}
                  </TableHead>
                  <TableHead>No.</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  {!isRfq && <TableHead>Receive</TableHead>}
                  {!isRfq && <TableHead>Bill</TableHead>}
                  {!isRfq && <TableHead>Bayar</TableHead>}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Tanggal</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(docs ?? []).map((d: any) => (
                  <TableRow
                    key={d.id}
                    data-testid={`row-doc-${d.id}`}
                    className="cursor-pointer hover:bg-muted/40 transition-colors"
                    {...prefetchHover(getGetPurchaseDocumentQueryOptions(d.id))}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(d.id)}
                        onCheckedChange={() => toggleSelect(d.id)}
                        aria-label={`Pilih ${d.docNumber}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Link href={`${detailBase}/${d.id}`} className="hover:underline">{d.docNumber}</Link>
                        {!isRfq && isOverduePurchase(d.expectedDate, d.paymentStatus, d.billStatus) && (
                          <Badge className="bg-red-900/50 text-red-300 border-red-700 text-xs" data-testid="badge-overdue">Jatuh Tempo</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{d.supplierName}</TableCell>
                    <TableCell><Badge variant={statusVariant(d.status)} className="capitalize">{d.status}</Badge></TableCell>
                    {!isRfq && <TableCell><Badge variant="outline" className="capitalize">{d.receiveStatus.replace("_", " ")}</Badge></TableCell>}
                    {!isRfq && <TableCell><Badge variant="outline" className="capitalize">{d.billStatus.replace("_", " ")}</Badge></TableCell>}
                    {!isRfq && <TableCell><PaymentBadge status={d.paymentStatus} /></TableCell>}
                    <TableCell className="text-right font-medium">{idr(Number(d.totalAmount))}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{new Date(d.createdAt).toLocaleDateString("id-ID")}</TableCell>
                    <TableCell className="text-right">
                      {d.status !== "draft" && d.status !== "cancelled" && d.status !== "done" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          title="Batalkan"
                          onClick={() => void handleCancel(d.id)}
                          data-testid={`btn-cancel-${d.id}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Hapus"
                        onClick={() => void handleDelete(d.id)}
                        data-testid={`btn-delete-${d.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(!docs || docs.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
                      {paymentFilter !== "all" ? `Tidak ada PO dengan status pembayaran "${PAYMENT_LABELS[paymentFilter]}".` : "Belum ada dokumen."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ── AlertDialog: hapus dokumen tunggal ── */}
      <AlertDialog open={deleteTargetId !== null} onOpenChange={(o) => { if (!o) setDeleteTargetId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Dokumen</AlertDialogTitle>
            <AlertDialogDescription>
              Dokumen ini akan dihapus secara permanen. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteTargetId !== null) void doDelete(deleteTargetId); }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── AlertDialog: hapus massal ── */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus {selectedIds.size} Dokumen</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{selectedIds.size} dokumen terpilih</strong> akan dihapus secara permanen. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void doBulkDelete()}
            >
              Hapus Semua
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── AlertDialog: batalkan dokumen ── */}
      <AlertDialog open={cancelTargetId !== null} onOpenChange={(o) => { if (!o) setCancelTargetId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan Dokumen</AlertDialogTitle>
            <AlertDialogDescription>
              {t.common.confirmDeleteDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (cancelTargetId !== null) void doCancel(cancelTargetId); }}
            >
              Konfirmasi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
