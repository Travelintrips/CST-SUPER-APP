import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { ArrowLeft, Layers, Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface CostCenter {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  companyId: number | null;
}

const DEFAULT_CODES = ["SPORT_CENTER", "LOGISTICS", "TRADING", "SOFTWARE", "GENERAL"];

export default function CostCentersPage() {
  const { activeCompanyId, isConsolidated } = useCompany();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [form, setForm] = useState({ code: "", name: "", description: "" });

  const qKey = ["accounting-cost-centers", activeCompanyId];

  const { data: costCenters, isLoading } = useQuery<CostCenter[]>({
    queryKey: qKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (!isConsolidated && activeCompanyId) params.set("company", String(activeCompanyId));
      const res = await fetch(`/api/accounting/cost-centers?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const saveMut = useMutation({
    mutationFn: async (data: { code: string; name: string; description: string }) => {
      const url = editing ? `/api/accounting/cost-centers/${editing.id}` : "/api/accounting/cost-centers";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Gagal menyimpan");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      setShowForm(false);
      setEditing(null);
      setForm({ code: "", name: "", description: "" });
      toast({ title: editing ? "Cost center diperbarui" : "Cost center ditambahkan" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await fetch(`/api/accounting/cost-centers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Gagal mengubah status");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qKey }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/accounting/cost-centers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal menghapus");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey });
      toast({ title: "Cost center dihapus" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function openEdit(cc: CostCenter) {
    setEditing(cc);
    setForm({ code: cc.code, name: cc.name, description: cc.description ?? "" });
    setShowForm(true);
  }

  function openNew() {
    setEditing(null);
    setForm({ code: "", name: "", description: "" });
    setShowForm(true);
  }

  const isDefault = (code: string) => DEFAULT_CODES.includes(code);

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>

            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="h-6 w-6" />Master Cost Center
            </h1>
            <p className="text-sm text-muted-foreground">Unit bisnis untuk segmentasi laporan laba/rugi</p>
          </div>
          <Button onClick={openNew} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />Tambah
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Daftar Cost Center</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 text-muted-foreground text-sm">Memuat...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kode</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead>Deskripsi</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(costCenters ?? []).map((cc) => (
                    <TableRow key={cc.id}>
                      <TableCell className="font-mono font-semibold text-sm">{cc.code}</TableCell>
                      <TableCell>{cc.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{cc.description ?? "—"}</TableCell>
                      <TableCell>
                        <button
                          className="cursor-pointer"
                          onClick={() => toggleMut.mutate({ id: cc.id, isActive: !cc.isActive })}
                        >
                          <Badge variant={cc.isActive ? "default" : "secondary"}>
                            {cc.isActive ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cc)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {!isDefault(cc.code) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => {
                                if (confirm(`Hapus cost center "${cc.name}"?`)) deleteMut.mutate(cc.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(costCenters ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Belum ada cost center
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Cost Center" : "Tambah Cost Center"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {!editing && (
                <div>
                  <Label>Kode</Label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="Contoh: RETAIL"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Kode unik, huruf kapital, tanpa spasi</p>
                </div>
              )}
              <div>
                <Label>Nama</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nama unit bisnis"
                />
              </div>
              <div>
                <Label>Deskripsi</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Opsional"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowForm(false)}>Batal</Button>
              <Button
                onClick={() => saveMut.mutate(form)}
                disabled={saveMut.isPending || !form.name.trim() || (!editing && !form.code.trim())}
              >
                {saveMut.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
