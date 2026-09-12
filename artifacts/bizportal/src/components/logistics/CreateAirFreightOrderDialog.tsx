import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const ADDITIONAL_SERVICES = [
  "Customs Clearance",
  "Pickup Trucking",
  "Delivery Trucking",
  "Insurance",
  "Fumigation",
  "Packing",
  "Labeling",
  "X-Ray",
];

export function CreateAirFreightOrderDialog({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    customerCompany: "",
    originAirport: "",
    destAirport: "",
    tradeType: "export",
    cargoType: "general",
    commodity: "",
    pieces: "",
    packingType: "",
    grossWeight: "",
    chargeableWeight: "",
    volumeCbm: "",
    incoterm: "",
    etdRequested: "",
    estimatedPrice: "",
    specialInstructions: "",
    notes: "",
    additionalServices: [] as string[],
  });
  const [dimensions, setDimensions] = useState<{ length: string; width: string; height: string; pieces: string; grossWeight: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const toggleService = (s: string) =>
    setForm(f => ({
      ...f,
      additionalServices: f.additionalServices.includes(s)
        ? f.additionalServices.filter(x => x !== s)
        : [...f.additionalServices, s],
    }));

  const addDim = () =>
    setDimensions(d => [...d, { length: "", width: "", height: "", pieces: "1", grossWeight: "" }]);
  const removeDim = (i: number) => setDimensions(d => d.filter((_, idx) => idx !== i));
  const setDim = (i: number, k: string, v: string) =>
    setDimensions(d => d.map((row, idx) => idx === i ? { ...row, [k]: v } : row));

  // Compute volumetric weight from dims
  const computedVolumetric = dimensions.reduce((acc, d) => {
    const vol = (parseFloat(d.length || "0") * parseFloat(d.width || "0") * parseFloat(d.height || "0") * parseInt(d.pieces || "1")) / 6000;
    return acc + vol;
  }, 0);

  const handleCreate = async (): Promise<void> => {
    if (!form.customerName.trim()) { toast({ title: "Nama customer wajib diisi", variant: "destructive" }); return; }
    if (!form.originAirport.trim() || !form.destAirport.trim()) { toast({ title: "Origin & Dest airport wajib diisi", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const dims = dimensions
        .filter(d => d.length || d.width || d.height)
        .map(d => ({
          ...d,
          volumetricWeight: (
            (parseFloat(d.length || "0") * parseFloat(d.width || "0") * parseFloat(d.height || "0") * parseInt(d.pieces || "1")) / 6000
          ).toFixed(3),
        }));

      const r = await fetch("/api/air-freight/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, dimensions: dims }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Order berhasil dibuat" });
      onCreated();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const Fl = ({ label, k, type = "text", placeholder = "" }: { label: string; k: string; type?: string; placeholder?: string }) => (
    <div>
      <Label className="text-xs mb-1 block">{label}</Label>
      <Input
        type={type}
        value={(form as any)[k]}
        onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Air Freight Order</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Customer */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Informasi Customer</p>
            <div className="grid grid-cols-2 gap-3">
              <Fl label="Nama Customer *" k="customerName" />
              <Fl label="Perusahaan" k="customerCompany" />
              <Fl label="Email" k="customerEmail" type="email" />
              <Fl label="No. Telepon" k="customerPhone" />
            </div>
          </div>

          <Separator />

          {/* Route */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Rute</p>
            <div className="grid grid-cols-2 gap-3">
              <Fl label="Origin Airport *" k="originAirport" placeholder="e.g. CGK, SUB" />
              <Fl label="Dest Airport *" k="destAirport" placeholder="e.g. SIN, HKG" />
              <div>
                <Label className="text-xs mb-1 block">Trade Type</Label>
                <Select value={form.tradeType} onValueChange={(v) => set("tradeType", v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="export">Export</SelectItem>
                    <SelectItem value="import">Import</SelectItem>
                    <SelectItem value="domestic">Domestic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Fl label="Incoterm" k="incoterm" placeholder="e.g. FOB, CIF, DDP" />
              <Fl label="ETD Requested" k="etdRequested" placeholder="e.g. 2026-07-15" />
            </div>
          </div>

          <Separator />

          {/* Cargo */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Detail Kargo</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Cargo Type</Label>
                <Select value={form.cargoType} onValueChange={(v) => set("cargoType", v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General Cargo</SelectItem>
                    <SelectItem value="dangerous">Dangerous Goods</SelectItem>
                    <SelectItem value="perishable">Perishable</SelectItem>
                    <SelectItem value="valuables">Valuables</SelectItem>
                    <SelectItem value="live_animals">Live Animals</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Fl label="Komoditi" k="commodity" placeholder="e.g. Electronic, Garment" />
              <Fl label="Jumlah Koli" k="pieces" type="number" />
              <Fl label="Packing Type" k="packingType" placeholder="e.g. Carton, Pallet" />
              <Fl label="Gross Weight (kg)" k="grossWeight" type="number" />
              <Fl label="Chargeable Weight (kg)" k="chargeableWeight" type="number" />
              <Fl label="Volume CBM" k="volumeCbm" type="number" />
              <Fl label="Est. Price (IDR)" k="estimatedPrice" type="number" />
            </div>
          </div>

          {/* Dimensions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Dimensi Kargo (opsional)</p>
              <Button size="sm" variant="outline" type="button" onClick={addDim}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Tambah Baris
              </Button>
            </div>
            {dimensions.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-slate-500">P (cm)</th>
                      <th className="px-2 py-1.5 text-left font-medium text-slate-500">L (cm)</th>
                      <th className="px-2 py-1.5 text-left font-medium text-slate-500">T (cm)</th>
                      <th className="px-2 py-1.5 text-left font-medium text-slate-500">Koli</th>
                      <th className="px-2 py-1.5 text-left font-medium text-slate-500">Gross (kg)</th>
                      <th className="px-2 py-1.5 text-right font-medium text-slate-400">Vol (kg)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {dimensions.map((d, i) => {
                      const vol = (parseFloat(d.length || "0") * parseFloat(d.width || "0") * parseFloat(d.height || "0") * parseInt(d.pieces || "1")) / 6000;
                      return (
                        <tr key={i}>
                          {(["length", "width", "height", "pieces", "grossWeight"] as const).map((k) => (
                            <td key={k} className="px-1 py-1">
                              <Input
                                type="number"
                                value={d[k]}
                                onChange={(e) => setDim(i, k, e.target.value)}
                                className="h-6 text-xs px-1.5"
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1 text-right text-slate-500 font-mono">{vol > 0 ? vol.toFixed(2) : "-"}</td>
                          <td className="px-1 py-1">
                            <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => removeDim(i)}>
                              <Trash2 className="h-3 w-3 text-red-400" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {computedVolumetric > 0 && (
                  <div className="px-3 py-2 bg-sky-50 text-xs text-sky-700 font-medium flex justify-between">
                    <span>Total Volumetric Weight</span>
                    <span>{computedVolumetric.toFixed(3)} kg</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Additional Services */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Layanan Tambahan</p>
            <div className="flex flex-wrap gap-2">
              {ADDITIONAL_SERVICES.map((s) => (
                <label key={s} className={`flex items-center gap-1.5 cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${form.additionalServices.includes(s) ? "bg-sky-50 border-sky-400 text-sky-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <input type="checkbox" className="sr-only" checked={form.additionalServices.includes(s)} onChange={() => toggleService(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>

          <Separator />

          {/* Notes */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Instruksi Khusus</Label>
              <Textarea value={form.specialInstructions} onChange={(e) => set("specialInstructions", e.target.value)} rows={2} placeholder="Dangerous goods info, handling requirements, etc." className="text-sm" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Catatan Internal</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="text-sm" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Menyimpan..." : "Buat Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
