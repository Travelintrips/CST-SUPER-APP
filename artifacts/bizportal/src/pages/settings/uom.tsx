import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Pencil, ArrowLeftRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

interface UomRow {
  id: number;
  name: string;
  symbol: string;
  category: string;
  is_active: boolean;
}

interface ConversionRow {
  id: number;
  from_uom_id: number;
  from_name: string;
  from_symbol: string;
  to_uom_id: number;
  to_name: string;
  to_symbol: string;
  factor: number;
}

const CATEGORIES = ["count", "weight", "length", "volume", "area", "time", "other"];

async function apiFetch(url: string, init?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...init });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as any).message ?? `HTTP ${r.status}`);
  }
  return r.json();
}

export default function UomPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: uoms = [], isLoading } = useQuery<UomRow[]>({
    queryKey: ["/api/uom"],
    queryFn: () => apiFetch("/api/uom"),
  });

  const { data: conversions = [] } = useQuery<ConversionRow[]>({
    queryKey: ["/api/uom/conversions"],
    queryFn: () => apiFetch("/api/uom/conversions"),
  });

  // ── UOM Dialog ────────────────────────────────────────────────────────────
  const [uomDialog, setUomDialog] = useState(false);
  const [uomEdit, setUomEdit] = useState<UomRow | null>(null);
  const [uomForm, setUomForm] = useState({ name: "", symbol: "", category: "count" });

  const openAddUom = () => {
    setUomEdit(null);
    setUomForm({ name: "", symbol: "", category: "count" });
    setUomDialog(true);
  };

  const openEditUom = (u: UomRow) => {
    setUomEdit(u);
    setUomForm({ name: u.name, symbol: u.symbol, category: u.category });
    setUomDialog(true);
  };

  const saveUomMut = useMutation({
    mutationFn: async () => {
      if (uomEdit) {
        return apiFetch(`/api/uom/${uomEdit.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(uomForm),
        });
      }
      return apiFetch("/api/uom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(uomForm),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/uom"] });
      setUomDialog(false);
      toast({ title: "Berhasil disimpan" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteUomMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/uom/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/uom"] });
      toast({ title: "UOM dihapus" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const toggleActiveMut = useMutation({
    mutationFn: (u: UomRow) =>
      apiFetch(`/api/uom/${u.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !u.is_active }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/uom"] }),
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  // ── Conversion Dialog ─────────────────────────────────────────────────────
  const [convDialog, setConvDialog] = useState(false);
  const [convEdit, setConvEdit] = useState<ConversionRow | null>(null);
  const [convForm, setConvForm] = useState({ fromUomId: "", toUomId: "", factor: "" });

  const openAddConv = () => {
    setConvEdit(null);
    setConvForm({ fromUomId: "", toUomId: "", factor: "" });
    setConvDialog(true);
  };

  const openEditConv = (c: ConversionRow) => {
    setConvEdit(c);
    setConvForm({ fromUomId: String(c.from_uom_id), toUomId: String(c.to_uom_id), factor: String(c.factor) });
    setConvDialog(true);
  };

  const saveConvMut = useMutation({
    mutationFn: async () => {
      if (convEdit) {
        return apiFetch(`/api/uom/conversions/${convEdit.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ factor: Number(convForm.factor) }),
        });
      }
      return apiFetch("/api/uom/conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromUomId: Number(convForm.fromUomId),
          toUomId: Number(convForm.toUomId),
          factor: Number(convForm.factor),
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/uom/conversions"] });
      setConvDialog(false);
      toast({ title: "Berhasil disimpan" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteConvMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/uom/conversions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/uom/conversions"] });
      toast({ title: "Konversi dihapus" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  // ── Group by category ──────────────────────────────────────────────────────
  const byCategory = CATEGORIES.map((cat) => ({
    cat,
    rows: uoms.filter((u) => u.category === cat),
  })).filter((g) => g.rows.length > 0);
  const otherRows = uoms.filter((u) => !CATEGORIES.includes(u.category));
  if (otherRows.length > 0) byCategory.push({ cat: "other", rows: otherRows });

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Manajemen UOM (Satuan)"
          breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "UOM" }]}
          favoriteEnabled
          actions={<Button onClick={openAddUom}><Plus className="mr-2 h-4 w-4" /> Tambah UOM</Button>}
        />

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : (
          <Card>
            <CardContent className="pt-4">
              {byCategory.map(({ cat, rows }) => (
                <div key={cat} className="mb-6">
                  <p className="text-xs font-semibold uppercase text-muted-foreground mb-2 tracking-wide">{cat}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama</TableHead>
                        <TableHead>Simbol</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[120px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.name}</TableCell>
                          <TableCell>{u.symbol}</TableCell>
                          <TableCell>
                            <Badge
                              variant={u.is_active ? "default" : "secondary"}
                              className="cursor-pointer"
                              onClick={() => toggleActiveMut.mutate(u)}
                            >
                              {u.is_active ? "Aktif" : "Nonaktif"}
                            </Badge>
                          </TableCell>
                          <TableCell className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => openEditUom(u)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Hapus UOM "${u.name}"?`)) deleteUomMut.mutate(u.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" /> Konversi UOM
            </CardTitle>
            <Button size="sm" variant="outline" onClick={openAddConv}>
              <Plus className="mr-2 h-4 w-4" /> Tambah Konversi
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dari</TableHead>
                  <TableHead>Ke</TableHead>
                  <TableHead className="text-right">Faktor</TableHead>
                  <TableHead className="text-muted-foreground text-xs">Arti</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.from_name} ({c.from_symbol})</TableCell>
                    <TableCell>{c.to_name} ({c.to_symbol})</TableCell>
                    <TableCell className="text-right font-mono">{c.factor}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      1 {c.from_symbol} = {c.factor} {c.to_symbol}
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEditConv(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Hapus konversi ini?")) deleteConvMut.mutate(c.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {conversions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Belum ada konversi
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* UOM Dialog */}
        <Dialog open={uomDialog} onOpenChange={setUomDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{uomEdit ? "Edit UOM" : "Tambah UOM"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nama</Label>
                <Input
                  value={uomForm.name}
                  onChange={(e) => setUomForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="contoh: meter"
                />
              </div>
              <div>
                <Label>Simbol</Label>
                <Input
                  value={uomForm.symbol}
                  onChange={(e) => setUomForm((f) => ({ ...f, symbol: e.target.value }))}
                  placeholder="contoh: m"
                />
              </div>
              <div>
                <Label>Kategori</Label>
                <Select
                  value={uomForm.category}
                  onValueChange={(v) => setUomForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setUomDialog(false)}>Batal</Button>
              <Button onClick={() => saveUomMut.mutate()} disabled={saveUomMut.isPending}>
                Simpan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Conversion Dialog */}
        <Dialog open={convDialog} onOpenChange={setConvDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{convEdit ? "Edit Konversi" : "Tambah Konversi"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {!convEdit && (
                <>
                  <div>
                    <Label>Dari UOM</Label>
                    <Select
                      value={convForm.fromUomId}
                      onValueChange={(v) => setConvForm((f) => ({ ...f, fromUomId: v }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Pilih UOM..." /></SelectTrigger>
                      <SelectContent>
                        {uoms.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name} ({u.symbol})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Ke UOM</Label>
                    <Select
                      value={convForm.toUomId}
                      onValueChange={(v) => setConvForm((f) => ({ ...f, toUomId: v }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Pilih UOM..." /></SelectTrigger>
                      <SelectContent>
                        {uoms.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name} ({u.symbol})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <div>
                <Label>Faktor</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={convForm.factor}
                  onChange={(e) => setConvForm((f) => ({ ...f, factor: e.target.value }))}
                  placeholder="contoh: 50 (1 roll = 50 meter)"
                />
                {convForm.fromUomId && convForm.toUomId && convForm.factor && (
                  <p className="text-xs text-muted-foreground mt-1">
                    1 {uoms.find((u) => u.id === Number(convForm.fromUomId))?.symbol} ={" "}
                    {convForm.factor} {uoms.find((u) => u.id === Number(convForm.toUomId))?.symbol}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConvDialog(false)}>Batal</Button>
              <Button onClick={() => saveConvMut.mutate()} disabled={saveConvMut.isPending}>
                Simpan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
