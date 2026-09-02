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
  Search, Loader2,
} from "lucide-react";

const API = "/api";

const FLOWS = [
  { value: "BUSINESS_MATCHING",           label: "Business Matching" },
  { value: "ROUTINE_EXPENSE_ALLOCATION",  label: "Routine Expense Allocation" },
  { value: "INTERNAL_TRANSFER",           label: "Internal Transfer (bukan beban)" },
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

const TAX_TYPES = [
  { value: "none", label: "Tidak ada pajak" },
  { value: "ppn_input", label: "PPN Masukan" },
  { value: "ppn_output", label: "PPN Keluaran" },
] as const;

const COND_FIELDS = [
  { value: "description", label: "Deskripsi" },
  { value: "amount",      label: "Jumlah" },
  { value: "direction",   label: "Arah (IN/OUT)" },
  { value: "bank",        label: "Bank" },
  { value: "transaction_code", label: "Kode Transaksi" },
  { value: "normalized",  label: "Normalized" },
];

const COND_OPS = [
  { value: "contains",    label: "Contains" },
  { value: "not_contains", label: "Tidak mengandung" },
  { value: "starts_with", label: "Starts With" },
  { value: "ends_with",   label: "Ends With" },
  { value: "equals",      label: "=" },
  { value: "not_equals",  label: "≠" },
  { value: "gte",         label: "≥" },
  { value: "lte",         label: "≤" },
];

function jsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeCondition(value: unknown) {
  const condition = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    field: typeof condition.field === "string" && condition.field
      ? condition.field
      : "description",
    operator: typeof condition.operator === "string" && condition.operator
      ? condition.operator
      : "contains",
    value: condition.value == null ? "" : String(condition.value),
    negate: Boolean(condition.negate),
  };
}

function normalizeConditions(value: unknown): any[] {
  return jsonArray(value)
    .filter((condition) => condition && typeof condition === "object" && !Array.isArray(condition))
    .map(normalizeCondition);
}

function ruleConditions(row: any): any[] {
  const embedded = normalizeConditions(row?.conditions);
  if (embedded.length) return embedded;

  const stored = normalizeConditions(row?.conditions_json);
  if (stored.length) return stored;

  if (typeof row?.conditions_json === "string" && jsonArray(row.conditions_json).length) {
    return stored;
  }

  return row?.condition_value
    ? [normalizeCondition({
      field: row.condition_field,
      operator: row.condition_operator,
      value: row.condition_value,
    })]
    : [];
}

function conditionSummary(row: any): string {
  const conditions = ruleConditions(row);
  const logic = row?.logic === "OR" ? " OR " : " AND ";
  return conditions.map((c: any) => `${c?.negate ? "NOT " : ""}${c?.value ?? ""}`).join(logic) || "—";
}

function flowBadge(flow: string) {
  const colors: Record<string, string> = {
    BUSINESS_MATCHING:           "bg-blue-900 text-blue-300",
    ROUTINE_EXPENSE_ALLOCATION:  "bg-amber-900 text-amber-300",
    INTERNAL_TRANSFER:           "bg-cyan-900 text-cyan-300",
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

function expectedActionCoaType(flow: string | null | undefined): "expense" | "revenue" | null {
  if (flow === "ROUTINE_EXPENSE_ALLOCATION") return "expense";
  if (flow === "INCOME_ALLOCATION") return "revenue";
  return null;
}

function taxTreatmentForFlow(flow: string | null | undefined): {
  label: string;
  description: string;
  tone: "blue" | "green" | "slate";
} {
  if (flow === "ROUTINE_EXPENSE_ALLOCATION") {
    return {
      label: "Otomatis — PPN Masukan",
      description: "Untuk invoice beban/pembelian, OCR mengambil PPN dari invoice dan mengarahkannya ke akun PPN Masukan perusahaan.",
      tone: "blue",
    };
  }
  if (flow === "INCOME_ALLOCATION") {
    return {
      label: "Otomatis — PPN Keluaran",
      description: "Untuk invoice pendapatan/penjualan, OCR mengambil PPN dari invoice dan mengarahkannya ke akun PPN Keluaran perusahaan.",
      tone: "green",
    };
  }
  return {
    label: "Otomatis dari konteks dokumen",
    description: "Arah PPN ditentukan dari konteks transaksi dan hasil OCR. Jika bukti atau konteks tidak cukup, transaksi masuk review manual.",
    tone: "slate",
  };
}

interface RuleCoaAccount {
  id: number;
  companyId?: number | null;
  code: string;
  name: string;
  type: string;
  normalBalance?: "DEBIT" | "CREDIT" | string | null;
  parentId?: number | null;
  isActive?: boolean | null;
  isPostable?: boolean | null;
  isHeader?: boolean | null;
}

function nextSequentialChildCode(parent: RuleCoaAccount, accounts: RuleCoaAccount[]): string {
  const match = parent.code.match(/^(.*?)(\d+)([^0-9]*)$/);
  if (!match) return `${parent.code}-01`;

  const [, prefix, digits, suffix] = match;
  const usedNumbers = new Set(
    accounts
      .map((account) => account.code.match(/^(.*?)(\d+)([^0-9]*)$/))
      .filter((candidate): candidate is RegExpMatchArray =>
        !!candidate && candidate[1] === prefix && candidate[3] === suffix,
      )
      .map((candidate) => Number(candidate[2]))
      .filter(Number.isFinite),
  );

  let nextNumber = Number(digits) + 1;
  while (usedNumbers.has(nextNumber)) nextNumber += 1;
  return `${prefix}${String(nextNumber).padStart(digits.length, "0")}${suffix}`;
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
      const [deptR, ccR] = await Promise.all([
        fetch(`${API}/org/departments${qp}`,  { credentials: "include" }),
        fetch(`${API}/accounting/cost-centers${qp}`, { credentials: "include" }),
      ]);
      const [deptJ, ccJ] = await Promise.all([deptR.json(), ccR.json()]);

      const depts = Array.isArray(deptJ) ? deptJ : (deptJ.data ?? []);
      const ccs   = Array.isArray(ccJ)   ? ccJ   : (ccJ.data   ?? []);

      setDeptOptions(depts
        .filter((d: any) => d?.name != null && String(d.name).trim())
        .map((d: any) => ({
          value: String(d.name),
          label: d.code ? `${String(d.code)} — ${String(d.name)}` : String(d.name),
        })));
      setCcOptions(ccs
        .filter((c: any) => c?.code != null && String(c.code).trim())
        .map((c: any) => ({
          value: String(c.code),
          label: `${String(c.code)} — ${String(c.name ?? "Tanpa nama")}`,
        })));
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
      keywords: jsonArray(row.keywords),
      upload_file_types: jsonArray(row.upload_file_types),
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
                <th className="pb-2 pr-3 font-medium">Upload</th>
                <th className="pb-2 pr-3 font-medium">Prioritas</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-slate-500">Belum ada data.</td></tr>
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

            <div className="grid grid-cols-2 gap-3">
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
                // Keep raw text while editing so a trailing comma is not
                // removed before the user can type the next keyword.
                // Normalization into an array happens in save().
                onChange={e => setForm((f: any) => ({ ...f, keywords: e.target.value }))}
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
  const [coaOptions, setCoaOptions] = useState<ComboboxOption[]>([]);
  const [coaAccounts, setCoaAccounts] = useState<RuleCoaAccount[]>([]);
  const [loadingCoaOptions, setLoadingCoaOptions] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [creatingCoa, setCreatingCoa] = useState(false);
  const [creatingCoaLoading, setCreatingCoaLoading] = useState(false);
  const [quickCreateChild, setQuickCreateChild] = useState(false);
  const [newCoaRole, setNewCoaRole] = useState<"parent" | "child">("child");
  const [parentSearch, setParentSearch] = useState("");
  const [newCoaForm, setNewCoaForm] = useState({
    code: "",
    name: "",
    type: "revenue",
    parentId: null as number | null,
  });
  const [editRow, setEditRow] = useState<any>(null);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState<any>({});
  const [previewText, setPreviewText] = useState("");
  const [previewAmount, setPreviewAmount] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [ruleSearch, setRuleSearch] = useState("");
  const [coaDirectionFilter, setCoaDirectionFilter] = useState<"all" | "in" | "out">("all");

  const loadCoaOptions = useCallback(async () => {
    setLoadingCoaOptions(true);
    try {
      const qp = activeCompanyId ? `?company_id=${activeCompanyId}` : "";
      const r = await fetch(`${API}/recon-classification/coa-options${qp}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal mengambil akun COA");
      const j = await r.json();
      const coas = Array.isArray(j) ? j : (j.data ?? []);
      const normalized = coas
        .filter((c: any) => c && (c.code ?? c.coa_code))
        .map((c: any) => ({
          id: Number(c.id),
          companyId: c.companyId ?? c.company_id ?? null,
          code: String(c.code ?? c.coa_code),
          name: String(c.name ?? c.coa_name ?? "Tanpa nama"),
          type: String(c.type ?? "").toLowerCase(),
          normalBalance: c.normalBalance ?? c.normal_balance ?? null,
          parentId: c.parentId ?? c.parent_id ?? null,
          isActive: c.isActive ?? c.is_active ?? true,
          isPostable: c.isPostable ?? c.is_postable ?? true,
          isHeader: c.isHeader ?? c.is_header ?? false,
        }));
      setCoaAccounts(normalized);
      setCoaOptions(normalized
        .filter((c: RuleCoaAccount) => c.isActive !== false && c.isPostable !== false)
        .map((c: RuleCoaAccount) => ({
          value: c.code,
          label: `${c.code} — ${c.name}`,
        })));
    } catch {
      setCoaAccounts([]);
      setCoaOptions([]);
    } finally {
      setLoadingCoaOptions(false);
    }
  }, [activeCompanyId]);

  const taxAccountFor = (taxType: string): RuleCoaAccount | null => {
    if (taxType !== "ppn_input" && taxType !== "ppn_output") return null;
    const baseCode = taxType === "ppn_input" ? "1-1050" : "2-1020";
    return coaAccounts
      .filter((account) =>
        account.isActive !== false
        && account.isPostable !== false
        && (account.code === baseCode || account.code.startsWith(`${baseCode}-`)
          || account.name.toLowerCase().includes(taxType === "ppn_input" ? "ppn masukan" : "ppn keluaran")),
      )
      .sort((a, b) => {
        const aExact = a.code === baseCode ? 0 : a.name.toLowerCase().includes(taxType === "ppn_input" ? "ppn masukan" : "ppn keluaran") ? 1 : 2;
        const bExact = b.code === baseCode ? 0 : b.name.toLowerCase().includes(taxType === "ppn_input" ? "ppn masukan" : "ppn keluaran") ? 1 : 2;
        return aExact - bExact || a.code.localeCompare(b.code);
      })[0] ?? null;
  };

  const setTaxType = (taxType: string) => {
    const account = taxAccountFor(taxType);
    setForm((current: any) => ({
      ...current,
      tax_type: taxType,
      action_coa_code: taxType === "none" ? null : account?.code ?? current.action_coa_code ?? null,
    }));
  };

  const loadParentAccounts = useCallback(async () => {
    if (activeCompanyId == null) return;
    setCreatingCoaLoading(true);
    try {
      const params = new URLSearchParams({
        companyId: String(activeCompanyId),
        includeHeaders: "true",
      });
      const r = await fetch(`${API}/accounting/accounts?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal mengambil daftar parent COA");
      const accounts = await r.json();
      setCoaAccounts((current) => {
        const incoming = (Array.isArray(accounts) ? accounts : []).map((c: any): RuleCoaAccount => ({
          id: Number(c.id),
          companyId: c.companyId ?? c.company_id ?? null,
          code: String(c.code ?? ""),
          name: String(c.name ?? ""),
          type: String(c.type ?? "").toLowerCase(),
          normalBalance: c.normalBalance ?? c.normal_balance ?? null,
          parentId: c.parentId ?? c.parent_id ?? null,
          isActive: c.isActive ?? c.is_active ?? true,
          isPostable: c.isPostable ?? c.is_postable ?? true,
          isHeader: c.isHeader ?? c.is_header ?? false,
        })).filter((c) => c.id > 0 && c.code && c.name);
        const byId = new Map(current.map((account) => [account.id, account]));
        incoming.forEach((account) => byId.set(account.id, account));
        return Array.from(byId.values());
      });
    } finally {
      setCreatingCoaLoading(false);
    }
  }, [activeCompanyId]);

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
  useEffect(() => { loadCoaOptions(); }, [loadCoaOptions]);

  const openAdd = () => {
    setEditRow(null);
    setForm({ condition_field: "description", condition_operator: "contains", condition_value: "",
      conditions: [{ field: "description", operator: "contains", value: "" }], logic: "AND",
      specificity: 1, amount_tolerance: 0, reference_amount: null,
      confidence: 0.8, priority: 50, source: "manual",
      requires_document_upload: false, tax_type: "none" });
    setCreatingCoa(false);
    setQuickCreateChild(false);
    setNewCoaRole("child");
    setParentSearch("");
    setNewCoaForm({
      code: "",
      name: "",
      type: "revenue",
      parentId: null,
    });
    setPreview(null);
    setPreviewAmount("");
    setShowModal(true);
  };

  const openEdit = (row: any) => {
    const conditions = ruleConditions(row);
    setEditRow(row);
    setForm({ ...row, conditions: conditions.length ? conditions : [{ field: "description", operator: "contains", value: "" }],
      logic: row.logic === "OR" ? "OR" : "AND", confidence: Number(row.confidence ?? 0.8),
      priority: Number(row.priority ?? 50), specificity: Number(row.specificity ?? Math.max(1, conditions.length)),
      // Before the reference-amount field existed, this screen incorrectly
      // stored its nominal input as amount_tolerance. Treat that legacy value
      // as the reference when opening it so saving repairs the rule.
      reference_amount: row.reference_amount != null && Number(row.reference_amount) !== 0
        ? Number(row.reference_amount)
        : row.amount_tolerance != null && Number(row.amount_tolerance) > 0
          ? Number(row.amount_tolerance)
          : null,
      amount_tolerance: row.reference_amount != null && row.amount_tolerance != null
        ? Number(row.amount_tolerance)
         : 0,
       requires_document_upload: Boolean(row.requires_document_upload),
       tax_type: row.tax_type === "ppn_input" || row.tax_type === "ppn_output" ? row.tax_type : "none" });
    setCreatingCoa(false);
    setQuickCreateChild(false);
    setParentSearch("");
    setPreview(null);
    setPreviewAmount("");
    setShowModal(true);
  };

  const updateCondition = (index: number, patch: any) => {
    setForm((f: any) => ({ ...f, conditions: (f.conditions ?? []).map((c: any, i: number) => i === index ? { ...c, ...patch } : c) }));
  };
  const addCondition = () => setForm((f: any) => ({ ...f,
    conditions: [...(f.conditions ?? []), { field: "description", operator: "contains", value: "" }],
    specificity: (f.conditions?.length ?? 0) + 1 }));
  const removeCondition = (index: number) => setForm((f: any) => {
    const conditions = (f.conditions ?? []).filter((_: any, i: number) => i !== index);
    return { ...f, conditions, specificity: Math.max(1, conditions.length) };
  });

  const expectedCoaType = expectedActionCoaType(form.action_flow);
  const selectedActionCoa = coaAccounts.find((account) => account.code === form.action_coa_code);
  const actionCoaMismatch = Boolean(
    expectedCoaType &&
    (!selectedActionCoa || selectedActionCoa.type?.toLowerCase() !== expectedCoaType),
  );
  const taxTreatment = taxTreatmentForFlow(form.action_flow);
  const actionCoaOptions = coaOptions.filter((option) => {
    if (!expectedCoaType) return true;
    const account = coaAccounts.find((candidate) => candidate.code === option.value);
    return account?.type?.toLowerCase() === expectedCoaType || option.value === form.action_coa_code;
  });

  const parentAccounts = coaAccounts
    .filter((account) =>
      account.isActive !== false
      && (account.isHeader === true || account.isPostable === false)
      && account.type === newCoaForm.type,
    )
    .filter((account) => {
      const query = parentSearch.trim().toLowerCase();
      return !query || `${account.code} ${account.name}`.toLowerCase().includes(query);
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const startCreateCoa = () => {
    setCreatingCoa(true);
    setQuickCreateChild(false);
    setNewCoaRole("child");
    setParentSearch("");
    setNewCoaForm((current) => ({
      ...current,
      name: current.name || String(form.name ?? "").trim(),
      parentId: null,
       type: form.action_flow === "INTERNAL_TRANSFER"
         ? "asset"
         : form.action_flow === "ROUTINE_EXPENSE_ALLOCATION"
           ? "expense"
           : "revenue",
    }));
    void loadParentAccounts();
  };

  const startCreateChildCoa = () => {
    const selected = coaAccounts.find((account) => account.code === form.action_coa_code);
    if (!selected) {
      alert("Pilih COA parent terlebih dahulu.");
      return;
    }

    setCreatingCoa(true);
    setQuickCreateChild(true);
    setNewCoaRole("child");
    setParentSearch("");
    setNewCoaForm({
      code: nextSequentialChildCode(selected, coaAccounts),
      name: "",
      type: selected.type || "expense",
      parentId: selected.id,
    });
    void loadParentAccounts();
  };

  const createCoa = async () => {
    if (activeCompanyId == null) {
      alert("Pilih perusahaan aktif terlebih dahulu.");
      return;
    }
    const code = newCoaForm.code.trim();
    const name = newCoaForm.name.trim();
    if (!code || !name) {
      alert("Kode dan nama COA wajib diisi.");
      return;
    }
    if (newCoaRole === "child" && !newCoaForm.parentId) {
      alert("Pilih parent untuk COA child.");
      return;
    }

    setCreatingCoaLoading(true);
    try {
      const normalBalance = ["revenue", "liability", "equity"].includes(newCoaForm.type)
        ? "CREDIT"
        : "DEBIT";
      const r = await fetch(`${API}/accounting/accounts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: activeCompanyId,
          code,
          name,
          type: newCoaForm.type,
          parentId: newCoaRole === "child" ? newCoaForm.parentId : null,
          isActive: true,
          accountCategory: newCoaForm.type.toUpperCase(),
          normalBalance,
          isHeader: newCoaRole === "parent",
          isPostable: newCoaRole !== "parent",
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message ?? body.error ?? "Gagal membuat COA baru.");
      const created = body as RuleCoaAccount;
      setForm((current: any) => ({
        ...current,
        action_coa_code: created.code || code,
      }));
      await loadCoaOptions();
      setCreatingCoa(false);
      setQuickCreateChild(false);
      setNewCoaForm((current) => ({ ...current, code: "", name: "", parentId: null }));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Gagal membuat COA baru.");
    } finally {
      setCreatingCoaLoading(false);
    }
  };

  const save = async () => {
    const expectedType = expectedActionCoaType(form.action_flow);
    const selectedCoa = coaAccounts.find((account) => account.code === form.action_coa_code);
    if (expectedType && (!selectedCoa || selectedCoa.type?.toLowerCase() !== expectedType)) {
      alert(
        `Action Flow ${expectedType === "expense" ? "beban" : "pendapatan"} wajib memakai akun COA tipe ${expectedType}. ` +
        "Akun PPN Masukan/Keluaran dipetakan terpisah dari hasil OCR.",
      );
      return;
    }
    setSaving(true);
    try {
      const url    = editRow ? `${API}/recon-classification/ai-rules/${editRow.id}` : `${API}/recon-classification/ai-rules`;
      const method = editRow ? "PATCH" : "POST";
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, conditions: form.conditions,
          condition_field: form.conditions?.[0]?.field ?? form.condition_field,
          condition_operator: form.conditions?.[0]?.operator ?? form.condition_operator,
          condition_value: form.conditions?.[0]?.value ?? form.condition_value,
           reference_amount: form.reference_amount === "" || form.reference_amount == null
             ? null
             : Number(form.reference_amount),
          company_id: activeCompanyId ?? null }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.error ?? "Gagal."); return; }
      setShowModal(false);
      load();
    } finally { setSaving(false); }
  };

  const runPreview = async () => {
    if (!previewText.trim()) return;
    setPreviewing(true);
    try {
      const r = await fetch(`${API}/recon-classification/ai-rules/preview`, { method: "POST",
        credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: previewText, company_id: activeCompanyId ?? null,
           amount: previewAmount === "" ? 0 : Number(previewAmount),
          conditions: form.conditions, logic: form.logic, specificity: form.specificity,
           action_flow: form.action_flow, action_coa_code: form.action_coa_code,
           amount_tolerance: form.amount_tolerance,
           reference_amount: form.reference_amount,
            requires_document_upload: Boolean(form.requires_document_upload),
            tax_type: form.tax_type ?? "none",
            has_document_upload: true,
           confidence: form.confidence }) });
      setPreview(await r.json());
    } finally { setPreviewing(false); }
  };

  const deactivate = async (row: any) => {
    if (!confirm(`Nonaktifkan rule "${row.name}"?`)) return;
    await fetch(`${API}/recon-classification/ai-rules/${row.id}`, { method: "DELETE", credentials: "include" });
    load();
  };

  const coaDetails = (row: any) => {
    const code = typeof row.action_coa_code === "string" && row.action_coa_code.trim()
      ? row.action_coa_code.trim()
      : null;
    if (!code) return null;

    const account = coaAccounts.find((coa) => coa.code === code);
    return {
      code,
      name: row.action_coa_name ?? account?.name ?? null,
    };
  };

  const coaDirection = (row: any): "in" | "out" | "other" => {
    const ruleIdentity = `${row.name ?? ""} ${row.description ?? ""}`.toLowerCase();
    if (/\b(coa\s+)?uang\s+masuk\b/.test(ruleIdentity) || row.action_flow === "INCOME_ALLOCATION") {
      return "in";
    }
    if (/\b(coa\s+)?uang\s+keluar\b/.test(ruleIdentity) || row.action_flow === "ROUTINE_EXPENSE_ALLOCATION") {
      return "out";
    }
    return "other";
  };

  const normalizedRuleSearch = ruleSearch.trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    const matchesDirection = coaDirectionFilter === "all" || coaDirection(row) === coaDirectionFilter;
    if (!matchesDirection) return false;
    if (!normalizedRuleSearch) return true;

    const coa = coaDetails(row);
    const searchableText = [
      conditionSummary(row),
      row.condition_field,
      row.condition_value,
      coa?.code,
      coa?.name,
      row.action_coa_code,
      row.action_coa_name,
    ].filter(Boolean).join(" ").toLowerCase();
    return searchableText.includes(normalizedRuleSearch);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[320px]">
          <div className="relative min-w-[260px] flex-1 max-w-xl">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
            <Input
              value={ruleSearch}
              onChange={(event) => setRuleSearch(event.target.value)}
              placeholder="Cari kondisi atau keterangan COA..."
              aria-label="Cari kondisi atau keterangan COA"
              className="bg-slate-800 border-slate-600 text-white pl-9"
            />
          </div>
          <Select value={coaDirectionFilter} onValueChange={(value) => setCoaDirectionFilter(value as "all" | "in" | "out")}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-[170px]" aria-label="Filter COA masuk atau keluar">
              <SelectValue placeholder="Filter COA" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600 text-white">
              <SelectItem value="all">Semua COA</SelectItem>
              <SelectItem value="in">COA Masuk</SelectItem>
              <SelectItem value="out">COA Keluar</SelectItem>
            </SelectContent>
          </Select>
          {(ruleSearch || coaDirectionFilter !== "all") && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRuleSearch("");
                setCoaDirectionFilter("all");
              }}
              className="text-slate-400 hover:text-white"
            >
              Reset filter
            </Button>
          )}
          <span className="text-xs text-slate-500 whitespace-nowrap">
            {filteredRows.length} dari {rows.length} rule
          </span>
        </div>
        <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={load} className="border-slate-600 text-slate-300"><RefreshCw size={14} /></Button>
        <Button size="sm" onClick={openAdd} className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus size={14} className="mr-1" /> Tambah Rule
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
                <th className="pb-2 pr-3">Nama</th>
                <th className="pb-2 pr-3">Kondisi</th>
                 <th className="pb-2 pr-3">Action Flow</th>
                 <th className="pb-2 pr-3">Keterangan COA</th>
                  <th className="pb-2 pr-3">Nominal referensi</th>
                 <th className="pb-2 pr-3">Conf.</th>
                <th className="pb-2 pr-3">Prioritas</th>
                 <th className="pb-2 pr-3">Dokumen / Pajak</th>
                 <th className="pb-2 pr-3">Sumber</th>
                <th className="pb-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                  <tr><td colSpan={10} className="py-8 text-center text-slate-500">Belum ada AI rule.</td></tr>
              )}
              {rows.length > 0 && filteredRows.length === 0 && (
                <tr><td colSpan={10} className="py-8 text-center text-slate-500">Tidak ada rule yang sesuai filter.</td></tr>
              )}
              {filteredRows.map(row => (
                <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-2 pr-3 text-white">{row.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-400">
                    {conditionSummary(row)}
                  </td>
                   <td className="py-2 pr-3">{row.action_flow ? flowBadge(row.action_flow) : "—"}</td>
                   <td className="py-2 pr-3 min-w-[170px]">
                     {(() => {
                       const coa = coaDetails(row);
                       return coa ? (
                         <div className="leading-tight">
                           <div className="font-mono text-xs text-orange-300">COA {coa.code}</div>
                           <div className="text-xs text-slate-300 mt-0.5">{coa.name ?? "Nama akun tidak ditemukan"}</div>
                         </div>
                       ) : (
                         <span className="text-slate-500">—</span>
                       );
                     })()}
                   </td>
                   <td className="py-2 pr-3 text-slate-400">
                      {row.reference_amount != null && Number(row.reference_amount) !== 0
                       ? `Rp${Number(row.reference_amount).toLocaleString("id-ID")}`
                        : row.amount_tolerance != null && Number(row.amount_tolerance) > 0
                         ? `Rp${Number(row.amount_tolerance).toLocaleString("id-ID")}`
                         : "Tidak dibatasi"}
                   </td>
                  <td className="py-2 pr-3 text-slate-400">{Number(row.confidence).toFixed(2)}</td>
                  <td className="py-2 pr-3 text-slate-400">{row.priority}</td>
                   <td className="py-2 pr-3">
                     <div className="flex flex-wrap gap-1">
                       {row.requires_document_upload && (
                         <Badge className="bg-amber-900 text-amber-300 text-xs">Upload wajib</Badge>
                       )}
                       {row.tax_type === "ppn_input" && (
                         <Badge className="bg-cyan-900 text-cyan-300 text-xs">PPN Masukan</Badge>
                       )}
                       {row.tax_type === "ppn_output" && (
                         <Badge className="bg-cyan-900 text-cyan-300 text-xs">PPN Keluaran</Badge>
                       )}
                       {!row.requires_document_upload && (!row.tax_type || row.tax_type === "none") && "—"}
                     </div>
                   </td>
                   <td className="py-2 pr-3">
                    <Badge className={row.source === "ai_generated" ? "bg-purple-900 text-purple-300 text-xs" : "bg-slate-700 text-slate-300 text-xs"}>
                      {row.source === "ai_generated" ? "AI" : "Manual"}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(row)}
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
            <div className="border border-slate-700 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-slate-300">Kondisi Rule</Label>
                <Select value={form.logic ?? "AND"} onValueChange={v => setForm((f: any) => ({ ...f, logic: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-44 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    <SelectItem value="AND">SEMUA KONDISI (AND)</SelectItem>
                    <SelectItem value="OR">SALAH SATU KONDISI (OR)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(form.conditions ?? []).map((condition: any, index: number) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-2 items-end">
                  <div><Label className="text-slate-500 text-[11px]">Field</Label>
                    <Select value={condition.field} onValueChange={v => updateCondition(index, { field: v })}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600 text-white">{COND_FIELDS.map(cf => <SelectItem key={cf.value} value={cf.value}>{cf.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-slate-500 text-[11px]">Operator</Label>
                    <Select value={condition.operator} onValueChange={v => updateCondition(index, { operator: v })}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-600 text-white">{COND_OPS.map(co => <SelectItem key={co.value} value={co.value}>{co.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-slate-500 text-[11px]">Nilai *</Label>
                    <Input value={condition.value ?? ""} onChange={e => updateCondition(index, { value: e.target.value })}
                      className="bg-slate-800 border-slate-600 text-white mt-1 text-xs" />
                  </div>
                  <Button type="button" variant="ghost" onClick={() => removeCondition(index)} disabled={(form.conditions ?? []).length <= 1}
                    className="text-slate-500 hover:text-red-300 px-2">×</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addCondition} className="border-slate-600 text-slate-300">
                <Plus size={13} className="mr-1" /> Tambah Kondisi
              </Button>
              <p className="text-[11px] text-slate-500">NOT tersedia melalui operator “Tidak mengandung” atau “≠”.</p>
            </div>
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 space-y-1.5">
              <Label className="text-slate-300">Nominal referensi (Rp)</Label>
              <Input
                type="number"
                min={0}
                max={1_000_000_000}
                step={1}
                inputMode="numeric"
                value={form.reference_amount ?? ""}
                onChange={e => setForm((f: any) => ({
                  ...f,
                  reference_amount: e.target.value === "" ? null : Number(e.target.value),
                  // A nominal entered in this field is an exact reference,
                  // never an amount tolerance.
                  amount_tolerance: 0,
                }))}
                className="bg-slate-800 border-slate-600 text-white mt-1"
              />
              <p className="text-[11px] text-slate-500">
                Jika diisi, mutasi harus memiliki nominal yang sama persis dan
                tetap memenuhi semua kondisi di atas (AND). Kosong berarti nominal tidak menjadi syarat.
              </p>
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
                {form.action_flow === "INTERNAL_TRANSFER" && (
                  <p className="mt-1 text-[11px] text-cyan-300">
                    Transfer internal bukan beban P&amp;L. Pilih COA tujuan kas/bank yang aktif dan dapat diposting.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-slate-300">Akun COA</Label>
                {creatingCoa ? (
                  <div className="mt-1 space-y-3 rounded-md border border-indigo-400/40 bg-indigo-500/10 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">Buat COA baru</p>
                        <p className="text-[11px] text-slate-400">
                          Akun baru akan langsung ditambahkan ke perusahaan aktif dan dipilih untuk rule ini.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCreatingCoa(false)}
                        className="text-slate-300"
                      >
                        Kembali
                      </Button>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-slate-300 text-xs">Jenis akun</Label>
                      <Select
                        value={newCoaRole}
                        onValueChange={(value) => {
                          const role = value as "parent" | "child";
                          setNewCoaRole(role);
                          if (role === "parent") {
                            setParentSearch("");
                            setNewCoaForm((current) => ({ ...current, parentId: null }));
                          }
                        }}
                      >
                        <SelectTrigger className="bg-slate-800 border-slate-600 text-white text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-600 text-white">
                          <SelectItem value="parent">Parent / akun grup</SelectItem>
                          <SelectItem value="child">Child / akun detail</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-slate-300 text-xs">Kode COA</Label>
                        <Input
                          value={newCoaForm.code}
                          onChange={(event) => setNewCoaForm((current) => ({ ...current, code: event.target.value }))}
                          readOnly={quickCreateChild}
                          placeholder="Contoh: 4-1050"
                          className={`bg-slate-800 border-slate-600 text-white text-xs ${quickCreateChild ? "cursor-not-allowed opacity-70" : ""}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-slate-300 text-xs">Nama COA</Label>
                        <Input
                          value={newCoaForm.name}
                          onChange={(event) => setNewCoaForm((current) => ({ ...current, name: event.target.value }))}
                          placeholder="Contoh: Pendapatan Sewa Lapangan"
                          className="bg-slate-800 border-slate-600 text-white text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-slate-300 text-xs">Kelompok akun</Label>
                      <Select
                        value={newCoaForm.type}
                          disabled={quickCreateChild}
                        onValueChange={(value) => setNewCoaForm((current) => ({
                          ...current,
                          type: value,
                          parentId: null,
                        }))}
                      >
                        <SelectTrigger className="bg-slate-800 border-slate-600 text-white text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-600 text-white">
                          <SelectItem value="asset">Aset</SelectItem>
                          <SelectItem value="liability">Liabilitas</SelectItem>
                          <SelectItem value="equity">Ekuitas</SelectItem>
                          <SelectItem value="revenue">Pendapatan</SelectItem>
                          <SelectItem value="expense">Beban</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-slate-500">
                        Saldo normal otomatis: {["revenue", "liability", "equity"].includes(newCoaForm.type) ? "kredit" : "debit"}.
                      </p>
                    </div>

                    {newCoaRole === "child" && (
                      <div className="space-y-1">
                        <Label className="text-slate-300 text-xs">Parent akun</Label>
                        {quickCreateChild ? (
                          <div className="rounded-md border border-indigo-400/40 bg-slate-800 px-3 py-2 text-xs text-white">
                            {coaAccounts.find((account) => account.id === newCoaForm.parentId)?.code ?? "Parent terpilih"}
                            {" — "}
                            {coaAccounts.find((account) => account.id === newCoaForm.parentId)?.name ?? "Akun parent"}
                          </div>
                        ) : (
                          <>
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-slate-500" />
                              <Input
                                value={parentSearch}
                                onChange={(event) => setParentSearch(event.target.value)}
                                placeholder="Cari parent berdasarkan kode atau nama..."
                                className="bg-slate-800 border-slate-600 pl-7 text-white text-xs"
                              />
                            </div>
                            <Select
                              value={newCoaForm.parentId ? String(newCoaForm.parentId) : "__none"}
                              onValueChange={(value) => setNewCoaForm((current) => ({
                                ...current,
                                parentId: value === "__none" ? null : Number(value),
                              }))}
                            >
                              <SelectTrigger className="bg-slate-800 border-slate-600 text-white text-xs">
                                <SelectValue placeholder="Pilih parent akun..." />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-800 border-slate-600 text-white">
                                <SelectItem value="__none">Pilih parent akun...</SelectItem>
                                {parentAccounts.map((account) => (
                                  <SelectItem key={account.id} value={String(account.id)}>
                                    {account.code} — {account.name}
                                  </SelectItem>
                                ))}
                                {parentAccounts.length === 0 && (
                                  <SelectItem value="__no_parent_results" disabled>
                                    Parent tidak ditemukan
                                  </SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </>
                        )}
                        {creatingCoaLoading && (
                          <p className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Loader2 className="h-3 w-3 animate-spin" /> Memuat parent...
                          </p>
                        )}
                        {!creatingCoaLoading && parentAccounts.length === 0 && (
                          <p className="text-[11px] text-amber-400">
                            Belum ada parent dengan kelompok akun ini. Buat parent terlebih dahulu.
                          </p>
                        )}
                      </div>
                    )}

                    <Button
                      type="button"
                      onClick={createCoa}
                      disabled={creatingCoaLoading || (newCoaRole === "child" && parentAccounts.length === 0)}
                      className="w-full gap-1.5 bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      {creatingCoaLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {quickCreateChild ? "Buat Child & Pilih COA" : "Buat & Pilih COA"}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mt-1 flex items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <CreatableCombobox
                          value={form.action_coa_code ?? ""}
                          onChange={value => setForm((f: any) => ({ ...f, action_coa_code: value || null }))}
                          options={actionCoaOptions}
                          loading={loadingCoaOptions}
                          placeholder="Pilih akun COA — kode dan nama"
                          searchPlaceholder="Cari kode atau nama COA…"
                          emptyText="Akun COA tidak ditemukan."
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={startCreateChildCoa}
                        disabled={!form.action_coa_code || loadingCoaOptions}
                        title="Tambah child dari COA terpilih"
                        aria-label="Tambah child dari COA terpilih"
                        className="h-9 w-9 shrink-0 border-indigo-400/60 text-indigo-300 hover:bg-indigo-950/50 hover:text-indigo-200"
                      >
                        <Plus size={15} />
                      </Button>
                    </div>
                    {actionCoaMismatch && (
                      <p className="mt-1 text-[11px] text-red-300">
                        Action Flow ini membutuhkan akun tipe <strong>{expectedCoaType}</strong>.
                        Jangan pilih akun PPN di sini; pilih akun beban/pendapatan.
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={startCreateCoa}
                      className="mt-1 w-full gap-1.5 text-indigo-300 hover:bg-indigo-950/40 hover:text-indigo-200"
                    >
                      <Plus size={13} /> Tambah COA baru sebagai parent atau child
                    </Button>
                  </>
                )}
                <p className="mt-1 text-[11px] text-slate-500">
                  Nilai yang disimpan tetap kode COA; nama ditampilkan dari master akun.
                </p>
              </div>
            </div>
            <div className={`rounded-lg border p-3 ${
              taxTreatment.tone === "blue"
                ? "border-sky-500/30 bg-sky-500/5"
                : taxTreatment.tone === "green"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-slate-700 bg-slate-800/50"
            }`}>
              <div className="flex items-start gap-2">
                <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${
                  taxTreatment.tone === "blue"
                    ? "text-sky-300"
                    : taxTreatment.tone === "green"
                      ? "text-emerald-300"
                      : "text-slate-400"
                }`} />
                <div>
                  <Label className="text-slate-300">Perlakuan Pajak</Label>
                  <p className="mt-1 text-sm font-semibold text-white">{taxTreatment.label}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    {taxTreatment.description}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Pengaturan ini informatif dan tidak menggantikan akun COA transaksi.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-start gap-3">
                  <input
                    id="ai-rule-require-document"
                    type="checkbox"
                    checked={Boolean(form.requires_document_upload)}
                    onChange={(event) => setForm((current: any) => ({
                      ...current,
                      requires_document_upload: event.target.checked,
                    }))}
                    className="mt-1 h-4 w-4 accent-orange-500"
                  />
                  <div>
                    <Label htmlFor="ai-rule-require-document" className="cursor-pointer text-slate-200">
                      Wajib upload dokumen / gambar
                    </Label>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Rule tidak dapat memicu posting sampai bukti tersedia untuk dipindai OCR.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
                <Label className="text-slate-300">Perlakuan Pajak</Label>
                <Select value={form.tax_type ?? "none"} onValueChange={setTaxType}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    {TAX_TYPES.map((tax) => (
                      <SelectItem key={tax.value} value={tax.value}>{tax.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.tax_type !== "none" && (
                  <p className="mt-1 text-[11px] text-cyan-300">
                    {taxAccountFor(form.tax_type)?.code
                      ? `Posting akan diarahkan ke ${taxAccountFor(form.tax_type)?.code} — ${taxAccountFor(form.tax_type)?.name}.`
                      : "COA PPN yang sesuai belum tersedia; simpan akan ditolak sampai COA dibuat."}
                  </p>
                )}
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
            <div className="border border-slate-700 rounded-lg p-3 space-y-2">
              <Label className="text-slate-300">Test / Preview Matcher (read-only)</Label>
              <div className="grid grid-cols-[1fr_10rem_auto] gap-2">
                <Input value={previewText} onChange={e => setPreviewText(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white" placeholder="Contoh deskripsi transaksi…" />
                <Input type="number" min={0} value={previewAmount} onChange={e => setPreviewAmount(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white" placeholder="Nominal (opsional)" />
                <Button type="button" variant="outline" onClick={runPreview} disabled={previewing || !previewText.trim()}
                  className="border-slate-600 text-slate-300">{previewing ? "…" : "Preview"}</Button>
              </div>
              {preview && <div className={`text-xs rounded p-2 ${preview.ambiguityCode ? "bg-red-950 text-red-300" : "bg-slate-800 text-slate-300"}`}>
                {preview.ambiguityCode ? <><b>AMBIGUOUS_RULE_MATCH</b><div>{preview.ambiguityReason}</div></> :
                  preview.rule ? <><b>Matched rule:</b> {preview.rule.name} <span className="ml-2">COA: {preview.rule.targetCoaCode ?? "—"}</span>
                    <div className="mt-1">Matched conditions: {(preview.matchedConditions ?? []).map((c: any) => `✓ ${c.label}`).join(" · ") || "—"}</div></> :
                    <span>Tidak ada rule yang cocok — manual review.</span>}
              </div>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)} className="border-slate-600 text-slate-300">Batal</Button>
            <Button onClick={save} disabled={saving || !form.name ||
              actionCoaMismatch ||
              !(form.conditions ?? []).every((condition: any) => String(condition?.value ?? "").trim())}
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
                    {jsonArray(row.upload_file_types).join(", ") || "—"}
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
