import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
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
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  type AccountingJournal,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Pencil, Plus, BookOpen, Printer, Download, ChevronsUpDown, Check, ArrowLeft } from "lucide-react";
import { exportXlsx, printWindow } from "@/lib/export";
import { cn } from "@/lib/utils";
import { BackButton } from "@/components/ui/back-button";

const TYPE_LABELS: Record<string, string> = {
  sales: "Penjualan", purchase: "Pembelian", bank: "Bank", cash: "Kas", general: "Umum",
};

interface AccountComboboxProps {
  value: number | null;
  onChange: (val: number | null) => void;
  accounts: { id: number; code: string; name: string }[];
  placeholder?: string;
}

function AccountCombobox({ value, onChange, accounts, placeholder = "— Pilih akun —" }: AccountComboboxProps) {
  const [popOpen, setPopOpen] = useState(false);

  const selected = value != null ? accounts.find((a) => a.id === value) : null;
  const label = selected ? `${selected.code} ${selected.name}` : placeholder;

  return (
    <Popover open={popOpen} onOpenChange={setPopOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={popOpen}
          className="w-full justify-between font-normal text-sm h-9 px-3"
        >
          <span className="truncate text-left flex-1">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari kode atau nama akun..." />
          <CommandList className="max-h-64">
            <CommandEmpty>Akun tidak ditemukan</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="— Tidak ada —"
                onSelect={() => { onChange(null); setPopOpen(false); }}
              >
                <Check className={cn("mr-2 h-4 w-4", value == null ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">— Tidak ada —</span>
              </CommandItem>
              {accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.code} ${a.name}`}
                  onSelect={() => { onChange(a.id); setPopOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === a.id ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs mr-2 text-muted-foreground">{a.code}</span>
                  <span>{a.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function JournalsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { activeCompanyId } = useCompany();

  const journalsQK = ["journals", activeCompanyId] as const;
  const { data: journals } = useQuery<AccountingJournal[]>({
    queryKey: journalsQK,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/accounting/journals?company=${activeCompanyId}`, { credentials: "include", signal });
      if (!res.ok) throw new Error("Gagal memuat jurnal");
      return res.json() as Promise<AccountingJournal[]>;
    },
  });

  const accountsQK = ["accounts", activeCompanyId] as const;
  const { data: accounts } = useQuery<{ id: number; code: string; name: string }[]>({
    queryKey: accountsQK,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/accounting/accounts?company=${activeCompanyId}`, { credentials: "include", signal });
      if (!res.ok) throw new Error("Gagal memuat akun");
      return res.json();
    },
  });

  const createMut = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch(`/api/accounting/journals?company=${activeCompanyId}`, {
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
      const res = await fetch(`/api/accounting/journals/${id}?company=${activeCompanyId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountingJournal | null>(null);
  const [form, setForm] = useState({
    code: "", name: "", type: "general" as AccountingJournal["type"],
    defaultDebitAccountId: null as number | null, defaultCreditAccountId: null as number | null, isActive: true,
  });

  const reset = () => { setEditing(null); setForm({ code: "", name: "", type: "general", defaultDebitAccountId: null, defaultCreditAccountId: null, isActive: true }); };

  const startEdit = (j: AccountingJournal) => {
    setEditing(j);
    setForm({ code: j.code, name: j.name, type: j.type, defaultDebitAccountId: j.defaultDebitAccountId ?? null, defaultCreditAccountId: j.defaultCreditAccountId ?? null, isActive: j.isActive });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast({ title: t.common.error, variant: "destructive" }); return;
    }
    try {
      const payload = { ...form, companyId: activeCompanyId };
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload });
        toast({ title: t.common.success });
      } else {
        await createMut.mutateAsync(form);
        toast({ title: t.common.success });
      }
      qc.invalidateQueries({ queryKey: journalsQK });
      reset(); setOpen(false);
    } catch (e: any) {
      toast({ title: t.common.error, description: e?.message ?? String(e), variant: "destructive" });
    }
  };

  const accLabel = (id: number | null | undefined) => {
    if (!id) return "-";
    const a = accounts?.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : `#${id}`;
  };

  const accList = accounts ?? [];
  const rows = journals ?? [];
  const headers = ["Kode", "Nama", "Tipe", "Akun Debit Default", "Akun Kredit Default", "Status"];
  const xlsxRows = () => rows.map((j) => [
    j.code, j.name, TYPE_LABELS[j.type] ?? j.type,
    accLabel(j.defaultDebitAccountId), accLabel(j.defaultCreditAccountId),
    j.isActive ? "Aktif" : "Non-aktif",
  ]);

  return (
    <AppShell>
      <BackButton href="/accounting" />
      <div className="space-y-6 p-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6" />Jurnal</h1>
            <p className="text-sm text-muted-foreground">Buku jurnal — Penjualan, Pembelian, Bank, Kas, Umum</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => printWindow("Jurnal", headers, xlsxRows())} disabled={rows.length === 0}>
              <Printer className="h-4 w-4 mr-1.5" />Print Preview
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportXlsx("Jurnal", headers, xlsxRows())} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-1.5" />Export XLSX
            </Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
              <DialogTrigger asChild><Button data-testid="button-add-journal"><Plus className="h-4 w-4 mr-2" />Tambah Jurnal</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editing ? "Edit Jurnal" : "Jurnal Baru"}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Kode</Label><Input data-testid="input-journal-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SAL" /></div>
                  <div><Label>Nama</Label><Input data-testid="input-journal-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jurnal Penjualan" /></div>
                  <div>
                    <Label>Tipe</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as AccountingJournal["type"] })}>
                      <SelectTrigger data-testid="select-journal-type"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(TYPE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k}>{v}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Akun Debit Default</Label>
                    <AccountCombobox
                      value={form.defaultDebitAccountId}
                      onChange={(v) => setForm({ ...form, defaultDebitAccountId: v })}
                      accounts={accList}
                    />
                  </div>
                  <div>
                    <Label>Akun Kredit Default</Label>
                    <AccountCombobox
                      value={form.defaultCreditAccountId}
                      onChange={(v) => setForm({ ...form, defaultCreditAccountId: v })}
                      accounts={accList}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="active" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                    <Label htmlFor="active">Aktif</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Batal</Button>
                  <Button onClick={submit} data-testid="button-save-journal">Simpan</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card><CardContent className="p-4">
          <Table>
            <TableHeader><TableRow><TableHead>Kode</TableHead><TableHead>Nama</TableHead><TableHead>Tipe</TableHead><TableHead>Akun Debit Default</TableHead><TableHead>Akun Kredit Default</TableHead><TableHead>Status</TableHead><TableHead className="w-20 text-right">Aksi</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Tidak ada jurnal</TableCell></TableRow>
              ) : rows.map((j) => (
                <TableRow key={j.id} data-testid={`row-journal-${j.id}`}>
                  <TableCell className="font-mono">{j.code}</TableCell>
                  <TableCell>{j.name}</TableCell>
                  <TableCell><Badge variant="outline">{TYPE_LABELS[j.type]}</Badge></TableCell>
                  <TableCell className="text-xs">{accLabel(j.defaultDebitAccountId)}</TableCell>
                  <TableCell className="text-xs">{accLabel(j.defaultCreditAccountId)}</TableCell>
                  <TableCell>{j.isActive ? <Badge>Aktif</Badge> : <Badge variant="secondary">Non-aktif</Badge>}</TableCell>
                  <TableCell className="text-right"><Button size="icon" variant="ghost" aria-label="Edit" onClick={() => startEdit(j)} data-testid={`button-edit-${j.id}`}><Pencil className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>
    </AppShell>
  );
}
