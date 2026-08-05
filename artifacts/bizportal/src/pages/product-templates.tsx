import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowLeft, Layers, Plus, Pencil, Copy, PowerOff, Power, Trash2, RefreshCw,
  PackageCheck, FileText, ClipboardList, Wrench, GitBranch, AlertCircle,
  Search, CheckCircle2, XCircle, Info, RotateCcw,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

interface DbTemplate {
  id: number;
  categoryKey: string;
  label: string;
  version: string;
  isActive: boolean;
  requiredDocuments: unknown[];
  checklist: unknown[];
  customFields: unknown[];
  packagingInstructions: string | null;
  conditionalRules: unknown[];
  validationRules: unknown[];
  createdAt: string;
  updatedAt: string;
}

const API = "/api/product-templates";

function useAuthFetch() {
  const { session } = useSupabaseAuth();
  return useCallback(
    async (url: string, opts?: RequestInit) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(opts?.headers as Record<string, string> ?? {}),
      };
      if ((session as any)?.access_token) headers["Authorization"] = `Bearer ${(session as any).access_token}`;
      return fetch(url, { ...opts, headers });
    },
    [session],
  );
}

// ── JSON editor with parse validation ──
function JsonEditor({
  label, value, onChange, hint,
}: { label: string; value: unknown[]; onChange: (v: unknown[]) => void; hint?: string }) {
  const [raw, setRaw] = useState(JSON.stringify(value, null, 2));
  const [err, setErr] = useState("");

  useEffect(() => {
    setRaw(JSON.stringify(value, null, 2));
    setErr("");
  }, [value]);

  function handleChange(text: string) {
    setRaw(text);
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) { setErr("Harus berupa array [...]"); return; }
      setErr("");
      onChange(parsed);
    } catch {
      setErr("JSON tidak valid");
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        {hint && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs whitespace-pre-wrap">{hint}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <Textarea
        className={`font-mono text-xs min-h-[160px] ${err ? "border-destructive" : ""}`}
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
      />
      {err && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{err}</p>}
    </div>
  );
}

const EMPTY_FORM = {
  categoryKey: "",
  label: "",
  version: "1.0.0",
  isActive: true,
  requiredDocuments: [] as unknown[],
  checklist: [] as unknown[],
  customFields: [] as unknown[],
  packagingInstructions: "",
  conditionalRules: [] as unknown[],
  validationRules: [] as unknown[],
};

type FormState = typeof EMPTY_FORM;

const CUSTOM_FIELDS_HINT = `Array of fields. Example:
[
  {
    "key": "quantity_mt",
    "label": "Kuantitas (MT)",
    "type": "number",
    "required": true,
    "placeholder": "1000"
  },
  {
    "key": "grade",
    "label": "Grade",
    "type": "select",
    "required": true,
    "options": ["Grade A", "Grade B"]
  }
]
Types: text | number | select | textarea | date`;

const DOCS_HINT = `Array of required documents. Example:
[
  {
    "key": "coa",
    "label": "Certificate of Analysis",
    "required": true
  }
]`;

const CHECKLIST_HINT = `Array of checklist items. Example:
[
  {
    "key": "moisture_checked",
    "label": "Kadar moisture dicek"
  }
]`;

const COND_RULES_HINT = `Array of conditional rules. Example:
[
  {
    "fieldKey": "has_battery",
    "condition": { "value": "Ya" },
    "show": ["battery_wh"]
  }
]
Show listed fields only when fieldKey equals condition.value.`;

const VAL_RULES_HINT = `Array of validation rules. Example:
[
  {
    "fieldKey": "quantity_mt",
    "message": "Kuantitas wajib diisi"
  }
]`;

export default function ProductTemplatesPage() {
  const { toast } = useToast();
  const authFetch = useAuthFetch();

  const [templates, setTemplates] = useState<DbTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DbTemplate | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      // ?raw=1 → DB row shape (categoryKey, isActive, id) required by the admin CMS.
      // Without raw=1 the API returns resolved templates merged with in-code defaults.
      const r = await fetch(`${API}?raw=1`);
      if (!r.ok) throw new Error("Gagal memuat template");
      setTemplates(await r.json());
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = templates.filter((t) =>
    t.categoryKey.toLowerCase().includes(search.toLowerCase()) ||
    t.label.toLowerCase().includes(search.toLowerCase()),
  );

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  }

  function openEdit(t: DbTemplate) {
    setEditingId(t.id);
    setForm({
      categoryKey: t.categoryKey,
      label: t.label,
      version: t.version,
      isActive: t.isActive,
      requiredDocuments: t.requiredDocuments,
      checklist: t.checklist,
      customFields: t.customFields,
      packagingInstructions: t.packagingInstructions ?? "",
      conditionalRules: t.conditionalRules,
      validationRules: t.validationRules,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.categoryKey.trim() || !form.label.trim()) {
      toast({ title: "Category Key dan Label wajib diisi", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let r: Response;
      if (editingId) {
        r = await authFetch(`${API}/${editingId}`, { method: "PUT", body: JSON.stringify(form) });
      } else {
        r = await authFetch(API, { method: "POST", body: JSON.stringify(form) });
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? "Gagal menyimpan");
      }
      toast({ title: editingId ? "Template diperbarui" : "Template berhasil dibuat" });
      setDialogOpen(false);
      load();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(t: DbTemplate) {
    try {
      const r = await authFetch(`${API}/${t.id}/duplicate`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? "Gagal menduplikasi");
      }
      const dup = await r.json() as DbTemplate;
      toast({ title: `Template "${t.label}" berhasil diduplikasi. Silakan edit Category Key.` });
      load();
      openEdit(dup);
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    }
  }

  async function handleToggle(t: DbTemplate) {
    try {
      const r = await authFetch(`${API}/${t.id}/toggle`, { method: "PATCH" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? "Gagal mengubah status");
      }
      load();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const r = await authFetch(`${API}/${deleteTarget.id}`, { method: "DELETE" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? "Gagal menghapus");
      }
      toast({ title: `Template "${deleteTarget.label}" dihapus` });
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
      setDeleteTarget(null);
    }
  }

  async function handleSyncDefaults() {
    setSyncing(true);
    setSyncConfirmOpen(false);
    try {
      const r = await authFetch(`${API}/sync-defaults`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? "Gagal sync");
      }
      const data = await r.json() as { results: { categoryKey: string; action: string }[] };
      const inserted = data.results.filter((x) => x.action === "inserted").length;
      const updated = data.results.filter((x) => x.action === "updated").length;
      toast({ title: `Sync selesai: ${inserted} ditambah, ${updated} diperbarui` });
      load();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  function setF<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((p) => ({ ...p, [key]: val }));
  }

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="w-6 h-6 text-primary" /> Product Templates
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Kelola template komoditas — custom fields, dokumen, checklist, dan aturan validasi.
            </p>
          </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSyncConfirmOpen(true)}
              disabled={syncing}
            >
              <RotateCcw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
              Sync Default
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1" /> Tambah Template
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Template", value: templates.length, icon: Layers, color: "text-primary" },
            { label: "Aktif", value: templates.filter((t) => t.isActive).length, icon: CheckCircle2, color: "text-green-600" },
            { label: "Nonaktif", value: templates.filter((t) => !t.isActive).length, icon: XCircle, color: "text-muted-foreground" },
            { label: "Custom Fields", value: templates.reduce((s, t) => s + (t.customFields as unknown[]).length, 0), icon: Wrench, color: "text-blue-600" },
          ].map((s) => (
            <div key={s.label} className="border rounded-xl p-4 bg-card">
              <s.icon className={`w-5 h-5 ${s.color} mb-2`} />
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Cari template..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="border rounded-xl overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category Key</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Label</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Versi</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Fields</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Dokumen</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Memuat...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <PackageCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Tidak ada template ditemukan
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.categoryKey}</td>
                    <td className="px-4 py-3 font-medium">{t.label}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <GitBranch className="w-3 h-3" /> v{t.version}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Wrench className="w-3 h-3 text-blue-500" />
                        {(t.customFields as unknown[]).length} fields
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <FileText className="w-3 h-3 text-amber-500" />
                        {(t.requiredDocuments as unknown[]).length} dokumen
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {t.isActive
                        ? <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Aktif</Badge>
                        : <Badge variant="secondary" className="text-[10px]"><XCircle className="w-3 h-3 mr-1" />Nonaktif</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDuplicate(t)}>
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Duplikat</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className={`h-7 w-7 ${t.isActive ? "text-amber-600" : "text-green-600"}`}
                                onClick={() => handleToggle(t)}
                              >
                                {t.isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t.isActive ? "Nonaktifkan" : "Aktifkan"}</TooltipContent>
                          </Tooltip>
                          {!t.isActive && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive"
                                  onClick={() => setDeleteTarget(t)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Hapus</TooltipContent>
                            </Tooltip>
                          )}
                        </TooltipProvider>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Create / Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                {editingId ? "Edit Template" : "Tambah Template Baru"}
              </DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="basic">
              <TabsList className="w-full grid grid-cols-3 sm:grid-cols-6 mb-4 h-auto">
                <TabsTrigger value="basic" className="text-[11px] py-1.5">Info Dasar</TabsTrigger>
                <TabsTrigger value="fields" className="text-[11px] py-1.5">Custom Fields</TabsTrigger>
                <TabsTrigger value="docs" className="text-[11px] py-1.5">Dokumen</TabsTrigger>
                <TabsTrigger value="checklist" className="text-[11px] py-1.5">Checklist</TabsTrigger>
                <TabsTrigger value="packaging" className="text-[11px] py-1.5">Packaging</TabsTrigger>
                <TabsTrigger value="rules" className="text-[11px] py-1.5">Rules</TabsTrigger>
              </TabsList>

              {/* ── Tab: Info Dasar ── */}
              <TabsContent value="basic" className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Category Key <span className="text-destructive">*</span></Label>
                    <Input
                      value={form.categoryKey}
                      onChange={(e) => setF("categoryKey", e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                      placeholder="coal, iron_steel, my_custom_category"
                      disabled={!!editingId}
                      className="font-mono text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Huruf kecil & underscore. Tidak bisa diubah setelah dibuat.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Label / Nama Kategori <span className="text-destructive">*</span></Label>
                    <Input
                      value={form.label}
                      onChange={(e) => setF("label", e.target.value)}
                      placeholder="Batubara / Besi & Baja / Custom Commodity"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Versi</Label>
                    <Input
                      value={form.version}
                      onChange={(e) => setF("version", e.target.value)}
                      placeholder="1.0.0"
                      className="font-mono text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Saat save, versi otomatis di-bump jika tidak diubah manual.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <div className="flex items-center gap-3 pt-2">
                      <Switch
                        checked={form.isActive}
                        onCheckedChange={(v) => setF("isActive", v)}
                      />
                      <span className="text-sm">{form.isActive ? "Aktif" : "Nonaktif"}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Template nonaktif tidak muncul di portal pelanggan.
                    </p>
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab: Custom Fields ── */}
              <TabsContent value="fields">
                <JsonEditor
                  label="Custom Fields (JSON Array)"
                  value={form.customFields}
                  onChange={(v) => setF("customFields", v)}
                  hint={CUSTOM_FIELDS_HINT}
                />
              </TabsContent>

              {/* ── Tab: Dokumen ── */}
              <TabsContent value="docs">
                <JsonEditor
                  label="Required Documents (JSON Array)"
                  value={form.requiredDocuments}
                  onChange={(v) => setF("requiredDocuments", v)}
                  hint={DOCS_HINT}
                />
              </TabsContent>

              {/* ── Tab: Checklist ── */}
              <TabsContent value="checklist">
                <JsonEditor
                  label="Checklist Items (JSON Array)"
                  value={form.checklist}
                  onChange={(v) => setF("checklist", v)}
                  hint={CHECKLIST_HINT}
                />
              </TabsContent>

              {/* ── Tab: Packaging ── */}
              <TabsContent value="packaging" className="space-y-2">
                <Label className="text-xs">Instruksi Handling / Packaging</Label>
                <Textarea
                  className="min-h-[200px]"
                  placeholder="Tuliskan instruksi penanganan dan pengemasan khusus untuk kategori ini..."
                  value={form.packagingInstructions}
                  onChange={(e) => setF("packagingInstructions", e.target.value)}
                />
              </TabsContent>

              {/* ── Tab: Rules ── */}
              <TabsContent value="rules" className="space-y-6">
                <JsonEditor
                  label="Conditional Rules (JSON Array)"
                  value={form.conditionalRules}
                  onChange={(v) => setF("conditionalRules", v)}
                  hint={COND_RULES_HINT}
                />
                <JsonEditor
                  label="Validation Rules (JSON Array)"
                  value={form.validationRules}
                  onChange={(v) => setF("validationRules", v)}
                  hint={VAL_RULES_HINT}
                />
              </TabsContent>
            </Tabs>

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Buat Template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Sync Default Confirm */}
        <AlertDialog open={syncConfirmOpen} onOpenChange={setSyncConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-amber-500" /> Sync ke Default?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Semua <strong>18 template bawaan</strong> akan di-upsert ke database:
                <ul className="mt-2 space-y-1 text-xs list-disc list-inside">
                  <li>Template yang <strong>belum ada</strong> → ditambahkan</li>
                  <li>Template yang <strong>sudah ada</strong> → semua field diperbarui ke versi default (versi di-bump otomatis)</li>
                  <li>Template <strong>custom buatan sendiri</strong> → tidak disentuh</li>
                </ul>
                <span className="block mt-2 text-amber-600 font-medium">Perubahan manual pada template bawaan akan tertimpa.</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction onClick={handleSyncDefaults} className="bg-amber-500 text-white hover:bg-amber-600">
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Ya, Sync Sekarang
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Confirm */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Template?</AlertDialogTitle>
              <AlertDialogDescription>
                Template <strong>"{deleteTarget?.label}"</strong> ({deleteTarget?.categoryKey}) akan dihapus permanen.
                Aksi ini tidak dapat dibatalkan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}
