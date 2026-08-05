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
import { ArrowLeft, Plus, Trash2, Eye, ChevronLeft, Calculator } from "lucide-react";
import { toast } from "sonner";

const idr = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const apiFetch = (path: string, opts?: RequestInit) => fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });

interface LCLine { description: string; amount: string; }

export function LandedCostsListPage() {
  const { activeCompanyId } = useCompany();
  const { data: lcs = [], isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/landed-costs", activeCompanyId],
    queryFn: () => fetch(`/api/purchase-workflow/landed-costs?company=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">Landed Cost</h1><p className="text-sm text-muted-foreground">Biaya tambahan (freight, bea cukai, dll.) yang dialokasikan ke barang</p></div>
          <Link href="/purchase/landed-costs/new"><Button><Plus className="mr-2 h-4 w-4" />Buat Landed Cost</Button></Link>
        </div>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" />Daftar Landed Cost</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="text-center py-8">Loading...</div> : lcs.length === 0 ? <div className="text-center py-8 text-muted-foreground">Belum ada landed cost</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b">
                    <th className="text-left py-2 px-3">No. LC</th>
                    <th className="text-left py-2 px-3">GRN#</th>
                    <th className="text-left py-2 px-3">Metode Alokasi</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-right py-2 px-3">Total Biaya</th>
                    <th className="text-right py-2 px-3">Aksi</th>
                  </tr></thead>
                  <tbody>
                    {lcs.map((lc: Record<string, unknown>) => (
                      <tr key={String(lc.id)} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-mono text-xs">{String(lc.lcNumber)}</td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">{lc.grId ? `GR#${String(lc.grId)}` : "-"}</td>
                        <td className="py-2 px-3 text-xs">{String(lc.allocationMethod)}</td>
                        <td className="py-2 px-3"><Badge variant={lc.status === "posted" ? "default" : "secondary"}>{String(lc.status)}</Badge></td>
                        <td className="py-2 px-3 text-right font-mono">{idr(Number(lc.totalCost))}</td>
                        <td className="py-2 px-3 text-right"><Link href={`/purchase/landed-costs/${lc.id}`}><Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button></Link></td>
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

export function LandedCostEditorPage() {
  const { id } = useParams();
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const [, navigate] = useLocation();
  const qcClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const isNew = !id || id === "new";

  const { data: lc, isLoading } = useQuery({
    queryKey: ["/api/purchase-workflow/landed-costs", id],
    queryFn: () => apiFetch(`/purchase-workflow/landed-costs/${id}`).then(r => r.json()),
    enabled: !isNew,
  });

  const [form, setForm] = useState({ grId: sp.get("grId") ?? "", poId: "", allocationMethod: "by_amount" as string, notes: "" });
  const [lines, setLines] = useState<LCLine[]>([{ description: "Freight", amount: "0" }]);

  useEffect(() => {
    if (lc) {
      setForm({ grId: String(lc.grId ?? ""), poId: String(lc.poId ?? ""), allocationMethod: lc.allocationMethod, notes: lc.notes ?? "" });
      setLines((lc.lines || []).map((l: Record<string, unknown>) => ({ description: String(l.description), amount: String(l.amount) })));
    }
  }, [lc]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { ...form, grId: form.grId ? Number(form.grId) : undefined, poId: form.poId ? Number(form.poId) : undefined, companyId: activeCompanyId, lines };
      const r = await apiFetch("/purchase-workflow/landed-costs", { method: "POST", body: JSON.stringify(payload) });
      if (!r.ok) throw new Error();
      return r.json();
    },
    onSuccess: (data: Record<string, unknown>) => { toast.success("Tersimpan"); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/landed-costs"] }); if (isNew) navigate(`/purchase/landed-costs/${data.id}`); },
    onError: () => toast.error("Gagal"),
  });

  const allocateMut = useMutation({
    mutationFn: () => apiFetch(`/purchase-workflow/landed-costs/${lc?.id}/allocate`, { method: "POST" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: (data) => { toast.success(`Alokasi selesai: ${data.allocations?.length ?? 0} item`); qcClient.invalidateQueries({ queryKey: ["/api/purchase-workflow/landed-costs", id] }); },
    onError: () => toast.error("Gagal alokasi"),
  });

  const isDraft = !lc || lc.status === "draft";
  if (!isNew && isLoading) return <AppShell><div className="flex items-center justify-center h-64">Loading...</div></AppShell>;
  const totalCost = lines.reduce((s, l) => s + Number(l.amount), 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/purchase/landed-costs")}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <Link href="/purchase"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold">{isNew ? "Buat Landed Cost" : `LC: ${lc?.lcNumber}`}</h1>
            {lc && <Badge variant={lc.status === "posted" ? "default" : "secondary"}>{lc.status}</Badge>}
          </div>
          <div className="flex gap-2">
            {isDraft && isNew && <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Simpan</Button>}
            {!isNew && isDraft && <Button variant="default" onClick={() => allocateMut.mutate()} disabled={allocateMut.isPending}><Calculator className="mr-1 h-4 w-4" />Alokasikan ke Item GRN</Button>}
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Informasi Landed Cost</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>ID GRN (wajib)</Label><Input value={form.grId} onChange={e => setForm(f => ({ ...f, grId: e.target.value }))} disabled={!isDraft} /></div>
            <div><Label>ID PO (opsional)</Label><Input value={form.poId} onChange={e => setForm(f => ({ ...f, poId: e.target.value }))} disabled={!isDraft} /></div>
            <div><Label>Metode Alokasi</Label>
              <Select value={form.allocationMethod} onValueChange={v => setForm(f => ({ ...f, allocationMethod: v }))} disabled={!isDraft}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="equal">Merata (Equal)</SelectItem>
                  <SelectItem value="by_quantity">Berdasarkan Qty</SelectItem>
                  <SelectItem value="by_amount">Berdasarkan Nilai</SelectItem>
                  <SelectItem value="by_weight">Berdasarkan Berat</SelectItem>
                  <SelectItem value="by_volume">Berdasarkan Volume</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Catatan</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} disabled={!isDraft} rows={2} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Komponen Biaya</CardTitle>
            {isDraft && <Button size="sm" variant="outline" onClick={() => setLines(prev => [...prev, { description: "", amount: "0" }])}><Plus className="mr-1 h-4 w-4" />Tambah</Button>}
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input placeholder="Nama biaya (Freight, Bea Cukai...)" value={line.description} onChange={e => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, description: e.target.value } : l))} disabled={!isDraft} className="flex-1" />
                  <Input type="number" value={line.amount} onChange={e => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, amount: e.target.value } : l))} disabled={!isDraft} className="w-40" placeholder="Jumlah..." />
                  {isDraft && <Button size="icon" variant="ghost" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="h-9 w-9"><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                </div>
              ))}
              <div className="text-right font-semibold text-lg pt-2 border-t">Total: {idr(totalCost)}</div>
            </div>
          </CardContent>
        </Card>

        {lc?.allocations && lc.allocations.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Hasil Alokasi per Item</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b"><th className="text-left py-2 px-3">Item</th><th className="text-right py-2 px-3">Biaya Dialokasikan</th></tr></thead>
                  <tbody>
                    {lc.allocations.map((a: Record<string, unknown>, i: number) => (
                      <tr key={i} className="border-b">
                        <td className="py-2 px-3">{String(a.name)}</td>
                        <td className="py-2 px-3 text-right font-mono">{idr(Number(a.allocatedAmount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
