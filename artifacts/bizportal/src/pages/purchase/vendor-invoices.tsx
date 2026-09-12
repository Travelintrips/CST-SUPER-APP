import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Eye, ChevronLeft, Send, CheckCircle, FileText, Bot, Banknote, RotateCcw, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const idr = (n: number | string | null | undefined) => {
  const amount = Number(n);
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(Number.isFinite(amount) ? amount : 0);
};
const apiFetch = (path: string, opts?: RequestInit) => fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
const formatPostingError = (body: unknown, fallback: string) => {
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const base = String(payload.message ?? payload.error ?? fallback);
  const reasons = Array.isArray(payload.reasons)
    ? payload.reasons
      .map((reason) => {
        if (!reason || typeof reason !== "object") return String(reason ?? "");
        const item = reason as Record<string, unknown>;
        return String(item.message ?? item.code ?? "");
      })
      .filter(Boolean)
    : [];
  return reasons.length > 0 ? `${base} ${reasons.join(" ")}` : base;
};

interface VILine { id?: number; productId?: number; name: string; quantity: string; unit: string; unitCost: string; subtotal: string; taxAmount: string; coaAccountId?: string; taxType?: string; taxObject?: string; withholdingAmount?: string; liabilityAccountId?: string; notes: string; }
interface VIInvoiceBreakdownComponent {
  withholding_tax_type?: string | null;
  withholding_tax_amount?: number | null;
}
interface VI { id: number; invoiceNumber: string; status: string; supplierName: string; vendorInvoiceRef?: string; poId?: number; grId?: number; invoiceDate: string; dueDate?: string; paymentTermDays: number; totalAmount: string; taxAmount: string; grandTotal: string; amountPaid: string; journalStatus?: string | null; journalEntryNumber?: string | null; withholdingTaxAmount?: string; invoiceBreakdown?: { components?: VIInvoiceBreakdownComponent[] } | null; threeWayMatchStatus: string; matchNotes?: string; lines: VILine[]; lineTaxes?: Array<{ id?: number; invoiceLineId: number; taxType: string; taxObject: string; taxAmount: string; liabilityAccountId?: number | null; resolutionStatus?: string | null }>; withholdingRecords?: Array<{ lineTaxId?: number; invoiceLineId?: number; status?: string | null }>; }
interface LiabilityAccount { id: number; code: string; name: string; }
type VendorInvoiceListItem = Record<string, unknown>;

function parseVendorInvoiceList(payload: unknown): VendorInvoiceListItem[] {
  if (Array.isArray(payload)) return payload as VendorInvoiceListItem[];
  if (payload && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as VendorInvoiceListItem[];
  }
  throw new Error("Format data vendor invoice dari server tidak valid.");
}

export function VendorInvoicesListPage() {
  const { activeCompanyId } = useCompany();
  const qcClient = useQueryClient();
  const [postingId, setPostingId] = useState<number | null>(null);
  const [recoveringId, setRecoveringId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data: vis = [], isLoading, isError, error } = useQuery({
    queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId],
    queryFn: async () => {
      const response = await fetch(`/api/purchase-workflow/vendor-invoices?company=${activeCompanyId}`, {
        credentials: "include",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === "object"
          ? String((payload as { error?: unknown; message?: unknown }).error
            ?? (payload as { message?: unknown }).message
            ?? "Gagal memuat vendor invoice.")
          : "Gagal memuat vendor invoice.";
        throw new Error(message);
      }
      return parseVendorInvoiceList(payload);
    },
    enabled: activeCompanyId != null,
  });

  const handlePost = async (id: number) => {
    setPostingId(id);
    try {
      const r = await apiFetch(`/purchase-workflow/vendor-invoices/${id}/post?company=${activeCompanyId}`, { method: "POST" });
      if (!r.ok) {
        const errJson = await r.json().catch(() => ({}));
        throw new Error(formatPostingError(errJson, "Gagal posting invoice"));
      }
      toast.success("Invoice berhasil diposting");
      qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal posting invoice");
    } finally {
      setPostingId(null);
    }
  };

  const handleRecover = async (id: number) => {
    if (!window.confirm("Promosikan journal draft yang tertaut menjadi posted? Journal lain/orphan tidak akan diubah.")) {
      return;
    }
    setRecoveringId(id);
    try {
      const r = await apiFetch(`/purchase-workflow/vendor-invoices/${id}/recover-journal?company=${activeCompanyId}`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(formatPostingError(body, "Gagal memulihkan jurnal"));
      toast.success("Journal invoice berhasil dipulihkan menjadi posted");
      qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memulihkan jurnal");
    } finally {
      setRecoveringId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const r = await apiFetch(
        `/purchase-workflow/vendor-invoices/${id}?company=${activeCompanyId}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error ?? "Gagal");
      }
      toast.success("Invoice berhasil dihapus");
      qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus invoice");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const confirmTarget = vis.find((vi: Record<string, unknown>) => Number(vi.id) === confirmDeleteId);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Vendor Invoice (AP)</h1>
            <p className="text-sm text-muted-foreground">Pusat tagihan supplier & 3-way matching</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/purchase/vendor-invoices/import"><Button variant="outline"><Bot className="mr-2 h-4 w-4 text-indigo-500" />Import via AI</Button></Link>
            <Link href="/purchase/vendor-invoices/new"><Button variant="outline"><Plus className="mr-2 h-4 w-4" />Buat Invoice</Button></Link>
            <Link href="/accounting/bank-disbursements?mode=vendor_invoice">
              <Button className="bg-orange-600 hover:bg-orange-700 text-white gap-2">
                <Banknote className="h-4 w-4" />Buat Bank Disbursement
              </Button>
            </Link>
          </div>
        </div>

        {/* Dialog konfirmasi hapus */}
        {confirmDeleteId !== null && confirmTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background border rounded-lg shadow-lg p-6 w-full max-w-sm mx-4">
              <h2 className="text-lg font-semibold mb-1">Hapus Invoice?</h2>
              <p className="text-sm text-muted-foreground mb-1">
                <span className="font-mono font-medium text-foreground">{String(confirmTarget.invoiceNumber)}</span> — {String(confirmTarget.supplierName)}
              </p>
              <p className="text-sm text-destructive mb-4">Tindakan ini tidak dapat dibatalkan.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmDeleteId(null)} disabled={deletingId === confirmDeleteId}>
                  Batal
                </Button>
                <Button
                  variant="destructive"
                  disabled={deletingId === confirmDeleteId}
                  onClick={() => handleDelete(confirmDeleteId)}
                >
                  {deletingId === confirmDeleteId ? "Menghapus..." : "Ya, Hapus"}
                </Button>
              </div>
            </div>
          </div>
        )}

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Daftar Vendor Invoice</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="text-center py-8">Loading...</div> : isError ? (
              <div className="text-center py-8 text-destructive">
                Gagal memuat vendor invoice: {error instanceof Error ? error.message : "Terjadi kesalahan."}
              </div>
            ) : vis.length === 0 ? <div className="text-center py-8 text-muted-foreground">Belum ada vendor invoice</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b">
                    <th className="text-left py-2 px-3">No. Invoice</th>
                    <th className="text-left py-2 px-3">Supplier</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-left py-2 px-3">3-Way Match</th>
                    <th className="text-right py-2 px-3">Grand Total</th>
                    <th className="text-right py-2 px-3">Terbayar</th>
                    <th className="text-right py-2 px-3">Aksi</th>
                  </tr></thead>
                  <tbody>
                    {vis.map((vi: Record<string, unknown>) => (
                      <tr key={String(vi.id)} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-mono text-xs">{String(vi.invoiceNumber)}</td>
                        <td className="py-2 px-3">{String(vi.supplierName)}</td>
                        <td className="py-2 px-3">
                          <Badge variant={vi.status === "paid" ? "default" : vi.status === "cancelled" ? "destructive" : vi.status === "posted" || vi.status === "matched" ? "secondary" : "outline"}>
                            {String(vi.status)}
                          </Badge>
                        </td>
                        <td className="py-2 px-3"><Badge variant={vi.threeWayMatchStatus === "matched" ? "default" : vi.threeWayMatchStatus === "partial" ? "secondary" : "outline"} className="text-xs">{String(vi.threeWayMatchStatus)}</Badge></td>
                        <td className="py-2 px-3 text-right font-mono">{idr(Number(vi.grandTotal))}</td>
                        <td className="py-2 px-3 text-right font-mono text-muted-foreground">{idr(Number(vi.amountPaid))}</td>
                        <td className="py-2 px-3">
                          <div className="flex items-center justify-end gap-1">
                            {vi.status === "draft" && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 px-2 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                                disabled={postingId === Number(vi.id)}
                                onClick={() => handlePost(Number(vi.id))}
                              >
                                <Send className="h-3 w-3" />
                                {postingId === Number(vi.id) ? "..." : "Post"}
                              </Button>
                            )}
                            {vi.status === "posted" && vi.journalStatus === "draft" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50"
                                disabled={recoveringId === Number(vi.id)}
                                onClick={() => handleRecover(Number(vi.id))}
                                title={String(vi.journalEntryNumber ?? "Journal draft")}
                              >
                                <RotateCcw className="h-3 w-3" />
                                {recoveringId === Number(vi.id) ? "..." : "Pulihkan Jurnal"}
                              </Button>
                            )}
                            {(vi.status === "posted" || vi.status === "matched") && Number(vi.grandTotal) - Number(vi.amountPaid) > 0 && (
                              <Link href={`/accounting/bank-disbursements?mode=vendor_invoice&invoiceIds=${vi.id}`}>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-orange-600 border-orange-300 hover:bg-orange-50">
                                  <Banknote className="h-3 w-3" />Bayar
                                </Button>
                              </Link>
                            )}
                            <Link href={`/purchase/vendor-invoices/${vi.id}`}>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Eye className="h-4 w-4" /></Button>
                            </Link>
                            {vi.status !== "paid" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setConfirmDeleteId(Number(vi.id))}
                                title="Hapus invoice"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

export function VendorInvoiceEditorPage() {
  const { id } = useParams();
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const [, navigate] = useLocation();
  const qcClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const isNew = !id || id === "new";

  const { data: vi, isLoading, isError, error } = useQuery<VI>({
    queryKey: ["/api/purchase-workflow/vendor-invoices", id, activeCompanyId],
    queryFn: async () => {
      const response = await apiFetch(`/purchase-workflow/vendor-invoices/${id}?company=${activeCompanyId}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === "object"
          ? String((payload as { error?: unknown; message?: unknown }).error
            ?? (payload as { message?: unknown }).message
            ?? "Gagal memuat detail vendor invoice.")
          : "Gagal memuat detail vendor invoice.";
        throw new Error(message);
      }
      return payload as VI;
    },
    enabled: !isNew && activeCompanyId != null,
  });
  const { data: liabilityAccounts = [], isLoading: liabilityAccountsLoading } = useQuery<LiabilityAccount[]>({
    queryKey: ["/api/purchase-workflow/vendor-invoices/liability-accounts", activeCompanyId],
    queryFn: async () => {
      const response = await apiFetch(`/purchase-workflow/vendor-invoices/liability-accounts?company=${activeCompanyId}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload)) {
        throw new Error("Gagal memuat akun liabilitas PPh.");
      }
      return payload as LiabilityAccount[];
    },
    enabled: !isNew && activeCompanyId != null,
  });

  const [form, setForm] = useState({ supplierName: "", vendorInvoiceRef: "", poId: sp.get("poId") ?? "", grId: sp.get("grId") ?? "", invoiceDate: new Date().toISOString().substring(0, 10), paymentTermDays: "30", notes: "" });
  const emptyLine = (): VILine => ({ name: "", quantity: "1", unit: "pcs", unitCost: "0", subtotal: "0", taxAmount: "0", coaAccountId: "", taxType: "", taxObject: "", withholdingAmount: "0", liabilityAccountId: "", notes: "" });
  const [lines, setLines] = useState<VILine[]>([emptyLine()]);

  useEffect(() => {
    if (vi) {
      setForm({ supplierName: vi.supplierName, vendorInvoiceRef: vi.vendorInvoiceRef ?? "", poId: String(vi.poId ?? ""), grId: String(vi.grId ?? ""), invoiceDate: vi.invoiceDate?.substring(0, 10) ?? new Date().toISOString().substring(0, 10), paymentTermDays: String(vi.paymentTermDays ?? 30), notes: "" });
       setLines(vi.lines?.length ? vi.lines.map((l, lineIndex) => {
         const tax = vi.lineTaxes?.find((candidate) => candidate.invoiceLineId === l.id);
         const breakdownTax = vi.invoiceBreakdown?.components?.[lineIndex];
         const withholdingAmount = tax && Number(tax.taxAmount) > 0
           ? String(tax.taxAmount)
           : breakdownTax?.withholding_tax_amount != null
             ? String(breakdownTax.withholding_tax_amount)
             : "0";
        return {
          ...l,
          quantity: String(l.quantity),
          unitCost: String(l.unitCost),
          subtotal: String(l.subtotal),
          taxAmount: String(l.taxAmount),
          coaAccountId: l.coaAccountId ? String(l.coaAccountId) : "",
           taxType: tax?.taxType ?? breakdownTax?.withholding_tax_type ?? "",
           taxObject: tax?.taxObject ?? breakdownTax?.withholding_tax_type ?? "",
           withholdingAmount,
          liabilityAccountId: tax?.liabilityAccountId ? String(tax.liabilityAccountId) : "",
        };
      }) : []);
    }
  }, [vi]);

  // The invoice carries the tax type and amount, while the GL account comes
  // from the company's COA. Apply the company's deterministic tax-account
  // convention as soon as both the invoice and liability account list exist.
  // Users can still override the suggestion before posting.
  useEffect(() => {
    if (!liabilityAccounts.length) return;
    setLines((current) => {
      let changed = false;
      const next = current.map((line) => {
        if (line.liabilityAccountId || Number(line.withholdingAmount ?? 0) <= 0) return line;
        const taxType = `${line.taxType ?? ""} ${line.taxObject ?? ""}`.toLowerCase();
        const exactName = taxType.includes("4(2)") || taxType.includes("4 ayat 2")
          ? /hutang pph final pasal 4 ayat 2/i
          : taxType.includes("pph 15")
            ? /hutang pph final pasal 15/i
            : new RegExp(`hutang pph pasal ${taxType.match(/pph\\s*(\\d+)/i)?.[1] ?? "___"}`, "i");
        const suggested = taxType.includes("pph 15")
          ? liabilityAccounts.find(
              (account) =>
                account.code.startsWith("2-1102-") ||
                /hutang pph final pasal 15/i.test(account.name),
            )
          : liabilityAccounts.find((account) => exactName.test(account.name));
        if (!suggested) return line;
        changed = true;
        return { ...line, liabilityAccountId: String(suggested.id) };
      });
      return changed ? next : current;
    });
  }, [liabilityAccounts, lines]);

  const updateLine = (i: number, key: keyof VILine, value: string) => setLines(prev => {
    const updated = prev.map((l, idx) => idx === i ? { ...l, [key]: value } : l);
    const line = updated[i];
    if (line && (key === "quantity" || key === "unitCost")) updated[i] = { ...line, subtotal: String((Number(line.quantity) * Number(line.unitCost)).toFixed(2)) };
    return updated;
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        poId: form.poId ? Number(form.poId) : undefined,
        grId: form.grId ? Number(form.grId) : undefined,
        companyId: activeCompanyId,
        lines: lines.map((line) => ({
          ...line,
          coaAccountId: line.coaAccountId ? Number(line.coaAccountId) : undefined,
          withholdingTaxes: Number(line.withholdingAmount ?? 0) > 0 ? [{
            taxType: line.taxType,
            taxObject: line.taxObject,
            taxAmount: Number(line.withholdingAmount),
            liabilityAccountId: line.liabilityAccountId ? Number(line.liabilityAccountId) : undefined,
          }] : undefined,
        })),
      };
      const r = isNew ? await apiFetch("/purchase-workflow/vendor-invoices", { method: "POST", body: JSON.stringify(payload) }) : await apiFetch(`/purchase-workflow/vendor-invoices/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      if (!r.ok) throw new Error();
      const saved = await r.json() as VI;
      // PUT recreates invoice lines, so their database IDs may change. Always
      // read the saved detail before Finance Review instead of submitting stale
      // IDs from the form state.
      const fresh = await apiFetch(`/purchase-workflow/vendor-invoices/${saved.id}?company=${activeCompanyId}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("Invoice tersimpan, tetapi detail terbaru gagal dimuat.");
          return response.json() as Promise<VI>;
        });
      const freshLines = fresh.lines ?? [];
      const reviewLines = lines.map((line, index) => ({
        lineId: freshLines[index]?.id,
        coaAccountId: Number(line.coaAccountId),
        mappingKey: line.name,
        saveReusableRule: true,
      })).filter((line) => line.lineId && line.coaAccountId);
      const reviewTaxes = lines.map((line, index) => ({
        invoiceLineId: freshLines[index]?.id,
        taxType: line.taxType,
        taxObject: line.taxObject,
        baseAmount: Number(line.subtotal),
        taxAmount: Number(line.withholdingAmount),
        liabilityAccountId: Number(line.liabilityAccountId),
      })).filter((line) => line.invoiceLineId && line.taxAmount > 0 && line.taxType && line.taxObject && line.liabilityAccountId);
      if (saved.id && (reviewLines.length > 0 || reviewTaxes.length > 0)) {
        const reviewResponse = await apiFetch(`/purchase-workflow/vendor-invoices/${saved.id}/finance-review?company=${activeCompanyId}`, {
          method: "PUT",
          body: JSON.stringify({ lines: reviewLines, taxes: reviewTaxes }),
        });
        if (!reviewResponse.ok) {
          const body = await reviewResponse.json().catch(() => ({}));
          throw new Error(formatPostingError(body, "Finance Review gagal disimpan."));
        }
      }
      return fresh;
    },
    onSuccess: (data: VI) => { toast.success("Tersimpan"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices"] }); if (isNew) navigate(`/purchase/vendor-invoices/${data.id}`); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal"),
  });

  const postMut = useMutation({
    mutationFn: async () => {
      // Users commonly edit the imported values and click Post directly.
      // Persist the current form and its Finance Review first so posting reads
      // the same values and confirmed tax accounts visible on screen.
      const reviewedTaxes = vi?.lineTaxes?.filter((tax) => Number(tax.taxAmount) > 0) ?? [];
      const financeReviewComplete = reviewedTaxes.length > 0 && reviewedTaxes.every((tax) => {
        const record = vi?.withholdingRecords?.find((candidate) =>
          (tax.id != null && candidate.lineTaxId === tax.id) ||
          candidate.invoiceLineId === tax.invoiceLineId,
        );
        return Boolean(
          tax.liabilityAccountId &&
          ["confirmed", "approved"].includes(String(tax.resolutionStatus)) &&
          ["proof_pending", "proof_received", "posted"].includes(String(record?.status)),
        );
      });
      if (!financeReviewComplete) {
        await saveMut.mutateAsync();
      }
      const r = await apiFetch(`/purchase-workflow/vendor-invoices/${vi?.id}/post?company=${activeCompanyId}`, { method: "POST" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(formatPostingError(body, "Gagal posting"));
      }
      return r.json();
    },
    onSuccess: async () => {
      toast.success("Invoice diposting & jurnal dibuat");
      await qcClient.invalidateQueries({
        queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId],
      });
      navigate("/purchase/vendor-invoices");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal posting"),
  });

  const recoverMut = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/purchase-workflow/vendor-invoices/${vi?.id}/recover-journal?company=${activeCompanyId}`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(formatPostingError(body, "Gagal memulihkan jurnal"));
      return body;
    },
    onSuccess: async () => {
      toast.success("Journal invoice berhasil dipulihkan menjadi posted");
      await qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", id, activeCompanyId] });
      await qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal memulihkan jurnal"),
  });

  const resetPaymentMut = useMutation({
    mutationFn: async (reason: string) => {
      const r = await apiFetch(`/purchase-workflow/vendor-invoices/${vi?.id}/reset-payment?company=${activeCompanyId}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(formatPostingError(body, "Gagal mereset status pembayaran"));
      return body;
    },
    onSuccess: async () => {
      toast.success("Status pembayaran dikoreksi menjadi belum terbayar");
      await qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", id, activeCompanyId] });
      await qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal mereset status pembayaran"),
  });

  const syncPaymentStatusMut = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/purchase-workflow/vendor-invoices/${vi?.id}/recalculate-payment-status?company=${activeCompanyId}`, {
        method: "POST",
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(formatPostingError(body, "Gagal menyinkronkan status pembayaran"));
      return body;
    },
    onSuccess: async (body) => {
      const paymentStatus = body?.paymentStatus;
      if (paymentStatus?.status === "paid") {
        toast.success("Invoice ditandai paid dari rekonsiliasi yang sudah cocok");
      } else if (paymentStatus?.amountPaid != null) {
        toast.success(
          paymentStatus.withholdingComplete === false
            ? "Pembayaran bruto tersinkron; lengkapi bukti potong PPh untuk status paid"
            : "Status pembayaran invoice berhasil disinkronkan",
        );
      } else {
        toast.success("Status pembayaran invoice berhasil disinkronkan");
      }
      await qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", id, activeCompanyId] });
      await qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal menyinkronkan status pembayaran"),
  });

  const handleResetPayment = () => {
    if (!vi || Number(vi.amountPaid) <= 0) return;
    const reason = window.prompt(
      "Alasan koreksi pembayaran (minimal 10 karakter):",
      "Koreksi settlement orphan; invoice dikembalikan menjadi belum terbayar.",
    );
    if (!reason?.trim()) return;
    resetPaymentMut.mutate(reason.trim());
  };

  const isDraft = !vi || vi.status === "draft";
  if (!isNew && (activeCompanyId == null || isLoading)) {
    return <AppShell><div className="flex items-center justify-center h-64">Loading...</div></AppShell>;
  }
  if (!isNew && isError) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center gap-3 h-64 text-center">
          <p className="text-destructive">
            Gagal memuat detail invoice: {error instanceof Error ? error.message : "Terjadi kesalahan."}
          </p>
          <Button variant="outline" onClick={() => navigate("/purchase/vendor-invoices")}>
            <ChevronLeft className="mr-1 h-4 w-4" />Kembali ke daftar invoice
          </Button>
        </div>
      </AppShell>
    );
  }

  const totalAmount = lines.reduce((s, l) => s + Number(l.subtotal), 0);
  const taxAmount = lines.reduce((s, l) => s + Number(l.taxAmount), 0);
  const summarySubtotal = vi ? Number(vi.totalAmount) : totalAmount;
  const summaryTax = vi ? Number(vi.taxAmount) : taxAmount;
  const summaryGrandTotal = vi ? Number(vi.grandTotal) : summarySubtotal + summaryTax;
  const lineWithholding = lines.reduce((sum, line) => sum + Number(line.withholdingAmount ?? 0), 0);
  const summaryWithholding = vi
    ? Math.max(Number(vi.withholdingTaxAmount ?? 0), lineWithholding)
    : lineWithholding;
  const withholdingLines = lines.filter((line) => Number(line.withholdingAmount ?? 0) > 0);
  const incompleteWithholdingLines = withholdingLines.filter((line) =>
    !line.taxType?.trim() || !line.taxObject?.trim() || !line.liabilityAccountId,
  );
  const estimatedNetPayment = Math.max(0, summaryGrandTotal - summaryWithholding);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-7xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/purchase/vendor-invoices")}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{isNew ? "Buat Vendor Invoice" : `Invoice: ${vi?.invoiceNumber}`}</h1>
            {vi && (
              <div className="flex gap-2 mt-1">
                <Badge variant={vi.status === "paid" ? "default" : vi.status === "cancelled" ? "destructive" : "secondary"}>{vi.status}</Badge>
                <Badge variant={vi.threeWayMatchStatus === "matched" ? "default" : "secondary"}>{vi.threeWayMatchStatus}</Badge>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {isDraft && <Button variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Simpan</Button>}
            {!isNew && isDraft && (
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => postMut.mutate()} disabled={postMut.isPending || saveMut.isPending || liabilityAccountsLoading}>
                <Send className="mr-1 h-4 w-4" />{postMut.isPending ? "Memproses..." : "Post Invoice"}
              </Button>
            )}
            {!isNew && vi?.status === "posted" && vi?.journalStatus === "draft" && (
              <Button
                variant="outline"
                className="text-amber-700 border-amber-300 hover:bg-amber-50"
                onClick={() => recoverMut.mutate()}
                disabled={recoverMut.isPending}
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                {recoverMut.isPending ? "Memulihkan..." : "Pulihkan Journal"}
              </Button>
            )}
            {!isNew && vi && Number(vi.amountPaid) > 0 && (
              <Button
                variant="outline"
                className="text-red-700 border-red-300 hover:bg-red-50"
                onClick={handleResetPayment}
                disabled={resetPaymentMut.isPending}
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                {resetPaymentMut.isPending ? "Mengoreksi..." : "Reset Pembayaran"}
              </Button>
            )}
            {!isNew && vi && vi.status !== "paid" && Number(vi.amountPaid) > 0 && Number(vi.grandTotal) > Number(vi.amountPaid) && (
              <Button
                variant="outline"
                className="text-blue-700 border-blue-300 hover:bg-blue-50"
                onClick={() => syncPaymentStatusMut.mutate()}
                disabled={syncPaymentStatusMut.isPending}
              >
                <RefreshCw className={`mr-1 h-4 w-4 ${syncPaymentStatusMut.isPending ? "animate-spin" : ""}`} />
                {syncPaymentStatusMut.isPending ? "Menyinkronkan..." : "Sinkronkan Rekonsiliasi"}
              </Button>
            )}
          </div>
        </div>

        {/* Banner: draft — perlu dipost sebelum bisa dibayar */}
        {!isNew && isDraft && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="font-semibold">Invoice masih Draft</p>
              <p className="text-xs text-amber-700 mt-0.5">Klik <strong>"Post Invoice"</strong> untuk mengkonfirmasi & membuat jurnal. Setelah diposting, invoice bisa dibayar via Bank Disbursement.</p>
            </div>
          </div>
        )}
        {!isNew && vi?.status !== "draft" && vi?.journalStatus === "draft" && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="font-semibold">Invoice sudah posted, tetapi journal masih Draft</p>
              <p className="text-xs text-amber-700 mt-0.5">
                {vi.journalEntryNumber ? `Journal ${vi.journalEntryNumber} belum masuk Neraca Saldo.` : "Journal belum masuk Neraca Saldo."}
                {" "}Klik <strong>"Pulihkan Journal"</strong> setelah Finance memastikan detailnya balance.
              </p>
            </div>
          </div>
        )}
        {!isNew && isDraft && incompleteWithholdingLines.length > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-semibold">Finance Review PPh belum lengkap</p>
            <p className="mt-0.5 text-xs">
              Pilih akun liabilitas PPh pada {incompleteWithholdingLines.length} line sebelum invoice dapat diposting.
            </p>
          </div>
        )}

        {vi?.matchNotes && (
          <div className={`p-3 rounded border text-sm ${vi.threeWayMatchStatus === "matched" ? "bg-green-50 border-green-200 text-green-800" : "bg-yellow-50 border-yellow-200 text-yellow-800"}`}>
            <strong>3-Way Match:</strong> {vi.matchNotes}
          </div>
        )}

        {!isNew && vi && vi.status === "posted" && Number(vi.grandTotal) - Number(vi.amountPaid) > 0 && (
          <div className="flex gap-2">
            <Link href={`/accounting/bank-disbursements?mode=vendor_invoice&invoiceIds=${vi.id}`}>
              <Button className="bg-orange-600 hover:bg-orange-700 text-white gap-1" size="sm">
                <Banknote className="mr-1 h-4 w-4" />Buat Bank Disbursement
              </Button>
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Info Invoice</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>Nama Supplier</Label><Input value={form.supplierName} onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))} disabled={!isDraft} /></div>
              <div><Label>No. Invoice Supplier</Label><Input value={form.vendorInvoiceRef} onChange={e => setForm(f => ({ ...f, vendorInvoiceRef: e.target.value }))} disabled={!isDraft} placeholder="Nomor dari supplier..." /></div>
              <div><Label>No. PO (ID)</Label><Input value={form.poId} onChange={e => setForm(f => ({ ...f, poId: e.target.value }))} disabled={!isDraft} /></div>
              <div><Label>No. GRN (ID)</Label><Input value={form.grId} onChange={e => setForm(f => ({ ...f, grId: e.target.value }))} disabled={!isDraft} /></div>
              <div><Label>Tgl Invoice</Label><DatePicker value={form.invoiceDate} onChange={v => setForm(f => ({ ...f, invoiceDate: v }))} disabled={!isDraft} /></div>
              <div><Label>Term Pembayaran (hari)</Label><Input type="number" value={form.paymentTermDays} onChange={e => setForm(f => ({ ...f, paymentTermDays: e.target.value }))} disabled={!isDraft} /></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ringkasan Nilai Invoice</CardTitle>
              <p className="text-xs text-muted-foreground">Grand Total adalah nilai bruto. PPh dipotong saat pembayaran vendor.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="font-mono">{idr(summarySubtotal)}</span></div>
              <div className="flex justify-between text-slate-500"><span>Pajak (PPN)</span><span className="font-mono">{idr(summaryTax)}</span></div>
              <div className="flex justify-between text-amber-600"><span>PPh dipotong saat bayar</span><span className="font-mono">{idr(summaryWithholding)}</span></div>
              <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Grand Total (bruto)</span><span className="font-mono">{idr(summaryGrandTotal)}</span></div>
              <div className="flex justify-between font-semibold text-blue-600 border-t pt-2"><span>Estimasi transfer (neto)</span><span className="font-mono">{idr(estimatedNetPayment)}</span></div>
              {vi && (
                <div className={`flex justify-between ${Number(vi.amountPaid) > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                  <span>{Number(vi.amountPaid) > 0 ? "Terbayar" : "Belum terbayar"}</span>
                  <span className="font-mono">{idr(Number(vi.amountPaid))}</span>
                </div>
              )}
              {vi && <div className="flex justify-between font-semibold text-red-600"><span>Sisa</span><span className="font-mono">{idr(Math.max(0, Number(vi.grandTotal) - Number(vi.amountPaid)))}</span></div>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Rincian Item Invoice</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Masukkan nilai dalam rupiah. COA adalah akun beban; PPh adalah potongan pembayaran per baris.
              </p>
            </div>
            {isDraft && <Button size="sm" variant="outline" onClick={() => setLines(prev => [...prev, emptyLine()])}><Plus className="mr-1 h-4 w-4" />Tambah</Button>}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px] text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2 px-2 min-w-52"><span className="text-xs uppercase tracking-wide text-muted-foreground">Nama item</span></th>
                  <th className="text-left py-2 px-2 w-20"><span className="text-xs uppercase tracking-wide text-muted-foreground">Qty</span></th>
                  <th className="text-left py-2 px-2 w-20"><span className="text-xs uppercase tracking-wide text-muted-foreground">Satuan</span></th>
                  <th className="text-left py-2 px-2 w-40"><span className="text-xs uppercase tracking-wide text-muted-foreground">Harga satuan</span><span className="block text-[10px] font-normal text-muted-foreground">(Rp)</span></th>
                  <th className="text-left py-2 px-2 w-36"><span className="text-xs uppercase tracking-wide text-muted-foreground">PPN</span><span className="block text-[10px] font-normal text-muted-foreground">(Rp)</span></th>
                  <th className="text-left py-2 px-2 w-32"><span className="text-xs uppercase tracking-wide text-muted-foreground">COA beban</span><span className="block text-[10px] font-normal text-muted-foreground">(ID)</span></th>
                  <th className="text-left py-2 px-2 w-40"><span className="text-xs uppercase tracking-wide text-muted-foreground">PPh dipotong</span><span className="block text-[10px] font-normal text-muted-foreground">(Rp)</span></th>
                  <th className="text-left py-2 px-2 min-w-64"><span className="text-xs uppercase tracking-wide text-muted-foreground">Akun liabilitas PPh</span><span className="block text-[10px] font-normal text-muted-foreground">Wajib untuk Finance Review</span></th>
                  <th className="text-right py-2 px-2 w-36"><span className="text-xs uppercase tracking-wide text-muted-foreground">Subtotal</span><span className="block text-[10px] font-normal text-muted-foreground">(Rp)</span></th>
                  {isDraft && <th className="w-10" />}
                </tr></thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="border-b align-top">
                      <td className="py-2 px-2"><Input value={line.name} onChange={e => updateLine(i, "name", e.target.value)} disabled={!isDraft} className="h-9 min-w-48" aria-label={`Nama item ${i + 1}`} /></td>
                      <td className="py-2 px-2"><Input type="number" value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} disabled={!isDraft} className="h-9 w-20 text-right" aria-label={`Kuantitas item ${i + 1}`} /></td>
                      <td className="py-2 px-2"><Input value={line.unit} onChange={e => updateLine(i, "unit", e.target.value)} disabled={!isDraft} className="h-9 w-20" aria-label={`Satuan item ${i + 1}`} /></td>
                      <td className="py-2 px-2"><Input type="number" value={line.unitCost} onChange={e => updateLine(i, "unitCost", e.target.value)} disabled={!isDraft} className="h-9 w-36 text-right font-mono" aria-label={`Harga satuan item ${i + 1}`} /></td>
                      <td className="py-2 px-2"><Input type="number" value={line.taxAmount} onChange={e => updateLine(i, "taxAmount", e.target.value)} disabled={!isDraft} className="h-9 w-32 text-right font-mono" placeholder="0" aria-label={`PPN item ${i + 1}`} /></td>
                      <td className="py-2 px-2"><Input type="number" value={line.coaAccountId ?? ""} onChange={e => updateLine(i, "coaAccountId", e.target.value)} disabled={!isDraft} className="h-9 w-28 text-right font-mono" placeholder="ID akun" aria-label={`COA beban item ${i + 1}`} /></td>
                      <td className="py-2 px-2">
                        <Input type="number" value={line.withholdingAmount ?? "0"} onChange={e => updateLine(i, "withholdingAmount", e.target.value)} disabled={!isDraft} className="h-9 w-36 text-right font-mono" placeholder="0" aria-label={`PPh item ${i + 1}`} />
                        {line.taxType && <span className="mt-1 block text-[10px] text-amber-600">{line.taxType}</span>}
                      </td>
                      <td className="py-2 px-2">
                        {Number(line.withholdingAmount ?? 0) > 0 ? (
                          <div>
                            <Select
                              value={line.liabilityAccountId || undefined}
                              onValueChange={(value) => updateLine(i, "liabilityAccountId", value)}
                              disabled={!isDraft || liabilityAccountsLoading}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder={liabilityAccountsLoading ? "Memuat akun..." : "Pilih akun PPh"} />
                              </SelectTrigger>
                              <SelectContent searchPlaceholder="Cari kode atau nama akun...">
                                {liabilityAccounts.map((account) => (
                                  <SelectItem key={account.id} value={String(account.id)}>
                                    {account.code} — {account.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {line.liabilityAccountId && (
                              <span className="mt-1 block text-[10px] text-emerald-600">Usulan akun otomatis — dapat diubah Finance</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Tidak ada PPh</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-xs whitespace-nowrap">{idr(Number(line.subtotal))}</td>
                      {isDraft && <td className="py-1 px-2"><Button size="icon" variant="ghost" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="h-8 w-8"><Trash2 className="h-4 w-4 text-destructive" /></Button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
