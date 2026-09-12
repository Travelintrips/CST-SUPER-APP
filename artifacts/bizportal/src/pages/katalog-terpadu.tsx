import { AppShell } from "@/components/layout/AppShell";
import { useState, useMemo, useEffect } from "react";
import { LOGISTICS_SUBCATEGORIES } from "@workspace/logistics-constants";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useListStocks,
  useListSuppliers,
  useListProductCategories,
  useCreateStockItem,
  useUpdateStockItem,
  useDeleteStockItem,
  useCreateSupplier,
  useUpdateSupplier,
  useDeleteSupplier,
  getListProductsQueryKey,
  getListStocksQueryKey,
  getListSuppliersQueryKey,
  type Product,
  type StockItem,
  type Supplier,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, Package, Wrench, FlaskConical, Building, ExternalLink, BookOpen, ShoppingBag, Globe, X, ArrowRight, Tag, RefreshCw } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const UNITS_SALES = ["pcs", "kg", "cbm", "container", "shipment", "dokumen", "trip", "ton", "hari"];
const UNITS_BOM = ["pcs", "gram", "kg", "ml", "liter", "sachet", "kaleng", "botol", "bungkus", "porsi", "cup", "lusin"];

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `Error ${res.status}` }));
    throw new Error((err as { message?: string }).message ?? `Error ${res.status}`);
  }
  return res.json();
}

interface BomProduct {
  id: number; name: string; sku: string; unit: string;
  price: number; cost_price: number; is_active: boolean;
  item_type: string; subcategory: string | null;
}
interface BomRawMaterial {
  id: number; name: string; sku: string; unit: string;
  cost_price: number; description: string | null; is_active: boolean;
}

// ── TAB SUMMARY CARDS ────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, count, color }: {
  icon: typeof Package; label: string; count: number; color: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${color}`}>
      <Icon className="h-5 w-5 shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{count}</p>
      </div>
    </div>
  );
}

// ── SYNC HARGA BUTTON ─────────────────────────────────────────────────────────

function SyncHargaButton() {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/ecommerce/sync-prices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      toast({ title: "Harga disinkronisasi", description: "Semua tab customer portal telah diperbarui." });
    } catch {
      toast({ title: "Gagal sinkronisasi", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
      Sinkronisasi Harga
    </Button>
  );
}

// ── TAB 1: MASTER ITEM (SALES) ────────────────────────────────────────────────

function MasterItemTab({ initialSearch = "" }: { initialSearch?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState(initialSearch);
  const [filterType, setFilterType] = useState<"all" | "barang" | "jasa">("all");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("active");

  useEffect(() => { setSearch(initialSearch); }, [initialSearch]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<{ id: number; name: string; sku: string; itemType: string; subcategory: string | null; unit: string; price: number; isActive: boolean; description: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const [form, setForm] = useState({ name: "", sku: "", itemType: "barang", kategori: "", subcategory: "", unit: "pcs", price: "0", isActive: true, description: "", currencyCode: "IDR" });

  const { data: _productsPaginated, isLoading } = useListProducts({ limit: 500 }, { query: { queryKey: getListProductsQueryKey({}) } });
  const products = useMemo(() => _productsPaginated?.data ?? [], [_productsPaginated]);
  const { data: productCategories = [] } = useListProductCategories();
  const createMut = useCreateProduct();
  const updateMut = useUpdateProduct();
  const deleteMut = useDeleteProduct();

  const filtered = useMemo(() => products.filter((p: Product) => {
    if (filterType !== "all" && p.itemType !== filterType) return false;
    if (filterActive === "active" && !p.isActive) return false;
    if (filterActive === "inactive" && p.isActive) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    }
    return true;
  }), [products, filterType, filterActive, search]);

  const { data: DEFAULT_SUBCATEGORIES = [...LOGISTICS_SUBCATEGORIES] } = useQuery<string[]>({
    queryKey: ["logistics-subcategories"],
    queryFn: () => fetch("/api/settings/logistics-subcategories", { credentials: "include" }).then((r) => r.ok ? r.json() : [...LOGISTICS_SUBCATEGORIES]),
    staleTime: 5 * 60 * 1000,
  });

  const openCreate = () => {
    setEditingItem(null);
    setForm({ name: "", sku: "", itemType: "barang", kategori: "", subcategory: "", unit: "pcs", price: "0", isActive: true, description: "", currencyCode: "IDR" });
    setDialogOpen(true);
  };

  const openEdit = (p: typeof products[0]) => {
    setEditingItem({ id: p.id, name: p.name, sku: p.sku, itemType: p.itemType, subcategory: p.subcategory ?? null, unit: p.unit, price: p.price, isActive: p.isActive, description: p.description ?? null });
    const existingKategori = (p.categories as string[] | undefined)?.[0] ?? "";
    setForm({ name: p.name, sku: p.sku, itemType: p.itemType, kategori: existingKategori, subcategory: p.subcategory ?? "", unit: p.unit, price: String(p.price), isActive: p.isActive, description: p.description ?? "", currencyCode: (p as unknown as { currencyCode?: string }).currencyCode ?? "IDR" });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.sku.trim()) {
      toast({ title: "Nama dan SKU wajib diisi", variant: "destructive" });
      return;
    }
    const kategoriVal = (form.kategori && form.kategori !== "_none") ? form.kategori : null;
    const subcategoryVal = (form.subcategory && form.subcategory !== "_none") ? form.subcategory : null;
    const body = { name: form.name.trim(), sku: form.sku.trim(), itemType: form.itemType as "barang" | "jasa", subcategory: subcategoryVal, unit: form.unit, price: Number(form.price) || 0, isActive: form.isActive, description: form.description || null, categories: kategoriVal ? [kategoriVal] : [], stock: 0, unitOptions: [], currencyCode: form.currencyCode || "IDR" };
    try {
      if (editingItem) {
        await updateMut.mutateAsync({ id: editingItem.id, data: body });
      } else {
        await createMut.mutateAsync({ data: body });
      }
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
      toast({ title: "Tersimpan" });
      setDialogOpen(false);
    } catch (e) {
      toast({ title: "Gagal", description: String(e), variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync({ id: deleteTarget.id });
      qc.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
      toast({ title: "Dihapus" });
    } catch (e) {
      toast({ title: "Gagal hapus", description: String(e), variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 w-52" placeholder="Cari nama / SKU..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="Jenis" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Jenis</SelectItem>
              <SelectItem value="barang">Barang</SelectItem>
              <SelectItem value="jasa">Jasa</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterActive} onValueChange={(v) => setFilterActive(v as typeof filterActive)}>
            <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="inactive">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/sales/items"><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Halaman Lengkap</Link>
          </Button>
          <SyncHargaButton />
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Tambah Item</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Sub-kategori</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead className="text-right">Harga Jual</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    {products.length === 0 ? "Belum ada item — klik Tambah Item untuk mulai" : "Tidak ada item yang cocok"}
                  </TableCell>
                </TableRow>
              ) : filtered.map((p: Product) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {p.itemType === "jasa"
                        ? <Wrench className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                        : <Package className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      {p.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{p.sku}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={p.itemType === "jasa" ? "text-blue-600 border-blue-300" : "text-amber-600 border-amber-300"}>
                      {p.itemType === "jasa" ? "Jasa" : "Barang"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.subcategory ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.unit}</TableCell>
                  <TableCell className="text-right text-sm font-mono">{p.price > 0 ? fmt(p.price) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={p.isActive ? "default" : "secondary"} className={p.isActive ? "bg-green-100 text-green-700" : ""}>
                      {p.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ id: p.id, name: p.name })}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingItem ? "Edit Master Item" : "Tambah Master Item"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1">
              <Label>Nama Item *</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Pengiriman Udara Internasional" />
            </div>
            <div className="space-y-1">
              <Label>SKU *</Label>
              <Input value={form.sku} onChange={(e) => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="SVC-AIR-001" />
            </div>
            <div className="space-y-1">
              <Label>Jenis</Label>
              <Select value={form.itemType} onValueChange={(v) => setForm(f => ({ ...f, itemType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="barang">Barang</SelectItem>
                  <SelectItem value="jasa">Jasa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Kategori</Label>
              <Select value={form.kategori} onValueChange={(v) => setForm(f => ({ ...f, kategori: v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih kategori..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Tidak ada —</SelectItem>
                  {productCategories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Sub-kategori</Label>
              <Select value={form.subcategory} onValueChange={(v) => setForm(f => ({ ...f, subcategory: v === "_none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Pilih sub-kategori..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— Tidak ada —</SelectItem>
                  {DEFAULT_SUBCATEGORIES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Satuan</Label>
              <Select value={form.unit} onValueChange={(v) => setForm(f => ({ ...f, unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS_SALES.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Mata Uang</Label>
              <Select value={form.currencyCode} onValueChange={(v) => setForm(f => ({ ...f, currencyCode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["IDR","USD","EUR","SGD","CNY","JPY","MYR","AUD"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Harga Jual</Label>
              <Input type="number" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Deskripsi</Label>
              <Input value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Opsional" />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm(f => ({ ...f, isActive: v }))} id="si-active" />
              <Label htmlFor="si-active">Aktif</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>
              {(createMut.isPending || updateMut.isPending) ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Item?</AlertDialogTitle>
            <AlertDialogDescription>"{deleteTarget?.name}" akan dihapus permanen.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── TAB 2: PRODUK JUAL (BOM) ──────────────────────────────────────────────────

function ProdukBomTab({ initialSearch = "" }: { initialSearch?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState(initialSearch);
  useEffect(() => { setSearch(initialSearch); }, [initialSearch]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BomProduct | null>(null);
  const [form, setForm] = useState({ name: "", sku: "", unit: "pcs", price: "", costPrice: "", itemType: "barang", subcategory: "", isActive: true });
  const [deleteTarget, setDeleteTarget] = useState<BomProduct | null>(null);

  const { data: products = [], isLoading } = useQuery<BomProduct[]>({
    queryKey: ["bom-products"],
    queryFn: () => apiFetch("/bom/products"),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { name: form.name, sku: form.sku, unit: form.unit, price: Number(form.price), costPrice: Number(form.costPrice), itemType: form.itemType, subcategory: form.subcategory || null, isActive: form.isActive };
      if (editing) return apiFetch(`/bom/products/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      return apiFetch("/bom/products", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bom-products"] }); toast({ title: "Tersimpan" }); setDialogOpen(false); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/bom/products/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bom-products"] }); toast({ title: "Dihapus" }); setDeleteTarget(null); },
    onError: (e: Error) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  const filtered = products.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()));

  const openCreate = () => { setEditing(null); setForm({ name: "", sku: "", unit: "pcs", price: "", costPrice: "", itemType: "barang", subcategory: "", isActive: true }); setDialogOpen(true); };
  const openEdit = (p: BomProduct) => { setEditing(p); setForm({ name: p.name, sku: p.sku, unit: p.unit, price: String(p.price), costPrice: String(p.cost_price), itemType: p.item_type, subcategory: p.subcategory ?? "", isActive: p.is_active }); setDialogOpen(true); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 w-52" placeholder="Cari produk..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/products/items"><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Halaman Lengkap</Link>
          </Button>
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Tambah Produk</Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Produk</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead className="text-right">Harga Jual</TableHead>
                <TableHead className="text-right">HPP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Belum ada produk</TableCell></TableRow>
              ) : filtered.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{p.sku}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{p.item_type}</Badge></TableCell>
                  <TableCell className="text-sm">{p.unit}</TableCell>
                  <TableCell className="text-right text-sm font-mono">{fmt(p.price)}</TableCell>
                  <TableCell className="text-right text-sm font-mono text-muted-foreground">{fmt(p.cost_price)}</TableCell>
                  <TableCell><Badge className={p.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}>{p.is_active ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Produk Jual" : "Tambah Produk Jual"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1"><Label>Nama Produk *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1"><Label>SKU *</Label><Input value={form.sku} onChange={(e) => setForm(f => ({ ...f, sku: e.target.value }))} /></div>
            <div className="space-y-1">
              <Label>Satuan</Label>
              <Select value={form.unit} onValueChange={(v) => setForm(f => ({ ...f, unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS_BOM.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Harga Jual (Rp)</Label><Input type="number" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Harga Pokok (Rp)</Label><Input type="number" value={form.costPrice} onChange={(e) => setForm(f => ({ ...f, costPrice: e.target.value }))} /></div>
            <div className="space-y-1">
              <Label>Tipe</Label>
              <Select value={form.itemType} onValueChange={(v) => setForm(f => ({ ...f, itemType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="barang">Barang</SelectItem>
                  <SelectItem value="jasa">Jasa</SelectItem>
                  <SelectItem value="racikan">Racikan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Subkategori</Label><Input value={form.subcategory} onChange={(e) => setForm(f => ({ ...f, subcategory: e.target.value }))} /></div>
            <div className="col-span-2 flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm(f => ({ ...f, isActive: v }))} id="pb-active" /><Label htmlFor="pb-active">Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name || !form.sku}>{saveMut.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus Produk?</AlertDialogTitle><AlertDialogDescription>"{deleteTarget?.name}" akan dihapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} className="bg-destructive hover:bg-destructive/90">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── TAB 3: BAHAN BAKU (BOM) ───────────────────────────────────────────────────

function BahanBakuTab({ initialSearch = "" }: { initialSearch?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState(initialSearch);
  useEffect(() => { setSearch(initialSearch); }, [initialSearch]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BomRawMaterial | null>(null);
  const [form, setForm] = useState({ name: "", sku: "", unit: "gram", costPrice: "", description: "", isActive: true });
  const [deleteTarget, setDeleteTarget] = useState<BomRawMaterial | null>(null);

  const { data: materials = [], isLoading } = useQuery<BomRawMaterial[]>({
    queryKey: ["bom-raw-materials"],
    queryFn: () => apiFetch("/bom/raw-materials"),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { name: form.name, sku: form.sku, unit: form.unit, costPrice: Number(form.costPrice), description: form.description || null, isActive: form.isActive };
      if (editing) return apiFetch(`/bom/raw-materials/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      return apiFetch("/bom/raw-materials", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bom-raw-materials"] }); toast({ title: "Tersimpan" }); setDialogOpen(false); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/bom/raw-materials/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bom-raw-materials"] }); toast({ title: "Dihapus" }); setDeleteTarget(null); },
    onError: (e: Error) => toast({ title: "Gagal hapus", description: e.message, variant: "destructive" }),
  });

  const filtered = materials.filter(m => !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.sku.toLowerCase().includes(search.toLowerCase()));

  const openCreate = () => { setEditing(null); setForm({ name: "", sku: "", unit: "gram", costPrice: "", description: "", isActive: true }); setDialogOpen(true); };
  const openEdit = (m: BomRawMaterial) => { setEditing(m); setForm({ name: m.name, sku: m.sku, unit: m.unit, costPrice: String(m.cost_price), description: m.description ?? "", isActive: m.is_active }); setDialogOpen(true); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 w-52" placeholder="Cari bahan baku..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/products/items"><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Halaman Lengkap</Link>
          </Button>
          <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Tambah Bahan Baku</Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Bahan</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead className="text-right">Harga Beli/Satuan</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Belum ada bahan baku</TableCell></TableRow>
              ) : filtered.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{m.sku}</TableCell>
                  <TableCell className="text-sm">{m.unit}</TableCell>
                  <TableCell className="text-right text-sm font-mono">{fmt(m.cost_price)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.description ?? "—"}</TableCell>
                  <TableCell><Badge className={m.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}>{m.is_active ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(m)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Bahan Baku" : "Tambah Bahan Baku"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1"><Label>Nama Bahan *</Label><Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Bubuk Thai Tea" /></div>
            <div className="space-y-1"><Label>SKU *</Label><Input value={form.sku} onChange={(e) => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="RM-THAI-001" /></div>
            <div className="space-y-1">
              <Label>Satuan</Label>
              <Select value={form.unit} onValueChange={(v) => setForm(f => ({ ...f, unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS_BOM.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1"><Label>Harga Beli/Satuan (Rp)</Label><Input type="number" value={form.costPrice} onChange={(e) => setForm(f => ({ ...f, costPrice: e.target.value }))} placeholder="0" /></div>
            <div className="col-span-2 space-y-1"><Label>Deskripsi</Label><Input value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Opsional" /></div>
            <div className="col-span-2 flex items-center gap-2"><Switch checked={form.isActive} onCheckedChange={(v) => setForm(f => ({ ...f, isActive: v }))} id="bb-active" /><Label htmlFor="bb-active">Aktif</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name || !form.sku}>{saveMut.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus Bahan Baku?</AlertDialogTitle><AlertDialogDescription>"{deleteTarget?.name}" akan dihapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} className="bg-destructive hover:bg-destructive/90">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── TAB 4: STOK & SUPPLIER TRADING ───────────────────────────────────────────

function TradingTab({ initialSearch = "" }: { initialSearch?: string }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [innerTab, setInnerTab] = useState<"stok" | "supplier">("stok");
  const [searchStok, setSearchStok] = useState(initialSearch);
  const [searchSupplier, setSearchSupplier] = useState(initialSearch);

  useEffect(() => {
    setSearchStok(initialSearch);
    setSearchSupplier(initialSearch);
  }, [initialSearch]);

  const { data: stocks = [], isLoading: loadStocks } = useListStocks();
  const { data: suppliers = [], isLoading: loadSuppliers } = useListSuppliers(undefined, { query: { queryKey: getListSuppliersQueryKey() } });

  const createStock = useCreateStockItem();
  const updateStock = useUpdateStockItem();
  const deleteStock = useDeleteStockItem();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();

  const [stockDialog, setStockDialog] = useState(false);
  const [editStock, setEditStock] = useState<StockItem | null>(null);
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [delStock, setDelStock] = useState<StockItem | null>(null);
  const [delSupplier, setDelSupplier] = useState<Supplier | null>(null);

  const filteredStocks = (stocks as StockItem[]).filter((s: StockItem) => !searchStok || s.productName.toLowerCase().includes(searchStok.toLowerCase()) || s.sku.toLowerCase().includes(searchStok.toLowerCase()));
  const filteredSuppliers = (suppliers as Supplier[]).filter((s: Supplier) => !searchSupplier || s.name.toLowerCase().includes(searchSupplier.toLowerCase()));

  const handleCreateStock = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const suppRaw = fd.get("supplierId") as string;
    createStock.mutate({ data: { productName: fd.get("productName") as string, sku: fd.get("sku") as string, quantity: Number(fd.get("quantity")), unit: fd.get("unit") as string, costPrice: Number(fd.get("costPrice")), hsCode: (fd.get("hsCode") as string) || undefined, supplierId: suppRaw && suppRaw !== "none" ? Number(suppRaw) : undefined } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListStocksQueryKey() }); setStockDialog(false); toast({ title: "Tersimpan" }); },
      onError: () => toast({ title: "Gagal", variant: "destructive" }),
    });
  };

  const handleEditStock = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editStock) return;
    const fd = new FormData(e.currentTarget);
    const suppRaw = fd.get("supplierId") as string;
    updateStock.mutate({ id: editStock.id, data: { productName: fd.get("productName") as string, sku: fd.get("sku") as string, quantity: Number(fd.get("quantity")), unit: fd.get("unit") as string, costPrice: Number(fd.get("costPrice")), hsCode: (fd.get("hsCode") as string) || undefined, supplierId: suppRaw && suppRaw !== "none" ? Number(suppRaw) : undefined } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListStocksQueryKey() }); setEditStock(null); toast({ title: "Tersimpan" }); },
      onError: () => toast({ title: "Gagal", variant: "destructive" }),
    });
  };

  const handleCreateSupplier = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createSupplier.mutate({ data: { name: fd.get("name") as string, country: fd.get("country") as string, contactEmail: fd.get("contactEmail") as string, phone: (fd.get("phone") as string) || undefined } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); setSupplierDialog(false); toast({ title: "Tersimpan" }); },
      onError: () => toast({ title: "Gagal", variant: "destructive" }),
    });
  };

  const handleEditSupplier = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editSupplier) return;
    const fd = new FormData(e.currentTarget);
    updateSupplier.mutate({ id: editSupplier.id, data: { name: fd.get("name") as string, country: fd.get("country") as string, contactEmail: fd.get("contactEmail") as string, phone: (fd.get("phone") as string) || undefined } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); setEditSupplier(null); toast({ title: "Tersimpan" }); },
      onError: () => toast({ title: "Gagal", variant: "destructive" }),
    });
  };

  const [supplierId, setSupplierId] = useState<string>("none");

  return (
    <div className="space-y-4">
      <div className="flex border-b gap-1 mb-2">
        {([
          { key: "stok", label: "Stok B2B", count: (stocks as StockItem[]).length },
          { key: "supplier", label: "Supplier", count: (suppliers as Supplier[]).length },
        ] as { key: "stok" | "supplier"; label: string; count: number }[]).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setInnerTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${innerTab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
            <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${innerTab === key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{count}</span>
          </button>
        ))}
        <div className="ml-auto pb-1">
          <Button variant="outline" size="sm" asChild>
            <Link href="/trading"><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Halaman Lengkap</Link>
          </Button>
        </div>
      </div>

      {innerTab === "stok" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 w-52" placeholder="Cari stok..." value={searchStok} onChange={(e) => setSearchStok(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => setStockDialog(true)}><Plus className="h-4 w-4 mr-1" />Tambah Stok</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk / SKU</TableHead>
                    <TableHead>HS Code</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Harga Beli</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadStocks ? (
                    Array.from({ length: 4 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 6 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)
                  ) : filteredStocks.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Belum ada stok trading</TableCell></TableRow>
                  ) : filteredStocks.map((s: StockItem) => (
                    <TableRow key={s.id}>
                      <TableCell><div className="font-medium">{s.productName}</div><div className="text-xs font-mono text-muted-foreground">{s.sku}</div></TableCell>
                      <TableCell>{s.hsCode ? <Badge variant="outline" className="text-xs">HS {s.hsCode}</Badge> : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.supplierName ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">{s.quantity} {s.unit}</TableCell>
                      <TableCell className="text-right text-sm font-mono">{fmt(s.costPrice)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditStock(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDelStock(s)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {innerTab === "supplier" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 w-52" placeholder="Cari supplier..." value={searchSupplier} onChange={(e) => setSearchSupplier(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => setSupplierDialog(true)}><Plus className="h-4 w-4 mr-1" />Tambah Supplier</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama Supplier</TableHead>
                    <TableHead>Negara</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Telepon</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadSuppliers ? (
                    Array.from({ length: 3 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 5 }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)
                  ) : filteredSuppliers.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Belum ada supplier</TableCell></TableRow>
                  ) : filteredSuppliers.map((s: Supplier) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell><Badge variant="outline">{s.country}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.contactEmail}</TableCell>
                      <TableCell className="text-sm">{s.phone ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditSupplier(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDelSupplier(s)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stock Create Dialog */}
      <Dialog open={stockDialog} onOpenChange={setStockDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleCreateStock}>
            <DialogHeader><DialogTitle>Tambah Stok Trading</DialogTitle></DialogHeader>
            <StockFields suppliers={suppliers as Supplier[]} supplierId={supplierId} onSupplierChange={setSupplierId} />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setStockDialog(false)}>Batal</Button>
              <Button type="submit" disabled={createStock.isPending}>{createStock.isPending ? "Menyimpan..." : "Simpan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Stock Edit Dialog */}
      <Dialog open={!!editStock} onOpenChange={(o) => !o && setEditStock(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {editStock && (
            <form onSubmit={handleEditStock}>
              <DialogHeader><DialogTitle>Edit Stok Trading</DialogTitle></DialogHeader>
              <StockFields defaults={editStock} suppliers={suppliers as Supplier[]} supplierId={editStock.supplierId != null ? String(editStock.supplierId) : "none"} onSupplierChange={setSupplierId} />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setEditStock(null)}>Batal</Button>
                <Button type="submit" disabled={updateStock.isPending}>{updateStock.isPending ? "Menyimpan..." : "Simpan"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Supplier Create Dialog */}
      <Dialog open={supplierDialog} onOpenChange={setSupplierDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleCreateSupplier}>
            <DialogHeader><DialogTitle>Tambah Supplier</DialogTitle></DialogHeader>
            <SupplierFields />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setSupplierDialog(false)}>Batal</Button>
              <Button type="submit" disabled={createSupplier.isPending}>{createSupplier.isPending ? "Menyimpan..." : "Simpan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Supplier Edit Dialog */}
      <Dialog open={!!editSupplier} onOpenChange={(o) => !o && setEditSupplier(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {editSupplier && (
            <form onSubmit={handleEditSupplier}>
              <DialogHeader><DialogTitle>Edit Supplier</DialogTitle></DialogHeader>
              <SupplierFields defaults={editSupplier} />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setEditSupplier(null)}>Batal</Button>
                <Button type="submit" disabled={updateSupplier.isPending}>{updateSupplier.isPending ? "Menyimpan..." : "Simpan"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Stock */}
      <AlertDialog open={!!delStock} onOpenChange={(o) => !o && setDelStock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus Stok?</AlertDialogTitle><AlertDialogDescription>"{delStock?.productName}" akan dihapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => delStock && deleteStock.mutate({ id: delStock.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListStocksQueryKey() }); setDelStock(null); toast({ title: "Dihapus" }); } })} className="bg-destructive hover:bg-destructive/90">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Supplier */}
      <AlertDialog open={!!delSupplier} onOpenChange={(o) => !o && setDelSupplier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus Supplier?</AlertDialogTitle><AlertDialogDescription>"{delSupplier?.name}" akan dihapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => delSupplier && deleteSupplier.mutate({ id: delSupplier.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); setDelSupplier(null); toast({ title: "Dihapus" }); } })} className="bg-destructive hover:bg-destructive/90">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StockFields({ defaults, suppliers, supplierId, onSupplierChange }: { defaults?: StockItem; suppliers: Supplier[]; supplierId: string; onSupplierChange: (v: string) => void }) {
  return (
    <div className="grid gap-3 py-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label>Nama Produk *</Label><Input name="productName" defaultValue={defaults?.productName ?? ""} required /></div>
        <div className="space-y-1"><Label>SKU *</Label><Input name="sku" defaultValue={defaults?.sku ?? ""} required /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label>HS Code</Label><Input name="hsCode" defaultValue={defaults?.hsCode ?? ""} placeholder="Opsional" /></div>
        <div className="space-y-1"><Label>Supplier</Label>
          <input type="hidden" name="supplierId" value={supplierId} />
          <Select value={supplierId} onValueChange={onSupplierChange}>
            <SelectTrigger><SelectValue placeholder="(opsional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Tanpa Supplier —</SelectItem>
              {suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1"><Label>Qty *</Label><Input name="quantity" type="number" min="0" defaultValue={defaults?.quantity ?? 0} required /></div>
        <div className="space-y-1"><Label>Satuan *</Label><Input name="unit" defaultValue={defaults?.unit ?? ""} required /></div>
        <div className="space-y-1"><Label>Harga Beli *</Label><Input name="costPrice" type="number" min="0" defaultValue={defaults?.costPrice ?? 0} required /></div>
      </div>
    </div>
  );
}

function SupplierFields({ defaults }: { defaults?: Supplier }) {
  return (
    <div className="grid gap-3 py-3">
      <div className="space-y-1"><Label>Nama Supplier *</Label><Input name="name" defaultValue={defaults?.name ?? ""} required /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label>Negara *</Label><Input name="country" defaultValue={defaults?.country ?? ""} required /></div>
        <div className="space-y-1"><Label>Email *</Label><Input name="contactEmail" type="email" defaultValue={defaults?.contactEmail ?? ""} required /></div>
      </div>
      <div className="space-y-1"><Label>Telepon</Label><Input name="phone" defaultValue={defaults?.phone ?? ""} placeholder="Opsional" /></div>
    </div>
  );
}

// ── GLOBAL SEARCH RESULTS ────────────────────────────────────────────────────

type SearchResult = {
  id: string;
  name: string;
  sku: string;
  detail: string;
  source: string;
  sourceColor: string;
  sourceIcon: typeof Package;
  tab: "master-item" | "produk-bom" | "bahan-baku" | "trading";
};

function GlobalSearchResults({
  query,
  products,
  bomProducts,
  bomMaterials,
  stocks,
  suppliers,
  onNavigate,
}: {
  query: string;
  products: Product[];
  bomProducts: BomProduct[];
  bomMaterials: BomRawMaterial[];
  stocks: StockItem[];
  suppliers: Supplier[];
  onNavigate: (tab: SearchResult["tab"], q: string) => void;
}) {
  const q = query.toLowerCase();

  const results: SearchResult[] = useMemo(() => {
    const out: SearchResult[] = [];

    (products as Product[]).forEach((p) => {
      if (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) {
        out.push({
          id: `mi-${p.id}`,
          name: p.name,
          sku: p.sku,
          detail: `${p.itemType === "jasa" ? "Jasa" : "Barang"} • ${p.subcategory ?? "-"} • ${fmt(p.price)}`,
          source: "Master Item",
          sourceColor: "bg-blue-100 text-blue-700",
          sourceIcon: ShoppingBag,
          tab: "master-item",
        });
      }
    });

    (bomProducts as BomProduct[]).forEach((p) => {
      if (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) {
        out.push({
          id: `bp-${p.id}`,
          name: p.name,
          sku: p.sku,
          detail: `Produk Jual • ${p.unit} • Jual ${fmt(p.price)}`,
          source: "Produk Jual",
          sourceColor: "bg-orange-100 text-orange-700",
          sourceIcon: Package,
          tab: "produk-bom",
        });
      }
    });

    (bomMaterials as BomRawMaterial[]).forEach((m) => {
      if (m.name.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q)) {
        out.push({
          id: `bm-${m.id}`,
          name: m.name,
          sku: m.sku,
          detail: `Bahan Baku • ${m.unit} • HPP ${fmt(m.cost_price)}`,
          source: "Bahan Baku",
          sourceColor: "bg-purple-100 text-purple-700",
          sourceIcon: FlaskConical,
          tab: "bahan-baku",
        });
      }
    });

    (stocks as StockItem[]).forEach((s) => {
      const n = ((s as any).name ?? "").toLowerCase();
      const sku = (s.sku ?? "").toLowerCase();
      if (n.includes(q) || sku.includes(q)) {
        out.push({
          id: `st-${s.id}`,
          name: (s as any).name ?? "-",
          sku: s.sku ?? "-",
          detail: `Stok Trading • ${s.unit ?? "-"} • Beli ${fmt(Number((s as any).buyPrice ?? 0))}`,
          source: "Stok Trading",
          sourceColor: "bg-green-100 text-green-700",
          sourceIcon: Globe,
          tab: "trading",
        });
      }
    });

    (suppliers as Supplier[]).forEach((s) => {
      if ((s.name ?? "").toLowerCase().includes(q) || (s.contactEmail ?? "").toLowerCase().includes(q)) {
        out.push({
          id: `sp-${s.id}`,
          name: (s as any).name ?? "-",
          sku: s.contactEmail ?? "-",
          detail: `Supplier • ${s.country ?? "-"} • ${s.phone ?? "-"}`,
          source: "Supplier",
          sourceColor: "bg-teal-100 text-teal-700",
          sourceIcon: Building,
          tab: "trading",
        });
      }
    });

    return out;
  }, [q, products, bomProducts, bomMaterials, stocks, suppliers]);

  const grouped = useMemo(() => {
    const map: Record<string, SearchResult[]> = {};
    results.forEach((r) => {
      if (!map[r.source]) map[r.source] = [];
      map[r.source].push(r);
    });
    return map;
  }, [results]);

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <Search className="h-8 w-8 opacity-30" />
        <p className="text-sm">Tidak ada hasil untuk "<strong>{query}</strong>"</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ditemukan <strong>{results.length}</strong> hasil dari semua katalog untuk "<strong>{query}</strong>"
      </p>
      {Object.entries(grouped).map(([source, items]) => (
        <Card key={source}>
          <CardContent className="p-0">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/40">
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">{source}</span>
              <Badge variant="secondary" className="text-xs px-1.5">{items.length}</Badge>
            </div>
            <Table>
              <TableBody>
                {items.map((item) => {
                  const Icon = item.sourceIcon;
                  return (
                    <TableRow key={item.id} className="hover:bg-muted/30">
                      <TableCell className="w-8 pl-4">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.detail}</div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{item.sku}</code>
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs"
                          onClick={() => onNavigate(item.tab, query)}
                        >
                          Buka Tab
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

export default function KatalogTerpaduPage() {
  const { data: _productsPaginatedMain } = useListProducts({ limit: 500 }, { query: { queryKey: getListProductsQueryKey({}) } });
  const products = _productsPaginatedMain?.data ?? [];
  const { data: stocks = [] } = useListStocks();
  const { data: suppliers = [] } = useListSuppliers(undefined, { query: { queryKey: getListSuppliersQueryKey() } });
  const { data: bomProducts = [] } = useQuery<BomProduct[]>({ queryKey: ["bom-products"], queryFn: () => apiFetch("/bom/products") });
  const { data: bomMaterials = [] } = useQuery<BomRawMaterial[]>({ queryKey: ["bom-raw-materials"], queryFn: () => apiFetch("/bom/raw-materials") });

  const [globalSearch, setGlobalSearch] = useState("");
  const [activeTab, setActiveTab] = useState("master-item");
  const [tabSearch, setTabSearch] = useState("");

  const isSearching = globalSearch.trim().length > 0;

  function handleNavigate(tab: SearchResult["tab"], q: string) {
    setGlobalSearch("");
    setActiveTab(tab);
    setTabSearch(q);
  }

  const totalItems = (products as Product[]).length +
    (bomProducts as BomProduct[]).length +
    (bomMaterials as BomRawMaterial[]).length +
    (stocks as StockItem[]).length +
    (suppliers as Supplier[]).length;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Katalog Terpadu</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {totalItems} item dari semua modul — Master Item, BOM, dan Trading
            </p>
          </div>
        </div>

        {/* Global Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 pr-9 h-11 text-base"
            placeholder="Cari di semua katalog — nama, SKU, email supplier…"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
          {isSearching && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground"
              onClick={() => setGlobalSearch("")}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {isSearching ? (
          <GlobalSearchResults
            query={globalSearch}
            products={products as Product[]}
            bomProducts={bomProducts as BomProduct[]}
            bomMaterials={bomMaterials as BomRawMaterial[]}
            stocks={stocks as StockItem[]}
            suppliers={suppliers as Supplier[]}
            onNavigate={handleNavigate}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard icon={ShoppingBag} label="Master Item (Sales)" count={(products as { id: number }[]).length} color="border-blue-200 bg-blue-50/50 text-blue-700" />
              <SummaryCard icon={Package} label="Produk Jual (BOM)" count={(bomProducts as BomProduct[]).length} color="border-orange-200 bg-orange-50/50 text-orange-700" />
              <SummaryCard icon={FlaskConical} label="Bahan Baku (BOM)" count={(bomMaterials as BomRawMaterial[]).length} color="border-purple-200 bg-purple-50/50 text-purple-700" />
              <SummaryCard icon={Globe} label="Stok Trading + Supplier" count={(stocks as StockItem[]).length + (suppliers as Supplier[]).length} color="border-green-200 bg-green-50/50 text-green-700" />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="master-item" className="flex items-center gap-1.5">
                  <ShoppingBag className="h-3.5 w-3.5" />
                  Master Item
                  <Badge variant="secondary" className="ml-1 text-xs px-1.5">{(products as { id: number }[]).length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="produk-bom" className="flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  Produk Jual
                  <Badge variant="secondary" className="ml-1 text-xs px-1.5">{(bomProducts as BomProduct[]).length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="bahan-baku" className="flex items-center gap-1.5">
                  <FlaskConical className="h-3.5 w-3.5" />
                  Bahan Baku
                  <Badge variant="secondary" className="ml-1 text-xs px-1.5">{(bomMaterials as BomRawMaterial[]).length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="trading" className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  Trading
                  <Badge variant="secondary" className="ml-1 text-xs px-1.5">{(stocks as StockItem[]).length}</Badge>
                </TabsTrigger>
              </TabsList>

              <div className="mt-4">
                <TabsContent value="master-item"><MasterItemTab initialSearch={activeTab === "master-item" ? tabSearch : ""} /></TabsContent>
                <TabsContent value="produk-bom"><ProdukBomTab initialSearch={activeTab === "produk-bom" ? tabSearch : ""} /></TabsContent>
                <TabsContent value="bahan-baku"><BahanBakuTab initialSearch={activeTab === "bahan-baku" ? tabSearch : ""} /></TabsContent>
                <TabsContent value="trading"><TradingTab initialSearch={activeTab === "trading" ? tabSearch : ""} /></TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </div>
    </AppShell>
  );
}
