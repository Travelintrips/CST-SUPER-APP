import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useCompany } from "@/contexts/CompanyContext";
import { Settings, RefreshCw, Plus, Camera, Tag, ArrowLeft } from "lucide-react";

const API = "/api";

export default function CashBankSettings() {
  const { activeCompanyId } = useCompany();
  const [settings, setSettings] = useState<any>({ accounts: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [showCatModal, setShowCatModal] = useState(false);
  const [catForm, setCatForm] = useState({ name: "", description: "", color: "#6B7280" });
  const [saving, setSaving] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const r = await fetch(`${API}/cash-bank/settings?companyId=${activeCompanyId}`, { credentials: "include" })
      .then(d => d.json()).catch(() => ({ accounts: [], categories: [] }));
    setSettings(r);
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const saveCategory = async () => {
    if (!catForm.name) return;
    setSaving(true);
    try {
      await fetch(`${API}/cash-bank/categories`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ ...catForm, companyId: activeCompanyId }),
      });
      setShowCatModal(false);
      setCatForm({ name: "", description: "", color: "#6B7280" });
      await load();
    } finally { setSaving(false); }
  };

  const takeSnapshot = async () => {
    if (!activeCompanyId) return;
    setSnapshotLoading(true);
    const r = await fetch(`${API}/cash-bank/history/snapshot`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ companyId: activeCompanyId }),
    }).then(d => d.json()).catch(() => ({ data: [] }));
    setSnapshotResult(r.data ?? []);
    setSnapshotLoading(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="animate-spin text-orange-400" size={28} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => window.history.back()}
          aria-label="Kembali"
          className="rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <Settings size={24} className="text-orange-400" />
        <div>
          <h1 className="text-2xl font-black text-white">Pengaturan Cash & Bank</h1>
          <p className="text-sm text-slate-400 mt-0.5">Konfigurasi kategori, snapshot saldo, dan opsi modul</p>
        </div>
      </div>

      {/* Categories */}
      <Card style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
            <Tag size={14} /> Kategori Rekening
          </CardTitle>
          <Button size="sm" onClick={() => setShowCatModal(true)} className="h-7 px-3 text-xs bg-orange-500 hover:bg-orange-600 text-white">
            <Plus size={12} className="mr-1" /> Tambah
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {settings.categories?.map((cat: any) => (
              <div key={cat.id} className="rounded-xl p-3 flex items-center gap-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.color }} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-300 truncate">{cat.name}</p>
                  {cat.description && <p className="text-[10px] text-slate-500 truncate">{cat.description}</p>}
                </div>
              </div>
            ))}
            {!settings.categories?.length && <p className="text-xs text-slate-500 col-span-full">Belum ada kategori.</p>}
          </div>
        </CardContent>
      </Card>

      {/* Balance Snapshot */}
      <Card style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
            <Camera size={14} /> Snapshot Saldo Harian
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-400">
            Snapshot mencatat saldo penutup seluruh rekening aktif hari ini ke tabel <span className="font-mono text-slate-300">cash_bank_balance_history</span> untuk keperluan laporan dan trend.
          </p>
          <Button onClick={takeSnapshot} disabled={snapshotLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
            {snapshotLoading ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : <Camera size={14} className="mr-1.5" />}
            {snapshotLoading ? "Menyimpan Snapshot..." : "Ambil Snapshot Saldo Sekarang"}
          </Button>
          {snapshotResult.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-slate-400 font-semibold">Hasil snapshot hari ini:</p>
              {snapshotResult.map((r: any) => (
                <div key={r.account_id} className="flex justify-between text-xs py-1.5 px-3 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <span className="text-slate-300">{r.name}</span>
                  <span className="font-mono text-green-400">Rp {new Intl.NumberFormat("id-ID").format(r.closing_balance)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Accounts Summary in Settings */}
      <Card style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-slate-300 uppercase tracking-widest">Ringkasan Rekening</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {settings.accounts?.map((acc: any) => (
              <div key={acc.id} className="flex items-center justify-between text-xs py-2 px-3 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <div className="flex items-center gap-3">
                  <span className={`w-1.5 h-1.5 rounded-full ${acc.is_active ? "bg-green-400" : "bg-slate-600"}`} />
                  <span className="text-slate-300 font-medium">{acc.name}</span>
                  {acc.bank_name && <span className="text-slate-500">{acc.bank_name}</span>}
                  {acc.coa_code && <span className="text-slate-600 font-mono">{acc.coa_code}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {acc.category_name && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">{acc.category_name}</span>}
                  <span className="text-slate-500">{acc.currency_code ?? acc.currency ?? "IDR"}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Add Category Modal */}
      <Dialog open={showCatModal} onOpenChange={setShowCatModal}>
        <DialogContent style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
          <DialogHeader><DialogTitle>Tambah Kategori Rekening</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs text-slate-400">Nama Kategori *</Label>
              <Input value={catForm.name} onInput={(e: any) => setCatForm(p => ({ ...p, name: e.target.value }))} className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="cth: Operational" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Deskripsi</Label>
              <Input value={catForm.description} onInput={(e: any) => setCatForm(p => ({ ...p, description: e.target.value }))} className="bg-slate-800 border-slate-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Warna</Label>
              <div className="flex items-center gap-2 mt-1">
                <input type="color" value={catForm.color} onChange={(e: any) => setCatForm(p => ({ ...p, color: e.target.value }))} className="w-10 h-8 rounded cursor-pointer bg-slate-800 border-slate-700" />
                <span className="text-xs text-slate-400 font-mono">{catForm.color}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCatModal(false)} className="text-slate-400">Batal</Button>
            <Button onClick={saveCategory} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving ? "Menyimpan..." : "Tambah Kategori"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
