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
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Eye, ChevronLeft, Send, CheckCircle, FileText, Bot, Banknote } from "lucide-react";
import { toast } from "sonner";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const apiFetch = (path: string, opts?: RequestInit) => fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });

interface VILine { id?: number; productId?: number; name: string; quantity: string; unit: string; unitCost: string; subtotal: string; taxAmount: string; coaAccountId?: string; taxType?: string; taxObject?: string; withholdingAmount?: string; liabilityAccountId?: string; notes: string; }
interface VI { id: number; invoiceNumber: string; status: string; supplierName: string; vendorInvoiceRef?: string; poId?: number; grId?: number; invoiceDate: string; dueDate?: string; paymentTermDays: number; totalAmount: string; taxAmount: string; grandTotal: string; amountPaid: string; threeWayMatchStatus: string; matchNotes?: string; lines: VILine[]; lineTaxes?: Array<{ invoiceLineId: number; taxType: string; taxObject: string; taxAmount: string; liabilityAccountId?: number | null }>; }

export function VendorInvoicesListPage() {
  const { activeCompanyId } = useCompany();
  const qcClient = useQueryClient();
  const [postingId, setPostingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data: vis = [], isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId],
    queryFn: () => fetch(`/api/purchase-workflow/vendor-invoices?company=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
  });

  const handlePost = async (id: number) => {
    setPostingId(id);
    try {
      const r = await apiFetch(`/purchase-workflow/vendor-invoices/${id}/post`, { method: "POST" });
      if (!r.ok) {
        const errJson = await r.json().catch(() => ({}));
        const msg = (errJson as Record<string, string>).error ?? (errJson as Record<string, string>).message ?? "Gagal posting invoice";
        throw new Error(msg);
      }
      toast.success("Invoice berhasil diposting");
      qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", activeCompanyId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal posting invoice");
    } finally {
      setPostingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const r = await apiFetch(`/purchase-workflow/vendor-invoices/${id}`, { method: "DELETE" });
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
            {isLoading ? <div className="text-center py-8">Loading...</div> : vis.length === 0 ? <div className="text-center py-8 text-muted-foreground">Belum ada vendor invoice</div> : (
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

  const { data: vi, isLoading } = useQuery<VI>({
    queryKey: ["/api/purchase-workflow/vendor-invoices", id],
    queryFn: () => apiFetch(`/purchase-workflow/vendor-invoices/${id}`).then(r => r.json()),
    enabled: !isNew,
  });

  const [form, setForm] = useState({ supplierName: "", vendorInvoiceRef: "", poId: sp.get("poId") ?? "", grId: sp.get("grId") ?? "", invoiceDate: new Date().toISOString().substring(0, 10), paymentTermDays: "30", notes: "" });
  const emptyLine = (): VILine => ({ name: "", quantity: "1", unit: "pcs", unitCost: "0", subtotal: "0", taxAmount: "0", coaAccountId: "", taxType: "", taxObject: "", withholdingAmount: "0", liabilityAccountId: "", notes: "" });
  const [lines, setLines] = useState<VILine[]>([emptyLine()]);

  useEffect(() => {
    if (vi) {
      setForm({ supplierName: vi.supplierName, vendorInvoiceRef: vi.vendorInvoiceRef ?? "", poId: String(vi.poId ?? ""), grId: String(vi.grId ?? ""), invoiceDate: vi.invoiceDate?.substring(0, 10) ?? new Date().toISOString().substring(0, 10), paymentTermDays: String(vi.paymentTermDays ?? 30), notes: "" });
      setLines(vi.lines?.length ? vi.lines.map(l => {
        const tax = vi.lineTaxes?.find((candidate) => candidate.invoiceLineId === l.id);
        return {
          ...l,
          quantity: String(l.quantity),
          unitCost: String(l.unitCost),
          subtotal: String(l.subtotal),
          taxAmount: String(l.taxAmount),
          coaAccountId: l.coaAccountId ? String(l.coaAccountId) : "",
          taxType: tax?.taxType ?? "",
          taxObject: tax?.taxObject ?? "",
          withholdingAmount: tax?.taxAmount ? String(tax.taxAmount) : "0",
          liabilityAccountId: tax?.liabilityAccountId ? String(tax.liabilityAccountId) : "",
        };
      }) : []);
    }
  }, [vi]);

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
      const fresh = isNew ? saved : saved;
      const reviewLines = lines.filter((line) => line.coaAccountId && line.id).map((line) => ({
        lineId: line.id,
        coaAccountId: Number(line.coaAccountId),
        mappingKey: line.name,
        saveReusableRule: true,
      }));
      const reviewTaxes = lines.filter((line) => Number(line.withholdingAmount ?? 0) > 0 && line.id && line.taxType && line.taxObject && line.liabilityAccountId).map((line) => ({
        invoiceLineId: line.id,
        taxType: line.taxType,
        taxObject: line.taxObject,
        taxAmount: Number(line.withholdingAmount),
        liabilityAccountId: Number(line.liabilityAccountId),
      }));
      // Newly-created line IDs are returned only after a fresh detail read.
      if (isNew && saved.id && lines.some((line) => line.coaAccountId || Number(line.withholdingAmount ?? 0) > 0)) {
        const detail = await apiFetch(`/purchase-workflow/vendor-invoices/${saved.id}`).then((response) => response.json() as Promise<VI>);
        const detailLines = detail.lines ?? [];
        reviewLines.splice(0, reviewLines.length, ...lines.map((line, index) => ({
          lineId: detailLines[index]?.id,
          coaAccountId: Number(line.coaAccountId),
          mappingKey: line.name,
          saveReusableRule: true,
        })).filter((line) => line.lineId && line.coaAccountId));
        reviewTaxes.splice(0, reviewTaxes.length, ...lines.map((line, index) => ({
          invoiceLineId: detailLines[index]?.id,
          taxType: line.taxType,
          taxObject: line.taxObject,
          taxAmount: Number(line.withholdingAmount),
          liabilityAccountId: Number(line.liabilityAccountId),
        })).filter((line) => line.invoiceLineId && line.taxAmount > 0 && line.taxType && line.taxObject && line.liabilityAccountId));
      }
      if (saved.id && (reviewLines.length > 0 || reviewTaxes.length > 0)) {
        await apiFetch(`/purchase-workflow/vendor-invoices/${saved.id}/finance-review`, {
          method: "PUT",
          body: JSON.stringify({ lines: reviewLines, taxes: reviewTaxes }),
        });
      }
      return fresh;
    },
    onSuccess: (data: VI) => { toast.success("Tersimpan"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices"] }); if (isNew) navigate(`/purchase/vendor-invoices/${data.id}`); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal"),
  });

  const postMut = useMutation({
    mutationFn: () => apiFetch(`/purchase-workflow/vendor-invoices/${vi?.id}/post`, { method: "POST" }).then(async r => { if (!r.ok) { const body = await r.json().catch(() => ({})); throw new Error(body.message ?? body.error ?? "Gagal posting"); } return r.json(); }),
    onSuccess: () => { toast.success("Invoice diposting & jurnal dibuat"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/vendor-invoices", id] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gagal posting"),
  });

  const isDraft = !vi || vi.status === "draft";
  if (!isNew && isLoading) return <AppShell><div className="flex items-center justify-center h-64">Loading...</div></AppShell>;

  const totalAmount = lines.reduce((s, l) => s + Number(l.subtotal), 0);
  const taxAmount = lines.reduce((s, l) => s + Number(l.taxAmount), 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-5xl">
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
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => postMut.mutate()} disabled={postMut.isPending}>
                <Send className="mr-1 h-4 w-4" />Post Invoice
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
            <CardHeader><CardTitle className="text-base">Ringkasan</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="font-mono">{idr(totalAmount)}</span></div>
              <div className="flex justify-between text-slate-500"><span>Pajak (PPN)</span><span className="font-mono">{idr(taxAmount)}</span></div>
              <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Grand Total</span><span className="font-mono">{idr(totalAmount + taxAmount)}</span></div>
              {vi && <div className="flex justify-between text-green-600"><span>Terbayar</span><span className="font-mono">{idr(Number(vi.amountPaid))}</span></div>}
              {vi && <div className="flex justify-between font-semibold text-red-600"><span>Sisa</span><span className="font-mono">{idr(Math.max(0, Number(vi.grandTotal) - Number(vi.amountPaid)))}</span></div>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Item Invoice</CardTitle>
            {isDraft && <Button size="sm" variant="outline" onClick={() => setLines(prev => [...prev, emptyLine()])}><Plus className="mr-1 h-4 w-4" />Tambah</Button>}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2 px-2">Nama</th>
                  <th className="text-left py-2 px-2 w-20">Qty</th>
                  <th className="text-left py-2 px-2 w-20">Satuan</th>
                  <th className="text-left py-2 px-2 w-32">Harga</th>
                  <th className="text-left py-2 px-2 w-28">Pajak</th>
                   <th className="text-left py-2 px-2 w-24">COA ID</th>
                   <th className="text-left py-2 px-2 w-24">PPh</th>
                  <th className="text-right py-2 px-2 w-32">Subtotal</th>
                  {isDraft && <th className="w-10" />}
                </tr></thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="border-b">
                      <td className="py-1 px-2"><Input value={line.name} onChange={e => updateLine(i, "name", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2"><Input value={line.unit} onChange={e => updateLine(i, "unit", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.unitCost} onChange={e => updateLine(i, "unitCost", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.taxAmount} onChange={e => updateLine(i, "taxAmount", e.target.value)} disabled={!isDraft} className="h-8" placeholder="PPN..." /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.coaAccountId ?? ""} onChange={e => updateLine(i, "coaAccountId", e.target.value)} disabled={!isDraft} className="h-8" placeholder="COA ID" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.withholdingAmount ?? "0"} onChange={e => updateLine(i, "withholdingAmount", e.target.value)} disabled={!isDraft} className="h-8" placeholder="PPh" /></td>
                      <td className="py-1 px-2 text-right font-mono text-xs">{idr(Number(line.subtotal))}</td>
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
