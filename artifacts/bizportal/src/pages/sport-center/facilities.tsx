import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Activity, Building2, RefreshCw, ArrowLeft, AlertCircle } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

type Facility = {
  id: number; name: string; type: string; description: string;
  capacity: number; price_per_hour: number; is_active: boolean; sort_order: number;
};
const EMPTY = { name: "", type: "court", description: "", capacity: 1, price_per_hour: 0, is_active: true, sort_order: 0 };

export default function SportCenterFacilities() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const esRef = useRef<EventSource | null>(null);
  const [realtimeCount, setRealtimeCount] = useState(0);
  const [showDialog, setShowDialog] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);

  const { data: facilities, isLoading, isError, error, refetch } = useQuery<Facility[]>({
    queryKey: ["sport-center-facilities", activeCompanyId],
    queryFn: async () => {
      const cId = activeCompanyId && activeCompanyId > 0 ? activeCompanyId : undefined;
      const qs = cId ? `?companyId=${cId}` : "";
      const r = await fetch(`/api/sport-center/facilities${qs}`, { credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? body.message ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
  });

  useEffect(() => {
    const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    const es = new EventSource(`/api/sport-center/events${qs}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "connected") return;
        if (ev.entity === "facility") {
          qc.invalidateQueries({ queryKey: ["sport-center-facilities"] });
          setRealtimeCount((c) => c + 1);
        }
      } catch {}
    };
    return () => { es.close(); };
  }, [activeCompanyId, qc]);

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url = editId ? `/api/sport-center/facilities/${editId}` : "/api/sport-center/facilities";
      const method = editId ? "PATCH" : "POST";
      const r = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editId ? "Fasilitas diperbarui" : "Fasilitas ditambahkan" });
      setShowDialog(false); setEditId(null); setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ["sport-center-facilities"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/sport-center/facilities/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Gagal menghapus");
    },
    onSuccess: () => {
      toast({ title: "Fasilitas dihapus" }); setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["sport-center-facilities"] });
    },
  });

  const openEdit = (f: Facility) => {
    setEditId(f.id);
    setForm({ name: f.name, type: f.type, description: f.description ?? "", capacity: f.capacity, price_per_hour: f.price_per_hour, is_active: f.is_active, sort_order: f.sort_order });
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
            <Building2 className="h-6 w-6 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Fasilitas</h1>
              <p className="text-sm text-muted-foreground">Kelola lapangan & area sport center</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {realtimeCount > 0 && (
              <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-600 text-xs gap-1">
                <Activity className="h-3 w-3" /> Live
              </Badge>
            )}
            <Button onClick={() => { setEditId(null); setForm(EMPTY); setShowDialog(true); }} size="sm" className="gap-1">
              <Plus className="h-4 w-4" /> Tambah Fasilitas
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="animate-pulse"><CardContent className="p-5 h-32" /></Card>
            ))}
          </div>
        ) : isError ? (
          <div className="col-span-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 mx-auto mb-3 text-red-400 opacity-80" />
            <p className="text-red-400 font-medium mb-1">Gagal memuat fasilitas</p>
            <p className="text-xs text-muted-foreground mb-4">{(error as Error)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Coba Lagi
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(facilities ?? []).map((f) => (
              <Card key={f.id} className={`border-border/60 ${!f.is_active ? "opacity-60" : ""}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-foreground">{f.name}</h3>
                      <p className="text-xs text-muted-foreground capitalize">{f.type} · Kapasitas {f.capacity}</p>
                    </div>
                    <Badge className={f.is_active ? "bg-emerald-900/30 text-emerald-300 border-emerald-700" : "bg-red-900/30 text-red-300 border-red-700"}>
                      {f.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </div>
                  {f.description && <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{f.description}</p>}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-emerald-400">{idr(Number(f.price_per_hour))}<span className="text-xs text-muted-foreground">/jam</span></span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(f)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-300" onClick={() => setDeleteId(f.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(facilities ?? []).length === 0 && (
              <div className="col-span-3 py-16 text-center text-muted-foreground">
                <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>Belum ada fasilitas. Tambahkan fasilitas pertama.</p>
              </div>
            )}
          </div>
        )}

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editId ? "Edit Fasilitas" : "Tambah Fasilitas"}</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Nama Fasilitas *</Label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Contoh: Lapangan Badminton A" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tipe</Label>
                  <Input value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))} placeholder="court / gym / pool" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Kapasitas</Label>
                  <Input type="number" min={1} value={form.capacity} onChange={(e) => setForm((p) => ({ ...p, capacity: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Harga / jam (IDR)</Label>
                <Input type="number" min={0} value={form.price_per_hour} onChange={(e) => setForm((p) => ({ ...p, price_per_hour: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Deskripsi</Label>
                <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Opsional" />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Status Aktif</Label>
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm((p) => ({ ...p, is_active: v }))} />
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
              <AlertDialogTitle>Hapus Fasilitas?</AlertDialogTitle>
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
