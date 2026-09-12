import { useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, RefreshCw, Truck, ArrowLeft, Search } from "lucide-react";

const VEHICLE_TYPES = ["CDE","CDD","Fuso","Wingbox","Trailer","Pickup","Box","Reefer","Flatbed"];
const TOLL_MODES = [
  { value: "include",     label: "Include (sudah termasuk)" },
  { value: "actual_cost", label: "Actual Cost (biaya nyata)" },
  { value: "flat",        label: "Flat Amount" },
];
const FERRY_MODES = [
  { value: "not_available", label: "Tidak Tersedia" },
  { value: "actual_cost",   label: "Actual Cost" },
  { value: "flat",          label: "Flat Amount" },
];
const OPERATION_AREAS = [
  "Jabodetabek","Jawa Barat","Jawa Tengah","Jawa Timur",
  "Sumatra","Bali","Kalimantan","Sulawesi",
];

type Pricing = {
  id: number; vendor_id: number; vendor_name: string; vehicle_type: string;
  price_per_km: string; minimum_charge: string; inner_city_radius_km: string;
  out_of_city_surcharge_percent: string; inter_province_surcharge_percent: string; inter_island_surcharge_percent: string;
  toll_mode: string; toll_flat_amount: string; ferry_mode: string; ferry_flat_amount: string;
  loading_helper_fee: string; unloading_helper_fee: string;
  insurance_percent: string; urgent_surcharge_percent: string;
  waiting_free_hours: string; waiting_fee_per_hour: string;
  multidrop_fee_per_drop: string; overnight_fee_per_night: string; daily_rental_price: string;
  operation_areas: string[]; is_active: boolean;
};

type Vendor = { id: number; name: string };

const EMPTY_FORM = {
  vendor_id: "", vehicle_type: "CDE",
  price_per_km: "", minimum_charge: "", inner_city_radius_km: "30",
  out_of_city_surcharge_percent: "0", inter_province_surcharge_percent: "0", inter_island_surcharge_percent: "0",
  toll_mode: "actual_cost", toll_flat_amount: "0",
  ferry_mode: "not_available", ferry_flat_amount: "0",
  loading_helper_fee: "0", unloading_helper_fee: "0",
  insurance_percent: "0", urgent_surcharge_percent: "0",
  waiting_free_hours: "2", waiting_fee_per_hour: "0",
  multidrop_fee_per_drop: "0", overnight_fee_per_night: "0", daily_rental_price: "0",
  operation_areas: [] as string[], is_active: true,
};

const fmt = (v: string | number) =>
  Number(v).toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export default function TruckingPricingPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filterVendor, setFilterVendor] = useState("all");
  const [filterVehicle, setFilterVehicle] = useState("all");
  const [filterArea, setFilterArea] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchQ, setSearchQ] = useState("");

  const [showDialog, setShowDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<Pricing | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Pricing | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const F = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const { data: pricingList = [], isLoading, refetch } = useQuery<Pricing[]>({
    queryKey: ["vendor-trucking-pricing", filterVendor, filterVehicle, filterArea, filterStatus],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (filterVendor !== "all") qs.set("vendor_id", filterVendor);
      if (filterVehicle !== "all") qs.set("vehicle_type", filterVehicle);
      if (filterArea !== "all") qs.set("area", filterArea);
      if (filterStatus !== "all") qs.set("is_active", filterStatus === "active" ? "true" : "false");
      const r = await fetch(`/api/vendor-trucking-pricing/all?${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["suppliers-list-trucking"],
    queryFn: async () => {
      const r = await fetch("/api/trading/suppliers", { credentials: "include" });
      const d = await r.json();
      return (d.data ?? d).map((s: Vendor) => ({ id: s.id, name: s.name }));
    },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.vendor_id) e.vendor_id = "Vendor wajib dipilih";
    if (!form.vehicle_type) e.vehicle_type = "Jenis armada wajib";
    if (!form.price_per_km || Number(form.price_per_km) <= 0) e.price_per_km = "Harus > 0";
    if (!form.minimum_charge || Number(form.minimum_charge) <= 0) e.minimum_charge = "Harus > 0";
    const pctFields = ["out_of_city_surcharge_percent","inter_province_surcharge_percent","inter_island_surcharge_percent","insurance_percent","urgent_surcharge_percent"] as const;
    for (const f of pctFields) if (Number(form[f]) < 0) e[f] = "Minimal 0";
    const feeFields = ["loading_helper_fee","unloading_helper_fee","waiting_fee_per_hour","multidrop_fee_per_drop","overnight_fee_per_night","daily_rental_price","toll_flat_amount","ferry_flat_amount"] as const;
    for (const f of feeFields) if (Number(form[f]) < 0) e[f] = "Tidak boleh negatif";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url = editTarget ? `/api/vendor-trucking-pricing/${editTarget.id}` : "/api/vendor-trucking-pricing";
      const method = editTarget ? "PUT" : "POST";
      const r = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal");
      return d;
    },
    onSuccess: () => {
      toast({ title: editTarget ? "Pricing diperbarui" : "Pricing ditambahkan" });
      setShowDialog(false); setEditTarget(null); setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["vendor-trucking-pricing"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/vendor-trucking-pricing/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => { toast({ title: "Pricing dihapus" }); setDeleteTarget(null); qc.invalidateQueries({ queryKey: ["vendor-trucking-pricing"] }); },
  });

  const openAdd = () => { setEditTarget(null); setForm({ ...EMPTY_FORM }); setErrors({}); setShowDialog(true); };
  const openEdit = (p: Pricing) => {
    setEditTarget(p);
    setForm({
      vendor_id: String(p.vendor_id), vehicle_type: p.vehicle_type,
      price_per_km: p.price_per_km, minimum_charge: p.minimum_charge, inner_city_radius_km: p.inner_city_radius_km,
      out_of_city_surcharge_percent: p.out_of_city_surcharge_percent,
      inter_province_surcharge_percent: p.inter_province_surcharge_percent,
      inter_island_surcharge_percent: p.inter_island_surcharge_percent,
      toll_mode: p.toll_mode, toll_flat_amount: p.toll_flat_amount,
      ferry_mode: p.ferry_mode, ferry_flat_amount: p.ferry_flat_amount,
      loading_helper_fee: p.loading_helper_fee, unloading_helper_fee: p.unloading_helper_fee,
      insurance_percent: p.insurance_percent, urgent_surcharge_percent: p.urgent_surcharge_percent,
      waiting_free_hours: p.waiting_free_hours, waiting_fee_per_hour: p.waiting_fee_per_hour,
      multidrop_fee_per_drop: p.multidrop_fee_per_drop, overnight_fee_per_night: p.overnight_fee_per_night,
      daily_rental_price: p.daily_rental_price,
      operation_areas: Array.isArray(p.operation_areas) ? [...p.operation_areas] : [],
      is_active: p.is_active,
    });
    setErrors({}); setShowDialog(true);
  };

  const handleSave = () => {
    if (!validate()) return;
    saveMutation.mutate({ ...form, vendor_id: Number(form.vendor_id) });
  };

  const toggleArea = (area: string) => {
    setForm((p) => ({
      ...p,
      operation_areas: p.operation_areas.includes(area)
        ? p.operation_areas.filter((a) => a !== area)
        : [...p.operation_areas, area],
    }));
  };

  const filtered = pricingList.filter((p) =>
    !searchQ || p.vendor_name.toLowerCase().includes(searchQ.toLowerCase()) || p.vehicle_type.toLowerCase().includes(searchQ.toLowerCase())
  );

  const NF = ({ label, field, suffix = "", type = "number" }: { label: string; field: keyof typeof EMPTY_FORM; suffix?: string; type?: string }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}{suffix && <span className="ml-1 text-slate-500">{suffix}</span>}</Label>
      <Input
        type={type}
        min={0}
        value={form[field] as string}
        onChange={F(field)}
        className={`h-8 text-sm bg-slate-900/60 border-slate-700 ${errors[field] ? "border-red-500" : ""}`}
      />
      {errors[field] && <p className="text-xs text-red-400">{errors[field]}</p>}
    </div>
  );

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/purchase/vendors")} className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Truck className="h-6 w-6 text-orange-400" />
            <div>
              <h1 className="text-xl font-bold text-foreground">Trucking Pricing</h1>
              <p className="text-xs text-muted-foreground">{filtered.length} pricing rule</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
            <Button size="sm" onClick={openAdd} className="gap-1"><Plus className="h-4 w-4" /> Tambah Pricing</Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Cari vendor / armada…" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} className="pl-8 h-8 w-52 text-sm bg-slate-900/60 border-slate-700" />
          </div>
          <Select value={filterVendor} onValueChange={(v) => setFilterVendor(v)}>
            <SelectTrigger className="h-8 w-44 text-sm bg-slate-900/60 border-slate-700"><SelectValue placeholder="Semua Vendor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Vendor</SelectItem>
              {vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterVehicle} onValueChange={(v) => setFilterVehicle(v)}>
            <SelectTrigger className="h-8 w-36 text-sm bg-slate-900/60 border-slate-700"><SelectValue placeholder="Semua Armada" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Armada</SelectItem>
              {VEHICLE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterArea} onValueChange={(v) => setFilterArea(v)}>
            <SelectTrigger className="h-8 w-40 text-sm bg-slate-900/60 border-slate-700"><SelectValue placeholder="Semua Area" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Area</SelectItem>
              {OPERATION_AREAS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v)}>
            <SelectTrigger className="h-8 w-36 text-sm bg-slate-900/60 border-slate-700"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="inactive">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card className="border-border/60">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["Vendor","Armada","Tarif/KM","Min. Charge","Radius Kota","Surcharge OOC","Surcharge Prov","Surcharge Pulau","Tol","Ferry","Area Operasi","Status","Aksi"].map((h) => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={13} className="py-10 text-center text-muted-foreground">Memuat…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={13} className="py-10 text-center text-muted-foreground">Belum ada pricing rule</td></tr>
                ) : filtered.map((p) => (
                  <tr key={p.id} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="py-2 px-3 font-medium text-foreground whitespace-nowrap">{p.vendor_name}</td>
                    <td className="py-2 px-3">
                      <Badge className="bg-orange-900/30 text-orange-300 border-orange-700 text-xs">{p.vehicle_type}</Badge>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{fmt(p.price_per_km)}<span className="text-xs">/km</span></td>
                    <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{fmt(p.minimum_charge)}</td>
                    <td className="py-2 px-3 text-muted-foreground text-center">{p.inner_city_radius_km} km</td>
                    <td className="py-2 px-3 text-muted-foreground text-center">{p.out_of_city_surcharge_percent}%</td>
                    <td className="py-2 px-3 text-muted-foreground text-center">{p.inter_province_surcharge_percent}%</td>
                    <td className="py-2 px-3 text-muted-foreground text-center">{p.inter_island_surcharge_percent}%</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">
                      {p.toll_mode === "flat" ? `Flat ${fmt(p.toll_flat_amount)}` : p.toll_mode === "include" ? "Include" : "Actual"}
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">
                      {p.ferry_mode === "not_available" ? "—" : p.ferry_mode === "flat" ? `Flat ${fmt(p.ferry_flat_amount)}` : "Actual"}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex flex-wrap gap-1 max-w-[160px]">
                        {(Array.isArray(p.operation_areas) ? p.operation_areas : []).length === 0
                          ? <span className="text-xs text-muted-foreground">—</span>
                          : (Array.isArray(p.operation_areas) ? p.operation_areas : []).map((a) => (
                              <Badge key={a} className="text-[10px] bg-blue-900/30 text-blue-300 border-blue-700 px-1">{a}</Badge>
                            ))}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <Badge className={p.is_active ? "bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs" : "bg-gray-800/40 text-gray-400 border-gray-600 text-xs"}>
                        {p.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400" onClick={() => setDeleteTarget(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Form Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editTarget ? "Edit Pricing" : "Tambah Trucking Pricing"}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">

              {/* Header Info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Vendor *</Label>
                  <Select value={form.vendor_id} onValueChange={(v) => setForm((p) => ({ ...p, vendor_id: v }))}>
                    <SelectTrigger className={`h-8 text-sm bg-slate-900/60 border-slate-700 ${errors.vendor_id ? "border-red-500" : ""}`}><SelectValue placeholder="Pilih vendor…" /></SelectTrigger>
                    <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
                  </Select>
                  {errors.vendor_id && <p className="text-xs text-red-400">{errors.vendor_id}</p>}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Jenis Armada *</Label>
                  <Select value={form.vehicle_type} onValueChange={(v) => setForm((p) => ({ ...p, vehicle_type: v }))}>
                    <SelectTrigger className="h-8 text-sm bg-slate-900/60 border-slate-700"><SelectValue /></SelectTrigger>
                    <SelectContent>{VEHICLE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Tarif Dasar */}
              <div>
                <p className="text-xs font-semibold text-orange-400 mb-2">TARIF DASAR</p>
                <div className="grid grid-cols-3 gap-3">
                  <NF label="Tarif per KM *" field="price_per_km" suffix="Rp/km" />
                  <NF label="Minimum Charge *" field="minimum_charge" suffix="Rp" />
                  <NF label="Radius Dalam Kota" field="inner_city_radius_km" suffix="km" />
                </div>
              </div>

              {/* Surcharge */}
              <div>
                <p className="text-xs font-semibold text-yellow-400 mb-2">SURCHARGE</p>
                <div className="grid grid-cols-3 gap-3">
                  <NF label="Luar Kota %" field="out_of_city_surcharge_percent" suffix="%" />
                  <NF label="Antar Provinsi %" field="inter_province_surcharge_percent" suffix="%" />
                  <NF label="Antar Pulau %" field="inter_island_surcharge_percent" suffix="%" />
                </div>
              </div>

              {/* Tol */}
              <div>
                <p className="text-xs font-semibold text-blue-400 mb-2">TOL & FERRY</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Tol Mode</Label>
                    <Select value={form.toll_mode} onValueChange={(v) => setForm((p) => ({ ...p, toll_mode: v }))}>
                      <SelectTrigger className="h-8 text-sm bg-slate-900/60 border-slate-700"><SelectValue /></SelectTrigger>
                      <SelectContent>{TOLL_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {form.toll_mode === "flat" && <NF label="Tol Flat Amount" field="toll_flat_amount" suffix="Rp" />}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Ferry Mode</Label>
                    <Select value={form.ferry_mode} onValueChange={(v) => setForm((p) => ({ ...p, ferry_mode: v }))}>
                      <SelectTrigger className="h-8 text-sm bg-slate-900/60 border-slate-700"><SelectValue /></SelectTrigger>
                      <SelectContent>{FERRY_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {form.ferry_mode === "flat" && <NF label="Ferry Flat Amount" field="ferry_flat_amount" suffix="Rp" />}
                </div>
              </div>

              {/* Extras */}
              <div>
                <p className="text-xs font-semibold text-purple-400 mb-2">BIAYA TAMBAHAN</p>
                <div className="grid grid-cols-3 gap-3">
                  <NF label="Helper Muat" field="loading_helper_fee" suffix="Rp" />
                  <NF label="Helper Bongkar" field="unloading_helper_fee" suffix="Rp" />
                  <NF label="Asuransi %" field="insurance_percent" suffix="%" />
                  <NF label="Urgent Surcharge %" field="urgent_surcharge_percent" suffix="%" />
                  <NF label="Free Waiting Hours" field="waiting_free_hours" suffix="jam" />
                  <NF label="Waiting Fee/Jam" field="waiting_fee_per_hour" suffix="Rp" />
                  <NF label="Multi-drop Fee/Drop" field="multidrop_fee_per_drop" suffix="Rp" />
                  <NF label="Overnight Fee/Malam" field="overnight_fee_per_night" suffix="Rp" />
                  <NF label="Harga Sewa Seharian" field="daily_rental_price" suffix="Rp" />
                </div>
              </div>

              {/* Area Operasi */}
              <div>
                <p className="text-xs font-semibold text-emerald-400 mb-2">AREA OPERASI</p>
                <div className="grid grid-cols-4 gap-2">
                  {OPERATION_AREAS.map((area) => (
                    <label key={area} className="flex items-center gap-2 cursor-pointer select-none">
                      <Checkbox
                        checked={form.operation_areas.includes(area)}
                        onCheckedChange={() => toggleArea(area)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-xs text-muted-foreground">{area}</span>
                    </label>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Status */}
              <div className="flex items-center gap-3">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm((p) => ({ ...p, is_active: v }))} />
                <Label className="text-sm">{form.is_active ? "Aktif" : "Nonaktif"}</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
              <Button disabled={saveMutation.isPending} onClick={handleSave}>
                {saveMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Pricing?</AlertDialogTitle>
              <AlertDialogDescription>
                Hapus pricing <strong>{deleteTarget?.vehicle_type}</strong> untuk <strong>{deleteTarget?.vendor_name}</strong>? Tindakan ini tidak dapat dibatalkan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>Hapus</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
