import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, Plus, Pencil, Trash2, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface MappingRow {
  id: number; company_id: number; module: string; transaction_type: string;
  debit_account_id: number; credit_account_id: number;
  description: string | null; is_active: boolean; created_at: string;
  debit_code: string | null; debit_name: string | null;
}

const MODULES = ["sales","purchase","tenant","sport_center","pos","logistics","expense","hrd","ecommerce","manual"];

const DEFAULT_TX_TYPES: Record<string, string[]> = {
  sales:         ["invoice_payment","credit_note"],
  purchase:      ["bill_payment","debit_note"],
  tenant:        ["rent_payment","deposit","penalty"],
  sport_center:  ["booking_payment","membership","refund"],
  pos:           ["sale","refund"],
  logistics:     ["freight_income","vendor_cost"],
  expense:       ["general_expense","travel","petty_cash"],
  hrd:           ["payroll","allowance","deduction"],
  ecommerce:     ["order_payment","refund"],
  manual:        ["adjustment","correction"],
};

export default function AccountingHubCOAMappingPage() {
  const [rows, setRows]       = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [appliedCompanyId, setAppliedCompanyId] = useState("");
  const [dialog, setDialog]   = useState<{ open: boolean; mode: "add" | "edit"; row: Partial<MappingRow> }>({ open: false, mode: "add", row: {} });
  const [form, setForm]       = useState({ company_id: "", module: "", transaction_type: "", debit_account_id: "", credit_account_id: "", description: "" });
  const [saving, setSaving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (appliedCompanyId) params.set("company_id", appliedCompanyId);
      const res = await fetch(`/api/accounting/hub/coa-mapping?${params}`, { credentials: "include" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        setError(`Gagal memuat data: ${res.status}${msg ? ` — ${msg}` : ""}`);
        return;
      }
      setRows(await res.json());
    } catch (e: any) {
      setError(e.message ?? "Terjadi kesalahan saat memuat data");
    } finally {
      setLoading(false);
    }
  }, [appliedCompanyId]);

  useEffect(() => { void load(); }, [load]);

  const openAdd = () => {
    setForm({ company_id: companyId, module: "", transaction_type: "", debit_account_id: "", credit_account_id: "", description: "" });
    setDialog({ open: true, mode: "add", row: {} });
  };

  const openEdit = (r: MappingRow) => {
    setForm({
      company_id: String(r.company_id), module: r.module, transaction_type: r.transaction_type,
      debit_account_id: String(r.debit_account_id), credit_account_id: String(r.credit_account_id),
      description: r.description ?? "",
    });
    setDialog({ open: true, mode: "edit", row: r });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        company_id: Number(form.company_id), module: form.module, transaction_type: form.transaction_type,
        debit_account_id: Number(form.debit_account_id), credit_account_id: Number(form.credit_account_id),
        description: form.description || null,
      };
      if (dialog.mode === "add") {
        await fetch("/api/accounting/hub/coa-mapping", {
          method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "include", body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/accounting/hub/coa-mapping/${(dialog.row as MappingRow).id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          credentials: "include", body: JSON.stringify(payload),
        });
      }
      setDialog(d => ({...d, open: false}));
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Hapus mapping ini?")) return;
    await fetch(`/api/accounting/hub/coa-mapping/${id}`, { method: "DELETE", credentials: "include" });
    load();
  };

  const handleToggleActive = async (r: MappingRow) => {
    await fetch(`/api/accounting/hub/coa-mapping/${r.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ is_active: !r.is_active }),
    });
    load();
  };

  const grouped: Record<string, MappingRow[]> = {};
  for (const r of rows) {
    const key = `${r.company_id}-${r.module}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/accounting/hub">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Mapping COA per Modul</h1>
            <p className="text-xs text-muted-foreground">Pemetaan akun debit/kredit untuk setiap jenis transaksi</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" />Tambah Mapping
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 rounded-md px-4 py-3 text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input placeholder="Company ID" value={companyId} onChange={e => setCompanyId(e.target.value)} className="w-32" />
            <Button
              size="sm"
              onClick={() => {
                if (companyId === appliedCompanyId) {
                  void load();
                } else {
                  setAppliedCompanyId(companyId);
                }
              }}
            >
              Terapkan
            </Button>
          </div>
        </CardContent>
      </Card>

      {Object.entries(grouped).length === 0 && !loading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <p>Belum ada mapping COA.</p>
            <p className="text-xs mt-1">Klik "Tambah Mapping" untuk mulai mengkonfigurasi akun per modul.</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([key, mappings]) => {
          const [cid, mod] = key.split("-");
          return (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">{mod}</Badge>
                  <span className="text-muted-foreground text-sm font-normal">Company {cid}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-xs">
                    <tr>
                      <th className="text-left pb-1">Tipe Transaksi</th>
                      <th className="text-left pb-1">Debit Akun</th>
                      <th className="text-left pb-1">Kredit Akun</th>
                      <th className="text-left pb-1">Deskripsi</th>
                      <th className="text-left pb-1">Aktif</th>
                      <th className="text-left pb-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map(r => (
                      <tr key={r.id} className="border-t">
                        <td className="py-1.5 font-mono text-xs">{r.transaction_type}</td>
                        <td className="py-1.5 text-xs">
                          <span className="font-mono">{r.debit_code}</span>
                          {r.debit_name && <span className="text-muted-foreground ml-1">{r.debit_name}</span>}
                        </td>
                        <td className="py-1.5 text-xs font-mono">{r.credit_account_id}</td>
                        <td className="py-1.5 text-xs text-muted-foreground">{r.description ?? "—"}</td>
                        <td className="py-1.5">
                          <Switch checked={r.is_active} onCheckedChange={() => handleToggleActive(r)} />
                        </td>
                        <td className="py-1.5">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => openEdit(r)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-red-600" onClick={() => handleDelete(r.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })
      )}

      <Dialog open={dialog.open} onOpenChange={o => setDialog(d => ({...d, open: o}))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialog.mode === "add" ? "Tambah Mapping COA" : "Edit Mapping COA"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Company ID</Label>
              <Input value={form.company_id} onChange={e => setForm(f => ({...f, company_id: e.target.value}))} placeholder="e.g. 1" />
            </div>
            <div className="space-y-1">
              <Label>Modul</Label>
              <Select value={form.module} onValueChange={v => setForm(f => ({...f, module: v, transaction_type: ""}))}>
                <SelectTrigger><SelectValue placeholder="Pilih modul" /></SelectTrigger>
                <SelectContent>{MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Tipe Transaksi</Label>
              {form.module ? (
                <Select value={form.transaction_type} onValueChange={v => setForm(f => ({...f, transaction_type: v}))}>
                  <SelectTrigger><SelectValue placeholder="Pilih tipe" /></SelectTrigger>
                  <SelectContent>
                    {(DEFAULT_TX_TYPES[form.module] ?? []).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={form.transaction_type} onChange={e => setForm(f => ({...f, transaction_type: e.target.value}))} placeholder="e.g. rent_payment" />
              )}
            </div>
            <div className="space-y-1">
              <Label>Debit Account ID</Label>
              <Input value={form.debit_account_id} onChange={e => setForm(f => ({...f, debit_account_id: e.target.value}))} placeholder="e.g. 101" />
            </div>
            <div className="space-y-1">
              <Label>Kredit Account ID</Label>
              <Input value={form.credit_account_id} onChange={e => setForm(f => ({...f, credit_account_id: e.target.value}))} placeholder="e.g. 401" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Deskripsi (opsional)</Label>
              <Input value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Keterangan mapping ini" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(d => ({...d, open: false}))}>Batal</Button>
            <Button onClick={handleSave} disabled={saving || !form.company_id || !form.module || !form.transaction_type || !form.debit_account_id || !form.credit_account_id}>
              {saving ? "Menyimpan..." : dialog.mode === "add" ? "Simpan" : "Perbarui"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
