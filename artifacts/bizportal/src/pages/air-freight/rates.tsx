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
  Plane, Plus, Search, RefreshCw, ChevronLeft, ChevronRight,
  Pencil, Trash2, ToggleLeft, X, Check, AlertCircle,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* ── helpers ─────────────────────────────────────────────────────────────── */
const fmt = (n: number | null | undefined) =>
  n == null ? "-" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(n));

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "-";
  try { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)); }
  catch { return d; }
};

const isExpired = (until: string | null | undefined) => {
  if (!until) return false;
  return new Date(until) < new Date();
};

/* ── form default ────────────────────────────────────────────────────────── */
const EMPTY: Record<string, any> = {
  rate_source_type: "agent", rate_source_name: "", airline: "",
  origin_city: "", origin_airport: "", destination_city: "", destination_airport: "",
  trade_type: "export", service_mode: "door_to_door", service_level: "standard",
  currency: "IDR", exchange_rate_to_idr: 1,
  rate_minimum: "", rate_45: "", rate_100: "", rate_250: "",
  rate_300: "", rate_500: "", rate_1000: "",
  fuel_surcharge_per_kg: 0, security_surcharge_per_kg: 0,
  xray_fee: 0, awb_fee: 0, handling_fee: 0, doc_fee: 0, edi_fee: 0,
  customs_clearance_fee: 0, pickup_trucking_estimate: 0, delivery_trucking_estimate: 0,
  insurance_percent: 0, dg_surcharge_percent: 0, perishable_surcharge_percent: 0,
  live_animal_surcharge_percent: 0, valuable_surcharge_percent: 0,
  oversize_surcharge_percent: 0, cold_chain_surcharge: 0, peak_season_surcharge: 0,
  minimum_charge: 0, transit_days: "", flight_number: "", etd: "", eta: "",
  routing_type: "direct", cargo_type: "general",
  valid_from: new Date().toISOString().slice(0, 10),
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  price_status: "active", is_active: true,
};

/* ── field groups ─────────────────────────────────────────────────────────── */
const WEIGHT_BREAKS = [
  { key: "rate_minimum", label: "Rate Minimum" },
  { key: "rate_45",      label: "Rate +45 kg" },
  { key: "rate_100",     label: "Rate +100 kg" },
  { key: "rate_250",     label: "Rate +250 kg" },
  { key: "rate_300",     label: "Rate +300 kg" },
  { key: "rate_500",     label: "Rate +500 kg" },
  { key: "rate_1000",    label: "Rate +1000 kg" },
];

const SURCHARGES = [
  { key: "fuel_surcharge_per_kg",        label: "Fuel Surcharge /kg" },
  { key: "security_surcharge_per_kg",    label: "Security Surcharge /kg" },
  { key: "xray_fee",                     label: "X-Ray Fee" },
  { key: "awb_fee",                      label: "AWB Fee" },
  { key: "handling_fee",                 label: "Handling Fee" },
  { key: "doc_fee",                      label: "Doc Fee" },
  { key: "edi_fee",                      label: "EDI Fee" },
  { key: "customs_clearance_fee",        label: "Customs Clearance" },
  { key: "pickup_trucking_estimate",     label: "Pickup Trucking Est." },
  { key: "delivery_trucking_estimate",   label: "Delivery Trucking Est." },
  { key: "cold_chain_surcharge",         label: "Cold Chain Surcharge" },
  { key: "peak_season_surcharge",        label: "Peak Season Surcharge" },
  { key: "minimum_charge",              label: "Minimum Charge" },
];

const PERCENT_SURCHARGES = [
  { key: "insurance_percent",            label: "Insurance (%)" },
  { key: "dg_surcharge_percent",         label: "DG Surcharge (%)" },
  { key: "perishable_surcharge_percent", label: "Perishable (%)" },
  { key: "live_animal_surcharge_percent",label: "Live Animal (%)" },
  { key: "valuable_surcharge_percent",   label: "Valuable (%)" },
  { key: "oversize_surcharge_percent",   label: "Oversize (%)" },
];

/* ── RateForm ─────────────────────────────────────────────────────────────── */
function RateForm({
  initial, companyId, onSave, onClose,
}: {
  initial?: Record<string, any>;
  companyId: number | null;
  onSave: (data: Record<string, any>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, any>>({ ...EMPTY, ...initial });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    setErr(null);
    // Client-side validation
    if (form.valid_until < form.valid_from) { setErr("valid_until harus >= valid_from"); return; }
    if (form.currency !== "IDR" && (!form.exchange_rate_to_idr || Number(form.exchange_rate_to_idr) <= 0)) {
      setErr("Exchange rate wajib jika currency bukan IDR"); return;
    }
    const breaks = WEIGHT_BREAKS.map(b => Number(form[b.key]) || 0);
    if (!breaks.some(v => v > 0)) { setErr("Minimal salah satu weight break rate wajib diisi"); return; }

    const payload: Record<string, any> = { ...form };
    // nullify empty weight breaks
    WEIGHT_BREAKS.forEach(b => { if (payload[b.key] === "" || payload[b.key] == null) payload[b.key] = null; });
    if (companyId) payload.company_id = companyId;

    try {
      setSaving(true);
      await onSave(payload);
    } catch (e: any) {
      setErr(e?.message ?? "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const F = ({ label, k, type = "number", step = "any", placeholder = "" }: {
    label: string; k: string; type?: string; step?: string; placeholder?: string;
  }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type={type} step={step} placeholder={placeholder}
        value={form[k] ?? ""}
        onChange={e => set(k, type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
        className="bg-muted/30 h-8 text-xs"
      />
    </div>
  );

  const Sel = ({ label, k, opts }: { label: string; k: string; opts: { v: string; l: string }[] }) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={String(form[k] ?? "")} onValueChange={v => set(k, v)}>
        <SelectTrigger className="h-8 text-xs bg-muted/30"><SelectValue /></SelectTrigger>
        <SelectContent>
          {opts.map(o => <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-5 text-xs max-h-[70vh] overflow-y-auto pr-1">
      {err && (
        <Alert className="border-red-700 bg-red-950/40 py-2">
          <AlertCircle className="h-4 w-4 text-red-400" />
          <AlertDescription className="text-red-300 text-xs">{err}</AlertDescription>
        </Alert>
      )}

      {/* Identitas */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Sumber Rate</p>
        <div className="grid grid-cols-2 gap-3">
          <Sel label="Tipe Sumber" k="rate_source_type" opts={[
            {v:"agent",l:"Agent"},{v:"airline",l:"Airline Direct"},{v:"gsa",l:"GSA"},{v:"co-load",l:"Co-Load"},{v:"nvocc",l:"NVOCC"},
          ]} />
          <F label="Nama Sumber" k="rate_source_name" type="text" />
          <F label="Airline" k="airline" type="text" placeholder="GA, SQ, CX…" />
          <Sel label="Routing" k="routing_type" opts={[{v:"direct",l:"Direct"},{v:"transit",l:"Transit"}]} />
        </div>
      </div>

      {/* Rute */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Rute</p>
        <div className="grid grid-cols-2 gap-3">
          <F label="Origin City" k="origin_city" type="text" />
          <F label="Origin Airport (IATA)" k="origin_airport" type="text" placeholder="CGK" />
          <F label="Destination City" k="destination_city" type="text" />
          <F label="Destination Airport (IATA)" k="destination_airport" type="text" placeholder="SIN" />
          <Sel label="Trade Type" k="trade_type" opts={[
            {v:"export",l:"Export"},{v:"import",l:"Import"},{v:"transit",l:"Transit"},
          ]} />
          <Sel label="Service Mode" k="service_mode" opts={[
            {v:"door_to_door",l:"Door to Door"},{v:"port_to_door",l:"Port to Door"},
            {v:"door_to_port",l:"Door to Port"},{v:"port_to_port",l:"Port to Port"},
          ]} />
          <Sel label="Service Level" k="service_level" opts={[
            {v:"standard",l:"Standard"},{v:"express",l:"Express"},{v:"economy",l:"Economy"},{v:"priority",l:"Priority"},
          ]} />
          <Sel label="Cargo Type" k="cargo_type" opts={[
            {v:"general",l:"General"},{v:"dg",l:"Dangerous Goods (DG)"},
            {v:"perishable",l:"Perishable"},{v:"live_animal",l:"Live Animal"},
            {v:"valuable",l:"Valuable"},{v:"oversize",l:"Oversize"},
          ]} />
        </div>
      </div>

      {/* Mata uang */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Mata Uang</p>
        <div className="grid grid-cols-2 gap-3">
          <Sel label="Currency" k="currency" opts={[
            {v:"IDR",l:"IDR"},{v:"USD",l:"USD"},{v:"SGD",l:"SGD"},{v:"EUR",l:"EUR"},{v:"CNY",l:"CNY"},
          ]} />
          <F label="Exchange Rate ke IDR" k="exchange_rate_to_idr" />
        </div>
      </div>

      {/* Weight Break Rates */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Rate per Weight Break</p>
        <div className="grid grid-cols-2 gap-3">
          {WEIGHT_BREAKS.map(b => <F key={b.key} label={b.label} k={b.key} />)}
        </div>
      </div>

      {/* Surcharges */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Surcharge & Fees</p>
        <div className="grid grid-cols-2 gap-3">
          {SURCHARGES.map(s => <F key={s.key} label={s.label} k={s.key} />)}
        </div>
      </div>

      {/* Percent surcharges */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Surcharge Persentase (%)</p>
        <div className="grid grid-cols-2 gap-3">
          {PERCENT_SURCHARGES.map(s => <F key={s.key} label={s.label} k={s.key} />)}
        </div>
      </div>

      {/* Flight info */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Informasi Penerbangan (Opsional)</p>
        <div className="grid grid-cols-3 gap-3">
          <F label="Flight Number" k="flight_number" type="text" placeholder="GA-714" />
          <F label="ETD" k="etd" type="text" placeholder="10:00" />
          <F label="ETA" k="eta" type="text" placeholder="14:30" />
          <F label="Transit Days" k="transit_days" />
        </div>
      </div>

      {/* Validitas */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Masa Berlaku & Status</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Valid From</Label><DatePicker value={form["valid_from"] ?? ""} onChange={v => set("valid_from", v)} className="bg-muted/30 h-8 text-xs" /></div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Valid Until</Label><DatePicker value={form["valid_until"] ?? ""} onChange={v => set("valid_until", v)} className="bg-muted/30 h-8 text-xs" /></div>
          <Sel label="Price Status" k="price_status" opts={[
            {v:"active",l:"Active"},{v:"draft",l:"Draft"},{v:"expired",l:"Expired"},
          ]} />
          <div className="flex items-center gap-2 pt-5">
            <Switch checked={!!form.is_active} onCheckedChange={v => set("is_active", v)} />
            <span className="text-xs text-muted-foreground">Rate Aktif</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 sticky bottom-0 bg-background pb-1">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          <X className="h-3.5 w-3.5 mr-1" /> Batal
        </Button>
        <Button size="sm" className="bg-sky-700 hover:bg-sky-600 gap-1" onClick={handleSubmit} disabled={saving}>
          {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Simpan
        </Button>
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────────── */
export default function AirFreightRatesPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();

  const [search, setSearch]         = useState("");
  const [searchQ, setSearchQ]       = useState("");
  const [originFilter, setOrigin]   = useState("");
  const [destFilter, setDest]       = useState("");
  const [airlineFilter, setAirline] = useState("");
  const [svcFilter, setSvc]         = useState("__all__");
  const [cargoFilter, setCargo]     = useState("__all__");
  const [validOnly, setValidOnly]   = useState(true);
  const [page, setPage]             = useState(1);
  const LIMIT = 50;

  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState<Record<string, any> | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["air-freight-rates", activeCompanyId, searchQ, originFilter, destFilter, airlineFilter, svcFilter, cargoFilter, validOnly, page],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (searchQ) qs.set("search", searchQ);
      if (originFilter) qs.set("origin_airport", originFilter.toUpperCase());
      if (destFilter) qs.set("destination_airport", destFilter.toUpperCase());
      if (airlineFilter) qs.set("airline", airlineFilter);
      if (svcFilter !== "__all__") qs.set("service_level", svcFilter);
      if (cargoFilter !== "__all__") qs.set("cargo_type", cargoFilter);
      qs.set("valid_only", validOnly ? "true" : "false");
      const r = await fetch(`/api/air-freight/rates?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat rates");
      return r.json() as Promise<{ data: any[]; total: number }>;
    },
  });

  const saveMut = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const url = editing?.id ? `/api/air-freight/rates/${editing.id}` : "/api/air-freight/rates";
      const method = editing?.id ? "PUT" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Gagal menyimpan");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["air-freight-rates"] });
      setModalOpen(false);
      setEditing(null);
    },
  });

  const toggleMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/air-freight/rates/${id}/toggle`, {
        method: "PATCH", credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal toggle");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["air-freight-rates"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/air-freight/rates/${id}`, {
        method: "DELETE", credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal hapus");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["air-freight-rates"] }),
  });

  const rates     = data?.data  ?? [];
  const total     = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  const openNew  = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (r: Record<string, any>) => { setEditing(r); setModalOpen(true); };

  return (
    <AppShell>
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Plane className="h-6 w-6 text-sky-400" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Air Freight Rate Management</h1>
              <p className="text-sm text-muted-foreground">Kelola tarif udara: airline, rute, weight break, surcharge</p>
            </div>
          </div>
          <Button className="bg-sky-700 hover:bg-sky-600 text-white gap-1.5" onClick={openNew}>
            <Plus className="h-4 w-4" /> Tambah Rate
          </Button>
        </div>

        {/* Filters */}
        <Card className="border-border/60">
          <CardContent className="p-4 flex flex-wrap gap-3 items-end">
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="Cari airline, bandara, sumber…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { setSearchQ(search); setPage(1); }}}
                className="bg-muted/30"
              />
              <Button variant="outline" size="icon" onClick={() => { setSearchQ(search); setPage(1); }}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <Input
              placeholder="Origin (CGK)"
              value={originFilter}
              onChange={e => { setOrigin(e.target.value.toUpperCase()); setPage(1); }}
              className="bg-muted/30 w-28"
            />
            <Input
              placeholder="Dest (SIN)"
              value={destFilter}
              onChange={e => { setDest(e.target.value.toUpperCase()); setPage(1); }}
              className="bg-muted/30 w-28"
            />
            <Input
              placeholder="Airline"
              value={airlineFilter}
              onChange={e => { setAirline(e.target.value); setPage(1); }}
              className="bg-muted/30 w-28"
            />
            <Select value={svcFilter} onValueChange={v => { setSvc(v); setPage(1); }}>
              <SelectTrigger className="w-36 bg-muted/30">
                <SelectValue placeholder="Service Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua Level</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="express">Express</SelectItem>
                <SelectItem value="economy">Economy</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
              </SelectContent>
            </Select>
            <Select value={cargoFilter} onValueChange={v => { setCargo(v); setPage(1); }}>
              <SelectTrigger className="w-36 bg-muted/30">
                <SelectValue placeholder="Cargo Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua Cargo</SelectItem>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="dg">Dangerous Goods</SelectItem>
                <SelectItem value="perishable">Perishable</SelectItem>
                <SelectItem value="live_animal">Live Animal</SelectItem>
                <SelectItem value="valuable">Valuable</SelectItem>
                <SelectItem value="oversize">Oversize</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch checked={validOnly} onCheckedChange={v => { setValidOnly(v); setPage(1); }} />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Valid saja</span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => refetch()}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Plane className="h-4 w-4 text-sky-400" /> Rate List
              <Badge className="bg-sky-900/40 text-sky-300 border-sky-600 text-xs">{total} rate</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-muted/20 animate-pulse" />
                ))}
              </div>
            ) : rates.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Plane className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p>Belum ada rate yang sesuai filter</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      {[
                        "Airline","Rute","Trade","Level","Cargo",
                        "Min","+45","+100","+250","+500","+1000",
                        "Fuel/kg","Handling","Currency","Valid",
                        "Status","Aktif","Aksi"
                      ].map(h => (
                        <th key={h} className="text-left py-2.5 px-2 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rates.map((r: any) => {
                      const expired = isExpired(r.valid_until);
                      return (
                        <tr key={r.id} className={`border-b border-border/20 hover:bg-muted/30 transition-colors ${expired ? "opacity-50" : ""}`}>
                          <td className="py-2 px-2 font-medium text-foreground whitespace-nowrap">{r.airline || "-"}</td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            <span className="font-mono">{r.origin_airport}</span>
                            <span className="text-muted-foreground mx-1">→</span>
                            <span className="font-mono">{r.destination_airport}</span>
                          </td>
                          <td className="py-2 px-2 text-muted-foreground capitalize">{r.trade_type}</td>
                          <td className="py-2 px-2">
                            <Badge className="text-[10px] border bg-blue-900/30 text-blue-300 border-blue-700">
                              {r.service_level}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-muted-foreground">{r.cargo_type}</td>
                          <td className="py-2 px-2 text-right">{r.rate_minimum != null ? fmt(r.rate_minimum) : "—"}</td>
                          <td className="py-2 px-2 text-right">{r.rate_45 != null ? fmt(r.rate_45) : "—"}</td>
                          <td className="py-2 px-2 text-right">{r.rate_100 != null ? fmt(r.rate_100) : "—"}</td>
                          <td className="py-2 px-2 text-right">{r.rate_250 != null ? fmt(r.rate_250) : "—"}</td>
                          <td className="py-2 px-2 text-right">{r.rate_500 != null ? fmt(r.rate_500) : "—"}</td>
                          <td className="py-2 px-2 text-right">{r.rate_1000 != null ? fmt(r.rate_1000) : "—"}</td>
                          <td className="py-2 px-2 text-right">{fmt(r.fuel_surcharge_per_kg)}</td>
                          <td className="py-2 px-2 text-right">{fmt(r.handling_fee)}</td>
                          <td className="py-2 px-2 text-muted-foreground">{r.currency}</td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            <p className="text-foreground">{fmtDate(r.valid_from)}</p>
                            <p className={expired ? "text-red-400" : "text-muted-foreground"}>
                              {fmtDate(r.valid_until)}{expired ? " (exp)" : ""}
                            </p>
                          </td>
                          <td className="py-2 px-2">
                            <Badge className={`text-[10px] border ${
                              r.price_status === "active"
                                ? "bg-emerald-900/40 text-emerald-300 border-emerald-600"
                                : r.price_status === "draft"
                                  ? "bg-gray-800/40 text-gray-300 border-gray-600"
                                  : "bg-red-900/40 text-red-300 border-red-600"
                            }`}>
                              {r.price_status}
                            </Badge>
                          </td>
                          <td className="py-2 px-2">
                            <Switch
                              checked={!!r.is_active}
                              onCheckedChange={() => toggleMut.mutate(r.id)}
                              className="scale-75"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost" size="icon" className="h-6 w-6"
                                onClick={() => openEdit(r)}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300"
                                onClick={() => { if (confirm("Hapus rate ini?")) deleteMut.mutate(r.id); }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                <span className="text-xs text-muted-foreground">
                  {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} dari {total}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs px-2">{page}/{totalPages}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal Create/Edit */}
      <Dialog open={modalOpen} onOpenChange={v => { if (!v) { setModalOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plane className="h-4 w-4 text-sky-400" />
              {editing ? "Edit Air Freight Rate" : "Tambah Air Freight Rate"}
            </DialogTitle>
          </DialogHeader>
          <RateForm
            initial={editing ?? undefined}
            companyId={activeCompanyId ?? null}
            onSave={async (payload) => { await saveMut.mutateAsync(payload); }}
            onClose={() => { setModalOpen(false); setEditing(null); }}
          />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
