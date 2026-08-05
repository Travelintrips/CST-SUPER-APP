import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Settings2, RefreshCw, Save, ArrowLeft, Plus, X, Bell, MessageSquare, RotateCcw, Send, CheckCircle2 } from "lucide-react";

export default function SportCenterSettings() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();

  const DEFAULT_WA_TEMPLATE =
    "Halo *{{name}}*! 👋\n\n" +
    "Kami ingin menginformasikan bahwa masa keanggotaan Anda di *{{center_name}}* akan berakhir *{{days_label}}* ({{end_date}}).\n\n" +
    "Segera perpanjang keanggotaan Anda agar tetap dapat menikmati fasilitas kami tanpa gangguan.\n\n" +
    "Untuk informasi perpanjangan, silakan hubungi kami atau kunjungi langsung Sport Center.\n\n" +
    "Terima kasih atas kepercayaan Anda! 🏆";

  const [form, setForm] = useState({
    center_name: "", address: "", phone: "",
    open_time: "06:00", close_time: "22:00",
    booking_advance_days: "30", min_booking_hours: "1", cancellation_hours: "2",
  });

  const [reminderDays, setReminderDays] = useState<number[]>([4, 1]);
  const [newDay, setNewDay] = useState("");
  const [waTemplate, setWaTemplate] = useState(DEFAULT_WA_TEMPLATE);

  const { data, isLoading } = useQuery({
    queryKey: ["sport-center-settings", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/sport-center/settings${qs}`, { credentials: "include" });
      return r.json();
    },
  });

  useEffect(() => {
    if (data) {
      setForm({
        center_name: data.center_name ?? "",
        address: data.address ?? "",
        phone: data.phone ?? "",
        open_time: data.open_time ?? "06:00",
        close_time: data.close_time ?? "22:00",
        booking_advance_days: String(data.booking_advance_days ?? 30),
        min_booking_hours: String(data.min_booking_hours ?? 1),
        cancellation_hours: String(data.cancellation_hours ?? 2),
      });
      if (data.reminder_days) {
        const parsed = String(data.reminder_days)
          .split(",")
          .map((s: string) => parseInt(s.trim(), 10))
          .filter((d: number) => !isNaN(d) && d >= 1 && d <= 90)
          .sort((a: number, b: number) => b - a);
        if (parsed.length > 0) setReminderDays(parsed);
      }
      if (data.wa_template) {
        setWaTemplate(data.wa_template);
      }
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch("/api/sport-center/settings", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Gagal");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Pengaturan disimpan" });
      qc.invalidateQueries({ queryKey: ["sport-center-settings"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const addDay = () => {
    const d = parseInt(newDay, 10);
    if (isNaN(d) || d < 1 || d > 90) {
      toast({ title: "Masukkan angka 1–90", variant: "destructive" });
      return;
    }
    if (reminderDays.includes(d)) {
      toast({ title: `${d} hari sudah ada`, variant: "destructive" });
      return;
    }
    setReminderDays((prev) => [...prev, d].sort((a, b) => b - a));
    setNewDay("");
  };

  const removeDay = (d: number) => {
    if (reminderDays.length <= 1) {
      toast({ title: "Minimal harus ada 1 hari reminder", variant: "destructive" });
      return;
    }
    setReminderDays((prev) => prev.filter((x) => x !== d));
  };

  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);

  const testWaMutation = useMutation({
    mutationFn: async () => {
      if (!testPhone.trim()) throw new Error("Nomor HP wajib diisi");
      const r = await fetch("/api/sport-center/member-reminders/test-wa", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: testPhone.trim(),
          template: waTemplate,
          center_name: form.center_name,
          days_label: `${reminderDays[0] ?? 4} hari lagi`,
          company_id: activeCompanyId ? String(activeCompanyId) : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Gagal");
      return data as { ok: boolean; message: string };
    },
    onSuccess: (data) => {
      setTestResult({ ok: true, message: data.message });
      toast({ title: "Test WA terkirim!" });
    },
    onError: (e: Error) => {
      setTestResult({ ok: false, error: e.message });
      toast({ title: e.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      company_id: activeCompanyId,
      center_name: form.center_name,
      address: form.address,
      phone: form.phone,
      open_time: form.open_time,
      close_time: form.close_time,
      booking_advance_days: Number(form.booking_advance_days),
      min_booking_hours: Number(form.min_booking_hours),
      cancellation_hours: Number(form.cancellation_hours),
      reminder_days: reminderDays.join(","),
      wa_template: waTemplate || DEFAULT_WA_TEMPLATE,
    });
  };

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-2xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/sport-center/dashboard")} className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Settings2 className="h-6 w-6 text-slate-400" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Pengaturan Sport Center</h1>
            <p className="text-sm text-muted-foreground">Konfigurasi umum operasional</p>
          </div>
        </div>

        {isLoading ? (
          <Card className="animate-pulse"><CardContent className="p-5 h-48" /></Card>
        ) : (
          <>
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Informasi Sport Center</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label className="text-xs">Nama Sport Center *</Label>
                  <Input value={form.center_name} onChange={(e) => setForm((p) => ({ ...p, center_name: e.target.value }))} placeholder="Nama sport center" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Alamat</Label>
                  <Input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} placeholder="Alamat lengkap" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">No. Telepon</Label>
                  <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="No. HP / telepon" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Jam Operasional</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Jam Buka</Label>
                    <Input type="time" value={form.open_time} onChange={(e) => setForm((p) => ({ ...p, open_time: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Jam Tutup</Label>
                    <Input type="time" value={form.close_time} onChange={(e) => setForm((p) => ({ ...p, close_time: e.target.value }))} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Aturan Booking</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Maks. Hari ke Depan</Label>
                    <Input
                      type="number" min={1} value={form.booking_advance_days}
                      onChange={(e) => setForm((p) => ({ ...p, booking_advance_days: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">Hari</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Min. Booking</Label>
                    <Input
                      type="number" min={0.5} step={0.5} value={form.min_booking_hours}
                      onChange={(e) => setForm((p) => ({ ...p, min_booking_hours: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">Jam</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Batas Batal</Label>
                    <Input
                      type="number" min={0} value={form.cancellation_hours}
                      onChange={(e) => setForm((p) => ({ ...p, cancellation_hours: e.target.value }))}
                    />
                    <p className="text-xs text-muted-foreground">Jam sebelum</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Reminder WA */}
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bell className="h-4 w-4 text-emerald-400" />
                  Jadwal Reminder WA Member
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Tentukan berapa hari sebelum masa keanggotaan habis, notifikasi WA dikirim ke member.
                  Worker otomatis berjalan setiap 1 jam.
                </p>

                {/* Tag daftar hari */}
                <div className="flex flex-wrap gap-2 min-h-10 rounded-md border border-border/50 bg-muted/10 p-2">
                  {reminderDays.map((d) => (
                    <Badge
                      key={d}
                      className="bg-emerald-900/30 text-emerald-300 border-emerald-700 text-xs gap-1 pr-1"
                    >
                      {d} hari sebelum
                      <button
                        onClick={() => removeDay(d)}
                        className="ml-1 rounded-full hover:bg-emerald-700/40 p-0.5"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                  {reminderDays.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">Belum ada jadwal</span>
                  )}
                </div>

                {/* Input tambah hari */}
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      type="number"
                      min={1}
                      max={90}
                      placeholder="Tambah hari (misal: 7)"
                      value={newDay}
                      onChange={(e) => setNewDay(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDay(); } }}
                    />
                  </div>
                  <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={addDay}>
                    <Plus className="h-3.5 w-3.5" /> Tambah
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Contoh: tambahkan <strong>7</strong>, <strong>3</strong>, <strong>1</strong> agar reminder dikirim 7 hari, 3 hari, dan 1 hari sebelum expired.
                </p>
              </CardContent>
            </Card>

            {/* Template Pesan WA */}
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-400" />
                    Format Pesan WA Reminder
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground gap-1"
                    onClick={() => setWaTemplate(DEFAULT_WA_TEMPLATE)}
                  >
                    <RotateCcw className="h-3 w-3" /> Reset Default
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Gunakan variabel berikut dalam teks pesan:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { v: "{{name}}", desc: "Nama member" },
                    { v: "{{end_date}}", desc: "Tanggal berakhir" },
                    { v: "{{days_label}}", desc: "Label hari (misal: 4 hari lagi)" },
                    { v: "{{center_name}}", desc: "Nama sport center" },
                  ].map(({ v, desc }) => (
                    <button
                      key={v}
                      type="button"
                      title={desc}
                      onClick={() => setWaTemplate((t) => t + v)}
                      className="font-mono text-xs bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-600 rounded px-2 py-0.5 transition-colors"
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={waTemplate}
                  onChange={(e) => setWaTemplate(e.target.value)}
                  rows={10}
                  className="font-mono text-xs resize-y"
                  placeholder="Tulis template pesan di sini..."
                />
                {/* Preview */}
                {waTemplate && (
                  <div className="rounded-md border border-emerald-800/50 bg-emerald-950/20 p-3">
                    <p className="text-xs text-emerald-400 font-medium mb-1.5">Preview (contoh dengan nama "Budi"):</p>
                    <p className="text-xs text-slate-300 whitespace-pre-wrap">
                      {waTemplate
                        .replace(/\{\{name\}\}/g, "Budi")
                        .replace(/\{\{end_date\}\}/g, "30 Juni 2026")
                        .replace(/\{\{days_label\}\}/g, `${reminderDays[0] ?? 4} hari lagi`)
                        .replace(/\{\{center_name\}\}/g, form.center_name || "Sport Center")}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Kirim Test WA */}
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Send className="h-4 w-4 text-green-400" />
                  Kirim Test WA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Kirim pesan percobaan ke nomor HP menggunakan template di atas (nama diganti "Test Member").
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Nomor HP (contoh: 628123456789)"
                    value={testPhone}
                    onChange={(e) => { setTestPhone(e.target.value); setTestResult(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); testWaMutation.mutate(); } }}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    className="gap-1.5 shrink-0 border-green-700 text-green-400 hover:bg-green-900/20"
                    disabled={!testPhone.trim() || testWaMutation.isPending}
                    onClick={() => testWaMutation.mutate()}
                  >
                    {testWaMutation.isPending
                      ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      : <Send className="h-3.5 w-3.5" />}
                    Kirim Test
                  </Button>
                </div>

                {testResult && (
                  <div className={`rounded-md border p-3 space-y-1.5 ${testResult.ok ? "border-emerald-800/50 bg-emerald-950/20" : "border-red-800/50 bg-red-950/20"}`}>
                    {testResult.ok ? (
                      <>
                        <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Pesan berhasil dikirim ke {testPhone}
                        </p>
                        {testResult.message && (
                          <p className="text-xs text-slate-300 whitespace-pre-wrap border-t border-emerald-800/30 pt-2 mt-1">
                            {testResult.message}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-red-400">{testResult.error}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              className="gap-2"
              disabled={!form.center_name || saveMutation.isPending}
              onClick={handleSave}
            >
              {saveMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Simpan Pengaturan
            </Button>
          </>
        )}
      </div>
    </AppShell>
  );
}
