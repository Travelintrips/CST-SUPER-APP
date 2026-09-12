import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { getListUsersQueryKey, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil, Users, ShieldAlert, ShieldCheck, X, Plus, Trash2, Building2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { Link } from "wouter";

const ROLES = ["admin", "ecommerce", "trading", "logistics"] as const;
type Role = typeof ROLES[number];

const ROLE_LABELS: Record<string, string> = {
  admin:     "Admin",
  ecommerce: "E-Commerce",
  trading:   "Trading",
  logistics: "Logistik",
};

const roleColor = (role: string) => {
  switch (role) {
    case "admin":          return "bg-violet-500/10 text-violet-500 border-violet-500/20";
    case "ecommerce":      return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    case "trading":        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    case "logistics":      return "bg-indigo-500/10 text-indigo-500 border-indigo-500/20";

    default:               return "bg-muted text-muted-foreground";
  }
};

interface UserRow {
  id: string; email: string; name: string; role: string; division: string | null;
  customRoleId: number | null; customRoleName: string | null; customRoleColor: string | null;
  companyId: number | null; companyName: string | null; companyCode: string | null;
  branchId: number | null; branchName: string | null;
  divisionId: number | null; divisionName: string | null;
  departmentId: number | null; departmentName: string | null;
  sectionId: number | null; sectionName: string | null;
}

interface CustomRole { id: number; name: string; color: string }
interface OrgItem    { id: number; name: string; code?: string; companyId: number }

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function UsersPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: users, isLoading, error } = useQuery<UserRow[]>({
    queryKey: getListUsersQueryKey(),
    queryFn: () => apiFetch("/users"),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: customRoles = [] } = useQuery<CustomRole[]>({
    queryKey: ["custom-roles"],
    queryFn: () => apiFetch("/custom-roles"),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: companies = [] } = useQuery<{ id: number; companyName: string; companyCode: string }[]>({
    queryKey: ["companies"],
    queryFn: () => apiFetch("/companies"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: branches = [] } = useQuery<OrgItem[]>({
    queryKey: ["org/branches", "all"],
    queryFn: () => apiFetch("/org/branches?companyId=all"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: divisions = [] } = useQuery<OrgItem[]>({
    queryKey: ["org/divisions", "all"],
    queryFn: () => apiFetch("/org/divisions?companyId=all"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: departments = [] } = useQuery<OrgItem[]>({
    queryKey: ["org/departments", "all"],
    queryFn: () => apiFetch("/org/departments?companyId=all"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: sections = [] } = useQuery<OrgItem[]>({
    queryKey: ["org/sections", "all"],
    queryFn: () => apiFetch("/org/sections?companyId=all"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const [editing, setEditing]           = useState<UserRow | null>(null);
  const [editRole, setEditRole]         = useState<Role>("ecommerce");
  const [editDivision, setEditDivision] = useState<string>("");
  const [editName, setEditName]         = useState<string>("");
  const [editCustomRoleId, setEditCustomRoleId] = useState<string>("");
  const [editCompanyId, setEditCompanyId]     = useState<string>("");
  const [editBranchId, setEditBranchId]       = useState<string>("");
  const [editDivisionId, setEditDivisionId]   = useState<string>("");
  const [editDepartmentId, setEditDepartmentId] = useState<string>("");
  const [editSectionId, setEditSectionId]     = useState<string>("");
  /** Admin-only: set of company IDs this admin is allowed to access. Empty = all companies. */
  const [editAllowedCompanies, setEditAllowedCompanies] = useState<number[]>([]);
  const [saving, setSaving]                   = useState(false);

  // Load allowed-companies for the user currently being edited
  const { data: currentAllowedCompanies = [] } = useQuery<{ company_id: number }[]>({
    queryKey: ["user-allowed-companies", editing?.id],
    queryFn: () => apiFetch(`/users/${editing!.id}/allowed-companies`),
    enabled: !!editing?.id,
    staleTime: 0,
  });

  // Sync allowed companies state when query data arrives — useEffect avoids render-phase setState
  useEffect(() => {
    if (editing?.id) {
      setEditAllowedCompanies(currentAllowedCompanies.map((r) => r.company_id));
    }
  }, [editing?.id, currentAllowedCompanies]);

  function toggleAllowedCompany(companyId: number, checked: boolean) {
    setEditAllowedCompanies((prev) =>
      checked ? [...prev, companyId] : prev.filter((id) => id !== companyId),
    );
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", name: "", role: "ecommerce" as Role });
  const [creating, setCreating]     = useState(false);

  const createMut = useMutation({
    mutationFn: (data: { email: string; name: string; role: string }) =>
      apiFetch("/users", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      setCreateOpen(false);
      setCreateForm({ email: "", name: "", role: "ecommerce" });
      toast({ title: "User berhasil ditambahkan" });
    },
    onError: (e: Error) => {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      toast({ title: "User dihapus" });
    },
    onError: (e: Error) => {
      toast({ title: "Gagal hapus", description: e.message, variant: "destructive" });
    },
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.email.trim()) return;
    setCreating(true);
    try {
      await createMut.mutateAsync(createForm);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (u: UserRow) => {
    if (!confirm(`Hapus user "${u.name}" (${u.email})? Tindakan ini tidak bisa dibatalkan.`)) return;
    deleteMut.mutate(u.id);
  };

  const selectedCompanyId = editCompanyId && editCompanyId !== "none" ? Number(editCompanyId) : null;
  const filteredBranches    = branches.filter(b => !selectedCompanyId || (b as any).company_id === selectedCompanyId);
  const filteredDivisions   = divisions.filter(d => !selectedCompanyId || (d as any).company_id === selectedCompanyId);
  const filteredDepartments = departments.filter(d => !selectedCompanyId || (d as any).company_id === selectedCompanyId);
  const filteredSections    = sections.filter(s => !selectedCompanyId || (s as any).company_id === selectedCompanyId);

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setEditRole(u.role as Role);
    setEditDivision(u.division ?? "");
    setEditName(u.name ?? "");
    setEditCustomRoleId(u.customRoleId != null ? String(u.customRoleId) : "none");
    setEditCompanyId(u.companyId != null ? String(u.companyId) : "none");
    setEditBranchId(u.branchId != null ? String(u.branchId) : "none");
    setEditDivisionId(u.divisionId != null ? String(u.divisionId) : "none");
    setEditDepartmentId(u.departmentId != null ? String(u.departmentId) : "none");
    setEditSectionId(u.sectionId != null ? String(u.sectionId) : "none");
    setEditAllowedCompanies([]); // will be overwritten when query returns
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await apiFetch(`/users/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({
          role: editRole,
          name: editName.trim() || editing.name,
          division: editDivision.trim() || null,
          companyId:    editCompanyId    !== "none" && editCompanyId    ? Number(editCompanyId)    : null,
          branchId:     editBranchId     !== "none" && editBranchId     ? Number(editBranchId)     : null,
          divisionId:   editDivisionId   !== "none" && editDivisionId   ? Number(editDivisionId)   : null,
          departmentId: editDepartmentId !== "none" && editDepartmentId ? Number(editDepartmentId) : null,
          sectionId:    editSectionId    !== "none" && editSectionId    ? Number(editSectionId)    : null,
          customRoleId: editCustomRoleId !== "none" && editCustomRoleId ? Number(editCustomRoleId) : null,
        }),
      });

      const prevCrId = editing.customRoleId != null ? String(editing.customRoleId) : "none";
      if (editCustomRoleId !== prevCrId) {
        if (prevCrId !== "none") {
          await apiFetch(`/custom-roles/${prevCrId}/assign/${editing.id}`, { method: "DELETE" });
        }
        if (editCustomRoleId !== "none") {
          await apiFetch(`/custom-roles/${editCustomRoleId}/assign`, {
            method: "POST",
            body: JSON.stringify({ userId: editing.id }),
          });
        }
      }

      // Save allowed-companies list for admin users
      if (editRole === "admin") {
        await apiFetch(`/users/${editing.id}/allowed-companies`, {
          method: "PUT",
          body: JSON.stringify({ companyIds: editAllowedCompanies }),
        });
      } else {
        // Non-admin users don't need a company allowlist — clear any existing
        await apiFetch(`/users/${editing.id}/allowed-companies`, {
          method: "PUT",
          body: JSON.stringify({ companyIds: [] }),
        });
      }

      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["custom-roles"] });
      queryClient.invalidateQueries({ queryKey: ["user-allowed-companies", editing.id] });
      setEditing(null);
      toast({ title: "Berhasil disimpan" });
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isForbidden = (error as any)?.status === 403 || (error as any)?.message?.includes("403");
  const allLoading = isLoading;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.users.title}
          description={t.users.subtitle}
          breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Users" }]}
          favoriteEnabled
          actions={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Tambah User
            </Button>
          }
        />

        {isForbidden ? (
          <Card><CardContent className="p-8 text-center space-y-2">
            <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
            <p className="font-medium">{t.users.accessDenied}</p>
            <p className="text-sm text-muted-foreground">{t.users.adminOnly}</p>
          </CardContent></Card>
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.common.name}</TableHead>
                      <TableHead>{t.common.email}</TableHead>
                      <TableHead>Tipe</TableHead>
                      <TableHead>Role / Status</TableHead>
                      <TableHead>Custom Role</TableHead>
                      <TableHead>Perusahaan / Cabang</TableHead>
                      <TableHead>Divisi / Dept</TableHead>
                      <TableHead className="text-right w-[140px]">{t.common.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 8 }).map((__, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <>
                        {/* BizPortal users */}
                        {users?.map((u) => (
                          <TableRow key={`bp-${u.id}`}>
                            <TableCell className="font-medium">{u.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">
                                BizPortal
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={roleColor(u.role)}>{ROLE_LABELS[u.role] ?? u.role}</Badge>
                            </TableCell>
                            <TableCell>
                              {u.customRoleName ? (
                                <Badge variant="outline" className="gap-1 border" style={{ borderColor: u.customRoleColor ?? "#6366f1", color: u.customRoleColor ?? "#6366f1" }}>
                                  <ShieldCheck className="h-3 w-3" />{u.customRoleName}
                                </Badge>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-sm">
                              {u.companyCode
                                ? <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{u.companyCode}</code>
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              <div className="text-xs">
                                {u.divisionName && <div>{u.divisionName}</div>}
                                {u.departmentName && <div className="text-muted-foreground/70">{u.departmentName}</div>}
                                {!u.divisionName && !u.departmentName && (u.division || "—")}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="icon" variant="ghost" onClick={() => openEdit(u)} aria-label={t.common.edit}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => handleDelete(u)} aria-label="Hapus">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}

                        {!allLoading && (users?.length ?? 0) === 0 && (
                          <TableRow>
                            <TableCell colSpan={8} className="h-24 text-center">
                              <div className="flex flex-col items-center justify-center text-muted-foreground">
                                <Users className="h-8 w-8 mb-2 opacity-50" />
                                <p>{t.users.noUsers}</p>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {allLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4 space-y-2">
                    <Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/3" />
                  </CardContent></Card>
                ))
              ) : (
                <>
                  {users?.map((u) => (
                    <Card key={`bp-${u.id}`}><CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px] px-1.5 py-0">BizPortal</Badge>
                          </div>
                          <p className="font-medium truncate">{u.name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{u.email}</p>
                        </div>
                        <Badge variant="outline" className={`shrink-0 ${roleColor(u.role)}`}>{ROLE_LABELS[u.role] ?? u.role}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {u.companyCode && <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{u.companyCode}</code>}
                        {u.divisionName && <span className="text-xs text-muted-foreground">{u.divisionName}</span>}
                        {u.departmentName && <span className="text-xs text-muted-foreground">/ {u.departmentName}</span>}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(u)}>
                          <Pencil className="h-3.5 w-3.5 mr-1.5" /> {t.common.edit}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDelete(u)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent></Card>
                  ))}

                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create User dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) setCreateForm({ email: "", name: "", role: "ecommerce" }); }}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Tambah User Baru</DialogTitle>
              <DialogDescription>User akan bisa login menggunakan akun Google sesuai email yang didaftarkan.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="create-email" className="text-xs">Email <span className="text-destructive">*</span></Label>
                <Input
                  id="create-email"
                  type="email"
                  placeholder="user@example.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  required
                  className="text-sm"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="create-name" className="text-xs">Nama</Label>
                <Input
                  id="create-name"
                  placeholder="Nama lengkap (opsional)"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="text-sm"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="create-role" className="text-xs">Role Sistem <span className="text-destructive">*</span></Label>
                <Select value={createForm.role} onValueChange={(v) => setCreateForm({ ...createForm, role: v as Role })}>
                  <SelectTrigger id="create-role" className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r] ?? r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
              <Button type="submit" disabled={creating}>
                {creating ? "Menyimpan..." : "Tambah"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog (BizPortal users) */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {editing && (
            <form onSubmit={handleSave}>
              <DialogHeader>
                <DialogTitle>{t.users.editTitle}</DialogTitle>
                <DialogDescription>{t.users.editDesc}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-4">
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">{t.common.email}</Label>
                  <Input value={editing.email} disabled className="text-sm" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="user-name" className="text-xs">{t.common.name}</Label>
                  <Input id="user-name" value={editName} onChange={(e) => setEditName(e.target.value)} className="text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="user-role" className="text-xs">Role Sistem</Label>
                    <Select value={editRole} onValueChange={(v) => setEditRole(v as Role)}>
                      <SelectTrigger id="user-role" className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r] ?? r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="user-custom-role" className="text-xs">Custom Role</Label>
                    <Select value={editCustomRoleId} onValueChange={setEditCustomRoleId}>
                      <SelectTrigger id="user-custom-role" className="text-sm"><SelectValue placeholder="Tidak ada" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none"><span className="flex items-center gap-2 text-muted-foreground"><X className="h-3.5 w-3.5" />Tidak ada</span></SelectItem>
                        {customRoles.map((cr) => (
                          <SelectItem key={cr.id} value={String(cr.id)}>
                            <span className="flex items-center gap-2">
                              <span className="h-3 w-3 rounded-full inline-block" style={{ backgroundColor: cr.color }} />{cr.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="border-t pt-3 mt-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Penugasan Organisasi</p>
                  <div className="grid gap-1.5 mb-2">
                    <Label className="text-xs">Perusahaan</Label>
                    <Select value={editCompanyId} onValueChange={v => { setEditCompanyId(v); setEditBranchId("none"); setEditDivisionId("none"); setEditDepartmentId("none"); setEditSectionId("none"); }}>
                      <SelectTrigger className="text-sm"><SelectValue placeholder="— Tidak ditugaskan —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Tidak ditugaskan —</SelectItem>
                        {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.companyCode} — {c.companyName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Cabang</Label>
                      <Select value={editBranchId} onValueChange={setEditBranchId}>
                        <SelectTrigger className="text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {filteredBranches.map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Divisi</Label>
                      <Select value={editDivisionId} onValueChange={v => { setEditDivisionId(v); setEditDepartmentId("none"); setEditSectionId("none"); }}>
                        <SelectTrigger className="text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {filteredDivisions.map((d: any) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Departemen</Label>
                      <Select value={editDepartmentId} onValueChange={v => { setEditDepartmentId(v); setEditSectionId("none"); }}>
                        <SelectTrigger className="text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {filteredDepartments.map((d: any) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs">Seksi/Tim</Label>
                      <Select value={editSectionId} onValueChange={setEditSectionId}>
                        <SelectTrigger className="text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {filteredSections.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="user-division" className="text-xs">{t.users.divisionOptional} <span className="text-muted-foreground">(teks bebas, opsional)</span></Label>
                  <Input id="user-division" value={editDivision} onChange={(e) => setEditDivision(e.target.value)} placeholder="cth. Jakarta Pusat" className="text-sm" />
                </div>

                {/* Allowed companies — admin only */}
                {editRole === "admin" && (
                  <div className="border-t pt-3 mt-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="h-3.5 w-3.5 text-violet-500" />
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Akses Perusahaan (Admin)</p>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Centang perusahaan yang boleh diakses admin ini. Biarkan kosong untuk akses ke semua perusahaan.
                    </p>
                    <div className="space-y-2 max-h-48 overflow-y-auto rounded border p-3">
                      {companies.map((c) => (
                        <div key={c.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`allow-co-${c.id}`}
                            checked={editAllowedCompanies.includes(c.id)}
                            onCheckedChange={(checked) => toggleAllowedCompany(c.id, !!checked)}
                          />
                          <label htmlFor={`allow-co-${c.id}`} className="text-sm cursor-pointer flex items-center gap-2">
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{c.companyCode}</code>
                            {c.companyName}
                          </label>
                        </div>
                      ))}
                    </div>
                    {editAllowedCompanies.length === 0 && (
                      <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Tidak ada yang dipilih = akses ke semua perusahaan
                      </p>
                    )}
                    {editAllowedCompanies.length > 0 && (
                      <p className="text-xs text-violet-600 mt-2">
                        Dibatasi ke {editAllowedCompanies.length} perusahaan: {companies.filter(c => editAllowedCompanies.includes(c.id)).map(c => c.companyCode).join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t.common.cancel}</Button>
                <Button type="submit" disabled={saving}>{saving ? t.common.saving : t.common.save}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
