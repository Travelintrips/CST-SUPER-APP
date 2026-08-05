import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ArrowLeft, MessageCircle, Send, RefreshCw, Eye } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface ReportSettings {
  id: number;
  enabled: boolean;
  sendHourWib: number;
  recipients: string[];
  lastSentDate: string | null;
  lastStatus: string | null;
}

const API = "/api/accounting/wa-report";

async function fetchSettings(): Promise<ReportSettings> {
  const res = await fetch(`${API}/settings`, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function saveSettings(patch: Partial<ReportSettings>): Promise<ReportSettings> {
  const res = await fetch(`${API}/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function previewReport(date?: string): Promise<{ message: string; date: string }> {
  const res = await fetch(`${API}/preview`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(date ? { date } : {}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sendNow(date?: string): Promise<{ ok: boolean; message: string; recipients: string[]; errors: string[] }> {
  const res = await fetch(`${API}/send-now`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(date ? { date } : {}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function WaReportSettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<ReportSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [recipientsText, setRecipientsText] = useState("");
  const [sendHourWib, setSendHourWib] = useState(22);
  const [enabled, setEnabled] = useState(false);
  const [previewDate, setPreviewDate] = useState(() => {
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return wib.toISOString().slice(0, 10);
  });

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setSettings(s);
        setEnabled(s.enabled);
        setSendHourWib(s.sendHourWib);
        setRecipientsText(s.recipients.join("\n"));
      })
      .catch((err) => toast({ title: "Gagal memuat pengaturan", description: String(err), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const recipients = recipientsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await saveSettings({ enabled, sendHourWib, recipients });
      setSettings(updated);
      toast({ title: "Pengaturan disimpan" });
    } catch (err) {
      toast({ title: "Gagal menyimpan", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreviewMessage(null);
    try {
      const result = await previewReport(previewDate);
      setPreviewMessage(result.message);
    } catch (err) {
      toast({ title: "Gagal generate preview", description: String(err), variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  const handleSendNow = async () => {
    setSending(true);
    try {
      const result = await sendNow(previewDate);
      if (result.ok) {
        toast({
          title: "Laporan terkirim",
          description: `Terkirim ke: ${result.recipients.join(", ")}`,
        });
      } else {
        toast({
          title: result.recipients.length > 0 ? "Laporan terkirim sebagian" : "Gagal kirim laporan",
          description: result.errors.join("; ") || result.message,
          variant: "destructive",
        });
      }
      const updated = await fetchSettings();
      setSettings(updated);
    } catch (err) {
      toast({ title: "Gagal kirim", description: String(err), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell>
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/accounting/settings">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Kembali
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MessageCircle className="h-6 w-6 text-green-600" />
              Laporan WA Harian
            </h1>
            <p className="text-sm text-muted-foreground">
              Kirim ringkasan P&L dan aktivitas akuntansi setiap hari via WhatsApp
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Memuat...</div>
        ) : (
          <div className="space-y-4">
            {/* Enable toggle */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Status Laporan Otomatis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="enabled-toggle" className="font-medium">Aktifkan laporan harian</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Laporan dikirim setiap hari pukul {sendHourWib}:00 WIB
                    </p>
                  </div>
                  <Switch
                    id="enabled-toggle"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                </div>

                <div className="space-y-1">
                  <Label>Jam kirim (WIB)</Label>
                  <Select
                    value={String(sendHourWib)}
                    onValueChange={(v) => setSendHourWib(Number(v))}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {String(i).padStart(2, "0")}:00 WIB
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Recipients */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Penerima WhatsApp</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label>Nomor / Group ID (satu per baris)</Label>
                <Textarea
                  placeholder={"120363429456178525@g.us\n628123456789"}
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  rows={5}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Format: nomor internasional (628xxx) atau Group ID dari Fonnte (@g.us)
                </p>
              </CardContent>
            </Card>

            {/* Save button */}
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              Simpan Pengaturan
            </Button>

            {/* Send now + preview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Test Kirim / Preview Laporan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label>Tanggal laporan</Label>
                  <DatePicker value={previewDate} onChange={(v) => { setPreviewDate(v); setPreviewMessage(null); }} />
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handlePreview}
                    disabled={previewing || sending}
                    className="flex-1 gap-2"
                  >
                    {previewing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                    Preview Isi Pesan
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSendNow}
                    disabled={sending || previewing}
                    className="flex-1 gap-2 border-green-600 text-green-700 hover:bg-green-50"
                  >
                    {sending ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Kirim Sekarang
                  </Button>
                </div>

                {previewMessage && (
                  <div className="mt-2 rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                      Preview Pesan WA
                    </p>
                    <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed text-foreground">
                      {previewMessage}
                    </pre>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Preview: tampilkan isi pesan tanpa kirim. Kirim Sekarang: langsung ke semua penerima via FONNTE_TOKEN_REPORT.
                </p>
              </CardContent>
            </Card>

            {/* Last sent info */}
            {settings && (settings.lastSentDate || settings.lastStatus) && (
              <Card className="bg-muted/30">
                <CardContent className="pt-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Terakhir dikirim</span>
                    <span className="font-medium">{settings.lastSentDate ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={`font-medium ${settings.lastStatus === "ok" ? "text-green-600" : "text-orange-500"}`}>
                      {settings.lastStatus ?? "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
