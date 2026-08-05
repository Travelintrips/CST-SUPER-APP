import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Pencil, Trash2, Package } from "lucide-react";
import { Link } from "wouter";

interface LogisticsUnit {
  id: number;
  name: string;
  symbol: string;
  description: string;
  is_active: boolean;
  sort_order: number;
}

const apiFetch = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { credentials: "include", ...init });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as any).message ?? `HTTP ${r.status}`);
  }
  return r.json();
};

const emptyForm = { name: "", symbol: "", description: "", sortOrder: "0" };

export default function LogisticsUnitsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: units = [], isLoading } = useQuery<LogisticsUnit[]>({
    queryKey: ["/api/logistics-units"],
    queryFn: () => apiFetch("/api/logistics-units"),
  });

  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<LogisticsUnit | null>(null);
  const [form, setForm] = useState(emptyForm);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialog(true);
  };

  const openEdit = (u: LogisticsUnit) => {
    setEditing(u);
    setForm({ name: u.name, symbol: u.symbol, description: u.description ?? "", sortOrder: String(u.sort_order) });
    setDialog(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name, symbol: form.symbol, description: form.description, sortOrder: Number(form.sortOrder) };
      if (editing) {
        return apiFetch(`/api/logistics-units/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      return apiFetch("/api/logistics-units", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      toast({ title: editing ? "Satuan diperbarui" : "Satuan ditambahkan" });
      qc.invalidateQueries({ queryKey: ["/api/logistics-units"] });
      setDialog(false);
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: (u: LogisticsUnit) =>
      apiFetch(`/api/logistics-units/${u.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !u.is_active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/logistics-units"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/logistics-units/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Satuan dihapus" });
      qc.invalidateQueries({ queryKey: ["/api/logistics-units"] });
    },
    onError: (e: Error) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" /> Satuan Pengiriman (Logistics Units)</h1>
            <p className="text-muted-foreground text-sm mt-1">Kelola daftar satuan pengiriman yang digunakan di modul logistik (kg, CBM, pallet, dll.)</p>
          </div>
          <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" />Tambah Satuan</Button>
        </div>

        <Card>
          <CardHeader><CardTitle>Daftar Satuan ({units.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Memuat...</div>
            ) : units.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">Belum ada satuan. Klik "Tambah Satuan".</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead className="w-24">Simbol</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead className="w-20">Urutan</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.map((u) => (
                    <TableRow key={u.id} className={!u.is_active ? "opacity-50" : ""}>
                      <TableCell className="text-muted-foreground text-xs">{u.id}</TableCell>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell><code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{u.symbol}</code></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.description || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{u.sort_order}</TableCell>
                      <TableCell>
                        <Badge
                          variant={u.is_active ? "default" : "secondary"}
                          className="cursor-pointer select-none"
                          onClick={() => toggleMut.mutate(u)}
                        >
                          {u.is_active ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(u)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Hapus satuan "${u.name}"?`)) deleteMut.mutate(u.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialog} onOpenChange={setDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Satuan" : "Tambah Satuan Baru"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-1.5">
                <Label>Nama <span className="text-destructive">*</span></Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="cth. Metric Ton" />
              </div>
              <div className="grid gap-1.5">
                <Label>Simbol <span className="text-destructive">*</span></Label>
                <Input value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))} placeholder="cth. MT" />
              </div>
              <div className="grid gap-1.5">
                <Label>Keterangan</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Deskripsi singkat (opsional)" />
              </div>
              <div className="grid gap-1.5">
                <Label>Urutan Tampil</Label>
                <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name.trim() || !form.symbol.trim()}>
                {saveMut.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
