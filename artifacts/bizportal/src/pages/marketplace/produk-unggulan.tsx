import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/ui/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Star,
  Package,
  Clock,
  CreditCard,
  History,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Plus,
  Edit2,
  PowerOff,
  Wrench,
  ShieldAlert,
  Building2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = "pending" | "approved" | "active" | "rejected" | "expired" | "cancelled";
type PaymentStatus = "unpaid" | "pending_verification" | "verified" | "rejected";

interface FeaturedPackage {
  id: number;
  code: string;
  name: string;
  description: string | null;
  durationDays: number;
  price: number;
  currency: string;
  placementType: string | null;
  priorityWeight: number | null;
  categoryId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FeaturedRequest {
  id: number;
  companyId: number;
  vendorId: number;
  catalogItemId: number;
  packageId: number;
  status: Status;
  requestedStartAt: string | null;
  requestedEndAt: string | null;
  approvedStartAt: string | null;
  approvedEndAt: string | null;
  price: number | null;
  currency: string | null;
  paymentStatus: PaymentStatus | null;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
  // enriched (admin list)
  catalogItemName?: string;
  catalogItemIsFeatured?: boolean;
  vendorName?: string;
  vendorPhone?: string;
  packageName?: string;
  packageCode?: string;
  packageDurationDays?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function fmtCurrency(amount: number | null | undefined, currency = "IDR") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(amount);
}

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  pending:   { label: "Pending",   cls: "bg-yellow-100 text-yellow-800" },
  approved:  { label: "Approved",  cls: "bg-blue-100 text-blue-800" },
  active:    { label: "Aktif",     cls: "bg-emerald-100 text-emerald-800" },
  rejected:  { label: "Ditolak",   cls: "bg-red-100 text-red-800" },
  expired:   { label: "Kadaluarsa",cls: "bg-slate-100 text-slate-600" },
  cancelled: { label: "Dibatalkan",cls: "bg-slate-100 text-slate-500" },
};

const PAY_META: Record<PaymentStatus, { label: string; cls: string }> = {
  unpaid:               { label: "Belum Bayar",  cls: "bg-slate-100 text-slate-600" },
  pending_verification: { label: "Menunggu Verif",cls: "bg-yellow-100 text-yellow-800" },
  verified:             { label: "Verified",     cls: "bg-emerald-100 text-emerald-800" },
  rejected:             { label: "Ditolak",      cls: "bg-red-100 text-red-800" },
};

function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <Badge className={`text-xs ${m.cls}`}>{m.label}</Badge>;
}

function PayBadge({ status }: { status: PaymentStatus | null | undefined }) {
  if (!status) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const m = PAY_META[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <Badge className={`text-xs ${m.cls}`}>{m.label}</Badge>;
}

function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateWithDays(start: string, days: number) {
  const parsed = new Date(`${start}T00:00:00`);
  if (!start || Number.isNaN(parsed.getTime()) || !Number.isFinite(days)) return "";
  parsed.setDate(parsed.getDate() + days);
  return dateInputValue(parsed);
}

// ── Section: Paket Promosi ────────────────────────────────────────────────────

function PaketPromosiSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editPkg, setEditPkg] = useState<FeaturedPackage | null>(null);
  const [form, setForm] = useState({ code: "", name: "", description: "", durationDays: "30", price: "", currency: "IDR", placementType: "", priorityWeight: "0" });

  const { data: packages = [], isLoading } = useQuery<FeaturedPackage[]>({
    queryKey: ["admin-featured-packages"],
    queryFn: async () => {
      const r = await fetch("/api/portal/admin/featured-packages?includeInactive=true", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat paket");
      return r.json();
    },
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: async (body: object) => {
      const r = await fetch("/api/portal/admin/featured-packages", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Gagal membuat paket"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-featured-packages"] }); setShowCreate(false); toast({ title: "Berhasil", description: "Paket baru berhasil dibuat." }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: object }) => {
      const r = await fetch(`/api/portal/admin/featured-packages/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Gagal update paket"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-featured-packages"] }); setEditPkg(null); toast({ title: "Berhasil", description: "Paket berhasil diperbarui." }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deactivateMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/portal/admin/featured-packages/${id}/deactivate`, { method: "POST", credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Gagal menonaktifkan"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-featured-packages"] }); toast({ title: "Berhasil", description: "Paket dinonaktifkan." }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setForm({ code: "", name: "", description: "", durationDays: "30", price: "", currency: "IDR", placementType: "", priorityWeight: "0" });
    setShowCreate(true);
  }

  function openEdit(pkg: FeaturedPackage) {
    setForm({
      code: pkg.code,
      name: pkg.name,
      description: pkg.description ?? "",
      durationDays: String(pkg.durationDays),
      price: String(pkg.price),
      currency: pkg.currency,
      placementType: pkg.placementType ?? "",
      priorityWeight: String(pkg.priorityWeight ?? 0),
    });
    setEditPkg(pkg);
  }

  function handleSubmit() {
    const body = {
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      durationDays: Number(form.durationDays),
      price: Number(form.price),
      currency: form.currency || "IDR",
      placementType: form.placementType || undefined,
      priorityWeight: Number(form.priorityWeight),
    };
    if (editPkg) {
      updateMut.mutate({ id: editPkg.id, body });
    } else {
      createMut.mutate(body);
    }
  }

  const isSubmitting = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Tambah Paket</Button>
      </div>
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Durasi</TableHead>
                  <TableHead>Harga</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Prioritas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.map((pkg) => (
                  <TableRow key={pkg.id}>
                    <TableCell className="font-mono text-xs">{pkg.code}</TableCell>
                    <TableCell className="font-medium text-sm">{pkg.name}</TableCell>
                    <TableCell className="text-sm">{pkg.durationDays} hari</TableCell>
                    <TableCell className="text-sm font-mono">{fmtCurrency(pkg.price, pkg.currency)}</TableCell>
                    <TableCell className="text-sm">{pkg.placementType ?? "—"}</TableCell>
                    <TableCell className="text-sm">{pkg.priorityWeight ?? 0}</TableCell>
                    <TableCell>
                      <Badge className={pkg.isActive ? "bg-emerald-100 text-emerald-800 text-xs" : "bg-slate-100 text-slate-500 text-xs"}>
                        {pkg.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(pkg)}><Edit2 className="h-3.5 w-3.5" /></Button>
                        {pkg.isActive && (
                          <Button variant="ghost" size="sm" onClick={() => deactivateMut.mutate(pkg.id)} title="Nonaktifkan">
                            <PowerOff className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {packages.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8 text-sm">Belum ada paket.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={showCreate || editPkg !== null} onOpenChange={(o) => { if (!o) { setShowCreate(false); setEditPkg(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editPkg ? "Edit Paket" : "Tambah Paket Baru"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Kode *</Label>
              <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. PKG-GOLD" />
            </div>
            <div className="space-y-1">
              <Label>Nama *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Gold Package" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Deskripsi</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-1">
              <Label>Durasi (hari) *</Label>
              <Input type="number" value={form.durationDays} onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Harga *</Label>
              <Input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Mata Uang</Label>
              <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} placeholder="IDR" />
            </div>
            <div className="space-y-1">
              <Label>Tipe Penempatan</Label>
              <Input value={form.placementType} onChange={(e) => setForm((f) => ({ ...f, placementType: e.target.value }))} placeholder="homepage, category, ..." />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Bobot Prioritas</Label>
              <Input type="number" value={form.priorityWeight} onChange={(e) => setForm((f) => ({ ...f, priorityWeight: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditPkg(null); }}>Batal</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>{isSubmitting ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Section: Tambah Produk Internal ────────────────────────────────────────────

interface InternalVendor {
  id: number;
  name: string;
  companyId: number | null;
}

interface InternalCatalogItem {
  id: number;
  vendorId: number;
  name: string;
  description: string | null;
  currency: string;
  priceSell: string | number | null;
  isFeatured: boolean;
}

function TambahProdukInternalSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = dateInputValue(new Date());
  const [vendorId, setVendorId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [startAt, setStartAt] = useState(today);
  const [endAt, setEndAt] = useState("");

  const { data: vendors = [], isLoading: vendorsLoading } = useQuery<InternalVendor[]>({
    queryKey: ["admin-internal-featured-vendors"],
    queryFn: async () => {
      const r = await fetch("/api/portal/admin/internal-featured/vendors", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat vendor internal");
      return r.json();
    },
    staleTime: 60_000,
  });

  const { data: packages = [], isLoading: packagesLoading } = useQuery<FeaturedPackage[]>({
    queryKey: ["admin-featured-packages"],
    queryFn: async () => {
      const r = await fetch("/api/portal/admin/featured-packages", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat paket");
      return r.json();
    },
    staleTime: 30_000,
  });

  const { data: catalog = [], isLoading: catalogLoading } = useQuery<InternalCatalogItem[]>({
    queryKey: ["admin-internal-featured-catalog", vendorId],
    queryFn: async () => {
      const r = await fetch(`/api/portal/admin/internal-featured/vendors/${vendorId}/catalog`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat katalog internal");
      return r.json();
    },
    enabled: Boolean(vendorId),
    staleTime: 15_000,
  });

  const selectedPackage = packages.find((pkg) => String(pkg.id) === packageId);

  function handleVendorChange(value: string) {
    setVendorId(value);
    setCatalogItemId("");
  }

  function handlePackageChange(value: string) {
    setPackageId(value);
    const pkg = packages.find((candidate) => String(candidate.id) === value);
    if (pkg) setEndAt(dateWithDays(startAt, pkg.durationDays));
  }

  function handleStartChange(value: string) {
    setStartAt(value);
    if (selectedPackage) setEndAt(dateWithDays(value, selectedPackage.durationDays));
  }

  const activateMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/portal/admin/internal-featured/activate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: Number(vendorId),
          catalogItemId: Number(catalogItemId),
          packageId: Number(packageId),
          startAt: `${startAt}T00:00:00`,
          endAt: `${endAt}T00:00:00`,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Gagal mengaktifkan Produk Unggulan");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-featured-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-featured-requests-approved"] });
      qc.invalidateQueries({ queryKey: ["admin-featured-requests-history"] });
      qc.invalidateQueries({ queryKey: ["admin-internal-featured-catalog", vendorId] });
      setCatalogItemId("");
      toast({
        title: "Produk internal diaktifkan",
        description: "Produk langsung menjadi Produk Unggulan dan bebas pembayaran.",
      });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const canSubmit = Boolean(vendorId && catalogItemId && packageId && startAt && endAt);
  const selectedItem = catalog.find((item) => String(item.id) === catalogItemId);

  return (
    <div className="space-y-4">
      <Card className="border-indigo-200 bg-indigo-50/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-indigo-600" />
            Tambah Produk Internal
            <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 text-[10px]">Internal / Bebas Pembayaran</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Pilih vendor internal dan produk katalog yang sudah aktif serta published. Tidak perlu login vendor atau upload bukti pembayaran.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Vendor internal *</Label>
            <Select value={vendorId} onValueChange={handleVendorChange}>
              <SelectTrigger>
                <SelectValue placeholder={vendorsLoading ? "Memuat vendor..." : "Pilih vendor internal"} />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={String(vendor.id)}>{vendor.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {vendors.length === 0 && !vendorsLoading && (
              <p className="text-xs text-muted-foreground">Belum ada vendor internal aktif.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Produk katalog *</Label>
            <Select value={catalogItemId} onValueChange={setCatalogItemId} disabled={!vendorId || catalogLoading}>
              <SelectTrigger>
                <SelectValue placeholder={!vendorId ? "Pilih vendor terlebih dahulu" : catalogLoading ? "Memuat katalog..." : "Pilih produk aktif"} />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    <span>{item.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {vendorId && catalog.length === 0 && !catalogLoading && (
              <p className="text-xs text-muted-foreground">Tidak ada produk aktif/published yang tersedia.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Paket promosi / durasi *</Label>
            <Select value={packageId} onValueChange={handlePackageChange}>
              <SelectTrigger>
                <SelectValue placeholder={packagesLoading ? "Memuat paket..." : "Pilih paket"} />
              </SelectTrigger>
              <SelectContent>
                {packages.filter((pkg) => pkg.isActive).map((pkg) => (
                  <SelectItem key={pkg.id} value={String(pkg.id)}>
                    {pkg.name} · {pkg.durationDays} hari
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Tanggal mulai *</Label>
            <Input type="date" value={startAt} onChange={(e) => handleStartChange(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Tanggal selesai *</Label>
            <Input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            {selectedPackage && (
              <p className="text-xs text-muted-foreground">
                Otomatis mengikuti durasi paket: {selectedPackage.durationDays} hari.
              </p>
            )}
          </div>

          <div className="flex items-end justify-between gap-3 rounded-md border bg-white p-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Ringkasan</p>
              <p className="truncate text-sm font-medium">{selectedItem?.name ?? "Belum memilih produk"}</p>
              <p className="text-xs text-muted-foreground">
                {selectedPackage ? `${selectedPackage.name} · prioritas ${selectedPackage.priorityWeight ?? 0}` : "Belum memilih paket"}
              </p>
            </div>
            <Button
              onClick={() => activateMut.mutate()}
              disabled={!canSubmit || activateMut.isPending}
              className="shrink-0"
            >
              {activateMut.isPending ? "Mengaktifkan..." : "Aktifkan Produk Unggulan"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Section: Daftar Pengajuan ─────────────────────────────────────────────────

function DaftarPengajuanSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayStatus, setFilterPayStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveForm, setApproveForm] = useState({ approvedStartAt: "", approvedEndAt: "", adminNotes: "", waivePayment: false });
  const [rejectReason, setRejectReason] = useState("");

  const { data: requests = [], isLoading } = useQuery<FeaturedRequest[]>({
    queryKey: ["admin-featured-requests", filterStatus, filterPayStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterPayStatus !== "all") params.set("paymentStatus", filterPayStatus);
      const r = await fetch(`/api/portal/admin/featured-requests?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat pengajuan");
      return r.json();
    },
    staleTime: 15_000,
  });

  const approveMut = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: object }) => {
      const r = await fetch(`/api/portal/admin/featured-requests/${id}/approve`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Gagal approve"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-featured-requests"] }); setApproveOpen(false); toast({ title: "Berhasil", description: "Pengajuan disetujui." }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const r = await fetch(`/api/portal/admin/featured-requests/${id}/reject`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Gagal reject"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-featured-requests"] }); setRejectOpen(false); toast({ title: "Berhasil", description: "Pengajuan ditolak." }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const cancelMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/portal/admin/featured-requests/${id}/cancel`, { method: "POST", credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Gagal cancel"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-featured-requests"] }); toast({ title: "Berhasil", description: "Pengajuan dibatalkan." }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const pendingRequests = requests.filter((r) => r.status === "pending");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 text-sm w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="rejected">Ditolak</SelectItem>
            <SelectItem value="expired">Kadaluarsa</SelectItem>
            <SelectItem value="cancelled">Dibatalkan</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterPayStatus} onValueChange={setFilterPayStatus}>
          <SelectTrigger className="h-8 text-sm w-[180px]"><SelectValue placeholder="Status Bayar" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Pembayaran</SelectItem>
            <SelectItem value="unpaid">Belum Bayar</SelectItem>
            <SelectItem value="pending_verification">Menunggu Verif</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="rejected">Ditolak</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {pendingRequests.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-3 pb-3">
            <p className="text-sm text-amber-800 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              {pendingRequests.length} pengajuan menunggu review
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Paket</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pembayaran</TableHead>
                  <TableHead>Tgl Pengajuan</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="text-sm font-medium">{req.catalogItemName ?? `#${req.catalogItemId}`}</TableCell>
                    <TableCell className="text-sm">{req.vendorName ?? `#${req.vendorId}`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{req.packageName ?? `#${req.packageId}`}</TableCell>
                    <TableCell><StatusBadge status={req.status} /></TableCell>
                    <TableCell><PayBadge status={req.paymentStatus} /></TableCell>
                    <TableCell className="text-sm">{fmtDate(req.createdAt)}</TableCell>
                    <TableCell className="text-sm">{fmtDate(req.requestedStartAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {req.status === "pending" && (
                          <>
                            <Button variant="outline" size="sm" className="text-xs h-7"
                              onClick={() => { setSelectedId(req.id); setApproveForm({ approvedStartAt: "", approvedEndAt: "", adminNotes: "", waivePayment: false }); setApproveOpen(true); }}>
                              <CheckCircle className="h-3 w-3 mr-1 text-emerald-600" />Setujui
                            </Button>
                            <Button variant="outline" size="sm" className="text-xs h-7"
                              onClick={() => { setSelectedId(req.id); setRejectReason(""); setRejectOpen(true); }}>
                              <XCircle className="h-3 w-3 mr-1 text-red-500" />Tolak
                            </Button>
                          </>
                        )}
                        {(req.status === "pending" || req.status === "approved") && (
                          <Button variant="ghost" size="sm" className="text-xs h-7"
                            onClick={() => cancelMut.mutate(req.id)}>
                            Batalkan
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {requests.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8 text-sm">Tidak ada pengajuan.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Approve Dialog */}
      <Dialog open={approveOpen} onOpenChange={(o) => !o && setApproveOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Setujui Pengajuan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Tanggal Mulai Disetujui</Label>
              <Input type="date" value={approveForm.approvedStartAt} onChange={(e) => setApproveForm((f) => ({ ...f, approvedStartAt: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Tanggal Selesai Disetujui</Label>
              <Input type="date" value={approveForm.approvedEndAt} onChange={(e) => setApproveForm((f) => ({ ...f, approvedEndAt: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Catatan Admin</Label>
              <Textarea rows={2} value={approveForm.adminNotes} onChange={(e) => setApproveForm((f) => ({ ...f, adminNotes: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={approveForm.waivePayment} onCheckedChange={(v) => setApproveForm((f) => ({ ...f, waivePayment: v }))} id="waive" />
              <Label htmlFor="waive">Bebaskan Pembayaran</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Batal</Button>
            <Button onClick={() => {
              if (!selectedId) return;
              approveMut.mutate({ id: selectedId, body: {
                approvedStartAt: approveForm.approvedStartAt || undefined,
                approvedEndAt: approveForm.approvedEndAt || undefined,
                adminNotes: approveForm.adminNotes || undefined,
                waivePayment: approveForm.waivePayment,
              }});
            }} disabled={approveMut.isPending}>
              {approveMut.isPending ? "Menyimpan..." : "Setujui"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={(o) => !o && setRejectOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tolak Pengajuan</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>Alasan Penolakan *</Label>
            <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Masukkan alasan penolakan..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Batal</Button>
            <Button variant="destructive" onClick={() => selectedId && rejectMut.mutate({ id: selectedId, reason: rejectReason })} disabled={rejectMut.isPending || !rejectReason.trim()}>
              {rejectMut.isPending ? "Menyimpan..." : "Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Section: Produk Aktif ─────────────────────────────────────────────────────

function ProdukAktifSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [verifyApprove, setVerifyApprove] = useState(true);
  const [verifyReason, setVerifyReason] = useState("");
  const [overridePayment, setOverridePayment] = useState(false);

  const { data: requests = [], isLoading } = useQuery<FeaturedRequest[]>({
    queryKey: ["admin-featured-requests-approved"],
    queryFn: async () => {
      const r = await fetch("/api/portal/admin/featured-requests?status=approved", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data");
      return r.json();
    },
    staleTime: 15_000,
  });

  const verifyMut = useMutation({
    mutationFn: async ({ id, approve, reason }: { id: number; approve: boolean; reason?: string }) => {
      const r = await fetch(`/api/portal/admin/featured-requests/${id}/verify-payment`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, reason }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Gagal verifikasi"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-featured-requests-approved"] }); setVerifyOpen(false); toast({ title: "Berhasil", description: "Pembayaran diverifikasi." }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const activateMut = useMutation({
    mutationFn: async ({ id, overridePayment: op }: { id: number; overridePayment: boolean }) => {
      const r = await fetch(`/api/portal/admin/featured-requests/${id}/activate`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overridePayment: op }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Gagal aktivasi"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-featured-requests-approved"] }); qc.invalidateQueries({ queryKey: ["admin-featured-requests"] }); setActivateOpen(false); toast({ title: "Berhasil", description: "Produk diaktifkan sebagai unggulan." }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Paket</TableHead>
                  <TableHead>Harga</TableHead>
                  <TableHead>Status Bayar</TableHead>
                  <TableHead>Disetujui Mulai</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="text-sm font-medium">{req.catalogItemName ?? `#${req.catalogItemId}`}</TableCell>
                    <TableCell className="text-sm">{req.vendorName ?? `#${req.vendorId}`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{req.packageName ?? `#${req.packageId}`}</TableCell>
                    <TableCell className="text-sm font-mono">{fmtCurrency(req.price, req.currency ?? "IDR")}</TableCell>
                    <TableCell><PayBadge status={req.paymentStatus} /></TableCell>
                    <TableCell className="text-sm">{fmtDate(req.approvedStartAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {req.paymentStatus === "pending_verification" && (
                          <Button variant="outline" size="sm" className="text-xs h-7"
                            onClick={() => { setSelectedId(req.id); setVerifyApprove(true); setVerifyReason(""); setVerifyOpen(true); }}>
                            Verif Bayar
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="text-xs h-7"
                          onClick={() => { setSelectedId(req.id); setOverridePayment(false); setActivateOpen(true); }}>
                          <RefreshCw className="h-3 w-3 mr-1" />Aktifkan
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {requests.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8 text-sm">Tidak ada produk dengan status approved.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Verify Payment Dialog */}
      <Dialog open={verifyOpen} onOpenChange={(o) => !o && setVerifyOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Verifikasi Pembayaran</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Switch checked={verifyApprove} onCheckedChange={setVerifyApprove} id="va" />
              <Label htmlFor="va">{verifyApprove ? "Setujui Pembayaran" : "Tolak Pembayaran"}</Label>
            </div>
            {!verifyApprove && (
              <div className="space-y-1">
                <Label>Alasan Penolakan</Label>
                <Textarea rows={2} value={verifyReason} onChange={(e) => setVerifyReason(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyOpen(false)}>Batal</Button>
            <Button onClick={() => selectedId && verifyMut.mutate({ id: selectedId, approve: verifyApprove, reason: verifyReason || undefined })} disabled={verifyMut.isPending}>
              {verifyMut.isPending ? "Menyimpan..." : "Konfirmasi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate Dialog */}
      <Dialog open={activateOpen} onOpenChange={(o) => !o && setActivateOpen(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Aktifkan Produk Unggulan</DialogTitle></DialogHeader>
          <div className="flex items-center gap-2">
            <Switch checked={overridePayment} onCheckedChange={setOverridePayment} id="op" />
            <Label htmlFor="op">Override Pembayaran (aktifkan tanpa verifikasi bayar)</Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivateOpen(false)}>Batal</Button>
            <Button onClick={() => selectedId && activateMut.mutate({ id: selectedId, overridePayment })} disabled={activateMut.isPending}>
              {activateMut.isPending ? "Mengaktifkan..." : "Aktifkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Section: Riwayat ──────────────────────────────────────────────────────────

function RiwayatSection() {
  const { data: requests = [], isLoading } = useQuery<FeaturedRequest[]>({
    queryKey: ["admin-featured-requests-history"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "100");
      const r = await fetch(`/api/portal/admin/featured-requests?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat riwayat");
      return r.json();
    },
    staleTime: 30_000,
  });

  const history = requests.filter((r) => ["active", "expired", "cancelled", "rejected"].includes(r.status));

  return (
    <Card>
      <CardContent className="pt-4">
        {isLoading ? (
          <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Paket</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pembayaran</TableHead>
                <TableHead>Mulai Aktif</TableHead>
                <TableHead>Selesai</TableHead>
                <TableHead>Harga</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((req) => (
                <TableRow key={req.id}>
                  <TableCell className="text-sm font-medium">{req.catalogItemName ?? `#${req.catalogItemId}`}</TableCell>
                  <TableCell className="text-sm">{req.vendorName ?? `#${req.vendorId}`}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{req.packageName ?? `#${req.packageId}`}</TableCell>
                  <TableCell><StatusBadge status={req.status} /></TableCell>
                  <TableCell><PayBadge status={req.paymentStatus} /></TableCell>
                  <TableCell className="text-sm">{fmtDate(req.approvedStartAt)}</TableCell>
                  <TableCell className="text-sm">{fmtDate(req.approvedEndAt)}</TableCell>
                  <TableCell className="text-sm font-mono">{fmtCurrency(req.price, req.currency ?? "IDR")}</TableCell>
                </TableRow>
              ))}
              {history.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8 text-sm">Belum ada riwayat.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section: Pembayaran ───────────────────────────────────────────────────────

function PembayaranSection() {
  const { data: requests = [], isLoading } = useQuery<FeaturedRequest[]>({
    queryKey: ["admin-featured-requests-payment"],
    queryFn: async () => {
      const r = await fetch("/api/portal/admin/featured-requests?paymentStatus=pending_verification", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat data pembayaran");
      return r.json();
    },
    staleTime: 15_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-sky-600" />
          Menunggu Verifikasi Pembayaran
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-center text-muted-foreground py-8 text-sm">Memuat...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Paket</TableHead>
                <TableHead>Harga</TableHead>
                <TableHead>Status Pengajuan</TableHead>
                <TableHead>Tgl Pengajuan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((req) => (
                <TableRow key={req.id}>
                  <TableCell className="text-sm font-medium">{req.catalogItemName ?? `#${req.catalogItemId}`}</TableCell>
                  <TableCell className="text-sm">{req.vendorName ?? `#${req.vendorId}`}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{req.packageName ?? `#${req.packageId}`}</TableCell>
                  <TableCell className="text-sm font-mono">{fmtCurrency(req.price, req.currency ?? "IDR")}</TableCell>
                  <TableCell><StatusBadge status={req.status} /></TableCell>
                  <TableCell className="text-sm">{fmtDate(req.createdAt)}</TableCell>
                </TableRow>
              ))}
              {requests.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-sm">Tidak ada pembayaran yang menunggu verifikasi.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section: Featured Maintenance (RC3 Fase 2/3 — legacy data repair) ─────────

interface FeaturedCorruptItem {
  catalogItemId: number;
  itemName: string | null;
  vendorId: number;
  vendorName: string | null;
  featuredUntil: string | null;
  matchingRequestId: number | null;
  matchingRequestStatus: string | null;
  reasons: string[];
}
interface FeaturedIntegrityReport {
  scannedAt: string;
  totalFeaturedItems: number;
  corruptCount: number;
  items: FeaturedCorruptItem[];
}
interface FeaturedRepairResult {
  mode: "dry-run" | "execute";
  report: FeaturedIntegrityReport;
  repaired: number;
  failed: { catalogItemId: number; error: string }[];
}

const REASON_LABEL: Record<string, string> = {
  no_expiry_date: "Tanpa tanggal kedaluwarsa",
  no_matching_request: "Tidak ada pengajuan terkait",
  request_not_active: "Pengajuan tidak berstatus aktif",
};

function FeaturedMaintenanceSection() {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: report, isLoading, refetch, isFetching } = useQuery<FeaturedIntegrityReport>({
    queryKey: ["admin-featured-integrity-scan"],
    queryFn: async () => {
      const r = await fetch("/api/portal/admin/featured-maintenance/scan", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memindai integritas data");
      return r.json();
    },
    staleTime: 0,
  });

  const repairMut = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/portal/admin/featured-maintenance/repair", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "execute" }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error ?? "Gagal memperbaiki data"); }
      return r.json() as Promise<FeaturedRepairResult>;
    },
    onSuccess: (res) => {
      setConfirmOpen(false);
      void refetch();
      toast({ title: "Repair selesai", description: `${res.repaired} item diperbaiki.` });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const corruptCount = report?.corruptCount ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4" />Featured Data Integrity
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Memindai produk dengan status "unggulan" yang tidak konsisten (tanpa tanggal kedaluwarsa
            atau tidak punya pengajuan aktif) — tidak akan pernah expired otomatis oleh worker.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              {report ? (
                <span>
                  Terakhir dipindai: {fmtDate(report.scannedAt)} — {report.totalFeaturedItems} produk berstatus unggulan,{" "}
                  <span className={corruptCount > 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-600"}>
                    {corruptCount} bermasalah
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Belum ada hasil pemindaian.</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading || isFetching}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />Scan Integrity
              </Button>
              <Button size="sm" variant="destructive" disabled={corruptCount === 0} onClick={() => setConfirmOpen(true)}>
                <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />Repair ({corruptCount})
              </Button>
            </div>
          </div>

          {isLoading ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Memindai...</p>
          ) : corruptCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <CheckCircle className="h-8 w-8 text-emerald-300" />
              <p className="text-sm">Tidak ditemukan data featured yang bermasalah.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Kedaluwarsa</TableHead>
                  <TableHead>Pengajuan Terkait</TableHead>
                  <TableHead>Alasan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(report?.items ?? []).map((item) => (
                  <TableRow key={item.catalogItemId}>
                    <TableCell className="text-sm font-medium">{item.itemName ?? `#${item.catalogItemId}`}</TableCell>
                    <TableCell className="text-sm">{item.vendorName ?? `#${item.vendorId}`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.featuredUntil ? fmtDate(item.featuredUntil) : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.matchingRequestId ? `#${item.matchingRequestId} (${item.matchingRequestStatus})` : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {item.reasons.map((r) => (
                          <Badge key={r} className="bg-red-100 text-red-700 text-[10px]">{REASON_LABEL[r] ?? r}</Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5 text-red-500" />Konfirmasi Repair</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ini akan mereset status "unggulan" pada <strong>{corruptCount} produk</strong> yang terdeteksi bermasalah
            (mengembalikan is_featured ke tidak aktif dan menghapus tanggal/prioritas terkait). Produk featured yang
            valid tidak akan tersentuh. Setiap perubahan akan dicatat di audit log. Aksi ini tidak menghapus data apapun.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Batal</Button>
            <Button variant="destructive" onClick={() => repairMut.mutate()} disabled={repairMut.isPending}>
              {repairMut.isPending ? "Memperbaiki..." : "Ya, Repair Sekarang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProdukUnggulanPage() {
  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <BackButton href="/marketplace/rfqs" />
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Star className="h-6 w-6 text-amber-500 fill-amber-400" />
            Produk Unggulan
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Kelola pengajuan, paket promosi, dan produk unggulan di marketplace
          </p>
        </div>

        <Tabs defaultValue="pengajuan">
          <TabsList className="mb-4">
            <TabsTrigger value="pengajuan" className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />Daftar Pengajuan
            </TabsTrigger>
            <TabsTrigger value="internal" className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" />Tambah Internal
            </TabsTrigger>
            <TabsTrigger value="aktif" className="flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" />Produk Aktif
            </TabsTrigger>
            <TabsTrigger value="paket" className="flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5" />Paket Promosi
            </TabsTrigger>
            <TabsTrigger value="riwayat" className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />Riwayat
            </TabsTrigger>
            <TabsTrigger value="pembayaran" className="flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" />Pembayaran
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="flex items-center gap-1.5">
              <Wrench className="h-3.5 w-3.5" />Featured Maintenance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pengajuan">
            <DaftarPengajuanSection />
          </TabsContent>
          <TabsContent value="internal">
            <TambahProdukInternalSection />
          </TabsContent>
          <TabsContent value="aktif">
            <ProdukAktifSection />
          </TabsContent>
          <TabsContent value="paket">
            <PaketPromosiSection />
          </TabsContent>
          <TabsContent value="riwayat">
            <RiwayatSection />
          </TabsContent>
          <TabsContent value="pembayaran">
            <PembayaranSection />
          </TabsContent>
          <TabsContent value="maintenance">
            <FeaturedMaintenanceSection />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
