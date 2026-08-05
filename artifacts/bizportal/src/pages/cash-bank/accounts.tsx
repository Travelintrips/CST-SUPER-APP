import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useCompany } from "@/contexts/CompanyContext";
import { Plus, Pencil, RefreshCw, Landmark, CheckCircle2, XCircle, Star } from "lucide-react";

const API = "/api";
function fmt(n: number | string) {
  return new Intl.NumberFormat("id-ID").format(Number(n) || 0);
}

const ACCOUNT_TYPES = [
  { value: "bank", label: "Bank" },
  { value: "cash", label: "Kas" },
  { value: "giro", label: "Giro" },
  { value: "deposito", label: "Deposito" },
  { value: "PETTY_CASH", label: "Kas Kecil" },
  { value: "ESCROW", label: "Escrow" },
  { value: "VIRTUAL_ACCOUNT", label: "Virtual Account" },
];

const RECON_METHODS = [
  { value: "MANUAL", label: "Manual" },
  { value: "AUTO", label: "Auto" },
];

const TYPE_COLOR: Record<string, string> = {
  bank: "bg-blue-500/20 text-blue-300", cash: "bg-green-500/20 text-green-300",
  giro: "bg-purple-500/20 text-purple-300", deposito: "bg-yellow-500/20 text-yellow-300",
  PETTY_CASH: "bg-orange-500/20 text-orange-300", ESCROW: "bg-red-500/20 text-red-300",
  VIRTUAL_ACCOUNT: "bg-cyan-500/20 text-cyan-300",
};

const emptyForm = () => ({
  name: "", account_type: "bank", bank_name: "", account_number: "", account_holder: "",
  currency_code: "IDR", coa_id: "", notes: "", description: "", opening_balance: "0",
  minimum_balance: "0", bank_branch: "", swift_code: "", iban: "",
  reconciliation_method: "MANUAL", is_default: false, category_id: "", is_active: true,
});

export default function CashBankAccounts() {
  const { activeCompanyId } = useCompany();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [coaOptions, setCoaOptions] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const [accsR, coaR, catR] = await Promise.all([
      fetch(`${API}/cash-bank/accounts?companyId=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
      fetch(`${API}/cash-bank/coa-options?companyId=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
      fetch(`${API}/cash-bank/categories?companyId=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
    ]);
    setAccounts(accsR.data ?? []);
    setCoaOptions(coaR.data ?? []);
    setCategories(catR.data ?? []);
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (acc: any) => {
    setEditing(acc);
    setForm({
      name: acc.name ?? "", account_type: acc.account_type ?? "bank",
      bank_name: acc.bank_name ?? "", account_number: acc.account_number ?? "",
      account_holder: acc.account_holder ?? "", currency_code: acc.currency_code ?? acc.currency ?? "IDR",
      coa_id: acc.coa_id ? String(acc.coa_id) : "", notes: acc.notes ?? "",
      description: acc.description ?? "", opening_balance: acc.opening_balance ?? "0",
      minimum_balance: acc.minimum_balance ?? "0", bank_branch: acc.bank_branch ?? "",
      swift_code: acc.swift_code ?? "", iban: acc.iban ?? "",
      reconciliation_method: acc.reconciliation_method ?? "MANUAL",
      is_default: acc.is_default ?? false, category_id: acc.category_id ? String(acc.category_id) : "",
      is_active: acc.is_active ?? true,
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name || !form.account_type) return;
    setSaving(true);
    try {
      const body = { ...form, companyId: activeCompanyId, coa_id: form.coa_id ? Number(form.coa_id) : null, category_id: form.category_id ? Number(form.category_id) : null };
      const url = editing ? `${API}/cash-bank/accounts/${editing.id}` : `${API}/cash-bank/accounts`;
      const method = editing ? "PATCH" : "POST";
      await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      setShowModal(false);
      await load();
    } finally { setSaving(false); }
  };

  const filtered = accounts.filter(a => {
    if (typeFilter !== "all" && a.account_type !== typeFilter) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.bank_name?.toLowerCase().includes(search.toLowerCase()) && !a.account_number?.includes(search)) return false;
    return true;
  });

  const f = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white">Rekening Kas & Bank</h1>
          <p className="text-sm text-slate-400 mt-0.5">Master rekening perusahaan</p>
        </div>
        <Button onClick={openCreate} className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus size={14} className="mr-1.5" /> Tambah Rekening
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input value={search} onInput={(e: any) => setSearch(e.target.value)} placeholder="Cari nama, bank, nomor rekening..." className="max-w-xs bg-slate-800 border-slate-700 text-white" />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 bg-slate-800 border-slate-700 text-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Tipe</SelectItem>
            {ACCOUNT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={load} className="text-slate-400 hover:text-white">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {/* Accounts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(acc => (
          <Card key={acc.id} style={{ background: "#1E293B", border: acc.is_default ? "1px solid rgba(249,115,22,0.5)" : "1px solid rgba(255,255,255,0.08)" }}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(59,130,246,0.15)" }}>
                    <Landmark size={16} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white flex items-center gap-1">
                      {acc.name}
                      {acc.is_default && <Star size={10} className="text-orange-400 fill-orange-400" />}
                    </p>
                    <p className="text-xs text-slate-500">{acc.bank_name ?? "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TYPE_COLOR[acc.account_type] ?? "bg-slate-700 text-slate-300"}`}>
                    {ACCOUNT_TYPES.find(t => t.value === acc.account_type)?.label ?? acc.account_type}
                  </span>
                </div>
              </div>

              <div className="space-y-1 text-xs text-slate-400 mb-3">
                {acc.account_number && <p>No Rek: <span className="text-white font-mono">{acc.account_number}</span></p>}
                {acc.account_holder && <p>Atas Nama: <span className="text-slate-300">{acc.account_holder}</span></p>}
                {acc.coa_code && <p>COA: <span className="text-slate-300 font-mono">{acc.coa_code} — {acc.coa_name}</span></p>}
                {acc.category_name && <p>Kategori: <span className="text-slate-300">{acc.category_name}</span></p>}
              </div>

              <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <p className="text-[10px] text-slate-500">Saldo</p>
                  <p className={`text-base font-black ${parseFloat(acc.balance) >= 0 ? "text-green-400" : "text-red-400"}`}>
                    Rp {fmt(acc.balance)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {acc.is_active ? <CheckCircle2 size={14} className="text-green-400" /> : <XCircle size={14} className="text-red-400" />}
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-400 hover:text-white" onClick={() => openEdit(acc)}>
                    <Pencil size={12} />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!loading && !filtered.length && (
          <div className="col-span-full text-center py-12 text-slate-500">
            <Landmark size={32} className="mx-auto mb-3 text-slate-700" />
            <p>Belum ada rekening. Klik "Tambah Rekening" untuk memulai.</p>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Rekening" : "Tambah Rekening Baru"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label className="text-xs text-slate-400">Nama Rekening *</Label>
              <Input value={form.name} onInput={(e: any) => f("name")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="cth: BCA Operasional" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Tipe Rekening *</Label>
              <Select value={form.account_type} onValueChange={f("account_type")}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{ACCOUNT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Metode Rekonsiliasi</Label>
              <Select value={form.reconciliation_method} onValueChange={f("reconciliation_method")}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{RECON_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Nama Bank</Label>
              <Input value={form.bank_name} onInput={(e: any) => f("bank_name")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="cth: BCA" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Nomor Rekening</Label>
              <Input value={form.account_number} onInput={(e: any) => f("account_number")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="cth: 1234567890" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Atas Nama</Label>
              <Input value={form.account_holder} onInput={(e: any) => f("account_holder")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Mata Uang</Label>
              <Input value={form.currency_code} onInput={(e: any) => f("currency_code")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="IDR" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Link COA (Kas/Bank)</Label>
              <Select value={form.coa_id} onValueChange={f("coa_id")}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1"><SelectValue placeholder="Pilih COA..." /></SelectTrigger>
                <SelectContent>
                  {coaOptions.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <span className="font-mono text-xs text-slate-400 mr-2">{c.code}</span>{c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Kategori</Label>
              <Select value={form.category_id || "__none__"} onValueChange={(v) => f("category_id")(v === "__none__" ? "" : v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1"><SelectValue placeholder="Pilih kategori..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Tanpa Kategori —</SelectItem>
                  {categories.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Saldo Awal (Rp)</Label>
              <Input type="number" value={form.opening_balance} onInput={(e: any) => f("opening_balance")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Saldo Minimum (Rp)</Label>
              <Input type="number" value={form.minimum_balance} onInput={(e: any) => f("minimum_balance")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Cabang Bank</Label>
              <Input value={form.bank_branch} onInput={(e: any) => f("bank_branch")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="cth: Jakarta Pusat" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">SWIFT Code</Label>
              <Input value={form.swift_code} onInput={(e: any) => f("swift_code")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="cth: CENAIDJA" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs text-slate-400">Keterangan</Label>
              <Input value={form.description} onInput={(e: any) => f("description")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={form.is_default} onChange={(e: any) => setForm(p => ({ ...p, is_default: e.target.checked }))} className="accent-orange-500" id="is_default" />
              <Label htmlFor="is_default" className="text-xs text-slate-300 cursor-pointer">Rekening Default</Label>
            </div>
            {editing && (
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={form.is_active} onChange={(e: any) => setForm(p => ({ ...p, is_active: e.target.checked }))} className="accent-orange-500" id="is_active" />
                <Label htmlFor="is_active" className="text-xs text-slate-300 cursor-pointer">Aktif</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowModal(false)} className="text-slate-400">Batal</Button>
            <Button onClick={save} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving ? "Menyimpan..." : editing ? "Simpan Perubahan" : "Tambah Rekening"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
