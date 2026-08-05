import { AppShell } from "@/components/layout/AppShell";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, ChevronDown, ChevronRight, FlaskConical, X } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";

const UNITS = ["gram", "kg", "ml", "liter", "pcs", "sachet", "sdm", "sdt", "kaleng", "botol", "bungkus", "cup", "porsi"];

interface Product { id: number; name: string; sku: string; unit: string; }
interface RawMaterial { id: number; name: string; sku: string; unit: string; }

interface RecipeItem {
  id: number; recipe_id: number; raw_material_id: number;
  qty: number; unit: string;
  raw_material_name: string; raw_material_sku: string;
}
interface Recipe {
  id: number; product_id: number; product_name: string; product_sku: string;
  note: string | null; is_active: boolean;
  items: RecipeItem[];
}

interface LineForm { rawMaterialId: string; qty: string; unit: string; }
const EMPTY_LINE: LineForm = { rawMaterialId: "", qty: "", unit: "gram" };

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

// ── Recipe Dialog ─────────────────────────────────────────────────────────────

function RecipeDialog({
  open, onClose, products, rawMaterials, editing, onSaved,
}: {
  open: boolean; onClose: () => void;
  products: Product[]; rawMaterials: RawMaterial[];
  editing: Recipe | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [productId, setProductId] = useState(editing ? String(editing.product_id) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [prodSearch, setProdSearch] = useState(editing?.product_name ?? "");
  const [prodOpen, setProdOpen] = useState(false);
  const [lines, setLines] = useState<LineForm[]>(
    editing?.items.length
      ? editing.items.map(i => ({ rawMaterialId: String(i.raw_material_id), qty: String(i.qty), unit: i.unit }))
      : [{ ...EMPTY_LINE }]
  );

  const filteredProds = products.filter(p =>
    !prodSearch || p.name.toLowerCase().includes(prodSearch.toLowerCase()) || p.sku.toLowerCase().includes(prodSearch.toLowerCase())
  );

  function setLine(idx: number, key: keyof LineForm, val: string) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [key]: val } : l));
  }
  function addLine() { setLines(prev => [...prev, { ...EMPTY_LINE }]); }
  function removeLine(idx: number) { setLines(prev => prev.filter((_, i) => i !== idx)); }

  const save = useMutation({
    mutationFn: () => {
      const validLines = lines.filter(l => l.rawMaterialId && l.qty);
      if (!productId) throw new Error("Pilih produk terlebih dahulu");
      if (validLines.length === 0) throw new Error("Tambahkan minimal 1 bahan baku");
      return apiFetch("/bom/recipes", {
        method: "POST",
        body: JSON.stringify({
          productId: Number(productId),
          note: note || null,
          isActive,
          items: validLines.map(l => ({
            rawMaterialId: Number(l.rawMaterialId),
            qty: Number(l.qty),
            unit: l.unit,
          })),
        }),
      });
    },
    onSuccess: () => { toast({ title: "Recipe disimpan" }); onSaved(); onClose(); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit Recipe: ${editing.product_name}` : "Buat Recipe / BOM"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Pilih Produk */}
          <div className="space-y-1.5">
            <Label>Produk Jual *</Label>
            <div className="relative">
              <Input
                value={prodSearch}
                onChange={(e) => { setProdSearch(e.target.value); setProdOpen(true); if (!e.target.value) setProductId(""); }}
                onFocus={() => setProdOpen(true)}
                placeholder="Cari dan pilih produk jual..."
                className="pr-8"
              />
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              {prodOpen && filteredProds.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredProds.slice(0, 20).map(p => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm flex justify-between items-center"
                      onMouseDown={() => {
                        setProductId(String(p.id));
                        setProdSearch(p.name);
                        setProdOpen(false);
                      }}
                    >
                      <span>{p.name}</span>
                      <span className="text-xs text-gray-400 font-mono">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {productId && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                ✓ Dipilih: {products.find(p => p.id === Number(productId))?.name}
              </p>
            )}
          </div>

          {/* Bahan Baku Lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Bahan Baku *</Label>
              <button
                onClick={addLine}
                className="text-xs text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah bahan
              </button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="py-2 text-xs">Bahan Baku</TableHead>
                    <TableHead className="py-2 text-xs w-28">Qty</TableHead>
                    <TableHead className="py-2 text-xs w-32">Satuan</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="py-1.5">
                        <Select
                          value={line.rawMaterialId}
                          onValueChange={(v) => {
                            const rm = rawMaterials.find(m => m.id === Number(v));
                            setLines(prev => prev.map((l, i) => i === idx
                              ? { ...l, rawMaterialId: v, unit: rm?.unit ?? l.unit }
                              : l
                            ));
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Pilih bahan baku..." />
                          </SelectTrigger>
                          <SelectContent>
                            {rawMaterials.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                Belum ada bahan baku. Tambah dulu di tab Bahan Baku.
                              </div>
                            ) : rawMaterials.map(m => (
                              <SelectItem key={m.id} value={String(m.id)}>
                                {m.name} <span className="text-xs text-gray-400 ml-1">({m.sku})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input
                          className="h-8 text-sm"
                          type="number"
                          step="0.001"
                          value={line.qty}
                          onChange={(e) => setLine(idx, "qty", e.target.value)}
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Select value={line.unit} onValueChange={(v) => setLine(idx, "unit", v)}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button onClick={() => removeLine(idx)} className="text-gray-400 hover:text-red-500 p-0.5">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Catatan & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Catatan</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opsional" />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="rec-active" />
              <Label htmlFor="rec-active">Recipe aktif</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Menyimpan..." : "Simpan Recipe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProductRecipesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRecipe, setEditRecipe] = useState<Recipe | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data: recipes = [], isLoading } = useQuery<Recipe[]>({
    queryKey: ["bom-recipes"],
    queryFn: () => apiFetch("/bom/recipes"),
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["bom-products"],
    queryFn: () => apiFetch("/bom/products"),
  });

  const { data: rawMaterials = [] } = useQuery<RawMaterial[]>({
    queryKey: ["bom-raw-materials"],
    queryFn: () => apiFetch("/bom/raw-materials"),
  });

  const deleteRecipe = useMutation({
    mutationFn: (id: number) => apiFetch(`/bom/recipes/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bom-recipes"] }); toast({ title: "Recipe dihapus" }); },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filtered = recipes.filter(r =>
    !search ||
    r.product_name.toLowerCase().includes(search.toLowerCase()) ||
    r.product_sku.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <BackButton href="/products" />
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FlaskConical className="w-6 h-6 text-orange-500" />
              Recipe / BOM
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Daftar bahan baku yang dibutuhkan setiap produk jual
            </p>
          </div>
          <Button onClick={() => { setEditRecipe(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Buat Recipe
          </Button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9" placeholder="Cari produk..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <span className="text-sm text-gray-500">{filtered.length} recipe</span>
        </div>

        {/* Hint jika belum ada bahan baku */}
        {rawMaterials.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
            <span className="text-base">⚠️</span>
            <span>Belum ada bahan baku. Tambahkan dulu di halaman <strong>Produk / Bahan Baku</strong> → tab Bahan Baku.</span>
          </div>
        )}

        {/* Recipe Cards */}
        {isLoading ? (
          <div className="text-center py-16 text-gray-400">Memuat...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            {recipes.length === 0 ? "Belum ada recipe. Klik \"Buat Recipe\" untuk mulai." : "Tidak ada hasil"}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(r => {
              const isExpanded = expandedIds.has(r.id);
              return (
                <Card key={r.id} className="overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleExpand(r.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </span>
                      <div>
                        <span className="font-semibold text-gray-900">{r.product_name}</span>
                        <span className="text-xs text-gray-400 font-mono ml-2">{r.product_sku}</span>
                      </div>
                      <Badge className={r.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}>
                        {r.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                      <span className="text-xs text-gray-500">{r.items.length} bahan</span>
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                        onClick={() => { setEditRecipe(r); setDialogOpen(true); }}>
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-500 hover:text-red-600"
                        onClick={() => { if (confirm(`Hapus recipe "${r.product_name}"?`)) deleteRecipe.mutate(r.id); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <CardContent className="p-0 border-t bg-gray-50">
                      {r.note && (
                        <p className="px-4 py-2 text-xs text-gray-500 italic border-b">{r.note}</p>
                      )}
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gray-100">
                            <TableHead className="py-2 text-xs pl-12">Bahan Baku</TableHead>
                            <TableHead className="py-2 text-xs">SKU</TableHead>
                            <TableHead className="py-2 text-xs text-right">Qty</TableHead>
                            <TableHead className="py-2 text-xs">Satuan</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {r.items.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center py-4 text-xs text-gray-400">Belum ada bahan</TableCell>
                            </TableRow>
                          ) : r.items.map(item => (
                            <TableRow key={item.id}>
                              <TableCell className="pl-12 py-2 text-sm">{item.raw_material_name}</TableCell>
                              <TableCell className="py-2 text-xs text-gray-400 font-mono">{item.raw_material_sku}</TableCell>
                              <TableCell className="py-2 text-sm text-right font-medium">
                                {Number(item.qty).toLocaleString("id-ID", { maximumFractionDigits: 3 })}
                              </TableCell>
                              <TableCell className="py-2 text-sm text-gray-500">{item.unit}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {dialogOpen && (
          <RecipeDialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            products={products}
            rawMaterials={rawMaterials}
            editing={editRecipe}
            onSaved={() => qc.invalidateQueries({ queryKey: ["bom-recipes"] })}
          />
        )}
      </div>
    </AppShell>
  );
}
