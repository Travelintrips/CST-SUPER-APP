import { DatePicker } from "@/components/ui/date-picker";
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileScan,
  Plus,
  Loader2,
  CheckCircle,
  AlertCircle,
  Pencil,
  Trash2,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { id as idLocale } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

type CustomsDocType = "PIB" | "PEB" | "SPPB" | "NPE" | "BC23" | "PP" | "SPTNP" | "other";

const DOC_TYPE_LABELS: Record<CustomsDocType, string> = {
  PIB: "PIB — Pemberitahuan Impor Barang",
  PEB: "PEB — Pemberitahuan Ekspor Barang",
  SPPB: "SPPB — Surat Persetujuan Pengeluaran Barang",
  NPE: "NPE — Nota Pelayanan Ekspor",
  BC23: "BC 2.3 — Dokumen TPB",
  PP: "PP — Pemberitahuan Pabean",
  SPTNP: "SPTNP — Surat Pemberitahuan Tarif Nilai Pabean",
  other: "Dokumen Lainnya",
};

const DOC_TYPE_BADGE_COLOR: Record<CustomsDocType, string> = {
  PIB: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  PEB: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  SPPB: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  NPE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  BC23: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  PP: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  SPTNP: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  other: "bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-300",
};

const CUSTOMS_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Diajukan",
  processing: "Diproses",
  approved: "Disetujui",
  rejected: "Ditolak",
  completed: "Selesai",
};

interface CustomsDoc {
  id: number;
  shipmentId: number | null;
  sourceModule: string | null;
  sourceOrderId: number | null;
  docType: string;
  nomorAju: string | null;
  nomorDokumen: string | null;
  tanggalDokumen: string | null;
  customsStatus: string | null;
  data: Record<string, unknown>;
  scanSource: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Field definitions per doc type ──────────────────────────────────────────

type FieldDef = { key: string; label: string; type?: "number" | "text" | "textarea"; prefix?: string };

const COMMON_FIELDS: FieldDef[] = [
  { key: "namaPerusahaan", label: "Nama Perusahaan / Importir / Eksportir" },
  { key: "npwpPerusahaan", label: "NPWP" },
  { key: "kantorPabean", label: "Kantor Pabean" },
  { key: "posHS", label: "Pos HS / HS Code" },
  { key: "uraianBarang", label: "Uraian Barang", type: "textarea" },
  { key: "jumlahKoli", label: "Jumlah Koli", type: "number" },
  { key: "beratBersih", label: "Berat Bersih (kg)", type: "number" },
  { key: "beratKotor", label: "Berat Kotor (kg)", type: "number" },
];

const DOC_EXTRA_FIELDS: Partial<Record<CustomsDocType, FieldDef[]>> = {
  PIB: [
    { key: "negaraAsal", label: "Negara Asal" },
    { key: "pelabuhan", label: "Pelabuhan Bongkar" },
    { key: "nilaiPabean", label: "Nilai Pabean (CIF) — IDR", type: "number" },
    { key: "beaMasuk", label: "Bea Masuk (BM) — IDR", type: "number" },
    { key: "ppnImpor", label: "PPN Impor — IDR", type: "number" },
    { key: "pphImpor", label: "PPh Impor — IDR", type: "number" },
    { key: "totalTagihan", label: "Total Tagihan — IDR", type: "number" },
    { key: "keteranganTambahan", label: "Keterangan Tambahan", type: "textarea" },
  ],
  PEB: [
    { key: "negaraTujuan", label: "Negara Tujuan Ekspor" },
    { key: "pelabuhan", label: "Pelabuhan Muat" },
    { key: "nilaiEkspor", label: "Nilai FOB Ekspor — USD", type: "number" },
    { key: "keteranganTambahan", label: "Keterangan Tambahan", type: "textarea" },
  ],
  SPPB: [
    { key: "nomorPIBTerkait", label: "Nomor PIB Terkait" },
    { key: "keteranganTambahan", label: "Keterangan Tambahan", type: "textarea" },
  ],
  NPE: [
    { key: "nomorPEBTerkait", label: "Nomor PEB Terkait" },
    { key: "nilaiEkspor", label: "Nilai FOB — USD", type: "number" },
    { key: "keteranganTambahan", label: "Keterangan Tambahan", type: "textarea" },
  ],
  BC23: [
    { key: "keteranganTambahan", label: "Keterangan / Jenis Fasilitas", type: "textarea" },
  ],
};

function getFieldsForDocType(docType: string): FieldDef[] {
  const extra = DOC_EXTRA_FIELDS[docType as CustomsDocType] ?? [
    { key: "keteranganTambahan", label: "Keterangan Tambahan", type: "textarea" },
  ];
  return [...COMMON_FIELDS, ...extra];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, { credentials: "include", ...options });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Source mode helpers ──────────────────────────────────────────────────────

interface CustomsPanelSource {
  shipmentId?: number;
  sourceModule?: string;
  sourceOrderId?: number;
}

function buildQueryUrl(source: CustomsPanelSource): string {
  const p = new URLSearchParams();
  if (source.shipmentId) p.set("shipmentId", String(source.shipmentId));
  if (source.sourceModule) p.set("sourceModule", source.sourceModule);
  if (source.sourceOrderId) p.set("sourceOrderId", String(source.sourceOrderId));
  return `/api/logistics/customs-docs?${p.toString()}`;
}

function buildPostBody(source: CustomsPanelSource, payload: Record<string, unknown>) {
  return {
    ...payload,
    ...(source.shipmentId ? { shipmentId: source.shipmentId } : {}),
    ...(source.sourceModule ? { sourceModule: source.sourceModule } : {}),
    ...(source.sourceOrderId ? { sourceOrderId: source.sourceOrderId } : {}),
  };
}

function customsDocsKey(source: CustomsPanelSource) {
  return ["customs-docs", source.shipmentId, source.sourceModule, source.sourceOrderId];
}

// ─── Empty form state ─────────────────────────────────────────────────────────

function emptyForm() {
  return {
    docType: "PIB" as string,
    nomorAju: "",
    nomorDokumen: "",
    tanggalDokumen: "",
    customsStatus: "",
    data: {} as Record<string, unknown>,
    scanSource: "manual",
    notes: "",
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  shipmentId?: number;
  sourceModule?: string;
  sourceOrderId?: number;
  title?: string;
}

export function FreightCustomsPanel({ shipmentId, sourceModule, sourceOrderId, title }: Props) {
  const source: CustomsPanelSource = { shipmentId, sourceModule, sourceOrderId };
  const qc = useQueryClient();

  const enabled = !!(shipmentId || (sourceModule && sourceOrderId));

  const { data: docs = [], isLoading } = useQuery<CustomsDoc[]>({
    queryKey: customsDocsKey(source),
    queryFn: () => apiFetch(buildQueryUrl(source)),
    enabled,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/api/logistics/customs-docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPostBody(source, body)),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: customsDocsKey(source) }); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch(`/api/logistics/customs-docs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: customsDocsKey(source) }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/logistics/customs-docs/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: customsDocsKey(source) }); },
  });

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<CustomsDoc | null>(null);
  const [deleteDocId, setDeleteDocId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave(form: ReturnType<typeof emptyForm>, docId?: number) {
    const payload = {
      docType: form.docType,
      nomorAju: form.nomorAju || null,
      nomorDokumen: form.nomorDokumen || null,
      tanggalDokumen: form.tanggalDokumen || null,
      customsStatus: form.customsStatus || null,
      data: form.data ?? {},
      scanSource: form.scanSource || "manual",
      notes: form.notes || null,
    };
    try {
      if (docId) {
        await updateMutation.mutateAsync({ id: docId, body: payload });
        toast.success("Dokumen kepabeanan diperbarui");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Dokumen kepabeanan ditambahkan");
      }
      setAddDialogOpen(false);
      setEditDoc(null);
    } catch (e: unknown) {
      toast.error((e as Error).message ?? "Gagal menyimpan dokumen");
    }
  }

  async function handleDelete() {
    if (!deleteDocId) return;
    try {
      await deleteMutation.mutateAsync(deleteDocId);
      toast.success("Dokumen dihapus");
    } catch {
      toast.error("Gagal menghapus dokumen");
    } finally {
      setDeleteDocId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">{title ?? "Dokumen Kepabeanan (PPJK)"}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            PIB, PEB, SPPB, NPE, dan dokumen bea cukai lainnya
          </p>
        </div>
        <Button size="sm" onClick={() => setAddDialogOpen(true)} className="gap-1.5">
          <Plus className="w-4 h-4" />
          Tambah Dokumen
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Memuat dokumen kepabeanan...
        </div>
      )}

      {!isLoading && docs.length === 0 && (
        <div className="border border-dashed rounded-lg py-8 text-center text-sm text-muted-foreground">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>Belum ada dokumen kepabeanan</p>
          <p className="text-xs mt-1">Tambahkan PIB, PEB, SPPB, atau dokumen lainnya</p>
        </div>
      )}

      <div className="space-y-2">
        {docs.map((doc) => (
          <CustomsDocCard
            key={doc.id}
            doc={doc}
            expanded={expandedIds.has(doc.id)}
            onToggle={() => toggleExpand(doc.id)}
            onEdit={() => setEditDoc(doc)}
            onDelete={() => setDeleteDocId(doc.id)}
          />
        ))}
      </div>

      <CustomsDocFormDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSave={handleSave}
        isSaving={createMutation.isPending}
      />

      {editDoc && (
        <CustomsDocFormDialog
          open={!!editDoc}
          onOpenChange={(open) => { if (!open) setEditDoc(null); }}
          initialDoc={editDoc}
          onSave={(form) => handleSave(form, editDoc.id)}
          isSaving={updateMutation.isPending}
        />
      )}

      <AlertDialog open={!!deleteDocId} onOpenChange={(o) => { if (!o) setDeleteDocId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus dokumen ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini tidak dapat dibatalkan. Data dokumen kepabeanan akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Customs Doc Card ─────────────────────────────────────────────────────────

function CustomsDocCard({
  doc, expanded, onToggle, onEdit, onDelete,
}: {
  doc: CustomsDoc; expanded: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const fields = getFieldsForDocType(doc.docType);
  const badgeClass = DOC_TYPE_BADGE_COLOR[doc.docType as CustomsDocType] ?? DOC_TYPE_BADGE_COLOR.other;
  const docTypeLabel = DOC_TYPE_LABELS[doc.docType as CustomsDocType] ?? doc.docType;

  const dataEntries = fields
    .map((f) => ({ ...f, value: doc.data?.[f.key] as string | number | null | undefined }))
    .filter((f) => f.value !== null && f.value !== undefined && f.value !== "");

  const idrFields = new Set(["nilaiPabean", "beaMasuk", "ppnImpor", "pphImpor", "totalTagihan"]);
  const usdFields = new Set(["nilaiEkspor"]);

  function formatVal(key: string, val: unknown) {
    if (typeof val !== "number") return String(val);
    if (idrFields.has(key)) return `IDR ${val.toLocaleString("id-ID")}`;
    if (usdFields.has(key)) return `USD ${val.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    return val.toLocaleString("id-ID");
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="py-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <button className="flex-1 text-left" onClick={onToggle}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}>
                {doc.docType}
              </span>
              {doc.scanSource === "ai_scan" && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                  AI Scan
                </span>
              )}
              {doc.customsStatus && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  {CUSTOMS_STATUS_LABELS[doc.customsStatus] ?? doc.customsStatus}
                </span>
              )}
              {doc.nomorDokumen && (
                <span className="font-mono text-sm font-medium">{doc.nomorDokumen}</span>
              )}
              {doc.nomorAju && (
                <span className="text-xs text-muted-foreground">Aju: {doc.nomorAju}</span>
              )}
              {doc.tanggalDokumen && (
                <span className="text-xs text-muted-foreground">{doc.tanggalDokumen}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate">{docTypeLabel}</p>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pb-4 pt-0 px-4 border-t">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-3">
            {dataEntries.length === 0 && (
              <p className="text-xs text-muted-foreground col-span-2">Tidak ada data tambahan</p>
            )}
            {dataEntries.map((f) => (
              <div key={f.key} className={f.type === "textarea" ? "col-span-2" : ""}>
                <p className="text-xs text-muted-foreground">{f.label}</p>
                <p className="text-sm font-medium break-words">{formatVal(f.key, f.value)}</p>
              </div>
            ))}
          </div>
          {doc.notes && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-muted-foreground">Catatan</p>
              <p className="text-sm whitespace-pre-wrap">{doc.notes}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Dibuat {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true, locale: idLocale })}
            {doc.updatedAt !== doc.createdAt && (
              <> · diperbarui {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true, locale: idLocale })}</>
            )}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Form Dialog ──────────────────────────────────────────────────────────────

type ScanState =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDoc?: CustomsDoc;
  onSave: (form: ReturnType<typeof emptyForm>) => void;
  isSaving: boolean;
}

function CustomsDocFormDialog({ open, onOpenChange, initialDoc, onSave, isSaving }: FormDialogProps) {
  const [scanState, setScanState] = useState<ScanState>({ kind: "idle" });
  const [scanTruncation, setScanTruncation] = useState<{ phrase: string; lineIndex: number } | null>(null);
  const [scanCharLimitHit, setScanCharLimitHit] = useState(false);

  function buildInitialForm() {
    if (!initialDoc) return emptyForm();
    return {
      docType: initialDoc.docType,
      nomorAju: initialDoc.nomorAju ?? "",
      nomorDokumen: initialDoc.nomorDokumen ?? "",
      tanggalDokumen: initialDoc.tanggalDokumen ?? "",
      customsStatus: initialDoc.customsStatus ?? "",
      data: { ...(initialDoc.data ?? {}) },
      scanSource: initialDoc.scanSource ?? "manual",
      notes: initialDoc.notes ?? "",
    };
  }

  const [form, setForm] = useState(buildInitialForm);
  const [lastDocId, setLastDocId] = useState<number | undefined>(initialDoc?.id);
  if (initialDoc?.id !== lastDocId) {
    setLastDocId(initialDoc?.id);
    setForm(buildInitialForm());
    setScanState({ kind: "idle" });
  }

  const fields = getFieldsForDocType(form.docType);

  function setDataField(key: string, value: string | number | null) {
    setForm((prev) => ({ ...prev, data: { ...prev.data, [key]: value === "" ? null : value } }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleScan(file);
    e.target.value = "";
  }

  const handleScan = useCallback(async (file: File) => {
    setScanState({ kind: "uploading", fileName: file.name });
    setScanTruncation(null);
    setScanCharLimitHit(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/api/scan-document", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();
      if (result.truncation) setScanTruncation(result.truncation as { phrase: string; lineIndex: number });
      if (result.charLimitHit) setScanCharLimitHit(true);

      if (result.docType !== "customs") {
        toast.warning("Dokumen yang di-scan bukan dokumen kepabeanan. Data tidak dapat diekstrak otomatis.");
        setScanState({ kind: "error", message: "Bukan dokumen kepabeanan" });
        return;
      }

      const { customsDocType, nomorAju, nomorDokumen, tanggalDokumen, ...rest } = result;
      const docType: CustomsDocType = (customsDocType && customsDocType in DOC_TYPE_LABELS)
        ? customsDocType
        : "other";

      const newData: Record<string, unknown> = {};
      const dataKeys = [
        "namaPerusahaan", "npwpPerusahaan", "kantorPabean", "posHS", "uraianBarang",
        "jumlahKoli", "beratBersih", "beratKotor", "negaraAsal", "negaraTujuan", "pelabuhan",
        "nilaiPabean", "beaMasuk", "ppnImpor", "pphImpor", "totalTagihan", "nilaiEkspor",
        "nomorPIBTerkait", "nomorPEBTerkait", "keteranganTambahan",
      ];
      for (const key of dataKeys) {
        if (rest[key] !== null && rest[key] !== undefined) newData[key] = rest[key];
      }

      setForm((prev) => ({
        ...prev,
        docType,
        nomorAju: nomorAju ?? prev.nomorAju,
        nomorDokumen: nomorDokumen ?? prev.nomorDokumen,
        tanggalDokumen: tanggalDokumen ?? prev.tanggalDokumen,
        data: newData,
        scanSource: "ai_scan",
      }));
      setScanState({ kind: "done" });
      toast.success(`Dokumen ${docType} berhasil di-scan — periksa dan simpan data`);
    } catch (e: unknown) {
      setScanState({ kind: "error", message: (e as Error).message });
      toast.error("Gagal scan dokumen: " + (e as Error).message);
    }
  }, []);

  const isEdit = !!initialDoc;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Dokumen Kepabeanan" : "Tambah Dokumen Kepabeanan"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Scan CTA (only when adding) */}
          {!isEdit && (
            <div className="relative border border-dashed rounded-lg p-4 bg-muted/30">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <FileScan className="w-6 h-6 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Scan Dokumen dengan AI</p>
                    <p className="text-xs text-muted-foreground">
                      Upload PDF atau foto dokumen, AI akan mengekstrak data otomatis
                    </p>
                  </div>
                </div>
                <label className="cursor-pointer">
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
                  <Button type="button" size="sm" variant="outline" className="gap-1.5 pointer-events-none">
                    <FileScan className="w-4 h-4" /> Scan Dokumen
                  </Button>
                </label>
              </div>
              {scanState.kind === "uploading" && (
                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Menganalisis {scanState.fileName}...
                </div>
              )}
              {scanState.kind === "done" && (
                <div className="flex items-center gap-2 mt-3 text-xs text-green-700">
                  <CheckCircle className="w-3.5 h-3.5" /> Data berhasil diekstrak — periksa sebelum simpan
                </div>
              )}
              {scanState.kind === "error" && (
                <div className="flex items-center gap-2 mt-3 text-xs text-destructive">
                  <AlertCircle className="w-3.5 h-3.5" /> {scanState.message}
                </div>
              )}
              {scanTruncation && (
                <p className="text-xs text-amber-600 mt-1">
                  Dokumen dipotong pada baris {scanTruncation.lineIndex}: "{scanTruncation.phrase}"
                </p>
              )}
              {scanCharLimitHit && (
                <p className="text-xs text-amber-600 mt-1">Batas karakter tercapai — hanya sebagian dokumen yang dianalisis</p>
              )}
            </div>
          )}

          {/* Doc Type */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Jenis Dokumen *</Label>
              <Select value={form.docType} onValueChange={(v) => setForm((p) => ({ ...p, docType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{k} — {v.split("—")[1]?.trim()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status Kepabeanan</Label>
              <Select value={form.customsStatus || "none"} onValueChange={(v) => setForm((p) => ({ ...p, customsStatus: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih status..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tidak ada —</SelectItem>
                  {Object.entries(CUSTOMS_STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Core fields */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Nomor Aju</Label>
              <Input value={form.nomorAju} onChange={(e) => setForm((p) => ({ ...p, nomorAju: e.target.value }))} placeholder="Nomor pengajuan" />
            </div>
            <div className="space-y-1.5">
              <Label>Nomor Dokumen</Label>
              <Input value={form.nomorDokumen} onChange={(e) => setForm((p) => ({ ...p, nomorDokumen: e.target.value }))} placeholder="Nomor dokumen resmi" />
            </div>
            <div className="space-y-1.5">
              <Label>Tanggal Dokumen</Label>
              <DatePicker value={form.tanggalDokumen} onChange={(v) => setForm((p) => ({ ...p, tanggalDokumen: v }))} />
            </div>
          </div>

          {/* Dynamic fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.key} className={`space-y-1.5 ${f.type === "textarea" ? "sm:col-span-2" : ""}`}>
                <Label>{f.label}</Label>
                {f.type === "textarea" ? (
                  <Textarea
                    value={(form.data[f.key] as string) ?? ""}
                    onChange={(e) => setDataField(f.key, e.target.value)}
                    rows={2}
                    className="resize-none"
                  />
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : "text"}
                    value={(form.data[f.key] as string | number) ?? ""}
                    onChange={(e) => setDataField(f.key, f.type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Catatan</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              rows={2}
              className="resize-none"
              placeholder="Catatan tambahan..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={() => onSave(form)} disabled={isSaving || !form.docType}>
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {isEdit ? "Simpan Perubahan" : "Tambah Dokumen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
