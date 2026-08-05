import { useState, useMemo } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useListPurchaseDocuments } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Search,
  ExternalLink,
  Package,
  FileText,
  Receipt,
  BookOpen,
  ChevronRight,
  AlertCircle,
  SquareArrowOutUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

const fmt = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";

type POStatus = "all" | "draft" | "sent" | "confirmed" | "done" | "cancelled";
type ReceiveFilter = "all" | "none" | "to_receive" | "received";
type BillFilter = "all" | "none" | "to_bill" | "billed";

function statusBadge(s: string) {
  const map: Record<string, string> = {
    draft: "bg-slate-700 text-slate-300",
    sent: "bg-blue-900/60 text-blue-300",
    confirmed: "bg-emerald-900/60 text-emerald-300",
    done: "bg-emerald-700 text-emerald-100",
    cancelled: "bg-red-900/60 text-red-300",
  };
  const label: Record<string, string> = {
    draft: "Draft", sent: "Terkirim", confirmed: "Dikonfirmasi", done: "Selesai", cancelled: "Dibatalkan",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", map[s] ?? "bg-slate-700 text-slate-300")}>
      {label[s] ?? s}
    </span>
  );
}

function receiveBadge(s: string) {
  const map: Record<string, string> = {
    none: "bg-slate-700 text-slate-400",
    to_receive: "bg-amber-900/60 text-amber-300",
    received: "bg-emerald-900/60 text-emerald-300",
  };
  const label: Record<string, string> = { none: "Belum", to_receive: "Perlu Terima", received: "Diterima" };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", map[s] ?? "bg-slate-700 text-slate-400")}>
      {label[s] ?? s}
    </span>
  );
}

function billBadge(s: string) {
  const map: Record<string, string> = {
    none: "bg-slate-700 text-slate-400",
    to_bill: "bg-orange-900/60 text-orange-300",
    billed: "bg-purple-900/60 text-purple-300",
  };
  const label: Record<string, string> = { none: "Belum", to_bill: "Perlu Tagih", billed: "Ditagih" };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", map[s] ?? "bg-slate-700 text-slate-400")}>
      {label[s] ?? s}
    </span>
  );
}

function grStatusBadge(s: string) {
  const map: Record<string, string> = {
    draft: "bg-slate-700 text-slate-300",
    confirmed: "bg-emerald-900/60 text-emerald-300",
    cancelled: "bg-red-900/60 text-red-300",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", map[s] ?? "bg-slate-700 text-slate-300")}>
      {s}
    </span>
  );
}

function viStatusBadge(s: string) {
  const map: Record<string, string> = {
    draft: "bg-slate-700 text-slate-300",
    posted: "bg-emerald-900/60 text-emerald-300",
    cancelled: "bg-red-900/60 text-red-300",
  };
  const label: Record<string, string> = { draft: "Draft", posted: "Diposting", cancelled: "Dibatalkan" };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", map[s] ?? "bg-slate-700 text-slate-300")}>
      {label[s] ?? s}
    </span>
  );
}

function journalStatusBadge(s: string) {
  return s === "posted"
    ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-900/60 text-emerald-300">Diposting</span>
    : <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">Draft</span>;
}

function sourceBadge(s: string) {
  const map: Record<string, string> = {
    purchase_bill: "Tagihan Pembelian",
    grn_receipt: "Penerimaan Barang",
    stock_received: "Stok Masuk",
  };
  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-900/60 text-indigo-300">
      {map[s] ?? s}
    </span>
  );
}

interface PODetailLine {
  id: number;
  name: string;
  description?: string | null;
  quantity: number;
  unitCost: number;
  subtotal: number;
  unit?: string | null;
}

interface GoodsReceipt {
  id: number;
  grNumber: string;
  status: string;
  receivedAt?: string | null;
  createdAt: string;
}

interface VendorInvoice {
  id: number;
  invoiceNumber: string;
  vendorInvoiceRef?: string | null;
  status: string;
  totalAmount: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  invoiceDate?: string | null;
  dueDate?: string | null;
}

interface JournalLine {
  id: number;
  entryId: number;
  description?: string | null;
  debit: number;
  credit: number;
  accountCode?: string | null;
  accountName?: string | null;
}

interface JournalEntry {
  id: number;
  entryNumber: string;
  date?: string | null;
  description?: string | null;
  status: string;
  source: string;
  totalDebit: number;
  totalCredit: number;
  lines: JournalLine[];
}

interface PODetail {
  id: number;
  docNumber: string;
  status: string;
  receiveStatus: string;
  billStatus: string;
  paymentStatus: string;
  supplierName: string;
  totalAmount: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  expectedDate?: string | null;
  confirmedAt?: string | null;
  createdAt: string;
  notes?: string | null;
  lines: PODetailLine[];
  goodsReceipts: GoodsReceipt[];
  vendorInvoices: VendorInvoice[];
  journalEntries: JournalEntry[];
}

function usePODetail(id: number | null) {
  return useQuery<PODetail>({
    queryKey: ["purchase-po-detail", id],
    queryFn: async () => {
      const res = await fetch(`/api/purchase/po-detail/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil detail PO");
      return res.json();
    },
    enabled: id !== null,
    staleTime: 30_000,
  });
}

function PODetailPanel({ id }: { id: number }) {
  const { data, isLoading, isError } = usePODetail(id);
  const [tab, setTab] = useState("lines");

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <span>Gagal memuat detail PO</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700/60 bg-slate-800/50 flex items-start justify-between gap-4 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-white text-lg">{data.docNumber}</span>
            {statusBadge(data.status)}
          </div>
          <div className="text-sm text-slate-400">{data.supplierName}</div>
          {data.notes && <div className="text-xs text-slate-500 mt-1 max-w-lg truncate">{data.notes}</div>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href={`/accounting/payments?refDocNumber=${encodeURIComponent(data.docNumber)}`}>
            <Button size="sm" variant="ghost" className="border-slate-700 text-slate-400 hover:text-slate-200 gap-1.5">
              <SquareArrowOutUpRight className="w-3.5 h-3.5" /> Lihat Pembayaran
            </Button>
          </Link>
          <Link href={`/purchase/orders/${data.id}`}>
            <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 hover:text-white">
              <ExternalLink className="w-3.5 h-3.5 mr-1" /> Buka
            </Button>
          </Link>
        </div>
      </div>

      <div className="px-5 py-3 border-b border-slate-700/60 grid grid-cols-2 sm:grid-cols-4 gap-3 flex-shrink-0 bg-slate-800/30">
        <div>
          <div className="text-xs text-slate-500 mb-1">Total</div>
          <div className="text-sm font-medium text-white">{idr(data.grandTotal)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Dibayar</div>
          <div className="text-sm font-medium text-emerald-400">{idr(data.amountPaid)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Penerimaan</div>
          <div>{receiveBadge(data.receiveStatus)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Tagihan</div>
          <div>{billBadge(data.billStatus)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Tanggal PO</div>
          <div className="text-xs text-slate-300">{fmt(data.createdAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Dikonfirmasi</div>
          <div className="text-xs text-slate-300">{fmt(data.confirmedAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Exp. Pengiriman</div>
          <div className="text-xs text-slate-300">{fmt(data.expectedDate)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Pembayaran</div>
          <div className="text-xs text-slate-300 capitalize">{data.paymentStatus}</div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
        <div className="flex-shrink-0 border-b border-slate-700/60 px-5 pt-2">
          <TabsList className="bg-transparent gap-0 p-0 h-auto">
            <TabsTrigger
              value="lines"
              className="data-[state=active]:border-b-2 data-[state=active]:border-emerald-400 data-[state=active]:text-emerald-400 text-slate-400 rounded-none px-4 pb-2 text-sm"
            >
              <Package className="w-3.5 h-3.5 mr-1" /> Lines ({data.lines.length})
            </TabsTrigger>
            <TabsTrigger
              value="grn"
              className="data-[state=active]:border-b-2 data-[state=active]:border-emerald-400 data-[state=active]:text-emerald-400 text-slate-400 rounded-none px-4 pb-2 text-sm"
            >
              <FileText className="w-3.5 h-3.5 mr-1" /> Penerimaan ({data.goodsReceipts.length})
            </TabsTrigger>
            <TabsTrigger
              value="invoices"
              className="data-[state=active]:border-b-2 data-[state=active]:border-emerald-400 data-[state=active]:text-emerald-400 text-slate-400 rounded-none px-4 pb-2 text-sm"
            >
              <Receipt className="w-3.5 h-3.5 mr-1" /> Tagihan ({data.vendorInvoices.length})
            </TabsTrigger>
            <TabsTrigger
              value="journal"
              className="data-[state=active]:border-b-2 data-[state=active]:border-emerald-400 data-[state=active]:text-emerald-400 text-slate-400 rounded-none px-4 pb-2 text-sm"
            >
              <BookOpen className="w-3.5 h-3.5 mr-1" /> Jurnal ({data.journalEntries.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          <TabsContent value="lines" className="mt-0 h-full">
            {data.lines.length === 0 ? (
              <div className="p-6 text-slate-500 text-sm text-center">Tidak ada lines</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-400">#</TableHead>
                    <TableHead className="text-slate-400">Nama Item</TableHead>
                    <TableHead className="text-slate-400 text-right">Qty</TableHead>
                    <TableHead className="text-slate-400">Satuan</TableHead>
                    <TableHead className="text-slate-400 text-right">Harga Satuan</TableHead>
                    <TableHead className="text-slate-400 text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((l, i) => (
                    <TableRow key={l.id} className="border-slate-700 hover:bg-slate-800/40">
                      <TableCell className="text-slate-500 text-sm">{i + 1}</TableCell>
                      <TableCell>
                        <div className="text-sm text-slate-200">{l.name}</div>
                        {l.description && <div className="text-xs text-slate-500 mt-0.5">{l.description}</div>}
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-300">
                        {Number(l.quantity).toLocaleString("id-ID")}
                      </TableCell>
                      <TableCell className="text-sm text-slate-400">{l.unit ?? "-"}</TableCell>
                      <TableCell className="text-right text-sm text-slate-300">{idr(l.unitCost)}</TableCell>
                      <TableCell className="text-right text-sm font-medium text-white">{idr(l.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-slate-700 bg-slate-800/30">
                    <TableCell colSpan={5} className="text-right text-sm text-slate-400 font-medium">
                      Subtotal
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium text-white">{idr(data.totalAmount)}</TableCell>
                  </TableRow>
                  {data.taxAmount > 0 && (
                    <TableRow className="border-slate-700 bg-slate-800/30">
                      <TableCell colSpan={5} className="text-right text-sm text-slate-400">Pajak</TableCell>
                      <TableCell className="text-right text-sm text-slate-300">{idr(data.taxAmount)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow className="border-slate-700 bg-slate-800/50">
                    <TableCell colSpan={5} className="text-right text-sm font-bold text-slate-200">Grand Total</TableCell>
                    <TableCell className="text-right text-base font-bold text-emerald-400">{idr(data.grandTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="grn" className="mt-0 h-full">
            {data.goodsReceipts.length === 0 ? (
              <div className="p-6 text-slate-500 text-sm text-center">Belum ada penerimaan barang</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-400">No. GRN</TableHead>
                    <TableHead className="text-slate-400">Status</TableHead>
                    <TableHead className="text-slate-400">Diterima</TableHead>
                    <TableHead className="text-slate-400">Dibuat</TableHead>
                    <TableHead className="text-slate-400"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.goodsReceipts.map((g) => (
                    <TableRow key={g.id} className="border-slate-700 hover:bg-slate-800/40">
                      <TableCell className="text-sm font-medium text-slate-200">{g.grNumber}</TableCell>
                      <TableCell>{grStatusBadge(g.status)}</TableCell>
                      <TableCell className="text-sm text-slate-400">{fmt(g.receivedAt)}</TableCell>
                      <TableCell className="text-sm text-slate-400">{fmt(g.createdAt)}</TableCell>
                      <TableCell>
                        <Link href={`/purchase/gr/${g.id}`}>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400 hover:text-white px-2">
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="invoices" className="mt-0 h-full">
            {data.vendorInvoices.length === 0 ? (
              <div className="p-6 text-slate-500 text-sm text-center">Belum ada tagihan vendor</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-400">No. Invoice</TableHead>
                    <TableHead className="text-slate-400">Ref Vendor</TableHead>
                    <TableHead className="text-slate-400">Status</TableHead>
                    <TableHead className="text-slate-400 text-right">Grand Total</TableHead>
                    <TableHead className="text-slate-400 text-right">Dibayar</TableHead>
                    <TableHead className="text-slate-400">Tgl Invoice</TableHead>
                    <TableHead className="text-slate-400">Jatuh Tempo</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.vendorInvoices.map((v) => (
                    <TableRow key={v.id} className="border-slate-700 hover:bg-slate-800/40">
                      <TableCell className="text-sm font-medium text-slate-200">{v.invoiceNumber}</TableCell>
                      <TableCell className="text-sm text-slate-400">{v.vendorInvoiceRef ?? "-"}</TableCell>
                      <TableCell>{viStatusBadge(v.status)}</TableCell>
                      <TableCell className="text-right text-sm font-medium text-white">{idr(v.grandTotal)}</TableCell>
                      <TableCell className="text-right text-sm text-emerald-400">{idr(v.amountPaid)}</TableCell>
                      <TableCell className="text-sm text-slate-400">{fmt(v.invoiceDate)}</TableCell>
                      <TableCell className="text-sm text-slate-400">{fmt(v.dueDate)}</TableCell>
                      <TableCell>
                        <Link href={`/purchase/vendor-invoices/${v.id}`}>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400 hover:text-white px-2">
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="journal" className="mt-0 h-full">
            {data.journalEntries.length === 0 ? (
              <div className="p-6 text-slate-500 text-sm text-center">Belum ada jurnal akuntansi</div>
            ) : (
              <div className="p-4 space-y-4">
                {data.journalEntries.map((je) => (
                  <div key={je.id} className="border border-slate-700 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-slate-800/50 flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-200">{je.entryNumber}</span>
                        {journalStatusBadge(je.status)}
                        {sourceBadge(je.source)}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-400">
                        <span>{je.date ?? "-"}</span>
                        <span className="text-slate-500">{je.description}</span>
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700 hover:bg-transparent">
                          <TableHead className="text-slate-400 text-xs">Akun</TableHead>
                          <TableHead className="text-slate-400 text-xs">Keterangan</TableHead>
                          <TableHead className="text-slate-400 text-xs text-right">Debit</TableHead>
                          <TableHead className="text-slate-400 text-xs text-right">Kredit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {je.lines.map((jl) => (
                          <TableRow key={jl.id} className="border-slate-700 hover:bg-slate-800/40">
                            <TableCell className="text-xs">
                              <span className="text-slate-500 mr-1">{jl.accountCode}</span>
                              <span className="text-slate-200">{jl.accountName}</span>
                            </TableCell>
                            <TableCell className="text-xs text-slate-400">{jl.description ?? "-"}</TableCell>
                            <TableCell className="text-xs text-right text-slate-300">
                              {jl.debit > 0 ? idr(jl.debit) : "-"}
                            </TableCell>
                            <TableCell className="text-xs text-right text-slate-300">
                              {jl.credit > 0 ? idr(jl.credit) : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-slate-700 bg-slate-800/30">
                          <TableCell colSpan={2} className="text-xs text-right text-slate-400 font-medium">Total</TableCell>
                          <TableCell className="text-xs text-right font-bold text-white">{idr(je.totalDebit)}</TableCell>
                          <TableCell className="text-xs text-right font-bold text-white">{idr(je.totalCredit)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export default function POOrdersPage() {
  const { activeCompanyId: companyId } = useCompany();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<POStatus>("all");
  const [receiveFilter, setReceiveFilter] = useState<ReceiveFilter>("all");
  const [billFilter, setBillFilter] = useState<BillFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: docs = [], isLoading } = useListPurchaseDocuments({
    kind: "order",
  } as any);

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        d.docNumber?.toLowerCase().includes(q) ||
        d.supplierName?.toLowerCase().includes(q);
      const matchStatus = statusFilter === "all" || d.status === statusFilter;
      const matchReceive = receiveFilter === "all" || d.receiveStatus === receiveFilter;
      const matchBill = billFilter === "all" || d.billStatus === billFilter;
      return matchSearch && matchStatus && matchReceive && matchBill;
    });
  }, [docs, search, statusFilter, receiveFilter, billFilter]);

  const statusOptions: { value: POStatus; label: string }[] = [
    { value: "all", label: "Semua" },
    { value: "draft", label: "Draft" },
    { value: "sent", label: "Terkirim" },
    { value: "confirmed", label: "Dikonfirmasi" },
    { value: "done", label: "Selesai" },
    { value: "cancelled", label: "Dibatalkan" },
  ];

  const receiveOptions: { value: ReceiveFilter; label: string }[] = [
    { value: "all", label: "Semua" },
    { value: "none", label: "Belum" },
    { value: "to_receive", label: "Perlu Terima" },
    { value: "received", label: "Diterima" },
  ];

  const billOptions: { value: BillFilter; label: string }[] = [
    { value: "all", label: "Semua" },
    { value: "none", label: "Belum" },
    { value: "to_bill", label: "Perlu Tagih" },
    { value: "billed", label: "Ditagih" },
  ];

  return (
    <AppShell>
      <div className="flex h-full overflow-hidden" style={{ height: "calc(100vh - 56px)" }}>
        <div className="w-[380px] flex-shrink-0 border-r border-slate-700 flex flex-col bg-slate-900 overflow-hidden">
          <div className="p-4 border-b border-slate-700/60 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

              <h1 className="font-semibold text-white text-base">Purchase Orders</h1>
              <Link href="/purchase/orders/new">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white h-7 text-xs px-3">
                  + Baru
                </Button>
              </Link>
            </div>
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input
                placeholder="Cari nomor / vendor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <div>
                <div className="text-xs text-slate-500 mb-1">Status PO</div>
                <div className="flex flex-wrap gap-1">
                  {statusOptions.map((o) => (
                    <button
                      key={o.value}
                      onClick={() => setStatusFilter(o.value)}
                      className={cn(
                        "px-2 py-0.5 rounded text-xs transition-colors",
                        statusFilter === o.value
                          ? "bg-emerald-700 text-emerald-100"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <div className="text-xs text-slate-500 mb-1">Penerimaan</div>
                  <div className="flex flex-wrap gap-1">
                    {receiveOptions.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => setReceiveFilter(o.value)}
                        className={cn(
                          "px-2 py-0.5 rounded text-xs transition-colors",
                          receiveFilter === o.value
                            ? "bg-amber-700 text-amber-100"
                            : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-slate-500 mb-1">Tagihan</div>
                  <div className="flex flex-wrap gap-1">
                    {billOptions.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => setBillFilter(o.value)}
                        className={cn(
                          "px-2 py-0.5 rounded text-xs transition-colors",
                          billFilter === o.value
                            ? "bg-purple-700 text-purple-100"
                            : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-sm">Tidak ada PO ditemukan</div>
            ) : (
              <div className="p-2 space-y-1">
                {filtered.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedId(d.id === selectedId ? null : d.id)}
                    className={cn(
                      "w-full text-left rounded-lg p-3 transition-colors border",
                      selectedId === d.id
                        ? "bg-emerald-900/30 border-emerald-600/50"
                        : "bg-slate-800/50 border-slate-700/40 hover:bg-slate-800 hover:border-slate-600",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-sm font-medium text-slate-200 truncate">{d.docNumber}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {statusBadge(d.status)}
                        <ChevronRight
                          className={cn(
                            "w-4 h-4 text-slate-500 transition-transform",
                            selectedId === d.id && "rotate-90 text-emerald-400",
                          )}
                        />
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 truncate mb-1.5">{d.supplierName}</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-1">
                        {receiveBadge(d.receiveStatus)}
                        {billBadge(d.billStatus)}
                      </div>
                      <span className="text-xs font-medium text-white">{idr(Number(d.grandTotal))}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 py-2 border-t border-slate-700/60 flex-shrink-0">
            <span className="text-xs text-slate-500">{filtered.length} dari {docs.length} PO</span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-slate-900">
          {selectedId === null ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
              <FileText className="w-12 h-12 text-slate-700" />
              <div className="text-sm">Pilih PO untuk melihat detail</div>
              <div className="text-xs text-slate-600">Lines, penerimaan, tagihan, dan jurnal akuntansi</div>
            </div>
          ) : (
            <PODetailPanel id={selectedId} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
