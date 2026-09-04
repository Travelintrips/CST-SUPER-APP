import { AppShell } from "@/components/layout/AppShell";
import { useCodeCheck } from "@/hooks/useCodeCheck";
import { CodeCheckIndicator } from "@/components/ui/code-check-indicator";
import {
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useListProductCategories,
  useListTaxes,
  getListProductsQueryKey,
  getListProductCategoriesQueryKey,
  type Product,
  type AccountingTax,
  type MediaItem,
} from "@workspace/api-client-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { QueryState } from "@/components/ui/query-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Package, Wrench, RefreshCw, ImageIcon, X, Video, Loader2, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Download, CheckSquare2, Square, ListChecks, Save } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { LOGISTICS_SUBCATEGORIES as DEFAULT_SUBCATEGORIES, LOGISTICS_UNITS as UNITS } from "@workspace/logistics-constants";
import { BackButton } from "@/components/ui/back-button";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const _BP_USD_KEY = "cst_usd_idr_rate";
const _BP_USD_TTL = 6 * 60 * 60 * 1000;
const _BP_USD_FALLBACK = 16_300;

function _readBpRate(): { rate: number; fresh: boolean } {
  try {
    const raw = localStorage.getItem(_BP_USD_KEY);
    if (raw) {
      const { rate, ts } = JSON.parse(raw) as { rate: number; ts: number };
      if (rate > 1000) return { rate, fresh: Date.now() - ts < _BP_USD_TTL };
    }
  } catch { /* ignore */ }
  return { rate: _BP_USD_FALLBACK, fresh: false };
}

function useUsdRate(): number {
  const [rate, setRate] = useState<number>(() => _readBpRate().rate);
  useEffect(() => {
    const { fresh } = _readBpRate();
    if (fresh) return;
    fetch("/api/ecommerce/usd-idr-rate")
      .then((r) => r.json())
      .then((data: { rate: number }) => {
        const idrRate = data?.rate ?? 0;
        if (idrRate > 1000) {
          localStorage.setItem(_BP_USD_KEY, JSON.stringify({ rate: idrRate, ts: Date.now() }));
          setRate(idrRate);
        }
      })
      .catch(() => { /* keep fallback */ });
  }, []);
  return rate;
}

const CURRENCIES = ["IDR", "USD", "EUR", "SGD", "CNY", "JPY", "MYR", "AUD"];

interface ItemForm {
  name: string;
  sku: string;
  itemType: "barang" | "jasa";
  categories: string[];
  subcategory: string;
  unit: string;
  unitOptions: string[];
  price: string;
  stock: string;
  defaultSalesTaxId: string;
  defaultPurchaseTaxId: string;
  isActive: boolean;
  description: string;
  imageUrl: string;
  mediaItems: MediaItem[];
  weightKg: string;
  volumeCbm: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  goodsType: string;
  currencyCode: string;
}

interface InlineEdit {
  rowId: number;
  field: "goodsType" | "weightKg" | "volumeCbm" | "lengthCm" | "widthCm" | "heightCm";
  value: string;
}

interface BulkFields {
  goodsType: string;
  weightKg: string;
  volumeCbm: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}

const GOODS_TYPES = [
  { value: "general",  label: "General" },
  { value: "kayu",     label: "Kayu" },
  { value: "kapas",    label: "Kapas" },
  { value: "fragile",  label: "Fragile" },
  { value: "liquid",   label: "Liquid" },
  { value: "hazmat",   label: "Hazmat" },
] as const;

function goodsTypeUsesCbm(gt: string): boolean {
  return gt === "kapas" || gt === "liquid";
}

const emptyBulkFields = (): BulkFields => ({
  goodsType: "", weightKg: "", volumeCbm: "", lengthCm: "", widthCm: "", heightCm: "",
});

interface ImportRow {
  nama: string;
  sku: string;
  tipe: string;
  kategori: string;
  satuan: string;
  harga: string;
  stok: string;
  subkategori: string;
  deskripsi: string;
  aktif: string;
}

interface ImportResult {
  row: number;
  sku?: string;
  name?: string;
  status: "created" | "updated" | "error";
  message?: string;
}

interface DimRow {
  sku: string;
  berat_kg: string;
  panjang_cm: string;
  lebar_cm: string;
  tinggi_cm: string;
  jenis_barang: string;
}

interface ScanMatch {
  productId: number;
  productName: string;
  file: string;
  url: string;
}

interface ScanFile {
  file: string;
  url: string;
}
const DIM_COLS: (keyof DimRow)[] = ["sku", "berat_kg", "panjang_cm", "lebar_cm", "tinggi_cm", "jenis_barang"];
const DIM_HEADERS = ["SKU*", "Berat (kg)", "Panjang (cm)", "Lebar (cm)", "Tinggi (cm)", "Jenis Barang"];

const IMPORT_COLS: (keyof ImportRow)[] = ["nama", "sku", "tipe", "kategori", "satuan", "harga", "stok", "subkategori", "deskripsi", "aktif"];
const IMPORT_HEADERS = ["Nama Produk*", "SKU*", "Jenis (barang/jasa)*", "Kategori* (pisah ;)", "Satuan*", "Harga*", "Stok", "Sub-kategori", "Deskripsi", "Aktif (ya/tidak)"];

const emptyForm = (): ItemForm => ({
  name: "",
  sku: "",
  itemType: "barang",
  categories: [],
  subcategory: "",
  unit: "pcs",
  unitOptions: [],
  price: "0",
  stock: "0",
  defaultSalesTaxId: "",
  defaultPurchaseTaxId: "",
  isActive: true,
  description: "",
  imageUrl: "",
  mediaItems: [],
  weightKg: "",
  volumeCbm: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  goodsType: "",
  currencyCode: "IDR",
});

function parseMediaItems(raw: MediaItem[] | string | null | undefined): MediaItem[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is MediaItem => !!x && typeof x.url === "string");
  } catch { return []; }
}

function resolveMediaUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("/objects/")) return `/api/storage${url}`;
  return url;
}

const ALLOWED_IMG_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_IMG_SIZE = 5 * 1024 * 1024; // 5MB

function validateMediaFile(file: File, type: "image" | "video"): string | null {
  if (type === "image") {
    if (!ALLOWED_IMG_TYPES.includes(file.type)) {
      return `${file.name}: Format tidak didukung. Gunakan JPG, JPEG, PNG, atau WEBP.`;
    }
    if (file.size > MAX_IMG_SIZE) {
      return `${file.name}: Ukuran file melebihi batas maksimum 5MB (${(file.size / 1024 / 1024).toFixed(1)}MB).`;
    }
  }
  return null;
}

async function uploadMediaFiles(files: File[], type: "image" | "video"): Promise<MediaItem[]> {
  for (const file of files) {
    const err = validateMediaFile(file, type);
    if (err) throw new Error(err);
  }
  const results: MediaItem[] = [];
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/storage/uploads/file", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? `Gagal mengunggah ${file.name} (${res.status})`);
    }
    const { url } = await res.json() as { url: string; objectPath: string };
    results.push({ type, url });
  }
  return results;
}

function formFromProduct(p: Product): ItemForm {
  return {
    name: p.name,
    sku: p.sku,
    itemType: p.itemType as "barang" | "jasa",
    categories: p.categories ?? [],
    subcategory: p.subcategory ?? "",
    unit: p.unit,
    unitOptions: Array.isArray(p.unitOptions) ? (p.unitOptions ?? []) : [],
    price: String(p.price),
    stock: String(p.stock ?? 0),
    defaultSalesTaxId: p.defaultSalesTaxId ? String(p.defaultSalesTaxId) : "",
    defaultPurchaseTaxId: p.defaultPurchaseTaxId ? String(p.defaultPurchaseTaxId) : "",
    isActive: p.isActive,
    description: p.description ?? "",
    imageUrl: p.imageUrl ?? "",
    mediaItems: parseMediaItems(p.mediaItems),
    weightKg:  p.weightKg  != null ? String(p.weightKg)  : "",
    volumeCbm: p.volumeCbm != null ? String(p.volumeCbm) : "",
    lengthCm:  p.lengthCm  != null ? String(p.lengthCm)  : "",
    widthCm:   p.widthCm   != null ? String(p.widthCm)   : "",
    heightCm:  p.heightCm  != null ? String(p.heightCm)  : "",
    goodsType: p.goodsType ?? "",
    currencyCode: (p as unknown as { currencyCode?: string }).currencyCode ?? "IDR",
  };
}

export default function SalesItemsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const usdIdrRate = useUsdRate();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "barang" | "jasa">("all");
  const [filterSubcat, setFilterSubcat] = useState<string>("all");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("active");

  const { data: _productsPaginated, isLoading } = useListProducts(
    { limit: 500 },
    { query: { queryKey: getListProductsQueryKey({}) } }
  );
  const products = useMemo(() => _productsPaginated?.data ?? [], [_productsPaginated?.data]);
  const { data: categories = [] } = useListProductCategories();
  const { data: taxes = [] } = useListTaxes();
  const { data: apiSubcats = [...DEFAULT_SUBCATEGORIES] } = useQuery<string[]>({
    queryKey: ["logistics-subcategories"],
    queryFn: () => fetch("/api/settings/logistics-subcategories", { credentials: "include" }).then((r) => r.ok ? r.json() : [...DEFAULT_SUBCATEGORIES]),
    staleTime: 5 * 60 * 1000,
  });

  const createMut = useCreateProduct();
  const updateMut = useUpdateProduct();
  const deleteMut = useDeleteProduct();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ItemForm>(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [dimOpen, setDimOpen] = useState(false);
  const [dimRows, setDimRows] = useState<DimRow[]>([]);
  const [dimResults, setDimResults] = useState<ImportResult[] | null>(null);
  const [dimLoading, setDimLoading] = useState(false);
  const [dimError, setDimError] = useState<string | null>(null);
  const dimFileRef = useRef<HTMLInputElement>(null);

  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [inlineSaving, setInlineSaving] = useState<Set<number>>(new Set());
  const [inlineImgUploading, setInlineImgUploading] = useState<Set<number>>(new Set());
  const inlineImgRef = useRef<HTMLInputElement>(null);
  const [inlineImgTarget, setInlineImgTarget] = useState<Product | null>(null);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<{ files: number; matched: ScanMatch[]; allFiles: ScanFile[] } | null>(null);
  const [scanAssign, setScanAssign] = useState<Record<number, string>>({});
  const [scanApplying, setScanApplying] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkFields, setBulkFields] = useState<BulkFields>(emptyBulkFields());
  const [bulkSavingIds, setBulkSavingIds] = useState<Set<number>>(new Set());

  const saveInlineEdit = async (p: Product, field: InlineEdit["field"], rawValue: string) => {
    setInlineEdit(null);
    const numVal = rawValue.trim() !== "" ? Number(rawValue) : null;
    const strVal = rawValue.trim() || null;
    const payload = {
      name: p.name,
      sku: p.sku,
      price: p.price,
      stock: p.stock ?? 0,
      categories: p.categories ?? [],
      description: p.description ?? null,
      itemType: p.itemType,
      unit: p.unit,
      unitOptions: Array.isArray(p.unitOptions) ? (p.unitOptions as string[]) : [],
      subcategory: p.subcategory ?? null,
      isActive: p.isActive,
      defaultSalesTaxId: p.defaultSalesTaxId ?? null,
      defaultPurchaseTaxId: p.defaultPurchaseTaxId ?? null,
      imageUrl: p.imageUrl ?? null,
      mediaItems: Array.isArray(p.mediaItems) ? p.mediaItems : [],
      weightKg:  field === "weightKg"  ? numVal : (p.weightKg  ?? null),
      volumeCbm: field === "volumeCbm" ? numVal : (p.volumeCbm ?? null),
      lengthCm:  field === "lengthCm"  ? numVal : (p.lengthCm  ?? null),
      widthCm:   field === "widthCm"   ? numVal : (p.widthCm   ?? null),
      heightCm:  field === "heightCm"  ? numVal : (p.heightCm  ?? null),
      goodsType: field === "goodsType" ? strVal : (p.goodsType ?? null),
    };
    setInlineSaving((s) => new Set(s).add(p.id));
    try {
      await updateMut.mutateAsync({ id: p.id, data: payload });
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(e);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    } finally {
      setInlineSaving((s) => { const n = new Set(s); n.delete(p.id); return n; });
    }
  };

  const handleInlineImageUpload = async (file: File, product: Product) => {
    const err = validateMediaFile(file, "image");
    if (err) { toast({ title: "File tidak valid", description: err, variant: "destructive" }); return; }
    setInlineImgUploading((s) => new Set(s).add(product.id));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/storage/uploads/file", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? `Upload gagal (${res.status})`); }
      const { url } = await res.json() as { url: string };
      const patchRes = await fetch(`/api/ecommerce/products/${product.id}/image`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: url }),
      });
      if (!patchRes.ok) throw new Error("Gagal menyimpan gambar");
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
      toast({ title: "Gambar berhasil disimpan" });
    } catch (e) {
      toast({ title: "Gagal upload gambar", description: String(e), variant: "destructive" });
    } finally {
      setInlineImgUploading((s) => { const n = new Set(s); n.delete(product.id); return n; });
      setInlineImgTarget(null);
    }
  };

  const handleScanStorage = async () => {
    setScanLoading(true);
    setScanResult(null);
    setScanAssign({});
    try {
      const res = await fetch("/api/ecommerce/products/scan-storage", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { files: number; matched: ScanMatch[]; allFiles: ScanFile[] };
      setScanResult(data);
      const autoAssign: Record<number, string> = {};
      for (const m of data.matched) autoAssign[m.productId] = m.url;
      setScanAssign(autoAssign);
    } catch (e) {
      toast({ title: "Scan gagal", description: String(e), variant: "destructive" });
    } finally {
      setScanLoading(false);
    }
  };

  const handleApplyScan = async () => {
    const assignments = Object.entries(scanAssign)
      .filter(([, url]) => !!url)
      .map(([productId, url]) => ({ productId: Number(productId), url }));
    if (assignments.length === 0) { toast({ title: "Tidak ada yang dipilih" }); return; }
    setScanApplying(true);
    try {
      const res = await fetch("/api/ecommerce/products/apply-storage-images", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { applied: number };
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
      toast({ title: `${data.applied} gambar berhasil diterapkan` });
      setScanOpen(false);
    } catch (e) {
      toast({ title: "Gagal menerapkan", description: String(e), variant: "destructive" });
    } finally {
      setScanApplying(false);
    }
  };

  const handleBulkSave = async () => {
    if (selectedIds.size === 0) return;
    const fields: Record<string, unknown> = {};
    if (bulkFields.goodsType !== "") fields.goodsType = bulkFields.goodsType;

    const parsePositive = (v: string, label: string): number | null | "invalid" => {
      if (v.trim() === "") return null;
      const n = parseFloat(v);
      if (isNaN(n) || n < 0) return "invalid";
      return n;
    };

    const wKg  = parsePositive(bulkFields.weightKg,  "Berat");
    const vCbm = parsePositive(bulkFields.volumeCbm, "CBM");
    const lCm  = parsePositive(bulkFields.lengthCm,  "Panjang");
    const wCm  = parsePositive(bulkFields.widthCm,   "Lebar");
    const hCm  = parsePositive(bulkFields.heightCm,  "Tinggi");

    if (wKg  === "invalid") { toast({ title: "Validasi", description: "Berat harus ≥ 0",   variant: "destructive" }); return; }
    if (vCbm === "invalid") { toast({ title: "Validasi", description: "CBM harus ≥ 0",    variant: "destructive" }); return; }
    if (lCm  === "invalid") { toast({ title: "Validasi", description: "Panjang harus ≥ 0", variant: "destructive" }); return; }
    if (wCm  === "invalid") { toast({ title: "Validasi", description: "Lebar harus ≥ 0",   variant: "destructive" }); return; }
    if (hCm  === "invalid") { toast({ title: "Validasi", description: "Tinggi harus ≥ 0",  variant: "destructive" }); return; }

    if (bulkFields.weightKg.trim()  !== "") fields.weightKg  = wKg;
    if (bulkFields.volumeCbm.trim() !== "") fields.volumeCbm = vCbm;
    if (bulkFields.lengthCm.trim()  !== "") fields.lengthCm  = lCm;
    if (bulkFields.widthCm.trim()   !== "") fields.widthCm   = wCm;
    if (bulkFields.heightCm.trim()  !== "") fields.heightCm  = hCm;

    if (Object.keys(fields).length === 0) {
      toast({ title: "Info", description: "Isi minimal satu field untuk diubah", variant: "destructive" });
      return;
    }

    const ids = Array.from(selectedIds);
    setBulkSavingIds(new Set(ids));
    try {
      const res = await fetch("/api/ecommerce/products/bulk-update-fields", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, fields }),
      });
      const data = await res.json() as { updated?: number; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Gagal update batch");
      await qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
      toast({ title: `${data.updated ?? ids.length} item berhasil diperbarui` });
      setSelectedIds(new Set());
      setBulkFields(emptyBulkFields());
    } catch (e: unknown) {
      const msg = (e as Error).message ?? String(e);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    } finally {
      setBulkSavingIds(new Set());
    }
  };

  const cancelBulkEdit = () => {
    setSelectedIds(new Set());
    setBulkFields(emptyBulkFields());
  };

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelBulkEdit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds.size]);

  const toggleRowSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      if (next.size === 0) setBulkFields(emptyBulkFields());
      return next;
    });
  };

  const toggleSelectAll = () => {
    const barangIds = filtered.filter((p) => p.itemType === "barang").map((p) => p.id);
    if (barangIds.every((id) => selectedIds.has(id)) && barangIds.length > 0) {
      setSelectedIds(new Set());
      setBulkFields(emptyBulkFields());
    } else {
      setSelectedIds(new Set(barangIds));
    }
  };

  const setBF = <K extends keyof BulkFields>(k: K, v: BulkFields[K]) =>
    setBulkFields((f) => ({ ...f, [k]: v }));

  const bulkGoodsTypeForPanel = bulkFields.goodsType;
  const showCbmInPanel  = bulkGoodsTypeForPanel === "" ? true  : goodsTypeUsesCbm(bulkGoodsTypeForPanel);
  const showWeightInPanel = bulkGoodsTypeForPanel === "" ? true : !goodsTypeUsesCbm(bulkGoodsTypeForPanel);

  const downloadImportTemplate = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Template Import");
    ws.addRow(IMPORT_HEADERS);
    ws.getRow(1).font = { bold: true };
    ws.addRow(["Pengiriman Udara", "SVC-AIR-001", "jasa", "Udara", "shipment", "5000000", "0", "Udara", "Layanan pengiriman udara internasional", "ya"]);
    ws.addRow(["Pengiriman Laut FCL", "SVC-SEA-001", "jasa", "Laut", "container", "8000000", "0", "Laut", "Full Container Load (FCL)", "ya"]);
    ws.addRow(["Karton Box 40x30x30", "PRD-BOX-001", "barang", "Handling", "pcs", "25000", "100", "Handling", "Karton box tebal double wall", "ya"]);
    ws.columns = IMPORT_HEADERS.map((h, i) => ({ header: h, width: Math.max(h.length + 2, [20, 15, 12, 20, 10, 10, 6, 14, 30, 8][i] ?? 14) }));
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-import-produk.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadDimTemplate = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Template Dimensi");
    ws.addRow(DIM_HEADERS);
    ws.getRow(1).font = { bold: true };
    ws.addRow(["GBA-1KG-001", "1", "30", "20", "15", "general"]);
    ws.addRow(["GBA-5KG-001", "5", "40", "30", "25", "general"]);
    ws.addRow(["BOX-STD-001", "0.5", "25", "15", "10", "general"]);
    ws.columns = DIM_HEADERS.map((h, i) => ({ header: h, width: Math.max(h.length + 2, [18, 12, 14, 12, 12, 16][i] ?? 14) }));
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-dimensi-produk.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseDimFile = async (file: File): Promise<DimRow[]> => {
    const isXlsx = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    if (isXlsx) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("Worksheet tidak ditemukan");
      const headerRow = (ws.getRow(1).values as (string | undefined)[]).slice(1);
      const hdrs = headerRow.map((h) => String(h ?? "").trim().toLowerCase()
        .replace("sku*", "sku").replace("berat (kg)", "berat_kg").replace("panjang (cm)", "panjang_cm")
        .replace("lebar (cm)", "lebar_cm").replace("tinggi (cm)", "tinggi_cm").replace("jenis barang", "jenis_barang")
      );
      const rows: DimRow[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const vals = (row.values as unknown[]).slice(1);
        const obj: Record<string, string> = {};
        hdrs.forEach((h, i) => { obj[h] = String(vals[i] ?? "").trim(); });
        if (!obj.sku) return;
        rows.push({ sku: obj.sku, berat_kg: obj.berat_kg ?? "", panjang_cm: obj.panjang_cm ?? "", lebar_cm: obj.lebar_cm ?? "", tinggi_cm: obj.tinggi_cm ?? "", jenis_barang: obj.jenis_barang ?? "" });
      });
      return rows;
    } else {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error("File kosong atau hanya berisi header");
      const sep = lines[0].includes("\t") ? "\t" : ",";
      const parse = (line: string) => line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
      const hdrs = parse(lines[0]).map((h) => h.toLowerCase()
        .replace("sku*", "sku").replace("berat (kg)", "berat_kg").replace("panjang (cm)", "panjang_cm")
        .replace("lebar (cm)", "lebar_cm").replace("tinggi (cm)", "tinggi_cm").replace("jenis barang", "jenis_barang")
      );
      return lines.slice(1).map((line) => {
        const vals = parse(line);
        const obj: Record<string, string> = {};
        hdrs.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
        return { sku: obj.sku ?? "", berat_kg: obj.berat_kg ?? "", panjang_cm: obj.panjang_cm ?? "", lebar_cm: obj.lebar_cm ?? "", tinggi_cm: obj.tinggi_cm ?? "", jenis_barang: obj.jenis_barang ?? "" };
      }).filter((r) => r.sku);
    }
  };

  const handleDimFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDimError(null);
    setDimResults(null);
    try {
      const rows = await parseDimFile(file);
      if (rows.length === 0) { setDimError("Tidak ada baris data yang ditemukan"); return; }
      if (rows.length > 500) { setDimError("Maksimum 500 baris per import"); return; }
      setDimRows(rows);
    } catch (e) { setDimError(String(e)); }
    e.target.value = "";
  };

  const handleDoDimImport = async () => {
    if (dimRows.length === 0) return;
    setDimLoading(true);
    setDimResults(null);
    try {
      const res = await fetch("/api/ecommerce/products/bulk-update-dimensions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: dimRows }),
      });
      const data = await res.json() as { results?: ImportResult[]; message?: string };
      if (!res.ok) { setDimError(data.message ?? "Terjadi kesalahan pada server"); return; }
      setDimResults(data.results ?? []);
      const success = (data.results ?? []).filter((r) => r.status !== "error").length;
      const errors  = (data.results ?? []).filter((r) => r.status === "error").length;
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
      toast({ title: `Import dimensi selesai: ${success} berhasil, ${errors} gagal` });
    } catch (e) { setDimError(String(e)); }
    finally { setDimLoading(false); }
  };

  const parseImportFile = async (file: File): Promise<ImportRow[]> => {
    const isXlsx = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    if (isXlsx) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("Worksheet tidak ditemukan dalam file Excel");
      const headerRow = ws.getRow(1).values as (string | undefined)[];
      const headers = (Array.isArray(headerRow) ? headerRow : []).slice(1).map((h) => String(h ?? "").trim().toLowerCase()
        .replace("nama produk*", "nama").replace("sku*", "sku").replace("jenis (barang/jasa)*", "tipe")
        .replace("kategori* (pisah ;)", "kategori").replace("satuan*", "satuan").replace("harga*", "harga")
        .replace("stok", "stok").replace("sub-kategori", "subkategori").replace("deskripsi", "deskripsi")
        .replace("aktif (ya/tidak)", "aktif")
      );
      const rows: ImportRow[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const vals = (row.values as unknown[]).slice(1);
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = String(vals[i] ?? "").trim(); });
        if (!obj.nama && !obj.sku) return;
        rows.push({
          nama: obj.nama ?? "", sku: obj.sku ?? "", tipe: obj.tipe ?? "barang",
          kategori: obj.kategori ?? "", satuan: obj.satuan ?? "pcs", harga: obj.harga ?? "0",
          stok: obj.stok ?? "0", subkategori: obj.subkategori ?? "", deskripsi: obj.deskripsi ?? "", aktif: obj.aktif ?? "ya",
        });
      });
      return rows;
    } else {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) throw new Error("File CSV kosong atau hanya berisi header");
      const sep = lines[0].includes("\t") ? "\t" : ",";
      const parse = (line: string) => line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
      const hdrs = parse(lines[0]).map((h) => h.toLowerCase()
        .replace("nama produk*", "nama").replace("sku*", "sku").replace("jenis (barang/jasa)*", "tipe")
        .replace("kategori* (pisah ;)", "kategori").replace("satuan*", "satuan").replace("harga*", "harga")
        .replace("sub-kategori", "subkategori").replace("aktif (ya/tidak)", "aktif")
      );
      return lines.slice(1).map((line) => {
        const vals = parse(line);
        const obj: Record<string, string> = {};
        hdrs.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
        return {
          nama: obj.nama ?? "", sku: obj.sku ?? "", tipe: obj.tipe ?? "barang",
          kategori: obj.kategori ?? "", satuan: obj.satuan ?? "pcs", harga: obj.harga ?? "0",
          stok: obj.stok ?? "0", subkategori: obj.subkategori ?? "", deskripsi: obj.deskripsi ?? "", aktif: obj.aktif ?? "ya",
        };
      }).filter((r) => r.nama || r.sku);
    }
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportResults(null);
    try {
      const rows = await parseImportFile(file);
      if (rows.length === 0) { setImportError("Tidak ada baris data yang ditemukan dalam file"); return; }
      if (rows.length > 500) { setImportError("Maksimum 500 baris per import"); return; }
      setImportRows(rows);
    } catch (e) {
      setImportError(String(e));
    }
    e.target.value = "";
  };

  const handleDoImport = async () => {
    if (importRows.length === 0) return;
    setImporting(true);
    setImportResults(null);
    try {
      const res = await fetch("/api/ecommerce/products/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: importRows }),
      });
      const data = await res.json() as { results?: ImportResult[]; message?: string };
      if (!res.ok) { setImportError(data.message ?? "Terjadi kesalahan pada server"); return; }
      setImportResults(data.results ?? []);
      const success = (data.results ?? []).filter((r) => r.status !== "error").length;
      const errors = (data.results ?? []).filter((r) => r.status === "error").length;
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
      toast({ title: `Import selesai: ${success} berhasil, ${errors} gagal` });
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleUploadMedia = async (files: File[], type: "image" | "video") => {
    setUploading(true);
    try {
      const newItems = await uploadMediaFiles(files, type);
      setForm((f) => {
        const updated = [...f.mediaItems, ...newItems];
        const firstImage = updated.find((m) => m.type === "image");
        return {
          ...f,
          mediaItems: updated,
          imageUrl: firstImage ? firstImage.url : f.imageUrl,
        };
      });
      toast({ title: `${newItems.length} ${type === "image" ? "foto" : "video"} berhasil diunggah` });
    } catch (e) {
      toast({ title: "Gagal mengunggah", description: String(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // Kumpulkan semua sub-kategori unik dari produk yang ada (+ dari API/default)
  const allSubcategories = useMemo(() => {
    const fromProducts = products
      .map((p) => p.subcategory)
      .filter((s): s is string => !!s && s.trim() !== "");
    const merged = Array.from(new Set([...apiSubcats, ...fromProducts]));
    return merged.sort();
  }, [products, apiSubcats]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (filterType !== "all" && p.itemType !== filterType) return false;
      if (filterSubcat !== "all" && p.subcategory !== filterSubcat) return false;
      if (filterActive === "active" && !p.isActive) return false;
      if (filterActive === "inactive" && p.isActive) return false;
      if (search) {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      }
      return true;
    });
  }, [products, filterType, filterSubcat, filterActive, search]);

  const barangCount = filtered.filter((p) => p.itemType === "barang").length;
  const allBarangSelected = barangCount > 0 && filtered.filter((p) => p.itemType === "barang").every((p) => selectedIds.has(p.id));

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setForm(formFromProduct(p));
    setDialogOpen(true);
  };

  const setF = <K extends keyof ItemForm>(key: K, val: ItemForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const skuCheckUrl = dialogOpen && form.sku.trim()
    ? `/api/ecommerce/products/check-sku?sku=${encodeURIComponent(form.sku)}${editingId ? `&excludeId=${editingId}` : ""}`
    : null;
  const { checking: skuChecking, taken: skuTaken } = useCodeCheck(skuCheckUrl, form.sku);

  const validate = (): string | null => {
    if (!form.name.trim()) return "Nama item wajib diisi";
    if (!form.sku.trim()) return "SKU/Kode item wajib diisi";
    if (!form.unit) return "Satuan wajib dipilih";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { toast({ title: t.common.error, variant: "destructive" }); return; }

    const body = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      price: Number(form.price) || 0,
      stock: Number(form.stock) || 0,
      categories: form.categories.length > 0 ? form.categories : (form.subcategory ? [form.subcategory] : []),
      description: form.description || null,
      itemType: form.itemType,
      unit: form.unit,
      unitOptions: form.unitOptions,
      subcategory: form.subcategory || null,
      isActive: form.isActive,
      defaultSalesTaxId: form.defaultSalesTaxId ? Number(form.defaultSalesTaxId) : null,
      defaultPurchaseTaxId: form.defaultPurchaseTaxId ? Number(form.defaultPurchaseTaxId) : null,
      imageUrl: form.imageUrl.trim() || null,
      mediaItems: form.mediaItems.filter((m) => m.url.trim()),
      weightKg:  form.weightKg  !== "" ? Number(form.weightKg)  : null,
      volumeCbm: form.volumeCbm !== "" ? Number(form.volumeCbm) : null,
      lengthCm:  form.lengthCm  !== "" ? Number(form.lengthCm)  : null,
      widthCm:   form.widthCm   !== "" ? Number(form.widthCm)   : null,
      heightCm:  form.heightCm  !== "" ? Number(form.heightCm)  : null,
      goodsType: form.goodsType.trim() || null,
      currencyCode: form.currencyCode || "IDR",
    };

    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: body });
        toast({ title: t.common.success });
      } else {
        await createMut.mutateAsync({ data: body });
        toast({ title: t.common.success });
      }
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
      qc.invalidateQueries({ queryKey: getListProductCategoriesQueryKey() });
      setDialogOpen(false);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(e);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync({ id: deleteTarget.id });
      toast({ title: t.common.success });
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? String(e);
      toast({ title: t.common.error, description: msg, variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleSeedItems = async () => {
    setSeeding(true);
    try {
      const resp = await fetch("/api/ecommerce/seed-items", { method: "POST" });
      const data = await resp.json();
      toast({ title: t.common.success });
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
      qc.invalidateQueries({ queryKey: getListProductCategoriesQueryKey() });
    } catch {
      toast({ title: t.common.error, variant: "destructive" });
    } finally {
      setSeeding(false);
    }
  };

  const taxName = (id: number | null | undefined) => {
    if (!id) return "-";
    const t = taxes.find((x) => x.id === id);
    return t ? `${t.name} (${t.rate}%)` : String(id);
  };

  return (
    <AppShell>
      <BackButton href="/sales" />
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Master Item Penjualan</h1>
            <p className="text-sm text-slate-400 mt-0.5">Kelola barang & jasa untuk Sales Order</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
              onClick={handleSeedItems}
              disabled={seeding}
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${seeding ? "animate-spin" : ""}`} />
              Seed Item Awal
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-emerald-700 text-emerald-400 hover:bg-emerald-900/40"
              onClick={() => { setImportOpen(true); setImportRows([]); setImportResults(null); setImportError(null); }}
            >
              <Upload className="h-4 w-4 mr-1.5" /> Import Excel/CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-orange-700 text-orange-400 hover:bg-orange-900/40"
              onClick={() => { setDimOpen(true); setDimRows([]); setDimResults(null); setDimError(null); }}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Import Dimensi
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-purple-700 text-purple-400 hover:bg-purple-900/40"
              onClick={() => { setScanOpen(true); setScanResult(null); setScanAssign({}); }}
            >
              <ImageIcon className="h-4 w-4 mr-1.5" /> Scan Gambar Storage
            </Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> Tambah Item
            </Button>
          </div>
        </div>

        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex gap-3 flex-wrap items-end">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Cari nama atau SKU..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 bg-slate-900/50 border-slate-600 text-slate-200 placeholder:text-slate-500"
                />
              </div>
              <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
                <SelectTrigger className="w-[140px] bg-slate-900/50 border-slate-600 text-slate-200">
                  <SelectValue placeholder="Jenis" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="all">Semua Jenis</SelectItem>
                  <SelectItem value="barang">Barang</SelectItem>
                  <SelectItem value="jasa">Jasa</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterSubcat} onValueChange={setFilterSubcat}>
                <SelectTrigger className="w-[180px] bg-slate-900/50 border-slate-600 text-slate-200">
                  <SelectValue placeholder="Sub-kategori" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="all">Semua Sub-kategori</SelectItem>
                  {allSubcategories.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterActive} onValueChange={(v) => setFilterActive(v as typeof filterActive)}>
                <SelectTrigger className="w-[130px] bg-slate-900/50 border-slate-600 text-slate-200">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="inactive">Nonaktif</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ── Bulk Edit Panel ─────────────────────────────────── */}
        {selectedIds.size > 0 && (
          <div className="rounded-lg border border-blue-700/60 bg-blue-950/40 p-4 space-y-3 shadow-lg">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-blue-300 font-medium text-sm">
                <ListChecks className="h-4 w-4" />
                <span>{selectedIds.size} item dipilih</span>
                <span className="text-blue-500 text-xs">(hanya barang yang bisa dipilih)</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-200 h-7 gap-1"
                onClick={cancelBulkEdit}
              >
                <X className="h-3.5 w-3.5" /> Batal (Esc)
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 items-end">
              {/* Jenis Barang */}
              <div className="space-y-1 col-span-1">
                <p className="text-xs text-slate-400 font-medium">Jenis Barang</p>
                <select
                  className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5 focus:border-blue-500 outline-none"
                  value={bulkFields.goodsType}
                  onChange={(e) => setBF("goodsType", e.target.value)}
                >
                  <option value="">— tidak diubah —</option>
                  {GOODS_TYPES.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>

              {/* Berat (kg) — tampil jika goodsType bukan CBM type atau goodsType belum dipilih */}
              {showWeightInPanel && (
                <div className="space-y-1 col-span-1">
                  <p className="text-xs text-slate-400 font-medium">
                    Berat (kg)
                    {bulkGoodsTypeForPanel === "" && <span className="text-slate-600 ml-1 text-[10px]">opsional</span>}
                  </p>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="kosong = abaikan"
                    className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5 focus:border-blue-500 outline-none placeholder:text-slate-600"
                    value={bulkFields.weightKg}
                    onChange={(e) => setBF("weightKg", e.target.value)}
                  />
                </div>
              )}

              {/* CBM (m³) — tampil jika goodsType adalah CBM type atau goodsType belum dipilih */}
              {showCbmInPanel && (
                <div className="space-y-1 col-span-1">
                  <p className="text-xs text-slate-400 font-medium">
                    CBM (m³)
                    {bulkGoodsTypeForPanel === "" && <span className="text-slate-600 ml-1 text-[10px]">opsional</span>}
                  </p>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    placeholder="kosong = abaikan"
                    className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5 focus:border-blue-500 outline-none placeholder:text-slate-600"
                    value={bulkFields.volumeCbm}
                    onChange={(e) => setBF("volumeCbm", e.target.value)}
                  />
                </div>
              )}

              {/* Dimensi L × W × H */}
              <div className="space-y-1 col-span-1">
                <p className="text-xs text-slate-400 font-medium">Panjang (cm)</p>
                <input
                  type="number" step="0.1" min="0" placeholder="kosong = abaikan"
                  className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5 focus:border-blue-500 outline-none placeholder:text-slate-600"
                  value={bulkFields.lengthCm}
                  onChange={(e) => setBF("lengthCm", e.target.value)}
                />
              </div>
              <div className="space-y-1 col-span-1">
                <p className="text-xs text-slate-400 font-medium">Lebar (cm)</p>
                <input
                  type="number" step="0.1" min="0" placeholder="kosong = abaikan"
                  className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5 focus:border-blue-500 outline-none placeholder:text-slate-600"
                  value={bulkFields.widthCm}
                  onChange={(e) => setBF("widthCm", e.target.value)}
                />
              </div>
              <div className="space-y-1 col-span-1">
                <p className="text-xs text-slate-400 font-medium">Tinggi (cm)</p>
                <input
                  type="number" step="0.1" min="0" placeholder="kosong = abaikan"
                  className="w-full rounded border border-slate-600 bg-slate-900 text-slate-100 text-xs px-2 py-1.5 focus:border-blue-500 outline-none placeholder:text-slate-600"
                  value={bulkFields.heightCm}
                  onChange={(e) => setBF("heightCm", e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1 border-t border-blue-800/40">
              <p className="text-xs text-slate-500">
                Field yang kosong tidak akan diubah. Perubahan berlaku ke semua {selectedIds.size} item yang dipilih.
              </p>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 gap-1.5 shrink-0"
                onClick={handleBulkSave}
                disabled={bulkSavingIds.size > 0}
              >
                {bulkSavingIds.size > 0
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Menyimpan…</>
                  : <><Save className="h-3.5 w-3.5" /> Terapkan ke {selectedIds.size} item</>
                }
              </Button>
            </div>
          </div>
        )}

        <Card className="bg-slate-800/60 border-slate-700">
          <CardContent className="p-0">
            <QueryState
              loading={isLoading}
              empty={!isLoading && filtered.length === 0}
              emptyMessage={products.length === 0 ? 'Belum ada item. Klik "Seed Item Awal" untuk mengisi contoh data.' : "Tidak ada item yang cocok dengan filter."}
              skeletonRows={5}
              skeletonRowClassName="h-10 bg-slate-700/50"
              className="p-6"
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="w-8 text-slate-400">
                        <button
                          type="button"
                          title={allBarangSelected ? "Batalkan pilih semua" : "Pilih semua barang"}
                          className="flex items-center justify-center text-slate-400 hover:text-blue-300 transition-colors"
                          onClick={toggleSelectAll}
                        >
                          {allBarangSelected
                            ? <CheckSquare2 className="h-4 w-4 text-blue-400" />
                            : <Square className="h-4 w-4" />
                          }
                        </button>
                      </TableHead>
                      <TableHead className="text-slate-400">Nama Item</TableHead>
                      <TableHead className="text-slate-400">SKU</TableHead>
                      <TableHead className="text-slate-400">Jenis</TableHead>
                      <TableHead className="text-slate-400">Sub-kategori</TableHead>
                      <TableHead className="text-slate-400">Satuan</TableHead>
                      <TableHead className="text-slate-400 text-right">Stok</TableHead>
                      <TableHead className="text-slate-400 text-right">Harga Jual</TableHead>
                      <TableHead className="text-slate-400">Pajak Jual</TableHead>
                      <TableHead className="text-slate-400">Jenis Barang</TableHead>
                      <TableHead className="text-slate-400">Berat / CBM</TableHead>
                      <TableHead className="text-slate-400">Dimensi L×W×H (cm)</TableHead>
                      <TableHead className="text-slate-400">Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => {
                      const isRowSaving = bulkSavingIds.has(p.id) || inlineSaving.has(p.id);
                      const isSelected = selectedIds.has(p.id);
                      return (
                      <TableRow
                        key={p.id}
                        className={`border-slate-700/50 transition-colors ${isSelected ? "bg-blue-950/30 hover:bg-blue-950/40" : ""} ${isRowSaving ? "opacity-60" : ""}`}
                      >
                        {/* Checkbox */}
                        <TableCell className="w-8 py-2">
                          {p.itemType === "barang" ? (
                            <button
                              type="button"
                              className="flex items-center justify-center text-slate-400 hover:text-blue-300 transition-colors"
                              onClick={() => toggleRowSelect(p.id)}
                              disabled={isRowSaving}
                            >
                              {bulkSavingIds.has(p.id)
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                                : isSelected
                                  ? <CheckSquare2 className="h-3.5 w-3.5 text-blue-400" />
                                  : <Square className="h-3.5 w-3.5" />
                              }
                            </button>
                          ) : (
                            <span className="block w-3.5 h-3.5" />
                          )}
                        </TableCell>
                        <TableCell className="text-slate-200 font-medium">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              title="Klik untuk upload gambar"
                              className="relative group shrink-0 h-8 w-8 rounded overflow-hidden border border-slate-700 focus:outline-none"
                              onClick={() => { setInlineImgTarget(p); inlineImgRef.current?.click(); }}
                              disabled={inlineImgUploading.has(p.id)}
                            >
                              {inlineImgUploading.has(p.id) ? (
                                <div className="h-8 w-8 flex items-center justify-center bg-slate-800">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                                </div>
                              ) : p.imageUrl ? (
                                <>
                                  <img
                                    src={resolveMediaUrl(p.imageUrl)}
                                    alt={p.name}
                                    className="h-8 w-8 object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                    <ImageIcon className="h-3 w-3 text-white" />
                                  </div>
                                </>
                              ) : (
                                <div className="h-8 w-8 flex items-center justify-center bg-slate-800 group-hover:bg-slate-700 transition-colors">
                                  {p.itemType === "jasa"
                                    ? <Wrench className="h-3.5 w-3.5 text-blue-400" />
                                    : <ImageIcon className="h-3 w-3 text-slate-500 group-hover:text-amber-400 transition-colors" />
                                  }
                                </div>
                              )}
                            </button>
                            {p.name}
                          </div>
                          {p.description && (
                            <p className="text-xs text-slate-500 mt-0.5 max-w-[220px] truncate">{p.description}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-400 text-xs font-mono">{p.sku}</TableCell>
                        <TableCell>
                          {p.itemType === "jasa" ? (
                            <Badge className="bg-blue-900/40 text-blue-300 border-blue-700 text-xs">Jasa</Badge>
                          ) : (
                            <Badge className="bg-amber-900/40 text-amber-300 border-amber-700 text-xs">Barang</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">{p.subcategory ?? "-"}</TableCell>
                        <TableCell className="text-slate-400 text-sm">
                          <div className="flex flex-wrap gap-1 items-center">
                            <span>{p.unit}</span>
                            {p.itemType === "barang" && Array.isArray(p.unitOptions) && (p.unitOptions ?? []).length > 0 && (
                              (p.unitOptions ?? []).filter((u) => u !== p.unit).map((u) => (
                                <Badge key={u} className="text-[9px] px-1 py-0 h-4 bg-slate-700 text-slate-300 border-slate-600">{u}</Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-300">
                          {p.itemType === "barang"
                            ? <span className={(p.stock ?? 0) === 0 ? "text-red-400" : ""}>
                                {p.stock ?? 0}
                              </span>
                            : <span className="text-slate-500 text-xs">—</span>
                          }
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-300">
                          {p.price > 0 ? (
                            <div>
                              <div>{idr(p.price)}</div>
                              <div className="text-[11px] text-slate-500 font-normal">≈ {usd(p.price / usdIdrRate)}</div>
                            </div>
                          ) : (
                            <span className="text-slate-500 text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-400 text-xs">{taxName(p.defaultSalesTaxId)}</TableCell>
                        {/* Jenis Barang — inline editable */}
                        <TableCell className="text-slate-300 text-xs min-w-[110px]">
                          {p.itemType === "barang" ? (
                            inlineEdit?.rowId === p.id && inlineEdit.field === "goodsType" ? (
                              <select
                                autoFocus
                                className="w-full rounded border border-blue-500 bg-slate-900 text-slate-100 text-xs px-1 py-0.5"
                                value={inlineEdit.value}
                                onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                                onBlur={(e) => saveInlineEdit(p, "goodsType", e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLSelectElement).blur();
                                  if (e.key === "Escape") setInlineEdit(null);
                                }}
                              >
                                <option value="">— pilih —</option>
                                {GOODS_TYPES.map((g) => (
                                  <option key={g.value} value={g.value}>{g.label}</option>
                                ))}
                              </select>
                            ) : (
                              <span
                                className="cursor-pointer hover:text-blue-300 hover:underline"
                                title="Klik untuk edit"
                                onClick={() => setInlineEdit({ rowId: p.id, field: "goodsType", value: p.goodsType ?? "" })}
                              >
                                {inlineSaving.has(p.id) ? <Loader2 className="h-3 w-3 animate-spin inline" /> : (p.goodsType || <span className="text-slate-600 italic">— klik edit</span>)}
                              </span>
                            )
                          ) : <span className="text-slate-600">—</span>}
                        </TableCell>

                        {/* Berat / CBM — conditional based on goodsType */}
                        <TableCell className="text-slate-300 text-xs min-w-[90px]">
                          {p.itemType === "barang" ? (() => {
                            const isKapas = p.goodsType === "kapas";
                            const field: InlineEdit["field"] = isKapas ? "volumeCbm" : "weightKg";
                            const currentVal = isKapas ? (p.volumeCbm ?? null) : (p.weightKg ?? null);
                            const unit = isKapas ? "m³" : "kg";
                            const isEditing = inlineEdit?.rowId === p.id && inlineEdit.field === field;
                            return isEditing ? (
                              <input
                                autoFocus
                                type="number"
                                step="0.001"
                                min="0"
                                className="w-20 rounded border border-blue-500 bg-slate-900 text-slate-100 text-xs px-1 py-0.5"
                                value={inlineEdit.value}
                                onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                                onBlur={(e) => saveInlineEdit(p, field, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  if (e.key === "Escape") setInlineEdit(null);
                                }}
                              />
                            ) : (
                              <span
                                className="cursor-pointer hover:text-emerald-300 hover:underline"
                                title="Klik untuk edit"
                                onClick={() => setInlineEdit({ rowId: p.id, field, value: currentVal != null ? String(currentVal) : "" })}
                              >
                                {inlineSaving.has(p.id) ? <Loader2 className="h-3 w-3 animate-spin inline" /> : (
                                  currentVal != null
                                    ? <span className="text-emerald-400 font-medium">{Number(currentVal)} {unit}</span>
                                    : <span className="text-slate-600 italic">— klik edit</span>
                                )}
                              </span>
                            );
                          })() : <span className="text-slate-600">—</span>}
                        </TableCell>

                        {/* Dimensi L×W×H — always editable for barang */}
                        <TableCell className="text-slate-300 text-xs min-w-[160px]">
                          {p.itemType === "barang" ? (
                            <div className="flex items-center gap-1">
                              {(["lengthCm", "widthCm", "heightCm"] as const).map((dim, idx) => {
                                const val = p[dim] as number | null | undefined;
                                const isEditing = inlineEdit?.rowId === p.id && inlineEdit.field === dim;
                                return (
                                  <span key={dim} className="flex items-center gap-0.5">
                                    {idx > 0 && <span className="text-slate-600">×</span>}
                                    {isEditing ? (
                                      <input
                                        autoFocus
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        className="w-14 rounded border border-blue-500 bg-slate-900 text-slate-100 text-xs px-1 py-0.5"
                                        value={inlineEdit.value}
                                        onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                                        onBlur={(e) => saveInlineEdit(p, dim, e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                          if (e.key === "Escape") setInlineEdit(null);
                                        }}
                                      />
                                    ) : (
                                      <span
                                        className="cursor-pointer hover:text-blue-300 hover:underline"
                                        title="Klik untuk edit"
                                        onClick={() => setInlineEdit({ rowId: p.id, field: dim, value: val != null ? String(val) : "" })}
                                      >
                                        {val != null ? Number(val) : <span className="text-slate-600">?</span>}
                                      </span>
                                    )}
                                  </span>
                                );
                              })}
                              <span className="text-slate-500 text-[10px] ml-0.5">cm</span>
                            </div>
                          ) : <span className="text-slate-600">—</span>}
                        </TableCell>
                        <TableCell>
                          {p.isActive ? (
                            <Badge className="bg-green-900/40 text-green-300 border-green-700 text-xs">Aktif</Badge>
                          ) : (
                            <Badge className="bg-slate-700/60 text-slate-400 border-slate-600 text-xs">Nonaktif</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-slate-400 hover:text-slate-200"
                              onClick={() => openEdit(p)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-slate-400 hover:text-red-400"
                              onClick={() => setDeleteTarget(p)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Item" : "Tambah Item Baru"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Nama Item *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setF("name", e.target.value)}
                  placeholder="Nama item"
                  className="bg-slate-800 border-slate-600 text-slate-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">SKU / Kode Item *</Label>
                <Input
                  value={form.sku}
                  onChange={(e) => setF("sku", e.target.value)}
                  placeholder="SVC-001"
                  className={`bg-slate-800 border-slate-600 text-slate-200${skuTaken === true ? " border-destructive" : ""}`}
                />
                <CodeCheckIndicator checking={skuChecking} taken={skuTaken} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Jenis Item *</Label>
                <Select value={form.itemType} onValueChange={(v) => setF("itemType", v as "barang" | "jasa")}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="barang">Barang</SelectItem>
                    <SelectItem value="jasa">Jasa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">
                  Jenis / Sub-kategori
                  <span className="ml-1 text-xs font-normal text-slate-500">(bebas ketik atau pilih)</span>
                </Label>
                <datalist id="subcat-list">
                  {allSubcategories.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <Input
                  list="subcat-list"
                  value={form.subcategory}
                  onChange={(e) => setF("subcategory", e.target.value)}
                  placeholder="cth: Ekspedisi Khusus, Cold Chain…"
                  className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
                />
                {form.subcategory && !apiSubcats.includes(form.subcategory) && (
                  <p className="text-xs text-blue-400 flex items-center gap-1 mt-0.5">
                    <Plus className="h-3 w-3" /> Jenis baru: <strong>{form.subcategory}</strong>
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Mata Uang</Label>
                <Select value={form.currencyCode} onValueChange={(v) => setF("currencyCode", v)}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Harga Jual Default</Label>
                <Input
                  type="number"
                  value={form.price}
                  onChange={(e) => setF("price", e.target.value)}
                  placeholder="0"
                  className="bg-slate-800 border-slate-600 text-slate-200"
                />
              </div>
              {form.itemType === "barang" && (
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-slate-300">Stok</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.stock}
                    onChange={(e) => setF("stock", e.target.value)}
                    placeholder="0"
                    className="bg-slate-800 border-slate-600 text-slate-200"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300">Satuan Default *</Label>
              <Select value={form.unit} onValueChange={(v) => setF("unit", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Unit Options — multi-pilih untuk customer portal */}
            {form.itemType === "barang" && (
              <div className="space-y-2">
                <Label className="text-slate-300">
                  Pilihan Satuan untuk Pelanggan
                  <span className="ml-1 text-xs font-normal text-slate-500">(tampil di portal saat pemesanan)</span>
                </Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-slate-800/80 border border-slate-600">
                  {UNITS.map((u) => {
                    const checked = form.unitOptions.includes(u);
                    return (
                      <button
                        key={u}
                        type="button"
                        onClick={() => {
                          setF("unitOptions", checked
                            ? form.unitOptions.filter((x) => x !== u)
                            : [...form.unitOptions, u]
                          );
                        }}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                          checked
                            ? "bg-blue-600 border-blue-500 text-white"
                            : "bg-slate-700 border-slate-600 text-slate-400 hover:border-slate-400"
                        }`}
                      >
                        {u}
                      </button>
                    );
                  })}
                </div>
                {form.unitOptions.length > 0 && (
                  <p className="text-xs text-slate-500">
                    Terpilih: <span className="text-slate-300">{form.unitOptions.join(", ")}</span>
                    {!form.unitOptions.includes(form.unit) && form.unit && (
                      <span className="text-amber-400 ml-1">— Satuan default ({form.unit}) akan ditambahkan otomatis</span>
                    )}
                  </p>
                )}
              </div>
            )}

            {/* Berat & Dimensi (untuk kalkulator ongkir otomatis) */}
            {form.itemType === "barang" && (
              <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Dimensi & Berat (Otomatis Ongkir)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-slate-300 text-sm">Berat (kg)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={form.weightKg}
                      onChange={(e) => setF("weightKg", e.target.value)}
                      placeholder="cth: 1.5"
                      className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300 text-sm">Jenis Barang</Label>
                    <Input
                      value={form.goodsType}
                      onChange={(e) => setF("goodsType", e.target.value)}
                      placeholder="cth: Elektronik, Furnitur…"
                      className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-slate-300 text-sm">Panjang (cm)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.lengthCm}
                      onChange={(e) => setF("lengthCm", e.target.value)}
                      placeholder="P"
                      className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300 text-sm">Lebar (cm)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.widthCm}
                      onChange={(e) => setF("widthCm", e.target.value)}
                      placeholder="L"
                      className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-slate-300 text-sm">Tinggi (cm)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.heightCm}
                      onChange={(e) => setF("heightCm", e.target.value)}
                      placeholder="T"
                      className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Pajak Jual Default</Label>
                <Select
                  value={form.defaultSalesTaxId || "__none"}
                  onValueChange={(v) => setF("defaultSalesTaxId", v === "__none" ? "" : v)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200">
                    <SelectValue placeholder="Pilih pajak" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="__none">— Tidak ada —</SelectItem>
                    {taxes.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.rate}%)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Pajak Beli Default</Label>
                <Select
                  value={form.defaultPurchaseTaxId || "__none"}
                  onValueChange={(v) => setF("defaultPurchaseTaxId", v === "__none" ? "" : v)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200">
                    <SelectValue placeholder="Pilih pajak" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="__none">— Tidak ada —</SelectItem>
                    {taxes.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.rate}%)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setF("isActive", v)}
                id="item-active"
              />
              <Label htmlFor="item-active" className="text-slate-300 cursor-pointer">
                {form.isActive ? "Aktif" : "Nonaktif"}
              </Label>
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300">Deskripsi</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setF("description", e.target.value)}
                placeholder="Deskripsi item (opsional)"
                className="bg-slate-800 border-slate-600 text-slate-200 min-h-[70px]"
              />
            </div>

            {/* Gambar / Media */}
            <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/40 p-3">
              <Label className="text-slate-300 flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
                Foto &amp; Video Produk
                <span className="text-xs font-normal text-slate-500 ml-1">(tampil di Website Publik)</span>
              </Label>

              {/* Hidden file inputs */}
              <input ref={imgRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" multiple className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) void handleUploadMedia(files, "image");
                  e.target.value = "";
                }}
              />
              <input ref={vidRef} type="file" accept="video/*" className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) void handleUploadMedia(files, "video");
                  e.target.value = "";
                }}
              />

              {/* Media grid */}
              {form.mediaItems.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {form.mediaItems.map((m, idx) => (
                    <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-slate-600 bg-slate-900 group">
                      {m.type === "video" ? (
                        <div className="w-full h-full flex items-center justify-center bg-slate-800">
                          <Video className="h-7 w-7 text-slate-400" />
                        </div>
                      ) : (
                        <img
                          src={resolveMediaUrl(m.url)}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const updated = form.mediaItems.filter((_, i) => i !== idx);
                          const firstImage = updated.find((x) => x.type === "image");
                          setForm((f) => ({
                            ...f,
                            mediaItems: updated,
                            imageUrl: firstImage ? firstImage.url : (updated.length === 0 ? "" : f.imageUrl),
                          }));
                        }}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      {idx === 0 && (
                        <span className="absolute bottom-1 left-1 bg-blue-600 text-white text-[9px] px-1 rounded">Cover</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border-2 border-dashed border-slate-600 h-24 flex flex-col items-center justify-center text-slate-500 gap-1.5">
                  <ImageIcon className="h-6 w-6" />
                  <span className="text-xs">Belum ada media</span>
                </div>
              )}

              {/* Upload buttons */}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm"
                  className="gap-1.5 flex-1 border-slate-600 text-slate-300 hover:bg-slate-700"
                  disabled={uploading}
                  onClick={() => imgRef.current?.click()}
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  Tambah Foto
                </Button>
                <Button type="button" variant="outline" size="sm"
                  className="gap-1.5 flex-1 border-slate-600 text-slate-300 hover:bg-slate-700"
                  disabled={uploading}
                  onClick={() => vidRef.current?.click()}
                >
                  <Video className="h-3.5 w-3.5" />
                  Tambah Video
                </Button>
              </div>
              <p className="text-xs text-slate-500">Foto pertama jadi cover. Format: JPG, PNG, WEBP. Maks. 5MB per file.</p>

              {/* URL alternatif */}
              <details className="group" open={!!form.imageUrl && form.mediaItems.length === 0}>
                <summary className="text-xs cursor-pointer hover:text-slate-300 transition-colors list-none">
                  <span className="text-blue-400 underline-offset-2 hover:underline">atau masukkan URL gambar secara manual</span>
                </summary>
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={form.imageUrl}
                      onChange={(e) => setF("imageUrl", e.target.value)}
                      onBlur={(e) => {
                        const url = e.target.value.trim();
                        if (url) {
                          try { new URL(url); }
                          catch { toast({ title: "URL gambar tidak valid", description: "Masukkan URL lengkap diawali https://", variant: "destructive" }); }
                        }
                      }}
                      placeholder="https://example.com/gambar.jpg"
                      className="bg-slate-900 border-slate-600 text-slate-200 text-sm placeholder:text-slate-500 flex-1"
                    />
                    {form.imageUrl && (
                      <img
                        src={resolveMediaUrl(form.imageUrl)}
                        alt="preview"
                        className="h-9 w-9 rounded object-cover border border-slate-600 shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {form.mediaItems.filter((m) => !m.url.startsWith("/api/storage")).map((item, rawIdx) => {
                      const realIdx = form.mediaItems.indexOf(item);
                      return (
                        <div key={rawIdx} className="flex items-center gap-2">
                          <select
                            value={item.type}
                            onChange={(e) => {
                              const updated = [...form.mediaItems];
                              updated[realIdx] = { ...updated[realIdx], type: e.target.value as "image" | "video" };
                              setF("mediaItems", updated);
                            }}
                            className="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1.5 shrink-0"
                          >
                            <option value="image">Gambar</option>
                            <option value="video">Video</option>
                          </select>
                          <Input
                            value={item.url}
                            onChange={(e) => {
                              const updated = [...form.mediaItems];
                              updated[realIdx] = { ...updated[realIdx], url: e.target.value };
                              setF("mediaItems", updated);
                            }}
                            placeholder="https://..."
                            className="bg-slate-900 border-slate-600 text-slate-200 text-sm placeholder:text-slate-500 flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => setF("mediaItems", form.mediaItems.filter((_, i) => i !== realIdx))}
                            className="text-slate-500 hover:text-red-400 transition-colors shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setF("mediaItems", [...form.mediaItems, { type: "image", url: "" }])}
                      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah URL media
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-slate-600 text-slate-300">
              Batal
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMut.isPending || updateMut.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {(createMut.isPending || updateMut.isPending) ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Item?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Item <strong className="text-slate-200">{deleteTarget?.name}</strong> akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-600 text-slate-300 bg-slate-800">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white">
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={importOpen} onOpenChange={(o) => { if (!importing) setImportOpen(o); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
              Import Produk dari Excel / CSV
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-slate-400">
                Upload file <span className="text-slate-200 font-medium">.xlsx</span> atau <span className="text-slate-200 font-medium">.csv</span> sesuai format template.
                SKU yang sudah ada akan di-<em>update</em>, SKU baru akan dibuat.
              </p>
              <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 shrink-0" onClick={downloadImportTemplate}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Unduh Template
              </Button>
            </div>

            <div
              className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-emerald-600 transition-colors"
              onClick={() => importFileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); if (importFileRef.current) { importFileRef.current.files = dt.files; handleImportFileChange({ target: importFileRef.current } as React.ChangeEvent<HTMLInputElement>); } } }}
            >
              <Upload className="h-8 w-8 text-slate-500 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Klik atau seret file ke sini</p>
              <p className="text-xs text-slate-500 mt-1">Format: .xlsx, .xls, .csv — Maks. 500 baris</p>
              <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleImportFileChange} />
            </div>

            {importError && (
              <div className="flex items-start gap-2 p-3 rounded bg-red-900/30 border border-red-700 text-red-300 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {importError}
              </div>
            )}

            {importRows.length > 0 && !importResults && (
              <div className="space-y-2">
                <p className="text-sm text-slate-300 font-medium">{importRows.length} baris siap diimport — pratinjau:</p>
                <div className="overflow-x-auto rounded border border-slate-700">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-slate-400 font-medium">#</th>
                        {IMPORT_COLS.map((c) => (
                          <th key={c} className="px-2 py-1.5 text-left text-slate-400 font-medium whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 10).map((row, i) => (
                        <tr key={i} className="border-t border-slate-700/60 even:bg-slate-800/30">
                          <td className="px-2 py-1 text-slate-500">{i + 1}</td>
                          {IMPORT_COLS.map((c) => (
                            <td key={c} className="px-2 py-1 text-slate-300 max-w-[120px] truncate" title={row[c]}>{row[c] || <span className="text-slate-600">—</span>}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importRows.length > 10 && (
                    <p className="text-xs text-slate-500 px-2 py-1.5 border-t border-slate-700">... dan {importRows.length - 10} baris lainnya</p>
                  )}
                </div>
              </div>
            )}

            {importResults && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-300">Hasil Import:</p>
                <div className="flex gap-3 text-xs mb-2">
                  <span className="text-emerald-400">{importResults.filter((r) => r.status === "created").length} dibuat</span>
                  <span className="text-blue-400">{importResults.filter((r) => r.status === "updated").length} diperbarui</span>
                  <span className="text-red-400">{importResults.filter((r) => r.status === "error").length} gagal</span>
                </div>
                <div className="overflow-x-auto rounded border border-slate-700 max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-slate-400">Baris</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">SKU</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Nama</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Status</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResults.map((r, i) => (
                        <tr key={i} className="border-t border-slate-700/60 even:bg-slate-800/30">
                          <td className="px-2 py-1 text-slate-400">{r.row}</td>
                          <td className="px-2 py-1 text-slate-300 font-mono">{r.sku ?? "—"}</td>
                          <td className="px-2 py-1 text-slate-300">{r.name ?? "—"}</td>
                          <td className="px-2 py-1">
                            {r.status === "created" && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Dibuat</span>}
                            {r.status === "updated" && <span className="flex items-center gap-1 text-blue-400"><CheckCircle2 className="h-3 w-3" /> Diperbarui</span>}
                            {r.status === "error" && <span className="flex items-center gap-1 text-red-400"><AlertCircle className="h-3 w-3" /> Gagal</span>}
                          </td>
                          <td className="px-2 py-1 text-slate-400">{r.message ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-slate-700 mt-2">
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing} className="border-slate-600 text-slate-300">
              {importResults ? "Tutup" : "Batal"}
            </Button>
            {importRows.length > 0 && !importResults && (
              <Button onClick={handleDoImport} disabled={importing} className="bg-emerald-700 hover:bg-emerald-600">
                {importing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Mengimport...</> : <><Upload className="h-4 w-4 mr-1.5" /> Import {importRows.length} Baris</>}
              </Button>
            )}
            {importResults && (
              <Button variant="outline" onClick={() => { setImportRows([]); setImportResults(null); setImportError(null); }} className="border-slate-600 text-slate-300">
                Import Lagi
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dimOpen} onOpenChange={(o) => { if (!dimLoading) setDimOpen(o); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-orange-400" />
              Import Berat &amp; Dimensi Produk
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-slate-400">
                Update berat &amp; dimensi produk berdasarkan <span className="text-slate-200 font-medium">SKU</span>.
                Kolom yang kosong tidak akan diubah.
              </p>
              <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 shrink-0" onClick={downloadDimTemplate}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Unduh Template
              </Button>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-3 text-xs text-slate-400 space-y-1">
              <p className="font-medium text-slate-300">Kolom CSV/Excel:</p>
              <p><span className="text-orange-300 font-mono">sku*</span> — SKU produk (wajib, harus sudah terdaftar)</p>
              <p><span className="text-orange-300 font-mono">berat_kg</span> — Berat per unit (kg), mis: <span className="font-mono">1.5</span></p>
              <p><span className="text-orange-300 font-mono">panjang_cm / lebar_cm / tinggi_cm</span> — Dimensi kemasan (cm)</p>
              <p><span className="text-orange-300 font-mono">jenis_barang</span> — Jenis kargo, mis: <span className="font-mono">general</span>, <span className="font-mono">fragile</span>, <span className="font-mono">frozen</span></p>
            </div>

            <div
              className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-orange-600 transition-colors"
              onClick={() => dimFileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); if (dimFileRef.current) { dimFileRef.current.files = dt.files; handleDimFileChange({ target: dimFileRef.current } as React.ChangeEvent<HTMLInputElement>); } } }}
            >
              <Upload className="h-8 w-8 text-slate-500 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Klik atau seret file ke sini</p>
              <p className="text-xs text-slate-500 mt-1">Format: .xlsx, .xls, .csv — Maks. 500 baris</p>
              <input ref={dimFileRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleDimFileChange} />
            </div>

            {dimError && (
              <div className="flex items-start gap-2 p-3 rounded bg-red-900/30 border border-red-700 text-red-300 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {dimError}
              </div>
            )}

            {dimRows.length > 0 && !dimResults && (
              <div className="space-y-2">
                <p className="text-sm text-slate-300 font-medium">{dimRows.length} baris siap diimport — pratinjau:</p>
                <div className="overflow-x-auto rounded border border-slate-700">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-slate-400">#</th>
                        {DIM_COLS.map((c) => (
                          <th key={c} className="px-2 py-1.5 text-left text-slate-400 font-medium whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dimRows.slice(0, 10).map((row, i) => (
                        <tr key={i} className="border-t border-slate-700/60 even:bg-slate-800/30">
                          <td className="px-2 py-1 text-slate-500">{i + 1}</td>
                          {DIM_COLS.map((c) => (
                            <td key={c} className="px-2 py-1 text-slate-300 max-w-[100px] truncate" title={row[c]}>{row[c] || <span className="text-slate-600">—</span>}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {dimRows.length > 10 && (
                    <p className="text-xs text-slate-500 px-2 py-1.5 border-t border-slate-700">... dan {dimRows.length - 10} baris lainnya</p>
                  )}
                </div>
              </div>
            )}

            {dimResults && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-300">Hasil Import Dimensi:</p>
                <div className="flex gap-3 text-xs mb-2">
                  <span className="text-blue-400">{dimResults.filter((r) => r.status === "updated").length} diperbarui</span>
                  <span className="text-red-400">{dimResults.filter((r) => r.status === "error").length} gagal</span>
                </div>
                <div className="overflow-x-auto rounded border border-slate-700 max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-slate-400">Baris</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">SKU</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Nama</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Status</th>
                        <th className="px-2 py-1.5 text-left text-slate-400">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dimResults.map((r, i) => (
                        <tr key={i} className="border-t border-slate-700/60 even:bg-slate-800/30">
                          <td className="px-2 py-1 text-slate-400">{r.row}</td>
                          <td className="px-2 py-1 text-slate-300 font-mono">{r.sku ?? "—"}</td>
                          <td className="px-2 py-1 text-slate-300">{r.name ?? "—"}</td>
                          <td className="px-2 py-1">
                            {r.status === "updated" && <span className="flex items-center gap-1 text-blue-400"><CheckCircle2 className="h-3 w-3" /> Diperbarui</span>}
                            {r.status === "error" && <span className="flex items-center gap-1 text-red-400"><AlertCircle className="h-3 w-3" /> Gagal</span>}
                          </td>
                          <td className="px-2 py-1 text-slate-400">{r.message ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-slate-700 mt-2">
            <Button variant="outline" onClick={() => setDimOpen(false)} disabled={dimLoading} className="border-slate-600 text-slate-300">
              {dimResults ? "Tutup" : "Batal"}
            </Button>
            {dimRows.length > 0 && !dimResults && (
              <Button onClick={handleDoDimImport} disabled={dimLoading} className="bg-orange-700 hover:bg-orange-600">
                {dimLoading ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Mengimport...</> : <><Upload className="h-4 w-4 mr-1.5" /> Update {dimRows.length} Produk</>}
              </Button>
            )}
            {dimResults && (
              <Button variant="outline" onClick={() => { setDimRows([]); setDimResults(null); setDimError(null); }} className="border-slate-600 text-slate-300">
                Import Lagi
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Hidden inline image file input */}
      <input
        ref={inlineImgRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && inlineImgTarget) void handleInlineImageUpload(file, inlineImgTarget);
          e.target.value = "";
        }}
      />

      {/* Scan Storage Modal */}
      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-purple-400" />
              Scan &amp; Pulihkan Gambar dari Storage
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-400">
              Scan file gambar di Supabase storage dan cocokkan dengan produk yang belum punya gambar.
            </p>

            {!scanResult && (
              <Button
                onClick={handleScanStorage}
                disabled={scanLoading}
                className="gap-2 bg-purple-700 hover:bg-purple-600"
              >
                {scanLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Scanning...</> : <><ImageIcon className="h-4 w-4" /> Mulai Scan</>}
              </Button>
            )}

            {scanResult && (
              <div className="space-y-4">
                <div className="flex gap-4 text-sm">
                  <span className="text-slate-300">File ditemukan: <strong className="text-purple-300">{scanResult.files}</strong></span>
                  <span className="text-slate-300">Cocok otomatis: <strong className="text-green-400">{scanResult.matched.length}</strong></span>
                </div>

                {/* Products without images — assign manually */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-300">Assign Gambar ke Produk:</p>
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {products.filter((p) => !p.imageUrl).map((p) => (
                      <div key={p.id} className="flex items-center gap-3 p-2 rounded bg-slate-800 border border-slate-700">
                        <div className="shrink-0 h-10 w-10 rounded border border-slate-600 overflow-hidden bg-slate-900 flex items-center justify-center">
                          {scanAssign[p.id] ? (
                            <img src={resolveMediaUrl(scanAssign[p.id])} alt="" className="h-10 w-10 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-slate-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-200 font-medium truncate">{p.name}</p>
                          <p className="text-xs text-slate-500 font-mono">{p.sku}</p>
                        </div>
                        <select
                          className="text-xs bg-slate-900 border border-slate-600 text-slate-200 rounded px-2 py-1 max-w-[200px] truncate"
                          value={scanAssign[p.id] ?? ""}
                          onChange={(e) => setScanAssign((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        >
                          <option value="">— pilih file —</option>
                          {scanResult.allFiles.map((f) => (
                            <option key={f.file} value={f.url}>{f.file.split("/").pop()}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                    {products.filter((p) => !p.imageUrl).length === 0 && (
                      <p className="text-sm text-green-400 py-4 text-center">Semua produk sudah punya gambar!</p>
                    )}
                  </div>
                </div>

                {scanResult.files === 0 && (
                  <p className="text-sm text-amber-400 py-2">
                    Tidak ada file gambar ditemukan di storage <code className="text-xs bg-slate-800 px-1 rounded">public-assets/portal-assets/</code>. Upload gambar dulu via portal admin atau dialog Edit Item.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-slate-700">
            <Button variant="outline" onClick={() => setScanOpen(false)} className="border-slate-600 text-slate-300">
              Tutup
            </Button>
            {scanResult && !scanResult.files && (
              <Button onClick={handleScanStorage} disabled={scanLoading} variant="outline" className="border-purple-700 text-purple-400">
                {scanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Scan Ulang"}
              </Button>
            )}
            {scanResult && Object.values(scanAssign).some(Boolean) && (
              <Button onClick={handleApplyScan} disabled={scanApplying} className="gap-2 bg-green-700 hover:bg-green-600">
                {scanApplying ? <><Loader2 className="h-4 w-4 animate-spin" /> Menerapkan...</> : <><CheckCircle2 className="h-4 w-4" /> Terapkan {Object.values(scanAssign).filter(Boolean).length} Gambar</>}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
