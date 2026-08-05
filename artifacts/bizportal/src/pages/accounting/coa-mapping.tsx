import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

const ACC_CLASSES = ["REVENUE","EXPENSE","INTERNAL_TRANSFER","EMPLOYEE_ADVANCE","INTERCOMPANY_LOAN","TAX_PAYMENT","REIMBURSEMENT"];

interface CoaMapping {
  id: number; erp_category: string; accounting_class: string; coa_code: string;
  coa_name: string | null; description: string | null; is_active: boolean;
}

const EMPTY: Omit<CoaMapping, "id" | "created_at" | "updated_at"> = {
  erp_category: "", accounting_class: "REVENUE", coa_code: "", coa_name: "", description: "", is_active: true,
};

async function api(path: string, opt?: RequestInit) {
  const r = await fetch(`/api/bank-mutation-masters${path}`, opt);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request gagal");
  return j;
}

export default function CoaMappingPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CoaMapping | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["coa-mapping"],
    queryFn: () => api("/coa-mapping"),
  });
  const items: CoaMapping[] = data?.items ?? [];
  const filtered = items.filter(i =>
    i.erp_category.toLowerCase().includes(search.toLowerCase()) ||
    (i.coa_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    i.coa_code.toLowerCase().includes(search.toLowerCase())
  );

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        return api(`/coa-mapping/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      }
      return api("/coa-mapping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    },
    onSuccess: () => { toast.success("Tersimpan"); qc.invalidateQueries({ queryKey: ["coa-mapping"] }); setOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/coa-mapping/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Dihapus"); qc.invalidateQueries({ queryKey: ["coa-mapping"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  function openAdd() { setEditing(null); setForm({ ...EMPTY }); setOpen(true); }
  function openEdit(item: CoaMapping) {
    setEditing(item);
    setForm({ erp_category: item.erp_category, accounting_class: item.accounting_class, coa_code: item.coa_code, coa_name: item.coa_name ?? "", description: item.description ?? "", is_active: item.is_active });
    setOpen(true);
  }

  const classBadge: Record<string, string> = {
    REVENUE: "bg-green-100 text-green-800", EXPENSE: "bg-red-100 text-red-800",
    TAX_PAYMENT: "bg-yellow-100 text-yellow-800", REIMBURSEMENT: "bg-purple-100 text-purple-800",
    INTERCOMPANY_LOAN: "bg-blue-100 text-blue-800",
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <h1 className="text-2xl font-semibold">COA Mapping</h1>
          <p className="text-sm text-muted-foreground">Fase 7 — Pemetaan ERP Category ke akun Chart of Accounts</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-1" />Tambah Mapping</Button>
      </div>

      <Input placeholder="Cari kategori / kode COA..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />

      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ERP Category</TableHead>
              <TableHead>Accounting Class</TableHead>
              <TableHead>Kode COA</TableHead>
              <TableHead>Nama COA</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Belum ada mapping</TableCell></TableRow>
            ) : filtered.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-sm font-medium">{item.erp_category}</TableCell>
                <TableCell>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${classBadge[item.accounting_class] ?? "bg-gray-100 text-gray-700"}`}>
                    {item.accounting_class}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-sm">{item.coa_code}</TableCell>
                <TableCell>{item.coa_name ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.description ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={item.is_active ? "default" : "secondary"}>{item.is_active ? "Aktif" : "Nonaktif"}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" className="text-red-600" aria-label="Hapus" onClick={() => del.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Mapping" : "Tambah Mapping COA"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">ERP Category *</label>
              <Input value={form.erp_category} onChange={e => setForm(f => ({ ...f, erp_category: e.target.value.toUpperCase() }))} placeholder="contoh: REVENUE_GYM" />
            </div>
            <div>
              <label className="text-sm font-medium">Accounting Class *</label>
              <Select value={form.accounting_class} onValueChange={v => setForm(f => ({ ...f, accounting_class: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ACC_CLASSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Kode COA *</label>
              <Input value={form.coa_code} onChange={e => setForm(f => ({ ...f, coa_code: e.target.value }))} placeholder="contoh: 4-1110" />
            </div>
            <div>
              <label className="text-sm font-medium">Nama COA</label>
              <Input value={form.coa_name ?? ""} onChange={e => setForm(f => ({ ...f, coa_name: e.target.value }))} placeholder="contoh: Pendapatan Gym" />
            </div>
            <div>
              <label className="text-sm font-medium">Keterangan</label>
              <Input value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
