import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, Search, RefreshCw, CheckCircle,
  MessageCircle, Users, DollarSign, ChevronUp, ChevronDown,
  Link as LinkIcon, FileText, Trash2, Eye, Download, Send, ArrowLeft,
} from "lucide-react";
import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

function fmtIdr(v: unknown) {
  const n = parseFloat(String(v ?? 0)) || 0;
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}
function fmtDate(v: unknown) {
  if (!v) return "-";
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
function daysSince(v: unknown): number {
  if (!v) return 9999;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return 9999;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

type OutstandingRow = {
  id: number;
  driver_name: string;
  driver_external_id: string | null;
  driver_phone: string | null;
  vehicle_plate: string | null;
  outstanding_amount: string | number;
  last_updated_date: string | null;
  due_days: number;
  status: string;
  notes: string | null;
};

type SortKey = "outstanding_amount" | "due_days" | "last_updated_date";
const MIN_MACET = 500_000;

const DEFAULT_REMINDER_MSG =
  `Yth. [Nama Driver],\n\nKami menginformasikan bahwa Anda memiliki outstanding yang belum terselesaikan.\n\nMohon segera menghubungi admin untuk penyelesaian.\n\nTerima kasih.`;

export default function DriverMacetPage() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("outstanding_amount");
  const [sortAsc, setSortAsc] = useState(false);

  const [followupId, setFollowupId] = useState<number | null>(null);
  const [followupNotes, setFollowupNotes] = useState("");
  const [resolveId, setResolveId] = useState<number | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [waDriver, setWaDriver] = useState<OutstandingRow | null>(null);
  const [waMessage, setWaMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<OutstandingRow | null>(null);
  const [showReminderDialog, setShowReminderDialog] = useState(false);
  const [reminderMsg, setReminderMsg] = useState(DEFAULT_REMINDER_MSG);
  const [suppressHours, setSuppressHours] = useState("24");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["fleet-macet-outstanding"],
    queryFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding?status=open", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil data outstanding");
      return res.json() as Promise<{ outstanding: OutstandingRow[]; summary: Record<string, unknown> }>;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const followupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/logistics/fleet/outstanding/${followupId}/followup`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: followupNotes }),
      });
      if (!res.ok) throw new Error("Gagal simpan catatan");
    },
    onSuccess: () => {
      toast.success("Catatan berhasil disimpan");
      setFollowupId(null); setFollowupNotes("");
      qc.invalidateQueries({ queryKey: ["fleet-macet-outstanding"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/logistics/fleet/outstanding/${resolveId}/resolve`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: resolveNotes }),
      });
      if (!res.ok) throw new Error("Gagal tandai lunas");
    },
    onSuccess: () => {
      toast.success("Driver ditandai lunas");
      setResolveId(null); setResolveNotes("");
      qc.invalidateQueries({ queryKey: ["fleet-macet-outstanding"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const waMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/logistics/fleet/outstanding/${waDriver!.id}/wa`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: waDriver!.driver_phone, message: waMessage }),
      });
      if (!res.ok) throw new Error("Gagal kirim WA");
    },
    onSuccess: () => {
      toast.success("WhatsApp berhasil dikirim");
      setWaDriver(null); setWaMessage("");
      qc.invalidateQueries({ queryKey: ["fleet-macet-outstanding"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/logistics/fleet/outstanding/${id}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error("Gagal hapus data outstanding");
    },
    onSuccess: () => {
      toast.success("Data outstanding berhasil dihapus");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["fleet-macet-outstanding"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reminderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/logistics/fleet/outstanding/wa-reminder", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reminderMsg, suppress_hours: parseInt(suppressHours) || 24 }),
      });
      if (!res.ok) throw new Error("Gagal kirim WA reminder");
      return res.json() as Promise<{ sent: number; failed: number; total: number; message: string }>;
    },
    onSuccess: (d) => {
      toast.success(`WA terkirim ke ${d.sent} driver${d.failed > 0 ? `, ${d.failed} gagal` : ""}`);
      setShowReminderDialog(false);
      qc.invalidateQueries({ queryKey: ["fleet-macet-outstanding"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allOpen = data?.outstanding ?? [];
  const macetList = useMemo(
    () => allOpen.filter((r) => (parseFloat(String(r.outstanding_amount)) || 0) >= MIN_MACET),
    [allOpen]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = q
      ? macetList.filter(
          (r) =>
            r.driver_name?.toLowerCase().includes(q) ||
            r.vehicle_plate?.toLowerCase().includes(q) ||
            (r.driver_external_id ?? "").toLowerCase().includes(q) ||
            (r.driver_phone ?? "").includes(q)
        )
      : macetList;
    return [...list].sort((a, b) => {
      if (sortKey === "last_updated_date") {
        const da = daysSince(a.last_updated_date);
        const db2 = daysSince(b.last_updated_date);
        return sortAsc ? da - db2 : db2 - da;
      }
      const va = Number(a[sortKey]) || 0;
      const vb = Number(b[sortKey]) || 0;
      return sortAsc ? va - vb : vb - va;
    });
  }, [macetList, search, sortKey, sortAsc]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(false); }
  }
  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronUp className="w-3 h-3 opacity-30" />;
    return sortAsc ? <ChevronUp className="w-3 h-3 text-red-400" /> : <ChevronDown className="w-3 h-3 text-red-400" />;
  }

  const totalOutstanding = filtered.reduce((s, r) => s + (parseFloat(String(r.outstanding_amount)) || 0), 0);

  function openWa(driver: OutstandingRow) {
    setWaMessage(
      `Yth. ${driver.driver_name},\n\nKami menginformasikan bahwa Anda memiliki outstanding sebesar ${fmtIdr(driver.outstanding_amount)} yang belum terselesaikan.\n\nMohon segera menghubungi admin untuk penyelesaian.\n\nTerima kasih.`
    );
    setWaDriver(driver);
  }

  function exportCsv() {
    const header = ["No", "Nama Driver", "ID External", "Phone", "Plat", "Outstanding (IDR)", "Terakhir di CSV", "Due Days", "Catatan"];
    const rows = filtered.map((d, i) => [
      i + 1,
      d.driver_name,
      d.driver_external_id ?? "",
      d.driver_phone ?? "",
      d.vehicle_plate ?? "",
      parseFloat(String(d.outstanding_amount)) || 0,
      d.last_updated_date ?? "",
      d.due_days ?? 0,
      (d.notes ?? "").replace(/"/g, '""'),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${c}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `driver-macet-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} baris diekspor ke CSV`);
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <Link href="/logistics/fleet-intelligence">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1.5 -ml-2">
            <ArrowLeft className="w-4 h-4" /> Fleet Intelligence
          </Button>
        </Link>
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-900/40 rounded-lg border border-red-700/40">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Driver Macet</h1>
              <p className="text-sm text-slate-400">Outstanding &gt; Rp 500 ribu (belum lunas)</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* WA Reminder Semua */}
            <Button
              size="sm"
              className="bg-green-700 hover:bg-green-600 text-white gap-1.5"
              onClick={() => setShowReminderDialog(true)}
              disabled={macetList.length === 0}
            >
              <Send className="w-3.5 h-3.5" />
              WA Reminder Semua
            </Button>
            {/* Export CSV */}
            <Button
              variant="outline" size="sm"
              className="border-slate-600 text-slate-300 hover:bg-slate-700 gap-1.5"
              onClick={exportCsv}
              disabled={filtered.length === 0}
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </Button>
            <Link href="/logistics/fleet-intelligence/outstanding">
              <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 hover:bg-slate-700 gap-1.5">
                <LinkIcon className="w-3.5 h-3.5" />
                Semua Outstanding
              </Button>
            </Link>
            <Button
              variant="outline" size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="border-slate-700 text-slate-300 hover:bg-slate-700 gap-1.5"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-red-950/30 border-red-800/40">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-2.5 bg-red-900/40 rounded-lg"><Users className="w-5 h-5 text-red-400" /></div>
              <div>
                <p className="text-2xl font-bold text-white">{isLoading ? "—" : macetList.length}</p>
                <p className="text-sm text-red-300/80">Driver Macet</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-orange-950/30 border-orange-800/40">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-2.5 bg-orange-900/40 rounded-lg"><DollarSign className="w-5 h-5 text-orange-400" /></div>
              <div>
                <p className="text-2xl font-bold text-orange-400">
                  {isLoading ? "—" : fmtIdr(macetList.reduce((s, r) => s + (parseFloat(String(r.outstanding_amount)) || 0), 0))}
                </p>
                <p className="text-sm text-slate-400">Total Outstanding Macet</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/40">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-2.5 bg-slate-700/60 rounded-lg"><AlertTriangle className="w-5 h-5 text-amber-400" /></div>
              <div>
                <p className="text-2xl font-bold text-white">{isLoading ? "—" : allOpen.length}</p>
                <p className="text-sm text-slate-400">Total Semua Outstanding</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card className="bg-slate-800/50 border-slate-700/40">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm text-slate-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              Daftar Driver Macet
              {!isLoading && filtered.length > 0 && (
                <Badge className="bg-red-900/60 text-red-300 border-red-700 text-xs">{filtered.length}</Badge>
              )}
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
              <Input
                placeholder="Cari nama / plat / phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs bg-slate-900/60 border-slate-700 text-slate-200 placeholder:text-slate-600"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/60 bg-slate-900/40 text-slate-400 text-xs">
                    <th className="px-4 py-2.5 text-left w-8">#</th>
                    <th className="px-3 py-2.5 text-left">Driver</th>
                    <th className="px-3 py-2.5 text-left">ID External</th>
                    <th className="px-3 py-2.5 text-left">Phone</th>
                    <th className="px-3 py-2.5 text-left">Plat</th>
                    <th className="px-3 py-2.5 text-right cursor-pointer hover:text-slate-200 select-none" onClick={() => toggleSort("outstanding_amount")}>
                      <span className="inline-flex items-center gap-1 justify-end">Outstanding <SortIcon k="outstanding_amount" /></span>
                    </th>
                    <th className="px-3 py-2.5 text-left cursor-pointer hover:text-slate-200 select-none" onClick={() => toggleSort("last_updated_date")}>
                      <span className="inline-flex items-center gap-1">Terakhir di CSV <SortIcon k="last_updated_date" /></span>
                    </th>
                    <th className="px-3 py-2.5 text-right cursor-pointer hover:text-slate-200 select-none" onClick={() => toggleSort("due_days")}>
                      <span className="inline-flex items-center gap-1 justify-end">Due Days <SortIcon k="due_days" /></span>
                    </th>
                    <th className="px-3 py-2.5 text-left">Catatan</th>
                    <th className="px-3 py-2.5 text-left">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-700/30">
                          <td colSpan={10} className="px-4 py-2.5"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td>
                        </tr>
                      ))
                    : filtered.length === 0
                    ? (
                        <tr>
                          <td colSpan={10} className="px-4 py-14 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <CheckCircle className="w-9 h-9 text-emerald-500/40" />
                              <p className="text-sm font-medium text-slate-400">
                                {search ? "Tidak ada driver yang cocok" : "Tidak ada driver macet saat ini"}
                              </p>
                              {!search && <p className="text-xs text-slate-600">Semua outstanding di bawah Rp 500 ribu</p>}
                            </div>
                          </td>
                        </tr>
                      )
                    : filtered.map((d, i) => {
                        const amount = parseFloat(String(d.outstanding_amount)) || 0;
                        const days = daysSince(d.last_updated_date);
                        const csvColor = days >= 30 ? "text-red-400" : days >= 14 ? "text-amber-400" : days >= 7 ? "text-yellow-300" : "text-slate-400";
                        return (
                          <tr key={d.id} className="border-b border-slate-700/30 hover:bg-red-950/10 transition-colors">
                            <td className="px-4 py-2.5 text-slate-500 text-xs">{i + 1}</td>
                            <td className="px-3 py-2.5 font-medium text-white text-xs whitespace-nowrap">{d.driver_name || "-"}</td>
                            <td className="px-3 py-2.5 text-slate-400 font-mono text-xs">{d.driver_external_id ?? "-"}</td>
                            <td className="px-3 py-2.5 text-slate-300 text-xs whitespace-nowrap">{d.driver_phone ?? "-"}</td>
                            <td className="px-3 py-2.5 text-slate-300 text-xs">{d.vehicle_plate ?? "-"}</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={`font-bold text-xs ${amount >= 1_000_000 ? "text-red-400" : "text-amber-400"}`}>
                                {fmtIdr(amount)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                              <div>
                                <span className={csvColor}>{fmtDate(d.last_updated_date)}</span>
                                {days < 9999 && (
                                  <div className={`text-[10px] mt-0.5 ${csvColor} opacity-70`}>
                                    {days === 0 ? "hari ini" : `${days} hari lalu`}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={`text-xs ${Number(d.due_days) > 30 ? "text-red-400" : "text-slate-300"}`}>
                                {String(d.due_days ?? 0)}h
                              </span>
                            </td>
                            <td className="px-3 py-2.5 max-w-[140px]">
                              {d.notes
                                ? <span className="text-slate-400 text-[10px] line-clamp-2">{d.notes}</span>
                                : <span className="text-slate-600 text-[10px]">-</span>
                              }
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1">
                                {d.driver_external_id && (
                                  <Button variant="ghost" size="sm" className="h-6 px-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20" title="Lihat profil driver"
                                    onClick={() => navigate(`/logistics/fleet-intelligence/drivers/${encodeURIComponent(d.driver_external_id!)}/detail`)}>
                                    <Eye className="w-3 h-3" />
                                  </Button>
                                )}
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-slate-400 hover:text-white hover:bg-slate-700" title="Catatan tindak lanjut"
                                  onClick={() => { setFollowupId(d.id); setFollowupNotes(d.notes ?? ""); }}>
                                  <FileText className="w-3 h-3" />
                                </Button>
                                {d.driver_phone && (
                                  <Button variant="ghost" size="sm" className="h-6 px-2 text-green-400 hover:text-green-300 hover:bg-green-900/20" title="Kirim WA"
                                    onClick={() => openWa(d)}>
                                    <MessageCircle className="w-3 h-3" />
                                  </Button>
                                )}
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20" title="Tandai lunas"
                                  onClick={() => { setResolveId(d.id); setResolveNotes(""); }}>
                                  <CheckCircle className="w-3 h-3" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-red-500 hover:text-red-400 hover:bg-red-900/20" title="Hapus dari daftar"
                                  onClick={() => setDeleteTarget(d)}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
                {!isLoading && filtered.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-slate-600 bg-slate-800/80">
                      <td colSpan={5} className="px-4 py-2.5 text-slate-400 text-xs font-medium">Total ({filtered.length} driver)</td>
                      <td className="px-3 py-2.5 text-right text-red-400 text-xs font-bold">{fmtIdr(totalOutstanding)}</td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dialog: WA Reminder Semua */}
      {showReminderDialog && (
        <Dialog open onOpenChange={() => setShowReminderDialog(false)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="w-4 h-4 text-green-400" />
                WA Reminder — {macetList.filter(d => d.driver_phone).length} Driver
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-slate-700/50 rounded-lg p-3 text-xs text-slate-300 space-y-1">
                <p>WA dikirim ke semua driver dengan outstanding &gt; Rp 500 ribu yang memiliki nomor HP.</p>
                <p className="text-slate-400">Driver yang sudah dikirim dalam periode suppress akan dilewati otomatis.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Pesan (gunakan [Nama Driver] untuk personalisasi)</Label>
                <Textarea
                  value={reminderMsg}
                  onChange={(e) => setReminderMsg(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white resize-none text-sm"
                  rows={6}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Jangan kirim ulang dalam (jam)</Label>
                <div className="flex gap-2">
                  {["12", "24", "48", "72"].map((h) => (
                    <button
                      key={h}
                      onClick={() => setSuppressHours(h)}
                      className={`px-3 py-1.5 rounded text-xs border transition-colors ${
                        suppressHours === h
                          ? "bg-green-700 border-green-600 text-white"
                          : "bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600"
                      }`}
                    >
                      {h}j
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setShowReminderDialog(false)}>Batal</Button>
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  disabled={reminderMutation.isPending || !reminderMsg.trim()}
                  onClick={() => reminderMutation.mutate()}
                >
                  <Send className="w-4 h-4 mr-1.5" />
                  {reminderMutation.isPending ? "Mengirim..." : "Kirim Sekarang"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog: Catatan Followup */}
      {followupId !== null && (
        <Dialog open onOpenChange={() => setFollowupId(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-sm">
            <DialogHeader><DialogTitle>Catatan Tindak Lanjut</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Catatan</Label>
                <Textarea value={followupNotes} onChange={(e) => setFollowupNotes(e.target.value)}
                  placeholder="Deskripsi tindak lanjut, janji bayar, dll..."
                  className="bg-slate-700 border-slate-600 text-white resize-none" rows={4} />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setFollowupId(null)}>Batal</Button>
                <Button className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled={followupMutation.isPending || !followupNotes.trim()}
                  onClick={() => followupMutation.mutate()}>
                  {followupMutation.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog: Tandai Lunas */}
      {resolveId !== null && (
        <Dialog open onOpenChange={() => setResolveId(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-sm">
            <DialogHeader><DialogTitle>Tandai Lunas</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-slate-400 text-sm">Konfirmasi driver telah melunasi outstanding-nya.</p>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Catatan (opsional)</Label>
                <Textarea value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)}
                  placeholder="Metode pelunasan, no. referensi, dll..."
                  className="bg-slate-700 border-slate-600 text-white resize-none" rows={3} />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setResolveId(null)}>Batal</Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  disabled={resolveMutation.isPending} onClick={() => resolveMutation.mutate()}>
                  {resolveMutation.isPending ? "Menyimpan..." : "Konfirmasi Lunas"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog: Kirim WA (per driver) */}
      {waDriver !== null && (
        <Dialog open onOpenChange={() => setWaDriver(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-green-400" />
                Kirim WA — {waDriver.driver_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Nomor WA</Label>
                <Input value={waDriver.driver_phone ?? ""} readOnly className="bg-slate-700 border-slate-600 text-slate-300 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-sm">Pesan</Label>
                <Textarea value={waMessage} onChange={(e) => setWaMessage(e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white resize-none text-sm" rows={6} />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setWaDriver(null)}>Batal</Button>
                <Button className="flex-1 bg-green-600 hover:bg-green-700"
                  disabled={waMutation.isPending || !waMessage.trim()} onClick={() => waMutation.mutate()}>
                  <MessageCircle className="w-4 h-4 mr-1.5" />
                  {waMutation.isPending ? "Mengirim..." : "Kirim WA"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog: Konfirmasi Hapus */}
      {deleteTarget !== null && (
        <Dialog open onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-400">
                <Trash2 className="w-4 h-4" />
                Hapus Data Outstanding
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-3 space-y-1">
                <p className="text-white font-medium text-sm">{deleteTarget.driver_name}</p>
                <p className="text-red-300 text-sm font-bold">{fmtIdr(deleteTarget.outstanding_amount)}</p>
                <p className="text-slate-400 text-xs">{deleteTarget.driver_external_id ?? ""}</p>
              </div>
              <p className="text-slate-400 text-sm">
                Data dihapus permanen. Jika driver muncul kembali di CSV upload berikutnya, data akan otomatis muncul kembali.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setDeleteTarget(null)}>Batal</Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700"
                  disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteTarget.id)}>
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  {deleteMutation.isPending ? "Menghapus..." : "Hapus"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}
