import { useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Tags, RefreshCw, ArrowLeft } from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

type PricingRule = {
  id: number; facility_id: number; facility_name_ref: string; name: string;
  day_type: string; time_start: string; time_end: string;
  price_per_hour: number; is_active: boolean;
};
type Facility = { id: number; name: string };

const DAY_LABEL: Record<string, string> = {
  all: "Semua Hari", weekday: "Hari Kerja", weekend: "Akhir Pekan", holiday: "Hari Libur",
};

const EMPTY = { facility_id: "", name: "", day_type: "all", time_start: "", time_end: "", price_per_hour: "0", is_active: true };

export default function SportCenterPricingRules() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();

  const [facilityFilter, setFacilityFilter] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data: rules, isLoading } = useQuery<PricingRule[]>({
    queryKey: ["sport-center-pricing", activeCompanyId, facilityFilter],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (facilityFilter !== "all") qs.set("facilityId", facilityFilter);
      const r = await fetch(`/api/sport-center/pricing-rules?${qs}`, { credentials: "include" });
      const json = await r.json();
      return Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    },
  });

  const { data: facilities } = useQuery<Facility[]>({
    queryKey: ["sport-center-facilities-list", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/sport-center/facilities${qs}`, { credentials: "include" });
      const json = await r.json();
      return Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url = editId ? `/api/sport-center/pricing-rules/${editId}` : "/api/sport-center/pricing-rules";
      const method = editId ? "PATCH" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editId ? "Pricing rule diperbarui" : "Pricing rule ditambahkan" });
      setShowDialog(false); setEditId(null); setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ["sport-center-pricing"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/sport-center/pricing-rules/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => { toast({ title: "Pricing rule dihapus" }); setDeleteId(null); qc.invalidateQueries({ queryKey: ["sport-center-pricing"] }); },
  });

  const openEdit = (r: PricingRule) => {
    setEditId(r.id);
    setForm({
      facility_id: String(r.facility_id), name: r.name, day_type: r.day_type,
      time_start: r.time_start ?? "", time_end: r.time_end ?? "",
      price_per_hour: String(r.price_per_hour), is_active: r.is_active,
    });
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
            <Tags className="h-6 w-6 text-orange-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Pricing Rules</h1>
              <p className="text-sm text-muted-foreground">Atur harga berdasarkan waktu & hari</p>
            </div>
          </div>
          <Button onClick={() => { setEditId(null); setForm(EMPTY); setShowDialog(true); }} size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> Tambah Rule
          </Button>
        </div>

        <div className="flex gap-2">
          <Select value={facilityFilter} onValueChange={setFacilityFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Filter fasilitas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Fasilitas</SelectItem>
              {(facilities ?? []).map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["Fasilitas", "Nama Rule", "Hari", "Jam", "Harga/Jam", "Status", "Aksi"].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-xs text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">Memuat…</td></tr>
                ) : (rules ?? []).length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">Belum ada pricing rule</td></tr>
                ) : (rules ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="py-2.5 px-3 text-foreground">{r.facility_name_ref ?? "—"}</td>
                    <td className="py-2.5 px-3 font-medium text-foreground">{r.name}</td>
                    <td className="py-2.5 px-3">
                      <Badge className="bg-blue-900/30 text-blue-300 border-blue-700 text-xs">
                        {DAY_LABEL[r.day_type] ?? r.day_type}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs">
                      {r.time_start && r.time_end ? `${r.time_start}–${r.time_end}` : "Sepanjang hari"}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-emerald-400">{idr(Number(r.price_per_hour))}</td>
                    <td className="py-2.5 px-3">
                      <Badge className={r.is_active
                        ? "bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs"
                        : "bg-red-900/30 text-red-300 border-red-700 text-xs"
                      }>
                        {r.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400" onClick={() => setDeleteId(r.id)}>
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
            <DialogHeader><DialogTitle>{editId ? "Edit Pricing Rule" : "Tambah Pricing Rule"}</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Fasilitas *</Label>
                <Select value={form.facility_id} onValueChange={(v) => setForm((p) => ({ ...p, facility_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Pilih fasilitas" /></SelectTrigger>
                  <SelectContent>
                    {(facilities ?? []).map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nama Rule *</Label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Contoh: Peak Hour Weekend" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tipe Hari</Label>
                  <Select value={form.day_type} onValueChange={(v) => setForm((p) => ({ ...p, day_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Hari</SelectItem>
                      <SelectItem value="weekday">Hari Kerja</SelectItem>
                      <SelectItem value="weekend">Akhir Pekan</SelectItem>
                      <SelectItem value="holiday">Hari Libur</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Harga / Jam (IDR) *</Label>
                  <Input type="number" min={0} value={form.price_per_hour} onChange={(e) => setForm((p) => ({ ...p, price_per_hour: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Jam Mulai</Label>
                  <Input type="time" value={form.time_start} onChange={(e) => setForm((p) => ({ ...p, time_start: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Jam Selesai</Label>
                  <Input type="time" value={form.time_end} onChange={(e) => setForm((p) => ({ ...p, time_end: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Aktif</Label>
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm((p) => ({ ...p, is_active: v }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
              <Button
                disabled={!form.facility_id || !form.name || saveMutation.isPending}
                onClick={() => saveMutation.mutate({
                  facility_id: Number(form.facility_id), name: form.name,
                  day_type: form.day_type, time_start: form.time_start || null,
                  time_end: form.time_end || null, price_per_hour: Number(form.price_per_hour),
                  is_active: form.is_active, company_id: activeCompanyId,
                })}
              >
                {saveMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Pricing Rule?</AlertDialogTitle>
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
