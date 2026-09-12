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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, PowerOff, Search, ChevronDown, MapPin, LayoutGrid, ChevronLeft } from "lucide-react";
import { Link } from "wouter";


// Companies loaded dynamically from API — no hardcoded IDs
interface CompanyOpt { id: number; companyName: string; companyCode: string; }
const UNIT_TYPE_OPTIONS = [
  { value: "food_booth", label: "Booth Makanan" },
  { value: "beverage_booth", label: "Booth Minuman" },
  { value: "shared_kitchen", label: "Dapur Bersama" },
  { value: "storage", label: "Storage" },
  { value: "cashier_area", label: "Area Kasir" },
  { value: "seating_area", label: "Area Duduk" },
  { value: "other", label: "Lainnya" },
];
const UNIT_TYPE_LABELS: Record<string, string> = Object.fromEntries(UNIT_TYPE_OPTIONS.map((o) => [o.value, o.label]));
const STATUS_OPTIONS = [
  { value: "available", label: "Tersedia" },
  { value: "occupied", label: "Terisi" },
  { value: "maintenance", label: "Maintenance" },
  { value: "inactive", label: "Nonaktif" },
];
const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
const STATUS_CLASS: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-800 border-emerald-200",
  occupied: "bg-blue-100 text-blue-800 border-blue-200",
  maintenance: "bg-yellow-100 text-yellow-800 border-yellow-200",
  inactive: "bg-neutral-100 text-neutral-600 border-neutral-300",
};
const DENAH_COLOR: Record<string, string> = {
  available: "bg-emerald-500/30 border-emerald-400 text-emerald-200",
  occupied: "bg-blue-500/30 border-blue-400 text-blue-200",
  maintenance: "bg-yellow-500/30 border-yellow-400 text-yellow-200",
  inactive: "bg-neutral-700/40 border-neutral-600 text-neutral-400",
};
const AREA_SUGGESTIONS = ["Area Kantin", "Area Belakang", "Area Kasir", "Area Duduk", "Area Luar"];

interface TenantUnit {
  id: number;
  company_id: number;
  unit_code: string;
  name: string;
  area_name: string;
  unit_type: string;
  area_sqm: string | null;
  monthly_rate: string | null;
  status: string;
  notes: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
}

const emptyForm = {
  company_id: "1",
  unit_code: "",
  name: "",
  area_name: "Area Kantin",
  unit_type: "food_booth",
  area_sqm: "",
  monthly_rate: "",
  status: "available",
  notes: "",
  position_x: "0",
  position_y: "0",
  width: "100",
  height: "80",
};

async function fetchUnits(qs: URLSearchParams) {
  const r = await fetch(`/api/tenant/units?${qs}`, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as { data: TenantUnit[]; total: number };
}

const fmt = (n: string | null) =>
  n ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n)) : "—";

export default function TenantUnits() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"table" | "denah">("table");

  const [filterCompany, setFilterCompany] = useState("all");
  const [filterArea, setFilterArea] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");

  // Load companies dynamically from API
  const { data: companies = [] } = useQuery<CompanyOpt[]>({
    queryKey: ["companies"],
    queryFn: () => fetch("/api/companies", { credentials: "include" }).then((r) => r.json()),
    staleTime: 5 * 60_000,
  });
  const companyLabel = (id: number) => companies.find((c) => c.id === id)?.companyName ?? String(id);
  const firstCompanyId = companies[0]?.id ? String(companies[0].id) : "1";

  const [denahCompany, setDenahCompany] = useState<string | null>(null);
  const effectiveDenahCompany = denahCompany ?? firstCompanyId;
  const [denahArea, setDenahArea] = useState("all");
  const [selectedUnit, setSelectedUnit] = useState<TenantUnit | null>(null);

  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [posOpen, setPosOpen] = useState(false);

  const qs = new URLSearchParams();
  if (filterCompany !== "all") qs.set("companyId", filterCompany);
  if (filterArea !== "all") qs.set("area_name", filterArea);
  if (filterType !== "all") qs.set("unit_type", filterType);
  if (filterStatus !== "all") qs.set("status", filterStatus);
  if (search.trim()) qs.set("search", search.trim());

  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant-units", filterCompany, filterArea, filterType, filterStatus, search],
    queryFn: () => fetchUnits(qs),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const units = data?.data ?? [];

  const allQs = new URLSearchParams();
  if (filterCompany !== "all") allQs.set("companyId", filterCompany);
  const { data: allData } = useQuery({
    queryKey: ["tenant-units-all", filterCompany],
    queryFn: () => fetchUnits(allQs),
    refetchInterval: 60_000,
  });
  const uniqueAreas = [...new Set((allData?.data ?? []).map((u) => u.area_name))].sort();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tenant-units"] });
    qc.invalidateQueries({ queryKey: ["tenant-units-all"] });
    qc.invalidateQueries({ queryKey: ["tenant-dashboard"] });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        company_id: Number(form.company_id),
        unit_code: form.unit_code.trim(),
        name: form.name.trim(),
        area_name: form.area_name.trim() || "Area Kantin",
        unit_type: form.unit_type,
        area_sqm: form.area_sqm !== "" ? Number(form.area_sqm) : null,
        monthly_rate: form.monthly_rate !== "" ? Number(form.monthly_rate) : null,
        status: form.status,
        notes: form.notes || null,
        position_x: Number(form.position_x) || 0,
        position_y: Number(form.position_y) || 0,
        width: Number(form.width) || 100,
        height: Number(form.height) || 80,
      };
      const url = editId ? `/api/tenant/units/${editId}` : "/api/tenant/units";
      const method = editId ? "PUT" : "POST";
      const qp = new URLSearchParams({ companyId: form.company_id });
      const r = await fetch(`${url}?${qp}`, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ error: "Gagal menyimpan" }));
        throw new Error(e.error ?? "Gagal menyimpan");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: editId ? "Unit diperbarui" : "Unit ditambahkan" });
      setShowDialog(false); setForm(emptyForm); setEditId(null);
      qc.invalidateQueries({ queryKey: ["tenant-units"] });
      qc.invalidateQueries({ queryKey: ["tenant-dashboard"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/tenant/units/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Unit dihapus" });
      qc.invalidateQueries({ queryKey: ["tenant-units"] });
      qc.invalidateQueries({ queryKey: ["tenant-dashboard"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const rows = data?.data ?? [];


  const deactivateMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/tenant/units/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ error: "Gagal" }));
        throw new Error(e.error ?? "Gagal menonaktifkan");
      }
    },
    onSuccess: () => { toast({ title: "Unit dinonaktifkan" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditId(null);
    setForm({ ...emptyForm });
    setPosOpen(false);
    setShowDialog(true);
  }

  function openEdit(u: TenantUnit) {
    setEditId(u.id);
    setForm({
      company_id: String(u.company_id),
      unit_code: u.unit_code,
      name: u.name,
      area_name: u.area_name,
      unit_type: u.unit_type,
      area_sqm: u.area_sqm ?? "",
      monthly_rate: u.monthly_rate ?? "",
      status: u.status,
      notes: u.notes ?? "",
      position_x: String(u.position_x),
      position_y: String(u.position_y),
      width: String(u.width),
      height: String(u.height),
    });
    setPosOpen(false);
    setShowDialog(true);
  }

  function setF(k: string, v: string) { setForm((p) => ({ ...p, [k]: v })); }

  const denahUnits = (allData?.data ?? []).filter(
    (u) => String(u.company_id) === effectiveDenahCompany && (denahArea === "all" || u.area_name === denahArea),
  );
  const denahW = Math.max(...denahUnits.map((u) => u.position_x + u.width), 600) + 30;
  const denahH = Math.max(...denahUnits.map((u) => u.position_y + u.height), 400) + 30;
  const denahAreas = [...new Set((allData?.data ?? []).filter((u) => String(u.company_id) === effectiveDenahCompany).map((u) => u.area_name))].sort();

  return (
    <AppShell>
      <div className="p-6 space-y-4">
      <button onClick={() => window.history.back()} className="mb-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ChevronLeft className="h-4 w-4" />Kembali</button>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutGrid className="h-6 w-6" /> Unit Kantin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Kelola unit booth dan area kantin per lokasi</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Tambah Unit
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "table" | "denah")}>
        <TabsList>
          <TabsTrigger value="table">Tabel Unit</TabsTrigger>
          <TabsTrigger value="denah">Denah Unit</TabsTrigger>
        </TabsList>

        {/* TABLE TAB */}
        <TabsContent value="table" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Kode / nama unit…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 w-52" />
            </div>
            <Select value={filterCompany} onValueChange={setFilterCompany}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Semua Lokasi" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Lokasi</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterArea} onValueChange={setFilterArea}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Semua Area" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Area</SelectItem>
                {uniqueAreas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Semua Jenis" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Jenis</SelectItem>
                {UNIT_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Semua Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">Gagal memuat: {String(error)}</p>}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lokasi</TableHead>
                  <TableHead>Kode Unit</TableHead>
                  <TableHead>Nama Unit</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead className="text-right">Luas (m²)</TableHead>
                  <TableHead className="text-right">Tarif Bulanan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Memuat…</TableCell></TableRow>
                )}
                {!isLoading && units.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Tidak ada unit ditemukan</TableCell></TableRow>
                )}
                {units.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
                        <MapPin className="h-3 w-3" /> {companyLabel(u.company_id)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm font-medium">{u.unit_code}</TableCell>
                    <TableCell>{u.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.area_name}</TableCell>
                    <TableCell className="text-sm">{UNIT_TYPE_LABELS[u.unit_type] ?? u.unit_type}</TableCell>
                    <TableCell className="text-right text-sm">{u.area_sqm ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{fmt(u.monthly_rate)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[u.status] ?? ""}`}>
                        {STATUS_LABELS[u.status] ?? u.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                        {u.status !== "inactive" && (
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive"
                            onClick={() => { if (confirm(`Nonaktifkan unit ${u.unit_code}?`)) deactivateMut.mutate(u.id); }}>
                            <PowerOff className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* DENAH TAB */}
        <TabsContent value="denah" className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={effectiveDenahCompany} onValueChange={(v) => { setDenahCompany(v); setDenahArea("all"); setSelectedUnit(null); }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={denahArea} onValueChange={(v) => { setDenahArea(v); setSelectedUnit(null); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Semua Area" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Area</SelectItem>
                {denahAreas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-3 flex-wrap ml-2">
              {STATUS_OPTIONS.map((s) => (
                <span key={s.value} className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className={`inline-block w-3 h-3 rounded-sm border ${DENAH_COLOR[s.value]}`} />
                  {s.label}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <div className="relative border rounded-lg bg-neutral-900 overflow-auto flex-1" style={{ minHeight: 400 }}>
              <div style={{ width: denahW, height: denahH, position: "relative" }}>
                {denahUnits.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm">
                    Tidak ada unit di lokasi/area ini
                  </div>
                )}
                {denahUnits.map((u) => (
                  <div
                    key={u.id}
                    onClick={() => setSelectedUnit(selectedUnit?.id === u.id ? null : u)}
                    className={`absolute border-2 rounded cursor-pointer transition-all select-none
                      ${DENAH_COLOR[u.status] ?? "bg-neutral-700/30 border-neutral-600"}
                      ${selectedUnit?.id === u.id ? "ring-2 ring-white/50" : "hover:brightness-125"}`}
                    style={{ left: u.position_x, top: u.position_y, width: u.width, height: u.height }}
                  >
                    <div className="p-1 h-full flex flex-col justify-between overflow-hidden">
                      <span className="text-[10px] font-mono font-bold leading-tight">{u.unit_code}</span>
                      <span className="text-[9px] leading-tight opacity-80 truncate">{u.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedUnit && (
              <Card className="w-60 shrink-0">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-mono">{selectedUnit.unit_code}</CardTitle></CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  <div><span className="text-muted-foreground">Nama:</span> {selectedUnit.name}</div>
                  <div><span className="text-muted-foreground">Lokasi:</span> {companyLabel(selectedUnit.company_id)}</div>
                  <div><span className="text-muted-foreground">Area:</span> {selectedUnit.area_name}</div>
                  <div><span className="text-muted-foreground">Jenis:</span> {UNIT_TYPE_LABELS[selectedUnit.unit_type] ?? selectedUnit.unit_type}</div>
                  <div><span className="text-muted-foreground">Luas:</span> {selectedUnit.area_sqm ? `${selectedUnit.area_sqm} m²` : "—"}</div>
                  <div><span className="text-muted-foreground">Tarif:</span> {fmt(selectedUnit.monthly_rate)}</div>
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASS[selectedUnit.status] ?? ""}`}>
                      {STATUS_LABELS[selectedUnit.status] ?? selectedUnit.status}
                    </span>
                  </div>
                  {selectedUnit.notes && <div className="text-xs text-muted-foreground mt-1">{selectedUnit.notes}</div>}
                  <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => openEdit(selectedUnit)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* DIALOG */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Unit" : "Tambah Unit Kantin"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Lokasi <span className="text-destructive">*</span></Label>
                <Select value={form.company_id} onValueChange={(v) => setF("company_id", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.companyName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Kode Unit <span className="text-destructive">*</span></Label>
                <Input placeholder="SC-KTN-01" value={form.unit_code} onChange={(e) => setF("unit_code", e.target.value.toUpperCase())} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Nama Unit <span className="text-destructive">*</span></Label>
              <Input placeholder="Booth Makanan 01" value={form.name} onChange={(e) => setF("name", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Area</Label>
                <Select value={form.area_name} onValueChange={(v) => setF("area_name", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AREA_SUGGESTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Jenis Unit</Label>
                <Select value={form.unit_type} onValueChange={(v) => setF("unit_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIT_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Luas (m²)</Label>
                <Input type="number" min={0} placeholder="0" value={form.area_sqm} onChange={(e) => setF("area_sqm", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Tarif Bulanan (Rp)</Label>
                <Input type="number" min={0} placeholder="0" value={form.monthly_rate} onChange={(e) => setF("monthly_rate", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setF("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Catatan</Label>
              <Textarea rows={2} placeholder="Opsional…" value={form.notes} onChange={(e) => setF("notes", e.target.value)} />
            </div>

            <Collapsible open={posOpen} onOpenChange={setPosOpen}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  <ChevronDown className={`h-4 w-4 transition-transform ${posOpen ? "rotate-180" : ""}`} />
                  Pengaturan Denah (posisi &amp; ukuran)
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="space-y-1"><Label>Posisi X</Label><Input type="number" min={0} value={form.position_x} onChange={(e) => setF("position_x", e.target.value)} /></div>
                  <div className="space-y-1"><Label>Posisi Y</Label><Input type="number" min={0} value={form.position_y} onChange={(e) => setF("position_y", e.target.value)} /></div>
                  <div className="space-y-1"><Label>Lebar (px)</Label><Input type="number" min={20} value={form.width} onChange={(e) => setF("width", e.target.value)} /></div>
                  <div className="space-y-1"><Label>Tinggi (px)</Label><Input type="number" min={20} value={form.height} onChange={(e) => setF("height", e.target.value)} /></div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.unit_code || !form.name}>
              {saveMut.isPending ? "Menyimpan…" : editId ? "Simpan Perubahan" : "Tambah Unit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AppShell>
  );
}
