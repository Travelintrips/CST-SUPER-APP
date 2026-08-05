import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { isAuthenticated, removeAuthToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  User, Building2, Car, Briefcase, Upload, CheckCircle2,
  AlertCircle, Loader2, Eye, ArrowLeft, ArrowRight, LogOut,
  FileText, Camera,
} from "lucide-react";

type AccountType = "customer" | "vendor" | "driver" | "employee";
type Step = "basic" | "account-type" | "type-specific" | "review";

const STEPS: Step[] = ["basic", "account-type", "type-specific", "review"];

const ACCOUNT_TYPES: { value: AccountType; label: string; desc: string; icon: typeof User }[] = [
  { value: "customer",  label: "Customer",  desc: "Saya ingin memesan layanan logistik & pengiriman",  icon: User },
  { value: "vendor",    label: "Vendor",    desc: "Saya adalah penyedia layanan/mitra bisnis",          icon: Building2 },
  { value: "driver",    label: "Driver",    desc: "Saya adalah pengemudi/kurir mitra pengiriman",       icon: Car },
  { value: "employee",  label: "Karyawan",  desc: "Saya adalah karyawan perusahaan",                   icon: Briefcase },
];

const baseSchema = z.object({
  fullName: z.string().min(3, "Nama minimal 3 karakter"),
  phone:    z.string().min(9, "Nomor HP minimal 9 digit"),
  address:  z.string().min(10, "Alamat minimal 10 karakter"),
});

type BaseForm = z.infer<typeof baseSchema>;

const vendorSchema = z.object({
  companyName: z.string().min(2, "Nama perusahaan wajib diisi"),
  nib:         z.string().optional(),
  npwp:        z.string().optional(),
  serviceType: z.string().min(2, "Jenis layanan wajib diisi"),
});

type VendorForm = z.infer<typeof vendorSchema>;

const driverSchema = z.object({
  licenseNumber: z.string().min(5, "Nomor SIM wajib diisi"),
  vehicleType:   z.string().min(2, "Jenis kendaraan wajib diisi"),
  plateNumber:   z.string().min(4, "Nomor plat wajib diisi"),
});

type DriverForm = z.infer<typeof driverSchema>;

const employeeSchema = z.object({
  companyName: z.string().min(2, "Nama perusahaan wajib diisi"),
  branch:      z.string().optional(),
  department:  z.string().optional(),
  division:    z.string().optional(),
  position:    z.string().min(2, "Jabatan wajib diisi"),
});

type EmployeeForm = z.infer<typeof employeeSchema>;

interface OcrData {
  nik?: string;
  name?: string;
  birthPlace?: string;
  birthDate?: string;
  address?: string;
  gender?: string;
  religion?: string;
  maritalStatus?: string;
  occupation?: string;
}

function StepIndicator({ current }: { current: Step }) {
  const stepConfig = [
    { id: "basic",        label: "Info Dasar" },
    { id: "account-type", label: "Tipe Akun" },
    { id: "type-specific",label: "Detail" },
    { id: "review",       label: "Konfirmasi" },
  ];
  const idx = STEPS.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {stepConfig.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
              i < idx ? "bg-primary text-white" :
              i === idx ? "bg-primary text-white ring-4 ring-primary/20" :
              "bg-gray-100 text-gray-400"
            }`}>
              {i < idx ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-xs mt-1 font-medium hidden sm:block ${i === idx ? "text-primary" : "text-muted-foreground"}`}>
              {s.label}
            </span>
          </div>
          {i < stepConfig.length - 1 && (
            <div className={`w-12 h-0.5 mx-1 mb-5 ${i < idx ? "bg-primary" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const authed = isAuthenticated();

  const [step, setStep]             = useState<Step>("basic");
  const [accountType, setAccountType] = useState<AccountType>("customer");
  const [baseData, setBaseData]     = useState<BaseForm | null>(null);
  const [vendorData, setVendorData] = useState<VendorForm | null>(null);
  const [driverData, setDriverData] = useState<DriverForm | null>(null);
  const [employeeData, setEmployeeData] = useState<EmployeeForm | null>(null);

  const [ktpFile, setKtpFile]       = useState<File | null>(null);
  const [ktpPreview, setKtpPreview] = useState<string | null>(null);
  const [ktpUrl, setKtpUrl]         = useState<string | null>(null);
  const [ocrData, setOcrData]       = useState<OcrData | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError]     = useState<string | null>(null);

  const [legalityFile, setLegalityFile] = useState<File | null>(null);
  const [legalityUrl, setLegalityUrl]   = useState<string | null>(null);
  const [simFile, setSimFile]     = useState<File | null>(null);
  const [simUrl, setSimUrl]       = useState<string | null>(null);
  const [stnkFile, setStnkFile]   = useState<File | null>(null);
  const [stnkUrl, setStnkUrl]     = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const ktpInputRef     = useRef<HTMLInputElement>(null);
  const legalityInputRef = useRef<HTMLInputElement>(null);
  const simInputRef     = useRef<HTMLInputElement>(null);
  const stnkInputRef    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authed) { setLocation("/login"); return; }
    // Check if already completed
    fetch("/api/portal/onboarding/status", { credentials: "include" })
      .then(r => r.json())
      .then((d: { status: string; accountType?: string }) => {
        if (d.status === "active") {
          if (d.accountType === "vendor") setLocation("/vendor-dashboard");
          else setLocation("/dashboard");
        } else if (d.status === "pending") {
          setLocation("/pending-approval");
        }
        // If existing profile data, pre-fill
      })
      .catch(() => {/* ignore */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, setLocation]);

  // ── Base form ───────────────────────────────────────────────────────────────
  const baseForm = useForm<BaseForm>({
    resolver: zodResolver(baseSchema),
    defaultValues: { fullName: "", phone: "", address: "" },
  });

  // ── Vendor form ─────────────────────────────────────────────────────────────
  const vendorForm = useForm<VendorForm>({
    resolver: zodResolver(vendorSchema),
    defaultValues: { companyName: "", nib: "", npwp: "", serviceType: "" },
  });

  // ── Driver form ─────────────────────────────────────────────────────────────
  const driverForm = useForm<DriverForm>({
    resolver: zodResolver(driverSchema),
    defaultValues: { licenseNumber: "", vehicleType: "", plateNumber: "" },
  });

  // ── Employee form ───────────────────────────────────────────────────────────
  const employeeForm = useForm<EmployeeForm>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { companyName: "", branch: "", department: "", division: "", position: "" },
  });

  // ── KTP upload + OCR ────────────────────────────────────────────────────────
  async function handleKtpChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setKtpFile(file);
    setKtpUrl(null);
    setOcrData(null);
    setOcrError(null);
    const reader = new FileReader();
    reader.onload = (ev) => setKtpPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    await runOcr(file);
  }

  async function runOcr(file: File) {
    setOcrLoading(true);
    setOcrError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/portal/onboarding/ktp-ocr", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { ok?: boolean; data?: OcrData; error?: string };
      if (!res.ok || !json.ok) {
        setOcrError(json.error ?? "OCR gagal. Coba upload ulang.");
      } else {
        setOcrData(json.data ?? null);
        // Auto-fill form fields if empty
        if (json.data?.name && !baseForm.getValues("fullName")) {
          baseForm.setValue("fullName", json.data.name);
        }
        if (json.data?.address && !baseForm.getValues("address")) {
          baseForm.setValue("address", json.data.address);
        }
      }
    } catch {
      setOcrError("Gagal menghubungi server OCR.");
    } finally {
      setOcrLoading(false);
    }
  }

  async function uploadFile(file: File, docType: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("docType", docType);
    try {
      const res = await fetch("/api/portal/onboarding/upload-doc", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json() as { url?: string; error?: string };
      return json.url ?? null;
    } catch { return null; }
  }

  // ── Step navigation ──────────────────────────────────────────────────────────
  async function handleBaseNext(data: BaseForm) {
    setBaseData(data);
    setStep("account-type");
  }

  function handleAccountTypeNext() {
    if (accountType === "customer") {
      setStep("review");
    } else {
      setStep("type-specific");
    }
  }

  async function handleTypeSpecificNext() {
    if (accountType === "vendor") {
      const valid = await vendorForm.trigger();
      if (!valid) return;
      setVendorData(vendorForm.getValues());
    } else if (accountType === "driver") {
      const valid = await driverForm.trigger();
      if (!valid) return;
      setDriverData(driverForm.getValues());
    } else if (accountType === "employee") {
      const valid = await employeeForm.trigger();
      if (!valid) return;
      setEmployeeData(employeeForm.getValues());
    }
    setStep("review");
  }

  function goBack() {
    if (step === "account-type") setStep("basic");
    else if (step === "type-specific") setStep("account-type");
    else if (step === "review") {
      setStep(accountType === "customer" ? "account-type" : "type-specific");
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Upload KTP if selected
      let finalKtpUrl = ktpUrl;
      if (ktpFile && !ktpUrl) {
        finalKtpUrl = await uploadFile(ktpFile, "ktp");
        if (finalKtpUrl) setKtpUrl(finalKtpUrl);
      }

      // Upload type-specific docs
      let finalLegalityUrl = legalityUrl;
      let finalSimUrl = simUrl;
      let finalStnkUrl = stnkUrl;
      if (legalityFile && !legalityUrl) {
        finalLegalityUrl = await uploadFile(legalityFile, "legalitas");
        if (finalLegalityUrl) setLegalityUrl(finalLegalityUrl);
      }
      if (simFile && !simUrl) {
        finalSimUrl = await uploadFile(simFile, "sim");
        if (finalSimUrl) setSimUrl(finalSimUrl);
      }
      if (stnkFile && !stnkUrl) {
        finalStnkUrl = await uploadFile(stnkFile, "stnk");
        if (finalStnkUrl) setStnkUrl(finalStnkUrl);
      }

      const payload = {
        ...baseData,
        accountType,
        ktpUrl: finalKtpUrl,
        ocrData,
        vendor:   accountType === "vendor"   ? { ...vendorData, legalityDocUrl: finalLegalityUrl } : undefined,
        driver:   accountType === "driver"   ? { ...driverData, simUrl: finalSimUrl, stnkUrl: finalStnkUrl } : undefined,
        employee: accountType === "employee" ? employeeData : undefined,
      };

      const res = await fetch("/api/portal/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const json = await res.json() as { ok?: boolean; status?: string; error?: string };
      if (!res.ok || !json.ok) {
        setSubmitError(json.error ?? "Gagal menyimpan profil.");
        return;
      }
      if (json.status === "pending") {
        setLocation("/pending-approval");
      } else {
        setLocation("/dashboard");
      }
    } catch {
      setSubmitError("Gagal menghubungi server.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!authed) return null;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex mb-4" style={{ background: "rgba(255,255,255,0.95)", borderRadius: "14px", padding: "10px 14px", boxShadow: "0 4px 16px rgba(15,23,42,0.10)" }}>
            <img src="/api/storage/public-objects/portal/images/logo.png" alt="Logo" className="h-8 w-auto object-contain" onError={(e) => { const el = e.currentTarget; const fb = el.src.replace("/api/storage/public-objects/portal/images/", "/images/"); if (el.src !== fb) el.src = fb; }} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Lengkapi Profil Anda</h1>
          <p className="text-muted-foreground text-sm mt-1">Isi data berikut untuk mengaktifkan akun Anda</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <StepIndicator current={step} />

          {/* ── STEP 1: Basic Info ── */}
          {step === "basic" && (
            <form onSubmit={baseForm.handleSubmit(handleBaseNext)} className="space-y-5">
              <h2 className="text-lg font-semibold mb-4">Informasi Dasar</h2>

              <div className="space-y-2">
                <Label>Nama Lengkap <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="Sesuai KTP"
                  {...baseForm.register("fullName")}
                />
                {baseForm.formState.errors.fullName && (
                  <p className="text-sm text-red-500">{baseForm.formState.errors.fullName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Nomor HP / WhatsApp <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="08xxxxxxxxxx"
                  type="tel"
                  {...baseForm.register("phone")}
                />
                {baseForm.formState.errors.phone && (
                  <p className="text-sm text-red-500">{baseForm.formState.errors.phone.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Alamat Lengkap <span className="text-red-500">*</span></Label>
                <Textarea
                  placeholder="Jl. Contoh No. 123, Kelurahan, Kecamatan, Kota/Kabupaten"
                  rows={3}
                  {...baseForm.register("address")}
                />
                {baseForm.formState.errors.address && (
                  <p className="text-sm text-red-500">{baseForm.formState.errors.address.message}</p>
                )}
              </div>

              {/* KTP Upload + OCR */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Camera className="h-4 w-4" />
                  Upload KTP (Opsional, untuk OCR otomatis)
                </Label>
                <div
                  className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  onClick={() => ktpInputRef.current?.click()}
                >
                  {ktpPreview ? (
                    <img src={ktpPreview} alt="KTP" className="max-h-32 mx-auto rounded-lg object-contain" />
                  ) : (
                    <div className="space-y-2">
                      <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                      <p className="text-sm text-muted-foreground">Klik untuk upload foto KTP</p>
                      <p className="text-xs text-muted-foreground">JPG, PNG, maks. 10MB</p>
                    </div>
                  )}
                </div>
                <input
                  ref={ktpInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleKtpChange}
                />

                {ocrLoading && (
                  <Alert className="border-blue-200 bg-blue-50">
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    <AlertDescription className="text-blue-800">
                      Sedang membaca data KTP...
                    </AlertDescription>
                  </Alert>
                )}

                {ocrError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{ocrError}</AlertDescription>
                  </Alert>
                )}

                {ocrData && !ocrLoading && (
                  <div className="rounded-xl bg-green-50 border border-green-200 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-green-700 font-medium text-sm mb-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Data KTP berhasil dibaca — silakan periksa dan edit jika perlu
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                      {ocrData.nik     && <><span className="text-muted-foreground">NIK</span><span className="font-mono font-medium">{ocrData.nik}</span></>}
                      {ocrData.name    && <><span className="text-muted-foreground">Nama</span><span>{ocrData.name}</span></>}
                      {ocrData.birthDate && <><span className="text-muted-foreground">Tgl Lahir</span><span>{ocrData.birthDate}</span></>}
                      {ocrData.gender  && <><span className="text-muted-foreground">JK</span><span>{ocrData.gender}</span></>}
                      {ocrData.address && <><span className="text-muted-foreground col-span-2">Alamat KTP</span><span className="col-span-2 text-xs">{ocrData.address}</span></>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Data di atas otomatis mengisi form. Anda bisa edit secara manual.</p>
                  </div>
                )}
              </div>

              <Button type="submit" className="w-full gap-2">
                Lanjut <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}

          {/* ── STEP 2: Account Type ── */}
          {step === "account-type" && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold mb-4">Pilih Tipe Akun</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ACCOUNT_TYPES.map(({ value, label, desc, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAccountType(value)}
                    className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                      accountType === value
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <div className={`mt-0.5 p-2 rounded-lg ${accountType === value ? "bg-primary text-white" : "bg-gray-100 text-gray-500"}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                      {value !== "customer" && (
                        <Badge variant="secondary" className="mt-1 text-xs">Perlu persetujuan admin</Badge>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={goBack}>
                  <ArrowLeft className="h-4 w-4" /> Kembali
                </Button>
                <Button className="flex-1 gap-2" onClick={handleAccountTypeNext}>
                  Lanjut <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Type-Specific ── */}
          {step === "type-specific" && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold mb-4">
                {accountType === "vendor"   && "Detail Vendor"}
                {accountType === "driver"   && "Detail Driver"}
                {accountType === "employee" && "Detail Karyawan"}
              </h2>

              {/* VENDOR */}
              {accountType === "vendor" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nama Perusahaan <span className="text-red-500">*</span></Label>
                    <Input placeholder="PT / CV / UD ..." {...vendorForm.register("companyName")} />
                    {vendorForm.formState.errors.companyName && <p className="text-sm text-red-500">{vendorForm.formState.errors.companyName.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>NIB (Opsional)</Label>
                      <Input placeholder="Nomor Induk Berusaha" {...vendorForm.register("nib")} />
                    </div>
                    <div className="space-y-2">
                      <Label>NPWP (Opsional)</Label>
                      <Input placeholder="XX.XXX.XXX.X-XXX.XXX" {...vendorForm.register("npwp")} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Jenis Layanan Vendor <span className="text-red-500">*</span></Label>
                    <Input placeholder="contoh: Trucking, Forwarding, Warehouse, dll." {...vendorForm.register("serviceType")} />
                    {vendorForm.formState.errors.serviceType && <p className="text-sm text-red-500">{vendorForm.formState.errors.serviceType.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><FileText className="h-4 w-4" />Upload Dokumen Legalitas (Opsional)</Label>
                    <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                      onClick={() => legalityInputRef.current?.click()}>
                      {legalityFile ? (
                        <div className="flex items-center justify-center gap-2 text-sm text-green-700">
                          <CheckCircle2 className="h-4 w-4" />
                          {legalityFile.name}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <Upload className="h-6 w-6 text-muted-foreground mx-auto" />
                          <p className="text-sm text-muted-foreground">NIB, Akta Perusahaan, dll.</p>
                        </div>
                      )}
                    </div>
                    <input ref={legalityInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => setLegalityFile(e.target.files?.[0] ?? null)} />
                  </div>
                </div>
              )}

              {/* DRIVER */}
              {accountType === "driver" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nomor SIM <span className="text-red-500">*</span></Label>
                    <Input placeholder="Nomor SIM sesuai kartu" {...driverForm.register("licenseNumber")} />
                    {driverForm.formState.errors.licenseNumber && <p className="text-sm text-red-500">{driverForm.formState.errors.licenseNumber.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Jenis Kendaraan <span className="text-red-500">*</span></Label>
                      <Input placeholder="Motor / Mobil / Truk / dll." {...driverForm.register("vehicleType")} />
                      {driverForm.formState.errors.vehicleType && <p className="text-sm text-red-500">{driverForm.formState.errors.vehicleType.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label>Nomor Plat <span className="text-red-500">*</span></Label>
                      <Input placeholder="B 1234 ABC" {...driverForm.register("plateNumber")} />
                      {driverForm.formState.errors.plateNumber && <p className="text-sm text-red-500">{driverForm.formState.errors.plateNumber.message}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />Upload SIM</Label>
                      <div className="border-2 border-dashed border-gray-200 rounded-xl p-3 text-center cursor-pointer hover:border-primary/50 transition-colors" onClick={() => simInputRef.current?.click()}>
                        {simFile ? <p className="text-xs text-green-700 flex items-center justify-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />{simFile.name.slice(0, 16)}</p>
                          : <><Upload className="h-5 w-5 text-muted-foreground mx-auto mb-1" /><p className="text-xs text-muted-foreground">Upload SIM</p></>}
                      </div>
                      <input ref={simInputRef} type="file" accept="image/*" className="hidden" onChange={e => setSimFile(e.target.files?.[0] ?? null)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />Upload STNK</Label>
                      <div className="border-2 border-dashed border-gray-200 rounded-xl p-3 text-center cursor-pointer hover:border-primary/50 transition-colors" onClick={() => stnkInputRef.current?.click()}>
                        {stnkFile ? <p className="text-xs text-green-700 flex items-center justify-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />{stnkFile.name.slice(0, 16)}</p>
                          : <><Upload className="h-5 w-5 text-muted-foreground mx-auto mb-1" /><p className="text-xs text-muted-foreground">Upload STNK</p></>}
                      </div>
                      <input ref={stnkInputRef} type="file" accept="image/*" className="hidden" onChange={e => setStnkFile(e.target.files?.[0] ?? null)} />
                    </div>
                  </div>
                </div>
              )}

              {/* EMPLOYEE */}
              {accountType === "employee" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nama Perusahaan <span className="text-red-500">*</span></Label>
                    <Input placeholder="Nama perusahaan tempat bekerja" {...employeeForm.register("companyName")} />
                    {employeeForm.formState.errors.companyName && <p className="text-sm text-red-500">{employeeForm.formState.errors.companyName.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Cabang (Opsional)</Label>
                      <Input placeholder="Nama cabang" {...employeeForm.register("branch")} />
                    </div>
                    <div className="space-y-2">
                      <Label>Departemen (Opsional)</Label>
                      <Input placeholder="Nama departemen" {...employeeForm.register("department")} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Divisi (Opsional)</Label>
                      <Input placeholder="Nama divisi" {...employeeForm.register("division")} />
                    </div>
                    <div className="space-y-2">
                      <Label>Jabatan <span className="text-red-500">*</span></Label>
                      <Input placeholder="Jabatan / Posisi" {...employeeForm.register("position")} />
                      {employeeForm.formState.errors.position && <p className="text-sm text-red-500">{employeeForm.formState.errors.position.message}</p>}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={goBack}>
                  <ArrowLeft className="h-4 w-4" /> Kembali
                </Button>
                <Button className="flex-1 gap-2" onClick={handleTypeSpecificNext}>
                  Lanjut <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Review ── */}
          {step === "review" && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold mb-4">Konfirmasi Data</h2>

              {submitError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              )}

              <div className="rounded-xl border border-gray-100 bg-gray-50 divide-y divide-gray-100 text-sm">
                <div className="px-4 py-3 font-semibold text-xs uppercase text-muted-foreground tracking-wide">Informasi Dasar</div>
                <Row label="Nama Lengkap" value={baseData?.fullName} />
                <Row label="Nomor HP" value={baseData?.phone} />
                <Row label="Alamat" value={baseData?.address} />
                <Row label="KTP" value={ktpFile ? `✅ ${ktpFile.name}` : "Tidak diupload"} />
                {ocrData?.nik && <Row label="NIK (OCR)" value={ocrData.nik} />}

                <div className="px-4 py-3 font-semibold text-xs uppercase text-muted-foreground tracking-wide">Tipe Akun</div>
                <Row label="Tipe" value={ACCOUNT_TYPES.find(a => a.value === accountType)?.label ?? accountType} />

                {accountType === "vendor" && vendorData && <>
                  <div className="px-4 py-3 font-semibold text-xs uppercase text-muted-foreground tracking-wide">Data Vendor</div>
                  <Row label="Perusahaan" value={vendorData.companyName} />
                  <Row label="NIB" value={vendorData.nib || "-"} />
                  <Row label="NPWP" value={vendorData.npwp || "-"} />
                  <Row label="Jenis Layanan" value={vendorData.serviceType} />
                  <Row label="Dok. Legalitas" value={legalityFile ? `✅ ${legalityFile.name}` : "Tidak diupload"} />
                </>}

                {accountType === "driver" && driverData && <>
                  <div className="px-4 py-3 font-semibold text-xs uppercase text-muted-foreground tracking-wide">Data Driver</div>
                  <Row label="No. SIM" value={driverData.licenseNumber} />
                  <Row label="Kendaraan" value={driverData.vehicleType} />
                  <Row label="Plat" value={driverData.plateNumber} />
                  <Row label="SIM" value={simFile ? `✅ ${simFile.name}` : "Tidak diupload"} />
                  <Row label="STNK" value={stnkFile ? `✅ ${stnkFile.name}` : "Tidak diupload"} />
                </>}

                {accountType === "employee" && employeeData && <>
                  <div className="px-4 py-3 font-semibold text-xs uppercase text-muted-foreground tracking-wide">Data Karyawan</div>
                  <Row label="Perusahaan" value={employeeData.companyName} />
                  <Row label="Jabatan" value={employeeData.position} />
                  {employeeData.branch     && <Row label="Cabang" value={employeeData.branch} />}
                  {employeeData.department && <Row label="Departemen" value={employeeData.department} />}
                  {employeeData.division   && <Row label="Divisi" value={employeeData.division} />}
                </>}
              </div>

              {accountType !== "customer" && (
                <Alert className="border-amber-200 bg-amber-50">
                  <Eye className="h-4 w-4 text-amber-500" />
                  <AlertDescription className="text-amber-800">
                    Akun <strong>{ACCOUNT_TYPES.find(a => a.value === accountType)?.label}</strong> akan masuk status <strong>Pending Review</strong> dan perlu persetujuan admin sebelum bisa digunakan.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={goBack} disabled={submitting}>
                  <ArrowLeft className="h-4 w-4" /> Kembali
                </Button>
                <Button className="flex-1 gap-2" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan...</> : <><CheckCircle2 className="h-4 w-4" />Simpan & Lanjut</>}
                </Button>
              </div>

              <button
                type="button"
                className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 mt-2"
                onClick={() => { removeAuthToken(); setLocation("/login"); }}
              >
                <LogOut className="h-3 w-3" /> Keluar dari akun ini
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="px-4 py-2.5 flex justify-between gap-4">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className="font-medium text-right">{value || "-"}</span>
    </div>
  );
}
