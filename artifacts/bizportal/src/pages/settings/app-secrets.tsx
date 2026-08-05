import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  KeyRound, Eye, EyeOff, Save, Loader2,
  MessageCircle, Mail, Shield, Send, RotateCcw, Database, Server, ArrowLeft,
  Bot, HardDrive, Bell, Layers,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Link } from "wouter";

interface SecretEntry {
  key: string;
  label: string;
  description: string;
  group: string;
  sensitive: boolean;
  hasDbValue: boolean;
  hasEnvValue: boolean;
  maskedValue: string;
}

const GROUP_ICONS: Record<string, React.ReactNode> = {
  WhatsApp: <MessageCircle className="h-4 w-4 text-green-500" />,
  Email: <Mail className="h-4 w-4 text-blue-500" />,
  Auth: <Shield className="h-4 w-4 text-orange-500" />,
  AI: <Bot className="h-4 w-4 text-purple-500" />,
  Storage: <HardDrive className="h-4 w-4 text-cyan-500" />,
  Notifikasi: <Bell className="h-4 w-4 text-yellow-500" />,
  Supabase: <Layers className="h-4 w-4 text-emerald-500" />,
};

function SourceBadge({ hasDbValue, hasEnvValue }: { hasDbValue: boolean; hasEnvValue: boolean }) {
  if (hasDbValue) {
    return (
      <Badge variant="outline" className="text-xs gap-1 border-green-500/50 text-green-600">
        <Database className="h-3 w-3" /> DB
      </Badge>
    );
  }
  if (hasEnvValue) {
    return (
      <Badge variant="outline" className="text-xs gap-1 border-blue-500/50 text-blue-600">
        <Server className="h-3 w-3" /> Env
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs gap-1 border-red-500/50 text-red-500">
      Belum diset
    </Badge>
  );
}

function SecretRow({ entry, onRefresh }: { entry: SecretEntry; onRefresh: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testTarget, setTestTarget] = useState("");
  const [testDialog, setTestDialog] = useState(false);
  const [testing, setTesting] = useState(false);

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/secrets/${entry.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Tersimpan", description: `${entry.label} berhasil disimpan ke Supabase.` });
      setEditing(false);
      setValue("");
      onRefresh();
    } catch (err) {
      toast({ title: "Gagal", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry.hasDbValue) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/settings/secrets/${entry.key}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Direset", description: `${entry.label} dikembalikan ke nilai env variable.` });
      onRefresh();
    } catch (err) {
      toast({ title: "Gagal", description: String(err), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const isWa = entry.group === "WhatsApp" && entry.key === "fonnte_token";
      const isEmail = entry.group === "Email" && entry.key === "smtp_pass";
      if (!isWa && !isEmail) { setTesting(false); return; }

      const endpoint = isWa ? "/api/settings/secrets/test-whatsapp" : "/api/settings/secrets/test-email";
      const body = isWa ? { target: testTarget } : { to: testTarget };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json() as { ok?: boolean; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Gagal");
      toast({ title: "✅ Test berhasil", description: `${isWa ? "WhatsApp" : "Email"} terkirim ke ${testTarget}` });
      setTestDialog(false);
      setTestTarget("");
    } catch (err) {
      toast({ title: "Test gagal", description: String(err), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  const canTest = entry.key === "fonnte_token" || entry.key === "smtp_pass";
  const isConfigured = entry.hasDbValue || entry.hasEnvValue;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">{entry.label}</span>
            <SourceBadge hasDbValue={entry.hasDbValue} hasEnvValue={entry.hasEnvValue} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canTest && isConfigured && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => setTestDialog(true)}
            >
              <Send className="h-3 w-3" /> Test
            </Button>
          )}
          {entry.hasDbValue && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              disabled={deleting}
              title="Reset ke env variable"
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            </Button>
          )}
          <Button
            variant={editing ? "outline" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => { setEditing(!editing); setValue(""); }}
          >
            {editing ? "Batal" : entry.hasDbValue ? "Ubah" : "Set"}
          </Button>
        </div>
      </div>

      {!editing && entry.maskedValue && (
        <div className="flex items-center gap-2">
          <div className="font-mono text-xs bg-muted px-2.5 py-1.5 rounded flex-1 text-muted-foreground truncate">
            {showValue && !entry.sensitive ? entry.maskedValue : entry.maskedValue}
          </div>
          {!entry.sensitive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowValue(!showValue)}
            >
              {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      )}

      {editing && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={entry.sensitive ? "password" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Masukkan ${entry.label}…`}
              className="pr-10 text-sm font-mono"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
            {entry.sensitive && (
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const input = document.querySelector(`input[placeholder="Masukkan ${entry.label}…"]`) as HTMLInputElement;
                  if (input) input.type = input.type === "password" ? "text" : "password";
                }}
              >
                <Eye className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button size="sm" onClick={handleSave} disabled={saving || !value.trim()} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Simpan
          </Button>
        </div>
      )}

      <Dialog open={testDialog} onOpenChange={setTestDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Test {entry.group === "WhatsApp" ? "WhatsApp" : "Email"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-sm">
              {entry.group === "WhatsApp" ? "Nomor WA tujuan (628xxx)" : "Email tujuan"}
            </Label>
            <Input
              value={testTarget}
              onChange={(e) => setTestTarget(e.target.value)}
              placeholder={entry.group === "WhatsApp" ? "628123456789" : "admin@example.com"}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialog(false)}>Batal</Button>
            <Button onClick={handleTest} disabled={testing || !testTarget.trim()} className="gap-1.5">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Kirim Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AppSecretsPage() {
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { toast } = useToast();

  async function loadSecrets() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/settings/secrets", { credentials: "include" });
      if (!res.ok) {
        const body = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(body).message ?? msg; } catch { msg = body || msg; }
        throw new Error(msg);
      }
      const data = await res.json() as SecretEntry[];
      setSecrets(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      toast({ title: "Gagal memuat secrets", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSecrets(); }, []);

  const groups = [...new Set(secrets.map((s) => s.group).filter((g): g is string => !!g))];

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-xl font-bold">Secrets & Konfigurasi</h1>
            <p className="text-sm text-muted-foreground">
              Simpan API keys dan konfigurasi sensitif langsung di Supabase — env variable tetap sebagai fallback.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-2.5 text-sm text-amber-600">
          <Shield className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Nilai yang disimpan di DB akan <strong>menggantikan</strong> env variable. Kolom <Badge variant="outline" className="text-xs gap-1 border-green-500/50 text-green-600 inline-flex items-center"><Database className="h-2.5 w-2.5" />DB</Badge> berarti dari Supabase, <Badge variant="outline" className="text-xs gap-1 border-blue-500/50 text-blue-600 inline-flex items-center"><Server className="h-2.5 w-2.5" />Env</Badge> berarti dari environment variable Replit.
          </span>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : errorMsg ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-4 flex items-start gap-3 text-sm text-red-600">
            <Shield className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1 space-y-2">
              <p className="font-medium">Gagal memuat konfigurasi</p>
              <p className="text-red-500/80">{errorMsg}</p>
              <Button size="sm" variant="outline" onClick={loadSecrets} className="gap-1.5 border-red-500/30 text-red-600 hover:bg-red-500/10">
                <RotateCcw className="h-3.5 w-3.5" /> Coba Lagi
              </Button>
            </div>
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-muted px-4 py-6 text-center text-sm text-muted-foreground space-y-2">
            <p>Tidak ada konfigurasi ditemukan.</p>
            <Button size="sm" variant="outline" onClick={loadSecrets} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group} className="space-y-3">
                <div className="flex items-center gap-2">
                  {GROUP_ICONS[group]}
                  <h2 className="text-sm font-semibold text-foreground">{group}</h2>
                </div>
                <div className="space-y-2">
                  {secrets.filter((s) => s.group === group).map((entry) => (
                    <SecretRow key={entry.key} entry={entry} onRefresh={loadSecrets} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
