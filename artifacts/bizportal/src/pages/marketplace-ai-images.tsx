import { useState, useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ImageIcon,
  RefreshCw,
  Eye,
  Loader2,
  Search,
  Wand2,
  CheckCircle2,
  XCircle,
  ImageOff,
  ExternalLink,
  Package,
  Wrench,
  AlertTriangle,
  Images,
  ArrowLeft,
} from "lucide-react";
import { ProductMediaManager } from "@/components/catalog/ProductMediaManager";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GenerationItem {
  id: number;
  name: string;
  vendorId: number;
  vendorName: string | null;
  kategori: string | null;
  type: string;
  isPublished: boolean;
  description: string | null;
  mediaCount: number;
  hasImage: boolean;
  primaryImageUrl: string | null;
  lastGeneratedAt: string | null;
}

interface GenerationStatus {
  total: number;
  withImage: number;
  withoutImage: number;
  items: GenerationItem[];
}

interface BulkResult {
  processed: number;
  success: number;
  failed: number;
  results: Array<{ id: number; name: string; success: boolean; error?: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? d.message ?? "Terjadi kesalahan");
  return d;
}

function CoverageBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MarketplaceAiImagesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "product" | "service">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "with" | "without">("all");
  const [bulkLimit, setBulkLimit] = useState("10");
  const [onlyPublished, setOnlyPublished] = useState(false);
  const [forceRegenerate, setForceRegenerate] = useState(false);
  const [previewItem, setPreviewItem] = useState<GenerationItem | null>(null);
  const [mediaItem, setMediaItem] = useState<GenerationItem | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<number>>(new Set());

  // ── Data fetching ───────────────────────────────────────────────────────────
  const { data, isLoading, isError, error } = useQuery<GenerationStatus>({
    queryKey: ["product-media/generation-status"],
    queryFn: () => apiFetch("/api/product-media/generation-status"),
  });

  // ── Mutations ───────────────────────────────────────────────────────────────
  const bulkMutation = useMutation<BulkResult, Error>({
    mutationFn: () =>
      apiFetch("/api/product-media/bulk-generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: parseInt(bulkLimit),
          onlyPublished,
          force: forceRegenerate,
        }),
      }),
    onSuccess: (result) => {
      setBulkResult(result);
      queryClient.invalidateQueries({ queryKey: ["product-media/generation-status"] });
      toast({
        title: `Generate selesai: ${result.success} berhasil, ${result.failed} gagal`,
        variant: result.failed > 0 ? "destructive" : "default",
      });
    },
    onError: (err) => {
      const msg = err.message ?? "";
      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
        toast({ title: "Akses ditolak — login sebagai admin/owner", variant: "destructive" });
      } else if (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("billing")) {
        toast({ title: "Kuota OpenAI habis — periksa billing akun OpenAI Anda", variant: "destructive" });
      } else {
        toast({ title: `Gagal: ${msg}`, variant: "destructive" });
      }
    },
  });

  const regenerateMutation = useMutation<{ media: unknown }, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/api/product-media/regenerate-ai/${id}`, { method: "POST" }),
    onMutate: (id) => setRegeneratingIds((s) => new Set(s).add(id)),
    onSettled: (_, __, id) =>
      setRegeneratingIds((s) => { const n = new Set(s); n.delete(id); return n; }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["product-media/generation-status"] });
      if (previewItem?.id === id) setPreviewItem(null);
      toast({ title: "Gambar berhasil di-regenerate" });
    },
    onError: (err, id) => {
      const msg = err.message ?? "";
      if (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("billing")) {
        toast({ title: "Kuota OpenAI habis — periksa billing akun OpenAI Anda", variant: "destructive" });
      } else if (msg.toLowerCase().includes("storage") || msg.toLowerCase().includes("supabase")) {
        toast({ title: `Gagal upload ke storage: ${msg}`, variant: "destructive" });
      } else {
        toast({ title: `Gagal regenerate: ${msg}`, variant: "destructive" });
      }
    },
  });

  // ── Filtered items ───────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter((item) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !item.name.toLowerCase().includes(q) &&
          !(item.vendorName ?? "").toLowerCase().includes(q) &&
          !(item.kategori ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      if (filterType !== "all" && item.type !== filterType) return false;
      if (filterStatus === "with" && !item.hasImage) return false;
      if (filterStatus === "without" && item.hasImage) return false;
      return true;
    });
  }, [data, search, filterType, filterStatus]);

  const coverage = data ? Math.round((data.withImage / Math.max(data.total, 1)) * 100) : 0;

  // ── Error state ──────────────────────────────────────────────────────────────
  if (isError) {
    const msg = (error as Error)?.message ?? "";
    return (
      <AppShell>
        <div className="p-8 flex flex-col items-center gap-4">
          <AlertTriangle className="w-12 h-12 text-destructive" />
          {msg.includes("401") || msg.toLowerCase().includes("unauthorized") ? (
            <div className="text-center">
              <p className="font-semibold text-lg">Akses Ditolak</p>
              <p className="text-muted-foreground">Halaman ini hanya bisa diakses oleh admin/owner.</p>
            </div>
          ) : (
            <p className="text-destructive">{msg || "Gagal memuat data"}</p>
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wand2 className="w-6 h-6 text-primary" />
              AI Image Generator
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Generate gambar produk otomatis menggunakan DALL·E 3 untuk semua item di Vendor Catalog
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["product-media/generation-status"] })}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Total Item</p>
              {isLoading ? (
                <div className="h-8 w-16 bg-muted animate-pulse rounded mt-1" />
              ) : (
                <p className="text-3xl font-bold">{data?.total ?? 0}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Sudah Ada Gambar</p>
              {isLoading ? (
                <div className="h-8 w-16 bg-muted animate-pulse rounded mt-1" />
              ) : (
                <p className="text-3xl font-bold text-green-600">{data?.withImage ?? 0}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Belum Ada Gambar</p>
              {isLoading ? (
                <div className="h-8 w-16 bg-muted animate-pulse rounded mt-1" />
              ) : (
                <p className="text-3xl font-bold text-red-500">{data?.withoutImage ?? 0}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">Coverage</p>
              {isLoading ? (
                <div className="h-8 w-16 bg-muted animate-pulse rounded mt-1" />
              ) : (
                <>
                  <p className="text-3xl font-bold">{coverage}%</p>
                  <CoverageBar pct={coverage} />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bulk Generate */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wand2 className="w-4 h-4" />
              Generate Massal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label>Limit</Label>
                <Select value={bulkLimit} onValueChange={setBulkLimit}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["5", "10", "25", "50"].map((v) => (
                      <SelectItem key={v} value={v}>{v} item</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pb-0.5">
                <Checkbox
                  id="onlyPublished"
                  checked={onlyPublished}
                  onCheckedChange={(v) => setOnlyPublished(!!v)}
                />
                <Label htmlFor="onlyPublished" className="cursor-pointer">Hanya yang Published</Label>
              </div>
              <div className="flex items-center gap-2 pb-0.5">
                <Checkbox
                  id="forceRegen"
                  checked={forceRegenerate}
                  onCheckedChange={(v) => setForceRegenerate(!!v)}
                />
                <Label htmlFor="forceRegen" className="cursor-pointer">Force Regenerate (termasuk yg sudah ada)</Label>
              </div>
              <Button
                onClick={() => bulkMutation.mutate()}
                disabled={bulkMutation.isPending}
                className="ml-auto"
              >
                {bulkMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sedang generate…</>
                ) : (
                  <><Wand2 className="w-4 h-4 mr-2" />Generate Semua yang Belum Ada</>
                )}
              </Button>
            </div>

            {/* Bulk Result */}
            {bulkResult && (
              <div className="rounded-md border p-3 space-y-2 bg-muted/30">
                <div className="flex items-center gap-3 text-sm font-medium">
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="w-4 h-4" /> {bulkResult.success} berhasil
                  </span>
                  {bulkResult.failed > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="w-4 h-4" /> {bulkResult.failed} gagal
                    </span>
                  )}
                  <span className="text-muted-foreground ml-auto">{bulkResult.processed} diproses</span>
                </div>
                {bulkResult.results.filter((r) => !r.success).map((r) => (
                  <div key={r.id} className="text-xs text-destructive">
                    ✗ {r.name}: {r.error}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari nama item, vendor, kategori…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Tipe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Tipe</SelectItem>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="service">Service</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Status gambar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="with">Sudah Ada Gambar</SelectItem>
              <SelectItem value="without">Belum Ada Gambar</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{filteredItems.length} item</span>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Gambar</TableHead>
                    <TableHead>Nama Item</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Jml</TableHead>
                    <TableHead>Terakhir Generate</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 9 }).map((__, j) => (
                          <TableCell key={j}>
                            <div className="h-4 bg-muted animate-pulse rounded" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                        <ImageOff className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        Tidak ada item ditemukan
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map((item) => (
                      <TableRow key={item.id}>
                        {/* Thumbnail */}
                        <TableCell>
                          <div className="w-12 h-12 rounded border overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
                            {item.primaryImageUrl ? (
                              <img
                                src={item.primaryImageUrl}
                                alt={item.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <ImageOff className="w-5 h-5 text-muted-foreground opacity-50" />
                            )}
                          </div>
                        </TableCell>

                        {/* Name */}
                        <TableCell className="font-medium max-w-48">
                          <span className="line-clamp-2">{item.name}</span>
                        </TableCell>

                        {/* Vendor */}
                        <TableCell className="text-sm text-muted-foreground max-w-32">
                          <span className="line-clamp-1">{item.vendorName ?? "—"}</span>
                        </TableCell>

                        {/* Category */}
                        <TableCell className="text-sm text-muted-foreground max-w-32">
                          <span className="line-clamp-1">{item.kategori ?? "—"}</span>
                        </TableCell>

                        {/* Type */}
                        <TableCell>
                          <Badge variant="outline" className="text-xs gap-1">
                            {item.type === "product" ? (
                              <Package className="w-3 h-3" />
                            ) : (
                              <Wrench className="w-3 h-3" />
                            )}
                            {item.type}
                          </Badge>
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          {item.hasImage ? (
                            <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Ada gambar
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">
                              <XCircle className="w-3 h-3 mr-1" /> Belum ada
                            </Badge>
                          )}
                        </TableCell>

                        {/* Count */}
                        <TableCell className="text-center text-sm">{item.mediaCount}</TableCell>

                        {/* Last Generated */}
                        <TableCell className="text-sm text-muted-foreground">
                          {item.lastGeneratedAt
                            ? new Date(item.lastGeneratedAt).toLocaleDateString("id-ID", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })
                            : "—"}
                        </TableCell>

                        {/* Actions */}
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            {item.hasImage && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2"
                                title="Preview gambar"
                                onClick={() => setPreviewItem(item)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-sky-500 hover:text-sky-600"
                              title="Kelola Foto / Video"
                              onClick={() => setMediaItem(item)}
                            >
                              <Images className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant={item.hasImage ? "outline" : "default"}
                              className="h-8 text-xs"
                              disabled={regeneratingIds.has(item.id) || bulkMutation.isPending}
                              onClick={() => regenerateMutation.mutate(item.id)}
                            >
                              {regeneratingIds.has(item.id) ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : item.hasImage ? (
                                <><RefreshCw className="w-3 h-3 mr-1" />Regenerate</>
                              ) : (
                                <><Wand2 className="w-3 h-3 mr-1" />Generate</>
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Media Manager Dialog */}
      {mediaItem && (
        <ProductMediaManager
          open={!!mediaItem}
          onClose={() => {
            setMediaItem(null);
            queryClient.invalidateQueries({ queryKey: ["product-media/generation-status"] });
          }}
          vendorCatalogItemId={mediaItem.id}
          vendorId={mediaItem.vendorId}
          itemName={mediaItem.name}
          itemCategory={mediaItem.kategori}
          itemDescription={mediaItem.description}
        />
      )}

      {/* Preview Dialog */}
      <Dialog open={!!previewItem} onOpenChange={(o) => !o && setPreviewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="w-5 h-5" />
              Preview Gambar
            </DialogTitle>
          </DialogHeader>
          {previewItem && (
            <div className="space-y-4">
              {previewItem.primaryImageUrl ? (
                <img
                  src={previewItem.primaryImageUrl}
                  alt={previewItem.name}
                  className="w-full aspect-square object-cover rounded-lg border"
                />
              ) : (
                <div className="w-full aspect-square bg-muted rounded-lg flex items-center justify-center">
                  <ImageOff className="w-12 h-12 opacity-30" />
                </div>
              )}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nama</span>
                  <span className="font-medium text-right max-w-56 line-clamp-2">{previewItem.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vendor</span>
                  <span>{previewItem.vendorName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kategori</span>
                  <span>{previewItem.kategori ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Jumlah Gambar</span>
                  <span>{previewItem.mediaCount}</span>
                </div>
                {previewItem.primaryImageUrl && (
                  <div className="pt-1">
                    <p className="text-muted-foreground text-xs mb-1">URL Gambar</p>
                    <p className="text-xs break-all bg-muted rounded px-2 py-1 font-mono">
                      {previewItem.primaryImageUrl}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                {previewItem.primaryImageUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => window.open(previewItem.primaryImageUrl!, "_blank")}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Buka di Tab Baru
                  </Button>
                )}
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={regeneratingIds.has(previewItem.id)}
                  onClick={() => regenerateMutation.mutate(previewItem.id)}
                >
                  {regeneratingIds.has(previewItem.id) ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-2" />Regenerate</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
