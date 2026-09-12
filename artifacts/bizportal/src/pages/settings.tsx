import { useState, useEffect, useRef, type ElementType } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { User, Mail, Briefcase, Shield, MessageCircle, Save, Loader2, CheckCircle, Calculator, ChevronDown, ChevronUp, Package, Plus, X, Bot, Link2, RotateCcw, History, RefreshCw, Download, Layers, ExternalLink, FileText, Truck, ShoppingCart, Users, Building2, Ship, ArrowRight, Send, XCircle, Key } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";

interface CalcRates {
  airFreight:  { baseCost: number; ratePerKg: number;  handlingPct: number; customsFee: number };
  seaFreight:  { baseCost: number; ratePerCbm: number; handlingPct: number; customsFee: number };
  customs:     { baseCost: number; ratePerKg: number;  handlingFee: number; customsPct: number };
  domestic:    { baseCost: number; ratePerKg: number;  handlingPct: number };
  warehousing: { baseCost: number; ratePerCbm: number; handlingFee: number };
}

const DEFAULT_RATES: CalcRates = {
  airFreight:  { baseCost: 500000,  ratePerKg: 90000,    handlingPct: 5, customsFee: 1200000 },
  seaFreight:  { baseCost: 750000,  ratePerCbm: 2500000, handlingPct: 5, customsFee: 1500000 },
  customs:     { baseCost: 1500000, ratePerKg: 5000,     handlingFee: 500000, customsPct: 0.5 },
  domestic:    { baseCost: 500000,  ratePerKg: 8500,     handlingPct: 5 },
  warehousing: { baseCost: 5000000, ratePerCbm: 2500000, handlingFee: 500000 },
};

type ServiceKey = keyof CalcRates;

const SERVICE_LABELS: Record<ServiceKey, string> = {
  airFreight:  "Air Freight (Udara)",
  seaFreight:  "Sea Freight (Laut)",
  customs:     "Customs / Kepabeanan",
  domestic:    "Domestic / Lokal",
  warehousing: "Warehousing / Gudang",
};

type FieldDef = { key: string; label: string; unit: string };
const SERVICE_FIELDS: Record<ServiceKey, FieldDef[]> = {
  airFreight: [
    { key: "baseCost",    label: "Biaya Dasar",           unit: "IDR" },
    { key: "ratePerKg",   label: "Tarif per Kg",          unit: "IDR/kg" },
    { key: "handlingPct", label: "Handling Fee",          unit: "%" },
    { key: "customsFee",  label: "Biaya Bea Cukai",       unit: "IDR" },
  ],
  seaFreight: [
    { key: "baseCost",    label: "Biaya Dasar",           unit: "IDR" },
    { key: "ratePerCbm",  label: "Tarif per CBM",         unit: "IDR/CBM" },
    { key: "handlingPct", label: "Handling Fee",          unit: "%" },
    { key: "customsFee",  label: "Biaya Bea Cukai",       unit: "IDR" },
  ],
  customs: [
    { key: "baseCost",    label: "Biaya Dasar",           unit: "IDR" },
    { key: "ratePerKg",   label: "Tarif per Kg",          unit: "IDR/kg" },
    { key: "handlingFee", label: "Biaya Handling",        unit: "IDR" },
    { key: "customsPct",  label: "Bea Masuk (%)",         unit: "%" },
  ],
  domestic: [
    { key: "baseCost",    label: "Biaya Dasar",           unit: "IDR" },
    { key: "ratePerKg",   label: "Tarif per Kg",          unit: "IDR/kg" },
    { key: "handlingPct", label: "Handling Fee",          unit: "%" },
  ],
  warehousing: [
    { key: "baseCost",    label: "Biaya Dasar",           unit: "IDR" },
    { key: "ratePerCbm",  label: "Tarif per CBM/bulan",  unit: "IDR/CBM" },
    { key: "handlingFee", label: "Biaya Handling",        unit: "IDR" },
  ],
};

function CalculatorRatesCard() {

  const { toast } = useToast();
  const { t } = useLanguage();
  const [rates, setRates] = useState<CalcRates>(DEFAULT_RATES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState<ServiceKey | null>("airFreight");

  useEffect(() => {
    void (async () => {
      try {
        
        const res = await fetch("/api/settings/calculator-rates", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json() as CalcRates;
          setRates(data);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  function updateField(service: ServiceKey, field: string, raw: string) {
    const num = parseFloat(raw);
    if (isNaN(num) && raw !== "") return;
    setRates((prev) => ({
      ...prev,
      [service]: { ...(prev[service] as Record<string, number>), [field]: isNaN(num) ? 0 : num },
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      
      const res = await fetch("/api/settings/calculator-rates", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          
        },
        body: JSON.stringify(rates),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: t.common.success });
    } catch (err) {
      toast({ title: t.common.error, description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          Tarif Kalkulator Estimasi Biaya
        </CardTitle>
        <CardDescription>
          Konfigurasi tarif dasar untuk setiap jenis layanan logistik. Tarif ini digunakan oleh kalkulator di Customer Portal
          untuk menghitung estimasi biaya otomatis berdasarkan input pelanggan (berat, dimensi, rute).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map((i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : (
          <>
            {(Object.keys(SERVICE_LABELS) as ServiceKey[]).map((svc) => {
              const isOpen = expanded === svc;
              const fields = SERVICE_FIELDS[svc];
              const rateRow = rates[svc] as Record<string, number>;
              return (
                <div key={svc} className="rounded-xl border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : svc)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
                  >
                    <span className="font-semibold text-foreground text-sm">{SERVICE_LABELS[svc]}</span>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>
                  {isOpen && (
                    <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-background">
                      {fields.map(({ key, label, unit }) => (
                        <div key={key} className="space-y-1.5">
                          <Label htmlFor={`${svc}-${key}`} className="text-xs text-muted-foreground font-medium">
                            {label}
                          </Label>
                          <div className="relative">
                            <Input
                              id={`${svc}-${key}`}
                              type="number"
                              min="0"
                              step={unit === "%" ? "0.1" : "1000"}
                              value={rateRow[key] ?? ""}
                              onChange={(e) => updateField(svc, key, e.target.value)}
                              className="pr-16 text-right font-mono text-sm"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                              {unit}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Formula: Biaya Dasar + (Berat/CBM × Tarif) + Handling + Bea Cukai
              </p>
              <Button
                onClick={handleSave}
                disabled={saving}
                size="sm"
                className="gap-2"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <CheckCircle className="h-4 w-4 text-green-400" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? "Menyimpan..." : saved ? "Tersimpan!" : "Simpan Tarif"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LogisticsSubcategoriesCard() {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [cats, setCats] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newCat, setNewCat] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/logistics-subcategories", { credentials: "include" });
        if (res.ok) setCats(await res.json() as string[]);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  function addCat() {
    const v = newCat.trim();
    if (!v || cats.includes(v)) { setNewCat(""); return; }
    setCats((prev) => [...prev, v]);
    setNewCat("");
  }

  function removeCat(idx: number) {
    setCats((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/logistics-subcategories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(cats),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: t.common.success });
    } catch (err) {
      toast({ title: t.common.error, description: String(err), variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          Sub-Kategori Logistik
        </CardTitle>
        <CardDescription>
          Daftar sub-kategori jasa logistik yang tersedia sebagai pilihan dropdown di BizPortal (Sales Items, Katalog, Quote Editor) dan Customer Portal Admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-8 rounded bg-muted animate-pulse" />)}</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 min-h-[40px]">
              {cats.length === 0 && <p className="text-sm text-muted-foreground italic">Belum ada item — tambahkan di bawah</p>}
              {cats.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-sm bg-muted border border-border rounded-full px-3 py-1">
                  {c}
                  <button type="button" onClick={() => removeCat(i)} className="ml-1 text-muted-foreground hover:text-destructive transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 max-w-sm">
              <Input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCat(); } }}
                placeholder="cth: Cold Chain, Project Cargo"
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addCat} className="gap-1 shrink-0">
                <Plus className="h-4 w-4" /> Tambah
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Tekan Enter atau klik Tambah. Klik × untuk hapus item.</p>
            <div className="flex justify-end pt-1 border-t border-border">
              <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle className="h-4 w-4 text-green-400" /> : <Save className="h-4 w-4" />}
                {saving ? "Menyimpan..." : saved ? "Tersimpan!" : "Simpan Daftar"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CargoTypesCard() {

  const { toast } = useToast();
  const { t } = useLanguage();
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newType, setNewType] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        
        const res = await fetch("/api/settings/cargo-types", {
          credentials: "include",
        });
        if (res.ok) setTypes(await res.json() as string[]);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  function addType() {
    const t = newType.trim();
    if (!t || types.includes(t)) { setNewType(""); return; }
    setTypes((prev) => [...prev, t]);
    setNewType("");
  }

  function removeType(idx: number) {
    setTypes((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    try {
      
      const res = await fetch("/api/settings/cargo-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(types),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: t.common.success });
    } catch (err) {
      toast({ title: t.common.error, description: String(err), variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          Daftar Cargo Type
        </CardTitle>
        <CardDescription>
          Daftar jenis kargo yang tersedia sebagai pilihan autocomplete di kalkulator Customer Portal.
          Pelanggan bisa mengetik untuk mencari atau pilih dari daftar ini.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-8 rounded bg-muted animate-pulse" />)}</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 min-h-[40px]">
              {types.length === 0 && <p className="text-sm text-muted-foreground italic">Belum ada item — tambahkan di bawah</p>}
              {types.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-sm bg-muted border border-border rounded-full px-3 py-1">
                  {t}
                  <button type="button" onClick={() => removeType(i)} className="ml-1 text-muted-foreground hover:text-destructive transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 max-w-sm">
              <Input
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addType(); } }}
                placeholder="Contoh: Electronics"
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addType} className="gap-1 shrink-0">
                <Plus className="h-4 w-4" /> Tambah
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Tekan Enter atau klik Tambah. Klik × untuk hapus item.</p>
            <div className="flex justify-end pt-1 border-t border-border">
              <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle className="h-4 w-4 text-green-400" /> : <Save className="h-4 w-4" />}
                {saving ? "Menyimpan..." : saved ? "Tersimpan!" : "Simpan Daftar"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type VendorFilterMode = "all" | "by-service-type";

interface AiIntakeSettingsData {
  enabled: boolean;
  replyWaTemplate: string;
  replyEmailSubject: string;
  replyEmailBody: string;
  vendorFilterMode: VendorFilterMode;
}

function AiIntakeSettingsCard() {

  const { toast } = useToast();
  const { t } = useLanguage();
  const [data, setData] = useState<AiIntakeSettingsData>({
    enabled: true,
    replyWaTemplate: "",
    replyEmailSubject: "",
    replyEmailBody: "",
    vendorFilterMode: "by-service-type",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        
        const res = await fetch("/api/settings/ai-intake", {
          credentials: "include",
        });
        if (res.ok) {
          const json = await res.json() as AiIntakeSettingsData;
          setData(json);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      
      const res = await fetch("/api/settings/ai-intake", {
        method: "PUT",
        headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: t.common.success });
    } catch (err) {
      toast({ title: t.common.error, description: String(err), variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-400" />
          AI Order Intake
        </CardTitle>
        <CardDescription>
          Ketika email atau WhatsApp masuk berisi inquiry order/freight, AI akan otomatis mengekstrak
          data dan membuat draft penawaran di menu <strong>Sales › AI Drafts</strong> untuk direview admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div>
                <p className="font-medium text-sm">Aktifkan AI Intake</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  AI akan memproses setiap email/WA masuk dan membuat draft jika terdeteksi sebagai inquiry order
                </p>
              </div>
              <Switch
                checked={data.enabled}
                onCheckedChange={(v) => setData((d) => ({ ...d, enabled: v }))}
              />
            </div>

            <div className="rounded-lg border border-border p-4 space-y-3">
              <div>
                <p className="font-medium text-sm">Filter Vendor Default</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Menentukan vendor mana yang menerima RFQ saat forward-to-vendor dilakukan tanpa pemilihan manual
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="vendorFilterMode"
                    value="by-service-type"
                    checked={data.vendorFilterMode === "by-service-type"}
                    onChange={() => setData((d) => ({ ...d, vendorFilterMode: "by-service-type" }))}
                    className="mt-0.5"
                    disabled={!data.enabled}
                  />
                  <span>
                    <span className="text-sm font-medium">Cocokkan dengan moda transportasi</span>
                    <span className="block text-xs text-muted-foreground">Hanya kirim ke vendor dengan serviceType yang sesuai (misal: air freight untuk moda udara)</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="vendorFilterMode"
                    value="all"
                    checked={data.vendorFilterMode === "all"}
                    onChange={() => setData((d) => ({ ...d, vendorFilterMode: "all" }))}
                    className="mt-0.5"
                    disabled={!data.enabled}
                  />
                  <span>
                    <span className="text-sm font-medium">Semua vendor aktif</span>
                    <span className="block text-xs text-muted-foreground">Kirim ke seluruh vendor/supplier yang aktif tanpa filter serviceType</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-reply-wa">Template Balasan WhatsApp Otomatis</Label>
              <Textarea
                id="ai-reply-wa"
                value={data.replyWaTemplate}
                onChange={(e) => setData((d) => ({ ...d, replyWaTemplate: e.target.value }))}
                rows={4}
                className="font-mono text-sm"
                placeholder="Gunakan {docNumber} untuk menyisipkan nomor draft"
                disabled={!data.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Gunakan <code className="bg-muted px-1 rounded">{"{docNumber}"}</code> untuk menyisipkan nomor draft secara otomatis.
                Kosongkan untuk tidak mengirim balasan.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-email-subj">Subject Email Balasan Otomatis</Label>
              <Input
                id="ai-email-subj"
                value={data.replyEmailSubject}
                onChange={(e) => setData((d) => ({ ...d, replyEmailSubject: e.target.value }))}
                placeholder="[Draft Diterima] {docNumber} — Terima kasih"
                disabled={!data.enabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-email-body">Isi Email Balasan Otomatis</Label>
              <Textarea
                id="ai-email-body"
                value={data.replyEmailBody}
                onChange={(e) => setData((d) => ({ ...d, replyEmailBody: e.target.value }))}
                rows={5}
                className="font-mono text-sm"
                placeholder="Gunakan {docNumber} untuk menyisipkan nomor draft"
                disabled={!data.enabled}
              />
            </div>

            <div className="flex justify-end pt-1 border-t border-border">
              <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle className="h-4 w-4 text-green-400" /> : <Save className="h-4 w-4" />}
                {saving ? "Menyimpan..." : saved ? "Tersimpan!" : "Simpan Pengaturan"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function WhatsAppNotificationCard() {

  const { toast } = useToast();
  const { t } = useLanguage();
  const [adminWa, setAdminWa] = useState("");
  const [adminGroupWa, setAdminGroupWa] = useState("");
  const [adminPhones, setAdminPhones] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testTarget, setTestTarget] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/notifications", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json() as { adminWa: string; adminGroupWa?: string; adminPhones?: string };
          setAdminWa(data.adminWa ?? "");
          setAdminGroupWa(data.adminGroupWa ?? "");
          setAdminPhones(data.adminPhones ?? "");
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminWa, adminGroupWa, adminPhones }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: t.common.success });
    } catch (err) {
      toast({ title: t.common.error, description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestWa() {
    const target = testTarget.trim() || adminWa.trim();
    if (!target) {
      toast({ title: "Isi nomor tujuan test terlebih dahulu", variant: "destructive" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/secrets/test-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ target }),
      });
      const d = await res.json() as { ok?: boolean; message?: string };
      if (res.ok && d.ok) {
        setTestResult({ ok: true, msg: `Pesan test berhasil dikirim ke ${target}` });
      } else {
        setTestResult({ ok: false, msg: d.message ?? "Gagal mengirim" });
      }
    } catch (err) {
      setTestResult({ ok: false, msg: String(err) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          Notifikasi WhatsApp
        </CardTitle>
        <CardDescription>
          Konfigurasi nomor dan grup WhatsApp yang menerima notifikasi otomatis saat ada order baru.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full max-w-sm bg-muted" />
            <Skeleton className="h-10 w-full max-w-sm bg-muted" />
          </div>
        ) : (
          <div className="flex flex-col gap-5 max-w-lg">
            <div className="space-y-1.5">
              <Label htmlFor="admin-wa">Nomor WhatsApp Admin (Personal)</Label>
              <Input
                id="admin-wa"
                value={adminWa}
                onChange={(e) => setAdminWa(e.target.value)}
                placeholder="628xxxxxxxxxx"
              />
              <p className="text-xs text-muted-foreground">
                Menerima notifikasi untuk Sales Quotation, Sales Order, Logistik, dan E-commerce Order.
                Format: <code>6281234567890</code>
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-group-wa" className="flex items-center gap-1.5">
                Group ID WhatsApp Admin
                <span className="text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 rounded px-1.5 py-0.5">
                  Push Notif Grup
                </span>
              </Label>
              <Input
                id="admin-group-wa"
                value={adminGroupWa}
                onChange={(e) => setAdminGroupWa(e.target.value)}
                placeholder="120363xxxxxxxxxx@g.us"
              />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  Setiap order logistik baru dari Customer Portal akan dikirim ke grup ini dengan detail lengkap dan nomor tracking otomatis.
                </p>
                <p className="text-amber-600 dark:text-amber-400">
                  ⚠️ Isi dengan Group ID Fonnte (format <code>120363xxxxxxxxxx@g.us</code>).
                  Kosongkan jika tidak ingin notifikasi grup.
                </p>
                <p>
                  Cara cari Group ID: Kirim pesan dari grup ke bot Fonnte, lalu cek log di dashboard Fonnte — Group ID terlihat di kolom <em>target</em>.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-phones" className="flex items-center gap-1.5">
                Nomor Admin Perintah WA
                <span className="text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 rounded px-1.5 py-0.5">
                  Whitelist Bot
                </span>
              </Label>
              <Input
                id="admin-phones"
                value={adminPhones}
                onChange={(e) => setAdminPhones(e.target.value)}
                placeholder="628111111111,628222222222"
              />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  Daftar nomor yang diizinkan mengirim perintah ke bot WhatsApp (webhook Fonnte). Hanya pesan dari nomor-nomor ini yang akan diproses sebagai perintah admin.
                </p>
                <p className="text-amber-600 dark:text-amber-400">
                  ⚠️ Pisahkan beberapa nomor dengan koma, tanpa spasi. Format: <code>628111111111,628222222222</code>.
                  Kosongkan untuk menonaktifkan filter (semua pesan diproses).
                </p>
              </div>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving}
              size="sm"
              className="gap-2 w-fit"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Menyimpan..." : saved ? "Tersimpan!" : "Simpan"}
            </Button>

            {/* ── Test WA Section ── */}
            <div className="border-t pt-5 space-y-3">
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Send className="h-4 w-4 text-green-600" />
                Kirim Test WhatsApp
              </p>
              <p className="text-xs text-muted-foreground">
                Verifikasi konfigurasi Fonnte dengan mengirim pesan test. Kosongkan untuk kirim ke Nomor Admin di atas.
              </p>
              <div className="flex gap-2 items-center">
                <Input
                  value={testTarget}
                  onChange={(e) => { setTestTarget(e.target.value); setTestResult(null); }}
                  placeholder={adminWa || "628xxxxxxxxxx"}
                  className="h-8 text-sm max-w-[220px]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTestWa}
                  disabled={testing}
                  className="gap-2 h-8 border-green-300 text-green-700 hover:bg-green-50"
                >
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {testing ? "Mengirim..." : "Kirim Test"}
                </Button>
              </div>
              {testResult && (
                <div className={`flex items-start gap-2 text-xs rounded-md px-3 py-2 ${testResult.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                  {testResult.ok
                    ? <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    : <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                  {testResult.msg}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VendorMiniFormCard() {
  const [stats, setStats] = useState<{ links: number; activeLinks: number; submissions: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [links, subs] = await Promise.all([
          fetch("/api/vendor-form/admin/links", { credentials: "include" }).then(r => r.json()),
          fetch("/api/vendor-form/admin/submissions", { credentials: "include" }).then(r => r.json()),
        ]);
        const linksArr = Array.isArray(links) ? links : [];
        const subsArr = Array.isArray(subs) ? subs : [];
        const now = new Date();
        setStats({
          links: linksArr.length,
          activeLinks: linksArr.filter((l: { isActive: boolean; expiresAt: string | null }) =>
            l.isActive && (!l.expiresAt || new Date(l.expiresAt) >= now)
          ).length,
          submissions: subsArr.length,
        });
      } catch { /* noop */ }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Link2 className="h-5 w-5 text-indigo-400" />
          Vendor Mini Form
        </CardTitle>
        <CardDescription>
          Buat dan kelola link form dinamis untuk vendor mengisi rate/data layanan.
          Setiap link berisi field sesuai service type yang dapat dibagikan langsung ke vendor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-background p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{stats.links}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Link</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-4 text-center">
              <p className="text-2xl font-bold text-green-500">{stats.activeLinks}</p>
              <p className="text-xs text-muted-foreground mt-1">Link Aktif</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-4 text-center">
              <p className="text-2xl font-bold text-indigo-400">{stats.submissions}</p>
              <p className="text-xs text-muted-foreground mt-1">Submission Masuk</p>
            </div>
          </div>
        ) : null}

        <div className="pt-2 border-t border-border flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Kelola semua link form, lihat submission masuk, dan bagikan ke vendor di halaman khusus Mini Form.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-2 shrink-0"
            onClick={() => { window.location.href = "/bizportal/purchase/vendor-forms"; }}
          >
            <Link2 className="h-4 w-4" />
            Buka Manajemen Mini Form
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page Content Editor ────────────────────────────────────────────────────────

const DEFAULT_ADMIN_REVIEW_CONTENT = {
  pageTitle: "Review & Blast Vendor",
  pageSubtitle: "B2B Marketplace and Logistic — Admin Panel",
  deadlineLabel: "Batas Waktu Respon Vendor",
  vendorSectionTitle: "Pilih Vendor",
  blastHint: "Vendor akan menerima WA dengan link form penawaran",
};

function PageContentCard() {
  const { toast } = useToast();
  const [fields, setFields] = useState({ ...DEFAULT_ADMIN_REVIEW_CONTENT });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/page-content", { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as { admin_review?: typeof DEFAULT_ADMIN_REVIEW_CONTENT };
          if (data.admin_review) setFields((p) => ({ ...p, ...data.admin_review }));
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/page-content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ admin_review: fields }),
      });
      if (!res.ok) throw new Error("Gagal menyimpan");
      toast({ title: "Tersimpan", description: "Konten halaman berhasil diperbarui." });
    } catch {
      toast({ title: "Error", description: "Gagal menyimpan konten.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setFields({ ...DEFAULT_ADMIN_REVIEW_CONTENT });
    toast({ title: "Direset", description: "Konten dikembalikan ke default." });
  }

  const fieldMeta: { key: keyof typeof DEFAULT_ADMIN_REVIEW_CONTENT; label: string; desc: string }[] = [
    { key: "pageTitle",           label: "Judul Halaman",        desc: "Judul utama di header halaman admin blast" },
    { key: "pageSubtitle",        label: "Subjudul / Branding",  desc: "Teks kecil di bawah judul (nama perusahaan, dsb.)" },
    { key: "deadlineLabel",       label: "Label Batas Waktu",    desc: "Label di atas pilihan batas waktu respon vendor" },
    { key: "vendorSectionTitle",  label: "Judul Bagian Vendor",  desc: "Heading di atas daftar vendor tersedia" },
    { key: "blastHint",           label: "Hint Blast",           desc: "Teks kecil di bawah tombol Blast" },
  ];

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          Konten Halaman Admin
        </CardTitle>
        <CardDescription>
          Edit teks yang tampil di halaman "Review & Blast Vendor" yang dibuka admin dari link WA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-10 w-full bg-muted" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fieldMeta.map(({ key, label, desc }) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-sm font-medium">{label}</Label>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                  <Input
                    value={fields[key]}
                    onChange={(e) => setFields((p) => ({ ...p, [key]: e.target.value }))}
                    className="bg-background border-border"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-border">
              <Button variant="ghost" size="sm" onClick={handleReset} className="gap-2 text-muted-foreground">
                <RotateCcw className="h-4 w-4" /> Reset Default
              </Button>
              <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Simpan Perubahan
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}


// ── Freight Stage Labels ──────────────────────────────────────────────────────

const DEFAULT_STAGE_LABELS = { booking: "Booking", trucking: "Trucking", handling: "Handling", customs: "Customs Clearance" };
type StageLabelKey = keyof typeof DEFAULT_STAGE_LABELS;

function FreightStageLabelsCard() {
  const { toast } = useToast();
  const [labels, setLabels] = useState({ ...DEFAULT_STAGE_LABELS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/freight-stage-labels", { credentials: "include" });
        if (res.ok) {
          const data = await res.json() as { labels: typeof DEFAULT_STAGE_LABELS };
          if (data.labels) setLabels(prev => ({ ...prev, ...data.labels }));
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/freight-stage-labels", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ labels }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Label stage tersimpan" });
    } catch (e) {
      toast({ title: "Gagal menyimpan", description: String(e), variant: "destructive" });
    } finally { setSaving(false); }
  }

  function handleReset() {
    setLabels({ ...DEFAULT_STAGE_LABELS });
    toast({ title: "Direset ke default" });
  }

  const stageMeta: { key: StageLabelKey; desc: string }[] = [
    { key: "booking",  desc: "Stage pertama — pemesanan ruang/slot pengiriman" },
    { key: "trucking", desc: "Stage angkutan darat / trucking" },
    { key: "handling", desc: "Stage handling / bongkar muat di gudang/pelabuhan" },
    { key: "customs",  desc: "Stage kepabeanan / customs clearance" },
  ];

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          Label Stage Operasional Freight
        </CardTitle>
        <CardDescription>
          Ubah nama tampilan tiap tahapan di halaman detail freight shipment. Perubahan berlaku langsung tanpa deploy ulang.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {stageMeta.map(({ key, desc }) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-sm font-medium capitalize">{key}</Label>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                  <Input
                    value={labels[key]}
                    onChange={e => setLabels(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={DEFAULT_STAGE_LABELS[key]}
                    className="bg-background border-border"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-border">
              <Button variant="ghost" size="sm" onClick={handleReset} className="gap-2 text-muted-foreground">
                <RotateCcw className="h-4 w-4" /> Reset Default
              </Button>
              <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Simpan
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── WA Template Editor (Upgraded GB1) ─────────────────────────────────────────
type RecipientKey = "admin_personal" | "admin_group" | "customer" | "vendor";
type WorkflowKey =
  | "order_new" | "vendor_request" | "vendor_submission" | "vendor_revision"
  | "vendor_submit_confirm" | "vendor_rfq_forward" | "vendor_submission_summary"
  | "revision_fallback" | "customer_rejection" | "op_confirm_submitted" | "customer_rfq_response"
  | "customer_approval" | "customer_approved" | "so_created" | "op_request"
  | "driver_assigned" | "shipment_update" | "customs_update" | "delivery_completed"
  | "rfq_vendor_recap"
  | "product_order_new" | "product_order_status_update";
type ServiceTypeSim = "trucking" | "freight_sea" | "freight_air" | "ppjk" | "product" | "handling" | "";

const WORKFLOW_VALID_RECIPIENTS: Partial<Record<WorkflowKey, RecipientKey[]>> = {
  product_order_new:         ["admin_personal", "admin_group", "customer"],
  vendor_submit_confirm:     ["vendor"],
  vendor_rfq_forward:        ["vendor"],
  vendor_submission_summary: ["admin_personal"],
  rfq_vendor_recap:          ["admin_personal"],
  revision_fallback:         ["vendor"],
  customer_rejection:        ["admin_personal"],
  op_confirm_submitted:      ["admin_personal"],
  customer_rfq_response:     ["admin_personal"],
};

const RECIPIENT_META: Record<RecipientKey, { label: string; icon: string }> = {
  admin_personal: { label: "Admin Pribadi", icon: "👤" },
  admin_group:    { label: "Grup Admin",    icon: "👥" },
  customer:       { label: "Customer",      icon: "🛍️" },
  vendor:         { label: "Vendor",        icon: "🏭" },
};

const WORKFLOW_META: Record<WorkflowKey, { label: string; icon: string; desc: string }> = {
  order_new:          { label: "Order Baru",          icon: "📦", desc: "Notifikasi saat order baru masuk dari customer portal" },
  vendor_request:     { label: "Vendor Request",      icon: "📋", desc: "Kirim mini form link ke vendor untuk pengisian penawaran" },
  vendor_submission:  { label: "Vendor Submit",       icon: "📩", desc: "Notifikasi admin saat vendor submit penawaran" },
  vendor_revision:    { label: "Revisi Penawaran",    icon: "↩️", desc: "Minta revisi harga ke vendor" },
  customer_approval:  { label: "Customer Approval",   icon: "✅", desc: "Kirim link persetujuan penawaran ke customer" },
  customer_approved:  { label: "Customer Approved",   icon: "🎉", desc: "Notifikasi admin saat customer menyetujui" },
  so_created:         { label: "SO Terkonfirmasi",    icon: "📑", desc: "Konfirmasi Sales Order ke customer" },
  op_request:         { label: "Op. Request",         icon: "⚙️", desc: "Kirim form konfirmasi operasional ke vendor" },
  driver_assigned:    { label: "Driver Ditugaskan",   icon: "🚚", desc: "Notifikasi customer saat driver ditugaskan" },
  shipment_update:    { label: "Update Shipment",     icon: "🚢", desc: "Update status pengiriman ke customer" },
  customs_update:     { label: "Update Kepabeanan",   icon: "🏛️", desc: "Update status bea cukai ke customer" },
  delivery_completed:           { label: "Pengiriman Selesai",      icon: "🏁", desc: "Notifikasi penyelesaian pengiriman" },
  product_order_new:            { label: "Pesanan Produk Baru",     icon: "🛒", desc: "Notifikasi saat order produk baru masuk dari customer portal" },
  product_order_status_update:  { label: "Update Status Produk",    icon: "📦", desc: "Notifikasi saat admin mengubah status order produk" },
  vendor_submit_confirm:        { label: "Konfirmasi Vendor",        icon: "✉️", desc: "Notifikasi balik ke vendor setelah mereka submit form penawaran" },
  vendor_rfq_forward:           { label: "RFQ Forward ke Vendor",   icon: "📤", desc: "Notifikasi ke vendor saat admin forward RFQ beserta detail permintaan" },
  vendor_submission_summary:    { label: "Ringkasan Penawaran",     icon: "📋", desc: "Ringkasan submission form vendor yang dikirim ke admin" },
  rfq_vendor_recap:             { label: "Rekap Penawaran RFQ",     icon: "🔔", desc: "Rekap semua penawaran vendor untuk satu RFQ, dikirim ke admin" },
  revision_fallback:            { label: "Revisi Penawaran Vendor",  icon: "↩️", desc: "Pesan fallback ke vendor saat admin minta revisi tanpa data order" },
  customer_rejection:           { label: "Customer Tolak",           icon: "❌", desc: "Notifikasi admin saat customer menolak penawaran" },
  op_confirm_submitted:         { label: "Data Ops Masuk",           icon: "🚚", desc: "Notifikasi admin saat vendor submit data operasional" },
  customer_rfq_response:        { label: "Respons Customer RFQ",    icon: "💬", desc: "Notifikasi admin saat customer setuju/tolak/minta revisi penawaran RFQ" },
};

type WorkflowCategory = "semua" | "logistik" | "produk";
const WORKFLOW_CATEGORY: Record<WorkflowKey, WorkflowCategory> = {
  order_new: "logistik", vendor_request: "logistik", vendor_submission: "logistik",
  vendor_revision: "logistik", vendor_submit_confirm: "logistik", vendor_rfq_forward: "logistik",
  vendor_submission_summary: "logistik", revision_fallback: "logistik",
  customer_rejection: "logistik", op_confirm_submitted: "logistik", customer_rfq_response: "logistik",
  customer_approval: "logistik", customer_approved: "logistik", so_created: "logistik",
  op_request: "logistik", driver_assigned: "logistik", shipment_update: "logistik",
  customs_update: "logistik", delivery_completed: "logistik", rfq_vendor_recap: "logistik",
  product_order_new: "produk", product_order_status_update: "produk",
};
const CATEGORY_META: Record<WorkflowCategory, { label: string; icon: string; count: (saved: Set<string>, r: string) => number }> = {
  semua:    { label: "Semua",    icon: "🔍", count: (s, r) => [...s].filter(k => k.startsWith(r + "__")).length },
  logistik: { label: "Logistik", icon: "🚢", count: (s, r) => [...s].filter(k => k.startsWith(r + "__") && WORKFLOW_CATEGORY[k.split("__")[1] as WorkflowKey] === "logistik").length },
  produk:   { label: "Produk",   icon: "🛒", count: (s, r) => [...s].filter(k => k.startsWith(r + "__") && WORKFLOW_CATEGORY[k.split("__")[1] as WorkflowKey] === "produk").length },
};

const VAR_GROUPS: Array<{ label: string; color: string; vars: string[]; onlyWorkflows?: WorkflowKey[] }> = [
  { label: "Dasar",    color: "bg-slate-100 text-slate-700 border-slate-300",   vars: ["orderNumber","tanggal","jam","timestamp"] },
  { label: "Order",    color: "bg-blue-50 text-blue-700 border-blue-200",       vars: ["serviceType","shipmentType","route","commodity","cargoDescription","grossWeightDisplay","volumeDisplay","jumlahKoliDisplay","requiredDate","totalEst","serviceList","notes"] },
  { label: "Customer", color: "bg-green-50 text-green-700 border-green-200",    vars: ["customerName","customerDisplay","customerPhone","email","phone"] },
  { label: "Vendor",   color: "bg-purple-50 text-purple-700 border-purple-200", vars: ["vendorName","vendorPhone"] },
  { label: "Harga",    color: "bg-amber-50 text-amber-700 border-amber-200",    vars: ["vendorPrice","sellingPrice","currency","margin"] },
  { label: "Link",     color: "bg-indigo-50 text-indigo-700 border-indigo-200", vars: ["vendorMiniFormLink","customerApprovalLink","operationalFormLink","adminActionUrl","responseUrl"] },
  { label: "🛒 Produk", color: "bg-emerald-50 text-emerald-700 border-emerald-200", vars: ["itemList","shippingAddress","grandTotal","orderUrl","vendorFormUrl"], onlyWorkflows: ["product_order_new"] },
  { label: "🚛 Trk",   color: "bg-orange-50 text-orange-700 border-orange-200", vars: ["driverName","driverPhone","plateNumber","vehicleType"] },
  { label: "🚢 Sea",   color: "bg-cyan-50 text-cyan-700 border-cyan-200",       vars: ["vessel","voyage","containerNumber","blNumber"] },
  { label: "✈️ Air",   color: "bg-sky-50 text-sky-700 border-sky-200",          vars: ["airline","awbNumber","flightNumber"] },
  { label: "🏛️ PPJ",  color: "bg-rose-50 text-rose-700 border-rose-200",       vars: ["ajuNumber","bcType","sppbNumber"] },
  { label: "🛒 Prd",  color: "bg-teal-50 text-teal-700 border-teal-200",       vars: ["itemList","grandTotal","shippingAddress","orderUrl","vendorFormUrl","statusLabel"] },
];

const COND_BLOCKS = [
  { label: "Trucking",    icon: "🚛", cond: "trucking",   hint: "Muncul hanya jika service type = trucking" },
  { label: "Sea Freight", icon: "🚢", cond: "freight_sea", hint: "Muncul hanya jika service type = sea freight" },
  { label: "Air Freight", icon: "✈️", cond: "freight_air", hint: "Muncul hanya jika service type = air freight" },
  { label: "PPJK",        icon: "🏛️", cond: "ppjk",       hint: "Muncul hanya jika service type = PPJK" },
  { label: "Product",     icon: "📦", cond: "product",     hint: "Muncul hanya jika service type = product" },
];

const SAMPLE_DATA: Record<string, Record<string, string>> = {
  "": {
    orderNumber: "CST/2025/000123", tanggal: "25 Mei 2025", jam: "09:00", timestamp: "25 Mei 2025 09:00",
    serviceType: "[service type]", shipmentType: "Import", route: "Shanghai → Jakarta", commodity: "Electronics",
    cargoDescription: "Electronic components", grossWeightDisplay: "500 kg", volumeDisplay: "2.5 CBM",
    jumlahKoliDisplay: "10 koli", requiredDate: "30 Mei 2025", totalEst: "15.000.000",
    serviceList: "- Sea Freight\n- Customs Clearance", notes: "Handle with care",
    customerName: "PT. Maju Sejahtera", customerDisplay: "PT. Maju Sejahtera", customerPhone: "6281234567890",
    email: "info@majusejahtera.com", phone: "6281234567890",
    vendorName: "PT. Trans Cepat", vendorPhone: "6289876543210",
    vendorPrice: "Rp 12.000.000", sellingPrice: "Rp 15.000.000", currency: "IDR", margin: "Rp 3.000.000",
    vendorMiniFormLink: "https://cst.app/vendor-form/xxxxx",
    customerApprovalLink: "https://cst.app/approval/yyyyy",
    operationalFormLink: "https://cst.app/op-confirm/zzzzz",
    adminActionUrl: "https://cst.app/admin/action/aaaaa",
    responseUrl: "https://cst.app/vendor-response/bbbbb",
    driverName: "Budi Santoso", driverPhone: "6287654321098", plateNumber: "B 1234 XYZ", vehicleType: "Truk CDD",
    vessel: "MV Ever Given", voyage: "V.025E", containerNumber: "MSCU1234567", blNumber: "MSCUA123456",
    airline: "Garuda Indonesia", awbNumber: "126-12345678", flightNumber: "GA-888",
    ajuNumber: "090100-2025-000123", bcType: "BC 2.0", sppbNumber: "SPPB-2025-000456",
  },
  trucking:    { serviceType: "Trucking",    shipmentType: "Domestik", route: "Jakarta → Surabaya", driverName: "Budi Santoso", driverPhone: "6287654321098", plateNumber: "B 1234 XYZ", vehicleType: "Truk CDD" },
  freight_sea: { serviceType: "Sea Freight", shipmentType: "Import",   route: "Shanghai → Jakarta", vessel: "MV Ever Given", voyage: "V.025E", containerNumber: "MSCU1234567", blNumber: "MSCUA123456" },
  freight_air: { serviceType: "Air Freight", shipmentType: "Export",   route: "Jakarta → Singapore", airline: "Garuda Indonesia", awbNumber: "126-12345678", flightNumber: "GA-888" },
  ppjk:        { serviceType: "PPJK",        shipmentType: "Import",   ajuNumber: "090100-2025-000123", bcType: "BC 2.0", sppbNumber: "SPPB-2025-000456" },
  product:     { serviceType: "Product",     shipmentType: "Domestik",
    itemList: "- Baju Kaos (2 pcs) @ Rp 150.000\n- Celana Panjang (1 pcs) @ Rp 250.000",
    grandTotal: "550.000", shippingAddress: "Jl. Merdeka No. 10, Jakarta Pusat",
    orderUrl: "https://cst.app/bizportal/product-orders/123",
    vendorFormUrl: "https://cst.app/vendor-form/product/123",
    statusLabel: "Sedang Diproses",
  },
  product_order_new: {
    orderNumber: "PRD-260526-12345",
    customerName: "PT. Maju Sejahtera", email: "info@majusejahtera.com", phone: "6281234567890",
    shippingAddress: "Jl. Sudirman No. 45, Jakarta Pusat",
    itemList: "• Green Bean Arabica × 50 (kg) — Rp 5.000.000\n• Kopi Robusta × 30 (kg) — Rp 2.400.000",
    grandTotal: "7.400.000", notes: "Kirim sebelum jam 12",
    orderUrl: "https://cst.app/bizportal/logistics/portal-orders",
    vendorFormUrl: "https://cst.app/vendor-product-approval/PRD-260526-12345?t=xxxxx",
    timestamp: "26 Mei 2026, 09:00 WIB",  },
};

function renderWaPreview(body: string, svcType: ServiceTypeSim, workflow?: WorkflowKey): string {
  let result = body.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, cond, content: string) =>
    svcType ? (cond === svcType ? content : "") : `‹${cond.toUpperCase()}›${content.trim()}‹/${cond.toUpperCase()}›`
  );
  const base = SAMPLE_DATA[""] ?? {};
  const svc  = svcType ? (SAMPLE_DATA[svcType] ?? {}) : {};
  const wf   = workflow ? (SAMPLE_DATA[workflow] ?? {}) : {};
  const data  = { ...base, ...svc, ...wf };
  result = result.replace(/\{\{(\w+)\}\}/g, (_m, k) => data[k] ?? `{{${k}}}`);
  const lines = result.split("\n").filter(line => !line.includes("{{") || line.trim() === "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const DEFAULT_BODY: Partial<Record<RecipientKey, Partial<Record<WorkflowKey, string>>>> = {
  admin_personal: {
    order_new: [
      "🚢 *ORDER LOGISTIK BARU*","━━━━━━━━━━━━━━━━━━",
      "No. Order       : `{{orderNumber}}`","Tanggal         : {{tanggal}}","Jam             : {{jam}}",
      "Customer        : {{customerDisplay}}","Email           : {{email}}","HP              : {{phone}}",
      "Jenis           : {{shipmentType}}","Rute            : {{route}}","Kategori Barang : {{commodity}}",
      "Deskripsi       : {{cargoDescription}}","Berat           : {{grossWeightDisplay}}","Volume          : {{volumeDisplay}}",
      "Jumlah Koli     : {{jumlahKoliDisplay}}","Layanan         :","{{serviceList}}","Total Est.      : Rp {{totalEst}}",
      "Tgl Kirim       : {{requiredDate}}","Catatan         : {{notes}}","━━━━━━━━━━━━━━━━━━",
      "⚡ *Aksi Cepat Admin (tanpa login):*","🔭 Review & Blast Vendor → {{adminActionUrl}}","_Dikirim: {{timestamp}}_",
    ].join("\n"),
    vendor_request: [
      "📋 *VENDOR REQUEST DIKIRIM*","",
      "No. Order    : {{orderNumber}}","Tanggal      : {{tanggal}}","Customer     : {{customerName}}",
      "Layanan      : {{serviceType}}","Route        : {{route}}","Komoditi     : {{commodity}}","",
      "Vendor       : {{vendorName}}","No. Vendor   : {{vendorPhone}}","",
      "Harga Vendor : {{vendorPrice}}","Mata Uang    : {{currency}}","Valid Until   : {{requiredDate}}","",
      "🔗 Link Mini Form Vendor:","{{vendorMiniFormLink}}","",
      "Catatan:","{{notes}}","",
      "{{#if trucking}}",
      "🚚 *Detail Trucking*","Jenis Armada : {{vehicleType}}","Driver       : {{driverName}}",
      "No. Driver   : {{driverPhone}}","Plat Nomor   : {{plateNumber}}",
      "{{/if}}","",
      "{{#if freight_sea}}",
      "🚢 *Detail Freight Sea*","Vessel       : {{vessel}}","Voyage       : {{voyage}}",
      "Container    : {{containerNumber}}","BL Number    : {{blNumber}}",
      "{{/if}}","",
      "{{#if freight_air}}",
      "✈️ *Detail Freight Air*","Airline      : {{airline}}","Flight Number: {{flightNumber}}",
      "AWB Number   : {{awbNumber}}",
      "{{/if}}","",
      "{{#if ppjk}}",
      "🏛️ *Detail PPJK*","Nomor Aju    : {{ajuNumber}}","Jenis BC     : {{bcType}}",
      "SPPB         : {{sppbNumber}}",
      "{{/if}}","",
      "{{#if product}}",
      "📦 *Detail Produk*","Produk / Komoditi : {{commodity}}","Jumlah Koli  : {{jumlahKoliDisplay}}",
      "Berat        : {{grossWeightDisplay}}","Volume       : {{volumeDisplay}}",
      "{{/if}}","",
      "Mohon follow up vendor dan cek status penawaran melalui link admin:","{{adminActionUrl}}",
    ].join("\n"),
    vendor_submission: ["📩 *VENDOR SUBMIT — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Vendor *{{vendorName}}* telah mengirim penawaran.","","Order: {{orderNumber}}","Service: {{serviceType}}","💰 Harga Vendor: {{vendorPrice}}","","Segera review dan kirim approval ke customer.","_{{timestamp}}_"].join("\n"),
    op_request: [
      "⚙️ *OP. REQUEST DIKIRIM — {{orderNumber}}*","",
      "Form konfirmasi operasional telah dikirim ke vendor *{{vendorName}}*.","",
      "No. Order : {{orderNumber}}","Customer  : {{customerName}}","Layanan   : {{serviceType}}","Route     : {{route}}","",
      "{{#if trucking}}","Data yang diminta: Driver, No. Plat, Kendaraan.","{{/if}}",
      "{{#if freight_sea}}","Data yang diminta: Vessel, Voyage, Container, BL.","{{/if}}",
      "{{#if freight_air}}","Data yang diminta: Airline, AWB, Flight Number.","{{/if}}",
      "{{#if ppjk}}","Data yang diminta: Nomor Aju, BC Type, SPPB.","{{/if}}","",
      "🔗 Link Operasional: {{operationalFormLink}}","","_{{timestamp}}_",
    ].join("\n"),
    customer_approved: [
      "✅ *CUSTOMER APPROVED*","",
      "No. Order : {{orderNumber}}","Customer  : {{customerName}}","Layanan   : {{serviceType}}",
      "Route     : {{route}}","Total     : {{currency}} {{sellingPrice}}","",
      "Status: Customer sudah menyetujui penawaran.","Silakan lanjutkan proses pembuatan SO.","",
      "Link Admin:","{{adminActionUrl}}",
    ].join("\n"),
    so_created: [
      "✅ *SALES ORDER CREATED*","",
      "No. Order : {{orderNumber}}","Customer  : {{customerName}}","Layanan   : {{serviceType}}",
      "Route     : {{route}}","Total     : {{currency}} {{sellingPrice}}","",
      "SO sudah berhasil dibuat.","Silakan lanjutkan instruksi ke vendor.",
    ].join("\n"),
    vendor_revision: [
      "↩️ *REVISI PENAWARAN DIKIRIM — {{orderNumber}}*","",
      "Revisi penawaran telah diminta dari vendor *{{vendorName}}*.",
      "Layanan : {{serviceType}}","Harga saat ini : {{vendorPrice}}","",
      "Tunggu respons vendor melalui link admin:","{{adminActionUrl}}","","_{{timestamp}}_",
    ].join("\n"),
    customer_approval: [
      "✅ *LINK APPROVAL DIKIRIM — {{orderNumber}}*","",
      "Link persetujuan penawaran sudah dikirim ke customer *{{customerName}}*.",
      "Layanan : {{serviceType}}","Total   : {{currency}} {{sellingPrice}}","",
      "Tunggu konfirmasi customer.","_{{timestamp}}_",
    ].join("\n"),
    driver_assigned: [
      "🚚 *DRIVER DITUGASKAN — {{orderNumber}}*","",
      "Driver untuk order *{{orderNumber}}* telah ditugaskan.","Customer : {{customerName}}","Layanan  : {{serviceType}}","",
      "{{#if trucking}}","👤 Driver    : {{driverName}}","📞 HP        : {{driverPhone}}","🚛 Kendaraan : {{vehicleType}}","🔢 Plat      : {{plateNumber}}","{{/if}}","",
      "Notifikasi sudah dikirim ke customer.","_{{timestamp}}_",
    ].join("\n"),
    shipment_update: [
      "🚢 *SHIPMENT UPDATE DIKIRIM — {{orderNumber}}*","",
      "Update pengiriman sudah dikirim ke customer *{{customerName}}*.",
      "Layanan : {{serviceType}}","Rute    : {{route}}","",
      "{{#if freight_sea}}","🚢 Kapal     : {{vessel}} / {{voyage}}","📦 Container : {{containerNumber}}","📃 BL No     : {{blNumber}}","{{/if}}","",
      "{{#if freight_air}}","✈️ Airline   : {{airline}}","📋 AWB       : {{awbNumber}}","🛫 Flight    : {{flightNumber}}","{{/if}}","","_{{timestamp}}_",
    ].join("\n"),
    customs_update: [
      "🏛️ *KEPABEANAN UPDATE DIKIRIM — {{orderNumber}}*","",
      "Update kepabeanan sudah dikirim ke customer *{{customerName}}*.",
      "Layanan : {{serviceType}}","",
      "{{#if ppjk}}","📋 No. Aju : {{ajuNumber}}","📄 BC Type : {{bcType}}","✅ SPPB    : {{sppbNumber}}","{{/if}}","","_{{timestamp}}_",
    ].join("\n"),
    delivery_completed: [
      "🏁 *PENGIRIMAN SELESAI — {{orderNumber}}*","",
      "Order *{{orderNumber}}* telah selesai.","Customer : {{customerName}}","Rute     : {{route}}","","_{{timestamp}}_",
    ].join("\n"),
    product_order_new: [
      "🛒 *PESANAN PRODUK BARU*","━━━━━━━━━━━━━━━━━━",
      "No. Order   : `{{orderNumber}}`","Customer    : {{customerName}}","Email       : {{email}}","HP          : {{phone}}",
      "Alamat      : {{shippingAddress}}","Produk      :","{{itemList}}","Total       : Rp {{grandTotal}}","Catatan     : {{notes}}",
      "━━━━━━━━━━━━━━━━━━","🔗 Lihat di BizPortal:","{{orderUrl}}","","📋 *Form vendor (forward ke vendor):*","{{vendorFormUrl}}","",
      "_Dikirim: {{timestamp}}_",
    ].join("\n"),
    product_order_status_update: [
      "🔔 *[UPDATE STATUS PRODUK]*",
      "No. Order : {{orderNumber}}","Customer  : {{customerName}}","HP        : {{phone}}","Status    : *{{statusLabel}}*",
      "_{{timestamp}}_",
    ].join("\n"),
  },
  admin_group: {
    order_new: [
      "🔔 *[ORDER MASUK] {{orderNumber}}*","━━━━━━━━━━━━━━━━━━",
      "🏷️ No. Tracking  : `{{orderNumber}}`","📆 Tanggal       : {{tanggal}}",
      "👤 Customer      : *{{customerDisplay}}*","📞 HP            : {{phone}}","📧 Email         : {{email}}","━━━━━━━━━━━━━━━━━━",
      "🚢 Jenis         : {{shipmentType}}","📍 Rute          : {{route}}","📦 Komoditi      : {{commodity}}",
      "📋 Deskripsi     : {{cargoDescription}}","⚖️ Berat         : {{grossWeightDisplay}}","📐 Volume        : {{volumeDisplay}}",
      "📅 Tgl Kirim     : {{requiredDate}}","📝 Catatan       : {{notes}}","━━━━━━━━━━━━━━━━━━",
      "💰 Total Est.    : *Rp {{totalEst}}*","🔵 Status        : Menunggu Konfirmasi","━━━━━━━━━━━━━━━━━━",
      "⚡ *Aksi Cepat (tanpa login):*","🚀 Review & Blast Vendor → {{adminActionUrl}}","",
      "_Harap segera diproses. Dikirim: {{timestamp}}_",
    ].join("\n"),
    vendor_submission: ["📩 *VENDOR SUBMIT — {{orderNumber}}*","Vendor *{{vendorName}}* — Service: {{serviceType}}","💰 Harga: {{vendorPrice}}","","Segera review!","_{{timestamp}}_"].join("\n"),
    vendor_revision: ["↩️ *REVISI PENAWARAN — {{orderNumber}}*","Vendor *{{vendorName}}* diminta revisi harga.","Layanan: {{serviceType}} | Harga saat ini: {{vendorPrice}}","_{{timestamp}}_"].join("\n"),
    customer_approved: ["🎉 *CUSTOMER APPROVED — {{orderNumber}}*","Customer *{{customerName}}* menyetujui penawaran.","Proses operasional sekarang!","_{{timestamp}}_"].join("\n"),
    op_request: ["⚙️ *[OP. REQUEST] {{orderNumber}}*","Form operasional dikirim ke vendor *{{vendorName}}*.","Customer: {{customerName}} | Layanan: {{serviceType}}","Rute: {{route}}","_{{timestamp}}_"].join("\n"),
    so_created: ["📑 *SO CREATED — {{orderNumber}}*","Customer: {{customerName}} | Total: {{currency}} {{sellingPrice}}","_{{timestamp}}_"].join("\n"),
    driver_assigned: [
      "🚚 *DRIVER DITUGASKAN — {{orderNumber}}*","Customer: {{customerName}}",
      "{{#if trucking}}","Driver: {{driverName}} | Plat: {{plateNumber}}","{{/if}}","_{{timestamp}}_",
    ].join("\n"),
    shipment_update: [
      "🚢 *SHIPMENT UPDATE — {{orderNumber}}*","Customer: {{customerName}} | Rute: {{route}}",
      "{{#if freight_sea}}","Vessel: {{vessel}} / BL: {{blNumber}}","{{/if}}",
      "{{#if freight_air}}","AWB: {{awbNumber}} / Flight: {{flightNumber}}","{{/if}}","_{{timestamp}}_",
    ].join("\n"),
    customs_update: [
      "🏛️ *KEPABEANAN UPDATE — {{orderNumber}}*","Customer: {{customerName}}",
      "{{#if ppjk}}","Aju: {{ajuNumber}} | SPPB: {{sppbNumber}}","{{/if}}","_{{timestamp}}_",
    ].join("\n"),
    delivery_completed: ["🏁 *PENGIRIMAN SELESAI — {{orderNumber}}*","Customer: {{customerName}} | Rute: {{route}}","_{{timestamp}}_"].join("\n"),
    product_order_new: [
      "🛒 *[PESANAN PRODUK] {{orderNumber}}*","━━━━━━━━━━━━━━━━━━",
      "👤 Customer : *{{customerName}}*","📞 HP       : {{phone}}","📧 Email    : {{email}}",
      "📦 Produk   :","{{itemList}}","💰 Total    : *Rp {{grandTotal}}*","Catatan     : {{notes}}",
      "━━━━━━━━━━━━━━━━━━","_Dikirim: {{timestamp}}_",
    ].join("\n"),
    product_order_status_update: [
      "🔔 *[STATUS ORDER PRODUK DIPERBARUI]*",
      "No. Order : {{orderNumber}} | Customer: {{customerName}}","Status    : *{{statusLabel}}*","_{{timestamp}}_",
    ].join("\n"),
  },
  customer: {
    order_new: [
      "✅ *PESANAN ANDA DITERIMA*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","",
      "Terima kasih telah mempercayakan pengiriman Anda kepada B2B Marketplace and Logistic.","",
      "No. Order       : *{{orderNumber}}*","Tanggal         : {{tanggal}}","Jam             : {{jam}}",
      "Status          : Menunggu Penawaran Harga","Rute            : {{route}}","Kategori Barang : {{commodity}}",
      "Berat           : {{grossWeightDisplay}}","Volume          : {{volumeDisplay}}","Layanan         :","{{serviceList}}",
      "Tgl Butuh       : {{requiredDate}}","━━━━━━━━━━━━━━━━━━",
      "Tim kami sedang memproses permintaan Anda dan akan segera mengirimkan *penawaran harga terbaik* untuk Anda.","",
      "📞 Jakarta: (021) 6241234 | Tangerang: (021) 5591234","","_Dikirim: {{timestamp}}_",
    ].join("\n"),
    customer_approval: [
      "Halo {{customerName}},","",
      "Berikut penawaran untuk request Anda:","",
      "No. Order         : {{orderNumber}}","Layanan           : {{serviceType}}",
      "Route             : {{route}}","Komoditi          : {{commodity}}","",
      "Total Penawaran   : {{currency}} {{sellingPrice}}","",
      "Silakan review dan konfirmasi melalui link berikut:","{{customerApprovalLink}}","",
      "Terima kasih.",
    ].join("\n"),
    customer_approved: ["🎉 *TERIMA KASIH TELAH MENGKONFIRMASI!*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Penawaran order *{{orderNumber}}* telah diterima.","Tim operasional kami sedang memprosesnya.","","📞 Pertanyaan: (021) 6241234","_Dikirim: {{timestamp}}_"].join("\n"),
    so_created: ["📑 *SALES ORDER TERKONFIRMASI — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Pesanan Anda telah resmi dikonfirmasi!","","💰 Harga: {{sellingPrice}}","Rute: {{route}}","","Tim kami akan segera memproses pengiriman.","Terima kasih 🙏","_Dikirim: {{timestamp}}_"].join("\n"),
    driver_assigned: ["🚚 *DRIVER DITUGASKAN — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Driver untuk order *{{orderNumber}}* telah ditugaskan:","","{{#if trucking}}","👤 Driver: {{driverName}}","📞 HP: {{driverPhone}}","🚛 Kendaraan: {{vehicleType}}","🔢 No. Plat: {{plateNumber}}","{{/if}}","","Driver akan segera menghubungi Anda.","Terima kasih 🙏","_Dikirim: {{timestamp}}_"].join("\n"),
    shipment_update: ["📦 *UPDATE PENGIRIMAN — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Update status pengiriman order *{{orderNumber}}*:","Rute: {{route}}","","{{#if freight_sea}}","🚢 Kapal: {{vessel}} / Voyage: {{voyage}}","📦 Container: {{containerNumber}}","📃 BL No: {{blNumber}}","{{/if}}","","{{#if freight_air}}","✈️ Airline: {{airline}}","📋 AWB: {{awbNumber}}","🛫 Flight: {{flightNumber}}","{{/if}}","","Terima kasih 🙏","_Dikirim: {{timestamp}}_"].join("\n"),
    customs_update: ["🏛️ *UPDATE KEPABEANAN — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Update status kepabeanan order *{{orderNumber}}*:","","{{#if ppjk}}","📋 No. Aju: {{ajuNumber}}","📄 BC Type: {{bcType}}","✅ SPPB: {{sppbNumber}}","{{/if}}","","Terima kasih 🙏"].join("\n"),
    delivery_completed: ["🏁 *PENGIRIMAN SELESAI — {{orderNumber}}*","━━━━━━━━━━━━━━━━━━","Halo *{{customerName}}*,","","Pengiriman order *{{orderNumber}}* telah selesai! ✅","Rute: {{route}}","","Terima kasih telah menggunakan B2B Marketplace and Logistic!","Kami harap pelayanan kami memuaskan.","","📞 Feedback: (021) 6241234","_Dikirim: {{timestamp}}_"].join("\n"),
    product_order_new: [
      "✅ *Pesanan Anda Berhasil Diterima!*","No. Order: *{{orderNumber}}*","",
      "{{itemList}}","","Total: Rp {{grandTotal}}","",
      "Tim kami akan segera menghubungi Anda untuk konfirmasi. Terima kasih! 🙏",
    ].join("\n"),
    product_order_status_update: [
      "📦 *Update Status Pesanan Anda*","No. Order: {{orderNumber}}","Customer: {{customerName}}","Status: *{{statusLabel}}*","",
      "Terima kasih telah berbelanja di B2B Marketplace and Logistic. Hubungi kami jika ada pertanyaan. 🙏",
    ].join("\n"),
  },
};

const DEFAULT_BODY_PRODUCT: Partial<Record<RecipientKey, string>> = {
  admin_personal: [
    "🛒 *PESANAN PRODUK BARU*",
    "━━━━━━━━━━━━━━━━━━",
    "No. Order   : `{{orderNumber}}`",
    "Customer    : {{customerName}}",
    "Email       : {{email}}",
    "HP          : {{phone}}",
    "Alamat      : {{shippingAddress}}",
    "Produk      :",
    "{{itemList}}",
    "Total       : Rp {{grandTotal}}",
    "Catatan     : {{notes}}",
    "━━━━━━━━━━━━━━━━━━",
    "🔗 Lihat di BizPortal:",
    "{{orderUrl}}",
    "",
    "📋 *Form vendor (forward ke vendor):*",
    "{{vendorFormUrl}}",
    "",
    "_Dikirim: {{timestamp}}_",
  ].join("\n"),
  admin_group: [
    "🛒 *[PESANAN PRODUK] {{orderNumber}}*",
    "━━━━━━━━━━━━━━━━━━",
    "👤 Customer : *{{customerName}}*",
    "📞 HP       : {{phone}}",
    "📧 Email    : {{email}}",
    "📦 Produk   :",
    "{{itemList}}",
    "💰 Total    : *Rp {{grandTotal}}*",
    "Catatan     : {{notes}}",
    "━━━━━━━━━━━━━━━━━━",
    "📋 Form vendor → {{vendorFormUrl}}",
    "",
    "_Dikirim: {{timestamp}}_",
  ].join("\n"),
  customer: [
    "✅ *Pesanan Anda Berhasil Diterima!*",
    "No. Order: *{{orderNumber}}*",
    "",
    "{{itemList}}",
    "",
    "Total: Rp {{grandTotal}}",
    "",
    "Tim kami akan segera menghubungi Anda untuk konfirmasi. Terima kasih! 🙏",
  ].join("\n"),
};

function getDefaultBody(recipient: RecipientKey, workflow: WorkflowKey): string {
  if (workflow === "product_order_new") return DEFAULT_BODY_PRODUCT[recipient] ?? "";
  return DEFAULT_BODY[recipient]?.[workflow] || "";
}

async function fetchWaTemplateConfigs(): Promise<{ configs: Record<string, string>; savedKeys: Set<string> } | null> {
  try {
    const res = await fetch("/api/settings/wa-template-configs", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json() as { configs: Record<string, string>; savedKeys: string[] };
    return { configs: data.configs ?? {}, savedKeys: new Set(data.savedKeys ?? []) };
  } catch { return null; }
}

function WaTemplatesCard() {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [recipient, setRecipient] = useState<RecipientKey>("admin_personal");
  const [workflow, setWorkflow] = useState<WorkflowKey>("order_new");
  const [category, setCategory] = useState<WorkflowCategory>("semua");
  const [simSvc, setSimSvc] = useState<ServiceTypeSim>("");

  const cfgKey = (r: RecipientKey, w: WorkflowKey) => `${r}__${w}`;
  const validRecipients = WORKFLOW_VALID_RECIPIENTS[workflow] ?? (Object.keys(RECIPIENT_META) as RecipientKey[]);
  const effectiveRecipient = validRecipients.includes(recipient) ? recipient : validRecipients[0]!;
  const currentBody = configs[cfgKey(effectiveRecipient, workflow)] || getDefaultBody(effectiveRecipient, workflow);
  const isSaved = savedKeys.has(cfgKey(effectiveRecipient, workflow));
  const visibleVarGroups = VAR_GROUPS.filter(g => !g.onlyWorkflows || g.onlyWorkflows.includes(workflow));
  const filteredWorkflows = (Object.keys(WORKFLOW_META) as WorkflowKey[]).filter(
    w => category === "semua" || WORKFLOW_CATEGORY[w] === category
  );
  const customCount = loading ? null : savedKeys.size;

  function handleCategoryChange(cat: WorkflowCategory) {
    setCategory(cat);
    if (cat !== "semua" && WORKFLOW_CATEGORY[workflow] !== cat) {
      const first = (Object.keys(WORKFLOW_META) as WorkflowKey[]).find(w => WORKFLOW_CATEGORY[w] === cat);
      if (first) setWorkflow(first);
    }
  }

  useEffect(() => {
    void fetchWaTemplateConfigs().then(data => {
      if (data) { setConfigs(data.configs); setSavedKeys(data.savedKeys); }
      setLoading(false);
    });
  }, []);

  const setBody = (body: string) =>
    setConfigs(prev => ({ ...prev, [cfgKey(effectiveRecipient, workflow)]: body }));

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    if (!el) { setBody(currentBody + text); return; }
    const s = el.selectionStart, e = el.selectionEnd;
    const next = currentBody.slice(0, s) + text + currentBody.slice(e);
    setBody(next);
    setTimeout(() => { el.selectionStart = el.selectionEnd = s + text.length; el.focus(); }, 0);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body = configs[cfgKey(effectiveRecipient, workflow)] ?? getDefaultBody(effectiveRecipient, workflow);
      const res = await fetch("/api/settings/wa-template-configs", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ recipient: effectiveRecipient, workflow, body }),
      });
      if (!res.ok) throw new Error(await res.text());
      const fresh = await fetchWaTemplateConfigs();
      if (fresh) { setConfigs(fresh.configs); setSavedKeys(fresh.savedKeys); }
      toast({ title: "Template tersimpan" });
    } catch (e) {
      toast({ title: "Gagal menyimpan", description: String(e), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch(`/api/settings/wa-template-configs/${effectiveRecipient}/${workflow}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const fresh = await fetchWaTemplateConfigs();
      if (fresh) { setConfigs(fresh.configs); setSavedKeys(fresh.savedKeys); }
      toast({ title: "Template direset ke default" });
    } catch (e) {
      toast({ title: "Gagal reset", description: String(e), variant: "destructive" });
    } finally { setResetting(false); }
  }

  const preview = renderWaPreview(currentBody, simSvc, workflow);
  const HANDLEBAR_RE = /(\{\{[^\x7D]+\}\})/;

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-green-500" />
          Template Pesan WhatsApp
          {customCount !== null && customCount > 0 && (
            <span className="text-xs font-normal bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full px-2 py-0.5 ml-1">
              {customCount} dikustomisasi
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Atur format pesan WA per workflow dan penerima. Mendukung variabel dinamis{" "}
          <code className="bg-muted px-1 rounded text-xs">{"{{variabel}}"}</code> dan blok kondisional per service type.
          Baris dengan variabel kosong dihilangkan otomatis. Perubahan langsung aktif tanpa restart.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex gap-6 text-sm text-muted-foreground">
            <span>👤 Admin Pribadi</span>
            <span>👥 Grup Admin</span>
            <span>🛍️ Customer</span>
            <span>🏭 Vendor</span>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => { window.location.href = "/bizportal/settings/wa-templates"; }}
            >
              <MessageCircle className="h-4 w-4 text-green-500" />
              Buka WA Template Manager
            </Button>
          </div>
        </div>
        {loading ? (
          <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-8 bg-muted rounded animate-pulse" />)}</div>
        ) : (
          <div className="space-y-5">

            {/* ── Recipient Tabs ── */}
            <Tabs value={effectiveRecipient} onValueChange={v => setRecipient(v as RecipientKey)}>
              <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50">
                {(Object.keys(RECIPIENT_META) as RecipientKey[]).map(k => {
                  const disabled = !validRecipients.includes(k);
                  return (
                    <TabsTrigger key={k} value={k} disabled={disabled} className={`text-xs gap-1 ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                      <span>{RECIPIENT_META[k].icon}</span> {RECIPIENT_META[k].label}
                      {disabled && <span className="text-[9px] ml-0.5">(N/A)</span>}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>

            {/* ── Workflow Selector ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pilih Workflow Stage:</p>
                {/* Category Filter */}
                <div className="flex gap-1">
                  {(Object.keys(CATEGORY_META) as WorkflowCategory[]).map(cat => {
                    const cm = CATEGORY_META[cat];
                    const isActive = cat === category;
                    const customCount = cm.count(savedKeys, effectiveRecipient);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => handleCategoryChange(cat)}
                        className={`text-xs px-2.5 py-1 rounded-md border transition-all flex items-center gap-1 ${
                          isActive
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-muted hover:bg-accent text-muted-foreground border-border hover:text-foreground"
                        }`}
                      >
                        <span>{cm.icon}</span>
                        {cm.label}
                        {customCount > 0 && (
                          <span className={`text-[10px] px-1 rounded-full font-medium ${isActive ? "bg-white/20" : "bg-amber-100 text-amber-700"}`}>
                            {customCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {filteredWorkflows.map(w => {
                  const m = WORKFLOW_META[w];
                  const isActive = w === workflow;
                  const hasSaved = savedKeys.has(cfgKey(effectiveRecipient, w));
                  const catColor: Record<WorkflowCategory, string> = {
                    semua: "", logistik: "border-l-2 border-l-blue-400", produk: "border-l-2 border-l-teal-400",
                  };
                  return (
                    <button
                      key={w}
                      type="button"
                      title={m.desc}
                      onClick={() => setWorkflow(w)}
                      className={`text-xs px-2.5 py-1.5 rounded-md border transition-all flex items-center gap-1 ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : `bg-muted hover:bg-accent text-muted-foreground border-border hover:text-foreground ${category === "semua" ? catColor[WORKFLOW_CATEGORY[w]] : ""}`
                      }`}
                    >
                      <span>{m.icon}</span>
                      {m.label}
                      {hasSaved && !isActive && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Workflow Info Banner ── */}
            <div className="bg-muted/40 border rounded-lg p-3 flex items-start gap-3">
              <span className="text-xl mt-0.5">{WORKFLOW_META[workflow].icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{WORKFLOW_META[workflow].label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{WORKFLOW_META[workflow].desc}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Penerima: <span className="font-medium text-foreground">{RECIPIENT_META[effectiveRecipient].icon} {RECIPIENT_META[effectiveRecipient].label}</span>
                  {isSaved
                    ? <span className="ml-2 text-amber-600 font-medium">● Dikustomisasi</span>
                    : <span className="ml-2 text-muted-foreground">○ Default</span>}
                </p>
                {workflow === "product_order_new" && (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 mt-2 inline-block">
                    🛒 Workflow ini hanya berlaku untuk <strong>Admin Pribadi</strong>, <strong>Grup Admin</strong>, dan <strong>Customer</strong>. Tidak ada notifikasi vendor untuk order produk.
                  </p>
                )}
              </div>
            </div>

            {/* ── Variable Chips (grouped) ── */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Variabel (klik untuk insert ke cursor):</p>
              {visibleVarGroups.map(g => (
                <div key={g.label} className="flex flex-wrap items-center gap-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground w-12 shrink-0 text-right pr-1">{g.label}</span>
                  {g.vars.map(v => (
                    <button
                      key={v}
                      type="button"
                      className={`text-[10px] font-mono border rounded px-1.5 py-0.5 cursor-pointer transition-colors hover:opacity-80 ${g.color}`}
                      title={`Klik untuk insert {{${v}}}`}
                      onClick={() => insertAtCursor(`{{${v}}}`)}
                    >
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* ── Conditional Block Inserters ── */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Blok kondisional (klik untuk insert):</p>
              <div className="flex flex-wrap gap-2">
                {COND_BLOCKS.map(b => (
                  <button
                    key={b.cond}
                    type="button"
                    title={b.hint}
                    className="text-xs border border-dashed rounded-md px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:border-primary/60 hover:bg-muted/50 transition-colors flex items-center gap-1.5"
                    onClick={() => insertAtCursor(`{{#if ${b.cond}}}\n\n{{/if}}`)}
                  >
                    <span>{b.icon}</span>
                    <code className="text-[10px]">{`{{#if ${b.cond}}}`}</code>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Konten di dalam blok hanya muncul jika service type cocok. Bisa di-nested dengan variabel service-specific.</p>
            </div>

            {/* ── Template Textarea ── */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium flex items-center gap-1.5">
                ✏️ <span>Edit Template</span>
                <span className="text-muted-foreground font-normal">(klik variabel di atas untuk insert langsung ke posisi kursor)</span>
              </p>
              <Textarea
                ref={textareaRef}
                className="font-mono text-xs min-h-[280px] resize-y border-primary/40 focus:border-primary leading-relaxed"
                value={currentBody}
                onChange={e => setBody(e.target.value)}
                placeholder={`Template kosong — tulis pesan untuk workflow "${WORKFLOW_META[workflow].label}" penerima "${RECIPIENT_META[effectiveRecipient].label}"…`}
                spellCheck={false}
              />
            </div>

            {/* ── Real-time Preview ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview Real-time</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Simulasi service type:</span>
                  <select
                    className="text-xs border rounded px-2 py-1 bg-background text-foreground"
                    value={simSvc}
                    onChange={e => setSimSvc(e.target.value as ServiceTypeSim)}
                  >
                    <option value="">— Tidak dipilih (tampilkan semua blok) —</option>
                    <option value="trucking">🚛 Trucking</option>
                    <option value="freight_sea">🚢 Sea Freight</option>
                    <option value="freight_air">✈️ Air Freight</option>
                    <option value="ppjk">🏛️ PPJK</option>
                    <option value="product">📦 Product</option>
                    <option value="handling">🏗️ Handling</option>
                  </select>
                </div>
              </div>
              <div className="font-mono text-xs bg-muted/40 border rounded-md p-3 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                {preview
                  ? preview.split(HANDLEBAR_RE).map((part, i) =>
                      part.startsWith("{{")
                        ? <span key={i} className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 rounded px-0.5">{part}</span>
                        : part
                    )
                  : <span className="text-muted-foreground italic">Template masih kosong</span>}
              </div>
              {simSvc && (
                <p className="text-xs text-muted-foreground">
                  Blok <code>{`{{#if ${simSvc}}}`}</code> ditampilkan · blok lainnya disembunyikan · variabel kosong dihapus otomatis
                </p>
              )}
            </div>

            {/* ── Action Buttons ── */}
            <div className="flex items-center gap-2 pt-1 border-t">
              <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => void handleSave()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Simpan
              </Button>
              {isSaved && (
                <Button
                  size="sm" variant="outline" className="gap-1.5 text-muted-foreground"
                  disabled={resetting}
                  onClick={() => void handleReset()}
                >
                  {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Reset ke Default
                </Button>
              )}
            </div>

          </div>
        )}
      </CardContent>
    </Card>
  );
}


interface WaLogEntry {
  id: number;
  recipient: string;
  message: string;
  status: string;
  errorMsg?: string | null;
  context?: string | null;
  refType?: string | null;
  refId?: string | null;
  createdAt: string;
}

interface WaStats {
  sent: number;
  failed: number;
}
interface WaStatsResult {
  d7: WaStats;
  d30: WaStats;
  all: WaStats;
}

function StatPill({ label, sent, failed }: { label: string; sent: number; failed: number }) {
  const total = sent + failed;
  const pct   = total === 0 ? 100 : Math.round((sent / total) * 100);
  const good  = pct >= 90;
  const mid   = pct >= 70;
  return (
    <div className="flex-1 min-w-[130px] rounded-xl border bg-background p-3 space-y-1.5">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-foreground leading-none">{total}</span>
        <span className={`text-sm font-semibold pb-0.5 ${good ? "text-green-600" : mid ? "text-amber-500" : "text-red-500"}`}>{pct}%</span>
      </div>
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span className="text-green-600 font-medium">✅ {sent}</span>
        <span className="text-red-500 font-medium">❌ {failed}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${good ? "bg-green-500" : mid ? "bg-amber-500" : "bg-red-500"}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function WaLogsCard() {
  const [logs, setLogs]               = useState<WaLogEntry[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [statusFilter, setStatusFilter] = useState<"" | "sent" | "failed">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch]           = useState("");
  const [loading, setLoading]         = useState(false);
  const [expanded, setExpanded]       = useState<number | null>(null);
  const [stats, setStats]             = useState<WaStatsResult | null>(null);
  const PAGE_SIZE = 25;

  const load = async (p: number, s: string, st: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (st) params.set("status", st);
      if (s)  params.set("search", s);
      const res = await fetch(`/api/settings/wa-logs?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { data: WaLogEntry[]; total: number };
        setLogs(data.data ?? []);
        setTotal(data.total ?? 0);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const loadStats = async () => {
    try {
      const res = await fetch("/api/settings/wa-logs/stats", { credentials: "include" });
      if (res.ok) setStats(await res.json() as WaStatsResult);
    } catch { /* ignore */ }
  };

  useEffect(() => { void load(page, search, statusFilter); }, [page, search, statusFilter]);
  useEffect(() => { void loadStats(); }, []);

  const applySearch = () => { setSearch(searchInput); setPage(1); };
  const totalPages  = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card className="col-span-1 md:col-span-3 bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Log Pengiriman WhatsApp
            </CardTitle>
            <CardDescription className="mt-1">
              Riwayat semua pesan WA yang dikirim sistem — per workflow, ke customer, vendor, maupun admin.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { void load(page, search, statusFilter); void loadStats(); }}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" asChild>
              <a href={`/api/settings/wa-logs/export${statusFilter || search ? `?${new URLSearchParams([...(statusFilter ? [["status", statusFilter]] : []), ...(search ? [["search", search]] : [])]).toString()}` : ""}`} download>
                <Download className="h-3.5 w-3.5" /> Export CSV
              </a>
            </Button>
            <Button size="sm" variant="default" className="gap-1.5 text-xs" asChild>
              <a href="/bizportal/notification-history">
                <ExternalLink className="h-3.5 w-3.5" /> Halaman Penuh
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* ── Stats Summary ── */}
        {stats && (
          <div className="flex flex-wrap gap-3 mb-5">
            <StatPill label="7 Hari Terakhir"  sent={stats.d7.sent}  failed={stats.d7.failed} />
            <StatPill label="30 Hari Terakhir" sent={stats.d30.sent} failed={stats.d30.failed} />
            <StatPill label="Semua Waktu"      sent={stats.all.sent} failed={stats.all.failed} />
          </div>
        )}
        {!stats && (
          <div className="flex gap-3 mb-5">
            {[1,2,3].map(i => <div key={i} className="flex-1 h-20 bg-muted rounded-xl animate-pulse" />)}
          </div>
        )}

        {/* ── Filter Bar ── */}
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="flex gap-1">
            {(["", "sent", "failed"] as const).map(s => (
              <button key={s} type="button"
                onClick={() => { setStatusFilter(s); setPage(1); }}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary hover:text-foreground"}`}>
                {s === "" ? "Semua" : s === "sent" ? "✅ Terkirim" : "❌ Gagal"}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-1 min-w-[180px]">
            <Input
              placeholder="Cari nomor / no. order / context…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") applySearch(); }}
              className="h-8 text-xs"
            />
            <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={applySearch}>Cari</Button>
          </div>
        </div>

        {/* ── List ── */}
        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}</div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <History className="h-8 w-8 opacity-30" />
            <p className="text-sm">Belum ada log pengiriman WA.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {logs.map(log => (
              <div key={log.id}
                className={`rounded-lg border text-xs transition-colors ${log.status === "sent"
                  ? "border-green-200 bg-green-50/40 dark:bg-green-950 dark:border-green-900"
                  : "border-red-200 bg-red-50/40 dark:bg-red-950 dark:border-red-900"}`}>
                {/* Row header */}
                <div className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                  {/* Status badge */}
                  <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${log.status === "sent"
                    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                    : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"}`}>
                    {log.status === "sent" ? "✅ OK" : "❌ ERR"}
                  </span>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-foreground">{log.recipient}</span>
                      {log.refId && (
                        <span className="text-muted-foreground">· <span className="font-medium">{log.refId}</span></span>
                      )}
                      {log.context && log.context !== "general" && (
                        <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{log.context}</span>
                      )}
                    </div>
                    <div className="text-muted-foreground truncate mt-0.5">
                      {log.status === "failed" && log.errorMsg
                        ? <span className="text-red-600 dark:text-red-400">⚠ {log.errorMsg}</span>
                        : log.message.slice(0, 100).replace(/\n/g, " ")}
                    </div>
                  </div>
                  {/* Timestamp */}
                  <span className="shrink-0 text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString("id-ID", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded === log.id ? "rotate-180" : ""}`} />
                </div>
                {/* Expanded detail */}
                {expanded === log.id && (
                  <div className="px-3 pb-3 border-t border-border/50 pt-2 space-y-2">
                    {log.errorMsg && (
                      <p className="text-xs text-red-600 dark:text-red-400 font-medium">Error: {log.errorMsg}</p>
                    )}
                    <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/60 rounded-md p-3 max-h-72 overflow-y-auto text-foreground leading-relaxed">
                      {log.message}
                    </pre>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {log.refType && <span>refType: <span className="font-medium text-foreground">{log.refType}</span></span>}
                      {log.refId   && <span>refId: <span className="font-medium text-foreground">{log.refId}</span></span>}
                      {log.context && <span>context: <span className="font-medium text-foreground">{log.context}</span></span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-xs">
            <span className="text-muted-foreground">{total} entri ditemukan</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}>‹ Prev</Button>
              <span className="px-2 py-1 text-muted-foreground">{page} / {totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}>Next ›</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Settings Quick Nav Cards ───────────────────────────────────────────────────

interface QuickNavItem {
  label: string;
  href: string;
}

interface QuickNavCard {
  label: string;
  icon: ElementType;
  color: string;
  bg: string;
  items: QuickNavItem[];
}

const QUICK_NAV_CARDS: QuickNavCard[] = [
  {
    label: "Logistic Orders",
    icon: Truck,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    items: [
      { label: "Semua Order",     href: "/logistics" },
      { label: "Buat Order Baru", href: "/logistics/freight/new" },
      { label: "RFQ / Penawaran", href: "/logistics/rfq" },
      { label: "Tracking",        href: "/logistics/portal-orders" },
    ],
  },
  {
    label: "Sales Orders",
    icon: ShoppingCart,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    items: [
      { label: "Semua Order",   href: "/sales/orders" },
      { label: "Quotation",     href: "/sales/quotations" },
      { label: "Invoice",       href: "/sales/invoices" },
      { label: "Sales Items",   href: "/sales/items" },
    ],
  },
  {
    label: "Customers",
    icon: Users,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    items: [
      { label: "Semua Customer",    href: "/sales/customers" },
      { label: "Customer Portal",   href: "/portal/customers" },
      { label: "Quote Requests",    href: "/logistics/quote-requests" },
      { label: "Portal Orders",     href: "/logistics/portal-orders" },
    ],
  },
  {
    label: "Vendors",
    icon: Building2,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    items: [
      { label: "Semua Vendor",    href: "/purchase/vendors" },
      { label: "Purchase Orders", href: "/purchase/orders" },
      { label: "Bills",           href: "/purchase/bills" },
      { label: "RFQ Vendor",      href: "/purchase/rfq" },
    ],
  },
  {
    label: "Shipments",
    icon: Ship,
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
    items: [
      { label: "Semua Shipment",  href: "/logistics/freight" },
      { label: "Air Freight",     href: "/logistics/air-freight" },
      { label: "Ocean Freight",   href: "/logistics/ocean-freight" },
      { label: "Trucking",        href: "/logistics/trucking" },
    ],
  },
  {
    label: "Staff",
    icon: User,
    color: "text-rose-500",
    bg: "bg-rose-500/10",
    items: [
      { label: "Semua Staff",  href: "/users" },
      { label: "Roles",        href: "/settings/roles" },
      { label: "Org Chart",    href: "/org" },
      { label: "Approval Rules",   href: "/settings/approval-rules" },
      { label: "Approval Matrix",  href: "/settings/approval-matrix" },
    ],
  },
];

function SettingsStatsBar() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {QUICK_NAV_CARDS.map(({ label, icon: Icon, color, bg, items }) => (
        <div
          key={label}
          className="rounded-xl border bg-card p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <div className={`rounded-lg p-2 ${bg} shrink-0`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="text-sm font-semibold text-foreground leading-tight">{label}</p>
          </div>
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <span>{item.label}</span>
                <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Settings Hub Grid ──────────────────────────────────────────────────────────

const SETTINGS_HUB_CARDS: QuickNavCard[] = [
  {
    label: "Profil Perusahaan",
    icon: Building2,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    items: [
      { label: "Informasi Dasar & Alamat", href: "/settings/company-profile" },
      { label: "Data Perpajakan (DJP)",    href: "/settings/company-profile" },
      { label: "Dokumen Legal & Akta",     href: "/settings/company-profile" },
      { label: "Nav & Company Config",     href: "/settings/nav-company-config" },
    ],
  },
  {
    label: "WhatsApp & Notifikasi",
    icon: MessageCircle,
    color: "text-green-500",
    bg: "bg-green-500/10",
    items: [
      { label: "WA Templates",            href: "/settings/wa-templates" },
      { label: "Enterprise WA Templates", href: "/settings/enterprise-wa-templates" },
      { label: "WA Notification Logs",    href: "/settings/wa-notification-logs" },
    ],
  },
  {
    label: "AI & Otomasi",
    icon: Bot,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    items: [
      { label: "AI Chatbot",      href: "/settings/ai-chatbot" },
      { label: "Knowledge Base",  href: "/settings/ai-chatbot/knowledge" },
      { label: "AI Scan / OCR",   href: "/settings/ai-scan" },
    ],
  },
  {
    label: "Template & Dokumen",
    icon: FileText,
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
    items: [
      { label: "Document Templates", href: "/settings/document-templates" },
      { label: "Product Templates",  href: "/settings/product-templates" },
      { label: "Service Templates",  href: "/settings/service-templates" },
    ],
  },
  {
    label: "Konfigurasi Logistik",
    icon: Truck,
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
    items: [
      { label: "Satuan Logistik",  href: "/settings/logistics-units" },
      { label: "Trucking Rates",   href: "/settings/trucking-rates" },
      { label: "Vehicle Images",   href: "/settings/vehicle-images" },
      { label: "Unit of Measure",  href: "/settings/uom" },
    ],
  },
  {
    label: "Akun & Pengguna",
    icon: Shield,
    color: "text-rose-500",
    bg: "bg-rose-500/10",
    items: [
      { label: "Roles",           href: "/settings/roles" },
      { label: "Approval Rules",   href: "/settings/approval-rules" },
      { label: "Approval Matrix",  href: "/settings/approval-matrix" },
      { label: "Users",           href: "/users" },
      { label: "Org Chart",       href: "/org" },
    ],
  },
  {
    label: "Sistem & Keamanan",
    icon: Key,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    items: [
      { label: "Email Login Admin",    href: "#email-login-admin" },
      { label: "App Secrets",          href: "/settings/secrets" },
      { label: "Short Links",          href: "/settings/short-links" },
      { label: "Nav & Company Config", href: "/settings/nav-company-config" },
      { label: "System Health",        href: "/system-health" },
    ],
  },
];

function SettingsHubGrid() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem("settings_hub_open") !== "false"; } catch { return true; }
  });
  const toggle = () => setOpen((v) => {
    const next = !v;
    try { localStorage.setItem("settings_hub_open", String(next)); } catch {}
    return next;
  });
  return (
    <div className="rounded-xl border bg-card">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors rounded-xl"
      >
        <span className="text-sm font-semibold text-foreground">Modul Settings</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {SETTINGS_HUB_CARDS.map(({ label, icon: Icon, color, bg, items }) => (
              <div
                key={label}
                className="rounded-xl border bg-background p-4 flex flex-col gap-3"
              >
                <div className="flex items-center gap-2">
                  <div className={`rounded-lg p-2 ${bg} shrink-0`}>
                    <Icon className={`h-4 w-4 ${color}`} />
                  </div>
                  <p className="text-sm font-semibold text-foreground leading-tight">{label}</p>
                </div>
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => item.href.startsWith("#") ? (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={(e) => {
                        e.preventDefault();
                        document.querySelector(item.href)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className="group flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                    >
                      <span>{item.label}</span>
                      <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </a>
                  ) : (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      <span>{item.label}</span>
                      <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface UserPasswordStatus {
  id: string;
  email: string;
  name: string;
  role: string;
  hasPassword: boolean;
}

function EmailLoginAdminCard() {
  const [users, setUsers] = useState<UserPasswordStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/auth/admin/users-password-status", { credentials: "include" });
      if (r.ok) {
        const d = await r.json() as { users: UserPasswordStatus[] };
        setUsers(d.users ?? []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSet = async (userId: string) => {
    const pw = passwords[userId] ?? "";
    if (!pw || pw.length < 6) { toast({ title: "Password minimal 6 karakter", variant: "destructive" }); return; }
    setSaving(userId);
    try {
      const r = await fetch("/api/auth/admin/set-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, password: pw }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; email?: string };
      if (!r.ok) { toast({ title: d.error ?? "Gagal menyimpan", variant: "destructive" }); return; }
      toast({ title: `Password untuk ${d.email} berhasil disimpan` });
      setPasswords(prev => ({ ...prev, [userId]: "" }));
      await load();
    } catch { toast({ title: "Gagal menyimpan password", variant: "destructive" }); }
    finally { setSaving(null); }
  };

  const handleRemove = async (userId: string, email: string) => {
    if (!confirm(`Hapus password login untuk ${email}?`)) return;
    setRemoving(userId);
    try {
      const r = await fetch(`/api/auth/admin/remove-password/${userId}`, {
        method: "DELETE", credentials: "include",
      });
      if (!r.ok) { toast({ title: "Gagal menghapus", variant: "destructive" }); return; }
      toast({ title: "Password berhasil dihapus" });
      await load();
    } catch { toast({ title: "Gagal menghapus", variant: "destructive" }); }
    finally { setRemoving(null); }
  };

  return (
    <Card id="email-login-admin" className="col-span-1 md:col-span-3 bg-card border-border scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Key className="w-4 h-4 text-indigo-500" /> Login Email & Password
        </CardTitle>
        <CardDescription>
          Daftarkan password untuk setiap pengguna agar bisa masuk lewat tab "Email" di halaman login — tanpa Google.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada pengguna terdaftar.</p>
        ) : (
          <div className="space-y-3">
            {users.map(u => (
              <div key={u.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-border bg-background">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.name || u.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs">{u.role}</Badge>
                    {u.hasPassword ? (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-300">✓ Password aktif</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">Belum ada password</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    type="password"
                    placeholder={u.hasPassword ? "Ganti password..." : "Set password baru..."}
                    value={passwords[u.id] ?? ""}
                    onChange={e => setPasswords(prev => ({ ...prev, [u.id]: e.target.value }))}
                    className="h-8 text-xs w-44"
                    autoComplete="new-password"
                  />
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs bg-indigo-600 hover:bg-indigo-700"
                    disabled={!passwords[u.id] || saving === u.id}
                    onClick={() => handleSet(u.id)}
                  >
                    {saving === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    <span className="ml-1">{u.hasPassword ? "Ganti" : "Simpan"}</span>
                  </Button>
                  {u.hasPassword && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                      disabled={removing === u.id}
                      onClick={() => handleRemove(u.id, u.email)}
                      title="Hapus password login"
                    >
                      {removing === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { isAuthenticated } = useSupabaseAuth();
  const { data: dbUser, isLoading } = useGetCurrentUser({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetCurrentUserQueryKey(),
      staleTime: Infinity,
    }
  });
  const { toast } = useToast();
  const [waNumber, setWaNumber] = useState("");
  const [waSaving, setWaSaving] = useState(false);

  useEffect(() => {
    if (dbUser && (dbUser as any).whatsapp !== undefined) {
      setWaNumber((dbUser as any).whatsapp ?? "");
    }
  }, [dbUser]);

  const saveWaNumber = async () => {
    setWaSaving(true);
    try {
      const r = await fetch("/api/users/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsapp: waNumber }),
      });
      if (!r.ok) throw new Error("Gagal menyimpan");
      toast({ title: "Nomor WhatsApp tersimpan", description: "Notifikasi PR akan dikirim ke nomor ini." });
    } catch {
      toast({ title: "Gagal menyimpan", variant: "destructive" });
    } finally {
      setWaSaving(false);
    }
  };

  const isAdmin = dbUser?.role === "admin";

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-8">
        <PageHeader
          title="Settings"
          description="Manage your account preferences and view your organizational role."
          favoriteEnabled
        />

        {isAdmin && <SettingsHubGrid />}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="col-span-1 md:col-span-2 bg-card border-border">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                Profile Information
              </CardTitle>
              <CardDescription>Your personal details within BizPortal</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoading ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24 bg-muted" />
                    <Skeleton className="h-10 w-full bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24 bg-muted" />
                    <Skeleton className="h-10 w-full bg-muted" />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <User className="h-4 w-4" /> Full Name
                    </label>
                    <div className="p-3 bg-background rounded-md border border-border text-foreground font-medium">
                      {dbUser?.name || "Not provided"}
                    </div>
                  </div>
                  
                  <div className="flex flex-col space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Mail className="h-4 w-4" /> Email Address
                    </label>
                    <div className="p-3 bg-background rounded-md border border-border text-foreground font-medium">
                      {dbUser?.email || "Not provided"}
                    </div>
                  </div>

                  <div className="flex flex-col space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <MessageCircle className="h-4 w-4" /> Nomor WhatsApp
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Digunakan untuk notifikasi otomatis status Purchase Request (approved/rejected). Format: 628xxx atau 08xxx.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="contoh: 6281234567890"
                        value={waNumber}
                        onChange={(e) => setWaNumber(e.target.value)}
                        className="flex-1 bg-background border-border"
                      />
                      <Button
                        size="sm"
                        onClick={saveWaNumber}
                        disabled={waSaving}
                        className="shrink-0"
                      >
                        {waSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        <span className="ml-1">Simpan</span>
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="col-span-1 bg-card border-border">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary" />
                Access Level
              </CardTitle>
              <CardDescription>Your assigned permissions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-8 w-24 bg-muted rounded-full" />
                  <Skeleton className="h-8 w-32 bg-muted rounded-full" />
                </div>
              ) : (
                <>
                  <div className="flex flex-col space-y-3">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Role
                    </label>
                    <div>
                      <Badge variant="default" className="text-sm px-3 py-1 bg-primary text-primary-foreground uppercase tracking-wider">
                        {dbUser?.role || "Unassigned"}
                      </Badge>
                    </div>
                  </div>
                  
                  {dbUser?.division && (
                    <div className="flex flex-col space-y-3">
                      <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Briefcase className="h-4 w-4" /> Division
                      </label>
                      <div>
                        <Badge variant="outline" className="text-sm px-3 py-1 border-border text-foreground">
                          {dbUser.division}
                        </Badge>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          
          {isAdmin && <WhatsAppNotificationCard />}
          {isAdmin && <AiIntakeSettingsCard />}
          {isAdmin && <CargoTypesCard />}
          {isAdmin && <LogisticsSubcategoriesCard />}
          {isAdmin && <CalculatorRatesCard />}
          {isAdmin && <VendorMiniFormCard />}
          {isAdmin && <PageContentCard />}
          {isAdmin && <FreightStageLabelsCard />}
          {isAdmin && <WaTemplatesCard />}
          {isAdmin && <WaLogsCard />}


          {isAdmin && (
            <Card className="col-span-1 md:col-span-3 bg-card border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" /> Product Templates
                </CardTitle>
                <CardDescription>
                  Kelola template komoditas — custom fields, dokumen wajib, checklist, dan aturan validasi per kategori.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href="/bizportal/settings/product-templates">
                  <Button variant="outline" size="sm">
                    <Layers className="w-4 h-4 mr-2" /> Kelola Product Templates
                  </Button>
                </a>
              </CardContent>
            </Card>
          )}

          {isAdmin && (
            <Card className="col-span-1 md:col-span-3 bg-card border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" /> Template Dokumen
                </CardTitle>
                <CardDescription>
                  Konfigurasi desain & branding untuk semua dokumen bisnis dan legal — Invoice, Penawaran, PO, Surat Jalan, Packing List, MOU, Kontrak, NDA, SLA.
                  Termasuk logo, warna, header/footer, syarat & ketentuan, dan preview PDF langsung.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href="/bizportal/settings/document-templates">
                  <Button variant="outline" size="sm">
                    <FileText className="w-4 h-4 mr-2" /> Kelola Template Dokumen
                  </Button>
                </a>
              </CardContent>
            </Card>
          )}

          {isAdmin && (
            <Card className="col-span-1 md:col-span-3 bg-card border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="w-4 h-4 text-orange-500" /> Tarif Kendaraan Trucking
                </CardTitle>
                <CardDescription>
                  Atur tarif per kg dan harga minimum untuk setiap jenis kendaraan (CDE, CDD, Fuso, Wingbox, Trailer).
                  Tarif ini digunakan sebagai estimasi offline di Customer Portal.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href="/bizportal/settings/trucking-rates">
                  <Button variant="outline" size="sm">
                    <Truck className="w-4 h-4 mr-2 text-orange-500" /> Kelola Tarif Kendaraan
                  </Button>
                </a>
              </CardContent>
            </Card>
          )}

          {isAdmin && (
            <Card className="col-span-1 md:col-span-3 bg-card border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-500" /> Gambar Armada Trucking
                </CardTitle>
                <CardDescription>
                  Upload foto atau ilustrasi nyata per jenis kendaraan (Mobil, Van, CDD Long, Fuso, Tronton, dll).
                  Gambar yang diupload akan tampil di halaman Trucking Customer Portal menggantikan ilustrasi SVG bawaan.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href="/bizportal/settings/vehicle-images">
                  <Button variant="outline" size="sm">
                    <Truck className="w-4 h-4 mr-2 text-blue-500" /> Kelola Gambar Armada
                  </Button>
                </a>
              </CardContent>
            </Card>
          )}

          <Card className="col-span-1 md:col-span-3 bg-card border-border">
            <CardHeader>
              <CardTitle className="text-xl">Authentication</CardTitle>
              <CardDescription>Manage your security settings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 bg-background rounded-lg border border-border">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Replit Auth</p>
                  <p className="text-sm text-muted-foreground">Your account is managed via Replit authentication.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { window.location.href = "/api/logout?redirect=/bizportal/"; }}>
                  Sign Out
                </Button>
              </div>
            </CardContent>
          </Card>

          {isAdmin && <EmailLoginAdminCard />}
        </div>
      </div>
    </AppShell>
  );
}
