import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { QueryState } from "@/components/ui/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Anchor, Ship, Box, Route, Plus, Pencil, Trash2, Search, RefreshCw, Download, Upload, ArrowLeft } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

type Port = { id: number; code: string; name: string; city: string; country: string; country_code: string; region: string; port_type: string; timezone: string; is_active: boolean; sort_order: number; notes?: string };
type Carrier = { id: number; code: string; name: string; carrier_type: string; country: string; country_code: string; logo_url?: string; is_active: boolean; sort_order: number; notes?: string };
type ContainerType = { id: number; code: string; name: string; teu: string; max_cbm?: string; max_payload_kg?: number; is_reefer: boolean; is_special: boolean; is_active: boolean; sort_order: number; notes?: string };
type RouteMatrix = { id: number; origin_port_code: string; destination_port_code: string; carrier_code: string; service_name: string; transit_days_min?: number; transit_days_max?: number; frequency: string; direct_or_transshipment: string; pol?: string; pod?: string; transshipment_port?: string; is_active: boolean; notes?: string; origin_port_name?: string; destination_port_name?: string; carrier_name?: string; origin_city?: string; destination_city?: string };

const CARRIER_TYPES = [
  { v: "shipping_line",    l: "Shipping Line" },
  { v: "nvocc",            l: "NVOCC" },
  { v: "coloader",         l: "Co-Loader" },
  { v: "forwarder_partner", l: "Forwarder Partner" },
  { v: "internal_rate",    l: "Internal Rate" },
  { v: "vendor_rate",      l: "Vendor Rate" },
];
const FREQUENCIES   = ["daily","weekly","bi-weekly","monthly","on-demand"];
const DIRECT_OPTS   = ["direct","transshipment"];
const PORT_TYPES    = ["sea","air","road"];
const REGIONS       = ["Southeast Asia","Northeast Asia","South Asia","Middle East","Europe","North America","Oceania","Africa","South America"];

function ActiveBadge({ v }: { v: boolean }) {
  return (
    <Badge className={v ? "bg-green-50 text-green-700 border-green-200 text-xs" : "bg-gray-100 text-gray-500 text-xs"}>
      {v ? "Active" : "Inactive"}
    </Badge>
  );
}

function useCsvIE(exportUrl: string, importUrl: string, exportFilename: string, queryKey: string) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function handleExport() {
    try {
      const res = await fetch(exportUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = exportFilename; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast({ title: "Export gagal", description: e.message, variant: "destructive" }); }
  }

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const res = await fetch(importUrl, { method: "POST", credentials: "include", headers: { "Content-Type": "text/csv" }, body: text });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal import");
      qc.invalidateQueries({ queryKey: [queryKey] });
      const errMsg = d.errors?.length ? ` (${d.errors.length} error)` : "";
      toast({ title: `Import selesai: ${d.processed ?? d.total} baris diproses${errMsg}` });
    } catch (e: any) { toast({ title: "Import gagal", description: e.message, variant: "destructive" }); }
    finally { setImporting(false); if (importRef.current) importRef.current.value = ""; }
  }

  const CsvButtons = () => (
    <>
      <Button variant="outline" size="sm" onClick={handleExport} title="Export CSV"><Download className="w-4 h-4 mr-1" />Export</Button>
      <Button variant="outline" size="sm" disabled={importing} onClick={() => importRef.current?.click()} title="Import CSV"><Upload className="w-4 h-4 mr-1" />{importing ? "Importing..." : "Import"}</Button>
      <input ref={importRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); }} />
    </>
  );

  return { CsvButtons };
}

// ─── Route Matrix Tab ──────────────────────────────────────────────────────────

type RouteForm = { origin_port_code: string; destination_port_code: string; carrier_code: string; service_name: string; transit_days_min: string; transit_days_max: string; frequency: string; direct_or_transshipment: string; pol: string; pod: string; transshipment_port: string; notes: string; is_active: boolean };
const emptyRouteForm = (): RouteForm => ({ origin_port_code: "", destination_port_code: "", carrier_code: "", service_name: "", transit_days_min: "", transit_days_max: "", frequency: "weekly", direct_or_transshipment: "direct", pol: "", pod: "", transshipment_port: "", notes: "", is_active: true });

function RouteMatrixTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch]     = useState("");
  const [fOrigin, setFOrigin]   = useState("all");
  const [fDest, setFDest]       = useState("all");
  const [fCarrier, setFCarrier] = useState("all");
  const [fActive, setFActive]   = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId]     = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm]         = useState<RouteForm>(emptyRouteForm());
  const [saving, setSaving]     = useState(false);
  const { CsvButtons } = useCsvIE(
    "/api/ocean-freight-master/route-matrix/export",
    "/api/ocean-freight-master/route-matrix/import",
    `ocean-route-matrix-${new Date().toISOString().slice(0,10)}.csv`,
    "of-route-matrix"
  );

  const { data: rows = [], isLoading, refetch } = useQuery<RouteMatrix[]>({
    queryKey: ["of-route-matrix"],
    queryFn: () => fetch("/api/ocean-freight-master/route-matrix?includeInactive=true", { credentials: "include" }).then(r => r.json()),
  });

  const { data: ports = [] } = useQuery<Port[]>({ queryKey: ["of-ports"], queryFn: () => fetch("/api/ocean-freight-master/ports", { credentials: "include" }).then(r => r.json()) });
  const { data: carriers = [] } = useQuery<Carrier[]>({ queryKey: ["of-carriers"], queryFn: () => fetch("/api/ocean-freight-master/carriers", { credentials: "include" }).then(r => r.json()) });

  const allRows = Array.isArray(rows) ? rows : [];
  const origins  = [...new Set(allRows.map(r => r.origin_port_code))].sort();
  const dests    = [...new Set(allRows.map(r => r.destination_port_code))].sort();
  const carrierCodes = [...new Set(allRows.map(r => r.carrier_code))].sort();

  const filtered = allRows.filter(r => {
    if (fOrigin  !== "all" && r.origin_port_code      !== fOrigin)  return false;
    if (fDest    !== "all" && r.destination_port_code !== fDest)    return false;
    if (fCarrier !== "all" && r.carrier_code          !== fCarrier) return false;
    if (fActive  === "active"   && !r.is_active) return false;
    if (fActive  === "inactive" &&  r.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      return (r.origin_port_code?.toLowerCase().includes(q))
          || (r.destination_port_code?.toLowerCase().includes(q))
          || (r.carrier_code?.toLowerCase().includes(q))
          || (r.service_name?.toLowerCase().includes(q))
          || (r.origin_port_name?.toLowerCase().includes(q))
          || (r.destination_port_name?.toLowerCase().includes(q));
    }
    return true;
  });

  function openCreate() { setEditId(null); setForm(emptyRouteForm()); setDialogOpen(true); }
  function openEdit(r: RouteMatrix) {
    setEditId(r.id);
    setForm({ origin_port_code: r.origin_port_code, destination_port_code: r.destination_port_code, carrier_code: r.carrier_code, service_name: r.service_name ?? "", transit_days_min: String(r.transit_days_min ?? ""), transit_days_max: String(r.transit_days_max ?? ""), frequency: r.frequency ?? "weekly", direct_or_transshipment: r.direct_or_transshipment ?? "direct", pol: r.pol ?? "", pod: r.pod ?? "", transshipment_port: r.transshipment_port ?? "", notes: r.notes ?? "", is_active: r.is_active !== false });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.origin_port_code || !form.destination_port_code || !form.carrier_code) {
      toast({ title: "Origin port, destination port, dan carrier wajib diisi", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const url = editId ? `/api/ocean-freight-master/route-matrix/${editId}` : "/api/ocean-freight-master/route-matrix";
      const res = await fetch(url, { method: editId ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal simpan");
      qc.invalidateQueries({ queryKey: ["of-route-matrix"] });
      setDialogOpen(false);
      toast({ title: editId ? "Route diperbarui" : "Route ditambahkan" });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/ocean-freight-master/route-matrix/${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["of-route-matrix"] });
    setDeleteId(null);
    toast({ title: "Route dihapus" });
  }

  function F(key: keyof RouteForm) {
    return { value: form[key] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })) };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3 flex-wrap flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Cari route / carrier / service..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-56" />
          </div>
          <Select value={fOrigin} onValueChange={setFOrigin}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Origin" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Origin</SelectItem>
              {origins.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fDest} onValueChange={setFDest}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Destination" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Dest</SelectItem>
              {dests.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fCarrier} onValueChange={setFCarrier}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Carrier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Carrier</SelectItem>
              {carrierCodes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fActive} onValueChange={setFActive}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 ml-3">
          <Button variant="outline" size="sm" aria-label="Segarkan" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
          <CsvButtons />
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Tambah</Button>
        </div>
      </div>
      <p className="text-xs text-gray-400">{filtered.length} dari {allRows.length} route</p>

      <QueryState loading={isLoading} skeletonRows={5}>
        <div className="bg-white rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Origin</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Service</TableHead>
                <TableHead className="whitespace-nowrap">Transit Days</TableHead>
                <TableHead>Direct/Trans</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-10 text-gray-400">Tidak ada data</TableCell></TableRow>
              ) : filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <p className="font-medium text-sm">{r.origin_port_code}</p>
                    <p className="text-xs text-gray-400">{r.origin_port_name ?? r.origin_city ?? ""}</p>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium text-sm">{r.destination_port_code}</p>
                    <p className="text-xs text-gray-400">{r.destination_port_name ?? r.destination_city ?? ""}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{r.carrier_code}</p>
                    <p className="text-xs text-gray-400">{r.carrier_name ?? ""}</p>
                  </TableCell>
                  <TableCell className="text-sm">{r.service_name || "—"}</TableCell>
                  <TableCell className="text-sm text-center">{r.transit_days_min && r.transit_days_max ? `${r.transit_days_min}–${r.transit_days_max}d` : r.transit_days_min ? `${r.transit_days_min}d` : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">{r.direct_or_transshipment}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-gray-600 capitalize">{r.frequency}</TableCell>
                  <TableCell><ActiveBadge v={r.is_active} /></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => openEdit(r)}><Pencil className="w-4 h-4 text-blue-500" /></Button>
                      <Button size="sm" variant="ghost" aria-label="Hapus" onClick={() => setDeleteId(r.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </QueryState>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit Route Matrix" : "Tambah Route Matrix"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label>Origin Port Code <span className="text-red-500">*</span></Label>
              <select {...F("origin_port_code")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                <option value="">Pilih Port</option>
                {ports.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Destination Port Code <span className="text-red-500">*</span></Label>
              <select {...F("destination_port_code")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                <option value="">Pilih Port</option>
                {ports.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Carrier Code <span className="text-red-500">*</span></Label>
              <select {...F("carrier_code")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                <option value="">Pilih Carrier</option>
                {carriers.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Service Name</Label>
              <Input {...F("service_name")} placeholder="CMA CGM JASIN" />
            </div>
            <div>
              <Label>Transit Days Min</Label>
              <Input type="number" {...F("transit_days_min")} />
            </div>
            <div>
              <Label>Transit Days Max</Label>
              <Input type="number" {...F("transit_days_max")} />
            </div>
            <div>
              <Label>Frequency</Label>
              <select {...F("frequency")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <Label>Direct / Transshipment</Label>
              <select {...F("direct_or_transshipment")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                {DIRECT_OPTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            {form.direct_or_transshipment === "transshipment" && (
              <div className="col-span-2">
                <Label>Transshipment Port</Label>
                <Input {...F("transshipment_port")} placeholder="SGSIN" />
              </div>
            )}
            <div>
              <Label>POL <span className="text-gray-400">(opsional)</span></Label>
              <Input {...F("pol")} />
            </div>
            <div>
              <Label>POD <span className="text-gray-400">(opsional)</span></Label>
              <Input {...F("pod")} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea {...F("notes")} rows={2} />
            </div>
            <div className="flex items-center gap-3 col-span-2">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white">{saving ? "Menyimpan..." : editId ? "Update" : "Tambah"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus Route Matrix?</AlertDialogTitle><AlertDialogDescription>Route ini akan dihapus permanen.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white" onClick={() => deleteId && handleDelete(deleteId)}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Ports Tab ────────────────────────────────────────────────────────────────

type PortForm = { code: string; name: string; city: string; country: string; country_code: string; region: string; port_type: string; timezone: string; is_active: boolean; sort_order: string; notes: string };
const emptyPortForm = (): PortForm => ({ code: "", name: "", city: "", country: "", country_code: "", region: "Southeast Asia", port_type: "sea", timezone: "Asia/Jakarta", is_active: true, sort_order: "0", notes: "" });

function PortsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch]   = useState("");
  const [fCountry, setFCountry] = useState("all");
  const [fActive, setFActive] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId]   = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm]       = useState<PortForm>(emptyPortForm());
  const [saving, setSaving]   = useState(false);
  const { CsvButtons } = useCsvIE(
    "/api/ocean-freight-master/ports/export",
    "/api/ocean-freight-master/ports/import",
    `freight-ports-${new Date().toISOString().slice(0,10)}.csv`,
    "of-ports"
  );

  const { data: rows = [], isLoading, refetch } = useQuery<Port[]>({
    queryKey: ["of-ports"],
    queryFn: () => fetch("/api/ocean-freight-master/ports", { credentials: "include" }).then(r => r.json()),
  });

  const allRows = Array.isArray(rows) ? rows : [];
  const countries = [...new Set(allRows.map(r => r.country).filter(Boolean))].sort();

  const filtered = allRows.filter(r => {
    if (fCountry !== "all" && r.country !== fCountry) return false;
    if (fActive === "active" && !r.is_active) return false;
    if (fActive === "inactive" && r.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.code?.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q) || r.city?.toLowerCase().includes(q) || r.country?.toLowerCase().includes(q);
    }
    return true;
  });

  function openCreate() { setEditId(null); setForm(emptyPortForm()); setDialogOpen(true); }
  function openEdit(r: Port) {
    setEditId(r.id);
    setForm({ code: r.code, name: r.name, city: r.city ?? "", country: r.country ?? "", country_code: r.country_code ?? "", region: r.region ?? "Southeast Asia", port_type: r.port_type ?? "sea", timezone: r.timezone ?? "Asia/Jakarta", is_active: r.is_active !== false, sort_order: String(r.sort_order ?? 0), notes: r.notes ?? "" });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.code || !form.name) { toast({ title: "Code dan name wajib diisi", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editId ? `/api/ocean-freight-master/ports/${editId}` : "/api/ocean-freight-master/ports";
      const res = await fetch(url, { method: editId ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal simpan");
      qc.invalidateQueries({ queryKey: ["of-ports"] });
      setDialogOpen(false);
      toast({ title: editId ? "Port diperbarui" : "Port ditambahkan" });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/ocean-freight-master/ports/${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["of-ports"] });
    setDeleteId(null);
    toast({ title: "Port dihapus" });
  }

  function F(key: keyof PortForm) {
    return { value: form[key] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })) };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3 flex-wrap flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Cari port code / nama / kota..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-56" />
          </div>
          <Select value={fCountry} onValueChange={setFCountry}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Country" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Negara</SelectItem>
              {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fActive} onValueChange={setFActive}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 ml-3">
          <Button variant="outline" size="sm" aria-label="Segarkan" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
          <CsvButtons />
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Tambah</Button>
        </div>
      </div>
      <p className="text-xs text-gray-400">{filtered.length} dari {allRows.length} port</p>

      <QueryState loading={isLoading} skeletonRows={5}>
        <div className="bg-white rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Port Code</TableHead>
                <TableHead>Port Name</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-gray-400">Tidak ada data</TableCell></TableRow>
              ) : filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-bold text-blue-700">{r.code}</TableCell>
                  <TableCell className="font-medium text-sm">{r.name}</TableCell>
                  <TableCell className="text-sm text-gray-600">{r.city}</TableCell>
                  <TableCell className="text-sm">
                    <span>{r.country_code && <span className="font-mono text-xs bg-gray-100 px-1 rounded mr-1">{r.country_code}</span>}{r.country}</span>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">{r.region}</TableCell>
                  <TableCell className="text-xs capitalize">{r.port_type}</TableCell>
                  <TableCell><ActiveBadge v={r.is_active} /></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => openEdit(r)}><Pencil className="w-4 h-4 text-blue-500" /></Button>
                      <Button size="sm" variant="ghost" aria-label="Hapus" onClick={() => setDeleteId(r.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </QueryState>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit Port" : "Tambah Port"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label>Port Code <span className="text-red-500">*</span></Label>
              <Input {...F("code")} placeholder="IDJKT" className="uppercase" disabled={!!editId} />
            </div>
            <div>
              <Label>Port Name <span className="text-red-500">*</span></Label>
              <Input {...F("name")} placeholder="Tanjung Priok" />
            </div>
            <div>
              <Label>City</Label>
              <Input {...F("city")} placeholder="Jakarta" />
            </div>
            <div>
              <Label>Country</Label>
              <Input {...F("country")} placeholder="Indonesia" />
            </div>
            <div>
              <Label>Country Code</Label>
              <Input {...F("country_code")} placeholder="ID" maxLength={2} className="uppercase" />
            </div>
            <div>
              <Label>Region</Label>
              <select {...F("region")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <Label>Port Type</Label>
              <select {...F("port_type")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                {PORT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label>Timezone</Label>
              <Input {...F("timezone")} placeholder="Asia/Jakarta" />
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input type="number" {...F("sort_order")} />
            </div>
            <div className="flex items-center gap-3 pt-4">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <Label>Active</Label>
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea {...F("notes")} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white">{saving ? "Menyimpan..." : editId ? "Update" : "Tambah"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus Port?</AlertDialogTitle><AlertDialogDescription>Port ini akan dihapus permanen.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white" onClick={() => deleteId && handleDelete(deleteId)}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Carriers Tab ─────────────────────────────────────────────────────────────

type CarrierForm = { code: string; name: string; carrier_type: string; country: string; country_code: string; logo_url: string; notes: string; is_active: boolean; sort_order: string };
const emptyCarrierForm = (): CarrierForm => ({ code: "", name: "", carrier_type: "shipping_line", country: "", country_code: "", logo_url: "", notes: "", is_active: true, sort_order: "0" });

function CarriersTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch]     = useState("");
  const [fType, setFType]       = useState("all");
  const [fActive, setFActive]   = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId]     = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm]         = useState<CarrierForm>(emptyCarrierForm());
  const [saving, setSaving]     = useState(false);
  const { CsvButtons } = useCsvIE(
    "/api/ocean-freight-master/carriers/export",
    "/api/ocean-freight-master/carriers/import",
    `freight-carriers-${new Date().toISOString().slice(0,10)}.csv`,
    "of-carriers"
  );

  const { data: rows = [], isLoading, refetch } = useQuery<Carrier[]>({
    queryKey: ["of-carriers"],
    queryFn: () => fetch("/api/ocean-freight-master/carriers", { credentials: "include" }).then(r => r.json()),
  });

  const allRows = Array.isArray(rows) ? rows : [];
  const filtered = allRows.filter(r => {
    if (fType   !== "all" && r.carrier_type !== fType)  return false;
    if (fActive === "active"   && !r.is_active) return false;
    if (fActive === "inactive" &&  r.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.code?.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q) || r.country?.toLowerCase().includes(q);
    }
    return true;
  });

  function openCreate() { setEditId(null); setForm(emptyCarrierForm()); setDialogOpen(true); }
  function openEdit(r: Carrier) {
    setEditId(r.id);
    setForm({ code: r.code, name: r.name, carrier_type: r.carrier_type ?? "shipping_line", country: r.country ?? "", country_code: r.country_code ?? "", logo_url: r.logo_url ?? "", notes: r.notes ?? "", is_active: r.is_active !== false, sort_order: String(r.sort_order ?? 0) });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.code || !form.name) { toast({ title: "Code dan name wajib diisi", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editId ? `/api/ocean-freight-master/carriers/${editId}` : "/api/ocean-freight-master/carriers";
      const res = await fetch(url, { method: editId ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal simpan");
      qc.invalidateQueries({ queryKey: ["of-carriers"] });
      setDialogOpen(false);
      toast({ title: editId ? "Carrier diperbarui" : "Carrier ditambahkan" });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/ocean-freight-master/carriers/${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["of-carriers"] });
    setDeleteId(null);
    toast({ title: "Carrier dihapus" });
  }

  function F(key: keyof CarrierForm) {
    return { value: form[key] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })) };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3 flex-wrap flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Cari carrier code / nama..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-52" />
          </div>
          <Select value={fType} onValueChange={setFType}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Carrier Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Type</SelectItem>
              {CARRIER_TYPES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fActive} onValueChange={setFActive}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 ml-3">
          <Button variant="outline" size="sm" aria-label="Segarkan" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
          <CsvButtons />
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Tambah</Button>
        </div>
      </div>
      <p className="text-xs text-gray-400">{filtered.length} dari {allRows.length} carrier</p>

      <QueryState loading={isLoading} skeletonRows={5}>
        <div className="bg-white rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-gray-400">Tidak ada data</TableCell></TableRow>
              ) : filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-bold text-blue-700">{r.code}</TableCell>
                  <TableCell className="font-medium text-sm">{r.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">{CARRIER_TYPES.find(t => t.v === r.carrier_type)?.l ?? r.carrier_type}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {r.country_code && <span className="font-mono text-xs bg-gray-100 px-1 rounded mr-1">{r.country_code}</span>}{r.country}
                  </TableCell>
                  <TableCell><ActiveBadge v={r.is_active} /></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => openEdit(r)}><Pencil className="w-4 h-4 text-blue-500" /></Button>
                      <Button size="sm" variant="ghost" aria-label="Hapus" onClick={() => setDeleteId(r.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </QueryState>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit Carrier" : "Tambah Carrier"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label>Carrier Code <span className="text-red-500">*</span></Label>
              <Input {...F("code")} placeholder="CMA" className="uppercase" disabled={!!editId} />
            </div>
            <div>
              <Label>Carrier Name <span className="text-red-500">*</span></Label>
              <Input {...F("name")} placeholder="CMA CGM" />
            </div>
            <div>
              <Label>Carrier Type</Label>
              <select {...F("carrier_type")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                {CARRIER_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div>
              <Label>Country</Label>
              <Input {...F("country")} placeholder="France" />
            </div>
            <div>
              <Label>Country Code</Label>
              <Input {...F("country_code")} placeholder="FR" maxLength={2} className="uppercase" />
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input type="number" {...F("sort_order")} />
            </div>
            <div className="col-span-2">
              <Label>Logo URL <span className="text-gray-400">(opsional)</span></Label>
              <Input {...F("logo_url")} placeholder="https://..." />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea {...F("notes")} rows={2} />
            </div>
            <div className="flex items-center gap-3 col-span-2">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white">{saving ? "Menyimpan..." : editId ? "Update" : "Tambah"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus Carrier?</AlertDialogTitle><AlertDialogDescription>Carrier ini akan dihapus permanen.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white" onClick={() => deleteId && handleDelete(deleteId)}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Container Types Tab ──────────────────────────────────────────────────────

type ContainerForm = { code: string; name: string; teu: string; max_cbm: string; max_payload_kg: string; is_reefer: boolean; is_special: boolean; is_active: boolean; sort_order: string; notes: string };
const emptyContainerForm = (): ContainerForm => ({ code: "", name: "", teu: "1", max_cbm: "", max_payload_kg: "", is_reefer: false, is_special: false, is_active: true, sort_order: "0", notes: "" });

function ContainerTypesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch]       = useState("");
  const [fActive, setFActive]     = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId]       = useState<number | null>(null);
  const [deleteId, setDeleteId]   = useState<number | null>(null);
  const [form, setForm]           = useState<ContainerForm>(emptyContainerForm());
  const [saving, setSaving]       = useState(false);
  const { CsvButtons } = useCsvIE(
    "/api/ocean-freight-master/container-types/export",
    "/api/ocean-freight-master/container-types/import",
    `freight-container-types-${new Date().toISOString().slice(0,10)}.csv`,
    "of-container-types"
  );

  const { data: rows = [], isLoading, refetch } = useQuery<ContainerType[]>({
    queryKey: ["of-container-types"],
    queryFn: () => fetch("/api/ocean-freight-master/container-types", { credentials: "include" }).then(r => r.json()),
  });

  const allRows = Array.isArray(rows) ? rows : [];
  const filtered = allRows.filter(r => {
    if (fActive === "active"   && !r.is_active) return false;
    if (fActive === "inactive" &&  r.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.code?.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q);
    }
    return true;
  });

  function openCreate() { setEditId(null); setForm(emptyContainerForm()); setDialogOpen(true); }
  function openEdit(r: ContainerType) {
    setEditId(r.id);
    setForm({ code: r.code, name: r.name, teu: String(r.teu ?? 1), max_cbm: r.max_cbm ? String(r.max_cbm) : "", max_payload_kg: r.max_payload_kg ? String(r.max_payload_kg) : "", is_reefer: r.is_reefer, is_special: r.is_special, is_active: r.is_active !== false, sort_order: String(r.sort_order ?? 0), notes: r.notes ?? "" });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.code || !form.name) { toast({ title: "Code dan name wajib diisi", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editId ? `/api/ocean-freight-master/container-types/${editId}` : "/api/ocean-freight-master/container-types";
      const res = await fetch(url, { method: editId ? "PUT" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal simpan");
      qc.invalidateQueries({ queryKey: ["of-container-types"] });
      setDialogOpen(false);
      toast({ title: editId ? "Container type diperbarui" : "Container type ditambahkan" });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/ocean-freight-master/container-types/${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["of-container-types"] });
    setDeleteId(null);
    toast({ title: "Container type dihapus" });
  }

  function F(key: keyof ContainerForm) {
    return { value: form[key] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value })) };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3 flex-wrap flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Cari container code / nama..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-52" />
          </div>
          <Select value={fActive} onValueChange={setFActive}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 ml-3">
          <Button variant="outline" size="sm" aria-label="Segarkan" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
          <CsvButtons />
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Tambah</Button>
        </div>
      </div>
      <p className="text-xs text-gray-400">{filtered.length} dari {allRows.length} container type</p>

      <QueryState loading={isLoading} skeletonRows={5}>
        <div className="bg-white rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-center">TEU (Size)</TableHead>
                <TableHead className="text-center">Max Payload (kg)</TableHead>
                <TableHead className="text-center">Volume CBM</TableHead>
                <TableHead className="text-center">Reefer</TableHead>
                <TableHead className="text-center">Special</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-10 text-gray-400">Tidak ada data</TableCell></TableRow>
              ) : filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-bold text-blue-700">{r.code}</TableCell>
                  <TableCell className="text-sm">{r.name}</TableCell>
                  <TableCell className="text-center text-sm font-semibold">{Number(r.teu ?? 1).toFixed(2)}</TableCell>
                  <TableCell className="text-center text-sm">{r.max_payload_kg ? Number(r.max_payload_kg).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-center text-sm">{r.max_cbm ? Number(r.max_cbm).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-center">
                    {r.is_reefer ? <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">Reefer</Badge> : <span className="text-gray-300 text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {r.is_special ? <Badge className="bg-purple-50 text-purple-700 border-purple-200 text-xs">Special</Badge> : <span className="text-gray-300 text-xs">—</span>}
                  </TableCell>
                  <TableCell><ActiveBadge v={r.is_active} /></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => openEdit(r)}><Pencil className="w-4 h-4 text-blue-500" /></Button>
                      <Button size="sm" variant="ghost" aria-label="Hapus" onClick={() => setDeleteId(r.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </QueryState>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit Container Type" : "Tambah Container Type"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label>Container Code <span className="text-red-500">*</span></Label>
              <Input {...F("code")} placeholder="20ft" disabled={!!editId} />
            </div>
            <div>
              <Label>Container Name <span className="text-red-500">*</span></Label>
              <Input {...F("name")} placeholder="20ft GP (General Purpose)" />
            </div>
            <div>
              <Label>TEU (Size)</Label>
              <Input type="number" step="0.25" {...F("teu")} />
            </div>
            <div>
              <Label>Max Payload (kg)</Label>
              <Input type="number" {...F("max_payload_kg")} placeholder="21800" />
            </div>
            <div>
              <Label>Volume CBM</Label>
              <Input type="number" {...F("max_cbm")} placeholder="25" />
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input type="number" {...F("sort_order")} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_reefer} onCheckedChange={v => setForm(f => ({ ...f, is_reefer: v }))} />
              <Label>Reefer</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_special} onCheckedChange={v => setForm(f => ({ ...f, is_special: v }))} />
              <Label>Special Type</Label>
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea {...F("notes")} rows={2} />
            </div>
            <div className="flex items-center gap-3 col-span-2">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white">{saving ? "Menyimpan..." : editId ? "Update" : "Tambah"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus Container Type?</AlertDialogTitle><AlertDialogDescription>Container type ini akan dihapus permanen.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white" onClick={() => deleteId && handleDelete(deleteId)}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OceanFreightMasterDataPage() {
  return (
    <AppShell>
      <BackButton href="/logistics" />
      <div className="p-6 space-y-5">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <Anchor className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">Ocean Freight Master Data</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Manajemen master data: Route Matrix, Ports, Carriers, Container Types</p>
        </div>

        <Tabs defaultValue="route-matrix">
          <TabsList className="bg-gray-100">
            <TabsTrigger value="route-matrix" className="flex items-center gap-1.5">
              <Route className="w-4 h-4" /> Route Matrix
            </TabsTrigger>
            <TabsTrigger value="ports" className="flex items-center gap-1.5">
              <Anchor className="w-4 h-4" /> Ports
            </TabsTrigger>
            <TabsTrigger value="carriers" className="flex items-center gap-1.5">
              <Ship className="w-4 h-4" /> Carriers
            </TabsTrigger>
            <TabsTrigger value="container-types" className="flex items-center gap-1.5">
              <Box className="w-4 h-4" /> Container Types
            </TabsTrigger>
          </TabsList>
          <TabsContent value="route-matrix" className="mt-4">
            <RouteMatrixTab />
          </TabsContent>
          <TabsContent value="ports" className="mt-4">
            <PortsTab />
          </TabsContent>
          <TabsContent value="carriers" className="mt-4">
            <CarriersTab />
          </TabsContent>
          <TabsContent value="container-types" className="mt-4">
            <ContainerTypesTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
