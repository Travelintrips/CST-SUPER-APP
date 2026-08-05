import { useState, useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2, Eye, ChevronLeft, CheckCircle, XCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const apiFetch = (path: string, opts?: RequestInit) => fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });

interface ReturnLine { productId?: number; name: string; quantity: string; unit: string; unitCost: string; subtotal: string; reason: string; }

export function PurchaseReturnsListPage() {
  const { activeCompanyId } = useCompany();
  const { data: returns = [], isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/returns", activeCompanyId],
    queryFn: () => fetch(`/api/purchase-workflow/returns?company=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">Purchase Return</h1><p className="text-sm text-muted-foreground">Retur barang ke supplier</p></div>
          <Link href="/purchase/returns/new"><Button><Plus className="mr-2 h-4 w-4" />Buat Retur</Button></Link>
        </div>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" />Daftar Purchase Return</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="text-center py-8">Loading...</div> : returns.length === 0 ? <div className="text-center py-8 text-muted-foreground">Belum ada purchase return</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b">
                    <th className="text-left py-2 px-3">No. Retur</th>
                    <th className="text-left py-2 px-3">Supplier</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-right py-2 px-3">Total</th>
                    <th className="text-right py-2 px-3">Aksi</th>
                  </tr></thead>
                  <tbody>
                    {returns.map((r: Record<string, unknown>) => (
                      <tr key={String(r.id)} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-mono text-xs">{String(r.returnNumber)}</td>
                        <td className="py-2 px-3">{String(r.supplierName)}</td>
                        <td className="py-2 px-3"><Badge variant={r.status === "confirmed" || r.status === "done" ? "default" : r.status === "cancelled" ? "destructive" : "secondary"}>{String(r.status)}</Badge></td>
                        <td className="py-2 px-3 text-right font-mono">{idr(Number(r.totalAmount))}</td>
                        <td className="py-2 px-3 text-right"><Link href={`/purchase/returns/${r.id}`}><Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button></Link></td>
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

export function PurchaseReturnEditorPage() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const qcClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const isNew = !id || id === "new";

  const { data: ret, isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/returns", id],
    queryFn: () => apiFetch(`/purchase-workflow/returns/${id}`).then(r => r.json()),
    enabled: !isNew,
  });

  const [form, setForm] = useState({ supplierName: "", poId: "", grId: "", reason: "", notes: "" });
  const [lines, setLines] = useState<ReturnLine[]>([{ name: "", quantity: "0", unit: "pcs", unitCost: "0", subtotal: "0", reason: "" }]);

  useEffect(() => {
    if (ret) {
      setForm({ supplierName: ret.supplierName, poId: String(ret.poId ?? ""), grId: String(ret.grId ?? ""), reason: ret.reason ?? "", notes: ret.notes ?? "" });
      setLines((ret.lines || []).map((l: Record<string, unknown>) => ({ name: String(l.name), quantity: String(l.quantity), unit: String(l.unit), unitCost: String(l.unitCost), subtotal: String(l.subtotal), reason: String(l.reason ?? "") })));
    }
  }, [ret]);

  const updateLine = (i: number, key: keyof ReturnLine, value: string) => setLines(prev => {
    const updated = prev.map((l, idx) => idx === i ? { ...l, [key]: value } : l);
    const line = updated[i];
    if (line && (key === "quantity" || key === "unitCost")) updated[i] = { ...line, subtotal: String((Number(line.quantity) * Number(line.unitCost)).toFixed(2)) };
    return updated;
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { ...form, poId: form.poId ? Number(form.poId) : undefined, grId: form.grId ? Number(form.grId) : undefined, companyId: activeCompanyId, lines };
      const r = await apiFetch("/purchase-workflow/returns", { method: "POST", body: JSON.stringify(payload) });
      if (!r.ok) throw new Error();
      return r.json();
    },
    onSuccess: (data: Record<string, unknown>) => { toast.success("Tersimpan"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/returns"] }); if (isNew) navigate(`/purchase/returns/${data.id}`); },
    onError: () => toast.error("Gagal"),
  });

  const confirmMut = useMutation({
    mutationFn: () => apiFetch(`/purchase-workflow/returns/${ret?.id}/confirm`, { method: "POST", body: JSON.stringify({ confirmedBy: "Admin" }) }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { toast.success("Retur dikonfirmasi & stok dikurangi"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/returns", id] }); },
    onError: () => toast.error("Gagal"),
  });

  const cancelMut = useMutation({
    mutationFn: () => apiFetch(`/purchase-workflow/returns/${ret?.id}/cancel`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => { toast.success("Dibatalkan"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/returns", id] }); },
  });

  const isDraft = !ret || ret.status === "draft";
  if (!isNew && isLoading) return <AppShell><div className="flex items-center justify-center h-64">Loading...</div></AppShell>;
  const totalAmount = lines.reduce((s, l) => s + Number(l.subtotal), 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-5xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/purchase/returns")}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold">{isNew ? "Buat Purchase Return" : `Retur: ${ret?.returnNumber}`}</h1>
            {ret && <Badge variant={ret.status === "confirmed" ? "default" : ret.status === "cancelled" ? "destructive" : "secondary"}>{ret.status}</Badge>}
          </div>
          <div className="flex gap-2">
            {isDraft && isNew && <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Simpan</Button>}
            {!isNew && isDraft && <Button variant="default" onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending}><CheckCircle className="mr-1 h-4 w-4" />Konfirmasi & Kurangi Stok</Button>}
            {!isNew && isDraft && <Button variant="outline" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}><XCircle className="mr-1 h-4 w-4" />Cancel</Button>}
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Informasi Retur</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Supplier</Label><Input value={form.supplierName} onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))} disabled={!isDraft} /></div>
            <div><Label>No. PO (ID)</Label><Input value={form.poId} onChange={e => setForm(f => ({ ...f, poId: e.target.value }))} disabled={!isDraft} /></div>
            <div><Label>No. GRN (ID)</Label><Input value={form.grId} onChange={e => setForm(f => ({ ...f, grId: e.target.value }))} disabled={!isDraft} /></div>
            <div><Label>Alasan Umum</Label><Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} disabled={!isDraft} /></div>
            <div className="md:col-span-2"><Label>Catatan</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} disabled={!isDraft} rows={2} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Item Diretur</CardTitle>
            {isDraft && <Button size="sm" variant="outline" onClick={() => setLines(prev => [...prev, { name: "", quantity: "0", unit: "pcs", unitCost: "0", subtotal: "0", reason: "" }])}><Plus className="mr-1 h-4 w-4" />Tambah</Button>}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2 px-2">Nama</th>
                  <th className="text-left py-2 px-2 w-24">Qty</th>
                  <th className="text-left py-2 px-2 w-20">Satuan</th>
                  <th className="text-left py-2 px-2 w-32">Harga</th>
                  <th className="text-left py-2 px-2">Alasan</th>
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
                      <td className="py-1 px-2"><Input value={line.reason} onChange={e => updateLine(i, "reason", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2 text-right font-mono text-xs">{idr(Number(line.subtotal))}</td>
                      {isDraft && <td className="py-1 px-2"><Button size="icon" variant="ghost" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="h-8 w-8"><Trash2 className="h-4 w-4 text-destructive" /></Button></td>}
                    </tr>
                  ))}
                  <tr className="font-semibold"><td colSpan={5} className="text-right py-2 px-2">Total:</td><td className="py-2 px-2 text-right font-mono">{idr(totalAmount)}</td>{isDraft && <td />}</tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
