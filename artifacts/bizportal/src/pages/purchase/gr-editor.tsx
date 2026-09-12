import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, CheckCircle, XCircle, ChevronLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

interface GRLine { id?: number; poLineId?: number; productId?: number; name: string; qtyOrdered: string; qtyReceived: string; qtyRejected: string; unit: string; unitCost: string; subtotal: string; notes: string; condition?: string; receivingNotes?: string; }
interface GR { id: number; grNumber: string; status: string; poId: number; warehouseId?: number; supplierId?: number; receiveDate: string; deliveryNote?: string; notes?: string; lines: GRLine[]; po?: Record<string, unknown>; }

const apiFetch = (path: string, opts?: RequestInit) => fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });

export default function GoodsReceiptEditorPage() {
  const { id } = useParams();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const poIdFromUrl = params.get("poId");
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const isNew = !id || id === "new";

  const { data: gr, isLoading } = useQuery<GR>({
    queryKey: ["/api/purchase-workflow/gr", id],
    queryFn: () => apiFetch(`/purchase-workflow/gr/${id}`).then(r => r.json()),
    enabled: !isNew,
  });

  // Load PO lines for auto-fill when creating from PO
  const { data: poData } = useQuery({
    queryKey: ["/api/purchase/documents", poIdFromUrl],
    queryFn: () => apiFetch(`/purchase/documents/${poIdFromUrl}`).then(r => r.json()),
    enabled: isNew && !!poIdFromUrl,
  });

  const [form, setForm] = useState({ poId: poIdFromUrl ?? "", warehouseId: "", receiveDate: new Date().toISOString().substring(0, 10), deliveryNote: "", notes: "" });
  const [lines, setLines] = useState<GRLine[]>([]);

  useEffect(() => {
    if (gr) {
      setForm({ poId: String(gr.poId), warehouseId: String(gr.warehouseId ?? ""), receiveDate: gr.receiveDate.substring(0, 10), deliveryNote: gr.deliveryNote ?? "", notes: gr.notes ?? "" });
      setLines(gr.lines?.length ? gr.lines.map(l => ({ ...l, qtyOrdered: String(l.qtyOrdered), qtyReceived: String(l.qtyReceived), qtyRejected: String(l.qtyRejected), unitCost: String(l.unitCost), subtotal: String(l.subtotal), condition: (l as any).condition ?? "", receivingNotes: (l as any).receivingNotes ?? "" })) : []);
    }
  }, [gr]);

  useEffect(() => {
    if (poData?.lines && isNew && lines.length === 0) {
      setLines((poData.lines as Record<string, unknown>[]).map((l) => ({
        poLineId: Number(l.id),
        productId: l.productId ? Number(l.productId) : undefined,
        name: String(l.name ?? ""),
        qtyOrdered: String(l.quantity ?? "0"),
        qtyReceived: String(l.quantity ?? "0"),
        qtyRejected: "0",
        unit: "pcs",
        unitCost: String(l.unitCost ?? "0"),
        subtotal: String(Number(l.quantity ?? 0) * Number(l.unitCost ?? 0)),
        notes: "",
        condition: "",
        receivingNotes: "",
      })));
    }
  }, [poData, isNew, lines.length]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { ...form, poId: Number(form.poId), companyId: activeCompanyId, lines };
      const r = isNew
        ? await apiFetch("/purchase-workflow/gr", { method: "POST", body: JSON.stringify(payload) })
        : await apiFetch(`/purchase-workflow/gr/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    onSuccess: (data: GR) => {
      toast.success("GRN tersimpan");
      qc.invalidateQueries({ queryKey: ["/api/purchase-workflow/gr"] });
      if (isNew) navigate(`/purchase/gr/${data.id}`);
    },
    onError: () => toast.error("Gagal menyimpan"),
  });

  const confirmMut = useMutation({
    mutationFn: () => apiFetch(`/purchase-workflow/gr/${gr?.id}/confirm`, { method: "POST", body: JSON.stringify({ confirmedBy: "Admin" }) }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    onSuccess: () => { toast.success("GRN dikonfirmasi & stok diperbarui"); qc.invalidateQueries({ queryKey: ["/api/purchase-workflow/gr", id] }); },
    onError: () => toast.error("Gagal konfirmasi"),
  });

  const calcSubtotal = (i: number) => {
    const line = lines[i];
    if (!line) return;
    const sub = Number(line.qtyReceived) * Number(line.unitCost);
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, subtotal: String(sub.toFixed(2)) } : l));
  };

  const updateLine = (i: number, key: keyof GRLine, value: string) => {
    setLines(prev => {
      const updated = prev.map((l, idx) => idx === i ? { ...l, [key]: value } : l);
      const line = updated[i];
      if (line && (key === "qtyReceived" || key === "unitCost")) {
        const sub = Number(line.qtyReceived) * Number(line.unitCost);
        updated[i] = { ...line, subtotal: String(sub.toFixed(2)) };
      }
      return updated;
    });
  };

  const isDraft = !gr || gr.status === "draft";
  if (!isNew && isLoading) return <AppShell><div className="flex items-center justify-center h-64">Loading...</div></AppShell>;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-5xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/purchase/gr")}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{isNew ? "Buat Goods Receipt" : `GRN: ${gr?.grNumber}`}</h1>
            {gr && <Badge variant={gr.status === "confirmed" ? "default" : gr.status === "cancelled" ? "destructive" : "secondary"}>{gr.status}</Badge>}
          </div>
          <div className="flex gap-2">
            {isDraft && <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Simpan</Button>}
            {!isNew && isDraft && <Button variant="default" onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending}><CheckCircle className="mr-1 h-4 w-4" />Konfirmasi & Terima</Button>}
          </div>
        </div>

        {gr?.status === "confirmed" && (
          <div className="flex gap-2">
            <Link href={`/purchase/qc/new?grId=${gr.id}`}>
              <Button variant="outline" size="sm"><ArrowRight className="mr-1 h-4 w-4" />Buat QC Inspection</Button>
            </Link>
            <Link href={`/purchase/vendor-invoices/new?grId=${gr.id}&poId=${gr.poId}`}>
              <Button variant="outline" size="sm"><ArrowRight className="mr-1 h-4 w-4" />Buat Vendor Invoice</Button>
            </Link>
            <Link href={`/purchase/landed-costs/new?grId=${gr.id}`}>
              <Button variant="outline" size="sm"><ArrowRight className="mr-1 h-4 w-4" />Tambah Landed Cost</Button>
            </Link>
          </div>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Informasi Penerimaan</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><Label>No. PO</Label><Input value={form.poId} onChange={e => setForm(f => ({ ...f, poId: e.target.value }))} disabled={!isDraft} placeholder="ID PO..." /></div>
            <div><Label>ID Gudang</Label><Input value={form.warehouseId} onChange={e => setForm(f => ({ ...f, warehouseId: e.target.value }))} disabled={!isDraft} placeholder="ID Gudang..." /></div>
            <div><Label>Tanggal Terima</Label><DatePicker value={form.receiveDate} onChange={v => setForm(f => ({ ...f, receiveDate: v }))} disabled={!isDraft} /></div>
            <div><Label>No. Surat Jalan</Label><Input value={form.deliveryNote} onChange={e => setForm(f => ({ ...f, deliveryNote: e.target.value }))} disabled={!isDraft} /></div>
            <div className="md:col-span-2"><Label>Catatan</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} disabled={!isDraft} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Item Diterima</CardTitle>
            {isDraft && <Button size="sm" variant="outline" onClick={() => setLines(prev => [...prev, { name: "", qtyOrdered: "0", qtyReceived: "0", qtyRejected: "0", unit: "pcs", unitCost: "0", subtotal: "0", notes: "" }])}><Plus className="mr-1 h-4 w-4" />Tambah</Button>}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Nama Item</th>
                    <th className="text-left py-2 px-2 w-24">Qty Pesan</th>
                    <th className="text-left py-2 px-2 w-24">Qty Terima</th>
                    <th className="text-left py-2 px-2 w-24">Qty Tolak</th>
                    <th className="text-left py-2 px-2 w-20">Satuan</th>
                    <th className="text-left py-2 px-2 w-32">Harga Satuan</th>
                    <th className="text-left py-2 px-2 w-28">Kondisi</th>
                    <th className="text-left py-2 px-2 w-32">Subtotal</th>
                    {isDraft && <th className="w-10" />}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="border-b">
                      <td className="py-1 px-2">
                        <Input value={line.name} onChange={e => updateLine(i, "name", e.target.value)} disabled={!isDraft} className="h-8" />
                        {(line.receivingNotes !== undefined) && (
                          <Input value={line.receivingNotes ?? ""} onChange={e => updateLine(i, "receivingNotes" as keyof GRLine, e.target.value)} disabled={!isDraft} className="h-7 mt-1 text-xs text-muted-foreground" placeholder="Catatan penerimaan..." />
                        )}
                      </td>
                      <td className="py-1 px-2"><Input type="number" value={line.qtyOrdered} onChange={e => updateLine(i, "qtyOrdered", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.qtyReceived} onChange={e => updateLine(i, "qtyReceived", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.qtyRejected} onChange={e => updateLine(i, "qtyRejected", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2"><Input value={line.unit} onChange={e => updateLine(i, "unit", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2"><Input type="number" value={line.unitCost} onChange={e => updateLine(i, "unitCost", e.target.value)} disabled={!isDraft} className="h-8" /></td>
                      <td className="py-1 px-2">
                        <select
                          className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs"
                          value={line.condition ?? ""}
                          onChange={e => updateLine(i, "condition" as keyof GRLine, e.target.value)}
                          disabled={!isDraft}
                        >
                          <option value="">—</option>
                          <option value="good">Baik</option>
                          <option value="damaged">Rusak</option>
                          <option value="partial">Sebagian</option>
                          <option value="expired">Kadaluarsa</option>
                        </select>
                      </td>
                      <td className="py-1 px-2 text-right font-mono text-xs">{Number(line.subtotal).toLocaleString("id-ID")}</td>
                      {isDraft && <td className="py-1 px-2"><Button size="icon" variant="ghost" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="h-8 w-8"><Trash2 className="h-4 w-4 text-destructive" /></Button></td>}
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={7} className="text-right py-2 px-2">Total:</td>
                    <td className="py-2 px-2 text-right font-mono text-sm">{lines.reduce((s, l) => s + Number(l.subtotal), 0).toLocaleString("id-ID")}</td>
                    {isDraft && <td />}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
