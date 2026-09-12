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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  GitMerge, Plus, Pencil, Trash2, CheckCircle2, XCircle,
  Layers, ArrowRight, User, Shield, FlaskConical, ChevronDown, ChevronUp,
  Building2, FolderOpen, Globe, Package, Infinity, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

const IDR = (n: number | null | undefined) =>
  n == null ? "—" : "Rp " + Number(n).toLocaleString("id-ID");

const CURRENCY_OPTIONS = ["IDR", "USD", "EUR", "SGD", "CNY", "JPY"];

interface Company { id: number; companyName: string; companyCode: string }
interface Department { id: number; companyId: number; name: string }
interface CustomRole { id: number; name: string; color: string }
interface Supplier { id: number; name: string; companyId: number | null }
interface ModuleOption { value: string; label: string }

interface MatrixLevel {
  id?: number;
  level: number;
  label: string;
  minAmount: number | string;
  maxAmount: number | string | null;
  approverRoleId: number | string | null;
  approverUserId: string | null;
  approver_role_name?: string;
  approver_role_color?: string;
  approver_user_name?: string;
}

interface ApprovalMatrix {
  id: number;
  companyId: number | null;
  name: string;
  module: string;
  departmentId: number | null;
  currency: string | null;
  vendorId: number | null;
  description: string | null;
  isActive: boolean;
  priority: number;
  company_name?: string;
  department_name?: string;
  vendor_name?: string;
  levels: MatrixLevel[];
}

interface EvalResult {
  matched: boolean;
  matrix: ApprovalMatrix | null;
  requiredLevels: MatrixLevel[];
}

async function apiFetch(path: string, opts?: RequestInit) {
  const cid = localStorage.getItem("active_company_id");
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(cid ? { "x-company-id": cid } : {}),
    },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const emptyLevel = (): MatrixLevel => ({
  level: 1,
  label: "",
  minAmount: 0,
  maxAmount: null,
  approverRoleId: null,
  approverUserId: null,
});

const emptyForm = () => ({
  name: "",
  module: "general",
  companyId: "",
  departmentId: "",
  currency: "",
  vendorId: "",
  description: "",
  isActive: true,
  priority: "0",
  levels: [{ ...emptyLevel() }],
});

function LevelBar({ level, total }: { level: MatrixLevel; total: number }) {
  const min = Number(level.minAmount ?? 0);
  const max = level.maxAmount != null ? Number(level.maxAmount) : null;
  const colors = [
    "bg-emerald-500/20 border-emerald-500/40 text-emerald-400",
    "bg-blue-500/20 border-blue-500/40 text-blue-400",
    "bg-amber-500/20 border-amber-500/40 text-amber-400",
    "bg-rose-500/20 border-rose-500/40 text-rose-400",
    "bg-purple-500/20 border-purple-500/40 text-purple-400",
  ];
  const c = colors[(level.level - 1) % colors.length];
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${c}`}>
      <span className="font-bold w-5 text-center">{level.level}</span>
      <div className="flex-1">
        <div className="font-semibold">{level.label || `Level ${level.level}`}</div>
        <div className="opacity-80">
          {IDR(min)} → {max != null ? IDR(max) : <span className="inline-flex items-center gap-0.5"><Infinity className="h-3 w-3" /> Tidak terbatas</span>}
        </div>
      </div>
      <div className="text-right">
        {level.approver_role_name ? (
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: level.approver_role_color ?? "#6366f1" }} />
            {level.approver_role_name}
          </span>
        ) : level.approver_user_name ? (
          <span className="flex items-center gap-1"><User className="h-3 w-3" />{level.approver_user_name}</span>
        ) : <span className="opacity-50">—</span>}
      </div>
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active
    ? <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20"><CheckCircle2 className="h-3 w-3 mr-1" />Aktif</Badge>
    : <Badge variant="secondary" className="text-xs"><XCircle className="h-3 w-3 mr-1" />Nonaktif</Badge>;
}

export default function ApprovalMatrixPage() {
  const [matrices, setMatrices] = useState<ApprovalMatrix[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);

  const [moduleFilter, setModuleFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMatrix, setEditMatrix] = useState<ApprovalMatrix | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApprovalMatrix | null>(null);

  const [evalOpen, setEvalOpen] = useState(false);
  const [evalForm, setEvalForm] = useState({ module: "general", currency: "IDR", departmentId: "", vendorId: "", amount: "" });
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = moduleFilter !== "all" ? `/approval-matrix?module=${moduleFilter}` : "/approval-matrix";
      const data = await apiFetch(url);
      setMatrices(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [moduleFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiFetch("/companies").then(setCompanies).catch(() => {});
    apiFetch("/org/departments?companyId=all").then(setDepartments).catch(() => {});
    apiFetch("/custom-roles").then(setRoles).catch(() => {});
    apiFetch("/purchase/suppliers").then((d: any) => setSuppliers(Array.isArray(d) ? d : d.suppliers ?? [])).catch(() => {});
    apiFetch("/approval-matrix/meta/modules").then(setModules).catch(() => {});
  }, []);

  const openAdd = () => {
    setEditMatrix(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (m: ApprovalMatrix) => {
    setEditMatrix(m);
    setForm({
      name: m.name,
      module: m.module,
      companyId: m.companyId ? String(m.companyId) : "",
      departmentId: m.departmentId ? String(m.departmentId) : "",
      currency: m.currency ?? "",
      vendorId: m.vendorId ? String(m.vendorId) : "",
      description: m.description ?? "",
      isActive: m.isActive,
      priority: String(m.priority),
      levels: m.levels.map(lv => ({
        level: lv.level,
        label: lv.label ?? "",
        minAmount: lv.minAmount ?? 0,
        maxAmount: lv.maxAmount ?? null,
        approverRoleId: lv.approverRoleId ?? null,
        approverUserId: lv.approverUserId ?? null,
        approver_role_name: lv.approver_role_name,
        approver_role_color: lv.approver_role_color,
        approver_user_name: lv.approver_user_name,
      })),
    });
    setDialogOpen(true);
  };

  const addLevel = () => {
    setForm(f => {
      const maxLv = Math.max(0, ...f.levels.map(l => l.level));
      const prevMax = f.levels[f.levels.length - 1]?.maxAmount;
      return {
        ...f,
        levels: [
          ...f.levels,
          {
            ...emptyLevel(),
            level: maxLv + 1,
            minAmount: prevMax != null ? Number(prevMax) : 0,
          },
        ],
      };
    });
  };

  const removeLevel = (idx: number) => {
    setForm(f => ({ ...f, levels: f.levels.filter((_, i) => i !== idx) }));
  };

  const updateLevel = (idx: number, key: keyof MatrixLevel, value: any) => {
    setForm(f => ({
      ...f,
      levels: f.levels.map((lv, i) => i === idx ? { ...lv, [key]: value } : lv),
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (form.levels.length === 0) { alert("Minimal 1 level approval wajib diisi"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        module: form.module,
        companyId: form.companyId || null,
        departmentId: form.departmentId || null,
        currency: form.currency || null,
        vendorId: form.vendorId || null,
        description: form.description || null,
        isActive: form.isActive,
        priority: Number(form.priority) || 0,
        levels: form.levels.map((lv, i) => ({
          level: lv.level || (i + 1),
          label: lv.label || null,
          minAmount: Number(lv.minAmount) || 0,
          maxAmount: lv.maxAmount !== null && lv.maxAmount !== "" ? Number(lv.maxAmount) : null,
          approverRoleId: lv.approverRoleId || null,
          approverUserId: lv.approverUserId || null,
        })),
      };
      if (editMatrix) {
        await apiFetch(`/approval-matrix/${editMatrix.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/approval-matrix", { method: "POST", body: JSON.stringify(payload) });
      }
      setDialogOpen(false);
      await load();
    } catch (e: any) { alert("Gagal menyimpan: " + e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/approval-matrix/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } catch (e: any) { alert("Gagal menghapus: " + e.message); }
  };

  const runEval = async () => {
    setEvalLoading(true);
    setEvalResult(null);
    try {
      const cid = localStorage.getItem("active_company_id");
      const payload = {
        companyId: cid || null,
        module: evalForm.module || null,
        currency: evalForm.currency || null,
        departmentId: evalForm.departmentId || null,
        vendorId: evalForm.vendorId || null,
        amount: Number(evalForm.amount) || 0,
      };
      const r = await apiFetch("/approval-matrix/evaluate", { method: "POST", body: JSON.stringify(payload) });
      setEvalResult(r);
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setEvalLoading(false); }
  };

  const moduleLabel = (v: string) => modules.find(m => m.value === v)?.label ?? v;

  const filteredDepts = departments.filter(d =>
    !form.companyId || d.companyId === Number(form.companyId)
  );
  const filteredSuppliers = suppliers.filter(s =>
    !form.companyId || s.companyId === Number(form.companyId) || s.companyId == null
  );

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Layers className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">Approval Matrix</h1>
              <p className="text-sm text-muted-foreground">
                Konfigurasi multi-level approval berdasarkan nominal, departemen, currency, dan vendor
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => { setEvalResult(null); setEvalOpen(true); }}>
              <FlaskConical className="h-4 w-4" /> Uji Matrix
            </Button>
            <Button onClick={openAdd} className="gap-2">
              <Plus className="h-4 w-4" /> Tambah Matrix
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-destructive text-sm">{error}</div>
        )}

        {/* Filter */}
        <div className="flex gap-3 items-center flex-wrap">
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Filter modul..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Modul</SelectItem>
              {modules.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{matrices.length} matrix</span>
          <Link href="/settings/approval-rules">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1">
              <GitMerge className="h-3 w-3" /> Aturan Approval lama
            </Button>
          </Link>
        </div>

        {/* Matrix list */}
        {loading ? (
          <div className="text-center py-16 text-muted-foreground">Memuat...</div>
        ) : matrices.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground flex flex-col items-center gap-3">
            <Layers className="h-12 w-12 opacity-20" />
            <p>Belum ada Approval Matrix. Klik "Tambah Matrix" untuk mulai.</p>
            <p className="text-xs">Contoh: PO &gt; 50 juta → Manajer, &gt; 500 juta → Direktur</p>
          </div>
        ) : (
          <div className="space-y-3">
            {matrices.map(m => (
              <div key={m.id} className="rounded-xl border bg-card overflow-hidden">
                {/* Row header */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{m.name}</span>
                      <ActiveBadge active={m.isActive} />
                      <Badge variant="outline" className="text-xs">{moduleLabel(m.module)}</Badge>
                      {m.currency && (
                        <Badge variant="secondary" className="text-xs"><Globe className="h-3 w-3 mr-1" />{m.currency}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      {m.company_name && <span><Building2 className="h-3 w-3 inline mr-0.5" />{m.company_name}</span>}
                      {m.department_name && <span><FolderOpen className="h-3 w-3 inline mr-0.5" />{m.department_name}</span>}
                      {m.vendor_name && <span><Package className="h-3 w-3 inline mr-0.5" />{m.vendor_name}</span>}
                      <span className="text-muted-foreground/60">{m.levels.length} level approval</span>
                    </div>
                  </div>

                  {/* Mini level preview */}
                  <div className="hidden sm:flex items-center gap-1">
                    {m.levels.slice(0, 4).map((lv, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                              {lv.level}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-medium">{lv.label || `Level ${lv.level}`}</p>
                            <p className="text-xs opacity-80">{IDR(Number(lv.minAmount))} – {lv.maxAmount != null ? IDR(Number(lv.maxAmount)) : "∞"}</p>
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    ))}
                    {m.levels.length > 4 && <span className="text-xs text-muted-foreground">+{m.levels.length - 4}</span>}
                  </div>

                  <div className="flex gap-1 ml-2">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); openEdit(m); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={e => { e.stopPropagation(); setDeleteTarget(m); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={e => { e.stopPropagation(); setExpandedId(expandedId === m.id ? null : m.id); }}>
                      {expandedId === m.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                {/* Expanded levels */}
                {expandedId === m.id && (
                  <div className="border-t px-4 pb-4 pt-3 space-y-2 bg-muted/10">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Level Approval</div>
                    {m.levels.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Belum ada level.</p>
                    ) : (
                      m.levels.map((lv, i) => <LevelBar key={i} level={lv} total={m.levels.length} />)
                    )}
                    {m.description && (
                      <p className="text-xs text-muted-foreground pt-2 border-t mt-2">{m.description}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add / Edit Dialog ─────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editMatrix ? "Edit Approval Matrix" : "Tambah Approval Matrix"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Nama Matrix *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="contoh: Approval PO Logistik" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Modul</Label>
                <Select value={form.module} onValueChange={v => setForm(f => ({ ...f, module: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {modules.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Prioritas (lebih tinggi = lebih spesifik)</Label>
                <Input type="number" min={0} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="h-8 text-sm" />
              </div>
            </div>

            {/* Scope filters */}
            <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filter / Scope</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" />Perusahaan</Label>
                  <Select value={form.companyId || "__all__"} onValueChange={v => setForm(f => ({ ...f, companyId: v === "__all__" ? "" : v, departmentId: "" }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Semua —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">— Semua —</SelectItem>
                      {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.companyCode} — {c.companyName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><FolderOpen className="h-3 w-3" />Departemen</Label>
                  <Select value={form.departmentId || "__all__"} onValueChange={v => setForm(f => ({ ...f, departmentId: v === "__all__" ? "" : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Semua —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">— Semua —</SelectItem>
                      {filteredDepts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Globe className="h-3 w-3" />Currency</Label>
                  <Select value={form.currency || "__all__"} onValueChange={v => setForm(f => ({ ...f, currency: v === "__all__" ? "" : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Semua —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">— Semua Currency —</SelectItem>
                      {CURRENCY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Package className="h-3 w-3" />Vendor / Supplier</Label>
                  <Select value={form.vendorId || "__all__"} onValueChange={v => setForm(f => ({ ...f, vendorId: v === "__all__" ? "" : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Semua —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">— Semua Vendor —</SelectItem>
                      {filteredSuppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Levels */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Level Approval</div>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addLevel}>
                  <Plus className="h-3 w-3" /> Tambah Level
                </Button>
              </div>

              {form.levels.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">Belum ada level. Tambahkan minimal 1 level.</p>
              )}

              {form.levels.map((lv, idx) => {
                const colors = ["border-emerald-500/30", "border-blue-500/30", "border-amber-500/30", "border-rose-500/30", "border-purple-500/30"];
                const bc = colors[idx % colors.length];
                return (
                  <div key={idx} className={`rounded-lg border-l-4 ${bc} border border-border/50 p-3 space-y-2`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">{lv.level}</span>
                        <Input
                          value={lv.label}
                          onChange={e => updateLevel(idx, "label", e.target.value)}
                          placeholder="Label level (contoh: Supervisor)"
                          className="h-7 text-sm w-48"
                        />
                      </div>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeLevel(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Nominal Min (Rp)</Label>
                        <Input
                          type="number" min={0}
                          value={String(lv.minAmount ?? 0)}
                          onChange={e => updateLevel(idx, "minAmount", e.target.value)}
                          className="h-7 text-sm"
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Nominal Maks (Rp)</Label>
                        <Input
                          type="number" min={0}
                          value={lv.maxAmount !== null ? String(lv.maxAmount) : ""}
                          onChange={e => updateLevel(idx, "maxAmount", e.target.value === "" ? null : e.target.value)}
                          className="h-7 text-sm"
                          placeholder="kosong = tak terbatas"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Level Urutan</Label>
                        <Input
                          type="number" min={1}
                          value={lv.level}
                          onChange={e => updateLevel(idx, "level", Number(e.target.value))}
                          className="h-7 text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs flex items-center gap-1"><Shield className="h-3 w-3" />Role Approver</Label>
                        <Select
                          value={lv.approverRoleId ? String(lv.approverRoleId) : "__none__"}
                          onValueChange={v => updateLevel(idx, "approverRoleId", v === "__none__" ? null : v)}
                        >
                          <SelectTrigger className="h-7 text-sm"><SelectValue placeholder="— Pilih role —" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Tidak dipilih —</SelectItem>
                            {roles.map(r => (
                              <SelectItem key={r.id} value={String(r.id)}>
                                <span className="flex items-center gap-1.5">
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                                  {r.name}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs flex items-center gap-1"><User className="h-3 w-3" />Atau User Spesifik (ID)</Label>
                        <Input
                          value={lv.approverUserId ?? ""}
                          onChange={e => updateLevel(idx, "approverUserId", e.target.value || null)}
                          className="h-7 text-sm"
                          placeholder="User ID (opsional)"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Deskripsi</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Keterangan tambahan..."
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} id="matrix-active" />
              <Label htmlFor="matrix-active" className="text-sm cursor-pointer">Aktif</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || form.levels.length === 0 || saving}>
              {saving ? "Menyimpan..." : editMatrix ? "Simpan Perubahan" : "Buat Matrix"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Evaluate Dialog ────────────────────────────────────────────── */}
      <Dialog open={evalOpen} onOpenChange={setEvalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-primary" />
              Uji Approval Matrix
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Masukkan parameter transaksi untuk mengetahui level approval yang berlaku.</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Modul</Label>
                <Select value={evalForm.module} onValueChange={v => setEvalForm(f => ({ ...f, module: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {modules.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Currency</Label>
                <Select value={evalForm.currency || "__all__"} onValueChange={v => setEvalForm(f => ({ ...f, currency: v === "__all__" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">— Tidak spesifik —</SelectItem>
                    {CURRENCY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Departemen (opsional)</Label>
                <Select value={evalForm.departmentId || "__all__"} onValueChange={v => setEvalForm(f => ({ ...f, departmentId: v === "__all__" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Tidak spesifik —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">— Tidak spesifik —</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Vendor (opsional)</Label>
                <Select value={evalForm.vendorId || "__all__"} onValueChange={v => setEvalForm(f => ({ ...f, vendorId: v === "__all__" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Tidak spesifik —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">— Tidak spesifik —</SelectItem>
                    {suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Nominal Transaksi (Rp)</Label>
                <Input
                  type="number" min={0}
                  value={evalForm.amount}
                  onChange={e => setEvalForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="contoh: 75000000"
                  className="h-9"
                />
              </div>
            </div>

            <Button onClick={runEval} disabled={evalLoading} className="w-full gap-2">
              <FlaskConical className="h-4 w-4" />
              {evalLoading ? "Mengevaluasi..." : "Evaluasi Matrix"}
            </Button>

            {evalResult && (
              <div className="rounded-lg border p-4 space-y-3 mt-2">
                {!evalResult.matched ? (
                  <div className="text-center text-muted-foreground py-2">
                    <XCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Tidak ada Approval Matrix yang cocok dengan parameter ini.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="font-semibold text-sm">{evalResult.matrix?.name}</span>
                      <Badge variant="outline" className="text-xs">{moduleLabel(evalResult.matrix?.module ?? "")}</Badge>
                    </div>
                    {evalResult.requiredLevels.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nominal di luar rentang semua level yang terdefinisi.</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Level approval yang diperlukan untuk nominal {IDR(Number(evalForm.amount))}:</p>
                        {evalResult.requiredLevels.map((lv, i) => (
                          <LevelBar key={i} level={lv} total={evalResult.requiredLevels.length} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ─────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Matrix "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Semua level dalam matrix ini akan ikut terhapus. Tindakan ini tidak dapat diurungkan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
