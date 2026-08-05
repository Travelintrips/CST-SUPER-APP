import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useListPortalServices } from "@workspace/api-client-react";
import { setPortalProfile, saveTrustedDevice, REMEMBER_DAYS } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, ArrowLeft, Check, MessageCircle, Phone, Shield, Truck, User } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLanguage } from "@/i18n/LanguageContext";

type UserRole = "customer" | "vendor";
type Step = "phone" | "otp" | "profile";

interface SimpleItem {
  id: number;
  name: string;
  itemType: "jasa" | "barang";
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Register() {
  const { t } = useLanguage();
  const [, setLocation] = useLocation();
  const returnTo = new URLSearchParams(window.location.search).get("returnTo");
  const phoneFromUrl = new URLSearchParams(window.location.search).get("phone") ?? "";
  const [step, setStep] = useState<Step>("phone");
  const [errorMsg, setErrorMsg] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [phone, setPhone] = useState(phoneFromUrl);
  const [normalizedPhone, setNormalizedPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  const [role, setRole] = useState<UserRole>("customer");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [serviceIds, setServiceIds] = useState<number[]>([]);
  const [products, setProducts] = useState<SimpleItem[]>([]);
  const [rememberDevice, setRememberDevice] = useState(true);

  const otpInputRef = useRef<HTMLInputElement>(null);

  const { data: servicesData } = useListPortalServices({ query: { queryKey: ["listPortalServices"] } });
  const services: SimpleItem[] = (Array.isArray(servicesData) ? servicesData : []).map((s) => ({
    id: s.id, name: s.name, itemType: "jasa" as const,
  }));

  useEffect(() => {
    fetch(`${BASE}/api/portal/products`)
      .then((r) => { if (!r.ok) throw new Error("failed"); return r.json(); })
      .then((data) => setProducts(Array.isArray(data) ? data.map((p: any) => ({ id: p.id, name: p.name, itemType: "barang" as const })) : []))
      .catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "otp") setTimeout(() => otpInputRef.current?.focus(), 100);
  }, [step]);

  const allItems = [...services, ...products];

  const sendOtp = async () => {
    setErrorMsg("");
    if (!phone || phone.replace(/\D/g, "").length < 9) {
      setErrorMsg(t("registerPage.errorInvalidPhone"));
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/portal/auth/wa-otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.message ?? t("registerPage.errorOtpSendFailed"));
        setIsLoading(false);
        return;
      }
      setNormalizedPhone(json.phone);
      setStep("otp");
      setCooldown(60);
    } catch {
      setErrorMsg(t("registerPage.errorServerError"));
    }
    setIsLoading(false);
  };

  const verifyOtp = async () => {
    setErrorMsg("");
    if (otp.length !== 6) {
      setErrorMsg(t("registerPage.errorOtpLength"));
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/portal/auth/wa-otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizedPhone, code: otp }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.message ?? t("registerPage.errorVerifyFailed"));
        setIsLoading(false);
        return;
      }
      setVerifyToken(json.verifyToken);

      // Auto-login if phone already registered
      const loginRes = await fetch(`${BASE}/api/portal/auth/wa-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifyToken: json.verifyToken }),
      });
      const loginJson = await loginRes.json();
      if (loginRes.ok && loginJson.token) {
        setPortalProfile({ customerId: loginJson.user.id, role: loginJson.user.role, name: loginJson.user.name, email: loginJson.user.email });
        if (returnTo) setLocation(returnTo);
        else if (loginJson.user.role === "vendor") setLocation("/vendor-dashboard");
        else setLocation("/dashboard");
        return;
      }
      // Not registered → re-verify needed (token consumed by login attempt actually only on success)
      // If login returned notRegistered, token still valid (we didn't invalidate on failure path).
      setStep("profile");
    } catch {
      setErrorMsg(t("registerPage.errorServerError"));
    }
    setIsLoading(false);
  };

  const completeRegister = async () => {
    setErrorMsg("");
    if (!name.trim()) { setErrorMsg(t("registerPage.errorNameRequired")); return; }
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/portal/auth/wa-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verifyToken, name, role, company: company || null,
          email: email || null,
          // Only pass IDs that actually belong to services (jasa), not products (barang)
          serviceIds: serviceIds.filter(id => services.some(s => s.id === id)),
          rememberDays: rememberDevice ? REMEMBER_DAYS : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.token) {
        setErrorMsg(json.message ?? t("registerPage.errorRegisterFailed"));
        setIsLoading(false);
        return;
      }
      setPortalProfile({ customerId: json.user.id, role: json.user.role, name: json.user.name, email: json.user.email });
      if (rememberDevice && json.deviceToken) {
        saveTrustedDevice(json.user.phone ?? normalizedPhone, json.deviceToken);
      }
      // WA-registered users: force complete profile (KTP/alamat/dll) sebelum lanjut
      setLocation("/onboarding");
    } catch {
      setErrorMsg(t("registerPage.errorServerError"));
    }
    setIsLoading(false);
  };

  const toggleService = (id: number) => {
    setServiceIds((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  };

  const stepNumber = step === "phone" ? 1 : step === "otp" ? 2 : 3;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-none shadow-2xl">
        <CardHeader className="space-y-3 pb-6 border-b">
          <div className="flex items-center justify-between">
            <Link href="/login">
              <Button variant="ghost" size="sm" className="gap-1 -ml-2">
                <ArrowLeft className="h-4 w-4" /> {t("registerPage.backToLogin")}
              </Button>
            </Link>
            <div className="text-xs font-medium bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full">
              Langkah {stepNumber} dari 3
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500 text-white grid place-items-center">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">{t("registerPage.title")}</CardTitle>
              <CardDescription className="text-sm">
                {step === "phone" && t("registerPage.stepPhoneDesc")}
                {step === "otp" && t("registerPage.stepOtpDesc")}
                {step === "profile" && t("registerPage.stepProfileDesc")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-5">
          {returnTo && step === "phone" && (
            <Alert className="border-emerald-300 bg-emerald-50">
              <Check className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-sm">{t("registerPage.checkoutReturnMsg")}</AlertDescription>
            </Alert>
          )}
          {errorMsg && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          {step === "phone" && (
            <>
              <div className="space-y-2">
                <Label>{t("registerPage.phoneLabel")}</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="tel"
                    placeholder={t("registerPage.phonePlaceholder")}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="pl-10 h-12 text-base"
                    onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t("registerPage.otpHint")}</p>
              </div>
              <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700" onClick={sendOtp} disabled={isLoading}>
                {isLoading ? t("registerPage.sending") : t("registerPage.sendOtp")}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {t("registerPage.alreadyHaveAccount")} <Link href="/login" className="text-emerald-600 font-medium hover:underline">{t("registerPage.backToLogin")}</Link>
              </p>
            </>
          )}

          {step === "otp" && (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
                <p className="text-muted-foreground">{t("registerPage.otpSentTo")}</p>
                <p className="font-semibold text-foreground">+{normalizedPhone}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("registerPage.otpLabel")}</Label>
                <Input
                  ref={otpInputRef}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="······"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="h-14 text-center text-2xl tracking-[0.5em] font-mono"
                  onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                />
              </div>
              <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700" onClick={verifyOtp} disabled={isLoading || otp.length !== 6}>
                {isLoading ? t("registerPage.verifying") : t("registerPage.verify")}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button variant="ghost" size="sm" onClick={() => { setStep("phone"); setOtp(""); setErrorMsg(""); }}>
                  <ArrowLeft className="h-3 w-3 mr-1" /> {t("registerPage.changeNumber")}
                </Button>
                <Button variant="ghost" size="sm" onClick={sendOtp} disabled={cooldown > 0 || isLoading}>
                  {cooldown > 0 ? `${t("registerPage.resendOtp")} (${cooldown}s)` : t("registerPage.resendOtp")}
                </Button>
              </div>
            </>
          )}

          {step === "profile" && (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-600" />
                <span className="text-foreground">{t("registerPage.phoneVerified")} <strong>+{normalizedPhone}</strong></span>
              </div>

              <div className="space-y-2">
                <Label>{t("registerPage.roleLabel")}</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRole("customer")}
                    className={`p-4 rounded-lg border-2 text-left transition ${role === "customer" ? "border-emerald-500 bg-emerald-50" : "border-border"}`}
                  >
                    <User className={`h-5 w-5 mb-2 ${role === "customer" ? "text-emerald-600" : "text-muted-foreground"}`} />
                    <p className="font-semibold text-sm">{t("registerPage.roleCustomer")}</p>
                    <p className="text-xs text-muted-foreground">{t("registerPage.roleCustomerDesc")}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("vendor")}
                    className={`p-4 rounded-lg border-2 text-left transition ${role === "vendor" ? "border-emerald-500 bg-emerald-50" : "border-border"}`}
                  >
                    <Truck className={`h-5 w-5 mb-2 ${role === "vendor" ? "text-emerald-600" : "text-muted-foreground"}`} />
                    <p className="font-semibold text-sm">{t("registerPage.roleVendor")}</p>
                    <p className="text-xs text-muted-foreground">{t("registerPage.roleVendorDesc")}</p>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("registerPage.fullNameLabel")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Budi Santoso" />
              </div>

              <div className="space-y-2">
                <Label>{role === "vendor" ? "Nama Perusahaan / Armada" : "Perusahaan (opsional)"}</Label>
                <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={role === "vendor" ? "PT Mitra Logistik" : "Acme Inc."} />
              </div>

              <div className="space-y-2">
                <Label>{t("registerPage.emailLabel")}</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
              </div>

              {allItems.length > 0 && (
                <div className="space-y-2">
                  <Label>{role === "vendor" ? "Layanan yang Anda sediakan" : "Layanan yang diminati"}</Label>
                  <div className="max-h-40 overflow-y-auto border rounded-lg p-2 space-y-1">
                    {allItems.map((item) => (
                      <label key={`${item.itemType}-${item.id}`} className="flex items-center gap-2 p-2 rounded hover:bg-emerald-50 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={serviceIds.includes(item.id)}
                          onChange={() => toggleService(item.id)}
                          className="rounded border-gray-300"
                        />
                        <span>{item.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{item.itemType}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 accent-emerald-600 cursor-pointer"
                />
                <span className="text-sm text-slate-600 group-hover:text-slate-800 select-none">
                  Ingat perangkat ini selama <strong>{REMEMBER_DAYS} hari</strong>
                </span>
              </label>

              <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700" onClick={completeRegister} disabled={isLoading}>
                {isLoading ? t("registerPage.registering") : t("registerPage.completeRegistration")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
