import { DatePicker } from "@/components/ui/date-picker";
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "@/contexts/CompanyContext";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload, FileText, Loader2, CheckCircle2, AlertTriangle, Trash2,
  Plus, ArrowRight, ChevronLeft, Bot, Sparkles, ShieldCheck, Lock,
  UserPlus, CheckCircle,
} from "lucide-react";
import { SAP_LOCK, sapLockWarn, assertSapSource } from "@/lib/sapLock";
import { useListSuppliers, useCreateSupplier } from "@workspace/api-client-react";

// ── SAP Lock formatter — display only, never derived ─────────────────────────
const idr = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(n);

// ── Types ─────────────────────────────────────────────────────────────────────

interface OcrLineItem {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  total: number | null;
  tax?: number | null;
  coa_hint?: string | null;
}

interface OcrBreakdownDetails {
  re_object: string | null;
  tariff: number | null;
  uom: string | null;
  turnover: number | null;
  mob: number | null;
  meter_from: number | null;
  meter_to: number | null;
  usage: number | null;
  service_period: string | null;
}

interface OcrBreakdownComponent {
  component: "concession" | "electricity" | "water" | "other";
  label: string;
  dpp: number | null;
  ppn: number | null;
  gross: number | null;
  withholding_tax_amount: number | null;
  withholding_tax_rate: number | null;
  payable_amount: number | null;
  details: OcrBreakdownDetails;
}

interface OcrInvoiceBreakdown {
  components: OcrBreakdownComponent[];
  withholding_tax: {
    type: string | null;
    rate: number | null;
    amount: number | null;
    base_amount: number | null;
    evidence: string | null;
  };
  totals: {
    dpp: number | null;
    ppn: number | null;
    gross: number | null;
    withholding_tax_amount: number | null;
    payable_amount: number | null;
  };
  coa_hint?: string | null;
}

interface OcrResult {
  vendor_name: string | null;
  vendor_tax_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  tax_type: string | null;
  discount: number | null;
  shipping_cost: number | null;
  total_amount: number | null;
  line_items: OcrLineItem[];
  invoice_breakdown?: OcrInvoiceBreakdown | null;
  tax_review?: {
    required: boolean;
    status: "required" | "not_required";
    reasons: string[];
    withholding_tax_type: string | null;
    tax_object: string | null;
    withholding_amount: number | null;
  };
  withholding_tax_type?: string | null;
  tax_object?: string | null;
  withholding_amount?: number | null;
  payment_status_hint: string | null;
  raw_confidence: number;
  flags: string[];
}

/**
 * SAP-grade tax result — strict header-only extraction, no derivation.
 * Source of truth for all financial display values.
 */
interface SapTaxResult {
  tax_mode: "HEADER_TAX_ONLY" | "NO_HEADER_TAX";
  invoice: {
    vendor_name: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    currency: string | null;
  };
  tax: {
    type: "PPN" | "NONE";
    net: number | null;
    vat: number | null;
    gross: number | null;
  };
  validation: {
    is_valid: boolean;
    difference: number;
  };
  flags: string[];
  confidence: number;
}

/**
 * Display-only line item for items table.
 * Items MUST NOT be used for any financial calculation.
 * SAP LOCK: quantity * unit_price is FORBIDDEN.
 */
interface DisplayLine {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  notes: string;
  coaHint: string;
  coaAccountId: string;
}

interface CoaAccount {
  id: number;
  code: string;
  name: string;
  type?: string | null;
  isActive?: boolean;
  isPostable?: boolean;
}

interface VendorCoaMapping {
  mappingKey: string;
  coaAccountId: number;
  coaCode: string;
  coaName: string;
}

function confidenceColor(c: number) {
  if (c >= 0.85) return "text-green-600 bg-green-50 border-green-200";
  if (c >= 0.6) return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-red-600 bg-red-50 border-red-200";
}

function confidenceLabel(c: number) {
  if (c >= 0.85) return "Tinggi";
  if (c >= 0.6) return "Sedang";
  return "Rendah";
}

function normalizeVendorLineKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 240);
}

const OCR_AUTO_POST_CONFIDENCE = 0.9;
const OCR_AUTO_POST_RAW_CONFIDENCE = 0.85;
const TAX_AMOUNT_TOLERANCE = 100;

function getOcrAutoPostReviewReasons(
  result: OcrResult,
  sapTax: SapTaxResult,
): string[] {
  const reasons: string[] = [];
  const { net, vat, gross } = sapTax.tax;
  const amountsAreNumeric = [net, vat, gross].every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );

  if (
    !amountsAreNumeric ||
    Math.abs((net ?? 0) + (vat ?? 0) - (gross ?? 0)) > TAX_AMOUNT_TOLERANCE
  ) {
    reasons.push("DPP + PPN tidak sama dengan total invoice.");
  }
  if (!sapTax.validation.is_valid) {
    reasons.push("Validasi header invoice gagal.");
  }
  if (sapTax.confidence < OCR_AUTO_POST_CONFIDENCE) {
    reasons.push("Confidence SAP Tax di bawah batas auto-post 90%.");
  }
  if (result.raw_confidence < OCR_AUTO_POST_RAW_CONFIDENCE) {
    reasons.push("Confidence OCR di bawah batas auto-post 85%.");
  }
  if (sapTax.tax.type === "PPN" && !(typeof vat === "number" && vat > 0)) {
    reasons.push("Invoice PPN tidak memiliki nilai PPN yang terbaca.");
  }
  if (result.tax_review?.required) {
    reasons.push(...result.tax_review.reasons);
  }
  return reasons;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceOcrImportPage() {
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // OCR raw result (display-only reference)
  const [result, setResult] = useState<OcrResult | null>(null);

  /**
   * SAP Tax Lock — canonical financial source of truth.
   * ALL subtotal / vat / grand total values must come from here.
   * NEVER derive from displayLines[].
   */
  const [sapTax, setSapTax] = useState<SapTaxResult | null>(null);

  // Duplicate invoice warning — checked right after extraction against vendorInvoiceRef+supplierName
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const ocrAutoPostReviewReasons = useMemo(
    () => (result && sapTax ? getOcrAutoPostReviewReasons(result, sapTax) : []),
    [result, sapTax],
  );
  const canAutoPostOcrInvoice = ocrAutoPostReviewReasons.length === 0;

  const [form, setForm] = useState({
    supplierName: "",
    vendorInvoiceRef: "",
    invoiceDate: new Date().toISOString().substring(0, 10),
    paymentTermDays: "30",
    dueDate: "",
  });

  // ── Add Supplier quick-create dialog ────────────────────────────────────────
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierForm, setNewSupplierForm] = useState({
    name: "", phone: "", contactPerson: "", contactEmail: "", country: "Indonesia",
  });

  // Fetch supplier list for existence check.
  // limit:1000 — needs the full vendor list, not the paginated default (25).
  const { data: suppliersResponse } = useListSuppliers({
    limit: 1000,
    companyId: activeCompanyId != null ? String(activeCompanyId) : undefined,
  });
  const supplierOptions = useMemo(
    () => (suppliersResponse?.data ?? []) as Array<{ id: number; name: string }>,
    [suppliersResponse?.data],
  );
  const matchedSupplier = useMemo(() => {
    const name = form.supplierName.trim().toLowerCase();
    if (!name) return undefined;
    return supplierOptions.find((supplier) => supplier.name?.trim().toLowerCase() === name);
  }, [form.supplierName, supplierOptions]);

  const { data: coaAccounts = [], isLoading: coaAccountsLoading } = useQuery<CoaAccount[]>({
    queryKey: ["/api/accounting/accounts", activeCompanyId, "vendor-invoice-postable"],
    queryFn: async () => {
      const params = new URLSearchParams({
        companyId: String(activeCompanyId),
        postableOnly: "true",
      });
      const response = await fetch(`/api/accounting/accounts?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Gagal memuat Chart of Accounts.");
      return (await response.json()) as CoaAccount[];
    },
    enabled: activeCompanyId != null,
  });

  const { data: vendorCoaMappings = [] } = useQuery<VendorCoaMapping[]>({
    queryKey: [
      "/api/purchase-workflow/vendor-invoices/coa-mappings",
      activeCompanyId,
      matchedSupplier?.id,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ supplierId: String(matchedSupplier!.id) });
      const response = await fetch(`/api/purchase-workflow/vendor-invoices/coa-mappings?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Gagal memuat referensi COA vendor.");
      return (await response.json()) as VendorCoaMapping[];
    },
    enabled: activeCompanyId != null && matchedSupplier?.id != null,
  });

  const vendorCoaMap = useMemo(
    () => new Map(vendorCoaMappings.map((mapping) => [mapping.mappingKey, mapping.coaAccountId])),
    [vendorCoaMappings],
  );

  // Check if current supplierName matches any existing supplier (case-insensitive)
  const supplierExists = useMemo(() => {
    if (!form.supplierName.trim()) return true; // no name yet — don't show warning
    return matchedSupplier != null;
  }, [form.supplierName, matchedSupplier]);

  const createSupplierMut = useCreateSupplier({
    mutation: {
      onSuccess: (createdSupplier) => {
        toast.success(`Supplier "${newSupplierForm.name}" berhasil ditambahkan ke database`);
        queryClient.invalidateQueries({ queryKey: ["/api/trading/suppliers"] });
        setForm((current) => ({
          ...current,
          supplierName: createdSupplier.name ?? newSupplierForm.name.trim(),
        }));
        setShowAddSupplier(false);
        setNewSupplierForm({ name: "", phone: "", contactPerson: "", contactEmail: "", country: "Indonesia" });
      },
      onError: (err: Error) => toast.error(err.message ?? "Gagal membuat supplier"),
    },
  });

  const handleCreateSupplier = () => {
    if (!newSupplierForm.name.trim()) {
      toast.error("Nama supplier wajib diisi");
      return;
    }
    createSupplierMut.mutate({
      data: {
        name: newSupplierForm.name.trim(),
        phone: newSupplierForm.phone || undefined,
        contactPerson: newSupplierForm.contactPerson || undefined,
        contactEmail: newSupplierForm.contactEmail || undefined,
        country: newSupplierForm.country || "Indonesia",
        isActive: true,
      } as Parameters<typeof createSupplierMut.mutate>[0]["data"],
    });
  };

  /**
   * Display-only lines — used for rendering the item table.
   * DO NOT use these for any subtotal/tax/total calculation.
   * SAP LOCK ACTIVE: no reduce(), no sum(), no arithmetic on these.
   */
  const [displayLines, setDisplayLines] = useState<DisplayLine[]>([]);

  // Approved vendor mappings are applied as a suggestion only. The user can
  // still change the account before saving the invoice.
  useEffect(() => {
    if (displayLines.length === 0 || vendorCoaMappings.length === 0) return;
    setDisplayLines((previous) => {
      let changed = false;
      const next = previous.map((line) => {
        if (line.coaAccountId) return line;
        const mappedAccountId = vendorCoaMap.get(normalizeVendorLineKey(line.description));
        if (!mappedAccountId) return line;
        changed = true;
        return { ...line, coaAccountId: String(mappedAccountId) };
      });
      return changed ? next : previous;
    });
  }, [displayLines.length, vendorCoaMap, vendorCoaMappings.length]);

  const applyOcrToForm = useCallback(
    (ocr: OcrResult, sap: SapTaxResult) => {
      const invDate = ocr.invoice_date ?? new Date().toISOString().substring(0, 10);
      let termDays = "30";
      if (ocr.due_date && ocr.invoice_date) {
        const diff = Math.round(
          (new Date(ocr.due_date).getTime() -
            new Date(ocr.invoice_date).getTime()) /
            86400000,
        );
        if (diff > 0) termDays = String(diff);
      }

      // Prefer SAP-extracted vendor name (header-only) over raw OCR
      const vendorName =
        sap.invoice.vendor_name ?? ocr.vendor_name ?? "";

      setForm({
        supplierName: vendorName,
        vendorInvoiceRef: sap.invoice.invoice_number ?? ocr.invoice_number ?? "",
        invoiceDate: sap.invoice.invoice_date ?? invDate,
        paymentTermDays: termDays,
        dueDate: ocr.due_date ?? "",
      });

      // Items are DISPLAY ONLY — map to DisplayLine (no tax, no subtotal computation)
      // SAP LOCK: item-level tax must NOT be carried when header tax is present.
      const mapped: DisplayLine[] =
        ocr.line_items?.length > 0
          ? ocr.line_items.map((l) => ({
              description: l.description ?? "",
              quantity: l.quantity != null ? String(l.quantity) : "1",
              unit: "ls",
              // SAP LOCK: unit_price is display-only; never multiplied here
              unitPrice: l.unit_price != null ? String(l.unit_price) : "",
              notes: "",
              coaHint: l.coa_hint ?? "",
              coaAccountId: "",
            }))
          : [
              {
                description: "Layanan",
                quantity: "1",
                unit: "ls",
                unitPrice: "",
                notes: "",
                coaHint: "",
                coaAccountId: "",
              },
            ];

      setDisplayLines(mapped);
    },
    [],
  );

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setResult(null);
    setSapTax(null);
    setDisplayLines([]);
    setDuplicateWarning(null);
  }, []);

  const checkDuplicate = useCallback(async (vendorInvoiceRef: string, supplierName: string) => {
    if (!vendorInvoiceRef || !supplierName) {
      setDuplicateWarning(null);
      return;
    }
    try {
      const params = new URLSearchParams({ vendorInvoiceRef, supplierName });
      const res = await fetch(`/api/purchase-workflow/vendor-invoices/check-duplicate?${params}`, {
        credentials: "include",
      });
      const json = (await res.json()) as { duplicate?: boolean; message?: string };
      setDuplicateWarning(json.duplicate ? (json.message ?? "Invoice ini sudah pernah diinput sebelumnya.") : null);
    } catch {
      // Non-fatal — duplicate check is a best-effort UI warning, backend still enforces on save
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const extract = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setSapTax(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/invoice-ocr/extract", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        data?: OcrResult;
        sap_tax?: SapTaxResult;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Gagal ekstrak");

      const ocr = json.data!;
      const sap = json.sap_tax!;

      setResult(ocr);
      setSapTax(sap);
      applyOcrToForm(ocr, sap);

      const vendorName = sap.invoice.vendor_name ?? ocr.vendor_name ?? "";
      const invoiceRef = sap.invoice.invoice_number ?? ocr.invoice_number ?? "";
      checkDuplicate(invoiceRef, vendorName);

      // SAP LOCK DEBUG — assert all three header fields and warn on mismatch
      assertSapSource("net",   sap.tax.net);
      assertSapSource("vat",   sap.tax.vat);
      assertSapSource("gross", sap.tax.gross);
      if (sap.validation && !sap.validation.is_valid) {
        sapLockWarn("Header validation failed", {
          sapValidation: sap.validation,
          sapFlags: sap.flags,
        });
      }

      toast.success("Invoice berhasil diekstrak oleh AI");
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Display-only line field update (description/qty/unit/unitPrice/notes only)
  // SAP LOCK: NO subtotal or tax computation here.
  const updateDisplayLine = (
    i: number,
    key: keyof DisplayLine,
    value: string,
  ) => {
    setDisplayLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)),
    );
  };

  const save = async () => {
    if (!form.supplierName) {
      toast.error("Nama supplier wajib diisi");
      return;
    }
    if (duplicateWarning) {
      toast.error(duplicateWarning);
      return;
    }
    if (!sapTax) {
      toast.error("Data SAP Tax belum tersedia. Ekstrak invoice terlebih dahulu.");
      return;
    }
    setSaving(true);
    try {
      // SAP LOCK: send backend header values — never derived from displayLines
      const payload = {
        supplierId: matchedSupplier?.id,
        supplierName: form.supplierName,
        vendorInvoiceRef: form.vendorInvoiceRef,
        invoiceDate: form.invoiceDate,
        paymentTermDays: Number(form.paymentTermDays),
        companyId: activeCompanyId,
        // Financial values from SAP header — NEVER from displayLines
        headerNet:   sapTax.tax.net,
        headerVat:   sapTax.tax.vat,
        headerGross: sapTax.tax.gross,
        taxType:     sapTax.tax.type,
        taxMode:     sapTax.tax_mode,
        sapConfidence: sapTax.confidence,
        invoiceBreakdown: result?.invoice_breakdown ?? null,
        withholdingTaxAmount:
          result?.invoice_breakdown?.withholding_tax?.amount ??
          result?.invoice_breakdown?.totals?.withholding_tax_amount ??
          result?.tax_review?.withholding_amount ??
          undefined,
        // Display-only lines (description/qty/unit for reference, not financial)
        lines: displayLines.map((l) => ({
          name: l.description,
          quantity: Number(l.quantity) || 1,
          unit: l.unit,
          unitCost: Number(l.unitPrice) || 0,
          taxAmount: 0,
          coaHint: l.coaHint || undefined,
           coaAccountId: l.coaAccountId ? Number(l.coaAccountId) : undefined,
           coaResolutionStatus: l.coaAccountId ? "confirmed" : "unresolved",
           mappingKey: normalizeVendorLineKey(l.description),
          notes: l.notes,
        })),
        taxReviewRequired: Boolean(result?.tax_review?.required),
        taxReviewReason: result?.tax_review?.reasons?.join(" ") || undefined,
        withholdingTaxType: result?.tax_review?.withholding_tax_type || undefined,
        taxObject: result?.tax_review?.tax_object || undefined,
      };
      const res = await fetch("/api/purchase-workflow/vendor-invoices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let errMsg = "Gagal menyimpan";
        try {
          const errJson = await res.json();
          errMsg = errJson.message ?? errJson.error ?? errMsg;
        } catch {}
        throw new Error(errMsg);
      }
      const data = (await res.json()) as { id: number };

      // Confirm selected COA lines before posting and persist them as
      // supplier-specific reusable mappings for future invoices.
      const selectedLines = displayLines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => Boolean(line.coaAccountId));
      if (selectedLines.length > 0 && matchedSupplier?.id) {
        const detailRes = await fetch(
          `/api/purchase-workflow/vendor-invoices/${data.id}?company=${activeCompanyId}`,
          { credentials: "include" },
        );
        if (!detailRes.ok) {
          throw new Error("Invoice tersimpan, tetapi detail line untuk konfirmasi COA gagal dimuat.");
        }
        const detail = (await detailRes.json()) as {
          lines?: Array<{ id?: number }>;
        };
        const reviewLines = selectedLines
          .map(({ line, index }) => ({
            lineId: detail.lines?.[index]?.id,
            coaAccountId: Number(line.coaAccountId),
            mappingKey: normalizeVendorLineKey(line.description),
            // The selected COA remains valid for this invoice even when the
            // OCR vendor name does not exactly match a supplier master row.
            // Only supplier-specific reusable mappings require a supplier ID.
            saveReusableRule: Boolean(matchedSupplier?.id),
          }))
          .filter(
            (line): line is typeof line & { lineId: number } =>
              Number.isInteger(line.lineId) && (line.lineId ?? 0) > 0,
          );
        if (reviewLines.length !== selectedLines.length) {
          throw new Error("Invoice tersimpan, tetapi semua line COA belum dapat dikonfirmasi.");
        }
        const reviewRes = await fetch(
          `/api/purchase-workflow/vendor-invoices/${data.id}/finance-review`,
          {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines: reviewLines, taxes: [] }),
          },
        );
        if (!reviewRes.ok) {
          const reviewError = await reviewRes.json().catch(() => ({})) as {
            message?: string;
            error?: string;
          };
          throw new Error(
            reviewError.message ?? reviewError.error ?? "COA gagal dikonfirmasi.",
          );
        }
      }

      if (!canAutoPostOcrInvoice) {
        toast.success("Vendor invoice disimpan sebagai draft untuk review — jurnal tidak dibuat otomatis");
      } else {
        // Auto-post only after the header/tax/confidence gate passes. A failed
        // post leaves the saved invoice as draft; the API must never mark it
        // posted when journal creation fails.
        const postRes = await fetch(`/api/purchase-workflow/vendor-invoices/${data.id}/post`, {
          method: "POST",
          credentials: "include",
        });
        if (!postRes.ok) {
          toast.success("Vendor invoice berhasil dibuat (perlu di-post manual untuk bisa dibayar)");
        } else {
          toast.success("Vendor invoice berhasil dibuat & diposting — siap dibayar via Bank Disbursement");
        }
      }
      navigate(`/purchase/vendor-invoices/${data.id}`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-5xl">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/purchase/vendor-invoices")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="h-6 w-6 text-indigo-500" />
              Import Invoice via AI
            </h1>
            <p className="text-sm text-muted-foreground">
              Upload PDF atau gambar invoice — AI akan mengekstrak datanya otomatis
            </p>
          </div>
        </div>

        {/* SAP Lock indicator — SAP_LOCK.allowCalculation is always false */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          {SAP_LOCK.label} — sourceOfTruth: {SAP_LOCK.sourceOfTruth}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload Invoice
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
                ${dragging ? "border-indigo-500 bg-indigo-50" : "border-muted-foreground/30 hover:border-indigo-400 hover:bg-muted/30"}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <FileText className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Drag & drop atau klik untuk pilih file</p>
              <p className="text-xs text-muted-foreground mt-1">
                PDF, JPG, PNG, WEBP — maks 20MB
              </p>
            </div>

            {file && (
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <FileText className="h-5 w-5 text-indigo-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    setFile(null);
                    setResult(null);
                    setSapTax(null);
                    setDisplayLines([]);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            )}

            <Button
              onClick={extract}
              disabled={!file || loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  AI sedang menganalisis invoice…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Ekstrak dengan AI
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {result && sapTax && (
          <>
            {/* OCR confidence banner */}
            <div
              className={`flex items-start gap-3 p-4 rounded-lg border text-sm ${confidenceColor(result.raw_confidence)}`}
            >
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                  <p className="font-semibold">
                  Ekstraksi selesai — Tingkat kepercayaan OCR:{" "}
                  <strong>{confidenceLabel(result.raw_confidence)}</strong> (
                  {Math.round(result.raw_confidence * 100)}%)
                </p>
                {result.tax_review?.required && (
                  <p className="mt-2 text-xs font-semibold text-amber-700">
                    Tax review wajib — PPh tidak akan auto-post sebelum jenis, tax object, dan bukti pendukung direview.
                  </p>
                )}
                {result.flags?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {result.flags.map((f, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-xs opacity-80"
                      >
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* SAP Tax Validation banner */}
            <div
              className={`flex items-start gap-3 p-4 rounded-lg border text-sm ${
                canAutoPostOcrInvoice
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-amber-50 border-amber-200 text-amber-700"
              }`}
            >
              <ShieldCheck className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">
                  SAP Tax Engine —{" "}
                  <Badge
                    variant="outline"
                    className={`text-xs ml-1 ${sapTax.tax_mode === "HEADER_TAX_ONLY" ? "border-green-400 text-green-700" : "border-amber-400 text-amber-700"}`}
                  >
                    {sapTax.tax_mode}
                  </Badge>{" "}
                  · Confidence: {Math.round(sapTax.confidence * 100)}%
                  {sapTax.validation.is_valid
                    ? " · ✓ Balanced"
                    : ` · ⚠ Selisih ${idr(sapTax.validation.difference)}`}
                </p>
                {sapTax.flags?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {sapTax.flags.map((f, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-xs opacity-80"
                      >
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
                {canAutoPostOcrInvoice ? (
                  <p className="mt-2 text-xs">
                    ✓ Header seimbang dan confidence memenuhi syarat. Invoice dapat auto-post ke jurnal.
                  </p>
                ) : (
                  <div className="mt-2 text-xs">
                    <p className="font-semibold">Auto-post diblokir — invoice akan tetap menjadi draft untuk review.</p>
                    <ul className="mt-1 list-disc pl-4 space-y-0.5">
                      {ocrAutoPostReviewReasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Invoice info form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Info Invoice</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label>Nama Supplier</Label>
                      {!supplierExists && form.supplierName.trim() && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs px-2 border-amber-400 text-amber-700 hover:bg-amber-50"
                          onClick={() => {
                            setNewSupplierForm(f => ({ ...f, name: form.supplierName.trim() }));
                            setShowAddSupplier(true);
                          }}
                        >
                          <UserPlus className="h-3 w-3 mr-1" />
                          Tambah Supplier
                        </Button>
                      )}
                      {supplierExists && form.supplierName.trim() && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="h-3 w-3" />
                          Ada di database
                        </span>
                      )}
                    </div>
                    <Input
                      value={form.supplierName}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, supplierName: e.target.value }))
                      }
                      className={!supplierExists && form.supplierName.trim() ? "border-amber-400 focus-visible:ring-amber-400" : ""}
                    />
                    {!supplierExists && form.supplierName.trim() && (
                      <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Supplier ini belum ada di database. Klik &ldquo;Tambah Supplier&rdquo; untuk mendaftarkannya.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>No. Invoice Supplier</Label>
                    <Input
                      value={form.vendorInvoiceRef}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          vendorInvoiceRef: e.target.value,
                        }))
                      }
                      onBlur={() => checkDuplicate(form.vendorInvoiceRef.trim(), form.supplierName.trim())}
                      placeholder="Nomor dari supplier..."
                      className={duplicateWarning ? "border-red-400 focus-visible:ring-red-400" : ""}
                    />
                    {duplicateWarning && (
                      <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {duplicateWarning}
                      </p>
                    )}
                  </div>
                  {result.vendor_tax_id && (
                    <div>
                      <Label>NPWP Vendor (dari invoice)</Label>
                      <Input
                        value={result.vendor_tax_id}
                        readOnly
                        className="bg-muted"
                      />
                    </div>
                  )}
                  <div>
                    <Label>Tgl Invoice</Label>
                    <DatePicker value={form.invoiceDate} onChange={(v) => setForm((f) => ({ ...f, invoiceDate: v }))} />
                  </div>
                  <div>
                    <Label>Term Pembayaran (hari)</Label>
                    <Input
                      type="number"
                      value={form.paymentTermDays}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          paymentTermDays: e.target.value,
                        }))
                      }
                    />
                  </div>
                  {form.dueDate && (
                    <div className="text-xs text-muted-foreground">
                      Jatuh tempo dari invoice:{" "}
                      <span className="font-medium">{form.dueDate}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* SAP Header Summary — source of truth for all financial values */}
              <Card className="border-blue-200">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lock className="h-4 w-4 text-blue-500" />
                    Ringkasan SAP Header
                    <Badge variant="secondary" className="ml-auto text-xs">
                      Backend Source
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {/*
                   * SAP LOCK — values below come ONLY from invoice.header.
                   * Subtotal = sap_tax.tax.net  (NET/DPP from invoice header)
                   * PPN     = sap_tax.tax.vat  (VAT/PPN from invoice header)
                   * Grand   = sap_tax.tax.gross (GROSS/TOTAL from invoice header)
                   */}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Subtotal / DPP
                      <span className="ml-1 text-xs opacity-60">(header.net)</span>
                    </span>
                    <span className="font-mono">{idr(sapTax.tax.net)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      PPN / Pajak
                      {sapTax.tax.type !== "NONE" && (
                        <Badge variant="outline" className="text-xs">
                          {sapTax.tax.type}
                        </Badge>
                      )}
                      <span className="text-xs opacity-60">(header.vat)</span>
                    </span>
                    <span className="font-mono">{idr(sapTax.tax.vat)}</span>
                  </div>
                  {result.discount != null && (
                    <div className="flex justify-between text-green-600">
                      <span>Diskon</span>
                      <span className="font-mono">-{idr(result.discount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-bold text-base">
                    <span className="flex items-center gap-1">
                      Grand Total
                      <span className="text-xs font-normal opacity-60">(header.gross)</span>
                    </span>
                    {/* SAP LOCK: this value comes from backend header, NEVER computed */}
                    <span className="font-mono">{idr(sapTax.tax.gross)}</span>
                  </div>
                  {!sapTax.validation.is_valid && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 rounded p-2 mt-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Selisih header terdeteksi ({idr(sapTax.validation.difference)}) — nilai tetap dari invoice, tidak dikoreksi
                    </div>
                  )}
                  <div className="flex justify-between text-xs text-muted-foreground pt-1">
                    <span>Mata uang</span>
                    <Badge variant="secondary">
                      {sapTax.invoice.currency ?? result.currency ?? "IDR"}
                    </Badge>
                  </div>
                  {result.payment_status_hint && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Status</span>
                      <Badge
                        variant={
                          result.payment_status_hint === "PAID"
                            ? "default"
                            : result.payment_status_hint === "PARTIAL"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {result.payment_status_hint}
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Explicit component breakdown — values are OCR evidence, never recalculated here. */}
            <Card className="border-amber-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-amber-600" />
                  Breakdown Tagihan & Pajak
                  <Badge variant="outline" className="ml-auto text-xs border-amber-400 text-amber-700">
                    Sumber invoice
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Nilai berikut dibaca dari tabel invoice. PPh hanya diisi jika nominalnya tertulis pada dokumen.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.invoice_breakdown?.components?.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-2">Komponen</th>
                          <th className="text-right py-2 px-2">DPP / Net</th>
                          <th className="text-right py-2 px-2">PPN</th>
                          <th className="text-right py-2 px-2">Gross</th>
                          <th className="text-right py-2 px-2">PPh</th>
                          <th className="text-right py-2 px-2">Bayar ke Vendor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.invoice_breakdown.components.map((component, index) => (
                          <tr key={`${component.component}-${index}`} className="border-b align-top">
                            <td className="py-2 px-2 font-medium">{component.label}</td>
                            <td className="py-2 px-2 text-right font-mono">{idr(component.dpp)}</td>
                            <td className="py-2 px-2 text-right font-mono">{idr(component.ppn)}</td>
                            <td className="py-2 px-2 text-right font-mono">{idr(component.gross)}</td>
                            <td className="py-2 px-2 text-right font-mono">
                              {idr(component.withholding_tax_amount)}
                              {component.withholding_tax_rate != null && (
                                <span className="block text-[11px] text-muted-foreground">
                                  tarif {component.withholding_tax_rate}%
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right font-mono font-semibold">
                              {component.payable_amount != null ? idr(component.payable_amount) : "Belum terbaca"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    Breakdown komponen belum terbaca dari invoice. Silakan review sebelum posting.
                  </div>
                )}

                {result.invoice_breakdown && (
                  <>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-3 text-sm md:grid-cols-5">
                      <div>
                        <p className="text-xs text-muted-foreground">Total DPP</p>
                        <p className="font-mono font-semibold">{idr(result.invoice_breakdown.totals.dpp)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total PPN</p>
                        <p className="font-mono font-semibold">{idr(result.invoice_breakdown.totals.ppn)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total Gross</p>
                        <p className="font-mono font-semibold">{idr(result.invoice_breakdown.totals.gross)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Potongan PPh</p>
                        <p className="font-mono font-semibold text-red-700">
                          {idr(
                            result.invoice_breakdown.withholding_tax.amount ??
                            result.invoice_breakdown.totals.withholding_tax_amount,
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total Dibayar</p>
                        <p className="font-mono font-bold text-emerald-700">
                          {idr(result.invoice_breakdown.totals.payable_amount)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {result.invoice_breakdown.components.map((component, index) => {
                        const detailEntries = [
                          ["RE Object", component.details.re_object],
                          ["Tarif", component.details.tariff],
                          ["UOM", component.details.uom],
                          ["Omzet", component.details.turnover],
                          ["MOB", component.details.mob],
                          ["Meter From", component.details.meter_from],
                          ["Meter To", component.details.meter_to],
                          ["Pemakaian", component.details.usage],
                          ["Masa Jasa", component.details.service_period],
                        ].filter(([, value]) => value != null && value !== "");
                        if (detailEntries.length === 0) return null;
                        return (
                          <div key={`detail-${component.component}-${index}`} className="rounded-md bg-muted/40 px-3 py-2">
                            <p className="text-xs font-semibold text-muted-foreground">{component.label}</p>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                              {detailEntries.map(([label, value]) => (
                                <span key={label}>
                                  <span className="text-muted-foreground">{label}: </span>
                                  <span className="font-medium">
                                    {typeof value === "number" ? idr(value) : String(value)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {result.invoice_breakdown.withholding_tax.amount == null &&
                      (result.invoice_breakdown.withholding_tax.rate != null ||
                        result.invoice_breakdown.withholding_tax.evidence) && (
                        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-800">
                          Tarif/bukti PPh terbaca, tetapi nominal potongan PPh belum tercetak atau belum terbaca.
                          Nominal transfer tidak boleh diposting otomatis sebelum diverifikasi.
                          {result.invoice_breakdown.withholding_tax.evidence
                            ? ` Bukti: ${result.invoice_breakdown.withholding_tax.evidence}`
                            : ""}
                        </div>
                      )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* PPh review — visible evidence, never auto-posted */}
            <Card
              className={
                result.tax_review?.required
                  ? "border-amber-300 bg-amber-50/40"
                  : "border-slate-200"
              }
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                  Review PPh
                  <Badge
                    variant="outline"
                    className={
                      result.tax_review?.required
                        ? "ml-auto border-amber-400 text-amber-700"
                        : "ml-auto text-muted-foreground"
                    }
                  >
                    {result.tax_review?.required ? "Perlu Review" : "Tidak Terdeteksi"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
                  <span className="text-muted-foreground">Jenis PPh</span>
                  <span className="font-medium text-right">
                    {result.tax_review?.withholding_tax_type ?? result.withholding_tax_type ?? "—"}
                  </span>
                  <span className="text-muted-foreground">Tax object</span>
                  <span className="font-medium text-right">
                    {result.tax_review?.tax_object ?? result.tax_object ?? "—"}
                  </span>
                  <span className="text-muted-foreground">Nilai PPh</span>
                  <span className="font-mono font-medium text-right">
                    {idr(result.tax_review?.withholding_amount ?? result.withholding_amount)}
                  </span>
                </div>
                {result.tax_review?.required ? (
                  <div className="rounded-md border border-amber-200 bg-amber-100/60 p-3 text-xs text-amber-800">
                    <p className="font-semibold">PPh tidak diposting otomatis.</p>
                    <p className="mt-1">
                      Pastikan jenis PPh, tax object, nilai, dan bukti potong sudah benar sebelum review
                      manual di invoice vendor.
                    </p>
                    {result.tax_review.reasons.length > 0 && (
                      <ul className="mt-2 list-disc space-y-0.5 pl-4">
                        {result.tax_review.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Tidak ada PPh yang disebutkan secara eksplisit pada invoice. Nilai kosong tidak berarti
                    invoice pasti bebas PPh.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Items table — DISPLAY ONLY */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Item Invoice</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    Display only — tidak digunakan untuk kalkulasi keuangan
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDisplayLines((prev) => [
                      ...prev,
                      {
                        description: "",
                        quantity: "1",
                        unit: "ls",
                        unitPrice: "",
                        notes: "",
                        coaHint: "",
                        coaAccountId: "",
                      },
                    ])
                  }
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Tambah Baris
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Deskripsi</th>
                        <th className="text-left py-2 px-2 w-20">Qty</th>
                        <th className="text-left py-2 px-2 w-20">Satuan</th>
                        <th className="text-left py-2 px-2 w-36">Harga Satuan</th>
                        <th className="text-left py-2 px-2">Catatan</th>
                        <th className="text-left py-2 px-2 min-w-64">
                          COA Akun <span className="text-xs font-normal text-muted-foreground">(Supabase)</span>
                        </th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {displayLines.map((line, i) => (
                        <tr key={i} className="border-b">
                          <td className="py-1 px-2">
                            <Input
                              value={line.description}
                              onChange={(e) =>
                                updateDisplayLine(i, "description", e.target.value)
                              }
                              className="h-8"
                            />
                          </td>
                          <td className="py-1 px-2">
                            <Input
                              type="number"
                              value={line.quantity}
                              onChange={(e) =>
                                updateDisplayLine(i, "quantity", e.target.value)
                              }
                              className="h-8"
                            />
                          </td>
                          <td className="py-1 px-2">
                            <Input
                              value={line.unit}
                              onChange={(e) =>
                                updateDisplayLine(i, "unit", e.target.value)
                              }
                              className="h-8"
                            />
                          </td>
                          <td className="py-1 px-2">
                            <Input
                              type="number"
                              value={line.unitPrice}
                              onChange={(e) =>
                                updateDisplayLine(i, "unitPrice", e.target.value)
                              }
                              className="h-8"
                              placeholder="Referensi"
                            />
                          </td>
                          <td className="py-1 px-2">
                            <Input
                              value={line.notes}
                              onChange={(e) =>
                                updateDisplayLine(i, "notes", e.target.value)
                              }
                              className="h-8"
                              placeholder="—"
                            />
                          </td>
                          <td className="py-1 px-2">
                            <select
                              value={line.coaAccountId}
                              onChange={(e) =>
                                updateDisplayLine(i, "coaAccountId", e.target.value)
                              }
                              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                              disabled={coaAccountsLoading}
                              aria-label={`COA akun baris ${i + 1}`}
                            >
                              <option value="">
                                {coaAccountsLoading ? "Memuat COA..." : "Pilih COA dari Supabase"}
                              </option>
                              {coaAccounts.map((account) => (
                                <option key={account.id} value={String(account.id)}>
                                  {account.code} — {account.name}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={line.coaHint || undefined}>
                              AI hint: {line.coaHint || "—"}
                            </p>
                          </td>
                          <td className="py-1 px-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() =>
                                setDisplayLines((prev) =>
                                  prev.filter((_, idx) => idx !== i),
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/*
                     * SAP LOCK FOOTER — all values from invoice.header only.
                     * FORBIDDEN: totalAmount + taxAmount, reduce(), sum()
                     * ALLOWED: display sapTax.tax.{net, vat, gross} directly
                     */}
                    <tfoot>
                      <tr className="border-t bg-blue-50/50">
                        <td
                          colSpan={5}
                          className="py-2 px-2 text-right font-semibold text-sm text-blue-700"
                        >
                          <span className="flex items-center justify-end gap-1">
                            <Lock className="h-3 w-3" />
                            Subtotal / DPP
                          </span>
                        </td>
                        {/* SAP LOCK: invoice.header.net */}
                        <td className="py-2 px-2 text-right font-mono font-semibold text-blue-700">
                          {idr(sapTax.tax.net)}
                        </td>
                        <td />
                      </tr>
                      <tr className="bg-blue-50/30">
                        <td
                          colSpan={5}
                          className="py-2 px-2 text-right text-sm text-blue-600"
                        >
                          <span className="flex items-center justify-end gap-1">
                            <Lock className="h-3 w-3" />
                            PPN / Pajak ({sapTax.tax.type})
                          </span>
                        </td>
                        {/* SAP LOCK: invoice.header.vat */}
                        <td className="py-2 px-2 text-right font-mono text-blue-600">
                          {idr(sapTax.tax.vat)}
                        </td>
                        <td />
                      </tr>
                      <tr className="bg-blue-50">
                        <td
                          colSpan={5}
                          className="py-2 px-2 text-right font-bold text-blue-800"
                        >
                          <span className="flex items-center justify-end gap-1">
                            <Lock className="h-3 w-3" />
                            Grand Total
                          </span>
                        </td>
                        {/* SAP LOCK: invoice.header.gross — NEVER computed */}
                        <td className="py-2 px-2 text-right font-mono font-bold text-lg text-blue-800">
                          {idr(sapTax.tax.gross)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => navigate("/purchase/vendor-invoices")}
              >
                Batal
              </Button>
              <Button onClick={save} disabled={saving} className="min-w-40">
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan…
                  </>
                ) : (
                  <>
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Simpan sebagai Vendor Invoice
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ── Quick Create Supplier Dialog ──────────────────────────────────── */}
      <Dialog open={showAddSupplier} onOpenChange={setShowAddSupplier}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-amber-600" />
              Tambah Supplier Baru
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <Label>Nama Supplier <span className="text-destructive">*</span></Label>
              <Input
                className="mt-1"
                placeholder="PT. Nama Supplier"
                value={newSupplierForm.name}
                onChange={e => setNewSupplierForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>No. Telepon</Label>
                <Input
                  className="mt-1"
                  placeholder="08xxx"
                  value={newSupplierForm.phone}
                  onChange={e => setNewSupplierForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div>
                <Label>Negara</Label>
                <Input
                  className="mt-1"
                  value={newSupplierForm.country}
                  onChange={e => setNewSupplierForm(f => ({ ...f, country: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Nama Kontak (PIC)</Label>
              <Input
                className="mt-1"
                placeholder="Nama PIC"
                value={newSupplierForm.contactPerson}
                onChange={e => setNewSupplierForm(f => ({ ...f, contactPerson: e.target.value }))}
              />
            </div>
            <div>
              <Label>Email Kontak</Label>
              <Input
                className="mt-1"
                type="email"
                placeholder="email@supplier.com"
                value={newSupplierForm.contactEmail}
                onChange={e => setNewSupplierForm(f => ({ ...f, contactEmail: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddSupplier(false)}>
              Batal
            </Button>
            <Button
              onClick={handleCreateSupplier}
              disabled={createSupplierMut.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {createSupplierMut.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Menyimpan…</>
              ) : (
                <><Plus className="h-4 w-4 mr-2" />Simpan Supplier</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
