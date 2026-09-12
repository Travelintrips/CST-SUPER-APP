import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useCompany } from "@/contexts/CompanyContext";
import { Plus, ArrowLeftRight, CheckCircle2, XCircle, Clock, RefreshCw, AlertTriangle, ArrowLeft } from "lucide-react";

const API = "/api";
function fmt(n: number | string) { return new Intl.NumberFormat("id-ID").format(Number(n) || 0); }

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  DRAFT:     { label: "Draft",     color: "bg-slate-700 text-slate-300" },
  APPROVED:  { label: "Disetujui", color: "bg-blue-500/20 text-blue-300" },
  COMPLETED: { label: "Selesai",   color: "bg-green-500/20 text-green-300" },
  CANCELLED: { label: "Dibatalkan",color: "bg-red-500/20 text-red-300" },
  VOID:      { label: "Void",      color: "bg-gray-600/20 text-gray-400" },
  posted:    { label: "Selesai",   color: "bg-green-500/20 text-green-300" },
};

export default function CashBankTransfers() {
  const { activeCompanyId } = useCompany();
  const [transfers, setTransfers] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [form, setForm] = useState({ from_account_id: "", to_account_id: "", amount: "", date: new Date().toISOString().slice(0,10), description: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const [trR, accR] = await Promise.all([
      fetch(`${API}/cash-bank/transfers?companyId=${activeCompanyId}&limit=100`, { credentials: "include" }).then(r => r.json()),
      fetch(`${API}/cash-bank/accounts?companyId=${activeCompanyId}`, { credentials: "include" }).then(r => r.json()),
    ]);
    setTransfers(trR.data ?? []);
    setAccounts((accR.data ?? []).filter((a: any) => a.is_active));
    setLoading(false);
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.from_account_id || !form.to_account_id || !form.amount || !form.date) return;
    setSaving(true);
    try {
      await fetch(`${API}/cash-bank/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, companyId: activeCompanyId }),
      });
      setShowModal(false);
      setForm({ from_account_id: "", to_account_id: "", amount: "", date: new Date().toISOString().slice(0,10), description: "", notes: "" });
      await load();
    } finally { setSaving(false); }
  };

  const action = async (id: number, endpoint: string, body?: any) => {
    setActionLoading(id);
    try {
      await fetch(`${API}/cash-bank/transfers/${id}/${endpoint}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
    } finally { setActionLoading(null); }
  };

  const filtered = transfers.filter(t => statusFilter === "all" || t.status === statusFilter);

  const f = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            aria-label="Kembali"
            className="rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-black text-white">Transfer Dana</h1>
            <p className="text-sm text-slate-400 mt-0.5">Transfer antar rekening internal</p>
          </div>
        </div>
        <Button onClick={() => setShowModal(true)} className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus size={14} className="mr-1.5" /> Transfer Baru
        </Button>
      </div>

      {/* Filter */}
      <div className="flex gap-3 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            {Object.entries(STATUS_CFG).filter(([k]) => k !== "posted").map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={load} className="text-slate-400 hover:text-white">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {/* Transfers List */}
      <div className="space-y-3">
        {filtered.map(tr => {
          const cfg = STATUS_CFG[tr.status] ?? { label: tr.status, color: "bg-slate-700 text-slate-300" };
          const isLoading = actionLoading === tr.id;
          return (
            <Card key={tr.id} style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.08)" }}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(249,115,22,0.1)" }}>
                      <ArrowLeftRight size={16} className="text-orange-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-slate-300">{tr.transfer_number}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                      </div>
                      <p className="text-sm text-white font-semibold mt-0.5">
                        {tr.from_account_name} → {tr.to_account_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {tr.from_bank} → {tr.to_bank} • {tr.date}
                      </p>
                      {tr.description && <p className="text-xs text-slate-400 mt-0.5">{tr.description}</p>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-black text-orange-400">Rp {fmt(tr.amount)}</p>
                    <div className="flex items-center gap-1.5 mt-2 justify-end flex-wrap">
                      {tr.status === "DRAFT" && (
                        <>
                          <Button size="sm" disabled={isLoading} onClick={() => action(tr.id, "approve")} className="h-7 px-2.5 text-xs bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30">
                            {isLoading ? "..." : "Setujui"}
                          </Button>
                          <Button size="sm" disabled={isLoading} onClick={() => action(tr.id, "complete")} className="h-7 px-2.5 text-xs bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/30">
                            {isLoading ? "..." : "Selesaikan"}
                          </Button>
                          <Button size="sm" disabled={isLoading} onClick={() => action(tr.id, "cancel", { reason: "Dibatalkan manual" })} className="h-7 px-2.5 text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30">
                            {isLoading ? "..." : "Batalkan"}
                          </Button>
                        </>
                      )}
                      {tr.status === "APPROVED" && (
                        <>
                          <Button size="sm" disabled={isLoading} onClick={() => action(tr.id, "complete")} className="h-7 px-2.5 text-xs bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/30">
                            {isLoading ? "..." : "Selesaikan & Posting Jurnal"}
                          </Button>
                          <Button size="sm" disabled={isLoading} onClick={() => action(tr.id, "cancel", { reason: "Dibatalkan" })} className="h-7 px-2.5 text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30">
                            {isLoading ? "..." : "Batalkan"}
                          </Button>
                        </>
                      )}
                      {tr.status === "COMPLETED" && (
                        <Button size="sm" disabled={isLoading} onClick={() => setShowVoidModal(tr)} className="h-7 px-2.5 text-xs bg-gray-600/20 text-gray-400 hover:bg-gray-600/30 border border-gray-600/30">
                          Void
                        </Button>
                      )}
                      {tr.entry_id && (
                        <span className="text-[10px] text-slate-500 font-mono">JE #{tr.entry_id}</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!loading && !filtered.length && (
          <div className="text-center py-12 text-slate-500">
            <ArrowLeftRight size={32} className="mx-auto mb-3 text-slate-700" />
            <p>Belum ada transfer. Klik "Transfer Baru" untuk mulai.</p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
          <DialogHeader><DialogTitle>Transfer Dana Antar Rekening</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 rounded-xl text-xs" style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", color: "#FCD34D" }}>
              <AlertTriangle size={12} className="inline mr-1" />
              Jurnal otomatis hanya dibuat saat status "Selesaikan". Rekening harus terhubung ke COA.
            </div>
            <div>
              <Label className="text-xs text-slate-400">Rekening Asal *</Label>
              <Select value={form.from_account_id} onValueChange={f("from_account_id")}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1"><SelectValue placeholder="Pilih rekening asal..." /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a: any) => <SelectItem key={a.id} value={String(a.id)}>{a.name} {a.bank_name ? `(${a.bank_name})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Rekening Tujuan *</Label>
              <Select value={form.to_account_id} onValueChange={f("to_account_id")}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1"><SelectValue placeholder="Pilih rekening tujuan..." /></SelectTrigger>
                <SelectContent>
                  {accounts.filter(a => String(a.id) !== form.from_account_id).map((a: any) => <SelectItem key={a.id} value={String(a.id)}>{a.name} {a.bank_name ? `(${a.bank_name})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-400">Jumlah (Rp) *</Label>
                <Input type="number" value={form.amount} onInput={(e: any) => f("amount")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-xs text-slate-400">Tanggal *</Label>
                <DatePicker value={form.date} onChange={(v) => f("date")(v)} className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Keterangan</Label>
              <Input value={form.description} onInput={(e: any) => f("description")(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="cth: Transfer modal kerja" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowModal(false)} className="text-slate-400">Batal</Button>
            <Button onClick={save} disabled={saving} className="bg-orange-500 hover:bg-orange-600 text-white">
              {saving ? "Menyimpan..." : "Buat Transfer (Draft)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Modal */}
      <Dialog open={!!showVoidModal} onOpenChange={() => setShowVoidModal(null)}>
        <DialogContent style={{ background: "#1E293B", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
          <DialogHeader><DialogTitle>Void Transfer</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-slate-300">Void transfer <span className="font-mono text-orange-400">{showVoidModal?.transfer_number}</span>?</p>
            <div>
              <Label className="text-xs text-slate-400">Alasan Void *</Label>
              <Input value={voidReason} onInput={(e: any) => setVoidReason(e.target.value)} className="bg-slate-800 border-slate-700 text-white mt-1" placeholder="Jelaskan alasan void..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowVoidModal(null)} className="text-slate-400">Batal</Button>
            <Button onClick={async () => {
              if (!voidReason) return;
              await action(showVoidModal.id, "void", { reason: voidReason });
              setShowVoidModal(null); setVoidReason("");
            }} className="bg-red-600 hover:bg-red-700 text-white">Konfirmasi Void</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
