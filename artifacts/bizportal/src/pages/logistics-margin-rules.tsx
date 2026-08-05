import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Pencil, Trash2, Percent, DollarSign, RefreshCw } from "lucide-react";
import { Link } from "wouter";

interface MarginRule {
  id: number;
  name: string;
  service_type: string | null;
  route: string | null;
  customer_type: string | null;
  margin_type: string;
  margin_value: string;
  minimum_margin: string | null;
  is_active: boolean;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY_FORM = {
  name: "",
  serviceType: "",
  route: "",
  customerType: "",
  marginType: "percentage",
  marginValue: "20",
  minimumMargin: "",
  isActive: true,
  priority: "0",
  notes: "",
};

const idr = (n: number | null | undefined) =>
  n == null ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export default function LogisticsMarginRulesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [computePrice, setComputePrice] = useState("");
  const [computeService, setComputeService] = useState("");
  const [computeResult, setComputeResult] = useState<any>(null);

  const { data: rules = [], isLoading, refetch } = useQuery<MarginRule[]>({
    queryKey: ["margin-rules"],
    queryFn: async () => {
      const res = await fetch("/api/margin-rules");
      if (!res.ok) throw new Error("Gagal memuat");
      return res.json();
    },
  });

  const saveMut = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const url = editId ? `/api/margin-rules/${editId}` : "/api/margin-rules";
      const res = await fetch(url, {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: editId ? "Aturan diperbarui" : "Aturan dibuat" });
      qc.invalidateQueries({ queryKey: ["margin-rules"] });
      setOpen(false);
      setEditId(null);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/margin-rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal hapus");
    },
    onSuccess: () => {
      toast({ title: "Aturan dihapus" });
      qc.invalidateQueries({ queryKey: ["margin-rules"] });
    },
    onError: (e) => toast({ title: "Gagal", description: (e as Error).message, variant: "destructive" }),
  });

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(r: MarginRule) {
    setEditId(r.id);
    setForm({
      name: r.name,
      serviceType: r.service_type ?? "",
      route: r.route ?? "",
      customerType: r.customer_type ?? "",
      marginType: r.margin_type,
      marginValue: r.margin_value,
      minimumMargin: r.minimum_margin ?? "",
      isActive: r.is_active,
      priority: String(r.priority),
      notes: r.notes ?? "",
    });
    setOpen(true);
  }

  function handleSave() {
    if (!form.name.trim()) return;
    saveMut.mutate({
      name: form.name,
      serviceType: form.serviceType || null,
      route: form.route || null,
      customerType: form.customerType || null,
      marginType: form.marginType,
      marginValue: Number(form.marginValue),
      minimumMargin: form.minimumMargin ? Number(form.minimumMargin) : null,
      isActive: form.isActive,
      priority: Number(form.priority),
      notes: form.notes || null,
    });
  }

  async function handleCompute() {
    if (!computePrice) return;
    const res = await fetch("/api/margin-rules/compute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorPrice: Number(computePrice), serviceType: computeService || undefined }),
    });
    const j = await res.json();
    setComputeResult(j);
  }

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/logistics"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold text-gray-900">Aturan Margin</h1>
            <p className="text-sm text-gray-500 mt-1">Konfigurasi margin otomatis berdasarkan jenis layanan dan rute</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus className="w-4 h-4 mr-1" /> Tambah Aturan
            </Button>
          </div>
        </div>

        {/* Margin Calculator */}
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-blue-800">Kalkulator Margin Otomatis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs text-blue-700">Harga Vendor (IDR)</Label>
                <Input
                  type="number"
                  placeholder="Contoh: 5000000"
                  value={computePrice}
                  onChange={(e) => setComputePrice(e.target.value)}
                  className="mt-1 w-48"
                />
              </div>
              <div>
                <Label className="text-xs text-blue-700">Jenis Layanan (opsional)</Label>
                <Input
                  placeholder="Contoh: Air Freight"
                  value={computeService}
                  onChange={(e) => setComputeService(e.target.value)}
                  className="mt-1 w-40"
                />
              </div>
              <Button onClick={handleCompute} variant="outline" className="border-blue-400 text-blue-700 hover:bg-blue-100">
                Hitung
              </Button>
              {computeResult && (
                <div className="bg-white border border-blue-200 rounded-lg px-4 py-2 text-sm">
                  <span className="text-gray-500">Vendor: </span>
                  <strong>{idr(computeResult.vendorPrice)}</strong>
                  <span className="mx-2 text-gray-400">→</span>
                  <span className="text-gray-500">Jual: </span>
                  <strong className="text-green-700">{idr(computeResult.suggestedSellingPrice)}</strong>
                  <span className="ml-2 text-gray-400">(margin: {idr(computeResult.margin)})</span>
                  {computeResult.rule && (
                    <span className="ml-2 text-xs text-blue-500">via "{computeResult.rule.name}"</span>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Rules Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-gray-500">Memuat...</div>
            ) : rules.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                Belum ada aturan margin. Klik "Tambah Aturan" untuk membuat yang baru.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Nama</th>
                      <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Layanan</th>
                      <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Margin</th>
                      <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Min. Margin</th>
                      <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Prioritas</th>
                      <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Status</th>
                      <th className="text-right px-4 py-3 text-xs text-gray-500 uppercase">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rules.map((r) => (
                      <tr key={r.id} className={`hover:bg-gray-50 ${!r.is_active ? "opacity-50" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{r.name}</div>
                          {r.route && <div className="text-xs text-gray-400">{r.route}</div>}
                          {r.notes && <div className="text-xs text-gray-400 italic">{r.notes}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{r.service_type ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1 font-semibold">
                            {r.margin_type === "percentage" ? (
                              <><Percent className="w-3 h-3 text-blue-500" />{Number(r.margin_value).toFixed(1)}%</>
                            ) : (
                              <><DollarSign className="w-3 h-3 text-green-500" />{idr(Number(r.margin_value))}</>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {r.minimum_margin ? idr(Number(r.minimum_margin)) : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{r.priority}</td>
                        <td className="px-4 py-3">
                          <Badge className={r.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}>
                            {r.is_active ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(r)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                              onClick={() => { if (confirm("Hapus aturan ini?")) deleteMut.mutate(r.id); }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
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

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setEditId(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Aturan Margin" : "Tambah Aturan Margin"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nama Aturan *</Label>
              <Input className="mt-1" placeholder="Contoh: Default Margin 20%" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Jenis Layanan</Label>
                <Input className="mt-1" placeholder="Air Freight" value={form.serviceType} onChange={(e) => setForm(f => ({ ...f, serviceType: e.target.value }))} />
              </div>
              <div>
                <Label>Rute</Label>
                <Input className="mt-1" placeholder="JKT-BPN" value={form.route} onChange={(e) => setForm(f => ({ ...f, route: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipe Margin</Label>
                <Select value={form.marginType} onValueChange={(v) => setForm(f => ({ ...f, marginType: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Persentase (%)</SelectItem>
                    <SelectItem value="fixed">Nominal (IDR)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Nilai Margin *</Label>
                <Input
                  className="mt-1"
                  type="number"
                  placeholder={form.marginType === "percentage" ? "20" : "500000"}
                  value={form.marginValue}
                  onChange={(e) => setForm(f => ({ ...f, marginValue: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Minimum Margin (IDR)</Label>
                <Input
                  className="mt-1"
                  type="number"
                  placeholder="Opsional"
                  value={form.minimumMargin}
                  onChange={(e) => setForm(f => ({ ...f, minimumMargin: e.target.value }))}
                />
              </div>
              <div>
                <Label>Prioritas</Label>
                <Input
                  className="mt-1"
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Catatan</Label>
              <Textarea className="mt-1" rows={2} placeholder="Keterangan tambahan..." value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm(f => ({ ...f, isActive: v }))} />
              <Label>Aktifkan aturan ini</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditId(null); setForm(EMPTY_FORM); }}>Batal</Button>
            <Button onClick={handleSave} disabled={saveMut.isPending || !form.name.trim()}>
              {saveMut.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
