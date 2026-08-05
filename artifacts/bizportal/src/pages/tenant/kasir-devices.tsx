import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Link } from "wouter";
import { Pencil, Trash2, RefreshCw, Database, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

interface Branch { id: string; name: string; company_name: string; }
interface Device { id: string; device_id: string; code: string; name: string; branch_id: string | null; is_active: boolean; last_sync_at: string | null; branch_name: string | null; company_name: string | null; }

export default function KasirDevices() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [form, setForm] = useState({ name: "", is_active: true });
  const [filterBranch, setFilterBranch] = useState("all");

  const { data: branches = [] } = useQuery<Branch[]>({ queryKey: ["kasir-branches", "all"], queryFn: () => apiFetch("/api/tenant/kasir/branches"), refetchInterval: 60_000 });
  const { data = [], isFetching, dataUpdatedAt } = useQuery<Device[]>({
    queryKey: ["kasir-devices", filterBranch],
    queryFn: () => apiFetch(`/api/tenant/kasir/devices${filterBranch !== "all" ? `?branch_id=${filterBranch}` : ""}`),
    refetchInterval: 30_000,
  });

  const save = useMutation({
    mutationFn: (v: typeof form) => apiFetch(`/api/tenant/kasir/devices/${editing!.id}`, { method: "PUT", body: JSON.stringify(v) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kasir-devices"] }); setOpen(false); toast({ title: "Tersimpan" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/tenant/kasir/devices/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kasir-devices"] }); toast({ title: "Dihapus" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openEdit(d: Device) { setEditing(d); setForm({ name: d.name, is_active: d.is_active }); setOpen(true); }

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
        <span className="text-foreground font-medium">Kasir — Perangkat</span>
      </nav>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Kasir — Perangkat</h1>
          <Badge variant="secondary">{data.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Semua cabang" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua cabang</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name} — {b.company_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={() => qc.invalidateQueries({ queryKey: ["kasir-devices"] })} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      {dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">Terakhir diperbarui: {new Date(dataUpdatedAt).toLocaleTimeString("id-ID")}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead>Device ID</TableHead>
              <TableHead>Cabang</TableHead>
              <TableHead>Sinkron Terakhir</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Belum ada perangkat</TableCell></TableRow>}
            {data.map(d => (
              <TableRow key={d.id}>
                <TableCell><Badge variant="outline">{d.code}</Badge></TableCell>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[120px]">{d.device_id}</TableCell>
                <TableCell className="text-sm">{d.branch_name ?? "-"}<br /><span className="text-xs text-muted-foreground">{d.company_name ?? ""}</span></TableCell>
                <TableCell className="text-sm">{d.last_sync_at ? new Date(d.last_sync_at).toLocaleString("id-ID") : "Belum pernah"}</TableCell>
                <TableCell><Badge variant={d.is_active ? "default" : "secondary"}>{d.is_active ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("Hapus perangkat?")) del.mutate(d.id); }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Perangkat</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nama</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} /><Label>Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
