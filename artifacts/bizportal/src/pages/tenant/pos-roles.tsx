import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";
import { Pencil, RefreshCw, Shield, Plus, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

interface PosRole { id: number; name: string; display_name: string; permissions: Record<string, boolean>; is_system_role: boolean; }

const empty = { name: "", display_name: "", permissions: "{}", is_system_role: false };

export default function PosRoles() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PosRole | null>(null);
  const [form, setForm] = useState(empty);
  const [jsonError, setJsonError] = useState("");

  const { data = [], isFetching, dataUpdatedAt } = useQuery<PosRole[]>({
    queryKey: ["pos-roles"],
    queryFn: () => apiFetch("/api/tenant/pos/roles"),
    refetchInterval: 30_000,
  });

  const save = useMutation({
    mutationFn: (v: typeof empty) => {
      let permissions: Record<string, boolean> = {};
      try { permissions = JSON.parse(v.permissions); } catch { throw new Error("JSON permissions tidak valid"); }
      const body = { ...v, permissions };
      return editing
        ? apiFetch(`/api/tenant/pos/roles/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
        : apiFetch("/api/tenant/pos/roles", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pos-roles"] }); setOpen(false); toast({ title: "Tersimpan" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openNew() { setEditing(null); setForm(empty); setJsonError(""); setOpen(true); }
  function openEdit(r: PosRole) {
    if (r.is_system_role) { toast({ title: "Role sistem tidak dapat diedit" }); return; }
    setEditing(r);
    setForm({ name: r.name, display_name: r.display_name, permissions: JSON.stringify(r.permissions, null, 2), is_system_role: r.is_system_role });
    setJsonError("");
    setOpen(true);
  }

  function validateJson(v: string) {
    try { JSON.parse(v); setJsonError(""); } catch { setJsonError("JSON tidak valid"); }
    setForm(f => ({ ...f, permissions: v }));
  }

  const permCount = (r: PosRole) => Object.values(r.permissions).filter(Boolean).length;

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
        <span className="text-foreground font-medium">POS — Role & Hak Akses</span>
      </nav>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">POS — Role & Hak Akses</h1>
          <Badge variant="secondary">{data.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => qc.invalidateQueries({ queryKey: ["pos-roles"] })} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Tambah Role</Button>
        </div>
      </div>
      {dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">Terakhir diperbarui: {new Date(dataUpdatedAt).toLocaleTimeString("id-ID")}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama Role</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead>Permission Aktif</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Belum ada data</TableCell></TableRow>}
            {data.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-sm font-medium">{r.name}</TableCell>
                <TableCell>{r.display_name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{permCount(r)} aktif</Badge>
                  <span className="text-xs text-muted-foreground ml-2">dari {Object.keys(r.permissions).length} total</span>
                </TableCell>
                <TableCell>{r.is_system_role ? <Badge variant="secondary">Sistem</Badge> : <Badge>Custom</Badge>}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(r)} disabled={r.is_system_role}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Tambah"} Role POS</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {!editing && <div><Label>Nama Role (slug) *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="cth: supervisor" /></div>}
            <div><Label>Display Name *</Label><Input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} /></div>
            <div>
              <Label>Permissions (JSON)</Label>
              <textarea
                className={`w-full rounded-md border p-2 font-mono text-xs h-32 bg-background ${jsonError ? "border-destructive" : ""}`}
                value={form.permissions}
                onChange={e => validateJson(e.target.value)}
              />
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              <p className="text-xs text-muted-foreground">Format: {"{ \"permission_key\": true/false }"}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate(form)} disabled={!!jsonError || !form.display_name || save.isPending}>{save.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
