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
import { ArrowLeft, GitMerge, Plus, Pencil, Trash2, Building2, GitBranch, LayoutList, FolderOpen, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "wouter";

const MODULE_LABELS: Record<string, string> = {
  purchase_request: "Purchase Request",
  purchase_order:   "Purchase Order",
  rfq:              "RFQ",
  sales_order:      "Sales Order",
  expense:          "Pengeluaran",
  inventory_transfer: "Transfer Inventori",
  general:          "Umum",
};

const SCOPE_LABELS: Record<string, string> = {
  company:    "Perusahaan",
  branch:     "Cabang",
  division:   "Divisi",
  department: "Departemen",
};

interface Company { id: number; companyName: string; companyCode: string }
interface Branch  { id: number; companyId: number; name: string; code?: string }
interface Division { id: number; companyId: number; name: string; code?: string }
interface Department { id: number; companyId: number; divisionId?: number | null; name: string; code?: string }
interface CustomRole { id: number; name: string; color: string }

interface ApprovalRule {
  id: number;
  name: string;
  module: string;
  scope: string;
  company_id: number | null;
  branch_id: number | null;
  division_id: number | null;
  department_id: number | null;
  amount_threshold: string | null;
  approver_role_id: number | null;
  approver_user_id: string | null;
  level: number;
  description: string | null;
  is_active: boolean;
  company_name?: string;
  branch_name?: string;
  division_name?: string;
  department_name?: string;
  approver_role_name?: string;
  approver_role_color?: string;
  approver_user_name?: string;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const emptyForm = {
  name: "",
  module: "general",
  scope: "company",
  companyId: "",
  branchId: "",
  divisionId: "",
  departmentId: "",
  amountThreshold: "",
  approverRoleId: "",
  approverUserId: "",
  level: "1",
  description: "",
  isActive: true,
};

function ActiveBadge({ active }: { active: boolean }) {
  return active
    ? <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20"><CheckCircle2 className="h-3 w-3 mr-1" />Aktif</Badge>
    : <Badge variant="secondary" className="text-xs"><XCircle className="h-3 w-3 mr-1" />Nonaktif</Badge>;
}

export default function SettingsApprovalRulesPage() {
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRule, setEditRule] = useState<ApprovalRule | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApprovalRule | null>(null);

  const [moduleFilter, setModuleFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = moduleFilter !== "all" ? `/approval-rules?module=${moduleFilter}` : "/approval-rules";
      const data = await apiFetch(url);
      setRules(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [moduleFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiFetch("/companies").then(setCompanies).catch(() => {});
    apiFetch("/org/branches?companyId=all").then(setBranches).catch(() => {});
    apiFetch("/org/divisions?companyId=all").then(setDivisions).catch(() => {});
    apiFetch("/org/departments?companyId=all").then(setDepartments).catch(() => {});
    apiFetch("/custom-roles").then(setRoles).catch(() => {});
  }, []);

  const filteredBranches = branches.filter(b => !form.companyId || b.companyId === Number(form.companyId));
  const filteredDivisions = divisions.filter(d => !form.companyId || d.companyId === Number(form.companyId));
  const filteredDepartments = departments.filter(d =>
    (!form.companyId || d.companyId === Number(form.companyId)) &&
    (!form.divisionId || d.divisionId === Number(form.divisionId))
  );

  const openAdd = () => {
    setEditRule(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (rule: ApprovalRule) => {
    setEditRule(rule);
    setForm({
      name: rule.name,
      module: rule.module,
      scope: rule.scope,
      companyId: rule.company_id ? String(rule.company_id) : "",
      branchId: rule.branch_id ? String(rule.branch_id) : "",
      divisionId: rule.division_id ? String(rule.division_id) : "",
      departmentId: rule.department_id ? String(rule.department_id) : "",
      amountThreshold: rule.amount_threshold ?? "",
      approverRoleId: rule.approver_role_id ? String(rule.approver_role_id) : "",
      approverUserId: rule.approver_user_id ?? "",
      level: String(rule.level),
      description: rule.description ?? "",
      isActive: rule.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        module: form.module,
        scope: form.scope,
        companyId: form.companyId ? Number(form.companyId) : null,
        branchId: form.branchId ? Number(form.branchId) : null,
        divisionId: form.divisionId ? Number(form.divisionId) : null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        amountThreshold: form.amountThreshold || null,
        approverRoleId: form.approverRoleId ? Number(form.approverRoleId) : null,
        approverUserId: form.approverUserId || null,
        level: Number(form.level) || 1,
        description: form.description || null,
        isActive: form.isActive,
      };
      if (editRule) {
        await apiFetch(`/approval-rules/${editRule.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/approval-rules", { method: "POST", body: JSON.stringify(payload) });
      }
      setDialogOpen(false);
      await load();
    } catch (e: any) {
      alert("Gagal menyimpan: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/approval-rules/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      alert("Gagal menghapus: " + e.message);
    }
  };

  const scopeIcon = (s: string) => ({ company: "🏢", branch: "🏪", division: "📂", department: "👥" }[s] ?? "🔲");

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitMerge className="h-7 w-7 text-primary" />
            <div>
              <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

              <h1 className="text-2xl font-bold">Aturan Approval</h1>
              <p className="text-sm text-muted-foreground">Konfigurasi alur persetujuan berdasarkan scope organisasi dan nominal</p>
            </div>
          </div>
          <Button onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" /> Tambah Aturan
          </Button>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-destructive text-sm">{error}</div>
        )}

        {/* Filter bar */}
        <div className="flex gap-3 flex-wrap items-center">
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter modul..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Modul</SelectItem>
              {Object.entries(MODULE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{rules.length} aturan</span>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Level</TableHead>
                <TableHead>Nama Aturan</TableHead>
                <TableHead>Modul</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Maks. Nominal</TableHead>
                <TableHead>Approver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Memuat...</TableCell></TableRow>
              ) : rules.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  <GitMerge className="h-10 w-10 mx-auto mb-2 opacity-20" />
                  Belum ada aturan approval. Klik "Tambah Aturan" untuk mulai.
                </TableCell></TableRow>
              ) : rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">{rule.level}</span>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{rule.name}</div>
                    {rule.description && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{rule.description}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{MODULE_LABELS[rule.module] ?? rule.module}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{scopeIcon(rule.scope)} {SCOPE_LABELS[rule.scope] ?? rule.scope}</div>
                    <div className="text-xs text-muted-foreground">
                      {rule.division_name && `${rule.division_name}`}
                      {rule.department_name && ` · ${rule.department_name}`}
                      {rule.branch_name && !rule.division_name && rule.branch_name}
                      {rule.company_name && !rule.division_name && !rule.branch_name && rule.company_name}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {rule.amount_threshold
                      ? `Rp ${Number(rule.amount_threshold).toLocaleString("id-ID")}`
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {rule.approver_role_name ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: rule.approver_role_color ?? "#6366f1" }} />
                        {rule.approver_role_name}
                      </span>
                    ) : rule.approver_user_name ? (
                      <span className="text-xs">{rule.approver_user_name}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell><ActiveBadge active={rule.is_active} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(rule)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(rule)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRule ? "Edit Aturan" : "Tambah Aturan Approval"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Nama Aturan *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="contoh: Approve Purchase Warehouse" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Modul</Label>
                <Select value={form.module} onValueChange={v => setForm(f => ({ ...f, module: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MODULE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Level Urutan</Label>
                <Input type="number" min={1} max={10} value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value }))} className="h-8 text-sm" placeholder="1" />
              </div>
            </div>

            {/* Scope */}
            <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Scope Organisasi</div>
              <div className="space-y-1.5">
                <Label className="text-xs">Scope</Label>
                <Select value={form.scope} onValueChange={v => setForm(f => ({
                  ...f, scope: v, branchId: "", divisionId: "", departmentId: "",
                }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCOPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" />Perusahaan</Label>
                <Select value={form.companyId || "__all__"} onValueChange={v => setForm(f => ({ ...f, companyId: v === "__all__" ? "" : v, branchId: "", divisionId: "", departmentId: "" }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Semua —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">— Semua —</SelectItem>
                    {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.companyCode} — {c.companyName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {(form.scope === "branch" || form.scope === "division" || form.scope === "department") && (
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><GitBranch className="h-3 w-3" />Cabang</Label>
                  <Select value={form.branchId || "__none__"} onValueChange={v => setForm(f => ({ ...f, branchId: v === "__none__" ? "" : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Pilih —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Tidak dipilih —</SelectItem>
                      {filteredBranches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(form.scope === "division" || form.scope === "department") && (
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><LayoutList className="h-3 w-3" />Divisi</Label>
                  <Select value={form.divisionId || "__none__"} onValueChange={v => setForm(f => ({ ...f, divisionId: v === "__none__" ? "" : v, departmentId: "" }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Pilih —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Tidak dipilih —</SelectItem>
                      {filteredDivisions.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.scope === "department" && (
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><FolderOpen className="h-3 w-3" />Departemen</Label>
                  <Select value={form.departmentId || "__none__"} onValueChange={v => setForm(f => ({ ...f, departmentId: v === "__none__" ? "" : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Pilih —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Tidak dipilih —</SelectItem>
                      {filteredDepartments.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Approver & Amount */}
            <div className="space-y-1.5">
              <Label className="text-xs">Maks. Nominal (Rp) — opsional</Label>
              <Input
                type="number"
                value={form.amountThreshold}
                onChange={e => setForm(f => ({ ...f, amountThreshold: e.target.value }))}
                placeholder="contoh: 5000000"
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">Biarkan kosong = berlaku untuk semua nominal</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Role Approver</Label>
              <Select value={form.approverRoleId || "__none__"} onValueChange={v => setForm(f => ({ ...f, approverRoleId: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Pilih role —" /></SelectTrigger>
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

            <div className="space-y-1.5">
              <Label className="text-xs">Deskripsi</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Deskripsi aturan ini..."
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
                id="rule-active"
              />
              <Label htmlFor="rule-active" className="text-sm cursor-pointer">Aktif</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || saving}>
              {saving ? "Menyimpan..." : editRule ? "Simpan Perubahan" : "Buat Aturan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Aturan "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Aturan ini akan dihapus permanen.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
