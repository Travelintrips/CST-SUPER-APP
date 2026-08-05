import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { QueryState } from "@/components/ui/query-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  GitCompare,
  X,
  ExternalLink,
  Package,
  FileText,
  ClipboardList,
  Image,
  Video,
  Star,
  StarOff,
  Play,
  TrendingUp,
  DollarSign,
  Lock,
  RotateCcw,
  Send,
  ArrowLeft,
  Upload,
} from "lucide-react";
import { Link } from "wouter";
import { BackButton } from "@/components/ui/back-button";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MediaAsset = {
  url: string;
  name?: string;
  type?: "image" | "video" | "pdf" | "document" | "certificate" | "brochure" | string;
  mimeType?: string;
  isCover?: boolean;    // legacy alias for isPrimary
  sortOrder?: number;
  size?: number;        // legacy alias for sizeBytes
  width?: number;
  height?: number;
  // New canonical fields
  id?: string;
  title?: string;
  description?: string;
  isPrimary?: boolean;
  visibility?: "public" | "private" | "internal";
  objectPath?: string;
  sizeBytes?: number;
  isApproved?: boolean;
  createdAt?: string;
  documentKey?: string; // links this asset to a standard document slot (documents[].key)
};

export type CatalogDocumentType = {
  key: string;
  label: string;
  required?: boolean;
  url?: string;
  reference?: string;
  fileUrl?: string;
};

type CatalogRow = {
  id: number;
  vendorId: number;
  vendorName: string;
  templateKind: string | null;
  categoryKey: string | null;
  serviceType: string | null;
  name: string;
  kategori: string | null;
  subcategory: string | null;
  specSummary: string | null;
  priceBase: number;
  markupPct: number;
  priceSell: number | null;
  currency: string;
  unit: string | null;
  moq: number | null;
  stockStatus: string | null;
  stockQty: number | null;
  leadTime: string | null;
  location: string | null;
  origin: string | null;
  status: string;
  isPublished: boolean;
  isActive: boolean;
  publishedAt: string | null;
  sourceSubmissionId: number | null;
  mediaAssets: MediaAsset[];
  documents: CatalogDocumentType[] | null;
  createdAt: string;
  updatedAt: string;
};

type CatalogDetail = CatalogRow & {
  description: string | null;
  templateSnapshot: Record<string, unknown> | null;
  specValues: Record<string, unknown> | null;
  vendorServiceType: string | null;
  validityDate: string | null;
  isCommodityTag: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string; bg: string }> = {
  draft:          { label: "Draft",           variant: "outline",     color: "text-muted-foreground", bg: "bg-gray-100" },
  pending_review: { label: "Pending Review",  variant: "secondary",   color: "text-yellow-700",       bg: "bg-yellow-100" },
  published:      { label: "Published",       variant: "default",     color: "text-green-700",        bg: "bg-green-100" },
  archived:       { label: "Archived",        variant: "destructive", color: "text-red-600",          bg: "bg-red-100" },
};

const STOCK_META: Record<string, { label: string; color: string }> = {
  available:    { label: "Available",    color: "text-green-600" },
  limited:      { label: "Limited",      color: "text-yellow-600" },
  out_of_stock: { label: "Out of Stock", color: "text-red-500" },
};

function fmtIDR(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, variant: "outline" as const, color: "", bg: "" };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function StockBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const m = STOCK_META[status] ?? { label: status, color: "" };
  return <span className={`text-xs font-medium ${m.color}`}>{m.label}</span>;
}

function isImage(a: MediaAsset) {
  if (a.type === "image") return true;
  if (a.mimeType?.startsWith("image/")) return true;
  if (!a.type && a.url) {
    const ext = a.url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    return ["jpg", "jpeg", "png", "webp", "gif", "svg", "avif"].includes(ext);
  }
  return false;
}

function isVideo(a: MediaAsset) {
  if (a.type === "video") return true;
  if (a.mimeType?.startsWith("video/")) return true;
  if (!a.type && a.url) {
    const ext = a.url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    return ["mp4", "webm", "mov", "avi", "mkv"].includes(ext);
  }
  return false;
}

function getCoverAsset(assets: MediaAsset[]): MediaAsset | null {
  if (!assets || assets.length === 0) return null;
  return assets.find(a => a.isCover) ?? assets[0];
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function fetchCatalogAll(params: Record<string, string>) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v && v !== "all")
  ).toString();
  const res = await fetch(`/api/trading/suppliers/catalog/all${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<CatalogRow[]>;
}

async function fetchDetail(id: number) {
  const res = await fetch(`/api/trading/suppliers/catalog/${id}/detail`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<CatalogDetail>;
}

async function patchStatus(id: number, status: string) {
  const res = await fetch(`/api/trading/suppliers/catalog/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function patchPricing(id: number, priceSell: number | null) {
  const res = await fetch(`/api/trading/suppliers/catalog/${id}/pricing`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ priceSell }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function patchMedia(id: number, mediaAssets: MediaAsset[]) {
  const res = await fetch(`/api/trading/suppliers/catalog/${id}/media`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ mediaAssets }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function uploadCatalogMedia(
  id: number,
  file: File,
): Promise<{ url: string; objectPath: string; mimeType: string; sizeBytes: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/trading/suppliers/catalog/${id}/media/upload`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function isDocument(a: MediaAsset) {
  const DOC = new Set(["pdf","document","certificate","brochure"]);
  if (DOC.has(a.type ?? "")) return true;
  if (a.mimeType === "application/pdf") return true;
  const ext = (a.url ?? "").split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  return ext === "pdf";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TemplateSnapshotView({ snapshot }: { snapshot: Record<string, unknown> | null }) {
  if (!snapshot) return <p className="text-muted-foreground text-sm">Tidak ada template snapshot.</p>;
  const fields = (snapshot as { fields?: Array<{ key: string; label: string; type?: string }> }).fields ?? [];
  if (fields.length === 0) {
    return (
      <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-48">
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    );
  }
  return (
    <div className="space-y-1">
      {fields.map((f) => (
        <div key={f.key} className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground w-32 shrink-0">{f.label}</span>
          <Badge variant="outline" className="text-xs">{f.type ?? "text"}</Badge>
        </div>
      ))}
    </div>
  );
}

function SpecValuesView({ values }: { values: Record<string, unknown> | null }) {
  if (!values || Object.keys(values).length === 0)
    return <p className="text-muted-foreground text-sm">Tidak ada spec values.</p>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(values).map(([k, v]) => (
        <div key={k} className="bg-muted rounded p-2">
          <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, " ")}</p>
          <p className="text-sm font-medium">{String(v ?? "—")}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Pricing Dialog ───────────────────────────────────────────────────────────

function PricingDialog({
  item,
  open,
  onClose,
  onSaved,
}: {
  item: CatalogRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [priceSell, setPriceSell] = useState("");

  useMemo(() => {
    if (item) setPriceSell(item.priceSell != null ? String(item.priceSell) : "");
  }, [item]);

  const priceSellNum  = parseFloat(priceSell) || 0;
  const priceBaseNum  = item?.priceBase ?? 0;
  const marginAmount  = priceSellNum - priceBaseNum;
  const marginPct     = priceSellNum > 0 ? (marginAmount / priceSellNum) * 100 : 0;

  const mutation = useMutation({
    mutationFn: () => patchPricing(item!.id, priceSell !== "" ? parseFloat(priceSell) : null),
    onSuccess: () => {
      toast({ title: "✅ Harga jual diperbarui" });
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Pricing — {item?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* priceBase — read-only, admin-only */}
          <div className="rounded-md border border-orange-200 bg-orange-50 p-3 space-y-1">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-xs font-semibold text-orange-600 uppercase">Admin Only — Tidak ditampilkan ke customer</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm text-muted-foreground">Harga Dasar (dari vendor)</span>
              <span className="text-lg font-bold text-orange-600">{fmtIDR(priceBaseNum)}</span>
            </div>
          </div>

          {/* priceSell — editable */}
          <div className="space-y-1">
            <Label className="flex items-center gap-1 text-green-700">
              <Globe className="w-3.5 h-3.5" /> Harga Jual (ditampilkan ke customer)
            </Label>
            <Input
              type="number"
              step="1000"
              placeholder="0"
              value={priceSell}
              onChange={e => setPriceSell(e.target.value)}
              className="text-lg font-semibold"
            />
          </div>

          {/* Margin — computed */}
          {priceSell !== "" && priceSellNum > 0 && (
            <div className="rounded-md bg-muted p-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="w-4 h-4" /> Margin
              </div>
              <div className="text-right">
                <p className={`font-semibold ${marginAmount >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {fmtIDR(marginAmount)}
                </p>
                <p className={`text-xs ${marginPct >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {marginPct.toFixed(1)}% margin
                </p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Simpan Harga Jual
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Media Dialog ─────────────────────────────────────────────────────────────

function MediaDialog({
  item,
  open,
  onClose,
  onSaved,
}: {
  item: CatalogRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef   = useRef<HTMLInputElement>(null);
  const stdDocInputRef = useRef<HTMLInputElement>(null);
  const [activeStdDoc, setActiveStdDoc] = useState<{ key: string; label: string } | null>(null);

  useEffect(() => {
    if (item && open) setAssets([...(item.mediaAssets ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
  }, [item?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCover = useCallback((idx: number) => {
    setAssets(prev => prev.map((a, i) => ({ ...a, isCover: i === idx, isPrimary: i === idx })));
  }, []);

  const moveUp = useCallback((idx: number) => {
    if (idx === 0) return;
    setAssets(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((a, i) => ({ ...a, sortOrder: i }));
    });
  }, []);

  const moveDown = useCallback((idx: number) => {
    setAssets(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((a, i) => ({ ...a, sortOrder: i }));
    });
  }, []);

  const removeAsset = useCallback((idx: number) => {
    setAssets(prev => {
      const next = prev.filter((_, i) => i !== idx).map((a, i) => ({ ...a, sortOrder: i }));
      if (next.length > 0 && !next.some(a => a.isCover)) { next[0].isCover = true; next[0].isPrimary = true; }
      return next;
    });
  }, []);

  const updateTitle = useCallback((idx: number, title: string) => {
    setAssets(prev => prev.map((a, i) => i === idx ? { ...a, title, name: title } : a));
  }, []);

  const updateVisibility = useCallback((idx: number, visibility: MediaAsset["visibility"]) => {
    setAssets(prev => prev.map((a, i) => i === idx ? { ...a, visibility } : a));
  }, []);

  async function handleUpload(
    file: File,
    forceVisibility?: MediaAsset["visibility"],
    documentKey?: string,
    documentLabel?: string,
  ) {
    if (!item) return;
    setUploading(true);
    try {
      const { url, objectPath, mimeType, sizeBytes } = await uploadCatalogMedia(item.id, file);
      const isPdf   = mimeType === "application/pdf";
      const isVidFl = mimeType.startsWith("video/");
      const type = isPdf ? "pdf" : isVidFl ? "video" : "image";
      const label = documentLabel ?? file.name.replace(/\.[^.]+$/, "");
      const newAsset: MediaAsset = {
        id:         crypto.randomUUID(),
        url,
        type,
        mimeType,
        sizeBytes,
        size:       sizeBytes,
        objectPath,
        title:      label,
        name:       label,
        isCover:    assets.length === 0,
        isPrimary:  assets.length === 0,
        sortOrder:  assets.length,
        visibility: forceVisibility ?? (isPdf ? "private" : undefined),
        ...(documentKey ? { documentKey } : {}),
      };
      // Standard-slot uploads REPLACE any existing file for the same documentKey.
      setAssets(prev => documentKey
        ? [...prev.filter(a => a.documentKey !== documentKey), newAsset]
        : [...prev, newAsset]);
      toast({ title: documentKey ? "Dokumen berhasil diunggah" : "File berhasil diunggah" });
    } catch (e: any) {
      toast({ title: "Upload gagal", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function removeByDocumentKey(documentKey: string) {
    setAssets(prev => prev.filter(a => a.documentKey !== documentKey));
  }

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    try {
      await patchMedia(item.id, assets);
      toast({ title: "✅ Media assets diperbarui" });
      onSaved();
      onClose();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const standardDocKeys = new Set((item?.documents ?? []).map(d => d.key));
  const mediaAssets = assets.filter(a => !isDocument(a));
  // "Dokumen Tambahan": doc assets NOT linked to a standard document slot.
  const docAssets   = assets.filter(a => isDocument(a) && !(a.documentKey && standardDocKeys.has(a.documentKey)));

  return (
    <>
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Image className="w-4 h-4" /> Media — {item?.name}
            </DialogTitle>
          </DialogHeader>

          {/* Upload buttons */}
          <div className="flex flex-wrap gap-2 border-b pb-3">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { void handleUpload(f); e.target.value = ""; } }}
            />
            <input
              ref={docInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { void handleUpload(f, "private"); e.target.value = ""; } }}
            />
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => photoInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload Foto/Video
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => docInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Upload Dokumen (PDF)
            </Button>
            <span className="text-xs text-muted-foreground self-center">Maks 50 MB/file</span>
            <input
              ref={stdDocInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f && activeStdDoc) void handleUpload(f, "private", activeStdDoc.key, activeStdDoc.label);
                e.target.value = "";
                setActiveStdDoc(null);
              }}
            />
          </div>

          {/* Dokumen Standar — one slot per documents[].key (coo/phyto/invoice/packing_list, dst) */}
          {Array.isArray(item?.documents) && item.documents.length > 0 && (
            <div className="space-y-2 pt-2 pb-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Dokumen Standar ({item.documents.length})
              </p>
              {item.documents.map((doc) => {
                const linked = assets.find(a => a.documentKey === doc.key);
                return (
                  <div
                    key={doc.key}
                    className={`flex items-center gap-3 rounded-lg border p-2.5 ${linked ? "bg-emerald-50/50 border-emerald-200" : "bg-muted/30"}`}
                  >
                    <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${linked ? "bg-emerald-100" : "bg-muted"}`}>
                      <FileText className={`w-5 h-5 ${linked ? "text-emerald-600" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-xs font-medium truncate">{doc.label}</p>
                      {linked ? (
                        <div className="flex items-center gap-2">
                          <select
                            value={linked.visibility ?? "private"}
                            onChange={e => updateVisibility(assets.indexOf(linked), e.target.value as MediaAsset["visibility"])}
                            className="h-6 text-xs rounded border border-input bg-background px-2 focus:outline-none"
                          >
                            <option value="public">🌐 Publik</option>
                            <option value="private">🔒 Privat</option>
                            <option value="internal">🏢 Internal</option>
                          </select>
                          <span className="text-[11px] text-muted-foreground">
                            {linked.visibility === "public" ? "Tampil di publik" : "Tidak tampil di publik"}
                          </span>
                        </div>
                      ) : (
                        <p className="text-[11px] text-amber-600 font-medium">Belum diunggah</p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {linked && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setPreviewAsset(linked)} title="Preview">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <a href={linked.url} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="ghost" title="Download">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </a>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1"
                        disabled={uploading}
                        onClick={() => { setActiveStdDoc({ key: doc.key, label: doc.label }); stdDocInputRef.current?.click(); }}
                      >
                        <Upload className="w-3 h-3" /> {linked ? "Replace" : "Upload"}
                      </Button>
                      {linked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                          title="Hapus"
                          onClick={() => removeByDocumentKey(doc.key)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Photo / Video list */}
          {mediaAssets.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Foto &amp; Video ({mediaAssets.length})
              </p>
              {mediaAssets.map((a) => {
                const idx = assets.indexOf(a);
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${a.isCover ? "border-blue-400 bg-blue-50" : "bg-card"}`}
                  >
                    {/* Thumbnail */}
                    <div
                      className="w-16 h-16 rounded overflow-hidden bg-muted flex-shrink-0 cursor-pointer relative"
                      onClick={() => setPreviewAsset(a)}
                    >
                      {isImage(a) ? (
                        <img src={a.url} alt={a.title ?? a.name ?? "media"} className="w-full h-full object-cover" />
                      ) : isVideo(a) ? (
                        <div className="w-full h-full flex items-center justify-center bg-gray-900">
                          <Play className="w-6 h-6 text-white" />
                        </div>
                      ) : null}
                      {a.isCover && (
                        <div className="absolute top-0.5 right-0.5 bg-blue-500 rounded-full p-0.5">
                          <Star className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </div>

                    {/* Title + meta */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <Input
                        value={a.title ?? a.name ?? ""}
                        onChange={e => updateTitle(idx, e.target.value)}
                        placeholder={`Judul ${idx + 1}`}
                        className="h-7 text-xs"
                      />
                      <p className="text-xs text-muted-foreground capitalize">
                        {isImage(a) ? "Image" : isVideo(a) ? "Video" : (a.type ?? "File")}
                        {a.isCover && <span className="ml-2 text-blue-600 font-semibold">• Cover</span>}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" onClick={() => setPreviewAsset(a)}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Preview</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant={a.isCover ? "default" : "outline"}
                              onClick={() => setCover(idx)}
                              className={a.isCover ? "bg-blue-500 hover:bg-blue-600" : ""}
                            >
                              {a.isCover ? <Star className="w-3.5 h-3.5" /> : <StarOff className="w-3.5 h-3.5" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{a.isCover ? "Cover aktif" : "Set sebagai cover"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" onClick={() => moveUp(idx)} disabled={idx === 0}>
                              <ChevronUp className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Pindah ke atas</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" onClick={() => moveDown(idx)} disabled={idx === assets.length - 1}>
                              <ChevronDown className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Pindah ke bawah</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => removeAsset(idx)}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Hapus dari list</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Document list */}
          {docAssets.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Dokumen ({docAssets.length})
              </p>
              {docAssets.map((a) => {
                const idx = assets.indexOf(a);
                return (
                  <div key={idx} className="flex items-center gap-3 rounded-lg border bg-amber-50/40 p-2.5">
                    <div className="w-12 h-12 rounded bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-6 h-6 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <Input
                        value={a.title ?? a.name ?? ""}
                        onChange={e => updateTitle(idx, e.target.value)}
                        placeholder={`Nama dokumen ${idx + 1}`}
                        className="h-7 text-xs"
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={a.visibility ?? "private"}
                          onChange={e => updateVisibility(idx, e.target.value as MediaAsset["visibility"])}
                          className="h-6 text-xs rounded border border-input bg-background px-2 focus:outline-none"
                        >
                          <option value="public">🌐 Publik</option>
                          <option value="private">🔒 Privat</option>
                          <option value="internal">🏢 Internal</option>
                        </select>
                        <span className="text-[11px] text-muted-foreground">
                          {a.visibility === "public" ? "Tampil di halaman produk" : "Tidak tampil di publik"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a href={a.url} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="ghost">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => removeAsset(idx)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {assets.length === 0 && !uploading && (
            <div className="text-center py-12 text-muted-foreground">
              <Image className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Belum ada media assets</p>
              <p className="text-xs mt-1">Upload foto/video atau dokumen menggunakan tombol di atas</p>
            </div>
          )}

          {uploading && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Mengupload file…
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Batal</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Simpan Urutan & Cover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Lightbox */}
      {previewAsset && (
        <Dialog open={!!previewAsset} onOpenChange={v => !v && setPreviewAsset(null)}>
          <DialogContent className="max-w-4xl p-2">
            <DialogHeader className="px-4 pt-2">
              <DialogTitle className="text-sm">{previewAsset.title ?? previewAsset.name ?? "Preview"}</DialogTitle>
            </DialogHeader>
            <div className="flex justify-center items-center min-h-64 bg-black rounded-lg overflow-hidden">
              {isImage(previewAsset) ? (
                <img
                  src={previewAsset.url}
                  alt={previewAsset.title ?? previewAsset.name ?? "preview"}
                  className="max-w-full max-h-[70vh] object-contain"
                />
              ) : isVideo(previewAsset) ? (
                <video
                  src={previewAsset.url}
                  controls
                  autoPlay
                  className="max-w-full max-h-[70vh]"
                />
              ) : (
                <div className="text-center text-white p-12">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">Preview tidak tersedia untuk tipe file ini</p>
                  <a href={previewAsset.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-sm mt-2 block">
                    Buka di tab baru <ExternalLink className="w-3 h-3 inline ml-1" />
                  </a>
                </div>
              )}
            </div>
            <div className="flex justify-between items-center px-4 pb-2">
              <a href={previewAsset.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> Buka URL asli
              </a>
              <Button size="sm" variant="outline" onClick={() => setPreviewAsset(null)}>Tutup</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─── Detail Dialog ────────────────────────────────────────────────────────────

function DetailDialog({
  itemId,
  open,
  onClose,
  onStatusChange,
}: {
  itemId: number | null;
  open: boolean;
  onClose: () => void;
  onStatusChange: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusLoading, setStatusLoading] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["catalog-detail", itemId],
    queryFn: () => fetchDetail(itemId!),
    enabled: open && itemId != null,
  });

  async function changeStatus(newStatus: string) {
    if (!data) return;
    setStatusLoading(newStatus);
    try {
      await patchStatus(data.id, newStatus);
      const m = STATUS_META[newStatus];
      toast({ title: `Status diubah ke ${m?.label ?? newStatus}` });
      qc.invalidateQueries({ queryKey: ["catalog-detail", itemId] });
      onStatusChange();
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setStatusLoading(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.name ?? "Detail Catalog Item"}</DialogTitle>
        </DialogHeader>

        <QueryState loading={isLoading} skeletonRows={4} className="p-4">
        {data ? (
          <div className="space-y-5">
            {/* Status + quick actions */}
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Status:</span>
                  <StatusBadge status={data.status} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusActions
                    status={data.status}
                    loading={statusLoading}
                    onAction={changeStatus}
                  />
                </div>
              </div>
            </div>

            {/* Cover image */}
            {data.mediaAssets && data.mediaAssets.length > 0 && (() => {
              const cover = getCoverAsset(data.mediaAssets);
              return cover && isImage(cover) ? (
                <div className="rounded-lg overflow-hidden border bg-muted" style={{ maxHeight: 240 }}>
                  <img src={cover.url} alt={cover.name ?? "cover"} className="w-full h-full object-cover" style={{ maxHeight: 240 }} />
                </div>
              ) : null;
            })()}

            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Vendor</span><p className="font-medium">{data.vendorName}</p></div>
              <div><span className="text-muted-foreground">Template Kind</span><p className="font-medium capitalize">{data.templateKind ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Category / Service</span><p className="font-medium">{data.categoryKey ?? data.serviceType ?? data.kategori ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Unit</span><p className="font-medium">{data.unit ?? "—"}</p></div>

              {/* Pricing section — admin only visibility */}
              <div className="col-span-2">
                <Separator className="my-1" />
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <div className="bg-orange-50 rounded p-2 border border-orange-200">
                    <div className="flex items-center gap-1 mb-0.5">
                      <Lock className="w-3 h-3 text-orange-500" />
                      <span className="text-xs text-orange-600 font-semibold">Admin Only</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Harga Dasar</p>
                    <p className="font-bold text-orange-600">{fmtIDR(data.priceBase)}</p>
                  </div>
                  <div className="bg-green-50 rounded p-2 border border-green-200">
                    <div className="flex items-center gap-1 mb-0.5">
                      <Globe className="w-3 h-3 text-green-600" />
                      <span className="text-xs text-green-600 font-semibold">Customer</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Harga Jual</p>
                    <p className="font-bold text-green-600">{fmtIDR(data.priceSell)}</p>
                  </div>
                  <div className="bg-blue-50 rounded p-2 border border-blue-200">
                    <div className="flex items-center gap-1 mb-0.5">
                      <TrendingUp className="w-3 h-3 text-blue-600" />
                      <span className="text-xs text-blue-600 font-semibold">Admin Only</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Margin</p>
                    <p className="font-bold text-blue-600">
                      {data.priceSell != null
                        ? fmtIDR(data.priceSell - data.priceBase)
                        : "—"}
                    </p>
                  </div>
                </div>
                <Separator className="mt-2" />
              </div>

              <div><span className="text-muted-foreground">Stock</span><p className="font-medium"><StockBadge status={data.stockStatus} /> {data.stockQty != null ? `(${data.stockQty})` : ""}</p></div>
              <div><span className="text-muted-foreground">Lead Time</span><p className="font-medium">{data.leadTime ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Lokasi</span><p className="font-medium">{data.location ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Origin</span><p className="font-medium">{data.origin ?? "—"}</p></div>
              {data.mediaAssets && data.mediaAssets.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Media</span>
                  <p className="font-medium">{data.mediaAssets.length} asset(s) — {data.mediaAssets.filter(isImage).length} gambar, {data.mediaAssets.filter(isVideo).length} video</p>
                </div>
              )}
              {data.publishedAt && (
                <div><span className="text-muted-foreground">Published At</span><p className="font-medium">{fmtDate(data.publishedAt)}</p></div>
              )}
            </div>

            {data.description && (
              <div>
                <h4 className="font-semibold mb-1">Deskripsi</h4>
                <p className="text-sm text-muted-foreground">{data.description}</p>
              </div>
            )}

            {/* Spec Values */}
            {data.specValues && Object.keys(data.specValues as object).length > 0 && (
              <div>
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Package className="h-4 w-4" /> Spec Values
                </h4>
                <SpecValuesView values={data.specValues as Record<string, unknown> | null} />
              </div>
            )}

            {/* Template Snapshot */}
            {data.templateSnapshot && (
              <div>
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" /> Template Snapshot
                </h4>
                <TemplateSnapshotView snapshot={data.templateSnapshot as Record<string, unknown> | null} />
              </div>
            )}
          </div>
        ) : null}
        </QueryState>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          {data && (
            <Button asChild variant="outline">
              <Link href={`/purchase/vendors/${data.vendorId}`}>
                Buka Vendor <ExternalLink className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status Actions Component ─────────────────────────────────────────────────

function StatusActions({
  status,
  loading,
  onAction,
  size = "sm",
}: {
  status: string;
  loading: string | null;
  onAction: (status: string) => void;
  size?: "sm" | "xs";
}) {
  const btnClass = size === "xs" ? "h-6 text-xs px-2" : "";
  const isLoading = (s: string) => loading === s;
  const LoadIcon = ({ s }: { s: string }) => isLoading(s) ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null;

  return (
    <>
      {status === "draft" && (
        <>
          <Button size={size as any} variant="outline" className={`${btnClass} border-yellow-400 text-yellow-700 hover:bg-yellow-50`} onClick={() => onAction("pending_review")} disabled={!!loading}>
            <LoadIcon s="pending_review" /><Send className="w-3 h-3 mr-1" />Review
          </Button>
          <Button size={size as any} className={`${btnClass} bg-green-600 hover:bg-green-700`} onClick={() => onAction("published")} disabled={!!loading}>
            <LoadIcon s="published" /><Globe className="w-3 h-3 mr-1" />Publish
          </Button>
          <Button size={size as any} variant="outline" className={`${btnClass} text-red-500 border-red-300 hover:bg-red-50`} onClick={() => onAction("archived")} disabled={!!loading}>
            <LoadIcon s="archived" /><Archive className="w-3 h-3 mr-1" />Archive
          </Button>
        </>
      )}
      {status === "pending_review" && (
        <>
          <Button size={size as any} className={`${btnClass} bg-green-600 hover:bg-green-700`} onClick={() => onAction("published")} disabled={!!loading}>
            <LoadIcon s="published" /><CheckCircle className="w-3 h-3 mr-1" />Approve & Publish
          </Button>
          <Button size={size as any} variant="outline" onClick={() => onAction("draft")} disabled={!!loading}>
            <LoadIcon s="draft" /><RotateCcw className="w-3 h-3 mr-1" />Kembalikan ke Draft
          </Button>
          <Button size={size as any} variant="outline" className={`${btnClass} text-red-500 border-red-300 hover:bg-red-50`} onClick={() => onAction("archived")} disabled={!!loading}>
            <LoadIcon s="archived" /><Archive className="w-3 h-3 mr-1" />Archive
          </Button>
        </>
      )}
      {status === "published" && (
        <>
          <Button size={size as any} variant="outline" className={`${btnClass} text-yellow-700 border-yellow-400 hover:bg-yellow-50`} onClick={() => onAction("draft")} disabled={!!loading}>
            <LoadIcon s="draft" /><EyeOff className="w-3 h-3 mr-1" />Unpublish
          </Button>
          <Button size={size as any} variant="outline" className={`${btnClass} text-red-500 border-red-300 hover:bg-red-50`} onClick={() => onAction("archived")} disabled={!!loading}>
            <LoadIcon s="archived" /><Archive className="w-3 h-3 mr-1" />Archive
          </Button>
        </>
      )}
      {status === "archived" && (
        <Button size={size as any} variant="outline" onClick={() => onAction("draft")} disabled={!!loading}>
          <LoadIcon s="draft" /><RotateCcw className="w-3 h-3 mr-1" />Restore ke Draft
        </Button>
      )}
    </>
  );
}

// ─── Compare Dialog ───────────────────────────────────────────────────────────

function CompareDialog({
  items,
  open,
  onClose,
}: {
  items: CatalogRow[];
  open: boolean;
  onClose: () => void;
}) {
  if (items.length === 0) return null;

  const fields: Array<{ key: keyof CatalogRow; label: string; adminOnly?: boolean }> = [
    { key: "vendorName", label: "Vendor" },
    { key: "templateKind", label: "Tipe" },
    { key: "categoryKey", label: "Category" },
    { key: "priceBase", label: "Harga Dasar 🔒", adminOnly: true },
    { key: "priceSell", label: "Harga Jual" },
    { key: "unit", label: "Unit" },
    { key: "moq", label: "MOQ" },
    { key: "stockStatus", label: "Stock" },
    { key: "stockQty", label: "Qty" },
    { key: "leadTime", label: "Lead Time" },
    { key: "location", label: "Lokasi" },
    { key: "origin", label: "Origin" },
    { key: "status", label: "Status" },
  ];

  const renderVal = (item: CatalogRow, key: keyof CatalogRow) => {
    const v = item[key];
    if (key === "priceBase" || key === "priceSell") return fmtIDR(v as number | null);
    if (key === "stockStatus") return <StockBadge status={v as string | null} />;
    if (key === "status") return <StatusBadge status={v as string} />;
    return v != null ? String(v) : "—";
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Perbandingan Catalog — {items.length} item</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Field</TableHead>
                {items.map((item) => (
                  <TableHead key={item.id} className="min-w-40">
                    <div className="font-semibold text-sm">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.vendorName}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f) => (
                <TableRow key={f.key} className={f.adminOnly ? "bg-orange-50/50" : ""}>
                  <TableCell className="text-muted-foreground text-xs font-medium">{f.label}</TableCell>
                  {items.map((item) => (
                    <TableCell key={item.id} className="text-sm">
                      {renderVal(item, f.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground px-1">🔒 = Admin only, tidak ditampilkan ke customer</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VendorCatalogPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filters
  const [search, setSearch] = useState("");
  const [filterVendor, setFilterVendor] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterKind, setFilterKind] = useState("all");

  // Dialogs
  const [detailId, setDetailId] = useState<number | null>(null);
  const [pricingItem, setPricingItem] = useState<CatalogRow | null>(null);
  const [mediaItem, setMediaItem] = useState<CatalogRow | null>(null);
  const [compareItems, setCompareItems] = useState<CatalogRow[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  // Selection for compare
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Inline status change
  const [statusLoading, setStatusLoading] = useState<Record<number, string>>({});

  const QK = ["vendor-catalog-all", filterVendor, filterStatus, filterKind, search];

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: QK,
    queryFn: () =>
      fetchCatalogAll({ vendor: filterVendor, status: filterStatus, templateKind: filterKind, search }),
  });

  // Unique vendors for filter dropdown
  const vendors = useMemo(() => {
    const seen = new Set<string>();
    return data
      .map(r => ({ id: r.vendorId, name: r.vendorName }))
      .filter(v => { if (seen.has(String(v.id))) return false; seen.add(String(v.id)); return true; });
  }, [data]);

  // Stats
  const stats = useMemo(() => ({
    total: data.length,
    published: data.filter(r => r.status === "published").length,
    pending: data.filter(r => r.status === "pending_review").length,
    draft: data.filter(r => r.status === "draft").length,
    archived: data.filter(r => r.status === "archived").length,
  }), [data]);

  async function handleInlineStatus(item: CatalogRow, newStatus: string) {
    setStatusLoading(prev => ({ ...prev, [item.id]: newStatus }));
    try {
      await patchStatus(item.id, newStatus);
      const m = STATUS_META[newStatus];
      toast({ title: `"${item.name}" → ${m?.label ?? newStatus}` });
      queryClient.invalidateQueries({ queryKey: ["vendor-catalog-all"] });
    } catch (e: any) {
      toast({ title: "Gagal", description: e.message, variant: "destructive" });
    } finally {
      setStatusLoading(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    }
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function openCompare() {
    const items = data.filter(r => selected.has(r.id));
    if (items.length < 2) {
      toast({ title: "Pilih minimal 2 item untuk dibandingkan", variant: "destructive" });
      return;
    }
    setCompareItems(items);
    setCompareOpen(true);
  }

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: ["vendor-catalog-all"] });

  return (
    <AppShell>
      <BackButton href="/purchase" />
      <TooltipProvider>
        <div className="p-6 space-y-5">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" />Kembali
          </Button>
          {/* ── Header ────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold">Vendor Catalog</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Kelola item katalog: review, pricing, media, dan status publikasi
              </p>
            </div>
            <div className="flex gap-2">
              {selected.size >= 2 && (
                <Button variant="outline" size="sm" onClick={openCompare}>
                  <GitCompare className="w-4 h-4 mr-1" /> Compare ({selected.size})
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="w-4 h-4 mr-1" /> Refresh
              </Button>
              <Button size="sm" asChild>
                <Link href="/purchase/vendor-catalog-engine">
                  Review Queue
                  {stats.pending > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-orange-500 text-white text-xs w-4 h-4">
                      {stats.pending}
                    </span>
                  )}
                </Link>
              </Button>
            </div>
          </div>

          {/* ── Stats ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Total", val: stats.total, cls: "" },
              { label: "Published", val: stats.published, cls: "text-green-600" },
              { label: "Pending Review", val: stats.pending, cls: "text-yellow-600" },
              { label: "Draft", val: stats.draft, cls: "text-muted-foreground" },
              { label: "Archived", val: stats.archived, cls: "text-red-500" },
            ].map(s => (
              <Card key={s.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilterStatus(s.label === "Total" ? "all" : s.label.toLowerCase().replace(" ", "_"))}>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-3xl font-bold mt-1 ${s.cls}`}>{s.val}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── Filters ───────────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 w-52" placeholder="Cari nama / vendor..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={filterVendor} onValueChange={setFilterVendor}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Semua Vendor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Vendor</SelectItem>
                {vendors.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Semua Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterKind} onValueChange={setFilterKind}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Semua Tipe" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tipe</SelectItem>
                <SelectItem value="service">Service</SelectItem>
                <SelectItem value="product">Product</SelectItem>
              </SelectContent>
            </Select>
            {(filterVendor !== "all" || filterStatus !== "all" || filterKind !== "all" || search) && (
              <Button size="sm" variant="ghost" onClick={() => { setFilterVendor("all"); setFilterStatus("all"); setFilterKind("all"); setSearch(""); }}>
                <X className="w-3.5 h-3.5 mr-1" /> Reset
              </Button>
            )}
          </div>

          {/* ── Table ─────────────────────────────────────────────────────── */}
          <Card>
            <CardContent className="p-0">
              <QueryState
                loading={isLoading}
                empty={!isLoading && data.length === 0}
                emptyMessage={`Tidak ada catalog item${filterStatus !== "all" || search ? " yang cocok dengan filter" : ""}`}
                emptyIcon={<Package className="w-12 h-12 opacity-30" />}
                skeletonRows={5}
                className="p-4"
              >
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead className="w-12">Cover</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>
                          <div className="flex items-center gap-1">
                            <Lock className="w-3 h-3 text-orange-400" /> Harga Dasar
                          </div>
                        </TableHead>
                        <TableHead>
                          <div className="flex items-center gap-1">
                            <Globe className="w-3 h-3 text-green-500" /> Harga Jual
                          </div>
                        </TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Media</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.map(item => {
                        const cover = getCoverAsset(item.mediaAssets ?? []);
                        const loadingStatus = statusLoading[item.id];
                        const margin = item.priceSell != null ? item.priceSell - item.priceBase : null;

                        return (
                          <TableRow key={item.id} className={selected.has(item.id) ? "bg-blue-50" : ""}>
                            {/* Checkbox */}
                            <TableCell className="p-1">
                              <input
                                type="checkbox"
                                checked={selected.has(item.id)}
                                onChange={() => toggleSelect(item.id)}
                                className="w-4 h-4 rounded"
                              />
                            </TableCell>

                            {/* Cover thumbnail */}
                            <TableCell className="p-1">
                              <div className="w-10 h-10 rounded overflow-hidden bg-muted flex items-center justify-center">
                                {cover && isImage(cover) ? (
                                  <img src={cover.url} alt="cover" className="w-full h-full object-cover" />
                                ) : cover && isVideo(cover) ? (
                                  <Play className="w-4 h-4 text-muted-foreground" />
                                ) : (
                                  <Package className="w-4 h-4 text-muted-foreground opacity-30" />
                                )}
                              </div>
                            </TableCell>

                            {/* Name */}
                            <TableCell>
                              <p className="font-medium text-sm">{item.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.templateKind ?? "—"} • {item.categoryKey ?? item.serviceType ?? "—"}
                              </p>
                            </TableCell>

                            {/* Vendor */}
                            <TableCell className="text-sm">{item.vendorName}</TableCell>

                            {/* priceBase — admin only */}
                            <TableCell>
                              <span className="text-sm font-medium text-orange-600">{fmtIDR(item.priceBase)}</span>
                            </TableCell>

                            {/* priceSell */}
                            <TableCell>
                              <div>
                                <span className="text-sm font-semibold text-green-600">{fmtIDR(item.priceSell)}</span>
                                {margin != null && (
                                  <p className={`text-xs ${margin >= 0 ? "text-blue-500" : "text-red-400"}`}>
                                    margin {fmtIDR(margin)}
                                  </p>
                                )}
                              </div>
                            </TableCell>

                            {/* Status */}
                            <TableCell>
                              <StatusBadge status={item.status} />
                            </TableCell>

                            {/* Media count */}
                            <TableCell>
                              {item.mediaAssets && item.mediaAssets.length > 0 ? (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Image className="w-3 h-3" />
                                  {item.mediaAssets.filter(isImage).length}
                                  {item.mediaAssets.filter(isVideo).length > 0 && (
                                    <>
                                      <Video className="w-3 h-3 ml-1" />
                                      {item.mediaAssets.filter(isVideo).length}
                                    </>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>

                            {/* Actions */}
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {/* Detail */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="ghost" onClick={() => setDetailId(item.id)}>
                                      <Eye className="w-3.5 h-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Detail</TooltipContent>
                                </Tooltip>

                                {/* Pricing */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="ghost" onClick={() => setPricingItem(item)}>
                                      <DollarSign className="w-3.5 h-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit Harga Jual</TooltipContent>
                                </Tooltip>

                                {/* Media */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="ghost" onClick={() => setMediaItem(item)}>
                                      <Image className="w-3.5 h-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Kelola Media</TooltipContent>
                                </Tooltip>

                                {/* Quick status actions */}
                                <StatusActions
                                  status={item.status}
                                  loading={loadingStatus ?? null}
                                  onAction={(s) => handleInlineStatus(item, s)}
                                  size="xs"
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </QueryState>
            </CardContent>
          </Card>

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Lock className="w-3 h-3 text-orange-400" /> Harga Dasar = Admin Only, tidak pernah dikirim ke customer API
            </span>
            <span className="flex items-center gap-1">
              <Globe className="w-3 h-3 text-green-500" /> Harga Jual = yang ditampilkan ke customer
            </span>
          </div>
        </div>
      </TooltipProvider>

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      <DetailDialog
        itemId={detailId}
        open={detailId != null}
        onClose={() => setDetailId(null)}
        onStatusChange={invalidateAll}
      />

      <PricingDialog
        item={pricingItem}
        open={pricingItem != null}
        onClose={() => setPricingItem(null)}
        onSaved={invalidateAll}
      />

      <MediaDialog
        item={mediaItem}
        open={mediaItem != null}
        onClose={() => setMediaItem(null)}
        onSaved={invalidateAll}
      />

      <CompareDialog
        items={compareItems}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
      />
    </AppShell>
  );
}
