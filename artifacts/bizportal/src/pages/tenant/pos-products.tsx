import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Link } from "wouter";
import { Plus, Pencil, Trash2, RefreshCw, Package, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

interface PosProduct { id: number; name: string; description: string | null; price: number; category: string; is_active: boolean; sort_order: number; stock_unit: string; product_type: string; stock: number | null; }

const empty = { name: "", description: "", price: 0, category: "umum", is_active: true, sort_order: 0, stock_unit: "pcs", product_type: "regular" };

export default function PosProducts() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PosProduct | null>(null);
  const [form, setForm] = useState(empty);

  const { data = [], isFetching, dataUpdatedAt } = useQuery<PosProduct[]>({
    queryKey: ["pos-products"],
    queryFn: () => apiFetch("/api/tenant/pos/products"),
    refetchInterval: 30_000,
  });

  const save = useMutation({
    mutationFn: (v: typeof empty) => {
      const body = { ...v, price: Number(v.price) };
      return editing
        ? apiFetch(`/api/tenant/pos/products/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
        : apiFetch("/api/tenant/pos/products", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pos-products"] }); setOpen(false); toast({ title: "Tersimpan" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/tenant/pos/products/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pos-products"] }); toast({ title: "Dihapus" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(p: PosProduct) { setEditing(p); setForm({ name: p.name, description: p.description ?? "", price: p.price, category: p.category, is_active: p.is_active, sort_order: p.sort_order, stock_unit: p.stock_unit, product_type: p.product_type }); setOpen(true); }

  const fmt = (n: number) => n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

  return (
    <div className="p-6 space-y-4">
      <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
        <span>/</span>
        <Link href="/tenant" className="hover:text-foreground transition-colors">Tenant & Property</Link>
        <span>/</span>
        <Link href="/tenant/pos-tenant" className="hover:text-foreground transition-colors">POS Tenant</Link>
        <span>/</span>
        <span className="text-foreground font-medium">POS — Produk</span>
      </nav>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">POS — Produk</h1>
          <Badge variant="secondary">{data.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => qc.invalidateQueries({ queryKey: ["pos-products"] })} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Tambah</Button>
        </div>
      </div>
      {dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">Terakhir diperbarui: {new Date(dataUpdatedAt).toLocaleTimeString("id-ID")}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead>Harga</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Belum ada data</TableCell></TableRow>}
            {data.map(p => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  {p.description && <div className="text-xs text-muted-foreground truncate max-w-xs">{p.description}</div>}
                </TableCell>
                <TableCell><Badge variant="outline">{p.category}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.product_type}</TableCell>
                <TableCell className="font-medium">{fmt(p.price)}</TableCell>
                <TableCell className="text-sm">{p.stock_unit}</TableCell>
                <TableCell><Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("Hapus produk?")) del.mutate(p.id); }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Tambah"} Produk POS</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nama *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Kategori</Label><Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} /></div>
            <div><Label>Harga (Rp)</Label><Input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Satuan</Label><Input value={form.stock_unit} onChange={e => setForm(f => ({ ...f, stock_unit: e.target.value }))} /></div>
              <div><Label>Tipe</Label><Input value={form.product_type} onChange={e => setForm(f => ({ ...f, product_type: e.target.value }))} /></div>
            </div>
            <div><Label>Deskripsi</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} /><Label>Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate(form)} disabled={!form.name || save.isPending}>{save.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
