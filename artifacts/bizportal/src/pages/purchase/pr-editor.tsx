import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ArrowRight, CheckCircle, XCircle, ChevronLeft, ChevronDown, ChevronUp, Tag, Layers, Info, User2, Shield } from "lucide-react";
import { toast } from "sonner";

interface PRLine {
  id?: number;
  name: string;
  quantity: string;
  unit: string;
  estimatedCost: string;
  notes: string;
  productCategory?: string;
  customFieldValues?: Record<string, string | number>;
}
interface PR { id: number; prNumber: string; status: string; requestedBy: string; department: string; requiredDate: string; notes: string; lines: PRLine[]; approvals: Record<string, unknown>[]; rfqId?: number; }
interface Product { id: number; name: string; sku: string; unit?: string; }
interface UserOption { id: string; name: string; email: string; division?: string | null; }
interface CustomField { key: string; label: string; type: string; required: boolean; options?: string[]; placeholder?: string; unit?: string; }
interface ProductTemplate { category: string; label: string; customFields: CustomField[]; requiredDocuments: unknown[]; }

const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });

const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const LEVEL_COLORS = [
  "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  "border-blue-500/40 bg-blue-500/10 text-blue-400",
  "border-amber-500/40 bg-amber-500/10 text-amber-400",
  "border-rose-500/40 bg-rose-500/10 text-rose-400",
  "border-purple-500/40 bg-purple-500/10 text-purple-400",
];

interface MatrixLevel {
  id: number;
  level: number;
  label: string | null;
  min_amount: string;
  max_amount: string | null;
  approver_role_name: string | null;
  approver_role_color: string | null;
  approver_user_name: string | null;
  approver_user_email: string | null;
}

interface MatrixEvalResult {
  matched: boolean;
  matrix: { id: number; name: string; module: string } | null;
  requiredLevels: MatrixLevel[];
}

function ApprovalMatrixPanel({ companyId, amount }: { companyId: number | null; amount: number }) {
  const { data, isLoading } = useQuery<MatrixEvalResult>({
    queryKey: ["/api/approval-matrix/evaluate", companyId, amount],
    queryFn: () =>
      apiFetch("/approval-matrix/evaluate", {
        method: "POST",
        body: JSON.stringify({
          companyId: companyId || null,
          module: "purchase_request",
          amount,
        }),
      }).then(r => r.json()),
    enabled: amount > 0,
    staleTime: 30_000,
  });

  if (amount <= 0) return null;
  if (isLoading) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
      <Layers className="h-3.5 w-3.5 animate-pulse" /> Memeriksa approval matrix...
    </div>
  );
  if (!data?.matched || !data.requiredLevels.length) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span>Tidak ada Approval Matrix yang dikonfigurasi untuk nominal ini. PR dapat di-approve langsung.</span>
    </div>
  );

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
        <Layers className="h-3.5 w-3.5" />
        Approval Matrix: <span className="font-normal text-foreground">{data.matrix?.name}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {data.requiredLevels.map((lv, i) => {
          const min = Number(lv.min_amount ?? 0);
          const max = lv.max_amount != null ? Number(lv.max_amount) : null;
          const c = LEVEL_COLORS[(lv.level - 1) % LEVEL_COLORS.length];
          return (
            <div key={lv.id} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${c}`}>
              <span className="font-bold w-4 text-center">{lv.level}</span>
              <div>
                <div className="font-semibold">{lv.label || `Level ${lv.level}`}</div>
                <div className="opacity-80 text-[10px]">{IDR(min)} – {max != null ? IDR(max) : "tidak terbatas"}</div>
              </div>
              <div className="border-l border-current/30 pl-2 ml-1">
                {lv.approver_role_name ? (
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: lv.approver_role_color ?? "#6366f1" }} />
                    {lv.approver_role_name}
                  </span>
                ) : lv.approver_user_name ? (
                  <span className="flex items-center gap-1"><User2 className="h-3 w-3" />{lv.approver_user_name}</span>
                ) : (
                  <span className="flex items-center gap-1"><Shield className="h-3 w-3" />Admin</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const statusColor: Record<string, string> = {
  draft: "secondary", submitted: "default", approved: "default",
  rejected: "destructive", converted: "outline", cancelled: "destructive",
};
const statusLabel: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", approved: "Approved",
  rejected: "Rejected", converted: "Converted→RFQ", cancelled: "Cancelled",
};

function ItemCombobox({ value, onChange, disabled }: {
  value: string;
  onChange: (val: string, unit?: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/ecommerce/products/search", search],
    queryFn: () => apiFetch(`/ecommerce/products?search=${encodeURIComponent(search)}&isActive=true&limit=50`).then(r => r.json()).then((res: { data: Product[] }) => res.data),
    enabled: open,
    staleTime: 10_000,
  });

  useEffect(() => { setSearch(value); }, [value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const handleSelect = (p: Product) => {
    onChange(p.name, p.unit ?? "pcs");
    setSearch(p.name);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative flex items-center">
        <Input
          value={search}
          onChange={e => { setSearch(e.target.value); onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { onChange(search); }, 150)}
          disabled={disabled}
          className="h-8 pr-7"
          placeholder="Ketik atau pilih produk..."
        />
        {!disabled && (
          <button
            type="button"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border rounded-md shadow-md max-h-52 overflow-y-auto">
          {products.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {search.length < 1 ? "Ketik untuk mencari produk..." : "Tidak ditemukan. Ketik nama bebas."}
            </div>
          ) : products.map(p => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex flex-col"
              onMouseDown={e => { e.preventDefault(); handleSelect(p); }}
            >
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.sku}{p.unit ? ` · ${p.unit}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateFieldsPanel({
  template,
  values,
  onChange,
  disabled,
}: {
  template: ProductTemplate;
  values: Record<string, string | number>;
  onChange: (key: string, val: string | number) => void;
  disabled?: boolean;
}) {
  if (!template.customFields || template.customFields.length === 0) return null;
  return (
    <div className="mt-2 pl-2 border-l-2 border-primary/30 space-y-2">
      <p className="text-xs font-medium text-primary/80 flex items-center gap-1">
        <Tag className="h-3 w-3" /> Spesifikasi {template.label}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {template.customFields.map((f) => (
          <div key={f.key} className="grid gap-0.5">
            <label className="text-xs text-muted-foreground">
              {f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}
              {f.unit && <span className="ml-1 text-muted-foreground/70">({f.unit})</span>}
            </label>
            {f.type === "select" && f.options ? (
              <select
                className="h-7 rounded border border-input bg-transparent px-2 text-xs"
                value={String(values[f.key] ?? "")}
                onChange={e => onChange(f.key, e.target.value)}
                disabled={disabled}
              >
                <option value="">— pilih —</option>
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                className="min-h-[48px] rounded border border-input bg-transparent px-2 py-1 text-xs resize-none"
                value={String(values[f.key] ?? "")}
                onChange={e => onChange(f.key, e.target.value)}
                placeholder={f.placeholder}
                disabled={disabled}
              />
            ) : (
              <input
                className="h-7 rounded border border-input bg-transparent px-2 text-xs"
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                value={String(values[f.key] ?? "")}
                onChange={e => onChange(f.key, f.type === "number" ? Number(e.target.value) : e.target.value)}
                placeholder={f.placeholder}
                disabled={disabled}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PurchaseRequestEditorPage() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { activeCompanyId } = useCompany();
  const { user } = useSupabaseAuth();
  const isNew = !id || id === "new";

  const { data: pr, isLoading } = useQuery<PR>({
    queryKey: ["/api/purchase-workflow/pr", id],
    queryFn: () => apiFetch(`/purchase-workflow/pr/${id}`).then(r => r.json()),
    enabled: !isNew,
  });

  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ["/api/users"],
    queryFn: () => apiFetch("/users").then(r => r.json()),
  });

  const { data: currentUser } = useQuery<UserOption>({
    queryKey: ["/api/users/me"],
    queryFn: () => apiFetch("/users/me").then(r => r.json()),
  });

  const { data: templates = [] } = useQuery<ProductTemplate[]>({
    queryKey: ["/api/product-templates"],
    queryFn: () => apiFetch("/product-templates").then(r => r.json()),
    staleTime: 60_000,
  });

  const templateMap = Object.fromEntries(templates.map(t => [t.category, t]));

  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ requestedBy: "", department: "", requiredDate: today, notes: "" });
  const [lines, setLines] = useState<PRLine[]>([{ name: "", quantity: "1", unit: "pcs", estimatedCost: "0", notes: "", productCategory: "", customFieldValues: {} }]);
  const [actionNotes, setActionNotes] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set());

  // Auto-fill pemohon dari user yang sedang login
  useEffect(() => {
    if (isNew && user) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "";
      setForm(f => ({ ...f, requestedBy: f.requestedBy || fullName }));
    }
  }, [isNew, user]);

  useEffect(() => {
    if (pr) {
      setForm({
        requestedBy: pr.requestedBy ?? "",
        department: pr.department ?? "",
        requiredDate: pr.requiredDate ? pr.requiredDate.substring(0, 10) : "",
        notes: pr.notes ?? "",
      });
      setLines(pr.lines?.length
        ? pr.lines.map(l => ({
            name: l.name,
            quantity: String(l.quantity),
            unit: l.unit,
            estimatedCost: String(l.estimatedCost),
            notes: l.notes ?? "",
            productCategory: (l as any).productCategory ?? "",
            customFieldValues: (l as any).customFieldValues ?? {},
          }))
        : [{ name: "", quantity: "1", unit: "pcs", estimatedCost: "0", notes: "", productCategory: "", customFieldValues: {} }]
      );
    }
  }, [pr]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        companyId: activeCompanyId,
        lines: lines.map(l => ({
          ...l,
          productCategory: l.productCategory || null,
          customFieldValues: l.customFieldValues && Object.keys(l.customFieldValues).length > 0 ? l.customFieldValues : null,
        })),
      };
      const r = isNew
        ? await apiFetch("/purchase-workflow/pr", { method: "POST", body: JSON.stringify(payload) })
        : await apiFetch(`/purchase-workflow/pr/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      if (!r.ok) throw new Error("Gagal menyimpan");
      return r.json();
    },
    onSuccess: (data: PR) => {
      toast.success("PR tersimpan");
      qc.invalidateQueries({ queryKey: ["/api/purchase-workflow/pr"] });
      if (isNew) navigate(`/purchase/pr/${data.id}`);
    },
    onError: () => toast.error("Gagal menyimpan"),
  });

  const actionMut = useMutation({
    mutationFn: async (action: string) => {
      const r = await apiFetch(`/purchase-workflow/pr/${pr?.id ?? id}/action`, {
        method: "POST",
        body: JSON.stringify({ action, notes: actionNotes }),
      });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    onSuccess: (data) => {
      toast.success("Berhasil");
      qc.invalidateQueries({ queryKey: ["/api/purchase-workflow/pr", id] });
      if (data.rfqId) navigate(`/purchase/rfq/${data.rfqId}`);
    },
    onError: () => toast.error("Gagal melakukan aksi"),
  });

  const handlePemohonChange = (userName: string) => {
    const selected = users.find(u => u.name === userName);
    setForm(f => ({
      ...f,
      requestedBy: userName,
      department: selected?.division ?? f.department,
    }));
  };

  const addLine = () => {
    setLines(prev => [...prev, { name: "", quantity: "1", unit: "pcs", estimatedCost: "0", notes: "", productCategory: "", customFieldValues: {} }]);
  };
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, key: keyof PRLine, value: string) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: value } : l));

  const setLineCategory = (i: number, category: string) => {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, productCategory: category, customFieldValues: {} } : l));
    if (category) {
      setExpandedLines(prev => new Set([...prev, i]));
    } else {
      setExpandedLines(prev => { const s = new Set(prev); s.delete(i); return s; });
    }
  };

  const setCustomField = (lineIdx: number, key: string, val: string | number) => {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== lineIdx) return l;
      return { ...l, customFieldValues: { ...(l.customFieldValues ?? {}), [key]: val } };
    }));
  };

  const toggleExpand = (i: number) => {
    setExpandedLines(prev => {
      const s = new Set(prev);
      if (s.has(i)) s.delete(i);
      else s.add(i);
      return s;
    });
  };

  const hasValidLines = lines.some(l => l.name.trim() !== "");

  const totalEstimate = useMemo(() =>
    lines.reduce((sum, l) => sum + (Number(l.estimatedCost) || 0) * (Number(l.quantity) || 1), 0),
    [lines]
  );

  const handleSave = () => {
    if (!hasValidLines) {
      toast.error("Minimal harus ada satu item yang diisi sebelum menyimpan.");
      return;
    }
    saveMut.mutate();
  };

  const handleSubmit = () => {
    setSubmitAttempted(true);
    if (!form.requestedBy.trim()) {
      toast.error("Pemohon wajib dipilih sebelum submit.");
      return;
    }
    if (!form.department.trim()) {
      toast.error("Departemen wajib diisi sebelum submit.");
      return;
    }
    if (!hasValidLines) {
      toast.error("Minimal harus ada satu item yang diisi sebelum PR bisa di-submit.");
      return;
    }
    actionMut.mutate("submit");
  };

  const isDraft = !pr || pr.status === "draft";
  const isSubmitted = pr?.status === "submitted";

  if (!isNew && isLoading) return <AppShell><div className="flex items-center justify-center h-64">Loading...</div></AppShell>;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/purchase/pr")}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{isNew ? "Buat Purchase Request" : `PR: ${pr?.prNumber}`}</h1>
            {pr && <Badge variant={statusColor[pr.status] as "default" | "secondary" | "destructive" | "outline"}>{statusLabel[pr.status]}</Badge>}
          </div>
          {isDraft && <Button onClick={handleSave} disabled={saveMut.isPending}>Simpan</Button>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Informasi PR</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Pemohon <span className="text-destructive">*</span></Label>
                {isDraft ? (
                  <>
                    <Select value={form.requestedBy} onValueChange={handlePemohonChange}>
                      <SelectTrigger className={submitAttempted && !form.requestedBy.trim() ? "border-destructive" : ""}>
                        <SelectValue placeholder="Pilih pemohon..." />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map(u => (
                          <SelectItem key={u.id} value={u.name}>
                            <span>{u.name}</span>
                            {u.division && <span className="ml-2 text-xs text-muted-foreground">({u.division})</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {submitAttempted && !form.requestedBy.trim() && (
                      <p className="text-xs text-destructive mt-1">Pemohon wajib dipilih.</p>
                    )}
                  </>
                ) : (
                  <Input value={form.requestedBy} disabled />
                )}
              </div>
              <div>
                <Label>Departemen <span className="text-destructive">*</span></Label>
                <Input
                  value={form.department}
                  onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  disabled={!isDraft}
                  placeholder="Otomatis dari divisi pemohon"
                  className={submitAttempted && !form.department.trim() ? "border-destructive" : ""}
                />
                {submitAttempted && !form.department.trim() && (
                  <p className="text-xs text-destructive mt-1">Departemen wajib diisi.</p>
                )}
              </div>
              <div>
                <Label>Tanggal Diperlukan</Label>
                <DatePicker value={form.requiredDate} onChange={v => setForm(f => ({ ...f, requiredDate: v }))} disabled={!isDraft} />
              </div>
              <div>
                <Label>Catatan</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} disabled={!isDraft} rows={3} />
              </div>
            </CardContent>
          </Card>

          {pr && (
            <Card>
              <CardHeader><CardTitle className="text-base">Aksi Workflow</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Catatan Approval</Label>
                  <Textarea value={actionNotes} onChange={e => setActionNotes(e.target.value)} rows={2} placeholder="Opsional..." />
                </div>
                <div className="flex flex-wrap gap-2">
                  {isDraft && <Button size="sm" onClick={handleSubmit} disabled={actionMut.isPending}><ArrowRight className="mr-1 h-4 w-4" />Submit</Button>}
                  {isSubmitted && <Button size="sm" onClick={() => actionMut.mutate("approve")} disabled={actionMut.isPending}><CheckCircle className="mr-1 h-4 w-4" />Approve</Button>}
                  {isSubmitted && <Button size="sm" variant="destructive" onClick={() => actionMut.mutate("reject")} disabled={actionMut.isPending}><XCircle className="mr-1 h-4 w-4" />Reject</Button>}
                  {pr.status === "approved" && <Button size="sm" onClick={() => actionMut.mutate("convert_rfq")} disabled={actionMut.isPending}><ArrowRight className="mr-1 h-4 w-4" />Konversi ke RFQ</Button>}
                  {(isDraft || isSubmitted) && <Button size="sm" variant="outline" onClick={() => actionMut.mutate("cancel")} disabled={actionMut.isPending}><XCircle className="mr-1 h-4 w-4" />Cancel</Button>}
                </div>
                {pr.rfqId && <p className="text-sm text-muted-foreground">RFQ dibuat: <a href={`/purchase/rfq/${pr.rfqId}`} className="underline">Lihat RFQ</a></p>}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Approval Matrix informational panel */}
        {hasValidLines && (
          <Card className="border-primary/10">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-primary" /> Info Approval
                </span>
                <span className="text-xs text-muted-foreground">
                  Est. Total: <strong>{IDR(totalEstimate)}</strong>
                </span>
              </div>
              <ApprovalMatrixPanel
                companyId={activeCompanyId ? Number(activeCompanyId) : null}
                amount={totalEstimate}
              />
            </CardContent>
          </Card>
        )}

        <Card className={isDraft && !hasValidLines && submitAttempted ? "border-destructive" : ""}>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Item yang Dibutuhkan</CardTitle>
              {isDraft && !hasValidLines && submitAttempted && (
                <p className="text-xs text-destructive mt-1">Minimal harus ada satu item yang diisi.</p>
              )}
            </div>
            {isDraft && <Button size="sm" variant="outline" onClick={addLine}><Plus className="mr-1 h-4 w-4" />Tambah Item</Button>}
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {lines.map((line, i) => {
                const tpl = line.productCategory ? templateMap[line.productCategory] : null;
                const hasFields = tpl && tpl.customFields && tpl.customFields.length > 0;
                const isExpanded = expandedLines.has(i);
                return (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    {/* Row utama */}
                    <div className="grid grid-cols-12 gap-2 items-start">
                      {/* Nama item — 4 kolom */}
                      <div className="col-span-4">
                        <label className="text-xs text-muted-foreground mb-0.5 block">Nama Item</label>
                        {isDraft ? (
                          <ItemCombobox
                            value={line.name}
                            onChange={(val, unit) => {
                              updateLine(i, "name", val);
                              if (unit) updateLine(i, "unit", unit);
                            }}
                          />
                        ) : (
                          <Input value={line.name} disabled className="h-8" />
                        )}
                      </div>
                      {/* Kategori — 3 kolom */}
                      <div className="col-span-3">
                        <label className="text-xs text-muted-foreground mb-0.5 block">Kategori Komoditas</label>
                        <select
                          className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground [color-scheme:light]"
                          value={line.productCategory ?? ""}
                          onChange={e => setLineCategory(i, e.target.value)}
                          disabled={!isDraft}
                        >
                          <option value="" className="text-gray-900 bg-white dark:text-white dark:bg-gray-800">— Umum —</option>
                          {templates.map(t => (
                            <option key={t.category} value={t.category} className="text-gray-900 bg-white dark:text-white dark:bg-gray-800">{t.label}</option>
                          ))}
                        </select>
                      </div>
                      {/* Qty */}
                      <div className="col-span-1">
                        <label className="text-xs text-muted-foreground mb-0.5 block">Qty</label>
                        <Input type="number" value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} disabled={!isDraft} className="h-8" />
                      </div>
                      {/* Satuan */}
                      <div className="col-span-1">
                        <label className="text-xs text-muted-foreground mb-0.5 block">Satuan</label>
                        <Input value={line.unit} onChange={e => updateLine(i, "unit", e.target.value)} disabled={!isDraft} className="h-8" />
                      </div>
                      {/* Est. Harga */}
                      <div className="col-span-2">
                        <label className="text-xs text-muted-foreground mb-0.5 block">Est. Harga</label>
                        <Input type="number" value={line.estimatedCost} onChange={e => updateLine(i, "estimatedCost", e.target.value)} disabled={!isDraft} className="h-8" />
                      </div>
                      {/* Delete */}
                      <div className="col-span-1 pt-5 flex gap-1 justify-end">
                        {hasFields && (
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => toggleExpand(i)} title="Lihat/sembunyikan spesifikasi">
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-primary" /> : <ChevronDown className="h-4 w-4 text-primary" />}
                          </Button>
                        )}
                        {isDraft && (
                          <Button size="icon" variant="ghost" onClick={() => removeLine(i)} className="h-8 w-8">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {/* Catatan */}
                    <Input
                      value={line.notes}
                      onChange={e => updateLine(i, "notes", e.target.value)}
                      disabled={!isDraft}
                      className="h-7 text-xs"
                      placeholder="Catatan item (opsional)..."
                    />
                    {/* Template spec fields — collapsible */}
                    {tpl && (isExpanded || !hasFields) && (
                      <TemplateFieldsPanel
                        template={tpl}
                        values={line.customFieldValues ?? {}}
                        onChange={(key, val) => setCustomField(i, key, val)}
                        disabled={!isDraft}
                      />
                    )}
                    {/* Badge dokumen yang diperlukan */}
                    {tpl && tpl.requiredDocuments && (tpl.requiredDocuments as any[]).length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {(tpl.requiredDocuments as any[]).map((d: any) => (
                          <span key={d.key} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${d.required ? "border-destructive/40 text-destructive bg-destructive/5" : "border-muted text-muted-foreground bg-muted/30"}`}>
                            {d.required ? "★ " : ""}{d.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {pr?.approvals && pr.approvals.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Riwayat Approval</CardTitle></CardHeader>
            <CardContent>
              {pr.approvals.map((a: any, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <Badge variant={a.status === "approved" ? "default" : a.status === "rejected" ? "destructive" : "secondary"}>
                    Step {String(a.step)}: {String(a.status)}
                  </Badge>
                  <span className="text-sm">{String(a.approverName ?? "-")}</span>
                  {a.notes && <span className="text-sm text-muted-foreground">— {String(a.notes)}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
