import { AppShell } from "@/components/layout/AppShell";
import {
  useListCorrespondences,
  useCreateCorrespondence,
  useUpdateCorrespondence,
  useDeleteCorrespondence,
  useAddCorrespondenceAttachment,
  useDeleteCorrespondenceAttachment,
  useListCustomers,
  useValidateCorrespondence,
  useRejectCorrespondence,
  useArchiveCorrespondence,
  useLinkCorrespondence,
  useSyncCorrespondencesImap,
  getListCorrespondencesQueryKey,
  getGetCorrespondenceQueryOptions,
  type Correspondence,
  type CorrespondenceDetail,
  type CorrespondenceAttachment,
} from "@workspace/api-client-react";
import { usePrefetchOnHover } from "@/hooks/use-prefetch-on-hover";
import { useVendors } from "@/hooks/useVendors";
import { useState, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useUpload } from "@workspace/object-storage-web";
import {
  Plus, Search, Mail, MessageCircle, FileText, MoreHorizontal,
  Paperclip, Trash2, Eye, Pencil, Download, FileImage, ArrowDownLeft, ArrowUpRight,
  Loader2, Camera, Upload, CheckCircle2, Link2, RefreshCw, ShieldCheck, XCircle, Archive,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const KIND_LABELS: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  letter: "Surat",
  other: "Lainnya",
};

const KIND_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  whatsapp: <MessageCircle className="h-3.5 w-3.5" />,
  letter: <FileText className="h-3.5 w-3.5" />,
  other: <MoreHorizontal className="h-3.5 w-3.5" />,
};

const STATUS_LABELS: Record<string, string> = {
  new: "Baru",
  linked: "Ditautkan",
  validated: "Divalidasi",
  rejected: "Ditolak",
  archived: "Diarsipkan",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  linked: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  validated: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  archived: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  sales_order: "Sales Order (SO)",
  purchase_order: "Purchase Order (PO)",
  expense: "Biaya (Expense)",
  shipment: "Pengiriman (Shipment)",
  payment: "Pembayaran (Payment)",
  invoice: "Invoice",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? STATUS_COLORS["new"]}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function resolveAttachmentUrl(objectPath: string) {
  if (!objectPath) return null;
  if (objectPath.startsWith("/objects/")) return `/api/storage${objectPath}`;
  if (objectPath.startsWith("/api/")) return objectPath;
  return objectPath;
}

function isImage(mimeType?: string | null, fileName?: string) {
  if (mimeType?.startsWith("image/")) return true;
  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "webp"].includes(ext ?? "");
  }
  return false;
}

type FormState = {
  kind: string;
  direction: string;
  subject: string;
  body: string;
  senderName: string;
  senderEmail: string;
  receiverName: string;
  receiverEmail: string;
  customerId: string;
  supplierId: string;
  tags: string;
  correspondedAt: string;
};

type ScanPendingFields = {
  kind: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  receiverName: string;
  receiverEmail: string;
  correspondedAt: string;
  body: string;
};

type ScanPendingState = {
  fields: ScanPendingFields;
  file: File;
  previewUrl: string | null;
};

const emptyForm = (): FormState => ({
  kind: "email",
  direction: "inbound",
  subject: "",
  body: "",
  senderName: "",
  senderEmail: "",
  receiverName: "",
  receiverEmail: "",
  customerId: "__none",
  supplierId: "__none",
  tags: "",
  correspondedAt: new Date().toISOString().slice(0, 16),
});

export default function CorrespondencesPage() {
  const queryClient = useQueryClient();
  const prefetchHover = usePrefetchOnHover();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [, navigate] = useLocation();

  const [searchQ, setSearchQ] = useState("");
  const [filterKind, setFilterKind] = useState("__all__");
  const [filterDirection, setFilterDirection] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");

  const queryParams = useMemo(() => ({
    ...(searchQ.trim() ? { q: searchQ.trim() } : {}),
    ...(filterKind !== "__all__" ? { kind: filterKind as "email" | "whatsapp" | "letter" | "other" } : {}),
    ...(filterDirection !== "__all__" ? { direction: filterDirection as "inbound" | "outbound" } : {}),
    ...(filterStatus !== "__all__" ? { status: filterStatus as "new" | "linked" | "validated" | "rejected" | "archived" } : {}),
  }), [searchQ, filterKind, filterDirection, filterStatus]);

  const { data: correspondences, isLoading } = useListCorrespondences(queryParams, {
    query: { queryKey: getListCorrespondencesQueryKey(queryParams) },
  });
  const { data: customers = [] } = useListCustomers();
  const { data: suppliers = [] } = useVendors();

  const createCorrespondence = useCreateCorrespondence();
  const updateCorrespondence = useUpdateCorrespondence();
  const deleteCorrespondence = useDeleteCorrespondence();
  const addAttachment = useAddCorrespondenceAttachment();
  const deleteAttachment = useDeleteCorrespondenceAttachment();
  const validateCorrespondence = useValidateCorrespondence();
  const rejectCorrespondence = useRejectCorrespondence();
  const archiveCorrespondence = useArchiveCorrespondence();
  const linkCorrespondence = useLinkCorrespondence();
  const syncImap = useSyncCorrespondencesImap();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [viewingDetail, setViewingDetail] = useState<CorrespondenceDetail | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanPending, setScanPending] = useState<ScanPendingState | null>(null);
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [saveScannedAsAttachment, setSaveScannedAsAttachment] = useState(true);
  const scanFileInputRef = useRef<HTMLInputElement>(null);
  const scanCameraInputRef = useRef<HTMLInputElement>(null);

  // Link dialog state
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDocType, setLinkDocType] = useState("sales_order");
  const [linkDocId, setLinkDocId] = useState("");

  const { uploadFile: uploadScannedFile } = useUpload({
    onError: () => toast({ title: t.common.error, variant: "destructive" }),
  });

  const uploader = useUpload({
    onSuccess: async (res) => {
      if (!viewingDetail) return;
      addAttachment.mutate({
        id: viewingDetail.id,
        data: { objectPath: res.objectPath, fileName: res.objectPath.split("/").pop() },
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
          toast({ title: t.common.success });
          refreshDetail(viewingDetail.id);
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      });
    },
    onError: () => toast({ title: t.common.error, variant: "destructive" }),
  });

  async function refreshDetail(id: number) {
    try {
      const res = await fetch(`/api/correspondences/${id}`);
      if (res.ok) {
        const data = await res.json();
        setViewingDetail(data);
      }
    } catch {}
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setScannedFile(null);
    setSaveScannedAsAttachment(true);
    setScanPending(null);
    setIsFormOpen(true);
  }

  function openEdit(c: Correspondence) {
    setScannedFile(null);
    setSaveScannedAsAttachment(true);
    setScanPending(null);
    setEditingId(c.id);
    setForm({
      kind: c.kind,
      direction: c.direction,
      subject: c.subject,
      body: c.body ?? "",
      senderName: c.senderName ?? "",
      senderEmail: c.senderEmail ?? "",
      receiverName: c.receiverName ?? "",
      receiverEmail: c.receiverEmail ?? "",
      customerId: c.customerId ? String(c.customerId) : "__none",
      supplierId: c.supplierId ? String(c.supplierId) : "__none",
      tags: c.tags.join(", "),
      correspondedAt: new Date(c.correspondedAt).toISOString().slice(0, 16),
    });
    setIsFormOpen(true);
  }

  async function openView(c: Correspondence) {
    await refreshDetail(c.id);
    setViewOpen(true);
  }

  function buildPayload(f: FormState) {
    return {
      kind: f.kind as "email" | "whatsapp" | "letter" | "other",
      direction: f.direction as "inbound" | "outbound",
      subject: f.subject,
      body: f.body || null,
      senderName: f.senderName || null,
      senderEmail: f.senderEmail || null,
      receiverName: f.receiverName || null,
      receiverEmail: f.receiverEmail || null,
      customerId: f.customerId !== "__none" ? parseInt(f.customerId) : null,
      supplierId: f.supplierId !== "__none" ? parseInt(f.supplierId) : null,
      tags: f.tags ? f.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      correspondedAt: f.correspondedAt ? new Date(f.correspondedAt).toISOString() : null,
    };
  }

  async function handleScanFile(file: File) {
    setScanLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/api/correspondences/scan", { method: "POST", body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as { message?: string })?.message ?? `Error ${resp.status}`);
      }
      const json = await resp.json() as {
        data: {
          kind?: string | null;
          subject?: string | null;
          senderName?: string | null;
          senderEmail?: string | null;
          receiverName?: string | null;
          receiverEmail?: string | null;
          correspondedAt?: string | null;
          body?: string | null;
        }
      };
      const d = json.data;
      let parsedDate = "";
      if (d.correspondedAt) {
        try { parsedDate = new Date(d.correspondedAt).toISOString().slice(0, 16); } catch {}
      }
      const validKinds = ["email", "whatsapp", "letter", "other"];
      const detectedKind = d.kind && validKinds.includes(d.kind) ? d.kind : "";
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setScanPending({
        fields: {
          kind: detectedKind,
          subject: d.subject ?? "",
          senderName: d.senderName ?? "",
          senderEmail: d.senderEmail ?? "",
          receiverName: d.receiverName ?? "",
          receiverEmail: d.receiverEmail ?? "",
          correspondedAt: parsedDate,
          body: d.body ?? "",
        },
        file,
        previewUrl,
      });
      setSaveScannedAsAttachment(true);
    } catch (err: unknown) {
      toast({ title: err instanceof Error ? err.message : t.common.error, variant: "destructive" });
    } finally {
      setScanLoading(false);
    }
  }

  function applyScanPending() {
    if (!scanPending) return;
    const { fields, file, previewUrl } = scanPending;
    setForm((prev) => ({
      ...prev,
      ...(fields.kind ? { kind: fields.kind as "email" | "whatsapp" | "letter" | "other" } : {}),
      ...(fields.subject ? { subject: fields.subject } : {}),
      ...(fields.senderName ? { senderName: fields.senderName } : {}),
      ...(fields.senderEmail ? { senderEmail: fields.senderEmail } : {}),
      ...(fields.receiverName ? { receiverName: fields.receiverName } : {}),
      ...(fields.receiverEmail ? { receiverEmail: fields.receiverEmail } : {}),
      ...(fields.correspondedAt ? { correspondedAt: fields.correspondedAt } : {}),
      ...(fields.body ? { body: fields.body } : {}),
    }));
    setScannedFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setScanPending(null);
  }

  function dismissScanPending() {
    if (scanPending?.previewUrl) URL.revokeObjectURL(scanPending.previewUrl);
    setScanPending(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim()) return;
    const payload = buildPayload(form);
    if (editingId !== null) {
      const fileToAttach = saveScannedAsAttachment && scannedFile ? scannedFile : null;
      const currentEditingId = editingId;
      updateCorrespondence.mutate({ id: currentEditingId, data: payload }, {
        onSuccess: async () => {
          queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
          setIsFormOpen(false);
          setScannedFile(null);
          toast({ title: t.common.success });
          refreshDetail(currentEditingId);
          if (fileToAttach) {
            const uploadRes = await uploadScannedFile(fileToAttach);
            if (uploadRes) {
              addAttachment.mutate({
                id: currentEditingId,
                data: {
                  objectPath: uploadRes.objectPath,
                  fileName: fileToAttach.name,
                  mimeType: fileToAttach.type || null,
                },
              }, {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
                  refreshDetail(currentEditingId);
                },
                onError: () => toast({ title: t.common.error, variant: "destructive" }),
              });
            }
          }
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      });
    } else {
      const fileToAttach = saveScannedAsAttachment && scannedFile ? scannedFile : null;
      createCorrespondence.mutate({ data: payload }, {
        onSuccess: async (newCorrespondence) => {
          queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
          setIsFormOpen(false);
          setScannedFile(null);
          toast({ title: t.common.success });
          if (fileToAttach) {
            const uploadRes = await uploadScannedFile(fileToAttach);
            if (uploadRes) {
              addAttachment.mutate({
                id: newCorrespondence.id,
                data: {
                  objectPath: uploadRes.objectPath,
                  fileName: fileToAttach.name,
                  mimeType: fileToAttach.type || null,
                },
              }, {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
                },
                onError: () => toast({ title: t.common.error, variant: "destructive" }),
              });
            }
          }
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      });
    }
  }

  function handleDelete() {
    if (deletingId === null) return;
    deleteCorrespondence.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
        setDeletingId(null);
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleDeleteAttachment(att: CorrespondenceAttachment) {
    if (!viewingDetail) return;
    deleteAttachment.mutate({ id: viewingDetail.id, attId: att.id }, {
      onSuccess: () => {
        toast({ title: t.common.success });
        refreshDetail(viewingDetail.id);
        queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleValidate() {
    if (!viewingDetail) return;
    const id = viewingDetail.id;
    validateCorrespondence.mutate({ id }, {
      onSuccess: () => {
        refreshDetail(id);
        queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleReject() {
    if (!viewingDetail) return;
    const id = viewingDetail.id;
    rejectCorrespondence.mutate({ id }, {
      onSuccess: () => {
        refreshDetail(id);
        queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleArchive() {
    if (!viewingDetail) return;
    const id = viewingDetail.id;
    archiveCorrespondence.mutate({ id }, {
      onSuccess: () => {
        refreshDetail(id);
        queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleLink() {
    if (!viewingDetail) return;
    const docId = parseInt(linkDocId);
    if (!linkDocType || isNaN(docId) || docId <= 0) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    const id = viewingDetail.id;
    linkCorrespondence.mutate({ id, data: { linkedDocType: linkDocType as any, linkedDocId: docId } }, {
      onSuccess: () => {
        refreshDetail(id);
        queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
        setLinkOpen(false);
        setLinkDocId("");
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  function handleSync() {
    syncImap.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListCorrespondencesQueryKey() });
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" }),
    });
  }

  const isFiltered = searchQ.trim() || filterKind !== "__all__" || filterDirection !== "__all__" || filterStatus !== "__all__";

  return (
    <AppShell>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Korespondensi</h1>
            <p className="text-sm text-muted-foreground">Arsip email, surat, dan dokumen penawaran</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncImap.isPending}
              title="Sinkronisasi email dari IMAP"
              data-testid="button-sync-imap"
            >
              {syncImap.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              <span className="ml-1.5 hidden sm:inline">Sinkron Email</span>
            </Button>
            <Button onClick={openCreate} data-testid="button-add-correspondence">
              <Plus className="h-4 w-4 mr-2" /> Tambah
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Cari subjek, pengirim, isi..."
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              data-testid="input-correspondence-search"
            />
          </div>
          <Select value={filterKind} onValueChange={setFilterKind} data-testid="filter-kind">
            <SelectTrigger className="sm:w-[150px]"><SelectValue placeholder="Semua Jenis" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Jenis</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="letter">Surat</SelectItem>
              <SelectItem value="other">Lainnya</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterDirection} onValueChange={setFilterDirection} data-testid="filter-direction">
            <SelectTrigger className="sm:w-[140px]"><SelectValue placeholder="Semua Arah" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Arah</SelectItem>
              <SelectItem value="inbound">Masuk</SelectItem>
              <SelectItem value="outbound">Keluar</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus} data-testid="filter-status">
            <SelectTrigger className="sm:w-[150px]"><SelectValue placeholder="Semua Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Semua Status</SelectItem>
              <SelectItem value="new">Baru</SelectItem>
              <SelectItem value="linked">Ditautkan</SelectItem>
              <SelectItem value="validated">Divalidasi</SelectItem>
              <SelectItem value="rejected">Ditolak</SelectItem>
              <SelectItem value="archived">Diarsipkan</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
            ))
          ) : (correspondences ?? []).length === 0 ? (
            <Card><CardContent className="p-12 text-center text-muted-foreground">
              <Mail className="h-10 w-10 mb-3 mx-auto opacity-40" />
              <p className="font-medium">{isFiltered ? "Tidak ada korespondensi yang cocok." : "Belum ada korespondensi."}</p>
              {!isFiltered && <p className="text-sm mt-1">Klik "Tambah" atau "Sinkron Email" untuk memulai.</p>}
            </CardContent></Card>
          ) : (
            (correspondences ?? []).map((c) => (
              <Card key={c.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openView(c)} data-testid={`card-correspondence-${c.id}`} {...prefetchHover(getGetCorrespondenceQueryOptions(c.id))}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="mt-0.5 shrink-0 text-muted-foreground">
                        {c.direction === "inbound"
                          ? <ArrowDownLeft className="h-4 w-4 text-blue-400" />
                          : <ArrowUpRight className="h-4 w-4 text-emerald-400" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <Badge variant="outline" className="gap-1 text-xs shrink-0">
                            {KIND_ICONS[c.kind]}{KIND_LABELS[c.kind]}
                          </Badge>
                          <StatusBadge status={c.status} />
                          {c.attachments && (
                            <Badge variant="outline" className="gap-1 text-xs shrink-0 text-muted-foreground">
                              <Paperclip className="h-3 w-3" />
                            </Badge>
                          )}
                          {c.tags.length > 0 && c.tags.slice(0, 2).map((t) => (
                            <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                          ))}
                        </div>
                        <p className="font-medium truncate">{c.subject}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {c.senderName || c.senderEmail
                            ? `Dari: ${c.senderName ?? c.senderEmail}`
                            : c.receiverName || c.receiverEmail
                            ? `Ke: ${c.receiverName ?? c.receiverEmail}`
                            : "—"}
                        </p>
                        {c.linkedDocType && c.linkedDocId && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <Link2 className="h-3 w-3 inline mr-1" />
                            {DOC_TYPE_LABELS[c.linkedDocType] ?? c.linkedDocType} #{c.linkedDocId}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground hidden sm:block">{formatDate(c.correspondedAt)}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button size="icon" variant="ghost" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openView(c); }}>
                            <Eye className="h-4 w-4 mr-2" />Lihat Detail
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(c); }}>
                            <Pencil className="h-4 w-4 mr-2" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeletingId(c.id); }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />Hapus
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* CREATE / EDIT DIALOG */}
      <Dialog open={isFormOpen} onOpenChange={(o) => { if (!o) { setIsFormOpen(false); setScannedFile(null); setSaveScannedAsAttachment(true); dismissScanPending(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Korespondensi" : "Tambah Korespondensi"}</DialogTitle>
              <DialogDescription>Catat email, surat, atau penawaran sebagai arsip.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {scanPending ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Dokumen diekstrak — periksa &amp; edit sebelum diterapkan
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" onClick={dismissScanPending}>
                      Abaikan
                    </Button>
                  </div>
                  {scanPending.previewUrl ? (
                    <div className="rounded-md border overflow-hidden bg-muted">
                      <img src={scanPending.previewUrl} alt="Preview dokumen" className="w-full max-h-40 object-contain" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                      <FileText className="h-4 w-4 shrink-0" />
                      {scanPending.file.name}
                    </div>
                  )}
                  <div className="grid gap-2">
                    <div className="grid gap-1">
                      <Label className="text-xs">Jenis</Label>
                      <Select
                        value={scanPending.fields.kind || "__none"}
                        onValueChange={(v) => setScanPending((p) => p ? { ...p, fields: { ...p.fields, kind: v === "__none" ? "" : v } } : null)}
                      >
                        <SelectTrigger className="h-8 text-sm" data-testid="scan-select-kind">
                          <SelectValue placeholder="— Tidak Terdeteksi —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">— Tidak Terdeteksi —</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="whatsapp">WhatsApp</SelectItem>
                          <SelectItem value="letter">Surat</SelectItem>
                          <SelectItem value="other">Lainnya</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Subjek</Label>
                      <Input
                        value={scanPending.fields.subject}
                        onChange={(e) => setScanPending((p) => p ? { ...p, fields: { ...p.fields, subject: e.target.value } } : null)}
                        placeholder="Subjek / Judul"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1">
                        <Label className="text-xs">Nama Pengirim</Label>
                        <Input
                          value={scanPending.fields.senderName}
                          onChange={(e) => setScanPending((p) => p ? { ...p, fields: { ...p.fields, senderName: e.target.value } } : null)}
                          placeholder="Nama"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Email Pengirim</Label>
                        <Input
                          value={scanPending.fields.senderEmail}
                          onChange={(e) => setScanPending((p) => p ? { ...p, fields: { ...p.fields, senderEmail: e.target.value } } : null)}
                          placeholder="email@domain.com"
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1">
                        <Label className="text-xs">Nama Penerima</Label>
                        <Input
                          value={scanPending.fields.receiverName}
                          onChange={(e) => setScanPending((p) => p ? { ...p, fields: { ...p.fields, receiverName: e.target.value } } : null)}
                          placeholder="Nama"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Email Penerima</Label>
                        <Input
                          value={scanPending.fields.receiverEmail}
                          onChange={(e) => setScanPending((p) => p ? { ...p, fields: { ...p.fields, receiverEmail: e.target.value } } : null)}
                          placeholder="email@domain.com"
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Tanggal</Label>
                      <Input
                        type="datetime-local"
                        value={scanPending.fields.correspondedAt}
                        onChange={(e) => setScanPending((p) => p ? { ...p, fields: { ...p.fields, correspondedAt: e.target.value } } : null)}
                        className="h-8 text-sm"
                      />
                    </div>
                    {scanPending.fields.body && (
                      <div className="grid gap-1">
                        <Label className="text-xs">Isi Dokumen</Label>
                        <Textarea
                          value={scanPending.fields.body}
                          onChange={(e) => setScanPending((p) => p ? { ...p, fields: { ...p.fields, body: e.target.value } } : null)}
                          rows={3}
                          className="text-sm resize-none"
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
                    <Checkbox
                      id="save-scanned-attachment"
                      checked={saveScannedAsAttachment}
                      onCheckedChange={(v) => setSaveScannedAsAttachment(Boolean(v))}
                    />
                    <Label htmlFor="save-scanned-attachment" className="cursor-pointer text-sm font-normal">
                      Simpan file ini sebagai lampiran
                    </Label>
                    <span className="ml-auto max-w-[160px] truncate text-xs text-muted-foreground">
                      {scanPending.file.name}
                    </span>
                  </div>
                  <Button type="button" className="w-full" size="sm" onClick={applyScanPending} data-testid="button-apply-scan">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Terapkan
                  </Button>
                </div>
              ) : scanLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sedang mengekstrak data dokumen...
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 border-dashed"
                    onClick={() => scanFileInputRef.current?.click()}
                    data-testid="button-scan-document"
                  >
                    <Upload className="h-4 w-4" />
                    Upload File
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 border-dashed"
                    onClick={() => scanCameraInputRef.current?.click()}
                    data-testid="button-scan-camera"
                  >
                    <Camera className="h-4 w-4" />
                    Ambil Foto
                  </Button>
                </div>
              )}
              <input
                ref={scanFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleScanFile(file);
                  e.target.value = "";
                }}
              />
              <input
                ref={scanCameraInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleScanFile(file);
                  e.target.value = "";
                }}
              />
              {scannedFile && !scanPending && (
                <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
                  <Checkbox
                    id="save-scanned-attachment-post"
                    checked={saveScannedAsAttachment}
                    onCheckedChange={(v) => setSaveScannedAsAttachment(Boolean(v))}
                  />
                  <Label htmlFor="save-scanned-attachment-post" className="cursor-pointer text-sm font-normal">
                    Simpan file ini sebagai lampiran
                  </Label>
                  <span className="ml-auto max-w-[160px] truncate text-xs text-muted-foreground">
                    {scannedFile.name}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Jenis</Label>
                  <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="letter">Surat</SelectItem>
                      <SelectItem value="other">Lainnya</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Arah</Label>
                  <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inbound">Masuk (Dari Luar)</SelectItem>
                      <SelectItem value="outbound">Keluar (Ke Luar)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="subject">Subjek / Judul *</Label>
                <Input
                  id="subject"
                  required
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Penawaran Freight Samarinda - PT ABC"
                  data-testid="input-subject"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Pengirim</Label>
                  <Input value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} placeholder="Nama pengirim" />
                  <Input value={form.senderEmail} onChange={(e) => setForm({ ...form, senderEmail: e.target.value })} placeholder="email@domain.com" type="email" />
                </div>
                <div className="grid gap-2">
                  <Label>Penerima</Label>
                  <Input value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })} placeholder="Nama penerima" />
                  <Input value={form.receiverEmail} onChange={(e) => setForm({ ...form, receiverEmail: e.target.value })} placeholder="email@domain.com" type="email" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Terkait Customer</Label>
                  <Select value={form.customerId} onValueChange={(v) => setForm({ ...form, customerId: v })}>
                    <SelectTrigger><SelectValue placeholder="— Tidak ada —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— Tidak ada —</SelectItem>
                      {customers.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Terkait Vendor</Label>
                  <Select value={form.supplierId} onValueChange={(v) => setForm({ ...form, supplierId: v })}>
                    <SelectTrigger><SelectValue placeholder="— Tidak ada —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— Tidak ada —</SelectItem>
                      {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Tanggal Korespondensi</Label>
                <Input
                  type="datetime-local"
                  value={form.correspondedAt}
                  onChange={(e) => setForm({ ...form, correspondedAt: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Tag (pisahkan dengan koma)</Label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="freight, penawaran, samarinda"
                />
              </div>
              <div className="grid gap-2">
                <Label>Isi / Catatan</Label>
                <Textarea
                  rows={4}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  placeholder="Salin isi email atau tambahkan catatan penting..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Batal</Button>
              <Button type="submit" disabled={createCorrespondence.isPending || updateCorrespondence.isPending} data-testid="button-save-correspondence">
                {createCorrespondence.isPending || updateCorrespondence.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* VIEW DETAIL DIALOG */}
      <Dialog open={viewOpen} onOpenChange={(o) => { if (!o) { setViewOpen(false); setViewingDetail(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewingDetail && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge variant="outline" className="gap-1">
                    {KIND_ICONS[viewingDetail.kind]}{KIND_LABELS[viewingDetail.kind]}
                  </Badge>
                  <Badge variant={viewingDetail.direction === "inbound" ? "secondary" : "outline"} className="gap-1">
                    {viewingDetail.direction === "inbound"
                      ? <><ArrowDownLeft className="h-3 w-3" />Masuk</>
                      : <><ArrowUpRight className="h-3 w-3" />Keluar</>}
                  </Badge>
                  <StatusBadge status={viewingDetail.status} />
                </div>
                <DialogTitle className="text-lg leading-snug">{viewingDetail.subject}</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-1 text-sm">
                    <p className="text-muted-foreground">{formatDateTime(viewingDetail.correspondedAt)}</p>
                    {(viewingDetail.senderName || viewingDetail.senderEmail) && (
                      <p>Dari: <span className="font-medium">{viewingDetail.senderName ?? ""} {viewingDetail.senderEmail ? `<${viewingDetail.senderEmail}>` : ""}</span></p>
                    )}
                    {(viewingDetail.receiverName || viewingDetail.receiverEmail) && (
                      <p>Ke: <span className="font-medium">{viewingDetail.receiverName ?? ""} {viewingDetail.receiverEmail ? `<${viewingDetail.receiverEmail}>` : ""}</span></p>
                    )}
                    {viewingDetail.ccEmail && (
                      <p>CC: <span className="font-medium">{viewingDetail.ccEmail}</span></p>
                    )}
                    {viewingDetail.customerName && <p>Customer: <span className="font-medium">{viewingDetail.customerName}</span></p>}
                    {viewingDetail.supplierName && <p>Vendor: <span className="font-medium">{viewingDetail.supplierName}</span></p>}
                    {viewingDetail.linkedDocType && viewingDetail.linkedDocId && (
                      <p className="flex items-center gap-1">
                        <Link2 className="h-3.5 w-3.5 shrink-0" />
                        Ditautkan ke: <span className="font-medium">{DOC_TYPE_LABELS[viewingDetail.linkedDocType] ?? viewingDetail.linkedDocType} #{viewingDetail.linkedDocId}</span>
                      </p>
                    )}
                    {viewingDetail.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap pt-1">
                        {viewingDetail.tags.map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                      </div>
                    )}
                  </div>
                </DialogDescription>
              </DialogHeader>

              {viewingDetail.body && (
                <div className="mt-2">
                  <p className="text-sm font-medium text-muted-foreground mb-1">Isi / Catatan</p>
                  <div className="text-sm bg-muted/30 rounded-md p-3 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                    {viewingDetail.body}
                  </div>
                </div>
              )}

              {/* ATTACHMENTS */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Lampiran ({(viewingDetail.attachments as CorrespondenceAttachment[]).length})</p>
                  <label className="cursor-pointer">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={uploader.isUploading}
                      onClick={() => document.getElementById("att-upload")?.click()}
                      type="button"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {uploader.isUploading ? "Mengunggah..." : "Tambah Lampiran"}
                    </Button>
                    <input
                      id="att-upload"
                      type="file"
                      className="hidden"
                      accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploader.uploadFile(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {(viewingDetail.attachments as CorrespondenceAttachment[]).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md">
                    Belum ada lampiran. Upload gambar atau dokumen.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {(viewingDetail.attachments as CorrespondenceAttachment[]).map((att) => {
                      const url = resolveAttachmentUrl(att.objectPath);
                      return (
                        <div key={att.id} className="border rounded-md overflow-hidden">
                          {isImage(att.mimeType, att.fileName) && url && (
                            <a href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt={att.fileName} className="w-full max-h-64 object-contain bg-muted" />
                            </a>
                          )}
                          <div className="flex items-center gap-2 p-2 bg-muted/20">
                            <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-sm truncate flex-1">{att.fileName}</span>
                            {url && (
                              <a href={url} target="_blank" rel="noreferrer" download>
                                <Button size="icon" variant="ghost" className="h-7 w-7"><Download className="h-3.5 w-3.5" /></Button>
                              </a>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteAttachment(att)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {att.extractedText && (
                            <div className="p-2 text-xs text-muted-foreground bg-muted/10 border-t whitespace-pre-wrap max-h-32 overflow-y-auto">
                              <span className="font-medium">Teks terdeteksi:</span> {att.extractedText}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ACTION BUTTONS */}
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                  onClick={handleValidate}
                  disabled={validateCorrespondence.isPending || viewingDetail.status === "validated"}
                  data-testid="button-validate-correspondence"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Validasi
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => { setLinkDocType("sales_order"); setLinkDocId(""); setLinkOpen(true); }}
                  data-testid="button-link-correspondence"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Tautkan Transaksi
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/20"
                  onClick={handleReject}
                  disabled={rejectCorrespondence.isPending || viewingDetail.status === "rejected"}
                  data-testid="button-reject-correspondence"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Tolak
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-gray-600"
                  onClick={handleArchive}
                  disabled={archiveCorrespondence.isPending || viewingDetail.status === "archived"}
                  data-testid="button-archive-correspondence"
                >
                  <Archive className="h-3.5 w-3.5" />
                  Arsipkan
                </Button>
              </div>

              <DialogFooter className="mt-2">
                <Button variant="outline" onClick={() => openEdit(viewingDetail)} className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" />Edit
                </Button>
                <Button variant="outline" onClick={() => { setViewOpen(false); setViewingDetail(null); }}>Tutup</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* LINK TO TRANSACTION DIALOG */}
      <Dialog open={linkOpen} onOpenChange={(o) => { if (!o) setLinkOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Tautkan ke Transaksi
            </DialogTitle>
            <DialogDescription>
              Pilih jenis dokumen transaksi dan masukkan nomor ID-nya.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Jenis Dokumen</Label>
              <Select value={linkDocType} onValueChange={setLinkDocType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales_order">Sales Order (SO)</SelectItem>
                  <SelectItem value="purchase_order">Purchase Order (PO)</SelectItem>
                  <SelectItem value="invoice">Invoice</SelectItem>
                  <SelectItem value="expense">Biaya (Expense)</SelectItem>
                  <SelectItem value="payment">Pembayaran (Payment)</SelectItem>
                  <SelectItem value="shipment">Pengiriman (Shipment)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="link-doc-id">ID Dokumen</Label>
              <Input
                id="link-doc-id"
                type="number"
                min="1"
                value={linkDocId}
                onChange={(e) => setLinkDocId(e.target.value)}
                placeholder="Contoh: 42"
                data-testid="input-link-doc-id"
              />
              <p className="text-xs text-muted-foreground">
                Masukkan nomor ID dari dokumen transaksi yang ingin ditautkan.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Batal</Button>
            <Button
              onClick={handleLink}
              disabled={linkCorrespondence.isPending || !linkDocId}
              data-testid="button-confirm-link"
            >
              {linkCorrespondence.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
              Tautkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRM */}
      <AlertDialog open={deletingId !== null} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus korespondensi ini?</AlertDialogTitle>
            <AlertDialogDescription>Semua lampiran juga akan ikut dihapus. Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
