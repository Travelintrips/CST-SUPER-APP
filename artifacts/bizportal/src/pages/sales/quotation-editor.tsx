import { useEffect, useMemo, useState, useRef } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { GooglePlacesAutocomplete } from "@/components/ui/google-places-autocomplete";
import { ScanDocumentDialog, type ScannedDocumentData } from "@/components/ScanDocumentDialog";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { QueryState } from "@/components/ui/query-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  useGetSalesDocument,
  useCreateSalesDocument,
  useUpdateSalesDocument,
  useSalesDocumentAction,
  useDeleteSalesDocument,
  useListCustomers,
  useCreateCustomer,
  useListProducts,
  useListTaxes,
  useGetAccountingSettings,
  useListAccountingPayments,
  useCreateAccountingPayment,
  useListJournals,
  useListExpenses,
  useListFreightShipments,
  useForwardSalesDocumentToVendors,
  useListEligibleVendorsForDoc,
  getListEligibleVendorsForDocQueryKey,
  type ForwardToVendorsBodyChannelsItem,
  type VendorSendResult,
  getListExpensesQueryKey,
  getGetSalesDocumentQueryKey,
  getListSalesDocumentsQueryKey,
  getListAccountingPaymentsQueryKey,
  getListFreightShipmentsQueryKey,
  getListProductsQueryKey,
  getListCustomersQueryKey,
  getListAiDraftQuotationsQueryKey,
  type Product,
  type Customer,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, Send, Check, CheckCircle, X, Receipt, Truck, Trash2, FileEdit, Save, Printer, CreditCard, Wallet, FileText, ScanLine, Mail, Search, Package, Wrench, ExternalLink, MessageSquare, Bot, SendHorizonal, Pencil, Loader2 } from "lucide-react";
import { CorrespondenceTab } from "@/components/CorrespondenceTab";
import { TemplateSnapshotCard } from "@/components/TemplateSnapshotCard";
import { useCreateSalesPaymentLink } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LOGISTICS_SUBCATEGORIES } from "@workspace/logistics-constants";

interface ItemPickerProps {
  products: Product[];
  onSelect: (p: Product | null) => void;
  onAddNew: () => void;
  disabled?: boolean;
  currentName?: string;
}

function ItemPicker({ products, onSelect, onAddNew, disabled, currentName }: ItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "barang" | "jasa">("all");
  const [filterSubcat, setFilterSubcat] = useState("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: subcatList = [...LOGISTICS_SUBCATEGORIES] } = useQuery<string[]>({
    queryKey: ["logistics-subcategories"],
    queryFn: () => fetch("/api/settings/logistics-subcategories", { credentials: "include" }).then((r) => r.ok ? r.json() : [...LOGISTICS_SUBCATEGORIES]),
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (!p.isActive) return false;
      if (filterType !== "all" && p.itemType !== filterType) return false;
      if (filterSubcat !== "all" && p.subcategory !== filterSubcat) return false;
      if (search) {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      }
      return true;
    });
  }, [products, filterType, filterSubcat, search]);

  return (
    <Popover open={open && !disabled} onOpenChange={(o) => { setOpen(o); if (o) setTimeout(() => searchRef.current?.focus(), 50); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="w-full justify-start text-left font-normal text-slate-300 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50 truncate"
          data-testid="button-item-picker"
        >
          <Search className="h-3.5 w-3.5 mr-1.5 shrink-0 text-slate-400" />
          <span className="truncate">{currentName ? currentName : "Pilih dari master item…"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0 bg-slate-900 border-slate-700" align="start">
        <div className="p-2 border-b border-slate-700 space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau SKU…"
              className="w-full pl-7 pr-3 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder:text-slate-500 outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex gap-1.5">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as typeof filterType)}
              className="flex-1 text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 outline-none"
            >
              <option value="all">Semua Jenis</option>
              <option value="barang">Barang</option>
              <option value="jasa">Jasa</option>
            </select>
            <select
              value={filterSubcat}
              onChange={(e) => setFilterSubcat(e.target.value)}
              className="flex-1 text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 outline-none"
            >
              <option value="all">Semua Sub-Kat</option>
              {subcatList.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="max-h-[240px] overflow-y-auto">
          <button
            onClick={() => { onSelect(null); setOpen(false); setSearch(""); }}
            className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 border-b border-slate-700/50"
          >
            — Custom / isi manual —
          </button>
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-slate-500 py-6">Tidak ada item ditemukan</p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => { onSelect(p); setOpen(false); setSearch(""); }}
                className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors border-b border-slate-700/30 last:border-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {p.itemType === "jasa"
                      ? <Wrench className="h-3 w-3 text-blue-400 shrink-0" />
                      : <Package className="h-3 w-3 text-amber-400 shrink-0" />
                    }
                    <span className="text-sm text-slate-200 truncate">{p.name}</span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">{p.unit}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 pl-5">
                  <span className="text-xs text-slate-500 font-mono">{p.sku}</span>
                  {p.subcategory && <span className="text-xs text-slate-500">· {p.subcategory}</span>}
                  {p.price > 0 && (
                    <span className="text-xs text-emerald-400 ml-auto">
                      {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(p.price)}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
        <div className="p-2 border-t border-slate-700">
          <button
            onClick={() => { setOpen(false); onAddNew(); }}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-blue-400 hover:text-blue-300 hover:bg-slate-800 rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah Item Baru ke Master
            <ExternalLink className="h-3 w-3 ml-auto" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

interface LineDraft {
  productId?: number | null;
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  salesUomId?: number | null;
}

interface UomRow {
  id: number;
  name: string;
  symbol: string;
  category: string;
  is_active: boolean;
}

interface StockCheckResult {
  productId: number;
  itemType: string;
  baseUnit: string;
  baseUomId: number | null;
  baseUomSymbol: string;
  baseAvailable: number;
  salesUomId: number | null;
  salesUomSymbol: string;
  available: number;
  conversionAvailable: boolean;
}

function StockBadge({ productId, salesUomId, qty }: { productId: number; salesUomId: number | null; qty: number }) {
  const { data, isLoading, isError } = useQuery<StockCheckResult>({
    queryKey: ["/api/inventory/stock/check", productId, salesUomId],
    queryFn: async () => {
      const params = new URLSearchParams({ productId: String(productId) });
      if (salesUomId) params.set("salesUomId", String(salesUomId));
      const res = await fetch(`/api/inventory/stock/check?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("stock check failed");
      return res.json();
    },
    staleTime: 30_000,
    gcTime: 60_000,
  });

  if (isLoading) return <span className="text-[10px] text-muted-foreground animate-pulse mt-1 block">memuat stok…</span>;
  if (isError || !data) return null;
  if (data.itemType !== "barang") return null;

  const avail = data.available;
  const symbol = data.salesUomSymbol;

  const colorClass =
    avail <= 0 ? "text-red-500 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800"
    : avail < qty ? "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800"
    : "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800";

  const label = avail <= 0 ? "Stok habis" : `Stok: ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(avail)} ${symbol}`;

  return (
    <span className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded border text-[10px] font-medium leading-none ${colorClass}`}>
      {avail < qty && avail > 0 && <span title="Stok kurang dari qty yang diinput">⚠</span>}
      {label}
      {!data.conversionAvailable && salesUomId && (
        <span className="text-muted-foreground ml-0.5" title="Tidak ada konversi UOM — stok ditampilkan dalam satuan dasar">({data.baseUomSymbol})</span>
      )}
    </span>
  );
}

interface EditorProps { kind?: "quote" | "order" }

export default function SalesDocumentEditorPage({ kind: propKind }: EditorProps = {}) {
  const [, paramsNew] = useRoute("/sales/quotations/new");
  const [, paramsOrderNew] = useRoute("/sales/orders/new");
  const [, paramsQuote] = useRoute("/sales/quotations/:id");
  const [, paramsOrder] = useRoute("/sales/orders/:id");
  const [, navigate] = useLocation();

  // Read URL query params for pre-fill when coming from portal order
  const urlParams = new URLSearchParams(window.location.search);
  const fromPortal = urlParams.get("fromPortal") ?? null;       // e.g. "CST/2026/000123"
  // prop kind takes precedence, then URL param, then route detection
  const urlKind = propKind ?? (paramsOrderNew !== null || paramsOrder !== null ? "order" : urlParams.get("kind"));
  const urlCustomer = urlParams.get("customer") ?? "";
  const urlOrigin = urlParams.get("origin") ?? "";
  const urlDestination = urlParams.get("destination") ?? "";
  const urlPrice = urlParams.get("price") ?? "";
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();

  const isNew = !!paramsNew || !!paramsOrderNew;
  const idStr = paramsQuote?.id ?? paramsOrder?.id;
  const id = idStr ? Number(idStr) : null;

  const { data: doc, isLoading: docLoading } = useGetSalesDocument(id ?? 0, {
    query: {
      enabled: !isNew && id !== null,
      queryKey: getGetSalesDocumentQueryKey(id ?? 0),
    },
  });

  const paylabsMut = useCreateSalesPaymentLink();
  const createPaymentMut = useCreateAccountingPayment();
  const { data: journals = [] } = useListJournals();
  const bankCashJournals = journals.filter((j) => j.type === "bank" || j.type === "cash");

  const paymentQueryParams = { sourceType: "sales_order", sourceDocId: id ?? 0 };
  const { data: linkedPayments = [], isLoading: paymentsLoading } = useListAccountingPayments(
    paymentQueryParams,
    {
      query: {
        enabled: !!paramsOrder && id !== null,
        queryKey: getListAccountingPaymentsQueryKey(paymentQueryParams),
      },
    },
  );

  const today = new Date().toISOString().slice(0, 10);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payForm, setPayForm] = useState({ journalId: "", date: today, ref: "", memo: "", amount: "" });

  const openPayDialog = () => {
    if (!doc || !id) return;
    const balanceDue = Math.max(0, Number(doc.grandTotal ?? 0) - Number(doc.amountPaid ?? 0));
    setPayForm({
      journalId: bankCashJournals.length > 0 ? String(bankCashJournals[0]!.id) : "",
      date: today,
      ref: doc.docNumber ?? "",
      memo: `Pembayaran invoice ${doc.docNumber ?? ""}`,
      amount: String(balanceDue > 0 ? balanceDue : (doc.grandTotal ?? 0)),
    });
    setPayDialogOpen(true);
  };

  const submitPayment = async () => {
    if (!doc || !id || !payForm.journalId || !payForm.date || !payForm.amount) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    const amt = Number(payForm.amount);
    if (Number.isNaN(amt) || amt <= 0) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    try {
      await createPaymentMut.mutateAsync({
        data: {
          paymentType: "inbound",
          amount: amt,
          journalId: Number(payForm.journalId),
          partnerName: doc.customerName,
          date: payForm.date,
          ref: payForm.ref || undefined,
          memo: payForm.memo || undefined,
          sourceType: "sales_order",
          sourceDocId: id,
        },
      });
      toast({ title: t.common.success, description: doc.docNumber });
      qc.invalidateQueries({ queryKey: getListAccountingPaymentsQueryKey({ sourceType: "sales_order", sourceDocId: id }) });
      qc.invalidateQueries({ queryKey: getGetSalesDocumentQueryKey(id) });
      setPayDialogOpen(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(err);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    }
  };

  const [scanOpen, setScanOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [fwdVendorIds, setFwdVendorIds] = useState<number[]>([]);
  const [fwdChannels, setFwdChannels] = useState<string[]>(["wa", "email"]);
  const [fwdResults, setFwdResults] = useState<VendorSendResult[] | null>(null);

  const forwardMut = useForwardSalesDocumentToVendors();
  const { data: eligibleVendors = [] } = useListEligibleVendorsForDoc(
    id ?? 0,
    { query: { enabled: !!id && forwardOpen, queryKey: getListEligibleVendorsForDocQueryKey(id ?? 0) } },
  );

  function toggleFwdChannel(ch: string) {
    setFwdChannels((prev) => prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]);
  }
  function toggleFwdVendor(vid: number) {
    setFwdVendorIds((prev) => prev.includes(vid) ? prev.filter((v) => v !== vid) : [...prev, vid]);
  }

  const handleScannedData = (data: ScannedDocumentData) => {
    if (data.partyName) setCustomerName(data.partyName);
    if (data.dueDate) setValidUntil(data.dueDate.slice(0, 10));
    if (data.docDate) setExpectedDate(data.docDate.slice(0, 10));
    if (data.notes) setNotes(data.notes);
    if (data.lines && data.lines.length > 0) {
      setLines(data.lines.map((l) => ({
        name: l.name,
        description: l.description ?? null,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })));
    }
  };

  const downloadPdf = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/sales/documents/${id}/pdf`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: t.common.error, variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    }
  };
  const payViaPaylabs = async () => {
    if (!id) return;
    try {
      const res = await paylabsMut.mutateAsync({ id });
      if (res.payment.paymentUrl) {
        window.open(res.payment.paymentUrl, "_blank");
        toast({ title: t.common.success });
      } else if (!res.configured) {
        toast({ title: t.common.success });
      } else {
        toast({ title: t.common.success, description: `ID: ${res.payment.id}` });
      }
    } catch (e: any) {
      toast({ title: t.common.error, variant: "destructive" });
    }
  };
  const { data: customers } = useListCustomers();
  const { data: _productsPaginated } = useListProducts({ limit: 500 });
  const products = _productsPaginated?.data;
  const { data: taxes } = useListTaxes();
  const { data: acctSettings } = useGetAccountingSettings();
  const { data: uomList = [] } = useQuery<UomRow[]>({
    queryKey: ["/api/uom"],
    queryFn: () => fetch("/api/uom", { credentials: "include" }).then((r) => r.json()),
  });
  const createMut = useCreateSalesDocument();
  const updateMut = useUpdateSalesDocument();
  const actionMut = useSalesDocumentAction();
  const deleteMut = useDeleteSalesDocument();
  const createCustomerMut = useCreateCustomer();

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [addCustomerForm, setAddCustomerForm] = useState({ name: "", email: "", phone: "", address: "", taxId: "", notes: "", defaultSalesTaxId: null as number | null });
  const [editingNpwp, setEditingNpwp] = useState(false);
  const [npwpDraft, setNpwpDraft] = useState("");
  const [npwpSaving, setNpwpSaving] = useState(false);
  const [validUntil, setValidUntil] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { name: "", quantity: 1, unitPrice: 0 },
  ]);
  const [taxRateId, setTaxRateId] = useState<number | null>(null);
  const [taxApplied, setTaxApplied] = useState(false);
  const [taxAutoFilledFrom, setTaxAutoFilledFrom] = useState<"customer" | "settings" | "product" | null>(null);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [transportMode, setTransportMode] = useState("");
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");

  useEffect(() => {
    if (doc) {
      setCustomerId(doc.customerId ?? null);
      setCustomerName(doc.customerName);
      setValidUntil(doc.validUntil ? doc.validUntil.slice(0, 10) : "");
      setExpectedDate(doc.expectedDate ? doc.expectedDate.slice(0, 10) : "");
      setNotes(doc.notes ?? "");
      setTaxRateId(doc.taxRateId ?? null);
      setTaxApplied(true);
      setOrigin((doc as any).origin ?? "");
      setDestination((doc as any).destination ?? "");
      setTransportMode((doc as any).transportMode ?? "");
      setEtd((doc as any).etd ? String((doc as any).etd).slice(0, 10) : "");
      setEta((doc as any).eta ? String((doc as any).eta).slice(0, 10) : "");
      setLines(
        doc.lines.length > 0
          ? doc.lines.map((l) => ({
              productId: l.productId ?? null,
              name: l.name,
              description: l.description ?? null,
              quantity: Number(l.quantity),
              unitPrice: Number(l.unitPrice),
              salesUomId: (l as any).salesUomId ?? null,
            }))
          : [{ name: "", quantity: 1, unitPrice: 0 }],
      );
    }
  }, [doc]);

  useEffect(() => {
    if (isNew && !taxApplied && acctSettings?.defaultSalesTaxId) {
      setTaxRateId(acctSettings.defaultSalesTaxId);
      setTaxApplied(true);
      setTaxAutoFilledFrom("settings");
    }
  }, [isNew, taxApplied, acctSettings]);

  // Pre-fill form when navigating from a portal order (fromPortal query param)
  const [portalPrefillDone, setPortalPrefillDone] = useState(false);
  useEffect(() => {
    if (!isNew || portalPrefillDone) return;
    if (!fromPortal) return;
    if (urlCustomer) setCustomerName(urlCustomer);
    if (urlOrigin) setOrigin(urlOrigin);
    if (urlDestination) setDestination(urlDestination);
    if (urlPrice) {
      const price = parseFloat(urlPrice);
      if (!isNaN(price) && price > 0) {
        setLines([{ name: "Jasa Pengiriman", quantity: 1, unitPrice: price }]);
      }
    }
    setNotes(`Dibuat dari Portal Order: ${fromPortal}`);
    setPortalPrefillDone(true);
  }, [isNew, fromPortal, portalPrefillDone, urlCustomer, urlOrigin, urlDestination, urlPrice]);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0),
    [lines],
  );
  const selectedTax = useMemo(() => taxes?.find((t) => t.id === taxRateId) ?? null, [taxes, taxRateId]);
  const taxAmount = useMemo(() => selectedTax ? Math.round(subtotal * Number(selectedTax.rate)) / 100 : 0, [subtotal, selectedTax]);
  const grandTotal = subtotal + taxAmount;
  const total = subtotal;

  const isEditable = isNew || (doc && (doc.status === "draft" || doc.status === "sent"));
  const selectedCustomer = (customers ?? []).find((c) => c.id === customerId) ?? null;

  useEffect(() => {
    setNpwpDraft(selectedCustomer?.taxId ?? "");
    setEditingNpwp(false);
  }, [selectedCustomer?.id]);

  const handleSaveNpwp = async () => {
    if (!selectedCustomer) return;
    setNpwpSaving(true);
    try {
      const resp = await fetch(`/api/sales/customers/${selectedCustomer.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxId: npwpDraft.trim() || null }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      setEditingNpwp(false);
      toast({ title: "NPWP customer diperbarui" });
    } catch {
      toast({ title: "Gagal menyimpan NPWP", variant: "destructive" });
    } finally {
      setNpwpSaving(false);
    }
  };

  const setLine = (idx: number, patch: Partial<LineDraft>) => {
    setLines((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((arr) => [...arr, { name: "", quantity: 1, unitPrice: 0 }]);
  const removeLine = (idx: number) => setLines((arr) => arr.filter((_, i) => i !== idx));

  const onItemSelect = (idx: number, product: Product | null) => {
    if (!product) {
      setLine(idx, { productId: null });
      return;
    }
    setLine(idx, {
      productId: product.id,
      name: product.name,
      unitPrice: Number(product.price),
    });
    const currentCustomer = (customers ?? []).find((c) => c.id === customerId);
    setTaxRateId(
      product.defaultSalesTaxId
      ?? currentCustomer?.defaultSalesTaxId
      ?? acctSettings?.defaultSalesTaxId
      ?? null
    );
    if (product.defaultSalesTaxId) {
      setTaxAutoFilledFrom("product");
    } else if (currentCustomer?.defaultSalesTaxId) {
      setTaxAutoFilledFrom("customer");
    } else if (acctSettings?.defaultSalesTaxId) {
      setTaxAutoFilledFrom("settings");
    } else {
      setTaxAutoFilledFrom(null);
    }
  };

  const onCustomerChange = (val: string) => {
    if (val === "__none") {
      setCustomerId(null);
      return;
    }
    const cid = Number(val);
    setCustomerId(cid);
    const c = (customers ?? []).find((x) => x.id === cid);
    if (c) {
      setCustomerName(c.name);
      if (isNew || taxRateId === null) {
        setTaxRateId(c.defaultSalesTaxId ?? acctSettings?.defaultSalesTaxId ?? null);
        setTaxAutoFilledFrom(c.defaultSalesTaxId ? "customer" : "settings");
      }
    }
  };

  const handleSaveNewCustomer = async () => {
    if (!addCustomerForm.name.trim()) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    try {
      const created: Customer = await createCustomerMut.mutateAsync({
        data: {
          name: addCustomerForm.name.trim(),
          email: addCustomerForm.email.trim() || undefined,
          phone: addCustomerForm.phone.trim() || undefined,
          address: addCustomerForm.address.trim() || undefined,
          taxId: addCustomerForm.taxId.trim() || undefined,
          notes: addCustomerForm.notes.trim() || undefined,
          defaultSalesTaxId: addCustomerForm.defaultSalesTaxId ?? undefined,
        },
      });
      qc.setQueryData<Customer[]>(getListCustomersQueryKey(), (old) =>
        old ? [...old, created] : [created]
      );
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      setCustomerId(created.id);
      setCustomerName(created.name);
      if (isNew || taxRateId === null) {
        setTaxRateId(created.defaultSalesTaxId ?? acctSettings?.defaultSalesTaxId ?? null);
        setTaxAutoFilledFrom(created.defaultSalesTaxId ? "customer" : "settings");
      }
      setAddCustomerOpen(false);
      setAddCustomerForm({ name: "", email: "", phone: "", address: "", taxId: "", notes: "", defaultSalesTaxId: null });
      toast({ title: t.common.success });
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const validate = (): string | null => {
    if (!customerName.trim()) return "Customer wajib diisi";
    if (lines.length === 0) return "Minimal satu baris item";
    for (const l of lines) {
      if (!l.name.trim()) return "Nama produk pada setiap baris wajib diisi";
      if (Number(l.quantity) <= 0) return "Kuantitas harus > 0";
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    const isPortalOrder = !!(fromPortal || urlKind === "order");
    const body = {
      kind: (isPortalOrder ? "order" : "quote") as "order" | "quote",
      customerId,
      customerName,
      taxRateId: taxRateId ?? null,
      validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      expectedDate: expectedDate ? new Date(expectedDate).toISOString() : null,
      notes: notes || null,
      origin: origin || null,
      destination: destination || null,
      transportMode: (transportMode || null) as import("@workspace/api-client-react").CreateSalesDocumentBodyTransportMode | undefined,
      etd: etd || null,
      eta: eta || null,
      lines: lines.map((l) => ({
        productId: l.productId ?? null,
        name: l.name,
        description: l.description ?? null,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        salesUomId: l.salesUomId ?? null,
      })),
    };
    try {
      if (isNew) {
        const created = await createMut.mutateAsync({ data: body });
        qc.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey() });
        toast({ title: t.common.success, description: created.docNumber });
        // Jika dibuat sebagai SO (dari portal order), navigasi ke halaman orders
        const isPortalOrder2 = !!(fromPortal || urlKind === "order");
        navigate(isPortalOrder2 ? `/sales/orders/${created.id}` : `/sales/quotations/${created.id}`);
      } else if (id) {
        await updateMut.mutateAsync({ id, data: body });
        qc.invalidateQueries({ queryKey: getGetSalesDocumentQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey() });
        toast({ title: t.common.success });
      }
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const runAction = async (action: "send" | "confirm" | "cancel" | "draft" | "mark_invoiced" | "mark_delivered") => {
    if (!id) return;
    try {
      const result = await actionMut.mutateAsync({ id, data: { action } });
      qc.invalidateQueries({ queryKey: getGetSalesDocumentQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey() });
      toast({ title: t.common.success, description: result.status });
      if (action === "confirm") navigate(`/sales/orders/${id}`);
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const remove = async () => {
    if (!id) return;
    if (!confirm("Hapus dokumen ini?")) return;
    try {
      await deleteMut.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListSalesDocumentsQueryKey() });
      toast({ title: t.common.success });
      navigate("/sales/quotations");
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const isOrderView = !!paramsOrder;
  const backHref = isOrderView ? "/sales/orders" : "/sales/quotations";

  const expensesQueryParams = { salesDocId: id ?? 0 };
  const { data: linkedExpenses = [], isLoading: expensesLoading } = useListExpenses(
    expensesQueryParams,
    { query: { enabled: isOrderView && id !== null, queryKey: getListExpensesQueryKey(expensesQueryParams) } },
  );
  const shipmentsQueryParams = { salesDocId: id ?? 0 };
  const { data: linkedShipments = [] } = useListFreightShipments(
    shipmentsQueryParams,
    { query: { enabled: isOrderView && id !== null, queryKey: getListFreightShipmentsQueryKey(shipmentsQueryParams) } },
  );
  const idr = (n: number) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

  if (!isNew && docLoading) {
    return <AppShell><LoadingSkeleton variant="detail" count={6} className="p-6" /></AppShell>;
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href={backHref}>
              <Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">
                {isNew ? (fromPortal ? "Buat Sales Order" : "Quotation Baru") : doc?.docNumber}
              </h1>
              {doc && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="capitalize">{doc.kind}</Badge>
                  <Badge variant="secondary" className="capitalize">{doc.status}</Badge>
                  {doc.kind === "order" && (
                    <>
                      <Badge variant="outline" className="capitalize">Invoice: {doc.invoiceStatus.replace("_", " ")}</Badge>
                      <Badge variant="outline" className="capitalize">Delivery: {doc.deliveryStatus.replace("_", " ")}</Badge>
                      {(() => {
                        const paid = doc.amountPaid ?? 0;
                        const total = doc.grandTotal;
                        if (paid >= total - 0.005)
                          return <Badge className="bg-emerald-900/50 text-emerald-300 border-emerald-700" data-testid="badge-payment-status">Bayar: Lunas</Badge>;
                        if (paid > 0.005)
                          return <Badge className="bg-amber-900/50 text-amber-300 border-amber-700" data-testid="badge-payment-status">Bayar: Sebagian</Badge>;
                        return <Badge variant="outline" className="text-slate-400 border-slate-600" data-testid="badge-payment-status">Bayar: Belum Bayar</Badge>;
                      })()}
                      {(() => {
                        if (!doc.expectedDate) return null;
                        if (doc.paymentStatus === "paid") return null;
                        if (doc.invoiceStatus === "none") return null;
                        if (new Date(doc.expectedDate) >= new Date(new Date().toDateString())) return null;
                        return <Badge className="bg-red-900/50 text-red-300 border-red-700" data-testid="badge-overdue">Jatuh Tempo</Badge>;
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {isEditable && (
              <Button variant="outline" onClick={() => setScanOpen(true)} data-testid="button-scan">
                <ScanLine className="mr-2 h-4 w-4" /> Scan Dokumen
              </Button>
            )}
            {isEditable && (
              <Button onClick={save} disabled={createMut.isPending || updateMut.isPending} data-testid="button-save">
                <Save className="mr-2 h-4 w-4" /> Simpan
              </Button>
            )}
            {!isNew && doc?.status === "draft" && (
              <Button variant="outline" onClick={() => runAction("send")} data-testid="button-send"><Send className="mr-2 h-4 w-4" /> Kirim</Button>
            )}
            {!isNew && (doc?.status === "draft" || doc?.status === "sent") && (
              <Button variant="default" onClick={() => runAction("confirm")} data-testid="button-confirm"><Check className="mr-2 h-4 w-4" /> Konfirmasi</Button>
            )}
            {!isNew && doc?.kind === "order" && doc?.invoiceStatus === "to_invoice" && (
              <Button variant="outline" onClick={() => runAction("mark_invoiced")} data-testid="button-invoice"><Receipt className="mr-2 h-4 w-4" /> Invoiced</Button>
            )}
            {!isNew && doc?.kind === "order" && doc?.deliveryStatus === "to_deliver" && (
              <Button variant="outline" onClick={() => runAction("mark_delivered")} data-testid="button-deliver"><Truck className="mr-2 h-4 w-4" /> Delivered</Button>
            )}
            {!isNew && doc?.status === "cancelled" && (
              <Button variant="outline" onClick={() => runAction("draft")} data-testid="button-redraft"><FileEdit className="mr-2 h-4 w-4" /> Set ke Draft</Button>
            )}
            {!isNew && doc && doc.status !== "cancelled" && doc.status !== "done" && (
              <Button variant="outline" onClick={() => runAction("cancel")} data-testid="button-cancel"><X className="mr-2 h-4 w-4" /> Batalkan</Button>
            )}
            {!isNew && doc?.status === "draft" && (
              <Button variant="ghost" onClick={remove} data-testid="button-delete"><Trash2 className="mr-2 h-4 w-4 text-destructive" /></Button>
            )}
            {!isNew && doc && (
              <Button variant="outline" onClick={downloadPdf} data-testid="button-download-pdf">
                <Printer className="mr-2 h-4 w-4" /> Cetak PDF
              </Button>
            )}
            {!isNew && doc && (
              <Button variant="outline" onClick={() => setEmailOpen(true)} data-testid="button-send-email">
                <Mail className="mr-2 h-4 w-4" /> Kirim Email
              </Button>
            )}
            {!isNew && doc?.aiGenerated && doc?.status === "draft" && (
              <Button
                className="bg-purple-600 hover:bg-purple-700 text-white"
                onClick={() => setForwardOpen(true)}
                disabled={forwardMut.isPending}
                data-testid="button-forward-vendors"
              >
                <SendHorizonal className="mr-2 h-4 w-4" /> Forward ke Vendor
              </Button>
            )}
            {!isNew && doc?.kind === "order" && doc?.status === "confirmed" && doc?.invoiceStatus === "to_invoice" && (
              <Button variant="default" onClick={payViaPaylabs} disabled={paylabsMut.isPending} data-testid="button-pay-paylabs">
                <CreditCard className="mr-2 h-4 w-4" /> Bayar via Paylabs
              </Button>
            )}
          </div>
        </div>

        {doc?.aiGenerated && (
          <Card className="border-purple-700/60 bg-purple-950/20">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-purple-300 text-base">
                <Bot className="h-4 w-4" /> Sumber AI
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {doc.aiSourceWaPhone ? (
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-green-400 shrink-0" />
                  <span className="text-muted-foreground">Dari WhatsApp:</span>
                  <span className="font-medium">{doc.aiSourceWaPhone}</span>
                </div>
              ) : doc.aiSourceCorrespondenceId ? (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-400 shrink-0" />
                  <span className="text-muted-foreground">Dari Email (korespondensi #</span>
                  <a
                    href={`/correspondences?id=${doc.aiSourceCorrespondenceId}`}
                    className="text-blue-400 hover:underline font-medium"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {doc.aiSourceCorrespondenceId}
                  </a>
                  <span className="text-muted-foreground">)</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-purple-400 shrink-0" />
                  <span className="text-muted-foreground">Draft dibuat otomatis oleh AI</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {fromPortal && isNew && (
          <div className="flex items-center gap-3 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
            <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
            <span>
              Membuat <strong>Sales Order</strong> dari portal order{" "}
              <strong>{fromPortal}</strong>. Formulir sudah diisi otomatis — periksa dan sesuaikan sebelum menyimpan.
            </span>
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>Informasi Customer</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Customer</Label>
                {isEditable && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => setAddCustomerOpen(true)}>
                    <Plus className="h-3 w-3 mr-1" /> Tambah Baru
                  </Button>
                )}
              </div>
              <Select value={customerId !== null ? String(customerId) : "__none"} onValueChange={onCustomerChange} disabled={!isEditable}>
                <SelectTrigger data-testid="select-customer"><SelectValue placeholder="Pilih customer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Bebas (isi nama manual) —</SelectItem>
                  {(customers ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Nama Customer</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} disabled={!isEditable} data-testid="input-customer-name" />
            </div>
            {selectedCustomer && (
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label>NPWP Customer</Label>
                  {!editingNpwp && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground"
                      onClick={() => setEditingNpwp(true)}
                    >
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                  )}
                </div>
                {editingNpwp ? (
                  <div className="flex gap-1.5">
                    <Input
                      value={npwpDraft}
                      onChange={(e) => setNpwpDraft(e.target.value)}
                      placeholder="Masukkan NPWP…"
                      className="flex-1"
                      data-testid="input-customer-tax-id"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void handleSaveNpwp(); }
                        if (e.key === "Escape") { setEditingNpwp(false); setNpwpDraft(selectedCustomer.taxId ?? ""); }
                      }}
                    />
                    <Button type="button" size="icon" variant="default" className="shrink-0" onClick={() => void handleSaveNpwp()} disabled={npwpSaving}>
                      {npwpSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="shrink-0" onClick={() => { setEditingNpwp(false); setNpwpDraft(selectedCustomer.taxId ?? ""); }} disabled={npwpSaving}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Input
                    value={selectedCustomer.taxId ?? ""}
                    readOnly
                    disabled
                    data-testid="input-customer-tax-id"
                    className="bg-muted text-muted-foreground cursor-default"
                    placeholder="Belum diisi"
                  />
                )}
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Berlaku Hingga</Label>
              <DatePicker value={validUntil} onChange={setValidUntil} disabled={!isEditable} />
            </div>
            <div className="grid gap-1.5">
              <Label>Tanggal Diharapkan</Label>
              <DatePicker value={expectedDate} onChange={setExpectedDate} disabled={!isEditable} />
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label>Catatan</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!isEditable} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-4 w-4" /> Detail Logistik
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>Asal</Label>
              <Input value={origin} onChange={(e) => setOrigin(e.target.value)} disabled={!isEditable} placeholder="Jakarta, Indonesia" data-testid="input-origin" />
            </div>
            <div className="grid gap-1.5">
              <Label>Tujuan</Label>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} disabled={!isEditable} placeholder="Singapore" data-testid="input-destination" />
            </div>
            <div className="grid gap-1.5">
              <Label>Moda Transportasi</Label>
              <Select value={transportMode || "__none"} onValueChange={(v) => setTransportMode(v === "__none" ? "" : v)} disabled={!isEditable}>
                <SelectTrigger data-testid="select-transport-mode"><SelectValue placeholder="Pilih moda..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Belum ditentukan —</SelectItem>
                  <SelectItem value="sea">Laut (Sea)</SelectItem>
                  <SelectItem value="air">Udara (Air)</SelectItem>
                  <SelectItem value="land">Darat (Land)</SelectItem>
                  <SelectItem value="multimodal">Multimodal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5" />
            <div className="grid gap-1.5">
              <Label>ETD (Est. Time of Departure)</Label>
              <DatePicker value={etd} onChange={(v) => setEtd(v)} disabled={!isEditable} data-testid="input-etd" />
            </div>
            <div className="grid gap-1.5">
              <Label>ETA (Est. Time of Arrival)</Label>
              <DatePicker value={eta} onChange={(v) => setEta(v)} disabled={!isEditable} data-testid="input-eta" />
            </div>
          </CardContent>
        </Card>

        {(doc as any)?.templateSnapshot && (
          <TemplateSnapshotCard templateSnapshot={(doc as any).templateSnapshot} />
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Item</CardTitle>
            {isEditable && (
              <Button size="sm" variant="outline" onClick={addLine} data-testid="button-add-line">
                <Plus className="mr-2 h-4 w-4" /> Tambah Baris
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Produk</TableHead>
                  <TableHead>Deskripsi</TableHead>
                  <TableHead className="w-[80px] text-right">Qty</TableHead>
                  <TableHead className="w-[110px]">UOM</TableHead>
                  <TableHead className="w-[150px] text-right">Harga Satuan</TableHead>
                  <TableHead className="w-[150px] text-right">Subtotal</TableHead>
                  {isEditable && <TableHead className="w-[40px]"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, idx) => (
                  <TableRow key={idx} data-testid={`row-line-${idx}`}>
                    <TableCell>
                      <ItemPicker
                        products={products ?? []}
                        onSelect={(p) => onItemSelect(idx, p)}
                        onAddNew={() => navigate("/sales/items")}
                        disabled={!isEditable}
                        currentName={l.productId ? l.name : undefined}
                      />
                      <Input
                        className="mt-1.5"
                        placeholder="Nama item"
                        value={l.name}
                        onChange={(e) => setLine(idx, { name: e.target.value })}
                        disabled={!isEditable}
                        data-testid={`input-line-name-${idx}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        rows={1}
                        value={l.description ?? ""}
                        onChange={(e) => setLine(idx, { description: e.target.value })}
                        disabled={!isEditable}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="text-right"
                        value={l.quantity}
                        onChange={(e) => setLine(idx, { quantity: Number(e.target.value) })}
                        disabled={!isEditable}
                        data-testid={`input-line-qty-${idx}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={l.salesUomId ? String(l.salesUomId) : "__none"}
                        onValueChange={(v) => setLine(idx, { salesUomId: v === "__none" ? null : Number(v) })}
                        disabled={!isEditable}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">—</SelectItem>
                          {uomList.filter((u) => u.is_active).map((u) => (
                            <SelectItem key={u.id} value={String(u.id)}>
                              {u.name} ({u.symbol})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {l.productId && (
                        <StockBadge
                          productId={l.productId}
                          salesUomId={l.salesUomId ?? null}
                          qty={l.quantity}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="text-right"
                        value={l.unitPrice}
                        onChange={(e) => setLine(idx, { unitPrice: Number(e.target.value) })}
                        disabled={!isEditable}
                        data-testid={`input-line-price-${idx}`}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {idr(Number(l.quantity || 0) * Number(l.unitPrice || 0))}
                    </TableCell>
                    {isEditable && (
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => removeLine(idx)} disabled={lines.length === 1}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-between mt-4 gap-6">
              <div className="w-64">
                <Label>Pajak (PPN)</Label>
                <Select
                  value={taxRateId ? String(taxRateId) : "none"}
                  onValueChange={(v) => { setTaxRateId(v === "none" ? null : parseInt(v)); setTaxAutoFilledFrom(null); }}
                  disabled={!isEditable}
                >
                  <SelectTrigger data-testid="select-doc-tax"><SelectValue placeholder="Tanpa pajak" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tanpa pajak —</SelectItem>
                    {(taxes ?? []).filter((t) => t.kind === "sale" && t.isActive).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.rate}%)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {taxAutoFilledFrom && taxRateId && (
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-tax-autofill-hint">
                    {taxAutoFilledFrom === "customer" ? "(default dari customer)" : taxAutoFilledFrom === "product" ? "(default dari produk)" : "(default dari pengaturan)"}
                  </p>
                )}
              </div>
              <div className="text-right space-y-1">
                <div className="text-sm text-muted-foreground">Subtotal: <span className="font-mono ml-2" data-testid="text-subtotal">{idr(subtotal)}</span></div>
                {selectedTax && <div className="text-sm text-muted-foreground">{selectedTax.name}: <span className="font-mono ml-2" data-testid="text-tax-amount">{idr(taxAmount)}</span></div>}
                <div className="text-sm text-muted-foreground">Grand Total</div>
                <div className="text-2xl font-bold" data-testid="text-total">{idr(grandTotal)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        {isOrderView && id && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Pembayaran
              </CardTitle>
              {doc?.kind === "order" &&
                doc?.invoiceStatus === "invoiced" &&
                Math.max(0, Number(doc?.grandTotal ?? 0) - Number(doc?.amountPaid ?? 0)) > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openPayDialog}
                  data-testid="button-record-payment"
                >
                  <CreditCard className="mr-2 h-4 w-4" /> Bayar
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <QueryState
                loading={paymentsLoading}
                empty={!paymentsLoading && linkedPayments.length === 0}
                emptyMessage="Belum ada pembayaran tercatat."
                skeletonRows={3}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Mitra</TableHead>
                      <TableHead>Jurnal</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedPayments.map((p) => (
                      <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                        <TableCell>{p.date.slice(0, 10)}</TableCell>
                        <TableCell>{p.partnerName ?? "-"}</TableCell>
                        <TableCell>{journals.find((j) => j.id === p.journalId)?.name ?? "-"}</TableCell>
                        <TableCell className="text-right font-mono">{idr(Number(p.amount))}</TableCell>
                        <TableCell>
                          {p.entryId && (
                            <Link href={`/accounting/entries/${p.entryId}`}>
                              <Button variant="ghost" size="sm" data-testid={`link-entry-${p.id}`}>
                                <FileText className="h-3 w-3" />
                              </Button>
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </QueryState>
              {doc?.kind === "order" && (
                <div className="mt-4 pt-3 border-t border-slate-700/50 space-y-1.5 text-sm" data-testid="payment-summary">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Total Tagihan</span>
                    <span className="font-mono tabular-nums" data-testid="summary-grand-total">{idr(Number(doc.grandTotal))}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Total Dibayar</span>
                    <span className="font-mono tabular-nums text-emerald-400" data-testid="summary-amount-paid">{idr(Number(doc.amountPaid ?? 0))}</span>
                  </div>
                  <div className="flex items-center justify-between font-semibold border-t border-slate-700/30 pt-1.5">
                    <span className="text-slate-200">Sisa</span>
                    <span
                      className={`font-mono tabular-nums ${Math.max(0, Number(doc.grandTotal) - Number(doc.amountPaid ?? 0)) > 0.005 ? "text-amber-400" : "text-emerald-400"}`}
                      data-testid="summary-balance-due"
                    >
                      {idr(Math.max(0, Number(doc.grandTotal) - Number(doc.amountPaid ?? 0)))}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isOrderView && id && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Receipt className="h-4 w-4" /> Biaya Terkait
                </CardTitle>
                <Link href={`/expense/new?salesDocId=${id}`}>
                  <Button size="sm" variant="outline" className="gap-1 text-xs">
                    <Plus className="h-3 w-3" /> Tambah Biaya
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <QueryState
                loading={expensesLoading}
                empty={!expensesLoading && linkedExpenses.length === 0}
                emptyMessage="Belum ada biaya terkait pesanan ini."
                skeletonRows={2}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Biaya</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Vendor / Pegawai</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedExpenses.map((exp) => (
                      <TableRow key={exp.id}>
                        <TableCell className="font-mono text-xs">{exp.expenseNumber}</TableCell>
                        <TableCell className="text-xs">{exp.date}</TableCell>
                        <TableCell className="text-xs">{exp.vendorEmployee ?? "—"}</TableCell>
                        <TableCell className="text-xs max-w-[180px] truncate">{exp.description ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{exp.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">{idr(exp.total)}</TableCell>
                        <TableCell>
                          <Link href={`/expense/${exp.id}`}>
                            <Button size="icon" variant="ghost" className="h-6 w-6">
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </QueryState>
              {linkedExpenses.length > 0 && (
                <div className="flex justify-end mt-3 pt-3 border-t border-slate-700/50 text-sm font-semibold">
                  <span className="text-muted-foreground mr-4">Total Biaya</span>
                  <span>{idr(linkedExpenses.reduce((s, e) => s + e.total, 0))}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isOrderView && id && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Truck className="h-4 w-4" /> Shipment / Job Terkait
                </CardTitle>
                <Link href={`/logistics/freight/new?salesDocId=${id}${origin ? `&origin=${encodeURIComponent(origin)}` : ""}${destination ? `&destination=${encodeURIComponent(destination)}` : ""}${customerName ? `&consigneeName=${encodeURIComponent(customerName)}` : ""}${transportMode ? `&transportMode=${transportMode}` : ""}`}>
                  <Button size="sm" variant="default" className="gap-1 text-xs">
                    <Plus className="h-3 w-3" /> Buat Pengiriman
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <QueryState
                empty={linkedShipments.length === 0}
                emptyMessage="Belum ada shipment terkait pesanan ini."
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Shipment</TableHead>
                      <TableHead>Asal → Tujuan</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Consignee</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedShipments.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.shipmentNumber}</TableCell>
                        <TableCell className="text-xs">{s.origin} → {s.destination}</TableCell>
                        <TableCell className="text-xs capitalize">{(s as any).transportMode ?? "—"}</TableCell>
                        <TableCell className="text-xs">{s.consigneeName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{s.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Link href={`/logistics/freight/${s.id}`}>
                            <Button size="icon" variant="ghost" className="h-6 w-6">
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </QueryState>
            </CardContent>
          </Card>
        )}

        {!isNew && id && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4" /> Korespondensi Email
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CorrespondenceTab linkedType="sales_order" linkedId={id} />
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Catat Pembayaran — {doc?.docNumber}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label>Jurnal</Label>
              <Select value={payForm.journalId} onValueChange={(v) => setPayForm((f) => ({ ...f, journalId: v }))}>
                <SelectTrigger data-testid="select-pay-journal"><SelectValue placeholder="Pilih jurnal" /></SelectTrigger>
                <SelectContent>
                  {bankCashJournals.map((j) => (
                    <SelectItem key={j.id} value={String(j.id)}>{j.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Tanggal</Label>
              <DatePicker value={payForm.date} onChange={(v) => setPayForm((f) => ({ ...f, date: v }))} data-testid="input-pay-date" />
            </div>
            <div className="grid gap-1.5">
              <Label>Jumlah</Label>
              <Input type="number" min="0" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} data-testid="input-pay-amount" />
            </div>
            <div className="grid gap-1.5">
              <Label>Referensi</Label>
              <Input value={payForm.ref} onChange={(e) => setPayForm((f) => ({ ...f, ref: e.target.value }))} data-testid="input-pay-ref" />
            </div>
            <div className="grid gap-1.5">
              <Label>Memo</Label>
              <Input value={payForm.memo} onChange={(e) => setPayForm((f) => ({ ...f, memo: e.target.value }))} data-testid="input-pay-memo" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialogOpen(false)}>Batal</Button>
            <Button onClick={submitPayment} disabled={createPaymentMut.isPending} data-testid="button-submit-payment">
              Simpan Pembayaran
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScanDocumentDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onDataExtracted={handleScannedData}
        title="Scan Dokumen Penjualan"
      />

      {!isNew && doc && id && (
        <SendEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          docId={id}
          docNumber={doc.docNumber}
          docTitle={doc.kind === "order" ? "Sales Order" : "Quotation"}
          defaultTo={(() => { const c = (customers ?? []).find((x) => x.id === doc.customerId); return c?.email ?? ""; })()}
          module="sales"
        />
      )}

      {/* Inline add-customer dialog */}
      <Dialog open={addCustomerOpen} onOpenChange={(open) => { setAddCustomerOpen(open); if (!open) setAddCustomerForm({ name: "", email: "", phone: "", address: "", taxId: "", notes: "", defaultSalesTaxId: null }); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tambah Customer Baru</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ac-name">Nama <span className="text-destructive">*</span></Label>
              <Input id="ac-name" autoComplete="off" value={addCustomerForm.name} onChange={(e) => setAddCustomerForm((f) => ({ ...f, name: e.target.value }))} data-testid="input-new-customer-name" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ac-email">Email</Label>
              <Input id="ac-email" type="email" value={addCustomerForm.email} onChange={(e) => setAddCustomerForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ac-phone">Telepon</Label>
              <Input id="ac-phone" value={addCustomerForm.phone} onChange={(e) => setAddCustomerForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ac-taxId">NPWP / Tax ID</Label>
              <Input id="ac-taxId" autoComplete="off" value={addCustomerForm.taxId} onChange={(e) => setAddCustomerForm((f) => ({ ...f, taxId: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ac-address">Alamat</Label>
              <GooglePlacesAutocomplete
                value={addCustomerForm.address}
                onChange={(v) => setAddCustomerForm((f) => ({ ...f, address: v }))}
                placeholder="Ketik alamat customer..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Pajak Penjualan Default</Label>
              <Select
                value={addCustomerForm.defaultSalesTaxId !== null ? String(addCustomerForm.defaultSalesTaxId) : "none"}
                onValueChange={(v) => setAddCustomerForm((f) => ({ ...f, defaultSalesTaxId: v === "none" ? null : parseInt(v) }))}
              >
                <SelectTrigger><SelectValue placeholder="Pilih pajak (opsional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak ada —</SelectItem>
                  {(taxes ?? []).filter((t) => t.kind === "sale" && t.isActive).map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.rate}%)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ac-notes">Catatan</Label>
              <Textarea id="ac-notes" value={addCustomerForm.notes} onChange={(e) => setAddCustomerForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCustomerOpen(false)}>Batal</Button>
            <Button onClick={handleSaveNewCustomer} disabled={createCustomerMut.isPending} data-testid="button-save-new-customer">
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Forward ke Vendor Dialog */}
      <Dialog open={forwardOpen} onOpenChange={(o) => { if (!o) { setForwardOpen(false); setFwdVendorIds([]); setFwdChannels(["wa", "email"]); setFwdResults(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-purple-400" />
              Forward ke Vendor
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1 text-sm">
            {fwdResults ? (
              <div className="space-y-2">
                <p className="font-medium text-green-400">✓ Selesai dikirim</p>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {fwdResults.map((r) => (
                    <div key={r.vendorId} className="flex items-center justify-between rounded border border-border px-3 py-1.5 bg-muted/20">
                      <span className="font-medium flex-1">{r.vendorName}</span>
                      <div className="flex gap-2 text-xs">
                        {r.waStatus && (
                          <span className={r.waStatus === "sent" ? "text-green-400" : r.waStatus === "failed" ? "text-red-400" : "text-muted-foreground"}>
                            WA: {r.waStatus}
                          </span>
                        )}
                        {r.emailStatus && (
                          <span className={r.emailStatus === "sent" ? "text-green-400" : r.emailStatus === "failed" ? "text-red-400" : "text-muted-foreground"}>
                            Email: {r.emailStatus}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {doc && (
                  <div className="rounded-md border border-border p-3 space-y-1 bg-muted/30">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Dokumen</span>
                      <span className="font-medium">{doc.docNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Customer</span>
                      <span className="font-medium">{doc.customerName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Rute</span>
                      <span>{[doc.origin, doc.destination].filter(Boolean).join(" → ") || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Moda</span>
                      <span className="capitalize">{doc.transportMode ?? "—"}</span>
                    </div>
                  </div>
                )}

                <div>
                  <p className="font-medium mb-2">Channel Pengiriman</p>
                  <div className="flex gap-4">
                    {[
                      { id: "wa", label: "WhatsApp", icon: <MessageSquare size={14} /> },
                      { id: "email", label: "Email", icon: <Mail size={14} /> },
                    ].map((ch) => (
                      <label key={ch.id} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={fwdChannels.includes(ch.id)}
                          onChange={() => toggleFwdChannel(ch.id)}
                          className="accent-purple-600 h-4 w-4"
                        />
                        {ch.icon}
                        {ch.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="font-medium mb-2">
                    Vendor {eligibleVendors.length > 0 ? `(${eligibleVendors.length} eligible)` : ""}
                  </p>
                  {eligibleVendors.length === 0 ? (
                    <p className="text-muted-foreground text-xs">Semua vendor aktif yang sesuai akan dihubungi.</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground mb-1 select-none">
                        <input
                          type="checkbox"
                          checked={fwdVendorIds.length === 0}
                          onChange={() => setFwdVendorIds([])}
                          className="accent-purple-600 h-4 w-4"
                        />
                        <span>Semua vendor</span>
                      </label>
                      {eligibleVendors.map((v) => (
                        <label key={v.id} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={fwdVendorIds.includes(v.id)}
                            onChange={() => toggleFwdVendor(v.id)}
                            className="accent-purple-600 h-4 w-4"
                          />
                          <span className="flex-1">{v.name}</span>
                          <span className="text-muted-foreground text-xs flex gap-1">
                            {v.hasPhone && <MessageSquare size={11} />}
                            {v.hasEmail && <Mail size={11} />}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            {fwdResults ? (
              <Button variant="outline" onClick={() => { setForwardOpen(false); setFwdResults(null); setFwdVendorIds([]); setFwdChannels(["wa", "email"]); }}>Tutup</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setForwardOpen(false)}>Batal</Button>
                <Button
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  disabled={forwardMut.isPending || fwdChannels.length === 0}
                  onClick={() => {
                if (!id) return;
                forwardMut.mutate(
                  {
                    id,
                    data: {
                      vendorIds: fwdVendorIds.length > 0 ? fwdVendorIds : undefined,
                      channels: fwdChannels.length > 0 ? (fwdChannels as ForwardToVendorsBodyChannelsItem[]) : undefined,
                    },
                  },
                  {
                    onSuccess: (data) => {
                      setFwdResults(data.results ?? []);
                      qc.invalidateQueries({ queryKey: getListAiDraftQuotationsQueryKey() });
                      qc.invalidateQueries({ queryKey: getGetSalesDocumentQueryKey(id) });
                      toast({
                        title: "Diteruskan ke vendor",
                        description: `${data.waCount} WA + ${data.emailCount} email ke ${data.vendorCount} vendor.`,
                      });
                    },
                    onError: () => {
                      toast({ title: t.common.error, variant: "destructive" });
                    },
                  },
                );
              }}
                >
                  {forwardMut.isPending ? "Mengirim..." : "Forward ke Vendor"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
