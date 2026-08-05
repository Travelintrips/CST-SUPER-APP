import { useState, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Store, Plus, Search, Eye, Trash2, RefreshCw, Phone, Mail, ChevronLeft, Upload, Loader2, ImageOff } from "lucide-react";
import { Link } from "wouter";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

type Tenant = {
  id: number; business_name: string; owner_name: string; phone: string | null; email: string | null;
  business_category: string | null; address: string | null; logo_url: string | null; status: string; created_at: string;
};
type TenantDetail = Tenant & { bookings: any[]; payments: any[] };

const emptyForm = { business_name: "", owner_name: "", phone: "", email: "", business_category: "", address: "", logo_url: "", status: "active" };

export default function TenantList() {
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/storage/uploads/file", { method: "POST", credentials: "include", body: fd });
      if (!r.ok) throw new Error((await r.json()).error ?? "Upload gagal");
      const { objectPath } = await r.json();
      setForm((p) => ({ ...p, logo_url: objectPath }));
      toast({ title: "Logo terunggah" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Upload gagal", variant: "destructive" });
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const { data, isLoading } = useQuery<{ data: Tenant[]; total: number }>({
    queryKey: ["tenant-list", activeCompanyId, statusFilter, search],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (search) qs.set("search", search);
      const r = await fetch(`/api/tenant/tenants?${qs}`, { credentials: "include" });
      return r.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: detail } = useQuery<TenantDetail>({
    queryKey: ["tenant-detail", detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const r = await fetch(`/api/tenant/tenants/${detailId}`, { credentials: "include" });
      return r.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch("/api/tenant/tenants", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Penyewa ditambahkan" });
      setShowDialog(false); setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ["tenant-list"] });
      qc.invalidateQueries({ queryKey: ["tenant-dashboard"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/tenant/tenants/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Penyewa dihapus" });
      qc.invalidateQueries({ queryKey: ["tenant-list"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const rows = data?.data ?? [];

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Store className="h-6 w-6 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Penyewa</h1>
              <p className="text-sm text-muted-foreground">Total: {data?.total ?? 0} penyewa</p>
            </div>
          </div>
          <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
            <Plus className="h-4 w-4" /> Tambah Penyewa
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input placeholder="Cari nama usaha / pemilik…" className="h-8 text-xs pl-7 w-64"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="inactive">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["Nama Usaha", "Pemilik", "Kategori", "Kontak", "Status", "Terdaftar", ""].map((h) => (
                    <th key={h} className="text-left py-3 px-3 text-xs text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">Memuat…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">Belum ada penyewa</td></tr>
                ) : rows.map((t) => (
                  <tr key={t.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 px-3 font-medium text-foreground whitespace-nowrap">{t.business_name}</td>
                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{t.owner_name}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{t.business_category ?? "—"}</td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        {t.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{t.phone}</span>}
                        {t.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{t.email}</span>}
                        {!t.phone && !t.email && "—"}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <Badge className={t.status === "active"
                        ? "bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs"
                        : "bg-muted text-muted-foreground border-border text-xs"}>
                        {t.status === "active" ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(t.created_at)}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setDetailId(t.id)}>
                        <Eye className="h-3.5 w-3.5" /> Detail
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-red-400 hover:text-red-300"
                        onClick={() => { if (confirm(`Hapus penyewa "${t.business_name}"?`)) deleteMutation.mutate(t.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Dialog: Tambah Penyewa */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Tambah Penyewa</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Nama Usaha *</Label>
                <Input value={form.business_name} onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nama Pemilik *</Label>
                <Input value={form.owner_name} onChange={(e) => setForm((p) => ({ ...p, owner_name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Telepon</Label>
                  <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Email</Label>
                  <Input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kategori Usaha</Label>
                <Input value={form.business_category} onChange={(e) => setForm((p) => ({ ...p, business_category: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alamat</Label>
                <Input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Logo Usaha</Label>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg border border-border/60 bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
                    {form.logo_url
                      ? <img src={form.logo_url} alt="" className="w-full h-full object-cover" />
                      : <ImageOff className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  <Button type="button" variant="outline" size="sm" className="gap-1.5"
                    disabled={uploadingLogo} onClick={() => fileInputRef.current?.click()}>
                    {uploadingLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {uploadingLogo ? "Mengunggah…" : "Pilih Logo"}
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
              <Button disabled={!form.business_name || !form.owner_name || createMutation.isPending}
                onClick={() => createMutation.mutate({ ...form, company_id: activeCompanyId })}>
                {createMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog: Detail Penyewa */}
        <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Store className="h-4 w-4 text-blue-400" /> {detail?.business_name ?? "Detail Penyewa"}</DialogTitle>
            </DialogHeader>
            {detail && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div><p className="text-xs text-muted-foreground">Pemilik</p><p>{detail.owner_name}</p></div>
                  <div><p className="text-xs text-muted-foreground">Kategori</p><p>{detail.business_category ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Telepon</p><p>{detail.phone ?? "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Email</p><p>{detail.email ?? "—"}</p></div>
                  <div className="col-span-2"><p className="text-xs text-muted-foreground">Alamat</p><p>{detail.address ?? "—"}</p></div>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Penyewaan ({detail.bookings?.length ?? 0})</p>
                  <div className="border border-border/40 rounded max-h-40 overflow-y-auto">
                    {(detail.bookings ?? []).length === 0 ? (
                      <p className="p-3 text-xs text-muted-foreground">Belum ada penyewaan</p>
                    ) : detail.bookings.map((b: any) => (
                      <div key={b.id} className="flex items-center justify-between p-2 border-b border-border/20 last:border-0 text-xs">
                        <span className="font-mono text-muted-foreground">{b.order_number}</span>
                        <span>{b.requested_area ?? b.booking_type}</span>
                        <Badge className={b.payment_status === "paid"
                          ? "bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs"
                          : "bg-yellow-900/30 text-yellow-300 border-yellow-700 text-xs"}>
                          {b.payment_status === "paid" ? "Lunas" : "Belum"}
                        </Badge>
                        <span className="font-medium">{idr(Number(b.total_price ?? b.price ?? 0))}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Pembayaran ({detail.payments?.length ?? 0})</p>
                  <div className="border border-border/40 rounded max-h-40 overflow-y-auto">
                    {(detail.payments ?? []).length === 0 ? (
                      <p className="p-3 text-xs text-muted-foreground">Belum ada pembayaran</p>
                    ) : detail.payments.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between p-2 border-b border-border/20 last:border-0 text-xs">
                        <span className="font-mono text-muted-foreground">{p.payment_number}</span>
                        <Badge className={p.status === "confirmed"
                          ? "bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs"
                          : "bg-yellow-900/30 text-yellow-300 border-yellow-700 text-xs"}>
                          {p.status === "confirmed" ? "Terkonfirmasi" : p.status}
                        </Badge>
                        <span className="font-medium">{idr(Number(p.amount))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
