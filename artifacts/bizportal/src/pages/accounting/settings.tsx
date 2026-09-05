import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  useGetAccountingSettings, useUpdateAccountingSettings, useListAccounts, useListJournals, useListTaxes,
  getGetAccountingSettingsQueryKey,
} from "@workspace/api-client-react";
import type { UpdateAccountingSettingsBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Settings as SettingsIcon, Upload, X, Send, CheckCircle2, Clock, Plus, Pencil, Trash2 } from "lucide-react";
import { useUpload } from "@workspace/object-storage-web";
import { Link } from "wouter";

type SettingsForm = Required<UpdateAccountingSettingsBody>;

const EMPTY: SettingsForm = {
  arAccountId: null, apAccountId: null, salesIncomeAccountId: null, purchaseExpenseAccountId: null,
  defaultBankAccountId: null, defaultCashAccountId: null,
  ppnOutputAccountId: null, ppnInputAccountId: null,
  inventoryAccountId: null, cogsAccountId: null,
  salesJournalId: null, purchaseJournalId: null,
  bankJournalId: null, cashJournalId: null,
  defaultSalesTaxId: null, defaultPurchaseTaxId: null,
  companyName: null, companyAddress: null, companyNpwp: null, companyLogoUrl: null,
};

type RevenueMapping = {
  id: number;
  moduleKey: string;
  serviceKey: string;
  label: string;
  revenueAccountId: number;
  revenueAccountCode: string | null;
  revenueAccountName: string | null;
  isActive: boolean;
};

const REVENUE_MODULES = [
  { value: "sport_center", label: "Sport Center" },
  { value: "tenant", label: "Tenant / Rental" },
  { value: "logistics", label: "Logistics / Freight" },
  { value: "pos", label: "POS / Produk" },
  { value: "other", label: "Usaha Lainnya" },
];

function getLogoServeUrl(objectPath: string) {
  if (objectPath.startsWith("/objects/")) return `/api/storage${objectPath}`;
  return objectPath;
}

interface WaReportSettings {
  enabled: boolean;
  sendHourWib: number;
  recipients: string[];
  lastSentDate: string | null;
  lastStatus: string | null;
}

export default function AccountingSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { activeCompanyId } = useCompany();
  const { data: settings, isLoading } = useGetAccountingSettings();
  const { data: accounts } = useListAccounts();
  const { data: journals } = useListJournals();
  const { data: taxes } = useListTaxes();
  const updateMut = useUpdateAccountingSettings();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  // WA Report state
  const [waSettings, setWaSettings] = useState<WaReportSettings | null>(null);
  const [waSending, setWaSending] = useState(false);

  useEffect(() => {
    fetch("/api/accounting/wa-report/settings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setWaSettings(d as WaReportSettings))
      .catch(() => {});
  }, []);

  const handleSendNow = async () => {
    setWaSending(true);
    try {
      const res = await fetch("/api/accounting/wa-report/send-now", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { ok: boolean; message: string; recipients: string[]; errors: string[] };
      if (data.ok) {
        toast({ title: "Laporan terkirim", description: `Ke: ${data.recipients.join(", ")}` });
      } else if (data.errors?.length) {
        toast({ title: "Sebagian gagal", description: data.errors.join("; "), variant: "destructive" });
      } else {
        toast({ title: "Tidak terkirim", description: data.message, variant: "destructive" });
      }
      // refresh status
      fetch("/api/accounting/wa-report/settings", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setWaSettings(d as WaReportSettings))
        .catch(() => {});
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setWaSending(false);
    }
  };

  const { uploadFile } = useUpload({
    onError: (err) => {
      toast({ title: t.common.error, variant: "destructive" });
      setLogoUploading(false);
    },
  });

  const [form, setForm] = useState<SettingsForm>(EMPTY);
  const [revenueMappings, setRevenueMappings] = useState<RevenueMapping[]>([]);
  const [mappingForm, setMappingForm] = useState({
    moduleKey: "sport_center",
    serviceKey: "*",
    label: "",
    revenueAccountId: null as number | null,
    isActive: true,
  });
  const [editingMappingId, setEditingMappingId] = useState<number | null>(null);
  const [mappingBusy, setMappingBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        arAccountId: settings.arAccountId ?? null,
        apAccountId: settings.apAccountId ?? null,
        salesIncomeAccountId: settings.salesIncomeAccountId ?? null,
        purchaseExpenseAccountId: settings.purchaseExpenseAccountId ?? null,
        defaultBankAccountId: settings.defaultBankAccountId ?? null,
        defaultCashAccountId: settings.defaultCashAccountId ?? null,
        ppnOutputAccountId: settings.ppnOutputAccountId ?? null,
        ppnInputAccountId: settings.ppnInputAccountId ?? null,
        inventoryAccountId: settings.inventoryAccountId ?? null,
        cogsAccountId: settings.cogsAccountId ?? null,
        salesJournalId: settings.salesJournalId ?? null,
        purchaseJournalId: settings.purchaseJournalId ?? null,
        bankJournalId: settings.bankJournalId ?? null,
        cashJournalId: settings.cashJournalId ?? null,
        defaultSalesTaxId: settings.defaultSalesTaxId ?? null,
        defaultPurchaseTaxId: settings.defaultPurchaseTaxId ?? null,
        companyName: settings.companyName ?? null,
        companyAddress: settings.companyAddress ?? null,
        companyNpwp: settings.companyNpwp ?? null,
        companyLogoUrl: settings.companyLogoUrl ?? null,
      });
    }
  }, [settings]);

  const handleLogoUpload = async (file: File) => {
    setLogoUploading(true);
    try {
      const result = await uploadFile(file);
      if (result?.objectPath) {
        setForm((prev) => ({ ...prev, companyLogoUrl: result.objectPath }));
        toast({ title: t.common.success });
      }
    } finally {
      setLogoUploading(false);
    }
  };

  const submit = async () => {
    try {
      await updateMut.mutateAsync({ data: form });
      toast({ title: t.common.success });
      qc.invalidateQueries({ queryKey: getGetAccountingSettingsQueryKey() });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    }
  };

  const loadRevenueMappings = async () => {
    if (!activeCompanyId) {
      setRevenueMappings([]);
      return;
    }
    const res = await fetch(`/api/accounting/revenue-mappings?companyId=${activeCompanyId}`, { credentials: "include" });
    if (!res.ok) throw new Error("Gagal memuat mapping pendapatan");
    setRevenueMappings(await res.json() as RevenueMapping[]);
  };

  useEffect(() => {
    loadRevenueMappings().catch(() => {});
  }, [activeCompanyId]);

  const resetMappingForm = () => {
    setEditingMappingId(null);
    setMappingForm({
      moduleKey: "sport_center",
      serviceKey: "*",
      label: "",
      revenueAccountId: null,
      isActive: true,
    });
  };

  const saveRevenueMapping = async () => {
    if (!activeCompanyId) {
      toast({ title: "Pilih perusahaan aktif terlebih dahulu", variant: "destructive" });
      return;
    }
    if (!mappingForm.label.trim() || !mappingForm.revenueAccountId) {
      toast({ title: "Lengkapi label dan akun pendapatan", variant: "destructive" });
      return;
    }
    setMappingBusy(true);
    try {
      const path = editingMappingId
        ? `/api/accounting/revenue-mappings/${editingMappingId}`
        : "/api/accounting/revenue-mappings";
      const res = await fetch(path, {
        method: editingMappingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...mappingForm,
          companyId: activeCompanyId,
          serviceKey: mappingForm.serviceKey.trim() || "*",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadRevenueMappings();
      resetMappingForm();
      toast({ title: "Mapping pendapatan tersimpan" });
    } catch (e) {
      toast({ title: "Gagal menyimpan mapping", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setMappingBusy(false);
    }
  };

  const editRevenueMapping = (mapping: RevenueMapping) => {
    setEditingMappingId(mapping.id);
    setMappingForm({
      moduleKey: mapping.moduleKey,
      serviceKey: mapping.serviceKey,
      label: mapping.label,
      revenueAccountId: mapping.revenueAccountId,
      isActive: mapping.isActive,
    });
  };

  const deleteRevenueMapping = async (mapping: RevenueMapping) => {
    if (!window.confirm(`Hapus mapping "${mapping.label}"?`)) return;
    if (!activeCompanyId) {
      toast({ title: "Pilih perusahaan aktif terlebih dahulu", variant: "destructive" });
      return;
    }
    setMappingBusy(true);
    try {
      const res = await fetch(`/api/accounting/revenue-mappings/${mapping.id}?companyId=${activeCompanyId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      await loadRevenueMappings();
      if (editingMappingId === mapping.id) resetMappingForm();
      toast({ title: "Mapping pendapatan dihapus" });
    } catch (e) {
      toast({ title: "Gagal menghapus mapping", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setMappingBusy(false);
    }
  };

  const accSelect = (key: keyof SettingsForm, label: string, filterType?: string[]) => {
    const list = (accounts ?? []).filter((a) => a.isActive && (!filterType || filterType.includes(a.type)));
    return (
      <div>
        <Label>{label}</Label>
        <Select value={form[key] ? String(form[key]) : "none"} onValueChange={(v) => setForm({ ...form, [key]: v === "none" ? null : parseInt(v) })}>
          <SelectTrigger data-testid={`select-${String(key)}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Tidak ada —</SelectItem>
            {list.map((a) => (<SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const jSelect = (key: keyof SettingsForm, label: string, type: string) => (
    <div>
      <Label>{label}</Label>
      <Select value={form[key] ? String(form[key]) : "none"} onValueChange={(v) => setForm({ ...form, [key]: v === "none" ? null : parseInt(v) })}>
        <SelectTrigger data-testid={`select-${String(key)}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— Tidak ada —</SelectItem>
          {(journals ?? []).filter((j) => j.type === type).map((j) => (<SelectItem key={j.id} value={String(j.id)}>{j.code} - {j.name}</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );

  const tSelect = (key: keyof SettingsForm, label: string, kind: string) => (
    <div>
      <Label>{label}</Label>
      <Select value={form[key] ? String(form[key]) : "none"} onValueChange={(v) => setForm({ ...form, [key]: v === "none" ? null : parseInt(v) })}>
        <SelectTrigger data-testid={`select-${String(key)}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— Tidak ada —</SelectItem>
          {(taxes ?? []).filter((t) => t.kind === kind && t.isActive).map((t) => (<SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.rate}%)</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );

  if (isLoading) return <AppShell><div className="p-6">Memuat...</div></AppShell>;

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div>
          <Link href="/settings"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

          <h1 className="text-2xl font-bold flex items-center gap-2"><SettingsIcon className="h-6 w-6" />Pengaturan Akunting</h1>
          <p className="text-sm text-muted-foreground">Mapping akun &amp; jurnal default untuk auto-posting semua modul</p>
        </div>

        <Card>
          <CardHeader><CardTitle>Profil Perusahaan</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div>
              <Label htmlFor="companyName">Nama Perusahaan</Label>
              <Input
                id="companyName"
                data-testid="input-companyName"
                value={form.companyName ?? ""}
                onChange={(e) => setForm({ ...form, companyName: e.target.value || null })}
                placeholder="Cth. PT Maju Bersama"
              />
            </div>
            <div>
              <Label htmlFor="companyAddress">Alamat Perusahaan</Label>
              <Textarea
                id="companyAddress"
                data-testid="input-companyAddress"
                value={form.companyAddress ?? ""}
                onChange={(e) => setForm({ ...form, companyAddress: e.target.value || null })}
                placeholder="Cth. Jl. Sudirman No. 1, Jakarta Pusat 10220"
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="companyNpwp">NPWP Perusahaan</Label>
              <Input
                id="companyNpwp"
                data-testid="input-companyNpwp"
                value={form.companyNpwp ?? ""}
                onChange={(e) => setForm({ ...form, companyNpwp: e.target.value || null })}
                placeholder="Cth. 01.234.567.8-901.000"
              />
            </div>
            <div>
              <Label>Logo Perusahaan</Label>
              <p className="text-xs text-muted-foreground mb-2">Logo akan tampil di header invoice yang dicetak.</p>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                data-testid="input-companyLogo"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = "";
                }}
              />
              {form.companyLogoUrl ? (
                <div className="flex items-start gap-3">
                  <img
                    src={getLogoServeUrl(form.companyLogoUrl)}
                    alt="Logo Perusahaan"
                    className="h-16 w-auto max-w-[200px] rounded border object-contain bg-white"
                    data-testid="preview-companyLogo"
                  />
                  <div className="flex flex-col gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoUploading}
                      data-testid="button-changeLogo"
                    >
                      <Upload className="h-3 w-3 mr-1" />
                      {logoUploading ? "Mengunggah..." : "Ganti Logo"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setForm((prev) => ({ ...prev, companyLogoUrl: null }))}
                      data-testid="button-removeLogo"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Hapus
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploading}
                  data-testid="button-uploadLogo"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {logoUploading ? "Mengunggah..." : "Unggah Logo"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Akun Default — Sales &amp; Purchase</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {accSelect("arAccountId", "Piutang Usaha (AR)", ["asset"])}
            {accSelect("apAccountId", "Hutang Usaha (AP)", ["liability"])}
            {accSelect("salesIncomeAccountId", "Pendapatan Default / Fallback", ["revenue"])}
            {accSelect("purchaseExpenseAccountId", "Beban Pembelian / HPP", ["expense"])}
            {accSelect("ppnOutputAccountId", "PPN Keluaran", ["liability"])}
            {accSelect("ppnInputAccountId", "PPN Masukan", ["asset"])}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mapping Pendapatan per Modul / Layanan</CardTitle>
            <p className="text-sm text-muted-foreground">
              Mapping spesifik diprioritaskan sebelum akun Pendapatan Default / Fallback.
              Gunakan <span className="font-mono">*</span> untuk semua layanan dalam modul.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
              <div>
                <Label>Modul</Label>
                <Select value={mappingForm.moduleKey} onValueChange={(value) => setMappingForm({ ...mappingForm, moduleKey: value })}>
                  <SelectTrigger data-testid="select-revenue-mapping-module"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REVENUE_MODULES.map((module) => <SelectItem key={module.value} value={module.value}>{module.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Service Key</Label>
                <Input
                  data-testid="input-revenue-mapping-service"
                  value={mappingForm.serviceKey}
                  onChange={(e) => setMappingForm({ ...mappingForm, serviceKey: e.target.value })}
                  placeholder="* atau booking"
                />
              </div>
              <div>
                <Label>Nama Mapping</Label>
                <Input
                  data-testid="input-revenue-mapping-label"
                  value={mappingForm.label}
                  onChange={(e) => setMappingForm({ ...mappingForm, label: e.target.value })}
                  placeholder="Pendapatan Booking Sport Center"
                />
              </div>
              <div>
                <Label>Akun Pendapatan</Label>
                <Select
                  value={mappingForm.revenueAccountId ? String(mappingForm.revenueAccountId) : "none"}
                  onValueChange={(value) => setMappingForm({ ...mappingForm, revenueAccountId: value === "none" ? null : Number(value) })}
                >
                  <SelectTrigger data-testid="select-revenue-mapping-account"><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Pilih akun —</SelectItem>
                    {(accounts ?? []).filter((a) => a.isActive && a.type === "revenue").map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.code} {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={saveRevenueMapping} disabled={mappingBusy} className="flex-1" data-testid="button-save-revenue-mapping">
                  {editingMappingId ? <Pencil className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                  {editingMappingId ? "Update" : "Tambah"}
                </Button>
                {editingMappingId && <Button variant="outline" onClick={resetMappingForm} disabled={mappingBusy}>Batal</Button>}
              </div>
            </div>

            {revenueMappings.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Belum ada mapping spesifik. Sistem memakai akun default/fallback.
              </div>
            ) : (
              <div className="divide-y rounded-md border">
                {revenueMappings.map((mapping) => (
                  <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="font-medium">{mapping.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {REVENUE_MODULES.find((module) => module.value === mapping.moduleKey)?.label ?? mapping.moduleKey}
                        {" · service: "}
                        <span className="font-mono">{mapping.serviceKey}</span>
                        {" · "}
                        <span className="font-mono">{mapping.revenueAccountCode ?? `#${mapping.revenueAccountId}`}</span>
                        {" "}
                        {mapping.revenueAccountName ?? ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={mapping.isActive ? "default" : "secondary"}>{mapping.isActive ? "Aktif" : "Nonaktif"}</Badge>
                      <Button size="icon" variant="ghost" aria-label="Edit mapping" onClick={() => editRevenueMapping(mapping)} disabled={mappingBusy}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Hapus mapping" onClick={() => deleteRevenueMapping(mapping)} disabled={mappingBusy}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Akun Default — Kas, Bank &amp; Persediaan</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {accSelect("defaultBankAccountId", "Bank Default", ["asset"])}
            {accSelect("defaultCashAccountId", "Kas Default (POS tunai/QRIS)", ["asset"])}
            {accSelect("inventoryAccountId", "Persediaan Barang (Trading)", ["asset"])}
            {accSelect("cogsAccountId", "HPP / COGS", ["expense"])}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Jurnal Default</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {jSelect("salesJournalId", "Jurnal Penjualan", "sales")}
            {jSelect("purchaseJournalId", "Jurnal Pembelian", "purchase")}
            {jSelect("bankJournalId", "Jurnal Bank", "bank")}
            {jSelect("cashJournalId", "Jurnal Kas (POS tunai/QRIS)", "cash")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pajak Default</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {tSelect("defaultSalesTaxId", "Pajak Penjualan Default", "sale")}
            {tSelect("defaultPurchaseTaxId", "Pajak Pembelian Default", "purchase")}
          </CardContent>
        </Card>

        {/* ── Laporan WA Harian ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-green-600" />
              Laporan Harian WhatsApp
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Jadwal Otomatis</p>
                <p className="text-xs text-muted-foreground">Setiap hari pukul 22:00 WIB</p>
              </div>
              {waSettings ? (
                waSettings.enabled
                  ? <Badge className="bg-green-100 text-green-700 border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Aktif</Badge>
                  : <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Nonaktif</Badge>
              ) : (
                <Badge variant="outline">Memuat...</Badge>
              )}
            </div>

            <div>
              <p className="text-sm font-medium mb-1">Penerima</p>
              <div className="flex gap-2 flex-wrap">
                {waSettings?.recipients?.map((r) => (
                  <Badge key={r} variant="outline" className="font-mono text-xs">{r}</Badge>
                )) ?? <span className="text-xs text-muted-foreground">—</span>}
              </div>
            </div>

            {waSettings?.lastSentDate && (
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Terakhir dikirim: <span className="font-medium text-foreground">{waSettings.lastSentDate}</span>
                {waSettings.lastStatus && (
                  <span className="ml-2">— {waSettings.lastStatus}</span>
                )}
              </div>
            )}

            <div className="pt-1">
              <Button
                onClick={handleSendNow}
                disabled={waSending}
                className="gap-2"
              >
                <Send className="h-4 w-4" />
                {waSending ? "Mengirim..." : "Kirim Laporan Sekarang"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">
                Mengirim laporan hari ini ke semua penerima di atas.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={submit} data-testid="button-save-settings">Simpan</Button>
        </div>
      </div>
    </AppShell>
  );
}
