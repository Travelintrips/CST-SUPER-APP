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
import { useCompany } from "@/contexts/CompanyContext";
import {
  SlidersHorizontal, Plus, Pencil, PowerOff, RefreshCw,
  Brain, BookOpen, Tag, Upload, Shield, ArrowLeft,
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
    setShowModal(true);
  };

  const openEdit = (row: any) => {
    setEditRow(row);
    setForm({
      ...row,
      keywords: Array.isArray(row.keywords) ? row.keywords : JSON.parse(row.keywords ?? "[]"),
      upload_file_types: Array.isArray(row.upload_file_types) ? row.upload_file_types : JSON.parse(row.upload_file_types ?? "[]"),
    });
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
                <Select value={form.type ?? ""} onValueChange={v => setForm((f: any) => ({ ...f, type: v || null }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1">
                    <SelectValue placeholder="Pilih tipe…" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    <SelectItem value="">— Tidak ditentukan —</SelectItem>
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
                <Input value={form.default_coa_code ?? ""} onChange={e => setForm((f: any) => ({ ...f, default_coa_code: e.target.value || null }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1 font-mono" placeholder="cth. 1-1010" />
              </div>
              <div>
                <Label className="text-slate-300">Department</Label>
                <Input value={form.default_department ?? ""} onChange={e => setForm((f: any) => ({ ...f, default_department: e.target.value || null }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300">Cost Center</Label>
                <Input value={form.default_cost_center ?? ""} onChange={e => setForm((f: any) => ({ ...f, default_cost_center: e.target.value || null }))}
                  className="bg-slate-800 border-slate-600 text-white mt-1" />
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
                <Select value={form.action_flow ?? ""} onValueChange={v => setForm((f: any) => ({ ...f, action_flow: v || null }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 text-white">
                    <SelectItem value="">— Tidak ditentukan —</SelectItem>
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
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
