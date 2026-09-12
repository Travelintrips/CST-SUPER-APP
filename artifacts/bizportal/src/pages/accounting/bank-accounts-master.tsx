import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

interface BankAccount {
  id: number; account_name: string; bank_name: string; account_number: string | null;
  coa_code: string | null; company_id: number | null; branch_id: number | null;
  company_name: string | null; is_active: boolean;
}

const EMPTY = { account_name: "", bank_name: "", account_number: "", coa_code: "", company_id: "", branch_id: "" };

async function api(path: string, opt?: RequestInit) {
  const r = await fetch(`/api/bank-mutation-masters${path}`, opt);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request gagal");
  return j;
}

export default function BankAccountsMasterPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["bank-accounts-master"], queryFn: () => api("/bank-accounts") });
  const items: BankAccount[] = data?.items ?? [];
  const filtered = items.filter(i =>
    i.account_name.toLowerCase().includes(search.toLowerCase()) ||
    i.bank_name.toLowerCase().includes(search.toLowerCase()) ||
    (i.account_number ?? "").includes(search)
  );

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, company_id: form.company_id ? Number(form.company_id) : null, branch_id: form.branch_id ? Number(form.branch_id) : null };
      if (editing) return api(`/bank-accounts/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return api("/bank-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    },
    onSuccess: () => { toast.success("Tersimpan"); qc.invalidateQueries({ queryKey: ["bank-accounts-master"] }); setOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const deactivate = useMutation({
    mutationFn: (id: number) => api(`/bank-accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Dinonaktifkan"); qc.invalidateQueries({ queryKey: ["bank-accounts-master"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  function openAdd() { setEditing(null); setForm({ ...EMPTY }); setOpen(true); }
  function openEdit(item: BankAccount) {
    setEditing(item);
    setForm({ account_name: item.account_name, bank_name: item.bank_name, account_number: item.account_number ?? "", coa_code: item.coa_code ?? "", company_id: item.company_id ? String(item.company_id) : "", branch_id: item.branch_id ? String(item.branch_id) : "" });
    setOpen(true);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <h1 className="text-2xl font-semibold">Master Rekening Bank</h1>
          <p className="text-sm text-muted-foreground">Fase 12 — Daftar rekening bank per perusahaan, terhubung ke COA</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-1" />Tambah Rekening</Button>
      </div>

      <Input placeholder="Cari nama / bank / nomor rekening..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />

      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama Rekening</TableHead>
              <TableHead>Bank</TableHead>
              <TableHead>Nomor Rekening</TableHead>
              <TableHead>Kode COA</TableHead>
              <TableHead>Perusahaan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Belum ada rekening</TableCell></TableRow>
            ) : filtered.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.account_name}</TableCell>
                <TableCell>{item.bank_name}</TableCell>
                <TableCell className="font-mono text-sm">{item.account_number ?? "—"}</TableCell>
                <TableCell className="font-mono text-sm">{item.coa_code ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.company_name ?? `ID: ${item.company_id}`}</TableCell>
                <TableCell><Badge variant={item.is_active ? "default" : "secondary"}>{item.is_active ? "Aktif" : "Nonaktif"}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => openEdit(item)}><Pencil className="w-4 h-4" /></Button>
                    {item.is_active && (
                      <Button size="icon" variant="ghost" className="text-red-600" aria-label="Hapus" onClick={() => deactivate.mutate(item.id)}><Trash2 className="w-4 h-4" /></Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Rekening" : "Tambah Rekening Bank"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {[
              { key: "account_name", label: "Nama Rekening *", placeholder: "Mandiri Ciputat" },
              { key: "bank_name", label: "Nama Bank *", placeholder: "Bank Mandiri" },
              { key: "account_number", label: "Nomor Rekening", placeholder: "1234567890" },
              { key: "coa_code", label: "Kode COA", placeholder: "1-1010" },
              { key: "company_id", label: "Company ID", placeholder: "1" },
              { key: "branch_id", label: "Branch ID", placeholder: "1" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-sm font-medium">{label}</label>
                <Input value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} />
              </div>
            ))}
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
