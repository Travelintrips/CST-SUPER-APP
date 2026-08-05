import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Eye, EyeOff, CheckCircle2, XCircle, KeyRound, RefreshCw,
  Copy, Check, Pencil, Trash2, Plus, Lock, Unlock, AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

// ── Types ──────────────────────────────────────────────────────────────────────
interface EnvEntry {
  key: string;
  label: string;
  description: string;
  group: string;
  sensitive: boolean;
  hasDbValue: boolean;
  hasEnvValue: boolean;
  maskedValue: string;
}

interface AppConfigEntry {
  key: string;
  value: string;
  description: string;
  is_secret: boolean;
  updated_at: string;
}

// ── API helpers ────────────────────────────────────────────────────────────────
async function fetchEnvSecrets(): Promise<EnvEntry[]> {
  const r = await fetch("/api/settings/secrets", { credentials: "include" });
  if (!r.ok) throw new Error("Gagal memuat env secrets");
  return r.json();
}

async function fetchAppConfig(): Promise<AppConfigEntry[]> {
  const r = await fetch("/api/settings/app-config", { credentials: "include" });
  if (!r.ok) throw new Error("Gagal memuat app config");
  return r.json();
}

async function saveAppConfig(entry: Omit<AppConfigEntry, "updated_at"> & { isNew: boolean }) {
  const { isNew, ...body } = entry;
  const r = await fetch(
    isNew ? "/api/settings/app-config" : `/api/settings/app-config/${encodeURIComponent(entry.key)}`,
    {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.message ?? "Gagal menyimpan");
  }
  return r.json();
}

async function deleteAppConfig(key: string) {
  const r = await fetch(`/api/settings/app-config/${encodeURIComponent(key)}`, {
    method: "DELETE", credentials: "include",
  });
  if (!r.ok) throw new Error("Gagal menghapus");
}

// ── Small helper: Copy button ──────────────────────────────────────────────────
function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      title="Copy"
      className={`text-muted-foreground hover:text-foreground transition-colors ${className}`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── Env Vars section ───────────────────────────────────────────────────────────
// Group order for display
const GROUP_ORDER = ["WhatsApp", "Email", "Auth", "Supabase", "AI", "Notifikasi"];

function EnvVarsTab() {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const { data: secrets = [], isLoading, isError, refetch, isFetching } = useQuery<EnvEntry[]>({
    queryKey: ["settings", "secrets"],
    queryFn: fetchEnvSecrets,
  });

  function toggleReveal(key: string) {
    setRevealed(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  // Build groups dynamically from API data (group field)
  const groupMap = new Map<string, EnvEntry[]>();
  for (const s of secrets) {
    const g = s.group ?? "Lainnya";
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g)!.push(s);
  }
  // Sort groups: known order first, then alphabetical
  const grouped = [...groupMap.entries()]
    .sort(([a], [b]) => {
      const ia = GROUP_ORDER.indexOf(a);
      const ib = GROUP_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    })
    .map(([name, items]) => ({ name, items }));

  const unconfigured = secrets.filter(s => !s.hasDbValue && !s.hasEnvValue);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Nilai dari Replit Secrets (Env) atau DB override. DB override menggantikan env var tanpa restart.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5 shrink-0">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {!isLoading && unconfigured.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <span>
            <strong>{unconfigured.length} secret</strong> belum diset:{" "}
            {unconfigured.map(s => s.label).join(", ")}.
          </span>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Memuat...
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Gagal memuat. Pastikan login sebagai admin.
        </div>
      )}

      {grouped.map(group => (
        <Card key={group.name}>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {group.name}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                {group.items.filter(i => i.hasDbValue || i.hasEnvValue).length}/{group.items.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pt-0 pb-1">
            <table className="w-full text-xs">
              <colgroup>
                <col className="w-[35%]" />
                <col className="w-[15%]" />
                <col className="w-[30%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-4 pb-2 text-left font-normal">Label / Env Key</th>
                  <th className="px-4 pb-2 text-center font-normal">Sumber</th>
                  <th className="px-4 pb-2 text-left font-normal">Nilai</th>
                  <th className="px-4 pb-2 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map(item => {
                  const isConfigured = item.hasDbValue || item.hasEnvValue;
                  return (
                    <tr key={item.key} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 align-top">
                        <p className="font-medium text-foreground">{item.label}</p>
                        <code className="font-mono text-[10px] text-muted-foreground">{item.key}</code>
                        <p className="text-muted-foreground mt-0.5 leading-snug text-[11px]">{item.description}</p>
                      </td>
                      <td className="px-4 py-2.5 align-top text-center">
                        {item.hasDbValue && (
                          <Badge className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 border-blue-200">DB</Badge>
                        )}
                        {item.hasEnvValue && !item.hasDbValue && (
                          <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200">Env</Badge>
                        )}
                        {!isConfigured && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">—</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        {isConfigured && item.maskedValue ? (
                          <div className="flex items-center gap-1.5">
                            <code className="font-mono text-foreground">
                              {revealed.has(item.key) ? item.maskedValue : "••••••••••••"}
                            </code>
                            {item.sensitive && (
                              <button
                                onClick={() => toggleReveal(item.key)}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                title={revealed.has(item.key) ? "Sembunyikan" : "Tampilkan nilai"}
                              >
                                {revealed.has(item.key) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            {revealed.has(item.key) && <CopyButton text={item.maskedValue} />}
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">— tidak diset —</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top text-right">
                        {isConfigured ? (
                          <span className="inline-flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Aktif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <XCircle className="w-3.5 h-3.5" /> Belum diset
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Cara set / ubah secret:</p>
        <p>• <strong>Via Env</strong>: Buka panel Secrets di sidebar Replit (🔑), restart API server setelah ubah.</p>
        <p>• <strong>Via DB</strong>: Gunakan tab <em>DB Config</em> — aktif tanpa restart, menggantikan env var.</p>
      </div>
    </div>
  );
}

// ── App Config (DB) section ────────────────────────────────────────────────────
type ConfigForm = { key: string; value: string; description: string; is_secret: boolean };
const EMPTY_FORM: ConfigForm = { key: "", value: "", description: "", is_secret: false };

function AppConfigTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<AppConfigEntry | null>(null);
  const [form, setForm] = useState<ConfigForm>(EMPTY_FORM);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const { data: config = [], isLoading, isError, refetch } = useQuery<AppConfigEntry[]>({
    queryKey: ["settings", "app-config"],
    queryFn: fetchAppConfig,
  });

  const saveMut = useMutation({
    mutationFn: saveAppConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "app-config"] });
      toast({ title: editEntry ? "Konfigurasi diperbarui" : "Konfigurasi ditambahkan" });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: deleteAppConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "app-config"] });
      toast({ title: "Konfigurasi dihapus" });
      setDeleteKey(null);
    },
    onError: () => toast({ title: "Gagal menghapus", variant: "destructive" }),
  });

  function openAdd() {
    setEditEntry(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(e: AppConfigEntry) {
    setEditEntry(e);
    setForm({ key: e.key, value: e.value, description: e.description, is_secret: e.is_secret });
    setDialogOpen(true);
  }

  function toggleReveal(key: string) {
    setRevealed(prev => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
    });
  }

  function submit() {
    saveMut.mutate({ ...form, isNew: !editEntry });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Konfigurasi yang disimpan di database — bisa ditambah, diedit, dan dihapus langsung dari sini.
        </p>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={openAdd} className="gap-1.5">
            <Plus className="w-4 h-4" />
            Tambah
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Memuat...
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Gagal memuat konfigurasi.
        </div>
      )}

      {!isLoading && config.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Belum ada konfigurasi. Klik <strong>Tambah</strong> untuk menambahkan entry baru.
        </div>
      )}

      {config.length > 0 && (
        <Card>
          <CardContent className="px-0 pt-0 pb-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-normal">Key</th>
                  <th className="px-4 py-2.5 text-left font-normal">Value</th>
                  <th className="px-4 py-2.5 text-left font-normal">Keterangan</th>
                  <th className="px-4 py-2.5 text-right font-normal">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {config.map(entry => (
                  <tr key={entry.key} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 align-middle">
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">{entry.key}</code>
                        <CopyButton text={entry.key} />
                        {entry.is_secret && (
                          <Lock className="w-3 h-3 text-muted-foreground" aria-label="Secret" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 align-middle max-w-[200px]">
                      {entry.is_secret ? (
                        <div className="flex items-center gap-1.5">
                          <code className="font-mono truncate">
                            {revealed.has(entry.key) ? entry.value : "••••••••••"}
                          </code>
                          <button
                            onClick={() => toggleReveal(entry.key)}
                            className="text-muted-foreground hover:text-foreground shrink-0"
                            title={revealed.has(entry.key) ? "Sembunyikan" : "Tampilkan"}
                          >
                            {revealed.has(entry.key) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          {revealed.has(entry.key) && <CopyButton text={entry.value} />}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono">{entry.value || <em className="text-muted-foreground">kosong</em>}</span>
                          {entry.value && <CopyButton text={entry.value} />}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-middle text-muted-foreground max-w-[180px]">
                      <span className="truncate block">{entry.description || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 align-middle text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(entry)} title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteKey(entry.key)} title="Hapus">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editEntry ? "Edit Konfigurasi" : "Tambah Konfigurasi"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-key">Key <span className="text-destructive">*</span></Label>
              <Input
                id="cfg-key"
                placeholder="contoh: MY_API_KEY"
                value={form.key}
                onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                disabled={!!editEntry}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-value">Value <span className="text-destructive">*</span></Label>
              {form.is_secret ? (
                <Input
                  id="cfg-value"
                  type="password"
                  placeholder="Nilai rahasia"
                  value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  className="font-mono text-sm"
                />
              ) : (
                <Textarea
                  id="cfg-value"
                  placeholder="Nilai konfigurasi"
                  value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  rows={3}
                  className="font-mono text-sm resize-none"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-desc">Keterangan</Label>
              <Input
                id="cfg-desc"
                placeholder="Penjelasan singkat (opsional)"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="text-sm"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  {form.is_secret ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  Tandai sebagai secret
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Nilai akan disembunyikan di tampilan
                </p>
              </div>
              <Switch
                checked={form.is_secret}
                onCheckedChange={v => setForm(f => ({ ...f, is_secret: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button
              onClick={submit}
              disabled={!form.key.trim() || saveMut.isPending}
            >
              {saveMut.isPending ? "Menyimpan..." : editEntry ? "Simpan Perubahan" : "Tambahkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteKey} onOpenChange={open => !open && setDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus konfigurasi <code>{deleteKey}</code>?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteKey && delMut.mutate(deleteKey)}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function SecretsPage() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div className="flex items-center gap-3">
        <KeyRound className="w-6 h-6 text-primary" />
        <div>
          <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

          <h1 className="text-xl font-semibold">Secrets & Konfigurasi</h1>
          <p className="text-sm text-muted-foreground">
            Environment variables sistem dan konfigurasi aplikasi berbasis database
          </p>
        </div>
      </div>

      <Tabs defaultValue="env">
        <TabsList className="mb-4">
          <TabsTrigger value="env">Env Vars (Replit Secrets)</TabsTrigger>
          <TabsTrigger value="config">Konfigurasi App (DB)</TabsTrigger>
        </TabsList>
        <TabsContent value="env">
          <EnvVarsTab />
        </TabsContent>
        <TabsContent value="config">
          <AppConfigTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
