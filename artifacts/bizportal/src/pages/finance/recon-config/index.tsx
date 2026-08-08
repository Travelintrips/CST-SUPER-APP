/**
 * Bank Reconciliation Classification Configuration
 * Finance → Bank Recon Config
 *
 * 7 tabs:
 *  1. Tipe Bisnis (Business Transaction Types)
 *  2. Biaya Rutin (Routine Expense Types)
 *  3. Alokasi Pendapatan (Income Allocation Types)
 *  4. Rule AI (AI Classification Rules)
 *  5. Kamus Keyword (Keyword Dictionary)
 *  6. Syarat Upload (Upload Requirements — derived from configs)
 *  7. Rule Approval (Approval Rules)
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { CreatableCombobox, type ComboboxOption } from "@/components/ui/creatable-combobox";
import { useCompany } from "@/contexts/CompanyContext";
import {
  SlidersHorizontal, Plus, Pencil, PowerOff, RefreshCw,
  Brain, BookOpen, Tag, Upload, Shield, ArrowLeft,
  BarChart2, TrendingUp, TrendingDown, Clock, AlertCircle, CheckCircle2,
} from "lucide-react";

const API = "/api";

const FLOWS = [
  { value: "BUSINESS_MATCHING",           label: "Business Matching" },
  { value: "ROUTINE_EXPENSE_ALLOCATION",  label: "Routine Expense Allocation" },
  { value: "INCOME_ALLOCATION",           label: "Income Allocation" },
  { value: "MANUAL_REVIEW",              label: "Manual Review" },
  { value: "BLOCKED",                    label: "Blocked" },
];

const UPLOAD_OPTS = [
  { value: "none",     label: "Tidak perlu upload" },
  { value: "optional", label: "Upload opsional" },
  { value: "required", label: "Upload wajib" },
];

const FILE_TYPES = ["PDF", "JPG", "PNG", "WEBP"];

const COND_FIELDS = [
  { value: "description", label: "Deskripsi" },
  { value: "amount",      label: "Jumlah" },
  { value: "direction",   label: "Arah (IN/OUT)" },
  { value: "intent",      label: "Intent" },
  { value: "normalized",  label: "Normalized" },
];

const COND_OPS = [
  { value: "contains",    label: "Contains" },
  { value: "starts_with", label: "Starts With" },
  { value: "regex",       label: "Regex" },
  { value: "eq",          label: "=" },
  { value: "neq",         label: "≠" },
  { value: "gte",         label: "≥" },
  { value: "lte",         label: "≤" },
];

function flowBadge(flow: string) {
  const colors: Record<string, string> = {
    BUSINESS_MATCHING:           "bg-blue-900 text-blue-300",
    ROUTINE_EXPENSE_ALLOCATION:  "bg-amber-900 text-amber-300",
    INCOME_ALLOCATION:           "bg-green-900 text-green-300",
    MANUAL_REVIEW:               "bg-slate-700 text-slate-300",
    BLOCKED:                     "bg-red-900 text-red-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[flow] ?? "bg-slate-700 text-slate-300"}`}>
      {FLOWS.find(f => f.value === flow)?.label ?? flow}
    </span>
  );
}

// ─── Generic config tab (Business, Routine, Income) ───────────────────────────

function ConfigTab({ category }: { category: "BUSINESS_TRANSACTION" | "ROUTINE_EXPENSE" | "INCOME_ALLOCATION" }) {
  const { activeCompanyId } = useCompany();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [saving, setSaving]   = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm]       = useState<any>({});

  // ── Dropdown options ─────────────────────────────────────────────────────
  const [coaOptions,  setCoaOptions]  = useState<ComboboxOption[]>([]);
  const [deptOptions, setDeptOptions] = useState<ComboboxOption[]>([]);
  const [ccOptions,   setCcOptions]   = useState<ComboboxOption[]>([]);
  const [loadingOpts, setLoadingOpts] = useState(false);

  // Add-department dialog
  const [showAddDept, setShowAddDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [addingDept,  setAddingDept]  = useState(false);

  // Add-cost-center dialog
  const [showAddCC,  setShowAddCC]  = useState(false);
  const [newCcCode,  setNewCcCode]  = useState("");
  const [newCcName,  setNewCcName]  = useState("");
  const [addingCC,   setAddingCC]   = useState(false);

  const loadOptions = useCallback(async () => {
    setLoadingOpts(true);
    try {
      const qp = activeCompanyId ? `?company_id=${activeCompanyId}` : "";
      const [coaR, deptR, ccR] = await Promise.all([
        fetch(`${API}/accounting/coa${qp}`, { credentials: "include" }),
        fetch(`${API}/org/departments${qp}`,  { credentials: "include" }),
        fetch(`${API}/accounting/cost-centers${qp}`, { credentials: "include" }),
      ]);
      const [coaJ, deptJ, ccJ] = await Promise.all([coaR.json(), deptR.json(), ccR.json()]);

      const coas  = Array.isArray(coaJ)  ? coaJ  : (coaJ.data  ?? []);
      const depts = Array.isArray(deptJ) ? deptJ : (deptJ.data ?? []);
      const ccs   = Array.isArray(ccJ)   ? ccJ   : (ccJ.data   ?? []);

      setCoaOptions(coas.map((c: any) => ({ value: c.code, label: `${c.code} — ${c.name}` })));
      setDeptOptions(depts.map((d: any) => ({ value: d.name, label: d.code ? `${d.code} — ${d.name}` : d.name })));
      setCcOptions(ccs.map((c: any)    => ({ value: c.code, label: `${c.code} — ${c.name}` })));
    } catch {
      // silently ignore — fields still work as free-text fallback
    } finally {
      setLoadingOpts(false);
    }
  }, [activeCompanyId]);

  const handleAddDepartment = async () => {
    const name = newDeptName.trim();
    if (!name) return;
    setAddingDept(true);
    try {
      const r = await fetch(`${API}/org/departments`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: activeCompanyId, name }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.message ?? "Gagal menambah departemen."); return; }
      const created = await r.json();
      const opt = { value: created.name, label: created.name };
      setDeptOptions(prev => [...prev, opt]);
      setForm((f: any) => ({ ...f, default_department: created.name }));
      setShowAddDept(false);
      setNewDeptName("");
    } finally {
      setAddingDept(false);
    }
  };

  const handleAddCostCenter = async () => {
    const code = newCcCode.trim().toUpperCase();
    const name = newCcName.trim();
    if (!code || !name) { alert("Kode dan nama wajib diisi."); return; }
    setAddingCC(true);
    try {
      const r = await fetch(`${API}/accounting/cost-centers`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, companyId: activeCompanyId }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.message ?? "Gagal menambah cost center."); return; }
      const created = await r.json();
      const opt = { value: created.code, label: `${created.code} — ${created.name}` };
      setCcOptions(prev => [...prev, opt]);
      setForm((f: any) => ({ ...f, default_cost_center: created.code }));
      setShowAddCC(false);
      setNewCcCode("");
      setNewCcName("");
    } finally {
      setAddingCC(false);
    }
  };

  const defaultFlow =
    category === "BUSINESS_TRANSACTION"  ? "BUSINESS_MATCHING"          :
    category === "ROUTINE_EXPENSE"       ? "ROUTINE_EXPENSE_ALLOCATION"  :
                                           "INCOME_ALLOCATION";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        category,
        include_inactive: String(showInactive),
        ...(activeCompanyId ? { company_id: String(activeCompanyId) } : {}),
      });
      const r = await fetch(`${API}/recon-classification/configs?${params}`, { credentials: "include" });
      const j = await r.json();
      setRows(j.data ?? []);
    } finally { setLoading(false); }
  }, [category, activeCompanyId, showInactive]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditRow(null);
    setForm({
      category, flow: defaultFlow, need_upload: "none",
      upload_file_types: [], upload_max_files: 5, upload_max_size_mb: 10,
      need_approval: false, need_invoice_number: false, need_reference_number: false,
      ai_learning_enabled: true, confidence_threshold: 0.75, keywords: [], priority: 50,
    });
    loadOptions();
    setShowModal(true);
  };

  const openEdit = (row: any) => {
    setEditRow(row);
    setForm({
      ...row,
      keywords: Array.isArray(row.keywords) ? row.keywords : JSON.parse(row.keywords ?? "[]"),
      upload_file_types: Array.isArray(row.upload_file_types) ? row.upload_file_types : JSON.parse(row.upload_file_types ?? "[]"),
      // NUMERIC columns come back as strings from pg; coerce to number
      confidence_threshold: Number(row.confidence_threshold ?? 0.75),
      upload_max_files: Number(row.upload_max_files ?? 5),
      upload_max_size_mb: Number(row.upload_max_size_mb ?? 10),
      priority: Number(row.priority ?? 50),
    });
    loadOptions();
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        ...form,
        category,
        keywords: typeof form.keywords === "string"
          ? form.keywords.split(",").map((k: string) => k.trim()).filter(Boolean)
          : form.keywords,
        upload_file_types: form.upload_file_types ?? [],
        company_id: activeCompanyId ?? null,
        code: form.code?.toUpperCase().replace(/\s+/g, "_"),
      };
      const url    = editRow ? `${API}/recon-classification/configs/${editRow.id}` : `${API}/recon-classification/configs`;
      const method = editRow ? "PATCH" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json();
        alert(e.error ?? "Gagal menyimpan.");
        return;
      }
      setShowModal(false);
      load();
    } finally { setSaving(false); }
  };

  const deactivate = async (row: any) => {
    if (!confirm(`Nonaktifkan "${row.name}"?`)) return;
    const r = await fetch(`${API}/recon-classification/configs/${row.id}/deactivate`, {
      method: "POST", credentials: "include",
    });
    if (!r.ok) { const e = await r.json(); alert(e.error ?? "Gagal."); return; }
    load();
  };

  const toggleFileType = (ft: string) => {
    const current: string[] = form.upload_file_types ?? [];
    setForm((f: any) => ({
      ...f,
      upload_file_types: current.includes(ft) ? current.filter((x: string) => x !== ft) : [...current, ft],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Label className="text-slate-400 text-sm">Tampilkan nonaktif</Label>
          <Switch checked={showInactive} onCheckedChange={(v) => { setShowInactive(v); }} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} className="border-slate-600 text-slate-300">
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={openAdd} className="bg-orange-500 hover:bg-orange-600 text-white">
            <Plus size={14} className="mr-1" /> Tambah
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><RefreshCw className="animate-spin text-orange-400" size={24} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-left">
                <th className="pb-2 pr-3 font-medium">Nama</th>
                <th className="pb-2 pr-3 font-medium">Kode</th>
                <th className="pb-2 pr-3 font-medium">Tipe</th>
                <th className="pb-2 pr-3 font-medium">Flow</th>
                <th className="pb-2 pr-3 font-medium">Default COA</th>
                <th className="pb-2 pr-3 font-medium">Upload</th>
                <th className="pb-2 pr-3 font-medium">Prioritas</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-slate-500">Belum ada data.</td></tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-3 text-white font-medium">
                    {row.name}
                    {row.is_seed && <span className="ml-1 text-xs text-slate-500">[bawaan]</span>}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-400">{row.code}</td>
                  <td className="py-2 pr-3 text-slate-300">{row.type ?? "—"}</td>
                  <td className="py-2 pr-3">{flowBadge(row.flow)}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-400">{row.default_coa_code ?? "—"}</td>
                  <td className="py-2 pr-3 text-slate-300">{UPLOAD_OPTS.find(u => u.value === row.need_upload)?.label ?? row.need_upload}</td>
                  <td className="py-2 pr-3 text-slate-400">{row.priority}</td>
                  <td className="py-2 pr-3">
                    {row.is_active
                      ? <Badge className="bg-emerald-900 text-emerald-300 text-xs">Aktif</Badge>
                      : <Badge className="bg-slate-700 text-slate-400 text-xs">Nonaktif</Badge>}
                    {row.usage_count > 0 && (
                      <span className="ml-1 text-xs text-slate-500">({row.usage_count}x dipakai)</span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(row)} title="Edit"
                        className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                        <Pencil size={13} />
                      </button>
                      {row.is_active && (
                        <button onClick={() => deactivate(row)} title="Nonaktifkan"
                          className="p-1.5 rounded hover:bg-red-900 text-slate-400 hover:text-red-300 transition-colors">
                          <PowerOff size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add Department dialog ─────────────────────────────────────── */}
      <Dialog open={showAddDept} onOpenChange={v => { setShowAddDept(v); if (!v) setNewDeptName(""); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader><DialogTitle>Tambah Departemen Baru</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-slate-300">Nama Departemen *</Label>
              <Input
                value={newDeptName}
                onChange={e => setNewDeptName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAddDepartment(); }}
                className="bg-slate-800 border-slate-600 text-white mt-1"
                placeholder="cth. Finance, Operations…"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDept(false)} className="border-slate-600 text-slate-300">Batal</Button>
            <Button onClick={handleAddDepartment} disabled={addingDept || !newDeptName.trim()}
              className="bg-orange-500 hover:bg-orange-600 text-white">
              {addingDept ? <RefreshCw size={14} className="animate-spin mr-1" /> : null}
              Tambah
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Cost Center dialog ───────────────────────────────────── */}
      <Dialog open={showAddCC} onOpenChange={v => { setShowAddCC(v); if (!v) { setNewCcCode(""); setNewCcName(""); } }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader><DialogTitle>Tambah Cost Center Baru</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-slate-300">Kode *</Label>
              <Input
                value={newCcCode}
                onChange={e => setNewCcCode(e.target.value.toUpperCase())}
                className="bg-slate-800 border-slate-600 text-white mt-1 font-mono"
                placeholder="cth. CC-OPS"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-slate-300">Nama *</Label>
              <Input
                value={newCcName}
                onChange={e => setNewCcName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAddCostCenter(); }}
                className="bg-slate-800 border-slate-600 text-white mt-1"
                placeholder="cth. Operasional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddCC(false)} className="border-slate-600 text-slate-300">Batal</Button>
            <Button onClick={handleAddCostCenter} disabled={addingCC || !newCcCode.trim() || !newCcName.trim()}
              className="bg-orange-500 hover:bg-orange-600 text-white">
              {addingCC ? <RefreshCw size={14} className="animate-spin mr-1" /> : null}
              Tambah
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit" : "Tambah"} Konfigurasi</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300">Nama *</Label>
                <Input value={form.name ?? ""} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1" placeholder="cth. Customer Payment" />
              </div>
              <div>
                <Label className="text-slate-300">Kode * (UPPER_SNAKE)</Label>
                <Input value={form.code ?? ""} onChange={e => setForm((f: any) => ({ ...f, code: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1 font-mono" placeholder="cth. CUSTOMER_PAYMENT"
                  disabled={!!editRow} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300">Tipe</Label>
                <Select value={form.type ?? "__none__"} onValueChange={v => setForm((f: any) => ({ ...f, type: v === "__none__" ? null : v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1">
                    <SelectValue placeholder="Pilih tipe…" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    <SelectItem value="__none__">— Tidak ditentukan —</SelectItem>
                    <SelectItem value="income">income</SelectItem>
                    <SelectItem value="expense">expense</SelectItem>
                    <SelectItem value="transfer">transfer</SelectItem>
                    <SelectItem value="neutral">neutral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300">Flow *</Label>
                <Select value={form.flow ?? defaultFlow} onValueChange={v => setForm((f: any) => ({ ...f, flow: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    {FLOWS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-slate-300">Default COA Code</Label>
                <div className="mt-1">
                  <CreatableCombobox
                    value={form.default_coa_code ?? ""}
                    onChange={v => setForm((f: any) => ({ ...f, default_coa_code: v || null }))}
                    options={coaOptions}
                    placeholder="Pilih COA…"
                    searchPlaceholder="Cari kode / nama…"
                    loading={loadingOpts}
                    emptyText="COA tidak ditemukan."
                  />
                </div>
              </div>
              <div>
                <Label className="text-slate-300">Department</Label>
                <div className="mt-1">
                  <CreatableCombobox
                    value={form.default_department ?? ""}
                    onChange={v => setForm((f: any) => ({ ...f, default_department: v || null }))}
                    options={deptOptions}
                    placeholder="Pilih departemen…"
                    searchPlaceholder="Cari departemen…"
                    loading={loadingOpts}
                    emptyText="Departemen tidak ditemukan."
                    onAddNew={q => { setNewDeptName(q); setShowAddDept(true); }}
                    addNewLabel="Tambah departemen"
                  />
                </div>
              </div>
              <div>
                <Label className="text-slate-300">Cost Center</Label>
                <div className="mt-1">
                  <CreatableCombobox
                    value={form.default_cost_center ?? ""}
                    onChange={v => setForm((f: any) => ({ ...f, default_cost_center: v || null }))}
                    options={ccOptions}
                    placeholder="Pilih cost center…"
                    searchPlaceholder="Cari kode / nama…"
                    loading={loadingOpts}
                    emptyText="Cost center tidak ditemukan."
                    onAddNew={q => { setNewCcCode(q); setShowAddCC(true); }}
                    addNewLabel="Tambah cost center"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-slate-300">Keywords (pisah koma)</Label>
              <Input
                value={Array.isArray(form.keywords) ? form.keywords.join(", ") : (form.keywords ?? "")}
                onChange={e => setForm((f: any) => ({ ...f, keywords: e.target.value.split(",").map((k: string) => k.trim()).filter(Boolean) }))}
                className="bg-slate-800 border-slate-600 text-white mt-1"
                placeholder="cth. pembayaran, invoice, tagihan" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300">Regex (opsional)</Label>
                <Input value={form.regex_pattern ?? ""} onChange={e => setForm((f: any) => ({ ...f, regex_pattern: e.target.value || null }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1 font-mono" placeholder="cth. ^INV-\d+" />
              </div>
              <div>
                <Label className="text-slate-300">Prioritas (1–999)</Label>
                <Input type="number" min={1} max={999}
                  value={form.priority ?? 50} onChange={e => setForm((f: any) => ({ ...f, priority: parseInt(e.target.value) || 50 }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1" />
              </div>
            </div>

            {/* Upload */}
            <div className="border border-slate-700 rounded-lg p-3 space-y-3">
              <p className="text-slate-300 font-medium text-sm">Syarat Upload</p>
              <div>
                <Label className="text-slate-400 text-xs">Requirement</Label>
                <Select value={form.need_upload ?? "none"} onValueChange={v => setForm((f: any) => ({ ...f, need_upload: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    {UPLOAD_OPTS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.need_upload !== "none" && (
                <>
                  <div>
                    <Label className="text-slate-400 text-xs">Jenis File</Label>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {FILE_TYPES.map(ft => (
                        <button key={ft} type="button" onClick={() => toggleFileType(ft)}
                          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                            (form.upload_file_types ?? []).includes(ft)
                              ? "bg-orange-500 text-white"
                              : "bg-slate-700 text-slate-400 hover:bg-slate-600"
                          }`}>
                          {ft}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-slate-400 text-xs">Maks. Jumlah File</Label>
                      <Input type="number" min={1} max={20} value={form.upload_max_files ?? 5}
                        onChange={e => setForm((f: any) => ({ ...f, upload_max_files: parseInt(e.target.value) || 5 }))}
                        className="bg-slate-800 border-slate-600 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-slate-400 text-xs">Maks. Ukuran (MB)</Label>
                      <Input type="number" min={1} max={100} value={form.upload_max_size_mb ?? 10}
                        onChange={e => setForm((f: any) => ({ ...f, upload_max_size_mb: parseInt(e.target.value) || 10 }))}
                        className="bg-slate-800 border-slate-600 text-white mt-1" />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "need_approval",         label: "Perlu Approval" },
                { key: "need_invoice_number",    label: "Perlu No. Invoice" },
                { key: "need_reference_number",  label: "Perlu No. Referensi" },
                { key: "ai_learning_enabled",    label: "AI Learning Aktif" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between bg-slate-800 rounded p-2">
                  <Label className="text-slate-300 text-sm">{label}</Label>
                  <Switch checked={!!form[key]}
                    onCheckedChange={v => setForm((f: any) => ({ ...f, [key]: v }))} />
                </div>
              ))}
            </div>

            {form.ai_learning_enabled && (
              <div>
                <Label className="text-slate-300">Confidence Threshold (0–1)</Label>
                <Input type="number" min={0} max={1} step={0.05} value={form.confidence_threshold ?? 0.75}
                  onChange={e => setForm((f: any) => ({ ...f, confidence_threshold: parseFloat(e.target.value) || 0.75 }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)} className="border-slate-600 text-slate-300">Batal</Button>
            <Button onClick={save} disabled={saving || !form.name || !form.code}
              className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving ? <RefreshCw size={14} className="animate-spin mr-1" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── AI Classification Rules tab ───────────────────────────────────────────────

function AiRulesTab() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState<any>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(activeCompanyId ? { company_id: String(activeCompanyId) } : {});
      const r = await fetch(`${API}/recon-classification/ai-rules?${params}`, { credentials: "include" });
      const j = await r.json();
      setRows(j.data ?? []);
    } finally { setLoading(false); }
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditRow(null);
    setForm({ condition_field: "description", condition_operator: "contains", confidence: 0.8, priority: 50, source: "manual" });
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const url    = editRow ? `${API}/recon-classification/ai-rules/${editRow.id}` : `${API}/recon-classification/ai-rules`;
      const method = editRow ? "PATCH" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, company_id: activeCompanyId ?? null }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.error ?? "Gagal."); return; }
      setShowModal(false);
      load();
    } finally { setSaving(false); }
  };

  const deactivate = async (row: any) => {
    if (!confirm(`Nonaktifkan rule "${row.name}"?`)) return;
    await fetch(`${API}/recon-classification/ai-rules/${row.id}`, { method: "DELETE", credentials: "include" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={load} className="border-slate-600 text-slate-300"><RefreshCw size={14} /></Button>
        <Button size="sm" onClick={openAdd} className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus size={14} className="mr-1" /> Tambah Rule
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-32"><RefreshCw className="animate-spin text-orange-400" size={24} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-left">
                <th className="pb-2 pr-3">Nama</th>
                <th className="pb-2 pr-3">Kondisi</th>
                <th className="pb-2 pr-3">Action Flow</th>
                <th className="pb-2 pr-3">Conf.</th>
                <th className="pb-2 pr-3">Prioritas</th>
                <th className="pb-2 pr-3">Sumber</th>
                <th className="pb-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-slate-500">Belum ada AI rule.</td></tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-3 text-white">{row.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-400">
                    {row.condition_field} {row.condition_operator} "{row.condition_value}"
                  </td>
                  <td className="py-2 pr-3">{row.action_flow ? flowBadge(row.action_flow) : "—"}</td>
                  <td className="py-2 pr-3 text-slate-400">{Number(row.confidence).toFixed(2)}</td>
                  <td className="py-2 pr-3 text-slate-400">{row.priority}</td>
                  <td className="py-2 pr-3">
                    <Badge className={row.source === "ai_generated" ? "bg-purple-900 text-purple-300 text-xs" : "bg-slate-700 text-slate-300 text-xs"}>
                      {row.source === "ai_generated" ? "AI" : "Manual"}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <button onClick={() => { setEditRow(row); setForm(row); setShowModal(true); }}
                        className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white"><Pencil size={13} /></button>
                      <button onClick={() => deactivate(row)}
                        className="p-1.5 rounded hover:bg-red-900 text-slate-400 hover:text-red-300"><PowerOff size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-xl">
          <DialogHeader><DialogTitle>{editRow ? "Edit" : "Tambah"} AI Rule</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-slate-300">Nama *</Label>
              <Input value={form.name ?? ""} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white mt-1" />
            </div>
            <div>
              <Label className="text-slate-300">Deskripsi</Label>
              <Input value={form.description ?? ""} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value || null }))}
                className="bg-slate-800 border-slate-600 text-white mt-1" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-slate-300 text-xs">Field</Label>
                <Select value={form.condition_field ?? "description"} onValueChange={v => setForm((f: any) => ({ ...f, condition_field: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    {COND_FIELDS.map(cf => <SelectItem key={cf.value} value={cf.value}>{cf.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300 text-xs">Operator</Label>
                <Select value={form.condition_operator ?? "contains"} onValueChange={v => setForm((f: any) => ({ ...f, condition_operator: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    {COND_OPS.map(co => <SelectItem key={co.value} value={co.value}>{co.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300 text-xs">Nilai *</Label>
                <Input value={form.condition_value ?? ""} onChange={e => setForm((f: any) => ({ ...f, condition_value: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300">Action Flow</Label>
                <Select value={form.action_flow ?? "__none__"} onValueChange={v => setForm((f: any) => ({ ...f, action_flow: v === "__none__" ? null : v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    <SelectItem value="__none__">— Tidak ditentukan —</SelectItem>
                    {FLOWS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300">Action COA Code</Label>
                <Input value={form.action_coa_code ?? ""} onChange={e => setForm((f: any) => ({ ...f, action_coa_code: e.target.value || null }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1 font-mono" placeholder="cth. 6-2010" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300">Confidence (0–1)</Label>
                <Input type="number" min={0} max={1} step={0.05} value={form.confidence ?? 0.8}
                  onChange={e => setForm((f: any) => ({ ...f, confidence: parseFloat(e.target.value) || 0.8 }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300">Prioritas</Label>
                <Input type="number" min={1} max={999} value={form.priority ?? 50}
                  onChange={e => setForm((f: any) => ({ ...f, priority: parseInt(e.target.value) || 50 }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)} className="border-slate-600 text-slate-300">Batal</Button>
            <Button onClick={save} disabled={saving || !form.name || !form.condition_value}
              className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving && <RefreshCw size={14} className="animate-spin mr-1" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Keyword Dictionary tab ────────────────────────────────────────────────────

function KeywordTab() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState<any>({ weight: 0.8 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(activeCompanyId ? { company_id: String(activeCompanyId) } : {});
      const r = await fetch(`${API}/recon-classification/keywords?${params}`, { credentials: "include" });
      const j = await r.json();
      setRows(j.data ?? []);
    } finally { setLoading(false); }
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const url    = editRow ? `${API}/recon-classification/keywords/${editRow.id}` : `${API}/recon-classification/keywords`;
      const method = editRow ? "PATCH" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, company_id: activeCompanyId ?? null }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.error ?? "Gagal."); return; }
      setShowModal(false);
      load();
    } finally { setSaving(false); }
  };

  const deactivate = async (row: any) => {
    await fetch(`${API}/recon-classification/keywords/${row.id}`, { method: "DELETE", credentials: "include" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={load} className="border-slate-600 text-slate-300"><RefreshCw size={14} /></Button>
        <Button size="sm" onClick={() => { setEditRow(null); setForm({ weight: 0.8 }); setShowModal(true); }}
          className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus size={14} className="mr-1" /> Tambah Keyword
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-32"><RefreshCw className="animate-spin text-orange-400" size={24} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-left">
                <th className="pb-2 pr-3">Term</th>
                <th className="pb-2 pr-3">Bobot</th>
                <th className="pb-2 pr-3">Konfigurasi</th>
                <th className="pb-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-slate-500">Belum ada keyword.</td></tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-3 text-white font-mono">{row.term}</td>
                  <td className="py-2 pr-3 text-slate-400">{Number(row.weight).toFixed(2)}</td>
                  <td className="py-2 pr-3 text-slate-400 text-xs">{row.config_name ?? "— Global —"}</td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <button onClick={() => { setEditRow(row); setForm(row); setShowModal(true); }}
                        className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white"><Pencil size={13} /></button>
                      <button onClick={() => deactivate(row)}
                        className="p-1.5 rounded hover:bg-red-900 text-slate-400 hover:text-red-300"><PowerOff size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader><DialogTitle>{editRow ? "Edit" : "Tambah"} Keyword</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-slate-300">Term / Kata Kunci *</Label>
              <Input value={form.term ?? ""} onChange={e => setForm((f: any) => ({ ...f, term: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white mt-1 font-mono"
                placeholder="cth. biaya administrasi" />
            </div>
            <div>
              <Label className="text-slate-300">Bobot (0–1)</Label>
              <Input type="number" min={0} max={1} step={0.05} value={form.weight ?? 0.8}
                onChange={e => setForm((f: any) => ({ ...f, weight: parseFloat(e.target.value) || 0.8 }))}
                className="bg-slate-800 border-slate-600 text-white mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)} className="border-slate-600 text-slate-300">Batal</Button>
            <Button onClick={save} disabled={saving || !form.term} className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving && <RefreshCw size={14} className="animate-spin mr-1" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Approval Rules tab ────────────────────────────────────────────────────────

function ApprovalRulesTab() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState<any>({ approval_level: 1 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(activeCompanyId ? { company_id: String(activeCompanyId) } : {});
      const r = await fetch(`${API}/recon-classification/approval-rules?${params}`, { credentials: "include" });
      const j = await r.json();
      setRows(j.data ?? []);
    } finally { setLoading(false); }
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const url    = editRow ? `${API}/recon-classification/approval-rules/${editRow.id}` : `${API}/recon-classification/approval-rules`;
      const method = editRow ? "PATCH" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, company_id: activeCompanyId ?? null }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.error ?? "Gagal."); return; }
      setShowModal(false);
      load();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={load} className="border-slate-600 text-slate-300"><RefreshCw size={14} /></Button>
        <Button size="sm" onClick={() => { setEditRow(null); setForm({ approval_level: 1 }); setShowModal(true); }}
          className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus size={14} className="mr-1" /> Tambah Rule
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-32"><RefreshCw className="animate-spin text-orange-400" size={24} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-left">
                <th className="pb-2 pr-3">Nama</th>
                <th className="pb-2 pr-3">Konfigurasi</th>
                <th className="pb-2 pr-3">Min Amount</th>
                <th className="pb-2 pr-3">Max Amount</th>
                <th className="pb-2 pr-3">Role Approver</th>
                <th className="pb-2 pr-3">Level</th>
                <th className="pb-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-slate-500">Belum ada approval rule.</td></tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-3 text-white">{row.name}</td>
                  <td className="py-2 pr-3 text-slate-400 text-xs">{row.config_name ?? "—"}</td>
                  <td className="py-2 pr-3 text-slate-400">{row.min_amount ? `Rp ${Number(row.min_amount).toLocaleString()}` : "—"}</td>
                  <td className="py-2 pr-3 text-slate-400">{row.max_amount ? `Rp ${Number(row.max_amount).toLocaleString()}` : "—"}</td>
                  <td className="py-2 pr-3 text-slate-400">{row.required_approver_role ?? "—"}</td>
                  <td className="py-2 pr-3 text-slate-400">{row.approval_level}</td>
                  <td className="py-2">
                    <button onClick={() => { setEditRow(row); setForm(row); setShowModal(true); }}
                      className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white"><Pencil size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader><DialogTitle>{editRow ? "Edit" : "Tambah"} Approval Rule</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-slate-300">Nama *</Label>
              <Input value={form.name ?? ""} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300">Min Amount (Rp)</Label>
                <Input type="number" value={form.min_amount ?? ""}
                  onChange={e => setForm((f: any) => ({ ...f, min_amount: e.target.value ? Number(e.target.value) : null }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300">Max Amount (Rp)</Label>
                <Input type="number" value={form.max_amount ?? ""}
                  onChange={e => setForm((f: any) => ({ ...f, max_amount: e.target.value ? Number(e.target.value) : null }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-slate-300">Required Approver Role</Label>
              <Input value={form.required_approver_role ?? ""}
                onChange={e => setForm((f: any) => ({ ...f, required_approver_role: e.target.value || null }))}
                className="bg-slate-800 border-slate-600 text-white mt-1" placeholder="cth. manager, finance_head" />
            </div>
            <div>
              <Label className="text-slate-300">Approval Level</Label>
              <Input type="number" min={1} max={10} value={form.approval_level ?? 1}
                onChange={e => setForm((f: any) => ({ ...f, approval_level: parseInt(e.target.value) || 1 }))}
                className="bg-slate-800 border-slate-600 text-white mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)} className="border-slate-600 text-slate-300">Batal</Button>
            <Button onClick={save} disabled={saving || !form.name} className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving && <RefreshCw size={14} className="animate-spin mr-1" />}Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Upload Requirements tab (derived from configs) ────────────────────────────

function UploadRequirementsTab() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        include_inactive: "false",
        ...(activeCompanyId ? { company_id: String(activeCompanyId) } : {}),
      });
      const r = await fetch(`${API}/recon-classification/configs?${params}`, { credentials: "include" });
      const j = await r.json();
      // Filter only those with upload requirement set
      setRows((j.data ?? []).filter((x: any) => x.need_upload !== "none"));
    } finally { setLoading(false); }
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">
        Syarat upload diatur per konfigurasi. Gunakan tab Tipe Bisnis, Biaya Rutin, atau Alokasi Pendapatan untuk mengubah pengaturan upload.
      </p>
      {loading ? (
        <div className="flex items-center justify-center h-32"><RefreshCw className="animate-spin text-orange-400" size={24} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-slate-400 text-left">
                <th className="pb-2 pr-3">Konfigurasi</th>
                <th className="pb-2 pr-3">Kategori</th>
                <th className="pb-2 pr-3">Requirement</th>
                <th className="pb-2 pr-3">Jenis File</th>
                <th className="pb-2 pr-3">Maks. File</th>
                <th className="pb-2">Maks. Ukuran</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-slate-500">Belum ada konfigurasi dengan syarat upload.</td></tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-3 text-white">{row.name}</td>
                  <td className="py-2 pr-3 text-slate-400 text-xs">{row.category}</td>
                  <td className="py-2 pr-3">
                    <Badge className={row.need_upload === "required" ? "bg-red-900 text-red-300 text-xs" : "bg-amber-900 text-amber-300 text-xs"}>
                      {UPLOAD_OPTS.find(u => u.value === row.need_upload)?.label}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-slate-400 text-xs font-mono">
                    {(Array.isArray(row.upload_file_types) ? row.upload_file_types : JSON.parse(row.upload_file_types ?? "[]")).join(", ") || "—"}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{row.upload_max_files}</td>
                  <td className="py-2 text-slate-400">{row.upload_max_size_mb} MB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Usage Stats Tab ──────────────────────────────────────────────────────────

function UsageStatsTab() {
  const { activeCompanyId } = useCompany();
  const [stats, setStats]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "10" });
      if (activeCompanyId) params.set("company_id", String(activeCompanyId));
      const r = await fetch(`${API}/recon-classification/usage-stats?${params}`, { credentials: "include" });
      if (!r.ok) { setError("Gagal memuat statistik."); return; }
      setStats(await r.json());
    } catch { setError("Gagal memuat statistik."); }
    finally { setLoading(false); }
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-slate-400">
      <RefreshCw size={18} className="animate-spin mr-2" /> Memuat statistik...
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-2 text-red-400 py-8">
      <AlertCircle size={16} /> {error}
    </div>
  );
  if (!stats) return null;

  const { summary, mostUsedCategories = [], leastUsedCategories = [],
          neverUsedCategories = [], topRules = [], topKeywords = [], recentUsage = [] } = stats;

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const fmtNum  = (n: number) => n.toLocaleString("id-ID");

  return (
    <div className="space-y-6">
      {/* Refresh */}
      <div className="flex justify-end">
        <button onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 text-sm transition-colors">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Usage",       value: fmtNum(summary.totalUsage),          icon: BarChart2,      tip: "Total reconciliation actions tracked across all configs" },
          { label: "Hari Ini",          value: fmtNum(summary.usageToday),           icon: Clock,          tip: "Usage events recorded today" },
          { label: "Bulan Ini",         value: fmtNum(summary.usageThisMonth),        icon: TrendingUp,     tip: "Usage events this calendar month" },
          { label: "Aktif",             value: fmtNum(summary.activeCategories),      icon: CheckCircle2,   tip: "Active classification configs" },
          { label: "Belum Dipakai",     value: fmtNum(summary.neverUsedCategories),   icon: AlertCircle,    tip: "Active configs with zero usage — candidates for review" },
        ].map(({ label, value, icon: Icon, tip }) => (
          <div key={label} className="bg-slate-800 rounded-lg p-4 border border-slate-700" title={tip}>
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Icon size={13} /> {label}
            </div>
            <p className="text-xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most used */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
            <TrendingUp size={14} className="text-green-400" /> Paling Sering Dipakai
            <span className="text-slate-500 font-normal text-xs ml-1"
              title="Total times this config was matched and approved in bank reconciliation">
              (total approval match)
            </span>
          </h3>
          {mostUsedCategories.length === 0
            ? <p className="text-slate-500 text-sm py-4 text-center">Belum ada penggunaan.</p>
            : (
              <div className="space-y-2">
                {mostUsedCategories.slice(0, 10).map((row: any) => (
                  <div key={row.id} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 border border-slate-700/50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-medium truncate">{row.name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {row.category} · {row.last_used_by ?? "—"}
                        {row.last_used_at ? ` · ${fmtDate(row.last_used_at)}` : ""}
                      </p>
                    </div>
                    <span className="ml-3 text-green-400 font-bold text-sm whitespace-nowrap">
                      {fmtNum(row.usage_count)}×
                    </span>
                  </div>
                ))}
              </div>
            )}
        </div>

        {/* Never used */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
            <AlertCircle size={14} className="text-yellow-400" /> Belum Pernah Dipakai
            <span className="text-slate-500 font-normal text-xs ml-1"
              title="Active configs that have never been matched in any reconciliation">
              (aktif, usage = 0)
            </span>
          </h3>
          {neverUsedCategories.length === 0
            ? <p className="text-slate-500 text-sm py-4 text-center">Semua konfigurasi sudah pernah dipakai.</p>
            : (
              <div className="space-y-2">
                {neverUsedCategories.slice(0, 10).map((row: any) => (
                  <div key={row.id} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 border border-slate-700/50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-medium truncate">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.category} · {row.code}</p>
                    </div>
                    <span className="ml-3 text-yellow-500 text-xs whitespace-nowrap">Belum dipakai</span>
                  </div>
                ))}
              </div>
            )}
        </div>

        {/* Top AI Rules */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
            <Brain size={14} className="text-purple-400" /> Top AI Rules
            <span className="text-slate-500 font-normal text-xs ml-1"
              title="AI rule usage_count = times matched; accepted / (accepted+rejected) = acceptance rate. Rate is not shown if denominator is 0.">
              (match count + acceptance rate)
            </span>
          </h3>
          {topRules.length === 0
            ? <p className="text-slate-500 text-sm py-4 text-center">Belum ada AI rule yang dipakai.</p>
            : (
              <div className="space-y-2">
                {topRules.slice(0, 10).map((rule: any) => {
                  const denom = Number(rule.accepted_count ?? 0) + Number(rule.rejected_count ?? 0);
                  const rate  = denom > 0 ? Math.round(Number(rule.accepted_count) / denom * 100) : null;
                  return (
                    <div key={rule.id} className="bg-slate-800/60 rounded px-3 py-2 border border-slate-700/50">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-white font-medium truncate flex-1">{rule.name}</p>
                        <span className="ml-3 text-purple-300 font-bold text-sm">{fmtNum(rule.usage_count)}×</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span title="Times AI recommended this rule and user accepted">
                          ✓ {fmtNum(rule.accepted_count ?? 0)} acc
                        </span>
                        <span title="Times user rejected this recommendation">
                          ✗ {fmtNum(rule.rejected_count ?? 0)} rej
                        </span>
                        {rate !== null && (
                          <span className={rate >= 70 ? "text-green-400" : rate >= 40 ? "text-yellow-400" : "text-red-400"}
                            title="Acceptance rate = accepted / (accepted + rejected). Only shown when denominator > 0.">
                            {rate}% acc rate
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        {/* Top Keywords */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
            <Tag size={14} className="text-blue-400" /> Top Keywords
            <span className="text-slate-500 font-normal text-xs ml-1"
              title="All keywords that matched the mutation description in approved reconciliations are counted. Not just the winning keyword.">
              (semua keyword yang match)
            </span>
          </h3>
          {topKeywords.length === 0
            ? <p className="text-slate-500 text-sm py-4 text-center">Belum ada keyword yang dipakai.</p>
            : (
              <div className="space-y-2">
                {topKeywords.slice(0, 10).map((kw: any) => (
                  <div key={kw.id} className="flex items-center justify-between bg-slate-800/60 rounded px-3 py-2 border border-slate-700/50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-medium truncate">"{kw.term}"</p>
                      <p className="text-xs text-slate-500 truncate">
                        {kw.config_name ? `→ ${kw.config_name}` : "global"} · weight {Number(kw.weight).toFixed(2)}
                      </p>
                    </div>
                    <span className="ml-3 text-blue-300 font-bold text-sm">{fmtNum(kw.usage_count)}×</span>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>

      {/* Recent Usage */}
      {recentUsage.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
            <Clock size={14} className="text-slate-400" /> Aktivitas Terbaru
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 text-xs">
                  <th className="text-left pb-2 font-medium">Waktu</th>
                  <th className="text-left pb-2 font-medium">Tipe</th>
                  <th className="text-left pb-2 font-medium">Konfigurasi</th>
                  <th className="text-left pb-2 font-medium">Mutasi</th>
                  <th className="text-left pb-2 font-medium">Aktor</th>
                  <th className="text-right pb-2 font-medium">Jumlah</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {recentUsage.map((ev: any) => (
                  <tr key={ev.id} className="text-slate-300 hover:bg-slate-800/30">
                    <td className="py-2 text-xs text-slate-500 whitespace-nowrap">{fmtDate(ev.used_at)}</td>
                    <td className="py-2 text-xs capitalize">{ev.usage_type}</td>
                    <td className="py-2 max-w-[180px] truncate text-xs">{ev.config_name ?? `ID:${ev.target_id}`}</td>
                    <td className="py-2 text-xs">{ev.mutation_id ?? "—"}</td>
                    <td className="py-2 text-xs truncate max-w-[120px]">{ev.actor_user_id ?? "—"}</td>
                    <td className="py-2 text-right text-xs">
                      {ev.amount != null ? `Rp ${Number(ev.amount).toLocaleString("id-ID")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ReconClassificationConfigPage() {
  const [tab, setTab] = useState("business");

  const TABS = [
    { value: "business",  label: "Tipe Bisnis",          icon: BookOpen },
    { value: "routine",   label: "Biaya Rutin",           icon: RefreshCw },
    { value: "income",    label: "Alokasi Pendapatan",    icon: SlidersHorizontal },
    { value: "ai-rules",  label: "Rule AI",               icon: Brain },
    { value: "keywords",  label: "Kamus Keyword",         icon: Tag },
    { value: "upload",    label: "Syarat Upload",         icon: Upload },
    { value: "approval",  label: "Rule Approval",         icon: Shield },
    { value: "stats",     label: "Statistik Penggunaan",  icon: BarChart2 },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <button onClick={() => window.history.back()} aria-label="Kembali"
          className="rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <SlidersHorizontal size={24} className="text-orange-400" />
        <div>
          <h1 className="text-2xl font-black text-white">Bank Reconciliation Configuration</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Kelola master data klasifikasi transaksi rekonsiliasi bank
          </p>
        </div>
      </div>

      <Card className="bg-slate-900 border-slate-700">
        <CardContent className="p-0">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full justify-start bg-slate-800 rounded-none border-b border-slate-700 h-auto p-0 flex-wrap">
              {TABS.map(t => {
                const Icon = t.icon;
                return (
                  <TabsTrigger key={t.value} value={t.value}
                    className="flex items-center gap-1.5 px-4 py-3 text-sm rounded-none border-b-2 border-transparent
                               data-[state=active]:border-orange-400 data-[state=active]:text-orange-400
                               data-[state=active]:bg-transparent text-slate-400 hover:text-slate-200 transition-colors">
                    <Icon size={14} />
                    {t.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <div className="p-5">
              <TabsContent value="business" className="mt-0">
                <ConfigTab category="BUSINESS_TRANSACTION" />
              </TabsContent>
              <TabsContent value="routine" className="mt-0">
                <ConfigTab category="ROUTINE_EXPENSE" />
              </TabsContent>
              <TabsContent value="income" className="mt-0">
                <ConfigTab category="INCOME_ALLOCATION" />
              </TabsContent>
              <TabsContent value="ai-rules" className="mt-0">
                <AiRulesTab />
              </TabsContent>
              <TabsContent value="keywords" className="mt-0">
                <KeywordTab />
              </TabsContent>
              <TabsContent value="upload" className="mt-0">
                <UploadRequirementsTab />
              </TabsContent>
              <TabsContent value="approval" className="mt-0">
                <ApprovalRulesTab />
              </TabsContent>
              <TabsContent value="stats" className="mt-0">
                <UsageStatsTab />
              </TabsContent>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
