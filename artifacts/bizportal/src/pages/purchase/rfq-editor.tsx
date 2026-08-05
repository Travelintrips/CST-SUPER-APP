import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { QueryState } from "@/components/ui/query-state";
import { ScanDocumentDialog, type ScannedDocumentData } from "@/components/ScanDocumentDialog";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GooglePlacesAutocomplete } from "@/components/ui/google-places-autocomplete";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { useVendors } from "@/hooks/useVendors";
import {
  useGetPurchaseDocument,
  useCreatePurchaseDocument,
  useUpdatePurchaseDocument,
  usePurchaseDocumentAction,
  useDeletePurchaseDocument,
  useCreateSupplier,
  useUpdateSupplier,
  useListProducts,
  useListTaxes,
  useGetAccountingSettings,
  useListAccountingPayments,
  useCreateAccountingPayment,
  useListJournals,
  getGetPurchaseDocumentQueryKey,
  getListPurchaseDocumentsQueryKey,
  getListAccountingPaymentsQueryKey,
  getListSuppliersQueryKey,
  type Supplier,
} from "@workspace/api-client-react";

import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, Send, Check, X, FileText, Truck, Trash2, FileEdit, Save, Printer, CreditCard, Wallet, ScanLine, Mail, MessageSquare, SquareArrowOutUpRight, Link2, CheckCircle2, Circle, ClipboardCopy } from "lucide-react";
import { CorrespondenceTab } from "@/components/CorrespondenceTab";
import { TemplateSnapshotCard } from "@/components/TemplateSnapshotCard";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

interface LineDraft {
  productId?: number | null;
  name: string;
  description?: string | null;
  quantity: number;
  unitCost: number;
}

export default function PurchaseDocumentEditorPage() {
  const [, paramsNew] = useRoute("/purchase/rfq/new");
  const [, paramsRfq] = useRoute("/purchase/rfq/:id");
  const [, paramsOrder] = useRoute("/purchase/orders/:id");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();

  const isNew = !!paramsNew || paramsOrder?.id === "new";
  const idStr = paramsRfq?.id ?? (paramsOrder?.id !== "new" ? paramsOrder?.id : undefined);
  const id = idStr ? Number(idStr) : null;

  const downloadPdf = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/purchase/documents/${id}/pdf`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: t.common.error, description: (err as any)?.message ?? `Error ${res.status}`, variant: "destructive" });
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

  const { data: doc, isLoading: docLoading } = useGetPurchaseDocument(id ?? 0, {
    query: {
      enabled: !isNew && id !== null,
      queryKey: getGetPurchaseDocumentQueryKey(id ?? 0),
    },
  });
  const { data: vendors } = useVendors();
  const { data: _productsPaginated } = useListProducts({ limit: 500 });
  const products = _productsPaginated?.data;
  const { data: taxes } = useListTaxes();
  const { data: acctSettings } = useGetAccountingSettings();
  const createMut = useCreatePurchaseDocument();
  const updateMut = useUpdatePurchaseDocument();
  const actionMut = usePurchaseDocumentAction();
  const deleteMut = useDeletePurchaseDocument();
  const createPaymentMut = useCreateAccountingPayment();
  const updateSupplierMut = useUpdateSupplier();
  const createVendorMut = useCreateSupplier();
  const { data: journals = [] } = useListJournals();
  const bankCashJournals = journals.filter((j) => j.type === "bank" || j.type === "cash");

  const paymentQueryParams = { sourceType: "purchase_order", sourceDocId: id ?? 0 };
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
      memo: `Pembayaran bill ${doc.docNumber ?? ""}`,
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
          paymentType: "outbound",
          amount: amt,
          journalId: Number(payForm.journalId),
          partnerName: doc.supplierName,
          date: payForm.date,
          ref: payForm.ref || undefined,
          memo: payForm.memo || undefined,
          sourceType: "purchase_order",
          sourceDocId: id,
        },
      });
      toast({ title: t.common.success, description: doc.docNumber });
      qc.invalidateQueries({ queryKey: getListAccountingPaymentsQueryKey({ sourceType: "purchase_order", sourceDocId: id }) });
      qc.invalidateQueries({ queryKey: getGetPurchaseDocumentQueryKey(id) });
      setPayDialogOpen(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(err);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    }
  };

  const { data: warehouses = [] } = useQuery<{ id: number; name: string; branch_name: string }[]>({
    queryKey: ["warehouse/warehouses"],
    queryFn: () => fetch("/api/warehouse/warehouses").then((r) => r.json()),
  });

  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierAddressAutoFilled, setSupplierAddressAutoFilled] = useState(false);
  const [supplierCatalogAddress, setSupplierCatalogAddress] = useState<string | null>(null);
  const [updateVendorAddrOpen, setUpdateVendorAddrOpen] = useState(false);
  const [pendingNewAddress, setPendingNewAddress] = useState("");
  const [addVendorOpen, setAddVendorOpen] = useState(false);
  const [addVendorForm, setAddVendorForm] = useState({ name: "", country: "ID", contactEmail: "", phone: "", address: "", defaultPurchaseTaxId: null as number | null });
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [incoterm, setIncoterm] = useState("");
  const [deliveryTerm, setDeliveryTerm] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { name: "", quantity: 1, unitCost: 0 },
  ]);
  const [taxRateId, setTaxRateId] = useState<number | null>(null);
  const [taxApplied, setTaxApplied] = useState(false);
  const [taxAutoFilledFrom, setTaxAutoFilledFrom] = useState<"vendor" | "settings" | "product" | null>(null);

  useEffect(() => {
    if (doc) {
      setSupplierId(doc.supplierId ?? null);
      setSupplierName(doc.supplierName);
      setSupplierAddress(doc.supplierAddress ?? "");
      setWarehouseId((doc as any).warehouseId ?? null);
      if (doc.supplierId) {
        const v = (vendors ?? []).find((x) => x.id === doc.supplierId);
        setSupplierCatalogAddress(v?.address ?? null);
      } else {
        setSupplierCatalogAddress(null);
      }
      setExpectedDate(doc.expectedDate ? doc.expectedDate.slice(0, 10) : "");
      setNotes(doc.notes ?? "");
      setIncoterm((doc as any).incoterm ?? "");
      setDeliveryTerm((doc as any).deliveryTerm ?? "");
      setTargetPrice((doc as any).targetPrice ?? "");
      setTaxRateId(doc.taxRateId ?? null);
      setTaxApplied(true);
      setLines(
        doc.lines.length > 0
          ? doc.lines.map((l) => ({
              productId: l.productId ?? null,
              name: l.name,
              description: l.description ?? null,
              quantity: Number(l.quantity),
              unitCost: Number(l.unitCost),
            }))
          : [{ name: "", quantity: 1, unitCost: 0 }],
      );
    }
  }, [doc, vendors]);

  useEffect(() => {
    if (isNew && !taxApplied && acctSettings?.defaultPurchaseTaxId) {
      setTaxRateId(acctSettings.defaultPurchaseTaxId);
      setTaxApplied(true);
      setTaxAutoFilledFrom("settings");
    }
  }, [isNew, taxApplied, acctSettings]);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitCost || 0), 0),
    [lines],
  );
  const selectedTax = useMemo(() => taxes?.find((t) => t.id === taxRateId) ?? null, [taxes, taxRateId]);
  const taxAmount = useMemo(() => selectedTax ? Math.round(subtotal * Number(selectedTax.rate)) / 100 : 0, [subtotal, selectedTax]);
  const grandTotal = subtotal + taxAmount;
  const total = subtotal;

  const isEditable = isNew || (doc && (doc.status === "draft" || doc.status === "sent"));

  const setLine = (idx: number, patch: Partial<LineDraft>) => {
    setLines((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((arr) => [...arr, { name: "", quantity: 1, unitCost: 0 }]);
  const removeLine = (idx: number) => setLines((arr) => arr.filter((_, i) => i !== idx));

  const onProductChange = (idx: number, productIdStr: string) => {
    if (productIdStr === "__custom") {
      setLine(idx, { productId: null });
      return;
    }
    const pid = Number(productIdStr);
    const product = (products ?? []).find((p) => p.id === pid);
    if (product) {
      setLine(idx, { productId: pid, name: product.name, unitCost: Number(product.price) });
      const currentVendor = (vendors ?? []).find((v) => v.id === supplierId);
      setTaxRateId(
        product.defaultPurchaseTaxId
        ?? currentVendor?.defaultPurchaseTaxId
        ?? acctSettings?.defaultPurchaseTaxId
        ?? null
      );
      if (product.defaultPurchaseTaxId) {
        setTaxAutoFilledFrom("product");
      } else if (currentVendor?.defaultPurchaseTaxId) {
        setTaxAutoFilledFrom("vendor");
      } else if (acctSettings?.defaultPurchaseTaxId) {
        setTaxAutoFilledFrom("settings");
      } else {
        setTaxAutoFilledFrom(null);
      }
    }
  };

  const onVendorChange = (val: string) => {
    if (val === "__none") {
      setSupplierId(null);
      setSupplierAddressAutoFilled(false);
      setSupplierCatalogAddress(null);
      return;
    }
    const sid = Number(val);
    setSupplierId(sid);
    const v = (vendors ?? []).find((x) => x.id === sid);
    if (v) {
      setSupplierName(v.name);
      setSupplierAddress(v.address ?? "");
      setSupplierAddressAutoFilled(!!(v.address));
      setSupplierCatalogAddress(v.address ?? null);
      if (isNew || taxRateId === null) {
        setTaxRateId(v.defaultPurchaseTaxId ?? acctSettings?.defaultPurchaseTaxId ?? null);
        setTaxAutoFilledFrom(v.defaultPurchaseTaxId ? "vendor" : "settings");
      }
    }
  };

  const handleSaveNewVendor = async () => {
    if (!addVendorForm.name.trim()) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    try {
      const created: Supplier = await createVendorMut.mutateAsync({
        data: {
          name: addVendorForm.name.trim(),
          country: addVendorForm.country.trim() || null,
          contactEmail: addVendorForm.contactEmail.trim() || null,
          phone: addVendorForm.phone.trim() || null,
          address: addVendorForm.address.trim() || null,
          defaultPurchaseTaxId: addVendorForm.defaultPurchaseTaxId ?? undefined,
        },
      });
      qc.setQueryData<Supplier[]>(getListSuppliersQueryKey(), (old) =>
        old ? [...old, created] : [created]
      );
      qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
      setSupplierId(created.id);
      setSupplierName(created.name);
      setSupplierAddress(created.address ?? "");
      setSupplierAddressAutoFilled(!!(created.address));
      setSupplierCatalogAddress(created.address ?? null);
      if (isNew || taxRateId === null) {
        setTaxRateId(created.defaultPurchaseTaxId ?? acctSettings?.defaultPurchaseTaxId ?? null);
        setTaxAutoFilledFrom(created.defaultPurchaseTaxId ? "vendor" : "settings");
      }
      setAddVendorOpen(false);
      setAddVendorForm({ name: "", country: "ID", contactEmail: "", phone: "", address: "", defaultPurchaseTaxId: null });
      toast({ title: t.common.success });
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const validate = (): string | null => {
    if (!supplierName.trim()) return "Vendor wajib diisi";
    if (lines.length === 0) return "Minimal satu baris item";
    for (const l of lines) {
      if (!l.name.trim()) return "Nama item pada setiap baris wajib diisi";
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
    const body = {
      kind: "rfq" as const,
      supplierId,
      supplierName,
      supplierAddress: supplierAddress || null,
      warehouseId: warehouseId ?? null,
      taxRateId: taxRateId ?? null,
      expectedDate: expectedDate ? new Date(expectedDate).toISOString() : null,
      notes: notes || null,
      incoterm: incoterm || null,
      deliveryTerm: deliveryTerm || null,
      targetPrice: targetPrice || null,
      lines: lines.map((l) => ({
        productId: l.productId ?? null,
        name: l.name,
        description: l.description ?? null,
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost),
      })),
    };
    try {
      if (isNew) {
        const created = await createMut.mutateAsync({ data: body });
        qc.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey() });
        toast({ title: t.common.success, description: created.docNumber });
        navigate(`/purchase/rfq/${created.id}`);
      } else if (id) {
        await updateMut.mutateAsync({ id, data: body });
        qc.invalidateQueries({ queryKey: getGetPurchaseDocumentQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey() });
        toast({ title: t.common.success });
      }
      if (
        supplierId !== null &&
        supplierAddress.trim() &&
        supplierAddress.trim() !== (supplierCatalogAddress ?? "").trim()
      ) {
        setPendingNewAddress(supplierAddress.trim());
        setUpdateVendorAddrOpen(true);
      }
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const confirmUpdateVendorAddress = async () => {
    if (supplierId === null) return;
    try {
      await updateSupplierMut.mutateAsync({ id: supplierId, data: { name: supplierName, address: pendingNewAddress } });
      setSupplierCatalogAddress(pendingNewAddress);
      setSupplierAddressAutoFilled(true);
      qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
      toast({ title: t.common.success });
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    } finally {
      setUpdateVendorAddrOpen(false);
    }
  };

  const runAction = async (action: "send" | "confirm" | "cancel" | "draft" | "mark_received" | "mark_billed", { thenPay }: { thenPay?: boolean } = {}) => {
    if (!id) return;
    try {
      const result = await actionMut.mutateAsync({ id, data: { action } });
      qc.invalidateQueries({ queryKey: getGetPurchaseDocumentQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey() });
      toast({ title: t.common.success, description: result.status });
      if (action === "confirm") navigate(`/purchase/orders/${id}`);
      if (thenPay) openPayDialog();
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const [removeOpen, setRemoveOpen] = useState(false);

  const remove = () => { if (id) setRemoveOpen(true); };

  const doRemove = async () => {
    setRemoveOpen(false);
    if (!id) return;
    try {
      await deleteMut.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListPurchaseDocumentsQueryKey() });
      toast({ title: t.common.success });
      navigate("/purchase/rfq");
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const [scanOpen, setScanOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [vendorAcceptLink, setVendorAcceptLink] = useState<string | null>(null);
  const [vendorAcceptCopied, setVendorAcceptCopied] = useState(false);
  const [vendorAcceptSendWa, setVendorAcceptSendWa] = useState(true);
  const [vendorAcceptWaAvailable, setVendorAcceptWaAvailable] = useState<boolean | null>(null);
  const [vendorAcceptGenerating, setVendorAcceptGenerating] = useState(false);

  const generateVendorTokenMut = {
    isPending: vendorAcceptGenerating,
    mutate: async (sendWa?: boolean) => {
      if (!id) return;
      setVendorAcceptGenerating(true);
      try {
        const r = await fetch(`/api/purchase/documents/${id}/generate-vendor-token`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sendWa: sendWa ?? vendorAcceptSendWa }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.message ?? "error");
        setVendorAcceptLink(data.url);
        setVendorAcceptWaAvailable(data.waAvailable ?? false);
        await navigator.clipboard.writeText(data.url);
        setVendorAcceptCopied(true);
        setTimeout(() => setVendorAcceptCopied(false), 3000);
        if (data.waSent) {
          toast({ title: "Link disalin & WA terkirim!", description: `Pesan WA dikirim ke ${data.waTarget}.` });
        } else if (data.waAvailable === false && (sendWa ?? vendorAcceptSendWa)) {
          toast({ title: "Link berhasil disalin!", description: "WA tidak terkirim — nomor HP vendor tidak tersedia di data supplier." });
        } else {
          toast({ title: "Link berhasil disalin!", description: "Kirimkan link ini ke vendor via WA atau email." });
        }
      } catch (e: unknown) {
        toast({ title: "Gagal membuat link", variant: "destructive" });
      } finally {
        setVendorAcceptGenerating(false);
      }
    },
  };

  const handleScannedData = (data: ScannedDocumentData) => {
    if (data.partyName) {
      setSupplierName(data.partyName);
      setSupplierId(null);
    }
    if (data.partyAddress) { setSupplierAddress(data.partyAddress); setSupplierAddressAutoFilled(false); }
    if (data.docDate) setExpectedDate(data.docDate.slice(0, 10));
    if (data.notes) setNotes(data.notes);
    if (data.lines && data.lines.length > 0) {
      setLines(data.lines.map((l) => ({
        name: l.name,
        description: l.description ?? null,
        quantity: l.quantity,
        unitCost: l.unitPrice,
      })));
    }
  };

  const isOrderView = !!paramsOrder;
  const backHref = isOrderView ? "/purchase/orders" : "/purchase/rfq";

  if (!isNew && docLoading) {
    return <AppShell><LoadingSkeleton variant="detail" /></AppShell>;
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
              <h1 className="text-2xl font-bold">{isNew ? "RFQ Baru" : doc?.docNumber}</h1>
              {doc && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="capitalize">{doc.kind}</Badge>
                  <Badge variant="secondary" className="capitalize">{doc.status}</Badge>
                  {doc.kind === "order" && (
                    <>
                      <Badge variant="outline" className="capitalize">Receive: {doc.receiveStatus.replace("_", " ")}</Badge>
                      <Badge variant="outline" className="capitalize">Bill: {doc.billStatus.replace("_", " ")}</Badge>
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
                        if (doc.billStatus === "none") return null;
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
            {!isNew && doc?.kind === "order" && doc?.receiveStatus === "to_receive" && (
              <Button variant="outline" onClick={() => runAction("mark_received")} data-testid="button-receive"><Truck className="mr-2 h-4 w-4" /> Diterima</Button>
            )}
            {!isNew && doc?.kind === "order" && doc?.billStatus === "to_bill" && (
              <Button variant="default" onClick={() => runAction("mark_billed", { thenPay: true })} data-testid="button-bill"><CreditCard className="mr-2 h-4 w-4" /> Bayar</Button>
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
            {!isNew && doc && id && (
              <Button variant="outline" onClick={downloadPdf} data-testid="button-download-pdf">
                <Printer className="mr-2 h-4 w-4" /> Cetak PDF
              </Button>
            )}
            {!isNew && doc && (
              <Button variant="outline" onClick={() => setEmailOpen(true)} data-testid="button-send-email">
                <Mail className="mr-2 h-4 w-4" /> Kirim Email
              </Button>
            )}
            {!isNew && doc?.kind === "order" && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-green-600"
                    checked={vendorAcceptSendWa}
                    onChange={(e) => setVendorAcceptSendWa(e.target.checked)}
                  />
                  Kirim WA
                </label>
                <Button
                  variant="outline"
                  disabled={generateVendorTokenMut.isPending}
                  onClick={() => {
                    if (vendorAcceptLink) {
                      navigator.clipboard.writeText(vendorAcceptLink);
                      setVendorAcceptCopied(true);
                      toast({ title: "Link disalin!", description: "Kirimkan ke vendor via WA atau email." });
                      setTimeout(() => setVendorAcceptCopied(false), 3000);
                    } else {
                      generateVendorTokenMut.mutate();
                    }
                  }}
                  data-testid="button-vendor-accept-link"
                >
                  {vendorAcceptGenerating ? (
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent inline-block" />
                  ) : vendorAcceptCopied ? (
                    <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                  ) : (
                    <Link2 className="mr-2 h-4 w-4" />
                  )}
                  {vendorAcceptLink ? (vendorAcceptCopied ? "Tersalin!" : "Salin Link Vendor Accept") : "Buat Link Vendor Accept"}
                </Button>
              </div>
            )}
          </div>
          {vendorAcceptLink && (
            <div className="mt-2 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded px-3 py-1.5">
                <Link2 className="h-3 w-3 shrink-0" />
                <span className="truncate font-mono">{vendorAcceptLink}</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 shrink-0" onClick={() => { navigator.clipboard.writeText(vendorAcceptLink); setVendorAcceptCopied(true); setTimeout(() => setVendorAcceptCopied(false), 3000); }}>
                  <ClipboardCopy className="h-3 w-3" />
                </Button>
                {vendorAcceptSendWa && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 shrink-0 text-green-600 hover:text-green-700"
                    onClick={() => generateVendorTokenMut.mutate(true)}
                    title="Kirim ulang WA ke vendor"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.548 4.107 1.509 5.845L.057 23.428a.75.75 0 0 0 .914.914l5.638-1.45A11.933 11.933 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.694 9.694 0 0 1-4.922-1.335l-.354-.21-3.674.944.97-3.589-.228-.368A9.694 9.694 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/></svg>
                  </Button>
                )}
              </div>
              {vendorAcceptWaAvailable === false && vendorAcceptSendWa && (
                <p className="text-xs text-amber-600 px-1">⚠ Nomor HP vendor tidak ditemukan di data supplier — WA tidak terkirim. Tambahkan nomor HP di halaman Vendor.</p>
              )}
            </div>
          )}
          {!isNew && doc?.kind === "order" && (doc as any).vendor_accepted_at && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Vendor telah konfirmasi PO pada {new Date((doc as any).vendor_accepted_at).toLocaleString("id-ID")}</span>
              {(doc as any).vendor_accept_notes && <span className="text-muted-foreground">— {(doc as any).vendor_accept_notes}</span>}
            </div>
          )}
        </div>

        {isOrderView && doc && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Alur Purchase Order (10 Tahap)</CardTitle></CardHeader>
            <CardContent>
              {(() => {
                const d = doc as any;
                const steps = [
                  { label: "Purchase Request", done: true },
                  { label: "RFQ", done: true },
                  { label: "Penawaran Vendor", done: true },
                  { label: "Perbandingan Vendor", done: true },
                  { label: "PO Dibuat", done: doc.status !== "draft" },
                  { label: "Vendor Konfirmasi PO", done: !!d.vendor_accepted_at },
                  { label: "Pengiriman / Servis", done: doc.receiveStatus !== "none" },
                  { label: "Terima & Verifikasi", done: doc.receiveStatus === "received" },
                  { label: "Invoice Vendor", done: doc.billStatus === "billed" },
                  { label: "Pembayaran & Tutup", done: doc.paymentStatus === "paid" || doc.status === "done" },
                ];
                const currentStep = steps.findIndex((s) => !s.done);
                return (
                  <div className="flex flex-wrap gap-1">
                    {steps.map((step, i) => {
                      const isCurrent = i === currentStep;
                      return (
                        <div key={i} className="flex items-center gap-1">
                          <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${step.done ? "bg-green-500/20 text-green-500" : isCurrent ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-400/50" : "bg-muted text-muted-foreground"}`}>
                            {step.done ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                            <span>{step.label}</span>
                          </div>
                          {i < steps.length - 1 && <span className="text-muted-foreground/40 text-xs">›</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Informasi Vendor</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Vendor</Label>
                {isEditable && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => setAddVendorOpen(true)} data-testid="button-add-vendor-inline">
                    <Plus className="h-3 w-3 mr-1" /> Tambah Baru
                  </Button>
                )}
              </div>
              <Select value={supplierId !== null ? String(supplierId) : "__none"} onValueChange={onVendorChange} disabled={!isEditable}>
                <SelectTrigger data-testid="select-vendor"><SelectValue placeholder="Pilih vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Bebas (isi nama manual) —</SelectItem>
                  {(() => {
                    const all = vendors ?? [];
                    const purchaseVendors = all.filter((v) => !v.eta && !v.serviceType);
                    const courierVendors = all.filter((v) => v.eta || v.serviceType);
                    return (
                      <>
                        {purchaseVendors.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-xs text-muted-foreground">Supplier Pembelian</SelectLabel>
                            {purchaseVendors.map((v) => (
                              <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {courierVendors.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-xs text-muted-foreground">Kurir / Vendor Layanan</SelectLabel>
                            {courierVendors.map((v) => (
                              <SelectItem key={v.id} value={String(v.id)}>
                                {v.logo && <span className="mr-1">{v.logo}</span>}{v.name}
                                {v.eta && <span className="ml-1 text-xs text-muted-foreground">({v.eta})</span>}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Nama Vendor</Label>
              <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} disabled={!isEditable} data-testid="input-vendor-name" />
            </div>
            {supplierId && (vendors ?? []).find((v) => v.id === supplierId)?.taxId && (
              <div className="grid gap-1.5">
                <Label>NPWP Vendor</Label>
                <Input value={(vendors ?? []).find((v) => v.id === supplierId)?.taxId ?? ""} disabled data-testid="input-vendor-npwp" />
              </div>
            )}
            <div className="grid gap-1.5 md:col-span-2">
              <div className="flex items-center gap-2">
                <Label>Alamat Supplier</Label>
                {supplierAddressAutoFilled && (
                  <Badge variant="secondary" className="text-xs font-normal" data-testid="badge-address-autofill">
                    dari data vendor
                  </Badge>
                )}
              </div>
              <GooglePlacesAutocomplete
                value={supplierAddress}
                onChange={(v) => { setSupplierAddress(v); setSupplierAddressAutoFilled(false); }}
                placeholder="Alamat lengkap supplier"
                disabled={!isEditable}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Gudang Tujuan</Label>
              <Select
                value={warehouseId !== null ? String(warehouseId) : "__none"}
                onValueChange={(v) => setWarehouseId(v === "__none" ? null : Number(v))}
                disabled={!isEditable}
              >
                <SelectTrigger data-testid="select-warehouse">
                  <SelectValue placeholder="Pilih gudang (opsional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Tidak ditentukan —</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                      {w.branch_name && w.branch_name !== w.name && (
                        <span className="ml-1 text-xs text-muted-foreground">({w.branch_name})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Tanggal Diharapkan</Label>
              <DatePicker value={expectedDate} onChange={setExpectedDate} disabled={!isEditable} />
            </div>
            <div className="grid gap-1.5">
              <Label>Incoterm</Label>
              <Select value={incoterm || "__none"} onValueChange={(v) => setIncoterm(v === "__none" ? "" : v)} disabled={!isEditable}>
                <SelectTrigger><SelectValue placeholder="Pilih incoterm (opsional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Tidak ditentukan —</SelectItem>
                  {["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Syarat Pengiriman (Delivery Term)</Label>
              <Input value={deliveryTerm} onChange={(e) => setDeliveryTerm(e.target.value)} disabled={!isEditable} placeholder="cth. Franco Gudang Pembeli" />
            </div>
            <div className="grid gap-1.5">
              <Label>Target Harga (IDR)</Label>
              <Input type="number" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} disabled={!isEditable} placeholder="0" />
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label>Catatan</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!isEditable} />
            </div>
          </CardContent>
        </Card>

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
                  <TableHead className="w-[100px] text-right">Qty</TableHead>
                  <TableHead className="w-[150px] text-right">Harga Beli</TableHead>
                  <TableHead className="w-[150px] text-right">Subtotal</TableHead>
                  {isEditable && <TableHead className="w-[40px]"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, idx) => (
                  <TableRow key={idx} data-testid={`row-line-${idx}`}>
                    <TableCell>
                      <Select
                        value={l.productId !== null && l.productId !== undefined ? String(l.productId) : "__custom"}
                        onValueChange={(v) => onProductChange(idx, v)}
                        disabled={!isEditable}
                      >
                        <SelectTrigger><SelectValue placeholder="Pilih atau custom" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__custom">— Custom —</SelectItem>
                          {(products ?? []).map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="mt-2"
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
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="text-right"
                        value={l.unitCost}
                        onChange={(e) => setLine(idx, { unitCost: Number(e.target.value) })}
                        disabled={!isEditable}
                        data-testid={`input-line-cost-${idx}`}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {idr(Number(l.quantity || 0) * Number(l.unitCost || 0))}
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
                    {(taxes ?? []).filter((t) => t.kind === "purchase" && t.isActive).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.rate}%)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {taxAutoFilledFrom && taxRateId && (
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-tax-autofill-hint">
                    {taxAutoFilledFrom === "vendor" ? "(default dari vendor)" : taxAutoFilledFrom === "product" ? "(default dari produk)" : "(default dari pengaturan)"}
                  </p>
                )}
              </div>
              <div className="text-right space-y-1">
                <div className="text-sm text-muted-foreground">Subtotal <span className="text-xs">(Harga Dasar, belum PPN)</span>: <span className="font-mono ml-2" data-testid="text-subtotal">{idr(subtotal)}</span></div>
                {selectedTax
                  ? <div className="text-sm text-muted-foreground">PPN {selectedTax.rate}% ({selectedTax.name}): <span className="font-mono ml-2" data-testid="text-tax-amount">{idr(taxAmount)}</span></div>
                  : <div className="text-xs text-muted-foreground italic">Tidak ada PPN</div>
                }
                <div className="text-xs text-muted-foreground">Total <span className="text-xs">(termasuk PPN)</span></div>
                <div className="text-2xl font-bold" data-testid="text-total">{idr(grandTotal)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {!isEditable && (doc as any)?.templateSnapshot && (
          <TemplateSnapshotCard templateSnapshot={(doc as any).templateSnapshot} />
        )}

        {isOrderView && id && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Pembayaran
              </CardTitle>
              <div className="flex items-center gap-2">
                {doc?.docNumber && (
                  <Link href={`/accounting/payments?refDocNumber=${encodeURIComponent(doc.docNumber)}&sourceType=purchase_order`}>
                    <Button size="sm" variant="ghost" className="gap-1.5 text-xs text-slate-400 hover:text-slate-200">
                      <SquareArrowOutUpRight className="h-3.5 w-3.5" /> Lihat di Akuntansi
                    </Button>
                  </Link>
                )}
                {doc?.kind === "order" &&
                  doc?.billStatus === "billed" &&
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
              </div>
            </CardHeader>
            <CardContent>
              <QueryState loading={paymentsLoading} empty={linkedPayments.length === 0} emptyMessage="Belum ada pembayaran tercatat.">
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

        {!isNew && id && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4" /> Korespondensi Email
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CorrespondenceTab linkedType="purchase_order" linkedId={id} />
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
        title="Scan Dokumen Pembelian"
      />

      {!isNew && doc && id && (
        <SendEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          docId={id}
          docNumber={doc.docNumber}
          docTitle={doc.kind === "order" ? "Purchase Order" : "Request for Quotation"}
          defaultTo={(() => { const v = (vendors ?? []).find((x) => x.id === doc.supplierId); return v?.contactEmail ?? ""; })()}
          module="purchase"
        />
      )}

      {/* Inline add-vendor dialog */}
      <Dialog open={addVendorOpen} onOpenChange={(open) => { setAddVendorOpen(open); if (!open) setAddVendorForm({ name: "", country: "ID", contactEmail: "", phone: "", address: "", defaultPurchaseTaxId: null }); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tambah Vendor Baru</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="av-name">Nama <span className="text-destructive">*</span></Label>
              <Input id="av-name" autoComplete="off" value={addVendorForm.name} onChange={(e) => setAddVendorForm((f) => ({ ...f, name: e.target.value }))} data-testid="input-new-vendor-name" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="av-email">Email Kontak</Label>
              <Input id="av-email" type="email" value={addVendorForm.contactEmail} onChange={(e) => setAddVendorForm((f) => ({ ...f, contactEmail: e.target.value }))} data-testid="input-new-vendor-email" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="av-phone">Telepon</Label>
              <Input id="av-phone" value={addVendorForm.phone} onChange={(e) => setAddVendorForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="av-country">Negara</Label>
              <Input id="av-country" autoComplete="off" value={addVendorForm.country} onChange={(e) => setAddVendorForm((f) => ({ ...f, country: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="av-address">Alamat</Label>
              <Textarea id="av-address" value={addVendorForm.address} onChange={(e) => setAddVendorForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Pajak Pembelian Default</Label>
              <Select
                value={addVendorForm.defaultPurchaseTaxId !== null ? String(addVendorForm.defaultPurchaseTaxId) : "none"}
                onValueChange={(v) => setAddVendorForm((f) => ({ ...f, defaultPurchaseTaxId: v === "none" ? null : parseInt(v) }))}
              >
                <SelectTrigger><SelectValue placeholder="Tanpa default pajak" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tanpa default —</SelectItem>
                  {(taxes ?? []).filter((t) => t.kind === "purchase" && t.isActive).map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.rate}%)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddVendorOpen(false)}>Batal</Button>
            <Button onClick={handleSaveNewVendor} disabled={createVendorMut.isPending} data-testid="button-save-new-vendor">
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={updateVendorAddrOpen} onOpenChange={setUpdateVendorAddrOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-update-vendor-address">
          <DialogHeader>
            <DialogTitle>Update alamat di katalog vendor juga?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Alamat yang Anda masukkan berbeda dari data vendor di katalog. Ingin memperbarui katalog vendor agar PO berikutnya menggunakan alamat yang baru?
          </p>
          <p className="text-sm font-mono bg-muted rounded p-2 mt-1 whitespace-pre-wrap">{pendingNewAddress}</p>
          <DialogFooter className="flex-row justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setUpdateVendorAddrOpen(false)} data-testid="button-skip-vendor-address-update">
              Tidak
            </Button>
            <Button
              onClick={confirmUpdateVendorAddress}
              disabled={updateSupplierMut.isPending}
              data-testid="button-confirm-vendor-address-update"
            >
              Ya, Update Katalog
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog: hapus dokumen ── */}
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Dokumen</AlertDialogTitle>
            <AlertDialogDescription>
              {doc?.docNumber ? (
                <>Dokumen <strong>{doc.docNumber}</strong> akan dihapus secara permanen. Tindakan ini tidak bisa dibatalkan.</>
              ) : (
                "Dokumen ini akan dihapus secara permanen. Tindakan ini tidak bisa dibatalkan."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void doRemove()}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
