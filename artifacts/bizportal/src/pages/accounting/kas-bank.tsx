import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/contexts/CompanyContext";
import {
  Building2, Plus, Pencil, Trash2, ArrowLeftRight, RefreshCw,
  Banknote, Wallet, CreditCard, Eye,
  ArrowUpRight, ArrowDownLeft,
} from "lucide-react";

const API = "/api";

function fmt(n: number | string) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n));
}

function fmtDate(d: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank: "Bank",
  cash: "Kas",
  giro: "Giro",
  deposito: "Deposito",
};

const ACCOUNT_TYPE_ICONS: Record<string, any> = {
  bank: Building2,
  cash: Wallet,
  giro: CreditCard,
  deposito: Banknote,
};

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  bank: "rgba(59,130,246,0.15)",
  cash: "rgba(34,197,94,0.15)",
  giro: "rgba(168,85,247,0.15)",
  deposito: "rgba(245,158,11,0.15)",
};

export default function KasBankPage() {
  const { activeCompanyId } = useCompany();

  const [accounts, setAccounts] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [mutations, setMutations] = useState<any[]>([]);
  const [coaList, setCoaList] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("rekening");
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [mutationAccount, setMutationAccount] = useState<any>(null);

  // Modals
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [editAccount, setEditAccount] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // Form states
  const [accForm, setAccForm] = useState({
    name: "", account_type: "bank", bank_name: "", account_number: "",
    currency: "IDR", coa_id: "", notes: "",
  });
  const [trfForm, setTrfForm] = useState({
    from_account_id: "", to_account_id: "", amount: "", date: new Date().toISOString().split("T")[0], description: "",
  });

  const fetchAll = useCallback(async () => {
    if (activeCompanyId === null || activeCompanyId === undefined || activeCompanyId === 0) return;
    setLoading(true);
    try {
      const [accRes, sumRes, trfRes, coaRes] = await Promise.all([
        fetch(`${API}/accounting/kas-bank/accounts?companyId=${activeCompanyId}`, { credentials: "include" }),
        fetch(`${API}/accounting/kas-bank/summary?companyId=${activeCompanyId}`, { credentials: "include" }),
        fetch(`${API}/accounting/kas-bank/transfers?companyId=${activeCompanyId}`, { credentials: "include" }),
        fetch(`${API}/accounting/kas-bank/coa-cash-bank?companyId=${activeCompanyId}`, { credentials: "include" }),
      ]);
      const [accData, sumData, trfData, coaData] = await Promise.all([
        accRes.json(), sumRes.json(), trfRes.json(), coaRes.json(),
      ]);
      setAccounts(accData.data ?? []);
      setSummary(sumData.data ?? []);
      setTransfers(trfData.data ?? []);
      setCoaList(coaData.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  async function fetchMutations(account: any) {
    setMutationAccount(account);
    setMutations([]);
    setTab("mutasi");
    const res = await fetch(
      `${API}/accounting/kas-bank/mutations?companyId=${activeCompanyId}&accountId=${account.id}`,
      { credentials: "include" }
    );
    const data = await res.json();
    setMutations(data.data ?? []);
  }

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  function openAdd() {
    setEditAccount(null);
    setAccForm({ name: "", account_type: "bank", bank_name: "", account_number: "", currency: "IDR", coa_id: "", notes: "" });
    setShowAccountModal(true);
  }

  function openEdit(acc: any) {
    setEditAccount(acc);
    setAccForm({
      name: acc.name, account_type: acc.account_type, bank_name: acc.bank_name ?? "",
      account_number: acc.account_number ?? "", currency: acc.currency ?? "IDR",
      coa_id: acc.coa_id ? String(acc.coa_id) : "", notes: acc.notes ?? "",
    });
    setShowAccountModal(true);
  }

  async function saveAccount() {
    setSaving(true);
    try {
      const url = editAccount
        ? `${API}/accounting/kas-bank/accounts/${editAccount.id}`
        : `${API}/accounting/kas-bank/accounts`;
      const method = editAccount ? "PUT" : "POST";
      await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...accForm, companyId: activeCompanyId, coa_id: accForm.coa_id || null }),
      });
      setShowAccountModal(false);
      fetchAll();
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(acc: any) {
    if (!confirm(`Nonaktifkan rekening "${acc.name}"?`)) return;
    await fetch(`${API}/accounting/kas-bank/accounts/${acc.id}`, { method: "DELETE", credentials: "include" });
    fetchAll();
  }

  async function saveTransfer() {
    setSaving(true);
    try {
      const res = await fetch(`${API}/accounting/kas-bank/transfers`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...trfForm, companyId: activeCompanyId }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? "Gagal transfer"); return; }
      setShowTransferModal(false);
      setTrfForm({ from_account_id: "", to_account_id: "", amount: "", date: new Date().toISOString().split("T")[0], description: "" });
      fetchAll();
    } finally {
      setSaving(false);
    }
  }

  const totalSaldo = summary.reduce((s: number, r: any) => s + Number(r.total_saldo ?? 0), 0);

  if (activeCompanyId === 0 || !activeCompanyId) {
    return (
      <AppShell>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="rounded-xl p-3" style={{ background: "rgba(59,130,246,0.15)" }}>
              <Building2 className="h-6 w-6 text-blue-400" />
            </div>
            <h1 className="text-2xl font-black tracking-tight">Kas & Bank</h1>
          </div>
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Pilih perusahaan spesifik (bukan "Semua Perusahaan") untuk melihat rekening Kas & Bank.
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl p-3" style={{ background: "rgba(59,130,246,0.15)" }}>
              <Building2 className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">Kas & Bank</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Manajemen rekening, saldo real-time, dan transfer antar rekening</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => { setShowTransferModal(true); }} variant="outline">
              <ArrowLeftRight className="h-4 w-4 mr-1.5" />
              Transfer
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1.5" />
              Rekening Baru
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}>
            <CardContent className="p-4">
              <p className="text-xs text-blue-300 font-medium mb-1">Total Saldo</p>
              <p className="text-xl font-black text-blue-400">{fmt(totalSaldo)}</p>
              <p className="text-[10px] text-slate-500 mt-1">Semua rekening aktif</p>
            </CardContent>
          </Card>
          {summary.map((s: any) => {
            const Icon = ACCOUNT_TYPE_ICONS[s.account_type] ?? Building2;
            return (
              <Card key={s.account_type} style={{ background: ACCOUNT_TYPE_COLORS[s.account_type] ?? "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className="h-3.5 w-3.5 text-slate-400" />
                    <p className="text-xs text-slate-400 font-medium">{ACCOUNT_TYPE_LABELS[s.account_type] ?? s.account_type}</p>
                  </div>
                  <p className="text-lg font-black">{fmt(s.total_saldo)}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{s.jumlah_rekening} rekening</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="rekening">Daftar Rekening</TabsTrigger>
            <TabsTrigger value="transfer">Transfer</TabsTrigger>
            {mutationAccount && (
              <TabsTrigger value="mutasi">
                Mutasi — {mutationAccount.name}
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Tab: Rekening ── */}
          <TabsContent value="rekening" className="mt-4">
            {accounts.length === 0 && !loading && (
              <div className="text-center py-16 text-slate-500">
                <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Belum ada rekening</p>
                <p className="text-sm mt-1">Klik "Rekening Baru" untuk menambahkan rekening kas/bank</p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((acc: any) => {
                const Icon = ACCOUNT_TYPE_ICONS[acc.account_type] ?? Building2;
                const saldo = Number(acc.balance ?? 0);
                return (
                  <Card key={acc.id} style={{ background: "#1E293B", border: acc.is_active ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.04)", opacity: acc.is_active ? 1 : 0.5 }}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="rounded-lg p-1.5" style={{ background: ACCOUNT_TYPE_COLORS[acc.account_type] ?? "rgba(255,255,255,0.05)" }}>
                            <Icon className="h-4 w-4 text-slate-300" />
                          </div>
                          <div>
                            <p className="font-bold text-sm leading-tight">{acc.name}</p>
                            {acc.bank_name && <p className="text-[10px] text-slate-500">{acc.bank_name}</p>}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] px-1.5">
                          {ACCOUNT_TYPE_LABELS[acc.account_type] ?? acc.account_type}
                        </Badge>
                      </div>

                      {acc.account_number && (
                        <p className="text-xs text-slate-400 font-mono mb-2">{acc.account_number}</p>
                      )}

                      <div className="rounded-lg px-3 py-2 mb-3" style={{ background: "rgba(0,0,0,0.2)" }}>
                        <p className="text-[10px] text-slate-500 mb-0.5">Saldo (dari journal)</p>
                        <p className={`text-lg font-black ${saldo >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {fmt(saldo)}
                        </p>
                      </div>

                      {acc.coa_code && (
                        <p className="text-[10px] text-slate-500 mb-3">
                          COA: <span className="font-mono text-slate-400">{acc.coa_code} — {acc.coa_name}</span>
                        </p>
                      )}

                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => fetchMutations(acc)}>
                          <Eye className="h-3 w-3 mr-1" /> Mutasi
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => openEdit(acc)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-red-400 hover:text-red-300" onClick={() => deleteAccount(acc)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* ── Tab: Transfer ── */}
          <TabsContent value="transfer" className="mt-4">
            <Card style={{ background: "#1A2332", border: "1px solid rgba(255,255,255,0.08)" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Riwayat Transfer Antar Rekening</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {transfers.length === 0 ? (
                  <p className="text-center py-10 text-slate-500 text-sm">Belum ada transfer</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          {["No. Transfer", "Tanggal", "Dari", "Ke", "Nominal", "Status"].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-400">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {transfers.map((t: any) => (
                          <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <td className="px-4 py-2.5 font-mono text-slate-300">{t.transfer_number}</td>
                            <td className="px-4 py-2.5 text-slate-300">{fmtDate(t.date)}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1">
                                <ArrowUpRight className="h-3 w-3 text-red-400 shrink-0" />
                                <span>{t.from_account_name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1">
                                <ArrowDownLeft className="h-3 w-3 text-green-400 shrink-0" />
                                <span>{t.to_account_name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 font-semibold text-orange-300">{fmt(t.amount)}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant="outline" className="text-[10px] px-1.5 text-green-400 border-green-800">
                                {t.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab: Mutasi ── */}
          <TabsContent value="mutasi" className="mt-4">
            {mutationAccount && (
              <Card style={{ background: "#1A2332", border: "1px solid rgba(255,255,255,0.08)" }}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    Mutasi: {mutationAccount.name}
                    {mutationAccount.account_number && (
                      <span className="font-mono text-xs text-slate-400">{mutationAccount.account_number}</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {mutations.length === 0 ? (
                    <p className="text-center py-10 text-slate-500 text-sm">Belum ada mutasi untuk rekening ini</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                            {["Tanggal", "No. Entry", "Keterangan", "Debit", "Kredit", "Saldo"].map(h => (
                              <th key={h} className="px-4 py-2.5 text-left font-semibold text-slate-400">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {mutations.map((m: any, i: number) => (
                            <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                              <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">{fmtDate(m.date)}</td>
                              <td className="px-4 py-2.5 font-mono text-slate-400 text-[10px]">{m.entry_number}</td>
                              <td className="px-4 py-2.5 text-slate-300 max-w-xs truncate">{m.line_description || m.description}</td>
                              <td className="px-4 py-2.5 text-green-400 font-semibold">
                                {Number(m.debit) > 0 ? fmt(m.debit) : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-red-400 font-semibold">
                                {Number(m.credit) > 0 ? fmt(m.credit) : "—"}
                              </td>
                              <td className={`px-4 py-2.5 font-bold ${Number(m.saldo_berjalan) >= 0 ? "text-blue-300" : "text-red-400"}`}>
                                {fmt(m.saldo_berjalan)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Modal: Tambah / Edit Rekening ── */}
      <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
        <DialogContent className="max-w-lg" style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)" }}>
          <DialogHeader>
            <DialogTitle>{editAccount ? "Edit Rekening" : "Rekening Baru"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-slate-400 mb-1.5 block">Nama Rekening *</Label>
              <Input value={accForm.name} onChange={e => setAccForm(p => ({ ...p, name: e.target.value }))} placeholder="Contoh: BCA Operasional" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-400 mb-1.5 block">Jenis *</Label>
                <Select value={accForm.account_type} onValueChange={v => setAccForm(p => ({ ...p, account_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1.5 block">Mata Uang</Label>
                <Select value={accForm.currency} onValueChange={v => setAccForm(p => ({ ...p, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IDR">IDR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="SGD">SGD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-400 mb-1.5 block">Nama Bank</Label>
                <Input value={accForm.bank_name} onChange={e => setAccForm(p => ({ ...p, bank_name: e.target.value }))} placeholder="BCA, Mandiri, BNI..." />
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1.5 block">No. Rekening</Label>
                <Input value={accForm.account_number} onChange={e => setAccForm(p => ({ ...p, account_number: e.target.value }))} placeholder="1234567890" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-400 mb-1.5 block">Akun COA (Kas/Bank)</Label>
              <Select value={accForm.coa_id || "__none__"} onValueChange={v => setAccForm(p => ({ ...p, coa_id: v === "__none__" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih akun COA..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Tidak ada —</SelectItem>
                  {coaList.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <span className="font-mono text-xs text-slate-400 mr-1">{c.code}</span>{c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-500 mt-1">Pilih akun COA agar saldo terhitung otomatis dari journal entries</p>
            </div>
            <div>
              <Label className="text-xs text-slate-400 mb-1.5 block">Catatan</Label>
              <Input value={accForm.notes} onChange={e => setAccForm(p => ({ ...p, notes: e.target.value }))} placeholder="Opsional..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAccountModal(false)}>Batal</Button>
            <Button onClick={saveAccount} disabled={saving || !accForm.name || !accForm.account_type}>
              {saving ? "Menyimpan..." : editAccount ? "Simpan Perubahan" : "Tambah Rekening"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Transfer Antar Rekening ── */}
      <Dialog open={showTransferModal} onOpenChange={setShowTransferModal}>
        <DialogContent className="max-w-md" style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" /> Transfer Antar Rekening
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-slate-400 mb-1.5 block">Dari Rekening *</Label>
              <Select value={trfForm.from_account_id} onValueChange={v => setTrfForm(p => ({ ...p, from_account_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih rekening asal..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts.filter((a: any) => a.is_active && a.coa_id).map((a: any) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name} {a.bank_name ? `(${a.bank_name})` : ""} — {fmt(a.balance)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400 mb-1.5 block">Ke Rekening *</Label>
              <Select value={trfForm.to_account_id} onValueChange={v => setTrfForm(p => ({ ...p, to_account_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih rekening tujuan..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts.filter((a: any) => a.is_active && a.coa_id && String(a.id) !== trfForm.from_account_id).map((a: any) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name} {a.bank_name ? `(${a.bank_name})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-400 mb-1.5 block">Nominal *</Label>
                <Input
                  type="number"
                  value={trfForm.amount}
                  onChange={e => setTrfForm(p => ({ ...p, amount: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-400 mb-1.5 block">Tanggal *</Label>
                <DatePicker value={trfForm.date} onChange={v => setTrfForm(p => ({ ...p, date: v }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-400 mb-1.5 block">Keterangan</Label>
              <Input value={trfForm.description} onChange={e => setTrfForm(p => ({ ...p, description: e.target.value }))} placeholder="Opsional..." />
            </div>

            {trfForm.from_account_id && trfForm.to_account_id && trfForm.amount && (
              <div className="rounded-xl px-4 py-3 text-xs space-y-1" style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)" }}>
                <p className="font-semibold text-blue-300 mb-2">Preview Journal Entry</p>
                <div className="flex justify-between">
                  <span className="text-slate-400">Debit — {accounts.find((a: any) => String(a.id) === trfForm.to_account_id)?.name}</span>
                  <span className="text-green-400 font-mono">{fmt(trfForm.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kredit — {accounts.find((a: any) => String(a.id) === trfForm.from_account_id)?.name}</span>
                  <span className="text-red-400 font-mono">{fmt(trfForm.amount)}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransferModal(false)}>Batal</Button>
            <Button
              onClick={saveTransfer}
              disabled={saving || !trfForm.from_account_id || !trfForm.to_account_id || !trfForm.amount || !trfForm.date}
            >
              {saving ? "Memproses..." : "Proses Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
