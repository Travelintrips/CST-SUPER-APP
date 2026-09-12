import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw, Shield, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { BackButton } from "@/components/ui/back-button";

const TAX_TYPES = [
  "PPN_KELUARAN", "PPN_MASUKAN", "PPH_21", "PPH_23",
  "PPH_4_AYAT_2", "PPH_FINAL_UMKM", "PPH_BADAN", "NON_TAXABLE",
];
const TX_TYPES = [
  "sales_order", "purchase_order", "expense", "logistic_order",
  "sport_center", "tenant", "pos", "vendor_payment", "customer_payment",
];
const DIRECTIONS = ["output", "input", "withholding"];

interface TaxRule {
  id: number;
  name: string;
  transaction_type: string;
  module_source: string;
  tax_type: string;
  tax_rate: string;
  direction: string;
  is_active: boolean;
  notes: string | null;
  effective_from: string | null;
  effective_to: string | null;
}

const emptyRule = {
  name: "", transaction_type: "sales_order", module_source: "all",
  tax_type: "PPN_KELUARAN", tax_rate: "11", direction: "output",
  is_active: true, notes: "", effective_from: "", effective_to: "",
};

export default function TaxRulesPage() {
  const { selectedCompanyId } = useCompany();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; rule?: TaxRule } | null>(null);
  const [form, setForm] = useState(emptyRule);

  const params = selectedCompanyId ? `?companyId=${selectedCompanyId}` : "";

  const { data, isLoading } = useQuery<{ data: TaxRule[] }>({
    queryKey: ["tax-rules", selectedCompanyId],
    queryFn: () => fetch(`/api/tax/rules${params}`, { credentials: "include" }).then((r) => r.json()),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tax-rules", selectedCompanyId] });

  const saveMut = useMutation({
    mutationFn: async () => {
      const url = dialog?.mode === "edit" ? `/api/tax/rules/${dialog.rule!.id}` : "/api/tax/rules";
      const method = dialog?.mode === "edit" ? "PUT" : "POST";
      const body = { ...form, tax_rate: Number(form.tax_rate), companyId: selectedCompanyId };
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      if (!r.ok) throw new Error("Gagal menyimpan");
      return r.json();
    },
    onSuccess: () => { toast.success("Aturan pajak disimpan"); setDialog(null); invalidate(); },
    onError: () => toast.error("Gagal menyimpan aturan pajak"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/tax/rules/${id}${params}`, { method: "DELETE", credentials: "include" }).then((r) => r.json()),
    onSuccess: () => { toast.success("Aturan dihapus"); invalidate(); },
    onError: () => toast.error("Gagal menghapus"),
  });

  function openAdd() { setForm(emptyRule); setDialog({ mode: "add" }); }
  function openEdit(rule: TaxRule) {
    setForm({
      name: rule.name, transaction_type: rule.transaction_type, module_source: rule.module_source,
      tax_type: rule.tax_type, tax_rate: String(rule.tax_rate), direction: rule.direction,
      is_active: rule.is_active, notes: rule.notes ?? "", effective_from: rule.effective_from ?? "", effective_to: rule.effective_to ?? "",
    });
    setDialog({ mode: "edit", rule });
  }

  const rules = data?.data ?? [];
  const active = rules.filter((r) => r.is_active);
  const inactive = rules.filter((r) => !r.is_active);

  return (
    <AppShell>
      <BackButton href="/finance/workspace/tax-center" />
      <div className="p-6 space-y-5 max-w-5xl mx-auto">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />Kembali
        </Button>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-600" />
              Master Aturan Pajak
            </h1>
            <p className="text-sm text-muted-foreground">Konfigurasi aturan perhitungan pajak per jenis transaksi</p>
          </div>
          <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" />Tambah Aturan</Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}</div>
        ) : (
          <div className="rounded-xl border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Nama</th>
                  <th className="px-4 py-3 text-left">Jenis Transaksi</th>
                  <th className="px-4 py-3 text-left">Tipe Pajak</th>
                  <th className="px-4 py-3 text-right">Tarif</th>
                  <th className="px-4 py-3 text-left">Arah</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rules.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">Belum ada aturan pajak</td></tr>
                )}
                {[...active, ...inactive].map((rule) => (
                  <tr key={rule.id} className={`hover:bg-muted/30 transition-colors ${!rule.is_active ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-medium">{rule.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{rule.transaction_type}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-[10px]">{rule.tax_type}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{Number(rule.tax_rate).toFixed(2)}%</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        rule.direction === "output" ? "bg-blue-100 text-blue-700" :
                        rule.direction === "input" ? "bg-violet-100 text-violet-700" :
                        "bg-amber-100 text-amber-700"
                      }`}>{rule.direction}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${rule.is_active ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {rule.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(rule)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => { if (confirm("Hapus aturan ini?")) deleteMut.mutate(rule.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "edit" ? "Edit Aturan Pajak" : "Tambah Aturan Pajak"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nama Aturan</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="cth: PPN Keluaran 11%" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Jenis Transaksi</Label>
                <Select value={form.transaction_type} onValueChange={(v) => setForm((f) => ({ ...f, transaction_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TX_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tipe Pajak</Label>
                <Select value={form.tax_type} onValueChange={(v) => setForm((f) => ({ ...f, tax_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TAX_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tarif (%)</Label>
                <Input type="number" value={form.tax_rate} onChange={(e) => setForm((f) => ({ ...f, tax_rate: e.target.value }))} step="0.001" />
              </div>
              <div className="space-y-1.5">
                <Label>Arah</Label>
                <Select value={form.direction} onValueChange={(v) => setForm((f) => ({ ...f, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DIRECTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Modul Sumber</Label>
                <Input value={form.module_source} onChange={(e) => setForm((f) => ({ ...f, module_source: e.target.value }))} placeholder="all / sales / expense" />
              </div>
              <div className="space-y-1.5 flex flex-col justify-end">
                <Label>Aktif</Label>
                <div className="flex items-center gap-2 h-9">
                  <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
                  <span className="text-sm text-muted-foreground">{form.is_active ? "Ya" : "Tidak"}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Berlaku Dari</Label>
                <DatePicker value={form.effective_from} onChange={(v) => setForm((f) => ({ ...f, effective_from: v }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Berlaku Sampai</Label>
                <DatePicker value={form.effective_to} onChange={(v) => setForm((f) => ({ ...f, effective_to: v }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Catatan</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Opsional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name}>
              {saveMut.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
