import { useRef, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ImageIcon, Upload, Copy, Trash2, Search, Loader2, CheckCheck,
  ExternalLink, FolderOpen, FolderPlus, FolderIcon, MoreVertical,
  ArrowRightLeft, ChevronRight, ChevronLeft, Images, Pencil, FolderX,
  CheckSquare2, Square, MousePointerClick, X as XIcon, ZoomIn, Info,
  Scissors, RotateCcw, ScanLine, Link2, Globe,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface MediaAsset {
  id: number;
  originalName: string;
  contentType: string;
  sizeBytes: number | null;
  url: string;
  objectPath: string;
  uploadedBy: string | null;
  folder: string;
  createdAt: string;
  publicUrl: string | null;
}

interface FolderStat {
  folder: string;
  count: number;
}

const FOLDER_COLORS: Record<string, string> = {
  "Umum": "text-slate-500",
  "Foto Produk": "text-blue-500",
  "Banner Website": "text-purple-500",
  "Logo Vendor": "text-amber-500",
};

function folderColor(name: string) {
  return FOLDER_COLORS[name] ?? "text-emerald-500";
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(val: string) {
  return new Date(val).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function getAbsoluteUrl(url: string) {
  if (url.startsWith("http")) return url;
  return `${window.location.origin}${url}`;
}

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) throw new Error("fetch error");
  return res.json();
}

const ALL_FOLDER = "__all__";

export default function MediaManagerPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copyingPublicId, setCopyingPublicId] = useState<number | null>(null);
  const [copiedPublicId, setCopiedPublicId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);
  const [activeFolder, setActiveFolder] = useState<string>(ALL_FOLDER);

  // Dialog buat folder baru
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Dialog pindah folder (single)
  const [moveTarget, setMoveTarget] = useState<MediaAsset | null>(null);
  const [moveFolder, setMoveFolder] = useState("");

  // Dialog rename folder
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameNewName, setRenameNewName] = useState("");

  // Dialog hapus folder
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<FolderStat | null>(null);

  // Lightbox
  const [lightboxId, setLightboxId] = useState<number | null>(null);

  // Bulk select
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveFolder, setBulkMoveFolder] = useState("");
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // ── State Crop/Resize ──
  const imgRef = useRef<HTMLImageElement>(null);
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const [cropQueueTotal, setCropQueueTotal] = useState(0);
  const [cropQueueDone, setCropQueueDone] = useState(0);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropSrc, setCropSrc] = useState<string>("");
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [cropAspect, setCropAspect] = useState<number | undefined>(undefined);

  const { data: foldersData, isLoading: foldersLoading } = useQuery<{ folders: FolderStat[] }>({
    queryKey: ["media-folders"],
    queryFn: () => apiFetch("/api/media/folders"),
    staleTime: 15_000,
  });

  const { data, isLoading } = useQuery<{ items: MediaAsset[] }>({
    queryKey: ["media-assets", activeFolder],
    queryFn: () =>
      activeFolder === ALL_FOLDER
        ? apiFetch("/api/media")
        : apiFetch(`/api/media?folder=${encodeURIComponent(activeFolder)}`),
    staleTime: 15_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/media/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media-assets"] });
      qc.invalidateQueries({ queryKey: ["media-folders"] });
      setDeleteTarget(null);
      toast({ title: "Gambar dihapus dari daftar" });
    },
    onError: () => toast({ title: "Gagal menghapus", variant: "destructive" }),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, folder }: { id: number; folder: string }) =>
      apiFetch(`/api/media/${id}/folder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media-assets"] });
      qc.invalidateQueries({ queryKey: ["media-folders"] });
      setMoveTarget(null);
      toast({ title: "Gambar dipindahkan ke folder lain" });
    },
    onError: () => toast({ title: "Gagal memindahkan gambar", variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ oldName, newName }: { oldName: string; newName: string }) =>
      apiFetch("/api/media/folders/rename", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldName, newName }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["media-assets"] });
      qc.invalidateQueries({ queryKey: ["media-folders"] });
      if (activeFolder === vars.oldName) setActiveFolder(vars.newName);
      setRenameTarget(null);
      toast({ title: `Folder berhasil diubah menjadi "${vars.newName}"` });
    },
    onError: () => toast({ title: "Gagal mengubah nama folder", variant: "destructive" }),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/api/media/folders/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: (_data, name) => {
      qc.invalidateQueries({ queryKey: ["media-assets"] });
      qc.invalidateQueries({ queryKey: ["media-folders"] });
      if (activeFolder === name) setActiveFolder(ALL_FOLDER);
      setDeleteFolderTarget(null);
      toast({ title: `Folder dihapus, gambar dipindahkan ke "Umum"` });
    },
    onError: () => toast({ title: "Gagal menghapus folder", variant: "destructive" }),
  });

  const bulkMoveMutation = useMutation({
    mutationFn: ({ ids, folder }: { ids: number[]; folder: string }) =>
      apiFetch("/api/media/bulk-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, folder }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["media-assets"] });
      qc.invalidateQueries({ queryKey: ["media-folders"] });
      setBulkMoveOpen(false);
      exitSelectMode();
      toast({ title: `${vars.ids.length} gambar dipindahkan ke "${vars.folder}"` });
    },
    onError: () => toast({ title: "Gagal memindahkan gambar", variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) =>
      apiFetch("/api/media/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (_data, ids) => {
      qc.invalidateQueries({ queryKey: ["media-assets"] });
      qc.invalidateQueries({ queryKey: ["media-folders"] });
      setBulkDeleteOpen(false);
      exitSelectMode();
      toast({ title: `${ids.length} gambar dihapus` });
    },
    onError: () => toast({ title: "Gagal menghapus gambar", variant: "destructive" }),
  });

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function openRenameDialog(folderName: string) {
    setRenameTarget(folderName);
    setRenameNewName(folderName);
  }

  function openMoveDialog(asset: MediaAsset) {
    setMoveTarget(asset);
    setMoveFolder(asset.folder);
  }

  const folders = foldersData?.folders ?? [];
  const allFolderNames = folders.map((f) => f.folder);
  const totalCount = folders.reduce((sum, f) => sum + f.count, 0);

  const items = data?.items ?? [];
  const filtered = items.filter((a) =>
    !search.trim() || a.originalName.toLowerCase().includes(search.toLowerCase())
  );

  // ── Lightbox helpers ──
  const lightboxIndex = lightboxId !== null ? filtered.findIndex((a) => a.id === lightboxId) : -1;
  const lightboxAsset = lightboxIndex >= 0 ? filtered[lightboxIndex] : null;

  function lightboxPrev() {
    if (lightboxIndex > 0) setLightboxId(filtered[lightboxIndex - 1].id);
  }
  function lightboxNext() {
    if (lightboxIndex >= 0 && lightboxIndex < filtered.length - 1)
      setLightboxId(filtered[lightboxIndex + 1].id);
  }

  useEffect(() => {
    if (lightboxId === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxId(null);
      if (e.key === "ArrowLeft") lightboxPrev();
      if (e.key === "ArrowRight") lightboxNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxId, lightboxIndex]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id));
  const selectedCount = selectedIds.size;
  const currentFolder = activeFolder === ALL_FOLDER ? "Semua Folder" : activeFolder;

  // ── Buka crop dialog untuk file pertama dalam antrian ──
  function openCropFor(queue: File[]) {
    if (queue.length === 0) return;
    const file = queue[0];
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result as string);
      setCropFile(file);
      setCrop(undefined);
      setCompletedCrop(undefined);
      setCropAspect(undefined);
      setCropQueue(queue.slice(1));
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
  }

  // ── Inisiasi antrian crop saat file dipilih ──
  function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) {
      toast({ title: "Hanya file gambar yang didukung", variant: "destructive" });
      return;
    }
    setCropQueueTotal(arr.length);
    setCropQueueDone(0);
    openCropFor(arr);
  }

  // ── Upload satu file ke server ──
  async function uploadSingleFile(file: File, blobOverride?: Blob) {
    const targetFolder = activeFolder === ALL_FOLDER ? "Umum" : activeFolder;
    const formData = new FormData();
    const fileToUpload = blobOverride
      ? new File([blobOverride], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" })
      : file;
    formData.append("file", fileToUpload);
    formData.append("folder", targetFolder);
    const res = await fetch("/api/media/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.error ?? j.message ?? msg; } catch {}
      throw new Error(msg);
    }
  }

  // ── Potong gambar dari canvas ──
  async function getCroppedBlob(): Promise<Blob | null> {
    const image = imgRef.current;
    if (!image || !completedCrop?.width || !completedCrop?.height) return null;
    const canvas = document.createElement("canvas");
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width = Math.round(completedCrop.width * scaleX);
    canvas.height = Math.round(completedCrop.height * scaleY);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0, 0,
      canvas.width,
      canvas.height,
    );
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  }

  // ── Selesai crop → proses file berikutnya ──
  function afterUploadNext() {
    setCropQueueDone((prev) => prev + 1);
    if (cropQueue.length > 0) {
      setTimeout(() => openCropFor(cropQueue), 80);
    } else {
      qc.invalidateQueries({ queryKey: ["media-assets"] });
      qc.invalidateQueries({ queryKey: ["media-folders"] });
      setCropQueueTotal(0);
      setCropQueueDone(0);
    }
  }

  // ── Tombol "Potong & Unggah" ──
  async function handleCropUpload() {
    if (!cropFile) return;
    setCropOpen(false);
    setUploading(true);
    try {
      const blob = completedCrop?.width ? await getCroppedBlob() : null;
      await uploadSingleFile(cropFile, blob ?? undefined);
      toast({ title: `"${cropFile.name}" berhasil diunggah` });
    } catch (err) {
      toast({
        title: `Gagal mengunggah "${cropFile?.name}"`,
        description: err instanceof Error ? err.message : "Terjadi kesalahan",
        variant: "destructive",
      });
    }
    setUploading(false);
    afterUploadNext();
  }

  // ── Tombol "Lewati, Unggah Asli" ──
  async function handleSkipCrop() {
    if (!cropFile) return;
    setCropOpen(false);
    setUploading(true);
    try {
      await uploadSingleFile(cropFile);
      toast({ title: `"${cropFile.name}" diunggah tanpa pemotongan` });
    } catch (err) {
      toast({
        title: `Gagal mengunggah "${cropFile?.name}"`,
        description: err instanceof Error ? err.message : "Terjadi kesalahan",
        variant: "destructive",
      });
    }
    setUploading(false);
    afterUploadNext();
  }

  // ── Tutup dialog (batalkan semua antrian tersisa) ──
  function handleCloseCropDialog() {
    setCropOpen(false);
    setCropQueue([]);
    setCropQueueTotal(0);
    setCropQueueDone(0);
    qc.invalidateQueries({ queryKey: ["media-assets"] });
    qc.invalidateQueries({ queryKey: ["media-folders"] });
  }

  // ── Saat gambar dimuat di crop, set crop awal ──
  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    const aspect = cropAspect ?? w / h;
    setCrop(centerCrop(makeAspectCrop({ unit: "%", width: 90 }, aspect, w, h), w, h));
  }, [cropAspect]);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) uploadFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
  }

  async function copyUrl(asset: MediaAsset) {
    const url = getAbsoluteUrl(asset.url);
    await navigator.clipboard.writeText(url);
    setCopiedId(asset.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "URL (sesi) disalin ke clipboard!" });
  }

  async function copyPublicUrl(asset: MediaAsset) {
    setCopyingPublicId(asset.id);
    try {
      const res = await fetch(`/api/media/${asset.id}/copy-public`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Gagal");
      await navigator.clipboard.writeText(json.publicUrl);
      setCopiedPublicId(asset.id);
      setTimeout(() => setCopiedPublicId(null), 3000);
      toast({
        title: "URL Publik disalin!",
        description: "Link bisa dibuka siapa saja tanpa login.",
      });
    } catch (err: any) {
      toast({ title: "Gagal membuat URL publik", description: err?.message, variant: "destructive" });
    } finally {
      setCopyingPublicId(null);
    }
  }

  function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setActiveFolder(name);
    setNewFolderOpen(false);
    setNewFolderName("");
    toast({
      title: `Folder "${name}" siap`,
      description: "Unggah gambar untuk mengisi folder ini.",
    });
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-4rem)]">
        {/* ── Sidebar Folder ── */}
        <aside className="w-56 shrink-0 border-r bg-muted/20 flex flex-col">
          <div className="p-4 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Folder</p>
          </div>

          <button
            onClick={() => { setActiveFolder(ALL_FOLDER); exitSelectMode(); }}
            className={`flex items-center gap-2.5 px-4 py-2.5 text-sm w-full text-left transition-colors ${
              activeFolder === ALL_FOLDER
                ? "bg-primary/10 text-primary font-semibold"
                : "hover:bg-muted/50 text-foreground"
            }`}
          >
            <Images className="w-4 h-4 shrink-0" />
            <span className="flex-1 truncate">Semua Gambar</span>
            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">{totalCount}</Badge>
          </button>

          <div className="flex-1 overflow-y-auto py-1">
            {foldersLoading ? (
              <div className="px-4 py-2 space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
            ) : (
              folders.map((f) => (
                <div
                  key={f.folder}
                  className={`group flex items-center gap-2.5 px-3 py-2.5 text-sm w-full transition-colors ${
                    activeFolder === f.folder
                      ? "bg-primary/10 text-primary font-semibold"
                      : "hover:bg-muted/50 text-foreground"
                  }`}
                >
                  <button
                    onClick={() => { setActiveFolder(f.folder); exitSelectMode(); }}
                    className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  >
                    <FolderIcon className={`w-4 h-4 shrink-0 ${folderColor(f.folder)}`} />
                    <span className="flex-1 truncate">{f.folder}</span>
                  </button>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 group-hover:hidden">
                    {f.count}
                  </Badge>
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); openRenameDialog(f.folder); }}
                      title="Ubah nama folder"
                      className="flex items-center justify-center w-5 h-5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {f.folder !== "Umum" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteFolderTarget(f); }}
                        title="Hapus folder"
                        className="flex items-center justify-center w-5 h-5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <FolderX className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={() => setNewFolderOpen(true)}
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Folder Baru
            </Button>
          </div>
        </aside>

        {/* ── Konten Utama ── */}
        <div className="flex-1 overflow-y-auto relative">
          <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <ImageIcon className="w-6 h-6 text-primary" />
                  Image Manager
                </h1>
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>{currentFolder}</span>
                  {activeFolder !== ALL_FOLDER && (
                    <>
                      <ChevronRight className="w-3 h-3" />
                      <span>{filtered.length} gambar</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={selectMode ? "default" : "outline"}
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    if (selectMode) exitSelectMode();
                    else setSelectMode(true);
                  }}
                >
                  <MousePointerClick className="w-3.5 h-3.5" />
                  {selectMode ? "Batalkan Pilih" : "Pilih"}
                </Button>
                <Button onClick={() => fileInputRef.current?.click()} disabled={uploading || selectMode}>
                  {uploading
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Upload className="w-4 h-4 mr-2" />}
                  Unggah ke {activeFolder === ALL_FOLDER ? '"Umum"' : `"${activeFolder}"`}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileInput}
              />
            </div>

            {/* Drop zone — sembunyikan saat select mode */}
            {!selectMode && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/30"
                }`}
              >
                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm font-medium">Mengunggah dan mengompres...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Upload className="w-7 h-7" />
                    <p className="text-sm font-medium">
                      Seret gambar ke sini — akan masuk ke folder{" "}
                      <strong>{activeFolder === ALL_FOLDER ? "Umum" : activeFolder}</strong>
                    </p>
                    <p className="text-xs">JPG, PNG, WebP, GIF — maks 20 MB per file, dikompres otomatis</p>
                  </div>
                )}
              </div>
            )}

            {/* Search + kontrol pilih */}
            <div className="flex items-center gap-3 flex-wrap">
              {!selectMode ? (
                <>
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Cari nama file..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground ml-auto">
                    {filtered.length} gambar
                  </span>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-primary">
                    Mode Pilih — klik gambar untuk memilih
                  </p>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {selectedCount} dipilih
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 px-2"
                      onClick={() => {
                        if (allFilteredSelected) {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            filtered.forEach((a) => next.delete(a.id));
                            return next;
                          });
                        } else {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            filtered.forEach((a) => next.add(a.id));
                            return next;
                          });
                        }
                      }}
                    >
                      {allFilteredSelected ? (
                        <><CheckSquare2 className="w-3.5 h-3.5 mr-1" />Batalkan Semua</>
                      ) : (
                        <><Square className="w-3.5 h-3.5 mr-1" />Pilih Semua</>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>

            {/* Grid */}
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium mb-1">
                  {search ? "Tidak ada gambar yang cocok." : "Folder ini masih kosong."}
                </p>
                {!search && (
                  <p className="text-xs">Unggah gambar atau seret file ke area di atas.</p>
                )}
              </div>
            ) : (
              <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 ${selectMode ? "pb-24" : ""}`}>
                {filtered.map((asset) => {
                  const isSelected = selectedIds.has(asset.id);
                  return (
                    <Card
                      key={asset.id}
                      onClick={() => selectMode && toggleSelect(asset.id)}
                      className={`group overflow-hidden border transition-all ${
                        selectMode
                          ? isSelected
                            ? "ring-2 ring-primary border-primary shadow-md cursor-pointer"
                            : "hover:border-primary/50 cursor-pointer"
                          : "hover:shadow-md"
                      }`}
                    >
                      <div className="relative aspect-square bg-muted/40">
                        <img
                          src={asset.url}
                          alt={asset.originalName}
                          className={`w-full h-full object-cover ${!selectMode ? "cursor-zoom-in" : ""}`}
                          loading="lazy"
                          onClick={(e) => {
                            if (!selectMode) { e.stopPropagation(); setLightboxId(asset.id); }
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='1.5'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/%3E%3C/svg%3E";
                          }}
                        />

                        {/* Checkbox overlay (select mode) */}
                        {selectMode && (
                          <div className={`absolute inset-0 flex items-start justify-start p-2 transition-colors ${isSelected ? "bg-primary/20" : "bg-transparent hover:bg-black/10"}`}>
                            <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${isSelected ? "bg-primary border-primary text-primary-foreground" : "bg-white/80 border-white/80"}`}>
                              {isSelected && <CheckCheck className="w-3 h-3" />}
                            </div>
                          </div>
                        )}

                        {/* Overlay actions (normal mode) */}
                        {!selectMode && (
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                            {/* Salin URL Publik — utama */}
                            <Button
                              size="icon"
                              variant="secondary"
                              className="h-7 w-7"
                              title="Salin URL Publik (tanpa login)"
                              onClick={(e) => { e.stopPropagation(); copyPublicUrl(asset); }}
                              disabled={copyingPublicId === asset.id}
                            >
                              {copyingPublicId === asset.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : copiedPublicId === asset.id
                                  ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                                  : <Globe className="w-3.5 h-3.5" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="secondary"
                              className="h-7 w-7"
                              title="Buka di tab baru"
                              onClick={() => window.open(asset.url, "_blank")}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="secondary" className="h-7 w-7" title="Lainnya">
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel className="text-xs">Aksi</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => copyPublicUrl(asset)} disabled={copyingPublicId === asset.id}>
                                  {copyingPublicId === asset.id
                                    ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                                    : <Globe className="w-3.5 h-3.5 mr-2 text-emerald-600" />}
                                  Salin URL Publik
                                  {asset.publicUrl && <span className="ml-auto text-[10px] text-muted-foreground pl-2">✓ cached</span>}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => copyUrl(asset)}>
                                  <Link2 className="w-3.5 h-3.5 mr-2 text-blue-500" />
                                  Salin URL Internal
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => openMoveDialog(asset)}>
                                  <ArrowRightLeft className="w-3.5 h-3.5 mr-2" />
                                  Pindah Folder
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setDeleteTarget(asset)}
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                                  Hapus
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}

                        {/* Badge folder (hanya saat lihat semua, normal mode) */}
                        {activeFolder === ALL_FOLDER && !selectMode && (
                          <div className="absolute bottom-1 left-1">
                            <Badge
                              variant="secondary"
                              className="text-[10px] py-0 px-1.5 h-4 bg-black/60 text-white border-0"
                            >
                              {asset.folder}
                            </Badge>
                          </div>
                        )}
                      </div>
                      <CardContent className="p-2 space-y-1">
                        <p className="text-xs font-medium truncate" title={asset.originalName}>
                          {asset.originalName}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatBytes(asset.sizeBytes)}</p>
                        {!selectMode && (
                          <>
                            <button
                              onClick={() => copyUrl(asset)}
                              className="w-full flex items-center gap-1.5 mt-1 px-2 py-1 rounded bg-muted hover:bg-primary/10 transition-colors text-left"
                              title="Klik untuk salin URL"
                            >
                              {copiedId === asset.id
                                ? <CheckCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                                : <Copy className="w-3 h-3 text-muted-foreground shrink-0" />}
                              <span className="text-xs text-muted-foreground truncate font-mono">
                                {getAbsoluteUrl(asset.url).replace(window.location.origin, "")}
                              </span>
                            </button>
                            <p className="text-xs text-muted-foreground">{fmtDate(asset.createdAt)}</p>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Floating Bulk Action Bar ── */}
          {selectMode && selectedCount > 0 && (
            <div className="sticky bottom-0 left-0 right-0 z-20 p-4">
              <div className="max-w-lg mx-auto bg-foreground text-background rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <CheckSquare2 className="w-4 h-4 shrink-0" />
                  <span className="font-semibold text-sm">{selectedCount} gambar dipilih</span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1.5 h-8"
                  onClick={() => {
                    setBulkMoveFolder(activeFolder === ALL_FOLDER ? "" : activeFolder);
                    setBulkMoveOpen(true);
                  }}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  Pindah Folder
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1.5 h-8"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Hapus
                </Button>
                <button
                  onClick={exitSelectMode}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors shrink-0"
                  title="Batalkan pilihan"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Dialog: Buat Folder Baru ── */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="w-4 h-4" />
              Buat Folder Baru
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="Contoh: Banner Website, Logo Vendor..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Folder akan muncul otomatis setelah Anda mengunggah gambar ke dalamnya.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Batal</Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
              Buat & Buka Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Pindah Folder (single) ── */}
      <Dialog open={!!moveTarget} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              Pindah ke Folder
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground truncate">
              <strong>{moveTarget?.originalName}</strong>
            </p>
            <FolderPicker
              folders={allFolderNames}
              selected={moveFolder}
              onSelect={setMoveFolder}
              currentFolder={moveTarget?.folder}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)}>Batal</Button>
            <Button
              disabled={!moveFolder.trim() || moveFolder === moveTarget?.folder || moveMutation.isPending}
              onClick={() => moveTarget && moveMutation.mutate({ id: moveTarget.id, folder: moveFolder })}
            >
              {moveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Pindahkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Pindah Folder (bulk) ── */}
      <Dialog open={bulkMoveOpen} onOpenChange={(open) => !open && setBulkMoveOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              Pindah {selectedCount} Gambar ke Folder
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <FolderPicker
              folders={allFolderNames}
              selected={bulkMoveFolder}
              onSelect={setBulkMoveFolder}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkMoveOpen(false)}>Batal</Button>
            <Button
              disabled={!bulkMoveFolder.trim() || bulkMoveMutation.isPending}
              onClick={() =>
                bulkMoveMutation.mutate({ ids: Array.from(selectedIds), folder: bulkMoveFolder })
              }
            >
              {bulkMoveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Pindahkan {selectedCount} Gambar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Rename Folder ── */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4" />
              Ubah Nama Folder
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Semua gambar di folder <strong>"{renameTarget}"</strong> akan dipindahkan ke nama baru.
            </p>
            <Input
              placeholder="Nama folder baru..."
              value={renameNewName}
              onChange={(e) => setRenameNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameNewName.trim() && renameNewName.trim() !== renameTarget) {
                  renameMutation.mutate({ oldName: renameTarget!, newName: renameNewName.trim() });
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Batal</Button>
            <Button
              disabled={
                !renameNewName.trim() ||
                renameNewName.trim() === renameTarget ||
                renameMutation.isPending
              }
              onClick={() =>
                renameMutation.mutate({ oldName: renameTarget!, newName: renameNewName.trim() })
              }
            >
              {renameMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Lightbox ── */}
      {lightboxAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          onClick={() => setLightboxId(null)}
        >
          {/* Top bar */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 min-w-0">
              <ZoomIn className="w-4 h-4 text-white/60 shrink-0" />
              <span className="text-white font-medium text-sm truncate">
                {lightboxAsset.originalName}
              </span>
              <Badge variant="secondary" className="text-xs shrink-0">
                {lightboxAsset.folder}
              </Badge>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              <span className="text-white/50 text-xs">
                {lightboxIndex + 1} / {filtered.length}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-white hover:bg-white/10"
                title="Salin URL"
                onClick={() => copyUrl(lightboxAsset)}
              >
                {copiedId === lightboxAsset.id
                  ? <CheckCheck className="w-4 h-4 text-emerald-400" />
                  : <Copy className="w-4 h-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-white hover:bg-white/10"
                title="Buka di tab baru"
                onClick={() => window.open(lightboxAsset.url, "_blank")}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
              <button
                className="h-8 w-8 flex items-center justify-center rounded-md text-white hover:bg-white/10 transition-colors"
                onClick={() => setLightboxId(null)}
                title="Tutup (Esc)"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Gambar utama + tombol navigasi */}
          <div className="flex-1 flex items-center justify-center relative min-h-0 px-16">
            {/* Prev */}
            <button
              className={`absolute left-3 z-10 h-12 w-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors ${lightboxIndex === 0 ? "opacity-30 pointer-events-none" : ""}`}
              onClick={(e) => { e.stopPropagation(); lightboxPrev(); }}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            <img
              key={lightboxAsset.id}
              src={lightboxAsset.url}
              alt={lightboxAsset.originalName}
              className="max-h-full max-w-full object-contain rounded-lg select-none"
              onClick={(e) => e.stopPropagation()}
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='1.5'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/%3E%3C/svg%3E";
              }}
            />

            {/* Next */}
            <button
              className={`absolute right-3 z-10 h-12 w-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors ${lightboxIndex >= filtered.length - 1 ? "opacity-30 pointer-events-none" : ""}`}
              onClick={(e) => { e.stopPropagation(); lightboxNext(); }}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          {/* Bottom info bar */}
          <div
            className="shrink-0 px-6 py-3 flex items-center gap-6 text-white/60 text-xs border-t border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              {formatBytes(lightboxAsset.sizeBytes)}
            </span>
            <span className="flex items-center gap-1.5">
              <FolderIcon className={`w-3.5 h-3.5 ${folderColor(lightboxAsset.folder)}`} />
              {lightboxAsset.folder}
            </span>
            <span>{fmtDate(lightboxAsset.createdAt)}</span>
            {lightboxAsset.uploadedBy && (
              <span>Oleh: {lightboxAsset.uploadedBy}</span>
            )}
            <span className="ml-auto text-white/30 text-[10px]">
              ← → navigasi &nbsp;·&nbsp; Esc tutup
            </span>
          </div>
        </div>
      )}

      {/* ── Dialog Crop & Resize Gambar ── */}
      <Dialog open={cropOpen} onOpenChange={(open) => { if (!open) handleCloseCropDialog(); }}>
        <DialogContent className="max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scissors className="w-5 h-5 text-primary" />
              Potong &amp; Sesuaikan Gambar
              {cropQueueTotal > 1 && (
                <Badge variant="secondary" className="ml-auto text-xs font-semibold">
                  {cropQueueDone + 1} / {cropQueueTotal}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Pilihan rasio */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-semibold shrink-0">Rasio:</span>
            {[
              { label: "Bebas", value: undefined },
              { label: "1:1 (Kotak)", value: 1 },
              { label: "4:3", value: 4 / 3 },
              { label: "16:9 (Lebar)", value: 16 / 9 },
              { label: "3:4 (Potret)", value: 3 / 4 },
            ].map((opt) => (
              <button
                key={opt.label}
                onClick={() => {
                  setCropAspect(opt.value);
                  if (imgRef.current) {
                    const { naturalWidth: w, naturalHeight: h } = imgRef.current;
                    const aspect = opt.value ?? w / h;
                    setCrop(centerCrop(makeAspectCrop({ unit: "%", width: 90 }, aspect, w, h), w, h));
                  }
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                  cropAspect === opt.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                setCrop(undefined);
                setCompletedCrop(undefined);
                if (imgRef.current) {
                  const { naturalWidth: w, naturalHeight: h } = imgRef.current;
                  const aspect = cropAspect ?? w / h;
                  setCrop(centerCrop(makeAspectCrop({ unit: "%", width: 90 }, aspect, w, h), w, h));
                }
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Atur Ulang
            </button>
          </div>

          {/* Area crop */}
          <div className="flex items-center justify-center bg-muted/40 rounded-xl overflow-hidden min-h-[200px] max-h-[400px]">
            {cropSrc ? (
              <ReactCrop
                crop={crop}
                onChange={(c) => setCrop(c)}
                onComplete={(c) => setCompletedCrop(c)}
                aspect={cropAspect}
                className="max-h-[400px]"
              >
                <img
                  ref={imgRef}
                  src={cropSrc}
                  onLoad={onImageLoad}
                  alt="Preview gambar untuk dipotong"
                  style={{ maxHeight: "400px", width: "auto", display: "block" }}
                  crossOrigin="anonymous"
                />
              </ReactCrop>
            ) : (
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
            <ScanLine className="w-3.5 h-3.5 shrink-0" />
            Seret sudut seleksi untuk memotong. Jika tidak ingin memotong, klik <strong>"Unggah Asli"</strong>.
          </p>

          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            {cropQueueTotal > 1 && cropQueue.length > 0 && (
              <p className="text-xs text-muted-foreground self-center mr-auto">
                Tersisa {cropQueue.length} gambar lagi
              </p>
            )}
            <Button variant="outline" onClick={handleSkipCrop} disabled={uploading} className="gap-1.5">
              <Upload className="w-4 h-4" />
              Unggah Asli
            </Button>
            <Button onClick={handleCropUpload} disabled={uploading} className="gap-1.5">
              {uploading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Scissors className="w-4 h-4" />
              }
              {completedCrop?.width ? "Potong &amp; Unggah" : "Unggah Tanpa Potong"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Konfirmasi Hapus Folder ── */}
      <AlertDialog open={!!deleteFolderTarget} onOpenChange={(open) => !open && setDeleteFolderTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <FolderX className="w-5 h-5 text-destructive" />
              Hapus folder ini?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Folder <strong>"{deleteFolderTarget?.folder}"</strong> akan dihapus.{" "}
              {deleteFolderTarget && deleteFolderTarget.count > 0 ? (
                <>
                  Sebanyak <strong>{deleteFolderTarget.count} gambar</strong> di dalamnya akan
                  dipindahkan otomatis ke folder <strong>"Umum"</strong>.
                </>
              ) : (
                "Folder ini kosong dan akan langsung dihapus dari daftar."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFolderTarget && deleteFolderMutation.mutate(deleteFolderTarget.folder)}
            >
              {deleteFolderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Ya, Hapus Folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Konfirmasi Hapus Gambar (single) ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus gambar ini?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.originalName}</strong> akan dihapus dari daftar.
              File yang sudah digunakan di tempat lain mungkin tidak bisa ditampilkan lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Konfirmasi Hapus Bulk ── */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => !open && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus {selectedCount} gambar sekaligus?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua <strong>{selectedCount} gambar</strong> yang dipilih akan dihapus dari daftar.
              File yang sudah digunakan di tempat lain mungkin tidak bisa ditampilkan lagi.
              Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
            >
              {bulkDeleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Ya, Hapus {selectedCount} Gambar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

// ── Komponen pemilih folder (reusable) ──
function FolderPicker({
  folders,
  selected,
  onSelect,
  currentFolder,
}: {
  folders: string[];
  selected: string;
  onSelect: (f: string) => void;
  currentFolder?: string;
}) {
  const [customInput, setCustomInput] = useState("");
  const isCustom = selected !== "" && !folders.includes(selected);

  return (
    <div className="space-y-1.5">
      {folders.map((name) => (
        <button
          key={name}
          onClick={() => { onSelect(name); setCustomInput(""); }}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors border ${
            selected === name
              ? "border-primary bg-primary/5 text-primary font-medium"
              : "border-border hover:bg-muted/50"
          }`}
        >
          <FolderIcon className={`w-4 h-4 shrink-0 ${folderColor(name)}`} />
          {name}
          {name === currentFolder && (
            <span className="ml-auto text-xs text-muted-foreground">(saat ini)</span>
          )}
        </button>
      ))}
      <div className="pt-1">
        <p className="text-xs text-muted-foreground mb-1">Atau ketik nama folder baru:</p>
        <Input
          placeholder="Nama folder baru..."
          value={isCustom ? selected : customInput}
          onChange={(e) => {
            setCustomInput(e.target.value);
            onSelect(e.target.value);
          }}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}
