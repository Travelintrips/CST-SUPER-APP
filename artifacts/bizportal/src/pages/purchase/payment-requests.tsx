import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Eye, ChevronLeft, CheckCircle, XCircle, ArrowUpRight, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { BankDisbursementQuickDialog } from "@/components/BankDisbursementQuickDialog";
import type { BDPrefill } from "@/components/BankDisbursementQuickDialog";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const apiFetch = (path: string, opts?: RequestInit) => fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });

const statusColor: Record<string, string> = { draft: "secondary", submitted: "default", approved: "default", rejected: "destructive", paid: "default", cancelled: "destructive" };
const statusLabel: Record<string, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected", paid: "Paid", cancelled: "Cancelled" };

interface PRItem { vendorInvoiceId?: number; description: string; amount: string; }

export function PaymentRequestsListPage() {
  const { activeCompanyId } = useCompany();
  const { data: prs = [], isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/payment-requests", activeCompanyId],
    queryFn: () => fetch(`/api/purchase-workflow/payment-requests?company=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              Payment Request
              <Badge className="bg-amber-600/20 text-amber-400 border-amber-500 text-[10px] px-1.5 py-0">HISTORIS</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">Data historis — gunakan Bank Disbursement untuk pembayaran baru.</p>
          </div>
          <Link href="/accounting/bank-disbursements?mode=vendor_invoice">
            <Button variant="outline" className="border-orange-600/50 text-orange-400 hover:bg-orange-900/20">
              <ArrowRight className="mr-2 h-4 w-4" />Bank Disbursement
            </Button>
          </Link>
        </div>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
          <ChevronLeft className="h-5 w-5 text-amber-400 mt-0.5 shrink-0 rotate-180" />
          <div>
            <p className="text-sm font-medium text-amber-300">Halaman Historis — Read Only</p>
            <p className="text-sm text-amber-200/70 mt-0.5">
              Payment Request tidak lagi digunakan untuk alur pembayaran baru. Semua pembayaran keluar kini diproses melalui <strong>Bank Disbursement</strong> dengan mode <em>Vendor Invoice</em>.
            </p>
            <Link href="/accounting/bank-disbursements?mode=vendor_invoice">
              <Button size="sm" variant="outline" className="mt-2 border-orange-500/50 text-orange-300 hover:bg-orange-900/30 gap-1">
                <ArrowRight className="h-3.5 w-3.5" /> Buka Bank Disbursement
              </Button>
            </Link>
          </div>
        </div>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5" />Daftar Payment Request (Historis)</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="text-center py-8">Loading...</div> : prs.length === 0 ? <div className="text-center py-8 text-muted-foreground">Belum ada payment request</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b">
                    <th className="text-left py-2 px-3">No. PAY</th>
                    <th className="text-left py-2 px-3">Supplier</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-right py-2 px-3">Total</th>
                    <th className="text-right py-2 px-3">Terbayar</th>
                    <th className="text-right py-2 px-3">Aksi</th>
                  </tr></thead>
                  <tbody>
                    {prs.map((pr: Record<string, unknown>) => (
                      <tr key={String(pr.id)} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-mono text-xs">{String(pr.payReqNumber)}</td>
                        <td className="py-2 px-3">{String(pr.supplierName)}</td>
                        <td className="py-2 px-3"><Badge variant={statusColor[String(pr.status)] as "default" | "secondary" | "destructive" | "outline"}>{statusLabel[String(pr.status)]}</Badge></td>
                        <td className="py-2 px-3 text-right font-mono">{idr(Number(pr.totalAmount))}</td>
                        <td className="py-2 px-3 text-right font-mono text-muted-foreground">{idr(Number(pr.paidAmount))}</td>
                        <td className="py-2 px-3 text-right"><Link href={`/purchase/payment-requests/${pr.id}`}><Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button></Link></td>
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

export function PaymentRequestEditorPage() {
  const { id } = useParams();
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const [, navigate] = useLocation();
  const qcClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const isNew = !id || id === "new";

  const { data: pr, isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/payment-requests", id],
    queryFn: () => apiFetch(`/purchase-workflow/payment-requests/${id}`).then(r => r.json()),
    enabled: !isNew,
  });

  const [form, setForm] = useState({ supplierName: sp.get("supplier") ?? "", requestedBy: "", paymentMethod: "bank_transfer", bankAccount: "", notes: "" });
  const [items, setItems] = useState<PRItem[]>([{
    vendorInvoiceId: sp.get("viId") ? Number(sp.get("viId")) : undefined,
    description: sp.get("viId") ? `Invoice VI - ${sp.get("viId")}` : "",
    amount: sp.get("amount") ?? "0",
  }]);
  const [payDate, setPayDate] = useState(new Date().toISOString().substring(0, 10));
  const [actionNotes, setActionNotes] = useState("");
  const [bdOpen, setBdOpen] = useState(false);
  const [bdPrefill, setBdPrefill] = useState<BDPrefill | null>(null);

  useEffect(() => {
    if (pr) {
      setForm({ supplierName: pr.supplierName, requestedBy: pr.requestedBy ?? "", paymentMethod: pr.paymentMethod ?? "bank_transfer", bankAccount: pr.bankAccount ?? "", notes: pr.notes ?? "" });
      setItems((pr.items || []).map((i: Record<string, unknown>) => ({ vendorInvoiceId: i.vendorInvoiceId ? Number(i.vendorInvoiceId) : undefined, description: String(i.description), amount: String(i.amount) })));
    }
  }, [pr]);

  const totalAmount = items.reduce((s, i) => s + Number(i.amount), 0);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { ...form, companyId: activeCompanyId, items };
      const r = await (isNew ? apiFetch("/purchase-workflow/payment-requests", { method: "POST", body: JSON.stringify(payload) }) : Promise.reject("Cannot update"));
      if (!r.ok) throw new Error();
      return r.json();
    },
    onSuccess: (data: Record<string, unknown>) => { toast.success("Tersimpan"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/payment-requests"] }); if (isNew) navigate(`/purchase/payment-requests/${data.id}`); },
    onError: () => toast.error("Gagal"),
  });

  const actionMut = useMutation({
    mutationFn: async (action: string) => {
      const body: Record<string, unknown> = { action, notes: actionNotes };
      if (action === "pay") { body.paymentMethod = form.paymentMethod; body.bankAccount = form.bankAccount; body.paymentDate = payDate; }
      const r = await apiFetch(`/purchase-workflow/payment-requests/${pr?.id ?? id}/action`, { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      return r.json();
    },
    onSuccess: () => { toast.success("Berhasil"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/payment-requests", id] }); },
    onError: () => toast.error("Gagal"),
  });

  const isDraft = !pr || pr.status === "draft";
  const isSubmitted = pr?.status === "submitted";
  const isApproved = pr?.status === "approved";
  if (!isNew && isLoading) return <AppShell><div className="flex items-center justify-center h-64">Loading...</div></AppShell>;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/purchase/payment-requests")}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold flex items-center gap-2">
              {isNew ? "Buat Payment Request" : `PAY: ${pr?.payReqNumber}`}
              <Badge className="bg-amber-600/20 text-amber-400 border-amber-500 text-[10px] px-1.5 py-0">HISTORIS</Badge>
            </h1>
            {pr && <Badge variant={statusColor[pr.status] as "default" | "secondary" | "destructive" | "outline"}>{statusLabel[pr.status]}</Badge>}
          </div>
          {isDraft && !isNew && <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Simpan</Button>}
        </div>

        {isNew && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
            <ArrowRight className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-300">Payment Request sudah tidak digunakan</p>
              <p className="text-sm text-amber-200/70 mt-0.5">
                Untuk membayar invoice vendor, gunakan <strong>Bank Disbursement</strong> langsung dari halaman Vendor Invoice.
              </p>
              <Link href="/accounting/bank-disbursements?mode=vendor_invoice">
                <Button size="sm" className="mt-2 bg-orange-600 hover:bg-orange-700 text-white gap-1">
                  <ArrowRight className="h-3.5 w-3.5" /> Buka Bank Disbursement
                </Button>
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Info Pembayaran</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>Supplier</Label><Input value={form.supplierName} onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))} disabled={!isDraft} /></div>
              <div><Label>Diminta oleh</Label><Input value={form.requestedBy} onChange={e => setForm(f => ({ ...f, requestedBy: e.target.value }))} disabled={!isDraft} /></div>
              <div><Label>Metode Bayar</Label>
                <Select value={form.paymentMethod} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v }))} disabled={!isDraft && !isApproved}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Transfer Bank</SelectItem>
                    <SelectItem value="cash">Tunai</SelectItem>
                    <SelectItem value="cheque">Cek</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Rekening/Info Bank</Label><Input value={form.bankAccount} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))} /></div>
              <div><Label>Catatan</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} disabled={!isDraft} rows={2} /></div>
            </CardContent>
          </Card>

          {pr && (
            <Card>
              <CardHeader><CardTitle className="text-base">Workflow Pembayaran</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div><Label>Catatan</Label><Textarea value={actionNotes} onChange={e => setActionNotes(e.target.value)} rows={2} /></div>
                {isApproved && <div><Label>Tanggal Bayar</Label><DatePicker value={payDate} onChange={v => setPayDate(v)} /></div>}
                <div className="flex flex-wrap gap-2">
                  {isDraft && <Button size="sm" onClick={() => actionMut.mutate("submit")} disabled={actionMut.isPending}><ArrowRight className="mr-1 h-4 w-4" />Submit</Button>}
                  {isSubmitted && <Button size="sm" onClick={() => actionMut.mutate("approve")} disabled={actionMut.isPending}><CheckCircle className="mr-1 h-4 w-4" />Approve</Button>}
                  {isSubmitted && <Button size="sm" variant="destructive" onClick={() => actionMut.mutate("reject")} disabled={actionMut.isPending}><XCircle className="mr-1 h-4 w-4" />Reject</Button>}
                  {isApproved && (
                    <Button
                      size="sm"
                      variant="default"
                      className="bg-orange-500 hover:bg-orange-600 text-white gap-1"
                      disabled={actionMut.isPending}
                      onClick={() => {
                        setBdPrefill({
                          transactionType: "supplier_payment",
                          amount: Number(pr?.totalAmount ?? totalAmount),
                          ref: pr?.payReqNumber ?? "",
                          memo: `Pembayaran Payment Request ${pr?.payReqNumber ?? ""}`,
                          partnerName: pr?.supplierName ?? "",
                          sourceModule: "payment_request",
                          sourceId: pr?.id,
                          sourceNumber: pr?.payReqNumber ?? "",
                        });
                        setBdOpen(true);
                      }}
                    >
                      <ArrowUpRight className="h-4 w-4" />Buat Disbursement
                    </Button>
                  )}
                  {(isDraft || isSubmitted) && <Button size="sm" variant="outline" onClick={() => actionMut.mutate("cancel")} disabled={actionMut.isPending}><XCircle className="mr-1 h-4 w-4" />Cancel</Button>}
                </div>
                <div className="text-xl font-bold border-t pt-3">Total: {idr(Number(pr?.totalAmount ?? totalAmount))}</div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Invoice yang Dibayar</CardTitle>
            {isDraft && <Button size="sm" variant="outline" onClick={() => setItems(prev => [...prev, { description: "", amount: "0" }])}><Plus className="mr-1 h-4 w-4" />Tambah</Button>}
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input placeholder="Deskripsi / No. Invoice..." value={item.description} onChange={e => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, description: e.target.value } : it))} disabled={!isDraft} className="flex-1" />
                  <Input type="number" placeholder="Jumlah" value={item.amount} onChange={e => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, amount: e.target.value } : it))} disabled={!isDraft} className="w-40" />
                  {isDraft && <Button size="icon" variant="ghost" onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))} className="h-9 w-9"><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                </div>
              ))}
              <div className="text-right font-semibold text-lg pt-2 border-t">Total: {idr(totalAmount)}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {bdPrefill && (
        <BankDisbursementQuickDialog
          open={bdOpen}
          onOpenChange={(v) => { setBdOpen(v); if (!v) setBdPrefill(null); }}
          prefill={bdPrefill}
          title={`Buat Disbursement — ${bdPrefill.sourceNumber}`}
          onSuccess={(disbId, disbNumber) => {
            toast.success(`Disbursement ${disbNumber} berhasil dibuat. Payment request sedang diperbarui...`);
            const prId = pr?.id ?? id;
            apiFetch(`/purchase-workflow/payment-requests/${prId}/action`, {
              method: "POST",
              body: JSON.stringify({ action: "pay", bdId: disbId, paymentDate: new Date().toISOString().slice(0, 10) }),
            }).then(async (r) => {
              if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                toast.error((err as any).message ?? "Gagal memperbarui status payment request");
              } else {
                toast.success("Payment request berhasil ditandai Paid");
              }
              qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/payment-requests", id] });
            }).catch(() => toast.error("Gagal memperbarui status payment request"));
          }}
        />
      )}
    </AppShell>
  );
}
