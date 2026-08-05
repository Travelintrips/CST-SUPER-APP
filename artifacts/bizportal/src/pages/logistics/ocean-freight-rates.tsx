import { DatePicker } from "@/components/ui/date-picker";
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  DollarSign, Plus, Pencil, Trash2, Search, RefreshCw,
  Copy, Power, Eye, ChevronDown, ChevronUp, Download, Upload, ArrowLeft,
} from "lucide-react";
import { QueryState } from "@/components/ui/query-state";
import { BackButton } from "@/components/ui/back-button";

const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n);

const RATE_SOURCE_TYPES = [
  { v: "shipping_line", l: "Shipping Line" },
  { v: "nvocc",         l: "NVOCC" },
  { v: "coloader",      l: "Co-Loader" },
  { v: "forwarder_partner", l: "Forwarder Partner" },
  { v: "internal_rate", l: "Internal Rate" },
  { v: "vendor_rate",   l: "Vendor Rate" },
];
const SHIPMENT_TYPES  = ["FCL", "LCL"];
const SERVICE_MODES   = ["port_to_port","door_to_port","port_to_door","door_to_door"];
const CONTAINER_TYPES = ["20ft","40ft","40HC","reefer_20","reefer_40","open_top","flat_rack","45HC","tank"];
const TRADE_TYPES     = ["domestic","export","import","cross_border"];
const CURRENCIES      = ["USD","IDR","SGD","EUR","CNY"];
const DIRECT_OPTS     = ["direct","transshipment"];
const PRICE_STATUSES  = ["estimate","confirmed"];

const emptyForm = () => ({
  rate_code: "", rate_source_type: "shipping_line", rate_source_name: "", carrier_name: "",
  origin_city: "", origin_port: "", destination_city: "", destination_port: "",
  trade_type: "export", shipment_type: "FCL", service_mode: "port_to_port", container_type: "20ft",
  currency: "USD", exchange_rate_to_idr: "16500", ocean_freight_amount: "0",
  lcl_rate_per_cbm: "", lcl_minimum_cbm: "",
  thc_origin: "0", thc_destination: "0", doc_fee: "0", bl_fee: "0", do_fee: "0",
  handling_fee: "0", customs_clearance_fee: "0", trucking_pickup_estimate: "0",
  trucking_delivery_estimate: "0", insurance_percent: "0", dg_surcharge_percent: "0",
  reefer_surcharge: "0", peak_season_surcharge: "0", emergency_bunker_surcharge: "0",
  currency_adjustment_factor: "0",
  valid_from: new Date().toISOString().slice(0, 10),
  valid_until: new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10),
  transit_days: "", carrier: "", vessel_name: "", voyage: "",
  direct_or_transshipment: "direct", price_status: "estimate", notes: "", is_active: true,
});

type FormData = ReturnType<typeof emptyForm>;
type Rate     = Record<string, any>;

function sourceTypeLabel(v: string) {
  return RATE_SOURCE_TYPES.find(t => t.v === v)?.l ?? v;
}

export default function OceanFreightRatesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search,          setSearch]          = useState("");
  const [fOrigin,         setFOrigin]         = useState("all");
  const [fDest,           setFDest]           = useState("all");
  const [fShipment,       setFShipment]       = useState("all");
  const [fContainer,      setFContainer]      = useState("all");
  const [fCurrency,       setFCurrency]       = useState("all");
  const [fPriceStatus,    setFPriceStatus]    = useState("all");
  const [fActiveStatus,   setFActiveStatus]   = useState("all");
  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [viewOpen,        setViewOpen]        = useState(false);
  const [deleteId,        setDeleteId]        = useState<number | null>(null);
  const [editId,          setEditId]          = useState<number | null>(null);
  const [viewRate,        setViewRate]        = useState<Rate | null>(null);
  const [form,            setForm]            = useState<FormData>(emptyForm());
  const [saving,          setSaving]          = useState(false);
  const [sortCol,         setSortCol]         = useState<string>("origin_port");
  const [sortDir,         setSortDir]         = useState<"asc"|"desc">("asc");
  const [importing,       setImporting]       = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const { data: rates = [], isLoading, refetch } = useQuery<Rate[]>({
    queryKey: ["ocean-freight-rates"],
    queryFn: () => fetch("/api/ocean-freight-rates", { credentials: "include" }).then(r => r.json()),
  });

  const today = new Date().toISOString().slice(0, 10);

  const originPorts  = [...new Set(rates.map((r: Rate) => r.origin_port).filter(Boolean))].sort();
  const destPorts    = [...new Set(rates.map((r: Rate) => r.destination_port).filter(Boolean))].sort();

  const filtered = rates.filter((r: Rate) => {
    if (fOrigin      !== "all" && r.origin_port      !== fOrigin)      return false;
    if (fDest        !== "all" && r.destination_port !== fDest)        return false;
    if (fShipment    !== "all" && r.shipment_type    !== fShipment)    return false;
    if (fContainer   !== "all" && r.container_type   !== fContainer)   return false;
    if (fCurrency    !== "all" && r.currency         !== fCurrency)    return false;
    if (fPriceStatus !== "all" && r.price_status     !== fPriceStatus) return false;
    if (fActiveStatus === "active"   && !r.is_active) return false;
    if (fActiveStatus === "inactive" && r.is_active)  return false;
    if (fActiveStatus === "expired"  && r.valid_until >= today) return false;
    if (search) {
      const q = search.toLowerCase();
      return (r.rate_code?.toLowerCase().includes(q))
          || (r.origin_port?.toLowerCase().includes(q))
          || (r.destination_port?.toLowerCase().includes(q))
          || (r.rate_source_name?.toLowerCase().includes(q))
          || (r.carrier_name?.toLowerCase().includes(q))
          || (r.carrier?.toLowerCase().includes(q));
    }
    return true;
  }).sort((a: Rate, b: Rate) => {
    const av = String(a[sortCol] ?? "");
    const bv = String(b[sortCol] ?? "");
    return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortCol !== col) return null;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />;
  }

  function openCreate() { setEditId(null); setForm(emptyForm()); setDialogOpen(true); }

  function openEdit(r: Rate) {
    setEditId(r.id);
    setForm({
      rate_code: r.rate_code ?? "", rate_source_type: r.rate_source_type ?? "shipping_line",
      rate_source_name: r.rate_source_name ?? "", carrier_name: r.carrier_name ?? "",
      origin_city: r.origin_city ?? "", origin_port: r.origin_port ?? "",
      destination_city: r.destination_city ?? "", destination_port: r.destination_port ?? "",
      trade_type: r.trade_type ?? "export", shipment_type: r.shipment_type ?? "FCL",
      service_mode: r.service_mode ?? "port_to_port", container_type: r.container_type ?? "20ft",
      currency: r.currency ?? "USD", exchange_rate_to_idr: String(r.exchange_rate_to_idr ?? 16500),
      ocean_freight_amount: String(r.ocean_freight_amount ?? 0),
      lcl_rate_per_cbm: r.lcl_rate_per_cbm ? String(r.lcl_rate_per_cbm) : "",
      lcl_minimum_cbm: r.lcl_minimum_cbm ? String(r.lcl_minimum_cbm) : "",
      thc_origin: String(r.thc_origin ?? 0), thc_destination: String(r.thc_destination ?? 0),
      doc_fee: String(r.doc_fee ?? 0), bl_fee: String(r.bl_fee ?? 0),
      do_fee: String(r.do_fee ?? 0), handling_fee: String(r.handling_fee ?? 0),
      customs_clearance_fee: String(r.customs_clearance_fee ?? 0),
      trucking_pickup_estimate: String(r.trucking_pickup_estimate ?? 0),
      trucking_delivery_estimate: String(r.trucking_delivery_estimate ?? 0),
      insurance_percent: String(r.insurance_percent ?? 0),
      dg_surcharge_percent: String(r.dg_surcharge_percent ?? 0),
      reefer_surcharge: String(r.reefer_surcharge ?? 0),
      peak_season_surcharge: String(r.peak_season_surcharge ?? 0),
      emergency_bunker_surcharge: String(r.emergency_bunker_surcharge ?? 0),
      currency_adjustment_factor: String(r.currency_adjustment_factor ?? 0),
      valid_from: r.valid_from?.slice(0, 10) ?? today,
      valid_until: r.valid_until?.slice(0, 10) ?? "",
      transit_days: String(r.transit_days ?? ""), carrier: r.carrier ?? "",
      vessel_name: r.vessel_name ?? "", voyage: r.voyage ?? "",
      direct_or_transshipment: r.direct_or_transshipment ?? "direct",
      price_status: r.price_status ?? "estimate", notes: r.notes ?? "",
      is_active: r.is_active !== false,
    });
    setDialogOpen(true);
  }

  function openDuplicate(r: Rate) {
    setEditId(null);
    setForm({
      rate_code: "", rate_source_type: r.rate_source_type ?? "shipping_line",
      rate_source_name: r.rate_source_name ?? "", carrier_name: r.carrier_name ?? "",
      origin_city: r.origin_city ?? "", origin_port: r.origin_port ?? "",
      destination_city: r.destination_city ?? "", destination_port: r.destination_port ?? "",
      trade_type: r.trade_type ?? "export", shipment_type: r.shipment_type ?? "FCL",
      service_mode: r.service_mode ?? "port_to_port", container_type: r.container_type ?? "20ft",
      currency: r.currency ?? "USD", exchange_rate_to_idr: String(r.exchange_rate_to_idr ?? 16500),
      ocean_freight_amount: String(r.ocean_freight_amount ?? 0),
      lcl_rate_per_cbm: r.lcl_rate_per_cbm ? String(r.lcl_rate_per_cbm) : "",
      lcl_minimum_cbm: r.lcl_minimum_cbm ? String(r.lcl_minimum_cbm) : "",
      thc_origin: String(r.thc_origin ?? 0), thc_destination: String(r.thc_destination ?? 0),
      doc_fee: String(r.doc_fee ?? 0), bl_fee: String(r.bl_fee ?? 0),
      do_fee: String(r.do_fee ?? 0), handling_fee: String(r.handling_fee ?? 0),
      customs_clearance_fee: String(r.customs_clearance_fee ?? 0),
      trucking_pickup_estimate: String(r.trucking_pickup_estimate ?? 0),
      trucking_delivery_estimate: String(r.trucking_delivery_estimate ?? 0),
      insurance_percent: String(r.insurance_percent ?? 0),
      dg_surcharge_percent: String(r.dg_surcharge_percent ?? 0),
      reefer_surcharge: String(r.reefer_surcharge ?? 0),
      peak_season_surcharge: String(r.peak_season_surcharge ?? 0),
      emergency_bunker_surcharge: String(r.emergency_bunker_surcharge ?? 0),
      currency_adjustment_factor: String(r.currency_adjustment_factor ?? 0),
      valid_from: today,
      valid_until: new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10),
      transit_days: String(r.transit_days ?? ""), carrier: r.carrier ?? "",
      vessel_name: r.vessel_name ?? "", voyage: r.voyage ?? "",
      direct_or_transshipment: r.direct_or_transshipment ?? "direct",
      price_status: r.price_status ?? "estimate", notes: r.notes ?? "",
      is_active: true,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.currency) { toast({ title: "Currency wajib diisi", variant: "destructive" }); return; }
    if (form.currency !== "IDR" && (!form.exchange_rate_to_idr || Number(form.exchange_rate_to_idr) <= 0)) {
      toast({ title: "Exchange rate wajib diisi jika currency bukan IDR", variant: "destructive" }); return;
    }
    if (form.valid_until && form.valid_from && form.valid_until < form.valid_from) {
      toast({ title: "Valid until harus ≥ valid from", variant: "destructive" }); return;
    }
    if (form.shipment_type === "FCL" && !form.container_type) {
      toast({ title: "Container type wajib untuk FCL", variant: "destructive" }); return;
    }
    if (form.shipment_type === "LCL" && (!form.lcl_rate_per_cbm || Number(form.lcl_rate_per_cbm) <= 0)) {
      toast({ title: "LCL rate per CBM wajib untuk LCL", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const url    = editId ? `/api/ocean-freight-rates/${editId}` : "/api/ocean-freight-rates";
      const method = editId ? "PUT" : "POST";
      const res    = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal simpan");
      qc.invalidateQueries({ queryKey: ["ocean-freight-rates"] });
      setDialogOpen(false);
      toast({ title: editId ? "Rate diperbarui" : "Rate ditambahkan" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/ocean-freight-rates/${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["ocean-freight-rates"] });
    setDeleteId(null);
    toast({ title: "Rate dihapus" });
  }

  async function handleToggleActive(r: Rate) {
    const payload = { ...r, is_active: !r.is_active };
    await fetch(`/api/ocean-freight-rates/${r.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    qc.invalidateQueries({ queryKey: ["ocean-freight-rates"] });
    toast({ title: r.is_active ? "Rate dinonaktifkan" : "Rate diaktifkan" });
  }

  function F(key: keyof FormData) {
    return {
      value: form[key] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setForm(f => ({ ...f, [key]: e.target.value })),
    };
  }

  async function handleExport() {
    try {
      const res = await fetch("/api/ocean-freight-rates/export", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ocean-freight-rates-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Export gagal", description: e.message, variant: "destructive" });
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/ocean-freight-rates/import", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal import");
      qc.invalidateQueries({ queryKey: ["ocean-freight-rates"] });
      const errMsg = d.errors?.length ? ` (${d.errors.length} error)` : "";
      toast({ title: `Import selesai: ${d.processed ?? d.total} baris diproses${errMsg}` });
    } catch (e: any) {
      toast({ title: "Import gagal", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  const stats = {
    total:    rates.length,
    active:   rates.filter((r: Rate) => r.is_active).length,
    expired:  rates.filter((r: Rate) => r.valid_until < today).length,
    fcl:      rates.filter((r: Rate) => r.shipment_type === "FCL").length,
    lcl:      rates.filter((r: Rate) => r.shipment_type === "LCL").length,
  };

  return (
    <AppShell>
      <BackButton href="/logistics" />
      <div className="p-6 space-y-5">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-blue-600" />
              <h1 className="text-xl font-bold text-gray-900">Ocean Freight Rates</h1>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">Manajemen rate ocean freight — FCL & LCL</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} title="Export CSV">
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
            <Button variant="outline" size="sm" disabled={importing} onClick={() => importRef.current?.click()} title="Import CSV">
              <Upload className="w-4 h-4 mr-1" /> {importing ? "Importing..." : "Import"}
            </Button>
            <input ref={importRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); }} />
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1" /> Tambah Rate
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: "Total Rate", value: stats.total, color: "text-gray-700" },
            { label: "Active",     value: stats.active,  color: "text-green-600" },
            { label: "Expired",    value: stats.expired, color: "text-red-500" },
            { label: "FCL",        value: stats.fcl,     color: "text-blue-600" },
            { label: "LCL",        value: stats.lcl,     color: "text-purple-600" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Cari rate code / port / carrier..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={fOrigin} onValueChange={setFOrigin}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Origin Port" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Origin</SelectItem>
                {originPorts.map((p: string) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={fDest} onValueChange={setFDest}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Destination Port" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Destination</SelectItem>
                {destPorts.map((p: string) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3 flex-wrap">
            <Select value={fShipment} onValueChange={setFShipment}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Type</SelectItem>
                {SHIPMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={fContainer} onValueChange={setFContainer}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Container</SelectItem>
                {CONTAINER_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={fCurrency} onValueChange={setFCurrency}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Currency</SelectItem>
                {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={fPriceStatus} onValueChange={setFPriceStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Price Status</SelectItem>
                <SelectItem value="estimate">Estimate</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={fActiveStatus} onValueChange={setFActiveStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>

            {(fOrigin !== "all" || fDest !== "all" || fShipment !== "all" || fContainer !== "all" || fCurrency !== "all" || fPriceStatus !== "all" || fActiveStatus !== "all" || search) && (
              <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => {
                setSearch(""); setFOrigin("all"); setFDest("all"); setFShipment("all");
                setFContainer("all"); setFCurrency("all"); setFPriceStatus("all"); setFActiveStatus("all");
              }}>
                Reset Filter
              </Button>
            )}
          </div>
          <p className="text-xs text-gray-400">Menampilkan {filtered.length} dari {rates.length} rate</p>
        </div>

        {/* Table */}
        <QueryState
          loading={isLoading}
          empty={filtered.length === 0}
          emptyMessage="Tidak ada rate ditemukan"
          emptyIcon={<DollarSign className="w-10 h-10 opacity-30" />}
        >
          <div className="bg-white rounded-xl border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="cursor-pointer whitespace-nowrap" onClick={() => toggleSort("rate_code")}>
                    Rate Code <SortIcon col="rate_code" />
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("rate_source_name")}>
                    Sumber <SortIcon col="rate_source_name" />
                  </TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead className="cursor-pointer whitespace-nowrap" onClick={() => toggleSort("origin_port")}>
                    Rute <SortIcon col="origin_port" />
                  </TableHead>
                  <TableHead>Shipment</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("currency")}>
                    Currency <SortIcon col="currency" />
                  </TableHead>
                  <TableHead className="cursor-pointer whitespace-nowrap" onClick={() => toggleSort("ocean_freight_amount")}>
                    Ocean Freight <SortIcon col="ocean_freight_amount" />
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Transit Days</TableHead>
                  <TableHead className="whitespace-nowrap">Valid Until</TableHead>
                  <TableHead>Price Status</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r: Rate) => {
                  const isExpired = r.valid_until < today;
                  const totalEst  = [r.ocean_freight_amount, r.thc_origin, r.thc_destination, r.doc_fee, r.bl_fee, r.do_fee, r.handling_fee]
                    .reduce((s, v) => s + Number(v ?? 0), 0);
                  const totalIdr  = r.currency === "IDR" ? totalEst : totalEst * Number(r.exchange_rate_to_idr ?? 16500);
                  return (
                    <TableRow key={r.id} className={!r.is_active || isExpired ? "opacity-60" : ""}>
                      <TableCell className="font-mono text-xs text-gray-600">
                        {r.rate_code ?? <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-sm text-gray-800">{r.rate_source_name}</p>
                        <p className="text-xs text-gray-400">{sourceTypeLabel(r.rate_source_type)}</p>
                      </TableCell>
                      <TableCell className="text-sm">{r.carrier_name ?? r.carrier ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <p className="text-sm font-medium">{r.origin_port} → {r.destination_port}</p>
                        <p className="text-xs text-gray-400 capitalize">{r.trade_type?.replace(/_/g, " ")}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{r.shipment_type}</Badge>
                        <p className="text-xs text-gray-400 mt-0.5 capitalize">{r.service_mode?.replace(/_/g, " ")}</p>
                      </TableCell>
                      <TableCell className="text-xs font-medium">{r.container_type ?? <span className="text-gray-300">LCL</span>}</TableCell>
                      <TableCell className="text-xs font-semibold text-blue-700">{r.currency}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.shipment_type === "LCL" ? (
                          <div>
                            <p className="text-xs font-semibold">{r.currency} {Number(r.lcl_rate_per_cbm ?? 0).toLocaleString()}/CBM</p>
                            <p className="text-xs text-gray-400">Min: {r.lcl_minimum_cbm ?? "—"} CBM</p>
                          </div>
                        ) : (
                          <div>
                            <p className="font-semibold text-sm">{r.currency} {Number(r.ocean_freight_amount ?? 0).toLocaleString()}</p>
                            <p className="text-xs text-gray-400">≈ {IDR(totalIdr)}</p>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-center">
                        {r.transit_days ? `${r.transit_days}d` : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <p className={isExpired ? "text-red-500 font-medium" : "text-gray-600"}>{r.valid_until?.slice(0, 10)}</p>
                        {isExpired && <Badge className="bg-red-50 text-red-500 border-red-200 text-xs mt-0.5">Expired</Badge>}
                      </TableCell>
                      <TableCell>
                        <Badge className={r.price_status === "confirmed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-yellow-50 text-yellow-700 border-yellow-200"}>
                          {r.price_status === "confirmed" ? "Confirmed" : "Estimate"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={r.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500"}>
                          {r.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" title="View" onClick={() => { setViewRate(r); setViewOpen(true); }}>
                            <Eye className="w-4 h-4 text-gray-500" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Edit" onClick={() => openEdit(r)}>
                            <Pencil className="w-4 h-4 text-blue-500" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Duplicate" onClick={() => openDuplicate(r)}>
                            <Copy className="w-4 h-4 text-purple-500" />
                          </Button>
                          <Button size="sm" variant="ghost" title={r.is_active ? "Nonaktifkan" : "Aktifkan"} onClick={() => handleToggleActive(r)}>
                            <Power className={`w-4 h-4 ${r.is_active ? "text-yellow-500" : "text-green-500"}`} />
                          </Button>
                          <Button size="sm" variant="ghost" title="Hapus" onClick={() => setDeleteId(r.id)}
                            className="text-red-400 hover:text-red-600 hover:bg-red-50">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </QueryState>

        {/* View Dialog */}
        <Dialog open={viewOpen} onOpenChange={setViewOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detail Rate — {viewRate?.rate_code ?? "—"}</DialogTitle>
            </DialogHeader>
            {viewRate && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Rate Code", viewRate.rate_code ?? "—"],
                    ["Source Type", sourceTypeLabel(viewRate.rate_source_type)],
                    ["Source Name", viewRate.rate_source_name],
                    ["Carrier", viewRate.carrier_name ?? viewRate.carrier ?? "—"],
                    ["Route", `${viewRate.origin_port} → ${viewRate.destination_port}`],
                    ["Trade Type", viewRate.trade_type],
                    ["Shipment Type", viewRate.shipment_type],
                    ["Service Mode", viewRate.service_mode?.replace(/_/g, " ")],
                    ["Container Type", viewRate.container_type ?? "—"],
                    ["Currency", viewRate.currency],
                    ["Exchange Rate", viewRate.currency !== "IDR" ? `1 ${viewRate.currency} = IDR ${Number(viewRate.exchange_rate_to_idr).toLocaleString()}` : "—"],
                    ["Ocean Freight", viewRate.shipment_type === "LCL" ? `${viewRate.currency} ${Number(viewRate.lcl_rate_per_cbm).toLocaleString()}/CBM (min ${viewRate.lcl_minimum_cbm} CBM)` : `${viewRate.currency} ${Number(viewRate.ocean_freight_amount).toLocaleString()}`],
                    ["THC Origin", `${viewRate.currency} ${Number(viewRate.thc_origin ?? 0).toLocaleString()}`],
                    ["THC Destination", `${viewRate.currency} ${Number(viewRate.thc_destination ?? 0).toLocaleString()}`],
                    ["Doc Fee", `${viewRate.currency} ${Number(viewRate.doc_fee ?? 0).toLocaleString()}`],
                    ["B/L Fee", `${viewRate.currency} ${Number(viewRate.bl_fee ?? 0).toLocaleString()}`],
                    ["D/O Fee", `${viewRate.currency} ${Number(viewRate.do_fee ?? 0).toLocaleString()}`],
                    ["Handling Fee", `${viewRate.currency} ${Number(viewRate.handling_fee ?? 0).toLocaleString()}`],
                    ["Valid From", viewRate.valid_from?.slice(0, 10)],
                    ["Valid Until", viewRate.valid_until?.slice(0, 10)],
                    ["Transit Days", viewRate.transit_days ? `${viewRate.transit_days} hari` : "—"],
                    ["Direct/Transshipment", viewRate.direct_or_transshipment],
                    ["Price Status", viewRate.price_status],
                    ["Active", viewRate.is_active ? "Ya" : "Tidak"],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex flex-col">
                      <span className="text-xs text-gray-400">{k}</span>
                      <span className="font-medium">{v}</span>
                    </div>
                  ))}
                </div>
                {viewRate.notes && (
                  <div>
                    <span className="text-xs text-gray-400 block">Notes</span>
                    <p className="text-gray-700 mt-1">{viewRate.notes}</p>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewOpen(false)}>Tutup</Button>
              <Button onClick={() => { setViewOpen(false); if (viewRate) openEdit(viewRate); }}>
                <Pencil className="w-4 h-4 mr-1" /> Edit Rate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editId ? "Edit Rate" : "Tambah Rate Baru"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">

              {/* Source */}
              <div className="col-span-2 font-semibold text-xs text-gray-500 uppercase tracking-wide mt-1">Informasi Sumber</div>
              <div>
                <Label>Rate Source Type</Label>
                <select {...F("rate_source_type")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                  {RATE_SOURCE_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div>
                <Label>Rate Source Name</Label>
                <Input {...F("rate_source_name")} placeholder="Samudera / CMA CGM / ..." />
              </div>
              <div>
                <Label>Carrier Name</Label>
                <Input {...F("carrier_name")} placeholder="Nama carrier" />
              </div>
              <div>
                <Label>Rate Code <span className="text-gray-400">(opsional)</span></Label>
                <Input {...F("rate_code")} placeholder="PRIOK-SG-20FT" />
              </div>

              {/* Route */}
              <div className="col-span-2 font-semibold text-xs text-gray-500 uppercase tracking-wide mt-1">Rute</div>
              <div>
                <Label>Origin City</Label>
                <Input {...F("origin_city")} placeholder="Jakarta" />
              </div>
              <div>
                <Label>Origin Port (POL)</Label>
                <Input {...F("origin_port")} placeholder="Tanjung Priok" />
              </div>
              <div>
                <Label>Destination City</Label>
                <Input {...F("destination_city")} placeholder="Singapore" />
              </div>
              <div>
                <Label>Destination Port (POD)</Label>
                <Input {...F("destination_port")} placeholder="PSA Singapore" />
              </div>

              {/* Type */}
              <div className="col-span-2 font-semibold text-xs text-gray-500 uppercase tracking-wide mt-1">Tipe Pengiriman</div>
              <div>
                <Label>Trade Type</Label>
                <select {...F("trade_type")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                  {TRADE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label>Shipment Type</Label>
                <select {...F("shipment_type")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                  {SHIPMENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label>Service Mode</Label>
                <select {...F("service_mode")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                  {SERVICE_MODES.map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              {form.shipment_type === "FCL" && (
                <div>
                  <Label>Container Type <span className="text-red-500">*</span></Label>
                  <select {...F("container_type")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                    {CONTAINER_TYPES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              )}

              {/* Pricing */}
              <div className="col-span-2 font-semibold text-xs text-gray-500 uppercase tracking-wide mt-1">Harga</div>
              <div>
                <Label>Currency <span className="text-red-500">*</span></Label>
                <select {...F("currency")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <Label>Exchange Rate to IDR {form.currency !== "IDR" && <span className="text-red-500">*</span>}</Label>
                <Input type="number" {...F("exchange_rate_to_idr")} disabled={form.currency === "IDR"} />
              </div>

              {form.shipment_type === "FCL" ? (
                <div className="col-span-2">
                  <Label>Ocean Freight Amount ({form.currency}) <span className="text-red-500">*</span></Label>
                  <Input type="number" {...F("ocean_freight_amount")} />
                </div>
              ) : (
                <>
                  <div>
                    <Label>LCL Rate per CBM ({form.currency}) <span className="text-red-500">*</span></Label>
                    <Input type="number" {...F("lcl_rate_per_cbm")} />
                  </div>
                  <div>
                    <Label>LCL Minimum CBM</Label>
                    <Input type="number" {...F("lcl_minimum_cbm")} />
                  </div>
                </>
              )}

              {/* Surcharges & Fees */}
              <div className="col-span-2 font-semibold text-xs text-gray-500 uppercase tracking-wide mt-1">Biaya Tambahan</div>
              {([
                ["THC Origin",         "thc_origin"],
                ["THC Dest",           "thc_destination"],
                ["Doc Fee",            "doc_fee"],
                ["B/L Fee",            "bl_fee"],
                ["D/O Fee",            "do_fee"],
                ["Handling Fee",       "handling_fee"],
                ["Customs Clearance",  "customs_clearance_fee"],
                ["Trucking Pickup",    "trucking_pickup_estimate"],
                ["Trucking Delivery",  "trucking_delivery_estimate"],
                ["Insurance %",        "insurance_percent"],
                ["DG Surcharge %",     "dg_surcharge_percent"],
                ["Reefer Surcharge",   "reefer_surcharge"],
                ["Peak Season",        "peak_season_surcharge"],
                ["EBS",                "emergency_bunker_surcharge"],
                ["CAF",                "currency_adjustment_factor"],
              ] as [string, keyof FormData][]).map(([lbl, key]) => (
                <div key={key}>
                  <Label className="text-xs">{lbl}</Label>
                  <Input type="number" {...F(key)} />
                </div>
              ))}

              {/* Validity */}
              <div className="col-span-2 font-semibold text-xs text-gray-500 uppercase tracking-wide mt-1">Validitas & Status</div>
              <div>
                <Label>Valid From</Label>
                <DatePicker value={form.valid_from ?? ""} onChange={v => setForm((f: any) => ({ ...f, valid_from: v }))} />
              </div>
              <div>
                <Label>Valid Until</Label>
                <DatePicker value={form.valid_until ?? ""} onChange={v => setForm((f: any) => ({ ...f, valid_until: v }))} />
              </div>
              <div>
                <Label>Transit Days</Label>
                <Input type="number" {...F("transit_days")} />
              </div>
              <div>
                <Label>Direct / Transshipment</Label>
                <select {...F("direct_or_transshipment")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                  {DIRECT_OPTS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <Label>Vessel Name <span className="text-gray-400">(opsional)</span></Label>
                <Input {...F("vessel_name")} />
              </div>
              <div>
                <Label>Voyage <span className="text-gray-400">(opsional)</span></Label>
                <Input {...F("voyage")} />
              </div>
              <div>
                <Label>Price Status</Label>
                <select {...F("price_status")} className="w-full border border-gray-200 rounded-md px-2 py-2 text-sm">
                  {PRICE_STATUSES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3 pt-5">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}
                />
                <Label>Active</Label>
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea {...F("notes")} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
              <Button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white">
                {saving ? "Menyimpan..." : editId ? "Update Rate" : "Tambah Rate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <AlertDialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Rate?</AlertDialogTitle>
              <AlertDialogDescription>
                Rate ini akan dihapus permanen dan tidak bisa dikembalikan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && handleDelete(deleteId)}>
                Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
