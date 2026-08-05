import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCreateLogisticOrder } from "@workspace/api-client-react";
import { useCart, CartItem } from "@/lib/cart";
import { formatCurrency } from "@/lib/utils";
import {
  CATEGORIES, SERVICE_ITEMS, SHIPMENT_TYPES,
  ServiceCategory, ServiceItem, ShipmentType,
} from "@/lib/services-data";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Ship, ChevronLeft, ChevronRight, ArrowLeft,
  Plane, Download, Upload, MapPin, Home,
  Package, Warehouse, Truck, FileCheck, Shield, FileText,
  Plus, Trash2, Calculator, ShoppingCart, User, CheckCircle2,
  Lock,
} from "lucide-react";
import { CityAutocompleteInput } from "@/components/ui/city-autocomplete";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Ship, Plane, Download, Upload, MapPin, Home,
  Package, Warehouse, Truck, FileCheck, Shield, FileText,
};

type Step = 0 | 1 | 2 | 3 | 4;

interface CalcState {
  [key: string]: string;
}

function calcSubtotal(calcType: string, state: CalcState): number {
  try {
    switch (calcType) {
      case "air_freight": {
        const gw = parseFloat(state.grossWeight) || 0;
        const l = parseFloat(state.length) || 0;
        const w = parseFloat(state.width) || 0;
        const h = parseFloat(state.height) || 0;
        const qty = parseFloat(state.quantity) || 1;
        const rate = parseFloat(state.ratePerKg) || 0;
        const vw = (l * w * h * qty) / 6000;
        const cw = Math.max(gw, vw);
        return cw * rate;
      }
      case "sea_fcl": {
        const fr = parseFloat(state.freightRate) || 0;
        const hf = parseFloat(state.handlingFee) || 0;
        return fr + hf;
      }
      case "sea_lcl": {
        const cbm = parseFloat(state.cbm) || 0;
        const rate = parseFloat(state.ratePerCbm) || 0;
        const min = parseFloat(state.minimumCharge) || 0;
        return Math.max(cbm * rate, min);
      }
      case "customs": {
        const cf = parseFloat(state.customsFee) || 0;
        const df = parseFloat(state.documentFee) || 0;
        const pf = parseFloat(state.pibPebFee) || 0;
        const af = parseFloat(state.permitFee) || 0;
        return cf + df + pf + af;
      }
      case "trucking": {
        const dist = parseFloat(state.distance) || 0;
        const ratePerKm = parseFloat(state.truckingRate) || 0;
        const lf = parseFloat(state.loadingFee) || 0;
        return dist * ratePerKm + lf;
      }
      case "storage": {
        const days = parseFloat(state.days) || 0;
        const qty = parseFloat(state.quantity) || 1;
        const rate = parseFloat(state.ratePerDay) || 0;
        return days * qty * rate;
      }
      case "document": {
        const qty = parseFloat(state.quantity) || 0;
        const fee = parseFloat(state.feePerDocument) || 0;
        return qty * fee;
      }
      case "additional": {
        const sf = parseFloat(state.serviceFee) || 0;
        const af = parseFloat(state.adminFee) || 0;
        return sf + af;
      }
      default: {
        const qty = parseFloat(state.quantity) || 1;
        const up = parseFloat(state.unitPrice) || 0;
        return qty * up;
      }
    }
  } catch {
    return 0;
  }
}

function calcResult(calcType: string, state: CalcState): Record<string, unknown> {
  switch (calcType) {
    case "air_freight": {
      const gw = parseFloat(state.grossWeight) || 0;
      const l = parseFloat(state.length) || 0;
      const w = parseFloat(state.width) || 0;
      const h = parseFloat(state.height) || 0;
      const qty = parseFloat(state.quantity) || 1;
      const rate = parseFloat(state.ratePerKg) || 0;
      const vw = (l * w * h * qty) / 6000;
      const cw = Math.max(gw, vw);
      return { volumeWeight: vw.toFixed(2), chargeableWeight: cw.toFixed(2), ratePerKg: rate, total: (cw * rate).toFixed(2) };
    }
    case "customs": {
      const base = { total: calcSubtotal(calcType, state).toFixed(2) };
      const dutyNilai = parseFloat(state.dutyNilaiBrg) || 0;
      if (dutyNilai <= 0) return base;
      const isImport = state.shipmentType !== "Export";
      const dutyMataUang = state.dutyMataUang || "IDR";
      const dutyKurs = parseFloat(state.dutyKurs) || 1;
      const dutyIDR = dutyMataUang === "IDR" ? dutyNilai : dutyNilai * dutyKurs;
      const tarifBM = parseFloat(state.dutyTarifBM) || 0;
      const beaMasuk = dutyIDR * tarifBM / 100;
      const nilaiImpor = dutyIDR + beaMasuk;
      const ppn = isImport ? nilaiImpor * 0.11 : 0;
      const tarifPph = parseFloat(state.dutyTarifPph) || 0;
      const pph22 = isImport ? nilaiImpor * tarifPph / 100 : 0;
      const totalPungutan = isImport ? beaMasuk + ppn + pph22 : beaMasuk;
      return {
        ...base,
        dutyEstimation: {
          hsCode: state.dutyHsCode || null,
          mataUang: dutyMataUang,
          kurs: dutyMataUang !== "IDR" ? dutyKurs : null,
          nilaiBrg: dutyNilai,
          nilaiIDR: Math.round(dutyIDR),
          tarifBM,
          beaMasuk: Math.round(beaMasuk),
          nilaiImpor: isImport ? Math.round(nilaiImpor) : null,
          ppn: isImport ? Math.round(ppn) : null,
          tarifPph: isImport ? tarifPph : null,
          pph22: isImport ? Math.round(pph22) : null,
          totalPungutan: Math.round(totalPungutan),
        },
      };
    }
    default:
      return { total: calcSubtotal(calcType, state).toFixed(2) };
  }
}

// ── Calculator form ───────────────────────────────────────────────────────────
function CalculatorForm({ item, onAdd, onBack }: { item: ServiceItem; onAdd: (data: Omit<CartItem, "cartId">) => void; onBack: () => void }) {
  const [state, setState] = useState<CalcState>({});
  const [truckingRates, setTruckingRates] = useState<Record<string, { ratePerKm: number; loadingFee: number }>>({});
  const { toast } = useToast();
  const { t } = useLanguage();
  const isAdmin = localStorage.getItem("logistic_admin_auth") === "1";

  useEffect(() => {
    if (item.calculatorType === "trucking") {
      fetch("/api/logistic/orders/trucking-rates")
        .then((r) => r.json())
        .then((d) => setTruckingRates(d))
        .catch(() => {});
    }
  }, [item.calculatorType]);

  function set(key: string, val: string) {
    setState((prev) => ({ ...prev, [key]: val }));
  }

  useEffect(() => {
    const vt = state.vehicleType;
    if (!vt || !truckingRates[vt]) return;
    const { ratePerKm, loadingFee } = truckingRates[vt];
    set("truckingRate", String(ratePerKm));
    set("loadingFee", String(loadingFee));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.vehicleType, truckingRates]);

  const subtotal = calcSubtotal(item.calculatorType, state);

  function handleAdd() {
    if (subtotal <= 0) {
      toast({ title: t("book.toast.fillCalc"), variant: "destructive" });
      return;
    }
    onAdd({
      category: item.category,
      serviceName: item.name,
      calculatorType: item.calculatorType,
      inputData: { ...state },
      calculationResult: calcResult(item.calculatorType, state),
      subtotal,
    });
    toast({ title: `${item.name} ✓` });
  }

  const ct = item.calculatorType;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <Badge variant="outline" className="text-xs mb-1">{item.category}</Badge>
          <h3 className="font-bold text-foreground text-lg">{item.name}</h3>
          <p className="text-sm text-muted-foreground">{item.description}</p>
        </div>
      </div>

      <div className="bg-muted/30 rounded-lg border border-border p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Calculator className="w-4 h-4 text-accent" /> {t("book.step.calculator")}
        </div>

        {ct === "air_freight" && <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Origin Airport</Label>
              <CityAutocompleteInput type="airport" placeholder="Cari bandara asal..." value={state.originAirport||""} onChange={v => set("originAirport", v)} />
            </div>
            <div>
              <Label className="text-xs">Destination Airport</Label>
              <CityAutocompleteInput type="airport" placeholder="Cari bandara tujuan..." value={state.destinationAirport||""} onChange={v => set("destinationAirport", v)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Gross Weight (kg)</Label><Input type="number" placeholder="0" value={state.grossWeight||""} onChange={e => set("grossWeight", e.target.value)} /></div>
            <div><Label className="text-xs">Quantity (pcs)</Label><Input type="number" placeholder="1" value={state.quantity||""} onChange={e => set("quantity", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs">Length (cm)</Label><Input type="number" placeholder="0" value={state.length||""} onChange={e => set("length", e.target.value)} /></div>
            <div><Label className="text-xs">Width (cm)</Label><Input type="number" placeholder="0" value={state.width||""} onChange={e => set("width", e.target.value)} /></div>
            <div><Label className="text-xs">Height (cm)</Label><Input type="number" placeholder="0" value={state.height||""} onChange={e => set("height", e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Rate per Kg (IDR)</Label><Input type="number" placeholder="0" value={state.ratePerKg||""} onChange={e => set("ratePerKg", e.target.value)} /></div>
          {(parseFloat(state.grossWeight)||0) > 0 && (parseFloat(state.ratePerKg)||0) > 0 && (
            <div className="text-xs text-muted-foreground bg-background rounded p-3 space-y-1">
              <p>Volume Weight: {((parseFloat(state.length)||0)*(parseFloat(state.width)||0)*(parseFloat(state.height)||0)*(parseFloat(state.quantity)||1)/6000).toFixed(2)} kg</p>
              <p>Chargeable Weight: {Math.max(parseFloat(state.grossWeight)||0, (parseFloat(state.length)||0)*(parseFloat(state.width)||0)*(parseFloat(state.height)||0)*(parseFloat(state.quantity)||1)/6000).toFixed(2)} kg</p>
            </div>
          )}
        </>}

        {ct === "sea_fcl" && <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Origin Port</Label>
              <CityAutocompleteInput type="port" placeholder="Cari pelabuhan asal..." value={state.originPort||""} onChange={v => set("originPort", v)} />
            </div>
            <div>
              <Label className="text-xs">Destination Port</Label>
              <CityAutocompleteInput type="port" placeholder="Cari pelabuhan tujuan..." value={state.destinationPort||""} onChange={v => set("destinationPort", v)} />
            </div>
          </div>
          <div><Label className="text-xs">Container Type</Label>
            <Select value={state.containerType||undefined} onValueChange={v => set("containerType", v)}>
              <SelectTrigger><SelectValue placeholder="Select container" /></SelectTrigger>
              <SelectContent>
                {["20FT", "40FT", "40HC"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Freight Rate (IDR)</Label><Input type="number" placeholder="0" value={state.freightRate||""} onChange={e => set("freightRate", e.target.value)} /></div>
            <div><Label className="text-xs">Handling Fee (IDR)</Label><Input type="number" placeholder="0" value={state.handlingFee||""} onChange={e => set("handlingFee", e.target.value)} /></div>
          </div>
        </>}

        {ct === "sea_lcl" && <>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">CBM</Label><Input type="number" placeholder="0" value={state.cbm||""} onChange={e => set("cbm", e.target.value)} /></div>
            <div><Label className="text-xs">Weight (kg)</Label><Input type="number" placeholder="0" value={state.weight||""} onChange={e => set("weight", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Rate per CBM (IDR)</Label><Input type="number" placeholder="0" value={state.ratePerCbm||""} onChange={e => set("ratePerCbm", e.target.value)} /></div>
            <div><Label className="text-xs">Minimum Charge (IDR)</Label><Input type="number" placeholder="0" value={state.minimumCharge||""} onChange={e => set("minimumCharge", e.target.value)} /></div>
          </div>
        </>}

        {ct === "customs" && (() => {
          const isImport = state.shipmentType !== "Export";
          const dutyMataUang = state.dutyMataUang || "IDR";
          const dutyNilai = parseFloat(state.dutyNilaiBrg) || 0;
          const dutyKursRaw = parseFloat(state.dutyKurs) || 0;
          const kursValid = dutyMataUang === "IDR" || dutyKursRaw > 0;
          const dutyKurs = dutyKursRaw > 0 ? dutyKursRaw : 1;
          const dutyIDR = dutyMataUang === "IDR" ? dutyNilai : dutyNilai * dutyKurs;
          const tarifBM = parseFloat(state.dutyTarifBM) || 0;
          const beaMasuk = dutyIDR * tarifBM / 100;
          const nilaiImpor = dutyIDR + beaMasuk;
          const ppn = isImport ? nilaiImpor * 0.11 : 0;
          const tarifPph = parseFloat(state.dutyTarifPph) || 0;
          const pph22 = isImport ? nilaiImpor * tarifPph / 100 : 0;
          const totalPungutan = isImport ? beaMasuk + ppn + pph22 : beaMasuk;
          const showDutyResult = dutyNilai > 0 && kursValid && (tarifBM > 0 || isImport);

          return <>
            <div><Label className="text-xs">{t("book.step.shipmentType")}</Label>
              <Select value={state.shipmentType||undefined} onValueChange={v => set("shipmentType", v)}>
                <SelectTrigger><SelectValue placeholder={t("book.customs.shipmentPh")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Import">Import (PIB)</SelectItem>
                  <SelectItem value="Export">Export (PEB)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("book.customs.serviceTitle")}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Customs Service Fee (IDR)</Label><Input type="number" placeholder="0" value={state.customsFee||""} onChange={e => set("customsFee", e.target.value)} /></div>
                <div><Label className="text-xs">Document Fee (IDR)</Label><Input type="number" placeholder="0" value={state.documentFee||""} onChange={e => set("documentFee", e.target.value)} /></div>
                <div><Label className="text-xs">PIB/PEB Fee (IDR)</Label><Input type="number" placeholder="0" value={state.pibPebFee||""} onChange={e => set("pibPebFee", e.target.value)} /></div>
                <div><Label className="text-xs">Additional Permit Fee (IDR)</Label><Input type="number" placeholder="0" value={state.permitFee||""} onChange={e => set("permitFee", e.target.value)} /></div>
              </div>
            </div>

            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-semibold text-foreground">
                  {isImport ? t("book.customs.dutyTitleImport") : t("book.customs.dutyTitleExport")}
                </span>
                <Badge variant="secondary" className="text-xs">{t("book.customs.optional")}</Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("book.customs.dutyDesc")}
              </p>

              <div>
                <Label className="text-xs">
                  {t("book.customs.hsCode")} <span className="text-muted-foreground">{t("book.customs.hsCodeOptional")}</span>
                </Label>
                <Input placeholder={t("book.customs.hsCodePh")} value={state.dutyHsCode||""} onChange={e => set("dutyHsCode", e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t("book.customs.currency")}</Label>
                  <Select value={state.dutyMataUang||"IDR"} onValueChange={v => set("dutyMataUang", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["IDR","USD","EUR","SGD","JPY","CNY"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {dutyMataUang !== "IDR" && (
                  <div>
                    <Label className="text-xs">Kurs (IDR/{dutyMataUang}) <span className="text-destructive">*</span></Label>
                    <Input
                      type="number"
                      placeholder="Contoh: 16000"
                      value={state.dutyKurs||""}
                      onChange={e => set("dutyKurs", e.target.value)}
                      className={!kursValid ? "border-destructive" : ""}
                    />
                    {!kursValid && dutyNilai > 0 && (
                      <p className="text-xs text-destructive mt-1">{t("book.customs.fillRate")}</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <Label className="text-xs">
                  {isImport ? "Nilai CIF" : "Nilai FOB"}{" "}
                  <span className="text-muted-foreground">({dutyMataUang})</span>
                </Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={state.dutyNilaiBrg||""}
                  onChange={e => set("dutyNilaiBrg", e.target.value)}
                />
                {dutyMataUang !== "IDR" && dutyNilai > 0 && (dutyKurs > 1) && (
                  <p className="text-xs text-muted-foreground mt-1">≈ {formatCurrency(dutyIDR)}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">
                    {isImport ? t("book.customs.tarifBMImport") : t("book.customs.tarifBMExport")}
                  </Label>
                  <Input type="number" placeholder="0" min="0" max="200" step="0.5" value={state.dutyTarifBM||""} onChange={e => set("dutyTarifBM", e.target.value)} />
                </div>
                {isImport && (
                  <div>
                    <Label className="text-xs">{t("book.customs.tarifPph")}</Label>
                    <Select value={state.dutyTarifPph||""} onValueChange={v => set("dutyTarifPph", v)}>
                      <SelectTrigger><SelectValue placeholder={t("book.customs.selectTarif")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2.5">2.5% — API Umum</SelectItem>
                        <SelectItem value="7.5">7.5% — Non-API</SelectItem>
                        <SelectItem value="10">10% — Barang Mewah</SelectItem>
                        <SelectItem value="0">0% — Bebas PPh 22</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {showDutyResult && (
                <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-2 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                    {isImport ? t("book.customs.importDetail") : t("book.customs.exportDetail")}
                  </p>

                  {dutyMataUang !== "IDR" && dutyNilai > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{isImport ? "Nilai CIF" : "Nilai FOB"} ({dutyMataUang})</span>
                      <span>{dutyNilai.toLocaleString("id-ID")} {dutyMataUang}</span>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{isImport ? "Nilai CIF (IDR)" : "Nilai FOB (IDR)"}</span>
                    <span>{formatCurrency(dutyIDR)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {isImport ? "Bea Masuk" : "Bea Keluar"} ({tarifBM}%)
                    </span>
                    <span>{formatCurrency(beaMasuk)}</span>
                  </div>

                  {isImport && (
                    <>
                      <div className="flex justify-between text-muted-foreground text-xs">
                        <span>{t("book.customs.nilaiImpor")}</span>
                        <span>{formatCurrency(nilaiImpor)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("book.customs.ppn")}</span>
                        <span>{formatCurrency(ppn)}</span>
                      </div>
                      {tarifPph > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">PPh Pasal 22 ({tarifPph}%)</span>
                          <span>{formatCurrency(pph22)}</span>
                        </div>
                      )}
                    </>
                  )}

                  <Separator className="border-blue-200 dark:border-blue-700" />
                  <div className="flex justify-between font-bold text-blue-700 dark:text-blue-300">
                    <span>{isImport ? t("book.customs.totalImpor") : t("book.customs.totalEkspor")}</span>
                    <span>{formatCurrency(totalPungutan)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t("book.customs.disclaimer")}</p>
                </div>
              )}
            </div>
          </>;
        })()}

        {ct === "trucking" && <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Pickup City</Label>
              <CityAutocompleteInput type="city" placeholder="Cari kota asal..." value={state.pickupCity||""} onChange={v => set("pickupCity", v)} />
            </div>
            <div>
              <Label className="text-xs">Destination City</Label>
              <CityAutocompleteInput type="city" placeholder="Cari kota tujuan..." value={state.destCity||""} onChange={v => set("destCity", v)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Vehicle Type</Label>
            <Select value={state.vehicleType||undefined} onValueChange={v => set("vehicleType", v)}>
              <SelectTrigger><SelectValue placeholder="Pilih kendaraan" /></SelectTrigger>
              <SelectContent>
                {["CDE", "CDD", "Fuso", "Wingbox", "Trailer"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Distance (km)</Label>
              <Input type="number" placeholder="0" value={state.distance||""} onChange={e => set("distance", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">
                Trucking Rate (IDR/km)
                {!isAdmin && <Lock className="h-3 w-3 text-muted-foreground" />}
              </Label>
              <Input
                type="number" placeholder="0" value={state.truckingRate||""}
                onChange={e => isAdmin && set("truckingRate", e.target.value)}
                readOnly={!isAdmin}
                className={!isAdmin ? "bg-muted text-muted-foreground cursor-not-allowed" : ""}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">
              Loading Fee (IDR)
              {!isAdmin && <Lock className="h-3 w-3 text-muted-foreground" />}
            </Label>
            <Input
              type="number" placeholder="0" value={state.loadingFee||""}
              onChange={e => isAdmin && set("loadingFee", e.target.value)}
              readOnly={!isAdmin}
              className={!isAdmin ? "bg-muted text-muted-foreground cursor-not-allowed" : ""}
            />
          </div>
          {!state.vehicleType && (
            <p className="text-xs text-muted-foreground">{t("book.calc.vehicleHint")}</p>
          )}
        </>}

        {ct === "storage" && <>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Number of Days</Label><Input type="number" placeholder="0" value={state.days||""} onChange={e => set("days", e.target.value)} /></div>
            <div><Label className="text-xs">Quantity</Label><Input type="number" placeholder="1" value={state.quantity||""} onChange={e => set("quantity", e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Unit</Label>
            <Select value={state.unit||undefined} onValueChange={v => set("unit", v)}>
              <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
              <SelectContent>
                {["CBM", "Pallet", "KG"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Rate per Day (IDR)</Label><Input type="number" placeholder="0" value={state.ratePerDay||""} onChange={e => set("ratePerDay", e.target.value)} /></div>
        </>}

        {ct === "document" && <>
          <div><Label className="text-xs">Document Type</Label><Input placeholder="Bill of Lading" value={state.documentType||""} onChange={e => set("documentType", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Quantity</Label><Input type="number" placeholder="1" value={state.quantity||""} onChange={e => set("quantity", e.target.value)} /></div>
            <div><Label className="text-xs">Fee per Document (IDR)</Label><Input type="number" placeholder="0" value={state.feePerDocument||""} onChange={e => set("feePerDocument", e.target.value)} /></div>
          </div>
        </>}

        {ct === "additional" && <>
          <div><Label className="text-xs">Service Type</Label><Input placeholder="Insurance" value={state.serviceType||""} onChange={e => set("serviceType", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Service Fee (IDR)</Label><Input type="number" placeholder="0" value={state.serviceFee||""} onChange={e => set("serviceFee", e.target.value)} /></div>
            <div><Label className="text-xs">Admin Fee (IDR)</Label><Input type="number" placeholder="0" value={state.adminFee||""} onChange={e => set("adminFee", e.target.value)} /></div>
          </div>
        </>}

        {ct === "generic" && <>
          <div><Label className="text-xs">Service Name</Label><Input placeholder={item.name} value={state.serviceName||""} onChange={e => set("serviceName", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Quantity</Label><Input type="number" placeholder="1" value={state.quantity||""} onChange={e => set("quantity", e.target.value)} /></div>
            <div><Label className="text-xs">Unit Price (IDR)</Label><Input type="number" placeholder="0" value={state.unitPrice||""} onChange={e => set("unitPrice", e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Notes (optional)</Label><Input placeholder="Additional details" value={state.notes||""} onChange={e => set("notes", e.target.value)} /></div>
        </>}

        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">{t("book.calc.subtotal")}</span>
          <span className="text-lg font-bold text-accent">{formatCurrency(subtotal)}</span>
        </div>
        <Button className="w-full" onClick={handleAdd} disabled={subtotal <= 0}>
          <Plus className="w-4 h-4 mr-2" /> {t("book.btn.addToOrder")}
        </Button>
      </div>
    </div>
  );
}

// ── Main booking page ─────────────────────────────────────────────────────────
export default function BookPage() {
  const [step, setStep] = useState<Step>(0);
  const [shipmentType, setShipmentType] = useState<ShipmentType | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory | null>(null);
  const [selectedItem, setSelectedItem] = useState<ServiceItem | null>(null);
  const { items: cartItems, addItem, removeItem, subtotal, tax, grandTotal } = useCart();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useLanguage();
  const createOrder = useCreateLogisticOrder();

  const STEPS = [
    t("book.step.shipmentType"),
    t("book.step.selectService"),
    t("book.step.calculator"),
    t("book.step.orderSummary"),
    t("book.step.customerForm"),
  ];

  const [customerForm, setCustomerForm] = useState({
    companyName: "", customerName: "", email: "", phone: "",
    origin: "", destination: "", commodity: "", cargoDescription: "",
    grossWeight: "", volumeCbm: "", requiredDate: "", notes: "",
  });

  const itemsByCategory = useMemo(() =>
    (cat: ServiceCategory) => SERVICE_ITEMS.filter((i) => i.category === cat),
    []
  );

  function handleShipmentSelect(type: ShipmentType) {
    setShipmentType(type);
    setStep(1);
  }

  function handleCategorySelect(cat: ServiceCategory) {
    setSelectedCategory(cat);
    setSelectedItem(null);
  }

  function handleItemSelect(item: ServiceItem) {
    setSelectedItem(item);
  }

  function handleAddToCart(data: Omit<CartItem, "cartId">) {
    addItem(data);
    setSelectedItem(null);
  }

  function handleSubmit() {
    const { companyName, customerName, email, phone, origin, destination } = customerForm;
    if (!companyName || !customerName || !email || !phone || !origin || !destination) {
      toast({ title: t("book.toast.fillForm"), variant: "destructive" });
      return;
    }
    if (cartItems.length === 0) {
      toast({ title: t("book.toast.addService"), variant: "destructive" });
      return;
    }
    createOrder.mutate({ data: {
      companyName,
      customerName,
      email,
      phone,
      shipmentType: shipmentType ?? "",
      origin,
      destination,
      commodity: customerForm.commodity || null,
      cargoDescription: customerForm.cargoDescription || null,
      grossWeight: parseFloat(customerForm.grossWeight) || null,
      volumeCbm: parseFloat(customerForm.volumeCbm) || null,
      requiredDate: customerForm.requiredDate || null,
      notes: customerForm.notes || null,
      subtotal,
      tax,
      grandTotal,
      items: cartItems.map((c) => ({
        category: c.category,
        serviceName: c.serviceName,
        calculatorType: c.calculatorType,
        inputData: c.inputData,
        calculationResult: c.calculationResult,
        subtotal: c.subtotal,
      })),
    }}, {
      onSuccess: (data) => {
        localStorage.setItem("last_order", JSON.stringify(data));
        localStorage.removeItem("logistic_cart");
        setLocation("/order-success");
      },
      onError: () => {
        toast({ title: t("book.toast.saveFailed"), variant: "destructive" });
      },
    });
  }

  const stepContent = () => {
    // Step 0: Shipment Type
    if (step === 0) return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground mb-1">{t("book.heading.chooseShipmentType")}</h2>
          <p className="text-sm text-muted-foreground">{t("book.heading.chooseShipmentTypeDesc")}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {SHIPMENT_TYPES.map(({ type, description, icon }) => {
            const Icon = ICON_MAP[icon] || Package;
            return (
              <button
                key={type}
                onClick={() => handleShipmentSelect(type)}
                className={`text-left p-5 rounded-xl border-2 transition-all hover:shadow-md ${
                  shipmentType === type
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/50"
                }`}
              >
                <Icon className="w-8 h-8 text-accent mb-3" />
                <p className="font-bold text-foreground text-sm mb-1">{type}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </button>
            );
          })}
        </div>
      </div>
    );

    // Step 1: Category & Item selection
    if (step === 1) return (
      <div className="space-y-4">
        {!selectedItem ? (
          <>
            <div>
              <h2 className="text-xl font-bold text-foreground mb-1">
                {!selectedCategory ? t("book.heading.selectCategory") : selectedCategory}
              </h2>
              <p className="text-sm text-muted-foreground">
                {!selectedCategory
                  ? t("book.heading.selectCategoryDesc")
                  : t("book.heading.selectedCategoryDesc")}
              </p>
            </div>

            {!selectedCategory ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CATEGORIES.map((cat) => {
                  const Icon = ICON_MAP[cat.icon] || Package;
                  const count = itemsByCategory(cat.name).length;
                  return (
                    <button
                      key={cat.name}
                      onClick={() => handleCategorySelect(cat.name)}
                      className="text-left p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-foreground text-sm">{cat.name}</p>
                            <Badge variant="secondary" className="text-xs">{count} items</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{cat.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
                >
                  <ChevronLeft className="w-4 h-4" /> {t("book.btn.allCategories")}
                </button>
                <div className="space-y-2">
                  {itemsByCategory(selectedCategory).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleItemSelect(item)}
                      className="w-full text-left p-4 rounded-lg border border-border bg-card hover:border-primary/50 hover:shadow-sm transition-all flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-semibold text-foreground text-sm">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      </div>
                      <Calculator className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <CalculatorForm
            item={selectedItem}
            onAdd={(data) => { handleAddToCart(data); setStep(2); }}
            onBack={() => setSelectedItem(null)}
          />
        )}
      </div>
    );

    // Step 2: Cart
    if (step === 2) return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">{t("book.heading.orderSummary")}</h2>
            <p className="text-sm text-muted-foreground">{cartItems.length} {t("book.cart.servicesSelected")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setStep(1)}>
            <Plus className="w-3 h-3 mr-1" /> {t("book.btn.addService")}
          </Button>
        </div>

        {cartItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{t("book.cart.empty")}</p>
            <p className="text-sm mt-1">{t("book.cart.emptyDesc")}</p>
            <Button className="mt-4" onClick={() => setStep(1)}>{t("book.cart.selectService")}</Button>
          </div>
        ) : (
          <>
            <div className="rounded-xl border-2 border-primary/20 bg-primary/5 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/10 border-b border-primary/20">
                <Package className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold text-primary uppercase tracking-wide">{t("book.cart.order")}</span>
                <span className="text-xs text-primary/70">— {t("book.cart.allInOnePackage")}</span>
              </div>
              <div className="p-3 space-y-2">
                {cartItems.map((item, idx) => (
                  <div key={item.cartId}>
                    {idx > 0 && (
                      <div className="flex items-center gap-2 py-1">
                        <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0 ml-2">
                          <span className="text-[10px] font-bold text-muted-foreground">+</span>
                        </div>
                        <div className="flex-1 border-t border-dashed border-border" />
                      </div>
                    )}
                    <div className="bg-card border border-border rounded-lg p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <Badge variant="outline" className="text-xs mb-1">{item.category}</Badge>
                          <p className="font-semibold text-foreground text-sm">{item.serviceName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {Object.entries(item.inputData)
                              .filter(([, v]) => v)
                              .slice(0, 3)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-bold text-accent text-sm">{formatCurrency(item.subtotal)}</span>
                          <button
                            onClick={() => removeItem(item.cartId)}
                            className="text-destructive hover:text-destructive/80"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-muted/40 rounded-lg border border-border p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("book.calc.subtotal")}</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("book.ppn")}</span>
                <span className="font-medium">{formatCurrency(tax)}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="font-bold text-foreground">{t("book.totalEstimate")}</span>
                <span className="font-bold text-accent text-lg">{formatCurrency(grandTotal)}</span>
              </div>
              <p className="text-xs text-muted-foreground italic">{t("book.cart.estimateNote")}</p>
            </div>
          </>
        )}
      </div>
    );

    // Step 3: Customer Form
    if (step === 3) {
      const f = customerForm;
      const setField = (k: string, v: string) => setCustomerForm((p) => ({ ...p, [k]: v }));
      return (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">{t("book.heading.companyData")}</h2>
            <p className="text-sm text-muted-foreground">{t("book.heading.companyDataDesc")}</p>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <User className="w-4 h-4 text-accent" /> {t("book.section.company")}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("book.form.company")}</Label><Input placeholder={t("book.form.companyPh")} value={f.companyName} onChange={e => setField("companyName", e.target.value)} /></div>
              <div><Label className="text-xs">{t("book.form.pic")}</Label><Input placeholder={t("book.form.picPh")} value={f.customerName} onChange={e => setField("customerName", e.target.value)} /></div>
              <div><Label className="text-xs">{t("book.form.email")}</Label><Input type="email" placeholder={t("book.form.emailPh")} value={f.email} onChange={e => setField("email", e.target.value)} /></div>
              <div><Label className="text-xs">{t("book.form.phone")}</Label><Input placeholder={t("book.form.phonePh")} value={f.phone} onChange={e => setField("phone", e.target.value)} /></div>
            </div>

            <Separator />
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Ship className="w-4 h-4 text-accent" /> {t("book.section.shipment")}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("book.form.origin")}</Label><Input placeholder={t("book.form.originPh")} value={f.origin} onChange={e => setField("origin", e.target.value)} /></div>
              <div><Label className="text-xs">{t("book.form.destination")}</Label><Input placeholder={t("book.form.destinationPh")} value={f.destination} onChange={e => setField("destination", e.target.value)} /></div>
              <div><Label className="text-xs">{t("book.form.commodity")}</Label><Input placeholder={t("book.form.commodityPh")} value={f.commodity} onChange={e => setField("commodity", e.target.value)} /></div>
              <div><Label className="text-xs">{t("book.form.requiredDate")}</Label><Input type="date" value={f.requiredDate} onChange={e => setField("requiredDate", e.target.value)} /></div>
              <div><Label className="text-xs">{t("book.form.grossWeight")}</Label><Input type="number" placeholder="0" value={f.grossWeight} onChange={e => setField("grossWeight", e.target.value)} /></div>
              <div><Label className="text-xs">{t("book.form.volume")}</Label><Input type="number" placeholder="0" value={f.volumeCbm} onChange={e => setField("volumeCbm", e.target.value)} /></div>
            </div>
            <div><Label className="text-xs">{t("book.form.cargoDesc")}</Label><Textarea placeholder={t("book.form.cargoDescPh")} value={f.cargoDescription} onChange={e => setField("cargoDescription", e.target.value)} rows={2} /></div>
            <div><Label className="text-xs">{t("book.form.notes")}</Label><Textarea placeholder={t("book.form.notesPh")} value={f.notes} onChange={e => setField("notes", e.target.value)} rows={2} /></div>
          </div>
        </div>
      );
    }

    return null;
  };

  const canProceed = () => {
    if (step === 0) return !!shipmentType;
    if (step === 1) return false;
    if (step === 2) return cartItems.length > 0;
    if (step === 3) return !!(customerForm.companyName && customerForm.customerName && customerForm.email && customerForm.phone && customerForm.origin && customerForm.destination);
    return false;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="border-b border-border bg-card sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => setLocation("/")} className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ArrowLeft className="w-4 h-4" />
            {t("book.btn.booking")}
          </button>
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{cartItems.length}</span>
          </div>
        </div>
      </nav>

      {/* Stepper */}
      <div className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center gap-1">
            {STEPS.map((label, idx) => (
              <div key={idx} className="flex items-center">
                <div className={`flex items-center gap-1.5 ${idx <= step ? "opacity-100" : "opacity-40"}`}>
                  <div className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
                    idx < step ? "bg-accent text-accent-foreground" :
                    idx === step ? "bg-primary text-primary-foreground" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {idx < step ? <CheckCircle2 className="w-3 h-3" /> : idx + 1}
                  </div>
                  <span className={`text-xs hidden sm:block ${idx === step ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                    {label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-border mx-1" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {stepContent()}

        {/* Navigation buttons */}
        {step !== 1 && (
          <div className="flex justify-between mt-8 pt-4 border-t border-border">
            <Button
              variant="outline"
              onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
              disabled={step === 0}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> {t("book.btn.back")}
            </Button>
            {step < 3 ? (
              <Button
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={!canProceed()}
              >
                {t("book.btn.continue")} <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={createOrder.isPending || !canProceed()}
                className="bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
              >
                {createOrder.isPending ? t("book.btn.saving") : t("book.btn.submit")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
