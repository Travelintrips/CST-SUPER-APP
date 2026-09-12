import { DatePicker } from "@/components/ui/date-picker";
import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, RefreshCw, PlusCircle, Download, XCircle,
  AlertTriangle, DollarSign, CheckCircle, BookOpen, Settings, ChevronDown, ChevronUp,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

/* ─── helpers ─────────────────────────────────────────────────────────────── */
function fmtIdr(v: unknown) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
  }).format(parseFloat(String(v ?? 0)) || 0);
}
function fmtDate(v: unknown) {
  if (!v) return "-";
  try { return new Date(String(v)).toLocaleDateString("id-ID", { dateStyle: "medium" }); }
  catch { return "-"; }
}

/* ─── types ───────────────────────────────────────────────────────────────── */
type Payment = {
  id: number;
  driver_name: string;
  driver_external_id: string | null;
  vehicle_plate: string | null;
  payment_date: string;
  amount: string;
  payment_method: string;
  reference_no: string | null;
  notes: string | null;
  status: string;
  accounting_entry_id: number | null;
  recorded_by: string | null;
  remaining_outstanding: string | null;
};

type SummaryTotals = {
  thisMonthTotal: number;
  cancelledTotal: number;
  postedTotal: number;
  cancelledCount: number;
  confirmedCount: number;
  postedCount: number;
};

type FleetSettings = {
  fleetCashAccountId: number | null;
  fleetDriverReceivableAccountId: number | null;
};

type CoaAccount = {
  id: number;
  code: string;
  name: string;
  type: string;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "Dikonfirmasi", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-600" },
  cancelled: { label: "Dibatalkan",   cls: "bg-red-500/20 text-red-300 border-red-600" },
  posted:    { label: "Diposting",    cls: "bg-blue-500/20 text-blue-300 border-blue-600" },
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer Bank",
  gopay: "GoPay",
  qris: "QRIS",
  other: "Lainnya",
};

const EMPTY_FORM = {
  driver_name: "",
  vehicle_plate: "",
  amount: "",
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: "cash",
  reference_no: "",
  notes: "",
};

/* ─── component ───────────────────────────────────────────────────────────── */
export default function FleetCashPaymentsPage() {
  const qc = useQueryClient();

  /* list state */
  const [statusFilter, setStatusFilter] = useState("all");
  const [daysFilter,   setDaysFilter]   = useState("90");

  /* form dialog */
  const [formOpen,  setFormOpen]  = useState(false);
  const [form,      setForm]      = useState(EMPTY_FORM);

  /* cancel confirmation */
  const [cancelId, setCancelId] = useState<number | null>(null);

  /* COA settings panel */
  const [coaOpen, setCoaOpen] = useState(false);
  const [coaForm, setCoaForm] = useState<{ fleetCashAccountId: string; fleetDriverReceivableAccountId: string }>({
    fleetCashAccountId: "",
    fleetDriverReceivableAccountId: "",
  });

  /* ── queries ──────────────────────────────────────────────────────────── */
  const {
    data: listData,
    isLoading: listLoading,
    refetch: refetchList,
  } = useQuery({
    queryKey: ["fleet-cash-payments", statusFilter, daysFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ days: daysFilter, limit: "200" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/logistics/fleet/cash-payments?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil daftar pembayaran");
      return res.json() as Promise<{ payments: Payment[]; total: number }>;
    },
  });

  const {
    data: summaryData,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["fleet-cash-payments-summary"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/cash-payments/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal ringkasan");
      return res.json() as Promise<{ totals: SummaryTotals }>;
    },
  });

  const {
    data: settingsData,
    refetch: refetchSettings,
  } = useQuery({
    queryKey: ["fleet-settings"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/settings", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal settings");
      return res.json() as Promise<FleetSettings & { ok: boolean }>;
    },
  });

  const {
    data: coaData,
  } = useQuery({
    queryKey: ["coa-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/accounts", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil COA");
      return res.json() as Promise<CoaAccount[]>;
    },
  });

  /* ── mutations ────────────────────────────────────────────────────────── */
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.driver_name.trim()) throw new Error("Nama driver wajib diisi");
      if (!form.amount || parseFloat(form.amount) <= 0) throw new Error("Jumlah harus > 0");

      const coaOk = settingsData?.fleetCashAccountId && settingsData?.fleetDriverReceivableAccountId;
      if (!coaOk) throw new Error("Fleet Cash Payment COA belum disetup. Atur di bagian Fleet Accounting Settings dulu.");

      const res = await fetch("/api/logistics/fleet/cash-payments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driver_name:    form.driver_name.trim(),
          vehicle_plate:  form.vehicle_plate.trim() || undefined,
          amount:         parseFloat(form.amount),
          payment_date:   form.payment_date,
          payment_method: form.payment_method,
          reference_no:   form.reference_no.trim() || undefined,
          notes:          form.notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        if (res.status === 400) throw new Error(String(json.error ?? "Data tidak valid"));
        if (res.status === 422) throw new Error("Periode akuntansi sudah dikunci. Hubungi admin.");
        throw new Error(String(json.error ?? "Gagal menyimpan pembayaran"));
      }
      return json;
    },
    onSuccess: () => {
      toast.success("Pembayaran berhasil dicatat");
      setFormOpen(false);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["fleet-cash-payments"] });
      qc.invalidateQueries({ queryKey: ["fleet-cash-payments-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/logistics/fleet/cash-payments/${id}/cancel`, {
        method: "PATCH",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(json.error ?? "Gagal membatalkan"));
    },
    onSuccess: () => {
      toast.success("Pembayaran berhasil dibatalkan");
      setCancelId(null);
      qc.invalidateQueries({ queryKey: ["fleet-cash-payments"] });
      qc.invalidateQueries({ queryKey: ["fleet-cash-payments-summary"] });
    },
    onError: (e: Error) => { toast.error(e.message); setCancelId(null); },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fleetCashAccountId: coaForm.fleetCashAccountId ? parseInt(coaForm.fleetCashAccountId) : null,
          fleetDriverReceivableAccountId: coaForm.fleetDriverReceivableAccountId ? parseInt(coaForm.fleetDriverReceivableAccountId) : null,
        }),
      });
      const json = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(json.error ?? "Gagal simpan settings"));
      return json;
    },
    onSuccess: () => {
      toast.success("Fleet COA settings berhasil disimpan");
      qc.invalidateQueries({ queryKey: ["fleet-settings"] });
      refetchSettings();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── derived state ────────────────────────────────────────────────────── */
  const payments = useMemo(() => listData?.payments ?? [], [listData?.payments]);
  const totals   = summaryData?.totals;
  const settings = settingsData;
  const coaList  = coaData ?? [];
  const coaSetup = !!(settings?.fleetCashAccountId && settings?.fleetDriverReceivableAccountId);

  /* ── open COA panel: pre-fill form ───────────────────────────────────── */
  function openCoa() {
    setCoaForm({
      fleetCashAccountId: settings?.fleetCashAccountId ? String(settings.fleetCashAccountId) : "",
      fleetDriverReceivableAccountId: settings?.fleetDriverReceivableAccountId ? String(settings.fleetDriverReceivableAccountId) : "",
    });
    setCoaOpen(true);
  }

  /* ── export CSV ───────────────────────────────────────────────────────── */
  const exportCsv = useCallback(() => {
    if (!payments.length) { toast.error("Tidak ada data untuk diexport"); return; }
    const header = ["ID", "Tanggal", "Driver", "Plat", "Jumlah", "Metode", "No. Referensi", "Status", "Accounting Entry ID", "Dicatat oleh"];
    const rows   = payments.map((p) => [
      p.id,
      p.payment_date,
      p.driver_name,
      p.vehicle_plate ?? "",
      parseFloat(p.amount),
      METHOD_LABELS[p.payment_method] ?? p.payment_method,
      p.reference_no ?? "",
      p.status,
      p.accounting_entry_id ?? "",
      p.recorded_by ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `fleet-cash-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV berhasil diexport");
  }, [payments]);

  /* ── render ────────────────────────────────────────────────────────────── */
  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl">

        {/* Back button */}
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Cash Payments Driver</h1>
            <p className="text-slate-400 text-sm mt-1">Pencatatan pembayaran tunai driver terhadap outstanding</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" className="text-slate-400" onClick={() => { refetchList(); refetchSummary(); }}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" className="gap-2 border-slate-600 text-slate-300" onClick={exportCsv}>
              <Download className="w-4 h-4" /> Export CSV
            </Button>
            <Button
              size="sm"
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => { setForm(EMPTY_FORM); setFormOpen(true); }}
            >
              <PlusCircle className="w-4 h-4" /> Catat Pembayaran
            </Button>
          </div>
        </div>

        {/* COA warning */}
        {!coaSetup && (
          <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-700/50 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-amber-300 font-medium text-sm">Fleet cash payment COA belum disetup.</p>
              <p className="text-amber-400/70 text-xs mt-0.5">
                Atur <strong>Fleet Cash/Bank Account</strong> dan <strong>Fleet Driver Receivable Account</strong> di bawah sebelum mencatat pembayaran.
              </p>
            </div>
            <Button size="sm" variant="outline" className="border-amber-600 text-amber-300 hover:bg-amber-900/30 flex-shrink-0" onClick={openCoa}>
              <Settings className="w-3.5 h-3.5 mr-1.5" /> Atur COA
            </Button>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Total Bulan Ini",
              value: fmtIdr(totals?.thisMonthTotal ?? 0),
              icon: <DollarSign className="w-7 h-7 text-emerald-400" />,
              cls: "text-emerald-400",
              bg: "bg-emerald-900/20 border-emerald-700/30",
            },
            {
              label: "Dibatalkan (bln ini)",
              value: fmtIdr(totals?.cancelledTotal ?? 0),
              icon: <XCircle className="w-7 h-7 text-red-400" />,
              cls: "text-red-400",
              bg: "bg-red-900/20 border-red-700/30",
            },
            {
              label: "Diposting ke Akuntansi",
              value: fmtIdr(totals?.postedTotal ?? 0),
              icon: <BookOpen className="w-7 h-7 text-blue-400" />,
              cls: "text-blue-400",
              bg: "bg-blue-900/20 border-blue-700/30",
            },
            {
              label: "Total Dikonfirmasi",
              value: String(totals?.confirmedCount ?? 0) + " transaksi",
              icon: <CheckCircle className="w-7 h-7 text-slate-400" />,
              cls: "text-slate-300",
              bg: "bg-slate-800/60 border-slate-700",
            },
          ].map((c) => (
            <Card key={c.label} className={`${c.bg} border`}>
              <CardContent className="p-4 flex items-center gap-3">
                {c.icon}
                <div>
                  <div className={`text-lg font-bold ${c.cls}`}>{c.value}</div>
                  <div className="text-slate-400 text-xs mt-0.5">{c.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-slate-400 text-sm">Filter:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 bg-slate-700 border-slate-600 text-white h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="confirmed">Dikonfirmasi</SelectItem>
              <SelectItem value="cancelled">Dibatalkan</SelectItem>
            </SelectContent>
          </Select>
          <Select value={daysFilter} onValueChange={setDaysFilter}>
            <SelectTrigger className="w-36 bg-slate-700 border-slate-600 text-white h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 Hari</SelectItem>
              <SelectItem value="60">60 Hari</SelectItem>
              <SelectItem value="90">90 Hari</SelectItem>
              <SelectItem value="180">6 Bulan</SelectItem>
              <SelectItem value="365">1 Tahun</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-slate-500 text-sm">{listData?.total ?? 0} catatan</span>
        </div>

        {/* Payments table */}
        <Card className="bg-slate-800/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base">Daftar Pembayaran Tunai</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr>
                    {[
                      "Tanggal", "Driver", "Plat", "Jumlah", "Metode",
                      "No. Ref", "Status", "Entry Akuntansi", "Aksi",
                    ].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap text-xs">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-700/50">
                          <td colSpan={9} className="px-4 py-3">
                            <div className="h-4 bg-slate-700 rounded animate-pulse" />
                          </td>
                        </tr>
                      ))
                    : payments.length === 0
                      ? (
                          <tr>
                            <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                              <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30 text-slate-400" />
                              <p>Belum ada catatan pembayaran</p>
                              <p className="text-xs mt-1">Klik "Catat Pembayaran" untuk menambahkan</p>
                            </td>
                          </tr>
                        )
                      : payments.map((p) => {
                          const st   = STATUS_META[p.status] ?? { label: p.status, cls: "bg-slate-500/20 text-slate-300 border-slate-600" };
                          const amt  = parseFloat(p.amount);
                          const cancelled = p.status === "cancelled";
                          return (
                            <tr key={p.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${cancelled ? "opacity-60" : ""}`}>
                              <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">{fmtDate(p.payment_date)}</td>
                              <td className="px-4 py-3">
                                <div className="text-white text-sm font-medium">{p.driver_name}</div>
                                {p.driver_external_id && (
                                  <div className="text-slate-500 text-xs font-mono mt-0.5">{p.driver_external_id}</div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.vehicle_plate ?? "-"}</td>
                              <td className={`px-4 py-3 text-right tabular-nums font-semibold text-sm ${cancelled ? "text-slate-500 line-through" : "text-emerald-400"}`}>
                                {fmtIdr(amt)}
                              </td>
                              <td className="px-4 py-3 text-slate-400 text-xs">{METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                              <td className="px-4 py-3 text-slate-400 text-xs font-mono">{p.reference_no ?? "-"}</td>
                              <td className="px-4 py-3">
                                <Badge className={`text-xs border ${st.cls}`}>{st.label}</Badge>
                              </td>
                              <td className="px-4 py-3 text-xs">
                                {p.accounting_entry_id
                                  ? <span className="text-blue-400 font-mono">#{p.accounting_entry_id}</span>
                                  : <span className="text-slate-600">-</span>}
                              </td>
                              <td className="px-4 py-3">
                                {!cancelled && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-red-700 text-red-400 hover:bg-red-900/30 gap-1"
                                    onClick={() => setCancelId(p.id)}
                                  >
                                    <XCircle className="w-3 h-3" /> Batal
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* COA Settings panel (collapsible) */}
        <Card className="bg-slate-800/60 border-slate-700">
          <button
            className="flex items-center justify-between w-full p-4 text-left"
            onClick={() => { if (!coaOpen) openCoa(); else setCoaOpen(false); }}
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" />
              <span className="text-white font-medium text-sm">Fleet Accounting Settings (COA)</span>
              {coaSetup
                ? <Badge className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-600">Terkonfigurasi</Badge>
                : <Badge className="text-xs bg-amber-500/20 text-amber-300 border border-amber-600">Belum disetup</Badge>}
            </div>
            {coaOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {coaOpen && (
            <CardContent className="border-t border-slate-700 pt-4 space-y-4">
              <p className="text-slate-400 text-sm">
                Pilih akun COA untuk pencatatan kas dan piutang driver dalam modul Fleet Intelligence.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Fleet Cash / Bank Account</Label>
                  <Select
                    value={coaForm.fleetCashAccountId}
                    onValueChange={(v) => setCoaForm((f) => ({ ...f, fleetCashAccountId: v }))}
                  >
                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                      <SelectValue placeholder="Pilih akun kas/bank..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {coaList.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.code} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-slate-500 text-xs">Akun yang akan didebit saat driver melakukan pembayaran tunai.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-sm">Fleet Driver Receivable Account</Label>
                  <Select
                    value={coaForm.fleetDriverReceivableAccountId}
                    onValueChange={(v) => setCoaForm((f) => ({ ...f, fleetDriverReceivableAccountId: v }))}
                  >
                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                      <SelectValue placeholder="Pilih akun piutang driver..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {coaList.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.code} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-slate-500 text-xs">Akun piutang driver yang akan dikredit saat outstanding berkurang.</p>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  className="bg-indigo-600 hover:bg-indigo-700 gap-2"
                  disabled={saveSettingsMutation.isPending}
                  onClick={() => saveSettingsMutation.mutate()}
                >
                  {saveSettingsMutation.isPending
                    ? <><RefreshCw className="w-4 h-4 animate-spin" /> Menyimpan...</>
                    : "Simpan Settings"}
                </Button>
                <Button variant="ghost" className="text-slate-400" onClick={() => setCoaOpen(false)}>Tutup</Button>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {/* ── Dialog: Create Payment ─────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setForm(EMPTY_FORM); } }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-emerald-400" />
              Catat Pembayaran Tunai Driver
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Pembayaran akan mengurangi outstanding driver jika outstanding_id ditautkan.
            </DialogDescription>
          </DialogHeader>

          {!coaSetup && (
            <div className="flex items-center gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <p className="text-amber-300 text-xs">Fleet cash payment COA belum disetup. Form tidak dapat disubmit.</p>
            </div>
          )}

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-slate-300 text-sm">Nama Driver *</Label>
                <Input
                  placeholder="Nama lengkap driver"
                  value={form.driver_name}
                  onChange={(e) => setForm((f) => ({ ...f, driver_name: e.target.value }))}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Plat Kendaraan</Label>
                <Input
                  placeholder="B 1234 XYZ"
                  value={form.vehicle_plate}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle_plate: e.target.value }))}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Jumlah (IDR) *</Label>
                <Input
                  type="number"
                  placeholder="0"
                  min="0"
                  step="1000"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Tanggal Pembayaran *</Label>
                <DatePicker value={form.payment_date} onChange={(v) => setForm((f) => ({ ...f, payment_date: v }))} className="bg-slate-700 border-slate-600 text-white" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Metode Pembayaran</Label>
                <Select value={form.payment_method} onValueChange={(v) => setForm((f) => ({ ...f, payment_method: v }))}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHOD_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">No. Referensi</Label>
                <Input
                  placeholder="Opsional"
                  value={form.reference_no}
                  onChange={(e) => setForm((f) => ({ ...f, reference_no: e.target.value }))}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="text-slate-300 text-sm">Catatan</Label>
                <Textarea
                  placeholder="Opsional..."
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-slate-700 border-slate-600 text-white resize-none"
                  rows={2}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1 border-slate-600"
              onClick={() => { setFormOpen(false); setForm(EMPTY_FORM); }}
            >
              Batal
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-2"
              disabled={createMutation.isPending || !coaSetup}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Menyimpan...</>
                : <><CheckCircle className="w-4 h-4" /> Simpan Pembayaran</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Cancel Confirmation ────────────────────────────────── */}
      <Dialog open={cancelId !== null} onOpenChange={(o) => { if (!o) setCancelId(null); }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-400" />
              Batalkan Pembayaran?
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Status akan berubah menjadi <strong className="text-red-300">Dibatalkan</strong> dan outstanding driver akan dikembalikan.
              Tindakan ini tidak dapat diurungkan.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setCancelId(null)}>
              Urungkan
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700 gap-2"
              disabled={cancelMutation.isPending}
              onClick={() => cancelId !== null && cancelMutation.mutate(cancelId)}
            >
              {cancelMutation.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Membatalkan...</>
                : "Ya, Batalkan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
