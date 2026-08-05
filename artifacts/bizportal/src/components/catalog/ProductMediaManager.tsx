import { useState, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ImagePlus, Video, Star, Trash2, Link2, Loader2, X, Plus, Play, Sparkles,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface ProductMedia {
  id: number;
  vendorCatalogItemId: number | null;
  mediaType: string;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  externalUrl: string | null;
  title: string | null;
  description: string | null;
  sortOrder: number;
  isPrimary: boolean;
  isActive: boolean;
}

interface ProductMediaManagerProps {
  open: boolean;
  onClose: () => void;
  vendorCatalogItemId: number;
  vendorId: number;
  itemName: string;
  itemCategory?: string | null;
  itemCommodity?: string | null;
  itemDescription?: string | null;
}

function getYoutubeThumbnail(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/);
  if (m) return `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
  return null;
}

function MediaThumbnail({ media }: { media: ProductMedia }) {
  if (media.mediaType === "image" && media.fileUrl) {
    return (
      <img
        src={media.fileUrl}
        alt={media.title ?? "foto produk"}
        className="w-full h-full object-cover"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  if (media.mediaType === "video" && media.fileUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 gap-1">
        <Play className="h-6 w-6 text-slate-400" />
        <span className="text-[10px] text-slate-400">Video</span>
      </div>
    );
  }
  if (media.mediaType === "video_link" && media.externalUrl) {
    const thumb = getYoutubeThumbnail(media.externalUrl);
    if (thumb) {
      return (
        <div className="relative w-full h-full">
          <img src={thumb} alt="youtube thumbnail" className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <Play className="h-6 w-6 text-white" />
          </div>
        </div>
      );
    }
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 gap-1">
        <Link2 className="h-6 w-6 text-slate-400" />
        <span className="text-[10px] text-slate-400">Video Link</span>
      </div>
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-slate-100">
      <ImagePlus className="h-6 w-6 text-slate-300" />
    </div>
  );
}

export function ProductMediaManager({
  open, onClose, vendorCatalogItemId, vendorId, itemName,
  itemCategory, itemCommodity, itemDescription,
}: ProductMediaManagerProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [showAiForm, setShowAiForm] = useState(false);
  const [aiProductName, setAiProductName] = useState("");
  const [aiCategory, setAiCategory] = useState("");
  const [aiCommodity, setAiCommodity] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  function openAiForm() {
    setAiProductName(itemName ?? "");
    setAiCategory(itemCategory ?? "");
    setAiCommodity(itemCommodity ?? "");
    setAiDescription(itemDescription ?? "");
    setShowAiForm(true);
    setShowLinkForm(false);
  }

  const qKey = ["product-media", vendorCatalogItemId];

  const { data, isLoading } = useQuery<{ media: ProductMedia[] }>({
    queryKey: qKey,
    queryFn: async () => {
      const res = await fetch(`/api/product-media/admin/item/${vendorCatalogItemId}`);
      if (!res.ok) throw new Error("Gagal memuat media");
      return res.json();
    },
    enabled: open && !!vendorCatalogItemId,
  });

  const media = data?.media ?? [];

  const setPrimaryMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/product-media/${id}/set-primary`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Gagal set primary");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: qKey }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/product-media/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Gagal hapus");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: qKey }); toast({ title: "Media dihapus" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/product-media/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorCatalogItemId,
          vendorId,
          externalUrl: linkUrl.trim(),
          title: linkTitle.trim() || null,
          isPrimary: media.length === 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Gagal menambahkan link");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      setLinkUrl("");
      setLinkTitle("");
      setShowLinkForm(false);
      toast({ title: "Link video ditambahkan" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function handleGenerateAi() {
    if (!aiProductName.trim()) {
      toast({ title: "Nama produk wajib diisi", variant: "destructive" });
      return;
    }
    setAiGenerating(true);
    try {
      const res = await fetch("/api/product-media/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: aiProductName.trim(),
          category: aiCategory.trim() || null,
          commodity: aiCommodity.trim() || null,
          description: aiDescription.trim() || null,
          vendorCatalogItemId,
          vendorId,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Gagal generate gambar");
      }
      qc.invalidateQueries({ queryKey: qKey });
      setShowAiForm(false);
      toast({ title: "Gambar AI berhasil dibuat", description: "Gambar marketplace telah ditambahkan ke media." });
    } catch (err: any) {
      toast({ title: "Gagal generate", description: err?.message ?? "Terjadi kesalahan", variant: "destructive" });
    } finally {
      setAiGenerating(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    setUploading(true);
    let successCount = 0;
    let errorMsg = "";

    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("vendorCatalogItemId", String(vendorCatalogItemId));
        fd.append("vendorId", String(vendorId));
        fd.append("isPrimary", media.length === 0 && successCount === 0 ? "true" : "false");

        const res = await fetch("/api/product-media/upload", { method: "POST", body: fd });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          errorMsg = json.error ?? `Gagal upload ${file.name}`;
        } else {
          successCount++;
        }
      } catch (err: any) {
        errorMsg = err?.message ?? "Upload gagal";
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    qc.invalidateQueries({ queryKey: qKey });

    if (successCount > 0) {
      toast({ title: `${successCount} file berhasil diunggah` });
    }
    if (errorMsg) {
      toast({ title: "Error upload", description: errorMsg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ImagePlus className="h-4 w-4 text-sky-500" />
            Kelola Media — <span className="text-sky-700 max-w-[280px] truncate">{itemName}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Upload buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-1.5"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            Upload Foto / Video
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLinkForm((v) => !v)}
            className="gap-1.5"
          >
            <Link2 className="h-3.5 w-3.5" />
            Tambah Link Video
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => showAiForm ? setShowAiForm(false) : openAiForm()}
            className="gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 hover:border-violet-300"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generate Gambar AI
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* AI form */}
        {showAiForm && (
          <div className="border border-violet-200 rounded-lg p-3 bg-violet-50 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium flex items-center gap-1.5 text-violet-800">
                <Sparkles className="h-3.5 w-3.5 text-violet-500" /> Generate Gambar Marketplace dengan AI
              </p>
              <button onClick={() => setShowAiForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-violet-600">
              AI akan membuat foto produk profesional B2B berdasarkan data di bawah. Proses sekitar 15–30 detik.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Nama Produk <span className="text-red-500">*</span></Label>
                <Input
                  value={aiProductName}
                  onChange={(e) => setAiProductName(e.target.value)}
                  placeholder="Contoh: Palm Oil CPO Grade A"
                  className="h-8 text-sm"
                  disabled={aiGenerating}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kategori</Label>
                <Input
                  value={aiCategory}
                  onChange={(e) => setAiCategory(e.target.value)}
                  placeholder="Contoh: Agrikultur"
                  className="h-8 text-sm"
                  disabled={aiGenerating}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Komoditas</Label>
                <Input
                  value={aiCommodity}
                  onChange={(e) => setAiCommodity(e.target.value)}
                  placeholder="Contoh: Minyak Kelapa Sawit"
                  className="h-8 text-sm"
                  disabled={aiGenerating}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Deskripsi</Label>
                <Textarea
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  placeholder="Deskripsi singkat produk untuk membantu AI membuat gambar yang akurat..."
                  className="text-sm resize-none"
                  rows={2}
                  disabled={aiGenerating}
                />
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleGenerateAi}
              disabled={!aiProductName.trim() || aiGenerating}
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
            >
              {aiGenerating
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Membuat gambar…</>
                : <><Sparkles className="h-3.5 w-3.5" /> Generate Sekarang</>
              }
            </Button>
          </div>
        )}

        {/* Link form */}
        {showLinkForm && (
          <div className="border rounded-lg p-3 bg-slate-50 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5 text-sky-500" /> Tambah Link Video (YouTube / Vimeo)
              </p>
              <button onClick={() => setShowLinkForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">URL Video <span className="text-red-500">*</span></Label>
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Judul (opsional)</Label>
              <Input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="Contoh: Demo produk..."
                className="h-8 text-sm"
              />
            </div>
            <Button
              size="sm"
              onClick={() => addLinkMutation.mutate()}
              disabled={!linkUrl.trim() || addLinkMutation.isPending}
              className="gap-1.5"
            >
              {addLinkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Tambahkan
            </Button>
          </div>
        )}

        {/* Media grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-7 w-7 animate-spin text-sky-500" />
          </div>
        ) : media.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
            <ImagePlus className="h-10 w-10 text-slate-200" />
            <p className="text-sm">Belum ada media. Upload foto, tambah link video, atau generate dengan AI.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {media.map((m) => (
              <div key={m.id} className={`relative group rounded-xl overflow-hidden border-2 transition-all ${m.isPrimary ? "border-sky-400 ring-2 ring-sky-200" : "border-transparent hover:border-slate-200"}`}>
                <div className="aspect-square bg-slate-100 relative overflow-hidden">
                  <MediaThumbnail media={m} />

                  {/* Type badge */}
                  <div className="absolute top-1 left-1 flex gap-1">
                    <Badge className={`text-[9px] px-1 py-0 ${m.mediaType === "image" ? "bg-emerald-600" : "bg-purple-600"}`}>
                      {m.mediaType === "image" ? "Foto" : m.mediaType === "video" ? "Video" : "Link"}
                    </Badge>
                    {m.title?.startsWith("AI —") && (
                      <Badge className="text-[9px] px-1 py-0 bg-violet-600">AI</Badge>
                    )}
                  </div>

                  {/* Primary badge */}
                  {m.isPrimary && (
                    <div className="absolute top-1 right-1">
                      <div className="bg-yellow-400 rounded-full p-0.5">
                        <Star className="h-3 w-3 text-yellow-900 fill-yellow-900" />
                      </div>
                    </div>
                  )}

                  {/* Hover actions */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
                    {!m.isPrimary && (
                      <button
                        title="Set sebagai foto utama"
                        className="bg-yellow-400 hover:bg-yellow-300 text-yellow-900 rounded-full p-1.5 transition-colors"
                        onClick={() => setPrimaryMutation.mutate(m.id)}
                        disabled={setPrimaryMutation.isPending}
                      >
                        <Star className="h-3.5 w-3.5 fill-yellow-900" />
                      </button>
                    )}
                    <button
                      title="Hapus media"
                      className="bg-red-500 hover:bg-red-400 text-white rounded-full p-1.5 transition-colors"
                      onClick={() => {
                        if (confirm("Hapus media ini?")) deleteMutation.mutate(m.id);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Title */}
                {m.title && (
                  <div className="px-1.5 py-1 bg-white">
                    <p className="text-[10px] text-slate-600 truncate">{m.title}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {media.length > 0 && (
          <p className="text-[11px] text-slate-400">
            Hover media untuk aksi. <Star className="h-3 w-3 inline text-yellow-400 fill-yellow-400" /> = foto utama yang tampil di marketplace.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
