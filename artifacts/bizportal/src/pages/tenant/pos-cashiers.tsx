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
import { Plus, Pencil, RefreshCw, UserCircle, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

interface PosBranch { id: number; name: string; }
interface Cashier { id: number; name: string; email: string; phone: string | null; status: string; role: string; pos_role: string; branch_id: number | null; branch_name: string | null; allow_all_branches: boolean; }

const statusOpts = ["active", "inactive", "suspended"];
const posRoles = ["owner", "admin", "manager", "cashier", "waiter", "kitchen"];
const empty = { name: "", email: "", phone: "", status: "active", role: "cashier", pos_role: "cashier", branch_id: "" as string | number, allow_all_branches: false };

export default function PosCashiers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cashier | null>(null);
  const [form, setForm] = useState(empty);
  const [filterBranch, setFilterBranch] = useState("all");

  const { data: branches = [] } = useQuery<PosBranch[]>({ queryKey: ["pos-branches"], queryFn: () => apiFetch("/api/tenant/pos/branches"), refetchInterval: 60_000 });
  const { data = [], isFetching, dataUpdatedAt } = useQuery<Cashier[]>({
    queryKey: ["pos-cashiers", filterBranch],
    queryFn: () => apiFetch(`/api/tenant/pos/cashiers${filterBranch !== "all" ? `?branch_id=${filterBranch}` : ""}`),
    refetchInterval: 30_000,
  });

  const save = useMutation({
    mutationFn: (v: typeof empty) => {
      const body = { ...v, branch_id: v.branch_id !== "" ? Number(v.branch_id) : null };
      return editing
        ? apiFetch(`/api/tenant/pos/cashiers/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
        : apiFetch("/api/tenant/pos/cashiers", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pos-cashiers"] }); setOpen(false); toast({ title: "Tersimpan" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(c: Cashier) {
    setEditing(c);
    setForm({ name: c.name, email: c.email, phone: c.phone ?? "", status: c.status, role: c.role, pos_role: c.pos_role, branch_id: c.branch_id ?? "", allow_all_branches: c.allow_all_branches });
    setOpen(true);
  }

  const statusColor: Record<string, "default" | "secondary" | "destructive"> = { active: "default", inactive: "secondary", suspended: "destructive" };

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
        <span className="text-foreground font-medium">POS — Kasir / Pengguna</span>
      </nav>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCircle className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">POS — Kasir / Pengguna</h1>
          <Badge variant="secondary">{data.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Semua cabang" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua cabang</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={() => qc.invalidateQueries({ queryKey: ["pos-cashiers"] })} disabled={isFetching}>
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
              <TableHead>Email</TableHead>
              <TableHead>Role POS</TableHead>
              <TableHead>Cabang</TableHead>
              <TableHead>Semua Cabang</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Belum ada data</TableCell></TableRow>}
            {data.map(c => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-sm">{c.email}</TableCell>
                <TableCell><Badge variant="outline">{c.pos_role}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.branch_name ?? "-"}</TableCell>
                <TableCell>{c.allow_all_branches ? <Badge variant="secondary">Ya</Badge> : "-"}</TableCell>
                <TableCell><Badge variant={statusColor[c.status] ?? "secondary"}>{c.status}</Badge></TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Tambah"} Kasir POS</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nama *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>Telepon</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div>
              <Label>Role POS</Label>
              <Select value={form.pos_role} onValueChange={v => setForm(f => ({ ...f, pos_role: v, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{posRoles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cabang</Label>
              <Select value={form.branch_id ? String(form.branch_id) : "none"} onValueChange={v => setForm(f => ({ ...f, branch_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih cabang" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak ada —</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{statusOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2"><Switch checked={form.allow_all_branches} onCheckedChange={v => setForm(f => ({ ...f, allow_all_branches: v }))} /><Label>Akses semua cabang</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate(form)} disabled={!form.name || !form.email || save.isPending}>{save.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
