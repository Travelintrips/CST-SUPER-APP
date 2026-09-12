import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Search, LayoutGrid, List,
  Building2, MapPin, Ruler, DollarSign, RefreshCw, ChevronLeft,
} from "lucide-react";
import { Link } from "wouter";

const idr = (n: number | string | null | undefined) =>
  n ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n)) : "—";

const UNIT_TYPE_OPTIONS = [
  { value: "food_booth", label: "Booth Makanan" },
  { value: "beverage_booth", label: "Booth Minuman" },
  { value: "shared_kitchen", label: "Dapur Bersama" },
  { value: "storage", label: "Storage" },
  { value: "cashier_area", label: "Area Kasir" },
  { value: "seating_area", label: "Area Duduk" },
  { value: "other", label: "Lainnya" },
];
const UNIT_TYPE_LABEL: Record<string, string> = Object.fromEntries(UNIT_TYPE_OPTIONS.map((o) => [o.value, o.label]));

const STATUS_OPTIONS = [
  { value: "available", label: "Tersedia" },
  { value: "occupied", label: "Terisi" },
  { value: "maintenance", label: "Maintenance" },
  { value: "inactive", label: "Nonaktif" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
const STATUS_CLASS: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-800 border-emerald-200",
  occupied:  "bg-blue-100 text-blue-800 border-blue-200",
  maintenance: "bg-yellow-100 text-yellow-800 border-yellow-200",
  inactive:  "bg-neutral-100 text-neutral-600 border-neutral-300",
};
const DENAH_COLOR: Record<string, string> = {
  available: "bg-emerald-500/30 border-emerald-400 text-emerald-200",
  occupied:  "bg-blue-500/40 border-blue-400 text-blue-100",
  maintenance: "bg-yellow-500/30 border-yellow-400 text-yellow-200",
  inactive:  "bg-neutral-700/40 border-neutral-600 text-neutral-400",
};

const SITE_TYPE_OPTIONS = [
  { value: "mall_tenant", label: "Mall / Kios" },
  { value: "sport_center", label: "Sport Center" },
];

interface MallSite {
  id: number; code: string; name: string; type: string; address: string | null; status: string;
  unit_count: number; available_count: number; occupied_count: number;
}
interface MallUnit {
  id: number; site_id: number; unit_code: string; floor: string | null; zone: string | null;
  size_m2: string | null; status: string; position_x: number; position_y: number;
  width: number; height: number; notes: string | null; unit_type: string;
  area_kantin: string | null; default_rent_amount: string | null;
  site_name: string; site_code: string;
}

const emptyUnit = {
  unit_code: "", site_id: "", floor: "", zone: "", size_m2: "", status: "available",
  position_x: "0", position_y: "0", width: "2", height: "2",
  notes: "", unit_type: "food_booth", area_kantin: "", default_rent_amount: "",
};

const emptySite = { code: "", name: "", type: "mall_tenant", address: "", status: "active" };

export default function MallUnitsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeSiteId, setActiveSiteId] = useState<number | "all">("all");
  const [view, setView] = useState<"table" | "denah">("table");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [showUnitDialog, setShowUnitDialog] = useState(false);
  const [editUnit, setEditUnit] = useState<MallUnit | null>(null);
  const [unitForm, setUnitForm] = useState(emptyUnit);

  const [showSiteDialog, setShowSiteDialog] = useState(false);
  const [editSite, setEditSite] = useState<MallSite | null>(null);
  const [siteForm, setSiteForm] = useState(emptySite);

  const [confirmDelete, setConfirmDelete] = useState<MallUnit | null>(null);

  const { data: sitesData, isLoading: sitesLoading } = useQuery<{ data: MallSite[]; total: number }>({
    queryKey: ["mall-sites"],
    queryFn: async () => {
      const r = await fetch("/api/tenant/mall-sites", { credentials: "include" });
      return r.json();
    },
  });

  const { data: unitsData, isLoading: unitsLoading } = useQuery<{ data: MallUnit[]; total: number }>({
    queryKey: ["mall-units", activeSiteId, statusFilter, search],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeSiteId !== "all") qs.set("site_id", String(activeSiteId));
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (search) qs.set("search", search);
      const r = await fetch(`/api/tenant/mall-units?${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  const sites = sitesData?.data ?? [];
  const units = unitsData?.data ?? [];

  const openCreateUnit = () => {
    setEditUnit(null);
    setUnitForm({ ...emptyUnit, site_id: activeSiteId !== "all" ? String(activeSiteId) : "" });
    setShowUnitDialog(true);
  };
  const openEditUnit = (u: MallUnit) => {
    setEditUnit(u);
    setUnitForm({
      unit_code: u.unit_code, site_id: String(u.site_id), floor: u.floor ?? "",
      zone: u.zone ?? "", size_m2: u.size_m2 ?? "", status: u.status,
      position_x: String(u.position_x), position_y: String(u.position_y),
      width: String(u.width), height: String(u.height),
      notes: u.notes ?? "", unit_type: u.unit_type,
      area_kantin: u.area_kantin ?? "", default_rent_amount: u.default_rent_amount ?? "",
    });
    setShowUnitDialog(true);
  };
  const openCreateSite = () => { setEditSite(null); setSiteForm(emptySite); setShowSiteDialog(true); };
  const openEditSite = (s: MallSite) => {
    setEditSite(s);
    setSiteForm({ code: s.code, name: s.name, type: s.type, address: s.address ?? "", status: s.status });
    setShowSiteDialog(true);
  };

  const saveUnitMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url = editUnit ? `/api/tenant/mall-units/${editUnit.id}` : "/api/tenant/mall-units";
      const method = editUnit ? "PUT" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal menyimpan");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editUnit ? "Unit diperbarui" : "Unit ditambahkan" });
      setShowUnitDialog(false);
      qc.invalidateQueries({ queryKey: ["mall-units"] });
      qc.invalidateQueries({ queryKey: ["mall-sites"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const saveSiteMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url = editSite ? `/api/tenant/mall-sites/${editSite.id}` : "/api/tenant/mall-sites";
      const method = editSite ? "PUT" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal menyimpan site");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editSite ? "Site diperbarui" : "Site ditambahkan" });
      setShowSiteDialog(false);
      qc.invalidateQueries({ queryKey: ["mall-sites"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/tenant/mall-units/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal menghapus");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Unit dihapus" });
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["mall-units"] });
      qc.invalidateQueries({ queryKey: ["mall-sites"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const handleSaveUnit = () => {
    const body: Record<string, unknown> = {
      unit_code: unitForm.unit_code.toUpperCase(),
      site_id: Number(unitForm.site_id),
      floor: unitForm.floor || null,
      zone: unitForm.zone || null,
      size_m2: unitForm.size_m2 ? Number(unitForm.size_m2) : null,
      status: unitForm.status,
      position_x: Number(unitForm.position_x),
      position_y: Number(unitForm.position_y),
      width: Number(unitForm.width),
      height: Number(unitForm.height),
      notes: unitForm.notes || null,
      unit_type: unitForm.unit_type,
      area_kantin: unitForm.area_kantin || null,
      default_rent_amount: unitForm.default_rent_amount ? Number(unitForm.default_rent_amount) : 0,
    };
    saveUnitMutation.mutate(body);
  };

  const handleSaveSite = () => {
    saveSiteMutation.mutate({
      code: siteForm.code.toUpperCase(),
      name: siteForm.name,
      type: siteForm.type,
      address: siteForm.address || null,
      status: siteForm.status,
    });
  };

  const activeSite = sites.find((s) => s.id === activeSiteId);
  const denahUnits = units.filter((u) => activeSiteId === "all" || u.site_id === activeSiteId);
  const maxX = denahUnits.reduce((m, u) => Math.max(m, u.position_x + u.width), 8);
  const maxY = denahUnits.reduce((m, u) => Math.max(m, u.position_y + u.height), 6);
  const cellSize = 56;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Building2 className="text-purple-400" /> Mall Units
            </h1>
            <p className="text-neutral-400 text-sm mt-0.5">
              Kelola unit & site properti kantin/kios ({unitsData?.total ?? 0} unit total)
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={openCreateSite}>
              <MapPin className="w-4 h-4 mr-1" /> Tambah Site
            </Button>
            <Button size="sm" onClick={openCreateUnit} className="bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4 mr-1" /> Tambah Unit
            </Button>
          </div>
        </div>

        {/* Site cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card
            className={`cursor-pointer transition-all border ${activeSiteId === "all" ? "border-purple-500 bg-purple-950/40" : "border-neutral-700 bg-neutral-900 hover:border-purple-700"}`}
            onClick={() => setActiveSiteId("all")}
          >
            <CardContent className="p-3">
              <div className="text-xs text-neutral-400 mb-1">Semua Site</div>
              <div className="text-xl font-bold text-white">{unitsData?.total ?? 0}</div>
              <div className="text-xs text-neutral-500">unit terdaftar</div>
            </CardContent>
          </Card>
          {sitesLoading ? (
            <Card className="border-neutral-700 bg-neutral-900"><CardContent className="p-3 text-neutral-400 text-xs">Loading...</CardContent></Card>
          ) : sites.map((s) => (
            <Card
              key={s.id}
              className={`cursor-pointer transition-all border ${activeSiteId === s.id ? "border-purple-500 bg-purple-950/40" : "border-neutral-700 bg-neutral-900 hover:border-purple-700"}`}
              onClick={() => setActiveSiteId(s.id)}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-neutral-300">{s.name}</span>
                  <Badge variant="outline" className={s.status === "active" ? "border-emerald-600 text-emerald-400 text-xs" : "border-neutral-600 text-neutral-500 text-xs"}>
                    {s.status === "active" ? "Aktif" : "Nonaktif"}
                  </Badge>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="text-emerald-400">{s.available_count} tersedia</span>
                  <span className="text-blue-400">{s.occupied_count} terisi</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-neutral-500">{s.unit_count} unit</span>
                  <button
                    className="text-neutral-500 hover:text-blue-400 transition-colors"
                    onClick={(e) => { e.stopPropagation(); openEditSite(s); }}
                    title="Edit site"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              placeholder="Cari kode unit atau area..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-neutral-900 border-neutral-700 text-white placeholder:text-neutral-500"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 bg-neutral-900 border-neutral-700 text-white">
              <SelectValue placeholder="Semua Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex border border-neutral-700 rounded-md overflow-hidden">
            <button
              onClick={() => setView("table")}
              className={`px-3 py-2 text-sm flex items-center gap-1 transition-colors ${view === "table" ? "bg-neutral-700 text-white" : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"}`}
            >
              <List className="w-4 h-4" /> Tabel
            </button>
            <button
              onClick={() => setView("denah")}
              className={`px-3 py-2 text-sm flex items-center gap-1 transition-colors ${view === "denah" ? "bg-neutral-700 text-white" : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"}`}
            >
              <LayoutGrid className="w-4 h-4" /> Denah
            </button>
          </div>
          <Button variant="ghost" size="icon" onClick={() => { qc.invalidateQueries({ queryKey: ["mall-units"] }); qc.invalidateQueries({ queryKey: ["mall-sites"] }); }}>
            <RefreshCw className="w-4 h-4 text-neutral-400" />
          </Button>
        </div>

        {/* Content */}
        {view === "table" ? (
          <Card className="bg-neutral-900 border-neutral-700">
            <CardContent className="p-0">
              {unitsLoading ? (
                <div className="p-8 text-center text-neutral-400">Memuat data...</div>
              ) : units.length === 0 ? (
                <div className="p-8 text-center text-neutral-400">
                  <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>Belum ada unit</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-neutral-700 hover:bg-transparent">
                      <TableHead className="text-neutral-400">Kode Unit</TableHead>
                      <TableHead className="text-neutral-400">Site</TableHead>
                      <TableHead className="text-neutral-400">Area / Lantai</TableHead>
                      <TableHead className="text-neutral-400">Tipe</TableHead>
                      <TableHead className="text-neutral-400">Luas (m²)</TableHead>
                      <TableHead className="text-neutral-400">Harga Sewa</TableHead>
                      <TableHead className="text-neutral-400">Status</TableHead>
                      <TableHead className="text-neutral-400 text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {units.map((u) => (
                      <TableRow key={u.id} className="border-neutral-800 hover:bg-neutral-800/40">
                        <TableCell className="font-mono font-semibold text-white text-sm">{u.unit_code}</TableCell>
                        <TableCell>
                          <div className="text-white text-sm">{u.site_name}</div>
                          <div className="text-neutral-500 text-xs">{u.site_code}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-neutral-300 text-sm">{u.area_kantin ?? u.zone ?? "—"}</div>
                          {u.floor && <div className="text-neutral-500 text-xs">Lantai {u.floor}</div>}
                        </TableCell>
                        <TableCell className="text-neutral-400 text-sm">{UNIT_TYPE_LABEL[u.unit_type] ?? u.unit_type}</TableCell>
                        <TableCell className="text-neutral-300 text-sm">{u.size_m2 ? `${u.size_m2} m²` : "—"}</TableCell>
                        <TableCell className="text-emerald-400 text-sm">{idr(u.default_rent_amount)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${STATUS_CLASS[u.status] ?? ""}`}>
                            {STATUS_LABEL[u.status] ?? u.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-400 hover:text-blue-300" onClick={() => openEditUnit(u)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300"
                              onClick={() => setConfirmDelete(u)}
                              disabled={u.status === "occupied"}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : (
          /* DENAH VIEW */
          <Card className="bg-neutral-900 border-neutral-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base">
                Denah {activeSite ? `— ${activeSite.name}` : "Semua Site"}
              </CardTitle>
              <div className="flex gap-3 text-xs text-neutral-400 flex-wrap">
                {STATUS_OPTIONS.map((o) => (
                  <span key={o.value} className="flex items-center gap-1">
                    <span className={`inline-block w-3 h-3 rounded border ${DENAH_COLOR[o.value]}`} />
                    {o.label}
                  </span>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {denahUnits.length === 0 ? (
                <div className="text-center text-neutral-400 py-8">Tidak ada unit untuk ditampilkan</div>
              ) : (
                <div
                  className="relative bg-neutral-800/50 border border-neutral-700 rounded-lg overflow-auto"
                  style={{ minHeight: (maxY + 1) * cellSize + 24 }}
                >
                  <div
                    className="relative"
                    style={{ width: (maxX + 1) * cellSize, height: (maxY + 1) * cellSize, margin: "12px" }}
                  >
                    {denahUnits.map((u) => (
                      <div
                        key={u.id}
                        className={`absolute flex flex-col items-center justify-center border rounded cursor-pointer transition-all hover:brightness-125 text-center p-1 ${DENAH_COLOR[u.status] ?? DENAH_COLOR.inactive}`}
                        style={{
                          left: u.position_x * cellSize,
                          top: u.position_y * cellSize,
                          width: u.width * cellSize - 4,
                          height: u.height * cellSize - 4,
                        }}
                        title={`${u.unit_code} — ${u.site_name} | ${STATUS_LABEL[u.status]}`}
                        onClick={() => openEditUnit(u)}
                      >
                        <span className="text-xs font-bold leading-tight">{u.unit_code}</span>
                        {u.size_m2 && <span className="text-[10px] opacity-70">{u.size_m2}m²</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Unit Dialog */}
      <Dialog open={showUnitDialog} onOpenChange={setShowUnitDialog}>
        <DialogContent className="bg-neutral-900 border-neutral-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editUnit ? "Edit Unit" : "Tambah Unit Baru"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-neutral-300">Kode Unit *</Label>
              <Input
                value={unitForm.unit_code}
                onChange={(e) => setUnitForm({ ...unitForm, unit_code: e.target.value.toUpperCase() })}
                placeholder="SC-KTN-01"
                className="bg-neutral-800 border-neutral-600 text-white font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-neutral-300">Site *</Label>
              <Select value={unitForm.site_id} onValueChange={(v) => setUnitForm({ ...unitForm, site_id: v })}>
                <SelectTrigger className="bg-neutral-800 border-neutral-600 text-white">
                  <SelectValue placeholder="Pilih site" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-neutral-300">Tipe Unit</Label>
              <Select value={unitForm.unit_type} onValueChange={(v) => setUnitForm({ ...unitForm, unit_type: v })}>
                <SelectTrigger className="bg-neutral-800 border-neutral-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-neutral-300">Status</Label>
              <Select value={unitForm.status} onValueChange={(v) => setUnitForm({ ...unitForm, status: v })}>
                <SelectTrigger className="bg-neutral-800 border-neutral-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-neutral-300">Area Kantin</Label>
              <Input value={unitForm.area_kantin} onChange={(e) => setUnitForm({ ...unitForm, area_kantin: e.target.value })}
                placeholder="AREA KANTIN" className="bg-neutral-800 border-neutral-600 text-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-neutral-300">Lantai</Label>
              <Input value={unitForm.floor} onChange={(e) => setUnitForm({ ...unitForm, floor: e.target.value })}
                placeholder="Main / 1 / 2" className="bg-neutral-800 border-neutral-600 text-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-neutral-300">Luas (m²)</Label>
              <Input type="number" value={unitForm.size_m2} onChange={(e) => setUnitForm({ ...unitForm, size_m2: e.target.value })}
                placeholder="12" className="bg-neutral-800 border-neutral-600 text-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-neutral-300">Harga Sewa Default (Rp)</Label>
              <Input type="number" value={unitForm.default_rent_amount} onChange={(e) => setUnitForm({ ...unitForm, default_rent_amount: e.target.value })}
                placeholder="3000000" className="bg-neutral-800 border-neutral-600 text-white" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-neutral-300 text-xs">Posisi Denah (X, Y) & Ukuran (W × H) dalam grid</Label>
              <div className="grid grid-cols-4 gap-2">
                {(["position_x", "position_y", "width", "height"] as const).map((k) => (
                  <Input key={k} type="number" value={unitForm[k]}
                    onChange={(e) => setUnitForm({ ...unitForm, [k]: e.target.value })}
                    placeholder={k === "position_x" ? "X" : k === "position_y" ? "Y" : k === "width" ? "W" : "H"}
                    className="bg-neutral-800 border-neutral-600 text-white text-center" />
                ))}
              </div>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-neutral-300">Catatan</Label>
              <Textarea value={unitForm.notes} onChange={(e) => setUnitForm({ ...unitForm, notes: e.target.value })}
                rows={2} placeholder="Opsional" className="bg-neutral-800 border-neutral-600 text-white resize-none" />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowUnitDialog(false)}>Batal</Button>
            <Button onClick={handleSaveUnit} disabled={saveUnitMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700">
              {saveUnitMutation.isPending ? "Menyimpan..." : editUnit ? "Simpan Perubahan" : "Tambah Unit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Site Dialog */}
      <Dialog open={showSiteDialog} onOpenChange={setShowSiteDialog}>
        <DialogContent className="bg-neutral-900 border-neutral-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>{editSite ? "Edit Site" : "Tambah Site Baru"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-neutral-300">Kode *</Label>
                <Input value={siteForm.code} onChange={(e) => setSiteForm({ ...siteForm, code: e.target.value.toUpperCase() })}
                  placeholder="ERA_001" className="bg-neutral-800 border-neutral-600 text-white font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-neutral-300">Nama *</Label>
                <Input value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
                  placeholder="Nama Gedung / Lokasi" className="bg-neutral-800 border-neutral-600 text-white" />
              </div>
              <div className="space-y-1">
                <Label className="text-neutral-300">Tipe</Label>
                <Select value={siteForm.type} onValueChange={(v) => setSiteForm({ ...siteForm, type: v })}>
                  <SelectTrigger className="bg-neutral-800 border-neutral-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SITE_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-neutral-300">Status</Label>
                <Select value={siteForm.status} onValueChange={(v) => setSiteForm({ ...siteForm, status: v })}>
                  <SelectTrigger className="bg-neutral-800 border-neutral-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-neutral-300">Alamat</Label>
              <Input value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })}
                placeholder="Opsional" className="bg-neutral-800 border-neutral-600 text-white" />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowSiteDialog(false)}>Batal</Button>
            <Button onClick={handleSaveSite} disabled={saveSiteMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700">
              {saveSiteMutation.isPending ? "Menyimpan..." : editSite ? "Simpan" : "Tambah Site"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent className="bg-neutral-900 border-neutral-700 text-white max-w-sm">
          <DialogHeader><DialogTitle>Hapus Unit</DialogTitle></DialogHeader>
          <p className="text-neutral-300 text-sm">
            Hapus unit <span className="font-mono font-bold text-white">{confirmDelete?.unit_code}</span> dari {confirmDelete?.site_name}?
            Tindakan ini tidak bisa dibatalkan.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Batal</Button>
            <Button variant="destructive" onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
