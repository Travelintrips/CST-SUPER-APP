import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Plus, Pencil, Trash2, FileText, ListChecks, LayoutList, Save, X, Settings,
} from "lucide-react";

/* ─── Types ─── */
interface CustomField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  unit?: string | null;
  placeholder?: string | null;
  options?: string[] | null;
}

interface RequiredDocument {
  key: string;
  label: string;
  required: boolean;
}

interface ChecklistItem {
  key: string;
  label: string;
  category?: string | null;
}

interface ProductTemplateRaw {
  id: number;
  categoryKey: string;
  label: string;
  version: string;
  isActive: boolean;
  icon: string | null;
  description: string | null;
  sortOrder: number;
  customFields: CustomField[];
  requiredDocuments: RequiredDocument[];
  checklist: ChecklistItem[];
  packagingInstructions: string | null;
}

const FIELD_TYPES = ["text", "number", "select", "date", "boolean", "textarea"] as const;
const API_BASE = "/api/product-templates";

async function fetchDetail(id: string): Promise<ProductTemplateRaw> {
  const res = await fetch(`${API_BASE}/${id}?raw=1`);
  if (!res.ok) throw new Error("Gagal memuat detail template");
  return res.json();
}

async function apiPut(id: number, body: Partial<ProductTemplateRaw>) {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as { message?: string }).message ?? "Gagal menyimpan");
  }
  return res.json() as Promise<ProductTemplateRaw>;
}

/* ─── Field Row ─── */
function FieldRow({
  field,
  onSave,
  onDelete,
}: {
  field: CustomField;
  onSave: (updated: CustomField) => void;
  onDelete: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(field.label);
  const [unit, setUnit] = useState(field.unit ?? "");
  const [required, setRequired] = useState(field.required);

  if (!editing) return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground">{field.key}</TableCell>
      <TableCell className="font-medium">{field.label}</TableCell>
      <TableCell><Badge variant="secondary" className="text-xs">{field.type}</Badge></TableCell>
      <TableCell className="text-sm">{field.unit ?? "—"}</TableCell>
      <TableCell>
        {field.required
          ? <Badge className="text-xs bg-red-100 text-red-700 hover:bg-red-100">Wajib</Badge>
          : <span className="text-muted-foreground text-xs">Opsional</span>}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(true)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => onDelete(field.key)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <TableRow className="bg-muted/30">
      <TableCell><span className="font-mono text-xs text-muted-foreground">{field.key}</span></TableCell>
      <TableCell><Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-7 text-sm" /></TableCell>
      <TableCell><Badge variant="secondary" className="text-xs">{field.type}</Badge></TableCell>
      <TableCell><Input value={unit} onChange={(e) => setUnit(e.target.value)} className="h-7 text-sm w-20" placeholder="—" /></TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch checked={required} onCheckedChange={setRequired} />
          <span className="text-xs">{required ? "Wajib" : "Opsional"}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="sm" className="h-7 px-2" onClick={() => { onSave({ ...field, label, unit: unit || null, required }); setEditing(false); }}>
            <Save className="w-3 h-3 mr-1" />Simpan
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(false)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ─── Doc Row ─── */
function DocRow({
  doc,
  onSave,
  onDelete,
}: {
  doc: RequiredDocument;
  onSave: (updated: RequiredDocument) => void;
  onDelete: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(doc.label);
  const [required, setRequired] = useState(doc.required);

  if (!editing) return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground">{doc.key}</TableCell>
      <TableCell className="font-medium">{doc.label}</TableCell>
      <TableCell>
        {doc.required
          ? <Badge className="text-xs bg-red-100 text-red-700 hover:bg-red-100">Wajib</Badge>
          : <Badge variant="secondary" className="text-xs">Opsional</Badge>}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(true)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => onDelete(doc.key)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <TableRow className="bg-muted/30">
      <TableCell><span className="font-mono text-xs text-muted-foreground">{doc.key}</span></TableCell>
      <TableCell><Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-7 text-sm" /></TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch checked={required} onCheckedChange={setRequired} />
          <span className="text-xs">{required ? "Wajib" : "Opsional"}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="sm" className="h-7 px-2" onClick={() => { onSave({ ...doc, label, required }); setEditing(false); }}>
            <Save className="w-3 h-3 mr-1" />Simpan
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(false)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ─── Checklist Row ─── */
function ChecklistRow({
  cl,
  onSave,
  onDelete,
}: {
  cl: ChecklistItem;
  onSave: (updated: ChecklistItem) => void;
  onDelete: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(cl.label);
  const [category, setCategory] = useState(cl.category ?? "");

  if (!editing) return (
    <TableRow>
      <TableCell className="font-medium text-sm">{cl.label}</TableCell>
      <TableCell>
        {cl.category
          ? <Badge variant="outline" className="text-xs">{cl.category}</Badge>
          : <span className="text-muted-foreground text-xs">—</span>}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(true)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => onDelete(cl.key)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <TableRow className="bg-muted/30">
      <TableCell><Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-7 text-sm" /></TableCell>
      <TableCell><Input value={category} onChange={(e) => setCategory(e.target.value)} className="h-7 text-sm w-32" placeholder="Kategori" /></TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="sm" className="h-7 px-2" onClick={() => { onSave({ ...cl, label, category: category || null }); setEditing(false); }}>
            <Save className="w-3 h-3 mr-1" />Simpan
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(false)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ─── Main Page ─── */
export default function ProductTemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const QUERY_KEY = ["product-template-raw", id];

  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [addDocOpen, setAddDocOpen] = useState(false);
  const [addChecklistOpen, setAddChecklistOpen] = useState(false);
  const [editHeaderOpen, setEditHeaderOpen] = useState(false);

  const [fieldForm, setFieldForm] = useState({ key: "", label: "", type: "text", unit: "", required: false, options: "" });
  const [docForm, setDocForm] = useState({ key: "", label: "", required: true });
  const [checklistForm, setChecklistForm] = useState({ key: "", label: "", category: "" });
  const [headerForm, setHeaderForm] = useState({ label: "", icon: "", description: "", sortOrder: "" });

  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchDetail(id!),
    enabled: !!id,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: QUERY_KEY });
    qc.invalidateQueries({ queryKey: ["product-templates-raw"] });
  }, [qc, QUERY_KEY]);

  const putMut = useMutation({
    mutationFn: (body: Partial<ProductTemplateRaw>) => apiPut(Number(id), body),
    onSuccess: () => { invalidate(); },
    onError: (e) => toast({ title: "Gagal menyimpan", description: String(e), variant: "destructive" }),
  });

  /* Field operations */
  const handleAddField = () => {
    if (!fieldForm.key || !fieldForm.label) {
      toast({ title: "Key dan Label wajib diisi", variant: "destructive" });
      return;
    }
    const keyNorm = fieldForm.key.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const existing = data?.customFields ?? [];
    if (existing.some((f) => f.key === keyNorm)) {
      toast({ title: "Key sudah ada", variant: "destructive" });
      return;
    }
    const opts = fieldForm.options.trim()
      ? fieldForm.options.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const newField: CustomField = {
      key: keyNorm,
      label: fieldForm.label,
      type: fieldForm.type,
      required: fieldForm.required,
      unit: fieldForm.unit || null,
      options: opts ?? null,
    };
    putMut.mutate(
      { customFields: [...existing, newField] },
      {
        onSuccess: () => {
          setAddFieldOpen(false);
          setFieldForm({ key: "", label: "", type: "text", unit: "", required: false, options: "" });
          toast({ title: "Field ditambahkan" });
        },
      }
    );
  };

  const handleSaveField = (updated: CustomField) => {
    const fields = (data?.customFields ?? []).map((f) => (f.key === updated.key ? updated : f));
    putMut.mutate({ customFields: fields }, {
      onSuccess: () => toast({ title: "Field diperbarui" }),
    });
  };

  const handleDeleteField = (key: string) => {
    const fields = (data?.customFields ?? []).filter((f) => f.key !== key);
    putMut.mutate({ customFields: fields }, {
      onSuccess: () => toast({ title: "Field dihapus" }),
    });
  };

  /* Doc operations */
  const handleAddDoc = () => {
    if (!docForm.key || !docForm.label) {
      toast({ title: "Key dan Label wajib diisi", variant: "destructive" });
      return;
    }
    const keyNorm = docForm.key.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const existing = data?.requiredDocuments ?? [];
    if (existing.some((d) => d.key === keyNorm)) {
      toast({ title: "Key sudah ada", variant: "destructive" });
      return;
    }
    const newDoc: RequiredDocument = { key: keyNorm, label: docForm.label, required: docForm.required };
    putMut.mutate(
      { requiredDocuments: [...existing, newDoc] },
      {
        onSuccess: () => {
          setAddDocOpen(false);
          setDocForm({ key: "", label: "", required: true });
          toast({ title: "Dokumen ditambahkan" });
        },
      }
    );
  };

  const handleSaveDoc = (updated: RequiredDocument) => {
    const docs = (data?.requiredDocuments ?? []).map((d) => (d.key === updated.key ? updated : d));
    putMut.mutate({ requiredDocuments: docs }, {
      onSuccess: () => toast({ title: "Dokumen diperbarui" }),
    });
  };

  const handleDeleteDoc = (key: string) => {
    const docs = (data?.requiredDocuments ?? []).filter((d) => d.key !== key);
    putMut.mutate({ requiredDocuments: docs }, {
      onSuccess: () => toast({ title: "Dokumen dihapus" }),
    });
  };

  /* Checklist operations */
  const handleAddChecklist = () => {
    if (!checklistForm.key || !checklistForm.label) {
      toast({ title: "Key dan Label wajib diisi", variant: "destructive" });
      return;
    }
    const keyNorm = checklistForm.key.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const existing = data?.checklist ?? [];
    if (existing.some((c) => c.key === keyNorm)) {
      toast({ title: "Key sudah ada", variant: "destructive" });
      return;
    }
    const newItem: ChecklistItem = {
      key: keyNorm,
      label: checklistForm.label,
      category: checklistForm.category || null,
    };
    putMut.mutate(
      { checklist: [...existing, newItem] },
      {
        onSuccess: () => {
          setAddChecklistOpen(false);
          setChecklistForm({ key: "", label: "", category: "" });
          toast({ title: "Checklist ditambahkan" });
        },
      }
    );
  };

  const handleSaveChecklist = (updated: ChecklistItem) => {
    const items = (data?.checklist ?? []).map((c) => (c.key === updated.key ? updated : c));
    putMut.mutate({ checklist: items }, {
      onSuccess: () => toast({ title: "Checklist diperbarui" }),
    });
  };

  const handleDeleteChecklist = (key: string) => {
    const items = (data?.checklist ?? []).filter((c) => c.key !== key);
    putMut.mutate({ checklist: items }, {
      onSuccess: () => toast({ title: "Checklist dihapus" }),
    });
  };

  /* Header edit */
  const openHeaderEdit = () => {
    if (!data) return;
    setHeaderForm({
      label: data.label,
      icon: data.icon ?? "",
      description: data.description ?? "",
      sortOrder: String(data.sortOrder),
    });
    setEditHeaderOpen(true);
  };

  const handleSaveHeader = () => {
    if (!headerForm.label.trim()) {
      toast({ title: "Label wajib diisi", variant: "destructive" });
      return;
    }
    putMut.mutate(
      {
        label: headerForm.label.trim(),
        icon: headerForm.icon.trim() || null,
        description: headerForm.description.trim() || null,
        sortOrder: Number(headerForm.sortOrder) || 0,
      },
      {
        onSuccess: () => {
          setEditHeaderOpen(false);
          toast({ title: "Template diperbarui" });
        },
      }
    );
  };

  /* Toggle isActive */
  const handleToggle = () => {
    fetch(`${API_BASE}/${id}/toggle`, { method: "PATCH" })
      .then((r) => r.json())
      .then(() => { invalidate(); toast({ title: "Status diperbarui" }); })
      .catch((e) => toast({ title: "Gagal", description: String(e), variant: "destructive" }));
  };

  if (isLoading) return (
    <AppShell>
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    </AppShell>
  );

  if (error || !data) return (
    <AppShell>
      <div className="p-6 text-center text-muted-foreground">
        Template tidak ditemukan.{" "}
        <Link href="/product-templates" className="text-primary underline">Kembali</Link>
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/product-templates">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ArrowLeft className="w-4 h-4" />
                Kembali
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-3xl">{data.icon ?? "📦"}</span>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold">{data.label}</h1>
                  <Badge variant={data.isActive ? "default" : "secondary"} className="text-xs">
                    {data.isActive ? "Aktif" : "Nonaktif"}
                  </Badge>
                  <Badge variant="outline" className="text-xs font-mono">v{data.version}</Badge>
                </div>
                <span className="text-xs font-mono text-muted-foreground">{data.categoryKey}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openHeaderEdit}>
              <Settings className="w-4 h-4" />
              Edit Info
            </Button>
            <Button
              variant={data.isActive ? "secondary" : "default"}
              size="sm"
              onClick={handleToggle}
            >
              {data.isActive ? "Nonaktifkan" : "Aktifkan"}
            </Button>
          </div>
        </div>

        {data.description && (
          <p className="text-sm text-muted-foreground max-w-2xl">{data.description}</p>
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Custom Fields", value: data.customFields?.length ?? 0, color: "text-blue-600 bg-blue-50", Icon: LayoutList },
            { label: "Dokumen Wajib", value: data.requiredDocuments?.length ?? 0, color: "text-orange-600 bg-orange-50", Icon: FileText },
            { label: "Checklist", value: data.checklist?.length ?? 0, color: "text-green-600 bg-green-50", Icon: ListChecks },
          ].map(({ label, value, color, Icon }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${color.split(" ")[1]}`}>
                  <Icon className={`w-5 h-5 ${color.split(" ")[0]}`} />
                </div>
                <div>
                  <div className={`text-2xl font-bold ${color.split(" ")[0]}`}>{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="fields">
          <TabsList>
            <TabsTrigger value="fields" className="gap-1.5">
              <LayoutList className="w-3.5 h-3.5" />
              Custom Fields ({data.customFields?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              Dok Wajib ({data.requiredDocuments?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="checklist" className="gap-1.5">
              <ListChecks className="w-3.5 h-3.5" />
              Checklist ({data.checklist?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          {/* ── FIELDS TAB ── */}
          <TabsContent value="fields">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base">Custom Fields</CardTitle>
                <Button size="sm" className="gap-1.5" onClick={() => setAddFieldOpen(true)}>
                  <Plus className="w-4 h-4" />Tambah Field
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Tipe</TableHead>
                      <TableHead>Satuan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!data.customFields || data.customFields.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          Belum ada field. Tambah sekarang.
                        </TableCell>
                      </TableRow>
                    )}
                    {(data.customFields ?? []).map((f) => (
                      <FieldRow
                        key={f.key}
                        field={f}
                        onSave={handleSaveField}
                        onDelete={handleDeleteField}
                      />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── DOCS TAB ── */}
          <TabsContent value="docs">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base">Dokumen Wajib</CardTitle>
                <Button size="sm" className="gap-1.5" onClick={() => setAddDocOpen(true)}>
                  <Plus className="w-4 h-4" />Tambah Dokumen
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!data.requiredDocuments || data.requiredDocuments.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          Belum ada dokumen wajib.
                        </TableCell>
                      </TableRow>
                    )}
                    {(data.requiredDocuments ?? []).map((d) => (
                      <DocRow
                        key={d.key}
                        doc={d}
                        onSave={handleSaveDoc}
                        onDelete={handleDeleteDoc}
                      />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CHECKLIST TAB ── */}
          <TabsContent value="checklist">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base">Checklist Operasional</CardTitle>
                <Button size="sm" className="gap-1.5" onClick={() => setAddChecklistOpen(true)}>
                  <Plus className="w-4 h-4" />Tambah Item
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {(!data.checklist || data.checklist.length === 0) ? (
                  <div className="text-center text-muted-foreground py-8">Belum ada item checklist.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Kategori</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data.checklist ?? []).map((cl) => (
                        <ChecklistRow
                          key={cl.key}
                          cl={cl}
                          onSave={handleSaveChecklist}
                          onDelete={handleDeleteChecklist}
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Field Dialog */}
      <Dialog open={addFieldOpen} onOpenChange={setAddFieldOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Tambah Custom Field</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Key <span className="text-destructive">*</span></Label>
              <Input
                placeholder="cth. weight_kg"
                value={fieldForm.key}
                onChange={(e) => setFieldForm((f) => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Label <span className="text-destructive">*</span></Label>
              <Input
                placeholder="cth. Berat (kg)"
                value={fieldForm.label}
                onChange={(e) => setFieldForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipe Field</Label>
              <Select value={fieldForm.type} onValueChange={(v) => setFieldForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Satuan (opsional)</Label>
              <Input
                placeholder="cth. kg, ton, m3"
                value={fieldForm.unit}
                onChange={(e) => setFieldForm((f) => ({ ...f, unit: e.target.value }))}
              />
            </div>
            {fieldForm.type === "select" && (
              <div className="space-y-1.5">
                <Label>Opsi (pisah koma)</Label>
                <Input
                  placeholder="Pilihan A, Pilihan B"
                  value={fieldForm.options}
                  onChange={(e) => setFieldForm((f) => ({ ...f, options: e.target.value }))}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                checked={fieldForm.required}
                onCheckedChange={(v) => setFieldForm((f) => ({ ...f, required: v }))}
              />
              <Label>Wajib diisi</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddFieldOpen(false)}>Batal</Button>
            <Button onClick={handleAddField} disabled={putMut.isPending}>
              {putMut.isPending ? "Menyimpan..." : "Tambah"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Doc Dialog */}
      <Dialog open={addDocOpen} onOpenChange={setAddDocOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Tambah Dokumen Wajib</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Key <span className="text-destructive">*</span></Label>
              <Input
                placeholder="cth. bill_of_lading"
                value={docForm.key}
                onChange={(e) => setDocForm((f) => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Label / Nama Dokumen <span className="text-destructive">*</span></Label>
              <Input
                placeholder="cth. Bill of Lading"
                value={docForm.label}
                onChange={(e) => setDocForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={docForm.required}
                onCheckedChange={(v) => setDocForm((f) => ({ ...f, required: v }))}
              />
              <Label>Dokumen wajib</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDocOpen(false)}>Batal</Button>
            <Button onClick={handleAddDoc} disabled={putMut.isPending}>
              {putMut.isPending ? "Menyimpan..." : "Tambah"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Checklist Dialog */}
      <Dialog open={addChecklistOpen} onOpenChange={setAddChecklistOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Tambah Item Checklist</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Key <span className="text-destructive">*</span></Label>
              <Input
                placeholder="cth. inspect_packaging"
                value={checklistForm.key}
                onChange={(e) => setChecklistForm((f) => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Label <span className="text-destructive">*</span></Label>
              <Input
                placeholder="cth. Periksa kondisi kemasan"
                value={checklistForm.label}
                onChange={(e) => setChecklistForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kategori (opsional)</Label>
              <Input
                placeholder="cth. Pra-Muat"
                value={checklistForm.category}
                onChange={(e) => setChecklistForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddChecklistOpen(false)}>Batal</Button>
            <Button onClick={handleAddChecklist} disabled={putMut.isPending}>
              {putMut.isPending ? "Menyimpan..." : "Tambah"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Header Dialog */}
      <Dialog open={editHeaderOpen} onOpenChange={setEditHeaderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Info Template</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Label / Nama <span className="text-destructive">*</span></Label>
              <Input
                value={headerForm.label}
                onChange={(e) => setHeaderForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Icon (emoji, opsional)</Label>
              <Input
                placeholder="cth. 📦"
                value={headerForm.icon}
                onChange={(e) => setHeaderForm((f) => ({ ...f, icon: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Deskripsi (opsional)</Label>
              <Textarea
                rows={3}
                placeholder="Deskripsi singkat komoditas..."
                value={headerForm.description}
                onChange={(e) => setHeaderForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Urutan (sort order)</Label>
              <Input
                type="number"
                value={headerForm.sortOrder}
                onChange={(e) => setHeaderForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditHeaderOpen(false)}>Batal</Button>
            <Button onClick={handleSaveHeader} disabled={putMut.isPending}>
              {putMut.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
