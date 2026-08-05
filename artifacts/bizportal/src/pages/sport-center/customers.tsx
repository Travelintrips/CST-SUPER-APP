import { useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Trash2, UserCircle, RefreshCw, ArrowLeft } from "lucide-react";

type Customer = { id: number; name: string; email: string; phone: string; address: string; notes: string };
const EMPTY = { name: "", email: "", phone: "", address: "", notes: "" };

export default function SportCenterCustomers() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data, isLoading } = useQuery<{ data: Customer[]; total: number }>({
    queryKey: ["sport-center-customers", activeCompanyId, search, page],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (search) qs.set("search", search);
      qs.set("page", String(page));
      const r = await fetch(`/api/sport-center/customers?${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url = editId ? `/api/sport-center/customers/${editId}` : "/api/sport-center/customers";
      const method = editId ? "PATCH" : "POST";
      const r = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editId ? "Customer diperbarui" : "Customer ditambahkan" });
      setShowDialog(false); setEditId(null); setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ["sport-center-customers"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/sport-center/customers/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => {
      toast({ title: "Customer dihapus" }); setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["sport-center-customers"] });
    },
  });

  const openEdit = (c: Customer) => {
    setEditId(c.id);
    setForm({ name: c.name, email: c.email ?? "", phone: c.phone ?? "", address: c.address ?? "", notes: c.notes ?? "" });
    setShowDialog(true);
  };

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/sport-center/dashboard")} className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <UserCircle className="h-6 w-6 text-cyan-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Customers</h1>
              <p className="text-sm text-muted-foreground">Total: {data?.total ?? 0} pelanggan</p>
            </div>
          </div>
          <Button onClick={() => { setEditId(null); setForm(EMPTY); setShowDialog(true); }} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Tambah Customer
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Cari nama / HP…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-8" />
        </div>

        <Card className="border-border/60">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["Nama","Email","No. HP","Alamat","Aksi"].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-xs text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">Memuat…</td></tr>
                ) : (data?.data ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">Belum ada customer</td></tr>
                ) : (data?.data ?? []).map((c) => (
                  <tr key={c.id} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="py-2.5 px-3 font-medium text-foreground">{c.name}</td>
                    <td className="py-2.5 px-3 text-muted-foreground">{c.email ?? "-"}</td>
                    <td className="py-2.5 px-3 text-muted-foreground">{c.phone ?? "-"}</td>
                    <td className="py-2.5 px-3 text-muted-foreground truncate max-w-[200px]">{c.address ?? "-"}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400" onClick={() => setDeleteId(c.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editId ? "Edit Customer" : "Tambah Customer"}</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Nama *</Label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">No. HP</Label>
                  <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alamat</Label>
                <Input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Catatan</Label>
                <Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
              <Button disabled={!form.name || saveMutation.isPending} onClick={() => saveMutation.mutate({ ...form, company_id: activeCompanyId })}>
                {saveMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Customer?</AlertDialogTitle>
              <AlertDialogDescription>Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>Hapus</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
