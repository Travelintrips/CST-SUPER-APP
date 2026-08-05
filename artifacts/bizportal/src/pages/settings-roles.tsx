import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ShieldCheck, Plus, Pencil, Trash2, Users, UserPlus, X, ChevronRight,
  Building2, GitBranch, Eye, PenLine, PlusCircle, Trash, Lock,
  RotateCcw, Shield, CheckSquare, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

// ─── Custom Roles constants ────────────────────────────────────────────────────

const MODULES = [
  { key: "dashboard",       label: "Dashboard",          group: "Menu Utama" },
  { key: "pos-products",    label: "Produk & Recipe/BOM", group: "Menu Utama" },
  { key: "users-role",      label: "User & Role",         group: "Menu Utama" },
  { key: "reports",         label: "Laporan",             group: "Menu Utama" },
  { key: "settings",        label: "Settings",            group: "Menu Utama" },
  { key: "sales",           label: "Penjualan",           group: "Modul ERP" },
  { key: "purchase",        label: "Pembelian",           group: "Modul ERP" },
  { key: "accounting",      label: "Akuntansi",           group: "Modul ERP" },
  { key: "logistics",       label: "Logistik",            group: "Modul ERP" },
  { key: "trading",         label: "Trading",             group: "Modul ERP" },
  { key: "expense",         label: "Pengeluaran",         group: "Modul ERP" },
  { key: "correspondences", label: "Korespondensi",       group: "Lainnya" },
  { key: "media",           label: "Media Manager",       group: "Lainnya" },
  { key: "holding",         label: "Holding",             group: "Lainnya" },
];

const CRUD_ACTIONS = [
  { key: "view",   label: "Lihat",  icon: Eye },
  { key: "create", label: "Buat",   icon: PlusCircle },
  { key: "edit",   label: "Edit",   icon: PenLine },
  { key: "delete", label: "Hapus",  icon: Trash },
] as const;

type CrudAction = typeof CRUD_ACTIONS[number]["key"];

const MODULE_GROUPS = Array.from(new Set(MODULES.map((m) => m.group)));

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
];

const ROLE_TEMPLATES: Record<string, { label: string; permissions: string[] }> = {};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin", owner: "Owner", manager: "Manager",
  ecommerce: "Ecommerce", trading: "Trading", logistics: "Logistik",
};

const SCOPE_OPTIONS = [
  { value: "all_companies",   label: "Semua Perusahaan",   icon: "🌐" },
  { value: "company_only",    label: "Perusahaan Sendiri", icon: "🏢" },
  { value: "branch_only",     label: "Cabang Sendiri",     icon: "🏪" },
  { value: "division_only",   label: "Divisi Sendiri",     icon: "📂" },
  { value: "department_only", label: "Departemen Sendiri", icon: "👥" },
];

// ─── RBAC System constants ─────────────────────────────────────────────────────

const RBAC_ROLES = [
  { key: "super_admin", label: "Super Admin", color: "#7c3aed", locked: true },
  { key: "admin",       label: "Admin",       color: "#3b82f6", locked: false },
  { key: "sales",       label: "Sales",       color: "#10b981", locked: false },
  { key: "operations",  label: "Operations",  color: "#f59e0b", locked: false },
  { key: "finance",     label: "Finance",     color: "#ef4444", locked: false },
  { key: "vendor",      label: "Vendor",      color: "#6366f1", locked: false },
  { key: "driver",      label: "Driver",      color: "#14b8a6", locked: false },
  { key: "customer",    label: "Customer",    color: "#ec4899", locked: false },
];

const RBAC_MODULES = [
  { key: "rfq",               label: "RFQ" },
  { key: "invoice",           label: "Invoice" },
  { key: "purchase",          label: "Purchase" },
  { key: "customer_approval", label: "Cust. Approval" },
  { key: "pod",               label: "POD" },
  { key: "templates",         label: "Templates" },
  { key: "settings",          label: "Settings" },
];

const RBAC_ACTIONS = [
  { key: "view",    label: "Lihat",   short: "L", color: "#3b82f6" },
  { key: "create",  label: "Buat",    short: "B", color: "#10b981" },
  { key: "edit",    label: "Edit",    short: "E", color: "#f59e0b" },
  { key: "approve", label: "Setuju",  short: "S", color: "#8b5cf6" },
  { key: "delete",  label: "Hapus",   short: "H", color: "#ef4444" },
];

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Company   { id: number; companyName: string; companyCode: string }
interface Branch    { id: number; companyId: number; name: string; code?: string }
interface Division  { id: number; companyId: number; name: string; code?: string }
interface Department { id: number; companyId: number; divisionId?: number | null; name: string; code?: string }

interface CustomRole {
  id: number; name: string; description: string | null; color: string;
  permissions: string[]; user_count: number; scope_type: string | null;
  company_id: number | null; branch_id: number | null; division_id: number | null;
  department_id: number | null; company_name?: string; branch_name?: string;
  division_name?: string; department_name?: string;
}

interface RoleUser {
  id: string; email: string; name: string; role: string;
  division: string | null; company_name?: string; branch_name?: string;
  division_name?: string; department_name?: string;
}

interface AllUser       { id: string; email: string; name: string; role: string }
interface RbacUser      { id: string; email: string; name: string; role: string; system_role: string | null; company_name?: string }

interface RbacMatrix {
  roles: string[];
  modules: string[];
  actions: string[];
  matrix: Record<string, Record<string, string[]>>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

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
  name: "", description: "", color: "#6366f1", permissions: [] as string[],
  scopeType: "company_only", companyId: "" as string,
  branchId: "" as string, divisionId: "" as string, departmentId: "" as string,
};

function hasPerm(permissions: string[], moduleKey: string, action: CrudAction): boolean {
  return (
    permissions.includes(`${moduleKey}:${action}`) ||
    (action === "view" && permissions.includes(moduleKey))
  );
}

function togglePerm(permissions: string[], moduleKey: string, action: CrudAction): string[] {
  const key = `${moduleKey}:${action}`;
  if (permissions.includes(key)) {
    if (action === "view") return permissions.filter((p) => !p.startsWith(`${moduleKey}:`));
    return permissions.filter((p) => p !== key);
  } else {
    const next = [...permissions, key];
    if (action !== "view" && !next.includes(`${moduleKey}:view`)) next.push(`${moduleKey}:view`);
    return next;
  }
}

function toggleAllModule(permissions: string[], moduleKey: string): string[] {
  const allKeys = CRUD_ACTIONS.map((a) => `${moduleKey}:${a.key}`);
  const hasAll  = allKeys.every((k) => permissions.includes(k));
  if (hasAll) return permissions.filter((p) => !p.startsWith(`${moduleKey}:`) && p !== moduleKey);
  const without = permissions.filter((p) => !p.startsWith(`${moduleKey}:`) && p !== moduleKey);
  return [...without, ...allKeys];
}

// ═══════════════════════════════════════════════════════════════════════════════
// RBAC Matrix Tab
// ═══════════════════════════════════════════════════════════════════════════════

function RbacMatrixTab() {
  const [data, setData]         = useState<RbacMatrix | null>(null);
  const [loading, setLoading]   = useState(true);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [resetting, setResetting] = useState(false);
  const [users, setUsers]       = useState<RbacUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [savingUser, setSavingUser] = useState<string | null>(null);

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch("/rbac/matrix");
      setData(d);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const d = await apiFetch("/rbac/users");
      setUsers(d);
    } catch {}
    setUsersLoading(false);
  }, []);

  useEffect(() => { loadMatrix(); loadUsers(); }, [loadMatrix, loadUsers]);

  const handleToggle = async (roleName: string, module: string, action: string) => {
    const key = `${roleName}:${module}:${action}`;
    setToggling((t) => new Set([...t, key]));
    try {
      const result = await apiFetch("/rbac/matrix/toggle", {
        method: "POST",
        body: JSON.stringify({ roleName, module, action }),
      });
      setData((prev) => {
        if (!prev) return prev;
        const newMatrix = JSON.parse(JSON.stringify(prev.matrix));
        const current: string[] = newMatrix[roleName]?.[module] ?? [];
        if (result.granted) {
          if (!current.includes(action)) newMatrix[roleName][module] = [...current, action];
        } else {
          newMatrix[roleName][module] = current.filter((a: string) => a !== action);
        }
        return { ...prev, matrix: newMatrix };
      });
    } catch (e: any) {
      alert("Gagal mengubah perizinan: " + e.message);
    } finally {
      setToggling((t) => { const n = new Set(t); n.delete(key); return n; });
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset semua perizinan ke default? Perubahan manual akan hilang.")) return;
    setResetting(true);
    try {
      await apiFetch("/rbac/matrix/reset", { method: "POST" });
      await loadMatrix();
    } catch (e: any) {
      alert("Gagal reset: " + e.message);
    } finally {
      setResetting(false);
    }
  };

  const handleUserRoleChange = async (userId: string, systemRole: string) => {
    setSavingUser(userId);
    try {
      await apiFetch(`/rbac/users/${userId}/system-role`, {
        method: "PUT",
        body: JSON.stringify({ systemRole: systemRole === "__none__" ? null : systemRole }),
      });
      setUsers((prev) =>
        prev.map((u) => u.id === userId
          ? { ...u, system_role: systemRole === "__none__" ? null : systemRole }
          : u,
        ),
      );
    } catch (e: any) {
      alert("Gagal mengubah role: " + e.message);
    } finally {
      setSavingUser(null);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <div className="inline-block h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm">Memuat matrix perizinan...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-16 text-center text-destructive text-sm">
        Gagal memuat matrix. Coba refresh halaman.
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* Matrix header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Matrix Perizinan Sistem</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Klik checkbox untuk mengaktifkan/menonaktifkan akses. Super Admin selalu memiliki semua akses (tidak dapat diubah).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={handleReset}
          disabled={resetting}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {resetting ? "Mereset..." : "Reset ke Default"}
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px]">
        {RBAC_ACTIONS.map((a) => (
          <div key={a.key} className="flex items-center gap-1">
            <span
              className="inline-flex items-center justify-center h-4 w-4 rounded text-white font-bold text-[9px]"
              style={{ backgroundColor: a.color }}
            >
              {a.short}
            </span>
            <span className="text-muted-foreground">{a.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 ml-2">
          <Lock className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Terkunci (Super Admin)</span>
        </div>
      </div>

      {/* Permission Matrix Table */}
      <div className="rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              {/* Row 1: Module headers */}
              <tr>
                <th
                  className="sticky left-0 z-20 bg-muted border-b border-r px-3 py-2.5 text-left font-semibold min-w-[140px]"
                  rowSpan={2}
                >
                  Role
                </th>
                {RBAC_MODULES.map((mod) => (
                  <th
                    key={mod.key}
                    colSpan={RBAC_ACTIONS.length}
                    className="bg-muted/70 border-b border-r px-2 py-2 text-center font-semibold whitespace-nowrap"
                  >
                    {mod.label}
                  </th>
                ))}
              </tr>
              {/* Row 2: Action sub-headers */}
              <tr>
                {RBAC_MODULES.map((mod) =>
                  RBAC_ACTIONS.map((act) => (
                    <th
                      key={`${mod.key}:${act.key}`}
                      className="bg-muted/40 border-b border-r px-0 py-1.5 text-center w-8"
                      title={act.label}
                    >
                      <span
                        className="inline-flex items-center justify-center h-4 w-4 mx-auto rounded text-white font-bold text-[9px]"
                        style={{ backgroundColor: act.color }}
                      >
                        {act.short}
                      </span>
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {RBAC_ROLES.map((role, ri) => (
                <tr
                  key={role.key}
                  className={ri % 2 === 0 ? "bg-background" : "bg-muted/10"}
                >
                  {/* Role label cell */}
                  <td className="sticky left-0 z-10 border-r border-b px-3 py-2 font-medium bg-inherit">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-6 w-6 rounded-md flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
                        style={{ backgroundColor: role.color }}
                      >
                        {role.label.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="whitespace-nowrap">{role.label}</span>
                      {role.locked && (
                        <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                  </td>

                  {/* Permission cells */}
                  {RBAC_MODULES.map((mod) =>
                    RBAC_ACTIONS.map((act) => {
                      const cellKey = `${role.key}:${mod.key}:${act.key}`;
                      const hasIt   = data.matrix[role.key]?.[mod.key]?.includes(act.key) ?? false;
                      const isBusy  = toggling.has(cellKey);

                      return (
                        <td key={cellKey} className="border-r border-b p-0 text-center">
                          <div className="flex items-center justify-center h-9 w-8 mx-auto">
                            {role.locked ? (
                              <CheckSquare className="h-3.5 w-3.5 text-muted-foreground/60" />
                            ) : isBusy ? (
                              <div className="h-3.5 w-3.5 border border-primary border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Checkbox
                                checked={hasIt}
                                onCheckedChange={() => handleToggle(role.key, mod.key, act.key)}
                                className="h-3.5 w-3.5"
                              />
                            )}
                          </div>
                        </td>
                      );
                    }),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User → System Role Assignment */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Penetapan Role Sistem ke Pengguna</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Tetapkan setiap pengguna ke salah satu dari 8 role sistem di atas.
        </p>

        {usersLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Memuat pengguna...</div>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="px-4 py-2.5 text-left font-semibold text-xs">Pengguna</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-xs">Email</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-xs">Perusahaan</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-xs">Role Sistem</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((u) => {
                  const role = RBAC_ROLES.find((r) => r.key === u.system_role);
                  return (
                    <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-sm">{u.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{u.role}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {u.company_name ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {role && (
                            <div
                              className="h-2 w-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: role.color }}
                            />
                          )}
                          <Select
                            value={u.system_role ?? "__none__"}
                            onValueChange={(v) => handleUserRoleChange(u.id, v)}
                            disabled={savingUser === u.id}
                          >
                            <SelectTrigger className="h-7 text-xs w-40">
                              <SelectValue placeholder="Pilih role..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">
                                <span className="text-muted-foreground">— Tidak ada —</span>
                              </SelectItem>
                              {RBAC_ROLES.map((r) => (
                                <SelectItem key={r.key} value={r.key}>
                                  <div className="flex items-center gap-1.5">
                                    <div
                                      className="h-2 w-2 rounded-full"
                                      style={{ backgroundColor: r.color }}
                                    />
                                    {r.label}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {savingUser === u.id && (
                            <div className="h-3.5 w-3.5 border border-primary border-t-transparent rounded-full animate-spin" />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Tidak ada pengguna ditemukan
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function SettingsRolesPage() {
  const [roles, setRoles]             = useState<CustomRole[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [companies, setCompanies]     = useState<Company[]>([]);
  const [branches, setBranches]       = useState<Branch[]>([]);
  const [divisions, setDivisions]     = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editRole, setEditRole]       = useState<CustomRole | null>(null);
  const [form, setForm]               = useState(emptyForm);
  const [saving, setSaving]           = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomRole | null>(null);
  const [deleting, setDeleting]       = useState(false);
  const [selectedRole, setSelectedRole] = useState<CustomRole | null>(null);
  const [roleUsers, setRoleUsers]     = useState<RoleUser[]>([]);
  const [allUsers, setAllUsers]       = useState<AllUser[]>([]);
  const [assignUserId, setAssignUserId] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);

  const loadRoles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch("/custom-roles");
      setRoles(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  useEffect(() => {
    apiFetch("/companies").then(setCompanies).catch(() => {});
    apiFetch("/org/branches?companyId=all").then(setBranches).catch(() => {});
    apiFetch("/org/divisions?companyId=all").then(setDivisions).catch(() => {});
    apiFetch("/org/departments?companyId=all").then(setDepartments).catch(() => {});
  }, []);

  const filteredBranches   = branches.filter((b) => !form.companyId || b.companyId === Number(form.companyId));
  const filteredDivisions  = divisions.filter((d) => !form.companyId || d.companyId === Number(form.companyId));
  const filteredDepartments = departments.filter((d) =>
    (!form.companyId || d.companyId === Number(form.companyId)) &&
    (!form.divisionId || d.divisionId === Number(form.divisionId)),
  );

  const loadAllUsers = useCallback(async () => {
    try {
      const data = await apiFetch("/users");
      setAllUsers(data);
    } catch {}
  }, []);

  const openRoleUsers = useCallback(async (role: CustomRole) => {
    setSelectedRole(role);
    setUsersLoading(true);
    try {
      const data = await apiFetch(`/custom-roles/${role.id}`);
      setRoleUsers(data.users ?? []);
    } catch {}
    setUsersLoading(false);
    await loadAllUsers();
  }, [loadAllUsers]);

  const openAdd  = () => { setEditRole(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (role: CustomRole) => {
    setEditRole(role);
    setForm({
      name: role.name, description: role.description ?? "", color: role.color,
      permissions: [...role.permissions], scopeType: role.scope_type ?? "company_only",
      companyId:    role.company_id    ? String(role.company_id)    : "",
      branchId:     role.branch_id     ? String(role.branch_id)     : "",
      divisionId:   role.division_id   ? String(role.division_id)   : "",
      departmentId: role.department_id ? String(role.department_id) : "",
    });
    setDialogOpen(true);
  };

  const applyTemplate = (templateKey: string) => {
    const tpl = ROLE_TEMPLATES[templateKey];
    if (!tpl) return;
    setForm((f) => ({ ...f, permissions: tpl.permissions }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name, description: form.description, color: form.color,
        permissions: form.permissions, scopeType: form.scopeType,
        companyId:    form.companyId    ? Number(form.companyId)    : null,
        branchId:     form.branchId     ? Number(form.branchId)     : null,
        divisionId:   form.divisionId   ? Number(form.divisionId)   : null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
      };
      if (editRole) {
        await apiFetch(`/custom-roles/${editRole.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/custom-roles", { method: "POST", body: JSON.stringify(payload) });
      }
      setDialogOpen(false);
      await loadRoles();
    } catch (e: any) {
      alert("Gagal menyimpan: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/custom-roles/${deleteTarget.id}`, { method: "DELETE" });
      if (selectedRole?.id === deleteTarget.id) setSelectedRole(null);
      await loadRoles();
      setDeleteTarget(null);
    } catch (e: any) {
      alert("Gagal menghapus: " + e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedRole || !assignUserId) return;
    try {
      await apiFetch(`/custom-roles/${selectedRole.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ userId: assignUserId }),
      });
      setAssignUserId("");
      await openRoleUsers(selectedRole);
      await loadRoles();
    } catch (e: any) {
      alert("Gagal: " + e.message);
    }
  };

  const handleUnassign = async (userId: string) => {
    if (!selectedRole) return;
    try {
      await apiFetch(`/custom-roles/${selectedRole.id}/assign/${userId}`, { method: "DELETE" });
      await openRoleUsers(selectedRole);
      await loadRoles();
    } catch (e: any) {
      alert("Gagal: " + e.message);
    }
  };

  const unassignedUsers = allUsers.filter((u) => !roleUsers.find((ru) => ru.id === u.id));
  const scopeLabel      = (s: string | null) => SCOPE_OPTIONS.find((o) => o.value === s)?.label ?? s ?? "—";
  const scopeIcon       = (s: string | null) => SCOPE_OPTIONS.find((o) => o.value === s)?.icon ?? "🔲";
  const needsBranch     = ["branch_only"].includes(form.scopeType);
  const needsDivision   = ["division_only", "department_only"].includes(form.scopeType);
  const needsDepartment = form.scopeType === "department_only";

  const permSummary = (perms: string[]) =>
    MODULES.filter((m) => perms.some((p) => p.startsWith(`${m.key}:`) || p === m.key));

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">

        {/* Page Header */}
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <div>
            <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold">Manajemen Role & Perizinan</h1>
            <p className="text-sm text-muted-foreground">
              Atur matrix perizinan sistem dan kelola role kustom per pengguna
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="matrix">
          <TabsList className="mb-2">
            <TabsTrigger value="matrix" className="gap-2">
              <ShieldCheck className="h-4 w-4" /> Matrix Perizinan
            </TabsTrigger>
            <TabsTrigger value="custom" className="gap-2">
              <Users className="h-4 w-4" /> Role Kustom
            </TabsTrigger>
          </TabsList>

          {/* ── Tab 1: RBAC Matrix ──────────────────────────────────────────── */}
          <TabsContent value="matrix" className="mt-4">
            <RbacMatrixTab />
          </TabsContent>

          {/* ── Tab 2: Custom Roles ─────────────────────────────────────────── */}
          <TabsContent value="custom" className="mt-4 space-y-6">

            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Role Kustom</h2>
                <p className="text-sm text-muted-foreground">Buat role kustom dengan permission per menu (Lihat / Buat / Edit / Hapus)</p>
              </div>
              <Button onClick={openAdd} className="gap-2">
                <Plus className="h-4 w-4" /> Tambah Role
              </Button>
            </div>

            {/* Built-in roles reference */}
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Role Bawaan Sistem</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {[
                  { role: "kasir",   desc: "Dashboard + POS Kasir",               color: "#6366f1" },
                  { role: "gudang",  desc: "Inventory saja",                       color: "#14b8a6" },
                  { role: "manager", desc: "Dashboard, POS, Inventory, Laporan",   color: "#f97316" },
                  { role: "admin",   desc: "Semua menu dalam company",             color: "#3b82f6" },
                  { role: "owner",   desc: "Semua menu",                           color: "#ec4899" },
                ].map((r) => (
                  <div key={r.role} className="rounded-md border bg-background p-2.5 text-center">
                    <div className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white text-xs font-bold mb-1" style={{ backgroundColor: r.color }}>
                      {r.role.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="text-xs font-semibold capitalize">{r.role}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{r.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-destructive text-sm">{error}</div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Role List */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Role Kustom ({roles.length})</p>
                {loading ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">Memuat...</div>
                ) : roles.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
                    <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Belum ada role kustom. Klik "Tambah Role" untuk mulai.</p>
                  </div>
                ) : (
                  roles.map((role) => {
                    const summary = permSummary(role.permissions);
                    return (
                      <div
                        key={role.id}
                        className={`rounded-xl border bg-card p-4 cursor-pointer transition-all hover:shadow-md ${selectedRole?.id === role.id ? "ring-2 ring-primary" : ""}`}
                        onClick={() => openRoleUsers(role)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-9 w-9 rounded-lg flex-shrink-0 flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: role.color }}>
                              {role.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold truncate">{role.name}</div>
                              {role.description && (
                                <div className="text-xs text-muted-foreground truncate">{role.description}</div>
                              )}
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-xs">{scopeIcon(role.scope_type)}</span>
                                <span className="text-xs text-muted-foreground">{scopeLabel(role.scope_type)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(role); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(role); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex flex-wrap gap-1">
                            {summary.slice(0, 4).map((m) => {
                              const actions = CRUD_ACTIONS.filter((a) => hasPerm(role.permissions, m.key, a.key));
                              return (
                                <Badge key={m.key} variant="secondary" className="text-xs py-0 gap-1">
                                  {m.label}
                                  <span className="text-muted-foreground">{actions.map((a) => a.label[0]).join("")}</span>
                                </Badge>
                              );
                            })}
                            {summary.length > 4 && (
                              <Badge variant="outline" className="text-xs py-0">+{summary.length - 4} lagi</Badge>
                            )}
                            {summary.length === 0 && (
                              <span className="text-xs text-muted-foreground italic">Tidak ada akses</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                            <Users className="h-3.5 w-3.5" />
                            {role.user_count} pengguna
                            <ChevronRight className="h-3.5 w-3.5" />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Users Panel */}
              {selectedRole ? (
                <div className="rounded-xl border bg-card p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-md flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: selectedRole.color }}>
                      {selectedRole.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="font-semibold text-sm">Pengguna — {selectedRole.name}</h2>
                      <p className="text-xs text-muted-foreground">{scopeIcon(selectedRole.scope_type)} {scopeLabel(selectedRole.scope_type)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Select value={assignUserId} onValueChange={setAssignUserId}>
                      <SelectTrigger className="flex-1 h-8 text-sm">
                        <SelectValue placeholder="Pilih pengguna untuk ditambahkan..." />
                      </SelectTrigger>
                      <SelectContent>
                        {unassignedUsers.length === 0
                          ? <SelectItem value="_" disabled>Semua pengguna sudah di role ini</SelectItem>
                          : unassignedUsers.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.name || u.email} <span className="text-muted-foreground text-xs">({ROLE_LABELS[u.role] ?? u.role})</span>
                              </SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={handleAssign} disabled={!assignUserId} className="gap-1 h-8">
                      <UserPlus className="h-3.5 w-3.5" /> Tambah
                    </Button>
                  </div>
                  {usersLoading ? (
                    <div className="text-sm text-muted-foreground text-center py-4">Memuat...</div>
                  ) : roleUsers.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                      <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Belum ada pengguna di role ini</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {roleUsers.map((u) => (
                        <div key={u.id} className="flex items-center justify-between p-2 rounded-lg border bg-background">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{u.name || u.email}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {u.email}
                              {u.division_name  && ` · ${u.division_name}`}
                              {u.department_name && ` · ${u.department_name}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <Badge variant="outline" className="text-xs">{ROLE_LABELS[u.role] ?? u.role}</Badge>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleUnassign(u.id)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-10 flex flex-col items-center justify-center text-center text-muted-foreground">
                  <Users className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">Pilih role di kiri untuk mengelola pengguna</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Add / Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editRole ? "Edit Role" : "Tambah Role Baru"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Nama Role <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="contoh: Staf Gudang"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Warna</Label>
                  <div className="flex gap-2 flex-wrap pt-1">
                    {COLORS.map((c) => (
                      <button
                        key={c} type="button"
                        className={`h-7 w-7 rounded-full border-2 transition-transform ${form.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setForm((f) => ({ ...f, color: c }))}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Deskripsi</Label>
                <Textarea
                  placeholder="Deskripsi singkat tentang role ini..."
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Template Cepat</Label>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(ROLE_TEMPLATES).map(([key, tpl]) => (
                    <Button key={key} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyTemplate(key)}>
                      Terapkan preset {tpl.label}
                    </Button>
                  ))}
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setForm((f) => ({ ...f, permissions: [] }))}>
                    Hapus semua
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> Scope Akses Data
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipe Scope</Label>
                  <Select value={form.scopeType} onValueChange={(v) => setForm((f) => ({ ...f, scopeType: v, branchId: "", divisionId: "", departmentId: "" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SCOPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.icon} {o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" />Perusahaan</Label>
                    <Select value={form.companyId || "__all__"} onValueChange={(v) => setForm((f) => ({ ...f, companyId: v === "__all__" ? "" : v, branchId: "", divisionId: "", departmentId: "" }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Semua / Pilih..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Semua perusahaan</SelectItem>
                        {companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.companyName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {needsBranch && (
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1"><GitBranch className="h-3 w-3" />Cabang</Label>
                      <Select value={form.branchId || "__all__"} onValueChange={(v) => setForm((f) => ({ ...f, branchId: v === "__all__" ? "" : v }))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pilih cabang..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">Semua cabang</SelectItem>
                          {filteredBranches.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {needsDivision && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Divisi</Label>
                      <Select value={form.divisionId || "__all__"} onValueChange={(v) => setForm((f) => ({ ...f, divisionId: v === "__all__" ? "" : v, departmentId: "" }))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pilih divisi..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">Semua divisi</SelectItem>
                          {filteredDivisions.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {needsDepartment && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Departemen</Label>
                      <Select value={form.departmentId || "__all__"} onValueChange={(v) => setForm((f) => ({ ...f, departmentId: v === "__all__" ? "" : v }))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pilih departemen..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">Semua departemen</SelectItem>
                          {filteredDepartments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>

              {/* Permission Matrix */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Permission Menu</Label>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {CRUD_ACTIONS.map((a) => (
                      <span key={a.key} className="flex items-center gap-1">
                        <a.icon size={11} /> {a.label}
                      </span>
                    ))}
                  </div>
                </div>
                {MODULE_GROUPS.map((group) => {
                  const groupModules = MODULES.filter((m) => m.group === group);
                  return (
                    <div key={group} className="rounded-lg border overflow-hidden">
                      <div className="bg-muted/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {group}
                      </div>
                      <div className="divide-y">
                        {groupModules.map((mod) => {
                          const allChecked  = CRUD_ACTIONS.every((a) => hasPerm(form.permissions, mod.key, a.key));
                          const someChecked = CRUD_ACTIONS.some((a)  => hasPerm(form.permissions, mod.key, a.key));
                          return (
                            <div key={mod.key} className="flex items-center px-3 py-2 gap-4 hover:bg-muted/20 transition-colors">
                              <div className="flex items-center gap-2 w-44 min-w-0">
                                <Checkbox
                                  checked={allChecked}
                                  ref={(el) => { if (el) (el as any).indeterminate = someChecked && !allChecked; }}
                                  onCheckedChange={() => setForm((f) => ({ ...f, permissions: toggleAllModule(f.permissions, mod.key) }))}
                                  id={`module-${mod.key}`}
                                />
                                <label htmlFor={`module-${mod.key}`} className="text-sm cursor-pointer select-none truncate">
                                  {mod.label}
                                </label>
                              </div>
                              <div className="flex items-center gap-4 ml-auto">
                                {CRUD_ACTIONS.map((action) => (
                                  <Checkbox
                                    key={action.key}
                                    checked={hasPerm(form.permissions, mod.key, action.key)}
                                    onCheckedChange={() => setForm((f) => ({ ...f, permissions: togglePerm(f.permissions, mod.key, action.key) }))}
                                    title={action.label}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? "Menyimpan..." : editRole ? "Simpan Perubahan" : "Buat Role"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Role "{deleteTarget?.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Tindakan ini tidak bisa dibatalkan. Semua pengguna yang memiliki role ini akan kehilangan akses khusus.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Menghapus..." : "Hapus"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </AppShell>
  );
}
