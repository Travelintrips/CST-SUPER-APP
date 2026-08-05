import { useState, useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GooglePlacesAutocomplete } from "@/components/ui/google-places-autocomplete";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  useListCustomers,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  useListTaxes,
  getListCustomersQueryKey,
  type Customer,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { useLanguage } from "@/contexts/LanguageContext";

type Company = { id: number; companyName: string; companyCode: string; isActive: boolean; isHolding: boolean };

export default function CustomersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { data: customers } = useListCustomers({ query: { queryKey: getListCustomersQueryKey() } });
  const { data: taxes } = useListTaxes();
  const createMut = useCreateCustomer();
  const updateMut = useUpdateCustomer();
  const deleteMut = useDeleteCustomer();

  const saleTaxes = (taxes ?? []).filter((t) => t.kind === "sale" && t.isActive);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Company filter & bulk assign
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filterCompanyId, setFilterCompanyId] = useState<string>("all");
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignCompanyId, setBulkAssignCompanyId] = useState<string>("");
  const [bulkAssigning, setBulkAssigning] = useState(false);

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((data: Company[]) => setCompanies((data ?? []).filter((c) => !c.isHolding && c.isActive)))
      .catch(() => {});
  }, []);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    taxId: "",
    address: "",
    notes: "",
    defaultSalesTaxId: null as number | null,
  });

  const reset = () => {
    setEditing(null);
    setForm({ name: "", email: "", phone: "", taxId: "", address: "", notes: "", defaultSalesTaxId: null });
  };

  const startEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      name: c.name,
      email: c.email ?? "",
      phone: c.phone ?? "",
      taxId: c.taxId ?? "",
      address: c.address ?? "",
      notes: c.notes ?? "",
      defaultSalesTaxId: c.defaultSalesTaxId ?? null,
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    const body = {
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      taxId: form.taxId || null,
      address: form.address || null,
      notes: form.notes || null,
      defaultSalesTaxId: form.defaultSalesTaxId,
    };
    try {
      if (editing) {
        const updated = await updateMut.mutateAsync({ id: editing.id, data: body });
        qc.setQueryData<Customer[]>(getListCustomersQueryKey(), (old) =>
          old ? old.map((c) => (c.id === updated.id ? updated : c)) : [updated]
        );
        toast({ title: t.common.success });
      } else {
        const created = await createMut.mutateAsync({ data: body });
        qc.setQueryData<Customer[]>(getListCustomersQueryKey(), (old) =>
          old ? [...old, created] : [created]
        );
        toast({ title: t.common.success });
      }
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      reset();
      setOpen(false);
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Hapus customer ini?")) return;
    try {
      await deleteMut.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      toast({ title: t.common.success });
    } catch (e) {
      toast({ title: t.common.error, description: String(e), variant: "destructive" });
    }
  };

  const handleBulkAssignCompany = async () => {
    if (selectedIds.size === 0 || !bulkAssignCompanyId) return;
    setBulkAssigning(true);
    try {
      const res = await fetch("/api/sales/customers/bulk-assign-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerIds: Array.from(selectedIds),
          companyId: bulkAssignCompanyId === "__unassign__" ? null : Number(bulkAssignCompanyId),
        }),
      });
      if (!res.ok) throw new Error("Gagal assign company");
      const cName = bulkAssignCompanyId === "__unassign__"
        ? "Global"
        : companies.find((c) => String(c.id) === bulkAssignCompanyId)?.companyName ?? bulkAssignCompanyId;
      toast({ title: `${selectedIds.size} customer di-assign ke ${cName}` });
      setSelectedIds(new Set());
      setBulkAssignOpen(false);
      setBulkAssignCompanyId("");
      qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
    } catch (e) {
      toast({ title: "Gagal", description: String(e), variant: "destructive" });
    } finally {
      setBulkAssigning(false);
    }
  };

  const rawList = customers ?? [];
  const allList = filterCompanyId === "all"
    ? rawList
    : filterCompanyId === "__unassigned__"
      ? rawList.filter((c) => (c as { companyId?: number | null }).companyId == null)
      : rawList.filter((c) => String((c as { companyId?: number | null }).companyId) === filterCompanyId);
  const allSelected = allList.length > 0 && allList.every((c) => selectedIds.has(c.id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allList.map((c) => c.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Hapus ${selectedIds.size} customer terpilih? Tindakan ini tidak bisa dibatalkan.`)) return;
    setBulkDeleting(true);
    let success = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await deleteMut.mutateAsync({ id });
        success++;
      } catch {
        failed++;
      }
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
    if (failed === 0) {
      toast({ title: `${success} customer berhasil dihapus` });
    } else {
      toast({ title: `${success} berhasil, ${failed} gagal`, variant: "destructive" });
    }
  };

  const taxLabel = (id: number | null | undefined) => {
    if (!id) return "-";
    const t = (taxes ?? []).find((x) => x.id === id);
    return t ? `${t.name} (${t.rate}%)` : "-";
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link href="/sales"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Customers</h1>
            <p className="text-sm text-muted-foreground">Kelola data pelanggan.</p>
          </div>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-customer">
                <Plus className="mr-2 h-4 w-4" /> New Customer
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Customer" : "Customer Baru"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Nama</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-customer-name" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="phone">Telepon</Label>
                    <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="taxId">NPWP / Tax ID</Label>
                  <Input id="taxId" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="address">Alamat</Label>
                  <GooglePlacesAutocomplete
                    value={form.address}
                    onChange={(v) => setForm({ ...form, address: v })}
                    placeholder="Ketik alamat customer..."
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="notes">Catatan</Label>
                  <Textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Tarif Pajak Default (PPN Penjualan)</Label>
                  <Select
                    value={form.defaultSalesTaxId ? String(form.defaultSalesTaxId) : "none"}
                    onValueChange={(v) => setForm({ ...form, defaultSalesTaxId: v === "none" ? null : parseInt(v) })}
                  >
                    <SelectTrigger data-testid="select-customer-tax">
                      <SelectValue placeholder="Gunakan default global" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Gunakan default global —</SelectItem>
                      {saleTaxes.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.rate}%)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Batal</Button>
                <Button onClick={submit} disabled={createMut.isPending || updateMut.isPending} data-testid="button-save-customer">
                  {editing ? "Simpan" : "Buat"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/20 rounded-lg flex-wrap">
            <span className="text-sm font-medium">{selectedIds.size} dipilih</span>
            <Dialog open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  Assign ke Company
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Assign {selectedIds.size} Customer ke Company</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <Select value={bulkAssignCompanyId} onValueChange={setBulkAssignCompanyId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih company..." />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.companyName} ({c.companyCode})</SelectItem>
                      ))}
                      <SelectItem value="__unassign__">— Lepas (tidak di-assign) —</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setBulkAssignOpen(false); setBulkAssignCompanyId(""); }}>Batal</Button>
                  <Button onClick={handleBulkAssignCompany} disabled={!bulkAssignCompanyId || bulkAssigning}>
                    {bulkAssigning ? "Menyimpan..." : "Simpan"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {bulkDeleting ? "Menghapus..." : "Hapus Terpilih"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Batal</Button>
          </div>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>Daftar Customer</CardTitle>
              <Select value={filterCompanyId} onValueChange={(v) => { setFilterCompanyId(v); setSelectedIds(new Set()); }}>
                <SelectTrigger className="w-[200px] h-8 text-sm">
                  <SelectValue placeholder="Filter company..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Company</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.companyName} ({c.companyCode})</SelectItem>
                  ))}
                  <SelectItem value="__unassigned__">— Belum di-assign —</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    {allList.length > 0 && (
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Pilih semua" />
                    )}
                  </TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Telepon</TableHead>
                  <TableHead>NPWP</TableHead>
                  <TableHead>Pajak Default</TableHead>
                  <TableHead className="w-[120px] text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allList.map((c) => (
                  <TableRow key={c.id} data-testid={`row-customer-${c.id}`}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(c.id)}
                        onCheckedChange={() => toggleSelect(c.id)}
                        aria-label={`Pilih ${c.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      {(() => {
                        const cid = (c as { companyId?: number | null }).companyId;
                        const co = cid != null ? companies.find(x => x.id === cid) : null;
                        return co ? (
                          <Badge className="text-xs px-1.5 py-0 bg-indigo-100 text-indigo-800 hover:bg-indigo-100 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300">
                            {co.companyCode}
                          </Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>;
                      })()}
                    </TableCell>
                    <TableCell>{c.email ?? "-"}</TableCell>
                    <TableCell>{c.phone ?? "-"}</TableCell>
                    <TableCell>{c.taxId ?? "-"}</TableCell>
                    <TableCell>{taxLabel(c.defaultSalesTaxId)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(c)} data-testid={`button-edit-customer-${c.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(c.id)} data-testid={`button-delete-customer-${c.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {allList.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      Belum ada customer.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
