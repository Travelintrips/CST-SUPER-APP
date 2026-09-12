import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Plus, Trash2, DollarSign, Ship, Plane, FileText, Truck, Warehouse, Package, AlertCircle, ArrowLeft } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RateCard {
  id: number;
  serviceType: string;
  name: string;
  description: string | null;
  currency: string;
  isActive: boolean;
  validFrom: string | null;
  validTo: string | null;
  updatedAt: string;
}

interface RateItem {
  id: number;
  rateCardId: number;
  rateKey: string;
  label: string;
  valueType: "fixed" | "percentage";
  valueAmount: string;
  containerType: string | null;
  vehicleType: string | null;
  notes: string | null;
  sortOrder: number;
}

interface Surcharge {
  id: number;
  serviceType: string;
  name: string;
  label: string;
  surchargeType: "fixed" | "percentage" | "per_unit";
  amount: string;
  unit: string;
  isMandatory: boolean;
  isActive: boolean;
  appliesTo: string;
  sortOrder: number;
}

interface CardDetail extends RateCard {
  rates: RateItem[];
  surcharges: Surcharge[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const apiFetch = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { credentials: "include", ...init });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  return r.json();
};

const formatRp = (v: string | number) =>
  Number(v) === 0 ? "0" : `Rp ${Number(v).toLocaleString("id-ID")}`;

const SERVICE_TABS = [
  { key: "seaFreight",   label: "Sea Freight",  icon: Ship },
  { key: "airFreight",   label: "Air Freight",  icon: Plane },
  { key: "customs",      label: "PPJK",         icon: FileText },
  { key: "trucking",     label: "Trucking",     icon: Truck },
  { key: "warehousing",  label: "Warehousing",  icon: Warehouse },
  { key: "projectCargo", label: "Project Cargo",icon: Package },
] as const;

// ─── Edit Rate Item Dialog ───────────────────────────────────────────────────

function RateItemDialog({
  cardId,
  item,
  open,
  onClose,
}: {
  cardId: number;
  item?: RateItem;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!item;

  const [form, setForm] = useState({
    rateKey: item?.rateKey ?? "",
    label: item?.label ?? "",
    valueType: item?.valueType ?? "fixed",
    valueAmount: item ? String(item.valueAmount) : "0",
    containerType: item?.containerType ?? "",
    vehicleType: item?.vehicleType ?? "",
    notes: item?.notes ?? "",
    sortOrder: String(item?.sortOrder ?? 0),
  });

  const mut = useMutation({
    mutationFn: (body: typeof form) => {
      const payload = {
        ...body,
        valueAmount: Number(body.valueAmount),
        containerType: body.containerType || null,
        vehicleType: body.vehicleType || null,
        notes: body.notes || null,
        sortOrder: Number(body.sortOrder),
      };
      return isEdit
        ? apiFetch(`/api/logistics-rates/admin/rates/${item!.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : apiFetch(`/api/logistics-rates/admin/${cardId}/rates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/logistics-rates/admin/${cardId}`] });
      toast({ title: isEdit ? "Rate item disimpan" : "Rate item ditambah" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Rate Item" : "Tambah Rate Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Rate Key</Label>
              <Input value={form.rateKey} onChange={(e) => set("rateKey", e.target.value)} placeholder="ratePerKg" />
            </div>
            <div>
              <Label>Label</Label>
              <Input value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="Rate per Kg" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipe Nilai</Label>
              <Select value={form.valueType} onValueChange={(v) => set("valueType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed (IDR)</SelectItem>
                  <SelectItem value="percentage">Percentage (%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nilai</Label>
              <Input type="number" value={form.valueAmount} onChange={(e) => set("valueAmount", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Container Type <span className="text-slate-400 text-xs">(opsional)</span></Label>
              <Input value={form.containerType} onChange={(e) => set("containerType", e.target.value)} placeholder="20GP, 40HC..." />
            </div>
            <div>
              <Label>Vehicle Type <span className="text-slate-400 text-xs">(opsional)</span></Label>
              <Input value={form.vehicleType} onChange={(e) => set("vehicleType", e.target.value)} placeholder="CDE, Fuso..." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Keterangan..." />
            </div>
            <div>
              <Label>Sort Order</Label>
              <Input type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={() => mut.mutate(form)} disabled={mut.isPending}>
            {mut.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Surcharge Dialog ───────────────────────────────────────────────────

function SurchargeDialog({
  serviceType,
  item,
  open,
  onClose,
}: {
  serviceType: string;
  item?: Surcharge;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!item;

  const [form, setForm] = useState({
    name: item?.name ?? "",
    label: item?.label ?? "",
    surchargeType: item?.surchargeType ?? "fixed",
    amount: item ? String(item.amount) : "0",
    unit: item?.unit ?? "flat",
    isMandatory: item?.isMandatory ?? false,
    isActive: item?.isActive ?? true,
    appliesTo: item?.appliesTo ?? "all",
    sortOrder: String(item?.sortOrder ?? 0),
  });

  const cardId = /* get from current detail */ -1;

  const mut = useMutation({
    mutationFn: (body: typeof form) => {
      const payload = {
        ...body,
        serviceType,
        amount: Number(body.amount),
        sortOrder: Number(body.sortOrder),
      };
      return isEdit
        ? apiFetch(`/api/logistics-rates/admin/surcharges/${item!.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : apiFetch(`/api/logistics-rates/admin/surcharges`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/logistics-rates/admin`] });
      SERVICE_TABS.forEach(({ key }) => {
        qc.invalidateQueries({ queryKey: [`rate-card-${key}`] });
      });
      toast({ title: isEdit ? "Surcharge disimpan" : "Surcharge ditambah" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Surcharge" : "Tambah Surcharge"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nama (key)</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="fuelSurcharge" />
            </div>
            <div>
              <Label>Label</Label>
              <Input value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="Fuel Surcharge" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipe</Label>
              <Select value={form.surchargeType} onValueChange={(v) => set("surchargeType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="per_unit">Per Unit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nilai</Label>
              <Input type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Unit</Label>
              <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat</SelectItem>
                  <SelectItem value="per_kg">Per Kg</SelectItem>
                  <SelectItem value="per_cbm">Per CBM</SelectItem>
                  <SelectItem value="per_container">Per Container</SelectItem>
                  <SelectItem value="per_day">Per Day</SelectItem>
                  <SelectItem value="per_pallet">Per Pallet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Berlaku Untuk</Label>
              <Select value={form.appliesTo} onValueChange={(v) => set("appliesTo", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="dg">Dangerous Goods</SelectItem>
                  <SelectItem value="temp_controlled">Temp Controlled</SelectItem>
                  <SelectItem value="oversize">Oversize</SelectItem>
                  <SelectItem value="overnight">Overnight</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-6 pt-1">
            <div className="flex items-center gap-2">
              <Switch checked={form.isMandatory} onCheckedChange={(v) => set("isMandatory", v)} id="mandatory" />
              <Label htmlFor="mandatory">Mandatory</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} id="surch-active" />
              <Label htmlFor="surch-active">Aktif</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={() => mut.mutate(form)} disabled={mut.isPending}>
            {mut.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Service Tab Content ────────────────────────────────────────────────────

function ServiceTabContent({ serviceType }: { serviceType: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [rateDialog, setRateDialog] = useState<{ open: boolean; item?: RateItem }>({ open: false });
  const [surchDialog, setSurchDialog] = useState<{ open: boolean; item?: Surcharge }>({ open: false });

  // Load all cards, find the one for this service
  const { data: allCards = [], isLoading: cardsLoading } = useQuery<RateCard[]>({
    queryKey: ["/api/logistics-rates/admin"],
    queryFn: () => apiFetch("/api/logistics-rates/admin"),
  });

  const card = allCards.find((c) => c.serviceType === serviceType);

  const { data: detail, isLoading: detailLoading } = useQuery<CardDetail>({
    queryKey: [`/api/logistics-rates/admin/${card?.id}`],
    queryFn: () => apiFetch(`/api/logistics-rates/admin/${card!.id}`),
    enabled: !!card?.id,
  });

  const toggleActive = useMutation({
    mutationFn: () =>
      apiFetch(`/api/logistics-rates/admin/${card!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !card!.isActive }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/logistics-rates/admin"] });
      toast({ title: "Status diperbarui" });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteRate = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/logistics-rates/admin/rates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/logistics-rates/admin/${card?.id}`] });
      toast({ title: "Rate item dihapus" });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteSurcharge = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/logistics-rates/admin/surcharges/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/logistics-rates/admin/${card?.id}`] });
      toast({ title: "Surcharge dihapus" });
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  if (cardsLoading || detailLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
        Memuat data tarif...
      </div>
    );
  }

  if (!card) {
    return (
      <div className="flex items-center gap-2 py-12 text-slate-400 text-sm justify-center">
        <AlertCircle className="h-4 w-4" />
        Tidak ada rate card untuk layanan ini. Sedang diinisialisasi...
      </div>
    );
  }

  const rates = detail?.rates ?? [];
  const surcharges = detail?.surcharges ?? [];

  return (
    <div className="space-y-6">
      {/* Card header info */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">{card.name}</h3>
          <p className="text-sm text-slate-500">Currency: {card.currency}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={card.isActive ? "default" : "secondary"}>
            {card.isActive ? "Aktif" : "Nonaktif"}
          </Badge>
          <Switch
            checked={card.isActive}
            onCheckedChange={() => toggleActive.mutate()}
          />
        </div>
      </div>

      {/* Base Rates */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Base Rates</h4>
          <Button size="sm" variant="outline" onClick={() => setRateDialog({ open: true })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Tambah Rate
          </Button>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead className="text-right">Nilai</TableHead>
                <TableHead>Container / Kendaraan</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-400 py-6 text-sm">
                    Belum ada rate item
                  </TableCell>
                </TableRow>
              ) : (
                rates.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-sm">{item.label}</TableCell>
                    <TableCell className="text-xs text-slate-500 font-mono">{item.rateKey}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {item.valueType === "percentage" ? "%" : "IDR"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm">
                      {item.valueType === "percentage"
                        ? `${Number(item.valueAmount)}%`
                        : formatRp(item.valueAmount)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {item.containerType || item.vehicleType || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setRateDialog({ open: true, item })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-500 hover:text-red-700"
                          onClick={() => {
                            if (confirm(`Hapus "${item.label}"?`)) deleteRate.mutate(item.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Surcharges */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Surcharges</h4>
          <Button size="sm" variant="outline" onClick={() => setSurchDialog({ open: true })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Tambah Surcharge
          </Button>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead className="text-right">Nilai</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Berlaku Untuk</TableHead>
                <TableHead>Wajib</TableHead>
                <TableHead>Aktif</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {surcharges.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-slate-400 py-6 text-sm">
                    Belum ada surcharge
                  </TableCell>
                </TableRow>
              ) : (
                surcharges.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-sm">{s.label}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">{s.surchargeType}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm">
                      {s.surchargeType === "percentage"
                        ? `${Number(s.amount)}%`
                        : formatRp(s.amount)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{s.unit}</TableCell>
                    <TableCell className="text-xs text-slate-500">{s.appliesTo}</TableCell>
                    <TableCell>
                      {s.isMandatory ? (
                        <Badge className="text-xs bg-orange-100 text-orange-700 border-0">Wajib</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">Opsional</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={s.isActive}
                        onCheckedChange={() =>
                          apiFetch(`/api/logistics-rates/admin/surcharges/${s.id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ isActive: !s.isActive }),
                          }).then(() => {
                            qc.invalidateQueries({ queryKey: [`/api/logistics-rates/admin/${card.id}`] });
                          })
                        }
                        className="scale-75"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setSurchDialog({ open: true, item: s })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-500 hover:text-red-700"
                          onClick={() => {
                            if (confirm(`Hapus surcharge "${s.label}"?`)) deleteSurcharge.mutate(s.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {rateDialog.open && (
        <RateItemDialog
          cardId={card.id}
          item={rateDialog.item}
          open={rateDialog.open}
          onClose={() => setRateDialog({ open: false })}
        />
      )}
      {surchDialog.open && (
        <SurchargeDialog
          serviceType={serviceType}
          item={surchDialog.item}
          open={surchDialog.open}
          onClose={() => setSurchDialog({ open: false })}
        />
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function LogisticsRateManagementPage() {
  const [activeTab, setActiveTab] = useState("seaFreight");

  return (
    <AppShell>
      <BackButton href="/logistics" />
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <DollarSign className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Rate Management</h1>
            <p className="text-sm text-slate-500">Kelola tarif kalkulator per layanan logistik</p>
          </div>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            Perubahan tarif di sini akan langsung aktif di kalkulator Customer Portal.
            Data seed awal diambil dari nilai default sistem.
          </p>
        </div>

        {/* Tab per service */}
        <Card>
          <CardContent className="pt-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-6 flex flex-wrap gap-1 h-auto">
                {SERVICE_TABS.map(({ key, label, icon: Icon }) => (
                  <TabsTrigger key={key} value={key} className="flex items-center gap-1.5 text-xs">
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {SERVICE_TABS.map(({ key }) => (
                <TabsContent key={key} value={key}>
                  <ServiceTabContent serviceType={key} />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
