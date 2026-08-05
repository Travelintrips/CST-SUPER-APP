import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pencil, Plus, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

const TAX_TYPES = ["PPN","PPH21","PPH23","PPH22","PPH4","BPJS_TK","BPJS_KES"];

interface TaxMapping {
  id: number; tax_type: string; liability_coa: string; expense_coa: string | null;
  description: string | null; is_active: boolean;
}

async function api(path: string, opt?: RequestInit) {
  const r = await fetch(`/api/bank-mutation-masters${path}`, opt);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request gagal");
  return j;
}

export default function TaxMappingPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaxMapping | null>(null);
  const [form, setForm] = useState({ tax_type: "", liability_coa: "", expense_coa: "", description: "" });

  const { data, isLoading } = useQuery({ queryKey: ["tax-mapping"], queryFn: () => api("/tax-mapping") });
  const items: TaxMapping[] = data?.items ?? [];

  const save = useMutation({
    mutationFn: () => {
      if (editing) return api(`/tax-mapping/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      return api("/tax-mapping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    },
    onSuccess: () => { toast.success("Tersimpan"); qc.invalidateQueries({ queryKey: ["tax-mapping"] }); setOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  function openAdd() { setEditing(null); setForm({ tax_type: "", liability_coa: "", expense_coa: "", description: "" }); setOpen(true); }
  function openEdit(item: TaxMapping) {
    setEditing(item);
    setForm({ tax_type: item.tax_type, liability_coa: item.liability_coa, expense_coa: item.expense_coa ?? "", description: item.description ?? "" });
    setOpen(true);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <h1 className="text-2xl font-semibold">Tax Ledger Mapping</h1>
          <p className="text-sm text-muted-foreground">Fase 10 — Pemetaan jenis pajak ke akun hutang & beban pajak</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-1" />Tambah</Button>
      </div>

      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jenis Pajak</TableHead>
              <TableHead>Akun Hutang Pajak (Liability COA)</TableHead>
              <TableHead>Akun Beban Pajak (Expense COA)</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-mono font-semibold">{item.tax_type}</TableCell>
                <TableCell className="font-mono text-sm">{item.liability_coa}</TableCell>
                <TableCell className="font-mono text-sm">{item.expense_coa ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.description ?? "—"}</TableCell>
                <TableCell><Badge variant={item.is_active ? "default" : "secondary"}>{item.is_active ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Tax Mapping" : "Tambah Tax Mapping"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {!editing && (
              <div>
                <label className="text-sm font-medium">Jenis Pajak *</label>
                <Input value={form.tax_type} onChange={e => setForm(f => ({ ...f, tax_type: e.target.value.toUpperCase() }))} placeholder="PPN / PPH21 / PPH23..." />
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Liability COA (Hutang Pajak) *</label>
              <Input value={form.liability_coa} onChange={e => setForm(f => ({ ...f, liability_coa: e.target.value }))} placeholder="contoh: 2-1030" />
            </div>
            <div>
              <label className="text-sm font-medium">Expense COA (Beban Pajak)</label>
              <Input value={form.expense_coa} onChange={e => setForm(f => ({ ...f, expense_coa: e.target.value }))} placeholder="contoh: 5-3010" />
            </div>
            <div>
              <label className="text-sm font-medium">Keterangan</label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Menyimpan..." : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
