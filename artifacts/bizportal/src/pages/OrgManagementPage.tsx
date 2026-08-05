import { useState, useEffect } from "react";
import { useCodeCheck } from "@/hooks/useCodeCheck";
import { CodeCheckIndicator } from "@/components/ui/code-check-indicator";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  Building2, GitBranch, LayoutList, FolderOpen, Users2, Network,
  Plus, Pencil, Trash2, ChevronRight, CheckCircle2, XCircle,
  RefreshCw, Shield, AlertCircle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

// ── types ─────────────────────────────────────────────────────────────────────

interface Company { id: number; companyName: string; companyCode: string; isActive: boolean; isHolding?: boolean; address?: string; phone?: string; email?: string; npwp?: string }
interface Branch  { id: number; companyId: number; name: string; code?: string; address?: string; phone?: string; isActive: boolean; company_name?: string; company_code?: string }
interface Division { id: number; companyId: number; name: string; code?: string; description?: string; isActive: boolean; company_name?: string; company_code?: string; branch_name?: string; manager_name?: string }
interface Department { id: number; companyId: number; divisionId?: number | null; name: string; code?: string; description?: string; isActive: boolean; company_name?: string; company_code?: string; division_name?: string; branch_name?: string; manager_name?: string }
interface Section { id: number; companyId: number; departmentId?: number | null; name: string; code?: string; description?: string; isActive: boolean; company_name?: string; department_name?: string }

interface HierarchySection { id: number; name: string; code?: string; isActive: boolean }
interface HierarchyDept  { id: number; name: string; code?: string; isActive: boolean; sections: HierarchySection[]; userCount: number; manager_name?: string }
interface HierarchyDiv   { id: number; name: string; code?: string; isActive: boolean; departments: HierarchyDept[]; userCount: number; manager_name?: string; branch_name?: string }
interface HierarchyBranch { id: number; name: string; code?: string; isActive: boolean; userCount: number }
interface HierarchyCompany { id: number; name: string; code: string; isActive: boolean; userCount: number; branches: HierarchyBranch[]; divisions: HierarchyDiv[] }

// ── api helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const txt = await res.text();
    let message = txt || res.statusText;
    try { const parsed = JSON.parse(txt); if (parsed?.message) message = parsed.message; } catch {}
    const err = Object.assign(new Error(message), { status: res.status });
    throw err;
  }
  return res.json();
}

// ── sub-components ────────────────────────────────────────────────────────────

function resolveActive(row: any): boolean {
  return row.isActive ?? row.is_active ?? true;
}

function ActiveBadge({ active }: { active: boolean }) {
  return active
    ? <Badge className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20"><CheckCircle2 className="h-3 w-3 mr-1" />Aktif</Badge>
    : <Badge variant="secondary" className="text-xs"><XCircle className="h-3 w-3 mr-1" />Nonaktif</Badge>;
}

function CompanyFilter({ companies, value, onChange }: { companies: Company[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Semua Perusahaan" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Semua Perusahaan</SelectItem>
        {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.companyCode} — {c.companyName}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ── COMPANIES TAB ─────────────────────────────────────────────────────────────

function CompaniesTab() {
  const qc = useQueryClient();
  const { data: companies = [], isLoading } = useQuery<Company[]>({ queryKey: ["companies"], queryFn: () => apiFetch("/companies") });
  const [dialog, setDialog] = useState<{ open: boolean; mode: "add" | "edit"; item: Partial<Company> }>({ open: false, mode: "add", item: {} });
  const [formError, setFormError] = useState<string | null>(null);

  function openDialog(mode: "add" | "edit", item: Partial<Company>) {
    setFormError(null);
    setDialog({ open: true, mode, item });
  }

  const save = useMutation({
    mutationFn: async (item: Partial<Company>) => {
      if (item.id) return apiFetch(`/companies/${item.id}`, { method: "PATCH", body: JSON.stringify({ companyName: item.companyName, companyCode: item.companyCode, address: item.address, phone: item.phone, email: item.email, npwp: item.npwp, isActive: item.isActive }) });
      return apiFetch("/companies", { method: "POST", body: JSON.stringify({ companyName: item.companyName, companyCode: item.companyCode, address: item.address, phone: item.phone, email: item.email, npwp: item.npwp }) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["companies"] }); setFormError(null); setDialog(d => ({ ...d, open: false })); toast({ title: "Berhasil disimpan" }); },
    onError: (e: Error) => { setFormError(e.message); toast({ title: "Gagal menyimpan", description: e.message, variant: "destructive" }); },
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/companies/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["companies"] }); toast({ title: "Dihapus" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{companies.length} perusahaan terdaftar</p>
        <Button size="sm" onClick={() => openDialog("add", { isActive: true })}>
          <Plus className="h-4 w-4 mr-1" />Tambah Perusahaan
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama Perusahaan</TableHead>
              <TableHead>NPWP</TableHead>
              <TableHead>Kontak</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Memuat...</TableCell></TableRow>
            ) : companies.map(c => (
              <TableRow key={c.id}>
                <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{c.companyCode}</code></TableCell>
                <TableCell className="font-medium">{c.companyName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.npwp ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.email ?? c.phone ?? "—"}</TableCell>
                <TableCell><ActiveBadge active={resolveActive(c)} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openDialog("edit", { ...c })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {c.id > 4 && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { if (confirm("Hapus perusahaan ini?")) del.mutate(c.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialog.open} onOpenChange={o => { if (!o) setFormError(null); setDialog(d => ({ ...d, open: o })); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.mode === "add" ? "Tambah Perusahaan" : "Edit Perusahaan"}</DialogTitle>
            <DialogDescription>Isi informasi perusahaan</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Nama Perusahaan *</Label>
                <Input className="mt-1" value={dialog.item.companyName ?? ""} onChange={e => setDialog(d => ({ ...d, item: { ...d.item, companyName: e.target.value } }))} placeholder="PT Contoh Maju" />
              </div>
              <div>
                <Label className="text-xs">Kode Perusahaan *</Label>
                <Input
                  className={`mt-1 ${formError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  value={dialog.item.companyCode ?? ""}
                  onChange={e => { setFormError(null); setDialog(d => ({ ...d, item: { ...d.item, companyCode: e.target.value.toUpperCase() } })); }}
                  placeholder="CMJ"
                  maxLength={8}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">NPWP</Label><Input className="mt-1" value={dialog.item.npwp ?? ""} onChange={e => setDialog(d => ({ ...d, item: { ...d.item, npwp: e.target.value } }))} placeholder="00.000.000.0-000" /></div>
              <div><Label className="text-xs">Telepon</Label><Input className="mt-1" value={dialog.item.phone ?? ""} onChange={e => setDialog(d => ({ ...d, item: { ...d.item, phone: e.target.value } }))} placeholder="+62..." /></div>
            </div>
            <div><Label className="text-xs">Email</Label><Input className="mt-1" value={dialog.item.email ?? ""} onChange={e => setDialog(d => ({ ...d, item: { ...d.item, email: e.target.value } }))} placeholder="info@perusahaan.co.id" /></div>
            <div><Label className="text-xs">Alamat</Label><Input className="mt-1" value={dialog.item.address ?? ""} onChange={e => setDialog(d => ({ ...d, item: { ...d.item, address: e.target.value } }))} placeholder="Jl. ..." /></div>
            {dialog.mode === "edit" && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="isActive" checked={dialog.item.isActive ?? true} onChange={e => setDialog(d => ({ ...d, item: { ...d.item, isActive: e.target.checked } }))} />
                <Label htmlFor="isActive" className="text-xs">Aktif</Label>
              </div>
            )}
            {formError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFormError(null); setDialog(d => ({ ...d, open: false })); }}>Batal</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(dialog.item)}>{save.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── GENERIC CRUD TAB ──────────────────────────────────────────────────────────

interface GenericTabProps<T extends { id: number; companyId: number; name: string; code?: string; isActive: boolean; company_name?: string; company_code?: string }> {
  label: string;
  endpoint: string;
  queryKey: string;
  companies: Company[];
  extraColumns?: Array<{ label: string; render: (item: T) => React.ReactNode }>;
  extraFields?: Array<{ key: string; label: string; type?: "text" | "select"; options?: Array<{ value: string; label: string }>; required?: boolean }>;
  parentLabel?: string;
  parentItems?: Array<{ id: number; name: string; companyId: number; code?: string }>;
  parentKey?: string;
}

function GenericTab<T extends { id: number; companyId: number; name: string; code?: string; description?: string; isActive: boolean; company_name?: string; company_code?: string }>({
  label, endpoint, queryKey, companies, extraColumns = [], extraFields = [], parentLabel, parentItems = [], parentKey,
}: GenericTabProps<T>) {
  const qc = useQueryClient();
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [dialog, setDialog] = useState<{ open: boolean; mode: "add" | "edit"; item: Record<string, unknown> }>({ open: false, mode: "add", item: {} });
  const [formError, setFormError] = useState<string | null>(null);

  const dialogCode = String(dialog.item.code ?? "");
  const dialogCompanyId = dialog.item.companyId ? Number(dialog.item.companyId) : null;
  const dialogExcludeId = dialog.mode === "edit" && dialog.item.id ? Number(dialog.item.id) : null;
  const codeCheckUrl = dialog.open && dialogCode.trim() && dialogCompanyId
    ? `${endpoint}/check-code?code=${encodeURIComponent(dialogCode)}&companyId=${dialogCompanyId}${dialogExcludeId ? `&excludeId=${dialogExcludeId}` : ""}`
    : null;
  const { checking: codeChecking, taken: codeTaken } = useCodeCheck(codeCheckUrl, dialogCode);

  const url = companyFilter !== "all" ? `${endpoint}?companyId=${companyFilter}` : `${endpoint}?companyId=all`;
  const { data: rows = [], isLoading } = useQuery<T[]>({ queryKey: [queryKey, companyFilter], queryFn: () => apiFetch(url) });

  const filteredParents = parentItems.filter(p => !companyFilter || companyFilter === "all" || p.companyId === Number(companyFilter));

  const save = useMutation({
    mutationFn: async (item: Record<string, unknown>) => {
      if (item.id) return apiFetch(`${endpoint}/${item.id}`, { method: "PATCH", body: JSON.stringify(item) });
      return apiFetch(endpoint, { method: "POST", body: JSON.stringify(item) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); setFormError(null); setDialog(d => ({ ...d, open: false })); toast({ title: "Berhasil disimpan" }); },
    onError: (e: Error) => { setFormError(e.message); toast({ title: "Gagal menyimpan", description: e.message, variant: "destructive" }); },
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`${endpoint}/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [queryKey] }); toast({ title: "Dihapus" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openAdd() {
    const init: Record<string, unknown> = { isActive: true };
    if (companyFilter !== "all") init.companyId = Number(companyFilter);
    setFormError(null);
    setDialog({ open: true, mode: "add", item: init });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <CompanyFilter companies={companies} value={companyFilter} onChange={setCompanyFilter} />
        <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" />Tambah {label}</Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama</TableHead>
              {extraColumns.map(ec => <TableHead key={ec.label}>{ec.label}</TableHead>)}
              <TableHead>Perusahaan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5 + extraColumns.length} className="text-center text-muted-foreground py-8">Memuat...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5 + extraColumns.length} className="text-center text-muted-foreground py-8">Belum ada data</TableCell></TableRow>
            ) : rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{row.code ?? "—"}</code></TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                {extraColumns.map(ec => <TableCell key={ec.label} className="text-sm text-muted-foreground">{ec.render(row)}</TableCell>)}
                <TableCell className="text-sm text-muted-foreground">{row.company_code ? `${row.company_code}` : "—"}</TableCell>
                <TableCell><ActiveBadge active={resolveActive(row)} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      const item: Record<string, unknown> = { ...row, isActive: resolveActive(row) };
                      if (parentKey && (row as any)[parentKey]) item[parentKey] = (row as any)[parentKey];
                      setFormError(null);
                      setDialog({ open: true, mode: "edit", item });
                    }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { if (confirm(`Hapus ${label} ini?`)) del.mutate(row.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialog.open} onOpenChange={o => { if (!o) setFormError(null); setDialog(d => ({ ...d, open: o })); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.mode === "add" ? `Tambah ${label}` : `Edit ${label}`}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label className="text-xs">Perusahaan *</Label>
              <Select value={dialog.item.companyId ? String(dialog.item.companyId) : ""} onValueChange={v => setDialog(d => ({ ...d, item: { ...d.item, companyId: Number(v) } }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih perusahaan" /></SelectTrigger>
                <SelectContent>
                  {companies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.companyCode} — {c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {parentKey && parentLabel && (
              <div>
                <Label className="text-xs">{parentLabel}</Label>
                <Select value={String(dialog.item[parentKey] ?? "__none__")} onValueChange={v => setDialog(d => ({ ...d, item: { ...d.item, [parentKey!]: v === "__none__" ? null : Number(v) } }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder={`Pilih ${parentLabel}`} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Tidak ada —</SelectItem>
                    {filteredParents.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.code ? `[${p.code}] ` : ""}{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Nama *</Label>
                <Input className="mt-1" value={String(dialog.item.name ?? "")} onChange={e => setDialog(d => ({ ...d, item: { ...d.item, name: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">Kode</Label>
                <Input
                  className={`mt-1 ${codeTaken === true ? "border-destructive focus-visible:ring-destructive" : formError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  value={String(dialog.item.code ?? "")}
                  onChange={e => { setFormError(null); setDialog(d => ({ ...d, item: { ...d.item, code: e.target.value.toUpperCase() } })); }}
                />
                <CodeCheckIndicator checking={codeChecking} taken={codeTaken} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Deskripsi</Label>
              <Input className="mt-1" value={String(dialog.item.description ?? "")} onChange={e => setDialog(d => ({ ...d, item: { ...d.item, description: e.target.value } }))} />
            </div>
            {dialog.mode === "edit" && (
              <div className="flex items-center gap-2">
                <input type="checkbox" id="isActiveGeneric" checked={Boolean(dialog.item.isActive)} onChange={e => setDialog(d => ({ ...d, item: { ...d.item, isActive: e.target.checked } }))} />
                <Label htmlFor="isActiveGeneric" className="text-xs">Aktif</Label>
              </div>
            )}
            {formError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFormError(null); setDialog(d => ({ ...d, open: false })); }}>Batal</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(dialog.item)}>{save.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── HIERARCHY VIEW ────────────────────────────────────────────────────────────

function HierarchyView({ companies }: { companies: Company[] }) {
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const url = companyFilter !== "all" ? `/org/hierarchy?companyId=${companyFilter}` : "/org/hierarchy?companyId=all";
  const { data: tree = [], isLoading, refetch } = useQuery<HierarchyCompany[]>({ queryKey: ["org-hierarchy", companyFilter], queryFn: () => apiFetch(url) });

  function toggle(key: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  const COMPANY_COLORS = ["from-indigo-600 to-indigo-800", "from-emerald-600 to-emerald-800", "from-amber-600 to-amber-800", "from-rose-600 to-rose-800"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <CompanyFilter companies={companies} value={companyFilter} onChange={setCompanyFilter} />
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">Memuat hierarki...</div>
      ) : tree.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">Tidak ada data</div>
      ) : (
        <div className="space-y-4">
          {tree.map((co, idx) => {
            const colorClass = COMPANY_COLORS[idx % COMPANY_COLORS.length];
            const coKey = `co-${co.id}`;
            const coOpen = expanded.has(coKey);

            return (
              <Card key={co.id} className="overflow-hidden">
                <div className={`h-1.5 bg-gradient-to-r ${colorClass}`} />
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <button className="flex items-center gap-3 text-left" onClick={() => toggle(coKey)}>
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${colorClass} text-white text-xs font-bold`}>
                        {co.code.slice(0, 3)}
                      </div>
                      <div>
                        <div className="font-semibold text-sm flex items-center gap-2">
                          {co.name}
                          <ActiveBadge active={co.isActive} />
                        </div>
                        <div className="text-xs text-muted-foreground">Kode: {co.code}</div>
                      </div>
                      <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ml-2 ${coOpen ? "rotate-90" : ""}`} />
                    </button>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Users2 className="h-4 w-4" />{co.userCount}</span>
                      <span className="text-xs">{co.branches.length} cabang · {co.divisions.length} divisi</span>
                    </div>
                  </div>
                </CardHeader>

                {coOpen && (
                  <CardContent className="px-4 pb-4 pt-0 space-y-4">
                    {/* Branches */}
                    {co.branches.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" />Cabang</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {co.branches.map(b => (
                            <div key={b.id} className="rounded-lg border px-3 py-2 text-sm flex items-center justify-between gap-2">
                              <div>
                                <div className="font-medium">{b.name}</div>
                                {b.code && <div className="text-xs text-muted-foreground font-mono">{b.code}</div>}
                              </div>
                              <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Users2 className="h-3 w-3" />{b.userCount}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Divisions → Departments → Sections */}
                    {co.divisions.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><LayoutList className="h-3.5 w-3.5" />Divisi → Departemen → Seksi</p>
                        <div className="space-y-2">
                          {co.divisions.map(div => {
                            const divKey = `div-${div.id}`;
                            const divOpen = expanded.has(divKey);
                            return (
                              <div key={div.id} className="rounded-lg border overflow-hidden">
                                <button
                                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/40 transition-colors"
                                  onClick={() => toggle(divKey)}
                                >
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${divOpen ? "rotate-90" : ""}`} />
                                    <span className="font-medium">{div.name}</span>
                                    {div.code && <code className="text-xs bg-muted px-1 rounded font-mono">{div.code}</code>}
                                    <span className="text-xs text-muted-foreground">({div.departments.length} dept)</span>
                                    {div.manager_name && <span className="text-xs text-muted-foreground">· Mgr: {div.manager_name}</span>}
                                  </div>
                                  <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Users2 className="h-3 w-3" />{div.userCount}</span>
                                </button>
                                {divOpen && div.departments.length > 0 && (
                                  <div className="border-t bg-muted/20 px-4 py-2 space-y-1.5">
                                    {div.departments.map(dep => {
                                      const depKey = `dep-${dep.id}`;
                                      const depOpen = expanded.has(depKey);
                                      return (
                                        <div key={dep.id}>
                                          <button
                                            className="w-full flex items-center justify-between py-1.5 text-xs hover:text-foreground text-muted-foreground"
                                            onClick={() => dep.sections.length > 0 && toggle(depKey)}
                                          >
                                            <div className="flex items-center gap-2 flex-wrap">
                                              {dep.sections.length > 0 && <ChevronRight className={`h-3 w-3 transition-transform ${depOpen ? "rotate-90" : ""}`} />}
                                              {dep.sections.length === 0 && <div className="w-3" />}
                                              <FolderOpen className="h-3.5 w-3.5" />
                                              <span className="font-medium text-foreground">{dep.name}</span>
                                              {dep.code && <code className="text-xs bg-background px-1 rounded font-mono">{dep.code}</code>}
                                              {dep.sections.length > 0 && <span className="text-muted-foreground">({dep.sections.length} seksi)</span>}
                                              {dep.manager_name && <span className="text-muted-foreground text-xs">· Mgr: {dep.manager_name}</span>}
                                            </div>
                                            <span className="flex items-center gap-0.5"><Users2 className="h-3 w-3" />{dep.userCount}</span>
                                          </button>
                                          {depOpen && dep.sections.length > 0 && (
                                            <div className="ml-6 pl-2 border-l border-border space-y-1 mt-1">
                                              {dep.sections.map(sec => (
                                                <div key={sec.id} className="flex items-center gap-2 text-xs py-1">
                                                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                                                  <span>{sec.name}</span>
                                                  {sec.code && <code className="bg-muted px-1 rounded font-mono">{sec.code}</code>}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

export default function OrgManagementPage() {
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["companies"], queryFn: () => apiFetch("/companies") });
  const { data: divisions = [] } = useQuery<Division[]>({ queryKey: ["org/divisions", "all"], queryFn: () => apiFetch("/org/divisions?companyId=all") });
  const { data: departments = [] } = useQuery<Department[]>({ queryKey: ["org/departments", "all"], queryFn: () => apiFetch("/org/departments?companyId=all") });

  const divParents = divisions.map(d => ({ id: d.id, name: d.name, companyId: d.companyId, code: d.code }));
  const deptParents = departments.map(d => ({ id: d.id, name: d.name, companyId: d.companyId, code: d.code }));

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/30">
            <Network className="h-6 w-6 text-indigo-400" />
          </div>
          <div>
            <Link href="/settings"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold tracking-tight">Manajemen Organisasi</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Kelola struktur perusahaan: Perusahaan → Cabang → Divisi → Departemen → Seksi/Tim
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="text-xs flex items-center gap-1">
              <Shield className="h-3 w-3" />Admin Only
            </Badge>
          </div>
        </div>

        <Tabs defaultValue="hierarchy">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="hierarchy" className="text-xs"><Network className="h-3.5 w-3.5 mr-1" />Hierarki</TabsTrigger>
            <TabsTrigger value="companies" className="text-xs"><Building2 className="h-3.5 w-3.5 mr-1" />Perusahaan</TabsTrigger>
            <TabsTrigger value="branches" className="text-xs"><GitBranch className="h-3.5 w-3.5 mr-1" />Cabang</TabsTrigger>
            <TabsTrigger value="divisions" className="text-xs"><LayoutList className="h-3.5 w-3.5 mr-1" />Divisi</TabsTrigger>
            <TabsTrigger value="departments" className="text-xs"><FolderOpen className="h-3.5 w-3.5 mr-1" />Departemen</TabsTrigger>
            <TabsTrigger value="sections" className="text-xs"><Users2 className="h-3.5 w-3.5 mr-1" />Seksi/Tim</TabsTrigger>
          </TabsList>

          <TabsContent value="hierarchy" className="mt-4">
            <HierarchyView companies={companies} />
          </TabsContent>

          <TabsContent value="companies" className="mt-4">
            <CompaniesTab />
          </TabsContent>

          <TabsContent value="branches" className="mt-4">
            <GenericTab
              label="Cabang"
              endpoint="/org/branches"
              queryKey="org/branches"
              companies={companies}
            />
          </TabsContent>

          <TabsContent value="divisions" className="mt-4">
            <GenericTab
              label="Divisi"
              endpoint="/org/divisions"
              queryKey="org/divisions"
              companies={companies}
              extraColumns={[
                { label: "Manager", render: (r: any) => <span className="text-xs">{r.manager_name ?? "—"}</span> },
                { label: "Cabang", render: (r: any) => <span className="text-xs">{r.branch_name ?? "—"}</span> },
              ]}
            />
          </TabsContent>

          <TabsContent value="departments" className="mt-4">
            <GenericTab
              label="Departemen"
              endpoint="/org/departments"
              queryKey="org/departments"
              companies={companies}
              parentLabel="Divisi"
              parentItems={divParents}
              parentKey="divisionId"
              extraColumns={[
                { label: "Divisi", render: (r: any) => <span>{r.division_name ?? "—"}</span> },
                { label: "Manager", render: (r: any) => <span className="text-xs">{r.manager_name ?? "—"}</span> },
              ]}
            />
          </TabsContent>

          <TabsContent value="sections" className="mt-4">
            <GenericTab
              label="Seksi/Tim"
              endpoint="/org/sections"
              queryKey="org/sections"
              companies={companies}
              parentLabel="Departemen"
              parentItems={deptParents}
              parentKey="departmentId"
              extraColumns={[{ label: "Departemen", render: (r: any) => <span>{r.department_name ?? "—"}</span> }]}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
