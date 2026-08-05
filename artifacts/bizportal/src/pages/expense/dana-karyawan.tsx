import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import {
  ArrowLeft, Wallet, HandCoins, ArrowRight, Clock, CheckCircle,
  XCircle, Banknote, Users, TrendingUp, RefreshCw, ExternalLink,
  AlertCircle, Receipt, Loader2,
} from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const fmtIDR = (raw: string) => {
  const d = raw.replace(/\D/g, "");
  return d ? Number(d).toLocaleString("id-ID") : "";
};
const parseIDR = (v: string) => { const n = Number(v.replace(/\D/g, "")); return isNaN(n) ? 0 : n; };

interface AdvanceSummary {
  id: number;
  advanceNumber: string;
  type: "kasbon" | "talangan";
  employeeName: string;
  amount: number;
  remainingAmount?: number;
  lifecycleStatus?: string;
  status: string;
  createdAt: string;
}

interface ExpenseAccount {
  id: number;
  code: string;
  name: string;
}

const SETTLEABLE_LIFECYCLE = ["disbursed", "outstanding", "partially_settled"];

interface AdvancesResponse {
  advances: AdvanceSummary[];
  total: number;
}

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  pending:    { label: "Menunggu",   className: "bg-yellow-100 text-yellow-800 border-yellow-300",  icon: <Clock size={11} /> },
  approved:   { label: "Disetujui", className: "bg-blue-100 text-blue-800 border-blue-300",         icon: <CheckCircle size={11} /> },
  disbursed:  { label: "Dicairkan", className: "bg-green-100 text-green-800 border-green-300",      icon: <Banknote size={11} /> },
  settled:    { label: "Lunas",     className: "bg-slate-100 text-slate-700 border-slate-300",      icon: <CheckCircle size={11} /> },
  rejected:   { label: "Ditolak",   className: "bg-red-100 text-red-700 border-red-300",            icon: <XCircle size={11} /> },
  voided:     { label: "Void",      className: "bg-slate-100 text-slate-500 border-slate-200",      icon: <XCircle size={11} /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: "bg-slate-100 text-slate-600 border-slate-200", icon: null };
  return (
    <Badge variant="outline" className={`text-[10px] flex items-center gap-1 px-1.5 py-0.5 ${cfg.className}`}>
      {cfg.icon}{cfg.label}
    </Badge>
  );
}

function StatCard({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: "amber" | "indigo" | "green" | "slate";
}) {
  const colorMap = {
    amber:  "bg-amber-50 border-amber-200 text-amber-600",
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-600",
    green:  "bg-green-50 border-green-200 text-green-600",
    slate:  "bg-slate-50 border-slate-200 text-slate-500",
  };
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-3 ${colorMap[color]}`}>
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium opacity-80 truncate">{label}</p>
        <p className="text-lg font-black text-slate-900 leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-[11px] opacity-70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function DanaKaryawanPage() {
  const { activeCompanyId } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"semua" | "kasbon" | "talangan">("semua");
  const [settleTarget, setSettleTarget] = useState<AdvanceSummary | null>(null);

  const { data, isLoading, refetch } = useQuery<AdvancesResponse>({
    queryKey: ["advances-hub", activeCompanyId],
    queryFn: async () => {
      if (!activeCompanyId) return { advances: [], total: 0 };
      const r = await fetch(`/api/advances?companyId=${activeCompanyId}&limit=50`, {
        credentials: "include",
      });
      if (!r.ok) return { advances: [], total: 0 };
      const raw = await r.json() as { advances?: AdvanceSummary[]; data?: AdvanceSummary[] };
      const list: AdvanceSummary[] = raw.advances ?? raw.data ?? [];
      return { advances: list, total: list.length };
    },
    enabled: !!activeCompanyId,
  });

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ["advances-hub", activeCompanyId] });

  const reklasifikasiMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/advances/admin/fix-coa-reclassify?companyId=${activeCompanyId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error((await r.json())?.message ?? "Gagal reklasifikasi");
      return r.json() as Promise<{ corrected: number; message: string }>;
    },
    onSuccess: (d) => {
      toast({ title: d.corrected > 0 ? "✓ Reklasifikasi COA Selesai" : "Tidak Ada Yang Perlu Dikoreksi", description: d.message });
      refreshList();
    },
    onError: (e: Error) => toast({ title: "Gagal", description: e.message, variant: "destructive" }),
  });

  const allAdvances = data?.advances ?? [];
  const isKasbon = (t: string) => t === "employee_kasbon" || t === "kasbon";
  const kasbonList  = allAdvances.filter((a) => isKasbon(a.type));
  const talanganList = allAdvances.filter((a) => !isKasbon(a.type));

  const activeKasbon   = kasbonList.filter((a) => ["pending", "approved", "disbursed"].includes(a.status));
  const activeTalangan = talanganList.filter((a) => ["pending", "approved", "disbursed"].includes(a.status));

  const totalKasbonOutstanding = kasbonList
    .filter((a) => a.status === "disbursed")
    .reduce((s, a) => s + a.amount, 0);
  const totalTalanganOutstanding = talanganList
    .filter((a) => a.status === "disbursed")
    .reduce((s, a) => s + a.amount, 0);

  const displayList =
    tab === "kasbon"   ? kasbonList :
    tab === "talangan" ? talanganList :
    allAdvances;

  return (
    <AppShell>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">

        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/expense">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <ArrowLeft size={15} />
              </Button>
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <Users size={20} className="text-violet-500 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">Dana Karyawan</h1>
                <p className="text-sm text-muted-foreground truncate">
                  Pusat pengelolaan Kasbon & Dana Talangan karyawan
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => reklasifikasiMut.mutate()}
              disabled={reklasifikasiMut.isPending}
              title="Koreksi jurnal kasbon yang salah posting ke COA Piutang Dana Talangan"
            >
              {reklasifikasiMut.isPending
                ? <Loader2 size={13} className="mr-1 animate-spin" />
                : <Receipt size={13} className="mr-1" />}
              Koreksi COA
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw size={13} className="mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* ── Info banner ───────────────────────────────────────── */}
        <div className="flex gap-2.5 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-violet-500 shrink-0 mt-0.5" />
          <div className="text-xs text-violet-700 space-y-0.5">
            <p className="font-semibold">Modul Dana Karyawan — Kasbon & Talangan</p>
            <p>
              Gunakan modul ini untuk mengajukan, menyetujui, mencairkan, dan
              melunasi kasbon atau dana talangan karyawan. Seluruh alur dikelola
              dari sini agar jurnal akuntansi terbuat secara otomatis dan
              konsisten.
            </p>
          </div>
        </div>

        {/* ── Stats ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={<Wallet size={18} />}
            label="Kasbon Aktif"
            value={String(activeKasbon.length)}
            sub={`${idr(totalKasbonOutstanding)} beredar`}
            color="amber"
          />
          <StatCard
            icon={<HandCoins size={18} />}
            label="Talangan Aktif"
            value={String(activeTalangan.length)}
            sub={`${idr(totalTalanganOutstanding)} beredar`}
            color="indigo"
          />
          <StatCard
            icon={<TrendingUp size={18} />}
            label="Total Semua"
            value={String(allAdvances.length)}
            sub="semua status"
            color="slate"
          />
          <StatCard
            icon={<CheckCircle size={18} />}
            label="Lunas"
            value={String(allAdvances.filter((a) => a.status === "settled").length)}
            sub="sudah dipertanggungjawabkan"
            color="green"
          />
        </div>

        {/* ── Module Cards ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Kasbon Karyawan card */}
          <Card className="border-amber-200 hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Wallet size={16} className="text-amber-600" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">Kasbon Karyawan</CardTitle>
                  <p className="text-[11px] text-muted-foreground">DR Piutang Karyawan → CR Kas/Bank</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Uang muka yang diberikan kepada karyawan sebelum pertanggungjawaban
                pengeluaran. Karyawan wajib melaporkan pemakaian dana atau
                mengembalikan sisa dana setelah tugas selesai.
              </p>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {kasbonList.filter((a) => a.status === "pending").length} menunggu approval
                </span>
                <span className="flex items-center gap-1">
                  <Banknote size={11} />
                  {kasbonList.filter((a) => a.status === "disbursed").length} belum lunas
                </span>
              </div>
              <Link href="/expense/kasbon">
                <Button size="sm" className="w-full bg-amber-500 hover:bg-amber-600 text-white gap-1.5">
                  Kelola Kasbon Karyawan <ArrowRight size={13} />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Dana Talangan card */}
          <Card className="border-indigo-200 hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <HandCoins size={16} className="text-indigo-600" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">Dana Talangan</CardTitle>
                  <p className="text-[11px] text-muted-foreground">DR Piutang Talangan → CR Kas/Bank</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Dana yang ditalangi perusahaan untuk kebutuhan operasional
                mendesak. Talangan dapat dikembalikan, diklaim sebagai
                biaya operasional, atau ditutup melalui rekonsiliasi.
              </p>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {talanganList.filter((a) => a.status === "pending").length} menunggu approval
                </span>
                <span className="flex items-center gap-1">
                  <Banknote size={11} />
                  {talanganList.filter((a) => a.status === "disbursed").length} belum lunas
                </span>
              </div>
              <Link href="/expense/talangan">
                <Button size="sm" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white gap-1.5">
                  Kelola Dana Talangan <ArrowRight size={13} />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* ── Daftar Semua ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-sm font-bold">Riwayat Transaksi</CardTitle>
              <div className="flex items-center gap-1">
                {(["semua", "kasbon", "talangan"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                      tab === t
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
                    }`}
                  >
                    {t === "semua" ? "Semua" : t === "kasbon" ? "Kasbon" : "Talangan"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                Memuat data...
              </div>
            ) : displayList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground gap-2">
                <Users size={32} className="text-slate-300" />
                <p>Belum ada transaksi dana karyawan.</p>
              </div>
            ) : (
              <div className="divide-y">
                {displayList.slice(0, 20).map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isKasbon(a.type) ? "bg-amber-100" : "bg-indigo-100"
                      }`}>
                        {isKasbon(a.type)
                          ? <Wallet size={13} className="text-amber-600" />
                          : <HandCoins size={13} className="text-indigo-600" />
                        }
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {a.employeeName || "—"}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {a.advanceNumber} · {isKasbon(a.type) ? "Kasbon" : "Talangan"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <StatusBadge status={a.status} />
                      <p className="text-sm font-bold font-mono text-slate-700">{idr(a.amount)}</p>
                      {SETTLEABLE_LIFECYCLE.includes(a.lifecycleStatus ?? "") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1 border-teal-300 text-teal-700 hover:bg-teal-50"
                          onClick={() => setSettleTarget(a)}
                        >
                          <Receipt size={12} /> Tutup sebagai Beban
                        </Button>
                      )}
                      <Link href={isKasbon(a.type) ? "/expense/kasbon" : "/expense/talangan"}>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <ExternalLink size={12} className="text-slate-400" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
                {displayList.length > 20 && (
                  <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                    Menampilkan 20 dari {displayList.length} transaksi. Buka halaman khusus untuk melihat semua.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      <SettleExpenseDialog
        advance={settleTarget}
        onClose={() => setSettleTarget(null)}
        onSettled={() => { setSettleTarget(null); refreshList(); }}
      />
    </AppShell>
  );
}

// ── Settle-to-Expense Dialog ─────────────────────────────────────────────────
// Closes an advance directly from Dana Karyawan without navigating to the
// Kasbon/Talangan page: posts DR Beban (chosen COA) / CR Piutang Karyawan,
// no cash movement, via POST /api/advances/:id/settle-expense.
function SettleExpenseDialog({
  advance, onClose, onSettled,
}: {
  advance: AdvanceSummary | null;
  onClose: () => void;
  onSettled: () => void;
}) {
  const { toast } = useToast();
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const { data: expenseAccounts = [] } = useQuery<ExpenseAccount[]>({
    queryKey: ["advance-expense-accounts"],
    queryFn: async () => {
      const r = await fetch("/api/advances/expense-accounts", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!advance,
  });

  const resetForm = () => {
    setExpenseAccountId("");
    setAmountRaw("");
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
  };

  const settleMut = useMutation({
    mutationFn: async () => {
      if (!advance) throw new Error("Tidak ada advance yang dipilih");
      const r = await fetch(`/api/advances/${advance.id}/settle-expense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          date,
          expense_account_id: Number(expenseAccountId),
          amount: parseIDR(amountRaw),
          notes: notes || undefined,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message ?? "Gagal menutup sebagai beban");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Berhasil ditutup sebagai beban", description: "Jurnal reklasifikasi telah diposting." });
      resetForm();
      onSettled();
    },
    onError: (err: any) => {
      toast({ title: "Gagal menutup sebagai beban", description: err.message, variant: "destructive" });
    },
  });

  const remaining = advance?.remainingAmount ?? advance?.amount ?? 0;
  const amountValid = parseIDR(amountRaw) > 0 && parseIDR(amountRaw) - remaining <= 0.01;

  return (
    <Dialog open={!!advance} onOpenChange={(open) => { if (!open) { resetForm(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt size={16} className="text-teal-600" /> Tutup sebagai Beban
          </DialogTitle>
          <DialogDescription>
            {advance?.employeeName} · {advance?.advanceNumber} — reklasifikasi ke beban tanpa
            pergerakan kas (dana sudah dibelanjakan &amp; dibuktikan).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-slate-50 border px-3 py-2 text-xs text-slate-600">
            Sisa piutang: <span className="font-mono font-semibold">{idr(remaining)}</span>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Akun Beban</Label>
            <Select value={expenseAccountId} onValueChange={setExpenseAccountId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Pilih akun beban..." /></SelectTrigger>
              <SelectContent>
                {expenseAccounts.map((acc) => (
                  <SelectItem key={acc.id} value={String(acc.id)}>{acc.code} — {acc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nominal</Label>
              <Input
                placeholder="0"
                className="font-mono h-9 text-sm"
                value={amountRaw}
                onChange={(e) => setAmountRaw(fmtIDR(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tanggal</Label>
              <DatePicker value={date} onChange={(v) => setDate(v)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Keterangan</Label>
            <Textarea
              rows={2}
              placeholder="Opsional — deskripsi penggunaan dana..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {parseIDR(amountRaw) > 0 && (
            <div className="text-xs text-muted-foreground rounded bg-muted/30 px-3 py-1.5">
              Jurnal: <strong>DR Beban</strong> · <strong>CR Piutang Karyawan</strong> {idr(parseIDR(amountRaw))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { resetForm(); onClose(); }}>Batal</Button>
          <Button
            onClick={() => settleMut.mutate()}
            disabled={!expenseAccountId || !amountValid || settleMut.isPending}
          >
            {settleMut.isPending ? <><Loader2 size={13} className="mr-1 animate-spin" />Memproses...</> : "Tutup sebagai Beban"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
