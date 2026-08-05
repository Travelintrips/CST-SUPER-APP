import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft,
  Pencil, Copy, Power, Plus, Trash2, AlertTriangle, RefreshCw,
  FileText, CheckSquare, BookOpen, List, History, ChevronDown, ChevronRight,
} from "lucide-react";
import { Link } from "wouter";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type FieldSection = "quotation" | "operational" | "both";
type FieldType    = "text" | "number" | "select" | "textarea" | "date";

interface STField {
  key: string; label: string; type: FieldType; required?: boolean;
  section: FieldSection; isUpload?: boolean; placeholder?: string;
  unit?: string; options?: string[];
}
interface STDocument  { key: string; label: string; required: boolean; }
interface STChecklist { key: string; label: string; }
interface STConditionalRule { fieldKey: string; condition: { value: string | number }; show: string[]; }
interface STValidationRule  { fieldKey: string; message: string; }

interface ServiceTemplate {
  serviceType: string; label: string; emoji: string; version: string;
  isActive: boolean; description?: string | null; sortOrder?: number;
  fields: STField[]; requiredDocuments: STDocument[];
  checklist: STChecklist[]; conditionalRules: STConditionalRule[];
  validationRules: STValidationRule[]; source?: "db" | "in-code" | "fallback";
}

interface VersionHistoryRow {
  id: number;
  service_type: string;
  version: string;
  label: string | null;
  fields: STField[];
  required_docs: STDocument[];
  checklist: STChecklist[];
  change_note: string | null;
  changed_by: string | null;
  created_at: string;
}

/* ─── API helper ─────────────────────────────────────────────────────────── */

async function apiFetch(url: string, init?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).error ?? (j as any).message ?? `HTTP ${r.status}`);
  return j;
}

const BASE = "/api/service-templates";

/* ─── Diff helpers ───────────────────────────────────────────────────────── */

interface DiffEntry {
  kind: "+" | "-";
  section: "field" | "doc" | "checklist";
  label: string;
  key: string;
}

function diffVersions(prev: VersionHistoryRow, curr: VersionHistoryRow): DiffEntry[] {
  const diffs: DiffEntry[] = [];

  const prevFieldKeys = new Set((prev.fields ?? []).map(f => f.key));
  const currFieldKeys = new Set((curr.fields ?? []).map(f => f.key));
  const prevFieldMap  = new Map((prev.fields ?? []).map(f => [f.key, f]));
  const currFieldMap  = new Map((curr.fields ?? []).map(f => [f.key, f]));

  for (const [key, f] of currFieldMap) {
    if (!prevFieldKeys.has(key)) diffs.push({ kind: "+", section: "field", label: f.label, key });
  }
  for (const [key, f] of prevFieldMap) {
    if (!currFieldKeys.has(key)) diffs.push({ kind: "-", section: "field", label: f.label, key });
  }

  const prevDocKeys = new Set((prev.required_docs ?? []).map(d => d.key));
  const currDocKeys = new Set((curr.required_docs ?? []).map(d => d.key));
  const prevDocMap  = new Map((prev.required_docs ?? []).map(d => [d.key, d]));
  const currDocMap  = new Map((curr.required_docs ?? []).map(d => [d.key, d]));

  for (const [key, d] of currDocMap) {
    if (!prevDocKeys.has(key)) diffs.push({ kind: "+", section: "doc", label: d.label, key });
  }
  for (const [key, d] of prevDocMap) {
    if (!currDocKeys.has(key)) diffs.push({ kind: "-", section: "doc", label: d.label, key });
  }

  const prevClKeys = new Set((prev.checklist ?? []).map(c => c.key));
  const currClKeys = new Set((curr.checklist ?? []).map(c => c.key));
  const prevClMap  = new Map((prev.checklist ?? []).map(c => [c.key, c]));
  const currClMap  = new Map((curr.checklist ?? []).map(c => [c.key, c]));

  for (const [key, c] of currClMap) {
    if (!prevClKeys.has(key)) diffs.push({ kind: "+", section: "checklist", label: c.label, key });
  }
  for (const [key, c] of prevClMap) {
    if (!currClKeys.has(key)) diffs.push({ kind: "-", section: "checklist", label: c.label, key });
  }

  return diffs;
}

const SECTION_LABEL: Record<string, string> = {
  field: "Field",
  doc: "Dokumen",
  checklist: "Checklist",
};

/* ─── Version History Dialog ─────────────────────────────────────────────── */

function VersionHistoryDialog({
  serviceType,
  label,
  open,
  onClose,
}: {
  serviceType: string;
  label: string;
  open: boolean;
  onClose: () => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<{ serviceType: string; history: VersionHistoryRow[] }>({
    queryKey: ["version-history", serviceType],
    queryFn: () => apiFetch(`${BASE}/${serviceType}/version-history`),
    enabled: open && !!serviceType,
  });

  const history = [...(data?.history ?? [])].reverse();

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const rawHistory = data?.history ?? [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Riwayat Versi — {label}
            <code className="text-xs font-normal bg-muted px-1.5 py-0.5 rounded">{serviceType}</code>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Memuat...</div>
        ) : history.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Belum ada riwayat versi. Riwayat akan terekam saat template diupdate.
          </div>
        ) : (
          <div className="space-y-2 mt-2">
            {history.map((row, idx) => {
              const isExpanded = expandedIds.has(row.id);
              const rawIdx = rawHistory.findIndex(r => r.id === row.id);
              const prevInRaw = rawIdx > 0 ? rawHistory[rawIdx - 1]! : null;
              const diffs = prevInRaw ? diffVersions(prevInRaw, row) : [];
              const isLatest = idx === 0;

              return (
                <div
                  key={row.id}
                  className={`border rounded-lg overflow-hidden ${isLatest ? "border-blue-200 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20" : ""}`}
                >
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                    onClick={() => toggleExpand(row.id)}
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    }
                    <span className="font-mono font-semibold text-sm text-blue-700 dark:text-blue-400 min-w-[72px]">
                      v{row.version}
                    </span>
                    {isLatest && (
                      <Badge className="text-xs h-5 px-1.5">terbaru</Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(row.created_at).toLocaleString("id-ID", {
                        day: "numeric", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    {row.change_note && (
                      <span className="text-xs text-slate-500 italic ml-2 hidden sm:block max-w-[180px] truncate">
                        {row.change_note}
                      </span>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t bg-background/60">
                      <div className="mt-3 space-y-3">
                        {/* Summary counts */}
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span>{(row.fields ?? []).length} field</span>
                          <span>{(row.required_docs ?? []).length} dokumen</span>
                          <span>{(row.checklist ?? []).length} checklist</span>
                          {row.change_note && (
                            <span className="italic text-slate-500">· {row.change_note}</span>
                          )}
                        </div>

                        {/* Diff vs previous version */}
                        {prevInRaw && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1.5">
                              Perubahan dari v{prevInRaw.version}:
                            </p>
                            {diffs.length === 0 ? (
                              <p className="text-xs text-slate-400 italic">Tidak ada perubahan struktur</p>
                            ) : (
                              <div className="space-y-1">
                                {diffs.map((d, i) => (
                                  <div
                                    key={i}
                                    className={`flex items-center gap-2 text-xs rounded px-2 py-1 font-mono ${
                                      d.kind === "+"
                                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                                        : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                                    }`}
                                  >
                                    <span className="font-bold text-base leading-none">{d.kind}</span>
                                    <span className="font-semibold">{d.key}</span>
                                    <span className="text-slate-500 non-italic font-sans">({SECTION_LABEL[d.section]})</span>
                                    <span className="text-slate-400 font-sans ml-auto">{d.label}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Fields list */}
                        {(row.fields ?? []).length > 0 && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground font-medium hover:text-foreground">
                              Fields ({row.fields.length})
                            </summary>
                            <div className="mt-1.5 space-y-0.5 pl-2">
                              {row.fields.map(f => (
                                <div key={f.key} className="flex gap-2 text-slate-600">
                                  <code className="text-blue-600 min-w-[120px]">{f.key}</code>
                                  <span>{f.label}</span>
                                  <span className="text-slate-400">({f.type})</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}

                        {/* Docs list */}
                        {(row.required_docs ?? []).length > 0 && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground font-medium hover:text-foreground">
                              Dokumen ({row.required_docs.length})
                            </summary>
                            <div className="mt-1.5 space-y-0.5 pl-2">
                              {row.required_docs.map(d => (
                                <div key={d.key} className="flex gap-2 text-slate-600">
                                  <code className="text-violet-600 min-w-[120px]">{d.key}</code>
                                  <span>{d.label}</span>
                                  {d.required && <span className="text-red-400">*</span>}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Small editors ─────────────────────────────────────────────────────── */

function FieldsEditor({ value, onChange }: {
  value: STField[]; onChange: (v: STField[]) => void;
}) {
  const add = () => onChange([...value, { key: "", label: "", type: "text", section: "quotation", required: false }]);
  const rem = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const set = (i: number, patch: Partial<STField>) =>
    onChange(value.map((f, idx) => idx === i ? { ...f, ...patch } : f));

  return (
    <div className="space-y-2">
      {value.map((f, i) => (
        <div key={i} className="border rounded p-3 space-y-2 bg-muted/30">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">Key</Label>
              <Input value={f.key} onChange={e => set(i, { key: e.target.value })} placeholder="origin_city" className="h-7 text-xs" />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Label</Label>
              <Input value={f.label} onChange={e => set(i, { label: e.target.value })} placeholder="Kota Asal" className="h-7 text-xs" />
            </div>
            <Button variant="ghost" size="icon" className="mt-5 h-7 w-7 text-destructive" onClick={() => rem(i)}><Trash2 className="h-3 w-3" /></Button>
          </div>
          <div className="flex gap-2">
            <div className="w-28">
              <Label className="text-xs">Tipe</Label>
              <Select value={f.type} onValueChange={v => set(i, { type: v as FieldType })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["text","number","select","textarea","date"].map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-32">
              <Label className="text-xs">Section</Label>
              <Select value={f.section} onValueChange={v => set(i, { section: v as FieldSection })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["quotation","operational","both"].map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3 pb-1">
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <Checkbox checked={!!f.required} onCheckedChange={v => set(i, { required: !!v })} className="h-3 w-3" />
                Required
              </label>
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <Checkbox checked={!!f.isUpload} onCheckedChange={v => set(i, { isUpload: !!v })} className="h-3 w-3" />
                Upload
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">Placeholder</Label>
              <Input value={f.placeholder ?? ""} onChange={e => set(i, { placeholder: e.target.value || undefined })} className="h-7 text-xs" />
            </div>
            <div className="w-24">
              <Label className="text-xs">Unit</Label>
              <Input value={f.unit ?? ""} onChange={e => set(i, { unit: e.target.value || undefined })} className="h-7 text-xs" />
            </div>
          </div>
          {f.type === "select" && (
            <div>
              <Label className="text-xs">Options (satu per baris)</Label>
              <Textarea
                className="text-xs min-h-[60px]"
                value={(f.options ?? []).join("\n")}
                onChange={e => set(i, { options: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
                placeholder="Pilihan 1&#10;Pilihan 2"
              />
            </div>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="w-full text-xs h-7">
        <Plus className="h-3 w-3 mr-1" /> Tambah Field
      </Button>
    </div>
  );
}

function DocsEditor({ value, onChange }: {
  value: STDocument[]; onChange: (v: STDocument[]) => void;
}) {
  const add = () => onChange([...value, { key: "", label: "", required: true }]);
  const rem = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const set = (i: number, patch: Partial<STDocument>) =>
    onChange(value.map((d, idx) => idx === i ? { ...d, ...patch } : d));

  return (
    <div className="space-y-2">
      {value.map((d, i) => (
        <div key={i} className="flex gap-2 items-end border rounded p-2 bg-muted/30">
          <div className="flex-1">
            <Label className="text-xs">Key</Label>
            <Input value={d.key} onChange={e => set(i, { key: e.target.value })} placeholder="surat_jalan" className="h-7 text-xs" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Label</Label>
            <Input value={d.label} onChange={e => set(i, { label: e.target.value })} placeholder="Surat Jalan" className="h-7 text-xs" />
          </div>
          <label className="flex items-center gap-1 text-xs pb-1 cursor-pointer whitespace-nowrap">
            <Checkbox checked={d.required} onCheckedChange={v => set(i, { required: !!v })} className="h-3 w-3" />
            Wajib
          </label>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => rem(i)}><Trash2 className="h-3 w-3" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="w-full text-xs h-7">
        <Plus className="h-3 w-3 mr-1" /> Tambah Dokumen
      </Button>
    </div>
  );
}

function ChecklistEditor({ value, onChange }: {
  value: STChecklist[]; onChange: (v: STChecklist[]) => void;
}) {
  const add = () => onChange([...value, { key: "", label: "" }]);
  const rem = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const set = (i: number, patch: Partial<STChecklist>) =>
    onChange(value.map((c, idx) => idx === i ? { ...c, ...patch } : c));

  return (
    <div className="space-y-2">
      {value.map((c, i) => (
        <div key={i} className="flex gap-2 items-end border rounded p-2 bg-muted/30">
          <div className="w-36">
            <Label className="text-xs">Key</Label>
            <Input value={c.key} onChange={e => set(i, { key: e.target.value })} placeholder="cek_dokumen" className="h-7 text-xs" />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Label</Label>
            <Input value={c.label} onChange={e => set(i, { label: e.target.value })} placeholder="Verifikasi dokumen lengkap" className="h-7 text-xs" />
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => rem(i)}><Trash2 className="h-3 w-3" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="w-full text-xs h-7">
        <Plus className="h-3 w-3 mr-1" /> Tambah Checklist
      </Button>
    </div>
  );
}

/* ─── Edit form state ────────────────────────────────────────────────────── */

interface EditForm {
  label: string; emoji: string; description: string;
  sortOrder: string; version: string;
  fields: STField[]; requiredDocuments: STDocument[];
  checklist: STChecklist[]; conditionalRules: STConditionalRule[];
  validationRules: STValidationRule[];
}

function blankEditForm(tpl: ServiceTemplate): EditForm {
  return {
    label:             tpl.label,
    emoji:             tpl.emoji,
    description:       tpl.description ?? "",
    sortOrder:         String(tpl.sortOrder ?? 0),
    version:           "",
    fields:            JSON.parse(JSON.stringify(tpl.fields ?? [])),
    requiredDocuments: JSON.parse(JSON.stringify(tpl.requiredDocuments ?? [])),
    checklist:         JSON.parse(JSON.stringify(tpl.checklist ?? [])),
    conditionalRules:  JSON.parse(JSON.stringify(tpl.conditionalRules ?? [])),
    validationRules:   JSON.parse(JSON.stringify(tpl.validationRules ?? [])),
  };
}

/* ─── Main page ─────────────────────────────────────────────────────────── */

export default function ServiceTemplatesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: resp, isLoading, refetch } = useQuery<{ count: number; templates: ServiceTemplate[] }>({
    queryKey: [BASE],
    queryFn: () => apiFetch(BASE),
  });
  const templates = resp?.templates ?? [];

  /* ── Edit dialog ──────────────────────────────────────────────────────── */
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ServiceTemplate | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editTab, setEditTab]   = useState("basic");

  const openEdit = (tpl: ServiceTemplate) => {
    setEditTarget(tpl);
    setEditForm(blankEditForm(tpl));
    setEditTab("basic");
    setEditOpen(true);
  };

  const setF = (patch: Partial<EditForm>) =>
    setEditForm(prev => prev ? { ...prev, ...patch } : prev);

  const updateMut = useMutation({
    mutationFn: ({ serviceType, body }: { serviceType: string; body: object }) =>
      apiFetch(`${BASE}/${serviceType}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [BASE] });
      qc.invalidateQueries({ queryKey: ["version-history", editTarget?.serviceType] });
      setEditOpen(false);
      const bumped = data.versionBumped ? ` (versi → ${data.version})` : "";
      toast({ title: "Tersimpan", description: `Template diperbarui${bumped}.` });
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  const handleSave = () => {
    if (!editTarget || !editForm) return;
    const body: Record<string, unknown> = {
      label:             editForm.label.trim(),
      emoji:             editForm.emoji.trim(),
      description:       editForm.description.trim() || null,
      sortOrder:         Number(editForm.sortOrder) || 0,
      fields:            editForm.fields,
      requiredDocuments: editForm.requiredDocuments,
      checklist:         editForm.checklist,
      conditionalRules:  editForm.conditionalRules,
      validationRules:   editForm.validationRules,
    };
    if (editForm.version.trim()) body["version"] = editForm.version.trim();
    updateMut.mutate({ serviceType: editTarget.serviceType, body });
  };

  /* ── Duplicate dialog ────────────────────────────────────────────────── */
  const [dupOpen, setDupOpen]     = useState(false);
  const [dupSource, setDupSource] = useState<ServiceTemplate | null>(null);
  const [dupType, setDupType]     = useState("");
  const [dupLabel, setDupLabel]   = useState("");

  const openDuplicate = (tpl: ServiceTemplate) => {
    setDupSource(tpl);
    setDupType(`${tpl.serviceType}_copy`);
    setDupLabel(`${tpl.label} (Copy)`);
    setDupOpen(true);
  };

  const dupMut = useMutation({
    mutationFn: ({ sourceType, newServiceType, newLabel }: { sourceType: string; newServiceType: string; newLabel: string }) =>
      apiFetch(`${BASE}/${sourceType}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newServiceType, newLabel }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BASE] });
      setDupOpen(false);
      toast({ title: "Berhasil", description: `Template duplikat dibuat.` });
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  /* ── Toggle active ───────────────────────────────────────────────────── */
  const toggleMut = useMutation({
    mutationFn: ({ serviceType, isActive }: { serviceType: string; isActive: boolean }) =>
      apiFetch(`${BASE}/${serviceType}/toggle-active`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [BASE] });
      toast({ title: "Status diperbarui", description: data.message });
    },
    onError: (err: Error) => toast({ title: "Gagal", description: err.message, variant: "destructive" }),
  });

  /* ── Version history dialog ──────────────────────────────────────────── */
  const [histTarget, setHistTarget] = useState<ServiceTemplate | null>(null);

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <AppShell>
      <div className="p-6 space-y-4 max-w-7xl mx-auto">

        <div className="flex items-center gap-3">
          <Link href="/settings"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <h1 className="text-xl font-semibold">Service Templates</h1>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Perhatian:</span> Service Templates belum menjadi runtime utama Vendor Mini Form.
            Saat ini masih tahap konfigurasi. Perubahan di sini tidak mempengaruhi behavior VMF yang sedang berjalan.
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Service Templates
              {resp && <Badge variant="secondary">{resp.count}</Badge>}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Memuat...</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Service Type</TableHead>
                      <TableHead>Versi</TableHead>
                      <TableHead className="text-center">Fields</TableHead>
                      <TableHead className="text-center">Docs</TableHead>
                      <TableHead className="text-center">Checklist</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map(tpl => (
                      <TableRow key={tpl.serviceType} className={!tpl.isActive ? "opacity-50" : ""}>
                        <TableCell className="text-lg">{tpl.emoji}</TableCell>
                        <TableCell className="font-medium">{tpl.label}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{tpl.serviceType}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setHistTarget(tpl)}
                            className="text-xs font-mono text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                            title="Lihat riwayat versi"
                          >
                            {tpl.version}
                            <History className="h-3 w-3" />
                          </button>
                        </TableCell>
                        <TableCell className="text-center text-sm">{tpl.fields?.length ?? 0}</TableCell>
                        <TableCell className="text-center text-sm">{tpl.requiredDocuments?.length ?? 0}</TableCell>
                        <TableCell className="text-center text-sm">{tpl.checklist?.length ?? 0}</TableCell>
                        <TableCell>
                          <Badge variant={tpl.source === "db" ? "default" : tpl.source === "in-code" ? "secondary" : "outline"} className="text-xs">
                            {tpl.source ?? "db"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={tpl.isActive ? "default" : "secondary"} className="text-xs">
                            {tpl.isActive ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                              title="Riwayat Versi"
                              onClick={() => setHistTarget(tpl)}
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => openEdit(tpl)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplikat" onClick={() => openDuplicate(tpl)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className={`h-7 w-7 ${tpl.isActive ? "text-muted-foreground" : "text-green-600"}`}
                              title={tpl.isActive ? "Nonaktifkan" : "Aktifkan"}
                              onClick={() => toggleMut.mutate({ serviceType: tpl.serviceType, isActive: !tpl.isActive })}
                              disabled={toggleMut.isPending}
                            >
                              <Power className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Version History Dialog ───────────────────────────────────────────── */}
      {histTarget && (
        <VersionHistoryDialog
          serviceType={histTarget.serviceType}
          label={histTarget.label}
          open={!!histTarget}
          onClose={() => setHistTarget(null)}
        />
      )}

      {/* ── Edit Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-xl">{editTarget?.emoji}</span>
              Edit: {editTarget?.label}
              <code className="ml-2 text-xs font-normal bg-muted px-1.5 py-0.5 rounded">{editTarget?.serviceType}</code>
            </DialogTitle>
          </DialogHeader>

          {editForm && (
            <Tabs value={editTab} onValueChange={setEditTab} className="mt-2">
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="basic" className="text-xs gap-1"><List className="h-3 w-3" />Info</TabsTrigger>
                <TabsTrigger value="fields" className="text-xs gap-1"><FileText className="h-3 w-3" />Fields ({editForm.fields.length})</TabsTrigger>
                <TabsTrigger value="docs" className="text-xs gap-1"><FileText className="h-3 w-3" />Dokumen ({editForm.requiredDocuments.length})</TabsTrigger>
                <TabsTrigger value="checklist" className="text-xs gap-1"><CheckSquare className="h-3 w-3" />Checklist ({editForm.checklist.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Label <span className="text-destructive">*</span></Label>
                    <Input value={editForm.label} onChange={e => setF({ label: e.target.value })} />
                  </div>
                  <div>
                    <Label>Emoji</Label>
                    <Input value={editForm.emoji} onChange={e => setF({ emoji: e.target.value })} className="w-24" />
                  </div>
                </div>
                <div>
                  <Label>Deskripsi</Label>
                  <Textarea value={editForm.description} onChange={e => setF({ description: e.target.value })} rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Sort Order</Label>
                    <Input type="number" value={editForm.sortOrder} onChange={e => setF({ sortOrder: e.target.value })} className="w-24" />
                  </div>
                  <div>
                    <Label>Versi Manual (opsional)</Label>
                    <Input value={editForm.version} onChange={e => setF({ version: e.target.value })} placeholder="1.0.0" />
                  </div>
                </div>
                <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                  <p><strong>Versi saat ini:</strong> {editTarget?.version}</p>
                  <p>Jika field, dokumen, atau checklist berubah dan versi tidak diisi, sistem akan otomatis menaikkan minor version.</p>
                  <button
                    type="button"
                    className="text-blue-600 hover:underline flex items-center gap-1 mt-1"
                    onClick={() => { setEditOpen(false); setHistTarget(editTarget); }}
                  >
                    <History className="h-3 w-3" /> Lihat riwayat versi
                  </button>
                </div>
              </TabsContent>

              <TabsContent value="fields" className="pt-3">
                <FieldsEditor value={editForm.fields} onChange={v => setF({ fields: v })} />
              </TabsContent>

              <TabsContent value="docs" className="pt-3">
                <DocsEditor value={editForm.requiredDocuments} onChange={v => setF({ requiredDocuments: v })} />
              </TabsContent>

              <TabsContent value="checklist" className="pt-3">
                <ChecklistEditor value={editForm.checklist} onChange={v => setF({ checklist: v })} />
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={updateMut.isPending || !editForm?.label.trim()}>
              {updateMut.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Duplicate Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-4 w-4" /> Duplikat Template
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded border bg-muted/40 px-3 py-2 text-sm">
              Sumber: <strong>{dupSource?.emoji} {dupSource?.label}</strong>
              <code className="ml-1 text-xs">({dupSource?.serviceType})</code>
            </div>
            <div>
              <Label>Service Type Baru <span className="text-destructive">*</span></Label>
              <Input
                value={dupType}
                onChange={e => setDupType(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="trucking_special"
              />
              <p className="text-xs text-muted-foreground mt-1">Hanya huruf kecil, angka, underscore</p>
            </div>
            <div>
              <Label>Label Baru <span className="text-destructive">*</span></Label>
              <Input value={dupLabel} onChange={e => setDupLabel(e.target.value)} placeholder="Trucking Special" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupOpen(false)}>Batal</Button>
            <Button
              onClick={() => dupSource && dupMut.mutate({ sourceType: dupSource.serviceType, newServiceType: dupType, newLabel: dupLabel })}
              disabled={dupMut.isPending || !dupType.trim() || !dupLabel.trim()}
            >
              {dupMut.isPending ? "Menduplikat..." : "Buat Duplikat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
