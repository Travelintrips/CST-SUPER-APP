import { useState, useRef, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import {
  ArrowLeft, Building2, Save, Loader2, Upload, Trash2, FileText,
  Shield, MapPin, Phone, CheckCircle2, AlertCircle,
  FilePlus, ExternalLink, ScanLine, Sparkles, Info, FolderDown,
} from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Company {
  id: number; companyName: string; companyCode: string; logoUrl?: string;
  address?: string; city?: string; province?: string; postalCode?: string; kodeWilayah?: string;
  phone?: string; fax?: string; email?: string; website?: string;
  npwp?: string; npwpStatus?: string; kegiatanUtama?: string; jenisWajibPajak?: string;
  bentukBadanHukum?: string; tanggalTerdaftar?: string; tanggalAktivasi?: string;
  statusPkp?: boolean; tanggalPkp?: string; kanwilDjp?: string; kppTerdaftar?: string;
  seksiPengawasan?: string; tanggalPembaruanProfil?: string; kodeKlu?: string; deskripsiKlu?: string;
  nib?: string;
}
interface LegalDoc { id: number; companyId: number; docType: string; docName: string; fileUrl: string; fileSize?: number; mimeType?: string; notes?: string; createdAt: string; }

const DOC_TYPE_LABELS: Record<string, string> = {
  akta_pendirian: "Akta Pendirian",
  akta_perubahan: "Akta Perubahan",
  sk_kumham: "SK Kemenkumham (KUMHAM)",
  nib_doc: "NIB (Nomor Induk Berusaha)",
  siup: "SIUP",
  tdp: "TDP",
  skdp: "SKDP / Domisili",
  izin_usaha: "Izin Usaha Lainnya",
  domisili: "Surat Keterangan Domisili",
  sppkp: "SPPKP",
  lainnya: "Dokumen Lainnya",
};

const ALL_DOC_TYPES = Object.keys(DOC_TYPE_LABELS);

// ─── Field helper ──────────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = "text", className }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-9" />
    </div>
  );
}

// ─── Tab pill ──────────────────────────────────────────────────────────────────
function TabPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn(
      "px-4 py-2 text-sm font-medium rounded-full border transition-colors",
      active ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted",
    )}>{label}</button>
  );
}

export default function CompanyProfilePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId ?? 1;
  const [tab, setTab] = useState<"basic" | "pajak" | "dokumen">("basic");
  const [form, setForm] = useState<Partial<Company>>({});
  const [dirty, setDirty] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState<Record<string, any> | null>(null);
  const [newDoc, setNewDoc] = useState<{ docType: string; docName: string; notes: string }>({ docType: "akta_pendirian", docName: "", notes: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Fetch company
  const { data: company, isLoading } = useQuery<Company>({
    queryKey: ["/api/companies", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/companies`, { credentials: "include" });
      const all: Company[] = await res.json();
      return all.find(c => c.id === companyId) ?? all[0]!;
    },
  });

  useEffect(() => {
    if (company) { setForm(company); setDirty(false); }
  }, [company]);

  const set = (k: keyof Company, v: any) => { setForm(p => ({ ...p, [k]: v })); setDirty(true); };

  // Save mutation
  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Gagal menyimpan");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profil disimpan", description: "Data perusahaan berhasil diperbarui" });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setDirty(false);
    },
    onError: (e: any) => toast({ title: "Gagal simpan", description: e.message, variant: "destructive" }),
  });

  // Legal docs
  const { data: docs = [] } = useQuery<LegalDoc[]>({
    queryKey: ["/api/companies/documents", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/documents`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const deleteDoc = useMutation({
    mutationFn: async (docId: number) => {
      const res = await fetch(`/api/companies/${companyId}/documents/${docId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message ?? "Gagal hapus");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/companies/documents"] }); toast({ title: "Dokumen dihapus" }); },
    onError: (e: any) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  const handleDownloadZip = async () => {
    setDownloadingZip(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/documents/download-zip`, { credentials: "include" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? "Gagal download"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "Dokumen_Legal.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download gagal", description: err.message, variant: "destructive" });
    } finally { setDownloadingZip(false); }
  };

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!newDoc.docName.trim()) { toast({ title: "Isi nama dokumen terlebih dahulu", variant: "destructive" }); return; }
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const uploadRes = await fetch("/api/storage/uploads/file", { method: "POST", credentials: "include", body: fd });
      if (!uploadRes.ok) throw new Error((await uploadRes.json()).error ?? "Upload gagal");
      const { objectPath } = await uploadRes.json();
      const docRes = await fetch(`/api/companies/${companyId}/documents`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType: newDoc.docType, docName: newDoc.docName, fileUrl: objectPath, fileSize: file.size, mimeType: file.type, notes: newDoc.notes }),
      });
      if (!docRes.ok) throw new Error((await docRes.json()).message ?? "Gagal simpan");
      toast({ title: "Dokumen berhasil diunggah" });
      queryClient.invalidateQueries({ queryKey: ["/api/companies/documents"] });
      setNewDoc({ docType: "akta_pendirian", docName: "", notes: "" });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      toast({ title: "Upload gagal", description: err.message, variant: "destructive" });
    } finally { setUploadingDoc(false); }
  };

  const handleScanNpwp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    setScanPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/companies/${companyId}/scan-npwp`, {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "OCR gagal");
      const { data } = await res.json();
      setScanPreview(data);

      // Auto-fill non-empty fields
      const mapping: Array<[keyof Company, string]> = [
        ["npwp", data.npwp], ["npwpStatus", data.npwp_status], ["nib", data.nib],
        ["kegiatanUtama", data.kegiatan_utama], ["jenisWajibPajak", data.jenis_wajib_pajak],
        ["bentukBadanHukum", data.bentuk_badan_hukum], ["tanggalTerdaftar", data.tanggal_terdaftar],
        ["tanggalAktivasi", data.tanggal_aktivasi], ["tanggalPkp", data.tanggal_pkp],
        ["kanwilDjp", data.kanwil_djp], ["kppTerdaftar", data.kpp_terdaftar],
        ["seksiPengawasan", data.seksi_pengawasan], ["tanggalPembaruanProfil", data.tanggal_pembaruan_profil],
        ["kodeKlu", data.kode_klu], ["deskripsiKlu", data.deskripsi_klu],
        ["kodeWilayah", data.kode_wilayah],
      ];
      const updates: Partial<Company> = {};
      for (const [key, val] of mapping) {
        if (val != null && String(val).trim() !== "") (updates as any)[key] = String(val).trim();
      }
      if (data.status_pkp != null) updates.statusPkp = !!data.status_pkp;
      if (data.alamat && !form.address) updates.address = String(data.alamat).trim();
      if (Object.keys(updates).length > 0) {
        setForm(p => ({ ...p, ...updates }));
        setDirty(true);
      }
      const filled = Object.keys(updates).length;
      toast({ title: `OCR selesai — ${filled} field terisi otomatis`, description: `Confidence: ${data.confidence ?? "?"}%. Cek dan simpan data.` });
    } catch (err: any) {
      toast({ title: "OCR gagal", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
      if (scanInputRef.current) scanInputRef.current.value = "";
    }
  };

  const fmtSize = (b?: number) => !b ? "" : b > 1024*1024 ? `${(b/1024/1024).toFixed(1)} MB` : `${Math.round(b/1024)} KB`;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> Profil Perusahaan</h1>
            <p className="text-sm text-muted-foreground">{company?.companyName ?? "—"} · Kode: {company?.companyCode ?? "—"}</p>
          </div>
          {dirty && (
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-2">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Simpan
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          <TabPill label="📋 Informasi Dasar" active={tab === "basic"} onClick={() => setTab("basic")} />
          <TabPill label="🏦 Data Perpajakan" active={tab === "pajak"} onClick={() => setTab("pajak")} />
          <TabPill label="📁 Dokumen Legal" active={tab === "dokumen"} onClick={() => setTab("dokumen")} />
        </div>

        {isLoading ? (
          <Card><CardContent className="p-8 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
        ) : (
          <>
            {/* ── TAB: Informasi Dasar ─────────────────────────── */}
            {tab === "basic" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Identitas Perusahaan</CardTitle></CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nama Perusahaan" value={form.companyName ?? ""} onChange={v => set("companyName", v)} placeholder="PT Cahaya Sejati Teknologi" />
                    <Field label="Kode Perusahaan" value={form.companyCode ?? ""} onChange={v => set("companyCode", v)} placeholder="CST" />
                    <Field label="NIB (Nomor Induk Berusaha)" value={form.nib ?? ""} onChange={v => set("nib", v)} placeholder="0000000000000" />
                    <Field label="Website" value={form.website ?? ""} onChange={v => set("website", v)} placeholder="https://example.com" />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4" /> Alamat</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Alamat Lengkap</Label>
                      <Textarea value={form.address ?? ""} onChange={e => { set("address", e.target.value); }} placeholder="Jl. Ternate No.10B/10C RT 002 RW 005, Cideng" rows={2} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Kota / Kecamatan" value={form.city ?? ""} onChange={v => set("city", v)} placeholder="Gambir, Kota Adm. Jakarta Pusat" />
                      <Field label="Provinsi" value={form.province ?? ""} onChange={v => set("province", v)} placeholder="DKI Jakarta" />
                      <Field label="Kode Pos" value={form.postalCode ?? ""} onChange={v => set("postalCode", v)} placeholder="10150" />
                      <Field label="Kode Wilayah" value={form.kodeWilayah ?? ""} onChange={v => set("kodeWilayah", v)} placeholder="3171011002" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><Phone className="h-4 w-4" /> Kontak</CardTitle></CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nomor Handphone / Telepon" value={form.phone ?? ""} onChange={v => set("phone", v)} placeholder="087808785098" />
                    <Field label="Fax" value={form.fax ?? ""} onChange={v => set("fax", v)} placeholder="021-xxxxxxx" />
                    <Field label="Email" type="email" value={form.email ?? ""} onChange={v => set("email", v)} placeholder="info@perusahaan.com" className="sm:col-span-2" />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── TAB: Data Perpajakan ─────────────────────────── */}
            {tab === "pajak" && (
              <div className="space-y-4">
                {/* AI OCR Scan Card */}
                <Card className="border-2 border-dashed border-primary/40 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="rounded-full bg-primary/10 p-2.5 shrink-0">
                          <Sparkles className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Import Otomatis dari Dokumen Pajak</p>
                          <p className="text-xs text-muted-foreground">Upload screenshot kartu NPWP atau halaman profil DJP — AI akan mengisi semua field secara otomatis</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          ref={scanInputRef}
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/webp"
                          className="hidden"
                          onChange={handleScanNpwp}
                        />
                        <Button
                          onClick={() => scanInputRef.current?.click()}
                          disabled={scanning}
                          className="gap-2 bg-primary"
                        >
                          {scanning ? (
                            <><Loader2 className="h-4 w-4 animate-spin" />Memproses AI...</>
                          ) : (
                            <><ScanLine className="h-4 w-4" />Scan dengan AI</>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Scan Preview Result */}
                    {scanPreview && (
                      <div className="mt-4 rounded-lg border border-green-400/50 bg-green-50/60 dark:bg-green-950/20 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                          <p className="text-sm font-medium text-green-800 dark:text-green-300">
                            OCR selesai — confidence {scanPreview.confidence ?? "?"}%
                          </p>
                          <button
                            type="button"
                            onClick={() => setScanPreview(null)}
                            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                          >
                            Tutup
                          </button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                          {[
                            ["NPWP", scanPreview.npwp],
                            ["Status NPWP", scanPreview.npwp_status],
                            ["NIB", scanPreview.nib],
                            ["Kegiatan Utama", scanPreview.kegiatan_utama],
                            ["Jenis WP", scanPreview.jenis_wajib_pajak],
                            ["Bentuk Hukum", scanPreview.bentuk_badan_hukum],
                            ["Tgl Terdaftar", scanPreview.tanggal_terdaftar],
                            ["Tgl Aktivasi", scanPreview.tanggal_aktivasi],
                            ["Tgl PKP", scanPreview.tanggal_pkp],
                            ["Kanwil DJP", scanPreview.kanwil_djp],
                            ["KPP", scanPreview.kpp_terdaftar],
                            ["Kode KLU", scanPreview.kode_klu],
                          ].filter(([, v]) => v != null && String(v).trim() !== "").map(([label, val]) => (
                            <div key={label as string}>
                              <span className="text-muted-foreground">{label}: </span>
                              <span className="font-medium">{String(val)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-start gap-1.5 pt-1">
                          <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          <p className="text-xs text-muted-foreground">Data di atas sudah diisi ke form. Periksa kembali lalu klik <strong>Simpan Data Perpajakan</strong>.</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* NPWP Banner */}
                <Card className={cn("border-2", form.npwpStatus === "Aktif" ? "border-green-400/60 bg-green-50/50 dark:bg-green-950/20" : "border-border")}>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={cn("rounded-full p-2", form.npwpStatus === "Aktif" ? "bg-green-100 dark:bg-green-900" : "bg-muted")}>
                        {form.npwpStatus === "Aktif" ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertCircle className="h-5 w-5 text-muted-foreground" />}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">NPWP {form.npwp || "—"}</p>
                        <p className="text-xs text-muted-foreground">Status: {form.npwpStatus || "Belum diisi"}</p>
                      </div>
                    </div>
                    {form.npwpStatus === "Aktif" && <Badge className="bg-green-500 hover:bg-green-500 text-white">Aktif</Badge>}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Data NPWP</CardTitle></CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <Field label="NPWP" value={form.npwp ?? ""} onChange={v => set("npwp", v)} placeholder="085009274303900" />
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Status NPWP</Label>
                      <select value={form.npwpStatus ?? ""} onChange={e => set("npwpStatus", e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                        <option value="">— pilih —</option>
                        <option value="Aktif">Aktif</option>
                        <option value="Non-Aktif">Non-Aktif</option>
                      </select>
                    </div>
                    <Field label="Kegiatan Utama" value={form.kegiatanUtama ?? ""} onChange={v => set("kegiatanUtama", v)} placeholder="PERDAGANGAN BESAR PIRANTI LUNAK" className="sm:col-span-2" />
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Jenis Wajib Pajak</Label>
                      <select value={form.jenisWajibPajak ?? ""} onChange={e => set("jenisWajibPajak", e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                        <option value="">— pilih —</option>
                        <option value="Badan">Badan</option>
                        <option value="Orang Pribadi">Orang Pribadi</option>
                        <option value="Bendahara">Bendahara</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Bentuk Badan Hukum</Label>
                      <select value={form.bentukBadanHukum ?? ""} onChange={e => set("bentukBadanHukum", e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                        <option value="">— pilih —</option>
                        <option value="Perseroan Terbatas (PT)">Perseroan Terbatas (PT)</option>
                        <option value="CV (Commanditaire Vennootschap)">CV (Commanditaire Vennootschap)</option>
                        <option value="Firma">Firma</option>
                        <option value="Koperasi">Koperasi</option>
                        <option value="Yayasan">Yayasan</option>
                        <option value="Perusahaan Perseorangan">Perusahaan Perseorangan</option>
                        <option value="Lainnya">Lainnya</option>
                      </select>
                    </div>
                    <Field label="Tanggal Terdaftar" value={form.tanggalTerdaftar ?? ""} onChange={v => set("tanggalTerdaftar", v)} placeholder="30 Mei 2018" />
                    <Field label="Tanggal Aktivasi" value={form.tanggalAktivasi ?? ""} onChange={v => set("tanggalAktivasi", v)} placeholder="30 Mei 2018" />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">PKP (Pengusaha Kena Pajak)</CardTitle></CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Status PKP</Label>
                      <div className="flex items-center gap-3 h-9">
                        <button type="button" onClick={() => set("statusPkp", !form.statusPkp)}
                          className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                            form.statusPkp ? "bg-green-500" : "bg-muted-foreground/30")}>
                          <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform",
                            form.statusPkp ? "translate-x-4" : "translate-x-0.5")} />
                        </button>
                        <span className="text-sm">{form.statusPkp ? "PKP Aktif" : "Non-PKP"}</span>
                      </div>
                    </div>
                    <Field label="Tanggal Pengukuhan PKP" value={form.tanggalPkp ?? ""} onChange={v => set("tanggalPkp", v)} placeholder="05 Februari 2025" />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">Kantor Pajak & KLU</CardTitle></CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <Field label="Kantor Wilayah DJP" value={form.kanwilDjp ?? ""} onChange={v => set("kanwilDjp", v)} placeholder="Kantor Wilayah DJP Jakarta Pusat" className="sm:col-span-2" />
                    <Field label="Kantor Pelayanan Pajak (KPP)" value={form.kppTerdaftar ?? ""} onChange={v => set("kppTerdaftar", v)} placeholder="KPP Pratama Jakarta Gambir Dua" className="sm:col-span-2" />
                    <Field label="Seksi Pengawasan" value={form.seksiPengawasan ?? ""} onChange={v => set("seksiPengawasan", v)} placeholder="Seksi Pengawasan IV" />
                    <Field label="Tanggal Pembaruan Profil Terakhir" value={form.tanggalPembaruanProfil ?? ""} onChange={v => set("tanggalPembaruanProfil", v)} placeholder="03 Juni 2026" />
                    <Field label="Kode KLU (Klasifikasi Lapangan Usaha)" value={form.kodeKlu ?? ""} onChange={v => set("kodeKlu", v)} placeholder="46512" />
                    <Field label="Deskripsi KLU" value={form.deskripsiKlu ?? ""} onChange={v => set("deskripsiKlu", v)} placeholder="Perdagangan Besar Piranti Lunak Komputer" />
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty} className="gap-2">
                    {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Simpan Data Perpajakan
                  </Button>
                </div>
              </div>
            )}

            {/* ── TAB: Dokumen Legal ───────────────────────────── */}
            {tab === "dokumen" && (
              <div className="space-y-4">
                {/* Upload form */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2"><FilePlus className="h-4 w-4" /> Upload Dokumen Legal</CardTitle>
                    <CardDescription>Akta Pendirian, Akta Perubahan, SK Kemenkumham, NIB, dan dokumen legalitas lainnya</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Jenis Dokumen</Label>
                        <select value={newDoc.docType} onChange={e => setNewDoc(p => ({ ...p, docType: e.target.value }))}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                          {ALL_DOC_TYPES.map(t => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Nama Dokumen</Label>
                        <Input value={newDoc.docName} onChange={e => setNewDoc(p => ({ ...p, docName: e.target.value }))} placeholder="cth: Akta No. 5 / 2018" className="h-9" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Catatan (opsional)</Label>
                        <Input value={newDoc.notes} onChange={e => setNewDoc(p => ({ ...p, notes: e.target.value }))} placeholder="Notaris, tanggal, dll" className="h-9" />
                      </div>
                    </div>
                    <div>
                      <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden" onChange={handleUploadDoc} />
                      <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploadingDoc || !newDoc.docName.trim()} className="gap-2">
                        {uploadingDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {uploadingDoc ? "Mengunggah..." : "Pilih File & Upload"}
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1.5">Format: PDF, JPG, PNG, DOC, DOCX · Maks. 20MB</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Document list */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Dokumen Tersimpan
                      <Badge variant="secondary" className="ml-1">{docs.length}</Badge>
                      {docs.length > 0 && (
                        <Button variant="outline" size="sm" className="ml-auto gap-1.5 h-7 text-xs"
                          onClick={handleDownloadZip} disabled={downloadingZip}>
                          {downloadingZip ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderDown className="h-3.5 w-3.5" />}
                          {downloadingZip ? "Menyiapkan..." : "Download Semua (ZIP)"}
                        </Button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {docs.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Belum ada dokumen yang diunggah</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* Group by docType */}
                        {ALL_DOC_TYPES.filter(t => docs.some(d => d.docType === t)).map(docType => (
                          <div key={docType} className="space-y-1.5">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-3 first:mt-0">
                              {DOC_TYPE_LABELS[docType]}
                            </p>
                            {docs.filter(d => d.docType === docType).map(doc => (
                              <div key={doc.id} className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{doc.docName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {fmtSize(doc.fileSize)}
                                    {doc.notes && ` · ${doc.notes}`}
                                    {" · "}{new Date(doc.createdAt).toLocaleDateString("id-ID")}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <a href={`/api/storage/objects/${encodeURIComponent(doc.fileUrl)}`} target="_blank" rel="noopener noreferrer">
                                    <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="h-3.5 w-3.5" /></Button>
                                  </a>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={() => deleteDoc.mutate(doc.id)} disabled={deleteDoc.isPending}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
