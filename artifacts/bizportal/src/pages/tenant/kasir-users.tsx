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
import { Plus, Pencil, UserX, RefreshCw, Users, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

interface Branch { id: string; name: string; company_name: string; }
interface KasirUser { id: string; username: string; full_name: string | null; role: string; status: string; phone: string | null; email: string | null; is_active: boolean; branch_id: string | null; branch_name: string | null; company_name: string | null; }

const roles = ["owner", "admin", "manager", "cashier", "waiter", "kitchen", "delivery"];
const empty = { username: "", full_name: "", role: "cashier", branch_id: "", is_active: true, status: "active", phone: "", email: "", whatsapp_number: "" };

export default function KasirUsers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t, locale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<KasirUser | null>(null);
  const [form, setForm] = useState(empty);
  const [filterBranch, setFilterBranch] = useState("all");

  const { data: branches = [] } = useQuery<Branch[]>({ queryKey: ["kasir-branches", "all"], queryFn: () => apiFetch("/api/tenant/kasir/branches"), refetchInterval: 60_000 });
  const { data = [], isFetching, dataUpdatedAt } = useQuery<KasirUser[]>({
    queryKey: ["kasir-users", filterBranch],
    queryFn: () => apiFetch(`/api/tenant/kasir/users${filterBranch !== "all" ? `?branch_id=${filterBranch}` : ""}`),
    refetchInterval: 30_000,
  });

  const save = useMutation({
    mutationFn: (v: typeof empty) =>
      editing ? apiFetch(`/api/tenant/kasir/users/${editing.id}`, { method: "PUT", body: JSON.stringify({ ...v, branch_id: v.branch_id || null }) })
               : apiFetch("/api/tenant/kasir/users", { method: "POST", body: JSON.stringify({ ...v, branch_id: v.branch_id || null }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kasir-users"] }); setOpen(false); toast({ title: t.kasirUsers.tersimpan }); },
    onError: (e: Error) => toast({ title: t.kasirUsers.errorMsg, description: e.message, variant: "destructive" }),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/tenant/kasir/users/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kasir-users"] }); toast({ title: t.kasirUsers.dinonaktifkan }); },
    onError: (e: Error) => toast({ title: t.kasirUsers.errorMsg, description: e.message, variant: "destructive" }),
  });

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(u: KasirUser) {
    setEditing(u);
    setForm({ username: u.username, full_name: u.full_name ?? "", role: u.role, branch_id: u.branch_id ?? "", is_active: u.is_active, status: u.status, phone: u.phone ?? "", email: u.email ?? "", whatsapp_number: "" });
    setOpen(true);
  }

  const roleColor: Record<string, string> = { owner: "bg-purple-100 text-purple-800", admin: "bg-blue-100 text-blue-800", manager: "bg-teal-100 text-teal-800", cashier: "bg-green-100 text-green-800", waiter: "bg-yellow-100 text-yellow-800", kitchen: "bg-orange-100 text-orange-800" };

  return (
    <div className="p-6 space-y-4">
      <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />{t.kasirUsers.kembali}</button>
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/dashboard" className="hover:text-foreground transition-colors">{t.kasirUsers.dashboard}</Link>
        <span>/</span>
        <Link href="/tenant" className="hover:text-foreground transition-colors">{t.kasirUsers.tenantProperty}</Link>
        <span>/</span>
        <Link href="/tenant/pos-tenant" className="hover:text-foreground transition-colors">{t.kasirUsers.posTenant}</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{t.kasirUsers.kasirPengguna}</span>
      </nav>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">{t.kasirUsers.kasirPengguna}</h1>
          <Badge variant="secondary">{data.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-44"><SelectValue placeholder={t.kasirUsers.semuaCabang} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.kasirUsers.semuaCabang}</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name} — {b.company_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={() => qc.invalidateQueries({ queryKey: ["kasir-users"] })} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />{t.kasirUsers.tambah}</Button>
        </div>
      </div>
      {dataUpdatedAt > 0 && <p className="text-xs text-muted-foreground">{t.kasirUsers.terakhirDiperbarui}: {new Date(dataUpdatedAt).toLocaleTimeString(locale)}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.kasirUsers.username}</TableHead>
              <TableHead>{t.kasirUsers.namaLengkap}</TableHead>
              <TableHead>{t.kasirUsers.role}</TableHead>
              <TableHead>{t.kasirUsers.cabang}</TableHead>
              <TableHead>{t.kasirUsers.kontak}</TableHead>
              <TableHead>{t.kasirUsers.status}</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{t.common.noData}</TableCell></TableRow>}
            {data.map(u => (
              <TableRow key={u.id}>
                <TableCell className="font-mono text-sm">{u.username}</TableCell>
                <TableCell className="font-medium">{u.full_name ?? "-"}</TableCell>
                <TableCell><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColor[u.role] ?? "bg-gray-100 text-gray-800"}`}>{u.role}</span></TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.branch_name ?? "-"}</TableCell>
                <TableCell className="text-sm">{u.email ?? u.phone ?? "-"}</TableCell>
                <TableCell><Badge variant={u.is_active ? "default" : "secondary"}>{u.is_active ? t.kasirUsers.aktif : t.kasirUsers.nonaktif}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(t.kasirUsers.nonaktifkanUser)) deactivate.mutate(u.id); }} disabled={!u.is_active}><UserX className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? t.kasirUsers.editPengguna : t.kasirUsers.tambahPengguna}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t.kasirUsers.username} *</Label><Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} /></div>
            <div><Label>{t.kasirUsers.namaLengkap}</Label><Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} /></div>
            <div>
              <Label>{t.kasirUsers.role}</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.kasirUsers.cabang}</Label>
              <Select value={form.branch_id || "none"} onValueChange={v => setForm(f => ({ ...f, branch_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder={t.kasirUsers.pilihCabang} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.kasirUsers.tidakAda}</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t.kasirUsers.email}</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>{t.kasirUsers.telepon}</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div className="flex items-center gap-2"><Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} /><Label>{t.kasirUsers.aktif}</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t.kasirUsers.batal}</Button>
            <Button onClick={() => save.mutate(form)} disabled={!form.username || save.isPending}>{save.isPending ? t.kasirUsers.menyimpan : t.kasirUsers.simpan}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
