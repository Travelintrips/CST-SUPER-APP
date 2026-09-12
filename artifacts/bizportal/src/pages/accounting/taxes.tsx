import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { type AccountingTax } from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { Check, ChevronsUpDown, Pencil, Plus, Receipt, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

type TaxKind = "sale" | "purchase" | "withholding";
type CutType = "self_borne" | "withholding";

const KIND_LABEL: Record<TaxKind, string> = {
  sale: "PPN Keluaran",
  purchase: "PPN Masukan",
  withholding: "PPh (Pajak Penghasilan)",
};

const KIND_BADGE_CLASS: Record<TaxKind, string> = {
  sale: "bg-blue-900/30 text-blue-300 border-blue-700",
  purchase: "bg-green-900/30 text-green-300 border-green-700",
  withholding: "bg-orange-900/30 text-orange-300 border-orange-700",
};

const CUT_LABEL: Record<CutType, string> = {
  self_borne: "Ditanggung Sendiri",
  withholding: "Dipotong dari Pembayaran",
};

const CUT_BADGE_CLASS: Record<CutType, string> = {
  self_borne: "bg-slate-800 text-slate-300 border-slate-600",
  withholding: "bg-red-900/30 text-red-300 border-red-700",
};

type TaxRow = AccountingTax & { cutType?: CutType };

export default function TaxesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { activeCompanyId } = useCompany();

  const taxesQK = ["taxes", activeCompanyId] as const;
  const { data: taxes } = useQuery<TaxRow[]>({
    queryKey: taxesQK,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/accounting/taxes?company=${activeCompanyId}`, {
        credentials: "include", signal,
      });
      if (!res.ok) throw new Error("Gagal memuat pajak");
      return res.json();
    },
  });

  const accountsQK = ["accounts", activeCompanyId] as const;
  const { data: accounts } = useQuery<{ id: number; code: string; name: string; type: string }[]>({
    queryKey: accountsQK,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/accounting/accounts?company=${activeCompanyId}`, {
        credentials: "include", signal,
      });
      if (!res.ok) throw new Error("Gagal memuat akun");
      return res.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch(`/api/accounting/taxes?company=${activeCompanyId}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof form }) => {
      const res = await fetch(`/api/accounting/taxes/${id}?company=${activeCompanyId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaxRow | null>(null);
  const [form, setForm] = useState({
    name: "",
    rate: 0,
    kind: "sale" as TaxKind,
    cutType: "self_borne" as CutType,
    accountId: 0,
    isActive: true,
  });
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);

  const reset = () => {
    setEditing(null);
    setForm({ name: "", rate: 0, kind: "sale", cutType: "self_borne", accountId: 0, isActive: true });
  };

  const startEdit = (tax: TaxRow) => {
    setEditing(tax);
    setForm({
      name: tax.name,
      rate: tax.rate as unknown as number,
      kind: tax.kind as TaxKind,
      cutType: (tax.cutType ?? "self_borne") as CutType,
      accountId: tax.accountId,
      isActive: tax.isActive,
    });
    setOpen(true);
  };

  // Auto-suggest cutType based on kind
  const handleKindChange = (kind: TaxKind) => {
    const defaultCut: CutType = kind === "withholding" ? "withholding" : "self_borne";
    setForm((f) => ({ ...f, kind, cutType: defaultCut }));
  };

  const submit = async () => {
    if (!form.name.trim() || !form.accountId) {
      toast({ title: t.common.error, variant: "destructive" }); return;
    }
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: form });
        toast({ title: t.common.success });
      } else {
        await createMut.mutateAsync(form);
        toast({ title: t.common.success });
      }
      qc.invalidateQueries({ queryKey: taxesQK });
      reset(); setOpen(false);
    } catch (e: unknown) {
      toast({ title: t.common.error, description: (e as Error)?.message ?? String(e), variant: "destructive" });
    }
  };

  const accLabel = (id: number) => {
    const a = accounts?.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : `#${id}`;
  };

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/accounting"><Button variant="ghost" size="icon" aria-label="Kembali"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Receipt className="h-6 w-6" />Pajak
            </h1>
            <p className="text-sm text-muted-foreground">PPN keluaran/masukan & PPh (Pajak Penghasilan)</p>
          </div>

          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-tax">
                <Plus className="h-4 w-4 mr-2" />Tambah Pajak
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "Edit Pajak" : "Pajak Baru"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Nama</Label>
                  <Input
                    data-testid="input-tax-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Contoh: PPh 21"
                  />
                </div>
                <div>
                  <Label>Tarif (%)</Label>
                  <Input
                    data-testid="input-tax-rate"
                    type="number"
                    step="0.001"
                    value={form.rate}
                    onChange={(e) => setForm({ ...form, rate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <Label>Jenis Pajak</Label>
                  <Select value={form.kind} onValueChange={(v) => handleKindChange(v as TaxKind)}>
                    <SelectTrigger data-testid="select-tax-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sale">PPN Keluaran (Output)</SelectItem>
                      <SelectItem value="purchase">PPN Masukan (Input)</SelectItem>
                      <SelectItem value="withholding">PPh (Pajak Penghasilan)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cara Pemotongan</Label>
                  <Select value={form.cutType} onValueChange={(v) => setForm({ ...form, cutType: v as CutType })}>
                    <SelectTrigger data-testid="select-cut-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self_borne">Ditanggung Sendiri (Self-Borne)</SelectItem>
                      <SelectItem value="withholding">Dipotong dari Pembayaran (Withholding)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {form.cutType === "withholding"
                      ? "Pajak dipotong saat pembayaran dilakukan (mis. PPh 21, PPh 23)"
                      : "Pajak dibayar sendiri oleh perusahaan (mis. PPN)"}
                  </p>
                </div>
                <div>
                  <Label>Akun Pajak</Label>
                  <Popover open={accountPopoverOpen} onOpenChange={setAccountPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        data-testid="select-tax-account"
                        className="w-full justify-between font-normal text-left"
                      >
                        <span className="truncate">
                          {form.accountId
                            ? (() => {
                                const a = (accounts ?? []).find((x) => x.id === form.accountId);
                                return a ? `${a.code} ${a.name}` : "Pilih akun";
                              })()
                            : "Pilih akun"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[420px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Cari kode atau nama akun..." />
                        <CommandList className="max-h-64">
                          <CommandEmpty>Akun tidak ditemukan</CommandEmpty>
                          <CommandGroup>
                            {(accounts ?? []).map((a) => (
                              <CommandItem
                                key={a.id}
                                value={`${a.code} ${a.name}`}
                                onSelect={() => {
                                  setForm({ ...form, accountId: a.id });
                                  setAccountPopoverOpen(false);
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${form.accountId === a.id ? "opacity-100" : "opacity-0"}`} />
                                <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                                {a.name}
                                <span className="ml-auto text-xs text-muted-foreground capitalize">{a.type}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="active"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  />
                  <Label htmlFor="active">Aktif</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Batal</Button>
                <Button
                  onClick={submit}
                  disabled={createMut.isPending || updateMut.isPending}
                  data-testid="button-save-tax"
                >
                  {(createMut.isPending || updateMut.isPending) ? "Menyimpan..." : "Simpan"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama Pajak</TableHead>
                  <TableHead className="w-20 text-right">Tarif</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Cara Potong</TableHead>
                  <TableHead>Akun</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-16 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(taxes ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Tidak ada pajak — data akan muncul setelah server selesai migrasi
                    </TableCell>
                  </TableRow>
                ) : taxes!.map((tax) => {
                  const kind = tax.kind as TaxKind;
                  const cut = (tax.cutType ?? "self_borne") as CutType;
                  return (
                    <TableRow key={tax.id} data-testid={`row-tax-${tax.id}`}>
                      <TableCell className="font-medium">{tax.name}</TableCell>
                      <TableCell className="text-right font-mono">{Number(tax.rate).toFixed(3)}%</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={KIND_BADGE_CLASS[kind] ?? ""}>
                          {KIND_LABEL[kind] ?? kind}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={CUT_BADGE_CLASS[cut] ?? ""}>
                          {CUT_LABEL[cut] ?? cut}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{accLabel(tax.accountId)}</TableCell>
                      <TableCell>
                        {tax.isActive
                          ? <Badge className="bg-emerald-900/30 text-emerald-300 border-emerald-700">Aktif</Badge>
                          : <Badge variant="secondary">Non-aktif</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => startEdit(tax)}
                          data-testid={`button-edit-${tax.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
