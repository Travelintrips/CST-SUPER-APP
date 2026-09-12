import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Ship, Plus, Search, RefreshCw, ChevronLeft, ChevronRight,
  Pencil, Trash2, X, Check, AlertCircle, ArrowLeft,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

const fmt = (n: number | null | undefined) =>
  n == null ? "-" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(n));

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "-";
  try { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)); }
  catch { return d; }
};

const isExpired = (until: string | null | undefined) => !!until && new Date(until) < new Date();

const today = new Date().toISOString().slice(0, 10);
const in30d = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

const EMPTY: Record<string, any> = {
  rate_source_type: "shipping_line", rate_source_name: "", carrier_name: "",
  origin_city: "", origin_port: "", destination_city: "", destination_port: "",
  trade_type: "export", shipment_type: "FCL", service_mode: "port_to_port",
  container_type: "20ft", currency: "USD", exchange_rate_to_idr: 16500,
  ocean_freight_amount: 0, lcl_rate_per_cbm: 0, lcl_minimum_cbm: 1,
  thc_origin: 0, thc_destination: 0, doc_fee: 0, bl_fee: 0, do_fee: 0, handling_fee: 0,
  customs_clearance_fee: 0, trucking_pickup_estimate: 0, trucking_delivery_estimate: 0,
  insurance_percent: 0, dg_surcharge_percent: 0, reefer_surcharge: 0,
  peak_season_surcharge: 0, emergency_bunker_surcharge: 0, currency_adjustment_factor: 0,
  transit_days: "", direct_or_transshipment: "direct", valid_from: today, valid_until: in30d,
  price_status: "estimate", is_active: true, notes: "",
};

const CONTAINER_TYPES = ["20ft", "40ft", "40HC", "Reefer 20ft", "Reefer 40ft", "Open Top", "Flat Rack"];

function NumField({ label, name, form, setForm }: { label: string; name: string; form: any; setForm: any }) {
  return (
    <div>
      <Label className="text-gray-400 text-xs">{label}</Label>
      <Input type="number" min="0" step="any" value={form[name] ?? 0}
        onChange={(e) => setForm((p: any) => ({ ...p, [name]: e.target.value }))}
        className="bg-gray-800 border-gray-600 text-white h-8 text-sm" />
    </div>
  );
}

export default function OceanFreightRatesPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();

  const [search, setSearch]       = useState("");
  const [searchQ, setSearchQ]     = useState("");
  const [shipType, setShipType]   = useState("__all__");
  const [tradeType, setTradeType] = useState("__all__");
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage]           = useState(1);
  const LIMIT = 50;

  const [dlgOpen, setDlgOpen]     = useState(false);
  const [editId, setEditId]       = useState<number | null>(null);
  const [form, setForm]           = useState<any>({ ...EMPTY });
  const [formErr, setFormErr]     = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ocean-freight-rates", activeCompanyId, searchQ, shipType, tradeType, activeOnly, page],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (searchQ) qs.set("search", searchQ);
      if (shipType !== "__all__") qs.set("shipment_type", shipType);
      if (tradeType !== "__all__") qs.set("trade_type", tradeType);
      qs.set("active_only", String(activeOnly));
      qs.set("valid_only", "false");
      const r = await fetch(`/api/ocean-freight/rates?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const saveMut = useMutation({
    mutationFn: async (body: any) => {
      const url    = editId ? `/api/ocean-freight/rates/${editId}` : "/api/ocean-freight/rates";
      const method = editId ? "PUT" : "POST";
      const r = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Gagal menyimpan");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ocean-freight-rates"] }); setDlgOpen(false); },
    onError: (e: any) => setFormErr(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/ocean-freight/rates/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocean-freight-rates"] }),
  });

  const toggleMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/ocean-freight/rates/${id}/toggle`, { method: "PATCH", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocean-freight-rates"] }),
  });

  function openCreate() { setEditId(null); setForm({ ...EMPTY }); setFormErr(""); setDlgOpen(true); }
  function openEdit(r: any) {
    setEditId(r.id);
    setFormErr("");
    setForm({
      ...EMPTY,
      ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? EMPTY[k] ?? ""])),
      is_active: r.is_active ?? true,
      valid_from: r.valid_from?.slice(0, 10) ?? today,
      valid_until: r.valid_until?.slice(0, 10) ?? in30d,
    });
    setDlgOpen(true);
  }

  function handleSave() {
    setFormErr("");
    const payload = { ...form };
    ["exchange_rate_to_idr","ocean_freight_amount","lcl_rate_per_cbm","lcl_minimum_cbm",
     "thc_origin","thc_destination","doc_fee","bl_fee","do_fee","handling_fee",
     "customs_clearance_fee","trucking_pickup_estimate","trucking_delivery_estimate",
     "insurance_percent","dg_surcharge_percent","reefer_surcharge","peak_season_surcharge",
     "emergency_bunker_surcharge","currency_adjustment_factor",
    ].forEach((f) => { if (payload[f] !== "") payload[f] = Number(payload[f]); });
    if (payload.transit_days !== "") payload.transit_days = Number(payload.transit_days);
    else payload.transit_days = null;
    saveMut.mutate(payload);
  }

  const rates = data?.data ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <AppShell>
      <div className="p-6 space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Ship className="h-6 w-6 text-blue-400" />
            <div>
              <h1 className="text-xl font-semibold text-white">Ocean Freight Rates</h1>
              <p className="text-sm text-gray-400">{total} total rate</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="text-gray-300 border-gray-600">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-1" /> Tambah Rate
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex gap-2 flex-1 min-w-[200px]">
                <Input placeholder="Cari carrier, rute..." value={search} onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setSearchQ(search); setPage(1); } }}
                  className="bg-gray-800 border-gray-600 text-white h-9" />
                <Button variant="outline" className="border-gray-600 h-9" onClick={() => { setSearchQ(search); setPage(1); }}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
              <Select value={shipType} onValueChange={(v) => { setShipType(v); setPage(1); }}>
                <SelectTrigger className="w-32 bg-gray-800 border-gray-600 text-white h-9">
                  <SelectValue placeholder="Tipe" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="__all__">Semua Tipe</SelectItem>
                  <SelectItem value="FCL">FCL</SelectItem>
                  <SelectItem value="LCL">LCL</SelectItem>
                </SelectContent>
              </Select>
              <Select value={tradeType} onValueChange={(v) => { setTradeType(v); setPage(1); }}>
                <SelectTrigger className="w-36 bg-gray-800 border-gray-600 text-white h-9">
                  <SelectValue placeholder="Trade" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="__all__">Semua Trade</SelectItem>
                  <SelectItem value="export">Export</SelectItem>
                  <SelectItem value="import">Import</SelectItem>
                  <SelectItem value="domestic">Domestic</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
                <span className="text-sm text-gray-400">Aktif saja</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-0">
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400">
                    <th className="text-left p-3 font-medium">Sumber / Carrier</th>
                    <th className="text-left p-3 font-medium">Rute</th>
                    <th className="text-left p-3 font-medium">Tipe</th>
                    <th className="text-left p-3 font-medium">Ocean Freight</th>
                    <th className="text-left p-3 font-medium">THC O/D</th>
                    <th className="text-left p-3 font-medium">Transit</th>
                    <th className="text-left p-3 font-medium">Berlaku</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={9} className="text-center p-8 text-gray-500">Memuat...</td></tr>
                  ) : rates.length === 0 ? (
                    <tr><td colSpan={9} className="text-center p-8 text-gray-500">Tidak ada rate</td></tr>
                  ) : rates.map((r: any) => (
                    <tr key={r.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="p-3">
                        <div className="text-white text-sm font-medium">{r.rate_source_name || "-"}</div>
                        {r.carrier_name && <div className="text-gray-400 text-xs">{r.carrier_name}</div>}
                        <div className="text-gray-500 text-xs">{r.currency}</div>
                      </td>
                      <td className="p-3 text-gray-300 text-xs">
                        <div>{r.origin_port}</div>
                        <div className="text-gray-500">→ {r.destination_port}</div>
                      </td>
                      <td className="p-3 text-gray-300 text-xs">
                        <div>{r.shipment_type}</div>
                        {r.container_type && <div className="text-gray-500">{r.container_type}</div>}
                      </td>
                      <td className="p-3 text-white text-sm font-medium">
                        {r.shipment_type === "LCL"
                          ? `${r.currency} ${fmt(r.lcl_rate_per_cbm)}/CBM`
                          : `${r.currency} ${fmt(r.ocean_freight_amount)}`}
                      </td>
                      <td className="p-3 text-gray-300 text-xs">
                        {fmt(r.thc_origin)} / {fmt(r.thc_destination)}
                      </td>
                      <td className="p-3 text-gray-300 text-xs">
                        {r.transit_days != null ? `${r.transit_days} hari` : "-"}
                        {r.direct_or_transshipment === "transshipment" && <div className="text-yellow-500">Via T/S</div>}
                      </td>
                      <td className="p-3 text-gray-400 text-xs">
                        <div>{fmtDate(r.valid_from)} –</div>
                        <div className={isExpired(r.valid_until) ? "text-red-400" : ""}>{fmtDate(r.valid_until)}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Switch checked={!!r.is_active} onCheckedChange={() => toggleMut.mutate(r.id)} />
                          {isExpired(r.valid_until) && <Badge variant="outline" className="text-xs text-red-400 border-red-700">Expired</Badge>}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-white" onClick={() => openEdit(r)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={() => { if (confirm("Hapus rate ini?")) deleteMut.mutate(r.id); }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-gray-700">
                <span className="text-xs text-gray-500">Hal {page} dari {pages}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7 border-gray-600" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" className="h-7 border-gray-600" disabled={page >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-3 w-3" /></Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create/Edit Dialog */}
        <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
          <DialogContent className="bg-gray-900 border-gray-700 text-white w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editId ? "Edit" : "Tambah"} Ocean Freight Rate</DialogTitle>
            </DialogHeader>

            {formErr && (
              <Alert variant="destructive" className="bg-red-950 border-red-800">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{formErr}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4 text-sm">
              {/* Source & Route */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs">Tipe Sumber</Label>
                  <Select value={form.rate_source_type} onValueChange={(v) => setForm((p: any) => ({ ...p, rate_source_type: v }))}>
                    <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="shipping_line">Shipping Line</SelectItem>
                      <SelectItem value="nvocc">NVOCC</SelectItem>
                      <SelectItem value="agent">Agent / Forwarder</SelectItem>
                      <SelectItem value="internal">Internal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Nama Sumber *</Label>
                  <Input value={form.rate_source_name} onChange={(e) => setForm((p: any) => ({ ...p, rate_source_name: e.target.value }))} className="bg-gray-800 border-gray-600 text-white h-8" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Carrier / Shipping Line</Label>
                  <Input value={form.carrier_name} onChange={(e) => setForm((p: any) => ({ ...p, carrier_name: e.target.value }))} className="bg-gray-800 border-gray-600 text-white h-8" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs">Origin Port *</Label>
                  <Input value={form.origin_port} onChange={(e) => setForm((p: any) => ({ ...p, origin_port: e.target.value }))} placeholder="Tanjung Priok" className="bg-gray-800 border-gray-600 text-white h-8" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Destination Port *</Label>
                  <Input value={form.destination_port} onChange={(e) => setForm((p: any) => ({ ...p, destination_port: e.target.value }))} placeholder="PSA Singapore" className="bg-gray-800 border-gray-600 text-white h-8" />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs">Trade Type</Label>
                  <Select value={form.trade_type} onValueChange={(v) => setForm((p: any) => ({ ...p, trade_type: v }))}>
                    <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="export">Export</SelectItem>
                      <SelectItem value="import">Import</SelectItem>
                      <SelectItem value="domestic">Domestic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Shipment Type</Label>
                  <Select value={form.shipment_type} onValueChange={(v) => setForm((p: any) => ({ ...p, shipment_type: v }))}>
                    <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="FCL">FCL</SelectItem>
                      <SelectItem value="LCL">LCL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Service Mode</Label>
                  <Select value={form.service_mode} onValueChange={(v) => setForm((p: any) => ({ ...p, service_mode: v }))}>
                    <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="port_to_port">Port to Port</SelectItem>
                      <SelectItem value="door_to_port">Door to Port</SelectItem>
                      <SelectItem value="port_to_door">Port to Door</SelectItem>
                      <SelectItem value="door_to_door">Door to Door</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Routing</Label>
                  <Select value={form.direct_or_transshipment} onValueChange={(v) => setForm((p: any) => ({ ...p, direct_or_transshipment: v }))}>
                    <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      <SelectItem value="direct">Direct</SelectItem>
                      <SelectItem value="transshipment">Transshipment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Container / LCL */}
              {form.shipment_type === "FCL" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-gray-400 text-xs">Container Type *</Label>
                    <Select value={form.container_type} onValueChange={(v) => setForm((p: any) => ({ ...p, container_type: v }))}>
                      <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-gray-800 border-gray-700">
                        {CONTAINER_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <NumField label="Ocean Freight *" name="ocean_freight_amount" form={form} setForm={setForm} />
                  <div>
                    <Label className="text-gray-400 text-xs">Currency</Label>
                    <Select value={form.currency} onValueChange={(v) => setForm((p: any) => ({ ...p, currency: v }))}>
                      <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-gray-800 border-gray-700">
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="IDR">IDR</SelectItem>
                        <SelectItem value="SGD">SGD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <NumField label="Rate per CBM *" name="lcl_rate_per_cbm" form={form} setForm={setForm} />
                  <NumField label="Minimum CBM *" name="lcl_minimum_cbm" form={form} setForm={setForm} />
                  <div>
                    <Label className="text-gray-400 text-xs">Currency</Label>
                    <Select value={form.currency} onValueChange={(v) => setForm((p: any) => ({ ...p, currency: v }))}>
                      <SelectTrigger className="bg-gray-800 border-gray-600 text-white h-8"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-gray-800 border-gray-700">
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="IDR">IDR</SelectItem>
                        <SelectItem value="SGD">SGD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {form.currency !== "IDR" && (
                <NumField label="Exchange Rate ke IDR" name="exchange_rate_to_idr" form={form} setForm={setForm} />
              )}

              {/* Charges */}
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider pt-2">Charges & Surcharge</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <NumField label="THC Origin" name="thc_origin" form={form} setForm={setForm} />
                <NumField label="THC Destination" name="thc_destination" form={form} setForm={setForm} />
                <NumField label="DOC Fee" name="doc_fee" form={form} setForm={setForm} />
                <NumField label="B/L Fee" name="bl_fee" form={form} setForm={setForm} />
                <NumField label="D/O Fee" name="do_fee" form={form} setForm={setForm} />
                <NumField label="Handling Fee" name="handling_fee" form={form} setForm={setForm} />
                <NumField label="Customs Clearance" name="customs_clearance_fee" form={form} setForm={setForm} />
                <NumField label="Trucking Pickup Est." name="trucking_pickup_estimate" form={form} setForm={setForm} />
                <NumField label="Trucking Delivery Est." name="trucking_delivery_estimate" form={form} setForm={setForm} />
                <NumField label="Insurance %" name="insurance_percent" form={form} setForm={setForm} />
                <NumField label="DG Surcharge %" name="dg_surcharge_percent" form={form} setForm={setForm} />
                <NumField label="Reefer Surcharge" name="reefer_surcharge" form={form} setForm={setForm} />
                <NumField label="Peak Season Surch." name="peak_season_surcharge" form={form} setForm={setForm} />
                <NumField label="EBS" name="emergency_bunker_surcharge" form={form} setForm={setForm} />
                <NumField label="CAF" name="currency_adjustment_factor" form={form} setForm={setForm} />
                <div>
                  <Label className="text-gray-400 text-xs">Transit Days</Label>
                  <Input type="number" min="0" value={form.transit_days}
                    onChange={(e) => setForm((p: any) => ({ ...p, transit_days: e.target.value }))}
                    className="bg-gray-800 border-gray-600 text-white h-8 text-sm" />
                </div>
              </div>

              {/* Validity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-xs">Valid From</Label>
                  <DatePicker value={form.valid_from} onChange={(v) => setForm((p: any) => ({ ...p, valid_from: v }))} className="bg-gray-800 border-gray-600 text-white h-8" />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs">Valid Until</Label>
                  <DatePicker value={form.valid_until} onChange={(v) => setForm((p: any) => ({ ...p, valid_until: v }))} className="bg-gray-800 border-gray-600 text-white h-8" />
                </div>
              </div>

              <div>
                <Label className="text-gray-400 text-xs">Catatan</Label>
                <Input value={form.notes} onChange={(e) => setForm((p: any) => ({ ...p, notes: e.target.value }))} className="bg-gray-800 border-gray-600 text-white h-8" />
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={!!form.is_active} onCheckedChange={(v) => setForm((p: any) => ({ ...p, is_active: v }))} />
                <Label className="text-gray-400 text-sm">Aktif</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" className="border-gray-600 text-gray-300" onClick={() => setDlgOpen(false)}>
                <X className="h-4 w-4 mr-1" /> Batal
              </Button>
              <Button onClick={handleSave} disabled={saveMut.isPending} className="bg-blue-600 hover:bg-blue-700">
                <Check className="h-4 w-4 mr-1" /> {saveMut.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
